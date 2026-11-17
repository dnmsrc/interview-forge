import { all, get, settingGet, settingSet } from '../db'
import { safeParse } from './srs'

/**
 * 错题本（R9-⑥）。
 * 实时视图：基于 attempts 动态计算，新答错的题自动出现，不另建副本表。
 * 「移除/清空」只写 settings 隐藏标记（视图层屏蔽），绝不删 attempts 原始历史；
 * 之后若再次答错，自动解除隐藏重新出现。
 */

const HIDDEN_KEY = 'mistakes.hidden'

function hiddenSet(): Set<string> {
  const v = settingGet<Record<string, number>>(HIDDEN_KEY) ?? {}
  return new Set(Object.keys(v).filter((k) => v[k] === 1))
}
function setHidden(qids: string[], on: boolean) {
  const cur = settingGet<Record<string, number>>(HIDDEN_KEY) ?? {}
  for (const id of qids) {
    if (on) cur[id] = 1
    else delete cur[id]
  }
  settingSet(HIDDEN_KEY, cur)
}

export interface MistakeRow {
  qid: string
  type: string
  node_id: string
  nodeTitle: string
  stem: string
  times: number
  wrongTimes: number
  worst: number
  avgScore: number
  lastAt: string
  lit: number
}

interface ListOpts { domain?: string; limit?: number; onlyUnmastered?: boolean }

export function mistakeList(opts: ListOpts = {}): MistakeRow[] {
  const limit = Math.max(1, Math.min(500, opts.limit ?? 200))
  const hidden = hiddenSet()
  const dom = opts.domain ? `AND substr(q.node_id,1,instr(q.node_id,'.'))=?` : ''
  const unmastered = opts.onlyUnmastered ? `AND COALESCE(m.lit,0)=0` : ''
  const rows = all<any>(
    `SELECT q.id AS qid, json_extract(q.data,'$.type') AS type, q.node_id AS node_id,
        n.title AS nodeTitle,
        SUBSTR(json_extract(q.data,'$.stem'),1,200) AS stem,
        COUNT(a.id) AS times,
        SUM(CASE WHEN a.scale4<2 THEN 1 ELSE 0 END) AS wrongTimes,
        MIN(a.score) AS worst, AVG(a.score) AS avgScore,
        MAX(a.created_at) AS lastAt, COALESCE(m.lit,0) AS lit
     FROM attempts a JOIN questions q ON q.id=a.question_id
     LEFT JOIN nodes n ON n.id=q.node_id
     LEFT JOIN node_mastery m ON m.node_id=q.node_id
     WHERE a.scale4<2 ${dom} ${unmastered}
     GROUP BY q.id
     HAVING wrongTimes>0
     ORDER BY lit ASC, avgScore ASC, wrongTimes DESC, lastAt DESC
     LIMIT ?`,
    [...(opts.domain ? [opts.domain] : []), limit])

  return rows
    .filter((r) => !hidden.has(r.qid))
    .map((r) => ({
      ...r,
      times: Number(r.times), wrongTimes: Number(r.wrongTimes),
      worst: Number(r.worst ?? 0), avgScore: Number(r.avgScore ?? 0), lit: Number(r.lit)
    }))
}

/** 单题详情：题目完整 data + 全部作答历史 */
export function mistakeDetail(qid: string) {
  const qRow = get<any>(`SELECT id, node_id, data FROM questions WHERE id=?`, [qid])
  if (!qRow) return null
  const history = all<any>(
    `SELECT id, score, scale4, grading_kind, ai_model, created_at, answer, wrong_points, feedback
     FROM attempts WHERE question_id=? ORDER BY id DESC`, [qid]).map((h) => ({
      ...h,
      feedback: h.feedback ? safeParse(h.feedback) : null,
      wrong_points: h.wrong_points ? safeParse(h.wrong_points) : null,
      answer: h.answer ? safeParse(h.answer) : null
    }))
  return { qid: qRow.id, node_id: qRow.node_id, q: safeParse(qRow.data), history }
}

/** 从错题本隐藏（不删历史）；再次答错会自动回来 */
export function removeMistake(qid: string) {
  setHidden([qid], true)
  return { ok: true, qid }
}

/** 批量隐藏：可按板块清空；重新答错自动恢复 */
export function clearMistakes(domain?: string) {
  const qids = mistakeList({ domain, limit: 500 }).map((r) => r.qid)
  if (qids.length) setHidden(qids, true)
  return { ok: true, hidden: qids.length }
}
