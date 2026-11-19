<script setup lang="ts">
import { computed, nextTick, onActivated, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '../components/Icon.vue'
import { dialog, toast } from '../lib/ui'
import { ipc } from '../lib/ipc'
import type { ProjectDetail, ProjectLevelCard } from '@shared/api'

/**
 * 关卡地图：按「章节」分组的关卡网格。
 *
 * 为什么不再是纵向一关一张大卡片：
 * 关卡数量是按「覆盖知识图谱全部知识点」的目标长的——9 项目已经 33 关，
 * 补齐后还会明显变多。纵向路径在 33 关时要滚十几屏，找某一关只能靠拖滚动条，
 * 这正是用户说的「太反人类」。
 *
 * 现在一关一张小方格：一屏能看到一章的全部关卡，章与章之间靠标题分隔；
 * 顶部工具条粘住，可以按「未通关 / 已通关」筛、按标题或知识点搜。
 * 关卡顺序、解锁状态、当前关高亮全部保留，只是把「一条长路」折成了「一面墙」。
 *
 * 章节从哪来：每关在 nodes 里声明的第一个知识点所属的 topic（服务端已按图谱标题转成中文）。
 * 没写 nodes 的老关卡归入「主线」。
 */
const route = useRoute()
const router = useRouter()
const projectId = computed(() => String(route.params.projectId ?? ''))

const detail = ref<ProjectDetail | null>(null)
const loading = ref(true)
const error = ref('')
const loaded = ref(false)
const resetting = ref(false)

const levels = computed(() => detail.value?.levels ?? [])
const nextId = computed(() => detail.value?.nextLevelId ?? null)
const doneCount = computed(() => detail.value?.doneCount ?? 0)
const todoCount = computed(() => Math.max(0, levels.value.length - doneCount.value))
/**
 * 「有没有进度可清」不能只看 doneCount：用户可能第 2 步写了一半就退出了，
 * 没通关但库里有草稿和尝试次数。只看通关数会把重做按钮置灰，
 * 于是「我想从第 1 关重来」的人又被挡一次——正是这次要修的那个问题。
 */
const hasAnyProgress = computed(() => levels.value.some((l) => l.done || l.attempts > 0))
const pct = computed(() => {
  const d = detail.value
  return d && d.levelCount ? Math.round((d.doneCount / d.levelCount) * 100) : 0
})

/** silent=true 用于从工作台返回时刷新，不闪骨架屏 */
async function load(silent = false) {
  // 离开地图页（回列表/首页）时 projectId 会变空：那不是加载失败，直接跳过
  if (!projectId.value) {
    loading.value = false
    return
  }
  if (!silent) loading.value = true
  error.value = ''
  try {
    detail.value = await ipc.project.detail(projectId.value)
    loaded.value = true
  } catch (e: unknown) {
    if (!silent) {
      error.value = e instanceof Error ? e.message : String(e)
      toast.err(`项目加载失败：${error.value}`)
    }
  } finally {
    if (!silent) loading.value = false
  }
}

function back() {
  void router.push('/projects')
}

/**
 * 「整个 App 从头开始」不在这页做（那是设置页的事），但要在这页能摸到：
 * 带 focus=reset 跳到设置页，设置页会把危险区滚进视野，不让用户自己找。
 */
function goGlobalReset() {
  void router.push({ path: '/settings', query: { focus: 'reset' } })
}

/** 模板里不能直接绑 load：可选的 silent 参数会和 PointerEvent 冲突 */
function retryLoad() {
  void load()
}

function openLevel(lv: ProjectLevelCard) {
  if (!lv.unlocked) return
  void router.push(`/projects/${projectId.value}/${lv.id}`)
}

function isCurrent(lv: ProjectLevelCard) {
  return lv.unlocked && !lv.done && nextId.value === lv.id
}

/** 从零重做是不可逆的（草稿也会清），必须先二次确认并说清保留了哪些东西 */
function resetAll() {
  if (!detail.value || resetting.value) return
  dialog.warning({
    title: '从零重做这个项目？',
    content: '所有关卡的通关状态、草稿和解锁进度都会被清空，从第 1 关重新开始。已获得的 XP 不回收。',
    positiveText: '从零重做',
    negativeText: '取消',
    type: 'warning',
    onPositiveClick: async () => {
      resetting.value = true
      try {
        await ipc.project.resetAll(projectId.value)
        toast.ok('已重置，从第 1 关重新开始')
        await load(true)
      } catch (e: unknown) {
        toast.err(e instanceof Error ? e.message : String(e))
      } finally {
        resetting.value = false
      }
    }
  })
}

/** 筛选：全部 / 未通关 / 已通关。几十关时「只看没做的」比按顺序翻快得多。 */
type Filter = 'all' | 'todo' | 'done'
const filter = ref<Filter>('all')
const query = ref('')

const chapters = computed(() => {
  const out: { key: string; title: string; rows: ProjectLevelCard[] }[] = []
  const map = new Map<string, { key: string; title: string; rows: ProjectLevelCard[] }>()
  for (const lv of levels.value) {
    const key = lv.chapter?.key ?? '_main'
    const title = lv.chapter?.title ?? '主线'
    let ch = map.get(key)
    if (!ch) {
      ch = { key, title, rows: [] }
      map.set(key, ch)
      out.push(ch)
    }
    ch.rows.push(lv)
  }
  return out
})

const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  return chapters.value
    .map((ch) => ({
      ...ch,
      rows: ch.rows.filter((lv) => {
        if (filter.value === 'done' && !lv.done) return false
        if (filter.value === 'todo' && lv.done) return false
        if (!q) return true
        return (
          lv.title.toLowerCase().includes(q) ||
          lv.goal.toLowerCase().includes(q) ||
          lv.nodes.some((id) => id.toLowerCase().includes(q))
        )
      })
    }))
    .filter((ch) => ch.rows.length)
})
const shownCount = computed(() => shown.value.reduce((n, ch) => n + ch.rows.length, 0))
const doneIn = (rows: ProjectLevelCard[]) => rows.filter((lv) => lv.done).length

