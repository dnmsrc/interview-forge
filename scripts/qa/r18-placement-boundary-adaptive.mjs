#!/usr/bin/env node
// v18 边界探测摸底验收（纯 Node，不依赖 electron）。
// 两层验证：
//   A. 纯函数状态机 placement-core.mjs：探针通过→climbing、不会→capped、到顶→topped、全收束→结束；
//   B. 与 placement.ts 同源 SQL 的端到端模拟：用真实题库验证「由浅入深选题 + advance 后继爬升 +
//      不会即停 + 不重复出题 + 正常收尾」，临时 sid 全程自清理，不污染真实学习记录。
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  emptyPlacement18, recordAnswer, markTopped, nextPendingModule,
  allSettled, progressOf18, isPass, MODULE_STATE
} from '../../src/shared/placement-core.mjs'

const bad = []
const assert = (cond, msg) => { if (!cond) bad.push(msg); console.log(`  ${cond ? 'OK ' : 'FAIL'} ${msg}`) }

/* ============================ A. 状态机纯函数 ============================ */
console.log('\n— A. 边界探测状态机 —')

// A1. 探针答对 → climbing；再答对保持 climbing；不会 → capped 立即收束
let st = emptyPlacement18(['m1', 'm2'])
st = recordAnswer(st, 'm1', { nodeId: 'm1.a', scale4: 3, isGap: false })
assert(st.modules.m1.state === MODULE_STATE.CLIMBING && st.modules.m1.probed, '探针答对(scale3) → climbing')
st = recordAnswer(st, 'm1', { nodeId: 'm1.b', scale4: 2, isGap: false })
assert(st.modules.m1.state === MODULE_STATE.CLIMBING && st.modules.m1.turns === 2 && st.modules.m1.pass === 2, '爬升中再答对 → 保持 climbing，累计轮次/通过数')
st = recordAnswer(st, 'm1', { nodeId: 'm1.c', scale4: 1, isGap: false })
assert(st.modules.m1.state === MODULE_STATE.CAPPED, '爬升中不会(scale1) → 立即 capped 收束')
assert(st.modules.m1.lastNode === 'm1.c', 'lastNode 记录最近作答节点（爬升沿它找后继）')

// A2. 探针不会（含主动标缺口）→ 直接 capped，不进入爬升
let st2 = emptyPlacement18(['m1'])
st2 = recordAnswer(st2, 'm1', { nodeId: 'm1.a', scale4: 0, isGap: true })
assert(st2.modules.m1.state === MODULE_STATE.CAPPED, '探针主动标缺口 → 直接 capped')
let st2b = emptyPlacement18(['m1'])
st2b = recordAnswer(st2b, 'm1', { nodeId: 'm1.a', scale4: 1, isGap: false })
assert(st2b.modules.m1.state === MODULE_STATE.CAPPED, '探针 scale1（提示后才会）→ 判定不会，capped')

// A3. 到顶收束：climbing 中 markTopped → topped，且 capped 不会被覆盖
let st3 = emptyPlacement18(['m1', 'm2'])
st3 = recordAnswer(st3, 'm1', { nodeId: 'm1.a', scale4: 3, isGap: false })
st3 = markTopped(st3, 'm1')
assert(st3.modules.m1.state === MODULE_STATE.TOPPED, '路径无题可出 → topped 到顶收束')
const capped = recordAnswer(emptyPlacement18(['x']), 'x', { nodeId: 'x.a', scale4: 0, isGap: true })
assert(markTopped(capped, 'x').modules.x.state === MODULE_STATE.CAPPED, 'markTopped 不覆盖已 capped 的模块')

// A4. 调度顺序：先全部 probing，再 climbing；全收束后 nextPendingModule=null、allSettled=true
let st4 = emptyPlacement18(['a', 'b', 'c'])
assert(nextPendingModule(st4).moduleId === 'a' && nextPendingModule(st4).phase === 'probe', '首个待办是第一个模块的探针')
st4 = recordAnswer(st4, 'a', { nodeId: 'a.1', scale4: 3, isGap: false }) // a→climbing
st4 = recordAnswer(st4, 'b', { nodeId: 'b.1', scale4: 0, isGap: true })   // b→capped
const pend = nextPendingModule(st4)
assert(pend.moduleId === 'c' && pend.phase === 'probe', '仍有 probing 模块时优先探针（c），暂不回头爬升 a')
st4 = recordAnswer(st4, 'c', { nodeId: 'c.1', scale4: 0, isGap: true })   // c→capped
const pend2 = nextPendingModule(st4)
assert(pend2.moduleId === 'a' && pend2.phase === 'climb', '探针全部结束后，回到唯一 climbing 的 a 继续爬升')
st4 = markTopped(st4, 'a')
assert(nextPendingModule(st4) === null && allSettled(st4), '所有模块 capped/topped → 无待办、摸底可结束')

// A5. 进度按模块收束计
const p = progressOf18(st4)
assert(p.done === 3 && p.total === 3, `进度=收束模块数/总模块数（${p.done}/${p.total}），分母不是几百个叶子考点`)

