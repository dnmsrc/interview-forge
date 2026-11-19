/**
 * 项目闯关服务：把 content/projects/*.json 的关卡交给沙箱执行，判通过后存档并发放奖励。
 *
 * 三个刻意的设计选择：
 *
 * 1) 关卡内容放文件、不放数据库表。内容是「课程」，用户进度才是数据；
 *    改了 json 重启即生效，不用重新 seed，也不会因为换一版课程把进度清掉。
 *
 * 2) 判题在主进程做，用户代码永不进渲染进程。渲染层只拿到「第几个用例红/绿 + 输出」，
 *    拿不到测试源码——不然打开 devtools 就能读到答案和断言。
 *
 * 3) 奖励走 game 服务（同一个 XP 池 + 同一套事件流），不另起一套成长体系：
 *    用户打开庆祝弹窗时看到的 +XP 和答题得到的没有区别，不需要维护第二套 UI。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { contentRoot, all, get, run, tx } from '../db'
import { runLevel, runStages } from '../../shared/project-core.mjs'
import { computeCoverage, indexNodes, topicKey } from '../../shared/project-coverage.mjs'
import { recordProjectLevel } from './game'
import type {
  CoverageBucket, ProjectCard, ProjectCoverage, ProjectDetail, ProjectLevelCard,
  ProjectRunResult, ProjectStageRun
} from '../../shared/api'

/** 知识图谱节点（content/nodes 下的文件都是这种数组；本服务只用其中几段） */
interface GraphNode {
  id: string; title?: string; level?: number
  domain?: string; stack?: string; topic?: string; mustMaster?: boolean
}

interface LevelFile {
  id: string; title: string; emoji?: string; xp?: number
  goal: string; why?: string; task?: string
  /** 这一关讲透并验证的知识点（知识图谱节点 id）；构建时校验存在性 */
  nodes?: string[]
  prereq?: { title: string; md: string }[]
  api?: { name: string; sig: string; args: string; returns: string; example: string }[]
  steps?: { todo: string; title: string; how: string; code?: string }[]
  /** v3：思维链 + 分阶段（每阶段一段完整代码 + 该阶段的测试） */
  thinking?: { title: string; md: string }[]
  stages?: {
    n: number; title: string; think: string; hint: string
    vocab?: { term: string; md: string }[]
    code: string; test: string
    /** 失败诊断：与 test 里 check() 的顺序一一对应；只在失败的用例上回给前端 */
    diag?: string[]
  }[]
  /** 老关卡（整关一次跑）的失败诊断：与 tests 里 check() 的顺序一一对应 */
  testDiag?: string[]
  finalCode?: string; usage?: string
  skeleton: string; solution: string; tests: string
  hints?: string[]; concepts?: { title: string; md: string }[]
}

interface ProjectFile {
  id: string; version?: number; title: string; emoji?: string; tagline?: string
  /** 领域分类：决定「项目闯关」列表里归到哪一栏。缺省时前端归入「其它」。 */
  domain?: string
  stack?: string[]; intro?: string; outcome?: string
  levels: LevelFile[]
}

const DEFAULT_XP = 40

function projectsDir() { return join(contentRoot(), 'projects') }
function nodesDir() { return join(contentRoot(), 'nodes') }

/**
 * 读知识图谱节点。覆盖统计只需要 id/title/level/topic 这几段，所以不做过滤、
 * 也不缓存——450 个小文件单次几毫秒，改了内容重启即生效，比维护失效逻辑便宜。
 */
function loadGraphNodes(): GraphNode[] {
  const dir = nodesDir()
  if (!existsSync(dir)) return []
  const out: GraphNode[] = []
  for (const rel of readdirSync(dir, { recursive: true }) as string[]) {
    if (!rel.endsWith('.json') || rel.endsWith('_skeleton.json')) continue
    try {
      const data = JSON.parse(readFileSync(join(dir, rel), 'utf8'))
      const list = Array.isArray(data) ? data : data?.nodes
      if (Array.isArray(list)) out.push(...list)
    } catch (e: any) {
      console.error(`[project] 解析知识点文件 ${rel} 失败：${e?.message ?? e}`)
    }
  }
  return out
}

