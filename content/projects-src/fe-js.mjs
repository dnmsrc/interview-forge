/**
 * fe-js —— JS 三关：数据结构与算法、树/类型转换/作用域、原型/异步/DOM。
 * 分配见 data/plans/fe-js.json。
 */

/* ============================================================ 第 1 关测试 */
const L1S1 = `{
  check('单层线性循环 → O(n)', () => {
    same(complexityOf([{ kind: 'linear' }]), 'O(n)')
  })
  check('嵌套两层 → O(n^2)', () => {
    same(complexityOf([{ kind: 'linear' }, { kind: 'linear' }]), 'O(n^2)')
  })
  check('二分 → O(log n)，常数循环 → O(1)', () => {
    same(complexityOf([{ kind: 'log' }]), 'O(log n)')
    same(complexityOf([{ kind: 'const' }]), 'O(1)')
    same(complexityOf([]), 'O(1)')
  })
  check('线性套 log（排序外层）→ O(n log n)', () => {
    same(complexityOf([{ kind: 'linear' }, { kind: 'log' }]), 'O(n log n)')
  })
  check('双指针求有序数组的两数和', () => {
    same(twoSumSorted([1, 2, 4, 7, 11], 9), [2, 7])
    same(twoSumSorted([1, 2, 4, 7, 11], 3), [1, 2])
  })
  check('无解返回 null', () => {
    same(twoSumSorted([1, 2], 10), null)
    same(twoSumSorted([], 0), null)
  })
}`

const L1S2 = `{
  check('基本存取', () => {
    const t = createHashTable(4)
    t.set('a', 1)
    same(t.get('a'), 1)
    same(t.get('nope'), undefined)
  })
  check('哈希冲突时拉链查找仍然正确', () => {
    const t = createHashTable(2)
    t.set('a', 1)
    t.set('c', 3)
    same(t.get('a'), 1)
    same(t.get('c'), 3)
  })
  check('扩容后旧键仍可查到', () => {
    const t = createHashTable(2)
    t.set('a', 1)
    t.set('b', 2)
    ok(t.bucketCount() >= 4)
    same(t.get('a'), 1)
    same(t.get('b'), 2)
  })
  check('负载因子超过 0.75 触发翻倍', () => {
    const t = createHashTable(2)
    t.set('a', 1)
    t.set('b', 2)
    same(t.bucketCount(), 4)
  })
  check('delete 后查不到且 size 减小', () => {
    const t = createHashTable(4)
    t.set('x', 9)
    same(t.delete('x'), true)
    same(t.get('x'), undefined)
    same(t.size(), 0)
    same(t.delete('x'), false)
  })
}`

const L1S3 = `{
  check('TopK 返回最大的 k 个（升序）', () => {
    same(topK([5, 1, 9, 3, 7], 3), [5, 7, 9])
  })
  check('k 大于长度时返回全部有序', () => {
    same(topK([3, 1, 2], 10), [1, 2, 3])
  })
  check('k=0 返回空数组', () => {
    same(topK([3, 1], 0), [])
  })
  check('稳定性检测：归并排序保持相同 key 的相对顺序', () => {
    const original = [{ k: 1, v: 'a' }, { k: 0, v: 'b' }, { k: 1, v: 'c' }]
    const sorted = mergeSortStable(original, (x) => x.k)
    same(sorted.map((x) => x.v), ['b', 'a', 'c'])
    same(isStable(sorted, original, (x) => x.k), true)
  })
  check('选择排序不交换相等元素也被识别为不稳定', () => {
    const original = [{ k: 1, v: 'a' }, { k: 1, v: 'b' }, { k: 0, v: 'c' }]
    const sorted = selectionSort(original, (x) => x.k)
    same(sorted.map((x) => x.v), ['c', 'b', 'a'])
    same(isStable(sorted, original, (x) => x.k), false)
  })
}`

/* ============================================================ 第 1 关代码 */
const L1C1 = `function complexityOf(loops) {
  const kinds = loops.map((l) => l.kind)
  const linear = kinds.filter((k) => k === 'linear').length
  const log = kinds.filter((k) => k === 'log').length
  if (linear === 0 && log === 0) return 'O(1)'
  if (log === 0) return linear === 1 ? 'O(n)' : 'O(n^' + linear + ')'
  if (linear === 0) return 'O(log n)'
  return linear === 1 ? 'O(n log n)' : 'O(n^' + linear + ' log n)'
}

function twoSumSorted(arr, target) {
  let i = 0
  let j = arr.length - 1
  while (i < j) {
    const sum = arr[i] + arr[j]
    if (sum === target) return [arr[i], arr[j]]
    if (sum < target) i++
    else j--
  }
  return null
}`

const L1C2 = `${L1C1}

function hashOf(key, buckets) {
  let sum = 0
  const s = String(key)
  for (let i = 0; i < s.length; i++) sum = (sum + s.charCodeAt(i)) % buckets
  return sum
}

function createHashTable(buckets) {
  let count = buckets
  let slots = new Array(count).fill(null)
  let size = 0

  function put(key, value, target, buckets) {
    const idx = hashOf(key, buckets)
    if (!target[idx]) target[idx] = []
    const bucket = target[idx]
    for (const entry of bucket) {
      if (entry.key === key) { entry.value = value; return }
    }
    bucket.push({ key, value })
  }

  function find(key) {
    const idx = hashOf(key, count)
    const bucket = slots[idx]
    if (!bucket) return null
    for (const entry of bucket) if (entry.key === key) return entry
    return null
  }

  return {
    set(key, value) {
      put(key, value, slots, count)
      size++
      if (size / count > 0.75) {
        const next = new Array(count * 2).fill(null)
        for (const bucket of slots) {
          if (!bucket) continue
          for (const entry of bucket) put(entry.key, entry.value, next, count * 2)
        }
        slots = next
        count = count * 2
      }
    },
    get(key) {
      const entry = find(key)
      return entry ? entry.value : undefined
    },
    delete(key) {
      const idx = hashOf(key, count)
      const bucket = slots[idx]
      if (!bucket) return false
      const at = bucket.findIndex((e) => e.key === key)
      if (at < 0) return false
      bucket.splice(at, 1)
      size--
      return true
    },
    size() { return size },
    bucketCount() { return count }
  }
}`

