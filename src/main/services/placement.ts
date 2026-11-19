import { randomUUID } from 'node:crypto'
import { all, get, run, settingGet, settingSet } from '../db'
import { gradeAnswer, questionOf } from './grading'
import { chat } from '../ai/gateway'
import { recordAttempt } from './srs'
import { hydrateQuestions } from './srs'
import type { QuestionRow } from '../../shared/types'
// v18 边界探测状态机：探针通过→沿同方向逐级加难，不会→该方向立即收束（零依赖纯函数，CLI 单测同源）
import {
  emptyPlacement18, isPlacement18,
  recordAnswer, markTopped, nextPendingModule, allSettled, progressOf18
} from '../../shared/placement-core.mjs'
// R23「我不会」自由描述 → 缺口类型的中文强信号规则（零依赖纯函数，qa 与服务同源）
import { classifyGapNote as classifyGapNoteRaw, normalizeGapKind as normalizeGapKindRaw } from '../../shared/gap-rules.mjs'

/** v18 调度态的 TS 形状（实现见 placement-core.mjs，这里只补类型，逻辑保持单一数据源在纯函数侧） */
interface PlacementModuleState {
  state: 'probing' | 'climbing' | 'capped' | 'topped'
  lastNode: string | null
  probed: boolean
  turns: number
  pass: number
}
interface Placement18State {
  v: number
  moduleOrder: string[]
  modules: Record<string, PlacementModuleState>
}

/**
 * 自适应摸底引擎（v18 边界探测 / CAT 式）。
 *
 * 用户诉求：不预设固定题量，由浅入深一道道做、按回答动态推送，能判准水准就立刻收。
 * 与 R17「全模块探针 + 薄弱加深 + 40 题封顶」的关键反转：
 *   - R17 探针答对(scale≥3)的模块直接 quota=0 跳过；v18 恰恰相反——**答对才沿同方向继续加难**，
 *     用同节点更难母题、再沿 advance 后继链上探，直到用户不会（能力下沿）或路径到顶（能力上沿）；
 *   - 一旦某题不会（scale≤1 或主动标缺口），该模块立即 capped 收束，默认后续进阶题都不会，不再纠缠；
 *   - 所有模块都到边界即结束，正常题量 = 模块数 + 各方向爬升数，弱用户很快收、强用户自然探得深。
 *
 * 不变的底座：会话与每轮判定落 SQLite（placement_session / placement_turn），重启可 resume；
 * 每节点判定经 recordAttempt 反映到 node_mastery，驱动后续练习。
 * 决策状态机在 src/shared/placement-core.mjs（零依赖纯函数，r18 测试与本服务同源）。
 */

export type GapType = 'concept' | 'code' | 'skip' | 'guess'
/**
 * 安全兜底题量，不是正常结束线。v18 正常靠「所有模块到边界」收敛，弱用户约 模块数+几题、
 * 强用户随深度自然增长；只有在题库异常导致迟迟不收敛时才用它强制收口，防止无限出题。
 */
const SAFETY_MAX_TURNS = 60
const MAX_ZERO_STREAK = 3

interface PlacementSessionRow {
  id: string; domain: string; status: string; current_node_id: string | null
  level: number; created_at: string; updated_at: string; finished_at: string | null; summary: string | null
}
export interface Progress { done: number; total: number }

const nowStr = () => new Date().toISOString().slice(0, 19).replace('T', ' ')

/** 该板块全部 L4 叶子节点（题目只挂在叶子上） */
function level4Nodes(domain: string) {
  return all<{ id: string; title: string; ord: number }>(
    `SELECT id,title,ord FROM nodes WHERE level=4 AND domain=? AND status='active' ORDER BY ord`, [domain])
}

/** 节点的外部前置（只认 advance 硬门槛；depend 是理解地基不锁人，祖先归属边已在 seed 剔除） */
function prereqsOf(nodeId: string): string[] {
  return all<{ from_id: string }>(`SELECT from_id FROM edges WHERE to_id=? AND type='advance'`, [nodeId]).map((r) => r.from_id)
}
function nodeTitle(nodeId: string): string {
  return get<{ title: string }>(`SELECT title FROM nodes WHERE id=?`, [nodeId])?.title ?? nodeId
}

/** 该节点下最简单的 active 母题难度；无题返回大数，让它在起点排序里沉底（R13 难度护栏） */
function minQuestionDifficulty(nodeId: string): number {
  return get<{ m: number | null }>(
    `SELECT MIN(difficulty) m FROM questions WHERE node_id=? AND status='active' AND parent_id IS NULL`,
    [nodeId])?.m ?? 99
}

/**
 * R19 先学后测：该题是否为「资料依赖题」（learnFirst=true 写在题目 JSON 的 data 列里）。
 * 这类题不读特定论文/文档无法凭原理作答，摸底需先给学习材料，故选题时让闭卷题优先。
 * 用 json_extract 读取，字段缺失（false/null/不存在）统一视为闭卷题，兼容历史数据零迁移。
 */
function isLearnFirstRow(row: { data?: string }): boolean {
  try {
    return JSON.parse(row.data ?? '{}')?.learnFirst === true
  } catch { return false }
}

/**
 * 取某节点下一道没在本 session 用过的 active 母题。
 * R19 起两段式选题（preferClosedBook=true 时）：先在「可凭原理推理的闭卷题」里取最浅的，
 * 闭卷题都用过/不存在，才回落到 learnFirst 先学题——后者由前端先展示 resources 材料再考。
 * 保证同节点有可推理题时，绝不会把「没读过论文只能蒙」的资料题先推给用户。
 */
