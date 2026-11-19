/**
 * cs-algo —— 算法与数据结构三关：
 *   lv1 复杂度（主定理 + 渐进化简）+ 单调栈
 *   lv2 树（迭代遍历/BST、堆与 TopK、AVL 旋转）
 *   lv3 图（并查集、拓扑排序、Dijkstra）
 * 分配见 data/plans/cs-algo.json。
 */

/* ============================================================ 第 1 关测试 */
const L1S1 = `{
  check('归并排序的递归式：T(n)=2T(n/2)+n 落在临界相等情形', () => {
    const r = solveRecurrence(2, 2, 1)
    same(r.case, 2)
    same(r.order, 'O(n log n)')
  })
  check('二分查找：T(n)=T(n/2)+1 → 对数级', () => {
    const r = solveRecurrence(1, 2, 0)
    same(r.case, 2)
    same(r.order, 'O(log n)')
  })
  check('临界幂大于 f(n)：T(n)=4T(n/2)+n → Θ(n^2)', () => {
    const r = solveRecurrence(4, 2, 1)
    same(r.case, 1)
    same(r.order, 'O(n^2)')
  })
  check('临界幂小于 f(n)：T(n)=2T(n/2)+n^2 → Θ(n^2)', () => {
    const r = solveRecurrence(2, 2, 2)
    same(r.case, 3)
    same(r.order, 'O(n^2)')
  })
  check('朴素矩阵乘法：T(n)=8T(n/2)+n^2 → Θ(n^3)', () => {
    const r = solveRecurrence(8, 2, 2)
    same(r.case, 1)
    same(r.order, 'O(n^3)')
  })
}`

const L1S2 = `{
  check('主项胜出：n^2 压过 n log n 与常数', () => {
    same(simplify(['3n^2', 'n log n', 'n', '5']), 'O(n^2)')
  })
  check('线性压过常数（常数再大也会被 n 追上）', () => {
    same(simplify(['2n', '1000']), 'O(n)')
  })
  check('同阶时 log 因子决定：n log n > n', () => {
    same(simplify(['n log n', 'n']), 'O(n log n)')
  })
  check('log n 压过常数 1', () => {
    same(simplify(['5', 'log n']), 'O(log n)')
  })
  check('只有常数项就是 O(1)', () => {
    same(simplify(['7']), 'O(1)')
  })
}`

const L1S3 = `{
  check('混合序列的右侧第一个更大值', () => {
    same(nextGreater([2, 1, 2, 4, 3]), [4, 2, 4, -1, -1])
  })
  check('单调递减序列全都没有更大值', () => {
    same(nextGreater([5, 4, 3, 2, 1]), [-1, -1, -1, -1, -1])
  })
  check('单调递增序列：每个都指向下一个', () => {
    same(nextGreater([1, 2, 3]), [2, 3, -1])
  })
  check('空数组返回空数组', () => {
    same(nextGreater([]), [])
  })
  check('相等元素不算「更大」（严格大于）', () => {
    same(nextGreater([2, 2, 3]), [3, 3, -1])
  })
}`

