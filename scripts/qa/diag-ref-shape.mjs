// 确认 store 上 dimensions/viewport/minZoom 的 Ref 形态与真实值
import { Cdp, sleep } from './cdp.mjs'
const log = (m) => process.stderr.write(`[s] ${m}\n`)
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const t = list.find((x) => /graph/.test(decodeURIComponent(x.url || '')))
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
const cdp = new Cdp(ws)
await cdp.init()
await sleep(1500)
log(await cdp.evaluate(`return (() => {
  const vf = window.__vf
  const shape = (v) => v && v.__v_isRef ? 'Ref(' + JSON.stringify(v.value) + ')' : JSON.stringify(v)
  return [
    'dimensions=' + shape(vf.dimensions),
    'viewport=' + shape(vf.viewport),
    'minZoom=' + shape(vf.minZoom),
    'maxZoom=' + shape(vf.maxZoom),
    'width=' + shape(vf.width),
    'height=' + shape(vf.height),
    'getNodesType=' + typeof vf.getNodes,
    'nodesIsRef=' + (vf.nodes && vf.nodes.__v_isRef) + ' len=' + (vf.nodes?.value?.length)
  ].join('\\n')
})()`))
ws.close()
process.exit(0)
