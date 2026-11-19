#!/usr/bin/env node
/**
 * 项目闯关 ↔ 知识图谱覆盖验收。
 *
 * 回答一个问题：知识图谱里的知识点，有多少真的被「项目闯关」收编了？
 * 口径（与主进程 UI 共用 src/shared/project-coverage.mjs）：
 *   目标 = 图谱里 level 3（topic 摘要）+ level 4（具体知识点）的节点；
 *   覆盖 = 至少有一关在 nodes 里显式声明了它。
 *
 * 用法：
 *   node scripts/project-coverage.mjs              # 打报告（退出码 0）
 *   node scripts/project-coverage.mjs --gaps       # 按 stack 列出全部未覆盖知识点
 *   node scripts/project-coverage.mjs --json      # 机器可读
 *   node scripts/project-coverage.mjs --check --min=100
 *                                                # 覆盖率低于 min 或有非法映射 → 退出码 1
 *
 * 内容源是 content/projects-src/*.mjs，但覆盖看的是构建产物 content/projects/*.json：
 * 先跑 npm run project:build（构建会自动拦「nodes 里写了图谱里不存在的 id」）。
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { computeCoverage } from '../src/shared/project-coverage.mjs'

const ROOT = process.cwd()
const args = process.argv.slice(2)
const jsonMode = args.includes('--json')
const gaps = args.includes('--gaps')
const check = args.includes('--check')
const minArg = args.find((a) => a.startsWith('--min='))
const min = minArg ? Number(minArg.slice('--min='.length)) : null

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
  const data = readJson(f)
  const list = Array.isArray(data) ? data : data.nodes
  if (Array.isArray(list)) nodes.push(...list)
}

const projects = []
for (const f of walk(join(ROOT, 'content', 'projects'))) {
  const p = readJson(f)
  if (p?.id && Array.isArray(p.levels)) projects.push(p)
}

const cov = computeCoverage(projects, nodes)

if (jsonMode) {
  console.log(JSON.stringify(cov, null, 2))
} else {
  const pct = (r) => `${(r * 100).toFixed(1)}%`
  const line = '─'.repeat(64)
  console.log(`\n项目闯关 · 知识图谱覆盖`)
  console.log(line)
  console.log(`  知识点 ${cov.totalTargets} 个（L3/L4），已被 ${projects.length} 个项目 / ${projects.reduce((n, p) => n + p.levels.length, 0)} 关覆盖 ${cov.covered} 个 → ${pct(cov.ratio)}`)
  if (cov.missing) console.log(`  还差 ${cov.missing} 个未收编`)

  if (cov.invalid.length) {
    console.log(`\n✗ 非法映射 ${cov.invalid.length} 条：`)
    for (const bad of cov.invalid.slice(0, 30)) console.log(`   ${bad.project}/${bad.level} · ${bad.node}（${bad.reason}）`)
    if (cov.invalid.length > 30) console.log(`   ……另有 ${cov.invalid.length - 30} 条`)
  }
  if (cov.unmappedLevels.length) {
    console.log(`\n! 没写 nodes 的关卡 ${cov.unmappedLevels.length} 关：`)
    for (const u of cov.unmappedLevels.slice(0, 40)) console.log(`   ${u.project}/${u.level}`)
    if (cov.unmappedLevels.length > 40) console.log(`   ……另有 ${cov.unmappedLevels.length - 40} 关`)
  }

  const table = (title, rows) => {
    console.log(`\n${title}`)
    const w = Math.max(...rows.map((r) => r.key.length), 6)
    for (const r of rows) {
      const bar = '█'.repeat(Math.round(r.ratio * 18)).padEnd(18, '░')
      console.log(`   ${r.key.padEnd(w)}  ${String(r.covered).padStart(3)}/${String(r.total).padEnd(3)} ${bar} ${pct(r.ratio)}`)
    }
  }
  table('按领域', cov.byDomain)
  table('按技术栈', cov.byStack)

  if (gaps) {
    console.log('\n未覆盖知识点：')
    let lastStack = ''
    for (const n of cov.missingNodes) {
      if (n.stack !== lastStack) {
        lastStack = n.stack
        console.log(`\n  [${n.stack}]`)
      }
      console.log(`   ${n.mustMaster ? '*' : ' '} ${n.id} · ${n.title}`)
    }
  } else if (cov.missing) {
    const top = cov.missingNodes.slice(0, 25)
    console.log(`\n未覆盖知识点（前 ${top.length} 条，--gaps 看全量）：`)
    for (const n of top) console.log(`   ${n.mustMaster ? '*' : ' '} ${n.id} · ${n.title}`)
  }
  if (cov.missing && cov.missingNodes.some((n) => n.mustMaster)) {
    console.log(`\n注：* = mustMaster（必掌握），应优先补进项目关卡`)
  }
  console.log('')
}

const ok = !cov.invalid.length && (min == null || cov.ratio * 100 >= min)
if (check) {
  if (cov.invalid.length) {
    console.error(`✗ ${cov.invalid.length} 条非法映射`)
    process.exit(1)
  }
  if (min != null && cov.ratio * 100 < min) {
    console.error(`✗ 覆盖率 ${(cov.ratio * 100).toFixed(1)}% 低于要求的 ${min}%`)
    process.exit(1)
  }
}
process.exit(ok ? 0 : 1)