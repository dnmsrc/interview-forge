import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, cpSync, rmSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { all, get, run, reloadContent, settingGet } from '../db'
import { contentRoot } from '../db'
import { chatJson, NoEndpoint } from '../ai/gateway'
import { triageDirty, genVariants } from '../ai/tasks'
import { questionOf } from './grading'
import { scale4ToPct } from '../../shared/schema.mjs'
import type { Question, VariantLite } from '../../shared/types'

/**
 * 出题/变体生成时注入该考点已收录的知识正文（契约 §4）。
 * 关键约束写进 prompt：只能用材料里的事实，不许引入材料外的 API/版本号，
 * 这样题目与知识体系互相印证，而不是让模型凭印象出题。
 * knowledge 表可能在旧库/测试库里不存在，try 降级为空串。
 */
function knowledgeDigestFor(nodeId: string, maxChars = 3600): string {
  try {
    const row = get<{ body_md: string; confidence: string }>(
      `SELECT body_md,confidence FROM knowledge WHERE node_id=?`, [nodeId])
    if (!row?.body_md) return ''
    return `\n【该考点已收录的知识正文，事实以此为准，不得引入材料外的 API/版本号；置信度 ${row.confidence}】\n${row.body_md.slice(0, maxChars)}\n`
  } catch { return '' }
}

/**
 * 题库即文件：content/**.json 是唯一真源，SQLite 只是缓存。
 * 更新 = 快照 → AI 产出 → 改写 json → 重建库；回滚 = 还原快照 → 重建库。
 */

const projectRoot = () => process.env.FORGE_ROOT || join(__dirname, '..', '..', '..')
const snapRoot = () => join(projectRoot(), 'snapshots')
const rel = (p: string) => relative(projectRoot(), p).replace(/\\/g, '/')

function snapshotDir(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dir = join(snapRoot(), ts)
  mkdirSync(dir, { recursive: true })
  cpSync(contentRoot(), dir, { recursive: true })
  return dir
}

export function listVersions(limit = 40) {
  return all<any>(`SELECT id,created_at,kind,added,revised,retired,report,dir,rolled_back FROM bank_versions
    ORDER BY created_at DESC LIMIT ?`, [limit]).map((v) => ({ ...v, report: safeJson(v.report) }))
}
const safeJson = (s: string) => { try { return s ? JSON.parse(s) : null } catch { return null } }

function recordVersion(kind: string, stats: { added?: number; revised?: number; retired?: number }, report: unknown, dir?: string) {
  const id = randomUUID().slice(0, 8)
  run(`INSERT INTO bank_versions(id,created_at,kind,added,revised,retired,report,dir)
       VALUES(?,datetime('now','localtime'),?,?,?,?,?,?)`,
    [id, kind, stats.added ?? 0, stats.revised ?? 0, stats.retired ?? 0, JSON.stringify(report), dir ?? ''])
  return id
}

export function rollback(versionId: string): { ok: boolean; message: string } {
  const v = get<any>(`SELECT * FROM bank_versions WHERE id=?`, [versionId])
  if (!v?.dir || !existsSync(v.dir)) return { ok: false, message: '该版本没有可用的快照目录' }
  const pre = snapshotDir()
  rmSync(contentRoot(), { recursive: true, force: true })
  cpSync(v.dir, contentRoot(), { recursive: true })
  const stats = reloadContent()
  recordVersion('rollback', { added: stats.questions, revised: 0, retired: 0 }, { from: versionId, preSnapshot: pre }, pre)
  return { ok: true, message: `已回滚到 ${v.created_at} 的题库（共 ${stats.questions} 题），回滚前状态也已快照` }
}

// ---------------- 脏题闭环 ----------------

