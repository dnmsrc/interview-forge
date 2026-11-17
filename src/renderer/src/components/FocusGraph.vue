<script setup lang="ts">
/**
 * 关系聚焦星轨图（R22）——分组同心径向 ego network。
 *
 * 相对 R21 三向网格的视觉重构（用户反馈「不好看、没有设计感」+ 社区对标）：
 * - 布局：硬直左右两列 → 分组同心星轨（lib/graph-focus.ts），邻居按关系类型聚类、沿圆周
 *   均匀分布，卡片多时自动外推第二/三轨道，数学保证零重叠；参考 yFiles 对 hub-spoke
 *   布局「边沿径向流走曲线、节点沿圆周分布而非固定象限」的官方建议；
 * - 连线：直角粗直线 → 自定义弧形贝塞尔边（径向自然弯曲、柔光底描边、淡入动效）；
 * - 节点：大小不一的灰白盒 → 统一玻璃拟态卡片，关系色左边条，标题两行不截断；
 * - 氛围：淡点阵 → 同心虚线轨道环 + 中心径向光晕；
 * - 交互：悬停某条关系时只高亮它与中心，其余降透明度（减少干扰）。
 * 数据契约（props/emits/关系本体/IPC）与 R21 完全一致，r21 探针选择器全部保留。
 */
