import { all, get, run, tx } from '../db'
import {
  XP_BY_SCALE4, XP_BONUS, levelForXp, xpProgress, titleForLevel,
  BADGE_DEFS, BADGE_BY_ID, chapterBadgeId, chapterBadgeDef, bossBadgeId, bossBadgeDef,
  STREAK_MILESTONES, type GameEventPayload, type GameEventDto, type BadgeDef, type BossStage
} from '../../shared/game'
import { FE_CHAPTERS, chapterOfNode, type ChapterDef } from '../../shared/chapters'

/**
 * 游戏化服务（R20）：XP/等级、连续打卡、徽章墙、章节 Boss、庆祝事件。
 *
 * 设计原则：
 * 1. 所有奖励都挂在真实学习行为上（recordAttempt 之后调用 recordAnswer），不发无意义水分；
 * 2. 幂等：同一题同一次提交不会重复发奖（靠调用方只在真实 recordAttempt 后触发 + 徽章 UNIQUE）；
 * 3. 只写用户表（game_stats/game_badges/game_events），绝不改 attempts/mastery，两套数据解耦；
 * 4. 庆祝事件落库带 read 标记，前端拉未读事件弹窗，重开应用也不丢尚未展示的奖励。
 */

const dayStr = (d = new Date()) => d.toISOString().slice(0, 10)
const nowStr = () => new Date().toISOString().slice(0, 19).replace('T', ' ')

interface StatsRow {
  id: number; xp: number; level: number; streak: number; best_streak: number; last_active_day: string | null
  answered_total: number; perfect_total: number; chapters_cleared: number; bosses_beaten: number; updated_at: string | null
}

function ensureStats(): StatsRow {
  let row = get<StatsRow>(`SELECT * FROM game_stats WHERE id=1`)
  if (!row) {
    run(`INSERT INTO game_stats(id) VALUES(1)`)
    row = get<StatsRow>(`SELECT * FROM game_stats WHERE id=1`)!
  }
  return row
}

function pushEvent(kind: string, payload: GameEventPayload, refId?: string | null) {
  run(`INSERT INTO game_events(kind,payload,ref_id) VALUES(?,?,?)`,
    [kind, JSON.stringify(payload), refId ?? null])
}

function addXp(amount: number): { xp: number; leveledUp: boolean; newLevel: number; oldLevel: number } {
  const before = ensureStats()
  const oldLevel = levelForXp(before.xp)
  const xp = before.xp + Math.max(0, Math.round(amount))
  const newLevel = levelForXp(xp)
  run(`UPDATE game_stats SET xp=?, level=?, updated_at=? WHERE id=1`, [xp, newLevel, nowStr()])
  return { xp, leveledUp: newLevel > oldLevel, newLevel, oldLevel }
}

/** 解锁徽章（幂等）：已存在直接返回 false，新解锁发事件并给徽章本身的 XP 奖励 */
function unlockBadge(def: BadgeDef, meta: Record<string, unknown> = {}): boolean {
  const existed = get<{ badge_id: string }>(`SELECT badge_id FROM game_badges WHERE badge_id=?`, [def.id])
  if (existed) return false
  const stats = ensureStats()
  run(`INSERT INTO game_badges(badge_id,xp_snapshot,meta) VALUES(?,?,?)`, [def.id, stats.xp, JSON.stringify(meta)])
  // 稀有度越高，解锁奖励越厚
  const rarityXp = { common: 0, rare: 15, epic: 30, legendary: 60 }[def.rarity]
  if (rarityXp) addXp(rarityXp)
  pushEvent('badge', { badgeId: def.id, badgeName: def.name, badgeIcon: def.icon, xpGain: rarityXp, title: `获得徽章「${def.name}」` }, def.id)
  return true
}

/* ------------------------------- 章节 / Boss 计算 ------------------------------- */

interface LeafRow { id: string; title: string; must_master: number; ord: number; q_total: number }

/** 取某板块全部 L4 叶子（含题量），用于章节分组与 Boss 选择 */
function domainLeaves(domain: string): LeafRow[] {
  return all<LeafRow>(
    `SELECT n.id,n.title,n.must_master,n.ord,
       (SELECT COUNT(*) FROM questions q WHERE q.node_id=n.id AND q.status='active') q_total
     FROM nodes n WHERE n.level=4 AND n.domain=? ORDER BY n.ord`, [domain])
}