export function reportDirty(qid: string, reason: string, userEdit?: Partial<Question>) {
  const q = questionOf(qid)
  if (!q) throw new Error('题目不存在')
  let appliedEdit = ''
  if (userEdit && Object.keys(userEdit).length) {
    const merged = { ...q, ...userEdit, meta: { ...(q as any).meta, version: (((q as any).meta?.version ?? 1) + 1), history: [...((((q as any).meta)?.history ?? [])), { at: new Date().toISOString(), by: 'user', note: reason || '手动编辑' }] } }
    applyPatchToQuestionFile(qid, merged)
    appliedEdit = JSON.stringify(merged)
  }
  run(`INSERT INTO dirty_reports(qid,reason,user_edit,status,created_at) VALUES(?,?,?, ?,datetime('now','localtime'))`,
    [qid, reason ?? '', appliedEdit, userEdit ? 'edited' : 'open'])
  return { ok: true, edited: !!userEdit }
}

export function listDirty(limit = 60) {
  return all<any>(`SELECT d.*, SUBSTR(json_extract(q.data,'$.stem'),1,90) stem, n.title nodeTitle
    FROM dirty_reports d LEFT JOIN questions q ON q.id=d.qid LEFT JOIN nodes n ON n.id=q.node_id
    ORDER BY CASE d.status WHEN 'open' THEN 0 WHEN 'edited' THEN 1 ELSE 2 END, d.id DESC LIMIT ?`, [limit])
}

/** 后台自动处理未决举报：修 / 下架 / 替换 / 保留 */
export async function triageDirtyQueue(limit = 5): Promise<{ handled: number; results: any[] }> {
  const rows = all<any>(`SELECT d.id,d.qid,d.reason,d.user_edit,q.data FROM dirty_reports d
    JOIN questions q ON q.id=d.qid WHERE d.status IN ('open','edited') ORDER BY d.id LIMIT ?`, [limit])
  const results: any[] = []
  for (const row of rows) {
    const original = questionOf(row.qid)
    if (!original) continue
    let verdict: Awaited<ReturnType<typeof triageDirty>>
    try {
      verdict = await triageDirty(original, row.reason ?? '', row.user_edit || undefined)
    } catch (e: any) {
      if (e instanceof NoEndpoint) return { handled: 0, results: [{ error: '未配置 AI 端点，举报暂存中' }] }
      results.push({ qid: row.qid, error: String(e?.message ?? e) }); continue
    }
    let extra = ''
    if (verdict.action === 'fix' && verdict.patch) {
      applyPatchToQuestionFile(row.qid, { ...original, ...verdict.patch, source: { ...original.source, note: `${original.source?.note ?? ''} AI 复核修正`.trim() } })
    } else if (verdict.action === 'retire') {
      applyPatchToQuestionFile(row.qid, { ...original, status: 'retired', source: { ...original.source, note: `AI 下架：${verdict.reason}` } })
    } else if (verdict.action === 'replace') {
      const node = get<{ title: string }>(`SELECT title FROM nodes WHERE id=?`, [original.nodeId])
      let variants: VariantLite[] = []
      try { variants = await genVariants(original, [original.stem], node?.title ?? '', 1) } catch { /* 变体失败则只下架 */ }
      if (variants.length) {
        appendVariantsToFile(original, variants.map((v) => ({ ...v, angle: v.angle ?? '换问法' })))
        applyPatchToQuestionFile(row.qid, { ...original, status: 'retired', source: { ...original.source, note: `AI 替换为变体：${verdict.reason}` } })
        extra = `并新增 1 道变体`
      } else {
        applyPatchToQuestionFile(row.qid, { ...original, status: 'retired' })
        extra = '变体生成失败，仅下架'
      }
    }
    reloadContent()
    run(`UPDATE dirty_reports SET ai_action=?, ai_result=?, status='resolved' WHERE id=?`,
      [verdict.action, JSON.stringify({ reason: verdict.reason, extra }), row.id])
    recordVersion('dirty-triage', { revised: 1 }, { qid: row.qid, action: verdict.action, reason: verdict.reason, extra })
    results.push({ qid: row.qid, action: verdict.action, reason: verdict.reason, extra })
  }
  return { handled: rows.length, results }
}

// ---------------- content 文件读写 ----------------

