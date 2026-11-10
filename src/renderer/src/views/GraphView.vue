<script setup lang="ts">
/**
 * 知识图谱（重设计版）——对标 markmap / 学习路线类应用的社区经验：
 * 1. 渐进披露：默认只展开到 L2 模块层，L2 用聚合卡显示「点亮 x/y · 待复习 n」，双击才展开考点；
 * 2. tidy-tree 紧凑布局（父节点垂直居中于子节点区间）替代固定网格，贝塞尔层级连线；
 * 3. 状态一眼可辨：四档掌握度圆点、到期/锁定/必考徽章、点亮绿描边、未解锁灰化；
 * 4. 焦点高亮：点选节点淡出无关分支，只留 根→节点 路径与其后代；
 * 5. 搜索定位：输入关键词自动展开祖先链并聚焦；6. MiniMap 全局位置感。
 */
import { computed, defineComponent, h, markRaw, nextTick, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { VueFlow, useVueFlow, Handle, Position, type Node, type Edge } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'
import { useForgeStore } from '../store'
import Icon from '../components/Icon.vue'
import { DOMAIN_LABEL, TYPE_LABEL, SCALE_LABEL, scale4Color, message } from '../lib/ui'
import { useNaiveTheme } from '../lib/theme'
import { ipc } from '../lib/ipc'

const store = useForgeStore()
const route = useRoute()
const router = useRouter()
const { isDark } = useNaiveTheme()

/**
 * MiniMap 的节点色会写进 SVG 的 fill **属性**，那里 var() 不生效，只能给真实色值；
 * 这是全站唯一允许出现 hex 的地方，因此按 isDark 显式取双主题值（与 chartPalette 同源）。
 */
const miniNodeColor = computed(() => (n: any) => {
  const dark = isDark.value
  if (n.data?.must_master) return dark ? '#a78bfa' : '#8b5cf6'
  if (n.data?.lit) return dark ? '#3fb950' : '#15803d'
  if (n.data?.locked) return dark ? '#454c59' : '#c3ccd6'
  return dark ? '#6b7686' : '#8b949e'
})

const domain = ref<string>((route.query.domain as string) || 'fe')
const rawNodes = ref<any[]>([])
const rawEdges = ref<{ from: string; to: string; type: string }[]>([])
const expanded = ref<Set<string>>(new Set())
const onlyUnlit = ref(false)
const showLegend = ref(true)
const detail = ref<any | null>(null)
const detailLoading = ref(false)
const selId = ref('')
const kw = ref('')

const byParent = computed(() => {
  const m = new Map<string, any[]>()
  for (const n of rawNodes.value) {
    const k = n.parent_id ?? ''
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(n)
  }
  for (const list of m.values()) list.sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0))
  return m
})
const byId = computed(() => new Map(rawNodes.value.map((n) => [n.id, n])))

/** 后代考点(L4)聚合统计：驱动 L1/L2 聚合卡的进度条与徽章 */
const rollup = computed(() => {
  const m = new Map<string, { total: number; lit: number; due: number; must: number; mustLit: number }>()
  for (const n of rawNodes.value) {
    if (n.level !== 4) continue
    let p: string | null = n.id
    while (p) {
      const r = m.get(p) ?? { total: 0, lit: 0, due: 0, must: 0, mustLit: 0 }
      r.total++
      if (n.lit) { r.lit++; if (n.must_master) r.mustLit++ } else if (n.must_master) r.must++
      r.due += n.q_due ?? 0
      m.set(p, r)
      p = byId.value.get(p)?.parent_id ?? null
    }
  }
  return m
})

const visible = computed<any[]>(() => {
  const out: any[] = []
  const walk = (id: string) => {
    for (const k of byParent.value.get(id) ?? []) {
      if (onlyUnlit.value && k.lit) continue
      out.push(k)
      if (expanded.value.has(k.id)) walk(k.id)
    }
  }
  const root = rawNodes.value.find((n) => n.level === 1 && n.domain === domain.value)
  if (root) { out.push(root); walk(root.id) }
  return out
})

