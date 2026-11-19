/**
 * 项目闯关内容源：AI 应用 · 记忆、检索与推理服务（3 关 9 步）
 *
 * 三关对应 AI 应用的三个「钱花在哪」：
 *   lv1 记忆分层 —— 长期记忆怎么存/怎么打分/怎么忘，技能库怎么路由
 *   lv2 RAG 全链路 —— 切块、向量检索、生成侧引用核验
 *   lv3 推理服务 —— KV cache 显存、吞吐/延迟账、量化档位选择
 *
 * 全部纯函数 + 注入依赖（embedFn / similarityFn / 向量），判题沙箱里没有网络和定时器，
 * 这恰好逼着把「哪一步依赖外部、哪一步能单独验证」讲清楚。
 */

/* ============================================================ 第 1 关测试 */
const L1S1 = `{
  const now = 100 * 86400000  // 第 100 天（毫秒）

  check('同等相关性下，重要度高的排前面', () => {
    const ms = [
      { id: 'low', text: 'a', createdAt: now, importance: 0.2, lastAccess: now },
      { id: 'high', text: 'b', createdAt: now, importance: 0.9, lastAccess: now }
    ]
    const top = scoreMemories('查一下', ms, now, { k: 2, halfLifeDays: 30, similarityFn: () => 1 })
    same(top[0].id, 'high')
  })
  check('越旧越靠后：时间衰减真的生效', () => {
    const ms = [
      { id: 'old', text: 'a', createdAt: now - 90 * 86400000, importance: 0.8, lastAccess: now - 90 * 86400000 },
      { id: 'new', text: 'b', createdAt: now, importance: 0.8, lastAccess: now }
    ]
    const top = scoreMemories('x', ms, now, { k: 2, halfLifeDays: 30, similarityFn: () => 1 })
    same(top[0].id, 'new')
  })
  check('相关性由调用方注入：不相关的高重要度记忆可以被压下去', () => {
    const ms = [
      { id: 'imp', text: '无关', createdAt: now, importance: 0.4, lastAccess: now },
      { id: 'rel', text: '相关', createdAt: now, importance: 0.1, lastAccess: now }
    ]
    const sim = (q, t) => (t === '相关' ? 1 : 0)
    const top = scoreMemories('q', ms, now, { k: 1, halfLifeDays: 30, similarityFn: sim })
    same(top[0].id, 'rel')
  })
  check('top-k 截断且结果带 score', () => {
    const ms = [1, 2, 3].map((i) => ({ id: 'm' + i, text: 't', createdAt: now, importance: 0.5, lastAccess: now }))
    const top = scoreMemories('t', ms, now, { k: 2, halfLifeDays: 30, similarityFn: () => 0.5 })
    same(top.length, 2)
    ok(typeof top[0].score === 'number' && top[0].score > 0, 'score 应可比较')
  })
  check('空记忆库返回空数组', () => {
    same(scoreMemories('q', [], now, { k: 5, halfLifeDays: 30, similarityFn: () => 1 }), [])
  })
}`

const L1S2 = `{
  const now = 100 * 86400000
  const day = 86400000

  check('超过 maxAgeDays 的记忆被丢弃', () => {
    const ms = [
      { id: 'fresh', text: 'a', createdAt: now - 10 * day, importance: 0.9, lastAccess: now - 10 * day },
      { id: 'stale', text: 'b', createdAt: now - 365 * day, importance: 0.9, lastAccess: now - 365 * day }
    ]
    const r = decayAndPrune(ms, now, { halfLifeDays: 30, minScore: 0.01, maxAgeDays: 180, similarityFn: () => 1 })
    same(r.kept.map((m) => m.id), ['fresh'])
    same(r.dropped.map((m) => m.id), ['stale'])
  })
  check('分数低于 minScore 的也丢（重要度太低）', () => {
    const ms = [{ id: 'weak', text: 'a', createdAt: now - 1000 * day, importance: 0.001, lastAccess: now - 1000 * day }]
    const r = decayAndPrune(ms, now, { halfLifeDays: 30, minScore: 0.05, maxAgeDays: 9999, similarityFn: () => 0 })
    same(r.kept.length, 0)
    same(r.dropped.length, 1)
  })
  check('全部合格时一个都不丢', () => {
    const ms = [1, 2].map((i) => ({ id: 'm' + i, text: 't', createdAt: now - day, importance: 1, lastAccess: now }))
    const r = decayAndPrune(ms, now, { halfLifeDays: 30, minScore: 0.01, maxAgeDays: 180, similarityFn: () => 1 })
    same(r.kept.length, 2)
    same(r.dropped, [])
  })
  check('keep 里的对象带最新 score，调用方可直接写回', () => {
    const ms = [{ id: 'm', text: 't', createdAt: now - 30 * day, importance: 1, lastAccess: now - 30 * day }]
    const r = decayAndPrune(ms, now, { halfLifeDays: 30, minScore: 0.01, maxAgeDays: 180, similarityFn: () => 1 })
    ok(r.kept[0].score > 0 && r.kept[0].score < 1, '30 天半衰期后应约 0.5')
  })
}`

const L1S3 = `{
  const skills = [
    { name: 'pdf-tools', description: 'PDF 处理', triggers: [{ type: 'keyword', value: 'pdf' }, { type: 'keyword', value: '发票' }] },
    { name: 'sql-review', description: 'SQL 审查', triggers: [{ type: 'regex', value: '/\\\\bSELECT\\\\b/i' }] },
    { name: 'translator', description: '翻译', triggers: [{ type: 'keyword', value: '翻译' }] }
  ]

  check('关键词命中：返回对应技能', () => {
    const r = matchSkills(skills, '帮我把这个 pdf 转成文字')
    same(r.map((s) => s.name), ['pdf-tools'])
  })
  check('正则触发器命中（大小写不敏感）', () => {
    const r = matchSkills(skills, 'select * from users where id = 1')
    same(r.map((s) => s.name), ['sql-review'])
  })
  check('多个技能命中时按命中次数排序', () => {
    const r = matchSkills(skills, '这个 pdf 发票 帮我翻译一下')
    same(r[0].name, 'pdf-tools', 'pdf + 发票命中 2 次，应排第一')
    same(r.length, 2)
  })
  check('没有命中返回空数组', () => {
    same(matchSkills(skills, '今天天气'), [])
  })
  check('非法正则不崩：跳过该触发器', () => {
    const bad = [{ name: 'broken', triggers: [{ type: 'regex', value: '/([a-z/' }] }]
    same(matchSkills(bad, 'abc'), [])
  })
}`

