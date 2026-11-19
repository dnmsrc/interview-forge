#!/usr/bin/env node
/**
 * R19 候选「先学后测题」核验（只读）：把资料依赖候选题的 resources/source 完整打出来，
 * 供人工逐题确认是否 learnFirst=true，以及先学材料是否齐备。
 * 候选来源：① tags 含「论文口径」② 题干资料限定词 ③ 弱信号(official+resources)人工筛。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const ROOT = join(process.cwd(), 'content', 'questions')
const S2 = /(按.{0,4}论文|论文中|论文报告|原论文|论文提出|论文指出|按.{0,4}文档|官方文档指出|文档规定|官方.{0,4}口径|规范.{0,4}版本|arXiv|arxiv|据.{0,6}(论文|报告|研究)|补全.{0,12}(口径|说法|设计))/

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

const hits = []
for (const file of walk(ROOT)) {
  let arr
  try { arr = JSON.parse(readFileSync(file, 'utf8')) } catch { continue }
  if (!Array.isArray(arr)) continue
  const rel = file.replace(ROOT, '').replace(/^[\\/]/, '')
  for (const q of arr) {
    if (!q?.id || !q.stem) continue
    const tags = Array.isArray(q.tags) ? q.tags : []
    const strong = tags.includes('论文口径') || S2.test(String(q.stem))
    const weakOfficial = q.source && (q.source.kind === 'official' || q.source.kind === 'paper') && Array.isArray(q.resources) && q.resources.length
    if (!strong && !weakOfficial) continue
    hits.push({
      id: q.id, file: rel.replace(/[\\/]/g, '/'), difficulty: q.difficulty, type: q.type,
      strong, tags,
      hasResources: Array.isArray(q.resources) && q.resources.length > 0,
      resourceTitles: (q.resources ?? []).map((r) => r.title),
      hasDigest: (q.resources ?? []).some((r) => r.digest && String(r.digest).length > 30),
      sourceKind: q.source?.kind,
      stem: String(q.stem).slice(0, 60)
    })
  }
}

const strongs = hits.filter((h) => h.strong)
const weaks = hits.filter((h) => !h.strong)
console.log(`===== 强信号 ${strongs.length} 道 =====`)
for (const h of strongs) {
  console.log(`\n● ${h.id} D${h.difficulty} ${h.type} [${h.file}] tags=${JSON.stringify(h.tags)}`)
  console.log(`  题干：${h.stem}`)
  console.log(`  材料齐备：${h.hasResources && h.hasDigest ? '是' : '否(需补)'}  resources=${JSON.stringify(h.resourceTitles)}`)
}
console.log(`\n===== 弱信号(official+resources) ${weaks.length} 道，逐题判断是否事实背诵型 =====`)
for (const h of weaks) {
  console.log(`○ ${h.id} D${h.difficulty} ${h.type} [${h.file.split('/').slice(0, 2).join('/')}] 材料${h.hasDigest ? '齐' : '缺'} :: ${h.stem}`)
}
