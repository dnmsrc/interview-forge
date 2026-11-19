<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '../components/Icon.vue'
import { dialog, toast } from '../lib/ui'
import { ipc } from '../lib/ipc'
import type { ProjectDetail, ProjectLevelCard } from '@shared/api'

/**
 * 关卡地图：一个项目一条纵向闯关路径。
 * 状态只有三种可见态——已通关 / 这一关现在能做 / 还没解锁。
 * 不再拆「已尝试但没通过」这种中间态：attempts 只在内容上提示，不参与解锁判定。
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

onMounted(() => { void load() })
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
          </div>
        </div>
        <div class="board-prog">
          <div class="board-prog-num">
            <b class="num">{{ detail.doneCount }}</b><span class="faint num">/ {{ detail.levelCount }} 关</span>
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

      <p v-if="detail.intro" class="intro card flat">{{ detail.intro }}</p>

      <div v-if="detail.finished" class="finish-banner">
        <span class="finish-ic"><Icon name="trophy" :size="28" /></span>
        <div class="grow col">
          <b>这个项目你已经全部做完</b>
          <span class="tiny muted">每一关都通过过。可以点任意节点回去复盘，看看当时是怎么写的。</span>
        </div>
        <button v-if="levels.length" class="btn" @click="openLevel(levels[0])">
          <Icon name="book" :size="14" /> 回顾第 1 关
        </button>
      </div>

      <div class="section-title">关卡路径</div>

      <ol class="lv-path">
        <li
          v-for="lv in levels" :key="lv.id"
          class="lv-step"
          :class="{ done: lv.done, current: isCurrent(lv), locked: !lv.unlocked }"
        >
          <div class="lv-rail">
            <span
              class="lv-node"
              :class="{ done: lv.done, current: isCurrent(lv), locked: !lv.unlocked }"
              :title="lv.done ? '已通关' : lv.unlocked ? '可以开始' : '还没解锁'"
            >
              <Icon v-if="lv.done" name="check" :size="20" />
              <Icon v-else-if="!lv.unlocked" name="lock" :size="17" />
              <span v-else class="num lv-node-no">{{ lv.index + 1 }}</span>
            </span>
          </div>

          <button
            type="button"
            class="lv-card"
            :disabled="!lv.unlocked"
            :aria-label="lv.done ? `复盘第 ${lv.index + 1} 关：${lv.title}` : lv.unlocked ? `进入第 ${lv.index + 1} 关：${lv.title}` : `第 ${lv.index + 1} 关尚未解锁`"
            @click="openLevel(lv)"
          >
            <div class="lv-card-top">
              <span class="lv-no">第 {{ lv.index + 1 }} 关</span>
              <span class="lv-emoji" aria-hidden="true">{{ lv.emoji }}</span>
              <span class="lv-title ellip" :title="lv.title">{{ lv.title }}</span>
              <span v-if="lv.done" class="pill ok"><Icon name="check" :size="11" /> 已通关</span>
              <span v-else-if="isCurrent(lv)" class="pill info"><Icon name="play" :size="11" /> 现在做这关</span>
              <span v-else class="pill lock"><Icon name="lock" :size="11" /> 未解锁</span>
            </div>

            <div class="lv-card-meta">
              <span class="pill purple"><Icon name="zap" :size="11" /> {{ lv.xp }} XP</span>
              <span class="pill lock"><Icon name="target" :size="11" /> {{ lv.caseCount }} 个检查点</span>
              <span v-if="lv.attempts > 0" class="micro faint">已尝试 {{ lv.attempts }} 次</span>
              <span class="grow" />
              <span v-if="lv.done" class="lv-go">复盘 <Icon name="arrowRight" :size="13" /></span>
              <span v-else-if="!lv.unlocked" class="lv-go locked-txt">通关第 {{ lv.index }} 关后解锁</span>
              <span v-else class="lv-go">进入 <Icon name="arrowRight" :size="13" /></span>
            </div>
          </button>
        </li>
      </ol>

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
  width: 60px; height: 60px; flex: 0 0 60px;
  display: grid; place-content: center;
  font-size: 30px; line-height: 1;
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

.intro { margin: 0; color: var(--text-dim); font-size: var(--fs-sm); line-height: 1.75; background: var(--surface-2) }

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

/* ---------- 纵向关卡路径 ---------- */
.lv-path { list-style: none; margin: 0; padding: 0; display: grid }
.lv-step {
  position: relative;
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  gap: var(--sp-3);
  padding-bottom: var(--sp-4);
}
/* 连接线：从本节点圆环下沿连到下一节点，已通关的一段走 --ok */
.lv-step:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 25px;
  top: 44px;
  bottom: 0;
  width: 2px;
  border-radius: 2px;
  background: var(--border);
}
.lv-step.done:not(:last-child)::before { background: var(--ok) }

