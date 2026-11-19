/**
 * 项目闯关内容源：Java 微服务 · JVM、治理与分布式通信（3 关 9 步）
 *
 *   lv1 JVM      —— 双亲委派、可达性分析、GC 触发决策
 *   lv2 治理     —— 网关路由、熔断状态机、Saga 补偿与 CAP
 *   lv3 通信     —— Redis 锁（SET NX EX 语义）、指数退避、幂等消费
 *
 * 所有组件都是纯函数/纯状态模拟：时间由 now 注入，Redis 用 Map 模拟，
 * 这样每个「分布式」结论都能在单进程里被测试钉死。
 */

/* ============================================================ 第 1 关测试 */
const L1S1 = `{
  const chain = [
    { id: 'bootstrap', canLoad: (n) => n.startsWith('java.') },
    { id: 'platform', canLoad: (n) => n.startsWith('javax.') || n.startsWith('javafx.') },
    { id: 'app', canLoad: (n) => n.startsWith('com.example.') }
  ]

  check('JDK 核心类由 bootstrap 加载', () => {
    same(loadClass(chain, 'java.lang.String').loader, 'bootstrap')
  })
  check('应用类：前两层都不能加载，落到 app', () => {
    same(loadClass(chain, 'com.example.OrderService').loader, 'app')
  })
  check('双亲委派：parent 能加载时 child 不抢', () => {
    const overlap = [
      { id: 'bootstrap', canLoad: (n) => n === 'com.example.Foo' },
      { id: 'app', canLoad: (n) => n === 'com.example.Foo' }
    ]
    same(loadClass(overlap, 'com.example.Foo').loader, 'bootstrap')
  })
  check('谁都不能加载：返回 null 而不是抛错', () => {
    same(loadClass(chain, 'org.other.Bar'), null)
  })
  check('打破双亲委派（parentFirst=false）：child 优先（SPI/热部署场景）', () => {
    const overlap = [
      { id: 'bootstrap', canLoad: (n) => n === 'com.example.Foo' },
      { id: 'app', canLoad: (n) => n === 'com.example.Foo' }
    ]
    same(loadClass(overlap, 'com.example.Foo', { parentFirst: false }).loader, 'app')
  })
}`

const L1S2 = `{
  check('从 GC Roots 能链到的对象都存活', () => {
    const graph = { A: ['B'], B: ['C'], C: [] }
    const alive = markReachable(['A'], graph)
    same([...alive].sort(), ['A', 'B', 'C'])
  })
  check('环引用不导致死循环，且环上对象都活着', () => {
    const graph = { A: ['B'], B: ['A'] }
    const alive = markReachable(['A'], graph)
    same([...alive].sort(), ['A', 'B'])
  })
  check('从 Root 不可达的对象是垃圾（即使互相引用）', () => {
    const graph = { A: ['B'], B: ['A'], X: ['Y'], Y: ['X'] }
    const alive = markReachable(['A'], graph)
    same([...alive].sort(), ['A', 'B'])
  })
  check('没有 Roots：全部是垃圾', () => {
    same([...markReachable([], { A: [] })].length, 0)
  })
  check('Root 自身即使在 graph 里没有出边也算存活', () => {
    same([...markReachable(['solo'], {})], ['solo'])
  })
}`

const L1S3 = `{
  check('老年代使用率到阈值：Full GC', () => {
    same(decideGC({ edenRatio: 0.3, oldRatio: 0.92, youngThreshold: 0.8, fullThreshold: 0.9 }), 'full')
  })
  check('只有 Eden 满：Young GC', () => {
    same(decideGC({ edenRatio: 0.85, oldRatio: 0.4, youngThreshold: 0.8, fullThreshold: 0.9 }), 'young')
  })
  check('都未到阈值：不 GC', () => {
    same(decideGC({ edenRatio: 0.5, oldRatio: 0.5 }), 'none')
  })
  check('Full GC 优先级高于 Young GC（同时触发时先 Full）', () => {
    same(decideGC({ edenRatio: 0.95, oldRatio: 0.95 }), 'full')
  })
  check('阈值可配置：默认值可以被覆盖', () => {
    same(decideGC({ edenRatio: 0.7, oldRatio: 0.5, youngThreshold: 0.6 }), 'young')
  })
}`

