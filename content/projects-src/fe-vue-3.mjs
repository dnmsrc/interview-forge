/**
 * fe-vue-3 —— Vue3 三关：Setup Store 与路由体系、性能手段、生态与版本演进。
 * 分配见 data/plans/fe-vue-3.json；判题沙箱无 DOM / 无定时器，框架机制一律落成
 * 可运行的纯函数模型，时间与调度由调用方注入。
 */

/* ============================================================ 第 1 关测试 */
const L1S1 = `{
  check('初始 state 读得出来', () => {
    const store = createSetupStore(({ ref }) => ({ count: ref(0) }))
    same(store.count, 0)
  })
  check('写 store.count 会落到 ref 的 value 上', () => {
    const store = createSetupStore(({ ref }) => ({ count: ref(1) }))
    store.count = 7
    same(store.count, 7)
  })
  check('getter 没人读就不算，读过一次就缓存', () => {
    let calls = 0
    const store = createSetupStore(({ ref, computed }) => {
      const count = ref(2)
      const double = computed(() => { calls += 1; return count.value * 2 })
      return { count, double }
    })
    same(calls, 0, '创建 store 不等于计算 getter')
    same(store.double, 4)
    same(calls, 1)
    same(store.double, 4)
    same(calls, 1, '第二次读必须命中缓存')
  })
  check('state 变了 getter 才失效重算', () => {
    let calls = 0
    const store = createSetupStore(({ ref, computed }) => {
      const count = ref(1)
      const double = computed(() => { calls += 1; return count.value * 2 })
      return { count, double }
    })
    same(store.double, 2)
    store.count = 5
    same(store.double, 10)
    same(calls, 2, '一次写了 state，应该只重算一次')
  })
  check('action 的 this 指向 store，改 state 也会让 getter 失效', () => {
    const store = createSetupStore(({ ref, computed }) => {
      const count = ref(0)
      const double = computed(() => count.value * 2)
      function inc() { this.count += 1 }
      return { count, double, inc }
    })
    store.inc()
    same(store.count, 1)
    same(store.double, 2)
  })
}`

const L1S2 = `{
  check('$patch 传对象会合并进 state', () => {
    const store = createSetupStore(({ ref }) => ({ count: ref(0), name: ref('a') }))
    store.$patch({ count: 9 })
    same(store.count, 9)
    same(store.name, 'a', '没在 patch 里的字段不该被动')
  })
  check('$patch 传函数可以按旧值改写', () => {
    const store = createSetupStore(({ ref }) => ({ count: ref(1) }))
    store.$patch((s) => { s.count += 4 })
    same(store.count, 5)
  })
  check('$reset 把每个字段恢复成创建时的初始值', () => {
    const store = createSetupStore(({ ref }) => ({ count: ref(3), name: ref('x') }))
    store.$patch({ count: 100, name: 'y' })
    store.$reset()
    same(store.count, 3)
    same(store.name, 'x')
  })
  check('reset 之后 getter 也会失效重算', () => {
    let calls = 0
    const store = createSetupStore(({ ref, computed }) => {
      const count = ref(2)
      const double = computed(() => { calls += 1; return count.value * 2 })
      return { count, double }
    })
    same(store.double, 4)
    store.count = 10
    same(store.double, 20)
    store.$reset()
    same(store.double, 4)
    same(calls, 3)
  })
  check('patch 里不认识的键被忽略，不会凭空长出字段', () => {
    const store = createSetupStore(({ ref }) => ({ count: ref(0) }))
    store.$patch({ count: 1, ghost: 2 })
    same(store.count, 1)
    same(store.ghost, undefined)
    same(Object.keys(store).includes('ghost'), false)
  })
}`

const L1S3 = `{
  check('静态段优先于参数段，参数段优先于通配', () => {
    const routes = [
      { name: 'post', path: '/post/:id' },
      { name: 'about', path: '/about' },
      { name: 'fallback', path: '/*' }
    ]
    same(matchRoute(routes, '/about').name, 'about')
    same(matchRoute(routes, '/post/42').params.id, '42')
    same(matchRoute(routes, '/nope/deep').name, 'fallback')
  })
  check('动态加进来的路由立刻能匹配，删掉后不再命中', () => {
    const router = createRouter({ routes: [{ name: 'home', path: '/' }] })
    same(router.resolve('/dash'), null)
    router.addRoute({ name: 'dash', path: '/dash' })
    same(router.resolve('/dash').name, 'dash')
    router.removeRoute('dash')
    same(router.resolve('/dash'), null)
  })
  check('history / hash / memory 三种模式各自的 URL 形态', () => {
    const h = createHistory('history', '/app/')
    same(h.toUrl('/user/1'), '/app/user/1')
    same(h.fromUrl('/app/user/1'), '/user/1')
    const hash = createHistory('hash', '/')
    same(hash.toUrl('/user/1'), '#/user/1')
    same(hash.fromUrl('#/user/1'), '/user/1')
    const mem = createHistory('memory', '/')
    same(mem.toUrl('/user/1'), '')
  })
  check('守卫返回 false 中止导航，返回路径则重定向到新目标', () => {
    const blocked = runGuards([() => false], '/admin', '/')
    same(blocked.type, 'abort')
    const moved = runGuards([() => '/login'], '/admin', '/')
    same(moved.type, 'proceed')
    same(moved.path, '/login')
  })
  check('重定向超过 3 跳就判循环并中止，不会转圈', () => {
    const loop = runGuards([() => '/a', () => '/b', () => '/c', () => '/d'], '/a', '/')
    same(loop.type, 'abort')
    same(loop.reason, 'redirect-loop')
  })
}`

