// 考试运行页：弃考按钮真实文案与位置取证
import { Cdp, sleep } from './cdp.mjs'
const log = (m) => process.stderr.write(`[q] ${m}\n`)
const cdp = await Cdp.connect()
await cdp.metrics(1460, 920)
await cdp.evaluate("location.reload(); return 1").catch(() => {})
await sleep(3000)
await cdp.evaluate("location.hash = '#/exam'; return 1")
await sleep(2000)
// 先清残留 running（若有）
let st = await cdp.evaluate(`return { running: !!document.querySelector('.timer'), setup: document.body.innerText.includes('开始 →'), report: document.body.innerText.includes('再来一卷') }`)
log('初始相位: ' + JSON.stringify(st))
if (st.running) {
  await cdp.evaluate(`const b=[...document.querySelectorAll('button')].find(e=>e.textContent.includes('弃')); if(b){const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}} return null`).then(async (p) => { if (p) { await cdp.mouse(p.x, p.y); await sleep(700) ; const p2 = await cdp.evaluate(`const b=[...document.querySelectorAll('.n-popover button,.n-popconfirm button')].find(e=>/弃考|确定/.test(e.textContent)); if(!b)return null; const r=b.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),t:b.textContent.trim()}`); log('pop确认: '+JSON.stringify(p2)); if (p2) { await cdp.mouse(p2.x,p2.y); await sleep(1000) } } })
  st = { running: false }
}
if (st.report) { await cdp.clickText('再来一卷'); await sleep(900) }
// 开考
await cdp.waitFor(`document.body.innerText.includes('开始 →')`, 10000, 'setup')
await cdp.clickSel('.stat', 0)
await cdp.waitFor(`!!document.querySelector('.timer')`, 15000, 'running')
log('已进入 running')
const bar = await cdp.evaluate(`return {
  qBar: document.querySelector('.q-bar,.q-top,.row')?.textContent.trim().slice(0, 100),
  btns: [...document.querySelectorAll('button')].map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim().slice(0, 10), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) } }).filter((b) => b.t && b.w > 0).slice(0, 30)
}`)
log('running 页全部按钮: ' + JSON.stringify(bar, null, 1))
// 点弃考 trigger
const quit = bar.btns.find((b) => b.t.includes('弃') || b.t.includes('退出'))
if (quit) {
  await cdp.mouse(quit.x + Math.round(quit.w / 2), quit.y + 12)
  await sleep(800)
  const pop = await cdp.evaluate(`return { popEl: !!document.querySelector('.n-popover,.n-popconfirm'), popBtns: [...document.querySelectorAll('.n-popover button,.n-popconfirm button')].map(e=>e.textContent.trim()), popText: document.querySelector('.n-popover__body,.n-popconfirm .n-popover__main')?.textContent.slice(0,80) }`)
  log('popconfirm 状态: ' + JSON.stringify(pop))
  await cdp.shot('data/qa/diag-exam-quit.png')
} else {
  log('!! running 页没有任何含弃/退出字样的按钮')
}
await cdp.close()