/* ============================================================ 第 1 关 */
const LV1 = {
  id: 'lv1',
  title: 'JVM：双亲委派、可达性与 GC 决策',
  emoji: '⛏️',
  xp: 50,
  goal: '实现三个 JVM 语义模拟：类加载的双亲委派（loadClass，可切换 parentFirst）、GC 可达性标记（markReachable）、GC 触发决策（decideGC）。',
  why: 'JVM 面试题几乎都能落到这三件事上：类到底由谁加载（双亲委派与打破它的场景）、谁是垃圾（可达性分析而不是引用计数）、什么时候 GC（Eden/老年代阈值）。把它们写成可跑代码，就不用再背「加载、验证、准备、解析、初始化」却答不出边界。',
  nodes: ['be.java.jvm', 'be.java.jvm.classloader', 'be.java.jvm.memory-gc'],
  thinking: [
    {
      title: '双亲委派解决的是「谁能定义核心类」',
      md: '类加载器收到请求先交给 parent，parent 再交给自己的 parent，一直到 bootstrap；bootstrap 加载不了才逐级向下。这样 `java.lang.String` 永远由 bootstrap 加载，用户自己写一个同名类也加载不进来——这是安全边界。\n\n打破它的场景：SPI（父加载器要加载子类实现的接口）、热部署、OSGi。做法是重写 loadClass 或线程上下文类加载器。'
    },
    {
      title: '引用计数为什么不作为 JVM 的 GC 算法',
      md: '引用计数遇到循环引用就无法回收（A→B→A 计数都不为 0）。JVM 用可达性分析：从 GC Roots（栈变量、静态字段、JNI 引用等）出发遍历，能到达的对象存活，其余回收。\n\n所以「互相引用的两个对象也可能是垃圾」——这是判断对象是否泄漏的关键视角。'
    }
  ],
  prereq: [
    {
      title: '类加载的五个阶段',
      md: '加载（读字节码）→ 验证（格式/语义）→ 准备（静态变量赋零值）→ 解析（符号引用转直接引用）→ 初始化（执行 clinit）。\n\n双亲委派发生在「加载」阶段：先找 parent 要 Class 对象。'
    },
    {
      title: '分代收集与阈值',
      md: '新对象先进 Eden；Eden 满触发 Young GC（Minor GC），存活对象进 Survivor；多次存活后晋升老年代。老年代占用到阈值触发 Full GC。\n\nFull GC 会 STW 更久，所以「老年代使用率高」比「Eden 满」严重得多。'
    }
  ],
  api: [
    {
      name: 'loadClass',
      sig: 'loadClass(chain, name, { parentFirst = true }) => { loader } | null',
      args: 'chain 是 [bootstrap, platform, app] 顺序的加载器数组，每个有 id 与 canLoad(name)。',
      returns: '命中的加载器 id；没人能加载返回 null；parentFirst=false 时 child 优先。',
      example: "loadClass(chain, 'java.lang.String')  // → { loader: 'bootstrap' }"
    },
    {
      name: 'markReachable',
      sig: 'markReachable(roots, graph) => Set<string>',
      args: 'graph: { id: [引用的 id] }；roots 是 GC Roots 列表。',
      returns: '可达对象集合（存活）。',
      example: "markReachable(['A'], { A: ['B'], B: [] })  // → Set { 'A', 'B' }"
    },
    {
      name: 'decideGC',
      sig: 'decideGC({ edenRatio, oldRatio, youngThreshold, fullThreshold }) => \'young\' | \'full\' | \'none\'',
      args: 'youngThreshold 默认 0.8，fullThreshold 默认 0.9。',
      returns: '老年代优先判 Full；其次 Eden 判 Young。',
      example: 'decideGC({ edenRatio: 0.85, oldRatio: 0.4 })  // → young'
    }
  ],
  usage: 'const loader = loadClass(chain, className).loader\nconst alive = markReachable(gcRoots, referenceGraph)\nconst action = decideGC({ edenRatio: eden.used / eden.capacity, oldRatio: old.used / old.capacity })',
  hints: [
    'loadClass：parentFirst 时从 chain[0] 往后找第一个 canLoad；否则从后往前。',
    'markReachable 用栈/队列 BFS，Set 去重，环引用靠 Set 不会死循环。',
    'decideGC 先判 old，再判 eden（同时触发时 Full 优先）。'
  ],
  concepts: [
    {
      title: '为什么 Full GC 慢',
      md: 'Full GC 要扫描整个堆并整理老年代，STW 时间与存活对象数成正比；Young GC 只扫 Eden + Survivor，存活少、复制快。\n\n所以调优的目标通常是「减少对象晋升」而不是「让 GC 更快」：把临时对象留在 Eden、避免大对象直接进老年代、控制缓存大小。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '先写双亲委派',
      think: '委派的本质是「查找顺序」：parent 优先还是 child 优先，一行循环就能表达。先让这个顺序可测，再谈打破它的场景。',
      hint: 'parentFirst 时 for 正序，否则 for 倒序；第一个 canLoad 命中的即为结果。',
      code: `function loadClass(chain, name, opts = {}) {
  const { parentFirst = true } = opts
  const order = parentFirst ? chain : [...chain].reverse()
  for (const loader of order) {
    if (loader.canLoad(name)) return { loader: loader.id }
  }
  return null
}`,
      test: L1S1,
      diag: [
        '循环方向固定了，parentFirst 参数没生效。',
        '命中后没有立即返回，继续遍历导致选到最后一个。',
        '没人能加载时抛错了，应该返回 null。',
        'parentFirst=false 时没有反转顺序。',
        '返回值缺 loader 字段，测试取不到。'
      ]
    },
    {
      n: 2,
      title: '再写可达性标记',
      think: 'GC 判定活着的唯一标准是「从 Roots 可达」。用栈遍历 + Set 去重，环引用天然不会死循环。',
      hint: 'stack = [...roots]；pop 出节点，若已在 alive 跳过；否则加入并压入它的出边。',
      code: `function loadClass(chain, name, opts = {}) {
  const { parentFirst = true } = opts
  const order = parentFirst ? chain : [...chain].reverse()
  for (const loader of order) {
    if (loader.canLoad(name)) return { loader: loader.id }
  }
  return null
}

function markReachable(roots, graph) {
  const alive = new Set()
  const stack = [...roots]
  while (stack.length) {
    const id = stack.pop()
    if (alive.has(id)) continue
    alive.add(id)
    for (const next of graph[id] ?? []) stack.push(next)
  }
  return alive
}`,
      test: L1S2,
      diag: [
        '只标记了 Roots 本身，没有遍历引用。',
        '环引用没有去重，导致死循环。',
        '把「互相引用」当成了存活（应该只看能否从 Root 到达）。',
        'Root 在 graph 里没有出边时被漏掉。',
        '遍历用了递归但没有 visited 标记，环引用导致栈溢出。'
      ]
    },
    {
      n: 3,
      title: '最后写 GC 触发决策',
      think: 'GC 决策是阈值比较，但顺序决定结论：老年代高必须 Full，即使 Eden 也高。把默认阈值与覆盖都写进去。',
      hint: 'old >= fullThreshold → full；eden >= youngThreshold → young；否则 none。',
      code: `function loadClass(chain, name, opts = {}) {
  const { parentFirst = true } = opts
  const order = parentFirst ? chain : [...chain].reverse()
  for (const loader of order) {
    if (loader.canLoad(name)) return { loader: loader.id }
  }
  return null
}

function markReachable(roots, graph) {
  const alive = new Set()
  const stack = [...roots]
  while (stack.length) {
    const id = stack.pop()
    if (alive.has(id)) continue
    alive.add(id)
    for (const next of graph[id] ?? []) stack.push(next)
  }
  return alive
}

function decideGC(spec) {
  const { edenRatio, oldRatio, youngThreshold = 0.8, fullThreshold = 0.9 } = spec
  if (oldRatio >= fullThreshold) return 'full'
  if (edenRatio >= youngThreshold) return 'young'
  return 'none'
}`,
      test: L1S3,
      diag: [
        '先判 Eden 再判老年代，同时触发时给了 Young。',
        '用了 > 而不是 >=，边界值被判成不触发。',
        '阈值没做默认值，缺参时返回 undefined。',
        '返回的是布尔值而不是 young/full/none。',
        '只判了 Eden，老年代满了也走 Young（危害更大）。'
      ]
    }
  ],
  skeleton: `function loadClass(chain, name, opts) { throw new Error('还没实现') }
function markReachable(roots, graph) { throw new Error('还没实现') }
function decideGC(spec) { throw new Error('还没实现') }`,
  solution: `function loadClass(chain, name, opts = {}) {
  const { parentFirst = true } = opts
  const order = parentFirst ? chain : [...chain].reverse()
  for (const loader of order) {
    if (loader.canLoad(name)) return { loader: loader.id }
  }
  return null
}

function markReachable(roots, graph) {
  const alive = new Set()
  const stack = [...roots]
  while (stack.length) {
    const id = stack.pop()
    if (alive.has(id)) continue
    alive.add(id)
    for (const next of graph[id] ?? []) stack.push(next)
  }
  return alive
}

function decideGC(spec) {
  const { edenRatio, oldRatio, youngThreshold = 0.8, fullThreshold = 0.9 } = spec
  if (oldRatio >= fullThreshold) return 'full'
  if (edenRatio >= youngThreshold) return 'young'
  return 'none'
}`,
  finalCode: `function loadClass(chain, name, opts = {}) {
  const { parentFirst = true } = opts
  const order = parentFirst ? chain : [...chain].reverse()
  for (const loader of order) {
    if (loader.canLoad(name)) return { loader: loader.id }
  }
  return null
}

function markReachable(roots, graph) {
  const alive = new Set()
  const stack = [...roots]
  while (stack.length) {
    const id = stack.pop()
    if (alive.has(id)) continue
    alive.add(id)
    for (const next of graph[id] ?? []) stack.push(next)
  }
  return alive
}

function decideGC(spec) {
  const { edenRatio, oldRatio, youngThreshold = 0.8, fullThreshold = 0.9 } = spec
  if (oldRatio >= fullThreshold) return 'full'
  if (edenRatio >= youngThreshold) return 'young'
  return 'none'
}`,
  tests: `${L1S1}\n${L1S2}\n${L1S3}`
}

