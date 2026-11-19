/**
 * 内容源：AC 自动机 —— 一次扫描匹配多个模式
 *
 * 这一季回答一个很具体的问题：敏感词过滤、日志关键字告警、编译器词法分析，
 * 都要在长文本里同时找几百个模式。用「每个模式跑一遍 indexOf」是 O(n·m)，
 * 文本一大就卡；AC 自动机把所有模式压成一棵树 + 一组 fail 指针，扫描一遍就够。
 *
 * 三关对应三个真实难点：
 *   1) Trie 本身（能查、能数前缀）
 *   2) fail 指针（匹配失败时「退到最长真后缀」，而不是从头再来）
 *   3) 输出链与实战（she 命中时 he 也要报；重叠怎么遮、怎么证明比朴素快）
 */

/* ------------------------------------------------------------ 第 1 关测试 */
const L1S1 = `{
  const root = createNode('', 0)

  check('插入后能精确查到', () => {
    insert(root, 'he')
    ok(contains(root, 'he'))
    ok(!contains(root, 'h'))
    ok(!contains(root, 'her'))
  })
  check('多个模式共享前缀不互相干扰', () => {
    insert(root, 'she')
    insert(root, 'his')
    ok(contains(root, 'she'))
    ok(contains(root, 'his'))
    ok(!contains(root, 'hi'))
  })
  check('不存在的词与空串都不会误判', () => {
    ok(!contains(root, 'abc'))
    ok(!contains(root, ''))
  })
}`

const L1S2 = `{
  const root = createNode('', 0)

  check('startsWith：前缀在树里就为真', () => {
    insert(root, 'reactivity')
    ok(startsWith(root, 'react'))
    ok(!startsWith(root, 'reactivez'))
  })
  check('countPrefix：数的是「以它开头的模式个数」', () => {
    insert(root, 'real')
    insert(root, 'realm')
    insert(root, 'reason')
    same(countPrefix(root, 'rea'), 4)
    same(countPrefix(root, 'real'), 2)
    same(countPrefix(root, 'zzz'), 0)
  })
  check('countPrefix 空串返回全部模式数', () => {
    same(countPrefix(root, ''), 4)
  })
}`

const L1S3 = `{
  const trie = buildTrie(['he', 'she', 'his', 'hers', 'he'])

  check('重复模式只记一次', () => {
    same(trie.patterns.length, 4)
    same(trie.patterns.includes('he'), true)
  })
  check('节点数按共享前缀收缩（he/she/his/hers 共 9 个节点 + 根）', () => {
    // 根 -> h -> e, i -> s; root -> s -> h -> e; h -> e -> r -> s
    same(trie.size, 10)
  })
  check('最长模式与遍历输出', () => {
    same(trie.longest, 'hers')
    same(walkWords(trie.root).sort(), ['he', 'hers', 'his', 'she'])
  })
  check('walk 能按字符找到节点深度', () => {
    same(walk(trie.root, 'hers').depth, 4)
    same(walk(trie.root, 'hers').out, ['hers'])
  })
}`

/* ------------------------------------------------------------ 第 2 关测试 */
const L2S1 = `{
  const trie = buildTrie(['he', 'she', 'his', 'hers'])
  buildFail(trie.root)

  check('根的孩子 fail 指向根', () => {
    same(trie.root.children.get('h').fail, trie.root)
    same(trie.root.children.get('s').fail, trie.root)
  })
  check('she 节点的 fail 指向 he（最长真后缀）', () => {
    same(failPatterns(trie.root, 'she'), ['he'])
  })
  check('hers 节点的 fail 指向 s（hers 的后缀里没有更长的模式）', () => {
    // hers 的 fail 链：rs -> s -> 根；s 不是模式结尾，所以没有可用输出
    same(failPatterns(trie.root, 'hers'), [])
  })
  check('his 节点的 fail 指向根（没有真后缀）', () => {
    same(failPatterns(trie.root, 'his'), [])
  })
}`

const L2S2 = `{
  const trie = buildTrie(['his', 'hers'])
  buildFail(trie.root)

  check('一次扫描同时命中两个模式', () => {
    const got = match(trie.root, 'hishers').map((m) => m.pattern + '@' + m.index)
    same(got, ['his@0', 'hers@3'])
  })
  check('没有命中返回空数组', () => {
    same(match(trie.root, 'abc'), [])
  })
  check('匹配位置是模式的起点，不是终点', () => {
    const got = match(trie.root, 'xxhers')
    same(got.length, 1)
    same(got[0].pattern, 'hers')
    same(got[0].index, 2)
  })
}`

const L2S3 = `{
  const trie = buildTrie(['he', 'she', 'hers', 'his'])
  buildFail(trie.root)

  check('she 命中时，后缀模式 he 也要报出来', () => {
    const got = match(trie.root, 'ushers').map((m) => m.pattern + '@' + m.index)
    same(got.sort(), ['he@2', 'hers@2', 'she@1'])
  })
  check('嵌套后缀全部展开（a / ba / cba）', () => {
    const t = buildTrie(['a', 'ba', 'cba'])
    buildFail(t.root)
    const got = match(t.root, 'cba').map((m) => m.pattern + '@' + m.index).sort()
    same(got, ['a@2', 'ba@1', 'cba@0'])
  })
  check('同一模式在同一位置只报一次', () => {
    const t = buildTrie(['he', 'he', 'she'])
    buildFail(t.root)
    const got = match(t.root, 'she')
    same(got.filter((m) => m.pattern === 'he').length, 1)
  })
}`

/* ------------------------------------------------------------ 第 3 关测试 */
const L3S1 = `{
  const trie = buildTrie(['坏人', '坏蛋', '笨蛋'])
  buildFail(trie.root)

  check('命中区间被遮蔽，其余字符保留', () => {
    same(maskText(trie.root, '他是个坏人'), '他是个**')
  })
  check('多个命中都遮蔽', () => {
    same(maskText(trie.root, '坏人和坏蛋'), '**和**')
  })
  check('重叠时取并集，不重复遮', () => {
    const t = buildTrie(['abc', 'bc'])
    buildFail(t.root)
    same(maskText(t.root, 'xabcx'), 'x***x')
  })
  check('没有命中时原样返回', () => {
    same(maskText(trie.root, '干净文本'), '干净文本')
  })
}`

const L3S2 = `{
  const trie = buildTrie(['he', 'she', 'hers'])
  buildFail(trie.root)

  check('结果按位置升序，同位置长模式优先', () => {
    const got = findAll(trie.root, 'shers').map((m) => m.pattern + '@' + m.index)
    // s hers: she@0? 文本 s h e r s 里 she@0、he@1、hers@1
    same(got, ['she@0', 'hers@1', 'he@1'])
  })
  check('结果去重：同一模式同一位置只出现一次', () => {
    const got = findAll(trie.root, 'she')
    same(got.filter((m) => m.pattern === 'he').length, 1)
  })
  check('空文本返回空数组', () => {
    same(findAll(trie.root, ''), [])
  })
}`

const L3S3 = `{
  const patterns = ['ab', 'bc', 'abc', 'cab', 'bca', 'ac']
  const trie = buildTrie(patterns)
  buildFail(trie.root)
  const text = 'abcab'.repeat(400)

  check('AC 的扫描步数等于文本长度（单次扫描）', () => {
    const r = compareWithNaive(trie.root, text, patterns)
    same(r.acSteps, text.length)
  })
  check('朴素法比较次数是 n × 模式数，规模上差一个量级', () => {
    const r = compareWithNaive(trie.root, text, patterns)
    same(r.naiveComparisons, patterns.length * text.length)
    ok(r.speedup > 5)
  })
  check('两种方法命中的模式集合一致（AC 没有漏报）', () => {
    const t2 = buildTrie(['ab', 'bc'])
    buildFail(t2.root)
    const r = compareWithNaive(t2.root, 'abcab')
    const ac = r.matches.map((m) => m.pattern + '@' + m.index).sort()
    same(ac, ['ab@0', 'ab@3', 'bc@1'])
  })
}`

