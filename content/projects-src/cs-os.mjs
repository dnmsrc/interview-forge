/**
 * cs-os —— 操作系统三关：进程与调度、同步与死锁、虚拟内存。
 * 分配见 data/plans/cs-os.json。
 */

/* ============================================================ 第 1 关测试 */
const L1S1 = `{
  var procs = [
    { id: 'P1', arrival: 0, burst: 7 },
    { id: 'P2', arrival: 2, burst: 4 },
    { id: 'P3', arrival: 4, burst: 1 },
    { id: 'P4', arrival: 5, burst: 4 }
  ]
  var avg = (rows) => rows.reduce((s, r) => s + r.waiting, 0) / rows.length

  check('FCFS：完成时间与等待时间', () => {
    const rows = simulateFcfs(procs)
    same(rows.map((r) => r.finish), [7, 11, 12, 16])
    same(rows.map((r) => r.waiting), [0, 5, 7, 7])
  })
  check('SJF（非抢占）：平均等待优于 FCFS', () => {
    same(avg(simulateFcfs(procs)), 4.75)
    same(avg(simulateSjf(procs)), 4)
  })
  check('SJF 不会执行还没到达的进程', () => {
    const rows = simulateSjf([
      { id: 'A', arrival: 5, burst: 1 },
      { id: 'B', arrival: 0, burst: 3 }
    ])
    same(rows.map((r) => r.id), ['B', 'A'])
    same([rows[0].finish, rows[0].waiting], [3, 0])
    same([rows[1].finish, rows[1].waiting], [6, 0])
  })
  check('FCFS 结果按到达时间排列，与传入顺序无关', () => {
    const rows = simulateFcfs([
      { id: 'B', arrival: 10, burst: 1 },
      { id: 'A', arrival: 0, burst: 2 }
    ])
    same(rows.map((r) => r.id), ['A', 'B'])
    same(rows.map((r) => r.finish), [2, 11])
  })
  check('空进程列表返回空结果', () => {
    same(simulateFcfs([]), [])
    same(simulateSjf([]), [])
  })
}`

const L1S2 = `{
  check('时间片轮转：每个进程最多连续跑 quantum', () => {
    const r = simulateRr([
      { id: 'P1', arrival: 0, burst: 3 },
      { id: 'P2', arrival: 1, burst: 1 }
    ], 1)
    same(r.timeline.map((t) => t.id), ['P1', 'P2', 'P1', 'P1'])
    same(r.timeline.map((t) => t.to - t.from), [1, 1, 1, 1])
  })
  check('时间片轮转：完成时间与周转时间', () => {
    const r = simulateRr([
      { id: 'P1', arrival: 0, burst: 3 },
      { id: 'P2', arrival: 1, burst: 1 }
    ], 1)
    same(r.rows.map((x) => x.finish), [4, 2], 'P1 的 3 个单位被 P2 插了一刀，总耗时 4')
    same(r.rows.map((x) => x.waiting), [1, 0])
  })
  check('quantum 大于最大 burst 时退化为 FCFS', () => {
    const procs = [
      { id: 'A', arrival: 0, burst: 2 },
      { id: 'B', arrival: 0, burst: 1 }
    ]
    const rr = simulateRr(procs, 100)
    const fcfs = simulateFcfs(procs)
    same(rr.rows.map((x) => x.finish), fcfs.map((x) => x.finish))
    same(rr.timeline.length, 2, '每个进程只被调度一次')
  })
  check('切换次数 = 时间片段数', () => {
    const r = simulateRr([
      { id: 'P1', arrival: 0, burst: 5 },
      { id: 'P2', arrival: 0, burst: 5 }
    ], 2)
    same(r.timeline.length, 6, '5+5 合计 10 个单位，每片 2 → 5 片？按剩余切分是最多 6 片')
  })
  check('RR 的响应时间比 FCFS 更均匀（第二个进程不用等第一个跑完）', () => {
    const procs = [
      { id: 'A', arrival: 0, burst: 6 },
      { id: 'B', arrival: 1, burst: 1 }
    ]
    const rr = simulateRr(procs, 2)
    const firstStart = (list) => {
      const out = {}
      for (const t of list) if (out[t.id] === undefined) out[t.id] = t.from
      return out
    }
    same(firstStart(rr.timeline).B, 2, 'RR 里 B 在 2 就开始')
    ok(firstStart(simulateRr(procs, 100).timeline).B >= 6, 'FCFS 里 B 要等 A 跑完')
  })
}`

const L1S3 = `{
  check('需要故障隔离 → 进程', () => {
    same(recommendModel({ workload: 'cpu', needIsolation: true }).model, 'process')
    same(recommendModel({ workload: 'io', crashIsolation: true }).model, 'process')
  })
  check('CPU 密集 → 线程池，线程数≈核数', () => {
    const r = recommendModel({ workload: 'cpu', needSharedMemory: true })
    same(r.model, 'thread-pool')
    same(r.size, 'cpuCount')
  })
  check('I/O 密集 → 线程池，可多开等 I/O', () => {
    const r = recommendModel({ workload: 'io' })
    same(r.model, 'thread-pool')
    same(r.size, 'io-bound')
  })
  check('需要共享大块内存且无隔离要求 → 线程', () => {
    same(recommendModel({ workload: 'cpu', needSharedMemory: true }).model, 'thread-pool')
    same(recommendModel({ needSharedMemory: true }).model, 'thread')
  })
  check('隔离优先于所有其他条件', () => {
    const r = recommendModel({ workload: 'io', needSharedMemory: true, needIsolation: true })
    same(r.model, 'process')
  })
}`

/* ============================================================ 第 1 关代码 */
const L1C1 = `function simulateFcfs(procs) {
  const sorted = procs.slice().sort((a, b) => a.arrival - b.arrival)
  let clock = 0
  const out = []
  for (const p of sorted) {
    clock = Math.max(clock, p.arrival) + p.burst
    out.push({
      id: p.id,
      finish: clock,
      turnaround: clock - p.arrival,
      waiting: clock - p.arrival - p.burst
    })
  }
  return out
}

function simulateSjf(procs) {
  const pending = procs.slice()
  let clock = 0
  const out = []
  while (pending.length) {
    const arrived = pending.filter((p) => p.arrival <= clock)
    if (!arrived.length) {
      clock = Math.min.apply(null, pending.map((p) => p.arrival))
      continue
    }
    arrived.sort((a, b) => a.burst - b.burst || a.arrival - b.arrival)
    const p = arrived[0]
    pending.splice(pending.indexOf(p), 1)
    clock += p.burst
    out.push({
      id: p.id,
      finish: clock,
      turnaround: clock - p.arrival,
      waiting: clock - p.arrival - p.burst
    })
  }
  return out
}`

