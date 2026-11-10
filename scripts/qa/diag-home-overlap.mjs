// 精确测量首页 hero / .fb.bad / 主按钮 的几何关系，判断重叠来源
import { Cdp, sleep } from './cdp.mjs'
const cdp = await Cdp.connect()
await cdp.metrics(1460, 920)
await cdp.evaluate('location.hash = "#/"; return 1')
await sleep(2600)
const out = await cdp.evaluate(`return (function(){
  const pick = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    return { sel, top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), h: Math.round(r.height),
      pos: cs.position, z: cs.zIndex, mt: cs.marginTop, mb: cs.marginBottom, transform: cs.transform.slice(0, 40), opacity: cs.opacity }; };
  const page = document.querySelector('.page');
  const pcs = page && getComputedStyle(page);
  const btn = document.querySelector('[data-testid="home-start"]');
  const rb = btn && btn.getBoundingClientRect();
  const hit = rb ? document.elementFromPoint(rb.x + rb.width / 2, rb.y + rb.height / 2) : null;
  const chain = [];
  for (let e = hit; e && chain.length < 5; e = e.parentElement) chain.push(e.tagName + '.' + String(e.className || '').split(' ').slice(0, 3).join('.'));
  return {
    page: pcs ? { display: pcs.display, gridTemplateRows: pcs.gridTemplateRows.slice(0, 90), alignContent: pcs.alignContent, gap: pcs.gap, overflowY: pcs.overflowY, scrollTop: page.scrollTop, sh: page.scrollHeight, ch: page.clientHeight } : null,
    els: ['.hero', '.hero .acts', '[data-testid="home-start"]', '.fb.bad', '.tasks'].map(pick),
    hitChain: chain
  };
})()`)
console.log(JSON.stringify(out, null, 1))
await cdp.close()
