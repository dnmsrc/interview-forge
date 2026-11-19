#!/usr/bin/env node
/**
 * R19 先学后测验收（纯 Node，不依赖 electron），对真实题库 data/app.db 验证：
 *   A. 数据层：learnFirst=true 的题已正确灌进 data JSON，且都带 resources 学习材料；
 *   B. 选题层：同一节点存在闭卷题时，摸底 pickQuestion 逻辑（闭卷优先 SQL/筛选）绝不先出先学题；
 *      闭卷题全部「用过」后，才回落到先学题（前端据此先给材料）；
 *   C. 状态机：guess（蒙题，scale4=0）与不会等价，触发模块 capped 收束（复用 placement-core 纯函数）。
 * 全程只读 + 临时内存模拟，不写真实学习记录。
 */
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { emptyPlacement18, recordAnswer, MODULE_STATE } from '../../src/shared/placement-core.mjs'

const bad = []
const assert = (cond, msg) => { if (!cond) bad.push(msg); console.log(`  ${cond ? 'OK ' : 'FAIL'} ${msg}`) }

const db = new DatabaseSync(join(process.cwd(), 'data', 'app.db'))
db.exec(`PRAGMA busy_timeout=8000`)

console.log('\n— A. 数据层：learnFirst 标记与先学材料 —')
const learnRows = db.prepare(
  `SELECT id,node_id,data FROM questions WHERE status='active' AND COALESCE(json_extract(data,'$.learnFirst'),0)=1`
).all()
assert(learnRows.length >= 9, `库里至少 9 道 learnFirst 先学题（实际 ${learnRows.length}）`)
let withMat = 0
for (const r of learnRows) {
  const q = JSON.parse(r.data)
  if (Array.isArray(q.resources) && q.resources.some((x) => x.digest && String(x.digest).length > 30)) withMat++
}
assert(withMat === learnRows.length, `每道先学题都带可学的 resources 摘要（${withMat}/${learnRows.length}）`)

// 对照组：绝大多数题仍是闭卷题（learnFirst 未标）
const total = db.prepare(`SELECT COUNT(*) n FROM questions WHERE status='active' AND parent_id IS NULL`).get().n
assert(learnRows.length / total < 0.03, `先学题占比极低（${learnRows.length}/${total}），摸底不会被开卷化`)

console.log('\n— B. 选题层：闭卷优先、先学兜底（复刻 placement.ts pickQuestion 两段式）—')
const isLearnFirst = (data) => { try { return JSON.parse(data).learnFirst === true } catch { return false } }
function pickQuestion(nodeId, used, preferClosedBook = true) {
  const rows = db.prepare(
    `SELECT id,data FROM questions WHERE node_id=? AND status='active' AND parent_id IS NULL
     ORDER BY difficulty ASC, RANDOM()`).all(nodeId)
  const find = (onlyClosed) => rows.find((r) => !used.has(r.id) && (!onlyClosed || !isLearnFirst(r.data)))
  const pick = (preferClosedBook ? find(true) : undefined) ?? find(false)
  return pick ? { id: pick.id, learnFirst: isLearnFirst(pick.data) } : null
}

// B1. vLLM 所在节点：同时含先学题(0001)与闭卷题，首次选题必须是闭卷题
const kvNode = 'ai.serving.infer-serving.kv-cache-batching'
const kvLearn = db.prepare(`SELECT id FROM questions WHERE node_id=? AND COALESCE(json_extract(data,'$.learnFirst'),0)=1`).all(kvNode).map((r) => r.id)
const kvClosed = db.prepare(`SELECT id FROM questions WHERE node_id=? AND COALESCE(json_extract(data,'$.learnFirst'),0)<>1 AND parent_id IS NULL`).all(kvNode).map((r) => r.id)
assert(kvLearn.length >= 1 && kvClosed.length >= 1, `kv 节点同时含先学题(${kvLearn.length})与闭卷题(${kvClosed.length})`)
const first = pickQuestion(kvNode, new Set())
assert(first && !first.learnFirst, `节点首题选闭卷题而非 vLLM 先学题（选中 ${first?.id}）`)

// B2. 闭卷题全部用过后，才回落到先学题（此时前端会先给材料）
const usedAllClosed = new Set(kvClosed)
const fallback = pickQuestion(kvNode, usedAllClosed)
assert(fallback && fallback.learnFirst, `闭卷耗尽后回落到先学题（选中 ${fallback?.id}），由前端先展示材料`)

// B3. 普通节点（无先学题）行为不变：照常出题
const someClosedNode = db.prepare(
  `SELECT node_id FROM questions WHERE status='active' AND parent_id IS NULL
   GROUP BY node_id HAVING SUM(COALESCE(json_extract(data,'$.learnFirst'),0))=0 LIMIT 1`).get().node_id
const normal = pickQuestion(someClosedNode, new Set())
assert(normal && !normal.learnFirst, `纯闭卷节点选题不受影响（${someClosedNode} → ${normal?.id}）`)

console.log('\n— C. 状态机：guess(蒙题,scale0) 等价不会，触发 capped —')
let st = emptyPlacement18(['m1'])
st = recordAnswer(st, 'm1', { nodeId: 'm1.a', scale4: 0, isGap: true }) // guess 走 isGap=true、scale4=0
assert(st.modules.m1.state === MODULE_STATE.CAPPED, '蒙题按 0 档喂状态机 → 模块立即 capped 收束（与「不会」同效）')
// 对照：真实答对(scale3)才进入 climbing
let st2 = emptyPlacement18(['m2'])
st2 = recordAnswer(st2, 'm2', { nodeId: 'm2.a', scale4: 3, isGap: false })
assert(st2.modules.m2.state === MODULE_STATE.CLIMBING, '真实答对仍正常 climbing，蒙题不误伤诚实作答路径')

db.close()
console.log(bad.length ? `\n❌ ${bad.length} 项失败` : '\n✅ R19 先学后测全部断言通过')
process.exit(bad.length ? 1 : 0)
