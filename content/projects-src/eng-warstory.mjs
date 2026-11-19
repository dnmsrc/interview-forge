/**
 * eng-warstory —— 事故复盘四关：AI 上下文溢出、JVM 三连、慢查询与缓存、前端三连。
 * 分配见 data/plans/eng-warstory.json。
 */

/* ============================================================ 第 1 关测试 */
const L1S1 = `{
  check('固定开销先从窗口里扣掉', () => {
    const b = tokenBudget({ window: 128000, systemTokens: 2000, toolSchemaTokens: 8000, outputReserve: 4000 })
    same(b.historyBudget, 114000)
    same(b.overBudget, false)
  })
  check('窗口比固定开销还小 → overBudget', () => {
    const b = tokenBudget({ window: 8000, systemTokens: 2000, toolSchemaTokens: 8000, outputReserve: 4000 })
    same(b.overBudget, true)
    same(b.historyBudget <= 0, true)
  })
  check('输出预留是硬约束：没给就优先扣', () => {
    const b = tokenBudget({ window: 16000, systemTokens: 1000, toolSchemaTokens: 4000, outputReserve: 0 })
    same(b.historyBudget, 11000)
  })
  check('只给窗口时全部留给历史', () => {
    same(tokenBudget({ window: 32000 }).historyBudget, 32000)
  })
}`

const L1S2 = `{
  var MSGS = [
    { role: 'system', tokens: 2000 },
    { role: 'user', tokens: 3000 },
    { role: 'assistant', tokens: 3000 },
    { role: 'user', tokens: 3000 },
    { role: 'assistant', tokens: 3000 }
  ]

  check('预算够 → 全部保留', () => {
    const r = planContext({ budget: 20000, messages: MSGS })
    same(r.kept.length, 5)
    same(r.dropped, 0)
    same(r.summaryNeeded, false)
  })
  check('超预算 → 从最旧的对话开始丢', () => {
    const r = planContext({ budget: 9000, messages: MSGS })
    same(r.kept.length, 3, 'system + 最近两条')
    same(r.dropped, 2)
    same(r.summaryNeeded, true)
  })
  check('system 消息永远保留', () => {
    const r = planContext({ budget: 1500, messages: MSGS })
    same(r.kept[0].role, 'system')
  })
  check('keepRecent 保证最近 K 条一定在', () => {
    const r = planContext({ budget: 5000, messages: MSGS, keepRecent: 2 })
    same(r.kept.slice(-2).length, 2)
    same(r.kept.slice(-2).map((m) => m.tokens), [3000, 3000])
  })
  check('空消息列表', () => {
    same(planContext({ budget: 100, messages: [] }).kept, [])
    same(planContext({ budget: 100, messages: [] }).dropped, 0)
  })
}`

const L1S3 = `{
  check('工具定义吃掉一半以上 → 精简 schema', () => {
    const r = diagnoseOverflow({ window: 128000, tools: 70000, retrieved: 5000, history: 20000, output: 4000 })
    same(r.cause, 'tool-schema')
  })
  check('检索上下文过大 → 减少召回条数', () => {
    const r = diagnoseOverflow({ window: 128000, tools: 4000, retrieved: 60000, history: 20000, output: 4000 })
    same(r.cause, 'retrieval')
  })
  check('没给输出留余量 → 回答被截断', () => {
    const r = diagnoseOverflow({ window: 128000, tools: 4000, retrieved: 10000, history: 100000, output: 500 })
    same(r.cause, 'output-reserve')
  })
  check('多轮历史累积 → 摘要或滚动窗口', () => {
    const r = diagnoseOverflow({ window: 128000, tools: 4000, retrieved: 10000, history: 90000, output: 20000 })
    same(r.cause, 'history-growth')
  })
  check('份额都正常 → ok 并给出实际占用率', () => {
    const r = diagnoseOverflow({ window: 100000, tools: 5000, retrieved: 5000, history: 20000, output: 20000 })
    same(r.cause, 'ok')
    same(r.usage, 0.5)
  })
}`

/* ============================================================ 第 1 关代码 */
const L1C1 = `function tokenBudget(opts) {
  const fixed = (opts.systemTokens || 0) + (opts.toolSchemaTokens || 0) + (opts.outputReserve || 0)
  const historyBudget = opts.window - fixed
  return { historyBudget, overBudget: historyBudget <= 0 }
}`

const L1C2 = `${L1C1}

function planContext(opts) {
  const budget = opts.budget
  const messages = opts.messages || []
  const keepRecent = opts.keepRecent || 0

  const sys = messages.filter((m) => m.role === 'system')
  const rest = messages.filter((m) => m.role !== 'system')
  const sysTokens = sys.reduce((s, m) => s + m.tokens, 0)

  let left = budget - sysTokens
  const kept = []
  for (let i = rest.length - 1; i >= 0; i--) {
    const msg = rest[i]
    if (msg.tokens <= left) {
      kept.unshift(msg)
      left -= msg.tokens
      continue
    }
    if (rest.length - i <= keepRecent) {
      kept.unshift(msg)
      left -= msg.tokens
      continue
    }
    break
  }

  const dropped = rest.length - kept.length
  return { kept: sys.concat(kept), dropped, summaryNeeded: dropped > 0 }
}`

const L1C3 = `${L1C2}

function diagnoseOverflow(u) {
  const w = u.window
  const total = u.tools + u.retrieved + u.history + u.output
  const usage = total / w
  if (u.tools / w > 0.5) return { cause: 'tool-schema', usage }
  if (u.retrieved / w > 0.4) return { cause: 'retrieval', usage }
  if (u.output < w * 0.1 && total > w * 0.8) return { cause: 'output-reserve', usage }
  if (u.history / w > 0.6) return { cause: 'history-growth', usage }
  return { cause: 'ok', usage }
}`

/* ============================================================ 第 2 关测试 */
const L2S1 = `{
  check('JDK7 头插法会把链表顺序反转', () => {
    const a = { key: 3, next: null }
    const b = { key: 7, next: a }
    const c = { key: 11, next: b }
    const out = transferJdk7(c)
    same(out.key, 3, '原尾变成新头')
    same(out.next.key, 7)
    same(out.next.next.key, 11)
  })
  check('正常链表没有环', () => {
    same(hasCycle({ key: 1, next: { key: 2, next: null } }), false)
    same(hasCycle(null), false)
    same(hasCycle({ key: 1, next: null }), false)
  })
  check('并发下互相指向形成环（扩容死循环现场）', () => {
    const x = { key: 1 }
    const y = { key: 2 }
    x.next = y
    y.next = x
    same(hasCycle(x), true)
  })
  check('用快慢指针找出环的入口', () => {
    const a = { key: 1 }
    const b = { key: 2 }
    const c = { key: 3 }
    a.next = b
    b.next = c
    c.next = b
    same(findCycleStart(a).key, 2)
    same(findCycleStart({ key: 9, next: null }), null)
  })
}`

