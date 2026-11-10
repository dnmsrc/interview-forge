#!/usr/bin/env node
// CLI 灌库：node scripts/seed.mjs [数据目录]
// 默认写到 ./data/app.db（便携风格，便于备份与迁移；生产环境可由主进程改用 userData）
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DDL_STATEMENTS, SCHEMA_VERSION } from '../src/shared/schema.mjs'
import { seedDatabase } from './seed-core.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const dataDir = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, 'data')
mkdirSync(dataDir, { recursive: true })
const dbPath = join(dataDir, 'app.db')
console.log(`数据库: ${dbPath}`)

const db = new DatabaseSync(dbPath)
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;`)
for (const stmt of DDL_STATEMENTS) db.exec(stmt)
db.prepare(`INSERT INTO meta(key,value) VALUES('schema_version',?)
  ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(String(SCHEMA_VERSION))

const t0 = Date.now()
const stats = seedDatabase(db, join(ROOT, 'content'), { log: (m) => console.log('  ·', m) })
console.log(`导入完成（${Date.now() - t0}ms）`)
console.table({
  节点: stats.nodes, 题目: stats.questions, 变体: stats.variants, 边: stats.edges,
  跳过: stats.skipped.length
})
if (stats.skipped.length) {
  console.log('\n跳过明细（前 40 条）:')
  for (const s of stats.skipped.slice(0, 40)) console.log('  -', s)
}
const byType = db.prepare(`SELECT type, COUNT(*) n FROM questions GROUP BY type ORDER BY n DESC`).all()
const byDomain = db.prepare(`SELECT substr(node_id,1,instr(node_id,'.')-1) domain, COUNT(*) n FROM questions GROUP BY domain ORDER BY n DESC`).all()
console.log('\n题型分布:', JSON.stringify(byType))
console.log('板块分布:', JSON.stringify(byDomain))
console.log('点亮节点数:', db.prepare(`SELECT COUNT(*) n FROM node_mastery WHERE lit=1`).get().n)
db.close()
