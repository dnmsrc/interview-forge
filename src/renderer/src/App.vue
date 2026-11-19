<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useForgeStore } from './store'
import Icon from './components/Icon.vue'
import CommandPalette from './components/CommandPalette.vue'
import RiseHost from './components/RiseHost.vue'
import { useNaiveTheme } from './lib/theme'

const store = useForgeStore()
const route = useRoute()
const theme = useNaiveTheme()

const items = [
  { to: '/', title: '今日', icon: 'flame', desc: '按复习进度排好的今日任务' },
  // 项目闯关与做题体系并行：一个从「做出来」入手，一个从「说得清」入手
  { to: '/projects', title: '项目闯关', icon: 'zap', desc: '真敲代码 · 逐关解锁 · 边做边学' },
  { to: '/placement', title: '入门摸底', icon: 'brain', desc: '按先后顺序，找出你卡在哪' },
  { to: '/practice', title: '练习模式', icon: 'pen', desc: '随机抽题 · AI 批改 · 逐层追问' },
  { to: '/mistakes', title: '错题本', icon: 'alert', desc: '汇总答错的题，集中攻克' },
  { to: '/exam', title: '闭卷考试', icon: 'timer', desc: '限时答题，做完看解析' },
  { to: '/graph', title: '知识图谱', icon: 'graph', desc: '考点依赖关系与掌握程度' },
  { to: '/dashboard', title: '数据面板', icon: 'chart', desc: '正确率变化与薄弱点' },
  { to: '/bank', title: '题库·版本', icon: 'folder', desc: '题库版本、快照与回滚' },
  { to: '/settings', title: '设置', icon: 'gear', desc: 'AI 服务、路由与本地数据' }
]
const byPath = new Map(items.map((i) => [i.to, i]))
// 子路由（/projects/:id/:levelId）没有精确匹配项，按前缀归到父级，
// 否则顶栏标题会掉回「练习册」，面包屑也没了
const page = computed(() => byPath.get(route.path) ?? items.find((i) => i.to !== '/' && route.path.startsWith(i.to + '/')))
const title = computed(() => page.value?.title ?? '练习册')
const desc = computed(() => page.value?.desc ?? '')
const due = computed(() => store.plan?.totalPlanned ?? 0)
const gapCount = computed(() => (store.dash ? Math.max(0, store.dash.totals.mustMaster - store.dash.totals.mustMasterLit) : 0))
const litRatio = computed(() => {
  const d = store.dash
  if (!d || !d.totals.nodes) return 0
  return Math.round((d.totals.litNodes / d.totals.nodes) * 100)
})
const runtimeInfo = computed(() => (store.runtime?.electron ? `Electron ${store.runtime.electron}` : ''))

/* ---------- 侧栏折叠：偏好持久化；窄窗口由 CSS 自动收成图标栏 ---------- */
const RAIL_KEY = 'forge.ui.rail'
const rail = ref(localStorage.getItem(RAIL_KEY) === '1')
watch(rail, (v) => localStorage.setItem(RAIL_KEY, v ? '1' : '0'))

/* ---------- ⌘K 命令面板 ---------- */
const cmdk = ref(false)
function onGlobalKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    cmdk.value = !cmdk.value
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
    e.preventDefault()
    rail.value = !rail.value
  } else if (e.altKey && e.key.toLowerCase() === 't') {
    e.preventDefault()
    theme.cycle()
  }
}
onMounted(() => {
  theme.set(theme.themeMode.value)
  window.addEventListener('keydown', onGlobalKey)
  void store.boot()
})
onUnmounted(() => window.removeEventListener('keydown', onGlobalKey))
watch(
  () => route.path,
  (p) => {
    if (p === '/' || p === '/dashboard') void store.loadPlan()
    if (p === '/' || p === '/dashboard' || p === '/graph') void store.loadDash()
  }
)
</script>

