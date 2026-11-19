/**
 * 内容源：公共基础 · 手写日常工具箱（JS 语言核心）
 *
 * 公共基础最容易讲成「名词背诵」。这一季反过来：每个知识点都落成一个必须亲手写出来的函数，
 * 写完立刻用测试验行为——深拷贝要看循环引用、事件总线要看 once 真的只触发一次、
 * 柯里化要看参数不够时返回函数而不是报错。能写出来，才算懂。
 *
 * v3 分步制：每关拆成「写完就能跑测试」的几步，每步都给完整可运行文件。
 */

/* ------------------------------------------------------------ 第 1 关测试 */
const L1S1 = `{
  const src = { name: 'vue', tags: ['a', 'b'], meta: { n: 1 } }
  const copy = deepClone(src)

  check('拷出来的结构一样', () => same(copy, { name: 'vue', tags: ['a', 'b'], meta: { n: 1 } }))
  check('改拷贝不影响原对象', () => { copy.meta.n = 2; same(src.meta.n, 1) })
  check('改原对象不影响拷贝', () => { src.tags.push('c'); same(copy.tags.length, 2) })
  check('嵌套对象不是同一个引用', () => ok(copy.meta !== src.meta, 'meta 仍是同一个引用（这是浅拷贝）'))
  check('数组被正确复制', () => ok(Array.isArray(copy.tags) && copy.tags !== src.tags))
  check('基础类型原样返回', () => { same(deepClone(3), 3); same(deepClone('x'), 'x'); same(deepClone(null), null) })
}`

const L1S2 = `{
  check('循环引用不会爆栈，而且指向拷贝自己', () => {
    const a = { name: 'loop' }
    a.self = a
    const b = deepClone(a)
    same(b.name, 'loop')
    ok(b.self === b, '循环引用应该指向拷贝自己')
    ok(b.self !== a, '不能指回原对象')
  })
  check('同一个源对象被引用两次，拷贝后仍共享同一个拷贝', () => {
    const shared = { v: 1 }
    const src = { a: shared, b: shared }
    const copy = deepClone(src)
    ok(copy.a === copy.b, '共享引用应该保持共享')
    ok(copy.a !== shared, '不能指回原对象')
  })
  check('深层循环也能断掉', () => {
    const root = { child: { parent: null } }
    root.child.parent = root
    const copy = deepClone(root)
    ok(copy.child.parent === copy)
  })
}`

const L1S3 = `{
  check('Date 复制成新的 Date，时间相同', () => {
    const d = new Date(1700000000000)
    const e = deepClone(d)
    ok(e instanceof Date && e !== d)
    same(e.getTime(), d.getTime())
  })
  check('Map 里的嵌套对象也被深拷贝', () => {
    const m = new Map([['k', { v: 1 }]])
    const n = deepClone(m)
    n.get('k').v = 9
    same(m.get('k').v, 1)
  })
  check('Set 里的对象也被深拷贝', () => {
    const item = { v: 1 }
    const s = new Set([item])
    const t = deepClone(s)
    ok(t instanceof Set && t !== s)
    const cloned = [...t][0]
    cloned.v = 9
    same(item.v, 1)
  })
  check('函数原样传递（函数没有「深拷贝」语义）', () => {
    const fn = () => 1
    const src = { fn }
    const copy = deepClone(src)
    same(copy.fn, fn)
  })
}`

/* ------------------------------------------------------------ 第 2 关测试 */
const L2S1 = `{
  const bus = new EventEmitter()
  const seen = []

  check('on + emit：监听器被调用，参数原样传过去', () => {
    bus.on('greet', (a, b) => seen.push([a, b]))
    same(bus.emit('greet', 'hi', 1), true)
    same(seen, [['hi', 1]])
  })
  check('没人监听时 emit 返回 false', () => same(bus.emit('nobody'), false))
  check('多个监听器按注册顺序执行', () => {
    const order = []
    const b2 = new EventEmitter()
    b2.on('x', () => order.push('a'))
    b2.on('x', () => order.push('b'))
    b2.emit('x')
    same(order, ['a', 'b'])
  })
  check('on 支持链式调用', () => {
    const b7 = new EventEmitter()
    ok(b7.on('a', () => {}).on('b', () => {}) === b7)
  })
}`

const L2S2 = `{
  check('off 之后不再触发', () => {
    const b3 = new EventEmitter()
    let n = 0
    const fn = () => { n++ }
    b3.on('y', fn)
    b3.emit('y')
    b3.off('y', fn)
    same(b3.emit('y'), false)
    same(n, 1)
  })
  check('off 不存在的事件不报错，返回 this', () => {
    const b8 = new EventEmitter()
    ok(b8.off('nobody', () => {}) === b8)
  })
  check('只删指定的监听器，其它保留', () => {
    const b9 = new EventEmitter()
    const order = []
    const a = () => order.push('a')
    const c = () => order.push('c')
    b9.on('e', a)
    b9.on('e', c)
    b9.off('e', a)
    b9.emit('e')
    same(order, ['c'])
  })
}`

