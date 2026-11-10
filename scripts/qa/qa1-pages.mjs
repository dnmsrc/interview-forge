// QA 第 1 轮：全页面基础巡检 —— 截图 + 样式机检 + JS 错误采集
import { Cdp, sleep, AUDIT_JS } from './cdp.mjs'

const OUT = 'data/qa'
const PAGES = [
  { path: '/', name: 'home', wait: '.page .card' },
  { path: '/practice', name: 'practice', wait: '.n-select' },
  { path: '/exam', name: 'exam', wait: '.page' },
  { path: '/graph', name: 'graph', wait: '.vf-node', waitMs: 20000 },
  { path: '/dashboard', name: 'dashboard', wait: '.stat' },
  { path: '/bank', name: 'bank', wait: '.page .card' },
  { path: '/settings', name: 'settings', wait: '.page .card' }
]

const cdp = await Cdp.connect()
console.log('✅ CDP 已连接，视口设为 1460x920（应用默认窗口）')
await cdp.metrics(1460, 920)

let bad = 0
for (const pg of PAGES) {
  cdp.clearErrors()
  await cdp.nav(pg.path)
  let waitNote = ''
  try { await cdp.waitFor(`!!document.querySelector(${JSON.stringify(pg.wait)})`, pg.waitMs || 12000, pg.name + ' 根节点') }
  catch (e) { waitNote = ' ⚠️ ' + e.message; bad++ }
  await sleep(1500) // 异步数据/过渡动画
  const audit = await cdp.evaluate(AUDIT_JS)
  const file = `${OUT}/r1-${pg.name}.png`
  await cdp.shot(file)
  const errs = cdp.errors()
  const issues = []
  if (audit.hOverflow) issues.push('横向溢出: ' + audit.hOverflow)
  if (audit.clippedRight.length) issues.push(`右侧裁切×${audit.clippedRight.length}: ` + JSON.stringify(audit.clippedRight.slice(0, 3)))
  if (audit.textCut.length) issues.push(`文字截断×${audit.textCut.length}: ` + JSON.stringify(audit.textCut.slice(0, 3)))
  if (audit.zeroBox.length) issues.push(`零尺寸×${audit.zeroBox.length}: ` + JSON.stringify(audit.zeroBox.slice(0, 3)))
  if (audit.badContrast.length) issues.push('深色残留: ' + JSON.stringify(audit.badContrast))
  if (errs.length) issues.push(`JS×${errs.length}: ` + errs.map((e) => `[${e.kind}] ${e.text.slice(0, 120)}`).join(' | '))
  const clean = !issues.length && !waitNote
  if (!clean) bad++
  console.log(`${clean ? '✅' : '❌'} ${pg.name.padEnd(10)} -> ${file}${waitNote}`)
  for (const i of issues) console.log('   ↳ ' + i)
}

console.log(`\n== 第 1 轮结束：${bad} 个页面存在问题 ==`)
await cdp.close()
process.exit(0)
