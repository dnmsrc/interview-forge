/**
 * 项目闯关内容源：AI 应用 · 工具调用与微调取舍（2 关 6 步）
 *
 * 为什么这样拆：
 *   lv1 工具调用 —— 协议层（arguments 是字符串、并行调用、schema 校验、MCP 的 JSON-RPC 映射）
 *   lv2 微调取舍 —— 决策层（什么时候动权重）、账本层（LoRA 参数量/显存）、对齐层（DPO 损失）
 *
 * 判题沙箱只有 JS、没有网络，所以两关都是「纯函数 + 注入依赖」的模拟器：
 *   - 工具派发器把 registry 当参数传进来，不真的调天气 API；
 *   - 微调账本只算参数量和显存，不真的训练。
 * 这正好逼着把「协议细节」和「决策依据」讲清楚——真实系统里它们也是最容易含糊的部分。
 */

/* ============================================================ 第 1 关测试 */
const L1S1 = `{
  check('arguments 是 JSON 字符串：要二次解析成对象', () => {
    const r = parseToolCall({ name: 'get_weather', arguments: '{"city":"北京","unit":"c"}' })
    same(r.ok, true)
    same(r.name, 'get_weather')
    same(r.args, { city: '北京', unit: 'c' })
  })
  check('arguments 非法 JSON：返回 INVALID_ARGUMENTS，不能抛给上层', () => {
    const r = parseToolCall({ name: 'get_weather', arguments: '{"city":' })
    same(r.ok, false)
    same(r.error, 'INVALID_ARGUMENTS')
  })
  check('缺少 name：返回 INVALID_CALL', () => {
    const r = parseToolCall({ arguments: '{}' })
    same(r.ok, false)
    same(r.error, 'INVALID_CALL')
  })
  check('arguments 是空串：按空对象处理（很多模型的省略写法）', () => {
    const r = parseToolCall({ name: 'now', arguments: '' })
    same(r.ok, true)
    same(r.args, {})
  })
}`

const L1S2 = `{
  const registry = {
    get_weather: {
      schema: { required: ['city'], properties: { city: { type: 'string' }, unit: { enum: ['c', 'f'] } } },
      run: (args) => '晴 25°C ' + args.city
    }
  }

  check('合法参数：派发成功并拿到结果', () => {
    const r = dispatchTool({ name: 'get_weather', arguments: '{"city":"北京"}' }, registry)
    same(r.ok, true)
    same(r.result, '晴 25°C 北京')
  })
  check('缺必填字段：不执行 run，返回 SCHEMA_INVALID', () => {
    let ran = 0
    const reg = { ...registry, get_weather: { ...registry.get_weather, run: () => { ran++; return 'x' } } }
    const r = dispatchTool({ name: 'get_weather', arguments: '{}' }, reg)
    same(r.ok, false)
    same(r.error, 'SCHEMA_INVALID')
    same(ran, 0, '参数不合法时绝不能碰副作用')
  })
  check('enum 不匹配：同样拦在 schema 层', () => {
    const r = dispatchTool({ name: 'get_weather', arguments: '{"city":"北京","unit":"k"}' }, registry)
    same(r.ok, false)
    same(r.error, 'SCHEMA_INVALID')
  })
  check('未知工具：返回 UNKNOWN_TOOL，并带上是哪个', () => {
    const r = dispatchTool({ name: 'not_exists', arguments: '{}' }, registry)
    same(r.ok, false)
    same(r.error, 'UNKNOWN_TOOL')
    same(r.name, 'not_exists')
  })
  check('并行多个调用：结果按顺序返回，单个失败不影响其他', () => {
    const rs = dispatchMany([
      { name: 'get_weather', arguments: '{"city":"北京"}' },
      { name: 'not_exists', arguments: '{}' },
      { name: 'get_weather', arguments: '{"city":"上海"}' }
    ], registry)
    same(rs.length, 3)
    same(rs[0].ok, true)
    same(rs[1].ok, false)
    same(rs[2].result, '晴 25°C 上海')
  })
}`

const L1S3 = `{
  const registry = {
    get_weather: {
      description: '查城市天气',
      schema: { required: ['city'], properties: { city: { type: 'string' } } },
      run: (args) => '晴 ' + args.city
    }
  }

  check('initialize：协商协议版本并声明 tools 能力', () => {
    const r = handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, registry)
    same(r.jsonrpc, '2.0')
    same(r.id, 1)
    same(typeof r.result.protocolVersion, 'string')
    same(r.result.capabilities.tools, { listChanged: false })
  })
  check('tools/list：把 registry 映射成 MCP 工具描述', () => {
    const r = handleMcpRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, registry)
    same(r.result.tools.length, 1)
    same(r.result.tools[0].name, 'get_weather')
    same(r.result.tools[0].inputSchema.required, ['city'])
  })
  check('tools/call：执行并把结果包成 content 数组', () => {
    const r = handleMcpRequest({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'get_weather', arguments: { city: '北京' } }
    }, registry)
    same(r.result.content, [{ type: 'text', text: '晴 北京' }])
    same(r.result.isError, false)
  })
  check('tools/call 参数校验失败：isError=true，不抛异常', () => {
    const r = handleMcpRequest({
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'get_weather', arguments: {} }
    }, registry)
    same(r.result.isError, true)
    same(r.error, undefined, '工具级错误应放在 result 里，不是 JSON-RPC error')
  })
  check('未知方法：JSON-RPC -32601', () => {
    const r = handleMcpRequest({ jsonrpc: '2.0', id: 5, method: 'resources/list' }, registry)
    same(r.error.code, -32601)
  })
}`

/* ============================================================ 第 2 关测试 */
const L2S1 = `{
  check('知识每天在变：走 RAG，不动权重', () => {
    const r = chooseApproach({ freshnessDays: 3, privateCorpusTokens: 500000, needsFormat: false })
    same(r.approach, 'rag')
  })
  check('知识变化快 + 格式要求高：hybrid（检索供知识，微调供格式）', () => {
    const r = chooseApproach({ freshnessDays: 3, privateCorpusTokens: 500000, needsFormat: true })
    same(r.approach, 'hybrid')
  })
  check('知识稳定 + 强格式：微调最稳', () => {
    const r = chooseApproach({ freshnessDays: 180, privateCorpusTokens: 100000, needsFormat: true })
    same(r.approach, 'finetune')
  })
  check('知识半年一变但私域语料很大：检索比塞进权重划算', () => {
    const r = chooseApproach({ freshnessDays: 60, privateCorpusTokens: 5000000, needsFormat: false })
    same(r.approach, 'rag')
  })
  check('简单需求：先 prompt，别动权重也别上检索', () => {
    const r = chooseApproach({ freshnessDays: 365, privateCorpusTokens: 1000, needsFormat: false })
    same(r.approach, 'prompt')
  })
}`

