// R33 探针二：站在关卡地图看「从零重做」是否在首屏可见
import { Cdp, sleep } from './cdp.mjs'

const cdp = await Cdp.connect()
await cdp.nav('/projects/mini-vue-reactivity')
await sleep(1200)

const info = await cdp.evaluate(`
  const vis = (el) => {
    const st = getComputedStyle(el)
    if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) < 0.05) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const target = [...document.querySelectorAll('button')].filter(vis)
    .map(e => {
      const r = e.getBoundingClientRect()
      return { txt: (e.textContent||'').trim().replace(/\\s+/g,' ').slice(0,30), top: Math.round(r.top + scrollY), inView: r.top >= 0 && r.bottom <= innerHeight }
    })
    .filter(b => /重做|重置|清空/.test(b.txt))
  return { hash: location.hash, vh: innerHeight, docH: document.documentElement.scrollHeight, scrollY: Math.round(scrollY), targets: target }
`)
console.log(JSON.stringify(info, null, 2))
await cdp.shot('data/qa/r33-board.png')
await cdp.close()