// ---- tidy-tree 布局：叶子按高度顺排，父节点垂直居中于首末子节点中点 ----
const SIZE: Record<number, { w: number; h: number }> = {
  1: { w: 216, h: 70 }, 2: { w: 258, h: 88 }, 3: { w: 216, h: 56 }, 4: { w: 286, h: 80 }
}
const XOFF = [0, 300, 620, 900]   // level index-1 → x 偏移（列间距含节点宽）
const V_GAP = 20
const positions = computed(() => {
  const pos = new Map<string, { x: number; y: number }>()
  const kidsOf = new Map<string, any[]>()
  for (const n of visible.value) {
    const k = n.parent_id ?? ''
    if (!kidsOf.has(k)) kidsOf.set(k, [])
    kidsOf.get(k)!.push(n)
  }
  let cursor = 0
  const place = (n: any): number => {
    const kids = kidsOf.get(n.id) ?? []
    const s = SIZE[n.level] ?? SIZE[4]
    let cy: number
    if (!kids.length) {
      cy = cursor + s.h / 2
      cursor += s.h + V_GAP
    } else {
      const centers = kids.map(place)
      cy = (centers[0] + centers[centers.length - 1]) / 2
    }
    pos.set(n.id, { x: XOFF[(n.level ?? 1) - 1] ?? 900, y: cy - s.h / 2 })
    return cy
  }
  const root = visible.value.find((n) => n.level === 1)
  if (root) place(root)
  return pos
})

const nodes = computed<Node[]>(() => visible.value.map((n) => ({
  id: n.id, type: 'forge', position: positions.value.get(n.id) ?? { x: 0, y: 0 }, data: n, draggable: true
})))

// ---- 焦点链路：选中节点的祖先 + 后代保持高亮，其余淡出 ----
const focusSet = computed(() => {
  if (!selId.value) return null
  const keep = new Set<string>([selId.value])
  let cur = byId.value.get(selId.value)
  while (cur?.parent_id) { keep.add(cur.parent_id); cur = byId.value.get(cur.parent_id) }
  const stack = [selId.value]
  while (stack.length) for (const k of byParent.value.get(stack.pop()!) ?? []) { keep.add(k.id); stack.push(k.id) }
  return keep
})
const isDim = (id: string) => !!focusSet.value && !focusSet.value.has(id)

// ---- 边：层级 contains（客户端补画，主进程 edges 排除了 contains）+ prereq/related ----
const edges = computed<Edge[]>(() => {
  const ids = visible.value.map((n) => n.id)
  const set = new Set(ids)
  const hier: Edge[] = []
  for (const id of ids) {
    const p = byId.value.get(id)?.parent_id
    if (!p || !set.has(p)) continue
    const child = byId.value.get(id)
    const onPath = !!focusSet.value && focusSet.value.has(id) && focusSet.value.has(p)
    hier.push({
      id: `h-${p}-${id}`, source: p, target: id, type: 'default', zIndex: 0,
      style: onPath ? { stroke: '#1a7f37', strokeWidth: 2 } : child?.lit ? { stroke: 'rgba(26,127,55,.4)', strokeWidth: 1.6 } : { stroke: 'rgba(101,109,118,.32)', strokeWidth: 1.4 }
    })
  }
  const rel: Edge[] = rawEdges.value
    .filter((e) => set.has(e.from) && set.has(e.to))
    .map((e) => {
      const from = byId.value.get(e.from)
      return {
        id: `${e.from}-${e.to}-${e.type}`, source: e.from, target: e.to, type: 'default',
        animated: !!from?.lit && e.type === 'prereq',
        style: { stroke: e.type === 'prereq' ? 'rgba(130,80,220,.5)' : 'rgba(5,80,174,.35)', strokeWidth: 1.3, strokeDasharray: '5 4', opacity: isDim(e.from) && isDim(e.to) ? .12 : 1 }
      }
    })
  return [...hier, ...rel]
})

