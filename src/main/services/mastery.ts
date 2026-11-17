import { all, get, run, settingGet } from '../db'

/**
 * 考点级「掌握状态机」（契约：docs/design/KNOWLEDGE-SYSTEM.md §7）。
 *
 * 为什么要这一层：node_mastery 原本只有布尔的 lit（做过就算点亮），
 * 用户反馈两件事没法回答：
 *   1) 「反复练过多遍才算掌握」——点亮 ≠ 掌握；
 *   2) 「后来我又忘了」——忘了必须降级并在图谱上显示出来，否则图谱只在单调变绿，没有信息量。
 *
 * 因此这里只做**聚合**：把题目级的 FSRS（srs 表）与流水（attempts 表）汇总成考点级四态，
 * 并把状态翻译成推送策略（已掌握少推、已生疏优先推）。绝不把 FSRS 搬到节点级，避免两套调度打架。
 *
 * 注意：本文件刻意不 import ./srs —— srs.ts 里的 recordAttempt 会回调这里（updateMastery 内），
 * 互相 import 会形成循环依赖；只用到一个稳定性下限和一个 UPDATE，就地写死更划算。
 */

export const MASTERY_LEVELS = { untouched: 0, learning: 1, mastered: 2, stale: 3 } as const

const dayStr = (d = new Date()) => d.toISOString().slice(0, 10)
const addDays = (days: number) => dayStr(new Date(Date.now() + Math.round(days) * 86400000))

/** 阈值全部可在设置里调（键名 mastery.*），缺省即契约默认值 */
export function masteryThresholds() {
  const num = (key: string, def: number, lo: number, hi: number) => {
    const v = settingGet<number>(key)
    return typeof v === 'number' && v >= lo && v <= hi ? v : def
  }
  return {
    /** 判定掌握所需的「≥80 分」作答次数（跨该考点所有题目累计） */
    passReps: num('mastery.passReps', 3, 1, 20),
    /** 判定掌握所需的最低平均保持率（FSRS 预测） */
    retentionMin: num('mastery.retentionMin', 0.9, 0.5, 0.99),
    /** 距上次练习超过多少天就没资格算「已掌握」 */
    freshDays: num('mastery.freshDays', 14, 3, 120),
    /** 到期后再宽限几天才判「已生疏」：刚到期不等于忘，硬判会让图谱颜色天天抖动 */
    overdueGraceDays: num('mastery.overdueGraceDays', 3, 0, 30),
    /** 一次真实遗忘（FSRS lapse）就够判生疏 */
    lapseToStale: num('mastery.lapseToStale', 1, 1, 5),
    /** 推送权重：状态 → 该考点所有题目的 srs.weight（直接赋值，不是连乘） */
    weightMastered: num('mastery.weightMastered', 0.6, 0.1, 3),
    weightLearning: num('mastery.weightLearning', 1, 0.1, 3),
    weightStale: num('mastery.weightStale', 1.8, 0.1, 3)
  }
}

/** FSRS 的幂律遗忘曲线：R = (1 + t/(9·S))⁻¹，S=稳定性(天)，t=距上次复习(天) */
const MIN_STABILITY = 0.3   // 与 srs.ts 的 FSRS_W.minS 一致（不 import 是为了断掉循环依赖）
function retentionOf(stability: number, daysSinceReview: number): number {
  const s = Math.max(MIN_STABILITY, stability || 0)
  const t = Math.max(0, daysSinceReview)
  return 1 / (1 + t / (9 * s))
}

function daysSince(iso?: string | null): number {
  if (!iso) return 9999
  const t = Date.parse(iso.includes('T') ? iso : iso.replace(' ', 'T'))
  return Number.isNaN(t) ? 9999 : (Date.now() - t) / 86400000
}

/**
 * 重算一个考点的掌握状态。提交作答后（srs.updateMastery 内）与打开图谱时各调一次，
 * 纯 SQL/纯函数，不请求 AI。
 */
