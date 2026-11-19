import { get, run, tx } from '../db'

/**
 * 从零开始：把「学习进度」整块清掉，但绝不动配置与内容缓存。
 *
 * 为什么要有一层服务而不是前端直接 DELETE：
 * 前端只看得见自己页面上的那点状态，真正的进度散在十几张表里（项目草稿、答题记录、
 * 复习排期、掌握度、考试、摸底会话、打卡、XP/徽章/事件流）。漏清一张表，用户看到的就是
 * 「我明明从头开始了，今日到期还是 20 题」——比没有入口更让人困惑。所以清单写在主进程，
 * 界面上的确认框文案也从同一份清单里取，两边不会各说各话。
 *
 * ⚠️ 两张表不能删空、只能归零：
 * srs 与 node_mastery 在 seed 时会给每一道题、每一个考点都预建一行（默认值的空壳）。
 * 删光它们会让「每道题都有排期行」这个不变量失效，各处 LEFT JOIN 出来的东西不一致；
 * 把它们 UPDATE 回默认值，等效于「刚装好 App」的状态，才是真的从头开始。
 *
 * 刻意保留（清掉会伤到人而不是帮他重来）：
 * - settings：AI 端点、路由、主题、每日目标等偏好；清掉等于让人重配一遍 API Key
 * - ai_log / ai_explain：花过钱的调用账本与已生成的讲解缓存，重做一次不该再烧一遍 token
 * - knowledge*：知识体系的正文索引（content/knowledge/*.md 的镜像），不是学习进度
 * - questions / nodes / edges 等派生表：题库缓存，本来就能从 content/ 重建
 */
const PROGRESS_AREAS: { key: string; label: string; detail: string; from: string; where?: string }[] = [
  { key: 'projectDone', label: '项目关卡', detail: '通关状态与阶段进度', from: 'project_progress', where: 'done=1' },
  { key: 'projectDraft', label: '写到一半的关卡', detail: '编辑器里的草稿', from: 'project_progress', where: 'draft_code IS NOT NULL AND draft_code<>\'\'' },
  { key: 'attempts', label: '练习作答', detail: '每一次答题记录与批改', from: 'attempts' },
  // seed 会给每题预建一行空 srs；只有真正复习过（reps/last_review 有值）才算进度
  { key: 'srs', label: '复习排期', detail: '复习过的题与下次到期时间', from: 'srs', where: 'reps>0 OR last_review IS NOT NULL' },
  // 同理：node_mastery 的预建行 answered=0，只有答过或手动解锁过才算进度
  { key: 'mastery', label: '知识点掌握度', detail: '练过的考点与解锁状态', from: 'node_mastery', where: 'answered>0 OR forced_unlock=1' },
  { key: 'exams', label: '考试', detail: '已考与进行中的卷子', from: 'exams' },
  { key: 'placement', label: '入门摸底', detail: '摸底会话与逐题判定', from: 'placement_session' },
  { key: 'checkins', label: '打卡', detail: '每日完成记录', from: 'checkins' },
  { key: 'badges', label: '徽章', detail: '已解锁的徽章墙', from: 'game_badges' }
]

/** 直接 DELETE 的表（顺序按外键依赖：先子后父） */
const CLEAR_TABLES = [
  'game_events',
  'game_badges',
  'exam_questions',
  'exams',
  'placement_turn',
  'placement_session',
  'placement',
  'attempts',
  'checkins',
  'project_progress'
]

/** 归零而不是删空的表：seed 预建了空壳行，删掉会破坏「每题/每考点都有一行」的约定 */
const RESET_SQL = [
  `UPDATE srs SET stability=0, difficulty=0, reps=0, lapses=0, state=0,
     due=NULL, last_review=NULL, avg_score=0, weight=1`,
  `UPDATE node_mastery SET scale4=0, lit=0, needs_work=0, answered=0, correct=0,
     forced_unlock=0, last_practice=NULL`,
  // game_stats 是单行表：不存在就建，存在就归零
  `INSERT INTO game_stats(id, xp, level, streak, best_streak, last_active_day,
     answered_total, perfect_total, chapters_cleared, bosses_beaten, updated_at)
   VALUES(1, 0, 1, 0, 0, NULL, 0, 0, 0, 0, datetime('now','localtime'))
   ON CONFLICT(id) DO UPDATE SET xp=0, level=1, streak=0, best_streak=0, last_active_day=NULL,
     answered_total=0, perfect_total=0, chapters_cleared=0, bosses_beaten=0, updated_at=excluded.updated_at`
]

const countOf = (from: string, where?: string) =>
  (get<{ n: number }>(`SELECT COUNT(*) n FROM ${from}${where ? ' WHERE ' + where : ''}`) ?? { n: 0 }).n

/** 界面上「要清掉什么」的数字来源，同时用于确认框文案与清空后的回显 */
export function progressSummary() {
  const xp = get<{ xp: number; level: number; streak: number }>(
    `SELECT xp, level, streak FROM game_stats WHERE id=1`) ?? { xp: 0, level: 1, streak: 0 }
  const areas = PROGRESS_AREAS.map((a) => ({ key: a.key, label: a.label, detail: a.detail, n: countOf(a.from, a.where) }))
  const total = areas.reduce((s, a) => s + a.n, 0)
  return {
    xp: xp.xp,
    level: xp.level,
    streak: xp.streak,
    total,
    areas,
    /** 有任何一样东西可清才允许点按钮；全新用户点它只会看到「已经是初始状态」 */
    dirty: total > 0 || xp.xp > 0 || xp.streak > 0
  }
}

/**
 * 清空全部学习进度。返回清掉了什么，界面照此回话，不做「大概清空了」的含糊提示。
 * 不清 settings / meta：schema_version 与 API 配置必须留着，否则下次启动会重灌题库、丢端点。
 */
export function resetAllProgress() {
  const before = progressSummary()
  const cleared: { table: string; n: number }[] = []
  tx(() => {
    for (const t of CLEAR_TABLES) {
      const n = (get<{ n: number }>(`SELECT COUNT(*) n FROM ${t}`) ?? { n: 0 }).n
      if (n) {
        run(`DELETE FROM ${t}`)
        cleared.push({ table: t, n })
      }
    }
    for (const sql of RESET_SQL) run(sql)
    // 归零行也记进 cleared，界面才能说清「复习排期 997 条、掌握度 450 条回到起点」
    for (const a of before.areas) {
      if (a.n && (a.key === 'srs' || a.key === 'mastery')) cleared.push({ table: a.key === 'srs' ? 'srs(归零)' : 'node_mastery(归零)', n: a.n })
    }
    if (before.xp || before.streak) cleared.push({ table: 'game_stats(归零)', n: 1 })
  })
  return { ok: true, before, cleared, after: progressSummary() }
}