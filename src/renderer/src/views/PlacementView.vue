<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { QuestionRow } from '@shared/types'
import QuestionBody from '../components/QuestionBody.vue'
import Icon from '../components/Icon.vue'
import GapTutor from '../components/GapTutor.vue'
import KnowledgeDrawer from '../components/KnowledgeDrawer.vue'
import { DOMAIN_LABEL, TYPE_LABEL, TYPE_ICON_NAME, DIFF_LABEL, toast, message, typePillClass, renderMd } from '../lib/ui'
import { ipc } from '../lib/ipc'

/**
 * 入门摸底向导（R9-①，R11 增补回看）。
 * 与旧的"按难度随机 8 题"不同：后端沿 edges.prereq 前置链循序渐进出题，
 * 用户可直接标记"不会"并指明原因（知识点不懂 / 不会手写代码 / 跳过），
 * 系统据此下探前置、刨根问底，结论与节点掌握度常态化落库，可断点续测。
 *
 * R11：提交后不再自动跳走，先停在本题展示判定/参考答案/解析，用户可回看本组做过的每一题
 * （万一某题是蒙的），回看只读、可对蒙题追加 0 档纠偏；自己点「下一题」才推进探针。
 * 摸底是后端逐题流式出题（不像练习有固定队列），故回看快照只在当前会话前端内存维护。
 */
const router = useRouter()

type GapType = 'concept' | 'code' | 'skip' | 'guess'

/** 单题在本次摸底内的作答快照：回看据此还原「题目 + 我答了什么 + 判定 + 参考答案/解析」 */
interface PlacementSnap {
  item: QuestionRow
  answer: any
  scale4: number
  pct: number
  verdict: string
  gapType: string | null
  guessed: boolean
}

const phase = ref<'intro' | 'running' | 'done'>('intro')
const domain = ref('fe')
const sessionId = ref('')
const item = ref<QuestionRow | null>(null)
const answer = ref<any>(null)
const hint = ref('')
const progress = ref({ done: 0, total: 0 })
const busy = ref(false)
const lastResult = ref<{ scale4: number; verdict: string; gapType: string | null } | null>(null)
const showGap = ref(false)
const gapNote = ref('')
/**
 * R24 提交「我不会」后立即开讲的 AI 专项辅导：
 * 原来只回一句「已记录缺口」，用户拿不到任何解答；现在把用户的原话当首问发给 tutor，
 * 就地渲染讲解并给「看讲义 / 去练前置」入口。seed 为空表示这题还没触发讲解（如 skip/回看态）。
 */
const gapTutorSeed = ref<{ nodeId: string; nodeTitle: string | null; questionId: string; ask: string } | null>(null)
/** 三类缺口在用户没写具体描述时的兜底首问：让 AI 从零基础讲起，而不是复述题面 */
const GAP_DEFAULT_ASK: Record<string, string> = {
  concept: '我完全没学过这个知识点，相关术语也看不懂。请从最基础的地方讲起，先解释这题涉及的概念到底是什么意思，再告诉我该先学什么',
  code: '原理我大概能听懂，但自己写不出来。请从最小可写的一段代码开始，一步步告诉我先写什么、再写什么',
  guess: '这题我是蒙的，其实完全不会。请从零基础讲起，先告诉我这题在问什么、需要哪些前置知识'
}
/**
 * R19 先学后测：当前题是否为「资料依赖题」（learnFirst=true）。
 * 这类题作答前先展示 resources 学习材料，用户点「我已学完，开始作答」才解锁题面，
 * 把「没读过论文只能蒙」变成「先学后测」。每切到一道新题据此重置解锁态。
 */
const learnUnlocked = ref(false)
const summary = ref<any>(null)
const gaps = ref<any[]>([])
const history = ref<any[]>([])
/**
 * 各板块「未完成摸底」会话 id 映射（domain → sessionId）。
 * 点卡片时据此自动续测而不是新建空壳；null 表示该板块没有可续的会话。
 */
const activeByDomain = ref<Record<string, string>>({})

/* ---- R11 本组回看：快照队列 + 游标 + 只读回看态 ---- */
/** 本次摸底已作答的每一题快照（按作答顺序）；下标即题号（从 0 起） */
const snaps = ref<PlacementSnap[]>([])
/** 当前展示的快照下标；-1 表示正在作答的「当前新题」（不在 snaps 内） */
const viewIdx = ref(-1)
/**
 * 是否处于回看只读态：经胶片/上一题/下一题翻到某道已作答题时为 true。
 * 停在刚提交的最新题、或点「下一题」进入的新待答题为 false（可作答）。
 */
const browsing = ref(false)
/** 后端 submit 返回的下一道题（手动点「下一题」才挂上），未提交时为 null */
const pendingNext = ref<QuestionRow | null>(null)
const pendingHint = ref('')
const guessBusy = ref(false)
/** 最后一题提交后置位：仍允许回看本组题，用户确认后才进完成页 */
const finishAfterReview = ref(false)

const domainEntries = computed(() => Object.entries(DOMAIN_LABEL).map(([value, label]) => ({ value, label })))

/**
 * 板块视觉元数据：每个板块一个线性图标 + 一个语义色（值为 CSS 变量表达式，明暗主题自动适配，
 * 不硬编码 hex，符合 UI-DESIGN-SYSTEM §1/§3）。卡片通过 color-mix 派生徽标底色与高亮描边。
 */
const DOMAIN_META: Record<string, { icon: string; color: string; desc: string }> = {
  fe: { icon: 'layers', color: 'var(--accent)', desc: 'HTML · CSS · JS · 框架' },
  be: { icon: 'gear', color: 'var(--cyan)', desc: '语言 · 并发 · 存储 · 框架' },
  cs: { icon: 'book', color: 'var(--purple)', desc: '计网 · 操作系统 · 数据结构' },
  ai: { icon: 'brain', color: 'var(--hot)', desc: 'LLM · RAG · Agent 工程' },
  eng: { icon: 'zap', color: 'var(--warn)', desc: '真实场景 · 故障复盘 · 权衡' }
}
const metaOf = (dom: string) => DOMAIN_META[dom] ?? { icon: 'target', color: 'var(--accent)', desc: '' }

/** 启动后后端判定为空板块（无完整考点/题目）的板块：入口卡片置灰，杜绝再点进白屏（R12） */
const emptyDomains = ref<Set<string>>(new Set())
function markEmpty(dom: string, msg: string) {
  emptyDomains.value.add(dom)
  emptyDomains.value = new Set(emptyDomains.value)
  message.warning(msg)
}
/** 当前渲染的题目：回看态取快照里的题，否则取活动 item */
const cur = computed<QuestionRow | null>(() => {
  if (browsing.value && viewIdx.value >= 0) return snaps.value[viewIdx.value]?.item ?? item.value
  return item.value
})
const progressPct = computed(() => (progress.value.total ? Math.round((progress.value.done / progress.value.total) * 100) : 0))

