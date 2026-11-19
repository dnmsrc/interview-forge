/**
 * 项目闯关内容源：AI 应用 · 评测、编排与上下文工程（3 关 9 步）
 *
 * 三关是一条线：没有评测就没有资格谈编排，没有编排就谈不上循环，而循环最后都会撞上上下文预算。
 *   lv1 评测与回归门禁 —— 数据集、指标、judge 偏差、离线门禁 + 在线 A/B
 *   lv2 多智能体编排 —— 拓扑选型（成本账）、状态图推进、共享状态恢复
 *   lv3 Agent 循环与上下文 —— 预算组装、压缩触发、压缩后恢复
 *
 * 全部纯函数：judgeFn / summarizer / handler 都由调用方注入，判题时用假实现。
 */

/* ============================================================ 第 1 关测试 */
const L1S1 = `{
  const samples = Array.from({ length: 100 }, (_, i) => ({ id: 's' + i, label: i % 2 }))

  check('按比例划分，且训练/评估不重叠', () => {
    const { train, evalSet } = splitDataset(samples, { trainRatio: 0.8 })
    ok(train.length >= 70 && train.length <= 90, '训练集应接近 80%，实际 ' + train.length)
    ok(evalSet.length >= 10 && evalSet.length <= 30, '评估集应接近 20%，实际 ' + evalSet.length)
    const ids = new Set([...train, ...evalSet].map((s) => s.id))
    same(ids.size, 100, '不能有重复样本')
  })
  check('同一样本每次划分都落在同一侧（稳定哈希，不是随机）', () => {
    const a = splitDataset(samples, { trainRatio: 0.8 })
    const b = splitDataset(samples, { trainRatio: 0.8 })
    same(a.train.map((s) => s.id), b.train.map((s) => s.id))
  })
  check('指标：全对时 precision/recall/f1 都是 1', () => {
    const m = computeMetrics(samples, (s) => s.label)
    same(m.precision, 1)
    same(m.recall, 1)
    same(m.f1, 1)
    same(m.accuracy, 1)
  })
  check('把正例全判成负例：recall=0，precision 分母为 0 时按 0 处理', () => {
    const m = computeMetrics(samples, () => 0)
    same(m.recall, 0)
    same(m.precision, 0)
    same(m.tp, 0)
    same(m.fn, 50)
  })
  check('空数据集不除零：指标返回 0', () => {
    const m = computeMetrics([], () => 1)
    same(m.precision, 0)
    same(m.recall, 0)
    same(m.f1, 0)
  })
}`

const L1S2 = `{
  check('位置偏差：交换 A/B 后判定翻转的次数被数出来', () => {
    const pairs = [
      { id: 'p1', a: 'x', b: 'y' },
      { id: 'p2', a: 'x', b: 'y' }
    ]
    // 第一次总选 A，第二次（交换后）仍选 A → 两次结论其实相反
    let call = 0
    const judge = (first, second) => (call++ % 2 === 0 ? 'first' : 'first')
    const r = detectPositionBias(judge, pairs)
    same(r.flips, 2)
    same(r.rate, 1)
  })
  check('无位置偏差：交换后结论一致，flips=0', () => {
    const pairs = [{ id: 'p1', a: 'x', b: 'y' }]
    const judge = (first, second) => (first === 'x' ? 'first' : 'second')
    const r = detectPositionBias(judge, pairs)
    same(r.flips, 0)
    same(r.rate, 0)
  })
  check('长度偏差：更长答案被选中的比例超过阈值才算偏差', () => {
    const records = [
      { chosenLen: 900, rejectedLen: 100, pickedLonger: true },
      { chosenLen: 800, rejectedLen: 200, pickedLonger: true },
      { chosenLen: 300, rejectedLen: 500, pickedLonger: false },
      { chosenLen: 700, rejectedLen: 100, pickedLonger: true },
      { chosenLen: 600, rejectedLen: 200, pickedLonger: true }
    ]
    const r = detectLengthBias(records, { threshold: 0.7 })
    same(r.longerRate, 0.8)
    same(r.biased, true)
  })
  check('样本不足时返回 null 而不是硬判', () => {
    const r = detectLengthBias([{ chosenLen: 9, rejectedLen: 1, pickedLonger: true }], { threshold: 0.7, minSamples: 5 })
    same(r, null)
  })
}`

const L1S3 = `{
  check('候选全面更好：ship', () => {
    const r = gateRegression({
      baseline: { passRate: 0.80, n: 1000, successes: 800 },
      candidate: { passRate: 0.85, n: 1000, successes: 850 },
      minPassRate: 0.7, maxDelta: 0.02
    })
    same(r.ship, true)
    same(r.reasons, [])
  })
  check('候选明显变差：block，并给出原因', () => {
    const r = gateRegression({
      baseline: { passRate: 0.80, n: 1000, successes: 800 },
      candidate: { passRate: 0.70, n: 1000, successes: 700 },
      minPassRate: 0.6, maxDelta: 0.02
    })
    same(r.ship, false)
    ok(r.reasons.some((x) => /回退|下降/.test(x)), '应说明通过率回退')
  })
  check('候选低于绝对下限：即使基线更低也 block', () => {
    const r = gateRegression({
      baseline: { passRate: 0.50, n: 100, successes: 50 },
      candidate: { passRate: 0.55, n: 100, successes: 55 },
      minPassRate: 0.7, maxDelta: 0.1
    })
    same(r.ship, false)
    ok(r.reasons.some((x) => /下限|minPassRate/.test(x)), '应说明没到绝对下限')
  })
  check('两比例 z 检验：差异大时显著', () => {
    const r = zTest({ n: 1000, successes: 800 }, { n: 1000, successes: 860 })
    ok(r.z > 2, 'z 应该很大，实际 ' + r.z)
    same(r.significant, true)
  })
  check('两比例 z 检验：差异小时不显著', () => {
    const r = zTest({ n: 1000, successes: 800 }, { n: 1000, successes: 810 })
    same(r.significant, false)
  })
  check('零样本不除零，返回不显著', () => {
    const r = zTest({ n: 0, successes: 0 }, { n: 0, successes: 0 })
    same(r.significant, false)
  })
}`

/* ============================================================ 第 2 关测试 */
const L2S1 = `{
  check('任务独立、可并行：parallel', () => {
    same(chooseTopology({ subtasksIndependent: true, needsNegotiation: false, steps: 5 }).topology, 'parallel')
  })
  check('有串行依赖：pipeline', () => {
    same(chooseTopology({ subtasksIndependent: false, needsNegotiation: false, steps: 5 }).topology, 'pipeline')
  })
  check('子任务要互相协商/共享状态：supervisor', () => {
    same(chooseTopology({ subtasksIndependent: false, needsNegotiation: true, steps: 5 }).topology, 'supervisor')
  })
  check('一步就能做完：single，不要为了「架构感」上多体', () => {
    same(chooseTopology({ subtasksIndependent: true, needsNegotiation: false, steps: 1 }).topology, 'single')
  })
  check('成本账：多体的上下文要在每个 agent 里重复计费', () => {
    const single = estimateCost({ agents: 1, rounds: 1, contextTokens: 8000, tokenPrice: 0.000002 })
    const multi = estimateCost({ agents: 4, rounds: 1, contextTokens: 8000, tokenPrice: 0.000002 })
    same(multi.tokens, single.tokens * 4)
    same(multi.cost, single.cost * 4)
  })
}`

const L2S2 = `{
  const graph = {
    start: 'plan',
    nodes: {
      plan: { run: (s) => ({ ...s, plan: ['a', 'b'] }), next: () => 'work' },
      work: { run: (s) => ({ ...s, done: (s.plan ?? []).length }), next: () => 'review' },
      review: { run: (s) => ({ ...s, reviewed: true }), next: () => null }
    }
  }

  check('按状态图跑完：每个节点都执行，最终 state 合并', () => {
    const r = runGraph(graph, {}, { maxSteps: 10 })
    same(r.ok, true)
    same(r.state.done, 2)
    same(r.state.reviewed, true)
    same(r.trace, ['plan', 'work', 'review'])
  })
  check('next() 返回 null 即终止', () => {
    const r = runGraph(graph, {}, { maxSteps: 10 })
    same(r.trace.at(-1), 'review')
  })
  check('超过 maxSteps 强制停下并标记', () => {
    const loop = {
      start: 'a',
      nodes: { a: { run: (s) => s, next: () => 'a' } }
    }
    const r = runGraph(loop, {}, { maxSteps: 3 })
    same(r.ok, false)
    same(r.stoppedBy, 'maxSteps')
    same(r.trace.length, 3)
  })
  check('未知节点：返回错误而不是静默跑完', () => {
    const bad = { start: 'nope', nodes: {} }
    const r = runGraph(bad, {}, { maxSteps: 5 })
    same(r.ok, false)
    same(r.error, 'UNKNOWN_NODE')
  })
}`