function pickQuestion(nodeId: string, usedQuestionIds: Set<string>, preferClosedBook = true): QuestionRow | null {
  // 一次取该节点全部 active 母题（按难度升序），再分两遍筛：先闭卷、后先学。
  const rows = all<{ id: string; data: string }>(
    `SELECT id,data FROM questions WHERE node_id=? AND status='active' AND parent_id IS NULL
     ORDER BY difficulty ASC, RANDOM()`, [nodeId])
  const firstUnused = (onlyClosed: boolean) =>
    rows.find((r) => !usedQuestionIds.has(r.id) && (!onlyClosed || !isLearnFirstRow(r)))
  const pick = (preferClosedBook ? firstUnused(true) : undefined) ?? firstUnused(false)
  if (!pick) return null
  return hydrateQuestions([pick.id])[0] ?? null
}

/**
 * 选首节点（R13 加难度护栏）。三级排序，保证任何板块第一题都落在全场最浅、可作答的考点：
 *   1. gates  外部前置门槛数 ASC —— 无前置的根考点最基础（ai 这类无 gates=0 的板块回退到 gates 最小）；
 *   2. minDiff 该考点「最简单母题」难度 ASC —— 门槛并列时，绝不让一个起步就考 D3/D4 的深考点插队；
 *   3. ord    灌入顺序 ASC —— 仍并列时按学习路线先后（seed 已按 HTML→CSS→JS→框架 顺序铺排）。
 * 无题节点 minDiff=99 自动沉底，配合 startPlacement 的 probe 兜底，不会选到出不了题的空壳。
 */
function pickStartNode(domain: string): string | null {
  const nodes = level4Nodes(domain)
  if (!nodes.length) return null
  const scored = nodes.map((n) => ({
    id: n.id, gates: prereqsOf(n.id).length, minDiff: minQuestionDifficulty(n.id), ord: n.ord
  }))
  scored.sort((a, b) => a.gates - b.gates || a.minDiff - b.minDiff || a.ord - b.ord)
  return scored[0]?.id ?? null
}

// ============================================================================
// R17 分阶段广度自适应调度器
// ----------------------------------------------------------------------------
// 旧逻辑只沿单条 prereq 链从最浅节点往上爬，题量又被 15 题封顶，导致前期全是
// HTML/CSS、JS/Vue 等模块根本没被采样到就结束。新调度分两阶段：
//   ① 广度扫盲：板块内每个「有题」的 L2 模块各出 1 道最基础探针题，保证全覆盖；
//   ② 自适应加深：按探针 scale4 给模块配额——薄弱(≤1)多挖、中等(=2)补 1、
//      已掌握(≥3)跳过。加深优先沿未掌握前置下探，其次同模块换更深的未访问题。
// 调度状态（已探模块、各模块配额/累计）序列化进 placement_session.summary，
// 旧会话无该状态时按需惰性初始化，断点续测/僵尸收口逻辑不变，零 schema 迁移。
// ============================================================================

/**
 * 学习阶段顺序（跨板块通用，按 stack 关键字匹配）。
 * seed 的 ord 是文件灌库顺序、并不代表学习先后（如 css 的 ord 反而很靠后），
 * 因此这里显式定义「打基础 → 语言核心 → 类型/浏览器/网络 → 框架 → 工程/性能 → 跨端/生态」。
 * 未命中的模块统一沉到末尾按 ord 兜底，新增模块无需改这里也能正常参与扫盲。
 */
const STAGE_ORDER: { match: RegExp; rank: number }[] = [
  { match: /html/, rank: 10 },
  { match: /css/, rank: 20 },
  { match: /js-datastructure|datastructure/, rank: 28 },
  { match: /(^|\.)js([.\d]|$)/, rank: 30 },
  { match: /ts/, rank: 40 },
  { match: /browser/, rank: 50 },
  { match: /network/, rank: 55 },
  { match: /vue|react|eco/, rank: 60 },
  { match: /build/, rank: 70 },
  { match: /perf/, rank: 80 },
  { match: /electron|uniapp/, rank: 90 }
]

interface ModuleInfo { id: string; title: string; rank: number; ord: number }

/** 该板块所有「挂了 active 母题」的 L2 模块，按学习阶段排序（无题模块不参与摸底，避免空转出白屏） */
function activeModules(domain: string): ModuleInfo[] {
  const mods = all<{ id: string; title: string; ord: number }>(
    `SELECT m.id,m.title,m.ord FROM nodes m
     WHERE m.domain=? AND m.level=2 AND m.status='active'
       AND EXISTS (
         SELECT 1 FROM nodes l JOIN questions q ON q.node_id=l.id
         WHERE l.id LIKE m.id||'.%' AND l.status='active' AND q.status='active' AND q.parent_id IS NULL)
     ORDER BY m.ord`, [domain])
  const rankOf = (id: string) => {
    for (const s of STAGE_ORDER) if (s.match.test(id)) return s.rank
    return 100
  }
  return mods
    .map((m) => ({ ...m, rank: rankOf(m.id) }))
    .sort((a, b) => a.rank - b.rank || a.ord - b.ord)
}

/** 模块下所有有题的 L4 叶子（用于探针/加深选题），按前置门槛数、最简单母题难度、ord 排序 */
function moduleLeafNodes(moduleId: string) {
  return all<{ id: string; ord: number }>(
    `SELECT l.id,l.ord FROM nodes l
     WHERE l.id LIKE ? AND l.level=4 AND l.status='active'
       AND EXISTS (SELECT 1 FROM questions q WHERE q.node_id=l.id AND q.status='active' AND q.parent_id IS NULL)
     ORDER BY l.ord`, [`${moduleId}.%`])
}

