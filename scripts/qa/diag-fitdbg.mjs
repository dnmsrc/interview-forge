// 读测试窗最近一次 doFitNow 的调试痕迹
import { Cdp, sleep } from './cdp.mjs'
const log = (m) => process.stderr.write(`[d] ${m}\n`)
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const t = list.find((x) => /graph/.test(decodeURIComponent(x.url || '')))
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
const cdp = new Cdp(ws)
await cdp.init()
await cdp.evaluate('location.reload(); return 1').catch(() => {})
await sleep(5200)
log('reload 后 __fitdbg: ' + JSON.stringify(await cdp.evaluate('return window.__fitdbg')))
log('tf: ' + await cdp.evaluate(`return document.querySelector('.vue-flow__transformationpane')?.style.transform`))
// 手动触发一次完整 doFit 路径：直接调 store.fitView 看结果
const manual = await cdp.evaluate(`return (() => {
  const vf = window.__vf
  if (!vf) return 'no vf'
  const before = document.querySelector('.vue-flow__transformationpane')?.style.transform
  try { vf.fitView({ padding: 0.16, duration: 0 }) } catch (e) { return 'THROW ' + e.message }
  return { before, after: document.querySelector('.vue-flow__transformationpane')?.style.transform }
})()`)
log('手动 fitView(duration0): ' + JSON.stringify(manual))
await sleep(300)
log('再读 tf: ' + await cdp.evaluate(`return document.querySelector('.vue-flow__transformationpane')?.style.transform`))
ws.close()
process.exit(0)
