/**
 * 内容源：RAG 混合检索 —— BM25 + 向量 + RRF
 *
 * 这一季只做「检索」这一件事，把它拆成三个真实系统里一定会遇到的零件：
 *   1) BM25：关键词召回，便宜、可解释，对专有名词准
 *   2) 向量检索：语义召回，能命中「字面不同但意思一样」的文档
 *   3) RRF：把两条路的榜单合成一条，且不需要调权重
 *
 * 为什么值得单独做一季：RAG 的答案质量，七成取决于召回。而召回做不好的人，
 * 绝大多数不是「模型选错了」，是根本没意识到关键词路和语义路各自的盲区。
 * 第 3 关会用一组「BM25 和向量各有胜负」的语料，把「为什么要混合」变成可跑出来的事实。
 */

/* ------------------------------------------------------------ 第 1 关测试 */
const L1S1 = `{
  check('分词：统一小写、标点变分隔符', () => {
    same(tokenize('Vue 的 响应式，Proxy！'), ['vue', '的', '响应式', 'proxy'])
  })
  check('空文本、连续空白都得到空数组', () => {
    same(tokenize(''), [])
    same(tokenize('   \\t  '), [])
  })
  check('词频统计：重复词按次数累加', () => {
    const tf = termFreq(tokenize('a b a a'))
    same(tf.get('a'), 3)
    same(tf.get('b'), 1)
    same(tf.get('c'), undefined)
  })
}`

const L1S2 = `{
  const docs = [
    { id: 'd1', text: 'vue reactivity proxy' },
    { id: 'd2', text: 'vue render scheduler' },
    { id: 'd3', text: 'redis cache eviction' }
  ]
  const index = buildIndex(docs)

  check('索引里有文档、长度和平均长度', () => {
    same(index.N, 3)
    same(index.list.length, 3)
    same(index.list[0].length, 3)
    same(index.avgdl, 3)
  })
  check('df 统计的是「包含某词的文档数」，不是词频', () => {
    same(index.df.get('vue'), 2)
    same(index.df.get('redis'), 1)
    same(index.df.get('proxy'), 1)
    same(index.df.get('没出现过'), undefined)
  })
  check('idf 公式：稀有词的 idf 大于常见词', () => {
    ok(idfOf(index, 'redis') > idfOf(index, 'vue'))
    same(idfOf(index, '没出现过'), Math.log(1 + (3 - 0 + 0.5) / (0 + 0.5)))
  })
  check('idf 数值与公式一致', () => {
    const expected = Math.log(1 + (3 - 1 + 0.5) / (1 + 0.5))
    ok(Math.abs(idfOf(index, 'redis') - expected) < 1e-9)
  })
}`

const L1S3 = `{
  const docs = [
    { id: 'd1', text: 'vue reactivity proxy' },
    { id: 'd2', text: 'vue render scheduler' },
    { id: 'd3', text: 'redis cache eviction' },
    { id: 'd4', text: 'proxy 拦截与依赖收集' },
    { id: 'd5', text: 'reactivity 原理' }
  ]
  const index = buildIndex(docs)

  check('两路都命中的文档排第一', () => {
    const rows = bm25Rank(index, 'vue reactivity')
    same(rows[0].id, 'd1')
  })
  check('稀有词权重更高：只提 redis 时 redis 文档排第一', () => {
    same(bm25Rank(index, 'redis')[0].id, 'd3')
  })
  check('k1=0 时词频不再加分（饱和到顶）', () => {
    const idx = buildIndex([
      { id: 'a', text: 'vue vue vue x' },
      { id: 'b', text: 'vue y z w' }
    ])
    const rows = bm25Rank(idx, 'vue', { k1: 0 })
    ok(Math.abs(rows[0].score - rows[1].score) < 1e-12)
  })
  check('b=0 时不惩罚长文档（同词频同分）', () => {
    const idx = buildIndex([
      { id: 'a', text: 'vue' },
      { id: 'b', text: 'vue a b c d' }
    ])
    const rows = bm25Rank(idx, 'vue', { b: 0 })
    ok(Math.abs(rows[0].score - rows[1].score) < 1e-12)
  })
  check('完全没命中的 query 返回空数组', () => {
    same(bm25Rank(index, 'zzz 不存在'), [])
  })
  check('同分时按 id 字典序，不靠插入顺序', () => {
    const idx = buildIndex([
      { id: 'z9', text: 'alpha beta' },
      { id: 'a1', text: 'alpha beta' }
    ])
    same(bm25Rank(idx, 'alpha').map((r) => r.id), ['a1', 'z9'])
  })
  check('topK 截断生效', () => {
    same(bm25Rank(index, 'vue reactivity', { k: 1 }).length, 1)
  })
}`

/* ------------------------------------------------------------ 第 2 关测试 */
const L2S1 = `{
  check('同向向量相似度为 1', () => {
    ok(Math.abs(cosine([1, 2, 3], [2, 4, 6]) - 1) < 1e-12)
  })
  check('正交向量相似度为 0', () => {
    ok(Math.abs(cosine([1, 0], [0, 1])) < 1e-12)
  })
  check('余弦只看方向，不看长度', () => {
    ok(Math.abs(cosine([1, 2], [10, 20]) - 1) < 1e-12)
    ok(Math.abs(cosine([1, 0], [0.001, 0]) - 1) < 1e-12)
  })
  check('零向量返回 0，而不是 NaN', () => {
    same(cosine([0, 0], [1, 1]), 0)
    same(cosine([1, 1], [0, 0]), 0)
  })
  check('维度不一致要抛错，不能静默算错', () => {
    throws(() => cosine([1, 2], [1, 2, 3]))
  })
}`

const L2S2 = `{
  const store = [
    { id: 'd1', vector: [1, 0] },
    { id: 'd2', vector: [0, 1] },
    { id: 'd3', vector: [0.9, 0.1] },
    { id: 'd4', vector: [-1, 0] }
  ]
  const query = [1, 0]

  check('按相似度从高到低排序', () => {
    const rows = topKVector(store, query)
    same(rows.map((r) => r.id), ['d1', 'd3', 'd2', 'd4'])
    ok(rows[1].score > rows[2].score)
  })
  check('同分按 id 字典序（稳定可复现）', () => {
    const rows = topKVector([
      { id: 'z', vector: [1, 0] },
      { id: 'a', vector: [1, 0] }
    ], query)
    same(rows.map((r) => r.id), ['a', 'z'])
  })
  check('topK 截断与边界', () => {
    same(topKVector(store, query, 2).length, 2)
    same(topKVector(store, query, 99).length, 4)
    same(topKVector([], query).length, 0)
  })
}`

const L2S3 = `{
  check('归一化后长度是 1，方向不变', () => {
    const v = normalize([3, 4])
    ok(Math.abs(Math.sqrt(v.reduce((s, x) => s + x * x, 0)) - 1) < 1e-12)
    ok(Math.abs(v[0] - 0.6) < 1e-12)
    ok(Math.abs(v[1] - 0.8) < 1e-12)
  })
  check('归一化不改变两向量的余弦相似度', () => {
    const a = [1, 2, 3]
    const b = [3, 2, 1]
    ok(Math.abs(cosine(normalize(a), normalize(b)) - cosine(a, b)) < 1e-12)
  })
  check('零向量归一化不产生 NaN', () => {
    same(normalize([0, 0]), [0, 0])
  })
  check('检索前校验维度：文档向量维度不对就抛错', () => {
    throws(() => searchVectors([
      { id: 'ok', vector: [1, 0] },
      { id: 'bad', vector: [1, 0, 0] }
    ], [1, 0]))
  })
  check('searchVectors 的排序与 topKVector 一致', () => {
    const store = [
      { id: 'd1', vector: [1, 0] },
      { id: 'd2', vector: [0, 1] }
    ]
    same(searchVectors(store, [1, 0]).map((r) => r.id), ['d1', 'd2'])
    same(searchVectors(store, [1, 0], 1).length, 1)
  })
}`

/* ------------------------------------------------------------ 第 3 关测试 */
const L3S1 = `{
  check('单路 RRF：名次越靠前分越高', () => {
    const s = rrfScores([['a', 'b', 'c']])
    ok(s.get('a') > s.get('b'))
    ok(s.get('b') > s.get('c'))
    ok(Math.abs(s.get('a') - 1 / 61) < 1e-12)
  })
  check('两路 RRF：同一文档的分数相加', () => {
    const s = rrfScores([['a', 'b'], ['b', 'a']])
    ok(Math.abs(s.get('a') - (1 / 61 + 1 / 62)) < 1e-12)
    ok(Math.abs(s.get('b') - (1 / 62 + 1 / 61)) < 1e-12)
  })
  check('k 变小会放大名次差距', () => {
    const small = rrfScores([['a', 'b']], 0)
    ok(Math.abs(small.get('a') - 1) < 1e-12)
    ok(Math.abs(small.get('b') - 0.5) < 1e-12)
  })
  check('空输入得到空表', () => {
    same(rrfScores([]).size, 0)
    same(rrfScores([[], []]).size, 0)
  })
}`

