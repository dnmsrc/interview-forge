import { all, run } from '../db'
import { buildFtsMatch } from '../../shared/knowledge-core.mjs'
import { buildQuestionIndexRow, QIDX_FIELDS, QIDX_WEIGHTS } from '../../shared/question-index-core.mjs'

/**
 * 题目检索服务（私教答疑的事实来源）。
 *
 * 存在理由：explain.ts 原来只注入「该考点的一篇知识正文」，而 knowledge 目录实际只有几篇。
 * 用户问的往往是**具体某道题**，而这题的标准解析 / 易漏点 / 标准答案就躺在 questions.data 里，
 * 却一个字没进模型上下文——于是小模型只能凭记忆讲，讲偏、讲错、编 API 都由此而来。
 *
 * 检索策略（对齐「回答要有依据」这个产品目标）：
 *   1) 若指定了 questionId：那道题**必选**（用户正在做它，讲解必须以它为锚）。
 *   2) 同考点（node_id = nodeId）内的题目用 FTS 检索，排前面。
 *   3) 名额没满时，全局检索补足（跨考点但语义相关的题，用于类比/对比）。
 *   4) 每条材料同时给出「注入用的精炼片段」和「校验用的完整原文 corpus」，
 *      后者喂给 claim-guard 做幻觉拦截。
 */

export interface TutorMaterial {
  kind: 'question' | 'knowledge'
  /** 题目 id 或考点 id */
  id: string
  nodeId: string
  /** 题干前 80 字，用于 UI 展示「依据了哪道题」 */
  title: string
  /** 注入 prompt 的精炼材料（已截断到 CONTENT 上限） */
  material: string
  /** 完整原文，供引用校验比对（不注入，避免吃 token） */
  corpus: string
  /** bm25 取反后的相关性分，越大越相关；必选材料给最高分 */
  score: number
  /** 是否来自当前考点（前端可据此标注「本题解析」/「同类题」） */
  fromSameNode: boolean
}

const QIDX_SQL = `SELECT qi.qid, qi.node_id, qi.stem, qi.analysis, qi.gap_check, qi.answer_text,
        bm25(question_fts, ${QIDX_WEIGHTS.map((w) => w.toFixed(1)).join(',')}) AS score
   FROM question_fts
   JOIN question_index qi ON qi.rowid = question_fts.rowid
  WHERE question_fts MATCH ?`

type QIdxRow = {
  qid: string; node_id: string; stem: string; analysis: string | null
  gap_check: string | null; answer_text: string | null; score: number
}

/** 单条材料里各部分的截断上限：解析是主体，其余只取有用的头部 */
const CUT = { analysis: 420, gap: 160, answer: 120, stem: 160 }
/** 注入 prompt 的材料总字数上限（控制 prompt 处理时间；实测 2000 字知识正文约 6.9s） */
export const MATERIAL_BUDGET = 1600

/**
 * 在原文里定位最早命中的词，取附近一段作为引用片段（纯文本，不带 <mark>：
 * 这段是给模型看的，HTML 标记只会污染 prompt）。
 */
function snippetAround(text: string, terms: string[], span = 300): string {
  const src = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!src) return ''
  const lower = src.toLowerCase()
  let pos = -1
  for (const t of terms) {
    if (!t) continue
    const i = lower.indexOf(t)
    if (i >= 0 && (pos < 0 || i < pos)) pos = i
  }
  if (pos < 0) return src.slice(0, span)
  const start = Math.max(0, pos - 60)
  const end = Math.min(src.length, pos + span)
  return (start > 0 ? '…' : '') + src.slice(start, end).trim() + (end < src.length ? '…' : '')
}

function clip(s: string, n: number): string {
  const t = String(s ?? '').replace(/\r/g, '').trim()
  return t.length <= n ? t : t.slice(0, n).trimEnd() + '…'
}