/* ============================================================ 第 1 关 */
const LV1 = {
  id: 'lv1',
  title: '复杂度三件套：主定理、渐进化简、单调栈',
  emoji: '📈',
  xp: 45,
  goal: '实现 solveRecurrence(a, b, d) 用主定理判定递归式复杂度，simplify(terms) 把多项式表达式化简成 Big-O，nextGreater(nums) 用单调栈求右侧第一个更大值。',
  why: '算法面试的第一道门槛不是写代码，是「这段代码多快」和「为什么这个写法是 O(n)」。主定理决定递归式能不能一眼看出量级；渐进化简决定你敢不敢把 O(n^2 + n log n) 直接说成 O(n^2)；单调栈则是把 O(n^2) 暴力降到 O(n) 的最典型手段——三者是同一件事的三个角度。',
  nodes: ['cs.algo.complexity', 'cs.algo.complexity.master-theorem', 'cs.algo.linear', 'cs.algo.linear.stack-queue-monotonic'],
  thinking: [
    {
      title: '主定理只比较一个数：log_b(a) 与 d',
      md: '对 T(n) = a·T(n/b) + Θ(n^d)，令 critical = log_b(a)：\n\n- critical > d：递归项占主导，T(n) = Θ(n^critical)；\n- critical = d：两层势均力敌，多乘一个 log，T(n) = Θ(n^d log n)；\n- critical < d：合并代价占主导，T(n) = Θ(n^d)。\n\n所以「归并排序为什么是 n log n」的答案就是一个等式：log_2(2) = 1 = d，落在相等情形。'
    },
    {
      title: '渐进化简的本质是「只看增长最快的项」',
      md: '多项式里系数和低阶项在大 n 下都会被主项吞掉，所以化简只做三件事：找最高次幂、同次幂里保留 log 因子、丢掉系数。\n\n注意 `n log n` 和 `n` 同属「一次幂」，但 log 因子让前者更大——这是很多人算错的地方。'
    },
    {
      title: '单调栈为什么是 O(n)',
      md: '每个下标最多入栈一次、出栈一次，所以循环总次数 ≤ 2n。栈里维护的是「还没找到答案的下标」，且它们的值单调递减——一旦遇到更大的值，栈顶那些人就同时找到了答案。\n\n暴力写法的内层循环会重复扫描同一段区间，单调栈把「重复扫描」换成了「一次进出」。'
    }
  ],
  prereq: [
    {
      title: 'Θ / O / Ω 的区别',
      md: 'O 是上界（最多这么快），Ω 是下界，Θ 是紧确界（上下界同阶）。面试里说「时间复杂度是 O(n log n)」通常指 Θ，因为排序问题本身有 Ω(n log n) 的下界。\n\n本关 `solveRecurrence` 返回的都是 Θ 的紧确形式，只是输出写成 O 的记号（口语习惯）。'
    },
    {
      title: '主定理的适用条件',
      md: '主定理要求：a ≥ 1、b > 1、f(n) 是渐进正函数，且第三种情形需要满足正则条件（a·f(n/b) ≤ k·f(n)，k < 1）。\n\n不满足时（比如 T(n) = 2T(n/2) + n log n）就要用递归树或 Akra–Bazzi。面试里遇到「主定理套不上」通常意味着答案里要出现 log^2 n。'
    }
  ],
  api: [
    {
      name: 'solveRecurrence',
      sig: 'solveRecurrence(a: number, b: number, d: number) => { case: 1|2|3, order: string }',
      args: 'a 是子问题个数，b 是规模缩小倍数，d 是合并代价 Θ(n^d) 的指数。',
      returns: 'case 对应主定理三种情形；order 是形如 "O(n^2)" / "O(n log n)" / "O(log n)" 的字符串。',
      example: 'solveRecurrence(2, 2, 1)  // { case: 2, order: "O(n log n)" }\nsolveRecurrence(8, 2, 2)  // { case: 1, order: "O(n^3)" }'
    },
    {
      name: 'simplify',
      sig: 'simplify(terms: string[]) => string',
      args: '每项是 "3n^2"、"n log n"、"log n"、"5" 这类写法（系数可选、空格可选）。',
      returns: '化简后的 Big-O 字符串。',
      example: "simplify(['3n^2', 'n log n', 'n', '5'])  // 'O(n^2)'"
    },
    {
      name: 'nextGreater',
      sig: 'nextGreater(nums: number[]) => number[]',
      args: 'nums 是整数数组。',
      returns: '等长数组，每项为右侧第一个严格大于它的值，不存在则 -1。',
      example: 'nextGreater([2, 1, 2, 4, 3])  // [4, 2, 4, -1, -1]'
    }
  ],
  usage: '// 单调栈的典型业务场景：股票跨度（每天往前数连续多少天价格不超过今天）\n// 用 nextGreater 的对称写法即可：\n//   for (i) while (stack 顶 <= price[i]) stack.pop()\n//   span[i] = i - (stack 顶 ?? -1)\n//   stack.push(i)',
  hints: [
    '第 1 步：先算 critical = Math.log(a) / Math.log(b)，用 Math.abs(critical - d) < 1e-9 判相等。',
    '第 2 步：写 parseTerm 把字符串拆成 { coef, exp, log }，按 exp 降序、再按 log 降序取第一个。',
    '第 3 步：栈里放下标；遇到 nums[i] 更大就不断弹栈并给那些下标填答案，最后 push i。'
  ],
  concepts: [
    {
      title: '为什么暴力「下一个更大元素」是 O(n^2)',
      md: '对每个位置向右线性扫描，最坏情况（递减数组）每个都扫到底，总比较次数 n(n-1)/2。\n\n单调栈把「已扫描但没答案」的元素留在栈里，每个元素只被检查常数次——这就是摊还分析（amortized analysis）的经典例子：单次操作可能弹很多，但总次数有上界。'
    },
    {
      title: '递归树视角：为什么相等情形多一个 log',
      md: 'T(n) = 2T(n/2) + n：每层总代价都是 n，树高是 log n，所以总和 n log n。\n\n不等情形下树的叶子层或根层某一端占绝对多数，总和被那端主导。递归树是主定理的「为什么」，主定理是它的速查表。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '主定理：三种情形判定',
      think: '先只做判定：算临界幂、比大小、返回情形编号和量级字符串。三种情形的输出必须与编号对应，否则面试时「说对了答案、说错了理由」。',
      hint: 'formatOrder(exp, withLog) 单独抽出来；相等时 withLog = true，临界幂取 Math.round。',
      code: `function formatOrder(exp, withLog) {
  if (exp === 0) return withLog ? 'O(log n)' : 'O(1)'
  const base = exp === 1 ? 'n' : 'n^' + exp
  return 'O(' + base + (withLog ? ' log n' : '') + ')'
}

function solveRecurrence(a, b, d) {
  const critical = Math.log(a) / Math.log(b)
  const same = Math.abs(critical - d) < 1e-9
  if (same) return { case: 2, order: formatOrder(d, true) }
  if (critical > d) return { case: 1, order: formatOrder(Math.round(critical), false) }
  return { case: 3, order: formatOrder(d, false) }
}`,
      test: L1S1,
      diag: [
        '只比较 critical 与 d 却没处理相等（相等情形必须是 case 2 且带 log）。',
        '临界幂用 Math.floor/ceil 而不是 round，log_2(8)=3 被截成 2。',
        '相等时忘了带 log：T(n)=2T(n/2)+n 被写成 O(n)。',
        'case 1 与 case 3 的判断方向反了（critical > d 时用 d 的量级）。',
        'formatOrder 把 exp 直接拼进字符串，"O(n^1)" 这种形式没归一成 "O(n)"。'
      ]
    },
    {
      n: 2,
      title: '渐进化简：找主项',
      think: '这一步是解析 + 比较：把每项拆成（系数，n 的幂，log 因子），按幂次优先、log 次之排序，取最大的那个拼回字符串。',
      hint: 'parseTerm 先吃掉数字系数，再判断 "logn" / "n" / "^k" 三种片段。',
      code: `function formatOrder(exp, withLog) {
  if (exp === 0) return withLog ? 'O(log n)' : 'O(1)'
  const base = exp === 1 ? 'n' : 'n^' + exp
  return 'O(' + base + (withLog ? ' log n' : '') + ')'
}

function solveRecurrence(a, b, d) {
  const critical = Math.log(a) / Math.log(b)
  const same = Math.abs(critical - d) < 1e-9
  if (same) return { case: 2, order: formatOrder(d, true) }
  if (critical > d) return { case: 1, order: formatOrder(Math.round(critical), false) }
  return { case: 3, order: formatOrder(d, false) }
}

function parseTerm(raw) {
  let s = String(raw).replace(/\\s+/g, '')
  const out = { coef: 1, exp: 0, log: 0 }
  const num = s.match(/^(\\d+)/)
  if (num) { out.coef = Number(num[1]); s = s.slice(num[1].length) }
  if (s === '') return out
  if (s === 'logn') { out.log = 1; return out }
  if (s.charAt(0) === 'n') { s = s.slice(1); out.exp = 1 }
  const pow = s.match(/^\\^(\\d+)/)
  if (pow) { out.exp = Number(pow[1]); s = s.slice(pow[0].length) }
  if (s === 'logn') { out.log = 1; s = '' }
  if (s !== '') throw new Error('无法解析的项: ' + raw)
  return out
}

function simplify(terms) {
  const parsed = terms.map(parseTerm)
  parsed.sort((x, y) => (y.exp - x.exp) || (y.log - x.log))
  const top = parsed[0]
  if (top.exp === 0) return top.log ? 'O(log n)' : 'O(1)'
  const base = top.exp === 1 ? 'n' : 'n^' + top.exp
  return 'O(' + base + (top.log ? ' log n' : '') + ')'
}`,
      test: L1S2,
      diag: [
        '排序只比较幂次，忽略了 `n log n` 与 `n` 同为一次幂但前者更大。',
        'parseTerm 没吃掉系数，"3n^2" 被当成无法解析。',
        '纯数字（"5"、"1000"）被当成幂次 5 / 1000。',
        '输出保留了系数：得到 O(3n^2) 而不是 O(n^2)。',
        '"log n" 的分支没单独处理，被当成以 l 开头的普通项解析失败。'
      ]
    },
    {
      n: 3,
      title: '单调栈：右侧第一个更大值',
      think: '栈里存的是「还在等答案」的下标，且它们的值从栈底到栈顶递减。当前元素一旦比栈顶大，栈顶就等到答案了——弹一个填一个，直到栈顶不再更小。',
      hint: '初始化结果数组全 -1；循环里 while 栈非空且 nums[栈顶] < nums[i] 就弹出并赋值；最后 push i。',
      code: `function formatOrder(exp, withLog) {
  if (exp === 0) return withLog ? 'O(log n)' : 'O(1)'
  const base = exp === 1 ? 'n' : 'n^' + exp
  return 'O(' + base + (withLog ? ' log n' : '') + ')'
}

function solveRecurrence(a, b, d) {
  const critical = Math.log(a) / Math.log(b)
  const same = Math.abs(critical - d) < 1e-9
  if (same) return { case: 2, order: formatOrder(d, true) }
  if (critical > d) return { case: 1, order: formatOrder(Math.round(critical), false) }
  return { case: 3, order: formatOrder(d, false) }
}

function parseTerm(raw) {
  let s = String(raw).replace(/\s+/g, '')
  const out = { coef: 1, exp: 0, log: 0 }
  const num = s.match(/^(\d+)/)
  if (num) { out.coef = Number(num[1]); s = s.slice(num[1].length) }
  if (s === '') return out
  if (s === 'logn') { out.log = 1; return out }
  if (s.charAt(0) === 'n') { s = s.slice(1); out.exp = 1 }
  const pow = s.match(/^\^(\d+)/)
  if (pow) { out.exp = Number(pow[1]); s = s.slice(pow[0].length) }
  if (s === 'logn') { out.log = 1; s = '' }
  if (s !== '') throw new Error('无法解析的项: ' + raw)
  return out
}

function simplify(terms) {
  const parsed = terms.map(parseTerm)
  parsed.sort((x, y) => (y.exp - x.exp) || (y.log - x.log))
  const top = parsed[0]
  if (top.exp === 0) return top.log ? 'O(log n)' : 'O(1)'
  const base = top.exp === 1 ? 'n' : 'n^' + top.exp
  return 'O(' + base + (top.log ? ' log n' : '') + ')'
}

function nextGreater(nums) {
  const result = new Array(nums.length).fill(-1)
  const stack = []

  for (let i = 0; i < nums.length; i++) {
    while (stack.length && nums[stack[stack.length - 1]] < nums[i]) {
      result[stack.pop()] = nums[i]
    }
    stack.push(i)
  }

  return result
}`,
      test: L1S3,
      diag: [
        '内层用 if 而不是 while，一次只弹一个，前面的下标等不到答案。',
        '比较用了 <=（相等元素互相顶掉），"严格大于"语义变成大于等于。',
        '结果数组没初始化为 -1，没等到答案的位置是 undefined。',
        '栈里存的是值而不是下标，无法回填对应位置。',
        '弹出后没有把栈顶的值写到 result[弹出的下标]，而是写到当前位置。'
      ]
    }
  ],
  skeleton: `function solveRecurrence(a, b, d) {
  // TODO: 比较 log_b(a) 与 d 的三种情形，返回 { case, order }
  throw new Error('solveRecurrence 还没实现')
}

function simplify(terms) {
  // TODO: 解析每项的幂次与 log 因子，取增长最快的主项
  throw new Error('simplify 还没实现')
}

function nextGreater(nums) {
  // TODO: 单调递减栈，栈里放下标
  throw new Error('nextGreater 还没实现')
}`,
  solution: `function formatOrder(exp, withLog) {
  if (exp === 0) return withLog ? 'O(log n)' : 'O(1)'
  const base = exp === 1 ? 'n' : 'n^' + exp
  return 'O(' + base + (withLog ? ' log n' : '') + ')'
}

function solveRecurrence(a, b, d) {
  const critical = Math.log(a) / Math.log(b)
  const same = Math.abs(critical - d) < 1e-9
  if (same) return { case: 2, order: formatOrder(d, true) }
  if (critical > d) return { case: 1, order: formatOrder(Math.round(critical), false) }
  return { case: 3, order: formatOrder(d, false) }
}

function parseTerm(raw) {
  let s = String(raw).replace(/\\s+/g, '')
  const out = { coef: 1, exp: 0, log: 0 }
  const num = s.match(/^(\\d+)/)
  if (num) { out.coef = Number(num[1]); s = s.slice(num[1].length) }
  if (s === '') return out
  if (s === 'logn') { out.log = 1; return out }
  if (s.charAt(0) === 'n') { s = s.slice(1); out.exp = 1 }
  const pow = s.match(/^\\^(\\d+)/)
  if (pow) { out.exp = Number(pow[1]); s = s.slice(pow[0].length) }
  if (s === 'logn') { out.log = 1; s = '' }
  if (s !== '') throw new Error('无法解析的项: ' + raw)
  return out
}

function simplify(terms) {
  const parsed = terms.map(parseTerm)
  parsed.sort((x, y) => (y.exp - x.exp) || (y.log - x.log))
  const top = parsed[0]
  if (top.exp === 0) return top.log ? 'O(log n)' : 'O(1)'
  const base = top.exp === 1 ? 'n' : 'n^' + top.exp
  return 'O(' + base + (top.log ? ' log n' : '') + ')'
}

function nextGreater(nums) {
  const result = new Array(nums.length).fill(-1)
  const stack = []

  for (let i = 0; i < nums.length; i++) {
    while (stack.length && nums[stack[stack.length - 1]] < nums[i]) {
      result[stack.pop()] = nums[i]
    }
    stack.push(i)
  }

  return result
}`,
  finalCode: `function formatOrder(exp, withLog) {
  if (exp === 0) return withLog ? 'O(log n)' : 'O(1)'
  const base = exp === 1 ? 'n' : 'n^' + exp
  return 'O(' + base + (withLog ? ' log n' : '') + ')'
}

function solveRecurrence(a, b, d) {
  const critical = Math.log(a) / Math.log(b)
  const same = Math.abs(critical - d) < 1e-9
  if (same) return { case: 2, order: formatOrder(d, true) }
  if (critical > d) return { case: 1, order: formatOrder(Math.round(critical), false) }
  return { case: 3, order: formatOrder(d, false) }
}

function parseTerm(raw) {
  let s = String(raw).replace(/\\s+/g, '')
  const out = { coef: 1, exp: 0, log: 0 }
  const num = s.match(/^(\\d+)/)
  if (num) { out.coef = Number(num[1]); s = s.slice(num[1].length) }
  if (s === '') return out
  if (s === 'logn') { out.log = 1; return out }
  if (s.charAt(0) === 'n') { s = s.slice(1); out.exp = 1 }
  const pow = s.match(/^\\^(\\d+)/)
  if (pow) { out.exp = Number(pow[1]); s = s.slice(pow[0].length) }
  if (s === 'logn') { out.log = 1; s = '' }
  if (s !== '') throw new Error('无法解析的项: ' + raw)
  return out
}

function simplify(terms) {
  const parsed = terms.map(parseTerm)
  parsed.sort((x, y) => (y.exp - x.exp) || (y.log - x.log))
  const top = parsed[0]
  if (top.exp === 0) return top.log ? 'O(log n)' : 'O(1)'
  const base = top.exp === 1 ? 'n' : 'n^' + top.exp
  return 'O(' + base + (top.log ? ' log n' : '') + ')'
}

function nextGreater(nums) {
  const result = new Array(nums.length).fill(-1)
  const stack = []

  for (let i = 0; i < nums.length; i++) {
    while (stack.length && nums[stack[stack.length - 1]] < nums[i]) {
      result[stack.pop()] = nums[i]
    }
    stack.push(i)
  }

  return result
}`,
  tests: `${L1S1}\n${L1S2}\n${L1S3}`
}