const L1C2 = `${L1C1}

function simulateRr(procs, quantum) {
  const order = procs.slice().sort((a, b) => a.arrival - b.arrival)
  const remain = new Map()
  for (const p of order) remain.set(p.id, p.burst)
  const done = new Map()
  const timeline = []
  const queue = []
  let idx = 0
  let clock = 0

  while (idx < order.length || queue.length) {
    while (idx < order.length && order[idx].arrival <= clock) {
      queue.push(order[idx])
      idx++
    }
    if (!queue.length) {
      clock = order[idx].arrival
      continue
    }
    const p = queue.shift()
    const left = remain.get(p.id)
    const slice = Math.min(quantum, left)
    clock += slice
    timeline.push({ id: p.id, from: clock - slice, to: clock })
    const rest = left - slice
    remain.set(p.id, rest)
    if (rest === 0) {
      done.set(p.id, {
        id: p.id,
        finish: clock,
        turnaround: clock - p.arrival,
        waiting: clock - p.arrival - p.burst
      })
    } else {
      while (idx < order.length && order[idx].arrival <= clock) {
        queue.push(order[idx])
        idx++
      }
      queue.push(p)
    }
  }

  return { rows: order.map((p) => done.get(p.id)), timeline }
}`

const L1C3 = `${L1C2}

function recommendModel(req) {
  if (req.needIsolation || req.crashIsolation) {
    return { model: 'process', reason: '需要地址空间隔离，一个实例崩溃不拖垮其他实例' }
  }
  if (req.workload === 'cpu') {
    return { model: 'thread-pool', size: 'cpuCount', reason: 'CPU 密集：线程数≈核数，再多只会增加上下文切换' }
  }
  if (req.workload === 'io') {
    return { model: 'thread-pool', size: 'io-bound', reason: 'I/O 密集：等待期间出让 CPU，可多开线程或走异步' }
  }
  if (req.needSharedMemory) {
    return { model: 'thread', reason: '需要共享大块内存，线程直接读写，省掉 IPC 拷贝' }
  }
  return { model: 'thread', reason: '默认同进程线程，创建和切换成本都低于进程' }
}`

