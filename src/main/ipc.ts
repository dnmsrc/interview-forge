import { ipcMain, shell, app } from 'electron'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveDataDir, contentRoot, settingGet, settingSet, reloadContent, get } from './db'
import type { ForgeApi, ExplainRunResult, TutorChatResult } from '../shared/api'
import type { AppSettings } from '../shared/types'
import * as graphSvc from './services/graph'
import * as practiceSvc from './services/practice'
import * as examSvc from './services/exam'
import * as insightsSvc from './services/insights'
import * as placementSvc from './services/placement'
import * as mistakesSvc from './services/mistakes'
import * as bankSvc from './services/bank'
import * as knowledgeSvc from './services/knowledge'
import * as kbDraftSvc from './services/kb-draft'
import * as explainSvc from './services/explain'
import * as srsSvc from './services/srs'
import * as gameSvc from './services/game'
import * as projectSvc from './services/project'
import * as progressSvc from './services/progress'
import * as aiSvc from './ai/gateway'
import * as tutorSvc from './ai/tutor-model'
import * as tasksSvc from './ai/tasks'
import { questionOf } from './services/grading'

const projectRoot = () => process.env.FORGE_ROOT || join(__dirname, '..', '..', '..')

export const impl = {
  app: {
    async paths() {
      return { db: join(resolveDataDir(), 'app.db'), content: contentRoot(), snapshots: join(projectRoot(), 'snapshots') }
    },
    async openExternal(url: string) { if (/^https?:\/\//.test(url)) await shell.openExternal(url) },
    async reveal(file: string) { if (file && existsSync(file)) shell.showItemInFolder(file) },
    async versions() {
      let sqlite = false
      try { const s = await import('node:sqlite'); sqlite = typeof s.DatabaseSync === 'function' } catch { /* older runtime */ }
      return { app: app.getVersion(), electron: process.versions.electron, node: process.versions.node, sqlite }
    }
  },

  bank: {
    async stats() { return bankSvc.bankStats() },
    async gaps(opts) { return bankSvc.coverageGaps(opts?.domains ?? [], opts?.perNodeTarget ?? 3) },
    async update(opts) { return bankSvc.updateBank(opts ?? {}) },
    async versions(limit) { return bankSvc.listVersions(limit) },
    async rollback(id) { return bankSvc.rollback(id) },
    async reload() { return reloadContent() },
    async validate() {
      try {
        // 报错项存在时 validate.mjs 以退出码 1 结束，execFileSync 会抛异常 ——
        // 真正的报告在 e.stdout 里，不能丢，所以下面 catch 里要把它取出来。
        // 另外 process.execPath 在 Electron 里是 Electron 本体，直接喂 .mjs 会被当成
        // 应用启动（输出为空）；ELECTRON_RUN_AS_NODE=1 才让它退化成纯 Node 跑这个脚本。
        const out = execFileSync(process.execPath, [join(projectRoot(), 'scripts', 'validate.mjs')], {
          cwd: projectRoot(), encoding: 'utf8', timeout: 120000, windowsHide: true,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
        })
        return { ok: !/❌/.test(out), output: out.slice(0, 8000) }
      } catch (e: any) {
        const text = `${e?.stdout ?? ''}${e?.stderr ?? ''}`.trim()
        return { ok: false, output: (text || `校验脚本没能跑起来：${e?.message ?? e}`).slice(0, 8000) }
      }
    }
  },

  dirty: {
    async report(qid, reason, userEdit) { return bankSvc.reportDirty(qid, reason, userEdit) },
    async list(limit) { return bankSvc.listDirty(limit) },
    async triage(limit) { return bankSvc.triageDirtyQueue(limit) }
  },

  graph: {
    async tree(domain) { return graphSvc.graphTree(domain) },
    async edges(domain) { return graphSvc.graphEdges(domain) },
    async node(nodeId) { return graphSvc.nodeDetail(nodeId) as any },
    async forceUnlock(nodeId, on) { graphSvc.setForceUnlock(nodeId, on) },
    async setWeight(nodeId, weight) { srsSvc.setNodeWeight(nodeId, weight) }
  },

  practice: {
    async queue(spec) { return practiceSvc.buildQueue(spec) },
    async submit(qid, answer, opts) { return practiceSvc.submitPractice(qid, answer, opts) },
    async teach(qid, myAnswer, opts) {
      const q = questionOf(qid)
      if (!q) throw new Error('题目不存在')
      return tasksSvc.teachMyAnswer(q, String(myAnswer ?? ''), opts)
    },
    async probe(qid, history, lastAnswer, opts) {
      const q = questionOf(qid)
      if (!q) throw new Error('题目不存在')
      return tasksSvc.probeNext(q, history ?? [], String(lastAnswer ?? ''), opts)
    },
    async qa(qid, question, prior, opts) {
      const q = questionOf(qid)
      if (!q) throw new Error('题目不存在')
      const nodeTitle = get<{ title: string }>(`SELECT title FROM nodes WHERE id=?`, [q.nodeId])?.title ?? q.nodeId
      return tasksSvc.qaExplain(q, nodeTitle, String(question ?? ''), prior ?? [], opts)
    },
    async genVariant(qid, n) { return bankSvc.addGeneratedVariants(qid, n ?? 2) },
    async stats() { return practiceSvc.practiceStats() },
    async history(qid, limit) { return practiceSvc.answerHistory(qid, limit) },
    async setSetting(key, value) { practiceSvc.setPracticeSetting(key, value) },
    async markGuessed(qid) { return practiceSvc.markGuessed(qid) }
  },

  exam: {
    async templates() { return examSvc.templates() },
    async start(spec) { return examSvc.startExam(spec) },
    async summary(id) { return examSvc.examSummary(id) },
    async questions(id) { return examSvc.examQuestions(id) as any },
    async draft(id, qid, answer, selfEst) { examSvc.saveDraft(id, qid, answer, selfEst) },
    async resume() { return examSvc.resumeRunning() },
    async submit(id) { return examSvc.submitExam(id) },
    async gradingStatus(id) { return examSvc.gradingStatus(id) },
    async history(limit) { return examSvc.examHistory(limit) },
    async abandon(id) { examSvc.abandonExam(id) },
    async remove(id) { examSvc.deleteExam(id) }
  },

  placement: {
    async start(domain, opts?) { return placementSvc.startPlacement(domain, opts ?? {}) },
    async next(sessionId) { return placementSvc.nextPlacementItem(sessionId) },
    async submit(sessionId, qid, answer, opts) { return placementSvc.submitPlacement(sessionId, qid, answer, opts ?? {}) },
    async resume(domain?) { return placementSvc.resumePlacement(domain) ?? null },
    async turns(sessionId) { return placementSvc.placementTurns(sessionId) },
    async results() { return placementSvc.placementResults() },
    async history(limit) { return placementSvc.placementHistory(limit) },
    async gaps(domain?) { return placementSvc.placementGaps(domain) },
    async interpretGap(note, nodeId) { return placementSvc.interpretGapNote(note, nodeId) }
  },

  mistakes: {
    async list(opts) { return mistakesSvc.mistakeList(opts ?? {}) },
    async detail(qid) { return mistakesSvc.mistakeDetail(qid) },
    async remove(qid) { return mistakesSvc.removeMistake(qid) },
    async clear(domain?) { return mistakesSvc.clearMistakes(domain) }
  },

  daily: {
    async plan() { return insightsSvc.buildDailyPlan() },
    async checkin(done) { insightsSvc.markCheckin(done) },
    async exportWeekly() {
      const markdown = insightsSvc.exportWeeklyMarkdown()
      const dir = join(projectRoot(), 'exports')
      mkdirSync(dir, { recursive: true })
      const path = join(dir, `weekly-${new Date().toISOString().slice(0, 10)}.md`)
      writeFileSync(path, markdown, 'utf8')
      return { path, markdown }
    }
  },

  dashboard: {
    async summary() { return insightsSvc.dashboardSummary() },
    async wrongNotes(limit, domain) { return insightsSvc.wrongNoteList(limit, domain) }
  },

  knowledge: {
    async get(nodeId) { return knowledgeSvc.getKnowledge(nodeId) },
    async search(q, limit) { return knowledgeSvc.searchKnowledge(q, limit) },
    async status() { return knowledgeSvc.knowledgeStatus() },
    async sync(opts) { return knowledgeSvc.syncFromFiles(opts ?? {}) },
    async saveDraft(nodeId, md, relPath) { return knowledgeSvc.saveKnowledgeDraft(nodeId, md, relPath) },
    async generate(nodeId, opts) { return kbDraftSvc.generateKnowledge(nodeId, opts ?? {}) },
    async generateBatch(opts) { return kbDraftSvc.generateKnowledgeBatch(opts ?? {}) }
  },

  // AI 通俗解析：正文看完仍不懂时的「换个说法」，缓存与降级都在服务里做完
  explain: {
    async run(nodeId, ask?, style?, opts?): Promise<ExplainRunResult> {
      const r = await explainSvc.explainNode({ nodeId, ask: ask ?? null, style: style ?? 'easier', questionId: opts?.questionId ?? null })
      // 服务侧无端点分支的 error 是宽 string（网关异常兜底），IPC 边界收窄成契约里的判别联合
      if ('error' in r) return { error: 'no-endpoint', message: r.message ?? '尚未配置可用的 AI 端点' }
      return r
    },
    async history(nodeId, limit) { return explainSvc.explainHistory(nodeId, limit) },
    async followups() { return explainSvc.EXPLAIN_FOLLOWUPS },
    // R22 受限多轮辅导：history 为前端回传的对话上下文，服务端做作用域护栏与前置引导
    async tutor(nodeId, question, history, opts): Promise<TutorChatResult> {
      const r = await explainSvc.tutorChat({
        nodeId, question: String(question ?? ''),
        history: Array.isArray(history) ? history : [],
        questionId: opts?.questionId ?? null,
        role: opts?.role === 'strong' ? 'strong' : 'tutor'
      })
      if ('error' in r) return { error: 'no-endpoint', message: r.message ?? '尚未配置可用的 AI 端点' }
      return r
    }
  },

  ai: {
    async endpoints() { return aiSvc.endpoints() },
    async saveEndpoints(list) { aiSvc.saveEndpoints(list) },
    async test(cfg) { return aiSvc.testEndpoint(cfg) },
    async usage(days) { return aiSvc.usageSummary(days) },
    async byTask(days) { return aiSvc.usageByTask(days) },
    async errors(limit) { return aiSvc.recentAiErrors(limit) },
    async tutorStatus() { return tutorSvc.tutorStatus() },
    async tutorStart() { return tutorSvc.ensureTutor() },
    async tutorStop() { tutorSvc.stopTutor('ui'); return tutorSvc.tutorStatus() },
    async tutorLog(limit) { return tutorSvc.tutorLogTail(limit ?? 60) },
    async tutorSetMode(mode) { tutorSvc.writeInferConfig({ mode }); return tutorSvc.tutorStatus() },
    async tutorSetModel(modelId) { tutorSvc.writeInferConfig({ modelId }); return tutorSvc.tutorStatus() },
    async tutorCatalog() { return tutorSvc.tutorCatalog() }
  },

  // R20 游戏化：XP/等级、streak、徽章墙、章节 Boss、庆祝事件
  game: {
    async overview() { return gameSvc.gameOverview() },
    async badges(domain) { return gameSvc.badgeWall(domain ?? 'fe') },
    async events() { return gameSvc.drainEvents(false) },
    async drainEvents() { return gameSvc.drainEvents(true) },
    async bosses(domain) { return gameSvc.listBosses(domain ?? 'fe') },
    async chapters(domain) { return gameSvc.chapterProgress(domain ?? 'fe') },
    async reportExplorer(visitedChapterIds) { return gameSvc.reportExplorer(visitedChapterIds ?? []) }
  },

  // 项目闯关：真敲代码 + 沙箱判题（测试源码只留在主进程，渲染层拿不到）
  project: {
    async list() { return projectSvc.projectList() },
    async detail(id) { return projectSvc.projectDetail(String(id)) },
    async run(projectId, levelId, code, stepBase, stepN) { return projectSvc.projectRunLevel(String(projectId), String(levelId), String(code ?? ''), typeof stepBase === 'string' ? stepBase : undefined, typeof stepN === 'number' ? stepN : undefined) },
    async saveDraft(projectId, levelId, code) { return projectSvc.projectSaveDraft(String(projectId), String(levelId), String(code ?? '')) },
    async resetLevel(projectId, levelId) { return projectSvc.projectResetLevel(String(projectId), String(levelId)) },
    async revertLevel(projectId, levelId) { return projectSvc.projectRevertLevel(String(projectId), String(levelId)) },
    async stepAnswer(projectId, levelId, step) { return projectSvc.projectStepAnswer(String(projectId), String(levelId), Number(step)) },
    async resetAll(projectId) { return projectSvc.projectResetAll(String(projectId)) }
  },

  // 从零开始：清空全部学习进度（不动 AI 配置与题库缓存）
  progress: {
    async summary() { return progressSvc.progressSummary() },
    async resetAll() { return progressSvc.resetAllProgress() }
  },

  settings: {
    async all(): Promise<AppSettings> {
      return {
        endpoints: aiSvc.endpoints(),
        routing: settingGet('ai.routing') ?? { fastEndpointId: null, strongEndpointId: null, tutorEndpointId: null },
        desiredRetention: settingGet<number>('srs.desiredRetention') ?? 0.9,
        globalMixRatio: settingGet<number>('srs.globalMixRatio') ?? 0.35,
        dailyTarget: settingGet<number>('practice.dailyTarget') ?? 20,
        strictTiming: settingGet<boolean>('exam.strictTiming') ?? true,
        autoWeekUpdate: settingGet<boolean>('bank.autoWeekUpdate') ?? false,
        reminderOnLaunch: settingGet<boolean>('ui.reminderOnLaunch') ?? true,
        theme: settingGet<'dark' | 'light'>('ui.theme') ?? 'dark'
      }
    },
    async get<T>(key: string) { return settingGet<T>(key) },
    async set(key: string, value: unknown) {
      if (key === 'endpoints') aiSvc.saveEndpoints(value as any)
      else if (key === 'routing') settingSet('ai.routing', value)
      else if (key === 'desiredRetention') settingSet('srs.desiredRetention', value)
      else if (key === 'globalMixRatio') settingSet('srs.globalMixRatio', value)
      else if (key === 'dailyTarget') settingSet('practice.dailyTarget', value)
      else if (key === 'strictTiming') settingSet('exam.strictTiming', value)
      else if (key === 'autoWeekUpdate') settingSet('bank.autoWeekUpdate', value)
      else if (key === 'reminderOnLaunch') settingSet('ui.reminderOnLaunch', value)
      else if (key === 'theme') settingSet('ui.theme', value)
      else settingSet(key, value)
    }
  }
} satisfies ForgeApi

/** 自动把 impl 的每个方法挂成 ipcMain.handle('<ns>.<fn>') */
export function registerIpc() {
  let n = 0
  for (const [ns, group] of Object.entries(impl) as [string, Record<string, Function>][]) {
    for (const [fn, f] of Object.entries(group)) {
      ipcMain.handle(`${ns}.${fn}`, async (_e, ...args) => f(...args))
      n++
    }
  }
  console.log(`[ipc] 已注册 ${n} 个通道`)
}
