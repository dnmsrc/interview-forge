<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { QuestionRow, ExamSpec, AiExamReport } from '@shared/types'
import QuestionBody from '../components/QuestionBody.vue'
import Icon from '../components/Icon.vue'
import { TYPE_LABEL, TYPE_ICON_NAME, DOMAIN_LABEL, toast, fmtClock, pctColor, renderMd, dialog, typePillClass, softOf, lineOf } from '../lib/ui'
import { useForgeStore } from '../store'
import { useGameStore } from '../game-store'
import CelebrationModal from '../components/CelebrationModal.vue'
import { ipc } from '../lib/ipc'

const store = useForgeStore()
const game = useGameStore()
type Phase = 'setup' | 'running' | 'grading' | 'report'
const phase = ref<Phase>('setup')
const templates = ref<{ id: string; title: string; spec: ExamSpec }[]>([])
const custom = reactive({ domains: ['fe', 'be'] as string[], count: 20, minutes: 45, passLine: 60 })
const domainOpts = Object.entries(DOMAIN_LABEL).map(([value, label]) => ({ value, label }))

const examId = ref('')
const summary = ref<any>(null)
const questions = ref<QuestionRow[]>([])
const idx = ref(0)
const answers = ref<Record<string, any>>({})
const remain = ref(0)
let timer: ReturnType<typeof setInterval> | null = null
let draftTimer: ReturnType<typeof setTimeout> | null = null
const report = ref<AiExamReport | null>(null)
const progress = reactive({ done: 0, total: 0 })

const cur = computed(() => questions.value[idx.value] ?? null)
const q = computed(() => cur.value?.q ?? null)
const answeredCount = computed(() => Object.values(answers.value).filter((a) => a && JSON.stringify(a) !== '{}').length)
const danger = computed(() => remain.value > 0 && remain.value < 120000)