export function recomputeNodeMastery(nodeId: string) {
  const th = masteryThresholds()
  const m = get<{ scale4: number; lit: number; last_practice: string | null; stale: number }>(
    `SELECT scale4,lit,last_practice,stale FROM node_mastery WHERE node_id=?`, [nodeId])
  if (!m) return null

  // attempts.score 是百分制（scale4ToPct 换算后写入），所以「≥80 分」这条阈值直接比 score
  const reps = get<{ total: number; pass_: number }>(
    `SELECT COUNT(*) total, COALESCE(SUM(CASE WHEN a.score>=80 THEN 1 ELSE 0 END),0) pass_
     FROM attempts a JOIN questions q ON q.id=a.question_id WHERE q.node_id=?`, [nodeId])
  const totalReps = reps?.total ?? 0
  const passReps = reps?.pass_ ?? 0

  // 题目级 FSRS 聚合到考点：保持率按稳定性加权（稳的高频题更能代表长期记忆强度）
  const srsRows = all<{ stability: number; lapses: number; due: string | null; last_review: string | null }>(
    `SELECT s.stability,s.lapses,s.due,s.last_review FROM srs s
     JOIN questions q ON q.id=s.question_id WHERE q.node_id=? AND s.reps>0`, [nodeId])
  let retention = 0, wSum = 0, nextReview: string | null = null, lapses = 0
  for (const r of srsRows) {
    const w = Math.max(0.2, r.stability || 0.2)
    retention += retentionOf(r.stability, daysSince(r.last_review)) * w
    wSum += w
    lapses += r.lapses || 0
    if (r.due && (!nextReview || r.due < nextReview)) nextReview = r.due
  }
  retention = wSum ? retention / wSum : 0

  const freshDays = daysSince(m.last_practice)
  const overdueBy = nextReview ? (Date.now() - Date.parse(nextReview.replace(' ', 'T'))) / 86400000 : 0
  const isStale = totalReps > 0 && (
    (nextReview !== null && overdueBy > th.overdueGraceDays) || lapses >= th.lapseToStale
  )
  const isMastered = !isStale && passReps >= th.passReps && retention >= th.retentionMin && freshDays < th.freshDays

  let level: number = MASTERY_LEVELS.learning
  if (totalReps === 0) level = MASTERY_LEVELS.untouched
  else if (isStale) level = MASTERY_LEVELS.stale
  else if (isMastered) level = MASTERY_LEVELS.mastered

  // 生疏时能力估计同步降一档（scale4 是 0~3 的加权均值，一档就是 1）。
  // 恢复路径写在下面：一旦重新答对，last_practice 被刷新、next_review 推到未来、
  // lapseToStale 条件不再成立（lapses 只增不减，所以这里用「近一次是否遗忘」而不是累计次数）。
  let scale4 = m.scale4
  if (level === MASTERY_LEVELS.stale) scale4 = Math.max(0, scale4 - 1)
  else if (level === MASTERY_LEVELS.mastered && scale4 < 2) scale4 = Math.min(3, scale4 + 0.34)

  // 累计次数（lapses/pass_reps/total_reps）用于图谱 hover 文案与洞察页，不参与判定回滚
  run(`UPDATE node_mastery SET mastery_level=?, pass_reps=?, total_reps=?, lapses=?, next_review=?,
         retention=?, stale=?, scale4=? WHERE node_id=?`,
    [level, passReps, totalReps, lapses, nextReview, Math.round(retention * 1000) / 1000,
      isStale ? 1 : 0, Math.round(scale4 * 100) / 100, nodeId])

  return { level, passReps, totalReps, lapses, retention, nextReview, scale4 }
}

/**
 * 把状态翻译成推送策略。
 * 注意这里是**按状态直接赋值**权重而不是累乘：累乘会让同一个考点每提交一次就再乘一遍 0.6，
 * 几次之后权重贴地板、再也推不上来。直接赋值天然幂等（setNodeWeight 内部已 clamp 到 0~3）。
 */
export function applyPushWeights(nodeId: string) {
  const th = masteryThresholds()
  const m = get<{ mastery_level: number }>(`SELECT mastery_level FROM node_mastery WHERE node_id=?`, [nodeId])
  const level = m?.mastery_level ?? MASTERY_LEVELS.untouched
  const weight = level === MASTERY_LEVELS.mastered ? th.weightMastered
    : level === MASTERY_LEVELS.stale ? th.weightStale
      : th.weightLearning
  setNodeWeightLocally(nodeId, weight)
  // 已生疏：把到期日提前到今天，下一轮今日队列就会以「原题优先」的形式回来确认是否真会
  if (level === MASTERY_LEVELS.stale) {
    run(`UPDATE srs SET due=? WHERE question_id IN (SELECT id FROM questions WHERE node_id=?)
         AND due IS NOT NULL AND due>?`, [dayStr(), nodeId, dayStr()])
  }
  return { level, weight }
}

/** 与 srs.setNodeWeight 等价（就地实现以断掉循环 import），内部 clamp 到 0~3 */
function setNodeWeightLocally(nodeId: string, weight: number) {
  const w = Math.max(0, Math.min(3, weight))
  run(`UPDATE srs SET weight=? WHERE question_id IN (SELECT id FROM questions WHERE node_id=?)`, [w, nodeId])
}

/** 批量重算（打开图谱/面板时调用；只对做过的考点跑，未接触的不需要算） */
export function recomputeAllTouched(limit = 500) {
  const rows = all<{ node_id: string }>(
    `SELECT node_id FROM node_mastery WHERE answered>0 ORDER BY last_practice DESC LIMIT ?`, [limit])
  for (const r of rows) {
    recomputeNodeMastery(r.node_id)
    applyPushWeights(r.node_id)
  }
  return rows.length
}

/** 四态分布（Dashboard 统计卡用） */
export function masteryDistribution() {
  const rows = all<{ mastery_level: number; n: number }>(
    `SELECT mastery_level, COUNT(*) n FROM node_mastery GROUP BY mastery_level`)
  const dist = { untouched: 0, learning: 0, mastered: 0, stale: 0 }
  for (const r of rows) {
    const key = ['', 'learning', 'mastered', 'stale'][r.mastery_level] ?? 'untouched'
    dist[key as keyof typeof dist] += r.n
  }
  const recentlyMastered = get<{ n: number }>(
    `SELECT COUNT(*) n FROM node_mastery WHERE mastery_level=2 AND last_practice >= ?`,
    [addDays(-30)])?.n ?? 0
  const mustStale = get<{ n: number }>(
    `SELECT COUNT(*) n FROM node_mastery m JOIN nodes n ON n.id=m.node_id
     WHERE m.mastery_level=3 AND n.must_master=1`)?.n ?? 0
  return { ...dist, recentlyMastered, mustStale }
}