import { computed, defineComponent, h, markRaw, nextTick, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import { VueFlow, useVueFlow, MarkerType, type Node, type Edge } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import Icon from './Icon.vue'
import {
  layoutFocus, nodeBox, CENTER_NODE, NEIGHBOR_NODE, type FocusNeighbor
} from '../lib/graph-focus'
import { RELATION_META, type RelationType } from '@shared/relations'
import type { GraphNode, NodeDetail } from '@shared/types'

const relationLabel = (t: string) => RELATION_META[t as RelationType]?.label ?? t
/** 邻居悬停提示：多关系时列出全部关系类型 */
function neighborTitle(nb: FocusNeighbor): string {
  if (nb.types.length <= 1) return nb.title
  return `${nb.title}（关系：${nb.types.map((t) => relationLabel(t)).join('、')}）`
}

const props = defineProps<{
  detail: NodeDetail
  byId: Map<string, GraphNode>
  /** 关系类型过滤（透镜芯片），空集合表示全显示 */
  hiddenTypes: Set<RelationType>
  bossIds: Set<string>
  beatenBossIds: Set<string>
}>()
const emit = defineEmits<{ (e: 'navigate', nodeId: string): void }>()

type StateKey = 'untouched' | 'learning' | 'mastered' | 'stale'
const stateKey = (n?: GraphNode): StateKey => {
  const lv = Number(n?.masteryLevel ?? n?.mastery_level ?? 0)
  return lv === 2 ? 'mastered' : lv === 3 ? 'stale' : lv === 1 ? 'learning' : 'untouched'
}

/** 当前悬停高亮的邻居 id（空串表示不启用聚焦降透明度） */
const hoverId = shallowRef('')

/** 过滤后的星轨布局（透镜芯片隐藏某类关系时只影响邻居与边） */
const layout = computed(() => {
  const rels = props.detail.relationGroups
    .filter((g) => !props.hiddenTypes.has(g.type as RelationType))
    .flatMap((g) => g.items)
  return layoutFocus(props.detail.node, rels, props.byId)
})

const flowNodes = computed<Node[]>(() => {
  const c = props.detail.node
  const out: Node[] = []

  // 装饰层：实际用到的每条轨道环（直径 = 2×半径，盒子以原点为中心）。
  // 关键：VueFlow 的 nodesInitialized 要求每个节点 wrapper 都有实测尺寸，否则全图节点
  // 永久 visibility:hidden。装饰节点必须在 node.style 上给显式宽高，内部 inset:0 填充，
  // 不能让 wrapper 因 absolute 子元素塌缩成 0×0。
  layout.value.rings.forEach((r, i) => {
    const size = r * 2
    out.push({
      id: `ring-${i}`, type: 'focus-ring', draggable: false, selectable: false,
      position: { x: -r, y: -r },
      style: { width: `${size}px`, height: `${size}px` },
      data: { ring: i },
      zIndex: 0
    })
  })

  // 中心主卡
  out.push({
    id: c.id, type: 'focus-center', draggable: false, zIndex: 3,
    position: nodeBox(0, 0, CENTER_NODE.w, CENTER_NODE.h),
    data: { node: c, state: stateKey(c), boss: props.bossIds.has(c.id), bossDone: props.beatenBossIds.has(c.id) }
  })

  // 邻居卡
  layout.value.neighbors.forEach((nb) => {
    out.push({
      id: nb.id, type: 'focus-neighbor', draggable: false, zIndex: 2,
      position: nodeBox(nb.x, nb.y, NEIGHBOR_NODE.w, NEIGHBOR_NODE.h),
      data: {
        nb, state: stateKey(nb.node), boss: props.bossIds.has(nb.id),
        bossDone: props.beatenBossIds.has(nb.id),
        dim: !!hoverId.value && hoverId.value !== nb.id
      }
    })
  })
  return out
})

/** 自定义弧形边：控制点沿切向偏移，让曲线自然环抱中心；箭头用末端小三角手绘 */
function arcGeometry(nb: FocusNeighbor, intoCenter: boolean) {
  const nx = nb.x, ny = nb.y
  const len = Math.hypot(nx, ny) || 1
  const ux = nx / len, uy = ny / len // 中心→邻居单位向量
  // 卡片在该方向上的近似边界（椭圆近似），把起终点收进卡片边缘
  const nEdge = 1 / Math.hypot(ux / (NEIGHBOR_NODE.w / 2 + 6), uy / (NEIGHBOR_NODE.h / 2 + 6))
  const cEdge = 1 / Math.hypot(ux / (CENTER_NODE.w / 2 + 6), uy / (CENTER_NODE.h / 2 + 6))
  const nbx = nx - ux * nEdge, nby = ny - uy * nEdge
  const cbx = ux * cEdge, cby = uy * cEdge
  // 中点沿切向（径向逆时针 90°：(-uy, ux)）推出弧度
  const mx = (cbx + nbx) / 2, my = (cby + nby) / 2
  const bend = len * 0.1
  const qx = mx - uy * bend, qy = my + ux * bend
  const sx = intoCenter ? nbx : cbx, sy = intoCenter ? nby : cby
  const ex = intoCenter ? cbx : nbx, ey = intoCenter ? cby : nby
  const d = `M ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${qx.toFixed(1)} ${qy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`
  // 末端切线方向（二次贝塞尔在终点的切线 = 终点 - 控制点），用于定位箭头
  const tx = ex - qx, ty = ey - qy
  const tl = Math.hypot(tx, ty) || 1
  return { d, ang: (Math.atan2(ty, tx) * 180) / Math.PI, ex, ey, dx: tx / tl, dy: ty / tl }
}

const flowEdges = computed<Edge[]>(() => {
  const centerId = props.detail.node.id
  return layout.value.neighbors.map((nb) => {
    const meta = RELATION_META[nb.type as RelationType]
    const intoCenter = meta.directed && nb.dir === 'in'
    const geo = arcGeometry(nb, intoCenter)
    const active = !hoverId.value || hoverId.value === nb.id
    return {
      id: `focus-${nb.type}-${nb.id}`,
      source: intoCenter ? nb.id : centerId,
      target: intoCenter ? centerId : nb.id,
      type: 'focus-arc', zIndex: active ? 2 : 1, selectable: false,
      data: {
        d: geo.d, color: `var(${meta.colorVar})`, hex: meta.hex,
        dash: meta.dash, gate: meta.gate, directed: meta.directed, active,
        arrow: meta.directed
          ? { x: geo.ex, y: geo.ey, dx: geo.dx, dy: geo.dy }
          : null
      },
      // VueFlow 仍需要 marker 配置以保证边的连接有效性，实际箭头由自定义组件手绘
      markerEnd: meta.directed ? { type: MarkerType.ArrowClosed, width: 1, height: 1 } : undefined
    }
  })
})

/** 自定义弧形边组件：柔光底描边 + 主线 + 末端手绘三角箭头 */
const FocusArcEdge = defineComponent({
  name: 'FocusArcEdge',
  props: { data: { type: Object, required: true } },
  setup(p) {
    return () => {
      const dd = p.data as any
      const stroke = dd.color as string
      const dasharray = dd.dash === 'dashed' ? '7 7' : dd.dash === 'dotted' ? '1 9' : undefined
      const arrow = dd.arrow
      // 箭头三角形：沿末端切线方向，边长 7，半宽 4.2
      const tri = arrow
        ? (() => {
            const tipX = arrow.x, tipY = arrow.y
            const back = 8, half = 4.2
            const bx = tipX - arrow.dx * back, by = tipY - arrow.dy * back
            const px = -arrow.dy, py = arrow.dx // 法向量
            return `${tipX.toFixed(1)},${tipY.toFixed(1)} ${(bx + px * half).toFixed(1)},${(by + py * half).toFixed(1)} ${(bx - px * half).toFixed(1)},${(by - py * half).toFixed(1)}`
          })()
        : null
      return h('g', { class: ['fg-arc', { 'is-dim': !dd.active, 'is-gate': dd.gate }] }, [
        h('path', { d: dd.d, fill: 'none', stroke, strokeWidth: 8, opacity: 0.09, strokeLinecap: 'round' }),
        h('path', {
          class: 'fg-arc-main', d: dd.d, fill: 'none', stroke,
          strokeWidth: dd.gate ? 2.4 : 1.7,
          strokeDasharray: dasharray, strokeLinecap: 'round'
        }),
        tri ? h('polygon', { points: tri, fill: stroke, class: 'fg-arc-arrow' }) : null
      ])
    }
  }
})

/* ---------------- VueFlow 适配（沿用 R21 桥接经验：监听 paneReady/nodesInitialized，等 dimensions 就绪再定位） ---------------- */
const flowInst = shallowRef<any>(null)
let fitTimer: number | undefined
const FlowBridge = defineComponent({
  name: 'FocusBridge',
  setup(_p, { expose }) {
    const vf: any = useVueFlow()
    flowInst.value = markRaw(vf)
    const fire = () => scheduleFit()
    vf.emits?.paneReady?.on?.(fire)
    vf.emits?.nodesInitialized?.on?.(fire)
    expose({ vf })
    return () => h('div', { style: 'display:none' }, ' ⇄ ')
  }
})
function readNodes(inst: any): any[] {
  const raw = inst.nodes
  if (raw && Array.isArray(raw.value)) return raw.value
  if (Array.isArray(raw)) return raw
  return typeof inst.getNodes === 'function' ? inst.getNodes() : []
}
async function waitReady(inst: any) {
  for (let k = 0; k < 50; k++) {
    const list = readNodes(inst).filter((n) => !n.hidden)
    const d = inst.dimensions
    const dims = d && typeof d === 'object' && 'value' in d ? d.value : d
    if (list.length > 1 && list.every((n) => (n.dimensions?.width ?? 0) > 0) && (dims?.width ?? 0) > 0) return
    await new Promise((r) => setTimeout(r, 90))
  }
}
/** 确定性居中：按布局真实包围盒求缩放，让整图（含最外圈邻居）完整入镜并居中。 */
function centerViewport(inst: any) {
  const d = inst.dimensions
  const dims = d && typeof d === 'object' && 'value' in d ? d.value : d
  const w = dims?.width ?? 0, h = dims?.height ?? 0
  if (!w) return
  const lw = layout.value.width || 900, lh = layout.value.height || 900
  const zoom = Math.min(1, Math.max(0.3, Math.min((w * 0.9) / lw, (h * 0.86) / lh)))
  inst.setViewport({ x: w / 2, y: h / 2, zoom }, { duration: 380 })
}
async function fit(seq?: number) {
  let inst = flowInst.value
  for (let k = 0; k < 50 && !inst; k++) {
    await new Promise((r) => setTimeout(r, 80))
    inst = flowInst.value
    if (seq !== undefined && seq !== fitSeq) return
  }
  if (!inst) return
  await waitReady(inst)
  if (seq !== undefined && seq !== fitSeq) return
  try { centerViewport(inst) } catch { /* ignore */ }
}
let fitSeq = 0
function scheduleFit() {
  const seq = ++fitSeq
  window.clearTimeout(fitTimer)
  fitTimer = window.setTimeout(() => { if (seq === fitSeq) void fit(seq) }, 240)
}
watch(flowNodes, () => nextTick(scheduleFit), { deep: false })
watch(() => props.detail.node.id, () => { hoverId.value = ''; scheduleFit() })
onMounted(() => scheduleFit())
onBeforeUnmount(() => { window.clearTimeout(fitTimer); fitSeq++ })

function onNeighbor(nb: FocusNeighbor) { emit('navigate', nb.id) }
function onHover(nb: FocusNeighbor | null) { hoverId.value = nb ? nb.id : '' }
</script>

<template>
  <div class="focus-graph" data-testid="focus-graph">
    <VueFlow id="kg-focus" :nodes="flowNodes" :edges="flowEdges" :min-zoom="0.25" :max-zoom="1.8"
      :nodes-draggable="false" :edges-updatable="false"
      :nodes-connectable="false" :elements-selectable="false" :pan-on-drag="true" :zoom-on-scroll="true">
      <FlowBridge />

      <!-- 自定义边类型注册（VueFlow 按 slots[`edge-${type}`] 解析具名插槽） -->
      <template #edge-focus-arc="edgeProps">
        <FocusArcEdge :data="(edgeProps as any).data" />
      </template>

      <!-- 装饰：轨道环（尺寸由 node.style 提供，内部 inset:0 填充，保证 wrapper 不塌缩） -->
      <template #node-focus-ring="{ data }: any">
        <div class="fg-ring" :class="'ring-' + data.ring" />
      </template>

      <!-- 中心节点 -->
      <template #node-focus-center="{ data }: any">
        <div class="fg-center" :class="['st-' + data.state, { boss: data.boss }]">
          <span v-if="data.boss" class="fg-crown">🐲</span>
          <span class="fg-center-halo" />
          <div class="fg-center-title" :title="data.node.title">{{ data.node.title }}</div>
          <div class="fg-center-sub">
            <i class="fg-state-dot" :class="'st-' + data.state" />{{ data.node.stack }}
          </div>
        </div>
      </template>

      <!-- 邻居节点 -->
      <template #node-focus-neighbor="{ data }: any">
        <button type="button" class="fg-neighbor"
          :class="['st-' + data.state, { locked: data.nb.node?.locked, dim: data.dim }]"
          :style="{ '--rel': `var(${data.nb.meta.colorVar})` }"
          :data-testid="'fg-nb-' + data.nb.id"
          @click.stop="onNeighbor(data.nb)"
          @mouseenter="onHover(data.nb)" @mouseleave="onHover(null)">
          <span class="fg-nb-bar" />
          <span class="fg-nb-body">
            <span class="fg-nb-rel">
              <i class="fg-nb-swatch" :style="{ background: `var(${data.nb.meta.colorVar})` }" />
              {{ data.nb.meta.label }}
              <i v-if="data.nb.types.length > 1" class="fg-nb-more">+{{ data.nb.types.length - 1 }}</i>
            </span>
            <span class="fg-nb-title" :title="neighborTitle(data.nb)">
              <Icon v-if="data.boss" name="graph" :size="11" class="fg-nb-boss-ic" />
              <Icon v-if="data.nb.node?.locked" name="lock" :size="11" />
              {{ data.nb.title }}
            </span>
          </span>
          <i class="fg-state-dot" :class="'st-' + data.state" />
        </button>
      </template>

      <Background :gap="30" pattern-color="rgba(120,132,158,.16)" :size="1.4" />
      <Controls :show-interactive="false" />
    </VueFlow>

    <div v-if="!layout.neighbors.length" class="fg-empty">
      <Icon name="graph" :size="22" />
      <p>这个考点暂时没有标注关系</p>
      <span class="tiny muted">可在右侧抽屉直接挑战或查看知识全文</span>
    </div>
  </div>
</template>

<style scoped>
.focus-graph { position: absolute; inset: 0; }
.focus-graph :deep(.vue-flow__node) { background: transparent; border: 0; padding: 0; font-family: inherit }
.focus-graph :deep(.vue-flow__attribution) { display: none }
.focus-graph :deep(.vue-flow__edge) { pointer-events: none }
/* 自定义边接管渲染后，VueFlow 默认 path 隐藏，避免双线（marker 仍由其内部机制处理，我们手绘三角） */
.focus-graph :deep(.vue-flow__edge-path) { display: none }
.focus-graph :deep(.vue-flow__arrowhead) { display: none }
/* 装饰节点（轨道环）不阻挡画布拖拽与邻居点击 */
.focus-graph :deep(.vue-flow__node-focus-ring) { pointer-events: none }

/* ---------------- 弧形边 ---------------- */
.fg-arc { transition: opacity var(--dur) var(--ease-out) }
.fg-arc.is-dim { opacity: .16 }
.fg-arc-main, .fg-arc-arrow { animation: fg-fade var(--dur-slow) var(--ease-out) both }
@keyframes fg-fade { from { opacity: 0 } }
@media (prefers-reduced-motion: reduce) {
  .fg-arc-main, .fg-arc-arrow { animation: none }
}

/* ---------------- 中心主卡 ----------------
   注意：不要用 from{opacity:0} 的入场动画——VueFlow 靠首帧实测尺寸置 nodesInitialized，
   装饰/内容节点若首帧不可见会让初始化永远不完成，全图被锁在 visibility:hidden。 */
.fg-center {
  width: v-bind('CENTER_NODE.w + "px"'); min-height: v-bind('CENTER_NODE.h + "px"');
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px;
  background:
    radial-gradient(120% 130% at 20% 0%, color-mix(in oklab, var(--accent) 20%, var(--surface)), var(--surface) 70%);
  border: 2px solid color-mix(in oklab, var(--accent) 62%, var(--border-2));
  border-radius: var(--r-xl);
  padding: 14px 16px; box-shadow: var(--sh-3), 0 0 0 6px color-mix(in oklab, var(--accent) 9%, transparent);
  text-align: center; position: relative; z-index: 3;
  transition: transform var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast);
}
.fg-center:hover { transform: translateY(-1px) }
.fg-center.boss {
  border-color: var(--hot);
  box-shadow: var(--sh-3), 0 0 0 6px color-mix(in oklab, var(--hot) 14%, transparent);
}
.fg-center-halo {
  position: absolute; inset: -20px; border-radius: calc(var(--r-xl) + 16px); z-index: -1;
  background: radial-gradient(closest-side, color-mix(in oklab, var(--accent) 16%, transparent), transparent 80%);
  animation: fg-halo 3.2s var(--ease-in-out) infinite;
}
.fg-center.boss .fg-center-halo {
  background: radial-gradient(closest-side, color-mix(in oklab, var(--hot) 18%, transparent), transparent 80%);
}
@keyframes fg-halo { 50% { opacity: .5; transform: scale(1.06) } }
.fg-crown { position: absolute; top: -16px; font-size: 20px; filter: drop-shadow(0 2px 4px rgba(0,0,0,.35)) }
.fg-center-title {
  font-size: var(--fs-md); font-weight: 800; color: var(--text); line-height: 1.4;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.fg-center-sub { font-size: var(--fs-xs); color: var(--text-faint); display: flex; align-items: center; gap: 5px }

/* ---------------- 邻居玻璃卡片 ---------------- */
.fg-neighbor {
  width: v-bind('NEIGHBOR_NODE.w + "px"'); min-height: v-bind('NEIGHBOR_NODE.h + "px"');
  display: flex; align-items: stretch;
  background: color-mix(in oklab, var(--surface) 92%, transparent);
  backdrop-filter: blur(8px);
  border: 1px solid var(--border); border-radius: var(--r-lg);
  padding: 0; cursor: pointer; font-family: inherit; text-align: left;
  box-shadow: var(--sh-1); overflow: hidden; position: relative;
  transition:
    transform var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast), box-shadow var(--dur-fast), opacity var(--dur), filter var(--dur);
}
.fg-neighbor:hover {
  transform: translateY(-3px) scale(1.035);
  border-color: color-mix(in oklab, var(--rel) 55%, var(--border-2));
  box-shadow: var(--sh-3), 0 0 0 4px color-mix(in oklab, var(--rel) 12%, transparent);
  z-index: 4;
}
.fg-neighbor.dim { opacity: .3; filter: saturate(.45) }
.fg-neighbor.locked { background: var(--surface-2) }
.fg-nb-bar { flex: 0 0 4px; width: 4px; background: var(--rel); opacity: .92 }
.fg-nb-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; padding: 9px 12px 8px 11px }
.fg-nb-rel {
  font-size: 10px; font-weight: 800; letter-spacing: .03em;
  display: inline-flex; align-items: center; gap: 5px; color: var(--rel);
}
.fg-nb-swatch { width: 8px; height: 8px; border-radius: 3px; flex: 0 0 auto }
.fg-nb-more { font-style: normal; font-size: 9px; font-weight: 700; opacity: .8;
  background: var(--surface-3); color: var(--text-dim); border-radius: var(--r-pill); padding: 0 5px; line-height: 1.5 }
