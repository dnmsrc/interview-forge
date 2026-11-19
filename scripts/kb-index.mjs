#!/usr/bin/env node
// 知识索引 CLI（契约 docs/design/KNOWLEDGE-SYSTEM.md §2.3 / §11）
//
//   node scripts/kb-index.mjs                # 增量同步 content/knowledge → data/app.db
//   node scripts/kb-index.mjs --check-only    # 只解析 + 跑质量闸门，不写库
//   node scripts/kb-index.mjs --force         # 忽略 hash 全量重建（CI / 排错用）
//   node scripts/kb-index.mjs --db path.db    # 指定别的库（压测造量时用临时库）
//
// 注意：这里**不能** import src/main 下的任何文件——那些文件依赖 electron，纯 node 起不来。
// 所以本脚本直连 node:sqlite，并复用 src/shared/knowledge-core.mjs 这套纯函数，
// 保证「应用里的索引」和「CLI 校验」是同一套解析/分词/闸门规则。
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, mkdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DDL_STATEMENTS, MIGRATION_STATEMENTS } from '../src/shared/schema.mjs'
import {
  parseKnowledgeMd, tokenizeForSearch, buildFtsMatch, qualityCheck, summaryOf, wordCountOf
} from '../src/shared/knowledge-core.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const optVal = (flag, dft) => {
  const i = argv.indexOf(flag)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dft
}

const CHECK_ONLY = has('--check-only')
const FORCE = has('--force')
const QUIET = has('--quiet')
const dbPath = resolve(optVal('--db', process.env.FORGE_DATA_DIR ? join(resolve(process.env.FORGE_DATA_DIR), 'app.db') : join(ROOT, 'data', 'app.db')))
const kbDir = resolve(optVal('--content', join(ROOT, 'content', 'knowledge')))

const say = (...a) => { if (!QUIET) console.log(...a) }
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex')

/** 递归收集 md，跳过 _stale/（隔离区不入库）与隐藏目录 */
function walk(dir, out = []) {
  let ents
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of ents) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === '_stale' || e.name.startsWith('.')) continue
      walk(p, out)
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) out.push(p)
  }
  return out
}

/** 建表 + 加列迁移（与主进程共用 schema.mjs；重复执行安全） */
function ensureSchema(db) {
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=4000;`)
  for (const stmt of DDL_STATEMENTS) {
    try { db.exec(stmt) } catch (e) {
      // FTS 虚拟表已存在时重复 CREATE 会报错，其余照抛
      if (!/already exists/i.test(String(e?.message))) throw e
    }
  }
  for (const stmt of MIGRATION_STATEMENTS) {
    try { db.exec(stmt) } catch (e) {
      if (!/duplicate column name/i.test(String(e?.message))) throw e
    }
  }
}

const log = !CHECK_ONLY && !QUIET

if (!existsSync(kbDir)) {
  console.error(`✗ 找不到知识目录：${kbDir}`)
  process.exit(1)
}
if (!CHECK_ONLY) {
  mkdirSync(dirname(dbPath), { recursive: true })
} else if (!existsSync(dbPath)) {
  say(`· 库不存在（${dbPath}），--check-only 只做文件级校验`)
}

const db = new DatabaseSync(dbPath)
ensureSchema(db)

const validIds = new Set(db.prepare(`SELECT id FROM nodes`).all().map((r) => r.id))
// path → 该行现状（快路径判定与「先删后插」都要用）
const stored = new Map(
  db.prepare(`SELECT rowid,path,node_id,hash,quality_flags FROM knowledge`)
    .all()
    .map((r) => [r.path, { rowid: r.rowid, node_id: r.node_id, hash: r.hash, quality_flags: r.quality_flags ?? '[]' }])
)
const files = walk(kbDir)
const seenPaths = new Set()

const stats = { added: 0, updated: 0, removed: 0, skipped: 0, problems: [] }
const scanCacheKey = '***'
const scanCache = (() => {
  try { return JSON.parse(db.prepare(`SELECT value FROM meta WHERE key=?`).get(scanCacheKey)?.value ?? '{}') } catch { return {} }
})()
const nextCache = {}

/** FTS 触发器缺席时手工补一份索引（与 services/knowledge.ts 同样的兜底策略） */
const triggersPresent = !!db.prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_kfts_ins'`).get()

