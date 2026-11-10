import { all, get, run, settingGet } from '../db'
import { scale4ToPct } from '../../shared/schema.mjs'
import type { QuestionRow } from '../../shared/types'

/**
 * FSRS-lite 间隔重复调度。
 * 语义与 playbook 的 study-progress.json 对齐：score(0-3) / stage / reviews / due。
 * 参数可在设置里调（desiredRetention、globalMixRatio、每节点 weight）。
 */
export const FSRS_W = {
  s0: [0.4, 0.9, 2.6, 6.5],        // 四档对应的初始稳定性（天）
  d0: [5.5, 5.0, 4.2, 3.0],        // 四档对应的初始难度
  failFactor: 0.35,                 // 忘记后稳定性衰减
  minS: 0.3,
  maxS: 3650
}

const nowStr = () => new Date().toISOString().slice(0, 19).replace('T', ' ')
const dayStr = (d = new Date()) => d.toISOString().slice(0, 10)
const addDays = (days: number) => dayStr(new Date(Date.now() + Math.round(days) * 86400000))

export function desiredRetention(): number {
  const v = settingGet<number>('srs.desiredRetention')
  return typeof v === 'number' && v >= 0.7 && v <= 0.99 ? v : 0.9
}
export function globalMixRatio(): number {
  const v = settingGet<number>('srs.globalMixRatio')
  return typeof v === 'number' && v >= 0 && v <= 1 ? v : 0.35
}

function intervalOf(stability: number): number {
  const r = desiredRetention()
  const days = stability * (Math.log(r) / Math.log(0.9))
  return Math.max(1, Math.min(FSRS_W.maxS, Math.round(days)))
}

