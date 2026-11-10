// 诊断用户窗口闭卷页空白：谁把内容推出视口
import { Cdp, sleep } from './cdp.mjs'
const log = (m) => process.stderr.write(`[b] ${m}\n`)
const cdp = await Cdp.connect()
const st = await cdp.evaluate(`
  const page = document.querySelector('.main') || document.body
  const cards = [...document.querySelectorAll('.page .card, .page > div')].map((e) => {
    const r = e.getBoundingClientRect();
    return { cls: String(e.className).slice(0, 40), top: Math.round(r.top), h: Math.round(r.height), txt: (e.textContent || '').trim().slice(0, 30) }
  })
  return {
    hash: location.hash,
    title: document.title,
    innerH: innerHeight,
    scrollTop: page.scrollTop === undefined ? null : page.scrollTop,
    scrollH: page.scrollHeight,
    timer: !!document.querySelector('.timer'),
    setup: document.body.innerText.includes('开始 →'),
    report: document.body.innerText.includes('再来一卷'),
    grading: document.body.innerText.includes('批改'),
    cards
  }
`)
log(JSON.stringify(st, null, 1))
await cdp.shot('data/qa/diag-user-blank.png')
await cdp.close()
