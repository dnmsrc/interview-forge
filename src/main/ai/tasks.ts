import { chatJson, NoEndpoint } from './gateway'
import type { Question, GradeResult, TeachingResult, ProbeTurn, QaResult, VariantLite } from '../../shared/types'
import { scale4ToPct } from '../../shared/schema.mjs'

/**
 * 八类 AI 任务的提示词与结果整形（对应 docs/data-contracts.md §6）。
 * 统一约定：模型只输出 JSON；失败由调用方降级为"仅显示标准答案"。
 */

export const SCALE_RULE = `评分四档（严格按此判定）：
0 = 完全不会或答非所问；
1 = 方向对但说不清机制，或概念混用（如把 MCP 当工具本身、把 RAG 当记忆）；
2 = 独立讲清机制与因果，无关键错误；
3 = 在 2 的基础上能主动讲取舍、边界条件、失败路径或举证（真实数字/源码位置/线上现象）。`

const JSON_ONLY = `只输出一个合法 JSON 对象，不要 markdown 代码块，不要解释文字。中文输出。字段名必须与要求完全一致。`

const qDigest = (q: Question) => {
  const sp = (q.scoringPoints ?? []).map((p, i) => `${i + 1}. ${p.point}（权重 ${p.weight}）`).join('\n')
  const opts = (q.options ?? []).map((o) => `${o.key}. ${o.text}`).join('\n')
  return `【题型】${q.type}　【难度】${q.difficulty}/5
【题干】
${q.stem}
${opts ? `\n【选项】\n${opts}\n` : ''}${sp ? `\n【评分点】\n${sp}\n` : ''}${q.answer?.ref ? `\n【参考答案】\n${String(q.answer.ref).slice(0, 1800)}\n` : ''}${q.answer?.code ? `\n【参考实现】\n${String(q.answer.code).slice(0, 1800)}\n` : ''}`
}

// ---------- 1. 主观题批改 ----------
export async function gradeSubjective(q: Question, myAnswer: string, opts: { role?: 'fast' | 'strong'; endpointId?: string } = {}): Promise<GradeResult> {
  const user = `${qDigest(q)}
【我的作答】
${myAnswer.trim() || '（空白，未作答）'}

请对照评分点逐条判定，输出 JSON：
{"scale4":0-3 的整数,"awarded":[{"point":"评分点原文","got":0-100 的百分比,"why":"判定依据，指出我原话里的具体问题"}],"missing":["漏掉的关键点"],"verdict":"一句话结论","comment":"改进建议，≤120字，要具体到该补哪一步"}`
  const { data, model, ms, outTokens } = await chatJson<any>({ task: 'grade_subjective', role: opts.role ?? 'strong', endpointId: opts.endpointId, refType: 'question', refId: q.id, maxTokens: 1200, user, system: `你是严格的面试阅卷官。${SCALE_RULE}\n${JSON_ONLY}` })
  const scale4 = Math.max(0, Math.min(3, Number(data.scale4 ?? 0)))
  const awarded = Array.isArray(data.awarded) ? data.awarded : []
  const gotRatio = awarded.length
    ? awarded.reduce((s: number, a: any) => s + Math.max(0, Math.min(100, Number(a.got ?? 0))), 0) / (awarded.length * 100)
    : scale4 / 3
  return {
    qid: q.id, scale4, pct: scale4ToPct(scale4, gotRatio), gradingKind: 'ai',
    awarded, missing: Array.isArray(data.missing) ? data.missing : [],
    verdict: data.verdict, comment: data.comment, model, tokens: outTokens, ms
  }
}

