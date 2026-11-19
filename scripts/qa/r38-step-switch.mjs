// R38：一步一块代码 + 「下一步」按钮 + 判定不再绑死计数器初始值
//
// 用户这一轮的四个原话：
//   1)「我点击跑测试进入下一个步骤时，上一个步骤我写的代码应该留有快照，
//      不要被后续的改动影响到。我可以在顶部或者其它哪儿的位置切换我做过的步骤。」
//   2)「我发现你现在几个步骤全部都展示出来了，我希望一个步骤只需要展示一个步骤的信息。」
//   3)「我写的 setCount = 1，而你的答案是 setCount = 0 导致不通过……题干里面也没有要求
//      计数器应该是多少呀？这一块能不能优化一下？这样判定太死板了。」
//   4)「跑测试，我希望更名为『下一步』。」
//
// 还用上一轮的核心投诉兜底：过了一步之后，上一步的错误提示/答案绝不能跟到下一步去。
//
// 破坏性：会 resetLevel。默认连隔离实例（--instance=2 --own-data / CDP 9223）。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Cdp, sleep } from './cdp.mjs'

const bad = []
const ok = (c, m) => { if (!c) bad.push(m); console.log(`  ${c ? 'OK ' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1 }

const root = join(import.meta.dirname, '..', '..')
const pid = 'mini-vue-reactivity'
const content = JSON.parse(readFileSync(join(root, 'content', 'projects', `${pid}.json`), 'utf8'))
const lv0 = content.levels[0]
const STEP1 = lv0.stages[0].code

/** 手写第 2 步：能过，但与参考实现逐字不同（正是「手写通过」的典型） */
const OWN_STEP2 = [
  '// 自己写的第 2 步：变量名、箭头函数、注释都和参考代码不同',
  'const reactive = target => new Proxy(target, {',
  '  get: (obj, key, receiver) => {',
  "    if (key === '__raw') return obj",
  '    return Reflect.get(obj, key, receiver)',
  '  },',
  '})',
  ''
].join('\n')

/**
 * 第 3 步：计数器从 1 开始 —— 用户被误判的那份代码。
 * 题面从没规定起点，只要求「每写一次多一笔」。
 */
const STEP3_FROM_ONE = [
  'function reactive(target) {',
  '  let setCount = 1',
  '  return new Proxy(target, {',
  '    get(t, key, receiver) {',
  "      if (key === '__raw') return t",
  "      if (key === '__setCount') return setCount",
  '      return Reflect.get(t, key, receiver)',
  '    },',
  '    set(t, key, value, receiver) {',
  '      setCount++',
  '      return Reflect.set(t, key, value, receiver)',
  '    }',
  '  })',
  '}',
  ''
].join('\n')

const STEP4 = [
  'function reactive(target) {',
  '  let setCount = 1',
  '  let deleteCount = 0',
  '  return new Proxy(target, {',
  '    get(t, key, receiver) {',
  "      if (key === '__raw') return t",
  "      if (key === '__setCount') return setCount",
  "      if (key === '__deleteCount') return deleteCount",
  '      return Reflect.get(t, key, receiver)',
  '    },',
  '    set(t, key, value, receiver) {',
  '      setCount++',
  '      return Reflect.set(t, key, value, receiver)',
  '    },',
  '    deleteProperty(t, key) {',
  '      deleteCount++',
  '      return Reflect.deleteProperty(t, key)',
  '    },',
  '    has(t, key) { return Reflect.has(t, key) },',
  '    ownKeys(t) { return Reflect.ownKeys(t) }',
  '  })',
  '}',
  ''
].join('\n')

const cdp = await Cdp.connect()
const send = (b) => cdp.evaluate(b)
const call = (b) => cdp.evaluate(`return await (${b})()`)
const detail = () => call(`async () => window.forge.project.detail(${JSON.stringify(pid)})`)
const lvOf = async () => (await detail()).levels[0]
const saveDraft = (c) => call(`async () => window.forge.project.saveDraft(${JSON.stringify(pid)}, 'lv1', ${JSON.stringify(c)})`)
const resetLevel = () => call(`async () => window.forge.project.resetLevel(${JSON.stringify(pid)}, 'lv1')`)
const snapsKey = `lf.stepSnaps.${pid}.lv1`
const clearSnaps = () => send(`localStorage.removeItem(${JSON.stringify(snapsKey)}); return 1`)
const readSnaps = () => send(`try { return JSON.parse(localStorage.getItem(${JSON.stringify(snapsKey)}) || 'null') } catch { return null }`)

async function reload() {
  await cdp.reloadHard(2600)
  await cdp.waitFor(`!!document.querySelector('.work-toolbar')`, 25000, '工具条渲染')
  await sleep(600)
}
/** 把编辑器内容换成 c：草稿走服务端，快照必须清掉（load 优先读快照） */
async function setCode(c) {
  await saveDraft(c)
  await clearSnaps()
  await reload()
}
async function runOnce() {
  await cdp.clickText('下一步')
  await cdp.waitFor(`document.querySelectorAll('.result .fb').length > 0`, 25000, '结果面板出现')
  await cdp.waitFor(`[...document.querySelectorAll('.work-toolbar button')].some(b => /^下一步$/.test((b.textContent||'').trim()))`, 25000, '运行结束')
  await sleep(500)
}
const ui = () => send(`
  const txt = (el) => el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : ''
  const vis = (el) => {
    if (!el) return false
    if (el.closest('details:not([open])')) return false
    const st = getComputedStyle(el)
    if (st.display === 'none' || st.visibility === 'hidden') return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const red = [...document.querySelectorAll('.result .fb.bad.fail-panel')].find(vis)
  const green = [...document.querySelectorAll('.result .fb.ok.next-panel')].find(vis)
  const ta = document.querySelector('textarea')
  return {
    chip: txt(document.querySelector('.now-chip')),
    title: txt(document.querySelector('.now-title')),
    past: txt(document.querySelector('.now-past')),
    tabs: [...document.querySelectorAll('.stage-switch .stage-tab')].map(b => ({
      t: txt(b), now: b.classList.contains('now'), done: b.classList.contains('done'), disabled: b.disabled
    })),
    red: !!red,
    redTitle: txt(red && red.querySelector('h4')),
    redHint: txt(red && red.querySelector('.fail-hint-txt')),
    green: txt(green),
    expand: txt(document.querySelector('.soft-expand')),
    answerPanel: !!document.querySelector('.answer-panel'),
    stageResults: [...document.querySelectorAll('.stage-result')].map(g => txt(g.querySelector('.stage-result-title'))),
    code: ta?.value || '',
    readonly: !!ta?.readOnly,
    toolbarBtns: [...document.querySelectorAll('.work-toolbar button')].map(b => txt(b)),
    hasStageList: !!document.querySelector('.stage-list'),
    hasNextBtn: [...document.querySelectorAll('.work-toolbar button')].some(b => /^下一步$/.test(txt(b))),
    hasOldBtn: [...document.querySelectorAll('button')].some(b => /^跑测试$/.test(txt(b))),
    passPanel: !!document.querySelector('.pass-panel')
  }
`)

/* ================= A. 首屏：一步只显示一步 ================= */
console.log('\n— A. 首屏结构与按钮 —')
await cdp.nav(`/projects/${pid}/lv1`)
await sleep(1500)
await cdp.waitFor(`!!document.querySelector('.work-toolbar')`, 25000, '关卡页')
await resetLevel()
await clearSnaps()
await reload()
const A = await ui()
ok(A.hasNextBtn === true, `主按钮叫「下一步」（${A.toolbarBtns.join(' / ')}）`)
ok(A.hasOldBtn === false, '页面里不再有叫「跑测试」的按钮')
ok(A.tabs.length === 4, `顶部步骤条有 ${A.tabs.length} 个步骤`)
ok(A.tabs[0].now === true, '首屏站在第 1 步')
ok(A.hasStageList === false, '左栏不再把四步的 think/hint/vocab 全列一遍（没有 .stage-list）')
ok(A.title === lv0.stages[0].title, `左栏只显示当前步标题（${A.title}）`)
ok(A.red === false, '还没跑过测试：没有红面板')

/* ================= B. 第 1 步过 → 自动站到第 2 步 ================= */
console.log('\n— B. 第 1 步通过：自动进第 2 步，且不给第 2 步的红字 —')
await setCode(STEP1)
await runOnce()
const B = await ui()
let lv = await lvOf()
ok(lv.stageDone.includes(1), `第 1 步记为已通过（stageDone=[${lv.stageDone}]）`)
ok(/第 2 \/ 4 步/.test(B.chip), `视图自动前进到第 2 步（${B.chip}）`)
ok(/第 1 步已经过了/.test(B.green), `绿条确认第 1 步过了（${B.green.slice(0, 46)}…）`)
ok(B.red === false, `第 2 步没动笔：不摊红（${B.redTitle || '无'}）`)
ok(!lv.stageFails || lv.stageFails['2'] === undefined, `没动笔不算失败（stageFails=${JSON.stringify(lv.stageFails ?? {})}）`)
ok(B.stageResults.length === 1 && /第 2 步/.test(B.stageResults[0]), `结果只列当前步（${B.stageResults.join(' | ')}）`)
ok(B.answerPanel === false, '没有答案面板残留')

/* ================= C. 手写第 2 步：快照按步存，失败计数不再误记第 3 步 ================= */
console.log('\n— C. 手写的第 2 步通过（与参考代码逐字不同）—')
await setCode(OWN_STEP2)
await runOnce()
const C = await ui()
lv = await lvOf()
ok(lv.stageDone.includes(2), `第 2 步记为已通过（stageDone=[${lv.stageDone}]）`)
ok(/第 3 \/ 4 步/.test(C.chip), `自动站到第 3 步（${C.chip}）`)
ok(C.red === false, `第 3 步不摊红（${C.redTitle || '无'}）`)
ok(!lv.stageFails || lv.stageFails['3'] === undefined,
  `用户投诉的那笔假账没了：第 3 步没动笔，不计失败（stageFails=${JSON.stringify(lv.stageFails ?? {})}）`)
const snaps = await readSnaps()
ok(!!snaps && typeof snaps['2']?.code === 'string', `第 2 步的代码按步存了快照（键：${snaps ? Object.keys(snaps).join(',') : '无'}）`)
ok(!!snaps && snaps['2'].code.replace(/\s+/g, '') === OWN_STEP2.replace(/\s+/g, ''), '快照里是「我写的」那份，不是参考实现')

/* ================= D. 切回做过的步：只读、代码不被后来的改动污染 ================= */
console.log('\n— D. 顶部切换到自己做过的步 —')
await send(`
  const tabs = [...document.querySelectorAll('.stage-switch .stage-tab')];
  const t = tabs.find(b => b.textContent.includes('让「读」经过我'));
  if (!t) return 'no tab';
  t.click(); return 'ok';
`)
await sleep(800)
const D2 = await ui()
ok(/第 2 \/ 4 步/.test(D2.chip), `切到第 2 步（${D2.chip}）`)
ok(D2.readonly === true, '回看旧步是只读的（改旧步等于改掉后面几步的地基）')
ok(D2.code.replace(/\s+/g, '') === OWN_STEP2.replace(/\s+/g, ''), '显示的是我当时写的代码')
ok(/快照/.test(D2.past), `说明这是当时的快照（${D2.past.slice(0, 40)}…）`)
ok(D2.red === false, '回看已过的步：不给红字')
ok(D2.answerPanel === false, '回看已过的步：不给答案面板')

console.log('\n— D2. 切回正在做的那一步：起点是上一步的代码 =')
await send(`
  const tabs = [...document.querySelectorAll('.stage-switch .stage-tab')];
  const t = tabs.find(b => b.textContent.includes('让「写」经过我'));
  if (!t) return 'no tab';
  t.click(); return 'ok';
`)
await sleep(800)
const D3 = await ui()
ok(/第 3 \/ 4 步/.test(D3.chip), `回到第 3 步（${D3.chip}）`)
ok(D3.readonly === false, '正在做的步可以编辑')
ok(D3.code.replace(/\s+/g, '') === OWN_STEP2.replace(/\s+/g, ''), '第 3 步的起点是第 2 步那份手写实现（不是骨架、也不是参考答案）')

/* ================= E. 计数器从 1 开始也能过第 3 步（判定不再绑死初始值）================= */
console.log('\n— E. setCount = 1 的第 3 步（用户被误判的那份代码）—')
await setCode(STEP3_FROM_ONE)
await runOnce()
const E = await ui()
lv = await lvOf()
ok(lv.stageDone.includes(3), `计数器从 1 开始，第 3 步照样通过（stageDone=[${lv.stageDone}]）`)
ok(/第 4 \/ 4 步/.test(E.chip), `自动进到第 4 步（${E.chip}）`)
ok(E.red === false, '第 4 步不摊红')
ok(!lv.stageFails || lv.stageFails['4'] === undefined, `第 4 步仍未计失败（stageFails=${JSON.stringify(lv.stageFails ?? {})}）`)
await cdp.shot('data/qa/r38-step4-start.png')

/* ================= F. 真写了没写通：红字照给，只给当前步 ================= */
console.log('\n— F. 点「我已经写了」→ 红字只讲第 4 步 —')
const hasExpand = /我已经写了/.test(E.expand)
ok(hasExpand, `给了「我已经写了」的入口（${E.expand}）`)
if (hasExpand) {
  await cdp.clickText('我已经写了')
  await cdp.waitFor(`!!document.querySelector('.result .fb.bad.fail-panel')`, 8000, '红面板展开')
  await sleep(450)
  const F = await ui()
  ok(F.red === true, '展开后才出现红字')
  ok(/第 4 步/.test(F.redTitle), `红字点名第 4 步（${F.redTitle}）`)
  ok(/__deleteCount/.test(F.redHint), `红字旁给的是第 4 步的提示（${(F.redHint || '').slice(0, 30)}…）`)
  await cdp.shot('data/qa/r38-fail-step4.png')
}

/* ================= G. 整关通过后：不残留答案、不残留红 ================= */
console.log('\n— G. 第 4 步写对 → 通关 —')
await setCode(STEP4)
await runOnce()
const G = await ui()
lv = await lvOf()
ok(lv.done === true, '整关通关')
ok(G.passPanel === true, '显示通关面板')
ok(G.answerPanel === false, '通关后没有答案面板残留（用户截图里的那条）')
ok(G.red === false, '通关后没有红面板残留')
await cdp.shot('data/qa/r38-passed.png')

/* ================= H. 通关后回看第 1 步：仍然一步一屏 ================= */
console.log('\n— H. 通关后切回第 1 步 —')
await send(`
  const tabs = [...document.querySelectorAll('.stage-switch .stage-tab')];
  const t = tabs.find(b => b.textContent.includes('先让它'));
  if (!t) return 'no tab';
  t.click(); return 'ok';
`)
await sleep(800)
const H = await ui()
ok(/第 1 \/ 4 步/.test(H.chip), `切到第 1 步（${H.chip}）`)
ok(H.readonly === true, '通关后回看仍然是只读')
ok(H.red === false && H.answerPanel === false, '回看旧步不出现红字/答案面板')

await resetLevel()
await clearSnaps()
console.log(`\n${bad.length ? `✗ ${bad.length} 项未通过` : '✓ 全部通过'}`)
if (bad.length) for (const m of bad) console.error('  -', m)
await cdp.close()
process.exit(bad.length ? 1 : 0)