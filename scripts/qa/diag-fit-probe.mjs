// fitView 谜团直查：pane-ready 实例能力、节点 measured、getRectOfNodes 包围盒 vs 容器尺寸
import { Cdp, sleep } from './cdp.mjs'
const log = (m) => process.stderr.write(`[f] ${m}\n`)
const PORT = '9222'
const httpJson = async (p) => (await fetch(`http://127.0.0.1:${PORT}${p}`)).json()
let page = null
for (let i = 0; i < 20; i++) {
  page = (await httpJson('/json/list')).find((t) => t.type === 'page' && /%23\/graph|#\/graph/.test(t.url || '') && t.webSocketDebuggerUrl) || null
  if (page) break
  await sleep(800)
}
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
const cdp = new Cdp(ws)
await cdp.init()
await cdp.cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 880, deviceScaleFactor: 1, mobile: false })
await cdp.evaluate("location.reload(); return 1").catch(() => {})
await sleep(5000)

// 在页面里重现 scheduleFit 的轮询逻辑，逐步暴露卡点
const probe = await cdp.evaluate(`
  const out = [];
  // VueFlow store 不在 window 上；用 DOM 度量代替：逐个自定义节点 offsetWidth/Height + flow 容器
  const flow = document.querySelector('.vue-flow');
  const nodes = [...document.querySelectorAll('.vue-flow__node')];
  const gns = [...document.querySelectorAll('.gn')];
  const rects = gns.map(e => e.getBoundingClientRect());
  const minX = Math.min(...rects.map(r => r.left));
  const maxX = Math.max(...rects.map(r => r.right));
  const minY = Math.min(...rects.map(r => r.top));
  const maxY = Math.max(...rects.map(r => r.bottom));
  out.push({
    flowBox: [flow.clientWidth, flow.clientHeight],
    nodeCount: nodes.length, gnCount: gns.length,
    zeroSized: gns.filter(e => e.offsetWidth === 0).length,
    domBounds: [Math.round(minX), Math.round(minY), Math.round(maxX - minX), Math.round(maxY - minY)],
    tf: document.querySelector('.vue-flow__transformationpane')?.style.transform
  });
  return out
`)
log('DOM 实测: ' + JSON.stringify(probe))
await cdp.shot('data/qa/diag-fit-probe.png')
await cdp.close()
process.exit(0)
