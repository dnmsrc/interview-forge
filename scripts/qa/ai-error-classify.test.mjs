// AI 网关错误分类单测：classifyError 是 src/shared 零依赖纯函数，可在纯 Node 下直接验证。
// 覆盖本机实测出现过的两类失败：服务未启动（fetch failed / ECONNREFUSED）与请求超时（AbortError）。
import { classifyError } from '../../src/shared/ai-error-core.mjs'

let pass = 0, fail = 0
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('PASS', name) }
  else { fail++; console.log('FAIL', name, extra ?? '') }
}

const LOCAL = { timeoutMs: 150000, baseUrl: 'http://127.0.0.1:1234/v1', local: true }
const REMOTE = { timeoutMs: 90000, baseUrl: 'https://api.example.com/v1' }

// 1. undici 真实形态：TypeError('fetch failed') 外包，cause 里才是 ECONNREFUSED
const undiciDown = new TypeError('fetch failed')
undiciDown.cause = { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:1234' }
const r1 = classifyError(undiciDown, LOCAL)
check('undici 连接被拒→service-down', r1.kind === 'service-down', r1.kind)
check('service-down 不重试', r1.retryable === false)
check('本地端点给启动指引+端口', r1.message.includes('127.0.0.1:1234') && r1.message.includes('local-model-service.md'), r1.message)

// 2. 没有 cause 码、只有 fetch failed 文本（旧 Node / 某些平台）
const r2 = classifyError(new TypeError('fetch failed'), LOCAL)
check('裸 fetch failed→service-down', r2.kind === 'service-down', r2.kind)

// 3. 远程端点连接被拒：提示应区分"网络/地址"而非让用户去拉本地服务
const remoteDown = new TypeError('fetch failed')
remoteDown.cause = { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND api.example.com' }
const r3 = classifyError(remoteDown, REMOTE)
check('远程 ENOTFOUND→service-down', r3.kind === 'service-down', r3.kind)
check('远程提示不含本地启动文档', !r3.message.includes('local-model-service.md'), r3.message)
check('远程提示含地址', r3.message.includes('api.example.com'), r3.message)

// 4. AbortError 超时：不重试，提示带超时毫秒数
const r4 = classifyError({ name: 'AbortError' }, LOCAL)
check('AbortError→timeout', r4.kind === 'timeout', r4.kind)
check('超时不重试', r4.retryable === false)
check('超时提示带毫秒', r4.message.includes('150000ms'), r4.message)

// 5. HTTP 非 2xx（gateway 已转成普通 Error，message 以 HTTP 开头）
const r5 = classifyError(new Error('HTTP 429 rate limited'), REMOTE)
check('HTTP 错误→http 且可重试', r5.kind === 'http' && r5.retryable === true, r5.kind)

// 6. 空内容
const r6 = classifyError(new Error('模型返回空内容'), LOCAL)
check('空内容→empty 且可重试', r6.kind === 'empty' && r6.retryable === true, r6.kind)

// 7. 其它未知网络错误：归 network 且可重试，不吞掉原始信息
const r7 = classifyError(new Error('socket hang up'), REMOTE)
check('未知错误→network 可重试', r7.kind === 'network' && r7.retryable === true, r7.kind)
check('network 保留原始信息', r7.message.includes('socket hang up'), r7.message)

// 8. 多层 cause（undici 有时再包一层 AggregateError）
const deep = new Error('fetch failed')
deep.cause = { message: 'connect failed', cause: { code: 'ECONNRESET' } }
const r8 = classifyError(deep, LOCAL)
check('两层 cause 仍识别为 service-down', r8.kind === 'service-down', r8.kind)

// 9. 非法 baseUrl 不抛异常（safeUrl 兜底）
const r9 = classifyError(undiciDown, { timeoutMs: 5000, baseUrl: 'not-a-url', local: true })
check('非法 URL 不崩溃且仍分类', r9.kind === 'service-down', r9.kind)

console.log(`\n${fail === 0 ? '=== 全部通过 ===' : '=== 存在失败 ==='} (pass=${pass}, fail=${fail})`)
process.exit(fail ? 1 : 0)
