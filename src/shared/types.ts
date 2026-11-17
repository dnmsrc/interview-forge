/** 跨进程共享的核心类型（渲染进程只通过这些形状拿数据，题目原文以 JSON 字符串存库） */

export type QType = 'single' | 'multiple' | 'judge' | 'blank' | 'short' | 'essay' | 'code'
export const SUBJECTIVE: QType[] = ['short', 'essay', 'code']

export interface Question {
  id: string
  nodeId: string
  parentId?: string | null
  angle?: string | null
  type: QType
  difficulty: number
  stem: string
  options?: { key: string; text: string }[]
  answer?: { keys?: string[]; judge?: boolean; blanks?: string[]; synonyms?: Record<string, string[]>; ref?: string; code?: string }
  scoringPoints?: { point: string; weight: number }[]
  analysis?: string
  gapCheck?: string[]
  knowledgeLinks?: { prereq?: string[]; related?: string[]; followUps?: string[] }
  resources?: { title: string; digest: string }[]
  openBookAllowed?: boolean
  /**
   * R19 先学后测标记：true 表示这是「资料依赖题」——不先读特定论文/官方文档/版本口径，
   * 仅凭通用原理无法作答（如 vLLM 论文的实测数字、MCP 规范版本号）。闭卷摸底遇到它时，
   * 前端必须先展示 resources 学习材料、用户学完才能作答；同节点有可推理闭卷题时优先出闭卷题。
   * 区别于 openBookAllowed：后者仅表「允许查资料」且全库默认 true、语义已泛滥，不参与摸底选题。
   * 不标（undefined/false）= 可凭原理推理的闭卷题。
   */
  learnFirst?: boolean
  source?: { kind: string; url?: string; retrievedAt?: string; note?: string }
  tags?: string[]
  variants?: VariantLite[]
}

export interface VariantLite { id?: string; stem: string; angle?: string; answer?: Question['answer']; analysis?: string; scoringPoints?: Question['scoringPoints'] }

export interface QuestionRow {
  id: string
  node_id: string
  parent_id: string | null
  angle: string | null
  type: QType
  difficulty: number
  data: string
  status: string
  open_book: number
  source_kind: string
  tags: string
  nodeTitle?: string
  /** 考点能力要求（nodes.summary，「要能讲清…」），作答前展示，回答「学到这里了吗」 */
  nodeSummary?: string | null
  mastery_level?: number
  stale?: number
  /** 解析 data 后填充，渲染层直接用 */
  q?: Question
  mastery?: { lit: number; needs_work: number; scale4: number }
  srs?: { due: string | null; reps: number; state: number }
}

/* ---------- 知识体系（契约 docs/design/KNOWLEDGE-SYSTEM.md §2） ---------- */

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
export interface KnowledgeStatus {
  total: number; nodesTotal: number; covered: number; missingBody: number
  byConfidence: Record<string, number>; flagged: number; problems: number
  lastIndexedAt: string | null; contentDir: string; filesScanned: number
}

export interface GraphNode {
  id: string
  parent: string | null
  title: string
  level: number
  domain: string
  stack: string | null
  topic: string | null
  summary: string | null
  est_minutes: number
  must_master: number
  threshold: number
  ord: number
  /** 计算字段 */
  lit: number
  needs_work: number
  scale4: number
  answered: number
  correct: number
  locked: number
  forced_unlock: number
  /** 四态掌握状态（services/mastery.ts）：0 未接触 / 1 学习中 / 2 已掌握 / 3 已生疏 */
  mastery_level?: number
  masteryLevel?: number
  stale?: number
  retention?: number
  pass_reps?: number
  total_reps?: number
  lapses?: number
  passReps?: number
  totalReps?: number
  next_review?: string | null
  qTotal: number
  qDone: number
  qDue: number
  /** 个人重要度权重（srs.weight 聚合，影响组卷优先级，0~3） */
  weight?: number
  children?: GraphNode[]
}

export interface GradeResult {
  qid: string
  scale4: number
  pct: number
  gradingKind: 'auto' | 'ai' | 'self'
  awarded?: { point: string; got: number; why: string }[]
  missing?: string[]
  verdict?: string
  comment?: string
  model?: string
  tokens?: number
  ms?: number
  error?: string
}

export interface TeachingResult {
  qid: string
  errors?: { claim: string; why_wrong: string; severity: 'high' | 'mid' | 'low' }[]
  missingPoints?: string[]
  termFixes?: { wrong: string; right: string; why: string }[]
  howToRemember?: string
  betterAnswer?: string
  model?: string
}

export interface ProbeTurn { question: string; intent?: string; difficulty?: number }
export interface QaResult { answer: string; confidence?: number; relatedNodes?: string[]; miniExample?: string }

