/**
 * 前端 · Vue3 三关：组合式 API 与宏 / 组件通信 / 生命周期与状态管理
 *
 * 全部用一个「迷你 Vue 运行时」的数据模型演示，不引入真实 Vue：
 *   - 第 1 关：setup 执行与实例代理、钩子注册顺序、composable 的 scope 清理
 *   - 第 2 关：props 校验、emit 声明、attrs 透传、expose、provide/inject、插槽
 *   - 第 3 关：mount/unmount 流程、KeepAlive 缓存与 LRU、Pinia 的 setup store
 *
 * 简化点统一注明在关卡正文里：没有依赖收集、没有异步渲染队列、
 * 事件名一律走 Vue3 规则（不做 kebab 到驼峰的自动转换）。
 */

/* ============================================================ 第 1 关测试 */
const L1S1 = `{
  check('setup 只在创建实例时执行一次', () => {
    let calls = 0
    const def = { setup() { calls = calls + 1; return {} } }
    const inst = createInstance(def, {})
    same(calls, 1, 'setup 必须执行且只执行一次')
    same(inst.setupState, {})
  })
  check('setup 收到的就是实例的 props', () => {
    let seen = null
    const def = { setup(props) { seen = props.msg; return {} } }
    const inst = createInstance(def, { msg: 'hello' })
    same(seen, 'hello')
    same(inst.props.msg, 'hello')
  })
  check('返回对象时，渲染函数通过代理读到 setup 字段', () => {
    const def = {
      setup() { return { count: 3, label: 'x' } },
      render(proxy) { return proxy.count + ':' + proxy.label }
    }
    const inst = createInstance(def, {})
    same(renderInstance(inst), '3:x')
  })
  check('返回函数时，这个函数自己就是渲染函数', () => {
    const def = { setup() { return () => 'from-setup' } }
    const inst = createInstance(def, {})
    same(typeof inst.render, 'function')
    same(renderInstance(inst), 'from-setup')
  })
  check('代理优先读 setup 字段，其次才回退到 props', () => {
    const def = { setup() { return { title: 'setup' } } }
    const inst = createInstance(def, { title: 'prop', id: 7 })
    same(inst.proxy.title, 'setup')
    same(inst.proxy.id, 7)
    same(inst.proxy.missing, undefined)
  })
  check('没有 setup 的组件抛错，钩子队列初始为空', () => {
    throws(() => createInstance({}, {}))
    same(createHooks().mounted, [])
    same(createHooks().unmounted, [])
  })
}`

const L1S2 = `{
  check('mounted 钩子按注册顺序依次执行', () => {
    const log = []
    const def = { setup(p, ctx) { ctx.onMounted(() => log.push('a')); ctx.onMounted(() => log.push('b')); return {} } }
    const inst = createInstance(def, {})
    same(mountInstance(inst), 2)
    same(log, ['a', 'b'])
  })
  check('setup 里注册的钩子先于创建后追加的钩子', () => {
    const log = []
    const def = { setup(p, ctx) { ctx.onMounted(() => log.push('in-setup')); return {} } }
    const inst = createInstance(def, {})
    registerMounted(inst, () => log.push('later'))
    mountInstance(inst)
    same(log, ['in-setup', 'later'])
  })
  check('重复挂载不会重跑已经执行过的 mounted 钩子', () => {
    const log = []
    const def = { setup(p, ctx) { ctx.onMounted(() => log.push('once')); return {} } }
    const inst = createInstance(def, {})
    mountInstance(inst)
    same(mountInstance(inst), 0)
    same(log.length, 1)
  })
  check('unmounted 钩子按注册顺序执行，且只执行一次', () => {
    const log = []
    const def = { setup(p, ctx) {
      ctx.onUnmounted(() => log.push('u1'))
      ctx.onUnmounted(() => log.push('u2'))
      return {}
    } }
    const inst = createInstance(def, {})
    same(unmountInstance(inst), 2)
    same(unmountInstance(inst), 0)
    same(log, ['u1', 'u2'])
  })
  check('没有任何钩子时挂载与卸载都返回零', () => {
    const inst = createInstance({ setup() { return {} } }, {})
    same(mountInstance(inst), 0)
    same(unmountInstance(inst), 0)
  })
}`

const L1S3 = `{
  check('两个 scope 各自使用同一 composable，计数互不影响', () => {
    const s1 = createScope()
    const s2 = createScope()
    const a = useCounter(0, s1)
    const b = useCounter(0, s2)
    a.inc(); a.inc(); b.inc()
    same(a.count.value, 2)
    same(b.count.value, 1)
    notSame(a.count, b.count, '每次调用都必须返回新的 ref')
  })
  check('composable 返回的 ref 可以被使用方读写', () => {
    const s = createScope()
    const c = useCounter(10, s)
    c.count.value = 42
    same(c.count.value, 42)
  })
  check('dispose 时清理函数同步执行，不排队到微任务', () => {
    const s = createScope()
    const c = useCounter(0, s)
    same(c.state.disposed, 0)
    same(s.dispose(), true)
    same(c.state.disposed, 1, 'dispose 返回时就该清理完毕')
  })
  check('重复 dispose 不会重复执行清理，返回 false', () => {
    const s = createScope()
    const c = useCounter(0, s)
    s.dispose()
    same(s.dispose(), false)
    same(c.state.disposed, 1)
    same(s.cleanups.length, 0)
  })
  check('在 scope 外调用 onScopeDispose 会抛错，且不留下当前作用域', () => {
    throws(() => onScopeDispose(() => {}))
    same(getCurrentScope(), null, '异常之后作用域必须恢复到空')
  })
}`

/* ============================================================ 第 1 关代码 */
const L1_CODE_1 = `function createHooks() {
  return { mounted: [], unmounted: [] }
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

function createInstance(def, props) {
  if (!def || typeof def.setup !== 'function') {
    throw new Error('组件缺少 setup 函数')
  }
  const instance = {
    def: def,
    props: props || {},
    setupState: {},
    render: null,
    hooks: createHooks(),
    mountedFlag: false,
    unmountedFlag: false
  }
  instance.ctx = {
    onMounted(fn) { instance.hooks.mounted.push(fn) },
    onUnmounted(fn) { instance.hooks.unmounted.push(fn) }
  }
  const out = def.setup(instance.props, instance.ctx)
  if (typeof out === 'function') {
    instance.render = out
  } else if (out && typeof out === 'object') {
    instance.setupState = out
    if (typeof def.render === 'function') instance.render = def.render
  } else if (typeof def.render === 'function') {
    instance.render = def.render
  }
  instance.proxy = buildProxy(instance)
  return instance
}

function buildProxy(instance) {
  const proxy = {}
  const keys = Object.keys(instance.setupState)
  for (const key of Object.keys(instance.props)) {
    if (keys.indexOf(key) < 0) keys.push(key)
  }
  for (const key of keys) {
    Object.defineProperty(proxy, key, {
      enumerable: true,
      get() {
        if (hasOwn(instance.setupState, key)) return instance.setupState[key]
        return instance.props[key]
      },
      set(value) {
        if (hasOwn(instance.setupState, key)) instance.setupState[key] = value
        else throw new Error('不能直接修改 prop：' + key)
      }
    })
  }
  return proxy
}

function renderInstance(instance) {
  if (typeof instance.render !== 'function') {
    throw new Error('实例没有渲染函数')
  }
  return instance.render(instance.proxy)
}`

const L1_CODE_2 = L1_CODE_1 + `
function registerMounted(instance, fn) {
  instance.hooks.mounted.push(fn)
}

function registerUnmounted(instance, fn) {
  instance.hooks.unmounted.push(fn)
}

function mountInstance(instance) {
  if (instance.mountedFlag) return 0
  instance.mountedFlag = true
  let count = 0
  for (const fn of instance.hooks.mounted.slice()) {
    fn()
    count = count + 1
  }
  return count
}

function unmountInstance(instance) {
  if (instance.unmountedFlag) return 0
  instance.unmountedFlag = true
  let count = 0
  for (const fn of instance.hooks.unmounted.slice()) {
    fn()
    count = count + 1
  }
  return count
}`

const L1_CODE_3 = L1_CODE_2 + `
let currentScope = null

function getCurrentScope() {
  return currentScope
}

function createScope() {
  const scope = {
    disposed: false,
    cleanups: [],
    onDispose(fn) {
      if (scope.disposed) return
      scope.cleanups.push(fn)
    },
    dispose() {
      if (scope.disposed) return false
      scope.disposed = true
      const pending = scope.cleanups.slice()
      scope.cleanups.length = 0
      for (const fn of pending) fn()
      return true
    }
  }
  return scope
}

function runInScope(scope, fn) {
  const prev = currentScope
  currentScope = scope
  try {
    return fn()
  } finally {
    currentScope = prev
  }
}

function onScopeDispose(fn) {
  if (!currentScope) throw new Error('onScopeDispose 必须在 setup 或 composable 内调用')
  currentScope.onDispose(fn)
}

function ref(initial) {
  return { value: initial }
}

function useCounter(initial, scope) {
  return runInScope(scope, () => {
    const count = ref(initial)
    const state = { disposed: 0 }
    onScopeDispose(() => { state.disposed = 1 })
    return {
      count: count,
      state: state,
      inc() { count.value = count.value + 1 }
    }
  })
}`

