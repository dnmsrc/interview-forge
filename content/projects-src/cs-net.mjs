/**
 * cs-net —— 网络与可观测性四关：SLO 预算与发布、协议栈总览、可靠传输与缓存、DNS 解析。
 * 分配见 data/plans/cs-net.json；判题沙箱无网络/无时钟，所以全部是可算的纯函数，
 * 时间一律由调用方传入（now / rttMs / age）。
 */

/* ============================================================ 第 1 关测试 */
const L1S1 = `{
  check('99.9% SLO、10 万请求 → 允许 100 次失败', () => {
    const r = errorBudget({ slo: 0.999, requests: 100000, bad: 0 })
    same(r.allowed, 100)
    same(r.remaining, 100)
  })
  check('坏 40 个：还剩 60 个预算，未耗尽', () => {
    const r = errorBudget({ slo: 0.999, requests: 100000, bad: 40 })
    same(r.remaining, 60)
    same(r.exhausted, false)
    same(r.burnRate, 0.4)
  })
  check('坏满 100 个：预算归零并标记耗尽', () => {
    const r = errorBudget({ slo: 0.999, requests: 100000, bad: 100 })
    same(r.remaining, 0)
    same(r.exhausted, true, '预算用满必须停下来，而不是等 SLO 真的破了')
  })
  check('SLO=100% 时预算为 0：零错误不算耗尽，一个错误就算', () => {
    same(errorBudget({ slo: 1, requests: 1000, bad: 0 }).exhausted, false)
    same(errorBudget({ slo: 1, requests: 1000, bad: 1 }).exhausted, true)
    same(errorBudget({ slo: 1, requests: 1000, bad: 0 }).burnRate, null)
  })
  check('bad 超过 requests 或 slo 越界时抛错，不返回负数预算', () => {
    throws(() => errorBudget({ slo: 0.999, requests: 100, bad: 101 }))
    throws(() => errorBudget({ slo: 1.5, requests: 100, bad: 0 }))
    throws(() => errorBudget({ slo: 0, requests: 100, bad: 0 }))
  })
}`

const L1S2 = `{
  check('counter / gauge / histogram 都归指标', () => {
    same(classifySignal({ type: 'counter' }), 'metrics')
    same(classifySignal({ type: 'gauge' }), 'metrics')
    same(classifySignal({ type: 'histogram' }), 'metrics')
  })
  check('span 归链路追踪，event 归日志', () => {
    same(classifySignal({ type: 'span' }), 'traces')
    same(classifySignal({ type: 'event' }), 'logs')
  })
  check('不认识的信号类型返回 unknown，不瞎猜', () => {
    same(classifySignal({ type: 'profile' }), 'unknown')
    same(classifySignal({}), 'unknown')
    same(classifySignal(null), 'unknown')
  })
  check('字段齐全的结构化日志没有缺失', () => {
    same(missingLogFields({ ts: 1, level: 'error', service: 'api', traceId: 'a1', msg: 'boom' }), [])
  })
  check('缺 traceId、msg 只有空白都算缺失', () => {
    same(missingLogFields({ ts: 1, level: 'error', service: 'api', msg: '   ' }), ['traceId', 'msg'])
  })
}`

const L1S3 = `{
  check('高风险变更先金丝雀 5%', () => {
    const r = pickRelease({ risk: 'high' })
    same(r.strategy, 'canary')
    same(r.weight, 0.05)
  })
  check('需要秒级回滚 → 蓝绿', () => {
    same(pickRelease({ risk: 'low', needInstantRollback: true }).strategy, 'blue-green')
  })
  check('常规发布 → 按批滚动', () => {
    same(pickRelease({ risk: 'low' }).strategy, 'rolling')
  })
  check('跨服务改表结构 → expand-contract，优先级高于金丝雀', () => {
    const r = pickRelease({ risk: 'high', schemaChange: true, crossService: true })
    same(r.strategy, 'expand-contract')
    same(r.weight, 0)
  })
  check('金丝雀实例数向上取整且至少 1 个', () => {
    same(canarySize(0.05, 20), 1)
    same(canarySize(0.1, 20), 2)
    same(canarySize(0.01, 3), 1)
  })
  check('Terraform 计划：delete+create 是替换而不是两个动作', () => {
    same(planAction([]), 'no-op')
    same(planAction(['update']), 'update')
    same(planAction(['delete', 'create']), 'replace')
    same(planAction(['delete']), 'destroy')
  })
}`

/* ============================================================ 第 1 关代码 */
const L1C1 = `function errorBudget(opts) {
  const slo = opts.slo
  const requests = opts.requests
  const bad = opts.bad
  if (!(slo > 0 && slo <= 1)) throw new Error('slo 必须在 (0,1] 之间')
  if (!(requests >= 0) || !(bad >= 0)) throw new Error('requests 和 bad 必须非负')
  if (bad > requests) throw new Error('bad 不能超过 requests')

  // 允许失败的请求数 = 总请求 × (1 - SLO)。0.999 → 千分之一
  const allowed = Math.round(requests * (1 - slo) * 1e6) / 1e6
  const remaining = Math.max(0, allowed - bad)
  // burnRate = 当前失败率 / 允许失败率：>1 表示正在超速消耗预算
  const burnRate = allowed === 0 ? null : Math.round((bad / allowed) * 1e4) / 1e4
  const exhausted = allowed === 0 ? bad > 0 : bad >= allowed

  return { allowed, remaining, burnRate, exhausted }
}`

const L1C2 = `${L1C1}

// 三支柱不是三个产品，而是三种信号形状：可聚合、可检索、可串成调用链
function classifySignal(sig) {
  const type = sig && sig.type
  if (type === 'counter' || type === 'gauge' || type === 'histogram') return 'metrics'
  if (type === 'span') return 'traces'
  if (type === 'event' || type === 'log') return 'logs'
  return 'unknown'
}

const LOG_REQUIRED = ['ts', 'level', 'service', 'traceId', 'msg']

function missingLogFields(entry) {
  const e = entry || {}
  return LOG_REQUIRED.filter(function (k) {
    const v = e[k]
    if (v === undefined || v === null) return true
    return String(v).trim() === ''   // 空串和纯空白都不算填了
  })
}`

const L1C3 = `${L1C2}

function pickRelease(req) {
  const r = req || {}
  // 跨服务改表结构：任何一次切流都可能读到旧结构，只能先扩后缩
  if (r.schemaChange && r.crossService) {
    return { strategy: 'expand-contract', weight: 0, reason: '先兼容新旧两版字段，等所有服务都升级完再删旧列' }
  }
  if (r.risk === 'high') {
    return { strategy: 'canary', weight: r.weight || 0.05, reason: '高风险变更先给一小撮流量，用错误预算当自动暂停阀' }
  }
  if (r.needInstantRollback) {
    return { strategy: 'blue-green', weight: 1, reason: '两套环境同时在线，回滚只是把流量切回旧组' }
  }
  return { strategy: 'rolling', weight: 1, reason: '常规发布按批滚动，控制在途容量即可' }
}

function canarySize(ratio, replicas) {
  return Math.max(1, Math.ceil(ratio * replicas))
}

function planAction(actions) {
  const seen = {}
  let n = 0
  for (const a of actions || []) {
    if (!seen[a]) { seen[a] = true; n++ }
  }
  const has = (x) => seen[x] === true
  if (n === 0) return 'no-op'
  if (has('create') && has('delete')) return 'replace'   // 先删后建：数据丢失风险最大的动作
  if (has('create') && n === 1) return 'create'
  if (has('update') && n === 1) return 'update'
  if (has('delete') && n === 1) return 'destroy'
  return 'mixed'
}`