const L1C3 = `${L1C2}

function topK(arr, k) {
  if (k <= 0) return []
  const heap = []
  const push = (v) => {
    heap.push(v)
    let i = heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heap[p] <= heap[i]) break
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
      while (true) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < heap.length && heap[l] < heap[m]) m = l
        if (r < heap.length && heap[r] < heap[m]) m = r
        if (m === i) break
        const t = heap[m]; heap[m] = heap[i]; heap[i] = t
        i = m
      }
    }
    return top
  }

  for (const v of arr) {
    push(v)
    if (heap.length > k) pop()
  }
  const out = []
  while (heap.length) out.push(pop())
  return out
}

function mergeSortStable(arr, keyOf) {
  if (arr.length <= 1) return arr.slice()
  const mid = arr.length >> 1
  const left = mergeSortStable(arr.slice(0, mid), keyOf)
  const right = mergeSortStable(arr.slice(mid), keyOf)
  const out = []
  let i = 0
  let j = 0
  while (i < left.length && j < right.length) {
    if (keyOf(left[i]) <= keyOf(right[j])) out.push(left[i++])
    else out.push(right[j++])
  }
  while (i < left.length) out.push(left[i++])
  while (j < right.length) out.push(right[j++])
  return out
}

function selectionSort(arr, keyOf) {
  const out = arr.slice()
  for (let i = 0; i < out.length; i++) {
    let m = i
    for (let j = i + 1; j < out.length; j++) {
      if (keyOf(out[j]) < keyOf(out[m])) m = j
    }
    if (m !== i) {
      const t = out[i]; out[i] = out[m]; out[m] = t
    }
  }
  return out
}

function isStable(sorted, original, keyOf) {
  const pos = new Map()
  original.forEach((item, i) => pos.set(item, i))
  for (let i = 1; i < sorted.length; i++) {
    if (keyOf(sorted[i - 1]) !== keyOf(sorted[i])) continue
    if (pos.get(sorted[i - 1]) > pos.get(sorted[i])) return false
  }
  return true
}`

/* ============================================================ 第 2 关测试 */
const L2S1 = `{
  var TREE = { v: 4, left: { v: 2, left: { v: 1 }, right: { v: 3 } }, right: { v: 6, left: { v: 5 }, right: { v: 7 } } }

  check('树深度', () => {
    same(treeDepth(TREE), 3)
    same(treeDepth(null), 0)
    same(treeDepth({ v: 1 }), 1)
  })
  check('层序遍历', () => {
    same(levelOrder(TREE), [4, 2, 6, 1, 3, 5, 7])
    same(levelOrder(null), [])
  })
  check('二叉搜索树判定：用中序递增检查', () => {
    same(isBst(TREE), true)
    const bad = { v: 4, left: { v: 6 }, right: { v: 7 } }
    same(isBst(bad), false)
  })
  check('空树视为合法 BST', () => {
    same(isBst(null), true)
  })
  check('单节点树', () => {
    same(isBst({ v: 1 }), true)
    same(levelOrder({ v: 9 }), [9])
  })
}`

const L2S2 = `{
  check('null 只等于 undefined', () => {
    same(looseEqual(null, undefined), true)
    same(looseEqual(null, 0), false)
    same(looseEqual(undefined, 0), false)
  })
  check('数字与字符串按数值比较', () => {
    same(looseEqual('1', 1), true)
    same(looseEqual(0, ''), true)
    same(looseEqual(0, '0'), true)
    same(looseEqual(' 1 ', 1), true)
    same(looseEqual('1a', 1), false)
  })
  check('布尔转成数字', () => {
    same(looseEqual(false, 0), true)
    same(looseEqual(true, 1), true)
    same(looseEqual(true, '1'), true)
  })
  check('对象走 ToPrimitive 与对方比较', () => {
    same(looseEqual([], ''), true)
    same(looseEqual([1], 1), true)
    same(looseEqual([1, 2], '1,2'), true)
    same(looseEqual({}, '[object Object]'), true)
  })
  check('NaN 不等于自己，类型相同才短路', () => {
    same(looseEqual(NaN, NaN), false)
    same(looseEqual('abc', 'abc'), true)
  })
}`

const L2S3 = `{
  check('var 在其作用域内提前可访问，值为 undefined', () => {
    const r = hoistEffects([{ kind: 'var', name: 'x', line: 5 }])
    same(r[0].beforeDecl, 'undefined')
    same(r[0].hoisted, true)
  })
  check('函数声明整体提升，调用之前就能执行', () => {
    const r = hoistEffects([{ kind: 'function', name: 'fn', line: 5 }])
    same(r[0].beforeDecl, 'callable')
  })
  check('let / const 在声明前访问会抛 TDZ', () => {
    const r = hoistEffects([{ kind: 'let', name: 'y', line: 5 }, { kind: 'const', name: 'z', line: 6 }])
    same(r.map((d) => d.beforeDecl), ['ReferenceError', 'ReferenceError'])
  })
  check('块作用域：let 出了块就不可见，var 会泄漏到函数作用域', () => {
    same(blockVisible('let'), false)
    same(blockVisible('var'), true)
  })
  check('在同一作用域里 var 重复声明合法，let/const 重复声明报错', () => {
    same(duplicateErrors([{ kind: 'var', name: 'a' }, { kind: 'var', name: 'a' }]), [])
    same(duplicateErrors([{ kind: 'let', name: 'b' }, { kind: 'let', name: 'b' }]), ['b'])
  })
}`

