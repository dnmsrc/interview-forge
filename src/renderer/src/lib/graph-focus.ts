/**
 * 关系聚焦视图的「分组同心星轨」确定性径向布局（R22，纯函数，无 Vue/VueFlow 依赖，QA 探针可复用）。
 *
 * 设计依据（社区对标 + 用户对网格/固定象限布局的视觉批评）：
 * - yFiles 官方对 hub-spoke / radial 布局：中心辐射图应让边跟随径向流、节点沿圆周分布，
 *   不要用直角网格或固定象限——真实数据的关系分布天然不均，固定分区必然在某一侧挤压重叠；
 * - Obsidian Local Graph / TheBrain 的 ego network：一度邻居按关系聚类、近似均匀地环绕中心；
 * - PMC6130094 图美感研究：轮廓圆润、对称、无重叠的 node-link 图被一致感知为更美。
 *
 * 布局模型：
 * 1. 按主关系类型把邻居分组（同色/同义聚成一段），组顺序取 RELATION_ORDER（学习链在前）；
 * 2. 角度槽按卡片在该轨道半径下的真实角宽 + 安全间隙反推，数学上保证相邻卡片不重叠；
 * 3. 内圈放学习链等优先组，装满角度预算后其余组整体外推到第二/第三轨道（不拆组）；
 * 4. 每个环内各组沿圆周均分、组间留固定角度间隙；方向（前置/进阶）由边箭头与关系色表达，
 *    布局位置不再承担左右分区，从而对任意不均匀数据都保持圆润平衡。
 */
import type { GraphNode, NodeRelation } from '@shared/types'
import { RELATION_META, RELATION_ORDER, type RelationType } from '@shared/relations'

export interface FocusNeighbor {
  /** 邻居节点 id（聚合后唯一） */
  id: string
  title: string
  /** 主关系类型（ORDER_RANK 最高者，决定分组/配色/线型） */
  type: RelationType
  /** 该邻居与中心之间的全部关系类型（一个考点可能既是「依存」又是「关联」） */
  types: RelationType[]
  /** 主关系方向 */
  dir: 'out' | 'in'
  lit: number
  note: string | null
  /** 解析后的邻居节点（可能为 undefined：边指向的节点被过滤时） */
  node?: GraphNode
  /** 主关系元数据 */
  meta: (typeof RELATION_META)[RelationType]
  /** 所在轨道：0 内圈 / 1 中圈 / 2 外圈 */
  ring: 0 | 1 | 2
  /** 组内序号 */
  order: number
  /** 时钟角（度）：0=正上方，顺时针递增 */
  clock: number
  /** 轨道半径（px，中心到卡片中心） */
  radius: number
  /** 笛卡尔坐标（布局中心为原点，屏幕 y 向下） */
  x: number
  y: number
}

export interface FocusLayout {
  center: { x: number; y: number }
  neighbors: FocusNeighbor[]
  /** 实际用到的轨道半径（供视觉层画轨道环） */
  rings: number[]
  width: number
  height: number
}

/* ---------- 布局常量 ---------- */
export const CENTER_NODE = { w: 204, h: 116 }
export const NEIGHBOR_NODE = { w: 184, h: 66 }
/** 三条轨道半径（中心到卡片中心）：内圈与中心卡拉开呼吸距离，外圈逐级外扩 */
const RING_RADIUS = [332, 508, 672]
/** 相邻卡片之间的切向安全间隙（px） */
const CARD_GAP = 32
/** 同环内不同关系组之间的角度间隙（度） */
const GROUP_GAP_DEG = 14

/** 时钟角（0=顶、顺时针）+ 半径 → 笛卡尔（屏幕 y 向下） */
function polar(clockDeg: number, radius: number) {
  const a = (clockDeg * Math.PI) / 180
  return { x: Math.sin(a) * radius, y: -Math.cos(a) * radius }
}

/** 某轨道上容纳一张卡片所需的最小角槽（度）：卡片宽 + 间隙 对应的圆心角 */
function minAngleFor(radius: number): number {
  return ((NEIGHBOR_NODE.w + CARD_GAP) / radius) * (180 / Math.PI)
}

/**
 * 计算分组同心星轨布局。
 * @param center 中心考点
 * @param relations nodeDetail 返回的一度关系（已按 9 类分桶，这里重新打平）
 * @param byId 节点 id → GraphNode（补全邻居标题/四态用）
 */