/* ============================================================ 第 1 关 */
const LV1 = {
  id: 'lv1',
  title: '第 1 关 · setup、钩子与 composable',
  emoji: '🧩',
  xp: 40,
  goal: '实现一个迷你 Vue 运行时：createInstance 执行 setup 并把返回值变成实例代理，mountInstance / unmountInstance 按注册顺序跑钩子，createScope 让 composable 的清理函数在销毁时同步释放。',
  why: '面试问「setup 里为什么没有 this」「composable 为什么能复用」「onMounted 谁先执行」，只背结论接不住追问。本关把 Vue3 的三处机制拆成能跑的数据结构：setup 只执行一次，返回值决定渲染函数与代理来源；钩子先进队、再按注册顺序出队，setup 里注册的自然排在外部追加之前；composable 的能力全部来自闭包加销毁时的清理队列，不是框架魔法。写完你会知道每一处「约定」落在哪行代码上。',
  nodes: ['fe.vue.composition', 'fe.vue.composition.composable-design', 'fe.vue.composition.options-vs-composition', 'fe.vue.composition.setup-lifecycle', 'fe.vue.composition.sfc-macros'],
  thinking: [
    {
      title: 'setup 的返回值决定实例形态',
      md: 'setup 返回对象时，字段被挂到 setupState，模板通过代理读取；返回函数时，这个函数直接当 render 用，参数就是代理本身。所以「setup 里为什么不能用 this」的答案是：它执行时实例还没建完，代理也还没生成，能拿到的只有 props 和 ctx。\n\nbuildProxy 复现了代理的读取优先级：先查 setupState，再回退 props，都没有就是 undefined。真实 Vue 里代理还会额外拦截 ref 自动解包，这里刻意没做，避免掩盖「属性从哪来」这条主线。'
    },
    {
      title: '注册顺序就是执行顺序',
      md: '同一个组件里的 onMounted 按注册先后执行，所以 setup 体里同步注册的钩子一定排在外面用 registerMounted 追加的钩子之前。父子之间的顺序是另一回事：子组件的 mounted 先于父组件，因为挂载完成是冒泡上报的，第 3 关会专门验证。\n\n钩子不是「注册即执行」，而是先入队、挂载时出队。搞清这点，就不会写出在 setup 里直接 fetch 却在 unmount 后仍回写状态的 bug。'
    }
  ],
  prereq: [
    {
      title: '闭包与属性描述符',
      md: '钩子队列、setupState、scope 的清理数组都靠闭包保存私有状态；实例代理则用 Object.defineProperty 定义 getter，让 proxy.count 每次都实时读取 setupState，而不是读创建时的快照。\n\n可以把 defineProperty 理解成「给对象装一个读取函数」：定义之后每次访问都会执行 get，所以 setupState 后来被改动，代理读到的也是新值。'
    },
    {
      title: 'ref 的最小模型',
      md: '本关把 ref 简化成 { value } 的普通对象：改 value 就是改字段，没有依赖收集，也不会触发组件重渲染。这种简化足够演示 composable 的契约（输入、响应式输出、清理），但真实 Vue 的响应式还要在读取时记录依赖，第 3 关会用指纹比较近似地模拟一次。'
    }
  ],
  api: [
    {
      name: 'createInstance',
      sig: 'createInstance(def, props) => instance',
      args: 'def 是组件定义，必须带 setup，可选带 render；props 是父组件传入的属性对象，原样作为 setup 的第一个参数。',
      returns: '实例对象，含 props、setupState、render、hooks（mounted / unmounted 两个队列）、ctx、proxy，以及 mountedFlag / unmountedFlag 两个去重标记。',
      example: 'const inst = createInstance({ setup() { return { count: 1 } } }, { id: 1 })\ninst.setupState.count   // 1\ninst.proxy.count        // 1\ninst.proxy.id           // 1（回退到 props）'
    },
    {
      name: 'mountInstance',
      sig: 'mountInstance(instance) => number',
      args: 'instance 是 createInstance 的产物；无第二个参数。',
      returns: '本次实际执行的 mounted 钩子数量，重复挂载返回 0，用来验证去重。',
      example: 'const log = []\nconst inst = createInstance({ setup(p, ctx) { ctx.onMounted(() => log.push(\'m\')); return {} } }, {})\nmountInstance(inst)      // 1\nmountInstance(inst)      // 0'
    },
    {
      name: 'createScope',
      sig: 'createScope() => { onDispose(fn), dispose() => boolean, disposed, cleanups }',
      args: '无参数。onDispose 登记清理函数，dispose 立刻按登记顺序同步执行全部清理。',
      returns: '作用域对象；dispose 首次调用返回 true 并清空队列，重复调用返回 false。',
      example: 'const s = createScope()\ns.onDispose(() => console.log(\'clean\'))\ns.dispose()   // true，同时打印 clean\ns.dispose()   // false'
    }
  ],
  usage: '// 组件里常见的清理写法\nonMounted(() => {\n  const timer = setInterval(poll, 1000)\n  onUnmounted(() => clearInterval(timer))\n})\n\n// 本关的模型：\nconst log = []\nconst inst = createInstance({ setup(p, ctx) { ctx.onMounted(() => log.push(\'mounted\')); return {} } }, {})\nmountInstance(inst)\n// log 变成 [\'mounted\']',
  hints: [
    '第 1 步：setup 返回函数就赋给 instance.render，返回对象就存进 setupState 并用 buildProxy 生成 getter。',
    '第 1 步的代理要用 defineProperty 定义 getter，不要在创建时把值拷进普通对象，否则改动不可见。',
    '第 2 步：mountInstance 用 mountedFlag 去重，遍历 hooks 的 slice 副本，防止执行中追加导致死循环。',
    '第 3 步：runInScope 必须用 try / finally 恢复 currentScope，异常才不会让当前作用域泄漏。',
    '第 3 步：dispose 先取出清理数组再清空，然后逐个调用，保证「再 dispose 一次」不会重跑。'
  ],
  concepts: [
    {
      title: 'options 与 composition 的等价映射',
      md: 'data 对应 ref 或 reactive，methods 对应普通函数，computed 对应 computed，watch 对应 watch / watchEffect，created 对应 setup 体本身，mounted 对应 onMounted。差别不在能力，而在组织方式：options 按选项类型切块，composition 按逻辑关注点切块，所以一个功能连同它的状态、计算、清理可以整体搬成 composable，而 options 写法下这些代码被拆散在四个选项里。'
    },
    {
      title: 'SFC 宏编译后变成什么',
      md: 'defineProps 在编译后消失，变成 props 选项声明加一次 setup 参数注入；defineEmits 变成 emits 数组并绑定 ctx.emit；withDefaults 在编译期生成默认值合并；defineExpose 编译成 exposed 对象，决定父组件通过 ref 能拿到哪些字段。宏只能在 setup 顶层调用，因为编译器要静态分析它的参数，放进 if 分支就无法生成了。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '让 setup 跑一次，返回值变成代理',
      think: '先把实例创建这条线跑通：setup 只执行一次，返回对象就建代理，返回函数就把它当渲染函数。这一步刻意不碰生命周期，让「setup 到底交付了什么」先暴露出来。',
      hint: 'typeof out 判断顺序：函数优先，对象其次，最后才是 def.render 兜底。',
      code: L1_CODE_1,
      test: L1S1,
      diag: [
        'setup 被调用了两次，通常是在 createInstance 之外又手动调了一次 setup。',
        '返回函数的形态没被识别，typeof out 的判断顺序写反了或漏了分支。',
        '代理读不到 setup 字段，定义 getter 时闭包捕获的 key 用错了变量。',
        '代理优先读到了 props，hasOwn(setupState) 的判断被写成了别的对象。',
        '缺少 setup 时没有抛错，导致后续测试报奇怪的 undefined 错误。',
        '钩子队列没有初始化，ctx.onMounted 一调用就抛 undefined 不是函数。'
      ]
    },
    {
      n: 2,
      title: '钩子先入队，按注册顺序出队',
      think: '钩子不是注册即执行，而是入队等挂载。setup 里注册的天然排在前面，因为 setup 先跑完才轮到外部追加。去重靠标记，不靠清空队列，否则重复挂载的判断就失效了。',
      hint: 'mountInstance 与 unmountInstance 各用一个 flag 去重，返回值给出本次执行条数。',
      code: L1_CODE_2,
      test: L1S2,
      diag: [
        '执行顺序和注册顺序不一致，可能是用了 unshift 或者倒序遍历。',
        '没有去重标记，第二次 mountInstance 把钩子又跑了一遍。',
        '遍历时直接改了原队列，for of 取到的是变动中的数组。',
        'unmounted 队列和 mounted 队列共用了一个标记，互相污染。',
        '没有钩子时返回了 undefined 而不是 0，计数变量没初始化。'
      ]
    },
    {
      n: 3,
      title: 'composable 的清理与作用域',
      think: 'composable 的可复用性来自「每次调用都新建一份状态」，可销毁性来自清理队列。dispose 必须同步执行清理：子组件 DOM 都卸了，定时器还在跑，就是少了这一步。',
      hint: 'runInScope 用 try / finally 恢复上一个作用域；dispose 先取副本再清空数组。',
      code: L1_CODE_3,
      test: L1S3,
      diag: [
        '两个组件共用了一个 ref，说明状态被提到了模块作用域而不是每次新建。',
        'dispose 后清理没跑，检查 cleanups 是否在调用前就被清空了。',
        '清理跑了两遍，dispose 没有用 disposed 标记挡住第二次调用。',
        'runInScope 没有恢复上一个作用域，getCurrentScope 一直停在被销毁的 scope 上。',
        'onScopeDispose 在作用域外没有抛错，导致清理函数被静默丢弃。'
      ]
    }
  ],
  skeleton: `function createHooks() { throw new Error('TODO: 返回 mounted / unmounted 两个空队列') }
function createInstance() { throw new Error('TODO: 执行 setup 并生成实例代理') }
function renderInstance() { throw new Error('TODO: 用 proxy 调用渲染函数') }
function mountInstance() { throw new Error('TODO: 按顺序执行 mounted 钩子') }
function unmountInstance() { throw new Error('TODO: 按顺序执行 unmounted 钩子') }
function registerMounted() { throw new Error('TODO: 向 mounted 队列追加钩子') }
function createScope() { throw new Error('TODO: 返回带 onDispose / dispose 的作用域') }
function runInScope() { throw new Error('TODO: 在作用域内执行并在 finally 里恢复') }
function onScopeDispose() { throw new Error('TODO: 把清理函数登记到当前作用域') }
function ref() { throw new Error('TODO: 返回 { value } 的最小 ref') }
function useCounter() { throw new Error('TODO: 返回 count / state / inc 的 composable') }
function getCurrentScope() { throw new Error('TODO: 返回当前的 currentScope') }`,
  solution: L1_CODE_3,
  finalCode: L1_CODE_3,
  tests: `${L1S1}\n${L1S2}\n${L1S3}`
}

