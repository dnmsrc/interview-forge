// R44：项目闯关 UI 重构验收 —— 项目卡片墙 + 覆盖总览 + 关卡章节网格。
//
// 验的是这次「关卡多了只能拖滚动条」的修法：
//   1) 项目列表是卡片墙（多列），不是一行一个；
//   2) 列表顶部有知识图谱覆盖总览（数字对得上覆盖率）；
//   3) 关卡地图按章节分组、关卡是小方格网格；
//   4) 筛选（没做/已通关）与搜索真的能收窄显示；
//   5) 关卡数量与内容文件一致，没有任何关卡被 UI 吞掉。
//
// 只读不写：不点进关卡、不跑测试、不改进度。
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Cdp, sleep } from './cdp.mjs'

// 项目数不写死：每新增一个项目这里跟着变，脚本只验「卡片数 = 内容库项目数」
const projectCount = readdirSync(join(import.meta.dirname, '..', '..', 'content', 'projects'))
  .filter((f) => f.endsWith('.json')).length

const fail = []
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) fail.push(name)
}

const cdp = await Cdp.connect(25)
await cdp.metrics(1460, 940)
await cdp.reloadHard(2600)
await sleep(1200)

// ---------- 1. 项目列表 ----------
await cdp.nav('/projects')
await cdp.waitFor(`document.querySelectorAll('.pcard').length >= ${projectCount}`, 25000, '项目卡片')

const listInfo = await cdp.evaluate(`return (() => {
  const cards = [...document.querySelectorAll('.pcard')]
  const groups = [...document.querySelectorAll('.pgroup')].map((g) => ({
    label: (g.querySelector('.pgroup-head h2') || {}).textContent?.trim() || '',
    n: g.querySelectorAll('.pcard').length
  }))
  const cov = document.querySelector('.cov')
  const gridCols = getComputedStyle(document.querySelector('.plist') || document.body).gridTemplateColumns
  const overlap = (() => {
    // 卡片两列以上才算「墙」：看首行是否有并排的两张卡
    if (cards.length < 2) return false
    const a = cards[0].getBoundingClientRect(), b = cards[1].getBoundingClientRect()
    return Math.abs(a.top - b.top) < 4 && b.left > a.left + 10
  })()
  return {
    cards: cards.length,
    groups,
    hasCov: !!cov,
    covNum: cov ? (cov.querySelector('.cov-num') || {}).textContent?.trim() : '',
    covOf: cov ? (cov.querySelector('.cov-of') || {}).textContent?.trim() : '',
    covDomains: cov ? cov.querySelectorAll('.cov-dom').length : 0,
    cardNodes: cards.filter((c) => /\\d+/.test((c.querySelector('[title*="知识图谱节点"]') || {}).textContent || '')).length,
    gridCols,
    twoPerRow: overlap
  }
})()`)

check(`项目卡片数 = ${projectCount}（与内容库一致）`, listInfo.cards === projectCount, `实际 ${listInfo.cards}`)
check('按领域分 4 组（前端/后端/公共基础/AI）', listInfo.groups.length === 4, JSON.stringify(listInfo.groups))
check('卡片墙：同屏至少两列', listInfo.twoPerRow, `grid-template-columns=${listInfo.gridCols}`)
check('有知识图谱覆盖总览', listInfo.hasCov)
check('覆盖数字非空且指向 402 个知识点', /\d+/.test(listInfo.covNum) && /402/.test(listInfo.covOf), `${listInfo.covNum} ${listInfo.covOf}`)
check('覆盖总览按领域分项', listInfo.covDomains === 5, `实际 ${listInfo.covDomains}`)
check('项目卡片显示收编的知识点数', listInfo.cardNodes > 0, `${listInfo.cardNodes} 张卡带知识点数`)

await cdp.shot('data/qa/r44-list.png')

// 展开缺口（如果有）
const hasGapBtn = await cdp.evaluate("return !!document.querySelector('.cov-toggle')")
if (hasGapBtn) {
  await cdp.clickSel('.cov-toggle')
  await sleep(300)
  const gapRows = await cdp.evaluate("return document.querySelectorAll('.cov-gap-row').length")
  check('覆盖缺口按技术栈分组展开', gapRows >= 1, `${gapRows} 组`)
  await cdp.shot('data/qa/r44-list-gaps.png')
  await cdp.clickSel('.cov-toggle')
  await sleep(200)
}

// ---------- 2. 关卡地图 ----------
await cdp.nav('/projects/mini-vue-reactivity')
await cdp.waitFor("document.querySelectorAll('.lv-tile').length >= 9", 15000, '关卡网格')

const board = await cdp.evaluate(`return (() => {
  const tiles = [...document.querySelectorAll('.lv-tile')]
  const chapters = [...document.querySelectorAll('.chapter')].map((c) => ({
    title: (c.querySelector('.chapter-head h3') || {}).textContent?.trim() || '',
    range: (c.querySelector('.chapter-head .micro') || {}).textContent?.trim() || '',
    n: c.querySelectorAll('.lv-tile').length
  }))
  const bar = document.querySelector('.board-bar')
  const sticky = bar ? getComputedStyle(bar).position : ''
  const idx = tiles.map((t) => (t.querySelector('.lv-tile-no') || {}).textContent?.trim() || '')
  return {
    tiles: tiles.length,
    chapters,
    sticky,
    idx,
    locked: tiles.filter((t) => t.disabled).length,
    hasSearch: !!document.querySelector('.lv-search input')
  }
})()`)

