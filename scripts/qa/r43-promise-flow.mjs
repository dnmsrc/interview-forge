// R43：新项目「手写 Promise」端到端 —— 分阶段推进 + async 检查点 + 通关面板。
//
// 为什么专门挑 promise-aplus：
//   1) 它的检查点是 async 的（`check('...', async () => { await p })`），走的是沙箱里
//      「Promise 回调」这条与同步关卡不同的判定路径，值得在真实 UI 里验一遍；
//   2) 它是这一批新项目里唯一 3 关都依赖微任务的，最容易在真实环境里「测试挂住」。
//
// 注意：这一步的完整代码（stages[k].code）**不能**从 IPC 拿 —— 服务端只在「这一步已通过 /
// 已解锁答案」时才下发 code，未通过时是 null。QA 要预置正确答案，只能从构建产物 JSON 里读。
//
// 会改真实进度（resetLevel + 通关一条新关卡），所以整段跑在「快照 → 还原」里：
// 跑前把 project_progress / game_stats / game_events / game_badges 四张表整表存下来，
// 退出时（含异常退出）原样写回并校验指纹，用户不会看到测试留下的通关和 XP。
// 与 r28 用同一套还原实现 —— 应用与脚本是同一个库的两个连接，还原必须校验读回结果。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Cdp, sleep } from './cdp.mjs'

const root = join(import.meta.dirname, '..', '..')
const pid = 'promise-aplus'
const JSON_LV = JSON.parse(readFileSync(join(root, 'content', 'projects', `${pid}.json`), 'utf8'))
const jsonLevel = JSON_LV.levels[0]
const stages = jsonLevel.stages
const lvId = jsonLevel.id

const fail = []
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) fail.push(name)
}

/* ===== 进度快照 / 还原（同 r28） ===== */
const SNAPSHOT_TABLES = ['project_progress', 'game_stats', 'game_events', 'game_badges']
let db = null
let snapshot = null

