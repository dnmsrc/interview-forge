import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { all, get, run, tx, settingGet, settingSet, contentRoot } from '../db'
import {
  parseKnowledgeMd, tokenizeForSearch, buildFtsMatch, qualityCheck, summaryOf, wordCountOf, extractWikilinks
} from '../../shared/knowledge-core.mjs'

/**
 * 知识正文索引服务（契约 docs/design/KNOWLEDGE-SYSTEM.md §2）。
 *
 * 源文件在 content/knowledge 下任意层级的 .md，本服务只做三件事：
 *   1) syncFromFiles()：按 hash 增量同步到 knowledge / knowledge_sources / knowledge_fts；
 *   2) 读与检索：getKnowledge / searchKnowledge（FTS5 + bm25）；
 *   3) saveKnowledgeDraft()：AI 起草后落盘并立即重建该行索引。
 * 解析、分词、质量闸门全部来自 src/shared/knowledge-core.mjs（与 CLI 共用同一套规则）。
 */

/* ---------------- 类型（渲染层在 src/shared/api.ts 里有同名声明） ---------------- */

export interface KnowledgeSourceRow {
  url: string; title: string | null; kind: string | null; fetched_at: string | null; trust: number; snippet: string | null
}
export interface KnowledgeEntry {
  nodeId: string; title: string; summary: string; bodyMd: string; sources: KnowledgeSourceRow[]
  confidence: string; reviewed: boolean; wordCount: number; qualityFlags: string[]
  updatedAt: string | null; indexedAt: string | null; missing: boolean
}
export interface KnowledgeSearchHit {
  nodeId: string; title: string; summary: string; confidence: string; score: number
  masteryLevel: number; lit: number; stale: number; fragment: string; matchedTerms: string[]
}
export interface KnowledgeProblem { file: string; nodeId: string; reason: string; detail: string[] }
export interface KnowledgeSyncStats {
  added: number; updated: number; removed: number; skipped: number; problems: KnowledgeProblem[]
}
export interface KnowledgeStatus {
  total: number; nodesTotal: number; covered: number; missingBody: number;
  byConfidence: Record<string, number>; flagged: number; problems: number;
  lastIndexedAt: string | null; contentDir: string; filesScanned: number
}

/* ---------------- 工具 ---------------- */

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
const nowIso = () => new Date().toISOString().replace('T', ' ').slice(0, 19)

/** 正文里出现过的双链目标（校验用），以及该考点自身（自链也算断链的一种） */
function validNodeIdSet(): Set<string> {
  return new Set(all<{ id: string }>(`SELECT id FROM nodes`).map((r) => r.id))
}

/** 递归收集 content/knowledge 下的 md，跳过 `_stale/`（隔离区不参与索引） */
function walkMarkdown(dir: string, out: string[] = []): string[] {
  let entries: import('node:fs').Dirent[]
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === '_stale' || e.name.startsWith('.')) continue
      walkMarkdown(p, out)
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
      out.push(p)
    }
  }
  return out
}

/** 扫描缓存：{ 相对路径: "字节数:mtimeMs:size" }，命中即跳过读文件与哈希（§2.3「只比 hash」的加速版） */
type ScanCache = Record<string, string>
const SCAN_CACHE_KEY = '***'

const statTag = (st: import('node:fs').Stats) => `${st.size}:${st.mtimeMs}`

/* ---------------- 单行索引写入 ---------------- */

interface RowResult { problem?: KnowledgeProblem }