/* ---- 回看派生 ---- */
/** 当前题对应的快照（回看态或最新已答题） */
const curSnap = computed<PlacementSnap | null>(() => {
  if (browsing.value && viewIdx.value >= 0) return snaps.value[viewIdx.value] ?? null
  // 停在刚提交的最新题：item 即最新快照的题
  if (lastResult.value) return snaps.value.find((s) => s.item.id === item.value?.id) ?? null
  return null
})
const isReview = computed(() => browsing.value && !!curSnap.value)
const canPrevSnap = computed(() => viewIdx.value > 0)
const guessedNow = computed(() => !!curSnap.value?.guessed)
/** 胶片每个点的态：当前 / 蒙题 / 对(scale4≥2) / 错或缺口 */
function dotClass(i: number) {
  if (browsing.value && i === viewIdx.value) return 'cur'
  if (!browsing.value && i === snaps.value.length - 1 && lastResult.value) return 'cur'
  const s = snaps.value[i]
  if (!s) return 'todo'
  if (s.guessed) return 'guessed'
  return s.scale4 >= 2 ? 'good' : 'bad'
}
function dotTitle(i: number) {
  const s = snaps.value[i]
  if (!s) return `第 ${i + 1} 题：还没做到`
  const base = `第 ${i + 1} 题`
  if (s.guessed) return `${base}：已标记蒙的（按完全不会计入）`
  if (s.gapType) return `${base}：标记了缺口，点击回看`
  return `${base}：${SCALE_TEXT[s.scale4]}，点击回看我的作答与解析`
}
const analysisHtml = computed(() => (cur.value?.q?.analysis ? renderMd(cur.value.q.analysis) : ''))

/** R19 当前题是否为「先学后测」资料依赖题（仅未提交的活动题需要先学解锁） */
const isLearnFirst = computed(() => !lastResult.value && cur.value?.q?.learnFirst === true)
/** 先学材料：题目自带的 resources 摘要（题库已为先学题备齐），渲染为 Markdown */
const learnMaterialHtml = computed(() => {
  const res = cur.value?.q?.resources
  if (!Array.isArray(res) || !res.length) return ''
  return renderMd(res.map((r) => `**${r.title}**\n\n${r.digest}`).join('\n\n---\n\n'))
})
/** 先学题在未解锁时禁用作答；普通题恒可作答 */
const inputDisabled = computed(() => isLearnFirst.value && !learnUnlocked.value)

const GAP_OPTIONS: { type: GapType; label: string; desc: string; icon: string }[] = [
  { type: 'concept', label: '知识点不懂', desc: '概念/原理没掌握，回到前置知识重讲', icon: 'brain' },
  { type: 'code', label: '不会手写代码', desc: '原理大概懂，但让我写就写不出来', icon: 'zap' },
  { type: 'skip', label: '直接跳过', desc: '这题暂时不想答，标记为未掌握', icon: 'chevron' }
]

async function checkResume() {
  // 逐板块探测未完成会话：卡片上给出「继续」标记，点击时由后端 start 自动续测，杜绝新建空壳顶掉旧进度
  const map: Record<string, string> = {}
  await Promise.all(domainEntries.value.map(async (d) => {
    try {
      const r = await ipc.placement.resume(d.value)
      if (r?.sessionId && r.item) map[d.value] = r.sessionId
    } catch { /* 旧后端无 resume 时静默 */ }
  }))
  activeByDomain.value = map
  try { history.value = await ipc.placement.history(10) } catch { history.value = [] }
}

async function start(dom: string) {
  domain.value = dom
  busy.value = true
  try {
    // 默认让后端复用该板块未完成会话（同一点击入口同时覆盖「新建」与「续测」），
    // 有旧进度时返回 resumed=true，前端给出明确提示而不是默默重开第一道题。
    const r = await ipc.placement.start(dom)
    // 后端探测为空板块：不切 running（否则 running 模板 cur=null 整页空白、连退出按钮都不渲染）
    if (!r.item || !r.sessionId) {
      markEmpty(dom, r.hint || '这个板块题库还没铺好，暂时无法摸底')
      return
    }
    sessionId.value = r.sessionId
    item.value = r.item
    hint.value = r.hint
    progress.value = r.progress ?? { done: 0, total: 0 }
    phase.value = 'running'
    resetTurn()
    resetReview()
    // 续测时把历史作答还原进胶片（新会话后端返回空数组，无副作用）
    await hydrateHistory(r.sessionId)
    if (r.resumed) toast.note('已恢复你上次没做完的摸底', '之前的作答与考点进度都保留着，从断点继续，不用重做；点上方题号胶片可回看做过的题。')
  } catch (e: any) { toast.err(String(e?.message ?? e)) } finally { busy.value = false }
}

async function resumeSession() {
  busy.value = true
  try {
    // 介绍页顶部横幅为无域兜底入口：取全局最近一个未完成会话
    const r = await ipc.placement.resume()
    if (!r?.sessionId) { await checkResume(); return }
    sessionId.value = r.sessionId
    domain.value = r.domain
    item.value = r.item
    hint.value = r.hint
    progress.value = r.progress ?? { done: 0, total: 0 }
    phase.value = 'running'
    resetTurn()
    resetReview()
    await hydrateHistory(r.sessionId)
  } catch (e: any) { toast.err(String(e?.message ?? e)) } finally { busy.value = false }
}

function resetTurn() {
  answer.value = null
  lastResult.value = null
  showGap.value = false
  gapNote.value = ''
  gapTutorSeed.value = null
  learnUnlocked.value = false
}

/** 开新一轮摸底/续测时清空回看状态 */
function resetReview() {
  snaps.value = []
  viewIdx.value = -1
  browsing.value = false
  pendingNext.value = null
  pendingHint.value = ''
}

/**
 * R15 续测回看：从后端把该会话历史作答轮次还原成胶片快照。
 * 旧实现的回看只活在前端内存，退出再进被 resetReview 清空；现在 turns 已随库持久化，
 * 续测后胶片直接带回做过的每一题（题目 + 我答了什么 + 判定/解析），点题号即可只读回看。
 * 停在待答新题（browsing=false、viewIdx=-1），不抢占当前作答视图。
 */
async function hydrateHistory(sid: string) {
  try {
    const rows = await ipc.placement.turns(sid)
    if (rows?.length) {
      snaps.value = rows.map((r) => ({ ...r }))
      viewIdx.value = -1
      browsing.value = false
    }
  } catch { /* 旧后端无 turns 通道时静默退化为仅当次回看，不阻断续测 */ }
}

/** 正常作答提交（客观题自动判 / 主观题 AI 判） */
async function submitAnswer() {
  if (!item.value || busy.value) return
  busy.value = true
  try {
    const r = await ipc.placement.submit(sessionId.value, item.value.id, answer.value, { gapType: null, gapNote: null })
    await handleResult(r)
  } catch (e: any) { toast.err(String(e?.message ?? e)) } finally { busy.value = false }
}

/**
 * 「我不会」的公共落库路径：三张快捷卡片和输入框自由说明都走这里。
 * note 为用户原话（可选），原样写进 gap_note，缺口报告按 gapType 聚合。
 */
async function doGapSubmit(type: GapType, note: string | null) {
  if (!item.value) return
  const r = await ipc.placement.submit(
    sessionId.value, item.value.id, type === 'skip' ? null : answer.value,
    { gapType: type, gapNote: note }
  )
  await handleResult(r)
  armGapTutor(type, note)
}

/**
 * R24 把「我不会」接上「当场讲解」：
 * 用户提交缺口后不再只收到一句「已记录」，而是立刻用他的原话向 AI 提问（零基础从前置讲起）。
 * 主动跳过（skip）不强行弹讲解；回看历史题也不自动重发，避免烧 token。
 */