/* ============================================================ 第 1 关 */
const LV1 = {
  id: 'lv1',
  title: '进程与调度：谁先跑、跑多久、切换几次',
  emoji: '⚙️',
  xp: 50,
  goal: '实现 simulateFcfs/simulateSjf（非抢占调度）与 simulateRr（时间片轮转，返回时间线），以及 recommendModel（进程/线程/线程池的选型判定）。',
  why: '「进程和线程的区别」谁都会背，但面试官接着问「FCFS 和 SJF 的平均等待差多少」「时间片设多大」时，只有真的算过才能答。调度算法的差别全部体现在完成时间、等待时间、切换次数三个数字上；线程模型的差别则体现在「共享什么、隔离什么」上。',
  nodes: ['cs.os.process', 'cs.os.process.context-switch', 'cs.os.process.scheduling', 'cs.os.process.thread-models', 'cs.os.process.thread-vs-process'],
  thinking: [
    {
      title: '调度指标：完成时间、周转时间、等待时间',
      md: '完成时间 = 进程结束的时刻；周转时间 = 完成 − 到达；等待时间 = 周转 − 服务时间。\n\n面试常问「平均等待时间」，因为它是唯一直接反映「用户等多久」的指标。FCFS 的问题是「长任务堵住后面所有短任务」（护航效应），SJF 恰好相反——牺牲长任务换平均等待。'
    },
    {
      title: '时间片轮转的两个极端',
      md: 'quantum → ∞ 时 RR 退化成 FCFS；quantum → 0 时切换开销吞掉所有有效时间。\n\n所以时间片是「响应性」与「吞吐量」的折中：通常取 10~100ms，且比上下文切换成本（微秒级）大两个数量级。'
    },
    {
      title: '进程与线程的真实差别在「共享」',
      md: '进程有独立地址空间、独立页表、独立文件描述符表；线程共享地址空间、堆、全局变量，但各自有栈和寄存器。\n\n所以「共享数据」用线程（零拷贝），「故障隔离」用进程（崩溃不扩散），「CPU 密集」用固定大小线程池（避免切换开销），「I/O 密集」要么多线程要么异步。'
    }
  ],
  prereq: [
    {
      title: '上下文切换到底保存了什么',
      md: '保存寄存器（PC、SP、通用寄存器）、页表基址（CR3）、浮点/SIMD 状态；切换到另一个进程时还要换页表（TLB 可能失效）。\n\n所以进程切换比线程切换贵：线程切换不换页表，TLB 命中率不受影响；进程切换后 TLB 大面积失效，要重新加载。'
    },
    {
      title: '非抢占 vs 抢占',
      md: 'FCFS 和 SJF（非抢占版）一旦开始就一直跑到结束；RR 是抢占式（时间片到期强制切换）。\n\n抢占让响应时间可控，代价是切换开销和锁竞争更复杂（临界区可能被抢占，所以要关中断或加锁保护）。'
    }
  ],
  api: [
    {
      name: 'simulateFcfs / simulateSjf',
      sig: 'simulateFcfs(procs) => rows[]；simulateSjf(procs) => rows[]',
      args: 'procs: [{ id, arrival, burst }]，时间是整数。',
      returns: 'rows: [{ id, finish, turnaround, waiting }]，按执行顺序排列。',
      example: 'simulateFcfs([{id:"P1",arrival:0,burst:7}])  // [{id:"P1",finish:7,turnaround:7,waiting:0}]'
    },
    {
      name: 'simulateRr',
      sig: 'simulateRr(procs, quantum) => { rows, timeline }',
      args: 'quantum 是时间片大小。',
      returns: 'rows 按到达顺序；timeline: [{ id, from, to }] 是实际执行片段。',
      example: 'simulateRr([{id:"P1",arrival:0,burst:3}], 1).timeline.length  // 3'
    },
    {
      name: 'recommendModel',
      sig: 'recommendModel(req) => { model, size?, reason }',
      args: 'req: { workload?: "cpu"|"io", needSharedMemory?: boolean, needIsolation?: boolean, crashIsolation?: boolean }',
      returns: 'model 取 "process" | "thread" | "thread-pool"；线程池带 size。',
      example: 'recommendModel({ workload: "cpu" })  // { model: "thread-pool", size: "cpuCount" }'
    }
  ],
  usage: '// 线上对应的现象：\n//   平均等待高 + 短任务多 → 考虑 SJF/优先级（Linux 的 CFS 用 vruntime 近似）\n//   切换次数异常高 → 时间片太小 / 锁竞争激烈\n//   CPU 密集服务开几百线程 → 切换开销吞吞吐，应降到核数附近',
  hints: [
    '第 1 步：FCFS 只排序；SJF 每次在「已到达」里挑 burst 最小，没有就跳到下一个到达时刻。',
    '第 2 步：RR 用队列，每次跑 min(quantum, 剩余)；注意新到达要先入队再把自己放回队尾。',
    '第 3 步：先判隔离，再判 CPU/IO，最后才看共享内存。'
  ],
  concepts: [
    {
      title: '为什么 Linux 不用教科书上的 SJF',
      md: 'SJF 需要预知 burst 时间，现实中无法知道；且长任务会饿死。\n\nLinux 的 CFS 用「虚拟运行时间」（vruntime）近似公平：跑得少的进程 vruntime 小，优先被调度，长任务也会随着时间被补偿。这是「公平」替代「最短优先」的工程解。'
    },
    {
      title: '线程数到底设多少',
      md: 'CPU 密集：N+1（N 为核数），多一个处理偶发阻塞；I/O 密集：N × (1 + 等待时间/计算时间)，等待占比越高线程越多。\n\n但 I/O 密集更推荐异步（epoll/io_uring），线程数不必随连接数线性增长——这正是 Node/Go 的选择。'
    }
  ],
  stages: [
    {
      n: 1,
      title: 'FCFS 与非抢占 SJF',
      think: 'FCFS 只需排序 + 累加时钟；SJF 每轮在「已到达」里挑最短，若一个都没到就把时钟跳到下一个到达时刻。',
      hint: 'clock = max(clock, arrival) + burst；SJF 里 arrived.length === 0 时 clock = min(arrival)。',
      code: L1C1,
      test: L1S1,
      diag: [
        'FCFS 直接按传入顺序跑，没有按 arrival 排序。',
        'SJF 在全部进程里挑最短，执行了还没到达的进程。',
        'waiting 算成 finish - burst（忘了减 arrival）。',
        '所有进程都没到达时死循环（没有把时钟推到下一个到达时刻）。',
        'SJF 同 burst 时没有按到达顺序稳定排序，结果不可预测。'
      ]
    },
    {
      n: 2,
      title: '时间片轮转与切换次数',
      think: 'RR 的队列顺序必须让「新到达」排在「被抢占者」前面——否则刚跑完的进程会立即再次抢占，退化成非抢占。',
      hint: '先把到达时间 <= clock 的全部入队，再把当前进程放回队尾；切片段数 = timeline.length。',
      code: L1C2,
      test: L1S2,
      diag: [
        '被抢占后直接放回队头，导致一个进程连续跑（退化成 FCFS）。',
        '新到达的进程没有在切片结束时入队，响应时间变差。',
        'quantum 大于剩余 burst 时仍然按 quantum 记时间（时钟多走）。',
        '时间片切分时忘了更新 remain，进程永远跑不完。',
        '空闲时没有把时钟跳到下一个到达时刻，时间线出现空洞。'
      ]
    },
    {
      n: 3,
      title: '进程 vs 线程 vs 线程池',
      think: '判定顺序就是优先级：隔离性 > 任务类型（CPU/IO）> 共享内存。顺序反了会给出「要隔离却选了线程」这种错误答案。',
      hint: '先 needIsolation/crashIsolation，再 workload，再 needSharedMemory，最后默认线程。',
      code: L1C3,
      test: L1S3,
      diag: [
        '先判 workload 再判隔离，需要隔离的场景被推荐成线程池。',
        'CPU 密集推荐了 io-bound 的线程数。',
        '把「共享内存」当成选进程的理由（正好相反）。',
        '没有默认分支，缺字段时返回 undefined。',
        '线程池 size 返回数字而不是语义标签，调用方无法按核数换算。'
      ]
    }
  ],
  skeleton: `function simulateFcfs(procs) {
  // TODO: 按到达排序 + 累加时钟
  throw new Error('simulateFcfs 还没实现')
}

function simulateSjf(procs) {
  // TODO: 非抢占，每次在已到达里挑最短
  throw new Error('simulateSjf 还没实现')
}

function simulateRr(procs, quantum) {
  // TODO: 就绪队列 + 时间片切片 + timeline
  throw new Error('simulateRr 还没实现')
}

function recommendModel(req) {
  // TODO: 隔离 > workload > 共享内存 > 默认
  throw new Error('recommendModel 还没实现')
}`,
  solution: L1C3,
  finalCode: L1C3,
  tests: `${L1S1}\n${L1S2}\n${L1S3}`
}

/* ============================================================ 第 2 关测试 */
const L2S1 = `{
  check('单核：只能选互斥锁（自旋纯浪费 CPU）', () => {
    const r = chooseLock({ holdMs: 0.1, contention: 0.1, cores: 1 })
    same(r.lock, 'mutex')
  })
  check('长临界区：选互斥锁（睡眠比自旋划算）', () => {
    same(chooseLock({ holdMs: 50, contention: 0.1, cores: 8 }).lock, 'mutex')
    same(chooseLock({ holdMs: 1.1, contention: 0.1, cores: 8 }).lock, 'mutex')
  })
  check('高竞争：选互斥锁（自旋重试会打满缓存总线）', () => {
    same(chooseLock({ holdMs: 0.1, contention: 0.8, cores: 8 }).lock, 'mutex')
  })
  check('短临界区 + 多核 + 低竞争：自旋锁最快', () => {
    const r = chooseLock({ holdMs: 0.05, contention: 0.1, cores: 8 })
    same(r.lock, 'spin')
    ok(r.reason.length > 0)
  })
  check('多核但零竞争也可以用自旋（比如内核里已知只有本核访问）', () => {
    same(chooseLock({ holdMs: 0.01, contention: 0, cores: 2 }).lock, 'spin')
  })
}`

