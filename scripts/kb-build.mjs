#!/usr/bin/env node
/**
 * 知识点采集与起草 CLI（契约 docs/design/KNOWLEDGE-SYSTEM.md §9）。
 *
 * 流程与「应用里点 AI 生成讲义」完全同源：管道逻辑在 scripts/kb-draft-core.mjs，
 * 本文件只负责参数、选考点与打印。用法：
 *   node scripts/kb-build.mjs --domain fe --limit 8 --concurrency 2
 *   node scripts/kb-build.mjs --only fe.vue.compiler.ast-pipeline --dry
 *   node scripts/kb-build.mjs --domain be --only-empty --no-ai   # 只抓来源不起草
 */
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { buildDraft } from './kb-draft-core.mjs'

const argv = process.argv.slice(2)
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : def
}
const DOMAIN = opt('domain', null)
const LIMIT = Number(opt('limit', 6))
// 本地模型并发 2 会双双超时（实测），默认串行；--concurrency 显式调大仅适合有远程端点的环境
const CONCURRENCY = Math.max(1, Number(opt('concurrency', 1)))
const FORCE = argv.includes('--force')
const DRY = argv.includes('--dry')
const NO_AI = argv.includes('--no-ai')
const ONLY_EMPTY = argv.includes('--only-empty')
const ONLY = opt('only', null)
const ROOT = process.cwd()
const KB_DIR = join(ROOT, 'content', 'knowledge')

const db = new DatabaseSync(join(ROOT, 'data', 'app.db'))
db.exec(`PRAGMA busy_timeout=8000`)
const all = (sql, ...p) => db.prepare(sql).all(...p)
const get = (sql, ...p) => db.prepare(sql).get(...p)

// ---------- AI 端点（读 settings.ai.endpoints，与应用同源配置） ----------
function pickAi() {
  const row = get(`SELECT value FROM settings WHERE key='ai.endpoints'`)
  if (!row) return null
  try {
    const list = JSON.parse(row.value).filter((e) => e.enabled !== false)
    const routing = (() => { try { return JSON.parse(get(`SELECT value FROM settings WHERE key='ai.routing'`)?.value ?? '{}') } catch { return {} } })()
    const id = routing.fastEndpointId
    return list.find((e) => e.id === id) ?? list.find((e) => e.role === 'fast') ?? list[0] ?? null
  } catch { return null }
}
async function aiChat(ep, system, user) {
  const res = await fetch(`${ep.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(ep.apiKey ? { authorization: `Bearer ${ep.apiKey}` } : {}) },
    body: JSON.stringify({ model: ep.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.3, stream: false, max_tokens: 4000 }),
    // 本机长文成功均值约 120s，给 240s 上限，避免快完成时被超时打断
    signal: AbortSignal.timeout(240000)
  })
  if (!res.ok) throw new Error(`AI HTTP ${res.status} ${(await res.text()).slice(0, 160)}`)
  const j = await res.json()
  return String(j?.choices?.[0]?.message?.content ?? '')
}

const ep = NO_AI ? null : pickAi()
if (!NO_AI && !ep) { console.error('找不到可用 AI 端点（settings.ai.endpoints），加 --no-ai 可只抓来源'); process.exit(2) }

const where = [`n.level=4`, `n.status='active'`]
const params = []
if (DOMAIN) { where.push('n.domain=?'); params.push(DOMAIN) }
if (ONLY) { where.push('n.id=?'); params.push(ONLY) }
let nodes = all(`SELECT n.id,n.title,n.summary FROM nodes n WHERE ${where.join(' AND ')} ORDER BY n.ord LIMIT ?`, ...params, LIMIT * 3)
if (ONLY_EMPTY) {
  const have = new Set(all(`SELECT node_id FROM knowledge`).map((r) => r.node_id))
  nodes = nodes.filter((n) => !have.has(n.id))
}
nodes = nodes.slice(0, ONLY ? 1 : LIMIT)
const validNodeIds = new Set(all(`SELECT id FROM nodes`).map((r) => r.id))
console.log(`待处理考点 ${nodes.length} 个，并发 ${CONCURRENCY}，AI=${ep ? ep.label : '关闭'}`)

const ctx = {
  chat: (system, user) => aiChat(ep, system, user),
  prereqOf: (nodeId) => all(`SELECT from_id FROM edges WHERE to_id=? AND type IN ('advance','depend') LIMIT 5`, nodeId).map((r) => r.from_id).join(', ') || null,
  // 同模块（同一父节点）下的其他考点：讲义「相关」小节的 [[双链]] 只能从这里取，防止模型发明 id
  siblingsOf: (nodeId) => {
    const parent = String(nodeId).split('.').slice(0, -1).join('.') + '.'
    return all(`SELECT id FROM nodes WHERE id LIKE ? AND id != ? AND level=4 AND status='active' LIMIT 4`, [parent + '%', nodeId]).map((r) => r.id)
  },
  validNodeIds, kbDir: KB_DIR, force: FORCE, dry: DRY, noAi: NO_AI
}

const results = []
let cursor = 0
async function worker() {
  while (cursor < nodes.length) {
    const node = nodes[cursor++]
    try {
      const r = await buildDraft(node, ctx)
      results.push(r)
      console.log(`  [${r.status}] ${node.id}${r.flags ? ' → ' + r.flags.join('；') : ''}`)
    } catch (e) {
      results.push({ node: node.id, status: 'error', message: String(e?.message ?? e).slice(0, 140) })
      console.log(`  [error] ${node.id} → ${String(e?.message ?? e).slice(0, 120)}`)
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker))
const tally = results.reduce((acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc }, {})
console.log('\n汇总：', JSON.stringify(tally))
db.close()
process.exit(results.some((r) => r.status === 'error') ? 1 : 0)
