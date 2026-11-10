// B 组 flaky 真相：running 会话何时消失；DB exams 表状态；bootResume 各相位行为
import { DatabaseSync } from 'node:sqlite'
import { Cdp, sleep } from './cdp.mjs'
const log = (m) => process.stderr.write(`[e] ${m}\n`)
const cdp = await Cdp.connect()
await cdp.metrics(1460, 920)

// DB 状态直读
const db = new DatabaseSync('data/app.db')
const rows = db.prepare('SELECT * FROM exams ORDER BY rowid DESC LIMIT 4').all().map((r) => { const o = {}; for (const [k, v] of Object.entries(r)) if (!String(v || '').startsWith('{') || String(v).length < 60) o[k] = v; return o })
log('exams 表最近 5 条: ' + JSON.stringify(rows))

cdp.clearErrors()
await cdp.evaluate("location.reload(); return 1").catch(() => {})
await sleep(3000)
await cdp.evaluate("location.hash = '#/exam'; return 1")
for (let i = 1; i <= 5; i++) {
  await sleep(1500)
  const st = await cdp.evaluate(`return {
    timer: !!document.querySelector('.timer'),
    setup: document.body.innerText.includes('开始 →'),
    report: document.body.innerText.includes('再来一卷'),
    blank: document.querySelectorAll('.page .card').length === 0,
    msg: [...document.querySelectorAll('.n-message__content')].map(e=>e.textContent.trim()).slice(0,2)
  }`)
  log(`boot t+${i * 1.5}s ${JSON.stringify(st)}`)
}
// 若 setup 则开考并逐秒盯梢
const now = await cdp.evaluate(`return document.body.innerText.includes('开始 →')`)
if (now) {
  await cdp.clickSel('.stat', 0)
  for (let i = 1; i <= 6; i++) {
    await sleep(1500)
    const st = await cdp.evaluate(`return {
      timer: !!document.querySelector('.timer'),
      pill: document.body.innerText.match(/第\\s*\\d+\\s*\\/\\s*\\d+\\s*题/)?.[0] || null,
      quit: [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '弃考'),
      submit: [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '交卷'),
      cards: document.querySelectorAll('.page .card').length
    }`)
    log(`run t+${i * 1.5}s ${JSON.stringify(st)}`)
  }
  // 点下一题再盯
  await cdp.clickText('下一题 →').catch((e) => log('下一题点击失败: ' + e.message))
  await sleep(1500)
  const after = await cdp.evaluate(`return {
    pill: document.body.innerText.match(/第\\s*\\d+\\s*\\/\\s*\\d+\\s*题/)?.[0] || null,
    quit: [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '弃考'),
    hash: location.hash
  }`)
  log('下一题后: ' + JSON.stringify(after))
}
for (const e of cdp.errors()) log('err: ' + JSON.stringify(e).slice(0, 300))
await cdp.shot('data/qa/diag-exam-trace.png')
await cdp.close()