/* ============================================================ 第 1 关 */
const LV1 = {
  id: 'lv1',
  title: 'Setup Store 与路由体系：从零写一套 Pinia + Router',
  emoji: '🧭',
  xp: 40,
  goal: '实现 createSetupStore（ref 当 state、computed 当 getter、函数当 action，含 $patch / $reset）与 createRouter（静态/参数/通配匹配、动态路由、三种 history 模式、导航守卫）。',
  why: 'Pinia 的 setup store 和 Vue Router 的匹配/守卫是 Vue3 面试里最常被追问的两块：前者考「响应式对象解构为什么会丢响应性」「为什么没有 mutations」，后者考「路由优先级怎么排」「守卫返回 false 和 next(false) 是一回事吗」「history 模式刷新 404 到底怪谁」。把它们写成能跑的模型，边界就没法含糊。',
  nodes: [
    'fe.vue.state.setup-store',
    'fe.vue.router',
    'fe.vue.router.dynamic-routes',
    'fe.vue.router.history-mode',
    'fe.vue.router.navigation-guard'
  ],
  thinking: [
    {
      title: '先分清「响应式的单位」是 ref，不是 store 对象',
      md: 'setup store 的 state 本质是一堆 `ref`，store 只是把每个 ref 的 `.value` 代理到属性上：读 `store.count` 等价于读 `count.value`，写 `store.count = 3` 等价于 `count.value = 3`。\n\n这一步想清楚，后面两个常见坑就自动解释清楚了：为什么 `const { count } = store` 会丢响应性（拿到的是当时的数字，不是 ref），以及为什么 `$reset` 只能恢复 ref 的初值、恢复不了 action 里自己追加的字段。'
    },
    {
      title: 'getter 的缓存必须挂在「版本号」上，而不是挂在调用次数上',
      md: 'computed 的语义是「依赖没变就不重算」。这里不建完整依赖图，而是让每次写 state 都把 store 的版本号 +1，getter 缓存里记下自己上次算完的版本号，版本不一致就重算。\n\n简化点要说清：真实 Vue 是按 key 级依赖追踪（只有被读过的 key 变了才失效），这里退化为「任意 state 变化都失效」。它保住了「函数被调用几次」这个可断言的量，也保住了「缓存不能靠猜」这条纪律。'
    },
    {
      title: '路由匹配是排序问题：静态 > 参数 > 通配，段数多的优先',
      md: '`/about` 和 `/:id` 同时能匹配 `/about` 时，必须选静态的那条，否则「关于页」会被当成 id 为 about 的详情页。所以匹配不是「找到第一个就算」，而是给每条能匹配的路由算权重（静态段 4 分、参数段 2 分、通配 1 分），取最高分。\n\n动态路由（addRoute）改变的是候选集合，所以「加进去立刻能命中、删掉立刻不能命中」是同一个机制的两面——不要给匹配结果做缓存，除非你能保证失效。'
    }
  ],
  prereq: [
    {
      title: '闭包 + 属性描述符：store 的属性其实是 getter/setter',
      md: '把 ref 的 value 暴露成 store 的属性，最直接的做法是 `Object.defineProperty`：\n\n```js\nObject.defineProperty(store, key, {\n  get() { return r.value },\n  set(v) { r.value = v; version += 1 },\n  enumerable: true\n})\n```\n\n写的是同一个 value，但 setter 里能顺手把版本号 +1——这就是「改 state 触发 getter 失效」的落点。'
    },
    {
      title: 'history 模式为什么刷新会 404',
      md: '`history` 模式下 `/user/1` 是真实路径，刷新时浏览器向服务器要 `/user/1`，服务器如果没有 fallback 到 `index.html`，就会返回 404。`hash` 模式把路径放在 `#` 后面，服务器永远只看到 `/`，所以不需要配置。\n\n这不是框架的 bug，是「前端路由」和「服务器路由」两套语义在同一根 URL 上打架。本关的 `createHistory` 只负责 URL 形态的互相转换，fallback 配置属于部署侧。'
    }
  ],
  api: [
    {
      name: 'createSetupStore',
      sig: 'createSetupStore(setup: ({ ref, computed }) => Record<string, any>) => store',
      args: 'setup 是工厂函数，参数是注入的 ref / computed；返回值里的 ref 变成 state 字段、computed 变成 getter、函数变成 action。',
      returns: 'store 对象：state 可读可写，getter 惰性缓存，action 的 this 指向 store；另有 $patch(objectOrFn) 与 $reset()。',
      example: "const store = createSetupStore(({ ref, computed }) => {\n  const count = ref(0)\n  const double = computed(() => count.value * 2)\n  function inc() { this.count += 1 }\n  return { count, double, inc }\n})\nstore.inc()\nstore.double   // 2\nstore.$patch({ count: 10 })\nstore.$reset()  // count 回到 0"
    },
    {
      name: 'createRouter / matchRoute / createHistory / runGuards',
      sig: 'createRouter({ routes, mode, base }) => router；router.resolve(path) / addRoute(route) / removeRoute(name)',
      args: 'routes 是 { name, path } 数组，path 支持静态段、:param、* 通配；mode 是 history / hash / memory；base 是部署前缀。',
      returns: 'router.resolve 返回 { name, params, path } 或 null；createHistory(mode, base) 返回 { toUrl, fromUrl }；runGuards 返回 { type: proceed | abort, path?, reason? }。',
      example: "const router = createRouter({ routes: [{ name: 'about', path: '/about' }], mode: 'history', base: '/app' })\nrouter.resolve('/about').name   // 'about'\nrouter.history.toUrl('/about')  // '/app/about'\nrunGuards([() => false], '/admin', '/')  // { type: 'abort' }"
    }
  ],
  usage: "const store = createSetupStore(({ ref }) => ({ count: ref(0) }))\nstore.count += 1\nstore.$reset()\n\nconst router = createRouter({ routes: [{ name: 'home', path: '/' }], mode: 'hash' })\nrouter.addRoute({ name: 'user', path: '/user/:id' })\nrouter.resolve('/user/42').params.id   // '42'",
  hints: [
    '第 1 步：先把 ref 和 computed 写成普通对象（带标记字段），再用 Object.defineProperty 把 ref 铺到 store 上；computed 的缓存记「上次算完时的版本号」。',
    '第 2 步：$patch 传对象就逐 key 覆盖（不认识的 key 忽略），传函数就把 store 交进去；$reset 要提前存好每个 ref 的初值。',
    '第 3 步：匹配先给路由打分再取最高分；history 三种模式只在 URL 形态上有差别；守卫返回字符串就算重定向，用一个计数器拦住成环。'
  ],
  concepts: [
    {
      title: '为什么 Pinia 没有 mutations',
      md: 'Vuex 的 mutation 是为了让 devtools 拿到「同步、可追踪」的变更入口（异步的 action 里最终会调 mutation）。Pinia 不需要：它直接改 ref，响应式系统本身就知道哪个 key 变了，devtools 通过时间线订阅就能记录。于是「action 里直接 this.count++」合法，少一层样板。'
    }
  ],
  stages: [
    {
      n: 1,
      title: 'ref / computed 铺成 store 的 state 与 getter',
      think: '先只做「读得到、写得进、getter 缓存得住」这三件事。这一步刻意不实现 $patch / $reset，好让第 2 步的测试真的证明它缺东西。',
      hint: 'ref 返回带 __isRef 标记的 { value }；computed 返回带 __isComputed 标记的对象，读的时候比对版本号；store 用 defineProperty 逐字段铺。',
      code: `function createSetupStore(setup) {
  const reg = { version: 0, refs: [] }

  const ref = (value) => {
    const r = { __isRef: true, value, __reg: reg }
    reg.refs.push(r)
    return r
  }

  const computed = (getter) => {
    const c = { __isComputed: true, getter, __reg: reg, cacheVersion: -1, value: undefined }
    return c
  }

  const bag = setup({ ref, computed })
  const store = {}

  for (const key of Object.keys(bag)) {
    const val = bag[key]
    if (val && val.__isRef) {
      Object.defineProperty(store, key, {
        get() { return val.value },
        set(next) { val.value = next; reg.version += 1 },
        enumerable: true
      })
    } else if (val && val.__isComputed) {
      Object.defineProperty(store, key, {
        get() {
          if (val.cacheVersion !== reg.version) {
            val.value = val.getter()
            val.cacheVersion = reg.version
          }
          return val.value
        },
        enumerable: true
      })
    } else if (typeof val === 'function') {
      store[key] = (...args) => val.apply(store, args)
    } else {
      store[key] = val
    }
  }

  return store
}`,
      test: L1S1,
      diag: [
        'state 字段没铺到 store 上（漏了 defineProperty 或把 ref 对象直接挂了上去），读到的是对象不是数值。',
        'setter 里忘了 reg.version += 1，改了 state 但 getter 还是旧缓存。',
        'computed 在 get 里没比对 cacheVersion，导致每次读都重新计算。',
        'computed 第一次读时 cacheVersion 初始值没设对（比如设成 0 而版本号也是 0），命中了一个空的 value。',
        'action 用的是箭头函数或没 apply(store)，this 不是 store，this.count += 1 改不到 state。'
      ]
    },
    {
      n: 2,
      title: '补 $patch 与 $reset：批量改与回到初值',
      think: '批量改（$patch）和回到初值（$reset）是 Pinia 里最容易踩坑的两个 API：前者要求「未知键不能凭空长出来」，后者在 setup store 里必须手动记初值——因为 setup 函数只会跑一次，没有人替你保存快照。',
      hint: '创建 store 时顺手把每个 ref key 的初始 value 存一份；$patch 分对象与函数两种；$reset 逐 key 写回并让版本号失效。',
      code: `function createSetupStore(setup) {
  const reg = { version: 0, refs: [] }

  const ref = (value) => {
    const r = { __isRef: true, value, __reg: reg }
    reg.refs.push(r)
    return r
  }

  const computed = (getter) => {
    const c = { __isComputed: true, getter, __reg: reg, cacheVersion: -1, value: undefined }
    return c
  }

  const bag = setup({ ref, computed })
  const store = {}
  const stateEntries = []
  const initial = {}

  for (const key of Object.keys(bag)) {
    const val = bag[key]
    if (val && val.__isRef) {
      stateEntries.push({ key, r: val })
      initial[key] = val.value
      Object.defineProperty(store, key, {
        get() { return val.value },
        set(next) { val.value = next; reg.version += 1 },
        enumerable: true
      })
    } else if (val && val.__isComputed) {
      Object.defineProperty(store, key, {
        get() {
          if (val.cacheVersion !== reg.version) {
            val.value = val.getter()
            val.cacheVersion = reg.version
          }
          return val.value
        },
        enumerable: true
      })
    } else if (typeof val === 'function') {
      store[key] = (...args) => val.apply(store, args)
    } else {
      store[key] = val
    }
  }

  store.$patch = (arg) => {
    if (typeof arg === 'function') {
      arg(store)
      return
    }
    for (const key of Object.keys(arg || {})) {
      const entry = stateEntries.find((e) => e.key === key)
      if (entry) { entry.r.value = arg[key]; reg.version += 1 }
    }
  }

  store.$reset = () => {
    for (const entry of stateEntries) {
      entry.r.value = initial[entry.key]
    }
    reg.version += 1
  }

  return store
}`,
      test: L1S2,
      diag: [
        '$patch 直接把对象 assign 到 store 上，被 defineProperty 的只读或未知键行为挡住，state 没变。',
        '$patch 只在函数分支里处理，对象分支漏了（或把键名当成了 ref key 找不到）。',
        '$reset 没有初值快照，只能恢复成 undefined 或者把 patch 后的值当成初值。',
        '$reset 改完 ref 没有让版本号失效，getter 仍返回 patch 时的旧值。',
        '$patch 用 Object.assign(store, arg) 一类写法把未知键长到了 store 上，Object.keys 能查到。'
      ]
    },
    {
      n: 3,
      title: '路由匹配、动态路由、三种 history 与守卫',
      think: '路由这块最容易「看起来能跑但其实错」：匹配取第一个、动态路由改了不生效、守卫把重定向写成了中止。这里把三者拆成三个独立函数，用权重排序和候选集重算把语义钉死。',
      hint: '先给每条路由算权重（静态 4 / 参数 2 / 通配 1），匹配时收集所有命中的取最高分；addRoute 直接推进数组；守卫按顺序执行，字符串返回值即重定向，跳数上限 3。',
      code: `function routeWeight(route) {
  const segs = String(route.path).split('/').filter(Boolean)
  let score = 0
  for (const seg of segs) {
    if (seg === '*') score += 1
    else if (seg.charAt(0) === ':') score += 2
    else score += 4
  }
  return { score, segs: segs.length }
}

function matchRoute(routes, path) {
  const target = String(path).split('?')[0]
  const parts = target.split('/').filter(Boolean)
  let best = null

  for (const route of routes) {
    const segs = String(route.path).split('/').filter(Boolean)
    const params = {}
    let ok = true
    let wildcard = false

    for (let i = 0; i < segs.length; i += 1) {
      const seg = segs[i]
      if (seg === '*') { wildcard = true; break }
      if (i >= parts.length) { ok = false; break }
      if (seg.charAt(0) === ':') { params[seg.slice(1)] = parts[i]; continue }
      if (seg !== parts[i]) { ok = false; break }
    }

    if (!ok) continue
    if (!wildcard && segs.length !== parts.length) continue

    const w = routeWeight(route)
    if (!best || w.score > best.w.score || (w.score === best.w.score && w.segs > best.w.segs)) {
      best = { route, params, w }
    }
  }

  return best ? { name: best.route.name, params: best.params, path: target } : null
}

function createHistory(mode, base) {
  const prefix = String(base || '/').replace(/\\/$/, '')
  return {
    mode,
    base: prefix,
    toUrl(path) {
      if (mode === 'hash') return '#' + path
      if (mode === 'memory') return ''
      return prefix + path
    },
    fromUrl(url) {
      const text = String(url)
      if (mode === 'hash') {
        const at = text.indexOf('#')
        return at >= 0 ? (text.slice(at + 1) || '/') : '/'
      }
      if (mode === 'memory') return '/'
      if (prefix && text.indexOf(prefix) === 0) return text.slice(prefix.length) || '/'
      return text || '/'
    }
  }
}

function createRouter(options) {
  const routes = (options && options.routes ? options.routes : []).slice()
  const mode = (options && options.mode) || 'history'
  const base = (options && options.base) || '/'
  const history = createHistory(mode, base)

  return {
    routes,
    mode,
    base,
    history,
    resolve(path) { return matchRoute(routes, path) },
    addRoute(route) { routes.push(route); return routes.length },
    removeRoute(name) {
      const at = routes.findIndex((r) => r.name === name)
      if (at < 0) return false
      routes.splice(at, 1)
      return true
    }
  }
}

function runGuards(guards, to, from) {
  let target = to
  let hops = 0

  for (const guard of guards || []) {
    const result = guard(target, from)
    if (result === false) return { type: 'abort' }
    if (result === true || result === undefined) continue
    if (typeof result === 'string') {
      hops += 1
      if (hops > 3) return { type: 'abort', reason: 'redirect-loop' }
      target = result
      continue
    }
    return { type: 'abort', reason: 'invalid-guard-return' }
  }

  return { type: 'proceed', path: target }
}`,
      test: L1S3,
      diag: [
        '匹配取的是第一个命中的路由而不是最高权重，/about 被 /:id 抢走。',
        'addRoute 改的是副本或者返回了新数组，router.routes 没变，resolve 永远匹配不到。',
        'history 模式 toUrl 忘了拼 base，或者 hash 模式返回的是 /user/1 而不是 #/user/1。',
        '守卫返回字符串被当成中止处理（只判了 false），或者返回值没回到结果里。',
        '重定向没有跳数上限，两条互相重定向的守卫会无限循环（测试直接超时）。'
      ]
    }
  ],
  skeleton: `function createSetupStore(setup) {
  throw new Error('createSetupStore 还没实现')
}

function matchRoute(routes, path) {
  throw new Error('matchRoute 还没实现')
}

function createHistory(mode, base) {
  throw new Error('createHistory 还没实现')
}

function createRouter(options) {
  throw new Error('createRouter 还没实现')
}

function runGuards(guards, to, from) {
  throw new Error('runGuards 还没实现')
}`,
  solution: `function createSetupStore(setup) {
  const reg = { version: 0, refs: [] }

  const ref = (value) => {
    const r = { __isRef: true, value, __reg: reg }
    reg.refs.push(r)
    return r
  }

  const computed = (getter) => {
    const c = { __isComputed: true, getter, __reg: reg, cacheVersion: -1, value: undefined }
    return c
  }

  const bag = setup({ ref, computed })
  const store = {}
  const stateEntries = []
  const initial = {}

  for (const key of Object.keys(bag)) {
    const val = bag[key]
    if (val && val.__isRef) {
      stateEntries.push({ key, r: val })
      initial[key] = val.value
      Object.defineProperty(store, key, {
        get() { return val.value },
        set(next) { val.value = next; reg.version += 1 },
        enumerable: true
      })
    } else if (val && val.__isComputed) {
      Object.defineProperty(store, key, {
        get() {
          if (val.cacheVersion !== reg.version) {
            val.value = val.getter()
            val.cacheVersion = reg.version
          }
          return val.value
        },
        enumerable: true
      })
    } else if (typeof val === 'function') {
      store[key] = (...args) => val.apply(store, args)
    } else {
      store[key] = val
    }
  }

  store.$patch = (arg) => {
    if (typeof arg === 'function') {
      arg(store)
      return
    }
    for (const key of Object.keys(arg || {})) {
      const entry = stateEntries.find((e) => e.key === key)
      if (entry) { entry.r.value = arg[key]; reg.version += 1 }
    }
  }

  store.$reset = () => {
    for (const entry of stateEntries) {
      entry.r.value = initial[entry.key]
    }
    reg.version += 1
  }

  return store
}

function routeWeight(route) {
  const segs = String(route.path).split('/').filter(Boolean)
  let score = 0
  for (const seg of segs) {
    if (seg === '*') score += 1
    else if (seg.charAt(0) === ':') score += 2
    else score += 4
  }
  return { score, segs: segs.length }
}

function matchRoute(routes, path) {
  const target = String(path).split('?')[0]
  const parts = target.split('/').filter(Boolean)
  let best = null

  for (const route of routes) {
    const segs = String(route.path).split('/').filter(Boolean)
    const params = {}
    let ok = true
    let wildcard = false

    for (let i = 0; i < segs.length; i += 1) {
      const seg = segs[i]
      if (seg === '*') { wildcard = true; break }
      if (i >= parts.length) { ok = false; break }
      if (seg.charAt(0) === ':') { params[seg.slice(1)] = parts[i]; continue }
      if (seg !== parts[i]) { ok = false; break }
    }

    if (!ok) continue
    if (!wildcard && segs.length !== parts.length) continue

    const w = routeWeight(route)
    if (!best || w.score > best.w.score || (w.score === best.w.score && w.segs > best.w.segs)) {
      best = { route, params, w }
    }
  }

  return best ? { name: best.route.name, params: best.params, path: target } : null
}

function createHistory(mode, base) {
  const prefix = String(base || '/').replace(/\\/$/, '')
  return {
    mode,
    base: prefix,
    toUrl(path) {
      if (mode === 'hash') return '#' + path
      if (mode === 'memory') return ''
      return prefix + path
    },
    fromUrl(url) {
      const text = String(url)
      if (mode === 'hash') {
        const at = text.indexOf('#')
        return at >= 0 ? (text.slice(at + 1) || '/') : '/'
      }
      if (mode === 'memory') return '/'
      if (prefix && text.indexOf(prefix) === 0) return text.slice(prefix.length) || '/'
      return text || '/'
    }
  }
}

function createRouter(options) {
  const routes = (options && options.routes ? options.routes : []).slice()
  const mode = (options && options.mode) || 'history'
  const base = (options && options.base) || '/'
  const history = createHistory(mode, base)

  return {
    routes,
    mode,
    base,
    history,
    resolve(path) { return matchRoute(routes, path) },
    addRoute(route) { routes.push(route); return routes.length },
    removeRoute(name) {
      const at = routes.findIndex((r) => r.name === name)
      if (at < 0) return false
      routes.splice(at, 1)
      return true
    }
  }
}

function runGuards(guards, to, from) {
  let target = to
  let hops = 0

  for (const guard of guards || []) {
    const result = guard(target, from)
    if (result === false) return { type: 'abort' }
    if (result === true || result === undefined) continue
    if (typeof result === 'string') {
      hops += 1
      if (hops > 3) return { type: 'abort', reason: 'redirect-loop' }
      target = result
      continue
    }
    return { type: 'abort', reason: 'invalid-guard-return' }
  }

  return { type: 'proceed', path: target }
}`,
  finalCode: '',
  tests: `${L1S1}\n${L1S2}\n${L1S3}`
}

