/**
 * fe-network：前端网络层闯关（ES6+ 语法 → HTTP 应用层 → 实时通信与传输 → 加载与连接优化）
 *
 * 判题沙箱只有 check / same / ok / throws / notSame + console，
 * 没有 fetch / XMLHttpRequest / setTimeout / Buffer，
 * 所以所有「网络」都被压成纯函数：字节数组、字符串流、配置对象由测试直接喂进来。
 * 每个模拟器都在 usage / concepts 里写明了简化掉了什么。
 */

/* ============================================================ 第 1 关测试 */
const L1S1 = `{
  check('get 陷阱记下读操作并返回被代理对象的值', () => {
    const s = createStore({ n: 1 })
    same(s.state.n, 1)
    same(s.log.length, 1)
    same(s.log[0].op, 'get')
    same(s.log[0].key, 'n')
  })
  check('set 陷阱把值写进被代理对象并返回 boolean', () => {
    const s = createStore({ n: 1 })
    s.state.n = 7
    same(s.target.n, 7, '写入必须真的落到原对象上')
    same(s.log[0].op, 'set')
    same(s.log[0].value, 7)
    same(s.state.n, 7)
  })
  check('下划线开头的内部字段读和写都被拦截', () => {
    const s = createStore({ n: 1 })
    throws(() => s.state._secret)
    throws(() => { s.state._secret = 1 })
    same(s.target._secret, undefined, '被拒绝的写入不能留下痕迹')
  })
  check('ownKeys 陷阱返回全部自有键', () => {
    const s = createStore({ a: 1, b: 2 })
    same(Object.keys(s.state), ['a', 'b'])
    same(s.log[s.log.length - 1].op, 'keys')
    same(s.log.length, 1, 'Object.keys 只触发一次 keys 陷阱')
  })
  check('不存在的键读回 undefined 而不抛错', () => {
    const s = createStore({ n: 1 })
    same(typeof s.state.missing, 'undefined')
    same(s.log.length, 1, '读不存在的键也算一次 get')
  })
}`

const L1S2 = `{
  check('effect 创建时立即执行一次', () => {
    const st = reactive({ a: 1 })
    let runs = 0
    effect(() => { runs++; void st.a })
    same(runs, 1)
  })
  check('被依赖的属性修改后 effect 自动重跑', () => {
    const st = reactive({ a: 1 })
    let runs = 0
    effect(() => { runs++; void st.a })
    st.a = 2
    same(runs, 2)
    st.a = 3
    same(runs, 3, '每次赋值都触发一次')
  })
  check('没被读过的属性变化不触发 effect', () => {
    const st = reactive({ a: 1, b: 1 })
    let runs = 0
    effect(() => { runs++; void st.a })
    st.b = 99
    same(runs, 1, 'b 没有被收集成依赖')
    st.a = 9
    same(runs, 2)
  })
  check('一个 effect 依赖两个属性时改任一个都重跑', () => {
    const st = reactive({ x: 1, y: 1 })
    let runs = 0
    effect(() => { runs++; same(typeof st.x, 'number'); void st.y })
    st.x = 2
    same(runs, 2)
    st.y = 2
    same(runs, 3)
  })
  check('嵌套 effect 结束后外层依赖仍然有效', () => {
    const st = reactive({ a: 1, b: 1 })
    let outer = 0
    let inner = 0
    effect(() => {
      outer++
      void st.a
      if (outer === 1) {
        effect(() => { inner++; void st.b })
      }
    })
    same(inner, 1)
    st.b = 2
    same(inner, 2, '内层依赖 b，b 变了要重跑')
    same(outer, 1, '外层只依赖 a，不该被 b 的修改牵连')
    st.a = 2
    same(outer, 2)
  })
}`

const L1S3 = `{
  check('take 截取无限生成器的前 n 个值', () => {
    same(collect(take(naturals(1), 3)), [1, 2, 3])
    same(collect(take(naturals(5), 2)), [5, 6])
    same(collect(take(naturals(1), 0)), [], 'n 为 0 时一个都不给')
  })
  check('take 创建时不拉取数据，每次 next 只拉一个', () => {
    let pulled = 0
    function* counted() {
      let i = 1
      while (true) {
        pulled++
        yield i
        i++
      }
    }
    const it = take(counted(), 3)
    same(pulled, 0, 'take 是惰性的，创建时零消费')
    same(it.next().value, 1)
    same(pulled, 1)
  })
  check('map 与 take 串联时不提前求值', () => {
    const seen = []
    let pulled = 0
    function* counted() {
      let i = 1
      while (true) {
        pulled++
        yield i
        i++
      }
    }
    const chained = take(mapLazy(counted(), (v) => { seen.push(v); return v * 10 }), 2)
    same(seen, [], '映射函数一次都不能被调用')
    same(pulled, 0)
    same(collect(chained), [10, 20])
    same(seen, [1, 2], '只变换真正被消费的两个值')
    same(pulled, 2)
  })
  check('take 取满后会关闭上游生成器', () => {
    let closed = false
    function* guarded() {
      try {
        let i = 1
        while (true) {
          yield i
          i++
        }
      } finally {
        closed = true
      }
    }
    same(collect(take(guarded(), 2)), [1, 2])
    same(closed, true, 'for of 提前结束会调用上游 return()')
  })
  check('async 迭代器协议识别与惰性包装', () => {
    let pulled = 0
    const source = {
      [Symbol.asyncIterator]() {
        const values = [1, 2, 3]
        let i = 0
        return {
          next() {
            pulled++
            if (i >= values.length) return Promise.resolve({ done: true, value: undefined })
            const value = values[i]
            i++
            return Promise.resolve({ done: false, value: value })
          }
        }
      }
    }
    same(isAsyncIterable(source), true)
    same(isAsyncIterable([1, 2, 3]), false, '数组只有同步迭代器')
    const wrapped = takeAsync(source, 2)
    same(pulled, 0, 'takeAsync 创建时不能拉取')
    const step = wrapped[Symbol.asyncIterator]().next()
    same(pulled, 1)
    same(typeof step.then, 'function', '异步迭代的 next 必须返回 thenable')
  })
}`

