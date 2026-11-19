/**
 * 项目闯关内容源：Java 后端 · 数据结构、核心机制与并发（3 关 9 步）
 *
 * 判题沙箱只跑 JS，所以这里的 Java 知识点全部落成「可运行的等价模拟器」：
 *   lv1 DSA      —— HashMap 扰动/树化、堆的上浮下沉、栈求值、稳定归并
 *   lv2 核心机制 —— ArrayList 扩容、重载决议（编译期）、String 常量池与 ==
 *   lv3 并发     —— 线程池调度、可重入锁、线程池参数公式与拒绝策略
 *
 * 模拟的是「语义」不是「实现细节」：例如 HashMap 的扰动函数、扩容阈值、树化条件都按 JDK 真实规则写，
 * 但用 JS 对象模拟桶数组。讲解里会标明哪些是 JDK 真实行为、哪些是为了可判题做的简化。
 */

/* ============================================================ 第 1 关测试 */
const L1S1 = `{
  check('扰动函数：高 16 位异或到低 16 位（>>> 是无符号右移）', () => {
    same(spreadHash(0x12345678), (0x12345678 ^ (0x12345678 >>> 16)) >>> 0)
  })
  check('桶下标 = 扰动后 & (capacity-1)：容量为 16 时结果在 0~15', () => {
    const idx = bucketIndex(0x12345678, 16)
    ok(idx >= 0 && idx <= 15, '实际 ' + idx)
  })
  check('树化条件：链表长度 ≥8 且容量 ≥64 才树化', () => {
    same(shouldTreeify(8, 64), true)
    same(shouldTreeify(8, 32), false, '容量不足 64 时只扩容不树化')
    same(shouldTreeify(7, 64), false)
  })
  check('equals/hashCode 契约：equals 相等则 hashCode 必须相等', () => {
    const h = (k) => k.length
    same(equalsHashContract('ab', 'cd', h), true, '长度相同 → 哈希相同')
    same(equalsHashContract('ab', 'c', h), false, 'equals 不等时哈希不同是允许的，但这里验证的是反向契约')
  })
}`

const L1S2 = `{
  check('建小顶堆：父节点一定小于等于子节点', () => {
    const h = buildMinHeap([5, 3, 8, 1, 9, 2])
    for (let i = 1; i < h.length; i++) {
      const parent = (i - 1) >> 1
      ok(h[parent] <= h[i], '索引 ' + i + ' 违反小顶堆性质')
    }
  })
  check('push 后堆性质仍成立，且新元素在正确位置', () => {
    const h = buildMinHeap([5, 3, 8])
    heapPush(h, 1)
    same(h[0], 1, '最小值应到堆顶')
    for (let i = 1; i < h.length; i++) ok(h[(i - 1) >> 1] <= h[i], 'push 后堆坏了')
  })
  check('pop 返回最小值，并把末尾元素下沉到位', () => {
    const h = buildMinHeap([5, 3, 8, 1])
    same(heapPop(h), 1)
    for (let i = 1; i < h.length; i++) ok(h[(i - 1) >> 1] <= h[i], 'pop 后堆坏了')
  })
  check('Top-K：用大小为 k 的小顶堆，返回最大的 k 个（升序）', () => {
    same(topKLargest([3, 1, 5, 12, 2, 11], 3), [5, 11, 12])
  })
}`

const L1S3 = `{
  check('栈求逆波兰表达式：支持四则运算与负数', () => {
    same(evalRPN(['2', '1', '+', '3', '*']), 9)
    same(evalRPN(['4', '13', '5', '/', '+']), 6)
    same(evalRPN(['-2', '3', '*']), -6)
  })
  check('除零按 Java 整数语义：抛错而不是返回 Infinity', () => {
    let threw = false
    try { evalRPN(['1', '0', '/']) } catch { threw = true }
    same(threw, true)
  })
  check('归并排序结果正确且是稳定的', () => {
    same(mergeSort([5, 2, 9, 1]), [1, 2, 5, 9])
    const items = [{ k: 1, v: 'a' }, { k: 0, v: 'b' }, { k: 1, v: 'c' }]
    const sorted = mergeSortBy(items, (x) => x.k)
    same(sorted.map((x) => x.v), ['b', 'a', 'c'], '相同 key 保持原顺序')
  })
  check('链表反转：三指针迭代，空链表与单节点不崩', () => {
    same(reverseList([1, 2, 3]), [3, 2, 1])
    same(reverseList([]), [])
    same(reverseList([1]), [1])
  })
}`

