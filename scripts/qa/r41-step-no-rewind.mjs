// R41：判定不再把人从第 4 步拽回第 3 步
//
// 用户这一轮的原话：
//   1)「我明明已经在做第四步了，这时卡了很久，我做对了其中的某一项判定，
//      此时直接给我跳到了第三步。」
//   2)「并且顶部的 ui 也有问题。」
//
// 根因（R40 探针实测）：
//   - 第 4 步的代码把第 3 步的 setCount++ 改坏 → 本次 stageIndex=2（第一个红的步）
//   - progressStage 直接取 stageIndex → 水位退回第 3 步
//   - 顶部第 4 步 tab 因为 i > progressStage 被禁用，人正站着的当前步点不动，
//     只能点第 3 步；点了之后第 4 步仍然禁用，回不来
//   - 结果面板还说「第 4 步还没开始写——编辑器里现在还是第 3 步的代码」，
//     而编辑器里明明是他写的第 4 步
//
// 这一版所有「写代码」都走编辑器输入事件（不是换草稿）：「动没动笔」是按
// 「这一步开始时的代码」判的，换草稿等于换起点，会伪造出「还没开始写」。
//
// 破坏性：会 resetLevel。默认连隔离实例（--instance=2 --own-data / CDP 9223）。
import { Cdp, sleep } from './cdp.mjs'

