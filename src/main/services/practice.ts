import { all, get, run, settingGet } from '../db'
import { applyUnlock, loadNodes } from './graph'
import { dueQuestionIds, reviewCandidateIds, variantIdsOfNode, hydrateQuestions, recordAttempt, globalMixRatio, todayDueCount } from './srs'
import { gradeAnswer, selfGrade, questionOf, textOf } from './grading'
import { recordAnswer, type AnswerSettlement } from './game'
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
  /**
   * 随机练习模式（用户意见 R9-④）：题目纯随机、无先后顺序、无前置关联。
   * 开启后不走「到期优先/薄弱变体/前置门槛排序」那套带学习路径的编排，
   * 直接在所选板块（domain/stack/node）内 RANDOM() 抽题，同考点不连续、不保证由浅入深。
   */
  random?: boolean
}

const dayStr = () => new Date().toISOString().slice(0, 10)

export function buildQueue(spec: PracticeSpec): QuestionRow[] {
  const count = Math.max(1, Math.min(100, spec.count ?? 10))

  // 随机练习（R9-④）：只要板块范围，不做任何学习路径编排。
  // 纯 RANDOM() 抽题、无到期优先、无变体混入、无前置门槛、无由浅入深排序；
  // 用窗口过滤避免同一考点连续出现，其余顺序完全随机，题间无关联关系。
  if (spec.random) return buildRandomQueue(spec, count)

  const ratio = spec.mixReviewRatio ?? globalMixRatio()
  const domains = spec.domains ?? []
  // 定向节点（图谱「练这个考点」/练习页按节点过滤）：所有取题环节都只能在这些节点内，
  // 否则到期复习与变体混入会把别的考点的题带进来，用户明明只点了一个考点却练到别的。
  const scope = spec.nodeIds ?? []
  const chosen: string[] = []
  const seen = new Set<string>()
  const push = (ids: string[]) => { for (const id of ids) { if (!seen.has(id) && chosen.length < count) { seen.add(id); chosen.push(id) } } }

  // 1) 到期复习优先（定向时只取这些节点的到期题）
  if (spec.includeDue !== false) push(dueQuestionIds(Math.ceil(count * 0.5), scope))

  // 2) 已点亮知识点的变体题（巩固主力，绝不与原题相同）
  const reviewTarget = Math.floor(count * ratio)
  if (reviewTarget > 0) {
    // 定向时只在指定节点里挑已点亮的；非定向保持原全量（按板块）行为
    const litRows = scope.length
      ? all<{ id: string }>(
          `SELECT n.id FROM nodes n JOIN node_mastery m ON m.node_id=n.id
           WHERE n.level=4 AND m.lit=1 AND n.id IN (${scope.map(() => '?').join(',')})
           ORDER BY m.scale4 ASC, RANDOM() LIMIT 20`, scope)
      : all<{ id: string }>(
          `SELECT n.id FROM nodes n JOIN node_mastery m ON m.node_id=n.id
           WHERE n.level=4 AND m.lit=1 ${domains.length ? `AND substr(n.id,1,instr(n.id,'.')-1) IN (${domains.map(() => '?').join(',')})` : ''}
           ORDER BY m.scale4 ASC, RANDOM() LIMIT 20`, domains)
    const vars: string[] = []
    for (const n of litRows) {
      if (vars.length >= reviewTarget) break
      vars.push(...variantIdsOfNode(n.id, chosen, 2))
    }
    push(vars.slice(0, reviewTarget))
    if (vars.length < reviewTarget) push(reviewCandidateIds(reviewTarget - vars.length, domains, scope))
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

/**
 * 随机练习队列（R9-④）：在选定板块内纯随机抽题。
 * - 不读 srs 到期、不按 gates/difficulty 排序、不卡前置 locked（练习就是练习，门槛交给摸底与图谱）；
 * - 只保留 status=active 的母题（parent_id IS NULL），变体不作为独立随机题源；
 * - 用「同考点不连续」做一次轻量打散，仍保持整体随机，避免连出同节点的题让人误以为有关联。
 */
function buildRandomQueue(spec: PracticeSpec, count: number): QuestionRow[] {
  const where = [`q.status='active'`, `q.parent_id IS NULL`]
  const params: unknown[] = []
  const domains = spec.domains ?? []
  if (domains.length) {
    where.push(`substr(q.node_id,1,instr(q.node_id,'.')-1) IN (${domains.map(() => '?').join(',')})`)
    params.push(...domains)
  }
  if (spec.stacks?.length) {
    // stack 是 id 的第二段，如 fe.vue / ai.rag
    where.push(`substr(q.node_id,instr(q.node_id,'.')+1,instr(substr(q.node_id,instr(q.node_id,'.')+1),'.')-1) IN (${spec.stacks.map(() => '?').join(',')})`)
    params.push(...spec.stacks)
  }
  if (spec.nodeIds?.length) {
    where.push(`q.node_id IN (${spec.nodeIds.map(() => '?').join(',')})`)
    params.push(...spec.nodeIds)
  }
  if (spec.types?.length) {
    where.push(`q.type IN (${spec.types.map(() => '?').join(',')})`)
    params.push(...spec.types)
  }
  if (spec.difficulties?.length) {
    where.push(`q.difficulty IN (${spec.difficulties.map(() => '?').join(',')})`)
    params.push(...spec.difficulties)
  }
  // 多取一些用于打散；池子不足时有多少给多少
  const pool = all<{ id: string; node_id: string }>(
    `SELECT q.id, q.node_id FROM questions q WHERE ${where.join(' AND ')} ORDER BY RANDOM() LIMIT ?`,
    [...params, Math.max(count * 3, count)])
  if (!pool.length) return []

  // 同考点不连续：贪心放置，取不到不冲突的就接受剩余（题量很少时不强求）
  const picked: typeof pool = []
  const rest = [...pool]
  while (picked.length < count && rest.length) {
    const lastNode = picked[picked.length - 1]?.node_id
    const idx = rest.findIndex((r) => r.node_id !== lastNode)
    const take = idx >= 0 ? idx : 0
    picked.push(rest.splice(take, 1)[0])
  }
  return hydrateQuestions(picked.map((r) => r.id))
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
  // gates = 该考点的「外部前置」数量（不含祖先归属），越少越基础 → 先推。
  // 不能只看 nodes.level：题目只挂在 level4 叶子上，level 全是 4，排序等于没排。
  // ROW_NUMBER 分区限流：同一考点一次最多出 2 题，否则 RANDOM() 会把同一个考点的三道题连着塞进队列。
  return all<{ id: string }>(
    `SELECT id FROM (
       SELECT q.id id,
              COALESCE((SELECT COUNT(*) FROM edges g WHERE g.to_id=q.node_id AND g.type='advance'),0) gates,
              q.difficulty diff,
              ROW_NUMBER() OVER (PARTITION BY q.node_id ORDER BY q.difficulty ASC, RANDOM()) rn
       FROM questions q
       LEFT JOIN node_mastery m ON m.node_id=q.node_id
       LEFT JOIN (
         SELECT n.id nid, CASE WHEN EXISTS (
           -- 必须是 LEFT JOIN：前置节点若还没有 mastery 记录（全新用户），INNER JOIN 会匹配不到，
           -- 于是"前置存在但从没做过"被当成无前置，blocked 恒为 0，第一次练习就能抽到深水区考点。
           SELECT 1 FROM edges e LEFT JOIN node_mastery pm ON pm.node_id=e.from_id
           WHERE e.to_id=n.id AND e.type='advance' AND COALESCE(pm.lit,0)=0 AND COALESCE(pm.forced_unlock,0)=0
         ) THEN 1 ELSE 0 END blocked FROM nodes n
       ) p ON p.nid=q.node_id
       WHERE ${where.join(' AND ')}
     ) WHERE rn <= 2
     ORDER BY gates ASC, diff ASC, RANDOM() LIMIT ?`, params).map((r) => r.id)
}

export interface SubmitResult { grade: GradeResult; unlockedNow?: { nodeId: string; title: string }[]; aiUnavailable?: string; game?: AnswerSettlement }

export async function submitPractice(qid: string, answer: unknown, opts: { endpointId?: string; selfScale4?: number; revealOnly?: boolean } = {}): Promise<SubmitResult> {
  const q = questionOf(qid)
  if (!q) throw new Error(`题目不存在：${qid}`)
  const before = litNodeIds()
  // 游戏化结算需要「提交前」的点亮/掌握快照来识别 0→1 跳变，先取一次
  const beforeNode = get<{ lit: number; mastery_level: number }>(
    `SELECT COALESCE(lit,0) lit, COALESCE(mastery_level,0) mastery_level FROM node_mastery WHERE node_id=?`, [q.nodeId])
  let grade: GradeResult
  try {
    grade = opts.selfScale4 != null ? selfGrade(q, opts.selfScale4) : await gradeAnswer(q, { qid, answer, mode: 'practice', endpointId: opts.endpointId })
  } catch (e: any) {
    if (e instanceof NoEndpoint || /端点|超时|HTTP|模型返回/.test(String(e?.message))) {
      grade = { qid, scale4: 0, pct: 0, gradingKind: 'self', error: String(e?.message ?? e), verdict: 'AI 不可用，已降级为自评/看答案' }
    } else throw e
  }
  let game: AnswerSettlement | undefined
  if (!opts.revealOnly) {
    recordAttempt({ qid, mode: 'practice', answer, scale4: grade.scale4, gradingKind: grade.gradingKind, model: grade.model, tokens: grade.tokens, ms: grade.ms, wrongPoints: grade.missing, feedback: grade })
    // 真实作答才发游戏化奖励；仅看答案（revealOnly）不发，防止刷 XP
    try {
      game = recordAnswer({ qid, scale4: grade.scale4, mode: 'practice', beforeLit: beforeNode?.lit ?? 0, beforeLevel: beforeNode?.mastery_level ?? 0 })
    } catch (e: any) { console.warn('[game] 结算失败（不影响判分）：', e?.message) }
  }
  const after = litNodeIds()
  const fresh = [...after].filter((x) => !before.has(x))
  const unlockedNow = fresh.length
    ? all<{ nodeId: string; title: string }>(`SELECT id AS nodeId,title FROM nodes WHERE id IN (${fresh.map(() => '?').join(',')})`, [...fresh])
    : undefined
  return { grade, unlockedNow, aiUnavailable: grade.error, game }
}

function litNodeIds(): Set<string> {
  return new Set(all<{ node_id: string }>(`SELECT node_id FROM node_mastery WHERE lit=1`).map((r) => r.node_id))
}

/**
 * 「这题我是蒙的」纠偏（R10）：用户回看本组做过的题时，主动承认某题是蒙对/没真正掌握。
 * 追加一条 0 档自评流水，绝不覆盖或删除原批改记录——
 * recordAttempt 会据此把该题 SRS 重置为失败（提前到期、多推）、重算考点掌握度（可能灭灯），
 * 错题本因 scale4<2 自动收录这道题。返回纠偏后的四态，供前端即时刷新。
 */
export function markGuessed(qid: string): { ok: true; qid: string; masteryLevel: number; lit: number } {
  const q = questionOf(qid)
  if (!q) throw new Error(`题目不存在：${qid}`)
  const verdict = '用户回看时标记：这题是蒙的，按「完全不会」重新计入掌握度（原批改记录保留）'
  recordAttempt({
    qid,
    mode: 'practice',
    answer: null,
    scale4: 0,
    gradingKind: 'self',
    wrongPoints: ['蒙题纠偏：用户主动承认未掌握'],
    feedback: { qid, scale4: 0, pct: 0, gradingKind: 'self', verdict }
  })
  const node = get<{ mastery_level: number; lit: number }>(
    `SELECT COALESCE(m.mastery_level,0) mastery_level, COALESCE(m.lit,0) lit
     FROM questions q LEFT JOIN node_mastery m ON m.node_id=q.node_id WHERE q.id=?`, [qid])
  return { ok: true, qid, masteryLevel: node?.mastery_level ?? 0, lit: node?.lit ?? 0 }
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
