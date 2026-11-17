<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '../components/Icon.vue'
import { DOMAIN_LABEL, TYPE_LABEL, TYPE_ICON_NAME, toast, dialog, renderMd, fmtAgo, typePillClass } from '../lib/ui'
import { ipc } from '../lib/ipc'

/**
 * 错题本（R9-⑥）：实时视图，基于 attempts 动态计算——新答错的题自动出现。
 * 移除/清空只是视图层屏蔽（写 settings 隐藏标记），不删原始作答历史。
 */
const router = useRouter()
const rows = ref<any[]>([])
const loading = ref(false)
const domain = ref<string | null>(null)
const onlyUnmastered = ref(false)
const detail = ref<any | null>(null)
const detailBusy = ref(false)

const domainOpts = computed(() => [
  { value: 'fe', label: DOMAIN_LABEL.fe },
  { value: 'ai', label: DOMAIN_LABEL.ai },
  { value: 'be', label: DOMAIN_LABEL.be },
  { value: 'cs', label: DOMAIN_LABEL.cs },
  { value: 'eng', label: DOMAIN_LABEL.eng }
])
const stats = computed(() => ({
  total: rows.value.length,
  unmastered: rows.value.filter((r) => !r.lit).length,
  hot: rows.value.filter((r) => r.wrongTimes >= 2).length
}))

async function load() {
  loading.value = true
  try {
    const list = await ipc.mistakes.list({
      domain: domain.value ?? undefined,
      onlyUnmastered: onlyUnmastered.value,
      limit: 200
    })
    rows.value = Array.isArray(list) ? list : []
  } catch (e: any) {
    toast.err(String(e?.message ?? e))
    rows.value = []
  } finally {
    loading.value = false
  }
}

async function openDetail(r: any) {
  detail.value = { ...r, history: [], q: null }
  detailBusy.value = true
  try {
    const d = await ipc.mistakes.detail(r.qid)
    detail.value = { ...r, ...d, q: d?.q ?? r.q ?? null, history: d?.history ?? [] }
  } catch (e: any) {
    toast.err(String(e?.message ?? e))
  } finally {
    detailBusy.value = false
  }
}

function remove(r: any) {
  dialog.warning({
    title: '从错题本移除？',
    content: `只是不再在错题本里显示「${(r.stem ?? '').slice(0, 40)}…」，原始作答记录仍保留，之后再答错会重新出现。`,
    positiveText: '移除',
    negativeText: '取消',
    type: 'info',
    onPositiveClick: async () => {
      await ipc.mistakes.remove(r.qid)
      toast.ok('已从错题本移除')
      await load()
      if (detail.value?.qid === r.qid) detail.value = null
    }
  })
}

function clearAll() {
  if (!rows.value.length) return
  dialog.warning({
    title: '清空当前筛选下的错题？',
    content: `将屏蔽 ${rows.value.length} 道题的错题本显示（不删历史，重新答错会再出现）。${domain.value ? `仅影响「${DOMAIN_LABEL[domain.value] ?? domain.value}」板块。` : '影响全部板块。'}`,
    positiveText: '清空',
    negativeText: '取消',
    type: 'error',
    onPositiveClick: async () => {
      await ipc.mistakes.clear(domain.value ?? undefined)
      toast.ok('已清空')
      await load()
    }
  })
}

function practiceNode(r: any) {
  if (r.node_id) void router.push({ path: '/practice', query: { node: r.node_id } })
}
function scoreColor(pct: number) {
  return pct >= 60 ? 'var(--ok)' : pct >= 30 ? 'var(--warn)' : 'var(--bad)'
}

onMounted(load)
onActivated(load)
</script>

