import { randomUUID } from 'node:crypto'
import { all, get, run, settingGet, settingSet } from '../db'
import { dueQuestionIds, hydrateQuestions, variantIdsOfNode, recordAttempt, todayDueCount, globalMixRatio } from './srs'
import { gradeAnswer, questionOf } from './grading'
import { applyUnlock, loadNodes, mustMasterGap } from './graph'
import type { DailyPlan, DashboardSummary, QuestionRow } from '../../shared/types'

const dayStr = (d = new Date()) => d.toISOString().slice(0, 10)
export const dailyTargetValue = (): number => settingGet<number>('practice.dailyTarget') ?? 20

/** 今日队列：到期复习 + 薄弱点变体 + 适量新题 */
export function buildDailyPlan(): DailyPlan {
  const target = dailyTargetValue()
  const ratio = globalMixRatio()
  const due = hydrateQuestions(dueQuestionIds(Math.ceil(target * 0.6)))
  const picked = new Set(due.map((q) => q.id))

  const weakLit = all<{ id: string }>(`SELECT n.id FROM nodes n JOIN node_mastery m ON m.node_id=n.id
    WHERE n.level=4 AND m.lit=1 ORDER BY m.scale4 ASC, RANDOM() LIMIT 12`)
  const weakVariants: QuestionRow[] = []
  for (const n of weakLit) {
    if (weakVariants.length >= Math.floor(target * ratio)) break
    const ids = variantIdsOfNode(n.id, [...picked], 1)
    for (const id of ids) { if (!picked.has(id)) { picked.add(id); weakVariants.push(...hydrateQuestions([id])) } }
  }
  const rest = Math.max(0, target - due.length - weakVariants.length)
  const freshIds = rest > 0 ? all<{ id: string }>(`SELECT q.id FROM questions q
      JOIN nodes n ON n.id=q.node_id
      LEFT JOIN node_mastery m ON m.node_id=n.id
      WHERE q.status='active' AND q.parent_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.question_id=q.id)
        AND (COALESCE(m.forced_unlock,0)=1 OR n.level<=2 OR NOT EXISTS (
              SELECT 1 FROM edges e JOIN node_mastery pm ON pm.node_id=e.from_id
              WHERE e.to_id=n.id AND e.type='prereq' AND COALESCE(pm.lit,0)=0 AND COALESCE(pm.forced_unlock,0)=0 AND COALESCE(pm.answered,0)>0))
      ORDER BY q.difficulty ASC, RANDOM() LIMIT ?`, [rest]).map((r) => r.id) : []
  const fresh = hydrateQuestions(freshIds.filter((id) => !picked.has(id)))
  return {
    date: dayStr(), due, weakVariants, newQuestions: fresh,
    totalPlanned: due.length + weakVariants.length + fresh.length,
    doneToday: doneToday(), streak: currentStreak(),
    message: due.length > target * 2 ? `到期复习已积压 ${due.length} 题，建议今天先清复习再做新题。` : undefined
  }
}

export function doneToday(): number {
  return get<{ n: number }>(`SELECT COUNT(DISTINCT question_id) n FROM attempts WHERE date(created_at)=date('now','localtime')`)?.n ?? 0
}
export function markCheckin(done: boolean) {
  run(`INSERT INTO checkins(day,done) VALUES(?,?) ON CONFLICT(day) DO UPDATE SET done=excluded.done`, [dayStr(), done ? 1 : 0])
}
export function currentStreak(): number {
  let streak = 0
  for (let i = 0; i < 400; i++) {
    const d = dayStr(new Date(Date.now() - i * 86400000))
    const hit = get<{ done: number }>(`SELECT done FROM checkins WHERE day=? AND done=1`, [d])
    if (hit) streak++
    else if (i === 0) continue          // 今天还没做不算断
    else break
  }
  return streak
}

// ---------------- 摸底测试（分板块小摸底，自适应上下探） ----------------

interface PlacementSession { domain: string; asked: { qid: string; scale4: number }[]; level: number; finished: boolean }
const sessions = new Map<string, PlacementSession>()

