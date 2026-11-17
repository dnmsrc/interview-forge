/**
 * 闯关目录的章节世界模型（纯函数，不含 Vue/VueFlow 依赖，方便单测与 QA 探针复用）。
 *
 * R21 重构：蛇形无限画布布局（layoutWorld/坐标常量）已随「闯关目录」改造移除，
 * 本文件只保留把 L4 叶子按章节 + 学习顺序组织成有序关卡序列的模型，
 * 供 LevelMap（手风琴目录）、GraphView（HUD 统计/下一关）与游戏化共用。
 *
 * 章节划分真源在 shared/chapters.ts（主进程发奖与渲染端布局共用同一份）。
 */
import type { GraphNode } from '@shared/types'
import { FE_CHAPTERS, FALLBACK_CHAPTER, chaptersOf, modOf, type ChapterDef } from '@shared/chapters'

export type { ChapterDef }
export { FE_CHAPTERS, chaptersOf, modOf }

export interface WorldNode {
  node: GraphNode
  chapter: ChapterDef
  /** 章内关卡序号（从 0，按学习顺序） */
  seq: number
  /** 全局关卡序号（跨章连续） */
  globalSeq: number
  /** L3 小节标题 */
  sectionTitle: string
  /** L2 模块标题 */
  moduleTitle: string
}

/** 把某板块的 L4 叶子按章节 + 学习顺序组织成世界节点（不含坐标） */
export function buildWorld(domain: string, allNodes: GraphNode[]): WorldNode[] {
  const chapters = chaptersOf(domain)
  const chapterByMod = new Map<string, ChapterDef>()
  for (const c of chapters) for (const m of c.modules) chapterByMod.set(m, c)
  const fallback: ChapterDef = FALLBACK_CHAPTER
  const titleById = new Map(allNodes.map((n) => [n.id, n.title]))
  const leaves = allNodes
    .filter((n) => n.level === 4 && n.domain === domain)
    .sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0))

  const out: WorldNode[] = []
  // 先按章节分组，保持章节顺序；章内按模块→L3→ord
  const byChapter = new Map<string, GraphNode[]>()
  for (const leaf of leaves) {
    const ch = chapterByMod.get(modOf(leaf.id)) ?? fallback
    if (!byChapter.has(ch.id)) byChapter.set(ch.id, [])
    byChapter.get(ch.id)!.push(leaf)
  }
  const orderedChapters = [...chapters]
  if (byChapter.has(fallback.id) && !orderedChapters.some((c) => c.id === fallback.id)) orderedChapters.push(fallback)

  let globalSeq = 0
  for (const ch of orderedChapters) {
    const list = (byChapter.get(ch.id) ?? [])
      .sort((a, b) => {
        const ma = ch.modules.indexOf(modOf(a.id)), mb = ch.modules.indexOf(modOf(b.id))
        return (ma === -1 ? 99 : ma) - (mb === -1 ? 99 : mb) || (a.ord ?? 0) - (b.ord ?? 0)
      })
    list.forEach((node, seq) => {
      const parentId = node.parent
      const moduleTitle = titleById.get(modOf(node.id)) ?? modOf(node.id)
      const sectionTitle = parentId ? (titleById.get(parentId) ?? '') : ''
      out.push({ node, chapter: ch, seq, globalSeq: globalSeq++, sectionTitle, moduleTitle })
    })
  }
  return out
}

/** 计算「下一关」：第一个未点亮、未锁定、有题的关卡（沿全局闯关顺序） */
export function nextStage(world: WorldNode[]): string | null {
  for (const w of world) {
    const n = w.node
    if (n.lit === 1 || n.locked === 1) continue
    if ((n.qTotal ?? 0) <= 0) continue
    return n.id
  }
  return null
}

/** 冒险者段位：按板块掌握百分比映射 5 个头衔（游戏化 XP 等级之外的兜底） */
export const RANKS = [
  { min: 0, title: '见习冒险者' },
  { min: 0.15, title: '前端学徒' },
  { min: 0.4, title: '前端工匠' },
  { min: 0.7, title: '前端专家' },
  { min: 0.95, title: '前端大师' }
]
export function rankOf(pct: number) {
  let cur = RANKS[0]
  for (const r of RANKS) if (pct >= r.min) cur = r
  return cur.title
}