/* ---------- 以下均为纯展示派生，不参与计时与交卷判定 ---------- */
/** 计时恢复提示条：继续 / 放弃两个动作（放弃走 dialog） */
const resumedNote = ref<{ title: string } | null>(null)
const selectedTpl = ref('')
const tplRule = computed(() => {
  const t = templates.value.find((x) => x.id === selectedTpl.value)
  if (!t) return ''
  const dom = (t.spec.domains ?? []).map((d: string) => DOMAIN_LABEL[d] ?? d).join(' + ') || '综合'
  return `${dom} · ${t.spec.count} 题 · ${t.spec.minutes} 分钟闭卷 · 及格线 ${t.spec.passLine ?? 60} 分 · 客观题即时判分，主观题逐评分点走 AI`
})
const customRule = computed(() => `严格倒计时 ${custom.minutes} 分钟，到时自动交卷 · 中途退出算弃考 · 交卷后不可修改`)
const unanswered = computed(() => Math.max(0, questions.value.length - answeredCount.value))
const totalMs = computed(() => {
  const m = Number(summary.value?.spec?.minutes ?? 0)
  if (m > 0) return m * 60000
  const a = Date.parse(String(summary.value?.started_at ?? '').replace(' ', 'T'))
  const b = Date.parse(String(summary.value?.deadline_at ?? '').replace(' ', 'T'))
  return Number.isFinite(a) && Number.isFinite(b) && b > a ? b - a : 0
})
const leftPct = computed(() => (totalMs.value ? Math.max(0, Math.min(100, Math.round((remain.value / totalMs.value) * 100))) : 0))
const leftCritical = computed(() => leftPct.value > 0 && leftPct.value < 20)
const cellDone = (row: QuestionRow) => !!answers.value[row.id] && JSON.stringify(answers.value[row.id]) !== '{}'
const metaById = computed(() => {
  const m = new Map<string, QuestionRow>()
  for (const row of questions.value) m.set(row.id, row)
  return m
})
const elapsedText = computed(() => {
  const a = Date.parse(String(summary.value?.started_at ?? '').replace(' ', 'T'))
  const b = Date.parse(String(summary.value?.submitted_at ?? '').replace(' ', 'T'))
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return '—'
  const used = Math.max(0, totalMs.value - (summary.value?.remainingMs ?? 0))
  const ms = totalMs.value ? Math.min(used, b - a) : b - a
  return fmtClock(Math.round(ms / 1000) * 1000)
})
const kpiList = computed<{ k: string; v: string; d: string; color?: string }[]>(() => {
  const r = report.value
  if (!r) return []
  const per = r.perQuestion ?? []
  const avg = per.length ? Math.round(per.reduce((s, x) => s + (Number(x.pct) || 0), 0) / per.length) : 0
  const groups = new Map<string, { sum: number; n: number }>()
  for (const item of per) {
    const t = metaById.value.get(item.qid)?.type ?? 'other'
    const g = groups.get(t) ?? { sum: 0, n: 0 }
    g.sum += Number(item.pct) || 0
    g.n++
    groups.set(t, g)
  }
  let weakest = '—'
  let weakAvg = Infinity
  for (const [t, g] of groups) {
    const v = g.sum / (g.n || 1)
    if (v < weakAvg) { weakAvg = v; weakest = TYPE_LABEL[t] ?? t }
  }
  return [
    { k: '总分', v: String(r.total), d: `及格线 ${summary.value?.pass_line ?? 60}` },
    { k: '是否过线', v: r.pass ? '通过' : '未过', d: r.band || '档位由 AI 综合判定', color: r.pass ? 'var(--ok)' : 'var(--bad)' },
    { k: '平均得分率', v: `${avg}%`, d: `${per.length} 题已批改`, color: pctColor(avg) },
    { k: '最弱题型', v: weakest, d: '按该题型平均分排序' },
    { k: '耗时', v: elapsedText.value, d: '用时 = 交卷 − 开始' }
  ]
})
const detailRows = computed(() => ((report.value?.perQuestion ?? []) as any[]).map((item, i) => {
  const row = metaById.value.get(item.qid)
  return {
    qid: item.qid,
    i,
    pct: Number(item.pct) || 0,
    verdict: item.verdict || '已批改',
    missing: (item.missing ?? []) as string[],
    awarded: (item.awarded ?? []) as { point: string; got: number; why: string }[],
    stem: (row?.q?.stem ?? `第 ${i + 1} 题`).replace(/[#*`>]/g, ' ').replace(/\s+/g, ' ').trim(),
    type: row?.type ?? '',
    difficulty: row?.difficulty ?? 0
  }
}))

async function bootResume() {
  await store.boot()
  templates.value = await ipc.exam.templates()
  const run = await ipc.exam.resume()
  if (run && run.status === 'running') {
    examId.value = run.id
    summary.value = run
    questions.value = await ipc.exam.questions(run.id)
    for (const row of questions.value) if ((row as any).savedAnswer) answers.value[row.id] = (row as any).savedAnswer
    phase.value = 'running'
    remain.value = run.remainingMs ?? 0
    startTimer()
    resumedNote.value = { title: run.title }
  }
}
function startTimer() {
  stopTimer()
  timer = setInterval(async () => {
    remain.value = Math.max(0, remain.value - 1000)
    if (remain.value === 0) {
      toast.warn('时间到：已按当前作答自动交卷')
      await doSubmit(true)
    }
  }, 1000)
}
function stopTimer() { if (timer) clearInterval(timer); timer = null }
function startDraftTimer() {
  if (draftTimer) clearTimeout(draftTimer)
  draftTimer = setTimeout(async () => {
    const row = cur.value
    if (!row || !examId.value) return
    const raw = answers.value[row.id] ?? null
    const selfEst = raw && typeof raw.self_est === 'number' ? raw.self_est : undefined
    const clean = raw && typeof raw === 'object' ? { ...raw } : raw
    if (clean && typeof clean === 'object') delete clean.self_est
    await ipc.exam.draft(examId.value, row.id, clean, selfEst)
  }, 400)
}
watch(() => answers.value, startDraftTimer, { deep: true })

async function start(spec: ExamSpec) {
  try {
    const s = await ipc.exam.start(spec)
    examId.value = s.id
    summary.value = s
    questions.value = await ipc.exam.questions(s.id)
    answers.value = {}
    idx.value = 0
    remain.value = s.remainingMs ?? spec.minutes * 60000
    phase.value = 'running'
    startTimer()
  } catch (e: any) { toast.err(String(e?.message ?? e)) }
}

async function doSubmit(auto = false) {
  if (!examId.value || phase.value === 'grading') return
  if (!auto) {
    const d = dialog.warning({
      title: '确认交卷？',
      content: `已答 ${answeredCount.value}/${questions.value.length} 题${unanswered.value ? `，其中 ${unanswered.value} 题未作答` : ''}。交卷后不可修改，主观题将逐题 AI 批改。`,
      positiveText: '交卷并开始批改',
      negativeText: '再检查一下',
      onPositiveClick: async () => { d.loading = true; await reallySubmit(); d.loading = false }
    })
    return
  }
  await reallySubmit()
}
async function reallySubmit() {
  stopTimer()
  phase.value = 'grading'
  progress.total = questions.value.length
  void ipc.exam.submit(examId.value)
  const poll = setInterval(async () => {
    const p = await ipc.exam.gradingStatus(examId.value)
    progress.done = p.done; progress.total = p.total || progress.total
    if (p.status === 'done') {
      clearInterval(poll)
      summary.value = await ipc.exam.summary(examId.value)
      report.value = summary.value?.report ?? null
      phase.value = 'report'
      void store.loadPlan()
      void store.loadDash()
      // 游戏化：本场考试的聚合 XP/徽章/Boss 庆祝事件
      void game.syncAfterSettle()
    }
  }, 900)
}

function jump(i: number) { idx.value = i }
// 弃考确认：与交卷一致的 dialog（n-popconfirm 的 trigger 在部分环境点击不响应，实测踩过坑）
function confirmAbandon() {
  const d = dialog.warning({
    title: '确认弃考？',
    content: '这场模拟的所有作答将被丢弃，不可恢复。',
    positiveText: '弃考',
    negativeText: '继续作答',
    onPositiveClick: async () => { d.loading = true; await abandon(); d.loading = false }
  })
}
async function abandon() {
  if (!examId.value) return
  await ipc.exam.abandon(examId.value)
  reset()
  toast.ok('已放弃这场模拟')
}
function reset() {
  stopTimer(); phase.value = 'setup'; examId.value = ''; summary.value = null; questions.value = []; answers.value = {}; report.value = null; idx.value = 0
  resumedNote.value = null; selectedTpl.value = ''
}
onMounted(bootResume)
onBeforeUnmount(() => { stopTimer(); if (draftTimer) clearTimeout(draftTimer) })
</script>

<template>
  <!-- ===== 组卷 ===== -->
  <div v-if="phase === 'setup'" class="page">
    <section class="card rise">
      <div class="panel-head">
        <h3><Icon name="timer" :size="16" class="hd-ic" /> 选一张模拟卷</h3>
        <span class="grow" />
        <span class="desc">严格计时，中途退出算弃考</span>
      </div>
      <div class="tpl-grid">
        <button v-for="(t, ti) in templates" :key="t.id" type="button" class="tpl-card rise" data-testid="exam-tpl" :style="{ '--i': ti }"
          :class="{ on: selectedTpl === t.id }" @click="selectedTpl = t.id">
          <span class="tpl-top">
            <span class="ellip tpl-title">{{ t.title }}</span>
            <Icon v-if="selectedTpl === t.id" name="check" :size="15" class="tick" />
          </span>
          <span class="micro faint ellip">{{ (t.spec.domains ?? []).map((d: string) => DOMAIN_LABEL[d] ?? d).join(' + ') || '综合' }}</span>
          <span class="tpl-kv num">
            <span><b>{{ t.spec.count }}</b> 题</span>
            <span><b>{{ t.spec.minutes }}</b> 分钟</span>
            <span>及格 <b>{{ t.spec.passLine ?? 60 }}</b></span>
          </span>
        </button>
      </div>
      <div v-if="!templates.length" class="empty">
        <span class="ic"><Icon name="layers" :size="24" /></span>
        <span class="t">还没有内置模板</span>
        <span class="d">先在下方自定义一组参数即可开考。</span>
      </div>
      <hr class="hr" />
      <div class="row start-row">
        <n-button data-testid="exam-start" type="primary" size="large" :disabled="!selectedTpl"
          @click="start({ ...(templates.find(t => t.id === selectedTpl)?.spec ?? ({} as ExamSpec)), title: templates.find(t => t.id === selectedTpl)?.title })">
          <Icon name="play" :size="15" /> 开始考试
        </n-button>
        <span class="tiny faint rule ellip">{{ tplRule || '先在上方选一张模板卷；想用别的板块/题量就用下面的自定义组卷。' }}</span>
      </div>
    </section>

    <section class="card rise" style="--i:1">
      <div class="panel-head">
        <h3><Icon name="gear" :size="16" class="hd-ic" /> 自定义组卷</h3>
        <span class="grow" />
        <span class="desc">{{ customRule }}</span>
      </div>
      <div class="grid g4">
        <label class="fld"><span class="micro faint">板块</span>
          <n-select v-model:value="custom.domains" multiple size="small" :max-tag-count="1" :options="domainOpts" />
        </label>
        <label class="fld"><span class="micro faint">题量</span>
          <n-input-number v-model:value="custom.count" size="small" :min="5" :max="120" class="w-full" />
        </label>
        <label class="fld"><span class="micro faint">时长（分钟）</span>
          <n-input-number v-model:value="custom.minutes" size="small" :min="10" :max="240" class="w-full" />
        </label>
        <label class="fld"><span class="micro faint">及格线</span>
          <n-input-number v-model:value="custom.passLine" size="small" :min="30" :max="90" class="w-full" />
        </label>
      </div>
      <div class="row start-row">
        <n-button type="primary" :disabled="!custom.domains.length"
          @click="start({ domains: custom.domains, count: custom.count, minutes: custom.minutes, passLine: custom.passLine, title: `自定义 ${custom.count} 题` })">
          <Icon name="play" :size="15" /> 用这套参数开考
        </n-button>
        <span class="tiny faint rule ellip">判分方式：选择/判断自动比对，简答/论述/编程逐评分点交 AI 批改</span>
      </div>
    </section>
  </div>

  <!-- ===== 答题 ===== -->
  <div v-else-if="phase === 'running'" class="page">
    <div v-if="resumedNote" class="fb warn resume-bar">
      <Icon name="clock" :size="15" class="rb-ic" />
      <div class="rb-txt">
        <div class="tiny"><b>已恢复未交的《{{ resumedNote.title }}》</b>，剩余时间与草稿进度都接着上次继续。</div>
        <div class="micro faint">关掉窗口不会丢作答：草稿每 0.4 秒自动落盘。</div>
      </div>
      <div class="rb-acts">
        <n-button size="small" type="primary" @click="resumedNote = null">继续作答</n-button>
        <n-button size="small" quaternary @click="confirmAbandon">放弃这场</n-button>
      </div>
    </div>

    <div class="grid g-side">
      <!-- 左：题目 -->
      <div class="col side-main">
        <div v-if="cur && q" class="card">
          <div class="qmeta">
            <span class="pill info num"><Icon name="target" :size="12" /> 第 {{ idx + 1 }} / {{ questions.length }} 题</span>
            <span class="pill" :class="typePillClass(cur.type)"><Icon :name="TYPE_ICON_NAME[cur.type] || 'book'" :size="12" /> {{ TYPE_LABEL[cur.type] }}</span>
            <span class="pill lock"><Icon name="chart" :size="12" /> 难度 {{ cur.difficulty }}</span>
            <span class="grow" />
            <span class="micro faint">闭卷：无资料面板，不做即时判分</span>
          </div>
          <div class="qbody">
            <QuestionBody :q="q" :model-value="answers[cur.id] ?? null"
              @update:model-value="(v: any) => { answers[cur.id] = v }" />
          </div>
          <hr class="hr" />
          <div class="row nav-row">
            <n-button data-testid="exam-prev" size="small" :disabled="idx === 0" @click="jump(idx - 1)">上一题</n-button>
            <n-button data-testid="exam-next" v-if="idx + 1 < questions.length" size="small" type="primary" @click="jump(idx + 1)">下一题</n-button>
            <n-button data-testid="exam-submit" v-else size="small" type="primary" @click="doSubmit()">交卷</n-button>
            <span class="grow" />
            <div class="seg conf-seg" role="group" aria-label="把握度自评">
              <button v-for="c in [{ v: 0, t: '没底' }, { v: 1, t: '一般' }, { v: 2, t: '挺稳' }]" :key="c.v" type="button"
                :class="{ on: (answers[cur.id]?.self_est ?? null) === c.v }"
                @click="answers[cur.id] = { ...(answers[cur.id] ?? {}), self_est: c.v }">{{ c.t }}</button>
            </div>
            <span class="micro faint conf-hint">标记把握度，交卷后对比 AI 判定</span>
          </div>
        </div>
        <div v-else class="card">
          <div class="empty">
            <span class="ic"><Icon name="search" :size="24" /></span>
            <span class="t">这张卷子取不到题目</span>
            <span class="d">回组卷页重新开考，或去「题库·版本」页补题。</span>
          </div>
        </div>
      </div>

      <!-- 右：答题卡（≤1180px 自动落到题目下方） -->
      <aside class="col side-aside">
        <div class="card clock-card">
          <div class="row clock-row">
            <span class="micro faint"><Icon name="timer" :size="13" /> 剩余时间</span>
            <span class="grow" />
            <span class="pill" :class="leftCritical ? 'bad' : 'info'">
              <Icon name="zap" :size="11" /> {{ unanswered }} 题未答
            </span>
          </div>
          <div class="timer num" :class="{ danger }">{{ fmtClock(remain) }}</div>
          <div class="bar time-bar" :class="{ urgent: leftCritical }"><i :style="{ width: `${leftPct}%` }" /></div>
          <div class="micro faint time-sub">总时长 {{ Math.round(totalMs / 60000) }} 分钟 · 已答 <b class="num">{{ answeredCount }}</b>/<span class="num">{{ questions.length }}</span></div>
          <div class="row act-row">
            <n-button data-testid="exam-quit" size="small" quaternary @click="confirmAbandon"><Icon name="close" :size="14" /> 弃考</n-button>
            <span class="grow" />
            <n-button size="small" type="primary" @click="doSubmit()"><Icon name="check" :size="14" /> 交卷</n-button>
          </div>
          <div class="micro faint draft-hint"><Icon name="refresh" :size="12" /> 草稿每 0.4 秒自动保存，切题不丢</div>
        </div>

        <div class="card sheet-card">
          <div class="panel-head">
            <h3><Icon name="layers" :size="15" class="hd-ic" /> 答题卡</h3>
            <span class="grow" />
            <span class="micro faint num">{{ answeredCount }}/{{ questions.length }}</span>
          </div>
          <div class="answer-grid">
            <div v-for="(row, i) in questions" :key="row.id" class="answer-cell"
              :class="{ done: cellDone(row), cur: i === idx }" :title="`第 ${i + 1} 题`" @click="jump(i)">{{ i + 1 }}</div>
          </div>
          <div class="legend-box">
            <span class="lg"><i class="lg-cell cur" /> 当前题</span>
            <span class="lg"><i class="lg-cell done" /> 已作答</span>
            <span class="lg"><i class="lg-cell" /> 未作答</span>
          </div>
        </div>
      </aside>
    </div>
  </div>

  <!-- ===== 批改中 ===== -->
  <div v-else-if="phase === 'grading'" class="page">
    <div class="card grade-card">
      <div class="skeleton sk-line" style="width:34%;margin-inline:auto" />
      <div class="grade-pct num" :style="{ color: pctColor(progress.total ? Math.round(progress.done / progress.total * 100) : 0) }">
        {{ progress.total ? Math.round(progress.done / progress.total * 100) : 0 }}%
      </div>
      <div class="bar big grade-bar accent"><i :style="{ width: `${progress.total ? Math.round(progress.done / progress.total * 100) : 0}%` }" /></div>
      <div class="tiny faint"><Icon name="brain" :size="14" /> AI 正在逐题批改主观题：<b class="num">{{ progress.done }}</b>/<span class="num">{{ progress.total }}</span> 题完成</div>
      <div class="micro faint">客观题已即时判分，主观题走强模型按评分点给分</div>
      <div class="sk-stack">
        <div class="skeleton sk-line" style="width:88%" />
        <div class="skeleton sk-line" style="width:70%" />
        <div class="skeleton sk-block" style="height:64px;margin-top:10px" />
      </div>
    </div>
  </div>

  <!-- ===== 成绩复盘 ===== -->
  <div v-else-if="phase === 'report' && report" class="page">
    <div class="kpis">
      <div v-for="(k, ki) in kpiList" :key="k.k" class="kpi rise" :style="{ '--i': ki }">
        <div class="k">{{ k.k }}</div>
        <div class="v" :style="k.color ? { color: k.color } : undefined">{{ k.v }}</div>
        <div class="d">{{ k.d }}</div>
      </div>
    </div>

    <section class="card verdict-card rise" style="--i:2">
      <div class="panel-head">
        <h3><Icon name="trophy" :size="16" class="hd-ic" /> 综合评价</h3>
        <span class="grow" />
        <span class="pill" :class="report.pass ? 'ok' : 'bad'">
          <Icon :name="report.pass ? 'check' : 'close'" :size="12" /> {{ report.pass ? '过及格线' : '未过线' }}
        </span>
        <span class="pill" :style="{ background: softOf(pctColor(report.total), 12), color: pctColor(report.total), borderColor: lineOf(pctColor(report.total), 32) }">
          <span class="num">{{ report.total }}</span>/100
        </span>
      </div>
      <div v-if="report.band" class="band-line">{{ report.band }}</div>
      <div v-if="report.summary" class="md" v-html="renderMd(report.summary)" />
      <div v-if="report.selfEstDelta" class="fb warn">
        <div class="tiny"><Icon name="brain" :size="14" /> 自评 <b class="num">{{ report.selfEstDelta.self }}</b> vs AI <b class="num">{{ report.selfEstDelta.ai }}</b> —— {{ report.selfEstDelta.note }}</div>
      </div>
      <div class="row acts-row">
        <n-button @click="reset()"><Icon name="refresh" :size="14" /> 再来一卷</n-button>
        <n-button type="primary" @click="$router.push('/dashboard')"><Icon name="graph" :size="14" /> 看数据面板</n-button>
      </div>
    </section>

    <div class="grid g2">
      <section class="card rise" style="--i:3">
        <div class="panel-head">
          <h3><Icon name="target" :size="16" class="hd-ic" /> 最该补的节点</h3>
          <span class="grow" />
          <span class="micro faint">按失分比例排序</span>
        </div>
        <div v-for="w in report.weakNodes" :key="w.nodeId" class="kv">
          <div class="kv-main">
            <div class="ellip">{{ w.title }}</div>
            <div class="tiny muted clamp2">{{ w.advice }}</div>
          </div>
          <span class="pill" :class="w.lostPct >= 70 ? 'bad' : w.lostPct >= 40 ? 'warn' : 'info'"><span class="num">{{ w.lostPct }}</span>% 失分</span>
        </div>
        <div v-if="!report.weakNodes?.length" class="tiny faint">这张卷子没有明显短板节点。</div>
      </section>
      <section class="card rise" style="--i:4">
        <div class="panel-head">
          <h3><Icon name="filter" :size="16" class="hd-ic" /> 失分归因 Top</h3>
          <span class="grow" />
          <span class="micro faint">AI 归纳的错因</span>
        </div>
        <div v-for="a in report.attribution" :key="a.reason" class="kv">
          <div class="kv-main ellip">{{ a.reason }}</div>
          <span class="pill lock"><span class="num">{{ a.count }}</span> 题</span>
        </div>
        <div v-if="!report.attribution?.length" class="tiny faint">没有归纳出错因，通常意味着全对或全错得很分散。</div>
      </section>
    </div>

    <section class="card rise" style="--i:5">
      <div class="panel-head">
        <h3><Icon name="book" :size="16" class="hd-ic" /> 逐题明细</h3>
        <span class="grow" />
        <span class="desc">点开看 AI 的判定依据与漏掉的评分点</span>
      </div>
      <div class="q-list">
        <details v-for="d in detailRows" :key="d.qid" class="acc det">
          <summary>
            <span class="pill num" :class="d.pct >= 80 ? 'ok' : d.pct >= 50 ? 'warn' : 'bad'">{{ d.pct }}</span>
            <span v-if="d.type" class="pill" :class="typePillClass(d.type)"><Icon :name="TYPE_ICON_NAME[d.type] || 'book'" :size="11" /> {{ TYPE_LABEL[d.type] }}</span>
            <span class="qt">{{ d.i + 1 }}. {{ d.stem }}</span>
          </summary>
          <div class="acc-body">
            <div class="verdict">{{ d.verdict }}</div>
            <template v-if="d.awarded.length">
              <div class="section-title">逐评分点</div>
              <div v-for="(a, j) in d.awarded" :key="j" class="kv tiny">
                <div class="kv-main">{{ a.point }}<div class="muted">{{ a.why }}</div></div>
                <span class="pill" :class="Number(a.got) >= 70 ? 'ok' : Number(a.got) >= 40 ? 'warn' : 'bad'"><span class="num">{{ Math.round(Number(a.got) || 0) }}</span>%</span>
              </div>
            </template>
            <div v-if="d.missing.length" class="miss">漏：{{ d.missing.join('；') }}</div>
          </div>
        </details>
      </div>
    </section>
    <CelebrationModal />
  </div>
</template>

<style scoped>
.hd-ic { color: var(--text-faint) }
.w-full { width: 100% }
.fld { display: flex; flex-direction: column; gap: 3px; min-width: 0 }
.kv-main { flex: 1; min-width: 0 }
.rule { flex: 1 1 240px; min-width: 0; line-height: 1.5 }
.start-row { margin-top: var(--sp-3); align-items: center }

/* ---------- 模板卡（选中态明显） ---------- */
.tpl-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(228px, 1fr)); gap: var(--sp-3) }
.tpl-card { display: grid; gap: 6px; text-align: left; padding: var(--sp-3) var(--sp-4); border: 1px solid var(--border); border-radius: var(--r-lg); background: var(--surface); box-shadow: var(--sh-1); cursor: pointer; font: inherit; color: var(--text); min-width: 0; transition: border-color var(--dur) var(--ease-out), box-shadow var(--dur) var(--ease-out), transform var(--dur) var(--ease-out), background-color var(--dur-fast) }
.tpl-card:hover { border-color: color-mix(in oklab, var(--accent) 30%, var(--border)); box-shadow: var(--sh-2); transform: translateY(-2px) }
.tpl-card:active { transform: scale(.995) }
.tpl-card:focus-visible { box-shadow: var(--ring) }
.tpl-card.on { border-color: var(--accent); background: color-mix(in oklab, var(--accent) 7%, var(--surface)); box-shadow: var(--ring-soft) }
.tpl-top { display: flex; align-items: center; gap: 8px; min-width: 0 }
.tpl-title { flex: 1; min-width: 0; font-size: var(--fs-base); font-weight: 620 }
.tick { color: var(--accent-2); flex: 0 0 auto }
.tpl-kv { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: var(--fs-xs); color: var(--text-dim) }
.tpl-kv b { font-size: var(--fs-sm); color: var(--text) }

