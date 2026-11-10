import { ipcMain, shell, app } from 'electron'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveDataDir, contentRoot, settingGet, settingSet, reloadContent, get } from './db'
import type { ForgeApi } from '../shared/api'
import type { AppSettings } from '../shared/types'
import * as graphSvc from './services/graph'
import * as practiceSvc from './services/practice'
import * as examSvc from './services/exam'
import * as insightsSvc from './services/insights'
import * as bankSvc from './services/bank'
import * as srsSvc from './services/srs'
import * as aiSvc from './ai/gateway'
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
        const out = execFileSync(process.execPath, [join(projectRoot(), 'scripts', 'validate.mjs')], { cwd: projectRoot(), encoding: 'utf8', timeout: 60000 })
        return { ok: !/❌/.test(out), output: out }
      } catch (e: any) {
        return { ok: false, output: `${e?.stdout ?? ''}\n${e?.stderr ?? e?.message ?? ''}`.slice(0, 4000) }
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
    async setSetting(key, value) { practiceSvc.setPracticeSetting(key, value) }
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
    async start(domain) { return insightsSvc.startPlacement(domain) },
    async next(sessionId) { return insightsSvc.nextPlacementItem(sessionId) },
    async submit(sessionId, qid, answer) { return insightsSvc.submitPlacement(sessionId, qid, answer) },
    async results() { return insightsSvc.placementResults() },
    async history(limit) { return insightsSvc.placementHistory(limit) }
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

  ai: {
    async endpoints() { return aiSvc.endpoints() },
    async saveEndpoints(list) { aiSvc.saveEndpoints(list) },
    async test(cfg) { return aiSvc.testEndpoint(cfg) },
    async usage(days) { return aiSvc.usageSummary(days) },
    async byTask(days) { return aiSvc.usageByTask(days) },
    async errors(limit) { return aiSvc.recentAiErrors(limit) }
  },

  settings: {
    async all(): Promise<AppSettings> {
      return {
        endpoints: aiSvc.endpoints(),
        routing: settingGet('ai.routing') ?? { fastEndpointId: null, strongEndpointId: null },
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
