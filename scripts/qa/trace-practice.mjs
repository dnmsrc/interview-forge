// 劫持 contextBridge 出口，记录页面自动调用时真正传给 IPC 的值与抛错点
import { Cdp, sleep } from './cdp.mjs'
const log = (m) => process.stderr.write(`[trace] ${m}\n`)
const cdp = await Cdp.connect()

// 先注入拦截器（对 window.forge 包一层 Proxy），再 reload 前用 addScriptToEvaluateOnNewDocument 不行——
// contextBridge 在 document 之前就绪。改用：导航到 home（无报错页）注入，然后再切到 practice。
await cdp.evaluate("location.hash = '#/'; return 1")
await sleep(1500)

const injected = await cdp.evaluate(`
  const rec = window.__ipcTrace = [];
  const orig = window.forge;
  const wrapNs = (nsObj, nsName) => new Proxy(nsObj, {
    get(t, fn) {
      const f = t[fn];
      if (typeof f !== 'function') return f;
      return (...args) => {
        let snap;
        try { snap = JSON.stringify(args, (k, v) => typeof v === 'function' ? '[fn]' : v).slice(0, 300) } catch (e) { snap = 'CIRCULAR/' + e.message }
        rec.push({ ch: nsName + '.' + String(fn), args: snap });
        try { return f(...args) } catch (e) { rec.push({ ch: 'SYNC-THROW ' + nsName + '.' + String(fn), err: e.name + ': ' + e.message, stack: String(e.stack).split('\\n').slice(0, 8).join(' | ') }); throw e }
      };
    }
  });
  for (const k of Object.keys(orig)) {
    try { if (typeof orig[k] === 'object' && orig[k]) Object.defineProperty(orig, k, { value: wrapNs(orig[k], k), configurable: true }); } catch (e) { rec.push({ ch: 'WRAP-FAIL', err: String(e.message) }) }
  }
  return Object.keys(orig).length;
`)
log('已包装命名空间数: ' + injected)

await cdp.evaluate("location.hash = '#/practice'; return 1")
await sleep(4000)

const trace = await cdp.evaluate("return (window.__ipcTrace || []).map(t => t.err ? t : t).slice(-12)")
for (const t of trace) log(JSON.stringify(t))

const errs = cdp.errors()
log('console 错误:')
for (const e of errs) log(JSON.stringify(e))

// toast 文案还在不在？
const toast = await cdp.evaluate(`return [...document.querySelectorAll('.n-message__content,.n-notification__description')].map(e => e.textContent.trim()).join(' || ') || '(无)'`)
log('当前 toast: ' + toast)

await cdp.close()
