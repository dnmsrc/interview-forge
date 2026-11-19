/**
 * 项目闯关内容源：后端 · MySQL 与消息队列（3 关 9 步）
 *
 *   lv1 消息队列 —— 选型、可靠投递语义、分区与顺序
 *   lv2 MySQL   —— B+ 树与最左前缀、MVCC 可见性、死锁检测
 *   lv3 日志与 JDBC —— redo/binlog 复制、BigDecimal 精度、RowMapper 映射
 *
 * 全部纯函数模拟：MQ 用状态机，MySQL 用数组/图模拟索引与等待图，复制用 offset 重放。
 */

/* ============================================================ 第 1 关测试 */
const L1S1 = `{
  check('百万级吞吐或需要回放：Kafka', () => {
    same(chooseMQ({ throughputPerSec: 200000, routingComplexity: 'low' }), 'kafka')
    same(chooseMQ({ throughputPerSec: 1000, needReplay: true }), 'kafka')
  })
  check('复杂路由（多交换机/多队列绑定）：RabbitMQ', () => {
    same(chooseMQ({ throughputPerSec: 5000, routingComplexity: 'high' }), 'rabbitmq')
  })
  check('需要严格顺序：RocketMQ（按队列顺序）', () => {
    same(chooseMQ({ throughputPerSec: 5000, needOrdered: true, routingComplexity: 'low' }), 'rocketmq')
  })
  check('普通业务默认 RabbitMQ，不盲目上 Kafka', () => {
    same(chooseMQ({ throughputPerSec: 5000, routingComplexity: 'low' }), 'rabbitmq')
  })
}`

const L1S2 = `{
  check('先 ack 再处理业务：最多一次（可能丢）', () => {
    const r = deliveryGuarantee({ ackBeforeProcess: true, brokerPersist: true, idempotentConsumer: false })
    same(r.guarantee, 'at-most-once')
    ok(r.risks.includes('message-loss'), '应有丢失风险')
  })
  check('处理成功后再 ack：至少一次（可能重复）', () => {
    const r = deliveryGuarantee({ ackBeforeProcess: false, brokerPersist: true, idempotentConsumer: false })
    same(r.guarantee, 'at-least-once')
    ok(r.risks.includes('duplicate'), '应有重复风险')
  })
  check('至少一次 + 幂等消费：效果上等价于恰好一次', () => {
    const r = deliveryGuarantee({ ackBeforeProcess: false, brokerPersist: true, idempotentConsumer: true })
    same(r.guarantee, 'exactly-once')
    same(r.risks, [])
  })
  check('broker 不持久化：即使消费者幂等，宕机也会丢', () => {
    const r = deliveryGuarantee({ ackBeforeProcess: false, brokerPersist: false, idempotentConsumer: true })
    ok(r.risks.includes('broker-loss'), '应有 broker 宕机丢失风险')
  })
}`

const L1S3 = `{
  check('同一个 key 永远落同一个分区（顺序前提）', () => {
    same(partitionOf('order-42', 8), partitionOf('order-42', 8))
  })
  check('分区号在 [0, partitions-1] 范围内', () => {
    for (const k of ['a', 'b', 'order-1', 'order-2']) {
      const p = partitionOf(k, 8)
      ok(p >= 0 && p < 8, '分区越界：' + p)
    }
  })
  check('同 key 同分区 + 单生产者：顺序可保证', () => {
    const r = orderGuarantee({ sameKeySamePartition: true, singleProducer: true })
    same(r.ordered, true)
  })
  check('多生产者写同 key：即使同分区也不能保证顺序', () => {
    const r = orderGuarantee({ sameKeySamePartition: true, singleProducer: false })
    same(r.ordered, false)
    same(r.reason, 'multi-producer')
  })
}`

/* ============================================================ 第 2 关测试 */
const L2S1 = `{
  check('B+ 树树高：100 万行、fanout 100 → 3 层', () => {
    same(bplusTreeHeight(1000000, 100), 3)
  })
  check('最左前缀命中：WHERE a=? AND b=? 用得上 (a,b) 联合索引', () => {
    const r = leftPrefixMatch(['a', 'b', 'c'], ['a', 'b'])
    same(r.usable, true)
    same(r.matched, 2)
  })
  check('跳过最左列：WHERE b=? 用不上 (a,b) 索引', () => {
    const r = leftPrefixMatch(['a', 'b'], ['b'])
    same(r.usable, false)
    same(r.matched, 0)
  })
  check('范围查询会中断后续列（a 范围 + b 条件只能用到 a）', () => {
    const r = leftPrefixMatch(['a', 'b'], ['a', 'b'], { rangeAt: 'a' })
    same(r.usable, true)
    same(r.matched, 1, '范围列之后的条件不再走索引')
  })
}`

const L2S2 = `{
  const version = (id, commitId, value) => ({ id, commitId, value })

  check('RR 快照读：事务开始后别人提交的版本不可见', () => {
    const r = canSee({ isolation: 'rr', snapshotCommitId: 100, version: version(2, 200, 'new') })
    same(r.visible, false, '快照之后提交的版本不可见')
  })
  check('RR 快照读：快照之前的版本可见', () => {
    const r = canSee({ isolation: 'rr', snapshotCommitId: 100, version: version(1, 50, 'old') })
    same(r.visible, true)
  })
  check('RC：每次都看最新已提交版本', () => {
    const r = canSee({ isolation: 'rc', snapshotCommitId: 100, version: version(2, 200, 'new') })
    same(r.visible, true)
  })
  check('当前读（for update）：无论隔离级别都看最新', () => {
    const r = canSee({ isolation: 'rr', snapshotCommitId: 100, version: version(2, 200, 'new'), currentRead: true })
    same(r.visible, true)
  })
}`

const L2S3 = `{
  check('无环：没有死锁', () => {
    same(detectDeadlock({ A: 'B', B: null }), null)
  })
  check('两事务互相等待：返回环', () => {
    const cycle = detectDeadlock({ A: 'B', B: 'A' })
    same(cycle.sort(), ['A', 'B'])
  })
  check('自环：一个事务等待自己', () => {
    same(detectDeadlock({ A: 'A' }), ['A'])
  })
  check('长环：A→B→C→A 能完整返回', () => {
    const cycle = detectDeadlock({ A: 'B', B: 'C', C: 'A' })
    same(cycle.sort(), ['A', 'B', 'C'])
  })
}`

/* ============================================================ 第 3 关测试 */
const L3S1 = `{
  const events = [
    { pos: 1, op: 'INSERT', key: 'k1' },
    { pos: 2, op: 'UPDATE', key: 'k2' },
    { pos: 3, op: 'DELETE', key: 'k1' }
  ]

  check('从指定位点重放：只应用 pos > 已同步位点的事件', () => {
    const state = applyRelayLog({ pos: 1, applied: ['k1'] }, events, 1)
    same(state.applied, ['k1', 'k2'])
    same(state.pos, 3)
  })
  check('重复位点幂等：同一事件不会应用两次', () => {
    const state = applyRelayLog({ pos: 2, applied: ['k1', 'k2'] }, events, 2)
    same(state.pos, 3)
    same(state.applied, ['k1', 'k2'])
  })
  check('主从延迟 = 主库位点 - 从库已应用位点（按事件数折算秒）', () => {
    same(replicationLagMs(10, 7, 100), 300)
  })
  check('从库位点领先（异常）：延迟按 0 处理，不返回负数', () => {
    same(replicationLagMs(7, 10, 100), 0)
  })
}`