const L2S3 = `{
  check('从 checkpoint 恢复：只重放之后的事件', () => {
    const checkpoint = { seq: 2, value: 20 }
    const events = [
      { seq: 1, apply: (s) => ({ ...s, value: s.value + 1 }) },
      { seq: 2, apply: (s) => ({ ...s, value: s.value + 2 }) },
      { seq: 3, apply: (s) => ({ ...s, value: s.value + 3 }) },
      { seq: 4, apply: (s) => ({ ...s, value: s.value + 4 }) }
    ]
    const r = recoverState(checkpoint, events)
    same(r.value, 20 + 3 + 4)
    same(r.seq, 4)
  })
  check('乱序事件按 seq 排序后再重放', () => {
    const checkpoint = { seq: 0, value: 0 }
    const events = [
      { seq: 2, apply: (s) => ({ ...s, value: s.value * 2 }) },
      { seq: 1, apply: (s) => ({ ...s, value: s.value + 5 }) }
    ]
    same(recoverState(checkpoint, events).value, 10, '先 +5 再 ×2')
  })
  check('重复事件（seq 相同）只应用一次', () => {
    const checkpoint = { seq: 0, value: 0 }
    const events = [
      { seq: 1, apply: (s) => ({ ...s, value: s.value + 1 }) },
      { seq: 1, apply: (s) => ({ ...s, value: s.value + 1 }) }
    ]
    same(recoverState(checkpoint, events).value, 1)
  })
  check('事件抛错时返回失败，不返回半成品状态', () => {
    const checkpoint = { seq: 0, value: 0 }
    const events = [{ seq: 1, apply: () => { throw new Error('boom') } }]
    const r = recoverState(checkpoint, events)
    same(r.ok, false)
  })
}`

/* ============================================================ 第 3 关测试 */
const L3S1 = `{
  const msgs = [
    { role: 'system', content: '你是助手' },
    { role: 'user', content: '第一问' },
    { role: 'assistant', content: '第一答' },
    { role: 'user', content: '第二问' },
    { role: 'assistant', content: '第二答' },
    { role: 'user', content: '第三问' }
  ]
  const estimate = (m) => m.content.length

  check('预算够：全部保留', () => {
    const r = assembleContext(msgs, { budgetTokens: 1000, estimate })
    same(r.kept.length, 6)
    same(r.dropped, [])
  })
  check('预算不够：保留 system 和最近的消息，丢最旧的', () => {
    const r = assembleContext(msgs, { budgetTokens: 12, estimate })
    same(r.kept[0].role, 'system', 'system 永远不能丢')
    ok(r.kept.at(-1).content === '第三问', '最后一条必须保留')
    ok(r.dropped.length > 0, '应有被丢弃的消息')
  })
  check('即使预算极小，system 也要保留（允许超预算并报告）', () => {
    const r = assembleContext(msgs, { budgetTokens: 1, estimate })
    same(r.kept[0].role, 'system')
    same(r.overBudget, true)
  })
  check('统计 tokens 与实际保留内容一致', () => {
    const r = assembleContext(msgs, { budgetTokens: 1000, estimate })
    same(r.tokens, msgs.reduce((a, m) => a + estimate(m), 0))
  })
}`

const L3S2 = `{
  check('占用低于阈值：不压缩', () => {
    const r = shouldCompact(600, { limit: 1000, ratio: 0.8 })
    same(r.compact, false)
    same(r.usage, 0.6)
  })
  check('占用超过阈值：压缩，并给出余量', () => {
    const r = shouldCompact(850, { limit: 1000, ratio: 0.8 })
    same(r.compact, true)
    ok(r.usage > 0.8, 'usage 应超过阈值')
  })
  check('压缩后保留最近 N 条，其余进摘要输入', () => {
    const msgs = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'm' + i }))
    const r = planCompaction(msgs, { keepRecent: 4 })
    same(r.recent.length, 4)
    same(r.recent.map((m) => m.content), ['m6', 'm7', 'm8', 'm9'])
    same(r.toSummarize.length, 6)
  })
  check('消息少于 keepRecent：全部留在 recent，没有要摘要的', () => {
    const msgs = [{ role: 'user', content: 'a' }]
    const r = planCompaction(msgs, { keepRecent: 4 })
    same(r.toSummarize, [])
    same(r.recent.length, 1)
  })
}`

const L3S3 = `{
  check('从摘要里恢复 KEY: VALUE 形式的硬事实', () => {
    const summary = '用户偏好：简洁\\n已确认：接口用 REST\\n待办：补测试'
    const r = restoreFacts(summary, { keys: ['用户偏好', '已确认'] })
    same(r['用户偏好'], '简洁')
    same(r['已确认'], '接口用 REST')
    same(Object.keys(r).length, 2, '未请求的 key 不应恢复')
  })
  check('摘要里没有的 key 返回 undefined，不编造', () => {
    const r = restoreFacts('用户偏好：简洁', { keys: ['预算'] })
    same(r['预算'], undefined)
  })
  check('恢复后的上下文 = 恢复事实 + 最近消息，且 system 在最前', () => {
    const recent = [{ role: 'user', content: '继续' }]
    const r = rebuildContext({ facts: { 用户偏好: '简洁' }, recent, system: '你是助手' })
    same(r.length, 3)
    same(r[0].role, 'system')
    ok(r.some((m) => m.content.includes('用户偏好')), '事实要进入上下文')
    same(r.at(-1).content, '继续')
  })
  check('没有事实时只拼 system + recent，不产生空消息', () => {
    const r = rebuildContext({ facts: {}, recent: [{ role: 'user', content: 'hi' }], system: 'sys' })
    same(r.length, 2)
    ok(r.every((m) => m.content.length > 0), '不应有空 content')
  })
}`

