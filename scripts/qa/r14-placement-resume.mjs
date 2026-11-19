// R14 定向验证：摸底点板块卡片默认「续测复用」而非新建空壳（修复做过的题下次进来重做）。
// 全程只用 eng 隔离域（有题、无真实会话），结束清理本脚本产生的临时会话，绝不触碰用户 fe 真实进度。
import { Cdp, sleep } from './cdp.mjs'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

const bad = []
const ok = (c, m) => { if (!c) bad.push(m); console.log(`  ${c ? 'OK ' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1 }
const openDb = () => { const d = new DatabaseSync(join(process.cwd(), 'data', 'app.db')); d.exec('PRAGMA busy_timeout=8000'); return d }
const DOM = 'eng'

const db0 = openDb()
const baseSessions = db0.prepare('SELECT COUNT(*) c FROM placement_session WHERE domain=?').get(DOM).c
const baseFeActive = db0.prepare("SELECT id,status FROM placement_session WHERE domain='fe' AND status='active'").all()
console.log('基线：eng 会话', baseSessions, '| fe active 会话（必须原样保留）:', JSON.stringify(baseFeActive))
db0.close()

const cdp = await Cdp.connect(20)
await cdp.metrics(1460, 920)
const call = (body) => cdp.evaluate(body)

// ---- 1. 首次 start：无活动会话 → 新建（resumed=false）----
const s1 = await call(`
  const r = await window.forge.placement.start(${JSON.stringify(DOM)});
  return { sessionId: r.sessionId, resumed: r.resumed, hasItem: !!r.item, hint: r.hint, itemId: r.item?.id }`)
ok(!!s1.sessionId && s1.hasItem, '首次 start 正常新建会话并出题')
ok(s1.resumed === false, '无活动会话时 resumed=false（确为新建）')
const sid1 = s1.sessionId

// 在该会话用 skip 提交一题（skip 不写 attempt，但会落 placement_turn），制造真实进度
await call(`await window.forge.placement.submit(${JSON.stringify(sid1)}, ${JSON.stringify(s1.itemId)}, null, { gapType: 'skip', gapNote: null }); return 1`)
const dbv = openDb()
const turns1 = dbv.prepare('SELECT COUNT(*) c FROM placement_turn WHERE session_id=?').get(sid1).c
dbv.close()
ok(turns1 === 1, '作答真实落库到该会话（turns=1），模拟用户做了题就退出')

// ---- 2. 核心：未完成时再次 start（不带 force）→ 必须复用同一会话 ----
const s2 = await call(`
  const r = await window.forge.placement.start(${JSON.stringify(DOM)});
  return { sessionId: r.sessionId, resumed: r.resumed, hasItem: !!r.item, progress: r.progress, hint: r.hint }`)
ok(s2.sessionId === sid1, '核心：未完成时再次 start 复用同一会话（' + s2.sessionId + '），不再新建空壳')
ok(s2.resumed === true, '复用时 resumed=true，前端可据此提示「已恢复上次进度」')
ok(/继续上次|已做/.test(s2.hint), '续测 hint 明确告知是断点继续：' + s2.hint)
ok(s2.progress.done >= 1, '续测带回已探考点进度（done=' + s2.progress.done + '），不是从 0 重来')

// ---- 3. force=true：显式开新一轮，必须新建不同会话 ----
const s3 = await call(`
  const r = await window.forge.placement.start(${JSON.stringify(DOM)}, { force: true });
  return { sessionId: r.sessionId, resumed: r.resumed, hasItem: !!r.item }`)
ok(!!s3.sessionId && s3.sessionId !== sid1, 'force=true 新建独立会话（' + s3.sessionId + ' ≠ ' + sid1 + '）')
ok(s3.resumed === false, 'force 新建 resumed=false')

// ---- 4. resume(domain) 仍能取到最近活动会话（兼容旧入口/横幅）----
const r4 = await call(`return await window.forge.placement.resume(${JSON.stringify(DOM)})`)
ok(!!r4?.sessionId, 'resume(domain) 仍可断点续测')

// ---- 5. 前端介绍页：eng 卡片出现「未完成·点击继续」标记 ----
await cdp.nav('/placement')
await sleep(1300)
await cdp.evaluate(`[...document.querySelectorAll('button')].find(b=>/退出/.test(b.textContent)&&b.getBoundingClientRect().width>0)?.click(); return 1`).catch(()=>{})
await sleep(700)
const ui = await cdp.evaluate(`
  const card=[...document.querySelectorAll('.domain-card')].find(c=>/工程难题/.test(c.textContent));
  return {
    hasCard: !!card,
    hasResumePill: !!card?.querySelector('.resume-pill'),
    pillText: card?.querySelector('.resume-pill')?.innerText || '',
    subText: card?.querySelector('.micro')?.innerText || ''
  }`)
ok(ui.hasCard && ui.hasResumePill, 'eng 板块卡片显示「未完成·点击继续」标记：' + ui.pillText)
ok(/断点|不重做|继续/.test(ui.subText + ui.pillText), '卡片副文案提示从断点继续、已做题不重做：' + ui.subText)
await cdp.shot('data/qa/r14-placement-resume-pill.png')

await cdp.close()

// ---- 6. 清理本脚本产生的 eng 临时会话（含 turn），fe 真实会话必须原样保留 ----
const dbc = openDb()
const delTurns = dbc.prepare('DELETE FROM placement_turn WHERE session_id IN (SELECT id FROM placement_session WHERE domain=?)').run(DOM).changes
const delSess = dbc.prepare('DELETE FROM placement_session WHERE domain=?').run(DOM).changes
const finEng = dbc.prepare('SELECT COUNT(*) c FROM placement_session WHERE domain=?').get(DOM).c
const feAfter = dbc.prepare("SELECT id,status FROM placement_session WHERE domain='fe' AND status='active'").all()
dbc.close()
console.log('清理 eng 临时会话', delSess, '个、turn', delTurns, '条')
ok(finEng === baseSessions, 'eng 会话回到基线（' + finEng + '/' + baseSessions + '）')
ok(JSON.stringify(feAfter) === JSON.stringify(baseFeActive), '用户 fe 真实会话零改动：' + JSON.stringify(feAfter))

console.log(bad.length ? `\n❌ R14 摸底续测验证 ${bad.length} 项失败: ${bad.join(' | ')}` : '\n✅ R14 摸底卡片默认续测、force 新建、卡片标记、用户数据零污染，全部通过')
process.exit(bad.length ? 1 : 0)
