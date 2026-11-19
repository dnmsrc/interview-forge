/**
 * 内容源：公共难题 · 手写 LRU 缓存
 *
 * 这是「看起来简单、面试现场写不利索」的典型题。拆成三关：
 *   1) 先用 Map 把语义写对（不做性能要求）
 *   2) 单独写双向链表（哨兵节点的增删改）
 *   3) 合成 O(1) 版本
 * 三关各自独立：第 1 关的 Map 版就是 LRU 的「正确性参照」，
 * 第 3 关写完后可以拿同样的用例回头验证自己没写错。
 *
 * v3 分步制：每步写完就能跑测试，绿了再往下。
 */

/* ------------------------------------------------------------ 第 1 关测试 */
const L1S1 = `{
  const c = new LRUCache(2)

  check('存进去能读出来', () => {
    c.put('a', 1)
    same(c.get('a'), 1)
  })
  check('未命中返回 undefined', () => {
    same(c.get('nope'), undefined)
  })
}`

const L1S2 = `{
  const c = new LRUCache(2)
  c.put('a', 1)
  c.put('b', 2)

  check('get 命中后，这个 key 变成「最近使用」（Map 里被挪到末尾）', () => {
    c.get('a')
    same([...c.map.keys()], ['b', 'a'])
  })
}`

const L1S3 = `{
  check('get 命中后变成最近使用，淘汰时先淘汰别人', () => {
    const c = new LRUCache(2)
    c.put('a', 1); c.put('b', 2)
    c.get('a')
    c.put('c', 3)
    same(c.get('b'), undefined)
    same(c.get('a'), 1)
    same(c.get('c'), 3)
  })
  check('put 已存在的 key：更新值并且也算使用', () => {
    const c = new LRUCache(2)
    c.put('a', 1); c.put('b', 2)
    c.put('a', 9)
    c.put('c', 3)
    same(c.get('a'), 9)
    same(c.get('b'), undefined)
  })
  check('容量为 1 的边界', () => {
    const c = new LRUCache(1)
    c.put('a', 1)
    c.put('b', 2)
    same(c.get('a'), undefined)
    same(c.get('b'), 2)
  })
  check('反复写同一个 key 不会把顺序弄乱', () => {
    const c = new LRUCache(2)
    for (let i = 0; i < 5; i++) c.put('x', i)
    same(c.get('x'), 4)
    c.put('y', 1)
    c.put('z', 2)
    same(c.get('x'), undefined)
    same(c.get('y'), 1)
    same(c.get('z'), 2)
  })
}`

/* ------------------------------------------------------------ 第 2 关测试 */
const L2S1 = `{
  check('空表：size 为 0，head.next 是 tail', () => {
    const list = new DoublyLinkedList()
    same(list.size, 0)
    ok(list.head.next === list.tail)
    ok(list.tail.prev === list.head)
  })
  check('addFirst 之后，最新加的排在最前', () => {
    const list = new DoublyLinkedList()
    const a = new ListNode('a', 1)
    const b = new ListNode('b', 2)
    list.addFirst(a)
    list.addFirst(b)
    same(list.size, 2)
    ok(list.head.next === b, 'head.next 应该是最新加入的 b')
    ok(list.tail.prev === a, 'tail.prev 应该是最早加入的 a')
  })
}`

const L2S2 = `{
  check('remove 摘掉节点后 size 减少', () => {
    const list = new DoublyLinkedList()
    const a = new ListNode('a', 1)
    const b = new ListNode('b', 2)
    list.addFirst(a)
    list.addFirst(b)
    list.remove(a)
    same(list.size, 1)
    ok(list.tail.prev === b, '摘掉 a 之后，最后应该是 b')
  })
  check('moveToFirst 把节点提到最前，size 不变', () => {
    const list = new DoublyLinkedList()
    const a = new ListNode('a', 1)
    const b = new ListNode('b', 2)
    list.addFirst(a)
    list.addFirst(b)
    list.moveToFirst(a)
    same(list.size, 2)
    ok(list.head.next === a, 'a 应该被提到最前')
    ok(list.tail.prev === b, 'b 应该退到最后')
  })
}`

const L2S3 = `{
  check('removeLast 返回最后一个节点', () => {
    const list = new DoublyLinkedList()
    const a = new ListNode('a', 1)
    const b = new ListNode('b', 2)
    list.addFirst(a)
    list.addFirst(b)
    same(list.removeLast(), a)
    same(list.size, 1)
  })
  check('空表 removeLast 返回 null', () => {
    const list = new DoublyLinkedList()
    same(list.removeLast(), null)
    same(list.size, 0)
  })
  check('反复增删不会把链表弄断', () => {
    const list = new DoublyLinkedList()
    const nodes = []
    for (let i = 0; i < 5; i++) {
      const n = new ListNode(i, i)
      nodes.push(n)
      list.addFirst(n)
    }
    list.remove(nodes[2])
    list.moveToFirst(nodes[0])
    same(list.size, 4)
    let count = 0
    let cur = list.head.next
    while (cur !== list.tail) { count++; cur = cur.next }
    same(count, 4)
    let back = 0
    cur = list.tail.prev
    while (cur !== list.head) { back++; cur = cur.prev }
    same(back, 4)
  })
}`