/* ============================================================ 第 1 关 */
const LV1 = {
  id: 'lv1',
  title: '数据结构：哈希、堆、栈与链表',
  emoji: '🌲',
  xp: 50,
  goal: '按 JDK 语义实现四个结构：HashMap 的扰动与树化判定、数组堆的 heapify/push/pop 与 Top-K、逆波兰求值、稳定归并与链表反转。',
  why: '这些是 Java 后端面试的「手写」区：答得出概念但写不对扰动函数、把扩容写成 2 倍、Top-K 用全量排序、归并写成不稳定——都是高频扣分点。这里用可跑的等价模拟把语义钉死。',
  nodes: ['be.java.dsa', 'be.java.dsa.complexity', 'be.java.dsa.hash', 'be.java.dsa.heap', 'be.java.dsa.linear', 'be.java.dsa.sort'],
  thinking: [
    {
      title: 'HashMap 为什么要扰动',
      md: 'JDK 的桶下标是 `(n - 1) & hash`。如果直接用原始 hashCode，低位分布不好时大量 key 会撞到同一个桶。\n\n扰动函数 `h ^ (h >>> 16)` 把高 16 位混进低 16 位，让下标更均匀。树化阈值 8 与最小容量 64 是一对：容量太小（<64）时链表长只说明桶少，应该先扩容而不是树化。'
    },
    {
      title: 'Top-K 为什么用大小为 K 的小顶堆',
      md: '全量排序 O(n log n)；维护 K 大小的小顶堆，遍历一次 O(n log K)。堆顶是当前 K 个里最小的，遇到更大的就替换堆顶并下沉。\n\n注意方向：求「最大 K 个」要用小顶堆（堆顶是门槛），这是最容易写反的地方。'
    }
  ],
  prereq: [
    {
      title: '数组表示完全二叉树',
      md: '下标 i 的父节点是 `(i-1)>>1`，左孩子 `2i+1`，右孩子 `2i+2`。\n\n堆的 push（上浮）与 pop（下沉）都靠这个映射，不需要指针。建堆从最后一个非叶节点 `n/2-1` 开始向前下沉，复杂度 O(n) 而不是 O(n log n)。'
    },
    {
      title: '稳定排序的含义',
      md: '相等元素排序后保持原来的相对顺序。归并排序在 merge 时「左边优先取」即稳定；快排不稳定；TimSort 是归并 + 插入的混合，稳定。\n\nJava 的 `Collections.sort` 用 TimSort，所以对象排序是稳定的；`Arrays.sort` 对基本类型用双轴快排（不稳定，因为基本类型没有「身份」）。'
    }
  ],
  api: [
    {
      name: 'spreadHash / bucketIndex / shouldTreeify',
      sig: 'spreadHash(h) => number；bucketIndex(h, capacity) => number；shouldTreeify(binCount, capacity) => boolean',
      args: 'h 是 hashCode；capacity 是桶数组长度（2 的幂）。',
      returns: '扰动后的哈希、桶下标；链表长度 ≥8 且容量 ≥64 时才树化。',
      example: 'bucketIndex(0x12345678, 16)  // → 0~15'
    },
    {
      name: 'buildMinHeap / heapPush / heapPop / topKLargest',
      sig: 'buildMinHeap(arr) => arr（原地）；heapPush(heap, v)；heapPop(heap) => min；topKLargest(nums, k) => number[]',
      args: 'arr 是普通数组；heap 是维护中的堆数组。',
      returns: '原地建堆；pop 返回堆顶；topK 返回升序的 K 个最大值。',
      example: 'topKLargest([3, 1, 5, 12, 2, 11], 3)  // → [5, 11, 12]'
    },
    {
      name: 'evalRPN / mergeSort / mergeSortBy / reverseList',
      sig: 'evalRPN(tokens) => number；mergeSort(arr) => arr；mergeSortBy(items, keyFn) => items；reverseList(list) => list',
      args: 'tokens 是后缀表达式字符串数组；keyFn 取比较键。',
      returns: '求值结果（除零抛错）；排序后新数组（稳定）；反转后的链表数组。',
      example: 'evalRPN([\'2\', \'1\', \'+\', \'3\', \'*\'])  // → 9'
    }
  ],
  usage: 'const top = topKLargest(hugeList, 10)          // O(n log k)，不要全量排序\nconst h = buildMinHeap([5, 3, 8]); heapPush(h, 1); heapPop(h)\nconst value = evalRPN(tokens)\nconst sorted = mergeSortBy(users, (u) => u.age)  // 稳定：同龄人保持原顺序',
  hints: [
    'spreadHash 记得 >>> 0 转回无符号，否则 >>> 之后仍是 32 位有符号语义。',
    '堆的下沉：从根开始，与较小（小顶堆）的孩子交换，直到满足性质。',
    'evalRPN 里数字入栈，遇到运算符弹出两个（先弹右操作数）；除数为 0 抛错。',
    'mergeSort 的 merge 阶段「<= 时取左边」才是稳定。'
  ],
  concepts: [
    {
      title: '为什么 HashMap 容量是 2 的幂',
      md: '下标用 `hash & (n-1)` 代替取模：只有 n 是 2 的幂时，`n-1` 才是低位全 1 的掩码，`&` 才等价于取模且更快。\n\n这也是为什么扩容必须翻倍（保持 2 的幂），以及为什么 HashMap 构造函数会把传入容量向上取整到 2 的幂。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '先写哈希与树化判定',
      think: '把 JDK 的三条真实规则写死：扰动函数、掩码取下标、树化双条件。这三条是「HashMap 为什么快」的全部答案，比背「数组+链表+红黑树」有用。',
      hint: 'spreadHash = (h ^ (h >>> 16)) >>> 0；下标 = spread & (capacity-1)；树化 = binCount>=8 && capacity>=64。',
      code: `function spreadHash(h) {
  return ((h ^ (h >>> 16)) >>> 0)
}

function bucketIndex(h, capacity) {
  return spreadHash(h) & (capacity - 1)
}

function shouldTreeify(binCount, capacity) {
  return binCount >= 8 && capacity >= 64
}

function equalsHashContract(a, b, hashCode) {
  // 反向契约：如果两个对象 equals，hashCode 必须相等；否则允许不同。
  // 这里用 hashCode 相等性反过来验证：hashCode 不同则 equals 必为 false。
  return hashCode(a) === hashCode(b)
}`,
      test: L1S1,
      diag: [
        'spreadHash 少了 >>> 0，结果是负数。',
        'bucketIndex 用了 % capacity 而不是 & (capacity-1)。',
        '树化条件只判了链表长度，没判容量 ≥64。',
        '契约函数把「equals 不等 → 哈希不同」当成了 violation。'
      ]
    },
    {
      n: 2,
      title: '再写堆与 Top-K',
      think: '堆的全部操作就是上浮/下沉。先写对 build/push/pop，再写 Top-K——注意求最大 K 个要用小顶堆（方向最容易反）。',
      hint: 'build：从 n/2-1 向前 sink；push：append 后 swim；pop：取顶、尾元素放顶、sink；topK：维护大小 k 的小顶堆。',
      code: `function spreadHash(h) {
  return ((h ^ (h >>> 16)) >>> 0)
}

function bucketIndex(h, capacity) {
  return spreadHash(h) & (capacity - 1)
}

function shouldTreeify(binCount, capacity) {
  return binCount >= 8 && capacity >= 64
}

function equalsHashContract(a, b, hashCode) {
  return hashCode(a) === hashCode(b)
}

function sinkDown(heap, i) {
  const n = heap.length
  while (true) {
    let smallest = i
    const l = i * 2 + 1
    const r = i * 2 + 2
    if (l < n && heap[l] < heap[smallest]) smallest = l
    if (r < n && heap[r] < heap[smallest]) smallest = r
    if (smallest === i) break
    ;[heap[i], heap[smallest]] = [heap[smallest], heap[i]]
    i = smallest
  }
}

function sinkUp(heap, i) {
  while (i > 0) {
    const parent = (i - 1) >> 1
    if (heap[parent] <= heap[i]) break
    ;[heap[parent], heap[i]] = [heap[i], heap[parent]]
    i = parent
  }
}

function buildMinHeap(arr) {
  for (let i = (arr.length >> 1) - 1; i >= 0; i--) sinkDown(arr, i)
  return arr
}

function heapPush(heap, value) {
  heap.push(value)
  sinkUp(heap, heap.length - 1)
}

function heapPop(heap) {
  const top = heap[0]
  const last = heap.pop()
  if (heap.length) {
    heap[0] = last
    sinkDown(heap, 0)
  }
  return top
}

function topKLargest(nums, k) {
  if (k <= 0) return []
  const heap = []
  for (const v of nums) {
    heapPush(heap, v)
    if (heap.length > k) heapPop(heap)
  }
  return heap.sort((a, b) => a - b)
}`,
      test: L1S2,
      diag: [
        'sinkDown 比较的是较大孩子（那是大顶堆）或者没交换。',
        'sinkUp 的父节点下标算成了 i/2 而不是 (i-1)>>1。',
        'pop 把末尾元素放回堆顶后忘了下沉。',
        'Top-K 用大顶堆或全量排序，返回的不是升序 K 个。'
      ]
    },
    {
      n: 3,
      title: '最后写栈求值与稳定归并',
      think: '栈求值的坑是操作数顺序（先弹右）；归并的坑是稳定（merge 时相等取左）。链表反转则是最基础的三指针。',
      hint: 'evalRPN：数字入栈，运算符弹 b 再弹 a，push(a op b)。mergeSort：递归切半，merge 时 <= 取左。',
      code: `function spreadHash(h) {
  return ((h ^ (h >>> 16)) >>> 0)
}

function bucketIndex(h, capacity) {
  return spreadHash(h) & (capacity - 1)
}

function shouldTreeify(binCount, capacity) {
  return binCount >= 8 && capacity >= 64
}

function equalsHashContract(a, b, hashCode) {
  return hashCode(a) === hashCode(b)
}

function sinkDown(heap, i) {
  const n = heap.length
  while (true) {
    let smallest = i
    const l = i * 2 + 1
    const r = i * 2 + 2
    if (l < n && heap[l] < heap[smallest]) smallest = l
    if (r < n && heap[r] < heap[smallest]) smallest = r
    if (smallest === i) break
    ;[heap[i], heap[smallest]] = [heap[smallest], heap[i]]
    i = smallest
  }
}

function sinkUp(heap, i) {
  while (i > 0) {
    const parent = (i - 1) >> 1
    if (heap[parent] <= heap[i]) break
    ;[heap[parent], heap[i]] = [heap[i], heap[parent]]
    i = parent
  }
}

function buildMinHeap(arr) {
  for (let i = (arr.length >> 1) - 1; i >= 0; i--) sinkDown(arr, i)
  return arr
}

function heapPush(heap, value) {
  heap.push(value)
  sinkUp(heap, heap.length - 1)
}

function heapPop(heap) {
  const top = heap[0]
  const last = heap.pop()
  if (heap.length) {
    heap[0] = last
    sinkDown(heap, 0)
  }
  return top
}

function topKLargest(nums, k) {
  if (k <= 0) return []
  const heap = []
  for (const v of nums) {
    heapPush(heap, v)
    if (heap.length > k) heapPop(heap)
  }
  return heap.sort((a, b) => a - b)
}

function evalRPN(tokens) {
  const stack = []
  for (const t of tokens) {
    if (!['+', '-', '*', '/'].includes(t)) {
      stack.push(Number(t))
      continue
    }
    const b = stack.pop()
    const a = stack.pop()
    if (t === '+') stack.push(a + b)
    else if (t === '-') stack.push(a - b)
    else if (t === '*') stack.push(a * b)
    else {
      if (b === 0) throw new Error('除数不能为 0（Java 整数除法会抛 ArithmeticException）')
      stack.push(Math.trunc(a / b))
    }
  }
  return stack[0]
}

function mergeSort(arr) {
  if (arr.length <= 1) return arr.slice()
  const mid = arr.length >> 1
  const left = mergeSort(arr.slice(0, mid))
  const right = mergeSort(arr.slice(mid))
  const out = []
  let i = 0
  let j = 0
  while (i < left.length && j < right.length) {
    if (left[i] <= right[j]) out.push(left[i++])
    else out.push(right[j++])
  }
  return out.concat(left.slice(i), right.slice(j))
}

function mergeSortBy(items, keyFn) {
  if (items.length <= 1) return items.slice()
  const mid = items.length >> 1
  const left = mergeSortBy(items.slice(0, mid), keyFn)
  const right = mergeSortBy(items.slice(mid), keyFn)
  const out = []
  let i = 0
  let j = 0
  while (i < left.length && j < right.length) {
    if (keyFn(left[i]) <= keyFn(right[j])) out.push(left[i++])
    else out.push(right[j++])
  }
  return out.concat(left.slice(i), right.slice(j))
}

function reverseList(list) {
  const out = []
  for (let i = list.length - 1; i >= 0; i--) out.push(list[i])
  return out
}`,
      test: L1S3,
      diag: [
        'evalRPN 弹出的两个操作数顺序反了（a、b 颠倒）。',
        '除数为 0 时返回了 Infinity 而不是抛错。',
        'merge 里相等时取了右边，排序变得不稳定。',
        'reverseList 返回了原数组（应该反转），或没处理空数组。'
      ]
    }
  ],
  skeleton: `function spreadHash(h) {
  throw new Error('spreadHash 还没实现')
}
function bucketIndex(h, capacity) {
  throw new Error('bucketIndex 还没实现')
}
function shouldTreeify(binCount, capacity) {
  throw new Error('shouldTreeify 还没实现')
}
function equalsHashContract(a, b, hashCode) {
  throw new Error('equalsHashContract 还没实现')
}
function buildMinHeap(arr) {
  throw new Error('buildMinHeap 还没实现')
}
function heapPush(heap, value) {
  throw new Error('heapPush 还没实现')
}
function heapPop(heap) {
  throw new Error('heapPop 还没实现')
}
function topKLargest(nums, k) {
  throw new Error('topKLargest 还没实现')
}
function evalRPN(tokens) {
  throw new Error('evalRPN 还没实现')
}
function mergeSort(arr) {
  throw new Error('mergeSort 还没实现')
}
function mergeSortBy(items, keyFn) {
  throw new Error('mergeSortBy 还没实现')
}
function reverseList(list) {
  throw new Error('reverseList 还没实现')
}`,
  solution: `function spreadHash(h) {
  return ((h ^ (h >>> 16)) >>> 0)
}

function bucketIndex(h, capacity) {
  return spreadHash(h) & (capacity - 1)
}

function shouldTreeify(binCount, capacity) {
  return binCount >= 8 && capacity >= 64
}

function equalsHashContract(a, b, hashCode) {
  return hashCode(a) === hashCode(b)
}

function sinkDown(heap, i) {
  const n = heap.length
  while (true) {
    let smallest = i
    const l = i * 2 + 1
    const r = i * 2 + 2
    if (l < n && heap[l] < heap[smallest]) smallest = l
    if (r < n && heap[r] < heap[smallest]) smallest = r
    if (smallest === i) break
    ;[heap[i], heap[smallest]] = [heap[smallest], heap[i]]
    i = smallest
  }
}

function sinkUp(heap, i) {
  while (i > 0) {
    const parent = (i - 1) >> 1
    if (heap[parent] <= heap[i]) break
    ;[heap[parent], heap[i]] = [heap[i], heap[parent]]
    i = parent
  }
}

function buildMinHeap(arr) {
  for (let i = (arr.length >> 1) - 1; i >= 0; i--) sinkDown(arr, i)
  return arr
}

function heapPush(heap, value) {
  heap.push(value)
  sinkUp(heap, heap.length - 1)
}

function heapPop(heap) {
  const top = heap[0]
  const last = heap.pop()
  if (heap.length) {
    heap[0] = last
    sinkDown(heap, 0)
  }
  return top
}

function topKLargest(nums, k) {
  if (k <= 0) return []
  const heap = []
  for (const v of nums) {
    heapPush(heap, v)
    if (heap.length > k) heapPop(heap)
  }
  return heap.sort((a, b) => a - b)
}

function evalRPN(tokens) {
  const stack = []
  for (const t of tokens) {
    if (!['+', '-', '*', '/'].includes(t)) {
      stack.push(Number(t))
      continue
    }
    const b = stack.pop()
    const a = stack.pop()
    if (t === '+') stack.push(a + b)
    else if (t === '-') stack.push(a - b)
    else if (t === '*') stack.push(a * b)
    else {
      if (b === 0) throw new Error('除数不能为 0')
      stack.push(Math.trunc(a / b))
    }
  }
  return stack[0]
}

function mergeSort(arr) {
  if (arr.length <= 1) return arr.slice()
  const mid = arr.length >> 1
  const left = mergeSort(arr.slice(0, mid))
  const right = mergeSort(arr.slice(mid))
  const out = []
  let i = 0
  let j = 0
  while (i < left.length && j < right.length) {
    if (left[i] <= right[j]) out.push(left[i++])
    else out.push(right[j++])
  }
  return out.concat(left.slice(i), right.slice(j))
}

function mergeSortBy(items, keyFn) {
  if (items.length <= 1) return items.slice()
  const mid = items.length >> 1
  const left = mergeSortBy(items.slice(0, mid), keyFn)
  const right = mergeSortBy(items.slice(mid), keyFn)
  const out = []
  let i = 0
  let j = 0
  while (i < left.length && j < right.length) {
    if (keyFn(left[i]) <= keyFn(right[j])) out.push(left[i++])
    else out.push(right[j++])
  }
  return out.concat(left.slice(i), right.slice(j))
}

function reverseList(list) {
  const out = []
  for (let i = list.length - 1; i >= 0; i--) out.push(list[i])
  return out
}`,
  finalCode: `function spreadHash(h) {
  return ((h ^ (h >>> 16)) >>> 0)
}

function bucketIndex(h, capacity) {
  return spreadHash(h) & (capacity - 1)
}

function shouldTreeify(binCount, capacity) {
  return binCount >= 8 && capacity >= 64
}

function equalsHashContract(a, b, hashCode) {
  return hashCode(a) === hashCode(b)
}

function sinkDown(heap, i) {
  const n = heap.length
  while (true) {
    let smallest = i
    const l = i * 2 + 1
    const r = i * 2 + 2
    if (l < n && heap[l] < heap[smallest]) smallest = l
    if (r < n && heap[r] < heap[smallest]) smallest = r
    if (smallest === i) break
    ;[heap[i], heap[smallest]] = [heap[smallest], heap[i]]
    i = smallest
  }
}

function sinkUp(heap, i) {
  while (i > 0) {
    const parent = (i - 1) >> 1
    if (heap[parent] <= heap[i]) break
    ;[heap[parent], heap[i]] = [heap[i], heap[parent]]
    i = parent
  }
}

function buildMinHeap(arr) {
  for (let i = (arr.length >> 1) - 1; i >= 0; i--) sinkDown(arr, i)
  return arr
}

function heapPush(heap, value) {
  heap.push(value)
  sinkUp(heap, heap.length - 1)
}

function heapPop(heap) {
  const top = heap[0]
  const last = heap.pop()
  if (heap.length) {
    heap[0] = last
    sinkDown(heap, 0)
  }
  return top
}

function topKLargest(nums, k) {
  if (k <= 0) return []
  const heap = []
  for (const v of nums) {
    heapPush(heap, v)
    if (heap.length > k) heapPop(heap)
  }
  return heap.sort((a, b) => a - b)
}

function evalRPN(tokens) {
  const stack = []
  for (const t of tokens) {
    if (!['+', '-', '*', '/'].includes(t)) {
      stack.push(Number(t))
      continue
    }
    const b = stack.pop()
    const a = stack.pop()
    if (t === '+') stack.push(a + b)
    else if (t === '-') stack.push(a - b)
    else if (t === '*') stack.push(a * b)
    else {
      if (b === 0) throw new Error('除数不能为 0')
      stack.push(Math.trunc(a / b))
    }
  }
  return stack[0]
}

function mergeSort(arr) {
  if (arr.length <= 1) return arr.slice()
  const mid = arr.length >> 1
  const left = mergeSort(arr.slice(0, mid))
  const right = mergeSort(arr.slice(mid))
  const out = []
  let i = 0
  let j = 0
  while (i < left.length && j < right.length) {
    if (left[i] <= right[j]) out.push(left[i++])
    else out.push(right[j++])
  }
  return out.concat(left.slice(i), right.slice(j))
}

function mergeSortBy(items, keyFn) {
  if (items.length <= 1) return items.slice()
  const mid = items.length >> 1
  const left = mergeSortBy(items.slice(0, mid), keyFn)
  const right = mergeSortBy(items.slice(mid), keyFn)
  const out = []
  let i = 0
  let j = 0
  while (i < left.length && j < right.length) {
    if (keyFn(left[i]) <= keyFn(right[j])) out.push(left[i++])
    else out.push(right[j++])
  }
  return out.concat(left.slice(i), right.slice(j))
}

function reverseList(list) {
  const out = []
  for (let i = list.length - 1; i >= 0; i--) out.push(list[i])
  return out
}`,
  tests: `${L1S1}\n${L1S2}\n${L1S3}`
}