LV1.finalCode = LV1.solution

/* ============================================================ 第 2 关测试 */
const L2S1 = `{
  check('首屏窗口从 0 开始，可见区刚好 10 行', () => {
    const w = virtualWindow({ total: 1000, rowHeight: 30, viewportHeight: 300, scrollTop: 0 })
    same(w.start, 0)
    same(w.end, 10)
    same(w.offsetY, 0)
    same(w.totalHeight, 30000)
  })
  check('滚到 900 之后窗口跟着移动到第 30 行起', () => {
    const w = virtualWindow({ total: 1000, rowHeight: 30, viewportHeight: 300, scrollTop: 900 })
    same(w.start, 30)
    same(w.end, 40)
    same(w.offsetY, 900)
  })
  check('overscan 会在可见区上下各多渲染几行', () => {
    const w = virtualWindow({ total: 1000, rowHeight: 30, viewportHeight: 300, scrollTop: 900, overscan: 3 })
    same(w.start, 27)
    same(w.end, 43)
    same(w.offsetY, 810)
  })
  check('滚过头时 scrollTop 被夹到最后屏，end 不会超出总数', () => {
    const w = virtualWindow({ total: 20, rowHeight: 30, viewportHeight: 300, scrollTop: 10000 })
    same(w.start, 10)
    same(w.end, 20)
    same(w.totalHeight, 600)
  })
  check('空列表不产生负数区间', () => {
    const w = virtualWindow({ total: 0, rowHeight: 30, viewportHeight: 300, scrollTop: 0 })
    same(w.start, 0)
    same(w.end, 0)
    same(w.totalHeight, 0)
    same(w.offsetY, 0)
  })
}`

