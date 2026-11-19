#!/usr/bin/env node
// R17 分阶段广度自适应摸底验收（纯 Node，不依赖 electron）。
// 工程的服务层是 TS 且依赖 electron 的 db 单例，纯 Node 无法直接 import，
// 这里用与 src/main/services/placement.ts 完全同源的 SQL + 调度规则做端到端断言，核心验证：
//   ① 广度扫盲：每个「有题」的 L2 模块都能被探针采样到（旧版单链只覆盖 22%、前期全是 HTML/CSS）；
//   ② 自适应加深：探针薄弱(scale4<=1/gap)的模块拿到 3 配额、中等(=2)拿 1、掌握(>=3)拿 0；
//   ③ 加深优先下探本模块未掌握前置，其次未访问叶子，且不会重复出同一道题；
//   ④ 全部模块扫盲 + 加深配额耗尽后正常收尾，题量落在合理区间；
//   ⑤ 临时 session 全程自清理，不污染真实学习记录。
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const db = new DatabaseSync(join(process.cwd(), 'data', 'app.db'))
db.exec(`PRAGMA busy_timeout=8000`)
const bad = []
const assert = (cond, msg) => { if (!cond) bad.push(msg); console.log(`  ${cond ? 'OK ' : 'FAIL'} ${msg}`) }

const domain = 'fe'
const sid = 'qa17-' + randomUUID().slice(0, 8)
const nowStr = () => new Date().toISOString().slice(0, 19).replace('T', ' ')

// ---- 复刻 STAGE_ORDER 学习阶段排序（与 placement.ts 保持一致）----
const STAGE_ORDER = [
  [/html/, 10], [/css/, 20], [/js-datastructure|datastructure/, 28], [/(^|\.)js([.\d]|$)/, 30],
  [/ts/, 40], [/browser/, 50], [/network/, 55], [/vue|react|eco/, 60], [/build/, 70],
  [/perf/, 80], [/electron|uniapp/, 90]
]
const rankOf = (id) => { for (const [re, r] of STAGE_ORDER) if (re.test(id)) return r; return 100 }
const prereqsOf = (id) => db.prepare(`SELECT from_id FROM edges WHERE to_id=? AND type='prereq'`).all(id).map((r) => r.from_id)
const isLit = (id) => (db.prepare(`SELECT COALESCE(lit,0) lit FROM node_mastery WHERE node_id=?`).get(id)?.lit ?? 0) === 1
const minDiff = (id) => db.prepare(
  `SELECT MIN(difficulty) m FROM questions WHERE node_id=? AND status='active' AND parent_id IS NULL`).get(id)?.m ?? 99

// ---- 有题的 L2 模块（activeModules 同源 SQL）----
const modules = db.prepare(`
  SELECT m.id,m.title,m.ord FROM nodes m
  WHERE m.domain=? AND m.level=2 AND m.status='active'
    AND EXISTS (SELECT 1 FROM nodes l JOIN questions q ON q.node_id=l.id
      WHERE l.id LIKE m.id||'.%' AND l.status='active' AND q.status='active' AND q.parent_id IS NULL)
  ORDER BY m.ord`).all(domain)
  .map((m) => ({ ...m, rank: rankOf(m.id) }))
  .sort((a, b) => a.rank - b.rank || a.ord - b.ord)
assert(modules.length >= 5, `前端至少 5 个有题模块参与扫盲（实际 ${modules.length} 个：${modules.map((m) => m.id).join(', ')}）`)

// 学习顺序合理性：html 必须早于 js，js 早于 vue
const idxHtml = modules.findIndex((m) => m.id === 'fe.html')
const idxJs = modules.findIndex((m) => m.id === 'fe.js')
const idxVue = modules.findIndex((m) => m.id === 'fe.vue')
assert(idxHtml >= 0 && idxJs >= 0 && idxVue >= 0 && idxHtml < idxJs && idxJs < idxVue,
  `模块按学习阶段排序（html#${idxHtml} < js#${idxJs} < vue#${idxVue}），而非 seed 的 ord`)

