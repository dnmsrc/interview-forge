// 决定性对照：纯对象 vs 真 reactive proxy 调同一通道；并读主进程日志增量
import { Cdp, sleep } from './cdp.mjs'
import fs from 'node:fs'
const log = (m) => process.stderr.write(`[xcheck] ${m}\n`)
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
await cdp.evaluate("location.reload(); return 1").catch(() => {})
await sleep(3000)
await cdp.evaluate("location.hash = '#/'; return 1")
await sleep(1500)

const r = await cdp.evaluate(`
  const out = {};
  const mod = await import('/@id/vue');
  const vue = mod.reactive ? mod : (mod.default || {});
  const { reactive } = vue;
  const mk = () => ({ domains: ['fe'], stacks: [], nodeIds: [], types: [], difficulties: [], count: 5, includeDue: true, mixReviewRatio: 0.35, allowLocked: false });
  try { const rows = await window.forge.practice.queue(mk()); out.plain = 'ok rows=' + rows.length } catch (e) { out.plain = e.name + ': ' + e.message }
  try { const rows = await window.forge.practice.queue(reactive(mk())); out.proxy = 'ok rows=' + rows.length } catch (e) { out.proxy = e.name + ': ' + e.message + '\\nSTACK:\\n' + String(e.stack).split('\\n').slice(0, 10).join('\\n') }
  try { const rows = await window.forge.practice.queue({ ...reactive(mk()) }); out.spreadProxy = 'ok rows=' + rows.length } catch (e) { out.spreadProxy = e.name + ': ' + e.message }
  // 对照一个最小编排：settings.set 传 proxy 值 vs 原语
  try { await window.forge.settings.set('globalMixRatio', reactive({ deep: 0.4 }).deep); out.setProxyField = 'ok' } catch (e) { out.setProxyField = e.name + ': ' + e.message }
  return out;
`)
log(JSON.stringify(r, null, 2))
const main = readMainLog()
log('主进程日志增量:\n' + (main || '(无)'))
await cdp.close()
