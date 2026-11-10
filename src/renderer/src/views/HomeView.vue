<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useForgeStore } from '../store'
import QuestionBody from '../components/QuestionBody.vue'
import Icon from '../components/Icon.vue'
import type { QuestionRow } from '@shared/types'
import { DOMAIN_LABEL, TYPE_LABEL, message, renderMd, downloadText } from '../lib/ui'
import { ipc } from '../lib/ipc'

const store = useForgeStore()
const router = useRouter()
const plan = computed(() => store.plan)
const dash = computed(() => store.dash)

function goToday() { void router.push({ path: '/practice', query: { today: '1' } }) }
function goNode(id?: string) { void router.push({ path: '/graph', query: id ? { node: id } : {} }) }

/** 任务三列：图标 + 语义色 + 说明文案（文案要解释"为什么这批值得做"） */
const groups = computed(() => [
  {
    key: 'due', title: '到期复习', icon: 'clock', cls: 'bad' as const,
    desc: 'FSRS 判定今天到记忆临界点，逾期成本最高', list: plan.value?.due ?? [],
    emptyT: '今天没有到期的复习', emptyD: '说明前几天的巩固都按时完成了。想加快图谱推进，可以直接开始新题。'
  },
  {
    key: 'weak', title: '薄弱变体', icon: 'target', cls: 'warn' as const,
    desc: '换个问法再考一遍上次没答透的知识点', list: plan.value?.weakVariants ?? [],
    emptyT: '没有待攻克的薄弱点', emptyD: '最近的作答质量均衡，暂时没有需要换角度重考的题。'
  },
  {
    key: 'new', title: '新题推进', icon: 'sparkles', cls: 'info' as const,
    desc: '按考点权重与前置解锁顺序排好的新内容', list: plan.value?.newQuestions ?? [],
    emptyT: '新题已清空', emptyD: '今日配额已完成。去数据面板看看正确率趋势，或安排一次闭卷模拟。'
  }
])
const doneRatio = computed(() => Math.min(1, (plan.value?.doneToday ?? 0) / Math.max(1, plan.value?.totalPlanned ?? 1)))
const gapCount = computed(() => (dash.value ? Math.max(0, dash.value.totals.mustMaster - dash.value.totals.mustMasterLit) : 0))

// ---------- 摸底 ----------
const pl = reactive({
  open: false, domain: '', session: '', item: null as QuestionRow | null, hint: '',
  answer: null as any, scale4: null as number | null, finished: false, results: {} as Record<string, any>
})
async function loadResults() { pl.results = await ipc.placement.results() }
async function startPlacement(domain: string) {
  Object.assign(pl, { open: true, domain, answer: null, scale4: null, finished: false })
  const r = await ipc.placement.start(domain)
  pl.session = r.sessionId; pl.item = r.item; pl.hint = r.hint
}
async function submitPlacement() {
  if (!pl.item) return
  try {
    const r = await ipc.placement.submit(pl.session, pl.item.id, pl.answer)
    pl.scale4 = r.scale4
    if (r.finished) { pl.finished = true; await loadResults(); message.success('摸底完成，已给出建议起点') }
    else {
      const n = await ipc.placement.next(pl.session)
      pl.item = n.item; pl.hint = n.hint; pl.answer = null; pl.scale4 = null
      if (!n.item) { pl.finished = true; await loadResults() }
    }
  } catch (e: any) { message.error(String(e?.message ?? e)); pl.finished = true }
}
async function exportWeekly() {
  const r = await ipc.daily.exportWeekly()
  downloadText(`面试熔炉周报-${new Date().toISOString().slice(0, 10)}.md`, r.markdown)
  message.success(`已导出：${r.path}`)
}
onMounted(async () => { await store.boot(); await loadResults(); void store.loadDash() })

/** 摸底分数的语义色（token 化，深色主题同样成立） */
function scoreColor(pct: number): string {
  return pct >= 60 ? 'var(--ok)' : pct >= 30 ? 'var(--warn)' : 'var(--bad)'
}
const resultRows = computed(() => Object.values(pl.results) as any[])
</script>