const L2S3 = `{
  check('监听器里解绑后面的监听器，不会导致后面的被跳过', () => {
    const b6 = new EventEmitter()
    const order = []
    const second = () => order.push('second')
    b6.on('e', () => { order.push('first'); b6.off('e', second) })
    b6.on('e', second)
    b6.emit('e')
    same(order, ['first', 'second'])
  })
  check('监听器里新增的监听器不会在同一次 emit 里被触发', () => {
    const b10 = new EventEmitter()
    const order = []
    b10.on('e', () => { order.push('first'); b10.on('e', () => order.push('late')) })
    b10.emit('e')
    same(order, ['first'])
  })
}`

const L2S4 = `{
  check('once 只执行一次', () => {
    const b4 = new EventEmitter()
    let n = 0
    b4.once('z', () => { n++ })
    b4.emit('z')
    b4.emit('z')
    same(n, 1)
  })
  check('可以用原函数 off 掉 once 注册的监听', () => {
    const b5 = new EventEmitter()
    let n = 0
    const fn = () => { n++ }
    b5.once('w', fn)
    b5.off('w', fn)
    same(b5.emit('w'), false)
    same(n, 0)
  })
  check('once 的参数原样透传', () => {
    const b11 = new EventEmitter()
    let got = null
    b11.once('p', (a, b) => { got = [a, b] })
    b11.emit('p', 1, 2)
    same(got, [1, 2])
  })
  check('once 只移除自己，不影响同事件的其他监听', () => {
    const b12 = new EventEmitter()
    const order = []
    b12.on('m', () => order.push('on'))
    b12.once('m', () => order.push('once'))
    b12.emit('m')
    b12.emit('m')
    same(order, ['on', 'once', 'on'])
  })
}`

/* ------------------------------------------------------------ 第 3 关测试 */
const L3S1 = `{
  const add3 = (a, b, c) => a + b + c
  const c = curry(add3)

  check('一次传齐参数', () => same(c(1, 2, 3), 6))
  check('多传的参数也会传给原函数', () => {
    const f = curry((a, b) => a + b)
    same(f(1, 2, 99), 3)
  })
}`

const L3S2 = `{
  const add3 = (a, b, c) => a + b + c
  const c = curry(add3)

  check('一个一个传', () => same(c(1)(2)(3), 6))
  check('两个一组再补一个', () => same(c(1, 2)(3), 6))
  check('先传一个再传两个', () => same(c(1)(2, 3), 6))
  check('中间某一步传空参也不该出错', () => same(c(1)()(2)(3), 6))
  check('两个柯里化实例互不干扰', () => {
    const a = c(1)
    const b = c(10)
    same(a(2)(3), 6)
    same(b(2)(3), 15)
  })
  check('偏函数用法：固定第一参后复用', () => {
    const log = curry((level, msg) => level + ':' + msg)
    const error = log('error')
    same(error('挂了'), 'error:挂了')
    same(error('又挂了'), 'error:又挂了')
  })
}`

/** 第 1 关完整实现 */
const CLONE_FINAL = `/**
 * 第 1 关 · 深拷贝：连循环引用一起拷贝
 */
function deepClone(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return seen.get(value)

  if (value instanceof Date) return new Date(value.getTime())

  if (value instanceof Map) {
    const copy = new Map()
    seen.set(value, copy)
    for (const [k, v] of value) copy.set(k, deepClone(v, seen))
    return copy
  }

  if (value instanceof Set) {
    const copy = new Set()
    seen.set(value, copy)
    for (const v of value) copy.add(deepClone(v, seen))
    return copy
  }

  const copy = Array.isArray(value) ? [] : {}
  seen.set(value, copy)
  for (const key of Object.keys(value)) {
    copy[key] = deepClone(value[key], seen)
  }
  return copy
}
`

/** 第 2 关完整实现 */
const BUS_FINAL = `/**
 * 第 2 关 · 事件总线：on / once / off / emit
 */
class EventEmitter {
  constructor() {
    this._events = new Map()
  }

  on(event, fn) {
    const list = this._events.get(event) ?? []
    list.push(fn)
    this._events.set(event, list)
    return this
  }

  emit(event, ...args) {
    const list = this._events.get(event)
    if (!list || list.length === 0) return false
    for (const fn of [...list]) fn.apply(this, args)
    return true
  }

  off(event, fn) {
    const list = this._events.get(event)
    if (!list) return this
    this._events.set(event, list.filter((l) => l !== fn && l.original !== fn))
    return this
  }

  once(event, fn) {
    const wrapper = (...args) => {
      this.off(event, wrapper)
      return fn.apply(this, args)
    }
    wrapper.original = fn
    return this.on(event, wrapper)
  }
}
`

/** 第 3 关完整实现 */
const CURRY_FINAL = `/**
 * 第 3 关 · 柯里化：参数够了才执行
 */
function curry(fn, ...preset) {
  return function next(...args) {
    const all = [...preset, ...args]
    if (all.length >= fn.length) return fn(...all)
    return curry(fn, ...all)
  }
}
`