.fg-nb-title {
  font-size: var(--fs-sm); font-weight: 700; color: var(--text); line-height: 1.4;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  overflow-wrap: anywhere;
}
.fg-neighbor.locked .fg-nb-title { color: var(--text-faint) }
.fg-nb-boss-ic { color: var(--hot) }

/* 状态点：卡片右上角 */
.fg-neighbor .fg-state-dot { position: absolute; top: 8px; right: 9px }
.fg-state-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--text-faint); flex: 0 0 auto }
.fg-state-dot.st-mastered { background: var(--ok); box-shadow: 0 0 0 3px color-mix(in oklab, var(--ok) 18%, transparent) }
.fg-state-dot.st-learning { background: var(--warn); box-shadow: 0 0 0 3px color-mix(in oklab, var(--warn) 16%, transparent) }
.fg-state-dot.st-stale { background: var(--hot); box-shadow: 0 0 0 3px color-mix(in oklab, var(--hot) 16%, transparent) }
.fg-center .fg-state-dot { position: static }

/* ---------------- 轨道环与扇区标签（世界坐标装饰节点，wrapper 尺寸由 node.style 给定） ---------------- */
.fg-ring {
  position: absolute; inset: 0; border-radius: 50%;
  border: 1.5px dashed color-mix(in oklab, var(--accent) 20%, var(--border));
  pointer-events: none;
}

/* ---------------- 空态 ---------------- */
.fg-empty {
  position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 8px;
  color: var(--text-faint); pointer-events: none; text-align: center;
}
.fg-empty p { margin: 0; font-weight: 700; color: var(--text-dim) }
</style>