/* ============================================================ 第 2 关测试 */
const L2S1 = `{
  const services = [
    { name: 'order-v1', prefix: '/api/order', weight: 1, healthy: true },
    { name: 'order-v2', prefix: '/api/order/v2', weight: 1, healthy: true },
    { name: 'user', prefix: '/api/user', weight: 1, healthy: true }
  ]

  check('最长前缀优先：/api/order/v2/x 命中 v2 而不是 v1', () => {
    same(pickService(services, '/api/order/v2/x').name, 'order-v2')
  })
  check('普通路径按前缀匹配', () => {
    same(pickService(services, '/api/order/1').name, 'order-v1')
  })
  check('不健康实例被剔除：唯一匹配挂了就返回 null', () => {
    const down = services.map((s) => (s.name === 'order-v1' ? { ...s, healthy: false } : s))
    same(pickService(down, '/api/order/1'), null)
    same(pickService(services, '/unknown'), null, '没有匹配前缀也返回 null')
  })
  check('加权轮询：权重 1:3 时按 a,b,b,b 分布', () => {
    const items = [
      { name: 'a', weight: 1 },
      { name: 'b', weight: 3 }
    ]
    same([0, 1, 2, 3].map((c) => pickByWeight(items, c)), ['a', 'b', 'b', 'b'])
  })
}`

const L2S2 = `{
  const cfg = { failureThreshold: 3, halfOpenAfterMs: 1000 }

  check('连续失败到阈值：closed → open 并记录打开时间', () => {
    let s = { mode: 'closed', failures: 0, openedAt: null }
    s = breakerStep(s, { now: 0, success: false, config: cfg })
    s = breakerStep(s, { now: 10, success: false, config: cfg })
    s = breakerStep(s, { now: 20, success: false, config: cfg })
    same(s.mode, 'open')
    same(s.openedAt, 20)
  })
  check('closed 内成功一次把失败计数清零', () => {
    const s = breakerStep({ mode: 'closed', failures: 2, openedAt: null }, { now: 0, success: true, config: cfg })
    same(s.failures, 0)
    same(s.mode, 'closed')
  })
  check('open 冷却未到 → 保持；冷却到期 → half', () => {
    same(breakerStep({ mode: 'open', failures: 3, openedAt: 100 }, { now: 500, success: true, config: cfg }).mode, 'open')
    same(breakerStep({ mode: 'open', failures: 3, openedAt: 100 }, { now: 1200, success: true, config: cfg }).mode, 'half')
  })
  check('half 探针成功 → closed；失败 → 重新 open 并刷新时间', () => {
    same(breakerStep({ mode: 'half', failures: 3, openedAt: 100 }, { now: 1200, success: true, config: cfg }).mode, 'closed')
    const failed = breakerStep({ mode: 'half', failures: 3, openedAt: 100 }, { now: 1200, success: false, config: cfg })
    same(failed.mode, 'open')
    same(failed.openedAt, 1200)
  })
}`

const L2S3 = `{
  const steps = [
    { name: '扣库存', compensate: '恢复库存' },
    { name: '创建订单', compensate: '取消订单' },
    { name: '扣款', compensate: '退款' }
  ]

  check('Saga 补偿按执行顺序逆序回滚', () => {
    same(compensatePlan(steps, 2).map((s) => s.name), ['创建订单', '扣库存'])
  })
  check('0 步成功：没有补偿', () => {
    same(compensatePlan(steps, 0), [])
  })
  check('CAP：有分区风险 + 强一致 → CP', () => {
    same(classifyCAP({ needsStrongConsistency: true, partitionRisk: true }), 'CP')
  })
  check('CAP：无分区 → CA；有分区但可用性优先 → AP', () => {
    same(classifyCAP({ needsStrongConsistency: true, partitionRisk: false }), 'CA')
    same(classifyCAP({ needsStrongConsistency: false, partitionRisk: true }), 'AP')
  })
}`

