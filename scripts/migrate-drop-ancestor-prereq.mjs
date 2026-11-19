#!/usr/bin/env node
// 一次性数据修正：删掉「前置指向自身祖先」的 prereq 边（归属关系已有 contains 边表达）。
// 这类边会让 level3 模块成为子考点的门槛，而 level3 一个题都没挂 → 永远点不亮 → 子考点永久锁死，
// 兜底放开后又第一次就抽到 level4 深水区题（用户反馈"没有一点前置准备就让我答题"）。
// 幂等：重复执行只会删掉同一条边。用法：node scripts/migrate-drop-ancestor-prereq.mjs [--dry]
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

const dry = process.argv.includes('--dry')
const db = new DatabaseSync(join(process.cwd(), 'data', 'app.db'))
db.exec(`PRAGMA busy_timeout=8000`)

const hit = db.prepare(
  `SELECT from_id, to_id FROM edges WHERE type='prereq' AND to_id LIKE from_id || '.%' ORDER BY to_id`
).all()
console.log(`将删除 ${hit.length} 条「祖先当门槛」的 prereq 边${dry ? '（--dry，未写入）' : ''}`)
for (const r of hit.slice(0, 8)) console.log(`  ${r.from_id}  →  ${r.to_id}`)
if (hit.length > 8) console.log(`  …共 ${hit.length} 条`)

if (!dry && hit.length) {
  // VACUUM INTO 不能在事务里执行，备份必须在 BEGIN 之前做
  const bak = `data/app.before-ancestor-fix-${new Date().toISOString().replace(/[:.]/g, '')}.db`
  db.exec(`VACUUM INTO '${bak.replace(/'/g, "''")}'`)
  db.exec(`BEGIN`)
  try {
    const del = db.prepare(`DELETE FROM edges WHERE type='prereq' AND to_id LIKE from_id || '.%'`).run()
    // 顺带把 meta 里的图谱口径版本记下来，便于以后判断某台机器的库修过没有
    db.prepare(`INSERT OR REPLACE INTO meta(key,value) VALUES('schema_note',?)`)
      .run(`ancestor-prereq removed at ${new Date().toISOString()}, dropped=${hit.length}`)
    db.exec(`COMMIT`)
    console.log(`已删除 ${del.changes} 条，备份在 ${bak}`)
  } catch (e) { db.exec(`ROLLBACK`); throw e }
}

const left = db.prepare(`SELECT COUNT(*) c FROM edges WHERE type='prereq' AND to_id LIKE from_id || '.%'`).get()
const dist = db.prepare(`SELECT type, COUNT(*) c FROM edges GROUP BY type ORDER BY c DESC`).all()
console.log(`剩余祖先边=${left.c} | 边分布=${JSON.stringify(dist)}`)
db.close()