/** graphTree 返回嵌套树(children)且字段是 parent，本页布局逻辑基于平铺列表统一展平归一 */
function flattenTree(roots: any[]): any[] {
  const out: any[] = []
  const walk = (list: any[], parentId: string | null) => {
    for (const n of list) {
      out.push({ ...n, parent_id: parentId ?? n.parent ?? null })
      if (Array.isArray(n.children) && n.children.length) walk(n.children, n.id)
    }
  }
  walk(roots, null)
  return out
}

async function load() {
  await store.boot()
  rawNodes.value = flattenTree(await ipc.graph.tree(domain.value))
  rawEdges.value = await ipc.graph.edges(domain.value)
  // 渐进披露（对标 markmap）：默认只展开板块根，L2 以聚合卡呈现，双击才向下钻取——
  // 首屏仅 root + 10 个模块卡，zoom 能保持在可读区间，不再因 L3 全铺而被迫缩到 0.37
  expanded.value = new Set(rawNodes.value.filter((n) => n.level <= 1).map((n) => n.id))
  const target = route.query.node as string
  if (target) {
    expandChain(target)
    selId.value = target
    void openDetail(target)
  }
}
function expandChain(id: string) {
  const s = new Set(expanded.value)
  let cur = byId.value.get(id)
  while (cur?.parent_id) { s.add(cur.parent_id); cur = byId.value.get(cur.parent_id) }
  expanded.value = s
}

// 重大坑（v1.48 实测）：@pane-ready/@node-click 等只是 emits 声明，**从未桥接到 props 通道**
// （emit 全走 store 事件总线 vf.emits.xxx），模板上绑 @xxx 全部静默失效。
// 官方正确姿势：VueFlow 默认 slot 里放子组件，useVueFlow() 沿 inject 链拿到同一 store 实例，
// 再从 vf.emits.xxx.on() 注册回调。fitView/setTransform 也在该 store 上。
let fitTimer: number | undefined
const flowInst = shallowRef<any>(null)   // markRaw：响应式 unwrap 会破坏 store 方法调用
const wrapRef = ref<HTMLElement | null>(null)   // 组件级根 ref，多窗口下天然隔离
const flowVer = shallowRef(0)
watch([() => nodes.value.length, positions], () => { flowVer.value++; scheduleFit() })

/** 读取 store 当前节点（v1.48 实测 getNodes/nodes 都是 Ref，不是函数） */
function readStoreNodes(inst: any): any[] {
  try {
    const raw = inst.nodes
    if (raw && Array.isArray(raw.value)) return raw.value
    if (Array.isArray(raw)) return raw
    if (typeof inst.getNodes === 'function') return inst.getNodes()
    if (inst.getNodes && Array.isArray(inst.getNodes.value)) return inst.getNodes.value
  } catch { /* fallthrough */ }
  return []
}
/** store 上 dimensions/viewport/minZoom/maxZoom 全是 Ref，统一解包 */
const unrefV = (v: any, d: number) => (typeof v === 'number' ? v : (v?.value ?? d))
/** pane 尺寸：dimensions 是 Ref<{width,height}>，先解包再取字段（直接 .width 拿到 undefined） */
const paneSize = (inst: any) => {
  const d = inst.dimensions
  const obj = d && typeof d === 'object' && 'value' in d ? d.value : d
  return { w: obj?.width ?? 0, h: obj?.height ?? 0 }
}
async function doFitNow() {
  const inst = flowInst.value
  if (!inst) return
  // fitView 只纳入 dimensions.width/height 都已测量的节点，未就绪会静默 no-op。
  // 受控 :nodes 每次数组换新，新节点要等 ResizeObserver 回报后 dimensions 才齐全——轮询等齐再 fit。
  for (let k = 0; k < 40; k++) {
    const list = readStoreNodes(inst).filter((n: any) => !n.hidden)
    const dimsReady = list.length > 0 && list.every((n: any) => (n.dimensions?.width ?? 0) > 0 && (n.dimensions?.height ?? 0) > 0)
    const { w } = paneSize(inst)
    if (dimsReady && w > 0) break
    await new Promise((r) => setTimeout(r, 100))
  }
  try {
    await inst.fitView({ padding: 0.16, duration: 350 })
  } catch {
    try { await inst.fitView?.({ padding: 0.16, duration: 0 }) } catch { /* 下个 change 再试 */ }
  }
}
function scheduleFit() {
  window.clearTimeout(fitTimer)
  fitTimer = window.setTimeout(() => { void doFitNow() }, 300)
}
const FlowBridge = defineComponent({
  name: 'FlowBridge',
  setup(_p, { expose }) {
    const vf: any = useVueFlow()
    flowInst.value = markRaw(vf)
    ;(window as any).__vf = vf   // QA 探针钩子
    const fire = () => scheduleFit()
    vf.emits?.paneReady?.on?.(fire)
    vf.emits?.nodesInitialized?.on?.(fire)
    // nodeClick/paneClick 走总线在自定义节点上实测不触发，改用模板原生 @click（更可靠）
    expose({ vf })
    return () => h('div', { style: 'display:none' }, ' ⇄ ')
  }
})