export function layoutFocus(
  center: GraphNode,
  relations: NodeRelation[],
  byId: Map<string, GraphNode>
): FocusLayout {
  void center
  // 按节点 id 聚合：同一考点可能经多类关系连接中心，只保留一个邻居节点，
  // 主类型取 RELATION_ORDER 最靠前（学习链优先于语义网，地基类优先）。
  const agg = new Map<string, {
    id: string; title: string; types: RelationType[]; dir: 'out' | 'in'; lit: number; note: string | null
  }>()
  for (const r of relations) {
    const type = r.type as RelationType
    if (!RELATION_META[type]) continue
    const cur = agg.get(r.id)
    if (cur) {
      if (!cur.types.includes(type)) cur.types.push(type)
      if (!cur.note && r.note) cur.note = r.note
      if (RELATION_META[type].directed) cur.dir = r.dir
      cur.lit = Math.max(cur.lit, r.lit)
    } else {
      agg.set(r.id, { id: r.id, title: r.title, types: [type], dir: r.dir, lit: r.lit, note: r.note })
    }
  }

  type Member = Omit<FocusNeighbor, 'order' | 'clock' | 'radius' | 'ring' | 'x' | 'y'>
  // 主类型分组（保持 RELATION_ORDER 顺序）
  const groupMap = new Map<RelationType, Member[]>()
  for (const a of agg.values()) {
    const type = [...a.types].sort(
      (x, z) => RELATION_ORDER.indexOf(x) - RELATION_ORDER.indexOf(z)
    )[0]
    const meta = RELATION_META[type]
    const member: Member = {
      id: a.id, title: a.title, type, types: a.types, dir: a.dir, lit: a.lit, note: a.note,
      node: byId.get(a.id), meta
    }
    if (!groupMap.has(type)) groupMap.set(type, [])
    groupMap.get(type)!.push(member)
  }
  // 组内按标题排序，保证确定性
  for (const list of groupMap.values()) {
    list.sort((a, z) => a.title.localeCompare(z.title, 'zh'))
  }
  const groups = RELATION_ORDER.filter((t) => groupMap.has(t)).map((t) => ({
    type: t, members: groupMap.get(t)!
  }))

  /* ----- 环分配：内圈按角度预算装组，装满后整组外推，保证不拆组 ----- */
  interface RingPlan { radius: number; groups: typeof groups; total: number }
  const rings: RingPlan[] = RING_RADIUS.map((radius) => ({ radius, groups: [], total: 0 }))
  let ringIdx = 0
  let usedAngle = 0
  for (const g of groups) {
    const radius = RING_RADIUS[ringIdx]
    const need = g.members.length * minAngleFor(radius)
    const projected = usedAngle + need + (rings[ringIdx].groups.length ? GROUP_GAP_DEG : 0)
    // 当前环装得下（留 4° 全局呼吸），或这是最后一条环，则放下；否则换下一环
    if (projected <= 356 || ringIdx === RING_RADIUS.length - 1) {
      rings[ringIdx].groups.push(g)
      rings[ringIdx].total += g.members.length
      usedAngle = projected
    } else {
      ringIdx++
      const ri = Math.min(ringIdx, RING_RADIUS.length - 1)
      rings[ri].groups.push(g)
      rings[ri].total += g.members.length
      usedAngle = g.members.length * minAngleFor(RING_RADIUS[ri])
    }
  }
  const activeRings = rings.filter((r) => r.total > 0)

  /* ----- 每个环内：组间留间隙，组内沿圆周均分，从顶部开始顺时针 ----- */
  const neighbors: FocusNeighbor[] = []
  activeRings.forEach((ring) => {
    const gapTotal = (ring.groups.length - 1) * GROUP_GAP_DEG
    // 起点：让整环内容相对顶部居中（第一组从 -总跨度/2 开始，视觉更对称）
    const totalMin = ring.groups.reduce((s, g) => s + g.members.length * minAngleFor(ring.radius), 0)
    // 实际占用角度可能小于 usable（组少时间隙占比大），按 minAngle 紧凑排并整体居中
    const span = totalMin + gapTotal
    let cursor = -span / 2 // 时钟角，负 = 顶部偏左
    ring.groups.forEach((g) => {
      const slot = g.members.length * minAngleFor(ring.radius)
      const ringLevel = rings.indexOf(ring) as 0 | 1 | 2
      g.members.forEach((m, i) => {
        const clock = cursor + (i + 0.5) * minAngleFor(ring.radius)
        const { x, y } = polar(clock, ring.radius)
        neighbors.push({ ...m, order: i, ring: ringLevel, clock, radius: ring.radius, x, y })
      })
      cursor += slot + GROUP_GAP_DEG
    })
  })

  // 画布包围盒：按最外轨道 + 卡片外接圆 + 呼吸边距
  const maxRing = Math.max(...neighbors.map((n) => n.radius), RING_RADIUS[0])
  const halfCard = Math.hypot(NEIGHBOR_NODE.w, NEIGHBOR_NODE.h) / 2
  const reach = maxRing + halfCard + 48
  return {
    center: { x: 0, y: 0 },
    neighbors,
    rings: activeRings.map((r) => r.radius),
    width: reach * 2,
    height: reach * 2
  }
}

/** VueFlow 节点盒左上角 = 布局中心坐标减去半盒 */
export function nodeBox(x: number, y: number, w: number, h: number) {
  return { x: x - w / 2, y: y - h / 2 }
}
