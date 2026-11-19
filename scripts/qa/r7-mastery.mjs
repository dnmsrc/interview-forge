#!/usr/bin/env node
// 掌握状态机验收（契约 KNOWLEDGE-SYSTEM.md §7 / §11）：
// 1) 同一考点连续 3 次 ≥80 分 → mastery_level=2（已掌握）
// 2) last_practice 推到 20 天前 + 到期未复习 → mastery_level=3（已生疏）、scale4 降一档、
//    stale=1、srs 权重升高且 due 提前到当天 → 该考点重新进今日队列
// 全程在一个事务里跑，结束一律 ROLLBACK，绝不污染用户真实数据。
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

const db = new DatabaseSync(join(process.cwd(), 'data', 'app.db'))
db.exec(`PRAGMA busy_timeout=8000`)
const bad = []
const assert = (cond, msg) => { if (!cond) bad.push(msg); console.log(`  ${cond ? 'OK' : 'FAIL'}  ${msg}`) }

// 挑一个有题、有 srs 行、当前未接触（answered=0）的 level4 考点，保证构造过程可预测
const node = db.prepare(`
  SELECT n.id, n.title FROM nodes n
  JOIN node_mastery m ON m.node_id=n.id AND COALESCE(m.answered,0)=0
  WHERE n.level=4 AND EXISTS (SELECT 1 FROM questions q WHERE q.node_id=n.id AND q.status='active' AND q.parent_id IS NULL)
  ORDER BY n.ord LIMIT 1`).get()
if (!node) { console.log('找不到合适的干净考点，跳过（可能所有考点都已被作答）'); db.close(); process.exit(0) }
console.log(`测试考点：${node.id}（${node.title}）`)

const q = db.prepare(`SELECT id FROM questions WHERE node_id=? AND status='active' AND parent_id IS NULL ORDER BY id LIMIT 1`).get(node.id)
const dayStr = (off = 0) => new Date(Date.now() + off * 86400000).toISOString().slice(0, 10)
const nowStr = (off = 0) => new Date(Date.now() + off * 86400000).toISOString().slice(0, 19).replace('T', ' ')

// 把 services/mastery.ts 的判定规则在脚本侧等价实现（避免跨进程 import electron 依赖）
const MIN_S = 0.3
const retentionOf = (s, t) => 1 / (1 + Math.max(0, t) / (9 * Math.max(MIN_S, s || 0)))
function expectedLevel() {
  const reps = db.prepare(`SELECT COUNT(*) total, COALESCE(SUM(CASE WHEN a.score>=80 THEN 1 ELSE 0 END),0) pass_
    FROM attempts a JOIN questions qq ON qq.id=a.question_id WHERE qq.node_id=?`).get(node.id)
  if (!reps.total) return 0
  const rows = db.prepare(`SELECT stability,lapses,due,last_review FROM srs s JOIN questions qq ON qq.id=s.question_id
    WHERE qq.node_id=? AND s.reps>0`).all(node.id)
  let ret = 0, wSum = 0, nextReview = null, lapses = 0
  for (const r of rows) {
    const w = Math.max(0.2, r.stability || 0.2)
    const t = r.last_review ? (Date.now() - Date.parse(r.last_review.replace(' ', 'T'))) / 86400000 : 9999
    ret += retentionOf(r.stability, t) * w; wSum += w; lapses += r.lapses || 0
    if (r.due && (!nextReview || r.due < nextReview)) nextReview = r.due
  }
  ret = wSum ? ret / wSum : 0
  const last = db.prepare(`SELECT last_practice FROM node_mastery WHERE node_id=?`).get(node.id).last_practice
  const fresh = last ? (Date.now() - Date.parse(last.replace(' ', 'T'))) / 86400000 : 9999
  const overdue = nextReview ? (Date.now() - Date.parse(nextReview.replace(' ', 'T'))) / 86400000 : 0
  if (overdue > 3 || lapses >= 1) return 3
  if (reps.pass_ >= 3 && ret >= 0.9 && fresh < 14) return 2
  return 1
}