/* ============================================================ 第 2 关代码 */
const L2C1 = `function treeDepth(root) {
  if (!root) return 0
  return 1 + Math.max(treeDepth(root.left), treeDepth(root.right))
}

function levelOrder(root) {
  if (!root) return []
  const out = []
  const queue = [root]
  while (queue.length) {
    const node = queue.shift()
    out.push(node.v)
    if (node.left) queue.push(node.left)
    if (node.right) queue.push(node.right)
  }
  return out
}

function isBst(root) {
  let prev = null
  let ok = true
  const walk = (node) => {
    if (!node || !ok) return
    walk(node.left)
    if (prev !== null && prev >= node.v) ok = false
    prev = node.v
    walk(node.right)
  }
  walk(root)
  return ok
}`

const L2C2 = `${L2C1}

function toPrimitive(v) {
  if (v === null || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.join(',')
  return String(v)
}

function looseEqual(a, b) {
  const anim = a === null || a === undefined
  const bnim = b === null || b === undefined
  if (anim || bnim) return anim && bnim
  if (typeof a === typeof b) return a === b

  const pa = toPrimitive(a)
  const pb = toPrimitive(b)
  if (typeof pa === typeof pb) return pa === pb
  return Number(pa) === Number(pb)
}`

const L2C3 = `${L2C2}

function hoistEffects(decls) {
  return decls.map((d) => {
    if (d.kind === 'var') return { name: d.name, hoisted: true, beforeDecl: 'undefined' }
    if (d.kind === 'function') return { name: d.name, hoisted: true, beforeDecl: 'callable' }
    return { name: d.name, hoisted: false, beforeDecl: 'ReferenceError' }
  })
}

function blockVisible(kind) {
  return kind === 'var'
}

function duplicateErrors(decls) {
  const seen = {}
  const errors = []
  for (const d of decls) {
    if (d.kind === 'var') continue
    const key = d.kind + ':' + d.name
    if (seen[key]) errors.push(d.name)
    seen[key] = true
  }
  return errors
}`

