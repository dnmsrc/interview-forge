// R32：两个用户反馈的回归 ——
//
// 1) 「项目不存在」红条：从关卡页退出去时，watch([projectId,levelId]) 会以空 id 再拉一次详情。
//    现在守卫拦住了（空 id 不发 IPC），这里用主进程日志里 handler 报错的增量来判定。
// 2) 「重置」不退回步骤：老的重置只把编辑器换成骨架，stage_done 一行没动。
//    现在「重做」走 resetLevel，清 draft/stage/done/attempts，界面应回到第 1 步。
//
// 数据安全：测前备份 lv1 整行（所有列），测完原样写回，并复查 stage_done 恢复。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Cdp, sleep } from './cdp.mjs'

const root = join(import.meta.dirname, '..', '..')
const project = JSON.parse(readFileSync(join(root, 'content', 'projects', 'mini-vue-reactivity.json'), 'utf8'))
const PID = project.id
const LID = project.levels[0].id
const LID2 = project.levels[1].id
const LOG = process.env.LOG || join(root, 'data', 'r32-dev.log')

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
const COLS = ['project_id', 'level_id', 'done', 'attempts', 'draft_code', 'draft_base', 'stage_done', 'stage_base', 'passed_at']
const COMPARE = COLS.filter((c) => c !== 'updated_at')
const pick = (r) => JSON.stringify(Object.fromEntries(COMPARE.map((c) => [c, r?.[c] ?? null])))
const rowOf = () => db.prepare(`SELECT * FROM project_progress WHERE project_id=? AND level_id=?`).get(PID, LID)
const baseline = rowOf()
const before = pick(baseline)
console.log('测前 lv1：', JSON.stringify({
  done: baseline?.done, attempts: baseline?.attempts, stage_done: baseline?.stage_done,
  draft: baseline?.draft_code ? `${baseline.draft_code.length} 字符` : null
}))

let restoreCount = 0
/**
 * 还原测前状态。有两种测前：
 * - 库里本来就有这一关的行 → 逐字段写回原值；
 * - 库里没有（用户把项目「从零重做」清空了，或本来就是全新）→ 把本脚本造出来的夹具行删掉，
 *   回到「这一关没做过」的干净状态，别把测试留的 stage_done / MARK 字符留在用户库里。
 */
function restore() {
  restoreCount++
  if (!baseline) {
    db.prepare(`DELETE FROM project_progress WHERE project_id=? AND level_id=?`).run(PID, LID)
    if (restoreCount === 1) console.log('  （测前库里没有这一关的行：已删掉夹具，回到未开始状态）')
    return
  }
  db.prepare(`UPDATE project_progress SET ${COLS.filter((c) => c !== 'project_id' && c !== 'level_id').map((c) => `${c}=?`).join(',')}
              WHERE project_id=? AND level_id=?`)
    .run(...COLS.filter((c) => c !== 'project_id' && c !== 'level_id').map((c) => baseline[c]), PID, LID)
  const r = rowOf()
  if (restoreCount === 1) {
    console.log(`  （已恢复 lv1：done=${r.done} attempts=${r.attempts} stage_done=${r.stage_done} draft=${r.draft_code ? r.draft_code.length + ' 字符' : null}）`)
  }
  if (pick(r) !== before) console.log('  ⚠️ 恢复后与测前不完全一致，请人工核对')
}
process.on('exit', () => { try { if (restoreCount === 0) restore() } catch { /* 库已关 */ } })

/** 主进程日志里 project.detail 的报错次数 */
const handlerErrors = () => {
  try {
    const txt = readFileSync(LOG, 'utf8')
    return (txt.match(/Error occurred in handler for 'project\.detail'/g) || []).length
  } catch { return -1 }
}