const leavesOf = (moduleId) => db.prepare(`
  SELECT l.id,l.ord FROM nodes l
  WHERE l.id LIKE ? AND l.level=4 AND l.status='active'
    AND EXISTS (SELECT 1 FROM questions q WHERE q.node_id=l.id AND q.status='active' AND q.parent_id IS NULL)
  ORDER BY l.ord`).all(`${moduleId}.%`)
const pickQuestion = (nodeId, used) => {
  const row = db.prepare(`SELECT id FROM questions WHERE node_id=? AND status='active' AND parent_id IS NULL
    ORDER BY difficulty ASC, RANDOM()`).all(nodeId).find((r) => !used.has(r.id))
  return row?.id ?? null
}
const pickProbe = (moduleId, used, visited) => {
  const ranked = leavesOf(moduleId)
    .map((l) => ({ id: l.id, gates: prereqsOf(l.id).length, minDiff: minDiff(l.id), ord: l.ord }))
    .sort((a, b) => a.gates - b.gates || a.minDiff - b.minDiff || a.ord - b.ord)
  for (const c of ranked) { if (visited.has(c.id)) continue; const q = pickQuestion(c.id, used); if (q) return { q, node: c.id } }
  for (const c of ranked) { const q = pickQuestion(c.id, used); if (q) return { q, node: c.id } }
  return null
}
const pickDeepen = (moduleId, used, visited) => {
  const moduleVisited = [...visited].filter((id) => id.startsWith(`${moduleId}.`))
  for (const vid of moduleVisited) {
    const weakPre = prereqsOf(vid).filter((p) => p.startsWith(`${moduleId}.`) && !visited.has(p) && !isLit(p))
    for (const p of weakPre) { const q = pickQuestion(p, used); if (q) return { q, node: p } }
  }
  for (const l of leavesOf(moduleId)) { if (visited.has(l.id)) continue; const q = pickQuestion(l.id, used); if (q) return { q, node: l.id } }
  for (const l of leavesOf(moduleId)) { const q = pickQuestion(l.id, used); if (q) return { q, node: l.id } }
  return null
}
const quotaFor = (scale4, isGap) => (isGap || scale4 <= 1 ? 3 : scale4 === 2 ? 1 : 0)