<template>
  <div class="page page-narrow">
    <header class="page-head">
      <div class="grow col">
        <h1><Icon name="alert" :size="20" class="hd-ic" /> 错题本</h1>
        <p>实时汇总所有答错（四档 ≤1）的题；重新答错会自动出现，掌握后可在这里标记不再提示。原始作答历史不会被删除。</p>
      </div>
      <n-button quaternary :loading="loading" @click="load"><Icon name="refresh" :size="15" /> 刷新</n-button>
      <n-button type="error" secondary :disabled="!rows.length" @click="clearAll"><Icon name="close" :size="15" /> 清空</n-button>
    </header>

    <!-- 统计 KPI -->
    <div class="kpis wb-kpis">
      <div class="kpi"><div class="k">错题总数</div><div class="v num">{{ stats.total }}</div><div class="d">当前筛选</div></div>
      <div class="kpi"><div class="k">尚未掌握</div><div class="v num" :style="{ color: 'var(--bad)' }">{{ stats.unmastered }}</div><div class="d">考点未点亮</div></div>
      <div class="kpi"><div class="k">反复错</div><div class="v num" :style="{ color: 'var(--warn)' }">{{ stats.hot }}</div><div class="d">错 ≥2 次，优先攻克</div></div>
    </div>

    <!-- 筛选条 -->
    <div class="wb-filters card">
      <n-select :value="domain" :options="domainOpts" size="small" clearable placeholder="全部板块"
        style="width:170px" @update:value="(v: any) => { domain = v ?? null; load() }" />
      <label class="wb-sw">
        <n-switch :value="onlyUnmastered" size="small" @update:value="(v: boolean) => { onlyUnmastered = v; load() }" />
        <span class="tiny">只看尚未掌握</span>
      </label>
      <span class="grow" />
      <span class="micro faint">点题卡看历次作答与解析</span>
    </div>

    <!-- 错题列表 -->
    <div v-if="loading" class="card sk-card">
      <div class="skeleton sk-line" style="width:60%" />
      <div class="skeleton sk-line" style="width:90%;margin-top:10px" />
      <div class="skeleton sk-line" style="width:75%;margin-top:10px" />
    </div>

    <div v-else-if="rows.length" class="wb-list">
      <article v-for="r in rows" :key="r.qid" class="card wb-item" :class="{ hot: r.wrongTimes >= 2 }">
        <div class="wb-item-main" @click="openDetail(r)">
          <div class="wb-tags">
            <span class="pill" :class="typePillClass(r.type)"><Icon :name="TYPE_ICON_NAME[r.type] || 'book'" :size="12" /> {{ TYPE_LABEL[r.type] ?? r.type }}</span>
            <span v-if="!r.lit" class="pill bad">未掌握</span>
            <span v-else class="pill ok">考点已点亮</span>
            <span v-if="r.wrongTimes >= 2" class="pill warn">错 {{ r.wrongTimes }} 次</span>
            <span class="wb-node ellip" :title="r.nodeTitle">{{ r.nodeTitle }}</span>
          </div>
          <h3 class="wb-stem">{{ r.stem }}</h3>
          <div class="wb-meta tiny faint">
            <span>作答 {{ r.times }} 次</span>
            <span>最差 <b class="num" :style="{ color: scoreColor(r.worst) }">{{ Math.round(r.worst) }}</b></span>
            <span>均分 <b class="num" :style="{ color: scoreColor(r.avgScore) }">{{ Math.round(r.avgScore) }}</b></span>
            <span>· {{ fmtAgo(r.lastAt) }}</span>
          </div>
        </div>
        <div class="wb-item-acts">
          <n-button size="small" type="primary" secondary @click="practiceNode(r)"><Icon name="pen" :size="14" /> 练这个考点</n-button>
          <n-button size="small" quaternary @click="openDetail(r)"><Icon name="book" :size="14" /> 详情</n-button>
          <n-button size="small" quaternary @click="remove(r)"><Icon name="close" :size="14" /> 移除</n-button>
        </div>
      </article>
    </div>

    <div v-else class="empty card">
      <span class="ic"><Icon name="check" :size="26" /></span>
      <span class="t">当前没有错题</span>
      <span class="d">答错的题会自动收进这里。去练习模式做几组题吧。</span>
    </div>

    <!-- 详情抽屉（复用右侧抽屉形态） -->
    <aside v-if="detail" class="wb-drawer" @click.self="detail = null">
      <div class="wb-drawer-inner">
        <header class="panel-head">
          <h3 class="ellip">错题详情</h3>
          <span class="grow" />
          <button class="icon-btn" aria-label="关闭" @click="detail = null"><Icon name="close" :size="16" /></button>
        </header>

        <div v-if="detailBusy" class="tiny faint" style="padding:30px 0;text-align:center">载入历次作答…</div>
        <template v-else>
          <div class="wb-tags" style="margin-bottom:10px">
            <span class="pill" :class="typePillClass(detail.type)">{{ TYPE_LABEL[detail.type] ?? detail.type }}</span>
            <span class="wb-node ellip">{{ detail.nodeTitle }}</span>
          </div>
          <h4 class="wb-detail-stem">{{ detail.stem }}</h4>

          <div class="section-title">参考答案与解析</div>
          <div v-if="detail.q?.analysis" class="md" v-html="renderMd(detail.q.analysis)" />
          <div v-else-if="detail.q?.answer" class="tiny"><code>{{ JSON.stringify(detail.q.answer) }}</code></div>
          <div v-else class="tiny faint">这道题没有可展示的解析。</div>

          <div class="section-title" style="margin-top:18px">历次作答（{{ detail.history.length }}）</div>
          <div v-if="!detail.history.length" class="tiny faint">没有历史明细。</div>
          <div v-for="(h, i) in detail.history" :key="i" class="wb-hist">
            <div class="wb-hist-head tiny">
              <span class="num">{{ h.created_at }}</span>
              <span class="pill" :class="Number(h.scale4) >= 2 ? 'ok' : 'bad'">四档 {{ h.scale4 }} · {{ Math.round(h.score ?? 0) }}分</span>
              <span class="faint">{{ h.grading_kind === 'ai' ? 'AI 批改' : h.grading_kind === 'self' ? '自评' : '自动判分' }}</span>
            </div>
            <div v-if="h.feedback?.verdict" class="tiny muted">{{ h.feedback.verdict }}</div>
            <ul v-if="h.feedback?.missing?.length" class="wb-missing">
              <li v-for="(m, j) in h.feedback.missing" :key="j" class="tiny">{{ m }}</li>
            </ul>
          </div>

          <div class="wb-drawer-foot">
            <n-button size="small" type="primary" @click="practiceNode(detail)"><Icon name="pen" :size="14" /> 练这个考点</n-button>
            <n-button size="small" quaternary @click="remove(detail)"><Icon name="close" :size="14" /> 从错题本移除</n-button>
          </div>
        </template>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.hd-ic { color: var(--accent); vertical-align: -3px }