/* ============================================================ 第 2 关 */
const LV2 = {
  id: 'lv2',
  title: '治理：网关路由、熔断状态机与分布式事务',
  emoji: '🛡️',
  xp: 55,
  goal: '实现三个治理组件：网关的最长前缀路由与加权轮询（pickService + pickByWeight）、熔断器状态机（breakerStep）、Saga 补偿计划与 CAP 归类（compensatePlan + classifyCAP）。',
  why: '微服务的「治理」不是配置几个中间件就完事：路由错了请求打到旧版本、熔断器状态机差一个分支就永远打不开或永远关不上、分布式事务没有补偿计划就会留下半成功的数据。这些都要能写成状态机并被测试验证。',
  nodes: ['be.micro.governance', 'be.micro.governance.registry-gateway', 'be.micro.governance.resilience', 'be.micro.distributed-tx', 'be.micro.distributed-tx.cap-base', 'be.micro.distributed-tx.solutions'],
  thinking: [
    {
      title: '网关路由为什么用最长前缀',
      md: '前缀路由的语义是「越具体的规则越优先」：/api/order/v2 应该赢过 /api/order。\n\n如果按注册顺序或权重取，就会出现 v2 流量被 v1 接走。健康实例过滤必须发生在匹配之后——否则一个挂了的最长前缀会被退化成次长前缀，把请求悄悄发到错误的版本。'
    },
    {
      title: '熔断器是三态机，不是一个开关',
      md: 'closed（正常放行）→ 失败累计到阈值 → open（直接拒绝）；open 冷却一段时间 → half-open（放一个探针）；探针成功 → closed，失败 → open 并刷新时间。\n\n最容易漏的是 half-open 失败后没有刷新 openedAt，导致探针被反复放出——等于熔断器失效。'
    },
    {
      title: 'Saga 与 CAP 的关系',
      md: 'Saga 把长事务拆成「正向步骤 + 补偿步骤」，失败时逆序补偿。它不保证原子性（中间状态可见），保证的是最终一致——这正是 CAP 里选 AP 的代价。\n\n需要强一致的场景（钱、库存）会选 CP（2PC/TCC），代价是可用性下降。分类不是口号：先问「分区时能不能拒绝服务」，再问「中间状态能不能被别人看到」。'
    }
  ],
  prereq: [
    {
      title: '加权轮询的取模实现',
      md: '把权重铺成一个虚拟序列（a 占 1 格、b 占 3 格），用 counter % total 取槽位：\n\n```\ncounter: 0 1 2 3 → a b b b\n```\n\n平滑加权轮询（Nginx 的 smooth wrr）会进一步打散，避免连续打到同一实例。'
    },
    {
      title: 'CAP 与 BASE',
      md: 'CAP：分区发生时，一致性与可用性不可兼得。BASE 是 AP 的工程化：基本可用、软状态、最终一致。\n\n所以「我们系统是 AP」意味着「分区时接受读到旧数据」，不是「没有一致性要求」。'
    }
  ],
  api: [
    {
      name: 'pickService / pickByWeight',
      sig: 'pickService(services, path) => service | null；pickByWeight(items, counter) => name',
      args: 'services: { name, prefix, weight, healthy }[]；counter 是轮询计数。',
      returns: '最长前缀命中且健康的实例；无匹配返回 null。',
      example: "pickService(services, '/api/order/v2/x').name  // → 'order-v2'"
    },
    {
      name: 'breakerStep',
      sig: 'breakerStep(prev, { now, success, config }) => nextState',
      args: 'prev: { mode, failures, openedAt }；config: { failureThreshold, halfOpenAfterMs }。',
      returns: '新状态；mode ∈ closed | open | half。',
      example: "breakerStep({ mode: 'closed', failures: 0, openedAt: null }, { now: 0, success: false })"
    },
    {
      name: 'compensatePlan / classifyCAP',
      sig: 'compensatePlan(steps, executedCount) => steps[]；classifyCAP({ needsStrongConsistency, partitionRisk }) => \'CP\'|\'AP\'|\'CA\'',
      args: 'steps: { name, compensate }[]；executedCount 是已成功的步骤数。',
      returns: '需要补偿的步骤（逆序）；CAP 归类。',
      example: 'compensatePlan(steps, 2)  // 前 2 步逆序补偿'
    }
  ],
  usage: 'const target = pickService(services, req.path)\nif (!target) return res.status(404)\n\nlet breaker = { mode: "closed", failures: 0, openedAt: null }\nbreaker = breakerStep(breaker, { now: Date.now(), success: ok, config })\n\nconst rollback = compensatePlan(sagaSteps, executed)',
  hints: [
    'pickService 先 filter(healthy && prefix)，再取前缀最长的那组，多个时用权重轮询。',
    'breakerStep 三个分支：open 看冷却；half 看探针；closed 累计失败。',
    'compensatePlan 取 steps.slice(0, executedCount).reverse()。'
  ],
  stages: [
    {
      n: 1,
      title: '先写网关路由',
      think: '路由是「过滤 → 最长前缀 → 权重轮询」三步。顺序错了（先轮询再过滤）就会把请求分给挂掉的实例。',
      hint: 'filter(healthy) → filter(prefix 匹配) → 最长前缀 → pickByWeight。',
      code: `function pickByWeight(items, counter) {
  const total = items.reduce((a, x) => a + x.weight, 0)
  const slot = counter % total
  let acc = 0
  for (const item of items) {
    acc += item.weight
    if (slot < acc) return item.name
  }
  return items[0].name
}

function pickService(services, path) {
  const healthy = services.filter((s) => s.healthy && path.startsWith(s.prefix))
  if (!healthy.length) return null
  const maxLen = Math.max(...healthy.map((s) => s.prefix.length))
  const candidates = healthy.filter((s) => s.prefix.length === maxLen)
  return candidates[0]
}`,
      test: L2S1,
      diag: [
        '最长前缀用了按顺序优先，没有比较 prefix 长度。',
        '健康过滤在匹配之后被漏掉，挂了也能命中。',
        '无匹配时返回了 undefined / 抛错，应该显式 null。',
        '加权轮询的槽位计算用了 counter % items.length。'
      ]
    },
    {
      n: 2,
      title: '再写熔断状态机',
      think: '三态机的分支要完整：open 看冷却、half 看探针、closed 记失败。最容易漏的是 half 失败后刷新 openedAt。',
      hint: 'open 且未到期 → 原样返回；到期 → half；half 成功 → closed，失败 → open(openedAt=now)；closed 失败累加，达阈值 → open。',
      code: `function pickByWeight(items, counter) {
  const total = items.reduce((a, x) => a + x.weight, 0)
  const slot = counter % total
  let acc = 0
  for (const item of items) {
    acc += item.weight
    if (slot < acc) return item.name
  }
  return items[0].name
}

function pickService(services, path) {
  const healthy = services.filter((s) => s.healthy && path.startsWith(s.prefix))
  if (!healthy.length) return null
  const maxLen = Math.max(...healthy.map((s) => s.prefix.length))
  const candidates = healthy.filter((s) => s.prefix.length === maxLen)
  return candidates[0]
}

function breakerStep(prev, event) {
  const { failureThreshold = 3, halfOpenAfterMs = 1000 } = event.config ?? {}
  const now = event.now
  if (prev.mode === 'open') {
    if (now - prev.openedAt >= halfOpenAfterMs) {
      return { mode: 'half', failures: prev.failures, openedAt: prev.openedAt }
    }
    return prev
  }
  if (prev.mode === 'half') {
    if (event.success) return { mode: 'closed', failures: 0, openedAt: null }
    return { mode: 'open', failures: prev.failures, openedAt: now }
  }
  if (event.success) return { mode: 'closed', failures: 0, openedAt: null }
  const failures = prev.failures + 1
  if (failures >= failureThreshold) return { mode: 'open', failures, openedAt: now }
  return { mode: 'closed', failures, openedAt: null }
}`,
      test: L2S2,
      diag: [
        'open 状态没有看当前时间，冷却没到也放行。',
        'half-open 成功没有回到 closed 并清零 failures。',
        'half-open 失败没有刷新 openedAt（熔断器失效）。',
        'closed 的失败计数没有累加，或阈值用了 > 而不是 >=。'
      ]
    },
    {
      n: 3,
      title: '最后写 Saga 与 CAP 归类',
      think: '补偿是逆序的：后做的先撤。CAP 归类要先问「分区时能不能拒绝」，再问「是否需要强一致」。',
      hint: 'compensatePlan: slice(0, n).reverse()；classifyCAP: 无分区 → CA；有分区 → 强一致 CP，否则 AP。',
      code: `function pickByWeight(items, counter) {
  const total = items.reduce((a, x) => a + x.weight, 0)
  const slot = counter % total
  let acc = 0
  for (const item of items) {
    acc += item.weight
    if (slot < acc) return item.name
  }
  return items[0].name
}

function pickService(services, path) {
  const healthy = services.filter((s) => s.healthy && path.startsWith(s.prefix))
  if (!healthy.length) return null
  const maxLen = Math.max(...healthy.map((s) => s.prefix.length))
  const candidates = healthy.filter((s) => s.prefix.length === maxLen)
  return candidates[0]
}

function breakerStep(prev, event) {
  const { failureThreshold = 3, halfOpenAfterMs = 1000 } = event.config ?? {}
  const now = event.now
  if (prev.mode === 'open') {
    if (now - prev.openedAt >= halfOpenAfterMs) {
      return { mode: 'half', failures: prev.failures, openedAt: prev.openedAt }
    }
    return prev
  }
  if (prev.mode === 'half') {
    if (event.success) return { mode: 'closed', failures: 0, openedAt: null }
    return { mode: 'open', failures: prev.failures, openedAt: now }
  }
  if (event.success) return { mode: 'closed', failures: 0, openedAt: null }
  const failures = prev.failures + 1
  if (failures >= failureThreshold) return { mode: 'open', failures, openedAt: now }
  return { mode: 'closed', failures, openedAt: null }
}

function compensatePlan(steps, executedCount) {
  return steps.slice(0, executedCount).reverse()
}

function classifyCAP(spec) {
  if (!spec.partitionRisk) return 'CA'
  return spec.needsStrongConsistency ? 'CP' : 'AP'
}`,
      test: L2S3,
      diag: [
        '补偿没有逆序（后做的步骤先撤才对）。',
        'executedCount 用错（补偿了未执行的步骤）。',
        'CAP 归类把「无分区」也归成了 CP/AP。',
        '强一致与可用的分支写反了。'
      ]
    }
  ],
  skeleton: `function pickByWeight(items, counter) { throw new Error('还没实现') }
function pickService(services, path) { throw new Error('还没实现') }
function breakerStep(prev, event) { throw new Error('还没实现') }
function compensatePlan(steps, executedCount) { throw new Error('还没实现') }
function classifyCAP(spec) { throw new Error('还没实现') }`,
  solution: `function pickByWeight(items, counter) {
  const total = items.reduce((a, x) => a + x.weight, 0)
  const slot = counter % total
  let acc = 0
  for (const item of items) {
    acc += item.weight
    if (slot < acc) return item.name
  }
  return items[0].name
}

function pickService(services, path) {
  const healthy = services.filter((s) => s.healthy && path.startsWith(s.prefix))
  if (!healthy.length) return null
  const maxLen = Math.max(...healthy.map((s) => s.prefix.length))
  const candidates = healthy.filter((s) => s.prefix.length === maxLen)
  return candidates[0]
}

function breakerStep(prev, event) {
  const { failureThreshold = 3, halfOpenAfterMs = 1000 } = event.config ?? {}
  const now = event.now
  if (prev.mode === 'open') {
    if (now - prev.openedAt >= halfOpenAfterMs) {
      return { mode: 'half', failures: prev.failures, openedAt: prev.openedAt }
    }
    return prev
  }
  if (prev.mode === 'half') {
    if (event.success) return { mode: 'closed', failures: 0, openedAt: null }
    return { mode: 'open', failures: prev.failures, openedAt: now }
  }
  if (event.success) return { mode: 'closed', failures: 0, openedAt: null }
  const failures = prev.failures + 1
  if (failures >= failureThreshold) return { mode: 'open', failures, openedAt: now }
  return { mode: 'closed', failures, openedAt: null }
}

function compensatePlan(steps, executedCount) {
  return steps.slice(0, executedCount).reverse()
}

function classifyCAP(spec) {
  if (!spec.partitionRisk) return 'CA'
  return spec.needsStrongConsistency ? 'CP' : 'AP'
}`,
  finalCode: `function pickByWeight(items, counter) {
  const total = items.reduce((a, x) => a + x.weight, 0)
  const slot = counter % total
  let acc = 0
  for (const item of items) {
    acc += item.weight
    if (slot < acc) return item.name
  }
  return items[0].name
}

function pickService(services, path) {
  const healthy = services.filter((s) => s.healthy && path.startsWith(s.prefix))
  if (!healthy.length) return null
  const maxLen = Math.max(...healthy.map((s) => s.prefix.length))
  const candidates = healthy.filter((s) => s.prefix.length === maxLen)
  return candidates[0]
}

function breakerStep(prev, event) {
  const { failureThreshold = 3, halfOpenAfterMs = 1000 } = event.config ?? {}
  const now = event.now
  if (prev.mode === 'open') {
    if (now - prev.openedAt >= halfOpenAfterMs) {
      return { mode: 'half', failures: prev.failures, openedAt: prev.openedAt }
    }
    return prev
  }
  if (prev.mode === 'half') {
    if (event.success) return { mode: 'closed', failures: 0, openedAt: null }
    return { mode: 'open', failures: prev.failures, openedAt: now }
  }
  if (event.success) return { mode: 'closed', failures: 0, openedAt: null }
  const failures = prev.failures + 1
  if (failures >= failureThreshold) return { mode: 'open', failures, openedAt: now }
  return { mode: 'closed', failures, openedAt: null }
}

function compensatePlan(steps, executedCount) {
  return steps.slice(0, executedCount).reverse()
}

function classifyCAP(spec) {
  if (!spec.partitionRisk) return 'CA'
  return spec.needsStrongConsistency ? 'CP' : 'AP'
}`,
  tests: `${L2S1}\n${L2S2}\n${L2S3}`
}

