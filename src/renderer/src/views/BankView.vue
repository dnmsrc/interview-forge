<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '../components/Icon.vue'
import { useForgeStore } from '../store'
import { DOMAIN_LABEL, TYPE_LABEL, TYPE_ICON_NAME, typePillClass, toast, downloadText, fmtAgo } from '../lib/ui'
import { ipc } from '../lib/ipc'

const store = useForgeStore()
const router = useRouter()
const stats = ref<any>(null)
const gaps = ref<any>(null)
const versions = ref<any[]>([])
const dirty = ref<any[]>([])
const updating = ref(false)
const updateOpts = reactive({ domains: [] as string[], perNodeTarget: 3, maxNodes: 8, note: '' })
const validateOut = ref('')
const domainOpts = Object.entries(DOMAIN_LABEL).map(([value, label]) => ({ value, label }))

/* ---- 以下均为纯展示状态 / 纯展示 computed：不碰 IPC、不碰保存与校验流程 ---- */
const loading = ref(true)
const q = ref('')
const fDomain = ref('')
const fKind = ref('')
const KIND_SEG = [
  { v: '', l: '全部' }, { v: 'update', l: '更新' }, { v: 'rollback', l: '回滚' }, { v: 'init', l: '初始' }
] as const
const hit = (s: unknown) => !q.value || String(s ?? '').toLowerCase().includes(q.value.trim().toLowerCase())
/** 缺口条目 id 的第一段就是板块 key（coverageGaps 用 substr(node_id,1,instr-1) 统计） */
const gapDomain = (g: any) => String(g?.id ?? '').split('.')[0]
const inDomain = (g: any) => !fDomain.value || gapDomain(g) === fDomain.value
const domainSeg = computed(() => {
  const buckets: Record<string, number> = {}
  for (const list of [gaps.value?.empty, gaps.value?.thin, gaps.value?.noSubjective]) {
    for (const g of list ?? []) buckets[gapDomain(g)] = (buckets[gapDomain(g)] ?? 0) + 1
  }
  return Object.entries(DOMAIN_LABEL).map(([value, label]) => ({ value, label, n: buckets[value] ?? 0 }))
})
const shownEmpty = computed(() => ((gaps.value?.empty ?? []) as any[]).filter(inDomain).filter((g) => hit(g.title)).slice(0, 12))
const shownThin = computed(() => ((gaps.value?.thin ?? []) as any[]).filter(inDomain).filter((g) => hit(g.title)).slice(0, 8))
const shownNoSub = computed(() => ((gaps.value?.noSubjective ?? []) as any[]).filter(inDomain).filter((g) => hit(g.title)).slice(0, 6))
const gapRowsTotal = computed(() => shownEmpty.value.length + shownThin.value.length + shownNoSub.value.length)
const openDirty = computed(() => dirty.value.filter((d: any) => d.status !== 'resolved').length)
const filteredVersions = computed(() => (versions.value as any[])
  .filter((v) => (!fKind.value || v.kind === fKind.value) && (hit(v.id) || hit(v.kind) || hit(v.report?.message) || hit((v.report?.targets ?? []).join(' ')))))
const filteredDirty = computed(() => (dirty.value as any[]).filter((d) => hit(d.stem) || hit(d.nodeTitle) || hit(d.reason)))
const latestVersion = computed(() => versions.value[0] ?? null)
/** 题型分布：图标/文案/语义色统一走 TYPE_ICON_NAME / TYPE_LABEL / typePillClass；条长按最大项归一 */
const typeRows = computed(() => {
  const rows: any[] = stats.value?.byType ?? []
  const max = Math.max(1, ...rows.map((t) => Number(t.n) || 0))
  return rows.map((t) => ({
    type: t.type,
    label: TYPE_LABEL[t.type] ?? t.type,
    icon: TYPE_ICON_NAME[t.type] ?? 'book',
    pill: typePillClass(t.type),
    n: t.n,
    pct: Math.round(((Number(t.n) || 0) / max) * 100)
  }))
})
const domainRows = computed(() => {
  const rows: any[] = stats.value?.byDomain ?? []
  const max = Math.max(1, ...rows.map((d) => Number(d.n) || 0))
  return rows.map((d) => ({ domain: d.domain, label: DOMAIN_LABEL[d.domain] ?? d.domain, n: d.n, pct: Math.round(((Number(d.n) || 0) / max) * 100) }))
})
const diffRows = computed(() => (stats.value?.byDifficulty ?? []) as any[])

