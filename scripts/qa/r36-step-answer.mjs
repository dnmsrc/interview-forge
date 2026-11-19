// R36：卡住了要有兜底——同一步连续失败 3 次后，直接给「这一步的正确答案」
//
// 用户的反馈是：诊断说了「__raw 要单开一个分支」，但他还是不知道那几行怎么写。
// 提示能缩小朋友圈，却替代不了「正确的写法长什么样」。这一轮加：
//   - 同一步连续红 3 次 → 失败横幅里出现「直接看这一步的答案」；
//   - 答案只含「到这一步为止」的代码，后面几步一行都没有（构建期自检 + 这里再验一次）；
//   - 门槛由主进程判（服务端重数一次失败次数），前端按钮只是入口；
//   - 不扣 XP，但记下「这步看过答案」，关卡详情里如实标出来。
//
// 破坏性：会连续跑红 3~4 次并覆盖草稿。连的是隔离实例（instance=2 / CDP 9223），
// 不碰用户那份 data/。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Cdp, sleep } from './cdp.mjs'
import { runLevel } from '../../src/shared/project-core.mjs'

const bad = []
const ok = (c, m) => { if (!c) bad.push(m); console.log(`  ${c ? 'OK ' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1 }

const root = join(import.meta.dirname, '..', '..')
const pid = 'mini-vue-reactivity'
const content = JSON.parse(readFileSync(join(root, 'content', 'projects', `${pid}.json`), 'utf8'))
const contentLv = content.levels[0]
const STEP1 = contentLv.stages[0].code
const STEP2 = contentLv.stages[1].code
const STEP3 = contentLv.stages[2]
const STEP4 = contentLv.stages[3]

/** 用户截图里那份「漏了 __raw 特判」的实现：第 2 步必然跑红 */
const MISSING_RAW = `function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      return Reflect.get(t, key, receiver)
    }
  })
}
`

/* ---------------- A. 契约接线 ---------------- */
console.log('\n— A. IPC 契约接线 —')
const apiSrc = readFileSync(join(root, 'src/shared/api.ts'), 'utf8')
const ipcSrc = readFileSync(join(root, 'src/main/ipc.ts'), 'utf8')
const svcSrc = readFileSync(join(root, 'src/main/services/project.ts'), 'utf8')
ok(/project:\s*\[[^\]]*'stepAnswer'/.test(apiSrc), "API_METHODS.project 含 'stepAnswer'")
ok(/stepAnswer\(projectId: string, levelId: string, step: number\)/.test(apiSrc), 'ForgeApi.project.stepAnswer 签名以 step: number 收尾（不让前端传「我失败过几次」）')
ok(/async stepAnswer\(projectId, levelId, step\)[\s\S]*?projectStepAnswer/.test(ipcSrc), 'ipc.ts 把 stepAnswer 转到 projectStepAnswer')
ok(/export function projectStepAnswer/.test(svcSrc), 'project.ts 导出 projectStepAnswer')
ok(/fails < ANSWER_AFTER/.test(svcSrc), '放行前在服务端重数一次失败次数（不信前端）')

const cdp = await Cdp.connect()
const call = (b) => cdp.evaluate(`return await (${b})()`)
const send = (b) => cdp.evaluate(b)
/** IPC 调用并接住异常：服务端拒绝时要看错误文案，不能把脚本崩掉 */
const callTry = (b) => cdp.evaluate(`
  try { return { ok: true, v: await (${b})() } }
  catch (e) { return { ok: false, msg: String((e && e.message) || e) } }
`)

const detail = () => call(`async () => window.forge.project.detail(${JSON.stringify(pid)})`)
const lvOf = async () => (await detail()).levels[0]
const saveDraft = (code) => call(`async () => window.forge.project.saveDraft(${JSON.stringify(pid)}, 'lv1', ${JSON.stringify(code)})`)
const resetLevel = () => call(`async () => window.forge.project.resetLevel(${JSON.stringify(pid)}, 'lv1')`)
const answerOf = (step) => callTry(`async () => window.forge.project.stepAnswer(${JSON.stringify(pid)}, 'lv1', ${step})`)
const localStorageKey = `lf.stageStart.${pid}.lv1`
const clearSnapshot = () => send(`
  localStorage.removeItem(${JSON.stringify(localStorageKey)});
  sessionStorage.removeItem(${JSON.stringify(localStorageKey)});
  localStorage.removeItem('lf.stepSnaps.mini-vue-reactivity.lv1');
  return 1
`)
/** 摆一个「推进到第 1 步时的代码」快照：让页面处于「人改过代码 → 红字照给」的正常状态 */
const setSnapshot = (stageN, code) => send(`
  localStorage.setItem(${JSON.stringify(localStorageKey)}, ${JSON.stringify(JSON.stringify({ stageN, code }))});
  sessionStorage.removeItem(${JSON.stringify(localStorageKey)});
  return 1