async function openDetail(id: string) {
  selId.value = id
  detailLoading.value = true
  try { detail.value = await ipc.graph.node(id) } catch (e: any) { message.error(String(e?.message ?? e)) } finally { detailLoading.value = false }
}
function toggleExpand(id: string) {
  const s = new Set(expanded.value)
  if (s.has(id)) s.delete(id); else s.add(id)
  expanded.value = s
}
function expandAll() { expanded.value = new Set(rawNodes.value.filter((n) => n.level <= 3).map((n) => n.id)) }
function collapseAll() { expanded.value = new Set(rawNodes.value.filter((n) => n.level <= 1).map((n) => n.id)) }
async function unlock(on: boolean) {
  if (!detail.value) return
  await ipc.graph.forceUnlock(detail.value.node.id, on)
  await load()
  await openDetail(detail.value.node.id)
  void store.loadPlan()
}
function practiceNode(id: string) { void router.push({ path: '/practice', query: { node: id } }) }

// 搜索：在**全量节点**（含被收起的 L3/L4）里匹配，展开所有命中的祖先链，
// 优先选中最深（level 最大）的考点并聚焦；清空时收起回渐进披露默认态
const matched = computed(() => {
  const q = kw.value.trim().toLowerCase()
  if (!q) return []
  return rawNodes.value
    .filter((n) => n.domain === domain.value && String(n.title || '').toLowerCase().includes(q))
    .sort((a, b) => (b.level ?? 0) - (a.level ?? 0))
    .slice(0, 30)
})
let searchTimer: number | undefined
watch(kw, () => {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => {
    const q = kw.value.trim()
    if (!q) {
      // 清空搜索：还原渐进披露默认展开态（仅板块根），并退出聚焦
      selId.value = ''
      expanded.value = new Set(rawNodes.value.filter((n) => n.level <= 1).map((n) => n.id))
      void nextTick(() => scheduleFit())
      return
    }
    const hits = matched.value
    if (!hits.length) { message.info(`没有找到含「${q}」的考点`); return }
    // 展开每条命中的祖先链，保证它们在图上可见；再选最深的命中开详情
    const s = new Set(expanded.value)
    for (const h of hits) { let cur = byId.value.get(h.id); while (cur?.parent_id) { s.add(cur.parent_id); cur = byId.value.get(cur.parent_id) } }
    expanded.value = s
    const best = hits[0]
    selId.value = best.id
    void openDetail(best.id)
    void nextTick(() => scheduleFit())
  }, 280)
})
const isHit = (id: string) => !!kw.value.trim() && matched.value.some((m) => m.id === id)

async function unlockWeight(id: string, v: number) { await ipc.graph.setWeight(id, v) }

const domainStat = computed(() => {
  const l4 = rawNodes.value.filter((n) => n.level === 4)
  const lit = l4.filter((n) => n.lit).length
  const due = l4.reduce((a, n) => a + (n.q_due ?? 0), 0)
  return { total: l4.length, lit, due }
})

watch(domain, () => { detail.value = null; selId.value = ''; kw.value = ''; void load() })
onMounted(load)
</script>