/* ============================================================ 第 1 关 */
const LV1 = {
  id: 'lv1',
  title: '评测与回归门禁：指标、judge 偏差、上线闸',
  emoji: '📏',
  xp: 50,
  goal: '实现评测链的三段：稳定划分数据集并算 precision/recall/F1（splitDataset + computeMetrics）、检测 LLM-as-judge 的位置/长度偏差（detectPositionBias + detectLengthBias）、离线回归门禁与在线 A/B 显著性（gateRegression + zTest）。',
  why: '「评测」在面试里常被答成「准备一批问题看效果」。工程上它有三道坎：数据集划分不稳定，两次评测不可比；judge 有位置/长度偏差，结论会系统性偏向某一侧；没有门禁，回归靠人肉看。把这三件事写成可跑代码，评测才有资格当作决策依据。',
  nodes: ['ai.eval.evaluation-qa', 'ai.eval.evaluation-qa.metrics-dataset', 'ai.eval.evaluation-qa.llm-as-judge', 'ai.eval.evaluation-qa.online-regression'],
  thinking: [
    {
      title: '为什么划分要用稳定哈希而不是随机',
      md: '随机划分每次跑都不同，今天 82% 明天 79%，你分不清是模型变差还是划分变了。用「样本 id 的稳定哈希」决定落训练集还是评估集，同一份数据永远得到同一个划分，实验才可比。\n\n代价是新增样本会改变比例，所以生产上会按版本冻结评估集，而不是每次重新划。'
    },
    {
      title: 'LLM-as-judge 的两个系统性偏差',
      md: '位置偏差：judge 倾向于选第一个（或最后一个）呈现的答案。检测方法很直接——同一对答案交换顺序再判一次，结论翻转就是位置偏差。\n\n长度偏差：judge 倾向于给更长的答案高分，哪怕信息量一样。检测方法是统计「更长者被选中」的比例，显著高于 0.5 就说明 judge 在数长度而不是评质量。'
    },
    {
      title: '门禁要同时看绝对下限和相对回退',
      md: '只设绝对下限（passRate ≥ 0.7）会放过「从 0.95 掉到 0.75」；只设相对回退（maxDelta）会放过「本来就只有 0.5」。\n\n所以门禁是两条：绝对下限必须满足，且相对基线不能退超过 maxDelta。在线 A/B 再加一道两比例 z 检验，避免把噪声当提升。'
    }
  ],
  prereq: [
    {
      title: 'precision / recall / F1 的适用场景',
      md: 'precision = TP/(TP+FP)：判为正的里有多少真对；recall = TP/(TP+FN)：真正的里抓回多少。\n\n评测里两者常常冲突：安全过滤宁可 precision 低也要 recall 高（宁可错杀不可放过），而自动回复宁可 recall 低也要 precision 高（不胡说）。F1 是调和平均，只在两者都重要时用——不要无脑拿 F1 当唯一指标。'
    },
    {
      title: '两比例 z 检验',
      md: '比较两个通过率 p1、p2（样本 n1、n2）：\n\n```\np = (x1+x2)/(n1+n2)\nse = sqrt(p(1-p)(1/n1+1/n2))\nz = (p1-p2)/se\n```\n\n|z| > 1.96 时在 95% 置信度下显著。注意这是大样本近似，样本几十条时不可靠——这也是为什么离线评测集不能太小。'
    }
  ],
  api: [
    {
      name: 'splitDataset / computeMetrics',
      sig: 'splitDataset(samples, { trainRatio }) => { train, evalSet }；computeMetrics(samples, judgeFn) => { tp, fp, fn, tn, precision, recall, f1, accuracy }',
      args: 'samples: { id, label(0|1) }[]；judgeFn(sample) => 0|1 是待评测系统的判定。',
      returns: 'splitDataset 用稳定哈希划分；computeMetrics 在分母为 0 时返回 0。',
      example: 'computeMetrics(samples, (s) => s.label)  // → 全对，指标都是 1'
    },
    {
      name: 'detectPositionBias / detectLengthBias',
      sig: 'detectPositionBias(judgeFn, pairs) => { flips, rate }；detectLengthBias(records, { threshold, minSamples }) => { longerRate, biased } | null',
      args: 'pairs: { id, a, b }[]；judgeFn(first, second) => \'first\'|\'second\'。records: { chosenLen, rejectedLen, pickedLonger }[]。',
      returns: '位置偏差统计交换顺序后结论翻转的比例；长度偏差统计「更长者被选中」的比例，样本不足返回 null。',
      example: 'detectLengthBias(records, { threshold: 0.7, minSamples: 5 })'
    },
    {
      name: 'gateRegression / zTest',
      sig: 'gateRegression({ baseline, candidate, minPassRate, maxDelta }) => { ship, reasons }；zTest(control, treatment) => { z, significant }',
      args: 'baseline/candidate: { passRate, n, successes }；control/treatment: { n, successes }。',
      returns: 'gate 同时校验绝对下限与相对回退；zTest 用两比例 z 检验，|z|>1.96 视为显著。',
      example: 'gateRegression({ baseline: {...}, candidate: {...}, minPassRate: 0.7, maxDelta: 0.02 })'
    }
  ],
  usage: 'const { train, evalSet } = splitDataset(samples, { trainRatio: 0.8 })\nconst base = computeMetrics(evalSet, (s) => oldSystem(s))\nconst cand = computeMetrics(evalSet, (s) => newSystem(s))\nconst gate = gateRegression({ baseline: base, candidate: cand, minPassRate: 0.7, maxDelta: 0.02 })\nif (gate.ship) { const ab = zTest(control, treatment); if (ab.significant) rollout() }',
  hints: [
    'splitDataset 用字符串哈希（如把 id 的字符码求和 % 100）与 trainRatio*100 比较。',
    'detectPositionBias 对每对判两次：judge(a,b) 与 judge(b,a)，若一次选 a 一次选 b 记为 flip。',
    'zTest 里先算合并比例 p，再算 se；n1+n2 为 0 时直接返回不显著。'
  ],
  concepts: [
    {
      title: '离线评测集与在线指标的差异',
      md: '离线评测集回答「在固定样本上变好没」，快、可复现、但可能过拟合；在线 A/B 回答「真实流量里变好没」，慢、有噪声、但才是最终裁决。\n\n两者都不能省：离线做日常回归门禁，在线做版本发布前的确认。只做离线的团队容易在真实分布上翻车，只做在线的团队迭代速度会慢到不可接受。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '先稳定划分与指标',
      think: '先把「可复现」这件事钉死：稳定哈希划分 + 分母为零的兜底。没有这两条，后面的门禁再漂亮也不可信。',
      hint: 'hash = sum(charCode) % 100；落在 < trainRatio*100 的进 train。指标分子分母按 tp/fp/fn/tn 算。',
      code: `function splitDataset(samples, opts = {}) {
  const { trainRatio = 0.8 } = opts
  const cut = Math.round(trainRatio * 100)
  const train = []
  const evalSet = []
  for (const s of samples) {
    const text = String(s.id)
    let h = 0
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 100
    if (h < cut) train.push(s)
    else evalSet.push(s)
  }
  return { train, evalSet }
}

function computeMetrics(samples, judgeFn) {
  let tp = 0, fp = 0, fn = 0, tn = 0
  for (const s of samples) {
    const pred = judgeFn(s) ? 1 : 0
    if (s.label === 1 && pred === 1) tp++
    else if (s.label === 0 && pred === 1) fp++
    else if (s.label === 1 && pred === 0) fn++
    else tn++
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp)
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn)
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
  const total = samples.length
  return { tp, fp, fn, tn, precision, recall, f1, accuracy: total ? (tp + tn) / total : 0 }
}`,
      test: L1S1,
      diag: [
        '划分用了 Math.random，两次结果不一致。',
        '训练/评估没有互斥，同一样本出现在两边。',
        '指标分子分母算错（把 fp 算进 recall 的分母了）。',
        '分母为 0 时没兜底，返回 NaN。',
        '空数据集时 accuracy 除了 0。'
      ]
    },
    {
      n: 2,
      title: '再查 judge 的两种偏差',
      think: 'judge 是评测里的「测量仪器」，仪器有系统偏差，结论就不能信。位置偏差靠交换顺序验证，长度偏差靠统计比例——两者都不依赖 judge 的绝对判断力。',
      hint: '位置：judge(a,b) 与 judge(b,a)，结论指向不同答案即 flip；长度：统计 pickedLonger 的比例，样本数不足返回 null。',
      code: `function splitDataset(samples, opts = {}) {
  const { trainRatio = 0.8 } = opts
  const cut = Math.round(trainRatio * 100)
  const train = []
  const evalSet = []
  for (const s of samples) {
    const text = String(s.id)
    let h = 0
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 100
    if (h < cut) train.push(s)
    else evalSet.push(s)
  }
  return { train, evalSet }
}

function computeMetrics(samples, judgeFn) {
  let tp = 0, fp = 0, fn = 0, tn = 0
  for (const s of samples) {
    const pred = judgeFn(s) ? 1 : 0
    if (s.label === 1 && pred === 1) tp++
    else if (s.label === 0 && pred === 1) fp++
    else if (s.label === 1 && pred === 0) fn++
    else tn++
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp)
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn)
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
  const total = samples.length
  return { tp, fp, fn, tn, precision, recall, f1, accuracy: total ? (tp + tn) / total : 0 }
}

function detectPositionBias(judge, pairs) {
  let flips = 0
  for (const p of pairs) {
    const first = judge(p.a, p.b)
    const second = judge(p.b, p.a)
    // 第一次选 a、第二次选 b（或反过来）说明判定跟着位置走
    const pickedA = first === 'first'
    const pickedB = second === 'first'
    if (pickedA === pickedB) flips++
  }
  return { flips, rate: pairs.length ? flips / pairs.length : 0 }
}

function detectLengthBias(records, opts = {}) {
  const { threshold = 0.7, minSamples = 5 } = opts
  if (records.length < minSamples) return null
  const longer = records.filter((r) => r.pickedLonger).length
  const longerRate = longer / records.length
  return { longerRate, biased: longerRate > threshold }
}`,
      test: L1S2,
      diag: [
        '只判了一次（没有交换顺序），位置偏差无从检测。',
        'flip 的判定写成了「两次相同」而不是「两次指向不同答案」。',
        '长度偏差只看 chosen 是否更长，没统计比例。',
        '样本不足时没有返回 null，直接给了结论。'
      ]
    },
    {
      n: 3,
      title: '最后装上回归门禁与 A/B 检验',
      think: '门禁是评测的出口：不合格就不许发布。这里同时校验绝对下限与相对回退，再补一道 z 检验，避免把流量噪声当成提升。',
      hint: 'gate：passRate < minPassRate → block；baseline.passRate - candidate.passRate > maxDelta → block；否则 ship。zTest 用合并比例算 se。',
      code: `function gateRegression(input) {
  const { baseline, candidate, minPassRate, maxDelta } = input
  const reasons = []
  if (candidate.passRate < minPassRate) {
    reasons.push('候选未达到绝对下限 minPassRate=' + minPassRate)
  }
  if (baseline.passRate - candidate.passRate > maxDelta) {
    reasons.push('候选相对基线回退超过 ' + maxDelta)
  }
  return { ship: reasons.length === 0, reasons }
}

function zTest(control, treatment) {
  const n1 = control.n
  const n2 = treatment.n
  if (!n1 || !n2) return { z: 0, significant: false }
  const p1 = control.successes / n1
  const p2 = treatment.successes / n2
  const p = (control.successes + treatment.successes) / (n1 + n2)
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2))
  if (se === 0) return { z: 0, significant: false }
  const z = (p2 - p1) / se
  return { z, significant: Math.abs(z) > 1.96 }
}

function splitDataset(samples, opts = {}) {
  const { trainRatio = 0.8 } = opts
  const cut = Math.round(trainRatio * 100)
  const train = []
  const evalSet = []
  for (const s of samples) {
    const text = String(s.id)
    let h = 0
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 100
    if (h < cut) train.push(s)
    else evalSet.push(s)
  }
  return { train, evalSet }
}

function computeMetrics(samples, judgeFn) {
  let tp = 0, fp = 0, fn = 0, tn = 0
  for (const s of samples) {
    const pred = judgeFn(s) ? 1 : 0
    if (s.label === 1 && pred === 1) tp++
    else if (s.label === 0 && pred === 1) fp++
    else if (s.label === 1 && pred === 0) fn++
    else tn++
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp)
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn)
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
  const total = samples.length
  return { tp, fp, fn, tn, precision, recall, f1, accuracy: total ? (tp + tn) / total : 0 }
}

function detectPositionBias(judge, pairs) {
  let flips = 0
  for (const p of pairs) {
    const first = judge(p.a, p.b)
    const second = judge(p.b, p.a)
    const pickedA = first === 'first'
    const pickedB = second === 'first'
    if (pickedA === pickedB) flips++
  }
  return { flips, rate: pairs.length ? flips / pairs.length : 0 }
}

function detectLengthBias(records, opts = {}) {
  const { threshold = 0.7, minSamples = 5 } = opts
  if (records.length < minSamples) return null
  const longer = records.filter((r) => r.pickedLonger).length
  const longerRate = longer / records.length
  return { longerRate, biased: longerRate > threshold }
}`,
      test: L1S3,
      diag: [
        '门禁只查了绝对下限，没查相对回退（或反之）。',
        'reasons 为空时仍然返回 ship: false。',
        'z 检验的 se 里漏了 1/n1 + 1/n2 的其中一项。',
        'n 为 0 时除零，或者把 |z|>1.96 写成了绝对值漏掉。',
        '显著性阈值写成了 1.645 却没说明是单侧。',
        'z 检验把控制组和实验组写反了（z 变负，显著性判反）。'
      ]
    }
  ],
  skeleton: `function splitDataset(samples, opts) {
  throw new Error('splitDataset 还没实现')
}
function computeMetrics(samples, judgeFn) {
  throw new Error('computeMetrics 还没实现')
}
function detectPositionBias(judge, pairs) {
  throw new Error('detectPositionBias 还没实现')
}
function detectLengthBias(records, opts) {
  throw new Error('detectLengthBias 还没实现')
}
function gateRegression(input) {
  throw new Error('gateRegression 还没实现')
}
function zTest(control, treatment) {
  throw new Error('zTest 还没实现')
}`,
  solution: `function splitDataset(samples, opts = {}) {
  const { trainRatio = 0.8 } = opts
  const cut = Math.round(trainRatio * 100)
  const train = []
  const evalSet = []
  for (const s of samples) {
    const text = String(s.id)
    let h = 0
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 100
    if (h < cut) train.push(s)
    else evalSet.push(s)
  }
  return { train, evalSet }
}

function computeMetrics(samples, judgeFn) {
  let tp = 0, fp = 0, fn = 0, tn = 0
  for (const s of samples) {
    const pred = judgeFn(s) ? 1 : 0
    if (s.label === 1 && pred === 1) tp++
    else if (s.label === 0 && pred === 1) fp++
    else if (s.label === 1 && pred === 0) fn++
    else tn++
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp)
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn)
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
  const total = samples.length
  return { tp, fp, fn, tn, precision, recall, f1, accuracy: total ? (tp + tn) / total : 0 }
}

function detectPositionBias(judge, pairs) {
  let flips = 0
  for (const p of pairs) {
    const first = judge(p.a, p.b)
    const second = judge(p.b, p.a)
    const pickedA = first === 'first'
    const pickedB = second === 'first'
    if (pickedA === pickedB) flips++
  }
  return { flips, rate: pairs.length ? flips / pairs.length : 0 }
}

function detectLengthBias(records, opts = {}) {
  const { threshold = 0.7, minSamples = 5 } = opts
  if (records.length < minSamples) return null
  const longer = records.filter((r) => r.pickedLonger).length
  const longerRate = longer / records.length
  return { longerRate, biased: longerRate > threshold }
}

function gateRegression(input) {
  const { baseline, candidate, minPassRate, maxDelta } = input
  const reasons = []
  if (candidate.passRate < minPassRate) {
    reasons.push('候选未达到绝对下限 minPassRate=' + minPassRate)
  }
  if (baseline.passRate - candidate.passRate > maxDelta) {
    reasons.push('候选相对基线回退超过 ' + maxDelta)
  }
  return { ship: reasons.length === 0, reasons }
}

function zTest(control, treatment) {
  const n1 = control.n
  const n2 = treatment.n
  if (!n1 || !n2) return { z: 0, significant: false }
  const p1 = control.successes / n1
  const p2 = treatment.successes / n2
  const p = (control.successes + treatment.successes) / (n1 + n2)
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2))
  if (se === 0) return { z: 0, significant: false }
  const z = (p2 - p1) / se
  return { z, significant: Math.abs(z) > 1.96 }
}`,
  finalCode: `function splitDataset(samples, opts = {}) {
  const { trainRatio = 0.8 } = opts
  const cut = Math.round(trainRatio * 100)
  const train = []
  const evalSet = []
  for (const s of samples) {
    const text = String(s.id)
    let h = 0
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 100
    if (h < cut) train.push(s)
    else evalSet.push(s)
  }
  return { train, evalSet }
}

function computeMetrics(samples, judgeFn) {
  let tp = 0, fp = 0, fn = 0, tn = 0
  for (const s of samples) {
    const pred = judgeFn(s) ? 1 : 0
    if (s.label === 1 && pred === 1) tp++
    else if (s.label === 0 && pred === 1) fp++
    else if (s.label === 1 && pred === 0) fn++
    else tn++
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp)
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn)
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
  const total = samples.length
  return { tp, fp, fn, tn, precision, recall, f1, accuracy: total ? (tp + tn) / total : 0 }
}

function detectPositionBias(judge, pairs) {
  let flips = 0
  for (const p of pairs) {
    const first = judge(p.a, p.b)
    const second = judge(p.b, p.a)
    const pickedA = first === 'first'
    const pickedB = second === 'first'
    if (pickedA === pickedB) flips++
  }
  return { flips, rate: pairs.length ? flips / pairs.length : 0 }
}

function detectLengthBias(records, opts = {}) {
  const { threshold = 0.7, minSamples = 5 } = opts
  if (records.length < minSamples) return null
  const longer = records.filter((r) => r.pickedLonger).length
  const longerRate = longer / records.length
  return { longerRate, biased: longerRate > threshold }
}

function gateRegression(input) {
  const { baseline, candidate, minPassRate, maxDelta } = input
  const reasons = []
  if (candidate.passRate < minPassRate) {
    reasons.push('候选未达到绝对下限 minPassRate=' + minPassRate)
  }
  if (baseline.passRate - candidate.passRate > maxDelta) {
    reasons.push('候选相对基线回退超过 ' + maxDelta)
  }
  return { ship: reasons.length === 0, reasons }
}

function zTest(control, treatment) {
  const n1 = control.n
  const n2 = treatment.n
  if (!n1 || !n2) return { z: 0, significant: false }
  const p1 = control.successes / n1
  const p2 = treatment.successes / n2
  const p = (control.successes + treatment.successes) / (n1 + n2)
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2))
  if (se === 0) return { z: 0, significant: false }
  const z = (p2 - p1) / se
  return { z, significant: Math.abs(z) > 1.96 }
}`,
  tests: `${L1S1}\n${L1S2}\n${L1S3}`
}

