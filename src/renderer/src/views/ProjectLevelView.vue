<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { ProjectDetail, ProjectLevelCard, ProjectRunResult, ProjectStage } from '@shared/api'
import CodeEditor from '../components/CodeEditor.vue'
import CelebrationModal from '../components/CelebrationModal.vue'
import Icon from '../components/Icon.vue'
import { dialog, renderMd, toast } from '../lib/ui'
import { highlightCode } from '../lib/highlight'
import { ipc } from '../lib/ipc'
import { useGameStore } from '../game-store'

/**
 * 关卡工作台：左边读，右边写。
 *
 * 第一版的失败教训（用户原话：「reactive(obj) 是做什么的？我根据你的信息只能写出一个空函数」）：
 * 讲解被放在「通关后才解锁的复盘区」里，所以真正需要它的时候一个字都看不到。
 * 现在左栏的顺序固定为「目标 → 为什么 → 前置知识 → API 契约 → 分步 → 提示」，
 * 前置知识和 API 契约无条件展开：不会写的人，是因为没人告诉他函数签名和返回值。
 *
 * 交互上把「写」和「判」分开：代码改动只做 800ms 防抖存草稿（失败静默），
 * 只有用户主动跑测试才进判题流程。卡住时离开页面不会丢代码。
 */
const route = useRoute()
const router = useRouter()
const game = useGameStore()

const projectId = computed(() => String(route.params.projectId ?? ''))
const levelId = computed(() => String(route.params.levelId ?? ''))

const detail = ref<ProjectDetail | null>(null)
const loading = ref(true)
const loadError = ref('')
const ready = ref(false)

const code = ref('')
/** 上一次与服务端对齐过的代码。code 与它相同 = 本地没有任何未保存的改动，
 *  这时服务端的草稿如果变了（典型：在地图页点了「从零重做」），就该跟着服务端走；
 *  反之（用户正在改）绝不能覆盖，否则一按 Ctrl+S 般的切页就把人打的字吞掉。 */
const loadedDraft = ref('')
/**
 * 切到当前步时编辑器被填进去的那份代码。
 *
 * 它和 loadedDraft 的区别：loadedDraft 跟着服务端草稿走（保存后就会变），
 * 这个只在「进入某一步」的那一刻记一次，用来回答「这一步是从哪份代码开始写的」——
 * 跑测试时把它交给主进程判断「这次红算不算数」，也用它判断人到底动没动笔。
 */
const loadedStageSeed = ref('')
const running = ref(false)
const result = ref<ProjectRunResult | null>(null)
/** 本次会话内刚通关标记：不依赖重新拉详情，弹完结果就能看到参考答案/知识点 */
const passedNow = ref(false)
const hintsOpen = ref(false)
const editorRef = ref<{ focusTodo: (todo: string) => void } | null>(null)

const level = computed<ProjectLevelCard | null>(
  () => detail.value?.levels.find((l) => l.id === levelId.value) ?? null
)
const levelCount = computed(() => detail.value?.levelCount ?? 0)
const isDone = computed(() => !!level.value?.done || passedNow.value)
const solution = computed(() => result.value?.solution ?? level.value?.solution ?? null)
const nextLevelId = computed(() => result.value?.nextLevelId ?? null)

/** 骨架里还剩几个 TODO 没补：比「字符数」有用得多，直接告诉人还差几步。
 *  只统计骨架里真实存在的编号——用户草稿里可能残留上一版内容的 TODO，不能算进来。 */
const todoIds = computed(() => {
  const ids = new Set<string>()
  for (const m of String(level.value?.skeleton ?? '').matchAll(/TODO\s+(\d+)/g)) ids.add(m[1])
  return ids
})
const todoTotal = computed(() => todoIds.value.size)
const todoLeft = computed(() => {
  const left = new Set<string>()
  for (const m of code.value.matchAll(/TODO\s+(\d+)/g)) {
    if (todoIds.value.has(m[1])) left.add(m[1])
  }
  return left.size
})
const codeHtml = (s: string): string => highlightCode(s, 'js')

/* ---------- v3：思维链 + 分阶段 ---------- */

/** 思维链：我做这个功能时真实想过的几句话（不是知识点，是决策过程） */
const thinking = computed(() => level.value?.thinking ?? [])
/** 分阶段：为空表示这是老的「骨架 + TODO」关卡，仍按老流程走 */
const stages = computed<ProjectStage[]>(() => level.value?.stages ?? [])
const staged = computed(() => stages.value.length > 0)

/**
 * 已经通过的阶段编号：本次跑通的 + 服务端记住的 + 整关已通关时全部算通过。
 *
 * 服务端那份（level.stageDone）是「刷新页面还能接着往下走」的唯一依据。
 * 之前只认本次会话的 result：F5 一下，四步全绿的路线退回第 1 步，
 * 用户看到的是「我刚才不是过了吗」——这不是显示问题，是他会怀疑自己。
 */
const stageDone = computed(() => {
  const set = new Set<number>()
  if (isDone.value) for (const s of stages.value) set.add(s.n)
  for (const n of result.value?.stageDone ?? level.value?.stageDone ?? []) set.add(n)
  return set
})

/**
 * 进度推到了第几步（0-based）：这是「服务端 + 本次结果」认定的水位。
 *
 * 水位只进不退。以前的写法是「本次停在哪一步就以哪一步为准」，于是出现这一串：
 * 人站在第 4 步写 delete，顺手把第 3 步的 setCount++ 改坏了 → 这次结果第一个红的步
 * 变成第 3 步 → 水位退回第 3 步 → 顶部第 4 步的 tab 被禁用（i > progressStage），
 * 人正站着的当前步点不动，只能点第 3 步，一进第 3 步就再也回不去第 4 步。
 *
 * 那是「我这次写坏了前面」，不是「我没走到这里」。两件事必须分开：
 * 前面的步红了 → 在结果面板里如实说（见 earlierFail），但水位留在已经走到的地方。
 */
const progressStage = computed(() => {
  if (!staged.value) return 0
  const last = stages.value.length - 1
  const r = result.value
  // 历史水位：第一个还没通过的步
  const next = stages.value.findIndex((s) => !stageDone.value.has(s.n))
  const byHistory = next < 0 ? last : next
  // 本次结果只能把水位往前抬（一次跨过两步那种），不能把它拉回来
  if (r?.stages?.length && !r.passed) return Math.max(byHistory, Math.min(r.stageIndex, last))
  return byHistory
})

/**
 * 现在正在看/写第几步（0-based）。
 *
 * 和 progressStage 分开：进度是「我推进到哪」，viewStage 是「我此刻在看哪」。
 * 用户可以点顶部的步骤条切回已经做过的步去对照，但他手动切回去之后，
 * 进度再往前走也不能把他从旧步里拽出来。
 */
const viewStage = ref(0)
const currentStage = computed(() => (staged.value ? Math.min(viewStage.value, stages.value.length - 1) : 0))

/** 在看的是已经通过过的旧步（只读回看，不能在旧步里改代码） */
const viewingPast = computed(() => staged.value && currentStage.value < progressStage.value)

/**
 * 当前这一步本身。
 *
 * 首屏的职责只有一个：告诉人「现在写什么」。之前的版本把目标、why、6 条思维链、
 * 4 张前置知识卡、API 契约全展开摆在第 1 步前面，人还没动笔就先被几千字压住。
 * 现在这些全部收进折叠区，只把当前步的 hint 摆在最显眼的位置。
 */
const nowStage = computed<ProjectStage | null>(() => stages.value[currentStage.value] ?? null)

/** 左栏「这一步要做的」那句：失败横幅里的「看提示」把它滚到视野中央再闪一下 */
const nowHintEl = ref<HTMLElement | null>(null)
const hintFlash = ref(false)
let hintFlashTimer: number | null = null
function focusHint(): void {
  const el = nowHintEl.value
  if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  hintFlash.value = true
  if (hintFlashTimer !== null) window.clearTimeout(hintFlashTimer)
  hintFlashTimer = window.setTimeout(() => { hintFlash.value = false }, 1800)
}

/**
 * 正在看的那一步，本次跑红了没有。
 *
 * 失败横幅只说「还有 N 个检查点没过」是不够的：人看不出红的是哪一步、这一步到底要做什么。
 * 这里把「第几步 + 标题 + 那句提示」一起带进结果面板，红字旁边就是他该对照的东西。
 *
 * 只认「当前显示步」而不是「整关第一个红的步」：人切到第 2 步回看时，
 * 面板不该拿第 4 步的失败来给他看——那正是他抱怨过的「错误提示变成了下一步的」。
 */
const failedStage = computed<ProjectStage | null>(() => {
  const r = result.value
  if (!r || r.passed) return null
  const sg = (r.stages ?? []).find((s) => s.n === viewN.value && !s.ok && !s.skipped)
  if (!sg) return null
  return stages.value.find((s) => s.n === sg.n) ?? null
})

/** 某一步「完成后的完整代码」：本次跑通了就现拿，整关通关后从关卡数据里拿 */
function stageCode(s: ProjectStage): string | null {
  const ran = result.value?.stages?.find((x) => x.n === s.n)
  return ran?.code ?? s.code ?? null
}

/**
 * 本次跑红的步，如果它比「我正站着的这一步」更靠前，就把它单独拎出来说。
 *
 * 典型场景：人在第 4 步写 delete，顺手把第 3 步的 setCount++ 改坏了。
 * 判定是串行的（第 3 步红了就不往下跑），于是第 4 步这次直接 skipped。
 * 以前页面在这种情况下只会说一句「第 3 步已经过了，第 4 步还没开始写」——
 * 人看到的却是自己明明在写第 4 步，顶部还退回去，像被判错了一样。
 *
 * 事实是：**你这次的改动把前面的步弄红了**。这句必须说出来，它才是人需要的线索；
 * 但绝不能因此把人从第 4 步拽走（progressStage 已经只进不退）。
 *
 * 也不给「去修第 N 步」的按钮：各步是累积的，第 4 步的代码里本来就含着第 3 步的实现。
 * 把编辑器和判定都切回第 3 步的快照，修完既不会带回第 4 步，还会分叉出两份代码。
 */
const earlierFail = computed<{ step: ProjectStage; cases: string[] } | null>(() => {
  const r = result.value
  if (!r || r.passed || !staged.value) return null
  const sg = (r.stages ?? []).find((s) => !s.ok && !s.skipped)
  if (!sg || sg.n >= viewN.value) return null
  const step = stages.value.find((s) => s.n === sg.n)
  if (!step) return null
  return { step, cases: (sg.cases ?? []).filter((c) => !c.ok).map((c) => c.name).filter(Boolean) }
})
const stageCodeHtml = (s: ProjectStage): string => {
  const c = stageCode(s)
  return c ? codeHtml(c) : ''
}

/* ---------- 每步一份代码快照：切步不互相覆盖 ---------- */

/**
 * 一步 = 一份独立的编辑器内容。
 *
 * 用户的原话：「我点击跑测试进入下一个步骤时，上一个步骤我写的代码应该留有快照，
 * 不要被后续的改动影响到。我可以在顶部切换我做过的步骤。」
 *
 * 以前只有一份草稿：第 3 步的实现接着写第 4 步，第 3 步那份就没了——想回去对照
 * 只能靠记忆。现在按步存，切步就是换一份内容：
 *   code  —— 这一步现在编辑器里的内容（切走时存下来）
 *   start —— 这一步开始时编辑器里的内容（判断「动没动笔」、跑测试算失败次数的基线）
 *   ran   —— 这一步有没有真的跑过测试（没跑过就绝不摊红字：那只是下一步的验收要求）
 */
type StepSnap = { code: string; start: string; ran: boolean; at: number }

/** 软启动/未知时红字收着，点「我已经写了」才摊开 */
const failExpanded = ref(false)

const snapsKey = (): string => `lf.stepSnaps.${projectId.value}.${levelId.value}`
const stepSnaps = ref<Record<string, StepSnap>>({})

function readSnaps(): Record<string, StepSnap> {
  try {
    const raw = localStorage.getItem(snapsKey())
    const v = raw ? JSON.parse(raw) : null
    if (!v || typeof v !== 'object') return {}
    const out: Record<string, StepSnap> = {}
    for (const [k, s] of Object.entries(v as Record<string, Partial<StepSnap>>)) {
      if (s && typeof s.code === 'string' && typeof s.start === 'string') {
        out[k] = { code: s.code, start: s.start, ran: s.ran === true, at: Number(s.at ?? 0) }
      }
    }
    return out
  } catch { return {} }
}
function writeSnaps(): void {
  try { localStorage.setItem(snapsKey(), JSON.stringify(stepSnaps.value)) } catch { /* 无痕模式：只留内存 */ }
}
/** 清空这一关的全部步骤快照（从零重做、换关卡时用） */
function clearSnaps(): void {
  stepSnaps.value = {}
  try { localStorage.removeItem(snapsKey()) } catch { /* 读不了就算了，内存里已经清空 */ }
}

const viewN = computed(() => stages.value[currentStage.value]?.n ?? 0)
const snapOf = (n: number): StepSnap | null => stepSnaps.value[String(n)] ?? null