// ============================================================================
// v18 边界探测调度器（CAT 式）
// ----------------------------------------------------------------------------
// 决策状态机在 src/shared/placement-core.mjs（纯函数、可单测）；这里只负责用 DB 选题、
// 持久化状态，并把作答结果喂给状态机。两条选题路径：
//   ① 探针（probe）：模块第一道，取该模块门槛最低、最简单的有题叶子，保证从最浅处起步；
//   ② 爬升（climb）：模块探针答对后，沿「同节点更难母题 → advance 后继叶子」逐级加难，
//      直到用户不会（状态机置 capped）或路径到顶（选题耗尽，置 topped）。
// 状态序列化进 placement_session.summary 的 __scheduler 命名空间；旧 v17/无状态会话惰性重建，
// 续测/僵尸收口逻辑不变，零 schema 迁移。
// ============================================================================

function loadScheduler(sessionId: string, domain: string): Placement18State {
  const row = get<{ summary: string | null }>(`SELECT summary FROM placement_session WHERE id=?`, [sessionId])
  if (row?.summary) {
    try {
      const parsed = JSON.parse(row.summary)
      if (isPlacement18(parsed?.__scheduler)) return parsed.__scheduler as Placement18State
    } catch { /* 旧 summary 是完成报告或 v17 调度态，忽略后重建 */ }
  }
  // 惰性重建：按当前题库排好模块队列，再用本会话已有作答把每个模块的状态补回，续测无缝接入。
  const moduleOrder = activeModules(domain).map((m) => m.id)
  let state = emptyPlacement18(moduleOrder) as Placement18State
  const turns = all<{ node_id: string | null; scale4: number; gap_type: string | null }>(
    `SELECT node_id,scale4,gap_type FROM placement_turn WHERE session_id=? ORDER BY id ASC`, [sessionId])
  for (const t of turns) {
    if (!t.node_id) continue
    const moduleId = t.node_id.split('.').slice(0, 2).join('.')
    if (!state.modules[moduleId]) continue
    state = recordAnswer(state, moduleId, {
      nodeId: t.node_id, scale4: Number(t.scale4) || 0, isGap: !!t.gap_type
    }) as Placement18State
  }
  return state
}

function saveScheduler(sessionId: string, state: Placement18State) {
  // 完成报告也写在 summary；摸底进行中这里只承载调度态，用 __scheduler 命名空间隔离。
  run(`UPDATE placement_session SET summary=?, updated_at=? WHERE id=?`,
    [JSON.stringify({ __scheduler: state }), nowStr(), sessionId])
}

/**
 * 探针选题：模块里「门槛最低、最简单母题」的有题叶子（与 R17 同策略，保证起点最浅）。
 * 叶子本会话用过则换模块内任一未访问有题叶子，再不行换同叶子没用过的题。
 */
function pickProbeQuestion(moduleId: string, usedQuestions: Set<string>, visited: Set<string>): QuestionRow | null {
  const leaves = moduleLeafNodes(moduleId)
  const ranked = leaves
    .map((l) => ({ id: l.id, gates: prereqsOf(l.id).length, minDiff: minQuestionDifficulty(l.id), ord: l.ord }))
    .sort((a, b) => a.gates - b.gates || a.minDiff - b.minDiff || a.ord - b.ord)
  for (const cand of ranked) {
    if (visited.has(cand.id)) continue
    const q = pickQuestion(cand.id, usedQuestions)
    if (q) return q
  }
  for (const cand of ranked) {
    const q = pickQuestion(cand.id, usedQuestions)
    if (q) return q
  }
  return null
}

/**
 * 爬升选题：沿「同方向」逐级加难，三级回落，全部穷尽返回 null（调用方据此置 topped）。
 *   1) 当前节点更难的未用母题（同叶子内部 D1→D5 梯度）；
 *   2) 当前节点的 advance 后继叶子（跨叶子的前置链，如 box-model→bfc），取其中最浅的未访问叶子；
 *   3) 模块内任一未访问有题叶子（链不完整时的兜底，仍按由浅入深）。
 */
function pickClimbQuestion(
  moduleId: string, fromNodeId: string | null, usedQuestions: Set<string>, visited: Set<string>
): QuestionRow | null {
  // 1) 同节点更难母题：pickQuestion 按 difficulty ASC 取未用题，天然比上一道难或并列
  if (fromNodeId) {
    const harder = pickQuestion(fromNodeId, usedQuestions)
    if (harder) return harder
  }
  // 2) advance 后继叶子（只在同模块内沿链爬，不跨模块跳）
  if (fromNodeId) {
    const successors = all<{ id: string; ord: number }>(
      `SELECT n.id,n.ord FROM edges e JOIN nodes n ON n.id=e.to_id
       WHERE e.from_id=? AND e.type='advance' AND n.id LIKE ? AND n.level=4 AND n.status='active'
         AND EXISTS (SELECT 1 FROM questions q WHERE q.node_id=n.id AND q.status='active' AND q.parent_id IS NULL)`,
      [fromNodeId, `${moduleId}.%`])
    const ranked = successors
      .map((l) => ({ id: l.id, minDiff: minQuestionDifficulty(l.id), ord: l.ord }))
      .sort((a, b) => a.minDiff - b.minDiff || a.ord - b.ord)
    for (const cand of ranked) {
      if (visited.has(cand.id)) continue
      const q = pickQuestion(cand.id, usedQuestions)
      if (q) return q
    }
    for (const cand of ranked) {
      const q = pickQuestion(cand.id, usedQuestions)
      if (q) return q
    }
  }
  // 3) 模块内未访问叶子兜底
  for (const l of moduleLeafNodes(moduleId)) {
    if (visited.has(l.id)) continue
    const q = pickQuestion(l.id, usedQuestions)
    if (q) return q
  }
  return null
}

