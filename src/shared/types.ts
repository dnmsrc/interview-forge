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
  /** 解析 data 后填充，渲染层直接用 */
  q?: Question
  mastery?: { lit: number; needs_work: number; scale4: number }
  srs?: { due: string | null; reps: number; state: number }
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
  qTotal: number
  qDone: number
  qDue: number
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

export interface NodeDetail {
  node: GraphNode
  prerequisites: { id: string; title: string; lit: number }[]
  dependents: { id: string; title: string; lit: number }[]
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
  role: 'fast' | 'strong' | 'any'
  temperature?: number
  maxTokens?: number
  enabled?: boolean
  local?: boolean
}

export interface AppSettings {
  endpoints: EndpointConfig[]
  routing: { fastEndpointId: string | null; strongEndpointId: string | null }
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
  accuracyTrend: { day: string; answered: number; avgPct: number }[]
  typeStats: { type: string; answered: number; avgPct: number }[]
  topWrong: { qid: string; stem: string; nodeTitle: string; times: number; avgPct: number }[]
  aiUsage: { task: string; calls: number; tokens: number; ms: number }[]
  examHistory: { id: string; title: string; total: number; pass: boolean; submitted_at: string }[]
  streak: number
  dueNow: number
  interviewBand: { low: number; high: number; note: string }
}