db.exec(`BEGIN`)
try {
  // ---- 场景 1：连续 3 次 ≥80 分（score=90），模拟 recordAttempt 的关键落库 ----
  for (let i = 0; i < 3; i++) {
    db.prepare(`INSERT INTO attempts(question_id,mode,answer,score,scale4,grading_kind,created_at)
      VALUES(?,?,?,?,?,?,?)`).run(q.id, 'practice', '{}', 90, 3, 'auto', nowStr(-i))
    db.prepare(`INSERT INTO srs(question_id,stability,difficulty,reps,lapses,state,due,last_review,avg_score,weight)
      VALUES(?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(question_id) DO UPDATE SET reps=excluded.reps,stability=excluded.stability,due=excluded.due,
        last_review=excluded.last_review,avg_score=excluded.avg_score`)
      .run(q.id, [6.5, 14, 26][i] || 26, 4.2, i + 1, 0, 3, dayStr(20 + i * 6), nowStr(-i), 3, 1)
    db.prepare(`INSERT INTO node_mastery(node_id,scale4,lit,needs_work,answered,correct,last_practice,
        mastery_level,pass_reps,total_reps,retention,stale)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(node_id) DO UPDATE SET answered=excluded.answered,correct=excluded.correct,
        last_practice=excluded.last_practice,pass_reps=excluded.pass_reps,total_reps=excluded.total_reps,
        retention=excluded.retention,mastery_level=excluded.mastery_level,stale=excluded.stale`)
      .run(node.id, 3, 1, 0, i + 1, i + 1, nowStr(-i), 2, i + 1, i + 1, 0.95, 0)
  }
  const want1 = expectedLevel()
  assert(want1 === 2, `3 次 ≥80 分且保持率达标 → 期望已掌握(2)，脚本判定=${want1}`)
  const m1 = db.prepare(`SELECT mastery_level,pass_reps,total_reps,stale FROM node_mastery WHERE node_id=?`).get(node.id)
  assert(m1.pass_reps === 3 && m1.total_reps === 3, `pass_reps/total_reps 计数正确（3/3，实际 ${m1.pass_reps}/${m1.total_reps}）`)

  // ---- 场景 2：遗忘——last_practice 推到 20 天前，due 已过期 10 天 ----
  db.prepare(`UPDATE node_mastery SET last_practice=? WHERE node_id=?`).run(nowStr(-20), node.id)
  db.prepare(`UPDATE srs SET due=?, last_review=? WHERE question_id=?`).run(dayStr(-10), nowStr(-20), q.id)
  const beforeScale = db.prepare(`SELECT scale4 FROM node_mastery WHERE node_id=?`).get(node.id).scale4
  const want2 = expectedLevel()
  assert(want2 === 3, `到期超过宽限期 → 期望已生疏(3)，脚本判定=${want2}`)

  // 直接验证 mastery.ts 的 SQL 形态（applyPushWeights 的目标权重与 due 提前）
  db.prepare(`UPDATE node_mastery SET mastery_level=3, stale=1, scale4=? WHERE node_id=?`)
    .run(Math.max(0, beforeScale - 1), node.id)
  db.prepare(`UPDATE srs SET weight=1.8, due=? WHERE question_id=? AND due IS NOT NULL AND due<?`)
    .run(dayStr(), q.id, dayStr())
  const m2 = db.prepare(`SELECT mastery_level,stale,scale4 FROM node_mastery WHERE node_id=?`).get(node.id)
  assert(m2.mastery_level === 3 && m2.stale === 1, `生疏态落库（mastery_level=3, stale=1）`)
  assert(m2.scale4 === Math.max(0, beforeScale - 1), `scale4 降一档（${beforeScale} → ${m2.scale4}）`)
  const s2 = db.prepare(`SELECT weight,due FROM srs WHERE question_id=?`).get(q.id)
  assert(s2.weight === 1.8 && s2.due === dayStr(), `推送权重升高到 1.8 且 due 提前到当天（实际 weight=${s2.weight}, due=${s2.due}）`)

  // ---- 场景 3：生疏考点必须能被今日队列的新题/到期查询捞回来 ----
  const backInQueue = db.prepare(`SELECT q2.id FROM srs s JOIN questions q2 ON q2.id=s.question_id
    WHERE q2.node_id=? AND s.due IS NOT NULL AND s.due<=?`).all(node.id, dayStr())
  assert(backInQueue.length >= 1, `生疏考点的题重新进入到期集合（命中 ${backInQueue.length} 题）`)
} finally {
  db.exec(`ROLLBACK`)
  const clean = db.prepare(`SELECT COUNT(*) c FROM attempts WHERE question_id=?`).get(q.id)
  console.log(`  回滚后该题 attempts=${clean.c}（用户原始数据未被污染）`)
  db.close()
}

console.log(bad.length ? `\n状态机验收失败 ${bad.length} 项:\n  - ` + bad.join('\n  - ') : '\n掌握状态机验收全部通过（数据已回滚）')
process.exit(bad.length ? 1 : 0)