function armGapTutor(type: GapType, note: string | null) {
  const c = cur.value
  if (!c || type === 'skip' || !c.node_id) { gapTutorSeed.value = null; return }
  gapTutorSeed.value = {
    nodeId: c.node_id,
    nodeTitle: c.nodeTitle ?? null,
    questionId: c.id,
    ask: (note ?? '').trim() || GAP_DEFAULT_ASK[type] || GAP_DEFAULT_ASK.concept
  }
}

/** 用户不想看记录、只想让 AI 讲这题（回看态 / 主动跳过时的手动入口） */
function askAiNow() {
  const c = cur.value
  if (!c) return
  if (!c.node_id) { toast.warn('这道题没有绑定考点，暂时没法讲；可以先看下方考点解析'); return }
  gapTutorSeed.value = {
    nodeId: c.node_id,
    nodeTitle: c.nodeTitle ?? null,
    questionId: c.id,
    ask: GAP_DEFAULT_ASK[lastResult.value?.gapType ?? 'concept'] ?? GAP_DEFAULT_ASK.concept
  }
}

/** 快捷卡片：类型由用户明确点选（输入框里若有补充说明一并带上） */
async function submitGap(type: GapType) {
  if (!item.value || busy.value) return
  busy.value = true
  try {
    await doGapSubmit(type, gapNote.value.trim() || null)
    toast.note(`已记录缺口：${GAP_LABEL[type] ?? type}`,
      type === 'skip'
        ? '这题先跳过，已按缺口下探前置知识；想看讲解随时点「让 AI 专门讲这题」。'
        : '已下探前置知识，下面 AI 会按这个缺口从头讲；还有具体卡点在下方继续追问就行。')
  } catch (e: any) { toast.err(String(e?.message ?? e)) } finally { busy.value = false }
}

/**
 * R23 输入框自己的提交路径（修复「打了字却发现只能点三个选项」）：
 * 先让服务端把这段描述判成 concept/code/skip（中文强信号走规则、0 延迟；未命中才调 AI），
 * 再带着原话一起提交。用户不必再被迫从三个卡片里挑一个，原文也完整留在缺口记录里。
 */
const noteBusy = ref(false)
const GAP_LABEL: Record<string, string> = { concept: '知识点不懂', code: '不会手写代码', skip: '直接跳过' }
async function submitNote() {
  const note = gapNote.value.trim()
  if (!note) { message.warning('先在框里写一句你具体卡在哪；不想打字也可以直接点下面三个选项'); return }
  if (!item.value || busy.value) return
  busy.value = true
  noteBusy.value = true
  try {
    const r = await ipc.placement.interpretGap(note, item.value.node_id)
    await doGapSubmit(r.gapType, r.note || note)
    const how = r.source === 'rule'
      ? '按你描述里的语义直接判定了缺口类型'
      : r.source === 'ai' ? 'AI 读完你的描述后判定了缺口类型' : '按最保守的「知识点不懂」记录'
    toast.note(`已记录缺口：${GAP_LABEL[r.gapType] ?? r.gapType}`,
      `${how}，已按缺口下探前置知识。你的原话已交给 AI 作答——下面会从你听得懂的地方讲起，听不懂可以直接追问。`)
  } catch (e: any) { toast.err(String(e?.message ?? e)) } finally { busy.value = false; noteBusy.value = false }
}

/**
 * R19「这题我是蒙的」：用户已选答案但承认是猜的。仍提交以拿到客观判分与解析（有学习价值），
 * 后端按 gapType=guess 把能力档位强制记 0、状态机按「不会」收束。比藏在回看里的事后纠偏更靠前。
 */
async function submitGuessed() {
  if (!item.value || busy.value) return
  if (!answer.value) { message.warning('先选一个你的猜测答案，再标记「我是蒙的」'); return }
  busy.value = true
  try {
    const r = await ipc.placement.submit(
      sessionId.value, item.value.id, answer.value, { gapType: 'guess', gapNote: null }
    )
    await handleResult(r)
  } catch (e: any) { toast.err(String(e?.message ?? e)) } finally { busy.value = false }
}

async function handleResult(r: any) {
  lastResult.value = { scale4: r.scale4, verdict: r.verdict, gapType: r.gapType }
  progress.value = r.progress ?? progress.value
  // 落本次作答快照（同题重复提交理论上不会发生——提交后即进只读态，这里按题号去重兜底）
  if (item.value) {
    const snap: PlacementSnap = {
      item: item.value,
      answer: answer.value === null ? null : JSON.parse(JSON.stringify(answer.value)),
      scale4: r.scale4,
      pct: r.pct,
      verdict: r.verdict,
      gapType: r.gapType,
      guessed: false
    }
    const existIdx = snaps.value.findIndex((s) => s.item.id === item.value!.id)
    if (existIdx >= 0) snaps.value[existIdx] = { ...snaps.value[existIdx], ...snap, guessed: snaps.value[existIdx].guessed }
    else snaps.value.push(snap)
  }
  viewIdx.value = snaps.value.length - 1
  browsing.value = false

  if (r.finished || !r.item) {
    // 摸底结束：仍允许回看本组题，延迟到用户浏览完再进完成页
    pendingNext.value = null
    pendingHint.value = r.hint ?? ''
    hint.value = r.hint ?? hint.value
    finishAfterReview.value = true
    return
  }
  // 不自动切题：把下一题挂起，用户看完本题解析/回看完再手动点「下一题」
  pendingNext.value = r.item
  pendingHint.value = r.hint ?? ''
  hint.value = r.hint ?? hint.value
}

/** 手动推进到后端已备好的下一道探针题 */
function goNext() {
  if (finishAfterReview.value) {
    phase.value = 'done'
    void loadResults()
    return
  }
  if (!pendingNext.value) return
  item.value = pendingNext.value
  hint.value = pendingHint.value || hint.value
  pendingNext.value = null
  pendingHint.value = ''
  browsing.value = false
  viewIdx.value = snaps.value.length - 1
  resetTurn()
}

/** 跳到本组某道已作答的快照（回看，只读） */
function reviewSnap(i: number) {
  if (i < 0 || i >= snaps.value.length) return
  browsing.value = true
  viewIdx.value = i
  const s = snaps.value[i]
  // 回看别的题时收起上一题的 AI 讲解（避免讲解和题面对不上），回看态改给「让 AI 讲这题」入口
  if (gapTutorSeed.value && gapTutorSeed.value.questionId !== s.item.id) gapTutorSeed.value = null
  answer.value = s.answer === null ? null : JSON.parse(JSON.stringify(s.answer))
  lastResult.value = { scale4: s.scale4, verdict: s.verdict, gapType: s.gapType }
  showGap.value = false
}

function prevSnap() {
  if (canPrevSnap.value) reviewSnap(viewIdx.value - 1)
}
function nextSnap() {
  if (viewIdx.value < snaps.value.length - 1) reviewSnap(viewIdx.value + 1)
}
/** 从回看位置回到最新提交的那道题（仍是只读，便于继续翻/标记后再进下一题） */
function backToLatest() {
  reviewSnap(snaps.value.length - 1)
}
/** 退出回看、回到活动当前题 */
function exitReview() {
  browsing.value = false
  viewIdx.value = snaps.value.length - 1
  const latest = snaps.value[snaps.value.length - 1]
  // 活动题就是最新已答题（连续作答）：回显它的判定，停在待「下一题」推进态
  if (latest && latest.item.id === item.value?.id) {
    answer.value = latest.answer === null ? null : JSON.parse(JSON.stringify(latest.answer))
    lastResult.value = { scale4: latest.scale4, verdict: latest.verdict, gapType: latest.gapType }
  } else {
    // R15 续测场景：活动题是还没作答的新题（不在历史快照里），必须回到干净作答态，
    // 否则会把上一轮历史题的判定套到新题上，把新题误锁成只读、无法提交。
    resetTurn()
  }
}

