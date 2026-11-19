#!/usr/bin/env node
// R10 练习回看 + 「这题我是蒙的」真机联调。
// 全流程：定向抽一个题量充足、零作答的考点 → 自动判分作答前 2 题 → 胶片导航 → 只读回看 →
//         上一题/下一题 → 标记蒙的 → 错题本自动收录 + 原批改保留 → 未做到题置灰 → 测后精确清理。
import { Cdp, sleep, AUDIT_JS } from './cdp.mjs'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

const bad = []
const ok = (c, m) => { if (!c) bad.push(m); console.log(`  ${c ? 'OK ' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1 }

const cdp = await Cdp.connect(18)
await cdp.metrics(1460, 920)
cdp.clearErrors()
const call = (expr) => cdp.evaluate(`return await (async () => { ${expr} })()`)
const tid = (t) => `[data-testid=${JSON.stringify(t)}]`
const visibleTid = (t) => `[...document.querySelectorAll(${JSON.stringify(tid(t))})].filter(e=>e.getBoundingClientRect().width>0)`

/* ---------- 0. 选题量充足、零作答的考点（优先客观题多的），记录初始形态供还原 ---------- */
const db = new DatabaseSync(join(process.cwd(), 'data', 'app.db'))
db.exec('PRAGMA busy_timeout=8000')
const pick = db.prepare(`
  SELECT q.node_id, COUNT(*) total,
         SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM attempts a WHERE a.question_id=q.id) THEN 1 ELSE 0 END) clean
  FROM questions q
  WHERE q.status='active' AND q.parent_id IS NULL
  GROUP BY q.node_id HAVING clean>=4 AND total>=4
  ORDER BY SUM(CASE WHEN json_extract(q.data,'$.type') IN ('single','multiple','judge') THEN 1 ELSE 0 END) DESC, total DESC
  LIMIT 1`).get()
if (!pick) { console.log('找不到题量充足的干净考点，跳过'); db.close(); await cdp.close(); process.exit(0) }
const nodeId = pick.node_id
const cleanRows = db.prepare(`
  SELECT q.id, json_extract(q.data,'$.type') type FROM questions q
  WHERE q.node_id=? AND q.status='active' AND q.parent_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.question_id=q.id)
  ORDER BY json_extract(q.data,'$.type') IN ('single','multiple','judge') DESC, q.id`).all(nodeId)
const qids = cleanRows.map((r) => r.id)
const srsBefore = qids.map((id) => ({ id, row: db.prepare('SELECT stability,difficulty,reps,lapses,state,due,last_review,avg_score,weight FROM srs WHERE question_id=?').get(id) ?? null }))
const masteryBefore = db.prepare('SELECT * FROM node_mastery WHERE node_id=?').get(nodeId) ?? null
console.log(`测试考点 ${nodeId}（题量 ${pick.total}，零作答 ${pick.clean}）；标记目标题 ${qids[0]}`)
db.close()

/* ---------- 1. 定向进入：让页面自身按该节点组卷（走 onMounted/路由 watch 的真实 start） ---------- */
await cdp.nav('/practice')
await cdp.evaluate(`location.hash = ${JSON.stringify('#/practice?node=' + nodeId)}; return 1`)
await sleep(1800)
await cdp.waitFor("!!document.querySelector('.stem')", 20000, '定向练习题干')
const queueInfo = await cdp.evaluate(`return {
  total: document.querySelectorAll('[data-testid^="film-dot-"]').length,
  meta: document.querySelector('.qmeta .num')?.textContent || ''
}`)
// 刚进入还没作答，胶片不出现；队列长度看题号 x/N
const queueN = parseInt((queueInfo.meta.split('/')[1] || '0'), 10)
ok(queueN >= 4, '页面定向组卷拿到 ≥4 题（实际 ' + queueN + '），可验证未做到题置灰')

/* ---------- 2. 作答当前题（客观题点选项自动判分；兜底四档自评），不依赖 AI ---------- */
async function answerCurrent(seq) {
  const kind = await cdp.evaluate(`
    const meta = document.querySelector('.qmeta')?.innerText || ''
    if (/判断/.test(meta)) return 'judge'
    if (/单选|多选/.test(meta)) return 'choice'
    return 'other'`)
  if (kind === 'choice') {
    await cdp.evaluate(`const o = document.querySelector('.opt'); if (o) o.click(); return !!o`)
  } else if (kind === 'judge') {
    await cdp.evaluate(`const b=[...document.querySelectorAll('.n-button')].find(e=>/说法正确|说法错误/.test(e.textContent)&&e.getBoundingClientRect().width>0);if(b)b.click();return !!b`)
  } else {
    await cdp.evaluate(`const b=document.querySelector('.s4-group .s4:last-child');if(b)b.click();return !!b`)
  }
  await sleep(300)
  const clicked = await cdp.evaluate(`const el=${visibleTid('practice-submit')}[0]; if(el){el.click();return 1} return 0`)
  ok(clicked === 1, `第 ${seq} 题点击提交并批改`)
  await cdp.waitFor(`!!${visibleTid('practice-next')}[0]`, 30000, `第 ${seq} 题判分完成`)
}

await answerCurrent(1)
const after1 = await cdp.evaluate(`return {
  film: !!document.querySelector('[data-testid="practice-filmstrip"]'),
  dots: document.querySelectorAll('[data-testid^="film-dot-"]').length,
  hasPrev: !!document.querySelector('[data-testid="practice-prev"]')
}`)
ok(after1.film, '作答第 1 题后出现题号胶片')
ok(after1.dots === queueN, '胶片点数 = 队列长度（' + after1.dots + '/' + queueN + '）')
ok(!after1.hasPrev, '最新题在第 1 题时没有「回看上面的题」入口')
await cdp.shot('data/qa/r10-after-q1.png')

// 进第 2 题并作答
await cdp.evaluate(`${visibleTid('practice-next')}[0]?.click(); return 1`)
await sleep(1200)
await cdp.waitFor("!!document.querySelector('.stem')", 12000, '第 2 题题干')
await answerCurrent(2)
await sleep(400)
const after2 = await cdp.evaluate(`return {
  dots: document.querySelectorAll('[data-testid^="film-dot-"]').length,
  enabledDots: [...document.querySelectorAll('[data-testid^="film-dot-"]')].filter(d=>!d.disabled).length,
  disabledDots: [...document.querySelectorAll('[data-testid^="film-dot-"]')].filter(d=>d.disabled).length,
  hasPrev: !!document.querySelector('[data-testid="practice-prev"]'),
  markBtn: !!document.querySelector('[data-testid="practice-mark-guessed"]')
}`)
ok(after2.enabledDots === 2, '只做到第 2 题：胶片仅前 2 个点可点（实际可点 ' + after2.enabledDots + '）')
ok(after2.disabledDots === queueN - 2, '还没做到的 ' + (queueN - 2) + ' 个胶片点置灰不可跳（实际禁用 ' + after2.disabledDots + '）')
ok(after2.hasPrev, '第 2 题（最新题）出现「回看上面的题」入口')
ok(!after2.markBtn, '最新题不显示「这题我是蒙的」（仅回看态出现，防误触）')

/* ---------- 3. 回看第 1 题 ---------- */
await cdp.evaluate(`document.querySelector('[data-testid="film-dot-0"]')?.click(); return 1`)
await sleep(900)
const review1 = await cdp.evaluate(`return {
  readonly: !!document.querySelector('.review-pill'),
  // 真实只读判据：QuestionBody disabled 后选项带 is-disabled 类（回看只读视觉态），逻辑上 pick() 也会拦截
  optLocked: (() => {
    const o = document.querySelector('.opt')
    if (!o) return 'no-opt'
    if (o.classList.contains('is-disabled')) return 'class-disabled'
    const inner = o.querySelector('button,input'); if (inner && inner.disabled) return 'inner-disabled'
    return getComputedStyle(o).cursor
  })(),
  hasMark: !!document.querySelector('[data-testid="practice-mark-guessed"]'),
  fbShown: !!document.querySelector('.fb') || document.body.innerText.includes('参考答案')
}`)
ok(review1.readonly, '回看态显示「回看 · 只读」徽标')
ok(review1.hasMark, '回看态出现「这题我是蒙的」按钮')
ok(review1.fbShown, '回看时还原了当时的批改/参考答案')
ok(review1.optLocked === 'class-disabled' || review1.optLocked === 'inner-disabled' || review1.optLocked === 'default',
  '回看时作答区只读不可改（判据=' + review1.optLocked + '）')
await cdp.shot('data/qa/r10-review-q1.png')

/* ---------- 4. 上一题边界 + 下一题翻到第 2 题（仍回看态） ---------- */
const prevDisabled = await cdp.evaluate(`
  const b=[...document.querySelectorAll('button')].find(x=>/上一题/.test(x.textContent)&&x.getBoundingClientRect().width>0)
  return b ? b.disabled : 'no-btn'`)
ok(prevDisabled === true, '回看第 1 题时「上一题」禁用（边界）')
await cdp.evaluate(`[...document.querySelectorAll('button')].find(b=>/下一题/.test(b.textContent)&&b.getBoundingClientRect().width>0)?.click(); return 1`)
await sleep(800)
const onQ2 = await cdp.evaluate(`return {
  idx: (document.querySelector('.qmeta .num')?.textContent || '').trim(),
  reviewPill: !!document.querySelector('.review-pill'),
  hasMark: !!document.querySelector('[data-testid="practice-mark-guessed"]')
}`)
ok(/^2\//.test(onQ2.idx), '下一题翻到第 2 题（题号 ' + onQ2.idx + '）')
ok(onQ2.reviewPill && onQ2.hasMark, '第 2 题经回看导航进入，保持只读回看态、可标记蒙的')

/* ---------- 5. 标记第 1 题「蒙的」：先取标记前基线，再标记验证 ---------- */
await cdp.evaluate(`document.querySelector('[data-testid="film-dot-0"]')?.click(); return 1`)
await sleep(700)
// 当前回看题（胶片第 1 点）的真实 id：直接读页面内已渲染的反馈面板数据（FeedbackPanel 的 grade.qid），
// 避免再发一次随机组卷导致顺序与页面队列不一致。
const targetQid = await cdp.evaluate(`
  // 题目卡是带 :key=cur.id 的 .card.rise；从 Vue 组件实例上取最稳，取不到再退而求其次
  const card = document.querySelector('.card.rise')
  let inst = card?.__vueParentComponent
  let qid = null
  // 向上找到 PracticeView 组件实例，读其 cur.id
  let hops = 0
  while (inst && hops < 12) {
    const ctx = inst.setupState || {}
    if (ctx.cur && ctx.cur.id) { qid = ctx.cur.id; break }
    inst = inst.parent; hops++
  }
  return qid`)
const before = await call(`
  const h = await window.forge.practice.history(${JSON.stringify(targetQid)}, 10)
  return { histBefore: h.length }`)
ok(before.histBefore >= 1, '标记前：该题已有真实批改记录（hist=' + before.histBefore + '），纠偏将在其上追加而非覆盖')

await cdp.evaluate(`${visibleTid('practice-mark-guessed')}[0]?.click(); return 1`)
await cdp.waitFor("!!document.querySelector('.guess-pill') || document.body.innerText.includes('已标记')", 12000, '标记成功')
await sleep(800)
const afterMark = await call(`
  const m = await window.forge.mistakes.list({ limit: 400 })
  const h = await window.forge.practice.history(${JSON.stringify(targetQid)}, 10)
  return {
    inMistakes: m.some(x => x.qid === ${JSON.stringify(targetQid)}),
    histAfter: h.length,
    keptOriginal: h.length === ${before.histBefore} + 1,
    latestKind: h[0]?.grading_kind, latestScale: h[0]?.scale4
  }`)
ok(afterMark.inMistakes, '标记蒙的后自动进入错题本（scale4<2 实时聚合）')
ok(afterMark.keptOriginal, '原批改保留：attempts 仅新增 1 条纠偏（' + before.histBefore + ' → ' + afterMark.histAfter + '）')
ok(afterMark.latestScale === 0 && afterMark.latestKind === 'self', '纠偏记录为 0 档自评（scale4=0, kind=' + afterMark.latestKind + '）')
const flagOnDot = await cdp.evaluate(`return !!document.querySelector('[data-testid="film-dot-0"] .dot-flag')`)
ok(flagOnDot, '胶片第 1 题出现蒙题旗帜')
await cdp.shot('data/qa/r10-marked-guessed.png')

/* ---------- 6. 回到当前题入口 ---------- */
const backLatest = await cdp.evaluate(`return !![...document.querySelectorAll('button')].find(b=>/回到当前题/.test(b.textContent)&&b.getBoundingClientRect().width>0)`)
ok(backLatest, '回看历史题时提供「回到当前题」入口')

/* ---------- 7. 布局审计：页面级横向溢出（R9-③ 红框回归），胶片/回看新增控件不撑破容器 ---------- */
const audit = await cdp.evaluate(`return (() => {
  const page = document.querySelector('.page')
  const docW = document.documentElement.clientWidth
  const hOverflow = document.documentElement.scrollWidth > docW + 2
    ? ('doc.sw=' + document.documentElement.scrollWidth + ' cw=' + docW) : null
  const pageOverflow = page && page.scrollWidth > page.clientWidth + 2
    ? ('page.sw=' + page.scrollWidth + ' cw=' + page.clientWidth) : null
  return { hOverflow, pageOverflow }
})()`)
ok(!audit.hOverflow, '文档级无横向溢出（' + (audit.hOverflow ?? 'OK') + '）')
ok(!audit.pageOverflow, '练习页容器无横向溢出（' + (audit.pageOverflow ?? 'OK') + '）')

/* ---------- 8. 精确还原到测试前初始形态 ---------- */
const db2 = new DatabaseSync(join(process.cwd(), 'data', 'app.db'))
db2.exec('PRAGMA busy_timeout=8000')
const ph = qids.map(() => '?').join(',')
const delAttempts = db2.prepare(`DELETE FROM attempts WHERE question_id IN (${ph})`).run(...qids).changes
let srsRestored = 0
for (const { id, row } of srsBefore) {
  db2.prepare('DELETE FROM srs WHERE question_id=?').run(id)
  if (row) {
    db2.prepare(`INSERT INTO srs(question_id,stability,difficulty,reps,lapses,state,due,last_review,avg_score,weight)
                 VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id, row.stability, row.difficulty, row.reps, row.lapses, row.state, row.due, row.last_review, row.avg_score, row.weight)
    srsRestored++
  }
}
db2.prepare('DELETE FROM node_mastery WHERE node_id=?').run(nodeId)
let masteryRestored = false
if (masteryBefore) {
  const cols = Object.keys(masteryBefore).filter((c) => c !== 'node_id')
  db2.prepare(`INSERT INTO node_mastery(node_id,${cols.join(',')}) VALUES(?${cols.map(() => ',?').join('')})`)
    .run(nodeId, ...cols.map((c) => masteryBefore[c]))
  masteryRestored = true
}
db2.close()
console.log('  清理：删除 attempts', delAttempts, '条；还原 srs', srsRestored, '个；mastery', masteryRestored ? '恢复初始行' : '删除（原本无行）')

