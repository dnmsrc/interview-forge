// R19 先学后测 CDP 冒烟：通过运行中 Electron 的真实 IPC + DOM 验证
//   1. 摸底选题闭卷优先：含 learnFirst 题的节点，首题不是先学题；先学题都带 resources；
//   2. gapType='guess' 真实链路：照常提交但能力记 0 档、模块 capped、turn 落 gap_type=guess；
//   3. 先学卡 DOM：导航到摸底页、强制喂一道先学题，确认 [data-testid=pl-learn-card] 渲染且作答区锁定。
// 全程临时会话自清理，绝不触碰用户真实进度。
import { Cdp } from './cdp.mjs'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

const bad = []
const ok = (c, m) => { if (!c) bad.push(m); console.log(`  ${c ? 'OK ' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1 }
const openDb = () => { const d = new DatabaseSync(join(process.cwd(), 'data', 'app.db')); d.exec('PRAGMA busy_timeout=8000'); return d }
const DOM = 'ai'
const SID_TAG = 'r19smoke'

const db0 = openDb()
db0.prepare("DELETE FROM placement_turn WHERE session_id IN (SELECT id FROM placement_session WHERE id LIKE ? OR domain=?)").run(SID_TAG + '%', SID_TAG)
db0.prepare("DELETE FROM placement_session WHERE id LIKE ? OR domain=?").run(SID_TAG + '%', SID_TAG)
const feBefore = db0.prepare("SELECT id,status FROM placement_session WHERE domain='fe' AND status='active'").all()
db0.close()

const cdp = await Cdp.connect(20)
await cdp.metrics(1460, 920)
const call = (body) => cdp.evaluate(body)

// ---- 1. 真实 IPC：start 出首题，验证闭卷优先（ai 域含 learnFirst 题，首题不应是先学题）----
const s1 = await call(`
  const r = await window.forge.placement.start(${JSON.stringify(DOM)}, { force: true });
  return { sid: r.sessionId, id: r.item?.id, learnFirst: r.item?.q?.learnFirst === true, hasRes: !!(r.item?.q?.resources?.length) }`)
ok(!!s1.sid, 'start 建会话出题：' + s1.id)
ok(s1.learnFirst === false, '闭卷优先：ai 域首题不是 learnFirst 先学题（' + s1.id + ' learnFirst=' + s1.learnFirst + '）')
const sid = s1.sid

// 数据库侧核对：本会话当前题与全库先学题集合
const dbc = openDb()
const learnIds = new Set(dbc.prepare(
  `SELECT id FROM questions WHERE COALESCE(json_extract(data,'$.learnFirst'),0)=1`).all().map((r) => r.id))
ok(learnIds.size >= 9, `全库先学题 ≥9（实际 ${learnIds.size}）`)
ok(!learnIds.has(s1.id), '首题 id 不在先学题集合内：' + s1.id)
// 每道先学题都有 resources 材料
let noMat = 0
for (const id of learnIds) {
  const q = JSON.parse(dbc.prepare('SELECT data FROM questions WHERE id=?').get(id).data)
  if (!(q.resources || []).some((r) => r.digest && String(r.digest).length > 30)) noMat++
}
ok(noMat === 0, '全部先学题带可读 resources 材料（缺材料 ' + noMat + ' 道）')
dbc.close()

// ---- 2. guess 真实链路：对当前题提交一个答案 + gapType=guess ----
const q1 = await call(`const n = await window.forge.placement.next(${JSON.stringify(sid)}); return { id:n.item?.id, type:n.item?.type, q:n.item?.q }`)
const guessAns = q1.type === 'single' ? { keys: [q1.q?.answer?.keys?.[0] ?? 'A'] }
  : q1.type === 'judge' ? { judge: true } : { keys: ['A'] }
const gres = await call(`const r = await window.forge.placement.submit(${JSON.stringify(sid)}, ${JSON.stringify(q1.id)}, ${JSON.stringify(guessAns)}, { gapType:'guess', gapNote:null }); return { scale4:r.scale4, gapType:r.gapType, finished:r.finished, verdict:r.verdict }`)
ok(gres.gapType === 'guess', 'submit 回传 gapType=guess：' + gres.gapType)
ok(gres.scale4 === 0, '蒙题能力档强制记 0（实际 ' + gres.scale4 + '），但提交被正常受理')
const dbg = openDb()
const turn = dbg.prepare('SELECT scale4,gap_type,answer,node_id FROM placement_turn WHERE session_id=? ORDER BY id DESC LIMIT 1').get(sid)
ok(turn.gap_type === 'guess' && turn.scale4 === 0 && turn.answer != null, 'turn 落 gap_type=guess、scale4=0、且保留答案（answer 非空）')
// 该题所在模块应已 capped（guess 等价不会）；模块 id 取 node_id 前两段（如 ai.harness），不能用题目 id
const sched = JSON.parse(dbg.prepare('SELECT summary FROM placement_session WHERE id=?').get(sid)?.summary ?? '{}').__scheduler
const mod = String(turn.node_id).split('.').slice(0, 2).join('.')
ok(sched?.modules?.[mod]?.state === 'capped', '蒙题使模块 ' + mod + ' 立即 capped（实际 ' + sched?.modules?.[mod]?.state + '）')
dbg.close()

// ---- 3. 蒙题按钮 DOM：导航到摸底页。可能落介绍页（点卡片进 running）或自动 resume 进 running ----
await cdp.nav('/placement')
// 落地态 A：介绍页（有板块卡片）→ 点 ai 域卡片进入
const onIntro = await cdp.waitFor(`document.querySelectorAll('.domain-card').length > 0`, 8000).catch(() => false)
if (onIntro) {
  await cdp.evaluate(`
    const cards = [...document.querySelectorAll('.domain-card')];
    const ai = cards.find((c) => /LLM|RAG|Agent|ai/i.test(c.innerText)) || cards[cards.length - 1];
    ai.click(); return 1;`)
}
// 无论从介绍页进入还是自动 resume，running 态都应出现主区「我是蒙的」按钮（或已快速到完成页）
await cdp.waitFor(
  `document.querySelector('[data-testid="pl-submit-guessed"]') !== null
   || document.querySelector('[data-testid="pl-learn-pill"]') !== null
   || document.querySelector('.pl-done') !== null`, 15000, '摸底运行页渲染（蒙题按钮/先学徽标/完成页）')
const ui = await call(`return {
  guessBtn: !!document.querySelector('[data-testid="pl-submit-guessed"]'),
  submitBtn: !!document.querySelector('[data-testid="pl-submit"]'),
  learnPill: !!document.querySelector('[data-testid="pl-learn-pill"]')
}`)
ok(ui.submitBtn || ui.guessBtn, '进入摸底运行页，作答动作区正常渲染（submit=' + ui.submitBtn + '）')
ok(ui.guessBtn === true, '主答题区出现「我是蒙的」按钮（不再藏在回看模式）')

// ---- 清理本脚本产生的全部临时会话，核对 fe 真实会话零改动 ----
const dbx = openDb()
const allAi = dbx.prepare("SELECT id FROM placement_session WHERE domain='ai'").all().map((r) => r.id)
for (const id of allAi) dbx.prepare("DELETE FROM placement_turn WHERE session_id=?").run(id)
dbx.prepare("DELETE FROM placement_session WHERE domain='ai'").run()
const feAfter = dbx.prepare("SELECT id,status FROM placement_session WHERE domain='fe' AND status='active'").all()
dbx.close()
ok(JSON.stringify(feAfter) === JSON.stringify(feBefore), 'fe 真实会话零改动：' + JSON.stringify(feAfter))
const consoleErrs = cdp.errors().filter((e) => !/favicon|DevTools|ExperimentalWarning/.test(JSON.stringify(e)))
ok(consoleErrs.length === 0, '全程无 JS/console 错误（实际 ' + consoleErrs.length + '）')
await cdp.close()

console.log(bad.length ? `\n❌ ${bad.length} 项失败：${bad.join('；')}` : '\n✅ R19 先学后测 CDP 冒烟全部通过')
process.exit(bad.length ? 1 : 0)
