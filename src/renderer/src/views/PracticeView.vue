<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { QuestionRow, GradeResult, GraphNode } from '@shared/types'
import QuestionBody from '../components/QuestionBody.vue'
import FeedbackPanel from '../components/FeedbackPanel.vue'
import KnowledgeDrawer from '../components/KnowledgeDrawer.vue'
import Icon from '../components/Icon.vue'
import CelebrationModal from '../components/CelebrationModal.vue'
import { useForgeStore } from '../store'
import { useGameStore } from '../game-store'
import { TYPE_LABEL, TYPE_ICON_NAME, DIFF_LABEL, SCALE_LABEL, toast, scale4Color, scale4Soft, pctColor, typePillClass, renderMd } from '../lib/ui'
import { ipc } from '../lib/ipc'

const store = useForgeStore()
const game = useGameStore()
const router = useRouter()
const route = useRoute()

/**
 * 练习模式（R9-④ 重构）：练习就是练习。
 * - 不再暴露难度/题量/混入比例/开关等一堆手动参数（已挪到「设置·学习算法参数」）；
 * - 进入时只选「练哪个模块」（板块 + 技术栈），题目在模块内纯随机、无先后顺序、无前置关联；
 * - 「今日」走带记忆曲线的到期复习，「随机」走无关联抽题；图谱「练这个考点」是带范围的随机。
 */
const spec = reactive({
  domains: ['fe'] as string[],
  stacks: [] as string[],
  nodeIds: [] as string[],
  count: 10,
  random: true
})
const domainOpts = [
  { value: 'fe', label: '前端' },
  { value: 'ai', label: 'AI Agent' },
  { value: 'be', label: '后端' },
  { value: 'cs', label: '公共基础' },
  { value: 'eng', label: '工程难题' }
]
/** 技术栈选项来自图谱 L2 节点（只列实际挂了题的，避免选到空壳抽不到题） */
const stackOpts = ref<{ value: string; label: string; domain: string; qTotal: number }[]>([])
const stackGroups = computed(() => {
  const picked = new Set(spec.domains)
  return stackOpts.value.filter((s) => picked.has(s.domain))
})

/** 与图谱四态同源（services/mastery.ts），题目卡上让用户先知道自己处于哪一态再作答 */
const STATE_TEXT = ['未接触', '学习中', '已掌握', '已生疏 ↺'] as const
const stateClassOf = (row?: QuestionRow | null) => `st-${(['untouched', 'learning', 'mastered', 'stale'] as const)[row?.mastery_level ?? 0]}`
const stateTextOf = (row?: QuestionRow | null) => STATE_TEXT[row?.mastery_level ?? 0]

/** 今日（记忆曲线复习）/ 随机（无关联抽题）。定向考点进入时锁定为随机范围模式 */
const mode = ref<'today' | 'random'>('random')
/** 模块选择条是否展开（默认展开方便第一次选，开始答题后可收起让出空间） */
const pickerOpen = ref(true)

/** 单题在本组内的作答快照：回看时据此还原「我选了什么 + 批改结果 + 是否对答案」 */
interface TurnSnapshot {
  answer: any
  grade: (GradeResult & { myAnswerSnapshot?: string }) | null
  revealed: boolean
  graded: boolean
  guessed: boolean
}
const queue = ref<QuestionRow[]>([])
const idx = ref(0)
const answer = ref<any>(null)
const grade = ref<(GradeResult & { myAnswerSnapshot?: string }) | null>(null)
const revealed = ref(false)
const busy = ref('')
const justUnlocked = ref<{ nodeId: string; title: string }[]>([])
/** 本组已作答/已揭晓的每道题快照，下标与 queue 对齐；回看（含「蒙的」纠偏）完全靠它还原 */
const turns = ref<(TurnSnapshot | null)[]>([])
/** 已走到的最大下标：只能回看做过的题，不能跳过当前题去点后面的题 */
const answeredUpTo = ref(-1)
/**
 * 是否处于「回看导航」态：通过胶片/上一题/下一题等历史导航进入做过的题时为 true，
 * 此时只读、可标记蒙的；正常向后作答（含停在最新已答那题）为 false。
 * 显式标志比用 idx<answeredUpTo 判断更准——最新作答的那题 idx 恰等于 answeredUpTo，
 * 但只要是回看进来的，同样应是只读回看态。
 */
const browsing = ref(false)
const sessionScores = ref<number[]>([])

/* ---- 知识抽屉：默认绝不自动弹出，只在用户主动点「查讲义」时打开（R9-②） ---- */
const kbOpen = ref(false)
const kbNodeId = ref('')
const kbNodeTitle = ref<string | null>(null)
const kbQuestionId = ref<string | null>(null)
function openKnowledge(nodeId?: string | null, title?: string | null, questionId?: string | null) {
  if (!nodeId) { toast.warn('本题没有绑定考点，没法查讲义'); return }
  kbNodeId.value = nodeId
  kbNodeTitle.value = title ?? null
  kbQuestionId.value = questionId ?? null
  kbOpen.value = true
}
function onKbNavigate(id: string) { kbNodeId.value = id; kbQuestionId.value = null }

/**
 * R22 私教「去练这个基础点」：抽屉请求切到指定前置考点组卷。
 * 关掉抽屉 → 把组卷范围定向到该节点 → 重新抽题，让用户退到更基础的题上手。
 */