/** 叶子按章节分组（与渲染端 buildWorld 同一套 chapterOfNode 规则） */
function leavesByChapter(domain: string): Map<string, { def: ChapterDef; leaves: LeafRow[] }> {
  const map = new Map<string, { def: ChapterDef; leaves: LeafRow[] }>()
  for (const leaf of domainLeaves(domain)) {
    const def = chapterOfNode(leaf.id)
    if (!map.has(def.id)) map.set(def.id, { def, leaves: [] })
    map.get(def.id)!.leaves.push(leaf)
  }
  return map
}

/**
 * 选章节 Boss 关：章内有题的叶子里，优先必考（must_master），再取 ord 最靠后的综合关。
 * 没有任何有题叶子的章节不设 Boss。
 */
export function bossForChapter(def: ChapterDef, leaves: LeafRow[]): BossStage | null {
  const withQ = leaves.filter((l) => l.q_total > 0)
  if (!withQ.length) return null
  const must = withQ.filter((l) => l.must_master === 1)
  const pool = must.length ? must : withQ
  const boss = [...pool].sort((a, b) => b.ord - a.ord)[0]
  return { chapterId: def.id, chapterNo: def.no, chapterName: def.name, nodeId: boss.id, nodeTitle: boss.title }
}

/** 全板块 Boss 清单（渲染端地图打 Boss 标记用） */
export function listBosses(domain = 'fe'): BossStage[] {
  const out: BossStage[] = []
  for (const { def, leaves } of leavesByChapter(domain).values()) {
    const boss = bossForChapter(def, leaves)
    if (boss) out.push(boss)
  }
  return out.sort((a, b) => a.chapterNo - b.chapterNo)
}

/** 已点亮考点 id 集合 */
function litSet(): Set<string> {
  return new Set(all<{ node_id: string }>(`SELECT node_id FROM node_mastery WHERE lit=1`).map((r) => r.node_id))
}

/** 已掌握（mastery_level=2）考点 id 集合，Boss 要求「已掌握」而非仅点亮 */
function masteredSet(): Set<string> {
  return new Set(all<{ node_id: string }>(`SELECT node_id FROM node_mastery WHERE mastery_level=2`).map((r) => r.node_id))
}

/* ------------------------------- 主入口：作答后结算 ------------------------------- */

export interface AnswerSettlement {
  xpGain: number
  totalXp: number
  level: number
  leveledUp: boolean
  streak: number
  events: GameEventDto[]
  newBadges: BadgeDef[]
  chapterCleared: { chapterNo: number; chapterName: string } | null
  bossBeaten: BossStage | null
}

/**
 * 在一次真实作答落库（srs.recordAttempt 之后）调用，结算 XP/打卡/徽章/章节/Boss。
 * @param qid 题目 id
 * @param scale4 0..3 评分
 * @param beforeLit 本次提交前该考点是否已点亮（用于发「首次点亮」奖）
 * @param beforeLevel 本次提交前该考点 mastery_level（用于发「首次掌握」奖）
 */