/* ============================================================ 第 1 关 */
const LV1 = {
  id: 'lv1',
  title: 'JS 里的数据结构：复杂度、哈希表、堆与稳定排序',
  emoji: '🧮',
  xp: 50,
  goal: '实现复杂度识别、拉链哈希表（含扩容）、小顶堆 TopK，以及排序稳定性检测。',
  why: '前端面试的手撕算法不是考「会不会写快排」，是考「知不知道该用什么」：两数和该用哈希还是双指针、TopK 为什么用堆而不是全排序、Array.prototype.sort 在 V8 里到底稳不稳定。这一关把这几件事变成可跑的实现和可验证的断言。',
  nodes: [
    'fe.js.dsa',
    'fe.js.dsa.complexity',
    'fe.js.dsa.hash',
    'fe.js.dsa.heap',
    'fe.js.dsa.linear',
    'fe.js.dsa.sort'
  ],
  thinking: [
    {
      title: '复杂度的组合规则只有乘和加',
      md: '嵌套循环是乘法：外层 n、内层 n → O(n²)；一层线性套一层 log → O(n log n)（排序就是这种形状）。并列的循环是加法，取最大项。\n\n降阶时只保留最高阶并去掉常数，所以 `O(2n + 5)` 写成 `O(n)`。'
    },
    {
      title: '哈希表的扩容是「重建」而不是「扩容」',
      md: '桶数量变了，取模结果就变了——所有元素都要重新算位置。所以扩容的代价是 O(n)，但摊还到每次插入是 O(1)。\n\n负载因子 0.75 是空间与冲突的折中：太高冲突多、太低浪费内存。Java HashMap 也是 0.75。'
    }
  ],
  prereq: [
    {
      title: '双指针要求有序',
      md: '两数和用双指针是 O(n)，但前提是数组已排序（排序本身 O(n log n)）。无序数组用哈希表是 O(n)——这是「用空间换时间」的典型对比。'
    },
    {
      title: '堆的 TopK 是「维持大小为 k 的小顶堆」',
      md: '遍历数组，每个元素入堆，堆超过 k 就弹出堆顶（当前 k 个里最小的）。这样堆里永远是最大的 k 个，堆顶是第 k 大。时间复杂度 O(n log k)，比全排序 O(n log n) 在 k 很小时快很多。'
    }
  ],
  api: [
    {
      name: 'complexityOf',
      sig: 'complexityOf(loops) => string',
      args: 'loops 是嵌套循环的层列表，每项 kind 取 const / linear / log。',
      returns: '大 O 表示法字符串。',
      example: "complexityOf([{ kind: 'linear' }, { kind: 'log' }])  // 'O(n log n)'"
    },
    {
      name: 'createHashTable / topK',
      sig: 'createHashTable(buckets) => { set, get, delete, size, bucketCount }；topK(arr, k) => number[]',
      args: 'buckets 是初始桶数；topK 的 k 是要取的最大元素个数。',
      returns: '哈希表用拉链法；topK 返回升序的前 k 大。',
      example: 'const t = createHashTable(2)\nt.set(\'a\', 1)\nt.get(\'a\')  // 1'
    },
    {
      name: 'mergeSortStable / isStable',
      sig: 'mergeSortStable(arr, keyOf) => arr；isStable(sorted, original, keyOf) => boolean',
      args: 'keyOf 取排序键。',
      returns: '归并排序保持相同 key 的相对顺序；isStable 检查是否保持。',
      example: 'mergeSortStable([{k:1,v:"a"},{k:1,v:"b"}], x => x.k).map(x => x.v)  // ["a","b"]'
    }
  ],
  usage: '// 两数和：无序用哈希 O(n)，有序用双指针 O(n)\nfunction twoSum(nums, target) {\n  const seen = new Map()\n  for (let i = 0; i < nums.length; i++) {\n    if (seen.has(target - nums[i])) return [seen.get(target - nums[i]), i]\n    seen.set(nums[i], i)\n  }\n}\n\n// TopK：数据量大、k 小 → 堆；k 接近 n → 全排序',
  hints: [
    '第 1 步：complexityOf 里 log 只能和 linear 组合成 n log n，两个 log 嵌套才是 O(log^2 n)（本关不考）。',
    '第 2 步：扩容时把旧桶全部取出重新 put 进新表，注意 put 内部用 count 取模。',
    '第 3 步：isStable 用「原始下标」判断——相同 key 的两个元素，在后面那个若原始下标更小就说明顺序被破坏。'
  ],
  concepts: [
    {
      title: 'V8 的 Array.prototype.sort 稳定吗',
      md: 'ES2019 起规范要求 sort 必须稳定。V8 在数组长度 > 10 时用 TimSort（稳定的归并变体），所以现在可以依赖稳定性。\n\n但在更早的引擎里小数组用插入排序（稳定）、大数组用快排（不稳定）——面试答「稳定」要带上版本/年份。'
    },
    {
      title: '哈希冲突的两种解法',
      md: '拉链法：每个桶挂一条链表（或红黑树），冲突时往桶里加。实现简单，删除方便。\n\n开放寻址：冲突时往后找空位（线性探测），缓存友好但删除要用墓碑标记。Redis 的 dict 用拉链，Java HashMap 用拉链 + 红黑树。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '复杂度与双指针',
      think: '先把「循环形状 → 大 O」的映射写出来，再写一个有序数组的双指针。这两个合在一起正好是「同一问题的两种复杂度方案」。',
      hint: 'kind 里 linear 出现几次就是 n 的几次方；有 log 时乘上 log。',
      code: L1C1,
      test: L1S1,
      diag: [
        '把并列的循环也当成嵌套相乘（并列应该取最大）。',
        'linear 出现 2 次时返回 O(n) 而不是 O(n^2)。',
        '双指针的移动条件写反（sum < target 时 j--）。',
        '没处理数组为空的情况，i/j 初值越界。',
        '返回了元素值而不是期望的配对（这里是值，注意题意）。',
        'O(1) 判成 O(n)：const 层没有被过滤掉。'
      ]
    },
    {
      n: 2,
      title: '拉链哈希表与扩容',
      think: 'set 时如果 key 已存在要覆盖而不是追加；size 只在新键时增加；负载因子超 0.75 就把桶翻倍并重建。',
      hint: 'hashOf 累加 charCode 后取模；扩容时新建数组、遍历旧桶逐条 put 进去。',
      code: L1C2,
      test: L1S2,
      diag: [
        '同 key 重复 set 追加到了桶里（应该覆盖 value）。',
        '扩容后没有重建，旧元素按旧模数还留在原位，查不到。',
        '负载因子用了 size * count（应该是 size / count）。',
        'delete 没有从桶里真正移除，size 也没减。',
        'hashOf 的取模写在了循环外，中间结果溢出丢失。'
      ]
    },
    {
      n: 3,
      title: '堆 TopK 与稳定排序',
      think: '小顶堆维护 k 个最大的：每个新元素入堆，堆满 k 后弹掉最小的。稳定排序用归并（相等时取左），再用原始下标检查稳定性。',
      hint: 'push 上浮、pop 下沉；归并时 `keyOf(left) <= keyOf(right)` 取左边就保证稳定。',
      code: L1C3,
      test: L1S3,
      diag: [
        'TopK 直接全排序再 slice（k 小时浪费）。',
        '用了大顶堆，结果拿到的是最小的 k 个。',
        '堆的 pop 没有把最后一个元素放到堆顶再下沉。',
        '归并排序相等时取了右边（不稳定）。',
        'isStable 比较了值而不是原始下标。'
      ]
    }
  ],
  skeleton: `function complexityOf(loops) {
  // TODO: 嵌套循环层数 → 大 O
  throw new Error('complexityOf 还没实现')
}

function twoSumSorted(arr, target) {
  // TODO: 有序数组双指针
  throw new Error('twoSumSorted 还没实现')
}

function createHashTable(buckets) {
  // TODO: 拉链法 + 负载因子扩容
  throw new Error('createHashTable 还没实现')
}

function topK(arr, k) {
  // TODO: 小顶堆维持 k 个最大
  throw new Error('topK 还没实现')
}`,
  solution: L1C3,
  finalCode: L1C3,
  tests: `${L1S1}\n${L1S2}\n${L1S3}`
}