async function onPracticeNode(nodeId: string, nodeTitle: string) {
  kbOpen.value = false
  spec.nodeIds = [nodeId]
  spec.domains = []
  spec.stacks = []
  mode.value = 'random'
  pickerOpen.value = false
  await start()
  toast.ok(`已切换到前置考点「${nodeTitle}」，从更基础的题开始练`)
}

const cur = computed(() => queue.value[idx.value] ?? null)
const q = computed(() => cur.value?.q ?? null)
const doneCount = computed(() => sessionScores.value.length)
const avgPct = computed(() => (sessionScores.value.length ? Math.round(sessionScores.value.reduce((s, v) => s + v, 0) / sessionScores.value.length) : 0))

/* ---- 本组回看（R10）：只能回看已经做过/揭晓过的题，只读还原作答与批改 ---- */
const curTurn = computed<TurnSnapshot | null>(() => turns.value[idx.value] ?? null)
/** 回看模式 = 用户经历史导航（胶片/上一题/下一题）进入某道已有快照的题，只读、可标记蒙的 */
const isReview = computed(() => browsing.value && !!curTurn.value)
const canPrev = computed(() => idx.value > 0 && !!turns.value[idx.value - 1])
const guessedNow = computed(() => !!curTurn.value?.guessed)

/** 题号胶片每个点的态：当前 / 蒙题标记 / 对(≥60) / 错 / 仅看答案未批改 / 还没做到 */
function dotClass(i: number) {
  if (i === idx.value) return 'cur'
  const t = turns.value[i]
  if (!t) return 'todo'
  if (t.guessed) return 'guessed'
  if (!t.graded || !t.grade) return 'revealed'
  return t.grade.pct >= 60 ? 'good' : 'bad'
}
function dotTitle(i: number) {
  const t = turns.value[i]
  if (!t) return `第 ${i + 1} 题：还没做到，先完成前面的题`
  const base = `第 ${i + 1} 题`
  if (t.guessed) return `${base}：已标记蒙的（按完全不会计入）`
  if (!t.graded || !t.grade) return `${base}：仅看答案，未批改`
  return `${base}：${t.grade.pct} 分，点击回看我的作答与批改`
}
const focusTitle = computed(() => (cur.value && spec.nodeIds.length ? cur.value.nodeTitle : ''))
const selectedLabel = computed(() => {
  if (spec.nodeIds.length) return focusTitle.value || '指定考点'
  if (spec.stacks.length) return stackOpts.value.filter((s) => spec.stacks.includes(s.value)).map((s) => s.label).join('、')
  return spec.domains.map((d) => domainOpts.find((o) => o.value === d)?.label ?? d).join('、') || '全部板块'
})

/* ---- 展示派生值 ---- */
const progressPct = computed(() => (queue.value.length ? Math.round((doneCount.value / queue.value.length) * 100) : 0))
const dailyTarget = computed(() => (store.settings ? Math.max(5, Math.min(30, store.settings.dailyTarget)) : spec.count))
const SELF_SHORT = ['完全不会', '提示后会', '能独立说清', '能举证']
const selfBtns = computed(() => SELF_SHORT.map((label, i) => ({
  i,
  label,
  full: `${i} · ${SCALE_LABEL[i]}`,
  color: scale4Color(i),
  soft: scale4Soft(i),
  on: grade.value?.gradingKind === 'self' && grade.value.scale4 === i
})))
const isWrong = computed(() => !!grade.value && grade.value.pct < 60)
const showFeedback = computed(() => !!q.value && !!grade.value && busy.value !== 'queue')
const analysisHtml = computed(() => (q.value?.analysis ? renderMd(q.value.analysis) : ''))
const gapList = computed<string[]>(() => (q.value?.gapCheck ?? []) as string[])

function buildSpec() {
  return {
    domains: spec.nodeIds.length ? [] : spec.domains,
    stacks: spec.stacks,
    nodeIds: spec.nodeIds,
    count: dailyTarget.value,
    random: mode.value === 'random'
  }
}

async function start() {
  busy.value = 'queue'
  try {
    const rows = await ipc.practice.queue(buildSpec())
    if (!rows.length) { toast.warn('这个模块暂时抽不到题：题库还没铺到这里，换个模块，或去「题库·版本」页让 AI 补题'); return }
    queue.value = rows
    idx.value = 0
    answer.value = null
    grade.value = null
    revealed.value = false
    turns.value = new Array(rows.length).fill(null)
    answeredUpTo.value = -1
    browsing.value = false
    sessionScores.value = []
    justUnlocked.value = []
    pickerOpen.value = false
    toast.ok(mode.value === 'today' ? `抽出 ${rows.length} 题（到期复习优先）` : `随机抽出 ${rows.length} 题（无序、无关联）`)
  } catch (e: any) { toast.err(String(e?.message ?? e)) } finally { busy.value = '' }
}