const L3S2 = `{
  check('两路都召回的文档只出现一次，分数相加', () => {
    const rows = fuseResults([['a', 'b'], ['b', 'c']])
    same(rows.map((r) => r.id), ['b', 'a', 'c'])
    same(rows.length, 3)
  })
  check('topN 截断', () => {
    const rows = fuseResults([['a', 'b', 'c', 'd']], { topN: 2 })
    same(rows.map((r) => r.id), ['a', 'b'])
  })
  check('同分按 id 字典序', () => {
    const rows = fuseResults([['z', 'a']], { k: 0 })
    // 单路时名次不同，分数必然不同；用两路把同分造出来
    const tied = fuseResults([['z'], ['a']])
    same(tied.map((r) => r.id), ['a', 'z'])
    same(rows.length, 2)
  })
}`

const L3S3 = `{
  const docs = [
    { id: 'd1', text: 'vue reactivity proxy' },
    { id: 'd2', text: 'redis cache eviction' },
    { id: 'd3', text: 'vue render scheduler' },
    { id: 'd4', text: 'proxy 拦截与依赖收集' },
    { id: 'd5', text: 'reactivity 原理' }
  ]
  const vectors = [
    { id: 'd1', vector: [1, 0] },
    { id: 'd2', vector: [0, 1] },
    { id: 'd3', vector: [0.9, 0.1] },
    { id: 'd4', vector: [1, 0] },
    { id: 'd5', vector: [0, 0.1] }
  ]
  const corpus = { docs, vectors }
  const fused = hybridSearch(corpus, 'vue reactivity', { queryVector: [1, 0], topN: 4 })
  const bm25Only = hybridSearch(corpus, 'vue reactivity', { topN: 4 })
  const vecOnly = hybridSearch({ docs: [], vectors }, '', { queryVector: [1, 0], topN: 4 })

  check('两路都命中的 d1 排第一', () => {
    same(fused[0].id, 'd1')
  })
  check('关键词路漏掉的语义文档 d4 被融合补回来', () => {
    ok(!bm25Only.slice(0, 3).some((r) => r.id === 'd4'))
    ok(fused.some((r) => r.id === 'd4'))
  })
  check('语义路弱的关键词文档 d5 被融合补回来', () => {
    ok(!vecOnly.slice(0, 3).some((r) => r.id === 'd5'))
    ok(fused.some((r) => r.id === 'd5'))
  })
  check('融合结果按分数降序且不重复', () => {
    const ids = fused.map((r) => r.id)
    same(new Set(ids).size, ids.length)
    for (let i = 1; i < fused.length; i++) ok(fused[i - 1].score >= fused[i].score)
  })
  check('topN 截断', () => {
    same(hybridSearch(corpus, 'vue reactivity', { queryVector: [1, 0], topN: 2 }).length, 2)
  })
}`