async function load() {
  await store.boot()
  stats.value = await ipc.bank.stats()
  gaps.value = await ipc.bank.gaps({ perNodeTarget: updateOpts.perNodeTarget })
  versions.value = await ipc.bank.versions(30)
  dirty.value = await ipc.dirty.list(40)
  void store.loadBank()
}
async function runUpdate() {
  updating.value = true
  toast.info('题库更新中：AI 正在补覆盖缺口——先快照，再逐节点出题，最后重建索引，可能要 1-3 分钟。')
  try {
    const r = await ipc.bank.update({ ...updateOpts })
    if (!r.ok) toast.noteError('更新失败', r.error ?? '未知错误')
    else toast.note(`更新完成：新增 ${r.added} 题`, `${r.report?.message ?? (r.report?.added ?? []).map((a: any) => a.node).join('、')}；下架重复 ${r.retired} 题。已存快照，可一键回滚。`)
    await load()
  } catch (e: any) { toast.noteError('更新异常', String(e?.message ?? e)) } finally { updating.value = false }
}
async function rollback(id: string) {
  const r = await ipc.bank.rollback(id)
  if (r.ok) { toast.ok(r.message); await load() } else toast.err(r.message)
}
async function triage() {
  updating.value = true
  try {
    const r = await ipc.dirty.triage(5)
    toast.ok(`处理了 ${r.handled} 条举报${r.results?.[0]?.error ? `：${r.results[0].error}` : ''}`)
    await load()
  } catch (e: any) { toast.err(String(e?.message ?? e)) } finally { updating.value = false }
}
async function runValidate() {
  const r = await ipc.bank.validate()
  validateOut.value = r.output
  if (r.ok) toast.ok('校验通过')
  else toast.err('校验有 error，见下方输出')
}
function exportStats() {
  downloadText('bank-stats.json', JSON.stringify({ stats: stats.value, gaps: gaps.value }, null, 2))
}
/** 同一份统计的另一种导出：写进剪贴板，便于粘进 issue / 聊天 */
async function copyStats() {
  try {
    await navigator.clipboard.writeText(JSON.stringify({ stats: stats.value, gaps: gaps.value }, null, 2))
    toast.ok('题库统计 JSON 已复制')
  } catch { toast.err('复制失败：改点「下载 JSON」') }
}
onMounted(async () => { await load(); loading.value = false })
</script>

