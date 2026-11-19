// R8 补充：知识抽屉的图谱入口（契约 §5 入口三）。
// 路径：图谱页带 ?node= 已收录考点 → 节点抽屉出现「查看知识全文」→ 点开 KnowledgeDrawer
//      → 校验正文/徽标/双链 → 与节点抽屉并存且浮在上层 → 截图。
// 用法：node scripts/qa/r8-kb-graph-entry.mjs
import { Cdp, sleep } from './cdp.mjs'

const OUT = 'data/qa/r8-kb-graph-entry.png'
// 只有这三篇已收录正文，逐个试直到节点抽屉出来
const CANDIDATES = ['fe.vue.reactivity.proxify', 'fe.vue.compiler.ast-pipeline', 'fe.vue.scheduler.nexttick']

const results = []
const ok = (label, cond, extra = '') => { results.push([cond, label, extra]); console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? '：' + extra : ''}`) }

const cdp = await Cdp.connect()
await cdp.init()
await cdp.ensureVisible()
await cdp.clearErrors()

// ---- 1. 带 node 进图谱页，load() 会自动 expandChain + openDetail ----
let entryNode = ''
for (const node of CANDIDATES) {
  await cdp.cmd('Page.navigate', { url: `http://localhost:5173/#/graph?node=${node}` })
  const ready = await cdp.waitFor(`!!document.querySelector('[data-testid="graph-drawer"] [data-testid="graph-read-kb"]')`, 9000, '节点抽屉').catch(() => false)
  if (ready) { entryNode = node; break }
}
ok('图谱节点抽屉打开且出现「查看知识全文」按钮', !!entryNode, entryNode)
if (!entryNode) {
  console.log('\n✗ 三个已收录考点都没打开节点抽屉，无法继续')
  await cdp.close(); process.exit(1)
}

// ---- 2. 点开知识阅读抽屉（程序化点击，规避 VueFlow 重排导致的坐标落空） ----
await cdp.evaluate(`document.querySelector('[data-testid="graph-read-kb"]')?.click(); return 1`)
const opened = await cdp.waitFor(
  `(()=>{const d=document.querySelector('[data-testid="knowledge-drawer"]');return !!(d && d.querySelector('.kb-body')?.innerText.length > 300)})()`,
  10000, '知识正文').catch(() => false)
ok('KnowledgeDrawer 打开且正文渲染（>300 字）', !!opened)

const info = await cdp.evaluate(`return (()=>{
  const d = document.querySelector('[data-testid="knowledge-drawer"]')
  if (!d) return null
  const graph = document.querySelector('[data-testid="graph-drawer"]')
  const dz = d ? getComputedStyle(d).zIndex : ''
  const gz = graph ? getComputedStyle(graph).zIndex : ''
  return {
    title: d.querySelector('h3')?.innerText?.trim() ?? '',
    meta: d.querySelector('.kb-meta')?.innerText?.trim() ?? '',
    words: d.querySelector('.kb-body')?.innerText?.length ?? 0,
    wikis: [...d.querySelectorAll('a.wikilink')].length,
    askBtn: !!d.querySelector('[data-testid="kb-ask"]'),
    graphStillThere: !!graph,
    z: { kb: dz, graph: gz }
  }
})()`)
console.log('  抽屉快照:', JSON.stringify(info))
ok('标题取到知识标题（非兜底）', !!info && info.title.length > 2 && !/^知识点$/.test(info.title), info?.title?.slice(0, 40))
ok('置信度徽标存在', !!info && /置信度/.test(info.meta), info?.meta?.slice(0, 50))
ok('双链锚点已渲染', !!info && info.wikis >= 3, `${info?.wikis} 个`)
ok('AI 重讲主按钮在', !!info?.askBtn)
ok('节点抽屉仍然存在（两抽屉并存，未互相顶替）', !!info?.graphStillThere)
// kb-drawer z-index 60，graph drawer 未设 z-index（auto）；只要 kb 在其上即可
ok('知识抽屉浮在节点抽屉之上', !!info && Number(info.z.kb || 0) >= Number(info.z.graph || 0), `kb=${info?.z.kb} graph=${info?.z.graph}`)

// ---- 3. 关闭知识抽屉后节点抽屉仍在，可继续操作图谱 ----
await cdp.evaluate(`document.querySelector('[data-testid="knowledge-drawer-close"]')?.click(); return 1`)
await sleep(800)
const afterClose = await cdp.evaluate(`return {
  kbGone: !document.querySelector('[data-testid="knowledge-drawer"]'),
  graphThere: !!document.querySelector('[data-testid="graph-drawer"] [data-testid="graph-read-kb"]')
}`)
ok('关知识抽屉后它消失、节点抽屉保留', !!afterClose?.kbGone && !!afterClose?.graphThere, JSON.stringify(afterClose))

// ---- 4. 截图 + 控制台错误 ----
// 重新打开一次，让截图呈现「双抽屉并存」终态
await cdp.evaluate(`document.querySelector('[data-testid="graph-read-kb"]')?.click(); return 1`)
await cdp.waitFor(`!!document.querySelector('[data-testid="knowledge-drawer"] .kb-body')`, 8000, '重开').catch(() => {})
await sleep(600)
await cdp.shot(OUT)
const errs = cdp.errors().filter((e) => !/favicon|DevTools|Download the Vue/i.test(e.text || ''))
ok('无控制台报错', errs.length === 0, errs.slice(0, 2).map((e) => e.text).join(' | ').slice(0, 160))
console.log(`\n截图：${OUT}`)

const bad = results.filter((r) => !r[0]).length
console.log(bad ? `\n✗ ${bad}/${results.length} 项未通过` : `\n✓ ${results.length} 项全部通过`)
await cdp.close()
process.exit(bad ? 1 : 0)