// ---- 建临时会话（仅向真实 placement_turn 写入带独立 sid 的行，结束按 sid 清理，不建额外表）----
const turnRows = []
const insertTurn = (nodeId, qid, scale4, gapType) => {
  turnRows.push({ nodeId, qid, scale4, gapType })
  db.prepare(`INSERT INTO placement_turn(session_id,node_id,question_id,scale4,pct,verdict,gap_type,gap_note,grading_kind,answer,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(sid, nodeId, qid, scale4, scale4 * 30, 'qa17', gapType, null, gapType ? 'self' : 'auto', null, nowStr())
}

// ---- 模拟完整一轮摸底：探针按模块顺序，探针成绩用确定性脚本制造强弱差异 ----
const used = new Set()
const visited = new Set()
const probed = {}
const quota = {}
const used2 = {}
const probeTrace = []
let cursor = 0
let turns = 0
const MAX_TURNS = 40

// 确定性探针成绩：按模块下标循环制造 掌握/中等/薄弱/gap 四种情况，验证配额分流
const probeScale = (i) => [3, 2, 1, 0][i % 4]
const probeGap = (i) => (i % 4 === 3 ? 'concept' : null)

// 阶段①：逐模块探针
while (cursor < modules.length && turns < MAX_TURNS) {
  const mod = modules[cursor]
  const picked = pickProbe(mod.id, used, visited)
  assert(!!picked, `模块 ${mod.id} 探针能出到题`)
  if (!picked) { cursor++; probed[mod.id] = true; continue }
  used.add(picked.q); visited.add(picked.node)
  const sc = probeScale(cursor); const gap = probeGap(cursor)
  insertTurn(picked.node, picked.q, sc, gap)
  probeTrace.push({ module: mod.id, node: picked.node, scale4: sc, gap })
  probed[mod.id] = true
  quota[mod.id] = quotaFor(sc, !!gap)
  used2[mod.id] = 0
  cursor++; turns++
}
assert(probeTrace.length === modules.length, `广度扫盲覆盖全部 ${modules.length} 个有题模块（旧版 15 题单链做不到）`)
const touchedModules = new Set(probeTrace.map((t) => t.module))
assert(touchedModules.size === modules.length, '每个模块至少被 1 道探针题采样，无模块漏测')
// 前期不再被 HTML/CSS 垄断：前 3 个探针应分属不同模块
const firstThree = new Set(probeTrace.slice(0, 3).map((t) => t.module))
assert(firstThree.size === 3, `前三题分属 3 个不同模块（${[...firstThree].join(' / ')}），不再全是 HTML/CSS`)

// 配额分流断言
const qStrong = quota[probeTrace.find((t) => t.scale4 === 3).module]
const qMid = quota[probeTrace.find((t) => t.scale4 === 2).module]
const qWeak = quota[probeTrace.find((t) => t.scale4 === 1).module]
const qGap = quota[probeTrace.find((t) => t.gap === 'concept').module]
assert(qStrong === 0 && qMid === 1 && qWeak === 3 && qGap === 3,
  `配额按准确率分流（掌握=${qStrong} 中等=${qMid} 薄弱=${qWeak} 缺口=${qGap}）`)

// 阶段②：按模块顺序消费加深配额
const deepenTrace = []
for (const mod of modules) {
  while ((used2[mod.id] ?? 0) < (quota[mod.id] ?? 0) && turns < MAX_TURNS) {
    const picked = pickDeepen(mod.id, used, visited)
    if (!picked) { quota[mod.id] = used2[mod.id]; break }
    assert(!used.has(picked.q), '加深题不与已出题重复')
    used.add(picked.q); visited.add(picked.node)
    insertTurn(picked.node, picked.q, 2, null)   // 加深轮按答对处理
    used2[mod.id] = (used2[mod.id] ?? 0) + 1
    deepenTrace.push({ module: mod.id, node: picked.node })
    turns++
  }
}
const deepenedModules = new Set(deepenTrace.map((t) => t.module))
const weakModules = modules.filter((m, i) => probeScale(i) <= 1).map((m) => m.id)
assert(weakModules.every((m) => deepenedModules.has(m)), '所有薄弱/缺口模块都进入了加深阶段')
const strongModules = modules.filter((m, i) => probeScale(i) === 3).map((m) => m.id)
assert(strongModules.every((m) => !deepenedModules.has(m)), '已掌握模块配额为 0、被跳过不出冗余题')

// ---- 终止：再要题应无题可出（扫盲完 + 配额耗尽）----
let anyLeft = false
for (const mod of modules) if ((used2[mod.id] ?? 0) < (quota[mod.id] ?? 0)) anyLeft = true
assert(!anyLeft, '所有模块加深配额消费完毕，调度器进入 done，摸底可正常收尾')
assert(turns >= modules.length && turns <= MAX_TURNS,
  `总题量合理：${turns} 题（模块数 ${modules.length} ≤ 题量 ≤ 上限 ${MAX_TURNS}），动态随薄弱程度变化`)

// 每轮都落库
const persisted = db.prepare(`SELECT COUNT(*) n FROM placement_turn WHERE session_id=?`).get(sid).n
assert(persisted === turns, `每轮判定落库（${persisted}/${turns}）`)

// ---- 清理 ----
db.prepare(`DELETE FROM placement_turn WHERE session_id=?`).run(sid)
const left = db.prepare(`SELECT COUNT(*) n FROM placement_turn WHERE session_id=?`).get(sid).n
assert(left === 0, 'QA17 临时数据已清理，不污染真实记录')
db.close()

console.log(bad.length ? `\n❌ ${bad.length} 项失败` : '\n✅ R17 分阶段广度自适应摸底全部断言通过')
process.exit(bad.length ? 1 : 0)