const L2S2 = `{
  check('没 remove → 线程复用时读到上个任务的上下文', () => {
    const r = threadLocalTrace([
      { thread: 't1', set: { user: 'alice' }, clear: false },
      { thread: 't1', use: 'user' }
    ])
    same(r.dirtyReads.length, 1)
    same(r.dirtyReads[0].value, 'alice')
  })
  check('用完 remove 之后不会串数据', () => {
    const r = threadLocalTrace([
      { thread: 't1', set: { user: 'alice' }, clear: true },
      { thread: 't1', use: 'user' }
    ])
    same(r.dirtyReads.length, 0)
    same(r.leaked.length, 0)
  })
  check('不同线程互不影响', () => {
    const r = threadLocalTrace([
      { thread: 't1', set: { user: 'alice' }, clear: false },
      { thread: 't2', use: 'user' }
    ])
    same(r.dirtyReads.length, 0)
  })
  check('泄漏清单列出没清掉的 key', () => {
    const r = threadLocalTrace([
      { thread: 't1', set: { a: 1, b: 2 }, clear: false }
    ])
    same(r.leaked.length, 1)
    same(r.leaked[0].keys.sort(), ['a', 'b'])
  })
  check('新任务的 set 会覆盖旧值（不会叠加泄漏）', () => {
    const r = threadLocalTrace([
      { thread: 't1', set: { user: 'alice' }, clear: false },
      { thread: 't1', set: { user: 'bob' }, clear: false }
    ])
    same(r.leaked.length, 1)
    same(r.leaked[0].keys, ['user'])
  })
}`

const L2S3 = `{
  check('CPU 密集：核数 + 1', () => {
    same(poolSize({ cpuCount: 8, ioWaitRatio: 0 }).core, 9)
    same(poolSize({ cpuCount: 1, ioWaitRatio: 0 }).core, 2)
  })
  check('IO 密集：核数 / (1 - 等待占比)', () => {
    same(poolSize({ cpuCount: 8, ioWaitRatio: 0.5 }).core, 16)
    same(poolSize({ cpuCount: 8, ioWaitRatio: 0.9 }).core, 80)
  })
  check('等待占比 100% 时给硬上限保护', () => {
    same(poolSize({ cpuCount: 8, ioWaitRatio: 1 }).core, 200)
  })
  check('向上取整，不能少给线程', () => {
    same(poolSize({ cpuCount: 4, ioWaitRatio: 0.25 }).core, 6)
    same(poolSize({ cpuCount: 3, ioWaitRatio: 0.5 }).core, 6)
  })
  check('返回核心数、最大数与队列容量', () => {
    const r = poolSize({ cpuCount: 4, ioWaitRatio: 0, queue: 'bounded' })
    same(r.core, 5)
    same(r.max >= r.core, true)
    same(r.queueCapacity > 0, true)
  })
}`

/* ============================================================ 第 2 关代码 */
const L2C1 = `function transferJdk7(head) {
  let out = null
  let cur = head
  while (cur) {
    out = { key: cur.key, next: out }
    cur = cur.next
  }
  return out
}

function hasCycle(head) {
  let slow = head
  let fast = head
  while (fast && fast.next) {
    slow = slow.next
    fast = fast.next.next
    if (slow === fast) return true
  }
  return false
}

function findCycleStart(head) {
  let slow = head
  let fast = head
  while (fast && fast.next) {
    slow = slow.next
    fast = fast.next.next
    if (slow === fast) {
      let p = head
      while (p !== slow) {
        p = p.next
        slow = slow.next
      }
      return p
    }
  }
  return null
}`

const L2C2 = `${L2C1}

function threadLocalTrace(tasks) {
  const maps = new Map()
  const dirtyReads = []

  tasks.forEach((task, index) => {
    if (!maps.has(task.thread)) maps.set(task.thread, new Map())
    const map = maps.get(task.thread)

    if (task.set) {
      for (const key of Object.keys(task.set)) map.set(key, task.set[key])
    }
    if (task.use) {
      if (map.has(task.use)) {
        dirtyReads.push({ thread: task.thread, key: task.use, value: map.get(task.use), task: index })
      }
    }
    if (task.clear) map.clear()
  })

  const leaked = []
  for (const [thread, map] of maps) {
    if (map.size > 0) leaked.push({ thread, keys: Array.from(map.keys()) })
  }
  return { leaked, dirtyReads }
}`

const L2C3 = `${L2C2}

function poolSize(opts) {
  const cpu = opts.cpuCount
  const wait = opts.ioWaitRatio || 0
  const MAX = 200
  let core
  if (wait <= 0) core = cpu + 1
  else if (wait >= 1) core = MAX
  else core = Math.min(MAX, Math.ceil(cpu / (1 - wait) - 1e-9))

  const max = opts.queue === 'bounded' ? core * 2 : core
  const queueCapacity = opts.queue === 'bounded' ? core * 2 : 0
  return { core, max, queueCapacity }
}`