/** 「这题我是蒙的」：复用练习纠偏通道，追加 0 档记录、降级掌握度、进错题本，原判定保留 */
async function markGuessed() {
  const s = curSnap.value
  if (!s || guessBusy.value) return
  guessBusy.value = true
  try {
    await ipc.practice.markGuessed(s.item.id)
    s.guessed = true
    toast.note('已按「完全不会」重新计入', '这题会提前安排复习并进入错题本；原来的摸底判定仍保留。')
  } catch (e: any) { toast.err(String(e?.message ?? e)) } finally { guessBusy.value = false }
}

async function loadResults() {
  try {
    const res = await ipc.placement.results()
    summary.value = res?.[domain.value] ?? Object.values(res ?? {})[0] ?? null
    gaps.value = await ipc.placement.gaps(domain.value)
  } catch { /* 容错 */ }
}

function restart() {
  phase.value = 'intro'
  item.value = null
  summary.value = null
  finishAfterReview.value = false
  resetReview()
  void checkResume()
}
/** 完成页的次要入口：放弃当前结论、强制开一轮全新摸底（需二次确认，避免误触丢进度） */
async function retest() {
  const ok = window.confirm('将开始一轮全新的摸底，当前这轮结论仍会保留在历史记录里。确定重测吗？')
  if (!ok) return
  busy.value = true
  try {
    const r = await ipc.placement.start(domain.value, { force: true })
    if (!r.item || !r.sessionId) {
      markEmpty(domain.value, r.hint || '这个板块题库还没铺好，暂时无法摸底')
      return
    }
    sessionId.value = r.sessionId
    item.value = r.item
    hint.value = r.hint
    progress.value = r.progress ?? { done: 0, total: 0 }
    phase.value = 'running'
    resetTurn()
    resetReview()
    await hydrateHistory(r.sessionId)
  } catch (e: any) {
    toast.err(String(e?.message ?? e))
  } finally {
    busy.value = false
  }
}
/* --------------------- 知识抽屉：AI 讲完后直接去看知识点 --------------------- */
const kbOpen = ref(false)
const kbNodeId = ref('')
const kbNodeTitle = ref<string | null>(null)
const kbQuestionId = ref<string | null>(null)

/** 打开某考点的讲义（本考点或 AI 点名前置）；讲义里的双链可在抽屉内继续跳 */
function openKnowledge(nodeId: string, title: string | null) {
  if (!nodeId) return
  kbNodeId.value = nodeId
  kbNodeTitle.value = title
  kbQuestionId.value = null
  kbOpen.value = true
}
function onKbNavigate(id: string) {
  kbNodeId.value = id
  kbQuestionId.value = null
}
/** 「去练这个基础点」：摸底进度不会丢，但会离开当前答题页，所以先确认一次 */
function onPracticeNode(nodeId: string, title: string) {
  kbOpen.value = false
  const ok = window.confirm(`去练「${title}」这个更基础的考点？当前摸底进度会保留，随时可以回来继续摸。`)
  if (!ok) return
  void router.push({ path: '/practice', query: { node: nodeId } })
}

function goPractice() { void router.push({ path: '/practice', query: { domain: domain.value } }) }
function goGraph() { void router.push('/graph') }

const SCALE_TEXT = ['完全不会', '提示后会', '能独立说清', '能举证']
onMounted(() => { void checkResume() })
</script>

