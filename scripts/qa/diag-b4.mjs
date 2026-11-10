// 复跑 B4 完整序列 + 定位弃考失效真相；顺带验证反馈面板「就地提问」文案
import { Cdp, sleep } from './cdp.mjs'
const log = (m) => process.stderr.write(`[b4] ${m}\n`)
const cdp = await Cdp.connect()
await cdp.metrics(1460, 920)

// 准备：reload → setup → 开考
await cdp.evaluate("location.reload(); return 1").catch(() => {})
await sleep(3000)
await cdp.evaluate("location.hash = '#/exam'; return 1")
await sleep(2000)
let st = await cdp.evaluate(`return { running: !!document.querySelector('.timer'), setup: document.body.innerText.includes('开始 →'), report: document.body.innerText.includes('再来一卷') }`)
if (st.running) { log('有 running 残留，先走一次弃考清场'); }
if (!st.running && st.setup) { await cdp.clickSel('.stat', 0); await cdp.waitFor(`!!document.querySelector('.timer')`, 15000, 'running') }
else if (!st.running && st.report) { await cdp.clickText('再来一卷'); await sleep(800); await cdp.clickSel('.stat', 0); await cdp.waitFor(`!!document.querySelector('.timer')`, 15000, 'running') }
log('running 就绪')

// 复刻 clickText('弃考') 的定位与点击
const loc = await cdp.evaluate(`
  const sels = 'button,.n-button,a,.opt,label,.nav a,.vf-node,.pill,th,.q-item,summary,[role="switch"]';
  const els = [...document.querySelectorAll(sels)];
  const vis = els.filter((e) => {
    const s = getComputedStyle(e);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) < 0.05) return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && (e.textContent || '').trim().includes('弃考');
  });
  if (!vis.length) return { found: 0 };
  const el = vis[0];
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  const r = el.getBoundingClientRect();
  return { found: vis.length, tag: el.tagName, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), inView: r.y >= 0 && r.bottom <= innerHeight }
`)
log('clickText 定位结果: ' + JSON.stringify(loc))
if (loc.found) {
  await cdp.mouse(loc.x, loc.y)
  await sleep(1000)
  const pop = await cdp.evaluate(`return {
    n: document.querySelectorAll('.n-popover').length,
    texts: [...document.querySelectorAll('.n-popover')].map((p) => p.textContent.trim().slice(0, 40)),
    btns: [...document.querySelectorAll('.n-popover button')].map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim(), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } })
  }`)
  log('popover: ' + JSON.stringify(pop))
  if (pop.n && pop.btns.length) {
    const ok = pop.btns.find((b) => b.t === '弃考') || pop.btns[pop.btns.length - 1]
    await cdp.mouse(ok.x, ok.y)
    await sleep(1200)
    const back = await cdp.evaluate(`return document.body.innerText.includes('开始 →')`)
    log('确认后回到组卷页: ' + back)
  }
}

// 「就地提问」文案核查（练习答完题的反馈区）
await cdp.evaluate("location.hash = '#/practice'; return 1")
await cdp.waitFor(`!!document.querySelector('.stem')`, 25000, '题干')
await cdp.clickText('2·已说清')
await cdp.waitFor(`document.body.innerText.includes('讲评')`, 15000, '反馈出现')
const fb = await cdp.evaluate(`return {
  hasAskAnywhere: document.body.innerText.includes('就地提问'),
  askBtns: [...document.querySelectorAll('button')].map(e=>e.textContent.trim()).filter(t=>t.includes('提')||t.includes('追问')).slice(0,8)
}`)
log('反馈面板按钮: ' + JSON.stringify(fb))
await cdp.close()
