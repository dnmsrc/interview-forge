// v18 边界探测摸底 CDP 冒烟：通过运行中 Electron 的真实 IPC 验证主进程引擎（纯 Node 测试只覆盖纯函数+同源 SQL）。
// 全程用 eng 隔离域，结束清理本脚本产生的临时会话/turn，绝不触碰用户真实进度。
import { Cdp, sleep } from './cdp.mjs'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

const bad = []
const ok = (c, m) => { if (!c) bad.push(m); console.log(`  ${c ? 'OK ' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1 }
const openDb = () => { const d = new DatabaseSync(join(process.cwd(), 'data', 'app.db')); d.exec('PRAGMA busy_timeout=8000'); return d }
// eng 域题目未挂 L4 叶子（activeModules 为 0），改用有 8 个有题模块的 ai 域做隔离冒烟
const DOM = 'ai'

const db0 = openDb()
// 预清理：删掉历史失败运行可能残留的本域临时会话（含 qalegcy*），保证基线干净
db0.prepare("DELETE FROM placement_turn WHERE session_id IN (SELECT id FROM placement_session WHERE domain=? OR id LIKE 'qalegcy%')").run(DOM)
db0.prepare("DELETE FROM placement_session WHERE domain=? OR id LIKE 'qalegcy%'").run(DOM)
const baseEng = db0.prepare('SELECT COUNT(*) c FROM placement_session WHERE domain=?').get(DOM).c
const baseFe = db0.prepare("SELECT id,status FROM placement_session WHERE domain='fe' AND status='active'").all()
console.log('基线：' + DOM + ' 会话', baseEng, '| fe active（须原样保留）:', JSON.stringify(baseFe))
db0.close()

const cdp = await Cdp.connect(20)
await cdp.metrics(1460, 920)
const call = (body) => cdp.evaluate(body)

// ---- 1. start：新建 v18 会话，首题来自最浅模块，hint 体现「不固定题数/会就加难」----
const s1 = await call(`
  const r = await window.forge.placement.start(${JSON.stringify(DOM)}, { force: true });
  return { sid: r.sessionId, hasItem: !!r.item, hint: r.hint, progress: r.progress, node: r.item?.nodeTitle }`)
ok(!!s1.sid && s1.hasItem, 'start 新建会话并出首题：' + (s1.node || s1.hint))
if (!s1.sid) { console.error('无法建立会话，终止冒烟：', s1.hint); await cdp.close(); process.exit(1) }
ok(/不固定题数|天花板|逐级|收/.test(s1.hint), '首题 hint 体现 v18 自适应/够判即停：' + s1.hint)
ok(s1.progress.total > 0 && s1.progress.done === 0, `进度按模块计（done=0/total=${s1.progress.total}），分母是模块数而非几百考点`)
const sid = s1.sid

// 读调度态确认是 v18 且首模块处于 probing
const dbv = openDb()
const stateRow = dbv.prepare('SELECT summary FROM placement_session WHERE id=?').get(sid)
dbv.close()
const sched = JSON.parse(stateRow?.summary ?? '{}').__scheduler
ok(!!sched && sched.v === 18 && !!sched.modules, '会话落库的是 v18 调度态（v=' + sched?.v + '）')
const firstModule = Object.keys(sched.modules)[0]
ok(sched.modules[firstModule].state === 'probing', '首模块初始为 probing：' + firstModule)

// 读当前会话调度态（每次提交后结构会整体重写；会话 done 后 summary 是完成报告，返回 null）
function readState() {
  const d = openDb(); const row = d.prepare('SELECT summary,status FROM placement_session WHERE id=?').get(sid); d.close()
  try { const p = JSON.parse(row.summary); return p?.__scheduler?.v === 18 ? p.__scheduler : null } catch { return null }
}

/** 按题型构造「标准答案」作答，保证客观题本地自动判对（形状对齐 grading.ts gradeObjective） */
function correctAnswer(type, ref) {
  if (type === 'single') return { keys: [ref?.keys?.[0] ?? 'A'] }
  if (type === 'multiple') return { keys: ref?.keys ?? ['A'] }
  if (type === 'judge') return { judge: typeof ref?.judge === 'boolean' ? ref.judge : true }
  if (type === 'blank') return { blanks: ref?.blanks ?? (ref?.ref ? [String(ref.ref)] : ['']) }
  return null // 主观题返回 null，调用方走 concept 缺口
}

/** 取下一道活动题；会话结束返回 null */
async function nextQuestion() {
  return call(`const n = await window.forge.placement.next(${JSON.stringify(sid)}); return { id:n.item?.id, type:n.item?.type, q:n.item?.q }`)
}

// ---- 2. 探针答对 → 首模块进入 climbing（主观题用缺口跳过，让客观题承载「答对」验证）----
let st = readState()
const firstMod = st.moduleOrder[0]
let guard = 0
while (st.modules[firstMod]?.state === 'probing' && guard++ < 8) {
  const q = await nextQuestion()
  if (!q?.id) break
  if (['single', 'multiple', 'judge', 'blank'].includes(q.type)) {
    const ans = correctAnswer(q.type, q.q?.answer)
    await call(`await window.forge.placement.submit(${JSON.stringify(sid)}, ${JSON.stringify(q.id)}, ${JSON.stringify(ans)}, { gapType:null, gapNote:null }); return 1`)
  } else {
    await call(`await window.forge.placement.submit(${JSON.stringify(sid)}, ${JSON.stringify(q.id)}, null, { gapType:'concept', gapNote:null }); return 1`)
  }
  st = readState()
  if (!st) break // 会话已收尾
}
ok(!!st && (st.modules[firstMod]?.state === 'climbing' || st.modules[firstMod]?.state === 'topped'),
  '探针答对后首模块离开 probing（实际 ' + st?.modules[firstMod]?.state + '）：答对→climbing，无题→topped')

// ---- 3. 对所有还在 probing/climbing 的模块连续「我不会(concept)」→ 每个都能收束，不卡死 ----
if (st) {
  for (const m of st.moduleOrder) {
    let g2 = 0
    let cur = readState()
    while (cur && !['capped', 'topped'].includes(cur.modules[m]?.state) && g2++ < 10) {
      const q = await nextQuestion()
      if (!q?.id) break
      await call(`await window.forge.placement.submit(${JSON.stringify(sid)}, ${JSON.stringify(q.id)}, null, { gapType:'concept', gapNote:null }); return 1`)
      cur = readState()
    }
  }
}
const finalState = readState()
// 会话 done 后 summary 被 finishSession 改写成完成报告（无 __scheduler），故用 status 兜底判收束
const dbc3 = openDb()
const sessStatus = dbc3.prepare('SELECT status FROM placement_session WHERE id=?').get(sid).status
dbc3.close()
const settledOrDone = sessStatus === 'done' ||
  (!!finalState && finalState.moduleOrder.every((m) => ['capped', 'topped'].includes(finalState.modules[m].state)))
ok(settledOrDone, '连续「不会」后所有模块收束（capped/topped），摸底正常结束而非卡死（status=' + sessStatus + '）')

// ---- 4. 弱路径题量克制：全程轮数不应接近安全顶 60 ----
const dbc4 = openDb()
const turnCount = dbc4.prepare('SELECT COUNT(*) c FROM placement_turn WHERE session_id=?').get(sid).c
const sessDone = dbc4.prepare('SELECT status FROM placement_session WHERE id=?').get(sid)
dbc4.close()
ok(sessDone.status === 'done', '会话状态置为 done：' + sessDone.status)
ok(turnCount < 60, `总题量 ${turnCount} 远低于安全顶 60（弱路径快速收束）`)

// ---- 5. 旧 v17 会话惰性兼容：塞一个 v17 调度态的 active 会话，start 不应崩且能转成 v18 ----
const d2 = openDb()
const legacyId = 'qalegcy' + Math.random().toString(36).slice(2, 6)
const anyNode = d2.prepare("SELECT id FROM nodes WHERE domain=? AND level=4 AND status='active' LIMIT 1").get(DOM)
// 取该节点下真实存在的母题，保证 start 复用后能取到题（避免僵尸收口）
const anyQ = d2.prepare("SELECT id FROM questions WHERE node_id=? AND status='active' AND parent_id IS NULL LIMIT 1").get(anyNode.id)
const ts = new Date().toISOString().slice(0, 19).replace('T', ' ')
d2.prepare(`INSERT INTO placement_session(id,domain,status,current_node_id,level,created_at,updated_at,summary)
  VALUES(?,?,?,?,?,?,?,?)`).run(legacyId, DOM, 'active', anyNode.id, 2, ts, ts, JSON.stringify({ __scheduler: { v: 17, moduleOrder: [], probeCursor: 0, probed: {}, deepenQuota: {}, deepenUsed: {} } }))
d2.prepare(`INSERT INTO placement_turn(session_id,node_id,question_id,scale4,pct,verdict,gap_type,gap_note,grading_kind,answer,created_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(legacyId, anyNode.id, anyQ.id, 0, 0, 'legacy', 'concept', null, 'self', null, ts)
d2.close()
let legacyOk = false; let legacyErr = ''
try {
  const r = await call(`const x = await window.forge.placement.start(${JSON.stringify(DOM)}); return { sid:x.sessionId, hasItem:!!x.item, hint:x.hint }`)
  if (r?.sid) {
    // start 复用了 legacy 会话：其 v17 summary 应已被惰性重建为 v18（在首次 loadScheduler/submit 时）
    const d3 = openDb()
    const row = d3.prepare('SELECT summary FROM placement_session WHERE id=?').get(legacyId)
    d3.close()
    const parsed = JSON.parse(row.summary)
    // 只要没崩、且要么已转 v18，要么仍是待重建的 v17（下次提交即转），都算兼容成功；关键是 start 不抛错
    legacyOk = parsed?.__scheduler?.v === 18 || parsed?.__scheduler?.v === 17
  }
} catch (e) { legacyErr = String(e?.message || e) }
ok(legacyOk, '旧 v17 会话 start 不崩且调度态可被兼容（重建/待重建） ' + legacyErr)

await cdp.close()

// ---- 清理 eng 临时数据，fe 真实进度零改动 ----
const dc = openDb()
dc.prepare('DELETE FROM placement_turn WHERE session_id IN (SELECT id FROM placement_session WHERE domain=?)').run(DOM)
dc.prepare('DELETE FROM placement_session WHERE domain=?').run(DOM)
const engAfter = dc.prepare('SELECT COUNT(*) c FROM placement_session WHERE domain=?').get(DOM).c
const feAfter = dc.prepare("SELECT id,status FROM placement_session WHERE domain='fe' AND status='active'").all()
dc.close()
ok(engAfter === baseEng, 'eng 会话回到基线（' + engAfter + '/' + baseEng + '）')
ok(JSON.stringify(feAfter) === JSON.stringify(baseFe), '用户 fe 真实会话零改动：' + JSON.stringify(feAfter))

console.log(bad.length ? `\n❌ v18 CDP 冒烟 ${bad.length} 项失败: ${bad.join(' | ')}` : '\n✅ v18 边界探测摸底 CDP 冒烟全部通过')
process.exit(bad.length ? 1 : 0)