export default {
  id: 'js-core-toolkit',
  version: 3,
  domain: 'fe',
  // 三关各自独立（深拷贝 / 事件总线 / 柯里化），不像响应式内核那样累积，关掉跨关回归检查
  cumulative: false,
  title: '手写日常工具箱',
  emoji: '🧰',
  tagline: '3 关：深拷贝、事件总线、柯里化——每个都是面试常考、项目里真会用到的函数。',
  stack: ['JavaScript'],
  intro: '这三关挑的是「看起来会、写起来写不对」的典型：深拷贝会漏循环引用，事件总线的 once 会漏解绑，柯里化会在参数不够时直接崩。每关先讲清原理，再让你一步一步补完，跑测试立刻知道哪里漏了。',
  outcome: '做完你手上会有三个能直接放进项目里用的工具函数，也能在面试里把「为什么这么写」讲清楚——比如为什么深拷贝必须用 WeakMap、为什么 once 要在包装函数外再存一份原函数。',
  levels: [
    /* ------------------------------------------------------------ 第 1 关 */
    {
      id: 'lv1',
      title: '深拷贝：连循环引用一起拷贝',
      emoji: '🪞',
      xp: 40,
      goal: '实现 deepClone(value)：递归复制对象和数组，遇到循环引用不会爆栈，Date / Map / Set 也能正确复制。',
      why: '「深拷贝」是面试里最常见的现场题，也是项目里最容易出事的地方：改了一份数据，另一份跟着变；或者日志里一打印就是 `RangeError: Maximum call stack size exceeded`——因为对象里有个指回自己的引用。这两个坑这一关都会踩到，也都得亲手解决。',
      thinking: [
        {
          title: '先问「拷贝到什么程度算完」，再问怎么递归',
          md: `「深拷贝」这个需求一句话就懂，但它的边界必须先定义清楚：嵌套对象要新一份、数组要新一份、循环引用不能爆栈、Date/Map/Set 要按类型复制、函数该不该复制？

我发现只要不定义边界，写出来就会「示例能过、真实数据炸」。所以我的顺序是：**先让普通对象/数组的递归跑通（把结构复制对），再处理循环引用（把递归断掉），最后才是特殊类型**。每一步都能单独跑测试，错了就知道是结构问题还是类型问题。`
        },
        {
          title: '为什么「先登记再填属性」不是风格问题，是正确性问题',
          md: `看到 a.self = a，直觉写法是：造一个空对象，把属性递归填进去，填完再登记。但递归进 self 时表里还没有 a，于是又去克隆 a……直接爆栈。

正确顺序只有一种：**先 set(原对象, 新对象)，再开始填**。这样递归再次遇到 a 时，表里已经有答案，直接返回。顺序反了，循环引用这一个用例一定会红——这也是我把它单独放第二步的原因。`
        },
        {
          title: '为什么用 WeakMap 而不是 Map',
          md: `这张表只服务于「这次拷贝」，用完就该消失。但如果有人把它提到模块级复用（为了省一次 new），Map 会强引用所有被拷贝过的源对象——大对象图会让内存一路涨。

WeakMap 的键是弱引用，源对象被回收时表项自动消失。这里用它是「顺手选对」，也正好是面试里能加分的细节。`
        }
      ],
      prereq: [
        {
          title: '浅拷贝和 JSON 方案各缺什么',
          md: `\`{ ...obj }\` 只是复制了第一层的引用：嵌套对象仍然是同一个，改一份另一份跟着变。

\`JSON.parse(JSON.stringify(obj))\` 看着像深拷贝，实际上丢东西：undefined、函数、Symbol 直接消失，Date 变成字符串，NaN 变成 null，而且**对象里只要有循环引用就直接抛错**。

所以真要深拷贝，只能自己递归：判断类型 → 造一个同类型的空壳 → 把每个属性递归复制进去。`
        },
        {
          title: 'WeakMap 是循环引用的唯一解法',
          md: `循环引用是这样的：a.self = a。递归走到 a 时又要克隆 a，又要克隆它的 self，又是 a……无限下去。

解法是「边拷贝边登记」：每开始克隆一个对象，先把「原对象 → 新对象」存进一张表；下次再遇到同一个原对象，直接返回表里已经造好的新对象，不再递归。

\`\`\`js
const seen = new WeakMap()
if (seen.has(value)) return seen.get(value)
const copy = {}
seen.set(value, copy)   // 先登记，再往里填属性
\`\`\`

用 WeakMap 而不是 Map：源对象被回收时，这张表不会拖住它。`
        }
      ],
      api: [
        {
          name: 'deepClone',
          sig: 'deepClone(value: any, seen?: WeakMap): any',
          args: 'value —— 要拷贝的值，可以是对象、数组、Date、Map、Set 或基础类型。seen —— 内部用来记「原对象 → 新对象」的表，调用时不用传。',
          returns: '一个全新的值：结构和 value 完全一样，但改它不会影响 value。基础类型原样返回。',
          example: `const a = { name: 'vue', tags: ['x'], meta: { n: 1 } }
const b = deepClone(a)
b.meta.n = 2
a.meta.n          // 仍然是 1

// 循环引用也不能爆栈
const c = { name: 'loop' }
c.self = c
const d = deepClone(c)
d.self === d      // true：拷贝内部的引用也指向拷贝自己`
        }
      ],
      stages: [
        {
          n: 1,
          title: '递归复制普通对象与数组',
          think: '先把「结构复制对」这一层跑通：基础类型直接返回，对象造空壳、按 key 递归。这一步先不管循环引用和特殊类型——它们各有各的失败方式，混在一起就分不清是递归写错了还是表没登记。',
          hint: '先判断 null / typeof !== "object" 直接返回；数组造 []，其余造 {}；遍历 Object.keys(value)，逐个 copy[key] = deepClone(value[key])，最后 return copy。',
          diag: [
            '基础类型被当成对象处理：先判断 value === null 或 typeof value !== "object" 并直接返回。',
            '改了拷贝影响原对象：嵌套对象要递归克隆，不能直接赋值引用。',
            '改了原对象影响拷贝：数组/对象必须造新壳，不能 return 原值。',
            '数组被拷贝成普通对象：用 Array.isArray(value) ? [] : {} 选壳。',
            '属性没复制全：遍历 Object.keys(value)，每个键都递归。',
            '基础类型测试红：number/string/null 都要原样返回，别塞进递归分支。'
          ],
          vocab: [
            { term: '递归', md: '函数调用自己，把「大问题」拆成「结构相同的小问题」。深拷贝的每一层属性都是同一个小问题。' }
          ],
          code: `/**
 * 第 1 关 · 第 1 步：递归复制普通对象与数组
 */
function deepClone(value) {
  if (value === null || typeof value !== 'object') return value

  const copy = Array.isArray(value) ? [] : {}
  for (const key of Object.keys(value)) {
    copy[key] = deepClone(value[key])
  }
  return copy
}
`,
          test: L1S1
        },
        {
          n: 2,
          title: '循环引用：边拷贝边登记',
          think: '现在处理会爆栈的情况。核心判断只有一句：**先登记再填属性**。这一步的验收不是「能跑」，而是「循环引用指向的是拷贝自己」，以及「同一个源对象被引用两次时，拷贝后仍然共享同一份」——后者是很多人漏掉的正确性要求。',
          hint: '给 deepClone 加第二个参数 seen = new WeakMap()。入口先查表 seen.has(value) 就返回 seen.get(value)；造完空壳立刻 seen.set(value, copy)，再遍历属性。',
          diag: [
            '循环引用爆栈：递归入口要先查 seen 表，命中就返回已造好的拷贝。',
            '循环引用指向了原对象：登记表里存的必须是新拷贝，不是源对象。',
            '仍然爆栈：seen.set 必须在填属性之前，先登记再递归。',
          ],
          code: `/**
 * 第 1 关 · 第 2 步：循环引用 + 共享引用
 */
function deepClone(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return seen.get(value)

  const copy = Array.isArray(value) ? [] : {}
  seen.set(value, copy)
  for (const key of Object.keys(value)) {
    copy[key] = deepClone(value[key], seen)
  }
  return copy
}
`,
          test: L1S2
        },
        {
          n: 3,
          title: 'Date / Map / Set 与函数',
          think: '最后补特殊类型。判断顺序很重要：Date/Map/Set 必须在「造普通对象壳」之前处理，否则它们会先被当成普通对象拷成 {}。函数则相反——直接原样返回，因为函数没有可深拷贝的内部状态。',
          hint: '在造普通壳之前依次判断：instanceof Date → new Date(getTime())；instanceof Map → 新 Map，先登记再逐项克隆 key/value；instanceof Set → 新 Set，先登记再克隆元素。函数走 typeof !== "object" 那条早退分支。',
          diag: [
            'Date 变成普通对象（{}）：instanceof Date 的分支要放在造壳之前。',
            'Date 拷完时间不对：用 new Date(value.getTime())，别直接 new Date()。',
            'Map 里的对象还是引用：先建 New Map、登记，再对 value 递归。',
            'Set 里的对象还是引用：先建 New Set、登记，再对每个元素递归。',
          ],
          vocab: [
            { term: 'instanceof', md: '判断对象是不是某个构造函数的实例。跨 realm 时不可靠，但同一次运行里的内容够用。' }
          ],
          code: CLONE_FINAL,
          test: L1S3
        }
      ],
      finalCode: CLONE_FINAL,
      usage: `const state = {
  user: { name: 'harry', tags: ['admin'] },
  meta: new Map([['version', 1]])
}
state.self = state

const snapshot = deepClone(state)
snapshot.user.name = 'tom'     // 不影响 state.user.name
snapshot.self === snapshot     // true，循环引用也被正确重建`,
      hints: [
        'seen.set(value, copy) 必须在填属性之前。先填再登记的话，属性里的循环引用会让递归走到「表里还没有」这个分支，直接爆栈。',
        'Date 不需要递归属性，直接 new Date(...) 返回即可，别套进通用分支。',
        'Object.keys 不含 Symbol 键和非枚举属性。这一关的测试只考可枚举字符串键，够用；面试里可以补一句「要完整需要 Reflect.ownKeys」。'
      ],
      concepts: [
        {
          title: '为什么 WeakMap 而不是 Map',
          md: 'Map 会强引用键。深拷贝一张大对象图时，如果每次都 new Map，用完即弃，问题不大；但如果把 seen 提升到模块级复用（有些实现会这么做），Map 会让所有被拷贝过的源对象永远无法回收，内存一路涨。WeakMap 的键是弱引用，源对象被回收时表项自动消失。'
        }
      ],
      skeleton: `/**
 * 第 1 关 · 深拷贝：连循环引用一起拷贝
 *
 * 目标：deepClone 出来的新对象，改它不影响原对象；
 * 原对象里有 a.self = a 这种循环引用时，也不能爆栈。
 */

/**
 * @param value 要拷贝的值
 * @param seen  「原对象 → 新对象」的登记表，内部用，调用时不用传
 */
function deepClone(value, seen = new WeakMap()) {
  // TODO 1：null 和基础类型（typeof !== 'object'）直接返回
  // TODO 2：seen 里已经有这个对象了，就返回之前造好的那份（循环引用靠这个断掉递归）
  // TODO 3：按类型造空壳（Date / Map / Set / 数组 / 普通对象），并立刻 seen.set(value, copy)
  // TODO 4：遍历 Object.keys(value)，逐个 copy[key] = deepClone(value[key], seen)，最后 return copy
  throw new Error('TODO 1：还没有开始写')
}
`,
      solution: CLONE_FINAL,
      tests: [L1S1, L1S2, L1S3].join('\n\n')
    },
    /* ------------------------------------------------------------ 第 2 关 */
    {
      id: 'lv2',
      title: '事件总线：on / once / off / emit',
      emoji: '📡',
      xp: 45,
      goal: '实现一个 EventEmitter：能注册、能触发、能解绑，且 once 注册的监听器只执行一次。',
      why: '事件总线是「解耦」最朴素的实现：组件之间不直接调用，而是发一个事件名。写它不是为了造轮子——每个前端项目、Node 的 EventEmitter、Vue 的 mitt，核心都是这三十行。而且 once + off 的组合里藏着一个很典型的坑：包装函数注册进去之后，用原函数根本删不掉。',
      thinking: [
        {
          title: '先定数据结构，再定四个方法',
          md: `事件总线的本质只有一个 Map：事件名 → 监听函数数组。四个方法全是围绕这张表的读写：on 是 push，emit 是遍历调用，off 是过滤，once 是「注册一个会自动 off 的包装」。

数据结构定对了，四个方法各自只有三五行事；先想流程再想结构，才会写出一堆互相耦合的判断。`
        },
        {
          title: 'emit 为什么先拷一份再遍历',
          md: `监听器里完全可能调 off（取消后面的监听）或 on（新增监听）。如果直接 \`for...of list\`，删掉一个元素会让后面的前移，迭代器下标却已经跳过——结果就是「删一个，跳一个」。

先 \`[...list]\` 拷贝再遍历，遍历的是快照，本次 emit 的行为就固定了。这是真实事件总线里必写的一行，测试也专门有这一条。`
        },
        {
          title: 'once 的 wrapper 为什么必须记 original',
          md: `once 的常见写法是注册一个 wrapper，第一次调用时先 off(wrapper) 再执行 fn。但用户手里只有 fn——他调 off(event, fn) 时，表里存的是 wrapper，删不掉。

所以 wrapper 上要挂 \`wrapper.original = fn\`，off 时两种都比对一次。这个细节是「能写事件总线」和「写过能用的」的分界线。`
        }
      ],
      prereq: [
        {
          title: '事件总线就是一个「事件名 → 函数数组」的 Map',
          md: `最小实现只有一个数据结构：

\`\`\`js
{ 'user:login': [fn1, fn2], 'user:logout': [fn3] }
\`\`\`

- on：往对应数组里 push
- emit：把数组里的函数挨个调用，参数原样传过去
- off：从数组里删掉指定的那个函数

要注意的只有一件事：**遍历数组时如果监听器里又 on/off 了，正在遍历的数组会被修改**，所以 emit 里先拷贝一份再遍历。`
        },
        {
          title: 'once 为什么要包一层，还要保留原函数',
          md: `once(event, fn) 的常见写法是先注册一个包装函数，调用时先 off 再执行 fn：

\`\`\`js
const wrapper = (...args) => { off(event, wrapper); fn(...args) }
on(event, wrapper)
\`\`\`

问题来了：**用户想提前取消这个 once 监听时，手里只有 fn，off(event, fn) 删不掉 wrapper**。

解法是包装函数上留一个指回原函数的标记，off 里两种都比对一次：

\`\`\`js
wrapper.original = fn
// off 里：listener === fn || listener.original === fn
\`\`\`

这个细节在面试里能直接拉开差距。`
        }
      ],
      api: [
        {
          name: 'EventEmitter',
          sig: 'class EventEmitter { on(event, fn); once(event, fn); off(event, fn); emit(event, ...args): boolean }',
          args: 'event —— 事件名（字符串）；fn —— 监听函数；...args —— emit 时原样传给每个监听函数的参数。',
          returns: 'on / once / off 支持链式调用（return this）；emit 返回 boolean：有监听器执行过为 true，没人监听为 false。',
          example: `const bus = new EventEmitter()

const onLogin = (user) => console.log('登录：', user)
bus.on('login', onLogin)
bus.emit('login', 'harry')     // 打印一次，返回 true

bus.once('login', () => console.log('只提示一次'))
bus.emit('login', 'harry')     // 两个都打印
bus.emit('login', 'harry')     // 只有 onLogin 打印

bus.off('login', onLogin)
bus.emit('login', 'harry')     // 返回 false，什么都不打印`
        }
      ],
      stages: [
        {
          n: 1,
          title: 'on 与 emit：先让事件跑起来',
          think: '先只做「注册 + 触发」。emit 我故意先写成直接遍历，不拷贝——因为「遍历时修改数组」是下一步的问题，先让最简单的路径跑通，才能把两种失败分开。另外 emit 的返回值（有没有人监听）这一条要一起做，它是调用方判断「有没有人接」的唯一依据。',
          hint: '构造函数里 this._events = new Map()。on：取数组（没有就建）→ push → set 回去 → return this。emit：取数组，为空 return false；否则 for...of 遍历，用 fn.apply(this, args) 调用；最后 return true。',
          diag: [
            'on 没返回 this：链式调用会断，b.on().on() 报错。',
            'emit 没传参数：用 ...args 收集、fn.apply(this, args) 转发。',
            '没人监听时返回值不对：数组不存在或为空要 return false。',
            '多个监听顺序错：数组 push 保证注册顺序，遍历时别倒序。',
          ],
          vocab: [
            { term: 'apply', md: 'fn.apply(thisArg, argsArray) 用指定 this 和参数数组调用函数。事件总线里用它把 emit 的参数原样转给监听器，同时保留 this 指向。' }
          ],
          code: `/**
 * 第 2 关 · 第 1 步：on + emit
 */
class EventEmitter {
  constructor() {
    this._events = new Map()
  }

  on(event, fn) {
    const list = this._events.get(event) ?? []
    list.push(fn)
    this._events.set(event, list)
    return this
  }

  emit(event, ...args) {
    const list = this._events.get(event)
    if (!list || list.length === 0) return false
    for (const fn of list) fn.apply(this, args)
    return true
  }
}
`,
          test: L2S1
        },
        {
          n: 2,
          title: 'off：按函数身份解绑',
          think: '接下来做解绑。这里没有算法，只有一个约定：off 按「函数身份」匹配，删的是注册时那个引用。先把普通监听删干净，once 的包装函数留到第 4 步再一起处理。',
          hint: 'off：取出数组，没有就 return this；用 filter 过滤掉 l === fn 的项，把结果 set 回去，return this。',
          diag: [
            'off 后还在触发：过滤条件要按函数引用比较 l !== fn。',
            'off 不存在的事件报错：取不到数组时直接 return this。',
            '把别的监听也删了：只过滤掉匹配 fn 的那一个，其它保留。',
          ],
          code: `/**
 * 第 2 关 · 第 2 步：off
 */
class EventEmitter {
  constructor() {
    this._events = new Map()
  }

  on(event, fn) {
    const list = this._events.get(event) ?? []
    list.push(fn)
    this._events.set(event, list)
    return this
  }

  emit(event, ...args) {
    const list = this._events.get(event)
    if (!list || list.length === 0) return false
    for (const fn of list) fn.apply(this, args)
    return true
  }

  off(event, fn) {
    const list = this._events.get(event)
    if (!list) return this
    this._events.set(event, list.filter((l) => l !== fn))
    return this
  }
}
`,
          test: L2S2
        },
        {
          n: 3,
          title: 'emit 遍历快照：避免删除导致跳过',
          think: '现在修「遍历中被修改」的问题。这一步的验收有一个很刁的用例：第一个监听器里 off 掉第二个，第二个仍然要执行——因为这次 emit 的行为应该由「触发那一刻的监听列表」决定。',
          hint: 'emit 里把 for (const fn of list) 改成 for (const fn of [...list])，遍历快照；其余不动。',
          diag: [
            '后面的监听被跳过：遍历前先 [...list] 拷贝一份。',
            '监听器里新加的被本次触发：拷贝快照后，新增的只会在下一次 emit 生效。',
          ],
          code: `/**
 * 第 2 关 · 第 3 步：emit 遍历快照
 */
class EventEmitter {
  constructor() {
    this._events = new Map()
  }

  on(event, fn) {
    const list = this._events.get(event) ?? []
    list.push(fn)
    this._events.set(event, list)
    return this
  }

  emit(event, ...args) {
    const list = this._events.get(event)
    if (!list || list.length === 0) return false
    for (const fn of [...list]) fn.apply(this, args)
    return true
  }

  off(event, fn) {
    const list = this._events.get(event)
    if (!list) return this
    this._events.set(event, list.filter((l) => l !== fn))
    return this
  }
}
`,
          test: L2S3
        },
        {
          n: 4,
          title: 'once：包装一次，留回原函数的线索',
          think: '最后加 once。两个细节：wrapper 第一次执行时要先把自己解绑（否则同一轮里调用两次就触发两次）；wrapper 上挂 original，让 off(event, fn) 也能删掉它。后者是这道题最容易被面试官追问的点。',
          hint: 'once 里建 wrapper = (...args) => { this.off(event, wrapper); return fn.apply(this, args) }，然后 wrapper.original = fn，最后 return this.on(event, wrapper)。同时把 off 的过滤条件加上 l.original !== fn。',
          diag: [
            'once 触发了两次：wrapper 里第一句必须是 this.off(event, wrapper)。',
            '用原函数 off 不掉：off 要同时比较 l.original === fn。',
            'once 的参数没透传：fn.apply(this, args)，args 来自 wrapper 的 rest 参数。',
            'once 把同事件其他监听删了：只 off wrapper 自己，不要清空数组。'
          ],
          code: BUS_FINAL,
          test: L2S4
        }
      ],
      finalCode: BUS_FINAL,
      usage: `const bus = new EventEmitter()

const onLogin = (user) => console.log('登录：', user)
bus.on('login', onLogin)
bus.once('login', () => console.log('只提示一次'))

bus.emit('login', 'harry')    // 两个都打印
bus.emit('login', 'harry')    // 只有 onLogin

bus.off('login', onLogin)     // 解绑普通监听
bus.emit('login', 'harry')    // false，没有监听器`,
      hints: [
        '事件表用 Map 还是普通对象都行；用 Map 可以避免 "__proto__" 这类事件名污染原型。',
        'emit 里如果不拷贝直接 for...of，监听器里调 off 会导致「跳过下一个监听器」，测试里有一条专门测这个。',
        'once 的 wrapper 必须是普通函数（用 function 或箭头都可以，但要用 apply 保留 this），并且别忘了 wrapper.original = fn。'
      ],
      concepts: [
        {
          title: '为什么 emit 要先拷贝',
          md: 'JS 的数组迭代器是按索引走的。遍历 [a, b] 时删掉 a，b 会前移到 index 0，而迭代器已经走到 index 1 —— b 就被跳过了。同理 push 新监听器会被「顺便执行」。拷贝一份再遍历，行为才可预测。'
        }
      ],
      skeleton: `/**
 * 第 2 关 · 事件总线：on / once / off / emit
 *
 * 事件总线 = 「事件名 → 监听函数数组」的表。
 * 难点不在存，而在 once（一次性监听）和 off（怎么把 once 注册的那个包装函数也删掉）。
 */

class EventEmitter {
  constructor() {
    /** 事件表：事件名 -> 监听函数数组 */
    this._events = new Map()
  }

  /** 注册监听 */
  on(event, fn) {
    // TODO 1：把 fn 放进这个事件的数组里（没有数组就先建），返回 this
  }

  /** 触发事件：把参数原样传给每个监听函数 */
  emit(event, ...args) {
    // TODO 2：取出数组；没人监听返回 false；
    //         拷贝一份再遍历，每个函数用 apply 调用（保证 this 指向 emitter）；返回 true
    return false
  }

  /** 解绑：既能删普通监听，也要能删 once 注册的包装函数 */
  off(event, fn) {
    // TODO 3：过滤掉 listener === fn 或 listener.original === fn 的项，写回事件表，返回 this
  }

  /** 一次性监听 */
  once(event, fn) {
    // TODO 4：包一个 wrapper（先 off 自己再执行 fn），给 wrapper.original = fn，然后注册
  }
}
`,
      solution: BUS_FINAL,
      tests: [L2S1, L2S2, L2S3, L2S4].join('\n\n')
    },
    /* ------------------------------------------------------------ 第 3 关 */
    {
      id: 'lv3',
      title: '柯里化：参数够了才执行',
      emoji: '🥄',
      xp: 45,
      goal: '实现 curry(fn)：可以分多次传参，参数凑够 fn 声明的个数才真正执行；不够就继续返回函数等着。',
      why: '柯里化的价值不在炫技，而在「固定一部分参数、复用剩下的部分」：把 log(level, msg) 柯里化成 error = curry(log)("error")，之后到处调用 error("xxx") 就行。面试里考它是因为它同时考闭包、函数参数个数（fn.length）和递归返回函数的思维。',
      thinking: [
        {
          title: '为什么用 fn.length 而不是自己数参数',
          md: `「参数够不够」需要一个客观标准。函数对象自带 \`fn.length\`，等于**没有默认值、不在 rest 里的形参个数**——这正是「调用方必须传几个才够」。

自己数参数（比如读源码字符串）既脆又没必要。唯一要注意的是：带默认值的函数 length 会变小，那种函数不适合柯里化——这不是实现问题，是使用者该知道的边界。`
        },
        {
          title: '为什么不够时要「返回新函数」而不是复用',
          md: `如果 curry 返回的 next 函数被多次调用（\`const a = c(1)\` 然后 \`a(2)(3)\` 和 \`a(4)(5)\`），它们必须互不影响。

复用同一个函数意味着共享一份「已收集参数」的闭包状态——第二次调用会带上前一次的残留。所以不够时必须 \`return curry(fn, ...all)\`，造一个新的闭包。这是纯函数思维的典型应用。`
        },
        {
          title: '为什么判断用 >= 而不是 ===',
          md: `调用方可能一次给多（\`f(1, 2, 99)\`，而 fn 只要两个）。用 === 的话这类调用会永远等下去；用 >= 则照常执行，多余的参数原样传给 fn（JS 本来就不报错）。

边界条件不是「理论正确」，是「调用方真的会这么用」。`
        }
      ],
      prereq: [
        {
          title: 'fn.length 是「必须传几个参数」',
          md: `每个函数都有一个 length 属性，等于**声明时没有默认值、且不在 rest 参数里的形参个数**：

\`\`\`js
function add(a, b, c) {}
add.length            // 3

function f(a, b = 1) {}
f.length              // 1 —— 有默认值的后续参数不计入

function g(...args) {}
g.length              // 0 —— rest 参数不计入
\`\`\`

柯里化就靠它判断「参数收够了没有」。所以别拿带默认值或 rest 的函数做柯里化，length 会不听话。`
        },
        {
          title: '「不够就返回函数」是递归结构',
          md: `核心只有两个分支：参数够 → 执行 fn；参数不够 → 把「已有参数」存起来，返回一个继续收集的新函数。

\`\`\`js
function curry(fn, ...preset) {
  return function next(...args) {
    const all = [...preset, ...args]
    if (all.length >= fn.length) return fn(...all)
    return curry(fn, ...all)     // 不够，带着已有参数再来一轮
  }
}
\`\`\`

注意这里每次返回的都是新函数，而不是复用同一个——否则两次不同的调用会互相污染参数。`
        }
      ],
      api: [
        {
          name: 'curry',
          sig: 'curry(fn: Function): Function',
          args: 'fn —— 要柯里化的函数。它声明的参数个数（fn.length）决定「收够了没有」。',
          returns: '一个函数：可以一次传全部参数，也可以分多次传。参数不够时返回新函数继续等，够了一次性调用 fn。',
          example: `const add3 = (a, b, c) => a + b + c
const curried = curry(add3)

curried(1)(2)(3)      // 6
curried(1, 2)(3)      // 6
curried(1)(2, 3)      // 6
curried(1, 2, 3)      // 6

const log = curry((level, msg) => level + ':' + msg)
const error = log('error')
error('挂了')           // 'error:挂了'`
        }
      ],
      stages: [
        {
          n: 1,
          title: '一次传齐：先把「够了就执行」写对',
          think: '第一步只做「一次传齐」和「多传也执行」两条路径。先不做分次收集——那样会把「判断」和「递归」两件事混在一起，分不清红在哪。验收用 >= 而不是 ===，因为多传是真实用法。',
          hint: 'curry(fn, ...preset) 返回 function next(...args)；all = [...preset, ...args]；if (all.length >= fn.length) return fn(...all)。参数不够时先 throw 一个明确错误（下一步再补递归）。',
          diag: [
            '一次传齐不执行：判断用 all.length >= fn.length，然后 return fn(...all)。',
            '多传参数报错：判断必须是 >=，多余参数原样传给 fn。',
          ],
          vocab: [
            { term: '偏函数应用', md: '固定函数的一部分参数，得到参数更少的新函数。柯里化是它的递归版本。' }
          ],
          code: `/**
 * 第 3 关 · 第 1 步：一次传齐与多传
 */
function curry(fn, ...preset) {
  return function next(...args) {
    const all = [...preset, ...args]
    if (all.length >= fn.length) return fn(...all)
    throw new Error('参数还不够：这一步先只支持一次传齐')
  }
}
`,
          test: L3S1
        },
        {
          n: 2,
          title: '分次传参：不够就带着已有参数递归',
          think: '把「参数不够就抛错」换成「返回一个新函数，带着已收集的参数继续等」。关键是每次返回**新**函数，这样两个不同的部分应用实例互不干扰——测试里专门有一条验证这一点。',
          hint: '把 throw 改成 return curry(fn, ...all)。不需要额外的状态数组：preset 就是状态，通过参数一路传下去。',
          diag: [
            '一个一个传报错：参数不够时不能 throw，要 return curry(fn, ...all) 返回新函数。',
            '两个一组再补一个不对：每次调用都要把 preset 和本次 args 合并后再判断长度。',
            '先传一个再传两个不对：递归时必须把 all 作为新的 preset 传下去。',
            '中间传空参出错：空数组拼接不影响长度，说明某处把空参当成了「够参数」。',
            '两个实例互相干扰：必须返回新函数（递归调用 curry），不能复用同一个 next。',
            '偏函数复用不对：preset 是通过参数传入的，不能存在外层可变变量里。'
          ],
          code: CURRY_FINAL,
          test: L3S2
        }
      ],
      finalCode: CURRY_FINAL,
      usage: `const add3 = (a, b, c) => a + b + c
const curried = curry(add3)

curried(1)(2)(3)     // 6
curried(1, 2)(3)     // 6

// 真正的用法：固定一部分参数，复用剩下的
const log = curry((level, msg) => '[' + level + '] ' + msg)
const error = log('error')
error('连接失败')     // '[error] 连接失败'
error('超时')         // '[error] 超时'`,
      hints: [
        'curry 要接受「已经攒下的参数」这个内部状态，所以签名是 curry(fn, ...preset)，对外调用只传 fn 也能工作。',
        '参数刚好够、甚至多传了都要能执行：判断用 >=，不是 ===。多出来的参数照样传给 fn。',
        '如果 curry 返回的函数没有名字，调试时栈里全是 anonymous；用 function next(...args) 命名一下。'
      ],
      concepts: [
        {
          title: '柯里化和偏函数不是一回事',
          md: '偏函数（partial）只是预先固定几个参数，剩下的一次性补齐；柯里化则是「一次只接受一部分参数，直到够为止」。柯里化是偏函数的一种特例化，但它的重点是**自动判断什么时候参数够了**，这个判断靠 fn.length。'
        }
      ],
      skeleton: `/**
 * 第 3 关 · 柯里化：参数够了才执行
 *
 * curry(add3)(1)(2)(3)、curry(add3)(1, 2)(3)、curry(add3)(1, 2, 3) 都要得到 6。
 * 判断「够了没有」用 fn.length（函数声明时要求的参数个数）。
 *
 * @param fn     要柯里化的函数
 * @param preset 已经攒下来的参数（内部递归用，外部调用不用传）
 */
function curry(fn, ...preset) {
  return function next(...args) {
    // TODO 1：把 preset 和 args 合起来；如果长度 >= fn.length，直接 return fn(...all)
    // TODO 2：不够就 return curry(fn, ...all)，带着已有参数继续等
    throw new Error('TODO 1：还没有开始写')
  }
}
`,
      solution: CURRY_FINAL,
      tests: [L3S1, L3S2].join('\n\n')
    }
  ]
}