/* ============================================================ 第 1 关 */
const LV1 = {
  id: 'lv1',
  title: 'ES6+ 三件套：Proxy 陷阱、依赖收集、惰性管道',
  emoji: '🧩',
  xp: 40,
  goal: '用 Proxy 与 Reflect 写一个可观测 store（get / set / ownKeys 陷阱 + 下划线字段拦截），在其上实现 reactive + effect 的依赖收集与自动重跑，再用生成器拼出 take / mapLazy / collect 惰性管道并支持异步迭代器包装。',
  why: '面试问 ES6 早就不问「Proxy 和 defineProperty 有什么区别」这种背诵题，问的是能不能说清楚：陷阱为什么要配 Reflect、ownKeys 有哪些不变式、依赖表为什么要用 WeakMap、生成器凭什么能省掉无用的计算。这三件事恰好串成一条链路——Proxy 提供拦截点，依赖表把拦截点变成响应式，生成器把求值推迟到真正被消费的那一刻。写完这一关，Vue3 响应式的骨架和「无限流为什么要配 take」你都能当场讲出来。',
  nodes: ['fe.js.es6'],
  thinking: [
    {
      title: '陷阱本身不难，不变式才难',
      md: 'get 里 `return target[key]` 和 `return Reflect.get(target, key, receiver)` 在简单对象上看不出差别，差别出现在访问器属性（getter）和继承链上：receiver 必须一路传下去，否则 getter 里的 `this` 会指向原始对象而不是代理，代理就「漏」了。\n\nownKeys 还有硬约束：如果目标对象上有不可配置的自有属性，陷阱返回值里必须把它包含进去，否则运行时直接抛 TypeError。所以陷阱里永远用 `Reflect.ownKeys(target)` 而不是自己拼键名——它不是语法糖，是把不变式交回引擎检查的最短路径。'
    },
    {
      title: '依赖收集的最小闭环只有三步',
      md: '第一，有个全局变量记住「当前正在跑哪个函数」；第二，get 陷阱把它登记进 `WeakMap<target, Map<key, Set<effect>>>`；第三，set 陷阱按 key 把登记过的函数全部重跑。\n\n三步之外都是工程细节：嵌套 effect 需要栈来恢复外层（否则内层跑完 activeEffect 变成 null，外层后续的读取就收不到了）；遍历依赖集合前要复制一份，因为重跑过程中集合可能被改写。第 2 步的最后一个 check 就在证明栈没写对会立刻露馅。'
    },
    {
      title: '惰性不是一个形容词，是「谁在拉」',
      md: '`take(naturals(), 3)` 能结束，是因为 take 只向下游要了三个值；`mapLazy` 夹在中间时，映射函数被调用几次完全由下游决定。测试用 pulled 计数把这件事钉死：创建时 0 次、消费 2 个值时恰好 2 次。\n\n同样的思路撑起 async 迭代器：`takeAsync(source, n)` 返回的对象在 `next()` 被调用前不许碰上游。判断一个对象能不能异步迭代，只看它有没有 `Symbol.asyncIterator`——所以和一个普通数组相比，这个判据必须是 false。'
    }
  ],
  prereq: [
    {
      title: 'Proxy / Reflect 与「接收者」',
      md: '```js\nconst p = new Proxy(target, {\n  get(t, k, receiver) { return Reflect.get(t, k, receiver) }\n})\n```\n\n四个参数里第三个 receiver 是代理自己。把它传给 Reflect.get，访问器属性里的 this 才会指向代理，后续的读才会继续进陷阱；漏了它，getter 内部的读取就绕过了追踪。\n\nReflect.set 返回布尔值表示「写成功了没有」，而 Proxy 的 set 陷阱必须返回布尔，返回非布尔会被当成 true 处理——这类「看着能跑但语义错」的地方，正是本关第一个 check 要盯住的。'
    },
    {
      title: 'WeakMap 私有状态与回收语义',
      md: '```js\nconst priv = new WeakMap()\nfunction makeCounter() {\n  const obj = {}\n  priv.set(obj, { n: 0 })\n  return obj\n}\n```\n\nWeakMap 的键是弱引用：obj 不被任何地方引用时，这条私有状态会被回收，不会把实例永久钉在内存里。这是 ES6 之前用「下划线字段」或闭包模拟私有成员时做不到的（闭包方案每实例一份函数，下划线方案则完全没有隔离）。\n\n本关的依赖表同样用 WeakMap：`WeakMap<target, Map<key, Set<effect>>>`。被代理对象一旦不可达，它那一整张依赖表跟着消失，这就是「响应式系统不会泄漏」的底层原因。'
    }
  ],
  api: [
    {
      name: 'createStore',
      sig: 'createStore(initial: object) => { target, state, log }',
      args: 'initial 是初始字段，浅拷贝进被代理对象；state 是 Proxy，target 是原始对象，log 按发生顺序记录 get / set / keys 事件。',
      returns: '返回三件套：target（原始对象，用来断言写入是否真的落地）、state（代理，读写都过陷阱）、log（事件数组，最后一条是最近一次操作）。',
      example: 'const s = createStore({ n: 1 })\ns.state.n = 7\ns.target.n    // 7，写入真的落到原对象\ns.log[0].op   // set'
    },
    {
      name: 'reactive / effect',
      sig: 'reactive(target: object) => Proxy；effect(fn: Function) => runner',
      args: 'reactive 接收原始对象返回带 get/set 陷阱的代理；effect 接收一个函数，立即执行一次，执行期间读到的属性被收集成依赖。',
      returns: 'reactive 返回 Proxy；effect 返回 runner，手动调用它会再跑一遍并重新收集依赖。',
      example: 'const st = reactive({ a: 1 })\nlet runs = 0\neffect(() => { runs++; void st.a })\nst.a = 2   // runs 变成 2'
    },
    {
      name: 'take / mapLazy / collect / takeAsync',
      sig: 'take(it, n) => Generator；mapLazy(it, fn) => Generator；collect(it) => Array；takeAsync(it, n) => AsyncIterable',
      args: 'it 是任意同步可迭代对象（生成器最常见）；n 是截取个数；fn 是逐值变换；takeAsync 的 it 需要实现 Symbol.asyncIterator。',
      returns: 'take / mapLazy 返回惰性生成器（不消费就不求值）；collect 返回数组，是真正把值拉出来的那一步；takeAsync 返回带 Symbol.asyncIterator 的包装对象。',
      example: 'same(collect(take(mapLazy(naturals(1), (v) => v * 10), 2)), [10, 20])'
    }
  ],
  usage: '// 1) 观测写入（埋点、调试器）\nconst s = createStore({ clicks: 0 })\ns.state.clicks = s.state.clicks + 1\nconsole.log(s.log)\n\n// 2) 响应式（Vue3 的最小内核）\nconst state = reactive({ price: 10, count: 2 })\neffect(() => render(state.price * state.count))\n\n// 3) 惰性取数：分页接口、日志流都能套这套\nconst rows = take(mapLazy(fetchPages(), (page) => page.items), 20)\nrender(collect(rows))',
  hints: [
    '第 1 步：三个陷阱都用 Reflect 对应方法，get / set 里先记日志再返回；下划线字段用 charAt(0) 判断，别写正则。',
    '第 2 步：activeEffect 用全局变量 + 栈；track 在 get 里写进 WeakMap，set 里 trigger 之前先复制依赖集合再遍历。',
    '第 3 步：take 用「yield 之后计数再 return」，这样恰好只向上游拉 n 次；mapLazy 只写 for of 一个 yield。'
  ],
  concepts: [
    {
      title: '为什么日志要记 keys 事件',
      md: 'get / set 只能看到已知的键，看不到「这个对象有哪些键」这类元操作。`Object.keys`、`for in`、`JSON.stringify` 都会走 ownKeys（以及 getOwnPropertyDescriptor），所以要做「新增字段也要触发更新」的响应式，就必须在 ownKeys 里也收集依赖。本关只记录不追踪，但埋点与调试器里这一条往往是排错的关键线索。'
    },
    {
      title: '生成器 vs 手写游标',
      md: '不用生成器也能做惰性，比如返回 `{ next, done }` 的手写迭代器，但每个算子都要手写状态机，链三个算子就写不下去了。生成器把「暂停点」交给 yield，算子只描述一步变换，串联由 for of 自动驱动，而且提前 return 时会自动调用上游的 return() 收尾——本关第 4 个 check 用 finally 证明了这一点。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '先立起三个陷阱',
      think: '目标不是「让读写经过代理」，而是让代理的行为和原对象一致，同时留下可断言的日志。先把 get / set / ownKeys 三个陷阱和最朴素的内部字段拦截做出来，不涉及任何响应式。',
      hint: '每个陷阱都调 Reflect 的对应方法并把返回值原样返回；日志统一用 { op, key, value } 三个字段。',
      code: `function createStore(initial) {
  const log = []
  const target = Object.assign({}, initial)

  const state = new Proxy(target, {
    get(t, key, receiver) {
      if (typeof key === 'string' && key.charAt(0) === '_') {
        throw new Error('内部字段不可读: ' + key)
      }
      log.push({ op: 'get', key: key })
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      if (typeof key === 'string' && key.charAt(0) === '_') {
        throw new Error('内部字段不可写: ' + key)
      }
      log.push({ op: 'set', key: key, value: value })
      return Reflect.set(t, key, value, receiver)
    },
    ownKeys(t) {
      log.push({ op: 'keys', key: null })
      return Reflect.ownKeys(t)
    }
  })

  return { target: target, state: state, log: log }
}`,
      test: L1S1,
      diag: [
        'get 里写成了 return t[key]，访问器属性中的 this 会指向原对象，receiver 白传了。',
        'set 陷阱返回了 undefined 或赋值的右值，而不是 Reflect.set 的布尔结果。',
        '下划线字段只在 get 里拦了，set 忘了拦，或者拦完还是把值写进去了。',
        'ownKeys 返回的是自己拼的字符串数组，丢了 symbol 键，也不满足不变式。',
        '日志记成了字符串而不是对象，或者 op 字段名和测试不一致。'
      ]
    },
    {
      n: 2,
      title: '把 get / set 变成依赖收集',
      think: '有了拦截点，剩下的就是「谁在读」和「谁要重跑」。用一个全局 activeEffect 记住当前正在跑的函数，get 时登记进依赖表，set 时按 key 把登记过的函数全跑一遍；嵌套要靠栈恢复外层。',
      hint: '依赖表是 WeakMap<target, Map<key, Set<effect>>>；effect 执行前 push 旧的 activeEffect 并把它设成自己，finally 里 pop 回来。',
      code: `function createStore(initial) {
  const log = []
  const target = Object.assign({}, initial)
  const state = new Proxy(target, {
    get(t, key, receiver) {
      log.push({ op: 'get', key: key })
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      log.push({ op: 'set', key: key, value: value })
      return Reflect.set(t, key, value, receiver)
    },
    ownKeys(t) {
      log.push({ op: 'keys', key: null })
      return Reflect.ownKeys(t)
    }
  })
  return { target: target, state: state, log: log }
}

let activeEffect = null
const effectStack = []
const depMap = new WeakMap()

function track(target, key) {
  if (activeEffect === null) return
  let byKey = depMap.get(target)
  if (!byKey) {
    byKey = new Map()
    depMap.set(target, byKey)
  }
  let bag = byKey.get(key)
  if (!bag) {
    bag = new Set()
    byKey.set(key, bag)
  }
  bag.add(activeEffect)
}

function trigger(target, key) {
  const byKey = depMap.get(target)
  if (!byKey) return 0
  const bag = byKey.get(key)
  if (!bag) return 0
  const runners = []
  for (const fn of bag) runners.push(fn)
  for (const fn of runners) fn()
  return runners.length
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const ok = Reflect.set(t, key, value, receiver)
      trigger(t, key)
      return ok
    }
  })
}

function effect(fn) {
  const runner = () => {
    effectStack.push(activeEffect)
    activeEffect = runner
    try {
      return fn()
    } finally {
      activeEffect = effectStack.pop()
    }
  }
  runner()
  return runner
}`,
      test: L1S2,
      diag: [
        'track 在 activeEffect 为 null 时没有提前返回，往依赖表里塞了一个 null。',
        'track 的键用的是代理对象而不是原始 target，get 陷阱里传的是 t，别传 receiver。',
        'effect 执行完没有恢复 activeEffect，嵌套之后外层再也收不到依赖。',
        'trigger 里直接 for of 遍历 Set 并在其中重跑函数，重跑过程改写集合会导致漏跑。',
        'set 陷阱先 trigger 再 Reflect.set，重跑时读到的是旧值。'
      ]
    },
    {
      n: 3,
      title: '生成器惰性管道 + 异步迭代器',
      think: '最后一步换战场：用生成器表达「只在下游要的时候才算」。取 count 全放在算子内部，链式调用时没有任何一次多余计算；再加一个 Symbol.asyncIterator 包装，把同样的惰性搬到异步流上。',
      hint: 'take 写成 yield 之后计数再 return（这样恰好拉 n 次）；takeAsync 用 Promise.resolve(inner.next()).then 把一件异步结果转成一段惰性链。',
      code: `function* naturals(start) {
  let i = start === undefined ? 1 : start
  while (true) {
    yield i
    i++
  }
}

function take(iterable, n) {
  return (function* () {
    if (n <= 0) return
    let count = 0
    for (const value of iterable) {
      yield value
      count++
      if (count >= n) return
    }
  })()
}

function mapLazy(iterable, fn) {
  return (function* () {
    for (const value of iterable) yield fn(value)
  })()
}

function collect(iterable) {
  const out = []
  for (const value of iterable) out.push(value)
  return out
}

function isAsyncIterable(value) {
  return value !== null && value !== undefined && typeof value[Symbol.asyncIterator] === 'function'
}

function takeAsync(iterable, n) {
  return {
    [Symbol.asyncIterator]() {
      const inner = iterable[Symbol.asyncIterator]()
      let count = 0
      return {
        next() {
          if (count >= n) {
            if (typeof inner.return === 'function') inner.return()
            return Promise.resolve({ done: true, value: undefined })
          }
          return Promise.resolve(inner.next()).then((step) => {
            if (step.done) return { done: true, value: undefined }
            count++
            return { done: false, value: step.value }
          })
        }
      }
    }
  }
}`,
      test: L1S3,
      diag: [
        'take 里先 count++ 再 yield，或者把 n 次判断写在 for of 外面，导致多拉一个值。',
        'mapLazy 用了数组的 map 再 yield，整个流被一次性求值，惰性全丢了。',
        'take 用 while 手写 next 却没在结束时调用上游 return，上游的 finally 不会被触发。',
        'isAsyncIterable 只判断了 Symbol.iterator，数组也被判成异步可迭代。',
        'takeAsync 的 next 里先 await 再判断 count，或者直接返回裸值而不是 thenable。'
      ]
    }
  ],
  skeleton: `function createStore(initial) {
  throw new Error('createStore 还没实现')
}

function reactive(target) {
  throw new Error('reactive 还没实现')
}

function effect(fn) {
  throw new Error('effect 还没实现')
}

function* naturals(start) {
  throw new Error('naturals 还没实现')
}

function take(iterable, n) {
  throw new Error('take 还没实现')
}

function mapLazy(iterable, fn) {
  throw new Error('mapLazy 还没实现')
}

function collect(iterable) {
  throw new Error('collect 还没实现')
}

function isAsyncIterable(value) {
  throw new Error('isAsyncIterable 还没实现')
}

function takeAsync(iterable, n) {
  throw new Error('takeAsync 还没实现')
}`,
  solution: `function createStore(initial) {
  const log = []
  const target = Object.assign({}, initial)
  const state = new Proxy(target, {
    get(t, key, receiver) {
      if (typeof key === 'string' && key.charAt(0) === '_') {
        throw new Error('内部字段不可读: ' + key)
      }
      log.push({ op: 'get', key: key })
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      if (typeof key === 'string' && key.charAt(0) === '_') {
        throw new Error('内部字段不可写: ' + key)
      }
      log.push({ op: 'set', key: key, value: value })
      return Reflect.set(t, key, value, receiver)
    },
    ownKeys(t) {
      log.push({ op: 'keys', key: null })
      return Reflect.ownKeys(t)
    }
  })
  return { target: target, state: state, log: log }
}

let activeEffect = null
const effectStack = []
const depMap = new WeakMap()

function track(target, key) {
  if (activeEffect === null) return
  let byKey = depMap.get(target)
  if (!byKey) {
    byKey = new Map()
    depMap.set(target, byKey)
  }
  let bag = byKey.get(key)
  if (!bag) {
    bag = new Set()
    byKey.set(key, bag)
  }
  bag.add(activeEffect)
}

function trigger(target, key) {
  const byKey = depMap.get(target)
  if (!byKey) return 0
  const bag = byKey.get(key)
  if (!bag) return 0
  const runners = []
  for (const fn of bag) runners.push(fn)
  for (const fn of runners) fn()
  return runners.length
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const ok = Reflect.set(t, key, value, receiver)
      trigger(t, key)
      return ok
    }
  })
}

function effect(fn) {
  const runner = () => {
    effectStack.push(activeEffect)
    activeEffect = runner
    try {
      return fn()
    } finally {
      activeEffect = effectStack.pop()
    }
  }
  runner()
  return runner
}

function* naturals(start) {
  let i = start === undefined ? 1 : start
  while (true) {
    yield i
    i++
  }
}

function take(iterable, n) {
  return (function* () {
    if (n <= 0) return
    let count = 0
    for (const value of iterable) {
      yield value
      count++
      if (count >= n) return
    }
  })()
}

function mapLazy(iterable, fn) {
  return (function* () {
    for (const value of iterable) yield fn(value)
  })()
}

function collect(iterable) {
  const out = []
  for (const value of iterable) out.push(value)
  return out
}

function isAsyncIterable(value) {
  return value !== null && value !== undefined && typeof value[Symbol.asyncIterator] === 'function'
}

function takeAsync(iterable, n) {
  return {
    [Symbol.asyncIterator]() {
      const inner = iterable[Symbol.asyncIterator]()
      let count = 0
      return {
        next() {
          if (count >= n) {
            if (typeof inner.return === 'function') inner.return()
            return Promise.resolve({ done: true, value: undefined })
          }
          return Promise.resolve(inner.next()).then((step) => {
            if (step.done) return { done: true, value: undefined }
            count++
            return { done: false, value: step.value }
          })
        }
      }
    }
  }
}`,
  finalCode: `function createStore(initial) {
  const log = []
  const target = Object.assign({}, initial)
  const state = new Proxy(target, {
    get(t, key, receiver) {
      if (typeof key === 'string' && key.charAt(0) === '_') {
        throw new Error('内部字段不可读: ' + key)
      }
      log.push({ op: 'get', key: key })
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      if (typeof key === 'string' && key.charAt(0) === '_') {
        throw new Error('内部字段不可写: ' + key)
      }
      log.push({ op: 'set', key: key, value: value })
      return Reflect.set(t, key, value, receiver)
    },
    ownKeys(t) {
      log.push({ op: 'keys', key: null })
      return Reflect.ownKeys(t)
    }
  })
  return { target: target, state: state, log: log }
}

let activeEffect = null
const effectStack = []
const depMap = new WeakMap()

function track(target, key) {
  if (activeEffect === null) return
  let byKey = depMap.get(target)
  if (!byKey) {
    byKey = new Map()
    depMap.set(target, byKey)
  }
  let bag = byKey.get(key)
  if (!bag) {
    bag = new Set()
    byKey.set(key, bag)
  }
  bag.add(activeEffect)
}

function trigger(target, key) {
  const byKey = depMap.get(target)
  if (!byKey) return 0
  const bag = byKey.get(key)
  if (!bag) return 0
  const runners = []
  for (const fn of bag) runners.push(fn)
  for (const fn of runners) fn()
  return runners.length
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const ok = Reflect.set(t, key, value, receiver)
      trigger(t, key)
      return ok
    }
  })
}

function effect(fn) {
  const runner = () => {
    effectStack.push(activeEffect)
    activeEffect = runner
    try {
      return fn()
    } finally {
      activeEffect = effectStack.pop()
    }
  }
  runner()
  return runner
}

function* naturals(start) {
  let i = start === undefined ? 1 : start
  while (true) {
    yield i
    i++
  }
}

function take(iterable, n) {
  return (function* () {
    if (n <= 0) return
    let count = 0
    for (const value of iterable) {
      yield value
      count++
      if (count >= n) return
    }
  })()
}

function mapLazy(iterable, fn) {
  return (function* () {
    for (const value of iterable) yield fn(value)
  })()
}

function collect(iterable) {
  const out = []
  for (const value of iterable) out.push(value)
  return out
}

function isAsyncIterable(value) {
  return value !== null && value !== undefined && typeof value[Symbol.asyncIterator] === 'function'
}

function takeAsync(iterable, n) {
  return {
    [Symbol.asyncIterator]() {
      const inner = iterable[Symbol.asyncIterator]()
      let count = 0
      return {
        next() {
          if (count >= n) {
            if (typeof inner.return === 'function') inner.return()
            return Promise.resolve({ done: true, value: undefined })
          }
          return Promise.resolve(inner.next()).then((step) => {
            if (step.done) return { done: true, value: undefined }
            count++
            return { done: false, value: step.value }
          })
        }
      }
    }
  }
}`,
  tests: `${L1S1}\n${L1S2}\n${L1S3}`
}

