// R35：检查点跑红时，用户得知道「哪儿错了、怎么改」
//
// 用户截图里那条红只有「期望 { n: 2, dbl: [Getter]… }，实际 undefined」——看不出少写了什么。
// 这一轮给每个失败的检查点配了逐条诊断（主进程按失败位置附加），并把「这一步的提示」搬进结果面板。
//
// R38 之后交互模型变了，这一版按新模型重写：
//   - 编辑器内容按「步骤」各存一份快照；「动没动笔」= 当前代码 vs 这一步开始时的代码；
//   - 没跑过 / 没动笔 → 红字收着；真在编辑器里改过 → 红字直接摊开。
// 因此造状态必须「在编辑器里真的编辑」，不能再靠 saveDraft 换草稿（那等于换起点，会被判成没动笔）。
//
// 破坏性：会 resetLevel。连隔离实例（--instance=2 --own-data / CDP 9223）。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Cdp, sleep } from './cdp.mjs'

const bad = []
const ok = (c, m) => { if (!c) bad.push(m); console.log(`  ${c ? 'OK ' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1 }
const cdp = await Cdp.connect()
const call = (b) => cdp.evaluate(`return await (${b})()`)
const send = (b) => cdp.evaluate(b)

const root = join(import.meta.dirname, '..', '..')
const pid = 'mini-vue-reactivity'
const lv0 = JSON.parse(readFileSync(join(root, 'content', 'projects', `${pid}.json`), 'utf8')).levels[0]
const d0 = await call(`async () => window.forge.project.detail(${JSON.stringify(pid)})`)
const lid = d0.levels[0].id
const stage2hint = d0.levels[0].stages[1].hint

/** 第 1 步的完整实现：一个「还没动笔」的起点 */
const STEP1 = lv0.stages[0].code
/** 第 2 步漏了 __raw 特判：用户截图里的代码形态 */
const MISSING_RAW = `function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      return Reflect.get(t, key, receiver)
    }
  })
}
`
/** 补上 __raw 特判之后的第 2 步 */
const FIXED_RAW = `function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      if (key === '__raw') return t
      return Reflect.get(t, key, receiver)
    }
  })
}
`

const squash = (s) => String(s ?? '').replace(/\s+/g, '')
const setDraft = (code) => call(`async () => window.forge.project.saveDraft(${JSON.stringify(pid)}, ${JSON.stringify(lid)}, ${JSON.stringify(code)})`)
const resetLevel = () => call(`async () => window.forge.project.resetLevel(${JSON.stringify(pid)}, ${JSON.stringify(lid)})`)
const lvOf = async () => (await call(`async () => window.forge.project.detail(${JSON.stringify(pid)})`)).levels[0]
const clearSnaps = () => send(`localStorage.removeItem('lf.stepSnaps.${pid}.${lid}'); return 1`)

async function reload() {
  await cdp.reloadHard(2600)
  await cdp.waitFor(`!!document.querySelector('.work-toolbar')`, 25000, '工具条渲染')
  await sleep(700)
}
async function runOnce() {
  await cdp.clickText('下一步')
  await cdp.waitFor(`document.querySelectorAll('.result .fb').length > 0`, 20000, '结果面板出现')
  await cdp.waitFor(`[...document.querySelectorAll('.work-toolbar button')].some(b => /^下一步$/.test((b.textContent||'').trim()))`, 20000, '运行结束')
  await sleep(450)
}
/** 在编辑器里真的改代码（走 input 事件，和用户敲键盘同一条路径） */
async function typeCode(code) {
  await send(`
    const ta = document.querySelector('textarea')
    ta.value = ${JSON.stringify(code)}
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    return 1
  `)
  await sleep(350)
}

const state = () => cdp.evaluate(`
  const vis = (el) => {
    if (!el) return false
    // 折叠在 details 里的内容浏览器仍会给出 rect，视觉上却看不到——不算可见
    if (el.closest('details:not([open])')) return false
    const st = getComputedStyle(el)
    if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) < 0.05) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const txt = (el) => el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : ''
  const q = (s) => [...document.querySelectorAll(s)].find(vis) || null
  const casesOf = (root) => [...root.querySelectorAll('.case')].filter(vis).map((el) => ({
    name: txt(el.querySelector('.case-name')),
    msg: txt(el.querySelector('.case-msg')),
    diag: txt(el.querySelector('.case-diag')),
    hasDiag: !!el.querySelector('.case-diag'),
    ok: el.classList.contains('ok')
  }))
  const stages = [...document.querySelectorAll('.stage-result')].map((el) => ({
    title: txt(el.querySelector('.stage-result-title')),
    pending: el.classList.contains('pending'),
    foldedCases: el.querySelectorAll('details.pending-cases .case').length,
    cases: casesOf(el)
  }))
  return {
    chip: txt(q('.now-chip')),
    greenBanner: txt(q('.result .fb.ok.next-panel')),
    expandBtn: txt(q('.result .soft-expand')),
    failTitle: txt(q('.result .fb.bad.fail-panel h4')),
    failSub: txt(q('.result .fb.bad.fail-panel .tiny')),
    hintCap: txt(q('.result .fail-hint-cap')),
    hintTxt: txt(q('.result .fail-hint-txt')),
    jump: txt(q('.result .fail-hint-jump')),
    flash: !!q('.now-hint.flash'),
    stages,
    visibleBad: [...document.querySelectorAll('.result .case.bad')].filter(vis).length
  }