/**
 * 关卡所属章节：取这一关声明的第一个知识点的 topic（domain.stack.topic），
 * 用该 topic 在知识图谱里的中文标题当章节名。
 *
 * 为什么按 topic 分组而不是每 N 关硬切：关卡和知识点的映射本来就要写，
 * 顺手用它决定「这一关属于哪一章」，章节就永远和内容对得上；
 * 硬切出来的「第 1-6 关」既没有语义，内容一改顺序就错。
 */
function chapterOf(lv: LevelFile, nodeMap: Map<string, any>): { key: string; title: string } | null {
  const list = Array.isArray(lv.nodes) ? lv.nodes : []
  const first = list.find((id) => nodeMap.has(id))
  if (!first) return null
  const key = topicKey(first)
  const parent = nodeMap.get(key)
  const fallback = String(key.split('.')[2] ?? key).replace(/-/g, ' ')
  return { key, title: parent?.title ?? fallback }
}

/** 项目声明了哪些知识点（去重、只算图谱里存在的） */
function projectNodeIds(p: ProjectFile, nodeMap: Map<string, any>): string[] {
  const seen = new Set<string>()
  for (const lv of p.levels) {
    for (const id of lv.nodes ?? []) {
      if (nodeMap.has(id)) seen.add(id)
    }
  }
  return [...seen]
}