<template>
  <div class="page page-narrow">
    <!-- ===== 今日总览 hero ===== -->
    <section class="hero rise" style="--i:0">
      <div class="ring-wrap" role="img" :aria-label="`今日完成 ${plan?.doneToday ?? 0} / ${plan?.totalPlanned ?? 0}`">
        <svg viewBox="0 0 100 100" class="ring">
          <circle class="ring-track" cx="50" cy="50" r="42" fill="none" stroke-width="9" />
          <circle
            class="ring-fill" cx="50" cy="50" r="42" fill="none" stroke-width="9"
            :stroke-dasharray="`${doneRatio * 264} 264`" transform="rotate(-90 50 50)"
          />
        </svg>
        <div class="ring-center">
          <b class="big">{{ plan?.doneToday ?? 0 }}</b>
          <small class="faint num">/ {{ plan?.totalPlanned ?? 0 }}</small>
        </div>
      </div>

      <div class="grow col">
        <h3 class="hero-title">
          今日任务清单
          <span v-if="plan?.streak" class="pill ok"><Icon name="flame" :size="12" /> 连续 {{ plan.streak }} 天</span>
        </h3>
        <div class="tiny muted" v-if="plan?.message">{{ plan.message }}</div>
        <div class="row tiny" style="margin-top:10px">
          <span class="pill bad"><Icon name="clock" :size="12" /> 到期复习 {{ plan?.due.length ?? 0 }}</span>
          <span class="pill warn"><Icon name="target" :size="12" /> 薄弱变体 {{ plan?.weakVariants.length ?? 0 }}</span>
          <span class="pill info"><Icon name="sparkles" :size="12" /> 新题 {{ plan?.newQuestions.length ?? 0 }}</span>
        </div>
      </div>

      <div class="acts">
        <n-button data-testid="home-start" type="primary" size="large" @click="goToday">
          <template #icon><Icon name="play" :size="15" /></template>
          开始今日队列
        </n-button>
        <n-button quaternary size="large" @click="exportWeekly">
          <template #icon><Icon name="download" :size="15" /></template>
          导出周报
        </n-button>
      </div>
    </section>

    <!-- ===== 硬基础红线（放在任务列表之前，因为它决定今天该先补哪一层） ===== -->
    <div v-if="gapCount > 0" class="fb bad rise" style="--i:1">
      <h4><Icon name="alert" :size="16" /> 硬基础红线未过：{{ gapCount }} 个必考基础考点还没点亮</h4>
      <div class="tiny muted">面试官一定会往下追问一层。跳过它们去刷框架难题，等于地基上盖楼。</div>
      <n-button size="small" style="margin-top:10px" @click="goNode()">
        <template #icon><Icon name="graph" :size="14" /></template>
        去图谱看缺口
      </n-button>
    </div>

    <!-- ===== 三类任务 ===== -->
    <div class="grid g3 tasks">
      <section v-for="(grp, i) in groups" :key="grp.key" class="card lift rise" :style="{ '--i': i + 2 }">
        <header class="panel-head">
          <h3><Icon :name="grp.icon" :size="16" class="hd-ic" /> {{ grp.title }}</h3>
          <span class="grow" />
          <span class="pill" :class="grp.cls">{{ grp.list.length }}</span>
        </header>
        <div class="micro faint grp-desc">{{ grp.desc }}</div>

        <div class="q-list scroll-area">
          <div v-for="row in grp.list.slice(0, 8)" :key="row.id" class="q-item" @click="goToday">
            <span class="pill lock">{{ TYPE_LABEL[row.type] }}</span>
            <span class="qt">{{ row.q?.stem }}</span>
            <span v-if="row.angle" class="pill purple">变体</span>
            <Icon name="chevron" :size="14" class="chev" />
          </div>
          <div v-if="!grp.list.length" class="empty">
            <span class="ic"><Icon name="check" :size="24" /></span>
            <div class="t">{{ grp.emptyT }}</div>
            <div class="d">{{ grp.emptyD }}</div>
          </div>
        </div>

        <footer class="card-foot">
          <button class="btn ghost" @click="goToday">
            进入练习 <Icon name="arrowRight" :size="14" />
          </button>
          <span class="micro faint" v-if="grp.list.length > 8">共 {{ grp.list.length }} 项，仅显示前 8</span>
        </footer>
      </section>
    </div>

    <!-- ===== 板块摸底 ===== -->
    <section class="card rise" style="--i:5">
      <header class="panel-head">
        <h3><Icon name="brain" :size="16" class="hd-ic" /> 板块摸底</h3>
        <span class="desc">自适应 8 题、AI 逐题判定四档掌握度，测完给出建议起点</span>
        <span class="grow" />
        <span class="micro faint">每块约 8 分钟</span>
      </header>
      <div class="grid g4">
        <div
          v-for="(label, key) in DOMAIN_LABEL" :key="key"
          class="stat clickable" role="button" tabindex="0"
          @click="startPlacement(key)" @keydown.enter="startPlacement(key)"
        >
          <div class="lbl">{{ label }}</div>
          <template v-if="pl.results[key]">
            <div class="val num" :style="{ color: scoreColor(pl.results[key].pct) }">
              {{ pl.results[key].pct }}<span class="val-sub">/100</span>
            </div>
            <div class="bar" style="margin-top:9px">
              <i :style="{ width: Math.min(100, pl.results[key].pct) + '%', background: scoreColor(pl.results[key].pct) }" />
            </div>
            <div class="foot">{{ pl.results[key].starts.length }} 个建议起点 · {{ (pl.results[key].at || '').slice(0, 10) }}</div>
          </template>
          <template v-else>
            <div class="val faint">未摸底</div>
            <div class="foot">点击开始 · 用于确定从哪个考点切入</div>
          </template>
        </div>
      </div>

      <template v-if="resultRows.length">
        <div class="section-title">历史摸底与建议起点</div>
        <div v-for="r in resultRows" :key="r.domain" class="kv">
          <div class="kv-main">
            <div class="kv-name">
              {{ r.domain }}
              <span class="pill" :style="{ color: scoreColor(r.pct), borderColor: `color-mix(in oklab, ${scoreColor(r.pct)} 32%, transparent)`, background: `color-mix(in oklab, ${scoreColor(r.pct)} 11%, transparent)` }">{{ r.pct }}%</span>
            </div>
            <div class="row micro" style="margin-top:6px;gap:6px">
              <button v-for="s in r.starts.slice(0, 6)" :key="s.id" class="chip" @click="goNode(s.id)">
                <Icon name="route" :size="12" /> {{ s.title }}
              </button>
            </div>
          </div>
          <span class="micro faint" style="white-space:nowrap">{{ (r.at || '').slice(0, 10) }}</span>
        </div>
      </template>
    </section>

    <!-- ===== 最近模拟面 ===== -->
    <section v-if="dash?.examHistory?.length" class="card rise" style="--i:6">
      <header class="panel-head">
        <h3><Icon name="trophy" :size="16" class="hd-ic" /> 最近的模拟面</h3>
        <span class="grow" />
        <n-button size="tiny" quaternary @click="() => router.push('/exam')">全部记录<Icon name="chevron" :size="13" /></n-button>
      </header>
      <div v-for="e in dash.examHistory.slice(0, 6)" :key="e.id" class="kv clickable-row" @click="() => router.push('/exam')">
        <span class="ellip" style="flex:1;min-width:0">{{ e.title }}</span>
        <span class="micro faint" style="white-space:nowrap">{{ e.submitted_at?.slice(5, 16).replace('T', ' ') }}</span>
        <span class="pill" :class="e.pass ? 'ok' : 'bad'">{{ e.total }} 分</span>
      </div>
    </section>

    <!-- ===== 摸底弹窗 ===== -->
    <n-modal v-model:show="pl.open" preset="card" :title="`摸底 · ${DOMAIN_LABEL[pl.domain] ?? ''}`" style="width:760px;max-width:94vw;border-radius:var(--r-xl)">
      <div class="row tiny muted" style="margin-bottom:14px">
        <Icon name="sparkles" :size="14" /> {{ pl.hint }}
      </div>
      <template v-if="pl.item?.q && !pl.finished">
        <QuestionBody :q="pl.item.q!" v-model="pl.answer" :revealed="pl.scale4 != null" :show-reference="true" />
        <div v-if="pl.scale4 != null" class="fb" :class="pl.scale4 >= 2 ? 'ok' : 'warn'">
          <div class="tiny">
            本题判定：四档 {{ pl.scale4 }}（{{ ['完全不会', '提示后会', '独立说清', '能举证'][pl.scale4] }}）——
            下一题难度将{{ pl.scale4 >= 2 ? '上调' : '下调' }}
          </div>
        </div>
      </template>
      <div v-else-if="pl.finished" class="finish-box">
        <Icon name="check" :size="30" class="ok-ic" />
        <div style="font-size:var(--fs-md);font-weight:600;margin-top:8px">摸底结束</div>
        <div class="tiny muted" style="margin-top:4px">已按你的表现给出建议起点节点，回到本页下方「历史摸底」可查看。</div>
      </div>
      <n-empty v-else description="这个板块题库不足，先去设置里补几道" />
      <template #footer>
        <div class="row">
          <n-button v-if="!pl.finished && pl.item" type="primary" @click="submitPlacement">
            {{ pl.scale4 == null ? '提交本题' : '下一题 →' }}
          </n-button>
          <n-button quaternary @click="pl.open = false">{{ pl.finished ? '完成' : '中途退出' }}</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