/* ============================================================ 第 2 关测试 */
const L2S1 = `{
  var node = (v, l, r) => ({ val: v, left: l || null, right: r || null })
  check('迭代中序遍历返回升序序列', () => {
    const root = node(2, node(1), node(3))
    same(inorderIterative(root), [1, 2, 3])
  })
  check('空树返回空数组', () => {
    same(inorderIterative(null), [])
  })
  check('深层链不会爆栈（迭代而非递归）', () => {
    let root = node(10)
    for (let v = 9; v >= 1; v--) root = node(v, null, root)
    same(inorderIterative(root), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })
  check('合法的 BST 判定为 true', () => {
    same(isBST(node(5, node(3, node(2), node(4)), node(8, node(7), node(9)))), true)
  })
  check('局部合法但全局非法的树判定为 false（必须用上下界/中序）', () => {
    const bad = node(5, node(1), node(4, node(3), node(6)))
    same(isBST(bad), false)
  })
}`

const L2S2 = `{
  check('push 后 peek 是最小值', () => {
    const h = createMinHeap()
    h.push(5); h.push(1); h.push(3)
    same(h.peek(), 1)
    same(h.size(), 3)
  })
  check('pop 按升序吐出', () => {
    const h = createMinHeap()
    for (const v of [7, 2, 9, 4, 1]) h.push(v)
    same([h.pop(), h.pop(), h.pop(), h.pop(), h.pop()], [1, 2, 4, 7, 9])
  })
  check('空堆 pop 返回 undefined', () => {
    const h = createMinHeap()
    same(h.pop(), undefined)
    same(h.size(), 0)
  })
  check('kthLargest 用大小为 k 的小顶堆', () => {
    same(kthLargest([3, 2, 1, 5, 6, 4], 2), 5)
  })
  check('kthLargest 处理重复元素', () => {
    same(kthLargest([3, 4, 4, 2], 1), 4)
    same(kthLargest([1, 1, 1], 2), 1)
  })
}`

