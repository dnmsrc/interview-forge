import { randomUUID } from 'node:crypto'
import { all, get, run, tx, settingGet } from '../db'
import { hydrateQuestions, recordAttempt } from './srs'
import { gradeAnswer, questionOf } from './grading'
import { recordExam } from './game'
import { scale4ToPct } from '../../shared/schema.mjs'
import type { ExamSpec, ExamSummary, AiExamReport, QuestionRow } from '../../shared/types'

/**
 * 闭卷考试引擎：组卷、严格计时、草稿断点续存、一次性交卷 + AI 批改流水线。
 * 交卷后异步逐题批改，前端轮询 status 直到 done。
 */

const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ')

/** 预置模拟卷模板（可在设置页扩展，存 settings.exams.templates） */
export const BUILTIN_TEMPLATES: { id: string; title: string; spec: ExamSpec }[] = [
  { id: 'fe-sprint-45', title: '前端 45 分钟速测', spec: { domains: ['fe'], count: 20, minutes: 45, passLine: 60 } },
  { id: 'fullstack-180', title: '全栈综合模拟面（3 小时）', spec: { domains: ['fe', 'be', 'cs'], count: 60, minutes: 180, passLine: 60 } },
  { id: 'ai-agent-60', title: 'AI Agent 专项（60 分钟）', spec: { domains: ['ai'], count: 28, minutes: 60, passLine: 60 } },
  { id: 'basics-30', title: '硬基础体检（30 分钟）', spec: { domains: ['cs'], count: 15, minutes: 30, passLine: 65 } },
  { id: 'eng-warstory', title: '工程难题战例（40 分钟）', spec: { domains: ['eng'], types: ['short', 'essay', 'code'], count: 8, minutes: 40, passLine: 55 } }
]
export function templates() {
  const custom = settingGet<{ id: string; title: string; spec: ExamSpec }[]>('exams.templates') ?? []
  return [...BUILTIN_TEMPLATES, ...custom]
}

export function composePaper(spec: ExamSpec): string[] {
  const where = [`q.status='active'`, `q.parent_id IS NULL`]
  const params: unknown[] = []
  if (spec.domains?.length) { where.push(`substr(q.node_id,1,instr(q.node_id,'.')-1) IN (${spec.domains.map(() => '?').join(',')})`); params.push(...spec.domains) }
  if (spec.stacks?.length) { where.push(`q.node_id LIKE ?`, ...spec.stacks.map((s) => `${s}.%`)) }
  if (spec.types?.length) { where.push(`q.type IN (${spec.types.map(() => '?').join(',')})`); params.push(...spec.types) }
  if (spec.difficulties?.length) { where.push(`q.difficulty IN (${spec.difficulties.map(() => '?').join(',')})`); params.push(...spec.difficulties) }
  // 题型配额：保证选择/主观都有，按难度分层抽样
  const ids = all<{ id: string; type: string; difficulty: number }>(
    `SELECT q.id,q.type,q.difficulty FROM questions q WHERE ${where.join(' AND ')} ORDER BY RANDOM() LIMIT 400`, params)
  const quota = objectiveQuota(spec.count)
  const picked: string[] = []
  const byType = new Map<string, typeof ids>()
  for (const row of ids) {
    const isObj = ['single', 'multiple', 'judge', 'blank'].includes(row.type)
    const bucket = isObj ? 'objective' : row.type
    const arr = byType.get(bucket) ?? []
    arr.push(row)
    byType.set(bucket, arr)
  }
  const takeFrom = (bucket: string, n: number) => {
    const pool = byType.get(bucket) ?? []
    for (let i = 0; i < n && pool.length; i++) picked.push(pool.shift()!.id)
  }
  for (const [bucket, n] of Object.entries(quota)) takeFrom(bucket, n)
  const rest = [...byType.values()].flat().filter((r) => !picked.includes(r.id)).sort((a, b) => a.difficulty - b.difficulty)
  for (const r of rest) { if (picked.length >= spec.count) break; picked.push(r.id) }
  return picked.slice(0, spec.count).sort(() => Math.random() - 0.5)
}