/* ============================================================ 第 2 关测试 */
const L2S1 = `{
  check('缺省时取静态默认值，attrs 保持为空', () => {
    const out = normalizeProps({ size: { type: Number, default: 20 } }, {})
    same(out.props.size, 20)
    same(out.attrs, {})
  })
  check('函数默认值每次调用都重新生成，不共享引用', () => {
    const schema = { tags: { type: Array, default: () => [] } }
    const a = normalizeProps(schema, {})
    const b = normalizeProps(schema, {})
    same(a.props.tags, [])
    ok(a.props.tags !== b.props.tags, '默认数组不能共享同一个实例')
    same(a.props.tags.length, 0)
  })
  check('Boolean 缺省为 false，只有空串或同名值才转成 true', () => {
    const schema = { disabled: { type: Boolean } }
    same(normalizeProps(schema, {}).props.disabled, false)
    same(normalizeProps(schema, { disabled: '' }).props.disabled, true)
    same(normalizeProps(schema, { disabled: 'disabled' }).props.disabled, true)
    same(normalizeProps(schema, { disabled: false }).props.disabled, false)
    throws(() => normalizeProps(schema, { disabled: 'yes' }))
  })
  check('必填缺失、类型不符、validator 不通过都会抛错', () => {
    throws(() => normalizeProps({ msg: { type: String, required: true } }, {}))
    throws(() => normalizeProps({ count: { type: Number } }, { count: '3' }))
    throws(() => normalizeProps({ level: { type: String, validator: (v) => v === 'a' } }, { level: 'b' }))
  })
  check('未声明的属性落入 attrs，不进入 props', () => {
    const out = normalizeProps({ id: { type: String } }, { id: 'x', 'data-role': 'btn' })
    same(out.props.id, 'x')
    same(out.attrs, { 'data-role': 'btn' })
    same(out.props['data-role'], undefined)
  })
  check('显式传入 undefined 时仍然走默认值', () => {
    const out = normalizeProps({ size: { type: Number, default: 5 } }, { size: undefined })
    same(out.props.size, 5)
  })
}`

const L2S2 = `{
  check('触发已声明的事件会命中 on 加驼峰命名的监听器', () => {
    const log = []
    const bus = createEmitter(['myEvent'], { onMyEvent: (v) => log.push(v) })
    same(bus.emit('myEvent', 'x'), true)
    same(log, ['x'])
    same(bus.log, ['myEvent'])
  })
  check('触发未声明的事件抛错，事件名也不做 kebab 转换', () => {
    const bus = createEmitter(['myEvent'], {})
    throws(() => bus.emit('other'))
    throws(() => bus.emit('my-event'))
    same(bus.log, [])
  })
  check('class 的字符串、数组、对象写法合并成一个空格串', () => {
    same(mergeClass('a', ['b', 'c']), 'a b c')
    same(mergeClass({ on: true, off: false }, 'x'), 'on x')
    same(mergeClass('', undefined), '')
  })
  check('style 的对象与字符串形式按后者覆盖合并', () => {
    same(mergeStyle({ color: 'red', fontSize: '12px' }, 'color: blue'), { color: 'blue', fontSize: '12px' })
  })
  check('inheritAttrs 为 false 时根节点不接收透传属性', () => {
    const attrs = { class: 'x', 'data-role': 'btn' }
    same(mergeRootAttrs({ inheritAttrs: false }, attrs, { class: 'root' }), null)
    const merged = mergeRootAttrs({}, attrs, { class: 'root', title: 't' })
    same(merged.class, 'root x')
    same(merged['data-role'], 'btn')
    same(merged.title, 't')
  })
  check('expose 声明过的键可见，未声明的拿不到', () => {
    const inst = { proxy: { hidden: 1 }, exposed: { count: { value: 2 }, inc: () => {} } }
    const out = getExposed(inst)
    same(out.count, 2)
    same(typeof out.inc, 'function')
    same(out.hidden, undefined)
  })
}`

const L2S3 = `{
  check('默认插槽与具名插槽分别按名渲染', () => {
    const slots = { default: () => 'main', header: () => 'head' }
    same(renderSlot(slots, 'default'), 'main')
    same(renderSlot(slots, 'header'), 'head')
    same(renderSlot(slots, undefined), 'main')
  })
  check('作用域插槽在调用时收到插槽 props', () => {
    const slots = { item: (props) => props.text + ':' + props.index }
    same(renderSlot(slots, 'item', { text: 'a', index: 0 }), 'a:0')
  })
  check('插槽没提供或渲染结果为空时回落到兜底内容', () => {
    same(renderSlot({}, 'default', {}, 'fallback'), 'fallback')
    same(renderSlot({ default: () => '' }, 'default', {}, 'empty'), 'empty')
    same(hasSlot({ default: () => 'x' }, 'default'), true)
    same(hasSlot({}, 'header'), false)
    same(slotNames({ default: () => 1, footer: () => 2 }), ['default', 'footer'])
  })
  check('祖先 provide 的值后代能 inject 到，symbol 作 key 同样有效', () => {
    const KEY = Symbol('theme')
    const root = createInjectContext(null)
    root.provide(KEY, 'dark')
    root.provide('name', 'root')
    const leaf = createInjectContext(createInjectContext(root))
    same(injectValue(leaf, KEY), 'dark')
    same(injectValue(leaf, 'name'), 'root')
  })
  check('后代 provide 覆盖祖先，缺失时用工厂默认值', () => {
    const root = createInjectContext(null)
    root.provide('theme', 'light')
    const mid = createInjectContext(root)
    mid.provide('theme', 'dark')
    const leaf = createInjectContext(mid)
    same(injectValue(leaf, 'theme', 'ignore'), 'dark')
    let built = 0
    const factory = () => { built = built + 1; return 'built' }
    same(injectValue(leaf, 'missing', factory), 'built')
    same(built, 1)
    same(injectValue(leaf, 'missing2', 'plain'), 'plain')
  })
  check('provide 原始值不响应变化，provide 对象或 ref 才共享修改', () => {
    const root = createInjectContext(null)
    let count = 0
    root.provide('count', count)
    const state = { value: 1 }
    root.provide('state', state)
    const child = createInjectContext(root)
    count = 5
    same(injectValue(child, 'count'), 0, '原始值注入的是那一刻的快照')
    const got = injectValue(child, 'state')
    got.value = 2
    same(state.value, 2, '对象注入的是引用本身')
    same(injectValue(child, 'state').value, 2)
  })
}`