export function recordAnswer(input: {
  qid: string; scale4: number; mode: string
  beforeLit: number; beforeLevel: number
}): AnswerSettlement {
  const q = get<{ node_id: string }>(`SELECT node_id FROM questions WHERE id=?`, [input.qid])
  const nodeId = q?.node_id ?? ''
  const node = nodeId ? get<{ title: string; domain: string }>(`SELECT title,domain FROM nodes WHERE id=?`, [nodeId]) : undefined
  const domain = node?.domain ?? 'fe'
  const gained: GameEventDto[] = []
  const newBadges: BadgeDef[] = []
  let xpGain = 0

  return tx(() => {
    const stats = ensureStats()
    const today = dayStr()

    // 1) 连续打卡：今天首次作答推进 streak；跨天断档归零重计
    let streak = stats.streak
    let streakMilestone = false
    if (stats.last_active_day !== today) {
      const yesterday = dayStr(new Date(Date.now() - 86400000))
      streak = stats.last_active_day === yesterday ? stats.streak + 1 : 1
      const best = Math.max(stats.best_streak, streak)
      run(`UPDATE game_stats SET streak=?, best_streak=?, last_active_day=? WHERE id=1`, [streak, best, today])
      if (STREAK_MILESTONES.includes(streak)) {
        streakMilestone = true
        pushEvent('streak', { streak, xpGain: XP_BONUS.streak, title: `连续打卡 ${streak} 天！` })
      }
    }

    // 2) 基础 XP（按四档）+ 当天首答加成
    const base = XP_BY_SCALE4[Math.max(0, Math.min(3, input.scale4))] ?? 2
    xpGain += base
    const isFirstOfDay = stats.last_active_day !== today || stats.answered_total === 0
    if (isFirstOfDay) xpGain += XP_BONUS.dailyFirst

    // 3) 计数
    const perfect = input.scale4 >= 3 ? 1 : 0
    run(`UPDATE game_stats SET answered_total=answered_total+1, perfect_total=perfect_total+? WHERE id=1`, [perfect])

    // 4) 考点首次点亮 / 首次掌握（用提交前快照判定，避免重算后读不到 0→1 跳变）
    const afterMastery = nodeId ? get<{ lit: number; mastery_level: number }>(
      `SELECT lit,mastery_level FROM node_mastery WHERE node_id=?`, [nodeId]) : undefined
    if (nodeId && input.beforeLit === 0 && afterMastery?.lit === 1) {
      xpGain += XP_BONUS.nodeLit
      pushEvent('node-lit', { nodeId, nodeTitle: node?.title, xpGain: XP_BONUS.nodeLit, title: `点亮考点「${node?.title}」` })
    }
    if (nodeId && input.beforeLevel !== 2 && afterMastery?.mastery_level === 2) {
      xpGain += XP_BONUS.nodeMastered
      pushEvent('node-mastered', { nodeId, nodeTitle: node?.title, xpGain: XP_BONUS.nodeMastered, title: `完全掌握「${node?.title}」` })
    }
    if (streakMilestone) xpGain += XP_BONUS.streak

    // 5) 章节通关 & Boss（仅前端精细世界）
    let chapterCleared: AnswerSettlement['chapterCleared'] = null
    let bossBeaten: BossStage | null = null
    if (domain === 'fe' && nodeId) {
      const result = evaluateChapters(domain, newBadges, gained)
      chapterCleared = result.cleared
      bossBeaten = result.boss
      if (chapterCleared) xpGain += XP_BONUS.chapterClear
      if (bossBeaten) xpGain += XP_BONUS.bossBeaten
    }

    // 6) 汇总入账 XP，判定升级
    const xpRes = addXp(xpGain)
    if (xpRes.leveledUp) {
      const t = titleForLevel(xpRes.newLevel)
      pushEvent('level-up', { level: xpRes.newLevel, title: `升级到 Lv.${xpRes.newLevel} ${t.icon} ${t.title}` })
    }
    pushEvent('xp', { xpGain, text: `本次 +${xpGain} XP` })

    // 7) 全局徽章复核（计数/点亮/streak 类，每次作答后统一检查，天然幂等）
    evaluateGlobalBadges(newBadges)

    const fresh = all<{ kind: string; payload: string }>(
      `SELECT kind,payload FROM game_events ORDER BY id DESC LIMIT 24`).reverse()
    for (const e of fresh) {
      try { gained.push({ kind: e.kind as GameEventDto['kind'], ...JSON.parse(e.payload) }) } catch { /* ignore */ }
    }

    return {
      xpGain, totalXp: xpRes.xp, level: xpRes.newLevel, leveledUp: xpRes.leveledUp,
      streak, events: dedupeEvents(gained), newBadges, chapterCleared, bossBeaten
    }
  })
}

/** 章节通关 + Boss 击败复核，返回本次新发生的部分 */
function evaluateChapters(domain: string, newBadges: BadgeDef[], _gained: GameEventDto[]) {
  const lit = litSet()
  const mastered = masteredSet()
  let cleared: AnswerSettlement['chapterCleared'] = null
  let boss: BossStage | null = null
  const clearedCount = { n: 0 }

  for (const { def, leaves } of leavesByChapter(domain).values()) {
    if (!leaves.length) continue
    const allLit = leaves.every((l) => lit.has(l.id))
    const bossStage = bossForChapter(def, leaves)
    const bossDone = !!bossStage && mastered.has(bossStage.nodeId)
    if (allLit) clearedCount.n++
    // 章节通关徽章：整章叶子全点亮
    if (allLit) {
      const def2 = chapterBadgeDef(def.no, def.name)
      if (unlockBadge(def2, { chapterNo: def.no, leaves: leaves.length })) {
        cleared = { chapterNo: def.no, chapterName: def.name }
        run(`UPDATE game_stats SET chapters_cleared=? WHERE id=1`, [clearedCount.n])
        pushEvent('chapter-clear', { chapterNo: def.no, chapterName: def.name, xpGain: XP_BONUS.chapterClear, title: `通关第 ${def.no} 章「${def.name}」` })
      }
    }
    // Boss 徽章：Boss 关达到已掌握
    if (bossDone && bossStage) {
      const bdef = bossBadgeDef(def.no, def.name)
      if (unlockBadge(bdef, { chapterNo: def.no, nodeId: bossStage.nodeId })) {
        boss = bossStage
        run(`UPDATE game_stats SET bosses_beaten=bosses_beaten+1 WHERE id=1`)
        pushEvent('boss-beaten', { chapterNo: def.no, chapterName: def.name, nodeId: bossStage.nodeId, nodeTitle: bossStage.nodeTitle, xpGain: XP_BONUS.bossBeaten, title: `击败第 ${def.no} 章 Boss：${bossStage.nodeTitle}` })
        newBadges.push(bdef)
      }
    }
  }
  return { cleared, boss }
}

