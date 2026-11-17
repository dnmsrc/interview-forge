import { join } from 'node:path'
import { all, get, contentRoot } from '../db'
import { chat, NoEndpoint } from '../ai/gateway'
import { syncFromFiles } from './knowledge'
// 讲义起草管道的唯一真源在 scripts/kb-draft-core.mjs（CLI kb-build 与应用共用，
// 同 seed-core.mjs 的跨端模式）：来源获取 → AI 起草 → 八小节质量闸门。
// 本文件只负责注入依赖（查库、chat、落盘目录）并同步索引，禁止重复实现流程。
import { buildDraft } from '../../../scripts/kb-draft-core.mjs'

/**
 * 讲义生成服务（契约 KNOWLEDGE-SYSTEM.md §9 的应用侧入口）。
 *
 * 背景修复：讲义此前只有外部 CLI 能产出，应用内没有任何生成入口，
 * 用户看到「尚未收录」却无从触发；这里补上单节点与批量的 IPC 化生成。
 */

export interface DraftOutcome {
  node: string
  status: 'written' | 'stale' | 'dry' | 'skip-exists' | 'no-official' | 'fetch-thin' | 'sources-only' | 'no-endpoint' | 'missing-node' | 'error'
  path?: string
  flags?: string[]
  error?: string
  words?: number
  /** 机器/AI 自动补写过的部分，便于向用户解释"为什么这次过了而上次没进 _stale" */
  repaired?: string[]
}

export interface BatchOptions { domain?: string; limit?: number; onlyEmpty?: boolean; force?: boolean; concurrency?: number }
export interface BatchResult { tally: Record<string, number>; results: DraftOutcome[]; indexed: ReturnType<typeof syncFromFiles> | null }

function draftCtx() {
  return {
      // role=strong：讲义是长文写作，走路由表里的强档（本机只有 local-qwen 时即它）。
      // 实测成功生成均值约 120 秒，150 秒上限会让接近完成的长文被打断 → 放到 240 秒
    chat: async (system: string, user: string) => {
      const r = await chat({ task: 'kb_draft', role: 'strong', system, user, maxTokens: 4000, timeoutMs: 240000 })
      return r.text
    },
    prereqOf: (nodeId: string) => {
      const rows = all<{ from_id: string }>(`SELECT from_id FROM edges WHERE to_id=? AND type IN ('advance','depend') LIMIT 5`, [nodeId])
      return rows.length ? rows.map((r) => r.from_id).join(', ') : null
    },
    // 「相关」小节的 [[双链]] 只允许用同模块下真实存在的考点 id（模型爱发明 id，一发明就断链进 _stale）
    siblingsOf: (nodeId: string) => {
      const parent = String(nodeId).split('.').slice(0, -1).join('.') + '.'
      return all<{ id: string }>(`SELECT id FROM nodes WHERE id LIKE ? AND id != ? AND level=4 AND status='active' LIMIT 4`, [parent + '%', nodeId]).map((r) => r.id)
    },
    validNodeIds: new Set(all<{ id: string }>(`SELECT id FROM nodes`).map((r) => r.id)),
    kbDir: join(contentRoot(), 'knowledge'),
    force: false, dry: false, noAi: false
  }
}

function nodeRow(nodeId: string) {
  return get<{ id: string; title: string; summary: string | null }>(
    `SELECT id,title,summary FROM nodes WHERE id=? AND level=4`, [nodeId])
}

/** 为单个考点生成讲义：写 content/knowledge/<...>.md 成功后立即增量入索引 */
export async function generateKnowledge(nodeId: string, opts: { force?: boolean } = {}): Promise<DraftOutcome> {
  const node = nodeRow(String(nodeId ?? ''))
  if (!node) return { node: String(nodeId), status: 'missing-node' }
  try {
    const r = await buildDraft(node as any, { ...draftCtx(), force: !!opts.force })
    if (r.status === 'written') syncFromFiles()   // 新文件立刻进索引，抽屉刷新即可见
    return r as DraftOutcome
  } catch (e: any) {
    if (e instanceof NoEndpoint) return { node: node.id, status: 'no-endpoint', error: '未配置可用 AI 端点' }
    return { node: node.id, status: 'error', error: String(e?.message ?? e).slice(0, 200) }
  }
}

/**
 * 批量补齐讲义。默认只处理没有讲义的 L4 考点，mustMaster 优先（重点先有可读材料），
 * 其余按图谱顺序。结束统一 syncFromFiles 一次，返回状态汇总供 UI 展示。
 */
export async function generateKnowledgeBatch(opts: BatchOptions = {}): Promise<BatchResult> {
  const limit = Math.max(1, Math.min(30, Number(opts.limit ?? 6)))
  // 本地模型实测：并发 2 时两篇都在 150s 超时（抢算力双双饿死）；默认串行，成功一篇再做下一篇
  const concurrency = Math.max(1, Math.min(4, Number(opts.concurrency ?? 1)))
  const where = [`n.level=4`, `n.status='active'`]
  const params: unknown[] = []
  if (opts.domain) { where.push('n.domain=?'); params.push(opts.domain) }
  let rows = all<{ id: string; title: string; summary: string | null; must_master: number }>(
    `SELECT n.id,n.title,n.summary,n.must_master FROM nodes n WHERE ${where.join(' AND ')}
     ORDER BY n.must_master DESC, n.ord ASC LIMIT ?`, [...params, limit * 4])
  if (opts.onlyEmpty !== false) {
    const have = new Set(all<{ node_id: string }>(`SELECT node_id FROM knowledge`).map((r) => r.node_id))
    rows = rows.filter((n) => !have.has(n.id))
  }
  const nodes = rows.slice(0, limit)
  const ctx = { ...draftCtx(), force: !!opts.force }

  const results: DraftOutcome[] = []
  let cursor = 0
  async function worker() {
    while (cursor < nodes.length) {
      const node = nodes[cursor++]
      try {
        const r = await buildDraft(node as any, ctx)
        results.push(r as DraftOutcome)
      } catch (e: any) {
        if (e instanceof NoEndpoint) { results.push({ node: node.id, status: 'no-endpoint', error: '未配置可用 AI 端点' }); cursor = nodes.length; return }
        results.push({ node: node.id, status: 'error', error: String(e?.message ?? e).slice(0, 160) })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, nodes.length) || 1 }, worker))

  const wrote = results.some((r) => r.status === 'written')
  const indexed = wrote ? syncFromFiles() : null
  const tally = results.reduce<Record<string, number>>((acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc }, {})
  return { tally, results, indexed }
}
