#!/usr/bin/env node
/**
 * R33 从零开始（progress.resetAll）验收。
 *
 * 破坏性操作不能在用户那份库上跑：这里连的是隔离实例（FORGE_DATA_DIR=data/instances/2，
 * CDP 9223），先自己造出各表的进度，再调真实 IPC 清空，最后直接读 SQLite 的副本核对。
 *
 * 覆盖：
 *   A. 契约接线：API_METHODS / ForgeApi / ipc.ts / progress.ts 四处对得上
 *   B. 干净库：seed 预建的 srs / node_mastery 空壳行不算进度（dirty=false）
 *   C. 有进度后 summary 数字准确、dirty=true
 *   D. resetAll：纯进度表被删空、srs/mastery/game_stats 归零而不是删掉
 *   E. 保留项：settings / questions / nodes / knowledge / ai_explain 一行不少
 *   F. 清完再 summary：dirty=false，各块 0，XP 与等级回 Lv.1
 */
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Cdp, sleep } from './cdp.mjs'

const bad = []
const ok = (c, m) => { if (!c) bad.push(m); console.log(`  ${c ? 'OK ' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1 }

/* ---------------- A. 契约接线 ---------------- */
console.log('\n— A. IPC 契约接线 —')
const root = process.cwd()
const apiSrc = readFileSync(join(root, 'src/shared/api.ts'), 'utf8')
ok(/progress:\s*\[\s*'summary',\s*'resetAll'\s*\]/.test(apiSrc), "API_METHODS.progress = ['summary','resetAll']")
ok(/progress:\s*{[\s\S]*?summary\(\): Promise<ProgressSummary>/.test(apiSrc), 'ForgeApi.progress.summary 声明返回 ProgressSummary')
const ipcSrc = readFileSync(join(root, 'src/main/ipc.ts'), 'utf8')
ok(/progress:\s*{[\s\S]*?async summary\(\)[\s\S]*?async resetAll\(\)/.test(ipcSrc), 'ipc.ts 实现 progress.summary / progress.resetAll')
const svcSrc = readFileSync(join(root, 'src/main/services/progress.ts'), 'utf8')
ok(/export function resetAllProgress/.test(svcSrc), 'progress.ts 导出 resetAllProgress')
ok(!/DELETE FROM srs|DELETE FROM node_mastery/.test(svcSrc), 'srs / node_mastery 不做 DELETE（seed 预建的空壳行必须留下）')
ok(/UPDATE srs SET/.test(svcSrc) && /UPDATE node_mastery SET/.test(svcSrc), 'srs / node_mastery 走 UPDATE 归零')

const cdp = await Cdp.connect()
const call = (body) => cdp.evaluate(`return await (${body})()`)

/* ---------------- B. 干净库 ---------------- */
console.log('\n— B. 干净库不该显示进度 —')
const clean = await call('async () => window.forge.progress.summary()')
console.log('   干净库 summary =', JSON.stringify(clean.areas.map((a) => `${a.key}:${a.n}`)), 'xp=', clean.xp)
ok(!clean.dirty, 'dirty=false（预建的 srs/mastery 空壳行不算进度）')
ok(clean.total === 0, `total=0（实际 ${clean.total}）`)
const dbPath = join(root, 'data', 'instances', '2', 'app.db')
const q = (sql) => {
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA busy_timeout=8000')
  const r = db.prepare(sql).all()
  db.close()
  return r
}
const seeded = {
  questions: q(`SELECT COUNT(*) n FROM questions`)[0].n,
  nodes: q(`SELECT COUNT(*) n FROM nodes`)[0].n,
  settings: q(`SELECT COUNT(*) n FROM settings`)[0].n,
  knowledge: q(`SELECT COUNT(*) n FROM knowledge`)[0].n,
  srsRows: q(`SELECT COUNT(*) n FROM srs`)[0].n,
  masteryRows: q(`SELECT COUNT(*) n FROM node_mastery`)[0].n
}
console.log('   基线行数 =', JSON.stringify(seeded))
ok(seeded.srsRows > 0 && seeded.masteryRows > 0, 'seed 确实预建了 srs / node_mastery 行（所以不能删空）')

/* ---------------- C. 造进度 ---------------- */
console.log('\n— C. 造出各块进度 —')
// C1 真实通关一关：走 project.run，草稿与通关一起落库（顺带发 XP、写 game_events）
const projects = await call('async () => window.forge.project.list()')
const pid = projects[0].id
const lv = await call(`async () => window.forge.project.detail(${JSON.stringify(pid)})`)
const lv1 = lv.levels[0]
// 参考答案只在 content/ 源文件里（主进程刻意不把它放进 detail，避免渲染层直接抄）
const projJson = JSON.parse(readFileSync(join(root, 'content', 'projects', `${pid}.json`), 'utf8'))
const sol = projJson.levels[0].solution
ok(!!sol, '第 1 关内容里带参考答案（可用来真跑通过）')
const run = await call(`async () => window.forge.project.run(${JSON.stringify(pid)}, ${JSON.stringify(lv1.id)}, ${JSON.stringify(sol)})`)
ok(!!run.passed, `project.run 通过（attempts=${run.attempts}, xpAwarded=${run.xpAwarded}）`)
// C2 打卡（真实 IPC）
await call('async () => window.forge.daily.checkin(true)')
// C3 练习作答 + 复习排期 + 掌握度：用 markGuessed 写入一条 0 档 attempt
const qid = q(`SELECT id FROM questions ORDER BY id LIMIT 1`)[0].id
await call(`async () => window.forge.practice.markGuessed(${JSON.stringify(qid)})`)
await sleep(400)

const before = await call('async () => window.forge.progress.summary()')
console.log('   有进度 summary =', JSON.stringify(before.areas.map((a) => `${a.key}:${a.n}`)), 'xp=', before.xp, 'level=', before.level)
ok(before.dirty, 'dirty=true')
ok(before.areas.find((a) => a.key === 'projectDone').n >= 1, '项目关卡 记到 1 关通关')
ok(before.areas.find((a) => a.key === 'attempts').n >= 1, '练习作答 记到至少 1 条（markGuessed 落的）')
ok(before.areas.find((a) => a.key === 'srs').n >= 1, '复习排期 记到复习过的题')
ok(before.areas.find((a) => a.key === 'mastery').n >= 1, '知识点掌握度 记到练过的考点')
ok(before.areas.find((a) => a.key === 'checkins').n === 1, '打卡 记到 1 天')
ok(before.xp > 0, `XP 已发（${before.xp}）`)

/* ---------------- D. 清空 ---------------- */
console.log('\n— D. 从零开始：清空 —')
const r = await call('async () => window.forge.progress.resetAll()')
console.log('   cleared =', JSON.stringify(r.cleared))
ok(r.ok === true, 'resetAll 返回 ok')
const clearedTables = r.cleared.map((c) => c.table)
ok(clearedTables.includes('project_progress'), '回报清掉了 project_progress')
ok(!clearedTables.includes('srs'), 'srs 不在「删除」清单里（走归零）')
ok(r.after.total === 0 && !r.after.dirty, `清空后 total=0 / dirty=false（实际 total=${r.after.total}, dirty=${r.after.dirty}）`)
ok(r.after.xp === 0 && r.after.level === 1, `等级回到 Lv.1 · 0 XP（实际 Lv.${r.after.level} · ${r.after.xp}）`)

/* ---------------- E. 库里核对 ---------------- */
console.log('\n— E. 直接读库核对 —')
const afterCounts = {
  attempts: q(`SELECT COUNT(*) n FROM attempts`)[0].n,
  project_progress: q(`SELECT COUNT(*) n FROM project_progress`)[0].n,
  checkins: q(`SELECT COUNT(*) n FROM checkins`)[0].n,
  game_events: q(`SELECT COUNT(*) n FROM game_events`)[0].n,
  game_badges: q(`SELECT COUNT(*) n FROM game_badges`)[0].n,
  exams: q(`SELECT COUNT(*) n FROM exams`)[0].n,
  placement_session: q(`SELECT COUNT(*) n FROM placement_session`)[0].n,
  srsRows: q(`SELECT COUNT(*) n FROM srs`)[0].n,
  srsActive: q(`SELECT COUNT(*) n FROM srs WHERE reps>0 OR last_review IS NOT NULL`)[0].n,
  masteryRows: q(`SELECT COUNT(*) n FROM node_mastery`)[0].n,
  masteryActive: q(`SELECT COUNT(*) n FROM node_mastery WHERE answered>0 OR forced_unlock=1`)[0].n,
  gameStats: q(`SELECT xp, level FROM game_stats WHERE id=1`)[0],
  questions: q(`SELECT COUNT(*) n FROM questions`)[0].n,
  nodes: q(`SELECT COUNT(*) n FROM nodes`)[0].n,
  settings: q(`SELECT COUNT(*) n FROM settings`)[0].n,
  knowledge: q(`SELECT COUNT(*) n FROM knowledge`)[0].n,
  ai_log: q(`SELECT COUNT(*) n FROM ai_log`)[0].n
}
console.log('   清空后行数 =', JSON.stringify(afterCounts))
for (const t of ['attempts', 'project_progress', 'checkins', 'game_events', 'game_badges', 'exams', 'placement_session']) {
  ok(afterCounts[t] === 0, `${t} 已清空`)
}
ok(afterCounts.srsRows === seeded.srsRows, `srs 行数不变（${afterCounts.srsRows} = seed 的 ${seeded.srsRows}）`)
ok(afterCounts.srsActive === 0, 'srs 里的复习记录已归零')
ok(afterCounts.masteryRows === seeded.masteryRows, `node_mastery 行数不变（${afterCounts.masteryRows}）`)
ok(afterCounts.masteryActive === 0, 'node_mastery 里的掌握度已归零')
ok(afterCounts.gameStats.xp === 0 && afterCounts.gameStats.level === 1, 'game_stats 归零为 Lv.1 / 0 XP')
ok(afterCounts.questions === seeded.questions, '题库一行没少')
ok(afterCounts.nodes === seeded.nodes, '考点一行没少')
ok(afterCounts.settings === seeded.settings, '设置一行没少（API 端点没被清）')
ok(afterCounts.knowledge === seeded.knowledge, `知识体系索引未被动过（${afterCounts.knowledge} = 原 ${seeded.knowledge}）`)

/* ---------------- F. 再来一次 ---------------- */
console.log('\n— F. 已空时再点一次 —')
const again = await call('async () => window.forge.progress.resetAll()')
ok(again.before.dirty === false, '第二次进来 before.dirty=false（按钮该置灰）')
ok(again.cleared.filter((c) => !/归零/.test(c.table)).length === 0, '没有任何表被删（幂等）')

const errs = cdp.errors()
ok(errs.length === 0, `控制台无报错（${errs.length} 条${errs.length ? ': ' + JSON.stringify(errs.slice(0, 2)) : ''}）`)
await cdp.close()

console.log(bad.length ? `\n❌ ${bad.length} 项失败` : '\n✅ 全部通过')
process.exit(bad.length ? 1 : 0)