/** 读全部项目文件。内容是小文件，读盘一次的开销远小于 IPC 往返，不做缓存以免改了 json 看不到变化。 */
function loadAll(): ProjectFile[] {
  const dir = projectsDir()
  if (!existsSync(dir)) return []
  const out: ProjectFile[] = []
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue
    try {
      const p = JSON.parse(readFileSync(join(dir, file), 'utf8')) as ProjectFile
      if (p?.id && Array.isArray(p.levels) && p.levels.length) out.push(p)
    } catch (e: any) {
      console.error(`[project] 解析 ${file} 失败：${e?.message ?? e}`)
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

function loadOne(id: string): ProjectFile {
  const p = loadAll().find((x) => x.id === id)
  if (!p) throw new Error('项目不存在')
  return p
}

/**
 * 连续失败几次之后允许直接看这一步的答案。
 *
 * 为什么是 3：1 次太急（第一遍就是在试错，答案会替掉「自己试出来」的关键一步），
 * 5 次太晚（同一个坑里耗到第 5 次，人已经不是在学了，是在怀疑自己）。
 * 3 次刚好是「我认真试过几遍，但确实缺一个零件」的位置。
 */
const ANSWER_AFTER = 3

interface LevelProgress {
  done: boolean
  attempts: number
  /** 通过过的阶段号（只增不减）；内容改版后由调用方用 stage_base 校验，不匹配就不用 */
  stageDone: number[]
  /** 这份阶段进度是在哪一版阶段结构下写就的 */
  stageBase: string | null
  /** 每步的连续失败次数：{步骤号: 次数}。通过即清零，只记当前卡住的那一步 */
  stageFails: Record<string, number>
  /** 看过答案的步骤号（不扣 XP，但要如实标出来） */
  answerSteps: number[]
}

function progressMap(projectId: string): Map<string, LevelProgress> {
  const rows = all<{
    level_id: string; done: number; attempts: number
    stage_done: string | null; stage_base: string | null
    stage_fails: string | null; answer_steps: string | null
  }>(
    `SELECT level_id, done, attempts, stage_done, stage_base, stage_fails, answer_steps
       FROM project_progress WHERE project_id=?`, [projectId])
  const m = new Map<string, LevelProgress>()
  for (const r of rows) {
    m.set(r.level_id, {
      done: r.done === 1,
      attempts: r.attempts,
      stageDone: parseStageDone(r.stage_done),
      stageBase: r.stage_base,
      stageFails: parseStageFails(r.stage_fails),
      answerSteps: parseStageDone(r.answer_steps)
    })
  }
  return m
}

function parseStageDone(raw: string | null): number[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((n: unknown) => Number.isInteger(n)) as number[] : []
  } catch {
    return []
  }
}

function parseStageFails(raw: string | null): Record<string, number> {
  if (!raw) return {}
  try {
    const v = JSON.parse(raw)
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    const out: Record<string, number> = {}
    for (const [k, n] of Object.entries(v)) {
      if (Number.isInteger(Number(k)) && Number.isFinite(Number(n)) && Number(n) > 0) out[k] = Number(n)
    }
    return out
  } catch {
    return {}
  }
}

/**
 * 骨架指纹：草稿只有在「它是在这一版骨架下写的」时才可信。
 *
 * 内容改版是常态（这一轮就把 5 关拆成了 9 关），而草稿存在库里、寿命比内容长。
 * 不做这层校验的话，用户升级后打开关卡，看到的是一段上一版留下的旧代码，
 * 跑测试满屏红——他既不知道自己错在哪，也不知道这段代码根本不是这一关的。
 * 指纹不匹配就退回骨架，代价只是重敲一次，比「看起来像自己的错」好得多。
 */
function baseHash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

/** 读草稿，连同它写就时的骨架指纹一起返回；没有草稿返回 null */
function draftOf(projectId: string, levelId: string): { code: string; base: string | null } | null {
  const row = get<{ draft_code: string | null; draft_base: string | null }>(
    `SELECT draft_code, draft_base FROM project_progress WHERE project_id=? AND level_id=?`, [projectId, levelId])
  if (!row?.draft_code) return null
  return { code: row.draft_code, base: row.draft_base }
}

/**
 * 从一步的测试源码里抽出检查点名字：`check('名字', ...)`。
 *
 * 只取名字，不取断言正文。一步的测试里断言写 `same(x, 0)` 还是 `same(x, 1)`，
 * 是同一批检查点的不同严格度，不构成「这一步被重新定义了」。
 */
function caseNamesOf(test: string): string[] {
  return [...String(test ?? '').matchAll(/check\(\s*['"`]([^'"`]*)['"`]/g)].map((m) => m[1])
}

/**
 * 阶段结构指纹：步骤号 + 标题 + 该步的检查点名字列表。
 *
 * 早先的版本把「测试源码全文 + 参考代码」也揉进指纹，于是任何一个字符的调整
 * （哪怕只是把 `same(s.__setCount, 0)` 放宽成 `same(s.__setCount - before, 2)`）
 * 都会让 stage_base 整份失效——用户明明四步过了三步，只因为我把一句断言改宽松，
 * 进度条就退回第 1 步。那不是「内容改版」，是判分实现被我修复了，旧通过依然有效。
 *
 * 现在只认「这一步是第几步、叫什么、要过哪几个检查点」这三件事：
 * 加检查点、改检查点名、调整步骤划分 → 指纹变，旧账作废（这是必须的）；
 * 只调断言严宽 → 指纹不变，进度保留。
 *
 * 取舍写在这里：如果有人把某个检查点的断言从松改严、名字不动，旧账会保留成假绿，
 * 直到用户下次跑测试才红。这比「我每次修个提示文案，用户的全关卡进度就清零」轻得多。
 */
function stageHash(stages: { n: number; title: string; test: string }[] | undefined): string {
  if (!stages?.length) return ''
  return baseHash(stages.map((s) => `${s.n}|${s.title}|${caseNamesOf(s.test).join(',')}`).join('\n'))
}

/** 去掉全部空白再比：多敲一个换行不算「动过笔」 */
function squashWs(s: string): string {
  return String(s ?? '').replace(/\s+/g, '')
}

/**
 * 把「失败诊断」挂到跑红的用例上。
 *
 * 诊断按 test 里 check() 的书写顺序与 case 对齐（validator 保证条数一致）。
 * 只给失败用例：通过的用例没有「怎么错的」可讲，前端也不显示。
 * 放在主进程做而不是把诊断随 detail 下发，是因为诊断话说得比 hint 具体
 * （「给 __raw 单开一个分支」这种），提前下发等于塞了一份接近答案的清单。
 */
function withDiag(cases: any[], diag?: string[] | null): any[] {
  if (!Array.isArray(diag) || !diag.length) return cases
  return cases.map((c, i) => (c?.ok || !diag[i] ? c : { ...c, diag: diag[i] }))
}

/** 前置关卡是否都已通关：第 0 关永远可做，其余要求上一关 done */
function unlockedAt(levels: LevelFile[], done: Map<string, { done: boolean }>, idx: number): boolean {
  if (idx <= 0) return true
  return done.get(levels[idx - 1].id)?.done === true
}

/** 测试用例数：不用把 tests 源码发给前端，只给个数让界面显示「4 个检查点」 */
function countCases(tests: string): number {
  return (tests.match(/\bcheck\s*\(/g) ?? []).length
}

export function projectList(): ProjectCard[] {
  const nodeMap = indexNodes(loadGraphNodes()) as Map<string, any>
  return loadAll().map((p) => {
    const prog = progressMap(p.id)
    const doneCount = p.levels.filter((l) => prog.get(l.id)?.done).length
    const next = p.levels.find((l) => !prog.get(l.id)?.done)
    return {
      id: p.id, domain: p.domain ?? '', title: p.title, emoji: p.emoji ?? '🧩', tagline: p.tagline ?? '',
      stack: p.stack ?? [], levelCount: p.levels.length, doneCount,
      nodeCount: projectNodeIds(p, nodeMap).length,
      nextLevelId: next?.id ?? null,
      started: doneCount > 0, finished: doneCount === p.levels.length
    }
  })
}

export function projectDetail(id: string): ProjectDetail {
  const p = loadOne(id)
  const prog = progressMap(id)
  const nodeMap = indexNodes(loadGraphNodes()) as Map<string, any>
  const coveredNodes = projectNodeIds(p, nodeMap)
  const allTargets = [...nodeMap.values()].filter((n) => Number(n?.level ?? 0) >= 3).length
  const doneCount = p.levels.filter((l) => prog.get(l.id)?.done).length
  const levels: ProjectLevelCard[] = p.levels.map((lv, idx) => {
    const pr = prog.get(lv.id)
    const isDone = pr?.done === true
    const saved = draftOf(id, lv.id)
    const draftOk = !!saved && saved.base === baseHash(lv.skeleton)
    // 阶段进度只在「同一版阶段结构」下才可信；老关卡（没有 stages）永远是空
    const curStageBase = stageHash(lv.stages)
    const sameStageBase = !!curStageBase && pr?.stageBase === curStageBase
    const stageDone = sameStageBase ? pr!.stageDone : []
    /** 看过答案的步骤：同一版结构下才认，且答案只到这一步为止（后面步骤的代码不在里面） */
    const answerSteps = sameStageBase ? pr!.answerSteps : []
    return {
      id: lv.id, title: lv.title, emoji: lv.emoji ?? '▸', index: idx,
      goal: lv.goal, why: lv.why ?? '', task: lv.task ?? '',
      prereq: lv.prereq ?? [], api: lv.api ?? [], steps: lv.steps ?? [],
      hints: lv.hints ?? [], concepts: lv.concepts ?? [], xp: lv.xp ?? DEFAULT_XP,
      thinking: lv.thinking ?? [],
      // 知识点映射：这一关讲透的知识点 + 据它推出的章节（前端按章节分网格）
      nodes: (lv.nodes ?? []).filter((n) => nodeMap.has(n)),
      chapter: chapterOf(lv, nodeMap),
      // 阶段：测试源码留在主进程，只给检查点个数。
      // 这一步的完整代码在「这一步已经通过」或整关通关后下发：中途要自己写出来才看得到。
      // 例外是「连续失败到门槛、主动点了看答案」的步骤——那几步的 code 也要下发，
      // 否则刷新一次答案就消失，用户还得再卡三轮。
      stages: (lv.stages ?? []).map((st) => ({
        n: st.n, title: st.title, think: st.think, hint: st.hint,
        vocab: st.vocab ?? [],
        code: isDone || stageDone.includes(st.n) || answerSteps.includes(st.n) ? st.code : null,
        caseCount: countCases(st.test)
      })),
      // 刷新页面不丢：服务端记住「我通过过哪几步」，前端据此外推当前推进到哪
      stageDone,
      /** 每步连续失败了几次：刷新之后「还差 1 次就能看答案」这件事也得还在 */
      stageFails: sameStageBase ? pr!.stageFails : {},
      answerSteps,
      finalCode: isDone ? (lv.finalCode ?? null) : null,
      usage: isDone ? (lv.usage ?? null) : null,
      done: isDone, attempts: pr?.attempts ?? 0,
      unlocked: unlockedAt(p.levels, prog, idx),
      skeleton: lv.skeleton,
      draft: draftOk ? saved!.code : lv.skeleton,
      // 参考答案只发给已通关的关卡：没通过时连字段都不出现，避免 devtools 里直接抄
      solution: isDone ? lv.solution : null,
      caseCount: countCases(lv.tests)
    }
  })
  return {
    id: p.id, domain: p.domain ?? '', title: p.title, emoji: p.emoji ?? '🧩', tagline: p.tagline ?? '',
    stack: p.stack ?? [], levelCount: p.levels.length, doneCount,
    nodeCount: coveredNodes.length,
    nextLevelId: p.levels.find((l) => !prog.get(l.id)?.done)?.id ?? null,
    started: doneCount > 0, finished: doneCount === p.levels.length,
    intro: p.intro ?? '', outcome: p.outcome ?? '', levels,
    coverage: {
      covered: coveredNodes.length,
      total: allTargets,
      ratio: allTargets ? coveredNodes.length / allTargets : 0
    }
  }
}

export function projectSaveDraft(projectId: string, levelId: string, code: string) {
  const lv = loadOne(projectId).levels.find((l) => l.id === levelId)
  if (!lv) throw new Error('关卡不存在')
  run(`INSERT INTO project_progress(project_id, level_id, draft_code, draft_base, updated_at)
       VALUES(?,?,?,?,datetime('now','localtime'))
       ON CONFLICT(project_id, level_id) DO UPDATE SET
         draft_code=excluded.draft_code,
         draft_base=excluded.draft_base,
         updated_at=excluded.updated_at`,
    [projectId, levelId, String(code ?? ''), baseHash(lv.skeleton)])
  return { ok: true }
}

/**
 * 跑一关。无论红绿都记一次 attempts，并把当前代码存成草稿——
 * 用户切走再回来，编辑器里还是他上次敲到的地方（这一条比想象中重要，
 * 卡住的时候人一定会离开页面）。
 *
 * stepBase 是「这一步开始时编辑器里的代码」，由前端在切步/载入时记下的快照传来。
 * 它只在算「这次失败算不算数」时用：代码和它逐字相同 = 人还没动笔，不该记一次失败。
 * 不传的旧调用退回「上一步的参考实现」当基线，行为和以前完全一致。
 *
 * stepN 是「我此刻站在第几步」。串行判定会把后面的步也跑一遍——站在第 3 步跑，
 * 第 4 步必然红，那是「还没写到」，不是失败。只有红在 stepN 上才会计数。
 */
export async function projectRunLevel(
  projectId: string, levelId: string, code: string, stepBase?: string, stepN?: number
): Promise<ProjectRunResult> {
  const p = loadOne(projectId)
  const idx = p.levels.findIndex((l) => l.id === levelId)
  if (idx < 0) throw new Error('关卡不存在')
  const lv = p.levels[idx]
  const prog = progressMap(projectId)
  if (!unlockedAt(p.levels, prog, idx)) throw new Error('上一关还没通关，先把前面的做完')

  const wasDone = prog.get(lv.id)?.done === true
  const attempts = (prog.get(lv.id)?.attempts ?? 0) + 1
  const src = String(code ?? '')
  const stages = lv.stages ?? []

  /**
   * 判题分两种形态：
   * - v3 有 stages：逐阶段跑，停在你第一个没过的那步。通过的阶段把该阶段的完整代码带回前端对照。
   * - 老关卡：整关一次跑完。
   * 两种形态归一成同一个结果结构，前端只认 cases/stages/stageIndex。
   */
  let result: {
    ok: boolean; cases: any[]; stages: ProjectStageRun[]; stageIndex: number
    logs: any[]; error: any; ms: number
  }
  if (stages.length) {
    const r: any = await runStages(src, stages, { timeoutMs: 4000 })
    result = {
      ok: r.ok,
      cases: r.cases,
      stages: (r.stages ?? []).map((s: any, i: number) => ({
        n: s.n, title: s.title, ok: s.ok,
        code: s.ok ? stages[i]?.code ?? null : null,
        cases: withDiag(s.cases ?? [], stages[i]?.diag),
        skipped: s.skipped === true
      })) as ProjectStageRun[],
      stageIndex: r.stageIndex,
      logs: r.logs, error: r.error, ms: r.ms
    }
  } else {
    const r: any = await runLevel(src, lv.tests, { timeoutMs: 4000 })
    result = { ok: r.ok, cases: withDiag(r.cases ?? [], lv.testDiag), stages: [], stageIndex: 0, logs: r.logs, error: r.error, ms: r.ms }
  }

  let xpAwarded = 0
  let firstPass = false
  let projectDone = false

  /**
   * 阶段进度：本次通过的 + 库里记住的，取并集（只增不减）。
   *
   * 为什么「这次没通过」的步骤也不清掉：它记的是「我写出过能通过这一步的代码」这个事实。
   * 人重做时通常是先改坏再改好，清掉等于惩罚尝试；XP 不回收也是同一个道理。
   * 本次的红照常显示在结果面板里——两者说的是两件事，不该互相覆盖。
   */
  const stageBase = stageHash(stages)
  const keptDone = prog.get(lv.id)?.stageBase === stageBase ? prog.get(lv.id)!.stageDone : []
  const doneNow = result.stages.filter((s) => s.ok && !s.skipped).map((s) => s.n)
  const stageDone = [...new Set([...keptDone, ...doneNow])].sort((a, b) => a - b)

  /**
   * 连续失败计数：只跟「当前卡住的那一步」有关。
   *
   * 规则刻意简单——本次跑通的步清零，本次停住的那一步 +1，其余不动：
   * - 清零用「跑通」而不是「没跑到」，因为这步真的通过了，之前的账就该销；
   * - 只 +1 一步，因为一次跑测试只可能停在一个地方，把前面所有步都加一遍会把「第 1 步
   *   试错 5 次、第 2 步刚卡 1 次」算成第 2 步也该看答案；
   * - 计数挂在 stage_base 上：内容改版（步骤/测试变了）后旧账作废，不让上一版的经验
   *   替这一版开门。
   */
  const prevFails = prog.get(lv.id)?.stageBase === stageBase ? { ...prog.get(lv.id)!.stageFails } : {}
  const stageFails: Record<string, number> = stages.length ? prevFails : {}
  for (const s of result.stages) if (s.ok) delete stageFails[String(s.n)]
  const stuck = result.stages.find((s) => !s.ok && !s.skipped)
  if (stuck && !result.ok) {
    /**
     * 「没动笔就跑」不算一次错误。
     *
     * 代码仍等于「这一步开始时的样子」，说明人只是把测试又跑了一遍（很多人会这么确认），
     * 或者刚从第 N 步切到第 N+1 步还没开始写。这两种都不该被记成「第 N+1 步失败一次」——
     * 把没写过的步算进「连续失败 3 次」，会让答案按钮在用户还没尝试时就出现。
     *
     * 基线有两个来源，优先用前者：
     * 1) 前端传来的 stepBase：它记的是「这一步从哪份代码开始写的」，最准确。
     *    典型场景：上一步是我自己手写的实现，第 N+1 步的红只是因为还没动笔——
     *    以前拿「上一步的参考实现」来比，手写实现永远对不上，于是每推进一次就先白记一次失败。
     * 2) 没传（旧调用/老关卡）：退回「上一步的参考实现」，再退回骨架。
     */
    const lastDone = [...stageDone].sort((a, b) => b - a)[0]
    const prev = stages.find((s) => s.n === lastDone)
    const baseCode = typeof stepBase === 'string' && stepBase.trim()
      ? stepBase
      : (prev ? prev.code : lv.skeleton)
    const untouched = squashWs(src) === squashWs(baseCode)
    /**
     * 只记「我正站着的那一步」的失败。
     *
     * 站在第 3 步跑测试，第 4 步也会被判一遍：它当然红，因为第 4 步还没写。
     * 把这种红算进「连续失败」，人还没开始写第 4 步就先攒了两次，
     * 「卡 3 次看答案」的按钮会提前亮——兜底变成了捷径，而且每推进一次都白记一次。
     * 跨步写（在第 1 步就把第 2 步写完）也不记：那份代码本来就是第 2 步的起点，
     * 等他站到第 2 步再改、再跑，计数从那里开始，更符合「这一步我试了几次」。
     */
    const onThisStep = typeof stepN !== 'number' || stuck.n === stepN
    if (!untouched && onThisStep) stageFails[String(stuck.n)] = (stageFails[String(stuck.n)] ?? 0) + 1
  }

  /** 看过答案的步骤：同一版阶段结构下才认（和 stageDone 一样，内容改版即作废） */
  const answerSteps = prog.get(lv.id)?.stageBase === stageBase ? prog.get(lv.id)!.answerSteps : []

  tx(() => {
    run(`INSERT INTO project_progress(project_id, level_id, done, draft_code, draft_base, stage_done, stage_base, stage_fails, answer_steps, attempts, xp, passed_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'))
         ON CONFLICT(project_id, level_id) DO UPDATE SET
           done=excluded.done,
           draft_code=excluded.draft_code,
           draft_base=excluded.draft_base,
           stage_done=excluded.stage_done,
           stage_base=excluded.stage_base,
           stage_fails=excluded.stage_fails,
           answer_steps=excluded.answer_steps,
           attempts=excluded.attempts,
           xp=excluded.xp,
           passed_at=COALESCE(project_progress.passed_at, excluded.passed_at),
           updated_at=excluded.updated_at`,
      [projectId, levelId, result.ok ? 1 : 0, String(code ?? ''), baseHash(lv.skeleton),
        stages.length ? JSON.stringify(stageDone) : null, stages.length ? stageBase : null,
        stages.length && Object.keys(stageFails).length ? JSON.stringify(stageFails) : null,
        stages.length && answerSteps.length ? JSON.stringify(answerSteps) : null,
        attempts,
        result.ok ? (lv.xp ?? DEFAULT_XP) : (prog.get(lv.id) ? 0 : 0),
        result.ok ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null])

    if (result.ok && !wasDone) {
      firstPass = true
      xpAwarded = lv.xp ?? DEFAULT_XP
      const after = progressMap(projectId)
      const row = after.get(lv.id)
      if (row) row.done = true
      projectDone = p.levels.every((l) => after.get(l.id)?.done)
      recordProjectLevel({
        projectTitle: p.title, levelTitle: lv.title, xp: xpAwarded,
        levelIndex: idx + 1, levelCount: p.levels.length, projectDone
      })
    }
  })

  const nextLevelId = idx + 1 < p.levels.length ? p.levels[idx + 1].id : null
  return {
    passed: result.ok,
    cases: result.cases,
    stages: result.stages,
    stageIndex: result.stageIndex,
    stageDone,
    stageFails,
    answerSteps,
    /**
     * 卡住的这一步是否已经「够格看答案」。
     *
     * 由主进程算，不把「几次算够」交给前端：否则一次 devtools 改内存就绕过了门槛。
     * 但它只是个提示位——真正取答案还要再走 projectStepAnswer 服务端校验一遍。
     */
    answerReady: !!stuck && !result.ok && (stageFails[String(stuck.n)] ?? 0) >= ANSWER_AFTER,
    logs: result.logs,
    error: result.error,
    ms: result.ms,
    attempts,
    xpAwarded,
    firstPass,
    nextLevelId,
    projectDone,
    // 通关当次就把参考答案带回去，用户不用再点一次才看得到
    solution: result.ok ? lv.solution : null
  }
}

export function projectResetLevel(projectId: string, levelId: string) {
  // attempts 也归零：这一关被当作「没做过」，界面上那句「已尝试 N 次」不该留着上一次的账
  // 连续失败计数和「看过答案」的步骤一并清掉：从零重做意味着换一份新的账
  run(`UPDATE project_progress SET draft_code=NULL, draft_base=NULL, stage_done=NULL, stage_base=NULL,
       stage_fails=NULL, answer_steps=NULL,
       done=0, passed_at=NULL, attempts=0, updated_at=datetime('now','localtime')
       WHERE project_id=? AND level_id=?`, [projectId, levelId])
  // 已发的 XP 不回收：奖励是「做到过」的凭证，重做不该倒扣
  return { ok: true }
}

/**
 * 看「这一步」的答案：同一步连续失败到门槛之后才放行。
 *
 * 三条边界，都是为了「给答案」不变成「给整关」：
 * 1) 只回这一阶段的 code —— 它是「这一步写完之后」的完整文件，物理上不含后面步骤的实现
 *    （后面的步骤是往这份文件上继续加，构建期有自检：这份 code 跑不过下一步的测试）。
 * 2) 不回该阶段的 test：测试源码仍然留在主进程，看了答案也得自己跑一遍才算过。
 * 3) 服务端重新读计数再判一次，不信前端传来的「我已经失败 3 次了」。
 *
 * 不扣 XP：求助不该被罚，否则人宁可硬耗也不点，兜底就失效了。但会记下「这步看过答案」，
 * 关卡详情里如实标出来——将来回看时，用户自己知道哪一步是参考过的。
 */
export function projectStepAnswer(projectId: string, levelId: string, step: number): { code: string; step: number } {
  const p = loadOne(projectId)
  const lv = p.levels.find((l) => l.id === levelId)
  if (!lv) throw new Error('关卡不存在')
  const stages = lv.stages ?? []
  if (!stages.length) throw new Error('这一关不分步，没有「这一步的答案」')
  const st = stages.find((s) => s.n === step)
  if (!st) throw new Error(`没有第 ${step} 步`)

  const prog = progressMap(projectId).get(levelId)
  const sameBase = !!prog && prog.stageBase === stageHash(stages)
  const fails = sameBase ? (prog!.stageFails[String(step)] ?? 0) : 0
  if (fails < ANSWER_AFTER) {
    throw new Error(`第 ${step} 步连续失败 ${fails} 次，再试 ${ANSWER_AFTER - fails} 次才会放出这一步的答案`)
  }

  const steps = [...new Set([...(sameBase ? prog!.answerSteps : []), step])].sort((a, b) => a - b)
  run(`UPDATE project_progress SET answer_steps=?, updated_at=datetime('now','localtime')
       WHERE project_id=? AND level_id=?`, [JSON.stringify(steps), projectId, levelId])
  return { code: st.code, step }
}

/**
 * 退回本关：只撤掉「通关」这个标记，代码、草稿、阶段进度全部保留。
 *
 * 和 projectResetLevel 的区别是「留痕」：resetLevel 是把这一关当作没做过（清草稿、清阶段），
 * 用于「从零重做」和自动化测试的干净起点；revertLevel 是「这一关我确实写过，但通关这件事
 * 不作数了」——比如发现通关是测试跑出来的，或者想重跑一遍验一验自己的实现。
 * 因此这里不动 draft/stage/attempts，也不碰已发 XP（XP 挂在 game_stats，本来就与这一关解耦）。
 */
export function projectRevertLevel(projectId: string, levelId: string) {
  const row = get<{ done: number }>(
    `SELECT done FROM project_progress WHERE project_id=? AND level_id=?`, [projectId, levelId])
  if (!row) return { ok: true, changed: false }
  const changed = !!row.done
  run(`UPDATE project_progress SET done=0, passed_at=NULL, updated_at=datetime('now','localtime')
       WHERE project_id=? AND level_id=?`, [projectId, levelId])
  // 下一关的解锁是「上一关 done」推出来的，退回后自动重新上锁；不额外写库
  return { ok: true, changed }
}

export function projectResetAll(projectId: string) {
  run(`DELETE FROM project_progress WHERE project_id=?`, [projectId])
  return { ok: true }
}

/**
 * 全站覆盖总览：知识图谱的 402 个知识点（L3/L4），被所有项目关卡收编了多少。
 *
 * 这个数不是给作者看的 KPI，是给学习者看的进度尺度：项目闯关要回答
 * 「我做完这些，图谱里的东西是不是都摸过了」。没覆盖的节点直接列出来，
 * 缺什么一目了然，补内容的人不用再另开一张表。
 */
export function projectCoverage(): ProjectCoverage {
  const nodes = loadGraphNodes()
  const cov = computeCoverage(loadAll(), nodes)
  return {
    totalTargets: cov.totalTargets,
    covered: cov.covered,
    missing: cov.missing,
    ratio: cov.ratio,
    byDomain: cov.byDomain as CoverageBucket[],
    byStack: cov.byStack as CoverageBucket[],
    gaps: (cov.missingNodes as any[]).map((n) => ({
      id: n.id, title: n.title, stack: n.stack, topic: n.topic, mustMaster: n.mustMaster
    })),
    unmappedLevels: cov.unmappedLevels.length
  }
}