function questionFiles(): string[] {
  const dir = join(contentRoot(), 'questions')
  if (!existsSync(dir)) return []
  const out: string[] = []
  const walk = (d: string) => { for (const name of readdirSync(d)) { const p = join(d, name); if (statSync(p).isDirectory()) walk(p); else if (name.endsWith('.json')) out.push(p) } }
  walk(dir)
  return out
}

function findFileForQuestion(qid: string): { file: string; index: number } | null {
  for (const file of questionFiles()) {
    const arr = readJsonArray(file)
    const i = arr.findIndex((q: any) => q?.id === qid)
    if (i >= 0) return { file, index: i }
  }
  return null
}
const readJsonArray = (file: string): any[] => {
  try { const raw = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); return Array.isArray(raw) ? raw : raw?.questions ?? [] } catch { return [] }
}
const writeJsonArray = (file: string, arr: any[]) => {
  mkdirSync(dirName(file), { recursive: true })
  writeFileSync(file, JSON.stringify(arr, null, 2), 'utf8')
}
const dirName = (p: string) => p.slice(0, Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')))

function applyPatchToQuestionFile(qid: string, patched: any) {
  const loc = findFileForQuestion(qid)
  if (!loc) throw new Error(`找不到题目 ${qid} 所在文件`)
  const arr = readJsonArray(loc.file)
  arr[loc.index] = patched
  writeJsonArray(loc.file, arr)
}

function appendVariantsToFile(parent: Question, variants: VariantLite[]) {
  const loc = findFileForQuestion(parent.id)
  if (!loc) return
  const arr = readJsonArray(loc.file)
  const existing = (arr[loc.index].variants ?? []).map((v: any) => v.stem)
  const fresh = variants.filter((v) => !existing.includes(v.stem)).map((v, i) => ({
    ...v, id: `${parent.id}-V${Date.now().toString(36)}${i}`, parentId: parent.id, nodeId: parent.nodeId, angle: v.angle ?? '换问法'
  }))
  arr[loc.index].variants = [...(arr[loc.index].variants ?? []), ...fresh]
  writeJsonArray(loc.file, arr)
}

// ---------------- 题库自动更新（全 AI 控制，人工不参与） ----------------

export interface UpdateOptions { domains?: string[]; perNodeTarget?: number; maxNodes?: number; note?: string; digest?: string }

/** 找出覆盖缺口：level4 节点题量不足、题型单一、完全空白 */
export function coverageGaps(domains: string[] = [], perNodeTarget = 3) {
  const dom = domains.length ? `AND substr(n.id,1,instr(n.id,'.')-1) IN (${domains.map(() => '?').join(',')})` : ''
  const rows = all<{ id: string; title: string; stack: string; topic: string; total: number; types: string }>(`
    SELECT n.id, n.title, n.stack, n.topic,
      (SELECT COUNT(*) FROM questions q WHERE q.node_id=n.id AND q.status='active' AND q.parent_id IS NULL) total,
      (SELECT COALESCE(group_concat(DISTINCT q2.type),'') FROM questions q2 WHERE q2.node_id=n.id AND q2.status='active') types
    FROM nodes n WHERE n.level=4 ${dom}
    ORDER BY total ASC, n.ord ASC`)
  const empty = rows.filter((r) => r.total === 0)
  const thin = rows.filter((r) => r.total > 0 && r.total < perNodeTarget)
  const noSubjective = rows.filter((r) => r.total >= perNodeTarget && !/short|essay|code/.test(r.types))
  return {
    empty: empty.map(toGap), thin: thin.map(toGap), noSubjective: noSubjective.map(toGap),
    totalLevel4: rows.length,
    byDomain: domains.length ? undefined : all<{ domain: string; n: number }>(`SELECT substr(node_id,1,instr(node_id,'.')-1) domain, COUNT(*) n FROM questions GROUP BY domain`)
  }
}
const toGap = (r: any) => ({ id: r.id, title: r.title, stack: r.stack, topic: r.topic, total: r.total, types: r.types })

/** 轻量联网摘要：抓一个搜索页给模型当"最新情况"参考，失败不影响主流程 */
async function webDigest(query: string): Promise<string> {
  try {
    const ac = AbortSignal.timeout(9000)
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { headers: { 'user-agent': 'Mozilla/5.0 interview-forge' }, signal: ac })
    if (!res.ok) return ''
    const html = await res.text()
    const titles = [...html.matchAll(/class="result__a"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim()).slice(0, 8)
    const snippets = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim()).slice(0, 6)
    return [...titles, ...snippets].filter(Boolean).join('\n').slice(0, 1800)
  } catch { return '' }
}