/* ============================================================ 第 2 关测试 */
const L2S1 = `{
  check('ArrayList 默认容量 10，第一次 add 才分配', () => {
    const r = simulateArrayList(0, 1)
    same(r.capacity, 10)
    same(r.grows, 0)
  })
  check('扩容是 1.5 倍（向下取整），不是 2 倍', () => {
    const r = simulateArrayList(10, 11)
    same(r.capacity, 15)
    same(r.grows, 1)
  })
  check('连续扩容次数与容量序列正确', () => {
    const r = simulateArrayList(10, 23)
    same(r.capacity, 33, '10→15→22→33')
    same(r.grows, 3)
  })
  check('指定初始容量时从该容量开始按 1.5 倍扩', () => {
    const r = simulateArrayList(4, 5)
    same(r.capacity, 6)
  })
}`

const L2S2 = `{
  check('精确匹配优先于装箱', () => {
    const methods = [
      { params: ['int'], tag: 'int' },
      { params: ['Integer'], tag: 'boxed' }
    ]
    same(resolveOverload(methods, ['int']), 'int')
  })
  check('没有精确匹配时，基本类型可宽化（int → long）', () => {
    const methods = [{ params: ['long'], tag: 'long' }]
    same(resolveOverload(methods, ['int']), 'long')
  })
  check('int → Integer → Object：选最近的（Integer）', () => {
    const methods = [
      { params: ['Object'], tag: 'object' },
      { params: ['Integer'], tag: 'integer' }
    ]
    same(resolveOverload(methods, ['int']), 'integer')
  })
  check('没有可应用的方法时返回 null（编译失败），不是随便选一个', () => {
    const methods = [{ params: ['String'], tag: 'str' }]
    same(resolveOverload(methods, ['int']), null)
  })
  check('参数个数不同直接不匹配', () => {
    const methods = [{ params: ['int', 'int'], tag: 'two' }]
    same(resolveOverload(methods, ['int']), null)
  })
}`

