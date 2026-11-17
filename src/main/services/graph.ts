import { all, get, run } from '../db'
import { recomputeAllTouched } from './mastery'
import { GATE_TYPES, RELATION_ORDER, RELATION_META, type RelationType } from '../../shared/relations'
import type { GraphNode, NodeDetail, NodeRelation, NodeRelationGroup } from '../../shared/types'

const dayStr = () => new Date().toISOString().slice(0, 10)

/** 读全部节点并附带掌握度/题量/到期数（一次查询，图谱与面板共用） */
export function loadNodes(domain?: string): GraphNode[] {
  const dom = domain && domain !== 'all' ? 'WHERE n.domain=?' : ''
  const params = domain && domain !== 'all' ? [domain] : []
  const rows = all<GraphNode & { q_total: number; q_done: number; q_due: number }>(
    `SELECT n.*, COALESCE(m.scale4,0) scale4, COALESCE(m.lit,0) lit, COALESCE(m.needs_work,0) needs_work,
       COALESCE(m.answered,0) answered, COALESCE(m.correct,0) correct, COALESCE(m.forced_unlock,0) forced_unlock,
       -- 四态掌握状态（services/mastery.ts 聚合判定）：未接触/学习中/已掌握/已生疏，图谱按此着色
       COALESCE(m.mastery_level,0) mastery_level, COALESCE(m.stale,0) stale, COALESCE(m.retention,0) retention,
       COALESCE(m.pass_reps,0) pass_reps, COALESCE(m.total_reps,0) total_reps, COALESCE(m.lapses,0) lapses, m.next_review,
       (SELECT COUNT(*) FROM questions q WHERE q.node_id=n.id AND q.status='active') q_total,
       (SELECT COUNT(DISTINCT a.question_id) FROM attempts a JOIN questions q2 ON q2.id=a.question_id
          WHERE q2.node_id=n.id) q_done,
       (SELECT COUNT(*) FROM srs s JOIN questions q3 ON q3.id=s.question_id
          WHERE q3.node_id=n.id AND s.due IS NOT NULL AND s.due<=?) q_due
     FROM nodes n LEFT JOIN node_mastery m ON m.node_id=n.id
     ${dom}
     ORDER BY n.ord`, [dayStr(), ...params]
  )
  // 节点权重取其题目 srs.weight 均值（一次聚合，避免 N+1）；无题节点默认 1
  const weightMap = new Map(all<{ node_id: string; w: number }>(
    `SELECT q.node_id, AVG(s.weight) w FROM srs s JOIN questions q ON q.id=s.question_id GROUP BY q.node_id`)
    .map((r) => [r.node_id, r.w]))
  return rows.map((r) => ({
    ...r, qTotal: r.q_total, qDone: r.q_done, qDue: r.q_due,
    masteryLevel: r.mastery_level, totalReps: r.total_reps, passReps: r.pass_reps, locked: 0,
    weight: weightMap.get(r.id) ?? 1,
    children: []
  }))
}

/**
 * 解锁计算：只有 advance（学习顺序的前置台阶）构成硬锁。
 * depend（理解地基）跨模块时可能反向指向后学概念（如入门 HTML 关被 browser/js 节点声明为地基），
 * 若也参与硬锁会把零前置的入门关卡死——因此 depend 只在抽屉里做「地基缺失」提示，不锁人。
 */