<template>
  <div class="page page-narrow">
    <!-- ========== 介绍 / 板块选择 ========== -->
    <template v-if="phase === 'intro'">
      <header class="page-head">
        <div class="grow col">
          <h1><Icon name="brain" :size="20" class="hd-ic" /> 入门摸底</h1>
          <p>从最基础的考点开始，由浅入深一道道做：你答得好，就沿同一方向逐级上探更难的进阶题，直到摸到你的天花板；一旦不会，这个方向立刻收住，不纠缠。每个方向都探到边界、系统能判清你的水准就结束，<b>不固定题数</b>，弱的地方少做、强的地方自然探得深。结论会保存下来，驱动后续练习。</p>
        </div>
      </header>

      <div v-if="Object.keys(activeByDomain).length" class="fb ok resume-bar">
        <div class="col">
          <b>检测到{{ Object.keys(activeByDomain).length }}个板块有没做完的摸底</b>
          <span class="tiny faint">断点已保存，直接点对应板块卡片就会从上次的考点继续，不用重头再来。</span>
        </div>
        <n-button type="primary" size="small" @click="resumeSession"><Icon name="play" :size="14" /> 继续最近一次</n-button>
      </div>

      <div class="grid domain-grid">
        <button v-for="d in domainEntries" :key="d.value" type="button"
          class="card domain-card"
          :class="{ 'is-resume': activeByDomain[d.value], 'is-empty': emptyDomains.has(d.value) }"
          :style="{ '--dc': metaOf(d.value).color }"
          :disabled="busy || emptyDomains.has(d.value)" @click="start(d.value)">
          <span class="dc-top">
            <span class="dc-badge"><Icon :name="metaOf(d.value).icon" :size="20" /></span>
            <Icon name="arrowRight" :size="16" class="dc-arrow" />
          </span>
          <span class="dc-body">
            <span class="dc-name-row">
              <b class="dc-name">{{ d.label }}</b>
              <span v-if="activeByDomain[d.value]" class="dc-tag resume"><Icon name="play" :size="11" /> 未完成</span>
              <span v-else-if="emptyDomains.has(d.value)" class="dc-tag building"><Icon name="book" :size="11" /> 建设中</span>
            </span>
            <span class="dc-desc faint">{{ emptyDomains.has(d.value) ? '题库还在建设，暂无可摸底的完整考点' : metaOf(d.value).desc }}</span>
          </span>
          <span class="dc-foot">
            <span v-if="activeByDomain[d.value]" class="dc-hint resume-text"><Icon name="sparkles" :size="12" /> 断点已存，点击继续不重做</span>
            <span v-else class="dc-hint faint">自适应摸底 · 够判即停，不固定题数</span>
          </span>
        </button>
      </div>

      <section v-if="history.length" class="card rise">
        <div class="panel-head"><h3><Icon name="chart" :size="16" class="hd-ic" /> 历史摸底</h3></div>
        <div v-for="h in history" :key="h.id" class="kv hist-row">
          <span class="pill info">{{ DOMAIN_LABEL[h.domain] ?? h.domain }}</span>
          <span class="num">{{ Math.round(h.pct) }} 分</span>
          <span class="grow" />
          <span class="micro faint">{{ h.created_at }}</span>
        </div>
      </section>
    </template>

    <!-- ========== 摸底进行中 ========== -->
    <template v-else-if="phase === 'running' && cur">
      <div class="pl-toolbar card">
        <span class="pl-badge"><Icon name="target" :size="18" /></span>
        <div class="pl-prog-wrap">
          <div class="pl-meta">
            <b class="pl-title">{{ DOMAIN_LABEL[domain] ?? domain }}摸底</b>
            <span class="pl-count">已探 <b class="num">{{ progress.done }}</b><template v-if="progress.total"> / {{ progress.total }}</template> 个方向 · 共 {{ snaps.length }} 题</span>
            <span class="pl-pct num">{{ progressPct }}%</span>
          </div>
          <div class="pl-bar"><i :style="{ width: progressPct + '%' }" /></div>
        </div>
        <button type="button" class="pl-exit" @click="restart"><Icon name="close" :size="14" /> 退出</button>
      </div>

      <div v-if="hint && !isReview" class="fb info pl-hint"><Icon name="sparkles" :size="14" /> <span class="tiny">{{ hint }}</span></div>

      <!-- R11 本组题号胶片：做过的题可点回看（含蒙题旗帜），按作答顺序排列 -->
      <div v-if="snaps.length" class="filmstrip card" data-testid="placement-filmstrip">
        <span class="micro faint film-cap"><Icon name="book" :size="12" /> 本次摸底题目（点击回看）</span>
        <div class="film-items">
          <button v-for="(s, i) in snaps" :key="s.item.id" type="button" class="film-dot"
            :class="dotClass(i)" :title="dotTitle(i)" :data-testid="`pl-film-dot-${i}`" @click="reviewSnap(i)">
            <span class="num">{{ i + 1 }}</span>
            <Icon v-if="s.guessed" name="flag" :size="10" class="dot-flag" />
          </button>
        </div>
      </div>

      <div :key="cur.id" class="card rise pl-q">
        <div class="qmeta">
          <span v-if="isReview" class="pill lock review-pill" data-testid="pl-review-pill"><Icon name="book" :size="12" /> 回看 · 只读</span>
          <span v-if="guessedNow" class="pill warn guess-pill"><Icon name="flag" :size="12" /> 已标记「蒙的」</span>
          <span v-if="cur.q?.learnFirst" class="pill learn-pill" data-testid="pl-learn-pill"><Icon name="book" :size="12" /> 先学后测 · 资料题</span>
          <span class="pill" :class="typePillClass(cur.type)"><Icon :name="TYPE_ICON_NAME[cur.type] || 'book'" :size="12" /> {{ TYPE_LABEL[cur.type] }}</span>
          <span class="pill lock"><Icon name="chart" :size="12" /> 难度 {{ cur.difficulty }} · {{ DIFF_LABEL[cur.difficulty] }}</span>
          <span class="qnode ellip" :title="cur.nodeTitle">{{ cur.nodeTitle }}</span>
        </div>

        <!-- R19 先学后测：资料依赖题作答前先给学习材料，学完解锁，避免「没读过只能蒙」 -->
        <div v-if="isLearnFirst && learnMaterialHtml && !learnUnlocked" class="learn-card" data-testid="pl-learn-card">
          <div class="learn-head">
            <Icon name="brain" :size="16" />
            <b>这题依赖特定论文/文档，先花一分钟读懂下面的材料再作答</b>
          </div>
          <div class="learn-body md" v-html="learnMaterialHtml" />
          <n-button type="primary" block data-testid="pl-learn-done" @click="learnUnlocked = true">
            <Icon name="check" :size="15" /> 我已学完，开始作答
          </n-button>
        </div>

        <QuestionBody :q="cur.q!" v-model="answer" :revealed="!!lastResult" :show-reference="!!lastResult" :disabled="!!lastResult || inputDisabled" />
        <div v-if="isLearnFirst && !learnUnlocked" class="learn-lock-hint micro faint">
          <Icon name="alert" :size="12" /> 读完上面材料、点「我已学完」后才能作答；若暂时不想学，可直接点下方「我不会」
        </div>

        <!-- 本题判定回显（作答后 / 回看时） -->
        <div v-if="lastResult" class="pl-verdict" :class="lastResult.scale4 >= 2 ? 'ok' : 'bad'">
          <Icon :name="lastResult.scale4 >= 2 ? 'check' : 'alert'" :size="15" />
          <span class="tiny">
            <template v-if="lastResult.gapType === 'guess'">已标记「蒙的」：按完全不会计入能力判定（这道仍进错题本），对错与解析可在下方回看。</template>
            <template v-else-if="lastResult.gapType">
              已记录缺口（{{ lastResult.gapType === 'concept' ? '知识点不懂' : lastResult.gapType === 'code' ? '不会手写代码' : '跳过' }}）。
              <template v-if="gapTutorSeed">AI 正在按你写的原话讲这题，见下方。</template>
              <template v-else>想搞懂可以点下方「让 AI 专门讲这题」。</template>
            </template>
            <template v-else>本题判定：{{ SCALE_TEXT[lastResult.scale4] }} · {{ lastResult.verdict }}</template>
          </span>
        </div>

        <!-- R24 缺口即时解答：提交「我不会」后不再只回一句记录，直接把用户原话交给 AI 讲 -->
        <GapTutor v-if="lastResult && gapTutorSeed" :key="gapTutorSeed.questionId"
          :node-id="gapTutorSeed.nodeId" :node-title="gapTutorSeed.nodeTitle"
          :question-id="gapTutorSeed.questionId" :seed-ask="gapTutorSeed.ask"
          @open-knowledge="openKnowledge" @practice-node="onPracticeNode" />
        <div v-else-if="lastResult?.gapType" class="pl-ai-entry" data-testid="pl-ai-entry">
          <Icon name="brain" :size="15" class="ai-ic" />
          <span class="tiny">这题 AI 还没讲。想从零搞懂的话：</span>
          <n-button size="small" type="primary" secondary data-testid="pl-ask-ai" @click="askAiNow">
            <Icon name="sparkles" :size="14" /> 让 AI 专门讲这题
          </n-button>
          <span class="micro faint">AI 只讲与本考点相关的内容，会按你的水平从基础讲起</span>
        </div>

        <!-- 动作区：正常作答 + 蒙的 + 直接说不会（仅未提交的当前新题显示） -->
        <div v-if="!lastResult" class="pl-acts">
          <n-button type="primary" :loading="busy" :disabled="!answer || busy || inputDisabled" data-testid="pl-submit" @click="submitAnswer">
            <Icon name="check" :size="15" /> 提交作答
          </n-button>
          <n-button type="warning" secondary :loading="busy" :disabled="!answer || busy || inputDisabled"
            data-testid="pl-submit-guessed" @click="submitGuessed">
            <Icon name="flag" :size="15" /> 我是蒙的
          </n-button>
          <n-button secondary :loading="busy" :disabled="inputDisabled" @click="showGap = !showGap">
            <Icon name="alert" :size="15" /> 我不会
          </n-button>
        </div>

        <!-- 不会原因：输入框是主路径（写一句就能提交），三个卡片是「不想打字」时的快捷方式 -->
        <div v-if="showGap && !lastResult" class="pl-gap"
          @keydown.ctrl.enter.prevent="submitNote" @keydown.meta.enter.prevent="submitNote">
          <div class="section-title">具体卡在哪？这样系统才知道要补哪一层</div>
          <n-input v-model:value="gapNote" size="small" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }"
            placeholder="用你自己的话说一句：哪里看不懂、或者写不出来（如『我不知道 AST 是什么，模板字符串的概念也模糊』）" />
          <div class="gap-send">
            <n-button type="primary" size="small" :loading="noteBusy" :disabled="!gapNote.trim() || busy"
              data-testid="pl-gap-send" @click="submitNote">
              <Icon name="check" :size="14" /> 提交我的说明
            </n-button>
            <span class="micro faint">写清楚系统就能判准卡在哪一层 · Ctrl+Enter 快捷提交</span>
          </div>
          <div class="gap-opt-title">不想打字？直接选一类，一键提交<span class="micro faint">（效果相同；框里写了字会一起存进缺口记录）</span></div>
          <div class="gap-opts">
            <button v-for="g in GAP_OPTIONS" :key="g.type" type="button" class="gap-opt" :disabled="busy" @click="submitGap(g.type)">
              <Icon :name="g.icon" :size="18" class="go-ic" />
              <b>{{ g.label }}</b>
              <span class="micro faint">{{ g.desc }}</span>
            </button>
          </div>
        </div>

        <!-- 考点解析：作答后或回看时展开，供「万一我是蒙的」对照理解 -->
        <details v-if="lastResult && analysisHtml" class="pl-ana" :open="isReview">
          <summary><Icon name="book" :size="14" class="ana-ic" /> 考点解析<span class="grow" /><span class="micro faint">点击展开/收起</span></summary>
          <div class="acc-body md" v-html="analysisHtml" />
        </details>

        <!-- 已作答后的导航区：回看只读态 / 最新题待推进态 -->
        <div v-if="lastResult" class="pl-acts pl-nav">
          <!-- 回看态：上一题/下一题顺序翻看 + 蒙题纠偏 + 回到当前题 -->
          <template v-if="isReview">
            <n-button size="small" :disabled="!canPrevSnap" data-testid="pl-prev" @click="prevSnap">
              <Icon name="arrowLeft" :size="14" /> 上一题
            </n-button>
            <n-button size="small" type="primary" :disabled="viewIdx >= snaps.length - 1" @click="nextSnap">
              下一题 <Icon name="arrowRight" :size="14" />
            </n-button>
            <n-button v-if="!guessedNow" size="small" type="warning" :loading="guessBusy"
              data-testid="pl-mark-guessed" @click="markGuessed">
              <Icon name="flag" :size="14" /> 这题我是蒙的
            </n-button>
            <span v-else class="pill warn"><Icon name="flag" :size="13" /> 已按「完全不会」计入，会进错题本并提前复习</span>
            <n-button v-if="viewIdx < snaps.length - 1" size="small" quaternary @click="backToLatest">
              <Icon name="chevronDown" :size="14" /> 回到最新题
            </n-button>
            <span class="grow" />
            <n-button size="small" quaternary @click="exitReview">退出回看</n-button>
          </template>
          <!-- 最新题：手动推进到下一道探针题（不再自动跳走，留出回看/消化时间） -->
          <template v-else>
            <n-button v-if="snaps.length > 1" size="small" quaternary data-testid="pl-review-entry" @click="reviewSnap(snaps.length - 2)">
              <Icon name="arrowLeft" :size="14" /> 回看上面的题
            </n-button>
            <span class="grow" />
            <n-button type="primary" :loading="busy" data-testid="pl-next" @click="goNext">
              <template v-if="finishAfterReview"><Icon name="check" :size="15" /> 查看摸底结果</template>
              <template v-else>下一题 <Icon name="arrowRight" :size="15" /></template>
            </n-button>
          </template>
        </div>
      </div>
    </template>

    <!-- ========== 摸底进行中但取不到题（兜底，保证永远有出口） ========== -->
    <template v-else-if="phase === 'running'">
      <div class="pl-toolbar card">
        <span class="pl-badge"><Icon name="target" :size="18" /></span>
        <div class="pl-prog-wrap">
          <b class="pl-title">{{ DOMAIN_LABEL[domain] ?? domain }}摸底</b>
        </div>
        <button type="button" class="pl-exit" @click="restart"><Icon name="close" :size="14" /> 退出</button>
      </div>
      <div class="card pl-empty">
        <Icon name="alert" :size="30" class="empty-ic" />
        <h2>暂时取不到可摸底的题目</h2>
        <p class="tiny faint">{{ hint || '这个板块的题库还在建设中，考点或题目尚未铺完整。' }}</p>
        <p class="micro faint">你的其他学习进度不会受影响，可以先去前端 / AI Agent 板块摸底。</p>
        <n-button type="primary" @click="restart"><Icon name="arrowLeft" :size="15" /> 返回板块选择</n-button>
      </div>
    </template>

    <!-- ========== 摸底完成 ========== -->
    <template v-else-if="phase === 'done'">
      <div class="card pl-done">
        <Icon name="check" :size="34" class="done-ic" />
        <h2>摸底完成</h2>
        <p class="tiny faint">你的掌握情况已保存，后续练习会按这个起点和前置顺序推送。</p>

        <div v-if="summary" class="done-summary">
          <div class="kpi"><div class="k">综合分</div><div class="v num">{{ Math.round(summary.pct ?? 0) }}</div></div>
          <div class="kpi"><div class="k">掌握档</div><div class="v num">{{ Number(summary.scale4 ?? 0).toFixed(1) }}/3</div></div>
          <div class="kpi"><div class="k">知识缺口</div><div class="v num" :style="{ color: gaps.length ? 'var(--bad)' : 'var(--ok)' }">{{ gaps.length }}</div></div>
        </div>

        <section v-if="gaps.length" class="gap-report">
          <div class="section-title"><Icon name="alert" :size="14" /> 你明确卡住的地方</div>
          <div v-for="(g, i) in gaps" :key="i" class="gap-row">
            <span class="pill" :class="g.gapType === 'code' ? 'warn' : g.gapType === 'guess' ? 'warn' : 'bad'">
              {{ g.gapType === 'code' ? '不会手写代码' : g.gapType === 'concept' ? '知识点不懂' : g.gapType === 'guess' ? '蒙的（未掌握）' : '跳过' }}
            </span>
            <span class="tiny">{{ g.title }}</span>
            <span v-if="g.count > 1" class="micro faint num">×{{ g.count }}</span>
          </div>
        </section>

        <section v-if="summary?.starts?.length" class="gap-report">
          <div class="section-title"><Icon name="route" :size="14" /> 建议从这些考点切入</div>
          <div class="row" style="gap:8px;flex-wrap:wrap">
            <button v-for="s in summary.starts" :key="s.id" class="chip" @click="router.push({ path: '/graph', query: { node: s.id } })">
              <Icon name="route" :size="12" /> {{ s.title }}
            </button>
          </div>
        </section>

        <div class="done-acts">
          <n-button type="primary" @click="goPractice"><Icon name="pen" :size="15" /> 按这个起点去练习</n-button>
          <n-button secondary @click="goGraph"><Icon name="graph" :size="15" /> 在图谱查看掌握度</n-button>
          <n-button quaternary @click="restart"><Icon name="close" :size="14" /> 退出</n-button>
        </div>
        <button type="button" class="done-retest" @click="retest">想重新测一次这个板块？点这里</button>
      </div>
    </template>
  </div>

  <!-- AI 讲解里「看讲义 / 去练前置」落到真实的考点正文，用户不用自己再找入口 -->
  <KnowledgeDrawer v-if="kbOpen" v-model:open="kbOpen" :node-id="kbNodeId" :node-title="kbNodeTitle"
    :question-id="kbQuestionId" @navigate="onKbNavigate"
    @practice-node="onPracticeNode" />