export interface UpdateResult { ok: boolean; added: number; revised: number; retired: number; report: any; error?: string }

export async function updateBank(opts: UpdateOptions = {}): Promise<UpdateResult> {
  const perTarget = opts.perNodeTarget ?? 3
  const gaps = coverageGaps(opts.domains ?? [], perTarget)
  // 三类缺口都要处理：empty 补到目标数、thin 补足差额、noSubjective 补主观题。
  // 之前只取 empty+thin，导致「题量够但全是客观题」的节点永远被判为达标，
  // UI 上「缺主观题」计数清零不了，点更新也只返回"覆盖已达标"。
  const targets = [
    ...gaps.empty.map((g) => ({ ...g, mode: 'fill' as const })),
    ...gaps.thin.map((g) => ({ ...g, mode: 'topup' as const })),
    ...(gaps.noSubjective ?? []).map((g) => ({ ...g, mode: 'subjective' as const })),
  ].slice(0, opts.maxNodes ?? 12)
  const before = snapshotDir()
  const report: any = { added: [], revised: [], retired: [], notes: [] }
  if (!targets.length) { rmSync(before, { recursive: true, force: true }); return { ok: true, added: 0, revised: 0, retired: 0, report: { message: '覆盖已达标，无需更新', gaps: { empty: gaps.empty.length, thin: gaps.thin.length, noSubjective: gaps.noSubjective?.length ?? 0 } } } }

  const digest = opts.digest || (await webDigest(`${new Date().getFullYear()} 练习题 ${targets[0]?.title ?? ''} 最新考点`))
  let added = 0
  for (const t of targets) {
    const need = t.mode === 'subjective' ? 1 : Math.max(1, perTarget - t.total)
    try {
      const { data } = await chatJson<any>({
        task: 'bank_update', role: 'strong', refType: 'node', refId: t.id, maxTokens: 3000,
        // 本机模型输出 2-3 千 token 常超过 90 秒；默认超时会让整节点白跑（ai_log 里全是超时）
        timeoutMs: 150000,
        system: `你是题库编者。要求：题干像真人出题的口吻、必须能通过官方文档验证、禁止编造 API 与版本号；每题必须有 analysis（含错项为什么错）、gapCheck（易漏点）、knowledgeLinks（含 followUps 追问方向）；主观题必须给 scoringPoints 与 answer.ref。只输出 JSON。`,
        user: `知识点：${t.title}（节点 id：${t.id}）
现有题量 ${t.total}，已有题型：${t.types || '无'}。${t.mode === 'subjective'
  ? `本节点题量已达标，但${t.types}里没有任何主观题。请只补 ${need} 道主观题（short 简答 / essay 论述 / code 代码，按该知识点特点选一种），必须给 scoringPoints（判分要点清单）与 answer.ref（参考答案要点）。`
  : `请补 ${need} 道题，题型从 single/multiple/judge/blank/short/essay/code 里按该知识点特点选择（同一节点别全是选择题）。`}
${knowledgeDigestFor(t.id)}
${digest ? `\n【联网检索到的近期讨论，仅供判断考点热度，不得当作事实来源】\n${digest}\n` : ''}
${opts.note ? `【额外要求】${opts.note}` : ''}
输出 {"questions":[{"id":"留空由系统生成","nodeId":"${t.id}","type":"single","difficulty":2,"stem":"…","options":[{"key":"A","text":"…"}],"answer":{"keys":["A"]},"scoringPoints":[],"analysis":"…","gapCheck":["…"],"knowledgeLinks":{"prereq":[],"related":[],"followUps":["…"]},"resources":[{"title":"…","digest":"…"}],"source":{"kind":"self-authored","note":"bank_update"}}]}
客观题必须给唯一正确答案；judge 用 answer.judge；填空用 answer.blanks。`
      })
      const list: any[] = Array.isArray(data?.questions) ? data.questions : Array.isArray(data) ? data : []
      const fresh = list.filter((q) => q?.stem && q?.type).map((q, i) => normalizeNewQuestion(q, t.id, i))
      if (fresh.length) { appendQuestionsToNodeFile(t, fresh); added += fresh.length; report.added.push({ node: t.id, count: fresh.length, ids: fresh.map((f) => f.id) }) }
    } catch (e: any) {
      if (e instanceof NoEndpoint) { restoreFrom(before); return { ok: false, added, revised: 0, retired: 0, report, error: '未配置 AI 端点' } }
      report.notes.push(`${t.id}: ${String(e?.message ?? e).slice(0, 120)}`)
    }
  }

  // 过时题下架：AI 只对"有变体冗余或重复"的题给出 retire 建议
  const retiredIds = autoRetireDuplicates()
  const stats = reloadContent()
  recordVersion('update', { added, revised: 0, retired: retiredIds.length }, { ...report, digestUsed: !!digest, targets: targets.map((t) => t.id) }, before)
  return { ok: true, added, revised: 0, retired: retiredIds.length, report: { ...report, retired: retiredIds, bankNow: { questions: stats.questions, nodes: stats.nodes } } }
}