/* ============================================================ 第 2 关 */
const LV2 = {
  id: 'lv2',
  title: '树、类型转换与作用域：三块最容易「答得像」的地方',
  emoji: '🌳',
  xp: 50,
  goal: '实现树的深度/层序/BST 判定，手动复刻 == 的转换规则，并判定提升与 TDZ 行为。',
  why: '这三块是面试里的「软知识」：谁都能说「== 会隐式转换」，但说不出 null == undefined 为什么成立、[] == ![] 为什么是 true；谁都知道「有变量提升」，但说不清 let 的 TDZ 和函数声明提升的差别。这一关把它们写成可执行的判定器。',
  nodes: ['fe.js.dsa.tree', 'fe.js.basics', 'fe.js.basics.coercion', 'fe.js.scope', 'fe.js.scope.hoisting'],
  thinking: [
    {
      title: 'BST 判定必须用「中序递增」而不是「左右比较」',
      md: '只比较 node.left < node 和 node.right > node 是错的：左子树里可能出现比根更大的节点（比如根 10、左子 5、左子右孙 12）。\n\n正确做法是中序遍历，检查序列严格递增。这等价于「每个节点都在允许的取值区间内」。'
    },
    {
      title: '== 的规则是有序的，不是对称的直觉',
      md: "null/undefined 只与彼此相等；数字 vs 字符串按数值比；布尔先转数字；对象 vs 原始值走 ToPrimitive（valueOf → toString）。\n\n所以 `[] == ![]` 为 true：右边 ![] 得 false，再 Number(false)=0；左边 [] ToPrimitive 得空串，Number('')=0。"
    }
  ],
  prereq: [
    {
      title: 'ToPrimitive 的顺序',
      md: '普通对象默认走 valueOf（返回自己不算）→ toString（得到 "[object Object]"）。数组的 toString 约等于 join。这就是 `[1,2] == "1,2"` 成立的原因。'
    },
    {
      title: 'TDZ 是「已绑定但未初始化」',
      md: 'let/const 的变量从块开始就存在于作用域里（所以会遮蔽外层的同名变量），但直到声明那一行才初始化。这中间的窗口叫暂时性死区，访问会抛 ReferenceError。'
    }
  ],
  api: [
    {
      name: 'treeDepth / levelOrder / isBst',
      sig: 'treeDepth(root) => number；levelOrder(root) => number[]；isBst(root) => boolean',
      args: 'root 是 { v, left?, right? }。',
      returns: 'depth 是节点层数（空树 0）；levelOrder 按层从左到右。',
      example: 'treeDepth({ v: 1 })  // 1\nlevelOrder(TREE)      // [4, 2, 6, 1, 3, 5, 7]'
    },
    {
      name: 'looseEqual',
      sig: 'looseEqual(a, b) => boolean',
      args: '任意值。',
      returns: '等价于 a == b 的语义（不复用原生 ==）。',
      example: "looseEqual([], '')        // true\nlooseEqual(null, 0)        // false\nlooseEqual(NaN, NaN)       // false"
    },
    {
      name: 'hoistEffects / duplicateErrors',
      sig: 'hoistEffects(decls) => [{ name, hoisted, beforeDecl }]',
      args: 'decls 每项 { kind, name }，kind 取 var/let/const/function。',
      returns: 'beforeDecl 取 undefined / callable / ReferenceError。',
      example: "hoistEffects([{ kind: 'let', name: 'y' }])\\n// [{ name: 'y', hoisted: false, beforeDecl: 'ReferenceError' }]"
    }
  ],
  usage: '// 判断 == 的坑时，直接问自己三个问题：\n// 1) 有没有 null/undefined？只与彼此相等\n// 2) 有没有布尔？先转数字\n// 3) 有没有对象？先 ToPrimitive\n\n// 面试题：\n[] == ![]    // true\n[] == 0      // true\nnull == 0    // false',
  hints: [
    '第 1 步：isBst 用闭包 prev 做中序检查，注意 prev 初始为 null 而不是 0（值可能是 0）。',
    '第 2 步：先短路 null/undefined 与同类型，剩下的统一转原始值再转数字比。',
    '第 3 步：beforeDecl 只由 kind 决定；TDZ 是 let/const，函数声明整体提升。'
  ],
  concepts: [
    {
      title: '为什么 `typeof null === "object"`',
      md: 'JS 最初用低位标记类型，对象的标记是 000，而 null 的机器表示是全 0——所以 typeof 把它当成了对象。这是历史遗留 bug，为兼容性一直没修。'
    },
    {
      title: '函数声明提升 vs 函数表达式',
      md: '`function f(){}` 是函数声明，整个函数体提升，调用在前也没问题；`var f = function(){}` 只提升 var 的 undefined，提前调用会报「f is not a function」。\n\n块级的函数声明在严格模式下只在块内有效——这是 ES6 修掉的一个老坑。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '树的三种走法',
      think: '深度递归、层序用队列、BST 用中序。三个都是模板题，但 BST 的「用中序」是最容易被面试官抓的一个点。',
      hint: 'isBst 用一个外层 prev 变量，中序递归里比较 prev >= node.v 就置 ok=false。',
      code: L2C1,
      test: L2S1,
      diag: [
        'isBst 只比较了父子节点，左子树的右孙没检查。',
        'prev 初始化成 0，遇到负值时误判。',
        'levelOrder 用了栈（变成 DFS 顺序）。',
        'treeDepth 空树返回 1 而不是 0。',
        'isBst 遍历时没有提前退出，坏树也返回 true。'
      ]
    },
    {
      n: 2,
      title: '== 的转换',
      think: '按规则的优先级逐条实现：null/undefined → 同类型 → ToPrimitive → 全转数字。这是唯一能不依赖原生 == 又还原语义的方法。',
      hint: 'toPrimitive：数组 join，对象 String()；最后 Number(pa) === Number(pb)。',
      code: L2C2,
      test: L2S2,
      diag: [
        '把 null 与 undefined 以外的值也判成相等（null 只等于 undefined）。',
        '同类型直接 return a === b 会让 NaN 得到 true（NaN === NaN 是 false，这里恰好对）。',
        '对象没有走 ToPrimitive，直接转数字得到 NaN。',
        '数组 ToPrimitive 用了 String() 但没 join，[1,2] 变成 "1,2" 其实 String 也是这个——重点是别用 valueOf。',
        "' 1 ' 没被 Number 正确解析（Number 会 trim，自己实现要去空格）。"
      ]
    },
    {
      n: 3,
      title: '提升与块作用域',
      think: '三种声明三种行为：var 提升为 undefined、function 整体可用、let/const 进 TDZ。块作用域和重复声明是两道附加题。',
      hint: 'beforeDecl 由 kind 直接映射；duplicateErrors 里 var 跳过、let/const 同名同 kind 记错。',
      code: L2C3,
      test: L2S3,
      diag: [
        '把 let 也当成提升为 undefined（TDZ 会抛 ReferenceError）。',
        '函数声明判成 callable 之外的错误值。',
        'blockVisible 把 var 判成不可见（var 会泄漏出块）。',
        'duplicateErrors 把 var 重复也记成错误。',
        'duplicateErrors 用 name 做 key，var a 与 let a 混在一起（应该按 kind 分）。'
      ]
    }
  ],
  skeleton: `function treeDepth(root) {
  // TODO: 递归深度
  throw new Error('treeDepth 还没实现')
}

function levelOrder(root) {
  // TODO: 队列层序
  throw new Error('levelOrder 还没实现')
}

function isBst(root) {
  // TODO: 中序递增检查
  throw new Error('isBst 还没实现')
}

function looseEqual(a, b) {
  // TODO: 还原 == 的转换规则
  throw new Error('looseEqual 还没实现')
}

function hoistEffects(decls) {
  // TODO: var/function/let 三类提升行为
  throw new Error('hoistEffects 还没实现')
}`,
  solution: L2C3,
  finalCode: L2C3,
  tests: `${L2S1}\n${L2S2}\n${L2S3}`
}

