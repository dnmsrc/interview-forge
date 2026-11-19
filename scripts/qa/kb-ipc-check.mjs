// knowledge.* 通道端到端前置检查（纯 node，不需要 Electron）：
//   ① api.ts 的 API_METHODS.knowledge ↔ main/ipc.ts 的 knowledge impl 方法名必须一一对应
//      （preload / renderer 都是从 API_METHODS 自动生成的，名字对不上就是运行时 invoke 失败）
//   ② impl 委托的每个函数必须在 services/knowledge.ts 里真的 export 出来
//   ③ 用与 searchKnowledge / getKnowledge / knowledgeStatus 完全相同的 SQL 打一遍真库，
//      证明 FTS 触发器、bm25 权重、node_mastery 关联都是活的
// 用法：node scripts/qa/kb-ipc-check.mjs
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFtsMatch } from '../../src/shared/knowledge-core.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const problems = []
const ok = (cond, msg) => { if (cond) console.log('  ✓ ' + msg); else { problems.push(msg); console.log('  ✗ ' + msg) } }

/* ---- ① / ② 通道名一致性 ---- */
const apiSrc = read('src/shared/api.ts')
const ipcSrc = read('src/main/ipc.ts')
const svcSrc = read('src/main/services/knowledge.ts')

const apiBlock = /knowledge:\s*\[([^\]]*)\]/.exec(apiSrc)?.[1] ?? ''
const apiMethods = Array.from(apiBlock.matchAll(/'([^']+)'/g)).map((m) => m[1])
ok(apiMethods.length > 0, `API_METHODS.knowledge 有 ${apiMethods.length} 个方法：${apiMethods.join(',')}`)

