// 区分病因：页面自动调用必炸、手工纯字面量正常。用纯字面量复刻 onMounted 全流程逐步二分。
import { Cdp, sleep } from './cdp.mjs'
const log = (m) => process.stderr.write(`[bisect] ${m}\n`)
const cdp = await Cdp.connect()

await cdp.evaluate("location.hash = '#/'; return 1")
await sleep(1200)
await cdp.evaluate("location.reload(); return 1").catch(() => {})
await sleep(3000)
await cdp.evaluate("location.hash = '#/'; return 1")
await sleep(1500)
cdp.clearErrors()

const r = await cdp.evaluate(`
  const out = {};
  const base = { domains: ['fe'], stacks: [], nodeIds: [], types: [], difficulties: [], count: 10, includeDue: true, mixReviewRatio: 0.35, allowLocked: false };
  // ① settings.set（onMounted 里 watch 会触发）
  try { await window.forge.settings.set('globalMixRatio', 0.35); out.step1_settingsSet = 'ok' } catch (e) { out.step1_settingsSet = e.name + ': ' + e.message }
  // ② boot 全链（复刻 store.boot）
  try { await window.forge.app.paths(); out.step2_paths = 'ok' } catch (e) { out.step2_paths = e.name + ': ' + e.message }
  try { await window.forge.settings.all(); out.step2_all = 'ok' } catch (e) { out.step2_all = e.name + ': ' + e.message }
  try { await window.forge.bank.stats(); out.step2_stats = 'ok' } catch (e) { out.step2_stats = e.name + ': ' + e.message }
  try { await window.forge.daily.plan(); out.step2_plan = 'ok' } catch (e) { out.step2_plan = e.name + ': ' + e.message }
  // ③ 纯字面量 queue（与 spec 完全一致的值）
  try { const rows = await window.forge.practice.queue(JSON.parse(JSON.stringify(base))); out.step3_queuePure = 'ok rows=' + rows.length } catch (e) { out.step3_queuePure = e.name + ': ' + e.message }
  // ④ 带 spread 的浅拷贝字面量（模拟 {...spec}）
  try { const spec = Object.assign({}, base); const rows = await window.forge.practice.queue({ ...spec }); out.step4_queueSpread = 'ok rows=' + rows.length } catch (e) { out.step4_queueSpread = e.name + ': ' + e.message }
  // ⑤ 数组引用共享（模拟 reactive 数组字段）
  try { const spec = { domains: base.domains, stacks: base.stacks, nodeIds: [], types: base.types, difficulties: base.difficulties, count: 10, includeDue: true, mixReviewRatio: 0.35, allowLocked: false }; const rows = await window.forge.practice.queue(spec); out.step5_queueSharedArr = 'ok rows=' + rows.length } catch (e) { out.step5_queueSharedArr = e.name + ': ' + e.message }
  return out;
`)
log(JSON.stringify(r, null, 2))
const errs = cdp.errors()
log('console 错误:')
for (const e of errs) log('  ' + JSON.stringify(e).slice(0, 300))

// 现在导航到 practice 看自动调用是否仍炸（同页面状态对比）
await cdp.evaluate("location.hash = '#/practice'; return 1")
await sleep(3500)
const st = await cdp.evaluate(`return document.querySelectorAll('.opt,.stem').length + '|' + ([...document.querySelectorAll('.n-message__content')].map(e=>e.textContent.trim()).join('||')||'(无)')`)
log('切到 practice 后: 题目元素=' + st)
await cdp.close()
