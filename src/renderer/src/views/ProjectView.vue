<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '../components/Icon.vue'
import { toast, DOMAIN_LABEL } from '../lib/ui'
import { ipc } from '../lib/ipc'
import type { ProjectCard, ProjectCoverage } from '@shared/api'

/**
 * 项目列表：按领域分栏的项目卡片墙 + 一张「知识图谱覆盖」总览。
 *
 * 为什么改成网格而不是一行一个：
 * 项目数量会随「把图谱知识点都收编成项目关卡」的目标持续增长，纵向列表
 * 每个项目占一屏 1/6，项目一多就要拖滚动条找。卡片墙让同样一屏能扫到 6-9 个，
 * 领域内一眼看到哪些在等你。
 *
 * 覆盖总览回答的是另一个问题：「做完这些项目，图谱里的知识点是不是都摸过了」。
 * 没有这个数，项目闯关和知识图谱就是两条各说各话的线。
 */
const router = useRouter()
const rows = ref<ProjectCard[]>([])
const coverage = ref<ProjectCoverage | null>(null)
const loading = ref(true)
const error = ref('')
const loaded = ref(false)
const gapOpen = ref(false)

/** silent=true 用于从关卡页返回时刷新，不闪骨架屏 */
async function load(silent = false) {
  if (!silent) loading.value = true
  error.value = ''
  try {
    rows.value = await ipc.project.list()
    loaded.value = true
  } catch (e: unknown) {
    if (!silent) {
      error.value = e instanceof Error ? e.message : String(e)
      toast.err(`项目列表加载失败：${error.value}`)
    }
  } finally {
    if (!silent) loading.value = false
  }
  // 覆盖统计不影响列表可用：单独 try，拿不到就退回「不显示总览」
  try {
    coverage.value = await ipc.project.coverage()
  } catch (e: unknown) {
    console.warn('[project] 覆盖统计加载失败', e)
    coverage.value = null
  }
}

function open(p: ProjectCard) {
  void router.push(`/projects/${p.id}`)
}

/** 模板里不能直接绑 load：可选的 silent 参数会和 PointerEvent 冲突 */
function retryLoad() {
  void load()
}

function pct(p: ProjectCard) {
  return p.levelCount ? Math.round((p.doneCount / p.levelCount) * 100) : 0
}

/** 主按钮文案只回答一个问题：现在点进去会落在哪一关 */
function cta(p: ProjectCard) {
  if (p.finished) return '已全部完成 · 重做'
  if (!p.started) return '开始第 1 关'
  return `继续第 ${Math.min(p.doneCount + 1, p.levelCount)} 关`
}

function ctaIcon(p: ProjectCard) {
  return p.finished ? 'refresh' : p.started ? 'arrowRight' : 'play'
}

onMounted(() => { void load() })
// KeepAlive 回来时刷新进度（在别的关卡通关后返回列表要能看见变化）
onActivated(() => { if (loaded.value) void load(true) })

/**
 * 按领域分栏：前端 / 后端 / 公共基础 / AI / 工程难题，未知领域归到「其它」。
 *
 * 内容多了之后一锅平铺的列表很难找：用户想练的是「后端」还是「算法」，
 * 应该一眼看到分区，而不是逐个读标题猜它属于哪一类。顺序固定，不按数量排序——
 * 每次打开位置都变会让人找不到刚才那一栏。
 */
const DOMAIN_ORDER = ['fe', 'be', 'cs', 'ai', 'eng']
const groups = computed(() => {
  const buckets = new Map<string, ProjectCard[]>()
  for (const p of rows.value) {
    const key = DOMAIN_ORDER.includes(p.domain) ? p.domain : 'other'
    const list = buckets.get(key)
    if (list) list.push(p)
    else buckets.set(key, [p])
  }
  const out: { key: string; label: string; rows: ProjectCard[] }[] = []
  for (const key of [...DOMAIN_ORDER, 'other']) {
    const list = buckets.get(key)
    if (!list?.length) continue
    out.push({ key, label: key === 'other' ? '其它' : DOMAIN_LABEL[key] ?? key, rows: list })
  }
  return out
})

