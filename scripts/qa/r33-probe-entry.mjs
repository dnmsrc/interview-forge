// R33 探针：看用户当前停在哪一页、页面上有哪些「重做/重置」入口可见
import { Cdp, sleep } from './cdp.mjs'

const cdp = await Cdp.connect()

const info = await cdp.evaluate(`
  const vis = (el) => {
    const st = getComputedStyle(el)
    if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) < 0.05) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const btns = [...document.querySelectorAll('button,.n-button,a')]
    .filter(vis)
    .map(e => ({
      txt: (e.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40),
      cls: String(e.className || '').slice(0, 40),
      disabled: !!e.disabled,
      y: Math.round(e.getBoundingClientRect().top),
    }))
    .filter(b => b.txt)
  return {
    hash: location.hash,
    title: document.title,
    h1: [...document.querySelectorAll('h1,h2')].filter(vis).map(e => e.textContent.trim().slice(0, 50)),
    scrollY: Math.round(scrollY),
    docH: document.documentElement.scrollHeight,
    vh: innerHeight,
    btns,
    toast: [...document.querySelectorAll('.toast,.n-message,.fb.bad')].filter(vis).map(e => e.textContent.trim().slice(0, 100)),
  }
`)

console.log(JSON.stringify(info, null, 2))
await cdp.shot('data/qa/r33-current.png')
await cdp.close()