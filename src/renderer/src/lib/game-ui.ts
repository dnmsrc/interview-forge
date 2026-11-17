/** 游戏化前端展示辅助：稀有度文案等（纯常量/纯函数，组件共用） */
import type { BadgeDef } from '@shared/game'

export const RARITY_LABEL: Record<BadgeDef['rarity'], string> = {
  common: '普通',
  rare: '稀有',
  epic: '史诗',
  legendary: '传说'
}

/** 事件类型 → 庆祝图标（兜底，组件内优先用事件自带 badgeIcon） */
export const EVENT_ICON: Record<string, string> = {
  xp: '⭐',
  'level-up': '✨',
  badge: '🏅',
  streak: '🔥',
  'node-lit': '💡',
  'node-mastered': '🧠',
  'chapter-clear': '🏆',
  'boss-beaten': '🐲'
}