async function submit(selfScale4?: number) {
  if (!cur.value || busy.value === 'submit') return
  busy.value = 'submit'
  try {
    const r = await ipc.practice.submit(cur.value.id, answer.value, { selfScale4 })
    grade.value = { ...(r.grade as GradeResult), myAnswerSnapshot: JSON.stringify(answer.value ?? {}) }
    revealed.value = true
    // 同题重复提交（提交后未翻页又改答案）只更新快照，不重复计入题数与均分
    if (!turns.value[idx.value]) sessionScores.value.push(r.grade.pct)
    saveTurn(true)
    if (r.unlockedNow?.length) {
      justUnlocked.value = r.unlockedNow
      toast.note(`点亮 ${r.unlockedNow.length} 个考点`, `${r.unlockedNow.map((u: any) => u.title).join('、')}；后继节点已解锁`)
      void store.loadPlan()
    }
    if (r.aiUnavailable) toast.warn(r.aiUnavailable)
    // 游戏化：拉取本次 XP/升级/徽章等庆祝事件（弹窗由 CelebrationModal 统一播放）
    void game.syncAfterSettle()
  } catch (e: any) { toast.err(String(e?.message ?? e)) } finally { busy.value = '' }
}

/** 把当前题的作答与批改落进本组快照，并推进已作答游标（同题重复提交不重复计数） */
function saveTurn(graded: boolean) {
  const i = idx.value
  const existed = !!turns.value[i]
  turns.value[i] = {
    answer: answer.value === null ? null : JSON.parse(JSON.stringify(answer.value)),
    grade: grade.value ? { ...grade.value } : null,
    revealed: revealed.value,
    graded,
    guessed: turns.value[i]?.guessed ?? false
  }
  if (!existed) {
    answeredUpTo.value = Math.max(answeredUpTo.value, i)
  }
}

/**
 * 跳到本组内某一道题。
 * @param historyNav 是否为「回看历史」导航（胶片/上一题/下一题翻已做过的题）：
 *   目标有快照且是回看导航 → 只读回看态；正常向后走到下一道未答题 → 作答态。
 */
function goto(i: number, historyNav = false) {
  if (i < 0 || i >= queue.value.length) return
  idx.value = i
  const snap = turns.value[i]
  if (snap) {
    answer.value = snap.answer === null ? null : JSON.parse(JSON.stringify(snap.answer))
    grade.value = snap.grade ? { ...snap.grade } : null
    revealed.value = snap.revealed
    // 回看历史题一律进只读态；只有在最新已答题上继续向后（historyNav=false）才退出回看
    browsing.value = historyNav
  } else {
    answer.value = null
    grade.value = null
    revealed.value = false
    browsing.value = false
  }
}

function prev() {
  if (canPrev.value) goto(idx.value - 1, true)
}

/** 从回看位置回到最新揭晓的那道题（仍是回看只读态，便于继续翻看/标记） */
function backToLatest() {
  goto(answeredUpTo.value >= 0 ? answeredUpTo.value : 0, true)
}

async function revealWithoutGrading() {
  if (!cur.value) return
  revealed.value = true
  grade.value = { qid: cur.value.id, scale4: 0, pct: 0, gradingKind: 'self', verdict: '未作答，仅展示答案（不计入掌握度）' }
  saveTurn(false)
}

async function next() {
  if (!revealed.value) { await revealWithoutGrading(); return }
  // 回看态点「下一题」：在已作答区间内顺序翻看（保持只读），翻到最新题之后再进新题
  if (browsing.value && idx.value < answeredUpTo.value) { goto(idx.value + 1, true); return }
  if (idx.value + 1 >= queue.value.length) {
    const avg = avgPct.value
    const tail = `${justUnlocked.value.length ? `新点亮 ${justUnlocked.value.length} 个考点。` : ''}建议去图谱页看看刚解锁了什么。`
    if (avg >= 60) toast.note(`本组完成 ${doneCount.value} 题`, `平均 ${avg} 分。${tail}`)
    else toast.warn(`本组完成 ${doneCount.value} 题，平均只有 ${avg} 分。${tail}`)
    void store.loadPlan()
    void store.loadBank()
    pickerOpen.value = true
    return
  }
  goto(idx.value + 1)
}

/** 「这题我是蒙的」：追加 0 档记录驱动降级/进错题本，本组快照同步打标，原批改保留可见 */
async function markGuessed() {
  if (!cur.value || busy.value === 'guess') return
  busy.value = 'guess'
  try {
    const r = await ipc.practice.markGuessed(cur.value.id)
    const i = idx.value
    const snap = turns.value[i]
    if (snap) {
      turns.value[i] = { ...snap, guessed: true }
    }
    toast.note('已按「完全不会」重新计入', '这题会提前安排复习并进入错题本；原来的批改记录仍保留。')
    void store.loadPlan()
    void store.loadBank()
    return r
  } catch (e: any) { toast.err(String(e?.message ?? e)) } finally { busy.value = '' }
}

async function genMoreVariants() {
  if (!cur.value) return
  busy.value = 'variant'
  try {
    const r = await ipc.practice.genVariant(cur.value.id, 2)
    if (r.ok) toast.ok(`已为该考点新增 ${r.added} 道变体（下次巩固可能出现）`)
    else toast.err(r.error ?? '生成失败')
  } catch (e: any) { toast.err(String(e?.message ?? e)) } finally { busy.value = '' }
}

function clearFocus() {
  spec.nodeIds = []
  spec.stacks = []
  void router.replace({ path: '/practice' })
  void start()
}
function openNode(id: string) { void router.push({ path: '/graph', query: { node: id } }) }
function switchMode(m: 'today' | 'random') {
  mode.value = m
  if (spec.nodeIds.length) return // 定向考点不切今日
  queue.value = []
}

