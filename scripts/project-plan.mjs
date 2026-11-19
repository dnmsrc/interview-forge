/**
 * 覆盖率补齐的「项目 → 关 → nodes」规划草案生成器。
 *
 * 为什么要有这个脚本：368 个缺口靠人手分到 20 多个项目里，一定会漏、会重、会把
 * 不相干的知识点硬塞进同一关。这里按「一个 stack 一个项目、一个 topic 一章关」的
 * 规则机械切分，产出可审阅的草案（data/project-plan.json），内容作者只负责把
 * 草案里的 nodes 清单写成真正能跑的项目。
 *
 * 规则：
 *   1. 只统计 level 3/4 且未被现有项目收编的节点；
 *   2. 同一关优先只放一个 topic（L3 + 它的 L4 子节点）；topic 太小时才与相邻 topic 合并；
 *   3. 每关 2~6 个 nodes（nodes[0] 是主节点，决定章节归属）；
 *   4. 同 stack 的关聚成一个项目，3~6 关一个项目；超过 6 关拆成 -1/-2。
 *
 * 用法：node scripts/project-plan.mjs [--write]
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const nodesDir = join(root, 'content', 'nodes')
const projDir = join(root, 'content', 'projects')

/* ---------------- 读图谱与已覆盖集合 ---------------- */
const graph = []
for (const rel of readdirSync(nodesDir, { recursive: true })) {
  if (typeof rel !== 'string' || !rel.endsWith('.json') || rel.endsWith('_skeleton.json')) continue
  try {
    const data = JSON.parse(readFileSync(join(nodesDir, rel), 'utf8'))
    const list = Array.isArray(data) ? data : data?.nodes
    if (Array.isArray(list)) graph.push(...list.filter((n) => n?.id))
  } catch { /* 坏文件由构建器报 */ }
}
const covered = new Set()
for (const f of readdirSync(projDir)) {
  if (!f.endsWith('.json')) continue
  try {
    const p = JSON.parse(readFileSync(join(projDir, f), 'utf8'))
    for (const lv of p.levels ?? []) for (const id of lv.nodes ?? []) covered.add(id)
  } catch { /* ignore */ }
}

const targets = graph.filter((n) => (n.level === 3 || n.level === 4) && !covered.has(n.id))

/* ---------------- 按 domain|stack 分桶，桶内按 topic 聚簇 ---------------- */
const bucketKey = (n) => `${n.domain}|${n.stack ?? '-'}`
const buckets = new Map()
for (const n of targets) {
  const k = bucketKey(n)
  if (!buckets.has(k)) buckets.set(k, [])
  buckets.get(k).push(n)
}

/** 一个 topic 簇：L3 主节点（若有）+ 它的 L4 子节点 */
function clusterTopics(nodes) {
  const byTopic = new Map()
  for (const n of nodes) {
    const t = n.topic ?? n.id.split('.').slice(-1)[0]
    if (!byTopic.has(t)) byTopic.set(t, [])
    byTopic.get(t).push(n)
  }
  const clusters = []
  for (const [topic, list] of byTopic) {
    // L3 排最前（它往往是 topic 根的摘要节点），其余按 id 长度/字典序稳定排列
    const sorted = [...list].sort((a, b) => (a.level === 3 ? -1 : b.level === 3 ? 1 : a.id.localeCompare(b.id)))
    clusters.push({ topic, nodes: sorted })
  }
  return clusters
}

/** 把簇切成关：目标每关 4~6 个 node（覆盖优先，一个 topic 的 L3+L4 尽量一关讲完） */
function cutLevels(clusters) {
  const levels = []
  let buf = null // { topic, nodes[] }
  const push = (topic, nodes) => { if (nodes.length) levels.push({ topic: nodes[0].topic ?? topic, nodes }) }
  for (const c of clusters) {
    if (!buf) buf = { topic: c.topic, nodes: [...c.nodes] }
    else if (buf.nodes.length >= 4) { push(buf.topic, buf.nodes); buf = { topic: c.topic, nodes: [...c.nodes] } }
    else buf.nodes.push(...c.nodes)
    while (buf.nodes.length > 6) push(buf.topic, buf.nodes.splice(0, 6))
  }
  if (buf?.nodes.length) {
    const last = levels[levels.length - 1]
    // 尾巴太短就并进上一关（不超 6）
    if (buf.nodes.length < 4 && last && last.nodes.length + buf.nodes.length <= 6) last.nodes.push(...buf.nodes)
    else push(buf.topic, buf.nodes)
  }
  return levels
}

