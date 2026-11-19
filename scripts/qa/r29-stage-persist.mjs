// R29：阶段进度持久化 —— 刷新页面不该把「我已经走到第 3 步」抹掉。
//
// 断言：
//   1) 干净起步是 0 步；写完第 1 步跑通后是「第 2 / 4 步 · 已过 1 步」
//   2) 整页硬刷新（等价用户 F5）后，仍是 1 步，且第 1 步的完整代码还看得见
//   3) 推进到 2 步后刷新，仍是 2 步
//   4) 阶段结构指纹被人为改坏（模拟内容改版）后，进度作废回 0 步——不能拿假绿骗人
//   5) 改回正确指纹后，进度回来
//   6) 退步（四步过两步、改坏后停在第 2 步）：历史不清，但头部红字标「本次没过」
//   7) 「从零重做」清空阶段进度
//
// 会动数据库，所以开头备份这一关的整行、结尾原样写回，不破坏正在体验的用户数据。
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { Cdp, sleep } from './cdp.mjs'

const root = join(import.meta.dirname, '..', '..')
const project = JSON.parse(readFileSync(join(root, 'content', 'projects', 'mini-vue-reactivity.json'), 'utf8'))
const lv = project.levels[0]
const stages = lv.stages
const pid = project.id
const lid = lv.id

const fail = []
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) fail.push(name)
}
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim()

const cdp = await Cdp.connect(25)
await cdp.metrics(1460, 940)
await cdp.reloadHard(2500)

// 进入关卡让 IPC 桥就绪，并从应用自己那儿拿数据库真实路径（不猜 data/app.db）
await cdp.nav(`/projects/${pid}/${lid}`)
await sleep(900)
const paths = await cdp.evaluate(`return await window.forge.app.paths()`)
const db = new DatabaseSync(paths.db)
db.exec('PRAGMA busy_timeout=5000')

const readRow = () =>
  db.prepare(`SELECT * FROM project_progress WHERE project_id=? AND level_id=?`).get(pid, lid)
const backup = readRow()

// 中途抛异常也要把这一行还回去（兜底；成功路径在脚本末尾显式调用一次）
process.on('exit', () => {
  try { restoreBackup() } catch (e) { console.error(`  ❌ 退出时还原抛错：${e}`) }
})

/**
 * 还原这一行。为什么要校验：脚本和应用是同一个库的两个连接，应用还在写。
 * 撞锁或交错时 DELETE + INSERT 可能只落一半，而退出兜底的 catch 会把错误吞掉——
 * 上一轮就是这么把测试进度留在库里的。这里改成「事务 + 读回比对 + 重试」，
 * 四次都对不上就大声报出来，而不是假装还原成功。
 */
let backupRestored = false
function restoreBackup() {
  if (backupRestored) return
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      db.exec('BEGIN IMMEDIATE')
      db.prepare(`DELETE FROM project_progress WHERE project_id=? AND level_id=?`).run(pid, lid)
      if (backup) {
        const cols = Object.keys(backup)
        db.prepare(`INSERT INTO project_progress(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`)
          .run(...cols.map((c) => backup[c]))
      }
      db.exec('COMMIT')
      const now = readRow()
      const same = backup ? JSON.stringify(now) === JSON.stringify(backup) : !now
      if (same) {
        backupRestored = true
        console.log('  （已还原测前的那一行进度，并校验通过）')
        return
      }
      console.warn(`  ⚠️ 还原后校验不一致（第 ${attempt} 次），重试`)
    } catch (e) {
      try { db.exec('ROLLBACK') } catch { /* 事务可能已结束 */ }
      console.warn(`  ⚠️ 还原失败（第 ${attempt} 次）：${e instanceof Error ? e.message : e}`)
    }
  }
  console.error('  ❌ 4 次还原都没成功：库里这一行可能仍是测试状态，请用项目页的「从零重做」或手动回退')
}

const setStageBase = (value) => {
  db.prepare(`UPDATE project_progress SET stage_base=? WHERE project_id=? AND level_id=?`).run(value, pid, lid)
}

await cdp.evaluate(`return await window.forge.project.resetLevel('${pid}', '${lid}')`)
await cdp.reloadHard(2500)
await sleep(1200)

async function state() {
  return cdp.evaluate(`return (() => {
    const n = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
    const cards = [...document.querySelectorAll('.stage')];
    const ta = document.querySelector('.work-pane textarea');
    return {
      chip: n((document.querySelector('.todo-chip') || {}).textContent),
      total: cards.length,
      done: cards.filter((c) => c.classList.contains('done')).length,
      bad: cards.filter((c) => c.classList.contains('bad')).length,
      active: cards.findIndex((c) => c.classList.contains('active')),
      doneCodes: cards.filter((c) => c.classList.contains('done') && c.querySelector('.snippet')).length,
      editor: ta ? ta.value : ''
    };
  })()`)
}