const L2S2 = `{
  check('LoRA 参数量：rank × (dIn + dOut) 累加', () => {
    // q、v 两个 4096×4096 的模块，rank 8：8*(4096+4096)*2 = 131072
    same(loraParamCount([{ dIn: 4096, dOut: 4096 }, { dIn: 4096, dOut: 4096 }], 8), 131072)
  })
  check('没有 target module：参数量为 0', () => {
    same(loraParamCount([], 8), 0)
  })
  check('rank 翻倍，参数量也翻倍（线性，不是平方）', () => {
    const mods = [{ dIn: 1024, dOut: 1024 }]
    same(loraParamCount(mods, 16), loraParamCount(mods, 8) * 2)
  })
  check('16bit 显存：基础权重 + 适配器分别算', () => {
    // 7B 参数 × 2B = 14GB；适配器 131072 × 2B = 262144B
    same(loraMemoryBytes([{ dIn: 4096, dOut: 4096 }, { dIn: 4096, dOut: 4096 }], 8, { baseParams: 7e9, bits: 16 }), 14000000000 + 262144)
  })
  check('QLoRA：4bit NF4 把基础权重压到 1/4', () => {
    same(loraMemoryBytes([{ dIn: 4096, dOut: 4096 }], 8, { baseParams: 8e9, bits: 4 }), 4000000000 + 131072)
  })
}`

const L2S3 = `{
  check('策略与参考模型一致：DPO loss = ln2（没有偏好信号）', () => {
    const loss = dpoLoss(0.5, 0.5, 0.5, 0.5, 0.1)
    ok(Math.abs(loss - Math.log(2)) < 1e-9, '应约等于 0.6931，实际 ' + loss)
  })
  check('chosen 的 logprob 明显更高：loss 变小', () => {
    const loss = dpoLoss(0.9, 0.1, 0.5, 0.5, 0.1)
    ok(loss < Math.log(2), '偏好正确时 loss 应小于 ln2，实际 ' + loss)
  })
  check('方向反了（rejected 更高）：loss 大于 ln2', () => {
    const loss = dpoLoss(0.1, 0.9, 0.5, 0.5, 0.1)
    ok(loss > Math.log(2), '反偏好应被惩罚，实际 ' + loss)
  })
  check('β 越大，偏好差距的惩罚越强', () => {
    const small = dpoLoss(0.9, 0.1, 0.5, 0.5, 0.1)
    const large = dpoLoss(0.9, 0.1, 0.5, 0.5, 1.0)
    ok(large < small, 'β=1.0 时 loss 应更小，实际 ' + large + ' vs ' + small)
  })
  check('偏好像素校验：chosen 与 rejected 相同要报出来', () => {
    const bad = validatePreferencePairs([
      { prompt: 'p1', chosen: 'a', rejected: 'b' },
      { prompt: 'p2', chosen: 'a', rejected: 'a' }
    ])
    same(bad.length, 1)
    same(bad[0].index, 1)
    same(bad[0].reason, 'identical')
  })
  check('缺字段的样本也要报，且不崩', () => {
    const bad = validatePreferencePairs([{ prompt: 'p' }, { prompt: 'q', chosen: 'c', rejected: 'r' }])
    same(bad.length, 1)
    same(bad[0].reason, 'missing-field')
  })
}`

