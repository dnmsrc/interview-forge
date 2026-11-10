// 读 doFitNow 就绪探针：dimensions/pane/viewport 前后态
import { Cdp, sleep } from './cdp.mjs'
const log = (m) => process.stderr.write(`[d] ${m}\n`)
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const t = list.find((x) => /graph/.test(decodeURIComponent(x.url || '')))
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
const cdp = new Cdp(ws)
await cdp.init()
await cdp.evaluate('location.reload(); return 1').catch(() => {})
await sleep(6000)
log('reload fitdbg: ' + JSON.stringify(await cdp.evaluate('return window.__fitdbg'), null, 1))
log('tf: ' + await cdp.evaluate(`return document.querySelector('.vue-flow__transformationpane')?.style.transform`))
// 直接手动调一次并立刻看 viewport
log('manual: ' + JSON.stringify(await cdp.evaluate(`return (() => {
  const vf = window.__vf
  const ns = vf.getNodes()
  const dims = ns.slice(0, 3).map(n => [Math.round(n.dimensions?.width||0), Math.round(n.dimensions?.height||0)])
  const before = vf.viewport.value ? { ...vf.viewport.value } : vf.getViewport()
  const r = vf.fitView({ padding: 0.16, duration: 0 })
  const after = vf.viewport.value ? { ...vf.viewport.value } : vf.getViewport()
  return { n: ns.length, dims, pane: [vf.dimensions.width, vf.dimensions.height], before, after, ret: String(r) }
})()`), null, 1))
ws.close()
process.exit(0)