/**
 * 调度核心：依据状态机产出下一题。返回 phase=done 表示所有模块都到边界（摸底应收尾）。
 * 不在此决定终止，只负责选题；状态机的收束判定在 submitPlacement 里随每轮作答推进。
 */
function nextScheduledQuestion(
  sessionId: string, domain: string, usedQuestions: Set<string>, visited: Set<string>
): { item: QuestionRow | null; nodeId: string | null; phase: 'probe' | 'climb' | 'done' } {
  const state = loadScheduler(sessionId, domain)
  const pending = nextPendingModule(state)
  if (!pending) return { item: null, nodeId: null, phase: 'done' }

  const { moduleId, phase } = pending
  if (phase === 'probe') {
    const item = pickProbeQuestion(moduleId, usedQuestions, visited)
    if (item) return { item, nodeId: item.node_id, phase: 'probe' }
    // 出不了探针题（理论上 activeModules 已过滤）：直接到顶收束并递归找下一个模块
    saveScheduler(sessionId, markTopped(state, moduleId) as Placement18State)
    return nextScheduledQuestion(sessionId, domain, usedQuestions, visited)
  }

  // climb：从该模块最近作答节点往上爬
  const fromNode = state.modules[moduleId]?.lastNode ?? null
  const item = pickClimbQuestion(moduleId, fromNode, usedQuestions, visited)
  if (item) return { item, nodeId: item.node_id, phase: 'climb' }
  // 该方向无题可出 = 能力上沿探到顶，置 topped 后递归
  saveScheduler(sessionId, markTopped(state, moduleId) as Placement18State)
  return nextScheduledQuestion(sessionId, domain, usedQuestions, visited)
}

function usedQuestionIds(sessionId: string): Set<string> {
  return new Set(all<{ question_id: string }>(
    `SELECT question_id FROM placement_turn WHERE session_id=? AND question_id IS NOT NULL`, [sessionId])
    .map((r) => r.question_id))
}
function visitedNodes(sessionId: string): Set<string> {
  return new Set(all<{ node_id: string }>(
    `SELECT DISTINCT node_id FROM placement_turn WHERE session_id=? AND node_id IS NOT NULL`, [sessionId])
    .map((r) => r.node_id))
}

/** 进度按「模块收束」计：done=已到边界的模块数，total=模块数。分母小且语义清晰，避免几百考点的题量焦虑 */
function progressOf(sessionId: string, domain: string): Progress {
  const state = loadScheduler(sessionId, domain)
  const p = progressOf18(state)
  return { done: p.done, total: p.total }
}

function hydrateSession(id: string): PlacementSessionRow | undefined {
  return get<PlacementSessionRow>(`SELECT * FROM placement_session WHERE id=?`, [id])
}

function itemOf(nodeId: string | null, used: Set<string>): QuestionRow | null {
  if (!nodeId) return null
  return pickQuestion(nodeId, used)
}

export interface PlacementStart {
  sessionId: string; item: QuestionRow | null; hint: string; progress: Progress
  /** true 表示复用了该板块一个未完成的旧会话（断点续测），而非新建 */
  resumed?: boolean
}

/** 该板块最近一个未完成会话（含其已作答轮数），无则 null */
function activeSessionOf(domain: string): { row: PlacementSessionRow; turns: number } | null {
  const row = get<PlacementSessionRow>(
    `SELECT * FROM placement_session WHERE domain=? AND status='active' ORDER BY updated_at DESC LIMIT 1`, [domain])
  if (!row) return null
  const turns = get<{ n: number }>(`SELECT COUNT(*) n FROM placement_turn WHERE session_id=?`, [row.id])?.n ?? 0
  return { row, turns }
}