/* ============================================================ 第 2 关测试 */
const L2S1 = `{
  const text = '第一段内容。\\n\\n第二段内容比较长，需要被切分。\\n\\n第三段。'

  check('短文档不切：一块就够', () => {
    const chunks = chunkDocument('hello world', { maxChars: 100, overlap: 0 })
    same(chunks.length, 1)
    same(chunks[0].text, 'hello world')
  })
  check('按 maxChars 切分，块数正确', () => {
    const chunks = chunkDocument(text, { maxChars: 12, overlap: 0 })
    ok(chunks.length >= 3, '12 字符一档时应切成多块，实际 ' + chunks.length)
  })
  check('overlap>0：相邻块首尾有重叠，且不丢内容', () => {
    const chunks = chunkDocument(text, { maxChars: 12, overlap: 4 })
    const joined = chunks.map((c) => c.text).join('')
    ok(joined.includes('第三段') && joined.includes('第一段'), '内容不能被吞掉')
    for (let i = 1; i < chunks.length; i++) {
      ok(chunks[i].start < chunks[i - 1].end, '后一块的起点应在前一块结束之前（重叠）')
    }
  })
  check('每块带 start/end 与序号，便于引用定位', () => {
    const chunks = chunkDocument(text, { maxChars: 12, overlap: 2 })
    same(chunks[0].index, 0)
    same(chunks[0].start, 0)
    ok(chunks[0].end > 0 && chunks[0].end <= text.length, 'end 应在文本范围内')
    ok(chunks[1].start > 0, '第二块起点应向后移动')
  })
  check('空文本返回空数组', () => {
    same(chunkDocument('', { maxChars: 10, overlap: 0 }), [])
  })
}`

const L2S2 = `{
  check('相同向量相似度为 1', () => {
    same(cosineSimilarity([1, 2, 3], [1, 2, 3]), 1)
  })
  check('正交向量相似度为 0', () => {
    same(cosineSimilarity([1, 0], [0, 1]), 0)
  })
  check('反向向量为 -1', () => {
    ok(Math.abs(cosineSimilarity([1, 1], [-1, -1]) + 1) < 1e-9, '方向相反应约为 -1')
  })
  check('零向量不崩，返回 0', () => {
    same(cosineSimilarity([0, 0], [1, 1]), 0)
  })
  check('searchTopK：按相似度降序取前 k，并带 id', () => {
    const docs = [
      { id: 'a', vec: [1, 0] },
      { id: 'b', vec: [0.9, 0.1] },
      { id: 'c', vec: [0, 1] }
    ]
    const top = searchTopK([1, 0], docs, 2)
    same(top.length, 2)
    same(top[0].id, 'a')
    same(top[1].id, 'b')
    ok(top[0].score > top[1].score, '必须降序')
  })
}`

const L2S3 = `{
  const docs = [
    { id: 1, text: 'Redis 的过期键采用惰性删除与定期删除。' },
    { id: 2, text: '定期删除默认每秒 10 次，每次抽样 20 个键。' }
  ]

  check('合法引用：编号都在文档范围内', () => {
    const r = verifyCitations('过期键用惰性删除[1]，定期删除每秒 10 次[2]。', docs)
    same(r.valid, [1, 2])
    same(r.invalid, [])
  })
  check('越界引用被单独列出', () => {
    const r = verifyCitations('结论见[1]与[3]。', docs)
    same(r.valid, [1])
    same(r.invalid, [3])
  })
  check('答案完全没引用：标记 needsCitation', () => {
    const r = verifyCitations('过期键会自己消失。', docs)
    same(r.needsCitation, true)
    same(r.valid, [])
  })
  check('同一引用重复出现只计一次', () => {
    const r = verifyCitations('见[2]，再看[2]。', docs)
    same(r.valid, [2])
  })
  check('编号 0 也算越界（引用编号从 1 开始）', () => {
    const r = verifyCitations('见[0]。', docs)
    same(r.invalid, [0])
  })
}`

/* ============================================================ 第 3 关测试 */
const L3S1 = `{
  check('标准公式：2 × layers × heads × headDim × seqLen × batch × bytes', () => {
    const bytes = kvCacheBytes({ layers: 32, heads: 32, headDim: 128, seqLen: 1024, batch: 1, bytesPerParam: 2 })
    same(bytes, 2 * 32 * 32 * 128 * 1024 * 1 * 2)
  })
  check('batch 翻倍，缓存翻倍（线性）', () => {
    const base = { layers: 8, heads: 8, headDim: 64, seqLen: 512, bytesPerParam: 2 }
    same(kvCacheBytes({ ...base, batch: 2 }), kvCacheBytes({ ...base, batch: 1 }) * 2)
  })
  check('序列长度翻倍，缓存翻倍', () => {
    const base = { layers: 8, heads: 8, headDim: 64, batch: 1, bytesPerParam: 2 }
    same(kvCacheBytes({ ...base, seqLen: 2048 }), kvCacheBytes({ ...base, seqLen: 1024 }) * 2)
  })
  check('缺参数时直接报错，而不是算出 NaN', () => {
    let threw = false
    try { kvCacheBytes({ layers: 32 }) } catch { threw = true }
    same(threw, true)
  })
}`

const L3S2 = `{
  check('首 token 延迟 + 输出 token 数 × 每 token 延迟 = 总延迟', () => {
    const r = estimateLatency({ ttftMs: 200, outputTokens: 100, itlMs: 20 })
    same(r.totalMs, 200 + 100 * 20)
  })
  check('吞吐 = 输出 token / 总秒数（单请求）', () => {
    const r = estimateLatency({ ttftMs: 100, outputTokens: 50, itlMs: 20 }, { batch: 1 })
    // 1100ms → 50/1.1 ≈ 45.45 token/s
    ok(Math.abs(r.tokensPerSec - 50 / 1.1) < 1e-9, '实际 ' + r.tokensPerSec)
  })
  check('batch 并行时总吞吐按 batch 放大', () => {
    const r = estimateLatency({ ttftMs: 100, outputTokens: 50, itlMs: 20 }, { batch: 4 })
    ok(Math.abs(r.tokensPerSec - (50 * 4) / 1.1) < 1e-9, '实际 ' + r.tokensPerSec)
  })
  check('outputTokens=0 时不会除零', () => {
    const r = estimateLatency({ ttftMs: 100, outputTokens: 0, itlMs: 20 })
    same(r.totalMs, 100)
    same(r.tokensPerSec, 0)
  })
}`

const L3S3 = `{
  check('fp16 放得下且延迟达标：不量化', () => {
    const r = decideQuantization({ vramGB: 80, modelParams: 7e9, targetLatencyMs: 5000 })
    same(r.quant, 'fp16')
  })
  check('fp16 放不下、int8 放得下：选 int8', () => {
    const r = decideQuantization({ vramGB: 8, modelParams: 7e9, targetLatencyMs: 5000 })
    same(r.quant, 'int8')
  })
  check('都放不下：int4 兜底', () => {
    const r = decideQuantization({ vramGB: 5, modelParams: 7e9, targetLatencyMs: 5000 })
    same(r.quant, 'int4')
  })
  check('显存够但延迟要求极严：用 int8 换吞吐', () => {
    const r = decideQuantization({ vramGB: 80, modelParams: 7e9, targetLatencyMs: 200 })
    same(r.quant, 'int8')
  })
  check('估算显存 = 参数量 × 位宽 / 8（GB）', () => {
    const r = decideQuantization({ vramGB: 80, modelParams: 7e9, targetLatencyMs: 5000 })
    ok(Math.abs(r.estVramGB - (7e9 * 2) / 1e9) < 1e-9, 'fp16 7B ≈ 14GB，实际 ' + r.estVramGB)
  })
}`