const L2S2 = `{
  check('尾部追加只创建、不移动', () => {
    const r = keyedDiff(['a', 'b'], ['a', 'b', 'c'])
    same(r.created, 1)
    same(r.removed, 0)
    same(r.moved, 0)
  })
  check('整体旋转一位：keyed 只需移动 1 个，index key 要动 3 个', () => {
    const k = keyedDiff(['a', 'b', 'c'], ['b', 'c', 'a'])
    same(k.moved, 1)
    const i = indexKeyDiff(['a', 'b', 'c'], ['b', 'c', 'a'])
    same(i.moved, 3, '按下标复用会把每一格都改写成别的内容')
  })
  check('中间删一个：keyed 0 移动，index key 有 2 格错位', () => {
    const k = keyedDiff(['a', 'b', 'c', 'd'], ['a', 'c', 'd'])
    same(k.created, 0)
    same(k.removed, 1)
    same(k.moved, 0)
    same(indexKeyDiff(['a', 'b', 'c', 'd'], ['a', 'c', 'd']).moved, 2)
  })
  check('头部插入：keyed 只创建 1 个，其余保持相对顺序', () => {
    const k = keyedDiff(['b', 'c'], ['a', 'b', 'c'])
    same(k.created, 1)
    same(k.removed, 0)
    same(k.moved, 0)
  })
  check('重复 key 直接抛错，不允许悄悄复用', () => {
    throws(() => keyedDiff(['a', 'a'], ['a']))
    throws(() => keyedDiff(['a'], ['a', 'a']))
  })
}`

const L2S3 = `{
  check('shallowState 顶层写入会让版本号前进', () => {
    const s = shallowState({ count: 0 })
    same(s.version, 0)
    s.set('count', 1)
    same(s.version, 1)
    same(s.get('count'), 1)
  })
  check('shallowState 里原地改嵌套对象不触发版本变化', () => {
    const s = shallowState({ user: { name: 'a' } })
    s.raw.user.name = 'b'
    same(s.version, 0, '浅响应只认第一层赋值')
    same(s.get('user').name, 'b')
  })
  check('createMemo 依赖数组不变就不重算，变了才重算', () => {
    let runs = 0
    let deps = [1, 2]
    const m = createMemo(() => { runs += 1; return deps[0] + deps[1] }, () => deps)
    same(m.get(), 3)
    same(m.runs, 1)
    same(m.get(), 3)
    same(m.runs, 1, '依赖相同必须命中缓存')
    deps = [2, 3]
    same(m.get(), 5)
    same(m.runs, 2)
  })
  check('effectScope 的 stop 会执行全部清理且只执行一次，停止后不能再加', () => {
    const scope = createScope()
    const calls = []
    scope.add(() => calls.push('a'))
    scope.add(() => calls.push('b'))
    same(scope.stop(), true)
    same(calls, ['b', 'a'])
    same(scope.stop(), false, '重复 stop 不该再执行清理')
    throws(() => scope.add(() => {}))
  })
  check('诊断：精确依赖的组件重渲染，宽依赖的组件被标成浪费', () => {
    const r = diagnoseGranularity([
      { name: 'AgeCell', deps: ['user.age'] },
      { name: 'UserCard', deps: ['user'] },
      { name: 'Counter', deps: ['count'] }
    ], 'user.age')
    same(r.rerendered, ['AgeCell', 'UserCard'])
    same(r.wasted, ['UserCard'])
  })
}`

