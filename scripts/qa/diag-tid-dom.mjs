// 直接看练习页动作区里每个按钮的真实 outerHTML，确认 data-testid 是否落到 DOM
import { Cdp, sleep } from './cdp.mjs'
const cdp = await Cdp.connect()
await cdp.metrics(1460, 920)
await cdp.evaluate('location.hash = "#/practice"; return 1')
await sleep(2600)
const out = await cdp.evaluate(`return (function(){
  const rows = [...document.querySelectorAll('.act-row')];
  return {
    actRows: rows.length,
    btns: [...document.querySelectorAll('.act-row button')].map((b) => b.outerHTML.slice(0, 150)),
    allTids: [...document.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid')),
    nButtonAttrs: (() => { const b = document.querySelector('.act-row .n-button'); return b ? b.outerHTML.slice(0, 190) : null })()
  };
})()`)
console.log(JSON.stringify(out, null, 1))
await cdp.close()
