// R33c 关卡地图页：没通关但有草稿/尝试次数时，「从零重做」必须在首屏可见且可点
import { Cdp, sleep } from './cdp.mjs'

const bad = []
const ok = (c, m) => { if (!c) bad.push(m); console.log(`  ${c ? 'OK ' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1 }
const cdp = await Cdp.connect()
const call = (b) => cdp.evaluate(`return await (${b})()`)

console.log('\n— 0. 造「写了一半」的进度：跑一次骨架（不通过）—')
await call('async () => window.forge.progress.resetAll()')
const projects = await call('async () => window.forge.project.list()')
const pid = projects[0].id
const lv = await call(`async () => window.forge.project.detail(${JSON.stringify(pid)})`)
const lv1 = lv.levels[0]
const run = await call(`async () => window.forge.project.run(${JSON.stringify(pid)}, ${JSON.stringify(lv1.id)}, ${JSON.stringify(lv1.skeleton)})`)
ok(run.passed === false, '骨架代码跑不过（这是正常起点）')
const detail0 = await call(`async () => window.forge.project.detail(${JSON.stringify(pid)})`)
const l1 = detail0.levels[0]
console.log(`   第 1 关：done=${l1.done} attempts=${l1.attempts} doneCount=${detail0.doneCount}`)
ok(l1.done === false, '没通关（doneCount=0）')
ok(l1.attempts > 0, '但有尝试次数（草稿与阶段进度都还在）')

console.log('\n— 1. 地图页：页头按钮首屏可见且可点 —')
await cdp.nav('/')
await sleep(500)
await cdp.nav(`/projects/${pid}`)
await sleep(1500)
const ui = await cdp.evaluate(`
  const vis = (el) => { const st = getComputedStyle(el); if (st.display === 'none' || st.visibility === 'hidden') return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const btn = [...document.querySelectorAll('button')].find(b => vis(b) && /从零重做/.test(b.textContent || ''))
  if (!btn) return { found: false }
  const r = btn.getBoundingClientRect()
  return {
    found: true, text: btn.textContent.trim().replace(/\\s+/g, ' '), disabled: !!btn.disabled,
    inView: r.top >= 0 && r.bottom <= innerHeight, top: Math.round(r.top), right: Math.round(r.right),
    title: btn.getAttribute('title') || '',
    hint: [...document.querySelectorAll('.board-foot .micro')].map(e => e.textContent.trim().replace(/\\s+/g, ' ')).join(' | '),
  }
`)
console.log('   ', JSON.stringify(ui))
ok(ui.found, '页头有「从零重做」')
ok(ui.disabled === false, '没通关但有进度 → 按钮可点（之前只看 doneCount，这里会被误置灰）')
ok(ui.inView === true, `首屏可见（top=${ui.top}，不用滚到底部）`)
ok(/第 1 关/.test(ui.title || ''), '悬停说明点清的动作')
ok(/从零重做/.test(ui.hint || ''), '页脚也留一句指路，说明重做在哪')
await cdp.shot('data/qa/r33c-board-header.png')

console.log('\n— 2. 点「从零重做」：确认 → 项目进度清零 —')
await cdp.clickText('从零重做')
await sleep(600)
const dlg = await cdp.evaluate(`
  const d = [...document.querySelectorAll('.n-dialog')].find(e => e.getBoundingClientRect().width > 0)
  return d ? { title: d.querySelector('.n-dialog__title')?.textContent.trim(), body: d.querySelector('.n-dialog__content')?.textContent.trim().replace(/\\s+/g, ' ') } : null
`)
console.log('   ', JSON.stringify(dlg))
ok(!!dlg, '弹出确认框')
ok(/从零重做/.test(dlg?.title || ''), '标题说清是「从零重做这个项目」')
ok(/草稿|进度/.test(dlg?.body || ''), '正文提到草稿与进度会被清')
await cdp.shot('data/qa/r33c-board-dialog.png')
await cdp.clickText('从零重做', { nth: 1 })
await sleep(1800)
const detail1 = await call(`async () => window.forge.project.detail(${JSON.stringify(pid)})`)
const l1b = detail1.levels[0]
console.log(`   重做后第 1 关：done=${l1b.done} attempts=${l1b.attempts} doneCount=${detail1.doneCount}`)
ok(l1b.attempts === 0, '尝试次数归零')
ok(l1b.done === false && detail1.doneCount === 0, '仍在第 1 关未通关')

console.log('\n— 3. 清干净后按钮自动置灰（没有假入口）—')
await sleep(600)
const ui2 = await cdp.evaluate(`
  const vis = (el) => { const st = getComputedStyle(el); if (st.display === 'none') return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const btn = [...document.querySelectorAll('button')].find(b => vis(b) && /从零重做/.test(b.textContent || ''))
  return btn ? { disabled: !!btn.disabled, title: btn.getAttribute('title') || '' } : null
`)
console.log('   ', JSON.stringify(ui2))
ok(ui2?.disabled === true, '没有进度时置灰')
ok(/还没开始/.test(ui2?.title || ''), '置灰时说明原因')

console.log('\n— 4. 页脚「整个 App 从头开始」跳到设置并滚到危险区 —')
await cdp.clickText('整个 App 从头开始')
await sleep(1800)
const jump = await cdp.evaluate(`
  const vis = (el) => { const st = getComputedStyle(el); if (st.display === 'none') return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const row = document.querySelector('.danger-reset')
  const btn = [...document.querySelectorAll('button')].find(b => vis(b) && /从头开始/.test(b.textContent || ''))
  const r = btn?.getBoundingClientRect()
  return { hash: location.hash, rowTop: row ? Math.round(row.getBoundingClientRect().top) : null, btnInView: r ? (r.top >= 0 && r.bottom <= innerHeight) : false }
`)
console.log('   ', JSON.stringify(jump))
ok(/^#\/settings/.test(jump.hash), `跳到了设置页（${jump.hash}）`)
ok(jump.btnInView === true, `危险区的按钮进了视野（rowTop=${jump.rowTop}），不用自己找`)
await cdp.shot('data/qa/r33c-jump-settings.png')

await cdp.close()
console.log(bad.length ? `\n❌ ${bad.length} 项失败` : '\n✅ 全部通过')
process.exit(bad.length ? 1 : 0)