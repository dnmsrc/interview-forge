import { get } from '../db'
import { gradeSubjective } from '../ai/tasks'
import type { Question, GradeResult } from '../../shared/types'

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, '').replace(/[，。；、,.;:"'`]/g, '')

export interface GradeInput { qid: string; answer: unknown; mode: 'practice' | 'exam' | 'placement'; endpointId?: string }

/** 客观题自动判分（纯本地，不花 AI） */
export function gradeObjective(q: Question, answer: unknown): { scale4: number; correct: boolean; detail: string } {
  const a = answer as any
  if (q.type === 'single') {
    const picked = Array.isArray(a?.keys) ? a.keys[0] : a?.key ?? a
    const right = norm(picked) === norm(q.answer?.keys?.[0])
    return { scale4: right ? 3 : 0, correct: right, detail: right ? '选择正确' : `正确答案 ${q.answer?.keys?.join('')}` }
  }
  if (q.type === 'judge') {
    const picked = typeof a?.judge === 'boolean' ? a.judge : Boolean(a)
    const right = picked === q.answer?.judge
    return { scale4: right ? 3 : 0, correct: right, detail: right ? '判断正确' : `正确判断为 ${q.answer?.judge ? '对' : '错'}` }
  }
  if (q.type === 'multiple') {
    const want = [...(q.answer?.keys ?? [])].map(norm).sort()
    const got = [...(a?.keys ?? [])].map(norm).sort()
    const wrongOn = got.some((k) => !want.includes(k))
    if (wrongOn) return { scale4: 0, correct: false, detail: `错选：${got.filter((k) => !want.includes(k)).join(',')}（正确答案 ${q.answer?.keys?.join('')}）` }
    if (got.length === want.length && got.every((k, i) => k === want[i])) return { scale4: 3, correct: true, detail: '全选正确' }
    return { scale4: 1, correct: false, detail: `漏选：${want.filter((k) => !got.includes(k)).join(',')}` }
  }
  if (q.type === 'blank') {
    const blanks = q.answer?.blanks ?? []
    const given: string[] = Array.isArray(a?.blanks) ? a.blanks : Array.isArray(a) ? a : [a?.text ?? a]
    const syn = q.answer?.synonyms ?? {}
    let hit = 0
    const perBlank: string[] = []
    blanks.forEach((want, i) => {
      const alts = [want, ...(syn[want] ?? [])].map(norm)
      const ok = alts.includes(norm(given[i]))
      if (ok) hit++
      else perBlank.push(`第 ${i + 1} 空应为「${want}」`)
    })
    const ratio = blanks.length ? hit / blanks.length : 0
    const scale4 = ratio === 1 ? 3 : ratio >= 0.5 ? 2 : hit > 0 ? 1 : 0
    return { scale4, correct: ratio === 1, detail: perBlank.length ? perBlank.join('；') : '全部填对' }
  }
  return { scale4: 0, correct: false, detail: '非客观题' }
}

const isObjective = (t: string) => ['single', 'multiple', 'judge', 'blank'].includes(t)

/** 填空题的语义兜底：精确匹配失败时，让 AI 判断是否等价（只对 blank 生效） */
async function blankSemanticFix(q: Question, answer: unknown, base: { scale4: number; detail: string }, endpointId?: string) {
  if (base.scale4 === 3 || q.type !== 'blank') return base
  try {
    const { chatJson } = await import('../ai/gateway')
    const given = Array.isArray((answer as any)?.blanks) ? (answer as any).blanks : []
    const { data } = await chatJson<any>({
      task: 'blank_semantic_check', role: 'fast', endpointId, refType: 'question', refId: q.id, maxTokens: 400,
      system: '你判断填空作答是否与标准答案语义等价（同义词、中英混写、缩写视为等价；单位或数量级错误视为不等价）。只输出 JSON。',
      user: `标准答案（按顺序）：${JSON.stringify(q.answer?.blanks ?? [])}\n我的作答（按顺序）：${JSON.stringify(given)}\n逐空判定，输出 {"verdicts":[{"index":1,"equivalent":true,"note":"说明"}]}`
    })
    const verdicts = Array.isArray(data.verdicts) ? data.verdicts : []
    const total = (q.answer?.blanks ?? []).length
    const hit = verdicts.filter((v: any) => v.equivalent).length
    if (!total || !hit) return base
    const ratio = hit / total
    const scale4 = ratio === 1 ? 3 : ratio >= 0.5 ? 2 : 1
    if (scale4 > base.scale4) return { scale4, detail: `AI 认可语义等价（${hit}/${total} 空）` }
  } catch { /* 无端点或超时：保留精确匹配结果 */ }
  return base
}

export async function gradeAnswer(q: Question, input: GradeInput): Promise<GradeResult> {
  if (isObjective(q.type)) {
    const r = gradeObjective(q, input.answer)
    let scale4 = r.scale4
    let detail = r.detail
    if (q.type === 'blank' && r.scale4 < 3) {
      const fixed = await blankSemanticFix(q, input.answer, { scale4, detail }, input.endpointId)
      scale4 = fixed.scale4; detail = fixed.detail
    }
    return { qid: q.id, scale4, pct: scale4 === 3 ? 100 : scale4 === 2 ? 68 : scale4 === 1 ? 40 : 0, gradingKind: 'auto', verdict: detail }
  }
  const ai = await gradeSubjective(q, textOf(input.answer), { endpointId: input.endpointId })
  return ai
}

export function textOf(answer: unknown): string {
  const a = answer as any
  if (!a) return ''
  if (typeof a === 'string') return a
  if (a.text) return String(a.text)
  if (a.code) return String(a.code)
  if (Array.isArray(a.blanks)) return a.blanks.map((b: unknown, i: number) => `(${i + 1}) ${b}`).join('\n')
  if (Array.isArray(a.keys)) return a.keys.join(',')
  if (typeof a.judge === 'boolean') return a.judge ? '对' : '错'
  return JSON.stringify(a)
}

/** 自评四档（不花 AI，快速过题） */
export function selfGrade(q: Question, scale4: number): GradeResult {
  const s = Math.max(0, Math.min(3, Math.round(scale4)))
  return { qid: q.id, scale4: s, pct: s === 3 ? 100 : s === 2 ? 68 : s === 1 ? 40 : 0, gradingKind: 'self', verdict: '自评' }
}

export function questionOf(qid: string): Question | null {
  const row = get<{ data: string }>(`SELECT data FROM questions WHERE id=?`, [qid])
  if (!row) return null
  try { return JSON.parse(row.data) as Question } catch { return null }
}
