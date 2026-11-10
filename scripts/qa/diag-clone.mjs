// 诊断 practice.queue 的 DataCloneError：抓完整堆栈 + 手工走 contextBridge 对照
import { Cdp, sleep } from './cdp.mjs'
const log = (m) => process.stderr.write(`[diag] ${m}\n`)
const cdp = await Cdp.connect()

// 1. 清掉旧错误，导航到练习页重新触发 onMounted → start()
cdp.clearErrors()
await cdp.evaluate("location.hash = '#/'; return 1")
await sleep(800)
await cdp.evaluate("location.reload(); return 1").catch(() => {})
await sleep(2500)
await cdp.evaluate("location.hash = '#/practice'; return 1")
await sleep(3500)
log('页面 JS 错误（含堆栈）:')
for (const e of cdp.errors()) log(JSON.stringify(e))

// 2. 手工对照实验：区分「入参 Proxy」与「返回值不可克隆」两种病因
const probe = await cdp.evaluate(`
  const out = {};
  // a) 纯字面量参数 —— 若仍失败则是返回值问题
  try { const r = await window.forge.practice.queue({ domains: ['fe'], count: 5, includeDue: false, mixReviewRatio: 0, types: [], difficulties: [], nodeIds: [], stacks: [], allowLocked: false }); out.pureArg = 'ok rows=' + r.length }
  catch (e) { out.pureArg = (e.name || '') + ': ' + e.message + '\\n' + String(e.stack).split('\\n').slice(0, 6).join('\\n') }
  // b) settings.all —— 检查 boot 链上其他通道
  try { await window.forge.settings.all(); out.settingsAll = 'ok' } catch (e) { out.settingsAll = e.message }
  try { await window.forge.daily.plan(); out.dailyPlan = 'ok' } catch (e) { out.dailyPlan = e.message }
  try { await window.forge.bank.stats(); out.bankStats = 'ok' } catch (e) { out.bankStats = e.message }
  try { await window.forge.app.paths(); out.appPaths = 'ok' } catch (e) { out.appPaths = e.message }
  return out;
`)
log('对照实验结果:')
log(JSON.stringify(probe, null, 2))

// 3. 渲染端环境里有没有 Vue 可用于 toRaw 验证
const vueCheck = await cdp.evaluate(`return typeof window.Vue`)
log('window.Vue: ' + vueCheck)

await cdp.close()
