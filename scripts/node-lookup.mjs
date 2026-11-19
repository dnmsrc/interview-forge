/**
 * 查知识点：content/nodes/** 里的节点按 id / 前缀 / topic 过滤，打印作者需要的字段。
 *
 * 用法：
 *   node scripts/node-lookup.mjs be.java.dsa          # 精确 id 或前缀
 *   node scripts/node-lookup.mjs --topic=docker       # 按 topic
 *   node scripts/node-lookup.mjs be.mysql --json      # 机器可读
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const args = process.argv.slice(2)
const json = args.includes('--json')
const topicArg = args.find((a) => a.startsWith('--topic='))?.slice('--topic='.length)
const needles = args.filter((a) => !a.startsWith('--'))

const nodes = []
for (const rel of readdirSync(join(root, 'content', 'nodes'), { recursive: true })) {
  if (typeof rel !== 'string' || !rel.endsWith('.json') || rel.endsWith('_skeleton.json')) continue
  try {
    const data = JSON.parse(readFileSync(join(root, 'content', 'nodes', rel), 'utf8'))
    const list = Array.isArray(data) ? data : data?.nodes
    if (Array.isArray(list)) nodes.push(...list.filter((n) => n?.id))
  } catch { /* 交给构建器报 */ }
}

const hit = nodes.filter((n) => {
  if (topicArg) return n.topic === topicArg || n.id.includes(`.${topicArg}.`)
  return needles.some((k) => n.id === k || n.id.startsWith(`${k}.`) || n.id.includes(k))
})
hit.sort((a, b) => a.id.localeCompare(b.id))

if (json) {
  console.log(JSON.stringify(hit, null, 2))
} else {
  if (!hit.length) console.log('没有匹配的节点')
  for (const n of hit) {
    console.log(`\n▸ ${n.id}  [L${n.level} · ${n.domain}/${n.stack ?? '-'} · topic=${n.topic ?? '-'}${n.mustMaster ? ' · 必须掌握' : ''}]`)
    console.log(`  ${n.title ?? ''}`)
    if (n.summary) console.log(`  ${n.summary}`)
  }
  console.log(`\n共 ${hit.length} 个`)
}