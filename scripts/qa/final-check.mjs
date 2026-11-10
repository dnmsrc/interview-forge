// 终极验证：确认运行中 preload 是否净化入参；用页面真实 Vue reactive 走通道复现
import { Cdp, sleep } from './cdp.mjs'
const log = (m) => process.stderr.write(`[final] ${m}\n`)
const cdp = await Cdp.connect()

// ① 当前 dev server 提供的 preload 源码里有没有 toPlain？
const srcRes = await fetch('http://localhost:5173/src/preload/index.ts')
const srcText = await srcRes.text()
log('preload 源含 toPlain: ' + srcText.includes('toPlain') + ' | 含 DataClone 注释: ' + srcText.includes('DataCloneError'))

// ② 渲染页里动态 import vue，构造真 reactive spec 调 queue
await cdp.evaluate("location.hash = '#/'; return 1")
await sleep(1200)
cdp.clearErrors()
const r = await cdp.evaluate(`
  const out = {};
  try {
    const vue = await import('/node_modules/.vite/deps/vue.js?v=' + Date.now());
    if (!vue.reactive) { const v2 = await import('vue'); Object.assign(vue, v2) }
    const { reactive, watch } = vue;
    const spec = reactive({ domains: ['fe'], stacks: [], nodeIds: [], types: [], difficulties: [], count: 10, includeDue: true, mixReviewRatio: 0.35, allowLocked: false });
    // a) 浅拷贝（与 PracticeView 完全一致）
    try { const rows = await window.forge.practice.queue({ ...spec }); out.spreadReactive = 'ok rows=' + rows.length } catch (e) { out.spreadReactive = e.name + ': ' + e.message }
    // b) 直接传 reactive 本体
    try { const rows = await window.forge.practice.queue(spec); out.directReactive = 'ok rows=' + rows.length } catch (e) { out.directReactive = e.name + ': ' + e.message }
    // c) JSON 克隆后传
    try { const rows = await window.forge.practice.queue(JSON.parse(JSON.stringify(spec))); out.jsonCloned = 'ok rows=' + rows.length } catch (e) { out.jsonCloned = e.name + ': ' + e.message }
    // d) 检查数组字段是否真是 Proxy（Vue 3.5 响应式数组特征：__v_isReactive）
    out.domainsIsProxy = !!(spec.domains && spec.domains.__v_isReactive)
    out.specIsProxy = !!(spec.__v_isReactive)
  } catch (e) { out.importFail = e.message }
  return out;
`)
log(JSON.stringify(r, null, 2))

// ③ 再验证一次自动流程（导航进 practice）
await cdp.evaluate("location.hash = '#/practice'; return 1")
await sleep(3500)
const st = await cdp.evaluate(`return document.querySelectorAll('.opt').length + ' opts; toast: ' + ([...document.querySelectorAll('.n-message__content')].map(e=>e.textContent.trim()).join('||')||'(无)')`)
log('practice 自动调用: ' + st)
for (const e of cdp.errors()) log('err: ' + JSON.stringify(e).slice(0, 200))
await cdp.close()