/* ============================================================ 第 3 关测试 */
const L3S1 = `{
  check('没人持有：抢锁成功', () => {
    const lock = new RedisLock()
    same(lock.tryAcquire('order:1', 'client-a', 3000, 0), true)
  })
  check('已被持有：第二个客户端抢不到', () => {
    const lock = new RedisLock()
    lock.tryAcquire('order:1', 'client-a', 3000, 0)
    same(lock.tryAcquire('order:1', 'client-b', 3000, 100), false)
  })
  check('锁过期后可以被别人抢到', () => {
    const lock = new RedisLock()
    lock.tryAcquire('order:1', 'client-a', 1000, 0)
    same(lock.isLocked('order:1', 500), true)
    same(lock.isLocked('order:1', 1500), false, '过期后就不算锁着')
    same(lock.tryAcquire('order:1', 'client-b', 1000, 1500), true)
  })
  check('release 校验 owner：误删别人的锁返回 false', () => {
    const lock = new RedisLock()
    lock.tryAcquire('order:1', 'client-a', 3000, 0)
    same(lock.release('order:1', 'client-b', 100), false)
    same(lock.isLocked('order:1', 100), true, '别人的锁不能被删')
    same(lock.release('order:1', 'client-a', 100), true)
    same(lock.isLocked('order:1', 100), false)
  })
  check('重复 release：第二次返回 false（幂等释放）', () => {
    const lock = new RedisLock()
    lock.tryAcquire('k', 'a', 1000, 0)
    same(lock.release('k', 'a', 1), true)
    same(lock.release('k', 'a', 2), false)
  })
}`

