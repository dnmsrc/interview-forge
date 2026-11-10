import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app } from 'electron'
import { DDL_STATEMENTS, SCHEMA_VERSION } from '../shared/schema.mjs'
import { seedDatabase } from '../../scripts/seed-core.mjs'

/**
 * 数据目录优先级：FORGE_DATA_DIR 环境变量 > 项目内 data/（开发便携模式） > userData
 * 便携模式让题库与进度可以整目录拷走备份，也方便脚本直接读。
 */
export function resolveDataDir(): string {
  if (process.env.FORGE_DATA_DIR) return resolve(process.env.FORGE_DATA_DIR)
  if (!app.isPackaged) return resolve(join(__dirname, '../../data'))
  return join(app.getPath('userData'), 'forge-data')
}

export function contentRoot(): string {
  // 打包后 content 目录作为 extraResources 随包发布
  const base = app.isPackaged ? join(process.resourcesPath, 'content') : resolve(join(__dirname, '../../content'))
  return base
}

let _db: DatabaseSync | null = null
export let seedStats: any = null

/** 全部业务表（重建缓存时按依赖倒序 drop） */
const ALL_TABLES = ['attempts', 'srs', 'node_mastery', 'exam_questions', 'exams', 'bank_versions',
  'dirty_reports', 'ai_log', 'checkins', 'placement', 'questions', 'edges', 'nodes', 'settings', 'meta']

export function initDatabase(dir = resolveDataDir()) {
  mkdirSync(dir, { recursive: true })
  const db = new DatabaseSync(join(dir, 'app.db'))
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=4000;`)

  // 结构版本校验：SQLite 只是 content/ 的缓存，版本对不上就整库重建，
  // 免去一堆 ALTER 迁移；题库真源与 AI 生成内容都在 JSON 文件里，重建不丢东西（进度会重算）。
  let oldVersion: string | undefined
  try {
    oldVersion = (db.prepare(`SELECT value FROM meta WHERE key='schema_version'`).get() as { value: string } | undefined)?.value
  } catch { /* 首次运行，还没有 meta */ }
  for (const stmt of DDL_STATEMENTS) db.exec(stmt)
  if (oldVersion && oldVersion !== String(SCHEMA_VERSION)) {
    console.warn(`[db] schema_version ${oldVersion} → ${SCHEMA_VERSION}，重建缓存表`)
    db.exec('PRAGMA foreign_keys=OFF')
    for (const t of ALL_TABLES) db.exec(`DROP TABLE IF EXISTS ${t}`)
    for (const stmt of DDL_STATEMENTS) db.exec(stmt)
    db.exec('PRAGMA foreign_keys=ON; VACUUM;')
  }
  db.prepare(`INSERT INTO meta(key,value) VALUES('schema_version',?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(String(SCHEMA_VERSION))

  const qCount = (db.prepare(`SELECT COUNT(*) n FROM questions`).get() as { n: number }).n
  const needSeed = qCount === 0 || process.env.FORGE_RESEED === '1'
  if (needSeed && existsSync(contentRoot())) {
    try { seedStats = seedDatabase(db, contentRoot(), { log: (m: string) => console.warn('[seed]', m) }) } catch (e: any) {
      console.error('[seed] 导入失败：', e.message)
      seedStats = { error: e.message }
    }
  }
  _db = db
  return db
}

export function db(): DatabaseSync {
  if (!_db) throw new Error('数据库尚未初始化')
  return _db
}

export function reloadContent() {
  const stats = seedDatabase(db(), contentRoot(), { replace: true, log: (m: string) => console.warn('[seed]', m) })
  seedStats = stats
  return stats
}

export const all = <T = any>(sql: string, params: unknown[] = []): T[] =>
  db().prepare(sql).all(...(params as any[])) as T[]
export const get = <T = any>(sql: string, params: unknown[] = []): T | undefined =>
  db().prepare(sql).get(...(params as any[])) as T | undefined
export const run = (sql: string, params: unknown[] = []) =>
  db().prepare(sql).run(...(params as any[]))
export function tx<T>(fn: () => T): T {
  db().exec('BEGIN')
  try { const r = fn(); db().exec('COMMIT'); return r } catch (e) { db().exec('ROLLBACK'); throw e }
}

export function settingGet<T = any>(key: string, fallback?: T): T | undefined {
  const row = get<{ value: string }>(`SELECT value FROM settings WHERE key=?`, [key])
  if (!row) return fallback
  try { return JSON.parse(row.value) as T } catch { return fallback }
}
export function settingSet(key: string, value: unknown) {
  run(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    [key, JSON.stringify(value)])
}