/** 这一步真的跑过测试吗：没跑过，红字只是「下一步的验收要求」，不能摊给人看 */
const viewRan = computed(() => snapOf(viewN.value)?.ran === true)
/** 代码和「这一步开始时的样子」逐字相同 → 还没动笔 */
const viewUntouched = computed(() => {
  const s = snapOf(viewN.value)
  const base = s ? s.start : (loadedStageSeed.value || level.value?.skeleton || '')
  return squashWs(code.value) === squashWs(base)
})
/** 跑测试时交给主进程的基线：这一步从哪份代码开始的 */
const viewStartCode = computed(() => snapOf(viewN.value)?.start ?? loadedStageSeed.value ?? '')
/**
 * 回看的旧步在本机没有快照（这一版之前就通过了）。
 * 这时编辑器里给的是「这一步完成后的参考代码」，不是他当时写的——必须如实标注，
 * 否则他会以为自己的代码被改了。
 */
const viewSnapMissing = computed(() => viewingPast.value && !snapOf(viewN.value))

/** 把编辑器此刻的内容存进「它所属的那一步」 */
function stashCurrent(): void {
  const n = viewN.value
  if (!n) return
  const cur = snapOf(n)
  const start = cur?.start ?? loadedStageSeed.value ?? code.value
  stepSnaps.value[String(n)] = { code: code.value, start, ran: cur?.ran ?? false, at: Date.now() }
  writeSnaps()
}

/**
 * 某一步还没写过时，编辑器从哪份代码开始。
 *
 * 进度所在的那一步：服务端草稿就是「我上次写到的样子」，比重头找快照更准——
 * 中途某几步没有快照（升级前过的）时，往前找会一直退到第 1 步，
 * 人就以为自己的实现被吞了。
 *
 * 其余情况取「上一步的快照」：用户手写实现通过了上一步，下一步就是在它上面继续加功能。
 * 给他骨架等于把前面的实现吞掉；给他参考代码等于直接抄。
 */
function seedFor(idx: number): string {
  if (idx === progressStage.value && level.value?.draft) return level.value.draft
  return startSeedFor(idx)
}

/**
 * 这一步「开始时编辑器里本来就有的代码」——上一步的实现，或第 1 步的骨架。
 *
 * 和 seedFor 的区别只在「绝不看服务端草稿」：草稿是「我在这关写到的样子」，
 * 很可能已经是这一关正在写的那一步（正文也在这份代码上改）。把它当成起点，
 * 等于宣称「这一步我一个字都没改」——用户写了半小时，界面还在说「还没开始写」。
 * 这个错误的代价很具体：红字被绿条盖住，人不知道自己错在哪，还以为界面骗他。
 */
function startSeedFor(idx: number): string {
  for (let k = idx - 1; k >= 0; k--) {
    const s = snapOf(stages.value[k].n)
    if (s?.code) return s.code
  }
  return level.value?.skeleton ?? ''
}

/**
 * 切到第 idx 步（0-based）。
 *
 * 三件事必须一起做，少一件就是用户抱怨的那个 bug：
 * 1) 先把当前步的内容存进快照——否则切走即丢；
 * 2) 把答案面板、展开状态清零——不然它会跟着人走到下一步，显示成「下一步的错误提示」；
 * 3) 编辑器换成目标步的快照（没有就用上一步快照/骨架当起点）。
 */
/**
 * @param seedOverride 目标步的起点代码（只在目标步还没有快照时生效）。
 *   跑完测试推进时传「刚写好的那份代码」——下一步就是在这份代码上继续改；
 *   手动切步时不用传，交给 seedFor 决定。
 */
function enterStage(idx: number, seedOverride?: string): void {
  if (!staged.value) return
  const clamp = Math.max(0, Math.min(idx, stages.value.length - 1))
  if (clamp === viewStage.value) return
  stashCurrent()
  answer.value = null
  answerOpen.value = false
  failExpanded.value = false
  viewStage.value = clamp
  const n = stages.value[clamp]?.n ?? 0
  const snap = snapOf(n)
  const past = clamp < progressStage.value
  // 升级前通过的旧步没有快照：只能拿「这一步完成后的参考代码」顶上，并在界面上如实标注
  const fallback = past && stages.value[clamp]?.code ? stages.value[clamp].code : seedFor(clamp)
  const next = snap?.code ?? seedOverride ?? fallback
  loadedStageSeed.value = snap ? snap.start : next
  code.value = next
  loadedDraft.value = next
  // 服务端草稿始终镜像「当前查看的那一步」：刷新回来能看到同一份
  void ipc.project.saveDraft(projectId.value, levelId.value, next).catch(() => {})
}

/**
 * 进度往前走了（跑测试推进了一步）：自动跟到新的那一步，旧步的红字/答案不跟过来。
 *
 * 新步的起点就是「刚写好的那份代码」——因为下一步就是在这份代码上继续改。
 * 于是它的「动没动笔」判定天然是「还没开始写」，红字收着；
 * 直到人真的在这一步里改了内容，红字才摊开。这条也解释了「跨步写」为什么不摊红：
 * 那半成品是在上一步里写的，不是这一步。
 *
 * 传 code.value 而不是让 seedFor 自己找：seedFor 会看 level.draft，
 * 而草稿要等 800ms 防抖/一次 refresh 才更新，刚写的那份就在编辑器里，读它最准。
 */
function followProgress(i: number): void {
  if (!staged.value) return
  if (i > viewStage.value) enterStage(i, code.value)
}

/** 切回旧步回看：只读。改旧步等于偷偷改掉后面几步的地基，不是这里该做的事 */
const canEditCode = computed(() => !!level.value?.unlocked && !viewingPast.value)

/** 当前步的 tab 滚进可见范围：步数多的时候它可能在横向滚动条外面 */
function scrollTabIntoView(): void {
  requestAnimationFrame(() => {
    const el = document.querySelector('.stage-tab.now')
    if (el instanceof HTMLElement) el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  })
}
watch(currentStage, scrollTabIntoView)

/* ---------- 卡住了怎么办：连续失败 → 看这一步的答案 ---------- */

/**
 * 同一步连续失败几次后允许直接看答案（与主进程的 ANSWER_AFTER 对齐）。
 *
 * 「卡住」和「试错」要分开：第一次跑红是正常的学习过程，答案会替掉「自己找出来」的那一下；
 * 连续三次红说明人已经不在学了，是在同一个坑里耗——这时候给答案，是接住他，不是替他做。
 */
const ANSWER_AFTER = 3

/**
 * 现在卡在哪一步。
 *
 * 有本次结果就用「当前显示步本次的红」；刷新之后没有结果，退回「推进到的那一步」——
 * 服务端记的失败计数也是记在那一步上的，两边指同一个地方。
 * 回看已经通过的旧步时它必须是 null：那一步的答案按钮不该出现在「我早做完了」的地方。
 */
const stuckStep = computed<number | null>(() => {
  if (result.value) {
    if (result.value.passed) return null
    const sg = (result.value.stages ?? []).find((s) => s.n === viewN.value && !s.ok && !s.skipped)
    return sg?.n ?? null
  }
  if (!staged.value || !level.value?.unlocked) return null
  return stages.value[currentStage.value]?.n ?? null
})

/** 这一步连续失败了几次：本次的结果优先，刷新后读服务端记住的账 */
function failsOf(n: number): number {
  const k = String(n)
  const r = result.value?.stageFails?.[k]
  if (typeof r === 'number') return r
  return level.value?.stageFails?.[k] ?? 0
}

const stuckFails = computed(() => (stuckStep.value == null ? 0 : failsOf(stuckStep.value)))
/** 这一步已经看过答案：刷新后按钮也要在，否则人得再卡三轮才看得回来 */
const stuckAnswered = computed(() => stuckStep.value != null && (level.value?.answerSteps ?? []).includes(stuckStep.value))

const answer = ref<{ step: number; code: string } | null>(null)
const answerOpen = ref(false)
const answerLoading = ref(false)

async function revealAnswer(): Promise<void> {
  const n = stuckStep.value
  if (n == null || answerLoading.value) return
  answerLoading.value = true
  try {
    // 放行判定在服务端（重新数一遍失败次数）：前端这个按钮只是个入口
    const r = await ipc.project.stepAnswer(projectId.value, levelId.value, n)
    answer.value = r
    answerOpen.value = true
    // 刷一下详情：answerSteps 变了，横幅上的「已参考过答案」要跟着变
    void refresh()
  } catch (e: unknown) {
    toast.err(e instanceof Error ? e.message : String(e))
  } finally {
    answerLoading.value = false
  }
}

/** 把答案整段填进编辑器：逐字对一遍、再跑一次测试，比读三遍有用 */
function fillAnswer(): void {
  if (!answer.value) return
  code.value = answer.value.code
  toast.ok('已填入编辑器。点「下一步」——绿了你也就知道这几行为什么对了')
}

function closeAnswer(): void {
  answerOpen.value = false
}

/** 结果的阶段分组：staged 关卡按阶段展示，老关卡退化成一条 */
const resultStages = computed(() => {
  const r = result.value
  if (!r) return []
  if (!r.stages?.length) {
    return [{ n: 0, title: '', ok: r.passed, cases: r.cases, code: null as string | null, skipped: false }]
  }
  return r.stages
})

const stageWord = (n: number) => `第 ${n} / ${stages.value.length} 步`

/**
 * 当前显示步在本次结果里的那一段。
 *
 * 结果面板只讲这一步：以前它把四步全铺开，人切到第 3 步时眼睛底下摆着第 4 步的红，
 * 读起来就像「第 3 步的红」。用户的原话是「一个步骤只展示一个步骤的信息」。
 */
const nowRun = computed(() => (result.value?.stages ?? []).find((s) => s.n === viewN.value) ?? null)
const resultStagesNow = computed(() => resultStages.value.filter((sg) => sg.n === viewN.value))
/** 这一步自己的失败检查点个数（不是整关的） */
const viewFailCount = computed(() => (nowRun.value?.cases ?? []).filter((c) => !c.ok).length)

/**
 * 本次跑测试时这一步实际跑了但没过。
 *
 * 阶段进度是「只增不减」的历史水位，所以会出现「已通过」和「本次没过」同时为真：
 * 前者说的是「我写出过能过的代码」，后者说的是「刚才这次没跑通」。
 * 两者都真实，必须分开显示——只留绿的进度条会让人以为自己的红是界面错了。
 * skipped 的不算：那是还没轮到，不是失败。
 */
function stageFailedNow(n: number): boolean {
  return (result.value?.stages ?? []).some((s) => s.n === n && !s.ok && !s.skipped)
}

/** 去掉全部空白再比：多敲一个换行不算「开始写实现了」 */
const squashWs = (s: string): string => s.replace(/\s+/g, '')

/**
 * 上一次「跑测试把进度推进到某一阶段」时，编辑器里的代码长什么样。
 *
 * 光放内存不够：刷新（F5）就没了，而人刷新的理由往往就是「页面上那条红看着别扭」，
 * 回来再点一次跑测试又红一次。所以存进 localStorage——关掉 App 再回来也还在。
 *
 * 为什么不是 sessionStorage：重启 App 后它就读不到了，之前用「服务端草稿当快照」兜底，
 * 结果人改了半句再重开，当前这份半成品被当成「推进时的代码」，真实失败被伪装成
 * 「这一步还没开始写」——比红条更误导。localStorage 记的永远是推进那一刻的代码，
 * 之后改过就对不上，不会被误判成「没动笔」。
 */
type Advance = { stageN: number; code: string; dirty?: boolean }
let lastAdvance: Advance | null = null
const advanceKey = (): string => `lf.stageStart.${projectId.value}.${levelId.value}`
function readAdvance(): Advance | null {
  // sessionStorage 是旧版本存的位置，读一下只为兼容升级前留下的快照
  for (const store of [localStorage, sessionStorage]) {
    try {
      const raw = store.getItem(advanceKey())
      const v = raw ? JSON.parse(raw) : null
      if (v && typeof v.stageN === 'number' && typeof v.code === 'string') return v
    } catch { /* 读不了就换下一个存储 */ }
  }
  return null
}
function commitAdvance(v: Advance): void {
  lastAdvance = v
  try { localStorage.setItem(advanceKey(), JSON.stringify(v)) } catch { /* 无痕模式：退回只用内存 */ }
}

/**
 * 上一步已经过了、当前这一步这次跑红——先把这个组合认出来，再决定怎么呈现。
 *
 * 只按这个组合说「你还没开始写」是不对的：人写了一半再点跑测试，也是这个组合。
 * 所以拆成三档：
 *   atStepStart —— 代码仍等于「推进到这一步时」的快照，且那份快照是干净起点 → 完全是下一步
 *   softStart   —— 代码仍等于快照，但快照本身就带着下一步的内容（手写实现通过也属此类）→
 *                  上一步确实过了，但「这一步写了没」说不准
 *   （都不是）  —— 代码跟快照对不上：人动过笔，红字就是他真正还差的地方，照常给
 * 两档都不该把「上一步已过」这个事实吞掉——用户的原话是「我明明第一关已经过了」。
 */
const stepStartBase = computed<{ passed: ProjectStage; next: ProjectStage } | null>(() => {
  const r = result.value
  if (!staged.value || !r || r.passed) return null
  const i = currentStage.value
  if (i <= 0) return null
  const passed = stages.value[i - 1]
  const next = stages.value[i]
  if (!passed || !next) return null
  // 上一步必须是真的过了；当前这步必须是本次跑红的那一步（不是历史红）
  if (!stageDone.value.has(passed.n) || !stageFailedNow(next.n)) return null
  return { passed, next }
})

/** 快照对得上（这一步之后没改过代码）：至少能确定「当前的代码是上次跑测试时的样子」 */
const atSnapshot = computed<{ passed: ProjectStage; next: ProjectStage } | null>(() => {
  const base = stepStartBase.value
  if (!base) return null
  const i = currentStage.value
  if (!lastAdvance || lastAdvance.stageN !== i) return null
  if (squashWs(code.value) !== squashWs(lastAdvance.code)) return null
  return base
})

