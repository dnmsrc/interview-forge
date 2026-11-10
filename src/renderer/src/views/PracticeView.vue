<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { QuestionRow, GradeResult } from '@shared/types'
import QuestionBody from '../components/QuestionBody.vue'
import FeedbackPanel from '../components/FeedbackPanel.vue'
import Icon from '../components/Icon.vue'
import { useForgeStore } from '../store'
import { TYPE_LABEL, TYPE_ICON_NAME, DOMAIN_LABEL, DIFF_LABEL, SCALE_LABEL, toast, scale4Color, scale4Soft, pctColor, softOf, lineOf, typePillClass, renderMd } from '../lib/ui'
import { ipc } from '../lib/ipc'

const store = useForgeStore()
const router = useRouter()
const route = useRoute()

const spec = reactive({
  domains: ['fe'] as string[],
  stacks: [] as string[],
  nodeIds: [] as string[],
  types: [] as string[],
  difficulties: [] as number[],
  count: 10,
  includeDue: true,
  mixReviewRatio: 0.35,
  allowLocked: false
})
const domainOpts = Object.entries(DOMAIN_LABEL).map(([value, label]) => ({ value, label }))
const typeOpts = Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))
const diffOpts = [1, 2, 3, 4, 5].map((v) => ({ value: v, label: `${v} · ${DIFF_LABEL[v]}` }))

/** 纯 UI：今日（按每日目标直接开练）/ 自选（展开全部组卷参数）。不改任何 IPC 语义 */
const mode = ref<'today' | 'custom'>('today')
/** 纯 UI：收起组卷参数条，把纵向空间让给题目 */
const specOpen = ref(true)

const queue = ref<QuestionRow[]>([])
const idx = ref(0)
const answer = ref<any>(null)
const grade = ref<(GradeResult & { myAnswerSnapshot?: string }) | null>(null)
const revealed = ref(false)
const busy = ref('')
const justUnlocked = ref<{ nodeId: string; title: string }[]>([])
const sessionScores = ref<number[]>([])

const cur = computed(() => queue.value[idx.value] ?? null)
const q = computed(() => cur.value?.q ?? null)
const doneCount = computed(() => sessionScores.value.length)
const avgPct = computed(() => (sessionScores.value.length ? Math.round(sessionScores.value.reduce((s, v) => s + v, 0) / sessionScores.value.length) : 0))
const focusTitle = computed(() => (cur.value && spec.nodeIds.length ? cur.value.nodeTitle : ''))

/* ---- 以下全是展示派生值，不参与任何业务判定 ---- */
const progressPct = computed(() => (queue.value.length ? Math.round((doneCount.value / queue.value.length) * 100) : 0))
const dailyTarget = computed(() => (store.settings ? Math.max(5, Math.min(30, store.settings.dailyTarget)) : spec.count))
const todayDesc = computed(() => `${dailyTarget.value} 题 · 到期复习优先 · 混入 ${Math.round(spec.mixReviewRatio * 100)}% 旧题/变体`)
/** 四档自评按钮：短标签沿用原有文案，全称走 SCALE_LABEL 做 title 提示 */
const SELF_SHORT = ['完全不会', '提示后会', '能独立说清', '能举证']
const selfBtns = computed(() => SELF_SHORT.map((label, i) => ({
  i,
  label,
  full: `${i} · ${SCALE_LABEL[i]}`,
  color: scale4Color(i),
  soft: scale4Soft(i),
  on: grade.value?.gradingKind === 'self' && grade.value.scale4 === i
})))
/** 错题默认展开解析、答对默认收起 */
const isWrong = computed(() => !!grade.value && grade.value.pct < 60)
/** 拉题期间把上一题的反馈一起让位给骨架，避免新旧内容同时在场闪跳 */
const showFeedback = computed(() => !!q.value && !!grade.value && busy.value !== 'queue')
const analysisHtml = computed(() => (q.value?.analysis ? renderMd(q.value.analysis) : ''))
const gapList = computed<string[]>(() => (q.value?.gapCheck ?? []) as string[])

async function start() {
  busy.value = 'queue'
  try {
    const rows = await ipc.practice.queue({ ...spec })
    if (!rows.length) { toast.warn('按当前条件抽不到题：可能题库还没铺到这些板块，去「题库·版本」页点一次更新，或放宽条件'); return }
    queue.value = rows
    idx.value = 0
    answer.value = null
    grade.value = null
    revealed.value = false
    sessionScores.value = []
    justUnlocked.value = []
    toast.ok(`抽出 ${rows.length} 题（含到期复习与薄弱点变体）`)
  } catch (e: any) { toast.err(String(e?.message ?? e)) } finally { busy.value = '' }
}