<template>
  <div class="page">
    <!-- ===== 页头：标题 + 一句说明 + 全局动作 ===== -->
    <header class="page-head">
      <div class="grow col">
        <h1><Icon name="layers" :size="20" class="hd-ic" /> 题库 · 版本</h1>
        <p>缺什么补什么：更新全程 AI 自动 —— 先整目录快照，再逐节点出题，最后重建索引。每次更新前都会快照，随时可回滚。</p>
      </div>
      <div class="acts">
        <n-button quaternary :disabled="updating" @click="load">
          <template #icon><Icon name="refresh" :size="15" /></template>刷新
        </n-button>
        <n-button type="primary" :loading="updating" @click="runUpdate">
          <template #icon><Icon name="sparkles" :size="15" /></template>让 AI 更新题库
        </n-button>
      </div>
    </header>

    <!-- ===== 工具条（吸顶）：搜索 + 板块/版本筛选 + 当前版本号 ===== -->
    <div class="toolbar">
      <n-input v-model:value="q" size="small" clearable placeholder="搜索版本号 / 变更摘要 / 脏题题干" class="tb-search" aria-label="搜索版本与脏题">
        <template #prefix><Icon name="search" :size="14" /></template>
      </n-input>
      <span class="tb-segwrap">
        <span class="micro faint">板块</span>
        <div class="seg" role="group" aria-label="按板块筛选缺口">
          <button type="button" :class="{ on: !fDomain }" @click="fDomain = ''">全部</button>
          <button v-for="d in domainSeg" :key="d.value" type="button" :title="`只看 ${d.label} 的覆盖缺口`"
            :class="{ on: fDomain === d.value }" @click="fDomain = fDomain === d.value ? '' : d.value">
            {{ d.label }}<span class="seg-n num">{{ d.n }}</span>
          </button>
        </div>
      </span>
      <span class="tb-segwrap">
        <span class="micro faint">版本</span>
        <div class="seg" role="group" aria-label="按版本类型筛选">
          <button v-for="k in KIND_SEG" :key="k.v" type="button" :class="{ on: fKind === k.v }" @click="fKind = k.v">{{ k.l }}</button>
        </div>
      </span>
      <span class="grow" />
      <span class="row tb-btns shrink">
        <n-button size="tiny" quaternary :disabled="!stats" title="把统计 JSON 复制进剪贴板" @click="copyStats">
          <template #icon><Icon name="copy" :size="13" /></template>复制统计
        </n-button>
        <n-button size="tiny" quaternary :disabled="!stats" title="下载 bank-stats.json" @click="exportStats">
          <template #icon><Icon name="download" :size="13" /></template>下载
        </n-button>
      </span>
      <span v-if="latestVersion" class="pill info shrink" title="最近一次入库的快照">
        <Icon name="layers" :size="12" /> 当前 <span class="num">#{{ latestVersion.id }}</span>
      </span>
      <span v-else class="pill lock shrink"><Icon name="layers" :size="12" /> 尚无版本</span>
    </div>

    <!-- ===== 体检指标 + 更新参数 ===== -->
    <section class="card rise" style="--i:1">
      <div class="panel-head">
        <h3><Icon name="target" :size="16" class="hd-ic" /> 题库体检 · 缺什么补什么</h3>
        <span class="desc">更新全程 AI 自动，不需要你手填题</span>
        <span class="grow" />
        <span class="tiny faint">每次更新前都会整目录快照，随时可回滚</span>
      </div>

      <div v-if="loading" class="kpis">
        <div v-for="i in 4" :key="i" class="kpi"><span class="skeleton sk-line" style="width:56%" /><span class="skeleton sk-line" style="width:34%;height:18px" /></div>
      </div>
      <div v-else class="kpis">
        <div class="kpi"><div class="k">在用题目</div><div class="v num">{{ stats?.questions ?? '-' }}</div><div class="d">status=active</div></div>
        <div class="kpi"><div class="k">变体题</div><div class="v num">{{ stats?.variants ?? '-' }}</div><div class="d">parent_id 非空</div></div>
        <div class="kpi"><div class="k">考点 level4</div><div class="v num">{{ stats?.nodes ?? '-' }}</div><div class="d">出题的最小粒度</div></div>
        <div class="kpi">
          <div class="k">缺口分布</div>
          <div class="row kpi-pills">
            <span class="pill bad"><Icon name="alert" :size="12" /> 空白 {{ gaps?.empty?.length ?? 0 }}</span>
            <span class="pill warn"><Icon name="filter" :size="12" /> 偏薄 {{ gaps?.thin?.length ?? 0 }}</span>
            <span class="pill info"><Icon name="book" :size="12" /> 缺主观题 {{ gaps?.noSubjective?.length ?? 0 }}</span>
          </div>
          <div class="d">空白 = 一道题都没有的考点</div>
        </div>
      </div>

      <hr class="hr" />

      <div class="grid g4 upd">
        <label class="fld">
          <span class="fld-l">限定板块（留空 = 全部缺口）</span>
          <n-select v-model:value="updateOpts.domains" multiple size="small" :options="domainOpts" placeholder="全部板块" />
        </label>
        <label class="fld fld-narrow">
          <span class="fld-l">每考点目标题量</span>
          <n-input-number v-model:value="updateOpts.perNodeTarget" class="num" size="small" :min="2" :max="8" />
        </label>
        <label class="fld fld-narrow">
          <span class="fld-l">本轮最多处理节点数</span>
          <n-input-number v-model:value="updateOpts.maxNodes" class="num" size="small" :min="1" :max="40" />
        </label>
        <label class="fld">
          <span class="fld-l">附加要求（可选）</span>
          <n-input v-model:value="updateOpts.note" size="small" placeholder="补充要求，如：二面追问风格" />
        </label>
      </div>

      <div class="row upd-acts">
        <n-button type="primary" :loading="updating" @click="runUpdate">
          <template #icon><Icon name="brain" :size="15" /></template>让 AI 更新题库
        </n-button>
        <n-button data-testid="bank-validate" :disabled="updating" @click="runValidate">
          <template #icon><Icon name="check" :size="15" /></template>跑结构校验
        </n-button>
        <n-button :disabled="updating" @click="triage">
          <template #icon><Icon name="filter" :size="15" /></template>复核脏题举报<span class="num">&nbsp;({{ openDirty }})</span>
        </n-button>
        <span class="grow" />
        <span class="tiny faint">快模型讲解、强模型判分：端点在「设置」里配</span>
      </div>

      <pre v-if="validateOut" class="out tiny num" :class="{ bad: /error/i.test(validateOut) }">{{ validateOut }}</pre>
    </section>

    <!-- ===== 分布 + 缺口 ===== -->
    <div class="grid g3">
      <section class="card flat rise" style="--i:2">
        <div class="panel-head">
          <h3><Icon name="chart" :size="16" class="hd-ic" /> 题型分布</h3>
          <span class="grow" />
          <span class="micro faint">按最大项归一</span>
        </div>
        <div v-if="loading" class="col dist-sk">
          <span v-for="i in 7" :key="i" class="skeleton sk-line" :style="{ width: 96 - i * 7 + '%' }" />
        </div>
        <div v-else-if="typeRows.length" class="q-list">
          <div v-for="t in typeRows" :key="t.type" class="q-item static">
            <span class="pill" :class="t.pill"><Icon :name="t.icon" :size="12" /> {{ t.label }}</span>
            <span class="bar dist-bar"><i :style="{ width: t.pct + '%' }" /></span>
            <span class="tiny muted num shrink">{{ t.n }}</span>
          </div>
        </div>
        <div v-else class="empty">
          <span class="ic"><Icon name="chart" :size="24" /></span>
          <div class="t">还没有题库统计</div>
          <div class="d">第一次「让 AI 更新题库」跑完后，这里会出现题型分布。</div>
          <div class="cta"><n-button size="small" :loading="updating" @click="runUpdate"><template #icon><Icon name="sparkles" :size="14" /></template>让 AI 更新题库</n-button></div>
        </div>
      </section>

      <section class="card flat rise" style="--i:3">
        <div class="panel-head">
          <h3><Icon name="folder" :size="16" class="hd-ic" /> 板块分布</h3>
          <span class="grow" />
          <span class="micro faint">点一行只筛它</span>
        </div>
        <div v-if="loading" class="col dist-sk">
          <span v-for="i in 5" :key="i" class="skeleton sk-line" :style="{ width: 92 - i * 8 + '%' }" />
        </div>
        <template v-else-if="domainRows.length">
          <div class="q-list">
            <div v-for="d in domainRows" :key="d.domain" class="q-item" role="button" tabindex="0"
              :title="`只看 ${d.label} 的覆盖缺口`" @click="fDomain = fDomain === d.domain ? '' : d.domain"
              @keydown.enter="fDomain = fDomain === d.domain ? '' : d.domain">
              <span class="qt ellip">{{ d.label }}</span>
              <span class="bar dist-bar"><i :style="{ width: d.pct + '%' }" /></span>
              <span class="tiny muted num shrink">{{ d.n }} 题</span>
              <Icon name="chevron" :size="14" class="faint" />
            </div>
          </div>
          <div class="section-title">难度分布</div>
          <div v-for="d in diffRows" :key="d.difficulty" class="kv">
            <span class="tiny">难度 <span class="num">{{ d.difficulty }}</span></span>
            <span class="grow" />
            <span class="tiny muted num">{{ d.n }}</span>
          </div>
        </template>
        <div v-else class="empty">
          <span class="ic"><Icon name="folder" :size="24" /></span>
          <div class="t">还没有板块数据</div>
          <div class="d">content/ 下的 JSON 入库后就会按板块与难度统计。</div>
          <div class="cta"><n-button size="small" @click="load"><template #icon><Icon name="refresh" :size="14" /></template>重新载入</n-button></div>
        </div>
      </section>

      <section class="card flat rise" style="--i:4">
        <div class="panel-head">
          <h3><Icon name="target" :size="16" class="hd-ic" /> 最该补的考点</h3>
          <span class="grow" />
          <span class="micro faint num">{{ gapRowsTotal }} 项</span>
        </div>
        <div v-if="loading" class="col dist-sk">
          <span v-for="i in 6" :key="i" class="skeleton sk-line" :style="{ width: 90 - i * 6 + '%' }" />
        </div>
        <div v-else-if="gapRowsTotal" class="q-list">
          <div v-for="g in shownEmpty" :key="'e' + g.id" class="q-item" :title="g.id">
            <span class="pill bad"><Icon name="alert" :size="12" /> 空白</span>
            <span class="qt">{{ g.title }}</span>
            <Icon name="chevron" :size="14" class="faint" />
          </div>
          <div v-for="g in shownThin" :key="'t' + g.id" class="q-item" :title="g.id">
            <span class="pill warn"><span class="num">{{ g.total }}</span> 题</span>
            <span class="qt">{{ g.title }}</span>
            <Icon name="chevron" :size="14" class="faint" />
          </div>
          <div v-for="g in shownNoSub" :key="'s' + g.id" class="q-item" :title="g.id">
            <span class="pill info"><Icon name="book" :size="12" /> 缺主观题</span>
            <span class="qt">{{ g.title }}</span>
            <Icon name="chevron" :size="14" class="faint" />
          </div>
        </div>
        <div v-else class="empty">
          <span class="ic"><Icon name="check" :size="24" /></span>
          <div class="t">{{ q || fDomain ? '这个条件下没有缺口条目' : '覆盖已达标' }}</div>
          <div class="d">{{ q || fDomain ? '换个关键词，或把板块筛选清掉看全量缺口。' : '每个考点都够题量了。可以让 AI 再补一轮变体，或去练习验证掌握度。' }}</div>
          <div class="cta">
            <n-button v-if="q || fDomain" size="small" @click="q = ''; fDomain = ''"><template #icon><Icon name="close" :size="14" /></template>清空筛选</n-button>
            <n-button v-else type="primary" size="small" :loading="updating" @click="runUpdate"><template #icon><Icon name="sparkles" :size="14" /></template>让 AI 再补一轮</n-button>
            <n-button size="small" quaternary @click="() => router.push('/practice')">去练习验一手<Icon name="chevron" :size="13" /></n-button>
          </div>
        </div>
      </section>
    </div>

    <!-- ===== 脏题举报队列 ===== -->
    <section class="card rise" style="--i:5">
      <div class="panel-head">
        <h3><Icon name="pen" :size="16" class="hd-ic" /> 脏题举报队列</h3>
        <span class="desc">AI 自动判定：修 / 下架 / 替换 / 保留</span>
        <span class="grow" />
        <span class="pill" :class="openDirty ? 'warn' : 'ok'"><span class="num">{{ openDirty }}</span> 待处理</span>
        <n-button size="small" :disabled="updating || !dirty.length" @click="triage">
          <template #icon><Icon name="filter" :size="14" /></template>一键复核
        </n-button>
      </div>
      <div v-if="loading" class="col dist-sk">
        <span v-for="i in 3" :key="i" class="skeleton sk-line" style="width:96%" />
        <span class="skeleton sk-line" style="width:70%" />
      </div>
      <div v-else-if="filteredDirty.length" class="q-list">
        <div v-for="(d, i) in filteredDirty.slice(0, 20)" :key="d.id" class="q-item dq rise" :style="{ '--i': Math.min(i, 8) }" :title="d.node_id">
          <span class="pill" :class="d.status === 'resolved' ? 'ok' : d.status === 'edited' ? 'info' : 'warn'">{{ d.status }}</span>
          <span class="grow col dq-main">
            <span class="dq-stem clamp2">{{ d.stem }}</span>
            <span class="micro faint dq-meta">{{ d.nodeTitle }} · {{ d.reason }}<template v-if="d.ai_action"> · AI: {{ d.ai_action }}</template></span>
          </span>
          <span class="micro faint shrink num" :title="d.created_at">{{ fmtAgo(d.created_at) }}</span>
        </div>
      </div>
      <div v-else class="empty">
        <span class="ic"><Icon name="check" :size="24" /></span>
        <div class="t">{{ q && dirty.length ? `没有匹配「${q}」的举报` : '还没有人举报题目' }}</div>
        <div class="d">{{ q && dirty.length ? '换个关键词看看。' : '练习时点「答案存疑 / 已过时 / 有歧义」就会进这里，AI 会自动判定怎么处置。' }}</div>
        <div class="cta"><n-button size="small" @click="() => router.push('/practice')"><template #icon><Icon name="pen" :size="14" /></template>去做题顺手举报</n-button></div>
      </div>
    </section>

    <!-- ===== 版本时间线 ===== -->
    <section class="card rise" style="--i:6">
      <div class="panel-head">
        <h3><Icon name="clock" :size="16" class="hd-ic" /> 题库版本</h3>
        <span class="desc">每条都是某次更新前的 content/ 快照，可一键还原</span>
        <span class="grow" />
        <span class="micro faint num">{{ filteredVersions.length }}/{{ versions.length }}</span>
      </div>

      <div v-if="loading" class="col dist-sk">
        <span v-for="i in 4" :key="i" class="skeleton sk-line" style="width:88%" />
      </div>
      <div v-else-if="filteredVersions.length" class="q-list ver-list">
        <div v-for="(v, i) in filteredVersions" :key="v.id" class="ver rise" :style="{ '--i': Math.min(i, 8) }">
          <div class="ver-kv">
            <span class="pill" :class="v.kind === 'rollback' ? 'purple' : v.kind === 'update' ? 'info' : 'lock'">{{ v.kind }}</span>
            <span class="ver-id num" :title="'快照 id ' + v.id">#{{ v.id }}</span>
            <span class="grow col ver-main">
              <span class="clamp2 ver-sum">
                <span class="num">+{{ v.added }}</span> 新增 · <span class="num">~{{ v.revised }}</span> 修订 · <span class="num">-{{ v.retired }}</span> 下架
                <span class="muted tiny">{{ v.report?.message || (v.report?.targets || []).slice(0, 3).join('、') || '' }}</span>
              </span>
              <span class="micro faint ver-time"><Icon name="clock" :size="11" /> {{ fmtAgo(v.created_at) }} · {{ (v.created_at || '').slice(0, 19) }}</span>
            </span>
            <span v-if="i === 0" class="pill ok shrink"><Icon name="check" :size="12" /> 当前</span>
            <button v-if="!v.dir" class="btn ghost shrink" disabled title="该记录没有快照目录，无法回滚">不可回滚</button>
            <n-popconfirm v-else positive-text="回滚" negative-text="取消" @positive-click="rollback(v.id)">
              <template #trigger>
                <button class="btn danger shrink" type="button" aria-label="回滚到这个版本"><Icon name="refresh" :size="13" /> 回滚</button>
              </template>
              会把 content/ 整个还原成 {{ fmtAgo(v.created_at) }} 的状态，并先把当前状态也快照一份
            </n-popconfirm>
          </div>
          <details class="ver-diff">
            <summary><Icon name="chevronDown" :size="13" /> 查看 diff</summary>
            <div class="acc-body diff-body">
              <div class="kv"><span class="tiny muted">新增 / 修订 / 下架</span><span class="tiny num">+{{ v.added }} / ~{{ v.revised }} / -{{ v.retired }}</span></div>
              <div v-if="v.report?.message" class="kv"><span class="tiny muted">结论</span><span class="tiny wrap-any">{{ v.report.message }}</span></div>
              <div v-if="(v.report?.added ?? []).length" class="kv">
                <span class="tiny muted">新增来源</span>
                <span class="tiny num wrap-any">{{ v.report.added.map((a: any) => `${a.node} ×${a.count}`).join('、') }}</span>
              </div>
              <div v-if="(v.report?.targets ?? []).length" class="kv">
                <span class="tiny muted">本轮处理节点</span><span class="tiny num wrap-any">{{ v.report.targets.join('、') }}</span>
              </div>
              <div v-for="(n, ni) in (v.report?.notes ?? [])" :key="'n' + ni" class="kv">
                <span class="tiny muted">跳过</span><span class="tiny wrap-any">{{ n }}</span>
              </div>
              <div v-if="v.report?.from" class="kv"><span class="tiny muted">回滚自</span><span class="tiny num">#{{ v.report.from }}</span></div>
              <div v-if="v.dir" class="kv"><span class="tiny muted">快照目录</span><span class="tiny faint ellip" :title="v.dir">{{ v.dir }}</span></div>
            </div>
          </details>
        </div>
      </div>
      <div v-else class="empty">
        <span class="ic"><Icon name="clock" :size="24" /></span>
        <div class="t">{{ versions.length ? '没有符合当前筛选的版本' : '还没有版本记录' }}</div>
        <div class="d">{{ versions.length ? '把版本类型或搜索词清掉就能看到全部 30 条。' : '第一次让 AI 更新题库后，这里会出现可回滚的快照列表。' }}</div>
        <div class="cta">
          <n-button v-if="versions.length" size="small" @click="q = ''; fKind = ''"><template #icon><Icon name="close" :size="14" /></template>清空筛选</n-button>
          <n-button v-else type="primary" size="small" :loading="updating" @click="runUpdate"><template #icon><Icon name="sparkles" :size="14" /></template>让 AI 更新题库</n-button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.hd-ic { color: var(--accent); vertical-align: -3px }

