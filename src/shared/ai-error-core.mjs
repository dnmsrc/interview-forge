/**
 * AI 网关错误分类（零依赖纯函数）
 *
 * 主进程 src/main/ai/gateway.ts 与 scripts/qa 单测共用同一份分类规则，
 * 保证「应用里弹出的错误提示」和「CI 里校验的判定」一致。
 * 本文件禁止 import electron / node:sqlite / fs —— CLI 脚本 import src/main 下的
 * 任何文件都会被 electron 拖死（与 knowledge-core.mjs 同样的约束）。
 */

// undici（Node 内置 fetch）在连接被拒时抛 TypeError: fetch failed，真正原因藏在 cause 里
const DOWN_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'EADDRNOTAVAIL', 'ENOTFOUND', 'EHOSTUNREACH', 'EAI_AGAIN'])

function safeUrl(baseUrl) {
  try {
    const u = new URL(baseUrl)
    return { host: u.hostname, port: u.port || (u.protocol === 'https:' ? '443' : '80') }
  } catch {
    return { host: baseUrl, port: '' }
  }
}

/**
 * 把任意 fetch/解析异常归一化为 { kind, message, retryable }。
 * @param {unknown} e 捕获到的异常
 * @param {{timeoutMs:number, baseUrl:string, local?:boolean}} ctx 超时上限与端点信息
 * @returns {{kind:'service-down'|'timeout'|'http'|'network'|'empty'|'unknown', message:string, retryable:boolean}}
 */
export function classifyError(e, ctx) {
  const timeoutMs = ctx?.timeoutMs ?? 90000
  const { host, port } = safeUrl(ctx?.baseUrl ?? '')
  const where = `${host}${port ? ':' + port : ''}`

  // AbortController 超时
  if (e?.name === 'AbortError') {
    return {
      kind: 'timeout',
      retryable: false,
      message: `请求超时（${timeoutMs}ms）：模型在限定时间内没返回，通常是输入太长或本地算力被占满，可稍后重试或关闭其它占用 GPU 的任务`
    }
  }

  const msg = String(e?.message ?? e ?? '')
  // HTTP 非 2xx 在调用处已转成普通 Error，这里按文本前缀兜底识别
  if (msg.startsWith('HTTP ')) return { kind: 'http', retryable: true, message: msg }
  if (msg.includes('模型返回空内容')) {
    return { kind: 'empty', retryable: true, message: '模型返回空内容，可重试一次；连续出现请重启模型服务' }
  }

  // 沿 cause 链找系统级错误码（undici 把 ECONNREFUSED 包在 error.cause 里）
  let cur = e
  let code = ''
  let sawDown = false
  for (let i = 0; cur && i < 5; i++, cur = cur.cause) {
    if (cur.code && DOWN_CODES.has(cur.code)) { code = cur.code; sawDown = true; break }
    const cm = String(cur.message ?? cur)
    if (/failed to connect|connect ECONNREFUSED|connection refused|连接被拒|fetch failed/i.test(cm)) sawDown = true
  }

  if (sawDown) {
    const tip = ctx?.local
      ? `本地模型服务未启动或仍在加载权重。请按 docs/ops/local-model-service.md 第 2 节拉起服务（监听 ${where}），启动后等终端出现 ready 再重试；排查：curl http://${where}/v1/models`
      : `无法连接到 ${where}（${code || '连接被拒绝'}）。请检查端点地址、网络与代理设置，确认服务在线后重试`
    return { kind: 'service-down', retryable: false, message: tip }
  }

  return { kind: 'network', retryable: true, message: msg || '网络请求失败' }
}
