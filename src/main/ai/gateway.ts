import { all, get, run, settingGet, settingSet } from '../db'
import type { EndpointConfig } from '../../shared/types'

/**
 * OpenAI 兼容网关：多端点注册 + 角色路由 + JSON 严格解析 + 重试降级 + 用量记账。
 * 不依赖 Electron API，可在纯 Node 下测试。
 */

export const DEFAULT_ENDPOINTS: EndpointConfig[] = [
  { id: 'local-qwen', label: '本地 qwen（免费离线）', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen', role: 'fast', enabled: true, local: true, temperature: 0.3 },
  { id: 'deepseek-chat', label: 'DeepSeek V3（在线强档）', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', role: 'strong', enabled: true, temperature: 0.2 }
]

export function endpoints(): EndpointConfig[] {
  const saved = settingGet<EndpointConfig[]>('ai.endpoints')
  if (Array.isArray(saved) && saved.length) return saved
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

export function pickEndpoint(role: 'fast' | 'strong', endpointId?: string): EndpointConfig | null {
  const list = endpoints().filter((e) => e.enabled !== false)
  if (endpointId) return list.find((e) => e.id === endpointId) ?? null
  const routing = settingGet<{ fastEndpointId?: string; strongEndpointId?: string }>('ai.routing') ?? {}
  const forced = role === 'fast' ? routing.fastEndpointId : routing.strongEndpointId
  if (forced) { const hit = list.find((e) => e.id === forced); if (hit) return hit }
  return list.find((e) => e.role === role) ?? list.find((e) => e.role === 'any') ?? list[0] ?? null
}

export class NoEndpoint extends Error {}

export interface ChatOpts {
  task: string
  system?: string
  user: string
  role?: 'fast' | 'strong'
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
  const maxTok = o.maxTokens ?? ep.maxTokens
  if (maxTok) body.max_tokens = maxTok

  const url = `${ep.baseUrl.replace(/\/+$/, '')}/chat/completions`
  let lastErr = ''
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), o.timeoutMs ?? 90000)
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(ep.apiKey ? { authorization: `Bearer ${ep.apiKey}` } : {}) },
        body: JSON.stringify(body),
        signal: ac.signal
      })
      clearTimeout(timer)
      if (!res.ok) { lastErr = `HTTP ${res.status} ${(await res.text()).slice(0, 200)}`; throw new Error(lastErr) }
      const j: any = await res.json()
      const text: string = j?.choices?.[0]?.message?.content ?? ''
      if (!text.trim()) { lastErr = '模型返回空内容'; throw new Error(lastErr) }
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
      return out
    } catch (e: any) {
      lastErr = e?.name === 'AbortError' ? `请求超时（${o.timeoutMs ?? 90000}ms）` : String(e?.message || e)
      if (attempt === 1) await sleep(800)
    }
  }
  logUsage(o, { text: '', model: ep.model, endpointId: ep.id, inTokens: 0, outTokens: 0, ms: Date.now() - t0 }, false, lastErr)
  throw new Error(lastErr || 'AI 调用失败')
}

/** JSON 抽取：容忍 ```json 包裹、前后闲话、尾随逗号 */
export function extractJson(text: string): any {
  if (!text) throw new Error('空响应')
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const raw = fence ? fence[1] : text
  const candidates: string[] = []
  const firstObj = raw.search(/[[{]/)
  if (firstObj >= 0) {
    const open = raw[firstObj]
    const close = open === '{' ? '}' : ']'
    let depth = 0, inStr = false, esc = false
    for (let i = firstObj; i < raw.length; i++) {
      const c = raw[i]
      if (esc) { esc = false; continue }
      if (c === '\\') { esc = true; continue }
      if (c === '"') inStr = !inStr
      if (inStr) continue
      if (c === open) depth++
      else if (c === close) { depth--; if (depth === 0) { candidates.push(raw.slice(firstObj, i + 1)); break } }
    }
  }
  candidates.push(raw.trim())
  for (const c of candidates) {
    for (const variant of [c, c.replace(/,\s*([}\]])/g, '$1')]) {
      try { return JSON.parse(variant) } catch { /* next */ }
    }
  }
  throw new Error('无法从模型输出中解析 JSON')
}

/** 结构化输出：失败时自动补一轮"只准输出 JSON"的修复请求 */
export async function chatJson<T = any>(o: ChatOpts): Promise<{ data: T } & ChatResult> {
  const r = await chat(o)
  try { return { ...r, data: extractJson(r.text) as T } } catch {
    const fixed = await chat({
      ...o,
      task: o.task + ':repair',
      system: '你是一个只输出合法 JSON 的序列化器。把输入内容整理成要求的 JSON，不要任何解释文字。',
      user: `要求：保持原意，输出合法 JSON（UTF-8，不加 markdown 代码块）。\n原始输出：\n${r.text.slice(0, 6000)}`,
      temperature: 0,
      refId: o.refId,
      refType: o.refType
    })
    return { ...fixed, data: extractJson(fixed.text) as T }
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
