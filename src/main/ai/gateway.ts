import { all, get, run, settingGet, settingSet } from '../db'
import type { EndpointConfig } from '../../shared/types'
// JSON 抽取/截断抢救是零依赖纯函数，放在 shared 里让 CLI 与单元测试也能直接验证
import { extractJson, salvageElements } from '../../shared/knowledge-core.mjs'
// 错误分类同样是零依赖纯函数：让"模型服务没启动"的秒级失败有专门可读提示
import { classifyError } from '../../shared/ai-error-core.mjs'
// 内置答疑小模型（llama.cpp CPU 推理）：懒启动、零显存、空闲自动卸载
import { ensureTutor, touchTutor, TUTOR_ALIAS, TUTOR_BASE_URL, TUTOR_ENDPOINT_ID, TUTOR_PORT } from './tutor-model'

/**
 * OpenAI 兼容网关：多端点注册 + 角色路由 + JSON 严格解析 + 重试降级 + 用量记账。
 * 不依赖 Electron API，可在纯 Node 下测试。
 */

// 本机推理栈是 Strata（OpenAI 兼容，端口 1234，模型别名 qwen），不是 Ollama（11434）。
// 端口必须与 docs/ops/local-model-service.md 的实测启动方式一致，否则全新安装会默认打到无人监听的端口。
export const DEFAULT_ENDPOINTS: EndpointConfig[] = [
  // 内置答疑专精小模型：随项目分发、CPU 推理（显存 0）、按需启动/空闲卸载，负责"看不懂时的讲解"
  { id: TUTOR_ENDPOINT_ID, label: '本地答疑·Qwen3.8-4B（CPU，零显存）', baseUrl: TUTOR_BASE_URL, model: TUTOR_ALIAS, role: 'tutor', enabled: true, local: true, temperature: 0.4, maxTokens: 250 },
  { id: 'local-qwen', label: '本地 qwen（免费离线）', baseUrl: 'http://127.0.0.1:1234/v1', model: 'qwen', role: 'fast', enabled: true, local: true, temperature: 0.3 },
  { id: 'deepseek-chat', label: 'DeepSeek V3（在线强档）', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', role: 'strong', enabled: true, temperature: 0.2 }
]

/** 判断端点是否是内置答疑模型（id 或端口命中都算，便于用户改过 baseUrl 后仍能识别） */
export function isLocalTutor(ep: EndpointConfig): boolean {
  return ep.id === TUTOR_ENDPOINT_ID || ep.baseUrl.includes(`:${TUTOR_PORT}`)
}

/** 连接层故障分类：让"模型服务没启动"这种秒级失败有专门的可读提示，而不是笼统的 fetch failed。 */
export type AiErrorKind = 'service-down' | 'timeout' | 'http' | 'network' | 'empty' | 'unknown'
export interface ClassifiedError { kind: AiErrorKind; message: string; retryable: boolean }

export function endpoints(): EndpointConfig[] {
  const saved = settingGet<EndpointConfig[]>('ai.endpoints')
  if (Array.isArray(saved) && saved.length) {
    // 老库/老配置升级：把后续版本新增的「内置答疑模型」补进去（用户自己动手删过也不会被反复加回，
    // 因为只要列表里出现过该 id 就算他做过选择；这里只在完全没出现过时补一次）。
    if (!saved.some((e) => e.id === TUTOR_ENDPOINT_ID)) {
      const tutor = DEFAULT_ENDPOINTS.find((d) => d.id === TUTOR_ENDPOINT_ID)!
      const merged = [tutor, ...saved]
      settingSet('ai.endpoints', merged)
      return merged
    }
    return saved
  }
  // 首次：允许用环境变量播种（便于初期免配置跑通）
  const seeded = [...DEFAULT_ENDPOINTS]
  const key = process.env.DEEPSEEK_API_KEY || process.env.FORGE_API_KEY
  if (key) {
    for (const e of seeded) if (!e.local) e.apiKey = key
    if (process.env.DEEPSEEK_BASE_URL) seeded.find((e) => e.id === 'deepseek-chat')!.baseUrl = process.env.DEEPSEEK_BASE_URL.replace(/\/$/, '')
    if (process.env.LLM_MODEL) seeded.find((e) => e.id === 'deepseek-chat')!.model = process.env.LLM_MODEL
  }
  settingSet('ai.endpoints', seeded)
  return seeded
}
export function saveEndpoints(list: EndpointConfig[]) {
  settingSet('ai.endpoints', list)
}

export type AiRole = 'fast' | 'strong' | 'tutor'

export function pickEndpoint(role: AiRole, endpointId?: string): EndpointConfig | null {
  const list = endpoints().filter((e) => e.enabled !== false)
  if (endpointId) return list.find((e) => e.id === endpointId) ?? null
  const routing = settingGet<{ fastEndpointId?: string; strongEndpointId?: string; tutorEndpointId?: string }>('ai.routing') ?? {}
  const forced = role === 'fast' ? routing.fastEndpointId : role === 'tutor' ? routing.tutorEndpointId : routing.strongEndpointId
  if (forced) { const hit = list.find((e) => e.id === forced); if (hit) return hit }
  const direct = list.find((e) => e.role === role)
  if (direct) return direct
  // 答疑角色是「体验优先」而非「必须」：本地小模型没配/被禁用时退回 fast，再退 strong（云端兜底）
  if (role === 'tutor') {
    return list.find((e) => e.role === 'fast') ?? list.find((e) => e.role === 'strong')
      ?? list.find((e) => e.role === 'any') ?? list[0] ?? null
  }
  return list.find((e) => e.role === 'any') ?? list[0] ?? null
}

export class NoEndpoint extends Error {}

export interface ChatOpts {
  task: string
  system?: string
  user: string
  role?: AiRole
  endpointId?: string
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
  refId?: string
  refType?: string
}
export interface ChatResult { text: string; model: string; endpointId: string; inTokens: number; outTokens: number; ms: number }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function chat(o: ChatOpts): Promise<ChatResult> {
  const ep = pickEndpoint(o.role ?? 'fast', o.endpointId)
  if (!ep) throw new NoEndpoint('尚未配置可用的 AI 端点，请在设置页添加 OpenAI 兼容端点')
  // 内置答疑模型：懒启动。没进程就拉起来（首次约 3-6s），失败把具体原因抛给上层而不是笼统 fetch failed
  if (isLocalTutor(ep)) {
    const w = await ensureTutor()
    if (!w.ok) {
      const err = new Error(w.message)
      ;(err as any).kind = 'service-down'
      throw err
    }
  }
  const t0 = Date.now()
  const body: Record<string, unknown> = {
    model: ep.model,
    messages: [
      ...(o.system ? [{ role: 'system', content: o.system }] : []),
      { role: 'user', content: o.user }
    ],
    temperature: o.temperature ?? ep.temperature ?? 0.2,
    stream: false
  }
  // Qwen3.5 默认开思考链，reasoning 会把 max_tokens 吃光导致正文为空；答疑场景要直给，显式关闭
  if (isLocalTutor(ep)) body.chat_template_kwargs = { enable_thinking: false }
  const maxTok = o.maxTokens ?? ep.maxTokens
  if (maxTok) body.max_tokens = maxTok

  const url = `${ep.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const timeoutMs = o.timeoutMs ?? 90000
  let lastErr = ''
  let lastKind: AiErrorKind = 'unknown'
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), timeoutMs)
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(ep.apiKey ? { authorization: `Bearer ${ep.apiKey}` } : {}) },
        body: JSON.stringify(body),
        signal: ac.signal
      })
      clearTimeout(timer)
      if (!res.ok) { lastErr = `HTTP ${res.status} ${(await res.text()).slice(0, 200)}`; lastKind = 'http'; throw new Error(lastErr) }
      const j: any = await res.json()
      const text: string = j?.choices?.[0]?.message?.content ?? ''
      if (!text.trim()) {
        lastErr = '模型返回空内容'; lastKind = 'empty'; throw new Error(lastErr)
      }
      const usage = j?.usage ?? {}
      const out: ChatResult = {
        text,
        model: j?.model ?? ep.model,
        endpointId: ep.id,
        inTokens: usage.prompt_tokens ?? 0,
        outTokens: usage.completion_tokens ?? 0,
        ms: Date.now() - t0
      }
      logUsage(o, out, true)
      if (isLocalTutor(ep)) touchTutor()
      return out
    } catch (e: any) {
      const c = classifyError(e, { timeoutMs, baseUrl: ep.baseUrl, local: ep.local })
      lastErr = c.message; lastKind = c.kind
      // 超时（重 payload 再试必再超时）与服务未启动（没人监听，重试只会再秒拒）都不重试；
      // 只有 HTTP/网络/空响应这类可能瞬时恢复的错误，才在第一次失败后短暂等待重试。
      if (!c.retryable) break
      if (attempt === 1) await sleep(800)
    }
  }
  logUsage(o, { text: '', model: ep.model, endpointId: ep.id, inTokens: 0, outTokens: 0, ms: Date.now() - t0 }, false, lastErr)
  const err = new Error(lastErr || 'AI 调用失败')
  ;(err as any).kind = lastKind
  throw err
}

/** 结构化输出：整段解析失败先尝试逐元素抢救，实在救不回才补一轮"只准输出 JSON"的修复请求 */
export async function chatJson<T = any>(o: ChatOpts): Promise<{ data: T } & ChatResult> {
  const r = await chat(o)
  try { return { ...r, data: extractJson(r.text) as T } } catch { /* fall through */ }
  const salvaged = salvageElements(r.text)
  if (salvaged?.length) {
    logUsage(o, r, true, `salvaged:${salvaged.length}`)   // 留痕：这批题是从截断输出里抢救的
    return { ...r, data: salvaged as unknown as T }
  }
  if (!r.text.trim()) throw new Error('模型返回空内容，无法修复')
  const fixed = await chat({
    ...o,
    task: o.task + ':repair',
    system: '你是一个只输出合法 JSON 的序列化器。把输入内容整理成要求的 JSON，不要任何解释文字。',
    user: `要求：保持原意，输出合法 JSON（UTF-8，不加 markdown 代码块）。\n原始输出：\n${r.text.slice(0, 6000)}`,
    temperature: 0,
    // 修复只是重排版，不该比重试原文更久；不给上限就会拖满 90s×2 次重试
    timeoutMs: Math.min(o.timeoutMs ?? 60000, 60000),
    refId: o.refId,
    refType: o.refType
  })
  try { return { ...fixed, data: extractJson(fixed.text) as T } } catch {
    const again = salvageElements(fixed.text)
    if (again?.length) return { ...fixed, data: again as unknown as T }
    throw new Error('模型输出无法解析为 JSON')
  }
}

function logUsage(o: ChatOpts, r: ChatResult, ok: boolean, note?: string) {
  run(`INSERT INTO ai_log(ts,task,model,in_tokens,out_tokens,ms,ref_type,ref_id,ok,note)
       VALUES(datetime('now','localtime'),?,?,?,?,?,?,?,?,?)`,
    [o.task, r.model, r.inTokens, r.outTokens, r.ms, o.refType ?? '', o.refId ?? '', ok ? 1 : 0, note ?? ''])
}

export async function testEndpoint(cfg: EndpointConfig): Promise<{ ok: boolean; message: string; latency: number; models?: string[] }> {
  const t0 = Date.now()
  const base = cfg.baseUrl.replace(/\/+$/, '')
  try {
    const res = await fetch(`${base}/models`, { headers: cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}, signal: AbortSignal.timeout(12000) })
    const models = res.ok ? ((await res.json() as any)?.data ?? []).map((m: any) => m.id).slice(0, 20) : undefined
    if (res.ok) return { ok: true, message: `/models 可用${models?.length ? `，共 ${models.length} 个模型` : ''}`, latency: Date.now() - t0, models }
  } catch { /* 很多端点不实现 /models，继续试对话 */ }
  try {
    const r = await chat({ task: 'test', endpointId: cfg.id, user: '回复两个字：可用', maxTokens: 16, timeoutMs: 20000 })
    return { ok: true, message: `对话连通：${r.text.slice(0, 40)}`, latency: Date.now() - t0 }
  } catch (e: any) {
    return { ok: false, message: String(e?.message || e), latency: Date.now() - t0 }
  }
}

export function usageSummary(days = 7) {
  return get<{ calls: number; tokens: number; ms: number; fails: number }>(
    `SELECT COUNT(*) calls, COALESCE(SUM(in_tokens+out_tokens),0) tokens, COALESCE(SUM(ms),0) ms,
       SUM(CASE WHEN ok=0 THEN 1 ELSE 0 END) fails
     FROM ai_log WHERE ts>=datetime('now','localtime',?)`, [`-${days} day`]) ?? { calls: 0, tokens: 0, ms: 0, fails: 0 }
}
export function usageByTask(days = 7) {
  // ⚠️ 这里必须用 all()：get() 走 prepare().get()，只返回「一行」而不是数组。
  // 之前误用 get() 导致渲染层 v-for 迭代到的是单个对象的各个字段值（界面出现 "次 · tokens · NaNs"）。
  return all<{ task: string; calls: number; tokens: number; ms: number; fails: number }[]>(
    `SELECT task, COUNT(*) calls, COALESCE(SUM(in_tokens+out_tokens),0) tokens, COALESCE(SUM(ms),0) ms,
       SUM(CASE WHEN ok=0 THEN 1 ELSE 0 END) fails
     FROM ai_log WHERE ts>=datetime('now','localtime',?) GROUP BY task ORDER BY calls DESC`, [`-${days} day`]) ?? []
}
export function recentAiErrors(limit = 20) {
  return all<{ ts: string; task: string; model: string; note: string }[]>(
    `SELECT ts,task,model,note FROM ai_log WHERE ok=0 ORDER BY id DESC LIMIT ?`, [limit]) ?? []
}