/* ============================================================ 第 1 关 */
const LV1 = {
  id: 'lv1',
  title: '上下文溢出：把 token 预算算到每一段',
  emoji: '🫁',
  xp: 45,
  goal: '实现 token 预算拆分、上下文保留策略与溢出归因，把「模型答一半被截断」拆成可定位的四个来源。',
  why: '上下文溢出是最典型的事故：线上突然开始报 400（超出窗口），日志里只看得到「上下文太长」。真正定位要靠三段账——固定开销（system + 工具 schema + 输出预留）、可变上下文（历史 + 检索）、以及它们各自的占比。这一关把这三段账变成数字。',
  nodes: ['eng.warstory.ai', 'eng.warstory.ai.context-overflow'],
  thinking: [
    {
      title: '预算的第一刀应该砍在「固定开销」上',
      md: '窗口是总预算，但 system prompt、工具 schema、输出预留是**每轮都要付**的固定成本。工具定义多了，历史能用的空间就被挤掉——这是最容易被忽略的一笔。\n\n所以先算 `historyBudget = window - 固定开销`，再谈保留多少轮。算出来是负数，说明配置本身就该改（精简工具或换大窗口），而不是「截断历史」。'
    },
    {
      title: '截断要给「最近」和「系统」两个例外',
      md: '从最旧的对话开始丢是默认策略，但有两个不能动：system 消息（角色设定丢了模型行为就变了）、最近 K 条（用户当前问题就在最后）。\n\n丢弃意味着信息丢失，所以 `summaryNeeded` 要显式返回——调用方据此决定「丢之前先摘要成一条」。'
    }
  ],
  prereq: [
    {
      title: 'token 数不是字符数',
      md: '中文大约 1 字 1~2 token，英文 1 词 1.3 token，代码和 JSON 更贵。本关把每条消息的 token 数当成已知字段传进来——真实系统里用 tokenizer 预估，误差要靠 outputReserve 兜住。'
    },
    {
      title: '从尾部累加的实现细节',
      md: '从最新一条往前累加，放得下就保留、放不下就停。注意 `unshift` 把结果按原顺序拼回去，最后再把 system 消息拼在最前面。'
    }
  ],
  api: [
    {
      name: 'tokenBudget',
      sig: 'tokenBudget({ window, systemTokens, toolSchemaTokens, outputReserve }) => { historyBudget, overBudget }',
      args: '缺省字段按 0 处理。',
      returns: 'historyBudget 是留给历史的余量；overBudget 表示固定开销已经吃满窗口。',
      example: 'tokenBudget({ window: 128000, systemTokens: 2000, toolSchemaTokens: 8000, outputReserve: 4000 })\n// { historyBudget: 114000, overBudget: false }'
    },
    {
      name: 'planContext',
      sig: 'planContext({ budget, messages, keepRecent }) => { kept, dropped, summaryNeeded }',
      args: 'messages 每项 { role, tokens }；keepRecent 是必须保留的最近条数。',
      returns: 'kept 按原顺序返回（system 在最前）；dropped 是被丢弃条数。',
      example: 'planContext({ budget: 9000, messages: MSGS })\n// kept 3 条（system + 最近 2 条），dropped 2，summaryNeeded true'
    },
    {
      name: 'diagnoseOverflow',
      sig: 'diagnoseOverflow({ window, tools, retrieved, history, output }) => { cause, usage }',
      args: '各段是实际 token 占用。',
      returns: 'cause 取 tool-schema / retrieval / output-reserve / history-growth / ok。',
      example: 'diagnoseOverflow({ window: 128000, tools: 70000, retrieved: 5000, history: 20000, output: 4000 })\n// { cause: \'tool-schema\', usage: 0.77 }'
    }
  ],
  usage: 'const b = tokenBudget({ window: modelCtx, systemTokens: sys, toolSchemaTokens: schema, outputReserve: maxTokens })\nif (b.overBudget) return reconfigure()   // 配置问题，不是截断问题\nconst plan = planContext({ budget: b.historyBudget, messages, keepRecent: 2 })\nif (plan.summaryNeeded) messages = [summary(plan.droppedMessages), ...plan.kept]',
  hints: [
    '第 1 步：historyBudget = window - (system + toolSchema + outputReserve)，注意 overBudget 用 <= 0 判断。',
    '第 2 步：先扣掉 system 的 token，再从 rest 尾部往前放；放不下且不在 keepRecent 范围内就 break。',
    '第 3 步：判定有优先级——工具占比最高再检索、再输出预留、最后历史；顺序错了会把工具问题误诊成历史问题。'
  ],
  concepts: [
    {
      title: '为什么「加大窗口」救不了工具膨胀',
      md: '工具 schema 是每轮请求都带的，窗口越大它的绝对占用不变但比例下降——看着像解决了。真正的问题是延迟和成本：输入 token 每次都要计费，几十个工具定义会让每次调用贵得离谱。\n\n所以工具膨胀的正解是「按需挂载工具」（先给少量核心工具，模型按需申请）或「工具结果摘要」，不是换模型。'
    },
    {
      title: '输出预留不足的表现最隐蔽',
      md: '没报错、不崩，只是回答写到一半就 finish_reason=length。用户看到的是「AI 说了半句」，日志里一切正常。\n\n所以 outputReserve 要按「最长回答所需」估，而不是「剩余多少给多少」——这也是为什么预算要先扣输出再算历史。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '三段预算拆分',
      think: '先把固定成本和可变预算分开。这一步只有一行算术，但它决定了后面所有策略的前提——预算为负时根本没有截断方案可用。',
      hint: 'fixed = systemTokens + toolSchemaTokens + outputReserve；historyBudget = window - fixed。',
      code: L1C1,
      test: L1S1,
      diag: [
        '把 outputReserve 算进了可变部分（应该先扣）。',
        'overBudget 用了 < 0，余量为 0 时误判为可用。',
        '缺省参数没给默认 0，undefined 参与加法得到 NaN。',
        'historyBudget 没做下界，负数直接返回给调用方。'
      ]
    },
    {
      n: 2,
      title: '保留策略：从尾部累加',
      think: 'system 固定在最前不动；对话从最新往旧放，放不下就丢最旧的。keepRecent 是硬保证——即使超预算也要保留最近 K 条。',
      hint: '先算 sysTokens，left = budget - sysTokens；从 rest.length-1 往前循环，能放就 unshift 并扣减。',
      code: L1C2,
      test: L1S2,
      diag: [
        '没把 system 的 token 从预算里先扣掉，导致保留条数算多了。',
        '从头部开始累加（保留的是最旧的对话，正好反过来）。',
        '用 push 而不是 unshift，kept 顺序被倒过来。',
        'keepRecent 判定用了 i >= keepRecent（下标语义写错）。',
        'dropped 算成了 messages.length - kept.length（把 system 也算成丢弃）。'
      ]
    },
    {
      n: 3,
      title: '溢出归因',
      think: '四类来源按占比判定，优先级要固定：工具 schema / 检索上下文 / 输出预留 / 历史累积。输出预留那条要同时看「预留太少」和「总量已经顶到窗口」。',
      hint: '先算 total 与 usage；tools > 50% 判工具，retrieved > 40% 判检索，output < 10% 且 total > 80% 判输出，history > 60% 判历史。',
      code: L1C3,
      test: L1S3,
      diag: [
        '判定顺序把历史放在最前面，工具的占比被误诊成历史问题。',
        '输出预留只看 output < 10%，没看总量是否已经压满。',
        '四类都不满足时返回了 null 而不是 ok。',
        'usage 算成了 max / window 而不是 sum / window。',
        '百分比用了实际值直接比，没有除以 window。'
      ]
    }
  ],
  skeleton: `function tokenBudget(opts) {
  // TODO: 固定开销 → 历史余量
  throw new Error('tokenBudget 还没实现')
}

function planContext(opts) {
  // TODO: system 固定 + 从尾部累加 + keepRecent 硬保证
  throw new Error('planContext 还没实现')
}

function diagnoseOverflow(u) {
  // TODO: 四类来源按占比归因
  throw new Error('diagnoseOverflow 还没实现')
}`,
  solution: L1C3,
  finalCode: L1C3,
  tests: `${L1S1}\n${L1S2}\n${L1S3}`
}

