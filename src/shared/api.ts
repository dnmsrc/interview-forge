import type { ExamSpec, GradeResult, TeachingResult, ProbeTurn, QaResult, EndpointConfig, AppSettings, DailyPlan, DashboardSummary, GraphNode, NodeDetail, QuestionRow, VariantLite, TutorStatus, TutorCatalog, InferMode } from './types'
import type { RelationType } from './relations'

/* ---------- 知识体系（knowledge / knowledge_fts）DTO：与 services/knowledge.ts 的返回结构一一对应 ---------- */

/** AI 通俗解析的结果判别联合：没配端点时走 err 分支，前端给引导而不是抛错 */
/** 摸底会话内一道已作答题的还原快照（placement.turns 返回元素，形状对齐前端 PlacementSnap） */
export interface PlacementTurnSnap {
  item: QuestionRow
  answer: unknown
  scale4: number
  pct: number
  verdict: string
  gapType: string | null
  /** 「这题我是蒙的」标记只活在当次前端会话、不持久化，历史还原恒为 false */
  guessed: boolean
}

/** R23「我不会」自由描述的缺口分类结果：gapType 三类之一，source 标明判定来源（便于排查误判） */
export interface GapInterpret {
  gapType: 'concept' | 'code' | 'skip'
  source: 'rule' | 'ai' | 'fallback'
  note: string
}
export type ExplainStyle = 'easier' | 'example' | 'short' | 'from-prereq'
export interface ExplainOk {
  id: number; answer_md: string; model: string; tokens: number; ms: number
  created_at: string; cached: boolean; style: ExplainStyle
}
export interface ExplainErr { error: 'no-endpoint'; message: string }
export type ExplainRunResult = ExplainOk | ExplainErr

/** R22 受限多轮辅导：一轮对话的消息（角色 + Markdown 文本） */
export interface TutorTurn { role: 'user' | 'assistant'; content: string }
/** 私教建议回补的前置考点（id 已在服务侧与真实前置求交，前端可直接渲染跳转） */
export interface TutorPrereq { id: string; title: string; lit: boolean; summary: string | null }
export interface TutorChatOk {
  answer_md: string; model: string; tokens: number; ms: number
  offTopic: boolean; suggestPrereq: TutorPrereq | null
}
export type TutorChatResult = TutorChatOk | ExplainErr

/** frontmatter.sources 落库后的来源行；trust 是来源可信度（0-1），snippet 是抓取到的原文片段 */
export interface KnowledgeSourceRow {
  url: string
  title: string | null
  kind: string | null          // official | source | doc | blog …
  fetched_at: string | null
  trust: number
  snippet: string | null
}
/** 一个考点的知识正文。missing=true 表示该节点还没有正文文件（不是出错） */
export interface KnowledgeEntry {
  nodeId: string
  title: string
  summary: string              // 「一句话本质」小节首段
  bodyMd: string               // 去掉 frontmatter 的正文，交给 markdown 渲染器
  sources: KnowledgeSourceRow[]
  confidence: string           // high | medium | low | unknown
  reviewed: boolean            // frontmatter.reviewed
  wordCount: number
  qualityFlags: string[]       // 质量闸门未通过的条目（空数组 = 合格）
  updatedAt: string | null     // frontmatter.updated
  indexedAt: string | null     // 入库时间
  missing: boolean
}
/** 检索命中：score 越大越相关（已对 bm25 取反）；fragment 里命中词用 <mark> 包裹 */
export interface KnowledgeSearchHit {
  nodeId: string
  title: string
  summary: string
  confidence: string
  score: number
  masteryLevel: number         // 该考点当前掌握度（0-5），用于「弱项优先」排序
  lit: number                  // node_mastery.lit：点过灯的数量
  stale: number                // 过期标记数
  fragment: string
  matchedTerms: string[]
}
/** 索引健康度面板用的一次性快照 */
export interface KnowledgeStatus {
  total: number                // 已入库正文数
  nodesTotal: number           // 图谱节点总数
  covered: number              // 挂了题且已有正文的考点数
  missingBody: number          // level4 考点里还缺正文的数量（铺量进度）
  byConfidence: Record<string, number>
  flagged: number              // 带 quality_flags 的正文数
  problems: number             // 同 flagged，语义别名，面板直接显示
  lastIndexedAt: string | null
  contentDir: string
  filesScanned: number         // 本次扫描到的 md 文件数
}
/** syncFromFiles 的结果 */
export interface KnowledgeSyncStats {
  added: number
  updated: number
  removed: number
  skipped: number
  problems: KnowledgeProblem[]
}
export interface KnowledgeProblem {
  file: string                 // 相对 content/knowledge 的路径
  nodeId: string
  reason: string               // quality-gate | duplicate-node-id | read-error | write-error | probe-miss:*
  detail: string[]
}
/** AI 生成讲义的单节点结果（管道状态语义与 scripts/kb-draft-core.mjs 一致） */
export interface DraftOutcome {
  node: string
  status: 'written' | 'stale' | 'dry' | 'skip-exists' | 'no-official' | 'fetch-thin' | 'sources-only' | 'no-endpoint' | 'missing-node' | 'error'
  path?: string
  flags?: string[]             // stale 时未过质量闸门的原因清单
  error?: string
  words?: number
  repaired?: string[]          // 自动补写过的内容（tail-sections / ai-complete:xxx）
}