/* ============================================================ 第 1 关 */
const LV1 = {
  id: 'lv1',
  title: 'SLO 预算与发布：把「几个九」算成能坏几次',
  emoji: '📉',
  xp: 45,
  goal: '实现 errorBudget：把 SLO 与请求量换算成允许失败数、剩余预算和燃尽率；实现 classifySignal / missingLogFields 判定三支柱与结构化日志必填字段；实现 pickRelease / canarySize / planAction 给出发布策略与 Terraform 变更动作。',
  why: '「我们的 SLO 是 99.9%」这句话在事故复盘里毫无约束力，除非有人把它换算成「这个月还能坏几次」。错误预算就是干这个的：它把可靠性从口号变成阀门——预算烧完就冻结发布。可观测性三支柱和发布策略是同一个主题的三面：日志、指标、链路决定你能不能看见异常，发布策略决定异常扩散得多快，Terraform 的 replace 决定你会不会顺手删库。',
  nodes: [
    'cs.devops.observ',
    'cs.devops.observ.alert-slo',
    'cs.devops.observ.three-pillars',
    'cs.devops.iac',
    'cs.devops.iac.release-strategy',
    'cs.devops.iac.terraform'
  ],
  thinking: [
    {
      title: '预算 = 请求数 × (1 - SLO)，燃尽率 = 实际失败率 / 允许失败率',
      md: '两个数字要分开算。**允许失败数**是绝对量：10 万请求 × 0.1% = 100 次。**燃尽率**是相对量：坏了 40 个就是 0.4 倍速烧预算，坏 200 个是 2 倍速。\n\n运维看绝对量决定「现在要不要停」，看燃尽率决定「多快会烧完」。单看任何一个都会误判：请求量翻十倍时 100 次预算只够撑 1 小时，而燃尽率还是 0.4。'
    },
    {
      title: '三支柱是三种信号形状，不是三个采购项',
      md: '指标是**可聚合的数字**（counter/gauge/histogram），适合算 SLO 和告警；日志是**离散事件**，适合定位到具体那一次失败；链路是**带父子关系的 span**，适合回答「慢在哪一跳」。\n\n常见错法是把日志当指标用（每请求打一条日志再聚合），或者链路里不塞 traceId 导致日志和 span 对不上。所以本关同时判定信号类型和日志字段：字段缺失的日志在多服务故障里等于没有。'
    },
    {
      title: '发布策略的选择点只有一个：出问题后多久能回滚',
      md: '滚动发布最快但回滚要再滚一遍；蓝绿要双倍资源但切流即回滚；金丝雀慢，但能把影响面锁在 5% 流量里；改表结构的跨服务发布不能靠回滚，只能靠 expand-contract（先加新列双写，再切读，最后删旧列）。\n\n面试里问「你们怎么发布」时，答「我们滚动发布」是没信息的；答「因为这个变更跨了服务边界且不可回滚，所以走 expand-contract，回滚点在读路径切换之前」才是。'
    }
  ],
  prereq: [
    {
      title: 'SLI / SLO / SLA 的分工',
      md: 'SLI 是**测量值**（成功率、p99 延迟、错误率），SLO 是**目标值**（99.9% 成功），SLA 是**合同**（达不到就赔钱）。\n\n工程上只对 SLO 做预算，因为 SLA 是法务条款。SLO 必须由 SLI 算出，所以要先定义清楚「什么算一次好请求」：5xx 算坏，4xx 一般不算（客户端错不该扣服务端预算），超时算坏。定义不清楚，预算就是一个随便填的数字。'
    },
    {
      title: '结构化日志为什么必须带 traceId',
      md: '一次请求跨三个服务、每个服务打五行日志，没有 traceId 就只能按时间戳猜——事故时猜错一次就是半小时。\n\ntraceId 让日志和链路 span 能对上：先看链路哪一跳慢，再拿那一跳的 traceId 去日志里捞上下文。此外 `service`、`level`、`ts`、`msg` 是检索的四根支柱：没有 service 无法按服务过滤，没有 level 无法只看 error。'
    }
  ],
  api: [
    {
      name: 'errorBudget',
      sig: 'errorBudget({ slo, requests, bad }) => { allowed, remaining, burnRate, exhausted }',
      args: 'slo ∈ (0,1]；requests ≥ 0 是统计窗口内的总请求数；bad 是其中的失败数。',
      returns: 'allowed 允许失败数（保留 6 位小数以免浮点误差）；remaining 剩余；burnRate 燃尽倍数（预算为 0 时 null）；exhausted 预算是否用尽。slo 越界、bad > requests 抛错。',
      example: 'errorBudget({ slo: 0.999, requests: 100000, bad: 40 })\n// { allowed: 100, remaining: 60, burnRate: 0.4, exhausted: false }'
    },
    {
      name: 'classifySignal / missingLogFields',
      sig: 'classifySignal(sig) => "metrics" | "traces" | "logs" | "unknown"；missingLogFields(entry) => string[]',
      args: 'sig.type 是信号类型；entry 是一条结构化日志对象。',
      returns: 'classifySignal 按 type 归类；missingLogFields 返回缺失字段名数组，顺序固定为 ts/level/service/traceId/msg，空白字符串视为缺失。',
      example: 'classifySignal({ type: "span" })   // "traces"\nmissingLogFields({ ts: 1, level: "error", service: "api", msg: " " })   // ["traceId", "msg"]'
    },
    {
      name: 'pickRelease / canarySize / planAction',
      sig: 'pickRelease(req) => { strategy, weight, reason }；canarySize(ratio, replicas) => number；planAction(actions) => string',
      args: 'req: { risk, schemaChange?, crossService?, needInstantRollback?, weight? }；actions 是 Terraform plan 的动作数组（去重后判断）。',
      returns: '策略取 canary / blue-green / rolling / expand-contract；planAction 取 no-op / create / update / destroy / replace / mixed。',
      example: 'pickRelease({ risk: "high" }).weight   // 0.05\ncanarySize(0.05, 20)   // 1\nplanAction(["delete", "create"])   // "replace"'
    }
  ],
  usage: '// 每个发布窗口跑一次：预算不够就自动冻结发布\nconst r = errorBudget({ slo: 0.999, requests: 100000, bad: 40 })\nif (r.exhausted || r.burnRate > 2) {\n  console.warn(`错误预算只剩 ${r.remaining}，冻结本窗口发布`)\n}\n// 日志入库前先补齐必填字段，缺 traceId 的直接打回\nconst miss = missingLogFields(entry)\nif (miss.length) throw new Error(`日志缺字段：${miss.join(",")}`)',
  hints: [
    '第 1 步：allowed = requests × (1 - slo)；注意 0.999 在浮点下算出来是 0.0010000000000000009，先 round 再比较。',
    '第 2 步：classifySignal 只看 type 的取值；missingLogFields 用固定字段表 filter，别用 Object.keys 反查（那样永远不缺字段）。',
    '第 3 步：pickRelease 的判断顺序是 expand-contract > 高风险 > 秒级回滚 > 滚动；planAction 先用集合去重再匹配组合。'
  ],
  concepts: [
    {
      title: '99.99% 比 99.9% 贵 10 倍',
      md: '99.9% 折算下来每月允许约 43 分钟不可用，99.99% 只有 4 分钟——差的这 39 分钟要靠多副本、自动故障转移、灰度验证一起换。\n\n所以 SLO 不是越高越好，而是「用户感知不到的那条线」。定得比实际能力高，团队就会为了保预算而拒绝发布，最后 SLO 变成政治工具。'
    },
    {
      title: 'Terraform 的 replace 为什么最危险',
      md: 'plan 里出现 `-/+` 意味着资源要销毁重建：数据库实例重建会丢数据，负载均衡重建会换 IP，K8s 的 PV 重建可能直接丢卷。\n\n出现 replace 通常不是 provider 的错，而是你改了不可变字段（比如实例类型、子网、名字）。正确做法是把这种字段拆到独立资源，或者用 `create_before_destroy` 加生命周期钩子。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '把 SLO 换算成错误预算',
      think: '先只做这一件事：给定 SLO 和请求量，算出允许坏几次、还剩多少。为什么先做它？因为后面所有发布决策都读这个数字，先把「预算」这个标尺立住，再谈怎么用它。',
      hint: 'allowed = round(requests × (1 - slo))；remaining = max(0, allowed - bad)；exhausted 要单独处理 allowed 为 0 的边界。',
      code: L1C1,
      test: L1S1,
      diag: [
        'allowed 用 requests × slo 算了（算成了「允许成功数」，正好反过来）。',
        'remaining 没有取 max(0)，坏超了以后返回负数。',
        'exhausted 用 bad > allowed，坏满 100 个时仍判未耗尽。',
        'allowed 为 0 时把 0 个错误也判成耗尽，或者 burnRate 除了 0。',
        '没有校验 bad > requests / slo 越界，脏数据被算成了预算。'
      ]
    },
    {
      n: 2,
      title: '三支柱归类与日志必填字段',
      think: '预算告诉你「坏了多少」，但定位要靠信号。这一步把「这条信号属于哪一支柱」和「这条日志缺什么」变成两个可判定的函数——它们是后面告警路由和日志打回规则的地基。',
      hint: 'classifySignal 用 if 分支匹配 type；missingLogFields 用固定字段数组 filter，空白字符串也要算缺失。',
      code: L1C2,
      test: L1S2,
      diag: [
        '只认了 counter，gauge 和 histogram 落到 unknown。',
        '把 span 归到了 logs，或者把 event 归到了 metrics。',
        '未知类型抛错或返回 null，调用方没法做兜底路由。',
        '必填字段表漏了 traceId，或者顺序和契约不一致。',
        '只判了 undefined，没判空串和纯空白字符串。'
      ]
    },
    {
      n: 3,
      title: '发布策略与 Terraform 变更动作',
      think: '有了预算和三支柱，最后一步是「怎么把变更放出去」。策略选择本质是回滚成本的排序；planAction 则要在 plan 阶段就拦住最危险的组合。',
      hint: 'pickRelease 按 expand-contract → 高风险 → 秒级回滚 → 滚动的顺序判；planAction 先建集合，再判 create+delete 组合。',
      code: L1C3,
      test: L1S3,
      diag: [
        '先判 needInstantRollback，高风险变更被给了蓝绿而不是金丝雀。',
        '蓝绿分支没有判 needInstantRollback 就直接走到了滚动。',
        '默认分支返回 undefined，缺少 risk 字段时策略丢失。',
        'expand-contract 排在 risk 之后，跨服务改表被误判成金丝雀。',
        'canarySize 用了 Math.round 或 floor，5% × 20 算成 0 个实例。',
        'planAction 把 delete+create 当成两次独立动作，没识别出 replace。'
      ]
    }
  ],
  skeleton: `function errorBudget(opts) {
  // TODO: 用 SLO 与请求量算允许失败数 / 剩余预算 / 燃尽率
  throw new Error('errorBudget 还没实现')
}

function classifySignal(sig) {
  // TODO: 按 sig.type 归到 metrics / logs / traces / unknown
  throw new Error('classifySignal 还没实现')
}

function missingLogFields(entry) {
  // TODO: 用固定必填字段表找出缺失项
  throw new Error('missingLogFields 还没实现')
}

function pickRelease(req) {
  // TODO: 按回滚成本排序给出发布策略
  throw new Error('pickRelease 还没实现')
}

function canarySize(ratio, replicas) {
  // TODO: 按比例向上取整，至少 1 个实例
  throw new Error('canarySize 还没实现')
}

function planAction(actions) {
  // TODO: 去重后识别 create / update / destroy / replace
  throw new Error('planAction 还没实现')
}`,
  solution: L1C3,
  finalCode: L1C3,
  tests: `${L1S1}\n${L1S2}\n${L1S3}`
}