<template>
  <n-config-provider :theme="theme.naiveTheme.value" :theme-overrides="theme.themeOverrides.value" :hljs-theme="null">
    <div class="shell" :class="{ rail }">
      <aside class="side">
        <div class="brand">
          <span class="logo"><Icon name="flame" :size="17" /></span>
          <span class="meta">
            <b>练习册</b>
            <small>{{ store.bankStats ? `${store.bankStats.questions} 题 · ${store.bankStats.nodes} 考点` : '装载中…' }}</small>
          </span>
        </div>
        <nav class="nav" aria-label="主导航">
          <div class="nav-label">训练</div>
          <RouterLink
            v-for="i in items.slice(0, 6)" :key="i.to" :to="i.to" custom v-slot="{ navigate, isExactActive }"
          >
            <a :href="i.to" class="nav-item" :class="{ on: isExactActive }" @click="navigate" :title="rail ? i.title : ''">
              <span class="ic"><Icon :name="i.icon" :size="17" /></span>
              <span class="lbl">{{ i.title }}</span>
              <span v-if="i.to === '/' && due > 0" class="dot">{{ due }}</span>
            </a>
          </RouterLink>
          <div class="nav-label">洞察</div>
          <RouterLink v-for="i in items.slice(6)" :key="i.to" :to="i.to" custom v-slot="{ navigate, isExactActive }">
            <a :href="i.to" class="nav-item" :class="{ on: isExactActive }" @click="navigate" :title="rail ? i.title : ''">
              <span class="ic"><Icon :name="i.icon" :size="17" /></span>
              <span class="lbl">{{ i.title }}</span>
              <span v-if="i.to === '/graph' && gapCount > 0" class="dot warn-dot">{{ gapCount }}</span>
            </a>
          </RouterLink>
        </nav>
        <div class="side-foot">
          <div v-if="store.dash" class="foot-block">
            <div class="row2"><span class="micro">考点点亮</span><span class="grow" /><b class="micro num">{{ litRatio }}%</b></div>
            <div class="bar accent" style="margin-top:4px"><i :style="{ width: litRatio + '%' }" /></div>
            <div class="row2" style="margin-top:6px">基础缺口 <b :style="{ color: gapCount ? 'var(--bad)' : 'var(--ok)' }">{{ gapCount }}</b></div>
          </div>
          <div class="row2 foot-block" style="margin-top:8px">
            <span class="dotmark pulse" :style="{ background: store.anyEndpoint ? 'var(--ok)' : 'var(--bad)' }" />
            <span class="grow ellip">{{ store.activeStrong?.label ?? store.activeFast?.label ?? 'AI 未配置' }}</span>
          </div>
          <div v-if="runtimeInfo" class="row2 micro" style="margin-top:6px;opacity:.75">{{ runtimeInfo }}</div>
        </div>
      </aside>

      <div class="main">
        <header class="topbar">
          <button class="icon-btn" :aria-label="rail ? '展开侧栏' : '收起侧栏'" :title="(rail ? '展开侧栏 ' : '收起侧栏 ') + '⌘B'" @click="rail = !rail">
            <Icon name="panelLeft" :size="17" />
          </button>
          <div class="title-block">
            <h2>{{ title }}</h2>
            <div class="sub ellip">{{ desc }}</div>
          </div>
          <div class="kpi-strip">
            <span v-if="store.plan?.streak" class="pill ok"><Icon name="flame" :size="12" /> 连续 {{ store.plan.streak }} 天</span>
            <span v-if="due > 0" class="pill warn"><Icon name="clock" :size="12" /> 今日 {{ due }} 题待清</span>
            <span v-if="!store.anyEndpoint" class="pill bad"><Icon name="alert" :size="12" /> AI 未配置 · 主观题无法批改</span>
          </div>
          <span class="grow" />
          <button class="omni" @click="cmdk = true" aria-label="打开命令面板">
            <Icon name="search" :size="15" class="faint" />
            <span class="omni-t">搜索或跳转…</span>
            <kbd class="kbd">⌘K</kbd>
          </button>
          <button
            class="icon-btn"
            :title="`外观：${theme.themeMode.value === 'auto' ? '跟随系统' : theme.isDark.value ? '深色' : '浅色'}（⌥T 切换）`"
            aria-label="切换外观主题"
            @click="theme.cycle()"
          >
            <Icon :name="theme.isDark.value ? 'moon' : theme.themeMode.value === 'auto' ? 'auto' : 'sun'" :size="17" />
          </button>
          <button class="icon-btn" title="刷新数据" aria-label="刷新数据" @click="() => { store.loadBank(); store.loadPlan(); store.loadDash() }">
            <Icon name="refresh" :size="17" />
          </button>
        </header>
        <!-- 切页必须保留页面状态：之前外层 div 上的 :key="route.path" 会把整棵子树销毁重建，
             于是「只是点一下左侧菜单」练习队列就重新抽题、图谱重新 fitView、考试回到未答状态。
             改成 KeepAlive + 每个路由一个实例（key 仍在，但由 KeepAlive 缓存），进入动画交给 .rise。
             数据新鲜度由各自的 onActivated 负责（Home / Dashboard / Graph）。
             不用 <transition mode="out-in">：dev HMR 替换路由组件时 leave 钩子会悬挂 → 整页 opacity:0「白屏」。 -->
        <div class="view-host">
          <RouterView v-slot="{ Component, route: r }">
            <KeepAlive :max="7">
              <RiseHost :key="r.path">
                <component :is="Component" />
              </RiseHost>
            </KeepAlive>
          </RouterView>
        </div>
      </div>
    </div>
    <CommandPalette v-model:show="cmdk" />
  </n-config-provider>
