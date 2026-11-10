// 图谱重设计视觉验收：连 FORGE_QA=1 启动的隐藏后台测试窗口（独立 page target，启动即 #/graph）。
// 全部导航/视口 override 只作用于该窗口——用户主窗口（可能在考试）全程零打扰。
import { Cdp, sleep } from './cdp.mjs'

const PORT = process.env.QA_PORT || '9222'
const log = (m) => process.stderr.write(`[g] ${m}\n`)
const httpJson = async (p) => (await fetch(`http://127.0.0.1:${PORT}${p}`)).json()

let page = null
for (let i = 0; i < 25; i++) {
  const list = await httpJson('/json/list')
  page = list.find((t) => t.type === 'page' && /%23\/graph|#\/graph/.test(t.url || '') && t.webSocketDebuggerUrl) || null
  if (page) break
  await sleep(800)
}
if (!page?.webSocketDebuggerUrl) { log('FORGE_QA 测试窗口未出现（需 FORGE_QA=1 重启 dev）'); process.exit(3) }
log('测试窗口: ' + decodeURIComponent(page.url).slice(-30))

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
const cdp = new Cdp(ws)
await cdp.init()
// 注意：这个测试窗口真实视口就是 ~1424x815（≈验收目标）。**不要 setDeviceMetricsOverride**——
// 它有头模式下只改 CSS 视口与 surface 不同步（截图会花、fit 基于旧尺寸算），曾把 fit 计算污染成谜案。
await cdp.cmd('Emulation.clearDeviceMetricsOverride').catch(() => {})
await sleep(4200)   // boot + IPC + dimensions 就绪 + fitView
// FORGE_QA 窗口上次验收可能把板块停在 cs——强制复位 fe 起点，保证状态序列可比
await cdp.evaluate("location.reload(); return 1").catch(() => {})
await sleep(3500)
const dom = await cdp.evaluate(`return document.querySelector('.graph-toolbar .n-base-selection')?.textContent?.trim() || '?'`)
log('起始板块: ' + dom)

async function snap(name, before) {
  if (before) await before()
  await sleep(2400)   // 等 doFitNow 的 dimensions 轮询(≤4s 但通常 1 轮)+350ms 动画 + 重排稳定
  const st = await cdp.evaluate(`return {
    gn: document.querySelectorAll('.gn').length,
    l2: document.querySelectorAll('.gn-l2').length,
    l4: document.querySelectorAll('.gn-l4').length,
    fit: (document.querySelector('.vue-flow__transformationpane')?.style.transform || '').slice(0, 46),
    minimap: !!document.querySelector('.vue-flow__minimap'),
    prog: document.querySelector('.graph-progress')?.innerText.replace(/\\s+/g, ' ').trim().slice(0, 44) || null
  }`)
  log(name.padEnd(13) + JSON.stringify(st))
  await cdp.shot(`data/qa/r5-graph-${name}.png`)
}

await snap('default-fe')
await snap('expand-all', () => cdp.clickText('展开全部'))
await snap('collapsed', () => cdp.clickText('收起到模块'))
await snap('search-react', async () => { await cdp.fill('.graph-toolbar input', 'React'); await sleep(1400) })
await snap('focus-dim', async () => {
  await cdp.fill('.graph-toolbar input', '')
  await sleep(400)
  await cdp.clickText('展开全部')
  await sleep(1600)
  await cdp.evaluate(`
    const n = [...document.querySelectorAll('.gn-l4')].filter(e => e.getBoundingClientRect().width > 0)[3];
    if (n) n.dispatchEvent(new MouseEvent('click', { bubbles: true })); return 1`)
})
await snap('cs-domain', async () => {
  await cdp.evaluate(`document.querySelector('.drawer .n-button')?.click(); return 1`)   // 关抽屉
  await cdp.evaluate(`
    const sel = document.querySelector('.graph-toolbar .n-select');
    sel.querySelector('.n-base-selection')?.dispatchEvent(new MouseEvent('click', { bubbles: true })); return 1`)
  await sleep(700)
  await cdp.evaluate(`
    const opt = [...document.querySelectorAll('.n-base-select-option')].find(e => e.textContent.includes('公共基础'));
    opt?.dispatchEvent(new MouseEvent('click', { bubbles: true })); return 1`)
})
const errs = cdp.errors().filter((e) => !/deprecated|Vue Flow|ResizeObserver/i.test(e.text))
log('JS 错误: ' + (errs.length ? JSON.stringify(errs.slice(0, 3)).slice(0, 300) : '无'))
await cdp.close()
process.exit(0)