const implBlock = /\n\s*knowledge:\s*{([\s\S]*?)\n\s*},/.exec(ipcSrc)?.[1] ?? ''
const implMethods = Array.from(implBlock.matchAll(/async\s+([A-Za-z0-9_]+)\s*\(/g)).map((m) => m[1])
ok(implMethods.length > 0, `ipc.ts knowledge impl 有 ${implMethods.length} 个方法：${implMethods.join(',')}`)

const missingImpl = apiMethods.filter((m) => !implMethods.includes(m))
const extraImpl = implMethods.filter((m) => !apiMethods.includes(m))
ok(!missingImpl.length, `API 声明的方法都有实现${missingImpl.length ? '（缺：' + missingImpl.join(',') + '）' : ''}`)
ok(!extraImpl.length, `实现里没有多余方法${extraImpl.length ? '（多：' + extraImpl.join(',') + '）' : ''}`)

// 通道名与 service 函数名不必相同（knowledge.get → getKnowledge），所以按出现位置配对：
// 每个 `async <方法>(` 之后第一个 `knowledgeSvc.<fn>(` 就是它的实现函数。
const decls = Array.from(implBlock.matchAll(/async\s+([A-Za-z0-9_]+)\s*\(/g)).map((m) => ({ name: m[1], at: m.index }))
const calls = Array.from(implBlock.matchAll(/knowledgeSvc\.([A-Za-z0-9_]+)\s*\(/g)).map((m) => ({ fn: m[1], at: m.index }))
decls.forEach((d, i) => {
  const bound = i + 1 < decls.length ? decls[i + 1].at : implBlock.length
  const call = calls.find((c) => c.at > d.at && c.at < bound)
  if (!call) { problems.push(`impl knowledge.${d.name} 没有委托给 knowledgeSvc`); console.log(`  ✗ impl knowledge.${d.name} 未委托 knowledgeSvc`); return }
  ok(new RegExp(`export function ${call.fn}\\s*\\(`).test(svcSrc), `knowledge.${d.name} → services/knowledge.ts#${call.fn} 存在`)
})

// ForgeApi 里必须声明 knowledge 命名空间（渲染层与 preload 的类型来源）
ok(/knowledge:\s*{[\s\S]*?get\(nodeId:\s*string\)/.test(apiSrc), 'ForgeApi.knowledge 声明了 get(nodeId)')
ok(/export interface KnowledgeEntry\b/.test(apiSrc), 'api.ts 里有 KnowledgeEntry DTO 声明')

/* ---- ③ 真库 SQL 冒烟 ---- */
const dbPath = process.env.FORGE_DB || join(ROOT, 'data', 'app.db')
const db = new DatabaseSync(dbPath, { readOnly: true })
try {
  const total = db.prepare(`SELECT COUNT(*) n FROM knowledge`).get().n
  ok(total >= 3, `knowledge 表有 ${total} 行（样板至少 3 行）`)

  // getKnowledge
  const row = db.prepare(`SELECT node_id,title,summary,word_count,quality_flags,confidence,reviewed
                          FROM knowledge WHERE node_id='fe.vue.reactivity.proxify'`).get()
  ok(!!row && Number(row.word_count) >= 900 && row.quality_flags === '[]',
    `getKnowledge 命中：${row?.node_id}｜字数 ${row?.word_count}｜flags ${row?.quality_flags}`)
  const srcs = db.prepare(`SELECT COUNT(*) n, SUM(kind='official') off FROM knowledge_sources WHERE node_id='fe.vue.reactivity.proxify'`).get()
  ok(srcs.n >= 2 && srcs.off >= 1, `来源 ${srcs.n} 条，其中 official ${srcs.off} 条`)

  // searchKnowledge：两档策略，与 services/knowledge.ts 同一份表达式构造器 + 同一条 FTS_SQL
  const FTS_SQL = `SELECT k.node_id,k.title,bm25(knowledge_fts, 12.0, 6.0, 1.0) AS score,
                          m.mastery_level, COALESCE(m.lit,0) lit, COALESCE(m.stale,0) stale
                     FROM knowledge_fts JOIN knowledge k ON k.rowid = knowledge_fts.rowid
                     LEFT JOIN node_mastery m ON m.node_id = k.node_id
                    WHERE knowledge_fts MATCH ? ORDER BY score LIMIT ?`
  const expectTop = { '懒代理': 'fe.vue.reactivity.proxify', '编译器 优化': 'fe.vue.compiler.ast-pipeline', 'nextTick': 'fe.vue.scheduler.nexttick' }
  for (const [q, want] of Object.entries(expectTop)) {
    const built = buildFtsMatch(q)
    const strict = built.matchStrict ? db.prepare(FTS_SQL).all(built.matchStrict, 10) : []
    const loose = db.prepare(FTS_SQL).all(built.match, 10)
    const tier = strict.length ? strict : loose
    const top = tier[0]?.node_id
    ok(top === want, `检索「${q}」→ 首位 ${top}（严格档 ${strict.length} 条 / 宽松档 ${loose.length} 条）`)
    ok(tier.every((r) => typeof r.score === 'number' && r.lit !== undefined), `检索「${q}」的 bm25 + node_mastery 关联字段齐全`)
  }

  // knowledgeStatus
  const st = db.prepare(`SELECT
      (SELECT COUNT(*) FROM knowledge) total,
      (SELECT COUNT(*) FROM nodes) nodes_total,
      (SELECT COUNT(*) FROM nodes n WHERE n.level=4 AND NOT EXISTS (SELECT 1 FROM knowledge k WHERE k.node_id=n.id)) missing_body,
      (SELECT COUNT(DISTINCT q.node_id) FROM questions q JOIN knowledge k ON k.node_id=q.node_id WHERE q.status='active') covered,
      (SELECT MAX(indexed_at) FROM knowledge) last_indexed`).get()
  ok(st.total > 0 && st.nodes_total > 0 && typeof st.missing_body === 'number',
    `status：正文 ${st.total}｜节点 ${st.nodes_total}｜缺正文 ${st.missing_body}｜覆盖 ${st.covered}｜最近索引 ${st.last_indexed}`)

  // 触发器仍然活着（删掉任何一个都会让 FTS 与主表脱钩）
  const trg = db.prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='knowledge' ORDER BY name`).all().map((r) => r.name)
  ok(trg.length >= 3, `knowledge 上的触发器 ${trg.length} 个：${trg.join(', ')}`)
} finally {
  db.close()
}

console.log(problems.length ? `\n✗ knowledge 通道检查未通过：${problems.length} 项` : '\n✓ knowledge 通道检查全部通过')
process.exit(problems.length ? 1 : 0)