/* ============================================================ 第 2 关 */
const LV2 = {
  id: 'lv2',
  title: '性能手段：虚拟列表、DOM 复用与更新粒度',
  emoji: '⚡',
  xp: 50,
  goal: '实现 virtualWindow（可视窗口与偏移）、keyedDiff / indexKeyDiff（复用与移动代价）、以及 shallowState / createMemo / createScope / diagnoseGranularity（粒度工具与诊断）。',
  why: '「Vue3 性能好」不是结论而是四个动作：少渲染（虚拟列表）、少移动（keyed diff）、少触发（shallow/粒度工具）、少重算（memo/缓存）。面试里通常问「一万条数据怎么办」「列表加了 key 为什么还卡」——答不出「移动次数由最长递增子序列决定」这个量，就还是在背结论。',
  nodes: [
    'fe.vue.perf',
    'fe.vue.perf.dom-reuse',
    'fe.vue.perf.granularity-tools',
    'fe.vue.perf.virtual-list'
  ],
  thinking: [
    {
      title: '虚拟列表的难点是「夹边界」，不是「算下标」',
      md: '窗口公式只有三步：由 scrollTop 得到首个可见行、由 scrollTop + viewport 得到末行、按 overscan 外扩。真正容易错的是两端：滚到顶部时 start 不能是负数，滚到底部时 end 不能超过总数，而 scrollTop 本身还要先夹到 `[0, totalHeight - viewportHeight]`。\n\n把 clamp 写进函数内部（而不是让调用方保证），测试才有东西可断言——第 4 条检查就是「传一个荒谬的 scrollTop，结果必须仍然合法」。'
    },
    {
      title: 'keyed diff 的「移动次数」= 保留元素的逆序对数的最小覆盖',
      md: '前后缀裁剪之后，剩下的保留元素里，只要相对顺序没变就不用动；需要动的是「不在最长递增子序列里」的那些。所以 moved = 保留数 - LIS 长度。反转三个元素时保留 3 个、LIS 只有 1 个，于是移动 2 个。\n\n对照 index key：按下标复用意味着第 i 格的 DOM 永远不动，但内容全错位，所以「移动」退化成「改写」，数量是位置内容不一致的格数（3 个）。这正好解释了「加了 key 反而更流畅」：key 让 DOM 跟着数据走，数据移动才真的移动。'
    }
  ],
  prereq: [
    {
      title: '浅响应与依赖粒度：只有被读过的属性才算依赖',
      md: '`shallowRef` / `shallowReactive` 只让第一层变化触发更新，嵌套对象原地改不会通知——这既是性能手段也是常见 bug 来源。\n\n粒度工具的取舍很清楚：\n\n```js\nconst big = shallowRef({ list: [] })\nbig.value = { list: nextList }   // 整体替换 → 触发\nbig.value.list.push(x)           // 原地改 → 不触发（除非你手动 triggerRef）\n```\n\n诊断的目的就是找出「用宽依赖（整个 user 对象）却只关心一个字段」的组件：它会在任何字段变化时重渲染。'
    }
  ],
  api: [
    {
      name: 'virtualWindow',
      sig: 'virtualWindow({ total, rowHeight, viewportHeight, scrollTop, overscan }) => { start, end, offsetY, totalHeight }',
      args: 'total 总行数；rowHeight 固定行高；viewportHeight 可视区高度；scrollTop 当前滚动位置；overscan 上下多渲染的行数。',
      returns: 'start/end 是左闭右开的行区间；offsetY 是该区间相对列表顶部的像素偏移；totalHeight 是整表高度（撑出滚动条）。',
      example: "virtualWindow({ total: 1000, rowHeight: 30, viewportHeight: 300, scrollTop: 900, overscan: 3 })\n// { start: 27, end: 43, offsetY: 810, totalHeight: 30000 }"
    },
    {
      name: 'keyedDiff / indexKeyDiff',
      sig: 'keyedDiff(prevKeys, nextKeys) => { created, removed, moved }；indexKeyDiff 同形',
      args: '两个 key 数组，按列表顺序；keyedDiff 要求各自内部不重复，重复直接抛错。',
      returns: 'created/removed 是新增与删除的数量；moved 对 keyedDiff 是「不在 LIS 里的保留元素数」，对 indexKeyDiff 是「同一下标内容变了」的格数。',
      example: "keyedDiff(['a', 'b', 'c'], ['c', 'b', 'a'])   // { created: 0, removed: 0, moved: 2 }\nindexKeyDiff(['a', 'b', 'c'], ['c', 'b', 'a'])  // { created: 0, removed: 0, moved: 3 }"
    }
  ],
  usage: "const w = virtualWindow({ total: rows.length, rowHeight: 32, viewportHeight: 480, scrollTop, overscan: 4 })\nconst visible = rows.slice(w.start, w.end)\n\nconst { moved } = keyedDiff(oldKeys, newKeys)\nif (moved > 8) console.log('这次排序代价很高，考虑分页或限制列数')",
  hints: [
    '第 1 步：先算 totalHeight，再把 scrollTop 夹到 [0, totalHeight - viewportHeight]，然后 floor / ceil 出首末行，最后按 overscan 外扩并再夹一次 [0, total]。',
    '第 2 步：keyedDiff 先做集合差得到 created/removed，再把保留元素在旧数组里的下标序列求最长递增子序列，moved = 保留数 - LIS 长度；indexKeyDiff 就逐位比内容。',
    '第 3 步：shallowState 只在 set 里加版本；createMemo 记住上次依赖数组用 Object.is 逐项比；createScope 用栈存清理，stop 时倒序执行并置 active=false。'
  ],
  concepts: [
    {
      title: '为什么 overscan 不能省，也不能太大',
      md: '滚动是离散事件，窗口跳动时如果只渲染「恰好可见」的行，快速滚动会出现空白（浏览器滚动事件有节流，DOM 还没更新）。overscan 就是缓冲区：上下各多渲染几行，让滚动时已有内容可显示。\n\n代价是渲染量与命中率：overscan 4 行意味着多 8 个行组件，配合复杂的行内容（图表、图片）会明显变贵。生产里通常 2~5 行，并按 `scrollTop` 变化的方向做非对称外扩。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '可视窗口：把 scrollTop 映射成行区间',
      think: '先把「滚到哪、渲染哪几行、整表多高」算对吧。这一步不做 diff 与粒度工具，所以第 2 步的测试会直接证明这些函数还不存在。',
      hint: 'totalHeight = total * rowHeight；maxScroll = max(0, totalHeight - viewportHeight)；scrollTop 先夹；start = floor(scrollTop / rowHeight) - overscan，end = ceil((scrollTop + viewportHeight) / rowHeight) + overscan，两端再夹一次。',
      code: `function virtualWindow(options) {
  const total = Math.max(0, Math.floor(options.total || 0))
  const rowHeight = options.rowHeight > 0 ? options.rowHeight : 1
  const viewportHeight = Math.max(0, options.viewportHeight || 0)
  const overscan = Math.max(0, Math.floor(options.overscan || 0))

  const totalHeight = total * rowHeight
  const maxScroll = Math.max(0, totalHeight - viewportHeight)
  const scrollTop = Math.min(Math.max(0, options.scrollTop || 0), maxScroll)

  const first = Math.floor(scrollTop / rowHeight)
  const last = Math.ceil((scrollTop + viewportHeight) / rowHeight)
  const start = Math.max(0, first - overscan)
  const end = Math.min(total, last + overscan)

  return { start, end, offsetY: start * rowHeight, totalHeight }
}`,
      test: L2S1,
      diag: [
        'totalHeight 算成了 total * (rowHeight + 间隙) 或者忘了乘 rowHeight，整表高度对不上撑不出滚动条。',
        'scrollTop 没夹到 maxScroll，翻页式滚动后窗口整体偏移。',
        'start 忘了减 overscan，或者减完没夹 0，顶部出现负下标。',
        'end 忘了加 overscan 或没夹 total，底部越界；也可能用了 floor 导致最后一屏少一行。',
        'total = 0 时没处理，end 算成正数或 offsetY 变 NaN。'
      ]
    },
    {
      n: 2,
      title: 'DOM 复用代价：keyed 与 index key 的移动计数',
      think: '列表卡不卡，取决于「有多少个 DOM 需要移动」。这一步把代价变成可断言的数字：keyed 用最长递增子序列算最小移动数，index key 逐位比内容。两者差的不是常数，而是量级。',
      hint: '先集合差算 created/removed；保留元素按新顺序取旧下标序列，LIS 之外的就是要移动的；LIS 用最朴素的 O(n^2) 动态规划就够（数据量小，判题超时 4 秒）。',
      code: `function virtualWindow(options) {
  const total = Math.max(0, Math.floor(options.total || 0))
  const rowHeight = options.rowHeight > 0 ? options.rowHeight : 1
  const viewportHeight = Math.max(0, options.viewportHeight || 0)
  const overscan = Math.max(0, Math.floor(options.overscan || 0))

  const totalHeight = total * rowHeight
  const maxScroll = Math.max(0, totalHeight - viewportHeight)
  const scrollTop = Math.min(Math.max(0, options.scrollTop || 0), maxScroll)

  const first = Math.floor(scrollTop / rowHeight)
  const last = Math.ceil((scrollTop + viewportHeight) / rowHeight)
  const start = Math.max(0, first - overscan)
  const end = Math.min(total, last + overscan)

  return { start, end, offsetY: start * rowHeight, totalHeight }
}

function lisLength(seq) {
  const dp = new Array(seq.length).fill(1)
  let best = 0
  for (let i = 0; i < seq.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      if (seq[j] < seq[i] && dp[j] + 1 > dp[i]) dp[i] = dp[j] + 1
    }
    if (dp[i] > best) best = dp[i]
  }
  return best
}

function keyedDiff(prevKeys, nextKeys) {
  const prev = (prevKeys || []).map(String)
  const next = (nextKeys || []).map(String)
  const prevSet = new Set(prev)
  const nextSet = new Set(next)

  if (prevSet.size !== prev.length) throw new Error('prev 里有重复 key')
  if (nextSet.size !== next.length) throw new Error('next 里有重复 key')

  const created = next.filter((k) => !prevSet.has(k)).length
  const removed = prev.filter((k) => !nextSet.has(k)).length

  const at = new Map()
  prev.forEach((k, i) => at.set(k, i))
  const keptSeq = next.filter((k) => prevSet.has(k)).map((k) => at.get(k))

  return { created, removed, moved: keptSeq.length - lisLength(keptSeq) }
}

function indexKeyDiff(prevKeys, nextKeys) {
  const prev = prevKeys || []
  const next = nextKeys || []
  const created = Math.max(0, next.length - prev.length)
  const removed = Math.max(0, prev.length - next.length)
  const common = Math.min(prev.length, next.length)
  let moved = 0
  for (let i = 0; i < common; i += 1) {
    if (prev[i] !== next[i]) moved += 1
  }
  return { created, removed, moved }
}`,
      test: L2S2,
      diag: [
        'keyedDiff 把 created 算成了 next.length 或漏了集合差，追加时多算。',
        'moved 直接用了保留元素数而没减 LIS 长度，反转场景数出来是 3。',
        'LIS 用错（比如求成了最长递减），移动数偏大或偏小。',
        'indexKeyDiff 只比较了集合差异，没逐位比内容，错位场景返回 0。',
        '重复 key 没抛错，Set 静默去重导致数量算错。'
      ]
    },
    {
      n: 3,
      title: '粒度工具与诊断：少触发、少重算',
      think: '最后一步是「让不该更新的组件别更新」：浅状态控制触发面、memo 控制重算、scope 控制副作用生命周期，再用依赖图诊断出宽依赖组件。三者都是同一个思路——把「什么变了」缩小到「谁真的用了它」。',
      hint: 'shallowState 只在 set 里加版本，raw 暴露给调用方原地改；createMemo 记住上次 deps 数组，Object.is 逐项比；createScope 用栈存清理，stop 时倒序 pop 执行；diagnoseGranularity 里用前缀匹配识别宽依赖。',
      code: `function virtualWindow(options) {
  const total = Math.max(0, Math.floor(options.total || 0))
  const rowHeight = options.rowHeight > 0 ? options.rowHeight : 1
  const viewportHeight = Math.max(0, options.viewportHeight || 0)
  const overscan = Math.max(0, Math.floor(options.overscan || 0))

  const totalHeight = total * rowHeight
  const maxScroll = Math.max(0, totalHeight - viewportHeight)
  const scrollTop = Math.min(Math.max(0, options.scrollTop || 0), maxScroll)

  const first = Math.floor(scrollTop / rowHeight)
  const last = Math.ceil((scrollTop + viewportHeight) / rowHeight)
  const start = Math.max(0, first - overscan)
  const end = Math.min(total, last + overscan)

  return { start, end, offsetY: start * rowHeight, totalHeight }
}

function lisLength(seq) {
  const dp = new Array(seq.length).fill(1)
  let best = 0
  for (let i = 0; i < seq.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      if (seq[j] < seq[i] && dp[j] + 1 > dp[i]) dp[i] = dp[j] + 1
    }
    if (dp[i] > best) best = dp[i]
  }
  return best
}

function keyedDiff(prevKeys, nextKeys) {
  const prev = (prevKeys || []).map(String)
  const next = (nextKeys || []).map(String)
  const prevSet = new Set(prev)
  const nextSet = new Set(next)

  if (prevSet.size !== prev.length) throw new Error('prev 里有重复 key')
  if (nextSet.size !== next.length) throw new Error('next 里有重复 key')

  const created = next.filter((k) => !prevSet.has(k)).length
  const removed = prev.filter((k) => !nextSet.has(k)).length

  const at = new Map()
  prev.forEach((k, i) => at.set(k, i))
  const keptSeq = next.filter((k) => prevSet.has(k)).map((k) => at.get(k))

  return { created, removed, moved: keptSeq.length - lisLength(keptSeq) }
}

function indexKeyDiff(prevKeys, nextKeys) {
  const prev = prevKeys || []
  const next = nextKeys || []
  const created = Math.max(0, next.length - prev.length)
  const removed = Math.max(0, prev.length - next.length)
  const common = Math.min(prev.length, next.length)
  let moved = 0
  for (let i = 0; i < common; i += 1) {
    if (prev[i] !== next[i]) moved += 1
  }
  return { created, removed, moved }
}

function shallowState(init) {
  const raw = {}
  let version = 0
  for (const key of Object.keys(init || {})) raw[key] = init[key]

  return {
    raw,
    get(key) { return raw[key] },
    set(key, value) { raw[key] = value; version += 1 },
    get version() { return version }
  }
}

function sameDeps(a, b) {
  if (!a || !b) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (!Object.is(a[i], b[i])) return false
  }
  return true
}

function createMemo(fn, depsFn) {
  let cached = undefined
  let lastDeps = null
  let runs = 0

  return {
    get() {
      const deps = depsFn()
      if (lastDeps && sameDeps(lastDeps, deps)) return cached
      lastDeps = deps
      cached = fn()
      runs += 1
      return cached
    },
    get runs() { return runs }
  }
}

function createScope() {
  let active = true
  const disposers = []

  return {
    add(fn) {
      if (!active) throw new Error('scope 已停止，不能再注册清理函数')
      disposers.push(fn)
    },
    stop() {
      if (!active) return false
      active = false
      while (disposers.length) {
        const fn = disposers.pop()
        fn()
      }
      return true
    },
    get active() { return active }
  }
}

function diagnoseGranularity(components, changedKey) {
  const rerendered = []
  const wasted = []

  for (const comp of components || []) {
    const deps = comp.deps || []
    if (deps.indexOf(changedKey) >= 0) {
      rerendered.push(comp.name)
      continue
    }
    const coarse = deps.some((dep) => dep !== changedKey && changedKey.indexOf(dep + '.') === 0)
    if (coarse) {
      rerendered.push(comp.name)
      wasted.push(comp.name)
    }
  }

  return { rerendered, wasted }
}`,
      test: L2S3,
      diag: [
        'shallowState 的 set 没加版本号，或者版本号是闭包外的共享变量。',
        'shallowState 对外暴露的是深拷贝，原地改 raw 不影响内部数据，读到的还是旧值。',
        'createMemo 每次 get 都重算（没存 lastDeps），或者比较用了 JSON.stringify 导致引用比较失效。',
        'createScope 的 stop 用 forEach 正序执行，或没有 active 标记导致重复 stop 又跑一遍清理。',
        'diagnoseGranularity 没有前缀匹配逻辑，宽依赖组件没被识别成 wasted。'
      ]
    }
  ],
  skeleton: `function virtualWindow(options) {
  throw new Error('virtualWindow 还没实现')
}

function keyedDiff(prevKeys, nextKeys) {
  throw new Error('keyedDiff 还没实现')
}

function indexKeyDiff(prevKeys, nextKeys) {
  throw new Error('indexKeyDiff 还没实现')
}

function shallowState(init) {
  throw new Error('shallowState 还没实现')
}

function createMemo(fn, depsFn) {
  throw new Error('createMemo 还没实现')
}

function createScope() {
  throw new Error('createScope 还没实现')
}

function diagnoseGranularity(components, changedKey) {
  throw new Error('diagnoseGranularity 还没实现')
}`,
  solution: '',
  finalCode: '',
  tests: `${L2S1}\n${L2S2}\n${L2S3}`
}

