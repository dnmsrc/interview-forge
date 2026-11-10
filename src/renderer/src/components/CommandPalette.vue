<script setup lang="ts">
/**
 * ⌘K 命令面板：现代桌面应用的统一入口（Linear/Raycast 范式）。
 * 三组结果：页面跳转 · 全局动作 · 考点检索（graph.tree 懒加载一次后本地过滤）。
 * 可达性：role=listbox + aria-selected + aria-live 播报结果数；关闭走「常驻节点 + class」
 * 以便有 120ms 淡出，同时避开 Vue transition 在 dev HMR 下 leave 悬挂的老坑。
 */
import { computed, ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import Icon from './Icon.vue'
import { useForgeStore } from '../store'
import { ipc } from '../lib/ipc'
import { toast, downloadText } from '../lib/ui'
import { useNaiveTheme } from '../lib/theme'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>()
const router = useRouter()
const store = useForgeStore()
const theme = useNaiveTheme()

const q = ref('')
const idx = ref(0)
const inputEl = ref<HTMLInputElement | null>(null)
const mounted = ref(false)
const leaving = ref(false)
let openTimer: ReturnType<typeof setTimeout> | null = null
type Item = { id: string; group: string; icon: string; label: string; hint?: string; run: () => void }
let nodesFlat: { id: string; title: string; level: number; domain: string }[] = []
let nodesLoading = false
const nodesErr = ref('')

const NAV = [
  { to: '/', title: '今日', icon: 'flame' },
  { to: '/practice', title: '练习模式', icon: 'pen' },
  { to: '/exam', title: '闭卷考试', icon: 'timer' },
  { to: '/graph', title: '知识图谱', icon: 'graph' },
  { to: '/dashboard', title: '数据面板', icon: 'chart' },
  { to: '/bank', title: '题库·版本', icon: 'folder' },
  { to: '/settings', title: '设置', icon: 'gear' }
]

async function loadNodes() {
  if (nodesFlat.length || nodesLoading) return
  nodesLoading = true
  try {
    const tree = await ipc.graph.tree()
    const out: typeof nodesFlat = []
    const walk = (list: any[], domain = '') => {
      for (const n of list ?? []) {
        out.push({ id: n.id, title: n.title, level: n.level ?? 4, domain: domain || n.domain || '' })
        if (n.children?.length) walk(n.children, domain || n.domain || '')
      }
    }
    walk(tree as any[])
    nodesFlat = out
  } catch (e: any) {
    nodesErr.value = String(e?.message ?? e)
  } finally {
    nodesLoading = false
  }
}

function go(to: string) { void router.push(to); close() }
const ACTIONS = computed<Item[]>(() => [
  { id: 'a-today', group: '动作', icon: 'zap', label: '开始今日队列', hint: '进入练习', run: () => { void router.push({ path: '/practice', query: { today: '1' } }); close() } },
  { id: 'a-gap', group: '动作', icon: 'target', label: '查看必考缺口', hint: '图谱', run: () => { void router.push({ path: '/graph', query: { gap: '1' } }); close() } },
  {
    id: 'a-weekly', group: '动作', icon: 'download', label: '导出本周周报', hint: 'Markdown', run: async () => {
      close()
      const r = await ipc.daily.exportWeekly()
      downloadText(`面试熔炉周报-${new Date().toISOString().slice(0, 10)}.md`, r.markdown)
      toast.ok(`已导出：${r.path}`)
    }
  },
  {
    id: 'a-theme', group: '动作', icon: theme.isDark.value ? 'sun' : 'moon',
    label: `切换外观：当前 ${theme.themeMode.value === 'auto' ? '跟随系统' : theme.isDark.value ? '深色' : '浅色'}`,
    hint: '⌥T', run: () => { theme.cycle(); close() }
  },
  {
    id: 'a-refresh', group: '动作', icon: 'refresh', label: '刷新数据', hint: '题库 + 今日', run: async () => {
      close()
      await Promise.all([store.loadBank(), store.loadPlan()])
      toast.ok('已刷新')
    }
  }
])

/** 简易模糊匹配：子序列命中即可（不引第三方 fuzzy 库），并给命中片段做 <mark> 高亮 */
function hit(text: string, kw: string): boolean {
  if (!kw) return true
  const t = text.toLowerCase()
  if (t.includes(kw)) return true
  let i = 0
  for (const ch of kw) {
    const at = t.indexOf(ch, i)
    if (at < 0) return false
    i = at + 1
  }
  return true
}
function hl(text: string): string {
  const kw = q.value.trim().toLowerCase()
  if (!kw) return escHtml(text)
  const t = text.toLowerCase()
  const at = t.indexOf(kw)
  if (at >= 0) return `${escHtml(text.slice(0, at))}<mark>${escHtml(text.slice(at, at + kw.length))}</mark>${escHtml(text.slice(at + kw.length))}`
  let out = ''
  let i = 0
  for (const ch of text) {
    if (i < kw.length && ch.toLowerCase() === kw[i]) { out += `<mark>${escHtml(ch)}</mark>`; i++ } else out += escHtml(ch)
  }
  return out
}
const escHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

const items = computed<Item[]>(() => {
  const kw = q.value.trim().toLowerCase()
  const nav: Item[] = NAV.filter((n) => hit(n.title, kw)).map((n) => ({ id: `n-${n.to}`, group: '前往', icon: n.icon, label: n.title, run: () => go(n.to) }))
  const acts: Item[] = ACTIONS.value.filter((a) => hit(a.label, kw))
  const nds: Item[] = !kw || kw.length < 2 ? [] : nodesFlat
    .filter((n) => n.level >= 3 && hit(n.title, kw))
    .sort((a, b) => a.title.length - b.title.length)
    .slice(0, 9)
    .map((n) => ({ id: `d-${n.id}`, group: '考点', icon: 'route', label: n.title, hint: `L${n.level}`, run: () => { void router.push({ path: '/graph', query: { node: n.id } }); close() } }))
  return [...nav, ...acts, ...nds]
})
const grouped = computed(() => {
  const m = new Map<string, Item[]>()
  items.value.forEach((it) => m.set(it.group, [...(m.get(it.group) ?? []), it]))
  return [...m.entries()].map(([group, list]) => ({ group, list }))
})
const live = computed(() => (props.show ? `${items.value.length} 个结果${q.value ? `，关键词 ${q.value}` : ''}` : ''))

function close() { emit('update:show', false) }
function move(d: number) {
  const n = items.value.length
  if (!n) return
  idx.value = (idx.value + d + n) % n
  void nextTick(() => document.querySelector('.cmdk .it.on')?.scrollIntoView({ block: 'nearest' }))
}
function enter() { items.value[idx.value]?.run() }
function onKey(e: KeyboardEvent) {
  if (!props.show) return
  if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) { e.preventDefault(); move(1) }
  else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) { e.preventDefault(); move(-1) }
  else if (e.key === 'Enter') { e.preventDefault(); enter() }
  else if (e.key === 'Escape') { e.preventDefault(); close() }
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => { window.removeEventListener('keydown', onKey); if (openTimer) clearTimeout(openTimer) })

