// R15 定向验证：摸底退出再进（断点续测）后，做过的题能通过胶片回看——历史轮次随库持久化还原。
// 覆盖：① turn.answer 落库（skip=NULL / 有作答=JSON）② placement.turns 还原（题目+我的答案+判定，顺序正确）
//      ③ 续测 UI 胶片渲染数量与点击只读回看 ④ 退出回看后新题回到可作答态。
// 题型无关：客观题照标准答案提交（本地判分），遇主观题用带答案的 concept 缺口提交（不依赖 AI）。
// 全程只用 eng 隔离域，结束清理本脚本产生的临时会话/turn/attempt，绝不触碰用户 fe 真实进度。
import { Cdp, sleep } from './cdp.mjs'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

const bad = []
const ok = (c, m) => { if (!c) bad.push(m); console.log(`  ${c ? 'OK ' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1 }
const openDb = () => { const d = new DatabaseSync(join(process.cwd(), 'data', 'app.db')); d.exec('PRAGMA busy_timeout=8000'); return d }
const DOM = 'eng'
const OBJ = new Set(['single', 'multiple', 'judge', 'blank'])

const db0 = openDb()
const baseSessions = db0.prepare('SELECT COUNT(*) c FROM placement_session WHERE domain=?').get(DOM).c
const baseFeActive = db0.prepare("SELECT id,status FROM placement_session WHERE domain='fe' AND status='active'").all()
const hasAnswerCol = db0.prepare("PRAGMA table_info(placement_turn)").all().some((c) => c.name === 'answer')
console.log('基线：eng 会话', baseSessions, '| fe active（必须原样保留）:', JSON.stringify(baseFeActive), '| answer 列存在:', hasAnswerCol)
ok(hasAnswerCol, 'placement_turn.answer 列已由迁移补齐（重启生效）')
db0.close()

const cdp = await Cdp.connect(20)
await cdp.metrics(1460, 960)
const call = (body) => cdp.evaluate(body)

// ---- 1. force 新建隔离会话 ----
const s = await call(`
  const r = await window.forge.placement.start(${JSON.stringify(DOM)}, { force: true });
  return { sessionId: r.sessionId, itemId: r.item?.id, type: r.item?.type, hasItem: !!r.item }`)
ok(!!s.sessionId && s.hasItem, 'force 新建隔离会话并出题：' + s.itemId + '（' + s.type + '）')
const sid = s.sessionId

// ---- 2. 第一题 skip：验证无答案轮 answer 落 NULL ----
await call(`await window.forge.placement.submit(${JSON.stringify(sid)}, ${JSON.stringify(s.itemId)}, null, { gapType: 'skip', gapNote: null }); return 1`)

// ---- 3. 取下一待答题，构造一个「非空答案」提交（题型无关、确定性、不依赖 AI）----
const nxt = await call(`
  const r = await window.forge.placement.next(${JSON.stringify(sid)});
  return { itemId: r.item?.id, type: r.item?.type, refAnswer: r.item?.q?.answer ?? null }`)
ok(!!nxt?.itemId, '取下一待答题成功：' + nxt?.itemId + '（' + nxt?.type + '）')
// 在页面内按题型构造合法作答：客观题给标准答案（判对），主观题用带文本的 concept 缺口
const made = await call(`
  const type = ${JSON.stringify(nxt.type)}; const ref = ${JSON.stringify(nxt.refAnswer)};
  let answer, opts;
  if (${JSON.stringify([...OBJ])}.includes(type)) {
    if (type === 'judge') answer = { judge: ref.judge };
    else if (type === 'blank') answer = { blanks: ref.blanks || [] };
    else answer = { keys: ref.keys || [] };
    opts = { gapType: null, gapNote: null };
  } else {
    answer = { text: 'R15 持久化测试答案-主观缺口' };
    opts = { gapType: 'concept', gapNote: 'R15 test' };
  }
  const r = await window.forge.placement.submit(${JSON.stringify(sid)}, ${JSON.stringify(nxt.itemId)}, answer, opts);
  return { qid: ${JSON.stringify(nxt.itemId)}, answer, gapType: opts.gapType, scale4: r.scale4, finished: r.finished }`)
ok(typeof made.scale4 === 'number', '第二题提交成功并返回判定 scale4=' + made.scale4 + '（gap=' + made.gapType + '）')

// ---- 4. DB 直查：answer 列落库符合预期 ----
const dbv = openDb()
const turnRows = dbv.prepare('SELECT id,question_id,gap_type,answer,scale4 FROM placement_turn WHERE session_id=? ORDER BY id').all(sid)
dbv.close()
ok(turnRows.length === 2, '本会话落 2 轮 turn（实际 ' + turnRows.length + '）')
const skipRow = turnRows.find((t) => t.gap_type === 'skip')
const ansRow = turnRows.find((t) => t.question_id === made.qid)
ok(!!skipRow && skipRow.answer === null, 'skip 轮 answer 落 NULL')
ok(!!ansRow && ansRow.answer != null && ansRow.answer.length > 2, '作答轮用户答案持久化到 turn.answer（非 NULL）：' + ansRow?.answer)

// ---- 5. 核心：placement.turns 按会话还原（不依赖前端内存，模拟退出重进）----
const restored = await call(`
  const rows = await window.forge.placement.turns(${JSON.stringify(sid)});
  return rows.map(r => ({ qid: r.item.id, type: r.item.type, answer: r.answer, scale4: r.scale4,
    gapType: r.gapType, verdict: r.verdict, guessed: r.guessed, hasStem: !!r.item.q?.stem,
    qidsOrder: r.item.id }))`)
ok(Array.isArray(restored) && restored.length === turnRows.length, 'turns 还原轮数一致：' + restored.length + '/' + turnRows.length)
ok(restored.every((r) => r.hasStem), '每轮都带回完整题目（题干可渲染）')
ok(restored.every((r) => r.guessed === false), '历史快照 guessed 恒 false（蒙题旗标不跨会话持久化）')
ok(restored[0].qid === s.itemId && restored[1].qid === made.qid, '轮次按作答顺序排列（skip 在前、作答题在后）')
const rSkip = restored.find((r) => r.gapType === 'skip')
const rAns = restored.find((r) => r.qid === made.qid)
ok(!!rSkip && rSkip.answer === null, '还原的 skip 轮 answer 为 null')
ok(!!rAns && JSON.stringify(rAns.answer) === JSON.stringify(made.answer), '还原的作答轮答案与我提交的完全一致：' + JSON.stringify(rAns?.answer))
ok(!!rAns && rAns.scale4 === made.scale4, '还原的作答轮保留判定 scale4=' + rAns?.scale4)

// ---- 6. 真实 UI：模拟「退出 → 再进续测」，胶片渲染全部历史题且可点击回看 ----
await cdp.nav('/placement')
await sleep(1200)
await cdp.evaluate(`[...document.querySelectorAll('button')].find(b=>/退出/.test(b.textContent)&&b.getBoundingClientRect().width>0)?.click(); return 1`).catch(()=>{})
await sleep(700)
await cdp.evaluate(`[...document.querySelectorAll('.domain-card')].find(c=>/工程难题/.test(c.textContent))?.click(); return 1`)
await sleep(1400)
const ui = await cdp.evaluate(`
  const dots = [...document.querySelectorAll('.filmstrip .film-dot')];
  return {
    hasFilm: !!document.querySelector('.filmstrip'),
    dotCount: dots.length,
    capText: document.querySelector('.film-cap')?.innerText || '',
    hasSubmit: !![...document.querySelectorAll('button')].find(b=>/提交作答/.test(b.textContent)&&b.getBoundingClientRect().width>0),
    hasVerdict: !!document.querySelector('.pl-verdict')
  }`)
ok(ui.hasFilm && ui.dotCount === turnRows.length, '续测后胶片渲染 ' + ui.dotCount + ' 个历史题号（=' + turnRows.length + '）：' + ui.capText)
ok(ui.hasSubmit && !ui.hasVerdict, '续测活动题为干净待答态（有提交按钮、无历史判定串台）')

// 点第一个胶片点 → 只读回看
await cdp.evaluate(`document.querySelector('.filmstrip .film-dot')?.click(); return 1`)
await sleep(700)
const review = await cdp.evaluate(`
  const pill = document.querySelector('[data-testid="pl-review-pill"]');
  return {
    isReview: !!pill,
    pillText: pill?.innerText || '',
    noSubmit: ![...document.querySelectorAll('button')].some(b=>/提交作答/.test(b.textContent)&&b.getBoundingClientRect().width>0),
    hasPrevNext: !![...document.querySelectorAll('button')].find(b=>/上一题|下一题/.test(b.textContent))
  }`)
ok(review.isReview && review.noSubmit, '点胶片进入只读回看（出现「' + review.pillText + '」、提交按钮隐藏）')
ok(review.hasPrevNext, '回看态提供上一题/下一题导航')
await cdp.shot('data/qa/r15-placement-review-history.png')

// 退出回看 → 回到干净待答新题（验证 exitReview 续测分支，不被历史判定锁死）
await cdp.evaluate(`[...document.querySelectorAll('button')].find(b=>/退出回看/.test(b.textContent)&&b.getBoundingClientRect().width>0)?.click(); return 1`).catch(()=>{})
await sleep(600)
const afterExit = await cdp.evaluate(`
  return {
    reviewGone: !document.querySelector('[data-testid="pl-review-pill"]'),
    hasSubmit: !![...document.querySelectorAll('button')].find(b=>/提交作答/.test(b.textContent)&&b.getBoundingClientRect().width>0),
    hasVerdict: !!document.querySelector('.pl-verdict')
  }`)
ok(afterExit.reviewGone && afterExit.hasSubmit && !afterExit.hasVerdict, '退出回看后新题恢复可作答态（不被上一轮历史判定锁死）')

await cdp.close()

// ---- 7. 清理本脚本 eng 临时数据（turn + session + 相关 placement attempts），fe 零改动 ----
const dbc = openDb()
const sidList = dbc.prepare('SELECT id FROM placement_session WHERE domain=?').all(DOM).map((r) => r.id)
const delAtt = sidList.length
  ? dbc.prepare(`DELETE FROM attempts WHERE mode='placement' AND question_id IN
      (SELECT question_id FROM placement_turn WHERE session_id IN (${sidList.map(() => '?').join(',')}))`).run(...sidList).changes
  : 0
const delTurns = dbc.prepare('DELETE FROM placement_turn WHERE session_id IN (SELECT id FROM placement_session WHERE domain=?)').run(DOM).changes
const delSess = dbc.prepare('DELETE FROM placement_session WHERE domain=?').run(DOM).changes
const finEng = dbc.prepare('SELECT COUNT(*) c FROM placement_session WHERE domain=?').get(DOM).c
const feAfter = dbc.prepare("SELECT id,status FROM placement_session WHERE domain='fe' AND status='active'").all()
dbc.close()
console.log('清理 eng 会话', delSess, '个 / turn', delTurns, '条 / 相关 placement attempts', delAtt, '条')
ok(finEng === baseSessions, 'eng 会话回到基线（' + finEng + '/' + baseSessions + '）')
ok(JSON.stringify(feAfter) === JSON.stringify(baseFeActive), '用户 fe 真实会话零改动：' + JSON.stringify(feAfter))

console.log(bad.length ? `\n❌ R15 续测回看验证 ${bad.length} 项失败: ${bad.join(' | ')}` : '\n✅ R15 摸底历史轮次持久化、turns 还原、续测胶片回看、用户数据零污染，全部通过')
process.exit(bad.length ? 1 : 0)
