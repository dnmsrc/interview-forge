// 在渲染页构造真实 Vue reactive spec 调 queue（通过页面已加载的模块图拿 reactive）
import { Cdp, sleep } from './cdp.mjs'
const log = (m) => process.stderr.write(`[vue] ${m}\n`)
const cdp = await Cdp.connect()

await cdp.evaluate("location.hash = '#/'; return 1")
await sleep(1500)
cdp.clearErrors()

// 从 vite 预打包依赖里找 vue 的真实 URL
const vueUrl = await cdp.evaluate(`
  const sels = [...document.querySelectorAll('script[type="module"]')].map(s => s.src);
  const html = await (await fetch('/')).text();
  const m = html.match(/src="([^"]*main\\.ts[^"]*)"/);
  return { sels, main: m && m[1] };
`)
log('module scripts: ' + JSON.stringify(vueUrl))

const r = await cdp.evaluate(`
  const out = {};
  try {
    // 经页面模块图 import vue（bare specifier 由 vite dev 解析）
    const mod = await import('/@id/vue');
    const vue = mod.reactive ? mod : (mod.default || {});
    if (!vue.reactive) throw new Error('no reactive export: ' + Object.keys(mod).slice(0, 8).join(','));
    const { reactive } = vue;
    const spec = reactive({ domains: ['fe'], stacks: [], nodeIds: [], types: [], difficulties: [], count: 10, includeDue: true, mixReviewRatio: 0.35, allowLocked: false });
    out.isProxy = !!spec.__v_isReactive;
    out.arrIsProxy = !!spec.domains.__v_isReactive;
    try { const rows = await window.forge.practice.queue({ ...spec }); out.spread = 'ok rows=' + rows.length } catch (e) { out.spread = e.name + ': ' + e.message }
    try { const rows = await window.forge.practice.queue(spec); out.direct = 'ok rows=' + rows.length } catch (e) { out.direct = e.name + ': ' + e.message }
  } catch (e) { out.fail = e.message }
  return out;
`)
log(JSON.stringify(r, null, 2))
for (const e of cdp.errors()) log('err: ' + JSON.stringify(e).slice(0, 200))

// 对照：practice 页自动调用（清掉旧 toast 需要 reload）
await cdp.evaluate("location.reload(); return 1").catch(() => {})
await sleep(3000)
await cdp.evaluate("location.hash = '#/practice'; return 1")
await sleep(4000)
const st = await cdp.evaluate(`return document.querySelectorAll('.opt').length + ' opts | toast: ' + ([...document.querySelectorAll('.n-message__content,.n-notification__description')].map(e=>e.textContent.trim()).join('||')||'(无)')`)
log('practice 自动: ' + st)
await cdp.close()