const L2S3 = `{
  var node = (v, l, r) => ({ val: v, left: l || null, right: r || null })
  check('右旋：左孩子上位，原根下移为右孩子', () => {
    const y = node(3, node(2, node(1), null), null)
    const x = rotateRight(y)
    same(x.val, 2)
    same(x.right.val, 3)
    same(x.left.val, 1)
  })
  check('链式插入 1..7 后 AVL 自动平衡到根 4、高度 3', () => {
    let root = null
    for (let v = 1; v <= 7; v++) root = insertAVL(root, v)
    same(root.val, 4)
    same(root.h, 3)
  })
  check('LR 双旋：先左旋左孩子再右旋', () => {
    let root = null
    for (const v of [3, 1, 2]) root = insertAVL(root, v)
    same(root.val, 2)
    same(root.left.val, 1)
    same(root.right.val, 3)
  })
  check('AVL 插入后中序仍有序', () => {
    let root = null
    for (const v of [5, 2, 8, 1, 3, 7, 9, 4, 6]) root = insertAVL(root, v)
    same(inorderIterative(root), [1, 2, 3, 4, 5, 6, 7, 8, 9])
  })
  check('每个节点的平衡因子绝对值都不超过 1', () => {
    let root = null
    for (const v of [10, 20, 30, 40, 50, 25]) root = insertAVL(root, v)
    const walk = (n, acc) => {
      if (!n) return acc
      walk(n.left, acc); acc.push(balanceFactor(n)); walk(n.right, acc)
      return acc
    }
    same(walk(root, []).every((b) => Math.abs(b) <= 1), true)
  })
}`