const L2S3 = `{
  check('字面量放常量池：相同字面量 == 为 true', () => {
    const pool = new StringPool()
    const a = pool.literal('java')
    const b = pool.literal('java')
    same(a === b, true)
  })
  check('new String 每次都在堆上新建：== 为 false，equals 为 true', () => {
    const pool = new StringPool()
    const a = pool.newString('java')
    const b = pool.newString('java')
    same(a === b, false)
    same(a.equals(b), true, 'equals 比较内容，应为 true')
  })
  check('intern() 返回池中已有引用：与字面量 == 为 true', () => {
    const pool = new StringPool()
    const a = pool.newString('java')
    const b = a.intern()
    same(b === pool.literal('java'), true)
  })
  check('运行期拼接（非常量）不进池，intern 之后才与字面量相等', () => {
    const pool = new StringPool()
    const a = pool.concat('ja', 'va')
    const b = pool.literal('java')
    same(a === b, false, '运行期拼接是新对象')
    same(a.intern() === b, true, 'intern 之后指向池内实例')
  })
}`

/* ============================================================ 第 2 关 */
const LV2 = {
  id: 'lv2',
  title: '核心机制：扩容、重载决议与 String 常量池',
  emoji: '🧩',
  xp: 50,
  goal: '实现三个语义模拟：ArrayList 的 1.5 倍扩容（simulateArrayList）、编译期重载决议（resolveOverload）、String 常量池与 intern（StringPool）。',
  why: '这三个点是 Java 面试「背了但说不清」的重灾区：扩容写成 2 倍、以为重载是运行期分发、以为字符串拼接都在池里。把它们写成可跑的模拟，== 与 equals 的区别就不再是靠记。',
  nodes: ['be.java.dsa.tree', 'be.java.core', 'be.java.core.collection', 'be.java.core.exception-generic', 'be.java.core.oop', 'be.java.core.string-common'],
  thinking: [
    {
      title: '为什么扩容是 1.5 倍而不是 2 倍',
      md: '2 倍扩容会浪费更多空间（旧数组 + 新数组同时存在时间更长），1.5 倍是空间与拷贝次数的折中。\n\n实现上 newCapacity = oldCapacity + (oldCapacity >> 1)：整数右移即除以 2 向下取整，所以 10→15、15→22、22→33。这也是为什么容量序列不是整齐的倍数。'
    },
    {
      title: '重载在编译期就决定了',
      md: 'Java 的方法调用分两种：重载（overload）按**静态类型**在编译期选方法；重写（override）按**运行时类型**动态分派。\n\n所以重载决议的优先级是：精确匹配 > 装箱/拆箱 > 宽化 > 变长参数 > Object。这也是为什么 f(null) 会编译错误（两个引用类型都匹配时歧义）。'
    },
    {
      title: '常量池与 ==',
      md: '== 比引用。字面量 "java" 在编译期就进常量池，两个相同字面量指向同一个实例；new String("java") 在堆上新建；运行期拼接 a + b 也是新对象。\n\nintern() 的语义是「返回池中这个字符串的规范实例」，所以 new String("java").intern() == "java" 为 true。JDK7 之后池在堆里，intern 不复制对象。'
    }
  ],
  prereq: [
    {
      title: '包装类型的缓存区间',
      md: 'Integer.valueOf(-128~127) 会复用缓存对象，所以 Integer a = 127, b = 127; a == b 为 true，而 128 为 false。\n\n这不是本题范围，但它和 String 常量池是同一类问题：== 比较的是「是不是同一个对象」，不是「值是否相等」。'
    },
    {
      title: '重载 vs 重写的判定',
      md: '同一个类里同名不同参 → 重载；子类覆盖父类同名同参 → 重写。\n\n重写方法在运行时按对象实际类型调用；重载方法在编译期按参数静态类型选择。父类引用指向子类对象时，调用重写方法走子类，调用重载方法看引用类型。'
    }
  ],
  api: [
    {
      name: 'simulateArrayList',
      sig: 'simulateArrayList(initialCapacity, adds) => { capacity, grows, size }',
      args: 'initialCapacity 为 0 时表示使用默认容量 10（首次 add 分配）；adds 是总添加次数。',
      returns: '最终容量、扩容次数、元素数。',
      example: 'simulateArrayList(10, 23)  // → { capacity: 33, grows: 3 }'
    },
    {
      name: 'resolveOverload',
      sig: 'resolveOverload(methods, argTypes) => tag | null',
      args: 'methods: { params: string[], tag }[]；argTypes 是实参的静态类型。',
      returns: '最具体可应用方法的 tag；没有则 null。',
      example: "resolveOverload([{ params: ['int'], tag: 'int' }], ['int'])  // → 'int'"
    },
    {
      name: 'StringPool',
      sig: 'new StringPool() / literal(s) / newString(s) / concat(...parts)；实例有 equals(other) 与 intern()',
      args: 'literal 进池并复用；newString 每次新建；concat 模拟运行期拼接（新建）。',
      returns: 'literal 对相同 s 返回同一实例；intern 返回池内实例。',
      example: "const p = new StringPool(); p.newString('java').intern() === p.literal('java')  // true"
    }
  ],
  usage: 'const growth = simulateArrayList(0, 100)          // 默认 10 → 15 → 22 …\nconst picked = resolveOverload(methods, ["int"])   // 编译期决议，运行时不会变\n\nconst pool = new StringPool()\nconst a = pool.newString("java")\nconst b = pool.literal("java")\na === b            // false：堆上新建\na.intern() === b   // true：入池后复用',
  hints: [
    'simulateArrayList 的扩容表达式是 capacity + (capacity >> 1)；initial=0 且第一次 add 时直接给 10。',
    'resolveOverload 用打分：精确 0、装箱 1、宽化 2、Object 4；分数最低且有限者胜，全部冲突返回 null。',
    'StringPool 用 Map<string, StringBox> 存池；StringBox 持有 pool 引用，intern 时回池里取。'
  ],
  stages: [
    {
      n: 1,
      title: '先算 ArrayList 扩容',
      think: '把「默认 10、1.5 倍、整数右移」三条规则写成循环，扩容序列就一目了然——比背「10、15、22、33」可靠。',
      hint: '容量为 0 时首次分配 10；否则 capacity + (capacity >> 1)；用 size 与 capacity 比较判断是否扩容。',
      code: `const DEFAULT_CAPACITY = 10

function simulateArrayList(initialCapacity, adds) {
  let capacity = initialCapacity > 0 ? initialCapacity : 0
  let size = 0
  let grows = 0
  for (let i = 0; i < adds; i++) {
    if (size === capacity) {
      if (capacity === 0) capacity = DEFAULT_CAPACITY
      else { capacity = capacity + (capacity >> 1); grows++ }
    }
    size++
  }
  return { capacity, grows, size }
}`,
      test: L2S1,
      diag: [
        '扩容写成了 2 倍，或者用了 Math.ceil 导致 22 变成 23。',
        '初始容量为 0 时没有走默认 10 的分支。',
        'grows 计数在扩容判断外，每次 add 都加。',
        '指定初始容量时没有从该容量开始算。'
      ]
    },
    {
      n: 2,
      title: '再写重载决议',
      think: '重载是编译期行为：按实参静态类型给每个候选打分，取最具体者。这里把「精确 > 装箱 > 宽化 > Object」的优先级写死。',
      hint: '写两个映射表 WIDEN 与 BOX；scoreParam(param,arg) 精确 0、装箱 1、宽化 2、Object 4、其余 Infinity；选总分最低。',
      code: `const DEFAULT_CAPACITY = 10

function simulateArrayList(initialCapacity, adds) {
  let capacity = initialCapacity > 0 ? initialCapacity : 0
  let size = 0
  let grows = 0
  for (let i = 0; i < adds; i++) {
    if (size === capacity) {
      if (capacity === 0) capacity = DEFAULT_CAPACITY
      else { capacity = capacity + (capacity >> 1); grows++ }
    }
    size++
  }
  return { capacity, grows, size }
}

const WIDEN = {
  byte: ['short', 'int', 'long', 'float', 'double'],
  short: ['int', 'long', 'float', 'double'],
  char: ['int', 'long', 'float', 'double'],
  int: ['long', 'float', 'double'],
  long: ['float', 'double'],
  float: ['double']
}
const BOX = {
  byte: 'Byte', short: 'Short', char: 'Character', int: 'Integer',
  long: 'Long', float: 'Float', double: 'Double', boolean: 'Boolean'
}

function scoreParam(param, arg) {
  if (param === arg) return 0
  if (BOX[arg] === param) return 1
  if ((WIDEN[arg] ?? []).includes(param)) return 2
  if (param === 'Object') return 4
  return Infinity
}

function resolveOverload(methods, argTypes) {
  let best = null
  let bestScore = Infinity
  for (const m of methods) {
    if (m.params.length !== argTypes.length) continue
    let total = 0
    let applicable = true
    for (let i = 0; i < argTypes.length; i++) {
      const s = scoreParam(m.params[i], argTypes[i])
      if (s === Infinity) { applicable = false; break }
      total += s
    }
    if (applicable && total < bestScore) { bestScore = total; best = m.tag }
  }
  return best
}`,
      test: L2S2,
      diag: [
        '打分顺序反了：把装箱排在精确匹配前面。',
        '漏了宽化分支（int → long 找不到方法）。',
        'Object 的分数设成 0，抢走了 Integer 的精确匹配。',
        '不可应用时没有跳过，仍然记录了 tag。',
        '参数个数不同时也参与打分（数组越界或错配）。'
      ]
    },
    {
      n: 3,
      title: '最后模拟 String 常量池',
      think: '== 是引用比较，所以关键不是「字符串内容」而是「这个实例从哪里来」：池、堆、还是拼接结果。用池对象把三种来源分开。',
      hint: '池用 Map；literal 有则复用；newString 每次 new；concat 拼完按 newString 处理；StringBox.intern 回池取。',
      code: `const DEFAULT_CAPACITY = 10

function simulateArrayList(initialCapacity, adds) {
  let capacity = initialCapacity > 0 ? initialCapacity : 0
  let size = 0
  let grows = 0
  for (let i = 0; i < adds; i++) {
    if (size === capacity) {
      if (capacity === 0) capacity = DEFAULT_CAPACITY
      else { capacity = capacity + (capacity >> 1); grows++ }
    }
    size++
  }
  return { capacity, grows, size }
}

const WIDEN = {
  byte: ['short', 'int', 'long', 'float', 'double'],
  short: ['int', 'long', 'float', 'double'],
  char: ['int', 'long', 'float', 'double'],
  int: ['long', 'float', 'double'],
  long: ['float', 'double'],
  float: ['double']
}
const BOX = {
  byte: 'Byte', short: 'Short', char: 'Character', int: 'Integer',
  long: 'Long', float: 'Float', double: 'Double', boolean: 'Boolean'
}

function scoreParam(param, arg) {
  if (param === arg) return 0
  if (BOX[arg] === param) return 1
  if ((WIDEN[arg] ?? []).includes(param)) return 2
  if (param === 'Object') return 4
  return Infinity
}

function resolveOverload(methods, argTypes) {
  let best = null
  let bestScore = Infinity
  for (const m of methods) {
    if (m.params.length !== argTypes.length) continue
    let total = 0
    let applicable = true
    for (let i = 0; i < argTypes.length; i++) {
      const s = scoreParam(m.params[i], argTypes[i])
      if (s === Infinity) { applicable = false; break }
      total += s
    }
    if (applicable && total < bestScore) { bestScore = total; best = m.tag }
  }
  return best
}

class StringBox {
  constructor(value, pool) {
    this.value = value
    this.pool = pool
  }
  equals(other) {
    return other instanceof StringBox && other.value === this.value
  }
  intern() {
    return this.pool.literal(this.value)
  }
}

class StringPool {
  constructor() {
    this.pool = new Map()
  }
  literal(s) {
    if (!this.pool.has(s)) this.pool.set(s, new StringBox(s, this))
    return this.pool.get(s)
  }
  newString(s) {
    return new StringBox(s, this)
  }
  concat(...parts) {
    return new StringBox(parts.join(''), this)
  }
}`,
      test: L2S3,
      diag: [
        'pool.literal 每次都 new，没有复用池内实例。',
        'newString 错误地走了 literal（返回了池内实例）。',
        'intern 返回了 this 而不是池内实例。',
        'concat 用了字面量语义（直接进池），与运行期拼接不符。'
      ]
    }
  ],
  skeleton: `function simulateArrayList(initialCapacity, adds) {
  // TODO: 扩容阈值 = 容量 × 0.75，扩容后容量 ×1.5（不是 ×2）
  throw new Error('simulateArrayList 还没实现')
}

function resolveOverload(methods, argTypes) {
  // TODO: 先精确匹配，再按拓宽 / 装箱就近选，多个候选取最具体
  throw new Error('resolveOverload 还没实现')
}

class StringPool {
  constructor() {
    // TODO: intern 表 + 字符串常量池命中统计
    throw new Error('StringPool 还没实现')
  }
}`,
  solution: `function simulateArrayList(initialCapacity, adds) {
  let capacity = initialCapacity > 0 ? initialCapacity : 0
  let size = 0
  let grows = 0
  for (let i = 0; i < adds; i++) {
    if (size === capacity) {
      if (capacity === 0) capacity = 10
      else { capacity = capacity + (capacity >> 1); grows++ }
    }
    size++
  }
  return { capacity, grows, size }
}

const WIDEN = {
  byte: ['short', 'int', 'long', 'float', 'double'],
  short: ['int', 'long', 'float', 'double'],
  char: ['int', 'long', 'float', 'double'],
  int: ['long', 'float', 'double'],
  long: ['float', 'double'],
  float: ['double']
}
const BOX = {
  byte: 'Byte', short: 'Short', char: 'Character', int: 'Integer',
  long: 'Long', float: 'Float', double: 'Double', boolean: 'Boolean'
}

function scoreParam(param, arg) {
  if (param === arg) return 0
  if (BOX[arg] === param) return 1
  if ((WIDEN[arg] ?? []).includes(param)) return 2
  if (param === 'Object') return 4
  return Infinity
}

function resolveOverload(methods, argTypes) {
  let best = null
  let bestScore = Infinity
  for (const m of methods) {
    if (m.params.length !== argTypes.length) continue
    let total = 0
    let applicable = true
    for (let i = 0; i < argTypes.length; i++) {
      const s = scoreParam(m.params[i], argTypes[i])
      if (s === Infinity) { applicable = false; break }
      total += s
    }
    if (applicable && total < bestScore) { bestScore = total; best = m.tag }
  }
  return best
}

class StringBox {
  constructor(value, pool) {
    this.value = value
    this.pool = pool
  }
  equals(other) {
    return other instanceof StringBox && other.value === this.value
  }
  intern() {
    return this.pool.literal(this.value)
  }
}

class StringPool {
  constructor() {
    this.pool = new Map()
  }
  literal(s) {
    if (!this.pool.has(s)) this.pool.set(s, new StringBox(s, this))
    return this.pool.get(s)
  }
  newString(s) {
    return new StringBox(s, this)
  }
  concat(...parts) {
    return new StringBox(parts.join(''), this)
  }
}`,
  finalCode: `function simulateArrayList(initialCapacity, adds) {
  let capacity = initialCapacity > 0 ? initialCapacity : 0
  let size = 0
  let grows = 0
  for (let i = 0; i < adds; i++) {
    if (size === capacity) {
      if (capacity === 0) capacity = 10
      else { capacity = capacity + (capacity >> 1); grows++ }
    }
    size++
  }
  return { capacity, grows, size }
}

const WIDEN = {
  byte: ['short', 'int', 'long', 'float', 'double'],
  short: ['int', 'long', 'float', 'double'],
  char: ['int', 'long', 'float', 'double'],
  int: ['long', 'float', 'double'],
  long: ['float', 'double'],
  float: ['double']
}
const BOX = {
  byte: 'Byte', short: 'Short', char: 'Character', int: 'Integer',
  long: 'Long', float: 'Float', double: 'Double', boolean: 'Boolean'
}

function scoreParam(param, arg) {
  if (param === arg) return 0
  if (BOX[arg] === param) return 1
  if ((WIDEN[arg] ?? []).includes(param)) return 2
  if (param === 'Object') return 4
  return Infinity
}

function resolveOverload(methods, argTypes) {
  let best = null
  let bestScore = Infinity
  for (const m of methods) {
    if (m.params.length !== argTypes.length) continue
    let total = 0
    let applicable = true
    for (let i = 0; i < argTypes.length; i++) {
      const s = scoreParam(m.params[i], argTypes[i])
      if (s === Infinity) { applicable = false; break }
      total += s
    }
    if (applicable && total < bestScore) { bestScore = total; best = m.tag }
  }
  return best
}

class StringBox {
  constructor(value, pool) {
    this.value = value
    this.pool = pool
  }
  equals(other) {
    return other instanceof StringBox && other.value === this.value
  }
  intern() {
    return this.pool.literal(this.value)
  }
}

class StringPool {
  constructor() {
    this.pool = new Map()
  }
  literal(s) {
    if (!this.pool.has(s)) this.pool.set(s, new StringBox(s, this))
    return this.pool.get(s)
  }
  newString(s) {
    return new StringBox(s, this)
  }
  concat(...parts) {
    return new StringBox(parts.join(''), this)
  }
}`,
  tests: `${L2S1}\n${L2S2}\n${L2S3}`
}

