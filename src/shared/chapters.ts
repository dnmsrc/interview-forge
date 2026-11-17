/**
 * 板块章节世界模型（R19 布局 / R20 游戏化共用）。
 * 从 renderer/lib/graph-world.ts 下沉到共享层：主进程要据此判定章节通关与 Boss 关，
 * 渲染端要据此画蛇形布局，两边必须是同一份章节划分，否则「地图上的章」和「发奖励的章」会对不上。
 */

export interface ChapterDef {
  /** 章节序号（从 1 开始，决定世界顺序） */
  no: number
  /** 章节 id */
  id: string
  /** 冒险主题名 */
  name: string
  /** 副标题（覆盖的知识范围一句话） */
  sub: string
  /** 包含的 L2 模块 id（按学习先后排序） */
  modules: string[]
  /** 主题色（HSL 基色，关卡/旗帜/路径用） */
  hue: number
  /** 章节 emoji 旗帜 */
  icon: string
}

/**
 * 前端板块 7 大章节世界。模块顺序即学习先后，与摸底 STAGE_ORDER 同源逻辑。
 * 未命中的模块由兜底章节「远征群岛」收纳，新增模块无需改这里也能落位。
 */
export const FE_CHAPTERS: ChapterDef[] = [
  { no: 1, id: 'ch-foundation', name: '筑基荒野', sub: 'HTML 骨架 · CSS 样式与布局', modules: ['fe.html', 'fe.css'], hue: 142, icon: '🌱' },
  { no: 2, id: 'ch-script', name: '脚本密林', sub: 'JS 核心语言 · 数据结构', modules: ['fe.js'], hue: 48, icon: '🌳' },
  { no: 3, id: 'ch-type', name: '类型神殿', sub: 'TypeScript 类型系统', modules: ['fe.ts'], hue: 212, icon: '🏛️' },
  { no: 4, id: 'ch-browser', name: '浏览器秘境', sub: '渲染原理 · 事件循环 · 网络通信', modules: ['fe.browser', 'fe.network'], hue: 190, icon: '🌉' },
  { no: 5, id: 'ch-framework', name: '框架王城', sub: 'Vue 3 全家桶 · 周边生态', modules: ['fe.vue', 'fe.eco'], hue: 258, icon: '👑' },
  { no: 6, id: 'ch-engineering', name: '工程巨龙', sub: '工程化构建 · 性能优化', modules: ['fe.build', 'fe.perf'], hue: 12, icon: '🐉' },
  { no: 7, id: 'ch-cross', name: '远征群岛', sub: 'Electron · 跨端与小程序', modules: ['fe.electron', 'fe.uniapp'], hue: 280, icon: '🚀' }
]

/** 兜底章节（收纳未命中任何模块的叶子，保证新增模块也能落位） */
export const FALLBACK_CHAPTER: ChapterDef = {
  no: (FE_CHAPTERS.at(-1)?.no ?? 0) + 1, id: 'ch-extra', name: '远征群岛',
  sub: '拓展知识', modules: [], hue: 280, icon: '🧭'
}

export const modOf = (id: string): string => id.split('.').slice(0, 2).join('.')

/** 板块 → 章节定义（当前只有前端做了精细世界，其它板块走通用兜底） */
export function chaptersOf(domain: string): ChapterDef[] {
  if (domain === 'fe') return FE_CHAPTERS
  return []
}

const chapterIndex = new Map<string, ChapterDef>()
for (const c of FE_CHAPTERS) for (const m of c.modules) chapterIndex.set(m, c)

/** 按节点 id 定位章节（未知模块落到兜底章） */
export function chapterOfNode(nodeId: string): ChapterDef {
  return chapterIndex.get(modOf(nodeId)) ?? FALLBACK_CHAPTER
}