/* ============================================================ 第 2 关 */
const LV2 = {
  id: 'lv2',
  title: '树的三条硬线：遍历、BST、平衡',
  emoji: '🌳',
  xp: 50,
  goal: '实现 inorderIterative(root) 迭代中序、isBST(root) 正确校验二叉搜索树、createMinHeap() 手写小顶堆与 kthLargest、insertAVL 完成四种旋转。',
  why: '树这一章的面试题有一个共同陷阱：**看起来对但漏了边界**。中序递归在深链上爆栈；BST 用「左右孩子大小」判断会在局部合法的反例上翻车；堆写不对 sift 就退化成 O(n) 的线性扫描；AVL 忘了高度更新就永远不触发旋转。这个关卡把四个陷阱各留了一个测试。',
  nodes: ['cs.algo.tree', 'cs.algo.tree.balanced-tree', 'cs.algo.tree.heap-topk', 'cs.algo.tree.traversal-bst'],
  thinking: [
    {
      title: '迭代中序：栈模拟递归的「回退点」',
      md: '递归中序的顺序是：一路向左 → 访问自己 → 转向右子树。迭代版把「一路向左」变成压栈，出栈即访问，然后再把当前指针指向右孩子重复。\n\n这个模板是所有「迭代版遍历」的母版：前序只需把访问提前到压栈时，后序需要额外记录「是否已访问右子树」。'
    },
    {
      title: 'BST 的判定必须带上下界',
      md: '只检查 `left.val < node.val < right.val` 是不够的：`[5,1,4,null,null,3,6]` 里 4 是 5 的右孩子、3 是 4 的左孩子——局部都合法，但 3 在 5 的右子树里却比 5 小。\n\n两种正确写法：① 递归带 (min, max) 开区间；② 中序遍历必须严格递增。本关用②，因为它同时复用了迭代中序。'
    },
    {
      title: '堆只需要保证「堆序」，不需要全局有序',
      md: '小顶堆只保证父 ≤ 子，所以 pop 只需交换堆顶与末尾、弹掉末尾、再 sift-down。push 则 append 后 sift-up。\n\n`kthLargest` 的技巧是用**大小为 k 的小顶堆**：堆顶是当前 k 个最大里的最小者，遍历完数组后堆顶就是第 k 大。复杂度 O(n log k)，比全排序 O(n log n) 更优。'
    }
  ],
  prereq: [
    {
      title: 'AVL 的四种失衡与旋转',
      md: 'LL（左左）：右旋一次；RR（右右）：左旋一次；LR（左右）：先对左孩子左旋，再对根右旋；RL（右左）：先对右孩子右旋，再对根左旋。\n\n判断哪种失衡看「新插入的值落在哪」：比失衡节点的左孩子小 → LL；比左孩子大 → LR。旋转后必须**先更新下移的节点、再更新上移的节点**，因为后者的高度依赖前者。'
    },
    {
      title: '红黑树与 AVL 的取舍',
      md: 'AVL 严格平衡（高度差 ≤ 1），查询更快但插入/删除旋转更频繁；红黑树最多 2 倍高度差，插入删除的摊还旋转次数少，适合写多的场景（所以 Java TreeMap、C++ map 用红黑树，而内存数据库索引常用 AVL/B 树）。\n\n面试常问「为什么 HashMap 树化用红黑树不用 AVL」：因为 HashMap 的读多写也多，红黑树旋转成本更低。'
    }
  ],
  api: [
    {
      name: 'inorderIterative / isBST',
      sig: 'inorderIterative(root) => number[]；isBST(root) => boolean',
      args: 'root 是 { val, left, right } 或 null。',
      returns: '中序序列数组；是否是合法 BST（严格递增）。',
      example: 'inorderIterative(node(2, node(1), node(3)))  // [1, 2, 3]'
    },
    {
      name: 'createMinHeap / kthLargest',
      sig: 'createMinHeap() => { push(v), pop(), peek(), size() }；kthLargest(nums, k) => number',
      args: 'nums 是整数数组，k 从 1 开始。',
      returns: '堆对象；第 k 大的值。',
      example: 'kthLargest([3, 2, 1, 5, 6, 4], 2)  // 5'
    },
    {
      name: 'insertAVL / rotateRight / rotateLeft / balanceFactor',
      sig: 'insertAVL(root, val) => node；rotateRight(y) => node；balanceFactor(n) => number',
      args: '节点形如 { val, left, right, h }（h 是高度）。',
      returns: '插入并平衡后的新根；旋转后的新根。',
      example: 'let root = null\nfor (let v = 1; v <= 7; v++) root = insertAVL(root, v)\n// root.val === 4, root.h === 3'
    }
  ],
  usage: '// 堆的真实用途：\n//   1) 任务调度（每次取最早到期的任务）\n//   2) 流式数据的中位数（大顶堆 + 小顶堆各存一半）\n//   3) TopK / 排行榜（大小 k 的小顶堆，内存 O(k)）\n// 注意：JS 没有内置堆，这就是手写它的原因',
  hints: [
    '第 1 步：中序模板 `while (cur || stack.length)`；isBST 复用同一模板，用 prev 记录上一个访问值。',
    '第 2 步：sift-up 从末尾往根比，sift-down 从根往孩子比；kthLargest 里 push 后若 size > k 就 pop。',
    '第 3 步：update(n) 先算高度再判断平衡；四种失衡用两个 if 组合，注意双旋的先后顺序。'
  ],
  concepts: [
    {
      title: '为什么堆用数组而不是链式结构',
      md: '数组的完全二叉树形态让父子关系变成下标运算（`2i+1`、`2i+2`、`(i-1)>>1`），不需要存指针，缓存友好。\n\n代价是「只能在末尾增删」，但这恰好匹配堆的操作模式：push 追加、pop 换末尾。'
    },
    {
      title: '平衡树的高度为什么是 log n',
      md: 'AVL 每层至少保留一半节点（最坏情况下高度约 1.44 log n），红黑树高度 ≤ 2 log(n+1)。所以查找、插入、删除都是 O(log n)。\n\n对比：普通 BST 在有序插入时退化成链，高度 n，所有操作变 O(n)——这就是数据库索引不用普通 BST 的原因（B+ 树用多叉把高度压到 3~4 层）。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '迭代中序 + BST 校验',
      think: '先把迭代遍历写对（栈 + 当前指针双变量），再在同一个模板上加 prev 判断严格递增。注意 BST 判定不能用「左右孩子比较」的写法。',
      hint: '内层 while (cur) 压左链；弹出即访问；cur = cur.right。prev 用 undefined 区分「还没访问过」。',
      code: `function inorderIterative(root) {
  const out = []
  const stack = []
  let cur = root
  while (cur || stack.length) {
    while (cur) { stack.push(cur); cur = cur.left }
    cur = stack.pop()
    out.push(cur.val)
    cur = cur.right
  }
  return out
}

function isBST(root) {
  const stack = []
  let cur = root
  let prev
  while (cur || stack.length) {
    while (cur) { stack.push(cur); cur = cur.left }
    cur = stack.pop()
    if (prev !== undefined && cur.val <= prev) return false
    prev = cur.val
    cur = cur.right
  }
  return true
}`,
      test: L2S1,
      diag: [
        '只压栈不弹栈（或弹出后没有 cur = cur.right），死循环。',
        'isBST 写成比较左右孩子，反例 [5,1,4,null,null,3,6] 判定为 true。',
        'isBST 用 < 而不是 <=，重复值被当成合法 BST。',
        'prev 初始化为 0，遇到负数节点直接误判。',
        'inorderIterative 里 cur 覆盖了函数的 root 参数，循环条件写成 while (root)。'
      ]
    },
    {
      n: 2,
      title: '手写小顶堆与 TopK',
      think: '堆的核心只有 sift-up 和 sift-down 两个动作。TopK 不是「先取 k 个再排序」，而是维护一个大小为 k 的堆，让堆顶始终是「当前第 k 大」。',
      hint: 'push: append + up(len-1)；pop: 交换首尾、pop 末尾、down(0)。kthLargest 遍历时 push，size > k 就 pop。',
      code: `function inorderIterative(root) {
  const out = []
  const stack = []
  let cur = root
  while (cur || stack.length) {
    while (cur) { stack.push(cur); cur = cur.left }
    cur = stack.pop()
    out.push(cur.val)
    cur = cur.right
  }
  return out
}

function isBST(root) {
  const stack = []
  let cur = root
  let prev
  while (cur || stack.length) {
    while (cur) { stack.push(cur); cur = cur.left }
    cur = stack.pop()
    if (prev !== undefined && cur.val <= prev) return false
    prev = cur.val
    cur = cur.right
  }
  return true
}

function createMinHeap() {
  const a = []
  const swap = (i, j) => { const t = a[i]; a[i] = a[j]; a[j] = t }
  const up = (i) => {
    while (i > 0) {
      const p = (i - 1) >> 1
      if (a[p] <= a[i]) break
      swap(i, p)
      i = p
    }
  }
  const down = (i) => {
    const n = a.length
    for (;;) {
      let s = i
      const l = 2 * i + 1
      const r = 2 * i + 2
      if (l < n && a[l] < a[s]) s = l
      if (r < n && a[r] < a[s]) s = r
      if (s === i) break
      swap(i, s)
      i = s
    }
  }
  return {
    push(v) { a.push(v); up(a.length - 1); return this },
    pop() {
      if (!a.length) return undefined
      swap(0, a.length - 1)
      const top = a.pop()
      down(0)
      return top
    },
    peek() { return a[0] },
    size() { return a.length }
  }
}

function kthLargest(nums, k) {
  const h = createMinHeap()
  for (const v of nums) {
    h.push(v)
    if (h.size() > k) h.pop()
  }
  return h.peek()
}`,
      test: L2S2,
      diag: [
        'sift-down 只比较左孩子，右孩子更小时漏掉。',
        'pop 先 pop 末尾再 down，把堆顶弄丢（必须先交换）。',
        'kthLargest 维护的是大顶堆，堆顶变成第 k 小。',
        'kthLargest 里 size > k 用 >=，最后堆只剩 k-1 个。',
        '空堆 pop 没做保护，返回 undefined 变成抛错。'
      ]
    },
    {
      n: 3,
      title: 'AVL：插入 + 四种旋转',
      think: '递归插入后从底向上更新高度、算平衡因子，失衡时按「新值落在哪」选单旋或双旋。旋转函数自己负责更新高度，插入函数只负责选旋转。',
      hint: 'update(n) = 1 + max(h(left), h(right))；bf = h(left) - h(right)；LL→右旋，RR→左旋，LR/RL 先旋孩子。',
      code: `function inorderIterative(root) {
  const out = []
  const stack = []
  let cur = root
  while (cur || stack.length) {
    while (cur) { stack.push(cur); cur = cur.left }
    cur = stack.pop()
    out.push(cur.val)
    cur = cur.right
  }
  return out
}

function isBST(root) {
  const stack = []
  let cur = root
  let prev
  while (cur || stack.length) {
    while (cur) { stack.push(cur); cur = cur.left }
    cur = stack.pop()
    if (prev !== undefined && cur.val <= prev) return false
    prev = cur.val
    cur = cur.right
  }
  return true
}

function createMinHeap() {
  const a = []
  const swap = (i, j) => { const t = a[i]; a[i] = a[j]; a[j] = t }
  const up = (i) => {
    while (i > 0) {
      const p = (i - 1) >> 1
      if (a[p] <= a[i]) break
      swap(i, p)
      i = p
    }
  }
  const down = (i) => {
    const n = a.length
    for (;;) {
      let s = i
      const l = 2 * i + 1
      const r = 2 * i + 2
      if (l < n && a[l] < a[s]) s = l
      if (r < n && a[r] < a[s]) s = r
      if (s === i) break
      swap(i, s)
      i = s
    }
  }
  return {
    push(v) { a.push(v); up(a.length - 1); return this },
    pop() {
      if (!a.length) return undefined
      swap(0, a.length - 1)
      const top = a.pop()
      down(0)
      return top
    },
    peek() { return a[0] },
    size() { return a.length }
  }
}

function kthLargest(nums, k) {
  const heap = createMinHeap()
  for (const v of nums) {
    heap.push(v)
    if (heap.size() > k) heap.pop()
  }
  return heap.peek()
}

const h = (n) => (n ? n.h : 0)

function update(n) {
  n.h = 1 + Math.max(h(n.left), h(n.right))
}

function balanceFactor(n) {
  return n ? h(n.left) - h(n.right) : 0
}

function rotateRight(y) {
  const x = y.left
  y.left = x.right
  x.right = y
  update(y)
  update(x)
  return x
}

function rotateLeft(x) {
  const y = x.right
  x.right = y.left
  y.left = x
  update(x)
  update(y)
  return y
}

function insertAVL(root, val) {
  if (!root) return { val, left: null, right: null, h: 1 }
  if (val < root.val) root.left = insertAVL(root.left, val)
  else if (val > root.val) root.right = insertAVL(root.right, val)
  else return root

  update(root)
  const b = balanceFactor(root)
  if (b > 1 && val < root.left.val) return rotateRight(root)
  if (b < -1 && val > root.right.val) return rotateLeft(root)
  if (b > 1 && val > root.left.val) {
    root.left = rotateLeft(root.left)
    return rotateRight(root)
  }
  if (b < -1 && val < root.right.val) {
    root.right = rotateRight(root.right)
    return rotateLeft(root)
  }
  return root
}`,
      test: L2S3,
      diag: [
        'update 写成 1 + h(left) + h(right)（高度不是节点数）。',
        '旋转后先更新上移的节点再更新下移的节点，高度算错。',
        '双旋只做了一次单旋（LR 直接右旋，没有先左旋孩子）。',
        '平衡因子符号方向反了（left - right 写成 right - left），旋转方向全反。',
        '插入后忘了 update(root)，平衡因子永远基于旧高度。'
      ]
    }
  ],
  skeleton: `function inorderIterative(root) {
  // TODO: 栈模拟递归
  throw new Error('inorderIterative 还没实现')
}

function isBST(root) {
  // TODO: 中序严格递增；或递归带上下界
  throw new Error('isBST 还没实现')
}

function createMinHeap() {
  // TODO: 数组实现小顶堆：push / pop / peek / size
  throw new Error('createMinHeap 还没实现')
}

function kthLargest(nums, k) {
  // TODO: 大小为 k 的小顶堆
  throw new Error('kthLargest 还没实现')
}

function insertAVL(root, val) {
  // TODO: 递归插入 + 更新高度 + 四种旋转
  throw new Error('insertAVL 还没实现')
}`,
  solution: `const h = (n) => (n ? n.h : 0)

function update(n) {
  n.h = 1 + Math.max(h(n.left), h(n.right))
}

function balanceFactor(n) {
  return n ? h(n.left) - h(n.right) : 0
}

function rotateRight(y) {
  const x = y.left
  y.left = x.right
  x.right = y
  update(y)
  update(x)
  return x
}

function rotateLeft(x) {
  const y = x.right
  x.right = y.left
  y.left = x
  update(x)
  update(y)
  return y
}

function insertAVL(root, val) {
  if (!root) return { val, left: null, right: null, h: 1 }
  if (val < root.val) root.left = insertAVL(root.left, val)
  else if (val > root.val) root.right = insertAVL(root.right, val)
  else return root

  update(root)
  const b = balanceFactor(root)
  if (b > 1 && val < root.left.val) return rotateRight(root)
  if (b < -1 && val > root.right.val) return rotateLeft(root)
  if (b > 1 && val > root.left.val) {
    root.left = rotateLeft(root.left)
    return rotateRight(root)
  }
  if (b < -1 && val < root.right.val) {
    root.right = rotateRight(root.right)
    return rotateLeft(root)
  }
  return root
}

function inorderIterative(root) {
  const out = []
  const stack = []
  let cur = root
  while (cur || stack.length) {
    while (cur) { stack.push(cur); cur = cur.left }
    cur = stack.pop()
    out.push(cur.val)
    cur = cur.right
  }
  return out
}

function isBST(root) {
  const stack = []
  let cur = root
  let prev
  while (cur || stack.length) {
    while (cur) { stack.push(cur); cur = cur.left }
    cur = stack.pop()
    if (prev !== undefined && cur.val <= prev) return false
    prev = cur.val
    cur = cur.right
  }
  return true
}

function createMinHeap() {
  const a = []
  const swap = (i, j) => { const t = a[i]; a[i] = a[j]; a[j] = t }
  const up = (i) => {
    while (i > 0) {
      const p = (i - 1) >> 1
      if (a[p] <= a[i]) break
      swap(i, p)
      i = p
    }
  }
  const down = (i) => {
    const n = a.length
    for (;;) {
      let s = i
      const l = 2 * i + 1
      const r = 2 * i + 2
      if (l < n && a[l] < a[s]) s = l
      if (r < n && a[r] < a[s]) s = r
      if (s === i) break
      swap(i, s)
      i = s
    }
  }
  return {
    push(v) { a.push(v); up(a.length - 1); return this },
    pop() {
      if (!a.length) return undefined
      swap(0, a.length - 1)
      const top = a.pop()
      down(0)
      return top
    },
    peek() { return a[0] },
    size() { return a.length }
  }
}

function kthLargest(nums, k) {
  const heap = createMinHeap()
  for (const v of nums) {
    heap.push(v)
    if (heap.size() > k) heap.pop()
  }
  return heap.peek()
}`,
  finalCode: `const h = (n) => (n ? n.h : 0)

function update(n) {
  n.h = 1 + Math.max(h(n.left), h(n.right))
}

function balanceFactor(n) {
  return n ? h(n.left) - h(n.right) : 0
}

function rotateRight(y) {
  const x = y.left
  y.left = x.right
  x.right = y
  update(y)
  update(x)
  return x
}

function rotateLeft(x) {
  const y = x.right
  x.right = y.left
  y.left = x
  update(x)
  update(y)
  return y
}

function insertAVL(root, val) {
  if (!root) return { val, left: null, right: null, h: 1 }
  if (val < root.val) root.left = insertAVL(root.left, val)
  else if (val > root.val) root.right = insertAVL(root.right, val)
  else return root

  update(root)
  const b = balanceFactor(root)
  if (b > 1 && val < root.left.val) return rotateRight(root)
  if (b < -1 && val > root.right.val) return rotateLeft(root)
  if (b > 1 && val > root.left.val) {
    root.left = rotateLeft(root.left)
    return rotateRight(root)
  }
  if (b < -1 && val < root.right.val) {
    root.right = rotateRight(root.right)
    return rotateLeft(root)
  }
  return root
}

function inorderIterative(root) {
  const out = []
  const stack = []
  let cur = root
  while (cur || stack.length) {
    while (cur) { stack.push(cur); cur = cur.left }
    cur = stack.pop()
    out.push(cur.val)
    cur = cur.right
  }
  return out
}

function isBST(root) {
  const stack = []
  let cur = root
  let prev
  while (cur || stack.length) {
    while (cur) { stack.push(cur); cur = cur.left }
    cur = stack.pop()
    if (prev !== undefined && cur.val <= prev) return false
    prev = cur.val
    cur = cur.right
  }
  return true
}

function createMinHeap() {
  const a = []
  const swap = (i, j) => { const t = a[i]; a[i] = a[j]; a[j] = t }
  const up = (i) => {
    while (i > 0) {
      const p = (i - 1) >> 1
      if (a[p] <= a[i]) break
      swap(i, p)
      i = p
    }
  }
  const down = (i) => {
    const n = a.length
    for (;;) {
      let s = i
      const l = 2 * i + 1
      const r = 2 * i + 2
      if (l < n && a[l] < a[s]) s = l
      if (r < n && a[r] < a[s]) s = r
      if (s === i) break
      swap(i, s)
      i = s
    }
  }
  return {
    push(v) { a.push(v); up(a.length - 1); return this },
    pop() {
      if (!a.length) return undefined
      swap(0, a.length - 1)
      const top = a.pop()
      down(0)
      return top
    },
    peek() { return a[0] },
    size() { return a.length }
  }
}

function kthLargest(nums, k) {
  const heap = createMinHeap()
  for (const v of nums) {
    heap.push(v)
    if (heap.size() > k) heap.pop()
  }
  return heap.peek()
}`,
  tests: `${L2S1}\n${L2S2}\n${L2S3}`
}