const L3S2 = `{
  check('浮点相加的坑：0.1 + 0.2 用分单位算才对', () => {
    same(addDecimalStrings(['0.1', '0.2']), '0.3')
    ok(0.1 + 0.2 !== 0.3, '这是经典浮点误差，所以才要用整数分')
  })
  check('BigDecimal 保留两位、HALF_UP', () => {
    same(roundHalfUp('2.345', 2), '2.35')
    same(roundHalfUp('2.344', 2), '2.34')
  })
  check('JDBC 类型映射：数字字符串 → DECIMAL，整数 → BIGINT', () => {
    same(jdbcTypeOf('123.45'), 'DECIMAL')
    same(jdbcTypeOf(123), 'BIGINT')
  })
  check('JDBC 类型映射：日期字符串 → DATE，布尔 → BOOLEAN', () => {
    same(jdbcTypeOf('2026-11-20'), 'DATE')
    same(jdbcTypeOf(true), 'BOOLEAN')
  })
}`

const L3S3 = `{
  const row = { user_name: 'alice', user_age: 30, created_at: '2026-11-20' }

  check('列名映射：snake_case → camelCase', () => {
    same(snakeToCamel('user_name'), 'userName')
    same(snakeToCamel('created_at'), 'createdAt')
    same(snakeToCamel('id'), 'id')
  })
  check('mapRow 按映射表产出对象', () => {
    const mapped = mapRow(row, { user_name: 'userName', user_age: 'age' })
    same(mapped, { userName: 'alice', age: 30 })
  })
  check('映射表里没有的列被忽略（不偷偷带出多余字段）', () => {
    const mapped = mapRow(row, { user_name: 'userName' })
    same(Object.keys(mapped), ['userName'])
  })
  check('行里缺少映射目标列：值为 undefined，不抛错', () => {
    const mapped = mapRow({ user_name: 'bob' }, { user_name: 'userName', user_age: 'age' })
    same(mapped.userName, 'bob')
    same(mapped.age, undefined)
  })
}`