LV2.solution = LV2.stages[2].code
LV2.finalCode = LV2.solution

/* ============================================================ 第 3 关测试 */
const L3S1 = `{
  check('signal 可读可写，写同值不算变化', () => {
    const g = createGraph()
    const a = g.signal(1)
    same(g.read(a), 1)
    same(g.set(a, 1), false, '同值写入不该触发更新')
    same(g.set(a, 2), true)
    same(g.read(a), 2)
  })
  check('effect 立即执行一次，依赖变化后再执行并读到新值', () => {
    const g = createGraph()
    const a = g.signal(1)
    const seen = []
    g.effect(() => { seen.push(g.read(a)) })
    same(seen, [1], 'effect 要立刻跑一次')
    g.set(a, 5)
    same(seen, [1, 5])
  })
  check('computed 不读不算，读过就缓存', () => {
    const g = createGraph()
    const a = g.signal(2)
    let runs = 0
    const double = g.computed(() => { runs += 1; return g.read(a) * 2 })
    same(runs, 0, '创建 computed 不等于求值')
    same(g.read(double), 4)
    same(runs, 1)
    same(g.read(double), 4)
    same(runs, 1, '依赖没变不该重算')
  })
  check('链式 computed：改源头后读末端拿到新值', () => {
    const g = createGraph()
    const a = g.signal(1)
    const b = g.computed(() => g.read(a) + 1)
    const c = g.computed(() => g.read(b) * 10)
    same(g.read(c), 20)
    g.set(a, 4)
    same(g.read(c), 50)
  })
  check('effect 只依赖它真正读过的信号', () => {
    const g = createGraph()
    const a = g.signal(0)
    const b = g.signal(0)
    let runs = 0
    g.effect(() => { runs += 1; g.read(a) })
    same(runs, 1)
    g.set(b, 9)
    same(runs, 1, '没读过 b，就不该被 b 唤醒')
    g.set(a, 9)
    same(runs, 2)
  })
}`

const L3S2 = `{
  check('batch 里连续两次 set 只让 effect 跑一次', () => {
    const g = createGraph()
    const a = g.signal(0)
    const b = g.signal(0)
    let runs = 0
    g.effect(() => { runs += 1; g.read(a); g.read(b) })
    g.batch(() => { g.set(a, 1); g.set(b, 1) })
    same(runs, 2, '初始 1 次 + batch 合并后 1 次')
  })
  check('不在 batch 里就一次 set 一次执行', () => {
    const g = createGraph()
    const a = g.signal(0)
    let runs = 0
    g.effect(() => { runs += 1; g.read(a) })
    g.set(a, 1)
    g.set(a, 2)
    same(runs, 3)
  })
  check('嵌套 batch 仍然只在最外层结束后刷一次', () => {
    const g = createGraph()
    const a = g.signal(0)
    let runs = 0
    g.effect(() => { runs += 1; g.read(a) })
    g.batch(() => {
      g.set(a, 1)
      g.batch(() => { g.set(a, 2) })
    })
    same(runs, 2)
  })
  check('untrack 里的读取不计入依赖', () => {
    const g = createGraph()
    const a = g.signal(0)
    const b = g.signal(0)
    let runs = 0
    g.effect(() => { runs += 1; g.read(a); g.untrack(() => g.read(b)) })
    g.set(b, 7)
    same(runs, 1, 'b 的读取被 untrack 掉，不该触发')
    g.set(a, 7)
    same(runs, 2)
  })
  check('stop 之后 effect 不再执行，重复 stop 返回 false', () => {
    const g = createGraph()
    const a = g.signal(0)
    let runs = 0
    const handle = g.effect(() => { runs += 1; g.read(a) })
    same(handle.stop(), true)
    g.set(a, 1)
    same(runs, 1)
    same(handle.stop(), false)
  })
}`

const L3S3 = `{
  check('能力表按版本给结论，未知版本直接抛错', () => {
    same(vueFeatures('2.7').composition, true)
    same(vueFeatures('2.7').teleport, false)
    same(vueFeatures('3.0').teleport, true)
    throws(() => vueFeatures('1.0'))
  })
  check('从 2.7 迁到 3.0 还用 filters：中等风险且点名 blocker', () => {
    const r = migrationRisk({ from: '2.7', to: '3.0', uses: ['filters'] })
    same(r.level, 'medium')
    same(r.blockers, ['filters-removed'])
  })
  check('目标版本给不了的能力各算一个 blocker，两个以上就是高风险', () => {
    const r = migrationRisk({ from: '3.2', to: '3.2', uses: ['vapor', 'defineModel'] })
    same(r.level, 'high')
    same(r.blockers, ['vapor-requires-3.5', 'defineModel-requires-3.4'])
  })
  check('加权评分：权重乘分值再相加，Vue 胜出', () => {
    const r = scoreFramework([
      { weight: 3, vue: 5, react: 3 },
      { weight: 1, vue: 2, react: 4 }
    ])
    same(r.vue, 17)
    same(r.react, 13)
    same(r.winner, 'vue')
  })
  check('分值打平时老实返回 tie，不硬选一个', () => {
    const r = scoreFramework([{ weight: 1, vue: 3, react: 3 }])
    same(r.winner, 'tie')
  })
}`

