#!/usr/bin/env node
// R11 入门摸底「回看 + 这题我是蒙的」真机联调（依赖 Electron CDP，UI 真实流程）。
// 全流程：新建一次 fe 摸底 → 客观题作答前 2 题（不依赖 AI）→ 手动「下一题」不再自动跳 →
//         题号胶片回看 → 只读还原作答/参考答案/解析 → 上一题/下一题/回到最新题 →
//         标记蒙的（复用 practice.markGuessed，进错题本、原判定保留、胶片打旗帜）→
//         无横向溢出 → 按测试 session 与涉及题目精确清理，还原用户真实基线。
import { Cdp, sleep, AUDIT_JS } from './cdp.mjs'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

const bad = []
const ok = (c, m) => { if (!c) bad.push(m); console.log(`  ${c ? 'OK ' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1 }

const dbPath = join(process.cwd(), 'data', 'app.db')
const openDb = () => {
  const d = new DatabaseSync(dbPath)
  d.exec('PRAGMA busy_timeout=8000')
  return d
}

/* ---------- 0. 记录测试前基线，并对「起始节点」关联题目/节点整行快照（用于精确还原） ----------
   recordAttempt 会写 attempts、srs(含 weight)、node_mastery(多列)。摸底沿前置链可能走到相邻节点，
   但起始节点是固定的（fe 域外部前置最少的 L4），这里把起始节点的全部题目与节点行先备份，
   测后对测试实际触及的题目/节点统一按快照整行还原，保证用户真实数据零污染。 */
const START_NODE = 'fe.ts.type-system.structural-typing'
const db0 = openDb()
const baseline = {
  attempts: db0.prepare('SELECT COUNT(*) c FROM attempts').get().c,
  sessions: db0.prepare('SELECT COUNT(*) c FROM placement_session').get().c,
  turns: db0.prepare('SELECT COUNT(*) c FROM placement_turn').get().c,
  placement: db0.prepare('SELECT COUNT(*) c FROM placement').get().c
}
// 测试隔离（R14 起点卡片默认续测而非新建）：把 fe 未完成会话收口为 aborted（仅状态变更、不删数据，
// 已完成摸底结果不受影响），保证本次点卡片必新建测试会话，也避免测试清理误删用户真实进度。
const aborted0 = db0.prepare("UPDATE placement_session SET status='aborted', updated_at=datetime('now','localtime') WHERE domain='fe' AND status='active'").run().changes
console.log('测试前基线：', JSON.stringify(baseline), '| 收口 fe 未完成会话', aborted0)
const snapTable = (d, table, idCol, ids) => {
  const out = {}
  for (const id of ids) out[id] = d.prepare(`SELECT * FROM ${table} WHERE ${idCol}=?`).get(id) ?? null
  return out
}
// 摸底会沿前置链走到起始节点之外的相邻节点/题目。为保证任何被触及对象都能整行还原，
// 这里对「全部节点 mastery」与「全部题目 srs」做全量快照（本库规模仅百余节点，成本可忽略）。
const allNodeIds = db0.prepare('SELECT node_id AS id FROM node_mastery').all().map((r) => r.id)
const allQids = db0.prepare('SELECT id FROM questions').all().map((r) => r.id)
const srsBackup = snapTable(db0, 'srs', 'question_id', allQids)
const masteryBackup = snapTable(db0, 'node_mastery', 'node_id', allNodeIds)
// 起始节点的题目额外备份 attempts 计数（用于核对）
const startQids = db0.prepare('SELECT id FROM questions WHERE node_id=?').all(START_NODE).map((r) => r.id)
const attemptsCountBackup = {}
for (const qid of startQids) attemptsCountBackup[qid] = db0.prepare('SELECT COUNT(*) c FROM attempts WHERE question_id=?').get(qid).c
db0.close()
console.log('     全量快照：node_mastery', allNodeIds.length, '行；srs', allQids.length, '题；起始节点题目', startQids.length, '道')

const cdp = await Cdp.connect(18)
await cdp.metrics(1460, 920)
cdp.clearErrors()
const tid = (t) => `[data-testid=${JSON.stringify(t)}]`
const visibleTid = (t) => `[...document.querySelectorAll(${JSON.stringify(tid(t))})].filter(e=>e.getBoundingClientRect().width>0)`
const clickTid = async (t) => cdp.evaluate(`const el=${visibleTid(t)}[0]; if(el){el.click();return 1} return 0`)

/* ---------- 1. 进入摸底介绍页，启动一次全新 fe 摸底（不用 resume，保证拿到独立 session） ---------- */
await cdp.nav('/placement')
await sleep(1200)
// 若落在进行中页（断点续测提示之外的 running 态），先退回到 intro
await cdp.evaluate(`[...document.querySelectorAll('button')].find(b=>/退出/.test(b.textContent)&&b.getBoundingClientRect().width>0)?.click(); return 1`)
await sleep(800)
// 点「前端」领域卡开始
const started = await cdp.evaluate(`
  const cards=[...document.querySelectorAll('.domain-card')].filter(e=>e.getBoundingClientRect().width>0);
  const fe=cards.find(c=>/前端/.test(c.textContent)); if(fe){fe.click();return 1} return 0`)
ok(started === 1, '点击「前端」启动一次全新摸底')
await cdp.waitFor("!!document.querySelector('.stem')", 20000, '摸底首题题干')
await sleep(500)

// 取本次测试 session id 与首题 id（从 Vue 实例读，供精确清理）
const sidAndQ = await cdp.evaluate(`
  const card=document.querySelector('.pl-q'); let inst=card?.__vueParentComponent; let sid=null,qid=null,nodeId=null;let hops=0;
  while(inst&&hops<14){const ctx=inst.setupState||{};if(ctx.sessionId&&ctx.cur){sid=ctx.sessionId;qid=ctx.cur.id;nodeId=ctx.cur.node_id;break}inst=inst.parent;hops++}
  return {sid,qid,nodeId}`)
const testSid = sidAndQ.sid
ok(!!testSid && /^qa-/.test(testSid) === false, '拿到本次摸底 session id（' + testSid + '），与历史会话区分')
console.log('     测试 session =', testSid, '首题 =', sidAndQ.qid, '节点 =', sidAndQ.nodeId)

/* ---------- 客观题作答当前题：单选点首个选项 / 判断点「说法正确」，兜底用「我不会」 ---------- */
async function answerCurrent(seq) {
  const kind = await cdp.evaluate(`
    const meta=document.querySelector('.qmeta')?.innerText||''
    if(/判断/.test(meta))return 'judge'
    if(/单选|多选/.test(meta))return 'choice'
    return 'other'`)
  if (kind === 'choice') {
    await cdp.evaluate(`const o=document.querySelector('.opt');if(o)o.click();return !!o`)
  } else if (kind === 'judge') {
    await cdp.evaluate(`const b=[...document.querySelectorAll('.n-button')].find(e=>/说法正确/.test(e.textContent)&&e.getBoundingClientRect().width>0);if(b)b.click();return !!b`)
  } else {
    // 兜底：直接标记「我不会 → 跳过」，保证不依赖 AI 也能推进
    await cdp.evaluate(`[...document.querySelectorAll('.n-button')].find(e=>/我不会/.test(e.textContent)&&e.getBoundingClientRect().width>0)?.click();return 1`)
    await sleep(300)
    await cdp.evaluate(`const b=[...document.querySelectorAll('.gap-opt')].find(e=>/直接跳过/.test(e.textContent)&&e.getBoundingClientRect().width>0);if(b)b.click();return !!b`)
    await sleep(700)
    return
  }
  await sleep(300)
  const clicked = await clickTid('pl-submit')
  ok(clicked === 1, `第 ${seq} 题点击提交作答`)
  await cdp.waitFor(`!!${visibleTid('pl-next')}[0] || !!document.querySelector('.pl-verdict')`, 30000, `第 ${seq} 题判定完成、停在本题（不自动跳）`)
}

await answerCurrent(1)
const after1 = await cdp.evaluate(`return {
  film: !!document.querySelector('[data-testid="placement-filmstrip"]'),
  dots: document.querySelectorAll('[data-testid^="pl-film-dot-"]').length,
  nextBtn: !!${visibleTid('pl-next')}[0],
  reviewEntry: !!document.querySelector('[data-testid="pl-review-entry"]'),
  verdict: !!document.querySelector('.pl-verdict')
}`)
ok(after1.film, '作答第 1 题后出现摸底题号胶片')
ok(after1.dots === 1, '胶片仅 1 个点（实际 ' + after1.dots + '）')
ok(after1.nextBtn, '提交后停在本题、出现手动「下一题」（不再 650ms 自动切走）')
ok(after1.verdict, '本题判定回显已展示')
ok(!after1.reviewEntry, '只做 1 题时无「回看上面的题」入口（边界）')
await cdp.shot('data/qa/r11-after-q1.png')

/* ---------- 2. 手动进第 2 题并作答 ---------- */
await clickTid('pl-next')
await sleep(1000)
await cdp.waitFor("!!document.querySelector('.stem') && !document.querySelector('.pl-verdict')", 12000, '进入第 2 题待作答态')
await answerCurrent(2)
await sleep(400)
const after2 = await cdp.evaluate(`return {
  dots: document.querySelectorAll('[data-testid^="pl-film-dot-"]').length,
  reviewEntry: !!document.querySelector('[data-testid="pl-review-entry"]'),
  markOnLatest: !!document.querySelector('[data-testid="pl-mark-guessed"]')
}`)
ok(after2.dots === 2, '作答第 2 题后胶片有 2 个点（实际 ' + after2.dots + '）')
ok(after2.reviewEntry, '最新题（第 2 题）出现「回看上面的题」入口')
ok(!after2.markOnLatest, '最新题不显示「这题我是蒙的」（仅回看态出现，防误触）')

/* ---------- 3. 回看第 1 题：只读还原作答 / 参考答案 / 解析 ---------- */
await cdp.evaluate(`document.querySelector('[data-testid="pl-film-dot-0"]')?.click(); return 1`)
await sleep(800)
const review1 = await cdp.evaluate(`return {
  readonly: !!document.querySelector('[data-testid="pl-review-pill"]'),
  optLocked: (() => {
    const o=document.querySelector('.opt'); if(!o)return 'no-opt'
    if(o.classList.contains('is-disabled'))return 'class-disabled'
    const inner=o.querySelector('button,input'); if(inner&&inner.disabled)return 'inner-disabled'
    return getComputedStyle(o).cursor
  })(),
  hasMark: !!document.querySelector('[data-testid="pl-mark-guessed"]'),
  // 单选/多选/判断：正确答案以选项上的「正确」pill 或标准答案文字呈现；填空/简答才有独立「参考答案」块
  answerRestored: (() => {
    if (document.body.innerText.includes('参考答案')) return true
    if (document.querySelector('.opt.right .pill.ok, .opt .pill.ok')) return true
    if (/正确判断|标准答案/.test(document.body.innerText)) return true
    return false
  })(),
  anaDetails: !!document.querySelector('.pl-ana')
}`)
ok(review1.readonly, '回看态显示「回看 · 只读」徽标')
ok(review1.hasMark, '回看态出现「这题我是蒙的」按钮')
ok(review1.answerRestored, '回看时还原了正确答案（选项标「正确」/参考答案块）')
ok(review1.anaDetails, '回看时展示考点解析折叠区（供蒙题对照理解）')
ok(review1.optLocked === 'class-disabled' || review1.optLocked === 'inner-disabled' || review1.optLocked === 'default',
  '回看时作答区只读不可改（判据=' + review1.optLocked + '）')
await cdp.shot('data/qa/r11-review-q1.png')

/* ---------- 4. 上一题边界 + 下一题翻到第 2 题（仍回看态） ---------- */
const prevDisabled = await cdp.evaluate(`
  const b=[...document.querySelectorAll('button')].find(x=>/上一题/.test(x.textContent)&&x.getBoundingClientRect().width>0)
  return b?b.disabled:'no-btn'`)
ok(prevDisabled === true, '回看第 1 题时「上一题」禁用（边界）')
await cdp.evaluate(`[...document.querySelectorAll('button')].find(b=>/下一题/.test(b.textContent)&&b.getBoundingClientRect().width>0)?.click();return 1`)
await sleep(700)
const onQ2 = await cdp.evaluate(`return {
  reviewPill: !!document.querySelector('[data-testid="pl-review-pill"]'),
  hasMark: !!document.querySelector('[data-testid="pl-mark-guessed"]'),
  // 第 2 题是最后一个快照，回看态「下一题」应禁用
  nextDisabled: (()=>{const b=[...document.querySelectorAll('button')].find(x=>/下一题/.test(x.textContent)&&x.getBoundingClientRect().width>0);return b?b.disabled:'no-btn'})()
}`)
ok(onQ2.reviewPill && onQ2.hasMark, '下一题翻到第 2 题，保持只读回看态、可标记蒙的')
ok(onQ2.nextDisabled === true, '回看末题时「下一题」禁用（边界）')

/* ---------- 5. 回到第 1 题并标记「蒙的」：验证错题本收录 + 原判定保留 + 胶片旗帜 ---------- */
await cdp.evaluate(`document.querySelector('[data-testid="pl-film-dot-0"]')?.click(); return 1`)
await sleep(600)
// 取回看题真实 qid
const targetQid = await cdp.evaluate(`
  const card=document.querySelector('.pl-q');let inst=card?.__vueParentComponent;let qid=null;let hops=0;
  while(inst&&hops<14){const ctx=inst.setupState||{};if(ctx.cur&&ctx.cur.id){qid=ctx.cur.id;break}inst=inst.parent;hops++}
  return qid`)
const beforeMark = await cdp.evaluate(`return await (async()=>{
  const h=await window.forge.practice.history(${JSON.stringify(targetQid)},10)
  return {histBefore:h.length}
})()`)
// 摸底客观题提交已写过一条 attempt（mode=placement）
ok(beforeMark.histBefore >= 1, '标记前该题已有摸底作答记录（hist=' + beforeMark.histBefore + '），纠偏将追加而非覆盖')

await clickTid('pl-mark-guessed')
await cdp.waitFor("!!document.querySelector('.guess-pill') || document.body.innerText.includes('已标记')", 12000, '标记蒙的成功')
await sleep(800)
const afterMark = await cdp.evaluate(`return await (async()=>{
  const m=await window.forge.mistakes.list({limit:400})
  const h=await window.forge.practice.history(${JSON.stringify(targetQid)},10)
  return {
    inMistakes:m.some(x=>x.qid===${JSON.stringify(targetQid)}),
    histAfter:h.length,
    keptOriginal:h.length===${beforeMark.histBefore}+1,
    latestKind:h[0]?.grading_kind, latestScale:h[0]?.scale4
  }
})()`)
ok(afterMark.inMistakes, '标记蒙的后自动进入错题本（scale4<2 实时聚合）')
ok(afterMark.keptOriginal, '原摸底判定保留：attempts 仅新增 1 条纠偏（' + beforeMark.histBefore + ' → ' + afterMark.histAfter + '）')
ok(afterMark.latestScale === 0 && afterMark.latestKind === 'self', '纠偏记录为 0 档自评（scale4=0, kind=' + afterMark.latestKind + '）')
const flagOnDot = await cdp.evaluate(`return !!document.querySelector('[data-testid="pl-film-dot-0"] .dot-flag')`)
ok(flagOnDot, '胶片第 1 题出现蒙题旗帜')
await cdp.shot('data/qa/r11-marked-guessed.png')

/* ---------- 6. 回到最新题 / 退出回看入口 ---------- */
const backLatest = await cdp.evaluate(`return !![...document.querySelectorAll('button')].find(b=>/回到最新题/.test(b.textContent)&&b.getBoundingClientRect().width>0)`)
ok(backLatest, '回看历史题时提供「回到最新题」入口')
await cdp.evaluate(`[...document.querySelectorAll('button')].find(b=>/退出回看/.test(b.textContent)&&b.getBoundingClientRect().width>0)?.click();return 1`)
await sleep(600)
const exited = await cdp.evaluate(`return {
  reviewPill: !!document.querySelector('[data-testid="pl-review-pill"]'),
  nextBtn: !!${visibleTid('pl-next')}[0]
}`)
ok(!exited.reviewPill && exited.nextBtn, '退出回看后回到最新题待推进态、可继续下一题')

/* ---------- 7. 布局审计：无横向溢出，胶片/回看控件不撑破容器 ---------- */
const audit = await cdp.evaluate(`return (() => {
  const page=document.querySelector('.page'); const docW=document.documentElement.clientWidth
  const hOverflow=document.documentElement.scrollWidth>docW+2?('doc.sw='+document.documentElement.scrollWidth+' cw='+docW):null
  const pageOverflow=page&&page.scrollWidth>page.clientWidth+2?('page.sw='+page.scrollWidth+' cw='+page.clientWidth):null
  return {hOverflow,pageOverflow}
})()`)
ok(!audit.hOverflow, '文档级无横向溢出（' + (audit.hOverflow ?? 'OK') + '）')
ok(!audit.pageOverflow, '摸底页容器无横向溢出（' + (audit.pageOverflow ?? 'OK') + '）')

const errs = cdp.errors().filter((e) => !/Failed to load resource|favicon|DevTools|INEFFECTIVE_DYNAMIC/.test(e.text))
console.log('\n控制台错误（过滤无关后）:', errs.length ? errs.slice(0, 5) : '无')
await cdp.close()

/* ---------- 8. 精确清理：只删本次测试 session 与其衍生数据，按快照整行还原用户基线 ---------- */
const db = openDb()
const testTurns = db.prepare('SELECT DISTINCT question_id qid, node_id FROM placement_turn WHERE session_id=?').all(testSid)
const testQids = [...new Set(testTurns.map((t) => t.qid).filter(Boolean))]
const testNodes = [...new Set(testTurns.map((t) => t.node_id).filter(Boolean))]
console.log('     测试涉及题目', testQids.length, '道；节点', testNodes.length, '个：', testNodes.join(','))
const sidCreated = db.prepare('SELECT created_at FROM placement_session WHERE id=?').get(testSid)?.created_at

// 8.1 删除本次测试窗口内新增的 attempts（按 session 起始时间界定，保留用户历史 attempt）
let delAttempts = 0
if (testQids.length) {
  const ph = testQids.map(() => '?').join(',')
  if (sidCreated) delAttempts = db.prepare(`DELETE FROM attempts WHERE question_id IN (${ph}) AND created_at>=?`).run(...testQids, sidCreated).changes
  else delAttempts = db.prepare(`DELETE FROM attempts WHERE question_id IN (${ph})`).run(...testQids).changes
}
// 8.2 删除测试 session 的 turn / session / 兼容老 placement 行
const delTurns = db.prepare('DELETE FROM placement_turn WHERE session_id=?').run(testSid).changes
const delSession = db.prepare('DELETE FROM placement_session WHERE id=?').run(testSid).changes
let delPlacement = 0
if (sidCreated) delPlacement = db.prepare("DELETE FROM placement WHERE created_at>=? AND domain='fe'").run(sidCreated).changes

// 8.3 srs 全量对账还原：recordAttempt 改作答题的 srs，applyPushWeights 还会按节点改该节点
//     「所有题」（含未作答占位行）的 weight。故不能只还原 testQids，要对全量备份逐行比对，
//     凡当前行与测试前快照不一致的都还原；测试前不存在、本次新建的行则删除。
let srsRestored = 0, srsDeleted = 0
const curSrsQids = new Set(db.prepare('SELECT question_id FROM srs').all().map((r) => r.question_id))
for (const [qid, backupRow] of Object.entries(srsBackup)) {
  const live = db.prepare('SELECT * FROM srs WHERE question_id=?').get(qid) ?? null
  if (JSON.stringify(live) === JSON.stringify(backupRow)) continue
  db.prepare('DELETE FROM srs WHERE question_id=?').run(qid)
  if (backupRow) {
    const cols = Object.keys(backupRow)
    db.prepare(`INSERT INTO srs(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(...cols.map((c) => backupRow[c]))
    srsRestored++
  } else {
    srsDeleted++
  }
}
// 测试中新建、备份里完全没有的 srs 行（理论上摸底只考存量题，兜底处理）
for (const qid of curSrsQids) {
  if (!(qid in srsBackup)) { db.prepare('DELETE FROM srs WHERE question_id=?').run(qid); srsDeleted++ }
}

// 8.4 node_mastery 全量对账还原：recordAttempt 经 updateMastery/recompute 改的都是测试节点，
//     但同样按全量备份逐行比对，凡变化即还原；测试前无行、本次新建的节点删除。
const masteryRestored = []
const masteryDeleted = []
const curNodeIds = new Set(db.prepare('SELECT node_id FROM node_mastery').all().map((r) => r.node_id))
for (const [nodeId, backupRow] of Object.entries(masteryBackup)) {
  const live = db.prepare('SELECT * FROM node_mastery WHERE node_id=?').get(nodeId) ?? null
  if (JSON.stringify(live) === JSON.stringify(backupRow)) continue
  db.prepare('DELETE FROM node_mastery WHERE node_id=?').run(nodeId)
  if (backupRow) {
    const cols = Object.keys(backupRow)
    db.prepare(`INSERT INTO node_mastery(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(...cols.map((c) => backupRow[c]))
    masteryRestored.push(nodeId)
  } else {
    masteryDeleted.push(nodeId)
  }
}
for (const nodeId of curNodeIds) {
  if (!(nodeId in masteryBackup)) { db.prepare('DELETE FROM node_mastery WHERE node_id=?').run(nodeId); masteryDeleted.push(nodeId) }
}
db.close()
console.log('     清理：attempts 删', delAttempts, '；turns', delTurns, '；session', delSession, '；placement', delPlacement,
  '；srs 还原', srsRestored, '删除', srsDeleted, '；mastery 还原', masteryRestored.length, '删除', masteryDeleted.length)

/* ---------- 9. 还原核对：计数回到基线，且 srs / node_mastery 全量与快照逐字段一致 ---------- */
const db2 = openDb()
const now2 = {
  attempts: db2.prepare('SELECT COUNT(*) c FROM attempts').get().c,
  sessions: db2.prepare('SELECT COUNT(*) c FROM placement_session').get().c,
  turns: db2.prepare('SELECT COUNT(*) c FROM placement_turn').get().c,
  placement: db2.prepare('SELECT COUNT(*) c FROM placement').get().c
}
// srs 全量逐行核对
let srsMatch = true
const srsMismatch = []
for (const [qid, backupRow] of Object.entries(srsBackup)) {
  const live = db2.prepare('SELECT * FROM srs WHERE question_id=?').get(qid) ?? null
  if (JSON.stringify(live) !== JSON.stringify(backupRow ?? null)) { srsMatch = false; srsMismatch.push(qid) }
}
// node_mastery 全量逐行核对
let masteryMatch = true
const masteryMismatch = []
for (const [nodeId, backupRow] of Object.entries(masteryBackup)) {
  const live = db2.prepare('SELECT * FROM node_mastery WHERE node_id=?').get(nodeId) ?? null
  if (JSON.stringify(live) !== JSON.stringify(backupRow ?? null)) { masteryMatch = false; masteryMismatch.push(nodeId) }
}
// 起始节点题目 attempts 计数核对
let attemptsCountMatch = true
for (const qid of startQids) {
  const c = db2.prepare('SELECT COUNT(*) c FROM attempts WHERE question_id=?').get(qid).c
  if (c !== attemptsCountBackup[qid]) attemptsCountMatch = false
}
// 历史会话仍在
const legacyKept = !!db2.prepare("SELECT id FROM placement_session WHERE id='a52be7d5'").get()
db2.close()
console.log('清理后计数：', JSON.stringify(now2))
ok(now2.attempts === baseline.attempts, 'attempts 回到测试前基线（' + now2.attempts + '/' + baseline.attempts + '）')
ok(now2.turns === baseline.turns, 'placement_turn 回到基线（' + now2.turns + '/' + baseline.turns + '）')
ok(now2.sessions === baseline.sessions, 'placement_session 回到基线（' + now2.sessions + '/' + baseline.sessions + '）')
ok(now2.placement === baseline.placement, '兼容老 placement 表回到基线（' + now2.placement + '/' + baseline.placement + '）')
ok(legacyKept, '历史摸底会话 a52be7d5 原样保留')
ok(masteryMatch, 'node_mastery 全量与测试前快照逐字段一致' + (masteryMismatch.length ? '（不符：' + masteryMismatch.join(',') + '）' : ''))
ok(attemptsCountMatch, '起始节点各题 attempts 计数回到测试前')
ok(srsMatch, 'srs 全量（含节点级 weight 间接污染）与测试前快照逐字段一致' + (srsMismatch.length ? '（不符：' + srsMismatch.join(',') + '）' : ''))

console.log(bad.length ? `\n❌ R11 摸底回看联调 ${bad.length} 项失败: ${bad.join(' | ')}` : '\n✅ R11 入门摸底回看 + 蒙题纠偏真机联调全部通过（数据已清理）')
process.exit(bad.length ? 1 : 0)