function normalizeNewQuestion(q: any, nodeId: string, i: number): Question {
  const prefix = nodeId.replace(/\./g, '-').slice(0, 26)
  const suffix = Math.random().toString(36).slice(2, 6)
  const out: any = {
    ...q, nodeId, type: q.type, difficulty: Math.max(1, Math.min(5, Number(q.difficulty) || 2)),
    id: `Q-${prefix}-${suffix}${i}`, openBookAllowed: q.openBookAllowed !== false,
    source: { kind: q.source?.kind ?? 'self-authored', note: q.source?.note ?? 'bank_update 自动生成', retrievedAt: new Date().toISOString().slice(0, 10) },
    tags: q.tags ?? ['自动生成'], status: 'active',
    meta: { created: new Date().toISOString().slice(0, 10), version: 1, history: [] }
  }
  // 主观题兜底：本地小模型常漏 scoringPoints / answer.ref，缺了会被 validate 拦下，
  // 这里用解析文本与最低判分骨架补齐，保证「可判分」这一契约底线不被 AI 输出打断。
  if (['short', 'essay', 'code'].includes(q.type)) {
    // 模型偶尔把评分点写成纯字符串；统一成 { point, weight }，别让判分提示词读到 undefined
    if (Array.isArray(out.scoringPoints)) {
      out.scoringPoints = out.scoringPoints.map((p: any, idx: number) =>
        typeof p === 'string' ? { point: p, weight: idx < 2 ? 2 : 1 } : p)
    }
    if (!Array.isArray(out.scoringPoints) || !out.scoringPoints.length) {
      // 必须是 { point, weight }：AI 判分提示词里按 p.point / p.weight 取值，
      // 写字符串会渲染成「1. undefined（权重 undefined）」，判分直接失真。
      out.scoringPoints = [
        { point: '结论正确且给出机制', weight: 2 },
        { point: '覆盖关键边界或失败场景', weight: 2 },
        { point: '能联系相关考点延伸', weight: 1 }
      ]
    }
    if (!out.answer?.ref && !out.answer?.code) {
      out.answer = { ...(out.answer ?? {}), ref: String(q.analysis ?? '').trim() || '要点见题目解析' }
    }
  }
  return out as Question
}

