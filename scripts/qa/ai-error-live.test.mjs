// 端到端验证：对一个无人监听的端口发真实 fetch，确认 undici 抛出的原始错误
// 能被 classifyError 识别成 service-down（而不是笼统 network/fetch failed）。
// 走真实网络栈，不 mock；端口 12399 本机应无服务。
import { classifyError } from '../../src/shared/ai-error-core.mjs'

const PORT = 12399
const t0 = Date.now()
let raw
try {
  await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'qwen', messages: [] }),
    signal: AbortSignal.timeout(8000)
  })
  console.log('FAIL 预期连接失败但请求成功了（端口', PORT, '居然有服务？）')
  process.exit(1)
} catch (e) {
  raw = e
  console.log('--- 真实 undici 错误形态 ---')
  console.log('name:', e?.name, '| message:', e?.message)
  console.log('cause.code:', e?.cause?.code, '| cause.message:', e?.cause?.message)
  const c = classifyError(e, { timeoutMs: 150000, baseUrl: `http://127.0.0.1:${PORT}/v1`, local: true })
  console.log('--- 分类结果 ---')
  console.log(JSON.stringify(c, null, 2))
  const ms = Date.now() - t0
  const okKind = c.kind === 'service-down'
  const okNoRetry = c.retryable === false
  const okTip = c.message.includes(`${PORT}`) && c.message.includes('local-model-service.md')
  const okFast = ms < 5000  // 服务没起应秒级失败，不该吃超时
  console.log(`\nkind=service-down: ${okKind ? 'PASS' : 'FAIL'}`)
  console.log(`retryable=false:   ${okNoRetry ? 'PASS' : 'FAIL'}`)
  console.log(`提示含端口+文档:    ${okTip ? 'PASS' : 'FAIL'}`)
  console.log(`秒级失败(<5s,实耗${ms}ms): ${okFast ? 'PASS' : 'FAIL'}`)
  process.exit(okKind && okNoRetry && okTip && okFast ? 0 : 1)
}
