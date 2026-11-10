// 看 .hero 到底是哪个元素、有几个子项、每个子项的几何与计算样式
import { Cdp, sleep } from './cdp.mjs'
const cdp = await Cdp.connect()
await cdp.metrics(1460, 920)
await cdp.evaluate('location.hash = "#/"; return 1')
await sleep(2600)
const out = await cdp.evaluate(`return (function(){
  const hs = [...document.querySelectorAll('.hero')];
  return hs.map((h) => {
    const r = h.getBoundingClientRect(); const cs = getComputedStyle(h);
    return {
      cls: h.className, tag: h.tagName,
      rect: { top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width) },
      display: cs.display, flexDir: cs.flexDirection, flexWrap: cs.flexWrap, align: cs.alignItems,
      pad: cs.padding, minHeight: cs.minHeight, height: cs.height, overflow: cs.overflow, contain: cs.contain,
      childCount: h.children.length,
      kids: [...h.children].map((c) => { const cr = c.getBoundingClientRect(); const ccs = getComputedStyle(c);
        return { cls: String(c.className).slice(0, 40), tag: c.tagName, top: Math.round(cr.top), h: Math.round(cr.height), w: Math.round(cr.width), pos: ccs.position, fl: ccs.flexShrink + '/' + ccs.flexBasis.slice(0, 12) } })
    };
  });
})()`)
console.log(JSON.stringify(out, null, 1))
await cdp.close()