/** 把一篇 md 写进 knowledge(+sources)，返回该行 rowid（FTS 触发器要求先删旧 sources） */
function upsertRow(absFile: string, rootDir: string, opts: { validIds: Set<string>; force: boolean }): RowResult {
  const relPath = relative(rootDir, absFile).replace(/\\/g, '/')
  const text = readFileSync(absFile, 'utf8')
  const hash = sha256(text)
  const existing = get<{ rowid: number; hash: string; node_id: string; title: string; summary: string | null; search_text: string }>(
    `SELECT rowid,hash,node_id,title,summary,search_text FROM knowledge WHERE path=?`, [relPath])
  if (!opts.force && existing && existing.hash === hash) return {}

  const { meta, sections, bodyMd } = parseKnowledgeMd(text)
  const nodeId = String(meta.node ?? '').trim()
  const title = String(meta.title ?? '').trim()
  const parsed = { meta, sections, bodyMd }
  const qc = qualityCheck(parsed, opts.validIds)
  const summary = summaryOf(sections)
  const words = wordCountOf(bodyMd)
  // 必须写「分词串」而不是原文：FTS5 的 unicode61 会把连续中文当成一个 token，
  // 原文入库后单字/二字词（代理、懒代）全部 MATCH 不到。tokenizeForSearch 产出
  // CJK 单字 + 相邻 bigram + 拉丁整词，查询端走同一个函数，两端口径一致才能命中。
  const searchText = tokenizeForSearch([title, summary, bodyMd].filter(Boolean).join('\n'))
  const confidence = ['high', 'medium', 'low'].includes(String(meta.confidence)) ? String(meta.confidence) : 'medium'
  const reviewed = meta.reviewed === true || meta.reviewed === 'true' ? 1 : 0
  const generator = meta.generator == null ? null : String(meta.generator)
  const updatedAt = meta.updated == null ? null : String(meta.updated)
  const flagsJson = JSON.stringify(qc.flags)

  // node_id 冲突（两个文件声明同一个 node）：保留 hash 变了的那个，另一个报问题
  const conflict = get<{ path: string }>(`SELECT path FROM knowledge WHERE node_id=? AND path<>?`, [nodeId, relPath])
  if (conflict) {
    return { problem: { file: relPath, nodeId, reason: 'duplicate-node-id', detail: [`已被 ${conflict.path} 占用`] } }
  }

  // 事务包裹：external-content FTS 最怕「主表写了、索引没同步」的半途中断
  const prevNodeId = existing?.node_id
  tx(() => {
    if (existing) {
      // 同 node 换 path、或 path 不变但内容变了：都先删旧行（触发器会顺带清 FTS），
      // 再插新行。若文件的 node 归属改过，旧 node_id 那一行也必须删掉，否则留孤儿。
      run(`DELETE FROM knowledge WHERE node_id=? OR path=?`, [nodeId, relPath])
      run(`DELETE FROM knowledge_sources WHERE node_id IN (?, ?)`, [nodeId, prevNodeId ?? ''])
      if (!ftsTriggersPresent()) {
        run(`INSERT INTO knowledge_fts(knowledge_fts,rowid,title,summary,search_text) VALUES('delete',?,?,?,?)`,
          [existing.rowid ?? 0, existing.title ?? prevNodeId ?? '', existing.summary ?? '', existing.search_text ?? ''])
      }
    }
    run(`INSERT INTO knowledge(node_id,path,title,body_md,summary,search_text,hash,confidence,reviewed,generator,word_count,quality_flags,updated_at,indexed_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'))
         ON CONFLICT(node_id) DO UPDATE SET
           path=excluded.path, title=excluded.title, body_md=excluded.body_md, summary=excluded.summary,
           search_text=excluded.search_text, hash=excluded.hash, confidence=excluded.confidence,
           reviewed=excluded.reviewed, generator=excluded.generator, word_count=excluded.word_count,
           quality_flags=excluded.quality_flags, updated_at=excluded.updated_at,
           indexed_at=datetime('now','localtime')`,
      [nodeId, relPath, title || nodeId, bodyMd, summary, searchText, hash, confidence, reviewed, generator, words, flagsJson, updatedAt])
    // 触发器缺席时才手工补 FTS（有触发器时再手工插一遍会导致重复命中）
    if (!ftsTriggersPresent()) {
      const kid = get<{ rowid: number | string }>(`SELECT rowid FROM knowledge WHERE node_id=?`, [nodeId])?.rowid
      if (kid != null) {
        run(`INSERT INTO knowledge_fts(rowid,title,summary,search_text) VALUES(?,?,?,?)`,
          [Number(kid), title || nodeId, summary, searchText])
      }
    }
    const sources = Array.isArray(meta.sources) ? meta.sources : []
    for (const s of sources) {
      if (!s || !s.url) continue
      run(`INSERT INTO knowledge_sources(node_id,url,title,kind,fetched_at,trust,snippet) VALUES(?,?,?,?,?,?,?)`,
        [nodeId, String(s.url), s.title == null ? null : String(s.title), s.kind == null ? null : String(s.kind),
          s.fetched_at == null ? null : String(s.fetched_at),
          Number.isFinite(Number(s.trust)) ? Number(s.trust) : 0.5,
          s.snippet == null ? null : String(s.snippet)])
    }
  })

  if (!qc.ok) return { problem: { file: relPath, nodeId, reason: 'quality-gate', detail: qc.flags } }
  return {}
}