/* ------------------------------------------------------------ 第 3 关测试 */
const L3S1 = `{
  const c = new LRUCache(2)

  check('存进去能读出来', () => {
    c.put('a', 1)
    same(c.get('a'), 1)
  })
  check('未命中返回 undefined', () => {
    same(c.get('nope'), undefined)
  })
}`

const L3S2 = `{
  check('get 命中后变成最近使用，淘汰时先淘汰别人', () => {
    const c = new LRUCache(2)
    c.put('a', 1); c.put('b', 2)
    c.get('a')
    c.put('c', 3)
    same(c.get('b'), undefined)
    same(c.get('a'), 1)
    same(c.get('c'), 3)
  })
  check('put 已存在的 key：更新值并且也算使用', () => {
    const c = new LRUCache(2)
    c.put('a', 1); c.put('b', 2)
    c.put('a', 9)
    c.put('c', 3)
    same(c.get('a'), 9)
    same(c.get('b'), undefined)
  })
  check('容量为 1 的边界', () => {
    const c = new LRUCache(1)
    c.put('a', 1)
    c.put('b', 2)
    same(c.get('a'), undefined)
    same(c.get('b'), 2)
  })
  check('反复写同一个 key 不会把链表弄乱', () => {
    const c = new LRUCache(2)
    for (let i = 0; i < 5; i++) c.put('x', i)
    same(c.get('x'), 4)
    c.put('y', 1)
    c.put('z', 2)
    same(c.get('x'), undefined)
    same(c.get('y'), 1)
    same(c.get('z'), 2)
    same(c.list.size, c.map.size)
  })
  check('淘汰之后内部结构仍然一致（Map 和链表没有脱节）', () => {
    const c = new LRUCache(2)
    c.put('a', 1); c.put('b', 2); c.put('c', 3); c.put('d', 4)
    same(c.list.size, c.map.size)
    same(c.list.size, 2)
    same(c.get('c'), 3)
    same(c.get('d'), 4)
    same(c.list.size, 2)
  })
}`

/** 第 1 关完整实现 */
const MAP_FINAL = `/**
 * 第 1 关 · Map 版 LRU
 *
 * 规则三条：
 *   1. get 命中 → 这个 key 变成「最近使用」
 *   2. put 已存在的 key → 更新值，也算一次使用
 *   3. put 新 key 且超容量 → 淘汰「最久未使用」的那个
 */
class LRUCache {
  constructor(capacity) {
    this.capacity = capacity
    this.map = new Map()
  }

  get(key) {
    if (!this.map.has(key)) return undefined
    const value = this.map.get(key)
    // 先删再插：Map 的遍历顺序 = 插入顺序，删后重插就挪到了末尾
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }

  put(key, value) {
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, value)
    if (this.map.size > this.capacity) {
      this.map.delete(this.map.keys().next().value)
    }
  }
}
`

/** 第 2 关完整实现 */
const LIST_FINAL = `/**
 * 第 2 关 · 带头尾哨兵的双向链表
 */
class ListNode {
  constructor(key, value) {
    this.key = key
    this.value = value
    this.prev = null
    this.next = null
  }
}

class DoublyLinkedList {
  constructor() {
    this.head = new ListNode(null, null)
    this.tail = new ListNode(null, null)
    this.head.next = this.tail
    this.tail.prev = this.head
    this._size = 0
  }

  get size() {
    return this._size
  }

  addFirst(node) {
    node.prev = this.head
    node.next = this.head.next
    this.head.next.prev = node
    this.head.next = node
    this._size++
  }

  remove(node) {
    node.prev.next = node.next
    node.next.prev = node.prev
    this._size--
  }

  moveToFirst(node) {
    this.remove(node)
    this.addFirst(node)
  }

  removeLast() {
    if (this._size === 0) return null
    const node = this.tail.prev
    this.remove(node)
    return node
  }
}
`

/** 第 3 关完整实现 */
const O1_FINAL = `${LIST_FINAL}
class LRUCache {
  constructor(capacity) {
    this.capacity = capacity
    this.map = new Map()
    this.list = new DoublyLinkedList()
  }

  get(key) {
    const node = this.map.get(key)
    if (!node) return undefined
    this.list.moveToFirst(node)
    return node.value
  }

  put(key, value) {
    const existing = this.map.get(key)
    if (existing) {
      existing.value = value
      this.list.moveToFirst(existing)
      return
    }

    const node = new ListNode(key, value)
    this.list.addFirst(node)
    this.map.set(key, node)

    if (this.map.size > this.capacity) {
      const old = this.list.removeLast()
      if (old) this.map.delete(old.key)
    }
  }
}
`