/* ============================================================ 第 3 关测试 */
const L3S1 = `{
  check('核心线程未满：直接交给核心线程', () => {
    const pool = createPool({ core: 2, queueSize: 2, max: 4 })
    same(submit(pool, 't1').ranBy, 'core')
    same(submit(pool, 't2').ranBy, 'core')
  })
  check('核心满但队列未满：进队列（不是先开新线程）', () => {
    const pool = createPool({ core: 1, queueSize: 2, max: 3 })
    submit(pool, 't1')
    same(submit(pool, 't2').ranBy, 'queue')
  })
  check('队列满且未到 max：开临时线程', () => {
    const pool = createPool({ core: 1, queueSize: 1, max: 3 })
    submit(pool, 't1')
    submit(pool, 't2')
    same(submit(pool, 't3').ranBy, 'extra')
  })
  check('核心+队列+临时都满：走拒绝策略', () => {
    const pool = createPool({ core: 1, queueSize: 1, max: 2, reject: 'abort' })
    submit(pool, 't1'); submit(pool, 't2'); submit(pool, 't3')
    same(submit(pool, 't4').ranBy, 'rejected')
  })
  check('CallerRuns 策略：被拒绝的任务由提交线程执行', () => {
    const pool = createPool({ core: 1, queueSize: 1, max: 1, reject: 'caller-runs' })
    submit(pool, 't1'); submit(pool, 't2')
    same(submit(pool, 't3').ranBy, 'caller')
  })
}`