`)
/**
 * 在编辑器里真的改代码。
 *
 * R38 之后「动没动笔」= 当前代码 vs 这一步开始时的代码，靠 saveDraft 换草稿等于换起点，
 * 会被判成「还没开始写」。要制造「写了半成品并跑红」，必须走输入事件。
 */
async function typeCode(code) {
  await send(`
    const ta = document.querySelector('textarea.ce-ta')
    ta.value = ${JSON.stringify(code)}
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    return 1
  `)
  await sleep(350)
}

async function reload() {
  await cdp.reloadHard(2600)
  await cdp.waitFor(`!!document.querySelector('.work-toolbar')`, 25000, '工具条渲染')
  await sleep(700)
}
async function runOnce() {
  await cdp.clickText('下一步')
  await cdp.waitFor(`document.querySelectorAll('.result .fb').length > 0`, 20000, '结果面板出现')
  await cdp.waitFor(`[...document.querySelectorAll('button')].some(b => /^下一步$/.test((b.textContent||'').trim()))`, 20000, '运行结束')
  await sleep(450)
}

/** 页面状态：失败横幅里的兜底入口 + 答案面板 + 编辑器内容 */
const ui = () => cdp.evaluate(`
  const vis = (el) => {
    if (!el) return false
    if (el.closest('details:not([open])')) return false
    const st = getComputedStyle(el)
    if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) < 0.05) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const txt = (el) => el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : ''
  const q = (s) => [...document.querySelectorAll(s)].find(vis) || null
  const ta = document.querySelector('textarea.ce-ta')
  return {
    redPanel: !!q('.result .fb.bad.fail-panel'),
    expandBtn: txt(q('.result .soft-expand')),
    failTitle: txt(q('.result .fb.bad.fail-panel h4')),
    foot: txt(q('.answer-foot')),
    hasBtn: !!q('.answer-btn'),
    btn: txt(q('.answer-btn')),
    panelTitle: txt(q('.answer-panel h4')),
    panelCode: txt(q('.answer-code')),
    panelActs: [...document.querySelectorAll('.answer-acts button')].filter(vis).map(txt),
    editor: ta ? ta.value : ''
  }