/**
 * 章节里实际包含哪几关（如「1–7、9」）。
 *
 * 一关归哪个章，看的是它声明的知识点 topic，不是关卡序号：一个项目里章可能被
 * 后面的关「回头」再进一次（mini-vue 第 9 关 computed 又属于响应式）。
 * 直接写「第 1–9 关」会骗人，所以按实际编号压缩成区间列出来。
 */
function rangeLabel(rows: ProjectLevelCard[]): string {
  const nums = rows.map((r) => r.index + 1)
  if (!nums.length) return ''
  const out: string[] = []
  let start = nums[0]
  let prev = nums[0]
  for (let i = 1; i < nums.length; i++) {
    const n = nums[i]
    if (n === prev + 1) { prev = n; continue }
    out.push(start === prev ? `${start}` : `${start}–${prev}`)
    start = prev = n
  }
  out.push(start === prev ? `${start}` : `${start}–${prev}`)
  return out.join('、')
}

/**
 * 进页面时把当前该做的那关滚进视野。
 * 关卡多了以后「我在第 24 关，打开却停在第 1 关」会让人先找一遍路。
 * 只在首次进页面做，返回时不抢滚动位置（用户可能正在回看前面的关）。
 */
const firstScroll = ref(true)
function scrollToCurrent() {
  if (!firstScroll.value) return
  firstScroll.value = false
  void nextTick(() => {
    const el = document.querySelector('.lv-tile.current')
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  })
}

onMounted(() => { void load().then(scrollToCurrent) })
// 从工作台通关后返回地图：KeepAlive 复用了旧实例，必须重新拉一次进度
onActivated(() => { if (loaded.value) void load(true) })
</script>