/** 把一篇解析好的文档写进 knowledge(+sources+FTS)。flags 由调用方传入，避免旁路变量 */
function writeRow(rel, meta, sections, bodyMd, hash, flags, prev) {
  const nodeId = String(meta.node ?? '').trim()
  const title = String(meta.title ?? '').trim() || nodeId
  const summary = summaryOf(sections)
  // 写分词串而非原文：unicode61 会把连续中文当一个 token，不分词则中文检索全部落空（与 knowledge.ts 同口径）
  const searchText = tokenizeForSearch([title, summary, bodyMd].filter(Boolean).join('\n'))
  const confidence = ['high', 'medium', 'low'].includes(String(meta.confidence)) ? String(meta.confidence) : 'medium'
  const reviewed = meta.reviewed === true ? 1 : 0
  const generator = meta.generator == null ? null : String(meta.generator)
  const updatedAt = meta.updated == null ? null : String(meta.updated)
  const words = wordCountOf(bodyMd)

  const conflict = db.prepare(`SELECT path FROM knowledge WHERE node_id=? AND path<>?`).get(nodeId, rel)
  if (conflict) {
    stats.problems.push({ file: rel, nodeId, reason: 'duplicate-node-id', detail: [`已被 ${conflict.path} 占用`] })
    return false
  }
  db.exec('BEGIN')
  try {
    if (prev) {
      // 先取旧值（external-content FTS 的 'delete' 命令必须喂旧文本），再删主表行
      const old = db.prepare(`SELECT rowid,title,summary,search_text FROM knowledge WHERE rowid=?`).get(prev.rowid)
      db.prepare(`DELETE FROM knowledge WHERE node_id=? OR path=?`).run(nodeId, rel)
      db.prepare(`DELETE FROM knowledge_sources WHERE node_id IN (?,?)`).run(nodeId, prev.node_id)
      if (!triggersPresent && old) {
        db.prepare(`INSERT INTO knowledge_fts(knowledge_fts,rowid,title,summary,search_text) VALUES('delete',?,?,?,?,?)`)
          .run(Number(old.rowid), old.title ?? '', old.summary ?? '', old.search_text ?? '')
      }
    }
    db.prepare(`INSERT INTO knowledge(node_id,path,title,body_md,summary,search_text,hash,confidence,reviewed,generator,word_count,quality_flags,updated_at,indexed_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'))`)
      .run(nodeId, rel, title, bodyMd, summary, searchText, hash, confidence, reviewed, generator, words,
        JSON.stringify(flags), updatedAt)
    if (!triggersPresent) {
      const rowid = db.prepare(`SELECT rowid FROM knowledge WHERE node_id=?`).get(nodeId)?.rowid
      db.prepare(`INSERT INTO knowledge_fts(rowid,title,summary,search_text) VALUES(?,?,?,?)`)
        .run(Number(rowid), title, summary, searchText)
    }
    for (const s of Array.isArray(meta.sources) ? meta.sources : []) {
      if (!s || !s.url) continue
      db.prepare(`INSERT INTO knowledge_sources(node_id,url,title,kind,fetched_at,trust,snippet) VALUES(?,?,?,?,?,?,?)`)
        .run(nodeId, String(s.url), s.title ?? null, s.kind ?? null, s.fetched_at ?? null,
          Number.isFinite(Number(s.trust)) ? Number(s.trust) : 0.5, s.snippet ?? null)
    }
    db.exec('COMMIT')
    return true
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

for (const abs of files) {
  const rel = relative(kbDir, abs).replace(/\\/g, '/')
  seenPaths.add(rel)
  let st
  try { st = statSync(abs) } catch { continue }
  const tag = `${st.size}:${st.mtimeMs}`
  const prev = stored.get(rel)

  // 快路径：stat 与上次一致 + 库里在 + 上次没有质量标记 → 连文件都不读
  const cleanInDb = prev && (prev.quality_flags ?? '[]') === '[]'
  if (!FORCE && prev && cleanInDb && scanCache[rel] === tag) {
    stats.skipped++
    nextCache[rel] = tag
    continue
  }

  let text
  try { text = readFileSync(abs, 'utf8') } catch (e) {
    stats.problems.push({ file: rel, nodeId: '', reason: 'read-error', detail: [String(e?.message ?? e)] })
    continue
  }
  const hash = sha256(text)
  if (!FORCE && prev && prev.hash === hash && cleanInDb) {
    stats.skipped++
    nextCache[rel] = tag
    continue
  }

  const { meta, sections, bodyMd } = parseKnowledgeMd(text)
  const qc = qualityCheck({ meta, sections, bodyMd }, validIds)
  if (!qc.ok) {
    stats.problems.push({ file: rel, nodeId: String(meta.node ?? ''), reason: 'quality-gate', detail: qc.flags })
    // 不合格正文照样入库（带 quality_flags），应用里能看到「这篇有问题」；
    // 但 CLI 退出码非 0，逼着铺量流程要么修好、要么挪进 _stale/。
    if (!CHECK_ONLY) {
      try { writeRow(rel, meta, sections, bodyMd, hash, qc.flags, prev); stats[prev ? 'updated' : 'added']++ } catch (e) {
        stats.problems.push({ file: rel, nodeId: String(meta.node ?? ''), reason: 'write-error', detail: [String(e?.message ?? e)] })
      }
    }
    nextCache[rel] = tag
    continue
  }
  if (CHECK_ONLY) {
    stats[prev ? 'updated' : 'added']++
    nextCache[rel] = tag
    continue
  }
  try {
    writeRow(rel, meta, sections, bodyMd, hash, qc.flags, prev)
    stats[prev ? 'updated' : 'added']++
    nextCache[rel] = tag
  } catch (e) {
    stats.problems.push({ file: rel, nodeId: String(meta.node ?? ''), reason: 'write-error', detail: [String(e?.message ?? e)] })
  }
}

// 文件消失 → 删行（--check-only 不动库）
if (!CHECK_ONLY) {
  for (const r of db.prepare(`SELECT node_id,path FROM knowledge`).all()) {
    if (seenPaths.has(r.path)) continue
    db.exec('BEGIN')
    try {
      db.prepare(`DELETE FROM knowledge_sources WHERE node_id=?`).run(r.node_id)
      db.prepare(`DELETE FROM knowledge WHERE node_id=?`).run(r.node_id)
      db.exec('COMMIT')
      stats.removed++
    } catch (e) { db.exec('ROLLBACK'); throw e }
  }
  db.prepare(`INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
    .run(scanCacheKey, JSON.stringify(nextCache))
}

/* ---------------- 报告 ---------------- */

const passed = files.filter((abs) => {
  const rel = relative(kbDir, abs).replace(/\\/g, '/')
  return !stats.problems.some((p) => p.file === rel)
})
say(`知识索引${CHECK_ONLY ? '（--check-only，未写库）' : ''}：库=${dbPath}`)
say(`  目录=${kbDir}`)
say(`  扫描 ${files.length} 篇｜新增 ${stats.added}｜更新 ${stats.updated}｜删除 ${stats.removed}｜跳过 ${stats.skipped}`)
say(`  通过质量闸门 ${passed.length}/${files.length}`)
const totalRow = db.prepare(`SELECT COUNT(*) n FROM knowledge`).get()
say(`  库内知识条目：${totalRow.n}`)

// 索引自检（只在真写库后跑）：证明「中文确实搜得到」，而且搜到的是对的那一篇。
// 探针词表不写死语料内容，而是从库里现取——铺量前后、压测夹具、真实讲义都适用。
if (!CHECK_ONLY && totalRow.n > 0) {
  const count = (m) => db.prepare(`SELECT COUNT(*) n FROM knowledge_fts WHERE knowledge_fts MATCH ?`).get(m)?.n ?? 0
  const rank = (m, want, limit = 25) => {
    const rows = db.prepare(`SELECT k.node_id FROM knowledge_fts JOIN knowledge k ON k.rowid=knowledge_fts.rowid
                             WHERE knowledge_fts MATCH ? ORDER BY bm25(knowledge_fts,12.0,6.0,1.0) LIMIT ?`).all(m, limit)
    const at = rows.findIndex((r) => r.node_id === want)
    return { n: rows.length, at }
  }

  // ① 术语存在性探针：只测「已经出现在标题/摘要里」的术语，语料变了也不会假报错
  const TERMS = ['懒代理', '编译器', 'nextTick', 'PatchFlag']
  const termProbe = []
  for (const t of TERMS) {
    const exists = !!db.prepare(`SELECT 1 FROM knowledge WHERE title LIKE ? OR summary LIKE ? LIMIT 1`).get(`%${t}%`, `%${t}%`)
    if (!exists) continue
    const built = buildFtsMatch(t)
    if (!built) { stats.problems.push({ file: '(FTS)', nodeId: '', reason: `probe-empty:${t}`, detail: ['分词后没有有效 token'] }); continue }
    let strict = -1
    let n = 0
    try { strict = built.matchStrict ? count(built.matchStrict) : -1; n = Math.max(count(built.match), strict) } catch (e) {
      stats.problems.push({ file: '(FTS)', nodeId: '', reason: `probe-error:${t}`, detail: [String(e?.message ?? e)] }); continue
    }
    termProbe.push(`${t}→${n}${strict >= 0 ? `(严${strict})` : ''}`)
    if (n <= 0) stats.problems.push({ file: '(FTS)', nodeId: '', reason: `probe-miss:${t}`, detail: ['正文里有这个词但 FTS 命中 0 条 → 多半是 search_text 存成了原文'] })
  }
  if (termProbe.length) say(`  FTS 术语探针：${termProbe.join('　')}`)

  // ② 标题回查：抽三篇（首/中/尾），用它们的完整标题去搜，必须在前 25 名里能找回自己。
  // 用 OFFSET 而不是 rowid 取样：反复删插之后 rowid 会跳号，按 rowid 取可能一条都取不到。
  const pick = (offset) => db.prepare(`SELECT node_id,title FROM knowledge ORDER BY rowid LIMIT 1 OFFSET ?`).get(offset)
  const sampleIds = Array.from(new Set([pick(0), pick(Math.floor(totalRow.n / 2)), pick(totalRow.n - 1)].filter(Boolean).map((s) => s.node_id)))
    .map((id) => db.prepare(`SELECT node_id,title FROM knowledge WHERE node_id=?`).get(id))
  const selfProbe = []
  for (const s of sampleIds) {
    const built = buildFtsMatch(s.title)
    if (!built) continue
    try {
      const strict = built.matchStrict ? rank(built.matchStrict, s.node_id) : null
      const loose = rank(built.match, s.node_id)
      const best = strict && strict.at >= 0 ? strict : loose
      selfProbe.push(`${s.node_id}${best.at >= 0 ? `@${best.at + 1}` : '✗未命中'}`)
      if (best.at < 0) {
        stats.problems.push({ file: '(FTS)', nodeId: s.node_id, reason: 'self-probe-miss',
          detail: [`用标题「${String(s.title).slice(0, 40)}」搜不回自己（严格档 ${strict?.n ?? '-'} 条 / 宽松档 ${loose.n} 条）`] })
      }
    } catch (e) {
      stats.problems.push({ file: '(FTS)', nodeId: s.node_id, reason: 'self-probe-error', detail: [String(e?.message ?? e)] })
    }
  }
  if (selfProbe.length) say(`  标题回查：${selfProbe.join('　')}`)
}

if (stats.problems.length) {
  console.error(`\n✗ 问题 ${stats.problems.length} 条：`)
  for (const p of stats.problems.slice(0, 40)) {
    console.error(`  · ${p.file}${p.nodeId ? ` [${p.nodeId}]` : ''} — ${p.reason}`)
    for (const d of p.detail) console.error(`      ${d}`)
  }
  if (stats.problems.length > 40) console.error(`  …另有 ${stats.problems.length - 40} 条`)
  db.close()
  process.exit(1)
}

log && say('✓ 全部通过')
db.close()
process.exit(0)
