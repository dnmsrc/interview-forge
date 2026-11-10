// start 返回值全文 + 主进程 exam.start/自动交卷路径排查
import { Cdp, sleep } from './cdp.mjs'
const log = (m) => process.stderr.write(`[x] ${m}\n`)
const cdp = await Cdp.connect()
const r = await cdp.evaluate(`
  try {
    const r = await window.forge.exam.start({ domains: ['fe'], count: 20, minutes: 45, passLine: 60 });
    return JSON.stringify({ keys: Object.keys(r), id: r.id, status: r.status, submitted_at: r.submitted_at, total: r.total, remainingMs: r.remainingMs })
  } catch (e) { return 'THROW: ' + e.message }
`)
log('start 返回: ' + r)
// resume 看它认为有没有 running
const res = await cdp.evaluate(`
  try { const s = await window.forge.exam.resume(); return JSON.stringify(s && { id: s.id, status: s.status, remainingMs: s.remainingMs }) } catch (e) { return 'THROW: ' + e.message }
`)
log('resume: ' + res)
// summary/history
const hist = await cdp.evaluate(`
  try { const h = await window.forge.exam.history(3); return JSON.stringify(h.map((x) => ({ id: x.id, status: x.status, submitted: !!x.submitted_at }))) } catch (e) { return 'THROW: ' + e.message }
`)
log('history: ' + hist)
await cdp.close()
