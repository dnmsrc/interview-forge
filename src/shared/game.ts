/**
 * 游戏化规则（R20）：XP/等级曲线、段位头衔、徽章目录、Boss 关判定。
 * 纯函数 + 常量，主进程 services/game.ts 与渲染端 HUD/徽章墙/庆祝弹窗共用同一份，
 * 避免两边各算一套导致「等级对不上」。
 */

/* ------------------------------- XP 与等级 ------------------------------- */

/**
 * 单题基础 XP（按评分四档）。鼓励真会：3 档满分给足，0 档也给安慰分，不让挫败感归零。
 */
export const XP_BY_SCALE4: number[] = [2, 6, 12, 20]

/** 额外加成（在基础 XP 上叠加，全部为正数小奖励，避免惩罚感） */
export const XP_BONUS = {
  /** 首次答对一道此前从未作答的题（开荒） */
  firstClear: 8,
  /** 首次把一个考点点亮（lit 0→1） */
  nodeLit: 15,
  /** 考点进入「已掌握」四态 */
  nodeMastered: 25,
  /** 当天第一次作答（启动学习） */
  dailyFirst: 10,
  /** 连续打卡里程碑（按 streak 命中档位时给） */
  streak: 30,
  /** 章节全部通关 */
  chapterClear: 60,
  /** 击败章节 Boss 综合关 */
  bossBeaten: 80
} as const

/**
 * 等级曲线：升到 level 所需的累计 XP。
 * 采用递增门槛 base * (level-1)^1.5，前期升级快（即时正反馈），后期逐渐耐玩。
 * levelForXp 与 xpProgress 是唯一权威换算，DB 里的 level 列仅作快照。
 */
export const LEVEL_BASE = 120
export const MAX_LEVEL = 30

/** 升到指定等级（level >= 2）所需的「累计 XP 门槛」 */
export function xpThresholdForLevel(level: number): number {
  if (level <= 1) return 0
  const lv = Math.min(level, MAX_LEVEL + 1)
  return Math.round(LEVEL_BASE * Math.pow(lv - 1, 1.5))
}

/** 由累计 XP 反推当前等级（1..MAX_LEVEL） */
export function levelForXp(xp: number): number {
  let level = 1
  while (level < MAX_LEVEL && xp >= xpThresholdForLevel(level + 1)) level++
  return level
}

/** 当前等级内的进度（用于 HUD 等级条）：本级已得 XP / 本级跨度 */
export function xpProgress(xp: number): { level: number; into: number; span: number; pct: number; intoNext: number } {
  const level = levelForXp(xp)
  if (level >= MAX_LEVEL) {
    const floor = xpThresholdForLevel(MAX_LEVEL)
    return { level, into: xp - floor, span: 0, pct: 1, intoNext: 0 }
  }
  const floor = xpThresholdForLevel(level)
  const ceil = xpThresholdForLevel(level + 1)
  const into = xp - floor
  const span = ceil - floor
  return { level, into, span, pct: span ? Math.min(1, into / span) : 0, intoNext: Math.max(0, ceil - xp) }
}

/**
 * 冒险者段位头衔（随等级进阶，替代 R19 仅按点亮率的 5 档）。
 * 覆盖到 MAX_LEVEL，末尾头衔兜底。
 */
export const LEVEL_TITLES: { minLevel: number; title: string; icon: string }[] = [
  { minLevel: 1, title: '见习冒险者', icon: '🗡️' },
  { minLevel: 3, title: '前端学徒', icon: '🛡️' },
  { minLevel: 6, title: '前端工匠', icon: '⚒️' },
  { minLevel: 10, title: '前端专家', icon: '📘' },
  { minLevel: 15, title: '框架骑士', icon: '🏇' },
  { minLevel: 20, title: '工程领主', icon: '🏰' },
  { minLevel: 25, title: '前端大师', icon: '👑' }
]
export function titleForLevel(level: number): { title: string; icon: string } {
  let cur = LEVEL_TITLES[0]
  for (const t of LEVEL_TITLES) if (level >= t.minLevel) cur = t
  return { title: cur.title, icon: cur.icon }
}

/* ------------------------------- 连续打卡 ------------------------------- */

/** streak 里程碑徽章/奖励触发档位 */
export const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100]

/* ------------------------------- 徽章目录 ------------------------------- */

export type BadgeKind = 'starter' | 'streak' | 'mastery' | 'chapter' | 'boss' | 'grind' | 'perfect' | 'explorer'

export interface BadgeDef {
  id: string
  name: string
  desc: string
  icon: string
  kind: BadgeKind
  /** 稀有度，用于徽章墙排序与光效 */
  rarity: 'common' | 'rare' | 'epic' | 'legendary'
}

/**
 * 徽章目录。id 即落库 game_badges.badge_id，必须稳定不可改（改了等于老用户丢成就）。
 * 章节/Boss 类徽章带 {chapterNo} 占位，由服务端按章节实例化判定。
 */