export default {
  id: 'lru-cache',
  version: 3,
  domain: 'cs',
  // 三关是「另一种实现」的关系，不是累积关系，所以不跑跨关回归
  cumulative: false,
  title: '手写 LRU 缓存',
  emoji: '♻️',
  tagline: '3 关：先用 Map 写对语义，再写双向链表，最后合成 get/put 都是 O(1) 的版本。',
  stack: ['JavaScript', '数据结构'],
  intro: 'LRU（最近最少使用）是大厂面试的高频题：题面两句话，写好要半小时。这一季把它拆开——先把「淘汰谁」的语义写对，再单独把双向链表练熟，最后合成。每一关都有测试盯着，写错哪一步立刻红。',
  outcome: '做完你能在面试里从零写出 O(1) 的 LRU，并且讲清楚为什么必须「Map + 双向链表」：Map 负责 O(1) 定位，链表负责 O(1) 维护使用顺序——数组做不到后者，因为中间删除是 O(n)。',
  levels: [
    /* ------------------------------------------------------------ 第 1 关 */
    {
      id: 'lv1',
      title: '先把语义写对：Map 版 LRU',
      emoji: '🗺️',
      xp: 40,
      goal: '用 Map 实现 LRUCache：get 命中要把 key 提到「最近使用」，put 超出容量要淘汰「最久未使用」的那个。',
      why: '很多人一上来就写双向链表，结果指针绕晕了、语义还是错的。正确顺序是先把行为定义清楚：命中之后顺序怎么变、满了淘汰谁、更新已有 key 算不算「又用了一次」。这一关用 Map 先把这些规则用测试钉死，第 3 关换成链表时就有参照。',
      thinking: [
        {
          title: '先问「最近使用」存哪，再问用什么数据结构',
          md: `LRU 的全部难点是一句话：**要知道谁最久没被用过**。这不是排序问题，是顺序维护问题。

Map 有一个可用的性质：遍历顺序 = 插入顺序。所以只要每次「使用」都把这个 key 删掉再插回去，末尾永远是最新的，第一个永远是最旧的。于是「淘汰谁」变成「删第一个 key」。

先确认这个性质成立，再谈性能——第 1 关不要求 O(1) 的说法其实是：Map 的 delete+set 也是 O(1)，但顺序控制是黑盒，这是第 3 关要换链表的原因。`
        },
        {
          title: '为什么 get 也要「算一次使用」',
          md: `如果只有 put 改变顺序，缓存就退化成 FIFO：读得最多的 key 反而因为写得早被淘汰。

所以 get 命中必须把 key 挪到末尾。这一条是最容易被漏掉的语义，也是我把它单独拆成第 2 步、并专门写一条「Map 键顺序」断言的原因——不单独验，你就只能靠「淘汰时看起来对」来猜。`
        },
        {
          title: '为什么先写 Map 版，而不是直接上链表',
          md: `链表版一写就是几十行指针操作，一旦行为不对，你分不清是「语义错」还是「指针错」。

用 Map 版把语义钉死（get 提位、put 更新算使用、满了淘汰最旧），第 3 关换成链表时，同一套测试可以直接复用：链表版只要过同一套用例就说明行为一致。**先有正确性参照，再谈实现方式**——这是这题最值钱的策略。`
        }
      ],
      prereq: [
        {
          title: 'Map 会记住插入顺序，这一点可以直接用',
          md: `JS 的 Map 保证：**遍历顺序 = 插入顺序**。所以「最久未使用」就是第一个 key：

\`\`\`js
const m = new Map([['a', 1], ['b', 2]])
m.keys().next().value   // 'a'，最早插入的
\`\`\`

而「把某个 key 变成最近使用」也有现成写法：先 delete 再 set，它就会被挪到末尾。

\`\`\`js
m.delete('a')
m.set('a', 1)   // 现在 a 在最后
\`\`\`

这套写法不难，但它依赖 Map 的这个特性——第 3 关换成链表，就是因为它不够快/不够可控。`
        },
        {
          title: 'LRU 的三条规则，一条都不能少',
          md: `1. **get 命中 → 该 key 变成最近使用**。不移动的话，「最近使用」的顺序就停在写入时刻，退化成 FIFO。
2. **put 一个已存在的 key → 更新值，并且也算一次使用**。只更新值不移动位置，是第二个常见错误。
3. **put 新 key 且超过容量 → 删掉最久未使用的那个**，再插入新的。

容量为 1 时这三条会同时发生，是最容易暴露 bug 的边界。`
        }
      ],
      api: [
        {
          name: 'LRUCache',
          sig: 'new LRUCache(capacity) / get(key): any | undefined / put(key, value): void',
          args: 'capacity —— 最多能存多少个 key（正整数）。get 的 key 任意；put 的 value 任意。',
          returns: 'get：命中返回对应值（并把该 key 提到最近使用），未命中返回 undefined。put：没有返回值。',
          example: `const cache = new LRUCache(2)
cache.put('a', 1)
cache.put('b', 2)
cache.get('a')        // 1，a 变成最近使用
cache.put('c', 3)     // 容量超了 → 淘汰最久未使用的 b

cache.get('b')        // undefined —— 被淘汰了
cache.get('a')        // 1 —— 还在
cache.get('c')        // 3`
        }
      ],
      stages: [
        {
          n: 1,
          title: '存下来、读出去',
          think: '先只做「能存能读」：构造函数存 capacity、初始化 Map，put 直接 set，get 直接 get。这一步不做任何顺序维护——先把数据类型和接口跑通，后面两步才有地方试。',
          hint: 'constructor 里 this.capacity = capacity、this.map = new Map()。put 直接 this.map.set(key, value)；get 用 this.map.get(key)（未命中自然是 undefined），不要额外判断。',
          diag: [
            'get 拿不到值：put 要真的 this.map.set(key, value)。',
            '未命中返回了 null 而不是 undefined：Map.get 未命中就是 undefined，别自己兜底。',
          ],
          vocab: [
            { term: 'Map 的 size', md: 'Map 实例属性，表示键值对数量，O(1) 读取。淘汰判断靠它。' }
          ],
          code: `/**
 * 第 1 关 · 第 1 步：能存能读
 */
class LRUCache {
  constructor(capacity) {
    this.capacity = capacity
    this.map = new Map()
  }

  get(key) {
    return this.map.get(key)
  }

  put(key, value) {
    this.map.set(key, value)
  }
}
`,
          test: L1S1
        },
        {
          n: 2,
          title: 'get 命中就把 key 挪到末尾',
          think: '现在让「读」也影响顺序。Map 里没有 move 方法，但「删了再插」等价于挪到末尾——这一步先只观察这个行为，淘汰留到下一步，避免一次改两件事。',
          hint: 'get 里：this.map.has(key) 为假直接返回 undefined；否则取出 value，this.map.delete(key)，this.map.set(key, value)，return value。',
          diag: [
            '键顺序没变：必须 delete 之后再 set，直接 get 不会改变顺序。',
          ],
          code: `/**
 * 第 1 关 · 第 2 步：get 命中即「最近使用」
 */
class LRUCache {
  constructor(capacity) {
    this.capacity = capacity
    this.map = new Map()
  }

  get(key) {
    if (!this.map.has(key)) return undefined
    const value = this.map.get(key)
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }

  put(key, value) {
    this.map.set(key, value)
  }
}
`,
          test: L1S2
        },
        {
          n: 3,
          title: 'put 更新算使用，超容量就淘汰最旧',
          think: '最后补 put 的完整语义：已存在的 key 要先删后插（等于更新并提位）；写完检查 size，超过 capacity 就删掉 Map 的第一个 key。容量为 1 的用例会同时压到这三条规则。',
          hint: 'put 里：if has(key) 先 delete；再 set；然后 if (this.map.size > this.capacity) this.map.delete(this.map.keys().next().value)。',
          diag: [
            '更新已有 key 后位置没变：put 已存在的 key 也要 delete 再 set。',
            '超容量没淘汰：写完要判断 size > capacity。',
            '淘汰的不是最久的：第一个 key 用 this.map.keys().next().value 取。',
            '容量 1 边界错了：先删除再插入，顺序不能反，否则会把自己删掉。',
          ],
          vocab: [
            { term: '迭代器取值', md: 'map.keys() 返回迭代器，.next().value 取第一个元素（最久未使用的 key）。' }
          ],
          code: MAP_FINAL,
          test: L1S3
        }
      ],
      finalCode: MAP_FINAL,
      usage: `const cache = new LRUCache(2)
cache.put('a', 1)
cache.put('b', 2)
cache.get('a')        // 1 → a 变成最近使用
cache.put('c', 3)     // 超出容量，淘汰最久未使用的 b

cache.get('b')        // undefined
cache.get('a')        // 1
cache.get('c')        // 3`,
      hints: [
        'this.map.keys().next().value 就是「最久未使用」的 key：迭代器从头开始，取第一个。',
        'get 里千万别直接 this.map.get(key) 就返回——那样顺序不变，第 3 条测试会红。',
        'put 已有 key 时先 delete 再 set，等价于「更新并提到最近」，比额外调一次 get 更清楚。'
      ],
      concepts: [
        {
          title: 'Map 版的时间复杂度',
          md: 'get / put 在 Map 上都是 O(1)，delete + set 也是 O(1)，所以这版其实也是 O(1)。那为什么面试还要求链表？因为在真实系统里，「最近使用顺序」通常需要额外信息（时间戳、命中次数、分段统计），Map 的插入顺序是黑盒，改不了；而链表节点可以挂任何字段，也便于做「分段 LRU」「带过期的 LRU」。这道题考的是你对数据结构的控制力。'
        }
      ],
      skeleton: `/**
 * 第 1 关 · 先把语义写对：Map 版 LRU
 *
 * 规则三条：
 *   1. get 命中 → 这个 key 变成「最近使用」
 *   2. put 已存在的 key → 更新值，也算一次使用
 *   3. put 新 key 且超容量 → 淘汰「最久未使用」的那个
 *
 * 提示：Map 的遍历顺序 = 插入顺序。最早插入的在最前面，最近 set 的在最后面。
 */
class LRUCache {
  constructor(capacity) {
    // TODO 1：存下 capacity，初始化一个 Map
  }

  get(key) {
    // TODO 2：命中 → 取出值、把它挪到 Map 末尾、return 值；未命中 return undefined
    return undefined
  }

  put(key, value) {
    // TODO 3：已存在先删掉；set 进去；如果 size 超过 capacity，删掉最久未使用的那个 key
  }
}
`,
      solution: MAP_FINAL,
      tests: [L1S1, L1S2, L1S3].join('\n\n')
    },
    /* ------------------------------------------------------------ 第 2 关 */
    {
      id: 'lv2',
      title: '双向链表：先学会「在中间 O(1) 摘掉一个节点」',
      emoji: '🔗',
      xp: 50,
      goal: '实现带头尾哨兵的双向链表 DoublyLinkedList：addFirst、remove、moveToFirst、removeLast、size。',
      why: 'LRU 需要频繁做两件事：「把某个节点移到最前」和「删掉最后一个」。数组做这两件事都要移动其余元素（O(n)）。双向链表只要有节点引用，改几个指针就是 O(1)——这就是它存在的唯一理由。这一关先把指针操作练熟，第 3 关才有零件可用。',
      thinking: [
        {
          title: '为什么先单独练链表，而不是直接进第 3 关',
          md: `第 3 关的 LRU 只有十几行，但它依赖的链表操作全是「改指针」——写错一个顺序，链表就断了，而症状会在十几个用例之后才冒出来。

单独练的好处是：链表的测试只检查 size、head.next、tail.prev 和「从头走到尾能不能回到尾」，指针断没断一眼就能看出来。零件独立可验证，拼装时才不用猜。`
        },
        {
          title: '为什么用哨兵节点，省掉的不是一行代码',
          md: `不用哨兵时，每次插入/删除都要先判断「是不是在头尾」：head 为空怎么办、只有一个节点怎么办、删的是最后一个怎么办。这些 if 正是指针 bug 的温床。

带哨兵之后，空链表就是 head.next === tail 且 tail.prev === head，插入删除永远不用判空。**用一个恒定的结构消掉一类分支**——这是链表实现里最值钱的技巧，也是面试官想听到的那句话。`
        },
        {
          title: 'remove 为什么只要两行',
          md: `摘掉一个节点，本质是让它的前驱和后继互相指：

\`node.prev.next = node.next; node.next.prev = node.prev\`

因为有哨兵，node.prev 和 node.next 永远存在，不需要判空。这两行 + size--，就是全部。

真正容易错的是 addFirst：必须先接 node 的两根线，再改 head.next 那两根——顺序反了，原来第一个节点就丢了。`
        }
      ],
      prereq: [
        {
          title: '为什么用「哨兵节点」而不是让 head 指向 null',
          md: `不用哨兵时，每次插入/删除都要先判断「是不是在头尾」，代码里全是 if，极容易写错。

带哨兵的做法是：链表里永远有两个不存数据的节点 head 和 tail，head.next 是第一个真实节点，tail.prev 是最后一个。

\`\`\`
head ⇄ node1 ⇄ node2 ⇄ tail
\`\`\`

于是「第一个节点」就是 head.next，「最后一个」就是 tail.prev，**增删操作永远不用判空**——空链表时 head.next === tail，一个删/插的通用写法就能覆盖所有情况。这是链表实现里最值钱的一个技巧。`
        },
        {
          title: '增删只改四条指针，顺序不能乱',
          md: `在一个节点 node 前后插入另一节点，本质就是「接上四条线」：

\`\`\`js
node.prev.next = node.next
node.next.prev = node.prev
\`\`\`

删除时只改两行：让前后两个节点互相指，node 自己就被「摘」出去了（它身上的指针可以不用清）。

写的时候容易漏掉某一头，尤其是忘了给 node.next 判空。有哨兵之后就没有空指针了——tail.prev 永远存在。`
        }
      ],
      api: [
        {
          name: 'ListNode / DoublyLinkedList',
          sig: 'new ListNode(key, value) / new DoublyLinkedList() / addFirst(node) / remove(node) / moveToFirst(node) / removeLast() / size',
          args: 'node 是键值节点 { key, value, prev, next }；addFirst 插到最前；remove 摘掉指定节点；moveToFirst 先摘再插到最前；removeLast 摘掉最后一个（空表返回 null）。',
          returns: 'addFirst / remove / moveToFirst 无返回值；removeLast 返回被摘掉的节点或 null；size 返回当前真实节点个数。',
          example: `const list = new DoublyLinkedList()
const a = new ListNode('a', 1)
const b = new ListNode('b', 2)

list.addFirst(a)
list.addFirst(b)       // 现在顺序是 b, a
list.size              // 2

list.moveToFirst(a)    // 顺序变成 a, b
list.removeLast()      // 返回 b，剩下的只有 a
list.size              // 1`
        }
      ],
      stages: [
        {
          n: 1,
          title: '哨兵初始化 + addFirst',
          think: '先搭骨架：两个哨兵互指、size 归零；再写插入。插入的四行顺序是最容易错的，我先在注释里把「先接 node 的两条，再改 head.next 那两条」写清楚再敲。',
          hint: '构造函数建 head、tail 两个 ListNode(null, null)，head.next = tail、tail.prev = head，this._size = 0；get size 返回 _size。addFirst：node.prev = head → node.next = head.next → head.next.prev = node → head.next = node → _size++。',
          diag: [
            '空表的 head.next 不是 tail：构造函数里要把两个哨兵互指。',
            'addFirst 之后 tail.prev 不对：更新 head.next 之前，先把原第一个节点的 prev 接到 node 上。',
          ],
          vocab: [
            { term: '哨兵节点（sentinel）', md: '不存数据、只为了让指针永远非空的头尾节点。有了它，插入删除不用判空。' }
          ],
          code: `/**
 * 第 2 关 · 第 1 步：哨兵 + addFirst
 */
class ListNode {
  constructor(key, value) {
    this.key = key
    this.value = value
    this.prev = null
    this.next = null
  }
}

class DoublyLinkedList {
  constructor() {
    this.head = new ListNode(null, null)
    this.tail = new ListNode(null, null)
    this.head.next = this.tail
    this.tail.prev = this.head
    this._size = 0
  }

  get size() {
    return this._size
  }

  addFirst(node) {
    node.prev = this.head
    node.next = this.head.next
    this.head.next.prev = node
    this.head.next = node
    this._size++
  }
}
`,
          test: L2S1
        },
        {
          n: 2,
          title: 'remove + moveToFirst',
          think: '现在写摘除和提位。remove 只有两行，但因为哨兵不用判空；moveToFirst 就是「先摘再插」，注意 size 一减一加正好抵消。',
          hint: 'remove(node)：node.prev.next = node.next；node.next.prev = node.prev；this._size--。moveToFirst(node)：先 this.remove(node)，再 this.addFirst(node)。',
          diag: [
            '摘除后 size 不对：remove 里 _size-- 不能漏。',
            '摘掉节点后链表断了：两行指针都要写，少一行就断在前驱或后继上。',
          ],
          code: `/**
 * 第 2 关 · 第 2 步：remove + moveToFirst
 */
class ListNode {
  constructor(key, value) {
    this.key = key
    this.value = value
    this.prev = null
    this.next = null
  }
}

class DoublyLinkedList {
  constructor() {
    this.head = new ListNode(null, null)
    this.tail = new ListNode(null, null)
    this.head.next = this.tail
    this.tail.prev = this.head
    this._size = 0
  }

  get size() {
    return this._size
  }

  addFirst(node) {
    node.prev = this.head
    node.next = this.head.next
    this.head.next.prev = node
    this.head.next = node
    this._size++
  }

  remove(node) {
    node.prev.next = node.next
    node.next.prev = node.prev
    this._size--
  }

  moveToFirst(node) {
    this.remove(node)
    this.addFirst(node)
  }
}
`,
          test: L2S2
        },
        {
          n: 3,
          title: 'removeLast：空表返回 null',
          think: '最后补「摘最后一个」。空表必须返回 null（第 3 关的淘汰依赖它）；非空时取 tail.prev 再 remove。这一步验收还要反向走一遍链表，确认 prev 指针没断——正向能走不等于反向也对。',
          hint: 'removeLast：if (this._size === 0) return null；const node = this.tail.prev；this.remove(node)；return node。',
          diag: [
            'removeLast 返回了 tail 哨兵：要取 tail.prev（最后一个真实节点）。',
            '空表 removeLast 报错：先判断 _size === 0 返回 null。',
            '反复增删后链表断了：正向、反向都要能走通，检查 remove 的两行是否都写了。',
          ],
          code: LIST_FINAL,
          test: L2S3
        }
      ],
      finalCode: LIST_FINAL,
      usage: `const list = new DoublyLinkedList()
const a = new ListNode('a', 1)
const b = new ListNode('b', 2)

list.addFirst(a)
list.addFirst(b)     // 顺序：b ⇄ a
list.size            // 2
list.head.next === b // true

list.moveToFirst(a)  // 顺序：a ⇄ b
list.removeLast()    // 返回 b
list.size            // 1`,
      hints: [
        'addFirst 的四行顺序不能互换：先设置 node 的 prev/next（此时 head.next 还没改），再改 head.next 和它的 prev。',
        'moveToFirst 里 remove 完 size 少 1，addFirst 又加回来；如果直接操作指针不调 remove，记得自己维护 size。',
        'size 用 getter 返回 this._size；不要暴露可写属性，否则测试里 size 和实际节点数可能对不上。'
      ],
      concepts: [
        {
          title: '这套结构为什么值得单独练一关',
          md: '双向链表是「中间热、两端也热」的场景下唯一能全 O(1) 的线性结构：LRU、浏览器历史、文本编辑器的 undo 栈、甚至内核的进程调度队列都用它。指针操作练熟之后，第 3 关的 LRU 就是「Map 存节点 + 链表维护顺序」两句话的事。'
        }
      ],
      skeleton: `/**
 * 第 2 关 · 双向链表
 *
 * 用头尾两个哨兵节点，消灭「空表」「只有一个节点」这些特判：
 *   head ⇄ node1 ⇄ node2 ⇄ tail
 * 第一个真实节点是 head.next，最后一个是 tail.prev。
 */

class ListNode {
  constructor(key, value) {
    this.key = key
    this.value = value
    this.prev = null
    this.next = null
  }
}

class DoublyLinkedList {
  constructor() {
    this.head = new ListNode(null, null)
    this.tail = new ListNode(null, null)
    this.head.next = this.tail
    this.tail.prev = this.head
    this._size = 0
  }

  get size() {
    return this._size
  }

  /** 插到最前面（head 之后） */
  addFirst(node) {
    // TODO 1：接四条指针：node.prev / node.next / 原来第一个节点的 prev / head.next，然后 _size++
  }

  /** 把指定节点从链表里摘掉（节点本身保留） */
  remove(node) {
    // TODO 2：让 node 的前后两个节点互相指；_size--
  }

  /** 把节点移到最前（最近使用） */
  moveToFirst(node) {
    // TODO 3：先 remove 再 addFirst
  }

  /** 摘掉最后一个节点并返回；空表返回 null */
  removeLast() {
    // TODO 3（同上）：空表返回 null；否则取 tail.prev，remove 它，返回它
    return null
  }
}
`,
      solution: LIST_FINAL,
      tests: [L2S1, L2S2, L2S3].join('\n\n')
    },
    /* ------------------------------------------------------------ 第 3 关 */
    {
      id: 'lv3',
      title: '合成 O(1) 版：Map 存节点 + 链表管顺序',
      emoji: '⚡',
      xp: 70,
      goal: '用「哈希表 + 双向链表」重写 LRUCache：get 和 put 都是 O(1)，并且通过第 1 关的全部行为测试。',
      why: '这一关把两个零件合起来，也是面试真正的答案形态：**Map 负责「key → 节点」的 O(1) 定位，链表负责「谁最近用过」的 O(1) 维护**。为什么缺一不可？只用 Map，你没法在 O(1) 里拿到「最久未使用」并把它删掉（Map 的插入顺序是黑盒）；只用链表，你找 key 要 O(n)。',
      thinking: [
        {
          title: '为什么两个结构要「共用同一个节点对象」',
          md: `最容易写错的版本是：Map 里存 value，链表里存 key。这样一改值就要改两处，删的时候还要两边找。

正确形态是 Map<key, node> 和链表节点是**同一个对象**：Map 负责「快速找到它」，链表负责「快速挪动它」。一份数据、两个索引，不存在同步问题。这也是所有「索引 + 有序结构」设计的共同套路。`
        },
        {
          title: '淘汰为什么要「两边一起删」',
          md: `list.removeLast() 只是把节点从链表里摘掉，Map 里还留着 key → node。忘了 map.delete 有两个后果：内存泄漏；更隐蔽的是同一个 key 再 put 时命中旧节点，而旧节点已经不在链表里，moveToFirst 会把一个游离节点插回去，链表和 Map 从此不一致。

所以淘汰固定两步：拿到 old 节点 → 从 Map 删它的 key。测试里专门有一条 same(c.list.size, c.map.size) 盯这个。`
        },
        {
          title: '为什么这题面试要看「先跑第 1 关的用例」',
          md: `链表版的对外行为和 Map 版必须完全一致。写完不要只看新写的测试——直接拿第 1 关的用例再跑一遍，任何一条对不上都说明链表版有 bug。

这种「用旧契约验证新实现」的习惯，比多写十个用例更能防回归。`
        }
      ],
      prereq: [
        {
          title: '两个结构各管一件事，靠节点连起来',
          md: `\`\`\`
Map: key → node
链表: head ⇄ node(最近) ⇄ ... ⇄ node(最旧) ⇄ tail
\`\`\`

- get(key)：Map 拿到 node（O(1)）→ moveToFirst(node)（O(1)）→ 返回 node.value
- put(key, value)：Map 里有没有？
  - 有：改 node.value，moveToFirst
  - 没有：new 一个 node → addFirst → Map.set；超容量则 removeLast 并从 Map 里删掉它的 key

关键点是**两个结构通过同一个节点对象共享身份**，不要在 Map 里存值、链表里再存一份值：那样一改就要改两处，必然有一天漏掉。`
        },
        {
          title: '淘汰时要「两边一起删」',
          md: `removeLast() 只把节点从链表里摘掉，Map 里还留着 key → node 的映射。如果忘了 \`map.delete(node.key)\`：

- 内存泄漏（Map 一直持有旧节点）
- 更隐蔽的 bug：同一个 key 再 put 时命中旧节点，而旧节点已经不在链表里，moveToFirst 会把一个「游离节点」插回去，链表和 Map 从此不一致。

所以淘汰必须是两步：\`const old = list.removeLast(); if (old) map.delete(old.key)\`。`
        }
      ],
      api: [
        {
          name: 'LRUCache（O(1) 版）',
          sig: 'new LRUCache(capacity) / get(key) / put(key, value) —— 与第 1 关完全相同的对外行为',
          args: '同第 1 关。内部实现换成 Map<key, ListNode> + DoublyLinkedList。',
          returns: '同第 1 关：get 命中返回值，未命中 undefined；put 无返回。',
          example: `const cache = new LRUCache(2)
cache.put('a', 1)
cache.put('b', 2)
cache.get('a')      // 1，a 变成最近
cache.put('c', 3)   // 淘汰 b

cache.get('b')      // undefined
// 内部：map 里有 a、c；链表 head ⇄ c ⇄ a ⇄ tail（c 最近）`
        }
      ],
      stages: [
        {
          n: 1,
          title: '接上 get：Map 定位 → 链表提位',
          think: '先把「读」接起来：Map 拿到节点、链表 moveToFirst、返回 node.value。这一步先不做已有 key 的更新和淘汰——那是写路径的事。',
          hint: 'get：const node = this.map.get(key)；if (!node) return undefined；this.list.moveToFirst(node)；return node.value。构造函数里 capacity、map、list 三样都要初始化。',
          diag: [
            'get 读出来是节点对象：要返回 node.value，不是 node。',
            '未命中报错：先判断 !node 返回 undefined。',
          ],
          code: `/**
 * 第 3 关 · 第 1 步：接上 get
 */
class ListNode {
  constructor(key, value) {
    this.key = key
    this.value = value
    this.prev = null
    this.next = null
  }
}

class DoublyLinkedList {
  constructor() {
    this.head = new ListNode(null, null)
    this.tail = new ListNode(null, null)
    this.head.next = this.tail
    this.tail.prev = this.head
    this._size = 0
  }

  get size() { return this._size }

  addFirst(node) {
    node.prev = this.head
    node.next = this.head.next
    this.head.next.prev = node
    this.head.next = node
    this._size++
  }

  remove(node) {
    node.prev.next = node.next
    node.next.prev = node.prev
    this._size--
  }

  moveToFirst(node) {
    this.remove(node)
    this.addFirst(node)
  }

  removeLast() {
    if (this._size === 0) return null
    const node = this.tail.prev
    this.remove(node)
    return node
  }
}

class LRUCache {
  constructor(capacity) {
    this.capacity = capacity
    this.map = new Map()
    this.list = new DoublyLinkedList()
  }

  get(key) {
    const node = this.map.get(key)
    if (!node) return undefined
    this.list.moveToFirst(node)
    return node.value
  }

  put(key, value) {
    const node = new ListNode(key, value)
    this.list.addFirst(node)
    this.map.set(key, node)
  }
}
`,
          test: L3S1
        },
        {
          n: 2,
          title: '接上 put：更新、淘汰、两边一起删',
          think: '补完写路径：已存在的 key 更新值并提位；新 key 走建节点/插队/set；超容量时 removeLast 并且从 Map 删掉它的 key。最后一条内部一致性断言专门抓「只删了链表、忘了删 Map」这个经典 bug。',
          hint: 'put：existing = map.get(key)，有就改 value + moveToFirst + return；否则 new node、addFirst、map.set；然后 if (map.size > capacity) { const old = list.removeLast(); if (old) map.delete(old.key) }。',
          diag: [
            'put 已存在 key 时更新了值但没提位：先改 value，再 moveToFirst。',
            '超容量没淘汰：判断 this.map.size > this.capacity。',
            '淘汰只删了链表没删 Map：removeLast 之后要 map.delete(old.key)，否则内部结构脱节。',
            '容量 1 时把刚插入的删了：先 set 再判断，淘汰的是最旧（tail.prev）。',
            '反复写同一个 key 后结构乱了：已存在的 key 不能新建节点，必须复用。',
          ],
          code: O1_FINAL,
          test: L3S2
        }
      ],
      finalCode: O1_FINAL,
      usage: `const cache = new LRUCache(2)
cache.put('a', 1)
cache.put('b', 2)
cache.get('a')        // a 变成最近使用
cache.put('c', 3)     // 淘汰最旧的 b

cache.get('b')        // undefined
cache.list.size === cache.map.size   // true：结构一致`,
      hints: [
        '构造顺序：先 this.capacity，再 this.map = new Map()，最后 this.list = new DoublyLinkedList()。',
        '淘汰时 `if (old)` 判断不能省：removeLast 在空表时返回 null，空表上 map.delete(undefined) 不会报错，但语义是错的。',
        '写完自己跑一遍第 1 关那套用例：两版的行为必须完全一致，任何一条对不上都说明链表版有 bug。'
      ],
      concepts: [
        {
          title: '面试里怎么讲这道题',
          md: '先给结论再讲理由：「Map + 双向链表，get/put 都 O(1)。Map 负责按 key 找节点，链表负责维护最近使用顺序。选双向是因为要做到 O(1) 删除，必须有前驱指针——单向链表删一个已知节点是 O(1)，但摘掉尾节点要 O(n)。」然后主动补两个坑：淘汰时两边一起删、容量为 1 的边界。这三句话说完，比闷头写十分钟代码更值钱。'
        }
      ],
      skeleton: `/**
 * 第 3 关 · 合成 O(1) 版：Map 存节点 + 链表管顺序
 *
 * 下面两个零件已经给你了（第 2 关的成品）：
 *   ListNode —— 存 key / value / prev / next
 *   DoublyLinkedList —— head/tail 哨兵 + addFirst / remove / moveToFirst / removeLast
 *
 * 你要做的是把它们接起来：
 *   Map<key, ListNode> 负责「key → 节点」的 O(1) 定位
 *   链表负责「谁最近用过」的 O(1) 维护
 */

class ListNode {
  constructor(key, value) {
    this.key = key
    this.value = value
    this.prev = null
    this.next = null
  }
}

class DoublyLinkedList {
  constructor() {
    this.head = new ListNode(null, null)
    this.tail = new ListNode(null, null)
    this.head.next = this.tail
    this.tail.prev = this.head
    this._size = 0
  }

  get size() { return this._size }

  addFirst(node) {
    node.prev = this.head
    node.next = this.head.next
    this.head.next.prev = node
    this.head.next = node
    this._size++
  }

  remove(node) {
    node.prev.next = node.next
    node.next.prev = node.prev
    this._size--
  }

  moveToFirst(node) {
    this.remove(node)
    this.addFirst(node)
  }

  removeLast() {
    if (this._size === 0) return null
    const node = this.tail.prev
    this.remove(node)
    return node
  }
}

class LRUCache {
  constructor(capacity) {
    this.capacity = capacity
    this.map = new Map()
    this.list = new DoublyLinkedList()
  }

  get(key) {
    // TODO 1：Map 里拿到节点；没有返回 undefined；有就 moveToFirst，返回 node.value
    return undefined
  }

  put(key, value) {
    // TODO 2：key 已存在 → 更新 node.value，moveToFirst，return
    // TODO 3：新 key → 建节点、addFirst、map.set；超过容量就 removeLast 并 map.delete(old.key)
  }
}
`,
      solution: O1_FINAL,
      tests: [L3S1, L3S2].join('\n\n')
    }
  ]
}