const bad = []
const ok = (c, m) => { if (!c) bad.push(m); console.log(`  ${c ? 'OK ' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1 }

const pid = 'mini-vue-reactivity'

const STEP1 = ['function reactive(target) {', '  return new Proxy(target, {})', '}', ''].join('\n')

const STEP2 = [
  'function reactive(target) {',
  '  return new Proxy(target, {',
  '    get(t, key, receiver) {',
  "      if (key === '__raw') return t",
  '      return Reflect.get(t, key, receiver)',
  '    }',
  '  })',
  '}',
  ''
].join('\n')

const STEP3 = [
  'function reactive(target) {',
  '  let setCount = 0',
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

/** 第 4 步写了一半：加了 delete 出口，但把第 3 步的 setCount++ 弄丢了 —— 用户遇到的情形 */
const STEP4_HALF = [
  'function reactive(target) {',
  '  let setCount = 0',
  '  let deleteCount = 0',
  '  return new Proxy(target, {',
  '    get(t, key, receiver) {',
  "      if (key === '__raw') return t",
  "      if (key === '__setCount') return setCount",
  "      if (key === '__deleteCount') return deleteCount",
  '      return Reflect.get(t, key, receiver)',
  '    },',
  '    set(t, key, value, receiver) {',
  '      return Reflect.set(t, key, value, receiver)',
  '    },',
  '    deleteProperty(t, key) {',
  '      deleteCount++',
  '      return Reflect.deleteProperty(t, key)',
  '    }',
  '  })',
  '}',
  ''
].join('\n')

const STEP4 = [
  'function reactive(target) {',
  '  let setCount = 0',
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
const resetLevel = () => call(`async () => window.forge.project.resetLevel(${JSON.stringify(pid)}, 'lv1')`)
const snapsKey = `lf.stepSnaps.${pid}.lv1`
const clearSnaps = () => send(`localStorage.removeItem(${JSON.stringify(snapsKey)}); return 1`)

/** 在编辑器里真的改代码：换草稿等于换「起点」，会伪造出「还没开始写」 */
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
  await sleep(600)
}
/**
 * 点按钮（直接派发 DOM click）。
 *
 * 这里刻意不用 cdp.clickText 的真实鼠标注入：窗口被别的窗口压住时，
 * Input.dispatchMouseEvent 会静默失效（不报错、elementFromPoint 也正确，但 @click 不触发），
 * 表现为「等结果面板超时」。这个脚本要验的是判定与界面状态，不是「鼠标能不能点中」，
 * 所以走 DOM click；点击命中/遮挡另由 r38 的首屏断言覆盖。
 */
async function press(text) {
  const r = await send(`
    const b = [...document.querySelectorAll('button')].find(x => !x.disabled && (x.textContent || '').trim() === ${JSON.stringify(text)});
    if (!b) return 'no';
    b.click(); return 'ok';
  `)
  if (r !== 'ok') throw new Error(`找不到可点的按钮「${text}」`)
}

async function runOnce() {
  await press('下一步')
  await cdp.waitFor(`document.querySelectorAll('.result .fb').length > 0`, 25000, '结果面板出现')
  await cdp.waitFor(`[...document.querySelectorAll('.work-toolbar button')].some(b => /^下一步$/.test((b.textContent||'').trim()))`, 25000, '运行结束')
  await sleep(500)
}
async function clickTab(word) {
  await send(`
    const t = [...document.querySelectorAll('.stage-switch .stage-tab')].find(b => b.textContent.includes(${JSON.stringify(word)}));
    if (!t) return 'no tab';
    if (t.disabled) return 'disabled';
    t.click(); return 'ok';
  `)
  await sleep(700)
}

const ui = () => send(`
  const txt = (el) => el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : ''
  const vis = (el) => {
    if (!el) return false
    const st = getComputedStyle(el)
    if (st.display === 'none' || st.visibility === 'hidden') return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const panels = [...document.querySelectorAll('.result .fb')].filter(vis)
  return {
    chip: txt(document.querySelector('.todo-chip')),
    title: txt(document.querySelector('.now-title')),
    tabs: [...document.querySelectorAll('.stage-switch .stage-tab')].map(b => ({
      t: txt(b), now: b.classList.contains('now'), done: b.classList.contains('done'),
      fail: b.classList.contains('fail'), disabled: b.disabled
    })),
    panelTexts: panels.map(e => txt(e)),
    warnPanel: !!panels.find(e => e.classList.contains('earlier-panel')),
    redPanel: !!panels.find(e => e.classList.contains('fail-panel')),
    stageResults: [...document.querySelectorAll('.stage-result')].filter(vis).map(g => txt(g.querySelector('.stage-result-title'))),
    readonly: !!document.querySelector('textarea')?.readOnly,
    code: document.querySelector('textarea')?.value || ''
  }
`)

/** 截图前把右栏滚回顶部：QA 点按钮会把「下一步」滚到屏幕中央，步骤条会被挤出视野 */
async function shot(p) {
  await send(`window.scrollTo(0, 0); document.documentElement.scrollTop = 0; document.querySelector('.work-pane').scrollTop = 0; return 1`)
  // 页面切换有一次淡入（view-rise），截早了整张是半透明的
  await sleep(900)
  await cdp.shot(p)
}

/* ================= A. 走到第 4 步 ================= */
console.log('\n— A. 先走到第 4 步 —')
await cdp.nav(`/projects/${pid}/lv1`)
await sleep(1500)
await cdp.waitFor(`!!document.querySelector('.work-toolbar')`, 25000, '关卡页')
await resetLevel()
await clearSnaps()
await reload()
for (const [i, code] of [[1, STEP1], [2, STEP2], [3, STEP3]]) {
  await typeCode(code)
  await runOnce()
  const u = await ui()
  ok(new RegExp(`第 ${i + 1} / 4 步`).test(u.chip), `第 ${i} 步过完站到第 ${i + 1} 步（${u.chip}）`)
}

/* ================= B. 第 4 步写一半，把第 3 步弄红 ================= */
console.log('\n— B. 第 4 步写一半（第 3 步被弄红）：不许把人拽走 —')
await typeCode(STEP4_HALF)
await runOnce()
const B = await ui()
const lvB = await lvOf()
ok(B.tabs[3].now === true, '当前步仍是第 4 步')
ok(B.tabs[3].disabled === false, '第 4 步的 tab 没被禁用（以前 i > progressStage 就点不动）')
ok(B.tabs[2].fail === false, '已通过的第 3 步不在顶部标红（绿勾和红框打架，是上一版的样子）')
ok(B.warnPanel === true, '结果面板点明「这次改动把第 3 步弄红了」')
ok(B.panelTexts.some(t => /第 3 步有 \d+ 个检查点没过/.test(t)), `说清停了哪一步（${(B.panelTexts[0] || '').slice(0, 60)}…）`)
ok(B.panelTexts.some(t => /要修的就是当前这份代码/.test(t)), '指路指在当前编辑器里，而不是让人退回去')
ok(!B.panelTexts.some(t => /编辑器里现在还是第 3 步的代码/.test(t)), '不再谎称「编辑器里还是第 3 步的代码」')
ok(B.redPanel === false, '这一版代码根本没轮到第 4 步判定，不该摊第 4 步的红字')
ok(lvB.stageDone.includes(3), `第 3 步仍然是「通过过」（stageDone=[${lvB.stageDone}]，只增不减）`)
await shot('data/qa/r41-earlier-warn.png')

/* ================= C. 顶部切步：回看只读，能回到当前步 ================= */
console.log('\n— C. 顶部切到第 3 步再切回来 —')
await clickTab('让「写」经过我')
const C1 = await ui()
ok(/正在回看第 3 步/.test(C1.chip), `切到第 3 步，并标明是回看（${C1.chip}）`)
ok(C1.readonly === true, '已通过的旧步是只读回看')
await clickTab('把「删」和「查」也接进来')
const C2 = await ui()
ok(/第 4 \/ 4 步/.test(C2.chip), `能点回第 4 步（${C2.chip}）`)
ok(C2.readonly === false, '回到正在做的步就恢复可编辑')
ok(C2.code.replace(/\s+/g, '') === STEP4_HALF.replace(/\s+/g, ''), '第 4 步调出来的是我写的那份')

/* ================= D. 刷新：不许退回去 ================= */
console.log('\n— D. 刷新页面 —')
await sleep(900)
await reload()
const D = await ui()
ok(/第 4 \/ 4 步/.test(D.chip), `刷新后仍在第 4 步（${D.chip}）`)
ok(D.tabs[3].disabled === false, '第 4 步的 tab 依然可点')
ok(D.code.replace(/\s+/g, '') === STEP4_HALF.replace(/\s+/g, ''), '代码还是我写的那份')

/* ================= E. 推进时后面那步的红不算失败 ================= */
console.log('\n— E. 刚推进到第 4 步、还没动笔：后面那步的红不记账 —')
await resetLevel()
await clearSnaps()
await reload()
for (const code of [STEP1, STEP2, STEP3]) {
  await typeCode(code)
  await runOnce()
}
const lvE = await lvOf()
ok(lvE.stageDone.includes(3), `第 3 步通过（stageDone=[${lvE.stageDone}]）`)
ok(!lvE.stageFails?.['4'], `第 4 步「还没写到」的红不计成失败（stageFails=${JSON.stringify(lvE.stageFails ?? {})}）`)

/* ================= F. 修好第 4 步 → 通关 ================= */
console.log('\n— F. 把第 3 步那行补回去 → 通关 —')
await typeCode(STEP4)
await runOnce()
const F = await ui()
const lvF = await lvOf()
ok(lvF.done === true, '整关通关')
ok(F.tabs.every(t => !t.fail), '通关后顶部没有红')
// 关掉庆祝弹窗再截，不然整页被遮罩压暗
await send(`
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes('太棒了'))
  if (b) b.click(); return 1
`)
await shot('data/qa/r41-passed.png')

await resetLevel()
await clearSnaps()
console.log(`\n${bad.length ? `✗ ${bad.length} 项未通过` : '✓ 全部通过'}`)
if (bad.length) for (const m of bad) console.error('  -', m)
await cdp.close()