<template>
  <div class="page page-narrow board-page">
    <div v-if="loading" class="card sk-card">
      <div class="skeleton sk-line" style="width:30%" />
      <div class="skeleton sk-line" style="width:64%;margin-top:10px" />
      <div class="skeleton sk-block" style="margin-top:18px;height:150px" />
    </div>

    <div v-else-if="error || !detail" class="empty card error">
      <span class="ic"><Icon name="alert" :size="26" /></span>
      <span class="t">这个项目打不开</span>
      <span class="d">{{ error || '项目不存在，可能内容文件被移走了。' }}</span>
      <span class="cta">
        <button class="btn" @click="retryLoad"><Icon name="refresh" :size="14" /> 重试</button>
        <button class="btn ghost" @click="back"><Icon name="arrowLeft" :size="14" /> 回项目列表</button>
      </span>
    </div>

    <template v-else>
      <header class="board-head">
        <span class="board-emoji" aria-hidden="true">{{ detail.emoji }}</span>
        <div class="grow col">
          <div class="board-titlerow">
            <h1>{{ detail.title }}</h1>
            <span v-if="detail.finished" class="pill ok"><Icon name="trophy" :size="12" /> 全部通关</span>
          </div>
          <p>{{ detail.tagline }}</p>
          <div class="row board-meta">
            <span v-for="s in detail.stack" :key="s" class="pill lock">{{ s }}</span>
            <span class="pill purple"><Icon name="layers" :size="12" /> {{ detail.levelCount }} 关</span>
            <span v-if="detail.nodeCount" class="pill purple" :title="`这个项目讲透了知识图谱里的 ${detail.nodeCount} 个知识点`">
              <Icon name="brain" :size="12" /> {{ detail.nodeCount }} 个知识点
            </span>
          </div>
        </div>
        <div class="board-prog">
          <div class="board-prog-num">
            <b class="num">{{ doneCount }}</b><span class="faint num">/ {{ detail.levelCount }} 关</span>
          </div>
          <div class="bar accent"><i :style="{ width: `${pct}%` }" /></div>
          <span class="micro faint">{{ pct }}%</span>
        </div>
        <!-- 从零重做原来只在地图页最底部，9 关时它在首屏之外，看起来就像「没有重来的入口」；
             放到页头跟着进度一起出现，想重来的人第一眼就能找到 -->
        <button
          class="btn ghost board-reset" type="button"
          :disabled="resetting || !hasAnyProgress"
          :title="hasAnyProgress ? '清空这个项目全部关卡的通关状态与草稿，从第 1 关重新开始' : '这个项目还没开始，不用重做'"
          @click="resetAll"
        >
          <Icon name="refresh" :size="13" /> {{ resetting ? '重置中…' : '从零重做' }}
        </button>
      </header>

      <div v-if="detail.finished" class="finish-banner">
        <span class="finish-ic"><Icon name="trophy" :size="28" /></span>
        <div class="grow col">
          <b>这个项目你已经全部做完</b>
          <span class="tiny muted">每一关都通过过。可以点任意方格回去复盘，看看当时是怎么写的。</span>
        </div>
        <button v-if="levels.length" class="btn" @click="openLevel(levels[0])">
          <Icon name="book" :size="14" /> 回顾第 1 关
        </button>
      </div>

      <!-- 粘在顶上的工具条：筛状态 + 搜标题/知识点。33 关以上时它是唯一比滚动条快的入口 -->
      <div class="board-bar">
        <div class="seg" role="tablist" aria-label="筛选关卡">
          <button type="button" :class="{ on: filter === 'all' }" @click="filter = 'all'">
            全部 <span class="n">{{ levels.length }}</span>
          </button>
          <button type="button" :class="{ on: filter === 'todo' }" @click="filter = 'todo'">
            没做 <span class="n">{{ todoCount }}</span>
          </button>
          <button type="button" :class="{ on: filter === 'done' }" @click="filter = 'done'">
            已通关 <span class="n">{{ doneCount }}</span>
          </button>
        </div>
        <label class="lv-search">
          <Icon name="search" :size="14" class="faint" />
          <input v-model="query" type="search" placeholder="搜关卡标题或知识点 id" aria-label="搜索关卡" />
        </label>
        <span class="grow" />
        <span class="micro faint">{{ shownCount }} 关在显示</span>
      </div>

      <div v-if="shown.length" class="chapters">
        <section v-for="ch in shown" :key="ch.key" class="chapter card">
          <header class="chapter-head">
            <h3>{{ ch.title }}</h3>
            <span class="micro faint">关 {{ rangeLabel(ch.rows) }} · 已过 {{ doneIn(ch.rows) }}</span>
          </header>

          <div class="lv-grid">
            <button
              v-for="lv in ch.rows" :key="lv.id"
              type="button"
              class="lv-tile"
              :class="{ done: lv.done, current: isCurrent(lv), locked: !lv.unlocked }"
              :disabled="!lv.unlocked"
              :aria-label="lv.done ? `复盘第 ${lv.index + 1} 关：${lv.title}` : lv.unlocked ? `进入第 ${lv.index + 1} 关：${lv.title}` : `第 ${lv.index + 1} 关尚未解锁`"
              :title="`第 ${lv.index + 1} 关 · ${lv.title}`"
              @click="openLevel(lv)"
            >
              <span class="lv-tile-top">
                <span class="lv-tile-no num">{{ lv.index + 1 }}</span>
                <span class="lv-tile-emoji" aria-hidden="true">{{ lv.emoji }}</span>
                <span class="lv-tile-state">
                  <Icon v-if="lv.done" name="check" :size="15" />
                  <Icon v-else-if="isCurrent(lv)" name="play" :size="14" />
                  <Icon v-else-if="!lv.unlocked" name="lock" :size="13" />
                </span>
              </span>
              <span class="lv-tile-title">{{ lv.title }}</span>
              <span class="lv-tile-meta">
                <span class="num">{{ lv.xp }} XP</span>
                <span class="dot" aria-hidden="true">·</span>
                <span>{{ lv.caseCount }} 检查点</span>
                <template v-if="lv.nodes.length">
                  <span class="dot" aria-hidden="true">·</span>
                  <span class="lv-tile-nodes num">{{ lv.nodes.length }} 知识点</span>
                </template>
              </span>
              <span v-if="isCurrent(lv)" class="lv-tile-flag">现在做这关</span>
              <span v-else-if="!lv.unlocked" class="lv-tile-flag muted">通关上一关后解锁</span>
            </button>
          </div>
        </section>
      </div>

      <div v-else class="empty card">
        <span class="ic"><Icon name="search" :size="24" /></span>
        <span class="t">没有符合条件的关卡</span>
        <span class="d">换个关键词，或把筛选切回「全部」。</span>
        <span class="cta">
          <button class="btn ghost" type="button" @click="filter = 'all'; query = ''">
            <Icon name="refresh" :size="14" /> 清空筛选
          </button>
        </span>
      </div>

      <p v-if="detail.outcome" class="outcome">
        <Icon name="flag" :size="14" class="outcome-ic" />
        <span>{{ detail.outcome }}</span>
      </p>

      <footer class="board-foot">
        <span class="micro faint">想从第 1 关重来：点页头右上角的「从零重做」，会清空全部关卡进度与草稿</span>
        <span class="grow" />
        <button class="btn ghost" type="button" @click="goGlobalReset">
          <Icon name="refresh" :size="13" /> 整个 App 从头开始
        </button>
        <button class="btn ghost" @click="back"><Icon name="arrowLeft" :size="14" /> 返回项目列表</button>
      </footer>
    </template>
  </div>