/* ============================================================ 第 2 关 */
const LV2 = {
  id: 'lv2',
  title: 'JVM 三连：扩容死循环、ThreadLocal 泄漏、线程池配错',
  emoji: '☕',
  xp: 55,
  goal: '复现 HashMap 扩容成环、线程池复用导致的 ThreadLocal 串数据，并用公式算出线程池核心数。',
  why: '这三个是 Java 面试的「事故题」：JDK7 HashMap 并发扩容为什么 CPU 100%、ThreadLocal 为什么在线程池里会串数据、线程池核心数到底怎么算。光背结论没用，要能把链表连成环、把脏读路径走一遍、把核数和等待占比代进公式。',
  nodes: [
    'eng.warstory.be',
    'eng.warstory.be.hashmap-loop',
    'eng.warstory.be.threadlocal-leak',
    'eng.warstory.be.threadpool-sizing'
  ],
  thinking: [
    {
      title: '扩容死循环的本质是「头插法 + 并发」',
      md: 'JDK7 的 `transfer` 用头插法把旧链表搬到新桶：遍历旧链，每取出一个就插到新链头部。单线程下这只是把顺序反转，没问题。\n\n并发时两个线程同时搬，A 线程搬到一半（新链已经指向 B），B 线程继续从旧链取 A 插到自己新链头，A 的 next 就被改成指向了自己那一轮的节点——两条链互相引用，形成环。之后任何 get 落在这个桶上就死循环。'
    },
    {
      title: 'ThreadLocal 的泄漏与串数据是两个问题',
      md: '泄漏：ThreadLocalMap 的 key 是弱引用、value 是强引用，key 被回收后 value 还挂在 Map 里（线程不死，Map 就一直在）。\n\n串数据：线程被池化复用，上一个任务 set 的值没 remove，下一个任务读到的就是别人的上下文。后者更致命——直接影响业务正确性。'
    }
  ],
  prereq: [
    {
      title: 'Floyd 判环',
      md: '快慢指针：慢的走一步、快的走两步，相遇则有环。找入口：相遇后把一个指针放回起点，两个都走一步，再次相遇处就是环入口。时间复杂度 O(n)、空间 O(1)。'
    },
    {
      title: '线程池公式的适用条件',
      md: 'Brian Goetz 的 `N × (1 + W/C)` 里 N 是核数、W 是等待时间、C 是计算时间，两者之比就是本关的 `ioWaitRatio`。它假设「等待时可以完全让出 CPU」——对阻塞 IO 成立，对 CPU 密集不成立（所以要 N+1）。'
    }
  ],
  api: [
    {
      name: 'transferJdk7 / hasCycle / findCycleStart',
      sig: 'transferJdk7(head) => head；hasCycle(head) => boolean；findCycleStart(head) => node|null',
      args: 'head 是 { key, next } 的单链表。',
      returns: 'transferJdk7 返回头插法转移后的新链；findCycleStart 无环时返回 null。',
      example: 'transferJdk7(11→7→3)  // 3→7→11\nfindCycleStart(1→2→3→2)  // key 为 2 的节点'
    },
    {
      name: 'threadLocalTrace',
      sig: 'threadLocalTrace(tasks) => { leaked, dirtyReads }',
      args: 'tasks 每项 { thread, set?, use?, clear? }，按时间顺序执行。',
      returns: 'dirtyReads 记录串读到的值与任务下标；leaked 列出结束时还没清空的线程与 key。',
      example: "threadLocalTrace([\\n  { thread: 't1', set: { user: 'alice' }, clear: false },\\n  { thread: 't1', use: 'user' }\\n])\\n// dirtyReads: [{ thread: 't1', key: 'user', value: 'alice', task: 1 }]"
    },
    {
      name: 'poolSize',
      sig: 'poolSize({ cpuCount, ioWaitRatio, queue }) => { core, max, queueCapacity }',
      args: 'ioWaitRatio 是等待时间占总执行时间的比例（0 表示纯 CPU 密集）。',
      returns: 'core 用公式算（上限 200）；bounded 队列时 max = core×2 且 queueCapacity > 0。',
      example: 'poolSize({ cpuCount: 8, ioWaitRatio: 0.5 }).core  // 16\npoolSize({ cpuCount: 8, ioWaitRatio: 0 }).core    // 9'
    }
  ],
  usage: '// 排查 CPU 100% 的现场：\njstack <pid> | grep -A20 "http-nio" | grep -c "HashMap.transfer"\n\n// ThreadLocal 一定要 finally remove：\ntry { ctx.set(user); handle() } finally { ctx.remove() }\n\n// 线程池：\nnew ThreadPoolExecutor(core, max, 60, SECONDS, new ArrayBlockingQueue<>(queueCapacity))',
  hints: [
    '第 1 步：transferJdk7 每次把当前节点插到 out 的头部；hasCycle 快慢指针，fast.next 判空要写 while (fast && fast.next)。',
    '第 2 步：用 Map<thread, Map<key, value>> 模拟每个线程的 ThreadLocalMap；clear 时清空该线程的 Map。',
    '第 3 步：wait<=0 用 cpu+1；wait>=1 直接给上限；否则 ceil(cpu/(1-wait))。'
  ],
  concepts: [
    {
      title: 'JDK8 为什么改了',
      md: 'JDK8 把链表改成尾插（保持顺序）+ 红黑树（链表超 8 转树），并且用高低位拆分代替逐个 rehash。尾插本身不会产生环，并发问题交给 ConcurrentHashMap（CAS + synchronized 分段）。\n\n所以「HashMap 线程不安全」在 JDK8 里的表现不再是死循环，而是数据丢失/覆盖——面试如果只答「扩容死循环」，说明知识点停在 JDK7。'
    },
    {
      title: '线程池核心数不是「越大越好」',
      md: '线程多能提高 IO 等待时的吞吐，但每个线程占 ~1MB 栈 + 调度开销，上下文切换本身也要吃 CPU。\n\n公式给的是「稳态下的合理起点」，实际要压测：先按公式设，再把队列容量和拒绝策略配上，看 P99 与队列积压调。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '头插法与环检测',
      think: '先把 JDK7 的 transfer 写出来：遍历旧链，每步把节点插到新链头部——效果就是顺序反转。然后用快慢指针把「并发下形成环」这件事检测出来。',
      hint: 'transferJdk7：out = { key: cur.key, next: out }；hasCycle：slow 走一步、fast 走两步，相等即有环。',
      code: L2C1,
      test: L2S1,
      diag: [
        'transfer 用了尾插（顺序不会反转，复现不出 JDK7 的行为）。',
        'hasCycle 的 while 条件只判了 fast，fast.next 为空时抛错。',
        '快指针只走了一步，永远追不上慢指针。',
        'findCycleStart 相遇后把慢指针放回了起点（应该把另一个指针放起点）。'
      ]
    },
    {
      n: 2,
      title: 'ThreadLocal 串数据',
      think: '按时间顺序模拟每个任务的 set/use/clear：每个线程有自己的 Map，set 写入、use 读取（读到旧值就是脏读）、clear 清空。结束时还非空的线程就是泄漏点。',
      hint: '用 Map<thread, Map<key, value>>；use 时 map.has(key) 就记录一条 dirtyReads。',
      code: L2C2,
      test: L2S2,
      diag: [
        '所有线程共用一张 Map（应该按 thread 分开）。',
        'clear 只删了一个 key（应该清空该线程整张表）。',
        'dirtyReads 记了 read 事件而不是「读到了旧值」的事件。',
        'leaked 在 clear 之后仍然统计（判断时机放错）。',
        'set 时覆盖了但没有记录任务下标，无法定位脏读发生在哪一次。'
      ]
    },
    {
      n: 3,
      title: '线程池核数公式',
      think: '纯 CPU 密集用 N+1（多一个兜住偶发缺页）；有等待时按 N/(1-W) 放大。等待比例趋近 1 时必须封顶，否则算出天文数字直接拖垮机器。',
      hint: 'core = wait <= 0 ? cpu + 1 : min(200, ceil(cpu / (1 - wait)))；max 与队列按 bounded 参数分叉。',
      code: L2C3,
      test: L2S3,
      diag: [
        'CPU 密集用了 N 而不是 N+1。',
        'IO 密集用了 cpu * (1 + wait)（公式记错，应该是 cpu / (1 - wait)）。',
        '没有封顶，wait=0.99 时算出 800 个线程。',
        '用了 Math.floor 或 Math.round 取整，线程数少给。',
        'wait=1 时直接除零得到 Infinity。'
      ]
    }
  ],
  skeleton: `function transferJdk7(head) {
  // TODO: 头插法转移（顺序反转）
  throw new Error('transferJdk7 还没实现')
}

function hasCycle(head) {
  // TODO: 快慢指针判环
  throw new Error('hasCycle 还没实现')
}

function threadLocalTrace(tasks) {
  // TODO: 按线程隔离的 ThreadLocalMap + 脏读检测
  throw new Error('threadLocalTrace 还没实现')
}

function poolSize(opts) {
  // TODO: CPU/IO 密集两种公式 + 封顶
  throw new Error('poolSize 还没实现')
}`,
  solution: L2C3,
  finalCode: L2C3,
  tests: `${L2S1}\n${L2S2}\n${L2S3}`
}