/* ============================================================ 第 3 关测试 */
const L3S1 = `{
  check('自有属性 depth 为 0', () => {
    const chain = [{ name: 'dog', own: { bark: 1 } }]
    same(lookupProto(chain, 'bark').depth, 0)
    same(lookupProto(chain, 'bark').owner, 'dog')
  })
  check('原型上的属性沿链查找，depth 递增', () => {
    const chain = [{ name: 'dog', own: {} }, { name: 'animal', own: { eat: 1 } }]
    const r = lookupProto(chain, 'eat')
    same(r.found, true)
    same(r.depth, 1)
    same(r.owner, 'animal')
  })
  check('找不到返回 found=false', () => {
    same(lookupProto([{ name: 'dog', own: {} }], 'fly').found, false)
  })
  check('instanceof 沿原型链找构造器', () => {
    const chain = [{ name: 'dog', ctor: 'Dog' }, { name: 'animal', ctor: 'Animal' }]
    same(instanceOf(chain, 'Animal'), true)
    same(instanceOf(chain, 'Object'), false)
  })
  check('链末端是 null：内置属性不在链上就找不到', () => {
    same(lookupProto([{ name: 'dog', own: {} }], 'toString').found, false)
  })
}`

const L3S2 = `{
  check('同步先跑，微任务再跑，宏任务最后', () => {
    same(runLoop([
      { type: 'sync', name: 'A' },
      { type: 'macro', name: 'B' },
      { type: 'sync', name: 'C' },
      { type: 'micro', name: 'D' }
    ]), ['A', 'C', 'D', 'B'])
  })
  check('微任务里新排的微任务在同一次清空里跑完', () => {
    same(runLoop([
      { type: 'micro', name: 'm1', spawn: [{ type: 'micro', name: 'm2' }] },
      { type: 'macro', name: 't' }
    ]), ['m1', 'm2', 't'])
  })
  check('多个宏任务按入队顺序执行', () => {
    same(runLoop([{ type: 'macro', name: 't1' }, { type: 'macro', name: 't2' }]), ['t1', 't2'])
  })
  check('宏任务里排的微任务在下一个宏任务之前跑', () => {
    same(runLoop([
      { type: 'macro', name: 't1', spawn: [{ type: 'micro', name: 'm1' }] },
      { type: 'macro', name: 't2' }
    ]), ['t1', 'm1', 't2'])
  })
  check('空脚本不产生任何执行', () => {
    same(runLoop([]), [])
  })
}`

const L3S3 = `{
  check('捕获从外到内，冒泡从内到外', () => {
    const r = propagationOrder(['root', 'list', 'btn'])
    same(r.map((x) => x.node + ':' + x.phase), [
      'root:capture', 'list:capture', 'btn:target', 'list:bubble', 'root:bubble'
    ])
  })
  check('stopPropagation 在冒泡阶段截断后续', () => {
    const r = propagationOrder(['root', 'list', 'btn'], { stopAt: 'list' })
    same(r.map((x) => x.node), ['root', 'list', 'btn', 'list'])
  })
  check('单节点只有 target 阶段', () => {
    same(propagationOrder(['root']).map((x) => x.node + ':' + x.phase), ['root:target'])
  })
  check('事件委托：从 target 往上找匹配元素', () => {
    const path = [{ tag: 'span' }, { tag: 'li', class: 'item' }, { tag: 'ul', class: 'list' }]
    same(delegateHit(path, '.item'), 1)
    same(delegateHit(path, '.list'), 2)
  })
  check('没有匹配返回 -1', () => {
    same(delegateHit([{ tag: 'span' }], '.item'), -1)
    same(delegateHit([], '.item'), -1)
  })
}`