/* ============================================================ 第 2 关 */
const LV2 = {
  id: 'lv2',
  title: '多智能体编排：拓扑、状态图、崩溃恢复',
  emoji: '🕸️',
  xp: 55,
  goal: '实现编排的三块：按任务形态选拓扑并算成本账（chooseTopology + estimateCost）、按状态图推进（runGraph）、从 checkpoint 重放事件恢复共享状态（recoverState）。',
  why: '多智能体不是「越多越好」：每个 agent 都要装一份上下文，token 成本随 agent 数线性上涨，而收益只有任务真能拆开时才存在。工程上还要回答两个问题：状态怎么推进（状态图/事件），崩溃后怎么恢复（checkpoint + 重放）。这两个问题不解决，多体系统就只能 demo 不能上线。',
  nodes: ['ai.multi.agent-orchestration', 'ai.multi.agent-orchestration.topology-selection', 'ai.multi.agent-orchestration.framework-mechanics', 'ai.multi.agent-orchestration.shared-state'],
  thinking: [
    {
      title: '拓扑选型的本质是任务依赖图',
      md: '子任务彼此独立 → parallel（扇出扇入）；子任务有先后依赖 → pipeline（像流水线）；子任务之间要协商、共享中间状态 → supervisor（主控 + 专家）。一步能做完就别上多体。\n\n注意成本：parallel 的 N 个 agent 各自装一份上下文，token 成本 ≈ 单体的 N 倍；pipeline 是 N 次串行调用，延迟也叠加。所以「拆」必须换来质量或速度上的真收益。'
    },
    {
      title: '为什么用状态图而不是 while 循环',
      md: 'while 循环里的「下一步做什么」散在代码里，无法可视化、无法中断、无法恢复。状态图把节点（能力）与转移（决策）分开：节点是纯函数，转移是显式规则。\n\n好处：可以画出来给人看、可以在任意节点中断/恢复、可以限制步数防死循环。LangGraph 这类框架的核心就是把 while 循环「数据化」成图。'
    },
    {
      title: '共享状态的恢复靠事件日志',
      md: '多 agent 共享状态时，崩溃恢复不能靠「重跑一遍」——外部副作用（发消息、下单）会重复。正确做法是 checkpoint + 事件日志：定期存状态快照，恢复时只重放快照之后的事件，且事件带 seq 保证幂等。\n\n这就是「持久执行」（durable execution）的雏形：把状态变更写成可重放的事件，而不是直接改内存。'
    }
  ],
  prereq: [
    {
      title: '多智能体的成本结构',
      md: '成本 ≈ Σ(每个 agent 的上下文 token × 单价 × 轮次)。多体系统里每个 agent 往往都要带「系统提示 + 任务描述 + 历史」，所以 N 个 agent 的最低成本就是单体的 N 倍起。\n\n收益来自「并行」或「专业分工」。如果只是把一个任务拆给 3 个 agent 依次做，成本 3 倍、延迟 3 倍、质量未必更好——这是最常见的过度设计。'
    },
    {
      title: '事件重放与幂等',
      md: '事件日志恢复的前提是「同一个事件应用两次等于应用一次」——否则重放会把 +1 执行两次。\n\n实现上：事件带单调递增 seq，恢复时只应用 seq > checkpoint.seq 的事件，并用 Set 去重。'
    }
  ],
  api: [
    {
      name: 'chooseTopology / estimateCost',
      sig: 'chooseTopology({ subtasksIndependent, needsNegotiation, steps }) => { topology }；estimateCost({ agents, rounds, contextTokens, tokenPrice }) => { tokens, cost }',
      args: 'topology ∈ single | parallel | pipeline | supervisor。',
      returns: '拓扑决策；成本按 agents × rounds × contextTokens 计。',
      example: 'chooseTopology({ subtasksIndependent: true, needsNegotiation: false, steps: 5 })  // → parallel'
    },
    {
      name: 'runGraph',
      sig: 'runGraph(graph, initialState, { maxSteps }) => { ok, state, trace, stoppedBy? }',
      args: 'graph: { start, nodes: { id: { run(state), next(state) } } }。',
      returns: 'ok + 最终 state + 执行轨迹；超步数 stoppedBy=maxSteps；未知节点 error=UNKNOWN_NODE。',
      example: 'runGraph(graph, {}, { maxSteps: 10 })'
    },
    {
      name: 'recoverState',
      sig: 'recoverState(checkpoint, events) => state | { ok: false }',
      args: 'checkpoint: { seq, ...state }；events: { seq, apply(state) }[]。',
      returns: '按 seq 排序后只应用 seq > checkpoint.seq 的事件（同 seq 去重）；事件抛错返回 { ok:false }。',
      example: 'recoverState({ seq: 2, value: 20 }, events)'
    }
  ],
  usage: 'const topo = chooseTopology({ subtasksIndependent: true, needsNegotiation: false, steps: 5 })\nconst r = runGraph(workflowGraph, { question }, { maxSteps: 20 })\nconst recovered = recoverState(lastCheckpoint, eventLog)',
  hints: [
    'chooseTopology：steps<=1 → single；needsNegotiation → supervisor；subtasksIndependent → parallel；否则 pipeline。',
    'runGraph 里 while 循环：node = graph.nodes[current]；先 run 再 next；next 为 null 结束。',
    'recoverState 先 filter seq > checkpoint.seq，再按 seq 排序，再 Set 去重。'
  ],
  stages: [
    {
      n: 1,
      title: '先选拓扑并算清成本',
      think: '选型不是架构审美，是成本与任务依赖的函数。先把判断顺序写死，再把「多一个 agent 就多一份上下文成本」写成可算的数。',
      hint: '判断顺序：steps<=1 → single；needsNegotiation → supervisor；subtasksIndependent → parallel；else pipeline。成本 = agents*rounds*contextTokens。',
      code: `function chooseTopology(spec) {
  const { subtasksIndependent, needsNegotiation, steps } = spec
  if (steps <= 1) return { topology: 'single' }
  if (needsNegotiation) return { topology: 'supervisor' }
  if (subtasksIndependent) return { topology: 'parallel' }
  return { topology: 'pipeline' }
}

function estimateCost(spec) {
  const { agents, rounds, contextTokens, tokenPrice } = spec
  const tokens = agents * rounds * contextTokens
  return { tokens, cost: tokens * tokenPrice }
}`,
      test: L2S1,
      diag: [
        '判断顺序反了：先判 independent，导致需要协商的任务被分到 parallel。',
        'steps<=1 的分支漏了，一步任务也上了多体。',
        '成本只算了 agents 没算 rounds，或者漏乘 contextTokens。',
        '返回结构不是 { topology }，调用方取不到。',
        'needsNegotiation 与 subtasksIndependent 同时为真时顺序不对。'
      ]
    },
    {
      n: 2,
      title: '再写状态图推进器',
      think: '把「下一步做什么」从代码里抽出来变成 next()。这一步的关键是终止条件（next 返回 null）与防死循环（maxSteps），以及未知节点的显式报错。',
      hint: 'while: 查节点 → 不存在返回 UNKNOWN_NODE → run → push trace → next → 为 null 结束；步数到 maxSteps 返回 stoppedBy。',
      code: `function chooseTopology(spec) {
  const { subtasksIndependent, needsNegotiation, steps } = spec
  if (steps <= 1) return { topology: 'single' }
  if (needsNegotiation) return { topology: 'supervisor' }
  if (subtasksIndependent) return { topology: 'parallel' }
  return { topology: 'pipeline' }
}

function estimateCost(spec) {
  const { agents, rounds, contextTokens, tokenPrice } = spec
  const tokens = agents * rounds * contextTokens
  return { tokens, cost: tokens * tokenPrice }
}

function runGraph(graph, initialState, opts = {}) {
  const { maxSteps = 20 } = opts
  const trace = []
  let state = initialState
  let current = graph.start
  while (current) {
    if (trace.length >= maxSteps) return { ok: false, stoppedBy: 'maxSteps', state, trace }
    const node = graph.nodes[current]
    if (!node) return { ok: false, error: 'UNKNOWN_NODE', node: current, state, trace }
    trace.push(current)
    state = node.run(state)
    current = node.next ? node.next(state) : null
  }
  return { ok: true, state, trace }
}`,
      test: L2S2,
      diag: [
        'next 返回 null 时没有结束循环（死循环，被 maxSteps 打断）。',
        'run 的返回值没有赋回 state，后续节点看到的是旧状态。',
        '未知节点直接跳过而不是返回 UNKNOWN_NODE。',
        'maxSteps 判断放在 run 之后，trace 长度超了。'
      ]
    },
    {
      n: 3,
      title: '最后做共享状态恢复',
      think: '多体共享状态在崩溃后不能重跑，只能从 checkpoint 重放日志。核心是 seq 过滤 + 排序 + 幂等去重，以及「事件抛错不返回半成品」。',
      hint: 'filter e.seq > checkpoint.seq → sort by seq → Set 去重 → 依次 apply；任何一步抛错返回 { ok:false }。',
      code: `function chooseTopology(spec) {
  const { subtasksIndependent, needsNegotiation, steps } = spec
  if (steps <= 1) return { topology: 'single' }
  if (needsNegotiation) return { topology: 'supervisor' }
  if (subtasksIndependent) return { topology: 'parallel' }
  return { topology: 'pipeline' }
}

function estimateCost(spec) {
  const { agents, rounds, contextTokens, tokenPrice } = spec
  const tokens = agents * rounds * contextTokens
  return { tokens, cost: tokens * tokenPrice }
}

function runGraph(graph, initialState, opts = {}) {
  const { maxSteps = 20 } = opts
  const trace = []
  let state = initialState
  let current = graph.start
  while (current) {
    if (trace.length >= maxSteps) return { ok: false, stoppedBy: 'maxSteps', state, trace }
    const node = graph.nodes[current]
    if (!node) return { ok: false, error: 'UNKNOWN_NODE', node: current, state, trace }
    trace.push(current)
    state = node.run(state)
    current = node.next ? node.next(state) : null
  }
  return { ok: true, state, trace }
}

function recoverState(checkpoint, events) {
  const pending = [...events]
    .filter((e) => e.seq > (checkpoint.seq ?? -1))
    .sort((a, b) => a.seq - b.seq)
  const seen = new Set()
  let state = { ...checkpoint }
  for (const e of pending) {
    if (seen.has(e.seq)) continue
    seen.add(e.seq)
    try {
      state = { ...e.apply(state), seq: e.seq }
    } catch {
      return { ok: false, seq: e.seq }
    }
  }
  return state
}`,
      test: L2S3,
      diag: [
        '没有过滤 seq <= checkpoint.seq，checkpoint 之前的事件被重放。',
        '没有按 seq 排序或没有同 seq 去重（乱序/重复事件都会错）。',
        '事件抛错后仍然返回了部分更新的状态。',
        '恢复后没有更新 seq，下次恢复会重复重放。'
      ]
    }
  ],
  skeleton: `function chooseTopology(spec) {
  throw new Error('chooseTopology 还没实现')
}
function estimateCost(spec) {
  throw new Error('estimateCost 还没实现')
}
function runGraph(graph, state, opts) {
  throw new Error('runGraph 还没实现')
}
function recoverState(checkpoint, events) {
  throw new Error('recoverState 还没实现')
}`,
  solution: `function chooseTopology(spec) {
  const { subtasksIndependent, needsNegotiation, steps } = spec
  if (steps <= 1) return { topology: 'single' }
  if (needsNegotiation) return { topology: 'supervisor' }
  if (subtasksIndependent) return { topology: 'parallel' }
  return { topology: 'pipeline' }
}

function estimateCost(spec) {
  const { agents, rounds, contextTokens, tokenPrice } = spec
  const tokens = agents * rounds * contextTokens
  return { tokens, cost: tokens * tokenPrice }
}

function runGraph(graph, initialState, opts = {}) {
  const { maxSteps = 20 } = opts
  const trace = []
  let state = initialState
  let current = graph.start
  while (current) {
    if (trace.length >= maxSteps) return { ok: false, stoppedBy: 'maxSteps', state, trace }
    const node = graph.nodes[current]
    if (!node) return { ok: false, error: 'UNKNOWN_NODE', node: current, state, trace }
    trace.push(current)
    state = node.run(state)
    current = node.next ? node.next(state) : null
  }
  return { ok: true, state, trace }
}

function recoverState(checkpoint, events) {
  const pending = [...events]
    .filter((e) => e.seq > (checkpoint.seq ?? -1))
    .sort((a, b) => a.seq - b.seq)
  const seen = new Set()
  let state = { ...checkpoint }
  for (const e of pending) {
    if (seen.has(e.seq)) continue
    seen.add(e.seq)
    try {
      state = { ...e.apply(state), seq: e.seq }
    } catch {
      return { ok: false, seq: e.seq }
    }
  }
  return state
}`,
  finalCode: `function chooseTopology(spec) {
  const { subtasksIndependent, needsNegotiation, steps } = spec
  if (steps <= 1) return { topology: 'single' }
  if (needsNegotiation) return { topology: 'supervisor' }
  if (subtasksIndependent) return { topology: 'parallel' }
  return { topology: 'pipeline' }
}

function estimateCost(spec) {
  const { agents, rounds, contextTokens, tokenPrice } = spec
  const tokens = agents * rounds * contextTokens
  return { tokens, cost: tokens * tokenPrice }
}

function runGraph(graph, initialState, opts = {}) {
  const { maxSteps = 20 } = opts
  const trace = []
  let state = initialState
  let current = graph.start
  while (current) {
    if (trace.length >= maxSteps) return { ok: false, stoppedBy: 'maxSteps', state, trace }
    const node = graph.nodes[current]
    if (!node) return { ok: false, error: 'UNKNOWN_NODE', node: current, state, trace }
    trace.push(current)
    state = node.run(state)
    current = node.next ? node.next(state) : null
  }
  return { ok: true, state, trace }
}

function recoverState(checkpoint, events) {
  const pending = [...events]
    .filter((e) => e.seq > (checkpoint.seq ?? -1))
    .sort((a, b) => a.seq - b.seq)
  const seen = new Set()
  let state = { ...checkpoint }
  for (const e of pending) {
    if (seen.has(e.seq)) continue
    seen.add(e.seq)
    try {
      state = { ...e.apply(state), seq: e.seq }
    } catch {
      return { ok: false, seq: e.seq }
    }
  }
  return state
}`,
  tests: `${L2S1}\n${L2S2}\n${L2S3}`
}

