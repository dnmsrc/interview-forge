// L2→L3→L4 三级下钻 + 详情"开练"跳转验证
import { Cdp, sleep } from './cdp.mjs'
const log = (m) => process.stderr.write(`[d] ${m}\n`)
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const t = list.find((x) => /graph/.test(decodeURIComponent(x.url || '')))
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
const cdp = new Cdp(ws)
await cdp.init()
await cdp.evaluate('location.reload(); 1').catch(() => {})
await sleep(5000)

const cnt = () => cdp.evaluate(`return { gn: document.querySelectorAll('.gn').length, l3: document.querySelectorAll('.gn-l3').length, l4: document.querySelectorAll('.gn-l4').length }`)
log('初始 ' + JSON.stringify(await cnt()))
// 双击第一个 L2
await cdp.evaluate(`document.querySelector('.gn-l2')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); 1`)
await sleep(1800)
log('L2 展开 ' + JSON.stringify(await cnt()))
// 双击第一个 L3 → 应出现 L4
const l3 = await cdp.evaluate(`(() => { const e = document.querySelector('.gn-l3'); e?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return e?.querySelector('.t')?.textContent?.trim()?.slice(0, 14) })()`)
await sleep(1800)
log('双击 L3(' + l3 + ') 后 ' + JSON.stringify(await cnt()))
// 单击一个 L4 → 抽屉 + 开练按钮
await cdp.evaluate(`document.querySelector('.gn-l4')?.dispatchEvent(new MouseEvent('click', { bubbles: true })); 1`)
await sleep(1500)
const drawer = await cdp.evaluate(`return { open: !!document.querySelector('.drawer'), title: document.querySelector('.drawer h3')?.textContent?.trim()?.slice(0, 24), practice: document.querySelector('.drawer .n-button--primary-type')?.textContent?.trim() }`)
log('L4 抽屉 ' + JSON.stringify(drawer))
// 双击 L3 收起 → L4 消失
await cdp.evaluate(`document.querySelector('.gn-l3')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); 1`)
await sleep(1600)
log('L3 收起 ' + JSON.stringify(await cnt()))
ws.close()
process.exit(0)