/* ---- 工具条内的局部件 ---- */
.tb-search { flex: 1 1 220px; max-width: 340px }
.tb-segwrap { display: inline-flex; align-items: center; gap: var(--sp-2); min-width: 0; flex-wrap: wrap }
.toolbar .seg { flex-wrap: wrap }
.tb-btns { gap: var(--sp-1) }
.seg-n { margin-left: 5px; opacity: .62; font-size: 10.5px }
.toolbar > * { min-width: 0 }
.toolbar > .pill { flex: 0 0 auto }

/* ---- KPI / 表单 ---- */
.kpi-pills { margin-top: 4px; gap: 6px; flex-wrap: wrap }
.upd { align-items: end }
.upd-acts { margin-top: var(--sp-4); row-gap: var(--sp-2) }
.fld { display: flex; flex-direction: column; gap: var(--sp-1); min-width: 0 }
.fld-narrow { max-width: 160px }
.fld-l { font-size: var(--fs-xs); color: var(--text-faint); font-weight: 600; letter-spacing: .02em }
.out {
  margin-top: var(--sp-3); padding: var(--sp-3) var(--sp-4); max-height: 280px; overflow: auto;
  background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--r-md);
  white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.6;
}
.out.bad { border-color: color-mix(in oklab, var(--bad) 32%, var(--border)); background: color-mix(in oklab, var(--bad) 6%, var(--surface)) }