const L3S2 = `{
  check('指数退避：100 → 200 → 400 → 800', () => {
    same([0, 1, 2, 3].map((a) => retryDelay(a, { baseMs: 100 })), [100, 200, 400, 800])
  })
  check('封顶：不会无限增长', () => {
    same(retryDelay(10, { baseMs: 100, capMs: 5000 }), 5000)
  })
  check('jitter 叠加在退避时间上（打散惊群）', () => {
    same(retryDelay(2, { baseMs: 100, jitter: 37 }), 437)
  })
  check('attempt 为 0 时只等一个 base', () => {
    same(retryDelay(0, { baseMs: 200 }), 200)
  })
}`

const L3S3 = `{
  check('首次消费：处理并记录', () => {
    const seen = new Set()
    let calls = 0
    const r = consumeOnce(seen, 'msg-1', () => { calls++; return 'ok' })
    same(r.duplicate, false)
    same(r.result, 'ok')
    same(calls, 1)
    same(seen.has('msg-1'), true)
  })
  check('重复消费：不再执行 handler', () => {
    const seen = new Set(['msg-1'])
    let calls = 0
    const r = consumeOnce(seen, 'msg-1', () => { calls++ })
    same(r.duplicate, true)
    same(calls, 0)
  })
  check('不同消息互不影响', () => {
    const seen = new Set()
    consumeOnce(seen, 'a', () => 1)
    same(consumeOnce(seen, 'b', () => 2).duplicate, false)
  })
  check('handler 抛错时消息不应被标记为已处理（可重试）', () => {
    const seen = new Set()
    let threw = false
    try { consumeOnce(seen, 'msg-x', () => { throw new Error('boom') }) } catch { threw = true }
    same(threw, true)
    same(seen.has('msg-x'), false, '失败的消息必须还能再消费')
  })
}`