function takeSnapshot() {
  snapshot = {}
  for (const t of SNAPSHOT_TABLES) {
    try { snapshot[t] = db.prepare(`SELECT * FROM ${t}`).all() } catch { snapshot[t] = null }
  }
}
function fingerprint(t, rows) {
  if (!rows) return null
  if (t === 'game_stats') return JSON.stringify(rows.map((r) => [r.id, r.xp, r.level]))
  if (t === 'project_progress') {
    return JSON.stringify([rows.length, rows.reduce((n, r) => n + (r.done ? 1 : 0), 0), rows.reduce((n, r) => n + (r.xp ?? 0), 0)])
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
      db.exec('BEGIN IMMEDIATE')
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
      if (want.every(([t, fp]) => fp === null || currentFingerprint(t) === fp)) {
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
  console.error('  ❌ 4 次还原都没成功：库里可能仍留着测试进度，请用 project.resetLevel 或手动回退')
}
process.on('exit', () => { try { restoreSnapshot() } catch (e) { console.error(`  ❌ 退出时还原抛错：${e}`) } })

const cdp = await Cdp.connect(25)
await cdp.metrics(1460, 940)
await cdp.reloadHard(2500)

const call = (body) => cdp.evaluate(`return await (${body})()`)
const detail = () => call(`async () => window.forge.project.detail(${JSON.stringify(pid)})`)
const level = async () => (await detail()).levels.find((l) => l.id === lvId)
const reset = () => call(`async () => window.forge.project.resetLevel(${JSON.stringify(pid)}, ${JSON.stringify(lvId)})`)
const snapsKey = `lf.stepSnaps.${pid}.${lvId}`
const clearSnaps = () => cdp.evaluate(`localStorage.removeItem(${JSON.stringify(snapsKey)}); return 1`)

async function typeCode(code) {
  await cdp.evaluate(`
    const ta = document.querySelector('textarea.ce-ta')
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    set.call(ta, ${JSON.stringify(code)})
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    return 1
  `)
  await sleep(400)
}

/** 点「下一步」并等结果面板稳定（运行中 → 结果出现） */
async function runOnce() {
  const clicked = await cdp.evaluate(`
    const b = [...document.querySelectorAll('button')].find((x) => !x.disabled && (x.textContent || '').trim() === '下一步')
    if (!b) return false
    b.click(); return true
  `)
  if (!clicked) throw new Error('找不到可点的「下一步」')
  await cdp.waitFor(`[...document.querySelectorAll('.result .fb')].length > 0`, 40000, '结果面板出现')
  await cdp.waitFor(
    `[...document.querySelectorAll('.work-toolbar button')].some((b) => /^下一步$/.test((b.textContent || '').trim()))`,
    40000,
    '运行结束'
  )
  await sleep(500)
}

const ui = () => cdp.evaluate(`
  const txt = (el) => el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : ''
  return {
    chip: txt(document.querySelector('.todo-chip')),
    tabs: [...document.querySelectorAll('.stage-switch .stage-tab')].map((b) => ({
      t: txt(b), now: b.classList.contains('now'), done: b.classList.contains('done'), disabled: b.disabled
    })),
    groups: [...document.querySelectorAll('.stage-result')].map((el) => ({
      title: txt(el.querySelector('.stage-result-title')),
      bad: el.querySelectorAll('.case.bad').length,
      ok: el.querySelectorAll('.case.ok').length,
      diag: el.querySelectorAll('.case-diag').length
    })),
    passed: !!document.querySelector('.pass-panel'),
    hasFinal: document.body.innerText.includes('这一关写完的完整代码'),
    hasUsage: document.body.innerText.includes('怎么调用它')
  }
`)

/** 结果面板里「第 n 步」那一组的统计 */
function groupOf(u, n) {
  return u.groups.find((g) => new RegExp(`第 ${n} 步`).test(g.title))
}

/* ========== 准备：干净的第 1 步 ========== */
await cdp.nav(`/projects/${pid}/${lvId}`)
await cdp.waitFor(`!!document.querySelector('.work-toolbar')`, 25000, '关卡页')

// 进度已加载、IPC 桥就绪之后再做快照，命中正确的库
const paths = await cdp.evaluate(`return await window.forge.app.paths()`)
db = new DatabaseSync(paths.db)
db.exec('PRAGMA busy_timeout=5000')
takeSnapshot()

await reset()
await clearSnaps()
await cdp.reloadHard(2600)
await cdp.waitFor(`!!document.querySelector('.work-toolbar')`, 25000, '重载后的关卡页')
await sleep(900)

const start = await ui()
check('关卡从第 1 步开始', /第 1 \/ 3 步/.test(start.chip), start.chip)
check('步骤条 3 个 tab，只有第 1 个是「现在」', start.tabs.length === stages.length && start.tabs[0].now && start.tabs.filter((t) => t.now).length === 1, `${start.tabs.length} 个`)

/* ========== A. 骨架直接跑：应当红，且不推进 ========== */
await runOnce()
const bare = await ui()
check('骨架直接跑会红（有活可干）', bare.groups.some((g) => g.bad > 0), `${bare.groups.map((g) => `${g.ok}绿/${g.bad}红`).join(' ')}`)
check('跑红不推进步骤', /第 1 \/ 3 步/.test(bare.chip), bare.chip)
check('骨架下不提前摊开 diag（没动笔就先不给答案）', bare.groups.every((g) => g.diag === 0))

/* ========== B. 改了但还是错：diag 要摊开 ========== */
// 把第 1 步里「resolve 时改状态」那一行去掉：语法仍然正确，但状态不会变
const broken = stages[0].code.replace(/this\.__state = 'fulfilled'\n/g, '')
await typeCode(broken)
await runOnce()
const withDiag = await ui()
const g1 = groupOf(withDiag, 1)
check('改过之后仍是红的（说明真的在跑这份代码）', !!g1 && g1.bad > 0, g1 ? `${g1.ok}绿/${g1.bad}红` : '没有第 1 步结果组')
check('失败用例带 diag（告诉人最可能少写了什么）', !!g1 && g1.diag === g1.bad, g1 ? `${g1.diag} 条 diag / ${g1.bad} 条红` : '')
check('红的这次也不推进', /第 1 \/ 3 步/.test(withDiag.chip), withDiag.chip)

/* ========== C. 逐阶段推进（每题都走 async 检查点） ========== */
for (let k = 0; k < stages.length; k++) {
  await typeCode(stages[k].code)
  await runOnce()
  const u = await ui()
  const lvNow = await level()
  check(`第 ${k + 1} 步记入 stageDone（服务端）`, lvNow.stageDone.includes(k + 1), `[${lvNow.stageDone}]`)
  if (k + 1 < stages.length) {
    // 这一步过了之后，结果面板展示的是「下一步还没开始写」——它的红是预期，不是失败
    const next = groupOf(u, k + 2)
    check(`推到了第 ${k + 2} 步（面板提示下一步未开始）`, new RegExp(`第 ${k + 2} / 3 步`).test(u.chip) && !!next, u.chip)
  } else {
    const g = groupOf(u, k + 1)
    check(`第 ${k + 1} 步写完 → 本步检查点全绿`, !!g && g.bad === 0 && g.ok > 0, g ? `${g.ok}绿/${g.bad}红` : '无结果组')
  }
}

const final = await ui()
const lvFinal = await level()
check('3 步走完 → 本关通关', final.passed && lvFinal.done === true, `done=${lvFinal.done}`)
check('通关后出现完整代码', final.hasFinal)
check('通关后出现调用示例', final.hasUsage)
check('服务端把 3 步都记为通过', lvFinal.stageDone.length === stages.length, `[${lvFinal.stageDone}]`)

/* ========== D. 通关状态在刷新后保持 ========== */
await cdp.reloadHard(2600)
await cdp.waitFor(`!!document.querySelector('.work-toolbar')`, 25000, '刷新后的关卡页')
await sleep(900)
const afterReload = await call(`async () => {
  const d = await window.forge.project.detail(${JSON.stringify(pid)})
  const l = d.levels.find((x) => x.id === ${JSON.stringify(lvId)})
  return { done: l.done, stageDone: l.stageDone }
}`)
check('刷新后仍是已通关 + 3 步都通过', afterReload.done === true && afterReload.stageDone.length === stages.length, JSON.stringify(afterReload))

await cdp.shot('data/qa/r43-promise-passed.png')

const consoleErrors = (cdp.consoleErrors || []).slice(0, 3)
check('无 console 报错', consoleErrors.length === 0, consoleErrors.join(' | '))

await reset()
await clearSnaps()
restoreSnapshot()
// 还原成功了才关库；没成功就留给 exit 兜底再试一次
if (!snapshot) { try { db?.close() } catch { /* 已关闭 */ } }
await cdp.clearMetrics()
await cdp.close()
console.log(fail.length ? `\n❌ ${fail.length} 项失败：${fail.join('、')}` : '\n✅ 手写 Promise 端到端全部通过')
process.exit(fail.length ? 1 : 0)