/* ---------- 1. 报错回归：进关卡 → 回地图 → 回列表 ---------- */
const errs0 = handlerErrors()
await cdp.nav(`/projects/${PID}/${LID}`)
await cdp.reloadHard(2600)
await sleep(1200)
await cdp.nav(`/projects/${PID}`)
await sleep(1200)
await cdp.nav('/projects')
await sleep(1200)
await cdp.nav('/')
await sleep(1200)
const errs1 = handlerErrors()
check('退出关卡页不再触发「项目不存在」', errs1 - errs0 === 0,
  `主进程 detail 报错 ${errs0} → ${errs1}${errs0 < 0 ? '（日志不可读）' : ''}`)

const leftover = await cdp.evaluate(`return [...document.querySelectorAll('.n-message, .toast, [class*="toast"]')].map((e) => e.textContent.trim()).filter(Boolean)`)
check('界面上没有残留的错误提示条', !leftover.some((t) => t.includes('项目不存在')), leftover.join(' | ') || '无')

/* ---------- 2. 重做：把 lv1 弄成「过了一步」再点重做 ---------- */
const stages = project.levels[0].stages ?? []
const expectedSkeleton = project.levels[0].skeleton
// 造「半途」夹具时必须复用库里那条真实的 stage_base：服务端只认
// 「stage_base === 当前内容算出的阶段指纹」的 stage_done，随便写个串会被判为旧进度而忽略
// （第一版脚本就踩了这个坑：塞了 'seed-for-test'，页面照样显示第 1 步）。
const hadProgress = baseline?.stage_done && JSON.parse(baseline.stage_done).length > 0 && !!baseline?.stage_base
// 库里连行都没有（用户刚点过「从零重做」）：先真跑一次骨架，让服务端把行连同
// stage_base 指纹建出来；手工 UPDATE 建不出正确指纹，页面会把它当旧进度忽略。
if (!baseline) {
  await cdp.evaluate(`return await window.forge.project.run(${JSON.stringify(PID)}, ${JSON.stringify(LID)}, ${JSON.stringify(project.levels[0].skeleton)})`)
  console.log('  （库里没有这一关的行：已真跑一次骨架建立夹具）')
}
if (!hadProgress) {
  db.prepare(`UPDATE project_progress SET stage_done=?, attempts=3 WHERE project_id=? AND level_id=?`)
    .run(JSON.stringify([1]), PID, LID)
}

await cdp.nav(`/projects/${PID}/${LID}`)
await cdp.reloadHard(2600)
await sleep(1600)

const readChip = `return document.querySelector('.todo-chip')?.textContent?.trim() ?? ''`
const readNowTitle = `return document.querySelector('.now-step .now-title')?.textContent?.trim() ?? document.querySelector('.now-step h3')?.textContent?.trim() ?? ''`
const readEditor = `return [...document.querySelectorAll('.ce:not(.is-ro) textarea.ce-ta')].map((t) => t.value).join('\\n')`

const chipBefore = await cdp.evaluate(readChip)
const startsAt2 = /第\s*2\s*\/\s*\d+\s*步/.test(chipBefore)
check('测前页面显示「在第 2 步」（有一步已过）', startsAt2, chipBefore || '无 chip')