/* ============================================================ 第 3 关测试 */
const L3S1 = `{
  check('union 之后两点连通（双向）', () => {
    const dsu = createDSU(5)
    dsu.union(0, 1)
    same(dsu.connected(0, 1), true)
    same(dsu.connected(1, 0), true)
  })
  check('没有合并过的点不连通', () => {
    const dsu = createDSU(5)
    same(dsu.connected(0, 1), false)
  })
  check('合并已连通的两点返回 false（说明这条边会成环）', () => {
    const dsu = createDSU(3)
    same(dsu.union(0, 1), true)
    same(dsu.union(1, 2), true)
    same(dsu.union(0, 2), false)
  })
  check('countComponents 数出连通分量个数', () => {
    same(countComponents(5, [[0, 1], [1, 2], [3, 4]]), 2)
    same(countComponents(3, []), 3)
  })
  check('多次合并后 find 仍正确（路径压缩不影响结果）', () => {
    const dsu = createDSU(6)
    dsu.union(0, 1)
    dsu.union(2, 3)
    dsu.union(1, 2)
    dsu.union(4, 5)
    same(dsu.connected(0, 3), true)
    same(dsu.connected(0, 4), false)
    same(dsu.find(0), dsu.find(3))
  })
}`

const L3S2 = `{
  check('简单 DAG 的拓扑序满足所有边的方向', () => {
    const order = topoSort(4, [[0, 1], [0, 2], [1, 3], [2, 3]])
    same(order.length, 4)
    ok(order.indexOf(0) < order.indexOf(1), '0 必须在 1 前')
    ok(order.indexOf(1) < order.indexOf(3), '1 必须在 3 前')
    ok(order.indexOf(2) < order.indexOf(3), '2 必须在 3 前')
  })
  check('有环的图无法拓扑排序，返回 null', () => {
    same(topoSort(3, [[0, 1], [1, 2], [2, 0]]), null)
  })
  check('孤立节点也要出现在结果里', () => {
    const order = topoSort(3, [[0, 1]])
    same(order.length, 3)
    ok(order.includes(2))
  })
  check('Kruskal 求最小生成树的总权重', () => {
    const mst = kruskalMST(3, [[0, 1, 1], [1, 2, 2], [0, 2, 3]])
    same(mst.weight, 3)
    same(mst.edges.length, 2)
  })
  check('Kruskal 跳过成环的边，n 个点最多选 n-1 条', () => {
    const mst = kruskalMST(4, [[0, 1, 1], [1, 2, 1], [2, 0, 1], [3, 0, 5]])
    same(mst.edges.length, 3)
    same(mst.weight, 7)
  })
}`

