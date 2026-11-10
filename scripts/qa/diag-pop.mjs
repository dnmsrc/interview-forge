// popconfirm 不弹的对照实验：elementFromPoint / DOM click / trusted click
import { Cdp, sleep } from './cdp.mjs'
const log = (m) => process.stderr.write(`[p] ${m}\n`)
const cdp = await Cdp.connect()
await cdp.metrics(1460, 920)
await cdp.evaluate("location.reload(); return 1").catch(() => {})
await sleep(3000)
await cdp.evaluate("location.hash = '#/exam'; return 1")
await sleep(2000)
let st = await cdp.evaluate(`return { running: !!document.querySelector('.timer'), setup: document.body.innerText.includes('开始 →') }`)
if (!st.running) {
  if (st.setup) { await cdp.clickSel('.stat', 0); await cdp.waitFor(`!!document.querySelector('.timer')`, 15000, 'running') }
}
log('running ok')

const geo = await cdp.evaluate(`
  const b = [...document.querySelectorAll('button')].find((e) => e.textContent.trim() === '弃考');
  const r = b.getBoundingClientRect();
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const hit = document.elementFromPoint(cx, cy);
  return { rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, cx: Math.round(cx), cy: Math.round(cy), hit: hit ? hit.tagName + '.' + String(hit.className).slice(0, 44) : null, hitIsBtn: hit === b || b.contains(hit) }
`)
log('几何: ' + JSON.stringify(geo))

// ① trusted click
await cdp.mouse(geo.cx, geo.cy)
await sleep(900)
let pop = await cdp.evaluate(`return document.querySelectorAll('.n-popover').length + ' popovers; visible=' + [...document.querySelectorAll('.n-popover')].map(p=>{const r=p.getBoundingClientRect();return Math.round(r.width)+'x'+Math.round(r.height)+'@'+Math.round(r.x)+','+Math.round(r.y)}).join('|')`)
log('trusted click 后: ' + pop)

// ② 若没弹：DOM click 对照
if (/^0/.test(pop)) {
  const pop2 = await cdp.evaluate(`
    const b = [...document.querySelectorAll('button')].find((e) => e.textContent.trim() === '弃考');
    b.click();
    await new Promise((res) => setTimeout(res, 900));
    const pops = [...document.querySelectorAll('.n-popover,.n-modal-body-wrapper')];
    return pops.length + ' dom-click popovers: ' + pops.map((p) => { const r = p.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height) + '@' + Math.round(r.x) + ',' + Math.round(r.y) }).join('|')
  `)
  log('DOM click 后: ' + pop2)
  // ③ trusted 事件序列细分：只发 down+up 到按钮中心（跳过 move）
  const r = geo
  await cdp.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.cx, y: r.cy, button: 'left', clickCount: 1, buttons: 1 })
  await cdp.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.cx, y: r.cy, button: 'left', clickCount: 1, buttons: 0 })
  await sleep(800)
  const pop3 = await cdp.evaluate(`return document.querySelectorAll('.n-popover').length`)
  log('无 move 的直接 down/up 后 popover 数: ' + pop3)
}
await cdp.shot('data/qa/diag-popconfirm.png')
await cdp.close()
