// 一次性探针：看项目闯关页的真实 DOM 结构（选择器/文案/节点），供正式冒烟脚本定位
import { Cdp, sleep } from './cdp.mjs'

const cdp = await Cdp.connect(20)
await cdp.metrics(1460, 920)
cdp.clearErrors()

await cdp.nav('/projects')
await sleep(1400)
const p1 = await cdp.evaluate(`
  const page = document.querySelector('.page') || document.querySelector('main') || document.body;
  return {
    hash: location.hash,
    text: (page.innerText || '').slice(0, 700),
    testids: [...document.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid')).slice(0, 40),
    cards: [...document.querySelectorAll('.card,.proj,.project')].map(e => ({ cls: String(e.className).slice(0,60), txt: (e.innerText||'').trim().slice(0,60) })).slice(0,6),
    h2: [...document.querySelectorAll('h1,h2,h3,.page-title,.h1')].map(e => (e.innerText||'').trim().slice(0,40)).slice(0,8)
  }`)
console.log('=== /projects ===')
console.log(JSON.stringify(p1, null, 2))

await cdp.nav('/projects/mini-vue-reactivity')
await sleep(1400)
const p2 = await cdp.evaluate(`
  return {
    hash: location.hash,
    text: (document.body.innerText || '').slice(0, 900),
    testids: [...document.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid')).slice(0, 40),
    nodes: [...document.querySelectorAll('[class*=level],[class*=node],[class*=step]')].map(e => ({ cls: String(e.className).slice(0,50), tag: e.tagName, dis: e.disabled ?? null, txt: (e.innerText||'').trim().slice(0,50) })).slice(0, 12)
  }`)
console.log('=== /projects/mini-vue-reactivity ===')
console.log(JSON.stringify(p2, null, 2))

await cdp.nav('/projects/mini-vue-reactivity/lv1')
await sleep(1500)
const p3 = await cdp.evaluate(`
  return {
    hash: location.hash,
    textAreas: [...document.querySelectorAll('textarea')].map(t => ({ cls: String(t.className).slice(0,40), rows: t.rows, len: t.value.length, ro: t.readOnly })),
    testids: [...document.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid')).slice(0, 40),
    buttons: [...document.querySelectorAll('button')].map(b => ({ txt: (b.innerText||'').trim().slice(0,24), dis: b.disabled, cls: String(b.className).slice(0,40) })).slice(0, 20),
    text: (document.body.innerText || '').slice(0, 500)
  }`)
console.log('=== /projects/.../lv1 ===')
console.log(JSON.stringify(p3, null, 2))

console.log('=== console errors ===', JSON.stringify(cdp.errors().slice(0, 6)))
await sleep(200)
await cdp.close()