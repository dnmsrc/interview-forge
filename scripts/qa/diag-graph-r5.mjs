// 图谱重设计视觉验收：CreateTarget 开「新窗口」并直接加载 #/graph，
// 每个 target 独立 overlay 视口——绝不碰用户正在考试的窗口。
import { Cdp, sleep } from './cdp.mjs'

const PORT = process.env.QA_PORT || '9222'
const httpJson = async (p) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${p}`)
  if (!r.ok) throw new Error(`${p} -> ${r.status}`)
  return r.json()
}
const httpGet = async (url) => {
  const ws = new WebSocket(url)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let onmsg = () => {}
  ws.onmessage = (ev) => onmsg(JSON.parse(String(ev.data)))
  const send = (obj) => ws.send(JSON.stringify(obj))
  const wait = (id) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('CDP 浏览器级超时')), 8000)
    onmsg = (m) => { if (m.id === id) { clearTimeout(t); onmsg = () => {}; res(m) } }
  })
  send({ id: 1, method: 'Target.createTarget', params: { url: 'about:blank' } })
  const created = await wait(1)
  if (!created.result) throw new Error('createTarget 失败: ' + JSON.stringify(created.error || created))
  const targetId = created.result.targetId
  ws.close()
  return targetId
}
const log = (m) => process.stderr.write(`[g] ${m}\n`)

// ① 浏览器级 WS 开新 target
const targets = await httpJson('/json/list')
const browserWsUrl = (await httpJson('/json/version')).webSocketDebuggerUrl
void targets; void browserWsUrl
const targetId = await httpGet(browserWsUrl)
log('新 target: ' + targetId)

// ② attach 到该 target 的 page session（走 Cdp 类需要 page target 的 ws url——等它出现在 /json/list）
let page
for (let i = 0; i < 15; i++) {
  page = (await httpJson('/json/list')).find((t) => t.targetId === targetId && t.type === 'page')
  if (page?.webSocketDebuggerUrl) break
  await sleep(600)
}
if (!page) throw new Error('新 target 没出现 page endpoint')

// 手工构造 Cdp 实例连到指定 ws url（绕开 connect 的主页选择逻辑）
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
const cdp = new Cdp(ws)
await cdp.init()
await cdp.cmd('Emulation.setDeviceMetricsOverride', { width: 1460, height: 900, deviceScaleFactor: 1, mobile: false })

// ③ 导航到 graph（新窗口自己 hash 路由，主页不受影响）
await cdp.evaluate("location.hash = '#/graph'; return 1")
await sleep(4200)

async function snap(name, before) {
  if (before) await before()
  await sleep(1600)
  const st = await cdp.evaluate(`return {
    gn: document.querySelectorAll('.gn').length,
    l2: document.querySelectorAll('.gn-l2').length,
    l4: document.querySelectorAll('.gn-l4').length,
    tf: (document.querySelector('.vue-flow__transformationpane')?.style.transform || '').slice(0, 50),
    minimap: !!document.querySelector('.vue-flow__minimap'),
    prog: document.querySelector('.graph-progress')?.innerText.replace(/\\s+/g, ' ').slice(0, 40) || null
  }`)
  log(name + ': ' + JSON.stringify(st))
  await cdp.shot(`data/qa/r5-graph-${name}.png`)
}

await snap('default-fe')                                    // 默认视图：只展开到模块层
await snap('expand-all', () => cdp.clickText('展开全部'))
await snap('collapsed', async () => { await cdp.clickText('收起到模块'); await sleep(300) })
await snap('search-react', async () => {                     // 搜索定位
  await cdp.fill('.graph-toolbar input', 'React')
})
await snap('cs-domain', async () => {                        // 切板块
  await cdp.evaluate(`
    const sel = document.querySelector('.graph-toolbar .n-select');
    sel.querySelector('.n-base-selection')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return 1`)
  await sleep(700)
  await cdp.evaluate(`
    const opt = [...document.querySelectorAll('.n-base-select-option')].find(e => e.textContent.includes('公共基础'));
    opt?.dispatchEvent(new MouseEvent('click', { bubbles: true })); return 1`)
})
await snap('focus-node', async () => {                       // 点选一个考点看 dim 聚焦
  await cdp.evaluate(`
    const n = [...document.querySelectorAll('.gn-l4')].filter(e => e.getBoundingClientRect().width > 0)[3];
    if (n) n.dispatchEvent(new MouseEvent('click', { bubbles: true })); return !!n`)
})
const errs = cdp.errors().filter((e) => !/deprecated|Vue Flow/i.test(e.text))
log('JS 错误: ' + (errs.length ? JSON.stringify(errs.slice(0, 3)) : '无'))
await cdp.cmd('Target.closeTarget', { targetId }).catch(() => {})
process.exit(0)