/* ============================================================ 第 3 关代码 */
const L3C1 = `function lookupProto(chain, prop) {
  for (let i = 0; i < chain.length; i++) {
    const node = chain[i]
    if (Object.prototype.hasOwnProperty.call(node.own || {}, prop)) {
      return { found: true, depth: i, owner: node.name, value: node.own[prop] }
    }
  }
  return { found: false, depth: -1, owner: null, value: undefined }
}

function instanceOf(chain, ctorName) {
  for (const node of chain) {
    if (node.ctor === ctorName) return true
  }
  return false
}`

const L3C2 = `${L3C1}

function runLoop(items) {
  const order = []
  const micro = []
  const macro = []
  let syncIndex = 0

  for (const item of items) {
    if (item.type === 'sync') order.push(item.name)
    else if (item.type === 'micro') micro.push(item)
    else macro.push(item)
    syncIndex++
  }

  const drainMicro = () => {
    while (micro.length) {
      const task = micro.shift()
      order.push(task.name)
      for (const s of task.spawn || []) {
        if (s.type === 'micro') micro.push(s)
        else macro.push(s)
      }
    }
  }

  drainMicro()
  while (macro.length) {
    const task = macro.shift()
    order.push(task.name)
    for (const s of task.spawn || []) {
      if (s.type === 'micro') micro.push(s)
      else macro.push(s)
    }
    drainMicro()
  }
  return order
}`

const L3C3 = `${L3C2}

function propagationOrder(path, opts) {
  const out = []
  const stopAt = (opts && opts.stopAt) || null
  const last = path.length - 1
  if (last < 0) return out

  for (let i = 0; i < last; i++) out.push({ node: path[i], phase: 'capture' })
  out.push({ node: path[last], phase: 'target' })
  for (let i = last - 1; i >= 0; i--) {
    out.push({ node: path[i], phase: 'bubble' })
    if (path[i] === stopAt) return out
  }
  return out
}

function delegateHit(path, selector) {
  const isClass = selector.charAt(0) === '.'
  const target = isClass ? selector.slice(1) : selector
  for (let i = 0; i < path.length; i++) {
    const node = path[i]
    if (isClass ? node.class === target : node.tag === target) return i
  }
  return -1
}`