/** 覆盖缺口按技术栈分组：补内容的人一眼看到「这一块还没人接」 */
const gapGroups = computed(() => {
  const cov = coverage.value
  if (!cov?.gaps.length) return []
  const m = new Map<string, { key: string; label: string; items: ProjectCoverage['gaps'] }>()
  for (const g of cov.gaps) {
    const b = m.get(g.stack) ?? { key: g.stack, label: g.stack, items: [] }
    b.items.push(g)
    m.set(g.stack, b)
  }
  const order = cov.byStack.map((b) => b.key)
  return [...m.values()].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
})

const coverPct = computed(() => (coverage.value ? Math.round(coverage.value.ratio * 1000) / 10 : 0))
</script>

<template>
  <div class="page page-narrow">
    <header class="page-head">
      <div class="grow col">
        <h1><Icon name="zap" :size="21" class="hd-ic" /> 项目闯关</h1>
        <p>从零敲一个能跑的东西，每关都有红绿反馈。目标是让知识图谱里的知识点，都能在这里被写一遍。</p>
      </div>
    </header>

    <!-- 覆盖总览：项目闯关与知识图谱的唯一对账窗口 -->
    <section v-if="coverage" class="cov card" aria-label="知识图谱覆盖总览">
      <div class="cov-head">
        <span class="cov-kicker"><Icon name="graph" :size="15" /> 知识图谱覆盖</span>
        <span class="cov-num num">{{ coverage.covered }}</span>
        <span class="cov-of">/ {{ coverage.totalTargets }} 个知识点</span>
        <span class="pill" :class="coverPct >= 100 ? 'ok' : coverPct >= 60 ? 'info' : 'lock'">{{ coverPct }}%</span>
        <span class="grow" />
        <button v-if="coverage.missing" class="btn ghost cov-toggle" type="button" @click="gapOpen = !gapOpen">
          <Icon :name="gapOpen ? 'chevronDown' : 'chevron'" :size="13" />
          {{ gapOpen ? '收起缺口' : `还没收编的 ${coverage.missing} 个` }}
        </button>
      </div>
      <div class="bar" :class="{ accent: coverPct < 100, ok: coverPct >= 100 }"><i :style="{ width: `${coverPct}%` }" /></div>
      <div class="cov-doms">
        <span v-for="d in coverage.byDomain" :key="d.key" class="cov-dom">
          <b>{{ DOMAIN_LABEL[d.key] ?? d.key }}</b>
          <span class="num faint">{{ d.covered }}/{{ d.total }}</span>
          <i class="cov-mini"><i :style="{ width: `${Math.round(d.ratio * 100)}%` }" /></i>
        </span>
        <span v-if="coverage.unmappedLevels" class="cov-warn" :title="`有 ${coverage.unmappedLevels} 关还没声明讲透哪些知识点，不参与覆盖统计`">
          <Icon name="alert" :size="12" /> {{ coverage.unmappedLevels }} 关未标注知识点
        </span>
      </div>

      <div v-if="gapOpen && gapGroups.length" class="cov-gaps">
        <div v-for="g in gapGroups" :key="g.key" class="cov-gap-row">
          <span class="cov-gap-stack">{{ g.label }}</span>
          <span class="cov-gap-items">
            <span v-for="n in g.items" :key="n.id" class="cov-gap-item" :class="{ must: n.mustMaster }" :title="`${n.id}\n${n.title}`">
              {{ n.title }}
            </span>
          </span>
        </div>
        <p class="micro faint cov-gap-note">
          这些知识点目前没有对应的项目关卡。虚线框是必掌握（mustMaster），会优先补。
        </p>
      </div>
    </section>

    <div class="note card flat">
      <Icon name="layers" :size="16" class="note-ic" />
      <span>这里的进度单独记，和练习、考试互不影响。写到一半离开，回来还在原处。</span>
    </div>

    <div v-if="loading" class="card sk-card">
      <div class="skeleton sk-line" style="width:44%" />
      <div class="skeleton sk-line" style="width:76%;margin-top:10px" />
      <div class="skeleton sk-block" style="margin-top:14px;height:52px" />
    </div>

    <div v-else-if="error" class="empty card error">
      <span class="ic"><Icon name="alert" :size="26" /></span>
      <span class="t">项目列表没加载出来</span>
      <span class="d">{{ error }}</span>
      <span class="cta"><button class="btn" @click="retryLoad"><Icon name="refresh" :size="14" /> 重试</button></span>
    </div>

    <div v-else-if="rows.length" class="pgroups">
      <section v-for="g in groups" :key="g.key" class="pgroup">
        <header class="pgroup-head">
          <h2>{{ g.label }}</h2>
          <span class="tiny faint">{{ g.rows.length }} 个项目 · {{ g.rows.reduce((n, p) => n + p.levelCount, 0) }} 关</span>
        </header>

        <div class="plist">
          <article
            v-for="p in g.rows" :key="p.id" class="card lift pcard"
            role="button" tabindex="0"
            @click="open(p)"
            @keydown.enter="open(p)"
          >
            <div class="pcard-top">
              <span class="pemoji" aria-hidden="true">{{ p.emoji }}</span>
              <div class="pmain">
                <div class="phead">
                  <h3 class="ptitle">{{ p.title }}</h3>
                  <span v-if="p.finished" class="pill ok"><Icon name="check" :size="12" /> 已通关</span>
                  <span v-else-if="p.started" class="pill info">进行中</span>
                </div>
                <p class="ptag">{{ p.tagline }}</p>
              </div>
            </div>

            <div class="pmeta">
              <span v-for="s in p.stack.slice(0, 3)" :key="s" class="pill lock">{{ s }}</span>
              <span class="pill purple"><Icon name="layers" :size="12" /> {{ p.levelCount }} 关</span>
              <span v-if="p.nodeCount" class="pill purple" :title="`覆盖 ${p.nodeCount} 个知识图谱节点`">
                <Icon name="brain" :size="12" /> {{ p.nodeCount }}
              </span>
            </div>

            <div class="pprog">
              <div class="bar" :class="{ accent: !p.finished, ok: p.finished }"><i :style="{ width: `${pct(p)}%` }" /></div>
              <span class="tiny faint num">{{ p.doneCount }} / {{ p.levelCount }} 关</span>
            </div>

            <div class="pact">
              <button class="btn" :class="{ primary: !p.finished }" @click.stop="open(p)">
                <Icon :name="ctaIcon(p)" :size="14" /> {{ cta(p) }}
              </button>
            </div>
          </article>
        </div>
      </section>
    </div>

    <div v-else class="empty card">
      <span class="ic"><Icon name="layers" :size="26" /></span>
      <span class="t">还没有项目内容</span>
      <span class="d">把项目 JSON 放进 content/projects 目录，重启应用后就会出现在这里。</span>
      <span class="cta"><button class="btn ghost" @click="retryLoad"><Icon name="refresh" :size="14" /> 重新检查</button></span>
    </div>
  </div>