const L2S2 = `{
  check('CAS：期望值匹配时更新并返回 true', () => {
    const box = { value: 5 }
    same(compareAndSwap(box, 'value', 5, 6), true)
    same(box.value, 6)
  })
  check('CAS：期望值不匹配时不修改', () => {
    const box = { value: 5 }
    same(compareAndSwap(box, 'value', 3, 4), false)
    same(box.value, 5)
  })
  check('CAS 失败后调用方重试即可成功（乐观锁语义）', () => {
    const box = { value: 5 }
    same(compareAndSwap(box, 'value', 3, 4), false, '先按旧值 3 试一次')
    same(compareAndSwap(box, 'value', 5, 6), true, '读到最新值 5 后再试')
    same(box.value, 6)
  })
  check('incrementAtomic：读-CAS-重试循环最终 +1', () => {
    const box = { count: 10 }
    same(incrementAtomic(box, 'count'), 11)
    same(incrementAtomic(box, 'count'), 12)
    same(box.count, 12)
  })
  check('不同字段互不影响', () => {
    const box = { a: 1, b: 100 }
    same(compareAndSwap(box, 'a', 1, 2), true)
    same(box, { a: 2, b: 100 })
    same(compareAndSwap(box, 'b', 100, 200), true)
    same(box, { a: 2, b: 200 })
  })
}`

const L2S3 = `{
  check('无环：返回 null', () => {
    same(findDeadlock({ A: 'B', B: 'C', C: null }), null)
  })
  check('三节点环：返回环上的进程', () => {
    same(findDeadlock({ A: 'B', B: 'C', C: 'A' }), ['A', 'B', 'C'])
  })
  check('自环：进程等自己（重入锁未释放）', () => {
    same(findDeadlock({ A: 'A' }), ['A'])
  })
  check('多个入口也能找到环', () => {
    const waitsFor = { A: 'B', B: 'A', X: 'A', Y: 'Z' }
    const cycle = findDeadlock(waitsFor)
    same(cycle, ['A', 'B'])
  })
  check('空对象返回 null；没有等待边的节点不参与', () => {
    same(findDeadlock({}), null)
    same(findDeadlock({ A: 'B', B: null }), null)
  })
}`

/* ============================================================ 第 2 关代码 */
const L2C1 = `function chooseLock(req) {
  if (req.cores <= 1) {
    return { lock: 'mutex', reason: '单核自旋会占满唯一的 CPU，其他线程无法推进' }
  }
  if (req.holdMs > 1) {
    return { lock: 'mutex', reason: '临界区较长，自旋期间 CPU 完全浪费，睡眠更划算' }
  }
  if (req.contention > 0.5) {
    return { lock: 'mutex', reason: '竞争激烈时自旋会反复抢占缓存行，切换成本被放大' }
  }
  return { lock: 'spin', reason: '短临界区 + 多核 + 低竞争，自旋省掉睡眠/唤醒的系统调用' }
}`

const L2C2 = `${L2C1}

function compareAndSwap(holder, key, expected, next) {
  if (holder[key] === expected) {
    holder[key] = next
    return true
  }
  return false
}

function incrementAtomic(holder, key) {
  let current
  do {
    current = holder[key]
  } while (!compareAndSwap(holder, key, current, current + 1))
  return holder[key]
}`

const L2C3 = `${L2C2}

function findDeadlock(waitsFor) {
  const visiting = new Set()
  const visited = new Set()
  const stack = []

  const dfs = (node) => {
    if (visiting.has(node)) {
      return stack.slice(stack.indexOf(node))
    }
    if (visited.has(node)) return null
    visiting.add(node)
    stack.push(node)
    const next = waitsFor[node]
    if (next !== undefined && next !== null && waitsFor.hasOwnProperty(next)) {
      const cycle = dfs(next)
      if (cycle) return cycle
    }
    stack.pop()
    visiting.delete(node)
    visited.add(node)
    return null
  }

  for (const node of Object.keys(waitsFor)) {
    const cycle = dfs(node)
    if (cycle) return cycle
  }
  return null
}`