</template>

<style scoped>
.board-page { align-content: start }
.sk-card { display: block }

.board-head {
  display: flex; align-items: center; gap: var(--sp-4);
  padding: var(--sp-4) var(--sp-5);
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg);
  box-shadow: var(--sh-1);
}
.board-emoji {
  width: 58px; height: 58px; flex: 0 0 58px;
  display: grid; place-content: center;
  font-size: 29px; line-height: 1;
  border-radius: var(--r-lg);
  background: color-mix(in oklab, var(--accent) 9%, var(--surface-2));
  border: 1px solid var(--border);
}
.board-titlerow { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap }
.board-head h1 { margin: 0; font-size: var(--fs-xl); letter-spacing: -.02em }
.board-head p { margin: 0; color: var(--text-dim); font-size: var(--fs-sm); line-height: 1.6 }
.board-meta { margin-top: 2px }
.board-prog { flex: 0 0 152px; display: grid; gap: 6px }
.board-prog .bar { height: 7px }
.board-prog-num { display: flex; align-items: baseline; gap: 5px; font-size: var(--fs-sm); color: var(--text-dim) }
.board-prog-num b { font-size: var(--fs-lg); color: var(--text) }
.board-prog .micro { text-align: right }

.finish-banner {
  display: flex; align-items: center; gap: var(--sp-4);
  padding: var(--sp-4) var(--sp-5);
  border: 1px solid color-mix(in oklab, var(--ok) 34%, var(--border));
  border-left: 3px solid var(--ok);
  border-radius: var(--r-lg);
  background: color-mix(in oklab, var(--ok) 7%, var(--surface));
}
.finish-ic { color: var(--ok); flex: 0 0 auto }
.finish-banner b { font-size: var(--fs-md) }
.finish-banner .col { gap: 3px }