/* ============================================================ 第 2 关测试 */
const L2S1 = `{
  check('状态行拆出版本、状态码和原因短语', () => {
    const msg = parseHttp('HTTP/1.1 304 Not Modified\\r\\nETag: "v3"\\r\\n\\r\\n')
    same(msg.version, 'HTTP/1.1')
    same(msg.status, 304, '状态码必须是 number')
    same(msg.message, 'Not Modified')
  })
  check('响应头名字大小写不敏感', () => {
    const msg = parseHttp('HTTP/1.1 200 OK\\r\\nContent-Type: text/html\\r\\nCache-Control: max-age=60\\r\\n\\r\\n')
    same(getHeader(msg.headers, 'content-TYPE'), 'text/html')
    same(getHeader(msg.headers, 'CACHE-CONTROL'), 'max-age=60')
    same(getHeader(msg.headers, 'x-missing'), null)
    same(typeof msg.headers['content-type'], 'string')
  })
  check('重复的同名头按出现顺序用逗号合并', () => {
    const msg = parseHttp('HTTP/1.1 200 OK\\r\\nVary: Accept\\r\\nVary: Origin\\r\\n\\r\\n')
    same(msg.headers['vary'], 'Accept, Origin')
  })
  check('头和体之间只按第一个空行切分，体不解码', () => {
    same(parseHttp('HTTP/1.1 200 OK\\r\\nContent-Length: 5\\r\\n\\r\\nhello').body, 'hello')
    const nested = 'HTTP/1.1 200 OK\\r\\n\\r\\na\\r\\n\\r\\nb'
    same(parseHttp(nested).body, 'a\\r\\n\\r\\nb', '体内部出现的空行不能再切一刀')
  })
  check('没有体时 body 是空串而不是 undefined', () => {
    const msg = parseHttp('HTTP/1.1 204 No Content\\r\\nDate: x\\r\\n\\r\\n')
    same(msg.body, '')
    same(msg.status, 204)
    same(Object.keys(msg.headers).length, 1)
  })
}`

const L2S2 = `{
  check('还在 max-age 窗口内直接命中强缓存，不发请求', () => {
    const cached = { storedAt: 0, maxAge: 60, etag: '"v1"' }
    same(decideCache({ headers: {} }, cached, 59), 'hit')
    same(decideCache({ headers: {} }, cached, 60), 'miss', '到点是边界，不再算新鲜')
  })
  check('过期后带上与 ETag 一致的 If-None-Match 可以 304', () => {
    const cached = { storedAt: 0, maxAge: 60, etag: '"v1"' }
    same(decideCache({ headers: { 'if-none-match': '"v1"' } }, cached, 61), '304')
  })
  check('过期又没有验证器，只能回源取新内容', () => {
    const cached = { storedAt: 0, maxAge: 60, etag: '"v1"' }
    same(decideCache({ headers: {} }, cached, 61), 'miss')
    same(decideCache({ headers: { 'if-none-match': '"v2"' } }, cached, 61), 'miss', '验证器不匹配')
  })
  check('请求头 no-cache 或 max-age=0 绕过强缓存，但仍可协商出 304', () => {
    const cached = { storedAt: 0, maxAge: 600, etag: '"v1"' }
    same(decideCache({ headers: { 'cache-control': 'no-cache' } }, cached, 10), 'miss', '没有验证器就只能回源')
    same(decideCache({ headers: { 'cache-control': 'no-cache', 'if-none-match': '"v1"' } }, cached, 10), '304')
    same(decideCache({ headers: { 'cache-control': 'max-age=0', 'if-none-match': '"v1"' } }, cached, 10), '304')
  })
  check('没有 ETag 时退回 Last-Modified 比对，no-store 一律不缓存', () => {
    const byDate = { storedAt: 0, maxAge: 0, lastModified: 'Wed, 21 Oct 2020 07:28:00 GMT' }
    same(decideCache({ headers: { 'if-modified-since': 'Wed, 21 Oct 2020 07:28:00 GMT' } }, byDate, 100), '304')
    const byTag = { storedAt: 0, maxAge: 600, etag: '"v2"' }
    same(decideCache({ headers: { 'cache-control': 'no-store' } }, byTag, 10), 'miss')
    same(decideCache({ headers: {} }, null, 100), 'miss', '根本没有缓存副本')
  })
}`

const L2S3 = `{
  check('简单请求不触发预检，直接放行', () => {
    const r = evaluateCors({ origin: 'https://a.com', method: 'GET' }, { allowOrigins: ['https://a.com'] })
    same(r.allowed, true)
    same(r.preflight, false)
    same(r.allowOrigin, 'https://a.com')
    same(r.reason, null)
  })
  check('不在白名单的 origin 被拒绝', () => {
    const r = evaluateCors({ origin: 'https://evil.com', method: 'GET' }, { allowOrigins: ['https://a.com'] })
    same(r.allowed, false)
    same(r.reason, 'origin-not-allowed')
    same(r.allowOrigin, null)
  })
  check('通配符星号与凭证互斥，开了 credentials 必须回显具体 origin', () => {
    const wild = evaluateCors({ origin: 'https://a.com', method: 'GET' }, { allowOrigins: ['*'] })
    same(wild.allowOrigin, '*')
    const veto = evaluateCors({ origin: 'https://a.com', method: 'GET' }, { allowOrigins: ['*'], allowCredentials: true })
    same(veto.allowed, false)
    same(veto.reason, 'wildcard-with-credentials')
    const echo = evaluateCors({ origin: 'https://a.com', method: 'GET' }, { allowOrigins: ['https://a.com'], allowCredentials: true })
    same(echo.allowOrigin, 'https://a.com')
  })
  check('自定义头或非简单方法触发预检，方法不在白名单则整单拒绝', () => {
    const custom = evaluateCors({ origin: 'https://a.com', method: 'POST', headers: { 'X-Token': 't' } }, { allowOrigins: ['https://a.com'] })
    same(custom.preflight, true)
    same(custom.allowed, true, 'POST 本来就在默认方法白名单里')
    const put = evaluateCors({ origin: 'https://a.com', method: 'PUT' }, { allowOrigins: ['https://a.com'], allowMethods: ['GET', 'POST'] })
    same(put.preflight, true)
    same(put.allowed, false)
    same(put.reason, 'method-not-allowed')
  })
  check('content-type 只有三种值算是简单请求', () => {
    const plain = evaluateCors({ origin: 'https://a.com', method: 'POST', headers: { 'Content-Type': 'text/plain' } }, { allowOrigins: ['https://a.com'] })
    same(plain.preflight, false)
    const json = evaluateCors({ origin: 'https://a.com', method: 'POST', headers: { 'Content-Type': 'application/json' } }, { allowOrigins: ['https://a.com'], allowMethods: ['POST'] })
    same(json.preflight, true, 'application/json 不在三种简单类型里')
  })
  check('SameSite 三档决定跨站请求带不带 cookie', () => {
    same(canSendCookie('strict', { sameSite: false, topLevel: true, method: 'GET' }), false)
    same(canSendCookie('lax', { sameSite: false, topLevel: true, method: 'GET' }), true)
    same(canSendCookie('lax', { sameSite: false, topLevel: false, method: 'GET' }), false, 'fetch 跨站不是顶层导航')
    same(canSendCookie('lax', { sameSite: false, topLevel: true, method: 'POST' }), false, 'Lax 只放行顶层 GET')
    same(canSendCookie('none', { sameSite: false, topLevel: false, method: 'POST' }), true)
    same(canSendCookie('strict', { sameSite: true, topLevel: true, method: 'POST' }), true, '同站不受 SameSite 限制')
  })
}`

const L2CODE1 = `function parseStartLine(line) {
  const pieces = []
  for (const part of String(line === undefined ? '' : line).split(' ')) {
    if (part !== '') pieces.push(part)
  }
  return {
    version: pieces[0] === undefined ? '' : pieces[0],
    status: Number(pieces[1]),
    message: pieces.slice(2).join(' ')
  }
}

function parseHeaders(lines) {
  const out = {}
  for (const line of lines) {
    if (line === undefined || line === '') continue
    const cut = line.indexOf(':')
    if (cut <= 0) continue
    const name = line.slice(0, cut).trim().toLowerCase()
    const value = line.slice(cut + 1).trim()
    if (out[name] === undefined) out[name] = value
    else out[name] = out[name] + ', ' + value
  }
  return out
}

function getHeader(headers, name) {
  if (!headers) return null
  const key = String(name).toLowerCase()
  if (Object.prototype.hasOwnProperty.call(headers, key)) return headers[key]
  return null
}

function parseHttp(raw) {
  const text = String(raw === undefined ? '' : raw)
  const cut = text.indexOf('\\r\\n\\r\\n')
  const headPart = cut < 0 ? text : text.slice(0, cut)
  const body = cut < 0 ? '' : text.slice(cut + 4)
  const lines = headPart.split('\\r\\n')
  const start = parseStartLine(lines[0])
  return {
    version: start.version,
    status: start.status,
    message: start.message,
    headers: parseHeaders(lines.slice(1)),
    body: body
  }
}`

const L2CODE2 = L2CODE1 + '\n\n' + `function parseMaxAge(cacheControl) {
  const cc = String(cacheControl === undefined ? '' : cacheControl).toLowerCase()
  const at = cc.indexOf('max-age=')
  if (at < 0) return -1
  const digits = cc.slice(at + 8).split(',')[0].trim()
  if (digits === '') return -1
  const n = Number(digits)
  return Number.isNaN(n) ? -1 : n
}

function decideCache(req, cached, now) {
  if (!cached) return 'miss'
  const headers = (req && req.headers) || {}
  const cc = String(getHeader(headers, 'cache-control') || '').toLowerCase()
  if (cc.indexOf('no-store') >= 0) return 'miss'
  const forced = cc.indexOf('no-cache') >= 0 || parseMaxAge(cc) === 0
  const age = now - cached.storedAt
  const fresh = cached.maxAge !== undefined && age < cached.maxAge
  if (!forced && fresh) return 'hit'
  const etag = getHeader(headers, 'if-none-match')
  if (etag !== null && cached.etag !== undefined && etag === cached.etag) return '304'
  const ims = getHeader(headers, 'if-modified-since')
  if (ims !== null && cached.lastModified !== undefined && ims === cached.lastModified) return '304'
  return 'miss'
}`

const L2CODE3 = L2CODE2 + '\n\n' + `const SIMPLE_METHODS = ['GET', 'HEAD', 'POST']
const SIMPLE_HEADERS = ['accept', 'accept-language', 'content-language', 'content-type', 'range']
const SIMPLE_CONTENT_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain']

function isSimpleRequest(method, headers) {
  const m = String(method === undefined ? 'GET' : method).toUpperCase()
  if (SIMPLE_METHODS.indexOf(m) < 0) return false
  for (const raw of Object.keys(headers || {})) {
    const name = raw.toLowerCase()
    if (SIMPLE_HEADERS.indexOf(name) < 0) return false
    if (name === 'content-type') {
      const value = String(headers[raw]).toLowerCase()
      if (SIMPLE_CONTENT_TYPES.indexOf(value) < 0) return false
    }
  }
  return true
}

function evaluateCors(req, config) {
  const request = req || {}
  const conf = config || {}
  const origins = conf.allowOrigins || []
  const methods = conf.allowMethods || SIMPLE_METHODS
  const method = String(request.method === undefined ? 'GET' : request.method).toUpperCase()
  const preflight = !isSimpleRequest(method, request.headers)
  if (origins.indexOf('*') < 0 && origins.indexOf(request.origin) < 0) {
    return { allowed: false, preflight: preflight, allowOrigin: null, reason: 'origin-not-allowed' }
  }
  if (conf.allowCredentials === true && origins.indexOf('*') >= 0) {
    return { allowed: false, preflight: preflight, allowOrigin: null, reason: 'wildcard-with-credentials' }
  }
  if (preflight && methods.indexOf(method) < 0) {
    return { allowed: false, preflight: preflight, allowOrigin: null, reason: 'method-not-allowed' }
  }
  const allowOrigin = conf.allowCredentials === true ? request.origin : (origins.indexOf('*') >= 0 ? '*' : request.origin)
  return { allowed: true, preflight: preflight, allowOrigin: allowOrigin, reason: null }
}

function canSendCookie(policy, ctx) {
  const p = String(policy === undefined ? 'lax' : policy).toLowerCase()
  const context = ctx || {}
  if (context.sameSite === true) return true
  if (p === 'strict') return false
  if (p === 'lax') {
    const method = String(context.method === undefined ? 'GET' : context.method).toUpperCase()
    return context.topLevel === true && (method === 'GET' || method === 'HEAD')
  }
  return p === 'none'
}`