const atStepStart = computed<{ passed: ProjectStage; next: ProjectStage } | null>(() => {
  const base = atSnapshot.value
  if (!base || lastAdvance?.dirty) return null
  return base
})

/**
 * 上一步已过、当前步红，但「这一步写了没」说不准。
 *
 * 两种情形收在这里：
 *   1) 代码与推进时的快照一致，但快照本身是脏的（上一步是手写实现通过的）；
 *   2) 根本没有快照（升级前过的、清过缓存）。
 * 它们的红字都是**下一步的验收要求**——原样摊开等于把下一步的答案先念一遍
 * （用户的原话：「不然我可以直接看到第三步的答案」）。
 * 所以默认收起红字，只留一条展开入口：真写了的人点一下，没写的人页面是干净的。
 *
 * 但「有快照、代码却对不上」不算在内：那是人确实改了代码，红字就是他真实的失败，
 * 藏起来比多一条红更糟。
 */
const softStart = computed<{ passed: ProjectStage; next: ProjectStage } | null>(() => {
  const base = stepStartBase.value
  if (!base || atStepStart.value) return null
  const snapMatchesStep = !!lastAdvance && lastAdvance.stageN === currentStage.value
  if (snapMatchesStep && !atSnapshot.value) return null
  return base
})

/** 软启动时红字默认收着，点开了才摊（只在 softStart 里有意义） */
/**
 * 这一步的失败细节此刻是否该摊开。
 *
 * 规则就一条：**没跑过测试的步，绝不摊红字**。刚推进到第 N+1 步时，红的那些
 * 是「下一步要过关得做到什么」——摊开就是把答案的验收标准先念一遍
 * （用户的原话：「不然我可以直接看到第三步的答案」）。
 * 人真写了、真跑红了，就如实摊开；判断不了（升级前过的、快照丢了）默认收着，
 * 留一个「我已经写了」的入口。
 */
/** 当前显示步有没有红：整关的 failedCount 会把别步的红算进来，这里只认这一步 */
const viewFailed = computed(() => viewFailCount.value > 0)
/**
 * 前一步（而且它确实已经通过）：软启动文案要说「第 N-1 步已经过了」。
 * 这句必须留着——用户最在意的一条是「我明明第一关已经过了」，不能因为后面红了就吞掉。
 */
const prevPassed = computed<ProjectStage | null>(() => {
  const i = currentStage.value
  if (i <= 0) return null
  const p = stages.value[i - 1]
  return p && stageDone.value.has(p.n) ? p : null
})
const failVisible = computed(() => {
  if (!viewFailed.value || atStepStart.value) return false
  if (failExpanded.value) return true
  return viewRan.value && !viewUntouched.value
})

/** 这个阶段组是不是「还没跑过」的那一步（结果面板据此收起红叉） */
const hiddenStageN = computed<number | null>(() => {
  if (!result.value || result.value.passed) return null
  if (!failVisible.value) return viewN.value || null
  if (atStepStart.value) return atStepStart.value.next.n
  if (softStart.value && !failExpanded.value) return softStart.value.next.n
  return null
})
const isPendingStage = (sg: { n: number }): boolean => hiddenStageN.value === sg.n
/** 收起那步的说法：能确定没动笔就说「还没开始写」，判断不了就不替人下结论 */
const pendingTag = computed(() => (viewUntouched.value ? '还没开始写' : '先收着'))
const pendingMeta = computed(() => (viewUntouched.value ? '待写' : '收起'))
const pendingSummary = computed(() =>
  viewUntouched.value ? '这一步还没开始写，先不用管红的' : '这一步还没跑通，先不摊开——已经写了就点开看'
)

/** 软启动时点「我已经写了」：摊开这一步的红字，并滚过去 */
const failPanelEl = ref<HTMLElement | null>(null)
async function expandFail(): Promise<void> {
  failExpanded.value = true
  await nextTick()
  failPanelEl.value?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

/* ---------- 载入 / 刷新 ---------- */

async function load() {
  // 离开路由的中间态（pid/lid 已空）不发 IPC：主进程会回「项目不存在」，而这不是错误
  if (!projectId.value || !levelId.value) {
    loading.value = false
    return
  }
  loading.value = true
  loadError.value = ''
  // 换关卡 / 重新载入：软启动时红字的展开状态不跨页保留
  failExpanded.value = false
  // 换关卡 / 重新载入：恢复「上次推进到这一步时的代码」，跨刷新用 sessionStorage 记着
  lastAdvance = readAdvance()
  try {
    const d = await ipc.project.detail(projectId.value)
    detail.value = d
    const lv = d.levels.find((l) => l.id === levelId.value)
    if (!lv) {
      loadError.value = '没有找到这一关，可能内容文件里已经删掉了。'
      return
    }
    // 确认这一关真实存在之后，才把草稿保存的目标钉住（见 writingTo 的注释）
    writingTo = { pid: projectId.value, lid: levelId.value }
    // 如果这一关其实没通关（比如在别处点了「从零重做」），本地残留的通关态不再可信
    if (!lv.done) {
      passedNow.value = false
      if (result.value?.passed) result.value = null
    }
    if (lv.unlocked) {
      /**
       * 每步快照 + 当前查看步。
       *
       * 服务端只存「一份」草稿，那是「当前这一步的镜像」；每步的独立内容在 localStorage。
       * 打开页面时站在进度所在的那一步，编辑器内容优先取该步快照，没有快照就取草稿
       * （草稿本来就是上一次写这一关时的内容）。
       */
      stepSnaps.value = readSnaps()
      const pIdx = progressStage.value
      const pN = stages.value[pIdx]?.n ?? 0
      if (pN && !snapOf(pN)) {
        /**
         * 没有快照（升级前就停在这里 / 清过缓存）：内容用草稿，但**起点取上一步的代码**。
         * 以前这里把 start 也设成草稿，于是「动没动笔」永远判成没动——
         * 人写了一半小时，界面还在说「这一步还没开始写」，红字被绿条盖住。
         */
        stepSnaps.value[String(pN)] = { code: lv.draft, start: startSeedFor(pIdx), ran: false, at: Date.now() }
        writeSnaps()
      }
      viewStage.value = pIdx
      const cur = snapOf(pN)
      code.value = cur?.code ?? lv.draft
      loadedStageSeed.value = cur?.start ?? startSeedFor(pIdx)
      loadedDraft.value = code.value
    }
    // 老状态兜底：功能升级前就通过过一步、本地没有任何快照。
    // 只在「草稿与那一步的参考代码逐字相同」时才当起点——那确实是没动过笔。
    // 早先版本拿「草稿非空」当判据，人改了半句再重开，半成品被当成「推进时的代码」，
    // 真实失败被伪装成「还没开始写」——这比甩一条红更误导。
    if (!lastAdvance && lv.unlocked) {
      const list = lv.stages ?? []
      const lastDone = [...stageDone.value].sort((a, b) => b - a)[0]
      const passedIdx = list.findIndex((s) => s.n === lastDone)
      const ref = passedIdx >= 0 ? list[passedIdx].code : null
      if (ref && lv.draft === ref && passedIdx + 1 < list.length) {
        commitAdvance({ stageN: lastDone, code: lv.draft, dirty: false })
      }
    }
  } catch (e: unknown) {
    loadError.value = e instanceof Error ? e.message : String(e)
    toast.err(`关卡加载失败：${loadError.value}`)
  } finally {
    loading.value = false
  }
}

/** 回到（KeepAlive 缓存的）页面时刷新进度；只有在本地没有未保存改动时，才跟随服务端的草稿。 */
async function refresh() {
  if (!projectId.value || !levelId.value) return
  try {
    const d = await ipc.project.detail(projectId.value)
    detail.value = d
    const lv = d.levels.find((l) => l.id === levelId.value)
    if (lv && !lv.done) {
      passedNow.value = false
      if (result.value?.passed) result.value = null
    }
    // 在别处点了「从零重做」或重置了这一关：服务端草稿已经是新的，本地也没动过 → 跟着换。
    // 每步快照一并作废：那些快照属于「上一次来做」的这关，继续留着会把旧实现带回来。
    if (lv?.unlocked && code.value === loadedDraft.value && lv.draft !== loadedDraft.value) {
      clearSnaps()
      viewStage.value = 0
      code.value = lv.draft
      loadedDraft.value = lv.draft
      loadedStageSeed.value = lv.draft
      result.value = null
    }
  } catch {
    /* 静默：前台刷新失败不该打断正在写代码的人 */
  }
}

/* ---------- 草稿自动保存 ---------- */

let saveTimer: number | null = null
const DRAFT_DEBOUNCE = 800

/**
 * 「这一页现在服务的是哪一关」的快照。
 * 离开关卡页时 route.params 已经变空，但防抖里的那次草稿保存、以及卸载前的兜底保存，
 * 仍然必须写到刚刚那一关——直接用 projectId.value 会因为拿到空串而静默失败，
 * 表现成「改完代码立刻切走，回来草稿没了」。
 */
let writingTo = { pid: '', lid: '' }

watch(code, () => {
  // 回看旧步时编辑器是只读的，不该在任何地方留下快照
  if (!level.value?.unlocked || viewingPast.value) return
  if (saveTimer !== null) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    stashCurrent()
    void persistDraft()
  }, DRAFT_DEBOUNCE)
})

async function persistDraft() {
  saveTimer = null
  // 只认 writingTo 快照，不看 level/levelId：离开路由后它们都空了，
  // 而这一次保存恰恰是「人刚敲完就切走」的那份代码，必须落库。
  const { pid, lid } = writingTo
  if (!pid || !lid) return
  if (code.value === loadedDraft.value) return
  try {
    await ipc.project.saveDraft(pid, lid, code.value)
    loadedDraft.value = code.value
  } catch {
    /* 静默：草稿保存失败不该弹窗打扰编码，代码还在编辑器里 */
  }
}

onBeforeUnmount(() => {
  if (saveTimer !== null) window.clearTimeout(saveTimer)
  if (hintFlashTimer !== null) window.clearTimeout(hintFlashTimer)
  // 防抖里那次「存快照」跟着定时器一起被取消了，这里补一次：
  // 用户敲完最后一个字符立刻切页，那一下是最容易丢的内容。
  if (!viewingPast.value) stashCurrent()
  const { pid, lid } = writingTo
  if (pid && lid && code.value !== loadedDraft.value) {
    void ipc.project.saveDraft(pid, lid, code.value).catch(() => {})
  }
})

/* ---------- 跑测试 ---------- */

async function runTests() {
  if (!level.value || !level.value.unlocked || running.value) return
  if (viewingPast.value) {
    // 回看旧步时编辑器是只读的，跑它没有意义：只会把「当时那份代码」当成最新进度提交一次
    toast.ok(`这是第 ${viewN.value} 步的快照。要接着写，点顶部第 ${progressStage.value + 1} 步`)
    return
  }
  running.value = true
  stashCurrent()
  // 跑之前的进度水位：跑完拿它算「这一次有没有往前挪一步」
  const doneBefore = new Set(stageDone.value)
  try {
    // 第四个参数是「这一步开始时的代码」：主进程用它判断这次红算不算一次失败
    // 第五个是我此刻站在第几步：串行判定会把后面的步也跑红，那些不算这一步的失败
    const r = await ipc.project.run(projectId.value, levelId.value, code.value, viewStartCode.value || undefined, viewN.value)
    result.value = r
    // 这次真的跑过的步才算「跑过测试」；skipped 是还没轮到，不是失败
    for (const s of r.stages ?? []) {
      if (s.skipped) continue
      const cur = snapOf(s.n)
      if (cur) stepSnaps.value[String(s.n)] = { ...cur, ran: true, at: Date.now() }
    }
    const n = viewN.value
    if (n) {
      const cur = snapOf(n)
      stepSnaps.value[String(n)] = {
        code: code.value,
        start: cur?.start ?? loadedStageSeed.value ?? code.value,
        ran: true, at: Date.now()
      }
    }
    writeSnaps()
    if (r.passed) {
      passedNow.value = true
      // 整关过了：这一步的答案面板和展开状态一起收掉，它们只对着「还没过的那一步」有意义
      answer.value = null
      answerOpen.value = false
      failExpanded.value = false
      if (r.firstPass) void game.syncAfterSettle()
    } else if (r.stages?.length) {
      const advanced = r.stageDone.some((x) => !doneBefore.has(x))
      /**
       * 记下「推进到当前这步时编辑器里的样子」，供 atStepStart 判断人到底动没动笔。
       *
       * 只在「代码正好停在本步完成态」时才记：一次跑测试可能同时跨过一步、又在一个
       * 更靠后的步上失败（比如从骨架一次写到第 2 步）。那种代码里已经有了下一步的内容，
       * 若把它当成「推进时的起点」，界面会说「下一步还没开始写」——真实失败被绿条盖住，
       * 正是上一轮修掉的那类误导。
       */
      if (advanced) {
        const passedN = [...r.stageDone].filter((x) => !doneBefore.has(x)).sort((a, b) => b - a)[0]
        const ref = stages.value.find((s) => s.n === passedN)
        const refCode = ref ? stageCode(ref) : null
        /**
         * 两种都算「停在这一步、还没写下一步」：
         * 1) 代码逐字等于刚通过那步的参考代码 —— 最干净的情形；
         * 2) 刚卡住的那一步一个检查点都没通过 —— 说明下一步的内容一句都没写出来，
         *    哪怕实现是用户自己写的（与参考代码不同），也确实还没动笔。
         * 反例是从骨架一次写到第 2 步：第 1 步过了、第 2 步已过 3 个检查点，
         * 这时再把当前代码当成「第 2 步的起点」，红字就会被绿条盖住。
         */
        const stuckRun = (r.stages ?? []).find((s) => !s.ok && !s.skipped)
        const stuckPassed = stuckRun ? stuckRun.cases.filter((c) => c.ok).length : 0
        const atFinish = !!refCode && squashWs(code.value) === squashWs(refCode)
        const dirty = !(atFinish || stuckPassed === 0)
        commitAdvance({ stageN: r.stageIndex, code: code.value, dirty })
      }
    }
    /**
     * 往前推进了就自动站到新的一步上——这一步做的事和「跑完测试」是一回事：
     * 人点的按钮现在叫「下一步」。旧步的红字、答案、展开状态一律不跟过来。
     */
    const target = r.passed ? stages.value.length - 1 : Math.min(r.stageIndex, stages.value.length - 1)
    followProgress(target)
    /**
     * 推进到的那一步这次也真的跑过了——它就是这次卡住的那一步。
     * 必须在这里补记 ran：runTests 开头只标记了「跑之前站着的那一步」，
     * 新站上去的这一步还没有快照，不补记的话它的红字要等人再点一次才摊开，
     * 真实失败就被「还没开始写」的绿条盖住了。
     */
    const nNow = viewN.value
    if (nNow) {
      const cur = snapOf(nNow)
      stepSnaps.value[String(nNow)] = {
        code: code.value,
        start: cur?.start ?? loadedStageSeed.value ?? code.value,
        ran: true,
        at: Date.now()
      }
      writeSnaps()
    }
    void refresh()
  } catch (e: unknown) {
    toast.err(e instanceof Error ? e.message : String(e))
  } finally {
    running.value = false
  }
}