/* ============================================================ 第 3 关 */
const LV3 = {
  id: 'lv3',
  title: '原型链、事件循环与 DOM 事件流',
  emoji: '🔗',
  xp: 50,
  goal: '实现原型链属性查找与 instanceof、模拟微任务/宏任务执行顺序，以及事件捕获冒泡与委托命中。',
  why: '这三块是「运行时」知识，光背结论会被追问细节：原型链查找的终点是什么、await 之后为什么在同一次微任务清空里、stopPropagation 到底停在哪一段。把它们写成代码以后，这些细节就不再是记忆而是可验证的行为。',
  nodes: ['fe.js.oop', 'fe.js.oop.prototype', 'fe.js.async', 'fe.js.dom', 'fe.js.dom.dom-api', 'fe.js.dom.event'],
  thinking: [
    {
      title: '原型链是「沿 __proto__ 往上找，直到 null」',
      md: '访问 obj.x 时：先看自有属性，没有就沿原型链往上，每个节点都查自己的属性表，直到 null 结束。所以「属性在原型上」意味着读取有额外的一次或多次跳转，而写入永远写在自有属性上（除非用 setter）。\n\ninstanceof 则是查「构造器的 prototype 是否在对象的原型链上」——本质是同一次遍历，只是匹配的是节点身份。'
    },
    {
      title: '事件循环的顺序是「一次宏任务 → 清空微任务」',
      md: '每个宏任务执行完，都会把微任务队列**完全清空**（包括清空过程中新加入的微任务），然后才取下一个宏任务。所以 Promise.then 永远比 setTimeout 先执行，且嵌套的 then 也排在下一个宏任务之前。'
    }
  ],
  prereq: [
    {
      title: 'hasOwnProperty 的调用方式',
      md: '直接 `node.own.hasOwnProperty(prop)` 在对象有同名属性时会被劫持；安全写法是 `Object.prototype.hasOwnProperty.call(node.own, prop)`。'
    },
    {
      title: '事件流的三段',
      md: '捕获（从 window 往目标）→ 目标（不区分捕获冒泡，触发两次监听）→ 冒泡（从目标往 window）。`addEventListener(el, fn, true)` 或 `{ capture: true }` 注册的是捕获阶段监听。'
    }
  ],
  api: [
    {
      name: 'lookupProto / instanceOf',
      sig: 'lookupProto(chain, prop) => { found, depth, owner, value }；instanceOf(chain, ctorName) => boolean',
      args: 'chain 从最具体到最基类，每项 { name, own, ctor }。',
      returns: 'depth 是在链上的第几层（自有为 0）；找不到 found=false。',
      example: "lookupProto([{ name: 'dog', own: {} }, { name: 'animal', own: { eat: 1 } }], 'eat')\\n// { found: true, depth: 1, owner: 'animal' }"
    },
    {
      name: 'runLoop',
      sig: 'runLoop(items) => string[]',
      args: 'items 每项 { type: sync|micro|macro, name, spawn? }，spawn 是该任务里新排的任务。',
      returns: '实际执行顺序。',
      example: "runLoop([{ type: 'macro', name: 'B' }, { type: 'micro', name: 'D' }])\\n// ['D', 'B']"
    },
    {
      name: 'propagationOrder / delegateHit',
      sig: 'propagationOrder(path, opts?) => [{ node, phase }]；delegateHit(path, selector) => index',
      args: 'path 从最外层到目标；stopAt 指定在冒泡阶段截断的节点；selector 支持 .class 或 tag。',
      returns: 'delegateHit 返回匹配节点下标，没有则 -1。',
      example: "propagationOrder(['root', 'list', 'btn'])\\n// root:capture, list:capture, btn:target, list:bubble, root:bubble"
    }
  ],
  usage: '// 事件委托：只在容器上挂一个监听\nlist.addEventListener(\'click\', (e) => {\n  const hit = delegateHit(pathOf(e.target), \'.item\')\n  if (hit >= 0) handle(hit)\n})\n\n// 微任务与宏任务的经典顺序：\nconsole.log(1)\nsetTimeout(() => console.log(2))\nPromise.resolve().then(() => console.log(3))\nconsole.log(4)\n// 1 4 3 2',
  hints: [
    '第 1 步：hasOwnProperty 要用 Object.prototype.hasOwnProperty.call，避免被自有属性劫持。',
    '第 2 步：先把 sync 按顺序输出，再 drain 微任务队列（里面可能继续 push），最后逐个宏任务并 drain。',
    '第 3 步：捕获段不检查 stopAt（stopPropagation 只在冒泡段生效），目标段只 push 一次。'
  ],
  concepts: [
    {
      title: '为什么 await 之后的代码是微任务',
      md: 'async 函数里 `await` 之后的部分相当于挂在 promise.then 上，所以它是微任务。这解释了为什么 `await null` 后面的代码也排在 setTimeout 之前。\n\n由此推出的实战结论：连续 await 多个接口时，每一段之间都会让出微任务队列——不是自动并行，要显式 Promise.all。'
    },
    {
      title: '事件委托为什么能省内存',
      md: '给 1000 个列表项各挂一个监听器，就是 1000 个闭包 + 1000 次注册；在容器上挂一个，靠冒泡统一处理，只占一份。\n\n代价是「命中判断要自己做」（向上找 selector），且不冒泡的事件（focus、mouseenter）不能用委托。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '原型链查找',
      think: '把链当成数组遍历：每层检查自有属性，命中就返回 depth。instanceof 换成匹配 ctor 字段。两个函数本质是同一次遍历。',
      hint: 'Object.prototype.hasOwnProperty.call(node.own || {}, prop) 是安全写法。',
      code: L3C1,
      test: L3S1,
      diag: [
        '用了 node.own.hasOwnProperty，自有属性同名时抛错。',
        'depth 从 1 开始算（自有属性应该是 0）。',
        '命中后继续遍历，返回了最后一层的 owner。',
        'instanceOf 只查了链的第一层。',
        '没处理 own 为 undefined 的节点。'
      ]
    },
    {
      n: 2,
      title: '事件循环顺序',
      think: '三段结构：先把同步任务按出现顺序输出，再清空微任务队列，再逐个处理宏任务；每个宏任务执行完后还要再清空微任务。',
      hint: 'drainMicro 用 while(micro.length) 循环——清空过程中新 push 的也会被处理。',
      code: L3C2,
      test: L3S2,
      diag: [
        '微任务只处理了初始队列，没有处理执行中新 push 的。',
        '宏任务先于微任务执行（顺序反了）。',
        '宏任务之间没有 drain 微任务。',
        '同步任务的输出顺序按类型分组了（应该按出现顺序）。',
        'spawn 出来的任务没有按 type 分派到对应队列。'
      ]
    },
    {
      n: 3,
      title: '事件流与委托',
      think: '捕获段从外到内（不含目标）、目标段一次、冒泡段从内到外。stopPropagation 只在冒泡段检查（本关简化）。委托就是从 target 往上找第一个匹配。',
      hint: 'capture 循环 i < last；target push 一次；bubble 循环从 last-1 到 0。',
      code: L3C3,
      test: L3S3,
      diag: [
        '目标节点在捕获段也 push 了一次（应该只出现在 target 段）。',
        '冒泡段循环方向错了（从外到内）。',
        'stopAt 在捕获段就截断，导致目标都没触发。',
        'delegateHit 从外往里找（应该从 target 往外）。',
        '空 path 时 path[last] 为 undefined，输出了一个假节点。'
      ]
    }
  ],
  skeleton: `function lookupProto(chain, prop) {
  // TODO: 沿原型链查找属性
  throw new Error('lookupProto 还没实现')
}

function instanceOf(chain, ctorName) {
  // TODO: 沿链匹配构造器
  throw new Error('instanceOf 还没实现')
}

function runLoop(items) {
  // TODO: 同步 → 微任务清空 → 宏任务
  throw new Error('runLoop 还没实现')
}

function propagationOrder(path, opts) {
  // TODO: 捕获 / 目标 / 冒泡
  throw new Error('propagationOrder 还没实现')
}`,
  solution: L3C3,
  finalCode: L3C3,
  tests: `${L3S1}\n${L3S2}\n${L3S3}`
}

export default {
  id: 'fe-js',
  version: 3,
  domain: 'fe',
  cumulative: false,
  title: 'JS 内核：数据结构、类型系统与执行模型',
  emoji: '🟨',
  xp: 55,
  tagline: '3 关：复杂度/哈希/堆/稳定排序 → 树遍历/类型转换/作用域提升 → 原型链/事件循环/DOM 事件。',
  stack: ['JavaScript', '数据结构'],
  intro: '前端面试的 JS 部分最容易背串：说法都会、一问细节就含糊。这个项目把 JS 里最常被追问的三层拆成可跑的代码：算法层（复杂度、哈希、堆、稳定排序）、语义层（树遍历、== 转换、TDZ）、运行时层（原型链、事件循环、事件流）。',
  outcome: '你能手写拉链哈希表并解释扩容代价、用中序判定 BST、逐条复刻 == 的规则、说清 var/let/函数声明在提升上的差别。',
  levels: [LV1, LV2, LV3]
}