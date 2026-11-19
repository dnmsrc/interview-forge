// R8：知识抽屉端到端实测（契约 §5 入口一 + §6 AI 重讲）
// 路径：练习页定向到有正文的考点 → 点「先读讲义」→ 校验正文/来源/双链/返回栈 → 点 chip 触发 AI 重讲 → 截图。
// 注意：Cdp.evaluate 会把代码包进 async 函数，凡是要取返回值的表达式必须显式 return。
// 用法：node scripts/qa/r8-kb-drawer.mjs [--no-ai]
import { Cdp, sleep } from './cdp.mjs'

const OUT = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'data/qa/r8-kb-drawer.png'
const NO_AI = process.argv.includes('--no-ai')
// 只有这三篇已收录正文，逐个试直到抽到题为止
const CANDIDATES = ['fe.vue.reactivity.proxify', 'fe.vue.compiler.ast-pipeline', 'fe.vue.scheduler.nexttick']

const results = []
const ok = (label, cond, extra = '') => { results.push([cond, label, extra]); console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? '：' + extra : ''}`) }

const cdp = await Cdp.connect()
await cdp.init()
await cdp.ensureVisible()
await cdp.clearErrors()

// ---- 1. 定向到有正文考点，直到出现「先读讲义」按钮（hash 路由，Page.navigate 同 origin 只触发 hashchange） ----
let entryNode = ''
for (const node of CANDIDATES) {
  await cdp.cmd('Page.navigate', { url: `http://localhost:5173/#/practice?node=${node}` })
  const ready = await cdp.waitFor(`!!document.querySelector('[data-testid="practice-read-kb"]')`, 9000, '讲义入口').catch(() => false)
  if (ready) { entryNode = node; break }
}
ok('练习页出现「先读这个考点的讲义」入口', !!entryNode, entryNode)
if (!entryNode) {
  console.log('\n✗ 三个已收录考点都没抽到题，无法继续')
  await cdp.close(); process.exit(1)
}

// ---- 2. 打开抽屉，校验正文与来源 ----
// 用程序化点击：n-button 经 scrollIntoView 重排后，CDP 坐标点击有概率落空（组件 click 已单独验证过）
await cdp.evaluate(`document.querySelector('[data-testid="practice-read-kb"]')?.click(); return 1`)
await cdp.waitFor(`!!document.querySelector('[data-testid="knowledge-drawer"]')`, 8000, '抽屉挂载').catch(() => {})
const opened = await cdp.waitFor(
  `(()=>{const d=document.querySelector('[data-testid="knowledge-drawer"]');return !!(d && d.querySelector('.kb-body')?.innerText.length > 300)})()`,
  10000, '正文渲染').catch(() => false)
ok('抽屉打开且正文渲染出来（>300 字）', !!opened)

const info = await cdp.evaluate(`return (()=>{
  const d = document.querySelector('[data-testid="knowledge-drawer"]')
  if (!d) return null
  const t = (s) => d.querySelector(s)?.innerText?.trim() ?? ''
  const links = [...d.querySelectorAll('a.wikilink')].map(a => a.dataset.wiki)
  return {
    title: t('h3'),
    meta: t('.kb-meta'),
    words: d.querySelector('.kb-body')?.innerText?.length ?? 0,
    wikis: links,
    srcCount: d.querySelectorAll('.kb-src').length,
    official: [...d.querySelectorAll('.kb-src-kind')].filter(e => e.innerText === '官方').length,
    chips: [...d.querySelectorAll('[data-testid="kb-chip"]')].map(b => b.innerText.trim()),
    askBtn: !!d.querySelector('[data-testid="kb-ask"]')
  }
})()`)
console.log('  抽屉快照:', JSON.stringify(info))
ok('标题取到知识标题（非兜底文案）', !!info && info.title.length > 2 && !/^知识点$/.test(info.title), info?.title?.slice(0, 40))
ok('置信度/已复核徽标存在', !!info && /置信度/.test(info.meta), info?.meta?.slice(0, 60))
ok('[[双链]] 渲染成可点锚点', !!info && info.wikis.length >= 3, `${info?.wikis?.length} 个`)
ok('来源列表非空且含官方', !!info && info.srcCount >= 2 && info.official >= 1, `共 ${info?.srcCount} 条 / 官方 ${info?.official}`)
ok('AI 重讲 chips 由服务端下发（4 个）+ 主按钮在', !!info && info.chips.length === 4 && info.askBtn, info?.chips?.join('/'))

