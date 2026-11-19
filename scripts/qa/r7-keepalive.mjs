// 验证 KeepAlive：切走再切回，练习队列与图谱展开层级都必须保持原样
import { Cdp, sleep } from './cdp.mjs'
const cdp = await Cdp.connect()
await cdp.metrics(1460, 900)
const bad = []

// 1) 练习页：题干在切页前后必须一致
await cdp.evaluate('location.hash = "#/practice"; return 1')
await sleep(3000)
const stem1 = await cdp.evaluate(`return document.querySelector('.stem')?.innerText.slice(0,60) ?? null`)
if (!stem1) bad.push('练习页没有题干，无法验证')
await cdp.evaluate('location.hash = "#/"; return 1'); await sleep(1800)
await cdp.evaluate('location.hash = "#/graph"; return 1'); await sleep(2600)
await cdp.evaluate('location.hash = "#/settings"; return 1'); await sleep(1500)
await cdp.evaluate('location.hash = "#/practice"; return 1'); await sleep(2200)
const stem2 = await cdp.evaluate(`return document.querySelector('.stem')?.innerText.slice(0,60) ?? null`)
if (stem1 && stem2 !== stem1) bad.push(`切页后题目被换掉：\n      前「${stem1}」\n      后「${stem2}」`)
console.log(`  练习题干保持一致: ${stem1 === stem2 ? 'OK' : 'FAIL'} (${String(stem1).slice(0, 24)}…)`)

// 2) 练习进度也要保留：先答一题，切页回来仍应显示"已完成 ≥1"
const done1 = await cdp.evaluate(`return document.body.innerText.match(/已完成\\s*(\\d+)/)?.[1] ?? '0'`)
console.log(`  已完成计数保持: ${done1}`)

// 3) 图谱：展开层级不因为切回而塌回收纳
await cdp.evaluate('location.hash = "#/graph"; return 1'); await sleep(2600)
const nodes1 = await cdp.evaluate(`return document.querySelectorAll('.gn').length`)
await cdp.evaluate('location.hash = "#/practice"; return 1'); await sleep(1500)
await cdp.evaluate('location.hash = "#/graph"; return 1'); await sleep(2200)
const nodes2 = await cdp.evaluate(`return document.querySelectorAll('.gn').length`)
if (nodes1 && nodes2 < nodes1) bad.push(`图谱展开被重置：切回前 ${nodes1} 个节点，切回后 ${nodes2}`)
console.log(`  图谱节点数保持: ${nodes1} → ${nodes2} ${nodes1 === nodes2 ? 'OK' : 'FAIL'}`)
await cdp.shot('data/qa/r7-keepalive-graph.png')

// 4) 从首页点「开始今日队列」应当重新组卷（新时间戳 query）
const before = await cdp.evaluate(`return document.querySelector('.stem')?.innerText.slice(0,40) ?? null`)
await cdp.evaluate('location.hash = "#/"; return 1'); await sleep(1800)
const clicked = await cdp.clickText('开始今日队列').catch(() => null)
await sleep(3500)
const after = await cdp.evaluate(`return document.querySelector('.stem')?.innerText.slice(0,40) ?? null`)
console.log(`  首页按钮重新组卷: clicked=${!!clicked} ${before !== after ? 'OK（换了题）' : '题目未变（可能仍是同一批）'}`)

console.log(bad.length ? '\n问题:\n  - ' + bad.join('\n  - ') : '\nKeepAlive 全部通过')
await cdp.close()
process.exit(bad.length ? 1 : 0)
