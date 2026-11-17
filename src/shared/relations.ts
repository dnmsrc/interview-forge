/**
 * 知识关系本体（ontology）——全应用唯一的关系类型真源。
 *
 * 设计背景：旧版 edges 只有 prereq / related 两种语义，489 条边全量渲染糊成毛球，
 * 既表达不了「依存/平行/印证」，也没有讲解衍生价值。R19 重构为 9 类边：
 *
 * 有向学习链（带箭头，构成闯关主轴）：
 *   advance  进阶——学习顺序的下一台阶（A 先于 B）
 *   depend   依存——理解地基，不懂 A 不可能真懂 B（与学习顺序无关）
 *   apply    应用——A 是原理，B 是 A 的落地实战
 *   evolve   演化——B 是 A 的版本演进/替代方案
 *
 * 无向语义网（不带箭头，聚焦/关系透镜中浮现）：
 *   parallel 平行——同层并列、无先后、可互换顺序学
 *   contrast 对比——易混/对立/选型对照（SSE vs WebSocket 这类）
 *   analogy  类比——跨域机制神似、可互相打比方
 *   verify   印证——跨章节原理复用、互相验证
 *   relate   关联——兜底弱关联
 *
 * 另保留 contains（层级归属），不参与关系透镜与叙事抽屉，只承载章节/关卡结构。
 */

/** 9 类语义边（不含 contains 结构边） */
export type RelationType =
  | 'advance' | 'depend' | 'apply' | 'evolve'
  | 'parallel' | 'contrast' | 'analogy' | 'verify' | 'relate'

/** 有向边（学习链，箭头从 from 指向 to） */
export const DIRECTED_TYPES: RelationType[] = ['advance', 'depend', 'apply', 'evolve']
/** 无向边（语义网，存储时规范化为字典序单向，渲染无箭头） */
export const UNDIRECTED_TYPES: RelationType[] = ['parallel', 'contrast', 'analogy', 'verify', 'relate']

/**
 * 学习链类型（有向、表达先学后学/地基关系）。
 * 硬锁只有 advance：depend 跨模块时会反向指向后学概念（入门关被后学节点声明为地基），
 * 若也参与硬锁会把零前置入门关卡死，因此 depend 只在抽屉做「地基缺失」提示、不锁人。
 */
export const GATE_TYPES: RelationType[] = ['advance', 'depend']
/** 真正构成解锁硬门槛的类型（组卷/摸底/图谱 locked 只认这一类） */
export const HARD_GATE_TYPES: RelationType[] = ['advance']

/** 结构边（层级包含，不画进关系透镜） */
export const STRUCTURAL_TYPE = 'contains'
/** 兼容旧库/旧 JSON 的边名 → 新本体映射的输入名 */
export const LEGACY_TYPES = ['prereq', 'related', 'contains'] as const

export interface RelationMeta {
  /** 边类型 id */
  type: RelationType
  /** 中文短标签（边标签、筛选用） */
  label: string
  /** 一句话语义，用于图例与悬停说明 */
  hint: string
  /** 是否有向（决定箭头） */
  directed: boolean
  /** 是否构成解锁门槛 */
  gate: boolean
  /** 主题分组，用于透镜筛选分组与抽屉叙事分组 */
  group: 'chain' | 'semantic'
  /** 线型：solid 实线 / dashed 虚线 / dotted 点线 */
  dash: 'solid' | 'dashed' | 'dotted'
  /** CSS 变量色名（渲染层 var(--xxx)，自动跟随明暗主题） */
  colorVar: string
  /** MiniMap / 截图探针等 var() 不生效场景的双主题兜底实色 */
  hex: { dark: string; light: string }
  /** 抽屉里的叙事标题（出边/入边视角各一个） */
  drawer: { out: string; in: string }
}