/** 提交一次作答：写流水、更新 SRS、重算该知识点掌握度 */
export function recordAttempt(input: {
  qid: string
  mode: 'practice' | 'exam' | 'placement'
  answer?: unknown
  scale4: number
  gradingKind: 'auto' | 'ai' | 'self'
  examId?: string | null
  model?: string | null
  tokens?: number
  ms?: number
  wrongPoints?: unknown
  feedback?: unknown
}): { pct: number; scale4: number } {
  const scale4 = Math.max(0, Math.min(3, Math.round(input.scale4 ?? 0)))
  const pct = scale4ToPct(scale4, 1)
  const partial = input.scale4 != null ? Math.max(0, Math.min(1, Number(input.scale4) - scale4 + 0.0)) : 0
  const shownPct = input.gradingKind === 'self' && input.scale4 != null ? Math.round(Number(input.scale4)) >= 3 ? 100 : pct : pct

  run(`INSERT INTO attempts(question_id,exam_id,mode,answer,score,scale4,grading_kind,ai_model,tokens,ms,wrong_points,feedback,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [input.qid, input.examId ?? null, input.mode, JSON.stringify(input.answer ?? null), shownPct, scale4,
      input.gradingKind, input.model ?? null, input.tokens ?? 0, input.ms ?? 0,
      JSON.stringify(input.wrongPoints ?? null), JSON.stringify(input.feedback ?? null), nowStr()])

  updateSrs(input.qid, scale4)
  updateMastery(input.qid, scale4)
  return { pct: shownPct, scale4 }
}

function updateSrs(qid: string, scale4: number) {
  const cur = get<{ stability: number; difficulty: number; reps: number; lapses: number; state: number; avg_score: number; weight: number }>(
    `SELECT stability,difficulty,reps,lapses,state,avg_score,weight FROM srs WHERE question_id=?`, [qid])
  const w = FSRS_W
  if (!cur || cur.reps === 0) {
    const s = w.s0[scale4]
    const d = w.d0[scale4]
    run(`INSERT INTO srs(question_id,stability,difficulty,reps,lapses,state,due,last_review,avg_score)
         VALUES(?,?,?,?,?,?,?,?,?)
         ON CONFLICT(question_id) DO UPDATE SET stability=excluded.stability,difficulty=excluded.difficulty,
           reps=excluded.reps,state=excluded.state,due=excluded.due,last_review=excluded.last_review,avg_score=excluded.avg_score`,
      [qid, s, d, 1, scale4 === 0 ? 1 : 0, scale4 === 0 ? 1 : 2, addDays(intervalOf(s)), nowStr(), scale4])
    return
  }
  const failed = scale4 === 0
  const stability = failed
    ? Math.max(w.minS, cur.stability * w.failFactor)
    : Math.min(w.maxS, cur.stability * (1 + Math.exp(0.9) * (11 - cur.difficulty) * Math.pow(cur.stability, -0.5) * (scale4 === 3 ? 1.3 : scale4 === 1 ? 0.75 : 1)))
  const difficulty = Math.max(1, Math.min(10, cur.difficulty + (scale4 - 2) * 0.35))
  const avg = (cur.avg_score * cur.reps + scale4) / (cur.reps + 1)
  run(`UPDATE srs SET stability=?,difficulty=?,reps=reps+1,lapses=lapses+?,state=?,due=?,last_review=?,avg_score=?
       WHERE question_id=?`,
    [stability, difficulty, failed ? 1 : 0, failed ? 1 : 3, addDays(intervalOf(stability)), nowStr(), avg, qid])
}

/** 知识点掌握度：加权移动平均，需连续表现才点亮（防蒙对） */
function updateMastery(qid: string, scale4: number) {
  const q = get<{ node_id: string }>(`SELECT node_id FROM questions WHERE id=?`, [qid])
  if (!q) return
  const node = get<{ threshold: number }>(`SELECT threshold FROM nodes WHERE id=?`, [q.node_id])
  const th = node?.threshold ?? 2
  const cur = get<{ scale4: number; answered: number; correct: number; lit: number }>(
    `SELECT scale4,answered,correct,lit FROM node_mastery WHERE node_id=?`, [q.node_id])
  const prev = cur?.scale4 ?? 0
  const answered = (cur?.answered ?? 0) + 1
  const correct = (cur?.correct ?? 0) + (scale4 >= th ? 1 : 0)
  const alpha = answered === 1 ? 0.75 : 0.4
  const next = prev * (1 - alpha) + scale4 * alpha
  const recent = all<{ scale4: number }>(`SELECT scale4 FROM attempts WHERE question_id IN
      (SELECT id FROM questions WHERE node_id=?) ORDER BY id DESC LIMIT 2`, [q.node_id])
  const lastGood = recent && recent.length >= 2 && recent.some((r) => r.scale4 >= th)
  const lit = next >= th && answered >= 2 && lastGood ? 1 : 0
  run(`INSERT INTO node_mastery(node_id,scale4,lit,needs_work,answered,correct,last_practice)
       VALUES(?,?,?,?,?,?,?)
       ON CONFLICT(node_id) DO UPDATE SET scale4=excluded.scale4,lit=excluded.lit,needs_work=excluded.needs_work,
         answered=excluded.answered,correct=excluded.correct,last_practice=excluded.last_practice`,
    [q.node_id, next, lit, answered > 0 && !lit ? 1 : 0, answered, correct, nowStr()])
}

// ---------------- 队列与到期 ----------------

export const todayDueCount = (): number =>
  (get<{ n: number }>(`SELECT COUNT(*) n FROM srs WHERE due IS NOT NULL AND due<=? AND state>=0`, [dayStr()])?.n ?? 0)

export function dueQuestionIds(limit = 50): string[] {
  const rows = all<{ id: string }>(`SELECT q.id FROM srs s JOIN questions q ON q.id=s.question_id
    WHERE q.status='active' AND s.due IS NOT NULL AND s.due<=?
    ORDER BY s.weight DESC, s.due ASC, s.avg_score ASC LIMIT ?`, [dayStr(), limit])
  return rows.map((r) => r.id)
}

/** 已通过知识点的旧题（用于巩固混入），按薄弱程度排序 */
export function reviewCandidateIds(limit = 30, domains: string[] = []): string[] {
  const dom = domains.length ? `AND substr(q.node_id,1,instr(q.node_id,'.')-1) IN (${domains.map(() => '?').join(',')})` : ''
  const rows = all<{ id: string }>(`SELECT q.id FROM questions q
    JOIN node_mastery m ON m.node_id=q.node_id
    WHERE q.status='active' AND q.parent_id IS NULL AND m.lit=1 ${dom}
    ORDER BY m.scale4 ASC, (SELECT MAX(id) FROM attempts a WHERE a.question_id=q.id) ASC
    LIMIT ?`, [...(domains.length ? domains : []), limit])
  return rows.map((r) => r.id)
}

/** 某节点的变体题（预生成优先，取未做过的） */
export function variantIdsOfNode(nodeId: string, exclude: string[] = [], limit = 3): string[] {
  const ex = exclude.length ? `AND q.id NOT IN (${exclude.map(() => '?').join(',')})` : ''
  const rows = all<{ id: string }>(`SELECT q.id FROM questions q
    WHERE q.parent_id IS NOT NULL AND q.node_id=? AND q.status='active' ${ex}
    ORDER BY (SELECT COUNT(*) FROM attempts a WHERE a.question_id=q.id) ASC, q.id LIMIT ?`,
    [nodeId, ...exclude, limit])
  return rows.map((r) => r.id)
}

export function setNodeWeight(nodeId: string, weight: number) {
  const w = Math.max(0, Math.min(3, weight))
  run(`UPDATE srs SET weight=? WHERE question_id IN (SELECT id FROM questions WHERE node_id=?)`, [w, nodeId])
}

export function hydrateQuestions(ids: string[]): QuestionRow[] {
  if (!ids.length) return []
  const ph = ids.map(() => '?').join(',')
  const rows = all<QuestionRow>(`SELECT q.*, n.title nodeTitle, m.lit mastery_lit, m.needs_work mastery_needs, m.scale4 mastery_scale
    FROM questions q LEFT JOIN nodes n ON n.id=q.node_id
    LEFT JOIN node_mastery m ON m.node_id=q.node_id
    WHERE q.id IN (${ph})`, ids)
  return rows.map((r) => ({ ...r, q: safeParse(r.data) }))
}
export function safeParse(s: string): any { try { return JSON.parse(s) } catch { return {} } }