watch(() => props.show, (v) => {
  if (openTimer) { clearTimeout(openTimer); openTimer = null }
  if (v) {
    mounted.value = true
    leaving.value = false
    q.value = ''; idx.value = 0
    void loadNodes()
    void nextTick(() => inputEl.value?.focus())
  } else if (mounted.value) {
    // 只淡出容器与内容，不做位移；120ms 后卸载
    leaving.value = true
    openTimer = setTimeout(() => { mounted.value = false; leaving.value = false }, 140)
  }
})
watch(q, () => { idx.value = 0 })
</script>

<template>
  <Teleport to="body">
    <div v-if="mounted" class="cmdk-mask" :class="{ leaving }" @click.self="close" @mousedown.self="close">
      <div class="cmdk" role="dialog" aria-modal="true" aria-label="命令面板">
        <div class="cmdk-search">
          <Icon name="search" :size="17" class="faint" />
          <input
            ref="inputEl" v-model="q" placeholder="搜索页面、动作或考点…" spellcheck="false"
            role="combobox" aria-controls="cmdk-list" aria-expanded="true" :aria-activedescendant="items[idx]?.id ?? ''"
          />
          <kbd class="kbd">esc</kbd>
        </div>
        <div id="cmdk-list" class="list" role="listbox" :aria-busy="nodesLoading">
          <template v-for="g in grouped" :key="g.group">
            <div class="grp">{{ g.group }}</div>
            <div
              v-for="it in g.list" :key="it.id" :id="it.id"
              class="it" :class="{ on: items[idx]?.id === it.id }" role="option" tabindex="-1"
              :aria-selected="items[idx]?.id === it.id"
              @mouseenter="idx = items.findIndex((x) => x.id === it.id)" @click="it.run()"
            >
              <span class="ic"><Icon :name="it.icon" :size="16" /></span>
              <!-- eslint-disable-next-line vue/no-v-html —— hl() 内部已 escapeHtml -->
              <span class="grow ellip" v-html="hl(it.label)" />
              <span v-if="it.hint" class="micro faint">{{ it.hint }}</span>
            </div>
          </template>
          <div v-if="!items.length" class="empty" :class="{ error: !!nodesErr }">
            <span class="ic"><Icon :name="nodesErr ? 'alert' : 'search'" :size="22" /></span>
            <div class="t">{{ nodesErr ? '考点索引载入失败' : '没有匹配项' }}</div>
            <div class="d">{{ nodesErr || '换个关键词试试，或用 ↑↓ 选择其它分组' }}</div>
            <div class="cta">
              <button class="btn" @click="nodesErr ? loadNodes() : (q = '')">
                <Icon :name="nodesErr ? 'refresh' : 'close'" :size="14" /> {{ nodesErr ? '重试载入' : '清空关键词' }}
              </button>
            </div>
          </div>
        </div>
        <div class="foot">
          <span><kbd class="kbd">↑</kbd><kbd class="kbd">↓</kbd> 选择</span>
          <span><kbd class="kbd">enter</kbd> 执行</span>
          <span><kbd class="kbd">⌘K</kbd> 随时呼出</span>
          <span class="grow" />
          <span>{{ items.length }} 项</span>
        </div>
      </div>
    </div>
    <span class="sr-only" role="status" aria-live="polite">{{ live }}</span>
  </Teleport>
</template>

<style scoped>
.cmdk-search { display: flex; align-items: center; gap: 10px; padding: 0 var(--sp-5); border-bottom: 1px solid var(--border) }
.cmdk-search input { padding-left: 0 }
.cmdk .it .ic { color: var(--text-faint) }
.cmdk .it.on .ic { color: var(--accent-2) }
.cmdk .it mark { background: color-mix(in oklab, var(--accent) 26%, transparent); color: inherit; border-radius: 3px; padding: 0 1px }
.cmdk .foot .grow { flex: 1 }
.sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0 }
</style>