/* ---------- 其它操作 ---------- */

function backToBoard() {
  void router.push(`/projects/${projectId.value}`)
}

function goNext() {
  if (!nextLevelId.value) return
  void router.push(`/projects/${projectId.value}/${nextLevelId.value}`)
}

function jumpToTodo(todo: string) {
  editorRef.value?.focusTodo(todo)
}

/**
 * 展开「先懂这些」并滚到它。
 *
 * 这里刻意直接操作 DOM 而不绑定 open 状态：别的折叠项都不受控，
 * 只给这一个加 :open 会让「用户自己点开」和「Vue 的绑定值」打架。
 */
function openPrereq() {
  const d = document.querySelector('.prereq-fold')
  if (d instanceof HTMLDetailsElement) {
    d.open = true
    d.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

/**
 * 退回本关：只撤掉「通关」标记，代码、草稿、阶段进度、已发 XP 全部保留。
 *
 * 加这个的不是为了「重做」（那是重置代码 + resetLevel），而是为了「通关这件事不作数了」：
 * 典型场景是通关其实是自动化测试跑出来的、或者想把它退回去自己再走一遍。
 * 之所以要能自己撤，是因为「已通关」会影响下一关的解锁与地图上的绿点——
 * 一旦它错了，用户除了删库没有别的办法。
 */
async function revertPass() {
  if (!level.value || running.value) return
  dialog.warning({
    title: '退回未通关？',
    content: '「已通关」标记会撤掉，下一关会重新上锁。你写的代码、草稿、阶段进度都保留，已发的 XP 也不回收。',
    positiveText: '退回',
    negativeText: '取消',
    onPositiveClick: async () => {
      running.value = true
      try {
        await ipc.project.revertLevel(projectId.value, levelId.value)
        passedNow.value = false
        result.value = null
        await load()
        toast.ok('已退回未通关状态')
        void game.syncAfterSettle()
      } catch (e: unknown) {
        toast.err(e instanceof Error ? e.message : String(e))
      } finally {
        running.value = false
      }
    }
  })
}

/**
 * 从零重做这一关：代码回骨架 + 步骤回第 1 步 + 撤掉通关标记 + 尝试次数归零。
 *
 * 之前的「重置」只把编辑器换成骨架（前端一个赋值），进度一行都没动：
 * 用户点了重置，页面上还写着「第 2/4 步 · 已过 1 步」——他要的是重来一遍，
 * 拿到的只是代码被清空。现在走 resetLevel，服务端把 draft/stage/done/attempts 一起清掉，
 * 再重新拉一次详情，界面上的步骤会跟着退回去。
 * 已发 XP 不回收：奖励是「做到过」的凭证，重做不该倒扣。
 */
function redoLevel() {
  if (!level.value || running.value) return
  const isStaged = staged.value
  dialog.warning({
    title: isStaged ? '从第 1 步重做这一关？' : '重做这一关？',
    content: isStaged
      ? '编辑器换回起始骨架，四个步骤全部退回「待开始」，通关标记撤掉（下一关会重新上锁），尝试次数归零。已经发的 XP 不回收。'
      : '编辑器换回起始骨架，通关标记撤掉（下一关会重新上锁），尝试次数归零。已经发的 XP 不回收。',
    positiveText: '从零重做',
    negativeText: '取消',
    onPositiveClick: async () => {
      running.value = true
      try {
        // 先把在途的防抖保存掐掉，并把「已保存基线」对齐到骨架：
        // 否则 resetLevel 之后那次 800ms 的保存会把旧代码又写回草稿，
        // 重做完编辑器里还留着上一次的实现。
        if (saveTimer !== null) {
          window.clearTimeout(saveTimer)
          saveTimer = null
        }
        const skeleton = level.value?.skeleton ?? ''
        loadedDraft.value = skeleton
        code.value = skeleton
        // 每步快照属于「上一次来做」的那一关：从零重做就该连它们一起清，
        // 否则 load() 会把旧的第 3 步实现读回来，人以为自己回到第 1 步了，代码却是旧的。
        clearSnaps()
        viewStage.value = 0
        loadedStageSeed.value = skeleton
        await ipc.project.resetLevel(projectId.value, levelId.value)
        result.value = null
        passedNow.value = false
        await load()
        toast.ok(isStaged ? '已回到第 1 步' : '已重置为起始骨架')
        void game.syncAfterSettle()
      } catch (e: unknown) {
        toast.err(e instanceof Error ? e.message : String(e))
      } finally {
        running.value = false
      }
    }
  })
}

/* ---------- 换关卡 ---------- */

/**
 * 从「下一关」或关卡地图跳过来时，路由换了但组件实例是同一个。
 * 不在这里清一次，上一关的 result（阶段进度、红的用例、参考答案）会整个串到新关卡上：
 * 表现为刚进第 2 关就显示「已过 3 步」，而那 3 步是第 1 关的。
 */
watch([projectId, levelId], async ([pid, lid], [oldPid, oldLid]) => {
  if (pid === oldPid && lid === oldLid) return
  // 离开关卡页（回地图/列表/首页）时路由参数会变空：那一次不是「换关卡」，
  // 不该再去拉详情——之前没有这道守卫，每退一次就抖出一条「项目不存在」的红条，
  // 而用户其实什么都没点错。
  if (!pid || !lid) return
  result.value = null
  passedNow.value = false
  answer.value = null
  answerOpen.value = false
  failExpanded.value = false
  // 换关卡：上一关的每步快照绝不能跟过来（内容、骨架都不一样）
  clearSnaps()
  viewStage.value = 0
  await load()
})

onMounted(async () => {
  await load()
  ready.value = true
})

onActivated(() => {
  if (ready.value) void refresh()
})
</script>

<template>
  <div class="level-page">
    <div v-if="loading" class="center-wrap">
      <div class="card sk-card">
        <div class="skeleton sk-line" style="width:36%" />
        <div class="skeleton sk-line" style="width:82%;margin-top:12px" />
        <div class="skeleton sk-block" style="margin-top:16px;height:220px" />
      </div>
    </div>

    <div v-else-if="loadError || !level" class="center-wrap">
      <div class="empty card">
        <span class="ic"><Icon name="alert" :size="26" /></span>
        <span class="t">这一关打不开</span>
        <span class="d">{{ loadError || '关卡不存在，可能内容文件已经更新。' }}</span>
        <span class="cta">
          <button class="btn" @click="load"><Icon name="refresh" :size="14" /> 重试</button>
          <button class="btn ghost" @click="backToBoard"><Icon name="arrowLeft" :size="14" /> 回关卡地图</button>
        </span>
      </div>
    </div>

    <!-- 未解锁：不渲染编辑器，避免用户在一个跑不起来的页面里白写代码 -->
    <div v-else-if="!level.unlocked" class="center-wrap">
      <div class="empty card gate">
        <span class="ic"><Icon name="lock" :size="26" /></span>
        <span class="t">这一关还没解锁</span>
        <span class="d">上一关还没通关。先把第 {{ level.index }} 关做完，这里会自动打开。</span>
        <span class="cta">
          <button class="btn primary" @click="backToBoard"><Icon name="arrowLeft" :size="14" /> 回关卡地图</button>
        </span>
      </div>
    </div>

    <template v-else>
      <!-- ================= 左栏：先读，再写 ================= -->
      <aside class="task-pane">
        <button class="back-link" @click="backToBoard">
          <Icon name="arrowLeft" :size="14" /> 关卡地图
        </button>

        <header class="lv-head">
          <div class="row lv-tags">
            <span class="pill info">第 {{ level.index + 1 }}/{{ levelCount }} 关</span>
            <span class="pill purple"><Icon name="zap" :size="11" /> {{ level.xp }} XP</span>
            <span v-if="isDone" class="pill ok"><Icon name="check" :size="11" /> 已通关</span>
            <button v-if="isDone" class="pill-btn" :disabled="running" @click="revertPass">
              <Icon name="refresh" :size="11" /> 退回未通关
            </button>
          </div>
          <h1 class="lv-name"><span class="lv-emoji" aria-hidden="true">{{ level.emoji }}</span>{{ level.title }}</h1>
          <div v-if="level.attempts" class="micro faint">已尝试 {{ level.attempts }} 次 · 改了代码会边打边存</div>
        </header>

<!-- ============ 首屏只回答一个问题：现在这一步做什么 ============ -->
        <!-- 之前一进来就铺开「目标 / 为什么 / 6 条思维链 / 4 张前置知识卡 / API 契约」，
             人在第 1 步要面对几千字，等于没有引导。现在首屏只有当前步，背景资料全部折叠。 -->
        <section v-if="staged && nowStage" class="now-step">
          <div class="now-head">
            <span class="now-chip">第 {{ currentStage + 1 }} / {{ stages.length }} 步</span>
            <span class="grow" />
            <span v-if="viewingPast" class="stage-flag ok"><Icon name="check" :size="11" /> 已完成 · 只读回看</span>
            <span v-else-if="stageDone.has(nowStage.n)" class="stage-flag ok"><Icon name="check" :size="11" /> 已通过</span>
            <span v-else class="stage-flag now">正在做</span>
          </div>
          <h2 class="now-title">{{ nowStage.title }}</h2>
          <!-- 回看旧步是「对照」不是「重做」：改旧步等于偷偷改掉后面几步的地基，
               所以这里只读，并给一条回到当前进度的路。 -->
          <p v-if="viewingPast" class="now-past">
            <template v-if="viewSnapMissing">
              这一步是在这一版之前通过的，当时写的代码没有留在本机——下面显示的是「这一步完成后的参考代码」，只读。
            </template>
            <template v-else>
              这是你第 {{ nowStage.n }} 步留下来的快照，只读——后面的步骤都建立在它上面。
            </template>
            <button type="button" class="now-back" @click="enterStage(progressStage)">
              回到第 {{ progressStage + 1 }} 步接着写
            </button>
          </p>
          <p class="now-hint" :class="{ flash: hintFlash }" ref="nowHintEl"><Icon name="arrowRight" :size="13" /> {{ nowStage.hint }}</p>
          <!-- hint 里常写「看左栏那条知识卡」——那些卡现在收在折叠区里，得给个直达口，
               否则「一步一步引导」会断在「可是东西在哪」。 -->
          <button v-if="level.prereq.length" type="button" class="now-jump" @click="openPrereq">
            <Icon name="layers" :size="12" /> 这一步要靠的前置知识（{{ level.prereq.length }} 条）
          </button>

          <details class="acc now-acc">
            <summary>为什么这一步要这么做</summary>
            <div class="acc-body"><div class="md stage-think-md" v-html="renderMd(nowStage.think)" /></div>
          </details>

          <details v-if="nowStage.vocab.length" class="acc now-acc">
            <summary>这一步要用的词（{{ nowStage.vocab.length }}）</summary>
            <div class="acc-body now-vocab-body">
              <div v-for="(v, k) in nowStage.vocab" :key="k" class="now-vocab-item">
                <h5>{{ v.term }}</h5>
                <div class="md vocab-md" v-html="renderMd(v.md)" />
              </div>
            </div>
          </details>

          <details v-if="stageCode(nowStage)" class="acc now-acc">
            <summary>这一步写完的完整代码（对照自己少想了什么）</summary>
            <div class="acc-body"><pre class="snippet"><code v-html="stageCodeHtml(nowStage)" /></pre></div>
          </details>
        </section>

        <!-- 步骤总览不再单独铺一遍：每一步的 think/hint/vocab/代码只出现在「当前那一步」的卡片里。
             以前 it 全在下面又列一份，页面同时摆着两份同样的话，人分不清现在该看哪一份。
             要切换步骤，用编辑器上方那条步骤条。 -->

        <!-- 老式关卡（没有 stages）没有「当前步」卡片，任务陈述必须摆在最前面 -->
        <section v-if="!staged" class="goal">
          <div class="goal-cap"><Icon name="target" :size="13" /> 这一关要做到</div>
          <p>{{ level.goal }}</p>
        </section>

        <!-- 老关卡（没有 stages）：每步对应骨架里的一个 TODO，点「定位」跳过去 -->
        <section v-if="level.steps.length && !staged" class="blk steps">
          <div class="section-title">
            <Icon name="pen" :size="13" /> 动手：{{ level.steps.length }} 步
            <span class="title-hint">点「定位」跳到代码里的对应位置</span>
          </div>
          <article v-for="(s, i) in level.steps" :key="s.todo" class="step">
            <div class="step-head">
              <span class="step-n">{{ i + 1 }}</span>
              <span class="step-todo">{{ s.todo }}</span>
              <button type="button" class="step-jump" @click="jumpToTodo(s.todo)">
                定位 <Icon name="arrowRight" :size="12" />
              </button>
            </div>
            <h5 class="step-title">{{ s.title }}</h5>
            <p class="step-how">{{ s.how }}</p>
            <pre v-if="s.code" class="snippet"><code v-html="codeHtml(s.code)" /></pre>
          </article>
        </section>

        <!-- 背景资料：默认收起，想读再点开。老关卡另有置顶的任务陈述，这里只放 why / 思维链 / 前置知识 / API。 -->
        <section class="fold-info">
          <details v-if="staged" class="acc info-acc">
            <summary><Icon name="target" :size="13" /> 这一关要做到什么</summary>
            <div class="acc-body"><p class="goal-p">{{ level.goal }}</p></div>
          </details>

          <details v-if="level.why" class="acc info-acc">
            <summary><Icon name="book" :size="13" /> 为什么要做这一关</summary>
            <div class="acc-body"><div class="md why-md" v-html="renderMd(level.why)" /></div>
          </details>

          <!-- 思维链：我做这个功能时真实的判断顺序。不是知识点，是「为什么先做这步」。 -->
          <details v-if="thinking.length" class="acc info-acc">
            <summary><Icon name="sparkles" :size="13" /> 我会怎么想这件事（{{ thinking.length }} 条）</summary>
            <div class="acc-body">
              <div class="mind-cap micro faint">下面不是知识点，是我动手前和动手时的判断顺序——为什么先做这一步、为什么排除另一种写法。</div>
              <article v-for="(t, i) in thinking" :key="i" class="thought">
                <h5 class="thought-h"><span class="thought-n">{{ i + 1 }}</span>{{ t.title }}</h5>
                <div class="md thought-md" v-html="renderMd(t.md)" />
              </article>
            </div>
          </details>

          <!-- 前置知识：不写的人往往卡在这里，所以放在一步之外、随时能翻。 -->
          <details v-if="level.prereq.length" class="acc info-acc prereq-fold">
            <summary><Icon name="layers" :size="13" /> 先懂这些，才写得动（{{ level.prereq.length }}）</summary>
            <div class="acc-body">
              <article v-for="(p, i) in level.prereq" :key="i" class="lesson flat">
                <h4 class="lesson-h"><span class="lesson-n">{{ i + 1 }}</span>{{ p.title }}</h4>
                <div class="md lesson-md" v-html="renderMd(p.md)" />
              </article>
            </div>
          </details>

          <!-- API 契约：函数名、参数、返回值、调用示例。只写「写一个 reactive」不够。 -->
          <details v-if="level.api.length" class="acc info-acc">
            <summary><Icon name="code" :size="13" /> 你要交付的东西长这样</summary>
            <div class="acc-body">
              <article v-for="a in level.api" :key="a.name" class="api card flat">
                <div class="api-head"><span class="api-name">{{ a.name }}</span></div>
                <pre class="snippet api-sig"><code v-html="codeHtml(a.sig)" /></pre>
                <dl class="api-dl">
                  <dt>参数</dt><dd>{{ a.args }}</dd>
                  <dt>返回</dt><dd>{{ a.returns }}</dd>
                </dl>
                <div class="api-example">
                  <span class="micro faint">调用起来是这样：</span>
                  <pre class="snippet"><code v-html="codeHtml(a.example)" /></pre>
                </div>
              </article>
            </div>
          </details>
        </section>

        <!-- 兼容旧版内容（没有 steps 的关卡只有一段 task） -->
        <section v-if="!level.steps.length && level.task" class="blk">
          <div class="section-title"><Icon name="pen" :size="13" /> 具体步骤</div>
          <div class="md task-md" v-html="renderMd(level.task)" />
        </section>

        <section v-if="level.hints.length" class="blk hints">
          <button type="button" class="hint-toggle" :aria-expanded="hintsOpen" @click="hintsOpen = !hintsOpen">
            <Icon name="sparkles" :size="14" />
            <span>还是卡住了？看提示（{{ level.hints.length }} 条）</span>
            <Icon name="chevronDown" :size="14" class="hint-caret" :class="{ open: hintsOpen }" />
          </button>
          <div v-if="hintsOpen" class="hint-list">
            <details v-for="(h, i) in level.hints" :key="i" class="acc hint-item">
              <summary>提示 {{ i + 1 }}</summary>
              <div class="acc-body hint-text">{{ h }}</div>
            </details>
          </div>
        </section>

        <!-- 复盘：通关后才出现，这时候它是「回顾」而不是「前置知识」 -->
        <section v-if="isDone && level.concepts.length" class="blk concepts">
          <div class="section-title"><Icon name="layers" :size="13" /> 做完再回头看：你刚学到的东西</div>
          <article v-for="c in level.concepts" :key="c.title" class="concept card flat">
            <h4>{{ c.title }}</h4>
            <div class="md concept-md" v-html="renderMd(c.md)" />
          </article>
        </section>
      </aside>

      <!-- ================= 右栏：编辑器 + 结果 ================= -->
      <section class="work-pane">
        <!-- 步骤条：一眼看清走到第几步，点一下就切到那一步的代码快照。
             「一个步骤只展示一个步骤的信息」靠它成立——左栏不再把每步的
             think/hint/vocab 全列一遍，切换的唯一入口就是这里。 -->
        <div v-if="staged" class="stage-switch" role="tablist" aria-label="步骤">
          <button
            v-for="(s, i) in stages" :key="s.n" type="button" class="stage-tab" role="tab"
            :aria-selected="i === currentStage"
            :class="{
              done: stageDone.has(s.n) && i !== currentStage,
              now: i === currentStage,
              past: i < currentStage,
              /* 红只红在「这一步真写了、也没通过」的时候。刚推进上来、一步没动的红字还没摊开
                 （结果面板正在说「先不用管红的」），顶部却给一颗红药丸，两处就自相矛盾。 */
              fail: i === currentStage && failVisible
            }"
            :disabled="running || (i > progressStage && !stageDone.has(s.n))"
            :title="
              i === currentStage
                ? `第 ${s.n} 步（正在做）`
                : stageDone.has(s.n)
                  ? `第 ${s.n} 步已通过，点开回看你当时的代码`
                  : i > progressStage
                    ? '还没推进到这一步'
                    : `第 ${s.n} 步`
            "
            @click="enterStage(i)"
          >
            <span class="stage-tab-n">{{ s.n }}</span>
            <span class="stage-tab-t">{{ s.title }}</span>
            <Icon v-if="stageDone.has(s.n) && i !== currentStage" name="check" :size="10" class="stage-tab-ok" />
          </button>
        </div>

        <div class="work-toolbar">
          <span class="file-chip"><Icon name="pen" :size="13" /> level.js</span>
          <span v-if="staged" class="todo-chip" :class="{ done: isDone || stageDone.size === stages.length }">
            <Icon :name="isDone || stageDone.size === stages.length || viewingPast ? 'check' : 'pen'" :size="11" />
            {{
              isDone
                ? `${stages.length} 步都走过 · 已通关`
                : stageDone.size === stages.length
                  ? '每一步都过了，跑一次整关'
                  : viewingPast
                    ? `正在回看第 ${currentStage + 1} 步 · 进度在第 ${progressStage + 1} 步`
                    : stageWord(currentStage + 1) + ' · 已过 ' + stageDone.size + ' 步'
            }}
          </span>
          <span v-else-if="todoTotal" class="todo-chip" :class="{ done: todoLeft === 0 }">
            <Icon :name="todoLeft === 0 ? 'check' : 'pen'" :size="11" />
            {{ todoLeft === 0 ? 'TODO 都补完了，跑一下检查' : `还剩 ${todoLeft}/${todoTotal} 个 TODO` }}
          </span>
          <span class="grow" />
          <button class="btn ghost redo-btn" :disabled="running" title="清空代码和步骤进度，从第 1 步重新开始（已发的 XP 不收回）" @click="redoLevel">
            <Icon name="refresh" :size="14" /> 从头做这关
          </button>
          <n-button type="primary" :loading="running" :disabled="running || !level.unlocked || viewingPast" @click="runTests">
            <template #icon><Icon v-if="!running" name="play" :size="14" /></template>
            {{ running ? '运行中…' : '下一步' }}
          </n-button>
          <span class="kbd-hint"><kbd class="kbd">Ctrl</kbd><kbd class="kbd">Enter</kbd></span>
        </div>

        <CodeEditor
          ref="editorRef" v-model="code" :min-height="380"
          :readonly="!canEditCode" @run="runTests"
        />

        <p v-if="viewingPast" class="work-note micro faint">
          <Icon name="lock" :size="12" /> 这是第 {{ currentStage + 1 }} 步的历史快照，只读——点上方第 {{ progressStage + 1 }} 步回到正在做的那一步。
        </p>
        <p v-else class="work-note micro faint">
          <Icon name="zap" :size="12" /> 代码在本地沙箱里执行；每一步的代码单独存一份快照，切步不会覆盖。全部检查点通过才算通关。
        </p>

        <!-- ===== 结果面板（跑完才出现） ===== -->
        <div v-if="result" class="result">
          <div v-if="result.passed" class="fb ok pass-panel">
            <h4><Icon name="check" :size="17" /> 本关通过</h4>
            <div class="row pass-meta">
              <span v-if="result.xpAwarded > 0" class="pill ok"><Icon name="zap" :size="12" /> +{{ result.xpAwarded }} XP</span>
              <span v-else class="pill lock">重做通过 · 不重复计 XP</span>
              <span class="tiny muted">{{ result.cases.length }} 个检查点全部通过</span>
            </div>
            <div v-if="result.firstPass && result.nextLevelId" class="tiny muted pass-next">
              下一关已解锁，可以继续往下推。
            </div>
            <div v-else-if="result.projectDone && result.firstPass" class="tiny muted pass-next">
              这是最后一关，这个项目已经全部做完。
            </div>
          </div>

          <!-- 本次红的是「更靠前的某一步」：人正站在第 N 步写代码，判定却停在前面。
               这句必须说出来——否则他只会看到「上一步已经过了」，然后被顶部退回去的进度搞懵。
               但这里不给人跳转：各步代码是累积的，要修的就写在当前这份代码里。 -->
          <div v-else-if="earlierFail" class="fb warn earlier-panel">
            <h4>
              <Icon name="alert" :size="17" />
              这次改动把第 {{ earlierFail.step.n }} 步「{{ earlierFail.step.title }}」弄红了
            </h4>
            <div class="tiny muted">
              判定是串行的：第 {{ earlierFail.step.n }} 步有 {{ earlierFail.cases.length }} 个检查点没过，
              就停在那里，所以第 {{ viewN }} 步这次还没轮到判。
              这不是让你退回去——<strong>要修的就是当前这份代码</strong>：第 {{ viewN }} 步是在第
              {{ earlierFail.step.n }} 步的实现上继续写的，两边的判定看的是同一份代码。
            </div>
            <ul class="earlier-cases">
              <li v-for="c in earlierFail.cases" :key="c">{{ c }}</li>
            </ul>
            <div class="tiny muted">
              先补回第 {{ earlierFail.step.n }} 步那几行（左栏切到第 {{ earlierFail.step.n }} 步能看到当时的要求），
              再点「下一步」。
            </div>
          </div>

          <!-- 当前这一步还没摊开红字（没跑过测试 / 代码还没动 / 判断不了写没写）：
               这里要说的只有「上一步过了」和「这一步还没开始」两件事，不铺检查点。
               用户的原话是「我明明第一关已经过了，应该只告诉我可以开始第二关」。 -->
          <div v-else-if="!failVisible" class="fb ok next-panel">
            <h4>
              <Icon name="check" :size="17" />
              <template v-if="prevPassed">第 {{ prevPassed.n }} 步已经过了：{{ prevPassed.title }}</template>
              <template v-else>第 {{ viewN }} 步「{{ nowStage?.title }}」还没跑过</template>
            </h4>
            <div class="tiny muted">
              <template v-if="prevPassed">
                <template v-if="viewUntouched">
                  第 {{ viewN }} 步「{{ nowStage?.title }}」还没开始写——编辑器里现在还是第 {{ prevPassed.n }} 步的代码。
                </template>
                <template v-else>
                  第 {{ viewN }} 步「{{ nowStage?.title }}」这一版代码还没跑过测试。
                </template>
              </template>
              <template v-else>编辑器里这份代码还没有真正跑过测试。</template>
              照左边的提示改，写完点上面的「下一步」。
            </div>
            <button
              v-if="viewFailCount > 0"
              type="button" class="answer-btn soft-expand" @click="expandFail"
            >
              <Icon name="arrowRight" :size="12" /> 我已经写了，看还差哪 {{ viewFailCount }} 条
            </button>
          </div>

          <!-- 只有「跑到了检查点但有红的」才需要这条横幅；一进来就抛错的情况
               由下面的 err-block 统一说清，两段都写一次「代码运行出错」是重复。
               failVisible：这一步真的跑过测试、而且确实动过笔，才摊开。 -->
          <div v-if="failVisible" ref="failPanelEl" class="fb bad fail-panel">
            <h4>
              <Icon name="alert" :size="17" />
              <template v-if="failedStage">第 {{ failedStage.n }} 步「{{ failedStage.title }}」还有 {{ viewFailCount }} 处没做到</template>
              <template v-else>还有 {{ viewFailCount }} 个检查点没做到</template>
            </h4>
            <div class="tiny muted">
              下面每条红字说的是「这一步该做到什么」，不是「你哪里写错了」——
              先只盯第一条红的，别一次改好几处。改完点上面的「下一步」。
            </div>
            <!-- 红字是「验收标准」，提示是「怎么做」。两样分处两栏时，人会盯着红字发呆。
                 这里把这一步的提示抄过来，并给一个回左栏的入口。 -->
            <div v-if="failedStage" class="fail-hint">
              <div class="fail-hint-cap"><Icon name="arrowRight" :size="12" /> 这一步要做的</div>
              <p class="fail-hint-txt">{{ failedStage.hint }}</p>
              <button type="button" class="fail-hint-jump" @click="focusHint">
                <Icon name="search" :size="12" /> 看左栏的完整提示与用词
              </button>
            </div>
            <!-- 连错三次的兜底：不再是「提示」，而是这一步的正确写法。
                 只放这一步的代码，后面几步一行都不在里面（构建期有自检）。 -->
            <div v-if="failedStage" class="answer-foot">
              <button
                v-if="stuckFails >= ANSWER_AFTER || stuckAnswered"
                type="button" class="answer-btn" :disabled="answerLoading" @click="revealAnswer"
              >
                <Icon name="sparkles" :size="13" />
                {{ stuckAnswered ? '再看一次这一步的答案' : '卡了 3 次了，直接看这一步的答案' }}
              </button>
              <span v-else class="tiny faint">
                同一步连续错满 {{ ANSWER_AFTER }} 次，就会直接给出这一步的正确写法（只给这一步，后面几步不给）。
                现在已错 {{ stuckFails }}/{{ ANSWER_AFTER }} 次。
              </span>
              <span v-if="stuckAnswered" class="tiny faint">· 已参考过答案（不扣 XP，只是记下来）</span>
            </div>
          </div>

          <!-- 答案面板：只对「当前这一步」出现。
               三个条件缺一不可：面板是开着的、这一步确实有答案、并且答案就是这一步的——
               少了最后一条，第 3 步的答案会跟着人漂到第 4 步去（用户截图里的那个 bug）。 -->
          <div v-if="answerOpen && answer && answer.step === viewN && failVisible" class="fb answer-panel">
            <h4>
              <Icon name="code" :size="16" /> 第 {{ answer.step }} 步的正确写法
            </h4>
            <div class="tiny muted">
              这是一份「到这一步为止」的完整代码：前面几步的代码都在里面，后面几步一行都没有。
              填进编辑器之后，检查点还是得自己跑通才算通过。
            </div>
            <pre class="snippet answer-code"><code v-html="codeHtml(answer.code)" /></pre>
            <div class="row answer-acts">
              <button type="button" class="btn" @click="fillAnswer"><Icon name="pen" :size="12" /> 填进编辑器</button>
              <button type="button" class="btn ghost" @click="closeAnswer">先不看，我再改改</button>
            </div>
          </div>

          <!-- 这次跑的结果：只展示「当前这一步」，别的步不铺开。
               要回看别步的检查点，点上面的步骤条切过去。 -->
          <div v-if="staged" class="stage-results">
            <div
              v-for="(sg, si) in resultStagesNow" :key="si" class="stage-result"
              :class="{ bad: !sg.ok && !sg.skipped && !isPendingStage(sg), skipped: sg.skipped, pending: isPendingStage(sg) }"
            >
              <div class="stage-result-head">
                <span
                  class="stage-result-ic"
                  :class="isPendingStage(sg) ? 'pending' : sg.ok ? 'ok' : sg.skipped ? 'skip' : 'bad'"
                >
                  <Icon :name="isPendingStage(sg) ? 'pen' : sg.ok ? 'check' : sg.skipped ? 'clock' : 'close'" :size="13" />
                </span>
                <span class="stage-result-title">
                  {{ sg.n ? '第 ' + sg.n + ' 步 · ' + sg.title : '检查点' }}
                  <span v-if="isPendingStage(sg)" class="stage-result-tag">{{ pendingTag }}</span>
                </span>
                <span class="grow" />
                <span class="stage-result-meta micro faint">
                  {{ sg.skipped ? '未运行' : isPendingStage(sg) ? pendingMeta : sg.cases.filter((c) => c.ok).length + '/' + sg.cases.length }}
                </span>
              </div>
              <!-- 待写的那步：检查点仍在，但收起来。人还没动笔时铺一排红叉只会让他以为自己做错了 -->
              <details v-if="isPendingStage(sg) && !sg.skipped" class="pending-cases">
                <summary>{{ sg.cases.length }} 个检查点（{{ pendingSummary }}）</summary>
                <div class="cases">
                  <div v-for="(c, i) in sg.cases" :key="i" class="case" :class="c.ok ? 'ok' : 'bad'">
                    <span class="case-ic"><Icon :name="c.ok ? 'check' : 'close'" :size="13" /></span>
                    <span class="case-name">{{ c.name }}</span>
                    <span v-if="!c.ok && c.message" class="case-msg">{{ c.message }}</span>
                  </div>
                </div>
              </details>
              <div v-else-if="!sg.skipped" class="cases">
                <div v-for="(c, i) in sg.cases" :key="i" class="case" :class="c.ok ? 'ok' : 'bad'">
                  <span class="case-ic"><Icon :name="c.ok ? 'check' : 'close'" :size="13" /></span>
                  <span class="case-name">{{ c.name }}</span>
                  <span v-if="!c.ok && c.message" class="case-msg">{{ c.message }}</span>
                  <!-- 光有「期望/实际」人看不出来要改什么；这行把「最可能少写了什么」说出来 -->
                  <p v-if="!c.ok && c.diag" class="case-diag">
                    <Icon name="alert" :size="11" /><span>{{ c.diag }}</span>
                  </p>
                </div>
              </div>
            </div>
            <div v-if="!resultStagesNow.length && !result.error" class="micro faint">
              这一次还没跑到第 {{ viewN }} 步——它排在前面还没过的步之后。
            </div>
          </div>

          <div v-else class="cases">
            <div
              v-for="(c, i) in result.cases" :key="i"
              class="case" :class="c.ok ? 'ok' : 'bad'"
            >
              <span class="case-ic"><Icon :name="c.ok ? 'check' : 'close'" :size="13" /></span>
              <span class="case-name">{{ c.name }}</span>
              <span v-if="!c.ok && c.message" class="case-msg">{{ c.message }}</span>
              <p v-if="!c.ok && c.diag" class="case-diag">
                <Icon name="alert" :size="11" /><span>{{ c.diag }}</span>
              </p>
            </div>
            <div v-if="!result.cases.length && !result.error" class="micro faint">本次没有跑到任何检查点。</div>
          </div>

          <div v-if="result.error" class="err-block">
            <div class="err-head"><Icon name="alert" :size="15" /> 代码运行出错</div>
            <pre class="err-msg">{{ result.error.message }}</pre>
            <details v-if="result.error.stack" class="err-stack">
              <summary class="micro">查看调用栈</summary>
              <pre>{{ result.error.stack }}</pre>
            </details>
          </div>

          <details v-if="result.logs.length" class="acc logs">
            <summary><Icon name="book" :size="14" /> console 输出（{{ result.logs.length }} 条）</summary>
            <div class="acc-body log-body">
              <div v-for="(l, i) in result.logs" :key="i" class="log-line">
                <span class="log-lv">{{ l.level }}</span>
                <span class="log-txt">{{ l.text }}</span>
              </div>
            </div>
          </details>

          <div class="run-meta micro faint">
            <Icon name="clock" :size="12" /> 用时 {{ result.ms }} ms · 第 {{ result.attempts }} 次运行
          </div>
        </div>

        <!-- ===== 通关后：完整代码 + 怎么调用（用户明确要看「所有代码」和用法） ===== -->
        <details v-if="isDone && level.finalCode" class="acc final-code" open>
          <summary>
            <Icon name="code" :size="15" />
            <span>这一关写完的完整代码</span>
            <span class="grow" />
            <span class="micro faint">{{ stages.length }} 个阶段合起来的样子</span>
          </summary>
          <div class="acc-body">
            <CodeEditor :model-value="level.finalCode" readonly :min-height="320" />
          </div>
        </details>

        <details v-if="isDone && level.usage" class="acc usage">
          <summary>
            <Icon name="play" :size="15" />
            <span>怎么调用它</span>
            <span class="grow" />
            <span class="micro faint">能跑起来，和会用，是两件事</span>
          </summary>
          <div class="acc-body">
            <CodeEditor :model-value="level.usage" readonly :min-height="260" />
          </div>
        </details>

        <!-- ===== 参考答案：只有通关后才出现 ===== -->
        <details v-if="isDone && solution" class="acc solution">
          <summary>
            <Icon name="book" :size="15" />
            <span>参考答案</span>
            <span class="grow" />
            <span class="micro faint">先自己写完再看，对照着找自己少想了哪一步</span>
          </summary>
          <div class="acc-body">
            <CodeEditor :model-value="solution" readonly :min-height="240" />
          </div>
        </details>

        <div class="work-foot">
          <button class="btn ghost" @click="backToBoard"><Icon name="arrowLeft" :size="14" /> 回关卡地图</button>
          <span class="grow" />
          <span v-if="result?.projectDone" class="pill ok"><Icon name="trophy" :size="12" /> 这个项目已完成</span>
          <n-button v-if="result?.passed && nextLevelId" type="primary" @click="goNext">
            下一关 <Icon name="arrowRight" :size="15" />
          </n-button>
        </div>
      </section>
    </template>

    <!-- 通关瞬间的 XP/升级/徽章事件由这里统一弹窗（与练习/考试同一套庆祝层） -->
    <CelebrationModal />
  </div>
</template>

<style scoped>
/* 两栏铺满整个视口高度：左栏独立滚动，右栏自己滚，互不带着对方跑。
   左栏放宽到 480-560：前置知识里有代码块，360 宽会逼着人横向滚动读代码。 */
.level-page {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(480px, 560px) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  overflow: hidden;
  background: var(--bg);
}
.center-wrap { grid-column: 1 / -1; display: grid; place-items: center; align-content: center; padding: var(--sp-8) var(--sp-5) }
.center-wrap .card { width: min(560px, 100%) }
.sk-card { display: block }
.gate .ic { color: var(--text-faint); opacity: 1 }

/* ---------- 左栏 ---------- */
.task-pane {
  overflow-y: auto;
  padding: var(--sp-5) var(--sp-5) var(--sp-10);
  border-right: 1px solid var(--border);
  background: var(--surface);
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}
.back-link {
  align-self: flex-start;
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 8px; margin-left: -8px;
  border: 1px solid transparent; border-radius: var(--r-sm);
  background: transparent; color: var(--text-dim);
  font: inherit; font-size: var(--fs-sm); cursor: pointer;
  transition: color var(--dur-fast), background-color var(--dur-fast);
}
.back-link:hover { color: var(--accent-2); background: var(--surface-2) }
.back-link:focus-visible { box-shadow: var(--ring) }

.lv-head { display: grid; gap: 8px }
.lv-tags { gap: 6px }
.lv-name { margin: 0; font-size: var(--fs-lg); line-height: 1.35; letter-spacing: -.01em; display: flex; align-items: flex-start; gap: 7px }
.lv-emoji { font-size: 19px; line-height: 1.35; flex: 0 0 auto }

.goal {
  padding: var(--sp-4);
  border: 1px solid color-mix(in oklab, var(--accent) 26%, var(--border));
  border-left: 3px solid var(--accent);
  border-radius: var(--r-md);
  background: color-mix(in oklab, var(--accent) 6%, var(--surface));
}
.goal-cap {
  display: flex; align-items: center; gap: 5px;
  color: var(--accent-2); font-size: var(--fs-xs); font-weight: 650;
  letter-spacing: .04em; text-transform: uppercase; margin-bottom: 6px;
}
.goal p { margin: 0; font-size: var(--fs-base); line-height: 1.75; font-weight: 550 }

.blk { display: block }
/* 左栏是 flex 列：不显式 min-width:0 的话，里面带代码块的讲解会把整栏撑宽，
   结果代码在栏边被裁掉（第一版就踩了这个）。 */
.task-pane > * { min-width: 0 }
.lesson { min-width: 0 }
.section-title {
  display: flex; align-items: center; gap: 5px; flex-wrap: wrap;
  margin-bottom: 8px;
  color: var(--text); font-size: var(--fs-sm); font-weight: 650;
}
.section-title .title-hint { color: var(--text-faint); font-weight: 450; font-size: var(--fs-xs) }
.why-md { font-size: var(--fs-sm); line-height: 1.8; color: var(--text-dim) }
.why-md :deep(p:first-child) { margin-top: 0 }

/* 前置知识：这是本页最重要的区块，给它独立的左轨和更大的行距 */
.prereq { display: grid; gap: 10px; grid-template-columns: minmax(0, 1fr); }
.prereq .section-title { margin-bottom: 2px }
.lesson {
  padding: var(--sp-3) var(--sp-4);
  border: 1px solid var(--border);
  border-left: 3px solid color-mix(in oklab, var(--purple) 55%, var(--border));
  border-radius: var(--r-md);
  background: color-mix(in oklab, var(--purple) 3.5%, var(--surface));
}
.lesson-h {
  display: flex; align-items: baseline; gap: 7px;
  margin: 0 0 8px; font-size: var(--fs-base); font-weight: 650; color: var(--text);
}
.lesson-n {
  flex: 0 0 auto;
  display: inline-grid; place-items: center;
  width: 18px; height: 18px; border-radius: 50%;
  background: color-mix(in oklab, var(--purple) 16%, transparent);
  color: var(--purple); font-size: 11px; font-weight: 700;
  transform: translateY(-1px);
}
.lesson-md { font-size: var(--fs-base); line-height: 1.8; color: var(--text-dim) }
.lesson-md :deep(p) { margin: 7px 0 }
.lesson-md :deep(p:first-child) { margin-top: 0 }
.lesson-md :deep(p:last-child) { margin-bottom: 0 }
.lesson-md :deep(strong) { color: var(--text) }
.lesson-md :deep(ul), .lesson-md :deep(ol) { padding-left: 20px; margin: 7px 0 }

/* 代码块（讲解、API 示例、分步片段共用） */
.snippet {
  margin: 8px 0 0;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--surface-2);
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.65;
  overflow-x: auto;
  white-space: pre;
  max-width: 100%;
  box-sizing: border-box;
}
.snippet code { font-family: inherit; font-size: inherit; background: none; color: var(--text); padding: 0 }

