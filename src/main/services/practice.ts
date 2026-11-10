import { all, get, run, settingGet } from '../db'
import { applyUnlock, loadNodes } from './graph'
import { dueQuestionIds, reviewCandidateIds, variantIdsOfNode, hydrateQuestions, recordAttempt, globalMixRatio, todayDueCount } from './srs'
import { gradeAnswer, selfGrade, questionOf, textOf } from './grading'
import { NoEndpoint } from '../ai/gateway'
import type { QuestionRow, GradeResult } from '../../shared/types'

/**
 * 练习引擎：组队列（到期复习 + 薄弱变体混入 + 新题）、提交判分、解锁校验。
 */

export interface PracticeSpec {
  domains?: string[]
  stacks?: string[]
  nodeIds?: string[]
  count?: number
  includeDue?: boolean
  mixReviewRatio?: number
  allowLocked?: boolean
  types?: string[]
  difficulties?: number[]
  onlyUnanswered?: boolean
}

const dayStr = () => new Date().toISOString().slice(0, 10)

export function buildQueue(spec: PracticeSpec): QuestionRow[] {
  const count = Math.max(1, Math.min(100, spec.count ?? 10))
  const ratio = spec.mixReviewRatio ?? globalMixRatio()
  const domains = spec.domains ?? []
  const chosen: string[] = []
  const seen = new Set<string>()
  const push = (ids: string[]) => { for (const id of ids) { if (!seen.has(id) && chosen.length < count) { seen.add(id); chosen.push(id) } } }

  // 1) 到期复习优先
  if (spec.includeDue !== false) push(dueQuestionIds(Math.ceil(count * 0.5)))

  // 2) 已点亮知识点的变体题（巩固主力，绝不与原题相同）
  const reviewTarget = Math.floor(count * ratio)
  if (reviewTarget > 0) {
    const litNodes = all<{ id: string }>(
      `SELECT n.id FROM nodes n JOIN node_mastery m ON m.node_id=n.id
       WHERE n.level=4 AND m.lit=1 ${domains.length ? `AND substr(n.id,1,instr(n.id,'.')-1) IN (${domains.map(() => '?').join(',')})` : ''}
       ORDER BY m.scale4 ASC, RANDOM() LIMIT 20`, domains)
    const vars: string[] = []
    for (const n of litNodes) {
      if (vars.length >= reviewTarget) break
      vars.push(...variantIdsOfNode(n.id, chosen, 2))
    }
    push(vars.slice(0, reviewTarget))
    if (vars.length < reviewTarget) push(reviewCandidateIds(reviewTarget - vars.length, domains))
  }

  // 3) 新题补足（只做未答过的、且前置已解锁）
  if (chosen.length < count) {
    const rest = fetchNew(chosen, spec, count - chosen.length)
    push(rest)
  }
  // 4) 兜底：新题不足（例如某板块还没铺题）就不再限制
  if (chosen.length < count) push(fetchNew(chosen, { ...spec, allowLocked: true, onlyUnanswered: false }, count - chosen.length))

  const rows = hydrateQuestions(chosen)
  const order = new Map(chosen.map((id, i) => [id, i]))
  return rows.sort((a, b) => (order.get(a.id)! - order.get(b.id)!))
}

