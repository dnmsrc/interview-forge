// R34：刚过一步、下一步还没写时，面板该说「第 N 步过了」，不该甩一脸红
// 现场就是用户的第 1 关：stageDone=[1]、草稿停在「什么都不改也能用」的实现上。
import { Cdp, sleep } from './cdp.mjs'

const bad = []
const ok = (c, m) => { if (!c) bad.push(m); console.log(`  ${c ? 'OK ' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1 }
const cdp = await Cdp.connect()
const call = (b) => cdp.evaluate(`return await (${b})()`)

const pid = 'mini-vue-reactivity'
const d0 = await call(`async () => window.forge.project.detail(${JSON.stringify(pid)})`)
const l1 = d0.levels[0]
const lid = l1.id
const origDraft = l1.draft
console.log(`\n— 0. 起点 —\n   ${pid}/${lid}: done=${l1.done} attempts=${l1.attempts} stageDone=[${l1.stageDone}] draftLen=${origDraft.length}`)
ok(l1.done === false && l1.stageDone.includes(1), '第 1 关：第 1 步已过、整关未通关（正是用户截图那一幕）')

/** 把页面切到「第 1 关、刚跑完一次测试」的样子 */
async function openLevel() {
  await cdp.nav(`/projects/${pid}/${lid}`)
  await cdp.waitFor(`!!document.querySelector('.work-pane .cm-content, .work-pane textarea, .work-pane pre')`, 20000, '关卡页就绪')
  await sleep(900)
}

async function runOnce() {
  const before = await cdp.evaluate(`return document.querySelectorAll('.result .fb').length`)
  await cdp.clickText('跑测试')
  await cdp.waitFor(`document.querySelectorAll('.result .fb').length > 0`, 20000, '结果面板出现')
  // 再跑一次时结果面板本来就在：等 running 结束（按钮文案回到「跑测试」）
  await cdp.waitFor(`!document.querySelector('.result .fb') || [...document.querySelectorAll('button')].some(b => /^跑测试$/.test((b.textContent||'').trim()))`, 20000, '运行结束')
  await sleep(500)
  return before
}

const state = () => cdp.evaluate(`
  const vis = (el) => {
    if (!el) return false
    const st = getComputedStyle(el)
    if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) < 0.05) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const txt = (el) => el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : ''
  const q = (s) => [...document.querySelectorAll(s)].find(vis) || null
  const pend = q('.stage-result.pending')
  return {
    failBanner: txt(q('.result .fb.bad.fail-panel')),
    nextBanner: txt(q('.result .fb.ok.next-panel')),
    hasResult: !!q('.result'),
    chip: txt(q('.todo-chip')),
    badFlags: [...document.querySelectorAll('.stage-flag.bad')].filter(vis).map(txt),
    stageFlags: [...document.querySelectorAll('.stage-acc > summary .stage-flag')].filter(vis).map(txt),
    pendingTitle: pend ? txt(pend.querySelector('.stage-result-title')) : '',
    pendingTag: pend ? txt(pend.querySelector('.stage-result-tag')) : '',
    pendingOpen: pend ? !!(pend.querySelector('details.pending-cases') || {}).open : null,
    pendingCasesInsideDetails: pend ? !!pend.querySelector('details.pending-cases .cases') : false,
    looseRedCasesInPending: pend ? pend.querySelectorAll(':scope > .cases').length : 0,
    stageResultCount: [...document.querySelectorAll('.stage-result')].length,
  }
`)

/* ---------- 1. 干净载入：没有结果面板 ---------- */
console.log('\n— 1. 刷新后重新点一次「跑测试」—')
await cdp.reloadHard(2600)
await cdp.waitFor(`!!document.querySelector('.work-toolbar')`, 25000, '工具条渲染')
await sleep(700)
const s0 = await state()
ok(s0.hasResult === false, '刚刷新时没有结果面板（不残留上一次的红）')
await runOnce()
const s1 = await state()
console.log('   ', JSON.stringify(s1))
ok(s1.failBanner === '', '没有「还有 N 个检查点没过」的红条')
ok(/第 1 步已经过了/.test(s1.nextBanner), `面板说的是「第 1 步已经过了」（实际：${s1.nextBanner.slice(0, 40)}…）`)
ok(/第 2 步/.test(s1.nextBanner) && /还没开始写/.test(s1.nextBanner), '并指出第 2 步还没开始写')
ok(/第 1 步过了 · 现在做第 2 步/.test(s1.chip), `工具条跟着说「第 1 步过了 · 现在做第 2 步」（实际：${s1.chip}）`)
ok(s1.badFlags.length === 0, '步骤条上没有任何「本次没过」的红标')
ok(s1.stageFlags[0] === '已通过' && s1.stageFlags[1] === '正在做', `步骤条第 1 步「已通过」、第 2 步「正在做」（${s1.stageFlags.join(' / ')}）`)
ok(s1.pendingTitle.includes('第 2 步'), '结果里第 2 步那组被标成「待写」')
ok(s1.pendingTag === '还没开始写', '并明写「还没开始写」')
ok(s1.pendingOpen === false && s1.pendingCasesInsideDetails === true, '第 2 步的检查点收进折叠区，不铺一排红叉')
ok(s1.looseRedCasesInPending === 0, '待写的那组外面没有裸露的红 case 列表')
await cdp.shot('data/qa/r34-step-start.png')

/* ---------- 2. 再点一次：什么都没改，仍然不该红 ---------- */
console.log('\n— 2. 什么都没改动，再点一次「跑测试」—')
await runOnce()
const s2 = await state()
console.log('   ', JSON.stringify(s2))
ok(s2.failBanner === '', '第二次跑（代码没动）仍然没有红条')
ok(/第 1 步已经过了/.test(s2.nextBanner), '仍然是「第 1 步已经过了」')

/* ---------- 3. 跨刷新：sessionStorage 记住「这一步当时的样子」 ---------- */
console.log('\n— 3. 刷新页面后再跑一次（跨刷新判定）—')
await cdp.reloadHard(2600)
await cdp.waitFor(`!!document.querySelector('.work-toolbar')`, 25000, '工具条渲染')
await sleep(700)
await runOnce()
const s3 = await state()
console.log('   ', JSON.stringify(s3))
ok(s3.failBanner === '', '刷新后点跑测试也不该红（快照存在 sessionStorage 里）')
ok(/第 1 步已经过了/.test(s3.nextBanner), '刷新后仍是「第 1 步已经过了」')

/* ---------- 4. 反向：真的改坏了，红条必须回来 ---------- */
console.log('\n— 4. 把代码改坏：真实失败仍要报红 —')
const poisoned = origDraft.replace(
  /new Proxy\(\s*target\s*,\s*\{\s*\}\s*\)/,
  "new Proxy(target, { get() { return 'r34-poison' } })"
)
const poison = poisoned !== origDraft
  ? poisoned
  : origDraft.replace(/return\s+new\s+Proxy\([^)]*\)/, "return new Proxy({}, { get() { return 'r34-poison' } })")
ok(poison !== origDraft, '构造了一份读值被改坏的代码（第 1 步的检查点会失败）')
await call(`async () => window.forge.project.saveDraft(${JSON.stringify(pid)}, ${JSON.stringify(lid)}, ${JSON.stringify(poison)})`)
await cdp.reloadHard(2600)
await cdp.waitFor(`!!document.querySelector('.work-toolbar')`, 25000, '工具条渲染')
await sleep(700)
await runOnce()
const s4 = await state()
console.log('   ', JSON.stringify(s4))
ok(/还有 \d+ (个检查点没过|处没做到)/.test(s4.failBanner), `改坏了就该看见红条（实际：${s4.failBanner.slice(0, 40)}…）`)
ok(s4.nextBanner === '', '此时不再伪装成「还没开始写」')
ok(s4.badFlags.length > 0, '步骤条也标出「本次没过」')
await cdp.shot('data/qa/r34-real-fail.png')

/* ---------- 5. 还原：代码改回去，绿条回来 ---------- */
console.log('\n— 5. 把草稿还原，确认回到「第 1 步过了」—')
await call(`async () => window.forge.project.saveDraft(${JSON.stringify(pid)}, ${JSON.stringify(lid)}, ${JSON.stringify(origDraft)})`)
await cdp.reloadHard(2600)
await cdp.waitFor(`!!document.querySelector('.work-toolbar')`, 25000, '工具条渲染')
await sleep(700)
await runOnce()
const s5 = await state()
console.log('   ', JSON.stringify(s5))
ok(s5.failBanner === '' && /第 1 步已经过了/.test(s5.nextBanner), '草稿还原后回到「第 1 步已经过了」')
await cdp.shot('data/qa/r34-step-start-restored.png')

/* ---------- 6. 收尾：进度与草稿必须是原样 ---------- */
console.log('\n— 6. 收尾复核 —')
const d1 = await call(`async () => window.forge.project.detail(${JSON.stringify(pid)})`)
const l1b = d1.levels[0]
ok(l1b.done === false && l1b.done === l1.done, '整关通关状态没变')
ok(l1b.stageDone.join(',') === l1.stageDone.join(','), `阶段进度没变（[${l1b.stageDone}]）`)
ok(l1b.draft === origDraft, '草稿已还原成用户原来的那份')
const errs = cdp.errors().filter((e) => e.kind === 'exception')
ok(errs.length === 0, `渲染端没有异常（${errs.length} 条）`)

console.log(`\n${bad.length ? `✗ ${bad.length} 项失败` : '✓ 全部通过'}`)
cdp.close()