/* ============================================================ 第 2 关 */
const LV2 = {
  id: 'lv2',
  title: 'HTTP 应用层：报文、两级缓存与跨域矩阵',
  emoji: '📡',
  xp: 50,
  goal: '写三个纯函数：parseHttp 把原始响应文本拆成状态行 / 头 / 体（头名大小写不敏感、重复头合并）；decideCache 依据 max-age、ETag、Last-Modified 给出 hit / 304 / miss；evaluateCors 与 canSendCookie 覆盖简单请求、预检、通配符与凭证互斥、SameSite 三档。',
  why: '缓存和跨域是面试里最容易问到崩的两块，因为答案是一张决策表而不是一句结论。max-age 命中时浏览器根本不发请求；过期后带 If-None-Match 走协商，服务端可能只回 304 让客户端复用旧 body；no-cache 不是「不缓存」而是「每次都得验证」。CORS 那边 `*` 和 credentials 天生互斥，想让带 cookie 的请求通过只能回显具体 origin。把这些分支写成代码，你就会有「哪条先判」的直觉，而不是背 FAQ。',
  nodes: ['fe.network.transport', 'fe.network.transport.cache-strategy', 'fe.network.transport.cors-cookie', 'fe.network.transport.http-basics'],
  thinking: [
    {
      title: '头名大小写不敏感是协议要求',
      md: 'HTTP 头字段名在规范里是大小写不敏感的，`Content-Type`、`content-type`、`CONTENT-TYPE` 是同一个字段。真实实现要么全部转小写入库并提供一个大小写不敏感的查找函数，要么维护一张大小写映射表。\n\n本关选前者：parseHeaders 统一 toLowerCase 存储，getHeader 查找前也 toLowerCase。这样做还有一个副作用值得记住——同名头在 HTTP/1.1 里可以重复出现，规范允许合并成逗号分隔的一个值，所以解析器要把第二次出现的同名头做字符串拼接而不是覆盖。Set-Cookie 是唯一的例外，它必须保留成数组，否则多条 cookie 会被逗号和值里的逗号搞混。'
    },
    {
      title: '缓存是两级，不是一级',
      md: '第一级是强缓存：`Cache-Control: max-age=N` 且副本年龄小于 N，浏览器直接用本地副本，网络面板上显示 from disk cache，请求根本没发出去。第二级是协商缓存：副本过期（或请求头强制验证）后带 `If-None-Match` / `If-Modified-Since` 去问服务端，服务端答 304 就复用 body，答 200 就换新。\n\n所以本关的返回值只有三种：hit（第一级）、304（第二级命中）、miss（第二级未命中或压根没有副本）。面试常问「ETag 和 Last-Modified 哪个优先」——同时存在时 If-None-Match 优先，因为 ETag 是内容指纹，Last-Modified 只到秒级且会被 CDN 的部署时间污染。'
    },
    {
      title: 'CORS 的第一步不是查白名单',
      md: '很多人把 CORS 理解成「服务端配个 Access-Control-Allow-Origin 就行」，漏掉了它其实是两道关：先判断这个请求是不是简单请求（方法只有 GET/HEAD/POST、头只有白名单那几个、content-type 只有三种），不是的话浏览器会先发一个 OPTIONS 预检，预检通过才发真实请求。\n\n预检意味着两倍 RTT，所以 `Content-Type: application/json` 这个日常写法其实一直在触发预检。`Access-Control-Max-Age` 可以把预检结果缓存下来，这是接口优化里最便宜的一刀。带凭证时还有一条硬规则：`Access-Control-Allow-Origin` 不能是 `*`，必须回显请求的 Origin，并且要配 `Access-Control-Allow-Credentials: true`。'
    }
  ],
  prereq: [
    {
      title: 'HTTP/1.1 报文的三段结构',
      md: '一个响应长这样：`状态行 \\r\\n 若干个头 \\r\\n\\r\\n 体`。注意分隔用的是 CRLF（\\r\\n）而不是单独的 \\n，头和体之间是一个空行（连续两个 CRLF）。\n\n麻烦的地方全在体上：体的长度可能由 `Content-Length` 决定，也可能是 `Transfer-Encoding: chunked` 的分块流，还可能根本没有体（204 / 304 / HEAD 响应）。本关的模拟器按「第一个空行切一刀」处理，并把 Content-Length 与 chunked 解码留给真实实现——这就是你要在 concepts 里记住的简化点。'
    },
    {
      title: '同源、跨域与凭证的边界',
      md: '同源要求协议、域名、端口三者完全一致，`http://a.com` 与 `https://a.com` 不同源，`a.com:80` 与 `a.com:8080` 也不同源。跨域请求的错误在浏览器里通常只有一个笼统的 CORS error，因为具体原因（缺 Allow-Origin、缺 Allow-Headers、预检失败）不会暴露给脚本，只能看控制台。\n\n凭证（cookie、Authorization、TLS 客户端证书）让规则更严：请求要带 `credentials: include`，服务端必须回显 origin 且带 Allow-Credentials。而 cookie 本身还受 SameSite 约束：Strict 完全不带，Lax 只放行顶层导航的 GET，None 才能跨站带（且必须 Secure）。'
    }
  ],
  api: [
    {
      name: 'parseHttp / getHeader',
      sig: 'parseHttp(raw: string) => { version, status, message, headers, body }；getHeader(headers, name) => string | null',
      args: 'raw 是完整的原始响应文本（状态行 + 头 + 空行 + 体）；name 是任意大小写形式的头名。',
      returns: 'parseHttp 返回五字段对象，headers 的键已全部小写、同名头用逗号合并；getHeader 命中返回值，未命中返回 null（不是 undefined，方便和三态判断区分）。',
      example: 'const msg = parseHttp(\'HTTP/1.1 200 OK\\r\\nContent-Type: text/html\\r\\n\\r\\nhi\')\nmsg.status                       // 200\ngetHeader(msg.headers, \'CONTENT-TYPE\')  // text/html\nmsg.body                         // hi'
    },
    {
      name: 'decideCache',
      sig: 'decideCache(req, cached, now) => \'hit\' | \'304\' | \'miss\'',
      args: 'req 形如 { headers }（可以带 cache-control、if-none-match、if-modified-since）；cached 是本地副本元信息 { storedAt, maxAge, etag, lastModified }，没有副本传 null；now 是当前时间戳。',
      returns: 'hit 表示强缓存命中不发请求；304 表示协商通过可复用旧 body；miss 表示必须回源取新内容。',
      example: 'const cached = { storedAt: 0, maxAge: 60, etag: \'"v1"\' }\ndecideCache({ headers: {} }, cached, 59)                              // hit\ndecideCache({ headers: { \'if-none-match\': \'"v1"\' } }, cached, 61)   // 304\ndecideCache({ headers: {} }, cached, 61)                             // miss'
    },
    {
      name: 'evaluateCors / canSendCookie',
      sig: 'evaluateCors(req, config) => { allowed, preflight, allowOrigin, reason }；canSendCookie(policy, ctx) => boolean',
      args: 'req 含 origin、method、headers；config 含 allowOrigins、allowMethods、allowCredentials；policy 是 strict / lax / none，ctx 含 sameSite、topLevel、method。',
      returns: 'evaluateCors 返回四字段，reason 为 null 或 origin-not-allowed / wildcard-with-credentials / method-not-allowed；canSendCookie 返回这次跨站请求会不会带上 cookie。',
      example: 'evaluateCors({ origin: \'https://a.com\', method: \'PUT\' }, { allowOrigins: [\'https://a.com\'], allowMethods: [\'GET\'] })\n// { allowed: false, preflight: true, allowOrigin: null, reason: \'method-not-allowed\' }'
    }
  ],
  usage: '// 解析一段抓包拿到的原始响应\nconst msg = parseHttp(raw)\nif (getHeader(msg.headers, \'transfer-encoding\') === \'chunked\') {\n  // 真实实现要在这里先解分块，再交给业务\n}\n\n// 请求前的缓存决策（也可以用来写 Service Worker）\nconst action = decideCache({ headers: requestHeaders }, cacheMeta, Date.now())\nif (action === \'hit\') return fromCache()\nif (action === \'304\') return reuseBody()\nreturn fetchFromNetwork()\n\n// 跨域预判：把要触发的预检提前讲清楚\nconst verdict = evaluateCors({ origin: location.origin, method: \'PUT\', headers: { \'X-Token\': t } }, apiConfig)',
  hints: [
    '第 1 步：先写一个小写的 setHeader 风格的解析器，再补 getHeader；切分只用 indexOf(\'\\r\\n\\r\\n\')，不要用 split 全切。',
    '第 2 步：判断顺序是 no-store → 强制验证 → 强缓存 → 协商；把 max-age=0 当成强制验证，与 no-cache 同路。',
    '第 3 步：isSimpleRequest 要把 content-type 的值也拿出来比，光看头名会把 application/json 错判成简单请求。'
  ],
  concepts: [
    {
      title: '模拟器简化了什么',
      md: '一，体长度完全靠空行切分，不按 Content-Length 截断，也不解 chunked，所以体里出现空行时靠「只切第一个空行」兜住。二，不处理 HTTP/2 的伪头（:status、:method 这类以冒号开头的字段），真实解析器要先把它们挑出来。三，Set-Cookie 用逗号合并了，真实实现必须保留数组。四，SameSite=None 未强制要求 Secure，真实浏览器会拒绝非 Secure 的 None cookie。五，时间由 now 参数注入，没有真实时钟。'
    },
    {
      title: '一张表记住四个响应头',
      md: '`Cache-Control: max-age=60` 管强缓存时长；`ETag: "v1"` 是内容指纹，配 If-None-Match 用；`Last-Modified` 是时间戳，配 If-Modified-Since 用；`Vary: Origin` 告诉缓存「同一 URL 按 Origin 分多份副本」，CDN 上漏了 Vary 就会把 A 站的 CORS 响应发给 B 站。面试里问「CDN 上跨域偶发失败」八成就是 Vary 没配。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '先拆报文：状态行、头、体',
      think: '先让 parseHttp 能把一段原始响应切成三块，并且头名一律小写、同名头合并。这一步刻意不按 Content-Length 截断体，也不解 chunked——先把「切分点在哪」这件事弄对。',
      hint: '用一个 indexOf(\'\\r\\n\\r\\n\') 找头体分界，前段再按 \\r\\n 切成行；第一行交给 parseStartLine。',
      code: L2CODE1,
      test: L2S1,
      diag: [
        '切分用了 split(\'\\r\\n\\r\\n\') 全切，体里出现的空行被切碎，body 只剩第一段。',
        '头名没有 toLowerCase，getHeader 用大写查不到小写键。',
        '同名头直接覆盖了，Vary 的第二行把第一行冲掉。',
        '状态码用字符串存，same 比较 304 与 \'304\' 不相等；记得 Number。',
        '没有体时 body 返回 undefined，204 响应直接触发断言失败。'
      ]
    },
    {
      n: 2,
      title: '两级缓存：先判新鲜度，再判验证器',
      think: '在报文解析之上加一层决策：如果副本还新鲜就直接 hit，不需要发请求；过期或被迫验证才走协商，验证器匹配给 304，否则 miss。关键是判定顺序——no-store 最先，强制验证优先于强缓存。',
      hint: 'fresh 判断是 age < maxAge；forced 判断是 cache-control 里有 no-cache 或 max-age=0，两者都跳到协商分支。',
      code: L2CODE2,
      test: L2S2,
      diag: [
        '把 age < maxAge 写成了 age <= maxAge，到点那一刻错误命中强缓存。',
        'no-cache 直接 return \'miss\'，忽略了它其实还能协商出 304。',
        '只判了 If-None-Match，没有 Last-Modified 与 If-Modified-Since 的退路。',
        'max-age 解析用 parseInt 且没判空，cabecera 为空时拿到 NaN 导致一直不新鲜。',
        'no-store 放在新鲜度判断之后，本应永不缓存的响应被 hit 了。'
      ]
    },
    {
      n: 3,
      title: '跨域矩阵与 SameSite',
      think: '最后一块是「这个跨域请求到底能不能发」。先判要不要预检，再判 origin 白名单，最后处理通配符与凭证互斥、方法白名单。SameSite 单独一个函数，因为它决定的是 cookie 带不带，不是请求能不能发。',
      hint: '预检判定只依赖 method 和 headers；allowOrigin 的返回值在 credentials 场景下必须是请求的 origin，不能偷懒给星号。',
      code: L2CODE3,
      test: L2S3,
      diag: [
        '把预检判断写在了白名单判断之后，被拒的 origin 拿不到 preflight 标记。',
        '开了 credentials 还返回 \'*\'，浏览器会直接判失败，这是最常见的一处配置错误。',
        'isSimpleRequest 只比 header 名字不比 content-type 的值，application/json 被错判成简单请求。',
        '方法不在白名单时仍然 allowed: true，等于把预检白做了。',
        'SameSite=Lax 里忘了判断 topLevel，跨站 fetch 被当成可以带 cookie。',
        'Lax 对顶层导航只放行 GET，忘判 method 会让跨站表单 POST 也带上 cookie。'
      ]
    }
  ],
  skeleton: `function parseStartLine(line) {
  throw new Error('parseStartLine 还没实现')
}

function parseHeaders(lines) {
  throw new Error('parseHeaders 还没实现')
}

function getHeader(headers, name) {
  throw new Error('getHeader 还没实现')
}

function parseHttp(raw) {
  throw new Error('parseHttp 还没实现')
}

function parseMaxAge(cacheControl) {
  throw new Error('parseMaxAge 还没实现')
}

function decideCache(req, cached, now) {
  throw new Error('decideCache 还没实现')
}

function isSimpleRequest(method, headers) {
  throw new Error('isSimpleRequest 还没实现')
}

function evaluateCors(req, config) {
  throw new Error('evaluateCors 还没实现')
}

function canSendCookie(policy, ctx) {
  throw new Error('canSendCookie 还没实现')
}`,
  solution: L2CODE3,
  finalCode: L2CODE3,
  tests: `${L2S1}\n${L2S2}\n${L2S3}`
}

