import { all, get, run } from '../db'
import type { GraphNode } from '../../shared/types'

const dayStr = () => new Date().toISOString().slice(0, 10)

/** 读全部节点并附带掌握度/题量/到期数（一次查询，图谱与面板共用） */
export function loadNodes(domain?: string): GraphNode[] {
  const dom = domain && domain !== 'all' ? 'WHERE n.domain=?' : ''
  const params = domain && domain !== 'all' ? [domain] : []
  return all<GraphNode & { q_total: number; q_done: number; q_due: number }>(
    `SELECT n.*, COALESCE(m.scale4,0) scale4, COALESCE(m.lit,0) lit, COALESCE(m.needs_work,0) needs_work,
       COALESCE(m.answered,0) answered, COALESCE(m.correct,0) correct, COALESCE(m.forced_unlock,0) forced_unlock,
       (SELECT COUNT(*) FROM questions q WHERE q.node_id=n.id AND q.status='active') q_total,
       (SELECT COUNT(DISTINCT a.question_id) FROM attempts a JOIN questions q2 ON q2.id=a.question_id
          WHERE q2.node_id=n.id) q_done,
       (SELECT COUNT(*) FROM srs s JOIN questions q3 ON q3.id=s.question_id
          WHERE q3.node_id=n.id AND s.due IS NOT NULL AND s.due<=?) q_due
     FROM nodes n LEFT JOIN node_mastery m ON m.node_id=n.id
     ${dom}
     ORDER BY n.ord`, [dayStr(), ...params]
  ).map((r) => ({
    ...r, qTotal: r.q_total, qDone: r.q_done, qDue: r.q_due, locked: 0, children: []
  }))
}

/** 前置依赖解锁计算：所有前置点亮（或手动强制解锁）才开放 */
export function applyUnlock(nodes: GraphNode[]): GraphNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const memo = new Map<string, boolean>()
  const prereqs = new Map<string, string[]>()
  for (const row of all<{ to_id: string; from_id: string }>(`SELECT to_id,from_id FROM edges WHERE type='prereq'`)) {
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

/** 图谱边（供 Vue Flow 画依赖线）：只画已存在节点之间的关系 */
export function graphEdges(domain?: string): { from: string; to: string; type: string }[] {
  const ids = new Set(loadNodes(domain).map((n) => n.id))
  return all<{ from_id: string; to_id: string; type: string }>(`SELECT from_id,to_id,type FROM edges`)
    .filter((e) => ids.has(e.from_id) && ids.has(e.to_id) && e.type !== 'contains')
    .map((e) => ({ from: e.from_id, to: e.to_id, type: e.type }))
}

export interface NodeDetail {
  node: GraphNode
  prerequisites: { id: string; title: string; lit: number }[]
  dependents: { id: string; title: string; lit: number }[]
  related: { id: string; title: string }[]
  questions: { id: string; type: string; difficulty: number; stem: string; parentId: string | null; angle: string | null; answered: number; bestPct: number | null; due: string | null }[]
  advice: string
}

export function nodeDetail(nodeId: string): NodeDetail | null {
  const nodes = applyUnlock(loadNodes())
  const node = nodes.find((n) => n.id === nodeId)
  if (!node) return null
  const titleOf = (id: string) => nodes.find((n) => n.id === id)?.title ?? id
  const litOf = (id: string) => nodes.find((n) => n.id === id)?.lit ?? 0
  const pres = all<{ from_id: string }>(`SELECT from_id FROM edges WHERE to_id=? AND type='prereq'`, [nodeId])
  const deps = all<{ to_id: string }>(`SELECT to_id FROM edges WHERE from_id=? AND type='prereq'`, [nodeId])
  const rel = all<{ to_id: string }>(`SELECT to_id FROM edges WHERE from_id=? AND type='related'`, [nodeId])
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
    prerequisites: pres.map((p) => ({ id: p.from_id, title: titleOf(p.from_id), lit: litOf(p.from_id) })),
    dependents: deps.map((d) => ({ id: d.to_id, title: titleOf(d.to_id), lit: litOf(d.to_id) })),
    related: rel.map((r) => ({ id: r.to_id, title: titleOf(r.to_id) })),
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