/* ---------------- 同步 ---------------- */

/**
 * 增量同步 content/knowledge → DB。
 * 快路径：stat 的 size+mtime 与扫描缓存一致 → 连文件都不读，直接 skipped；
 * 慢路径：读文件算 sha256，与库中 hash 比对，只有真变了才 upsert。
 * 5000 篇「无变化」场景实测远低于 1 秒（见 scripts/qa/kb-perf.mjs）。
 */
export function syncFromFiles(opts: { force?: boolean } = {}): KnowledgeSyncStats {
  const rootDir = knowledgeRoot()
  const stats: KnowledgeSyncStats = { added: 0, updated: 0, removed: 0, skipped: 0, problems: [] }
  const validIds = validNodeIdSet()
  const cache: ScanCache = (settingGet<ScanCache>(SCAN_CACHE_KEY) ?? {}) as ScanCache
  const nextCache: ScanCache = {}
  const seen = new Set<string>()
  const force = !!opts.force

  const files = existsSync(rootDir) ? walkMarkdown(resolve(rootDir)) : []
  // path → { hash, clean }：clean=false（上次带 quality_flags）的文件每次都要重新过闸门，
  // 这样不合格正文即使没改动，也会持续被报出来而不是被静默缓存。
  const dbRows = new Map<string, { hash: string; clean: boolean }>(
    all<{ path: string; hash: string; quality_flags: string | null }>(`SELECT path,hash,quality_flags FROM knowledge`)
      .map((r) => [r.path, { hash: r.hash, clean: (r.quality_flags ?? '[]') === '[]' }])
  )

  for (const abs of files) {
    const relPath = relative(rootDir, abs).replace(/\\/g, '/')
    seen.add(relPath)
    let st: import('node:fs').Stats
    try { st = statSync(abs) } catch { continue }
    const tag = statTag(st)
    const prev = dbRows.get(relPath)
    const prevHash = prev?.hash
    const clean = prev?.clean === true

    // 快路径：文件没动过、库里也有、且上次已过闸门 → 连文件都不读
    if (!force && prevHash && clean && cache[relPath] === tag) {
      stats.skipped++
      nextCache[relPath] = tag
      continue
    }

    let text: string
    try { text = readFileSync(abs, 'utf8') } catch (e: any) {
      stats.problems.push({ file: relPath, nodeId: '', reason: 'read-error', detail: [String(e?.message ?? e)] })
      continue
    }
    const hash = sha256(text)
    if (!force && prevHash && clean && prevHash === hash) {
      stats.skipped++
      nextCache[relPath] = tag
      continue
    }

    const res = upsertRow(abs, rootDir, { validIds, force })
    if (res.problem) {
      stats.problems.push(res.problem)
    } else {
      if (prevHash) stats.updated++
      else stats.added++
    }
    nextCache[relPath] = tag
    dbRows.set(relPath, { hash, clean: !res.problem })
  }

  // 文件消失 → 删行（knowledge 的 DELETE 触发器会同步清 FTS）
  for (const row of all<{ node_id: string; path: string }>(`SELECT node_id,path FROM knowledge`)) {
    if (seen.has(row.path)) continue
    tx(() => {
      run(`DELETE FROM knowledge_sources WHERE node_id=?`, [row.node_id])
      run(`DELETE FROM knowledge WHERE node_id=?`, [row.node_id])
    })
    stats.removed++
    delete nextCache[row.path]
  }

  settingSet(SCAN_CACHE_KEY, nextCache)
  return stats
}

/** content/knowledge 根目录（打包后由 contentRoot() 指向 resources/content） */
export function knowledgeRoot(): string {
  return join(contentRoot(), 'knowledge')
}