</template>

<style scoped>
.hd-ic { color: var(--accent); vertical-align: -3px }
/* ---------- 板块入口卡片（R16 视觉重构：语义色徽标 + 分区结构 + 四态反馈） ---------- */
/* auto-fit + 较宽 minmax：5 卡尽量在一行铺满，消除右侧大片留白；窄窗自动降列（设计系统禁固定列数） */
.domain-grid { grid-template-columns: repeat(auto-fit, minmax(min(208px, 100%), 1fr)); gap: var(--sp-4); align-items: stretch }
.domain-card {
  position: relative; display: flex; flex-direction: column; gap: var(--sp-3);
  padding: var(--sp-4); text-align: left; cursor: pointer; font: inherit;
  overflow: clip; min-height: 158px;
  transition: transform var(--dur) var(--ease-out), border-color var(--dur) var(--ease-out), box-shadow var(--dur) var(--ease-out);
}
/* 顶部一条语义色光带，默认隐在顶边；hover / 未完成态亮起，强化板块身份与可继续提示 */
.domain-card::before {
  content: ''; position: absolute; inset: 0 0 auto 0; height: 3px;
  background: var(--dc, var(--accent)); opacity: 0; transition: opacity var(--dur) var(--ease-out);
}
.domain-card:hover:not(:disabled) {
  transform: translateY(-3px);
  border-color: color-mix(in oklab, var(--dc, var(--accent)) 42%, var(--border));
  box-shadow: var(--sh-2);
}
.domain-card:hover:not(:disabled)::before { opacity: 1 }
.domain-card:active:not(:disabled) { transform: translateY(-1px) scale(.992) }
.domain-card:focus-visible { outline: none; box-shadow: var(--ring) }
.domain-card:disabled { opacity: .55; cursor: not-allowed }