/* ---------- 计时恢复提示 ---------- */
.resume-bar { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap; margin: 0 }
.rb-ic { color: var(--warn); flex: 0 0 auto }
.rb-txt { flex: 1 1 260px; min-width: 0 }
.rb-acts { display: flex; gap: var(--sp-2); flex-wrap: wrap }

/* ---------- 左右分栏 ---------- */
.g-side { align-items: start }
.side-main, .side-aside { min-width: 0; gap: var(--sp-4) }
.qmeta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: var(--sp-3) }
.qmeta .grow { flex: 1; min-width: var(--sp-4) }
.qbody :deep(.stem) { font-size: var(--fs-md); line-height: var(--lh-loose); font-weight: 550; overflow-wrap: anywhere }
.qbody :deep(.grid), .qbody :deep(.row) { min-width: 0 }
.qbody :deep(.code-area), .qbody :deep(input) { max-width: 100% }
.nav-row { align-items: center }
.nav-row .grow { flex: 1; min-width: var(--sp-4) }
.conf-seg { flex: 0 0 auto }
.conf-hint { flex: 1 1 120px; min-width: 0 }

/* ---------- 计时卡 ---------- */
.clock-card { display: grid; gap: 10px }
.clock-row { align-items: center }
.timer { font-size: var(--fs-3xl); letter-spacing: .01em; line-height: 1.1 }
.time-bar { height: 8px }
.time-bar > i { background: linear-gradient(90deg, var(--accent), color-mix(in oklab, var(--purple) 55%, var(--accent))) }
.time-bar.urgent > i { background: linear-gradient(90deg, var(--bad), color-mix(in oklab, var(--bad) 55%, var(--hot))) }
.time-sub { display: flex; align-items: center; gap: 4px; flex-wrap: wrap }
.act-row { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap }
.act-row .grow { flex: 1; min-width: var(--sp-4) }
.draft-hint { display: inline-flex; align-items: center; gap: 5px }
.sheet-card { display: grid; gap: var(--sp-3) }
.legend-box { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: var(--fs-xs); color: var(--text-faint) }
.lg { display: inline-flex; align-items: center; gap: 5px }
.lg-cell { width: 14px; height: 14px; border-radius: var(--r-sm); border: 1px solid var(--border-2); background: var(--surface-2); flex: 0 0 auto }
.lg-cell.done { background: color-mix(in oklab, var(--accent) 22%, var(--surface)); border-color: var(--accent) }
.lg-cell.cur { box-shadow: var(--ring-soft); border-color: var(--accent) }

/* ---------- 批改中 ---------- */
.grade-card { display: grid; justify-items: center; gap: var(--sp-3); padding: var(--sp-8) var(--sp-5); text-align: center }
.grade-pct { font-size: var(--fs-3xl); font-weight: 700; letter-spacing: -.02em }
.grade-bar { width: min(460px, 100%) }
.bar.big { height: 9px }
.sk-stack { width: min(520px, 100%); margin-top: var(--sp-3) }

/* ---------- 复盘 ---------- */
.verdict-card { display: grid; gap: var(--sp-2) }
.band-line { font-size: var(--fs-md); font-weight: 620 }
.acts-row { margin-top: var(--sp-2); gap: var(--sp-2) }
.det summary { font-size: var(--fs-sm) }
.det .qt { flex: 1; min-width: 0 }
.det .pill { flex: 0 0 auto }
.verdict { font-size: var(--fs-base); line-height: var(--lh-loose); overflow-wrap: anywhere }
.miss { margin-top: var(--sp-2); font-size: var(--fs-sm); color: var(--bad); overflow-wrap: anywhere }

@media (max-width: 900px) {
  .timer { font-size: var(--fs-2xl) }
  .tpl-grid { grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)) }
  .conf-hint { flex-basis: 100% }
}
</style>