/* ============================================================ 第 3 关 */
const LV3 = {
  id: 'lv3',
  title: 'Agent 循环：上下文预算、压缩与恢复',
  emoji: '🧵',
  xp: 60,
  goal: '实现上下文工程的三段：按预算组装消息（assembleContext）、触发与规划压缩（shouldCompact + planCompaction）、压缩后恢复关键事实（restoreFacts + rebuildContext）。',
  why: 'Agent 的循环最终都会撞上上下文窗口。撞上之后的处理方式决定了它是「越跑越傻」还是「跑多久都稳」：预算内组装、超阈值压缩、压缩后把硬事实恢复回来。这三步缺一步，长任务就会失忆或胡编。',
  nodes: ['ai.harness.agent-loop', 'ai.harness.agent-loop.context-budget', 'ai.harness.agent-loop.compaction-recovery'],
  thinking: [
    {
      title: '预算组装：system 是不可牺牲的',
      md: '上下文窗口有限时，最先该丢的是最旧的历史，最不该丢的是 system（规则、身份、约束）。\n\n所以 assembleContext 的语义是：从最新的消息往回装，装到预算为止；system 无论预算多小都要保留，并显式报告 overBudget——让调用方知道「这次已经超了，该压缩了」。'
    },
    {
      title: '压缩的时机比压缩的算法重要',
      md: '压缩太早：频繁摘要，丢细节、增加成本；压缩太晚：已经超窗，请求直接失败。\n\n工程上按水位触发（usage > 0.8 × limit），而不是按固定轮数。触发后保留最近 N 条原文（保证「接着聊」的连续性），其余进摘要。'
    },
    {
      title: '压缩后恢复什么',
      md: '摘要是「有损」的，但有些硬事实不能丢：用户明确说过的偏好、已经确认的决策、待办事项。\n\n所以设计摘要格式时就把这些写成 `KEY: VALUE` 行，恢复时按 key 精确取回，与最近消息拼成新的上下文。这比「让模型从摘要里自己回忆」可靠得多。'
    }
  ],
  prereq: [
    {
      title: 'token 预算的估算',
      md: '在线估算 token 不能每次调 tokenizer（贵且慢），常用近似：中文约 1 token/字，英文约 1 token/4 字符，混合按系数折算。\n\n本关把 estimate 函数注入进来——测试里用字符数，线上换成 tokenizer 或近似公式，算法本身不用改。'
    },
    {
      title: '为什么保留最近 N 条而不是「最近 N 个 token」',
      md: '按消息条数保留，边界是「一问一答」的完整性：保留最近 4 条通常是两轮对话，模型能接着上下文继续。\n\n按 token 保留更精确，但可能把一条消息切成两半（尤其长工具返回），破坏结构。工程上常用「按条数 + 单条超长时截断」。'
    }
  ],
  api: [
    {
      name: 'assembleContext',
      sig: 'assembleContext(messages, { budgetTokens, estimate }) => { kept, dropped, tokens, overBudget }',
      args: 'estimate(message) => number；messages 按时间顺序排列。',
      returns: '从最新往回装；system 永远保留；超出预算时 overBudget=true。',
      example: 'assembleContext(msgs, { budgetTokens: 2000, estimate: (m) => m.content.length })'
    },
    {
      name: 'shouldCompact / planCompaction',
      sig: 'shouldCompact(tokens, { limit, ratio }) => { compact, usage }；planCompaction(messages, { keepRecent }) => { toSummarize, recent }',
      args: 'limit 窗口大小；ratio 水位（如 0.8）；keepRecent 保留原文的条数。',
      returns: '压缩决策与拆分结果（哪些进摘要、哪些保留原文）。',
      example: 'planCompaction(messages, { keepRecent: 4 })'
    },
    {
      name: 'restoreFacts / rebuildContext',
      sig: 'restoreFacts(summary, { keys }) => { [key]: value }；rebuildContext({ facts, recent, system }) => messages',
      args: 'summary 是 `KEY: VALUE` 多行文本；keys 是必须恢复的硬事实键。',
      returns: '按 key 精确恢复；rebuildContext 把 system + 事实消息 + recent 拼成新上下文。',
      example: 'rebuildContext({ facts: { 用户偏好: \'简洁\' }, recent: [], system: \'你是助手\' })'
    }
  ],
  usage: 'const ctx = assembleContext(history, { budgetTokens: 8000, estimate: approxTokens })\nif (shouldCompact(ctx.tokens, { limit: 8000, ratio: 0.8 }).compact) {\n  const { toSummarize, recent } = planCompaction(history, { keepRecent: 4 })\n  const summary = await summarize(toSummarize)\n  history = rebuildContext({ facts: restoreFacts(summary, { keys: [\'用户偏好\'] }), recent, system })\n}',
  hints: [
    'assembleContext 从末尾往前遍历，累加 estimate；system 单独先保留。',
    'shouldCompact：usage = tokens / limit；compact = usage > ratio。',
    'planCompaction：recent = messages.slice(-keepRecent)，toSummarize = 前面那些。',
    'restoreFacts 逐行 split(\':\') 解析，只取请求的 key。'
  ],
  stages: [
    {
      n: 1,
      title: '先按预算组装上下文',
      think: '这是每次调用模型前都要做的动作。核心不是「截断」，而是「保留什么」：system 必留、最近的必留、最旧的先丢。',
      hint: '保留 system；从末尾往前取消息直到超预算；返回 kept/dropped/tokens/overBudget。',
      code: `function assembleContext(messages, opts) {
  const { budgetTokens, estimate } = opts
  const system = messages.filter((m) => m.role === 'system')
  const rest = messages.filter((m) => m.role !== 'system')
  const keptRest = []
  let tokens = system.reduce((a, m) => a + estimate(m), 0)
  let overBudget = tokens > budgetTokens
  for (let i = rest.length - 1; i >= 0; i--) {
    const t = estimate(rest[i])
    if (tokens + t <= budgetTokens) {
      keptRest.unshift(rest[i])
      tokens += t
    } else {
      overBudget = true
      break
    }
  }
  const dropped = rest.slice(0, rest.length - keptRest.length)
  return { kept: [...system, ...keptRest], dropped, tokens, overBudget }
}`,
      test: L3S1,
      diag: [
        'system 被当成普通消息一起截断了。',
        '从前往后取（保留了最旧的），应该从后往前。',
        'tokens 统计漏了 system，或 dropped 与 kept 对不上。',
        '超预算时没设 overBudget。'
      ]
    },
    {
      n: 2,
      title: '再判断何时压缩、压缩哪些',
      think: '压缩触发的阈值和拆分方式要一起设计：触发太早浪费，保留太少断片。这里把「水位判断」与「保留最近 N 条」拆成两个纯函数。',
      hint: 'shouldCompact: usage = tokens/limit, compact = usage > ratio；planCompaction: recent = slice(-keepRecent)。',
      code: `function assembleContext(messages, opts) {
  const { budgetTokens, estimate } = opts
  const system = messages.filter((m) => m.role === 'system')
  const rest = messages.filter((m) => m.role !== 'system')
  const keptRest = []
  let tokens = system.reduce((a, m) => a + estimate(m), 0)
  let overBudget = tokens > budgetTokens
  for (let i = rest.length - 1; i >= 0; i--) {
    const t = estimate(rest[i])
    if (tokens + t <= budgetTokens) {
      keptRest.unshift(rest[i])
      tokens += t
    } else {
      overBudget = true
      break
    }
  }
  const dropped = rest.slice(0, rest.length - keptRest.length)
  return { kept: [...system, ...keptRest], dropped, tokens, overBudget }
}

function shouldCompact(tokens, opts) {
  const { limit, ratio } = opts
  const usage = limit === 0 ? 1 : tokens / limit
  return { compact: usage > ratio, usage }
}

function planCompaction(messages, opts) {
  const { keepRecent } = opts
  const keep = Math.max(0, Math.min(keepRecent, messages.length))
  const recent = messages.slice(messages.length - keep)
  const toSummarize = messages.slice(0, messages.length - keep)
  return { toSummarize, recent }
}`,
      test: L3S2,
      diag: [
        'usage 算成了 tokens*limit 或者没处理 limit=0。',
        'compact 用了 >= 还是 > 没想清楚（水位是「超过」）。',
        'planCompaction 的 recent 取了前 N 条而不是后 N 条。',
        'keepRecent 大于消息数时越界，或 toSummarize 与 recent 重叠。'
      ]
    },
    {
      n: 3,
      title: '最后从摘要恢复硬事实',
      think: '压缩不是终点：恢复后要能接着聊。把摘要里的 KEY: VALUE 精确取回，与 system、最近消息拼成新上下文——「不知道的不要编」是这一步的底线。',
      hint: 'restoreFacts：逐行找 "KEY: VALUE"，key 在请求列表里才收；rebuildContext：system + 一条事实消息 + recent。',
      code: `function assembleContext(messages, opts) {
  const { budgetTokens, estimate } = opts
  const system = messages.filter((m) => m.role === 'system')
  const rest = messages.filter((m) => m.role !== 'system')
  const keptRest = []
  let tokens = system.reduce((a, m) => a + estimate(m), 0)
  let overBudget = tokens > budgetTokens
  for (let i = rest.length - 1; i >= 0; i--) {
    const t = estimate(rest[i])
    if (tokens + t <= budgetTokens) {
      keptRest.unshift(rest[i])
      tokens += t
    } else {
      overBudget = true
      break
    }
  }
  const dropped = rest.slice(0, rest.length - keptRest.length)
  return { kept: [...system, ...keptRest], dropped, tokens, overBudget }
}

function shouldCompact(tokens, opts) {
  const { limit, ratio } = opts
  const usage = limit === 0 ? 1 : tokens / limit
  return { compact: usage > ratio, usage }
}

function planCompaction(messages, opts) {
  const { keepRecent } = opts
  const keep = Math.max(0, Math.min(keepRecent, messages.length))
  const recent = messages.slice(messages.length - keep)
  const toSummarize = messages.slice(0, messages.length - keep)
  return { toSummarize, recent }
}

function restoreFacts(summary, opts) {
  const { keys } = opts
  const facts = {}
  for (const line of String(summary ?? '').split('\\n')) {
    let at = line.indexOf(':')
    if (at < 0) at = line.indexOf('：')
    if (at < 0) continue
    const key = line.slice(0, at).trim()
    const value = line.slice(at + 1).trim()
    if (keys.includes(key) && value) facts[key] = value
  }
  return facts
}

function rebuildContext(input) {
  const { facts, recent, system } = input
  const out = []
  if (system) out.push({ role: 'system', content: system })
  const lines = Object.entries(facts ?? {}).map(([k, v]) => k + '：' + v)
  if (lines.length) out.push({ role: 'system', content: '已确认事实：\\n' + lines.join('\\n') })
  for (const m of recent ?? []) out.push(m)
  return out
}`,
      test: L3S3,
      diag: [
        '摘要解析用了 "："（全角）而测试里是半角 ":"，或者反过来。',
        '没过滤 keys（把所有行都恢复），或没有的 key 被编造了默认值。',
        'rebuildContext 里 system 没放第一条，或者空事实也 push 了一条空消息。',
        'recent 被覆盖而不是追加在事实之后。'
      ]
    }
  ],
  skeleton: `function assembleContext(messages, opts) {
  throw new Error('assembleContext 还没实现')
}
function shouldCompact(tokens, opts) {
  throw new Error('shouldCompact 还没实现')
}
function planCompaction(messages, opts) {
  throw new Error('planCompaction 还没实现')
}
function restoreFacts(summary, opts) {
  throw new Error('restoreFacts 还没实现')
}
function rebuildContext(input) {
  throw new Error('rebuildContext 还没实现')
}`,
  solution: `function assembleContext(messages, opts) {
  const { budgetTokens, estimate } = opts
  const system = messages.filter((m) => m.role === 'system')
  const rest = messages.filter((m) => m.role !== 'system')
  const keptRest = []
  let tokens = system.reduce((a, m) => a + estimate(m), 0)
  let overBudget = tokens > budgetTokens
  for (let i = rest.length - 1; i >= 0; i--) {
    const t = estimate(rest[i])
    if (tokens + t <= budgetTokens) {
      keptRest.unshift(rest[i])
      tokens += t
    } else {
      overBudget = true
      break
    }
  }
  const dropped = rest.slice(0, rest.length - keptRest.length)
  return { kept: [...system, ...keptRest], dropped, tokens, overBudget }
}

function shouldCompact(tokens, opts) {
  const { limit, ratio } = opts
  const usage = limit === 0 ? 1 : tokens / limit
  return { compact: usage > ratio, usage }
}

function planCompaction(messages, opts) {
  const { keepRecent } = opts
  const keep = Math.max(0, Math.min(keepRecent, messages.length))
  const recent = messages.slice(messages.length - keep)
  const toSummarize = messages.slice(0, messages.length - keep)
  return { toSummarize, recent }
}

function restoreFacts(summary, opts) {
  const { keys } = opts
  const facts = {}
  for (const line of String(summary ?? '').split('\\n')) {
    let at = line.indexOf(':')
    if (at < 0) at = line.indexOf('：')
    if (at < 0) continue
    const key = line.slice(0, at).trim()
    const value = line.slice(at + 1).trim()
    if (keys.includes(key) && value) facts[key] = value
  }
  return facts
}

function rebuildContext(input) {
  const { facts, recent, system } = input
  const out = []
  if (system) out.push({ role: 'system', content: system })
  const lines = Object.entries(facts ?? {}).map(([k, v]) => k + '：' + v)
  if (lines.length) out.push({ role: 'system', content: '已确认事实：\\n' + lines.join('\\n') })
  for (const m of recent ?? []) out.push(m)
  return out
}`,
  finalCode: `function assembleContext(messages, opts) {
  const { budgetTokens, estimate } = opts
  const system = messages.filter((m) => m.role === 'system')
  const rest = messages.filter((m) => m.role !== 'system')
  const keptRest = []
  let tokens = system.reduce((a, m) => a + estimate(m), 0)
  let overBudget = tokens > budgetTokens
  for (let i = rest.length - 1; i >= 0; i--) {
    const t = estimate(rest[i])
    if (tokens + t <= budgetTokens) {
      keptRest.unshift(rest[i])
      tokens += t
    } else {
      overBudget = true
      break
    }
  }
  const dropped = rest.slice(0, rest.length - keptRest.length)
  return { kept: [...system, ...keptRest], dropped, tokens, overBudget }
}

function shouldCompact(tokens, opts) {
  const { limit, ratio } = opts
  const usage = limit === 0 ? 1 : tokens / limit
  return { compact: usage > ratio, usage }
}

function planCompaction(messages, opts) {
  const { keepRecent } = opts
  const keep = Math.max(0, Math.min(keepRecent, messages.length))
  const recent = messages.slice(messages.length - keep)
  const toSummarize = messages.slice(0, messages.length - keep)
  return { toSummarize, recent }
}

function restoreFacts(summary, opts) {
  const { keys } = opts
  const facts = {}
  for (const line of String(summary ?? '').split('\\n')) {
    let at = line.indexOf(':')
    if (at < 0) at = line.indexOf('：')
    if (at < 0) continue
    const key = line.slice(0, at).trim()
    const value = line.slice(at + 1).trim()
    if (keys.includes(key) && value) facts[key] = value
  }
  return facts
}

function rebuildContext(input) {
  const { facts, recent, system } = input
  const out = []
  if (system) out.push({ role: 'system', content: system })
  const lines = Object.entries(facts ?? {}).map(([k, v]) => k + '：' + v)
  if (lines.length) out.push({ role: 'system', content: '已确认事实：\\n' + lines.join('\\n') })
  for (const m of recent ?? []) out.push(m)
  return out
}`,
  tests: `${L3S1}\n${L3S2}\n${L3S3}`
}

export default {
  id: 'ai-eval',
  version: 3,
  domain: 'ai',
  cumulative: false,
  title: '评测、编排与上下文工程',
  emoji: '📐',
  tagline: '3 关：评测指标与回归门禁、多智能体拓扑与状态恢复、Agent 循环的上下文预算与压缩恢复。',
  stack: ['LLM 应用', '评测', 'Agent 工程'],
  intro: '「模型效果」不是一个形容词，而是一串可计算的量与一个不许乱发的闸。这个项目把 AI 应用工程的三块骨架拆开：评测（指标、judge 偏差、门禁、A/B）、编排（拓扑成本、状态图、事件恢复）、上下文工程（预算组装、压缩触发、事实恢复）。每一块都能独立跑测试，也都能直接对应到线上的一个事故。',
  outcome: '你能搭一套可复现的评测与门禁、判断多智能体该不该拆并算清成本、把 Agent 循环的状态与上下文管到「长任务不失忆」。',
  levels: [LV1, LV2, LV3]
}