/* ============================================================ 第 1 关 */
const LV1 = {
  id: 'lv1',
  title: '消息队列：选型、投递语义与分区顺序',
  emoji: '📨',
  xp: 50,
  goal: '实现 MQ 的三块判断：按吞吐/路由/回放需求选型（chooseMQ）、按 ack 时机与持久化判定投递语义（deliveryGuarantee）、按哈希分区与生产者数量判定顺序保证（partitionOf + orderGuarantee）。',
  why: 'MQ 面试题很少问「Kafka 有几个组件」，而是问「你怎么保证不丢不重」「顺序怎么保证」。这些答案都取决于三个开关：ack 在业务前还是后、broker 是否持久化、消费者是否幂等；顺序则取决于「同 key 同分区 + 单生产者」这两个前提。',
  nodes: ['be.mq.arch', 'be.mq.arch.kafka', 'be.mq.arch.rabbitmq', 'be.mq.reliability', 'be.mq.reliability.delivery', 'be.mq.reliability.idempotent'],
  thinking: [
    {
      title: '投递语义是三个开关的组合',
      md: '先 ack 再处理 → 最多一次（处理失败消息也没了）；处理成功再 ack → 至少一次（ack 失败会重投，重复）；再加幂等消费 → 效果等价于恰好一次。\n\nbroker 不持久化是另一个独立开关：消费者再幂等，broker 宕机消息也会丢。所以「不丢不重」不是一个组件能保证的，是一条链。'
    },
    {
      title: '顺序保证的边界条件',
      md: 'Kafka 只保证「单分区内有序」。所以「同 key 同分区」是顺序的第一步（hash(key) % partitions）；第二步是「单生产者」——多个生产者写同一 key 时，到达 broker 的顺序本身就不确定。\n\nRocketMQ 的顺序消息也是同样的道理：顺序队列 + 单生产者串行发送。'
    }
  ],
  prereq: [
    {
      title: 'Kafka / RabbitMQ / RocketMQ 的定位',
      md: 'Kafka：高吞吐、分区、可回放（日志），适合日志/事件流；RabbitMQ：灵活路由（direct/topic/fanout）、低延迟，适合业务消息；RocketMQ：事务消息、顺序消息、亿级堆积，适合电商交易。\n\n选型先看「吞吐量级 + 是否需要回放 + 路由复杂度」，而不是看社区热度。'
    },
    {
      title: '至少一次与幂等',
      md: '「至少一次」意味着重复不可避免——网络超时、ack 丢失都会触发重投。所以消费端必须幂等：唯一键、状态机、去重表。\n\n「恰好一次」在分布式里只能靠「至少一次 + 幂等」实现，或者靠事务消息 + 本地事务表。'
    }
  ],
  api: [
    {
      name: 'chooseMQ',
      sig: 'chooseMQ({ throughputPerSec, routingComplexity, needReplay, needOrdered }) => \'kafka\'|\'rabbitmq\'|\'rocketmq\'',
      args: 'throughputPerSec 是峰值 TPS；routingComplexity ∈ low|high。',
      returns: '选型结果。',
      example: "chooseMQ({ throughputPerSec: 200000, routingComplexity: 'low' })  // → 'kafka'"
    },
    {
      name: 'deliveryGuarantee',
      sig: 'deliveryGuarantee({ ackBeforeProcess, brokerPersist, idempotentConsumer }) => { guarantee, risks }',
      args: '三个开关的布尔值。',
      returns: 'guarantee ∈ at-most-once | at-least-once | exactly-once；risks 是风险列表。',
      example: 'deliveryGuarantee({ ackBeforeProcess: false, brokerPersist: true, idempotentConsumer: true })'
    },
    {
      name: 'partitionOf / orderGuarantee',
      sig: 'partitionOf(key, partitions) => number；orderGuarantee({ sameKeySamePartition, singleProducer }) => { ordered, reason? }',
      args: 'partitions 是分区数；两个布尔是顺序前提。',
      returns: '稳定分区号；顺序是否可保证及原因。',
      example: "partitionOf('order-42', 8)  // → 0~7"
    }
  ],
  usage: 'const mq = chooseMQ({ throughputPerSec: 50000, routingComplexity: "low", needReplay: true })\nconst delivery = deliveryGuarantee({ ackBeforeProcess: false, brokerPersist: true, idempotentConsumer: true })\nconst partition = partitionOf(orderId, 8)  // 同订单永远同分区',
  hints: [
    'chooseMQ：先看吞吐/回放 → kafka；再看路由复杂度 → rabbitmq；再看顺序 → rocketmq；兜底 rabbitmq。',
    'deliveryGuarantee：ackBeforeProcess → 最多一次；否则 brokerPersist=false → 有 broker-loss；否则幂等 → exactly-once，不然 at-least-once。',
    'partitionOf 用稳定字符串哈希 % partitions；orderGuarantee 要同时满足两个前提。'
  ],
  stages: [
    {
      n: 1,
      title: '先写选型判断',
      think: '选型是决策树，不是偏好。把「吞吐/回放 → 路由 → 顺序」的优先级写死，讨论才有共同语言。',
      hint: 'if 吞吐≥10万或 needReplay → kafka；else if routingComplexity==high → rabbitmq；else if needOrdered → rocketmq；else rabbitmq。',
      code: `function chooseMQ(spec) {
  const { throughputPerSec = 0, routingComplexity = 'low', needReplay = false, needOrdered = false } = spec
  if (throughputPerSec >= 100000 || needReplay) return 'kafka'
  if (routingComplexity === 'high') return 'rabbitmq'
  if (needOrdered) return 'rocketmq'
  return 'rabbitmq'
}`,
      test: L1S1,
      diag: [
        '判断顺序反了：先看路由再看吞吐，高吞吐场景被分到 rabbitmq。',
        'needReplay 没有参与判断（Kafka 的日志回放能力被忽略）。',
        'needOrdered 判断放在 routingComplexity 之前，顺序场景被 rabbitmq 抢走。',
        '兜底返回了 undefined。'
      ]
    },
    {
      n: 2,
      title: '再写投递语义判定',
      think: '三个开关独立作用：ack 时机决定丢不丢、broker 持久化决定宕机丢不丢、幂等决定重不重。把它们组合成语义与风险清单。',
      hint: 'ackBeforeProcess → at-most-once + message-loss；否则 brokerPersist=false → +broker-loss；idempotentConsumer → exactly-once（风险清空）。',
      code: `function chooseMQ(spec) {
  const { throughputPerSec = 0, routingComplexity = 'low', needReplay = false, needOrdered = false } = spec
  if (throughputPerSec >= 100000 || needReplay) return 'kafka'
  if (routingComplexity === 'high') return 'rabbitmq'
  if (needOrdered) return 'rocketmq'
  return 'rabbitmq'
}

function deliveryGuarantee(spec) {
  const { ackBeforeProcess, brokerPersist, idempotentConsumer } = spec
  const risks = []
  if (ackBeforeProcess) {
    risks.push('message-loss')
    if (!brokerPersist) risks.push('broker-loss')
    return { guarantee: 'at-most-once', risks }
  }
  if (!brokerPersist) risks.push('broker-loss')
  if (!idempotentConsumer) {
    risks.push('duplicate')
    return { guarantee: 'at-least-once', risks }
  }
  // 至少一次 + 幂等：broker 风险仍在，但重复已被消除
  if (risks.includes('broker-loss')) return { guarantee: 'at-least-once', risks }
  return { guarantee: 'exactly-once', risks: [] }
}`,
      test: L1S2,
      diag: [
        'ackBeforeProcess 分支漏了 message-loss 风险。',
        'brokerPersist=false 时没有加 broker-loss（宕机丢失被忽略）。',
        '幂等开关没有参与，至少一次被直接当成恰好一次。',
        'broker 不持久化时仍然返回 exactly-once。'
      ]
    },
    {
      n: 3,
      title: '最后写分区与顺序保证',
      think: '顺序 = 同 key 同分区 + 单生产者。分区函数要稳定（同 key 永远同分区），顺序判断要把两个前提都查一遍。',
      hint: 'hash 字符串累加 % partitions；orderGuarantee 先查 sameKeySamePartition，再查 singleProducer。',
      code: `function chooseMQ(spec) {
  const { throughputPerSec = 0, routingComplexity = 'low', needReplay = false, needOrdered = false } = spec
  if (throughputPerSec >= 100000 || needReplay) return 'kafka'
  if (routingComplexity === 'high') return 'rabbitmq'
  if (needOrdered) return 'rocketmq'
  return 'rabbitmq'
}

function deliveryGuarantee(spec) {
  const { ackBeforeProcess, brokerPersist, idempotentConsumer } = spec
  const risks = []
  if (ackBeforeProcess) {
    risks.push('message-loss')
    if (!brokerPersist) risks.push('broker-loss')
    return { guarantee: 'at-most-once', risks }
  }
  if (!brokerPersist) risks.push('broker-loss')
  if (!idempotentConsumer) {
    risks.push('duplicate')
    return { guarantee: 'at-least-once', risks }
  }
  if (risks.includes('broker-loss')) return { guarantee: 'at-least-once', risks }
  return { guarantee: 'exactly-once', risks: [] }
}

function partitionOf(key, partitions) {
  const text = String(key)
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0
  return h % partitions
}

function orderGuarantee(spec) {
  const { sameKeySamePartition, singleProducer } = spec
  if (!sameKeySamePartition) return { ordered: false, reason: 'different-partitions' }
  if (!singleProducer) return { ordered: false, reason: 'multi-producer' }
  return { ordered: true }
}`,
      test: L1S3,
      diag: [
        '分区哈希不稳定（用了随机或 id），同 key 落不同分区。',
        '没有取模 partitions，分区号越界。',
        '顺序判断只看了一个前提（同分区或单生产者）。',
        'reason 字段缺失，调用方无法定位原因。'
      ]
    }
  ],
  skeleton: `function chooseMQ(spec) { throw new Error('还没实现') }
function deliveryGuarantee(spec) { throw new Error('还没实现') }
function partitionOf(key, partitions) { throw new Error('还没实现') }
function orderGuarantee(spec) { throw new Error('还没实现') }`,
  solution: `function chooseMQ(spec) {
  const { throughputPerSec = 0, routingComplexity = 'low', needReplay = false, needOrdered = false } = spec
  if (throughputPerSec >= 100000 || needReplay) return 'kafka'
  if (routingComplexity === 'high') return 'rabbitmq'
  if (needOrdered) return 'rocketmq'
  return 'rabbitmq'
}

function deliveryGuarantee(spec) {
  const { ackBeforeProcess, brokerPersist, idempotentConsumer } = spec
  const risks = []
  if (ackBeforeProcess) {
    risks.push('message-loss')
    if (!brokerPersist) risks.push('broker-loss')
    return { guarantee: 'at-most-once', risks }
  }
  if (!brokerPersist) risks.push('broker-loss')
  if (!idempotentConsumer) {
    risks.push('duplicate')
    return { guarantee: 'at-least-once', risks }
  }
  if (risks.includes('broker-loss')) return { guarantee: 'at-least-once', risks }
  return { guarantee: 'exactly-once', risks: [] }
}

function partitionOf(key, partitions) {
  const text = String(key)
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0
  return h % partitions
}

function orderGuarantee(spec) {
  const { sameKeySamePartition, singleProducer } = spec
  if (!sameKeySamePartition) return { ordered: false, reason: 'different-partitions' }
  if (!singleProducer) return { ordered: false, reason: 'multi-producer' }
  return { ordered: true }
}`,
  finalCode: `function chooseMQ(spec) {
  const { throughputPerSec = 0, routingComplexity = 'low', needReplay = false, needOrdered = false } = spec
  if (throughputPerSec >= 100000 || needReplay) return 'kafka'
  if (routingComplexity === 'high') return 'rabbitmq'
  if (needOrdered) return 'rocketmq'
  return 'rabbitmq'
}

function deliveryGuarantee(spec) {
  const { ackBeforeProcess, brokerPersist, idempotentConsumer } = spec
  const risks = []
  if (ackBeforeProcess) {
    risks.push('message-loss')
    if (!brokerPersist) risks.push('broker-loss')
    return { guarantee: 'at-most-once', risks }
  }
  if (!brokerPersist) risks.push('broker-loss')
  if (!idempotentConsumer) {
    risks.push('duplicate')
    return { guarantee: 'at-least-once', risks }
  }
  if (risks.includes('broker-loss')) return { guarantee: 'at-least-once', risks }
  return { guarantee: 'exactly-once', risks: [] }
}

function partitionOf(key, partitions) {
  const text = String(key)
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0
  return h % partitions
}

function orderGuarantee(spec) {
  const { sameKeySamePartition, singleProducer } = spec
  if (!sameKeySamePartition) return { ordered: false, reason: 'different-partitions' }
  if (!singleProducer) return { ordered: false, reason: 'multi-producer' }
  return { ordered: true }
}`,
  tests: `${L1S1}\n${L1S2}\n${L1S3}`
}