function objectiveQuota(count: number): Record<string, number> {
  const o = Math.round(count * 0.5)
  const s = Math.round(count * 0.25)
  const e = Math.max(0, count - o - s - Math.round(count * 0.1))
  return { objective: o, short: s, essay: e, code: Math.max(1, Math.round(count * 0.1)) }
}

export function startExam(spec: ExamSpec): ExamSummary {
  const qids = composePaper(spec)
  if (!qids.length) throw new Error('按所选条件抽不到题，请先让题库更新或放宽条件')
  const id = randomUUID().slice(0, 8)
  const started = Date.now()
  const deadline = started + spec.minutes * 60000
  run(`INSERT INTO exams(id,title,spec,started_at,deadline_at,status,pass_line,model)
       VALUES(?,?,?,?,?,?,?,?)`,
    [id, spec.title ?? `模拟卷 ${new Date().toLocaleString('zh-CN')}`, JSON.stringify(spec),
      new Date(started).toISOString().slice(0, 19).replace('T', ' '),
      new Date(deadline).toISOString().slice(0, 19).replace('T', ' '),
      'running', spec.passLine ?? 60, settingGet<string>('ai.routing') ? '' : ''])
  tx(() => { qids.forEach((qid, i) => run(`INSERT INTO exam_questions(exam_id,qid,ord) VALUES(?,?,?)`, [id, qid, i])) })
  return examSummary(id)!
}

export function examSummary(id: string): ExamSummary | null {
  const e = get<any>(`SELECT * FROM exams WHERE id=?`, [id])
  if (!e) return null
  const qs = all<{ qid: string; ord: number; answer: string; self_est: number }>(`SELECT qid,ord,answer,self_est FROM exam_questions WHERE exam_id=? ORDER BY ord`, [id])
  // deadline_at 是 UTC 字符串（toISOString 写入）。new Date('...') 不带 Z 会被按本地时区解析，
  // UTC+8 下会少算 8 小时导致开考即"超时"秒交白卷 —— 必须补 Z 按 UTC 解析
  const remainingMs = e.status === 'running' ? Math.max(0, new Date(e.deadline_at.replace(' ', 'T') + 'Z').getTime() - Date.now()) : 0
  return {
    id: e.id, title: e.title, spec: JSON.parse(e.spec), started_at: e.started_at, deadline_at: e.deadline_at,
    submitted_at: e.submitted_at, status: e.status, total: e.total, pass_line: e.pass_line ?? 60,
    self_est: e.self_est, answeredCount: qs.filter((q) => q.answer && q.answer !== 'null').length,
    questionCount: qs.length, remainingMs, report: e.ai_report ? safeJson(e.ai_report) : null
  }
}
const safeJson = (s: string) => { try { return JSON.parse(s) } catch { return null } }

export function examQuestions(id: string): QuestionRow[] {
  const rows = all<{ qid: string; answer: string }>(`SELECT qid,answer FROM exam_questions WHERE exam_id=? ORDER BY ord`, [id])
  const list = hydrateQuestions(rows.map((r) => r.qid))
  const map = new Map(rows.map((r) => [r.qid, r.answer]))
  return list.map((row) => ({ ...row, savedAnswer: map.get(row.id) ? safeJson(map.get(row.id)!) : undefined } as QuestionRow & { savedAnswer?: unknown }))
}

/** 草稿自动保存（渲染层防抖调用，崩溃也不丢） */
export function saveDraft(id: string, qid: string, answer: unknown, selfEst?: number) {
  run(`UPDATE exam_questions SET answer=?, self_est=COALESCE(?,self_est) WHERE exam_id=? AND qid=?`,
    [JSON.stringify(answer ?? null), selfEst ?? null, id, qid])
  run(`UPDATE exams SET status='running' WHERE id=? AND status='running'`, [id])
}

export function resumeRunning(): ExamSummary | null {
  const e = get<{ id: string }>(`SELECT id FROM exams WHERE status IN ('running','submitted','grading') ORDER BY started_at DESC LIMIT 1`)
  return e ? examSummary(e.id) : null
}