/* ============================================================ 第 2 关测试 */
const L2S1 = `{
  check('以太网 + IPv4 + TCP：54 字节首部，1000 字节负载效率 0.9488', () => {
    const r = headerOverhead({ payload: 1000, layers: ['eth', 'ip', 'tcp'] })
    same(r.overhead, 54)
    same(r.total, 1054)
    same(r.efficiency, 0.9488)
  })
  check('UDP 比 TCP 少 12 字节首部', () => {
    same(headerOverhead({ payload: 0, layers: ['udp'] }).overhead, 8)
    same(headerOverhead({ payload: 100, layers: ['eth', 'ip', 'udp'] }).total, 142)
  })
  check('加一层 TLS 记录头再吃掉 5 字节，效率下降', () => {
    const a = headerOverhead({ payload: 1000, layers: ['eth', 'ip', 'tcp'] })
    const b = headerOverhead({ payload: 1000, layers: ['eth', 'ip', 'tcp', 'tls'] })
    same(b.overhead - a.overhead, 5)
    ok(b.efficiency < a.efficiency, '首部更多，有效载荷占比必须更低')
  })
  check('payload 为 0 时效率记 0，不是 NaN', () => {
    same(headerOverhead({ payload: 0, layers: ['eth'] }).efficiency, 0)
    same(headerOverhead({ payload: 0, layers: [] }).total, 0)
  })
  check('不认识的层名直接抛错，别静默算错', () => {
    throws(() => headerOverhead({ payload: 10, layers: ['sctp'] }))
    throws(() => headerOverhead({ payload: -1, layers: ['eth'] }))
  })
}`

const L2S2 = `{
  check('新建 TCP 连接要 1 个 RTT，复用连接 0 个', () => {
    same(tcpConnectRtt({ reuse: false }), 1)
    same(tcpConnectRtt({ reuse: true }), 0)
  })
  check('HTTP/1.1 + keep-alive：建连 1 次 + 10 次串行往返 = 11 RTT', () => {
    const r = httpRequestCost({ version: 'http1.1', requests: 10, rttMs: 100, keepAlive: true })
    same(r.rounds, 11)
    same(r.ms, 1100)
  })
  check('没有 keep-alive 时每个请求都要重新握手', () => {
    same(httpRequestCost({ version: 'http1.1', requests: 10, rttMs: 100, keepAlive: false }).rounds, 20)
  })
  check('HTTP/2 多路复用：10 个请求只多 1 个往返', () => {
    const r = httpRequestCost({ version: 'h2', requests: 10, rttMs: 50, keepAlive: true })
    same(r.rounds, 2)
    same(r.ms, 100)
  })
  check('请求数为 0 时只剩建连成本', () => {
    same(httpRequestCost({ version: 'http1.1', requests: 0, rttMs: 10, keepAlive: true }).rounds, 1)
  })
}`

const L2S3 = `{
  check('慢启动每轮翻倍：1 → 2 → 4 → 8', () => {
    same(congestionWindow({ rounds: 3, ssthresh: 16 }), [1, 2, 4, 8])
  })
  check('到达 ssthresh 后转拥塞避免，每轮只 +1', () => {
    same(congestionWindow({ rounds: 4, ssthresh: 8 }), [1, 2, 4, 8, 9])
  })
  check('丢包轮窗口从 4 减半回 2，之后继续增长', () => {
    same(congestionWindow({ rounds: 3, ssthresh: 16, lossRound: 2 }), [1, 2, 2, 4], '第 2 轮涨到 4 后被打回 2')
  })
  check('rounds 为 0 时只返回初始窗口', () => {
    same(congestionWindow({ rounds: 0 }), [1])
    same(congestionWindow({ rounds: 0, init: 10 }), [10])
  })
  check('丢包减半不低于 2，避免窗口塌到 1', () => {
    same(congestionWindow({ rounds: 1, ssthresh: 2, lossRound: 1 }), [1, 2])
  })
}`

/* ============================================================ 第 2 关代码 */
const L2C1 = `const HEADERS = { eth: 14, ip: 20, ipv6: 40, tcp: 20, udp: 8, tls: 5, quic: 0 }

function headerOverhead(req) {
  const payload = req.payload
  if (!(payload >= 0)) throw new Error('payload 必须是非负数')
  let overhead = 0
  for (const layer of req.layers || []) {
    const h = HEADERS[layer]
    if (h === undefined) throw new Error('未知协议层: ' + layer)
    overhead += h
  }
  const total = payload + overhead
  return {
    payload,
    overhead,
    total,
    // 有效载荷占比：payload / 总字节。0 字节时约定为 0，避免 0/0 出 NaN
    efficiency: total === 0 ? 0 : Math.round((payload / total) * 10000) / 10000
  }
}`

const L2C2 = `${L2C1}

function tcpConnectRtt(req) {
  // 三次握手 = 1 个 RTT：SYN → SYN+ACK → ACK，最后一段不带数据
  return req && req.reuse ? 0 : 1
}

function httpRequestCost(req) {
  const requests = req.requests || 0
  const rttMs = req.rttMs || 0
  const keepAlive = req.keepAlive !== false
  let rounds
  if (!keepAlive) {
    // 每个请求都新建连接：1 RTT 握手 + 1 RTT 请求 = 2 RTT
    rounds = requests * 2
  } else if (req.version === 'h2' || req.version === 'h3') {
    // 多路复用：一条连接上所有流共享一次往返
    rounds = requests === 0 ? 1 : 2
  } else {
    // HTTP/1.1 串行：建连 1 次，之后每个请求各占一次往返
    rounds = 1 + requests
  }
  return { rounds, ms: rounds * rttMs }
}`

const L2C3 = `${L2C2}

function congestionWindow(req) {
  const r = req || {}
  const init = r.init === undefined ? 1 : r.init
  const ssthresh = r.ssthresh === undefined ? 16 : r.ssthresh
  const rounds = r.rounds === undefined ? 0 : r.rounds
  const lossRound = r.lossRound === undefined ? -1 : r.lossRound

  const out = [init]
  let cwnd = init
  for (let i = 1; i <= rounds; i++) {
    if (cwnd < ssthresh) {
      cwnd = cwnd * 2        // 慢启动：指数增长
    } else {
      cwnd = cwnd + 1        // 拥塞避免：每轮 +1（大约每 RTT 加一个 MSS）
    }
    if (i === lossRound) {
      // 这一轮里发生三次重复 ACK：先按增长后的窗口算，再减半
      cwnd = Math.max(2, Math.floor(cwnd / 2))
    }
    out.push(cwnd)
  }
  return out
}`