/* ============================================================ 第 3 关 */
const LV3 = {
  id: 'lv3',
  title: '通信：Redis 锁、指数退避与幂等消费',
  emoji: '📮',
  xp: 55,
  goal: '实现三个分布式通信组件：Redis 分布式锁（SET NX EX 语义 + owner 校验 + 过期）、指数退避重试（retryDelay）、幂等消费（consumeOnce）。',
  why: '分布式系统的「小工具」最容易写错：锁没有 owner 校验会误删别人的锁、没有过期会死锁；重试没有退避会把下游打崩；消费没有幂等键会重复扣款。这三个函数是线上事故的高频来源。',
  nodes: ['be.micro.communication', 'be.micro.communication.id-lock'],
  thinking: [
    {
      title: 'SET NX EX 与 owner 校验',
      md: '`SET key value NX EX seconds` 是原子地「不存在才设置 + 带过期」。抢锁成功返回 OK，失败返回 nil。\n\n释放锁时如果直接 DEL，可能删掉别人的锁（自己的锁已过期、别人抢到了）。正确做法是 Lua 脚本「GET 比对 value 再 DEL」——value 就是 owner 标识。'
    },
    {
      title: '为什么需要 jitter',
      md: '纯指数退避会让所有失败客户端在同一时刻重试（惊群），把下游再打崩一次。\n\njitter 在退避时间上加随机扰动，把重试打散。本关把 jitter 作为参数注入，测试用固定值，线上用 random。'
    }
  ],
  prereq: [
    {
      title: 'Redis 锁的过期与续期',
      md: '锁必须带 TTL，否则客户端崩溃就死锁。但 TTL 太短，业务没跑完锁就没了——所以有「看门狗」续期（Redisson 默认 30s，每 10s 续一次）。\n\n这也是为什么 Redlock 争议大：时钟漂移、GC 停顿都可能让锁提前失效。'
    },
    {
      title: '幂等键的三种来源',
      md: '业务单号、请求 ID、消息 ID。消费端用 Set/数据库唯一键记录「已处理」，处理前先查。\n\n「先处理再记录」会重复处理——必须「先占位再处理」，占位与业务在同一个事务/原子操作里。'
    }
  ],
  api: [
    {
      name: 'RedisLock',
      sig: 'new RedisLock() / tryAcquire(key, owner, ttlMs, now) / release(key, owner, now) / isLocked(key, now)',
      args: 'owner 是客户端唯一标识；now 注入当前时间。',
      returns: 'tryAcquire 返回 boolean；release 成功 true，owner 不符或过期返回 false。',
      example: "lock.tryAcquire('order:1', 'client-a', 3000, 0)  // → true"
    },
    {
      name: 'retryDelay',
      sig: 'retryDelay(attempt, { baseMs, capMs, jitter }) => number',
      args: 'attempt 从 0 开始；jitter 是额外扰动毫秒。',
      returns: 'min(capMs, baseMs * 2^attempt) + jitter。',
      example: 'retryDelay(2, { baseMs: 100, capMs: 10000 })  // → 400'
    },
    {
      name: 'consumeOnce',
      sig: 'consumeOnce(processed, msgId, handler) => { duplicate, result? }',
      args: 'processed 是已处理集合（Set）；handler(msgId) 是业务处理。',
      returns: '首次处理返回 duplicate=false；重复消息返回 duplicate=true 且不调 handler。',
      example: "consumeOnce(seen, 'msg-1', handler).duplicate  // → false"
    }
  ],
  usage: 'const lock = new RedisLock()\nif (lock.tryAcquire("order:" + id, clientId, 3000, Date.now())) {\n  try { doWork() } finally { lock.release("order:" + id, clientId, Date.now()) }\n}\n\nconst delay = retryDelay(attempt, { baseMs: 100, capMs: 10000, jitter: Math.random() * 100 })\n\nconst r = consumeOnce(seenIds, msg.id, handle)\nif (r.duplicate) return ack()',
  hints: [
    'tryAcquire：查 key，若存在且 expireAt > now → 失败；否则写入 {owner, expireAt: now+ttl} 并成功。',
    'release：key 不存在或已过期 → false；owner 不符 → false；否则删除。',
    'retryDelay：Math.min(capMs, baseMs * 2 ** attempt) + jitter。',
    'consumeOnce：先 has 判断，处理完再 add（顺序很关键）。'
  ],
  stages: [
    {
      n: 1,
      title: '先写 Redis 锁',
      think: '锁的三个语义：不存在才设置（NX）、带过期（EX）、释放要校验 owner。第三条是「误删别人锁」的唯一防线。',
      hint: 'tryAcquire 查过期；release 先看 owner 再看过期；过期条目视为不存在。',
      code: `class RedisLock {
  constructor() {
    this.store = new Map()
  }
  tryAcquire(key, owner, ttlMs, now) {
    const cur = this.store.get(key)
    if (cur && cur.expireAt > now) return false
    this.store.set(key, { owner, expireAt: now + ttlMs })
    return true
  }
  release(key, owner, now) {
    const cur = this.store.get(key)
    if (!cur) return false
    if (cur.expireAt <= now) {
      this.store.delete(key)
      return false
    }
    if (cur.owner !== owner) return false
    this.store.delete(key)
    return true
  }
  isLocked(key, now) {
    const cur = this.store.get(key)
    return Boolean(cur && cur.expireAt > now)
  }
}`,
      test: L3S1,
      diag: [
        'tryAcquire 没有检查已有锁，总是返回 true。',
        '没有写 expireAt，锁永不过期。',
        'release 没有校验 owner，会误删别人的锁。',
        '过期锁被当成了持有中（isLocked 永远 true）。',
        'release 删掉过期锁时返回了 true（语义应为 false）。'
      ]
    },
    {
      n: 2,
      title: '再写指数退避',
      think: '退避公式本身简单，但封顶与 jitter 是工程必需：不封顶会等到天荒地老，不加 jitter 会惊群。',
      hint: 'raw = baseMs * 2 ** attempt；min(raw, capMs) + jitter。',
      code: `class RedisLock {
  constructor() {
    this.store = new Map()
  }
  tryAcquire(key, owner, ttlMs, now) {
    const cur = this.store.get(key)
    if (cur && cur.expireAt > now) return false
    this.store.set(key, { owner, expireAt: now + ttlMs })
    return true
  }
  release(key, owner, now) {
    const cur = this.store.get(key)
    if (!cur) return false
    if (cur.expireAt <= now) {
      this.store.delete(key)
      return false
    }
    if (cur.owner !== owner) return false
    this.store.delete(key)
    return true
  }
  isLocked(key, now) {
    const cur = this.store.get(key)
    return Boolean(cur && cur.expireAt > now)
  }
}

function retryDelay(attempt, opts = {}) {
  const { baseMs = 100, capMs = 10000, jitter = 0 } = opts
  return Math.min(capMs, baseMs * 2 ** attempt) + jitter
}`,
      test: L3S2,
      diag: [
        '用了 baseMs * attempt（线性）而不是 2 ** attempt（指数）。',
        '没有封顶，attempt 大时返回巨大值。',
        'jitter 没有加到结果上。',
        'attempt 从 1 开始算（第一次重试就是 2 倍）。'
      ]
    },
    {
      n: 3,
      title: '最后写幂等消费',
      think: '幂等的关键顺序：先查是否处理过，处理完再记录。反过来（先记录再处理）会丢消息，先处理后记录会重复处理。',
      hint: 'if (processed.has(id)) return {duplicate:true}；否则 add(id)，执行 handler，返回结果。',
      code: `class RedisLock {
  constructor() {
    this.store = new Map()
  }
  tryAcquire(key, owner, ttlMs, now) {
    const cur = this.store.get(key)
    if (cur && cur.expireAt > now) return false
    this.store.set(key, { owner, expireAt: now + ttlMs })
    return true
  }
  release(key, owner, now) {
    const cur = this.store.get(key)
    if (!cur) return false
    if (cur.expireAt <= now) {
      this.store.delete(key)
      return false
    }
    if (cur.owner !== owner) return false
    this.store.delete(key)
    return true
  }
  isLocked(key, now) {
    const cur = this.store.get(key)
    return Boolean(cur && cur.expireAt > now)
  }
}

function retryDelay(attempt, opts = {}) {
  const { baseMs = 100, capMs = 10000, jitter = 0 } = opts
  return Math.min(capMs, baseMs * 2 ** attempt) + jitter
}

function consumeOnce(processed, msgId, handler) {
  if (processed.has(msgId)) return { duplicate: true }
  const result = handler(msgId)
  processed.add(msgId)
  return { duplicate: false, result }
}`,
      test: L3S3,
      diag: [
        '没有 is/has 判断，重复消息被处理两次。',
        '顺序写反了：先 add 再调 handler，处理失败时消息被误标为已处理。',
        'duplicate 分支仍然调用了 handler。',
        'processed 不是 Set（用数组 includes 正确但 add 不生效）。'
      ]
    }
  ],
  skeleton: `class RedisLock { constructor() { throw new Error('还没实现') } }
function retryDelay(attempt, opts) { throw new Error('还没实现') }
function consumeOnce(processed, msgId, handler) { throw new Error('还没实现') }`,
  solution: `class RedisLock {
  constructor() {
    this.store = new Map()
  }
  tryAcquire(key, owner, ttlMs, now) {
    const cur = this.store.get(key)
    if (cur && cur.expireAt > now) return false
    this.store.set(key, { owner, expireAt: now + ttlMs })
    return true
  }
  release(key, owner, now) {
    const cur = this.store.get(key)
    if (!cur) return false
    if (cur.expireAt <= now) {
      this.store.delete(key)
      return false
    }
    if (cur.owner !== owner) return false
    this.store.delete(key)
    return true
  }
  isLocked(key, now) {
    const cur = this.store.get(key)
    return Boolean(cur && cur.expireAt > now)
  }
}

function retryDelay(attempt, opts = {}) {
  const { baseMs = 100, capMs = 10000, jitter = 0 } = opts
  return Math.min(capMs, baseMs * 2 ** attempt) + jitter
}

function consumeOnce(processed, msgId, handler) {
  if (processed.has(msgId)) return { duplicate: true }
  const result = handler(msgId)
  processed.add(msgId)
  return { duplicate: false, result }
}`,
  finalCode: `class RedisLock {
  constructor() {
    this.store = new Map()
  }
  tryAcquire(key, owner, ttlMs, now) {
    const cur = this.store.get(key)
    if (cur && cur.expireAt > now) return false
    this.store.set(key, { owner, expireAt: now + ttlMs })
    return true
  }
  release(key, owner, now) {
    const cur = this.store.get(key)
    if (!cur) return false
    if (cur.expireAt <= now) {
      this.store.delete(key)
      return false
    }
    if (cur.owner !== owner) return false
    this.store.delete(key)
    return true
  }
  isLocked(key, now) {
    const cur = this.store.get(key)
    return Boolean(cur && cur.expireAt > now)
  }
}

function retryDelay(attempt, opts = {}) {
  const { baseMs = 100, capMs = 10000, jitter = 0 } = opts
  return Math.min(capMs, baseMs * 2 ** attempt) + jitter
}

function consumeOnce(processed, msgId, handler) {
  if (processed.has(msgId)) return { duplicate: true }
  const result = handler(msgId)
  processed.add(msgId)
  return { duplicate: false, result }
}`,
  tests: `${L3S1}\n${L3S2}\n${L3S3}`
}

export default {
  id: 'be-micro',
  version: 3,
  domain: 'be',
  cumulative: false,
  title: 'JVM、微服务治理与分布式通信',
  emoji: '🛡️',
  tagline: '3 关：双亲委派与 GC、网关/熔断/Saga、Redis 锁/退避/幂等。',
  stack: ['Java', '微服务', '分布式'],
  intro: 'JVM 与微服务是后端面试的两条主线，但它们共同的问题是「边界条件说不清」：类由谁加载、谁是垃圾、熔断器什么时候开合、锁什么时候过期、重试该等多久、消息会不会重复。这个项目把这些边界全部写成可跑的模拟，每一条都能被测试验证。',
  outcome: '你能讲清双亲委派与打破它的场景、用可达性分析判断泄漏；写出网关路由与熔断状态机、Saga 补偿；实现带 owner 校验的分布式锁、指数退避与幂等消费。',
  levels: [LV1, LV2, LV3]
}