/* ============================================================ 第 2 关 */
const LV2 = {
  id: 'lv2',
  title: '同步原语：自旋、CAS 与死锁',
  emoji: '🔒',
  xp: 55,
  goal: '实现 chooseLock（自旋锁 vs 互斥锁的选型）、compareAndSwap/incrementAtomic（CAS 乐观更新）与 findDeadlock（根据等待图找环）。',
  why: '并发问题的面试题几乎都绕不开三件事：锁选得对不对、无锁靠不靠 CAS、死锁怎么发现。它们的共同基础是「临界区长度 × 竞争程度 × 核数」这三个量。答不出这三个量，就只能在「加锁」和「不加锁」之间凭感觉。',
  nodes: ['cs.os.sync', 'cs.os.sync.cas-lockfree', 'cs.os.sync.deadlock', 'cs.os.sync.lock-vs-spinlock', 'cs.os.sync.semaphore-classic'],
  thinking: [
    {
      title: '自旋还是睡眠，是一道成本比较题',
      md: '自旋：不释放 CPU，等待期间空转，适合「临界区极短、马上就能拿到」的场景；\n睡眠：让出 CPU，唤醒要走系统调用，适合「等得久」的场景。\n\n判断依据：单核不能自旋（自旋者占着 CPU，持有锁的线程根本没机会跑）；长临界区不该自旋；高竞争自旋会持续打缓存总线。'
    },
    {
      title: 'CAS 是「比较并替换」的原子指令',
      md: '`CAS(addr, expected, next)` 在硬件层面保证「读-比较-写」不可分割。失败说明有人改过，调用方重读重试。\n\nABA 问题是 CAS 的经典陷阱：值从 A→B→A，CAS 会误以为没变过。解决用版本号（AtomicStampedReference）或指针标记。'
    },
    {
      title: '死锁四条件与检测方法',
      md: '互斥、持有并等待、不可剥夺、循环等待——四个同时成立才可能死锁。破坏任一条即可预防（比如按固定顺序加锁破坏循环等待）。\n\n检测靠「等待图找环」：进程 A 等 B、B 等 C、C 等 A，图上有环就是死锁。银行家算法则是「分配前先算安全序列」的事前预防。'
    }
  ],
  prereq: [
    {
      title: '信号量与条件变量的区别',
      md: '信号量是计数器：`P` 减到负数就阻塞，`V` 加一并唤醒一个等待者，适合「资源计数」（如连接池大小）。\n\n条件变量必须配互斥锁：等待前先释放锁、被唤醒后重新加锁，适合「等待某个状态成立」（如队列非空）。用错会丢唤醒。'
    },
    {
      title: '内存屏障与可见性',
      md: 'CAS 通常是 full barrier（读写都不会重排），但普通变量的读写可能被编译器/CPU 重排。所以「无锁」不等于「不用关心顺序」——需要 acquire/release 语义告诉编译器和 CPU 边界。\n\nJava 的 `volatile` 提供可见性与禁止重排；`synchronized` 同时提供互斥与可见性。'
    }
  ],
  api: [
    {
      name: 'chooseLock',
      sig: 'chooseLock({ holdMs, contention, cores }) => { lock, reason }',
      args: 'holdMs 是临界区平均时长；contention 是竞争概率 0~1；cores 是核数。',
      returns: 'lock 取 "spin" | "mutex"。',
      example: 'chooseLock({ holdMs: 0.05, contention: 0.1, cores: 8 }).lock  // "spin"'
    },
    {
      name: 'compareAndSwap / incrementAtomic',
      sig: 'compareAndSwap(holder, key, expected, next) => boolean；incrementAtomic(holder, key) => number',
      args: 'holder 是普通对象；expected 是期望的旧值；next 是新值。',
      returns: 'CAS 是否成功；原子自增后的新值。',
      example: 'const box = { n: 0 }\ncompareAndSwap(box, "n", 0, 1)  // true\nincrementAtomic(box, "n")      // 2'
    },
    {
      name: 'findDeadlock',
      sig: 'findDeadlock(waitsFor) => string[] | null',
      args: 'waitsFor: { 进程: 它等待的进程 | null }',
      returns: '环上的进程数组（按环顺序），无环返回 null。',
      example: 'findDeadlock({ A: "B", B: "C", C: "A" })  // ["A", "B", "C"]\nfindDeadlock({ A: "B", B: null })          // null'
    }
  ],
  usage: '// 排查死锁：\n//   jstack 打印线程栈 → 找 "waiting to lock" 的循环\n//   MySQL: SHOW ENGINE INNODB STATUS → LATEST DETECTED DEADLOCK\n//   Redis 分布式锁：SET NX PX + 唯一 value + Lua 解锁（防误删）',
  hints: [
    '第 1 步：判定顺序 cores → holdMs → contention → 默认 spin。',
    '第 2 步：incrementAtomic 用 do/while：先读、再 CAS、失败重读。',
    '第 3 步：DFS 维护 visiting 集合，回到 visiting 里的节点就切出环；visited 防重复。'
  ],
  concepts: [
    {
      title: '为什么分布式锁不能只靠 SETNX',
      md: 'SETNX 加锁后如果客户端崩溃，锁永远不释放 → 必须带过期时间（PX）。\n\n但过期又带来「业务没跑完锁就过期」→ 需要续期（看门狗）和唯一 value（解锁时校验是自己持有的）。Redlock 进一步讨论多节点下的时钟依赖，争议很大。'
    },
    {
      title: '无锁队列的难点在哪',
      md: '难点不是 push/pop 本身，而是「内存回收」：一个线程刚读到的节点可能已经被另一个线程释放（ABA/use-after-free）。\n\n所以无锁队列通常要配 Hazard Pointer、引用计数或 GC（Java 有 GC 所以容易写）。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '自旋锁还是互斥锁',
      think: '三个条件按优先级判断：单核一票否决自旋，长临界区一票否决，高竞争一票否决，剩下的才轮到自旋。',
      hint: 'cores <= 1 → mutex；holdMs > 1 → mutex；contention > 0.5 → mutex；否则 spin。',
      code: L2C1,
      test: L2S1,
      diag: [
        '单核也推荐自旋（持锁线程没机会跑，死等）。',
        '把 holdMs 的阈值写反（长临界区反而推荐自旋）。',
        '高竞争推荐自旋（缓存行来回弹，性能更差）。',
        '没有默认分支，conditions 都不满足时返回 undefined。',
        'reason 返回空字符串，调用方无法解释选型。'
      ]
    },
    {
      n: 2,
      title: 'CAS 与无锁自增',
      think: 'CAS 只是一个断言式赋值；真正的「无锁」是调用方用循环重试把失败补上。incrementAtomic 就是「读 → CAS → 失败重读」的最小闭环。',
      hint: 'incrementAtomic 用 do { current = get } while (!cas(current, current+1))。',
      code: L2C2,
      test: L2S2,
      diag: [
        'CAS 比较用了 == 但对象值需要深比较（本关是原始值，问题不大，但对象场景会错）。',
        'CAS 失败时也写了 next（没有 if 保护）。',
        'incrementAtomic 用 if 而不是 while，冲突时丢一次自增。',
        'incrementAtomic 返回读到的旧值而不是新值。',
        'CAS 的 expected 用 key 而不是 holder[key] 的值。'
      ]
    },
    {
      n: 3,
      title: '等待图找环：死锁检测',
      think: '这是标准的有向图环检测：DFS 维护「当前递归栈」，遇到栈上节点就说明成环，切出栈上那段即可。',
      hint: 'visiting 是递归栈（Set），visited 是已完成；环 = stack.slice(stack.indexOf(node))。',
      code: L2C3,
      test: L2S3,
      diag: [
        '只维护 visited，遇到已访问节点就返回环（把菱形依赖误判成环）。',
        '环切出来时用了全部 stack 而不是从 node 开始，环前面多出路径。',
        '自环没处理（node 的下一个就是自己，因为 visiting 检查顺序不对而返回 null）。',
        '用 BFS + 入度统计但没处理「环上挂着树枝」的情况。',
        'waitsFor 里值为 null 时当成字符串 "null" 继续找，抛错或误判。'
      ]
    }
  ],
  skeleton: `function chooseLock(req) {
  // TODO: cores / holdMs / contention 三连判定
  throw new Error('chooseLock 还没实现')
}

function compareAndSwap(holder, key, expected, next) {
  // TODO: 比较并替换（原子语义）
  throw new Error('compareAndSwap 还没实现')
}

function incrementAtomic(holder, key) {
  // TODO: 读-CAS-重试
  throw new Error('incrementAtomic 还没实现')
}

function findDeadlock(waitsFor) {
  // TODO: DFS 找环，返回环上节点
  throw new Error('findDeadlock 还没实现')
}`,
  solution: L2C3,
  finalCode: L2C3,
  tests: `${L2S1}\n${L2S2}\n${L2S3}`
}