/* ---------- 粘顶工具条 ---------- */
.board-bar {
  position: sticky; top: calc(var(--sp-5) * -1); z-index: 6;
  display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap;
  padding: var(--sp-2) 0;
  background: color-mix(in oklab, var(--bg) 92%, transparent);
  backdrop-filter: blur(10px) saturate(1.3);
  border-bottom: 1px solid var(--border);
}
.seg { display: inline-flex; gap: 2px; padding: 3px; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--r-pill) }
.seg button {
  border: 0; background: transparent; font: inherit; font-size: var(--fs-sm); color: var(--text-dim);
  padding: 4px 11px; border-radius: var(--r-pill); cursor: pointer;
  display: inline-flex; align-items: center; gap: 5px;
  transition: background-color var(--dur-fast), color var(--dur-fast);
}
.seg button:hover { color: var(--text) }
.seg button.on { background: var(--surface); color: var(--text); box-shadow: var(--sh-1); font-weight: 600 }
.seg .n { font-size: var(--fs-xs); color: var(--text-faint); font-variant-numeric: tabular-nums }
.seg button.on .n { color: var(--accent-2) }
.lv-search {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 11px; min-width: 190px;
  border: 1px solid var(--border); border-radius: var(--r-pill); background: var(--surface);
  transition: border-color var(--dur-fast), box-shadow var(--dur-fast);
}
.lv-search:focus-within { border-color: var(--accent); box-shadow: var(--ring-soft) }
.lv-search input { border: 0; outline: 0; background: transparent; font: inherit; font-size: var(--fs-sm); color: var(--text); width: 100%; min-width: 0 }
.lv-search input::placeholder { color: var(--text-faint) }

/* ---------- 章节网格 ---------- */
.chapters { display: grid; gap: var(--sp-4) }
.chapter { padding: var(--sp-4); display: grid; gap: var(--sp-3) }
.chapter-head { display: flex; align-items: baseline; gap: var(--sp-3); flex-wrap: wrap }
.chapter-head h3 { margin: 0; font-size: var(--fs-md); font-weight: 650; letter-spacing: -.01em }
.lv-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: var(--sp-2) }

