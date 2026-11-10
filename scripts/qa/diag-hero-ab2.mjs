// 二次实验：overflow:clip / 各子项逐个隐藏，判断塌缩是否由某个子项引起
import { Cdp, sleep } from './cdp.mjs'
const cdp = await Cdp.connect()
await cdp.metrics(1460, 920)
await cdp.evaluate('location.hash = "#/"; return 1')
await sleep(2800)
const out = await cdp.evaluate(`return (function(){
  const h = document.querySelector('.hero');
  const base = h.getAttribute('style') || '';
  const at = (css) => { h.setAttribute('style', base + (base ? '; ' : '') + css); void h.offsetHeight; return Math.round(h.getBoundingClientRect().height) };
  const kids = [...h.children];
  const rows = [['现状', at('')], ['overflow:clip', at('overflow:clip')], ['overflow:hidden+固定高', at('height:170px')]];
  // 逐个隐藏子项（在 overflow:hidden 下）看高度变化
  h.setAttribute('style', base);
  for (let i = 0; i < kids.length; i++) {
    kids.forEach((k, j) => { k.style.display = j === i ? 'none' : '' })
    void h.offsetHeight
    rows.push(['仅隐藏第' + i + '个子项', Math.round(h.getBoundingClientRect().height)])
  }
  kids.forEach((k) => { k.style.display = '' });
  h.setAttribute('style', base);
  return { rows, kidInfo: kids.map((k) => ({ cls: String(k.className).slice(0, 30), pos: getComputedStyle(k).position, w: Math.round(k.getBoundingClientRect().width), h: Math.round(k.getBoundingClientRect().height) })) };
})()`)
console.log(JSON.stringify(out, null, 1))
await cdp.close()