/** preload 据此生成同名桥接方法（必须与主进程 impl 的方法名一一对应） */
export const API_METHODS: Record<string, string[]> = {
  app: ['paths', 'openExternal', 'reveal', 'versions'],
  bank: ['stats', 'gaps', 'update', 'versions', 'rollback', 'reload', 'validate'],
  dirty: ['report', 'list', 'triage'],
  graph: ['tree', 'edges', 'node', 'forceUnlock', 'setWeight'],
  practice: ['queue', 'submit', 'teach', 'probe', 'qa', 'genVariant', 'stats', 'history', 'setSetting', 'markGuessed'],
  exam: ['templates', 'start', 'summary', 'questions', 'draft', 'resume', 'submit', 'gradingStatus', 'history', 'abandon', 'remove'],
  placement: ['start', 'next', 'submit', 'resume', 'turns', 'results', 'history', 'gaps', 'interpretGap'],
  mistakes: ['list', 'detail', 'remove', 'clear'],
  daily: ['plan', 'checkin', 'exportWeekly'],
  dashboard: ['summary', 'wrongNotes'],
  knowledge: ['get', 'search', 'status', 'sync', 'saveDraft', 'generate', 'generateBatch'],
  explain: ['run', 'history', 'followups', 'tutor'],
  ai: ['endpoints', 'saveEndpoints', 'test', 'usage', 'byTask', 'errors', 'tutorStatus', 'tutorStart', 'tutorStop', 'tutorLog', 'tutorSetMode', 'tutorSetModel', 'tutorCatalog'],
  settings: ['all', 'get', 'set'],
  game: ['overview', 'badges', 'events', 'drainEvents', 'bosses', 'chapters', 'reportExplorer']
}