</template>

<style scoped>
.hd-ic { color: var(--accent); vertical-align: -3px }
.note {
  display: flex; align-items: flex-start; gap: 10px;
  padding: var(--sp-3) var(--sp-4);
  color: var(--text-dim); font-size: var(--fs-sm); line-height: 1.6;
  background: color-mix(in oklab, var(--accent) 5%, var(--surface));
  border-color: color-mix(in oklab, var(--accent) 20%, var(--border));
}
.note-ic { color: var(--accent); margin-top: 1px; flex: 0 0 auto }

/* ---------- 覆盖总览 ---------- */
.cov { display: grid; gap: var(--sp-3); padding: var(--sp-4) var(--sp-5) }
.cov-head { display: flex; align-items: baseline; gap: var(--sp-2); flex-wrap: wrap }
.cov-kicker {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: var(--fs-sm); font-weight: 650; color: var(--text-dim);
  margin-right: var(--sp-2);
}
.cov-kicker :deep(.ic) { color: var(--purple) }
.cov-num { font-size: var(--fs-xl); font-weight: 700; line-height: 1 }
.cov-of { font-size: var(--fs-sm); color: var(--text-faint) }
.cov-toggle { padding: 3px 10px; font-size: var(--fs-xs); margin-left: auto }
.cov .bar { height: 7px }
.cov-doms { display: flex; align-items: center; gap: var(--sp-4); flex-wrap: wrap }
.cov-dom { display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-xs); color: var(--text-dim) }
.cov-dom b { font-weight: 600 }
.cov-mini { display: inline-block; width: 54px; height: 4px; border-radius: var(--r-pill); background: var(--surface-3); overflow: hidden }
.cov-mini i { display: block; height: 100%; background: color-mix(in oklab, var(--purple) 70%, var(--accent)); border-radius: inherit }
.cov-warn { display: inline-flex; align-items: center; gap: 4px; font-size: var(--fs-xs); color: var(--text-faint) }
.cov-gaps { display: grid; gap: 7px; padding-top: var(--sp-2); border-top: 1px dashed var(--border) }
.cov-gap-row { display: grid; grid-template-columns: 84px minmax(0, 1fr); gap: var(--sp-3); align-items: start }
.cov-gap-stack { font-size: var(--fs-xs); color: var(--text-faint); font-weight: 600; padding-top: 2px }
.cov-gap-items { display: flex; flex-wrap: wrap; gap: 5px }
.cov-gap-item {
  font-size: var(--fs-xs); padding: 2px 7px; border-radius: var(--r-pill);
  border: 1px solid var(--border); color: var(--text-dim); background: var(--surface-2);
}
.cov-gap-item.must { border-style: dashed; border-color: color-mix(in oklab, var(--warn) 55%, var(--border)); color: var(--text) }
.cov-gap-note { margin: 0 }