async function submit(selfScale4?: number) {
  if (!cur.value || busy.value === 'submit') return
  busy.value = 'submit'
  try {
    const r = await ipc.practice.submit(cur.value.id, answer.value, { selfScale4 })
    grade.value = { ...(r.grade as GradeResult), myAnswerSnapshot: JSON.stringify(answer.value ?? {}) }
    revealed.value = true
    sessionScores.value.push(r.grade.pct)
    if (r.unlockedNow?.length) {
      justUnlocked.value = r.unlockedNow
      toast.note(`点亮 ${r.unlockedNow.length} 个考点`, `${r.unlockedNow.map((u: any) => u.title).join('、')}；后继节点已解锁`)
      void store.loadPlan()
    }
    if (r.aiUnavailable) toast.warn(r.aiUnavailable)
  } catch (e: any) { toast.err(String(e?.message ?? e)) } finally { busy.value = '' }
}

async function revealWithoutGrading() {
  if (!cur.value) return
  revealed.value = true
  grade.value = { qid: cur.value.id, scale4: 0, pct: 0, gradingKind: 'self', verdict: '未作答，仅展示答案（不计入掌握度）' }
}

async function next() {
  if (!revealed.value) { await revealWithoutGrading(); return }
  if (idx.value + 1 >= queue.value.length) {
    const avg = avgPct.value
    const tail = `${justUnlocked.value.length ? `新点亮 ${justUnlocked.value.length} 个考点。` : ''}建议去图谱页看看刚解锁了什么。`
    if (avg >= 60) toast.note(`本组完成 ${doneCount.value} 题`, `平均 ${avg} 分。${tail}`)
    else toast.warn(`本组完成 ${doneCount.value} 题，平均只有 ${avg} 分。${tail}`)
    void store.loadPlan()
    void store.loadBank()
    return
  }
  idx.value++
  answer.value = null
  grade.value = null
  revealed.value = false
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
watch(() => spec.mixReviewRatio, (v) => void ipc.settings.set('globalMixRatio', v))

onMounted(async () => {
  await store.boot()
  if (store.settings) {
    spec.mixReviewRatio = store.settings.globalMixRatio
    spec.count = Math.max(5, Math.min(30, store.settings.dailyTarget))
  }
  const node = route.query.node as string | undefined
  const stack = route.query.stack as string | undefined
  const domain = route.query.domain as string | undefined
  if (node) { spec.nodeIds = [node]; spec.domains = []; spec.allowLocked = true }
  else if (stack) { spec.stacks = [stack]; spec.domains = domain ? [domain] : [] }
  else if (domain) spec.domains = [domain]
  if (node || stack || domain) mode.value = 'custom'
  void start()
})
</script>

<template>
  <div class="page">
    <!-- ===== 吸顶配置 / 进度工具条 ===== -->
    <div class="toolbar">
      <div class="tb-line">
        <div class="seg tb-seg" role="tablist" aria-label="组卷模式">
          <button type="button" :class="{ on: mode === 'today' }" @click="mode = 'today'"><Icon name="flame" :size="13" /> 今日</button>
          <button type="button" :class="{ on: mode === 'custom' }" @click="mode = 'custom'"><Icon name="filter" :size="13" /> 自选</button>
        </div>

        <n-select v-if="mode === 'custom'" v-model:value="spec.domains" multiple size="small" :max-tag-count="1"
          :options="domainOpts" placeholder="板块" class="tb-sel" :disabled="!!spec.nodeIds.length || !!spec.stacks.length" />
        <n-select v-if="mode === 'custom'" v-model:value="spec.types" multiple size="small" :max-tag-count="1" clearable
          :options="typeOpts" placeholder="题型不限" class="tb-sel" />

        <span class="grow" />

        <div class="prog" :title="`本组已完成 ${doneCount} / ${queue.length} 题`">
          <div class="bar prog-bar accent"><i :style="{ width: `${progressPct}%` }" /></div>
          <span class="tiny faint num">已完成 <b class="num">{{ doneCount }}</b>/<span class="num">{{ queue.length }}</span></span>
          <span v-if="doneCount" class="pill" :style="{ background: softOf(pctColor(avgPct), 12), color: pctColor(avgPct), borderColor: lineOf(pctColor(avgPct), 32) }">
            均分 {{ avgPct }}
          </span>
        </div>

        <div class="acts">
          <n-button size="small" quaternary :loading="busy === 'queue'" title="按当前条件重新抽一组" @click="start">
            <Icon name="refresh" :size="14" /> 换一组
          </n-button>
          <n-button size="small" quaternary :disabled="!cur || !!grade" :loading="busy === 'variant'" title="为当前考点补两道变体" @click="genMoreVariants">
            <Icon name="sparkles" :size="14" /> 补变体
          </n-button>
          <n-button data-testid="practice-reveal" size="small" quaternary :disabled="!cur || revealed" title="不做批改，直接看答案" @click="revealWithoutGrading">
            <Icon name="book" :size="14" /> 看答案
          </n-button>
          <button type="button" class="btn ghost tb-fold" :title="specOpen ? '收起组卷参数' : '展开组卷参数'" @click="specOpen = !specOpen">
            <Icon name="gear" :size="14" /> 参数
            <Icon name="chevronDown" :size="13" class="fold-ic" :class="{ up: !specOpen }" />
          </button>
        </div>
      </div>

      <!-- 参数行：今日模式只读摘要；自选模式给出全部 naive 控件 -->
      <div v-show="specOpen" class="tb-line tb-row2">
        <template v-if="mode === 'today'">
          <span class="tiny faint"><Icon name="clock" :size="13" /> 按每日目标出 {{ dailyTarget }} 题</span>
          <span class="tiny faint ellip">{{ todayDesc }}</span>
          <span class="grow" />
          <span class="tiny faint">想换板块或难度，点「自选」</span>
        </template>
        <template v-else>
          <label class="fld"><span class="micro faint">难度（留空=自适应）</span>
            <n-select v-model:value="spec.difficulties" multiple size="small" :max-tag-count="1" clearable :options="diffOpts" placeholder="不限" />
          </label>
          <label class="fld fld-narrow"><span class="micro faint">题量</span>
            <n-input-number v-model:value="spec.count" size="small" :min="3" :max="50" class="w-full" />
          </label>
          <label class="fld fld-wide"><span class="micro faint">旧题/变体混入 {{ Math.round(spec.mixReviewRatio * 100) }}%</span>
            <n-slider v-model:value="spec.mixReviewRatio" :min="0" :max="0.9" :step="0.05" :format-tooltip="(v: number) => `${Math.round(v * 100)}%`" />
          </label>
          <label class="sw"><n-switch v-model:value="spec.includeDue" size="small" /> 优先清到期</label>
          <label class="sw"><n-switch v-model:value="spec.allowLocked" size="small" /> 允许锁定节点</label>
          <n-button size="small" type="primary" :loading="busy === 'queue'" @click="start">
            <Icon name="play" :size="14" /> 开始这组
          </n-button>
        </template>
      </div>

      <div v-if="spec.nodeIds.length || spec.stacks.length" class="fb warn tb-focus">
        <span class="tiny ellip" style="flex:1;min-width:0">已限定范围：<b>{{ focusTitle || spec.stacks.join(', ') }}</b>
          （{{ spec.nodeIds.length ? '只出这个考点及其变体' : '只出这个技术栈的题' }}，锁定节点也已放开）</span>
        <n-button size="tiny" @click="clearFocus">取消限定</n-button>
      </div>
    </div>

    <!-- ===== 拉题骨架（避免空白闪跳） ===== -->
    <div v-if="busy === 'queue'" class="card sk-card">
      <div class="sk-pills"><span class="skeleton" /><span class="skeleton" /><span class="skeleton" /></div>
      <div class="skeleton sk-line" style="width:92%" />
      <div class="skeleton sk-line" style="width:76%" />
      <div class="skeleton sk-block" style="height:150px;margin-top:14px" />
      <div class="tiny faint" style="margin-top:12px"><Icon name="zap" :size="13" /> 正在按条件抽题：到期复习 + 薄弱点变体优先…</div>
    </div>

    <!-- ===== 题目主体 ===== -->
    <div v-else-if="cur && q" :key="cur.id" class="card rise" style="--i:0">
      <div class="qmeta">
        <span class="pill info num"><Icon name="target" :size="12" /> {{ idx + 1 }}/{{ queue.length }}</span>
        <span class="pill" :class="typePillClass(cur.type)"><Icon :name="TYPE_ICON_NAME[cur.type] || 'book'" :size="12" /> {{ TYPE_LABEL[cur.type] }}</span>
        <span class="pill lock"><Icon name="chart" :size="12" /> 难度 {{ cur.difficulty }} · {{ DIFF_LABEL[cur.difficulty] }}</span>
        <span v-if="cur.angle" class="pill warn"><Icon name="refresh" :size="12" /> 巩固变体 · <span class="ellip">{{ cur.angle }}</span></span>
        <span v-else-if="cur.parent_id" class="pill purple"><Icon name="layers" :size="12" /> 变体题</span>
        <span class="qnode ellip" :title="cur.nodeTitle">{{ cur.nodeTitle }}</span>
      </div>

      <div class="qbody">
        <QuestionBody :q="q" v-model="answer" :revealed="revealed" :disabled="!!grade" @submit="submit()" />
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
        <n-button data-testid="practice-next" type="primary" :disabled="!!busy" @click="next">
          <Icon name="arrowRight" :size="15" /> {{ idx + 1 >= queue.length ? '完成本组' : '下一题' }}
        </n-button>
        <n-button size="small" quaternary @click="openNode(cur.node_id)"><Icon name="graph" :size="14" /> 图谱定位</n-button>
        <span class="grow" />
        <span class="tiny faint">本组已答 <b class="num">{{ doneCount }}</b> 题 · 均分 <b class="num" :style="{ color: pctColor(avgPct) }">{{ avgPct }}</b></span>
      </div>
    </div>

    <!-- ===== AI 批改骨架（提交期间保持 loading，禁重复提交） ===== -->
    <div v-else-if="busy === 'submit'" class="card sk-card">
      <div class="skeleton sk-line" style="width:38%" />
      <div class="skeleton sk-block" style="height:96px;margin-top:12px" />
      <div class="sk-pills" style="margin-top:14px"><span class="skeleton" /><span class="skeleton" /><span class="skeleton" /></div>
      <div class="tiny faint" style="margin-top:12px"><Icon name="brain" :size="13" /> 走强模型逐评分点批改中，通常几秒…</div>
    </div>

    <div v-else class="empty">
      <span class="ic"><Icon name="search" :size="26" /></span>
      <span class="t">这个范围还没有题</span>
      <span class="d">多半是题库还没铺到这些板块。去「题库·版本」页让 AI 补一次，或换个板块再抽。</span>
      <span class="cta"><n-button size="small" type="primary" @click="start">换一组试试</n-button></span>
    </div>

    <!-- ===== 反馈：提交后立刻完整展开，点下一题前一定能看到答案与解析 ===== -->
    <div v-if="q && grade && busy !== 'queue'" class="fb-stage">
      <FeedbackPanel :q="q" :grade="grade" :node-id="cur?.node_id" :node-title="cur?.nodeTitle"
        :my-answer="grade.myAnswerSnapshot ?? '{}'" @open-node="openNode" />
    </div>

    <!-- 长解析折叠：错题默认展开、答对默认收起（解析本体已由 fb-stage 内的重复卡让位） -->
    <details v-if="showFeedback && analysisHtml" class="acc ana" :open="isWrong">
      <summary>
        <Icon name="book" :size="15" class="ana-ic" />
        <span>考点解析{{ isWrong ? '（本题失分，先看这里）' : '' }}</span>
        <span class="grow" />
        <span class="micro faint">{{ isWrong ? '展开中' : '点击展开' }}</span>
      </summary>
      <div class="acc-body md" v-html="analysisHtml" />
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
/* ---------- 工具条 ---------- */
.toolbar { flex-direction: column; align-items: stretch; gap: var(--sp-2) }
.tb-line { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; min-width: 0 }
.tb-line .grow { flex: 1; min-width: var(--sp-4) }
.tb-seg { flex: 0 0 auto }
.tb-seg button { display: inline-flex; align-items: center; gap: 5px }
.tb-sel { width: 150px; flex: 0 1 150px; min-width: 92px }
.acts { display: flex; align-items: center; gap: var(--sp-1); flex-wrap: wrap; flex: 0 0 auto }
.prog { display: flex; align-items: center; gap: var(--sp-2); flex: 1 1 190px; min-width: 148px; max-width: 420px }
.prog-bar { flex: 1 1 60px; min-width: 46px }
.prog .num { white-space: nowrap }
.tb-row2 { padding-top: 2px; border-top: 1px dashed var(--border) }
.fld { display: flex; flex-direction: column; gap: 3px; flex: 1 1 168px; min-width: 132px; max-width: 260px }
.fld-narrow { flex: 0 1 104px; min-width: 88px; max-width: 118px }
.fld-wide { flex: 1 1 200px; min-width: 150px; max-width: 300px }
.w-full { width: 100% }
.sw { display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-sm); color: var(--text-dim); flex: 0 0 auto }
.tb-focus { margin: 2px 0 0; flex-basis: 100%; display: flex; align-items: center; gap: var(--sp-2) }
.tb-fold { gap: 4px }
.fold-ic { transition: transform var(--dur) var(--ease-out) }
.fold-ic.up { transform: rotate(-90deg) }
.hd-ic { color: var(--text-faint) }

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
/* 解析已在下方 details.acc 里按对错决定展开态，这里让位给折叠版，避免同一份解析出现两次 */
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
  .tb-sel { width: 128px; flex-basis: 128px }
  .kbd-hint { margin-left: 0; flex-basis: 100% }
  .qnode { text-align: left }
}
</style>