.wb-kpis { margin-bottom: var(--sp-2) }
.wb-filters { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-3) var(--sp-4); margin-bottom: var(--sp-3) }
.wb-sw { display: inline-flex; align-items: center; gap: 7px }
.wb-filters .grow { flex: 1 }

.wb-list { display: grid; gap: var(--sp-3) }
.wb-item { padding: var(--sp-4); display: flex; flex-direction: column; gap: 10px }
.wb-item.hot { border-left: 3px solid var(--warn) }
.wb-item-main { cursor: pointer }
.wb-tags { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; margin-bottom: 8px }
.wb-node { flex: 1 1 auto; min-width: 0; text-align: right; color: var(--text-faint); font-size: var(--fs-xs) }
.wb-stem { margin: 0; font-size: var(--fs-base); font-weight: 600; line-height: 1.55; overflow-wrap: anywhere }
.wb-meta { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 8px }
.wb-item-acts { display: flex; gap: 8px; flex-wrap: wrap; padding-top: 10px; border-top: 1px dashed var(--border) }

.sk-card { display: block }
.sk-line { height: 16px; border-radius: var(--r-sm) }

/* 详情抽屉 */
.wb-drawer { position: fixed; inset: 0; z-index: 70; background: color-mix(in oklab, var(--bg, #000) 45%, transparent) }
.wb-drawer-inner {
  position: absolute; right: 0; top: 0; bottom: 0; width: 520px; max-width: 94%;
  background: var(--surface); border-left: 1px solid var(--border); box-shadow: var(--sh-4);
  padding: var(--sp-5); overflow: auto; animation: wb-slide var(--dur) var(--ease-enter) both
}
@keyframes wb-slide { from { transform: translateX(20px); opacity: 0 } }
.wb-detail-stem { margin: 0 0 8px; line-height: 1.6; font-size: var(--fs-md) }
.wb-hist { border: 1px solid var(--border); border-radius: var(--r-md); padding: 10px 12px; margin-bottom: 10px; background: var(--surface-2) }
.wb-hist-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 5px }
.wb-missing { margin: 6px 0 0; padding-left: 18px; display: grid; gap: 3px }
.wb-drawer-foot { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 20px; padding-top: 14px; border-top: 1px solid var(--border) }
</style>