/* ============================================================ 第 1 关 */
const LV1 = {
  id: 'lv1',
  title: '工具调用：arguments 只是字符串，MCP 只是 JSON-RPC',
  emoji: '🔧',
  xp: 40,
  goal: '实现三件事：把 OpenAI 风格的 tool_call 解析成可执行调用（arguments 二次解析）、按 schema 校验后派发到 registry、把 registry 映射成 MCP 的 initialize / tools/list / tools/call 三种请求。',
  why: 'Function Calling 最容易被低估的是「arguments 是 JSON 字符串」：模型流式吐出来的是拼起来的片段，落库前必须二次解析；解析失败时如果直接抛异常，整条对话就断了。再往上，MCP 把这套能力标准化成 JSON-RPC 2.0——不理解消息层，就分不清「工具执行失败」和「协议错误」，线上排障会一直绕。',
  nodes: ['ai.tools.tool-calling', 'ai.tools.tool-calling.mcp-protocol'],
  thinking: [
    {
      title: '为什么 arguments 要二次解析',
      md: '模型看到的工具定义里，arguments 是 **string** 类型（JSON Schema 里它就是一个字符串），不是对象。流式输出时 delta 逐段拼进这个字符串，等 `finish_reason=tool_calls` 才得到完整 JSON。\n\n所以 `JSON.parse(call.arguments)` 是必须的，而且**必须容错**：模型偶尔吐尾逗号、单引号、markdown 包裹。真实工程里这一层失败要降级成「回灌错误让模型重试」，而不是让进程崩。'
    },
    {
      title: 'schema 校验放在派发前，而不是工具内部',
      md: '很多人把参数校验写在工具实现里，结果每个工具各写一遍、格式还不一致。正确做法是 registry 条目自带 schema，派发器**先校验、再执行**：不合法就返回错误对象，副作用一次都不碰。\n\n这也是工具投毒（tool poisoning）的第一道防线：模型给的参数不可信，没校验就直接拼 SQL / 拼 shell 是事故的起点。'
    },
    {
      title: 'MCP 的错误分两层',
      md: 'JSON-RPC 的错误码（-32601 方法不存在、-32602 参数非法）是**协议层**；工具自己执行失败（天气 API 超时）应该包在 `result.isError=true` 里返回，让模型能看到错误并决定下一步。\n\n分不清这两层，就会出现「工具报错把整个会话打断」或者「协议错误被模型当成工具结果继续编」。'
    }
  ],
  prereq: [
    {
      title: 'OpenAI 工具调用的消息往返',
      md: '一次完整往返是四步：\n\n1. 请求里带 `tools: [{ type: \'function\', function: { name, description, parameters } }]`；\n2. 模型返回 `tool_calls: [{ id, type: \'function\', function: { name, arguments } }]`，此时 `content` 通常为空；\n3. 客户端执行工具，把结果以 `role: \'tool\', tool_call_id` 的消息追加回去；\n4. 模型基于工具结果生成最终回答。\n\n`arguments` 在整个链路里都是字符串；`tool_choice` 决定要不要强制调用（auto / required / 指定函数）。'
    },
    {
      title: 'JSON-RPC 2.0 的最小约定',
      md: 'MCP 的消息层就是 JSON-RPC 2.0：请求 `{ jsonrpc: \'2.0\', id, method, params }`，成功响应 `{ jsonrpc, id, result }`，失败响应 `{ jsonrpc, id, error: { code, message } }`。\n\n标准错误码：`-32700` 解析错误、`-32600` 非法请求、`-32601` 方法不存在、`-32602` 参数非法、`-32603` 内部错误。通知（notification）没有 id，不需要响应。'
    }
  ],
  api: [
    {
      name: 'parseToolCall',
      sig: 'parseToolCall(raw: { name?, arguments? }) => { ok: true, name, args } | { ok: false, error }',
      args: 'raw 是模型返回的单个 tool_call（arguments 为 JSON 字符串，可能为空串）。',
      returns: 'ok=true 时给出解析后的 args 对象；arguments 非法返回 error=INVALID_ARGUMENTS，缺 name 返回 INVALID_CALL。',
      example: 'parseToolCall({ name: \'get_weather\', arguments: \'{"city":"北京"}\' })\n// → { ok: true, name: \'get_weather\', args: { city: \'北京\' } }'
    },
    {
      name: 'dispatchTool / dispatchMany',
      sig: 'dispatchTool(call, registry) => { ok, result?, error?, name? }；dispatchMany(calls, registry) => 结果数组',
      args: 'registry: { [name]: { schema: { required, properties }, run(args) } }。',
      returns: '成功 { ok:true, result }；未知工具 UNKNOWN_TOOL；schema 不合法 SCHEMA_INVALID（且不执行 run）。dispatchMany 按输入顺序返回，单个失败不影响其他。',
      example: 'dispatchTool({ name: \'get_weather\', arguments: \'{"city":"北京"}\' }, registry)'
    },
    {
      name: 'handleMcpRequest',
      sig: 'handleMcpRequest(req, registry) => JSON-RPC 响应对象',
      args: 'req: { jsonrpc, id, method, params? }；registry 同 dispatchTool。',
      returns: 'initialize → protocolVersion + capabilities.tools；tools/list → tools 描述数组；tools/call → content 数组（isError 标记工具级失败）；未知方法 → error.code=-32601。',
      example: 'handleMcpRequest({ jsonrpc: \'2.0\', id: 1, method: \'tools/list\' }, registry)'
    }
  ],
  usage: 'const parsed = parseToolCall(rawCall)\nif (!parsed.ok) return feedbackToModel(parsed.error)   // 把错误回灌，让模型重试\nconst result = dispatchTool(rawCall, registry)\nif (!result.ok) return { role: \'tool\', content: result.error }\nreturn { role: \'tool\', content: JSON.stringify(result.result) }',
  hints: [
    'parseToolCall 里先判 name，再判 arguments 是否为空串；非空时 try/catch JSON.parse。',
    'dispatchTool 里先查 registry，再校验 required 和 enum；校验不过直接返回，别调 run。',
    'handleMcpRequest 用 switch 分派三个方法；工具级失败放进 result.isError，协议级才是 error.code。'
  ],
  concepts: [
    {
      title: 'strict 模式与 JSON mode 不是一回事',
      md: 'JSON mode 只保证「输出是合法 JSON」；strict structured outputs 额外保证「符合你给的 schema 子集」（required 全列、additionalProperties:false、不支持递归等）。前者可能解析成功但字段缺失，后者才能直接当对象用。很多线上事故来自把 JSON mode 当成了 schema 保证。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '先解析：arguments 是字符串',
      think: '这是整条链路的第一道坑：把 arguments 当对象用会立刻报错。先把「字符串 → 对象」和失败降级写对，后面的派发才有东西可校验。',
      hint: '空串按 {} 处理；非空就 JSON.parse，包在 try/catch 里，失败返回 INVALID_ARGUMENTS。',
      code: `function parseToolCall(raw) {
  if (!raw || typeof raw.name !== 'string' || !raw.name) {
    return { ok: false, error: 'INVALID_CALL' }
  }
  const text = raw.arguments
  if (text === undefined || text === null || text === '') {
    return { ok: true, name: raw.name, args: {} }
  }
  try {
    const args = JSON.parse(text)
    if (args === null || typeof args !== 'object' || Array.isArray(args)) {
      return { ok: false, error: 'INVALID_ARGUMENTS' }
    }
    return { ok: true, name: raw.name, args }
  } catch {
    return { ok: false, error: 'INVALID_ARGUMENTS' }
  }
}`,
      test: L1S1,
      diag: [
        '没有对 arguments 做 JSON.parse，直接当对象返回了。',
        'JSON.parse 没包 try/catch，非法 JSON 直接抛到上层。',
        '判断 name 时只判了 truthy，空字符串没有被拦。',
        '空串没特殊处理，JSON.parse(\'\') 抛错被当成 INVALID_ARGUMENTS。'
      ]
    },
    {
      n: 2,
      title: '再派发：schema 校验必须先于副作用',
      think: '参数错误在真实系统里很常见（模型猜字段名），派发器必须在调用 run 之前拦住。这里同时验证 registry 查找、required、enum，以及并行多调用互不影响。',
      hint: '查表 → 校验 required 每项存在 → 校验 properties 里的 enum → 才调用 run。',
      code: `function parseToolCall(raw) {
  if (!raw || typeof raw.name !== 'string' || !raw.name) {
    return { ok: false, error: 'INVALID_CALL' }
  }
  const text = raw.arguments
  if (text === undefined || text === null || text === '') {
    return { ok: true, name: raw.name, args: {} }
  }
  try {
    const args = JSON.parse(text)
    if (args === null || typeof args !== 'object' || Array.isArray(args)) {
      return { ok: false, error: 'INVALID_ARGUMENTS' }
    }
    return { ok: true, name: raw.name, args }
  } catch {
    return { ok: false, error: 'INVALID_ARGUMENTS' }
  }
}

function validateArgs(args, schema) {
  const required = schema?.required ?? []
  for (const key of required) {
    if (args[key] === undefined) return false
  }
  const props = schema?.properties ?? {}
  for (const [key, rule] of Object.entries(props)) {
    if (rule?.enum && args[key] !== undefined && !rule.enum.includes(args[key])) return false
  }
  return true
}

function dispatchTool(call, registry) {
  const parsed = parseToolCall(call)
  if (!parsed.ok) return parsed
  const entry = registry[parsed.name]
  if (!entry) return { ok: false, error: 'UNKNOWN_TOOL', name: parsed.name }
  if (!validateArgs(parsed.args, entry.schema)) {
    return { ok: false, error: 'SCHEMA_INVALID', name: parsed.name }
  }
  return { ok: true, name: parsed.name, result: entry.run(parsed.args) }
}

function dispatchMany(calls, registry) {
  return calls.map((c) => dispatchTool(c, registry))
}`,
      test: L1S2,
      diag: [
        'dispatchTool 可能直接返回了 parseToolCall 的形状（ok/name/args），没有执行 run。',
        'validateArgs 只查了 required 没查 enum，或者顺序反了（先 run 再校验）。',
        '缺 required 时仍然调用了 run（副作用已经被碰了）。',
        '未知工具时没返回 name 字段，或者把 error 写成了别的值。',
        'dispatchMany 用了 forEach + push 但顺序被打乱，或一个失败就整体中断。'
      ]
    },
    {
      n: 3,
      title: '最后映射到 MCP：消息层与工具层的错误分开',
      think: 'MCP 是 JSON-RPC 2.0，方法名和错误码都有标准。难点不在协议本身，而在「工具执行失败」与「协议错误」的归属：前者进 result.isError，后者才是 error.code。',
      hint: 'switch(method)：initialize 返回协议版本与 capabilities；tools/list 映射 registry；tools/call 复用 dispatchTool 但把结果包成 content。',
      code: `function parseToolCall(raw) {
  if (!raw || typeof raw.name !== 'string' || !raw.name) {
    return { ok: false, error: 'INVALID_CALL' }
  }
  const text = raw.arguments
  if (text === undefined || text === null || text === '') {
    return { ok: true, name: raw.name, args: {} }
  }
  try {
    const args = JSON.parse(text)
    if (args === null || typeof args !== 'object' || Array.isArray(args)) {
      return { ok: false, error: 'INVALID_ARGUMENTS' }
    }
    return { ok: true, name: raw.name, args }
  } catch {
    return { ok: false, error: 'INVALID_ARGUMENTS' }
  }
}

function validateArgs(args, schema) {
  const required = schema?.required ?? []
  for (const key of required) {
    if (args[key] === undefined) return false
  }
  const props = schema?.properties ?? {}
  for (const [key, rule] of Object.entries(props)) {
    if (rule?.enum && args[key] !== undefined && !rule.enum.includes(args[key])) return false
  }
  return true
}

function dispatchTool(call, registry) {
  const parsed = parseToolCall(call)
  if (!parsed.ok) return parsed
  const entry = registry[parsed.name]
  if (!entry) return { ok: false, error: 'UNKNOWN_TOOL', name: parsed.name }
  if (!validateArgs(parsed.args, entry.schema)) {
    return { ok: false, error: 'SCHEMA_INVALID', name: parsed.name }
  }
  return { ok: true, name: parsed.name, result: entry.run(parsed.args) }
}

function dispatchMany(calls, registry) {
  return calls.map((c) => dispatchTool(c, registry))
}

const MCP_PROTOCOL_VERSION = '2025-06-18'

function handleMcpRequest(req, registry) {
  const reply = (result) => ({ jsonrpc: '2.0', id: req.id, result })
  const fail = (code, message) => ({ jsonrpc: '2.0', id: req.id, error: { code, message } })

  if (req.method === 'initialize') {
    return reply({
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'interview-forge-mock', version: '1.0.0' }
    })
  }
  if (req.method === 'tools/list') {
    const tools = Object.entries(registry).map(([name, entry]) => ({
      name,
      description: entry.description ?? '',
      inputSchema: entry.schema ?? { type: 'object' }
    }))
    return reply({ tools })
  }
  if (req.method === 'tools/call') {
    const params = req.params ?? {}
    const result = dispatchTool({ name: params.name, arguments: JSON.stringify(params.arguments ?? {}) }, registry)
    if (!result.ok) {
      return reply({ content: [{ type: 'text', text: result.error }], isError: true })
    }
    return reply({ content: [{ type: 'text', text: String(result.result) }], isError: false })
  }
  return fail(-32601, 'Method not found')
}`,
      test: L1S3,
      diag: [
        'initialize 没有返回 protocolVersion 或 capabilities.tools，或者 id 没回填。',
        'tools/list 把 registry 的 run 也序列化出去了，或者 inputSchema 丢了 required。',
        'tools/call 直接返回 result 而没有包成 content 数组 / 没设 isError。',
        '工具级失败被写成了 JSON-RPC error（应该放 result.isError）。',
        '未知方法返回了 result 而不是 error.code=-32601。'
      ]
    }
  ],
  skeleton: `// 三个函数都还没实现：先让它们抛错，跑测试时全红，再一步步补
function parseToolCall(raw) {
  throw new Error('parseToolCall 还没实现')
}
function dispatchTool(call, registry) {
  throw new Error('dispatchTool 还没实现')
}
function dispatchMany(calls, registry) {
  throw new Error('dispatchMany 还没实现')
}
function handleMcpRequest(req, registry) {
  throw new Error('handleMcpRequest 还没实现')
}`,
  solution: `function parseToolCall(raw) {
  if (!raw || typeof raw.name !== 'string' || !raw.name) {
    return { ok: false, error: 'INVALID_CALL' }
  }
  const text = raw.arguments
  if (text === undefined || text === null || text === '') {
    return { ok: true, name: raw.name, args: {} }
  }
  try {
    const args = JSON.parse(text)
    if (args === null || typeof args !== 'object' || Array.isArray(args)) {
      return { ok: false, error: 'INVALID_ARGUMENTS' }
    }
    return { ok: true, name: raw.name, args }
  } catch {
    return { ok: false, error: 'INVALID_ARGUMENTS' }
  }
}

function validateArgs(args, schema) {
  const required = schema?.required ?? []
  for (const key of required) {
    if (args[key] === undefined) return false
  }
  const props = schema?.properties ?? {}
  for (const [key, rule] of Object.entries(props)) {
    if (rule?.enum && args[key] !== undefined && !rule.enum.includes(args[key])) return false
  }
  return true
}

function dispatchTool(call, registry) {
  const parsed = parseToolCall(call)
  if (!parsed.ok) return parsed
  const entry = registry[parsed.name]
  if (!entry) return { ok: false, error: 'UNKNOWN_TOOL', name: parsed.name }
  if (!validateArgs(parsed.args, entry.schema)) {
    return { ok: false, error: 'SCHEMA_INVALID', name: parsed.name }
  }
  return { ok: true, name: parsed.name, result: entry.run(parsed.args) }
}

function dispatchMany(calls, registry) {
  return calls.map((c) => dispatchTool(c, registry))
}

const MCP_PROTOCOL_VERSION = '2025-06-18'

function handleMcpRequest(req, registry) {
  const reply = (result) => ({ jsonrpc: '2.0', id: req.id, result })
  const fail = (code, message) => ({ jsonrpc: '2.0', id: req.id, error: { code, message } })

  if (req.method === 'initialize') {
    return reply({
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'interview-forge-mock', version: '1.0.0' }
    })
  }
  if (req.method === 'tools/list') {
    const tools = Object.entries(registry).map(([name, entry]) => ({
      name,
      description: entry.description ?? '',
      inputSchema: entry.schema ?? { type: 'object' }
    }))
    return reply({ tools })
  }
  if (req.method === 'tools/call') {
    const params = req.params ?? {}
    const result = dispatchTool({ name: params.name, arguments: JSON.stringify(params.arguments ?? {}) }, registry)
    if (!result.ok) {
      return reply({ content: [{ type: 'text', text: result.error }], isError: true })
    }
    return reply({ content: [{ type: 'text', text: String(result.result) }], isError: false })
  }
  return fail(-32601, 'Method not found')
}`,
  finalCode: `function parseToolCall(raw) {
  if (!raw || typeof raw.name !== 'string' || !raw.name) {
    return { ok: false, error: 'INVALID_CALL' }
  }
  const text = raw.arguments
  if (text === undefined || text === null || text === '') {
    return { ok: true, name: raw.name, args: {} }
  }
  try {
    const args = JSON.parse(text)
    if (args === null || typeof args !== 'object' || Array.isArray(args)) {
      return { ok: false, error: 'INVALID_ARGUMENTS' }
    }
    return { ok: true, name: raw.name, args }
  } catch {
    return { ok: false, error: 'INVALID_ARGUMENTS' }
  }
}

function validateArgs(args, schema) {
  const required = schema?.required ?? []
  for (const key of required) {
    if (args[key] === undefined) return false
  }
  const props = schema?.properties ?? {}
  for (const [key, rule] of Object.entries(props)) {
    if (rule?.enum && args[key] !== undefined && !rule.enum.includes(args[key])) return false
  }
  return true
}

function dispatchTool(call, registry) {
  const parsed = parseToolCall(call)
  if (!parsed.ok) return parsed
  const entry = registry[parsed.name]
  if (!entry) return { ok: false, error: 'UNKNOWN_TOOL', name: parsed.name }
  if (!validateArgs(parsed.args, entry.schema)) {
    return { ok: false, error: 'SCHEMA_INVALID', name: parsed.name }
  }
  return { ok: true, name: parsed.name, result: entry.run(parsed.args) }
}

function dispatchMany(calls, registry) {
  return calls.map((c) => dispatchTool(c, registry))
}

const MCP_PROTOCOL_VERSION = '2025-06-18'

function handleMcpRequest(req, registry) {
  const reply = (result) => ({ jsonrpc: '2.0', id: req.id, result })
  const fail = (code, message) => ({ jsonrpc: '2.0', id: req.id, error: { code, message } })

  if (req.method === 'initialize') {
    return reply({
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'interview-forge-mock', version: '1.0.0' }
    })
  }
  if (req.method === 'tools/list') {
    const tools = Object.entries(registry).map(([name, entry]) => ({
      name,
      description: entry.description ?? '',
      inputSchema: entry.schema ?? { type: 'object' }
    }))
    return reply({ tools })
  }
  if (req.method === 'tools/call') {
    const params = req.params ?? {}
    const result = dispatchTool({ name: params.name, arguments: JSON.stringify(params.arguments ?? {}) }, registry)
    if (!result.ok) {
      return reply({ content: [{ type: 'text', text: result.error }], isError: true })
    }
    return reply({ content: [{ type: 'text', text: String(result.result) }], isError: false })
  }
  return fail(-32601, 'Method not found')
}`,
  tests: `${L1S1}\n${L1S2}\n${L1S3}`
}