const db3 = new DatabaseSync(join(process.cwd(), 'data', 'app.db'))
const remain = db3.prepare(`SELECT COUNT(*) c FROM attempts WHERE question_id IN (${ph})`).get(...qids).c
const srsNow = db3.prepare(`SELECT reps,state FROM srs WHERE question_id IN (${ph})`).all(...qids)
const srsOk = srsNow.length === srsBefore.filter((x) => x.row).length && srsNow.every((r) => r.reps === 0 && r.state === 0)
const mNow = db3.prepare('SELECT answered,lit,scale4,mastery_level FROM node_mastery WHERE node_id=?').get(nodeId)
const masteryOk = masteryBefore ? (mNow && mNow.answered === masteryBefore.answered && mNow.lit === masteryBefore.lit) : !mNow
db3.close()
ok(remain === 0, '清理后该考点题目回到零作答（用户基线未污染）')
ok(srsOk, 'srs 恢复测试前占位形态（reps=0/state=0）')
ok(masteryOk, '考点 mastery 恢复测试前初始态')

const errs = cdp.errors().filter((e) => !/Failed to load resource|favicon|DevTools|INEFFECTIVE_DYNAMIC/.test(e.text))
console.log('\n控制台错误（过滤无关后）:', errs.length ? errs.slice(0, 5) : '无')
await cdp.close()
console.log(bad.length ? `\n❌ R10 回看联调 ${bad.length} 项失败: ${bad.join(' | ')}` : '\n✅ R10 练习回看 + 蒙题纠偏真机联调全部通过（数据已清理）')
process.exit(bad.length ? 1 : 0)
