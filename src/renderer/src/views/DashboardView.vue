<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useForgeStore } from '../store'
import Icon from '../components/Icon.vue'
import { DOMAIN_LABEL, TYPE_LABEL, TYPE_ICON_NAME, SCALE_LABEL, scale4Color, pctColor, softOf, lineOf, downloadText, toast, fmtAgo } from '../lib/ui'
import { renderMd } from '../lib/ui'
import { ipc } from '../lib/ipc'

const store = useForgeStore()
const router = useRouter()
const dash = computed(() => store.dash)
const wrong = ref<any[]>([])
const byTask = ref<any[]>([])

async function load() {
  await store.boot()
  await store.loadDash()
  wrong.value = await ipc.dashboard.wrongNotes(80)
  byTask.value = await ipc.ai.byTask(30)
}

// ---- 雷达图 ----
const radar = computed(() => {
  const list = dash.value?.mastery ?? []
  const cx = 165, cy = 158, R = 108, n = Math.max(3, list.length)
  const pt = (i: number, ratio: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n
    return [cx + Math.cos(a) * R * ratio, cy + Math.sin(a) * R * ratio]
  }
  const rings = [0.25, 0.5, 0.75, 1].map((r) => Array.from({ length: n }, (_, i) => pt(i, r).join(',')).join(' '))
  const poly = list.map((m, i) => pt(i, Math.min(1, m.total ? m.lit / m.total : 0)).join(',')).join(' ')
  const labels = list.map((m, i) => {
    const [x, y] = pt(i, 1.2)
    return { x, y, text: `${m.title} ${m.lit}/${m.total}`, anchor: x < cx - 8 ? 'end' : x > cx + 8 ? 'start' : 'middle' }
  })
  return { cx, cy, R, rings, poly, labels, list }
})

