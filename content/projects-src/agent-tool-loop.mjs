/**
 * 内容源：AI Agent · 最小可运行的 Agent 循环
 *
 * 这一季不聊概念，直接把 Agent 的三块地基写成代码：
 *   1) 模型输出的是文本，程序要消费它 → 解析工具调用
 *   2) 工具有名字、有参数、会失败 → 工具注册表
 *   3) 「想一步、做一步、看结果、再想」→ 循环 + 消息追加 + 轮数上限
 * 三关的测试都用「脚本化的假模型」，所以不需要联网、不需要 token，也能把循环跑通。
 *
 * v3 分步制：每步写完就能跑测试，绿了再往下。
 */

/* ------------------------------------------------------------ 第 1 关测试 */
const L1S1 = `{
  check('纯 JSON 能定位并解析出 tool 和 args', () => {
    const r = parseToolCall('{"tool":"get_weather","args":{"city":"上海"}}')
    same(r.tool, 'get_weather')
    same(r.args, { city: '上海' })
  })
  check('前后带解释文字也能解析', () => {
    const r = parseToolCall('好的，我来查一下：{"tool":"search","args":{"q":"vue"}} 稍等')
    same(r.tool, 'search')
    same(r.args, { q: 'vue' })
  })
  check('markdown 代码块包裹也能解析', () => {
    const r = parseToolCall('查询如下：\\n\\\`\\\`\\\`json\\n{"tool":"add","args":{"a":1}}\\n\\\`\\\`\\\`\\n')
    same(r.tool, 'add')
    same(r.args, { a: 1 })
  })
  check('纯文本（不是工具调用）返回 null', () => same(parseToolCall('今天天气不错'), null))
  check('非法 JSON 返回 null', () => same(parseToolCall('{"tool": '), null))
  check('空输入返回 null', () => same(parseToolCall(''), null))
}`

const L1S2 = `{
  check('缺少 tool 字段返回 null', () => same(parseToolCall('{"args":{"a":1}}'), null))
  check('tool 不是字符串返回 null', () => same(parseToolCall('{"tool":123}'), null))
  check('args 缺失时补成空对象', () => {
    const r = parseToolCall('{"tool":"ping"}')
    same(r.tool, 'ping')
    same(r.args, {})
  })
  check('JSON 是数组不是对象时返回 null', () => same(parseToolCall('[1,2,3]'), null))
}`

/* ------------------------------------------------------------ 第 2 关测试 */
const L2S1 = `{
  const tools = createRegistry()
  tools.register('add', ({ a, b }) => a + b)
  tools.register('fail', () => { throw new Error('数据库连不上') })

  check('list 返回所有注册的工具名', () => {
    same(tools.list().sort(), ['add', 'fail'])
  })
  check('has 能判断工具是否存在', () => {
    same(tools.has('add'), true)
    same(tools.has('nope'), false)
  })
  check('register 支持链式调用', () => {
    const t2 = createRegistry()
    ok(t2.register('a', () => 1).register('b', () => 2) === t2)
    same(t2.list().sort(), ['a', 'b'])
  })
}`

const L2S2 = `{
  const tools = createRegistry()
  tools.register('add', ({ a, b }) => a + b)

  check('未注册的工具返回 ok:false，而不是抛错', () => {
    const r = tools.invoke('nope', {})
    same(r.ok, false)
    ok(typeof r.error === 'string' && r.error.length > 0)
  })
}`

const L2S3 = `{
  const tools = createRegistry()
  tools.register('add', ({ a, b }) => a + b)
  tools.register('fail', () => { throw new Error('数据库连不上') })

  check('注册后能执行，参数原样传给 handler', () => {
    const r = tools.invoke('add', { a: 1, b: 2 })
    same(r.ok, true)
    same(r.result, 3)
  })
  check('工具自己抛错也被包成结果', () => {
    const r = tools.invoke('fail', {})
    same(r.ok, false)
    same(r.error, '数据库连不上')
  })
}`

/* ------------------------------------------------------------ 第 3 关测试 */
const L3S1 = `{
  function makeTools() {
    const fns = { add: ({ a, b }) => a + b }
    return {
      invoke(name, args) {
        const fn = fns[name]
        if (!fn) return { ok: false, error: '工具不存在：' + name }
        return { ok: true, result: fn(args ?? {}) }
      }
    }
  }

  check('一轮工具调用 + 一次最终回答', () => {
    const script = [
      { type: 'tool_call', tool: 'add', args: { a: 1, b: 2 } },
      { type: 'final', content: '结果是 3' }
    ]
    let i = 0
    const r = runAgent({ model: () => script[i++], tools: makeTools(), messages: [{ role: 'user', content: '1+2' }] })
    same(r.content, '结果是 3')
    same(r.turns, 2)
    same(r.stopReason, 'final')
  })
  check('模型一直要调工具时，会在 maxTurns 处停下', () => {
    const r = runAgent({
      model: () => ({ type: 'tool_call', tool: 'add', args: { a: 1, b: 1 } }),
      tools: makeTools(),
      messages: [],
      maxTurns: 3
    })
    same(r.stopReason, 'max_turns')
    same(r.turns, 3)
  })
  check('不会污染调用方传进来的 messages', () => {
    const original = [{ role: 'user', content: 'hi' }]
    const script = [{ type: 'final', content: 'done' }]
    let i = 0
    runAgent({ model: () => script[i++], tools: makeTools(), messages: original })
    same(original.length, 1)
  })
}`