async function setCode(code) {
  await cdp.evaluate(`return (() => {
    const ta = document.querySelector('.work-pane textarea');
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    set.call(ta, ${JSON.stringify(code)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)
  await sleep(400)
}

async function runTest() {
  await cdp.evaluate(`return (() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('跑测试'));
    if (btn) btn.click();
    return !!btn;
  })()`)
  for (let i = 0; i < 40; i++) {
    await sleep(300)
    const done = await cdp.evaluate(`return (() => {
      const r = document.querySelector('.result');
      const busy = [...document.querySelectorAll('button')].some((b) => b.textContent.includes('运行中'));
      return !!r && !busy;
    })()`)
    if (done) break
  }
  await sleep(500)
}

/* ---------- 1. 干净起步 ---------- */
let s = await state()
check('干净起步：0 步通过、停在第 1 步', s.done === 0 && s.active === 0, `${s.total} 步卡片 · ${s.chip}`)
check('起步文案是「第 1 / 4 步 · 已过 0 步」', s.chip === `第 1 / ${stages.length} 步 · 已过 0 步`, s.chip)

/* ---------- 2. 跑通第 1 步，再刷新 ---------- */
await setCode(stages[0].code)
await runTest()
s = await state()
check('第 1 步通过后：已过 1 步、停在第 2 步', s.done === 1 && s.active === 1, s.chip)

await cdp.reloadHard(2500)
await sleep(1200)
s = await state()
check(
  '刷新后阶段进度不丢（仍是「第 2 / 4 步 · 已过 1 步」）',
  s.done === 1 && s.active === 1 && s.chip === `第 2 / ${stages.length} 步 · 已过 1 步`,
  `${s.chip} · done=${s.done} active=${s.active}`
)
check('刷新后第 1 步的完整代码仍然可见', s.doneCodes >= 1, `${s.doneCodes} 段代码`)
// 第 1 步的代码里只有空 handler，还没有 Reflect.get（那是第 2 步才加的东西）
check('刷新后草稿仍在编辑器里', s.editor.includes('new Proxy'), `${s.editor.split('\n').length} 行`)

/* ---------- 3. 推进到 2 步，再刷新 ---------- */
await setCode(stages[1].code)
await runTest()
s = await state()
check('第 2 步通过后：已过 2 步、停在第 3 步', s.done === 2 && s.active === 2, s.chip)

const goodBase = readRow()?.stage_base
check('数据库里有了阶段指纹', !!goodBase, String(goodBase))

await cdp.reloadHard(2500)
await sleep(1200)
s = await state()
check('再次刷新后仍是 2 步', s.done === 2 && s.active === 2, `${s.chip} · 代码段 ${s.doneCodes}`)

/* ---------- 4. 内容改版：指纹不匹配 → 进度作废 ---------- */
setStageBase('r29-force-stale')
await cdp.reloadHard(2500)
await sleep(1200)
s = await state()
check(
  '阶段结构变了（指纹不匹配）：进度作废回 0 步，而不是假绿',
  s.done === 0 && s.active === 0 && s.chip === `第 1 / ${stages.length} 步 · 已过 0 步`,
  s.chip
)

setStageBase(goodBase)
await cdp.reloadHard(2500)
await sleep(1200)
s = await state()
check('指纹改回来：进度恢复 2 步', s.done === 2, s.chip)

/* ---------- 5. 退步：历史不清，但标「本次没过」 ---------- */
await setCode(stages[0].code)
await runTest()
s = await state()
check('退步后历史进度不回收（仍是 2 步）', s.done === 2, `done=${s.done} bad=${s.bad}`)
check('退步的这一步标出了「本次没过」', s.bad === 1, `bad=${s.bad} ${s.chip}`)
check('文案把「本次」和「此前」分开说', s.chip.includes('本次停在') && s.chip.includes('此前已过 2 步'), s.chip)

await cdp.reloadHard(2500)
await sleep(1200)
s = await state()
check('刷新回到历史水位（红色的「本次」是会话内的，不写库）', s.done === 2 && s.bad === 0, s.chip)

/* ---------- 6. 从零重做清空 ---------- */
await cdp.evaluate(`return await window.forge.project.resetLevel('${pid}', '${lid}')`)
await cdp.reloadHard(2500)
await sleep(1200)
s = await state()
check('「从零重做」后阶段进度清空', s.done === 0 && s.active === 0, s.chip)

const consoleErrors = cdp.consoleErrors || []
check('无 console 报错', consoleErrors.length === 0, consoleErrors.slice(0, 2).map((e) => e.text).join(' | '))

restoreBackup()
// 还原成功才关连接；没成功就留给退出兜底再试
if (backupRestored) db.close()
await cdp.clearMetrics()
await cdp.close()

console.log(fail.length ? `\n❌ ${fail.length} 项失败：${fail.join('、')}` : '\n✅ 阶段进度持久化验证全部通过')
process.exit(fail.length ? 1 : 0)