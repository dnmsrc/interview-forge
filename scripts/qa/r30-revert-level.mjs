// R30：「退回未通关」按钮端到端验证 —— 真实 IPC + 真实 DOM。
//
// 验证的是这一条链路：关卡页在「已通关」时出现退回按钮 → 点击 → 主进程只清 done/passed_at
// → 页面重新载入（代码、草稿、阶段进度都还在）→ 下一关重新上锁。
//
// 数据安全：只临时把 lv1 的 done 置 1 来制造「已通关」态，测完无论如何都恢复成测前的 done。
// 不碰 game_stats / game_events（revertLevel 本身就不该动 XP，这里顺带验证这一点）。
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

const paths = await cdp.evaluate(`return await window.forge.app.paths()`)
const db = new DatabaseSync(paths.db)
db.exec('PRAGMA busy_timeout=5000')
const rowOf = () => db.prepare(
  `SELECT done, passed_at, draft_code, attempts, stage_done FROM project_progress WHERE project_id=? AND level_id=?`
).get(PID, LID)

const baseline = rowOf()
console.log('测前 lv1：', JSON.stringify({ ...baseline, draft_code: baseline?.draft_code ? '…' + baseline.draft_code.length + ' 字符' : null }))
const statsBefore = db.prepare('SELECT xp, level FROM game_stats WHERE id=1').get()
const eventsBefore = db.prepare('SELECT COUNT(*) c FROM game_events').get().c

let restored = false
function restore() {
  if (restored) return
  restored = true
  if (!baseline) return
  db.prepare(`UPDATE project_progress SET done=?, passed_at=? WHERE project_id=? AND level_id=?`)
    .run(baseline.done, baseline.passed_at, PID, LID)
  const r = rowOf()
  console.log(`  （已把 lv1 的 done 恢复为 ${r.done}）`)
}
process.on('exit', () => { try { restore() } catch { /* 库已关 */ } })

// 先把 lv1 标记为已通关（模拟「通关是测试跑出来的」），并清掉 lv2 的进度让「解锁」可判
db.prepare(`UPDATE project_progress SET done=1, passed_at=datetime('now','localtime') WHERE project_id=? AND level_id=?`).run(PID, LID)
db.prepare(`DELETE FROM project_progress WHERE project_id=? AND level_id=?`).run(PID, LID2)

await cdp.nav(`/projects/${PID}/${LID}`)
await cdp.reloadHard(2500)
await sleep(1200)

// 1) 已通关时按钮在
const btn = await cdp.evaluate(`return (() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('退回未通关'))
  return b ? { text: b.textContent.trim(), disabled: b.disabled, visible: b.offsetParent !== null } : null
})()`)
check('已通关时出现「退回未通关」按钮', !!btn?.visible, btn ? btn.text : '没找到')

const passedPill = await cdp.evaluate(`return [...document.querySelectorAll('.pill')].some((p) => p.textContent.includes('已通关'))`)
check('页面同时显示「已通关」标记', passedPill === true)

// 2) 编辑器里的代码（CodeEditor 是自己写的 textarea.ce-ta，不是 Monaco —— 项目有意不用 Monaco）
// 注意：已通关的关卡下方还会渲染「完整代码」和「参考答案」两个 readonly CodeEditor，
// 它们也是 .ce-ta；只用可编辑的那个（.ce:not(.is-ro)），否则会把参考实现当成长度基准。
// 页面 load 完后才会把草稿灌进编辑器，取太早会拿到挂载前的空值，所以重试到稳定。
const readEditor = `[...document.querySelectorAll('.ce:not(.is-ro) textarea.ce-ta')].map((t) => t.value).join('\\n')`
let codeBefore = ''
for (let i = 0; i < 6; i++) {
  codeBefore = await cdp.evaluate(`return ${readEditor}`)
  if (codeBefore && codeBefore === (baseline?.draft_code ?? '')) break
  await sleep(700)
}
check('已通关时编辑器里是他自己的那份草稿', !!codeBefore && codeBefore === (baseline?.draft_code ?? ''),
  `${codeBefore.length} 字符 / 库里 ${(baseline?.draft_code ?? '').length}`)

