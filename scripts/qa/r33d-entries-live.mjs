// R33d 主实例只读复核：三个「从头开始」的入口各自在哪，用户当前进度没被测试动过
import { Cdp, sleep } from './cdp.mjs'

const bad = []
const ok = (c, m) => { if (!c) bad.push(m); console.log(`  ${c ? 'OK ' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1 }
const cdp = await Cdp.connect()
const call = (b) => cdp.evaluate(`return await (${b})()`)

const pid = 'mini-vue-reactivity'
const before = await call(`async () => window.forge.project.detail(${JSON.stringify(pid)})`)
console.log('\n— 0. 用户当前进度（只读）—')
const l1 = before.levels[0]
console.log(`   ${pid}/lv1: done=${l1.done} attempts=${l1.attempts} doneCount=${before.doneCount}/${before.levelCount}`)
ok(l1.done === false, '第 1 关还没通关（这台机器现在是从头开始的状态）')

console.log('\n— 1. 层级一：这一关（关卡页右上角）—')
await cdp.nav(`/projects/${pid}/${l1.id}`)
await sleep(1500)
const lvUI = await cdp.evaluate(`
  const vis = (el) => { const st = getComputedStyle(el); if (st.display === 'none' || st.visibility === 'hidden') return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const btn = [...document.querySelectorAll('button')].find(b => vis(b) && /^从头做这关$/.test((b.textContent || '').trim()))
  const chip = [...document.querySelectorAll('.todo-chip')].find(vis)
  const steps = [...document.querySelectorAll('.stage-item,.stage-row,[class*="stage"]')].length
  return {
    redo: btn ? { text: btn.textContent.trim(), disabled: !!btn.disabled, title: btn.getAttribute('title') || '' } : null,
    chip: chip ? chip.textContent.trim().replace(/\\s+/g, ' ') : null,
    hash: location.hash,
  }
`)
console.log('   ', JSON.stringify(lvUI))
ok(!!lvUI.redo, '关卡页有「从头做这关」按钮')
ok(/从头做这关/.test(lvUI.redo?.text || ''), '按钮文案自己说清是「从头」而不是含糊的「重置」')
ok(lvUI.redo?.disabled === false, '可点（不是置灰的假入口）')
ok(/第 1 步/.test(lvUI.redo?.title || ''), '悬停说明「清空代码和步骤进度，从第 1 步重新开始」')
// 工具条可能有两种合法说法：刚跑完一次测试时是「第 1 步过了 · 现在做第 2 步」，
// 没跑过（或离开再回来）是「第 2 / 4 步 · 已过 1 步」——都算如实显示当前步
ok(/(第 \d+\s*\/\s*4 步|第 \d+ 步过了 · 现在做第 \d+ 步)/.test(lvUI.chip || ''), `工具条如实显示当前步（${lvUI.chip}）`)
await cdp.shot('data/qa/r33d-level-redo.png')

console.log('\n— 2. 层级二：这个项目（地图页页头）—')
await cdp.nav('/')
await sleep(500)
await cdp.nav(`/projects/${pid}`)
await sleep(1400)
const boardUI = await cdp.evaluate(`
  const vis = (el) => { const st = getComputedStyle(el); if (st.display === 'none' || st.visibility === 'hidden') return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const btns = [...document.querySelectorAll('button')].filter(vis)
    .map(b => { const r = b.getBoundingClientRect(); return { t: b.textContent.trim().replace(/\\s+/g, ' '), d: !!b.disabled, top: Math.round(r.top), inView: r.top >= 0 && r.bottom <= innerHeight } })
    .filter(b => /从零重做|从头开始/.test(b.t))
  return btns
`)
console.log('   ', JSON.stringify(boardUI))
const redo = boardUI.find((b) => /从零重做/.test(b.t))
const whole = boardUI.find((b) => /整个 App 从头开始/.test(b.t))
// 有没有进度决定它该不该可点：只看通关数会把「写了一半」误判成没进度（这一轮修的就是这个）
const expectEnabled = [l1, ...before.levels].some((l) => l.done || l.attempts > 0)
ok(!!redo, '地图页页头有「从零重做」')
ok(redo?.d === !expectEnabled, `按钮可点性跟着有没有进度走（有进度=${expectEnabled}，按钮 disabled=${redo?.d}）`)
ok(redo?.inView === true, '首屏可见，不用滚到页面底部')
ok(!!whole, '页脚有「整个 App 从头开始」的指路按钮')
await cdp.shot('data/qa/r33d-board.png')

console.log('\n— 3. 层级三：整个 App（设置 · 危险区）—')
await cdp.nav('/')
await sleep(500)
await cdp.nav('/settings?focus=reset')
await sleep(1700)
const setUI = await cdp.evaluate(`
  const vis = (el) => { const st = getComputedStyle(el); if (st.display === 'none' || st.visibility === 'hidden') return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const row = document.querySelector('.danger-reset')
  const btn = [...document.querySelectorAll('button')].find(b => vis(b) && /从头开始/.test(b.textContent || ''))
  const r = btn?.getBoundingClientRect()
  return {
    row: row ? row.textContent.trim().replace(/\\s+/g, ' ') : null,
    disabled: btn ? !!btn.disabled : null,
    inView: r ? (r.top >= 0 && r.bottom <= innerHeight) : false,
  }
`)
console.log('   ', JSON.stringify(setUI))
ok(!!setUI.row, '设置页危险区有「从零开始」')
ok(setUI.disabled === false, '可点（这份库有 1500 条左右的真实进度）')
ok(setUI.inView === true, 'focus=reset 自动滚到它，不用在长页面里找')
ok(/共 \d+ 条/.test(setUI.row || ''), '说明里给出具体条数')
await cdp.shot('data/qa/r33d-settings.png')

console.log('\n— 4. 没有回归：回首页 / 错题本 / 今日都能打开，控制台干净 —')
cdp.clearErrors()
for (const h of ['/', '/practice', '/wrong', '/projects']) {
  await cdp.nav(h)
  await sleep(900)
}
const hash = await cdp.evaluate('return location.hash')
console.log('   最后停在', hash)
const errs = cdp.errors()
ok(errs.length === 0, `控制台无报错（${errs.length} 条${errs.length ? '：' + JSON.stringify(errs.slice(0, 2)) : ''}）`)

const after = await call(`async () => window.forge.project.detail(${JSON.stringify(pid)})`)
const l1b = after.levels[0]
ok(l1b.done === l1.done && l1b.attempts === l1.attempts, '全过程只读：第 1 关状态一行没变')

await cdp.close()
console.log(bad.length ? `\n❌ ${bad.length} 项失败` : '\n✅ 全部通过')
process.exit(bad.length ? 1 : 0)