function fetchNew(exclude: string[], spec: PracticeSpec, limit: number): string[] {
  const where = [`q.status='active'`, `q.parent_id IS NULL`]
  const params: unknown[] = []
  const dom = spec.domains ?? []
  if (dom.length) { where.push(`substr(q.node_id,1,instr(q.node_id,'.')-1) IN (${dom.map(() => '?').join(',')})`); params.push(...dom) }
  if (spec.nodeIds?.length) { where.push(`q.node_id IN (${spec.nodeIds.map(() => '?').join(',')})`); params.push(...spec.nodeIds) }
  if (spec.types?.length) { where.push(`q.type IN (${spec.types.map(() => '?').join(',')})`); params.push(...spec.types) }
  if (spec.difficulties?.length) { where.push(`q.difficulty IN (${spec.difficulties.map(() => '?').join(',')})`); params.push(...spec.difficulties) }
  if (spec.onlyUnanswered !== false) where.push(`NOT EXISTS (SELECT 1 FROM attempts a WHERE a.question_id=q.id)`)
  if (exclude.length) { where.push(`q.id NOT IN (${exclude.map(() => '?').join(',')})`); params.push(...exclude) }
  if (!spec.allowLocked) where.push(`(COALESCE(m.forced_unlock,0)=1 OR COALESCE(p.blocked,0)=0)`)
  params.push(limit)
  return all<{ id: string }>(
    `SELECT q.id FROM questions q
     LEFT JOIN node_mastery m ON m.node_id=q.node_id
     LEFT JOIN (
       SELECT n.id nid, CASE WHEN EXISTS (
         SELECT 1 FROM edges e JOIN node_mastery pm ON pm.node_id=e.from_id
         WHERE e.to_id=n.id AND e.type='prereq' AND COALESCE(pm.lit,0)=0 AND COALESCE(pm.forced_unlock,0)=0
       ) THEN 1 ELSE 0 END blocked FROM nodes n
     ) p ON p.nid=q.node_id
     WHERE ${where.join(' AND ')}
     ORDER BY q.difficulty ASC, RANDOM() LIMIT ?`, params).map((r) => r.id)
}

export interface SubmitResult { grade: GradeResult; unlockedNow?: { nodeId: string; title: string }[]; aiUnavailable?: string }

export async function submitPractice(qid: string, answer: unknown, opts: { endpointId?: string; selfScale4?: number; revealOnly?: boolean } = {}): Promise<SubmitResult> {
  const q = questionOf(qid)
  if (!q) throw new Error(`题目不存在：${qid}`)
  const before = litNodeIds()
  let grade: GradeResult
  try {
    grade = opts.selfScale4 != null ? selfGrade(q, opts.selfScale4) : await gradeAnswer(q, { qid, answer, mode: 'practice', endpointId: opts.endpointId })
  } catch (e: any) {
    if (e instanceof NoEndpoint || /端点|超时|HTTP|模型返回/.test(String(e?.message))) {
      grade = { qid, scale4: 0, pct: 0, gradingKind: 'self', error: String(e?.message ?? e), verdict: 'AI 不可用，已降级为自评/看答案' }
    } else throw e
  }
  if (!opts.revealOnly) {
    recordAttempt({ qid, mode: 'practice', answer, scale4: grade.scale4, gradingKind: grade.gradingKind, model: grade.model, tokens: grade.tokens, ms: grade.ms, wrongPoints: grade.missing, feedback: grade })
  }
  const after = litNodeIds()
  const fresh = [...after].filter((x) => !before.has(x))
  const unlockedNow = fresh.length
    ? all<{ nodeId: string; title: string }>(`SELECT id AS nodeId,title FROM nodes WHERE id IN (${fresh.map(() => '?').join(',')})`, [...fresh])
    : undefined
  return { grade, unlockedNow, aiUnavailable: grade.error }
}

function litNodeIds(): Set<string> {
  return new Set(all<{ node_id: string }>(`SELECT node_id FROM node_mastery WHERE lit=1`).map((r) => r.node_id))
}

export function practiceStats() {
  const total = get<{ n: number }>(`SELECT COUNT(*) n FROM questions WHERE status='active'`)?.n ?? 0
  const answered = get<{ n: number }>(`SELECT COUNT(DISTINCT question_id) n FROM attempts`)?.n ?? 0
  return { total, answered, remaining: Math.max(0, total - answered), dueNow: todayDueCount() }
}

export function answerHistory(qid: string, limit = 5) {
  return all(`SELECT id,score,scale4,grading_kind,ai_model,created_at,answer,wrong_points,feedback
    FROM attempts WHERE question_id=? ORDER BY id DESC LIMIT ?`, [qid, limit])
}

export function setPracticeSetting(key: 'mixRatio' | 'dailyTarget' | 'includeDue', value: number | boolean) {
  const map = { mixRatio: 'srs.globalMixRatio', dailyTarget: 'practice.dailyTarget', includeDue: 'practice.includeDue' } as const
  run(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    [map[key], JSON.stringify(value)])
}
export const dailyTarget = (): number => settingGet<number>('practice.dailyTarget') ?? 20