/**
 * external-content FTS 平时靠 schema.mjs 里的三个触发器同步；
 * 老库若缺触发器（或被人手工删了），就退化为服务内手工维护，避免搜索结果悬空。
 */
let _triggersOk: boolean | null = null
function ftsTriggersPresent(): boolean {
  if (_triggersOk !== null) return _triggersOk
  _triggersOk = !!get<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_kfts_ins'`
  )
  return _triggersOk
}

/* ---------------- 读取 ---------------- */

/** 取一个考点的知识正文；未收录时返回 missing:true（前端要区分「未收录」和「出错」） */
export function getKnowledge(nodeId: string): KnowledgeEntry {
  const id = String(nodeId ?? '')
  const row = get<{
    node_id: string; title: string; summary: string | null; body_md: string; confidence: string;
    reviewed: number; word_count: number; quality_flags: string | null; updated_at: string | null; indexed_at: string | null
  }>(`SELECT node_id,title,summary,body_md,confidence,reviewed,word_count,quality_flags,updated_at,indexed_at
       FROM knowledge WHERE node_id=?`, [id])
  if (!row) {
    const title = get<{ title: string }>(`SELECT title FROM nodes WHERE id=?`, [id])?.title ?? id
    return {
      nodeId: id, title, summary: '', bodyMd: '', sources: [], confidence: 'unknown', reviewed: false,
      wordCount: 0, qualityFlags: [], updatedAt: null, indexedAt: null, missing: true
    }
  }
  let flags: string[] = []
  try { flags = JSON.parse(row.quality_flags ?? '[]') } catch { /* 脏数据当无标记 */ }
  return {
    nodeId: row.node_id,
    title: row.title,
    summary: row.summary ?? '',
    bodyMd: row.body_md ?? '',
    sources: all<KnowledgeSourceRow>(
      `SELECT url,title,kind,fetched_at,trust,snippet FROM knowledge_sources WHERE node_id=? ORDER BY id`, [id]
    ).map((s) => ({ url: s.url, title: s.title, kind: s.kind, fetched_at: s.fetched_at, trust: s.trust, snippet: s.snippet })),
    confidence: row.confidence,
    reviewed: row.reviewed === 1,
    wordCount: row.word_count ?? 0,
    qualityFlags: flags,
    updatedAt: row.updated_at,
    indexedAt: row.indexed_at,
    missing: false
  }
}

/* ---------------- 检索 ---------------- */

/** 高亮片段用的词表由 buildFtsMatch 给出；FTS5 转义本身在 knowledge-core 里 */

/** 在原文里定位命中词，拼带 <mark> 的高亮片段（存进 FTS 的是分词串，不能用 snippet()） */
function buildFragment(body: string, terms: string[]): string {
  const text = String(body ?? '')
  const lower = text.toLowerCase()
  let pos = -1
  let hitTerm = ''
  for (const t of terms) {
    if (t.length < 1) continue
    const i = lower.indexOf(t)
    if (i >= 0 && (pos < 0 || i < pos)) { pos = i; hitTerm = t }
  }
  if (pos < 0) return text.slice(0, 160).replace(/\s+/g, ' ').trim()
  const start = Math.max(0, pos - 70)
  const end = Math.min(text.length, pos + 190)
  let frag = text.slice(start, end).replace(/\s+/g, ' ').trim()
  const lo = frag.toLowerCase()
  const merged: { i: number; j: number }[] = []
  for (const t of terms) {
    if (!t) continue
    let k = lo.indexOf(t)
    while (k >= 0) { merged.push({ i: k, j: k + t.length }); k = lo.indexOf(t, k + t.length) }
  }
  merged.sort((a, b) => a.i - b.i)
  let out = ''
  let cursor = 0
  for (const span of merged) {
    if (span.i < cursor) continue
    out += frag.slice(cursor, span.i) + '<mark>' + frag.slice(span.i, span.j) + '</mark>'
    cursor = span.j
  }
  out += frag.slice(cursor)
  return (start > 0 ? '…' : '') + out + (end < text.length ? '…' : '')
}

type FtsRow = {
  node_id: string; title: string; summary: string | null; body_md: string; confidence: string;
  score: number; mastery_level: number | null; lit: number | null; stale: number | null
}