/* ============================================================ 第 1 关 */
const LV1 = {
  id: 'lv1',
  title: '记忆分层：打分、遗忘、技能路由',
  emoji: '🧠',
  xp: 40,
  goal: '实现长期记忆的三件套：按「重要度 + 时间衰减 + 相关性」打分检索（scoreMemories）、按阈值与年龄淘汰（decayAndPrune）、按触发规则路由技能库（matchSkills）。',
  why: 'Agent 的记忆不是「全都塞进上下文」：上下文有预算，记忆有噪声，旧记忆会腐烂。工程上它是一套打分 + 淘汰策略——重要度决定什么值得记，时间衰减决定什么该烂掉，相关性决定这次该想起谁。技能库则是另一种记忆：程序性记忆，靠触发规则路由，而不是靠向量检索。',
  nodes: ['ai.memory.memory-skill', 'ai.memory.memory-skill.long-term-memory', 'ai.memory.memory-skill.skill-lib'],
  thinking: [
    {
      title: '为什么记忆要「打分」而不是「查找」',
      md: '长期记忆的存储形态通常是「条目 + 元数据」，检索时没有一个确定答案：上次聊过的偏好、三个月前的报错细节、用户明确说过的禁忌，都可能有用来也可能干扰。\n\n所以它更像排序问题：score = w1·重要度 + w2·新近度 + w3·相关性，取 top-k 塞进上下文。权重怎么定是产品决策，但**必须可调**——把 similarityFn 注入进来就是这个意思：线上用向量，测试用固定函数。'
    },
    {
      title: '遗忘不是删除，是降权 + 淘汰',
      md: '「忘掉」有两种：一种是把分数降到检索不出来（软遗忘），一种是真的删掉（硬淘汰）。前者用于「重要但过时」，后者用于「低价值且占空间」。\n\n工程上一般先降权：指数衰减（半衰期 30 天），低于 minScore 才进淘汰候选；同时设 maxAgeDays 兜底，避免「僵尸记忆」永远占着库。淘汰要返回 dropped 清单，线上才能做审计。'
    },
    {
      title: '技能库为什么不用向量检索',
      md: '技能（SKILL.md）是「怎么做」的程序性记忆：触发条件是明确的（用户提到 PDF、代码里有 SELECT），不是语义相似。用关键词/正则触发，行为可预测、可解释，比向量召回更合适。\n\n代价是触发规则要维护；好处是路由错了能一眼看出来是哪个 trigger 没配好。'
    }
  ],
  prereq: [
    {
      title: '指数衰减与半衰期',
      md: '衰减因子 = 0.5 ** (ageDays / halfLifeDays)。半衰期 30 天意味着 30 天前的记忆权重剩一半，60 天剩 1/4。\n\n```js\nconst recency = Math.pow(0.5, ageDays / halfLifeDays)\n```\n\n用毫秒时间戳时记得先除以 86400000 换成天；直接用毫秒会让衰减快到看不见。'
    },
    {
      title: 'trigger 的两种形态',
      md: '技能触发器一般两类：`keyword`（子串包含）和 `regex`（正则匹配）。\n\n正则要从字符串构造 `new RegExp(pattern)`，而**非法正则会抛异常**——技能库是用户可编辑的，必须 try/catch 跳过坏规则，而不是让整个路由挂掉。'
    }
  ],
  api: [
    {
      name: 'scoreMemories',
      sig: 'scoreMemories(query, memories, now, { k, halfLifeDays, similarityFn }) => [{ ...memory, score }]',
      args: 'memories: { id, text, createdAt, importance(0~1), lastAccess }[]；similarityFn(query, text) 由调用方注入。',
      returns: '按 score 降序的前 k 条，每条带 score。',
      example: 'scoreMemories(\'q\', memories, Date.now(), { k: 3, halfLifeDays: 30, similarityFn: (q, t) => 0.8 })'
    },
    {
      name: 'decayAndPrune',
      sig: 'decayAndPrune(memories, now, { halfLifeDays, minScore, maxAgeDays, similarityFn }) => { kept, dropped }',
      args: '同上；maxAgeDays 按 createdAt 计算，minScore 过滤衰减后的分数。',
      returns: 'kept 里每条带最新 score；dropped 是被淘汰的原条目。',
      example: 'decayAndPrune(memories, Date.now(), { halfLifeDays: 30, minScore: 0.05, maxAgeDays: 180, similarityFn })'
    },
    {
      name: 'matchSkills',
      sig: 'matchSkills(skills, input) => [{ name, description, hits }]',
      args: 'skills: { name, description, triggers: [{ type: \'keyword\'|\'regex\', value }] }[]。',
      returns: '按命中次数降序的技能列表；同一技能多个触发命中只算一次触发计数。',
      example: 'matchSkills(skills, \'把这个 pdf 发票 转成文字\')  // → pdf-tools 命中 2 次'
    }
  ],
  usage: 'const top = scoreMemories(query, longTerm, Date.now(), { k: 5, halfLifeDays: 30, similarityFn: embedSim })\nconst { kept, dropped } = decayAndPrune(longTerm, Date.now(), { halfLifeDays: 30, minScore: 0.05, maxAgeDays: 180, similarityFn: () => 0 })\nconst skills = matchSkills(skillLib, userInput)',
  hints: [
    'scoreMemories 里 ageDays = (now - lastAccess) / 86400000，recency = 0.5 ** (ageDays / halfLifeDays)。',
    'decayAndPrune 先按 maxAgeDays 淘汰，再算分数，低于 minScore 也淘汰。',
    'matchSkills 里正则用 try/catch 构造；命中数按触发器个数算，同一技能内去重。'
  ],
  concepts: [
    {
      title: '记忆分层的三层结构',
      md: '短期（对话窗口）、长期（向量库/键值库）、程序性（技能库）。三层的读写频率与检索方式都不同：短期靠截断与摘要，长期靠打分检索，程序性靠触发路由。把它们混成「一个记忆数组」是很多 Agent 项目后期难维护的根源。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '先写打分排序',
      think: '把三个权重固定成可测的组合，先让「重要度高的排前面、越旧越靠后、相关性可注入」三条成立。分数是浮点，测试只比较相对顺序与范围。',
      hint: 'score = 0.5*importance + 0.3*recency + 0.2*sim；recency 用半衰期公式；排序后 slice(0,k)。',
      code: `function scoreMemories(query, memories, now, opts) {
  const { k = 5, halfLifeDays = 30, similarityFn } = opts
  const scored = memories.map((m) => {
    const ageDays = Math.max(0, (now - m.lastAccess) / 86400000)
    const recency = Math.pow(0.5, ageDays / halfLifeDays)
    const sim = similarityFn ? similarityFn(query, m.text) : 0
    return { ...m, score: 0.5 * m.importance + 0.3 * recency + 0.2 * sim }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, k)
}`,
      test: L1S1,
      diag: [
        '权重加起来不是 1 或者漏了某一项：检查 0.5/0.3/0.2 的分工。',
        '衰减用了毫秒而不是天：(now - lastAccess)/86400000。',
        'similarityFn 没被调用或参数顺序反了（query, text）。',
        '忘了 slice(0, k) 或者排序方向反了。',
        '空数组时返回了 [{...}] 而不是 []。'
      ]
    },
    {
      n: 2,
      title: '再写遗忘与淘汰',
      think: '光打分不够：库会越来越大。先按年龄硬淘汰，再按分数软淘汰，并且把丢弃的条目返回出来——线上要靠 dropped 做审计。',
      hint: '先 filter 掉 age > maxAgeDays，再对剩下的算 score（同第 1 步），score < minScore 进 dropped。',
      code: `function scoreMemories(query, memories, now, opts) {
  const { k = 5, halfLifeDays = 30, similarityFn } = opts
  const scored = memories.map((m) => {
    const ageDays = Math.max(0, (now - m.lastAccess) / 86400000)
    const recency = Math.pow(0.5, ageDays / halfLifeDays)
    const sim = similarityFn ? similarityFn(query, m.text) : 0
    return { ...m, score: 0.5 * m.importance + 0.3 * recency + 0.2 * sim }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, k)
}

function decayAndPrune(memories, now, opts) {
  const { halfLifeDays = 30, minScore = 0, maxAgeDays = Infinity, similarityFn } = opts
  const kept = []
  const dropped = []
  for (const m of memories) {
    const ageDays = Math.max(0, (now - m.createdAt) / 86400000)
    if (ageDays > maxAgeDays) { dropped.push(m); continue }
    const recency = Math.pow(0.5, ageDays / halfLifeDays)
    const sim = similarityFn ? similarityFn('', m.text) : 0
    const score = 0.5 * m.importance + 0.3 * recency + 0.2 * sim
    if (score < minScore) dropped.push(m)
    else kept.push({ ...m, score })
  }
  kept.sort((a, b) => b.score - a.score)
  return { kept, dropped }
}`,
      test: L1S2,
      diag: [
        '年龄用 createdAt 算但写成了 lastAccess，或者单位没换成天。',
        '先算分再判年龄：超过 maxAgeDays 的条目仍然进了 kept。',
        'minScore 判断写成了 >=，边界条目被保留。',
        'kept 里没有把 score 写回，调用方拿不到最新分数。'
      ]
    },
    {
      n: 3,
      title: '最后接上技能库路由',
      think: '技能是程序性记忆，触发条件是明确的规则。核心是「命中计数 + 坏规则容错」：用户可编辑的 SKILL.md 里一个写坏的正则不能把整个路由拖垮。',
      hint: '每个技能遍历 triggers：keyword 用 includes，regex 用 try/catch new RegExp；命中数 >0 才进结果，按命中数降序。',
      code: `function scoreMemories(query, memories, now, opts) {
  const { k = 5, halfLifeDays = 30, similarityFn } = opts
  const scored = memories.map((m) => {
    const ageDays = Math.max(0, (now - m.lastAccess) / 86400000)
    const recency = Math.pow(0.5, ageDays / halfLifeDays)
    const sim = similarityFn ? similarityFn(query, m.text) : 0
    return { ...m, score: 0.5 * m.importance + 0.3 * recency + 0.2 * sim }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, k)
}

function decayAndPrune(memories, now, opts) {
  const { halfLifeDays = 30, minScore = 0, maxAgeDays = Infinity, similarityFn } = opts
  const kept = []
  const dropped = []
  for (const m of memories) {
    const ageDays = Math.max(0, (now - m.createdAt) / 86400000)
    if (ageDays > maxAgeDays) { dropped.push(m); continue }
    const recency = Math.pow(0.5, ageDays / halfLifeDays)
    const sim = similarityFn ? similarityFn('', m.text) : 0
    const score = 0.5 * m.importance + 0.3 * recency + 0.2 * sim
    if (score < minScore) dropped.push(m)
    else kept.push({ ...m, score })
  }
  kept.sort((a, b) => b.score - a.score)
  return { kept, dropped }
}

function toRegExp(src) {
  const end = src.lastIndexOf('/')
  if (src[0] === '/' && end > 0) {
    return new RegExp(src.slice(1, end), src.slice(end + 1))
  }
  return new RegExp(src)
}

function matchSkills(skills, input) {
  const out = []
  for (const skill of skills) {
    let hits = 0
    for (const t of skill.triggers ?? []) {
      if (t.type === 'keyword') {
        if (input.includes(t.value)) hits++
      } else if (t.type === 'regex') {
        try {
          if (toRegExp(t.value).test(input)) hits++
        } catch { /* 坏正则跳过：不能让一条烂技能把路由拖垮 */ }
      }
    }
    if (hits > 0) out.push({ name: skill.name, description: skill.description, hits })
  }
  out.sort((a, b) => b.hits - a.hits)
  return out
}`,
      test: L1S3,
      diag: [
        '正则直接从字符串构造没做 try/catch，遇到坏正则整条路由抛错。',
        '某个触发器命中后继续累加同一条 trigger（重复计数）。',
        '命中数为 0 的技能也被放进了结果。',
        '排序方向反了，或者按名字排序而不是命中数。',
        '命中计数把 keyword 和 regex 当成同一条 trigger 累加了。'
      ]
    }
  ],
  skeleton: `function scoreMemories(query, memories, now, opts) {
  throw new Error('scoreMemories 还没实现')
}
function decayAndPrune(memories, now, opts) {
  throw new Error('decayAndPrune 还没实现')
}
function toRegExp(src) {
  const end = src.lastIndexOf('/')
  if (src[0] === '/' && end > 0) {
    return new RegExp(src.slice(1, end), src.slice(end + 1))
  }
  return new RegExp(src)
}

function matchSkills(skills, input) {
  throw new Error('matchSkills 还没实现')
}`,
  solution: `function scoreMemories(query, memories, now, opts) {
  const { k = 5, halfLifeDays = 30, similarityFn } = opts
  const scored = memories.map((m) => {
    const ageDays = Math.max(0, (now - m.lastAccess) / 86400000)
    const recency = Math.pow(0.5, ageDays / halfLifeDays)
    const sim = similarityFn ? similarityFn(query, m.text) : 0
    return { ...m, score: 0.5 * m.importance + 0.3 * recency + 0.2 * sim }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, k)
}

function decayAndPrune(memories, now, opts) {
  const { halfLifeDays = 30, minScore = 0, maxAgeDays = Infinity, similarityFn } = opts
  const kept = []
  const dropped = []
  for (const m of memories) {
    const ageDays = Math.max(0, (now - m.createdAt) / 86400000)
    if (ageDays > maxAgeDays) { dropped.push(m); continue }
    const recency = Math.pow(0.5, ageDays / halfLifeDays)
    const sim = similarityFn ? similarityFn('', m.text) : 0
    const score = 0.5 * m.importance + 0.3 * recency + 0.2 * sim
    if (score < minScore) dropped.push(m)
    else kept.push({ ...m, score })
  }
  kept.sort((a, b) => b.score - a.score)
  return { kept, dropped }
}

function toRegExp(src) {
  const end = src.lastIndexOf('/')
  if (src[0] === '/' && end > 0) {
    return new RegExp(src.slice(1, end), src.slice(end + 1))
  }
  return new RegExp(src)
}

function matchSkills(skills, input) {
  const out = []
  for (const skill of skills) {
    let hits = 0
    for (const t of skill.triggers ?? []) {
      if (t.type === 'keyword') {
        if (input.includes(t.value)) hits++
      } else if (t.type === 'regex') {
        try {
          if (toRegExp(t.value).test(input)) hits++
        } catch { /* 坏正则跳过 */ }
      }
    }
    if (hits > 0) out.push({ name: skill.name, description: skill.description, hits })
  }
  out.sort((a, b) => b.hits - a.hits)
  return out
}`,
  finalCode: `function scoreMemories(query, memories, now, opts) {
  const { k = 5, halfLifeDays = 30, similarityFn } = opts
  const scored = memories.map((m) => {
    const ageDays = Math.max(0, (now - m.lastAccess) / 86400000)
    const recency = Math.pow(0.5, ageDays / halfLifeDays)
    const sim = similarityFn ? similarityFn(query, m.text) : 0
    return { ...m, score: 0.5 * m.importance + 0.3 * recency + 0.2 * sim }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, k)
}

function decayAndPrune(memories, now, opts) {
  const { halfLifeDays = 30, minScore = 0, maxAgeDays = Infinity, similarityFn } = opts
  const kept = []
  const dropped = []
  for (const m of memories) {
    const ageDays = Math.max(0, (now - m.createdAt) / 86400000)
    if (ageDays > maxAgeDays) { dropped.push(m); continue }
    const recency = Math.pow(0.5, ageDays / halfLifeDays)
    const sim = similarityFn ? similarityFn('', m.text) : 0
    const score = 0.5 * m.importance + 0.3 * recency + 0.2 * sim
    if (score < minScore) dropped.push(m)
    else kept.push({ ...m, score })
  }
  kept.sort((a, b) => b.score - a.score)
  return { kept, dropped }
}

function toRegExp(src) {
  const end = src.lastIndexOf('/')
  if (src[0] === '/' && end > 0) {
    return new RegExp(src.slice(1, end), src.slice(end + 1))
  }
  return new RegExp(src)
}

function matchSkills(skills, input) {
  const out = []
  for (const skill of skills) {
    let hits = 0
    for (const t of skill.triggers ?? []) {
      if (t.type === 'keyword') {
        if (input.includes(t.value)) hits++
      } else if (t.type === 'regex') {
        try {
          if (toRegExp(t.value).test(input)) hits++
        } catch { /* 坏正则跳过 */ }
      }
    }
    if (hits > 0) out.push({ name: skill.name, description: skill.description, hits })
  }
  out.sort((a, b) => b.hits - a.hits)
  return out
}`,
  tests: `${L1S1}\n${L1S2}\n${L1S3}`
}