/* API 契约卡 */
.api { padding: var(--sp-3) var(--sp-4); background: var(--surface-2) }

/* ---------- v3 思维链 ---------- */
.mind { display: grid; gap: 10px }
.mind-cap { margin: -4px 0 2px; line-height: 1.6 }
.thought {
  padding: var(--sp-3) var(--sp-4);
  border: 1px solid var(--border);
  border-left: 3px solid color-mix(in oklab, var(--accent) 45%, var(--border));
  border-radius: var(--r-md);
  background: color-mix(in oklab, var(--accent) 3%, var(--surface));
}
.thought-h {
  display: flex; align-items: baseline; gap: 7px;
  margin: 0 0 8px; font-size: var(--fs-base); font-weight: 650; color: var(--text);
}
.thought-n {
  flex: 0 0 auto;
  display: inline-grid; place-items: center;
  width: 18px; height: 18px; border-radius: 50%;
  background: color-mix(in oklab, var(--accent) 16%, transparent);
  color: var(--accent-2); font-size: 11px; font-weight: 700;
  transform: translateY(-1px);
}
.thought-md { font-size: var(--fs-sm); line-height: 1.8; color: var(--text-dim); min-width: 0 }
.thought-md :deep(p) { margin: 7px 0 }
.thought-md :deep(p:first-child) { margin-top: 0 }
.thought-md :deep(p:last-child) { margin-bottom: 0 }
.thought-md :deep(strong) { color: var(--text) }
.thought-md :deep(ul), .thought-md :deep(ol) { padding-left: 20px; margin: 7px 0 }
.thought-md :deep(code) {
  padding: 1px 4px; border-radius: 4px; background: var(--surface-2);
  font-family: var(--mono); font-size: .92em;
}