/* ============================================================ 第 2 关代码 */
const L2_CODE_1 = `function hasOwnKey(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

function callDefault(value) {
  return typeof value === 'function' ? value() : value
}

function typeMatches(type, value) {
  if (!type) return true
  if (type === String) return typeof value === 'string'
  if (type === Number) return typeof value === 'number'
  if (type === Boolean) return typeof value === 'boolean'
  if (type === Array) return Array.isArray(value)
  if (type === Object) return value !== null && typeof value === 'object' && !Array.isArray(value)
  if (type === Function) return typeof value === 'function'
  return true
}

function normalizeProps(schema, raw) {
  const declared = schema || {}
  const rawProps = raw || {}
  const props = {}
  const attrs = {}
  for (const key of Object.keys(rawProps)) {
    if (!hasOwnKey(declared, key)) attrs[key] = rawProps[key]
  }
  for (const key of Object.keys(declared)) {
    const spec = declared[key] || {}
    let value = hasOwnKey(rawProps, key) ? rawProps[key] : undefined
    if (spec.type === Boolean && value !== undefined) {
      if (value === '' || value === key) value = true
    }
    if (value === undefined) {
      if (spec.type === Boolean) {
        value = spec.default === undefined ? false : callDefault(spec.default)
      } else if (spec.default !== undefined) {
        value = callDefault(spec.default)
      } else if (spec.required) {
        throw new Error('缺少必填 prop：' + key)
      }
    }
    if (value !== undefined && !typeMatches(spec.type, value)) {
      throw new Error('prop 类型不匹配：' + key)
    }
    if (value !== undefined && typeof spec.validator === 'function' && !spec.validator(value)) {
      throw new Error('prop 校验未通过：' + key)
    }
    props[key] = value
  }
  return { props: props, attrs: attrs }
}`

const L2_CODE_2 = L2_CODE_1 + `
function createEmitter(declared, listenerProps) {
  const events = (declared || []).slice()
  const listeners = listenerProps || {}
  const log = []
  return {
    log: log,
    declared: events,
    emit(name, payload) {
      if (events.indexOf(name) < 0) throw new Error('未声明的事件：' + name)
      log.push(name)
      const key = 'on' + name.charAt(0).toUpperCase() + name.slice(1)
      const handler = listeners[key]
      if (typeof handler === 'function') handler(payload)
      return true
    }
  }
}

function normalizeClass(value) {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const parts = []
    for (const item of value) {
      const part = normalizeClass(item)
      if (part) parts.push(part)
    }
    return parts.join(' ')
  }
  if (typeof value === 'object') {
    const parts = []
    for (const key of Object.keys(value)) {
      if (value[key]) parts.push(key)
    }
    return parts.join(' ')
  }
  return ''
}

function mergeClass(a, b) {
  const parts = []
  const left = normalizeClass(a)
  const right = normalizeClass(b)
  if (left) parts.push(left)
  if (right) parts.push(right)
  return parts.join(' ')
}

function normalizeStyle(value) {
  const out = {}
  if (!value) return out
  if (typeof value === 'string') {
    for (const chunk of value.split(';')) {
      const at = chunk.indexOf(':')
      if (at < 0) continue
      const key = chunk.slice(0, at).trim()
      const val = chunk.slice(at + 1).trim()
      if (key) out[key] = val
    }
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const one = normalizeStyle(item)
      for (const key of Object.keys(one)) out[key] = one[key]
    }
    return out
  }
  for (const key of Object.keys(value)) out[key] = value[key]
  return out
}

function mergeStyle(a, b) {
  const out = normalizeStyle(a)
  const right = normalizeStyle(b)
  for (const key of Object.keys(right)) out[key] = right[key]
  return out
}

function mergeRootAttrs(def, attrs, root) {
  const component = def || {}
  if (component.inheritAttrs === false) return null
  const extra = attrs || {}
  const base = root || {}
  const out = {}
  for (const key of Object.keys(base)) out[key] = base[key]
  for (const key of Object.keys(extra)) {
    if (key === 'class') out.class = mergeClass(base.class, extra.class)
    else if (key === 'style') out.style = mergeStyle(base.style, extra.style)
    else out[key] = extra[key]
  }
  return out
}

function getExposed(instance) {
  if (!instance.exposed) return instance.proxy
  const out = {}
  for (const key of Object.keys(instance.exposed)) {
    const value = instance.exposed[key]
    out[key] = value && typeof value === 'object' && hasOwnKey(value, 'value') ? value.value : value
  }
  return out
}`

const L2_CODE_3 = L2_CODE_2 + `
function createInjectContext(parent) {
  const entries = []
  const ctx = { parent: parent || null }
  ctx.provide = function (key, value) {
    for (const entry of entries) {
      if (entry.key === key) {
        entry.value = value
        return
      }
    }
    entries.push({ key: key, value: value })
  }
  ctx.lookup = function (key) {
    for (const entry of entries) {
      if (entry.key === key) return { hit: true, value: entry.value }
    }
    if (ctx.parent) return ctx.parent.lookup(key)
    return { hit: false, value: undefined }
  }
  return ctx
}

function injectValue(ctx, key, fallback) {
  if (!ctx) throw new Error('没有可用的注入上下文')
  const found = ctx.lookup(key)
  if (found.hit) return found.value
  if (typeof fallback === 'function') return fallback()
  return fallback
}

function hasSlot(slots, name) {
  const key = name === undefined ? 'default' : name
  return !!slots && typeof slots[key] === 'function'
}

function renderSlot(slots, name, props, fallback) {
  const key = name === undefined ? 'default' : name
  if (hasSlot(slots, key)) {
    const out = slots[key](props || {})
    if (out !== undefined && out !== null && out !== '') return out
  }
  return fallback === undefined ? null : fallback
}

function slotNames(slots) {
  return Object.keys(slots || {})
}`

