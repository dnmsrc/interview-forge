/**
 * 题目检索索引的纯函数核心（零依赖，CLI / 主进程 / 单测共用）。
 *
 * 为什么需要这一层：
 *   题目正文存在 questions.data（JSON 一列），FTS5 没法直接对 JSON 里的字段做字段级加权。
 *   所以 seed 时抽出一张派生表 question_index：把 stem/analysis/gapCheck/answer/tags
 *   各自拍平成一个可检索列，并**分别做中文分词**后再喂给 FTS5。
 *
 * 为什么不直接抄 knowledge 的做法（只有一个 search_text）：
 *   knowledge 把所有字段揉成一列，字段权重（title 12 / summary 6 / body 1）实际上形同虚设，
 *   因为中文原文在 unicode61 里整句是一个 token，真正能命中的只有分词后的 search_text。
 *   题目这边题干短、解析长、tags 是关键词，三者权重差别很大，必须逐字段分词才能让
 *   bm25(question_fts, 12, 6, ...) 的权重真正生效。
 *
 * 分词口径与 knowledge 完全一致（tokenizeForSearch），检索表达式也用同一套 buildFtsMatch，
 * 保证「知识检索」和「题目检索」两端的召回行为对得上。
 */
import { tokenizeForSearch } from './knowledge-core.mjs'

/** FTS 列顺序：必须与 schema.mjs 的 question_fts 定义、以及 bm25() 的权重顺序严格一致 */
export const QIDX_COLUMNS = ['stem_tk', 'analysis_tk', 'gap_tk', 'answer_tk', 'tags_tk']

/** bm25 权重：题干最重要，其次是解析（语义主体）与 tags（主题词），gapCheck/answer 作补充 */
export const QIDX_WEIGHTS = [12.0, 6.0, 3.0, 2.0, 4.0]

/** 把结构化 answer 拍平成一段可检索文本；不同题型字段不同，缺什么就跳过什么 */
export function flattenAnswer(answer) {
  if (!answer) return ''
  if (typeof answer === 'string') return answer
  if (typeof answer !== 'object') return String(answer)
  const parts = []
  if (Array.isArray(answer.keys) && answer.keys.length) parts.push('答案键：' + answer.keys.join(','))
  if (Array.isArray(answer.blanks) && answer.blanks.length) parts.push('填空：' + answer.blanks.join(' | '))
  if (typeof answer.judge === 'boolean') parts.push('判断：' + (answer.judge ? '对' : '错'))
  if (answer.ref) parts.push(String(answer.ref))
  if (Array.isArray(answer.scoringPoints) && answer.scoringPoints.length) parts.push('评分点：' + answer.scoringPoints.join('；'))
  return parts.join('\n')
}

/** 从一道题（content/questions 里的原始 JSON 对象）抽出检索需要的五个字段（未分词） */
export function extractQuestionFields(q) {
  if (!q || typeof q !== 'object') return null
  const stem = String(q.stem ?? '').trim()
  if (!stem) return null
  return {
    qid: String(q.id ?? ''),
    nodeId: String(q.nodeId ?? ''),
    stem,
    analysis: String(q.analysis ?? '').trim(),
    gapCheck: (Array.isArray(q.gapCheck) ? q.gapCheck : []).filter(Boolean).map(String).join('\n'),
    answerText: flattenAnswer(q.answer),
    tagsText: (Array.isArray(q.tags) ? q.tags : []).filter(Boolean).map(String).join(' '),
  }
}

/**
 * 生成 question_index 的完整行（含各字段的分词列）。
 * @returns null 表示这道题缺 id/stem，不适合入索引
 */
export function buildQuestionIndexRow(q) {
  const f = extractQuestionFields(q)
  if (!f || !f.qid) return null
  return {
    qid: f.qid,
    node_id: f.nodeId,
    stem: f.stem,
    analysis: f.analysis,
    gap_check: f.gapCheck,
    answer_text: f.answerText,
    tags_text: f.tagsText,
    stem_tk: tokenizeForSearch(f.stem),
    analysis_tk: tokenizeForSearch(f.analysis),
    gap_tk: tokenizeForSearch(f.gapCheck),
    answer_tk: tokenizeForSearch(f.answerText),
    tags_tk: tokenizeForSearch(f.tagsText),
  }
}

/** question_index 的列顺序（INSERT / SELECT 共用，避免两边写岔） */
export const QIDX_FIELDS = [
  'qid', 'node_id', 'stem', 'analysis', 'gap_check', 'answer_text', 'tags_text',
  'stem_tk', 'analysis_tk', 'gap_tk', 'answer_tk', 'tags_tk',
]

/** 自适应学习路径里判断「一道题是否适合当某考点的补基础练习」会用到的难度档 */
export function difficultyBucket(n) {
  const d = Number(n)
  if (!Number.isFinite(d)) return 2
  return Math.max(1, Math.min(4, Math.round(d)))
}