/* ---- hero ---- */
.hero { align-items: center }
.hero-title { display: flex; align-items: center; gap: 10px; font-size: var(--fs-lg) }
.ring-wrap { position: relative; width: 104px; height: 104px; flex: 0 0 104px }
.ring { width: 104px; height: 104px }
.ring-center { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; line-height: 1.15 }
.ring-center .big { font-size: var(--fs-xl) }
.ring-center small { font-size: var(--fs-xs) }
.acts { display: flex; align-items: center; gap: 10px; flex-wrap: wrap }
@media (max-width: 860px) { .ring-wrap { width: 84px; height: 84px; flex-basis: 84px } .ring { width: 84px; height: 84px } }

/* ---- 任务三列：等高 + 内部滚动，避免长题干把某一列撑爆 ---- */
.tasks { align-items: stretch }
/* 卡片改成纵向 flex：列表区自己滚（min-height:0 是关键，否则 flex item 不肯收缩），
   footer 永远贴在卡片底部。之前 footer 与 .q-list 尾部在 1440×900 下重叠，机检抓到过。 */
.tasks > .card { display: flex; flex-direction: column }
.tasks > .card > .panel-head { flex: 0 0 auto }
.tasks .hd-ic { color: var(--text-faint) }
.grp-desc { margin: -6px 0 10px; line-height: 1.5 }
.scroll-area { flex: 1 1 auto; min-height: 0; max-height: 330px; overflow: auto; margin-right: -6px; padding-right: 6px }
.card-foot { flex: 0 0 auto; margin-top: auto; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-top: 10px; border-top: 1px solid var(--border) }
.chev { color: var(--text-faint); opacity: 0; transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out) }
.q-item:hover .chev { opacity: 1; transform: translateX(2px) }
.empty { padding: 26px 10px }
.empty .ic { color: var(--ok) }