/* ============================================================ 第 2 关 */
const LV2 = {
  id: 'lv2',
  title: '协议栈总览：每层吃掉多少字节、要等几个 RTT',
  emoji: '🧱',
  xp: 50,
  goal: '实现 headerOverhead 计算协议栈逐层首部开销与载荷效率，tcpConnectRtt / httpRequestCost 计算建连与请求的 RTT 成本，congestionWindow 模拟慢启动、拥塞避免与丢包减半。',
  why: '「网络慢」是面试里最容易被含糊过去的四个字。慢在哪？可以是首部开销吃掉有效载荷、可以是每个请求多等一个 RTT、也可以是拥塞窗口还没长起来。这三件事都能算成数字：54 字节首部、20 个 RTT、窗口从 1 涨到 8 需要 3 轮。算过之后，你才知道该优化 MTU、该开 keep-alive、还是该减小请求数。',
  nodes: [
    'cs.net.tcpip',
    'cs.net.http',
    'cs.net.dns',
    'cs.net.tcpip.congestion',
    'cs.net.tcpip.handshake',
    'cs.net.tcpip.layering'
  ],
  thinking: [
    {
      title: '分层是抽象，首部是账单',
      md: '每一层都往包里塞自己的元数据：以太网 14 字节（MAC）、IPv4 20 字节、TCP 20 字节、TLS 记录头 5 字节。应用看到的 1000 字节，在链路上是 1054 字节。\n\n小包场景这个比例会失控：发 10 字节的 IoT 心跳，实际要占 74 字节（含以太网），效率只有 13%。这就是为什么协议设计要尽量合并小包（Nagle、批处理），也是为什么 MTU 是 1500 而不是随便设。'
    },
    {
      title: 'RTT 是网络里真正的货币',
      md: '带宽可以加钱买，RTT 主要由物理距离和协议往返次数决定。所以协议演进几乎都在减少 RTT：HTTP/1.1 的 keep-alive 省掉重复握手，HTTP/2 的多路复用把 N 次串行往返压成 1 次，TLS 1.3 把握手从 2 RTT 降到 1 RTT，QUIC 把传输握手和 TLS 合并。\n\n注意一个反直觉点：没有 keep-alive 时，10 个请求要 20 个 RTT（每次 1 握手 + 1 请求），而不是 11 个——因为每个连接都是新的。'
    },
    {
      title: '拥塞窗口：慢启动不慢，是「指数试探」',
      md: '初始窗口 1 个 MSS，每收到一个 ACK 窗口翻倍，3 轮就到 8。一旦超过 ssthresh 就转拥塞避免（每轮 +1），因为再翻倍就会把链路打爆。\n\n丢包时窗口减半（不是归零），这是「乘性减、加性增」的 AIMD：多条流共享瓶颈时，减半让出空间、+1 慢慢试探，最终收敛到公平。'
    }
  ],
  prereq: [
    {
      title: '一次 HTTP 请求到底经过哪几层',
      md: '应用层 HTTP → 传输层 TCP（分段、重传、流量控制）→ 网络层 IP（寻址、分片）→ 链路层以太网（MAC、帧校验）。\n\n每层加自己的首部、解包时再剥掉。所以「抓包看到的包大小」和「应用写出去的字节数」永远不相等；tcpdump 里的 length 是链路层载荷，Wireshark 里看到的 HTTP 长度才是应用层视角。'
    },
    {
      title: 'RTT 与带宽的乘积决定「管道粗细」',
      md: '带宽时延积 BDP = 带宽 × RTT，指的是「链路上同时在途的字节数」。100Mbps × 100ms = 1.25MB。\n\n如果接收窗口小于 BDP，发送方就会停等，吞吐被窗口而不是带宽限制。这正是长肥管道（long fat network）上单流跑不满带宽的原因，也是窗口缩放选项（TCP window scale）存在的原因。'
    }
  ],
  api: [
    {
      name: 'headerOverhead',
      sig: 'headerOverhead({ payload, layers }) => { payload, overhead, total, efficiency }',
      args: 'payload 是应用层字节数（≥0）；layers 是从外到内的层名数组，支持 eth/ip/ipv6/tcp/udp/tls/quic。',
      returns: 'overhead 首部总字节；total 链路上的总字节；efficiency = payload/total（4 位小数，payload 为 0 时约定 0）。未知层名或负 payload 抛错。',
      example: 'headerOverhead({ payload: 1000, layers: ["eth", "ip", "tcp"] })\n// { payload: 1000, overhead: 54, total: 1054, efficiency: 0.9488 }'
    },
    {
      name: 'tcpConnectRtt / httpRequestCost',
      sig: 'tcpConnectRtt({ reuse }) => number；httpRequestCost({ version, requests, rttMs, keepAlive }) => { rounds, ms }',
      args: 'reuse 表示复用已有连接；version 取 http1.1 / h2 / h3；keepAlive 默认 true。',
      returns: 'tcpConnectRtt 新建连接 1、复用 0；httpRequestCost 返回总往返次数与毫秒数。',
      example: 'httpRequestCost({ version: "http1.1", requests: 10, rttMs: 100, keepAlive: true })\n// { rounds: 11, ms: 1100 }'
    },
    {
      name: 'congestionWindow',
      sig: 'congestionWindow({ rounds, init?, ssthresh?, lossRound? }) => number[]',
      args: 'rounds 是模拟轮数；init 初始窗口（默认 1）；ssthresh 慢启动阈值（默认 16）；lossRound 在第几轮发生丢包（默认不丢）。',
      returns: '长度 rounds+1 的数组，第 0 项是初始窗口，之后每项是该轮结束后的 cwnd。',
      example: 'congestionWindow({ rounds: 3, ssthresh: 16 })   // [1, 2, 4, 8]\ncongestionWindow({ rounds: 3, ssthresh: 16, lossRound: 2 })   // [1, 2, 2, 4]'
    }
  ],
  usage: '// 估算小包服务的链路成本：\nconst wire = headerOverhead({ payload: 64, layers: ["eth", "ip", "tcp"] })\nconsole.log(`64 字节心跳实际占 ${wire.total} 字节，效率 ${wire.efficiency}`)\n// 估算首屏时间：\nconst cost = httpRequestCost({ version: "h2", requests: 30, rttMs: 40, keepAlive: true })\n// 40ms RTT 下，h2 首屏只需 2 个往返 = 80ms；http1.1 串行要 31 个往返 = 1240ms',
  hints: [
    '第 1 步：先建一张层名到字节数的表，遍历求和；效率算完 round 到 4 位，payload 为 0 时直接给 0。',
    '第 2 步：先算建连（0 或 1 个 RTT），再按 keepAlive / 版本决定请求部分：无 keepAlive 是 2× 请求数，h2 是固定 1 个。',
    '第 3 步：循环每轮先判丢包轮（减半），否则判 cwnd < ssthresh（翻倍）或 +1；记得把初始窗口放进数组第一个。'
  ],
  concepts: [
    {
      title: '为什么 MTU 是 1500',
      md: '以太网的 MTU 1500 是历史与成本的折中：更大的帧意味着更长的占用信道时间，一个比特错误就要重传整帧；更小则首部占比过高、中断更频繁。\n\nIPv6 不再做路由器分片，路径 MTU 发现（PMTUD）变得关键：ICMP 被防火墙挡住时会出现「小包能通、大包黑洞」，这也是隧道场景最常见的故障之一。'
    },
    {
      title: 'HTTP/2 的一个队头阻塞还没解决',
      md: 'HTTP/2 解决了应用层的队头阻塞（多路复用），但 TCP 层的队头阻塞还在：一个包丢了，整条连接上所有流都要等重传。\n\nQUIC 把流拆到传输层，一个流丢包只影响自己——这是 HTTP/3 在高丢包网络（移动、弱网）上明显更快的原因，而不是因为它「更新」。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '逐层首部开销与载荷效率',
      think: '先建立「字节账本」：应用写多少、链路上占多少。这个函数是所有容量估算的基础，也顺手把「未知层名」这种脏输入挡在门外。',
      hint: '维护一个层名到字节数的常量表；遍历 layers 累加，未知层抛错；efficiency 做除法前先判 total 是否为 0。',
      code: L2C1,
      test: L2S1,
      diag: [
        '首部字节表记错了（TCP 是 20、UDP 是 8，别混）。',
        'total 算成了 payload × (1 + overhead)，或者漏加 payload。',
        'efficiency 没做 4 位小数取整，浮点误差导致 0.948766… 对不上。',
        'payload 为 0 时直接做除法，返回 NaN 而不是 0。',
        '未知层名被静默跳过，少算字节还返回成功。'
      ]
    },
    {
      n: 2,
      title: '建连成本与请求往返',
      think: '有了单包成本，再看「一次请求要等几趟」。这里的关键区分是 keep-alive 与多路复用：前者省握手，后者省串行等待。',
      hint: '先判 keepAlive：false 时每个请求 2 个 RTT；true 时 h2/h3 固定 2 个，http1.1 是 1 + 请求数。',
      code: L2C2,
      test: L2S2,
      diag: [
        'tcpConnectRtt 把复用连接也算成 1，重复计费。',
        '没有 keep-alive 时仍按 1 + N 算，漏了每请求重新握手。',
        'h2 按 http1.1 的公式算了，多路复用白讲。',
        'ms 忘了乘 rttMs，只返回了轮数。',
        'requests 为 0 时返回 0 个 RTT，但建连本身要 1 个。'
      ]
    },
    {
      n: 3,
      title: '拥塞窗口的慢启动与 AIMD',
      think: '最后一步把「管道能塞多少」算出来。慢启动、拥塞避免、丢包减半是三个状态，用两个阈值判断就能模拟——这也是面试里手推 cwnd 曲线的标准问法。',
      hint: '循环每轮：先按 cwnd < ssthresh 翻倍、否则 +1；若这一轮是 lossRound，再把增长后的窗口减半（下限 2）。',
      code: L2C3,
      test: L2S3,
      diag: [
        '慢启动用 +1 增长，退化成拥塞避免，3 轮只到 4。',
        '到达 ssthresh 后仍继续翻倍，窗口指数爆炸。',
        '丢包减半用了 Math.round，奇数窗口算出小数。',
        '丢包判断放在增长之前，窗口在 2 时减半被下限吃掉，下一轮又直接翻倍。',
        '数组第 0 项漏了 init，长度少一轮；减半下限没兜住 1。'
      ]
    }
  ],
  skeleton: `function headerOverhead(req) {
  // TODO: 维护层名到首部字节的表，累加后算效率
  throw new Error('headerOverhead 还没实现')
}

function tcpConnectRtt(req) {
  // TODO: 新建连接 1 个 RTT，复用 0 个
  throw new Error('tcpConnectRtt 还没实现')
}

function httpRequestCost(req) {
  // TODO: keep-alive / 多路复用决定总往返次数
  throw new Error('httpRequestCost 还没实现')
}

function congestionWindow(req) {
  // TODO: 慢启动翻倍、拥塞避免 +1、丢包减半
  throw new Error('congestionWindow 还没实现')
}`,
  solution: L2C3,
  finalCode: L2C3,
  tests: `${L2S1}\n${L2S2}\n${L2S3}`
}