/* ============================================================ 第 3 关 */
const LV3 = {
  id: 'lv3',
  title: '生态与演进：signals、版本矩阵与框架对照',
  emoji: '🌱',
  xp: 60,
  goal: '实现 createGraph（signal / computed / effect / batch / untrack 的依赖图）、vueFeatures / migrationRisk（版本能力矩阵与迁移阻断项）、scoreFramework（加权选型并如实处理平局）。',
  why: 'Vapor mode 之所以快，是把「渲染后比 vdom」换成「依赖变了直接改 DOM」；这背后的信号图并不神秘，就是一个带订阅关系的小图。而版本矩阵与迁移风险是团队做升级决策时真正要拿出来的东西——面试里问「升 Vue3 难在哪」，能把 filters、eventBus、defineModel 的版本门槛说清的人，比背「性能更好」的人值钱。',
  nodes: [
    'fe.vue.ecosystem',
    'fe.vue.ecosystem.vapor-signals',
    'fe.vue.ecosystem.vue-versions',
    'fe.vue.ecosystem.vue-vs-react'
  ],
  thinking: [
    {
      title: 'signal 图的关键是「订阅关系跟着求值走」',
      md: 'computed 的依赖不是静态声明的，而是「上一次求值时读过谁」。所以每次重算前必须先把自己从旧依赖的订阅表里摘掉，否则旧依赖变化还会把你标脏——这就是所谓「幽灵依赖」。\n\neffect 同理：重跑前清理旧依赖、重跑时重新登记。理解了这一点，`v-if` 分支切换导致依赖集合变化的行为就不是玄学，而是清理加重新收集。'
    },
    {
      title: 'batch 的语义是「延后通知」，不是「少改数据」',
      md: 'batch 里两次 set 数据是真的改了两次，只有通知被推迟到最外层结束：所有受影响的 effect 进队列去重，最后一次性跑。所以 batch 内读 state 能读到中间值，但渲染只发生一次。\n\n嵌套 batch 靠一个深度计数解决：只要还有一层没退出，就不 flush。这也是 Vue 调度器 `queueJob` + `flushJobs` 的雏形。'
    }
  ],
  prereq: [
    {
      title: '依赖收集的三件套：active 观察者、deps 集合、subs 反向索引',
      md: '一个最小的响应式图只需要三种结构：\n\n```js\nlet active = null                  // 当前正在求值的观察者\nnode.deps = new Set()              // 我依赖了谁\nnode.subs = new Set()              // 谁依赖了我\n```\n\n读取时把 active 记到 node.subs 并把 node 记进 active.deps；写入时顺着 subs 找出所有 effect。清理动作就是反向删除——没有反向索引就没法清理，这是设计时必须先定死的。'
    }
  ],
  api: [
    {
      name: 'createGraph',
      sig: 'createGraph() => { signal(v), computed(fn), effect(fn), read(node), set(node, v), batch(fn), untrack(fn) }',
      args: 'signal/computed 建节点；read 求值并登记依赖；set 写值并通知；batch 合并通知；untrack 内的读取不登记依赖。',
      returns: 'effect 返回 { stop() }；set 返回是否真的变化（同值返回 false）；read 返回当前值。',
      example: "const g = createGraph()\nconst a = g.signal(1)\nconst b = g.computed(() => g.read(a) * 2)\ng.effect(() => console.log(g.read(b)))\ng.set(a, 3)      // 打出 6\n"
    },
    {
      name: 'vueFeatures / migrationRisk / scoreFramework',
      sig: 'vueFeatures(version) => 能力表；migrationRisk({ from, to, uses }) => { level, blockers }；scoreFramework(items) => { vue, react, winner }',
      args: 'version 取 2.7 / 3.0 / 3.2 / 3.4 / 3.5；uses 是项目里用到的 API 名；items 每项是 { weight, vue, react } 分值。',
      returns: 'migrationRisk 的 level 取 low / medium / high，blockers 是字符串数组；scoreFramework 的 winner 取 vue / react / tie。',
      example: "migrationRisk({ from: '2.7', to: '3.0', uses: ['filters'] })\n// { level: 'medium', blockers: ['filters-removed'] }\nscoreFramework([{ weight: 3, vue: 5, react: 3 }])   // winner: 'vue'"
    }
  ],
  usage: "const g = createGraph()\nconst rows = g.signal([])\nconst count = g.computed(() => g.read(rows).length)\ng.effect(() => render(g.read(count)))\ng.batch(() => {\n  g.set(rows, nextRows)\n})",
  hints: [
    '第 1 步：先写 track（把 active 登记进 node.subs）、runEffect（重跑前清旧依赖）、read（computed 脏了先重算再登记），最后 set 顺着 subs 找 effect。',
    '第 2 步：batch 用深度计数 + 队列去重，flush 只在深度归零时执行；untrack 就是临时把 active 置空再恢复；stop 要同时清掉自己的订阅。',
    '第 3 步：能力表就是一个常量字典，未知版本抛错；migrationRisk 分「3.x 移除的 API」与「有最低版本门槛的 API」两类规则；评分逐项乘权重相加，相等就 tie。'
  ],
  concepts: [
    {
      title: 'Vapor 与 vdom 的更新量差在哪',
      md: 'vdom 每次更新要重新执行 render 函数得到新树，再与旧树 diff 出 patch。Vapor 编译后直接生成「哪个 signal 变了就改哪个 DOM 节点」的绑定，没有虚拟树、没有 diff、没有组件级重渲染。\n\n代价是灵活性的收缩：动态结构（比如运行时拼 children）需要显式 API 参与。所以它不是「更快的 vdom」，而是「编译期把动态点标出来后不再需要运行时比对」。本关的 signal 图就是这套机制的骨架。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '依赖图：信号、计算与副作用',
      think: '先把最小闭环跑通：读时登记依赖、写时通知、computed 懒算并缓存。这一步不做 batch / untrack / stop，第 2 步的测试正好证明它们还没到位。',
      hint: 'track 里把 active 加进 node.subs；computed 重算前把自己从旧依赖里摘掉；set 时顺着 subs 递归找 effect 并逐个重跑。',
      code: `function createGraph() {
  let active = null

  function track(node) {
    if (!active) return
    active.deps.add(node)
    node.subs.add(active)
  }

  function gather(node, out) {
    for (const sub of Array.from(node.subs)) {
      if (sub.kind === 'effect') out.add(sub)
      else if (sub.kind === 'computed' && !sub.dirty) {
        sub.dirty = true
        gather(sub, out)
      }
    }
  }

  function runEffect(node) {
    for (const dep of node.deps) dep.subs.delete(node)
    node.deps.clear()
    const prev = active
    active = node
    try { node.fn() } finally { active = prev }
  }

  function signal(initial) {
    return { kind: 'signal', value: initial, deps: new Set(), subs: new Set() }
  }

  function computed(fn) {
    return { kind: 'computed', fn, value: undefined, dirty: true, deps: new Set(), subs: new Set() }
  }

  function read(node) {
    if (!node || !node.kind) throw new Error('read 只能读 signal / computed')
    if (node.kind === 'computed' && node.dirty) {
      for (const dep of node.deps) dep.subs.delete(node)
      node.deps.clear()
      const prev = active
      active = node
      try { node.value = node.fn() } finally { active = prev }
      node.dirty = false
    }
    track(node)
    return node.value
  }

  function set(node, value) {
    if (Object.is(node.value, value)) return false
    node.value = value
    const affected = new Set()
    gather(node, affected)
    for (const target of affected) runEffect(target)
    return true
  }

  function effect(fn) {
    const node = { kind: 'effect', fn, deps: new Set(), subs: new Set(), stopped: false }
    runEffect(node)
    return { node }
  }

  return { signal, computed, read, set, effect }
}`,
      test: L3S1,
      diag: [
        'signal 的 set 没有 Object.is 同值短路，写入相同值也触发了 effect。',
        'effect 没有在创建时立即执行一次（只在 set 时才跑），seen 少了一条。',
        'computed 在 read 里没有判断 dirty，或者创建时就把值算了出来，runs 一开始就是 1。',
        'computed 重算前没把自己从旧依赖摘掉，导致链式更新不传播或者重复传播。',
        'gather 只看了直接订阅者，没递归处理 computed，链条断了拿不到新值。'
      ]
    },
    {
      n: 2,
      title: 'batch / untrack / stop：控制通知的时机与范围',
      think: '有了图，控制面就三件事：延后通知（batch）、不登记依赖（untrack）、永久退订（stop）。batch 用深度计数 + 队列去重，是调度器最早的原型。',
      hint: 'batchDepth 在 batch 进入时 +1、退出时 -1 并在归零时 flush；set 在 batchDepth > 0 时只入队；untrack 临时置 active 为 null；stop 清掉自己的所有订阅并置 stopped。',
      code: `function createGraph() {
  let active = null
  let batchDepth = 0
  let queue = []

  function track(node) {
    if (!active) return
    active.deps.add(node)
    node.subs.add(active)
  }

  function gather(node, out) {
    for (const sub of Array.from(node.subs)) {
      if (sub.kind === 'effect') out.add(sub)
      else if (sub.kind === 'computed' && !sub.dirty) {
        sub.dirty = true
        gather(sub, out)
      }
    }
  }

  function runEffect(node) {
    if (node.stopped) return
    for (const dep of node.deps) dep.subs.delete(node)
    node.deps.clear()
    const prev = active
    active = node
    try { node.fn() } finally { active = prev }
  }

  function flush() {
    if (batchDepth > 0 || queue.length === 0) return
    const jobs = Array.from(new Set(queue))
    queue = []
    for (const job of jobs) runEffect(job)
  }

  function signal(initial) {
    return { kind: 'signal', value: initial, deps: new Set(), subs: new Set() }
  }

  function computed(fn) {
    return { kind: 'computed', fn, value: undefined, dirty: true, deps: new Set(), subs: new Set() }
  }

  function read(node) {
    if (!node || !node.kind) throw new Error('read 只能读 signal / computed')
    if (node.kind === 'computed' && node.dirty) {
      for (const dep of node.deps) dep.subs.delete(node)
      node.deps.clear()
      const prev = active
      active = node
      try { node.value = node.fn() } finally { active = prev }
      node.dirty = false
    }
    track(node)
    return node.value
  }

  function set(node, value) {
    if (Object.is(node.value, value)) return false
    node.value = value
    const affected = new Set()
    gather(node, affected)
    for (const target of affected) {
      if (batchDepth > 0) queue.push(target)
      else runEffect(target)
    }
    flush()
    return true
  }

  function effect(fn) {
    const node = { kind: 'effect', fn, deps: new Set(), subs: new Set(), stopped: false }
    runEffect(node)
    return {
      stop() {
        if (node.stopped) return false
        node.stopped = true
        for (const dep of node.deps) dep.subs.delete(node)
        node.deps.clear()
        return true
      }
    }
  }

  function batch(fn) {
    batchDepth += 1
    try { return fn() } finally {
      batchDepth -= 1
      flush()
    }
  }

  function untrack(fn) {
    const prev = active
    active = null
    try { return fn() } finally { active = prev }
  }

  return { signal, computed, read, set, effect, batch, untrack }
}`,
      test: L3S2,
      diag: [
        'batch 里 set 仍然直接执行了 effect，队列没用上或者 flush 在 set 里被无条件调用。',
        '不在 batch 时 set 只是入队而没人 flush，effect 一次都不跑。',
        'flush 前没去重，同一个 effect 在 batch 里排队两次跑了两次。',
        'untrack 只置了标志位但 track 没检查，b 还是被登记成依赖。',
        'stop 没清订阅或者没置 stopped，set 之后仍会被唤醒；重复 stop 也没返回 false。'
      ]
    },
    {
      n: 3,
      title: '版本能力矩阵、迁移风险与选型评分',
      think: '最后一层是「工程判断能不能写成规则」：能力矩阵是常量，迁移 risk 是规则表，选型是加权求和。把这三样写成函数，讨论升级时就不会停在「应该没问题吧」。',
      hint: '能力表按版本给布尔字段；migrationRisk 先按「3.x 移除」与「最低版本门槛」两类规则收集 blocker，再按数量定级；评分逐项 weight 乘分相加，相等返回 tie。',
      code: `function createGraph() {
  let active = null
  let batchDepth = 0
  let queue = []

  function track(node) {
    if (!active) return
    active.deps.add(node)
    node.subs.add(active)
  }

  function gather(node, out) {
    for (const sub of Array.from(node.subs)) {
      if (sub.kind === 'effect') out.add(sub)
      else if (sub.kind === 'computed' && !sub.dirty) {
        sub.dirty = true
        gather(sub, out)
      }
    }
  }

  function runEffect(node) {
    if (node.stopped) return
    for (const dep of node.deps) dep.subs.delete(node)
    node.deps.clear()
    const prev = active
    active = node
    try { node.fn() } finally { active = prev }
  }

  function flush() {
    if (batchDepth > 0 || queue.length === 0) return
    const jobs = Array.from(new Set(queue))
    queue = []
    for (const job of jobs) runEffect(job)
  }

  function signal(initial) {
    return { kind: 'signal', value: initial, deps: new Set(), subs: new Set() }
  }

  function computed(fn) {
    return { kind: 'computed', fn, value: undefined, dirty: true, deps: new Set(), subs: new Set() }
  }

  function read(node) {
    if (!node || !node.kind) throw new Error('read 只能读 signal / computed')
    if (node.kind === 'computed' && node.dirty) {
      for (const dep of node.deps) dep.subs.delete(node)
      node.deps.clear()
      const prev = active
      active = node
      try { node.value = node.fn() } finally { active = prev }
      node.dirty = false
    }
    track(node)
    return node.value
  }

  function set(node, value) {
    if (Object.is(node.value, value)) return false
    node.value = value
    const affected = new Set()
    gather(node, affected)
    for (const target of affected) {
      if (batchDepth > 0) queue.push(target)
      else runEffect(target)
    }
    flush()
    return true
  }

  function effect(fn) {
    const node = { kind: 'effect', fn, deps: new Set(), subs: new Set(), stopped: false }
    runEffect(node)
    return {
      stop() {
        if (node.stopped) return false
        node.stopped = true
        for (const dep of node.deps) dep.subs.delete(node)
        node.deps.clear()
        return true
      }
    }
  }

  function batch(fn) {
    batchDepth += 1
    try { return fn() } finally {
      batchDepth -= 1
      flush()
    }
  }

  function untrack(fn) {
    const prev = active
    active = null
    try { return fn() } finally { active = prev }
  }

  return { signal, computed, read, set, effect, batch, untrack }
}

const VUE_FEATURES = {
  '2.7': { composition: true, teleport: false, suspense: false, defineModel: false, vapor: false },
  '3.0': { composition: true, teleport: true, suspense: true, defineModel: false, vapor: false },
  '3.2': { composition: true, teleport: true, suspense: true, defineModel: false, vapor: false },
  '3.4': { composition: true, teleport: true, suspense: true, defineModel: true, vapor: false },
  '3.5': { composition: true, teleport: true, suspense: true, defineModel: true, vapor: true }
}

const REMOVED_IN_V3 = ['filters', 'eventBus']
const MIN_VERSION = { defineModel: '3.4', vapor: '3.5' }

function vueFeatures(version) {
  const row = VUE_FEATURES[version]
  if (!row) throw new Error('未知的 Vue 版本：' + version)
  return {
    version,
    composition: row.composition,
    teleport: row.teleport,
    suspense: row.suspense,
    defineModel: row.defineModel,
    vapor: row.vapor
  }
}

function migrationRisk(options) {
  const target = vueFeatures(options.to)
  const blockers = []
  for (const api of options.uses || []) {
    if (REMOVED_IN_V3.indexOf(api) >= 0) {
      if (String(options.to).charAt(0) === '3') blockers.push(api + '-removed')
      continue
    }
    const min = MIN_VERSION[api]
    if (min && !target[api]) blockers.push(api + '-requires-' + min)
  }
  const level = blockers.length === 0 ? 'low' : (blockers.length > 1 ? 'high' : 'medium')
  return { level, blockers }
}

function scoreFramework(items) {
  let vue = 0
  let react = 0
  for (const item of items || []) {
    const weight = item.weight === undefined ? 1 : item.weight
    vue += weight * (item.vue || 0)
    react += weight * (item.react || 0)
  }
  let winner = 'tie'
  if (vue > react) winner = 'vue'
  else if (react > vue) winner = 'react'
  return { vue, react, winner }
}`,
      test: L3S3,
      diag: [
        '能力表缺版本条目，vueFeatures 直接返回 undefined 或没抛错；也可能把 2.7 的 teleport 写成 true。',
        'migrationRisk 没区分「3.x 移除」和「最低版本门槛」两类规则，filters 没进 blockers。',
        'blockers 收集顺序或去重不对，两个 blocker 的顺序与用例不符；或者 level 的阈值写反。',
        'scoreFramework 忘了乘权重（直接加分），或者用了字符串拼接导致 17 变成 53。',
        '平局时默认选了 vue（用了 >= 比较），没有如实返回 tie。'
      ]
    }
  ],
  skeleton: `function createGraph() {
  throw new Error('createGraph 还没实现')
}

function vueFeatures(version) {
  throw new Error('vueFeatures 还没实现')
}

function migrationRisk(options) {
  throw new Error('migrationRisk 还没实现')
}

function scoreFramework(items) {
  throw new Error('scoreFramework 还没实现')
}`,
  solution: '',
  finalCode: '',
  tests: `${L3S1}\n${L3S2}\n${L3S3}`
}

LV3.solution = LV3.stages[2].code
LV3.finalCode = LV3.solution

export default {
  id: 'fe-vue-3',
  version: 3,
  domain: 'fe',
  cumulative: false,
  title: 'Vue3 深水区：状态、路由、性能与生态',
  emoji: '💠',
  tagline: '3 关：Setup Store 与路由匹配、性能手段与虚拟列表、Vapor signals 与版本演进对照。',
  stack: ['Vue3', 'Pinia', 'Router', 'Performance'],
  intro: '这个项目不写业务组件，而是把 Vue3 里最难讲清的四块机制各写一遍：setup store 的 ref/computed 代理与 $patch/$reset、路由的权重匹配与守卫语义、大列表的虚拟化与更新粒度、Vapor signals 与版本演进带来的取舍。每一关都要求你把「为什么这样设计、边界在哪」讲清楚，而不是背 API。',
  outcome: '做完之后你能白板写出一个可运行的 Pinia 简化内核与 Router 匹配器，能解释为什么解构 store 会丢响应性、history 模式为什么刷新 404、key 与 index key 的移动代价差在哪，也能把 Vue2/3/Vapor 的演进讲成一条因果链。',
  levels: [LV1, LV2, LV3]
}