/* ---------- v3 分阶段 ---------- */
.stages { display: grid; gap: 10px }
.stage {
  min-width: 0;
  padding: var(--sp-3) var(--sp-4);
  border: 1px solid var(--border);
  border-left: 3px solid var(--border);
  border-radius: var(--r-md);
  background: var(--surface);
  opacity: .7;
}
.stage.active {
  opacity: 1;
  border-left-color: var(--accent);
  background: color-mix(in oklab, var(--accent) 4%, var(--surface));
}
.stage.done { opacity: 1; border-left-color: var(--ok) }
/* 历史通过、本次没过：左边框改成红，和「已通过」的绿同时出现时能一眼分开 */
.stage.bad { border-left-color: var(--bad) }
.stage-head { display: flex; align-items: center; gap: 7px }
.stage-n {
  flex: 0 0 auto;
  display: inline-grid; place-items: center;
  width: 20px; height: 20px; border-radius: 6px;
  background: var(--surface-2); color: var(--text-dim);
  font-size: 11px; font-weight: 700;
}
.stage.active .stage-n { background: var(--accent); color: #fff }
.stage.done .stage-n { background: color-mix(in oklab, var(--ok) 18%, transparent); color: var(--ok) }
.stage-title { font-size: var(--fs-sm); font-weight: 650; min-width: 0 }
.stage-flag {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: var(--fs-xs); color: var(--text-faint); white-space: nowrap;
}
.stage-flag.ok { color: var(--ok) }
.stage-flag.bad { color: var(--bad) }
.stage-flag.now { color: var(--accent-2) }
.stage-think { margin: 8px 0 0; font-size: var(--fs-sm); line-height: 1.75; color: var(--text-dim) }
.stage-hint {
  display: flex; gap: 6px; align-items: flex-start;
  margin: 8px 0 0; padding: 8px 10px;
  border-radius: var(--r-sm);
  background: var(--surface-2);
  font-size: var(--fs-sm); line-height: 1.7; color: var(--text);
}
.stage-hint svg { flex: 0 0 auto; margin-top: 4px; color: var(--accent-2) }
.vocab { display: grid; gap: 6px; margin-top: 8px }
.vocab-item {
  border: 1px solid var(--border); border-radius: var(--r-sm);
  background: var(--surface);
}
.vocab-item summary {
  padding: 6px 10px; font-size: var(--fs-sm); color: var(--accent-2); cursor: pointer;
}
.vocab-item .acc-body { padding: 0 10px 8px }
.vocab-md { font-size: var(--fs-sm); line-height: 1.75; color: var(--text-dim) }
.vocab-md :deep(p) { margin: 4px 0 }
.vocab-md :deep(ul) { padding-left: 18px; margin: 4px 0 }
.stage-code-cap { margin-top: 10px }

/* ---------- 结果：按阶段分组 ---------- */
.stage-results { display: grid; gap: 8px; margin-top: 10px }
.stage-result {
  padding: 8px 10px;
  border: 1px solid var(--border); border-radius: var(--r-sm);
  background: var(--surface-2);
}
.stage-result.bad { border-color: color-mix(in oklab, var(--bad) 38%, var(--border)) }
.stage-result.skipped { opacity: .6 }
/* 「还没开始写」：不加红框、不抢眼，只是把位置占住，告诉人现在做的是哪一步 */
.stage-result.pending { background: var(--surface); border-style: dashed; opacity: .92 }
.stage-result-head { display: flex; align-items: center; gap: 7px }
.stage-result-ic { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50% }
.stage-result-ic.ok { color: var(--ok) }
.stage-result-ic.bad { color: var(--bad) }
.stage-result-ic.skip { color: var(--text-faint) }
.stage-result-ic.pending { color: var(--text-faint) }
.stage-result-tag { margin-left: 6px; font-size: 11px; font-weight: 400; color: var(--text-faint) }
.pending-cases { margin-top: 6px; padding-left: 25px }
.pending-cases > summary { font-size: var(--fs-xs); color: var(--text-faint); cursor: pointer }
.stage-result-title { font-size: var(--fs-sm); font-weight: 600; min-width: 0 }
.stage-result-meta { white-space: nowrap }
.stage-result .cases { margin-top: 6px; padding-left: 25px }
.api-head { display: flex; align-items: center; gap: 8px; margin-bottom: 2px }
.api-name {
  font-family: var(--mono); font-size: var(--fs-base); font-weight: 700;
  color: var(--accent-2);
}
.api .snippet { margin-top: 4px; background: var(--surface) }
.api-dl {
  display: grid; grid-template-columns: 42px minmax(0, 1fr);
  gap: 4px 10px; margin: 10px 0 0; font-size: var(--fs-sm);
}
.api-dl dt { color: var(--text-faint); font-weight: 600 }
.api-dl dd { margin: 0; color: var(--text-dim); line-height: 1.65 }
.api-example { margin-top: 10px }
.api-example .snippet { margin-top: 4px }

/* 分步卡片 */
.steps { display: grid; gap: 10px; grid-template-columns: minmax(0, 1fr); }
.steps .section-title { margin-bottom: 0 }
.step {
  padding: var(--sp-3) var(--sp-4);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--surface);
}
.step-head { display: flex; align-items: center; gap: 8px }
.step-n {
  display: inline-grid; place-items: center;
  width: 20px; height: 20px; border-radius: 6px;
  background: color-mix(in oklab, var(--accent) 14%, transparent);
  color: var(--accent-2); font-size: 11px; font-weight: 700;
}
.step-todo {
  font-family: var(--mono); font-size: 11.5px; color: var(--text-faint);
  padding: 1px 6px; border-radius: 4px; background: var(--surface-2);
}
.step-jump {
  margin-left: auto;
  display: inline-flex; align-items: center; gap: 3px;
  padding: 2px 8px; border-radius: 999px;
  border: 1px solid color-mix(in oklab, var(--accent) 30%, var(--border));
  background: transparent; color: var(--accent-2);
  font: inherit; font-size: var(--fs-xs); font-weight: 600; cursor: pointer;
  transition: background-color var(--dur-fast), color var(--dur-fast);
}
.step-jump:hover { background: color-mix(in oklab, var(--accent) 10%, transparent) }
.step-jump:focus-visible { box-shadow: var(--ring) }
.step-title { margin: 8px 0 4px; font-size: var(--fs-base); font-weight: 650; color: var(--text) }
.step-how { margin: 0; font-size: var(--fs-sm); line-height: 1.8; color: var(--text-dim) }
.step .snippet { background: var(--surface-2) }