/* ============================================================ 第 3 关测试 */
const L3S1 = `{
  check('64KB 窗口 + 100ms RTT → 约 5.24 Mbps', () => {
    const r = throughput({ windowBytes: 65536, rttMs: 100 })
    same(r.bytesPerSec, 655360)
    same(r.mbps, 5.243)
  })
  check('RTT 翻倍吞吐减半', () => {
    same(throughput({ windowBytes: 65536, rttMs: 200 }).mbps, 2.621)
  })
  check('窗口扩大 10 倍吞吐扩大 10 倍', () => {
    same(throughput({ windowBytes: 655360, rttMs: 100 }).mbps, 52.429)
  })
  check('RTO = srtt + 4×rttvar，且不低于下限', () => {
    same(retransmitTimeout({ srttMs: 100, rttvarMs: 10, minRto: 200 }), 200, '140 < 200，取下限')
    same(retransmitTimeout({ srttMs: 300, rttvarMs: 10, minRto: 200 }), 340)
    same(retransmitTimeout({ srttMs: 100, rttvarMs: 50, minRto: 200 }), 300)
  })
  check('零 RTT 或负窗口直接抛错，而不是返回 Infinity', () => {
    throws(() => throughput({ windowBytes: 65536, rttMs: 0 }))
    throws(() => throughput({ windowBytes: -1, rttMs: 100 }))
  })
}`

const L3S2 = `{
  check('max-age 60、已过 10 秒 → 还新鲜 50 秒', () => {
    const r = cacheFreshness({ maxAge: 60, age: 10 })
    same(r.fresh, true)
    same(r.remaining, 50)
    same(r.action, 'hit')
  })
  check('刚好到期（age = maxAge）判 stale，必须回源', () => {
    const r = cacheFreshness({ maxAge: 60, age: 60 })
    same(r.fresh, false)
    same(r.remaining, 0)
    same(r.action, 'revalidate')
  })
  check('no-store 的响应永远不进缓存', () => {
    const r = cacheFreshness({ maxAge: 60, age: 0, noStore: true })
    same(r.action, 'no-store')
    same(r.fresh, false)
  })
  check('stale-while-revalidate 窗口内可以先给旧值', () => {
    const r = cacheFreshness({ maxAge: 60, age: 70, staleWhileRevalidate: 30 })
    same(r.fresh, false)
    same(r.action, 'swr')
  })
  check('must-revalidate 覆盖 stale-while-revalidate；超时后 remaining 不为负', () => {
    const r = cacheFreshness({ maxAge: 60, age: 70, staleWhileRevalidate: 30, mustRevalidate: true })
    same(r.action, 'revalidate')
    same(cacheFreshness({ maxAge: 10, age: 999 }).remaining, 0)
  })
}`

const L3S3 = `{
  check('TLS 1.2 全握手 2 RTT，1.3 只要 1 RTT', () => {
    same(tlsRoundTrips({ version: '1.2' }), 2)
    same(tlsRoundTrips({ version: '1.3' }), 1)
  })
  check('TLS 1.3 PSK 恢复 0 RTT（首字节就能带数据）', () => {
    same(tlsRoundTrips({ version: '1.3', resumption: 'psk' }), 0)
  })
  check('TLS 1.2 会话票据恢复压到 1 RTT', () => {
    same(tlsRoundTrips({ version: '1.2', resumption: 'ticket' }), 1)
  })
  check('100ms RTT 下：1.2 未装订 OCSP 要 300ms，1.3 只要 100ms', () => {
    same(tlsHandshakeMs({ version: '1.2', rttMs: 100, ocspStapled: false }), 300)
    same(tlsHandshakeMs({ version: '1.3', rttMs: 100 }), 100)
    same(tlsHandshakeMs({ version: '1.2', rttMs: 100, ocspStapled: true }), 200)
  })
  check('未知版本抛错，别默默按 1.2 算', () => {
    throws(() => tlsRoundTrips({ version: 'ssl3' }))
    throws(() => tlsRoundTrips({}))
  })
}`

/* ============================================================ 第 3 关代码 */
const L3C1 = `function throughput(req) {
  const windowBytes = req.windowBytes
  const rttMs = req.rttMs
  if (!(windowBytes > 0)) throw new Error('windowBytes 必须为正')
  if (!(rttMs > 0)) throw new Error('rttMs 必须为正')

  // 带宽时延积：一个 RTT 里最多只能在途 windowBytes 字节
  const bytesPerSec = Math.round(windowBytes / (rttMs / 1000))
  return {
    bytesPerSec,
    mbps: Math.round((bytesPerSec * 8 / 1e6) * 1000) / 1000
  }
}

function retransmitTimeout(req) {
  const srtt = req.srttMs
  const rttvar = req.rttvarMs
  const minRto = req.minRto === undefined ? 200 : req.minRto
  // RFC 6298：RTO = SRTT + 4 × RTTVAR，并夹在 [minRto, 60s]
  const rto = srtt + 4 * rttvar
  return Math.max(minRto, Math.round(rto))
}`

const L3C2 = `${L3C1}

function cacheFreshness(res) {
  const r = res || {}
  if (r.noStore) {
    return { fresh: false, remaining: 0, action: 'no-store' }
  }
  const maxAge = r.maxAge === undefined ? 0 : r.maxAge
  const age = r.age === undefined ? 0 : r.age
  const remaining = Math.max(0, maxAge - age)
  const fresh = remaining > 0

  let action = 'hit'
  if (!fresh) {
    const swr = r.staleWhileRevalidate || 0
    const staleFor = age - maxAge
    if (swr > 0 && !r.mustRevalidate && staleFor < swr) {
      action = 'swr'          // 先给旧值，同时后台回源
    } else {
      action = 'revalidate'   // 必须等新响应
    }
  }
  return { fresh, remaining, action }
}`

const L3C3 = `${L3C2}

function tlsRoundTrips(req) {
  const r = req || {}
  if (r.version === '1.3') {
    // TLS 1.3 把密钥交换塞进第一个飞行包，1-RTT 建连
    return r.resumption === 'psk' ? 0 : 1
  }
  if (r.version === '1.2') {
    // TLS 1.2 要等 ServerHello + 证书 + 密钥交换完成才能发 Finished
    return r.resumption === 'ticket' ? 1 : 2
  }
  throw new Error('未知 TLS 版本: ' + r.version)
}

function tlsHandshakeMs(req) {
  const r = req || {}
  let rtts = tlsRoundTrips(r)
  // 没装订 OCSP 时，TLS 1.2 客户端要额外去 CA 查一次证书状态
  if (r.version === '1.2' && r.ocspStapled === false) rtts += 1
  return rtts * (r.rttMs || 0)
}`