// A6. 边界：scale2 算会（能独立说清即可继续），scale1 算不会
assert(isPass(2) === true && isPass(3) === true && isPass(1) === false && isPass(0) === false, '会/不会阈值：scale≥2 为会')

/* ==================== B. 真实题库端到端（同源 SQL 模拟） ==================== */
console.log('\n— B. 真实题库端到端（fe 板块）—')
const db = new DatabaseSync(join(process.cwd(), 'data', 'app.db'))
db.exec(`PRAGMA busy_timeout=8000`)

const STAGE_ORDER = [
  [/html/, 10], [/css/, 20], [/js-datastructure|datastructure/, 28], [/(^|\.)js([.\d]|$)/, 30],
  [/ts/, 40], [/browser/, 50], [/network/, 55], [/vue|react|eco/, 60], [/build/, 70],
  [/perf/, 80], [/electron|uniapp/, 90]
]
const rankOf = (id) => { for (const [re, r] of STAGE_ORDER) if (re.test(id)) return r; return 100 }
const minDiff = (id) => db.prepare(
  `SELECT MIN(difficulty) m FROM questions WHERE node_id=? AND status='active' AND parent_id IS NULL`).get(id)?.m ?? 99
const prereqsOf = (id) => db.prepare(`SELECT from_id FROM edges WHERE to_id=? AND type='advance'`).all(id).map((r) => r.from_id)
const modules = db.prepare(`
  SELECT m.id,m.ord FROM nodes m
  WHERE m.domain='fe' AND m.level=2 AND m.status='active'
    AND EXISTS (SELECT 1 FROM nodes l JOIN questions q ON q.node_id=l.id
      WHERE l.id LIKE m.id||'.%' AND l.status='active' AND q.status='active' AND q.parent_id IS NULL)
  ORDER BY m.ord`).all()
  .map((m) => ({ ...m, rank: rankOf(m.id) }))
  .sort((a, b) => a.rank - b.rank || a.ord - b.ord)
assert(modules.length >= 5, `fe 至少 5 个有题模块（实际 ${modules.length}）`)
const leavesOf = (moduleId) => db.prepare(`
  SELECT l.id,l.ord FROM nodes l
  WHERE l.id LIKE ? AND l.level=4 AND l.status='active'
    AND EXISTS (SELECT 1 FROM questions q WHERE q.node_id=l.id AND q.status='active' AND q.parent_id IS NULL)
  ORDER BY l.ord`).all(`${moduleId}.%`)
const pickQuestion = (nodeId, used) => {
  const row = db.prepare(`SELECT id,difficulty FROM questions WHERE node_id=? AND status='active' AND parent_id IS NULL
    ORDER BY difficulty ASC, RANDOM()`).all(nodeId).find((r) => !used.has(r.id))
  return row ? { id: row.id, difficulty: row.difficulty } : null
}
const pickProbe = (moduleId, used, visited) => {
  const ranked = leavesOf(moduleId)
    .map((l) => ({ id: l.id, gates: prereqsOf(l.id).length, minDiff: minDiff(l.id), ord: l.ord }))
    .sort((a, b) => a.gates - b.gates || a.minDiff - b.minDiff || a.ord - b.ord)
  for (const c of ranked) { if (visited.has(c.id)) continue; const q = pickQuestion(c.id, used); if (q) return { q, node: c.id } }
  for (const c of ranked) { const q = pickQuestion(c.id, used); if (q) return { q, node: c.id } }
  return null
}
const pickClimb = (moduleId, fromNode, used, visited) => {
  if (fromNode) { const h = pickQuestion(fromNode, used); if (h) return { q: h, node: fromNode } }
  if (fromNode) {
    const succ = db.prepare(`SELECT n.id,n.ord FROM edges e JOIN nodes n ON n.id=e.to_id
      WHERE e.from_id=? AND e.type='advance' AND n.id LIKE ? AND n.level=4 AND n.status='active'
        AND EXISTS (SELECT 1 FROM questions q WHERE q.node_id=n.id AND q.status='active' AND q.parent_id IS NULL)`)
      .all(fromNode, `${moduleId}.%`)
      .map((l) => ({ id: l.id, minDiff: minDiff(l.id), ord: l.ord }))
      .sort((a, b) => a.minDiff - b.minDiff || a.ord - b.ord)
    for (const c of succ) { if (visited.has(c.id)) continue; const q = pickQuestion(c.id, used); if (q) return { q, node: c.id } }
    for (const c of succ) { const q = pickQuestion(c.id, used); if (q) return { q, node: c.id } }
  }
  for (const l of leavesOf(moduleId)) { if (visited.has(l.id)) continue; const q = pickQuestion(l.id, used); if (q) return { q, node: l.id } }
  return null
}

