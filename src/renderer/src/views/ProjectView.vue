<script setup lang="ts">
import { onActivated, onMounted, ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '../components/Icon.vue'
import { toast, DOMAIN_LABEL } from '../lib/ui'
import { ipc } from '../lib/ipc'
import type { ProjectCard } from '@shared/api'

/**
 * 项目列表：目前内容目录里只有一个项目，但按列表写。
 * 项目进度与做题体系是两条互不相干的线：这里只读 project 自己的进度，
 * 不碰 store 里的题目/掌握度，避免用户以为「做项目能清掉今日到期复习」。
 */
const router = useRouter()
const rows = ref<ProjectCard[]>([])
const loading = ref(true)
const error = ref('')
const loaded = ref(false)

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
</script>

<template>
  <div class="page page-narrow">
    <header class="page-head">
      <div class="grow col">
        <h1><Icon name="zap" :size="21" class="hd-ic" /> 项目闯关</h1>
        <p>从零敲一个能跑的东西，每关都有红绿反馈。</p>
      </div>
    </header>

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
            @click="open(p)"
          >
            <span class="pemoji" aria-hidden="true">{{ p.emoji }}</span>

            <div class="pmain">
              <div class="phead">
                <h3 class="ptitle">{{ p.title }}</h3>
                <span v-if="p.finished" class="pill ok"><Icon name="check" :size="12" /> 已通关</span>
                <span v-else-if="p.started" class="pill info">进行中</span>
              </div>
              <p class="ptag">{{ p.tagline }}</p>

              <div class="pmeta">
                <span v-for="s in p.stack" :key="s" class="pill lock">{{ s }}</span>
                <span class="pill purple"><Icon name="layers" :size="12" /> {{ p.levelCount }} 关</span>
              </div>

              <div class="pprog">
                <div class="bar" :class="{ accent: !p.finished }"><i :style="{ width: `${pct(p)}%` }" /></div>
                <span class="tiny faint num">{{ p.doneCount }} / {{ p.levelCount }} 关</span>
              </div>
            </div>

            <div class="pact">
              <button class="btn" :class="{ primary: !p.finished }" @click.stop="open(p)">
                <Icon :name="ctaIcon(p)" :size="14" /> {{ cta(p) }}
              </button>
              <span class="micro faint">进度自动保存</span>
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

.sk-card { display: block }
.pgroups { display: grid; gap: var(--sp-5) }
.pgroup-head {
  display: flex; align-items: baseline; gap: var(--sp-3);
  padding: 0 var(--sp-1) var(--sp-2);
  border-bottom: 1px solid var(--border);
  margin-bottom: var(--sp-3);
}
.pgroup-head h2 {
  margin: 0; font-size: var(--fs-md); font-weight: 650; letter-spacing: -.01em;
}
.plist { display: grid; gap: var(--sp-3) }
.pcard {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--sp-4);
  padding: var(--sp-4) var(--sp-5);
  cursor: pointer;
}
.pcard:focus-visible { box-shadow: var(--ring) }
.pemoji {
  width: 56px; height: 56px; flex: 0 0 56px;
  display: grid; place-content: center;
  font-size: 28px; line-height: 1;
  border-radius: var(--r-lg);
  background: color-mix(in oklab, var(--accent) 8%, var(--surface-2));
  border: 1px solid var(--border);
}
.pmain { min-width: 0; display: grid; gap: 6px }
.phead { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap }
.ptitle { margin: 0; font-size: var(--fs-md); font-weight: 650; letter-spacing: -.01em }
.ptag { margin: 0; color: var(--text-dim); font-size: var(--fs-sm); line-height: 1.6; overflow-wrap: anywhere }
.pmeta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap }
.pprog { display: flex; align-items: center; gap: var(--sp-3); margin-top: 2px; max-width: 420px }
.pprog .bar { flex: 1 1 auto; height: 6px }
.pprog .num { flex: 0 0 auto }
.pact { display: flex; flex-direction: column; align-items: flex-end; gap: 6px }

@media (max-width: 820px) {
  .pcard { grid-template-columns: auto minmax(0, 1fr) }
  .pact { grid-column: 2; flex-direction: row; align-items: center; justify-content: flex-start }
}
</style>