/* ============================================================ 第 3 关测试 */
const L3S1 = `{
  var ref = [7, 0, 1, 2, 0, 3, 0, 4, 2, 3, 0, 3, 2, 1, 2, 0, 1, 7, 0, 1]

  check('FIFO：3 帧 15 次缺页（经典教材例子）', () => {
    same(pageFaults(ref, 3, 'fifo'), 15)
  })
  check('LRU：3 帧 12 次缺页', () => {
    same(pageFaults(ref, 3, 'lru'), 12)
  })
  check('OPT（Belady 最优）：3 帧 9 次缺页，是理论下界', () => {
    same(pageFaults(ref, 3, 'opt'), 9)
    ok(pageFaults(ref, 3, 'opt') < pageFaults(ref, 3, 'lru'))
    ok(pageFaults(ref, 3, 'lru') < pageFaults(ref, 3, 'fifo'))
  })
  check('帧数足够时不会缺页', () => {
    same(pageFaults([1, 2, 3, 1, 2, 3], 3, 'fifo'), 3, '前三次是首次加载')
    same(pageFaults([1, 1, 1, 1], 1, 'lru'), 1)
  })
  check('FIFO 的 Belady 异常：帧变多缺页反而变多', () => {
    const seq = [1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5]
    same(pageFaults(seq, 3, 'fifo'), 9)
    same(pageFaults(seq, 4, 'fifo'), 10)
  })
}`

const L3S2 = `{
  check('TLB 全命中：一次 TLB + 一次内存', () => {
    const t = effectiveAccessTime({ tlbHitRate: 1, tlbMs: 1, memMs: 100, faultRate: 0, faultMs: 10000 })
    same(t, 101)
  })
  check('TLB 全缺失：一次 TLB + 两次内存（页表 + 数据）', () => {
    const t = effectiveAccessTime({ tlbHitRate: 0, tlbMs: 1, memMs: 100, faultRate: 0, faultMs: 10000 })
    same(t, 201)
  })
  check('90% 命中率：加权平均', () => {
    const t = effectiveAccessTime({ tlbHitRate: 0.9, tlbMs: 1, memMs: 100, faultRate: 0, faultMs: 10000 })
    same(t, 111)
  })
  check('缺页率千分之一：每次访问多摊 10ms', () => {
    const base = effectiveAccessTime({ tlbHitRate: 0.9, tlbMs: 1, memMs: 100, faultRate: 0, faultMs: 10000 })
    const withFault = effectiveAccessTime({ tlbHitRate: 0.9, tlbMs: 1, memMs: 100, faultRate: 0.001, faultMs: 10000 })
    same(withFault, base + 10)
  })
  check('缺页率升高 10 倍，有效访问时间按比例增加', () => {
    const p = { tlbHitRate: 1, tlbMs: 1, memMs: 100, faultMs: 10000 }
    const a = effectiveAccessTime({ ...p, faultRate: 0.0001 })
    const b = effectiveAccessTime({ ...p, faultRate: 0.001 })
    same(b - a, 9, '摊还成本 = (0.001-0.0001)×10000 = 9')
  })
}`

const L3S3 = `{
  check('地址翻译：页号 + 页内偏移 + 帧号 → 物理地址', () => {
    const r = translate(0x1234, { pageSize: 4096, pageTable: { 1: 7 } })
    same(r.fault, false)
    same([r.page, r.offset], [1, 0x234])
    same(r.frame, 7)
    same(r.paddr, 7 * 4096 + 0x234)
  })
  check('页表里没有该页 → 缺页异常', () => {
    const r = translate(0x9000, { pageSize: 4096, pageTable: { 1: 7 } })
    same(r.fault, true)
    same([r.page, r.offset], [9, 0])
  })
  check('页大小 1024 时偏移与页号按 1024 切分', () => {
    const r = translate(5000, { pageSize: 1024, pageTable: { 4: 2 } })
    same([r.page, r.offset, r.paddr], [4, 904, 2 * 1024 + 904])
  })
  check('偏移最大值等于 pageSize-1', () => {
    const r = translate(4095, { pageSize: 4096, pageTable: { 0: 3 } })
    same([r.page, r.offset], [0, 4095])
    same(r.paddr, 3 * 4096 + 4095, '物理地址 = 帧号×页大小 + 偏移')
  })
  check('不整除的地址也按向下取整分页', () => {
    const r = translate(12345, { pageSize: 100, pageTable: { 123: 5 } })
    same([r.page, r.offset], [123, 45])
  })
}`