export function applyUnlock(nodes: GraphNode[]): GraphNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const memo = new Map<string, boolean>()
  const prereqs = new Map<string, string[]>()
  for (const row of all<{ to_id: string; from_id: string }>(
    `SELECT to_id,from_id FROM edges WHERE type='advance'`)) {
    const arr = prereqs.get(row.to_id) ?? []
    arr.push(row.from_id)
    prereqs.set(row.to_id, arr)
  }
  const isOpen = (id: string, seen = new Set<string>()): boolean => {
    if (memo.has(id)) return memo.get(id)!
    if (seen.has(id)) return true          // 环防御
    seen.add(id)
    const n = byId.get(id)
    if (!n) return true
    if (n.level <= 2 || n.forced_unlock === 1) { memo.set(id, true); return true }
    const pres = prereqs.get(id) ?? []
    if (!pres.length) { memo.set(id, true); return true }
    const ok = pres.every((p) => {
      const pn = byId.get(p)
      if (!pn) return true                 // 前置不在本视图（跨板块）时不设卡
      if (pn.lit === 1 || pn.forced_unlock === 1) return true
      // 前置已经练过却没点亮：先把前置补上，暂时不放开后继（与组卷 SQL 的判定保持一致）
      if ((pn.answered ?? 0) > 0) return false
      return isOpen(p, seen)
    })
    memo.set(id, ok)
    return ok
  }
  for (const n of nodes) n.locked = n.lit === 1 ? 0 : isOpen(n.id) ? 0 : 1
  return nodes
}

export function graphTree(domain?: string): GraphNode[] {
  // 打开图谱时先刷新一次四态：遗忘是在时间中发生的（到期未复习就该当场变成「已生疏」），
  // 只靠提交作答时重算会让图谱滞后。只对做过的考点跑，未接触的不产生查询。
  try { recomputeAllTouched(600) } catch (e) { console.warn('[graph] 掌握状态重算失败：', e) }
  const nodes = applyUnlock(loadNodes(domain))
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const roots: GraphNode[] = []
  for (const n of nodes) {
    const p = n.parent && byId.has(n.parent) ? byId.get(n.parent)! : null
    if (p) (p.children ??= []).push(n)
    else roots.push(n)
  }
  return roots
}

/** 图谱边（供 Vue Flow 画关系线）：返回 9 类语义边，附带 note；contains 结构边不画 */
export function graphEdges(domain?: string): { from: string; to: string; type: RelationType; note: string | null }[] {
  const ids = new Set(loadNodes(domain).map((n) => n.id))
  return all<{ from_id: string; to_id: string; type: RelationType; note: string | null }>(
    `SELECT from_id,to_id,type,note FROM edges WHERE type != 'contains'`)
    .filter((e) => ids.has(e.from_id) && ids.has(e.to_id))
    .map((e) => ({ from: e.from_id, to: e.to_id, type: e.type, note: e.note }))
}