/** 一条关系邻居（抽屉叙事分组与透镜共用） */
export interface NodeRelation {
  id: string
  title: string
  type: string
  /** 方向：out=当前节点指向它，in=它指向当前节点；无向边恒为 out */
  dir: 'out' | 'in'
  lit: number
  note: string | null
}
/** 一类关系的叙事分组（抽屉里的一个小节） */
export interface NodeRelationGroup {
  type: string
  label: string
  directed: boolean
  items: NodeRelation[]
}

export interface NodeDetail {
  node: GraphNode
  /** R19：9 类关系叙事分组（替代旧 prerequisites/dependents/related 三段） */
  relationGroups: NodeRelationGroup[]
  /** 兼容字段：门槛边起点（advance/depend 的 in 侧），旧调用方仍可读 */
  prerequisites: { id: string; title: string; lit: number }[]
  /** 兼容字段：门槛边终点（点亮后解锁） */
  dependents: { id: string; title: string; lit: number }[]
  /** 兼容字段：无向语义邻居并集 */
  related: { id: string; title: string }[]
  questions: { id: string; type: string; difficulty: number; stem: string; parentId: string | null; angle: string | null; answered: number; bestPct: number | null; due: string | null }[]
  advice: string
}

export interface ExamSpec {
  domains: string[]
  stacks?: string[]
  types?: QType[]
  difficulties?: number[]
  count: number
  minutes: number
  passLine?: number
  title?: string
  templateId?: string
  includeVariantRatio?: number
}

export interface ExamSummary {
  id: string
  title: string
  spec: ExamSpec
  started_at: string
  deadline_at: string
  submitted_at: string | null
  status: 'running' | 'submitted' | 'grading' | 'done' | 'abandoned'
  total: number | null
  pass_line: number
  self_est: number | null
  answeredCount: number
  questionCount: number
  remainingMs?: number
  report?: AiExamReport | null
}

export interface AiExamReport {
  total: number
  pass: boolean
  band?: string
  perQuestion: { qid: string; scale4: number; pct: number; verdict: string; missing: string[]; awarded?: { point: string; got: number; why: string }[] }[]
  weakNodes?: { nodeId: string; title: string; lostPct: number; advice: string }[]
  attribution?: { reason: string; count: number }[]
  selfEstDelta?: { self: number; ai: number; note: string }
  summary?: string
  model?: string
}

export interface EndpointConfig {
  id: string
  label: string
  baseUrl: string
  apiKey?: string
  model: string
  role: 'fast' | 'strong' | 'tutor' | 'any'
  temperature?: number
  maxTokens?: number
  enabled?: boolean
  local?: boolean
}

/** 内置答疑小模型（llama.cpp CPU 推理）的运行状态。vramMb 恒为 0：该端点不从显卡分配显存 */
export type TutorState = 'idle' | 'starting' | 'ready' | 'error'
export interface TutorStatus {
  state: TutorState
  vramMb: 0
  port: number
  pid?: number
  modelPath: string
  modelExists: boolean
  binPath: string
  binExists: boolean
  ctx: number
  threads: number
  idleUnloadMs: number
  startedAt?: number
  lastUsedAt?: number
  lastError?: string
  /** state=ready 时距自动卸载还剩多少毫秒 */
  idleLeftMs?: number
}

export interface AppSettings {
  endpoints: EndpointConfig[]
  routing: { fastEndpointId: string | null; strongEndpointId: string | null; tutorEndpointId: string | null }
  desiredRetention: number
  globalMixRatio: number
  dailyTarget: number
  strictTiming: boolean
  autoWeekUpdate: boolean
  reminderOnLaunch: boolean
  theme: 'dark' | 'light'
}

export interface DailyPlan {
  date: string
  due: QuestionRow[]
  weakVariants: QuestionRow[]
  newQuestions: QuestionRow[]
  totalPlanned: number
  doneToday: number
  streak: number
  message?: string
}

export interface DashboardSummary {
  totals: { questions: number; nodes: number; litNodes: number; mustMaster: number; mustMasterLit: number }
  mastery: { domain: string; title: string; lit: number; total: number; avgScale4: number }[]
  /** 考点四态分布（services/mastery.ts）：点亮 ≠ 掌握，忘记会退回「已生疏」 */
  stateDist?: { untouched: number; learning: number; mastered: number; stale: number; recentlyMastered: number; mustStale: number }
  accuracyTrend: { day: string; answered: number; avgPct: number }[]
  typeStats: { type: string; answered: number; avgPct: number }[]
  topWrong: { qid: string; stem: string; nodeTitle: string; times: number; avgPct: number }[]
  aiUsage: { task: string; calls: number; tokens: number; ms: number }[]
  examHistory: { id: string; title: string; total: number; pass: boolean; submitted_at: string }[]
  streak: number
  dueNow: number
  interviewBand: { low: number; high: number; note: string }
}

/* R22 受限多轮辅导对话类型（定义在 api.ts，这里转出供渲染层统一从 @shared/types 引入） */
export type { TutorTurn, TutorPrereq, TutorChatResult, TutorChatOk } from './api'