/* ============================================================ 第 3 关测试 */
const L3S1 = `{
  check('offset 分页要扫 offset + limit 行', () => {
    const c = pageCost({ offset: 10000, limit: 20 })
    same(c.offsetRows, 10020)
    same(c.keysetRows, 20)
  })
  check('越往后翻，offset 扫描越夸张', () => {
    same(pageCost({ offset: 1000000, limit: 20 }).offsetRows, 1000020)
  })
  check('节省比例 = offset / (offset + limit)', () => {
    same(pageCost({ offset: 900, limit: 100 }).savedPct, 0.9)
    same(pageCost({ offset: 5000, limit: 20 }).savedPct.toFixed(4), '0.9960')
  })
  check('第一页两种方式成本相同', () => {
    same(pageCost({ offset: 0, limit: 20 }).savedPct, 0)
  })
}`

const L3S2 = `{
  check('查不存在的数据（缓存永远不命中）→ 穿透', () => {
    const r = classifyCacheIssue({ nonexistent: true })
    same(r.type, 'penetrate')
    same(r.fix, 'bloom-filter')
  })
  check('热点 key 过期瞬间 → 击穿', () => {
    const r = classifyCacheIssue({ hotKey: true, expired: true })
    same(r.type, 'breakdown')
    same(r.fix, 'mutex-or-logical-expire')
  })
  check('大量 key 同时过期 → 雪崩', () => {
    const r = classifyCacheIssue({ bulkExpire: true })
    same(r.type, 'avalanche')
    same(r.fix, 'ttl-jitter')
  })
  check('没有异常特征 → null', () => {
    same(classifyCacheIssue({}), null)
  })
  check('多特征并存按 穿透 > 击穿 > 雪崩 的优先级', () => {
    const r = classifyCacheIssue({ nonexistent: true, hotKey: true, bulkExpire: true })
    same(r.type, 'penetrate')
  })
}`

const L3S3 = `{
  var ITEMS = [
    { id: 9, sortKey: 100 },
    { id: 8, sortKey: 90 },
    { id: 7, sortKey: 90 },
    { id: 6, sortKey: 80 },
    { id: 5, sortKey: 70 },
    { id: 4, sortKey: 60 }
  ]

  check('首页：取前 limit 条并给出游标', () => {
    const p = nextPage(ITEMS, 2)
    same(p.items.map((i) => i.id), [9, 8])
    same(p.nextCursor, '90|8')
  })
  check('按游标继续（同 sortKey 用 id 兜底）', () => {
    const p = nextPage(ITEMS, 2, '90|8')
    same(p.items.map((i) => i.id), [7, 6])
  })
  check('游标编解码往返', () => {
    same(encodeCursor({ sortKey: 90, id: 8 }), '90|8')
    same(decodeCursor('90|8'), { sortKey: 90, id: 8 })
  })
  check('最后一页没有游标', () => {
    const p = nextPage(ITEMS, 10)
    same(p.items.length, 6)
    same(p.nextCursor, null)
  })
  check('空数据返回空页', () => {
    const p = nextPage([], 10)
    same(p.items, [])
    same(p.nextCursor, null)
  })
}`

/* ============================================================ 第 3 关代码 */
const L3C1 = `function pageCost(opts) {
  const offset = opts.offset || 0
  const limit = opts.limit || 10
  const offsetRows = offset + limit
  const keysetRows = limit
  return {
    offsetRows,
    keysetRows,
    savedPct: offsetRows === 0 ? 0 : (offsetRows - keysetRows) / offsetRows
  }
}`

const L3C2 = `${L3C1}

function classifyCacheIssue(s) {
  if (s.nonexistent) return { type: 'penetrate', fix: 'bloom-filter' }
  if (s.hotKey && s.expired) return { type: 'breakdown', fix: 'mutex-or-logical-expire' }
  if (s.bulkExpire) return { type: 'avalanche', fix: 'ttl-jitter' }
  return null
}`

const L3C3 = `${L3C2}

function encodeCursor(c) {
  return c.sortKey + '|' + c.id
}

function decodeCursor(s) {
  const parts = String(s).split('|')
  return { sortKey: Number(parts[0]), id: Number(parts[1]) }
}

function nextPage(items, limit, cursor) {
  if (!items.length) return { items: [], nextCursor: null }
  const c = cursor ? decodeCursor(cursor) : null
  const rest = c
    ? items.filter((i) => i.sortKey < c.sortKey || (i.sortKey === c.sortKey && i.id < c.id))
    : items
  const page = rest.slice(0, limit)
  const last = page[page.length - 1]
  return {
    items: page,
    nextCursor: rest.length > limit && last ? encodeCursor(last) : null
  }
}`

/* ============================================================ 第 4 关测试 */
const L4S1 = `{
  check('依赖是原始值且稳定 → 安全', () => {
    const r = analyzeEffect({ deps: [{ name: 'id', stable: true }], uses: ['id'], setsState: false })
    same(r.status, 'safe')
  })
  check('依赖是每次渲染新建的对象 + 里面 setState → 死循环', () => {
    const r = analyzeEffect({ deps: [{ name: 'filter', stable: false }], uses: ['filter'], setsState: true })
    same(r.status, 'loop')
    same(r.cause, 'unstable-dep')
    same(r.bad, ['filter'])
  })
  check('空依赖数组：只跑一次，不会循环', () => {
    const r = analyzeEffect({ deps: [], uses: [], setsState: true })
    same(r.status, 'safe')
  })
  check('用了外部变量但没进依赖 → 闭包过期', () => {
    const r = analyzeEffect({ deps: [], uses: ['id'], setsState: false })
    same(r.status, 'missing-dep')
    same(r.missing, ['id'])
  })
  check('setState 但依赖稳定 → 不会回环', () => {
    const r = analyzeEffect({ deps: [{ name: 'id', stable: true }], uses: ['id'], setsState: true })
    same(r.status, 'safe')
  })
}`

const L4S2 = `{
  check('订阅没有清理 → 泄漏', () => {
    const r = leakScan({ subscriptions: [{ name: 'websocket', cleanup: false }] })
    same(r.leaked, ['websocket'])
    same(r.clean, false)
  })
  check('订阅、定时器、事件都清理了 → 干净', () => {
    const r = leakScan({
      subscriptions: [{ name: 'websocket', cleanup: true }],
      timers: [{ name: 'poll', cleanup: true }],
      listeners: [{ name: 'resize', cleanup: true }]
    })
    same(r.clean, true)
    same(r.leaked, [])
  })
  check('定时器没 clearInterval → 泄漏', () => {
    same(leakScan({ timers: [{ name: 'poll', cleanup: false }] }).leaked, ['poll'])
  })
  check('事件监听没 off → 泄漏', () => {
    same(leakScan({ listeners: [{ name: 'resize', cleanup: false }] }).leaked, ['resize'])
  })
  check('卸载后仍 setState → 额外警告', () => {
    const r = leakScan({ subscriptions: [], setStateAfterUnmount: true })
    same(r.warnings.indexOf('setState-after-unmount') >= 0, true)
  })
}`

