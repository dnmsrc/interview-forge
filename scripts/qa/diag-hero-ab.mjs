// 对照实验：逐项改写 .hero 的样式，看高度什么时候恢复，从而定位塌缩来源
import { Cdp, sleep } from './cdp.mjs'
const cdp = await Cdp.connect()
await cdp.metrics(1460, 920)
await cdp.evaluate('location.hash = "#/"; return 1')
await sleep(2800)
const out = await cdp.evaluate(`return (function(){
  const h = document.querySelector('.hero');
  const base = h.getAttribute('style') || '';
  const at = (css) => { h.setAttribute('style', base + (base ? '; ' : '') + css); void h.offsetHeight; const r = h.getBoundingClientRect(); return Math.round(r.height) };
  const rows = [
    ['现状', at('')],
    ['height:auto', at('height:auto')],
    ['overflow:visible', at('overflow:visible')],
    ['wrap:nowrap', at('flex-wrap:nowrap')],
    ['animation:none', at('animation:none')],
    ['min-height:0', at('min-height:0')],
    ['display:block', at('display:block')],
    ['grid-row:auto', at('grid-row:auto')],
    ['还原', at(base)],
  ];
  // 再看 .page 的 grid-template-rows 是否被显式设置
  const p = document.querySelector('.page'); const pcs = getComputedStyle(p);
  return { rows, pageRows: pcs.gridTemplateRows, pageAutoRows: pcs.gridAutoRows, pageAlign: pcs.alignItems, pageAlignContent: pcs.alignContent,
    heroSelfAlign: getComputedStyle(h).alignSelf, heroJustify: getComputedStyle(h).justifySelf };
})()`)
console.log(JSON.stringify(out, null, 1))
await cdp.close()