/** 按路由 query 调整组卷条件，返回是否发生了改动 */
function applyRouteQuery(): boolean {
  const node = route.query.node as string | undefined
  const stack = route.query.stack as string | undefined
  const domain = route.query.domain as string | undefined
  if (node) { spec.nodeIds = [node]; spec.domains = []; spec.stacks = []; mode.value = 'random' }
  else if (stack) { spec.stacks = [stack]; spec.domains = domain ? [domain] : []; mode.value = 'random' }
  else if (domain) { spec.domains = [domain]; mode.value = 'random' }
  else return false
  return true
}

async function loadStacks() {
  try {
    const tree = await ipc.graph.tree() as GraphNode[]
    stackOpts.value = tree
      .filter((n) => n.level === 2 && n.qTotal > 0)
      .map((n) => ({ value: n.id.split('.')[1] ?? n.id, label: n.title, domain: n.domain, qTotal: n.qTotal }))
  } catch { /* 拉不到就只用板块选择 */ }
}

onMounted(async () => {
  await store.boot()
  if (store.settings) spec.count = Math.max(5, Math.min(30, store.settings.dailyTarget))
  await loadStacks()
  const routed = applyRouteQuery()
  if (!routed) mode.value = 'random'
  void start()
})

// KeepAlive 之后 onMounted 只跑一次：从首页/图谱/命令面板跳进来时必须按 query 重新组卷。
watch(() => route.fullPath, () => {
  if (route.path !== '/practice') return
  const qq = route.query
  if (!(qq.node || qq.stack || qq.domain || qq.today)) return
  if (qq.today) { mode.value = 'today'; spec.nodeIds = [] }
  applyRouteQuery()
  void start()
})
</script>