export default {
  id: 'hybrid-retrieval',
  version: 3,
  domain: 'ai',
  title: '从零写一个混合检索器',
  emoji: '🔎',
  tagline: '3 关 9 步：BM25 打分 → 向量召回 → RRF 融合，最后用一组语料证明「为什么要混合」。',
  stack: ['JavaScript', 'RAG', '检索'],
  intro: 'RAG 的答案好不好，七成看召回。这一季不背概念，从零写出一个能跑的混合检索器：先做关键词路的 BM25（分词、df/idf、长度归一化、词频饱和），再做语义路的余弦 + topK，最后用 RRF 把两条榜单合成一条。每一步都有测试盯着，哪一步的修正没生效，立刻红。',
  outcome: '做完你手上有一个能跑、能解释的检索器：知道 BM25 的 k1/b 各自控制什么、知道余弦为什么不受向量长度影响、知道 RRF 为什么用名次而不是分数。面试被问「RAG 召回怎么优化」，你可以从「两路互补 + 名次融合」讲到具体代码。',
  levels: [
    /* ---------------------------------------------------------- 第 1 关 */
    {
      id: 'lv1',
      title: 'BM25：关键词检索不是数词频',
      emoji: '📊',
      xp: 40,
      goal: '把文档集建成倒排统计，并对 query 打出 BM25 分数、排出榜单（含 k1/b 两个参数）。',
      why: '真实 RAG 的第一路召回几乎总是关键词检索：它便宜、可解释、对专有名词和编号特别准。BM25 是这一路的工业默认值，但公式看着吓人——这一关把它拆成「分词 → 统计 → 打分」三步，每一步都能独立跑测试。',
      nodes: ['ai.rag.retrieval-pipeline.hybrid-retrieval'],
      thinking: [
        {
          title: '先问「相关」到底指什么，再谈公式',
          md: `拿到「做一个检索打分」这个需求，我没有先查 BM25 公式，而是先问：什么情况下「数词频」会给出错误答案？

一数就发现三个坑：**长文档天然词多**，同样的词频在长文里含金量更低；**「的 / 是 / vue」这种到处都有的词**会把所有文档拉平；**一个词重复 10 次不该比 2 次相关 5 倍**，收益会饱和。

BM25 的三项修正正好分别对应这三个坑：长度归一化、IDF、词频饱和。所以我不是在背公式，是在给三个具体的错误打补丁——这也是我讲这题时能让对方听懂的原因。`
        },
        {
          title: '为什么先写统计（df/idf），再写打分',
          md: `打分是「查表」：查每个词的 idf、每篇文档的长度。表错了，公式再对也是错的——而分数不对时，你很难分清是统计算错还是公式写错。

所以顺序是：第 1 步只做分词和词频；第 2 步只做倒排统计（df / idf / avgdl）；第 3 步才把它们乘起来。每一步都有自己的测试，错了立刻知道坏在哪一层。

这是我在工程里最常用的一招：**把「会互相污染的错误」拆到不同步骤里**，让测试的红色指哪打哪。`
        },
        {
          title: 'k1 和 b 不是玄学参数',
          md: `BM25 只有两个参数，而且都能用「极端值」理解：

- \`k1\` 控制词频饱和速度。\`k1 = 0\` 时词频完全不参与打分（出现 1 次和 10 次一个分）；\`k1 → ∞\` 时词频线性加分（退回朴素词频）。
- \`b\` 控制长度惩罚强度。\`b = 0\` 不惩罚长文档；\`b = 1\` 完全按长度比例惩罚。

所以 \`k1 = 1.2 / b = 0.75\` 不是定理，是「中间偏保守」的经验起点。把两个端点想清楚，参数就不是玄学，而是程度旋钮。我这一关的测试会专门验这两个端点。`
        }
      ],
      prereq: [
        {
          title: 'BM25 公式，逐项拆开',
          md: `对 query 里的每个词 t，先算一个分数，再把所有词加起来：

\`\`\`text
score(d, q) = Σ_t  idf(t) · (f(t,d) · (k1+1)) / (f(t,d) + k1 · (1 - b + b · |d|/avgdl))
idf(t) = ln(1 + (N - df(t) + 0.5) / (df(t) + 0.5))
\`\`\`

- \`f(t,d)\`：词 t 在文档 d 里出现几次（term frequency）
- \`df(t)\`：包含 t 的文档有几篇（document frequency）
- \`N\`：文档总数；\`|d|\`：文档长度；\`avgdl\`：平均文档长度

**idf 的分母里加 0.5、外层 ln(1 + x)** 这些细节不是重点；重点是趋势：df 越大 → idf 越小；f 越大 → 分数涨但会饱和；|d| 超过平均 → 被压一点。`
        },
        {
          title: '分词为什么先做「最笨的版本」',
          md: `真实中文检索要接分词器（jieba / 按字切 / BPE），但这一关先写最笨的规则：转小写、标点当分隔符、按空白切。

理由有两个：
1. **BM25 的正确性不依赖分词质量**，它只依赖「词是什么」这个输入。分词错了是另一类问题，不该混进这一关的红。
2. 把分词做成**可替换的一层**（\`tokenize\` 单独一个函数），以后接真分词器只改这一处，后面的统计和打分不动。

工程判断：先固定边界清楚的假输入，把核心算法验对；真实世界的模糊输入最后接。`
        }
      ],
      api: [
        {
          name: 'tokenize / termFreq',
          sig: 'tokenize(text: string): string[]  /  termFreq(tokens: string[]): Map<string, number>',
          args: 'text 任意字符串，可含中文、标点、大小写。tokens 是分词结果。',
          returns: 'tokenize 返回小写、去标点后的词数组（不含空串）。termFreq 返回「词 → 出现次数」的 Map。',
          example: `tokenize('Vue 的 响应式，Proxy！')
// ['vue', '的', '响应式', 'proxy']

termFreq(['a', 'b', 'a']).get('a')
// 2`
        },
        {
          name: 'buildIndex / idfOf',
          sig: 'buildIndex(docs: {id, text}[]): Index  /  idfOf(index, term: string): number',
          args: 'docs 是 { id: string, text: string } 数组。Index = { list, N, avgdl, df }。',
          returns: 'buildIndex 返回索引对象：list 里每项含 id / tokens / tf / length；df 是词 → 文档数。idfOf 返回该词的 idf（公式见左栏）。',
          example: `const docs = [
  { id: 'd1', text: 'vue reactivity proxy' },
  { id: 'd2', text: 'vue render scheduler' }
]
const index = buildIndex(docs)
index.df.get('vue')     // 2
idfOf(index, 'proxy')   // 比 idfOf(index, 'vue') 大`
        },
        {
          name: 'bm25Rank',
          sig: 'bm25Rank(index, query: string, opts?: { k1?, b?, k? }): { id, score }[]',
          args: 'index 来自 buildIndex。opts.k1 默认 1.2、b 默认 0.75、k 是 topK 截断（默认不截）。',
          returns: '按 score 降序的数组；同分按 id 字典序；score 为 0 的文档不返回（没命中就不该出现在召回里）。',
          example: `const index = buildIndex(docs)
bm25Rank(index, 'vue reactivity')
// [{ id: 'd1', score: 1.7... }, ...]

bm25Rank(index, 'vue', { k1: 0 })   // 词频不再加分
bm25Rank(index, 'vue', { b: 0 })    // 长度不再被惩罚`
        }
      ],
      stages: [
        {
          n: 1,
          title: '分词与词频：先把「词」定下来',
          think: '先做最底层、最容易验证的一层。分词规则一旦含糊（大小写、标点、空串），后面所有统计都跟着含糊，而且很难反推是哪一步错的。这一步只要求两件事：规则确定、结果可复现。',
          hint: '写一个 tokenize：转小写、把标点替换成空格、按空白切、过滤空串。再写 termFreq：遍历 tokens 用 Map 计数。中文不需要额外处理——\\p{L} 也会匹配汉字。',
          diag: [
            '大小写/标点没统一：先 toLowerCase，再把非字母数字空白的字符替换成空格，最后按空白切。',
            '空串没过滤：split 之后会留下空字符串，filter(Boolean) 去掉；空文本应返回 []。',
            'termFreq 是「词 → 次数」：初始化 0 再加一，别把 Map 写成普通对象。'
          ],
          vocab: [
            { term: 'Map 与对象存词频的区别', md: '对象只能存字符串键，原型链还可能撞名（constructor）；Map 允许任意键且没有污染，适合做词表。' }
          ],
          code: `/**
 * 第 1 关 · 第 1 步：分词与词频
 */
function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^\\p{L}\\p{N}\\s]+/gu, ' ')
    .split(/\\s+/)
    .filter(Boolean)
}

function termFreq(tokens) {
  const tf = new Map()
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
  return tf
}
`,
          test: L1S1
        },
        {
          n: 2,
          title: '倒排统计：df、idf、平均长度',
          think: '有了词频就能统计文档频率了。这一步的关键判断：df 数的是「包含该词的文档数」，不是词频总和——很多人在这一步写错，结果 idf 全歪，但打分看起来「还行」，错误被掩盖。所以我单独给 df 写一条测试。',
          hint: 'buildIndex 遍历 docs：对每篇先分词、算 tf 和 length；对每篇用 new Set(tokens) 去重后累加 df。avgdl 是所有 length 的平均值。idfOf 按公式算，公式见左栏。',
          diag: [
            'list 要有 id/tokens/tf/length 四样，N 是文档数：检查是不是漏了 length 或把 tokens 当成了 tf。',
            'df 要用去重后的词集合来累加：同一篇文档里出现 3 次，也只贡献 1。',
            'idf 公式写错最常见的是把 ln 写在分数外面或忘了 +1：先抄公式，再核对数值。',
            '不存在的词 df 是 0：用 ?? 0 兜底，别让 undefined 参与算术。'
          ],
          code: `/**
 * 第 1 关 · 第 2 步：倒排统计
 */
function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^\\p{L}\\p{N}\\s]+/gu, ' ')
    .split(/\\s+/)
    .filter(Boolean)
}

function termFreq(tokens) {
  const tf = new Map()
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
  return tf
}

function buildIndex(docs) {
  const list = (docs ?? []).map((d) => {
    const tokens = tokenize(d.text)
    return { id: String(d.id), tokens, tf: termFreq(tokens), length: tokens.length }
  })
  const N = list.length
  const df = new Map()
  for (const d of list) for (const t of new Set(d.tokens)) df.set(t, (df.get(t) ?? 0) + 1)
  const avgdl = N ? list.reduce((s, d) => s + d.length, 0) / N : 0
  return { list, N, avgdl, df }
}

function idfOf(index, term) {
  const N = index.N
  const df = index.df.get(term) ?? 0
  return Math.log(1 + (N - df + 0.5) / (df + 0.5))
}
`,
          test: L1S2
        },
        {
          n: 3,
          title: '合成打分：把三个修正乘起来',
          think: '现在把 idf、词频饱和、长度归一化合到一个公式里。这一步最容易犯的错是「写出来了，但参数没生效」——所以测试不只看排序，还专门验 k1=0 和 b=0 两个端点：如果参数被写死或被忽略，这两条会立刻红。',
          hint: '对每个 query 词（先去重）计算：idf × (tf·(k1+1)) / (tf + k1·(1-b + b·长度/平均长度))。只累加 tf>0 的项；最后过滤 score>0，按分数降序、同分按 id 字典序排，按 k 截断。',
          diag: [
            '分母里长度归一化写成了 |d|/avgdl 之外的形式：照抄公式，注意 avgdl 为 0 时要兜底。',
            'query 词没有去重：同一个词问了两遍会被算两次，分数翻倍。',
            '把 tf 当成了「是否出现」（0/1）：这一关要求真实词频，tf 至少要用到次数。',
            'k1=0 时词频不该再加分：分母里 k1 项是否真的乘进去了？写死 1.2 就会红。',
            'b=0 时长度不该惩罚：1 - b + b·(|d|/avgdl) 在 b=0 时必须恒等于 1。',
            '排序不稳定：同分必须按 id 字典序，不要依赖数组原来的顺序。',
            'score 为 0 的文档不该出现：召回里出现「没命中任何词」的文档，说明过滤条件漏了。'
          ],
          vocab: [
            { term: '词频饱和', md: 'BM25 里 tf 的收益是递减的：从 1 次到 2 次涨得多，从 9 次到 10 次几乎不涨。这样避免「堆关键词」操纵排名。' },
            { term: 'avgdl 的作用', md: '长度归一化的基准。文档比平均长，得分被压；比平均短，得分被抬。用 b 控制压多少。' }
          ],
          code: `/**
 * 第 1 关 · 第 3 步：BM25 打分
 */
function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^\\p{L}\\p{N}\\s]+/gu, ' ')
    .split(/\\s+/)
    .filter(Boolean)
}

function termFreq(tokens) {
  const tf = new Map()
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
  return tf
}

function buildIndex(docs) {
  const list = (docs ?? []).map((d) => {
    const tokens = tokenize(d.text)
    return { id: String(d.id), tokens, tf: termFreq(tokens), length: tokens.length }
  })
  const N = list.length
  const df = new Map()
  for (const d of list) for (const t of new Set(d.tokens)) df.set(t, (df.get(t) ?? 0) + 1)
  const avgdl = N ? list.reduce((s, d) => s + d.length, 0) / N : 0
  return { list, N, avgdl, df }
}

function idfOf(index, term) {
  const N = index.N
  const df = index.df.get(term) ?? 0
  return Math.log(1 + (N - df + 0.5) / (df + 0.5))
}

function bm25Rank(index, query, opts = {}) {
  const k1 = opts.k1 ?? 1.2
  const b = opts.b ?? 0.75
  const topK = Number.isFinite(opts.k) ? Math.max(0, opts.k) : Infinity
  const qTerms = [...new Set(tokenize(query))]
  const rows = []

  for (const d of index.list) {
    let score = 0
    for (const t of qTerms) {
      const tf = d.tf.get(t) ?? 0
      if (tf <= 0) continue
      const idf = idfOf(index, t)
      const lenFactor = 1 - b + b * (d.length / (index.avgdl || 1))
      score += (idf * (tf * (k1 + 1))) / (tf + k1 * lenFactor)
    }
    if (score > 0) rows.push({ id: d.id, score })
  }

  rows.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id))
  return rows.slice(0, topK)
}
`,
          test: L1S3
        }
      ],
      finalCode: `/**
 * 第 1 关 · BM25：分词 → 倒排统计 → 打分
 */
function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^\\p{L}\\p{N}\\s]+/gu, ' ')
    .split(/\\s+/)
    .filter(Boolean)
}

function termFreq(tokens) {
  const tf = new Map()
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
  return tf
}

function buildIndex(docs) {
  const list = (docs ?? []).map((d) => {
    const tokens = tokenize(d.text)
    return { id: String(d.id), tokens, tf: termFreq(tokens), length: tokens.length }
  })
  const N = list.length
  const df = new Map()
  for (const d of list) for (const t of new Set(d.tokens)) df.set(t, (df.get(t) ?? 0) + 1)
  const avgdl = N ? list.reduce((s, d) => s + d.length, 0) / N : 0
  return { list, N, avgdl, df }
}

function idfOf(index, term) {
  const N = index.N
  const df = index.df.get(term) ?? 0
  return Math.log(1 + (N - df + 0.5) / (df + 0.5))
}

function bm25Rank(index, query, opts = {}) {
  const k1 = opts.k1 ?? 1.2
  const b = opts.b ?? 0.75
  const topK = Number.isFinite(opts.k) ? Math.max(0, opts.k) : Infinity
  const qTerms = [...new Set(tokenize(query))]
  const rows = []

  for (const d of index.list) {
    let score = 0
    for (const t of qTerms) {
      const tf = d.tf.get(t) ?? 0
      if (tf <= 0) continue
      const idf = idfOf(index, t)
      const lenFactor = 1 - b + b * (d.length / (index.avgdl || 1))
      score += (idf * (tf * (k1 + 1))) / (tf + k1 * lenFactor)
    }
    if (score > 0) rows.push({ id: d.id, score })
  }

  rows.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id))
  return rows.slice(0, topK)
}
`,
      usage: `const docs = [
  { id: 'd1', text: 'Vue3 的响应式基于 Proxy 拦截读写' },
  { id: 'd2', text: 'Redis 的淘汰策略有 LRU 和 LFU' },
  { id: 'd3', text: 'Proxy 可以拦截 get 和 set' }
]
const index = buildIndex(docs)

// 关键词召回：第一次检索（top3）
bm25Rank(index, 'Proxy 拦截', { k: 3 })
// [{ id: 'd3', score: ... }, { id: 'd1', score: ... }]

// 调参：关掉长度惩罚，长文档不再吃亏（通常用于「长文档更权威」的场景）
bm25Rank(index, 'Proxy', { b: 0 })`,
      hints: [
        '先把公式抄在注释里，再对着公式逐个变量填：idf、tf、长度项各占哪一格。',
        '每一步的测试都可以单独跑：第 2 步的 buildIndex 没写对之前，不要去调第 3 步的公式。',
        '同分排序用 id.localeCompare 是最省事的稳定排序；不要依赖 sort 的稳定性（V8 稳定但不是所有环境都保证）。'
      ],
      concepts: [
        {
          title: 'BM25 和 TF-IDF 的区别，一句话',
          md: 'TF-IDF 里词频是线性加分；BM25 给词频加了饱和，又给长度加了可调惩罚。所以 BM25 对「长文档占便宜」和「堆词」都更稳，这也是它成为检索默认值的原因。'
        }
      ],
      skeleton: `/**
 * 第 1 关 · BM25：把这些函数补完
 *
 * 步骤：
 *   1) tokenize / termFreq
 *   2) buildIndex / idfOf
 *   3) bm25Rank（含 k1 / b 参数）
 */
function tokenize(text) {
  // TODO：小写、标点当分隔符、过滤空串
  return []
}

function termFreq(tokens) {
  // TODO：词 → 次数
  return new Map()
}

function buildIndex(docs) {
  // TODO：list / N / avgdl / df
  return { list: [], N: 0, avgdl: 0, df: new Map() }
}

function idfOf(index, term) {
  // TODO：idf 公式
  return 0
}

function bm25Rank(index, query, opts = {}) {
  // TODO：三项修正相乘，排序 + 过滤 + 截断
  return []
}
`,
      solution: `/**
 * 第 1 关 · BM25：分词 → 倒排统计 → 打分
 */
function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^\\p{L}\\p{N}\\s]+/gu, ' ')
    .split(/\\s+/)
    .filter(Boolean)
}

function termFreq(tokens) {
  const tf = new Map()
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
  return tf
}

function buildIndex(docs) {
  const list = (docs ?? []).map((d) => {
    const tokens = tokenize(d.text)
    return { id: String(d.id), tokens, tf: termFreq(tokens), length: tokens.length }
  })
  const N = list.length
  const df = new Map()
  for (const d of list) for (const t of new Set(d.tokens)) df.set(t, (df.get(t) ?? 0) + 1)
  const avgdl = N ? list.reduce((s, d) => s + d.length, 0) / N : 0
  return { list, N, avgdl, df }
}

function idfOf(index, term) {
  const N = index.N
  const df = index.df.get(term) ?? 0
  return Math.log(1 + (N - df + 0.5) / (df + 0.5))
}

function bm25Rank(index, query, opts = {}) {
  const k1 = opts.k1 ?? 1.2
  const b = opts.b ?? 0.75
  const topK = Number.isFinite(opts.k) ? Math.max(0, opts.k) : Infinity
  const qTerms = [...new Set(tokenize(query))]
  const rows = []

  for (const d of index.list) {
    let score = 0
    for (const t of qTerms) {
      const tf = d.tf.get(t) ?? 0
      if (tf <= 0) continue
      const idf = idfOf(index, t)
      const lenFactor = 1 - b + b * (d.length / (index.avgdl || 1))
      score += (idf * (tf * (k1 + 1))) / (tf + k1 * lenFactor)
    }
    if (score > 0) rows.push({ id: d.id, score })
  }

  rows.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id))
  return rows.slice(0, topK)
}
`,
      tests: [L1S1, L1S2, L1S3].join('\n\n')
    },
    /* ---------------------------------------------------------- 第 2 关 */
    {
      id: 'lv2',
      title: '向量检索：相似度不是距离',
      emoji: '🧭',
      xp: 40,
      goal: '实现余弦相似度、topK 召回与向量归一化，并让检索在维度不一致时明确报错。',
      why: '关键词路有一个解决不了的盲区：用户说「响应式」，文档写「Proxy 拦截」——字面上一个词都不重合，但语义是同一件事。向量检索就是为这个盲区存在的。这一关不训练 embedding（那需要模型），只把「拿到向量之后怎么算相似、怎么排序」写对。',
      nodes: ['ai.rag.retrieval-pipeline.hybrid-retrieval', 'ai.rag.retrieval-pipeline.rerank-compress'],
      thinking: [
        {
          title: '为什么用余弦，而不是欧氏距离',
          md: `文本向量的绝对长度通常代表「信息量/置信度」，而不是相关性。两篇讲同一主题的文档，一篇短一篇长，向量可能长度差很多，但方向一致。

余弦只看夹角，天然忽略长度；欧氏距离会被长度带偏。这正是余弦成为文本相似度默认值的原因。我在这一步只用两行推导说服自己：余弦 = 点积 / (|a||b|)，把任意向量缩放，分子分母同倍缩放，结果不变。`
        },
        {
          title: '先钉死「一个分数」，再谈排序',
          md: `排序是相似度的消费者。如果 cosine 本身算错，topK 排出来看起来「有顺序」，但顺序是错的——这种错误特别难发现，因为界面永远有结果。

所以第 1 步只写 cosine，用手算得出的三组向量验它（同向 = 1、正交 = 0、缩放不变）；第 2 步才写排序。测试的红色因此永远指向真正坏的那一层。`
        },
        {
          title: '零向量为什么返回 0 而不是 NaN',
          md: `cosine 的分母是 |a|·|b|。任意一边是零向量，分母就是 0，直接算会得到 NaN。而 NaN 会悄悄毒化整个排序（任何比较都 false），最后表现成「排序随机」。

工程上正确的做法是先判分母：为 0 就返回 0，含义是「没有方向，和谁都不相似」。这条边界必须显式处理，不能靠调用方保证输入非零。`
        }
      ],
      prereq: [
        {
          title: '余弦相似度：只看夹角的相似',
          md: `\`\`\`text
cos(a, b) = (a · b) / (|a| · |b|)
a · b = a1b1 + a2b2 + ... + anbn
|a|   = sqrt(a1² + a2² + ... + an²)
\`\`\`

取值范围 [-1, 1]：1 是方向完全相同，0 是正交（无关），-1 是完全相反。

两个必须记住的性质：
1. **缩放不变**：cos(a, b) = cos(2a, 3b)。向量长度不影响结果。
2. **维度必须一致**：不同维度的向量没有定义，必须显式报错，而不是「算出来一个数」。`
        },
        {
          title: '归一化：把向量先除成长度 1',
          md: `归一化就是 v / |v|。好处是之后算相似度只需要点积（分母都是 1），省一半开方；代价是零向量归一化会除零，要单独处理。

归一化前后余弦相似度不变——这条性质可以用来验证你的归一化没写错：\`cos(normalize(a), normalize(b)) === cos(a, b)\`。这一关的测试就是这么验的。`
        }
      ],
      api: [
        {
          name: 'cosine / normalize',
          sig: 'cosine(a: number[], b: number[]): number  /  normalize(v: number[]): number[]',
          args: 'a、b 是等长数值数组（维度不一致要抛错）。v 任意数值数组。',
          returns: 'cosine 返回 [-1, 1] 的相似度；任一侧为零向量时返回 0。normalize 返回长度 1 的向量；零向量返回全 0（不产生 NaN）。',
          example: `cosine([1, 0], [1, 0])    // 1
cosine([1, 0], [0, 1])    // 0
cosine([1, 0], [-1, 0])   // -1
cosine([0, 0], [1, 1])    // 0

normalize([3, 4])         // [0.6, 0.8]`
        },
        {
          name: 'topKVector / searchVectors',
          sig: 'topKVector(store, query, k?): {id, score}[]  /  searchVectors(store, query, k?): {id, score}[]',
          args: 'store 是 { id, vector } 数组；query 是查询向量；k 是截断（默认全部）。',
          returns: '按 score 降序的数组，同分按 id 字典序；k 超过长度时返回全部。searchVectors 额外校验维度，向量缺失/维度不符时抛错。',
          example: `const store = [
  { id: 'd1', vector: [1, 0] },
  { id: 'd2', vector: [0, 1] }
]
topKVector(store, [1, 0])        // d1 在前
topKVector(store, [1, 0], 1)     // 只要第一名
searchVectors(store, [1, 0])     // 与 topK 相同，但先校验维度`
        }
      ],
      stages: [
        {
          n: 1,
          title: '余弦相似度：先把它算对',
          think: '先只做「两个向量有多像」这一件事。这里我想验证三个性质：同向为 1、正交为 0、缩放不变。如果这三条同时成立，公式基本不会错；而维度不一致必须抛错——静默算出一个数比报错危险得多。',
          hint: '累加点积和两个平方和，最后 dot / (sqrt(na) * sqrt(nb))。分母为 0 时返回 0。开头先校验两数组等长，不等长直接 throw。',
          diag: [
            '同向为 1：检查是不是忘了开方，或者把点积直接当成了相似度。',
            '正交为 0：点积应该恰好为 0，检查是否把「不相关」写成了 1 - 相似度之类的转换。',
            '缩放不变：说明你用了长度参与打分；余弦公式里长度只在分母，缩放会抵消。',
            '零向量：分母为 0 时返回 0，别让 NaN 流出去。',
            '维度不一致：必须先判断 a.length !== b.length 并 throw，不能继续算。'
          ],
          code: `/**
 * 第 2 关 · 第 1 步：余弦相似度
 */
function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) throw new Error('cosine 需要两个数组')
  if (a.length !== b.length) throw new Error('维度不一致：' + a.length + ' vs ' + b.length)

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
`,
          test: L2S1
        },
        {
          n: 2,
          title: 'topK：把分数排成可复现的榜单',
          think: '排序本身不难，难的是「可复现」：同分时如果依赖数组插入顺序，换一批数据的顺序就变了，线上排查会怀疑人生。所以这一步的验收里有「同分按 id 字典序」这条。',
          hint: '遍历 store 给每个文档算 cosine，收集 { id, score }；按分数降序、同分 id 升序；slice(0, k)，k 非有限值时返回全部。',
          diag: [
            '排序方向反了：降序用 y.score - x.score。',
            '同分没处理：加一个 x.id.localeCompare(y.id) 作为第二排序键。',
            'k 的边界：k 超过长度应返回全部；空 store 应返回空数组而不是抛错。'
          ],
          code: `/**
 * 第 2 关 · 第 2 步：余弦相似度 + topK
 */
function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) throw new Error('cosine 需要两个数组')
  if (a.length !== b.length) throw new Error('维度不一致：' + a.length + ' vs ' + b.length)
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

function topKVector(store, query, k) {
  const rows = []
  for (const item of store ?? []) {
    if (!item || !Array.isArray(item.vector)) continue
    rows.push({ id: String(item.id), score: cosine(item.vector, query) })
  }
  rows.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id))
  if (!Number.isFinite(k)) return rows
  return rows.slice(0, Math.max(0, k))
}
`,
          test: L2S2
        },
        {
          n: 3,
          title: '归一化与检索前的维度校验',
          think: '归一化不是为了好看，是省算力：批量检索时先统一成单位向量，之后只算点积。但要小心两件事：零向量归一化别除出 NaN；检索入口要先校验维度，别让一条脏数据把整批结果变成 NaN。',
          hint: 'normalize 先算长度，长度为 0 返回副本；否则每个分量除以长度。searchVectors 在调用 topKVector 之前遍历 store，检查每个 vector 是否是数组、维度是否等于 query。',
          diag: [
            '归一化后长度必须是 1：检查是否漏了开方，或除的是平方和。',
            '零向量归一化要返回全 0：长度 0 时直接返回 v.slice()，不要做除法。',
            '归一化前后余弦不变：如果你的 cosine 实现里长度没抵消，这条会红——先修 cosine。',
            '维度校验要对每条文档做：有一条维度不对就 throw，不要等到算 NaN。',
            'searchVectors 与 topKVector 的排序必须一致：别在 searchVectors 里重新写一遍排序。'
          ],
          vocab: [
            { term: '单位向量', md: '长度为 1 的向量。两个单位向量的余弦相似度就等于点积，这是向量数据库内部最常见的优化。' }
          ],
          code: `/**
 * 第 2 关 · 第 3 步：归一化 + 带校验的检索入口
 */
function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) throw new Error('cosine 需要两个数组')
  if (a.length !== b.length) throw new Error('维度不一致：' + a.length + ' vs ' + b.length)
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

function topKVector(store, query, k) {
  const rows = []
  for (const item of store ?? []) {
    if (!item || !Array.isArray(item.vector)) continue
    rows.push({ id: String(item.id), score: cosine(item.vector, query) })
  }
  rows.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id))
  if (!Number.isFinite(k)) return rows
  return rows.slice(0, Math.max(0, k))
}

function normalize(v) {
  const norm = Math.sqrt((v ?? []).reduce((s, x) => s + x * x, 0))
  if (norm === 0) return (v ?? []).slice()
  return v.map((x) => x / norm)
}

function searchVectors(store, query, k) {
  if (!Array.isArray(query) || query.length === 0) throw new Error('query 向量不能为空')
  for (const item of store ?? []) {
    if (!item || !Array.isArray(item.vector)) throw new Error('文档 ' + (item?.id ?? '?') + ' 缺少向量')
    if (item.vector.length !== query.length) throw new Error('文档 ' + item.id + ' 的向量维度与 query 不一致')
  }
  return topKVector(store, query, k)
}
`,
          test: L2S3
        }
      ],
      finalCode: `/**
 * 第 2 关 · 向量检索：余弦 + topK + 归一化
 *
 * 这一关的文件包含第 1 关的 BM25 实现（检索器是同一个进程里的一套代码）。
 */
function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^\\p{L}\\p{N}\\s]+/gu, ' ')
    .split(/\\s+/)
    .filter(Boolean)
}

function termFreq(tokens) {
  const tf = new Map()
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
  return tf
}

function buildIndex(docs) {
  const list = (docs ?? []).map((d) => {
    const tokens = tokenize(d.text)
    return { id: String(d.id), tokens, tf: termFreq(tokens), length: tokens.length }
  })
  const N = list.length
  const df = new Map()
  for (const d of list) for (const t of new Set(d.tokens)) df.set(t, (df.get(t) ?? 0) + 1)
  const avgdl = N ? list.reduce((s, d) => s + d.length, 0) / N : 0
  return { list, N, avgdl, df }
}

function idfOf(index, term) {
  const N = index.N
  const df = index.df.get(term) ?? 0
  return Math.log(1 + (N - df + 0.5) / (df + 0.5))
}

function bm25Rank(index, query, opts = {}) {
  const k1 = opts.k1 ?? 1.2
  const b = opts.b ?? 0.75
  const topK = Number.isFinite(opts.k) ? Math.max(0, opts.k) : Infinity
  const qTerms = [...new Set(tokenize(query))]
  const rows = []
  for (const d of index.list) {
    let score = 0
    for (const t of qTerms) {
      const tf = d.tf.get(t) ?? 0
      if (tf <= 0) continue
      const idf = idfOf(index, t)
      const lenFactor = 1 - b + b * (d.length / (index.avgdl || 1))
      score += (idf * (tf * (k1 + 1))) / (tf + k1 * lenFactor)
    }
    if (score > 0) rows.push({ id: d.id, score })
  }
  rows.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id))
  return rows.slice(0, topK)
}

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) throw new Error('cosine 需要两个数组')
  if (a.length !== b.length) throw new Error('维度不一致：' + a.length + ' vs ' + b.length)
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

function normalize(v) {
  const norm = Math.sqrt((v ?? []).reduce((s, x) => s + x * x, 0))
  if (norm === 0) return (v ?? []).slice()
  return v.map((x) => x / norm)
}

function topKVector(store, query, k) {
  const rows = []
  for (const item of store ?? []) {
    if (!item || !Array.isArray(item.vector)) continue
    rows.push({ id: String(item.id), score: cosine(item.vector, query) })
  }
  rows.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id))
  if (!Number.isFinite(k)) return rows
  return rows.slice(0, Math.max(0, k))
}

function searchVectors(store, query, k) {
  if (!Array.isArray(query) || query.length === 0) throw new Error('query 向量不能为空')
  for (const item of store ?? []) {
    if (!item || !Array.isArray(item.vector)) throw new Error('文档 ' + (item?.id ?? '?') + ' 缺少向量')
    if (item.vector.length !== query.length) throw new Error('文档 ' + item.id + ' 的向量维度与 query 不一致')
  }
  return topKVector(store, query, k)
}
`,
      usage: `// 假设 embedding 模型已经给出向量（这一关不训练模型）
const store = [
  { id: 'd1', vector: [0.8, 0.1, 0.0] },
  { id: 'd2', vector: [0.0, 1.0, 0.2] },
  { id: 'd3', vector: [0.7, 0.2, 0.1] }
]
const queryVec = [1, 0, 0]

searchVectors(store, queryVec)        // d1 最相似，d3 次之
searchVectors(store, queryVec, 1)     // 只取一个召回

// 批量场景：先归一化，之后点积即余弦
const unit = store.map((x) => ({ id: x.id, vector: normalize(x.vector) }))`,
      hints: [
        '余弦的推导记住一句话：缩放向量，分子分母同倍缩放，结果不变。所以长度不该影响相似度。',
        '排序的「稳定」不是指 sort 稳定，而是指你对同分给了确定的排序键（这里用 id）。',
        '归一化只在「批量算相似度」时有性能意义；单个查询直接算余弦也可以。'
      ],
      concepts: [
        {
          title: '为什么向量检索不能替代关键词检索',
          md: '向量擅长语义相近，但对「型号、编号、专有名词」常常不准——因为 embedding 会把这些稀有 token 压成泛化语义。关键词检索恰好相反。两条路的盲区不重合，这是混合检索存在的根本原因，第 3 关会用测试把它变成事实。'
        }
      ],
      skeleton: `/**
 * 第 2 关 · 向量检索：补完 cosine / topKVector / normalize / searchVectors
 *
 * 第 1 关的 BM25 实现已经在这里了，不用重写。
 */
function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^\\p{L}\\p{N}\\s]+/gu, ' ')
    .split(/\\s+/)
    .filter(Boolean)
}

function bm25Rank(index, query, opts = {}) {
  // 第 1 关已经写好，这里省略细节（骨架里先给空实现，别在本关改它）
  return []
}

function cosine(a, b) {
  // TODO：点积 / (两个长度相乘)；零向量返回 0；维度不一致抛错
  return 0
}

function topKVector(store, query, k) {
  // TODO：每个文档算 cosine，按分数降序、同分 id 升序，按 k 截断
  return []
}

function normalize(v) {
  // TODO：长度 1；零向量返回全 0
  return []
}

function searchVectors(store, query, k) {
  // TODO：先校验 query 与每个文档向量的维度，再交给 topKVector
  return []
}
`,
      solution: `/**
 * 第 2 关 · 向量检索：余弦 + topK + 归一化（完整实现）
 */
function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^\\p{L}\\p{N}\\s]+/gu, ' ')
    .split(/\\s+/)
    .filter(Boolean)
}

function termFreq(tokens) {
  const tf = new Map()
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
  return tf
}

function buildIndex(docs) {
  const list = (docs ?? []).map((d) => {
    const tokens = tokenize(d.text)
    return { id: String(d.id), tokens, tf: termFreq(tokens), length: tokens.length }
  })
  const N = list.length
  const df = new Map()
  for (const d of list) for (const t of new Set(d.tokens)) df.set(t, (df.get(t) ?? 0) + 1)
  const avgdl = N ? list.reduce((s, d) => s + d.length, 0) / N : 0
  return { list, N, avgdl, df }
}

function idfOf(index, term) {
  const N = index.N
  const df = index.df.get(term) ?? 0
  return Math.log(1 + (N - df + 0.5) / (df + 0.5))
}

function bm25Rank(index, query, opts = {}) {
  const k1 = opts.k1 ?? 1.2
  const b = opts.b ?? 0.75
  const topK = Number.isFinite(opts.k) ? Math.max(0, opts.k) : Infinity
  const qTerms = [...new Set(tokenize(query))]
  const rows = []
  for (const d of index.list) {
    let score = 0
    for (const t of qTerms) {
      const tf = d.tf.get(t) ?? 0
      if (tf <= 0) continue
      const idf = idfOf(index, t)
      const lenFactor = 1 - b + b * (d.length / (index.avgdl || 1))
      score += (idf * (tf * (k1 + 1))) / (tf + k1 * lenFactor)
    }
    if (score > 0) rows.push({ id: d.id, score })
  }
  rows.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id))
  return rows.slice(0, topK)
}

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) throw new Error('cosine 需要两个数组')
  if (a.length !== b.length) throw new Error('维度不一致：' + a.length + ' vs ' + b.length)
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

function normalize(v) {
  const norm = Math.sqrt((v ?? []).reduce((s, x) => s + x * x, 0))
  if (norm === 0) return (v ?? []).slice()
  return v.map((x) => x / norm)
}

function topKVector(store, query, k) {
  const rows = []
  for (const item of store ?? []) {
    if (!item || !Array.isArray(item.vector)) continue
    rows.push({ id: String(item.id), score: cosine(item.vector, query) })
  }
  rows.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id))
  if (!Number.isFinite(k)) return rows
  return rows.slice(0, Math.max(0, k))
}

function searchVectors(store, query, k) {
  if (!Array.isArray(query) || query.length === 0) throw new Error('query 向量不能为空')
  for (const item of store ?? []) {
    if (!item || !Array.isArray(item.vector)) throw new Error('文档 ' + (item?.id ?? '?') + ' 缺少向量')
    if (item.vector.length !== query.length) throw new Error('文档 ' + item.id + ' 的向量维度与 query 不一致')
  }
  return topKVector(store, query, k)
}
`,
      tests: [L2S1, L2S2, L2S3].join('\n\n')
    },
    /* ---------------------------------------------------------- 第 3 关 */
    {
      id: 'lv3',
      title: 'RRF：把两条榜单合成一条',
      emoji: '🧬',
      xp: 50,
      goal: '实现 RRF 名次融合，写出 hybridSearch 入口，并用一组语料证明融合结果补上了两路各自的盲区。',
      why: '两路各自都有盲区，但它们错的地方不一样。难点不在「都跑一遍」，而在「怎么合成」：BM25 的分数没有上界，余弦在 [-1, 1]，直接相加等于让 BM25 说了算。RRF 用名次绕开量纲问题——这也是工业界混合检索最常用的默认做法。',
      nodes: ['ai.rag.retrieval-pipeline.hybrid-retrieval', 'ai.rag.retrieval-pipeline.rerank-compress'],
      thinking: [
        {
          title: '为什么不能把两路分数直接相加',
          md: `我一开始的反应是「加权平均」，但一算就发现不对：BM25 的分数取决于 idf 和词频，值域可能是 20 也可能是 0.3；余弦固定落在 [-1, 1]。两路分数根本不在同一个坐标系。

归一化可以强行拉到 [0, 1]，但每批查询的分布都不同，归一化参数不稳定；而且高分文档会压掉另一路的所有信息。所以真正要的是一种「只看名次、不看绝对分数」的融合——这就是 RRF。`
        },
        {
          title: 'RRF 的公式为什么是 1/(k+rank)',
          md: `RRF 给每个文档的分数是各路上 1/(k + rank) 的和（rank 从 1 开始，k 常取 60）。

两个直觉：
- 名次越靠前，1/(k+rank) 越大；但 k 的存在把差距压平了——第 1 名和第 2 名的差距只有 (1/61 - 1/62)，很小。这样单路的「绝对第一」不会碾压另一路的共识。
- 一个文档在两路都排前，它的和会翻倍——这正是「共识」的价值。

k 越小，名次差距被放大得越厉害（k=0 时是 1/rank，纯名次）。所以 k 是「信任单路程度」的旋钮。`
        },
        {
          title: '为什么这一步必须用「两路各有胜负」的语料来验',
          md: `如果语料里 BM25 和向量给出同样的排序，融合写得再对也看不出价值——测了等于没测。

所以第 3 关的测试语料是特意构造的：d4 只有语义相似（关键词一个都不重合），d5 只有关键词重合（向量几乎不相似）。断言写成「BM25 单独 top3 里没有 d4」「向量单独 top3 里没有 d5」「融合后两个都在」——这才证明融合真的在补盲区，而不是摆设。`
        }
      ],
      prereq: [
        {
          title: 'RRF 公式与两个参数',
          md: `\`\`\`text
RRF(d) = Σ_{每一路} 1 / (k + rank_route(d))
\`\`\`

- \`rank\` 从 1 开始（第 1 名 rank=1），不是从 0。
- \`k\` 常用 60：越大越「民主」，越小越强调单路头部。
- 某一路没召回该文档时，这一路不加分（不存在 rank，项为 0）。

输出再按分数降序、同分按 id 字典序，截断 topN。`
        },
        {
          title: '混合检索的最小架构',
          md: `\`\`\`text
query ─┬─> BM25 召回 topM ─┐
       └─> 向量召回 topM ─┴─> RRF 融合 ─> topN
\`\`\`

注意两路都召回 **topM**（M 通常大于最终 N），因为融合需要候选池；只取 topN 会让另一路的第 N+1 名永远进不来。

可选：把融合结果再交给 rerank 模型精排。这一关不做 rerank——先把「召回融合」写对，那是更底层的一步。`
        }
      ],
      api: [
        {
          name: 'rrfScores / fuseResults',
          sig: 'rrfScores(lists: string[][], k = 60): Map<string, number>  /  fuseResults(lists, opts?: {k?, topN?}): {id, score}[]',
          args: 'lists 是若干条「已排名」的 id 数组（第 0 个是第 1 名）。k 默认 60；topN 默认 10。',
          returns: 'rrfScores 返回 id → 融合分。fuseResults 返回降序数组，同分 id 升序，自动去重并截断。',
          example: `rrfScores([['a', 'b']])
// Map { 'a' => 1/61, 'b' => 1/62 }

fuseResults([['a', 'b'], ['b', 'c']], { topN: 2 })
// [{ id: 'b', score: 1/62 + 1/61 }, { id: 'a', score: 1/61 }]`
        },
        {
          name: 'hybridSearch',
          sig: 'hybridSearch(corpus, query, opts?): {id, score}[]',
          args: 'corpus = { docs: {id, text}[], vectors?: {id, vector}[] }。opts: { queryVector?, k1?, b?, rrfK?, topN?, perRoute? }。',
          returns: '融合后的榜单（降序、去重、截断）。queryVector 缺省时只走 BM25 一路。',
          example: `const corpus = { docs, vectors }
hybridSearch(corpus, 'vue reactivity', { queryVector: [1, 0], topN: 4 })
// d1 第一；d4（只有语义命中）与 d5（只有关键词命中）都被补进来

hybridSearch(corpus, 'vue reactivity', { topN: 4 })   // 只有 BM25 路`
        }
      ],
      stages: [
        {
          n: 1,
          title: 'RRF 分数：只用名次，不用原始分',
          think: '先单独实现「名次 → 分数」这一层。它足够小，可以精确验证：第 1 名 = 1/(k+1)，两路同名次相加，k=0 时退回 1/rank。把这一层钉死，融合和入口才有可靠地基。',
          hint: '遍历 lists，对内层数组用下标 i 当名次，rank = i + 1；把 1/(k+rank) 累加到 Map。注意 id 要统一转成字符串。',
          diag: [
            '名次从 0 开始还是 1：公式里是 k + rank，rank 必须从 1 起；用下标当名次就偏了一位。',
            '两路分数没相加：Map 里要先 get 再累加，不是 set 覆盖。',
            'k 的默认值：不传时是 60，不是 0。',
            '空输入要返回空 Map，不能抛错。'
          ],
          vocab: [
            { term: 'RRF（Reciprocal Rank Fusion）', md: '按名次的倒数做融合，最早由 Cormack 等人在 2009 年提出。它不需要训练、不需要调权重，因此在多路召回里非常常见。' }
          ],
          code: `/**
 * 第 3 关 · 第 1 步：RRF 分数
 */
function rrfScores(lists, k = 60) {
  const score = new Map()
  for (const list of lists ?? []) {
    ;(list ?? []).forEach((id, i) => {
      const key = String(id)
      score.set(key, (score.get(key) ?? 0) + 1 / (k + i + 1))
    })
  }
  return score
}
`,
          test: L3S1
        },
        {
          n: 2,
          title: '融合榜单：去重、排序、截断',
          think: 'RRF 的分数表已经是一份「去重后的合并」，接下来只差把它变成有序榜单。这里有三个容易被忽略的行为：同一文档在两路都出现只能出现一次（分数相加而不是两条记录）、同分要可复现、topN 要在排序之后截断。',
          hint: '先 rrfScores 拿到 Map，再展开成数组，按分数降序 + id 升序排，最后 slice(0, topN)。不要先截断再排序。',
          diag: [
            '同一个 id 出现两次：说明你没有从 Map 展开，而是把两路数组直接拼了。',
            'topN 截断位置错：必须先排序再截断。',
            '同分顺序不稳定：加 id 升序作为第二排序键。'
          ],
          code: `/**
 * 第 3 关 · 第 2 步：融合榜单
 */
function rrfScores(lists, k = 60) {
  const score = new Map()
  for (const list of lists ?? []) {
    ;(list ?? []).forEach((id, i) => {
      const key = String(id)
      score.set(key, (score.get(key) ?? 0) + 1 / (k + i + 1))
    })
  }
  return score
}

function fuseResults(lists, opts = {}) {
  const k = opts.k ?? 60
  const topN = opts.topN ?? 10
  const score = rrfScores(lists, k)
  const rows = [...score.entries()].map(([id, s]) => ({ id, score: s }))
  rows.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id))
  return rows.slice(0, Math.max(0, topN))
}
`,
          test: L3S2
        },
        {
          n: 3,
          title: 'hybridSearch：两路召回 + 融合入口',
          think: '最后把它们装成一条流水线。这里有一个设计判断：两路召回都要取比最终 topN 更大的候选集（perRoute），否则另一路的第 N+1 名根本没机会进入融合。这是「召回」和「排序」分离的典型体现。',
          hint: 'buildIndex(docs) 后跑 bm25Rank 拿 id 列表；有 queryVector 时跑 searchVectors 拿 id 列表；把两路 id 列表交给 fuseResults。perRoute 默认取 max(topN*2, 10)。没有 queryVector 就只融合 BM25 一路。',
          diag: [
            '融合后只剩 BM25 的结果：queryVector 分支没接上，或者向量列表传了空。',
            '两路候选集都只取了 topN：perRoute 太小，融合池不够，d4/d5 这类「单路靠后」的文档会进不来。',
            'docs 没有先 buildIndex：bm25Rank 需要索引对象，不是原始 docs。',
            'topN 没生效：检查 opts.topN 有没有一路传到 fuseResults。',
            '分数降序被破坏：不要在 fuseResults 之后再按别的东西重排。'
          ],
          code: `/**
 * 第 3 关 · 第 3 步：混合检索入口
 */
function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^\\p{L}\\p{N}\\s]+/gu, ' ')
    .split(/\\s+/)
    .filter(Boolean)
}

function termFreq(tokens) {
  const tf = new Map()
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
  return tf
}

function buildIndex(docs) {
  const list = (docs ?? []).map((d) => {
    const tokens = tokenize(d.text)
    return { id: String(d.id), tokens, tf: termFreq(tokens), length: tokens.length }
  })
  const N = list.length
  const df = new Map()
  for (const d of list) for (const t of new Set(d.tokens)) df.set(t, (df.get(t) ?? 0) + 1)
  const avgdl = N ? list.reduce((s, d) => s + d.length, 0) / N : 0
  return { list, N, avgdl, df }
}

function idfOf(index, term) {
  const N = index.N
  const df = index.df.get(term) ?? 0
  return Math.log(1 + (N - df + 0.5) / (df + 0.5))
}

function bm25Rank(index, query, opts = {}) {
  const k1 = opts.k1 ?? 1.2
  const b = opts.b ?? 0.75
  const topK = Number.isFinite(opts.k) ? Math.max(0, opts.k) : Infinity
  const qTerms = [...new Set(tokenize(query))]
  const rows = []
  for (const d of index.list) {
    let score = 0
    for (const t of qTerms) {
      const tf = d.tf.get(t) ?? 0
      if (tf <= 0) continue
      const idf = idfOf(index, t)
      const lenFactor = 1 - b + b * (d.length / (index.avgdl || 1))
      score += (idf * (tf * (k1 + 1))) / (tf + k1 * lenFactor)
    }
    if (score > 0) rows.push({ id: d.id, score })
  }
  rows.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id))
  return rows.slice(0, topK)
}

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) throw new Error('cosine 需要两个数组')
  if (a.length !== b.length) throw new Error('维度不一致：' + a.length + ' vs ' + b.length)
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

function topKVector(store, query, k) {
  const rows = []
  for (const item of store ?? []) {
    if (!item || !Array.isArray(item.vector)) continue
    rows.push({ id: String(item.id), score: cosine(item.vector, query) })
  }
  rows.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id))
  if (!Number.isFinite(k)) return rows
  return rows.slice(0, Math.max(0, k))
}

function searchVectors(store, query, k) {
  if (!Array.isArray(query) || query.length === 0) throw new Error('query 向量不能为空')
  for (const item of store ?? []) {
    if (!item || !Array.isArray(item.vector)) throw new Error('文档 ' + (item?.id ?? '?') + ' 缺少向量')
    if (item.vector.length !== query.length) throw new Error('文档 ' + item.id + ' 的向量维度与 query 不一致')
  }
  return topKVector(store, query, k)
}

function rrfScores(lists, k = 60) {
  const score = new Map()
  for (const list of lists ?? []) {
    ;(list ?? []).forEach((id, i) => {
      const key = String(id)
      score.set(key, (score.get(key) ?? 0) + 1 / (k + i + 1))
    })
  }
  return score
}

function fuseResults(lists, opts = {}) {
  const k = opts.k ?? 60
  const topN = opts.topN ?? 10
  const score = rrfScores(lists, k)
  const rows = [...score.entries()].map(([id, s]) => ({ id, score: s }))
  rows.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id))
  return rows.slice(0, Math.max(0, topN))
}

function hybridSearch(corpus, query, opts = {}) {
  const docs = corpus?.docs ?? []
  const vectors = corpus?.vectors ?? []
  const queryVector = opts.queryVector ?? null
  const topN = opts.topN ?? 10
  const perRoute = opts.perRoute ?? Math.max(topN * 2, 10)
  const k = opts.rrfK ?? 60

  const index = buildIndex(docs)
  const bm25Ids = bm25Rank(index, query, { k1: opts.k1, b: opts.b, k: perRoute }).map((r) => r.id)
  const vecIds = queryVector ? searchVectors(vectors, queryVector, perRoute).map((r) => r.id) : []

  return fuseResults([bm25Ids, vecIds], { k, topN })
}
`,
          test: L3S3
        }
      ],
      finalCode: `/**
 * 第 3 关 · 混合检索：BM25 + 向量 + RRF（完整实现）
 */
function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^\\p{L}\\p{N}\\s]+/gu, ' ')
    .split(/\\s+/)
    .filter(Boolean)
}

function termFreq(tokens) {
  const tf = new Map()
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
  return tf
}

function buildIndex(docs) {
  const list = (docs ?? []).map((d) => {
    const tokens = tokenize(d.text)
    return { id: String(d.id), tokens, tf: termFreq(tokens), length: tokens.length }
  })
  const N = list.length
  const df = new Map()
  for (const d of list) for (const t of new Set(d.tokens)) df.set(t, (df.get(t) ?? 0) + 1)
  const avgdl = N ? list.reduce((s, d) => s + d.length, 0) / N : 0
  return { list, N, avgdl, df }
}

function idfOf(index, term) {
  const N = index.N
  const df = index.df.get(term) ?? 0
  return Math.log(1 + (N - df + 0.5) / (df + 0.5))
}

function bm25Rank(index, query, opts = {}) {
  const k1 = opts.k1 ?? 1.2
  const b = opts.b ?? 0.75
  const topK = Number.isFinite(opts.k) ? Math.max(0, opts.k) : Infinity
  const qTerms = [...new Set(tokenize(query))]
  const rows = []
  for (const d of index.list) {
    let score = 0
    for (const t of qTerms) {
      const tf = d.tf.get(t) ?? 0
      if (tf <= 0) continue
      const idf = idfOf(index, t)
      const lenFactor = 1 - b + b * (d.length / (index.avgdl || 1))
      score += (idf * (tf * (k1 + 1))) / (tf + k1 * lenFactor)
    }
    if (score > 0) rows.push({ id: d.id, score })
  }
  rows.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id))
  return rows.slice(0, topK)
}

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) throw new Error('cosine 需要两个数组')
  if (a.length !== b.length) throw new Error('维度不一致：' + a.length + ' vs ' + b.length)
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

function normalize(v) {
  const norm = Math.sqrt((v ?? []).reduce((s, x) => s + x * x, 0))
  if (norm === 0) return (v ?? []).slice()
  return v.map((x) => x / norm)
}

function topKVector(store, query, k) {
  const rows = []
  for (const item of store ?? []) {
    if (!item || !Array.isArray(item.vector)) continue
    rows.push({ id: String(item.id), score: cosine(item.vector, query) })
  }
  rows.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id))
  if (!Number.isFinite(k)) return rows
  return rows.slice(0, Math.max(0, k))
}

function searchVectors(store, query, k) {
  if (!Array.isArray(query) || query.length === 0) throw new Error('query 向量不能为空')
  for (const item of store ?? []) {
    if (!item || !Array.isArray(item.vector)) throw new Error('文档 ' + (item?.id ?? '?') + ' 缺少向量')
    if (item.vector.length !== query.length) throw new Error('文档 ' + item.id + ' 的向量维度与 query 不一致')
  }
  return topKVector(store, query, k)
}

function rrfScores(lists, k = 60) {
  const score = new Map()
  for (const list of lists ?? []) {
    ;(list ?? []).forEach((id, i) => {
      const key = String(id)
      score.set(key, (score.get(key) ?? 0) + 1 / (k + i + 1))
    })
  }
  return score
}

function fuseResults(lists, opts = {}) {
  const k = opts.k ?? 60
  const topN = opts.topN ?? 10
  const score = rrfScores(lists, k)
  const rows = [...score.entries()].map(([id, s]) => ({ id, score: s }))
  rows.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id))
  return rows.slice(0, Math.max(0, topN))
}

function hybridSearch(corpus, query, opts = {}) {
  const docs = corpus?.docs ?? []
  const vectors = corpus?.vectors ?? []
  const queryVector = opts.queryVector ?? null
  const topN = opts.topN ?? 10
  const perRoute = opts.perRoute ?? Math.max(topN * 2, 10)
  const k = opts.rrfK ?? 60

  const index = buildIndex(docs)
  const bm25Ids = bm25Rank(index, query, { k1: opts.k1, b: opts.b, k: perRoute }).map((r) => r.id)
  const vecIds = queryVector ? searchVectors(vectors, queryVector, perRoute).map((r) => r.id) : []

  return fuseResults([bm25Ids, vecIds], { k, topN })
}
`,
      usage: `const docs = [
  { id: 'd1', text: 'vue reactivity proxy' },
  { id: 'd2', text: 'redis cache eviction' },
  { id: 'd3', text: 'vue render scheduler' },
  { id: 'd4', text: 'proxy 拦截与依赖收集' },
  { id: 'd5', text: 'reactivity 原理' }
]
const vectors = [
  { id: 'd1', vector: [1, 0] },
  { id: 'd2', vector: [0, 1] },
  { id: 'd3', vector: [0.9, 0.1] },
  { id: 'd4', vector: [1, 0] },
  { id: 'd5', vector: [0, 0.1] }
]

// 两路混合：d1 第一，d4（语义命中）和 d5（关键词命中）都被补回来
hybridSearch({ docs, vectors }, 'vue reactivity', { queryVector: [1, 0], topN: 4 })

// 只有关键词可见时（例如向量服务挂了），自动降级为 BM25 单路
hybridSearch({ docs, vectors }, 'vue reactivity', { topN: 4 })`,
      hints: [
        '先把 RRF 当成「只看名次的投票」：每一路给榜单上的文档投票，第 1 名票最重。',
        'perRoute 一定要大于 topN，否则融合池太小，另一路的中段候选进不来。',
        'hybridSearch 只是编排，不要在里面重写一遍 BM25 或余弦——复用前面两步的函数。'
      ],
      concepts: [
        {
          title: '混合检索之后还有什么',
          md: '融合之后通常还有一步 rerank（交叉编码器精排），以及按业务规则做去重、多样性、时间衰减。这一季到这里为止：把召回融合写对，是后面所有步骤的前提。'
        }
      ],
      skeleton: `/**
 * 第 3 关 · 混合检索：补完 rrfScores / fuseResults / hybridSearch
 *
 * 第 1、2 关的实现已经在这里，不要重写。
 */
function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^\\p{L}\\p{N}\\s]+/gu, ' ')
    .split(/\\s+/)
    .filter(Boolean)
}

function buildIndex(docs) {
  // 第 1 关已经写好，这里省略
  return { list: [], N: 0, avgdl: 0, df: new Map() }
}

function bm25Rank(index, query, opts = {}) {
  // 第 1 关已经写好，这里省略
  return []
}

function cosine(a, b) {
  // 第 2 关已经写好，这里省略
  return 0
}

function searchVectors(store, query, k) {
  // 第 2 关已经写好，这里省略
  return []
}

function rrfScores(lists, k = 60) {
  // TODO：名次倒数累加
  return new Map()
}

function fuseResults(lists, opts = {}) {
  // TODO：去重排序截断
  return []
}

function hybridSearch(corpus, query, opts = {}) {
  // TODO：BM25 路 + 向量路 → 融合
  return []
}
`,
      solution: `/**
 * 第 3 关 · 混合检索：BM25 + 向量 + RRF（完整实现）
 */
function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^\\p{L}\\p{N}\\s]+/gu, ' ')
    .split(/\\s+/)
    .filter(Boolean)
}

function termFreq(tokens) {
  const tf = new Map()
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
  return tf
}

function buildIndex(docs) {
  const list = (docs ?? []).map((d) => {
    const tokens = tokenize(d.text)
    return { id: String(d.id), tokens, tf: termFreq(tokens), length: tokens.length }
  })
  const N = list.length
  const df = new Map()
  for (const d of list) for (const t of new Set(d.tokens)) df.set(t, (df.get(t) ?? 0) + 1)
  const avgdl = N ? list.reduce((s, d) => s + d.length, 0) / N : 0
  return { list, N, avgdl, df }
}

function idfOf(index, term) {
  const N = index.N
  const df = index.df.get(term) ?? 0
  return Math.log(1 + (N - df + 0.5) / (df + 0.5))
}

function bm25Rank(index, query, opts = {}) {
  const k1 = opts.k1 ?? 1.2
  const b = opts.b ?? 0.75
  const topK = Number.isFinite(opts.k) ? Math.max(0, opts.k) : Infinity
  const qTerms = [...new Set(tokenize(query))]
  const rows = []
  for (const d of index.list) {
    let score = 0
    for (const t of qTerms) {
      const tf = d.tf.get(t) ?? 0
      if (tf <= 0) continue
      const idf = idfOf(index, t)
      const lenFactor = 1 - b + b * (d.length / (index.avgdl || 1))
      score += (idf * (tf * (k1 + 1))) / (tf + k1 * lenFactor)
    }
    if (score > 0) rows.push({ id: d.id, score })
  }
  rows.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id))
  return rows.slice(0, topK)
}

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) throw new Error('cosine 需要两个数组')
  if (a.length !== b.length) throw new Error('维度不一致：' + a.length + ' vs ' + b.length)
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

function normalize(v) {
  const norm = Math.sqrt((v ?? []).reduce((s, x) => s + x * x, 0))
  if (norm === 0) return (v ?? []).slice()
  return v.map((x) => x / norm)
}

function topKVector(store, query, k) {
  const rows = []
  for (const item of store ?? []) {
    if (!item || !Array.isArray(item.vector)) continue
    rows.push({ id: String(item.id), score: cosine(item.vector, query) })
  }
  rows.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id))
  if (!Number.isFinite(k)) return rows
  return rows.slice(0, Math.max(0, k))
}

function searchVectors(store, query, k) {
  if (!Array.isArray(query) || query.length === 0) throw new Error('query 向量不能为空')
  for (const item of store ?? []) {
    if (!item || !Array.isArray(item.vector)) throw new Error('文档 ' + (item?.id ?? '?') + ' 缺少向量')
    if (item.vector.length !== query.length) throw new Error('文档 ' + item.id + ' 的向量维度与 query 不一致')
  }
  return topKVector(store, query, k)
}

function rrfScores(lists, k = 60) {
  const score = new Map()
  for (const list of lists ?? []) {
    ;(list ?? []).forEach((id, i) => {
      const key = String(id)
      score.set(key, (score.get(key) ?? 0) + 1 / (k + i + 1))
    })
  }
  return score
}

function fuseResults(lists, opts = {}) {
  const k = opts.k ?? 60
  const topN = opts.topN ?? 10
  const score = rrfScores(lists, k)
  const rows = [...score.entries()].map(([id, s]) => ({ id, score: s }))
  rows.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id))
  return rows.slice(0, Math.max(0, topN))
}

function hybridSearch(corpus, query, opts = {}) {
  const docs = corpus?.docs ?? []
  const vectors = corpus?.vectors ?? []
  const queryVector = opts.queryVector ?? null
  const topN = opts.topN ?? 10
  const perRoute = opts.perRoute ?? Math.max(topN * 2, 10)
  const k = opts.rrfK ?? 60

  const index = buildIndex(docs)
  const bm25Ids = bm25Rank(index, query, { k1: opts.k1, b: opts.b, k: perRoute }).map((r) => r.id)
  const vecIds = queryVector ? searchVectors(vectors, queryVector, perRoute).map((r) => r.id) : []

  return fuseResults([bm25Ids, vecIds], { k, topN })
}
`,
      tests: [L3S1, L3S2, L3S3].join('\n\n')
    }
  ]
}