/* ============================================================ 第 2 关 */
const LV2 = {
  id: 'lv2',
  title: '第 2 关 · 组件通信与属性透传',
  emoji: '📡',
  xp: 60,
  goal: '实现 normalizeProps、createEmitter、mergeClass / mergeStyle / mergeRootAttrs、getExposed、createInjectContext / injectValue 与 renderSlot，把 props 解析、事件声明、属性透传、依赖注入和插槽都变成可断言的返回值。',
  why: '组件通信真正难的不是「怎么传」，而是「传不到时谁负责」：父组件改了 props、事件名大小写不对、attrs 落到了错误的节点、注入的原始值不响应、插槽渲染出空字符串却还在等兜底内容。这些边界在真实项目里表现为「数据有时候才是新的」，极难复现。本关把 Vue3 的 props 解析、emit 校验、attrs 合并、expose 可见面、provide / inject 查找与插槽函数调用逐个实现，边界就从玄学变成返回值。',
  nodes: ['fe.vue.communication', 'fe.vue.communication.attrs-expose', 'fe.vue.communication.props-emit', 'fe.vue.communication.provide-inject', 'fe.vue.communication.slot-advanced'],
  thinking: [
    {
      title: 'props 是解析结果，不是父组件传来的原始对象',
      md: 'normalizeProps 做四件事：把未声明的键分流到 attrs、缺省时套默认值、Boolean 类型做 casting、最后按 type 与 validator 校验。顺序很关键：默认值只在值为 undefined 时生效，类型和 validator 永远校验最终值。\n\n所以「父组件传了、子组件没声明」的属性不会出现在 props 里，会进 attrs 落到根节点——这正是属性透传的起点。理解了这条分流，就不会再疑惑为什么 v-bind 的某些属性没进组件。'
    },
    {
      title: 'attrs 与 props 是一条分界线',
      md: 'props 是组件自己声明的 API，attrs 是「别人塞过来、我不认识、但通常要帮忙转交」的东西。class 与 style 会合并而不是覆盖，其余属性直接赋值；inheritAttrs 设成 false 时根节点一个都不接，只能手动 v-bind="$attrs" 到指定元素。\n\n这条线解释了为什么给第三方组件加 class 有时不生效：它关了 inheritAttrs，需要你显式转发。'
    }
  ],
  prereq: [
    {
      title: '引用类型与默认值的共享陷阱',
      md: 'type 为 Array 或 Object 时只能判断引用类型，判断不了内部结构，所以进一步约束要写在 validator 里。函数默认值每次调用都要返回新对象：默认值写成共享字面量，两个实例就会改到同一份数据，这是「状态串味」最常见的来源。\n\nnotSame 断言在这里很关键，它检查的是两个默认数组不是同一个引用，而不是内容是否相等。'
    },
    {
      title: 'Vue3 的事件名规则',
      md: 'Vue2 会在 kebab 与 camel 之间转换事件名，Vue3 取消了这套转换：emit 的名字必须和监听时完全一致。模板里的 @my-event 会编译成 onMyEvent 这个 prop，所以 emit("myEvent") 能命中监听器，emit("my-event") 找不到任何人。这条差异在迁移项目里表现为「事件静默丢失」，排查时会误以为是父子层级问题。'
    }
  ],
  api: [
    {
      name: 'normalizeProps',
      sig: 'normalizeProps(schema, raw) => { props, attrs }',
      args: 'schema 是声明对象，每个键可带 type / default / required / validator；raw 是父组件实际传入的原始属性。',
      returns: 'props 是按声明解析并校验后的值；attrs 收集所有未声明的键，交给根节点透传。任一声明校验失败直接抛错。',
      example: 'const out = normalizeProps({ size: { type: Number, default: 20 } }, { extra: 1 })\nout.props.size   // 20\nout.attrs        // { extra: 1 }'
    },
    {
      name: 'createEmitter',
      sig: 'createEmitter(declared, listenerProps) => { emit(name, payload), log, declared }',
      args: 'declared 是 emits 声明的事件名数组；listenerProps 是父组件提供的监听器 props，形如 { onMyEvent }。',
      returns: 'emit 会校验事件是否声明、命中监听器并返回 true；事件名写进 log 便于断言派发顺序。',
      example: 'const bus = createEmitter([\'myEvent\'], { onMyEvent: (v) => seen.push(v) })\nbus.emit(\'myEvent\', 1)   // true，seen = [1]\nbus.emit(\'other\')        // 抛错：未声明的事件'
    },
    {
      name: 'injectValue',
      sig: 'injectValue(ctx, key, fallback) => any',
      args: 'ctx 是 createInjectContext 的产物（沿 parent 向上查找）；key 可以是字符串或 Symbol；fallback 是缺失时的兜底，函数形式会被调用一次。',
      returns: '沿注入链找到的第一个值；找不到时返回 fallback 的结果，没有 fallback 则返回 undefined。',
      example: 'const root = createInjectContext(null)\nroot.provide(\'theme\', \'dark\')\nconst leaf = createInjectContext(createInjectContext(root))\ninjectValue(leaf, \'theme\')        // dark'
    }
  ],
  usage: '// 子组件声明与使用\nconst props = defineProps({ size: { type: Number, default: 20 } })\nconst emit = defineEmits([\'myEvent\'])\nemit(\'myEvent\', props.size)\n\n// 本关的模型：\nconst out = normalizeProps({ size: { type: Number, default: 20 } }, { size: 8 })\nconst bus = createEmitter([\'myEvent\'], { onMyEvent: (v) => console.log(v) })\nbus.emit(\'myEvent\', out.props.size)',
  hints: [
    '第 1 步：先分流 attrs，再逐键处理声明；Boolean 的 casting 只认空串和同名值。',
    '第 1 步：default 是函数就调用它，静态值直接用，undefined 才是「缺省」的判据。',
    '第 2 步：监听器键名是 on 加首字母大写，emit 的名字保持原样，不做任何转换。',
    '第 2 步：class 用三段归一后再拼接，style 先归一成对象再让后者覆盖前者。',
    '第 3 步：注入沿 parent 链向上查找，找到就返回，找不到才走 fallback；函数式 fallback 只调用一次。',
    '第 3 步：插槽存在但渲染出空串、null 或 undefined 时要回落，兜底内容才不会被空内容挡住。'
  ],
  concepts: [
    {
      title: '依赖注入的非响应性陷阱',
      md: 'provide 原始值时，注入方拿到的是那一刻的值；之后 provider 改自己的变量，注入方不会更新。正确做法是 provide 一个 ref 或 reactive 对象，让引用保持不变、内容可变。很多「切换主题不生效」「登录态拿不到最新用户」的 bug 都是这个原因，和第 1 关的 ref 模型连起来看更清楚。'
    },
    {
      title: '$slots 与 $scopedSlots 在 Vue3 合并了',
      md: 'Vue2 里普通插槽走 $slots、作用域插槽走 $scopedSlots，两套结构、两套判空逻辑；Vue3 统一成 $slots，所有插槽都是函数，作用域插槽只是「调用时传参数」。所以 Vue3 里没有「普通插槽」这个概念，插槽就是可调用的渲染函数，传不传 slot props 都由调用方决定。'
    },
    {
      title: 'expose 决定父组件 ref 能拿到什么',
      md: '父组件用 ref 拿到子组件实例时，能访问哪些字段由子组件的 expose 决定：defineExpose 之后只暴露声明过的键，没声明时拿到整个 setup 代理。这就是 Vue3 里 getCurrentInstance 的实例对外是空的原因——默认不向外暴露任何东西。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '先把 props 解析成可断言的形状',
      think: '组件通信的第一个岔路口是 props 解析：哪些进 props、哪些进 attrs、缺省填什么、校验在哪一步做。这一步只做解析，不碰事件与插槽，让「属性去哪了」先有确定答案。',
      hint: '先遍历 raw 把未声明的键放进 attrs，再遍历 schema 处理默认值与校验。',
      code: L2_CODE_1,
      test: L2S1,
      diag: [
        '未声明的键仍然进了 props，说明缺少分流到 attrs 的那一步。',
        '默认值没有生效，可能是判断写成了 value == null 而不是 undefined。',
        'Boolean 的默认值没填成 false，缺省的布尔属性读出来是 undefined。',
        '类型校验放在了默认值之前，导致未传的必填项报的是类型错误。',
        '函数默认值被直接赋成了函数本身，没有调用就存进了 props。',
        'validator 校验的是原始值而不是默认值填补后的最终值。'
      ]
    },
    {
      n: 2,
      title: '事件声明、属性透传与暴露面',
      think: '事件、attrs、expose 是同一条链上的三个开关：事件声明决定 emit 合法不合法，attrs 决定不认识的属性落到哪，expose 决定父组件 ref 能看见什么。三者都靠「谁声明了谁负责」这条规则。',
      hint: '监听器键名是 on 加首字母大写；class 与 style 归一后再合并，其余属性直接覆盖。',
      code: L2_CODE_2,
      test: L2S2,
      diag: [
        '监听器键名拼错，on 前缀之后没有把首字母转成大写。',
        '未声明的事件没有抛错，结果被静默吞掉，线上表现为事件不触发。',
        '对事件名做了 kebab 到驼峰的转换，这是 Vue2 的规则，Vue3 不转换。',
        'class 合并用了覆盖写法，父组件传的 class 把子组件自己的类名挤掉了。',
        'inheritAttrs 为 false 时仍然返回了失败对象，没有返回 null 表示不透传。',
        'getExposed 直接返回了整个代理，未声明的内部字段也跟着暴露出去。'
      ]
    },
    {
      n: 3,
      title: '注入链与插槽函数',
      think: 'provide / inject 是一条向上查找的链，最近的后代声明优先；插槽则是一组函数，能不能渲染、要不要兜底，全看调用结果而不是「有没有传」。这两处共同点是：都要按「最近优先」而不是「全局唯一」来理解。',
      hint: 'ctx.lookup 先查自己再递归 parent；renderSlot 用 hasSlot 判断存在性，空结果交给兜底。',
      code: L2_CODE_3,
      test: L2S3,
      diag: [
        '注入只查了当前层，没有沿 parent 递归向上找。',
        '后代 provide 的覆盖没生效，可能是先查了 parent 再查自己。',
        'symbol 作为 key 被转成了字符串，导致两个不同 symbol 撞在一起。',
        '函数式 fallback 被当普通值返回了，没有调用它。',
        '插槽返回空串时没有回落，兜底内容永远显示不出来。',
        '插槽名没写时取了 undefined 而不是 default，默认插槽渲染失败。'
      ]
    }
  ],
  skeleton: `function normalizeProps() { throw new Error('TODO: 解析 props 并把未声明的键分流到 attrs') }
function createEmitter() { throw new Error('TODO: 校验事件声明并派发给 on 驼峰监听器') }
function normalizeClass() { throw new Error('TODO: 把字符串 / 数组 / 对象归一成空格串') }
function mergeClass() { throw new Error('TODO: 合并两段 class') }
function normalizeStyle() { throw new Error('TODO: 把字符串 / 数组 / 对象归一成样式对象') }
function mergeStyle() { throw new Error('TODO: 合并两份 style，后者覆盖前者') }
function mergeRootAttrs() { throw new Error('TODO: inheritAttrs 为 false 时返回 null') }
function getExposed() { throw new Error('TODO: 只挑 expose 声明过的键') }
function createInjectContext() { throw new Error('TODO: 建立可向上查找的注入上下文') }
function injectValue() { throw new Error('TODO: 沿 parent 链查找并支持 fallback') }
function hasSlot() { throw new Error('TODO: 判断插槽函数是否存在') }
function renderSlot() { throw new Error('TODO: 调用插槽并在空结果时回落') }
function slotNames() { throw new Error('TODO: 返回插槽名列表') }`,
  solution: L2_CODE_3,
  finalCode: L2_CODE_3,
  tests: `${L2S1}\n${L2S2}\n${L2S3}`
}

