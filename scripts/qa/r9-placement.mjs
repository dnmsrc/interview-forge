#!/usr/bin/env node
// R9 摸底引擎 + 错题本验收（纯 Node，不依赖 electron）。
// 服务层不依赖 electron API，但工程没有 tsx 运行 TS，这里：
//  1) 幂等建表（复刻 schema.mjs 的 R9 DDL，模拟应用启动）；
//  2) 用 SQL + 与 placement.ts 相同的探针规则做端到端断言；
//  3) 全程在临时 session 上跑，结束删除测试数据，不污染真实学习记录。
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const db = new DatabaseSync(join(process.cwd(), 'data', 'app.db'))
db.exec(`PRAGMA busy_timeout=8000`)
const bad = []
const assert = (cond, msg) => { if (!cond) bad.push(msg); console.log(`  ${cond ? 'OK ' : 'FAIL'} ${msg}`) }

// ---- 1. 幂等建新表（与 src/shared/schema.mjs 保持一致）----
db.exec(`
CREATE TABLE IF NOT EXISTS placement_session (
  id TEXT PRIMARY KEY, domain TEXT, status TEXT DEFAULT 'active',
  current_node_id TEXT, level REAL DEFAULT 2,
  created_at TEXT, updated_at TEXT, finished_at TEXT, summary TEXT
);
CREATE TABLE IF NOT EXISTS placement_turn (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
  node_id TEXT, question_id TEXT, scale4 INTEGER, pct REAL, verdict TEXT,
  gap_type TEXT, gap_note TEXT, grading_kind TEXT, created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_pturn_session ON placement_turn(session_id);
CREATE INDEX IF NOT EXISTS idx_psession_domain ON placement_session(domain, status);
`)
const tabs = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('placement_session','placement_turn')`).all()
assert(tabs.length === 2, '摸底两张表已建立（placement_session / placement_turn）')

const nowStr = () => new Date().toISOString().slice(0, 19).replace('T', ' ')
const domain = 'fe'
const sid = 'qa-' + randomUUID().slice(0, 8)

// ---- 2. 探针规则（与 placement.ts 同源）----
const prereqsOf = (id) => db.prepare(`SELECT from_id FROM edges WHERE to_id=? AND type='prereq'`).all(id).map(r => r.from_id)
const dependentsOf = (id) => db.prepare(`SELECT to_id FROM edges WHERE from_id=? AND type='prereq'`).all(id).map(r => r.to_id)
const isLit = (id) => (db.prepare(`SELECT COALESCE(lit,0) lit FROM node_mastery WHERE node_id=?`).get(id)?.lit ?? 0) === 1
const l4 = db.prepare(`SELECT id,title,ord FROM nodes WHERE level=4 AND domain=? AND status='active' ORDER BY ord`).all(domain)
assert(l4.length > 0, `板块 ${domain} 有 L4 考点（${l4.length} 个）`)

// 起点：外部前置数最少的 L4
const start = l4.map(n => ({ id: n.id, gates: prereqsOf(n.id).length, ord: n.ord }))
  .sort((a, b) => a.gates - b.gates || a.ord - b.ord)[0]
assert(!!start, '能选出最基础的起始考点（前置最少）')
console.log(`     起始考点：${start.id}（前置数 ${start.gates}）`)

const pickQ = (nodeId, used) => db.prepare(
  `SELECT id,node_id FROM questions WHERE node_id=? AND status='active' AND parent_id IS NULL
   ORDER BY difficulty ASC, RANDOM()`).all(nodeId).find(r => !used.has(r.id))

db.prepare(`INSERT INTO placement_session(id,domain,status,current_node_id,level,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`)
  .run(sid, domain, 'active', start.id, 2, nowStr(), nowStr())

const usedQ = new Set()
const visited = new Set()
let cur = start.id
const trace = []

// 模拟一轮：第一题标记「知识点不会」→ 应下探前置
function turn(nodeId, scale4, gapType = null) {
  const q = pickQ(nodeId, usedQ)
  if (!q) return null
  usedQ.add(q.id); visited.add(nodeId)
  db.prepare(`INSERT INTO placement_turn(session_id,node_id,question_id,scale4,pct,verdict,gap_type,gap_note,grading_kind,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(sid, nodeId, q.id, scale4, scale4 * 30, 'qa', gapType, null, gapType ? 'self' : 'auto', nowStr())
  trace.push({ node: nodeId, q: q.id, scale4, gapType })
  return q
}

// 第 1 轮：起始考点标记 concept 不会
const q1 = turn(cur, 0, 'concept')
assert(!!q1, '起始考点能出一道题')
const weakPre = prereqsOf(cur).filter(p => !visited.has(p) && !isLit(p))[0]
  ?? prereqsOf(cur).find(p => !visited.has(p))
if (weakPre) {
  cur = weakPre
  const q2 = turn(cur, 1, null)
  assert(!!q2, '标记不会后下探到前置考点并出前置题（刨根问底、不跳知识点）')
  console.log(`     下探路径：${trace[0].node} → ${cur}`)
  // 前置答对 → 回后继上探
  const dep = dependentsOf(cur).filter(d => !visited.has(d))[0]
  if (dep) {
    cur = dep
    const q3 = turn(cur, 3, null)
    assert(!!q3, '前置掌握后上探后继考点（难度递进）')
    console.log(`     上探路径：${trace[1].node} → ${cur}`)
  }
} else {
  console.log('     起始考点无外部前置（已是最基础），下探分支不适用，跳过该断言')
}

// ---- 3. 缺口 / 轮次 / resume 持久化 ----
const turns = db.prepare(`SELECT * FROM placement_turn WHERE session_id=?`).all(sid)
assert(turns.length === trace.length, `每轮判定都落库（${turns.length} 轮）`)
const gapRows = db.prepare(`SELECT * FROM placement_turn WHERE session_id=? AND gap_type IS NOT NULL`).all(sid)
assert(gapRows.some(g => g.gap_type === 'concept'), 'gap_type=concept 缺口被精确保留（定位"知识点不会"）')

// 模拟 code 缺口
const codeNode = [...visited][0]
const cq = pickQ(codeNode, usedQ)
if (cq) { usedQ.add(cq.id); db.prepare(`INSERT INTO placement_turn(session_id,node_id,question_id,scale4,pct,verdict,gap_type,gap_note,grading_kind,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
  .run(sid, codeNode, cq.id, 0, 0, 'qa', 'code', '手写不出', 'self', nowStr()) }
const gapAgg = db.prepare(
  `SELECT t.node_id, t.gap_type, COUNT(*) c FROM placement_turn t JOIN placement_session s ON s.id=t.session_id
   WHERE t.gap_type IS NOT NULL AND s.domain=? GROUP BY t.node_id,t.gap_type`).all(domain)
assert(gapAgg.some(g => g.gap_type === 'code') && gapAgg.some(g => g.gap_type === 'concept'),
  'gaps 能按 concept/code 分类汇总"不会在哪"')

// resume：活动会话可被找回
const resumed = db.prepare(`SELECT * FROM placement_session WHERE domain=? AND status='active' ORDER BY updated_at DESC LIMIT 1`).get(domain)
assert(!!resumed && resumed.id === sid, '活动摸底会话可断点续测（resume 读到同一 session）')

// 结束会话 + summary
const scales = [...new Set(turns.map(t => t.node_id))].map(nid => Math.max(...turns.filter(t => t.node_id === nid).map(t => t.scale4)))
const avg = scales.reduce((a, b) => a + b, 0) / scales.length
db.prepare(`UPDATE placement_session SET status='done',finished_at=?,summary=?,current_node_id=NULL WHERE id=?`)
  .run(nowStr(), JSON.stringify({ pct: Math.round(avg / 3 * 100), scale4: avg, starts: [] }), sid)
const done = db.prepare(`SELECT * FROM placement_session WHERE id=?`).get(sid)
assert(done.status === 'done' && !!done.summary, '结束写入 status=done 与 summary（常态化保存水平）')

// ---- 4. 错题本聚合（复刻 mistakes.ts 的判定）----
const hiddenKey = 'mistakes.hidden'
db.prepare(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
  .run('qa.mistakes.probe', '1') // 占位，确认 settings 可写
const mistakeRows = db.prepare(
  `SELECT q.id qid, COUNT(a.id) times, SUM(CASE WHEN a.scale4<2 THEN 1 ELSE 0 END) wrongTimes,
          MIN(a.score) worst, AVG(a.score) avgScore, MAX(a.created_at) lastAt, COALESCE(m.lit,0) lit
   FROM attempts a JOIN questions q ON q.id=a.question_id
   LEFT JOIN node_mastery m ON m.node_id=q.node_id
   WHERE a.scale4<2 GROUP BY q.id HAVING wrongTimes>0`).all()
assert(Array.isArray(mistakeRows), '错题本聚合查询可执行（基于 attempts 实时计算）')
if (mistakeRows.length) {
  console.log(`     当前库错题（scale4<2 去重）：${mistakeRows.length} 道，最差 ${mistakeRows[0].worst} 分`)
  const r0 = mistakeRows[0]
  assert(r0.wrongTimes >= 1 && r0.times >= r0.wrongTimes, '错题行 times/wrongTimes/worst 字段自洽')
} else {
  console.log('     库内暂无 scale4<2 历史，错题聚合空集（逻辑仍成立）')
}

// ---- 清理 QA 数据 ----
db.prepare(`DELETE FROM placement_turn WHERE session_id=?`).run(sid)
db.prepare(`DELETE FROM placement_session WHERE id=?`).run(sid)
db.prepare(`DELETE FROM settings WHERE key=?`).run('qa.mistakes.probe')
const left = db.prepare(`SELECT COUNT(*) n FROM placement_session WHERE id=?`).get(sid).n
assert(left === 0, 'QA 测试数据已清理，不污染真实记录')
db.close()

console.log(bad.length ? `\n❌ ${bad.length} 项失败` : '\n✅ R9 摸底引擎 + 错题本全部断言通过')
process.exit(bad.length ? 1 : 0)