/* ============================================================ 第 2 关 */
const LV2 = {
  id: 'lv2',
  title: '微调还是 RAG：把决策、账本、对齐算清楚',
  emoji: '🧮',
  xp: 50,
  goal: '实现三个决策工具：chooseApproach（按知识时效/私域规模/格式要求选 rag / finetune / hybrid / prompt）、loraParamCount + loraMemoryBytes（LoRA 与 QLoRA 的参数量与显存账）、dpoLoss + validatePreferencePairs（偏好数据校验与 DPO 损失）。',
  why: '「微调还是 RAG」在面试里最容易被答成站队，而工程上它是一道账：知识时效决定权重能不能追得上，格式要求决定检索能不能替代风格学习，序列长度与 rank 决定显存够不够。把这三笔账写成函数，比背结论可靠得多——也顺便把 DPO 的 closed-form 损失从公式变成可跑的数。',
  nodes: [
    'ai.train.finetune-vs-rag',
    'ai.train.finetune-vs-rag.alignment-preference',
    'ai.train.finetune-vs-rag.finetune-decision',
    'ai.train.finetune-vs-rag.lora-peft'
  ],
  thinking: [
    {
      title: '为什么「知识时效」是第一个判据',
      md: '权重的知识是训练时冻结的，更新一次要重训 + 评测 + 灰度，周期以周计；检索的知识在库里，更新一条索引是分钟级。所以只要知识在「几天」这个量级变化（价格、库存、政策），微调就不是可选项——它追不上。\n\n反过来，知识稳定（比如领域术语、输出格式）时，把风格与格式压进权重反而更稳，因为检索只能给「事实」，给不了「稳定的表达习惯」。'
    },
    {
      title: 'LoRA 的参数量为什么是线性而不是平方',
      md: '全量微调更新 ΔW（d×d），LoRA 把它分解成 ΔW = B·A，A 是 r×d、B 是 d×r，总参数 r·(d+d)=2rd——**与 d 线性**。rank 通常 4~64，所以可训练参数常常只有全量的 0.1%~1%。\n\nalpha 是缩放系数（ΔW 实际按 alpha/r 缩放），target modules 决定挂在哪些投影上（q/v 最常用，全挂 q/k/v/o + gate/up/down 效果更好但更贵）。'
    },
    {
      title: 'DPO 为什么能不用强化学习',
      md: 'RLHF 要先训奖励模型再 PPO，流程长且不稳。DPO 观察到：最优策略与奖励之间存在闭式关系，把它代回偏好目标后，奖励被消掉，剩下的就是「chosen 的 logprob 要比 rejected 高，且要相对参考模型有增量」——一个二分类式的损失。\n\nβ 控制偏离参考模型的惩罚强度：β 大 → 更保守（贴近参考模型），β 小 → 更激进。'
    }
  ],
  prereq: [
    {
      title: '微调 / RAG / Prompt 的四维决策',
      md: '用四个维度划界：\n\n- **知识时效**：几天一变 → RAG；季度级稳定 → 可微调；\n- **私域规模**：百万 token 以上 → 检索比塞权重便宜；\n- **格式遵循**：强格式（JSON schema、固定话术）→ 微调最稳；\n- **能力边界**：要新能力（新任务类型）→ 微调；只是要新知识 → RAG。\n\n三者还能组合：hybrid = 检索供事实 + 微调供格式。'
    },
    {
      title: 'LoRA / QLoRA 的显存三件套',
      md: 'QLoRA 省显存靠三件事：\n\n1. **4bit NF4 量化**基础权重（16bit → 4bit，约 1/4）；\n2. **双量化**（对量化常数再量化，再省一点）；\n3. **paged optimizer**（优化器状态分页到 CPU，避免峰值 OOM）。\n\n适配器本身仍是 bf16（2 字节/参数），所以显存 = 基础权重字节 + 适配器字节 + 激活值（跟 batch/序列长度相关）。'
    }
  ],
  api: [
    {
      name: 'chooseApproach',
      sig: 'chooseApproach(spec: { freshnessDays, privateCorpusTokens, needsFormat }) => { approach, reasons }',
      args: 'freshnessDays：知识多久变一次（天）；privateCorpusTokens：私域语料 token 量；needsFormat：是否强格式/风格要求。',
      returns: 'approach ∈ rag | finetune | hybrid | prompt；reasons 是决策依据数组。',
      example: 'chooseApproach({ freshnessDays: 3, privateCorpusTokens: 5e5, needsFormat: true })\n// → { approach: \'hybrid\', reasons: [...] }'
    },
    {
      name: 'loraParamCount / loraMemoryBytes',
      sig: 'loraParamCount(modules: [{dIn,dOut}], rank) => number；loraMemoryBytes(modules, rank, { baseParams, bits }) => number',
      args: 'modules 是挂 LoRA 的线性层维度列表；baseParams 是基础模型参数量；bits 是基础权重位宽（16 或 4）。',
      returns: '参数量 = Σ rank×(dIn+dOut)；显存字节 = baseParams×bits/8 + 参数量×2（适配器 bf16）。',
      example: 'loraParamCount([{ dIn: 4096, dOut: 4096 }], 8)   // → 65536'
    },
    {
      name: 'dpoLoss / validatePreferencePairs',
      sig: 'dpoLoss(policyChosen, policyRejected, refChosen, refRejected, beta) => number；validatePreferencePairs(pairs) => [{ index, reason }]',
      args: '四个 logprob 是序列级对数概率；beta 是 KL 约束强度；pairs 是 { prompt, chosen, rejected } 数组。',
      returns: 'dpoLoss 返回 -log σ(β(Δpolicy − Δref))，用数值稳定的 softplus 写法；validate 返回不合规样本列表（missing-field / identical）。',
      example: 'dpoLoss(0.5, 0.5, 0.5, 0.5, 0.1)   // → ln2 ≈ 0.6931'
    }
  ],
  usage: 'const plan = chooseApproach({ freshnessDays: 3, privateCorpusTokens: 8e5, needsFormat: true })\n// plan.approach === \'hybrid\'\n\nconst params = loraParamCount([{ dIn: 4096, dOut: 4096 }], 16)\nconst bytes = loraMemoryBytes([{ dIn: 4096, dOut: 4096 }], 16, { baseParams: 7e9, bits: 4 })\n\nconst bad = validatePreferencePairs(pairs)\nconst loss = dpoLoss(0.8, 0.2, 0.5, 0.5, 0.1)',
  hints: [
    'chooseApproach 按顺序判断：时效短 → rag/hybrid；知识稳 + 格式强 → finetune；私域大 → rag；兜底 prompt。',
    'LoRA 参数量是 rank*(dIn+dOut) 逐层累加；显存别忘适配器按 2 字节算。',
    'DPO 用 softplus 写法：z>0 时 log1p(exp(-z))，否则 -z + log1p(exp(z))，避免 exp 溢出。'
  ],
  concepts: [
    {
      title: '偏好数据比示范数据贵在哪',
      md: 'SFT 需要「标准答案」，偏好数据只需要「A 比 B 好」——标注成本低、且能表达「都对，但一个更符合偏好」。代价是数据形态更复杂（需要 pair、要防位置偏差），以及训练目标从拟合 token 变成相对排序。拒绝采样回流（采样 N 条挑最好）是低成本构造偏好数据的常用手段。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '先把选型判据写成函数',
      think: '选型讨论之所以经常变成站队，是因为判据散在脑子里。先把「时效 → 私域 → 格式」的顺序固定下来，边界值写进测试，讨论才有共同语言。',
      hint: '按 if/else 链：freshnessDays ≤ 7 先分 rag/hybrid；再 needsFormat && freshnessDays > 90 → finetune；再 privateCorpusTokens > 2e6 → rag；否则 prompt。',
      code: `function chooseApproach(spec) {
  const { freshnessDays, privateCorpusTokens, needsFormat } = spec

  if (freshnessDays <= 7) {
    return needsFormat
      ? { approach: 'hybrid', reasons: ['知识变化快，必须检索', '格式要求高，需要少量微调'] }
      : { approach: 'rag', reasons: ['知识变化快，权重来不及重训'] }
  }
  if (needsFormat && freshnessDays > 90) {
    return { approach: 'finetune', reasons: ['知识稳定', '格式与风格靠微调最稳'] }
  }
  if (privateCorpusTokens > 2000000) {
    return { approach: 'rag', reasons: ['私域语料大，检索比塞进权重划算'] }
  }
  return { approach: 'prompt', reasons: ['需求简单，先别动权重和检索'] }
}`,
      test: L2S1,
      diag: [
        '条件顺序反了：先判断私域规模，导致「时效 3 天」被误判为 rag 之外的结果。',
        'needsFormat 分支没有考虑 hybrid，时效短 + 格式强被直接判成 finetune。',
        'freshnessDays 的阈值写成 < 而不是 <=，边界 7 天落到了错误分支。',
        '缺少兜底分支，某些输入返回 undefined。',
        'reasons 没写或写成了空数组（测试要能看到决策依据）。'
      ]
    },
    {
      n: 2,
      title: '算 LoRA 的参数量与显存',
      think: '面试里经常被追问「LoRA 到底训多少参数」「7B 模型 QLoRA 要多少显存」。把公式写成函数，rank 从 8 改成 16 就是一个乘法，不再是背数字。',
      hint: 'loraParamCount：sum(rank*(dIn+dOut))。loraMemoryBytes：baseParams*bits/8 + 参数量*2。',
      code: `function chooseApproach(spec) {
  const { freshnessDays, privateCorpusTokens, needsFormat } = spec

  if (freshnessDays <= 7) {
    return needsFormat
      ? { approach: 'hybrid', reasons: ['知识变化快，必须检索', '格式要求高，需要少量微调'] }
      : { approach: 'rag', reasons: ['知识变化快，权重来不及重训'] }
  }
  if (needsFormat && freshnessDays > 90) {
    return { approach: 'finetune', reasons: ['知识稳定', '格式与风格靠微调最稳'] }
  }
  if (privateCorpusTokens > 2000000) {
    return { approach: 'rag', reasons: ['私域语料大，检索比塞进权重划算'] }
  }
  return { approach: 'prompt', reasons: ['需求简单，先别动权重和检索'] }
}

function loraParamCount(modules, rank) {
  return modules.reduce((sum, m) => sum + rank * (m.dIn + m.dOut), 0)
}

function loraMemoryBytes(modules, rank, opts = {}) {
  const { baseParams = 0, bits = 16 } = opts
  const baseBytes = (baseParams * bits) / 8
  const adapterBytes = loraParamCount(modules, rank) * 2
  return Math.ceil(baseBytes + adapterBytes)
}`,
      test: L2S2,
      diag: [
        'loraParamCount 把 dIn 和 dOut 相乘了（那是全量参数量，不是 LoRA）。',
        '显存计算只算了基础权重，漏了适配器（×2 字节）。',
        'bits=4 时没有除以 8，或者把 bit 当 byte 用了。',
        'rank 变化时结果不是线性（可能把 rank 平方了）。',
        '空 modules 返回 NaN 而不是 0。'
      ]
    },
    {
      n: 3,
      title: 'DPO 损失与偏好数据校验',
      think: '对齐数据最常见的两个脏点是「chosen 和 rejected 一样」和「字段缺失」。先写校验，再写损失——顺序反过来就会在脏数据上算出看似正常的 loss。',
      hint: 'dpoLoss 里先算 delta = (pc-pr) - (rc-rr)，z = beta*delta，再用 softplus：z>0 ? log1p(exp(-z)) : -z + log1p(exp(z))。',
      code: `function chooseApproach(spec) {
  const { freshnessDays, privateCorpusTokens, needsFormat } = spec

  if (freshnessDays <= 7) {
    return needsFormat
      ? { approach: 'hybrid', reasons: ['知识变化快，必须检索', '格式要求高，需要少量微调'] }
      : { approach: 'rag', reasons: ['知识变化快，权重来不及重训'] }
  }
  if (needsFormat && freshnessDays > 90) {
    return { approach: 'finetune', reasons: ['知识稳定', '格式与风格靠微调最稳'] }
  }
  if (privateCorpusTokens > 2000000) {
    return { approach: 'rag', reasons: ['私域语料大，检索比塞进权重划算'] }
  }
  return { approach: 'prompt', reasons: ['需求简单，先别动权重和检索'] }
}

function loraParamCount(modules, rank) {
  return modules.reduce((sum, m) => sum + rank * (m.dIn + m.dOut), 0)
}

function loraMemoryBytes(modules, rank, opts = {}) {
  const { baseParams = 0, bits = 16 } = opts
  const baseBytes = (baseParams * bits) / 8
  const adapterBytes = loraParamCount(modules, rank) * 2
  return Math.ceil(baseBytes + adapterBytes)
}

function validatePreferencePairs(pairs) {
  const bad = []
  pairs.forEach((p, index) => {
    if (!p || typeof p.prompt !== 'string' || typeof p.chosen !== 'string' || typeof p.rejected !== 'string') {
      bad.push({ index, reason: 'missing-field' })
    } else if (p.chosen === p.rejected) {
      bad.push({ index, reason: 'identical' })
    }
  })
  return bad
}

function dpoLoss(policyChosen, policyRejected, refChosen, refRejected, beta) {
  const delta = (policyChosen - policyRejected) - (refChosen - refRejected)
  const z = beta * delta
  return z > 0 ? Math.log1p(Math.exp(-z)) : -z + Math.log1p(Math.exp(z))
}`,
      test: L2S3,
      diag: [
        'dpoLoss 用了 -Math.log(sigmoid) 但没做数值稳定，大 z 时返回 Infinity。',
        'delta 算成了 (pc-pr) + (rc-rr)，参考模型的项应该是减号。',
        'z 里漏乘 beta，或 beta 用成了 1。',
        'validatePreferencePairs 没有按 index 报位置，或者把 identical 归成了 missing-field。',
        'validate 遇到 undefined 元素直接抛错。',
        'dpoLoss 的减法写反：chosen 更高时 loss 反而变大。'
      ]
    }
  ],
  skeleton: `function chooseApproach(spec) {
  throw new Error('chooseApproach 还没实现')
}
function loraParamCount(modules, rank) {
  throw new Error('loraParamCount 还没实现')
}
function loraMemoryBytes(modules, rank, opts) {
  throw new Error('loraMemoryBytes 还没实现')
}
function validatePreferencePairs(pairs) {
  throw new Error('validatePreferencePairs 还没实现')
}
function dpoLoss(policyChosen, policyRejected, refChosen, refRejected, beta) {
  throw new Error('dpoLoss 还没实现')
}`,
  solution: `function chooseApproach(spec) {
  const { freshnessDays, privateCorpusTokens, needsFormat } = spec

  if (freshnessDays <= 7) {
    return needsFormat
      ? { approach: 'hybrid', reasons: ['知识变化快，必须检索', '格式要求高，需要少量微调'] }
      : { approach: 'rag', reasons: ['知识变化快，权重来不及重训'] }
  }
  if (needsFormat && freshnessDays > 90) {
    return { approach: 'finetune', reasons: ['知识稳定', '格式与风格靠微调最稳'] }
  }
  if (privateCorpusTokens > 2000000) {
    return { approach: 'rag', reasons: ['私域语料大，检索比塞进权重划算'] }
  }
  return { approach: 'prompt', reasons: ['需求简单，先别动权重和检索'] }
}

function loraParamCount(modules, rank) {
  return modules.reduce((sum, m) => sum + rank * (m.dIn + m.dOut), 0)
}

function loraMemoryBytes(modules, rank, opts = {}) {
  const { baseParams = 0, bits = 16 } = opts
  const baseBytes = (baseParams * bits) / 8
  const adapterBytes = loraParamCount(modules, rank) * 2
  return Math.ceil(baseBytes + adapterBytes)
}

function validatePreferencePairs(pairs) {
  const bad = []
  pairs.forEach((p, index) => {
    if (!p || typeof p.prompt !== 'string' || typeof p.chosen !== 'string' || typeof p.rejected !== 'string') {
      bad.push({ index, reason: 'missing-field' })
    } else if (p.chosen === p.rejected) {
      bad.push({ index, reason: 'identical' })
    }
  })
  return bad
}

function dpoLoss(policyChosen, policyRejected, refChosen, refRejected, beta) {
  const delta = (policyChosen - policyRejected) - (refChosen - refRejected)
  const z = beta * delta
  return z > 0 ? Math.log1p(Math.exp(-z)) : -z + Math.log1p(Math.exp(z))
}`,
  finalCode: `function chooseApproach(spec) {
  const { freshnessDays, privateCorpusTokens, needsFormat } = spec

  if (freshnessDays <= 7) {
    return needsFormat
      ? { approach: 'hybrid', reasons: ['知识变化快，必须检索', '格式要求高，需要少量微调'] }
      : { approach: 'rag', reasons: ['知识变化快，权重来不及重训'] }
  }
  if (needsFormat && freshnessDays > 90) {
    return { approach: 'finetune', reasons: ['知识稳定', '格式与风格靠微调最稳'] }
  }
  if (privateCorpusTokens > 2000000) {
    return { approach: 'rag', reasons: ['私域语料大，检索比塞进权重划算'] }
  }
  return { approach: 'prompt', reasons: ['需求简单，先别动权重和检索'] }
}

function loraParamCount(modules, rank) {
  return modules.reduce((sum, m) => sum + rank * (m.dIn + m.dOut), 0)
}

function loraMemoryBytes(modules, rank, opts = {}) {
  const { baseParams = 0, bits = 16 } = opts
  const baseBytes = (baseParams * bits) / 8
  const adapterBytes = loraParamCount(modules, rank) * 2
  return Math.ceil(baseBytes + adapterBytes)
}

function validatePreferencePairs(pairs) {
  const bad = []
  pairs.forEach((p, index) => {
    if (!p || typeof p.prompt !== 'string' || typeof p.chosen !== 'string' || typeof p.rejected !== 'string') {
      bad.push({ index, reason: 'missing-field' })
    } else if (p.chosen === p.rejected) {
      bad.push({ index, reason: 'identical' })
    }
  })
  return bad
}

function dpoLoss(policyChosen, policyRejected, refChosen, refRejected, beta) {
  const delta = (policyChosen - policyRejected) - (refChosen - refRejected)
  const z = beta * delta
  return z > 0 ? Math.log1p(Math.exp(-z)) : -z + Math.log1p(Math.exp(z))
}`,
  tests: `${L2S1}\n${L2S2}\n${L2S3}`
}

export default {
  id: 'ai-tools',
  version: 3,
  domain: 'ai',
  cumulative: false,
  title: '工具调用与微调取舍',
  emoji: '🧰',
  tagline: '2 关：Function Calling / MCP 的协议落地，以及微调 vs RAG 的决策、LoRA 账本与 DPO 对齐。',
  stack: ['LLM 应用', '工具调用', '微调'],
  intro: 'Agent 的「手和脚」是工具调用，而模型能力边界之外的知识与风格，靠 RAG / 微调取舍。这两件事在面试里都容易被答成概念背诵：工具调用停留在「模型会返回 JSON」，微调停留在「数据越多越好」。这个项目把它们拆成可判题的协议与账本——arguments 为什么要二次解析、schema 校验为什么必须在副作用之前、MCP 的两层错误怎么分、LoRA 到底训多少参数、DPO 的损失为什么长这样。',
  outcome: '你能独立实现一个工具派发器与 MCP 消息层，讲清工具投毒的第一道防线；也能用「知识时效 / 私域规模 / 格式要求」给出微调-RAG-prompt 的选型，并把 LoRA 参数量、QLoRA 显存、DPO 损失算出来。',
  levels: [LV1, LV2]
}