// ---------- 2. 针对我个人答案的讲评 ----------
export async function teachMyAnswer(q: Question, myAnswer: string, opts: { endpointId?: string } = {}): Promise<TeachingResult> {
  if (!myAnswer.trim()) return { qid: q.id, errors: [], missingPoints: ['未作答'], howToRemember: '先自己写一遍再看解析，否则看不出差距。' }
  const user = `${qDigest(q)}
【我的作答】
${myAnswer}
【标准解析】
${String(q.analysis ?? '').slice(0, 1500)}
${(q.gapCheck ?? []).length ? `\n【查漏补缺清单】\n${(q.gapCheck ?? []).map((g) => '- ' + g).join('\n')}` : ''}

任务：不是重复标准答案，而是诊断我这段作答的问题。输出 JSON：
{"errors":[{"claim":"我写错的原话","why_wrong":"为什么错、正确说法是什么","severity":"high|mid|low"}],
 "missingPoints":["我漏掉但面试官会追问的点"],
 "termFixes":[{"wrong":"我用错的术语说法","right":"准确说法","why":"一句话区分"}],
 "howToRemember":"一个能帮助长期记住的锚点（类比或口诀，须准确不误导）",
 "betterAnswer":"把我的世界补齐后的示范作答，≤200字"}
注意：我说得对的地方不要挑刺；确实没问题就明确说没有。`
  const { data, model } = await chatJson<any>({ task: 'personal_teaching', role: 'strong', endpointId: opts.endpointId, refType: 'question', refId: q.id, maxTokens: 1400, user, system: `你是资深面试官兼教练。${JSON_ONLY}` })
  return {
    qid: q.id, model,
    errors: Array.isArray(data.errors) ? data.errors : [],
    missingPoints: Array.isArray(data.missingPoints) ? data.missingPoints : [],
    termFixes: Array.isArray(data.termFixes) ? data.termFixes : [],
    howToRemember: data.howToRemember, betterAnswer: data.betterAnswer
  }
}

// ---------- 3. 面试官递进追问 ----------
export async function probeNext(q: Question, history: { me: string; probe: string }[], lastAnswer: string, opts: { endpointId?: string } = {}): Promise<ProbeTurn & { done?: boolean }> {
  const hist = history.length ? history.map((h, i) => `第 ${i + 1} 轮追问：${h.probe}\n我的回答：${h.me}`).join('\n\n') : '（这是第一次追问）'
  const user = `${qDigest(q)}
【已进行的追问】
${hist}
【我刚才的回答】
${lastAnswer || '（空白）'}

按真实面试官的做法决定下一问：我答对了就往深处压（机制细节、边界、失败场景、代价量化），答错了就换个角度再给一次机会，连续两轮同点讲不清就收束。最多 3 轮。输出 JSON：
{"done":true/false,"question":"下一问的具体问法（一句话，可带小场景）","intent":"这一问想验证什么","difficulty":1-5}`
  const { data } = await chatJson<any>({ task: 'interview_probe', role: 'strong', endpointId: opts.endpointId, refType: 'question', refId: q.id, maxTokens: 500, user, system: `你在模拟真实技术面试的追问链，禁止问大而空的问题。${JSON_ONLY}` })
  return { question: String(data.question ?? ''), intent: data.intent, difficulty: data.difficulty, done: !!data.done }
}

// ---------- 4. 就地答疑 ----------
/** role 可显式指定：默认走内置答疑小模型（tutor），用户对本地回答不满意时可传 'strong' 换云端重答 */
export async function qaExplain(q: Question, nodeTitle: string, question: string, prior: { role: string; content: string }[] = [], opts: { endpointId?: string; role?: 'tutor' | 'strong' } = {}): Promise<QaResult> {
  const ctx = prior.length ? prior.slice(-6).map((p) => `${p.role}: ${p.content}`).join('\n') : ''
  const user = `我正在练习一道面试题，知识点是「${nodeTitle}」。
${qDigest(q)}
${ctx ? `【此前对话】\n${ctx}\n` : ''}【我的问题】
${question}

请针对我的疑问直接解答（不要复述整题解析），必要时给最小可运行示例或一段代码。输出 JSON：
{"answer":"解答正文，≤300字","confidence":0-1,"miniExample":"可选：最小例子或代码，没有就空字符串","relatedNodes":["这个疑问还牵涉哪些概念（中文名）"]}`
  const { data } = await chatJson<any>({ task: 'qa_explain', role: 'strong', endpointId: opts.endpointId, refType: 'question', refId: q.id, maxTokens: 900, user, system: `你是随身的技术教练，回答要准确、直给、不绕。不确定就说不确定。${JSON_ONLY}` })
  return { answer: String(data.answer ?? ''), confidence: data.confidence, miniExample: data.miniExample, relatedNodes: Array.isArray(data.relatedNodes) ? data.relatedNodes : [] }
}

