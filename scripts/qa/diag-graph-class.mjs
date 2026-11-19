// 快速核查图谱 L4 节点的实际 class 与 data 字段
import { Cdp, sleep } from './cdp.mjs'
const cdp = await Cdp.connect()
await cdp.metrics(1460, 900)
await cdp.evaluate('location.hash = "#/graph"; return 1')
await sleep(3000)
await cdp.evaluate(`[...document.querySelectorAll('.graph-toolbar button')].find(b => b.innerText.includes('展开全部'))?.click(); return 1`)
await sleep(2500)
const info = await cdp.evaluate(`
  const els = [...document.querySelectorAll('.gn-l4')].slice(0, 5)
  return els.map(el => ({ cls: el.className, staleFlag: !!el.querySelector('.stale-flag') }))
`)
console.log(JSON.stringify(info, null, 1))
const dataProbe = await cdp.evaluate(`
  const inst = document.querySelector('.vue-flow')?.__vue_app__
  return { hasFlow: !!inst, l4Count: document.querySelectorAll('.gn-l4').length }
`)
console.log(JSON.stringify(dataProbe))
await cdp.shot('data/qa/r7-mastery-graph-expanded.png')
await cdp.close()