<template>
  <div class="page">
    <!-- ===== 简洁模块选择条（R9-④：不再有难度/题量/混入等手动参数） ===== -->
    <div class="toolbar picker-bar">
      <div class="tb-line">
        <div class="seg tb-seg" role="tablist" aria-label="练习方式">
          <button type="button" :class="{ on: mode === 'random' }" :disabled="!!spec.nodeIds.length" @click="switchMode('random')">
            <Icon name="sparkles" :size="13" /> 随机练习
          </button>
          <button type="button" :class="{ on: mode === 'today' }" :disabled="!!spec.nodeIds.length" @click="switchMode('today')">
            <Icon name="flame" :size="13" /> 今日复习
          </button>
        </div>

        <span class="grow" />

        <div class="prog" :title="`本组已完成 ${doneCount} / ${queue.length} 题`">
          <div class="bar prog-bar accent"><i :style="{ width: `${progressPct}%` }" /></div>
          <span class="tiny faint num">已完成 <b class="num">{{ doneCount }}</b>/<span class="num">{{ queue.length }}</span></span>
          <span v-if="avgPct" class="pill" :style="{ background: 'color-mix(in oklab, ' + pctColor(avgPct) + ' 12%, transparent)', color: pctColor(avgPct) }">
            均分 {{ avgPct }}
          </span>
        </div>

        <div class="acts">
          <n-button size="small" quaternary :loading="busy === 'queue'" title="按当前模块重新随机抽一组" @click="start">
            <Icon name="refresh" :size="14" /> 换一组
          </n-button>
          <n-button size="small" quaternary :disabled="!cur || !!grade" :loading="busy === 'variant'" title="为当前考点补两道变体" @click="genMoreVariants">
            <Icon name="sparkles" :size="14" /> 补变体
          </n-button>
          <n-button data-testid="practice-reveal" size="small" quaternary :disabled="!cur || revealed" title="不做批改，直接看答案" @click="revealWithoutGrading">
            <Icon name="book" :size="14" /> 看答案
          </n-button>
          <button type="button" class="btn ghost tb-fold" :title="pickerOpen ? '收起模块选择' : '展开模块选择'" @click="pickerOpen = !pickerOpen">
            <Icon name="gear" :size="14" /> 模块
            <Icon name="chevronDown" :size="13" class="fold-ic" :class="{ up: !pickerOpen }" />
          </button>
        </div>
      </div>

      <!-- 模块选择行：只选练哪里，不调学习参数 -->
      <div v-show="pickerOpen && !spec.nodeIds.length" class="tb-line tb-row2">
        <label class="fld">
          <span class="micro faint">板块</span>
          <n-select v-model:value="spec.domains" multiple size="small" :max-tag-count="2" :options="domainOpts" placeholder="选择板块" />
        </label>
        <label class="fld fld-grow">
          <span class="micro faint">技术栈（不选 = 板块内全部）</span>
          <n-select v-model:value="spec.stacks" multiple size="small" :max-tag-count="3" :options="stackGroups"
            placeholder="全部技术栈" :disabled="!spec.domains.length" />
        </label>
        <n-button size="small" type="primary" :loading="busy === 'queue'" class="start-btn" @click="start">
          <Icon name="play" :size="14" /> 开始练习
        </n-button>
        <span class="micro faint hint">题量、复习混入等在「设置 · 学习算法参数」里调；题目在所选模块内随机、无序、无关联</span>
      </div>

      <!-- 定向考点提示：正常文档流内的整条提示，不再浮动溢出（R9-③） -->
      <div v-if="spec.nodeIds.length || spec.stacks.length" class="scope-strip">
        <Icon name="target" :size="14" class="scope-ic" />
        <span class="tiny ellip scope-txt">
          已限定模块：<b>{{ selectedLabel }}</b>
          <span class="faint">（{{ spec.nodeIds.length ? '只在这个考点内随机出题' : '只在该技术栈内随机出题' }}）</span>
        </span>
        <n-button size="tiny" quaternary @click="clearFocus">取消限定</n-button>
      </div>
    </div>

    <!-- ===== 本组题号胶片：做过的题可点击回看（含蒙题标记），没做到的题置灰不可跳 ===== -->
    <div v-if="answeredUpTo >= 0" class="filmstrip card" data-testid="practice-filmstrip">
      <span class="micro faint film-cap"><Icon name="book" :size="12" /> 本组题目（点击回看）</span>
      <div class="film-items">
        <button v-for="(row, i) in queue" :key="row.id" type="button" class="film-dot"
          :class="dotClass(i)" :disabled="i > answeredUpTo" :title="dotTitle(i)"
          :data-testid="`film-dot-${i}`" @click="i <= answeredUpTo && goto(i, true)">
          <span class="num">{{ i + 1 }}</span>
          <Icon v-if="turns[i]?.guessed" name="flag" :size="10" class="dot-flag" />
        </button>
      </div>
    </div>

    <!-- ===== 拉题骨架 ===== -->
    <div v-if="busy === 'queue'" class="card sk-card">
      <div class="sk-pills"><span class="skeleton" /><span class="skeleton" /><span class="skeleton" /></div>
      <div class="skeleton sk-line" style="width:92%" />
      <div class="skeleton sk-line" style="width:76%" />
      <div class="skeleton sk-block" style="height:150px;margin-top:14px" />
      <div class="tiny faint" style="margin-top:12px"><Icon name="zap" :size="13" /> 正在从「{{ selectedLabel }}」随机抽题…</div>
    </div>

    <!-- ===== 题目主体 ===== -->
    <div v-else-if="cur && q" :key="cur.id" class="card rise" style="--i:0">
      <div class="qmeta">
        <span class="pill info num"><Icon name="target" :size="12" /> {{ idx + 1 }}/{{ queue.length }}</span>
        <span v-if="isReview" class="pill lock review-pill"><Icon name="book" :size="12" /> 回看 · 只读</span>
        <span v-if="guessedNow" class="pill warn guess-pill"><Icon name="flag" :size="12" /> 已标记「蒙的」</span>
        <span class="pill" :class="typePillClass(cur.type)"><Icon :name="TYPE_ICON_NAME[cur.type] || 'book'" :size="12" /> {{ TYPE_LABEL[cur.type] }}</span>
        <span class="pill lock"><Icon name="chart" :size="12" /> 难度 {{ cur.difficulty }} · {{ DIFF_LABEL[cur.difficulty] }}</span>
        <span v-if="cur.angle" class="pill warn"><Icon name="refresh" :size="12" /> 巩固变体 · <span class="ellip">{{ cur.angle }}</span></span>
        <span v-else-if="cur.parent_id" class="pill purple"><Icon name="layers" :size="12" /> 变体题</span>
        <span class="qnode ellip" :title="cur.nodeTitle">{{ cur.nodeTitle }}</span>
      </div>

      <!-- 考点要求：作答前把「考到什么深度、自己处于哪一态」摆出来，讲义入口改为低调文字按钮（不自动弹抽屉） -->
      <div v-if="cur.nodeSummary || cur.mastery_level" class="node-requirement" :class="stateClassOf(cur)">
        <Icon name="target" :size="14" class="nr-ic" />
        <div class="nr-body">
          <div class="nr-line">
            <span class="nr-state" :class="stateClassOf(cur)">{{ stateTextOf(cur) }}</span>
            <span class="nr-title">考点要求</span>
          </div>
          <p v-if="cur.nodeSummary" class="nr-summary">{{ cur.nodeSummary }}</p>
          <div class="nr-acts">
            <n-button size="tiny" secondary data-testid="practice-read-kb" @click="openKnowledge(cur.node_id, cur.nodeTitle, cur.id)">
              <Icon name="book" :size="13" /> 看不懂？查这个考点的讲义
            </n-button>
          </div>
        </div>
      </div>

      <div class="qbody">
        <QuestionBody :q="q" v-model="answer" :revealed="revealed" :disabled="!!grade || isReview" @submit="submit()" />
      </div>

      <hr class="hr" />

      <div v-if="!grade" class="act-row">
        <n-button data-testid="practice-submit" type="primary" :loading="busy === 'submit'" :disabled="!!busy" title="Ctrl+Enter（编程题编辑器内）同样提交" @click="submit()">
          <Icon name="check" :size="15" /> 提交并批改
        </n-button>
        <div class="s4-group" role="group" aria-label="四档自评">
          <span class="micro faint s4-cap">快速自评</span>
          <button v-for="b in selfBtns" :key="b.i" type="button" class="s4" :class="{ on: b.on }" :title="b.full"
            :disabled="!!busy" :style="{ '--sc': b.color, '--ss': b.soft }" @click="submit(b.i)">
            <b class="num">{{ b.i }}</b> {{ b.label }}
          </button>
        </div>
        <span class="kbd-hint">
          <kbd class="kbd">Ctrl</kbd><kbd class="kbd">Enter</kbd><span class="micro faint">编程题内提交</span>
          <kbd class="kbd">Tab</kbd><span class="micro faint">编程题缩进</span>
          <kbd class="kbd">⌘/Ctrl K</kbd><span class="micro faint">命令面板</span>
        </span>
      </div>
      <div v-else class="act-row">
        <!-- 回看本组做过的题：只读，可前后翻、可对蒙题纠偏，不能重新批改 -->
        <template v-if="isReview">
          <n-button size="small" :disabled="!canPrev" @click="prev">
            <Icon name="arrowLeft" :size="14" /> 上一题
          </n-button>
          <n-button size="small" type="primary" @click="next">
            下一题 <Icon name="arrowRight" :size="14" />
          </n-button>
          <n-button v-if="!guessedNow" size="small" type="warning" :loading="busy === 'guess'"
            data-testid="practice-mark-guessed" @click="markGuessed">
            <Icon name="flag" :size="14" /> 这题我是蒙的
          </n-button>
          <span v-else class="pill warn"><Icon name="flag" :size="13" /> 已按「完全不会」计入，会进错题本并提前复习</span>
          <n-button v-if="idx < answeredUpTo" size="small" quaternary @click="backToLatest">
            <Icon name="chevronDown" :size="14" /> 回到当前题
          </n-button>
          <span class="grow" />
          <n-button size="small" quaternary data-testid="practice-kb-after" @click="openKnowledge(cur.node_id, cur.nodeTitle)"><Icon name="book" :size="14" /> 查讲义</n-button>
        </template>
        <!-- 最新题：维持原「下一题/完成本组」主流程 -->
        <template v-else>
          <n-button data-testid="practice-next" type="primary" :disabled="!!busy" @click="next">
            <Icon name="arrowRight" :size="15" /> {{ idx + 1 >= queue.length ? '完成本组' : '下一题' }}
          </n-button>
          <n-button v-if="canPrev" size="small" quaternary data-testid="practice-prev" @click="prev">
            <Icon name="arrowLeft" :size="14" /> 回看上面的题
          </n-button>
          <n-button size="small" quaternary data-testid="practice-kb-after" @click="openKnowledge(cur.node_id, cur.nodeTitle)"><Icon name="book" :size="14" /> 查讲义</n-button>
          <n-button size="small" quaternary @click="openNode(cur.node_id)"><Icon name="graph" :size="14" /> 图谱定位</n-button>
          <span class="grow" />
          <span class="tiny faint">本组已答 <b class="num">{{ doneCount }}</b> 题 · 均分 <b class="num" :style="{ color: pctColor(avgPct) }">{{ avgPct }}</b></span>
        </template>
      </div>
    </div>

    <!-- ===== AI 批改骨架 ===== -->
    <div v-else-if="busy === 'submit'" class="card sk-card">
      <div class="skeleton sk-line" style="width:38%" />
      <div class="skeleton sk-block" style="height:96px;margin-top:12px" />
      <div class="sk-pills" style="margin-top:14px"><span class="skeleton" /><span class="skeleton" /><span class="skeleton" /></div>
      <div class="tiny faint" style="margin-top:12px"><Icon name="brain" :size="13" /> 走强模型逐评分点批改中，通常几秒…</div>
    </div>

    <div v-else class="empty">
      <span class="ic"><Icon name="search" :size="26" /></span>
      <span class="t">这个模块还没有题</span>
      <span class="d">多半是题库还没铺到这里。换个模块，或去「题库·版本」页让 AI 补一次。</span>
      <span class="cta"><n-button size="small" type="primary" @click="start">换一组试试</n-button></span>
    </div>

    <!-- ===== 反馈 ===== -->
    <div v-if="q && grade && busy !== 'queue'" class="fb-stage">
      <FeedbackPanel :q="q" :grade="grade" :node-id="cur?.node_id" :node-title="cur?.nodeTitle"
        :my-answer="grade.myAnswerSnapshot ?? '{}'" @open-node="openNode" />
    </div>

    <details v-if="showFeedback && analysisHtml" class="acc ana" :open="isWrong">
      <summary>
        <Icon name="book" :size="15" class="ana-ic" />
        <span>考点解析{{ isWrong ? '（本题失分，先看这里）' : '' }}</span>
        <span class="grow" />
        <span class="micro faint">{{ isWrong ? '展开中' : '点击展开' }}</span>
      </summary>
      <div class="acc-body">
        <div class="ana-kbbar">
          <span class="micro faint">解析还是看不懂？</span>
          <button type="button" class="chip" data-testid="practice-kb-analysis" @click="openKnowledge(cur?.node_id, cur?.nodeTitle)">
            <Icon name="book" :size="13" /> 读考点讲义 <Icon name="chevron" :size="12" />
          </button>
        </div>
        <div class="md" v-html="analysisHtml" />
      </div>
    </details>

    <details v-if="showFeedback && gapList.length" class="acc ana">
      <summary>
        <Icon name="layers" :size="15" class="ana-ic" />
        <span>查漏补缺清单（{{ gapList.length }} 项）</span>
        <span class="grow" />
        <span class="micro faint">交卷前必查</span>
      </summary>
      <div class="acc-body">
        <ul class="gap-list"><li v-for="(g, i) in gapList" :key="i">{{ g }}</li></ul>
      </div>
    </details>

    <!-- 知识阅读抽屉：只在主动点开时出现，绝不自动弹出 -->
    <KnowledgeDrawer v-model:open="kbOpen" :node-id="kbNodeId" :node-title="kbNodeTitle" :question-id="kbQuestionId"
      @navigate="onKbNavigate" @practice-node="onPracticeNode" />
    <!-- 游戏化庆祝：XP/升级/徽章/Boss 事件弹窗 + 彩带 -->
    <CelebrationModal />

    <div v-if="justUnlocked.length" class="card rise" style="--i:1">
      <div class="panel-head">
        <h3><Icon name="graph" :size="16" class="hd-ic" /> 本组新点亮的考点</h3>
        <span class="grow" />
        <span class="desc">后继节点已解锁，可以往上推进了</span>
      </div>
      <div class="row">
        <button v-for="u in justUnlocked" :key="u.nodeId" type="button" class="chip" @click="openNode(u.nodeId)">
          <Icon name="route" :size="13" /> <span class="ellip">{{ u.title }}</span>
          <Icon name="chevron" :size="12" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ---------- 工具条 / 模块选择 ---------- */