/* ============================================================ 第 2 关 */
const LV2 = {
  id: 'lv2',
  title: 'RAG 全链路：切块、检索、引用核验',
  emoji: '📚',
  xp: 50,
  goal: '实现 RAG 的三段：chunkDocument（按长度切块并保留重叠与位置元数据）、cosineSimilarity + searchTopK（向量检索）、verifyCitations（引用越界与缺引用的机检）。',
  why: 'RAG 的失败很少是「模型不会答」，多数是链路某一段坏了：切块把答案切成两半、overlap 没保留导致跨块语义断裂、top-k 只按相似度选导致重复内容挤占上下文、生成侧幻觉没有引用核验。把这三段写成可测函数，才能定位是哪一段的问题。',
  nodes: ['ai.rag.retrieval-pipeline', 'ai.rag.retrieval-pipeline.chunking-strategies', 'ai.rag.retrieval-pipeline.generation-grounding'],
  thinking: [
    {
      title: '切块的两个参数为什么是 maxChars 和 overlap',
      md: 'chunk size 决定「一块能装多少上下文」，overlap 决定「跨块的信息会不会被切断」。\n\n切得太小：检索精准但语义不完整（一句话被切成两半）；切得太大：一块里混多个主题，检索到噪声。overlap 是保险丝：相邻块共享一段文字，跨块的指代/条件关系不至于丢失。代价是索引体积和重复召回。'
    },
    {
      title: '相似度不归一化的坑',
      md: '余弦相似度只看方向，不看长度——这正是我们想要的（长文档不该因为长而占优）。但工程上常见错误是拿未归一化的点积当相似度：向量模长差一个数量级，排序就完全变了。\n\n所以要么存归一化向量（点积即余弦），要么显式除以模长。这个函数就是那个「显式除以模长」。'
    },
    {
      title: '引用核验是幻觉的第一道闸',
      md: '要求模型输出 [1][2] 引用，然后用程序校验：编号是否越界、答案里有没有「没有引用的断言」。前者能机检，后者只能启发式（本关只做编号核验 + 是否有引用）。\n\n真实系统里还会做「引用的原文是否真的支持这句话」的 NLI 校验，那是第二道闸，成本更高。'
    }
  ],
  prereq: [
    {
      title: '余弦相似度公式',
      md: 'cos(a,b) = (a·b) / (|a|·|b|)。两个向量方向一致为 1，正交为 0，反向为 -1。\n\n零向量模长为 0，直接除会 NaN——所以要么约定零向量相似度为 0，要么在入口过滤。检索系统里空向量通常来自 embedding 失败，应该被丢弃而不是参与排序。'
    },
    {
      title: '切块的元数据为什么必须留',
      md: '块不能只有 text：还需要 start/end（原文位置）、index（第几块）、docId。没有位置信息，引用就无法回链到原文；没有序号，top-k 结果就无法稳定排序与去重。\n\n生产系统还会存 heading 路径、页码、表格标记——都是为了让「引用」可点击、可核验。'
    }
  ],
  api: [
    {
      name: 'chunkDocument',
      sig: 'chunkDocument(text, { maxChars, overlap }) => [{ index, text, start, end }]',
      args: 'maxChars 每块最大字符数；overlap 相邻块重叠字符数（0 表示不重叠）。',
      returns: '按顺序切好的块，带原文位置；空文本返回 []。',
      example: 'chunkDocument(longText, { maxChars: 500, overlap: 50 })'
    },
    {
      name: 'cosineSimilarity / searchTopK',
      sig: 'cosineSimilarity(a, b) => number；searchTopK(queryVec, docs, k) => [{ ...doc, score }]',
      args: 'docs: { id, vec }[]；queryVec 与 doc.vec 维度一致。',
      returns: 'cos 相似度；searchTopK 按分数降序取前 k。',
      example: 'searchTopK([1, 0], [{ id: \'a\', vec: [1, 0] }], 1)  // → [{ id: \'a\', score: 1 }]'
    },
    {
      name: 'verifyCitations',
      sig: 'verifyCitations(answer, docs) => { valid, invalid, needsCitation }',
      args: 'answer 里的引用写作 [n]，n 从 1 开始；docs 是检索到的块数组。',
      returns: 'valid：合法编号（去重升序）；invalid：越界编号；needsCitation：答案完全没引用时为 true。',
      example: 'verifyCitations(\'见[1]与[3]\', docs)  // docs 只有 2 条 → valid [1], invalid [3]'
    }
  ],
  usage: 'const chunks = chunkDocument(doc, { maxChars: 400, overlap: 40 })\nconst top = searchTopK(queryVec, chunks.map((c) => ({ id: c.index, vec: embed(c.text) })), 5)\nconst answer = await llm(prompt(top))\nconst check = verifyCitations(answer, top)\nif (check.invalid.length || check.needsCitation) retryWithStrongerGrounding()',
  hints: [
    'chunkDocument 可以用 while 循环切：每块从 cursor 开始取 maxChars，下一块起点 = cursor + maxChars - overlap。',
    'cosineSimilarity 先算点积与两个模长；模长为 0 直接返回 0，避免 NaN。',
    'verifyCitations 用 /\\[(\\d+)\\]/g 提取所有编号，再按 1..docs.length 判合法。'
  ],
  stages: [
    {
      n: 1,
      title: '先切块：长度、重叠、位置',
      think: '切块是最容易被当成「字符串 slice」的一步，但三个细节决定 RAG 质量：块之间要重叠、位置元数据要能回链、空输入不能产出空块。',
      hint: 'cursor 从 0 开始：end = min(cursor+maxChars, len)，push {index,text:slice(cursor,end),start:cursor,end}；下一轮 cursor = end - overlap（且必须 > 上一轮 cursor）。',
      code: `function chunkDocument(text, opts) {
  const { maxChars, overlap = 0 } = opts
  if (!text) return []
  const chunks = []
  let cursor = 0
  let index = 0
  while (cursor < text.length) {
    const end = Math.min(cursor + maxChars, text.length)
    chunks.push({ index, text: text.slice(cursor, end), start: cursor, end })
    if (end >= text.length) break
    const next = end - overlap
    cursor = next > cursor ? next : end
    index++
  }
  return chunks
}`,
      test: L2S1,
      diag: [
        'overlap 写成了「下一块起点 = cursor + maxChars + overlap」，越切越远。',
        'overlap 大于 maxChars 时死循环（next 没做兜底）。',
        '缺 start/end/index 元数据，或者 index 没递增。',
        '空文本返回了 [{ text: \'\' }] 而不是 []。',
        '最后一块没有处理「end 到文本末尾」的 break，多切出空块。'
      ]
    },
    {
      n: 2,
      title: '再检索：余弦相似度与 top-k',
      think: '相似度函数是检索的地基：归一化写错，排序全错；零向量不处理，一个 NaN 就能把 top-k 打乱。',
      hint: 'dot / (normA * normB)；两个模长任一为 0 返回 0；searchTopK 先 map 出 score 再 sort 再 slice。',
      code: `function chunkDocument(text, opts) {
  const { maxChars, overlap = 0 } = opts
  if (!text) return []
  const chunks = []
  let cursor = 0
  let index = 0
  while (cursor < text.length) {
    const end = Math.min(cursor + maxChars, text.length)
    chunks.push({ index, text: text.slice(cursor, end), start: cursor, end })
    if (end >= text.length) break
    const next = end - overlap
    cursor = next > cursor ? next : end
    index++
  }
  return chunks
}

function cosineSimilarity(a, b) {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

function searchTopK(queryVec, docs, k) {
  return docs
    .map((d) => ({ ...d, score: cosineSimilarity(queryVec, d.vec) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}`,
      test: L2S2,
      diag: [
        '余弦算成了点积（没除以模长），长向量会占优。',
        '零向量没处理，返回 NaN 后排序失效。',
        'searchTopK 排序方向反了，或者忘了 slice(0,k)。',
        'score 没写回对象，调用方拿不到相似度。',
        '查询向量与文档向量维度不一致时没有处理（按较短数组的长度循环会越界或错位）。'
      ]
    },
    {
      n: 3,
      title: '最后核验引用：越界与缺引用',
      think: '生成侧的幻觉不能只靠 prompt「请引用」。程序能核的是编号是否越界、答案是否完全没引用；这两条就能拦住大部分「编造来源」的输出。',
      hint: '用正则匹配 /\\[(\\d+)\\]/g 收集编号；valid = 1<=n<=docs.length；无任何引用 → needsCitation=true。',
      code: `function chunkDocument(text, opts) {
  const { maxChars, overlap = 0 } = opts
  if (!text) return []
  const chunks = []
  let cursor = 0
  let index = 0
  while (cursor < text.length) {
    const end = Math.min(cursor + maxChars, text.length)
    chunks.push({ index, text: text.slice(cursor, end), start: cursor, end })
    if (end >= text.length) break
    const next = end - overlap
    cursor = next > cursor ? next : end
    index++
  }
  return chunks
}

function cosineSimilarity(a, b) {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

function searchTopK(queryVec, docs, k) {
  return docs
    .map((d) => ({ ...d, score: cosineSimilarity(queryVec, d.vec) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}

function verifyCitations(answer, docs) {
  const found = [...answer.matchAll(/\\[(\\d+)\\]/g)].map((m) => Number(m[1]))
  const valid = [...new Set(found.filter((n) => n >= 1 && n <= docs.length))].sort((a, b) => a - b)
  const invalid = [...new Set(found.filter((n) => n < 1 || n > docs.length))].sort((a, b) => a - b)
  return { valid, invalid, needsCitation: found.length === 0 }
}`,
      test: L2S3,
      diag: [
        '正则只匹配了 [1] 这种单个数字，多位数或负数漏掉。',
        'valid 没去重（重复引用出现两次）或没排序。',
        'invalid 边界写成 n > docs.length 但没有 n < 1 的分支（0 和负数漏了）。',
        '完全没有引用时 needsCitation 没置 true。',
        '引用编号带前导零（[01]）时被当成非法，或者多位数只匹配了第一位。'
      ]
    }
  ],
  skeleton: `function chunkDocument(text, opts) {
  throw new Error('chunkDocument 还没实现')
}
function cosineSimilarity(a, b) {
  throw new Error('cosineSimilarity 还没实现')
}
function searchTopK(queryVec, docs, k) {
  throw new Error('searchTopK 还没实现')
}
function verifyCitations(answer, docs) {
  throw new Error('verifyCitations 还没实现')
}`,
  solution: `function chunkDocument(text, opts) {
  const { maxChars, overlap = 0 } = opts
  if (!text) return []
  const chunks = []
  let cursor = 0
  let index = 0
  while (cursor < text.length) {
    const end = Math.min(cursor + maxChars, text.length)
    chunks.push({ index, text: text.slice(cursor, end), start: cursor, end })
    if (end >= text.length) break
    const next = end - overlap
    cursor = next > cursor ? next : end
    index++
  }
  return chunks
}

function cosineSimilarity(a, b) {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

function searchTopK(queryVec, docs, k) {
  return docs
    .map((d) => ({ ...d, score: cosineSimilarity(queryVec, d.vec) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}

function verifyCitations(answer, docs) {
  const found = [...answer.matchAll(/\\[(\\d+)\\]/g)].map((m) => Number(m[1]))
  const valid = [...new Set(found.filter((n) => n >= 1 && n <= docs.length))].sort((a, b) => a - b)
  const invalid = [...new Set(found.filter((n) => n < 1 || n > docs.length))].sort((a, b) => a - b)
  return { valid, invalid, needsCitation: found.length === 0 }
}`,
  finalCode: `function chunkDocument(text, opts) {
  const { maxChars, overlap = 0 } = opts
  if (!text) return []
  const chunks = []
  let cursor = 0
  let index = 0
  while (cursor < text.length) {
    const end = Math.min(cursor + maxChars, text.length)
    chunks.push({ index, text: text.slice(cursor, end), start: cursor, end })
    if (end >= text.length) break
    const next = end - overlap
    cursor = next > cursor ? next : end
    index++
  }
  return chunks
}

function cosineSimilarity(a, b) {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

function searchTopK(queryVec, docs, k) {
  return docs
    .map((d) => ({ ...d, score: cosineSimilarity(queryVec, d.vec) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}

function verifyCitations(answer, docs) {
  const found = [...answer.matchAll(/\\[(\\d+)\\]/g)].map((m) => Number(m[1]))
  const valid = [...new Set(found.filter((n) => n >= 1 && n <= docs.length))].sort((a, b) => a - b)
  const invalid = [...new Set(found.filter((n) => n < 1 || n > docs.length))].sort((a, b) => a - b)
  return { valid, invalid, needsCitation: found.length === 0 }
}`,
  tests: `${L2S1}\n${L2S2}\n${L2S3}`
}