/* ============================================================ 第 2 关 */
const LV2 = {
  id: 'lv2',
  title: 'MySQL：B+ 树、最左前缀、MVCC 与死锁',
  emoji: '🗄️',
  xp: 55,
  goal: '实现四个 MySQL 判断器：B+ 树高度（bplusTreeHeight）、联合索引最左前缀命中（leftPrefixMatch）、MVCC 快照可见性（canSee）、等待图死锁检测（detectDeadlock）。',
  why: '「为什么用 B+ 树」「为什么最左前缀」「RR 和 RC 有什么区别」「死锁怎么排查」——这四个问题覆盖了 MySQL 面试 80% 的深度题。每个都能落成一段可跑代码，结论就不再靠背。',
  nodes: ['be.mysql.index', 'be.mysql.index.bplus-tree', 'be.mysql.index.left-prefix-explain', 'be.mysql.transaction', 'be.mysql.transaction.isolation-mvcc', 'be.mysql.transaction.lock-deadlock'],
  thinking: [
    {
      title: 'B+ 树的树高决定了 IO 次数',
      md: 'B+ 树只有叶子存数据，非叶子节点只存键，所以 fanout 大（通常几百），3~4 层就能覆盖上亿行。查一次走一次 IO，树高就是 IO 次数的量级。\n\n这也是「主键要短」的原因：主键越长，每个非叶节点能放的键越少，fanout 越小，树越高。'
    },
    {
      title: '最左前缀是 B+ 树结构的直接后果',
      md: '联合索引 (a,b,c) 是按 a 排序、a 相同按 b 排序、再按 c。跳过 a 直接查 b，B+ 树无法二分定位——只能全扫。\n\n范围查询（a > 1）之后，b、c 的有序性被破坏，所以范围列之后的列只能做过滤、不能做定位。'
    }
  ],
  prereq: [
    {
      title: 'MVCC 的隐藏列与 ReadView',
      md: 'InnoDB 每行有 DB_TRX_ID（最近修改事务）和 DB_ROLL_PTR（undo 指针）。读取时用 ReadView 判断版本是否可见：candidate 的 trx_id 在已提交列表里且小于当前快照才可见。\n\nRR 在事务第一次读时建 ReadView 并复用；RC 每次读都新建。'
    },
    {
      title: '死锁检测的等待图',
      md: 'InnoDB 用等待图（wait-for graph）检测死锁：事务 A 等 B 的锁，B 等 C 的锁，C 等 A → 成环 → 选一个牺牲者回滚。\n\n应用层也能提前预防：固定加锁顺序、缩短事务、用乐观锁版本号。'
    }
  ],
  api: [
    {
      name: 'bplusTreeHeight / leftPrefixMatch',
      sig: 'bplusTreeHeight(rows, fanout) => number；leftPrefixMatch(indexCols, queryCols, { rangeAt }) => { usable, matched }',
      args: 'indexCols 是联合索引列顺序；queryCols 是 WHERE 里用到的列（按任意顺序）。',
      returns: '树高（层数）；是否能用索引与命中列数。',
      example: "leftPrefixMatch(['a','b','c'], ['a','b'])  // → { usable: true, matched: 2 }"
    },
    {
      name: 'canSee',
      sig: 'canSee({ isolation, snapshotCommitId, version, currentRead }) => { visible, reason? }',
      args: 'version: { id, commitId, value }；isolation ∈ rr|rc。',
      returns: '该版本在本次读取中是否可见。',
      example: 'canSee({ isolation: \'rr\', snapshotCommitId: 100, version: { id: 2, commitId: 200 } })'
    },
    {
      name: 'detectDeadlock',
      sig: 'detectDeadlock(waitsFor) => string[] | null',
      args: 'waitsFor: { [trx]: 等待的 trx }，null 表示不等待。',
      returns: '环上的事务（去重）或 null。',
      example: "detectDeadlock({ A: 'B', B: 'A' })  // → ['A', 'B']（顺序不定）"
    }
  ],
  usage: 'const height = bplusTreeHeight(10_000_000, 200)\nconst plan = leftPrefixMatch(["user_id", "status", "created_at"], ["status"])  // 用不上索引\nconst seen = canSee({ isolation: "rr", snapshotCommitId: 100, version: row_version })\nconst deadlock = detectDeadlock(waitGraph)',
  hints: [
    'bplusTreeHeight：树高 = ceil(log(rows)/log(fanout))，但至少 1 层。',
    'leftPrefixMatch：按 indexCols 顺序逐列检查 queryCols 是否包含；遇到 rangeAt 列后停止计数。',
    'canSee：currentRead 直接 true；rc 看 commitId <= 当前；rr 看 commitId < snapshotCommitId。',
    'detectDeadlock 用 DFS：沿 waitsFor 走，遇到已在路径中的节点即找到环。'
  ],
  stages: [
    {
      n: 1,
      title: '先写索引结构判断',
      think: '树高是纯数学，最左前缀是顺序判断。两个都不难，但边界（rows=1、queryCols 顺序）容易错。',
      hint: '树高 = Math.max(1, Math.ceil(Math.log(rows)/Math.log(fanout)))；前缀匹配按索引列序检查。',
      code: `function bplusTreeHeight(rows, fanout) {
  if (rows <= 1) return 1
  return Math.max(1, Math.ceil(Math.log(rows) / Math.log(fanout)))
}

function leftPrefixMatch(indexCols, queryCols, opts = {}) {
  const { rangeAt } = opts
  const used = new Set(queryCols)
  let matched = 0
  for (const col of indexCols) {
    if (!used.has(col)) break
    matched++
    if (rangeAt === col) break
  }
  return { usable: matched > 0, matched }
}`,
      test: L2S1,
      diag: [
        '树高用了 ceil(rows/fanout)（除法）而不是对数。',
        'rows=1 或空表时没有兜底，返回 0 或 NaN。',
        '最左前缀没有按索引列顺序检查，跳列也能命中。',
        '范围列之后没有中断，matched 多算了后面的列。'
      ]
    },
    {
      n: 2,
      title: '再写 MVCC 可见性',
      think: 'RR 用固定快照（小于快照才可见），RC 每次看最新提交，当前读绕开快照。三个分支要分清。',
      hint: 'currentRead → true；rc → commitId <= snapshotCommitId；rr → commitId < snapshotCommitId。',
      code: `function bplusTreeHeight(rows, fanout) {
  if (rows <= 1) return 1
  return Math.max(1, Math.ceil(Math.log(rows) / Math.log(fanout)))
}

function leftPrefixMatch(indexCols, queryCols, opts = {}) {
  const { rangeAt } = opts
  const used = new Set(queryCols)
  let matched = 0
  for (const col of indexCols) {
    if (!used.has(col)) break
    matched++
    if (rangeAt === col) break
  }
  return { usable: matched > 0, matched }
}

function canSee(spec) {
  const { isolation, snapshotCommitId, version, currentRead = false } = spec
  if (currentRead) return { visible: true, reason: 'current-read' }
  if (isolation === 'rc') return { visible: true, reason: 'rc-latest' }
  if (isolation === 'rr') return { visible: version.commitId < snapshotCommitId, reason: 'rr-snapshot' }
  return { visible: false, reason: 'unknown-isolation' }
}`,
      test: L2S2,
      diag: [
        'currentRead 没有绕开快照（for update 读到了旧版本）。',
        'RR 用了 <= 而不是 <，快照事务自己提交的版本被判不可见。',
        'RC 用了固定快照而不是最新 commitId。',
        '未知隔离级别被当成了可见。'
      ]
    },
    {
      n: 3,
      title: '最后写死锁检测',
      think: '等待图找环就是 DFS 检测后向边。环上的事务要返回，而不是只返回「有死锁」。',
      hint: 'DFS：path 记录当前栈，visited 记录已完成；沿 waitsFor 走，遇到 path 中的节点就是环。',
      code: `function bplusTreeHeight(rows, fanout) {
  if (rows <= 1) return 1
  return Math.max(1, Math.ceil(Math.log(rows) / Math.log(fanout)))
}

function leftPrefixMatch(indexCols, queryCols, opts = {}) {
  const { rangeAt } = opts
  const used = new Set(queryCols)
  let matched = 0
  for (const col of indexCols) {
    if (!used.has(col)) break
    matched++
    if (rangeAt === col) break
  }
  return { usable: matched > 0, matched }
}

function canSee(spec) {
  const { isolation, snapshotCommitId, version, currentRead = false } = spec
  if (currentRead) return { visible: true, reason: 'current-read' }
  if (isolation === 'rc') return { visible: true, reason: 'rc-latest' }
  if (isolation === 'rr') return { visible: version.commitId < snapshotCommitId, reason: 'rr-snapshot' }
  return { visible: false, reason: 'unknown-isolation' }
}

function detectDeadlock(waitsFor) {
  const visited = new Set()
  const inPath = new Set()
  const path = []

  function dfs(node) {
    if (inPath.has(node)) {
      const start = path.indexOf(node)
      return path.slice(start)
    }
    if (visited.has(node)) return null
    visited.add(node)
    inPath.add(node)
    path.push(node)
    const next = waitsFor[node]
    if (next != null) {
      const cycle = dfs(next)
      if (cycle) return cycle
    }
    path.pop()
    inPath.delete(node)
    return null
  }

  for (const node of Object.keys(waitsFor)) {
    const cycle = dfs(node)
    if (cycle) return cycle
  }
  return null
}`,
      test: L2S3,
      diag: [
        '只判断了有环，没有返回环上的事务列表。',
        'DFS 没有 inPath 标记，遇到环一直递归（栈溢出）。',
        '自环（A→A）没有识别。',
        '长环返回了整条路径而不是从环起点开始的部分。'
      ]
    }
  ],
  skeleton: `function bplusTreeHeight(rows, fanout) { throw new Error('还没实现') }
function leftPrefixMatch(indexCols, queryCols, opts) { throw new Error('还没实现') }
function canSee(spec) { throw new Error('还没实现') }
function detectDeadlock(waitsFor) { throw new Error('还没实现') }`,
  solution: `function bplusTreeHeight(rows, fanout) {
  if (rows <= 1) return 1
  return Math.max(1, Math.ceil(Math.log(rows) / Math.log(fanout)))
}

function leftPrefixMatch(indexCols, queryCols, opts = {}) {
  const { rangeAt } = opts
  const used = new Set(queryCols)
  let matched = 0
  for (const col of indexCols) {
    if (!used.has(col)) break
    matched++
    if (rangeAt === col) break
  }
  return { usable: matched > 0, matched }
}

function canSee(spec) {
  const { isolation, snapshotCommitId, version, currentRead = false } = spec
  if (currentRead) return { visible: true, reason: 'current-read' }
  if (isolation === 'rc') return { visible: true, reason: 'rc-latest' }
  if (isolation === 'rr') return { visible: version.commitId < snapshotCommitId, reason: 'rr-snapshot' }
  return { visible: false, reason: 'unknown-isolation' }
}

function detectDeadlock(waitsFor) {
  const visited = new Set()
  const inPath = new Set()
  const path = []

  function dfs(node) {
    if (inPath.has(node)) {
      const start = path.indexOf(node)
      return path.slice(start)
    }
    if (visited.has(node)) return null
    visited.add(node)
    inPath.add(node)
    path.push(node)
    const next = waitsFor[node]
    if (next != null) {
      const cycle = dfs(next)
      if (cycle) return cycle
    }
    path.pop()
    inPath.delete(node)
    return null
  }

  for (const node of Object.keys(waitsFor)) {
    const cycle = dfs(node)
    if (cycle) return cycle
  }
  return null
}`,
  finalCode: `function bplusTreeHeight(rows, fanout) {
  if (rows <= 1) return 1
  return Math.max(1, Math.ceil(Math.log(rows) / Math.log(fanout)))
}

function leftPrefixMatch(indexCols, queryCols, opts = {}) {
  const { rangeAt } = opts
  const used = new Set(queryCols)
  let matched = 0
  for (const col of indexCols) {
    if (!used.has(col)) break
    matched++
    if (rangeAt === col) break
  }
  return { usable: matched > 0, matched }
}

function canSee(spec) {
  const { isolation, snapshotCommitId, version, currentRead = false } = spec
  if (currentRead) return { visible: true, reason: 'current-read' }
  if (isolation === 'rc') return { visible: true, reason: 'rc-latest' }
  if (isolation === 'rr') return { visible: version.commitId < snapshotCommitId, reason: 'rr-snapshot' }
  return { visible: false, reason: 'unknown-isolation' }
}

function detectDeadlock(waitsFor) {
  const visited = new Set()
  const inPath = new Set()
  const path = []

  function dfs(node) {
    if (inPath.has(node)) {
      const start = path.indexOf(node)
      return path.slice(start)
    }
    if (visited.has(node)) return null
    visited.add(node)
    inPath.add(node)
    path.push(node)
    const next = waitsFor[node]
    if (next != null) {
      const cycle = dfs(next)
      if (cycle) return cycle
    }
    path.pop()
    inPath.delete(node)
    return null
  }

  for (const node of Object.keys(waitsFor)) {
    const cycle = dfs(node)
    if (cycle) return cycle
  }
  return null
}`,
  tests: `${L2S1}\n${L2S2}\n${L2S3}`
}