/** 渲染进程可调用的全部能力；主进程实现必须 satisfies 这个形状 */
export interface ForgeApi {
  app: {
    paths(): Promise<{ db: string; content: string; snapshots: string }>
    openExternal(url: string): Promise<void>
    reveal(file: string): Promise<void>
    versions(): Promise<{ app: string; electron: string; node: string; sqlite: boolean }>
  }
  bank: {
    stats(): Promise<any>
    gaps(opts?: { domains?: string[]; perNodeTarget?: number }): Promise<any>
    update(opts?: { domains?: string[]; perNodeTarget?: number; maxNodes?: number; note?: string; digest?: string }): Promise<any>
    versions(limit?: number): Promise<any[]>
    rollback(id: string): Promise<{ ok: boolean; message: string }>
    reload(): Promise<any>
    validate(): Promise<{ ok: boolean; output: string }>
  }
  dirty: {
    report(qid: string, reason: string, userEdit?: Partial<any>): Promise<any>
    list(limit?: number): Promise<any[]>
    triage(limit?: number): Promise<any>
  }
  graph: {
    tree(domain?: string): Promise<GraphNode[]>
    edges(domain?: string): Promise<{ from: string; to: string; type: RelationType; note: string | null }[]>
    node(nodeId: string): Promise<NodeDetail | null>
    forceUnlock(nodeId: string, on: boolean): Promise<void>
    setWeight(nodeId: string, weight: number): Promise<void>
  }
  practice: {
    queue(spec: any): Promise<QuestionRow[]>
    submit(qid: string, answer: unknown, opts?: { endpointId?: string; selfScale4?: number; revealOnly?: boolean }): Promise<any>
    teach(qid: string, myAnswer: string, opts?: { endpointId?: string }): Promise<TeachingResult>
    probe(qid: string, history: { me: string; probe: string }[], lastAnswer: string, opts?: { endpointId?: string }): Promise<ProbeTurn & { done?: boolean }>
    qa(qid: string, question: string, prior: { role: string; content: string }[], opts?: { endpointId?: string }): Promise<QaResult>
    genVariant(qid: string, n?: number): Promise<{ ok: boolean; added: number; error?: string }>
    stats(): Promise<any>
    history(qid: string, limit?: number): Promise<any[]>
    setSetting(key: 'mixRatio' | 'dailyTarget' | 'includeDue', value: number | boolean): Promise<void>
    /** 回看时主动承认某题是蒙的：追加 0 档记录、降级掌握度、提前复习、自动进错题本（不改原批改） */
    markGuessed(qid: string): Promise<{ ok: boolean; qid: string; masteryLevel: number; lit: number }>
  }
  exam: {
    templates(): Promise<{ id: string; title: string; spec: ExamSpec }[]>
    start(spec: ExamSpec): Promise<any>
    summary(id: string): Promise<any>
    questions(id: string): Promise<QuestionRow[]>
    draft(id: string, qid: string, answer: unknown, selfEst?: number): Promise<void>
    resume(): Promise<any>
    submit(id: string): Promise<any>
    gradingStatus(id: string): Promise<{ status: string; done: number; total: number }>
    history(limit?: number): Promise<any[]>
    abandon(id: string): Promise<void>
    remove(id: string): Promise<void>
  }
  placement: {
    /** 默认复用该板块未完成会话（resumed=true）；force=true 显式放弃旧进度、开新一轮 */
    start(domain: string, opts?: { force?: boolean }): Promise<{ sessionId: string; item: QuestionRow | null; hint: string; progress: { done: number; total: number }; resumed?: boolean }>
    next(sessionId: string): Promise<{ item: QuestionRow | null; hint: string; progress: { done: number; total: number } }>
    submit(
      sessionId: string, qid: string, answer: unknown,
      opts?: { gapType?: 'concept' | 'code' | 'skip' | 'guess' | null; gapNote?: string | null }
    ): Promise<{
      scale4: number; pct: number; verdict: string; gapType: string | null; finished: boolean;
      nextLevel: number; item: QuestionRow | null; hint: string; progress: { done: number; total: number }
    }>
    /** 断点续测：取该板块（或全局）最近一个未完成会话，无则返回 null；返回值带 domain 以便前端对齐当前板块 */
    resume(domain?: string): Promise<{ sessionId: string; item: QuestionRow | null; hint: string; progress: { done: number; total: number }; domain: string } | null>
    /** R15 续测回看：还原该会话已作答的每一题（题目 + 我的答案 + 判定），按作答顺序，供胶片回看 */
    turns(sessionId: string): Promise<PlacementTurnSnap[]>
    results(): Promise<Record<string, any>>
    history(limit?: number): Promise<any[]>
    /** 摸底中明确标记「不会」的缺口清单（concept 知识点 / code 手写代码 / skip 跳过） */
    gaps(domain?: string): Promise<{ nodeId: string; title: string; gapType: string; count: number; lastAt: string }[]>
    /**
     * R23「我不会」输入框直接提交：把用户一句自由描述（如「不知道 AST 是什么」）判成
     * concept / code / skip，前端据此带着原话一起 submit（gapNote 保留用户原话）。
     * source 标判定来源：rule 离线规则命中（0 延迟）/ ai 模型判定 / fallback 兜底归 concept。
     */
    interpretGap(note: string, nodeId?: string | null): Promise<GapInterpret>
  }
  mistakes: {
    list(opts?: { domain?: string; limit?: number; onlyUnmastered?: boolean }): Promise<any[]>
    detail(qid: string): Promise<{ qid: string; node_id: string; q: any; history: any[] } | null>
    remove(qid: string): Promise<{ ok: boolean; qid: string }>
    clear(domain?: string): Promise<{ ok: boolean; hidden: number }>
  }
  daily: {
    plan(): Promise<DailyPlan>
    checkin(done: boolean): Promise<void>
    exportWeekly(): Promise<{ path: string; markdown: string }>
  }
  dashboard: {
    summary(): Promise<DashboardSummary>
    wrongNotes(limit?: number, domain?: string): Promise<any[]>
  }
  /** 知识正文（content/knowledge → knowledge / knowledge_fts），契约见 docs/design/KNOWLEDGE-SYSTEM.md §2 */
  knowledge: {
    /** 取一个考点的正文；未收录时返回 missing:true，前端据此显示「未收录」而非报错 */
    get(nodeId: string): Promise<KnowledgeEntry>
    /** FTS5 全文检索（中文按单字+二字组合索引，bm25 加权排序） */
    search(q: string, limit?: number): Promise<KnowledgeSearchHit[]>
    /** 索引健康度：总数 / 覆盖 / 缺正文考点数 / 各 confidence 计数 / 质量标记数 */
    status(): Promise<KnowledgeStatus>
    /** 增量重扫 content/knowledge（hash 比对），返回新增/更新/删除与问题清单 */
    sync(opts?: { force?: boolean }): Promise<KnowledgeSyncStats>
    /** AI 起草后落盘并立即重建该行索引；flags 非空表示没过质量闸门（文件仍会写入） */
    saveDraft(nodeId: string, md: string, relPath?: string): Promise<{ path: string; ok: boolean; flags: string[] }>
    /** AI 生成单考点讲义（抓官方源→起草→八小节闸门，与 kb-build CLI 同一管道）；written 已落盘并入索引 */
    generate(nodeId: string, opts?: { force?: boolean }): Promise<DraftOutcome>
    /** 批量补齐讲义：默认只补无讲义考点、mustMaster 优先；本机模型约 1-2 分钟/篇 */
    generateBatch(opts?: { domain?: string; limit?: number; onlyEmpty?: boolean; force?: boolean; concurrency?: number }):
      Promise<{ tally: Record<string, number>; results: DraftOutcome[]; indexed: KnowledgeSyncStats | null }>
  }
  /** AI 通俗解析（契约 §6）：看了正文/解析仍不懂时，用「已点亮前置」当已知量换个说法重讲 */
  explain: {
    /** 生成或复用缓存讲解；没配 AI 端点时不抛错，返回 error:'no-endpoint' 让前端给引导文案 */
    run(
      nodeId: string, ask?: string | null,
      style?: ExplainStyle,
      opts?: { questionId?: string | null }
    ): Promise<ExplainRunResult>
    /** 该考点问过的讲解历史（抽屉里回看） */
    history(nodeId: string, limit?: number): Promise<{ id: number; ask: string; style: string; created_at: string }[]>
    /** 追问快捷 chips：点一下就是一个新 ask，降低提问门槛 */
    followups(): Promise<{ label: string; ask: string; style: ExplainStyle }[]>
    /**
     * R22 受限多轮辅导：围绕当前考点的连续对话。
     * history 由前端维护并回传（只带最近若干轮）；服务端做作用域护栏、零基础前置引导、风格自适应。
     * 没配 AI 端点时返回 error:'no-endpoint'，前端给引导而不是抛错。
     */
    tutor(
      nodeId: string, question: string,
      history?: TutorTurn[],
      opts?: { questionId?: string | null; role?: 'tutor' | 'strong' }
    ): Promise<TutorChatResult>
  }
  ai: {
    endpoints(): Promise<EndpointConfig[]>
    saveEndpoints(list: EndpointConfig[]): Promise<void>
    test(cfg: EndpointConfig): Promise<{ ok: boolean; message: string; latency: number; models?: string[] }>
    usage(days?: number): Promise<any>
    byTask(days?: number): Promise<any[]>
    errors(limit?: number): Promise<any[]>
    /** 内置答疑小模型（CPU 推理）状态：显存恒 0，空闲自动卸载 */
    tutorStatus(): Promise<TutorStatus>
    /** 手动预热（不想等首次 3-6s 加载时点一下） */
    tutorStart(): Promise<{ ok: boolean; message: string; waitedMs: number }>
    /** 立即卸载释放内存（平时空闲也会自动卸载） */
    tutorStop(): Promise<TutorStatus>
    /** 最近运行日志，用于排查「模型没下载 / 端口被占 / 加载失败」 */
    tutorLog(limit?: number): Promise<string[]>
    /** 切换推理模式：auto 按显存实测判定，cpu/gpu 是用户强制 */
    tutorSetMode(mode: InferMode): Promise<TutorStatus>
    /** 切换使用的模型（注册表 id） */
    tutorSetModel(modelId: string): Promise<TutorStatus>
    /** 模型与运行时清单 + 推荐后端 + 缺依赖时的补下载命令 */
    tutorCatalog(): Promise<TutorCatalog>
  }
  settings: {
    all(): Promise<AppSettings>
    get<T = any>(key: string): Promise<T | undefined>
    set(key: string, value: unknown): Promise<void>
  }
  /** R20 游戏化：XP/等级、连续打卡、徽章墙、章节 Boss、庆祝事件 */
  game: {
    overview(): Promise<import('./game').GameOverviewDto>
    badges(domain?: string): Promise<import('./game').BadgeWallItem[]>
    /** 只读拉取未读庆祝事件（不标已读），用于进页面时预览 */
    events(): Promise<import('./game').GameEventDto[]>
    /** 拉取未读庆祝事件并标记已读（前端弹窗后调用） */
    drainEvents(): Promise<import('./game').GameEventDto[]>
    bosses(domain?: string): Promise<import('./game').BossStage[]>
    chapters(domain?: string): Promise<import('./game').ChapterProgressDto[]>
    /** 上报图谱浏览过的章节 id，用于「地图探索者」徽章 */
    reportExplorer(visitedChapterIds: string[]): Promise<boolean>
  }
}