// ---- 趋势折线 ----
const trend = computed(() => {
  const rows = dash.value?.accuracyTrend ?? []
  const W = 720, H = 190, P = 34
  if (rows.length < 2) return { path: '', dots: [], W, H, grid: [0, 25, 50, 75, 100].map((v) => ({ v, y: H - P - ((H - 2 * P) * v) / 100 })), labels: [], empty: true }
  const xs = (i: number) => P + (i * (W - 2 * P)) / (rows.length - 1)
  const ys = (v: number) => H - P - ((H - 2 * P) * Math.min(100, Math.max(0, v))) / 100
  const path = rows.map((r, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(r.avgPct).toFixed(1)}`).join(' ')
  const area = `${path} L${xs(rows.length - 1).toFixed(1)},${H - P} L${xs(0).toFixed(1)},${H - P} Z`
  return {
    path, area, W, H, empty: false,
    dots: rows.map((r, i) => ({ x: xs(i), y: ys(r.avgPct), day: r.day, pct: r.avgPct, n: r.answered })),
    grid: [0, 25, 50, 75, 100].map((v) => ({ v, y: ys(v) })),
    labels: rows.filter((_, i) => i % Math.ceil(rows.length / 6) === 0).map((r) => ({ x: xs(rows.indexOf(r)), text: r.day.slice(5) }))
  }
})

const bandMid = computed(() => ((dash.value?.interviewBand.low ?? 0) + (dash.value?.interviewBand.high ?? 0)) / 2)
const mustGap = computed(() => Math.max(0, (dash.value?.totals.mustMaster ?? 0) - (dash.value?.totals.mustMasterLit ?? 0)))

/** 错题详情里的题干+选项+易漏点渲染 */
function renderQ(q: any): string {
  if (!q) return ''
  const opts = (q.options ?? []).map((o: any) => `- ${o.key}. ${o.text}`).join('\n')
  return renderMd([q.stem, opts, q.gapCheck?.length ? `**易漏点**：${q.gapCheck.join('；')}` : ''].filter(Boolean).join('\n\n'))
}

function exportWrongBook() {
  const lines = ['# 我的错题本', `> 导出于 ${new Date().toLocaleString('zh-CN')} · 共 ${wrong.value.length} 题`, '']
  for (const w of wrong.value) {
    lines.push(`## ${w.stem}`.slice(0, 120), `- 节点：${w.nodeTitle ?? w.node_id}｜题型：${TYPE_LABEL[w.type]}｜做过 ${w.times} 次，最好 ${Math.round(w.worst)} 分，最近 ${fmtAgo(w.lastAt)}`)
    const opts = (w.q?.options ?? []).map((o: any) => `${o.key}. ${o.text}`).join('\n  ')
    if (opts) lines.push(`- 选项：\n  ${opts}`)
    lines.push(`- 答案：${JSON.stringify(w.q?.answer ?? {})}${w.q?.analysis ? `\n- 解析：${String(w.q.analysis).replace(/\n+/g, ' ')}` : ''}`, '')
  }
  downloadText(`错题本-${new Date().toISOString().slice(0, 10)}.md`, lines.join('\n'))
  toast.ok(`已导出 ${wrong.value.length} 道错题`)
}
function goPractice(nodeId?: string) { void router.push({ path: '/practice', query: nodeId ? { node: nodeId } : {} }) }
onMounted(load)
// KeepAlive：切回本页时重新拉，保证刚答完的题立刻反映到图表上
onActivated(load)
</script>

<template>
  <div class="page page-narrow">
    <!-- ===== 核心指标：一卡一指标 ===== -->
    <div class="kpis">
      <div class="stat rise" style="--i:0">
        <div class="lbl"><Icon name="target" :size="13" /> 掌握程度预估</div>
        <div class="val num" :style="{ color: pctColor(bandMid) }">{{ dash?.interviewBand.low }}–{{ dash?.interviewBand.high }}</div>
        <div class="foot ellip" :title="dash?.interviewBand.note">{{ dash?.interviewBand.note }}</div>
      </div>
      <div class="stat rise clickable" style="--i:1" role="button" tabindex="0" @click="() => router.push('/graph')" @keydown.enter="() => router.push('/graph')">
        <div class="lbl"><Icon name="graph" :size="13" /> 图谱点亮</div>
        <div class="val num">{{ dash?.totals.litNodes }}<span class="val-sub">/{{ dash?.totals.nodes }}</span></div>
        <div class="bar" style="margin-top:8px"><i :style="{ width: ((dash?.totals.litNodes ?? 0) / Math.max(1, dash?.totals.nodes ?? 1) * 100) + '%' }" /></div>
        <div class="foot">基础考点缺口 <b :style="{ color: mustGap ? 'var(--bad)' : 'var(--ok)' }">{{ mustGap }}</b></div>
      </div>
      <div class="stat rise clickable" style="--i:2" role="button" tabindex="0" @click="() => router.push('/')" @keydown.enter="() => router.push('/')">
        <div class="lbl"><Icon name="clock" :size="13" /> 今日到期</div>
        <div class="val num" style="color:var(--warn)">{{ dash?.dueNow }}</div>
        <div class="foot">连续打卡 {{ dash?.streak }} 天</div>
      </div>
      <div class="stat rise clickable" style="--i:3" role="button" tabindex="0" @click="() => router.push('/bank')" @keydown.enter="() => router.push('/bank')">
        <div class="lbl"><Icon name="folder" :size="13" /> 题库规模</div>
        <div class="val num">{{ dash?.totals.questions }}</div>
        <div class="foot">考点 {{ dash?.totals.nodes }} 个</div>
      </div>
    </div>

    <!-- ===== 掌握四态：点亮只是「做过」，这张卡回答「到底学会没、有没有忘」 ===== -->
    <section v-if="dash?.stateDist" class="card rise" style="--i:3.5">
      <header class="panel-head">
        <h3><Icon name="graph" :size="16" class="hd-ic" /> 考点掌握分布</h3>
        <span class="grow" />
        <span class="micro faint">近 30 天新掌握 <b style="color:var(--ok)">{{ dash.stateDist.recentlyMastered }}</b> 个</span>
      </header>
      <div class="mastery-bar" role="img" :aria-label="`未接触 ${dash.stateDist.untouched}，学习中 ${dash.stateDist.learning}，已掌握 ${dash.stateDist.mastered}，已生疏 ${dash.stateDist.stale}`">
        <i class="mb-untouched" :style="{ flex: dash.stateDist.untouched || 0.001 }" :title="`未接触 ${dash.stateDist.untouched}`" />
        <i class="mb-learning" :style="{ flex: dash.stateDist.learning || 0.001 }" :title="`学习中 ${dash.stateDist.learning}`" />
        <i class="mb-mastered" :style="{ flex: dash.stateDist.mastered || 0.001 }" :title="`已掌握 ${dash.stateDist.mastered}`" />
        <i class="mb-stale" :style="{ flex: dash.stateDist.stale || 0.001 }" :title="`已生疏 ${dash.stateDist.stale}`" />
      </div>
      <div class="mastery-legend">
        <span><i class="dot mb-untouched" />未接触 {{ dash.stateDist.untouched }}</span>
        <span><i class="dot mb-learning" />学习中 {{ dash.stateDist.learning }}</span>
        <span><i class="dot mb-mastered" />已掌握 {{ dash.stateDist.mastered }}</span>
        <span><i class="dot mb-stale" />已生疏 ↺ {{ dash.stateDist.stale }}</span>
        <span v-if="dash.stateDist.stale" class="stale-warn">有 {{ dash.stateDist.stale }} 个考点已降回队列，其中基础考点 {{ dash.stateDist.mustStale }} 个，建议优先复习</span>
      </div>
    </section>

    <!-- ===== 两张图 ===== -->
    <div class="grid g2 stretch">
      <section class="card rise" style="--i:4">
        <header class="panel-head">
          <h3><Icon name="graph" :size="16" class="hd-ic" /> 各板块掌握度</h3>
          <span class="desc">外圈 = 该板块全部 level4 考点都点亮</span>
          <span class="grow" />
        </header>
        <svg viewBox="0 0 330 320" class="chart-radar" role="img" aria-label="各板块考点点亮比例雷达图">
          <polygon v-for="(r, i) in radar.rings" :key="i" :points="r" class="spark-track" fill="none" stroke-width="1" />
          <line v-for="(l, i) in radar.labels" :key="'a' + i" :x1="radar.cx" :y1="radar.cy" :x2="Number(l.x)" :y2="Number(l.y)" class="c-grid" />
          <polygon :points="radar.poly" class="f-accent c-accent" stroke-width="2" />
          <text v-for="(l, i) in radar.labels" :key="l.text" :x="l.x" :y="l.y" :text-anchor="l.anchor" class="c-label" font-size="11">{{ l.text }}</text>
        </svg>
      </section>

      <section class="card rise" style="--i:5">
        <header class="panel-head">
          <h3><Icon name="chart" :size="16" class="hd-ic" /> 近 30 天正确率与做题量</h3>
          <span class="grow" />
          <span class="micro faint">每天一个点 · 悬停看当日明细</span>
        </header>
        <svg :viewBox="`0 0 ${trend.W} ${trend.H}`" class="chart" role="img" aria-label="近 30 天平均正确率折线">
          <line v-for="g in trend.grid" :key="g.v" x1="34" :y1="g.y" :x2="trend.W - 34" :y2="g.y" class="c-grid" />
          <text v-for="g in trend.grid" :key="'t' + g.v" x="8" :y="g.y + 4" class="c-tick">{{ g.v }}</text>
          <path v-if="!trend.empty" :d="trend.area" class="f-ok" />
          <path v-if="!trend.empty" :d="trend.path" class="c-line c-ok" />
          <circle v-for="d in trend.dots" :key="d.day" :cx="d.x" :cy="d.y" r="3" class="c-dot" :style="{ fill: d.pct >= 60 ? 'var(--ok)' : 'var(--warn)' }">
            <title>{{ d.day }} · {{ d.n }} 题 · 均分 {{ d.pct }}</title>
          </circle>
          <text v-for="l in trend.labels" :key="l.text" :x="l.x" :y="trend.H - 10" class="c-tick" text-anchor="middle">{{ l.text }}</text>
          <text v-if="trend.empty" x="360" y="95" class="c-empty">至少做两天题才有趋势</text>
        </svg>
      </section>
    </div>

    <!-- ===== 题型短板 + AI 用量 ===== -->
    <div class="grid g2 stretch">
      <section class="card rise" style="--i:6">
        <header class="panel-head">
          <h3><Icon name="filter" :size="16" class="hd-ic" /> 最弱题型</h3>
          <span class="desc">按历史平均分升序</span>
          <span class="grow" />
        </header>
        <div v-for="t in dash?.typeStats ?? []" :key="t.type" class="kv">
          <span class="type-name"><Icon :name="TYPE_ICON_NAME[t.type] ?? 'book'" :size="14" /> {{ TYPE_LABEL[t.type] ?? t.type }}</span>
          <div class="bar grow"><i :style="{ width: t.avgPct + '%', background: pctColor(t.avgPct) }" /></div>
          <span class="tiny num" style="min-width:38px;text-align:right" :style="{ color: pctColor(t.avgPct) }">{{ t.avgPct }}%</span>
          <span class="tiny faint num" style="min-width:52px;text-align:right">{{ t.answered }} 次</span>
        </div>

        <div class="section-title">AI 任务用量（30 天）</div>
        <div v-for="t in byTask" :key="t.task" class="kv tiny">
          <span class="grow ellip">{{ t.task }}</span>
          <span class="faint num">{{ t.calls }} 次 · {{ t.tokens }} tokens · {{ (t.ms / 1000).toFixed(0) }}s</span>
          <span v-if="t.fails" class="pill bad">{{ t.fails }} 失败</span>
        </div>
        <div v-if="!byTask.length" class="empty">
          <span class="ic"><Icon name="brain" :size="22" /></span>
          <div class="t">还没有 AI 调用记录</div>
          <div class="d">批改一次主观题后，这里会统计每个任务的次数、token 与耗时。</div>
        </div>
      </section>

      <section class="card rise" style="--i:7">
        <header class="panel-head">
          <h3><Icon name="target" :size="16" class="hd-ic" /> 高频错题 Top</h3>
          <span class="desc">做过两次以上且平均分低于 60，反复错的才值得盯</span>
          <span class="grow" />
        </header>
        <div class="q-list">
          <div v-for="w in dash?.topWrong ?? []" :key="w.qid" class="q-item" @click="goPractice()">
            <span class="pill bad">均 {{ Math.round(w.avgPct) }}</span>
            <span class="qt">
              {{ w.stem }}
              <span class="tiny faint block">{{ w.nodeTitle }} · 做过 {{ w.times }} 次</span>
            </span>
            <Icon name="chevron" :size="14" class="chev" />
          </div>
          <div v-if="!dash?.topWrong?.length" class="empty">
            <span class="ic"><Icon name="check" :size="24" /></span>
            <div class="t">还没有稳定的错题模式</div>
            <div class="d">同一道题做过两次以上、平均分低于 60 才会进入这里。先去练习几轮。</div>
            <div class="cta"><button class="btn primary" @click="goPractice()"><Icon name="play" :size="14" /> 开始练习</button></div>
          </div>
        </div>
      </section>
    </div>

    <!-- ===== 错题本全量 ===== -->
    <section class="card rise" style="--i:8">
      <header class="panel-head">
        <h3><Icon name="book" :size="16" class="hd-ic" /> 错题本全量<span class="count-chip num">{{ wrong.length }}</span></h3>
        <span class="desc">点开看题干、选项与解析；考前扫一遍</span>
        <span class="grow" />
        <button class="btn" @click="exportWrongBook"><Icon name="download" :size="14" /> 导出 Markdown</button>
      </header>
      <div v-if="!wrong.length" class="empty">
        <span class="ic"><Icon name="trophy" :size="26" /></span>
        <div class="t">错题本是空的</div>
        <div class="d">做过的题只要没拿到满分就会自动归到这里。今天先去练一组吧。</div>
        <div class="cta"><button class="btn primary" @click="goPractice()"><Icon name="play" :size="14" /> 去练习</button></div>
      </div>
      <details v-for="w in wrong.slice(0, 40)" :key="w.id" class="acc">
        <summary>
          <span class="pill" :class="w.avgScore >= 40 ? 'warn' : 'bad'">最好 {{ Math.round(w.worst) }}</span>
          <span class="sum-title ellip">{{ w.stem }}</span>
          <span class="micro faint sum-meta">{{ w.nodeTitle }} · {{ w.times }} 次 · {{ fmtAgo(w.lastAt) }}</span>
        </summary>
        <div class="acc-body">
          <div class="md tiny" v-html="renderQ(w.q)" />
          <div v-if="w.q?.analysis" class="fb"><b>解析：</b>{{ w.q.analysis }}</div>
          <div class="row" style="margin-top:12px">
            <button class="btn primary" @click="goPractice(w.node_id)"><Icon name="play" :size="14" /> 只练这个考点</button>
            <span class="tiny muted">当前档位：{{ SCALE_LABEL[Math.min(3, Math.max(0, Math.round((w.avgScore / 100) * 3)))] }}</span>
            <span class="grow" />
            <span class="pill purple" :style="{ color: scale4Color(w.avgScore / 100 * 3), background: softOf(scale4Color(w.avgScore / 100 * 3)), borderColor: lineOf(scale4Color(w.avgScore / 100 * 3)) }">
              {{ DOMAIN_LABEL[(w as any).domain] ?? '未分类' }}
            </span>
          </div>
        </div>
      </details>
    </section>
  </div>
</template>

<style scoped>
.hd-ic { color: var(--text-faint) }
.val-sub { font-size: var(--fs-sm); color: var(--text-faint); font-weight: 500; margin-left: 2px }
.stat.clickable { cursor: pointer }
.stat .lbl { display: flex; align-items: center; gap: 5px }
.stat .lbl svg { color: var(--text-faint) }
.count-chip { display: inline-grid; place-content: center; min-width: 22px; height: 20px; padding: 0 6px; margin-left: 6px; border-radius: var(--r-pill); background: var(--surface-2); border: 1px solid var(--border); color: var(--text-dim); font-size: var(--fs-xs); font-weight: 620 }
.type-name { display: flex; align-items: center; gap: 6px; min-width: 74px; color: var(--text-dim) }
.type-name svg { color: var(--text-faint) }
.bar.grow { flex: 1; min-width: 60px }
.block { display: block; margin-top: 2px }
.chev { color: var(--text-faint); opacity: 0; transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out) }
.q-item:hover .chev { opacity: 1; transform: translateX(2px) }
.sum-title { flex: 1; min-width: 0 }
.sum-meta { white-space: nowrap; flex: 0 0 auto }
@media (max-width: 900px) { .sum-meta { display: none } }
.acc-body .fb { margin-top: 10px }
/* 掌握四态堆叠条：与图谱节点同一套语义色，用户在两处看到的颜色含义完全一致 */
.mastery-bar { display: flex; height: 14px; border-radius: var(--r-pill); overflow: hidden; background: var(--surface-3); margin: 12px 0 10px }
.mastery-bar i { display: block; height: 100% }
.mb-untouched { background: var(--text-faint); opacity: .55 }
.mb-learning { background: var(--warn) }
.mb-mastered { background: var(--ok) }
.mb-stale { background: var(--hot) }
.mastery-legend { display: flex; flex-wrap: wrap; gap: 14px; font-size: var(--fs-xs); color: var(--text-dim) }
.mastery-legend .dot { display: inline-block; width: 9px; height: 9px; border-radius: var(--r-sm); margin-right: 5px; vertical-align: -1px }
.mastery-legend .stale-warn { color: var(--hot); font-weight: 600 }
</style>