export function startPlacement(domain: string): { sessionId: string; item: QuestionRow | null; hint: string } {
  const id = randomUUID().slice(0, 8)
  sessions.set(id, { domain, asked: [], level: 2.5, finished: false })
  return { sessionId: id, ...nextPlacementItem(id) }
}
export function nextPlacementItem(sessionId: string): { item: QuestionRow | null; hint: string } {
  const s = sessions.get(sessionId)
  if (!s || s.finished) return { item: null, hint: '本轮摸底已结束' }
  const round = s.asked.length
  if (round >= 8) { finishPlacement(sessionId); return { item: null, hint: '题量足够，本轮摸底已结束' } }
  s.level = Math.max(1, Math.min(4.6, s.level))
  const lo = Math.max(1, Math.floor(s.level)), hi = Math.min(5, Math.ceil(s.level))
  const used = s.asked.map((a) => a.qid)
  const row = all<{ id: string }>(`SELECT q.id FROM questions q WHERE q.status='active' AND q.parent_id IS NULL
      AND substr(q.node_id,1,instr(q.node_id,'.')-1)=? AND q.difficulty BETWEEN ? AND ?
      AND q.id NOT IN (${used.length ? used.map(() => '?').join(',') : "''"}) 
      ORDER BY RANDOM() LIMIT 1`, [s.domain, lo, hi, ...used])[0]
  if (!row) { finishPlacement(sessionId); return { item: null, hint: '该板块题库不足，摸底提前结束' } }
  const [item] = hydrateQuestions([row.id])
  return { item: item ?? null, hint: `摸底进度 ${round}/8（当前难度约 ${s.level.toFixed(1)}）` }
}
export async function submitPlacement(sessionId: string, qid: string, answer: unknown) {
  const s = sessions.get(sessionId)
  if (!s) throw new Error('摸底会话已过期')
  const q = questionOf(qid)
  if (!q) throw new Error('题目不存在')
  let scale4 = 0
  try { scale4 = (await gradeAnswer(q, { qid, answer, mode: 'placement' })).scale4 } catch { scale4 = 0 }
  s.asked.push({ qid, scale4 })
  recordAttempt({ qid, mode: 'placement', answer, scale4, gradingKind: 'auto' })
  s.level = Math.max(1, Math.min(4.6, s.level + (scale4 >= 3 ? 0.9 : scale4 >= 2 ? 0.35 : scale4 >= 1 ? -0.4 : -1.1)))
  if (s.asked.length >= 8) { s.finished = true; finishPlacement(sessionId) }
  return { scale4, nextLevel: Number(s.level.toFixed(1)), finished: s.finished }
}
function finishPlacement(sessionId: string) {
  const s = sessions.get(sessionId)
  if (!s || !s.asked.length) return
  const avg = s.asked.reduce((a, b) => a + b.scale4, 0) / s.asked.length
  const pct = Math.round((avg / 3) * 100)
  run(`INSERT INTO placement(domain,scale4,pct,detail,created_at) VALUES(?,?,?,?,datetime('now','localtime'))`,
    [s.domain, avg, pct, JSON.stringify(s.asked)])
  const nodes = applyUnlock(loadNodes(s.domain)).filter((n) => n.level >= 3)
  const starts = nodes.filter((n) => (n.level === 3 || n.level === 4) && !n.lit && !n.locked).slice(0, 10)
    .map((n) => ({ id: n.id, title: n.title, level: n.level }))
  s.finished = true
  settingSet(`placement.last.${s.domain}`, { pct, scale4: avg, starts, at: new Date().toISOString() })
}
export function placementResults() {
  return all<any>(`SELECT domain,scale4,pct,created_at,detail FROM placement ORDER BY created_at DESC`).reduce((acc: any, r) => {
    if (!acc[r.domain]) acc[r.domain] = { domain: r.domain, pct: r.pct, scale4: r.scale4, at: r.created_at, starts: settingGet<any>(`placement.last.${r.domain}`)?.starts ?? [] }
    return acc
  }, {})
}
export function placementHistory(limit = 30) {
  return all(`SELECT id,domain,scale4,pct,created_at FROM placement ORDER BY id DESC LIMIT ?`, [limit])
}

// ---------------- 数据面板 ----------------