export function nodeDetail(nodeId: string): NodeDetail | null {
  const nodes = applyUnlock(loadNodes())
  const node = nodes.find((n) => n.id === nodeId)
  if (!node) return null
  const titleOf = (id: string) => nodes.find((n) => n.id === id)?.title ?? id
  const litOf = (id: string) => nodes.find((n) => n.id === id)?.lit ?? 0

  // 一度关系：同时拉出入边和出边（无向边存储已规范化为字典序，两个方向都要查）
  interface RelRow { other: string; type: RelationType; dir: 'out' | 'in'; note: string | null }
  const rows: RelRow[] = []
  const outRows = all<{ to_id: string; type: RelationType; note: string | null }>(
    `SELECT to_id,type,note FROM edges WHERE from_id=? AND type != 'contains'`, [nodeId])
  for (const r of outRows) rows.push({ other: r.to_id, type: r.type, dir: 'out', note: r.note })
  const inRows = all<{ from_id: string; type: RelationType; note: string | null }>(
    `SELECT from_id,type,note FROM edges WHERE to_id=? AND type != 'contains'`, [nodeId])
  for (const r of inRows) rows.push({ other: r.from_id, type: r.type, dir: 'in', note: r.note })

  // 按 9 类归组成叙事小节（RELATION_ORDER 决定抽屉里的排列顺序）
  const buckets = new Map<RelationType, NodeRelation[]>()
  const seenPair = new Set<string>()
  for (const r of rows) {
    const pairKey = `${r.type}␟${r.other}`
    if (seenPair.has(pairKey)) continue      // 无向边字典序规范化后仍可能与入边重复，去重
    seenPair.add(pairKey)
    const arr = buckets.get(r.type) ?? []
    arr.push({ id: r.other, title: titleOf(r.other), type: r.type, dir: r.dir, lit: litOf(r.other), note: r.note })
    buckets.set(r.type, arr)
  }
  const relationGroups: NodeRelationGroup[] = RELATION_ORDER
    .filter((t) => buckets.has(t))
    .map((t) => ({
      type: t, label: RELATION_META[t].label, directed: RELATION_META[t].directed,
      items: (buckets.get(t) ?? []).sort((a, b) => a.lit - b.lit || a.title.localeCompare(b.title))
    }))

  // 兼容字段：门槛边（advance/depend）的入侧=前置，出侧=解锁后继；无向邻居并入 related
  const gateIn = rows.filter((r) => GATE_TYPES.includes(r.type) && r.dir === 'in')
  const gateOut = rows.filter((r) => GATE_TYPES.includes(r.type) && r.dir === 'out')
  const undirected = rows.filter((r) => !RELATION_META[r.type].directed)
  const questions = all<{ id: string; type: string; difficulty: number; data: string; parent_id: string | null; angle: string | null; answered: number; best: number | null; due: string | null }>(
    `SELECT q.id,q.type,q.difficulty,q.data,q.parent_id,q.angle,
       (SELECT COUNT(*) FROM attempts a WHERE a.question_id=q.id) answered,
       (SELECT MAX(a.score) FROM attempts a WHERE a.question_id=q.id) best,
       (SELECT s.due FROM srs s WHERE s.question_id=q.id) due
     FROM questions q WHERE q.node_id=? AND q.status='active' ORDER BY q.difficulty,q.id`, [nodeId])
    .map((q) => {
      let stem = ''
      try { stem = (JSON.parse(q.data)?.stem ?? '').slice(0, 120) } catch { /* ignore */ }
      return { id: q.id, type: q.type, difficulty: q.difficulty, stem, parentId: q.parent_id, angle: q.angle, answered: q.answered, bestPct: q.best, due: q.due }
    })
  let advice = ''
  if (node.must_master && !node.lit) advice = '这是强制掌握节点，面试硬基础，建议优先补齐。'
  else if (node.needs_work) advice = '已作答但未达点亮阈值，先读解析与查漏补缺，再做该节点的变体题。'
  else if (!node.answered) advice = node.locked ? '前置未点亮，暂锁定；如已掌握可在节点面板手动解锁。' : '尚未接触，可直接开练。'
  else advice = '已点亮。保持间隔重复即可，可尝试更高难度与追问型变体。'
  return {
    node,
    relationGroups,
    prerequisites: gateIn.map((r) => ({ id: r.other, title: titleOf(r.other), lit: litOf(r.other) })),
    dependents: gateOut.map((r) => ({ id: r.other, title: titleOf(r.other), lit: litOf(r.other) })),
    related: [...new Set(undirected.map((r) => r.other))].map((id) => ({ id, title: titleOf(id) })),
    questions,
    advice
  }
}

export function setForceUnlock(nodeId: string, on: boolean) {
  run(`INSERT INTO node_mastery(node_id,forced_unlock) VALUES(?,?)
       ON CONFLICT(node_id) DO UPDATE SET forced_unlock=excluded.forced_unlock`, [nodeId, on ? 1 : 0])
}

export function mustMasterGap() {
  const total = get<{ n: number }>(`SELECT COUNT(*) n FROM nodes WHERE must_master=1 AND level=4`)?.n ?? 0
  const lit = get<{ n: number }>(`SELECT COUNT(*) n FROM nodes n LEFT JOIN node_mastery m ON m.node_id=n.id
    WHERE n.must_master=1 AND n.level=4 AND COALESCE(m.lit,0)=1`)?.n ?? 0
  return { total, lit, gap: Math.max(0, total - lit) }
}