const L4S3 = `{
  var allow = { origins: ['https://a.com'], methods: ['GET', 'POST', 'PUT'], headers: ['x-token'] }

  check('简单请求不触发预检', () => {
    const r = preflight({ method: 'GET', headers: { accept: 'application/json' }, origin: 'https://a.com' }, allow)
    same(r.preflight, false)
    same(r.allowed, true)
  })
  check('PUT 触发预检', () => {
    same(preflight({ method: 'PUT', headers: {}, origin: 'https://a.com' }, allow).preflight, true)
  })
  check('自定义头触发预检', () => {
    same(preflight({ method: 'POST', headers: { 'x-token': 'abc' }, origin: 'https://a.com' }, allow).preflight, true)
  })
  check('Origin 不在白名单 → 预检失败', () => {
    const r = preflight({ method: 'PUT', headers: {}, origin: 'https://evil.com' }, allow)
    same(r.allowed, false)
    same(r.reason, 'origin-not-allowed')
  })
  check('带 credentials 时不能回 *', () => {
    const r = preflight({ method: 'PUT', headers: {}, origin: 'https://a.com', credentials: true }, { origins: ['*'] })
    same(r.allowed, false)
    same(r.reason, 'wildcard-with-credentials')
  })
}`

/* ============================================================ 第 4 关代码 */
const L4C1 = `function analyzeEffect(s) {
  const deps = s.deps || []
  const uses = s.uses || []
  const depNames = deps.map((d) => d.name)
  const missing = uses.filter((u) => depNames.indexOf(u) < 0)

  if (missing.length) return { status: 'missing-dep', missing, cause: 'stale-closure' }

  const bad = deps.filter((d) => !d.stable).map((d) => d.name)
  if (s.setsState && bad.length) {
    return { status: 'loop', cause: 'unstable-dep', fix: 'useMemo-or-useCallback', bad }
  }
  return { status: 'safe' }
}`

const L4C2 = `${L4C1}

function leakScan(c) {
  const leaked = []
  const warnings = []

  for (const kind of ['subscriptions', 'timers', 'listeners']) {
    for (const item of c[kind] || []) {
      if (!item.cleanup) leaked.push(item.name)
    }
  }
  if (c.setStateAfterUnmount) warnings.push('setState-after-unmount')
  if (c.refsToDom) warnings.push('dom-ref-retained')

  return { leaked, warnings, clean: leaked.length === 0 }
}`

const L4C3 = `${L4C2}

const SIMPLE_METHODS = ['GET', 'HEAD', 'POST']
const SIMPLE_HEADERS = ['accept', 'accept-language', 'content-language', 'content-type']

function preflight(req, allow) {
  const method = String(req.method || 'GET').toUpperCase()
  const headers = Object.keys(req.headers || {}).map((h) => h.toLowerCase())
  const simpleMethod = SIMPLE_METHODS.indexOf(method) >= 0
  const simpleHeaders = headers.every((h) => SIMPLE_HEADERS.indexOf(h) >= 0)
  const needs = !simpleMethod || !simpleHeaders

  const origins = allow.origins || []
  const matched = origins.indexOf(req.origin) >= 0
  if (!matched && origins.indexOf('*') < 0) {
    return { preflight: needs, allowed: false, reason: 'origin-not-allowed' }
  }
  if (req.credentials && origins.indexOf('*') >= 0 && !matched) {
    return { preflight: needs, allowed: false, reason: 'wildcard-with-credentials' }
  }
  return { preflight: needs, allowed: true, reason: null }
}`