.hint-toggle {
  display: flex; align-items: center; gap: 7px; width: 100%;
  padding: 9px var(--sp-3);
  border: 1px dashed var(--border-2); border-radius: var(--r-md);
  background: var(--surface-2); color: var(--text-dim);
  font: inherit; font-size: var(--fs-sm); font-weight: 550; cursor: pointer;
  transition: color var(--dur-fast), border-color var(--dur-fast), background-color var(--dur-fast);
}
.hint-toggle:hover { color: var(--accent-2); border-color: color-mix(in oklab, var(--accent) 40%, var(--border-2)); background: var(--surface) }
.hint-toggle:focus-visible { box-shadow: var(--ring) }
.hint-caret { margin-left: auto; transition: transform var(--dur) var(--ease-out) }
.hint-caret.open { transform: rotate(180deg) }
.hint-list { display: grid; gap: 6px; margin-top: 8px; grid-template-columns: minmax(0, 1fr); }
.hint-item summary { color: var(--text-dim); font-size: var(--fs-sm) }
.hint-text { white-space: pre-wrap; font-size: var(--fs-sm); line-height: 1.75; color: var(--text-dim) }

.concepts { display: grid; gap: 8px; grid-template-columns: minmax(0, 1fr); }
.concepts .section-title { margin-bottom: 0 }
.concept { padding: var(--sp-3) var(--sp-4); background: var(--surface-2) }
.concept h4 { margin: 0 0 6px; font-size: var(--fs-sm); font-weight: 650; color: var(--text) }
.concept-md { font-size: var(--fs-sm); line-height: 1.75; color: var(--text-dim) }
.concept-md :deep(p:first-child) { margin-top: 0 }
.concept-md :deep(p:last-child) { margin-bottom: 0 }

/* ---------- 右栏 ---------- */
.work-pane {
  overflow-y: auto;
  min-width: 0;
  padding: var(--sp-4) var(--sp-5) var(--sp-10);
  display: flex; flex-direction: column; gap: var(--sp-3);
}

/* 步骤条：整关的导航都在这一行里。点一下就是换一份代码快照（不是换一页）。
   横向可滚，步数多的时候也不换行——换行会把编辑器往下挤一屏。
   flex: 0 0 auto 是必须的：work-pane 是纵向 flex，内容一超标，可收缩的子项会被压扁，
   而它带 overflow-x:auto（min-height 失效），一压就只剩 2px——人看到的是「步骤条没了」。 */