const L3S2 = `{
  function makeTools() {
    const fns = {
      add: ({ a, b }) => a + b,
      boom: () => { throw new Error('工具挂了') }
    }
    return {
      invoke(name, args) {
        const fn = fns[name]
        if (!fn) return { ok: false, error: '工具不存在：' + name }
        try {
          return { ok: true, result: fn(args ?? {}) }
        } catch (e) {
          return { ok: false, error: e.message }
        }
      }
    }
  }

  check('工具结果会被喂回模型（第二轮能看到更长的上下文）', () => {
    let seenLen = 0
    let round = 0
    const model = (history) => {
      seenLen = Math.max(seenLen, history.length)
      return round++ === 0
        ? { type: 'tool_call', tool: 'add', args: { a: 2, b: 3 } }
        : { type: 'final', content: 'ok' }
    }
    runAgent({ model, tools: makeTools(), messages: [{ role: 'user', content: 'go' }] })
    ok(seenLen >= 3, '第二轮的 history 至少应包含 user + assistant(tool_call) + tool')
  })
  check('工具失败不会中断循环，错误会作为观察结果喂回去', () => {
    const script = [
      { type: 'tool_call', tool: 'boom', args: {} },
      { type: 'final', content: '工具失败了，我换个办法' }
    ]
    let i = 0
    const r = runAgent({ model: () => script[i++], tools: makeTools(), messages: [] })
    same(r.stopReason, 'final')
    same(r.content, '工具失败了，我换个办法')
    ok(r.history.some((m) => m.role === 'tool' && String(m.content).includes('工具挂了')), 'history 里应该有失败原因')
  })
  check('工具调用的 assistant 消息与 tool 结果都进了 history', () => {
    const script = [
      { type: 'tool_call', tool: 'add', args: { a: 1, b: 1 } },
      { type: 'final', content: 'done' }
    ]
    let i = 0
    const r = runAgent({ model: () => script[i++], tools: makeTools(), messages: [{ role: 'user', content: 'go' }] })
    ok(r.history.some((m) => m.role === 'assistant' && m.tool_call), '应记录 assistant 的工具调用')
    ok(r.history.some((m) => m.role === 'tool'), '应记录工具执行结果')
  })
}`

/** 第 1 关完整实现 */
const PARSE_FINAL = `/**
 * 第 1 关 · 把模型输出解析成工具调用
 */
function parseToolCall(text) {
  const raw = String(text ?? '')

  const fence = raw.match(/\`\`\`(?:json)?\\s*([\\s\\S]*?)\`\`\`/)
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  const candidate = fence ? fence[1] : start >= 0 && end > start ? raw.slice(start, end + 1) : ''
  if (!candidate) return null

  let obj
  try {
    obj = JSON.parse(candidate)
  } catch {
    return null
  }

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  if (typeof obj.tool !== 'string' || !obj.tool.trim()) return null
  const args = obj.args && typeof obj.args === 'object' && !Array.isArray(obj.args) ? obj.args : {}
  return { tool: obj.tool, args }
}
`

/** 第 2 关完整实现 */
const REGISTRY_FINAL = `/**
 * 第 2 关 · 工具注册表：能注册、能执行、不能崩
 */
function createRegistry() {
  const handlers = new Map()

  const registry = {
    register(name, handler) {
      if (!name || typeof handler !== 'function') throw new Error('register 需要 name 和函数')
      handlers.set(name, handler)
      return registry
    },

    invoke(name, args) {
      const handler = handlers.get(name)
      if (!handler) return { ok: false, error: '工具不存在：' + name }
      try {
        return { ok: true, result: handler(args ?? {}) }
      } catch (e) {
        return { ok: false, error: e?.message ?? String(e) }
      }
    },

    list() {
      return [...handlers.keys()]
    },

    has(name) {
      return handlers.has(name)
    }
  }

  return registry
}
`

/** 第 3 关完整实现 */
const LOOP_FINAL = `/**
 * 第 3 关 · runAgent：想一步 → 做一步 → 看结果
 */
function runAgent({ model, tools, messages = [], maxTurns = 5 }) {
  const history = [...messages]
  let turns = 0

  while (turns < maxTurns) {
    turns++
    const step = model(history)

    if (step.type === 'final') {
      history.push({ role: 'assistant', content: step.content })
      return { content: step.content, turns, stopReason: 'final', history }
    }

    history.push({ role: 'assistant', tool_call: { tool: step.tool, args: step.args } })
    const out = tools.invoke(step.tool, step.args)
    history.push({
      role: 'tool',
      tool: step.tool,
      content: out.ok ? '结果：' + JSON.stringify(out.result) : '失败：' + out.error
    })
  }

  return {
    content: '已达到最大轮数（' + maxTurns + '），任务没有完成',
    turns,
    stopReason: 'max_turns',
    history
  }
}
`