const FTS_SQL = `SELECT k.node_id,k.title,k.summary,k.body_md,k.confidence,
        bm25(knowledge_fts, 12.0, 6.0, 1.0) AS score,
        m.mastery_level, COALESCE(m.lit,0) lit, COALESCE(m.stale,0) stale
   FROM knowledge_fts
   JOIN knowledge k ON k.rowid = knowledge_fts.rowid
   LEFT JOIN node_mastery m ON m.node_id = k.node_id
  WHERE knowledge_fts MATCH ?
  ORDER BY score LIMIT ?`

/** 跑一轮 MATCH；exclude 里的 node 直接跳过（strict 档已收录的不再重复出现在 loose 档） */
function runFts(match: string, cap: number, exclude: Set<string>): FtsRow[] {
  const rows = all<FtsRow>(FTS_SQL, [match, cap + exclude.size])
  const out: FtsRow[] = []
  for (const r of rows) {
    if (exclude.has(r.node_id)) continue
    out.push(r)
    if (out.length >= cap) break
  }
  return out
}

/**
 * 全文检索。两档策略（表达式都由 knowledge-core 的 buildFtsMatch 生成，CLI 探针共用同一份）：
 *   第一档 matchStrict —— 词内只要求「二字组合 / 拉丁整词」命中，精度高，排前面；
 *   第二档 match       —— 放宽到单字（召回），只补第一档没占满的名额，并且一律排在后面。
 * 排序用 bm25()，三个权重对应 knowledge_fts 的三列 (title, summary, search_text)：
 * 标题命中最值钱、摘要次之、正文最低。bm25 值越小越相关，取反后「越大越好」。
 */
export function searchKnowledge(q: string, limit = 20): KnowledgeSearchHit[] {
  const raw = String(q ?? '').trim()
  if (!raw) return []
  const cap = Math.max(1, Math.min(100, Number(limit) || 20))
  const built = buildFtsMatch(raw)
  if (!built) return []

  const toHit = (r: FtsRow, terms: string[], score: number): KnowledgeSearchHit => ({
    nodeId: r.node_id,
    title: r.title,
    summary: r.summary ?? '',
    confidence: r.confidence,
    score,
    masteryLevel: r.mastery_level ?? 0,
    lit: r.lit ?? 0,
    stale: r.stale ?? 0,
    fragment: buildFragment(r.body_md, terms),
    matchedTerms: terms
  })

  try {
    const hits: KnowledgeSearchHit[] = []
    const seen = new Set<string>()

    if (built.matchStrict) {
      for (const r of runFts(built.matchStrict, cap, seen)) {
        seen.add(r.node_id)
        hits.push(toHit(r, built.strictTerms, -Number(r.score)))
      }
    }

    if (hits.length < cap) {
      // 已有第一档结果时，第二档一律接在后面（分数递减），避免两档 bm25 不可比导致乱序
      const floor = hits.length ? Math.min(...hits.map((h) => h.score)) : 0
      let extra = 0
      for (const r of runFts(built.match, cap, seen)) {
        seen.add(r.node_id)
        extra++
        hits.push(toHit(r, built.terms, hits.length && built.matchStrict ? floor - extra / 1000 : -Number(r.score)))
        if (hits.length >= cap) break
      }
    }
    return hits
  } catch {
    // 极端输入会让 MATCH 语法报错，退化成 LIKE 兜底而不是把异常抛给渲染层
    const like = `%${raw.replace(/[%_]/g, '')}%`
    const likeTerms = raw.split(/[\s,，。、;；]+/).map((w) => w.toLowerCase()).filter(Boolean)
    const rows = all<FtsRow>(
      `SELECT k.node_id,k.title,k.summary,k.body_md,k.confidence,m.mastery_level,
              COALESCE(m.lit,0) lit, COALESCE(m.stale,0) stale, 0 AS score
         FROM knowledge k LEFT JOIN node_mastery m ON m.node_id=k.node_id
        WHERE k.title LIKE ? OR k.body_md LIKE ?
        ORDER BY k.node_id LIMIT ?`, [like, like, cap]
    )
    return rows.map((r) => toHit(r, likeTerms, 0))
  }
}

