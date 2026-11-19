#!/usr/bin/env node
// 生成现有 level4 考点的「补厚工作清单」：每个节点当前题量/题型/目标缺口，按 domain/stack 分组输出到 docs/thin-nodes-audit.md
import { readdirSync, readFileSync, existsSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
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
const l4 = nodes.filter((n) => n.level === 4)
const qByNode = new Map()
for (const f of walk(join(ROOT, 'content', 'questions'))) {
  for (const q of (Array.isArray(readJson(f)) ? readJson(f) : readJson(f).questions) || []) {
    if (q.status && q.status !== 'active') continue
    if (q.parentId) continue
    if (!qByNode.has(q.nodeId)) qByNode.set(q.nodeId, [])
    qByNode.get(q.nodeId).push(q.type)
  }
}

const domains = ['fe', 'be', 'cs', 'ai', 'eng']
let totalGap3 = 0, totalGap5 = 0
const lines = ['# 现有 level4 考点补厚清单（自动生成）', '', '> 目标：每个 L4 ≥3 题；mustMaster 考点 ≥5 题。`缺口3/缺口5` 为补到 3/5 题还需的题数。', '']
for (const dom of domains) {
  const dn = l4.filter((n) => n.id.startsWith(dom + '.'))
  const thin = dn.filter((n) => (qByNode.get(n.id) || []).length < 3)
  if (!thin.length) continue
  lines.push(`## ${dom}（偏薄节点 ${thin.length} 个）`)
  lines.push('')
  const byStack = new Map()
  for (const n of thin) {
    const stack = n.stack || n.id.split('.')[1]
    if (!byStack.has(stack)) byStack.set(stack, [])
    byStack.get(stack).push(n)
  }
  for (const [stack, arr] of byStack) {
    lines.push(`### stack=${stack}（${arr.length} 节点）`)
    lines.push('')
    lines.push('| L4 节点 id | 标题 | must | 现题量 | 现有题型 | 缺口3 | 缺口5 |')
    lines.push('|---|---|---|---|---|---|---|')
    for (const n of arr.sort((a, b) => a.id.localeCompare(b.id))) {
      const types = qByNode.get(n.id) || []
      const target = n.mustMaster ? 5 : 3
      const g3 = Math.max(0, 3 - types.length)
      const g5 = Math.max(0, 5 - types.length)
      totalGap3 += g3; totalGap5 += g5
      lines.push(`| ${n.id} | ${n.title} | ${n.mustMaster ? '★' : ''} | ${types.length} | ${[...new Set(types)].join('/') || '无'} | ${g3} | ${g5} |`)
    }
    lines.push('')
  }
}
lines.unshift('', `**全局缺口：补到全 ≥3 还需 ${totalGap3} 题；全部按 mustMaster≥5/其余≥3 还需 ${totalGap5} 题。**`, '')
writeFileSync(join(ROOT, 'docs', 'thin-nodes-audit.md'), lines.join('\n'), 'utf8')
console.log(`已生成 docs/thin-nodes-audit.md`)
console.log(`偏薄 L4 节点覆盖；补到≥3 需 ${totalGap3} 题，按目标深度需 ${totalGap5} 题`)
