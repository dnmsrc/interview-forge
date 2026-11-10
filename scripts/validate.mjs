#!/usr/bin/env node
// 题库/图谱数据校验：node scripts/validate.mjs [domain...]
// 无参数则校验全部。退出码 0=通过, 1=有错误。
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const TYPES = new Set(['single', 'multiple', 'judge', 'blank', 'short', 'essay', 'code'])
const SUBJECTIVE = new Set(['short', 'essay', 'code'])
const KINDS = new Set(['web', 'official', 'community', 'playbook', 'self-authored'])
const DOMAINS = new Set(['fe', 'be', 'cs', 'ai', 'eng'])
const errors = [], warns = []
const argDomains = process.argv.slice(2).filter((a) => !a.startsWith('-'))

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith('.json')) out.push(p)
  }
  return out
}
const rel = (p) => relative(ROOT, p).replace(/\\/g, '/')
const readJson = (p) => {
  try { return JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, '')) }
  catch (e) { errors.push(`${rel(p)} :: JSON 解析失败: ${e.message}`); return null }
}

// ---------- nodes ----------
const nodeIds = new Map(), nodeLevel = new Map()
for (const f of walk(join(ROOT, 'content', 'nodes'))) {
  const data = readJson(f)
  if (!data) continue
  const list = Array.isArray(data) ? data : data.nodes
  if (!Array.isArray(list)) { errors.push(`${rel(f)} :: 应为数组或 {nodes:[...]}`); continue }
  for (const n of list) {
    if (!n?.id || !n.title || !n.level) { errors.push(`${rel(f)} :: 节点缺 id/title/level: ${JSON.stringify(n).slice(0, 80)}`); continue }
    if (nodeIds.has(n.id)) errors.push(`${rel(f)} :: 节点 id 重复 ${n.id}（已有于 ${nodeIds.get(n.id)}）`)
    nodeIds.set(n.id, rel(f)); nodeLevel.set(n.id, n.level)
    const seg = n.id.split('.').length
    if (seg !== n.level) warns.push(`${rel(f)} :: ${n.id} level=${n.level} 与 slug 段数 ${seg} 不一致`)
    if (!DOMAINS.has(n.id.split('.')[0])) errors.push(`${rel(f)} :: 未知 domain: ${n.id}`)
    for (const k of ['prerequisites', 'related']) if (n[k] && !Array.isArray(n[k])) errors.push(`${rel(f)} :: ${n.id}.${k} 必须是数组`)
  }
}
// 前置引用先收集，稍后统一报（允许跨文件前向引用）
const dangling = []
for (const f of walk(join(ROOT, 'content', 'nodes'))) {
  const data = readJson(f); if (!data) continue
  for (const n of (Array.isArray(data) ? data : data.nodes) || []) {
    for (const k of ['prerequisites', 'related']) {
      for (const ref of n[k] || []) if (!nodeIds.has(ref)) dangling.push(`${rel(f)} :: ${n.id}.${k} 指向不存在节点 ${ref}`)
    }
  }
}
// 跨板块引用很常见（前置节点由别的队友负责），降级为警告，seed 时会自动跳过缺失的边
warns.push(...dangling.map((d) => '[待补齐] ' + d))