/* ============================================================ 第 3 关 */
const LV3 = {
  id: 'lv3',
  title: '可靠传输与缓存：窗口、RTO、新鲜度',
  emoji: '📦',
  xp: 55,
  goal: '实现 throughput 计算滑动窗口吞吐上限，retransmitTimeout 按 RFC 6298 算 RTO，cacheFreshness 判定 HTTP 缓存是否新鲜及该走 hit/swr/revalidate，tlsRoundTrips / tlsHandshakeMs 对比 TLS 1.2 与 1.3 的往返代价。',
  why: '这四个函数对应四个真实事故：窗口太小导致长肥管道跑不满带宽、RTO 太激进导致无谓重传、缓存策略写错导致用户看到过期数据、TLS 版本没升级导致首屏多等一个 RTT。它们的共同点是「配置项看起来无害，但都能算出一个具体数字」——而面试官问的就是这个数字。',
  nodes: [
    'cs.net.tcpip.reliable-flow',
    'cs.net.tcpip.tcp-vs-udp',
    'cs.net.http.cache',
    'cs.net.http.http2-3',
    'cs.net.http.tls-handshake'
  ],
  thinking: [
    {
      title: '吞吐 = 窗口 / RTT，抓不住的是「窗口该多大」',
      md: '在窗口受限的区间，吞吐上限就是 windowBytes / RTT：64KB 窗口 + 100ms RTT 只有 5.2 Mbps，哪怕链路是 1Gbps。\n\n要跑满带宽，窗口必须 ≥ BDP。BDP = 带宽 × RTT，1Gbps × 100ms = 12.5MB，远超 64KB 的单窗口上限——所以 TCP 需要窗口缩放（window scale 最大 1GB），这也是「为什么 TCP 单流跑不满万兆」的标准答案。'
    },
    {
      title: 'RTO 是「等多久才认为丢了」，不是「网络有多快」',
      md: 'RTO = SRTT + 4 × RTTVAR：均值加上四倍偏差，覆盖绝大部分抖动。设小了会把「慢」当成「丢」，触发无谓重传，反而加剧拥塞；设大了丢包后要等很久才恢复。\n\nLinux 的 RTO 下限是 200ms（`TCP_RTO_MIN`），因为再快也没有意义——对端处理 ACK 本身就要时间。所以低延迟机房里的 RTO 通常贴在下限上。'
    },
    {
      title: '缓存三件套：新鲜度、验证、过期策略',
      md: '`max-age` 决定新鲜期，`Age` 是响应在中间缓存里待过的时间，剩余 = maxAge - Age。`no-store` 直接禁止落盘，`no-cache` 是「可以存但每次都要验证」，`must-revalidate` 是「过期后不许用旧值」。\n\n`stale-while-revalidate` 是唯一允许「先给旧值」的开关：它在过期后还留一个窗口，用旧值换一个 RTT 的延迟。面试常问「你怎么让用户秒开但数据又不至于太旧」，答 SWR + 后台刷新。'
    }
  ],
  prereq: [
    {
      title: '滑动窗口、拥塞窗口、接收窗口是三件事',
      md: '接收窗口（rwnd）是接收方声明的「我还能收多少」，拥塞窗口（cwnd）是发送方估计的「网络还能塞多少」，实际发送窗口 = min(rwnd, cwnd)。\n\n所以「窗口小」可能怪接收方应用读得慢（rwnd 缩了），也可能怪网络拥塞（cwnd 缩了）。排查时要看 `ss -ti` 里的 cwnd 和 rcv_space，而不是只看带宽。'
    },
    {
      title: 'TLS 1.3 到底省掉了哪个 RTT',
      md: 'TLS 1.2 的两次往返：ClientHello → ServerHello+证书（1 RTT），客户端验证并算密钥 → Finished（1 RTT）。1.3 把密钥交换（ECDHE 公钥）直接放进 ClientHello，服务端一次回完，所以 1 RTT 就能发应用数据。\n\n再加上 TLS 1.3 的 PSK 恢复可以 0-RTT：客户端拿上次的 ticket 直接带数据。代价是 0-RTT 数据有重放风险，所以只能用于幂等请求。'
    }
  ],
  api: [
    {
      name: 'throughput / retransmitTimeout',
      sig: 'throughput({ windowBytes, rttMs }) => { bytesPerSec, mbps }；retransmitTimeout({ srttMs, rttvarMs, minRto? }) => number',
      args: 'windowBytes 与 rttMs 必须为正；minRto 默认 200ms。',
      returns: 'throughput 返回每秒字节数与 Mbps（3 位小数）；retransmitTimeout 返回整毫秒。',
      example: 'throughput({ windowBytes: 65536, rttMs: 100 }).mbps   // 5.243\nretransmitTimeout({ srttMs: 100, rttvarMs: 50, minRto: 200 })   // 300'
    },
    {
      name: 'cacheFreshness',
      sig: 'cacheFreshness({ maxAge, age, noStore?, staleWhileRevalidate?, mustRevalidate? }) => { fresh, remaining, action }',
      args: 'age 是响应已经存放的秒数（来自 Age 头或本地时钟差）。',
      returns: 'action 取 hit / swr / revalidate / no-store；remaining 为剩余新鲜秒数（不为负）。',
      example: 'cacheFreshness({ maxAge: 60, age: 70, staleWhileRevalidate: 30 }).action   // "swr"'
    },
    {
      name: 'tlsRoundTrips / tlsHandshakeMs',
      sig: 'tlsRoundTrips({ version, resumption? }) => number；tlsHandshakeMs({ version, rttMs, resumption?, ocspStapled? }) => number',
      args: 'version 取 "1.2" / "1.3"；resumption 取 "ticket"（1.2）或 "psk"（1.3）；ocspStapled 仅在 1.2 未装订时额外加 1 RTT。',
      returns: 'TLS 握手自身需要的 RTT 数与毫秒数（不含 TCP 握手）。',
      example: 'tlsRoundTrips({ version: "1.3", resumption: "psk" })   // 0\ntlsHandshakeMs({ version: "1.2", rttMs: 100, ocspStapled: false })   // 300'
    }
  ],
  usage: '// 容量评审：窗口是否够大\nconst t = throughput({ windowBytes: 65536, rttMs: 100 })\nif (t.mbps < 10) console.warn(`窗口受限，吞吐上限只有 ${t.mbps} Mbps，考虑开窗口缩放`)\n// 缓存策略评审：\nconst c = cacheFreshness({ maxAge: 60, age: 70, staleWhileRevalidate: 30 })\n// c.action === "swr" → 先返回旧值，同时后台刷新\n// 首屏优化：\nconst ms = tlsHandshakeMs({ version: "1.2", rttMs: 40, ocspStapled: false })  // 120ms，升级 1.3 后只要 40ms',
  hints: [
    '第 1 步：bytesPerSec = windowBytes / (rttMs/1000)，mbps 再 ×8/1e6；RTO 取 max(minRto, srtt + 4×rttvar)。',
    '第 2 步：先判 noStore，再算 remaining = max(0, maxAge - age)；action 的优先级是 no-store > hit > swr > revalidate，mustRevalidate 会掐掉 swr。',
    '第 3 步：1.3 默认 1、psk 恢复 0；1.2 默认 2、ticket 恢复 1；未装订 OCSP 且为 1.2 时额外 +1。'
  ],
  concepts: [
    {
      title: '为什么 UDP 上还要再造一个可靠传输',
      md: 'TCP 的重传是「整条连接一起等」，丢一个包所有流都停（队头阻塞）。QUIC 在 UDP 上把流独立编号，丢包只影响那一条流。\n\n代价是 QUIC 在用户态实现拥塞控制与重传，CPU 开销比内核 TCP 高；且部分网络会限速 UDP。所以它不是「TCP 的替代品」，而是「为多流并发场景重写的传输层」。'
    },
    {
      title: '缓存命中率不是越高越好',
      md: '`max-age` 设太长，用户看到过期库存/价格；设太短，回源打爆数据库。正确做法是按资源变化频率分级：静态资源一年 + 文件名 hash，API 用 `no-cache` + ETag 走 304。\n\n304 的本质是「用一次往返换一次传输」：响应体不重传，但请求还得发。真正省掉往返的是 `max-age` 命中和 `stale-while-revalidate`。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '窗口吞吐上限与 RTO',
      think: '先把「管道多粗」和「等多久算丢」算出来。这两个数字一个决定容量、一个决定重传行为，是后面所有传输层讨论的量化底座。',
      hint: 'bytesPerSec 用 windowBytes / (rttMs/1000)；RTO 用 srtt + 4×rttvar 再与 minRto 取大。',
      code: L3C1,
      test: L3S1,
      diag: [
        'RTT 单位没换算，直接把毫秒当秒除了。',
        'mbps 忘了 ×8（字节转比特），或者没除以 1e6。',
        '吞吐算成了 windowBytes × RTT，方向反了。',
        'RTO 漏了 4 倍 RTTVAR，或者没和 minRto 取大。',
        '没有校验 rttMs > 0，返回 Infinity 还能过。'
      ]
    },
    {
      n: 2,
      title: 'HTTP 缓存新鲜度判定',
      think: '有了传输成本，再看「能不能不发请求」。这一步把 max-age、Age、no-store、SWR、must-revalidate 五个头字段压成一个 action，避免调用方到处写 if。',
      hint: 'remaining = max(0, maxAge - age)；action 先判 no-store，再判 fresh，最后在 SWR 窗口内给 swr，否则 revalidate。',
      code: L3C2,
      test: L3S2,
      diag: [
        'remaining 用 age - maxAge 算了，符号反了。',
        '把 remaining = 0 当成还新鲜（应该 fresh = remaining > 0）。',
        'no-store 仍然返回 hit，缓存策略形同虚设。',
        'SWR 判断忘了扣 maxAge，或者把整个 age 当成 stale 时长。',
        'must-revalidate 没有覆盖 SWR；remaining 出现负数。'
      ]
    },
    {
      n: 3,
      title: 'TLS 1.2 与 1.3 的往返账',
      think: '最后一步把「安全握手要几趟」算清。它和前面的 TCP 握手是两笔账，分开算才能回答「升级 TLS 1.3 到底省了多少毫秒」。',
      hint: '先按 version 分 1.2/1.3，再叠加 resumption；ocspStapled === false 且 1.2 时额外 +1 个 RTT。',
      code: L3C3,
      test: L3S3,
      diag: [
        '1.2 和 1.3 的往返数记反了（1.2 是 2，1.3 是 1）。',
        'PSK 恢复没有返回 0，仍按 1 RTT 算。',
        'ticket 恢复当成了 2 RTT，1.2 的会话复用白讲。',
        '未装订 OCSP 的额外往返加在了 1.3 上（应该只影响 1.2）。',
        '未知版本默默按 1.2 处理，或者返回 undefined。'
      ]
    }
  ],
  skeleton: `function throughput(req) {
  // TODO: windowBytes / RTT 得每秒字节数，再换算 Mbps
  throw new Error('throughput 还没实现')
}

function retransmitTimeout(req) {
  // TODO: RFC 6298 的 SRTT + 4×RTTVAR，夹 minRto 下限
  throw new Error('retransmitTimeout 还没实现')
}

function cacheFreshness(res) {
  // TODO: max-age / Age / no-store / SWR / must-revalidate → action
  throw new Error('cacheFreshness 还没实现')
}

function tlsRoundTrips(req) {
  // TODO: TLS 1.2 两次往返，1.3 一次；恢复模式各减一
  throw new Error('tlsRoundTrips 还没实现')
}

function tlsHandshakeMs(req) {
  // TODO: RTT 数 × rttMs，未装订 OCSP 的 1.2 额外加一次
  throw new Error('tlsHandshakeMs 还没实现')
}`,
  solution: L3C3,
  finalCode: L3C3,
  tests: `${L3S1}\n${L3S2}\n${L3S3}`
}