const plan = []
for (const [key, nodes] of [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const [domain, stack] = key.split('|')
  const levels = cutLevels(clusterTopics(nodes))
  // 一个 stack 超过 6 关就拆项目，每项目 3~6 关
  const chunks = []
  for (let i = 0; i < levels.length; i += 3) chunks.push(levels.slice(i, i + 3))
  for (const [ci, chunk] of chunks.entries()) {
    const totalNodes = chunk.reduce((a, l) => a + l.nodes.length, 0)
    plan.push({
      domain,
      stack,
      slug: `${domain}-${stack}${chunks.length > 1 ? `-${ci + 1}` : ''}`,
      levels: chunk.map((l) => ({ topic: l.topic, nodes: l.nodes.map((n) => n.id) }))
    })
  }
}

/**
 * 合并碎片项目。
 *
 * 「一个 stack 一个项目」碰上 ai.eval（2 关）、ai.harness（1 关）这种小 stack，
 * 会产出一堆一关项目——卡片墙上全是只有一关的卡，既不好看也不符合「项目」的直觉。
 * 这里按 domain 内相邻合并：把不足 3 关的项目并进邻居，封口在 6 关，优先同 stack。
 */
const byDomain = new Map()
for (const p of plan) {
  if (!byDomain.has(p.domain)) byDomain.set(p.domain, [])
  byDomain.get(p.domain).push(p)
}
const merged = []
for (const [domain, list] of byDomain) {
  // 整个 domain 的关数不超过 6：直接合成一个项目，别切成「一关一个项目」的碎片
  const domainLevels = list.reduce((a, p) => a + p.levels.length, 0)
  if (domainLevels <= 6) {
    const levels = []
    for (const p of list) for (const lv of p.levels) levels.push({ ...lv, stack: p.stack })
    const stacks = []
    for (const p of list) if (!stacks.includes(p.stack)) stacks.push(p.stack)
    merged.push({ domain, stack: stacks[0], stacks, levels })
    continue
  }
  const queue = [...list]
  let current = null
  const seal = () => {
    if (!current) return
    // 主导 stack：关数最多的那个
    const cnt = new Map()
    for (const lv of current.levels) {
      const st = current.stackOf[lv.topic] ?? current.stack
      cnt.set(st, (cnt.get(st) ?? 0) + 1)
    }
    const mainStack = [...cnt.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
    merged.push({ domain, stack: mainStack, levels: current.levels, stacks: [...cnt.keys()] })
    current = null
  }
  while (queue.length) {
    const p = queue.shift()
    if (!current) {
      current = { stack: p.stack, stackOf: {}, levels: p.levels.map((l) => ({ ...l, stack: p.stack })) }
      for (const lv of current.levels) current.stackOf[lv.topic] = p.stack
      if (current.levels.length >= 3) seal()
      continue
    }
    // 同 stack 优先合并；不同 stack 也能并，但只在还没到 3 关时
    const add = p.levels.length
    if (current.levels.length + add <= 6) {
      for (const lv of p.levels) {
        current.levels.push({ ...lv, stack: p.stack })
        current.stackOf[lv.topic] = p.stack
      }
      if (current.levels.length >= 3) seal()
    } else {
      seal()
      current = { stack: p.stack, stackOf: {}, levels: p.levels.map((l) => ({ ...l, stack: p.stack })) }
      for (const lv of current.levels) current.stackOf[lv.topic] = p.stack
      if (current.levels.length >= 3) seal()
    }
  }
  seal()
}

// 命名：domain-主stack；eng 域的 4 个战例归一为 eng-warstory；同 domain 下重名依次加 -2/-3
const used = new Map()
const finalPlan = merged.map((p) => {
  const base = p.domain === 'eng' ? 'eng-warstory' : `${p.domain}-${p.stack}`
  const n = (used.get(base) ?? 0) + 1
  used.set(base, n)
  return {
    domain: p.domain,
    stacks: p.stacks,
    slug: n === 1 ? base : `${base}-${n}`,
    levels: p.levels.map((l) => ({ topic: l.topic, stack: l.stack, nodes: l.nodes }))
  }
})

/* ---------------- 汇总 ---------------- */
const totalPlanned = finalPlan.reduce((a, p) => a + p.levels.length, 0)
const nodesPlanned = finalPlan.reduce((a, p) => a + p.levels.reduce((x, l) => x + l.nodes.length, 0), 0)
console.log(`缺口 ${targets.length} 个 → 规划 ${finalPlan.length} 个项目 / ${totalPlanned} 关 / ${nodesPlanned} 个 nodes`)
for (const p of finalPlan) {
  console.log(`\n▸ ${p.slug}（${p.domain}·${p.stacks.join('+')}）${p.levels.length} 关`)
  for (const [i, l] of p.levels.entries()) console.log(`   lv${i + 1} [${l.topic}] ${l.nodes.join(', ')}`)
}

if (process.argv.includes('--write')) {
  writeFileSync(join(root, 'data', 'project-plan.json'), `${JSON.stringify(finalPlan, null, 2)}\n`, 'utf8')
  // 同时按项目拆成 data/plans/<slug>.json：内容作者只读自己那一份，不用从 26 个项目里翻
  mkdirSync(join(root, 'data', 'plans'), { recursive: true })
  for (const p of finalPlan) {
    writeFileSync(join(root, 'data', 'plans', `${p.slug}.json`), `${JSON.stringify(p, null, 2)}\n`, 'utf8')
  }
  console.log(`\n已写出 data/project-plan.json 与 data/plans/（${finalPlan.length} 份）`)
}