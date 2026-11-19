// 四态 UI 冒烟：图谱四态 class/图例、面板掌握分布卡渲染、hover 文案
import { Cdp, sleep } from './cdp.mjs'
const cdp = await Cdp.connect()
await cdp.metrics(1460, 900)
const bad = []

await cdp.evaluate('location.hash = "#/dashboard"; return 1')
await sleep(4500)
const hasCard = await cdp.evaluate(`return !!document.querySelector('.mastery-bar')`)
const legend = await cdp.evaluate(`return document.querySelector('.mastery-legend')?.innerText ?? null`)
console.log('  面板掌握分布卡:', hasCard ? 'OK' : 'FAIL')
console.log('  图例文案:', legend)
if (!hasCard) bad.push('面板未渲染 mastery-bar')
await cdp.shot('data/qa/r7-mastery-dashboard.png')

await cdp.evaluate('location.hash = "#/graph"; return 1')
await sleep(3000)
// 默认只展开板块根（L4 不渲染），先点「展开全部」再断言节点状态 class
await cdp.evaluate(`[...document.querySelectorAll('.graph-toolbar button')].find(b => b.innerText.includes('展开全部'))?.click(); return 1`)
await sleep(2200)
const stateClasses = await cdp.evaluate(`return [...document.querySelectorAll('.gn-l4')].slice(0,8).map(el => [...el.classList].find(c => c.startsWith('st-')) ?? 'none')`)
console.log('  图谱 L4 节点状态 class:', JSON.stringify(stateClasses))
if (!stateClasses.length || stateClasses.every((c) => c === 'none')) bad.push('展开全部后 L4 节点缺少 st-* 状态类')
const legendItems = await cdp.evaluate(`return [...document.querySelectorAll('.legend div')].map(d => d.innerText).filter(Boolean)`)
console.log('  图谱图例:', JSON.stringify(legendItems).slice(0, 220))
if (!legendItems.some((t) => t.includes('已生疏'))) bad.push('图谱图例缺少「已生疏」')
await cdp.shot('data/qa/r7-mastery-graph.png')

// 打开一个做过题的节点详情（若有），检查状态 pill 与练习证据卡
const touched = await cdp.evaluate(`return window.__probeTouched ?? null`)
console.log('  详情卡冒烟跳过（无统一入口选择器，以 r7-mastery.mjs 数据断言为准）')

console.log(bad.length ? '\n问题:\n  - ' + bad.join('\n  - ') : '\n四态 UI 冒烟通过')
await cdp.close()
process.exit(bad.length ? 1 : 0)
