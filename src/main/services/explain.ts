import { all, get, run } from '../db'
import { chat, NoEndpoint } from '../ai/gateway'
import { retrieveForTutor, formatMaterialsBlock } from './question-retrieval'
import { checkClaims, buildRetryHint } from '../../shared/claim-guard.mjs'

/**
 * AI 通俗解析（契约 KNOWLEDGE-SYSTEM.md §6）。
 *
 * 定位：知识正文是「标准答案」，这里解决用户「看了答案还是不懂」——
 * 按他的困惑原话，用已经点亮的前置概念作已知量，由浅入深重讲一遍。
 * 结果写 ai_explain 并兼当缓存：同一 (node, ask, style) 直接复用，不重复烧 token。
 */

export type ExplainStyle = 'easier' | 'example' | 'short' | 'from-prereq'

export const STYLE_HINT: Record<ExplainStyle, string> = {
  easier: '用更通俗的话重讲，避开行话，必要时用生活类比，让没接触过这个概念的人也能懂',
  example: '以可运行/可对照的具体例子为主线讲，先给最小例子，再逐步加条件，最后再点出抽象结论',
  short: '压缩到 5 句话以内，只保留最关键的因果链，不要铺背景',
  'from-prereq': '从前置知识一步步推出来：先复述前置概念，再说明它解决不了什么问题，最后自然引出本考点'
}

const STYLE_TITLE: Record<ExplainStyle, string> = {
  easier: '更通俗', example: '举例讲', short: '五句话', 'from-prereq': '从前置讲起'
}
export const explainStyleTitle = (s: string) => STYLE_TITLE[s as ExplainStyle] ?? '更通俗'

/** 追问 chips：点一下就是一个新的 ask，降低提问门槛 */
export const EXPLAIN_FOLLOWUPS: { label: string; ask: string; style: ExplainStyle }[] = [
  { label: '再简单一点', ask: '还是没完全懂，能不能再简单一点，少用术语', style: 'easier' },
  { label: '举个例子', ask: '给我一个最小可运行的例子，逐行解释发生了什么', style: 'example' },
  { label: '五句话讲完', ask: '我时间紧，用五句话把最关键的东西讲完', style: 'short' },
  { label: '从前置讲起', ask: '我前置概念也不熟，从前置知识一步步推到这里', style: 'from-prereq' }
]

interface ExplainInput {
  nodeId: string
  ask?: string | null
  style?: ExplainStyle
  questionId?: string | null
}

function cacheKey(nodeId: string, ask: string, style: ExplainStyle) {
  return { nodeId, ask: ask.trim().slice(0, 500), style }
}

/** 读缓存（同一问法二次打开直接显示，并标注生成时间） */
export function getCachedExplain(nodeId: string, ask: string, style: ExplainStyle) {
  const k = cacheKey(nodeId, ask, style)
  return get<{ id: number; answer_md: string; model: string; tokens: number; ms: number; created_at: string }>(
    `SELECT id,answer_md,model,tokens,ms,created_at FROM ai_explain
     WHERE node_id=? AND ask=? AND style=? ORDER BY id DESC LIMIT 1`,
    [k.nodeId, k.ask, k.style]) ?? null
}

/** 拼上下文：本考点正文（若已收录）+ 前置考点的一句话本质，只用「已点亮」前置作已知概念 */
function buildContext(nodeId: string) {
  const node = get<{ id: string; title: string; summary: string | null }>(
    `SELECT id,title,summary FROM nodes WHERE id=?`, [nodeId])
  const knowledge = (() => {
    try {
      return get<{ body_md: string; summary: string | null }>(
        `SELECT body_md,summary FROM knowledge WHERE node_id=?`, [nodeId]) ?? null
    } catch { return null }   // knowledge 表由 schema v3 保证存在，try 仅防御旧库/测试库
  })()
  // 前置只取门槛边（advance 进阶 / depend 依存），且要求已点亮，避免引入用户没学过的术语
  const pres = all<{ id: string; title: string; summary: string | null; lit: number; type: string }>(
    `SELECT n.id,n.title,n.summary,m.lit,e.type FROM edges e
     JOIN nodes n ON n.id=e.from_id LEFT JOIN node_mastery m ON m.node_id=n.id
     WHERE e.to_id=? AND e.type IN ('advance','depend') AND COALESCE(m.lit,0)=1`, [nodeId])
  // 语义网邻居（平行/对比/类比/印证）：帮 AI 讲解时主动衍生、讲得更深入，只取已点亮避免引入生词
  const peers = all<{ id: string; title: string; summary: string | null; type: string; note: string | null }>(
    `SELECT n.id,n.title,n.summary,e.type,e.note FROM edges e
     JOIN nodes n ON n.id=CASE WHEN e.from_id=? THEN e.to_id ELSE e.from_id END
     JOIN node_mastery m ON m.node_id=n.id
     WHERE (e.from_id=? OR e.to_id=?) AND e.type IN ('parallel','contrast','analogy','verify')
       AND COALESCE(m.lit,0)=1 AND n.id != ? LIMIT 8`,
    [nodeId, nodeId, nodeId, nodeId])
  return { node, knowledge, pres, peers }
}