</template>

<style scoped>
.nav-item {
  position: relative; display: flex; align-items: center; gap: 10px; padding: 8px 10px;
  border-radius: var(--r-md); color: var(--text-dim); text-decoration: none;
  font-size: var(--fs-base); font-weight: 500; cursor: pointer; user-select: none;
  transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
}
.nav-item:hover { background: color-mix(in oklab, var(--surface-3) 70%, transparent); color: var(--text) }
.nav-item:active { transform: scale(.985) }
.nav-item.on { background: var(--surface); color: var(--text); font-weight: 600; box-shadow: var(--sh-1); border: 1px solid var(--border) }
.nav-item.on::before { content: ''; position: absolute; left: -8px; top: 50%; translate: 0 -50%; width: 3px; height: 18px; border-radius: 0 3px 3px 0; background: linear-gradient(180deg, var(--accent), var(--purple)) }
.nav-item .ic { width: 20px; height: 20px; display: grid; place-content: center; color: currentColor; opacity: .82 }
.nav-item.on .ic { opacity: 1; color: var(--accent-2) }
.shell.rail .nav-item { justify-content: center; padding: 9px 0 }
.shell.rail .nav-item .lbl { display: none }
.nav-item .dot { margin-left: auto; min-width: 19px; height: 19px; display: grid; place-content: center; font-size: 10.5px; font-weight: 700; background: var(--bad); color: #fff; border-radius: var(--r-pill); padding: 0 5px; font-variant-numeric: tabular-nums }
.nav-item .dot.warn-dot { background: var(--warn) }
.shell.rail .nav-item .dot { position: absolute; top: 2px; right: 4px; min-width: 15px; height: 15px; padding: 0; margin: 0; font-size: 9.5px }
.side-foot { line-height: 1.6 }
.foot-block { min-width: 0 }
.row2 { display: flex; align-items: center; gap: 6px; min-width: 0 }
.grow { flex: 1 }
.ellip { overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.shell.rail .side-foot .foot-block > *:not(.row2) { display: none }
.shell.rail .side-foot .foot-block { display: none }
.shell.rail .side-foot .row2 { justify-content: center }
.shell.rail .side-foot .row2 span:not(.dotmark) { display: none }

.title-block { min-width: 0; display: grid; gap: 1px }
.kpi-strip { display: flex; align-items: center; gap: var(--sp-2); margin-left: var(--sp-2) }
.kpi-strip .pill svg { opacity: .85 }
@media (max-width: 1080px) { .kpi-strip .pill:nth-child(n + 2) { display: none } }
@media (max-width: 860px) { .kpi-strip { display: none } }

.omni {
  display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 8px 0 10px; min-width: 210px;
  border: 1px solid var(--border); border-radius: var(--r-md); background: var(--surface-2);
  color: var(--text-faint); font: inherit; font-size: var(--fs-sm); cursor: pointer;
  transition: border-color var(--dur-fast), box-shadow var(--dur-fast), background-color var(--dur-fast);
}
.omni:hover { border-color: color-mix(in oklab, var(--accent) 40%, var(--border)); background: var(--surface); box-shadow: var(--sh-1) }
.omni .omni-t { flex: 1; text-align: left }
@media (max-width: 1180px) { .omni { min-width: 0; width: 32px; padding: 0; justify-content: center } .omni .omni-t, .omni kbd { display: none } }

.view-host { flex: 1; min-height: 0; display: flex; flex-direction: column; animation: view-in var(--dur) var(--ease-enter) both }
@keyframes view-in { from { opacity: 0; transform: translateY(6px) } }
</style>
