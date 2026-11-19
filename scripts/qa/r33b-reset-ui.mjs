// R33b 从零开始的界面链路（隔离实例）：入口可见 → 确认框说清 → 点下去真的清空
import { Cdp, sleep } from './cdp.mjs'

const bad = []
const ok = (c, m) => { if (!c) bad.push(m); console.log(`  ${c ? 'OK ' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1 }
const cdp = await Cdp.connect()
const call = (b) => cdp.evaluate(`return await (${b})()`)

console.log('\n— 0. 先造一点进度（打卡 + 一条摸底会话）—')
await call('async () => window.forge.daily.checkin(true)')
const s0 = await call('async () => window.forge.progress.summary()')
ok(s0.dirty, `有进度 dirty=true（共 ${s0.total} 条）`)
await cdp.shot('data/qa/r33b-0-progress.png')

console.log('\n— 1. 从别的页面跳进设置，危险区要自动滚进视野 —')
// 先回首页再进设置：同 hash 再导航是 no-op，KeepAlive 不会重新激活，测出来的就是上一轮残留的 DOM
await cdp.nav('/')
await sleep(600)
await cdp.nav('/settings?focus=reset')
await sleep(1600)
const ui = await cdp.evaluate(`
  const vis = (el) => {
    const st = getComputedStyle(el); if (st.display === 'none' || st.visibility === 'hidden') return false
    const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0
  }
  const row = document.querySelector('.danger-reset')
  const btn = [...document.querySelectorAll('button')].find(b => vis(b) && /从头开始/.test(b.textContent || ''))
  const r = btn?.getBoundingClientRect()
  return {
    rowText: row ? row.textContent.trim().replace(/\\s+/g, ' ') : null,
    btnText: btn ? btn.textContent.trim().replace(/\\s+/g, ' ') : null,
    disabled: btn ? !!btn.disabled : null,
    inView: r ? (r.top >= 0 && r.bottom <= innerHeight) : false,
    top: r ? Math.round(r.top) : null,
  }
`)
console.log('   ', JSON.stringify(ui))
ok(!!ui.btnText, '设置页有「从头开始」按钮')
ok(ui.disabled === false, '有进度时按钮可用（不是置灰的假入口）')
ok(ui.inView === true, `带 focus=reset 进来会自动滚到危险区（按钮 top=${ui.top}）`)
ok(/\d+ 条/.test(ui.rowText || ''), '说明文字给出「共 N 条」的具体数字')
await cdp.shot('data/qa/r33b-1-settings.png')

console.log('\n— 2. 点按钮：确认框要逐项说清 —')
await cdp.clickText('从头开始')
await sleep(700)
const dlg = await cdp.evaluate(`
  const d = [...document.querySelectorAll('.n-dialog')].find(e => e.getBoundingClientRect().width > 0)
  if (!d) return null
  return {
    title: (d.querySelector('.n-dialog__title') || {}).textContent?.trim() ?? '',
    body: (d.querySelector('.n-dialog__content') || {}).textContent?.trim().replace(/\\s+/g, ' ') ?? '',
    btns: [...d.querySelectorAll('button')].map(b => b.textContent.trim()),
  }
`)
console.log('   ', JSON.stringify(dlg, null, 1))
ok(!!dlg, '弹出确认框')
ok(/从零开始/.test(dlg?.title || ''), '标题是「从零开始？」')
ok(/打卡|练习|项目关卡/.test(dlg?.body || ''), '正文逐项列出要清什么（不是干巴巴一句「确定吗」）')
ok(/保留/.test(dlg?.body || ''), '正文说明保留了什么（AI 端点/题库）')
ok(/不能撤销|没有撤销/.test(dlg?.body || ''), '正文明确「不可撤销」')
ok((dlg?.btns || []).some((t) => /清空，从头开始/.test(t)), '确认按钮文案说清动作')
await cdp.shot('data/qa/r33b-2-dialog.png')

console.log('\n— 3. 取消不生效 —')
await cdp.clickText('算了')
await sleep(800)
const s1 = await call('async () => window.forge.progress.summary()')
ok(s1.dirty === s0.dirty, '点「算了」后进度原样（没被清）')

console.log('\n— 4. 确认后真的清空并回到首页 —')
await cdp.evaluate(`window.__r33Nav = location.hash; return 1`)
cdp.clearErrors()
await cdp.clickText('从头开始')
await sleep(600)
await cdp.clickText('清空，从头开始')
await sleep(560) // 页面 1.2s 后重载，必须在这之前抓 toast
const toastSeen = await cdp.evaluate(`
  return [...document.querySelectorAll('[class*="message"]')]
    .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 })
    .map(e => e.textContent.trim()).filter(Boolean).slice(0, 4)
`)
console.log('    reload 前看到的提示 =', JSON.stringify(toastSeen))
ok(toastSeen.some((t) => /已清空/.test(t)), 'reload 之前能看到「已清空 N 条」的提示（不被打断）')
await sleep(2400)
const after = await cdp.evaluate(`
  const s = await window.forge.progress.summary()
  return { hash: location.hash, dirty: s.dirty, total: s.total, xp: s.xp, level: s.level, toast: [...document.querySelectorAll('.n-message')].map(e => e.textContent.trim()) }
`)
console.log('   ', JSON.stringify(after))
ok(after.dirty === false && after.total === 0, `清空后 summary 归零（${after.total}）`)
ok(after.xp === 0 && after.level === 1, '等级回到 Lv.1')
ok(after.hash === '#/', `清空后回到首页（${after.hash}）`)
const errs = cdp.errors()
ok(errs.length === 0, `控制台无报错（${errs.length} 条）；清完提示「已清空」由 reload 前的 toast 给出`)
await cdp.shot('data/qa/r33b-3-after.png')

console.log('\n— 5. 清空后按钮置灰（不再假装能点）—')
await cdp.nav('/')
await sleep(600)
await cdp.nav('/settings?focus=reset')
await sleep(1400)
const ui2 = await cdp.evaluate(`
  const vis = (el) => { const st = getComputedStyle(el); if (st.display === 'none') return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const row = document.querySelector('.danger-reset')
  const btn = [...document.querySelectorAll('button')].find(b => vis(b) && /从头开始/.test(b.textContent || ''))
  return { rowText: row ? row.textContent.trim().replace(/\\s+/g, ' ') : null, disabled: btn ? !!btn.disabled : null }
`)
console.log('   ', JSON.stringify(ui2))
ok(ui2.disabled === true, '已空时按钮置灰')
ok(/已经是初始状态/.test(ui2.rowText || ''), '说明文字改成「当前已经是初始状态」')
await cdp.shot('data/qa/r33b-4-empty.png')

await cdp.close()
console.log(bad.length ? `\n❌ ${bad.length} 项失败` : '\n✅ 全部通过')
process.exit(bad.length ? 1 : 0)