.sk-card { display: block }
.pgroups { display: grid; gap: var(--sp-5) }
.pgroup-head {
  display: flex; align-items: baseline; gap: var(--sp-3);
  padding: 0 var(--sp-1) var(--sp-2);
  border-bottom: 1px solid var(--border);
  margin-bottom: var(--sp-3);
}
.pgroup-head h2 { margin: 0; font-size: var(--fs-md); font-weight: 650; letter-spacing: -.01em }

/* 卡片墙：一屏能扫到多个项目 */
.plist { display: grid; grid-template-columns: repeat(auto-fill, minmax(308px, 1fr)); gap: var(--sp-3) }
.pcard {
  display: flex; flex-direction: column; gap: var(--sp-3);
  padding: var(--sp-4);
  cursor: pointer;
  min-width: 0;
}
.pcard:focus-visible { box-shadow: var(--ring) }
.pcard-top { display: flex; align-items: flex-start; gap: var(--sp-3); min-width: 0 }
.pemoji {
  width: 46px; height: 46px; flex: 0 0 46px;
  display: grid; place-content: center;
  font-size: 23px; line-height: 1;
  border-radius: var(--r-md);
  background: color-mix(in oklab, var(--accent) 8%, var(--surface-2));
  border: 1px solid var(--border);
}
.pmain { min-width: 0; display: grid; gap: 4px; flex: 1 1 auto }
.phead { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap }
.ptitle { margin: 0; font-size: var(--fs-base); font-weight: 650; letter-spacing: -.01em }
.ptag {
  margin: 0; color: var(--text-dim); font-size: var(--fs-xs); line-height: 1.55;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.pmeta { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; min-height: 22px }
.pprog { display: flex; align-items: center; gap: var(--sp-2) }
.pprog .bar { flex: 1 1 auto; height: 5px }
.pprog .num { flex: 0 0 auto }
.pact { display: flex; align-items: center; gap: var(--sp-2); margin-top: auto }
.pact .btn { flex: 1 1 auto; justify-content: center }

@media (max-width: 640px) {
  .plist { grid-template-columns: minmax(0, 1fr) }
  .cov-gap-row { grid-template-columns: minmax(0, 1fr); gap: 4px }
}
</style>