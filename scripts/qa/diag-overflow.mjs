// 定位横向溢出源：沿 scrollWidth>clientWidth 的元素向下走，直到找到最深的真实元凶
import { Cdp, sleep } from './cdp.mjs'
const PORT = process.env.QA_PORT || '9222'
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const qa = list.filter((t) => t.type === 'page' && /qa=1/.test(t.url))[0]
if (!qa) throw new Error('无 QA 目标')
const cdp = await Cdp.connect(PORT)
await cdp.nav('/dashboard')
await sleep(2500)
const out = await cdp.evaluate(`return (function(){
  const vw = innerWidth;
  const bad = [];
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.right > vw + 2) {
      const st = getComputedStyle(el);
      bad.push({ sel: (el.tagName + '.' + String(el.className || '')).slice(0, 64), w: Math.round(r.width), l: Math.round(r.left), rt: Math.round(r.right), sw: el.scrollWidth, cw: el.clientWidth, ov: st.overflowX, ws: st.whiteSpace });
    }
  }
  // 找出 scrollWidth 明显大于 clientWidth 的容器（真正的滚动源）
  const src = [];
  for (const el of document.querySelectorAll('.page,.grid,.card,.kpis,.q-list,.acc,.acc-body,.md,details,section,div')) {
    if (el.scrollWidth > el.clientWidth + 8) src.push({ sel: (el.tagName + '.' + String(el.className || '')).slice(0, 64), sw: el.scrollWidth, cw: el.clientWidth, ovx: getComputedStyle(el).overflowX });
  }
  return { vw, docSW: document.documentElement.scrollWidth, bodySW: document.body.scrollWidth, pageSW: document.querySelector('.page')?.scrollWidth, pageCW: document.querySelector('.page')?.clientWidth, badCount: bad.length, bad: bad.slice(0, 14), src: src.slice(0, 14) };
})()`)
console.log(JSON.stringify(out, null, 1))
await cdp.close()
