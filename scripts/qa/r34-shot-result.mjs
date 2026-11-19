import { Cdp, sleep } from './cdp.mjs'
const cdp = await Cdp.connect()
await cdp.nav('/projects/mini-vue-reactivity/lv1')
await sleep(800)
await cdp.clickText('跑测试')
await cdp.waitFor(`!!document.querySelector('.result .fb')`, 20000, '结果面板')
await sleep(900)
await cdp.evaluate(`
  const st = document.querySelector('.stage-result.pending')
  ;(st || document.querySelector('.result'))?.scrollIntoView({ block: 'center', behavior: 'instant' })
  return 1
`)
await sleep(500)
await cdp.shot('data/qa/r34-result-collapsed.png')
console.log('ok')
cdp.close()