export default {
  id: 'agent-tool-loop',
  version: 3,
  domain: 'ai',
  // 三关各自独立（解析 / 注册表 / 循环），不累积
  cumulative: false,
  title: '最小可运行的 Agent 循环',
  emoji: '🤖',
  tagline: '3 关：解析工具调用 → 注册并执行工具 → 写出「想一步做一步」的循环。',
  stack: ['JavaScript', 'Agent'],
  intro: '很多 Agent 教程讲完概念就结束了，动手时却不知道从哪一行开始。这三关把 Agent 拆成三个能单独测试的零件：解析模型输出、执行工具、驱动循环。每关都有前置知识和分步提示，第 3 关你会得到一个能跑的 mini agent。',
  outcome: '做完你能讲清 tool calling 的完整链路：模型怎么表达「我要调工具」、程序怎么执行并把结果喂回去、为什么要限制最大轮数、工具报错为什么不能把整个循环打崩。这些正是 AI Agent 岗位面试最爱追问的地方。',
  levels: [
    /* ------------------------------------------------------------ 第 1 关 */
    {
      id: 'lv1',
      title: '把模型输出解析成工具调用',
      emoji: '📞',
      xp: 40,
      goal: '实现 parseToolCall(text)：从模型返回的一段文本里，稳定地取出 { tool, args }；不是工具调用就返回 null。',
      why: '模型只会输出文本。不管是 OpenAI 的 tool_calls 字段，还是让模型自己吐 JSON，程序这一侧都必须做同一件事：把「我要调 get_weather，参数是上海」变成可以执行的结构。解析写得糙，Agent 就会在第一步莫名其妙地崩——模型多打了一行解释、用代码块把 JSON 包起来、或者干脆返回了纯文本。',
      nodes: ['ai.tools.tool-calling.function-calling'],
      thinking: [
        {
          title: '先问「谁保证格式」，再写解析',
          md: `模型输出的是自然语言，格式没有任何保证。所以解析器不能假设「整段就是 JSON」，而要假设「JSON 可能埋在一段话里」。

这个假设决定了实现形态：先**定位** JSON 片段（代码块优先，其次首尾花括号），再 parse，再校验。三步的顺序就是把「不可信输入」逐层收窄的过程。`
        },
        {
          title: '为什么 JSON.parse 必须包 try/catch',
          md: `JSON.parse 遇到非法输入直接抛异常。而模型输出里，非法 JSON 是常态（截断、多一个逗号、前后带解释）。

如果让它抛出去，整条 Agent 链路会在第一步崩掉，而且堆栈指向的是 JSON.parse，看不出是模型输出的哪一段坏的。包成 return null 才是正确语义：**这不是错误，只是「这次不是工具调用」**。`
        },
        {
          title: '为什么校验的优先级是「对象 → tool → args」',
          md: `解析成功不等于结构正确：可能是数组、可能没有 tool、可能 args 是字符串。

我按「能不能用」排序校验：不是普通对象 → null；tool 不是非空字符串 → null（没有它没法路由）；args 不是对象 → 补 {}（很多工具不需要参数，缺省合法）。校验顺序错了，就会把「缺参数」误判成「不是工具调用」。`
        }
      ],
      prereq: [
        {
          title: '为什么要约定一种「工具调用」的文本形态',
          md: `程序不能靠猜。所以要跟模型约定：想调工具时，输出一个固定结构的 JSON。

\`\`\`json
{"tool": "get_weather", "args": {"city": "上海"}}
\`\`\`

但真实模型经常加料：前后带一句解释、用 markdown 代码块包起来、或者 JSON 里多一个字段。解析器要做的是「在文本里找到这段 JSON，而不是假设整段就是 JSON」。`
        },
        {
          title: 'JSON.parse 会抛错，必须包起来',
          md: `JSON.parse 遇到非法输入会直接抛异常，而不是返回 null。所以解析器里必须 try / catch：

\`\`\`js
try {
  const obj = JSON.parse(candidate)
} catch {
  return null      // 不是工具调用
}
\`\`\`

这也是「模型输出不可信」的第一课：任何来自模型的内容，都要按不可信输入处理。`
        }
      ],
      api: [
        {
          name: 'parseToolCall',
          sig: 'parseToolCall(text: string): { tool: string, args: object } | null',
          args: 'text —— 模型返回的原始文本。可能是一段纯 JSON，也可能夹杂解释文字或 ```json 代码块。',
          returns: '解析成功返回 { tool, args }（args 缺失时补成 {}）；不是工具调用、JSON 非法、缺少 tool 字段时返回 null。',
          example: `parseToolCall('{"tool":"get_weather","args":{"city":"上海"}}')
// { tool: 'get_weather', args: { city: '上海' } }

parseToolCall('今天天气不错')   // null`
        }
      ],
      stages: [
        {
          n: 1,
          title: '定位 JSON 片段并解析',
          think: '先只做「从一段文本里把 JSON 抠出来并 parse」。这一步不校验结构，因为校验是契约问题、解析是定位问题，混在一起出红时分不清是没找到还是没校验。',
          hint: '优先用正则 /```(?:json)?\\s*([\\s\\S]*?)```/ 取代码块内容；没有代码块就取第一个 "{" 到最后一个 "}" 之间。候选为空或 parse 抛错都 return null。',
          diag: [
            '纯 JSON 解析不出：先取 text.indexOf("{") 到 lastIndexOf("}") 之间的片段，再 parse。',
            '带解释文字的文件解析失败：不能整段 parse，要先定位花括号区间。',
            '代码块包裹的解析不出：正则要匹配 ```json 和 ``` 两种。',
            '纯文本却返回了对象：找不到花括号时直接 return null。',
            '非法 JSON 让函数抛错了：JSON.parse 要包 try/catch，catch 里 return null。',
            '空输入报错：String(text ?? "") 兜底，候选为空 return null。'
          ],
          vocab: [
            { term: '贪婪 vs 惰性匹配', md: '[\\s\\S]*? 是惰性匹配，停在第一个 ``` 处；用 * 会一路吞到结尾，跨过代码块边界。' }
          ],
          code: `/**
 * 第 1 关 · 第 1 步：定位 JSON 片段并解析
 */
function parseToolCall(text) {
  const raw = String(text ?? '')

  const fence = raw.match(/\`\`\`(?:json)?\\s*([\\s\\S]*?)\`\`\`/)
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  const candidate = fence ? fence[1] : start >= 0 && end > start ? raw.slice(start, end + 1) : ''
  if (!candidate) return null

  try {
    return JSON.parse(candidate)
  } catch {
    return null
  }
}
`,
          test: L1S1
        },
        {
          n: 2,
          title: '校验结构，统一成 { tool, args }',
          think: '解析出来的可能是数组、可能没有 tool、可能 args 是字符串。现在把契约补上：普通对象 + tool 非空字符串 + args 不是对象就补 {}。这一步的每条测试都对应一个真实会出现的畸形输出。',
          hint: 'obj 不是普通对象（null / 数组）→ null；typeof obj.tool !== "string" 或空串 → null；args 不是对象（或数组）→ {}；返回 { tool, args }。',
          diag: [
            '缺少 tool 却返回了对象：tool 必须是非空字符串，否则 return null。',
            'tool 是数字也放过了：用 typeof obj.tool === "string" 判断。',
            'args 缺失没补默认值：args 不是对象时补 {}，工具可能不需要参数。',
            'JSON 是数组时没拦住：先判断 typeof obj === "object" && !Array.isArray(obj)。'
          ],
          code: PARSE_FINAL,
          test: L1S2
        }
      ],
      finalCode: PARSE_FINAL,
      usage: `const step = parseToolCall(modelOutput)
if (!step) {
  // 不是工具调用：当作普通文本回答
} else {
  // { tool: 'get_weather', args: { city: '上海' } }
  tools.invoke(step.tool, step.args)
}`,
      hints: [
        '正则里的 ``` 在 JS 字符串里要写成 \\`\\`\\`（反引号要转义）。',
        '用 text.indexOf("{") 找不到会返回 -1，slice 出来是空串，JSON.parse 会抛错并被 catch 接住 —— 结果仍然是 null，可以接受。',
        '别用 eval 或 new Function 解析：模型输出是不可信输入，eval 等于把执行权交出去。'
      ],
      concepts: [
        {
          title: '真实 API 里的 tool_calls 长什么样',
          md: 'OpenAI 兼容接口的返回里，模型不会把工具调用塞进 content，而是放在 `message.tool_calls`：每个 call 有 id、function.name、function.arguments（注意 arguments 是 JSON **字符串**，还要再 parse 一次）。这一关练的是「从文本里解析」，因为那可是所有本地小模型、以及把工具调用塞进 content 的模型的通用形态。两种形态的解析思路完全一样：定位 → parse → 校验。'
        }
      ],
      skeleton: `/**
 * 第 1 关 · 把模型输出解析成工具调用
 *
 * 模型只会输出文本。约定：想调工具时，输出 {"tool": "...", "args": {...}}。
 * 但真实输出常带解释文字或 \`\`\`json 代码块，所以要「从文本里找 JSON」，而不是整段 parse。
 */

/**
 * @param text 模型返回的原始文本
 * @returns { tool, args }；不是工具调用就返回 null
 */
function parseToolCall(text) {
  const raw = String(text ?? '')

  // TODO 1：先定位 JSON 片段 —— 优先取 \`\`\`json 代码块里的内容，否则取第一个 { 到最后一个 } 之间
  // TODO 2：JSON.parse 它；抛错就 return null
  // TODO 3：校验 tool 是非空字符串（args 不是对象就补 {}），返回 { tool, args }；不合法 return null
  return null
}
`,
      solution: PARSE_FINAL,
      tests: [L1S1, L1S2].join('\n\n')
    },
    /* ------------------------------------------------------------ 第 2 关 */
    {
      id: 'lv2',
      title: '工具注册表：能注册、能执行、不能崩',
      emoji: '🧰',
      xp: 45,
      goal: '实现 createRegistry()：register(name, handler) 注册工具，invoke(name, args) 执行它，并把「找不到工具 / 工具抛错」都变成返回值而不是异常。',
      why: 'Agent 会调用几十个工具，其中任何一个都可能抛错、超时、参数不对。如果工具一抛错就冒泡，整个对话直接中断——用户看到的是「Agent 挂了」，而不是「查天气失败，你可以重试」。所以工具执行层的第一职责不是执行，而是**隔离失败**。',
      nodes: ['ai.tools.tool-calling.tool-design-routing'],
      thinking: [
        {
          title: '为什么注册表要「返回自身」',
          md: `register 返回 registry 是为了链式注册：\`createRegistry().register('a', f).register('b', g)\`。

这不是为了好看——初始化一段长工具清单时，链式让「注册」和「创建」在同一个表达式里，中间不会出现一个半成品对象被别处拿去用。这是 builder 模式的常见取舍。`
        },
        {
          title: '为什么「工具不存在」要返回结果而不是抛错',
          md: `找不到工具是**模型的问题**（它编了个名字），不是程序的 bug。抛错会让循环崩溃，而模型永远学不到「这个工具不存在」。

返回 { ok:false, error } 把这件事变成一条模型能读的观察：下一轮它看到「工具不存在：nope」，就会换成正确的名字。**错误是数据，不是中断**——这是工具层最重要的设计。`
        },
        {
          title: '为什么 handler 的异常也必须吃掉',
          md: `工具实现是业务代码：数据库连不上、参数类型不对、第三方超时。这些异常如果冒出去，Agent 循环就断了，用户只看到「出错了」。

工具层的职责就是把它包成 \`{ ok:false, error: e.message }\`：让模型知道失败原因，让循环继续。真实框架还会在這一层加超时、schema 校验、结果截断，但前提都是「异常不出这一层」。`
        }
      ],
      prereq: [
        {
          title: '注册表就是「名字 → 函数」的 Map',
          md: `\`\`\`js
const tools = new Map()
tools.set('get_weather', (args) => { ... })
\`\`\`

register 往里写，invoke 按名字取出来调用。看起来简单，但有两个必须处理的情况：

1. 名字不存在 → 不能抛错崩掉循环，要返回「工具不存在」这个事实。
2. handler 自己抛错 → 同样要变成结果，因为模型需要「看到」失败原因才能调整策略。`
        },
        {
          title: '为什么错误要包成 { ok: false }',
          md: `Agent 循环是一段 while：执行工具 → 把结果喂回模型。如果工具抛异常，这个 while 就断了。

把错误变成**数据**，循环才能继续：模型收到 \`{"ok":false,"error":"城市不存在"}\` 之后，可以换个参数再试一次。这也是绝大多数 agent 框架的实际设计：工具结果永远是「一条消息」，不是一次异常。`
        }
      ],
      api: [
        {
          name: 'createRegistry',
          sig: 'createRegistry(): { register, invoke, list, has }',
          args: '无参数。',
          returns: 'register(name, handler) 注册（返回自身，可链式）；invoke(name, args) 返回 { ok: true, result } 或 { ok: false, error }；list() 返回所有工具名数组；has(name) 判断是否存在。',
          example: `const tools = createRegistry()
tools.register('add', ({ a, b }) => a + b)

tools.invoke('add', { a: 1, b: 2 })   // { ok: true, result: 3 }
tools.invoke('nope', {})              // { ok: false, error: '工具不存在：nope' }
tools.list()                          // ['add']`
        }
      ],
      stages: [
        {
          n: 1,
          title: 'register / list / has：先把「有哪些工具」管起来',
          think: '先做注册和查询，不做执行。这一步验收的是「注册进去了没有、能不能列出来、链式返回对不对」——都是纯数据结构行为，和失败隔离无关。',
          hint: 'createRegistry 里建 const handlers = new Map()；register 校验 name 和 handler 后 handlers.set(name, handler)，return registry；list 返回 [...handlers.keys()]；has 返回 handlers.has(name)。',
          diag: [
            'list 拿不到工具：register 要真的 handlers.set(name, handler)。',
            'has 永远 false：用 handlers.has(name) 判断。',
            '链式注册报错：register 必须 return registry（不是 return this）。',
          ],
          vocab: [
            { term: 'Map 的 keys 迭代', md: '[...handlers.keys()] 把 Map 的键展开成数组，顺序是插入顺序。' }
          ],
          code: `/**
 * 第 2 关 · 第 1 步：注册与查询
 */
function createRegistry() {
  const handlers = new Map()

  const registry = {
    register(name, handler) {
      if (!name || typeof handler !== 'function') throw new Error('register 需要 name 和函数')
      handlers.set(name, handler)
      return registry
    },

    list() {
      return [...handlers.keys()]
    },

    has(name) {
      return handlers.has(name)
    }
  }

  return registry
}
`,
          test: L2S1
        },
        {
          n: 2,
          title: 'invoke：找不到工具也要返回结果',
          think: '现在加 invoke，但先只处理「找不到」。它不抛错而是返回 { ok:false }，这是「错误是数据」的第一步。',
          hint: 'invoke 里：const handler = handlers.get(name)；if (!handler) return { ok: false, error: \'工具不存在：\' + name }。',
          diag: [
            '未注册的工具抛错了：返回 { ok:false, error }，不要 throw。',
          ],
          code: `/**
 * 第 2 关 · 第 2 步：invoke 的「找不到」分支
 */
function createRegistry() {
  const handlers = new Map()

  const registry = {
    register(name, handler) {
      if (!name || typeof handler !== 'function') throw new Error('register 需要 name 和函数')
      handlers.set(name, handler)
      return registry
    },

    invoke(name, args) {
      const handler = handlers.get(name)
      if (!handler) return { ok: false, error: '工具不存在：' + name }
      return { ok: true, result: handler(args ?? {}) }
    },

    list() {
      return [...handlers.keys()]
    },

    has(name) {
      return handlers.has(name)
    }
  }

  return registry
}
`,
          test: L2S2
        },
        {
          n: 3,
          title: 'try / catch：工具自己炸了也不许冒泡',
          think: '最后把执行包进 try/catch。这一步是这一关的核心：任何 handler 的异常都要变成 { ok:false, error }。测试里专门注册一个必定抛错的工具，只要它绿，隔离就成立了。',
          hint: 'try { return { ok: true, result: handler(args ?? {}) } } catch (e) { return { ok: false, error: e?.message ?? String(e) } }。',
          diag: [
            '工具抛错直接冒泡：执行 handler 要包 try/catch。',
            '成功结果结构不对：{ ok: true, result } 三个字段。',
          ],
          code: REGISTRY_FINAL,
          test: L2S3
        }
      ],
      finalCode: REGISTRY_FINAL,
      usage: `const tools = createRegistry()
tools.register('get_weather', ({ city }) => ({ city, temp: 26 }))
tools.register('db_query', () => { throw new Error('连接超时') })

tools.invoke('get_weather', { city: '上海' })   // { ok: true, result: { city: '上海', temp: 26 } }
tools.invoke('db_query', {})                    // { ok: false, error: '连接超时' }
tools.invoke('nope', {})                        // { ok: false, error: '工具不存在：nope' }`,
      hints: [
        'list() 用 [...handlers.keys()] 即可。',
        'invoke 里参数叫 args，传给 handler 时保持同一个对象就行，不要自作主张深拷贝。',
        '测试里有一条会注册一个「必定抛错」的工具：只要你的 catch 把它包成 ok:false，这条就绿了。'
      ],
      concepts: [
        {
          title: '这就是「工具沙箱」的最小形态',
          md: '真实框架在工具执行外面还会加：超时、权限校验、参数 schema 校验（JSON Schema）、结果截断。但这些都建立在这一关的同一个前提上——**执行结果永远是一个可序列化的对象**，而不是一个可能中断流程的异常。'
        }
      ],
      skeleton: `/**
 * 第 2 关 · 工具注册表：能注册、能执行、不能崩
 *
 * 工具执行层的第一职责不是执行，而是隔离失败：
 * 找不到工具、工具自己抛错，都必须变成「结果」，不能把 agent 循环打崩。
 */

function createRegistry() {
  const handlers = new Map()

  const registry = {
    /** 注册一个工具；返回 registry 以便链式注册 */
    register(name, handler) {
      // TODO 1：校验 name 与 handler，存进 handlers，返回 registry
    },

    /** 执行工具：永远返回 { ok, result | error }，不抛错 */
    invoke(name, args) {
      // TODO 2：先查 handler；查不到返回 { ok: false, error: '工具不存在：xxx' }
      // TODO 3：用 try / catch 执行它，成功返回 { ok: true, result }，失败返回 { ok: false, error }
      return { ok: false, error: 'TODO：还没有实现' }
    },

    /** 所有已注册的工具名 */
    list() {
      return [...handlers.keys()]
    },

    /** 是否注册过某个工具 */
    has(name) {
      return handlers.has(name)
    }
  }

  return registry
}
`,
      solution: REGISTRY_FINAL,
      tests: [L2S1, L2S2, L2S3].join('\n\n')
    },
    /* ------------------------------------------------------------ 第 3 关 */
    {
      id: 'lv3',
      title: '写出循环：想一步 → 做一步 → 看结果',
      emoji: '🔁',
      xp: 60,
      goal: '实现 runAgent：反复调用模型，遇到工具调用就执行并把结果喂回去，直到模型给出最终回答或用完轮数。',
      why: '前两关是零件，这一关是发动机。Agent 和「一次问答」的区别只有一件事：**它可以把执行结果带回上下文，再想一轮**。这段 while 循环只有二十行，但面试里问的「Agent 怎么决定下一步」「为什么会死循环」「工具失败怎么办」全在这二十行里。',
      nodes: ['ai.harness.agent-loop.loop-dynamics', 'ai.tools.tool-calling.function-calling', 'ai.memory.memory-skill.session-state'],
      thinking: [
        {
          title: '为什么循环条件要写成 turns < maxTurns，而不是 while (true)',
          md: `模型可能永远给出「我还要调工具」——工具一直失败、目标理解错、参数永远不合法。没有上限的话，循环就是烧 token 的永动机。

所以从第一版就写 \`while (turns < maxTurns)\`，跑满返回明确的 stopReason: 'max_turns'。**可观测的失败，比不可终止的循环好一万倍**：上层能提示用户、能换模型、能记指标。`
        },
        {
          title: '为什么每一轮都要把「工具调用」和「工具结果」都写进 history',
          md: `模型是无状态的，它只看传进去的 messages。如果只追加工具结果、不追加「我调了什么」，模型下一轮会看到一个孤零零的 tool 消息，不知道是谁的结果、参数是什么。

所以一轮工具调用要落两条消息：assistant 的 tool_call（我调了谁、传了什么）+ tool 的结果。**消息数组就是 Agent 的短期记忆**，少一条，模型就少一段上下文。`
        },
        {
          title: '为什么失败也要喂回去',
          md: `工具失败时最糟的处理是 return 或 throw——那等于把一次可恢复的失败变成整个对话的终止。

正确做法是把「失败：连接超时」当成一条观察喂回去，让模型自己决定换参数、换工具还是向用户说明。这也是 Agent 和传统程序的根本差别：**错误处理的一部分交给了模型**，前提是你把错误交得出去。`
        }
      ],
      prereq: [
        {
          title: '循环的本质是「消息数组不断变长」',
          md: `模型是无状态的：它每次只看到你传进去的 messages。所以 Agent 的每一轮都要做两件事：

1. 把这一轮的输出（工具调用）追加成一条 assistant 消息
2. 把工具执行结果追加成一条 tool 消息

下一轮模型看到更长的上下文，才知道「我上一轮调了什么、拿到了什么」。消息数组就是 Agent 的短期记忆。`
        },
        {
          title: '为什么必须有 maxTurns',
          md: `如果模型的工具调用结果永远不能让任务完成（工具挂了、目标理解错了、参数一直不合法），循环就永远不会进入 final。没有上限的话：烧 token、烧钱、把界面卡死。

所以循环条件写成 while (turns < maxTurns)，跑满之后返回一个明确的 stopReason: 'max_turns'，让上层决定是提示用户、换模型还是放弃。**可观测的失败，比不可终止的循环好一万倍。**`
        }
      ],
      api: [
        {
          name: 'runAgent',
          sig: 'runAgent({ model, tools, messages, maxTurns }): { content, turns, stopReason, history }',
          args: 'model —— 函数，接收 messages 数组，返回 { type: "tool_call", tool, args } 或 { type: "final", content }。tools —— 第 2 关的注册表。messages —— 起始消息数组。maxTurns —— 最多循环几轮，默认 5。',
          returns: '{ content: 最终回答, turns: 实际用了几轮, stopReason: "final" | "max_turns", history: 完整消息数组 }。',
          example: `const tools = createRegistry()
tools.register('add', ({ a, b }) => a + b)

let step = 0
const model = () => (step++ === 0
  ? { type: 'tool_call', tool: 'add', args: { a: 1, b: 2 } }
  : { type: 'final', content: '结果是 3' })

const r = runAgent({ model, tools, messages: [{ role: 'user', content: '1 + 2 等于几' }] })
// r.content === '结果是 3'，r.turns === 2`
        }
      ],
      stages: [
        {
          n: 1,
          title: '循环骨架：问模型、遇 final 就收工',
          think: '先搭骨架：拷一份 history（别污染调用方数组）、while 里 turns++、调 model(history)、遇到 final 就追加 assistant 消息并返回。工具调用分支先只「继续下一轮」——先把终止条件和返回结构跑通。',
          hint: 'const history = [...messages]；let turns = 0；while (turns < maxTurns) { turns++；const step = model(history)；if (step.type === "final") { history.push({role:"assistant",content:step.content})；return {...} } }；循环外返回 max_turns 结果。',
          diag: [
            'turns 永远不变：while 条件里用 turns < maxTurns，进入循环第一件事 turns++。',
            '最终回答没进 history：final 分支要 push assistant 消息再 return。',
            '返回结构缺字段：content / turns / stopReason / history 四个都要有。',
          ],
          vocab: [
            { term: 'stopReason', md: '循环为什么结束。final = 模型给出回答；max_turns = 轮数用尽。上层靠它决定下一步动作。' }
          ],
          code: `/**
 * 第 3 关 · 第 1 步：循环骨架
 */
function runAgent({ model, tools, messages = [], maxTurns = 5 }) {
  const history = [...messages]
  let turns = 0

  while (turns < maxTurns) {
    turns++
    const step = model(history)

    if (step.type === 'final') {
      history.push({ role: 'assistant', content: step.content })
      return { content: step.content, turns, stopReason: 'final', history }
    }
  }

  return {
    content: '已达到最大轮数（' + maxTurns + '），任务没有完成',
    turns,
    stopReason: 'max_turns',
    history
  }
}
`,
          test: L3S1
        },
        {
          n: 2,
          title: '工具调用分支：执行并喂回去',
          think: '现在补最重要的分支：模型要调工具时，先记录 assistant 的 tool_call 消息，再执行，把成功或失败的结果都追加成 tool 消息。无论成败都要追加——模型下一轮要靠它调整策略。',
          hint: 'else 分支：history.push({ role: "assistant", tool_call: { tool: step.tool, args: step.args } })；const out = tools.invoke(step.tool, step.args)；history.push({ role: "tool", tool: step.tool, content: out.ok ? "结果：" + JSON.stringify(out.result) : "失败：" + out.error })。',
          diag: [
            '第二轮看不到上下文：工具调用要追加两条消息（assistant 的 tool_call + tool 结果）。',
            '工具失败就中断：失败也要追加成 tool 消息继续循环，不能 return/throw。',
            'assistant 消息缺 tool_call 字段：模型需要知道「我调了谁、传了什么」。',
          ],
          code: LOOP_FINAL,
          test: L3S2
        }
      ],
      finalCode: LOOP_FINAL,
      usage: `const tools = createRegistry()
tools.register('add', ({ a, b }) => a + b)

let round = 0
const model = () => (round++ === 0
  ? { type: 'tool_call', tool: 'add', args: { a: 2, b: 3 } }
  : { type: 'final', content: '5' })

const r = runAgent({ model, tools, messages: [{ role: 'user', content: '2+3' }] })
// r.content === '5'，r.turns === 2，r.stopReason === 'final'
// r.history: user → assistant(tool_call) → tool → assistant(final)`,
      hints: [
        '循环变量 turns 在 while 条件里判断，进入循环后第一件事就是 turns++，否则 maxTurns 永远拦不住。',
        'history 用 [...messages] 拷一份再追加：直接 push 原始数组会污染调用方传进来的数据，测试里有一条会查这个。',
        '工具失败时不要 return 或 throw——继续循环，让模型看到「失败：xxx」，它才有机会换参数重试。'
      ],
      concepts: [
        {
          title: '这二十行就是 LangChain / AutoGPT 的内核',
          md: '框架帮你做了很多事（消息格式、并发、持久化、可观测），但循环骨架就是这一关写的东西：问模型 → 判断是不是要调工具 → 调 → 追加观察 → 再问。理解了它，再看任何 agent 框架的源码都不会迷路。'
        }
      ],
      skeleton: `/**
 * 第 3 关 · 写出循环：想一步 → 做一步 → 看结果
 *
 * model 是一个函数：每次调用返回一步决策。
 *   { type: 'tool_call', tool, args }  → 要执行工具
 *   { type: 'final', content }         → 想完了，给出回答
 * 你的任务：把「执行工具 → 把结果追加进消息 → 再问模型」这个循环写出来。
 */

function runAgent({ model, tools, messages = [], maxTurns = 5 }) {
  const history = [...messages]
  let turns = 0

  while (turns < maxTurns) {
    turns++

    // TODO 1：问模型要这一步的决策（注意传 history，它下一轮会变长）
    // TODO 2：type === 'final' → 把回答作为 assistant 消息追加进 history，return { content, turns, stopReason: 'final', history }
    // TODO 3：否则当作 tool_call：追加 assistant 的工具调用消息 → 用 tools.invoke 执行
    //         → 把结果（或失败原因）追加成 tool 消息 → 继续下一轮
    break
  }

  return {
    content: \`已达到最大轮数（\${maxTurns}），任务没有完成\`,
    turns,
    stopReason: 'max_turns',
    history
  }
}
`,
      solution: LOOP_FINAL,
      tests: [L3S1, L3S2].join('\n\n')
    }
  ]
}