/* ---------------- 状态 ---------------- */

export function knowledgeStatus(): KnowledgeStatus {
  const total = get<{ n: number }>(`SELECT COUNT(*) n FROM knowledge`)?.n ?? 0
  const nodesTotal = get<{ n: number }>(`SELECT COUNT(*) n FROM nodes`)?.n ?? 0
  // 「缺正文」= 挂了题的 level4 考点里没有 knowledge 行的那些（铺量进度指标）
  const missingBody = get<{ n: number }>(
    `SELECT COUNT(*) n FROM nodes n
      WHERE n.level=4 AND NOT EXISTS (SELECT 1 FROM knowledge k WHERE k.node_id=n.id)`
  )?.n ?? 0
  const covered = get<{ n: number }>(
    `SELECT COUNT(DISTINCT q.node_id) n FROM questions q
      JOIN knowledge k ON k.node_id=q.node_id WHERE q.status='active'`
  )?.n ?? 0
  const byConfidence: Record<string, number> = {}
  for (const r of all<{ confidence: string; n: number }>(`SELECT confidence,COUNT(*) n FROM knowledge GROUP BY confidence`)) {
    byConfidence[r.confidence || 'unknown'] = r.n
  }
  const flagged = get<{ n: number }>(
    `SELECT COUNT(*) n FROM knowledge WHERE COALESCE(quality_flags,'[]') NOT IN ('[]','')`
  )?.n ?? 0
  const lastIndexedAt = get<{ t: string | null }>(`SELECT MAX(indexed_at) t FROM knowledge`)?.t ?? null
  const rootDir = knowledgeRoot()
  const filesScanned = existsSync(rootDir) ? walkMarkdown(resolve(rootDir)).length : 0
  return { total, nodesTotal, covered, missingBody, byConfidence, flagged, problems: flagged, lastIndexedAt, contentDir: rootDir, filesScanned }
}

/* ---------------- AI 起草落盘 ---------------- */

/** 正文里出现但不在 validIds 里的双链（AI 起草最容易编出不存在的节点） */
export function brokenLinksOf(md: string, validIds?: Set<string>): string[] {
  const ids = validIds ?? validNodeIdSet()
  return extractWikilinks(md).filter((id: string) => !ids.has(id))
}

/**
 * 保存草稿：写 content/knowledge/<域路径>/<文件名>.md 并立即重建该行索引。
 * 文件名默认按 node_id 推导（fe.vue.reactivity.proxify → fe/vue/reactivity.proxify.md），
 * 与 §2.1「文件名 = 考点 id」一致；可传 relPath 覆盖（AI 起草流程用）。
 */
export function saveKnowledgeDraft(nodeId: string, md: string, relPath?: string): { path: string; ok: boolean; flags: string[] } {
  const id = String(nodeId ?? '').trim()
  if (!id) throw new Error('saveKnowledgeDraft: 缺少 nodeId')
  const rootDir = resolve(knowledgeRoot())
  const guess = id.includes('.') ? id.split('.').slice(0, 2).join('/') + '/' + id.split('.').slice(2).join('.') + '.md' : `${id}.md`
  const rel = String(relPath ?? guess).replace(/\\/g, '/').replace(/^\/+/, '')
  if (!rel.endsWith('.md')) throw new Error('saveKnowledgeDraft: 文件名必须以 .md 结尾')
  const abs = join(rootDir, rel)
  if (!abs.startsWith(rootDir)) throw new Error('saveKnowledgeDraft: 路径越界')
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, md, 'utf8')

  // 立即 reindex 这一行（不等下次启动的轻量同步）
  const res = upsertRow(abs, rootDir, { validIds: validNodeIdSet(), force: true })
  const cache = (settingGet<ScanCache>(SCAN_CACHE_KEY) ?? {}) as ScanCache
  try {
    const st = statSync(abs)
    cache[relative(rootDir, abs).replace(/\\/g, '/')] = statTag(st)
    settingSet(SCAN_CACHE_KEY, cache)
  } catch { /* 写缓存失败不影响正文落盘 */ }

  const flags = res.problem ? res.problem.detail : []
  return { path: abs, ok: flags.length === 0, flags }
}
