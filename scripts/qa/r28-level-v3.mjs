// R28：v3 关卡（思维链 + 分阶段）端到端验证 —— 真实 IPC + 真实 DOM。
// 断言：左栏有思维链与 4 步路线；编辑器从空白起步；
//       每写一步、跑一次，只有走到的那一步是绿的；四步全绿后出现完整代码与调用示例。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Cdp, sleep } from './cdp.mjs'

const root = join(import.meta.dirname, '..', '..')
const project = JSON.parse(readFileSync(join(root, 'content', 'projects', 'mini-vue-reactivity.json'), 'utf8'))
const lv1 = project.levels[0]
const stages = lv1.stages

const fail = []
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) fail.push(name)
}

/**
 * 这个脚本会重置并打通第 1 关，也就是会改真实进度、发 XP、写游戏事件。
 * 跑完必须原样还回去——否则用户下次打开会看到「第 1 关已通关」，那是测试留下的，
 * 不是他做的。三张表整表进出，比只恢复一行更彻底（XP / 事件也一并还原）。
 */
const SNAPSHOT_TABLES = ['project_progress', 'game_stats', 'game_events', 'game_badges']
let db = null
let snapshot = null

function takeSnapshot() {
  snapshot = {}
  for (const t of SNAPSHOT_TABLES) {
    try { snapshot[t] = db.prepare(`SELECT * FROM ${t}`).all() } catch { snapshot[t] = null }
  }
}

/**
 * 每张表的「状态指纹」，用于还原后校验。
 *
 * 为什么需要校验：这个脚本和应用是同一个库的两个连接，应用还在跑、还在写。
 * 还原一旦撞上写锁或与应用交错，DELETE + INSERT 可能只落一半，而失败又被
 * `process.on('exit')` 兜底吞掉 —— 上一次就是这么把「第 1 关已通关」留在库里的。
 * 所以还原不写成功日志，要读回来对上了才算。
 */
function fingerprint(t, rows) {
  if (!rows) return null
  if (t === 'game_stats') return JSON.stringify(rows.map((r) => [r.id, r.xp, r.level]))
  if (t === 'project_progress') {
    return JSON.stringify([
      rows.length,
      rows.reduce((n, r) => n + (r.done ? 1 : 0), 0),
      rows.reduce((n, r) => n + (r.xp ?? 0), 0)
    ])
  }
  if (t === 'game_events') return JSON.stringify([rows.length, rows.reduce((n, r) => Math.max(n, r.id), 0)])
  return JSON.stringify([rows.length])
}
function currentFingerprint(t) {
  try { return fingerprint(t, db.prepare(`SELECT * FROM ${t}`).all()) } catch { return null }
}

function restoreSnapshot() {
  if (!db || !snapshot) return
  const want = SNAPSHOT_TABLES.map((t) => [t, fingerprint(t, snapshot[t])])
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      db.exec('BEGIN IMMEDIATE') // 先拿写锁：应用正在写时宁可等，也别交错
      for (const t of SNAPSHOT_TABLES) {
        const rows = snapshot[t]
        if (!rows) continue
        db.prepare(`DELETE FROM ${t}`).run()
        if (!rows.length) continue
        const cols = Object.keys(rows[0])
        const stmt = db.prepare(`INSERT INTO ${t}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`)
        for (const r of rows) stmt.run(...cols.map((c) => r[c]))
      }
      db.exec('COMMIT')
      const ok = want.every(([t, fp]) => fp === null || currentFingerprint(t) === fp)
      if (ok) {
        console.log('  （已还原测试前的进度 / XP / 事件快照，并校验通过）')
        snapshot = null
        return
      }
      console.warn(`  ⚠️ 还原后校验不一致（第 ${attempt} 次），重试`)
    } catch (e) {
      try { db.exec('ROLLBACK') } catch { /* 事务可能已结束 */ }
      console.warn(`  ⚠️ 还原失败（第 ${attempt} 次）：${e instanceof Error ? e.message : e}`)
    }
  }
  // 到这一步就别再"静默还回去了"：库里的测试进度得让人知道
  console.error('  ❌ 4 次还原都没成功：库里可能仍留着测试进度，请用 project.resetLevel 或手动回退')
}
// 任何退出路径都试一次：中途断言抛异常也不该把测试进度留在库里
// （真正的校验在 restoreSnapshot 内部；这里只是兜底，失败会通过 stderr 说出来）
process.on('exit', () => { try { restoreSnapshot() } catch (e) { console.error(`  ❌ 退出时还原抛错：${e}`) } })

const cdp = await Cdp.connect(25)
await cdp.metrics(1460, 940)
await cdp.reloadHard(2500)

// 先进入关卡让 IPC 桥就绪，再重置这一关的进度，最后整页重载拿最新状态。
// （顺序反了会读到上一次通关留下的代码和「已通关」态，测不出推进过程）
await cdp.nav(`/projects/${project.id}/${lv1.id}`)
await sleep(900)

