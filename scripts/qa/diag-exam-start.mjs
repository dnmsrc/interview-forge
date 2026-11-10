// 考试 start 直连实验 + 主进程日志盯梢
import { Cdp, sleep } from './cdp.mjs'
import fs from 'node:fs'
const log = (m) => process.stderr.write(`[s] ${m}\n`)
const LOGF = 'forge-boot.log'
let pos = fs.existsSync(LOGF) ? fs.statSync(LOGF).size : 0
const readMainLog = () => {
  const size = fs.existsSync(LOGF) ? fs.statSync(LOGF).size : 0
  if (size <= pos) return ''
  const fd = fs.openSync(LOGF, 'r'); const buf = Buffer.alloc(size - pos)
  fs.readSync(fd, buf, 0, buf.length, pos); fs.closeSync(fd); pos = size
  return buf.toString('utf8')
}
const cdp = await Cdp.connect()
await cdp.metrics(1460, 920)
await cdp.evaluate("location.reload(); return 1").catch(() => {})
await sleep(3000)
await cdp.evaluate("location.hash = '#/exam'; return 1")
await sleep(2500)
cdp.clearErrors()

// ① 直连 start（纯字面量 spec，与模板一致）
const r1 = await cdp.evaluate(`
  try {
    const r = await window.forge.exam.start({ domains: ['fe'], count: 20, minutes: 45, passLine: 60, title: '前端 45 分钟速测' });
    return JSON.stringify(r).slice(0, 200)
  } catch (e) { return 'THROW: ' + e.message }
`)
log('exam.start 直连: ' + r1)
const main1 = readMainLog()
if (main1) log('主进程增量: ' + main1.replace(/\s+/g, ' ').slice(0, 400))

// ② 页面 reload 后 bootResume 能否恢复这条 running
await cdp.evaluate("location.reload(); return 1").catch(() => {})
await sleep(3200)
await cdp.evaluate("location.hash = '#/exam'; return 1")
await sleep(3000)
const st = await cdp.evaluate(`return {
  timer: !!document.querySelector('.timer'),
  pill: document.body.innerText.match(/第\\s*\\d+\\s*\\/\\s*\\d+\\s*题/)?.[0] || null,
  quit: [...document.querySelectorAll('button')].map(b=>b.textContent.trim()).filter(t=>t&&t.length<12).join('|').slice(0,120),
  msg: [...document.querySelectorAll('.n-message__content')].map(e=>e.textContent.trim())
}`)
log('reload 后 bootResume: ' + JSON.stringify(st))
for (const e of cdp.errors()) log('err: ' + JSON.stringify(e).slice(0, 250))
await cdp.shot('data/qa/diag-exam-start.png')
await cdp.close()
