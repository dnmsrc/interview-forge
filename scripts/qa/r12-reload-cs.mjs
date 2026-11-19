// 通过运行中的 Electron（CDP）调用 bank.reload 重新 seed，把 cs.net 内容导入真实库，并核对结果
import { Cdp, sleep } from './cdp.mjs'

const cdp = await Cdp.connect(20)
await cdp.metrics(1460, 920)
cdp.clearErrors()

console.log('调用 window.forge.bank.reload() 重新导入 content ...')
const stats = await cdp.evaluate(`return await window.forge.bank.reload()`)
console.log('seed 统计：', JSON.stringify(stats))

// 从渲染端 IPC 核对 cs 摸底能否拿到题（间接验证 placement 数据源）
const csTree = await cdp.evaluate(`return await window.forge.graph.tree('cs')`)
const csNodes = (csTree || []).length
console.log('graph.tree(cs) 顶层节点数：', csNodes)

const errs = cdp.errors().filter((e) => !/Failed to load resource|favicon|DevTools|INEFFECTIVE_DYNAMIC/.test(e.text))
console.log('控制台错误（过滤后）：', errs.length ? errs.slice(0, 5).map((e) => e.text) : '无')
await cdp.close()
process.exit(errs.length ? 1 : 0)
