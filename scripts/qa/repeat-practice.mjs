// 反复触发练习页自动组卷，观察 clone 错误是否概率性复现；同时监控主进程 boot.log 增量
import { Cdp, sleep } from './cdp.mjs'
import fs from 'node:fs'
const log = (m) => process.stderr.write(`[rep] ${m}\n`)
const cdp = await Cdp.connect()

const LOGF = 'forge-boot.log'
const logSize = () => fs.existsSync(LOGF) ? fs.statSync(LOGF).size : 0
let pos = logSize()
const readMainLog = () => {
  const size = logSize()
  if (size <= pos) return ''
  const fd = fs.openSync(LOGF, 'r')
  const buf = Buffer.alloc(size - pos)
  fs.readSync(fd, buf, 0, buf.length, pos)
  fs.closeSync(fd)
  pos = size
  return buf.toString('utf8')
}

for (let i = 1; i <= 4; i++) {
  cdp.clearErrors()
  await cdp.evaluate("location.hash = '#/'; return 1")
  await sleep(900)
  await cdp.evaluate("location.hash = '#/practice'; return 1")
  await sleep(3200)
  const state = await cdp.evaluate(`return {
    qCards: document.querySelectorAll('.card').length,
    stem: !!document.querySelector('.stem'),
    empty: !!document.querySelector('.n-empty'),
    opts: document.querySelectorAll('.opt').length,
    toast: [...document.querySelectorAll('.n-message__content,.n-notification__description,.n-notification__content')].map(e => e.textContent.trim()).join(' || ') || '(无)'
  }`)
  const errs = cdp.errors()
  log(`#${i} 页面: 题干=${state.stem} 选项=${state.opts} 空态=${state.empty} toast=${state.toast}`)
  if (errs.length) for (const e of errs) log(`   err: ${JSON.stringify(e).slice(0, 250)}`)
  const main = readMainLog()
  if (main) log('   主进程日志增量: ' + main.replace(/\s+/g, ' ').slice(0, 300))
}

// 最后停一帧截图
await cdp.evaluate("location.hash = '#/practice'; return 1")
await sleep(3000)
await cdp.metrics(1460, 920)
await cdp.shot('data/qa/diag-practice.png')
log('已存 data/qa/diag-practice.png')
await cdp.close()