/** 计数/点亮/streak 类徽章的统一复核（unlockBadge 内部幂等） */
function evaluateGlobalBadges(newBadges: BadgeDef[]) {
  const stats = ensureStats()
  const litCount = get<{ n: number }>(`SELECT COUNT(*) n FROM node_mastery WHERE lit=1`)?.n ?? 0
  const masteredCount = get<{ n: number }>(`SELECT COUNT(*) n FROM node_mastery WHERE mastery_level=2`)?.n ?? 0
  const mustTotal = get<{ n: number }>(`SELECT COUNT(*) n FROM nodes WHERE must_master=1 AND level=4`)?.n ?? 0
  const mustLit = get<{ n: number }>(`SELECT COUNT(*) n FROM nodes n JOIN node_mastery m ON m.node_id=n.id
    WHERE n.must_master=1 AND n.level=4 AND m.lit=1`)?.n ?? 0

  const tryUnlock = (id: string, cond: boolean, meta: Record<string, unknown> = {}) => {
    if (!cond) return
    const def = BADGE_BY_ID.get(id)
    if (def && unlockBadge(def, meta)) newBadges.push(def)
  }

  tryUnlock('first-step', stats.answered_total >= 1)
  for (const ms of STREAK_MILESTONES) tryUnlock(`streak-${ms}`, stats.best_streak >= ms, { streak: stats.best_streak })
  tryUnlock('lit-10', litCount >= 10, { litCount })
  tryUnlock('lit-30', litCount >= 30, { litCount })
  tryUnlock('lit-60', litCount >= 60, { litCount })
  tryUnlock('mastered-20', masteredCount >= 20, { masteredCount })
  tryUnlock('answer-100', stats.answered_total >= 100, { answered: stats.answered_total })
  tryUnlock('answer-300', stats.answered_total >= 300, { answered: stats.answered_total })
  tryUnlock('perfect-20', stats.perfect_total >= 20, { perfect: stats.perfect_total })
  tryUnlock('must-clear', mustTotal > 0 && mustLit >= mustTotal, { mustLit, mustTotal })
}

/** 探索者徽章：在图谱打开过 N 个不同章节（由渲染端通过 IPC 上报） */
export function reportExplorer(visitedChapterIds: string[]): boolean {
  const uniq = new Set(visitedChapterIds).size
  const def = BADGE_BY_ID.get('explorer')
  if (def && uniq >= 5) return unlockBadge(def, { chapters: uniq })
  return false
}

/**
 * 闭卷考试批量结算：一次考试多道题只推进一次打卡、发一条聚合 XP 事件，
 * 不逐题刷屏。章节/Boss/全局徽章仍统一复核（内部幂等）。
 * 在所有 recordAttempt 完成、mastery 已重算后调用。
 */
