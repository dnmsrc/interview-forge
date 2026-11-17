// 题库导入核心：content/**.json → SQLite。Electron 主进程与 CLI 共用这一份实现。
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { RELATION_META, GATE_TYPES, UNDIRECTED_TYPES, DIRECTED_TYPES, isRelationType } from '../src/shared/relations.ts'
import { buildQuestionIndexRow, QIDX_FIELDS } from '../src/shared/question-index-core.mjs'

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
    // question_index 是题目检索的派生缓存，跟着 content/ 一起重建；DELETE 会经触发器同步清空 question_fts
    db.exec('DELETE FROM question_index; DELETE FROM edges; DELETE FROM questions; DELETE FROM nodes;')
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
  // 节点元数据快照：关系自动归类需要 id/title/level/模块/主题，避免反复查库
  const nodeMeta = new Map()
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
      nodeMeta.set(n.id, {
        id: n.id, title: n.title ?? '', level: n.level,
        mod: segs.slice(0, 2).join('.'), topic: segs.slice(0, 3).join('.')
      })
      stats.nodes++
    }
  }

  // ---------- 2. 边（9 类关系本体，见 src/shared/relations.ts）----------
  // 旧 JSON 的 prerequisites/related 保持兼容，入库时由 classifyLegacy 自动语义化；
  // 新数据可用 n.relations: [{to,type,note}] 显式声明 9 类关系。
  const edgeStmt = db.prepare(`INSERT OR IGNORE INTO edges(from_id,to_id,type,weight,note) VALUES(?,?,?,?,?)`)
  // 门槛边（advance/depend）邻接表：from=前置 → to=后继，给节点级和题目级做环检测。
  // 门槛一旦成环（A 卡 B、B 又卡 A），两个考点都会永远 blocked。
  const gateAdj = new Map()
  /** 沿门槛边判断 from 是否能到达 to（含起点等于目标） */
  const reaches = (from, to) => {
    const stack = [from]; const seen = new Set()
    while (stack.length) {
      const cur = stack.pop()
      if (cur === to) return true
      if (seen.has(cur)) continue
      seen.add(cur)
      for (const nx of gateAdj.get(cur) ?? []) stack.push(nx)
    }
    return false
  }
  // 无向边去重账本：规范化为字典序键，A→B 与 B→A 只留一条（旧库 related 双向重复存储）
  const undirectedSeen = new Set()

  /** 演化方向：标题命中「旧→新」代际关键词时，保证边从旧技术指向新技术 */
  const EVOLVE_PAIRS = [
    [/回调|callback/i, /promise/i], [/promise/i, /async|await/i],
    [/options\s*api/i, /composition\s*api/i], [/\bvar\b/, /let|const/],
    [/xmlhttprequest|xhr/i, /fetch/i], [/class\s*组件|vue2/i, /vue3|组合式/i]
  ]
  const orientEvolve = (aId, bId, aTitle, bTitle) => {
    for (const [oldRe, newRe] of EVOLVE_PAIRS) {
      const aOld = oldRe.test(aTitle), aNew = newRe.test(aTitle)
      const bOld = oldRe.test(bTitle), bNew = newRe.test(bTitle)
      if (aOld && bNew) return [aId, bId]
      if (bOld && aNew) return [bId, aId]
    }
    return [aId, bId]
  }

  /** 自动生成一句话关系说明（显式 note 优先；这是兜底，让每条边都有「为什么」） */
  const defaultNote = (type, a, b) => {
    const ta = nodeMeta.get(a)?.title ?? a, tb = nodeMeta.get(b)?.title ?? b
    const map = {
      advance: `学会「${ta}」再进阶到「${tb}」`,
      depend: `「${tb}」建立在「${ta}」的理解地基上`,
      apply: `「${ta}」的原理在「${tb}」里落地`,
      evolve: `「${ta}」演进/替代为「${tb}」`,
      parallel: `「${ta}」与「${tb}」同层平行，可互换顺序学`,
      contrast: `「${ta}」与「${tb}」易混/需要选型对比`,
      analogy: `「${ta}」与「${tb}」机制神似，可互相打比方`,
      verify: `「${ta}」与「${tb}」跨章节互相印证同一原理`,
      relate: `「${ta}」与「${tb}」相关，可串联理解`
    }
    return map[type] ?? null
  }

  /**
   * 旧边自动语义化：
   * - prereq：同模块 → advance（学习台阶）；跨模块 → depend（理解地基）
   * - related：同主题兄弟 → parallel；含 vs/对比/区别 或互为对比 → contrast；
   *            跨模块 → verify（跨域印证）；同模块跨主题 → relate
   */
  const classifyLegacy = (legacyType, fromId, toId) => {
    const a = nodeMeta.get(fromId), b = nodeMeta.get(toId)
    if (!a || !b) return legacyType === 'prereq' ? 'advance' : 'relate'
    if (legacyType === 'prereq') return a.mod === b.mod ? 'advance' : 'depend'
    const ta = a.title || '', tb = b.title || ''
    const vsLike = /vs|区别|对比|选型|差异/.test(ta) || /vs|区别|对比|选型|差异/.test(tb)
    if (vsLike) return 'contrast'
    if (a.mod !== b.mod) return 'verify'
    if (a.topic === b.topic) return 'parallel'
    return 'relate'
  }

  /** 关系写入统一入口：方向规范化、无向去重、门槛环检测、note 兜底 */
  const addRelation = (rawFrom, rawTo, type, where, note = null) => {
    if (!nodeIds.has(rawFrom) || !nodeIds.has(rawTo)) return false
    if (rawFrom === rawTo) return false
    if (!isRelationType(type)) return false
    let from = rawFrom, to = rawTo
    // 无向边：字典序规范化，双向只存一条
    if (UNDIRECTED_TYPES.includes(type)) {
      if (from > to) [from, to] = [to, from]
      const key = `${from}␟${to}␟${type}`
      if (undirectedSeen.has(key)) return false
      undirectedSeen.add(key)
    } else if (GATE_TYPES.includes(type)) {
      // 门槛边环检测：若 to 已能沿门槛边到达 from，再补 from→to 就闭合成环
      if (reaches(to, from)) { stats.skipped.push(`${where} 的门槛 ${from}→${to}(${type}) 会成环，已跳过`); return false }
    }
    const finalNote = note || defaultNote(type, from, to)
    const weight = GATE_TYPES.includes(type) ? 1 : type === 'advance' ? 1 : 0.5
    edgeStmt.run(from, to, type, weight, finalNote)
    if (GATE_TYPES.includes(type)) {
      if (!gateAdj.has(from)) gateAdj.set(from, [])
      if (!gateAdj.get(from).includes(to)) gateAdj.get(from).push(to)
    }
    stats.edges++
    return true
  }

  /** 兼容旧字段 + 新 relations 字段，产出 (to,type,note) 三元组 */
  const declaredRelations = (n) => {
    const out = []
    for (const pre of n.prerequisites || []) out.push({ to: pre, type: null, note: null, legacy: 'prereq' })
    for (const rel of n.related || []) out.push({ to: rel, type: null, note: null, legacy: 'related' })
    for (const r of n.relations || []) {
      if (!r?.to) continue
      const t = isRelationType(r.type) ? r.type : null
      out.push({ to: r.to, type: t, note: r.note ?? null, legacy: t ? null : 'related' })
    }
    return out
  }

  for (const file of walk(join(contentRoot, 'nodes'))) {
    const list = listOf(readJson(file))
    if (!list) continue
    for (const n of list) {
      if (!n?.id) continue
      for (const d of declaredRelations(n)) {
        if (!nodeIds.has(d.to)) { stats.skipped.push(`节点 ${n.id} 的关系目标 ${d.to} 不存在`); continue }
        // 指向自身祖先（父模块/祖父模块）的关系只是归属——层级包含已有 contains 边，
        // 当门槛会死锁（L2/L3 无题永远点不亮 → 下面所有 L4 被 block）。
        if (n.id.startsWith(d.to + '.')) continue
        let type = d.type
        if (!type) type = classifyLegacy(d.legacy, n.id, d.to)
        let from = n.id, to = d.to
        if (DIRECTED_TYPES.includes(type)) {
          // 有向边：prerequisites 语义是「d.to 是 n 的前置」，方向必须 前置(d.to) → 当前(n)，
          // 否则入门关会被自己的后继反向锁死。related 经 classifyLegacy 只会落到无向类型。
          if (d.legacy === 'prereq') { from = d.to; to = n.id }
          if (type === 'evolve') {
            const [f, t] = orientEvolve(from, to, nodeMeta.get(from)?.title ?? '', nodeMeta.get(to)?.title ?? '')
            from = f; to = t
          }
        }
        addRelation(from, to, type, `节点 ${n.id}`, d.note)
      }
    }
  }
  // level 之间的父子边（章节/关卡结构用，不进关系透镜）
  const parentEdge = db.prepare(`INSERT OR IGNORE INTO edges(from_id,to_id,type,weight,note) SELECT id,parent,'contains',1,NULL FROM nodes WHERE parent IS NOT NULL`)
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
  // 题目检索索引：五字段各自分词后入 FTS5（列顺序与 QIDX_FIELDS/QIDX_WEIGHTS 一致）。
  // 走 ON CONFLICT UPDATE 而不是先删后插：全量重灌时能省掉一次 DELETE，且与 questions 的幂等策略对齐。
  const qidxStmt = db.prepare(
    `INSERT INTO question_index(${QIDX_FIELDS.join(',')})
     VALUES(${QIDX_FIELDS.map(() => '?').join(',')})
     ON CONFLICT(qid) DO UPDATE SET node_id=excluded.node_id, stem=excluded.stem, analysis=excluded.analysis,
       gap_check=excluded.gap_check, answer_text=excluded.answer_text, tags_text=excluded.tags_text,
       stem_tk=excluded.stem_tk, analysis_tk=excluded.analysis_tk, gap_tk=excluded.gap_tk,
       answer_tk=excluded.answer_tk, tags_tk=excluded.tags_tk, indexed_at=datetime('now','localtime')`
  )
  const seenQ = new Set()

  // 题目级 knowledgeLinks → edges（契约 KNOWLEDGE-SYSTEM.md §4）：
  // 实测题面链接噪声大（366 条 prereq 大量跨模块反向，会把入门关卡锁死），因此题目级链接
  // **统一降级为无向 relate 弱关联**：保留「这道题牵涉哪些概念」的导航价值，但不构成解锁门槛。
  // 硬门槛只由节点级 prerequisites（作者设计的学习顺序）产生，避免噪声反向锁人。
  const mergeQuestionLinks = (q) => {
    const kl = q?.knowledgeLinks
    if (!kl || !q.nodeId) return
    const isAncestor = (anc, id) => id === anc || id.startsWith(anc + '.')
    for (const ref of [...(kl.prereq ?? []), ...(kl.related ?? [])]) {
      if (!nodeIds.has(ref) || ref === q.nodeId || isAncestor(ref, q.nodeId)) continue
      addRelation(q.nodeId, ref, 'relate', `题目 ${q.id}`)
    }
  }

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
    // 同步写题目检索索引：缺 stem/id 的脏数据由 buildQuestionIndexRow 返回 null，跳过即可
    const idxRow = buildQuestionIndexRow(q)
    if (idxRow) qidxStmt.run(...QIDX_FIELDS.map((k) => idxRow[k]))
    mergeQuestionLinks(q)
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