// ---------- questions ----------
let qCount = 0, byType = {}, byDomain = {}, lit = 0
const stems = new Map()
for (const f of walk(join(ROOT, 'content', 'questions'))) {
  const data = readJson(f)
  if (!data) continue
  const list = Array.isArray(data) ? data : data.questions
  if (!Array.isArray(list)) { errors.push(`${rel(f)} :: 应为数组或 {questions:[...]}`); continue }
  for (const q of list) {
    if (!q?.id) { errors.push(`${rel(f)} :: 题目缺 id`); continue }
    if (argDomains.length && !argDomains.some((d) => q.id.includes(`-${d}-`) || q.nodeId?.startsWith(d + '.'))) continue
    qCount++; byType[q.type] = (byType[q.type] || 0) + 1
    const d = (q.nodeId || q.id)[0] + (q.nodeId || '')[1]; byDomain[d] = (byDomain[d] || 0) + 1
    if (!TYPES.has(q.type)) errors.push(`${rel(f)} :: ${q.id} type 非法: ${q.type}`)
    if (!q.nodeId) errors.push(`${rel(f)} :: ${q.id} 缺 nodeId`)
    else if (!nodeIds.has(q.nodeId)) errors.push(`${rel(f)} :: ${q.id} nodeId 不存在: ${q.nodeId}`)
    else if (nodeLevel.get(q.nodeId) !== 4) errors.push(`${rel(f)} :: ${q.id} 必须挂 level=4 节点（当前 ${nodeLevel.get(q.nodeId)}）`)
    if (!q.stem || q.stem.trim().length < 6) errors.push(`${rel(f)} :: ${q.id} 题干过短`)
    if (!Number.isInteger(q.difficulty) || q.difficulty < 1 || q.difficulty > 5) errors.push(`${rel(f)} :: ${q.id} difficulty 需 1-5`)
    for (const need of ['analysis', 'gapCheck', 'knowledgeLinks']) {
      const v = q[need]
      const empty = !v || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)
      if (empty) errors.push(`${rel(f)} :: ${q.id} 缺 ${need}（硬性字段）`)
    }
    if (['single', 'multiple'].includes(q.type)) {
      if (!Array.isArray(q.options) || q.options.length < 2) errors.push(`${rel(f)} :: ${q.id} 选项不足`)
      else {
        const keys = new Set(q.options.map((o) => o.key))
        const ans = q.answer?.keys || []
        if (!ans.length) errors.push(`${rel(f)} :: ${q.id} answer.keys 为空`)
        for (const k of ans) if (!keys.has(k)) errors.push(`${rel(f)} :: ${q.id} 答案 ${k} 不在选项内`)
        if (q.type === 'single' && ans.length !== 1) errors.push(`${rel(f)} :: ${q.id} 单选题答案应唯一`)
        if (q.type === 'multiple' && ans.length < 2) warns.push(`${rel(f)} :: ${q.id} 多选题答案少于 2 个`)
      }
    }
    if (q.type === 'judge' && typeof q.answer?.judge !== 'boolean') errors.push(`${rel(f)} :: ${q.id} judge 答案需 boolean`)
    if (q.type === 'blank' && !Array.isArray(q.answer?.blanks)) errors.push(`${rel(f)} :: ${q.id} blank 需 answer.blanks 数组`)
    if (SUBJECTIVE.has(q.type)) {
      if (!Array.isArray(q.scoringPoints) || !q.scoringPoints.length) errors.push(`${rel(f)} :: ${q.id} 主观题缺 scoringPoints`)
      if (!q.answer?.ref && !q.answer?.code) errors.push(`${rel(f)} :: ${q.id} 主观题缺参考答案 answer.ref`)
    }
    if (!q.source?.kind || !KINDS.has(q.source.kind)) errors.push(`${rel(f)} :: ${q.id} source.kind 缺失或非法`)
    else if (q.source.kind !== 'self-authored' && !q.source.url) warns.push(`${rel(f)} :: ${q.id} ${q.source.kind} 来源建议填 url`)
    if (['web', 'official', 'community'].includes(q.source?.kind) && !q.source.retrievedAt) warns.push(`${rel(f)} :: ${q.id} 缺 source.retrievedAt`)
    if (!q.open_book_allowed && q.openBookAllowed !== false && q.openBookAllowed !== true) warns.push(`${rel(f)} :: ${q.id} 建议显式写 openBookAllowed`)
    // 题干查重（含变体）
    const norm = (s) => String(s || '').replace(/\s+/g, '').replace(/[，。？！：；、,.?!:;()（）]/g, '')
    const key = norm(q.stem)
    if (key) { if (stems.has(key)) errors.push(`${rel(f)} :: 题干与 ${stems.get(key)} 完全重复`); else stems.set(key, rel(f)) }
    for (const v of q.variants || []) {
      if (!v.stem) { errors.push(`${rel(f)} :: ${q.id} 变体缺 stem`); continue }
      if (norm(v.stem) === key) errors.push(`${rel(f)} :: ${q.id} 变体题干与父题相同（angle=${v.angle}）`)
      if (!v.analysis) warns.push(`${rel(f)} :: ${q.id} 变体缺 analysis`)
    }
    lit++
  }
}

// ---------- variants pool ----------
for (const f of walk(join(ROOT, 'content', 'variants'))) {
  const data = readJson(f); if (!data) continue
  for (const v of (Array.isArray(data) ? data : data.variants) || []) {
    if (!v?.id || !v.parentId || !v.stem) { errors.push(`${rel(f)} :: 变体缺 id/parentId/stem`); continue }
    if (!nodeIds.has(v.nodeId)) errors.push(`${rel(f)} :: 变体 ${v.id} nodeId 不存在: ${v.nodeId}`)
    if (!v.angle) warns.push(`${rel(f)} :: 变体 ${v.id} 缺 angle`)
  }
}

console.log(`节点 ${nodeIds.size} 个 · 题目 ${qCount} 道 · 带变体统计 ${lit}`)
console.log('题型分布:', JSON.stringify(byType))
console.log('板块分布:', JSON.stringify(byDomain))
if (warns.length) console.log(`\n⚠️ 警告 ${warns.length} 条:\n` + warns.slice(0, 60).map((w) => '  ' + w).join('\n'))
if (errors.length) { console.log(`\n❌ 错误 ${errors.length} 条:\n` + errors.slice(0, 120).map((e) => '  ' + e).join('\n')); process.exit(1) }
console.log('\n✅ 校验通过')