.lv-rail { display: flex; justify-content: center; padding-top: 2px }
.lv-node {
  position: relative;
  z-index: 1;
  width: 44px; height: 44px;
  display: grid; place-content: center;
  border-radius: 50%;
  background: var(--surface-2);
  border: 2px solid var(--border-2);
  color: var(--text-dim);
  font-weight: 700;
}
.lv-node.done {
  color: var(--ok);
  border-color: var(--ok);
  background: color-mix(in oklab, var(--ok) 13%, var(--surface));
}
.lv-node.current {
  color: var(--accent-2);
  border-color: var(--accent);
  background: color-mix(in oklab, var(--accent) 10%, var(--surface));
  box-shadow: var(--ring-soft);
  animation: node-pulse 2.2s var(--ease-in-out) infinite;
}
.lv-node.locked { color: var(--text-faint); background: var(--surface-3) }
.lv-node-no { font-size: var(--fs-md) }
@keyframes node-pulse {
  0%, 100% { box-shadow: 0 0 0 2px color-mix(in oklab, var(--accent) 14%, transparent) }
  50% { box-shadow: 0 0 0 7px color-mix(in oklab, var(--accent) 0%, transparent) }
}

.lv-card {
  width: 100%;
  min-width: 0;
  text-align: left;
  font: inherit;
  color: var(--text);
  padding: var(--sp-3) var(--sp-4);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  background: var(--surface);
  box-shadow: var(--sh-1);
  cursor: pointer;
  transition: border-color var(--dur-fast), box-shadow var(--dur-fast), transform var(--dur-fast) var(--ease-out), background-color var(--dur-fast);
}
.lv-card:hover:not(:disabled) {
  border-color: color-mix(in oklab, var(--accent) 38%, var(--border));
  box-shadow: var(--sh-2);
  transform: translateY(-1px);
}
.lv-card:active:not(:disabled) { transform: scale(.995) }
.lv-card:focus-visible { box-shadow: var(--ring) }
.lv-step.done .lv-card { border-color: color-mix(in oklab, var(--ok) 26%, var(--border)) }
.lv-step.current .lv-card {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 16%, transparent), var(--sh-1);
}
.lv-step.locked .lv-card {
  cursor: not-allowed;
  color: var(--text-faint);
  background: repeating-linear-gradient(135deg, var(--surface) 0 8px, var(--surface-2) 8px 16px);
  box-shadow: none;
}

.lv-card-top { display: flex; align-items: center; gap: 7px; flex-wrap: wrap }
.lv-no { font-size: var(--fs-xs); font-weight: 650; color: var(--text-faint); flex: 0 0 auto }
.lv-emoji { font-size: 16px; line-height: 1; flex: 0 0 auto }
.lv-title { flex: 1 1 140px; min-width: 0; font-size: var(--fs-base); font-weight: 620 }
.lv-card-meta { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; margin-top: 8px }
.lv-go { display: inline-flex; align-items: center; gap: 3px; font-size: var(--fs-xs); font-weight: 600; color: var(--accent-2); flex: 0 0 auto }
.lv-step.locked .lv-go { color: var(--text-faint); font-weight: 500 }
.lv-step.done .lv-go { color: var(--ok) }
.locked-txt { font-weight: 500 }

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
}
@media (prefers-reduced-motion: reduce) {
  .lv-node.current { animation: none }
}
</style>