.lv-tile {
  position: relative;
  display: grid; gap: 6px; align-content: start;
  min-height: 108px;
  padding: var(--sp-3);
  border: 1px solid var(--border); border-radius: var(--r-md);
  background: var(--surface-2); color: var(--text);
  font: inherit; text-align: left; cursor: pointer;
  transition: border-color var(--dur-fast), box-shadow var(--dur-fast), transform var(--dur-fast) var(--ease-out), background-color var(--dur-fast);
}
.lv-tile:hover:not(:disabled) {
  border-color: color-mix(in oklab, var(--accent) 40%, var(--border));
  background: var(--surface);
  box-shadow: var(--sh-1);
  transform: translateY(-1px);
}
.lv-tile:active:not(:disabled) { transform: scale(.995) }
.lv-tile:focus-visible { box-shadow: var(--ring) }
.lv-tile.done { border-color: color-mix(in oklab, var(--ok) 30%, var(--border)); background: color-mix(in oklab, var(--ok) 5%, var(--surface)) }
.lv-tile.current {
  border-color: var(--accent);
  background: var(--surface);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 15%, transparent), var(--sh-1);
}
.lv-tile.locked {
  cursor: not-allowed; color: var(--text-faint);
  background: repeating-linear-gradient(135deg, var(--surface-2) 0 8px, var(--surface-3) 8px 16px);
  box-shadow: none;
}

.lv-tile-top { display: flex; align-items: center; gap: 6px }
.lv-tile-no {
  width: 21px; height: 21px; flex: 0 0 21px;
  display: grid; place-content: center;
  border-radius: 50%; background: var(--surface-3);
  font-size: var(--fs-xs); font-weight: 700; color: var(--text-dim);
}
.lv-tile.done .lv-tile-no { background: color-mix(in oklab, var(--ok) 15%, var(--surface)); color: var(--ok) }
.lv-tile.current .lv-tile-no { background: color-mix(in oklab, var(--accent) 16%, var(--surface)); color: var(--accent-2) }
.lv-tile-emoji { font-size: 14px; line-height: 1 }
.lv-tile-state { margin-left: auto; color: var(--ok); display: inline-flex }
.lv-tile.current .lv-tile-state { color: var(--accent-2) }
.lv-tile.locked .lv-tile-state { color: var(--text-faint) }

.lv-tile-title {
  font-size: var(--fs-sm); font-weight: 620; line-height: 1.45;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  min-height: calc(1.45em * 2);
}
.lv-tile-meta {
  display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
  font-size: var(--fs-xs); color: var(--text-faint);
}
.lv-tile-meta .dot { opacity: .5 }
.lv-tile-nodes { color: color-mix(in oklab, var(--purple) 80%, var(--text-faint)) }
.lv-tile-flag {
  font-size: var(--fs-xs); font-weight: 650; color: var(--accent-2);
  display: inline-flex; align-items: center; gap: 4px;
}
.lv-tile-flag.muted { color: var(--text-faint); font-weight: 500 }

.outcome {
  display: flex; align-items: flex-start; gap: 7px;
  margin: 0; padding: var(--sp-3) var(--sp-4);
  color: var(--text-dim); font-size: var(--fs-sm); line-height: 1.65;
  border: 1px dashed var(--border-2); border-radius: var(--r-md);
}
.outcome-ic { color: var(--purple); margin-top: 2px; flex: 0 0 auto }

.board-foot { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap; padding-top: var(--sp-2) }
/* 页头右侧的「从零重做」：常驻可见，用危险色描边区分于普通操作，但不用实心红抢标题的视觉重量 */
.board-reset { flex: 0 0 auto; color: var(--bad); border-color: color-mix(in oklab, var(--bad) 30%, var(--border)) }
.board-reset:hover:not(:disabled) { background: color-mix(in oklab, var(--bad) 8%, transparent); border-color: var(--bad) }
.board-reset:disabled { color: var(--text-faint); border-color: var(--border) }

@media (max-width: 760px) {
  .board-head { flex-wrap: wrap }
  .board-prog { flex: 1 1 100% }
  .board-prog .micro { text-align: left }
  .lv-grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)) }
  .lv-search { flex: 1 1 100%; min-width: 0 }
}
</style>