/* ============================================================ 第 3 关 */
const LV3 = {
  id: 'lv3',
  title: '慢查询与缓存：深分页的代价、三连故障归因',
  emoji: '🐢',
  xp: 45,
  goal: '算出 offset 深分页的扫描代价、实现 keyset 分页游标，并把缓存穿透/击穿/雪崩按特征归类。',
  why: '「分页慢」和「缓存有问题」是两个最常见的含糊描述。深分页的代价能算出来：offset 10000 意味着 DB 要扫 10020 行再丢掉 10000 行；缓存三连的区别也能用特征区分：穿透是「数据不存在」，击穿是「单个热点过期」，雪崩是「一批同时过期」。归错类就会用错修法。',
  nodes: ['eng.warstory.data', 'eng.warstory.data.deep-pagination', 'eng.warstory.data.cache-trio'],
  thinking: [
    {
      title: 'offset 的代价是线性的，不是常数的',
      md: '`LIMIT 10000, 20` 在存储引擎里等价于「按顺序取出 10020 行，丢掉前 10000 行」。所以翻得越深越慢，且慢的是 IO 与回表，不是排序。\n\nkeyset 分页把「第几页」换成「上一页最后一条的排序键」：`WHERE sortKey < ? ORDER BY sortKey DESC LIMIT 20`，直接走索引定位，扫 20 行。代价是不能跳页。'
    },
    {
      title: '三连的区别在「哪一类 key 出问题」',
      md: '穿透：key 根本不存在，缓存永远不命中，请求全部落 DB（修法：布隆过滤器 / 缓存空值）。\n\n击穿：某个热点 key 恰好过期，重建期间所有请求打到 DB（修法：互斥重建 / 逻辑过期）。\n\n雪崩：大量 key 同时过期或缓存整体挂掉（修法：TTL 抖动 / 多级缓存 / 降级）。'
    }
  ],
  prereq: [
    {
      title: 'keyset 分页的游标要包含排序键的兜底字段',
      md: '只按 sortKey 分页时，同值的多条记录会跨页重复或漏掉。所以游标要带「排序键 + 唯一键」（sortKey + id），where 条件写成 `(sortKey < c.sortKey) OR (sortKey = c.sortKey AND id < c.id)`。'
    },
    {
      title: '游标要能安全编解码',
      md: '线上游标通常是 base64 编码的 JSON，避免用户手工改参数跳到任意位置。本关简化成 `sortKey|id` 字符串——重点是游标必须包含定位所需的全部信息。'
    }
  ],
  api: [
    {
      name: 'pageCost',
      sig: 'pageCost({ offset, limit }) => { offsetRows, keysetRows, savedPct }',
      args: 'offset 是跳过的行数，limit 是页大小。',
      returns: 'offsetRows = offset + limit；keysetRows = limit；savedPct 是节省比例。',
      example: 'pageCost({ offset: 900, limit: 100 })  // savedPct 0.9'
    },
    {
      name: 'classifyCacheIssue',
      sig: 'classifyCacheIssue({ nonexistent?, hotKey?, expired?, bulkExpire? }) => { type, fix } | null',
      args: '按场景特征传布尔值。',
      returns: 'type 取 penetrate / breakdown / avalanche，按此优先级判定；无特征返回 null。',
      example: 'classifyCacheIssue({ hotKey: true, expired: true })\n// { type: \'breakdown\', fix: \'mutex-or-logical-expire\' }'
    },
    {
      name: 'nextPage / encodeCursor / decodeCursor',
      sig: 'nextPage(items, limit, cursor?) => { items, nextCursor }',
      args: 'items 已按 sortKey 降序、id 降序排好；cursor 是上一页返回的字符串。',
      returns: 'nextCursor 为 null 表示没有下一页。',
      example: "nextPage(ITEMS, 2)       // items 9,8；nextCursor '90|8'\\nnextPage(ITEMS, 2, '90|8')  // items 7,6"
    }
  ],
  usage: 'SELECT id, sort_key FROM t\nWHERE (sort_key, id) < (?, ?)\nORDER BY sort_key DESC, id DESC\nLIMIT 20\n\n// 缓存三连的修法各自独立：\n// 穿透 → 布隆过滤器预检 + 空值短 TTL\n// 击穿 → SETNX 互斥重建 / 逻辑过期\n// 雪崩 → base_ttl + random(0, 300s)',
  hints: [
    '第 1 步：offsetRows = offset + limit，keysetRows = limit，savedPct = offset/(offset+limit)。',
    '第 2 步：判定顺序是穿透 → 击穿 → 雪崩，击穿要同时满足 hotKey 与 expired。',
    '第 3 步：nextPage 先按游标过滤（sortKey 更小，或相同且 id 更小），再 slice；只有剩下还有数据才给 nextCursor。'
  ],
  concepts: [
    {
      title: '为什么不能简单加索引救深分页',
      md: '给 sortKey 加索引能让 offset 分页也走索引，但仍然要「索引扫描 10020 条 + 回表」。如果查询只需要索引列（覆盖索引），代价降一个量级；只要回表，深 offset 就是躲不掉的。\n\n所以深分页的正解是换语义（keyset）或换实现（游标/ES search_after），不是调索引。'
    },
    {
      title: '缓存空值 vs 布隆过滤器',
      md: '缓存空值简单，但会被大量随机 ID 撑爆（每个都占一份空间）。布隆过滤器空间小、能挡掉绝大多数不存在的 key，但有假阳性（会把少量存在的 key 判成不存在）。\n\n常见组合：布隆过滤器挡第一层，空值缓存兜住漏网的。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '深分页代价',
      think: '把「扫多少行」这个量算出来就够说明问题了。offset 越大，offsetRows 与 keysetRows 的差距越大，savedPct 趋近 1。',
      hint: 'savedPct = (offsetRows - keysetRows) / offsetRows；offset 为 0 时返回 0 而不是 NaN。',
      code: L3C1,
      test: L3S1,
      diag: [
        'offsetRows 少加了 limit（DB 要扫 offset + limit 行）。',
        'savedPct 用了 limit / offset（比例反了）。',
        'offset 为 0 时除零得到 NaN。',
        'keysetRows 也按 offset + limit 算（keyset 只扫一页）。'
      ]
    },
    {
      n: 2,
      title: '缓存三连归因',
      think: '三类问题对应三种完全不同的修法，所以判定必须按特征而不是按「缓存命中率低」这种笼统现象。判定顺序固定：穿透最特殊（数据不存在），先判。',
      hint: 'nonexistent → penetrate；hotKey && expired → breakdown；bulkExpire → avalanche；都没有返回 null。',
      code: L3C2,
      test: L3S2,
      diag: [
        '把穿透和击穿判反了（穿透的修法是布隆过滤器）。',
        '击穿只看 hotKey 没看 expired（热点不过期就不是击穿）。',
        '雪崩的修法写成 mutex（雪崩靠 TTL 抖动/降级）。',
        '没有特征时返回了空对象而不是 null。',
        '判定顺序把雪崩放最前，多特征时归错了类。'
      ]
    },
    {
      n: 3,
      title: 'keyset 游标分页',
      think: '游标要能唯一定位「从哪之后」。排序键可能重复，所以游标必须带唯一键兜底；取下一页时先过滤再 slice，只有后面还有数据才返回游标。',
      hint: '过滤条件：i.sortKey < c.sortKey || (i.sortKey === c.sortKey && i.id < c.id)。',
      code: L3C3,
      test: L3S3,
      diag: [
        '游标只存了 sortKey，同值时跨页重复或漏数据。',
        '过滤条件写成 <=（会把游标那条重复返回）。',
        'nextCursor 在最后一页也返回了（应为 null）。',
        'decodeCursor 没做 Number 转换，比较时字符串与数字混用。',
        '空数据时抛错（slice 对空数组是安全的）。'
      ]
    }
  ],
  skeleton: `function pageCost(opts) {
  // TODO: offset 与 keyset 的扫描行数对比
  throw new Error('pageCost 还没实现')
}

function classifyCacheIssue(s) {
  // TODO: 穿透 / 击穿 / 雪崩 的特征判定
  throw new Error('classifyCacheIssue 还没实现')
}

function nextPage(items, limit, cursor) {
  // TODO: keyset 游标分页
  throw new Error('nextPage 还没实现')
}`,
  solution: L3C3,
  finalCode: L3C3,
  tests: `${L3S1}\n${L3S2}\n${L3S3}`
}

