// R31b：老式关卡（没有 stages 的第 2-9 关）重排后的首屏 —— 任务陈述在最前，
// 动手步骤紧跟其后，why / 思维链 / 前置知识 / API 收进折叠区。
//
// 数据安全：只为让第 2 关解锁而临时把 lv1 的 done 置 1，测完必须恢复原值并在退出时兜底。
// 全程不改 XP / 事件，也不改亮格草稿。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Cdp, sleep } from './cdp.mjs'

const root = join(import.meta.dirname, '..', '..')
const project = JSON.parse(readFileSync(join(root, 'content', 'projects', 'mini-vue-reactivity.json'), 'utf8'))
const PID = project.id
const LID = project.levels[0].id
const LID2 = project.levels[1].id

const fail = []
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) fail.push(name)
}

const cdp = await Cdp.connect(25)
await cdp.metrics(1460, 940)
cdp.clearErrors()

const paths = await cdp.evaluate(`return await window.forge.app.paths()`)
const db = new DatabaseSync(paths.db)
db.exec('PRAGMA busy_timeout=5000')
const rowOf = () => db.prepare(
  `SELECT done, passed_at FROM project_progress WHERE project_id=? AND level_id=?`
).get(PID, LID)

const baseline = rowOf()
console.log(`测前 lv1：done=${baseline?.done} passed_at=${baseline?.passed_at}`)

let restored = false
function restore() {
  if (restored) return
  restored = true
  db.prepare(`UPDATE project_progress SET done=?, passed_at=? WHERE project_id=? AND level_id=?`)
    .run(baseline?.done ?? 0, baseline?.passed_at ?? null, PID, LID)
  const r = rowOf()
  console.log(`  恢复 lv1 → done=${r?.done} passed_at=${r?.passed_at}`)
}
process.on('exit', () => { try { restore() } catch { /* 库已关 */ } })

db.prepare(`UPDATE project_progress SET done=1 WHERE project_id=? AND level_id=?`).run(PID, LID)

await cdp.nav(`/projects/${PID}/${LID2}`)
await cdp.reloadHard(2600)
await sleep(1500)

const info = await cdp.evaluate(`return (() => {
  const vis = (el) => !!el && el.getClientRects().length > 0
  const top = (el) => el ? Math.round(el.getBoundingClientRect().top) : -1
  const goal = document.querySelector('.task-pane .goal')
  const steps = document.querySelector('.task-pane .steps')
  const fold = document.querySelector('.fold-info')
  const foldOpen = [...document.querySelectorAll('.fold-info details')].filter((d) => d.open)
    .map((d) => d.querySelector('summary')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '')
  return {
    hasNow: !!document.querySelector('.now-step'),
    goalVisible: vis(goal),
    goalTop: top(goal),
    goalCap: goal?.querySelector('.goal-cap')?.textContent?.trim() ?? '',
    stepsVisible: vis(steps),
    stepsTop: top(steps),
    stepCount: document.querySelectorAll('.task-pane .steps .step').length,
    foldCount: document.querySelectorAll('.fold-info details').length,
    foldOpen,
    foldSummaries: [...document.querySelectorAll('.fold-info details summary')].map((s) => s.textContent.replace(/\\s+/g, ' ').trim()),
    editorVisible: vis(document.querySelector('.ce:not(.is-ro) textarea.ce-ta')),
    locked: document.body.innerText.includes('这一关还没解锁'),
  }
})()`)

check('第 2 关已可打开（不是锁定页）', info.locked === false)
check('老式关卡没有「当前这一步」卡片', info.hasNow === false)
check('任务陈述在最前且可见', info.goalVisible === true && info.goalTop >= 0 && info.goalTop < 400,
  `top=${info.goalTop}px / ${info.goalCap}`)
check('动手步骤紧跟任务陈述（不被折叠区挡在后面）',
  info.stepsVisible === true && info.stepsTop > info.goalTop && info.stepsTop - info.goalTop < 420,
  `goal ${info.goalTop}px → steps ${info.stepsTop}px，共 ${info.stepCount} 步`)
check('why / 思维链 / 前置知识 / API 收成折叠项', info.foldCount >= 3, `${info.foldCount} 个：${info.foldSummaries.join(' | ')}`)
check('折叠项默认全部收起', info.foldOpen.length === 0, info.foldOpen.join(' | ') || '全部收起')
check('编辑器可见', info.editorVisible === true)

await cdp.shot(join(root, 'data', 'qa', 'r31b-lv2.png'))

const errs = cdp.errors()
check('控制台没有报错', errs.length === 0, errs.slice(0, 2).join(' | '))

// 收尾：把页面带回第 1 关并恢复数据
restore()
await cdp.nav(`/projects/${PID}/${LID}`)
await cdp.reloadHard(2000)
await sleep(600)
const back = await cdp.evaluate(`return (() => {
  const t = document.body.innerText
  return { done: t.includes('已通关'), locked2: t.includes('还没解锁') }
})()`)
check('恢复后第 1 关仍是未通关状态', back.done === false, JSON.stringify(back))

db.close()
await cdp.close()
console.log(fail.length ? `\n❌ ${fail.length} 项未过：${fail.join('、')}` : '\n✅ 全部通过')
process.exitCode = fail.length ? 1 : 0