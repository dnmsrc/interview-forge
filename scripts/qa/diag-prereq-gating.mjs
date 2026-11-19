#!/usr/bin/env node
// 前置门槛（blocked）修复前后对比：证明「INNER JOIN 时全新用户没有任何节点被挡」这个 bug 是真的，
// 并检查修复后今日队列是否由浅入深。node scripts/qa/diag-prereq-gating.mjs
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

const db = new DatabaseSync(join(process.cwd(), 'data', 'app.db'), { readOnly: true })
const all = (sql, ...p) => db.prepare(sql).all(...p)

const lit = all(`SELECT COUNT(*) c FROM node_mastery WHERE lit=1`)[0].c
const rows = all(`SELECT COUNT(*) c FROM node_mastery`)[0].c
console.log(`当前 node_mastery 行数=${rows}，已点亮=${lit}`)

const BLOCKED_SQL = (joinKind) => `
  SELECT n.id, n.level, CASE WHEN EXISTS (
    SELECT 1 FROM edges e ${joinKind} JOIN node_mastery pm ON pm.node_id=e.from_id
    WHERE e.to_id=n.id AND e.type='prereq' AND COALESCE(pm.lit,0)=0 AND COALESCE(pm.forced_unlock,0)=0
  ) THEN 1 ELSE 0 END blocked
  FROM nodes n WHERE n.status='active'`
const oldBlocked = all(BLOCKED_SQL('')).filter((r) => r.blocked).length
const newBlocked = all(BLOCKED_SQL('LEFT')).filter((r) => r.blocked).length
console.log(`判定为「前置未就绪」的节点数：修复前(INNER)=${oldBlocked} → 修复后(LEFT)=${newBlocked}`)

const q = all(`
  SELECT id, difficulty, level, nid, title, gates FROM (
    SELECT q.id, q.difficulty, n.level, n.id nid, n.title,
           COALESCE((SELECT COUNT(*) FROM edges g WHERE g.to_id=q.node_id AND g.type='prereq'),0) gates,
           ROW_NUMBER() OVER (PARTITION BY q.node_id ORDER BY q.difficulty ASC, RANDOM()) rn
    FROM questions q LEFT JOIN nodes n ON n.id=q.node_id
    LEFT JOIN (${BLOCKED_SQL('LEFT')}) p ON p.id=q.node_id
    LEFT JOIN node_mastery m ON m.node_id=q.node_id
    WHERE q.status='active' AND q.parent_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.question_id=q.id)
      AND (COALESCE(m.forced_unlock,0)=1 OR COALESCE(p.blocked,0)=0)
  ) WHERE rn <= 2
  ORDER BY gates ASC, difficulty ASC LIMIT 12`)
console.log('\n今日可选新题（前 12；gates=外部前置数量，越少越基础；每考点最多 2 题）:')
for (const r of q) console.log(`  gates=${r.gates} L${r.level} d${r.difficulty} ${String(r.nid).padEnd(38)} ${String(r.title).slice(0, 24)}`)
console.log(`  不同考点数=${new Set(q.map((r) => r.nid)).size} / ${q.length} 题`)

const oldOrder = all(`
  SELECT q.id, q.difficulty, n.level
  FROM questions q LEFT JOIN nodes n ON n.id=q.node_id
  WHERE q.status='active' AND q.parent_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.question_id=q.id)
  ORDER BY q.difficulty ASC LIMIT 10`)
console.log('\n旧排序（只看 difficulty、且不看 blocked）前 10 的考点层级分布:',
  oldOrder.map((r) => `L${r.level}`).join(' '), '← 深水区直接混进首屏')

db.close()