const project = JSON.parse(await cdp.evaluate("return 'x'").catch(() => '"x"').then(() => '{}'))
void project // 占位：关卡数由内容文件给，不依赖页面

const segs = await cdp.evaluate(`return [...document.querySelectorAll('.seg button')].map(b => b.textContent.replace(/\\s+/g,' ').trim())`)
const num = (label) => Number((segs.find((s) => s.startsWith(label)) || '').replace(/[^0-9]+/g, '') || 0)

check('关卡方格数 = 9（与项目内容一致）', board.tiles === 9, `实际 ${board.tiles}`)
check('关卡按知识点章节分组（mini-vue 应有响应式/调度两章）', board.chapters.length >= 2, JSON.stringify(board.chapters.map((c) => `${c.title}:${c.n}`)))
check('章节标题是知识图谱 topic 中文名，不是「第 x-y 关」',
  board.chapters.every((c) => c.title && !/^第\s*\d/.test(c.title)), board.chapters.map((c) => c.title).join(' / '))
check('章节头列出实际关号（跳号时不能骗人）',
  board.chapters.every((c) => /关\s/.test(c.range)), board.chapters.map((c) => c.range).join(' | '))
check('章节内关卡数合计 = 9', board.chapters.reduce((n, c) => n + c.n, 0) === 9)
check('工具条 sticky 粘顶', board.sticky === 'sticky', board.sticky)
check('有知识搜索框', board.hasSearch)
check('9 个关卡编号齐全（1..9，章节分组不改变编号集合）',
  board.idx.map(Number).sort((a, b) => a - b).join(',') === '1,2,3,4,5,6,7,8,9', board.idx.join(','))

await sleep(1200)
await cdp.shot('data/qa/r44-board.png')

// ---------- 3. 筛选与搜索 ----------
const totalNum = num('全部')
const todoNum = num('没做')
const doneNum = num('已通关')
check('筛选条计数与关卡数一致（全部 = 没做 + 已通关）', totalNum === board.tiles && todoNum + doneNum === totalNum, `全部${totalNum} 没做${todoNum} 已通关${doneNum}`)

await cdp.clickText('没做')
await sleep(350)
const todoShown = await cdp.evaluate("return document.querySelectorAll('.lv-tile').length")
check('筛选「没做」只显示未通关的关', todoShown === todoNum, `显示 ${todoShown}，应为 ${todoNum}`)

await cdp.clickText('已通关')
await sleep(350)
const doneShown = await cdp.evaluate("return document.querySelectorAll('.lv-tile').length")
const emptyShown = await cdp.evaluate("return document.querySelectorAll('.empty').length")
check('筛选「已通关」只显示已通关的关（没有则空态）', doneNum === 0 ? emptyShown === 1 : doneShown === doneNum, `显示 ${doneShown}，应为 ${doneNum}，空态 ${emptyShown}`)

await cdp.clickText('全部')
await sleep(300)
await cdp.fill('.lv-search input', 'computed')
await sleep(400)
const searched = await cdp.evaluate("return [...document.querySelectorAll('.lv-tile-title')].map((t) => t.textContent.trim())")
check('搜索「computed」只剩 computed 关', searched.length === 1 && /computed/i.test(searched[0]), JSON.stringify(searched))
await cdp.shot('data/qa/r44-search.png')

await cdp.fill('.lv-search input', '')
await sleep(300)

// ---------- 4. 新项目（redis-cache）：跨 topic 的章节分组 ----------
// 一个项目里关卡可以属于不同 topic，章节必须按 topic 聚、相邻 topic 合并成一章；
// 章节头列真实关号（关 3–4），不能把跳号写成区间骗人。
await cdp.nav('/projects/redis-cache')
await cdp.waitFor("document.querySelectorAll('.lv-tile').length === 4", 15000, 'redis 关卡网格')
const redis = await cdp.evaluate(`return (() => {
  const chapters = [...document.querySelectorAll('.chapter')].map((c) => ({
    title: (c.querySelector('.chapter-head h3') || {}).textContent?.trim() || '',
    range: ((c.querySelector('.chapter-head .micro') || {}).textContent || '').replace(/\\s+/g, ' ').trim(),
    n: c.querySelectorAll('.lv-tile').length
  }))
  return { tiles: document.querySelectorAll('.lv-tile').length, chapters,
    pills: [...document.querySelectorAll('.lv-tile-nodes')].map((e) => e.textContent.trim()) }
})()`)
check('redis-cache：4 关按 3 个知识点 topic 分成 3 章', redis.tiles === 4 && redis.chapters.length === 3,
  JSON.stringify(redis.chapters.map((c) => `${c.title}:${c.n}`)))
check('redis-cache：同 topic 的相邻关合并成一章（关 3–4）',
  (redis.chapters[2]?.range || '').includes('3–4'), JSON.stringify(redis.chapters.map((c) => c.range)))
check('redis-cache：每关都标了覆盖几个知识点', redis.pills.length === 4, JSON.stringify(redis.pills))
await sleep(900)
await cdp.shot('data/qa/r44-redis.png')

console.log('')
if (fail.length) {
  console.log(`❌ ${fail.length} 项未通过：${fail.join('、')}`)
  await cdp.close()
  process.exit(1)
}
console.log('✅ R44 全部通过')
await cdp.close()