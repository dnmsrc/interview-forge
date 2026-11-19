// R37：上一步过了，就别把下一步的检查点摊在脸上
//
// 用户的原话（配一张截图：绿条说「第 2 步已经过了」，下面红框列着第 3 步的验收要求和
// 「这一步要做的」）：「之前卡在了第二步，但是当我第二步成功后，你应该把错误信息移除，
// 不然我可以直接看到第三步的答案」。
//
// 根因不在呈现，在快照记录：老逻辑「只有代码等于参考实现才记快照」，用户手写了一份等价实现
// 通过第 2 步之后永远没有快照 → 之后每次跑都退化成 softStart（绿条 + 下一步红字并存）。
// 这一轮：
//   - 推进时无条件记快照，并标 dirty（那份代码本身是否已含下一步内容）；
//   - dirty 的快照 → 红字默认收起，只留一个展开入口；干净起点 → 照旧完全不出红；
//   - 人真动过笔（代码与快照对不上）→ 红字照常摊开，不能把真实失败藏起来。
//
// 破坏性：覆盖草稿。连隔离实例（instance=2 / CDP 9223，QA_PORT=9223）。
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
const STEP2 = lv0.stages[1].code

/** 手写的第 2 步等价实现：能过本步，但和参考代码逐字不同——正是用户的情形 */
const OWN_STEP2 = `// 自己写的第 2 步：与参考代码逐字不同（箭头函数、变量名、注释都换了）
const reactive = target => new Proxy(target, {
  get: (obj, key, receiver) => {
    if (key === '__raw') return obj
    return Reflect.get(obj, key, receiver)
  },
})
`

const cdp = await Cdp.connect()
const call = (b) => cdp.evaluate(`return await (${b})()`)
const send = (b) => cdp.evaluate(b)
const detail = () => call(`async () => window.forge.project.detail(${JSON.stringify(pid)})`)
const lvOf = async () => (await detail()).levels[0]
const saveDraft = (c) => call(`async () => window.forge.project.saveDraft(${JSON.stringify(pid)}, 'lv1', ${JSON.stringify(c)})`)
const resetLevel = () => call(`async () => window.forge.project.resetLevel(${JSON.stringify(pid)}, 'lv1')`)
const snapKey = `lf.stageStart.${pid}.lv1`
const clearSnapshot = () => send(`
  localStorage.removeItem(${JSON.stringify(snapKey)});
  sessionStorage.removeItem(${JSON.stringify(snapKey)});
  localStorage.removeItem('lf.stepSnaps.mini-vue-reactivity.lv1');
  return 1
`)
const readSnapshot = () => send(`
  try { return JSON.parse(localStorage.getItem(${JSON.stringify(snapKey)}) || 'null') } catch { return null }
`)

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

/** 页面状态：红面板是否可见、软启动的展开入口、绿条文案、结果列表里那一步的呈现 */
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
  const cases = [...document.querySelectorAll('.stage-result')].map((g) => ({
    head: txt(g.querySelector('.stage-result-title')),
    pending: g.classList.contains('pending'),
    bad: g.classList.contains('bad'),
    casesShown: [...g.querySelectorAll('.cases')].some(vis)
  }))
  return {
    redPanel: !!vis(q('.result .fb.bad.fail-panel')),
    redTitle: txt(q('.result .fb.bad.fail-panel h4')),
    green: txt(q('.result .fb.ok.next-panel')),
    expandBtn: txt(q('.result .soft-expand')),
    foot: txt(q('.answer-foot')),
    cases
  }