export function recordExam(items: { qid: string; scale4: number }[]): AnswerSettlement {
  const gained: GameEventDto[] = []
  const newBadges: BadgeDef[] = []
  return tx(() => {
    const stats = ensureStats()
    const today = dayStr()
    let streak = stats.streak
    let streakMilestone = false
    if (stats.last_active_day !== today) {
      const yesterday = dayStr(new Date(Date.now() - 86400000))
      streak = stats.last_active_day === yesterday ? stats.streak + 1 : 1
      run(`UPDATE game_stats SET streak=?, best_streak=?, last_active_day=? WHERE id=1`,
        [streak, Math.max(stats.best_streak, streak), today])
      if (STREAK_MILESTONES.includes(streak)) {
        streakMilestone = true
        pushEvent('streak', { streak, xpGain: XP_BONUS.streak, title: `连续打卡 ${streak} 天！` })
      }
    }

    // 聚合基础 XP：逐题四档分求和，封顶避免一场长考试刷出巨额经验
    let xpGain = items.reduce((s, it) => s + (XP_BY_SCALE4[Math.max(0, Math.min(3, it.scale4))] ?? 2), 0)
    xpGain = Math.min(xpGain, 200)
    if (streakMilestone) xpGain += XP_BONUS.streak
    const perfect = items.filter((it) => it.scale4 >= 3).length
    run(`UPDATE game_stats SET answered_total=answered_total+?, perfect_total=perfect_total+? WHERE id=1`,
      [items.length, perfect])

    // 涉及到的前端考点统一复核章节/Boss
    const domains = new Set(items.map((it) =>
      get<{ domain: string }>(`SELECT n.domain FROM questions q JOIN nodes n ON n.id=q.node_id WHERE q.id=?`, [it.qid])?.domain).filter(Boolean))
    let chapterCleared: AnswerSettlement['chapterCleared'] = null
    let bossBeaten: BossStage | null = null
    for (const domain of domains) {
      if (domain !== 'fe') continue
      const r = evaluateChapters(domain as string, newBadges, gained)
      if (r.cleared && !chapterCleared) chapterCleared = r.cleared
      if (r.boss && !bossBeaten) bossBeaten = r.boss
    }
    if (chapterCleared) xpGain += XP_BONUS.chapterClear
    if (bossBeaten) xpGain += XP_BONUS.bossBeaten

    const xpRes = addXp(xpGain)
    if (xpRes.leveledUp) {
      const t = titleForLevel(xpRes.newLevel)
      pushEvent('level-up', { level: xpRes.newLevel, title: `升级到 Lv.${xpRes.newLevel} ${t.icon} ${t.title}` })
    }
    pushEvent('xp', { xpGain, text: `本场考试 +${xpGain} XP（${items.length} 题）` })
    evaluateGlobalBadges(newBadges)

    const fresh = all<{ kind: string; payload: string }>(`SELECT kind,payload FROM game_events ORDER BY id DESC LIMIT 30`).reverse()
    for (const e of fresh) { try { gained.push({ kind: e.kind as GameEventDto['kind'], ...JSON.parse(e.payload) }) } catch { /* ignore */ } }
    return {
      xpGain, totalXp: xpRes.xp, level: xpRes.newLevel, leveledUp: xpRes.leveledUp,
      streak, events: dedupeEvents(gained), newBadges, chapterCleared, bossBeaten
    }
  })
}