// 3) 点按钮 → 确认弹窗 → 点「退回」
await cdp.evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('退回未通关'))
  b.click()
})()`)
await sleep(500)
const dlg = await cdp.evaluate(`return (() => {
  const d = document.querySelector('.n-dialog')
  if (!d) return null
  return { title: d.querySelector('.n-dialog__title')?.textContent?.trim(), actions: [...d.querySelectorAll('.n-dialog__action button')].map((b) => b.textContent.trim()) }
})()`)
check('点了要有确认弹窗（不是一点就退）', !!dlg, dlg ? `${dlg.title} / ${dlg.actions.join(',')}` : '无弹窗')

const clicked = await cdp.evaluate(`return (() => {
  const d = document.querySelector('.n-dialog')
  if (!d) return false
  const b = [...d.querySelectorAll('.n-dialog__action button')].find((x) => x.textContent.trim() === '退回')
  if (!b) return false
  b.click()
  return true
})()`)
check('弹窗里有「退回」按钮并点击', clicked === true)
await sleep(1500)

// 4) 库里的状态
const after = rowOf()
check('库里 done 已清 0', after.done === 0, `done=${after.done}`)
check('passed_at 已清空', after.passed_at === null, String(after.passed_at))
check('草稿原样保留', (after.draft_code ?? '') === (baseline?.draft_code ?? ''), `${(after.draft_code ?? '').length} 字符`)
check('attempts / 阶段进度未被退回改动', after.attempts === baseline?.attempts && (after.stage_done ?? null) === (baseline?.stage_done ?? null))

// 5) 页面上的表现
const uiAfter = await cdp.evaluate(`return (() => {
  const txt = document.body.innerText
  const btn = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('退回未通关'))
  return {
    hasDonePill: [...document.querySelectorAll('.pill')].some((p) => p.textContent.includes('已通关')),
    hasBtn: !!btn,
    bodyHasDone: txt.includes('已通关')
  }
})()`)
check('页面上「已通关」标记消失', uiAfter.hasDonePill === false && uiAfter.bodyHasDone === false, JSON.stringify(uiAfter))
check('退回按钮随之消失', uiAfter.hasBtn === false)

const codeAfter = await cdp.evaluate(`return ${readEditor}`)
check('编辑器里的代码还在（退回 != 重置）', !!codeBefore && codeAfter === codeBefore,
  `前 ${codeBefore.replace(/\s+/g, '').length} / 后 ${codeAfter.replace(/\s+/g, '').length} 个非空白字符`)

// 6) 下一关重新上锁
const nextLocked = await cdp.evaluate(`return (async () => {
  const d = await window.forge.project.detail('${PID}')
  const lv2 = d.levels.find((l) => l.id === '${LID2}')
  return { unlocked: lv2?.unlocked, done: lv2?.done }
})()`)
check('退回后第 2 关重新上锁', nextLocked.unlocked === false, JSON.stringify(nextLocked))

// 7) XP / 事件完全没动
const statsAfter = db.prepare('SELECT xp, level FROM game_stats WHERE id=1').get()
const eventsAfter = db.prepare('SELECT COUNT(*) c FROM game_events').get().c
check('XP / 等级不受退回影响', statsAfter.xp === statsBefore.xp && statsAfter.level === statsBefore.level, `${statsBefore.xp}→${statsAfter.xp}`)
check('游戏事件没有被退回删除', eventsAfter === eventsBefore, `${eventsBefore}→${eventsAfter}`)

// 8) 闯关地图上也要看到"未通关"（地图是另一条读库路径）
const board = await cdp.evaluate(`return (async () => {
  const d = await window.forge.project.list()
  const c = (d || []).find((p) => p.id === '${PID}')
  return c ? { doneCount: c.doneCount, levelCount: c.levelCount, finished: c.finished, nextLevelId: c.nextLevelId } : null
})()`)
check('项目卡片统计随之回退',
  board ? board.doneCount === 0 && board.finished === false && board.nextLevelId === LID : false,
  JSON.stringify(board))

console.log('')
if (fail.length) console.log(`❌ ${fail.length} 项未通过: ${fail.join(' / ')}`)
else console.log('✅ 全部通过')

restore()
db.close()
process.exit(fail.length ? 1 : 0)