export const RELATION_META: Record<RelationType, RelationMeta> = {
  advance: {
    type: 'advance', label: '进阶', hint: '学习顺序的下一台阶：先学会它，再打这一关',
    directed: true, gate: true, group: 'chain', dash: 'solid',
    colorVar: '--rel-advance', hex: { dark: '#7b83eb', light: '#5e6ad2' },
    drawer: { out: '下一台阶（进阶）', in: '前置台阶' }
  },
  depend: {
    type: 'depend', label: '依存', hint: '理解地基：不懂它就不可能真懂这一关',
    directed: true, gate: true, group: 'chain', dash: 'solid',
    colorVar: '--rel-depend', hex: { dark: '#f0883e', light: '#c2410c' },
    drawer: { out: '依赖它才能学', in: '它的理解地基（依存）' }
  },
  apply: {
    type: 'apply', label: '应用', hint: '原理 → 落地实战：这个原理在那道题/那个手写场景里用',
    directed: true, gate: false, group: 'chain', dash: 'solid',
    colorVar: '--rel-apply', hex: { dark: '#3fb950', light: '#157f3d' },
    drawer: { out: '原理的实战应用', in: '背后的原理' }
  },
  evolve: {
    type: 'evolve', label: '演化', hint: '技术演进/替代关系：旧方案 → 新方案',
    directed: true, gate: false, group: 'chain', dash: 'dashed',
    colorVar: '--rel-evolve', hex: { dark: '#d29922', light: '#a16207' },
    drawer: { out: '演进到', in: '由它演化而来' }
  },
  parallel: {
    type: 'parallel', label: '平行', hint: '同层并列、互不前置，可互换顺序学',
    directed: false, gate: false, group: 'semantic', dash: 'dashed',
    colorVar: '--rel-parallel', hex: { dark: '#34b3c7', light: '#0e7490' },
    drawer: { out: '平行考点', in: '平行考点' }
  },
  contrast: {
    type: 'contrast', label: '对比', hint: '易混/对立/选型对照，放一起记最清楚',
    directed: false, gate: false, group: 'semantic', dash: 'dashed',
    colorVar: '--rel-contrast', hex: { dark: '#f85149', light: '#d1242f' },
    drawer: { out: '易混对比', in: '易混对比' }
  },
  analogy: {
    type: 'analogy', label: '类比', hint: '跨域机制神似，可用它打比方帮助理解',
    directed: false, gate: false, group: 'semantic', dash: 'dotted',
    colorVar: '--rel-analogy', hex: { dark: '#a78bfa', light: '#7c3aed' },
    drawer: { out: '可类比', in: '可类比' }
  },
  verify: {
    type: 'verify', label: '印证', hint: '跨章节原理复用、互相验证，把知识串成网',
    directed: false, gate: false, group: 'semantic', dash: 'dotted',
    colorVar: '--rel-verify', hex: { dark: '#e3b341', light: '#b5851f' },
    drawer: { out: '跨域印证', in: '跨域印证' }
  },
  relate: {
    type: 'relate', label: '关联', hint: '确实相关但不属于以上任一的弱关联',
    directed: false, gate: false, group: 'semantic', dash: 'dotted',
    colorVar: '--rel-relate', hex: { dark: '#6b7686', light: '#8b949e' },
    drawer: { out: '其它关联', in: '其它关联' }
  }
}

/** 抽屉叙事顺序（有向链在前、语义网在后） */
export const RELATION_ORDER: RelationType[] = [
  'depend', 'advance', 'apply', 'evolve', 'parallel', 'contrast', 'analogy', 'verify', 'relate'
]

export const isRelationType = (t: string): t is RelationType => t in RELATION_META
export const isDirected = (t: string) => DIRECTED_TYPES.includes(t as RelationType)
export const isGate = (t: string) => GATE_TYPES.includes(t as RelationType)

/** SQL 片段：门槛边类型占位（配合参数绑定 GATE_TYPES 使用） */
export const GATE_TYPES_SQL = GATE_TYPES.map(() => '?').join(',')