export interface GradingProgress { status: string; done: number; total: number }
const gradingState = new Map<string, GradingProgress>()
export const gradingStatus = (id: string): GradingProgress => gradingState.get(id) ?? { status: get<any>(`SELECT status FROM exams WHERE id=?`, [id])?.status ?? 'unknown', done: 0, total: 0 }

/** 交卷：客观题即时判分，主观题排队给 AI，全程可查进度 */
export async function submitExam(id: string): Promise<ExamSummary> {
  const summary = examSummary(id)
  if (!summary) throw new Error('考试不存在')
  if (summary.status === 'done') return summary
  const e = get<any>(`SELECT * FROM exams WHERE id=?`, [id])
  run(`UPDATE exams SET submitted_at=?, status='grading' WHERE id=?`, [now(), id])
  const rows = all<{ qid: string; answer: string; self_est: number }>(`SELECT qid,answer,self_est FROM exam_questions WHERE exam_id=? ORDER BY ord`, [id])
  const results: AiExamReport['perQuestion'] = []
  const progress: GradingProgress = { status: 'grading', done: 0, total: rows.length }
  gradingState.set(id, progress)

  for (const row of rows) {
    const q = questionOf(row.qid)
    if (!q) { progress.done++; continue }
    const answer = row.answer ? safeJson(row.answer) : null
    const objective = ['single', 'multiple', 'judge', 'blank'].includes(q.type)
    let scale4 = 0, verdict = '', missing: string[] = [], awarded: any[] | undefined
    try {
      if (answer == null || (typeof answer === 'object' && Object.keys(answer).length === 0) || (typeof answer === 'string' && !answer.trim())) {
        scale4 = 0; verdict = '未作答'
      } else {
        const g = await gradeAnswer(q, { qid: q.id, answer, mode: 'exam' })
        scale4 = g.scale4; verdict = g.verdict ?? ''; missing = g.missing ?? []; awarded = g.awarded
        if (g.gradingKind === 'ai') recordAttempt({ qid: q.id, mode: 'exam', examId: id, answer, scale4: g.scale4, gradingKind: 'ai', model: g.model, tokens: g.tokens, ms: g.ms, wrongPoints: missing, feedback: g })
        else recordAttempt({ qid: q.id, mode: 'exam', examId: id, answer, scale4, gradingKind: 'auto', wrongPoints: [verdict] })
      }
    } catch (err: any) {
      scale4 = 0; verdict = `批改失败：${String(err?.message ?? err).slice(0, 80)}`
      recordAttempt({ qid: q.id, mode: 'exam', examId: id, answer, scale4, gradingKind: 'auto', wrongPoints: [verdict] })
    }
    results.push({ qid: row.qid, scale4, pct: objective ? (scale4 === 3 ? 100 : scale4 === 1 ? 40 : 0) : scale4ToPct(scale4, awarded?.length ? awarded.reduce((s, a) => s + Math.min(100, Number(a.got ?? 0)), 0) / (awarded.length * 100) : scale4 / 3), verdict, missing, awarded })
    progress.done++
  }

  const total = results.length ? Math.round(results.reduce((s, r) => s + r.pct, 0) / results.length) : 0
  const selfVals = rows.filter((r) => typeof r.self_est === 'number').map((r) => r.self_est)
  const selfEst = selfVals.length ? Math.round(selfVals.reduce((s, v) => s + v, 0) / selfVals.length) : null
  const report = buildReport(id, results, rows, total, selfEst)
  run(`UPDATE exams SET status='done', total=?, self_est=?, ai_report=? WHERE id=?`,
    [total, selfEst, JSON.stringify(report), id])
  gradingState.set(id, { status: 'done', done: rows.length, total: rows.length })
  // 游戏化聚合结算：一场考试只推进一次打卡、发一条聚合 XP（失败不影响成绩落库）
  try {
    recordExam(results.filter((r) => r.verdict !== '未作答').map((r) => ({ qid: r.qid, scale4: r.scale4 })))
  } catch (e: any) { console.warn('[game] 考试结算失败（不影响成绩）：', e?.message) }
  return examSummary(id)!
}