/* ============================================================ 第 3 关测试 */
const L3S1 = `{
  check('挂载顺序是父 setup、子 setup，然后子 mounted 先于父 mounted', () => {
    const root = createNode('root', [createNode('a')])
    same(mountTree(root), ['setup:root', 'setup:a', 'mounted:a', 'mounted:root'])
    same(root.mountedFlag, true)
  })
  check('多个子组件按声明顺序挂载', () => {
    const root = createNode('root', [createNode('a'), createNode('b')])
    same(mountTree(root), ['setup:root', 'setup:a', 'mounted:a', 'setup:b', 'mounted:b', 'mounted:root'])
  })
  check('卸载顺序是父 beforeUnmount、子解除挂载，最后才轮到父 unmounted', () => {
    const root = createNode('root', [createNode('a')])
    mountTree(root)
    same(unmountTree(root), ['beforeUnmount:root', 'beforeUnmount:a', 'unmounted:a', 'unmounted:root'])
  })
  check('父组件在 beforeUnmount 里还能访问未销毁的子实例', () => {
    const child = createNode('a')
    const root = createNode('root', [child])
    let seen = null
    onNodeBeforeUnmount(root, () => { seen = child.unmountedFlag })
    mountTree(root)
    unmountTree(root)
    same(seen, false, 'beforeUnmount 时机子组件还没被标记卸载')
  })
  check('unmounted 阶段的清理同步执行，不延后到微任务', () => {
    const root = createNode('root', [])
    let cleaned = 0
    onNodeUnmounted(root, () => { cleaned = cleaned + 1 })
    mountTree(root)
    unmountTree(root)
    same(cleaned, 1, 'unmountTree 返回时清理就该完成')
  })
  check('重复卸载不会重复执行清理，也不再产生轨迹', () => {
    const root = createNode('root', [createNode('a')])
    mountTree(root)
    unmountTree(root)
    same(unmountTree(root), [])
    same(root.unmountedFlag, true)
  })
}`

const L3S2 = `{
  check('同 type 加同 key 命中缓存，组件只创建一次', () => {
    const alive = createKeepAlive({})
    let mounts = 0
    const mount = () => { mounts = mounts + 1 }
    const a = alive.render('Comp', 1, mount)
    const b = alive.render('Comp', 1, mount)
    same(a.cached, false)
    same(b.cached, true)
    same(a.id, b.id)
    same(mounts, 1)
    same(alive.keys(), ['Comp#1'])
  })
  check('key 不同就产生新实例', () => {
    const alive = createKeepAlive({})
    let mounts = 0
    const mount = () => { mounts = mounts + 1 }
    const a = alive.render('Comp', 1, mount)
    const b = alive.render('Comp', 2, mount)
    ok(a.id !== b.id, '不同 key 必须是不同实例')
    same(mounts, 2)
    same(alive.size(), 2)
  })
  check('命中记 activated，新建记 created', () => {
    const alive = createKeepAlive({})
    alive.render('Comp', 1, () => {})
    alive.render('Comp', 1, () => {})
    same(alive.log, ['created:Comp', 'activated:Comp'])
  })
  check('超过 max 时淘汰最久未使用的那一个', () => {
    const alive = createKeepAlive({ max: 2 })
    alive.render('A', 1, () => {})
    alive.render('B', 1, () => {})
    alive.render('A', 1, () => {})
    alive.render('C', 1, () => {})
    same(alive.keys(), ['A#1', 'C#1'])
    same(alive.log, ['created:A', 'created:B', 'activated:A', 'created:C', 'pruned:B'])
  })
  check('include 白名单之外的组件不缓存', () => {
    const alive = createKeepAlive({ include: ['Good'] })
    let mounts = 0
    alive.render('Good', 1, () => { mounts = mounts + 1 })
    alive.render('Bad', 1, () => { mounts = mounts + 1 })
    alive.render('Bad', 1, () => { mounts = mounts + 1 })
    same(alive.keys(), ['Good#1'])
    same(mounts, 3)
  })
  check('exclude 黑名单内的组件不缓存，每次都重新创建', () => {
    const alive = createKeepAlive({ exclude: ['Skip'] })
    const a = alive.render('Skip', 1, () => {})
    const b = alive.render('Skip', 1, () => {})
    same(a.cached, false)
    same(b.cached, false)
    ok(a.id !== b.id, '不缓存的组件每次都要重新创建')
    same(alive.size(), 0)
  })
}`

const L3S3 = `{
  check('同一个 pinia 里多次 useStore 返回同一个实例', () => {
    const pinia = createPinia()
    const useCounter = defineStore(pinia, 'counter', () => {
      const count = ref(0)
      const inc = function () { count.value = count.value + 1 }
      return { count: count, inc: inc }
    })
    const a = useCounter()
    const b = useCounter()
    a.inc()
    same(a.count, 1)
    same(b.count, 1)
    ok(a === b, '同一个 store 实例')
    same(a.$id, 'counter')
  })
  check('getter 惰性计算并缓存，state 不变时只算一次', () => {
    const pinia = createPinia()
    let runs = 0
    const useStore = defineStore(pinia, 'double', () => {
      const count = ref(2)
      const double = computed(() => { runs = runs + 1; return count.value * 2 })
      return { count: count, double: double }
    })
    const store = useStore()
    same(runs, 0, '没人读就不该计算')
    same(store.double, 4)
    same(store.double, 4)
    same(runs, 1)
  })
  check('state 变化后 getter 重新计算', () => {
    const pinia = createPinia()
    let runs = 0
    const useStore = defineStore(pinia, 'double2', () => {
      const count = ref(2)
      const double = computed(() => { runs = runs + 1; return count.value * 2 })
      return { count: count, double: double }
    })
    const store = useStore()
    same(store.double, 4)
    store.count = 5
    same(store.double, 10)
    same(runs, 2)
  })
  check('action 直接改 state，$patch 只做合并而不是整体替换', () => {
    const pinia = createPinia()
    const useStore = defineStore(pinia, 'cart', () => {
      const list = ref([])
      const total = ref(0)
      const add = function (item) {
        list.value = list.value.concat(item)
        total.value = total.value + item.price
      }
      return { list: list, total: total, add: add }
    })
    const store = useStore()
    store.add({ name: 'a', price: 3 })
    same(store.total, 3)
    store.$patch({ total: 10 })
    same(store.total, 10)
    same(store.list, [{ name: 'a', price: 3 }])
    same(store.$state.total, 10)
  })
  check('插件在每个 store 初始化时执行一次', () => {
    const pinia = createPinia()
    const inited = []
    pinia.install((store) => { inited.push(store.$id) })
    const useA = defineStore(pinia, 'a', () => { const n = ref(1); return { n: n } })
    const useB = defineStore(pinia, 'b', () => { const n = ref(2); return { n: n } })
    useA(); useA(); useB()
    same(inited, ['a', 'b'])
  })
  check('不同 pinia 实例的 store 互相隔离', () => {
    const p1 = createPinia()
    const p2 = createPinia()
    const setup = () => { const n = ref(0); return { n: n } }
    const a = defineStore(p1, 'iso', setup)()
    const b = defineStore(p2, 'iso', setup)()
    a.n = 9
    same(a.n, 9)
    same(b.n, 0)
    ok(a !== b, '不同 pinia 不能共享 store')
  })
}`

/* ============================================================ 第 3 关代码 */
const L3_CODE_1 = `function createNode(name, children) {
  return {
    name: name,
    children: children || [],
    hooks: { mounted: [], beforeUnmount: [], unmounted: [] },
    mountedFlag: false,
    unmountedFlag: false
  }
}

function onNodeMounted(node, fn) {
  node.hooks.mounted.push(fn)
}

function onNodeBeforeUnmount(node, fn) {
  node.hooks.beforeUnmount.push(fn)
}

function onNodeUnmounted(node, fn) {
  node.hooks.unmounted.push(fn)
}

function mountTree(node, log) {
  const trail = log || []
  trail.push('setup:' + node.name)
  for (const child of node.children) mountTree(child, trail)
  node.mountedFlag = true
  for (const fn of node.hooks.mounted) fn()
  trail.push('mounted:' + node.name)
  return trail
}

function unmountTree(node, log) {
  const trail = log || []
  if (node.unmountedFlag) return trail
  for (const fn of node.hooks.beforeUnmount) fn(node)
  trail.push('beforeUnmount:' + node.name)
  const children = node.children.slice().reverse()
  for (const child of children) unmountTree(child, trail)
  for (const fn of node.hooks.unmounted) fn()
  node.unmountedFlag = true
  trail.push('unmounted:' + node.name)
  return trail
}`

