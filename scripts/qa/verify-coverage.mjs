#!/usr/bin/env node
// 覆盖达标验收：检查每个 level4 节点的题量与题型多样性。
// 用法：node scripts/qa/verify-coverage.mjs [domain...] [--strict]
//   默认线：每 L4 ≥3 题、同节点不全是选择题、无空白节点
//   --strict：mustMaster 节点额外要求 ≥5 题
// 退出码 0=全部达标，1=有不达标节点
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const strict = process.argv.includes('--strict')
const domains = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const walk = (dir, out = []) => {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith('.json')) out.push(p)
  }
  return out
}
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, ''))

const nodes = []
for (const f of walk(join(ROOT, 'content', 'nodes'))) {
  if (f.endsWith('_skeleton.json')) continue
  for (const n of (Array.isArray(readJson(f)) ? readJson(f) : readJson(f).nodes) || []) nodes.push(n)
}
const l4 = nodes.filter((n) => n.level === 4 && (!domains.length || domains.includes(n.id.split('.')[0])))
const qByNode = new Map()
for (const f of walk(join(ROOT, 'content', 'questions'))) {
  for (const q of (Array.isArray(readJson(f)) ? readJson(f) : readJson(f).questions) || []) {
    if (q.status && q.status !== 'active') continue
    if (q.parentId) continue
    if (!qByNode.has(q.nodeId)) qByNode.set(q.nodeId, [])
    qByNode.get(q.nodeId).push(q.type)
  }
}

const problems = []
let totalQ = 0
for (const n of l4) {
  const types = qByNode.get(n.id) || []
  totalQ += types.length
  const target = strict && n.mustMaster ? 5 : 3
  if (types.length === 0) problems.push(`[空白] ${n.id} ${n.title}`)
  else if (types.length < target) problems.push(`[题量不足 ${types.length}<${target}] ${n.id} ${n.title}`)
  if (types.length > 0 && types.every((t) => t === 'single' || t === 'multiple')) {
    problems.push(`[题型单一(全选择)] ${n.id} ${n.title}`)
  }
}
// 悬空题目（nodeId 不存在）
const nodeIds = new Set(nodes.map((n) => n.id))
for (const f of walk(join(ROOT, 'content', 'questions'))) {
  for (const q of (Array.isArray(readJson(f)) ? readJson(f) : readJson(f).questions) || []) {
    if (q.nodeId && !nodeIds.has(q.nodeId)) problems.push(`[题目挂悬空节点] ${q.id} -> ${q.nodeId}`)
  }
}

const byDom = {}
for (const n of l4) { const d = n.id.split('.')[0]; byDom[d] = byDom[d] || { l4: 0, q: 0 }; byDom[d].l4++; byDom[d].q += (qByNode.get(n.id) || []).length }
console.log('覆盖验收（' + (strict ? '严格：mustMaster≥5，其余≥3' : '常规：每节点≥3') + '）')
for (const [d, v] of Object.entries(byDom).sort()) console.log(`  [${d}] L4=${v.l4} 题=${v.q} 户均=${(v.q / v.l4).toFixed(1)}`)
console.log(`  合计 L4=${l4.length} 活跃题=${totalQ}`)
if (problems.length) {
  console.log(`\n❌ 不达标 ${problems.length} 项：`)
  console.log(problems.slice(0, 80).map((p) => '  ' + p).join('\n'))
  if (problems.length > 80) console.log(`  …另有 ${problems.length - 80} 项`)
  process.exit(1)
}
console.log('\n✅ 全部达标')