export const BADGE_DEFS: BadgeDef[] = [
  { id: 'first-step', name: '初出茅庐', desc: '完成第一次作答', icon: '👣', kind: 'starter', rarity: 'common' },
  { id: 'streak-3', name: '三日不辍', desc: '连续打卡 3 天', icon: '🔥', kind: 'streak', rarity: 'common' },
  { id: 'streak-7', name: '一周坚持', desc: '连续打卡 7 天', icon: '🔥', kind: 'streak', rarity: 'rare' },
  { id: 'streak-14', name: '两周苦修', desc: '连续打卡 14 天', icon: '🔥', kind: 'streak', rarity: 'rare' },
  { id: 'streak-30', name: '月度修行', desc: '连续打卡 30 天', icon: '🌙', kind: 'streak', rarity: 'epic' },
  { id: 'streak-60', name: '季度达人', desc: '连续打卡 60 天', icon: '☀️', kind: 'streak', rarity: 'epic' },
  { id: 'streak-100', name: '百日宗师', desc: '连续打卡 100 天', icon: '🌠', kind: 'streak', rarity: 'legendary' },
  { id: 'lit-10', name: '小有所成', desc: '点亮 10 个考点', icon: '💡', kind: 'mastery', rarity: 'common' },
  { id: 'lit-30', name: '知识拓荒', desc: '点亮 30 个考点', icon: '💡', kind: 'mastery', rarity: 'rare' },
  { id: 'lit-60', name: '博学多识', desc: '点亮 60 个考点', icon: '📚', kind: 'mastery', rarity: 'epic' },
  { id: 'mastered-20', name: '融会贯通', desc: '20 个考点达到「已掌握」', icon: '🧠', kind: 'mastery', rarity: 'epic' },
  { id: 'answer-100', name: '百炼成钢', desc: '累计作答 100 题', icon: '⚙️', kind: 'grind', rarity: 'rare' },
  { id: 'answer-300', name: '题海战士', desc: '累计作答 300 题', icon: '⚔️', kind: 'grind', rarity: 'epic' },
  { id: 'perfect-20', name: '满分猎手', desc: '累计 20 次满分（3 档）作答', icon: '🎯', kind: 'perfect', rarity: 'rare' },
  { id: 'must-clear', name: '红线守护者', desc: '点亮全部必考基础考点', icon: '🛡️', kind: 'mastery', rarity: 'legendary' },
  { id: 'explorer', name: '地图探索者', desc: '在知识图谱打开过 5 个不同章节', icon: '🧭', kind: 'explorer', rarity: 'common' }
]

/** 章节通关徽章 id（章节序号 1..n） */
export const chapterBadgeId = (chapterNo: number) => `chapter-${chapterNo}`
export const chapterBadgeDef = (chapterNo: number, name: string): BadgeDef => ({
  id: chapterBadgeId(chapterNo), name: `征服·${name}`, desc: `通关第 ${chapterNo} 章全部关卡`,
  icon: '🏅', kind: 'chapter', rarity: 'rare'
})
/** 章节 Boss 击败徽章 id */
export const bossBadgeId = (chapterNo: number) => `boss-${chapterNo}`
export const bossBadgeDef = (chapterNo: number, name: string): BadgeDef => ({
  id: bossBadgeId(chapterNo), name: `屠龙·${name}`, desc: `击败第 ${chapterNo} 章 Boss 综合关`,
  icon: '🐲', kind: 'boss', rarity: 'epic'
})

export const BADGE_BY_ID = new Map<string, BadgeDef>(BADGE_DEFS.map((b) => [b.id, b]))
export const RARITY_ORDER: Record<BadgeDef['rarity'], number> = { common: 0, rare: 1, epic: 2, legendary: 3 }

/* ------------------------------- Boss 关 ------------------------------- */

/**
 * 章节 Boss 关：每章最后一个「有题、必考或高难」的叶子考点作为综合关。
 * 选择规则（纯函数，服务端在每次作答后用真实节点数据复核）：
 * * 优先 must_master=1 的最后一关；否则取难度最高（再按 ord 最靠后）的叶子。
 * Boss 关不新增假数据，只是给真实考点打上 Boss 标记并要求「已掌握」才算击败。
 */
export interface BossStage {
  chapterId: string
  chapterNo: number
  chapterName: string
  nodeId: string
  nodeTitle: string
}

/* ------------------------------- 庆祝事件 ------------------------------- */

export type GameEventKind =
  | 'xp'
  | 'level-up'
  | 'badge'
  | 'streak'
  | 'node-lit'
  | 'node-mastered'
  | 'chapter-clear'
  | 'boss-beaten'

export interface GameEventPayload {
  /** 本次事件相关的 XP 增量（level-up/badge 等可能为 0 或附带奖励分） */
  xpGain?: number
  level?: number
  title?: string
  badgeId?: string
  badgeName?: string
  badgeIcon?: string
  streak?: number
  nodeId?: string
  nodeTitle?: string
  chapterNo?: number
  chapterName?: string
  text?: string
}

/** 跨 IPC 的事件 DTO：payload 字段 + kind 判别 */
export interface GameEventDto extends GameEventPayload {
  kind: GameEventKind
}

/** HUD 概览 DTO（主进程 gameOverview 的返回形状） */
export interface GameOverviewDto {
  xp: number
  level: number
  levelTitle: string
  levelIcon: string
  into: number
  span: number
  levelPct: number
  intoNext: number
  streak: number
  bestStreak: number
  answeredTotal: number
  perfectTotal: number
  chaptersCleared: number
  bossesBeaten: number
  badgeCount: number
  totalBadges: number
}

/** 徽章墙单项：静态/动态徽章定义 + 解锁状态 */
export interface BadgeWallItem extends BadgeDef {
  unlocked: boolean
  unlockedAt: string | null
}

/** 章节/Boss 进度 DTO */
export interface ChapterProgressDto {
  chapterId: string
  chapterNo: number
  chapterName: string
  icon: string
  hue: number
  total: number
  lit: number
  clear: boolean
  boss: { nodeId: string; nodeTitle: string; beaten: boolean } | null
}