/* ============================================================ 第 4 关测试 */
const L4S1 = `{
  check('缓存命中：零次查询、零个 RTT', () => {
    same(dnsHops({ mode: 'recursive', cached: true }), { clientQueries: 0, resolverQueries: 0, totalRtt: 0 })
  })
  check('递归：客户端只发 1 个查询，解析器代跑 3 个', () => {
    const r = dnsHops({ mode: 'recursive' })
    same(r.clientQueries, 1)
    same(r.resolverQueries, 3)
  })
  check('迭代：客户端自己跑 4 个查询（本地 + 根 + TLD + 权威）', () => {
    const r = dnsHops({ mode: 'iterative' })
    same(r.clientQueries, 4)
    same(r.resolverQueries, 0)
  })
  check('两种模式总 RTT 都是 4：省的是客户端复杂度，不是延迟', () => {
    same(dnsHops({ mode: 'recursive' }).totalRtt, 4)
    same(dnsHops({ mode: 'iterative' }).totalRtt, 4)
  })
  check('未知模式抛错', () => {
    throws(() => dnsHops({ mode: 'broadcast' }))
    throws(() => dnsHops({}))
  })
}`

const L4S2 = `{
  check('A→B→C 解析到 C，hops 是走过的每一跳', () => {
    const r = resolveCname({ 'a.com': 'b.com', 'b.com': 'c.com' }, 'a.com')
    same(r.target, 'c.com')
    same(r.hops, ['a.com', 'b.com', 'c.com'])
    same(r.loop, false)
  })
  check('环 A→B→A 被检测到，target 为 null', () => {
    const r = resolveCname({ 'a.com': 'b.com', 'b.com': 'a.com' }, 'a.com')
    same(r.loop, true)
    same(r.target, null)
    same(r.hops, ['a.com', 'b.com'])
  })
  check('超过 8 跳的链被截断，而不是无限跟下去', () => {
    const keys = ['n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9']
    const records = {}
    for (let i = 0; i < keys.length - 1; i++) records[keys[i]] = keys[i + 1]
    const r = resolveCname(records, 'n0')
    same(r.truncated, true)
    same(r.target, null)
    same(r.hops.length, 9, '第 9 跳时触发上限')
  })
  check('起点没有 CNAME 记录时直接返回自身', () => {
    const r = resolveCname({}, 'www.example.com')
    same(r.target, 'www.example.com')
    same(r.hops, ['www.example.com'])
    same(r.loop, false)
  })
  check('自环 a→a 也算环', () => {
    const r = resolveCname({ 'a.com': 'a.com' }, 'a.com')
    same(r.loop, true)
  })
}`

const L4S3 = `{
  check('未过期记录命中，并给出剩余 TTL', () => {
    const entries = [{ name: 'a.com', type: 'A', value: '1.1.1.1', expiresAt: 130 }]
    same(cacheLookup(entries, { name: 'a.com', type: 'A' }, 100), { hit: true, value: '1.1.1.1', ttl: 30 })
  })
  check('过期条目不算命中（边界：expiresAt === now 已失效）', () => {
    const entries = [{ name: 'a.com', type: 'A', value: '1.1.1.1', expiresAt: 100 }]
    same(cacheLookup(entries, { name: 'a.com', type: 'A' }, 100).hit, false)
    same(cacheLookup(entries, { name: 'a.com', type: 'A' }, 101).hit, false)
  })
  check('同名不同记录类型不会串（A 命中不代表 AAAA 命中）', () => {
    const entries = [{ name: 'a.com', type: 'A', value: '1.1.1.1', expiresAt: 200 }]
    same(cacheLookup(entries, { name: 'a.com', type: 'AAAA' }, 100).hit, false)
    same(cacheLookup(entries, { name: 'a.com', type: 'AAAA' }, 100).value, null)
  })
  check('空缓存返回未命中而不是抛错', () => {
    same(cacheLookup([], { name: 'a.com', type: 'A' }, 0), { hit: false, value: null, ttl: 0 })
    same(cacheLookup(null, { name: 'a.com', type: 'A' }, 0).hit, false)
  })
  check('ttlRemaining 不会返回负数', () => {
    same(ttlRemaining({ expiresAt: 50 }, 80), 0)
    same(ttlRemaining({ expiresAt: 80 }, 50), 30)
  })
}`

/* ============================================================ 第 4 关代码 */
const L4C1 = `function dnsHops(req) {
  const r = req || {}
  if (r.cached) {
    // 本地缓存命中：一个包都不发
    return { clientQueries: 0, resolverQueries: 0, totalRtt: 0 }
  }
  if (r.mode === 'recursive') {
    // 客户端只问一次本地递归服务器，剩下根/TLD/权威由它代跑
    return { clientQueries: 1, resolverQueries: 3, totalRtt: 4 }
  }
  if (r.mode === 'iterative') {
    // 客户端自己依次问本地、根、TLD、权威
    return { clientQueries: 4, resolverQueries: 0, totalRtt: 4 }
  }
  throw new Error('未知查询模式: ' + r.mode)
}`

const L4C2 = `${L4C1}

function resolveCname(records, name, maxHops) {
  const map = records || {}
  const limit = maxHops === undefined ? 8 : maxHops
  const hops = []
  let cur = name

  while (cur) {
    if (hops.indexOf(cur) >= 0) {
      // 已经走过这个域名：CNAME 成环，继续跟就是死循环
      return { target: null, hops, loop: true, truncated: false }
    }
    hops.push(cur)
    if (hops.length > limit) {
      // DNS 服务器自身也有最大跟随深度，超了就返回失败而不是硬跟
      return { target: null, hops, loop: false, truncated: true }
    }
    const next = map[cur]
    if (!next) {
      return { target: cur, hops, loop: false, truncated: false }
    }
    cur = next
  }
  return { target: cur, hops, loop: false, truncated: false }
}`

const L4C3 = `${L4C2}

function ttlRemaining(rec, now) {
  const left = (rec && rec.expiresAt ? rec.expiresAt : 0) - now
  return Math.max(0, left)
}

function cacheLookup(entries, q, now) {
  const list = entries || []
  const query = q || {}
  for (const e of list) {
    // 记录类型必须一起匹配：A 的缓存不能拿来回答 AAAA
    if (e.name === query.name && e.type === query.type && e.expiresAt > now) {
      return { hit: true, value: e.value, ttl: e.expiresAt - now }
    }
  }
  return { hit: false, value: null, ttl: 0 }
}`

