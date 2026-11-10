// 双击钻取 + 单击详情 + 收起 的完整交互闭环验证
import { Cdp, sleep } from './cdp.mjs'
const log = (m) => process.stderr.write(`[i] ${m}\n`)
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const t = list.find((x) => /graph/.test(decodeURIComponent(x.url || '')))
const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
const cdp = new Cdp(ws)
await cdp.init()
await cdp.evaluate('location.reload(); 1').catch(() => {})
await sleep(5000)

const count = () => cdp.evaluate(`return { gn: document.querySelectorAll('.gn').length, l3: document.querySelectorAll('.gn-l3').length, l4: document.querySelectorAll('.gn-l4').length }`)
log('初始: ' + JSON.stringify(await count()))

// 双击第一个 L2 模块卡 → 应展开它的 L3
const dbl = await cdp.evaluate(`(() => {
  const card = document.querySelector('.gn-l2')
  if (!card) return 'no l2'
  card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
  return card.querySelector('.t')?.textContent?.trim()?.slice(0, 12)
})()`)
log('双击 L2: ' + dbl)
await sleep(2000)
log('双击后: ' + JSON.stringify(await count()))

// 再双击一次 → 收起
await cdp.evaluate(`document.querySelector('.gn-l2')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); 1`)
await sleep(1800)
log('收起后: ' + JSON.stringify(await count()))

// 单击一个 L2 → 抽屉应打开（nodeClick 经事件总线）
const click = await cdp.evaluate(`(() => {
  const card = document.querySelector('.gn-l2')
  card?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  return !!card
})()`)
await sleep(1500)
const drawer = await cdp.evaluate(`return { open: !!document.querySelector('.drawer'), title: document.querySelector('.drawer h3')?.textContent?.trim()?.slice(0, 20), practiceBtn: !!document.querySelector('.drawer .n-button--primary-type') }`)
log('单击抽屉: ' + JSON.stringify({ clicked: click, ...drawer }))

// pane 空白点击 → 取消聚焦（不关闭抽屉，只清 selId 的 dim）
await cdp.evaluate(`document.querySelector('.vue-flow__pane')?.dispatchEvent(new MouseEvent('click', { bubbles: true })); 1`)
await sleep(600)
log('pane 点击后 dim 数: ' + await cdp.evaluate(`return document.querySelectorAll('.gn.dim').length`))

const errs = cdp.errors().filter((e) => !/deprecated|Vue Flow|ResizeObserver|cx|NaN/i.test(e.text))
log('JS 错误: ' + (errs.length ? JSON.stringify(errs.slice(0, 2)) : '无'))
ws.close()
process.exit(0)