export function dashboardSummary(): DashboardSummary {
  const totals = {
    questions: get<{ n: number }>(`SELECT COUNT(*) n FROM questions WHERE status='active'`)?.n ?? 0,
    nodes: get<{ n: number }>(`SELECT COUNT(*) n FROM nodes WHERE level=4`)?.n ?? 0,
    litNodes: get<{ n: number }>(`SELECT COUNT(*) n FROM node_mastery WHERE lit=1`)?.n ?? 0,
    ...mustMasterGap()
  }
  const domainTitles: Record<string, string> = { fe: '前端', be: '后端', cs: '公共基础', ai: 'AI Agent', eng: '工程难题' }
  const mastery = Object.keys(domainTitles).map((domain) => {
    const row = get<{ total: number; lit: number; avg: number }>(`SELECT COUNT(*) total,
        COALESCE(SUM(CASE WHEN COALESCE(m.lit,0)=1 THEN 1 ELSE 0 END),0) lit,
        COALESCE(AVG(COALESCE(m.scale4,0)),0) avg
      FROM nodes n LEFT JOIN node_mastery m ON m.node_id=n.id WHERE n.level=4 AND n.domain=?`, [domain]) ?? { total: 0, lit: 0, avg: 0 }
    return { domain, title: domainTitles[domain], lit: row.lit, total: row.total, avgScale4: Number((row.avg ?? 0).toFixed(2)) }
  })
  const accuracyTrend = all<{ day: string; answered: number; avgPct: number }>(`SELECT date(created_at) day,
      COUNT(DISTINCT question_id) answered, ROUND(AVG(score),1) avgPct
    FROM attempts WHERE created_at>=datetime('now','localtime','-30 day') GROUP BY day ORDER BY day`)
  const typeStats = all<{ type: string; answered: number; avgPct: number }>(`SELECT COALESCE(json_extract(q.data,'$.type'),'未知') type,
      COUNT(*) answered, ROUND(AVG(a.score),1) avgPct
    FROM attempts a JOIN questions q ON q.id=a.question_id GROUP BY type ORDER BY answered DESC`)
  const topWrong = all<{ qid: string; stem: string; nodeTitle: string; times: number; avgPct: number }>(`
    SELECT t.qid, SUBSTR(json_extract(q.data,'$.stem'),1,70) stem, n.title nodeTitle, t.times, t.avgPct FROM (
      SELECT question_id qid, COUNT(*) times, AVG(score) avgPct FROM attempts GROUP BY question_id HAVING times>=2
    ) t JOIN questions q ON q.id=t.qid LEFT JOIN nodes n ON n.id=q.node_id
    WHERE t.avgPct<60 ORDER BY t.avgPct ASC, t.times DESC LIMIT 12`)
  const aiUsage = all<{ task: string; calls: number; tokens: number; ms: number }>(`SELECT task, COUNT(*) calls,
      COALESCE(SUM(in_tokens+out_tokens),0) tokens, COALESCE(SUM(ms),0) ms
    FROM ai_log WHERE ts>=datetime('now','localtime','-7 day') GROUP BY task ORDER BY calls DESC`)
  const examHistoryRows = all<any>(`SELECT id,title,total,pass_line,submitted_at FROM exams WHERE status='done'
    ORDER BY submitted_at DESC LIMIT 10`).map((e) => ({ id: e.id, title: e.title, total: e.total ?? 0, pass: (e.total ?? 0) >= (e.pass_line ?? 60), submitted_at: e.submitted_at }))
  const recentAvg = get<{ a: number }>(`SELECT AVG(score) a FROM attempts WHERE created_at>=datetime('now','localtime','-14 day')`)?.a
  const litRatio = totals.nodes ? totals.litNodes / totals.nodes : 0
  const base = Math.round(((recentAvg ?? 0) * 0.55 + litRatio * 100 * 0.45))
  return {
    totals: { ...totals, mustMaster: totals.total ?? 0, mustMasterLit: totals.lit ?? 0 },
    mastery, accuracyTrend, typeStats, topWrong, aiUsage, examHistory: examHistoryRows,
    streak: currentStreak(), dueNow: todayDueCount(),
    interviewBand: {
      low: Math.max(0, base - 10), high: Math.min(100, base + 12),
      note: `按最近两周正确率（${Math.round(recentAvg ?? 0)}%）与图谱点亮率（${Math.round(litRatio * 100)}%）综合估算`
    }
  }
}

export function wrongNoteList(limit = 60, domain?: string) {
  const dom = domain ? `AND substr(q.node_id,1,instr(q.node_id,'.')-1)=?` : ''
  return all<any>(`SELECT q.id,q.type,q.data,q.node_id,n.title nodeTitle,
      COUNT(a.id) times, MIN(a.score) worst, AVG(a.score) avgScore, MAX(a.created_at) lastAt
    FROM attempts a JOIN questions q ON q.id=a.question_id LEFT JOIN nodes n ON n.id=q.node_id
    WHERE a.scale4<2 ${dom}
    GROUP BY q.id HAVING worst<=55 ORDER BY avgScore ASC, times DESC LIMIT ?`,
    domain ? [domain, limit] : [limit])
    .map((r) => ({ ...r, q: safeJson(r.data), stem: String(safeJson(r.data)?.stem ?? '').slice(0, 160) }))
}
const safeJson = (s: string) => { try { return JSON.parse(s) } catch { return {} } }

export function exportWeeklyMarkdown(): string {
  const d = dashboardSummary()
  const lines = [`# 面试熔炉周报 · ${dayStr()}`, '']
  lines.push(`- 连续打卡：**${d.streak} 天**｜今日到期复习：${d.dueNow} 题`,
    `- 图谱点亮：${d.totals.litNodes}/${d.totals.nodes} 个考点｜强制基础缺口：${d.totals.mustMaster - d.totals.mustMasterLit}`,
    `- 面试预估区间：**${d.interviewBand.low}–${d.interviewBand.high} 分**（${d.interviewBand.note}）`, '', '## 板块掌握度', '| 板块 | 点亮/总数 | 平均档 |', '|---|---|---|')
  for (const m of d.mastery) lines.push(`| ${m.title} | ${m.lit}/${m.total} | ${m.avgScale4}/3 |`)
  lines.push('', '## 最该补的题', '```')
  for (const w of d.topWrong.slice(0, 8)) lines.push(`- [${w.nodeTitle}] ${w.stem}（做过 ${w.times} 次，均分 ${Math.round(w.avgPct)}）`)
  lines.push('```', '', '## AI 用量（近 7 天）', '```')
  for (const u of d.aiUsage) lines.push(`${u.task.padEnd(22)} ${String(u.calls).padStart(4)} 次  ${String(u.tokens).padStart(9)} tokens  ${(u.ms / 1000).toFixed(0)}s`)
  lines.push('```')
  return lines.join('\n')
}