function appendQuestionsToNodeFile(target: { id: string; stack: string; topic: string }, list: Question[]) {
  const segs = target.id.split('.')
  const file = join(contentRoot(), 'questions', segs[0], segs[1] ?? 'misc', `${segs[2] ?? target.topic ?? 'general'}.json`)
  const arr = readJsonArray(file)
  arr.push(...list)
  writeJsonArray(file, arr)
}

/** 现场为某题补生成变体并写回 content 文件（预生成变体用完时由练习页触发） */
export async function addGeneratedVariants(qid: string, n = 2): Promise<{ ok: boolean; added: number; error?: string }> {
  const q = questionOf(qid)
  if (!q) return { ok: false, added: 0, error: '题目不存在' }
  const node = get<{ title: string }>(`SELECT title FROM nodes WHERE id=?`, [q.nodeId])
  const existing = [q.stem, ...(q.variants ?? []).map((v) => v.stem)]
  try {
    // 知识正文随变体生成一起注入：同考点的变体必须能在已收录材料里找到事实依据
    const kb = knowledgeDigestFor(q.nodeId, 3200)
    const fresh = await genVariants(q, existing, node?.title ?? q.nodeId, n, { knowledgeMd: kb })
    if (!fresh.length) return { ok: false, added: 0, error: '模型未产出可用变体' }
    appendVariantsToFile(q, fresh)
    reloadContent()
    recordVersion('variant', { revised: 1 }, { qid, count: fresh.length })
    return { ok: true, added: fresh.length }
  } catch (e: any) {
    return { ok: false, added: 0, error: String(e?.message ?? e).slice(0, 160) }
  }
}

/** 同节点内题干几乎相同且题量充足的题，自动下架其一（不花 AI） */
function autoRetireDuplicates(): string[] {
  // 注意：别名不能用 keep/drop —— drop 是 SQLite 关键字，会让整条语句
  // 报 near "drop": syntax error，导致每次 bank.update 走到这里必炸。
  const dup = all<{ keep_id: string; drop_id: string }>(`SELECT MIN(q.id) keep_id, MAX(q.id) drop_id FROM questions q
    WHERE q.parent_id IS NULL AND q.status='active'
    GROUP BY q.node_id, LOWER(REPLACE(REPLACE(json_extract(q.data,'$.stem'),' ',''),'。',''))
    HAVING COUNT(*)>1`)
  const ids = dup.map((d) => d.drop_id).filter(Boolean)
  for (const id of ids) {
    const q = questionOf(id)
    if (q) { try { applyPatchToQuestionFile(id, { ...q, status: 'retired', source: { ...q.source, note: '题干与同节点其他题重复，自动下架' } }) } catch { /* ignore */ } }
  }
  return ids
}

function restoreFrom(dir: string) {
  try {
    const cur = snapshotDir()
    rmSync(contentRoot(), { recursive: true, force: true })
    cpSync(dir, contentRoot(), { recursive: true })
    rmSync(cur, { recursive: true, force: true })
    reloadContent()
  } catch { /* ignore */ }
}

export function bankStats() {
  return {
    questions: get<{ n: number }>(`SELECT COUNT(*) n FROM questions WHERE status='active'`)?.n ?? 0,
    variants: get<{ n: number }>(`SELECT COUNT(*) n FROM questions WHERE parent_id IS NOT NULL AND status='active'`)?.n ?? 0,
    nodes: get<{ n: number }>(`SELECT COUNT(*) n FROM nodes WHERE level=4`)?.n ?? 0,
    byDomain: all(`SELECT substr(node_id,1,instr(node_id,'.')-1) domain, COUNT(*) n FROM questions WHERE status='active' GROUP BY domain`),
    byType: all(`SELECT type, COUNT(*) n FROM questions WHERE status='active' GROUP BY type ORDER BY n DESC`),
    byDifficulty: all(`SELECT difficulty, COUNT(*) n FROM questions WHERE status='active' GROUP BY difficulty ORDER BY difficulty`)
  }
}
export { scale4ToPct }