export async function explainNode(input: ExplainInput) {
  const style: ExplainStyle = input.style ?? 'easier'
  const ask = (input.ask ?? '').trim() || '我看了解析还是不太懂，帮我讲明白这个考点'
  const cached = getCachedExplain(input.nodeId, ask, style)
  if (cached) return { ...cached, cached: true, style }

  const { node, knowledge, pres, peers } = buildContext(input.nodeId)
  if (!node) throw new Error(`考点不存在：${input.nodeId}`)

  const REL_LABEL: Record<string, string> = {
    parallel: '平行', contrast: '易混对比', analogy: '可类比', verify: '跨域印证'
  }
  const prereqBlock = pres.length
    ? pres.map((p) => `- ${p.title}：${p.summary ?? '（无一句话总结）'}`).join('\n')
    : '（暂无已点亮的前置考点，请从最基础的概念讲起，不要假设用户懂相关术语）'
  const peerBlock = peers.length
    ? peers.map((p) => `- 【${REL_LABEL[p.type] ?? p.type}】${p.title}${p.note ? `：${p.note}` : ''}`).join('\n')
    : ''
  const knowledgeBlock = knowledge
    ? `## 已收录的知识正文（事实以此为准，不要编造材料外的 API/版本号）\n${knowledge.body_md.slice(0, 2000)}`
    : '（该考点还没有收录知识正文，请基于 Vue/前端通用事实谨慎作答，拿不准的地方明确说明）'
  const qBlock = input.questionId
    ? `\n用户正在看的题目 id：${input.questionId}（题目解析他看过了仍有疑问）` : ''

  const system = `你是一名资深前端面试官转的私教，面对的是正在准备面试、基础不牢的学习者。
要求：
1. ${STYLE_HINT[style]}；
2. 只把「已点亮的前置概念」当已知量，不要引入用户还没学过的术语，必须出现的新术语要当场用一句话解释；
3. 字数硬约束（超出会被直接截断，比答得短更糟）：正文 130 字以内。结构固定为「一句话结论 + 最多 2 条要点」，不要代码块、不要表格、不要小标题；只在用户明确要求「展开/详细/举个例子」时才写长；
4. 输出 Markdown：先一句话结论，再用「为什么 / 怎么理解 / 容易错在哪」里最相关的 1-2 个小节，不要机械地三段全写；
5. 若给了「语义网邻居」，讲解末尾可自然带一句它与这些已学知识的对比/类比/印证（帮助他把知识串成网），但不要生硬罗列、不要为了关联而关联；
6. 事实只能来自给定知识正文，拿不准就说「这里需要再查官方文档」，不许编 API 细节和版本号。`
  const user = `# 考点
${node.id} ${node.title}
能力要求：${node.summary ?? '（无）'}

# 用户已点亮的前置（可以当作他会的）
${prereqBlock}
${peerBlock ? `\n# 语义网邻居（用户已学过，可用于对比/类比/印证衍生）\n${peerBlock}\n` : ''}
${knowledgeBlock}${qBlock}

# 用户的困惑
${ask}

# 风格
${STYLE_HINT[style]}。请直接输出讲解正文。`

  let res
  try {
    res = await chat({ task: 'ai-explain', role: 'tutor', system, user, refId: input.nodeId, refType: 'node', timeoutMs: 120000 })
  } catch (e) {
    if (e instanceof NoEndpoint) return { error: 'no-endpoint', message: e.message }
    throw e
  }
  const info = run(`INSERT INTO ai_explain(node_id,ask,style,model,tokens,ms,answer_md) VALUES(?,?,?,?,?,?,?)`,
    [input.nodeId, ask.slice(0, 500), style, res.model, res.inTokens + res.outTokens, res.ms, res.text])
  return {
    id: Number(info.lastInsertRowid), answer_md: res.text, model: res.model,
    tokens: res.inTokens + res.outTokens, ms: res.ms, created_at: new Date().toISOString(), cached: false, style
  }
}

/** 某考点已生成过的通俗解析历史（知识抽屉里展示「我问过的问题」） */
export function explainHistory(nodeId: string, limit = 20) {
  return all<{ id: number; ask: string; style: string; created_at: string }>(
    `SELECT id,ask,style,created_at FROM ai_explain WHERE node_id=? ORDER BY id DESC LIMIT ?`, [nodeId, limit])
}

/* ===================================================================== *
 * R22 受限多轮辅导对话（tutorChat）
 * 定位：把一次性「简短讲一下」升级成「随身私教」——
 *   多轮上下文、作用域硬护栏（只谈本考点及其前置/关联）、零基础可从前置讲起、
 *   可引导用户退到更基础的题。对话只活在前端内存，不落库、不做缓存（每轮上下文不同，缓存无意义）。
 * ===================================================================== */

export interface TutorTurn { role: 'user' | 'assistant'; content: string }
export interface TutorPrereq { id: string; title: string; lit: boolean; summary: string | null }
export interface TutorChatResult {
  answer_md: string
  model: string
  tokens: number
  ms: number
  /** 越界标记：模型判定这轮提问与本考点无关，已礼貌挡回并引回正题 */
  offTopic: boolean
  /** 模型建议回补的前置考点（取它点名的 id，与库中真实前置求交，前端据此渲染「去学/去练」卡片） */
  suggestPrereq: TutorPrereq | null
  /** 引用校验结果：ok=false 表示回答里出现了材料中找不到的技术实体，前端可提示「建议核对」 */
  claims?: { ok: boolean; unknown: string[]; unknownVersions: string[]; message: string }
  /** 是否因引用校验失败触发过一次重写（用于观测校验的实战命中率） */
  retried?: boolean
}

const MAX_TUTOR_TURNS = 20            // 只带最近 10 轮，控制 token 与注意力漂移
const MAX_USER_CHARS = 800

/**
 * 取一个考点的全部前置（advance 硬门槛 + depend 理解地基），不要求已点亮——
 * 零基础用户的前置恰恰是没点亮的，要让私教能点名回补。
 */
export function tutorPrerequisites(nodeId: string): TutorPrereq[] {
  return all<{ id: string; title: string; summary: string | null; lit: number }>(
    `SELECT DISTINCT n.id,n.title,n.summary,COALESCE(m.lit,0) AS lit
     FROM edges e JOIN nodes n ON n.id=e.from_id
     LEFT JOIN node_mastery m ON m.node_id=n.id
     WHERE e.to_id=? AND e.type IN ('advance','depend')
     ORDER BY lit ASC, n.ord ASC LIMIT 8`, [nodeId])
    .map((r) => ({ id: r.id, title: r.title, summary: r.summary, lit: !!r.lit }))
}

/** 私教上下文：复用 buildContext 的考点/正文/已点亮邻居，再补全量前置（含未点亮） */
function buildTutorContext(nodeId: string) {
  const base = buildContext(nodeId)
  const allPrereqs = tutorPrerequisites(nodeId)
  return { ...base, allPrereqs }
}

export async function tutorChat(input: {
  nodeId: string
  question: string
  history?: TutorTurn[]
  questionId?: string | null
  /** 默认走内置答疑小模型；用户点「换云端重答」时传 'strong' */
  role?: 'tutor' | 'strong'
}): Promise<TutorChatResult | { error: 'no-endpoint'; message: string }> {
  const question = (input.question ?? '').trim().slice(0, MAX_USER_CHARS)
  if (!question) throw new Error('提问内容为空')
  const { node, knowledge, pres, peers, allPrereqs } = buildTutorContext(input.nodeId)
  if (!node) throw new Error(`考点不存在：${input.nodeId}`)

  // 事实材料：从题目检索索引取。用户正在做的那道题必选（讲解必须以它的标准解析为锚），
  // 再补同考点相关题与跨考点同主题题用于类比。检索为空时走「材料不足」的诚实路径。
  const materials = retrieveForTutor({
    nodeId: input.nodeId,
    query: question,
    questionId: input.questionId ?? null,
    limit: 4
  })
  // 校验语料 = 所有材料原文 + 知识正文；没有语料就无从做引用校验
  const corpus: string[] = [
    ...materials.map((m) => m.corpus),
    knowledge?.body_md ?? ''
  ].filter((s): s is string => Boolean(s))

  const REL_LABEL: Record<string, string> = {
    parallel: '平行', contrast: '易混对比', analogy: '可类比', verify: '跨域印证'
  }
  // 全量前置：标注点亮态，让私教知道哪些是用户的「已知量」、哪些要从零讲
  const prereqBlock = allPrereqs.length
    ? allPrereqs.map((p) => `- ${p.title}（${p.lit ? '已点亮，可当已知量' : '尚未学习，若是零基础应从这里补'}）：${p.summary ?? '（无一句话总结）'}`).join('\n')
    : '（该考点在图谱里没有登记前置，说明它本身就是入门级：请直接从最基础的概念讲起，不要假设任何背景）'
  const peerBlock = peers.length
    ? peers.map((p) => `- 【${REL_LABEL[p.type] ?? p.type}】${p.title}${p.note ? `：${p.note}` : ''}`).join('\n')
    : ''
  // 事实来源 = 知识正文（若已收录）+ 题目材料（标准解析/易漏点/标准答案）。
  // 题目材料按 question_fts 检索：用户正在做的那道题必选，再补同考点相关题与跨考点同主题题。
  const questionBlock = formatMaterialsBlock(materials)
  const knowledgeText = knowledge ? `## 已收录的知识正文\n${knowledge.body_md.slice(0, 1200)}` : ''
  const factsBlock = [
    knowledgeText,
    questionBlock
      ? `## 题库材料（讲解本题的事实依据；原文里没有的 API/类名/配置键/版本号一律不许写）\n${questionBlock}`
      : ''
  ].filter(Boolean).join('\n\n')
  const factsSection = factsBlock || '（这个考点还没有收录知识正文与题目材料。只讲该领域的通识结论，把不确定的细节明确标注为「需要查官方文档」，绝对不要写出具体的 API 名、配置键或版本号）'

  // 只带最近若干轮，最旧的丢弃；并防御脏数据
  const hist = (input.history ?? []).filter((t) => t && (t.role === 'user' || t.role === 'assistant') && t.content).slice(-MAX_TUTOR_TURNS)
  const historyBlock = hist.length
    ? hist.map((t) => (t.role === 'user' ? '学习者：' : '私教：') + t.content.slice(0, 600)).join('\n')
    : '（这是本轮对话的第一个问题）'
  const qBlock = input.questionId
    ? `\n学习者正卡在一道题（题目 id：${input.questionId}），他可能连题面术语都没见过，讲解要能兜住零基础。` : ''

  const system = `你是一名耐心的技术私教，正在帮一位准备面试、基础不牢的学习者吃透「${node.title}」这个考点。

# 铁律：作用域护栏
1. 只回答与「${node.title}」直接相关、或是理解它所必需的前置/关联知识。判定无关的提问（闲聊、别的技术栈、与本考点无关的时事/写作/通用百科等），不要顺着答，先用一句话礼貌说明「这个问题和当前考点无关，我先带你把眼前这个学会」，再把话头拉回本考点。
2. 事实只能来自下方给定的材料（知识正文 + 题库材料）。材料里没出现过的 API 名、类名、配置键、版本号一律不许写出来——写不出就换个说法，或明说「这一处需要查官方文档」。宁可少说，不许凑。

# 怎么教（根据学习者的反应自适应，不要每轮都一个套路）
3. 先判断他卡在哪一层：是术语都没见过（零基础）、概念有模糊印象、还是懂概念但不会用。零基础就从「全量前置」里最该补的那一个讲起，用大白话+生活类比，把新术语当场用一句话解释，不许堆术语。
4. 一次只推进一小步，讲完可以抛一个很轻的反问确认他跟上了（而不是一口气倒长文）。字数硬约束：正文 130 字以内、结构固定为「一句话结论 + 最多 2 条要点」；他明确要求「详细/展开」才写长。
5. 如果他的困惑本质是前置没掌握，不要硬讲当前考点，明确告诉他应该先学哪个前置，并在最后一行用规定格式给出前置 id（见下），引导他退回去补基础、做更简单的题。
6. 已经讲过的内容换个更通俗的角度或换个例子，不要原样重复；他说懂了就往「怎么用、容易错在哪」推进一步。

# 输出格式（严格遵守，多写会被截断）
- 只输出「结论：<一句话>」「要点1：<一句话>」「要点2：<一句话>」三行，每行不超过 45 字；不要标题、不要表格、不要代码块、不要寒暄。
- 若需要代码说明，在要点里口头描述，不要贴代码块。
- 最后一行用于结构化信号，二选一：
  - 若你判定这轮提问与本考点无关：单独一行写 <<<OFFTOPIC>>>
  - 若你建议先回补某个前置考点：单独一行写 <<<PREREQ:前置节点id>>>。
    前置节点 id 只能从下面「全量前置」每条开头的 id 里原样复制（例如 ${allPrereqs[0]?.id ?? '形如 ai.xxx.yyy'}）；
    若实在拿不准 id，可在信号行写该前置的完整中文标题 <<<PREREQ:标题>>>，但不要自己编造 id，也不要把多句话塞进信号行。
    不需要回补就不要写这行。
- 除上述信号行外，正文里不要出现 <<< 标记。`

  const user = `# 当前考点
${node.id} ${node.title}
能力要求：${node.summary ?? '（无）'}
${qBlock}
# 全量前置（含尚未学习的，零基础时从这里选起点）
${prereqBlock}
${peerBlock ? `\n# 已学过的关联知识点（可用于对比/类比，别引入清单外的概念）\n${peerBlock}\n` : ''}
${factsSection}

# 此前对话（延续上下文，别重复已经讲透的内容）
${historyBlock}

# 学习者这一轮的问题
${question}

请直接输出讲解正文，并按规则在需要时于最后一行追加信号标记。`

  const askOnce = (hint = '') => chat({
    task: 'ai-tutor', role: input.role ?? 'tutor', system,
    user: hint ? `${user}${hint}` : user,
    refId: input.nodeId, refType: 'node', timeoutMs: 120000
  })

  let res
  try {
    res = await askOnce()
  } catch (e) {
    if (e instanceof NoEndpoint) return { error: 'no-endpoint', message: e.message }
    throw e
  }

  // 引用校验：回答里的技术实体必须能在材料原文里找到。
  // 没有材料就没有对比基准，此时不做校验（也不重试），由 factsSection 的「材料不足」话术兜住。
  // 4B 对「具体黑名单」的服从度明显高于笼统的「别编造」，所以失败就带着黑名单重写一次。
  const stripSignals = (s: string) => s.replace(/<<<[^>]*>>>/g, '')
  let raw = res.text
  let claims = checkClaims(stripSignals(raw), corpus)
  let retried = false
  if (!claims.ok && corpus.length) {
    try {
      const res2 = await askOnce(buildRetryHint(claims))
      const c2 = checkClaims(stripSignals(res2.text), corpus)
      const bad1 = claims.unknown.length + claims.unknownVersions.length
      const bad2 = c2.unknown.length + c2.unknownVersions.length
      // 只在重写后依据更足时才采纳，避免「越改越跑偏」反而丢弃第一版
      if (bad2 < bad1) { res = res2; raw = res2.text; claims = c2; retried = true }
    } catch { /* 重写失败保留第一版，由 claims 字段告诉前端「建议核对」 */ }
  }

  // 从模型输出里剥离信号行，转成结构化标记；信号行只允许出现在末尾
  const offTopic = /<<<OFFTOPIC>>>\s*$/m.test(raw)
  // 信号体可能是节点 id（英文），也可能被本地小模型写成中文标题——两种都接住再与真实清单求交
  const pm = raw.match(/<<<PREREQ:([^>]+)>>>\s*$/m)
  const signal = pm ? pm[1].trim() : ''
  // 剥离任意 PREREQ/OFFTOPIC 信号行（PREREQ 体内含中文，不能只用 ASCII 字符类）
  const answer_md = raw.replace(/\s*<<<(?:OFFTOPIC|PREREQ:[^>]*)>>>\s*$/gm, '').trim()
  // 模型点名的前置必须真实存在于本考点前置清单，防止幻觉：先按 id 精确匹配，再按标题归一化匹配
  const norm = (s: string) => s.replace(/[\s:：，,。.（）()【】「」""'']/g, '').toLowerCase()
  const sigNorm = norm(signal)
  const suggestPrereq = signal
    ? (allPrereqs.find((p) => p.id === signal)
       ?? allPrereqs.find((p) => sigNorm && norm(p.title).includes(sigNorm))
       ?? allPrereqs.find((p) => sigNorm && sigNorm.includes(norm(p.title)))
       ?? null)
    : null

  return {
    answer_md, model: res.model, tokens: res.inTokens + res.outTokens, ms: res.ms,
    offTopic, suggestPrereq, retried,
    claims: {
      ok: Boolean(claims.ok),
      unknown: Array.isArray(claims.unknown) ? claims.unknown : [],
      unknownVersions: Array.isArray(claims.unknownVersions) ? claims.unknownVersions : [],
      message: String(claims.message ?? '')
    }
  }
}
