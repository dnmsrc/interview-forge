#!/usr/bin/env node
// 知识覆盖缺口审计：按 domain/stack 统计 level4 节点数、有题/无题、题量分布、骨架 L2 落地情况
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
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

// 节点
const nodes = []
for (const f of walk(join(ROOT, 'content', 'nodes'))) {
  if (f.endsWith('_skeleton.json')) continue
  const d = readJson(f)
  for (const n of (Array.isArray(d) ? d : d.nodes) || []) nodes.push(n)
}
const nodeById = new Map(nodes.map((n) => [n.id, n]))
const l4 = nodes.filter((n) => n.level === 4)

// 题目（仅 active 父题；文件里默认无 status 字段视为 active）
const qByNode = new Map()
let totalQ = 0
for (const f of walk(join(ROOT, 'content', 'questions'))) {
  const d = readJson(f)
  for (const q of (Array.isArray(d) ? d : d.questions) || []) {
    if (q.status && q.status !== 'active') continue
    if (q.parentId) continue
    totalQ++
    const arr = qByNode.get(q.nodeId) || []
    arr.push(q.type)
    qByNode.set(q.nodeId, arr)
  }
}

// 骨架 L2
const skeleton = readJson(join(ROOT, 'content', 'nodes', '_skeleton.json'))
const l2Planned = skeleton.filter((n) => n.level === 2)
const existingStacks = new Set(nodes.filter((n) => n.level === 2).map((n) => n.id))

const domains = ['fe', 'be', 'cs', 'ai', 'eng']
console.log('========== 总览 ==========')
console.log(`节点总数 ${nodes.length}（L2=${nodes.filter((n) => n.level === 2).length} L3=${nodes.filter((n) => n.level === 3).length} L4=${l4.length}）· 活跃父题 ${totalQ}`)

for (const dom of domains) {
  const dn = l4.filter((n) => n.id.startsWith(dom + '.'))
  const empty = dn.filter((n) => !qByNode.has(n.id))
  const thin = dn.filter((n) => { const c = (qByNode.get(n.id) || []).length; return c > 0 && c < 3 })
  const ok = dn.filter((n) => (qByNode.get(n.id) || []).length >= 3)
  const qc = dn.reduce((s, n) => s + (qByNode.get(n.id) || []).length, 0)
  console.log(`\n===== [${dom}] L4节点 ${dn.length} · 题 ${qc} · 达标(≥3)${ok.length} · 偏薄(1-2)${thin.length} · 空白(0)${empty.length} =====`)
  // 按 stack 分组
  const byStack = new Map()
  for (const n of dn) {
    const stack = n.stack || n.id.split('.')[1]
    if (!byStack.has(stack)) byStack.set(stack, { l4: 0, q: 0, empty: [] })
    const g = byStack.get(stack)
    g.l4++
    const c = (qByNode.get(n.id) || []).length
    g.q += c
    if (c === 0) g.empty.push(n.id)
  }
  for (const [stack, g] of [...byStack].sort((a, b) => a[1].q - b[1].q)) {
    console.log(`  ${stack.padEnd(14)} L4=${String(g.l4).padStart(2)} 题=${String(g.q).padStart(3)}${g.empty.length ? `  空白节点${g.empty.length}: ${g.empty.slice(0, 4).map((x) => x.split('.').slice(2).join('.')).join(', ')}${g.empty.length > 4 ? '…' : ''}` : ''}`)
  }
}

console.log('\n========== 骨架规划但尚未落地的 stack（整块缺失，按 stack 字段比对） ==========')
const realStacks = new Set(nodes.map((n) => n.stack).filter(Boolean))
for (const n of l2Planned) {
  if (!realStacks.has(n.stack)) console.log(`  [${n.domain}] stack=${(n.stack || '').padEnd(12)} ${n.title}  —  ${n.summary}`)
}

console.log('\n========== 补齐工作量测算 ==========')
let need3 = 0, need5 = 0
for (const n of l4) {
  const c = (qByNode.get(n.id) || []).length
  if (c < 3) need3 += 3 - c
  if (c < 5) need5 += 5 - c
}
console.log(`现有 L4 节点 ${l4.length} 个、活跃题 ${totalQ} 道`)
console.log(`把所有现有 L4 补到 ≥3 题：还需 ${need3} 题（达到 ${totalQ + need3} 题）`)
console.log(`把所有现有 L4 补到 ≥5 题：还需 ${need5} 题（达到 ${totalQ + need5} 题）`)