// ---- 3. 双链跳转 + 返回栈 ----
const before = info?.title ?? ''
// 优先点有正文的双链（三篇已收录之一），没有再退而求其次点任意双链
const wikiTarget = await cdp.evaluate(`return (()=>{
  const known = new Set(['fe.vue.reactivity.proxify','fe.vue.compiler.ast-pipeline','fe.vue.scheduler.nexttick'])
  const links = [...document.querySelectorAll('[data-testid="knowledge-drawer"] a.wikilink')]
  const hit = links.find(a => known.has(a.dataset.wiki)) ?? links[0]
  return { id: hit?.dataset.wiki ?? '', hasBody: hit ? known.has(hit.dataset.wiki) : false }
})()`)
await cdp.evaluate(`document.querySelector('[data-testid="knowledge-drawer"] a.wikilink')?.click()`)
await sleep(2500)
const jumped = await cdp.evaluate(`return (()=>{
  const d = document.querySelector('[data-testid="knowledge-drawer"]')
  return { title: d?.querySelector('h3')?.innerText?.trim() ?? '', back: !!d?.querySelector('button[title="返回上一个知识点"]'), words: d?.querySelector('.kb-body')?.innerText?.length ?? 0, missing: !!d?.querySelector('.fb.warn') }
})()`)
// 跳转成功 = 标题确实变了；目标有正文时要求正文渲染，无正文时要求出现 missing 引导（都是合法终态）
const jumpedOk = !!jumped && jumped.title !== before && (jumped.words > 0 || jumped.missing)
ok('点双链跳到相邻考点', jumpedOk, `${before.slice(0, 14)} → ${(jumped?.title ?? '').slice(0, 14)}（正文 ${jumped?.words ?? 0} 字 / missing ${jumped?.missing ? '是' : '否'}）`)
ok('返回按钮出现（返回栈生效）', !!jumped?.back)

if (jumped?.back) {
  await cdp.evaluate(`document.querySelector('[data-testid="knowledge-drawer"] button[title="返回上一个知识点"]')?.click()`)
  await sleep(2500)
  const backTitle = await cdp.evaluate(`return document.querySelector('[data-testid="knowledge-drawer"] h3')?.innerText?.trim() ?? ''`)
  ok('点返回回到原考点', backTitle === before, backTitle.slice(0, 24))
}

// ---- 4. 未收录考点应给 missing 状态而不是报错 ----
const missingProbe = await cdp.evaluate(`return window.forge.knowledge.get('fe.vue.runtime.update-flow').then(r => ({ missing: r.missing, title: r.title, body: (r.bodyMd ?? '').length }))`)
  .catch((e) => ({ err: String(e).slice(0, 80) }))
ok('未收录节点返回 missing:true（不是报错）', !!missingProbe && missingProbe.missing === true, JSON.stringify(missingProbe).slice(0, 110))

// ---- 5. AI 重讲（可 --no-ai 跳过） ----
if (!NO_AI) {
  await cdp.evaluate(`document.querySelectorAll('[data-testid="knowledge-drawer"] [data-testid="kb-chip"]')[1]?.click()`)
  const got = await cdp.waitFor(
    `(()=>{const a=document.querySelector('[data-testid="knowledge-drawer"] .kb-answer');return !!(a && a.innerText.trim().length > 120)})()`,
    130000, 'AI 讲解').catch(() => false)
  const ansMeta = await cdp.evaluate(`return (()=>{const d=document.querySelector('[data-testid="knowledge-drawer"]');return {head:d?.querySelector('.kb-answer')?.innerText?.slice(0,90)??'', len:d?.querySelector('.kb-answer .md')?.innerText?.length??0}})()`)
  ok('chip 一键追问产出讲解（>120 字）', !!got, `长度 ${ansMeta?.len}`)
  ok('标注了模型与耗时/token', !!got && /tokens/.test(ansMeta?.head ?? ''), (ansMeta?.head ?? '').slice(0, 60))
  // 再点同一 chip 应命中缓存
  await cdp.evaluate(`document.querySelectorAll('[data-testid="knowledge-drawer"] [data-testid="kb-chip"]')[1]?.click()`)
  const cached = await cdp.waitFor(
    `!!document.querySelector('[data-testid="knowledge-drawer"] .kb-answer')?.innerText.includes('缓存')`,
    15000, '缓存命中').catch(() => false)
  ok('同问法二次点击命中缓存', !!cached)
}

// ---- 6. 截图 + 控制台错误 ----
await cdp.shot(OUT)
const errs = cdp.errors().filter((e) => !/favicon|DevTools|Download the Vue/i.test(e))
ok('无控制台报错', errs.length === 0, errs.slice(0, 2).join(' | ').slice(0, 160))
console.log(`\n截图：${OUT}`)

const bad = results.filter((r) => !r[0]).length
console.log(bad ? `\n✗ ${bad}/${results.length} 项未通过` : `\n✓ ${results.length} 项全部通过`)
await cdp.close()
process.exit(bad ? 1 : 0)