export function startPlacement(domain: string, opts: { force?: boolean } = {}): PlacementStart {
  // 默认先复用同板块未完成的会话：点板块卡片不再盲目新建空壳，避免旧进度被「最近 active」顶掉而重做（R14）。
  // force=true 才显式开新一轮（测试隔离 / 将来「放弃重测」入口用）。
  if (!opts.force) {
    const active = activeSessionOf(domain)
    if (active) {
      const { row, turns } = active
      const used = usedQuestionIds(row.id)
      const item = itemOf(row.current_node_id, used)
      if (item) {
        return {
          sessionId: row.id, item, resumed: true,
          hint: `继续上次的摸底（已做 ${turns} 题，进度不会丢）：${row.current_node_id ? nodeTitle(row.current_node_id) : ''}`,
          progress: progressOf(row.id, domain)
        }
      }
      // 同 resumePlacement 的僵尸收口：该会话已取不到题（空壳/题目被下掉），置 aborted 后落到新建逻辑
      run(`UPDATE placement_session SET status='aborted', updated_at=? WHERE id=? AND status='active'`, [nowStr(), row.id])
    }
  }

  const startNode = pickStartNode(domain)
  const used = new Set<string>()
  // 先纯读探测能否真正出题：板块只有骨架节点（无 L4 叶子）或叶子下没有 active 母题时，
  // 直接返回空结果且不落会话——否则会留下一个 current_node_id 指向空、永远白屏的僵尸会话（R12）。
  const probe = itemOf(startNode, used)
  if (!startNode || !probe) {
    return {
      sessionId: '', item: null,
      hint: '这个板块的题库还在建设中（暂无完整考点与题目），暂时无法摸底',
      progress: { done: 0, total: level4Nodes(domain).length }
    }
  }
  const id = randomUUID().slice(0, 8)
  const ts = nowStr()
  run(`INSERT INTO placement_session(id,domain,status,current_node_id,level,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?)`,
    [id, domain, 'active', startNode, 2, ts, ts])
  // v18：初始化边界探测状态机（模块队列按学习阶段排序），第一题由调度器从最浅模块的探针产出
  const state = emptyPlacement18(activeModules(domain).map((m) => m.id)) as Placement18State
  saveScheduler(id, state)
  const first = nextScheduledQuestion(id, domain, used, new Set<string>())
  const item = first.item
  if (!item) {
    // 极端兜底：调度器取不到题（与上面 probe 矛盾时防御），收口为 aborted，不留白屏会话
    run(`UPDATE placement_session SET status='aborted', updated_at=? WHERE id=?`, [nowStr(), id])
    return {
      sessionId: '', item: null,
      hint: '这个板块的题库还在建设中（暂无完整考点与题目），暂时无法摸底',
      progress: { done: 0, total: level4Nodes(domain).length }
    }
  }
  run(`UPDATE placement_session SET current_node_id=? WHERE id=?`, [item.node_id, id])
  return {
    sessionId: id, item, resumed: false,
    hint: `从最基础的考点开始：${nodeTitle(item.node_id)}。会就逐级给你更难的进阶题，直到探到你的天花板；不会可以直接说，这个方向立刻收住、不纠缠。系统判断清楚你的水准就结束，不固定题数。`,
    progress: progressOf(id, domain)
  }
}

export function nextPlacementItem(sessionId: string): { item: QuestionRow | null; hint: string; progress: Progress } {
  const s = hydrateSession(sessionId)
  if (!s) return { item: null, hint: '摸底会话已过期', progress: { done: 0, total: 0 } }
  if (s.status !== 'active') return { item: null, hint: '本轮摸底已结束', progress: progressOf(sessionId, s.domain) }
  const used = usedQuestionIds(sessionId)
  const item = itemOf(s.current_node_id, used)
  return { item, hint: item ? `当前考点：${nodeTitle(s.current_node_id!)}` : '该考点已无更多题目', progress: progressOf(sessionId, s.domain) }
}

/** 断点续测：取该板块最近一个未完成会话 */
export function resumePlacement(domain?: string): { sessionId: string; item: QuestionRow | null; hint: string; progress: Progress; domain: string } | null {
  const where = domain ? `domain=? AND status='active'` : `status='active'`
  const params = domain ? [domain] : []
  const s = get<PlacementSessionRow>(
    `SELECT * FROM placement_session WHERE ${where} ORDER BY updated_at DESC LIMIT 1`, params)
  if (!s) return null
  const used = usedQuestionIds(s.id)
  const item = itemOf(s.current_node_id, used)
  // 僵尸会话收口：current_node_id 为空、或该节点已无可用题（如空板块遗留、节点题目被下掉），
  // 再 resume 只会得到 item=null 的白屏。直接置 aborted，让前端回到介绍页（R12）。
  if (!item) {
    run(`UPDATE placement_session SET status='aborted', updated_at=? WHERE id=? AND status='active'`, [nowStr(), s.id])
    return null
  }
  return { sessionId: s.id, item, domain: s.domain, hint: `继续上次的摸底：${s.current_node_id ? nodeTitle(s.current_node_id) : ''}`, progress: progressOf(s.id, s.domain) }
}

export interface PlacementSubmitResult {
  scale4: number; pct: number; verdict: string; gapType: GapType | null
  finished: boolean; nextLevel: number; item: QuestionRow | null; hint: string; progress: Progress
}