.toolbar { flex-direction: column; align-items: stretch; gap: var(--sp-2); min-width: 0; max-width: 100% }
.tb-line { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; min-width: 0 }
.tb-line .grow { flex: 1; min-width: var(--sp-4) }
.tb-seg { flex: 0 0 auto }
.tb-seg button { display: inline-flex; align-items: center; gap: 5px }
.tb-seg button:disabled { opacity: .45; cursor: not-allowed }
.acts { display: flex; align-items: center; gap: var(--sp-1); flex-wrap: wrap; flex: 0 0 auto }
.prog { display: flex; align-items: center; gap: var(--sp-2); flex: 1 1 190px; min-width: 148px; max-width: 420px }
.prog-bar { flex: 1 1 60px; min-width: 46px }
.prog .num { white-space: nowrap }
.tb-row2 { padding-top: 2px; border-top: 1px dashed var(--border); align-items: flex-end }
.fld { display: flex; flex-direction: column; gap: 3px; flex: 0 1 220px; min-width: 150px; max-width: 300px }
.fld-grow { flex: 1 1 280px; max-width: none }
.start-btn { flex: 0 0 auto; align-self: flex-end }
.hint { flex-basis: 100%; margin-top: 2px }
.sw { display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-sm); color: var(--text-dim); flex: 0 0 auto }
.tb-fold { gap: 4px }
.fold-ic { transition: transform var(--dur) var(--ease-out) }
.fold-ic.up { transform: rotate(-90deg) }
.hd-ic { color: var(--text-faint) }