function buildReport(examId: string, results: AiExamReport['perQuestion'], rows: { qid: string; self_est: number }[], total: number, selfEst: number | null): AiExamReport {
  const nodeOf = new Map<string, string>()
  for (const r of results) {
    const n = get<{ node_id: string }>(`SELECT node_id FROM questions WHERE id=?`, [r.qid])
    if (n) nodeOf.set(r.qid, n.node_id)
  }
  const lostByNode = new Map<string, { lost: number; n: number }>()
  for (const r of results) {
    const nid = nodeOf.get(r.qid); if (!nid) continue
    const lost = 100 - r.pct
    const cur = lostByNode.get(nid) ?? { lost: 0, n: 0 }
    cur.lost += lost; cur.n++
    lostByNode.set(nid, cur)
  }
  const weakNodes = [...lostByNode.entries()]
    .map(([nid, v]) => ({ nodeId: nid, title: get<{ title: string }>(`SELECT title FROM nodes WHERE id=?`, [nid])?.title ?? nid, lostPct: Math.round(v.lost / v.n), advice: '' }))
    .sort((a, b) => b.lostPct - a.lostPct).slice(0, 8)
    .map((w) => ({ ...w, advice: w.lostPct >= 70 ? '完全没掌握：先读该节点解析与查漏补缺，再做变体巩固' : w.lostPct >= 40 ? '机制说不清：重点补因果与边界条件' : '细节失分：注意术语准确与参数默认值' }))

  const attributionMap = new Map<string, number>()
  for (const r of results) {
    if (r.verdict === '未作答') attributionMap.set('时间不够/未作答', (attributionMap.get('时间不够/未作答') ?? 0) + 1)
    for (const m of r.missing ?? []) attributionMap.set(m.length > 28 ? m.slice(0, 28) + '…' : m, (attributionMap.get(m) ?? 0) + 1)
  }
  const attribution = [...attributionMap.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 10)

  const band = total >= 85 ? '掌握得不错，可以挑战更难的题' : total >= 70 ? '基础扎实，把薄弱节点补一下' : total >= 55 ? '基础题还不稳，先回基础考点' : '需要系统补一遍，从图谱里标出的区域开始'
  const delta = selfEst != null ? { self: selfEst, ai: total, note: selfEst - total >= 12 ? '你高估了自己：把"看过"当成了"能讲清"，答题时容易被追问到答不上来' : total - selfEst >= 12 ? '你偏保守，实际表现比自评好，答题时可以更自信地展开' : '自我评估较准，能预判自己的失分点' } : undefined
  return {
    total, pass: total >= (get<any>(`SELECT pass_line FROM exams WHERE id=?`, [examId])?.pass_line ?? 60),
    band, perQuestion: results, weakNodes, attribution, selfEstDelta: delta,
    summary: `${results.length} 题均分 ${total}。最该补的是「${weakNodes[0]?.title ?? '—'}」（平均失分 ${weakNodes[0]?.lostPct ?? 0}%）。${delta?.note ?? ''}`,
    model: ''
  }
}

export function examHistory(limit = 20) {
  return all<any>(`SELECT id,title,total,pass_line,self_est,submitted_at,spec FROM exams WHERE status='done' ORDER BY submitted_at DESC LIMIT ?`, [limit])
    .map((e) => ({ id: e.id, title: e.title, total: e.total, pass: (e.total ?? 0) >= (e.pass_line ?? 60), submitted_at: e.submitted_at, spec: safeJson(e.spec) }))
}
export function abandonExam(id: string) { run(`UPDATE exams SET status='abandoned' WHERE id=?`, [id]) }
export function deleteExam(id: string) { run(`DELETE FROM exam_questions WHERE exam_id=?`, [id]); run(`DELETE FROM exams WHERE id=?`, [id]) }