const L3S2 = `{
  check('同一线程可重入：计数累加', () => {
    const lock = new ReentrantLockSim()
    same(lock.lock('A'), 1)
    same(lock.lock('A'), 2)
    same(lock.lockCount('A'), 2)
  })
  check('其他线程拿不到锁：tryLock 返回 false', () => {
    const lock = new ReentrantLockSim()
    lock.lock('A')
    same(lock.tryLock('B'), false)
  })
  check('unlock 必须配对：非持有线程 unlock 抛错', () => {
    const lock = new ReentrantLockSim()
    lock.lock('A')
    let threw = false
    try { lock.unlock('B') } catch { threw = true }
    same(threw, true)
  })
  check('完全释放后其他线程才能拿到', () => {
    const lock = new ReentrantLockSim()
    lock.lock('A'); lock.lock('A')
    lock.unlock('A'); lock.unlock('A')
    same(lock.tryLock('B'), true)
  })
}`

const L3S3 = `{
  check('CPU 密集任务：线程数 ≈ CPU 核数', () => {
    same(recommendPoolSize({ cpu: 8, ioWaitRatio: 0 }).core, 8)
  })
  check('IO 密集任务：线程数 = CPU / (1 - 等待比)', () => {
    // 8 核、等待占 75% → 8 / 0.25 = 32
    same(recommendPoolSize({ cpu: 8, ioWaitRatio: 0.75 }).core, 32)
  })
  check('非法等待比按 CPU 密集处理，不产生负线程', () => {
    same(recommendPoolSize({ cpu: 4, ioWaitRatio: 2 }).core, 4)
  })
  check('队列容量：到达率 × 可容忍排队时间', () => {
    same(recommendQueueSize({ arrivalPerSec: 100, tolerateSec: 2 }), 200)
  })
  check('拒绝策略：关键任务 CallerRuns 反压，非关键丢弃最旧', () => {
    same(chooseRejectPolicy({ critical: true }), 'caller-runs')
    same(chooseRejectPolicy({ critical: false }), 'discard-oldest')
  })
}`

