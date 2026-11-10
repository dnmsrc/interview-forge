import type { ExamSpec, GradeResult, TeachingResult, ProbeTurn, QaResult, EndpointConfig, AppSettings, DailyPlan, DashboardSummary, GraphNode, NodeDetail, QuestionRow, VariantLite } from './types'

/** preload 据此生成同名桥接方法（必须与主进程 impl 的方法名一一对应） */
export const API_METHODS: Record<string, string[]> = {
  app: ['paths', 'openExternal', 'reveal', 'versions'],
  bank: ['stats', 'gaps', 'update', 'versions', 'rollback', 'reload', 'validate'],
  dirty: ['report', 'list', 'triage'],
  graph: ['tree', 'edges', 'node', 'forceUnlock', 'setWeight'],
  practice: ['queue', 'submit', 'teach', 'probe', 'qa', 'genVariant', 'stats', 'history', 'setSetting'],
  exam: ['templates', 'start', 'summary', 'questions', 'draft', 'resume', 'submit', 'gradingStatus', 'history', 'abandon', 'remove'],
  placement: ['start', 'next', 'submit', 'results', 'history'],
  daily: ['plan', 'checkin', 'exportWeekly'],
  dashboard: ['summary', 'wrongNotes'],
  ai: ['endpoints', 'saveEndpoints', 'test', 'usage', 'byTask', 'errors'],
  settings: ['all', 'get', 'set']
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
    edges(domain?: string): Promise<{ from: string; to: string; type: string }[]>
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
    start(domain: string): Promise<{ sessionId: string; item: QuestionRow | null; hint: string }>
    next(sessionId: string): Promise<{ item: QuestionRow | null; hint: string }>
    submit(sessionId: string, qid: string, answer: unknown): Promise<any>
    results(): Promise<Record<string, any>>
    history(limit?: number): Promise<any[]>
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
  ai: {
    endpoints(): Promise<EndpointConfig[]>
    saveEndpoints(list: EndpointConfig[]): Promise<void>
    test(cfg: EndpointConfig): Promise<{ ok: boolean; message: string; latency: number; models?: string[] }>
    usage(days?: number): Promise<any>
    byTask(days?: number): Promise<any[]>
    errors(limit?: number): Promise<any[]>
  }
  settings: {
    all(): Promise<AppSettings>
    get<T = any>(key: string): Promise<T | undefined>
    set(key: string, value: unknown): Promise<void>
  }
}