function dedupeEvents(events: GameEventDto[]): GameEventDto[] {
  const seen = new Set<string>()
  const out: GameEventDto[] = []
  for (const e of events) {
    const key = `${(e as any).kind ?? 'e'}:${e.badgeId ?? e.nodeId ?? e.level ?? e.text ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e)
  }
  return out
}

/* ------------------------------- 查询（HUD / 徽章墙） ------------------------------- */
export interface GameOverview {
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

export function gameOverview(): GameOverview {
  const s = ensureStats()
  const p = xpProgress(s.xp)
  const t = titleForLevel(p.level)
  const badgeCount = get<{ n: number }>(`SELECT COUNT(*) n FROM game_badges`)?.n ?? 0
  return {
    xp: s.xp, level: p.level, levelTitle: t.title, levelIcon: t.icon,
    into: p.into, span: p.span, levelPct: Math.round(p.pct * 1000) / 1000, intoNext: p.intoNext,
    streak: s.streak, bestStreak: s.best_streak, answeredTotal: s.answered_total, perfectTotal: s.perfect_total,
    chaptersCleared: s.chapters_cleared, bossesBeaten: s.bosses_beaten,
    badgeCount, totalBadges: totalBadgeCount()
  }
}

/** 徽章墙：目录全集 + 解锁状态（未解锁也返回，置灰展示进度） */
export function badgeWall(domain = 'fe') {
  const unlocked = new Map(all<{ badge_id: string; unlocked_at: string }>(`SELECT badge_id,unlocked_at FROM game_badges`)
    .map((r) => [r.badge_id, r.unlocked_at]))
  // 动态章节/Boss 徽章（按当前板块章节实例化）
  const dynamic: BadgeDef[] = []
  for (const { def } of leavesByChapter(domain).values()) {
    dynamic.push(chapterBadgeDef(def.no, def.name))
    dynamic.push(bossBadgeDef(def.no, def.name))
  }
  const allDefs = [...BADGE_DEFS, ...dynamic.filter((d) => !BADGE_BY_ID.has(d.id))]
  return allDefs.map((def) => ({
    ...def, unlocked: unlocked.has(def.id), unlockedAt: unlocked.get(def.id) ?? null
  })).sort((a, b) => Number(b.unlocked) - Number(a.unlocked) || a.id.localeCompare(b.id))
}

function totalBadgeCount(): number {
  // 静态目录 + 前端 7 章 × 2（章节通关 + Boss）
  return BADGE_DEFS.length + FE_CHAPTERS.length * 2
}

/** 拉取未读庆祝事件并标记已读（前端进页面/作答后调用） */
export function drainEvents(markRead = true): GameEventDto[] {
  const rows = all<{ id: number; kind: string; payload: string }>(`SELECT id,kind,payload FROM game_events WHERE read=0 ORDER BY id`)
  if (markRead && rows.length) {
    const ids = rows.map((r) => r.id)
    run(`UPDATE game_events SET read=1 WHERE id IN (${ids.map(() => '?').join(',')})`, ids)
  }
  return rows.map((r) => {
    let payload: GameEventPayload = {}
    try { payload = JSON.parse(r.payload) } catch { /* ignore */ }
    return { kind: r.kind as GameEventDto['kind'], ...payload }
  })
}

/** 只看不标已读（预览，当前未使用，留作调试） */
export function peekEvents(limit = 10): GameEventDto[] {
  return all<{ kind: string; payload: string }>(`SELECT kind,payload FROM game_events ORDER BY id DESC LIMIT ?`, [limit])
    .map((r) => ({ kind: r.kind as GameEventDto['kind'], ...(safeJson(r.payload)) }))
}

/** 章节/Boss 进度（地图旗帜与 Boss 标记共用） */
export function chapterProgress(domain = 'fe') {
  const lit = litSet()
  const mastered = masteredSet()
  const bosses = listBosses(domain)
  const bossByChapter = new Map(bosses.map((b) => [b.chapterId, b]))
  return [...leavesByChapter(domain).values()].map(({ def, leaves }) => {
    const litN = leaves.filter((l) => lit.has(l.id)).length
    const boss = bossByChapter.get(def.id) ?? null
    return {
      chapterId: def.id, chapterNo: def.no, chapterName: def.name, icon: def.icon, hue: def.hue,
      total: leaves.length, lit: litN,
      clear: leaves.length > 0 && litN === leaves.length,
      boss: boss ? { nodeId: boss.nodeId, nodeTitle: boss.nodeTitle, beaten: mastered.has(boss.nodeId) } : null
    }
  }).sort((a, b) => a.chapterNo - b.chapterNo)
}

function safeJson(s: string): any { try { return JSON.parse(s) } catch { return {} } }

/**
 * 项目闯关的奖励结算（由 project 服务在「本关首次通过」时调用，已在外层 tx 里）。
 *
 * 为什么不复用 recordAnswer：那条路径是围绕「题目 + 四档评分 + SRS」设计的，
 * 需要 qid / scale4 / 掌握度跳变这些项目关卡根本不存在的东西。这里只做两件事：
 * 加 XP、发一条能被庆祝弹窗识别的 xp 事件。奖励池和等级曲线与答题共用，
 * 所以用户的成长是连续的一条线，而不是两个割裂的游戏。
 */
export function recordProjectLevel(input: {
  projectTitle: string; levelTitle: string; xp: number
  levelIndex: number; levelCount: number; projectDone: boolean
}): { xp: number; level: number; leveledUp: boolean } {
  const res = addXp(input.xp)
  pushEvent('xp', {
    text: `通关「${input.levelTitle}」`,
    title: `+${input.xp} XP`,
    xpGain: input.xp
  } as GameEventPayload)
  if (res.leveledUp) {
    pushEvent('level-up', { level: res.newLevel, xpGain: 0, title: `升到 ${res.newLevel} 级` } as GameEventPayload)
  }
  if (input.projectDone) {
    pushEvent('chapter-clear', {
      text: `「${input.projectTitle}」${input.levelCount} 关全部完成`,
      title: `项目通关：${input.projectTitle}`,
      xpGain: 0
    } as GameEventPayload)
  }
  return { xp: input.xp, level: res.newLevel, leveledUp: res.leveledUp }
}