/* 定向模块提示条：占满整行、留在文档流内，从根上杜绝被 flex 挤出视口的浮动红框（R9-③）。
   父级 .toolbar 是 column 布局，交叉轴宽度要用 width:100%（flex-basis:100% 是行内换行写法，
   在列布局里不约束宽度，配合 nowrap 长文本会把整条撑出容器右缘）。 */
.scope-strip {
  width: 100%; box-sizing: border-box; display: flex; align-items: center; gap: var(--sp-2); min-width: 0;
  margin-top: 2px; padding: 8px 12px; border: 1px solid color-mix(in oklab, var(--warn) 30%, var(--border));
  border-left-width: 3px; border-radius: var(--r-md);
  background: color-mix(in oklab, var(--warn) 8%, var(--surface));
}
.scope-ic { color: var(--warn); flex: 0 0 auto }
/* 长考点名单行省略（title 已带完整文本），配合 min-width:0 防止把 flex 容器撑破 */
.scope-txt { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.scope-strip > .n-button { flex: 0 0 auto }
.scope-strip .faint { color: var(--text-faint) }

/* ---------- 本组题号胶片（回看导航） ---------- */
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
.film-dot:hover:not(:disabled) { transform: translateY(-1px); border-color: color-mix(in oklab, var(--accent) 45%, var(--border)); color: var(--accent-2) }
.film-dot:disabled { opacity: .4; cursor: not-allowed }
.film-dot.cur { outline: 2px solid var(--accent); outline-offset: 1px; color: var(--accent-2) }
.film-dot.good { color: var(--ok); border-color: color-mix(in oklab, var(--ok) 45%, var(--border)); background: color-mix(in oklab, var(--ok) 10%, var(--surface-2)) }
.film-dot.bad { color: var(--bad); border-color: color-mix(in oklab, var(--bad) 45%, var(--border)); background: color-mix(in oklab, var(--bad) 10%, var(--surface-2)) }
.film-dot.revealed { color: var(--text-faint); border-style: dashed }
.film-dot.guessed { color: #fff; border-color: var(--warn); background: var(--warn) }
.film-dot.guessed .num, .film-dot.guessed .dot-flag { color: #fff }
.dot-flag { margin-left: 2px }
.review-pill, .guess-pill { display: inline-flex; align-items: center; gap: 3px }

/* ---------- 题目卡 ---------- */
.qmeta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: var(--sp-3) }
.qnode { flex: 1 1 120px; min-width: 0; text-align: right; font-size: var(--fs-sm); color: var(--text-faint); overflow-wrap: anywhere }
.qbody :deep(.stem) { font-size: var(--fs-md); line-height: var(--lh-loose); font-weight: 550; overflow-wrap: anywhere }
.qbody :deep(.opt), .qbody :deep(.code-area), .qbody :deep(input) { max-width: 100% }
.qbody :deep(.grid), .qbody :deep(.row) { min-width: 0 }

/* ---------- 动作行 + 四档自评 ---------- */
.act-row { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap }
.act-row .grow { flex: 1; min-width: var(--sp-4) }
.s4-group { display: inline-flex; align-items: stretch; gap: 4px; flex-wrap: wrap; padding: 4px; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--surface-2) }
.s4-cap { align-self: center; padding: 0 4px }
.s4 { display: inline-flex; align-items: center; gap: 5px; padding: 6px 10px; min-height: 30px; border: 1px solid transparent; border-radius: calc(var(--r-md) - 3px); background: transparent; color: var(--sc); font: inherit; font-size: var(--fs-sm); font-weight: 550; cursor: pointer; transition: background-color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--spring), box-shadow var(--dur-fast) }
.s4 b { font-size: var(--fs-xs); opacity: .8 }
.s4:hover:not(:disabled) { background: var(--ss); border-color: var(--sc) }
.s4:active:not(:disabled) { transform: scale(.97) }
.s4:focus-visible { box-shadow: var(--ring) }
.s4.on { background: var(--ss); border-color: var(--sc); box-shadow: var(--sh-1); font-weight: 650 }
.s4:disabled { opacity: .45; cursor: not-allowed }
.kbd-hint { display: inline-flex; align-items: center; gap: 5px; flex-wrap: wrap; margin-left: auto }
.kbd-hint .micro { margin-right: 6px }