.stage-switch {
  flex: 0 0 auto;
  display: flex; align-items: center; gap: 4px;
  overflow-x: auto; padding-bottom: 2px;
  scrollbar-width: thin;
}
.stage-tab {
  display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto;
  padding: 4px 10px 4px 6px; border-radius: 999px;
  border: 1px solid var(--border); background: var(--surface);
  color: var(--text-dim); font: inherit; font-size: var(--fs-xs); cursor: pointer;
  transition: background-color var(--dur-fast), border-color var(--dur-fast), color var(--dur-fast);
}
.stage-tab:hover:not(:disabled) { background: var(--surface-2); color: var(--text) }
.stage-tab:focus-visible { box-shadow: var(--ring) }
.stage-tab:disabled { opacity: .45; cursor: not-allowed }
.stage-tab-n {
  display: inline-grid; place-items: center; min-width: 18px; height: 18px;
  border-radius: 999px; background: var(--surface-2); color: var(--text-faint);
  font-family: var(--mono); font-size: 10px; font-weight: 700;
}
.stage-tab-t {
  max-width: 6.5em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* 当前这一步的标题放宽：别的步只需要「看得出是哪一步」，当前步要能读全，
   否则顶部只留「把「删」和「查」…」，人得靠左栏才知道自己在写什么。 */
.stage-tab.now .stage-tab-t { max-width: 13em }
.stage-tab-ok { color: var(--ok); flex: 0 0 auto }
.stage-tab.done { border-color: color-mix(in oklab, var(--ok) 30%, var(--border)); color: var(--text) }
.stage-tab.done .stage-tab-n { background: color-mix(in oklab, var(--ok) 18%, transparent); color: var(--ok) }
.stage-tab.now {
  border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
  background: color-mix(in oklab, var(--accent) 10%, var(--surface));
  color: var(--text); font-weight: 650;
}
.stage-tab.now .stage-tab-n { background: var(--accent); color: var(--bg) }
/* 红只给「当前卡住的这一步」：已通过的步不标红，否则同一颗 tab 上绿勾与红框打架 */
.stage-tab.now.fail {
  border-color: color-mix(in oklab, var(--bad) 45%, var(--border));
  background: color-mix(in oklab, var(--bad) 8%, var(--surface));
}
.stage-tab.now.fail .stage-tab-n { background: var(--bad); color: var(--bg) }

/* 编辑器吃掉右栏剩下的高度：骨架通常 30-40 行，固定 380px 会强迫人不停上下滚 */
.work-pane :deep(.ce) { flex: 1 1 auto; min-height: 380px }

.work-toolbar {
  position: sticky; top: 0; z-index: 4;
  flex: 0 0 auto;
  display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap;
  margin: calc(var(--sp-4) * -1) calc(var(--sp-5) * -1) 0;
  padding: var(--sp-3) var(--sp-5);
  background: var(--bg); border-bottom: 1px solid var(--border);
}
/* 步骤条是工具栏的上一行：这时不能再拿负上边距去抵消 work-pane 的 padding，
   否则工具栏会向上挪一格把步骤条盖住（截图里就是「步骤条不见了」）。 */
.stage-switch + .work-toolbar { margin-top: 0 }
.file-chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 9px; border-radius: var(--r-sm);
  background: var(--surface-2); border: 1px solid var(--border);
  font-family: var(--mono); font-size: var(--fs-sm); color: var(--text-dim);
}
/* TODO 剩余数：把「还差几步」直接摆在编码区上方，比字符数有用 */
.todo-chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 9px; border-radius: var(--r-sm);
  background: color-mix(in oklab, var(--warn) 12%, transparent);
  border: 1px solid color-mix(in oklab, var(--warn) 26%, transparent);
  color: var(--warn); font-size: var(--fs-xs); font-weight: 600;
}
.todo-chip.done {
  background: color-mix(in oklab, var(--ok) 12%, transparent);
  border-color: color-mix(in oklab, var(--ok) 28%, transparent);
  color: var(--ok);
}
.kbd-hint { display: inline-flex; align-items: center; gap: 4px; margin-left: 2px }
/* 「从头做这关」是清空代码的动作，和「跑测试」不是同一类：用危险色描边把两者分开，
   免得它混在工具条里像个旁边的小按钮（用户两次没找到重来的入口，就是它太不显眼） */
.redo-btn { color: var(--bad); border-color: color-mix(in oklab, var(--bad) 26%, var(--border)) }
.redo-btn:hover:not(:disabled) { background: color-mix(in oklab, var(--bad) 8%, transparent); border-color: var(--bad) }
.redo-btn:disabled { color: var(--text-faint); border-color: var(--border) }
.work-note { display: flex; align-items: center; gap: 5px; margin: 0 }
.work-note svg { color: var(--text-faint) }

/* ---------- 结果 ---------- */
.result { display: grid; gap: var(--sp-3); grid-template-columns: minmax(0, 1fr); }
.fb.pass-panel, .fb.fail-panel, .fb.next-panel, .fb.earlier-panel { margin-top: 0; padding: var(--sp-4) }
.fb.earlier-panel { display: grid; gap: 6px }
.fb.earlier-panel .earlier-cases { margin: 2px 0; padding-left: 20px; color: var(--text-dim); font-size: var(--fs-sm); line-height: 1.7 }
.fb.earlier-panel .earlier-cases li::marker { color: color-mix(in oklab, var(--warn) 70%, var(--text-faint)) }
/* 失败横幅里的「这一步要做的」：红字是验收标准，这里才是怎么做 */
.fail-hint {
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-left: 3px solid color-mix(in oklab, var(--warn) 55%, var(--border));
  border-radius: var(--r-md);
  background: var(--surface);
}
.fail-hint-cap {
  display: flex; align-items: center; gap: 5px;
  margin-bottom: 4px;
  font-size: var(--fs-xs); font-weight: 650; letter-spacing: .03em;
  color: var(--text-dim);
}
.fail-hint-cap svg { color: color-mix(in oklab, var(--warn) 75%, var(--text)) }
.fail-hint-txt { margin: 0; font-size: var(--fs-sm); line-height: 1.75; color: var(--text) }
.fail-hint-jump {
  display: inline-flex; align-items: center; gap: 5px;
  margin-top: 8px; padding: 3px 9px;
  border: 1px solid color-mix(in oklab, var(--warn) 40%, var(--border));
  border-radius: 999px;
  background: transparent; color: color-mix(in oklab, var(--warn) 80%, var(--text));
  font: inherit; font-size: var(--fs-xs); font-weight: 650; cursor: pointer;
  transition: background-color var(--dur-fast);
}
.fail-hint-jump:hover { background: color-mix(in oklab, var(--warn) 12%, transparent) }
.fail-hint-jump:focus-visible { box-shadow: var(--ring) }

/* 卡住的兜底入口：平时是「还差几次」一行淡字，到门槛才变成按钮 */
.answer-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 10px }
.answer-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 12px;
  border: 1px solid color-mix(in oklab, var(--accent) 45%, var(--border));
  border-radius: 999px;
  background: color-mix(in oklab, var(--accent) 10%, transparent);
  color: color-mix(in oklab, var(--accent) 82%, var(--text));
  font: inherit; font-size: var(--fs-sm); font-weight: 650; cursor: pointer;
  transition: background-color var(--dur-fast);
}
.answer-btn:hover { background: color-mix(in oklab, var(--accent) 18%, transparent) }
.answer-btn:focus-visible { box-shadow: var(--ring) }
.answer-btn:disabled { opacity: .6; cursor: default }
/* 答案面板刻意用中性色：它不是「又一条错」，是「这一步长这样」 */
.answer-panel { border-left: 3px solid color-mix(in oklab, var(--accent) 55%, var(--border)) }
.answer-code { margin-top: 10px; background: var(--surface-2); max-height: 420px; overflow: auto }
.answer-acts { gap: 8px; margin-top: 10px }
.pass-meta { gap: 8px; margin-top: 2px }
.pass-next { margin-top: 6px }
.cases { display: grid; gap: 6px; grid-template-columns: minmax(0, 1fr); }
.case {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  column-gap: 8px;
  align-items: start;
  padding: 8px 11px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--surface);
  font-size: var(--fs-sm);
}
.case.ok { border-color: color-mix(in oklab, var(--ok) 24%, var(--border)) }
.case.bad { border-color: color-mix(in oklab, var(--bad) 30%, var(--border)); background: color-mix(in oklab, var(--bad) 4%, var(--surface)) }
.case-ic { color: var(--ok); display: grid; place-content: center; height: 20px }
.case.bad .case-ic { color: var(--bad) }
.case-name { color: var(--text); line-height: 1.55; overflow-wrap: anywhere }
.case-msg {
  grid-column: 2;
  margin-top: 3px;
  color: var(--bad);
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.55;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
/* 失败诊断：期望/实际是「验收标准」，这行才是「你可能少写了什么」。
   浅黄底 + 左竖线，和上面红色的原始值分开，不让人把它当第二条错误。 */
.case-diag {
  grid-column: 2;
  display: flex; align-items: flex-start; gap: 6px;
  margin: 6px 0 0;
  padding: 6px 9px;
  border-left: 2px solid color-mix(in oklab, var(--warn) 52%, var(--border));
  border-radius: 0 var(--r-sm) var(--r-sm) 0;
  background: color-mix(in oklab, var(--warn) 7%, transparent);
  color: var(--text-dim);
  font-size: var(--fs-xs);
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.case-diag svg { flex: 0 0 auto; margin-top: 3px; color: color-mix(in oklab, var(--warn) 80%, var(--text)) }
.case-diag span { min-width: 0 }

.err-block {
  padding: var(--sp-3) var(--sp-4);
  border: 1px solid color-mix(in oklab, var(--bad) 30%, var(--border));
  border-left: 3px solid var(--bad);
  border-radius: var(--r-md);
  background: color-mix(in oklab, var(--bad) 5%, var(--surface));
}
.err-head { display: flex; align-items: center; gap: 6px; color: var(--bad); font-size: var(--fs-sm); font-weight: 650; margin-bottom: 6px }
.err-msg {
  margin: 0;
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.6;
  color: var(--text);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.err-stack { margin-top: 8px }
.err-stack summary { cursor: pointer; color: var(--text-faint); font-family: var(--font) }
.err-stack pre {
  margin: 6px 0 0;
  padding: var(--sp-3);
  max-height: 220px;
  overflow: auto;
  border-radius: var(--r-sm);
  background: var(--surface-2);
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: 11.5px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.logs summary { color: var(--text-dim); font-size: var(--fs-sm) }
.log-body { display: grid; gap: 2px; max-height: 260px; overflow: auto }
.log-line { display: flex; gap: 8px; font-family: var(--mono); font-size: 12px; line-height: 1.6 }
.log-lv { flex: 0 0 44px; color: var(--text-faint); font-size: 10.5px; text-transform: uppercase; padding-top: 1px }
.log-txt { min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text-dim) }

.run-meta { display: flex; align-items: center; gap: 5px }

.solution summary { color: var(--text-dim); font-weight: 550 }
.solution summary .grow { flex: 1 }
.solution :deep(.ce) { margin-top: 2px }

.work-foot {
  display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap;
  margin-top: var(--sp-2); padding-top: var(--sp-4);
  border-top: 1px solid var(--border);
}

/* ===== 首屏引导：一进来只看见「当前这一步」 ===== */

.now-step {
  display: grid; gap: 8px;
  padding: var(--sp-4);
  border: 1px solid color-mix(in oklab, var(--accent) 30%, var(--border));
  border-left: 3px solid var(--accent);
  border-radius: var(--r-md);
  background: color-mix(in oklab, var(--accent) 7%, var(--surface));
}
.now-head { display: flex; align-items: center; gap: 8px }
.now-chip {
  font-size: var(--fs-xs); font-weight: 700; letter-spacing: .04em;
  color: var(--accent-2);
}
.now-title { margin: 0; font-size: var(--fs-base); font-weight: 700; line-height: 1.45 }
.now-hint {
  display: flex; gap: 6px; margin: 0;
  font-size: var(--fs-sm); line-height: 1.8; color: var(--text);
}
.now-hint svg { flex: 0 0 auto; margin-top: 5px; color: var(--accent-2) }
/* 「看左栏完整提示」的落点：滚到视野中央后闪一下，让人一眼接上 */
.now-hint.flash {
  border-radius: var(--r-sm);
  background: color-mix(in oklab, var(--warn) 14%, transparent);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--warn) 14%, transparent);
  padding: 4px 7px;
  margin: -4px -7px;
  transition: background-color var(--dur) var(--ease-out), box-shadow var(--dur) var(--ease-out);
}
.now-jump {
  display: inline-flex; align-items: center; gap: 5px;
  justify-self: start;
  padding: 5px 11px;
  border: 1px solid color-mix(in oklab, var(--accent) 32%, var(--border));
  border-radius: 99px;
  background: transparent; color: var(--accent-2);
  font-size: var(--fs-xs); font-weight: 600; cursor: pointer;
}
.now-jump:hover { background: color-mix(in oklab, var(--accent) 10%, transparent) }
/* 回看旧步：这一段不是提示，是「你现在看的东西是只读的」的说明 + 一条回程 */
.now-past {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin: 0; padding: 6px 9px;
  border-radius: var(--r-sm);
  background: color-mix(in oklab, var(--warn) 10%, transparent);
  font-size: var(--fs-xs); color: var(--text-dim);
}
.now-back {
  margin-left: auto;
  padding: 3px 9px; border-radius: 99px;
  border: 1px solid color-mix(in oklab, var(--accent) 34%, var(--border));
  background: transparent; color: var(--accent-2);
  font: inherit; font-size: var(--fs-xs); font-weight: 600; cursor: pointer;
}
.now-back:hover { background: color-mix(in oklab, var(--accent) 10%, transparent) }
.stage-think-md { font-size: var(--fs-sm); line-height: 1.8; color: var(--text-dim) }
.stage-think-md :deep(p:first-child) { margin-top: 0 }
.now-vocab-body { display: grid; gap: 10px }
.now-vocab-item h5 { margin: 0 0 4px; font-size: var(--fs-sm); color: var(--text) }

/* 背景资料：折叠成一列标题行，想读再点开 */
.fold-info { display: grid; gap: 6px }
.info-acc { display: block }
.info-acc > summary { font-size: var(--fs-sm); font-weight: 650 }
.goal-p { margin: 0; font-size: var(--fs-base); line-height: 1.75; font-weight: 550 }
.lesson.flat { border-left-width: 2px; background: transparent; padding-left: var(--sp-3) }

/* 窄窗口：两栏叠成一列，整页滚动（编辑器仍然保持自己的高度） */
@media (max-width: 1180px) {
  .level-page { display: block; overflow-y: auto }
  .task-pane { border-right: 0; border-bottom: 1px solid var(--border); overflow: visible; padding-bottom: var(--sp-5) }
  .work-pane { overflow: visible; padding-top: var(--sp-4) }
  .work-toolbar { margin: 0; position: static; padding: 0 0 var(--sp-3) }
  .center-wrap { min-height: 60vh }
}
</style>