const L3S3 = `{
  check('基本最短路：直接边与中转边都参与比较', () => {
    const d = dijkstra(5, [[0, 1, 4], [0, 2, 1], [2, 1, 2], [1, 3, 1], [2, 3, 5]], 0)
    same([d[0], d[1], d[2], d[3]], [0, 3, 1, 4], '0→2→1→3 = 1+2+1')
  })
  check('不可达节点保持 Infinity', () => {
    const d = dijkstra(4, [[0, 1, 5]], 0)
    same([d[0], d[1]], [0, 5])
    ok(d[2] === Infinity && d[3] === Infinity)
  })
  check('多条路径取最短', () => {
    const d = dijkstra(3, [[0, 1, 10], [0, 2, 1], [2, 1, 2]], 0)
    same(d[1], 3)
  })
  check('起点到自己是 0', () => {
    const d = dijkstra(2, [[0, 1, 7]], 0)
    same(d[0], 0)
  })
  check('零权边也能正确松弛', () => {
    const d = dijkstra(3, [[0, 1, 0], [1, 2, 0]], 0)
    same([d[0], d[1], d[2]], [0, 0, 0])
  })
}`

/* ============================================================ 第 3 关代码 */
const L3_CODE1 = `function createDSU(n) {
  const parent = []
  const rank = []
  for (let i = 0; i < n; i++) { parent[i] = i; rank[i] = 0 }

  const find = (x) => {
    let root = x
    while (parent[root] !== root) root = parent[root]
    while (parent[x] !== x) {
      const next = parent[x]
      parent[x] = root
      x = next
    }
    return root
  }

  return {
    find,
    union(a, b) {
      let ra = find(a)
      let rb = find(b)
      if (ra === rb) return false
      if (rank[ra] < rank[rb]) { const t = ra; ra = rb; rb = t }
      parent[rb] = ra
      if (rank[ra] === rank[rb]) rank[ra]++
      return true
    },
    connected(a, b) { return find(a) === find(b) }
  }
}

function countComponents(n, edges) {
  const dsu = createDSU(n)
  for (const e of edges) dsu.union(e[0], e[1])
  const roots = new Set()
  for (let i = 0; i < n; i++) roots.add(dsu.find(i))
  return roots.size
}`

const L3_CODE2 = `${L3_CODE1}

function topoSort(n, edges) {
  const adj = []
  const indeg = new Array(n).fill(0)
  for (let i = 0; i < n; i++) adj.push([])
  for (const e of edges) {
    adj[e[0]].push(e[1])
    indeg[e[1]]++
  }

  const queue = []
  for (let i = 0; i < n; i++) if (indeg[i] === 0) queue.push(i)

  const out = []
  for (let head = 0; head < queue.length; head++) {
    const u = queue[head]
    out.push(u)
    for (const v of adj[u]) {
      if (--indeg[v] === 0) queue.push(v)
    }
  }

  return out.length === n ? out : null
}

function kruskalMST(n, edges) {
  const sorted = edges.slice().sort((a, b) => a[2] - b[2])
  const dsu = createDSU(n)
  const picked = []
  let weight = 0

  for (const e of sorted) {
    if (dsu.union(e[0], e[1])) {
      picked.push(e)
      weight += e[2]
    }
  }

  return { weight, edges: picked }
}`

const L3_CODE3 = `${L3_CODE2}

function dijkstra(n, edges, src) {
  const adj = []
  for (let i = 0; i < n; i++) adj.push([])
  for (const e of edges) {
    adj[e[0]].push([e[1], e[2]])
    adj[e[1]].push([e[0], e[2]])
  }

  const dist = new Array(n).fill(Infinity)
  dist[src] = 0

  const heap = []
  const push = (item) => {
    heap.push(item)
    let i = heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heap[p][0] <= heap[i][0]) break
      const t = heap[p]; heap[p] = heap[i]; heap[i] = t
      i = p
    }
  }
  const pop = () => {
    const top = heap[0]
    const last = heap.pop()
    if (heap.length) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let s = i
        if (l < heap.length && heap[l][0] < heap[s][0]) s = l
        if (r < heap.length && heap[r][0] < heap[s][0]) s = r
        if (s === i) break
        const tmp = heap[s]; heap[s] = heap[i]; heap[i] = tmp
        i = s
      }
    }
    return top
  }

  push([0, src])
  while (heap.length) {
    const top = pop()
    const d = top[0]
    const u = top[1]
    if (d > dist[u]) continue
    for (const edge of adj[u]) {
      const v = edge[0]
      const w = edge[1]
      const nd = d + w
      if (nd < dist[v]) {
        dist[v] = nd
        push([nd, v])
      }
    }
  }

  return dist
}`