/* ---------- 骨架 / 反馈 / 折叠 ---------- */
.sk-card { display: block }
.sk-pills { display: flex; gap: 8px; flex-wrap: wrap }
.sk-pills .skeleton { height: 20px; width: 78px; border-radius: var(--r-pill) }
.fb-stage { display: grid; gap: var(--sp-3); min-width: 0 }
.fb-stage :deep(> div > .card), .fb-stage :deep(> div > .fb), .fb-stage :deep(> div > .grid) { margin-top: 0 }
.fb-stage :deep(.card), .fb-stage :deep(.fb), .fb-stage :deep(.grid) { min-width: 0; overflow-wrap: anywhere }
.fb-stage :deep(.g2 > .card:first-child) { display: none }
.ana { margin-top: 0 }
.ana summary { color: var(--text-dim); font-weight: 550 }
.ana-ic { color: var(--text-faint); flex: 0 0 auto }
.gap-list { margin: 0; padding-left: 20px; line-height: var(--lh-loose) }
.gap-list li::marker { color: var(--text-faint) }
.empty .ic { display: grid }

/* ---------- 解锁 chips ---------- */
.chip { display: inline-flex; align-items: center; gap: 5px; max-width: 260px; padding: 5px 10px; border-radius: var(--r-pill); border: 1px solid var(--border); background: var(--surface-2); color: var(--text-dim); font: inherit; font-size: var(--fs-sm); cursor: pointer; transition: border-color var(--dur-fast), color var(--dur-fast), background-color var(--dur-fast), transform var(--dur-fast) var(--ease-out) }
.chip > span { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.chip svg { flex: 0 0 auto }
.chip:hover { border-color: color-mix(in oklab, var(--accent) 45%, var(--border)); color: var(--accent-2); background: color-mix(in oklab, var(--accent) 8%, var(--surface)); transform: translateY(-1px) }
.chip:active { transform: scale(.98) }

@media (max-width: 900px) {
  .prog { flex-basis: 100%; max-width: none; order: 5 }
  .kbd-hint { margin-left: 0; flex-basis: 100% }
  .qnode { text-align: left }
}

/* 考点要求条 */
.node-requirement { display: flex; gap: 10px; align-items: flex-start; margin: 12px 0 4px;
  padding: 10px 12px; border: 1px solid var(--border); border-left-width: 3px; border-radius: var(--r-md);
  background: var(--surface-2); }
.node-requirement .nr-ic { margin-top: 2px; color: var(--text-dim); flex: 0 0 auto }
.node-requirement.st-mastered { border-left-color: var(--ok) }
.node-requirement.st-learning { border-left-color: var(--warn) }
.node-requirement.st-stale { border-left-color: var(--hot); border-left-style: dashed }
.node-requirement.st-untouched { border-left-color: var(--purple) }
.nr-line { display: flex; align-items: center; gap: 8px; margin-bottom: 3px }
.nr-state { font-size: var(--fs-xs); font-weight: 700; padding: 1px 8px; border-radius: var(--r-pill) }
.nr-state.st-mastered { color: var(--ok); background: color-mix(in oklab, var(--ok) 13%, transparent) }
.nr-state.st-learning { color: var(--warn); background: color-mix(in oklab, var(--warn) 14%, transparent) }
.nr-state.st-stale { color: var(--hot); background: color-mix(in oklab, var(--hot) 13%, transparent) }
.nr-state.st-untouched { color: var(--purple); background: color-mix(in oklab, var(--purple) 13%, transparent) }
.nr-title { font-size: var(--fs-xs); color: var(--text-dim); font-weight: 600 }
.nr-summary { margin: 0; font-size: var(--fs-sm); color: var(--text); line-height: 1.55 }
.nr-acts { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 10px }
.ana-kbbar { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px dashed var(--border) }
</style>