/* ============================================================ 第 4 关 */
const LV4 = {
  id: 'lv4',
  title: 'DNS：递归、缓存与 CNAME 链',
  emoji: '🧭',
  xp: 60,
  goal: '实现 dnsHops 对比递归与迭代查询的查询次数与总往返，resolveCname 跟随 CNAME 链并识别环与超深链，ttlRemaining / cacheLookup 实现带 TTL 与记录类型匹配的本地缓存查询。',
  why: 'DNS 是「配置改完没生效」「上线后一半用户打不开」这类事故的第一嫌疑人。能算清三件事就不会瞎猜：递归和迭代各自发了几个包（决定你该看谁的日志）、TTL 还剩几秒（决定改记录后要等多久）、CNAME 链在哪跳打转（决定是配置环还是深度超限）。这三个数字都能在 30 秒内从命令行拿到，前提是脑子里有模型。',
  nodes: ['cs.net.dns.advanced', 'cs.net.dns.resolve'],
  thinking: [
    {
      title: '递归省的是客户端复杂度，不是延迟',
      md: '递归查询里客户端只发 1 个包，本地解析器代跑根、TLD、权威三次；迭代查询里客户端自己跑四趟。两种模式的总 RTT 都是 4——差别在「谁来承担这段逻辑」。\n\n这就是为什么 stub resolver（操作系统里的那层）几乎总是递归模式：应用程序不该实现 DNS 协议。而本地递归服务器往上走的是迭代，因为它要缓存每一步的结果，替所有客户端分摊成本。'
    },
    {
      title: 'TTL 是缓存契约，不是建议',
      md: 'TTL 到期前，任何中间缓存都可以直接返回旧值，你改权威记录也没用。所以「切流量前先把 TTL 降到 60 秒，等一个旧 TTL 周期再切」是标准操作。\n\n过期判定有个边界：`expiresAt === now` 时记录已经失效（缓存有效期是左闭右开区间）。很多手写缓存用 `>=` 判断，结果多用了 1 秒。'
    },
    {
      title: 'CNAME 链必须有上限',
      md: 'CNAME 允许指向另一个域名，理论上可以无限套。真实解析器会设最大跟随深度（通常 8~16 跳），超了返回 SERVFAIL。\n\n更要命的是成环：A→B→A。实现里必须用「已访问集合」，否则就是死循环——这类 bug 在本地测试很难触发，上线后遇到一条配置环就会把解析器线程打满。'
    }
  ],
  prereq: [
    {
      title: '一次解析到底经过哪些服务器',
      md: '浏览器缓存 → 系统缓存（nscd/systemd-resolved）→ 本地递归服务器 → 根服务器（返回 TLD 地址）→ TLD 服务器（返回权威地址）→ 权威服务器（返回最终记录）。\n\n`dig +trace` 就是从根开始走这条链，所以它看到的是迭代视角；`dig` 默认只问本地递归服务器，看到的是递归视角。排查「解析不一致」时两者都要看。'
    },
    {
      title: '记录类型决定你查的是谁',
      md: 'A 返回 IPv4，AAAA 返回 IPv6，CNAME 是别名，MX 是邮件路由，TXT 常用于域名验证。\n\n同名可以有多个类型的记录，但 CNAME 和别的类型不能共存（除了 DNSSEC 相关）。所以缓存键必须是 `(name, type)` 二元组——只按域名缓存，A 的结果会污染 AAAA 查询。'
    }
  ],
  api: [
    {
      name: 'dnsHops',
      sig: 'dnsHops({ mode, cached? }) => { clientQueries, resolverQueries, totalRtt }',
      args: 'mode 取 "recursive" / "iterative"；cached 为 true 时直接命中本地缓存。',
      returns: 'clientQueries 客户端发出的查询数；resolverQueries 解析器代发的上游查询数；totalRtt 端到端往返次数。未知模式抛错。',
      example: 'dnsHops({ mode: "recursive" })   // { clientQueries: 1, resolverQueries: 3, totalRtt: 4 }\ndnsHops({ mode: "iterative" })   // { clientQueries: 4, resolverQueries: 0, totalRtt: 4 }'
    },
    {
      name: 'resolveCname',
      sig: 'resolveCname(records, name, maxHops?) => { target, hops, loop, truncated }',
      args: 'records 是域名到下一个域名的映射（值为假表示链结束）；maxHops 默认 8。',
      returns: 'target 最终域名（成环或截断时为 null）；hops 实际访问过的域名；loop 是否成环；truncated 是否超深。',
      example: 'resolveCname({ "a.com": "b.com", "b.com": "c.com" }, "a.com")\n// { target: "c.com", hops: ["a.com","b.com","c.com"], loop: false, truncated: false }'
    },
    {
      name: 'ttlRemaining / cacheLookup',
      sig: 'ttlRemaining(rec, now) => number；cacheLookup(entries, { name, type }, now) => { hit, value, ttl }',
      args: 'expiresAt 是绝对失效时间戳；now 由调用方传入（沙箱里没有真实时钟）。',
      returns: 'ttlRemaining 返回剩余秒数（≥0）；cacheLookup 命中返回记录值与剩余 TTL，未命中返回 { hit: false, value: null, ttl: 0 }。',
      example: 'cacheLookup([{ name: "a.com", type: "A", value: "1.1.1.1", expiresAt: 130 }], { name: "a.com", type: "A" }, 100)\n// { hit: true, value: "1.1.1.1", ttl: 30 }'
    }
  ],
  usage: '// 改 DNS 之前先估算影响窗口：\nconst left = ttlRemaining(record, Date.now() / 1000)\n// 旧 TTL 还有 left 秒，这段时间里一部分用户仍会拿到旧 IP\n// 排查解析失败：\nconst chain = resolveCname(cnames, "api.example.com")\nif (chain.loop) console.error(`CNAME 成环：${chain.hops.join(" -> ")}`)\nif (chain.truncated) console.error("CNAME 链过深，检查配置")',
  hints: [
    '第 1 步：三种情况直接返回三组常量；递归是 1 + 3，迭代是 4 + 0，两者 totalRtt 都是 4。',
    '第 2 步：while 循环 + hops 数组；每轮先查重（成环），再判长度上限，最后看有没有下一条记录。',
    '第 3 步：cacheLookup 必须同时比对 name 与 type，并且用 expiresAt > now（等于即失效）；ttlRemaining 用 max(0, ...)。'
  ],
  concepts: [
    {
      title: '为什么根服务器只有 13 组',
      md: '「13 台根服务器」是历史误传：是 13 个 IP 地址（受 UDP 512 字节响应包大小限制），每组背后是上百台通过 anycast 分布在全球的实例。\n\nanycast 让同一个 IP 在不同地区落到最近的实例，这也是 DDoS 打不倒根的原因：攻击流量被分散到各个本地节点，而不是集中到一个机房。'
    },
    {
      title: 'DNS 污染与 DoH 的真实取舍',
      md: '明文 DNS 可被中间人篡改（返回错误 IP），DoH/DoT 用 TLS 把查询包起来，中间人看不到也改不了。\n\n代价是：企业内网的 DNS 审计失效、部分系统解析绕过本地策略、首次连接多一次 TLS 握手。所以 DoH 是「隐私 vs 可控」的取舍，不是纯升级。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '递归与迭代的查询次数',
      think: '先建立「谁发了几个包」的模型。这是排查解析问题的第一步：如果客户端只发 1 个包却超时，问题在本地解析器；如果发了 4 个包都超时，问题可能在链路或权威。',
      hint: '三种分支直接返回：cached → 全 0；recursive → 1/3/4；iterative → 4/0/4；其余抛错。',
      code: L4C1,
      test: L4S1,
      diag: [
        '递归模式把根/TLD/权威的查询算到了客户端头上。',
        '迭代模式的 resolverQueries 记成了 3（本地只转发，不代查）。',
        'totalRtt 算成了 clientQueries + resolverQueries，递归变成 4 以外的数。',
        'cached 分支仍返回 4 个 RTT，缓存白做。',
        '未知 mode 直接返回 undefined，调用方拿不到结构。'
      ]
    },
    {
      n: 2,
      title: 'CNAME 链跟随与防环',
      think: 'CNAME 是唯一会让解析「跳着走」的记录类型。这一步的关键不是跟随，而是两个刹车：环检测与深度上限——它们决定解析器会不会被打挂。',
      hint: '用 hops 数组兼作已访问集合；每轮先 indexOf 查环，再判 length > limit，最后取 map[cur]。',
      code: L4C2,
      test: L4S2,
      diag: [
        '没有维护已访问集合，环会变成死循环或栈溢出。',
        '查环放在 push 之后，自己指向自己时漏判。',
        '深度上限用了 >=，8 跳的链被提前截断。',
        '起点没有记录时返回 undefined，而不是自身。',
        'hops 只记了最终域名，丢掉了中间每一跳。'
      ]
    },
    {
      n: 3,
      title: 'TTL 缓存与记录类型匹配',
      think: '最后一步把「缓存能不能用」变成可判定：剩余多久、是否过期、类型对不对。这三个条件缺一个，就会出现「明明改了记录用户还访问旧 IP」或者「AAAA 查询拿到 A 的地址」。',
      hint: 'cacheLookup 遍历条目，同时比对 name 和 type，条件用 expiresAt > now；ttlRemaining 用 max(0, expiresAt - now)。',
      code: L4C3,
      test: L4S3,
      diag: [
        'TTL 用 expiresAt - now 却没取 max，过期后返回负数。',
        '过期判断用了 >=，expiresAt === now 的记录仍被当成命中。',
        '缓存键只比 name 不比 type，A 记录污染了 AAAA 查询。',
        '空数组/ null 时没兜底，直接抛错。',
        '命中时 ttl 返回了绝对时间戳而不是剩余秒数。'
      ]
    }
  ],
  skeleton: `function dnsHops(req) {
  // TODO: 递归 / 迭代 / 缓存命中三种情况的查询次数
  throw new Error('dnsHops 还没实现')
}

function resolveCname(records, name, maxHops) {
  // TODO: 跟随 CNAME 链，检测环与超深
  throw new Error('resolveCname 还没实现')
}

function ttlRemaining(rec, now) {
  // TODO: 剩余 TTL，不为负
  throw new Error('ttlRemaining 还没实现')
}

function cacheLookup(entries, q, now) {
  // TODO: 按 (name, type) 与 TTL 查缓存
  throw new Error('cacheLookup 还没实现')
}`,
  solution: L4C3,
  finalCode: L4C3,
  tests: `${L4S1}\n${L4S2}\n${L4S3}`
}

export default {
  id: 'cs-net',
  version: 3,
  domain: 'cs',
  cumulative: false,
  title: '网络与可观测性：预算、协议栈、DNS',
  emoji: '🛰️',
  xp: 60,
  tagline: '4 关：SLO 错误预算与发布策略 → 协议栈首部与 RTT 账本 → 可靠传输与缓存 → DNS 解析链路。',
  stack: ['网络', '可观测性', 'SRE'],
  intro: '网络题最容易停在「TCP 三次握手」「DNS 是域名解析」这种背诵层面。这个项目把网络与 SRE 的核心量全部算出来：SLO 还能坏几次、每层首部吃掉多少字节、一次请求要等几个 RTT、拥塞窗口几轮长到多大、缓存还能用几秒、CNAME 链会在哪一环打转。算过一遍，再讲「为什么慢」「为什么切流」才有依据。',
  outcome: '你能把 SLO 换算成错误预算并据此冻结发布、手算协议栈的开销与往返次数、推演 cwnd 曲线、判断缓存是否新鲜、数清递归与迭代查询的差异并识别 CNAME 环。',
  levels: [LV1, LV2, LV3, LV4]
}