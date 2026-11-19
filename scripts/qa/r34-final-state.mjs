import { Cdp, sleep } from './cdp.mjs'
const cdp = await Cdp.connect()
await cdp.nav('/projects/mini-vue-reactivity/lv1')
await sleep(600)
await cdp.reloadHard(2600)
await cdp.waitFor(`!!document.querySelector('.work-toolbar')`, 25000, '关卡页')
await sleep(800)
const s = await cdp.evaluate(`
  const txt = (el) => el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : ''
  return {
    hash: location.hash,
    chip: txt(document.querySelector('.todo-chip')),
    attempts: txt([...document.querySelectorAll('.micro.faint')].find(e => /已尝试/.test(e.textContent || ''))),
    hasResult: !!document.querySelector('.result .fb'),
    stageFlags: [...document.querySelectorAll('.stage-acc > summary .stage-flag')].map(txt),
    errors: 0,
  }
`)
console.log(JSON.stringify(s, null, 1))
await cdp.shot('data/qa/r34-final.png')
cdp.close()
