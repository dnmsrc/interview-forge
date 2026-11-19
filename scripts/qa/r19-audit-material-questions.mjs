#!/usr/bin/env node
/**
 * R19 只读审计：扫描全库题目，量化「资料依赖型」题目的规模与分布。
 *
 * 背景：用户反馈摸底出现「vLLM 论文口径」题——没读过特定论文/文档就只能蒙，蒙对也无成长。
 * 摸底应只测「可由原理/通用知识推理」的概念理解题；资料题应留给学过后的练习/开卷环节。
 *
 * 本脚本不改任何数据，只输出分类统计，供决定筛选策略与改造工作量。
 *
 * 判定信号（命中任一即标记，按强→弱记录原因）：
 *   S1 强信号 tags 含「论文口径」
 *   S2 强信号 题干 stem 出现「按论文/论文中/论文报告/原论文/按文档/官方文档指出/arXiv」等资料限定词
 *   S3 中信号 题干要求复述资料特定数字/结论（正则：百分比/倍数 + 论文/报告/实测/利用率/吞吐 等）
 *   S4 弱信号 source.kind=official 且 resources 非空（仅辅助，单独不判资料题——MDN 题也可推理）
 *
 * 用法：node scripts/qa/r19-audit-material-questions.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const ROOT = join(process.cwd(), 'content', 'questions')

const S1 = /论文口径/
const S2 = /(按.{0,4}论文|论文中|论文报告|原论文|论文提出|论文指出|按.{0,4}文档|官方文档指出|文档规定|arXiv|arxiv|据.{0,6}(论文|报告|研究))/
const S3 = /(\d+\s?[~-]\s?\d+\s?%|\d+\s?%|\d+\s?[~-]\s?\d+\s?[×x倍]|\d+\s?[×x倍]).{0,12}(论文|报告|实测|利用率|吞吐|提升|浪费|占比)|(?:论文|报告|实测).{0,12}(\d+\s?%|\d+\s?[×x倍])/

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...walk(p))
    else if (extname(name) === '.json') out.push(p)
  }
  return out
}

const files = walk(ROOT)
const stats = {
  total: 0,
  byDomain: {},
  material: [],          // 命中强/中信号（S1/S2/S3）
  weakOnly: [],          // 仅命中 S4 弱信号
  signalHits: { S1: 0, S2: 0, S3: 0, S4: 0 }
}

for (const file of files) {
  let arr
  try { arr = JSON.parse(readFileSync(file, 'utf8')) } catch { continue }
  if (!Array.isArray(arr)) continue
  const rel = file.replace(ROOT, '').replace(/^[\\/]/, '')
  const domain = rel.split(/[\\/]/).filter(Boolean)[0] ?? '?'
  for (const q of arr) {
    if (!q || !q.id || !q.stem) continue
    stats.total++
    stats.byDomain[domain] = stats.byDomain[domain] || { total: 0, material: 0 }
    stats.byDomain[domain].total++

    const stem = String(q.stem)
    const tags = Array.isArray(q.tags) ? q.tags.join(' ') : ''
    const reasons = []
    if (S1.test(tags)) { reasons.push('S1:论文口径tag'); stats.signalHits.S1++ }
    if (S2.test(stem)) { reasons.push('S2:题干资料限定词'); stats.signalHits.S2++ }
    if (S3.test(stem)) { reasons.push('S3:要求复述资料数字'); stats.signalHits.S3++ }
    const hasOfficial = q.source && (q.source.kind === 'official' || q.source.kind === 'paper')
    const hasResources = Array.isArray(q.resources) && q.resources.length > 0
    if (hasOfficial && hasResources) { stats.signalHits.S4++ }

    const rec = { id: q.id, domain, file: rel, difficulty: q.difficulty, type: q.type, reasons, stem: stem.slice(0, 48) }
    if (reasons.length) {
      stats.material.push(rec)
      stats.byDomain[domain].material++
    } else if (hasOfficial && hasResources) {
      stats.weakOnly.push(rec)
    }
  }
}

console.log('===== R19 资料依赖型题目审计（只读）=====')
console.log(`题库母题总数：${stats.total}`)
console.log(`命中强/中信号（建议摸底排除或改造）：${stats.material.length} 题（占 ${(100 * stats.material.length / stats.total).toFixed(1)}%）`)
console.log(`仅命中弱信号 S4（有官方出处+参考资料，但仍可能可推理，需人工复核）：${stats.weakOnly.length} 题`)
console.log('信号命中次数：', stats.signalHits)
console.log('\n--- 按 domain 分布（强/中信号）---')
for (const [d, v] of Object.entries(stats.byDomain).sort((a, b) => b[1].material - a[1].material)) {
  if (v.material) console.log(`  ${d.padEnd(8)} 资料题 ${String(v.material).padStart(3)} / 总 ${String(v.total).padStart(3)}`)
}
console.log('\n--- 强/中信号题目清单（前 40）---')
for (const m of stats.material.slice(0, 40)) {
  console.log(`  [${m.domain}] D${m.difficulty} ${m.id}  ${m.reasons.join('+')}`)
  console.log(`        ${m.stem}`)
}
if (stats.material.length > 40) console.log(`  …其余 ${stats.material.length - 40} 题略`)

console.log('\n--- 弱信号 S4 清单（有官方出处+资料，需人工确认是否可推理，共 ' + stats.weakOnly.length + '）---')
for (const m of stats.weakOnly) {
  console.log(`  [${m.domain}] D${m.difficulty} ${m.id}  (${m.file.replace(/[\\/]/g, '/')})`)
  console.log(`        ${m.stem}`)
}