/** 把一行索引记录拼成给模型看的结构化材料 */
function toMaterial(r: QIdxRow, terms: string[], fromSameNode: boolean): TutorMaterial {
  const analysis = clip(snippetAround(r.analysis ?? '', terms, CUT.analysis), CUT.analysis)
  const gap = clip(r.gap_check ?? '', CUT.gap)
  const ans = clip(r.answer_text ?? '', CUT.answer)
  const lines = [`【题目】${clip(r.stem, CUT.stem)}`]
  if (analysis) lines.push(`【标准解析】${analysis}`)
  if (gap) lines.push(`【易漏点】${gap}`)
  if (ans) lines.push(`【标准答案】${ans}`)
  return {
    kind: 'question',
    id: r.qid,
    nodeId: r.node_id,
    title: clip(r.stem, 80),
    material: lines.join('\n'),
    // corpus 用全量原文：校验时宁可宽松放行，也不要因为截断误杀真事实
    corpus: [r.stem, r.analysis ?? '', r.gap_check ?? '', r.answer_text ?? ''].join('\n'),
    score: -Number(r.score),
    fromSameNode,
  }
}

/** 精确取某一道题（用户正在做它时必选） */
function fetchQuestionById(qid: string, terms: string[], nodeId: string): TutorMaterial | null {
  const r = all<QIdxRow>(
    `SELECT qid,node_id,stem,analysis,gap_check,answer_text,0 AS score
       FROM question_index WHERE qid=? LIMIT 1`, [qid])[0]
  if (!r) return null
  const m = toMaterial(r, terms, r.node_id === nodeId)
  m.score = 1e9   // 必选材料恒定排最前，避免被其它题的 bm25 挤掉
  return m
}

/** 跑一轮 MATCH；同考点过滤用 nodeOnly=true */
function runQuestionFts(
  match: string, cap: number, exclude: Set<string>, opts: { nodeId?: string; nodeOnly?: boolean } = {}
): QIdxRow[] {
  const where = opts.nodeOnly ? ' AND qi.node_id = ?' : ''
  const params: unknown[] = opts.nodeOnly ? [match, opts.nodeId ?? '', cap + exclude.size] : [match, cap + exclude.size]
  let rows: QIdxRow[]
  try {
    rows = all<QIdxRow>(`${QIDX_SQL}${where} ORDER BY score LIMIT ?`, params)
  } catch {
    return []   // 极端查询串会让 MATCH 语法报错，这一路直接放弃，由调用方兜底
  }
  const out: QIdxRow[] = []
  for (const r of rows) {
    if (exclude.has(r.qid)) continue
    out.push(r)
    if (out.length >= cap) break
  }
  return out
}

/**
 * 为私教答疑检索事实材料。
 *
 * @param nodeId   当前考点（用于「同考点优先」与必选题判定）
 * @param query    用户这一轮的问题（也用于定位片段）
 * @param questionId 用户正在做的题（可选，指定则必选进材料）
 * @param limit    最多几条（默认 4：够覆盖本题+同类题，再多会挤占生成预算）
 */
export function retrieveForTutor(input: {
  nodeId: string
  query: string
  questionId?: string | null
  limit?: number
}): TutorMaterial[] {
  const nodeId = String(input.nodeId ?? '')
  const query = String(input.query ?? '').trim()
  const limit = Math.max(1, Math.min(8, Number(input.limit) || 4))
  const built = query ? buildFtsMatch(query) : null
  // 检索词：用户问题 + 考点 id 末段（如 rerank-compress → 「重排、上下文压缩」这种标题里的词已在题面）
  const terms = built?.terms ?? []

  const out: TutorMaterial[] = []
  const seen = new Set<string>()

  // 1) 用户正在做的那道题，必选
  if (input.questionId) {
    const m = fetchQuestionById(String(input.questionId), terms, nodeId)
    if (m) { out.push(m); seen.add(m.id) }
  }

  if (out.length >= limit) return out

  // 2) 同考点的相关题
  if (built?.matchStrict || built?.match) {
    for (const match of [built.matchStrict, built.match]) {
      if (!match) continue
      for (const r of runQuestionFts(match, limit - out.length, seen, { nodeId, nodeOnly: true })) {
        seen.add(r.qid)
        out.push(toMaterial(r, built.terms, true))
        if (out.length >= limit) return out
      }
    }
    // 3) 全局补足（跨考点的同主题题，用于类比与横向印证）
    for (const match of [built.matchStrict, built.match]) {
      if (!match) continue
      for (const r of runQuestionFts(match, limit - out.length, seen, { nodeId })) {
        seen.add(r.qid)
        out.push(toMaterial(r, built.terms, r.node_id === nodeId))
        if (out.length >= limit) return out
      }
    }
  }

  // 4) 一句检索都没命中（Query 太口语/太短）：退回该考点的近邻题，保证「讲这道题」至少有一道事实依据
  if (!out.length && nodeId) {
    const rows = all<QIdxRow>(
      `SELECT qid,node_id,stem,analysis,gap_check,answer_text,0 AS score
         FROM question_index WHERE node_id=? ORDER BY qid LIMIT ?`, [nodeId, limit])
    for (const r of rows) {
      if (seen.has(r.qid)) continue
      seen.add(r.qid)
      const m = toMaterial(r, [], true)
      m.score = -1e6 + out.length   // 兜底材料排在最后但仍在
      out.push(m)
    }
  }
  return out
}