`)
const stageOf = (s, n) => s.stages.find((x) => x.title.includes('第 ' + n + ' 步'))

/* ========== 0. 造起点：第 1 步通过，站在第 2 步 ========== */
console.log('\n— 0. 起点：第 1 步通过、第 2 步还没动笔 —')
await cdp.nav(`/projects/${pid}/${lid}`)
await sleep(1500)
await cdp.waitFor(`!!document.querySelector('.work-toolbar')`, 25000, '关卡页')
await resetLevel()
await clearSnaps()
await setDraft(STEP1)
await reload()
await runOnce()
let lv = await lvOf()
ok(lv.stageDone.includes(1), `第 1 步已通过（stageDone=[${lv.stageDone}]）`)
ok(/第 2 \/ 4 步/.test((await state()).chip), '自动站在第 2 步')

/* ========== A. 还没动笔：只确认上一步过了，红叉收着 ========== */
console.log('\n— A. 第 2 步没动笔 → 绿条确认第 1 步，检查点收着 —')
await runOnce()
const A = await state()
ok(/第 1 步已经过了/.test(A.greenBanner) && /还没开始写/.test(A.greenBanner),
  `绿条说「第 1 步过了、第 2 步还没开始写」（实际：${A.greenBanner.slice(0, 56)}…）`)
ok(A.failTitle === '', '没有红字横幅')
ok(stageOf(A, 2)?.pending === true && stageOf(A, 2).foldedCases === 4, '第 2 步的 4 个检查点收进折叠区')
ok(A.visibleBad === 0, `页面上没有可见的红 case（实际 ${A.visibleBad}）`)
await cdp.shot('data/qa/r35-step-start.png')

/* ========== B. 真写了半成品：红字 + 诊断必须回来 ========== */
console.log('\n— B. 在编辑器里写一个漏 __raw 的实现 → 红条 + 逐条诊断 —')
await typeCode(MISSING_RAW)
await runOnce()
const B = await state()
ok(B.failTitle !== '', '真实失败没有被绿条盖住（动过笔就摊开）')
ok(/第 2 步/.test(B.failTitle) && /还有 1 处没做到/.test(B.failTitle), `横幅点名第 2 步、1 处没做到（实际：${B.failTitle}）`)
ok(/这一步该做到什么/.test(B.failSub), '横幅说清「红字是验收标准，不是写错了什么」')
const s2 = stageOf(B, 2)
ok(s2.cases.length === 4 && s2.cases.filter((c) => c.ok).length === 3, `第 2 步 3 绿 1 红（${s2.cases.filter((c) => c.ok).length}/${s2.cases.length}）`)
const reds = s2.cases.filter((c) => !c.ok)
ok(reds.length === 1 && reds[0].name === '读取 __raw 拿到原对象', `红的就是 __raw 那一检查点（${reds.map((c) => c.name).join('、')}）`)
ok(/__raw/.test(reds[0]?.diag ?? '') && /Reflect 转发/.test(reds[0]?.diag ?? ''), `诊断点破「__raw 不是原对象上的键，Reflect 转发查不到」（${reds[0]?.diag}）`)
ok(s2.cases.filter((c) => c.ok).every((c) => !c.hasDiag), '通过的检查点不带诊断')
ok(squash(B.hintTxt) === squash(stage2hint), '失败横幅里带的就是这一步的 hint')
await cdp.shot('data/qa/r35-diag.png')

/* ========== C. 点「看左栏的完整提示与用词」：滚过去并高亮 ========== */
console.log('\n— C. 点「看左栏的完整提示与用词」—')
await cdp.clickText('看左栏的完整提示与用词')
await cdp.waitFor(`!!document.querySelector('.now-hint.flash')`, 4000, '左栏提示闪烁高亮')
const C = await state()
ok(C.flash, '左栏这一步的提示进入高亮态（红字与提示对得上）')
await cdp.shot('data/qa/r35-hint-jump.png')
await sleep(1900)

/* ========== D. 刷新之后：判定跟着快照走，不翻车 ========== */
console.log('\n— D. 刷新一次再跑：仍然是「动过笔」的状态 —')
await reload()
await runOnce()
const D = await state()
ok(D.failTitle !== '', '刷新后红字仍在（快照把「动过笔」带回来了，不会把真实失败洗掉）')
ok(/第 2 步/.test(D.failTitle), `仍然点名第 2 步（${D.failTitle}）`)

/* ========== E. 修好：第 2 步全绿，推进到第 3 步 ========== */
console.log('\n— E. 补上 __raw 特判再跑：第 2 步该全绿 —')
await typeCode(FIXED_RAW)
await runOnce()
const E = await state()
lv = await lvOf()
ok(lv.stageDone.includes(2), `第 2 步记为已通过（stageDone=[${lv.stageDone}]）`)
ok(E.failTitle === '' && E.visibleBad === 0, '第 2 步没有红点了')
ok(/第 2 步已经过了/.test(E.greenBanner), `绿条确认第 2 步过了（${E.greenBanner.slice(0, 44)}…）`)
ok(/第 3 \/ 4 步/.test(E.chip), `自动进到第 3 步（${E.chip}）`)

await resetLevel()
await clearSnaps()
console.log(`\n${bad.length ? `✗ ${bad.length} 项未通过` : '✓ 全部通过'}`)
if (bad.length) for (const m of bad) console.error('  -', m)
await cdp.close()
process.exit(bad.length ? 1 : 0)