`)

/* ========== A. 干净的推进：第 1 步过了，不该有任何红 ========== */
console.log('\n— A. 第 1 步通过：干净起点 —')
await cdp.nav('/projects/mini-vue-reactivity/lv1')
await sleep(1500)
await cdp.waitFor(`!!document.querySelector('.work-toolbar')`, 25000, '关卡页渲染')
await resetLevel()
await saveDraft(STEP1)
await clearSnapshot()
await reload()
await runOnce()
const A = await ui()
ok(A.redPanel === false, `干净起点：没有红面板（${A.redTitle || '无'}）`)
let snap = await readSnapshot()
ok(snap && snap.stageN === 1 && snap.dirty === false, `快照记下「推进到第 1 步、干净起点」（${JSON.stringify(snap && { stageN: snap.stageN, dirty: snap.dirty })}）`)

/* ========== B. 手写第 2 步通过：老逻辑在这里丢的快照 ========== */
console.log('\n— B. 手写的第 2 步实现通过（与参考代码文字不同）—')
// R38 之后编辑器内容按步存快照：靠 saveDraft 换草稿会被「这一步的起点」挡住，
// 这里改成在编辑器里真的改代码（和用户手写同一条路径）。
await send(`
  const ta = document.querySelector('textarea')
  ta.value = ${JSON.stringify(OWN_STEP2)}
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  return 1
`)
await sleep(350)
await runOnce()
const B = await ui()
let lv = await lvOf()
ok(lv.stageDone.includes(1) && lv.stageDone.includes(2), `第 1、2 步都过了（stageDone=[${lv.stageDone}]）`)
ok(B.redPanel === false, `刚过第 2 步：不甩红（${B.redTitle || '无'}）`)
snap = await readSnapshot()
ok(snap && snap.stageN === 2, `手写实现通过也会记快照（原来是「不干净就不记」，${snap ? 'stageN=' + snap.stageN : '没有快照'}）`)
ok(snap && typeof snap.dirty === 'boolean', `快照带 dirty 标记（dirty=${snap?.dirty}）`)

/* ========== C. 什么都不改再跑一次：这时最不该出现下一步的红字 ========== */
console.log('\n— C. 代码没动，再点一次跑测试（用户截图里的那一刻）—')
await runOnce()
const C = await ui()
ok(/第 2 步/.test(C.green) && /已经过了/.test(C.green), `绿条先确认第 2 步过了（${C.green.slice(0, 40)}…）`)
ok(C.redPanel === false, `红面板默认收起，看不到第 3 步的要求（${C.redTitle || '无'}）`)
ok(!/这一步要做的/.test(C.green), '绿条里也没有把「这一步要做的」抄出来')
const third = C.cases.find((c) => /第 3 步/.test(c.head))
ok(!!third && third.pending === true, `结果列表里第 3 步按「还没到」呈现（${third ? third.head : '没找到'}）`)
ok(!!third && third.bad === false, '结果列表里第 3 步没打红叉')
ok(!!third && third.casesShown === false, '第 3 步的检查点明细是收着的')
await cdp.shot('data/qa/r37-soft-collapsed.png')

/* ========== D. 点开入口：真写了的人才看得到细节 ========== */
const hasExpand = /我已经写了/.test(C.expandBtn)
console.log(`\n— D. 展开入口（${hasExpand ? '有' : '无：这一步被判定为完全没动笔'}）—`)
if (hasExpand) {
  await cdp.clickText('我已经写了')
  await cdp.waitFor(`!!document.querySelector('.result .fb.bad.fail-panel')`, 8000, '红面板展开')
  await sleep(400)
  const D = await ui()
  ok(D.redPanel === true, `点开后红字才出现（${D.redTitle}）`)
  ok(/第 3 步/.test(D.redTitle), '展开的是第 3 步的验收要求，不是别的步')
  ok(!/我已经写了/.test(D.expandBtn), '展开后入口收起，不再重复出现')
  await cdp.shot('data/qa/r37-soft-expanded.png')
} else {
  ok(C.redPanel === false, '没有展开入口：这一步被判定为「一个字没写」，连入口都不必给')
}

/* ========== E. 真动笔之后：红字必须照常摊开（不能把真实失败藏掉）========== */
console.log('\n— E. 人动过笔（在编辑器里真的敲了字）：红字照常给 —')
// 这里必须「真的编辑」，不能靠 saveDraft 换草稿：
// R38 之后编辑器内容以「这一步的起点快照」判断动没动笔，换草稿等于换起点，会被判成没动笔。
await send(`
  const ta = document.querySelector('textarea')
  ta.value = ta.value + '\\n// 手上动了一下'
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  return 1
`)
await sleep(400)
await runOnce()
const E = await ui()
ok(E.redPanel === true, `改了代码再跑红：红面板直接可见（${E.redTitle}）`)
ok(!/我已经写了/.test(E.expandBtn), '不再给「我已经写了」的入口（已经确认动过笔了）')

/* ========== F. 服务端没被绕过：stageFails 照记 ========== */
console.log('\n— F. 折叠不影响判题 —')
lv = await lvOf()
ok((lv.stageFails?.['3'] ?? 0) >= 1, `第 3 步的失败计数照记（${JSON.stringify(lv.stageFails)}）`)
ok(!lv.stageDone.includes(3), `第 3 步没被误判为已过（stageDone=[${lv.stageDone}]）`)

/* ---------------- 收尾 ---------------- */
await resetLevel()
console.log(`\n${bad.length ? `✗ ${bad.length} 项未通过` : '✓ 全部通过'}`)
if (bad.length) { for (const m of bad) console.error('  -', m) }
await cdp.close()
process.exit(bad.length ? 1 : 0)