/* ============================================================ 第 3 关 */
const LV3 = {
  id: 'lv3',
  title: '图的三条主线：连通、排序、最短路',
  emoji: '🕸️',
  xp: 50,
  goal: '实现 createDSU(n) 并查集（路径压缩 + 按秩合并）与 countComponents、topoSort（Kahn + 环检测）、kruskalMST（最小生成树）、dijkstra（非负权最短路，二叉堆优化）。',
  why: '图论题目在面试里几乎都以「变形题」出现：朋友圈、岛屿数量、课程表、网络延迟时间、最小费用连通。它们分别对应并查集、拓扑排序、Dijkstra / Kruskal。把这四个模板手写一遍，变形题就只剩「把业务描述翻译成边」这一步。',
  nodes: ['cs.algo.graph', 'cs.algo.graph.dsu', 'cs.algo.graph.mst-topo', 'cs.algo.graph.shortest-path'],
  thinking: [
    {
      title: '并查集只有两个动作，但两个优化都要有',
      md: '`find` 沿父指针找到根；`union` 把两个根连起来。优化一：**路径压缩**（find 时把沿途节点直接挂到根上）；优化二：**按秩/按大小合并**（矮树挂到高树下）。\n\n两个都做，摊还复杂度是 O(α(n))，接近常数。只做路径压缩也能过题，但面试追问「为什么接近 O(1)」时要能说出 α 是反阿克曼函数。'
    },
    {
      title: '拓扑排序与 MST 的共同点：都在「按序选边」',
      md: 'Kahn 拓扑排序维护入度为 0 的队列，每次弹出一个、把邻居入度减一——本质是「不断删除没有前驱的点」。\n\nKruskal 维护并查集，按权重从小到大扫边，不成环就选——本质是「不断选不产生环的最便宜边」。一个用入度队列，一个用并查集，但都在回答「在这张图上以什么顺序处理边」。'
    },
    {
      title: 'Dijkstra 为什么不能有负权',
      md: 'Dijkstra 的正确性依赖一个前提：**一旦某个点被弹出堆，它的距离就再也不会变小**。这个前提成立的条件是所有边权非负——因为负权边可能让「已经确定」的点通过后面绕回来的路径变短。\n\n有负权要用 Bellman-Ford（O(VE)）或 SPFA；有负环则最短路径不存在（可以无限绕）。这就是「为什么地图导航用 Dijkstra，而套利检测用 Bellman-Ford」的原因。'
    }
  ],
  prereq: [
    {
      title: '图的三种存储方式与选型',
      md: '邻接矩阵适合稠密图（O(V^2) 空间，查边 O(1)）；邻接表适合稀疏图（O(V+E) 空间，遍历邻居 O(deg)）；边集数组适合 Kruskal（只关心边，按权重排序即可）。\n\n本关的 `edges: [[u, v, w]]` 就是边集数组，`dijkstra` 内部再转成邻接表——这是面试里最常见的输入形态。'
    },
    {
      title: '最小生成树 vs 最短路',
      md: 'MST 要「连通所有点且总权重最小」，不关心任意两点间距离；最短路要「从源点到各点距离最小」，不要求用最少总边权连所有点。\n\n所以同一张图上 MST 的总权重和最短路树的总权重通常不同；而且 MST 在全图连通时才有解，最短路允许不可达（Infinity）。'
    }
  ],
  api: [
    {
      name: 'createDSU / countComponents',
      sig: 'createDSU(n) => { find(x), union(a, b), connected(a, b) }；countComponents(n, edges) => number',
      args: 'n 是节点数（0..n-1）；edges 是 [[u, v]] 无向边。',
      returns: 'union 返回是否真的合并（false 表示已成环）；connected 返回布尔；countComponents 返回连通分量个数。',
      example: 'const dsu = createDSU(3)\ndsu.union(0, 1)     // true\ndsu.union(0, 1)     // false，已经在同一集合'
    },
    {
      name: 'topoSort / kruskalMST',
      sig: 'topoSort(n, edges) => number[] | null；kruskalMST(n, edges) => { weight, edges }',
      args: 'topoSort 的 edges 是 [[u, v]] 有向边；kruskalMST 的 edges 是 [[u, v, w]] 无向边。',
      returns: 'topoSort：合法拓扑序，有环返回 null；kruskalMST：MST 总权重与被选中的边。',
      example: 'topoSort(4, [[0,1],[0,2],[1,3],[2,3]])  // [0,2,1,3] 之类\nkruskalMST(3, [[0,1,1],[1,2,2],[0,2,3]])    // { weight: 3, edges: [...] }'
    },
    {
      name: 'dijkstra',
      sig: 'dijkstra(n, edges, src) => number[]',
      args: 'n 是节点数，edges 是 [[u, v, w]]（w ≥ 0，无向），src 是起点。',
      returns: '长度为 n 的距离数组，不可达为 Infinity。',
      example: 'dijkstra(4, [[0,1,5]], 0)  // [0, 5, Infinity, Infinity]'
    }
  ],
  usage: '// 业务映射：\n//   好友关系/账号合并         → 并查集\n//   课程先修/构建依赖/任务编排 → 拓扑排序\n//   建网线/修路的最省方案       → Kruskal / Prim\n//   导航最短时间/网络延迟       → Dijkstra（非负权）',
  hints: [
    '第 1 步：find 两趟（先找根、再压缩），union 比较 rank 后挂根。',
    '第 2 步：Kahn 用入度数组 + 队列，输出长度 ≠ n 就是有环；Kruskal 排序边后逐个 union，成功才计入。',
    '第 3 步：堆里存 [distance, node]，弹出时若 d > dist[u] 就跳过（过期项）；松弛成功才入堆。'
  ],
  concepts: [
    {
      title: '为什么 Kruskal 用并查集、Prim 用堆',
      md: 'Kruskal 从全局边集里挑最便宜的，只需要判断「这条边会不会成环」——并查集 O(α)。Prim 从一个点开始往外扩，需要每次找「连接树内外的最便宜边」——堆。\n\n稀疏图两者都行；稠密图 Prim（O(V^2) 朴素版）常数更小；边已排序的场景 Kruskal 更直接。'
    },
    {
      title: 'Dijkstra 的复杂度与优化',
      md: '朴素版每次线性找最小距离点：O(V^2)；二叉堆优化版：O((V+E) log V)；斐波那契堆理论上 O(E + V log V) 但常数大，工程上不用。\n\n注意「弹出时判 d > dist[u] 跳过」不是可选优化——没有它，同一个点会被重复松弛，复杂度退化。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '并查集：路径压缩 + 按秩合并',
      think: 'find 先爬到根，再把路径上所有点直接挂到根（两趟）。union 比较 rank 决定谁挂谁——矮的挂高的，避免树变高。',
      hint: 'find 里第二趟用 while (parent[x] !== x) 边压缩边前进；union 里 ra/rb 交换用临时变量。',
      code: L3_CODE1,
      test: L3S1,
      diag: [
        'find 只找根没压缩，链长时退化成 O(n)。',
        'union 只改一个点的 parent，没有把根挂到另一个根上（连的是子节点）。',
        'union 没有先判 ra === rb，成环时也返回 true。',
        'countComponents 用 parent[i] 统计而不用 find(i)，压缩后部分节点 parent 不是根。',
        'rank 相等时没有自增，两棵树交替挂导致高度增长。'
      ]
    },
    {
      n: 2,
      title: '拓扑排序与最小生成树',
      think: '两个模板共用「按序处理」的思想：拓扑排序按入度出队，Kruskal 按权重扫边。前者要检测环（输出长度不足），后者要跳过成环边（union 返回 false）。',
      hint: 'topoSort 用 head 指针代替 shift 避免 O(n^2)；kruskalMST 先复制边再排序，不要原地改输入。',
      code: L3_CODE2,
      test: L3S2,
      diag: [
        '拓扑排序用 shift 导致 O(n^2)（测试不卡，但面试会追问）。',
        '入度减到 0 时忘了入队，邻居永远等不到。',
        '输出长度不足 n 时返回部分序列而不是 null（有环没检测出来）。',
        'Kruskal 排序用了 edges.sort，原地改了调用方传入的数组。',
        'Kruskal 把「成环的边」也计入了 weight。'
      ]
    },
    {
      n: 3,
      title: 'Dijkstra：堆优化与过期项',
      think: '三步：初始化 dist、堆里放起点、循环弹出最小距离。关键细节是「弹出时若 d > dist[u] 就跳过」——同一个点可能被重复入堆，跳过旧版本才能保证复杂度。',
      hint: '堆存 [dist, node]；松弛条件 nd < dist[v]；不可达保持 Infinity 不做特殊处理。',
      code: L3_CODE3,
      test: L3S3,
      diag: [
        '忘了「d > dist[u] 就跳过」，过期堆项被重复展开。',
        '松弛条件写成 nd <= dist[v]，零权/等权边反复入堆（甚至死循环）。',
        '把有向边当无向边处理时只加了一条方向（或加了两次反向导致错误）。',
        'dist 初始化为 0 而不是 Infinity，所有点一开始就可达。',
        '不可达点返回 undefined（没有 fill Infinity）。'
      ]
    }
  ],
  skeleton: `function createDSU(n) {
  // TODO: parent + rank；find 路径压缩、union 按秩合并
  throw new Error('createDSU 还没实现')
}

function countComponents(n, edges) {
  // TODO: 用 createDSU 合并后数不同根
  throw new Error('countComponents 还没实现')
}

function topoSort(n, edges) {
  // TODO: Kahn 入度队列；输出不足 n 返回 null
  throw new Error('topoSort 还没实现')
}

function kruskalMST(n, edges) {
  // TODO: 边排序 + 并查集，成环跳过
  throw new Error('kruskalMST 还没实现')
}

function dijkstra(n, edges, src) {
  // TODO: dist + 二叉堆，弹出时跳过过期项
  throw new Error('dijkstra 还没实现')
}`,
  solution: L3_CODE3,
  finalCode: L3_CODE3,
  tests: `${L3S1}\n${L3S2}\n${L3S3}`
}

export default {
  id: 'cs-algo',
  version: 3,
  domain: 'cs',
  cumulative: false,
  title: '算法三连：复杂度、树、图',
  emoji: '🧮',
  tagline: '3 关：主定理与单调栈 → 二叉搜索树/堆/AVL → 并查集/拓扑排序/Dijkstra。',
  stack: ['数据结构与算法'],
  intro: '算法面试考的不是「会不会写」，而是「知不知道为什么这样写」。这个项目把三章最高频的东西拆成可运行的模型：递归式怎么定阶、BST 校验为什么会翻车、堆为什么是 O(n log k)、AVL 为什么必须双旋、并查集的路径压缩省了多少、Dijkstra 为什么不能有负权。',
  outcome: '你能在白板上写出 O(n) 的单调栈、O(n log k) 的 TopK、严格正确的 BST 校验，并用摊还分析解释复杂度。',
  levels: [LV1, LV2, LV3]
}