/* ============================================================ 第 3 关代码 */
const L3C1 = `function pageFaults(reference, frames, algorithm) {
  const mem = []
  const order = []
  let faults = 0

  for (let i = 0; i < reference.length; i++) {
    const page = reference[i]

    if (mem.indexOf(page) >= 0) {
      if (algorithm === 'lru') {
        const pos = order.indexOf(page)
        if (pos >= 0) order.splice(pos, 1)
        order.push(page)
      }
      continue
    }

    faults++

    if (mem.length < frames) {
      mem.push(page)
      order.push(page)
      continue
    }

    let victim
    if (algorithm === 'opt') {
      let farthest = -1
      let victimIdx = 0
      for (let j = 0; j < mem.length; j++) {
        const nextUse = reference.indexOf(mem[j], i + 1)
        const dist = nextUse === -1 ? Infinity : nextUse
        if (dist > farthest) {
          farthest = dist
          victimIdx = j
        }
      }
      victim = mem[victimIdx]
      mem.splice(victimIdx, 1)
      const del = order.indexOf(victim)
      if (del >= 0) order.splice(del, 1)
    } else {
      victim = order.shift()
      mem.splice(mem.indexOf(victim), 1)
    }

    mem.push(page)
    order.push(page)
  }

  return faults
}`

const L3C2 = `${L3C1}

function effectiveAccessTime(p) {
  const hit = p.tlbHitRate * (p.tlbMs + p.memMs)
  const miss = (1 - p.tlbHitRate) * (p.tlbMs + 2 * p.memMs)
  return hit + miss + p.faultRate * p.faultMs
}`

const L3C3 = `${L3C2}

function translate(vaddr, p) {
  const page = Math.floor(vaddr / p.pageSize)
  const offset = vaddr % p.pageSize
  const frame = p.pageTable[page]

  if (frame === undefined) {
    return { fault: true, page, offset }
  }

  return { fault: false, page, offset, frame, paddr: frame * p.pageSize + offset }
}`

