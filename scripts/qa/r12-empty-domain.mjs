#!/usr/bin/env node
// R12 空板块「白屏退不出」修复的真机联调（Electron CDP）。
// 只点击、不作答、不落任何学习数据：
//  1. 进介绍页，5 张领域卡都在
//  2. 点真空板块「公共基础 cs / 工程难题 eng」：新后端不建会话，前端拦截在 intro、不白屏、
//     弹 warning、卡片置灰「建设中」
//  3. 反向回归：「后端 be」其实有 3 考点 6 题（JDBC），必须能正常启动出题，不被误置灰
//  4. running 兜底空态：强制 running 且 cur=null 时，也有「返回板块选择」出口
//  5. 正常板块「前端 fe」仍能正常启动（不破坏 R9~R11）
//  6. 无横向溢出、无控制台报错；全程零作答、零学习数据污染，测试会话测后清理
import { Cdp, sleep, AUDIT_JS } from './cdp.mjs'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

const bad = []
const ok = (c, m) => { if (!c) bad.push(m); console.log(`  ${c ? 'OK ' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1 }

const dbPath = join(process.cwd(), 'data', 'app.db')
const openDb = () => { const d = new DatabaseSync(dbPath); d.exec('PRAGMA busy_timeout=8000'); return d }

const EMPTY = ['公共基础', '工程难题'] // cs / eng：当前确无 L4 考点与题
const USABLE = ['后端', '前端']       // be(3考点6题) / fe：必须可用

const db0 = openDb()
const baseline = {
  sessions: db0.prepare('SELECT COUNT(*) c FROM placement_session').get().c,
  turns: db0.prepare('SELECT COUNT(*) c FROM placement_turn').get().c,
  attempts: db0.prepare('SELECT COUNT(*) c FROM attempts').get().c,
  emptyActive: db0.prepare("SELECT COUNT(*) c FROM placement_session WHERE domain IN ('cs','eng') AND status='active'").get().c
}
// 测试隔离（R14 起点卡片默认续测）：收口 fe 未完成会话（仅状态变更、不删数据），保证第 5 步点 fe 卡片必新建测试会话。
const aborted0 = db0.prepare("UPDATE placement_session SET status='aborted', updated_at=datetime('now','localtime') WHERE domain='fe' AND status='active'").run().changes
db0.close()
console.log('测试前基线：', JSON.stringify(baseline), '| 收口 fe 未完成会话', aborted0)

const cdp = await Cdp.connect(20)
await cdp.metrics(1460, 920)
cdp.clearErrors()
const vis = (sel) => `[...document.querySelectorAll(${JSON.stringify(sel)})].filter(e=>e.getBoundingClientRect().width>0)`

/* ---------- 1. 进介绍页，5 张领域卡齐全 ---------- */
await cdp.nav('/placement')
await sleep(1300)
await cdp.evaluate(`[...document.querySelectorAll('button')].find(b=>/退出/.test(b.textContent)&&b.getBoundingClientRect().width>0)?.click(); return 1`)
await sleep(700)
const cardCount = await cdp.evaluate(`return ${vis('.domain-card')}.length`)
ok(cardCount === 5, '介绍页渲染 5 张板块卡片（实际 ' + cardCount + '），不再是整页空白')

/* ---------- 2. 点两个真空板块：应被拦截在 intro，不进 running、不建会话 ---------- */
for (const name of EMPTY) {
  const clicked = await cdp.evaluate(`
    const c=${vis('.domain-card')}.find(x=>new RegExp(${JSON.stringify(name)}).test(x.textContent)); if(c){c.click();return 1} return 0`)
  ok(clicked === 1, `点击空板块「${name}」`)
  await sleep(900)
  const st = await cdp.evaluate(`return {
    stillIntro: ${vis('.domain-card')}.length > 0,
    hasStem: !!document.querySelector('.stem'),
    warned: /题库还在建设|建设中|暂时无法摸底/.test(document.body.innerText),
    cardDisabled: (()=>{const c=${vis('.domain-card')}.find(x=>new RegExp(${JSON.stringify(name)}).test(x.textContent));return c?c.disabled:'no-card'})(),
    hasPill: (()=>{const c=${vis('.domain-card')}.find(x=>new RegExp(${JSON.stringify(name)}).test(x.textContent));return !!c?.querySelector('.building-pill')})()
  }`)
  ok(st.stillIntro, `「${name}」点击后停留在介绍页（未切 running、不白屏）`)
  ok(!st.hasStem, `「${name}」没有进入答题页（无题干）`)
  ok(st.warned, `「${name}」弹出题库建设中的明确提示`)
  ok(st.cardDisabled === true && st.hasPill, `「${name}」卡片置灰并标注「建设中」`)
}
await cdp.shot('data/qa/r12-empty-blocked.png')
const buildingCount = await cdp.evaluate(`return ${vis('.building-pill')}.length`)
ok(buildingCount === 2, 'cs/eng 两个空板块都被标记建设中（实际 ' + buildingCount + '），be 未被误伤')

const db1 = openDb()
const noEmptySession = db1.prepare("SELECT COUNT(*) c FROM placement_session WHERE domain IN ('cs','eng') AND status='active'").get().c
const totalNow = db1.prepare('SELECT COUNT(*) c FROM placement_session').get().c
db1.close()
ok(noEmptySession === baseline.emptyActive, '点击空板块未产生任何 cs/eng 空会话（' + noEmptySession + '/' + baseline.emptyActive + '）——僵尸来源根治')
ok(totalNow === baseline.sessions, '空板块点击后 placement_session 总数不变（' + totalNow + '/' + baseline.sessions + '）')

/* ---------- 3. 反向回归：be 有内容，必须能正常启动出题、不置灰 ---------- */
const beCard = await cdp.evaluate(`
  const c=${vis('.domain-card')}.find(x=>/后端/.test(x.textContent));
  return { disabled: c ? c.disabled : 'no-card', pill: !!c?.querySelector('.building-pill') }`)
ok(beCard.disabled === false && beCard.pill === false, '后端板块卡片可点且无「建设中」标记（内容完整，未被误伤）')
await cdp.evaluate(`const c=${vis('.domain-card')}.find(x=>/后端/.test(x.textContent));if(c)c.click();return 1`)
await cdp.waitFor("!!document.querySelector('.stem')", 20000, '后端摸底首题正常出题')
await sleep(500)
const beRunning = await cdp.evaluate(`return {
  stem: !!document.querySelector('.stem'),
  nodeCount: (document.querySelector('.pl-toolbar')?.innerText.match(/探\\s*\\d+\\s*\\/\\s*(\\d+)/)||[])[1] || '?',
  exit: !!${vis('.pl-toolbar button')}.find(b=>/退出/.test(b.textContent))
}`)
ok(beRunning.stem, '后端板块首题题干正常渲染（JDBC 题库可用）')
ok(beRunning.nodeCount === '3', '后端板块显示 3 个考点（实际 ' + beRunning.nodeCount + '），是小而完整而非空壳')
ok(beRunning.exit, '后端摸底进行中有「退出」入口')
await cdp.shot('data/qa/r12-be-usable.png')
// 退出回 intro
await cdp.evaluate(`${vis('.pl-toolbar button')}.find(b=>/退出/.test(b.textContent))?.click();return 1`)
await sleep(700)
ok((await cdp.evaluate(`return ${vis('.domain-card')}.length > 0`)) === true, '后端摸底可正常退出回介绍页')

/* ---------- 4. running 兜底空态：强制 running 且无题，验证必有「返回」出口 ---------- */
const forced = await cdp.evaluate(`
  const page=document.querySelector('.page');let inst=page?.__vueParentComponent;let hops=0;
  while(inst&&hops<16){const st=inst.setupState;if(st&&'phase' in st){
    // setupState 中的 ref 已被 Vue 自动解包为普通值，直接赋值即可（不能再 .value）
    st.phase='running'; st.item=null; return true
  }inst=inst.parent;hops++}
  return false`)
ok(forced === true, '能强制构造 running 且无题的极端状态（验证兜底分支）')
await sleep(500)
const emptyState = await cdp.evaluate(`return {
  emptyCard: !!${vis('.pl-empty')}[0],
  backBtn: !![...document.querySelectorAll('button')].find(x=>/返回板块选择/.test(x.textContent)&&x.getBoundingClientRect().width>0),
  exitInToolbar: !![...document.querySelectorAll('.pl-toolbar button')].find(x=>/退出/.test(x.textContent)),
  notBlank: (document.querySelector('.page')?.innerText.trim().length||0) > 0
}`)
ok(emptyState.emptyCard, 'running 无题时渲染兜底空态 .pl-empty，而非整页空白')
ok(emptyState.backBtn, '兜底空态提供「返回板块选择」出口——白屏退不出被根治')
ok(emptyState.exitInToolbar, '兜底空态 toolbar 仍有「退出」（双保险）')
ok(emptyState.notBlank, '页面有可见文案，不再全空白')
await cdp.shot('data/qa/r12-running-empty-fallback.png')
await cdp.evaluate(`[...document.querySelectorAll('button')].find(x=>/返回板块选择/.test(x.textContent)&&x.getBoundingClientRect().width>0)?.click();return 1`)
await sleep(700)
ok((await cdp.evaluate(`return ${vis('.domain-card')}.length > 0`)) === true, '点「返回板块选择」成功回到介绍页')

/* ---------- 5. 回归：正常板块 fe 仍能正常启动出题 ---------- */
const startFe = await cdp.evaluate(`const c=${vis('.domain-card')}.find(x=>/前端/.test(x.textContent));if(c&&!c.disabled){c.click();return 1}return 0`)
ok(startFe === 1, '回归：点击正常板块「前端」可启动')
await cdp.waitFor("!!document.querySelector('.stem')", 20000, '前端摸底首题正常出题')
await sleep(400)
const feOk = await cdp.evaluate(`return {
  stem: !!document.querySelector('.stem'),
  exit: !![...document.querySelectorAll('.pl-toolbar button')].find(x=>/退出/.test(x.textContent)),
  submit: !!${vis('[data-testid="pl-submit"]')}[0]
}`)
ok(feOk.stem && feOk.exit && feOk.submit, '前端板块首题/退出/提交均正常（R9~R11 不被破坏）')
await cdp.shot('data/qa/r12-fe-regression.png')
await cdp.evaluate(`[...document.querySelectorAll('.pl-toolbar button')].find(x=>/退出/.test(x.textContent))?.click();return 1`)
await sleep(700)

/* ---------- 6. 布局 + 控制台 ---------- */
const audit = await cdp.evaluate(AUDIT_JS)
ok(!audit.hOverflow, '文档级无横向溢出（' + (audit.hOverflow ?? 'OK') + '）')
const errs = cdp.errors().filter((e) => !/Failed to load resource|favicon|DevTools|INEFFECTIVE_DYNAMIC/.test(e.text))
console.log('\n控制台错误（过滤无关后）:', errs.length ? errs.slice(0, 5).map((e) => e.text) : '无')
ok(errs.length === 0, '无控制台报错')
await cdp.close()

/* ---------- 7. 零污染核对 + 清理本次新建的 0-turn 测试会话 ---------- */
const db2 = openDb()
const candidates = db2.prepare(
  "SELECT id,created_at FROM placement_session WHERE id NOT IN (SELECT DISTINCT session_id FROM placement_turn)").all()
let removed = 0
for (const r of candidates) {
  // created_at 是 UTC（如 2026-11-11 07:45:36），按 Z 解析；本机时区 (+08:00) 由 Date 自动换算
  const ageMin = (Date.now() - new Date(r.created_at.replace(' ', 'T') + 'Z').getTime()) / 60000
  if (ageMin < 8) { db2.prepare('DELETE FROM placement_session WHERE id=?').run(r.id); removed++ }
}
const fin = {
  sessions: db2.prepare('SELECT COUNT(*) c FROM placement_session').get().c,
  turns: db2.prepare('SELECT COUNT(*) c FROM placement_turn').get().c,
  attempts: db2.prepare('SELECT COUNT(*) c FROM attempts').get().c
}
const legacyKept = !!db2.prepare("SELECT id FROM placement_session WHERE id='a52be7d5'").get()
db2.close()
console.log('     清理本次新建 0-turn 测试会话', removed, '个')
ok(fin.turns === baseline.turns, 'placement_turn 无新增作答（' + fin.turns + '/' + baseline.turns + '）——零学习数据污染')
ok(fin.attempts === baseline.attempts, 'attempts 无新增（' + fin.attempts + '/' + baseline.attempts + '）')
ok(fin.sessions === baseline.sessions, 'placement_session 回到基线（' + fin.sessions + '/' + baseline.sessions + '）')
ok(legacyKept, '历史摸底会话 a52be7d5 原样保留')

console.log(bad.length ? `\n❌ R12 空板块兜底联调 ${bad.length} 项失败: ${bad.join(' | ')}` : '\n✅ R12 空板块「不白屏、能退出、be/fe 正常板块不受影响」真机联调全部通过')
process.exit(bad.length ? 1 : 0)