const sid = 'qa18-' + randomUUID().slice(0, 8)
const nowStr = () => new Date().toISOString().slice(0, 19).replace('T', ' ')
const turnRows = []
const insertTurn = (nodeId, qid, scale4, gapType) => {
  turnRows.push(nodeId)
  db.prepare(`INSERT INTO placement_turn(session_id,node_id,question_id,scale4,pct,verdict,gap_type,gap_note,grading_kind,answer,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(sid, nodeId, qid, scale4, scale4 * 30, 'qa18', gapType, null, gapType ? 'self' : 'auto', null, nowStr())
}

// 场景：模拟一个「中等偏强」用户——每个模块探针都答对，爬升 2 题后第 3 题不会（ capped），
// 验证：探针全覆盖、答对确实触发爬升（与 R17 跳过相反）、不会即停、题不重复、最终全收束。
let state = emptyPlacement18(modules.map((m) => m.id))
const used = new Set(), visited = new Set()
let turns = 0
const climbSeq = [3, 2, 1] // 爬升：对、对、错
const SAFETY = 60
let guard = 0
while (!allSettled(state) && turns < SAFETY && guard++ < 200) {
  const pendM = nextPendingModule(state)
  if (!pendM) break
  const mod = pendM.moduleId
  const fromNode = state.modules[mod]?.lastNode ?? null
  const picked = pendM.phase === 'probe'
    ? pickProbe(mod, used, visited)
    : pickClimb(mod, fromNode, used, visited)
  if (!picked) { state = markTopped(state, mod); continue }
  assert(!used.has(picked.q.id), '不重复出同一道题')
  used.add(picked.q.id); visited.add(picked.node)
  // 造成绩：探针=3（会）；爬升按序列，用完后默认不会以收束
  const modState = state.modules[mod]
  const scale4 = modState.state === MODULE_STATE.PROBING ? 3 : (climbSeq[Math.min(modState.turns - 1, climbSeq.length - 1)])
  const isGap = false
  insertTurn(picked.node, picked.q.id, scale4, null)
  state = recordAnswer(state, mod, { nodeId: picked.node, scale4, isGap })
  turns++
}
const touchedModules = new Set(turnRows.map((n) => n.split('.').slice(0, 2).join('.')))
assert(touchedModules.size === modules.length, `每个模块都被探针采样（${touchedModules.size}/${modules.length}）`)
assert(allSettled(state), '摸底靠「所有模块到边界」正常收束，而非安全顶')
assert(turns >= modules.length && turns < SAFETY, `总题量动态且远低于安全顶：${turns} 题（模块 ${modules.length} 个 + 爬升）`)
// 答对的模块都进入过 climbing（核心反转：R17 是答对就跳过）
const climbed = modules.filter((m) => state.modules[m.id].turns >= 2).map((m) => m.id)
assert(climbed.length === modules.length, `所有探针答对的模块都继续爬升加难（${climbed.length} 个），而非答对即跳过`)
// 每轮落库
const persisted = db.prepare(`SELECT COUNT(*) n FROM placement_turn WHERE session_id=?`).get(sid).n
assert(persisted === turns, `每轮判定落库（${persisted}/${turns}）`)

// 弱用户场景：所有探针都不会 → 题量≈模块数，很快收束（不会被拉去做进阶题）
const sid2 = 'qa18w-' + randomUUID().slice(0, 8)
let wstate = emptyPlacement18(modules.map((m) => m.id))
const wused = new Set(), wvisited = new Set()
let wturns = 0, wguard = 0
while (!allSettled(wstate) && wguard++ < 100) {
  const pendM = nextPendingModule(wstate)
  if (!pendM) break
  const picked = pickProbe(pendM.moduleId, wused, wvisited)
  if (!picked) { wstate = markTopped(wstate, pendM.moduleId); continue }
  wused.add(picked.q.id); wvisited.add(picked.node)
  db.prepare(`INSERT INTO placement_turn(session_id,node_id,question_id,scale4,pct,verdict,gap_type,gap_note,grading_kind,answer,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(sid2, picked.node, picked.q.id, 0, 0, 'qa18w', 'concept', null, 'self', null, nowStr())
  wstate = recordAnswer(wstate, pendM.moduleId, { nodeId: picked.node, scale4: 0, isGap: true })
  wturns++
}
assert(wturns === modules.length, `弱用户每模块探针不会即停，题量≈模块数（${wturns}=${modules.length}），不被进阶题纠缠`)
assert(allSettled(wstate) && Object.values(wstate.modules).every((m) => m.state === 'capped'), '弱用户所有模块均 capped 收束')

// 清理
db.prepare(`DELETE FROM placement_turn WHERE session_id IN (?,?)`).run(sid, sid2)
const left = db.prepare(`SELECT COUNT(*) n FROM placement_turn WHERE session_id IN (?,?)`).get(sid, sid2).n
assert(left === 0, 'QA18 临时数据已清理，不污染真实记录')
db.close()

console.log(bad.length ? `\n❌ ${bad.length} 项失败` : '\n✅ v18 边界探测摸底全部断言通过')
process.exit(bad.length ? 1 : 0)