<template>
  <div ref="wrapRef" class="graph-wrap">
    <VueFlow id="kg" :nodes="nodes" :edges="edges" :min-zoom="0.05" :max-zoom="1.8"
      :default-edge-options="{ type: 'default' }" @click.self="selId = ''">
      <!-- 实例与 viewport 事件经桥接子组件接总线（@pane-ready 等模板绑定是死绑定）；
           节点单击/双击用自定义节点 div 上的原生 Vue 事件，可靠不被 VueFlow 吞掉 -->
      <FlowBridge />
      <template #node-forge="{ data, id }: any">
        <!-- 板块根：大卡 + 总进度 -->
        <div v-if="data.level === 1" class="gn gn-root" :class="{ dim: isDim(id) || (kw && !isHit(id)) }"
          @click.stop="openDetail(id)" @dblclick.stop="toggleExpand(id)">
          <div class="t">🔥 {{ data.title }}</div>
          <div class="bar"><i :style="{ width: ((rollup.get(id)?.lit ?? 0) / Math.max(1, rollup.get(id)?.total ?? 1) * 100) + '%' }" /></div>
          <div class="m"><span>{{ rollup.get(id)?.lit ?? 0 }}/{{ rollup.get(id)?.total ?? 0 }} 考点已点亮</span>
            <span v-if="rollup.get(id)?.due" class="due">⏰ 待复习 {{ rollup.get(id)?.due }}</span></div>
          <Handle type="source" :position="Position.Right" />
        </div>
        <!-- L2 模块：聚合卡（标题+进度条+徽章），首屏主角 -->
        <div v-else-if="data.level === 2" class="gn gn-l2"
          :class="[data.must_master && !(rollup.get(id)?.lit) ? 'must' : '', selId === id ? 'sel' : '', isDim(id) || (kw && !isHit(id)) ? 'dim' : '']"
          @click.stop="openDetail(id)" @dblclick.stop="toggleExpand(id)">
          <Handle type="target" :position="Position.Left" />
          <div class="t">{{ data.title }}<span v-if="data.must_master" class="shield" title="必考基础红线">🛡</span></div>
          <div class="bar"><i :style="{ width: ((rollup.get(id)?.lit ?? 0) / Math.max(1, rollup.get(id)?.total ?? 1) * 100) + '%' }" /></div>
          <div class="m">
            <span class="mono">{{ rollup.get(id)?.lit ?? 0 }}/{{ rollup.get(id)?.total ?? 0 }}</span>
            <span v-if="rollup.get(id)?.due" class="due">⏰{{ rollup.get(id)?.due }}</span>
            <span v-if="rollup.get(id)?.must" class="mustn">🛡待攻 {{ rollup.get(id)?.must }}</span>
            <span class="exp">{{ expanded.has(id) ? '▾' : '▸' }} 双击</span>
          </div>
          <Handle type="source" :position="Position.Right" />
        </div>
        <!-- L3 分组小卡 -->
        <div v-else-if="data.level === 3" class="gn gn-l3"
          :class="[selId === id ? 'sel' : '', isDim(id) || (kw && !isHit(id)) ? 'dim' : '']"
          @click.stop="openDetail(id)" @dblclick.stop="toggleExpand(id)">
          <Handle type="target" :position="Position.Left" />
          <div class="t">{{ data.title }}</div>
          <div class="m"><span class="mono">{{ rollup.get(id)?.lit ?? 0 }}/{{ rollup.get(id)?.total ?? 0 }}</span>
            <span class="exp">{{ expanded.has(id) ? '▾' : '▸' }}</span></div>
          <Handle type="source" :position="Position.Right" />
        </div>
        <!-- L4 考点：四档掌握度圆点 + 状态徽章 -->
        <div v-else class="gn gn-l4"
          :class="[data.lit ? 'lit' : '', data.needs_work ? 'needs' : '', data.locked ? 'locked' : '', data.must_master ? 'must' : '', selId === id ? 'sel' : '', isDim(id) || (kw && !isHit(id)) ? 'dim' : '']"
          @click.stop="openDetail(id)">
          <Handle type="target" :position="Position.Left" />
          <div class="t">{{ data.title }}<span v-if="data.must_master" class="shield" title="必考基础红线">🛡</span></div>
          <div class="dots" :title="`掌握度：${SCALE_LABEL[data.scale4 ?? 0]}`">
            <i v-for="d in 4" :key="d" :style="{ background: (data.scale4 ?? 0) >= d - 1 && data.answered ? scale4Color(data.scale4) : 'var(--surface-3)' }" />
            <span v-if="data.locked" class="lockb">🔒</span>
            <span v-else-if="data.needs_work" class="needb">⚠ 需巩固</span>
            <span v-else-if="!data.answered && !data.locked" class="fresh">未接触</span>
          </div>
          <div class="m">
            <span class="mono">题 {{ data.q_done ?? 0 }}/{{ data.q_total ?? 0 }}</span>
            <span v-if="data.q_due" class="due">⏰{{ data.q_due }}</span>
            <span v-if="data.lit" class="litb" :style="{ color: scale4Color(data.scale4 ?? 0) }">{{ SCALE_LABEL[data.scale4 ?? 0] }}</span>
          </div>
          <!-- 数据里 L4(考点)就是最深层且是边端点，必须留 source handle；旧代码按 level<4 判断
               导致 L4 无起点、所有 bezier 层级边计算崩坏（旧版被迫用 smoothstep 的根源） -->
          <Handle type="source" :position="Position.Right" />
        </div>
      </template>
      <Background :gap="26" pattern-color="#e3e8ee" />
      <!-- 缩放控件留在默认左下角；图例已让位到底部居中，否则按钮会被图例整个盖住（机检抓到过 4 处）。
           position 只接受六条边的中点/角点（PanelPositionType），没有 center-left。 -->
      <Controls :show-interactive="false" />
      <MiniMap pannable zoomable :pan-position="0.7" :node-color="miniNodeColor" />
    </VueFlow>

    <div class="graph-toolbar">
      <n-select v-model:value="domain" size="small" style="width:120px"
        :options="Object.entries(DOMAIN_LABEL).map(([value, label]) => ({ value, label }))" />
      <n-input v-model:value="kw" size="small" placeholder="搜索考点，回车定位" clearable style="width:170px" />
      <n-button size="small" @click="expandAll()">展开全部</n-button>
      <n-button size="small" @click="collapseAll()">收起到模块</n-button>
      <n-button size="small" :type="onlyUnlit ? 'primary' : 'default'" @click="onlyUnlit = !onlyUnlit">只看未点亮</n-button>
      <n-button size="small" quaternary @click="load()">重载</n-button>
    </div>

    <!-- 顶部进度条：整体推进一目了然 -->
    <div class="graph-progress">
      <div class="bar big"><i :style="{ width: (domainStat.lit / Math.max(1, domainStat.total) * 100) + '%' }" /></div>
      <span>{{ domainStat.lit }}/{{ domainStat.total }} 考点 · <span :class="{ hot: domainStat.due > 0 }">⏰ {{ domainStat.due }} 题待复习</span></span>
    </div>

    <div class="legend" :class="{ closed: !showLegend }">
      <template v-if="showLegend">
        <div><i style="background:#1a7f37" />已点亮（四档 ≥2 且无待复习）</div>
        <div><i style="background:#9a6700" />已点亮但需巩固（到期/答错）</div>
        <div><i style="background:#656d76" />未解锁（前置未满足）</div>
        <div><i style="background:#8250df" />必考基础（硬基础红线，不可跳）</div>
        <div class="tiny muted">单击详情 · 双击展开/收起 · 空白处点击取消聚焦</div>
      </template>
      <n-button size="tiny" quaternary @click="showLegend = !showLegend">{{ showLegend ? '收起图例' : '展开图例' }}</n-button>
    </div>

    <aside v-if="detail" class="drawer" data-testid="graph-drawer">
      <header class="panel-head">
        <h3>{{ detail.node.title }}</h3>
        <span class="grow" />
        <button class="icon-btn" data-testid="graph-drawer-close" title="关闭" aria-label="关闭详情" @click="detail = null; selId = ''">
          <Icon name="close" :size="16" />
        </button>
      </header>
      <div class="row" style="margin-bottom:12px">
        <span class="pill" :class="detail.node.lit ? 'ok' : detail.node.locked ? 'lock' : 'warn'">
          {{ detail.node.lit ? '已点亮' : detail.node.locked ? '未解锁' : '可挑战' }}
        </span>
        <span class="pill lock">L{{ detail.node.level }} · {{ detail.node.stack }}</span>
        <span v-if="detail.node.must_master" class="pill purple">必考基础</span>
        <span v-if="detail.node.scale4 != null" class="pill info">当前 {{ detail.node.scale4 }}/3</span>
      </div>

      <n-button type="primary" block style="margin-bottom:12px" @click="practiceNode(detail.node.id)">
        🎯 开练这个考点
      </n-button>

      <div class="card" style="margin-bottom:12px;background:var(--panel-2)">
        <div class="tiny muted" style="margin-bottom:6px">掌握度推进规则</div>
        <div class="tiny">{{ detail.advice }}</div>
      </div>

      <div v-if="detail.node.locked" class="fb warn" style="margin-bottom:12px">
        <h4>🔒 被前置卡住</h4>
        <div class="tiny">先完成下面的前置考点；也可以强行解锁（不推荐，容易地基不稳）。</div>
        <n-switch :value="!!detail.node.forced_unlock" size="small" style="margin-top:8px"
          @update:value="(v: boolean) => unlock(v)">
          <template #checked>已强行解锁</template><template #unchecked>按图谱锁定</template>
        </n-switch>
      </div>

      <div v-if="detail.prerequisites?.length">
        <div class="section-title">前置依赖</div>
        <div v-for="p in detail.prerequisites" :key="p.id" class="kv">
          <span style="flex:1;cursor:pointer" @click="openDetail(p.id)">{{ p.title }}</span>
          <span class="pill" :class="p.lit ? 'ok' : 'bad'">{{ p.lit ? '已完成' : '未完成' }}</span>
        </div>
      </div>
      <div v-if="detail.dependents?.length">
        <div class="section-title">点亮后会解锁</div>
        <div class="row" style="margin-top:6px">
          <n-button v-for="d in detail.dependents" :key="d.id" size="tiny" quaternary @click="openDetail(d.id)">→ {{ d.title }}</n-button>
        </div>
      </div>
      <div v-if="detail.related?.length">
        <div class="section-title">横向相关</div>
        <div class="row" style="margin-top:6px">
          <n-button v-for="r in detail.related" :key="r.id" size="tiny" quaternary @click="openDetail(r.id)">· {{ r.title }}</n-button>
        </div>
      </div>

      <div class="section-title">本节点题目（{{ detail.questions?.length ?? 0 }}）</div>
      <div class="q-list">
        <div v-for="qq in detail.questions?.slice(0, 40)" :key="qq.id" class="q-item" @click="practiceNode(detail.node.id)">
          <span class="pill lock">{{ TYPE_LABEL[qq.type] }}</span>
          <span style="flex:1;font-size:12.5px;line-height:1.5">{{ qq.stem }}</span>
          <span v-if="qq.parentId" class="pill purple">变体</span>
          <span v-if="qq.answered" class="pill" :class="qq.bestPct >= 60 ? 'ok' : 'warn'">最好 {{ qq.bestPct }}</span>
          <span v-else class="pill info">未做</span>
        </div>
      </div>

      <div style="margin-top:14px">
        <div class="tiny muted" style="margin-bottom:4px">个人重要度权重（影响组卷优先级）：{{ detail.node.weight ?? 1 }}</div>
        <n-slider :value="detail.node.weight ?? 1" :min="0" :max="3" :step="0.5"
          @update:value="(v: number) => unlockWeight(detail.node.id, v)" />
      </div>
    </aside>

    <n-spin v-if="detailLoading" style="position:absolute;inset:0;display:grid;place-content:center;z-index:30" />
  </div>
</template>
