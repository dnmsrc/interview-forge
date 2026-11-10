// 探针：逐步定位 CDP 卡点（stderr 即时输出）
import { Cdp, sleep } from './cdp.mjs'
const log = (m) => process.stderr.write(`[probe] ${m}\n`)

log('connecting...')
const cdp = await Cdp.connect()
log('connected + ensureVisible done')

const t = (label, p) => { const t0 = Date.now(); return Promise.race([p.then((v) => { log(`✅ ${label} ok in ${Date.now() - t0}ms`); return v }, (e) => { log(`❌ ${label} fail in ${Date.now() - t0}ms: ${e.message}`); throw e }), new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} PROBE-TIMEOUT`)), 15000).unref?.())]) }

try {
  await t('evaluate 1+1', cdp.evaluate('return 1+1'))
  await t('location.hash', cdp.evaluate("location.hash='#/';return 1"))
  await sleep(1200)
  await t('innerWidth', cdp.evaluate('return innerWidth + "x" + innerHeight'))
  await t('setDeviceMetricsOverride', cdp.metrics(1460, 920))
  await t('innerWidth after metrics', cdp.evaluate('return innerWidth + "x" + innerHeight'))
  const r = await t('captureScreenshot', cdp.cmd('Page.captureScreenshot', { format: 'png' }))
  log(`screenshot bytes(b64): ${r.data.length}`)
  await t('clearMetrics', cdp.clearMetrics())
} catch (e) {
  log('ABORT: ' + e.message)
  process.exitCode = 1
}
await cdp.close()
process.exit(process.exitCode || 0)