`)

/* ========== B. 干净起点：先过第 1 步 ========== */
console.log('\n— B. 干净起点：先过第 1 步 —')
// 隔离实例是新起的：先落到关卡页（hash 路由），否则刷新后停在首页、没有工具条
await cdp.nav('/projects/mini-vue-reactivity/lv1')
await sleep(1500)
await cdp.waitFor(`!!document.querySelector('.work-toolbar')`, 25000, '关卡页渲染')
await resetLevel()
const before = await lvOf()
ok(Object.keys(before.stageFails ?? {}).length === 0, `干净库没有失败计数（${JSON.stringify(before.stageFails)}）`)
ok((before.answerSteps ?? []).length === 0, '干净库没有「看过答案」的记录')
await saveDraft(STEP1)
await clearSnapshot()
await reload()
await runOnce()
const bUi = await ui()
ok(/第 1 步/.test(bUi.failTitle === '' ? '第 1 步' : bUi.failTitle) || bUi.failTitle === '', '第 1 步通过、第 2 步待写时没有失败横幅')
const bLv = await lvOf()
ok(bLv.stageDone.includes(1), `第 1 步已记入 progress（stageDone=[${bLv.stageDone}]）`)

/* ========== C~E. 连续跑红三次：计数要看得见、按钮到第 3 次才出 ========== */
console.log('\n— C. 第 1 次跑红：提示「已错 1/3」，不给答案 —')
// 当前站在第 2 步，起点是第 1 步的代码；在编辑器里写一个漏 __raw 的半成品 = 人确实动过笔，
// 红字与计数必须直接摊开（没动笔的那一档才收着）。
await typeCode(MISSING_RAW)
await runOnce()
const C = await ui()
console.log('   foot :', C.foot)
ok(/还有 1 处没做到/.test(C.failTitle), `失败横幅点名第 2 步（${C.failTitle}）`)
ok(/连续错满 3 次/.test(C.foot) && /1\/3/.test(C.foot), `入口处写清「已错 1/3 次」（${C.foot.slice(0, 60)}…）`)
ok(!C.hasBtn, '第 1 次失败没有答案按钮（第一次红是试错，不是卡住）')
ok(!/第 2 步的正确写法/.test(C.panelTitle), '答案面板还没出现')
let lv = await lvOf()
ok(lv.stageFails?.['2'] === 1, `服务端记下第 2 步失败 1 次（${JSON.stringify(lv.stageFails)}）`)

// 服务端门槛：没到 3 次的步骤不给答案
const early = await answerOf(2)
ok(early.ok === false && /再试 2 次/.test(early.msg), `直接调 IPC 也被拒（${early.msg}）`)

console.log('\n— D. 第 2 次跑红：2/3 —')
await runOnce()
const D = await ui()
ok(/2\/3/.test(D.foot), `「已错 2/3 次」（${D.foot.slice(0, 60)}…）`)
ok(!D.hasBtn, '还差一次，按钮仍不出现')

console.log('\n— E. 第 3 次跑红：按钮出现 —')
await runOnce()
const E = await ui()
console.log('   foot :', E.foot)
console.log('   btn  :', E.btn)
ok(/卡了 3 次了/.test(E.btn), `按钮文案点明「卡了 3 次了」（${E.btn}）`)
ok(E.hasBtn, '门槛到了，入口变成按钮')
ok(!/1\/3|2\/3/.test(E.foot), '原先的「还差几次」提示已收起（按钮取代它）')
lv = await lvOf()
ok(lv.stageFails?.['2'] === 3, `服务端记到 3 次（${JSON.stringify(lv.stageFails)}）`)
await cdp.shot('data/qa/r36-answer-entry.png')

/* ========== F. 服务端的门：只放当前卡住的那一步 ========== */
console.log('\n— F. 服务端门槛：只放第 2 步 —')
const s3 = await answerOf(3)
ok(s3.ok === false && /再试 3 次/.test(s3.msg), `第 3 步没失败过，拒绝（${s3.msg}）`)
const s1 = await answerOf(1)
ok(s1.ok === false, `第 1 步已经做过，不放「答案」（${s1.msg}）`)
const s2 = await answerOf(2)
ok(s2.ok === true, '第 2 步满 3 次，放行')
ok(s2.v?.step === 2, '回包里带的是第 2 步')
ok(typeof s2.v?.code === 'string' && s2.v.code.includes("key === '__raw'"), '答案里有 __raw 那个分支（正是用户缺的那句）')

/* ========== G. 答案的边界：能过本步、不含后面几步 ========== */
console.log('\n— G. 答案边界：到这一步为止，不泄漏后面 —')
ok(s2.v.code === STEP2, '返回的就是内容源里第 2 步的完整代码（不是整关参考解）')
ok(!/set\(|deleteProperty|__setCount/.test(s2.v.code.replace(/\/\/.*$/gm, '')), '答案里没有 set / delete / 计数器的实现（第 3 步才写）')
const futureRuns = []
for (const [i, st] of [[2, STEP3], [3, STEP4]]) {
  const r = await runLevel(s2.v.code, st.test, { timeoutMs: 4000 })
  futureRuns.push(`第 ${i + 1} 步测试 ${r.ok ? '竟然通过' : '如期不通过'}`)
  ok(!r.ok, `拿这份答案去跑第 ${i + 1} 步的测试：${r.ok ? '通过了（说明泄漏了后面）' : '不通过（符合预期）'}`)
}
console.log('   ', futureRuns.join(' / '))
const ownRun = await runLevel(s2.v.code, contentLv.stages[1].test, { timeoutMs: 4000 })
ok(ownRun.ok, `这份答案自己能过第 2 步的 ${ownRun.cases.length} 个检查点（${ownRun.cases.filter((c) => c.ok).length}/${ownRun.cases.length}）`)

/* ========== H. 点按钮 → 面板出现，可填进编辑器 ========== */
console.log('\n— H. 点「直接看这一步的答案」—')
await cdp.clickText('卡了 3 次了')
await cdp.waitFor(`!!document.querySelector('.answer-panel')`, 8000, '答案面板出现')
await sleep(300)
const H = await ui()
ok(/第 2 步的正确写法/.test(H.panelTitle), `面板标题点明是哪一步（${H.panelTitle}）`)
ok(/__raw/.test(H.panelCode), '面板里的代码含 __raw 分支')
ok(H.panelCode.includes('new Proxy'), '面板里是完整的一段实现，不是零散片段')
ok(H.panelActs.some((t) => /填进编辑器/.test(t)) && H.panelActs.some((t) => /先不看/.test(t)), `面板给两个选择（${H.panelActs.join(' / ')}）`)
await cdp.shot('data/qa/r36-answer-panel.png')

/* ========== I. 刷新后：答案还在、可再看一次 ========== */
console.log('\n— I. 刷新一次：answerSteps 落库，「再看一次」还在 —')
await reload()
lv = await lvOf()
ok((lv.answerSteps ?? []).includes(2), `服务端记下「第 2 步参考过答案」（answerSteps=[${lv.answerSteps}]）`)
ok(lv.stages[1].code !== null, '答案下发过之后，详情里这一步的代码保留（刷新不用再卡三轮）')
await runOnce()
const I = await ui()
ok(/再看一次这一步的答案/.test(I.btn), `按钮变成「再看一次」（${I.btn}）`)
ok(/已参考过答案/.test(I.foot), '入口处如实标出「已参考过答案」')

/* ========== J. 填进编辑器 → 跑通第 2 步 ========== */
console.log('\n— J.「填进编辑器」→ 第 2 步跑通 —')
await cdp.clickText('再看一次这一步的答案')
await cdp.waitFor(`!!document.querySelector('.answer-panel')`, 8000, '答案面板再次出现')
await cdp.clickText('填进编辑器')
await sleep(1200)
const J = await ui()
ok(J.editor.includes("key === '__raw'"), '编辑器里已经是答案的代码')
await runOnce()
const jUi = await ui()
ok(jUi.failTitle === '' || !/没做到/.test(jUi.failTitle), `第 2 步跑绿（失败横幅消失：${jUi.failTitle || '无'}）`)
lv = await lvOf()
ok(lv.stageDone.includes(2), `第 2 步记入进度（stageDone=[${lv.stageDone}]）`)
ok(!(lv.stageFails?.['2'] > 0), `通过后失败计数清零（${JSON.stringify(lv.stageFails)}）`)
ok((lv.answerSteps ?? []).includes(2), '「参考过答案」的记录仍在（通过不清它）')
await cdp.shot('data/qa/r36-step2-passed.png')

/* ========== K. 从零重做：连答案记录一起清掉 ========== */
console.log('\n— K. 从零重做：计数与「参考过答案」一并归零 —')
await resetLevel()
const K = await lvOf()
ok(Object.keys(K.stageFails ?? {}).length === 0, `重置后失败计数清空（${JSON.stringify(K.stageFails)}）`)
ok((K.answerSteps ?? []).length === 0, `重置后「参考过答案」清空（[${K.answerSteps}]）`)
ok(K.stageDone.length === 0, '重置后步骤进度回到起点')
// 第一次跑：什么都没写（还是骨架）。这种「没动笔」不该消耗一次机会。
await saveDraft(contentLv.skeleton)
await clearSnapshot()
await reload()
await runOnce()
const K1 = await lvOf()
const k1Fails = Object.keys(K1.stageFails ?? {})
ok(k1Fails.length === 0, `重置后「没动笔就跑」不记账（${JSON.stringify(K1.stageFails)}）`)
// 真写了（而且一步跨过第 1 步）之后再跑。
// R41 之后：连续失败只记「我正站着的那一步」。跨步写的这份代码就是第 2 步的起点，
// 所以推进时那一跑不算第 2 步的失败；站到第 2 步再改一处、再跑，才是第 1 次。
await typeCode(MISSING_RAW)
await runOnce()
const K2 = await ui()
ok(!K2.redPanel, '跨步写了下一步：红字默认收着（写的是上一步，不是这一步）')
ok(/我已经写了/.test(K2.expandBtn), `绿条给出展开入口（${K2.expandBtn}）`)
const K2lv = await lvOf()
ok(!(K2lv.stageFails?.['2'] > 0), `跨步那一跑不算第 2 步的失败（${JSON.stringify(K2lv.stageFails)}）`)
// 站到第 2 步、真的再动一处：这次红才是这一步自己的第一次失败
await typeCode(MISSING_RAW.replace('return Reflect.get(t, key, receiver)', 'return Reflect.get(t, key)'))
await runOnce()
// 这次是在「正在做的那一步」真改了代码再跑红的，红字会直接摊开；
// 只有「跨步写、判断不了写没写」时才需要点「我已经写了」。
const K2pre = await ui()
if (!K2pre.redPanel) {
  await cdp.clickText('我已经写了')
  await cdp.waitFor(`!!document.querySelector('.result .fb.bad.fail-panel')`, 8000, '红面板展开')
  await sleep(350)
}
const K2b = await ui()
ok(/1\/3/.test(K2b.foot), `点开后从 1/3 重新数起（${K2b.foot.slice(0, 50)}…）`)
const K3 = await lvOf()
ok(K3.stageFails?.['2'] === 1, `服务端也记成 1 次（${JSON.stringify(K3.stageFails)}）`)

/* ---------------- 收尾 ---------------- */
await resetLevel()
console.log(`\n${bad.length ? `✗ ${bad.length} 项未通过` : '✓ 全部通过'}`)
if (bad.length) { for (const m of bad) console.error('  -', m) }
await cdp.close()
process.exit(bad.length ? 1 : 0)