const L3_CODE_2 = L3_CODE_1 + `
function matchName(rule, name) {
  if (!rule) return true
  if (Array.isArray(rule)) return rule.indexOf(name) >= 0
  return rule === name
}

function createKeepAlive(options) {
  const opts = options || {}
  const max = opts.max === undefined ? Infinity : opts.max
  const include = opts.include === undefined ? null : opts.include
  const exclude = opts.exclude === undefined ? null : opts.exclude
  const cache = []
  const log = []
  let seq = 0

  function shouldCache(name) {
    if (exclude && matchName(exclude, name)) return false
    if (include) return matchName(include, name)
    return true
  }

  function findEntry(name, key) {
    for (const entry of cache) {
      if (entry.name === name && entry.key === key) return entry
    }
    return null
  }

  return {
    log: log,
    render(name, key, mount) {
      const k = key === undefined ? 'default' : key
      const hit = findEntry(name, k)
      if (hit) {
        const at = cache.indexOf(hit)
        cache.splice(at, 1)
        cache.push(hit)
        hit.uses = hit.uses + 1
        log.push('activated:' + name)
        return { cached: true, id: hit.id }
      }
      seq = seq + 1
      if (typeof mount === 'function') mount()
      log.push('created:' + name)
      if (!shouldCache(name)) return { cached: false, id: seq }
      cache.push({ name: name, key: k, id: seq, uses: 1 })
      if (cache.length > max) {
        const evicted = cache.shift()
        log.push('pruned:' + evicted.name)
      }
      return { cached: false, id: seq }
    },
    keys() {
      const out = []
      for (const entry of cache) out.push(entry.name + '#' + entry.key)
      return out
    },
    size() {
      return cache.length
    }
  }
}`

const L3_CODE_3 = L3_CODE_2 + `
function ref(initial) {
  return { value: initial }
}

function computed(getter) {
  return { getter: getter, cached: null, value: undefined, runs: 0 }
}

function createPinia() {
  const stores = {}
  const plugins = []
  const pinia = {
    stores: stores,
    plugins: plugins,
    install(plugin) {
      plugins.push(plugin)
      return pinia
    }
  }
  return pinia
}

function defineStore(pinia, id, setup) {
  return function useStore() {
    if (pinia.stores[id]) return pinia.stores[id]
    const store = buildStore(pinia, id, setup)
    pinia.stores[id] = store
    for (const plugin of pinia.plugins) plugin(store, pinia)
    return store
  }
}

function buildStore(pinia, id, setup) {
  const refs = {}
  const getters = {}
  const store = { $id: id, $state: {} }
  const out = setup()
  for (const key of Object.keys(out)) {
    const value = out[key]
    if (value && typeof value.getter === 'function') {
      getters[key] = value
    } else if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'value')) {
      refs[key] = value
    } else if (typeof value === 'function') {
      store[key] = function () {
        return value.apply(store, arguments)
      }
    }
  }

  function fingerprint() {
    const keys = Object.keys(refs).sort()
    const pairs = []
    for (const key of keys) pairs.push([key, refs[key].value])
    return JSON.stringify(pairs)
  }

  for (const key of Object.keys(refs)) {
    const holder = refs[key]
    Object.defineProperty(store, key, {
      enumerable: true,
      get() { return holder.value },
      set(next) { holder.value = next }
    })
    Object.defineProperty(store.$state, key, {
      enumerable: true,
      get() { return holder.value },
      set(next) { holder.value = next }
    })
  }

  for (const key of Object.keys(getters)) {
    const box = getters[key]
    Object.defineProperty(store, key, {
      enumerable: true,
      get() {
        const mark = fingerprint()
        if (box.cached !== mark) {
          box.cached = mark
          box.value = box.getter()
          box.runs = box.runs + 1
        }
        return box.value
      }
    })
  }

  store.$stats = { getters: getters }
  store.$patch = function (partial) {
    const next = partial || {}
    for (const key of Object.keys(next)) {
      if (refs[key]) refs[key].value = next[key]
    }
    return store
  }
  return store
}`