/* ============================================================ 第 3 关 */
const LV3 = {
  id: 'lv3',
  title: '日志复制与 JDBC：位点重放、精度与映射',
  emoji: '📋',
  xp: 55,
  goal: '实现三块数据一致性工具：binlog 位点重放（applyRelayLog + replicationLagMs）、BigDecimal 精度计算（addDecimalStrings + roundHalfUp + jdbcTypeOf）、RowMapper 列映射（snakeToCamel + mapRow）。',
  why: '这些是「线上数据对不上」的常见根因：从库重放不幂等导致数据翻倍、金额用 double 算导致 0.01 丢失、列名映射错了导致字段永远 null。它们都不难，但必须写成可测代码。',
  nodes: ['be.mysql.log', 'be.mysql.log.redo-binlog-replication', 'be.mysql.jdbc-type-mapping', 'be.mysql.jdbc-type-mapping.bigdecimal-precision', 'be.mysql.jdbc-type-mapping.rowmapper-naming', 'be.mysql.jdbc-type-mapping.type-mapping'],
  thinking: [
    {
      title: '位点重放为什么要幂等',
      md: '从库同步 binlog 时，网络抖动/主从切换都可能让同一位点的事件被重复应用。所以重放逻辑必须「按 pos 去重」，而不是「来一条应用一条」。\n\n同理，Kafka 消费者、任务队列的 checkpoint 也是这个套路：位点 + 幂等。'
    },
    {
      title: '金额为什么必须用 BigDecimal',
      md: '0.1 + 0.2 === 0.30000000000000004（IEEE754）。金额计算必须用整数分或 BigDecimal，且舍入模式要显式（HALF_UP 是最常见的财务口径）。\n\n序列化时也要注意：BigDecimal 转 JSON 用字符串，别用 double。'
    }
  ],
  prereq: [
    {
      title: 'redo log 与 binlog 的分工',
      md: 'redo log 是 InnoDB 的物理日志（页面修改），循环写，用于崩溃恢复；binlog 是 Server 层的逻辑日志（SQL/行变更），追加写，用于主从复制与归档。\n\n两阶段提交保证两者一致：prepare redo → 写 binlog → commit redo。'
    },
    {
      title: 'JDBC 类型映射的坑',
      md: 'MySQL 的 DECIMAL 到 Java 的 BigDecimal 是精确映射；但代码里如果先 getDouble 再转，精度就丢了。日期、时间戳、TINYINT(1)→Boolean 都是常见映射歧义点。'
    }
  ],
  api: [
    {
      name: 'applyRelayLog / replicationLagMs',
      sig: 'applyRelayLog(state, events, fromPos) => { pos, applied }；replicationLagMs(masterPos, slavePos, msPerEvent) => number',
      args: 'events: { pos, op, key }[]；state: { pos, applied: string[] }。',
      returns: '新的位点与已应用 key；延迟毫秒（从库领先按 0）。',
      example: 'applyRelayLog({ pos: 1, applied: [\'k1\'] }, events, 1)'
    },
    {
      name: 'addDecimalStrings / roundHalfUp / jdbcTypeOf',
      sig: 'addDecimalStrings(parts) => string；roundHalfUp(value, scale) => string；jdbcTypeOf(value) => string',
      args: 'parts 是十进制字符串数组；scale 是保留小数位。',
      returns: '精确相加的字符串；四舍五入结果；JDBC 类型名。',
      example: "addDecimalStrings(['0.1', '0.2'])  // → '0.3'"
    },
    {
      name: 'snakeToCamel / mapRow',
      sig: 'snakeToCamel(name) => string；mapRow(row, mapping) => object',
      args: 'mapping: { dbColumn: propName }。',
      returns: '驼峰属性名；只包含映射表中出现的字段。',
      example: "mapRow({ user_name: 'alice' }, { user_name: 'userName' })  // → { userName: 'alice' }"
    }
  ],
  usage: 'let sync = { pos: 0, applied: [] }\nsync = applyRelayLog(sync, binlogEvents, sync.pos)\n\nconst total = addDecimalStrings([price1, price2])       // 不要用 Number\nconst rounded = roundHalfUp(total, 2)\n\nconst dto = mapRow(row, { user_name: "userName", user_age: "age" })',
  hints: [
    'applyRelayLog：过滤 pos > fromPos，按 pos 排序，应用时检查 key 是否已 applied。',
    'addDecimalStrings：转成整数分（×100 并四舍五入到整数），相加后拼回字符串。',
    'roundHalfUp：用整数偏移实现四舍五入，避免 toFixed 的银行家舍入差异。'
  ],
  stages: [
    {
      n: 1,
      title: '先写位点重放',
      think: '重放的核心是「位点 + 去重」：只应用比当前位点新的事件，同一个 key 不重复应用。',
      hint: 'filter(e.pos > fromPos) → sort → 逐个：若 key 未 applied 则应用并推进 pos。',
      code: `function applyRelayLog(state, events, fromPos) {
  const pending = events.filter((e) => e.pos > fromPos).sort((a, b) => a.pos - b.pos)
  const applied = [...state.applied]
  let pos = Math.max(state.pos, fromPos)
  for (const e of pending) {
    if (applied.includes(e.key)) {
      pos = Math.max(pos, e.pos)
      continue
    }
    applied.push(e.key)
    pos = e.pos
  }
  return { pos, applied }
}

function replicationLagMs(masterPos, slavePos, msPerEvent) {
  if (slavePos >= masterPos) return 0
  return (masterPos - slavePos) * msPerEvent
}`,
      test: L3S1,
      diag: [
        '没有过滤 pos > fromPos，历史事件被重放。',
        '没有按 pos 排序，乱序应用导致状态错乱。',
        '没有去重，同一 key 被应用两次（数据翻倍）。',
        '从库位点领先时返回负数延迟。'
      ]
    },
    {
      n: 2,
      title: '再写金额精度',
      think: '所有金额运算先转整数分，算完再拼回字符串；舍入用整数偏移，不依赖浮点 toFixed。',
      hint: 'toCents：Number(去点后整数)（用字符串操作，别 parseFloat）；相加后按 scale 拼点。',
      code: `function applyRelayLog(state, events, fromPos) {
  const pending = events.filter((e) => e.pos > fromPos).sort((a, b) => a.pos - b.pos)
  const applied = [...state.applied]
  let pos = Math.max(state.pos, fromPos)
  for (const e of pending) {
    if (applied.includes(e.key)) {
      pos = Math.max(pos, e.pos)
      continue
    }
    applied.push(e.key)
    pos = e.pos
  }
  return { pos, applied }
}

function replicationLagMs(masterPos, slavePos, msPerEvent) {
  if (slavePos >= masterPos) return 0
  return (masterPos - slavePos) * msPerEvent
}

function toCents(text) {
  const [intPart, frac = ''] = String(text).split('.')
  const sign = intPart.startsWith('-') ? -1 : 1
  const absInt = Math.abs(Number(intPart))
  const fracPadded = (frac + '00').slice(0, 2)
  return sign * (absInt * 100 + Number(fracPadded))
}

function addDecimalStrings(parts) {
  const cents = parts.reduce((a, p) => a + toCents(p), 0)
  return centsToString(cents)
}

function roundHalfUp(value, scale) {
  const s = String(value)
  const neg = s.startsWith('-')
  const [intPart, frac = ''] = (neg ? s.slice(1) : s).split('.')
  const digits = intPart + (frac + '0'.repeat(scale + 1)).slice(0, scale + 1)
  const keep = digits.slice(0, digits.length - 1)
  const last = Number(digits.slice(-1))
  let n = Number(keep)
  if (last >= 5) n += 1
  const padded = String(n).padStart(scale + 1, '0')
  const outInt = scale > 0 ? padded.slice(0, padded.length - scale) : padded
  const outFrac = scale > 0 ? padded.slice(-scale) : ''
  return (neg ? '-' : '') + outInt + (scale > 0 ? '.' + outFrac : '')
}

function centsToString(cents) {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const frac = String(abs % 100).padStart(2, '0').replace(/0+$/, '')
  return sign + Math.floor(abs / 100) + (frac ? '.' + frac : '')
}

function jdbcTypeOf(value) {
  if (typeof value === 'boolean') return 'BOOLEAN'
  if (typeof value === 'number') return Number.isInteger(value) ? 'BIGINT' : 'DOUBLE'
  if (typeof value === 'string') {
    if (/^-?\\d+\\.\\d+$/.test(value)) return 'DECIMAL'
    if (/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return 'DATE'
    return 'VARCHAR'
  }
  return 'NULL'
}`,
      test: L3S2,
      diag: [
        '金额用了 Number 相加，0.1+0.2 出现浮点尾巴。',
        '舍入用了 toFixed（银行家舍入），与 HALF_UP 不一致。',
        'jdbcTypeOf 把带小数的字符串识别成 VARCHAR。',
        '整数被识别成 DECIMAL（应该 BIGINT）。'
      ]
    },
    {
      n: 3,
      title: '最后写 RowMapper 映射',
      think: '列名到属性名是纯字符串映射；关键在「只映射表里声明过的列」，多余列不能偷偷带出。',
      hint: 'snakeToCamel 按 _ 分段首字母大写；mapRow 遍历 mapping，row[dbCol] 取不到就是 undefined。',
      code: `function applyRelayLog(state, events, fromPos) {
  const pending = events.filter((e) => e.pos > fromPos).sort((a, b) => a.pos - b.pos)
  const applied = [...state.applied]
  let pos = Math.max(state.pos, fromPos)
  for (const e of pending) {
    if (applied.includes(e.key)) {
      pos = Math.max(pos, e.pos)
      continue
    }
    applied.push(e.key)
    pos = e.pos
  }
  return { pos, applied }
}

function replicationLagMs(masterPos, slavePos, msPerEvent) {
  if (slavePos >= masterPos) return 0
  return (masterPos - slavePos) * msPerEvent
}

function toCents(text) {
  const [intPart, frac = ''] = String(text).split('.')
  const sign = intPart.startsWith('-') ? -1 : 1
  const absInt = Math.abs(Number(intPart))
  const fracPadded = (frac + '00').slice(0, 2)
  return sign * (absInt * 100 + Number(fracPadded))
}

function centsToString(cents) {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const frac = String(abs % 100).padStart(2, '0').replace(/0+$/, '')
  return sign + Math.floor(abs / 100) + (frac ? '.' + frac : '')
}

function addDecimalStrings(parts) {
  const cents = parts.reduce((a, p) => a + toCents(p), 0)
  return centsToString(cents)
}

function roundHalfUp(value, scale) {
  const s = String(value)
  const neg = s.startsWith('-')
  const [intPart, frac = ''] = (neg ? s.slice(1) : s).split('.')
  const digits = intPart + (frac + '0'.repeat(scale + 1)).slice(0, scale + 1)
  const keep = digits.slice(0, digits.length - 1)
  const last = Number(digits.slice(-1))
  let n = Number(keep)
  if (last >= 5) n += 1
  const padded = String(n).padStart(scale + 1, '0')
  const outInt = scale > 0 ? padded.slice(0, padded.length - scale) : padded
  const outFrac = scale > 0 ? padded.slice(-scale) : ''
  return (neg ? '-' : '') + outInt + (scale > 0 ? '.' + outFrac : '')
}

function jdbcTypeOf(value) {
  if (typeof value === 'boolean') return 'BOOLEAN'
  if (typeof value === 'number') return Number.isInteger(value) ? 'BIGINT' : 'DOUBLE'
  if (typeof value === 'string') {
    if (/^-?\\d+\\.\\d+$/.test(value)) return 'DECIMAL'
    if (/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return 'DATE'
    return 'VARCHAR'
  }
  return 'NULL'
}

function snakeToCamel(name) {
  const parts = String(name).split('_').filter(Boolean)
  return parts.map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1))).join('')
}

function mapRow(row, mapping) {
  const out = {}
  for (const [dbCol, prop] of Object.entries(mapping)) {
    out[prop] = row[dbCol]
  }
  return out
}`,
      test: L3S3,
      diag: [
        'snakeToCamel 第一个字母也被大写了（User_Name → UserName）。',
        'mapRow 把整行都复制了，没有按映射表过滤。',
        '缺列时抛错，应该给 undefined。',
        '映射方向反了（用属性名去查列）。'
      ]
    }
  ],
  skeleton: `function applyRelayLog(state, events, fromPos) { throw new Error('还没实现') }
function replicationLagMs(masterPos, slavePos, msPerEvent) { throw new Error('还没实现') }
function addDecimalStrings(parts) { throw new Error('还没实现') }
function roundHalfUp(value, scale) { throw new Error('还没实现') }
function jdbcTypeOf(value) { throw new Error('还没实现') }
function snakeToCamel(name) { throw new Error('还没实现') }
function mapRow(row, mapping) { throw new Error('还没实现') }`,
  solution: `function applyRelayLog(state, events, fromPos) {
  const pending = events.filter((e) => e.pos > fromPos).sort((a, b) => a.pos - b.pos)
  const applied = [...state.applied]
  let pos = Math.max(state.pos, fromPos)
  for (const e of pending) {
    if (applied.includes(e.key)) {
      pos = Math.max(pos, e.pos)
      continue
    }
    applied.push(e.key)
    pos = e.pos
  }
  return { pos, applied }
}

function replicationLagMs(masterPos, slavePos, msPerEvent) {
  if (slavePos >= masterPos) return 0
  return (masterPos - slavePos) * msPerEvent
}

function toCents(text) {
  const [intPart, frac = ''] = String(text).split('.')
  const sign = intPart.startsWith('-') ? -1 : 1
  const absInt = Math.abs(Number(intPart))
  const fracPadded = (frac + '00').slice(0, 2)
  return sign * (absInt * 100 + Number(fracPadded))
}

function centsToString(cents) {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const frac = String(abs % 100).padStart(2, '0').replace(/0+$/, '')
  return sign + Math.floor(abs / 100) + (frac ? '.' + frac : '')
}

function addDecimalStrings(parts) {
  const cents = parts.reduce((a, p) => a + toCents(p), 0)
  return centsToString(cents)
}

function roundHalfUp(value, scale) {
  const s = String(value)
  const neg = s.startsWith('-')
  const [intPart, frac = ''] = (neg ? s.slice(1) : s).split('.')
  const digits = intPart + (frac + '0'.repeat(scale + 1)).slice(0, scale + 1)
  const keep = digits.slice(0, digits.length - 1)
  const last = Number(digits.slice(-1))
  let n = Number(keep)
  if (last >= 5) n += 1
  const padded = String(n).padStart(scale + 1, '0')
  const outInt = scale > 0 ? padded.slice(0, padded.length - scale) : padded
  const outFrac = scale > 0 ? padded.slice(-scale) : ''
  return (neg ? '-' : '') + outInt + (scale > 0 ? '.' + outFrac : '')
}

function jdbcTypeOf(value) {
  if (typeof value === 'boolean') return 'BOOLEAN'
  if (typeof value === 'number') return Number.isInteger(value) ? 'BIGINT' : 'DOUBLE'
  if (typeof value === 'string') {
    if (/^-?\\d+\\.\\d+$/.test(value)) return 'DECIMAL'
    if (/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return 'DATE'
    return 'VARCHAR'
  }
  return 'NULL'
}

function snakeToCamel(name) {
  const parts = String(name).split('_').filter(Boolean)
  return parts.map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1))).join('')
}

function mapRow(row, mapping) {
  const out = {}
  for (const [dbCol, prop] of Object.entries(mapping)) {
    out[prop] = row[dbCol]
  }
  return out
}`,
  finalCode: `function applyRelayLog(state, events, fromPos) {
  const pending = events.filter((e) => e.pos > fromPos).sort((a, b) => a.pos - b.pos)
  const applied = [...state.applied]
  let pos = Math.max(state.pos, fromPos)
  for (const e of pending) {
    if (applied.includes(e.key)) {
      pos = Math.max(pos, e.pos)
      continue
    }
    applied.push(e.key)
    pos = e.pos
  }
  return { pos, applied }
}

function replicationLagMs(masterPos, slavePos, msPerEvent) {
  if (slavePos >= masterPos) return 0
  return (masterPos - slavePos) * msPerEvent
}

function toCents(text) {
  const [intPart, frac = ''] = String(text).split('.')
  const sign = intPart.startsWith('-') ? -1 : 1
  const absInt = Math.abs(Number(intPart))
  const fracPadded = (frac + '00').slice(0, 2)
  return sign * (absInt * 100 + Number(fracPadded))
}

function centsToString(cents) {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const frac = String(abs % 100).padStart(2, '0').replace(/0+$/, '')
  return sign + Math.floor(abs / 100) + (frac ? '.' + frac : '')
}

function addDecimalStrings(parts) {
  const cents = parts.reduce((a, p) => a + toCents(p), 0)
  return centsToString(cents)
}

function roundHalfUp(value, scale) {
  const s = String(value)
  const neg = s.startsWith('-')
  const [intPart, frac = ''] = (neg ? s.slice(1) : s).split('.')
  const digits = intPart + (frac + '0'.repeat(scale + 1)).slice(0, scale + 1)
  const keep = digits.slice(0, digits.length - 1)
  const last = Number(digits.slice(-1))
  let n = Number(keep)
  if (last >= 5) n += 1
  const padded = String(n).padStart(scale + 1, '0')
  const outInt = scale > 0 ? padded.slice(0, padded.length - scale) : padded
  const outFrac = scale > 0 ? padded.slice(-scale) : ''
  return (neg ? '-' : '') + outInt + (scale > 0 ? '.' + outFrac : '')
}

function jdbcTypeOf(value) {
  if (typeof value === 'boolean') return 'BOOLEAN'
  if (typeof value === 'number') return Number.isInteger(value) ? 'BIGINT' : 'DOUBLE'
  if (typeof value === 'string') {
    if (/^-?\\d+\\.\\d+$/.test(value)) return 'DECIMAL'
    if (/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return 'DATE'
    return 'VARCHAR'
  }
  return 'NULL'
}

function snakeToCamel(name) {
  const parts = String(name).split('_').filter(Boolean)
  return parts.map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1))).join('')
}

function mapRow(row, mapping) {
  const out = {}
  for (const [dbCol, prop] of Object.entries(mapping)) {
    out[prop] = row[dbCol]
  }
  return out
}`,
  tests: `${L3S1}\n${L3S2}\n${L3S3}`
}

export default {
  id: 'be-mysql',
  version: 3,
  domain: 'be',
  cumulative: false,
  title: 'MySQL 与消息队列',
  emoji: '🗄️',
  tagline: '3 关：MQ 投递语义与顺序、B+ 树/MVCC/死锁、binlog 重放与 JDBC 精度映射。',
  stack: ['MySQL', '消息队列', '数据一致性'],
  intro: 'MySQL 与 MQ 的面试题很少考「有哪些组件」，考的是「不丢不重怎么保证」「索引为什么这样走」「RR 和 RC 差在哪」「金额为什么不能 double」。这个项目把这些判断落成可跑代码，让每个结论都能被测试验证。',
  outcome: '你能按吞吐/路由/回放选 MQ、说清至少一次与恰好一次的组合条件；讲清 B+ 树高度与最左前缀、MVCC 可见性、死锁环；实现幂等位点重放与精确金额计算。',
  levels: [LV1, LV2, LV3]
}