/* ============================================================ 第 3 关 */
const LV3 = {
  id: 'lv3',
  title: '推理服务：KV cache、吞吐账与量化档位',
  emoji: '⚙️',
  xp: 55,
  goal: '实现服务容量的三笔账：kvCacheBytes（KV cache 显存公式）、estimateLatency（TTFT + ITL 的延迟与吞吐）、decideQuantization（按显存与延迟目标选 fp16/int8/int4）。',
  why: '推理服务的面试题几乎都是算术题：7B 模型 KV cache 占多少、batch 开到 32 时吞吐多少、显存不够该降精度还是缩序列。算不清这三笔账，容量规划就只能靠猜；算清了，很多「玄学慢」会变成一眼可见的瓶颈。',
  nodes: ['ai.serving.infer-serving', 'ai.serving.infer-serving.cost-latency', 'ai.serving.infer-serving.kv-cache-batching', 'ai.serving.infer-serving.quantize-accel'],
  thinking: [
    {
      title: 'KV cache 为什么是 2 倍',
      md: '每个 token 在每层都要缓存 K 和 V 两个向量，所以公式里有个 2。每层的向量维度是 heads × headDim，乘以层数就是全部缓存。\n\n它随 seqLen 和 batch 线性增长——这就是长上下文和并发数的成本来源。7B / 32 层 / 32 头 / 128 维 / 2 字节，1K 序列单条就要约 0.5GB。'
    },
    {
      title: '延迟拆成 TTFT 与 ITL',
      md: '首 token 延迟（TTFT）决定「感觉快不快」，每 token 间隔（ITL）决定「读得顺不顺」。总延迟 ≈ TTFT + outputTokens × ITL。\n\n吞吐要按「总输出 token / 总时间」算，batch 并行时延迟变化不大但吞吐按 batch 放大——这就是 continuous batching 的价值。'
    },
    {
      title: '量化是显存换精度，不是免费午餐',
      md: 'fp16 → int8 显存减半、吞吐通常提升，精度损失小；int4 再减半，但长上下文与推理任务上精度损失开始可见。\n\n所以决策顺序是：先看显存放不放得下（放不下必须量化），再看延迟目标（要求极严时用 int8 换吞吐），最后才考虑精度敏感任务是否该保 fp16。'
    }
  ],
  prereq: [
    {
      title: 'GB 与字节的换算',
      md: '1 GB = 1e9 字节（厂商标称）或 1024³（操作系统）。显存账单统一用 1e9 更接近「显卡标称 24GB」。\n\n本关统一用 1e9：estVramGB = params × bits / 8 / 1e9。7B fp16 = 7e9 × 2 / 8 / 1e9 = 14GB。'
    },
    {
      title: 'TTFT / ITL / 吞吐的定义',
      md: 'TTFT（time to first token）：请求到第一个 token 的时间，主要受 prefill 影响。\nITL（inter-token latency）：相邻 token 的间隔，主要受 decode 影响。\n吞吐：单位时间产出的 token 数（tokens/s），batch 越大越高，但单请求延迟可能变差。'
    }
  ],
  api: [
    {
      name: 'kvCacheBytes',
      sig: 'kvCacheBytes({ layers, heads, headDim, seqLen, batch, bytesPerParam }) => number',
      args: '模型结构参数 + 序列长度 + batch + 每参数字节（fp16=2, int8=1）。',
      returns: 'KV cache 字节数 = 2 × layers × heads × headDim × seqLen × batch × bytesPerParam；缺参数抛错。',
      example: 'kvCacheBytes({ layers: 32, heads: 32, headDim: 128, seqLen: 1024, batch: 1, bytesPerParam: 2 })'
    },
    {
      name: 'estimateLatency',
      sig: 'estimateLatency({ ttftMs, outputTokens, itlMs }, { batch }) => { totalMs, tokensPerSec }',
      args: 'ttftMs 首 token 延迟；outputTokens 输出长度；itlMs 每 token 间隔；batch 并发数。',
      returns: 'totalMs = ttft + outputTokens×itl；tokensPerSec = outputTokens×batch / (totalMs/1000)。',
      example: 'estimateLatency({ ttftMs: 100, outputTokens: 50, itlMs: 20 }, { batch: 4 })'
    },
    {
      name: 'decideQuantization',
      sig: 'decideQuantization({ vramGB, modelParams, targetLatencyMs }) => { quant, estVramGB }',
      args: 'vramGB 可用显存；modelParams 参数量；targetLatencyMs 单请求延迟目标。',
      returns: 'quant ∈ fp16 | int8 | int4；estVramGB 按所选档位估算。',
      example: 'decideQuantization({ vramGB: 8, modelParams: 7e9, targetLatencyMs: 5000 })  // → int8'
    }
  ],
  usage: 'const kv = kvCacheBytes({ layers: 32, heads: 32, headDim: 128, seqLen: 8192, batch: 8, bytesPerParam: 2 })\nconst { totalMs, tokensPerSec } = estimateLatency({ ttftMs: 200, outputTokens: 200, itlMs: 18 }, { batch: 8 })\nconst plan = decideQuantization({ vramGB: 8, modelParams: 7e9, targetLatencyMs: 800 })',
  hints: [
    'kvCacheBytes 先校验六个参数都存在，再按公式乘。',
    'estimateLatency 的吞吐分子别忘了乘 batch；outputTokens=0 时吞吐直接 0。',
    'decideQuantization：fp16 显存 = params*2/1e9；放不下试 int8（params*1/1e9）；再放不下 int4（params*0.5/1e9）。'
  ],
  stages: [
    {
      n: 1,
      title: '先算 KV cache 显存',
      think: '这是纯公式，但错一个 2 或者把 heads×headDim 当维度，结果差一倍。先让它对，再谈 batch 与序列长度的线性关系。',
      hint: '2 * layers * heads * headDim * seqLen * batch * bytesPerParam；缺参数 throw。',
      code: `function kvCacheBytes(cfg) {
  const { layers, heads, headDim, seqLen, batch, bytesPerParam } = cfg
  for (const [name, v] of Object.entries({ layers, heads, headDim, seqLen, batch, bytesPerParam })) {
    if (typeof v !== 'number' || v < 0) throw new Error('kvCacheBytes 缺少或非法参数：' + name)
  }
  return 2 * layers * heads * headDim * seqLen * batch * bytesPerParam
}`,
      test: L3S1,
      diag: [
        '公式少了 2（K 和 V 各一份）。',
        'heads × headDim 写成了 heads + headDim，或者漏了任一项。',
        '缺参数时返回 NaN 而不是抛错。',
        'batch/seqLen 的线性关系对不上（比如把 batch 平方了）。'
      ]
    },
    {
      n: 2,
      title: '再算延迟与吞吐',
      think: '面试里经常把延迟和吞吐混为一谈。这里把两笔账拆开：总延迟只看单请求，吞吐要乘 batch——两个数一起看才能解释「为什么 batch 变大后单请求更慢但更划算」。',
      hint: 'totalMs = ttftMs + outputTokens * itlMs；tokensPerSec = outputTokens === 0 ? 0 : outputTokens * batch / (totalMs / 1000)。',
      code: `function kvCacheBytes(cfg) {
  const { layers, heads, headDim, seqLen, batch, bytesPerParam } = cfg
  for (const [name, v] of Object.entries({ layers, heads, headDim, seqLen, batch, bytesPerParam })) {
    if (typeof v !== 'number' || v < 0) throw new Error('kvCacheBytes 缺少或非法参数：' + name)
  }
  return 2 * layers * heads * headDim * seqLen * batch * bytesPerParam
}

function estimateLatency(cfg, opts = {}) {
  const { ttftMs, outputTokens, itlMs } = cfg
  const { batch = 1 } = opts
  const totalMs = ttftMs + outputTokens * itlMs
  const tokensPerSec = outputTokens === 0 ? 0 : (outputTokens * batch) / (totalMs / 1000)
  return { totalMs, tokensPerSec }
}`,
      test: L3S2,
      diag: [
        'totalMs 里 outputTokens 的乘写成了加。',
        '吞吐分子漏了 batch，或者分母用了 outputTokens 而不是总秒数。',
        'outputTokens=0 时除零，返回 Infinity。',
        '单位换错：毫秒转秒忘了除以 1000。'
      ]
    },
    {
      n: 3,
      title: '最后做量化档位决策',
      think: '量化不是「越小越好」：先看放不放得下，再看延迟要求，最后才是精度。决策函数要把这个顺序写死，否则线上会为了省显存把精度敏感任务降到 int4。',
      hint: 'estVramGB = modelParams * bits / 8 / 1e9；fp16 放得下且延迟达标 → fp16；否则 int8；int8 也放不下 → int4；显存够但目标延迟极严 → int8。',
      code: `function kvCacheBytes(cfg) {
  const { layers, heads, headDim, seqLen, batch, bytesPerParam } = cfg
  for (const [name, v] of Object.entries({ layers, heads, headDim, seqLen, batch, bytesPerParam })) {
    if (typeof v !== 'number' || v < 0) throw new Error('kvCacheBytes 缺少或非法参数：' + name)
  }
  return 2 * layers * heads * headDim * seqLen * batch * bytesPerParam
}

function estimateLatency(cfg, opts = {}) {
  const { ttftMs, outputTokens, itlMs } = cfg
  const { batch = 1 } = opts
  const totalMs = ttftMs + outputTokens * itlMs
  const tokensPerSec = outputTokens === 0 ? 0 : (outputTokens * batch) / (totalMs / 1000)
  return { totalMs, tokensPerSec }
}

function decideQuantization(spec) {
  const { vramGB, modelParams, targetLatencyMs } = spec
  const gbFor = (bits) => (modelParams * bits) / 8 / 1e9
  if (gbFor(16) <= vramGB && targetLatencyMs > 500) {
    return { quant: 'fp16', estVramGB: gbFor(16) }
  }
  if (gbFor(8) <= vramGB) {
    return { quant: 'int8', estVramGB: gbFor(8) }
  }
  return { quant: 'int4', estVramGB: gbFor(4) }
}`,
      test: L3S3,
      diag: [
        '显存换算少了 /1e9，把字节数直接和 GB 比。',
        '判断顺序反了：先 int4 再 fp16，把能放下的模型降了精度。',
        '延迟阈值 500ms 没参与判断，显存够就一定选 fp16。',
        'estVramGB 用所选档位的 bits 算错（比如 int8 用了 16）。',
        '显存够但延迟目标极严时，没有从 fp16 切到 int8。'
      ]
    }
  ],
  skeleton: `function kvCacheBytes(cfg) {
  throw new Error('kvCacheBytes 还没实现')
}
function estimateLatency(cfg, opts) {
  throw new Error('estimateLatency 还没实现')
}
function decideQuantization(spec) {
  throw new Error('decideQuantization 还没实现')
}`,
  solution: `function kvCacheBytes(cfg) {
  const { layers, heads, headDim, seqLen, batch, bytesPerParam } = cfg
  for (const [name, v] of Object.entries({ layers, heads, headDim, seqLen, batch, bytesPerParam })) {
    if (typeof v !== 'number' || v < 0) throw new Error('kvCacheBytes 缺少或非法参数：' + name)
  }
  return 2 * layers * heads * headDim * seqLen * batch * bytesPerParam
}

function estimateLatency(cfg, opts = {}) {
  const { ttftMs, outputTokens, itlMs } = cfg
  const { batch = 1 } = opts
  const totalMs = ttftMs + outputTokens * itlMs
  const tokensPerSec = outputTokens === 0 ? 0 : (outputTokens * batch) / (totalMs / 1000)
  return { totalMs, tokensPerSec }
}

function decideQuantization(spec) {
  const { vramGB, modelParams, targetLatencyMs } = spec
  const gbFor = (bits) => (modelParams * bits) / 8 / 1e9
  if (gbFor(16) <= vramGB && targetLatencyMs > 500) {
    return { quant: 'fp16', estVramGB: gbFor(16) }
  }
  if (gbFor(8) <= vramGB) {
    return { quant: 'int8', estVramGB: gbFor(8) }
  }
  return { quant: 'int4', estVramGB: gbFor(4) }
}`,
  finalCode: `function kvCacheBytes(cfg) {
  const { layers, heads, headDim, seqLen, batch, bytesPerParam } = cfg
  for (const [name, v] of Object.entries({ layers, heads, headDim, seqLen, batch, bytesPerParam })) {
    if (typeof v !== 'number' || v < 0) throw new Error('kvCacheBytes 缺少或非法参数：' + name)
  }
  return 2 * layers * heads * headDim * seqLen * batch * bytesPerParam
}

function estimateLatency(cfg, opts = {}) {
  const { ttftMs, outputTokens, itlMs } = cfg
  const { batch = 1 } = opts
  const totalMs = ttftMs + outputTokens * itlMs
  const tokensPerSec = outputTokens === 0 ? 0 : (outputTokens * batch) / (totalMs / 1000)
  return { totalMs, tokensPerSec }
}

function decideQuantization(spec) {
  const { vramGB, modelParams, targetLatencyMs } = spec
  const gbFor = (bits) => (modelParams * bits) / 8 / 1e9
  if (gbFor(16) <= vramGB && targetLatencyMs > 500) {
    return { quant: 'fp16', estVramGB: gbFor(16) }
  }
  if (gbFor(8) <= vramGB) {
    return { quant: 'int8', estVramGB: gbFor(8) }
  }
  return { quant: 'int4', estVramGB: gbFor(4) }
}`,
  tests: `${L3S1}\n${L3S2}\n${L3S3}`
}

export default {
  id: 'ai-memory',
  version: 3,
  domain: 'ai',
  cumulative: false,
  title: '记忆、检索与推理服务',
  emoji: '🗂️',
  tagline: '3 关：长期记忆打分与遗忘、RAG 切块检索与引用核验、推理服务的显存/吞吐/量化账。',
  stack: ['LLM 应用', 'RAG', '推理服务'],
  intro: 'AI 应用的成本与效果，大半花在「记忆」和「检索」和「推理」这三件事上。这个项目把它们从概念拆成可跑的代码：记忆怎么打分、什么时候该忘；文档怎么切、向量怎么比、引用怎么核；KV cache 占多少显存、batch 怎么换吞吐、什么时候该量化。做完你会有一种「容量规划能算」的踏实感——而不是靠感觉调参。',
  outcome: '你能实现记忆打分/淘汰与技能路由，独立写出 RAG 的切块-检索-引用核验链路，并算出推理服务的 KV cache 显存、TTFT/ITL 延迟与量化档位。',
  levels: [LV1, LV2, LV3]
}