/* ============================================================ 第 3 关测试 */
const L3S1 = `{
  check('单帧文本消息：FIN、opcode 与载荷', () => {
    const parsed = parseWsFrames([0x81, 0x05, 104, 101, 108, 108, 111])
    same(parsed.frames.length, 1)
    same(parsed.truncated, false)
    same(parsed.frames[0].fin, true)
    same(parsed.frames[0].opcode, 1)
    same(parsed.frames[0].masked, false)
    same(parsed.frames[0].text, 'hello')
  })
  check('客户端帧带掩码，要用 mask 逐字节异或还原', () => {
    const masked = [0x81, 0x85, 0x37, 0xfa, 0x21, 0x3d, 127, 159, 77, 81, 88]
    const parsed = parseWsFrames(masked)
    same(parsed.frames.length, 1)
    same(parsed.frames[0].masked, true)
    same(parsed.frames[0].text, 'Hello', '解掩码后必须还原成原文')
  })
  check('一个 buffer 里的多帧按顺序全部解出', () => {
    const parsed = parseWsFrames([0x81, 0x03, 97, 98, 99, 0x81, 0x03, 100, 101, 102])
    same(parsed.frames.length, 2)
    same(parsed.frames[0].text, 'abc')
    same(parsed.frames[1].text, 'def')
  })
  check('载荷超过 125 字节时用两字节扩展长度', () => {
    const text = 'abcdefghij'.repeat(13)
    const bytes = [0x81, 126, 0, 130]
    for (const ch of text) bytes.push(ch.charCodeAt(0))
    const parsed = parseWsFrames(bytes)
    same(parsed.frames.length, 1)
    same(parsed.frames[0].text.length, 130)
    same(parsed.frames[0].text.slice(0, 3), 'abc')
  })
  check('分片消息：FIN=0 的起始帧加 opcode 0 的续帧', () => {
    const parsed = parseWsFrames([0x01, 0x02, 104, 101, 0x80, 0x03, 108, 108, 111])
    same(parsed.frames.length, 2)
    same(parsed.frames[0].fin, false)
    same(parsed.frames[0].opcode, 1)
    same(parsed.frames[1].fin, true)
    same(parsed.frames[1].opcode, 0, '续帧的 opcode 是 0')
    same(parsed.frames[1].text, 'llo')
  })
  check('帧不完整时保留已解出的帧并标记截断', () => {
    const cut = parseWsFrames([0x81, 0x05, 104, 101])
    same(cut.frames.length, 0)
    same(cut.truncated, true)
    const half = parseWsFrames([0x81, 0x02, 104, 105, 0x81, 0x05, 104])
    same(half.frames.length, 1)
    same(half.frames[0].text, 'hi')
    same(half.truncated, true)
  })
}`

const L3S2 = `{
  check('一个 data 行加一个空行派发一条事件', () => {
    const p = createSseParser()
    const events = p.feed('data: hello\\n\\n')
    same(events.length, 1)
    same(events[0].data, 'hello')
  })
  check('多行 data 用换行符拼成一条', () => {
    const p = createSseParser()
    const events = p.feed('data: first\\ndata: second\\n\\n')
    same(events.length, 1)
    same(events[0].data, 'first\\nsecond')
  })
  check('心跳注释行不产生事件', () => {
    const p = createSseParser()
    same(p.feed(': keep-alive\\n\\n').length, 0, '冒号开头的是注释')
    same(p.feed('data: real\\n\\n').length, 1)
  })
  check('跨 chunk 的半行要拼起来再解析', () => {
    const p = createSseParser()
    same(p.feed('da').length, 0)
    same(p.state().buffer, 'da')
    const events = p.feed('ta: hi\\n\\n')
    same(events.length, 1)
    same(events[0].data, 'hi')
  })
  check('id 与 retry 被记住，后续事件继承 id', () => {
    const p = createSseParser()
    const first = p.feed('id: 7\\nretry: 3000\\ndata: x\\n\\n')
    same(first[0].id, '7')
    same(first[0].retry, 3000, 'retry 必须是数字')
    const second = p.feed('data: y\\n\\n')
    same(second[0].id, '7', '断线重连时要拿它当 Last-Event-ID')
    same(p.state().lastId, '7')
    same(p.state().retry, 3000)
  })
  check('没有空行收尾的未完成事件不派发', () => {
    const p = createSseParser()
    same(p.feed('data: pending').length, 0, '连换行符都还没有')
    same(p.state().buffer, 'data: pending')
    same(p.feed('\\n\\n').length, 1, '补齐空行后才算一条完整事件')
  })
}`

const L3S3 = `{
  check('planChunks 按 chunkSize 切片，末片按剩余长度', () => {
    const chunks = planChunks(1000, 300)
    same(chunks.length, 4)
    same(chunks[0].start, 0)
    same(chunks[0].end, 300)
    same(chunks[3].start, 900)
    same(chunks[3].size, 100, '末片不能越过总长度')
  })
  check('整除时不多出一个空片', () => {
    same(planChunks(900, 300).length, 3)
    same(planChunks(0, 300).length, 0)
    same(planChunks(1000, 1000).length, 1)
  })
  check('断点续传跳过已上传的切片', () => {
    const state = { chunks: planChunks(1200, 300), uploaded: [0, 1], inflight: [], concurrency: 3 }
    same(nextBatch(state), [2, 3])
  })
  check('并发窗口已满时一个都不再发', () => {
    const state = { chunks: planChunks(1200, 300), uploaded: [], inflight: [0, 1, 2], concurrency: 3 }
    same(nextBatch(state), [])
  })
  check('正在传输中的切片不会被重复挑中', () => {
    const state = { chunks: planChunks(1200, 300), uploaded: [3], inflight: [1], concurrency: 3 }
    same(nextBatch(state), [0, 2], '跳过 1 在飞和 3 已完成')
  })
  check('Content-Range 解析 206 片段与总长未知', () => {
    const part = parseContentRange('bytes 300-599/1000')
    same(part.start, 300)
    same(part.end, 599)
    same(part.total, 1000)
    same(parseContentRange('bytes 0-1023/*').total, -1, '总长未知用 -1 表示')
    same(parseContentRange('garbage'), null)
  })
}`

const L3CODE1 = `function codesToText(codes) {
  let out = ''
  for (const code of codes) out += String.fromCharCode(code)
  return out
}

function parseWsFrames(bytes) {
  const list = bytes || []
  const frames = []
  let truncated = false
  let i = 0

  while (i + 2 <= list.length) {
    const b0 = list[i]
    const b1 = list[i + 1]
    const fin = (b0 & 0x80) !== 0
    const opcode = b0 & 0x0f
    const masked = (b1 & 0x80) !== 0
    let length = b1 & 0x7f
    let offset = i + 2

    if (length === 126) {
      if (offset + 2 > list.length) {
        truncated = true
        break
      }
      length = list[offset] * 256 + list[offset + 1]
      offset += 2
    } else if (length === 127) {
      truncated = true
      break
    }

    let mask = null
    if (masked) {
      if (offset + 4 > list.length) {
        truncated = true
        break
      }
      mask = [list[offset], list[offset + 1], list[offset + 2], list[offset + 3]]
      offset += 4
    }

    if (offset + length > list.length) {
      truncated = true
      break
    }

    const codes = []
    for (let k = 0; k < length; k++) {
      const raw = list[offset + k]
      codes.push(masked ? (raw ^ mask[k % 4]) : raw)
    }
    offset += length

    frames.push({ fin: fin, opcode: opcode, masked: masked, text: codesToText(codes) })
    i = offset
  }

  if (i < list.length) truncated = true
  return { frames: frames, truncated: truncated }
}`

const L3CODE2 = L3CODE1 + '\n\n' + `function createSseParser(options) {
  const opts = options || {}
  let buffer = ''
  let lastId = opts.lastEventId === undefined ? null : opts.lastEventId
  let retry = null
  let data = []

  function dispatch(events) {
    if (data.length === 0) return
    events.push({ id: lastId, data: data.join('\\n'), retry: retry })
    data = []
  }

  function handleLine(line, events) {
    if (line === '') {
      dispatch(events)
      return
    }
    if (line.charAt(0) === ':') return
    const cut = line.indexOf(':')
    const field = cut < 0 ? line : line.slice(0, cut)
    let value = cut < 0 ? '' : line.slice(cut + 1)
    if (value.charAt(0) === ' ') value = value.slice(1)
    if (field === 'data') data.push(value)
    else if (field === 'id') lastId = value
    else if (field === 'retry') retry = Number(value)
  }

  return {
    feed(chunk) {
      buffer += String(chunk === undefined ? '' : chunk)
      const events = []
      let cut = buffer.indexOf('\\n')
      while (cut >= 0) {
        let line = buffer.slice(0, cut)
        buffer = buffer.slice(cut + 1)
        if (line.length > 0 && line.charAt(line.length - 1) === '\\r') line = line.slice(0, line.length - 1)
        handleLine(line, events)
        cut = buffer.indexOf('\\n')
      }
      return events
    },
    state() {
      return { lastId: lastId, retry: retry, buffer: buffer }
    }
  }
}`

const L3CODE3 = L3CODE2 + '\n\n' + `function planChunks(size, chunkSize) {
  const chunks = []
  if (size <= 0 || chunkSize <= 0) return chunks
  let index = 0
  for (let start = 0; start < size; start += chunkSize) {
    const end = start + chunkSize < size ? start + chunkSize : size
    chunks.push({ index: index, start: start, end: end, size: end - start })
    index++
  }
  return chunks
}

function nextBatch(state) {
  const s = state || {}
  const chunks = s.chunks || []
  const uploaded = s.uploaded || []
  const inflight = s.inflight || []
  const concurrency = s.concurrency === undefined ? 3 : s.concurrency
  const picked = []
  const room = concurrency - inflight.length
  if (room <= 0) return picked
  for (const chunk of chunks) {
    if (picked.length >= room) break
    if (uploaded.indexOf(chunk.index) >= 0) continue
    if (inflight.indexOf(chunk.index) >= 0) continue
    picked.push(chunk.index)
  }
  return picked
}

function parseContentRange(header) {
  const text = String(header === undefined ? '' : header)
  const space = text.indexOf(' ')
  const body = space < 0 ? text : text.slice(space + 1)
  const slash = body.indexOf('/')
  if (slash < 0) return null
  const rangePart = body.slice(0, slash)
  const totalPart = body.slice(slash + 1)
  const dash = rangePart.indexOf('-')
  if (dash < 0) return null
  const start = Number(rangePart.slice(0, dash))
  const end = Number(rangePart.slice(dash + 1))
  if (Number.isNaN(start) || Number.isNaN(end)) return null
  return { start: start, end: end, total: totalPart === '*' ? -1 : Number(totalPart) }
}`