.dc-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px }
.dc-badge {
  display: grid; place-content: center; width: 42px; height: 42px; border-radius: var(--r-md);
  color: var(--dc, var(--accent));
  background: color-mix(in oklab, var(--dc, var(--accent)) 13%, var(--surface-2));
  border: 1px solid color-mix(in oklab, var(--dc, var(--accent)) 26%, transparent);
  transition: transform var(--dur) var(--spring);
}
.domain-card:hover:not(:disabled) .dc-badge { transform: scale(1.06) }
.domain-card:disabled .dc-badge { color: var(--text-faint); background: var(--surface-2); border-color: var(--border) }
.dc-arrow { color: var(--text-faint); opacity: 0; transform: translateX(-4px); transition: opacity var(--dur) var(--ease-out), transform var(--dur) var(--ease-out) }
.domain-card:hover:not(:disabled) .dc-arrow { opacity: 1; transform: translateX(0); color: var(--dc, var(--accent)) }

.dc-body { display: flex; flex-direction: column; gap: 5px; min-width: 0 }
.dc-name-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap }
.dc-name { font-size: var(--fs-lg); font-weight: 680; letter-spacing: -.01em }
.dc-desc { font-size: var(--fs-sm); line-height: var(--lh-snug); min-height: 2.6em }
.dc-tag { display: inline-flex; align-items: center; gap: 3px; font-size: var(--fs-xs); font-weight: 600; padding: 2px 8px; border-radius: var(--r-pill) }
.dc-tag.resume { color: var(--accent-2); background: color-mix(in oklab, var(--accent) 13%, transparent); border: 1px solid color-mix(in oklab, var(--accent) 30%, transparent) }
.dc-tag.building { color: var(--text-faint); background: var(--surface-3); border: 1px solid var(--border) }
html[data-theme="dark"] .dc-tag.resume { color: var(--accent-hi) }

.dc-foot { margin-top: auto; display: flex; align-items: center; gap: 8px; padding-top: var(--sp-2); border-top: 1px dashed var(--border) }
.dc-hint { display: inline-flex; align-items: center; gap: 4px; font-size: var(--fs-xs); min-width: 0; flex: 1; line-height: 1.3 }
.dc-hint.resume-text { color: var(--accent-2); font-weight: 600 }
html[data-theme="dark"] .dc-hint.resume-text { color: var(--accent-hi) }

/* 有未完成摸底的卡片：常驻语义色描边 + 顶边光带，从普通卡里跳出来 */
.domain-card.is-resume { border-color: color-mix(in oklab, var(--accent) 40%, var(--border)) }
.domain-card.is-resume::before { opacity: 1 }
.domain-card.is-resume .dc-badge { box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 12%, transparent) }
@media (max-width: 720px) {
  .domain-grid { grid-template-columns: minmax(0, 1fr) }
  .domain-card { min-height: 0 }
}
.pl-empty { display: grid; justify-items: center; text-align: center; gap: 10px; padding: var(--sp-6) }
.empty-ic { color: var(--warn) }
.resume-bar { display: flex; align-items: center; gap: 14px; justify-content: space-between }
.hist-row { padding: 8px 0; border-bottom: 1px dashed var(--border) }
.hist-row:last-child { border-bottom: 0 }

/* 进行中 */
/* 进行中：摸底进度工具条 */
.pl-toolbar {
  display: flex; align-items: center; gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
  background:
    radial-gradient(120% 160% at 0% 0%, color-mix(in oklab, var(--accent) 8%, transparent), transparent 60%),
    var(--surface);
}
.pl-badge {
  flex: 0 0 auto; width: 38px; height: 38px; border-radius: var(--r-md);
  display: grid; place-content: center; color: #fff;
  background: linear-gradient(140deg, var(--accent-hi), color-mix(in oklab, var(--purple) 55%, var(--accent)));
  box-shadow: 0 3px 10px color-mix(in oklab, var(--accent) 38%, transparent);
}
.pl-prog-wrap { flex: 1; min-width: 0; display: grid; gap: 8px }
.pl-meta { display: flex; align-items: baseline; gap: var(--sp-2); min-width: 0 }
.pl-title { font-size: var(--fs-md); font-weight: 650; white-space: nowrap }
.pl-count { font-size: var(--fs-xs); color: var(--text-faint); white-space: nowrap }
.pl-count b { color: var(--text-dim); font-weight: 650 }
.pl-pct {
  margin-left: auto; font-size: var(--fs-md); font-weight: 700;
  color: var(--accent-2); font-variant-numeric: tabular-nums; white-space: nowrap;
}
html[data-theme="dark"] .pl-pct { color: var(--accent-hi) }
.pl-bar { height: 8px; border-radius: var(--r-pill); background: var(--surface-3); overflow: hidden }
.pl-bar > i {
  display: block; height: 100%; border-radius: var(--r-pill);
  background: linear-gradient(90deg, var(--accent), color-mix(in oklab, var(--purple) 60%, var(--accent)));
  box-shadow: 0 0 8px color-mix(in oklab, var(--accent) 45%, transparent);
  transition: width var(--dur-slow) var(--ease-out);
}
.pl-exit {
  flex: 0 0 auto; display: inline-flex; align-items: center; gap: 5px;
  font: inherit; font-size: var(--fs-sm); color: var(--text-dim);
  padding: 7px 13px; border-radius: var(--r-pill);
  border: 1px solid var(--border); background: var(--surface); cursor: pointer;
  transition: color var(--dur-fast), border-color var(--dur-fast), background-color var(--dur-fast);
}
.pl-exit:hover { color: var(--bad); border-color: color-mix(in oklab, var(--bad) 45%, var(--border)); background: color-mix(in oklab, var(--bad) 7%, var(--surface)) }
@media (max-width: 640px) {
  .pl-badge { width: 32px; height: 32px }
  .pl-count { display: none }
}
.pl-hint { display: flex; align-items: center; gap: 8px }
.pl-q { padding: var(--sp-5) }
.qmeta { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; margin-bottom: var(--sp-3) }
.qnode { flex: 1 1 auto; min-width: 0; text-align: right; color: var(--text-faint); font-size: var(--fs-sm) }
.pl-acts { display: flex; gap: 10px; margin-top: var(--sp-4); flex-wrap: wrap }
.pl-verdict { display: flex; align-items: center; gap: 8px; margin-top: var(--sp-3); padding: 10px 12px; border-radius: var(--r-md) }
.pl-verdict.ok { color: var(--ok); background: color-mix(in oklab, var(--ok) 10%, transparent) }
.pl-verdict.bad { color: var(--warn); background: color-mix(in oklab, var(--warn) 10%, transparent) }
/* 缺口态的手动讲解入口（回看 / 主动跳过 / 蒙题时显示，不自动烧 token） */
.pl-ai-entry {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin-top: var(--sp-3); padding: 10px 12px; border-radius: var(--r-md);
  border: 1px dashed color-mix(in oklab, var(--purple) 40%, var(--border));
  background: color-mix(in oklab, var(--purple) 6%, transparent);
}
.pl-ai-entry .ai-ic { color: var(--purple) }
.pl-ai-entry .micro { color: var(--text-faint) }