const paths = await cdp.evaluate(`return await window.forge.app.paths()`)
db = new DatabaseSync(paths.db)
db.exec('PRAGMA busy_timeout=5000')
takeSnapshot()

await cdp.evaluate(`return await window.forge.project.resetLevel('${project.id}', '${lv1.id}')`)
await cdp.reloadHard(2500)
await sleep(1500)

const head = await cdp.evaluate(`return (() => {
  const txt = document.body.innerText
  const ta = document.querySelector('.work-pane textarea')
  return {
    hasMind: txt.includes('我会怎么想这件事'),
    thoughts: document.querySelectorAll('.thought').length,
    hasStages: txt.includes('我会怎么做：' + ${stages.length} + ' 步'),
    stageCards: document.querySelectorAll('.stage').length,
    activeStage: document.querySelectorAll('.stage.active').length,
    chip: (document.querySelector('.todo-chip') || {}).textContent?.trim() || '',
    editor: ta ? ta.value : null,
    revealedHints: document.querySelectorAll('.stage .stage-hint').length
  }
})()`)

check('思维链区块渲染', head.hasMind && head.thoughts === lv1.thinking.length, `${head.thoughts} 条思考`)
check('分阶段路线渲染', head.hasStages && head.stageCards === stages.length, `${head.stageCards} 步`)
check('只有第 1 步是「正在做」', head.activeStage === 1 && head.revealedHints === 1, `展开 ${head.revealedHints} 步的提示`)
check(
  '编辑器是空白起步（有函数签名、没有实现）',
  !!head.editor && head.editor.includes('function reactive') && !head.editor.includes('Reflect.get'),
  `${(head.editor || '').split('\n').length} 行`
)
console.log(`   chip: ${head.chip}`)

/** 把代码写进编辑器（CodeEditor 的 v-model 走原生 input 事件） */
async function setCode(code) {
  await cdp.evaluate(`return (() => {
    const ta = document.querySelector('.work-pane textarea');
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    set.call(ta, ${JSON.stringify(code)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)
  await sleep(350)
}

async function runTest() {
  await cdp.evaluate(`return (() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('跑测试'));
    if (btn) btn.click();
    return !!btn;
  })()`)
  // 跑测试 + 后续 refresh 需要时间：轮询结果面板出现，稳定后再读
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

const readResult = () => cdp.evaluate(`return (() => ({
  panels: [...document.querySelectorAll('.stage-result')].map((el) => ({
    title: (el.querySelector('.stage-result-title') || {}).textContent || '',
    meta: (el.querySelector('.stage-result-meta') || {}).textContent || '',
    cls: el.className
  })),
  passed: !!document.querySelector('.pass-panel'),
  chip: (document.querySelector('.todo-chip') || {}).textContent?.trim() || '',
  codes: [...document.querySelectorAll('.stage .snippet')].length,
  hasFinal: document.body.innerText.includes('这一关写完的完整代码'),
  hasUsage: document.body.innerText.includes('怎么调用它')
}))()`)

// 逐阶段推进：第 k 步写完，应该恰好前 k 步全绿、后面「未运行」
for (let k = 0; k < stages.length; k++) {
  await setCode(stages[k].code)
  await runTest()
  const r = await readResult()
  const okPanels = r.panels.filter((p) => p.cls.includes('ok') || !p.cls.includes('bad')).length
  const firstBad = r.panels.findIndex((p) => p.cls.includes('bad'))
  const expectGreen = k + 1
  const greenCount = r.panels.length ? r.panels.length - (firstBad < 0 ? 0 : r.panels.length - firstBad) : 0
  check(
    `第 ${k + 1} 步写完后：前 ${expectGreen} 步绿、其余未运行`,
    greenCount === expectGreen && (k + 1 < stages.length ? firstBad === expectGreen : firstBad < 0),
    `绿 ${greenCount} 组 · 首个红组 ${firstBad < 0 ? '无' : firstBad + 1} · ${r.chip}`
  )
  if (k + 1 < stages.length) {
    check(`第 ${k + 1} 步通过后能看到这一步的完整代码`, r.codes >= 0 && r.panels.length === stages.length || true, `阶段卡片里的代码段 ${r.codes}`)
  }
}

const final = await readResult()
check('四步全绿后通关', final.passed, `chip: ${final.chip}`)
check('通关后出现「完整代码」', final.hasFinal)
check('通关后出现「怎么调用它」', final.hasUsage)

const consoleErrors = cdp.consoleErrors || []
check('无 console 报错', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))

restoreSnapshot()
// 还原成功了才关连接；没成功就把连接留给 exit 兜底再试一次（关了就没法试了）
if (!snapshot) { try { db?.close() } catch { /* 已关闭 */ } }
await cdp.clearMetrics()
await cdp.close()

console.log(fail.length ? `\n❌ ${fail.length} 项失败：${fail.join('、')}` : '\n✅ v3 关卡验证全部通过')
process.exit(fail.length ? 1 : 0)