/* ============================================================ 第 3 关 */
const LV3 = {
  id: 'lv3',
  title: '实时通信与传输：WS 帧、SSE 事件流、分片上传',
  emoji: '🔌',
  xp: 60,
  goal: '手写三个协议级解析器：parseWsFrames 按 FIN / opcode / 掩码 / 扩展长度解 WebSocket 帧并标记截断；createSseParser 处理 data 多行拼接、id / retry 状态与跨 chunk 半行；planChunks / nextBatch / parseContentRange 支撑分片上传、并发窗口、断点续传和 Range 下载。',
  why: '实时功能是面试里「用过但说不清」的重灾区。WebSocket 为什么客户端帧必须掩码、SSE 凭什么能自动重连、断点续传的偏移量从哪来——这些不是配置项，是协议细节。写一遍解析器你就会发现：WS 的帧头只有 2 字节却塞了 4 个字段，SSE 的幂等重连靠的是 lastEventId 加 retry，分片上传的正确性靠每片独立的校验和而不是整体校验。这些细节在真实排障（半包、乱序、重复上传）时是唯一能救你的东西。',
  nodes: ['fe.network.realtime', 'fe.network.realtime.sse', 'fe.network.realtime.websocket', 'fe.network.transfer', 'fe.network.transfer.upload'],
  thinking: [
    {
      title: '四种实时方案：先算成本再选型',
      md: '把四个方案按「服务端复杂度 / 延迟 / 双向 / 断线重连成本」打分：短轮询最笨但最兼容，延迟等于轮询间隔，服务端无状态；长轮询把延迟压到一个 RTT，代价是每个连接占一个线程或一个 event loop 句柄；SSE 是单向下行流，浏览器原生带 lastEventId 与自动重连，走普通 HTTP 因此天然过代理；WebSocket 全双工，但要处理心跳、掩码、分片，还要自己做重连退避。\n\n评分函数长什么样？给每条需求一个权重（低延迟 0.4、双向 0.3、穿透代理 0.2、实现成本 0.1），把四个方案各自打分相乘求和，选最高分。面试里能当场列出这张权重表，比背「WebSocket 更好」有说服力得多。'
    },
    {
      title: 'WS 帧头 2 字节里的四个字段',
      md: '第一个字节：最高位 FIN 表示这是消息的最后一帧，低 4 位 opcode 表示类型（1 文本、2 二进制、8 关闭、9 ping、10 pong）。第二个字节：最高位 MASK 表示载荷是否被掩码，低 7 位是长度。\n\n长度有三种编码：0 到 125 直接是长度；126 表示后面跟 2 字节无符号整数；127 表示后面跟 8 字节。客户端发往服务端的帧必须掩码（防止缓存投毒），服务端发往客户端的帧必须不掩码——所以解析器要同时支持两种情况。分片消息第一帧 FIN=0，后续帧 opcode=0（continuation），最后一帧 FIN=1，重组成完整消息才算一次 onmessage。'
    },
    {
      title: 'SSE 的三个字段撑起「可靠下行流」',
      md: '`data` 累积到空行才派发，多行 data 用换行拼起来；`id` 更新 lastEventId，重连时浏览器自动带上 `Last-Event-ID` 请求头，服务端据此续传；`retry` 指定重连间隔（毫秒），浏览器会用这个值覆盖自己的退避策略。冒号开头是注释，常用作保活心跳，防止中间层 60 秒空闲断连。\n\n最容易被忽略的是「行」的边界：`\\n`、`\\r\\n`、`\\r` 都算换行，而且 chunk 边界可能正好切在一行中间。所以解析器必须持有 buffer，只处理完整的行，剩下的留到下一个 chunk。这就是第 2 关跨包测试的意义。'
    }
  ],
  prereq: [
    {
      title: '字节序、位运算与掩码',
      md: '位运算在协议解析里是刚需：`b & 0x80` 取最高位，`b & 0x7f` 取低七位，`b0 * 256 + b1` 拼大端 16 位整数。注意 JS 的 `&` 会把操作数转成 32 位有符号整数，处理 8 字节扩展长度时必须换成乘法或 BigInt，否则超过 2^31 就溢出。\n\n掩码是逐字节循环异或：第 k 个字节与 mask[k % 4] 异或。它没有加密强度（全零掩码也合法），唯一目的是让客户端的流量不可预测，避免中间代理把内容当成可缓存的固定字节序列。'
    },
    {
      title: '流式解析为什么要「状态机 + buffer」',
      md: '网络数据到达的边界和逻辑边界毫无关系：一个 200 字节的响应可能被切成 3 段到达，也可能两帧粘在同一段里。所以解析器不能假设「一次 data 事件就是一条完整消息」，必须把没消费完的字节留在 buffer 里，下次先拼再解。\n\nSSE 与 WS 都是这个套路，区别只在判定「一条完整消息」的规则：SSE 看空行，WS 看长度字段。断点续传也是同一类问题——你要能用一个偏移量描述「已经消费到哪里」，才能在中途失败后接着往下走。'
    }
  ],
  api: [
    {
      name: 'parseWsFrames',
      sig: 'parseWsFrames(bytes: number[]) => { frames, truncated }',
      args: 'bytes 是 0 到 255 的整数数组，可以包含一个或多个帧，也可以只包含半帧；不传时按空数组处理。',
      returns: 'frames 是解出的帧数组，每项含 fin、opcode、masked、text；truncated 表示剩余字节不足以构成完整帧（真实实现应保留这部分等下一段数据）。',
      example: 'const parsed = parseWsFrames([0x81, 0x05, 104, 101, 108, 108, 111])\nparsed.frames[0].opcode   // 1 文本帧\nparsed.frames[0].text     // hello\nparsed.truncated          // false'
    },
    {
      name: 'createSseParser',
      sig: 'createSseParser(options?) => { feed(chunk) => events[], state() => { lastId, retry, buffer } }',
      args: 'options.lastEventId 是重连时带上的初始 id；feed 接收任意长度的字符串片段（chunk 边界可以在任何位置）。',
      returns: 'feed 返回本次 chunk 里凑齐的完整事件数组，每项含 id、data、retry；state 暴露当前累积状态，便于断言和手工续传。',
      example: 'const p = createSseParser({ lastEventId: "7" })\np.feed("data: hel")        // []，半行留在 buffer\np.feed("lo\\n\\n")           // [{ id: "7", data: "hello", retry: null }]'
    },
    {
      name: 'planChunks / nextBatch / parseContentRange',
      sig: 'planChunks(size, chunkSize) => chunk[]；nextBatch(state) => index[]；parseContentRange(header) => { start, end, total }',
      args: 'size 是文件总字节数；chunkSize 是单片大小；state 含 chunks、uploaded、inflight、concurrency；header 形如 bytes 300-599/1000。',
      returns: 'planChunks 返回带 index / start / end / size 的切片描述；nextBatch 返回本轮可发的切片下标（受并发窗口限制）；parseContentRange 返回解析结果，总长未知时 total 为 -1，格式非法时返回 null。',
      example: 'const chunks = planChunks(1000, 300)      // 4 片，末片 100 字节\nnextBatch({ chunks, uploaded: [0], inflight: [1], concurrency: 2 })  // [2]\nparseContentRange("bytes 0-1023/*").total // -1'
    }
  ],
  usage: '// 1) WS：data 事件拿到 ArrayBuffer 后先解帧\nws.addEventListener(\'message\', (evt) => {\n  const view = new Uint8Array(evt.data)\n  const { frames, truncated } = parseWsFrames(Array.from(view))\n  if (truncated) pending.push(view)      // 半帧留着和下一段拼\n  for (const frame of frames) onFrame(frame)\n})\n\n// 2) SSE：res.body 的 reader 每读到一段就喂给解析器\nconst parser = createSseParser({ lastEventId: localStorage.getItem(\'sse-id\') })\nfor await (const chunk of stream) {\n  for (const evt of parser.feed(chunk)) render(evt)\n}\n\n// 3) 上传：切成片，按窗口发，失败只重传那一片\nconst chunks = planChunks(file.size, 4 * 1024 * 1024)\nconst batch = nextBatch({ chunks, uploaded, inflight, concurrency: 3 })',
  hints: [
    '第 1 步：先读 2 字节帧头，再按 126/127 决定要不要多读 2 或 8 字节长度，最后按 MASK 位决定要不要读 4 字节掩码。',
    '第 2 步：feed 里只消费完整行（indexOf 换行符），剩下的留在 buffer；空行才 dispatch，data 数组要清空。',
    '第 3 步：nextBatch 先算 room = concurrency - inflight.length，再按序扫，已上传和在飞的都跳过。'
  ],
  concepts: [
    {
      title: '模拟器简化了什么',
      md: '一，载荷只按 ASCII 逐字节转字符，没有实现 UTF-8 解码，中文会被拆成乱码——真实实现必须按 UTF-8 解并把解码器跨帧保留状态。二，8 字节扩展长度（127）直接判为截断，没有解大端 64 位整数。三，不做分片重组，只把每帧的 fin / opcode 原样交出去，重组交给调用方。四，SSE 只处理 data / id / retry 三个字段，没有实现 event 字段与自定义事件名。五，上传没有真实网络，切片与批次都是纯计算。'
    },
    {
      title: '校验和为什么必须按片算',
      md: '大文件上传的正确性检查有两种：整体 MD5（或分片 MD5 再拼 Merkle 树）和逐片校验。整体校验的致命问题是「无法定位坏片」——1GB 文件传完发现不一致，只能整包重传；逐片校验则允许只重传坏掉的那一片，配合断点续传才真正省流量。\n\n服务端还要做「秒传」判定：上传前先发一个 HEAD 或查询接口，报上文件 hash 与分片 hash 列表，服务端发现全部命中就直接返回成功。这也是为什么分片上传接口通常有三个端点：初始化（拿 uploadId）、传片（带 index 与 hash）、合并（带整体 hash 与分片清单）。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '解 WebSocket 帧：2 字节头 + 掩码 + 扩展长度',
      think: '先按「读 2 字节头 → 按长度编码决定多读几字节 → 按 MASK 决定读 4 字节掩码 → 逐字节异或」的顺序解一帧。截断的帧不能抛错，要把已解出的帧交出去并标记 truncated，因为真实场景里半包是常态。',
      hint: '长度 126 时读两字节拼成大端整数；掩码是 payload[k] ^ mask[k % 4]；循环条件写 i + 2 <= length，剩下的字节标记截断。',
      code: L3CODE1,
      test: L3S1,
      diag: [
        'opcode 用 b0 直接取，没有 & 0x0f，FIN 位混进了类型里。',
        '掩码只在第一个字节生效，或者用了 mask[0] 固定异或，后半段全乱。',
        '扩展长度按 length * 256 + next 的顺序写反了，130 变成 33280。',
        '解完一帧忘了把 i 推到 offset，死循环或重复解同一帧。',
        '遇到长度不足直接抛错，半包场景把整个连接打挂。',
        '截断标记只在 126 分支里设，普通帧被截断时 truncated 仍是 false。'
      ]
    },
    {
      n: 2,
      title: 'SSE 事件流：只消费完整行',
      think: 'SSE 的难点全在「行」上：换行有三种写法、chunk 边界可能在任意位置、空行才派发。把 buffer 当成唯一事实来源，每次 feed 只处理到最后一个换行符为止，剩下的留着等下一次。',
      hint: 'while (buffer 里有换行) 取一行 → 去掉尾部 \\r → 交给 handleLine；handleLine 里空行 dispatch，冒号开头直接 return。',
      code: L3CODE2,
      test: L3S2,
      diag: [
        'feed 用 split(\\n) 一把梭，半行被当成完整行解析，跨包直接丢数据。',
        '空行只清 data 没 dispatch，或者 dispatch 后没清空 data，下一条事件把上一条拼进去。',
        '冒号注释被当成字段解析，field 为空却仍然 push 了一个空串。',
        'id 只在事件对象里带，没有存到解析器状态，下一条事件丢了 lastEventId。',
        'retry 用字符串存，后面比较或退避计算时隐式转换出错。',
        '多行 data 直接覆盖，没有用数组收集最后 join。'
      ]
    },
    {
      n: 3,
      title: '分片上传与 Range 下载',
      think: '最后一步是调度：把文件切成分片、按并发窗口挑下一批发、跳过已完成的（断点续传）。Range 下载则是同一套偏移量的反向使用——请求头要一段，响应头告诉你拿到了哪一段、总共多大。',
      hint: 'planChunks 的结束条件写成 start < size，末片 end 取 min(start + chunkSize, size)；nextBatch 先算 room 再扫。',
      code: L3CODE3,
      test: L3S3,
      diag: [
        'planChunks 用 start <= size 循环，整除时多出一个 size 为 0 的空片。',
        '末片的 end 直接写 start + chunkSize，超过总长度，服务端会返回 416。',
        'nextBatch 没有减去 inflight 的长度，并发窗口形同虚设。',
        'nextBatch 只跳过已上传，重复挑了在飞的片，同一片被传两次。',
        'parseContentRange 把 bytes 前缀也当成数字解析，start 变成 NaN。',
        '总长 * 时返回 NaN 或字符串，后续算进度时出现 NaN%。'
      ]
    }
  ],
  skeleton: `function parseWsFrames(bytes) {
  throw new Error('parseWsFrames 还没实现')
}

function createSseParser(options) {
  throw new Error('createSseParser 还没实现')
}

function planChunks(size, chunkSize) {
  throw new Error('planChunks 还没实现')
}

function nextBatch(state) {
  throw new Error('nextBatch 还没实现')
}

function parseContentRange(header) {
  throw new Error('parseContentRange 还没实现')
}`,
  solution: L3CODE3,
  finalCode: L3CODE3,
  tests: `${L3S1}\n${L3S2}\n${L3S3}`
}

