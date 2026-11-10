// 题库导入核心：content/**.json → SQLite。Electron 主进程与 CLI 共用这一份实现。
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const walk = (dir, out = []) => {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith('.json')) out.push(p)
  }
  return out
}
const readJson = (p) => {
  const raw = readFileSync(p, 'utf8').replace(/^\uFEFF/, '')
  try { return JSON.parse(raw) } catch (e) { throw new Error(`${relative(process.cwd(), p).replace(/\\/g, '/')} JSON 解析失败: ${e.message}`) }
}
const listOf = (data) => (Array.isArray(data) ? data : Array.isArray(data?.nodes) ? data.nodes : Array.isArray(data?.questions) ? data.questions : Array.isArray(data?.variants) ? data.variants : null)

export function seedContent(db, contentRoot, { log = () => {}, replace = true } = {}) {
  const stats = { nodes: 0, questions: 0, variants: 0, edges: 0, skipped: [] }
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ')

  if (replace) {
    db.exec('DELETE FROM edges; DELETE FROM questions; DELETE FROM nodes;')
  }

  // ---------- 1. 节点 ----------
  const nodeStmt = db.prepare(
    `INSERT INTO nodes(id,parent,title,level,domain,stack,topic,summary,est_minutes,must_master,threshold,locked_by_default,ord,status)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET title=excluded.title,summary=excluded.summary,est_minutes=excluded.est_minutes,
       must_master=excluded.must_master,threshold=excluded.threshold,ord=excluded.ord,status=excluded.status`
  )
  const masteryStmt = `INSERT OR IGNORE INTO node_mastery(node_id) VALUES(?)`
  const nodeIds = new Set()
  let ord = 0
  for (const file of walk(join(contentRoot, 'nodes'))) {
    const list = listOf(readJson(file))
    if (!list) { log(`跳过节点文件（格式不符）${file}`); continue }
    for (const n of list) {
      if (!n?.id || !n.level) continue
      if (nodeIds.has(n.id)) { stats.skipped.push(`重复节点 ${n.id} @ ${file}`); continue }
      nodeIds.add(n.id)
      const segs = n.id.split('.')
      const parent = segs.length > 1 ? segs.slice(0, -1).join('.') : null
      nodeStmt.run(n.id, parent ?? n.parent ?? null, n.title, n.level, n.domain ?? segs[0], n.stack ?? segs[1] ?? null,
        n.topic ?? segs[2] ?? null, n.summary ?? null, n.estMinutes ?? n.est_minutes ?? 0,
        n.mustMaster ?? n.must_master ? 1 : 0, n.masteryThreshold ?? n.threshold ?? 2,
        n.lockedByDefault ?? n.locked_by_default ? 1 : 0, ++ord, n.status ?? 'active')
      db.prepare(masteryStmt).run(n.id)
      stats.nodes++
    }
  }

  // ---------- 2. 边（前置依赖 + 横向关联）----------
  const edgeStmt = db.prepare(`INSERT OR IGNORE INTO edges(from_id,to_id,type,weight) VALUES(?,?,?,?)`)
  for (const file of walk(join(contentRoot, 'nodes'))) {
    const list = listOf(readJson(file))
    if (!list) continue
    for (const n of list) {
      if (!n?.id) continue
      for (const pre of n.prerequisites || []) {
        if (!nodeIds.has(pre)) { stats.skipped.push(`节点 ${n.id} 的前置 ${pre} 不存在`); continue }
        edgeStmt.run(pre, n.id, 'prereq', 1); stats.edges++
      }
      for (const rel of n.related || []) {
        if (!nodeIds.has(rel)) continue
        edgeStmt.run(n.id, rel, 'related', 0.5); stats.edges++
      }
    }
  }
  // level 之间的父子边（图谱渲染用）
  const parentEdge = db.prepare(`INSERT OR IGNORE INTO edges(from_id,to_id,type,weight) SELECT id,parent,'contains',1 FROM nodes WHERE parent IS NOT NULL`)
  parentEdge.run(); stats.edges += 1

  // ---------- 3. 题目 ----------
  const qStmt = db.prepare(
    `INSERT INTO questions(id,node_id,parent_id,angle,type,difficulty,data,status,open_book,source_kind,tags,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET node_id=excluded.node_id,type=excluded.type,difficulty=excluded.difficulty,
       data=excluded.data,status=excluded.status,open_book=excluded.open_book,source_kind=excluded.source_kind,
       tags=excluded.tags,updated_at=excluded.updated_at`
  )
  const srsInit = `INSERT OR IGNORE INTO srs(question_id) VALUES(?)`
  const seenQ = new Set()

  const putQuestion = (q, opts = {}) => {
    if (!q?.id || !q.stem || !q.type) return
    if (!q.nodeId || !nodeIds.has(q.nodeId)) { stats.skipped.push(`题目 ${q.id} 的 nodeId=${q.nodeId} 不存在，已跳过`); return }
    if (seenQ.has(q.id)) { stats.skipped.push(`重复题目 id ${q.id}`); return }
    seenQ.add(q.id)
    qStmt.run(q.id, q.nodeId, q.parentId ?? opts.parentId ?? null, q.angle ?? opts.angle ?? null, q.type,
      q.difficulty ?? 2, JSON.stringify(q), q.status ?? 'active',
      q.openBookAllowed === false ? 0 : 1, q.source?.kind ?? 'self-authored',
      JSON.stringify(q.tags ?? []), q.meta?.created ?? now, now)
    db.prepare(srsInit).run(q.id)
    if (opts.angle) stats.variants++; else stats.questions++
  }

  for (const file of walk(join(contentRoot, 'questions'))) {
    const list = listOf(readJson(file))
    if (!list) { log(`跳过题目文件（格式不符）${file}`); continue }
    for (const q of list) {
      putQuestion(q)
      for (const v of q.variants || []) putQuestion({ ...v, id: `${q.id}-V${v.angle ? '' : ''}${v.id ?? Math.random().toString(36).slice(2, 6)}`, parentId: q.id, nodeId: v.nodeId ?? q.nodeId, angle: v.angle ?? '换问法' })
    }
  }
  for (const file of walk(join(contentRoot, 'variants'))) {
    const list = listOf(readJson(file))
    if (!list) continue
    for (const v of list) putQuestion({ ...v, angle: v.angle ?? '换问法', parentId: v.parentId }, { parentId: v.parentId, angle: v.angle ?? '换问法' })
  }

  db.prepare(`UPDATE meta SET value=? WHERE key='seed_stats'`).run(JSON.stringify(stats))
  return stats
}

/** 把 content 目录整体灌进 db（含建表由调用方负责） */
export function seedDatabase(db, contentRoot, opts) {
  return seedContent(db, contentRoot, opts)
}