// 点「从头做这关」
const hasBtn = await cdp.evaluate(`return [...document.querySelectorAll('button')].some((b) => (b.textContent || '').trim() === '从头做这关')`)
check('工具栏有「从头做这关」按钮', hasBtn === true)
await cdp.evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '从头做这关')
  b.click()
})()`)
await sleep(600)

const dlg = await cdp.evaluate(`return (() => {
  const d = document.querySelector('.n-dialog')
  if (!d) return null
  return { title: d.querySelector('.n-dialog__title')?.textContent?.trim(),
           body: d.querySelector('.n-dialog__content')?.textContent?.trim(),
           actions: [...d.querySelectorAll('.n-dialog__action button')].map((b) => b.textContent.trim()) }
})()`)
check('点重做先要二次确认', !!dlg, dlg ? `${dlg.title} / ${dlg.actions.join(',')}` : '无弹窗')
check('弹窗说清了会清掉什么', !!dlg && /骨架/.test(dlg.body || '') && /步骤|待开始/.test(dlg.body || ''), dlg?.body?.slice(0, 60) ?? '')

const clicked = await cdp.evaluate(`return (() => {
  const d = document.querySelector('.n-dialog')
  if (!d) return false
  const b = [...d.querySelectorAll('.n-dialog__action button')].find((x) => x.textContent.trim() === '从零重做')
  if (!b) return false
  b.click()
  return true
})()`)
check('弹窗里有「从零重做」并已点击', clicked === true)
await sleep(2600)

/* ---------- 3. 界面回退 ---------- */
const chipAfter = await cdp.evaluate(readChip)
check('步骤回到第 1 步', /第\s*1\s*\/\s*\d+\s*步/.test(chipAfter) && /已过\s*0\s*步/.test(chipAfter), chipAfter || '无 chip')

const nowTitle = await cdp.evaluate(readNowTitle)
check('首屏「现在做这一步」指向第 1 步', (nowTitle || '').includes(stages[0]?.title ?? '') || nowTitle === '', `${nowTitle} / 期望含「${stages[0]?.title}」`)

const stageRows = await cdp.evaluate(`return [...document.querySelectorAll('.stage-acc')].map((el) => ({
  n: el.querySelector('.stage-n')?.textContent?.trim(),
  state: el.querySelector('.stage-flag')?.textContent?.trim()
}))`)
check('四步全部退回「待开始」或「正在做」（无「已通过」）',
  stageRows.length === stages.length && !stageRows.some((r) => /已通过/.test(r.state || '')),
  stageRows.map((r) => `${r.n}:${r.state}`).join(' '))

const codeNow = await cdp.evaluate(readEditor)
check('编辑器换回起始骨架', codeNow === expectedSkeleton, `${codeNow.length} 字符 / 骨架 ${expectedSkeleton.length}`)

const after = rowOf()
check('库里 done 清 0', after.done === 0, `done=${after.done}`)
check('库里 stage_done 清空', !after.stage_done || JSON.parse(after.stage_done).length === 0, `stage_done=${after.stage_done}`)
check('库里 attempts 归零', after.attempts === 0, `attempts=${after.attempts}`)

/* ---------- 4. 改完代码立刻切走，草稿不能丢 ---------- */
// 防抖 800ms 内就离开关卡页：此刻 route.params 已空，旧实现会用空 id 去 saveDraft，
// 静默失败 —— 用户回来看到的是上一次的代码。
const MARK = `/*R32-DRAFT-MARK-${Date.now()}*/\nfunction reactive(target) { return target }`
await cdp.evaluate(`return (() => {
  const ta = document.querySelector('.work-pane textarea')
  if (!ta) return false
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  set.call(ta, ${JSON.stringify(MARK)})
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)
// 不 sleep：就是要「人刚敲完手就点了返回」
await cdp.nav(`/projects/${PID}`)
await sleep(1800)
const draftNow = rowOf()
check('离开页面后草稿仍被保存（不丢手打的内容）',
  !!draftNow.draft_code && draftNow.draft_code.includes('R32-DRAFT-MARK'),
  draftNow.draft_code ? `${draftNow.draft_code.length} 字符` : '草稿为空')

/* ---------- 5. 恢复用户原状态 ---------- */
restore()
// 页面还活着，code 变量一变就会 800ms 后回写草稿（重做把编辑器换成了骨架，算一次变化），
// 所以等它写完再第二次恢复：否则「用户原草稿」会被骨架这一版覆盖掉。
await sleep(1600)
restore()
// 再刷一次让界面跟库对齐（页面从库里读回草稿，code 与 loadedDraft 相同就不会回写）
await cdp.reloadHard(2600)
await sleep(1400)
const back = rowOf()
check('恢复后 lv1 与测前完全一致', pick(back) === before, pick(back) === before ? '' : `\n  测前 ${before}\n  现在 ${pick(back)}`)

console.log(`\n${fail.length ? '❌ 失败 ' + fail.length + ' 项：' + fail.join(' / ') : '✅ 全部通过'}`)
process.exit(fail.length ? 1 : 0)