/* ============================================================ 第 3 关 */
const LV3 = {
  id: 'lv3',
  title: '并发：线程池调度、可重入锁与容量参数',
  emoji: '🔒',
  xp: 60,
  goal: '实现三个并发组件：线程池的四级调度与拒绝策略（createPool + submit）、可重入锁（ReentrantLockSim）、线程池/队列容量公式（recommendPoolSize + recommendQueueSize + chooseRejectPolicy）。',
  why: '线程池的调度顺序（核心线程 → 队列 → 临时线程 → 拒绝）是最容易被说错的地方：很多人以为「满了就开新线程」，实际是先排队。可重入锁与 AQS 的持有计数、以及「线程数该开多少」的公式，是 Java 并发面试的必答题。',
  nodes: ['be.java.core.syntax-basics', 'be.java.concurrent', 'be.java.concurrent.thread-basics', 'be.java.concurrent.threadpool-lock'],
  thinking: [
    {
      title: '线程池为什么先排队再扩容',
      md: 'ThreadPoolExecutor 的调度顺序是：核心线程未满 → 新建核心线程；否则入队；队列满 → 新建临时线程（到 max）；再满 → 拒绝。\n\n「先排队」意味着：如果队列无限大，临时线程永远不会被创建（这也是 Executors.newFixedThreadPool 用无界队列的隐患——可能 OOM 且 max 形同虚设）。理解这个顺序才能解释「为什么我配了 max 却不生效」。'
    },
    {
      title: '可重入锁的计数在哪',
      md: 'ReentrantLock 的锁状态就是 AQS 的 state：同线程重复 lock 时 state 累加，unlock 递减，减到 0 才真正释放。\n\n「可重入」解决的是「同一线程再次进入同步块时不会自己把自己锁死」；跨线程必须释放干净，否则其他线程永远拿不到。'
    },
    {
      title: '线程数公式从哪来',
      md: 'CPU 密集：线程数 ≈ CPU 核数（再多只会增加上下文切换）。IO 密集：线程数 = CPU × (1 + 等待时间/计算时间) = CPU / (1 - 等待占比)。\n\n这是「利特尔法则」的工程近似，不是精确公式——真实值要靠压测校准，但公式给了起点，而不是拍脑袋。'
    }
  ],
  prereq: [
    {
      title: '线程池的四个参数与拒绝策略',
      md: 'corePoolSize（核心线程，常驻）、maximumPoolSize（最大）、workQueue（任务队列）、keepAliveTime（临时线程空闲存活）。\n\n四种内置拒绝策略：AbortPolicy（抛异常）、CallerRunsPolicy（提交线程自己跑，反压）、DiscardPolicy（静默丢）、DiscardOldestPolicy（丢队头最老的）。'
    },
    {
      title: 'AQS 与 state',
      md: 'AQS 用一个 volatile int state 表示同步状态，ReentrantLock 用它记重入次数；等待队列是 CLH 变体。\n\nlock() 失败会入队并 park；unlock() 释放后唤醒队头。这也是「非公平锁」比「公平锁」吞吐高的原因：新来的线程可能插队成功。'
    }
  ],
  api: [
    {
      name: 'createPool / submit',
      sig: 'createPool({ core, queueSize, max, reject }) => pool；submit(pool, task) => { ranBy, task }',
      args: 'reject ∈ abort | caller-runs；pool 是可变状态模拟器。',
      returns: 'ranBy ∈ core | queue | extra | caller | rejected。',
      example: "submit(createPool({ core: 1, queueSize: 1, max: 2 }), 't1').ranBy  // → 'core'"
    },
    {
      name: 'ReentrantLockSim',
      sig: 'new ReentrantLockSim() / lock(thread) / tryLock(thread) / unlock(thread) / lockCount(thread)',
      args: 'thread 是模拟的线程标识（任意字符串）。',
      returns: 'lock 返回重入计数；tryLock 返回 boolean；unlock 非持有者抛错。',
      example: "const l = new ReentrantLockSim(); l.lock('A'); l.lock('A'); l.lockCount('A')  // → 2"
    },
    {
      name: 'recommendPoolSize / recommendQueueSize / chooseRejectPolicy',
      sig: 'recommendPoolSize({ cpu, ioWaitRatio }) => { core }；recommendQueueSize({ arrivalPerSec, tolerateSec }) => number；chooseRejectPolicy({ critical }) => string',
      args: 'ioWaitRatio ∈ [0,1]；critical 表示任务是否关键。',
      returns: '线程数、队列容量、拒绝策略。',
      example: 'recommendPoolSize({ cpu: 8, ioWaitRatio: 0.75 })  // → 32'
    }
  ],
  usage: 'const pool = createPool({ core: 8, queueSize: 200, max: 32, reject: "caller-runs" })\nfor (const task of tasks) submit(pool, task)\n\nconst lock = new ReentrantLockSim()\nlock.lock("thread-1"); lock.lock("thread-1")\nlock.unlock("thread-1"); lock.unlock("thread-1")\n\nconst sizing = recommendPoolSize({ cpu: 8, ioWaitRatio: 0.75 })  // IO 密集开 32',
  hints: [
    'submit 的判断顺序不能变：核心 → 队列 → 临时 → 拒绝（先排队的语义）。',
    'ReentrantLockSim.unlock 先校验 owner，再递减计数，归零时清空 owner。',
    'recommendPoolSize 用 cpu / (1 - ratio)，ratio 越界时按 0 处理（CPU 密集兜底）。'
  ],
  stages: [
    {
      n: 1,
      title: '先写线程池调度',
      think: '把「核心 → 队列 → 临时 → 拒绝」四层写成一个顺序判断，并让状态（workers/extra/queue）可观测。顺序错一步，结论就全错。',
      hint: 'workers < core 就加核心；否则 queue 未满入队；否则 workers+extra < max 加临时；否则按 reject 策略返回 caller/rejected。',
      code: `function createPool(spec) {
  const { core, queueSize, max, reject = 'abort' } = spec
  return { core, queueSize, max, reject, workers: 0, extra: 0, queue: [] }
}

function submit(pool, task) {
  if (pool.workers < pool.core) {
    pool.workers++
    return { ranBy: 'core', task }
  }
  if (pool.queue.length < pool.queueSize) {
    pool.queue.push(task)
    return { ranBy: 'queue', task }
  }
  if (pool.workers + pool.extra < pool.max) {
    pool.extra++
    return { ranBy: 'extra', task }
  }
  if (pool.reject === 'caller-runs') return { ranBy: 'caller', task }
  return { ranBy: 'rejected', task }
}`,
      test: L3S1,
      diag: [
        '判断顺序反了：先开临时线程再排队，与 JDK 行为相反。',
        '队列满的判断用了 <=，最后一个空位用不上。',
        '临时线程上限用了 max 而没加已有的 workers（或反之）。',
        'caller-runs 策略没有单独分支，全被归到 rejected。',
        '入队时也顺手增加了 workers（核心线程数被虚增）。'
      ]
    },
    {
      n: 2,
      title: '再写可重入锁',
      think: '锁状态就是「持有者 + 重入计数」。lock 同线程累加、异线程失败；unlock 非持有者要抛错，归零才释放。',
      hint: 'lock：owner 为空或等于自己 → 设置 owner 并 count++；tryLock 同理但返回 boolean；unlock 校验 owner 后 count--，为 0 清 owner。',
      code: `function createPool(spec) {
  const { core, queueSize, max, reject = 'abort' } = spec
  return { core, queueSize, max, reject, workers: 0, extra: 0, queue: [] }
}

function submit(pool, task) {
  if (pool.workers < pool.core) {
    pool.workers++
    return { ranBy: 'core', task }
  }
  if (pool.queue.length < pool.queueSize) {
    pool.queue.push(task)
    return { ranBy: 'queue', task }
  }
  if (pool.workers + pool.extra < pool.max) {
    pool.extra++
    return { ranBy: 'extra', task }
  }
  if (pool.reject === 'caller-runs') return { ranBy: 'caller', task }
  return { ranBy: 'rejected', task }
}

class ReentrantLockSim {
  constructor() {
    this.owner = null
    this.count = 0
  }
  lock(thread) {
    if (!this.owner || this.owner === thread) {
      this.owner = thread
      this.count++
      return this.count
    }
    return false
  }
  tryLock(thread) {
    if (!this.owner) {
      this.owner = thread
      this.count = 1
      return true
    }
    return this.owner === thread
  }
  lockCount(thread) {
    return this.owner === thread ? this.count : 0
  }
  unlock(thread) {
    if (this.owner !== thread) throw new Error('IllegalMonitorStateException: 当前线程不持有锁')
    this.count--
    if (this.count === 0) this.owner = null
  }
}`,
      test: L3S2,
      diag: [
        'lock 对同一线程没有累加计数（可重入失效）。',
        'tryLock 在锁被其他线程持有时也返回 true。',
        'unlock 没有校验 owner，其他线程也能解锁。',
        'unlock 减到 0 后没有清 owner，锁永远不放。'
      ]
    },
    {
      n: 3,
      title: '最后算容量参数与拒绝策略',
      think: '线程数不是拍脑袋：CPU 密集看核数，IO 密集看等待占比。队列容量按到达率 × 容忍时间算。拒绝策略按任务关键性选。',
      hint: 'cpu/(1-ratio)，ratio 越界按 0；队列 = arrival × tolerate；critical 用 caller-runs，否则 discard-oldest。',
      code: `function createPool(spec) {
  const { core, queueSize, max, reject = 'abort' } = spec
  return { core, queueSize, max, reject, workers: 0, extra: 0, queue: [] }
}

function submit(pool, task) {
  if (pool.workers < pool.core) {
    pool.workers++
    return { ranBy: 'core', task }
  }
  if (pool.queue.length < pool.queueSize) {
    pool.queue.push(task)
    return { ranBy: 'queue', task }
  }
  if (pool.workers + pool.extra < pool.max) {
    pool.extra++
    return { ranBy: 'extra', task }
  }
  if (pool.reject === 'caller-runs') return { ranBy: 'caller', task }
  return { ranBy: 'rejected', task }
}

class ReentrantLockSim {
  constructor() {
    this.owner = null
    this.count = 0
  }
  lock(thread) {
    if (!this.owner || this.owner === thread) {
      this.owner = thread
      this.count++
      return this.count
    }
    return false
  }
  tryLock(thread) {
    if (!this.owner) {
      this.owner = thread
      this.count = 1
      return true
    }
    return this.owner === thread
  }
  lockCount(thread) {
    return this.owner === thread ? this.count : 0
  }
  unlock(thread) {
    if (this.owner !== thread) throw new Error('IllegalMonitorStateException')
    this.count--
    if (this.count === 0) this.owner = null
  }
}

function recommendPoolSize(spec) {
  const { cpu, ioWaitRatio } = spec
  const ratio = ioWaitRatio >= 0 && ioWaitRatio <= 1 ? ioWaitRatio : 0
  return { core: Math.max(1, Math.round(cpu / (1 - ratio))) }
}

function recommendQueueSize(spec) {
  const { arrivalPerSec, tolerateSec } = spec
  return Math.ceil(arrivalPerSec * tolerateSec)
}

function chooseRejectPolicy(spec) {
  return spec.critical ? 'caller-runs' : 'discard-oldest'
}`,
      test: L3S3,
      diag: [
        '公式写成了 cpu*(1+ratio)，和 IO 密集的正确形式相反。',
        'ratio 越界时没有兜底，出现除以 0 或负数线程。',
        '队列容量没有取整，返回小数。',
        '拒绝策略判反：关键任务被分到丢弃。',
        '队列容量公式写成了 arrival / tolerate（相乘才是队列长度）。'
      ]
    }
  ],
  skeleton: `// 线程池与锁：池化不是「越多越快」，参数都要有推导
function createPool(spec) { throw new Error('createPool 还没实现') }
function submit(pool, task) { throw new Error('submit 还没实现') }
class ReentrantLockSim {
  // TODO: 可重入计数 + 等待队列 + 公平 / 非公平策略
  constructor() { throw new Error('ReentrantLockSim 还没实现') }
}
// 推荐值：CPU 密集 ≈ 核数 + 1；IO 密集 ≈ 核数 × (1 + 等待 / 计算)
function recommendPoolSize(spec) { throw new Error('recommendPoolSize 还没实现') }
function recommendQueueSize(spec) { throw new Error('recommendQueueSize 还没实现') }
function chooseRejectPolicy(spec) { throw new Error('chooseRejectPolicy 还没实现') }`,
  solution: `function createPool(spec) {
  const { core, queueSize, max, reject = 'abort' } = spec
  return { core, queueSize, max, reject, workers: 0, extra: 0, queue: [] }
}

function submit(pool, task) {
  if (pool.workers < pool.core) {
    pool.workers++
    return { ranBy: 'core', task }
  }
  if (pool.queue.length < pool.queueSize) {
    pool.queue.push(task)
    return { ranBy: 'queue', task }
  }
  if (pool.workers + pool.extra < pool.max) {
    pool.extra++
    return { ranBy: 'extra', task }
  }
  if (pool.reject === 'caller-runs') return { ranBy: 'caller', task }
  return { ranBy: 'rejected', task }
}

class ReentrantLockSim {
  constructor() {
    this.owner = null
    this.count = 0
  }
  lock(thread) {
    if (!this.owner || this.owner === thread) {
      this.owner = thread
      this.count++
      return this.count
    }
    return false
  }
  tryLock(thread) {
    if (!this.owner) {
      this.owner = thread
      this.count = 1
      return true
    }
    return this.owner === thread
  }
  lockCount(thread) {
    return this.owner === thread ? this.count : 0
  }
  unlock(thread) {
    if (this.owner !== thread) throw new Error('IllegalMonitorStateException')
    this.count--
    if (this.count === 0) this.owner = null
  }
}

function recommendPoolSize(spec) {
  const { cpu, ioWaitRatio } = spec
  const ratio = ioWaitRatio >= 0 && ioWaitRatio <= 1 ? ioWaitRatio : 0
  return { core: Math.max(1, Math.round(cpu / (1 - ratio))) }
}

function recommendQueueSize(spec) {
  const { arrivalPerSec, tolerateSec } = spec
  return Math.ceil(arrivalPerSec * tolerateSec)
}

function chooseRejectPolicy(spec) {
  return spec.critical ? 'caller-runs' : 'discard-oldest'
}`,
  finalCode: `function createPool(spec) {
  const { core, queueSize, max, reject = 'abort' } = spec
  return { core, queueSize, max, reject, workers: 0, extra: 0, queue: [] }
}

function submit(pool, task) {
  if (pool.workers < pool.core) {
    pool.workers++
    return { ranBy: 'core', task }
  }
  if (pool.queue.length < pool.queueSize) {
    pool.queue.push(task)
    return { ranBy: 'queue', task }
  }
  if (pool.workers + pool.extra < pool.max) {
    pool.extra++
    return { ranBy: 'extra', task }
  }
  if (pool.reject === 'caller-runs') return { ranBy: 'caller', task }
  return { ranBy: 'rejected', task }
}

class ReentrantLockSim {
  constructor() {
    this.owner = null
    this.count = 0
  }
  lock(thread) {
    if (!this.owner || this.owner === thread) {
      this.owner = thread
      this.count++
      return this.count
    }
    return false
  }
  tryLock(thread) {
    if (!this.owner) {
      this.owner = thread
      this.count = 1
      return true
    }
    return this.owner === thread
  }
  lockCount(thread) {
    return this.owner === thread ? this.count : 0
  }
  unlock(thread) {
    if (this.owner !== thread) throw new Error('IllegalMonitorStateException')
    this.count--
    if (this.count === 0) this.owner = null
  }
}

function recommendPoolSize(spec) {
  const { cpu, ioWaitRatio } = spec
  const ratio = ioWaitRatio >= 0 && ioWaitRatio <= 1 ? ioWaitRatio : 0
  return { core: Math.max(1, Math.round(cpu / (1 - ratio))) }
}

function recommendQueueSize(spec) {
  const { arrivalPerSec, tolerateSec } = spec
  return Math.ceil(arrivalPerSec * tolerateSec)
}

function chooseRejectPolicy(spec) {
  return spec.critical ? 'caller-runs' : 'discard-oldest'
}`,
  tests: `${L3S1}\n${L3S2}\n${L3S3}`
}

export default {
  id: 'be-java',
  version: 3,
  domain: 'be',
  cumulative: false,
  title: 'Java 数据结构、核心机制与并发',
  emoji: '☕',
  tagline: '3 关：HashMap/堆/排序的 JDK 语义、ArrayList 扩容与重载决议、线程池与可重入锁。',
  stack: ['Java', '数据结构', '并发'],
  intro: 'Java 后端面试的「手写 + 讲清」区：HashMap 为什么快、Top-K 怎么做到 O(n log k)、ArrayList 扩容为什么是 1.5 倍、重载决议发生在编译期、线程池为什么先排队而不是先扩容。这个项目把它们全部落成可跑代码，每一条结论都能被测试验证。',
  outcome: '你能白板写出 HashMap 扰动与树化判定、数组堆与 Top-K、稳定归并；讲清 ArrayList 扩容与 String 常量池；按公式算线程池参数并解释拒绝策略。',
  levels: [LV1, LV2, LV3]
}