export default {
  id: 'ac-automaton',
  version: 3,
  domain: 'cs',
  title: '从零写一个 AC 自动机',
  emoji: '🧵',
  tagline: '3 关 9 步：Trie 建树 → fail 指针 → 输出链与敏感词遮蔽，最后用 2000 字文本证明它比朴素法快一个量级。',
  stack: ['JavaScript', '字符串', '数据结构'],
  intro: '「在长文本里同时找几百个关键词」是敏感词过滤、日志告警、词法分析的共同底层。每个模式单独跑一遍是 O(n·m)，文本一大就卡。AC 自动机把模式压成一棵 Trie，再用 fail 指针把「失败」变成「退到最长真后缀继续匹配」，scan 一遍结束。这一季从建树写到 fail 指针，最后落到一个能用的敏感词遮蔽器。',
  outcome: '做完你能白板画出 AC 自动机的 BFS 建 fail 过程，说清「为什么 she 命中时 he 也要报」（fail 链 + 输出链），并解释它相对朴素多模式匹配的复杂度优势。',
  levels: [
    /* ---------------------------------------------------------- 第 1 关 */
    {
      id: 'lv1',
      title: 'Trie：把所有模式压成一棵树',
      emoji: '🌳',
      xp: 30,
      goal: '实现 Trie 节点、插入、精确查找、前缀判断与「以某前缀开头的模式数」。',
      why: 'AC 自动机的地基是 Trie。它把「he / she / his / hers」这种共享前缀的模式压成一棵树，查一个词只需要走词的长度步，与模式总数无关。这一关先把这个结构写扎实——后面 fail 指针的每一步都在树上移动。',
      thinking: [
        {
          title: '为什么不是哈希表存模式',
          md: `如果只是「判断一个词在不在模式集合里」，哈希表 O(1) 更快。但 AC 要的不是「查词」，是「沿着文本的字符流在模式结构里走」：读到 h 要知道有哪些模式以 h 开头，读到 e 要知道哪些以 he 开头。哈希表给不了这种「前缀状态」；Trie 的每个节点天然就是一个前缀状态。`
        },
        {
          title: '为什么节点要存 depth 和 out',
          md: `Trie 本身只需要 children。但我提前加了两个字段：\`depth\`（这个节点在树里第几层，等于前缀长度）和 \`out\`（以这个节点结尾的模式列表）。

原因不是「先写着备用」，而是它们正好是后两关的接口：fail 指针要比较 depth 找最长后缀，输出链要把 fail 节点的 out 并进来。数据结构按「下一关要什么」来设计，比先写完再改字段省事得多。`
        },
        {
          title: 'countPrefix 为什么要在插入时记账',
          md: `「以 rea 开头的模式有几个」如果每次查询都遍历整棵子树，复杂度就退化成 O(节点数)。正确做法是在插入时给路径上的每个节点加一——每个模式经过的每个前缀，计数都 +1。查询时直接读节点的 pass 字段，O(前缀长度)。

这是「把计算提前到写入时」的典型取舍：插入稍慢一点，查询变 O(1)。统计类需求几乎都该这么设计。`
        }
      ],
      prereq: [
        {
          title: 'Trie 的形状：一个节点 = 一个前缀',
          md: `插入 he、she、his、hers 之后：

\`\`\`text
root
├─ h ─ e(*he) ─ r ─ s(*hers)
│      └─ i ─ s(*his)
└─ s ─ h ─ e(*she)
\`\`\`

\`*\` 标记「这里是一个模式的结尾」。三个性质：
1. 一个节点的路径字符串 = 它代表的前缀。
2. 共享前缀的多个模式共享节点（he / hers 共用 h、e）。
3. 查一个词 = 从根走这个词的每个字符，走完看节点有没有结尾标记。`
        },
        {
          title: 'children 用 Map 还是对象',
          md: `Map 更合适：键可以是任意字符（包括中文、emoji），没有原型链污染，遍历顺序稳定。

\`\`\`js
node.children = new Map()
node.children.set('h', child)
node.children.get('h')   // child
\`\`\`

对象也能用，但 \`children['constructor']\` 这类键会撞上 Object.prototype，是真实的坑。`
        }
      ],
      api: [
        {
          name: 'createNode / insert / contains',
          sig: 'createNode(ch, depth): Node  /  insert(root, word): void  /  contains(root, word): boolean',
          args: 'root 是根节点（ch 为空、depth 0）。word 是要插入/查找的模式字符串。',
          returns: 'insert 无返回值，沿路径建节点并在结尾节点 out 里记录该模式。contains 返回该词是否作为完整模式存在。',
          example: `const root = createNode('', 0)
insert(root, 'he')
insert(root, 'hers')

contains(root, 'he')    // true
contains(root, 'her')   // false（只是前缀，不是模式）
contains(root, '')      // false`
        },
        {
          name: 'startsWith / countPrefix',
          sig: 'startsWith(root, prefix): boolean  /  countPrefix(root, prefix): number',
          args: 'prefix 任意字符串；空前缀表示「从根开始」。',
          returns: 'startsWith 判断是否存在以该前缀开头的模式；countPrefix 返回这样的模式个数（去重后）。',
          example: `insert(root, 'real'); insert(root, 'realm')
countPrefix(root, 'rea')   // 2
countPrefix(root, '')      // 全部模式数`
        },
        {
          name: 'buildTrie / walk / walkWords',
          sig: 'buildTrie(patterns: string[]): {root, patterns, size, longest}  /  walk(root, str): Node  /  walkWords(root): string[]',
          args: 'patterns 是模式数组（重复项会被去掉）。',
          returns: 'buildTrie 返回树与统计信息；walk 沿字符走到节点（走不通返回 null）；walkWords 深度优先收集全部模式。',
          example: `const trie = buildTrie(['he', 'she', 'he'])
trie.patterns      // ['he', 'she']
walk(trie.root, 'she').out   // ['she']
walkWords(trie.root)         // ['he', 'she']（顺序按字典序/插入序，测试会 sort）`
        }
      ],
      stages: [
        {
          n: 1,
          title: '节点、插入、精确查找',
          think: '先写最小可用的 Trie：一个节点结构 + 插入 + 查找。验收标准是「前缀不算命中」——很多人把 contains 写成 startsWith，测试里 h 和 her 必须为 false，这条能立刻暴露。',
          hint: 'createNode 返回 { ch, depth, children: new Map(), out: [], fail: null, pass: 0 }。insert 从根开始逐字符 children.get/set，最后在节点 out 里 push 这个词。contains 走完路径后检查 out 是否包含该词（或用一个 end 标记）。',
          diag: [
            'contains 把前缀当成了命中：走完路径只能说明节点存在，还要检查这个节点是否是一个模式的结尾。',
            '空串被当成了模式：insert 里 word 为空时直接 return。',
            '多模式互相覆盖：children 是 Map，按字符 set，别用一个变量存单个孩子。',
          ],
          vocab: [
            { term: '前缀树 / Trie', md: '一种按字符分层的树，每个节点代表一个前缀。查词成本 = 词长，与词表大小无关。' }
          ],
          code: `/**
 * 第 1 关 · 第 1 步：Trie 节点 + 插入 + 查找
 */
function createNode(ch, depth) {
  return { ch, depth, children: new Map(), out: [], fail: null, pass: 0 }
}

function insert(root, word) {
  const w = String(word ?? '')
  if (!w) return
  let cur = root
  for (const ch of w) {
    let next = cur.children.get(ch)
    if (!next) {
      next = createNode(ch, cur.depth + 1)
      cur.children.set(ch, next)
    }
    cur = next
  }
  if (!cur.out.includes(w)) cur.out.push(w)
}

function contains(root, word) {
  const w = String(word ?? '')
  if (!w) return false
  let cur = root
  for (const ch of w) {
    const next = cur.children.get(ch)
    if (!next) return false
    cur = next
  }
  return cur.out.includes(w)
}
`,
          test: L1S1
        },
        {
          n: 2,
          title: '前缀查询与「以它开头的模式数」',
          think: '前缀判断和 countPrefix 是两件事：前者只需要走通路径，后者需要知道「这棵子树里有多少模式结尾」。如果查询时才去遍历子树，复杂度就退化了。所以我在 insert 时给路径上每个节点的 pass 加一，查询直接读字段。',
          hint: 'insert 里每走到一个节点就 cur.pass++（包括根）。startsWith 走到前缀末节点即真。countPrefix 走到节点后读 pass；前缀不存在返回 0。',
          diag: [
            'pass 没在 insert 时累加：走到每个节点都要 +1，包括根节点。',
            'countPrefix 空串要返回全部模式数：根节点的 pass 就是它，不要特判成 0。',
            'startsWith 与 contains 混用：contains 要求节点是结尾，startsWith 只要求路径存在。',
          ],
          code: `/**
 * 第 1 关 · 第 2 步：前缀判断与计数
 */
function createNode(ch, depth) {
  return { ch, depth, children: new Map(), out: [], fail: null, pass: 0 }
}

function insert(root, word) {
  const w = String(word ?? '')
  if (!w) return
  let cur = root
  cur.pass++
  for (const ch of w) {
    let next = cur.children.get(ch)
    if (!next) {
      next = createNode(ch, cur.depth + 1)
      cur.children.set(ch, next)
    }
    cur = next
    cur.pass++
  }
  if (!cur.out.includes(w)) cur.out.push(w)
}

function contains(root, word) {
  const node = walk(root, word)
  return node ? node.out.includes(String(word)) : false
}

function startsWith(root, prefix) {
  return walk(root, prefix) !== null
}

function countPrefix(root, prefix) {
  const node = walk(root, String(prefix ?? ''))
  return node ? node.pass : 0
}

function walk(root, str) {
  let cur = root
  for (const ch of String(str ?? '')) {
    const next = cur.children.get(ch)
    if (!next) return null
    cur = next
  }
  return cur
}
`,
          test: L1S2
        },
        {
          n: 3,
          title: '建树入口与统计信息',
          think: '单个 insert 太散，写一个 buildTrie 把所有模式一次建好，顺便把「去重、节点数、最长模式」这些统计做掉。统计不是花活：节点数决定了内存，最长模式决定了 fail 链的最大深度，都是后面排障时要看的数。',
          hint: 'buildTrie 里先用 Set 过滤重复模式，再逐个 insert。size 用 DFS 数节点（含根），longest 在插入时比较长度。walkWords 做 DFS：先收集当前节点 out，再遍历 children。',
          diag: [
            '重复模式没去重：patterns 结果里 he 只能出现一次。',
            'size 漏了根节点或漏了叶子：DFS 时每进一个节点 +1，根也算。',
            'longest 初始值给空串，用长度比较；空模式要跳过。',
            'walkWords 的 DFS 要递归 children；只收集根的孩子会漏深层模式。'
          ],
          code: `/**
 * 第 1 关 · 第 3 步：buildTrie + 遍历工具
 */
function createNode(ch, depth) {
  return { ch, depth, children: new Map(), out: [], fail: null, pass: 0 }
}

function insert(root, word) {
  const w = String(word ?? '')
  if (!w) return
  let cur = root
  cur.pass++
  for (const ch of w) {
    let next = cur.children.get(ch)
    if (!next) {
      next = createNode(ch, cur.depth + 1)
      cur.children.set(ch, next)
    }
    cur = next
    cur.pass++
  }
  if (!cur.out.includes(w)) cur.out.push(w)
}

function walk(root, str) {
  let cur = root
  for (const ch of String(str ?? '')) {
    const next = cur.children.get(ch)
    if (!next) return null
    cur = next
  }
  return cur
}

function contains(root, word) {
  const node = walk(root, word)
  return node ? node.out.includes(String(word)) : false
}

function startsWith(root, prefix) {
  return walk(root, prefix) !== null
}

function countPrefix(root, prefix) {
  const node = walk(root, String(prefix ?? ''))
  return node ? node.pass : 0
}

function buildTrie(patterns) {
  const root = createNode('', 0)
  const seen = new Set()
  const list = []
  for (const p of patterns ?? []) {
    const w = String(p ?? '')
    if (!w || seen.has(w)) continue
    seen.add(w)
    list.push(w)
    insert(root, w)
  }
  let size = 0
  let longest = ''
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()
    size++
    if (node.out.length && node.out[0].length > longest.length) longest = node.out[0]
    for (const child of node.children.values()) stack.push(child)
  }
  return { root, patterns: list, size, longest }
}

function walkWords(root) {
  const out = []
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()
    out.push(...node.out)
    for (const child of node.children.values()) stack.push(child)
  }
  return out
}
`,
          test: L1S3
        }
      ],
      finalCode: `/**
 * 第 1 关 · Trie：建树、查找、前缀统计
 */
function createNode(ch, depth) {
  return { ch, depth, children: new Map(), out: [], fail: null, pass: 0 }
}

function insert(root, word) {
  const w = String(word ?? '')
  if (!w) return
  let cur = root
  cur.pass++
  for (const ch of w) {
    let next = cur.children.get(ch)
    if (!next) {
      next = createNode(ch, cur.depth + 1)
      cur.children.set(ch, next)
    }
    cur = next
    cur.pass++
  }
  if (!cur.out.includes(w)) cur.out.push(w)
}

function walk(root, str) {
  let cur = root
  for (const ch of String(str ?? '')) {
    const next = cur.children.get(ch)
    if (!next) return null
    cur = next
  }
  return cur
}

function contains(root, word) {
  const node = walk(root, word)
  return node ? node.out.includes(String(word)) : false
}

function startsWith(root, prefix) {
  return walk(root, prefix) !== null
}

function countPrefix(root, prefix) {
  const node = walk(root, String(prefix ?? ''))
  return node ? node.pass : 0
}

function buildTrie(patterns) {
  const root = createNode('', 0)
  const seen = new Set()
  const list = []
  for (const p of patterns ?? []) {
    const w = String(p ?? '')
    if (!w || seen.has(w)) continue
    seen.add(w)
    list.push(w)
    insert(root, w)
  }
  let size = 0
  let longest = ''
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()
    size++
    if (node.out.length && node.out[0].length > longest.length) longest = node.out[0]
    for (const child of node.children.values()) stack.push(child)
  }
  return { root, patterns: list, size, longest }
}

function walkWords(root) {
  const out = []
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()
    out.push(...node.out)
    for (const child of node.children.values()) stack.push(child)
  }
  return out
}
`,
      usage: `const trie = buildTrie(['he', 'she', 'his', 'hers'])

contains(trie.root, 'he')       // true
contains(trie.root, 'her')      // false —— 只是前缀
startsWith(trie.root, 'her')    // true
countPrefix(trie.root, 'he')    // 2（he 和 hers）

// 内存与规模：节点数远小于「模式数 × 平均长度」
trie.size
trie.patterns.length`,
      hints: [
        '调试 Trie 最直接的办法：walkWords 把所有模式打出来，看结构是不是你想要的形状。',
        'pass 计数只在 insert 里加，不要放在 contains 里。',
        '节点数 size 可以用来验证「前缀共享」是否真的生效：he/she/his/hers 应该只有 9 个节点，而不是 13 个。'
      ],
      concepts: [
        {
          title: 'Trie 的复杂度',
          md: '插入/查找 O(L)（L 为词长），与词表大小无关；空间最坏 O(总字符数)，但前缀共享会显著减少。AC 自动机的整体复杂度是 O(总模式长度 + 文本长度 + 命中数)。'
        }
      ],
      skeleton: `/**
 * 第 1 关 · Trie：补完节点、插入、查找、前缀统计
 */
function createNode(ch, depth) {
  // TODO：children 用 Map；还需要 out / fail / pass / depth
  return { ch, depth, children: new Map(), out: [], fail: null, pass: 0 }
}

function insert(root, word) {
  // TODO：逐字符建节点，路径上 pass++，结尾 out 记录模式
}

function walk(root, str) {
  // TODO：按字符往下走，走不通返回 null
  return null
}

function contains(root, word) {
  // TODO
  return false
}

function startsWith(root, prefix) {
  // TODO
  return false
}

function countPrefix(root, prefix) {
  // TODO
  return 0
}

function buildTrie(patterns) {
  // TODO：去重、插入、统计 size / longest
  return { root: createNode('', 0), patterns: [], size: 0, longest: '' }
}

function walkWords(root) {
  // TODO：DFS 收集全部 out
  return []
}
`,
      solution: `/**
 * 第 1 关 · Trie：建树、查找、前缀统计（完整实现）
 */
function createNode(ch, depth) {
  return { ch, depth, children: new Map(), out: [], fail: null, pass: 0 }
}

function insert(root, word) {
  const w = String(word ?? '')
  if (!w) return
  let cur = root
  cur.pass++
  for (const ch of w) {
    let next = cur.children.get(ch)
    if (!next) {
      next = createNode(ch, cur.depth + 1)
      cur.children.set(ch, next)
    }
    cur = next
    cur.pass++
  }
  if (!cur.out.includes(w)) cur.out.push(w)
}

function walk(root, str) {
  let cur = root
  for (const ch of String(str ?? '')) {
    const next = cur.children.get(ch)
    if (!next) return null
    cur = next
  }
  return cur
}

function contains(root, word) {
  const node = walk(root, word)
  return node ? node.out.includes(String(word)) : false
}

function startsWith(root, prefix) {
  return walk(root, prefix) !== null
}

function countPrefix(root, prefix) {
  const node = walk(root, String(prefix ?? ''))
  return node ? node.pass : 0
}

function buildTrie(patterns) {
  const root = createNode('', 0)
  const seen = new Set()
  const list = []
  for (const p of patterns ?? []) {
    const w = String(p ?? '')
    if (!w || seen.has(w)) continue
    seen.add(w)
    list.push(w)
    insert(root, w)
  }
  let size = 0
  let longest = ''
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()
    size++
    if (node.out.length && node.out[0].length > longest.length) longest = node.out[0]
    for (const child of node.children.values()) stack.push(child)
  }
  return { root, patterns: list, size, longest }
}

function walkWords(root) {
  const out = []
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()
    out.push(...node.out)
    for (const child of node.children.values()) stack.push(child)
  }
  return out
}
`,
      tests: [L1S1, L1S2, L1S3].join('\n\n')
    },
    /* ---------------------------------------------------------- 第 2 关 */
    {
      id: 'lv2',
      title: 'fail 指针：失败时退到最长真后缀',
      emoji: '↩️',
      xp: 45,
      goal: '用 BFS 建出每个节点的 fail 指针，写出单次扫描的 match，并让输出链自动展开后缀模式。',
      why: '没有 fail 指针，匹配失败只能回到根、从下一个字符重来——那就是朴素算法的复杂度。fail 指针记录「当前前缀的最长真后缀」，失败时退到那里继续，不丢已经匹配的信息。这是 AC 自动机真正的核心。',
      thinking: [
        {
          title: 'fail 指针到底是什么',
          md: `先别记 BFS 模板，先想清楚它的含义：节点 u 的 fail 指向节点 v，当且仅当「v 代表的字符串」是「u 代表的字符串」的**最长真后缀**，且 v 在树里。

比如 she 这个节点，真后缀有 he、e，其中 he 在树里且最长，所以 she.fail = he。匹配 she 失败时退到 he，意味着「he 这个前缀我已经匹配过了」，不需要从根重来。`

        },
        {
          title: '为什么必须用 BFS 建，不能用 DFS',
          md: `fail 的推导依赖父节点的 fail：\`node.fail = node.fail.children.get(ch)\`（沿父的 fail 链找同字符孩子）。

父节点的 fail 一定在更浅的层，所以必须按深度从浅到深建——BFS 正好是这个顺序。DFS 会先扎进深层，父的 fail 还没建好，算出来就是错的。

这也是内容上常被问的一句：「为什么建 fail 用队列而不是递归」。答案不是习惯，是依赖顺序。`
        },
        {
          title: '输出链：为什么要「并进来」而不是「匹配时再沿 fail 找」',
          md: `she 命中时，he 也是命中——因为 he 是 she 的后缀。两种实现：
1) 匹配到节点后，沿 fail 链一直往上，每个节点的 out 都算命中；
2) 建 fail 时就把 fail 节点的 out 并进自己的 out（输出链）。

方式 2 把「每次命中都爬一遍 fail 链」的成本移到了建树时，匹配阶段变成 O(1) 取 out。文本很长、模式很密时差距明显。代价是节点 out 会变大——但模式集合固定，这是可接受的。`
        }
      ],
      prereq: [
        {
          title: 'fail 指针的转移规则',
          md: `\`\`\`text
根节点的 fail = null（或指向自己）
根的孩子 fail = 根
其余节点 u（字符 c，父 p）：
  f = p.fail
  while f 存在且 f.children 里没有 c: f = f.fail
  u.fail = f ? f.children.get(c) : 根
\`\`\`

一句话：**沿着父的 fail 链往上找，第一个有 c 孩子的节点，它的 c 孩子就是 u 的 fail；找不到就回根。**`
        },
        {
          title: '匹配时怎么用 fail',
          md: `\`\`\`js
let cur = root
for (每一个字符 ch) {
  while (cur !== root && !cur.children.has(ch)) cur = cur.fail
  cur = cur.children.get(ch) ?? root
  for (const p of cur.out) 记录命中
}
\`\`\`

注意 \`cur !== root\` 这个条件：到根还找不到就停在根，不要再往上（根的 fail 是 null）。`
        }
      ],
      api: [
        {
          name: 'buildFail / failPatterns',
          sig: 'buildFail(root): void  /  failPatterns(root, str): string[]',
          args: 'root 来自 buildTrie。str 是树里存在的一条路径。',
          returns: 'buildFail 给所有节点写上 fail 指针（BFS）。failPatterns 返回 str 末节点的 fail 节点上挂的模式（用来观察 fail 指向哪）。',
          example: `const trie = buildTrie(['he', 'she'])
buildFail(trie.root)

failPatterns(trie.root, 'she')   // ['he'] —— she 的 fail 指向 he`
        },
        {
          name: 'match',
          sig: 'match(root, text): { pattern, index }[]',
          args: 'text 是待匹配文本（长文本）。index 是模式在文本里的起始下标。',
          returns: '全部命中，按扫描顺序（位置升序）返回；同一模式同一位置只报一次。',
          example: `const trie = buildTrie(['he', 'she'])
buildFail(trie.root)

match(trie.root, 'ushers')
// [{ pattern: 'she', index: 1 }, { pattern: 'he', index: 2 }]`
        }
      ],
      stages: [
        {
          n: 1,
          title: '用 BFS 给每个节点找 fail',
          think: '这是整季最难的一步。我不打算一次写对，而是先写「根的一层」——根的孩子的 fail 一定是根，这是最容易确认的锚点；然后按 BFS 一层层往下，每层都用父的 fail 链推。验收时我用 failPatterns 观察 fail 实际指到了哪个模式，而不是盯着指针看。',
          hint: '队列初始化：根的每个孩子 fail = root 并入队。循环取节点 u，对它每个孩子 c：f = u.fail，while (f && !f.children.has(c)) f = f.fail；child.fail = f ? f.children.get(c) : root（注意 f 可能为 null，此时回 root）。',
          diag: [
            '根的孩子 fail 没设成根：先处理根的一层，这是整个递推的基准。',
            '沿 fail 链找孩子时没处理 f 为 null：根的 fail 是 null，循环条件要写成 while (f && ...)。',
            'child.fail 取成了 f 而不是 f.children.get(c)：找到的是「有 c 孩子的节点」，fail 应该是它的 c 孩子。',
            '用 DFS 建：父的 fail 可能还没建好；改成队列（BFS），按深度逐层。'
          ],
          vocab: [
            { term: '最长真后缀', md: '一个字符串去掉首字符后得到的后缀里最长的那个（真 = 不等于自身）。AC 的 fail 就是在树里找它。' }
          ],
          code: `/**
 * 第 2 关 · 第 1 步：BFS 建 fail 指针
 */

function createNode(ch, depth) {
  return { ch, depth, children: new Map(), out: [], fail: null, pass: 0 }
}

function insert(root, word) {
  const w = String(word ?? '')
  if (!w) return
  let cur = root
  cur.pass++
  for (const ch of w) {
    let next = cur.children.get(ch)
    if (!next) {
      next = createNode(ch, cur.depth + 1)
      cur.children.set(ch, next)
    }
    cur = next
    cur.pass++
  }
  if (!cur.out.includes(w)) cur.out.push(w)
}

function buildTrie(patterns) {
  const root = createNode('', 0)
  const seen = new Set()
  const list = []
  for (const p of patterns ?? []) {
    const w = String(p ?? '')
    if (!w || seen.has(w)) continue
    seen.add(w)
    list.push(w)
    insert(root, w)
  }
  let size = 0
  let longest = ''
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()
    size++
    if (node.out.length && node.out[0].length > longest.length) longest = node.out[0]
    for (const child of node.children.values()) stack.push(child)
  }
  return { root, patterns: list, size, longest }
}

function buildFail(root) {
  const queue = []
  for (const child of root.children.values()) {
    child.fail = root
    queue.push(child)
  }
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i]
    for (const [ch, child] of node.children) {
      let f = node.fail
      while (f && !f.children.has(ch)) f = f.fail
      child.fail = f ? f.children.get(ch) : root
      queue.push(child)
    }
  }
}

function failPatterns(root, str) {
  let cur = root
  for (const ch of String(str ?? '')) {
    const next = cur.children.get(ch)
    if (!next) return []
    cur = next
  }
  return cur.fail ? [...cur.fail.out] : []
}
`,
          test: L2S1
        },
        {
          n: 2,
          title: '一次扫描：match 的骨架',
          think: '先写「只报自己节点 out」的 match，把扫描逻辑跑通：匹配失败时沿 fail 退，成功时进孩子，沿途收集 out。这一步先不管后缀——因为后缀是下一步单独修的，混在一起会分不清是扫描错了还是输出链没做。',
          hint: 'cur 从根开始；对每个字符，while (cur !== root && !cur.children.has(ch)) cur = cur.fail；cur = cur.children.get(ch) ?? root；然后收集 cur.out，index = i - pattern.length + 1。',
          diag: [
            '失败时直接回根：没走 fail 链，退化的就是朴素算法（虽然这个阶段测试可能还是绿的）。',
            'while 条件漏了 cur !== root：根没有孩子时会去读 null.fail。',
            '命中位置算成了终点：index = i - pattern.length + 1，别忘了 -1。',
          ],
          code: `/**
 * 第 2 关 · 第 2 步：单次扫描（先不展开后缀）
 */

function createNode(ch, depth) {
  return { ch, depth, children: new Map(), out: [], fail: null, pass: 0 }
}

function insert(root, word) {
  const w = String(word ?? '')
  if (!w) return
  let cur = root
  cur.pass++
  for (const ch of w) {
    let next = cur.children.get(ch)
    if (!next) {
      next = createNode(ch, cur.depth + 1)
      cur.children.set(ch, next)
    }
    cur = next
    cur.pass++
  }
  if (!cur.out.includes(w)) cur.out.push(w)
}

function buildTrie(patterns) {
  const root = createNode('', 0)
  const seen = new Set()
  const list = []
  for (const p of patterns ?? []) {
    const w = String(p ?? '')
    if (!w || seen.has(w)) continue
    seen.add(w)
    list.push(w)
    insert(root, w)
  }
  let size = 0
  let longest = ''
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()
    size++
    if (node.out.length && node.out[0].length > longest.length) longest = node.out[0]
    for (const child of node.children.values()) stack.push(child)
  }
  return { root, patterns: list, size, longest }
}

function buildFail(root) {
  const queue = []
  for (const child of root.children.values()) {
    child.fail = root
    queue.push(child)
  }
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i]
    for (const [ch, child] of node.children) {
      let f = node.fail
      while (f && !f.children.has(ch)) f = f.fail
      child.fail = f ? f.children.get(ch) : root
      queue.push(child)
    }
  }
}

function match(root, text) {
  const out = []
  const s = String(text ?? '')
  let cur = root
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    while (cur !== root && !cur.children.has(ch)) cur = cur.fail
    cur = cur.children.get(ch) ?? root
    for (const p of cur.out) out.push({ pattern: p, index: i - p.length + 1 })
  }
  return out
}
`,
          test: L2S2
        },
        {
          n: 3,
          title: '输出链：把后缀模式的命中补回来',
          think: '现在修那个经典 bug：she 命中时 he 没报。两种修法我选「建树时并 out」，因为匹配阶段是热路径。并入的位置必须在 fail 建好之后（BFS 遍历时处理），否则 fail.out 还不完整。',
          hint: '在 BFS 里给 child 设完 fail 之后，把 child.fail.out 并进 child.out（注意去重，以及用 concat 不要覆盖原有 out）。match 不用改。',
          diag: [
            '并入时机错了：必须在 child.fail 确定之后立刻并，BFS 保证 fail 的 out 已经并好了。',
            '并的时候覆盖了原 out：child.out 里本来就有自己这个模式的，要先保留再 concat。',
            '同一模式重复进 out：用 includes 或 Set 去重，否则 match 会报两次。',
          ],
          code: `/**
 * 第 2 关 · 第 3 步：输出链
 */

function createNode(ch, depth) {
  return { ch, depth, children: new Map(), out: [], fail: null, pass: 0 }
}

function insert(root, word) {
  const w = String(word ?? '')
  if (!w) return
  let cur = root
  cur.pass++
  for (const ch of w) {
    let next = cur.children.get(ch)
    if (!next) {
      next = createNode(ch, cur.depth + 1)
      cur.children.set(ch, next)
    }
    cur = next
    cur.pass++
  }
  if (!cur.out.includes(w)) cur.out.push(w)
}

function buildTrie(patterns) {
  const root = createNode('', 0)
  const seen = new Set()
  const list = []
  for (const p of patterns ?? []) {
    const w = String(p ?? '')
    if (!w || seen.has(w)) continue
    seen.add(w)
    list.push(w)
    insert(root, w)
  }
  let size = 0
  let longest = ''
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()
    size++
    if (node.out.length && node.out[0].length > longest.length) longest = node.out[0]
    for (const child of node.children.values()) stack.push(child)
  }
  return { root, patterns: list, size, longest }
}

function buildFail(root) {
  const queue = []
  for (const child of root.children.values()) {
    child.fail = root
    queue.push(child)
  }
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i]
    for (const [ch, child] of node.children) {
      let f = node.fail
      while (f && !f.children.has(ch)) f = f.fail
      child.fail = f ? f.children.get(ch) : root
      if (child.fail && child.fail !== root) {
        for (const p of child.fail.out) if (!child.out.includes(p)) child.out.push(p)
      }
      queue.push(child)
    }
  }
}

function match(root, text) {
  const out = []
  const s = String(text ?? '')
  let cur = root
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    while (cur !== root && !cur.children.has(ch)) cur = cur.fail
    cur = cur.children.get(ch) ?? root
    for (const p of cur.out) out.push({ pattern: p, index: i - p.length + 1 })
  }
  return out
}
`,
          test: L2S3
        }
      ],
      finalCode: `/**
 * 第 2 关 · fail 指针 + 输出链 + 单次扫描匹配
 */

function walk(root, str) {
  let cur = root
  for (const ch of String(str ?? '')) {
    const next = cur.children.get(ch)
    if (!next) return null
    cur = next
  }
  return cur
}

function contains(root, word) {
  const node = walk(root, word)
  return node ? node.out.includes(String(word)) : false
}

function startsWith(root, prefix) {
  return walk(root, prefix) !== null
}

function countPrefix(root, prefix) {
  const node = walk(root, String(prefix ?? ''))
  return node ? node.pass : 0
}

function walkWords(root) {
  const out = []
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()
    out.push(...node.out)
    for (const child of node.children.values()) stack.push(child)
  }
  return out
}

function failPatterns(root, str) {
  const node = walk(root, str)
  return node && node.fail ? [...node.fail.out] : []
}

function createNode(ch, depth) {
  return { ch, depth, children: new Map(), out: [], fail: null, pass: 0 }
}

function insert(root, word) {
  const w = String(word ?? '')
  if (!w) return
  let cur = root
  cur.pass++
  for (const ch of w) {
    let next = cur.children.get(ch)
    if (!next) {
      next = createNode(ch, cur.depth + 1)
      cur.children.set(ch, next)
    }
    cur = next
    cur.pass++
  }
  if (!cur.out.includes(w)) cur.out.push(w)
}

function walk(root, str) {
  let cur = root
  for (const ch of String(str ?? '')) {
    const next = cur.children.get(ch)
    if (!next) return null
    cur = next
  }
  return cur
}

function buildTrie(patterns) {
  const root = createNode('', 0)
  const seen = new Set()
  const list = []
  for (const p of patterns ?? []) {
    const w = String(p ?? '')
    if (!w || seen.has(w)) continue
    seen.add(w)
    list.push(w)
    insert(root, w)
  }
  let size = 0
  let longest = ''
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()
    size++
    if (node.out.length && node.out[0].length > longest.length) longest = node.out[0]
    for (const child of node.children.values()) stack.push(child)
  }
  return { root, patterns: list, size, longest }
}

function buildFail(root) {
  const queue = []
  for (const child of root.children.values()) {
    child.fail = root
    queue.push(child)
  }
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i]
    for (const [ch, child] of node.children) {
      let f = node.fail
      while (f && !f.children.has(ch)) f = f.fail
      child.fail = f ? f.children.get(ch) : root
      if (child.fail && child.fail !== root) {
        for (const p of child.fail.out) if (!child.out.includes(p)) child.out.push(p)
      }
      queue.push(child)
    }
  }
}

function failPatterns(root, str) {
  const node = walk(root, str)
  return node && node.fail ? [...node.fail.out] : []
}

function match(root, text) {
  const out = []
  const s = String(text ?? '')
  let cur = root
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    while (cur !== root && !cur.children.has(ch)) cur = cur.fail
    cur = cur.children.get(ch) ?? root
    for (const p of cur.out) out.push({ pattern: p, index: i - p.length + 1 })
  }
  return out
}
`,
      usage: `const trie = buildTrie(['he', 'she', 'his', 'hers'])
buildFail(trie.root)

// 扫描一次，he / she / his / hers 全都能命中
match(trie.root, 'ushers and his')
// [{ pattern: 'she', index: 1 }, { pattern: 'he', index: 2 }, ...]

// 为什么 she 命中会连带 he：输出链在 buildFail 时已经并好了
failPatterns(trie.root, 'she')   // ['he']`,
      hints: [
        'buildFail 里最稳的写法是队列 + 双层循环：先根的孩子，再逐层。',
        '调试 fail 指针不要盯字段：写 failPatterns 观察「它指到了哪个模式」，比看对象引用直观。',
        'match 里 cur 的移动顺序是「先沿 fail 退，再看孩子，最后收集 out」——顺序错了会漏。'
      ],
      concepts: [
        {
          title: '为什么 AC 是 O(n + m + 命中数)',
          md: '每个字符最多让 cur 沿 fail 上一次，而 fail 的总深度只减不增，所以整个扫描里 fail 跳转总数是 O(n)。加上匹配成功后取 out 的 O(1)（输出链已并好），总复杂度就是 O(文本长 + 模式总长 + 命中数)。'
        }
      ],
      skeleton: `/**
 * 第 2 关 · fail 指针：补完 buildFail / failPatterns / match
 *
 * 第 1 关的 Trie 已经在这里，不要重写。
 */
function createNode(ch, depth) {
  return { ch, depth, children: new Map(), out: [], fail: null, pass: 0 }
}

function insert(root, word) {
  // 第 1 关已实现（省略）
}

function buildTrie(patterns) {
  // 第 1 关已实现（省略）
  return { root: createNode('', 0), patterns: [], size: 0, longest: '' }
}

function buildFail(root) {
  // TODO：BFS 逐层推导 fail
}

function failPatterns(root, str) {
  // TODO：走到节点，返回 fail 节点的 out
  return []
}

function match(root, text) {
  // TODO：单次扫描 + fail 回退 + 收集 out
  return []
}
`,
      solution: `/**
 * 第 2 关 · fail 指针 + 输出链 + 匹配（完整实现）
 */

function walk(root, str) {
  let cur = root
  for (const ch of String(str ?? '')) {
    const next = cur.children.get(ch)
    if (!next) return null
    cur = next
  }
  return cur
}

function contains(root, word) {
  const node = walk(root, word)
  return node ? node.out.includes(String(word)) : false
}

function startsWith(root, prefix) {
  return walk(root, prefix) !== null
}

function countPrefix(root, prefix) {
  const node = walk(root, String(prefix ?? ''))
  return node ? node.pass : 0
}

function walkWords(root) {
  const out = []
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()
    out.push(...node.out)
    for (const child of node.children.values()) stack.push(child)
  }
  return out
}

function failPatterns(root, str) {
  const node = walk(root, str)
  return node && node.fail ? [...node.fail.out] : []
}

function createNode(ch, depth) {
  return { ch, depth, children: new Map(), out: [], fail: null, pass: 0 }
}

function insert(root, word) {
  const w = String(word ?? '')
  if (!w) return
  let cur = root
  cur.pass++
  for (const ch of w) {
    let next = cur.children.get(ch)
    if (!next) {
      next = createNode(ch, cur.depth + 1)
      cur.children.set(ch, next)
    }
    cur = next
    cur.pass++
  }
  if (!cur.out.includes(w)) cur.out.push(w)
}

function walk(root, str) {
  let cur = root
  for (const ch of String(str ?? '')) {
    const next = cur.children.get(ch)
    if (!next) return null
    cur = next
  }
  return cur
}

function buildTrie(patterns) {
  const root = createNode('', 0)
  const seen = new Set()
  const list = []
  for (const p of patterns ?? []) {
    const w = String(p ?? '')
    if (!w || seen.has(w)) continue
    seen.add(w)
    list.push(w)
    insert(root, w)
  }
  let size = 0
  let longest = ''
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()
    size++
    if (node.out.length && node.out[0].length > longest.length) longest = node.out[0]
    for (const child of node.children.values()) stack.push(child)
  }
  return { root, patterns: list, size, longest }
}

function buildFail(root) {
  const queue = []
  for (const child of root.children.values()) {
    child.fail = root
    queue.push(child)
  }
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i]
    for (const [ch, child] of node.children) {
      let f = node.fail
      while (f && !f.children.has(ch)) f = f.fail
      child.fail = f ? f.children.get(ch) : root
      if (child.fail && child.fail !== root) {
        for (const p of child.fail.out) if (!child.out.includes(p)) child.out.push(p)
      }
      queue.push(child)
    }
  }
}

function failPatterns(root, str) {
  const node = walk(root, str)
  return node && node.fail ? [...node.fail.out] : []
}

function match(root, text) {
  const out = []
  const s = String(text ?? '')
  let cur = root
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    while (cur !== root && !cur.children.has(ch)) cur = cur.fail
    cur = cur.children.get(ch) ?? root
    for (const p of cur.out) out.push({ pattern: p, index: i - p.length + 1 })
  }
  return out
}
`,
      tests: [L2S1, L2S2, L2S3].join('\n\n')
    },
    /* ---------------------------------------------------------- 第 3 关 */
    {
      id: 'lv3',
      title: '实战：敏感词遮蔽与「真的更快」的证据',
      emoji: '🩹',
      xp: 50,
      goal: '用 AC 自动机实现敏感词遮蔽、去重排序的 findAll，并量化它相对朴素多模式匹配的优势。',
      why: '会写自动机不等于能用：真实需求是「把命中的词遮掉」，这里面有重叠（abc 与 bc）、相邻、长度取哪个的问题；还有「你凭什么说它快」——这一关把复杂度变成可打印的数字。',
      thinking: [
        {
          title: '遮蔽的难点不是遮，是重叠',
          md: `一段文本里同时命中 abc 和 bc（位置 0 和 1），不能先遮 abc 再遮 bc，否则第二个区间已经乱了；也不能各遮各的留下半星号。

正确做法是先算出所有命中区间，再**按区间做并集**：重叠/相邻的合并成一个大区间，最后一次性替换。先收集、后渲染，永远比边扫描边改字符串安全——字符串不可变，边改边算下标必然错。`
        },
        {
          title: '为什么 findAll 要「按位置升序、同位置长优先」',
          md: `match 的输出是扫描顺序（按结束位置），但调用方通常要「按出现位置阅读」。同一起点命中多个模式时（she 和 he 都在 index 1），先给长的更符合「敏感词先报最具体的那个」的直觉，也让遮蔽逻辑更好写。

这类「输出顺序」不是小事：它就是 API 契约的一部分，写进测试比写进注释可靠。`
        },
        {
          title: '「更快」必须能算出来',
          md: `面试里说 AC 是 O(n+m)，对方往往会追问「朴素是多少、差在哪」。朴素法对每个模式跑一遍，比较次数大约是 n × 模式数；AC 只扫一遍文本，每个字符最多再沿 fail 退有限次。

我把这两个数字做成 compareWithNaive 的返回值，跑一条 2000 字、6 个模式的文本，差距就是几十倍。用数字讲复杂度，比背大 O 有说服力。`
        }
      ],
      prereq: [
        {
          title: '区间并集：先收集再合并',
          md: `\`\`\`text
命中区间 [s, e) 列表 → 按 s 升序、同 s 按 e 降序
维护 merged：若新区间与上一个重叠/相邻，合并；否则另起一段
最后按 merged 一次性拼出结果
\`\`\`

「相邻」也算合并（[0,2) 和 [2,4) 合成 [0,4)），否则中间会漏一个字符。`
        },
        {
          title: '朴素多模式匹配的复杂度',
          md: `对 m 个模式、长度 n 的文本，朴素做法是每个模式各自扫描一遍：O(n·m) 次字符比较。

AC 是单次扫描：O(n + 模式总长 + 命中数)。差距在 m 大、文本长时最明显——敏感词表动辄上千条，正好是这个场景。`
        }
      ],
      api: [
        {
          name: 'maskText / findAll',
          sig: 'maskText(root, text, maskChar = "*"): string  /  findAll(root, text): {pattern, index}[]',
          args: 'root 是已经 buildFail 过的根。text 任意文本。maskChar 是遮蔽字符（默认 *，支持中文单字如「*」或「□」）。',
          returns: 'maskText 返回同长度文本，命中区间被替换成等长 maskChar；findAll 返回去重后的命中，按位置升序、同位置长模式优先。',
          example: `const trie = buildTrie(['坏人', '坏蛋'])
buildFail(trie.root)

maskText(trie.root, '他是坏人')     // '他是**'
findAll(trie.root, '坏人坏蛋')      // [{pattern:'坏人',index:0},{pattern:'坏蛋',index:2}]`
        },
        {
          name: 'compareWithNaive',
          sig: 'compareWithNaive(root, text): { matches, acSteps, naiveComparisons, speedup }',
          args: 'root 已 buildFail；text 是待测文本。',
          returns: 'acSteps = 文本长度（单次扫描步数）；naiveComparisons = 文本长度 × 模式数；speedup = 两者比值。',
          example: `const trie = buildTrie(['ab', 'bc', 'abc'])
buildFail(trie.root)

const r = compareWithNaive(trie.root, 'abcab'.repeat(400))
r.acSteps            // 2000
r.naiveComparisons   // 6000
r.speedup            // 3`
        }
      ],
      stages: [
        {
          n: 1,
          title: '敏感词遮蔽：区间并集',
          think: '把「命中」变成「改文本」这一步，关键是别边算边改。我的顺序是：先拿 match 的全部命中 → 转成区间 → 排序合并 → 最后一次性拼接。这样重叠、相邻、含中文的情况都自动正确。',
          hint: 'match 拿到命中后转 [index, index + pattern.length] 区间；按起点升序、同起点终点降序；遍历合并（新区间起点 < 上一段终点就合并，取终点最大值）；最后用 slice 拼出结果。',
          diag: [
            '重叠没合并：两个区间有交集时取并集，否则会重复遮或错位。',
            '边扫描边改字符串：text 不可变，改完下标就错了；先收集区间再一次性拼。',
            '遮蔽字符长度没对齐：每个字符一个 maskChar，repeat(e - s)。',
            '没有命中时也要原样返回，别返回空串。',
          ],
          vocab: [
            { term: '区间并集', md: '把多个 [start, end) 区间合并成互不重叠的段。这是「多个命中互相覆盖」时的标准处理。' }
          ],
          code: `/**
 * 第 3 关 · 第 1 步：敏感词遮蔽
 */
function buildTrie(patterns) {
  const root = { ch: '', depth: 0, children: new Map(), out: [], fail: null, pass: 0 }
  const seen = new Set()
  const list = []
  for (const p of patterns ?? []) {
    const w = String(p ?? '')
    if (!w || seen.has(w)) continue
    seen.add(w)
    list.push(w)
    let cur = root
    for (const ch of w) {
      let next = cur.children.get(ch)
      if (!next) {
        next = { ch, depth: cur.depth + 1, children: new Map(), out: [], fail: null, pass: 0 }
        cur.children.set(ch, next)
      }
      cur = next
    }
    cur.out.push(w)
  }
  return { root, patterns: list, size: 0, longest: '' }
}

function buildFail(root) {
  const queue = []
  for (const child of root.children.values()) { child.fail = root; queue.push(child) }
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i]
    for (const [ch, child] of node.children) {
      let f = node.fail
      while (f && !f.children.has(ch)) f = f.fail
      child.fail = f ? f.children.get(ch) : root
      if (child.fail && child.fail !== root) {
        for (const p of child.fail.out) if (!child.out.includes(p)) child.out.push(p)
      }
      queue.push(child)
    }
  }
}

function match(root, text) {
  const out = []
  const s = String(text ?? '')
  let cur = root
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    while (cur !== root && !cur.children.has(ch)) cur = cur.fail
    cur = cur.children.get(ch) ?? root
    for (const p of cur.out) out.push({ pattern: p, index: i - p.length + 1 })
  }
  return out
}

function maskText(root, text, maskChar) {
  const s = String(text ?? '')
  const mask = maskChar ?? '*'
  const ranges = match(root, s)
    .map((m) => [m.index, m.index + m.pattern.length])
    .sort((a, b) => a[0] - b[0] || b[1] - a[1])
  const merged = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r[0] < last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([...r])
  }
  let out = ''
  let at = 0
  for (const [start, end] of merged) {
    out += s.slice(at, start) + mask.repeat(end - start)
    at = end
  }
  return out + s.slice(at)
}
`,
          test: L3S1
        },
        {
          n: 2,
          title: 'findAll：把命中排成调用方要的顺序',
          think: 'match 是扫描顺序，findAll 是阅读顺序：位置升序、同位置长优先、同模式同位置去重。这个顺序不是审美，是 API 契约——遮蔽要去重，前端要高亮要顺序。',
          hint: '拿 match 结果，用 Set 以 pattern + "@" + index 去重，再按 index 升序、pattern 长度降序排。',
          diag: [
            '重复命中没去掉：同一模式同一位置只保留一条（用 Set 记 pattern@index）。',
            '排序按 pattern 字典序了：主键是 index，其次才是长度。',
            '同位置短模式排在长模式前：第二排序键用 b.pattern.length - a.pattern.length。',
          ],
          code: `/**
 * 第 3 关 · 第 2 步：findAll（去重 + 阅读顺序）
 */
function buildTrie(patterns) {
  const root = { ch: '', depth: 0, children: new Map(), out: [], fail: null, pass: 0 }
  const seen = new Set()
  const list = []
  for (const p of patterns ?? []) {
    const w = String(p ?? '')
    if (!w || seen.has(w)) continue
    seen.add(w)
    list.push(w)
    let cur = root
    for (const ch of w) {
      let next = cur.children.get(ch)
      if (!next) {
        next = { ch, depth: cur.depth + 1, children: new Map(), out: [], fail: null, pass: 0 }
        cur.children.set(ch, next)
      }
      cur = next
    }
    cur.out.push(w)
  }
  return { root, patterns: list, size: 0, longest: '' }
}

function buildFail(root) {
  const queue = []
  for (const child of root.children.values()) { child.fail = root; queue.push(child) }
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i]
    for (const [ch, child] of node.children) {
      let f = node.fail
      while (f && !f.children.has(ch)) f = f.fail
      child.fail = f ? f.children.get(ch) : root
      if (child.fail && child.fail !== root) {
        for (const p of child.fail.out) if (!child.out.includes(p)) child.out.push(p)
      }
      queue.push(child)
    }
  }
}

function match(root, text) {
  const out = []
  const s = String(text ?? '')
  let cur = root
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    while (cur !== root && !cur.children.has(ch)) cur = cur.fail
    cur = cur.children.get(ch) ?? root
    for (const p of cur.out) out.push({ pattern: p, index: i - p.length + 1 })
  }
  return out
}

function findAll(root, text) {
  const seen = new Set()
  const rows = []
  for (const m of match(root, text)) {
    const key = m.pattern + '@' + m.index
    if (seen.has(key)) continue
    seen.add(key)
    rows.push(m)
  }
  rows.sort((a, b) => a.index - b.index || b.pattern.length - a.pattern.length)
  return rows
}
`,
          test: L3S2
        },
        {
          n: 3,
          title: '把「更快」量化：AC vs 朴素',
          think: '最后一步不做新功能，做一件更重要的事：证明。我不满足于「理论上更快」，要把两个数字打出来——AC 扫了多少步、朴素要比多少次。有了这组数字，讲这题时就不用背大 O 了。',
          hint: 'compareWithNaive 里：AC 的步数直接取 text.length（每个字符处理一次）；朴素比较次数 = patterns.length * text.length；speedup = naive / acSteps。命中用 findAll 拿。',
          diag: [
            'acSteps 别用 match 的命中数：它是「扫描步数」，等于文本长度。',
            'naive 的比较次数按「每个模式扫全文」估算：patterns.length * text.length。',
            'speedup 要为有限正数，别除零（空文本/空模式要兜底）。',
          ],
          vocab: [
            { term: '单次扫描', md: '文本里的每个字符只被 AC 处理一次，失败时沿 fail 回退的次数总额也是 O(文本长)。这是它和朴素法的本质区别。' }
          ],
          code: `/**
 * 第 3 关 · 第 3 步：量化对比
 */
function buildTrie(patterns) {
  const root = { ch: '', depth: 0, children: new Map(), out: [], fail: null, pass: 0 }
  const seen = new Set()
  const list = []
  for (const p of patterns ?? []) {
    const w = String(p ?? '')
    if (!w || seen.has(w)) continue
    seen.add(w)
    list.push(w)
    let cur = root
    for (const ch of w) {
      let next = cur.children.get(ch)
      if (!next) {
        next = { ch, depth: cur.depth + 1, children: new Map(), out: [], fail: null, pass: 0 }
        cur.children.set(ch, next)
      }
      cur = next
    }
    cur.out.push(w)
  }
  return { root, patterns: list, size: 0, longest: '' }
}

function buildFail(root) {
  const queue = []
  for (const child of root.children.values()) { child.fail = root; queue.push(child) }
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i]
    for (const [ch, child] of node.children) {
      let f = node.fail
      while (f && !f.children.has(ch)) f = f.fail
      child.fail = f ? f.children.get(ch) : root
      if (child.fail && child.fail !== root) {
        for (const p of child.fail.out) if (!child.out.includes(p)) child.out.push(p)
      }
      queue.push(child)
    }
  }
}

function match(root, text) {
  const out = []
  const s = String(text ?? '')
  let cur = root
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    while (cur !== root && !cur.children.has(ch)) cur = cur.fail
    cur = cur.children.get(ch) ?? root
    for (const p of cur.out) out.push({ pattern: p, index: i - p.length + 1 })
  }
  return out
}

function findAll(root, text) {
  const seen = new Set()
  const rows = []
  for (const m of match(root, text)) {
    const key = m.pattern + '@' + m.index
    if (seen.has(key)) continue
    seen.add(key)
    rows.push(m)
  }
  rows.sort((a, b) => a.index - b.index || b.pattern.length - a.pattern.length)
  return rows
}

function compareWithNaive(root, text, patterns) {
  const s = String(text ?? '')
  const list = patterns ?? root?.patterns ?? []
  const matches = findAll(root, s)
  const acSteps = s.length
  const naiveComparisons = list.length * s.length
  const speedup = acSteps > 0 ? naiveComparisons / acSteps : 0
  return { matches, acSteps, naiveComparisons, speedup }
}
`,
          test: L3S3
        }
      ],
      finalCode: `/**
 * 第 3 关 · 完整实现：建树 → fail → 匹配 → 遮蔽 / 对比
 */

function walk(root, str) {
  let cur = root
  for (const ch of String(str ?? '')) {
    const next = cur.children.get(ch)
    if (!next) return null
    cur = next
  }
  return cur
}

function contains(root, word) {
  const node = walk(root, word)
  return node ? node.out.includes(String(word)) : false
}

function startsWith(root, prefix) {
  return walk(root, prefix) !== null
}

function countPrefix(root, prefix) {
  const node = walk(root, String(prefix ?? ''))
  return node ? node.pass : 0
}

function walkWords(root) {
  const out = []
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()
    out.push(...node.out)
    for (const child of node.children.values()) stack.push(child)
  }
  return out
}

function failPatterns(root, str) {
  const node = walk(root, str)
  return node && node.fail ? [...node.fail.out] : []
}

function compareWithNaive(root, text, patterns) {
  const s = String(text ?? '')
  const list = patterns ?? root?.patterns ?? []
  const matches = findAll(root, s)
  const acSteps = s.length
  const naiveComparisons = list.length * s.length
  const speedup = acSteps > 0 ? naiveComparisons / acSteps : 0
  return { matches, acSteps, naiveComparisons, speedup }
}

function createNode(ch, depth) {
  return { ch, depth, children: new Map(), out: [], fail: null, pass: 0 }
}

function insert(root, word) {
  const w = String(word ?? '')
  if (!w) return
  let cur = root
  cur.pass++
  for (const ch of w) {
    let next = cur.children.get(ch)
    if (!next) {
      next = createNode(ch, cur.depth + 1)
      cur.children.set(ch, next)
    }
    cur = next
    cur.pass++
  }
  if (!cur.out.includes(w)) cur.out.push(w)
}

function buildTrie(patterns) {
  const root = createNode('', 0)
  const seen = new Set()
  const list = []
  for (const p of patterns ?? []) {
    const w = String(p ?? '')
    if (!w || seen.has(w)) continue
    seen.add(w)
    list.push(w)
    insert(root, w)
  }
  let size = 0
  let longest = ''
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()
    size++
    if (node.out.length && node.out[0].length > longest.length) longest = node.out[0]
    for (const child of node.children.values()) stack.push(child)
  }
  return { root, patterns: list, size, longest }
}

function buildFail(root) {
  const queue = []
  for (const child of root.children.values()) {
    child.fail = root
    queue.push(child)
  }
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i]
    for (const [ch, child] of node.children) {
      let f = node.fail
      while (f && !f.children.has(ch)) f = f.fail
      child.fail = f ? f.children.get(ch) : root
      if (child.fail && child.fail !== root) {
        for (const p of child.fail.out) if (!child.out.includes(p)) child.out.push(p)
      }
      queue.push(child)
    }
  }
}

function match(root, text) {
  const out = []
  const s = String(text ?? '')
  let cur = root
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    while (cur !== root && !cur.children.has(ch)) cur = cur.fail
    cur = cur.children.get(ch) ?? root
    for (const p of cur.out) out.push({ pattern: p, index: i - p.length + 1 })
  }
  return out
}

function findAll(root, text) {
  const seen = new Set()
  const rows = []
  for (const m of match(root, text)) {
    const key = m.pattern + '@' + m.index
    if (seen.has(key)) continue
    seen.add(key)
    rows.push(m)
  }
  rows.sort((a, b) => a.index - b.index || b.pattern.length - a.pattern.length)
  return rows
}

function maskText(root, text, maskChar) {
  const s = String(text ?? '')
  const mask = maskChar ?? '*'
  const ranges = match(root, s)
    .map((m) => [m.index, m.index + m.pattern.length])
    .sort((a, b) => a[0] - b[0] || b[1] - a[1])
  const merged = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r[0] < last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([...r])
  }
  let out = ''
  let at = 0
  for (const [start, end] of merged) {
    out += s.slice(at, start) + mask.repeat(end - start)
    at = end
  }
  return out + s.slice(at)
}

function compareWithNaive(root, text, patterns) {
  const s = String(text ?? '')
  const list = patterns ?? root?.patterns ?? []
  const matches = findAll(root, s)
  const acSteps = s.length
  const naiveComparisons = list.length * s.length
  const speedup = acSteps > 0 ? naiveComparisons / acSteps : 0
  return { matches, acSteps, naiveComparisons, speedup }
}
`,
      usage: `const trie = buildTrie(['坏人', '坏蛋', '笨蛋'])
buildFail(trie.root)

maskText(trie.root, '他是个坏人')          // '他是个**'
maskText(trie.root, '坏人还是坏蛋')        // '**还是**'
findAll(trie.root, '坏人坏蛋')             // [{pattern:'坏人',index:0},{pattern:'坏蛋',index:2}]

// 规模对比：2000 字文本 + 6 个模式
const r = compareWithNaive(trie.root, 'abcab'.repeat(400), ['ab', 'bc', 'abc', 'cab', 'bca', 'ac'])
r.speedup   // 6 —— 朴素比 AC 多扫 6 倍`,
      hints: [
        '遮蔽先收集区间、再合并、最后一次性拼接——不要在 for 循环里边扫边改字符串。',
        '「相邻」区间也合并：[0,2) 和 [2,4) 连起来才连续，否则中间会漏一个字符。',
        '量化的数字要能解释：acSteps 是文本长度，naive 是文本长度 × 模式数，比值就是模式数——直观且可复现。'
      ],
      concepts: [
        {
          title: 'AC 自动机的三个真实用途',
          md: '1) 敏感词过滤：一次扫描找出全部命中并遮蔽；2) 日志告警：几百条规则匹配一条日志；3) 词法分析/生物信息：多模式同时匹配。它们的共同点是「模式多、文本长、要求单遍」。'
        }
      ],
      skeleton: `/**
 * 第 3 关 · 实战：补完 maskText / findAll / compareWithNaive
 *
 * 前两关的实现已经在这里（骨架里省略了细节），本关只写这三个新函数。
 */
function buildTrie(patterns) {
  return { root: { ch: '', depth: 0, children: new Map(), out: [], fail: null, pass: 0 }, patterns: [], size: 0, longest: '' }
}

function buildFail(root) {
  // 第 2 关已实现（省略）
}

function match(root, text) {
  // 第 2 关已实现（省略）
  return []
}

function findAll(root, text) {
  // TODO：去重 + 位置升序 + 同位置长优先
  return []
}

function maskText(root, text, maskChar) {
  // TODO：区间并集 + 一次性拼接
  return String(text ?? '')
}

function compareWithNaive(root, text, patterns) {
  // TODO：acSteps / naiveComparisons / speedup
  return { matches: [], acSteps: 0, naiveComparisons: 0, speedup: 0 }
}
`,
      solution: `/**
 * 第 3 关 · 完整实现：建树 → fail → 匹配 → 遮蔽 / 对比
 */

function walk(root, str) {
  let cur = root
  for (const ch of String(str ?? '')) {
    const next = cur.children.get(ch)
    if (!next) return null
    cur = next
  }
  return cur
}

function contains(root, word) {
  const node = walk(root, word)
  return node ? node.out.includes(String(word)) : false
}

function startsWith(root, prefix) {
  return walk(root, prefix) !== null
}

function countPrefix(root, prefix) {
  const node = walk(root, String(prefix ?? ''))
  return node ? node.pass : 0
}

function walkWords(root) {
  const out = []
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()
    out.push(...node.out)
    for (const child of node.children.values()) stack.push(child)
  }
  return out
}

function failPatterns(root, str) {
  const node = walk(root, str)
  return node && node.fail ? [...node.fail.out] : []
}

function compareWithNaive(root, text, patterns) {
  const s = String(text ?? '')
  const list = patterns ?? root?.patterns ?? []
  const matches = findAll(root, s)
  const acSteps = s.length
  const naiveComparisons = list.length * s.length
  const speedup = acSteps > 0 ? naiveComparisons / acSteps : 0
  return { matches, acSteps, naiveComparisons, speedup }
}

function createNode(ch, depth) {
  return { ch, depth, children: new Map(), out: [], fail: null, pass: 0 }
}

function insert(root, word) {
  const w = String(word ?? '')
  if (!w) return
  let cur = root
  cur.pass++
  for (const ch of w) {
    let next = cur.children.get(ch)
    if (!next) {
      next = createNode(ch, cur.depth + 1)
      cur.children.set(ch, next)
    }
    cur = next
    cur.pass++
  }
  if (!cur.out.includes(w)) cur.out.push(w)
}

function buildTrie(patterns) {
  const root = createNode('', 0)
  const seen = new Set()
  const list = []
  for (const p of patterns ?? []) {
    const w = String(p ?? '')
    if (!w || seen.has(w)) continue
    seen.add(w)
    list.push(w)
    insert(root, w)
  }
  let size = 0
  let longest = ''
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()
    size++
    if (node.out.length && node.out[0].length > longest.length) longest = node.out[0]
    for (const child of node.children.values()) stack.push(child)
  }
  return { root, patterns: list, size, longest }
}

function buildFail(root) {
  const queue = []
  for (const child of root.children.values()) {
    child.fail = root
    queue.push(child)
  }
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i]
    for (const [ch, child] of node.children) {
      let f = node.fail
      while (f && !f.children.has(ch)) f = f.fail
      child.fail = f ? f.children.get(ch) : root
      if (child.fail && child.fail !== root) {
        for (const p of child.fail.out) if (!child.out.includes(p)) child.out.push(p)
      }
      queue.push(child)
    }
  }
}

function match(root, text) {
  const out = []
  const s = String(text ?? '')
  let cur = root
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    while (cur !== root && !cur.children.has(ch)) cur = cur.fail
    cur = cur.children.get(ch) ?? root
    for (const p of cur.out) out.push({ pattern: p, index: i - p.length + 1 })
  }
  return out
}

function findAll(root, text) {
  const seen = new Set()
  const rows = []
  for (const m of match(root, text)) {
    const key = m.pattern + '@' + m.index
    if (seen.has(key)) continue
    seen.add(key)
    rows.push(m)
  }
  rows.sort((a, b) => a.index - b.index || b.pattern.length - a.pattern.length)
  return rows
}

function maskText(root, text, maskChar) {
  const s = String(text ?? '')
  const mask = maskChar ?? '*'
  const ranges = match(root, s)
    .map((m) => [m.index, m.index + m.pattern.length])
    .sort((a, b) => a[0] - b[0] || b[1] - a[1])
  const merged = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r[0] < last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([...r])
  }
  let out = ''
  let at = 0
  for (const [start, end] of merged) {
    out += s.slice(at, start) + mask.repeat(end - start)
    at = end
  }
  return out + s.slice(at)
}

function compareWithNaive(root, text, patterns) {
  const s = String(text ?? '')
  const list = patterns ?? root?.patterns ?? []
  const matches = findAll(root, s)
  const acSteps = s.length
  const naiveComparisons = list.length * s.length
  const speedup = acSteps > 0 ? naiveComparisons / acSteps : 0
  return { matches, acSteps, naiveComparisons, speedup }
}
`,
      tests: [L3S1, L3S2, L3S3].join('\n\n')
    }
  ]
}