/* ============================================================ 第 4 关测试 */
const L4S1 = `{
  check('一条连接可以串行复用，三次请求只握手一次', () => {
    const report = simulateConnections([
      { origin: 'https://a.com', path: '/1' },
      { origin: 'https://a.com', path: '/2' },
      { origin: 'https://a.com', path: '/3' }
    ], { protocol: 'http1', maxPerHost: 1 })
    same(report.connections, 1, 'keep-alive 复用同一条连接')
    same(report.handshakes, 1, '握手只发生一次')
    same(report.rounds, 3, '串行复用要排三轮')
  })
  check('HTTP/1.1 六个并发上限之外的要排队', () => {
    const requests = []
    for (let i = 0; i < 8; i++) requests.push({ origin: 'https://a.com', path: '/' + i })
    const report = simulateConnections(requests, { protocol: 'http1', maxPerHost: 6 })
    same(report.connections, 6, '连接池开满 6 条')
    same(report.rounds, 2, '第二批 2 个请求要等第一轮腾出连接')
  })
  check('HTTP/2 一个源只开一条连接且全部并发', () => {
    const requests = []
    for (let i = 0; i < 8; i++) requests.push({ origin: 'https://a.com', path: '/' + i })
    const report = simulateConnections(requests, { protocol: 'http2' })
    same(report.connections, 1)
    same(report.rounds, 1, '多路复用没有排队轮次')
    same(report.protocol, 'http2')
  })
  check('不同源之间不共享连接', () => {
    const requests = [
      { origin: 'https://a.com', path: '/x' },
      { origin: 'https://cdn.com', path: '/z' }
    ]
    same(simulateConnections(requests, { protocol: 'http1' }).connections, 2)
    same(simulateConnections(requests, { protocol: 'http2' }).connections, 2)
    same(simulateConnections(requests, { protocol: 'http2' }).handshakes, 2)
  })
  check('没有请求时不建连接也不产生轮次', () => {
    const empty = simulateConnections([], { protocol: 'http1' })
    same(empty.connections, 0)
    same(empty.handshakes, 0)
    same(empty.rounds, 0)
    same(simulateConnections(undefined, undefined).protocol, 'http1', '默认按 http1 建模')
  })
}`

const L4S2 = `{
  check('preload 命中的条件是同 URL 且 as 一致', () => {
    const r = matchHint({ url: 'https://a.com/app.js', as: 'script' }, { rel: 'preload', href: 'https://a.com/app.js', as: 'script' })
    same(r.matched, true)
    same(r.effect, 'fetch-early', '提前拉取且能直接被后续标签复用')
  })
  check('跨域 preload 没写 crossorigin 会白下一遍', () => {
    const page = 'https://a.com'
    const res = { url: 'https://cdn.com/f.woff2', as: 'font', page: page }
    const miss = matchHint(res, { rel: 'preload', href: 'https://cdn.com/f.woff2', as: 'font' })
    same(miss.matched, false)
    same(miss.effect, 'wasted', '凭证模式不一致，字体得再下一次')
    const hit = matchHint(res, { rel: 'preload', href: 'https://cdn.com/f.woff2', as: 'font', crossorigin: true })
    same(hit.matched, true)
    same(hit.effect, 'fetch-early')
    const local = matchHint({ url: '/theme.css', as: 'style', page: page }, { rel: 'preload', href: '/theme.css', as: 'style' })
    same(local.matched, true, '同源不需要 crossorigin')
  })
  check('as 写错类型同样复用不上', () => {
    const r = matchHint({ url: 'https://a.com/theme.css', as: 'style' }, { rel: 'preload', href: 'https://a.com/theme.css', as: 'script' })
    same(r.matched, false)
    same(r.effect, 'wasted')
  })
  check('preconnect 只预热连接，不下载内容', () => {
    const r = matchHint({ url: 'https://api.com/v1/list', as: 'fetch' }, { rel: 'preconnect', href: 'https://api.com' })
    same(r.matched, true)
    same(r.effect, 'warm-connection')
    const wrong = matchHint({ url: 'https://api.com/v1/list', as: 'fetch' }, { rel: 'preconnect', href: 'https://other.com' })
    same(wrong.matched, false)
    same(wrong.effect, 'wasted')
  })
  check('prefetch 归入空闲下载，dns-prefetch 只算解析域名', () => {
    same(matchHint({ url: 'https://a.com/next.js' }, { rel: 'prefetch', href: 'https://a.com/next.js' }).effect, 'idle-fetch')
    same(matchHint({ url: 'https://a.com/x' }, { rel: 'dns-prefetch', href: 'https://a.com' }).effect, 'dns-only')
    same(matchHint({ url: 'https://a.com/x' }, { rel: 'dns-prefetch', href: 'https://b.com' }).effect, 'wasted')
  })
}`

const L4S3 = `{
  check('head 里的同步脚本阻塞，defer 与 async 不阻塞', () => {
    same(isRenderBlocking({ url: '/app.js', type: 'script', inHead: true }), true)
    same(isRenderBlocking({ url: '/defer.js', type: 'script', inHead: true, defer: true }), false)
    same(isRenderBlocking({ url: '/async.js', type: 'script', inHead: true, async: true }), false)
    same(isRenderBlocking({ url: '/body.js', type: 'script', inHead: false }), false, 'body 末尾的同步脚本不挡首屏')
  })
  check('普通 CSS 阻塞，print 媒体查询的不阻塞', () => {
    same(isRenderBlocking({ url: '/a.css', type: 'css' }), true)
    same(isRenderBlocking({ url: '/p.css', type: 'css', media: 'print' }), false)
    same(isRenderBlocking({ url: '/s.css', type: 'css', media: 'screen' }), true)
    same(isRenderBlocking({ url: '/i.png', type: 'img' }), false)
  })
  check('关键字节只累计阻塞资源', () => {
    const report = analyzeCriticalPath([
      { url: '/a.css', type: 'css', bytes: 50 },
      { url: '/app.js', type: 'script', inHead: true, bytes: 70 },
      { url: '/hero.png', type: 'img', bytes: 500 }
    ], 100)
    same(report.blocking, ['/a.css', '/app.js'])
    same(report.bytes, 120, '图片不进关键路径预算')
    same(report.overBudget, true)
  })
  check('超预算时按阻塞资源给出可执行建议', () => {
    const report = analyzeCriticalPath([
      { url: '/a.css', type: 'css', bytes: 50 },
      { url: '/app.js', type: 'script', inHead: true, bytes: 70 }
    ], 100)
    same(report.suggestions, ['inline-critical-css', 'defer-script'])
    const heavy = analyzeCriticalPath([{ url: '/big.js', type: 'script', inHead: true, bytes: 300 }], 100)
    same(heavy.suggestions, ['defer-script', 'split-bundle'], '超过两倍预算再加拆包建议')
  })
  check('没超预算就不给建议，非阻塞资源也不进 blocking', () => {
    const fine = analyzeCriticalPath([
      { url: '/a.css', type: 'css', bytes: 30 },
      { url: '/defer.js', type: 'script', inHead: true, defer: true, bytes: 200 }
    ], 100)
    same(fine.bytes, 30)
    same(fine.overBudget, false)
    same(fine.suggestions, [])
    same(fine.blocking, ['/a.css'])
  })
}`

const L4CODE1 = `function simulateConnections(requests, options) {
  const list = requests || []
  const opts = options || {}
  const protocol = opts.protocol === 'http2' ? 'http2' : 'http1'
  const maxPerHost = opts.maxPerHost === undefined ? 6 : opts.maxPerHost

  const counts = {}
  const order = []
  for (const req of list) {
    const origin = req && req.origin !== undefined ? req.origin : ''
    if (counts[origin] === undefined) {
      counts[origin] = 0
      order.push(origin)
    }
    counts[origin] = counts[origin] + 1
  }

  let connections = 0
  let rounds = 0
  for (const origin of order) {
    const count = counts[origin]
    if (protocol === 'http2') {
      connections += 1
    } else {
      connections += count < maxPerHost ? count : maxPerHost
      const need = Math.ceil(count / maxPerHost)
      if (need > rounds) rounds = need
    }
  }
  if (protocol === 'http2') rounds = order.length > 0 ? 1 : 0

  return { protocol: protocol, connections: connections, handshakes: connections, rounds: rounds }
}`

const L4CODE2 = L4CODE1 + '\n\n' + `function originOf(url) {
  const text = String(url === undefined ? '' : url)
  const at = text.indexOf('://')
  if (at < 0) return ''
  const rest = text.slice(at + 3)
  const slash = rest.indexOf('/')
  return text.slice(0, at + 3) + (slash < 0 ? rest : rest.slice(0, slash))
}

function isCrossOrigin(resource, url) {
  const page = resource.page
  if (page === undefined) return false
  const text = String(url === undefined ? '' : url)
  if (text.indexOf('://') < 0) return false
  return originOf(page) !== originOf(text)
}

function matchHint(resource, hint) {
  const res = resource || {}
  const link = hint || {}
  const rel = String(link.rel === undefined ? '' : link.rel).toLowerCase()
  const sameOrigin = originOf(res.url) === originOf(link.href)
  const sameUrl = res.url === link.href

  if (rel === 'dns-prefetch') {
    return { matched: sameOrigin, effect: sameOrigin ? 'dns-only' : 'wasted' }
  }
  if (rel === 'preconnect') {
    return { matched: sameOrigin, effect: sameOrigin ? 'warm-connection' : 'wasted' }
  }
  if (rel === 'preload') {
    if (!sameUrl) return { matched: false, effect: 'wasted' }
    if (isCrossOrigin(res, res.url) && link.crossorigin !== true) return { matched: false, effect: 'wasted' }
    if (link.as !== undefined && res.as !== undefined && link.as !== res.as) {
      return { matched: false, effect: 'wasted' }
    }
    return { matched: true, effect: 'fetch-early' }
  }
  if (rel === 'prefetch') {
    if (!sameUrl) return { matched: false, effect: 'wasted' }
    return { matched: true, effect: 'idle-fetch' }
  }
  return { matched: false, effect: 'wasted' }
}`

const L4CODE3 = L4CODE2 + '\n\n' + `function isRenderBlocking(resource) {
  const res = resource || {}
  if (res.type === 'css') {
    const media = res.media === undefined ? 'all' : String(res.media).toLowerCase()
    return media === '' || media === 'all' || media === 'screen'
  }
  if (res.type === 'script') {
    if (res.inHead !== true) return false
    if (res.async === true || res.defer === true) return false
    return true
  }
  return false
}

function analyzeCriticalPath(resources, budgetBytes) {
  const list = resources || []
  const budget = budgetBytes === undefined ? 0 : budgetBytes
  const blocking = []
  let bytes = 0
  let hasCss = false
  let hasScript = false

  for (const res of list) {
    if (!isRenderBlocking(res)) continue
    blocking.push(res.url)
    bytes += res.bytes === undefined ? 0 : res.bytes
    if (res.type === 'css') hasCss = true
    if (res.type === 'script') hasScript = true
  }

  const overBudget = bytes > budget
  const suggestions = []
  if (overBudget && hasCss) suggestions.push('inline-critical-css')
  if (overBudget && hasScript) suggestions.push('defer-script')
  if (overBudget && bytes > budget * 2) suggestions.push('split-bundle')

  return { blocking: blocking, bytes: bytes, overBudget: overBudget, suggestions: suggestions }
}`