/* ============================================================ 第 3 关 */
const LV3 = {
  id: 'lv3',
  title: '虚拟内存：缺页、TLB 与地址翻译',
  emoji: '🧱',
  xp: 55,
  goal: '实现 pageFaults（FIFO/LRU/OPT 三种页替换的缺页计数）、effectiveAccessTime（TLB + 缺页的加权平均访问时间）与 translate（虚拟地址 → 物理地址/缺页异常）。',
  why: '「虚拟内存有什么用」人人都能答「隔离和扩容」，但被追问「TLB 命中率下降会怎样」「FIFO 为什么会有 Belady 异常」「缺页率为千分之一时一次访问要多久」时，需要把三个数字算出来。这个关卡把页替换算法、访问时间公式、地址翻译三层放在一起，正好是面试从概念追问到量的路径。',
  nodes: ['cs.os.memory', 'cs.os.memory.page-replacement', 'cs.os.memory.tlb-pagefault', 'cs.os.memory.virtual-memory'],
  thinking: [
    {
      title: '三种页替换算法的区别只在「淘汰谁」',
      md: 'FIFO：淘汰最早进入的（用队列）；LRU：淘汰最久未使用的（用最近使用顺序）；OPT：淘汰未来最久才会用到的（需要预知未来，只作理论下界）。\n\n注意 FIFO 和 LRU 在「命中」时的处理不同：FIFO 命中不动队列，LRU 命中要把页面移到队尾。写错这一点，LRU 就退化成 FIFO。'
    },
    {
      title: '有效访问时间是一条加权平均',
      md: '`EAT = 命中率 × (TLB + 内存) + 缺失率 × (TLB + 2×内存) + 缺页率 × 缺页代价`。\n\n为什么 TLB 缺失要两次内存？一次读页表项，一次读数据。TLB 命中只需一次数据访问。缺页代价通常是毫秒级（磁盘 I/O），所以缺页率哪怕千分之一，也会把平均访问时间从 100ns 级拉到微秒级。'
    },
    {
      title: '虚拟地址翻译只做三步',
      md: '① `page = vaddr / pageSize`（向下取整）；② `offset = vaddr % pageSize`；③ 查页表得帧号，`paddr = frame × pageSize + offset`。\n\n页表项不存在就是缺页异常，由操作系统把页从磁盘调入、更新页表、重新执行指令。多级页表只是把「一次查表」拆成「多次查表」，翻译逻辑不变。'
    }
  ],
  prereq: [
    {
      title: 'Belady 异常为什么只有 FIFO 有',
      md: 'FIFO 的淘汰顺序与「访问模式」无关，增加帧数反而可能打乱原本的驻留组合，导致缺页变多。\n\nLRU 和 OPT 属于「栈式算法」（stack algorithm）：帧数增加时，驻留集合只会是原来集合的超集，所以缺页数单调不增，不会出现 Belady 异常。'
    },
    {
      title: 'TLB 是什么、为什么能加速',
      md: 'TLB 是页表项的缓存（通常几十到几百项）。没有 TLB 时每次访问都要先读内存里的页表（多一次内存访问）；有了 TLB，绝大多数访问直接命中。\n\n进程切换要刷新 TLB（或打 ASID 标签），这就是「进程切换比线程切换贵」的具体来源之一。'
    },
    {
      title: '缺页处理为什么昂贵',
      md: '一次缺页要：陷入内核 → 找空闲帧/淘汰一页（可能还要写回脏页）→ 读磁盘 → 更新页表 → 刷新 TLB → 重新执行指令。\n\n机械硬盘寻道是毫秒级，SSD 也是几十微秒——比内存访问慢 3~5 个数量级。所以「减少缺页」比「优化指令」收益大得多。'
    }
  ],
  api: [
    {
      name: 'pageFaults',
      sig: 'pageFaults(reference, frames, algorithm) => number',
      args: 'reference 是页面访问序列；frames 是物理帧数；algorithm 取 "fifo" | "lru" | "opt"。',
      returns: '缺页次数。',
      example: 'pageFaults([7,0,1,2,0,3,0,4,2,3,0,3,2,1,2,0,1,7,0,1], 3, "lru")  // 12'
    },
    {
      name: 'effectiveAccessTime',
      sig: 'effectiveAccessTime({ tlbHitRate, tlbMs, memMs, faultRate, faultMs }) => number',
      args: 'tlbHitRate/faultRate 是概率，其余是耗时（同一单位）。',
      returns: '加权平均访问时间。',
      example: 'effectiveAccessTime({ tlbHitRate: 0.9, tlbMs: 1, memMs: 100, faultRate: 0, faultMs: 10000 })  // 111'
    },
    {
      name: 'translate',
      sig: 'translate(vaddr, { pageSize, pageTable }) => { fault, page, offset, frame?, paddr? }',
      args: 'vaddr 是虚拟地址；pageTable 是 pageNo → frameNo 的映射。',
      returns: '命中返回 paddr；缺页返回 { fault: true, page, offset }。',
      example: 'translate(0x1234, { pageSize: 4096, pageTable: { 1: 7 } }).paddr  // 7*4096+0x234'
    }
  ],
  usage: '// 线上对应的现象：\n//   缺页率高 → 内存不足 / 冷启动 / 内存泄漏（RSS 上涨）\n//   TLB 抖动 → 大量随机访问大数组、进程频繁切换\n//   上下文切换高 + 缺页高 → 内存压力触发 swap，性能断崖\n// 排查手段：vmstat 的 si/so、perf 的 page-faults、/proc/<pid>/stat 的 majflt',
  hints: [
    '第 1 步：命中时只有 LRU 需要把页面移到队尾；OPT 用 reference.indexOf(page, i+1) 找下次使用。',
    '第 2 步：EAT = hitRate×(tlb+mem) + (1-hitRate)×(tlb+2mem) + faultRate×faultMs。',
    '第 3 步：page 用 Math.floor(vaddr/pageSize)，offset 用 %，帧号查表。'
  ],
  concepts: [
    {
      title: '多级页表省的是什么',
      md: '32 位系统单级页表要 4MB/进程（100 万页表项 × 4B），多级页表让未使用的地址区间不占内存：只有用到的二级页表才分配。\n\n代价是 TLB 缺失时要多次访存（每级一次）。所以现代 CPU 用大页（2MB/1GB）来减少页表层级和 TLB 项数——大页把 TLB 覆盖率提高几个数量级。'
    },
    {
      title: '为什么缺页率比 TLB 命中率更致命',
      md: 'TLB 缺失多一次内存访问（~100ns），缺页是一次磁盘/SSD 访问（~10μs~10ms）。差 3~5 个数量级。\n\n所以优化顺序是：先消除 swap（加内存/降缓存），再优化 TLB（大页/局部性），最后才看 TLB 命中率的几个百分点。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '三种页替换算法',
      think: '命中时不缺页，但要更新「最近使用顺序」（只有 LRU 需要）。缺页时才淘汰：FIFO/LRU 都取 order 队头，OPT 要算未来最远。',
      hint: 'mem 存当前帧内容，order 存淘汰顺序；LRU 命中时 splice + push，FIFO 命中不动。',
      code: L3C1,
      test: L3S1,
      diag: [
        'LRU 命中时没有把页面移到队尾，退化成 FIFO。',
        'FIFO 命中时反而更新了 order，语义错乱。',
        'OPT 用「过去最久未使用」近似，实际变成了 LRU。',
        '淘汰后忘了从 mem 删除，帧数越用越多。',
        'OPT 的 nextUse 用 indexOf(page) 从 0 开始找，找到的是过去的位置。'
      ]
    },
    {
      n: 2,
      title: '有效访问时间',
      think: '四个量加权：TLB 命中、TLB 缺失、缺页。注意 TLB 缺失要两次内存访问，缺页代价是额外的（不是替代）。',
      hint: 'hit = rate×(tlb+mem)；miss = (1-rate)×(tlb+2mem)；再加上 faultRate×faultMs。',
      code: L3C2,
      test: L3S2,
      diag: [
        'TLB 缺失只算了一次内存访问（漏了读页表那一次）。',
        '缺页代价乘了 TLB 命中/缺失的权重（应该独立相加）。',
        '用 1 - tlbHitRate 算缺页率（两个率不是互补的）。',
        '单位不统一（tlb 用 ns、mem 用 ms 直接相加）。',
        'faultRate 传成百分比（0.1 表示 10%）却当成概率。'
      ]
    },
    {
      n: 3,
      title: '虚拟地址翻译',
      think: '三步：算页号、算偏移、查页表。缺页返回 fault，命中拼物理地址。注意 pageSize 不一定是 2 的幂（虽然现实中是）。',
      hint: 'page = Math.floor(vaddr / pageSize)；offset = vaddr % pageSize；paddr = frame * pageSize + offset。',
      code: L3C3,
      test: L3S3,
      diag: [
        '页号用 vaddr % pageSize 算（反了）。',
        '偏移用了 vaddr / pageSize 没取余。',
        '帧号查表用了页号字符串（对象键隐式转换，0 和 "0" 可能混淆）。',
        '缺页时抛异常而不是返回 fault 标记，调用方无法区分。',
        'paddr 忘了加 offset（只算到帧起始地址）。'
      ]
    }
  ],
  skeleton: `function pageFaults(reference, frames, algorithm) {
  // TODO: FIFO / LRU / OPT 三种淘汰策略
  throw new Error('pageFaults 还没实现')
}

function effectiveAccessTime(p) {
  // TODO: TLB 命中/缺失 + 缺页代价的加权平均
  throw new Error('effectiveAccessTime 还没实现')
}

function translate(vaddr, p) {
  // TODO: 页号/偏移/帧号 → 物理地址，缺页返回 fault
  throw new Error('translate 还没实现')
}`,
  solution: L3C3,
  finalCode: L3C3,
  tests: `${L3S1}\n${L3S2}\n${L3S3}`
}

export default {
  id: 'cs-os',
  version: 3,
  domain: 'cs',
  cumulative: false,
  title: '操作系统：调度、同步、虚拟内存',
  emoji: '🖥️',
  xp: 55,
  tagline: '3 关：FCFS/SJF/RR 调度与进程线程选型 → 自旋锁/CAS/死锁检测 → 页替换/TLB/地址翻译。',
  stack: ['操作系统'],
  intro: '操作系统面试的特点是「概念都会背，一问数字就卡」。这个项目把三章的核心量算出来：调度算法的平均等待时间、自旋与互斥的成本比较、缺页率对有效访问时间的影响。算过一遍，再谈「虚拟内存」「上下文切换」就不再是空话。',
  outcome: '你能手算 FCFS/SJF/RR 的等待时间、解释自旋锁的适用边界、用等待图找死锁、算出 TLB 与缺页对性能的实际影响。',
  levels: [LV1, LV2, LV3]
}