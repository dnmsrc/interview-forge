// __vf store 能力清单（纯字符串返回，规避一切序列化/引号雷区）
import { Cdp, sleep } from './cdp.mjs'
const log = (m) => process.stderr.write(`[c] ${m}\n`)
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const t = list.find((x) => /graph/.test(decodeURIComponent(x.url || '')))
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
const cdp = new Cdp(ws)
await cdp.init()
await cdp.evaluate('location.reload(); return 1').catch(() => {})
await sleep(4600)
const shape = await cdp.evaluate(`return (() => {
  try {
    const vf = window.__vf
    if (!vf) return 'NO __vf（桥接没跑/HMR 半更新）'
    const names = ['fitView', 'setTransform', 'setViewport', 'getViewport', 'getNodes', 'zoomTo', 'fitBounds', 'nodes', 'dimensions', 'viewport', 'minZoom', 'maxZoom']
    const desc = names.map((k) => k + '=' + typeof vf[k]).join(', ')
    let extra = ''
    try { extra = ' | ownKeys:' + Object.keys(vf).slice(0, 40).join(',') } catch (e) { extra = ' | keys THROW ' + e.message }
    let proto = ''
    try { const p = Object.getPrototypeOf(vf); proto = ' | proto:' + (p ? Object.getOwnPropertyNames(p).slice(0, 25).join(',') : 'null') } catch { /* */ }
    return desc + extra + proto
  } catch (e) { return 'PROBE THROW: ' + e.message }
})()`)
log(shape)
const tf = await cdp.evaluate(`return document.querySelector('.vue-flow__transformationpane')?.style.transform || '(none)'`)
log('当前 transform: ' + tf)
ws.close()
process.exit(0)