/* ============================================================ 第 4 关 */
const LV4 = {
  id: 'lv4',
  title: '加载优化：连接复用、资源提示、关键路径预算',
  emoji: '⚡',
  xp: 70,
  goal: '写三个模型：simulateConnections 按 keep-alive 连接池与 HTTP/2 多路复用算出连接数、握手数与排队轮次；matchHint 判定 preload / prefetch / preconnect / dns-prefetch 是否真的命中；analyzeCriticalPath 找出阻塞资源、累计关键字节并给出可执行建议。',
  why: '性能优化的面试题最容易露馅：能背「用 preload、开 HTTP2、上 CDN」的人多，能说清「preload 写了但 as 错，等于多下一次」的人少。这一关把优化从口号变成可计算的模型：连接数是源数量与并发上限的函数，提示是否命中取决于 URL、as、crossorigin 三个条件，关键路径预算只累计真正阻塞渲染的字节。算得出来，你在评审时才有底气说「这条 preconnect 该删」。',
  nodes: ['fe.network.optimize', 'fe.network.optimize.conn-reuse', 'fe.network.optimize.load-priority'],
  thinking: [
    {
      title: '六个并发连接上限塑造了十年前的优化手法',
      md: 'HTTP/1.1 规范建议每个源最多 6 条并发连接（浏览器实现略有差异），而且一条连接上一个响应发完才发下一个，所以 8 个同源请求要分两轮，第二个请求会被前一个慢请求堵住（队头阻塞）。\n\n域名分片（把静态资源拆到 s0、s1、s2 三个子域）就是绕这个上限的老办法，雪碧图、base64 内联也是「减少请求数」的同一逻辑。HTTP/2 之后这些手法基本失效甚至有害：一个源一条连接就够，多开子域反而多付 DNS 与 TLS 成本，而 base64 会把压缩率搞坏。所以面试里说「HTTP2 下 sprite 没意义了」是有前提的——单源、且服务端开启多路复用。'
    },
    {
      title: 'preload 的三个失效条件',
      md: '一，URL 不一致（多了 query、少了 hash 版本号）。二，as 与实际请求类型不一致——浏览器按 as 决定用哪个优先级和哪个缓存分区，as="script" 的预加载没法给 style 用。三，跨域却没写 crossorigin，凭证模式对不上（no-cors 与 anonymous 是两个缓存槽），字体尤其典型：CSS 里的字体请求默认带匿名跨域，preload 不写 crossorigin 就必然下两次。\n\n还有一类不是「失效」而是「浪费」：preload 了但页面根本没用到，控制台会警告 unused preload。prefetch 则是明确告诉浏览器「下一页要用，空闲时下」，它不参与当前页的关键路径，也就不会挤占带宽优先级。'
    },
    {
      title: '关键渲染路径是一条链，不是一个文件列表',
      md: '首屏要出字，浏览器必须：拿到 HTML → 解析到 CSS 就停下渲染去下载并解析它 → 遇到同步 script 就停下解析去下载并执行 → 有了 CSSOM 和 DOM 才能算布局、绘制。这条链上任何一环的字节量都算「关键字节」，链外的东西（图片、defer 脚本、异步请求）不挡首屏。\n\n所以预算是按链算的：把阻塞资源加起来和预算比，超了就给对应建议——有阻塞 CSS 就内联首屏关键样式，有阻塞脚本就加 defer，超两倍就拆包。注意 `media="print"` 的 CSS 不阻塞（只在打印时用），`type="module"` 的脚本默认 defer，这些都是让判断变复杂但值得记住的细节。'
    }
  ],
  prereq: [
    {
      title: 'keep-alive 与多路复用的区别',
      md: 'keep-alive 解决的是「连接不用每次重开」：一次 TCP + TLS 握手之后复用这条连接发多个请求，但请求仍然是串行的，前一个响应没回来，后一个请求不能发。所以它省的是握手成本，不解决队头阻塞。\n\nHTTP/2 的多路复用把一条连接切成很多 stream，每个 stream 有自己的 id 和流控窗口，帧可以交错发送，因此并发不再受 6 条连接限制。代价是丢包时整条 TCP 连接都受影响（TCP 层队头阻塞），这也是 HTTP/3 换 QUIC 的原因。面试里能把「省握手」与「免排队」这两件事分开说，就算过关了。'
    },
    {
      title: '浏览器如何给资源定优先级',
      md: '浏览器按资源的角色给内部优先级：HTML、CSS、字体、head 里的同步脚本是高优先级；图片默认低，首屏内图片会被临时提升；`<script async>` 低，`defer` 更低；`fetch` 默认高。\n\nresource hints 本质是改这张优先级表：`preload` 把某个还没被发现的资源提前拉到高优先级（常用于字体、首屏大图、late-discovered 的 CSS 背景图）；`prefetch` 放进最低优先级、空闲时才跑；`preconnect` 只做 DNS + TCP + TLS，省的是握手；`dns-prefetch` 只做 DNS，是最便宜的一档。写错 rel 不会报错，只会静默浪费。'
    }
  ],
  api: [
    {
      name: 'simulateConnections',
      sig: 'simulateConnections(requests, options) => { protocol, connections, handshakes, rounds }',
      args: 'requests 是 [{ origin, path }]；options 含 protocol（http1 / http2，缺省 http1）与 maxPerHost（缺省 6）。',
      returns: 'connections 是实际建立的连接数，handshakes 等于它（每条新连接一次握手），rounds 是发完所有请求需要的排队轮次。',
      example: 'simulateConnections(Array(8).fill({ origin: \'https://a.com\' }), { protocol: \'http1\' })\n// { protocol: \'http1\', connections: 6, handshakes: 6, rounds: 2 }\nsimulateConnections(requests, { protocol: \'http2\' })  // connections 1, rounds 1'
    },
    {
      name: 'matchHint',
      sig: 'matchHint(resource, hint) => { matched, effect }',
      args: 'resource 形如 { url, as, page }（page 是页面所在源，用来判断资源是否跨域）；hint 形如 { rel, href, as, crossorigin }。',
      returns: 'matched 表示这条提示是否真的对得上；effect 是 fetch-early（提前拉取可复用）/ idle-fetch（空闲下载）/ warm-connection（预热连接）/ dns-only（只解析域名）/ wasted（白写）。',
      example: 'matchHint({ url: \'https://cdn.com/f.woff2\', as: \'font\' }, { rel: \'preload\', href: \'https://cdn.com/f.woff2\', as: \'font\' }).effect\n// wasted —— 跨域少了 crossorigin\nmatchHint({ url: \'https://a.com/app.js\' }, { rel: \'preconnect\', href: \'https://a.com\' }).effect  // warm-connection'
    },
    {
      name: 'analyzeCriticalPath',
      sig: 'analyzeCriticalPath(resources, budgetBytes) => { blocking, bytes, overBudget, suggestions }',
      args: 'resources 是 [{ url, type, bytes, inHead, async, defer, media }]；budgetBytes 是关键路径预算（字节）。',
      returns: 'blocking 是阻塞渲染的 URL 列表（保持输入顺序），bytes 是关键字节总和，overBudget 表示是否超预算，suggestions 是按规则生成的建议数组。',
      example: 'analyzeCriticalPath([\n  { url: \'/a.css\', type: \'css\', bytes: 50 },\n  { url: \'/app.js\', type: \'script\', inHead: true, bytes: 70 }\n], 100)\n// blocking: [\'/a.css\', \'/app.js\'], bytes: 120, overBudget: true,\n// suggestions: [\'inline-critical-css\', \'defer-script\']'
    }
  ],
  usage: '// 1) 评审结论：这个页面到底开了几条连接\nconst report = simulateConnections(Object.keys(assets).map((origin) => ({ origin })), { protocol: \'http2\' })\nconsole.log(report.connections, \'条连接，\', report.rounds, \'轮\')\n\n// 2) 把现有的 link 标签过一遍，找出白写的提示\nfor (const tag of document.querySelectorAll(\'link[rel]\')) {\n  const verdict = matchHint({ url: tag.dataset.expected, as: tag.getAttribute(\'as\') }, {\n    rel: tag.rel, href: tag.href, as: tag.getAttribute(\'as\'), crossorigin: tag.hasAttribute(\'crossorigin\')\n  })\n  if (verdict.effect === \'wasted\') console.warn(\'这条提示是废的\', tag.href)\n}\n\n// 3) 首屏预算门禁（CI 里跑 Lighthouse 之前先算一遍）\nconst budget = analyzeCriticalPath(criticalResources, 100 * 1024)\nif (budget.overBudget) console.warn(budget.suggestions)',
  hints: [
    '第 1 步：先按 origin 聚合成计数对象，别一开始就算连接数；http1 的连接数是 min(count, maxPerHost)，轮次是 ceil(count / maxPerHost)。',
    '第 2 步：URL 匹配用严格相等（href 带不带 query 是真实坑），origin 匹配用协议 + 主机名 + 端口三段；preload 先判 URL 再判 as。',
    '第 3 步：阻塞判定和字节统计放在同一个循环里省一次遍历，但别把 img 的字节也加进去——预算只算阻塞链上的。'
  ],
  concepts: [
    {
      title: '模拟器简化了什么',
      md: '一，没有真实的连接队列与时延模型，rounds 只是「按并发上限要几批」的静态估算，不体现慢请求把后续全堵住的队头阻塞时长。二，HTTP/2 只建模「一条连接、全部并发」，没有模拟 stream 优先级重排（依赖树、权重）与流控窗口。三，不计算 DNS 与 TLS 的耗时，preconnect 的收益只体现在 handshakes 归零上。四，资源提示只按 URL / as / crossorigin 三个条件判定，不涉及 Vary、缓存分区与优先级提升的实际调度。五，预算是纯字节加法，不折算解析与执行耗时。'
    },
    {
      title: '为什么现在很少提域名分片了',
      md: '域名分片的收益来自「每源 6 条连接」这个上限：拆 3 个子域就有 18 条并发。但它有成本——每个新域名一次 DNS、一次 TCP、一次 TLS，而 HTTP/2 下单个源一条连接就能并发任意多 stream，分片反而把可复用的连接切碎了，还破坏压缩与缓存收益。\n\n同理失效的还有：合并大包（h2 下按需加载更划算）、雪碧图（小图走多路复用更快）、内联 base64（破坏压缩、无法单独缓存）。这些老手法的共同前提都是「请求数昂贵」，而这个前提在 h2 下不成立了。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '先把连接数算成函数',
      think: '先把「一个页面开几条连接」从感觉变成函数：按 origin 聚合请求，再按协议决定每个源开几条、要排队几轮。这一步不涉及优先级，只把连接与轮次算准。',
      hint: 'http1 里每个源的连接数是 min(count, maxPerHost)，轮次是 ceil(count / maxPerHost) 取最大值；http2 每个源固定一条且轮次为 1。',
      code: L4CODE1,
      test: L4S1,
      diag: [
        '没有按 origin 聚合，把所有请求都当成同一个源，跨源场景连接数永远算成 1。',
        'http1 的连接数写成固定 maxPerHost，同源 3 个请求也报告 6 条连接。',
        '轮次没有取各源最大值，多源场景下被最后一个源覆盖。',
        'http2 仍然按 maxPerHost 算连接数，等于没建多路复用的模型。',
        '空数组时 rounds 变成 1 或 NaN，没走「没有请求就是 0」的边界。'
      ]
    },
    {
      n: 2,
      title: '资源提示到底命中没有',
      think: '一条 link 提示是否有效，取决于它想提前处理的东西和真实请求是否对得上。把判定拆成两个维度：URL 是否同一个资源，origin 是否同源（决定要不要 crossorigin），再按 rel 给出不同的 effect。',
      hint: 'preload 要 URL 与 as 都对；preconnect 和 dns-prefetch 只看 origin；不满足一律返回 wasted，别静默通过。',
      code: L4CODE2,
      test: L4S2,
      diag: [
        'preload 只比了 URL，没比 as，类型不一致的提示被算成命中。',
        '跨域 preload 没检查 crossorigin，字体被算成可复用，实际上会下两次。',
        'preconnect 被判成 fetch-early，等于宣称它下载了内容。',
        'originOf 只切到第一个冒号，把 https 的冒号当成主机名结尾。',
        '未知的 rel 返回 matched: true，拼错的 rel 被当成有效优化。'
      ]
    },
    {
      n: 3,
      title: '关键路径阻塞判定与字节预算',
      think: '最后一步回答「首屏为什么慢」：哪些资源在阻塞渲染、它们一共多少字节、超没超预算、该给什么建议。判定要覆盖三个真实细节：head 内同步脚本阻塞、defer 与 async 不阻塞、print 媒体查询的 CSS 不阻塞。',
      hint: '一个循环里同时收集 blocking 列表与字节和，顺手记下 hasCss / hasScript，最后按规则拼 suggestions。',
      code: L4CODE3,
      test: L4S3,
      diag: [
        '脚本一律判成阻塞，忘了 defer 与 async 不挡渲染。',
        '没判 inHead，body 末尾的同步脚本被算进关键路径。',
        'CSS 不看 media，print 样式表被当成阻塞资源。',
        '把 img 的字节也累加进关键字节，预算永远超标。',
        '超预算时无条件给三条建议，没判断到底是 CSS 还是脚本的问题。'
      ]
    }
  ],
  skeleton: `function simulateConnections(requests, options) {
  throw new Error('simulateConnections 还没实现')
}

function originOf(url) {
  throw new Error('originOf 还没实现')
}

function matchHint(resource, hint) {
  throw new Error('matchHint 还没实现')
}

function isRenderBlocking(resource) {
  throw new Error('isRenderBlocking 还没实现')
}

function analyzeCriticalPath(resources, budgetBytes) {
  throw new Error('analyzeCriticalPath 还没实现')
}`,
  solution: L4CODE3,
  finalCode: L4CODE3,
  tests: `${L4S1}\n${L4S2}\n${L4S3}`
}

export default {
  id: 'fe-network',
  version: 3,
  domain: 'fe',
  cumulative: false,
  title: '前端网络层：从 ES6+ 到传输与加载优化',
  emoji: '🌐',
  tagline: '4 关：ES6+ 语法工具、HTTP 缓存与跨域、WebSocket/SSE 与分片传输、连接复用与加载优先级。',
  stack: ['JavaScript', 'HTTP', 'CORS', 'WebSocket', 'SSE', '性能优化'],
  intro: '这个项目把「前端的网络层」拆成四段可以纯函数验证的硬骨头。第一关是语法底座：Proxy 陷阱与不变式、WeakMap 依赖表撑起的响应式、生成器惰性管道。第二关进 HTTP 应用层：报文解析与大小写不敏感的头、强缓存与协商缓存的分叉决策、CORS 预检与凭证互斥矩阵。第三关做实时与传输：WebSocket 帧的 opcode 与掩码、SSE 事件流的跨包拼接与断线续传、大文件分片上传与 Range 下载。第四关是优化：连接复用与多路复用、资源提示的命中判定、关键渲染路径的字节预算。每一关都是「先让朴素实现跑通，再让它在边界上崩一次」。',
  outcome: '你能手写一个不泄漏的响应式内核、一份说得清 304 从哪来的缓存决策函数、一个能解掩码帧的 WebSocket 解析器，以及一套能解释「为什么 h2 之后 sprite 就过时了」的连接模型。面试里被追问细节时，你能给出具体的不变式与边界条件，而不是概念名词。',
  levels: [LV1, LV2, LV3, LV4]
}