// ---------- 5. 变体生成 ----------
export async function genVariants(q: Question, existingStems: string[], nodeTitle: string, n = 2, opts: { endpointId?: string; knowledgeMd?: string } = {}): Promise<VariantLite[]> {
  const avoid = existingStems.length ? `\n已有题干（不得雷同，也不得只改数字标点）：\n${existingStems.map((s) => '- ' + s.slice(0, 90)).join('\n')}` : ''
  const angles = '换业务场景 / 换问法角度 / 增加约束条件 / 反向问法（这样做会怎样）/ 追问延伸'
  const kb = opts.knowledgeMd
    ? `\n【该考点已收录的知识正文，变体只能考材料里的事实，不许引入材料外的 API/版本号】\n${opts.knowledgeMd.slice(0, 3200)}\n`
    : ''
  const base = { ...q, variants: undefined }
  const user = `知识点：${nodeTitle}
${qDigest(base)}${kb}${avoid}

请出 ${n} 道**同一考点**的变体题，改写手法只能从下列里选并标注：${angles}。
保持题型与难度接近（可有小幅波动）。客观题必须给唯一正确答案与错项设计说明，主观题必须给 scoringPoints。输出 JSON：
{"variants":[{"stem":"新题干","angle":"所用手法","options":[{"key":"A","text":"…"}],"answer":{"keys":["A"],"ref":"参考答案"},"scoringPoints":[{"point":"…","weight":2}],"analysis":"为什么这样答才对","gapCheck":["这题额外要小心的点"]}]}
${['single', 'multiple'].includes(q.type) ? '每道变体的 options 都必须重新设计（不能照抄原选项）。' : '主观题的 answer.keys 留空数组即可。'}`
  const { data } = await chatJson<any>({ task: 'gen_variants', role: 'strong', endpointId: opts.endpointId, refType: 'question', refId: q.id, maxTokens: 2200, user, system: `你负责为面试题库产出高质量变体，绝不与原题雷同。${JSON_ONLY}` })
  const list = Array.isArray(data.variants) ? data.variants : Array.isArray(data) ? data : []
  return list.filter((v: any) => v?.stem).map((v: any) => ({ ...v, angle: v.angle ?? '换问法' }))
}

// ---------- 6. 脏题复核 ----------
export async function triageDirty(q: Question, reason: string, userEdit?: string, opts: { endpointId?: string } = {}): Promise<{ action: 'fix' | 'retire' | 'replace' | 'keep'; patch?: any; reason: string }> {
  const user = `${qDigest(q)}
【用户举报理由】
${reason || '（未填写）'}
${userEdit ? `\n【用户手动修订后的内容 JSON】\n${userEdit}` : ''}

判断这道题该怎么处理：题干或答案有错但能修 → fix（给出 patch，只含需改字段）；题目过时或考点已废 → retire；题目本身没坏但用户想要另一角度 → replace（另出一题）；举报不成立 → keep。
输出 JSON：{"action":"fix|retire|replace|keep","patch":{"stem":"…","answer":{"keys":["B"]},"analysis":"…（只写需要改的字段）"},"reason":"判定理由，≤80字"}`
  const { data } = await chatJson<any>({ task: 'dirty_triage', role: 'strong', endpointId: opts.endpointId, refType: 'question', refId: q.id, maxTokens: 1200, user, system: `你是题库质量守门人，宁可 retire 也不要留下有争议答案的题。${JSON_ONLY}` })
  return { action: ['fix', 'retire', 'replace', 'keep'].includes(data.action) ? data.action : 'keep', patch: data.patch, reason: String(data.reason ?? '') }
}

export { NoEndpoint }
