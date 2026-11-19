// QA 第 2 轮：窗口自适应矩阵 —— 最小尺寸(1100x700)与小尺寸(980x640)下全页面巡检
import { Cdp, sleep, AUDIT_JS } from './cdp.mjs'
const OUT = 'data/qa'
const PAGES = [
  { path: '/', name: 'home', wait: '.page .card' },
  { path: '/practice', name: 'practice', wait: '.n-select' },
  { path: '/exam', name: 'exam', wait: '.tpl-grid' },
  { path: '/graph', name: 'graph', wait: '.lv-chapter', waitMs: 20000 },
  { path: '/dashboard', name: 'dashboard', wait: '.stat' },
  { path: '/bank', name: 'bank', wait: '.page .card' },
  { path: '/settings', name: 'settings', wait: '.page .card' }
]
const SIZES = [
  { w: 1100, h: 700, tag: 'min' },   // package.json minWidth/minHeight
  { w: 980, h: 640, tag: 'small' }   // 低于最小值：验证兜底不烂版
]

const cdp = await Cdp.connect()
let bad = 0
for (const s of SIZES) {
  console.log(`\n== 视口 ${s.w}x${s.h} ==`)
  await cdp.metrics(s.w, s.h)
  for (const pg of PAGES) {
    cdp.clearErrors()
    await cdp.evaluate("location.hash = '#/'; return 1")
    await sleep(600)
    await cdp.nav(pg.path)
    let waitNote = ''
    try { await cdp.waitFor(`!!document.querySelector(${JSON.stringify(pg.wait)})`, pg.waitMs || 12000, pg.name) }
    catch (e) { waitNote = ' ⚠️ ' + e.message.split(':')[0] }
    await sleep(1300)
    const audit = await cdp.evaluate(AUDIT_JS)
    const file = `${OUT}/r2-${s.tag}-${pg.name}.png`
    await cdp.shot(file)
    const issues = []
    if (audit.hOverflow) issues.push('横向溢出 ' + audit.hOverflow)
    if (audit.clippedRight.length) issues.push(`右侧裁切×${audit.clippedRight.length}: ` + JSON.stringify(audit.clippedRight.slice(0, 2)))
    if (audit.textCut.length) issues.push(`文字截断×${audit.textCut.length}: ` + JSON.stringify(audit.textCut.slice(0, 2)))
    if (audit.zeroBox.length) issues.push(`零尺寸×${audit.zeroBox.length}: ` + JSON.stringify(audit.zeroBox.slice(0, 2)))
    if (audit.badContrast.length) issues.push('深色残留: ' + JSON.stringify(audit.badContrast.slice(0, 2)))
    const errs = cdp.errors().filter((e) => !/Vue Flow|deprecated/.test(e.text))
    if (errs.length) issues.push(`JS×${errs.length}: ` + errs.map((e) => `[${e.kind}] ${e.text.slice(0, 100)}`).join(' | '))
    const clean = !issues.length && !waitNote
    if (!clean) bad++
    console.log(`${clean ? '✅' : '❌'} ${pg.name.padEnd(10)} ${file}${waitNote}`)
    for (const i of issues) console.log('   ↳ ' + i)
  }
}
await cdp.clearMetrics()
console.log(`\n== 第 2 轮自适应：${bad} 项问题 ==`)
await cdp.close()