/**
 * 把检索结果拼成注入 prompt 的文本块，受 MATERIAL_BUDGET 总量约束。
 * 材料不足时返回 null，让调用方走「题库未覆盖」的诚实路径，而不是让模型自由发挥。
 */
export function formatMaterialsBlock(materials: TutorMaterial[]): string | null {
  if (!materials.length) return null
  const blocks: string[] = []
  let used = 0
  for (let i = 0; i < materials.length; i++) {
    const m = materials[i]
    const body = m.material
    if (used + body.length > MATERIAL_BUDGET && blocks.length) break
    const tag = m.fromSameNode ? '本题所在考点' : '其它考点'
    blocks.push(`[材料${i + 1}] 题目 ${m.id}（${tag}）\n${body}`)
    used += body.length
  }
  return blocks.join('\n\n')
}

/* ---------------- 索引维护与自检 ---------------- */

/** 从 questions 表重建题目检索索引（schema 升级后自动重建；手动修复也走这里） */
export function syncQuestionIndex(): { indexed: number; skipped: number } {
  const rows = all<{ id: string; data: string }>(`SELECT id,data FROM questions`)
  let indexed = 0
  let skipped = 0
  const insert = `
    INSERT INTO question_index(${QIDX_FIELDS.join(',')})
    VALUES(${QIDX_FIELDS.map(() => '?').join(',')})
    ON CONFLICT(qid) DO UPDATE SET node_id=excluded.node_id, stem=excluded.stem, analysis=excluded.analysis,
      gap_check=excluded.gap_check, answer_text=excluded.answer_text, tags_text=excluded.tags_text,
      stem_tk=excluded.stem_tk, analysis_tk=excluded.analysis_tk, gap_tk=excluded.gap_tk,
      answer_tk=excluded.answer_tk, tags_tk=excluded.tags_tk, indexed_at=datetime('now','localtime')`
  for (const r of rows) {
    let q: any
    try { q = JSON.parse(r.data) } catch { skipped++; continue }
    const row = buildQuestionIndexRow({ ...q, id: q?.id ?? r.id })
    if (!row) { skipped++; continue }
    run(insert, QIDX_FIELDS.map((k) => (row as any)[k]))
    indexed++
  }
  return { indexed, skipped }
}

export function questionIndexStatus(): { indexed: number; questions: number; hasFts: boolean } {
  const indexed = Number((all<{ n: number }>(`SELECT COUNT(*) n FROM question_index`)[0] ?? { n: 0 }).n)
  const questions = Number((all<{ n: number }>(`SELECT COUNT(*) n FROM questions`)[0] ?? { n: 0 }).n)
  let hasFts = true
  try { all(`SELECT 1 FROM question_fts LIMIT 1`) } catch { hasFts = false }
  return { indexed, questions, hasFts }
}

/** 诊断用：检查索引与题库是否一致（题目数 > 索引数说明 seed 没跑或索引损坏） */
export function indexDrift(): { ok: boolean; message: string } {
  const st = questionIndexStatus()
  if (!st.hasFts) return { ok: false, message: 'question_fts 不存在（schema 未升级？）' }
  if (st.indexed === 0) return { ok: false, message: '题目索引为空，请重建（syncQuestionIndex）' }
  if (st.indexed < st.questions) {
    return { ok: false, message: `索引落后：${st.indexed}/${st.questions}，建议重建` }
  }
  return { ok: true, message: `索引健康：${st.indexed} 道题` }
}