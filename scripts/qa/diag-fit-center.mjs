// fitView 偏心诊断：store 包围盒 vs 视口尺寸 vs 实际 transform 三方对账
import { Cdp, sleep } from './cdp.mjs'
const log = (m) => process.stderr.write(`[c] ${m}\n`)
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const t = list.find((x) => /graph/.test(decodeURIComponent(x.url || '')))
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
const cdp = new Cdp(ws)
await cdp.init()
log('__vf: ' + (await cdp.evaluate('return !!window.__vf')))
const probe = await cdp.evaluate(`(() => {
  const vf = window.__vf; if (!vf) return 'no vf'
  const ns = vf.getNodes ? vf.getNodes() : []
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9
  for (const n of ns) {
    const x = n.computedPosition?.x ?? n.position.x, y = n.computedPosition?.y ?? n.position.y
    minX = Math.min(minX, x); minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + (n.measured?.width ?? 0)); maxY = Math.max(maxY, y + (n.measured?.height ?? 0))
  }
  const flow = document.querySelector('.vue-flow')
  const els = [...document.querySelectorAll('.gn')].map((e) => e.getBoundingClientRect())
  return {
    nodes: ns.length,
    bounds: [Math.round(minX), Math.round(minY), Math.round(maxX - minX), Math.round(maxY - minY)],
    dims: [vf.dimensions?.width, vf.dimensions?.height],
    flowBox: [flow.clientWidth, flow.clientHeight],
    tf: document.querySelector('.vue-flow__transformationpane')?.style.transform,
    contentInViewport: [Math.round(Math.min(...els.map((r) => r.left))), Math.round(Math.max(...els.map((r) => r.right)))]
  }
})()`)
log('对账: ' + JSON.stringify(probe))
const man = await cdp.evaluate(`(() => { try { window.__vf.fitView({ padding: 0.16 }); return document.querySelector('.vue-flow__transformationpane')?.style.transform } catch (e) { return 'THROW ' + e.message } })()`)
log('手动 fitView 立即读: ' + man)
await sleep(900)
log('动画后: ' + await cdp.evaluate(`return document.querySelector('.vue-flow__transformationpane')?.style.transform`))
const after = await cdp.evaluate(`(() => {
  const els = [...document.querySelectorAll('.gn')].map((e) => e.getBoundingClientRect())
  const flow = document.querySelector('.vue-flow')
  return { left: Math.round(Math.min(...els.map((r) => r.left))), right: Math.round(Math.max(...els.map((r) => r.right))), flowW: flow.clientWidth }
})()`)
log('手动 fit 后内容占位: ' + JSON.stringify(after))
ws.close()
process.exit(0)