export async function submitPlacement(
  sessionId: string, qid: string, answer: unknown,
  opts: { gapType?: GapType | null; gapNote?: string | null } = {}
): Promise<PlacementSubmitResult> {
  const s = hydrateSession(sessionId)
  if (!s) throw new Error('摸底会话已过期')
  if (s.status !== 'active') throw new Error('本轮摸底已结束')
  const q = questionOf(qid)
  if (!q) throw new Error('题目不存在')
  const gapType = opts.gapType ?? null
  const isGap = gapType === 'concept' || gapType === 'code' || gapType === 'skip'
  // R19 蒙题：用户已作答但承认是猜的——仍照常判分（让他看到对错与解析、有学习价值），
  // 但能力档位强制记 0，状态机按「不会」收束、掌握度不虚高。与 isGap 的「不判分直接 0」区分。
  const isGuess = gapType === 'guess'

  let scale4 = 0
  let pct = 0
  let gradingKind: 'auto' | 'ai' | 'self' = 'auto'
  let verdict = ''

  if (isGap) {
    // 用户主动标记不会：不做 AI 批改，直接记 0 档；skip 不写 attempt/SRS（不算答错，只是没做）
    scale4 = 0
    pct = 0
    gradingKind = 'self'
    verdict = gapType === 'skip' ? '已跳过，标记为未掌握'
      : gapType === 'code' ? '记录缺口：原理可能懂，但手写代码不过关，下探相关基础'
      : '记录缺口：这个知识点没掌握，下探到前置知识'
    if (gapType !== 'skip') {
      recordAttempt({ qid, mode: 'placement', answer: answer ?? null, scale4: 0, gradingKind: 'self' })
    }
  } else {
    try {
      const g = await gradeAnswer(q, { qid, answer, mode: 'placement' })
      scale4 = g.scale4; pct = g.pct; gradingKind = g.gradingKind; verdict = g.verdict ?? ''
    } catch (e: any) {
      // 无 AI 端点：客观题 gradeAnswer 内部可自动判；主观题降级为自评档 1，不阻断摸底
      scale4 = 1; pct = 40; gradingKind = 'self'
      verdict = `AI 暂不可用，按保守档记录（${String(e?.message ?? e).slice(0, 60)}）`
    }
    if (isGuess) {
      // 蒙题：保留客观判分结果用于回看，但能力判定一律按「完全不会」0 档
      const raw = verdict
      scale4 = 0
      pct = 0
      gradingKind = 'self'
      verdict = `标记为「蒙的」：按完全不会计入能力判定（${raw || '本题不纳入掌握度'}），对错与解析仍可回看`
    }
    recordAttempt({ qid, mode: 'placement', answer, scale4, gradingKind })
  }

  // 落一轮（R15：answer 随 turn 持久化，续测进入时才能还原「我当时答了什么」；skip 无答案存 NULL）
  const answerJson = answer === null || answer === undefined ? null : JSON.stringify(answer)
  run(`INSERT INTO placement_turn(session_id,node_id,question_id,scale4,pct,verdict,gap_type,gap_note,grading_kind,answer,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    [sessionId, q.nodeId, qid, scale4, pct, verdict, gapType, opts.gapNote ?? null, gradingKind, answerJson, nowStr()])

  const visited = visitedNodes(sessionId)
  const turnCount = all(`SELECT id FROM placement_turn WHERE session_id=?`, [sessionId]).length
  const zeroStreak = countZeroStreak(sessionId)
  const level = clampLevel(s.level + (scale4 >= 3 ? 0.9 : scale4 >= 2 ? 0.35 : scale4 >= 1 ? -0.4 : -1.1))

  // ---- v18：把本轮作答喂给边界探测状态机（探针通过→爬升；不会/蒙题→该方向立即收束）----
  const curModule = q.nodeId.split('.').slice(0, 2).join('.')
  let scheduler = recordAnswer(loadScheduler(sessionId, s.domain), curModule, {
    nodeId: q.nodeId, scale4, isGap: isGap || isGuess
  }) as Placement18State
  // recordAnswer 只看对/错；是否「到顶」要靠下一次选题验证，这里先存当前状态
  saveScheduler(sessionId, scheduler)

  // ---- 终止判定 ----
  // 正常收敛：所有模块都到边界（capped 不会 / topped 到顶）。
  // 两个安全兜底：连错 N 题（基础全挂，先去补前置）、题量超安全顶（题库异常导致不收敛）。
  const allDone = allSettled(scheduler)
  const hardStop = allDone || turnCount >= SAFETY_MAX_TURNS || zeroStreak >= MAX_ZERO_STREAK

  let nextItem: QuestionRow | null = null
  let nextNodeId: string | null = null
  let hint = ''
  let finished = false
  let nextPhase: 'probe' | 'climb' | 'done' = 'done'

  if (hardStop) {
    finished = true
    finishSession(sessionId, s.domain)
    hint = allDone
      ? '每个方向都探到了你的边界（不会处或进阶顶端），水准已判清，摸底结束'
      : turnCount >= SAFETY_MAX_TURNS
        ? `已达 ${SAFETY_MAX_TURNS} 题安全上限，先按当前表现给出结论`
        : '连续多个基础考点都不会，建议先系统补前置，摸底先到这里'
  } else {
    const used = usedQuestionIds(sessionId)
    const picked = nextScheduledQuestion(sessionId, s.domain, used, visited)
    nextPhase = picked.phase
    nextItem = picked.item
    nextNodeId = picked.nodeId
    if (!nextItem) {
      // 选题返回 done：所有 pending 模块都已穷尽，正常收尾（防御性，与 allSettled 等价路径）
      finished = true
      finishSession(sessionId, s.domain)
      hint = '每个方向都探到了你的边界，水准已判清，摸底结束'
    } else {
      // 若本轮模块在选题时被判定到顶（pickClimb 返回 null 已 markTopped），重新读状态给文案用
      scheduler = loadScheduler(sessionId, s.domain)
      const moduleLabel = nodeTitle(curModule)
      hint = nextPhase === 'probe'
        ? `模块扫盲：${nodeTitle(nextNodeId!)}（会就逐级加难，不会立刻收）`
        : `你在「${moduleLabel}」方向表现不错，上探更难的：${nodeTitle(nextNodeId!)}`
    }
    run(`UPDATE placement_session SET current_node_id=?, level=?, updated_at=? WHERE id=?`,
      [finished ? null : nextNodeId, level, nowStr(), sessionId])
  }

  return {
    scale4, pct, verdict, gapType, finished,
    nextLevel: Number(level.toFixed(1)),
    item: finished ? null : nextItem,
    hint: finished ? hint : hint || (nextItem ? `当前考点：${nodeTitle(nextNodeId!)}` : ''),
    progress: progressOf(sessionId, s.domain)
  }
}

function clampLevel(v: number) { return Math.max(1, Math.min(4.6, v)) }
function countZeroStreak(sessionId: string): number {
  const rows = all<{ scale4: number }>(`SELECT scale4 FROM placement_turn WHERE session_id=? ORDER BY id DESC`, [sessionId])
  let n = 0
  for (const r of rows) { if (r.scale4 === 0) n++; else break }
  return n
}

function finishSession(sessionId: string, domain: string) {
  const turns = all<any>(`SELECT node_id, scale4, gap_type FROM placement_turn WHERE session_id=?`, [sessionId])
  const byNode = new Map<string, { scale4: number; gaps: string[] }>()
  for (const t of turns) {
    const cur = byNode.get(t.node_id) ?? { scale4: 0, gaps: [] }
    cur.scale4 = Math.max(cur.scale4, Number(t.scale4) || 0)
    if (t.gap_type) cur.gaps.push(t.gap_type)
    byNode.set(t.node_id, cur)
  }
  const scales = [...byNode.values()].map((v) => v.scale4)
  const avg = scales.length ? scales.reduce((a, b) => a + b, 0) / scales.length : 0
  const pct = Math.round((avg / 3) * 100)
  // 建议起点：未点亮的 L3/L4 节点里取前 10
  const starts = all<{ id: string; title: string }>(
    `SELECT n.id,n.title FROM nodes n LEFT JOIN node_mastery m ON m.node_id=n.id
     WHERE n.domain=? AND n.level>=3 AND COALESCE(m.lit,0)=0 ORDER BY n.level ASC, n.ord LIMIT 10`, [domain])
    .map((n) => ({ id: n.id, title: n.title }))
  const summary = JSON.stringify({ pct, scale4: avg, nodes: [...byNode.entries()].map(([id, v]) => ({ id, ...v })), starts })
  run(`UPDATE placement_session SET status='done', finished_at=?, summary=?, updated_at=?, current_node_id=NULL WHERE id=?`,
    [nowStr(), summary, nowStr(), sessionId])
  // 兼容老 placement 表（历史趋势页仍读它）
  run(`INSERT INTO placement(domain,scale4,pct,detail,created_at) VALUES(?,?,?,?,datetime('now','localtime'))`,
    [domain, avg, pct, JSON.stringify(turns)])
  settingSet(`placement.last.${domain}`, { pct, scale4: avg, starts, at: new Date().toISOString() })
}

/** 各板块最新一次摸底结果（HomeView 用，形状与旧版兼容） */
export function placementResults() {
  return all<any>(`SELECT domain, summary, finished_at FROM placement_session WHERE status='done'
      ORDER BY finished_at DESC`).reduce((acc: any, r) => {
    if (acc[r.domain]) return acc
    let parsed: any = {}
    try { parsed = r.summary ? JSON.parse(r.summary) : {} } catch { /* ignore */ }
    acc[r.domain] = {
      domain: r.domain, pct: parsed.pct ?? 0, scale4: parsed.scale4 ?? 0,
      starts: parsed.starts ?? settingGet<any>(`placement.last.${r.domain}`)?.starts ?? [],
      at: r.finished_at
    }
    return acc
  }, {})
}

export function placementHistory(limit = 30) {
  return all(`SELECT id,domain,scale4,pct,created_at FROM placement ORDER BY id DESC LIMIT ?`, [limit])
}

/** 缺口清单：摸底中明确标记「不会」的节点，给「我到底不会哪」用 */
export function placementGaps(domain?: string) {
  const dom = domain ? `AND s.domain=?` : ''
  const params = domain ? [domain] : []
  return all<{ nodeId: string; title: string; gapType: string; count: number; lastAt: string }>(
    `SELECT t.node_id AS nodeId, n.title AS title, t.gap_type AS gapType,
        COUNT(*) AS count, MAX(t.created_at) AS lastAt
     FROM placement_turn t JOIN placement_session s ON s.id=t.session_id
     LEFT JOIN nodes n ON n.id=t.node_id
     WHERE t.gap_type IS NOT NULL ${dom}
     GROUP BY t.node_id, t.gap_type ORDER BY count DESC, lastAt DESC`, params)
}

/** R15 续测回看：一次摸底已作答轮次的还原快照，形状对齐前端 PlacementSnap（guessed 不持久化，恒 false） */
export interface PlacementTurnSnap {
  item: QuestionRow
  answer: unknown
  scale4: number
  pct: number
  verdict: string
  gapType: string | null
  guessed: boolean
}

function parseAnswer(raw: string | null | undefined): unknown {
  if (raw == null) return null
  try { return JSON.parse(raw) } catch { return raw }
}

/**
 * 还原某会话内按作答顺序排列的全部已作答题，供断点续测后填充前端胶片回看。
 * - 新数据直接读 placement_turn.answer（R15 起随轮持久化）；
 * - 老数据该列为 NULL，回退到 attempts 表里同题 mode='placement'、时间最接近的一条答案；
 * - 题目已被重建删除、hydrate 不到的轮次跳过（不阻塞其余题回看）。
 */
export function placementTurns(sessionId: string): PlacementTurnSnap[] {
  const turns = all<{
    id: number; question_id: string | null; scale4: number; pct: number
    verdict: string | null; gap_type: string | null; answer: string | null; created_at: string
  }>(`SELECT id,question_id,scale4,pct,verdict,gap_type,answer,created_at
      FROM placement_turn WHERE session_id=? AND question_id IS NOT NULL ORDER BY id ASC`, [sessionId])
  if (!turns.length) return []

  const qids = [...new Set(turns.map((t) => t.question_id as string))]
  const items = new Map(hydrateQuestions(qids).map((q) => [q.id, q]))

  // 老数据兜底：一次性取本会话相关题目的 placement 作答，按题分组、按时间排序，顺序匹配取最近一条
  const fallback = new Map<string, string[]>()
  if (turns.some((t) => t.answer == null)) {
    const ph = qids.map(() => '?').join(',')
    const rows = all<{ question_id: string; answer: string | null; created_at: string }>(
      `SELECT question_id,answer,created_at FROM attempts
       WHERE mode='placement' AND question_id IN (${ph}) ORDER BY id ASC`, qids)
    for (const r of rows) {
      if (!fallback.has(r.question_id)) fallback.set(r.question_id, [])
      if (r.answer != null) fallback.get(r.question_id)!.push(r.answer)
    }
  }
  const fbCursor = new Map<string, number>()

  const snaps: PlacementTurnSnap[] = []
  for (const t of turns) {
    const item = items.get(t.question_id as string)
    if (!item) continue
    let answer: unknown = null
    if (t.answer != null) {
      answer = parseAnswer(t.answer)
    } else {
      const pool = fallback.get(t.question_id as string)
      if (pool?.length) {
        const idx = fbCursor.get(t.question_id as string) ?? 0
        answer = parseAnswer(pool[Math.min(idx, pool.length - 1)])
        fbCursor.set(t.question_id as string, idx + 1)
      }
    }
    snaps.push({
      item, answer,
      scale4: Number(t.scale4) || 0,
      pct: Number(t.pct) || 0,
      verdict: t.verdict ?? '',
      gapType: t.gap_type ?? null,
      guessed: false
    })
  }
  return snaps
}

/* ===================================================================== *
 * R23「我不会」自由描述 → 缺口类型判定（interpretGapNote）
 *
 * 修复的问题：原「我不会」区只把输入框当「可选补充」，真正能提交的只有三个快捷卡片，
 * 用户打了一大段“不知道 AST 是什么”却发现提交不下去 —— 输入框形同摆设。
 * 现在输入框本身就是一条完整提交路径：这段自由描述由本服务判成 concept/code/skip，
 * 前端带着原话 + 判定一起落库（gap_note 保留用户原话，缺口报告仍按类型聚合）。
 *
 * 判定顺序（延迟从低到高）：
 *   1) 中文强信号规则：0 延迟、纯函数、可离线单测，覆盖绝大多数直白表达；
 *   2) 规则未命中再交 AI fast 档判类型（30s 超时、不重试修复轮，避免拖慢提交）；
 *   3) AI 不可用/输出不可解析 → 保守记 concept（缺口一定存在，只是类型不确定）。
 * ===================================================================== */

export type GapKind = Exclude<GapType, 'guess'>
export interface GapInterpret {
  gapType: GapKind
  source: 'rule' | 'ai' | 'fallback'
  /** 归一化后的用户原话（截断到 800 字），原样写进 gap_note */
  note: string
}

/** 「跳过」「手写/编码」「概念/原理」三组中文强信号的纯函数实现放在 shared/gap-rules.mjs：
 *  零依赖，qa 脚本能直接 import 做真实用例断言，服务与测试永远同一份规则，不会各写一份走偏。 */

/** 规则分类（命中返回缺口类型，未命中返回 null 交给 AI） */
export function classifyGapNote(note: string): GapKind | null {
  return classifyGapNoteRaw(note) as GapKind | null
}

/** 把 AI 的自由输出（JSON / 英文枚举 / 中文标签）归一化为三类之一，不可解析返回 null */
export function normalizeGapKind(raw: unknown): GapKind | null {
  return normalizeGapKindRaw(raw) as GapKind | null
}

/**
 * 用户「我不会」时写的一句自由描述 → 缺口类型。
 * 空描述直接抛错（前端已禁用按钮，这里兜住 IPC 直调）。
 */
export async function interpretGapNote(note: string, nodeId?: string | null): Promise<GapInterpret> {
  const text = String(note ?? '').trim().slice(0, 800)
  if (!text) throw new Error('先写一句你卡在哪，或直接选下面三个选项之一')

  const ruled = classifyGapNote(text)
  if (ruled) return { gapType: ruled, source: 'rule', note: text }

  try {
    const title = nodeId ? nodeTitle(nodeId) : ''
    const res = await chat({
      task: 'gap_triage',
      role: 'fast',
      system: `你是练习册的摸底系统的「缺口分类器」。用户在标记「我不会」时写了一句自由描述，把它归为三类之一：
- concept：知识点/原理没掌握（不知道某概念是什么、没学过、看不懂、讲不清）
- code：原理大概懂，但手写/编码实现不出来
- skip：这题不想答了、主动想跳过
只输出 JSON：{"gapType":"concept"}，不要任何解释、不要 markdown 代码块。`,
      user: `# 当前考点
${title || '（未提供）'}

# 用户的描述
${text}`,
      refId: nodeId ?? undefined,
      refType: 'node',
      // 分类只需要一个短 JSON：限 token + 12s 超时（超时不可重试，直接走兜底），
      // 提交是交互动作，宁可保守记 concept 也不让用户对着 loading 干等半分钟
      maxTokens: 40,
      timeoutMs: 12000
    })
    const kind = normalizeGapKind(res.text)
    if (kind) return { gapType: kind, source: 'ai', note: text }
  } catch { /* 没配端点 / 服务未启动 / 输出不可解析 → 落到下面的兜底 */ }

  return { gapType: 'concept', source: 'fallback', note: text }
}