/* ============================================================ 第 4 关 */
const LV4 = {
  id: 'lv4',
  title: '前端三连：useEffect 死循环、内存泄漏、CORS 预检',
  emoji: '🕸️',
  xp: 55,
  goal: '分析 useEffect 的依赖问题（死循环/闭包过期）、扫描未清理的订阅与定时器，并判定 CORS 预检是否通过。',
  why: '前端面试的三道事故题几乎都长这样：页面无限请求（useEffect 依赖是每次新建的对象）、切路由后越来越卡（监听没清理）、接口莫名报 CORS 错（预检失败但不知道是哪条规则）。这三件事都有明确的判定逻辑，本关把它们写成代码。',
  nodes: [
    'eng.warstory.fe',
    'eng.warstory.fe.useeffect-loop',
    'eng.warstory.fe.memory-leak',
    'eng.warstory.fe.cors-preflight'
  ],
  thinking: [
    {
      title: '死循环的根因是「依赖身份每次变」',
      md: 'React 用 Object.is 比较依赖。对象字面量、数组字面量、内联函数每次渲染都是新引用，所以 effect 每次都会重跑；如果 effect 里又 setState，就形成「渲染 → effect → setState → 渲染」。\n\n修法不是「加个 if」，而是让依赖稳定：useMemo 包对象、useCallback 包函数，或者把状态更新移出 effect。'
    },
    {
      title: '预检失败要能说出「哪一条规则」',
      md: '浏览器发预检（OPTIONS）的条件：非简单方法（PUT/DELETE/PATCH）、非简单头（自定义头）、或者 Content-Type 不是三个白名单值之一。\n\n服务端要回 `Access-Control-Allow-Origin` 精确匹配 Origin（带 credentials 时绝不能是 *）、`Allow-Methods`、`Allow-Headers`。报错信息里通常只有「preflight response invalid」，所以要会逐条对照。'
    }
  ],
  prereq: [
    {
      title: '简单请求的定义',
      md: '方法只能是 GET/HEAD/POST，头只能是 Accept、Accept-Language、Content-Language、Content-Type（且值为 text/plain、multipart/form-data、application/x-www-form-urlencoded 之一）。任何一条不满足就触发预检。'
    },
    {
      title: '闭包过期（stale closure）',
      md: 'effect 的依赖数组为空但内部用了外部变量，effect 只会捕获首次渲染时的那个值。之后状态更新了，effect 里读到的还是旧值——定时器里读 state 恒为 0 就是这个原因。'
    }
  ],
  api: [
    {
      name: 'analyzeEffect',
      sig: 'analyzeEffect({ deps, uses, setsState }) => { status, cause?, missing?, bad? }',
      args: 'deps 每项 { name, stable }；stable=false 表示每次渲染都是新引用；uses 是 effect 里实际用到的外部变量名。',
      returns: 'status 取 safe / loop / missing-dep。',
      example: "analyzeEffect({ deps: [{ name: 'filter', stable: false }], uses: ['filter'], setsState: true })\\n// { status: 'loop', cause: 'unstable-dep', bad: ['filter'] }"
    },
    {
      name: 'leakScan',
      sig: 'leakScan({ subscriptions, timers, listeners, setStateAfterUnmount, refsToDom }) => { leaked, warnings, clean }',
      args: '每项 { name, cleanup }，cleanup 表示卸载时是否清掉。',
      returns: 'leaked 是没清理的资源名；clean 表示没有任何泄漏。',
      example: "leakScan({ subscriptions: [{ name: 'websocket', cleanup: false }] })\\n// { leaked: ['websocket'], clean: false }"
    },
    {
      name: 'preflight',
      sig: 'preflight(req, allow) => { preflight, allowed, reason }',
      args: 'req 有 method/headers/origin/credentials；allow 有 origins/methods/headers。',
      returns: 'preflight 表示浏览器是否会发预检；allowed 表示服务端规则是否放行。',
      example: "preflight({ method: 'PUT', headers: {}, origin: 'https://a.com' }, allow)\\n// { preflight: true, allowed: true }"
    }
  ],
  usage: 'useEffect(() => {\n  const ws = new WebSocket(url)\n  const timer = setInterval(poll, 5000)\n  const onResize = () => setSize(window.innerWidth)\n  window.addEventListener(\'resize\', onResize)\n  return () => {   // 这个清理函数漏一个就是一次泄漏\n    ws.close()\n    clearInterval(timer)\n    window.removeEventListener(\'resize\', onResize)\n  }\n}, [url])',
  hints: [
    '第 1 步：先算 missing（uses 里没进 deps 的），再算 bad（deps 里 stable=false 的）；只有 missing 为空时才判断 loop。',
    '第 2 步：三类资源统一遍历，cleanup 为 false 就记名字；setStateAfterUnmount 单独进 warnings。',
    '第 3 步：先判「是否需要预检」（方法 + 头），再判「是否放行」（origin 白名单、credentials 不能配 *）。'
  ],
  concepts: [
    {
      title: '为什么不能在 effect 里「加载数据后 setState」循环',
      md: '如果 effect 依赖里有每次新建的参数（比如 `options = { page: 1 }` 写在组件体里），effect 每次都跑，跑完 setState，setState 又触发渲染，渲染又新建 options——无限循环。\n\n正解：把参数提到组件外/用 useMemo 稳定，或者把「请求」交给带缓存的库（SWR/React Query），它们用序列化的 key 去重。'
    },
    {
      title: 'CORS 报错的三种典型原因',
      md: '1）服务端没回 Allow-Origin（或者回了但和 Origin 不精确相等）；2）带 credentials 却回了 `*`（浏览器直接拒绝）；3）预检里没列上实际用的 method/header。\n\n排查顺序：先看浏览器 Network 里那条 OPTIONS 的响应头，再对照请求的 method/header——报错信息本身不会告诉你缺哪一条。'
    }
  ],
  stages: [
    {
      n: 1,
      title: 'useEffect 依赖分析',
      think: '两种病要分开：缺依赖（闭包读旧值）和不稳定依赖（每次重跑）。前者更隐蔽——不报错、只是数据不对；后者表现为请求风暴。',
      hint: 'missing = uses 中不在 deps 里的；bad = deps 中 stable 为 false 的；只有 missing 为空且 setsState 且 bad 非空才算 loop。',
      code: L4C1,
      test: L4S1,
      diag: [
        '先判 loop 再判 missing，缺依赖被误报成死循环。',
        '把 stable=false 直接判成 loop（还要看 setsState）。',
        'missing 检测用了 includes 但对 deps 对象数组直接比对象。',
        '空依赖 + 空 uses 被判成 unsafe。',
        'bad 返回了对象数组而不是名字数组。'
      ]
    },
    {
      n: 2,
      title: '资源泄漏扫描',
      think: '前端泄漏就三类：订阅（WebSocket/EventSource）、定时器（setInterval）、事件监听（window/document）。判断标准只有一个——卸载时有没有清理。',
      hint: '统一遍历 subscriptions/timers/listeners，cleanup 为 false 的 name 进 leaked；clean = leaked.length === 0。',
      code: L4C2,
      test: L4S2,
      diag: [
        '只扫了订阅，漏了定时器和事件监听。',
        'clean 用了 leaked.length > 0（逻辑反了）。',
        '把 setStateAfterUnmount 也算进 leaked（它是警告不是泄漏）。',
        'cleanup 判定用了 falsy 判断，undefined 被当成已清理。',
        'refsToDom 没有进 warnings。'
      ]
    },
    {
      n: 3,
      title: 'CORS 预检判定',
      think: '两个独立的问题：浏览器会不会发预检（方法 + 头）、服务端规则放不放行（origin + credentials）。实现里要分开算，否则「没预检」会被误判成「不允许」。',
      hint: 'SIMPLE_METHODS = GET/HEAD/POST；SIMPLE_HEADERS 四个白名单头；origin 匹配失败回 origin-not-allowed。',
      code: L4C3,
      test: L4S3,
      diag: [
        '把 PUT 当成简单方法，漏掉预检。',
        '自定义头没判，x-token 被当成简单头放行。',
        'origin 白名单里 * 直接返回 *（credentials 场景会被浏览器拒）。',
        'credentials 与 * 同时存在时仍然放行。',
        'headers 的 key 没转小写，X-Token 大小写不匹配白名单。'
      ]
    }
  ],
  skeleton: `function analyzeEffect(s) {
  // TODO: 缺依赖 / 不稳定依赖 / 死循环
  throw new Error('analyzeEffect 还没实现')
}

function leakScan(c) {
  // TODO: 订阅 / 定时器 / 事件监听的清理检查
  throw new Error('leakScan 还没实现')
}

function preflight(req, allow) {
  // TODO: 简单请求判定 + origin/credentials 放行
  throw new Error('preflight 还没实现')
}`,
  solution: L4C3,
  finalCode: L4C3,
  tests: `${L4S1}\n${L4S2}\n${L4S3}`
}

export default {
  id: 'eng-warstory',
  version: 3,
  domain: 'eng',
  cumulative: false,
  title: '事故复盘：从溢出到死循环的四次现场',
  emoji: '🧯',
  xp: 60,
  tagline: '4 关：上下文溢出归因 → HashMap 死循环/ThreadLocal 泄漏/线程池 → 深分页与缓存三连 → useEffect 死循环与 CORS。',
  stack: ['故障排查', '工程实践'],
  intro: '面试里「讲一个你排查过的线上问题」是最高频的开放题，但多数人只能讲现象。这个项目把四类经典事故拆成可复现的代码：token 预算算错导致的截断、JDK7 扩容成环的 CPU 打满、线程池复用导致的 ThreadLocal 串数据、深分页把 DB 拖垮。每一关都能自己跑一遍现场。',
  outcome: '你能把「上下文超了」拆成四段账、把扩容死循环的链路复现出来、说清 ThreadLocal 为什么必须 finally remove、用公式给线程池定核心数。',
  levels: [LV1, LV2, LV3, LV4]
}