/* ============================================================ 第 3 关 */
const LV3 = {
  id: 'lv3',
  title: '第 3 关 · 生命周期与状态管理',
  emoji: '🌀',
  xp: 80,
  goal: '实现 mountTree / unmountTree 的挂载与卸载顺序、createKeepAlive 的缓存键与 LRU 淘汰、createPinia / defineStore 的 setup store（state、惰性 getter、action、$patch、插件钩子），最后能讲清 Pinia 与 Vuex 的差异。',
  why: '性能问题的现场往往长在生命周期与状态管理上：组件重新进入时状态丢了、KeepAlive 缓存越堆越多、切换页面时定时器没清、Pinia 的 getter 在模板里被重复计算上百次。这些都不是「会不会写」的问题，而是「知不知道顺序与缓存键由谁决定」。本关把挂载与卸载的调用顺序、缓存的匹配与淘汰策略、store 的惰性计算与合并更新全部实现一遍，顺序与缓存就从感觉变成可打印的轨迹。',
  nodes: ['fe.vue.lifecycle', 'fe.vue.lifecycle.keepalive', 'fe.vue.lifecycle.mount-unmount', 'fe.vue.state', 'fe.vue.state.pinia-internals', 'fe.vue.state.pinia-vs-vuex'],
  thinking: [
    {
      title: '挂载是自顶向下建、自底向上报',
      md: '挂载分两段：先父后子地创建并执行 setup（父级需要先存在，子才能拿到插槽与上下文），等整棵子树都挂好了，mounted 再从子往父冒泡上报。所以父组件的 mounted 里能访问子组件的 DOM，反过来不行。\n\n卸载顺序正好镜像：父的 beforeUnmount 先跑（此时子树还活着，适合停定时器），然后子销毁，最后父的 unmounted 收尾。把这条记牢，就不会在 beforeUnmount 里访问已经销毁的 ref。'
    },
    {
      title: 'KeepAlive 的缓存键是组件加 key',
      md: '同一个组件被缓存多次，靠的是 type（组件定义）加 key 组成的缓存键；只换 props 不换 key，命中的还是同一份实例。include / exclude 按组件名过滤，max 超限时按最近最少使用淘汰，淘汰前会先触发 deactivated。\n\n所以「页面缓存了但数据没刷新」通常不是 KeepAlive 坏了，而是 key 没变、命中了旧实例，需要用 activated 钩子主动刷新数据。'
    },
    {
      title: 'Pinia 把 mutations 删掉之后靠什么保证可追踪',
      md: 'Vuex 用 mutation 做「唯一修改入口」，是为了 devtools 能记录每次变更。Pinia 直接在 action 里改 state，靠的是响应式系统加 $patch 的批量提交来生成快照，少了一层样板代码。\n\n代价是「谁能改 state」从机制约束退化为约定，所以团队规范里要写清：跨组件的修改一律走 action，不要在组件里直接 store.count++。'
    }
  ],
  prereq: [
    {
      title: '深度优先遍历与顺序断言',
      md: 'mountTree 与 unmountTree 都是深度优先：前者在递归子节点之后再跑自己的 mounted，后者在递归之前先跑 beforeUnmount。把执行轨迹收集进数组再整体比较，是验证顺序最可靠的方式，比散落的计数器直观得多。\n\n注意同一个函数在递归里必须共用同一个轨迹数组，否则每层都新建数组，顺序就看不出来了。'
    },
    {
      title: '缓存与惰性计算',
      md: 'getter 的缓存要解决「什么时候失效」：本关用 state 的 JSON 指纹做近似判断，state 变了指纹就变，getter 重算；真实 Vue 用依赖收集精确到字段。计算属性没人读就不该算，所以第一次读取之前 runs 应为 0。\n\nLRU 淘汰同样是缓存话题：命中要刷新位置，插入超限才淘汰队首，这两步顺序错了就会淘汰掉刚用过的实例。'
    }
  ],
  api: [
    {
      name: 'mountTree',
      sig: 'mountTree(node, log?) => string[]',
      args: 'node 是由 createNode 建立的组件树节点；log 是可选的轨迹数组，递归中共用同一个。',
      returns: '按发生顺序记录的轨迹数组，形如 setup:root、mounted:a、mounted:root，用来断言挂载顺序。',
      example: 'const root = createNode(\'root\', [createNode(\'a\')])\nmountTree(root)\n// [\'setup:root\', \'setup:a\', \'mounted:a\', \'mounted:root\']'
    },
    {
      name: 'createKeepAlive',
      sig: 'createKeepAlive({ include?, exclude?, max? }) => { render(name, key, mount), keys(), size(), log }',
      args: 'include / exclude 是组件名白名单与黑名单，可传字符串或数组；max 是缓存上限，缺省不限。',
      returns: 'render 命中缓存时返回 { cached: true, id } 并记 activated，新建时调用 mount 并记 created，超限时记 pruned。',
      example: 'const alive = createKeepAlive({ max: 2 })\nalive.render(\'A\', 1, mount)\nalive.render(\'A\', 1, mount)   // cached: true\nalive.keys()                  // [\'A#1\']'
    },
    {
      name: 'defineStore',
      sig: 'defineStore(pinia, id, setup) => useStore() => store',
      args: 'pinia 是 createPinia 的实例；id 是 store 唯一标识；setup 是返回 ref / computed / action 的函数，写法同组件 setup。',
      returns: 'store 暴露每个 state 为可读写属性，getter 惰性求值并按 state 指纹缓存，action 以 store 为 this，另有 $state、$patch、$stats。',
      example: 'const useCounter = defineStore(pinia, \'counter\', () => {\n  const count = ref(0)\n  const double = computed(() => count.value * 2)\n  return { count, double }\n})\nconst store = useCounter()\nstore.count = 3\nstore.double   // 6'
    }
  ],
  usage: '// 组件里的常见组合\nonActivated(() => { refresh() })\nonBeforeUnmount(() => { clearInterval(timer) })\n\n// 本关的模型：\nconst root = createNode(\'page\', [createNode(\'list\')])\nmountTree(root)\nconst alive = createKeepAlive({ max: 5 })\nalive.render(\'List\', routeId, () => {})\nunmountTree(root)',
  hints: [
    '第 1 步：mountTree 先把 setup 记下再递归子节点，递归回来才跑自己的 mounted。',
    '第 1 步：unmountTree 先跑 beforeUnmount 再递归，子节点用 slice().reverse() 遍历。',
    '第 2 步：缓存键是 name 加 key 两个值，命中后要 splice 再 push，把位置刷成最新。',
    '第 2 步：只有「插入新缓存」之后才判断是否超限，且淘汰发生在 push 之后。',
    '第 3 步：区分返回值的三种形态——有 getter 字段的是 computed，有 value 字段的是 ref，函数是 action。',
    '第 3 步：getter 的缓存标记用 state 的 JSON 指纹，指纹相同就返回上次的值，不要每次重算。'
  ],
  concepts: [
    {
      title: 'Pinia 与 Vuex 的四个差异',
      md: '第一，mutation 没了：Vuex 强制 mutation 才能改 state，Pinia 允许 action 直接改，少了样板也少了机制约束。第二，模块不需要命名空间：Pinia 每个 store 独立定义，用起来直接 import，不存在 modules 嵌套。第三，类型推导：setup 写法让 state、getter、action 的类型自动推出，Vuex 要手写大量类型声明。第四，体积与心智：Pinia 更小，且没有 mutation 这一层概念，新项目几乎没有理由再选 Vuex。'
    },
    {
      title: 'KeepAlive 的三个坑',
      md: '一是缓存键不含 props：只改 props 不换 key，命中旧实例，数据看起来没更新；二是 include 匹配的是组件名，用 setup 语法且没写 name 的组件会匹配不上；三是 max 淘汰是静默的，被淘汰的组件下次进入会重新经历 created，若在 created 里发请求就会表现为「偶发重复请求」。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '挂载自上而下，卸载自下而上',
      think: '先把挂载与卸载的调用顺序固定下来：创建阶段父先子后，mounted 子先父后；卸载阶段 beforeUnmount 父先子后，unmounted 子先父后。顺序定错了，清理逻辑的时机就全错。',
      hint: '递归时共用一个轨迹数组；unmountTree 用 unmountedFlag 挡住重复调用。',
      code: L3_CODE_1,
      test: L3S1,
      diag: [
        'mounted 跑在了子节点递归之前，轨迹里父组件排到了子组件前面。',
        'setup 轨迹记在了递归之后，顺序变成了子先父后。',
        '卸载时先递归子节点再跑 beforeUnmount，导致父组件拿不到活着的子实例。',
        'unmounted 轨迹在子节点之前就记录了，子组件的卸载没被包含。',
        '没有 unmountedFlag 挡重复调用，第二次卸载又跑了一遍清理。',
        '递归时每个节点新建了轨迹数组，最后只看到最后一个节点的记录。'
      ]
    },
    {
      n: 2,
      title: 'KeepAlive 的缓存键与淘汰策略',
      think: '缓存要回答两个问题：拿什么当键、满了淘汰谁。键是组件名加 key，淘汰是最久未用——命中时要先刷新位置，否则最近用过的实例反而先被踢掉。',
      hint: '命中就先 splice 再 push；插入新条目后判断 cache.length 是否超过 max。',
      code: L3_CODE_2,
      test: L3S2,
      diag: [
        '缓存键只用了组件名，换 key 之后仍然命中旧实例。',
        '命中缓存后没有刷新位置，LRU 淘汰的其实是刚用过的实例。',
        '先判断超限再 push，导致缓存永远停在 max 减一。',
        'include 的判断写反了，白名单里的组件反而没有被缓存。',
        'exclude 命中后仍然 push 进了缓存，黑名单失效。',
        '不缓存的组件复用了自增前的 id，看起来像命中缓存。'
      ]
    },
    {
      n: 3,
      title: 'Pinia 的 setup store',
      think: 'Pinia 的 setup store 就是把组件的 setup 挪进 store：返回 ref 是 state，返回 computed 是 getter，返回函数是 action。要点在 getter 的惰性缓存和 $patch 的合并语义。',
      hint: '用 hasOwnProperty 判断 value 字段区分 ref；getter 缓存用 state 的 JSON 指纹。',
      code: L3_CODE_3,
      test: L3S3,
      diag: [
        'getter 在定义时就被调用了，第一次读取之前 runs 就已经是 1。',
        'getter 完全没有缓存，每读一次指纹都重算一遍。',
        'state 变化后 getter 仍返回旧值，指纹没有把变化的引用算进去。',
        '把 action 直接赋给 store，调用时 this 丢失，action 里读不到 state。',
        '插件在 store 已经存在之后才执行，初始化的钩子漏掉了。',
        '不同 pinia 共用了同一个 stores 表，两个应用的 store 互相串数据。'
      ]
    }
  ],
  skeleton: `function createNode() { throw new Error('TODO: 建立带钩子队列的组件树节点') }
function mountTree() { throw new Error('TODO: 深度优先挂载并按冒泡顺序跑 mounted') }
function unmountTree() { throw new Error('TODO: 先 beforeUnmount 再递归卸载子节点') }
function createKeepAlive() { throw new Error('TODO: 实现按 name 与 key 的缓存和 LRU 淘汰') }
function createPinia() { throw new Error('TODO: 返回带安装插件能力的 pinia 实例') }
function defineStore() { throw new Error('TODO: 返回惰性创建且带插件的 useStore') }
function buildStore() { throw new Error('TODO: 把 setup 返回值拆成 state / getter / action') }
function computed() { throw new Error('TODO: 返回带缓存标记的 getter 盒子') }
function ref() { throw new Error('TODO: 返回 { value } 的最小型响应式盒子') }`,
  solution: L3_CODE_3,
  finalCode: L3_CODE_3,
  tests: `${L3S1}\n${L3S2}\n${L3S3}`
}

export default {
  id: 'fe-vue-2',
  version: 3,
  domain: 'fe',
  cumulative: false,
  title: 'Vue3 三关：实例代理、组件通信、生命周期与状态',
  emoji: '💚',
  tagline: '用 JS 数据模型模拟 Vue3 的 setup 代理、props / emit / 插槽、KeepAlive 缓存与 Pinia store。',
  stack: ['Vue3', 'Composition API', 'Pinia', 'KeepAlive', 'JavaScript'],
  intro: '这个项目不写真实 Vue 组件，而是用纯 JS 把 Vue3 的运行时机制搭成能跑的数据模型：第一关拆 setup 的执行时机、实例代理与钩子顺序，第二关拆 props 校验、emit 声明、attrs 透传、expose、provide/inject 与插槽，第三关拆 mount/unmount 流程、KeepAlive 的 LRU 缓存与 Pinia 的 setup store。每一处简化都写在关卡正文里，读的时候可以对照真实源码。做完你会理解面试官追问的那些「顺序」和「时机」到底由谁决定。',
  outcome: '能不看文档说清 setup 的返回值如何变成实例代理、父子钩子的执行顺序、props 与 attrs 的分流规则、KeepAlive 的缓存键与淘汰策略、Pinia getters 为什么需要缓存。写完这三关，Vue3 相关的追问基本都能落到具体代码上，而不是停在「响应式原理」四个字。',
  levels: [LV1, LV2, LV3]
}