/* ---- 摸底 ---- */
.val-sub { font-size: var(--fs-sm); color: var(--text-faint); font-weight: 500; margin-left: 2px }
.stat.clickable:focus-visible { box-shadow: var(--ring) }
.kv-main { flex: 1; min-width: 0 }
.kv-name { display: flex; align-items: center; gap: 8px; font-size: var(--fs-base) }
.chip {
  display: inline-flex; align-items: center; gap: 5px; max-width: 220px;
  padding: 3px 9px; border-radius: var(--r-pill); border: 1px solid var(--border);
  background: var(--surface-2); color: var(--text-dim); font: inherit; font-size: var(--fs-xs);
  cursor: pointer; transition: border-color var(--dur-fast), color var(--dur-fast), background-color var(--dur-fast);
}
.chip span, .chip svg { flex: 0 0 auto }
.chip:hover { border-color: color-mix(in oklab, var(--accent) 45%, var(--border)); color: var(--accent-2); background: color-mix(in oklab, var(--accent) 8%, var(--surface)) }

/* ---- 历史 ---- */
.clickable-row { cursor: pointer; border-radius: var(--r-sm); transition: background-color var(--dur-fast) }
.clickable-row:hover { background: color-mix(in oklab, var(--accent) 5%, transparent) }
.finish-box { display: grid; place-content: center; justify-items: center; text-align: center; padding: 34px 10px }
.ok-ic { color: var(--ok) }
</style>