.pl-gap { margin-top: var(--sp-4); padding: var(--sp-4); border: 1px dashed var(--border); border-radius: var(--r-lg); background: var(--surface-2) }
/* 输入框：提交按钮紧随其后，明确「打完字就能交」；下方才是「不想打字」的快捷卡片 */
.gap-send { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 10px }
.gap-send .micro { color: var(--text-faint) }
.gap-opt-title { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin: var(--sp-4) 0 10px;
  font-size: var(--fs-sm); font-weight: 600; color: var(--text) }
.gap-opt-title .micro { font-weight: 400; color: var(--text-faint) }
.gap-opts { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px }
.gap-opt { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 12px; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--surface); cursor: pointer; font: inherit; text-align: left; transition: border-color var(--dur-fast), transform var(--dur-fast) }
.gap-opt:hover:not(:disabled) { border-color: var(--warn); transform: translateY(-1px) }
.gap-opt:disabled { opacity: .5; cursor: not-allowed }
.go-ic { color: var(--warn) }

/* ---------- R11 本组题号胶片（回看导航） ---------- */
.filmstrip { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; padding: 10px 12px }
.film-cap { display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto; margin-right: 4px }
.film-items { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0 }
.film-dot {
  position: relative; display: inline-flex; align-items: center; justify-content: center;
  min-width: 30px; height: 28px; padding: 0 7px; border-radius: var(--r-md);
  border: 1px solid var(--border); background: var(--surface-2); color: var(--text-dim);
  font: inherit; font-size: var(--fs-sm); font-weight: 600; cursor: pointer;
  transition: border-color var(--dur-fast), color var(--dur-fast), background-color var(--dur-fast), transform var(--dur-fast) var(--spring);
}
.film-dot:hover { transform: translateY(-1px); border-color: color-mix(in oklab, var(--accent) 45%, var(--border)); color: var(--accent-2) }
.film-dot.cur { outline: 2px solid var(--accent); outline-offset: 1px; color: var(--accent-2) }
.film-dot.good { color: var(--ok); border-color: color-mix(in oklab, var(--ok) 45%, var(--border)); background: color-mix(in oklab, var(--ok) 10%, var(--surface-2)) }
.film-dot.bad { color: var(--bad); border-color: color-mix(in oklab, var(--bad) 45%, var(--border)); background: color-mix(in oklab, var(--bad) 10%, var(--surface-2)) }
.film-dot.guessed { color: #fff; border-color: var(--warn); background: var(--warn) }
.film-dot.guessed .num, .film-dot.guessed .dot-flag { color: #fff }
.dot-flag { margin-left: 2px }
.review-pill, .guess-pill { display: inline-flex; align-items: center; gap: 3px }

/* R19 先学后测：资料题徽标 + 作答前学习卡 */
.learn-pill { display: inline-flex; align-items: center; gap: 3px; color: var(--purple); border-color: color-mix(in srgb, var(--purple) 40%, transparent); background: color-mix(in srgb, var(--purple) 12%, transparent) }
.learn-card { margin: var(--sp-4) 0; border: 1px solid color-mix(in srgb, var(--purple) 35%, var(--border)); border-radius: var(--r-md); background: color-mix(in srgb, var(--purple) 7%, var(--surface-2)); padding: var(--sp-4); display: grid; gap: var(--sp-3) }
.learn-head { display: flex; align-items: center; gap: 8px; color: var(--purple); font-weight: 600 }
.learn-body.md { max-height: 320px; overflow-y: auto; line-height: var(--lh-loose); padding-right: 4px }
.learn-body.md :deep(p) { margin: 6px 0 }
.learn-body.md :deep(hr) { margin: 10px 0; border: none; border-top: 1px dashed var(--border) }
.learn-lock-hint { display: flex; align-items: center; gap: 5px; margin-top: 8px }

/* 导航动作区：两端分布，回看按钮与下一题分置左右 */
.pl-nav { align-items: center }
.pl-nav .grow { flex: 1 1 auto; min-width: var(--sp-3) }

/* 考点解析折叠区 */
.pl-ana { margin-top: var(--sp-4); border: 1px solid var(--border); border-radius: var(--r-md); background: var(--surface-2); padding: 0 var(--sp-4) }
.pl-ana summary { display: flex; align-items: center; gap: 6px; padding: 12px 0; cursor: pointer; color: var(--text-dim); font-weight: 550; list-style: none }
.pl-ana summary::-webkit-details-marker { display: none }
.ana-ic { color: var(--text-faint); flex: 0 0 auto }
.pl-ana .acc-body { padding: 4px 0 14px; border-top: 1px dashed var(--border) }
.pl-ana .acc-body.md { line-height: var(--lh-loose) }
.pl-ana .acc-body.md :deep(p) { margin: 8px 0 }

/* 完成页 */
.pl-done { display: grid; justify-items: center; text-align: center; padding: var(--sp-6); gap: 8px }
.done-ic { color: var(--ok) }
.done-summary { display: flex; gap: var(--sp-4); margin: var(--sp-4) 0; flex-wrap: wrap; justify-content: center }
.done-summary .kpi { min-width: 110px }
.gap-report { width: 100%; text-align: left; margin-top: var(--sp-3) }
.gap-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px dashed var(--border) }
.gap-row .faint { flex: 1 }
.done-acts { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; margin-top: var(--sp-5) }
.done-retest {
  margin-top: var(--sp-3); padding: 4px 10px; border: 0; background: transparent; cursor: pointer;
  font: inherit; font-size: var(--fs-xs); color: var(--text-faint); text-decoration: underline; text-underline-offset: 3px;
  transition: color var(--dur-fast);
}
.done-retest:hover { color: var(--accent-2) }
.chip { display: inline-flex; align-items: center; gap: 5px; padding: 5px 11px; border-radius: var(--r-pill); border: 1px solid var(--border); background: var(--surface-2); color: var(--text-dim); font: inherit; font-size: var(--fs-sm); cursor: pointer }
.chip:hover { border-color: var(--accent); color: var(--accent-2) }
</style>