/* ---- 分布条：走全局 .bar 轨道，这里只调宽度与对齐 ---- */
.dist-bar { flex: 1 1 90px }
.q-item.static { cursor: default; box-shadow: none; background: var(--surface-2) }
.q-item.static:hover { transform: none; box-shadow: none }
.dist-sk { gap: var(--sp-2); padding: var(--sp-1) 0 }

/* ---- 脏题行 ---- */
.dq { align-items: flex-start; padding-block: var(--sp-3) }
.dq .pill { margin-top: 2px }
.dq-main { gap: 3px }
.dq-stem { font-size: var(--fs-sm); line-height: 1.5; overflow-wrap: anywhere }
.dq-meta { overflow-wrap: anywhere }

/* ---- 版本时间线：左侧导轨 + 节点，当前版本高亮 ---- */
.ver-list { gap: var(--sp-1); position: relative }
.ver-list::before { content: ''; position: absolute; left: 3px; top: 14px; bottom: 14px; width: 2px; border-radius: 2px; background: linear-gradient(180deg, var(--border-2), var(--border)) }
.ver { position: relative; padding-left: var(--sp-5) }
.ver::before {
  content: ''; position: absolute; left: 0; top: 15px; width: 8px; height: 8px; border-radius: 50%;
  background: var(--surface); border: 2px solid var(--border-2); transition: border-color var(--dur-fast) var(--ease-out)
}
.ver:hover::before { border-color: var(--accent) }
.ver-kv { display: flex; align-items: center; gap: var(--sp-3); padding: 9px 0; border-bottom: 1px dashed var(--border) }
.ver:last-child .ver-kv { border-bottom: 0 }
.ver-id {
  flex: 0 0 auto; font-family: var(--mono); font-size: var(--fs-xs); color: var(--text-dim);
  background: var(--surface-2); border: 1px solid var(--border); padding: 2px 7px; border-radius: var(--r-pill)
}
.ver-main { gap: 2px }
.ver-sum { font-size: var(--fs-sm); line-height: 1.5 }
.ver-time { display: inline-flex; align-items: center; gap: 4px }
.ver:first-child .ver-kv { background: color-mix(in oklab, var(--accent) 6%, transparent); border-radius: var(--r-md) }

/* ---- diff 折叠：scoped 自绘（全局 details.acc 只给裸 details 用） ---- */
.ver-diff summary { list-style: none; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; margin-top: var(--sp-2); padding: 4px 10px; border-radius: var(--r-md); font-size: var(--fs-sm); color: var(--text-dim); transition: background-color var(--dur-fast), color var(--dur-fast) }
.ver-diff summary::-webkit-details-marker { display: none }
.ver-diff summary:hover { background: var(--surface-2); color: var(--text) }
.ver-diff summary:focus-visible { box-shadow: var(--ring-soft) }
.ver-diff[open] summary svg { transform: rotate(180deg) }
.ver-diff summary svg { transition: transform var(--dur) var(--ease-out) }
.diff-body { margin-top: var(--sp-1); padding: var(--sp-2) var(--sp-4) var(--sp-3); background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--r-md) }
.diff-body .kv:last-child { border-bottom: 0 }

@media (max-width: 720px) {
  .ver-kv { flex-wrap: wrap; row-gap: var(--sp-2) }
  .upd-acts .n-button { flex: 1 1 auto }
}
</style>
