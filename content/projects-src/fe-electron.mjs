/**
 * fe-electron：Electron 桌面端三个关卡。
 *
 * 三个模拟器都跑在判题沙箱里：没有 require / process / 定时器 / DOM，
 * 所以进程是假的、时间是调用方注入的、序列化只检查普通对象。
 * 每关的第三关代码即整关参考解（solution / finalCode）。
 */

/* ============================================================ 第 1 关测试 */
const L1S1 = `{
  check('白名单内的通道按发送顺序入队', () => {
    const r = createRouter(['app:ping', 'win:resize'])
    r.send('app:ping', { n: 1 })
    r.send('win:resize', { w: 800 })
    same(r.size(), 2)
    same(r.drain().map((m) => m.channel), ['app:ping', 'win:resize'])
  })
  check('未登记的通道直接抛错，且不会污染队列', () => {
    const r = createRouter(['app:ping'])
    throws(() => r.send('fs:read', { path: 'C:/secret.txt' }))
    same(r.size(), 0)
  })
  check('drain 之后队列清空，再取一次得到空数组', () => {
    const r = createRouter(['app:ping'])
    r.send('app:ping', 1)
    same(r.drain().length, 1)
    same(r.drain(), [])
    same(r.size(), 0)
  })
  check('send 返回入队之后的队列长度', () => {
    const r = createRouter(['a', 'b'])
    same(r.send('a', 1), 1)
    same(r.send('b', 2), 2)
  })
  check('通配符只放行前缀匹配的通道', () => {
    const r = createRouter(['win:*'])
    same(r.send('win:resize', 1), 1)
    throws(() => r.send('shell:exec', 'rm -rf /'))
    same(r.size(), 1)
  })
  check('contextBridge 只暴露白名单里的函数', () => {
    const api = { ping: () => 'pong' }
    const bridge = exposeBridge(api, ['ping'])
    same(Object.keys(bridge), ['ping'])
    ok(typeof bridge.ping === 'function')
    throws(() => exposeBridge(api, []))
    throws(() => exposeBridge({ ping: 1 }, ['ping']))
  })
}`

const L1S2 = `{
  check('窗口从 created 开始，轨迹里只有初始状态', () => {
    const w = createWindowFSM()
    same(w.state(), 'created')
    same(w.trail(), ['created'])
  })
  check('合法的显示链路能逐步迁移到 shown', () => {
    const w = createWindowFSM()
    w.fire('ready')
    w.fire('shown')
    same(w.state(), 'shown')
    same(w.trail(), ['created', 'ready', 'shown'])
  })
  check('非法迁移抛错，状态保持原样', () => {
    const w = createWindowFSM()
    throws(() => w.fire('shown'))
    same(w.state(), 'created')
    same(w.can('shown'), false)
  })
  check('关闭后进入 destroyed，吸收态不能再显示', () => {
    const w = createWindowFSM()
    w.fire('ready')
    w.fire('closed')
    same(w.state(), 'destroyed')
    same(w.can('shown'), false)
    throws(() => w.fire('shown'))
  })
}`

const L1S3 = `{
  check('没有注册处理器的通道返回 E_NO_HANDLER', () => {
    const bus = createIpcBus()
    const res = bus.invoke('win:close', {})
    same(res.ok, false)
    same(res.code, 'E_NO_HANDLER')
    same(res.requestId, 'req-1')
  })
  check('同步处理的返回值按 requestId 配对', () => {
    const bus = createIpcBus()
    bus.handle('app:version', () => '1.2.3')
    const a = bus.invoke('app:version', {})
    const b = bus.invoke('app:version', {})
    same(a.ok, true)
    same(a.value, '1.2.3')
    same(b.value, '1.2.3')
    notSame(a.requestId, b.requestId)
  })
  check('处理器抛出的错误转成拒绝，不穿透到调用方', () => {
    const bus = createIpcBus()
    bus.handle('fs:read', () => { throw new Error('EACCES') })
    const res = bus.invoke('fs:read', {})
    same(res.ok, false)
    same(res.code, 'E_REMOTE')
    same(res.message, 'EACCES')
  })
  check('延迟模式先返回 pending，respond 之后才算完成', () => {
    const bus = createIpcBus()
    bus.handle('dialog:open', () => 'ignored')
    const res = bus.invoke('dialog:open', {}, { defer: true, now: 0, timeout: 100 })
    same(res.pending, true)
    same(bus.pendingCount(), 1)
    const done = bus.respond(res.requestId, 'file.txt')
    same(done.ok, true)
    same(done.value, 'file.txt')
    same(bus.pendingCount(), 0)
  })
  check('超时的请求按 due 被拒绝并移出 pending', () => {
    const bus = createIpcBus()
    bus.handle('net:fetch', () => null)
    const res = bus.invoke('net:fetch', {}, { defer: true, now: 100, timeout: 50 })
    same(bus.expire(149), [])
    const timedOut = bus.expire(150)
    same(timedOut.length, 1)
    same(timedOut[0].code, 'E_TIMEOUT')
    same(bus.pendingCount(), 0)
  })
  check('对未知 requestId 的 respond 返回 E_UNKNOWN_REQUEST', () => {
    const bus = createIpcBus()
    const res = bus.respond('req-99', 1)
    same(res.ok, false)
    same(res.code, 'E_UNKNOWN_REQUEST')
  })
}`

/* ============================================================ 第 1 关代码 */
const L1C1 = `function matchChannel(pattern, channel) {
  if (pattern === channel) return true
  if (pattern.slice(-1) === '*' && channel.indexOf(pattern.slice(0, -1)) === 0) return true
  return false
}

function createRouter(allowed) {
  const queue = []

  return {
    send(channel, payload) {
      let blocked = true
      for (let i = 0; i < allowed.length; i += 1) {
        if (matchChannel(allowed[i], channel)) { blocked = false; break }
      }
      if (blocked) throw new Error('channel blocked: ' + channel)
      queue.push({ channel: channel, payload: payload })
      return queue.length
    },
    size() {
      return queue.length
    },
    drain() {
      const out = queue.slice()
      queue.length = 0
      return out
    }
  }
}

function exposeBridge(api, allowedKeys) {
  const out = {}
  const keys = Object.keys(api)
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i]
    if (allowedKeys.indexOf(key) === -1) throw new Error('bridge key not allowed: ' + key)
    if (typeof api[key] !== 'function') throw new Error('bridge value must be a function: ' + key)
    out[key] = api[key]
  }
  return out
}`

const L1C2 = `${L1C1}

const WINDOW_EDGES = {
  created: { ready: 'ready', closed: 'destroyed' },
  ready: { shown: 'shown', closed: 'destroyed' },
  shown: { hidden: 'hidden', closed: 'destroyed' },
  hidden: { shown: 'shown', closed: 'destroyed' },
  destroyed: {}
}

function createWindowFSM() {
  let state = 'created'
  const trail = ['created']

  return {
    state() {
      return state
    },
    can(event) {
      const row = WINDOW_EDGES[state]
      return Boolean(row && row[event])
    },
    fire(event) {
      const row = WINDOW_EDGES[state]
      if (!row || !row[event]) throw new Error('illegal transition: ' + state + ' + ' + event)
      state = row[event]
      trail.push(state)
      return state
    },
    trail() {
      return trail.slice()
    }
  }
}`

const L1C3 = `${L1C2}

function createIpcBus() {
  const handlers = {}
  const pending = {}
  let seq = 0

  return {
    handle(channel, fn) {
      handlers[channel] = fn
      return true
    },
    invoke(channel, payload, options) {
      seq += 1
      const requestId = 'req-' + seq
      const opts = options || {}
      const fn = handlers[channel]
      if (!fn) return { requestId: requestId, ok: false, code: 'E_NO_HANDLER' }
      if (opts.defer === true) {
        pending[requestId] = { channel: channel, due: opts.now + opts.timeout }
        return { requestId: requestId, ok: true, pending: true }
      }
      try {
        const value = fn(payload)
        return { requestId: requestId, ok: true, value: value }
      } catch (err) {
        return { requestId: requestId, ok: false, code: 'E_REMOTE', message: String(err.message) }
      }
    },
    respond(requestId, value) {
      if (!pending[requestId]) return { requestId: requestId, ok: false, code: 'E_UNKNOWN_REQUEST' }
      delete pending[requestId]
      return { requestId: requestId, ok: true, value: value }
    },
    fail(requestId, message) {
      if (!pending[requestId]) return { requestId: requestId, ok: false, code: 'E_UNKNOWN_REQUEST' }
      delete pending[requestId]
      return { requestId: requestId, ok: false, code: 'E_REMOTE', message: String(message) }
    },
    expire(now) {
      const out = []
      const ids = Object.keys(pending)
      for (let i = 0; i < ids.length; i += 1) {
        if (now >= pending[ids[i]].due) {
          delete pending[ids[i]]
          out.push({ requestId: ids[i], ok: false, code: 'E_TIMEOUT' })
        }
      }
      return out
    },
    pendingCount() {
      return Object.keys(pending).length
    }
  }
}`

/* ============================================================ 第 1 关 */
const LV1 = {
  id: 'lv1',
  title: '进程边界：IPC 路由与窗口状态机',
  emoji: '🔌',
  xp: 40,
  goal: '用纯函数实现三件事：带通配符白名单的 IPC 路由队列、窗口生命周期状态机、带 requestId 与超时表的 invoke/handle 配对。',
  why: '跨进程调用的每次事故都能追到边界没定义：白名单缺失时任意页面脚本都能给主进程发命令；窗口状态没有迁移表时 show 与 close 会互相踩踏；requestId 缺失时两个并发 invoke 的响应会张冠李戴；contextBridge 暴露过多则等于把 Node 能力直接递给页面。把这几张表亲手写一遍，比背十遍 API 文档更能回答「Electron 为什么不安全」。',
  nodes: [
    'fe.electron.process',
    'fe.electron.process.model',
    'fe.electron.ipc.channels',
    'fe.electron.security',
    'fe.electron.security.csp'
  ],
  thinking: [
    {
      title: '把跨进程调用还原成三张表',
      md: 'IPC 看起来是「发消息」，实际是三个数据结构：**允许表**（哪些通道可以被谁调用）、**队列**（消息按什么顺序被消费）、**请求表**（每个待返回的调用对应哪个 requestId）。\n\n模拟器刻意简化了两件事：进程是假的（没有真的子进程，只是函数调用），时间是注入的（`expire(now)` 由调用方推进），所以序列化边界也只检查「是不是普通对象」，不模拟 structured clone 的完整算法。'
    },
    {
      title: '非法迁移必须抛错，而不是静默忽略',
      md: '真实 Electron 里窗口状态由 BrowserWindow 的事件驱动，你很少显式写迁移表；但一旦引入「重试显示」「关闭时取消加载」这类逻辑，隐式状态就会打架。\n\n所以这里把它变成显式表：`created -> ready -> shown -> hidden -> shown`，`closed` 任意状态都能进 `destroyed`，而 `destroyed` 是吸收态。非法事件直接抛错——**让 bug 在第一次出现时就炸，而不是三天后变成白屏**。'
    },
    {
      title: 'requestId 是配对的唯一凭据',
      md: '`invoke` 不是同步函数调用：响应可能几毫秒后回来，也可能永远不回来。没有 requestId，你无法知道回来的值是哪个请求的；没有 pending 表和 due 时间，超时请求会一直占着内存。\n\n模拟器用 `respond(requestId)` 手动兑现响应、用 `expire(now)` 手动推进超时，正是为了让你看清：**配对靠 id，超时靠时间表**。'
    }
  ],
  prereq: [
    {
      title: '闭包保存跨调用状态',
      md: '路由队列、窗口当前状态、pending 请求表都必须活在两次调用之间。用闭包或者对象上的私有字段保存，不要用模块级变量——同一个页面可能同时开两个窗口，它们的状态必须互不干扰。\n\n```js\nfunction createCounter() {\n  let n = 0\n  return { inc() { n += 1; return n } }\n}\n```\n\n本关三个工厂函数都靠这个模式：状态在闭包里，外部只能通过返回的方法观察和推进。'
    },
    {
      title: '结构化克隆的边界',
      md: '主进程与渲染进程之间传的不是引用，而是拷贝：函数、Symbol、DOM 节点都过不去，Date 与 Map 会变成拷贝后的新对象。所以暴露 API 时必须只传函数引用（由 contextBridge 代理），传数据时只用可序列化的普通对象。\n\n真实 IPC 里传一个函数会直接抛 DataCloneError，这就是为什么 preload 只暴露 `invoke` 包装函数，而不是把 ipcRenderer 整个对象扔给页面。'
    }
  ],
  api: [
    {
      name: 'createRouter',
      sig: 'createRouter(allowed: string[]) => { send(channel, payload), size(), drain() }',
      args: 'allowed 是通道模式数组，既支持精确名（app:ping），也支持前缀通配（win:*）；send 的 payload 是任意可序列化数据。',
      returns: 'send 返回入队后的队列长度，通道不在白名单时抛错；drain 返回全部消息并清空队列；size 返回当前长度。',
      example: 'const r = createRouter(["app:ping", "win:*"])\nr.send("win:resize", { w: 800 })\nr.drain()\n// [{ channel: "win:resize", payload: { w: 800 } }]'
    },
    {
      name: 'createWindowFSM',
      sig: 'createWindowFSM() => { state(), can(event), fire(event), trail() }',
      args: '无需参数，初始状态固定为 created；event 是 ready / shown / hidden / closed 之一。',
      returns: 'state 返回当前状态；can 返回该事件是否合法；fire 执行迁移并返回新状态，非法迁移抛错；trail 返回状态轨迹的副本。',
      example: 'const w = createWindowFSM()\nw.fire("ready")\nw.fire("shown")\nw.state()\n// "shown"'
    },
    {
      name: 'createIpcBus',
      sig: 'createIpcBus() => { handle(channel, fn), invoke(channel, payload, options), respond(id, value), fail(id, msg), expire(now), pendingCount() }',
      args: 'handle 注册处理器；invoke 的 options 支持 { defer, now, timeout }，defer 为 true 时只登记 pending；expire 接收调用方注入的虚拟时间。',
      returns: 'invoke 返回 { requestId, ok, value } 或 { requestId, ok: false, code }；respond 返回兑现结果；expire 返回本次超时的请求数组。',
      example: 'const bus = createIpcBus()\nbus.handle("app:version", () => "1.2.3")\nconst res = bus.invoke("app:version", {})\nres.value\n// "1.2.3"'
    }
  ],
  usage: 'preload 里只暴露白名单函数：\n```js\nconst api = { ping: () => ipcRenderer.invoke("app:ping") }\ncontextBridge.exposeInMainWorld("api", exposeBridge(api, ["ping"]))\n```\n主进程侧用 createIpcBus 登记 handler，渲染进程每次 invoke 都拿回自己的 requestId；窗口创建后按状态机推进 ready -> shown，关闭时统一走 closed 进入 destroyed。',
  hints: [
    '第 1 步先写 matchChannel 与队列：send 里遍历 allowed 判断，drain 用 slice 再清零。',
    '第 2 步把迁移表写成对象套对象，fire 里先查表再改 state，非法时抛错且不要先改 state。',
    '第 3 步 requestId 用自增序号生成，只有 defer 时才写进 pending；expire 遍历 pending 的 due。'
  ],
  concepts: [
    {
      title: 'contextBridge 不是万能胶',
      md: 'contextBridge 只能代理函数与可序列化的值，它不会替你做权限判断。暴露面越窄越好：一个 ping、一个只读的系统信息查询，比暴露整个 ipcRenderer 安全得多。白名单要在 preload 里硬编码，不要从页面传来的字符串里拼。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '通道白名单与消息队列',
      think: '先让「发消息」跑起来：通道匹配、入队、按顺序取出。注意 send 必须先判断再入队，抛错不能留下半条消息；drain 要先把数组抄走再清空，否则调用方拿到的是同一个引用。',
      hint: 'matchChannel 处理精确名与末尾星号；send 遍历 allowed，命中才 push。',
      code: L1C1,
      test: L1S1,
      diag: [
        'matchChannel 没有处理末尾的星号，通配规则完全失效。',
        'send 里先 push 再判断白名单，被拦截的消息留在了队列里。',
        'queue.push 写成了 unshift，drain 出来的顺序和发送顺序相反。',
        'drain 只 slice 没清空队列，第二次调用还能取到旧消息。',
        '通配符用 includes 判断，shell:exec 被错误放行。',
        'exposeBridge 遍历了白名单而不是 api 的键，或者没有校验函数类型。'
      ]
    },
    {
      n: 2,
      title: '窗口生命周期状态机',
      think: '把窗口状态写成显式表：有哪些合法边、哪些是非法边、哪个是吸收态。fire 里一定先查表再改 state，否则非法事件也会把状态改脏；trail 返回副本，避免外部改坏历史。',
      hint: 'WINDOW_EDGES 是状态到事件的二维表；can 只查表，fire 查表后迁移。',
      code: L1C2,
      test: L1S2,
      diag: [
        '迁移表里漏了 closed 边，关闭窗口变成非法操作。',
        'fire 先把 state 改掉再查表，非法迁移后状态已经脏了。',
        'destroyed 没有做成吸收态，关闭后还能被 shown 拉回来。',
        'trail 直接返回内部数组，外部修改会污染状态历史。'
      ]
    },
    {
      n: 3,
      title: 'invoke/handle 与超时配对',
      think: '补齐请求响应：requestId 配对、defer 的 pending 表、处理器抛错转拒绝、按 due 超时。同步与延迟是两条路径，但 requestId 必须在两条路径上都先生成，否则 respond 找不到目标。',
      hint: '先自增生成 requestId，再判断 handler 与 defer；respond 与 fail 都要 delete pending。',
      code: L1C3,
      test: L1S3,
      diag: [
        'requestId 的自增放进了 defer 分支，同步调用拿不到 id。',
        '没有处理器时返回了 ok: true，把错误变成了成功响应。',
        '处理器抛错没有 try/catch，异常直接穿透 invoke。',
        'defer 分支没有写进 pending，respond 永远找不到请求。',
        'expire 用 now > due 判断，边界时间点永远不超时。',
        'respond 成功后没有 delete，pendingCount 一直不归零。'
      ]
    }
  ],
  skeleton: `function createRouter(allowed) {
  // TODO: 白名单匹配（含前缀通配）、FIFO 队列、drain 清空
  throw new Error('createRouter 还没实现')
}`,
  solution: L1C3,
  finalCode: L1C3,
  tests: `${L1S1}\n${L1S2}\n${L1S3}`
}

/* ============================================================ 第 2 关测试 */
const L2S1 = `{
  check('CSP 头被解析成指令表', () => {
    const p = parseCsp("default-src 'self'; script-src 'self' https://cdn.example.com; object-src 'none'")
    same(p['default-src'], ["'self'"])
    same(p['script-src'].length, 2)
    same(p['object-src'], ["'none'"])
  })
  check('未声明的指令回落到 default-src', () => {
    const p = parseCsp("default-src 'self'")
    same(checkCsp(p, { directive: 'img-src', origin: 'https://a.com', sameOrigin: false }), 'block')
    same(checkCsp(p, { directive: 'img-src', origin: 'https://a.com', sameOrigin: true }), 'allow')
  })
  check('带匹配 nonce 的内联脚本放行', () => {
    const p = parseCsp("script-src 'nonce-abc123'")
    same(checkCsp(p, { directive: 'script-src', inline: true, nonce: 'abc123' }), 'allow')
  })
  check('存在 nonce 时 unsafe-inline 失效', () => {
    const p = parseCsp("script-src 'unsafe-inline' 'nonce-abc123'")
    same(checkCsp(p, { directive: 'script-src', inline: true }), 'block')
    same(checkCsp(p, { directive: 'script-src', inline: true, nonce: 'wrong' }), 'block')
  })
  check('外链资源必须命中源列表或 self', () => {
    const p = parseCsp("script-src 'self' https://cdn.example.com")
    same(checkCsp(p, { directive: 'script-src', origin: 'https://evil.com', sameOrigin: false }), 'block')
    same(checkCsp(p, { directive: 'script-src', origin: 'https://cdn.example.com', sameOrigin: false }), 'allow')
  })
  check('完全空的策略一律拦截', () => {
    same(checkCsp({}, { directive: 'script-src', origin: 'https://a.com' }), 'block')
    same(Object.keys(parseCsp('')).length, 0)
  })
}`

const L2S2 = `{
  check('四项安全开关全开时满分且没有告警', () => {
    const r = rateSecurity({ nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true })
    same(r.score, 100)
    same(r.level, 'safe')
    same(r.issues, [])
  })
  check('关闭 sandbox 会掉档并给出告警', () => {
    const r = rateSecurity({ nodeIntegration: false, contextIsolation: true, sandbox: false, webSecurity: true })
    same(r.score, 70)
    same(r.level, 'risky')
    same(r.issues.length, 1)
  })
  check('打开 nodeIntegration 会压分并写进 issues', () => {
    const r = rateSecurity({ nodeIntegration: true, contextIsolation: true, sandbox: true, webSecurity: true })
    same(r.score, 80)
    same(r.level, 'risky')
    ok(r.issues[0].indexOf('nodeIntegration') !== -1)
  })
  check('白名单内的 https 导航放行，未知域名归为 external', () => {
    same(classifyNavigation('https://app.example.com/settings', ['app.example.com']), 'allow')
    same(classifyNavigation('https://docs.example.com/a', ['app.example.com']), 'external')
  })
  check('file 与自定义协议一律拦截', () => {
    same(classifyNavigation('file:///C:/secret.txt', ['app.example.com']), 'block')
    same(classifyNavigation('javascript:alert(1)', ['app.example.com']), 'block')
  })
  check('通配符子域可放行，弹窗默认拒绝', () => {
    same(classifyNavigation('https://a.example.com/x', ['*.example.com']), 'allow')
    same(isPopupAllowed('https://a.example.com/x', ['*.example.com']), false)
    same(isPopupAllowed('https://a.example.com/x', ['*.example.com'], { allowPopups: true }), true)
  })
}`

const L2S3 = `{
  check('asar 清单按规则剔除测试与 sourcemap', () => {
    const files = ['src/main.js', 'src/main.js.map', 'test/main.spec.js', 'node_modules/x/index.js', 'package.json']
    const manifest = buildAsarManifest(files, ['test/**', 'node_modules/**', 'src/main.js.map'])
    same(manifest, ['package.json', 'src/main.js'])
  })
  check('asar 清单按路径字典序输出，保证构建可复现', () => {
    same(buildAsarManifest(['b.js', 'a.js', 'c/a.js'], []), ['a.js', 'b.js', 'c/a.js'])
  })
  check('发布链只能逐级前进到 published', () => {
    same(advanceRelease('built', 'signed'), 'signed')
    same(advanceRelease('signed', 'notarized'), 'notarized')
    same(advanceRelease('notarized', 'published'), 'published')
  })
  check('跳步迁移抛错，失败后允许回到构建', () => {
    throws(() => advanceRelease('built', 'published'))
    throws(() => advanceRelease('published', 'signed'))
    same(advanceRelease('built', 'failed'), 'failed')
    same(advanceRelease('failed', 'built'), 'built')
  })
  check('版本号按数字段比较而不是字典序', () => {
    same(compareVersions('1.10.0', '1.9.0'), 1)
    same(compareVersions('1.0.0', '1.0'), 0)
    same(compareVersions('2.0.0', '10.0.0'), -1)
  })
  check('未签名拒绝更新，基线匹配才给差分包', () => {
    const delta = decideUpdate({ current: '1.4.0', latest: '1.5.0', deltaBase: '1.4.0', deltaSize: 3, fullSize: 10, signed: true })
    same(delta.action, 'install')
    same(delta.mode, 'delta')
    same(delta.size, 3)
    const full = decideUpdate({ current: '1.4.0', latest: '1.5.0', deltaBase: '1.3.0', deltaSize: 3, fullSize: 10, signed: true })
    same(full.mode, 'full')
    const blocked = decideUpdate({ current: '1.4.0', latest: '1.5.0', signed: false })
    same(blocked.action, 'blocked')
  })
}`

/* ============================================================ 第 2 关代码 */
const L2C1 = `function parseCsp(header) {
  const policy = {}
  const parts = String(header).split(';')
  for (let i = 0; i < parts.length; i += 1) {
    const tokens = parts[i].trim().split(/\\s+/)
    const name = tokens[0]
    if (!name) continue
    policy[name] = tokens.slice(1)
  }
  return policy
}

function checkCsp(policy, req) {
  const sources = policy[req.directive] || policy['default-src'] || []
  if (sources.length === 0) return 'block'
  const nonces = []
  const hashes = []
  for (let i = 0; i < sources.length; i += 1) {
    const src = sources[i]
    if (src.indexOf("'nonce-") === 0) nonces.push(src.slice(7, -1))
    else if (src.indexOf("'sha256-") === 0 || src.indexOf("'sha384-") === 0 || src.indexOf("'sha512-") === 0) hashes.push(src.slice(1, -1))
  }
  if (req.inline === true) {
    if (nonces.length > 0 || hashes.length > 0) {
      if (req.nonce && nonces.indexOf(req.nonce) !== -1) return 'allow'
      if (req.hash && hashes.indexOf(req.hash) !== -1) return 'allow'
      return 'block'
    }
    return sources.indexOf("'unsafe-inline'") !== -1 ? 'allow' : 'block'
  }
  if (sources.indexOf('*') !== -1) return 'allow'
  for (let i = 0; i < sources.length; i += 1) {
    const src = sources[i]
    if (src === "'self'" && req.sameOrigin === true) return 'allow'
    if (req.origin && src === req.origin) return 'allow'
  }
  return 'block'
}`

const L2C2 = `${L2C1}

function rateSecurity(flags) {
  const f = flags || {}
  const issues = []
  let score = 0
  if (f.nodeIntegration === true) {
    issues.push('nodeIntegration 打开后页面脚本可以直接拿到 require')
  } else {
    score += 20
  }
  if (f.contextIsolation === true) {
    score += 40
  } else {
    issues.push('contextIsolation 关闭后 preload 与页面共享同一个全局对象')
  }
  if (f.sandbox === true) {
    score += 30
  } else {
    issues.push('sandbox 关闭后渲染进程仍可访问部分 Node 能力')
  }
  if (f.webSecurity === false) {
    issues.push('webSecurity 关闭会同时放过同源策略与证书校验')
  } else {
    score += 10
  }
  const level = score === 100 ? 'safe' : (score >= 70 ? 'risky' : 'unsafe')
  return { score: score, level: level, issues: issues }
}

function parseTarget(url) {
  const text = String(url)
  const sep = text.indexOf('://')
  if (sep <= 0 || sep > 12) return { protocol: '', host: '', path: text }
  const protocol = text.slice(0, sep).toLowerCase()
  const rest = text.slice(sep + 3)
  const slash = rest.indexOf('/')
  const host = (slash === -1 ? rest : rest.slice(0, slash)).toLowerCase()
  const path = slash === -1 ? '/' : rest.slice(slash)
  return { protocol: protocol, host: host, path: path }
}

function hostAllowed(host, allowlist) {
  for (let i = 0; i < allowlist.length; i += 1) {
    const rule = String(allowlist[i]).toLowerCase()
    if (rule === host) return true
    if (rule.indexOf('*.') === 0 && host.slice(-(rule.length - 1)) === rule.slice(1)) return true
  }
  return false
}

function classifyNavigation(url, allowlist) {
  const target = parseTarget(url)
  if (target.protocol !== 'https') return 'block'
  if (hostAllowed(target.host, allowlist)) return 'allow'
  return 'external'
}

function isPopupAllowed(url, allowlist, options) {
  const opts = options || {}
  if (opts.allowPopups !== true) return false
  return classifyNavigation(url, allowlist) === 'allow'
}`

const L2C3 = `${L2C2}

function matchIgnore(file, patterns) {
  for (let i = 0; i < patterns.length; i += 1) {
    const rule = patterns[i]
    if (rule.slice(-3) === '/**') {
      const base = rule.slice(0, -3)
      if (file === base || file.indexOf(base + '/') === 0) return true
    } else if (file === rule) {
      return true
    }
  }
  return false
}

function buildAsarManifest(files, patterns) {
  const keep = []
  const rules = patterns || []
  for (let i = 0; i < files.length; i += 1) {
    const file = String(files[i])
    if (!matchIgnore(file, rules)) keep.push(file)
  }
  return keep.sort()
}

const RELEASE_EDGES = {
  built: { signed: 'signed', failed: 'failed' },
  signed: { notarized: 'notarized', failed: 'failed' },
  notarized: { published: 'published', failed: 'failed' },
  published: {},
  failed: { built: 'built' }
}

function advanceRelease(state, event) {
  const row = RELEASE_EDGES[state]
  if (!row || !row[event]) throw new Error('illegal release transition: ' + state + ' + ' + event)
  return row[event]
}

function compareVersions(a, b) {
  const pa = String(a).split('.')
  const pb = String(b).split('.')
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i += 1) {
    const x = Number(pa[i] || 0)
    const y = Number(pb[i] || 0)
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}

function decideUpdate(req) {
  const r = req || {}
  if (compareVersions(r.latest || '0.0.0', r.current || '0.0.0') <= 0) {
    return { action: 'none', mode: 'none', version: r.current }
  }
  if (r.signed !== true) {
    return { action: 'blocked', mode: 'none', version: r.latest, reason: 'update must be signed' }
  }
  const canDelta = r.deltaBase === r.current && typeof r.deltaSize === 'number' && r.deltaSize < r.fullSize * 0.6
  return {
    action: 'install',
    mode: canDelta ? 'delta' : 'full',
    version: r.latest,
    size: canDelta ? r.deltaSize : r.fullSize
  }
}`

/* ============================================================ 第 2 关 */
const LV2 = {
  id: 'lv2',
  title: '安全与分发：CSP、开关评级与发布门禁',
  emoji: '🛡️',
  xp: 50,
  goal: '实现 parseCsp/checkCsp 判定内联脚本与外链资源、rateSecurity 给安全开关组合打分、classifyNavigation 与 isPopupAllowed 管住导航，以及 asar 清单、发布状态机与更新决策。',
  why: '安全配置的坑几乎都出在组合上：CSP 写了 unsafe-inline 又加 nonce，浏览器会直接忽略 unsafe-inline；nodeIntegration 打开后 contextIsolation 的隔离也名存实亡；导航白名单漏了 file: 协议，一个本地 HTML 就能接管窗口；打包把测试与 sourcemap 塞进 asar、发布跳过公证，则把事故留给用户。这一关把「配置」翻译成可判题函数，让你看到每一项为什么必须这样写。',
  nodes: ['fe.electron.ship', 'fe.electron.ship.native-os', 'fe.electron.ship.package'],
  thinking: [
    {
      title: 'CSP 的优先级：出现 nonce 就禁用 inline',
      md: '很多人以为 `unsafe-inline` 是万能开关，其实 CSP3 规定：源列表里只要出现 nonce 或 hash，`unsafe-inline` 就被忽略。这意味着「为了兼容旧代码先留着 unsafe-inline」是一种自欺——要么全用 nonce，要么承认内联脚本可执行。\n\n模拟器简化了完整规范：只处理 script-src 与 default-src 的回落，不实现 report-only、多重头合并与 `strict-dynamic`。'
    },
    {
      title: '评分不是为了打分，是为了暴露组合',
      md: '四项开关不是独立加分项：nodeIntegration 打开会抵消 contextIsolation 的大部分价值，webSecurity 关闭则同源策略与证书校验一起失效。\n\n这里的 100 分是教学用启发式，不是安全认证。真实审计还要看 preload 暴露面、依赖供应链、自动更新签名，但先把这四个开关的组合关系刻进直觉，已经能挡掉大部分低级事故。'
    }
  ],
  prereq: [
    {
      title: 'CSP 源列表与 nonce/hash',
      md: 'CSP 头由分号分隔的多条指令组成，每条指令是「指令名 + 源列表」。源列表里可以写 `self`、具体 origin、通配符，也可以写 `nonce-xxx` 与 `sha256-xxx`。\n\nnonce 必须每次响应随机生成，hash 则是内联脚本内容的摘要。两者都存在时，浏览器只认与当前脚本匹配的那一个，这正是它们比 unsafe-inline 安全的原因。'
    },
    {
      title: '代码签名、公证与差分包',
      md: '签名证明「这个安装包是谁发布的」，公证（notarization）是平台方对包做一次恶意软件扫描并留下记录。macOS 上跳过公证，Gatekeeper 会直接拦下用户刚下载的应用。\n\n差分包依赖「用户当前版本」这个基线：基线对不上就只能发全量包。自动更新还必须校验签名，否则更新通道本身就是最大的后门。'
    }
  ],
  api: [
    {
      name: 'checkCsp',
      sig: 'parseCsp(header) => Record<string, string[]>；checkCsp(policy, req) => "allow" | "block"',
      args: 'header 是 Content-Security-Policy 的值；req 形如 { directive, inline, nonce, hash, origin, sameOrigin }，directive 缺省时回落到 default-src。',
      returns: 'checkCsp 返回字符串 allow 或 block；parseCsp 返回指令名到源列表的映射。',
      example: 'const p = parseCsp("script-src \'self\' \'nonce-abc")\ncheckCsp(p, { directive: "script-src", inline: true, nonce: "abc" })\n// "allow"'
    },
    {
      name: 'rateSecurity',
      sig: 'rateSecurity(flags) => { score, level, issues }',
      args: 'flags 含 nodeIntegration / contextIsolation / sandbox / webSecurity 四个布尔开关，缺省按关闭或打开的安全默认值处理。',
      returns: 'score 是 0 到 100 的启发式分数；level 是 safe / risky / unsafe；issues 是中文问题描述数组。',
      example: 'rateSecurity({ nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true })\n// { score: 100, level: "safe", issues: [] }'
    },
    {
      name: 'decideUpdate',
      sig: 'decideUpdate(req) => { action, mode, version, size? }',
      args: 'req 含 current / latest 版本号、signed 是否已签名、deltaBase 差分包基线、deltaSize 与 fullSize 体积。',
      returns: 'action 为 none / blocked / install；mode 为 none / delta / full；install 时带 size。',
      example: 'decideUpdate({ current: "1.4.0", latest: "1.5.0", signed: true, deltaBase: "1.4.0", deltaSize: 3, fullSize: 10 })\n// { action: "install", mode: "delta", version: "1.5.0", size: 3 }'
    }
  ],
  usage: '主进程创建窗口前先算一次安全评级，低分直接拒绝启动：\n```js\nconst level = rateSecurity({ nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true }).level\nif (level !== "safe") throw new Error("unsafe window flags")\n```\n页面里用 checkCsp 在测试中断言关键脚本被拦截；发布脚本用 buildAsarManifest 生成清单、用 advanceRelease 推进签名与公证，最后 decideUpdate 决定给用户差分包还是全量包。',
  hints: [
    '第 1 步 split(";") 之后一定要 trim；nonce 的值在引号里，切片时把两边的引号都去掉。',
    '第 2 步先写 parseTarget，把 protocol 与 host 分开，hostAllowed 再单独处理星号前缀。',
    '第 3 步把发布边写成二维表，版本比较按点分段转数字，别直接比字符串。'
  ],
  concepts: [
    {
      title: '防御要落在进程边界上',
      md: 'CSP 管页面加载什么，安全开关管渲染进程能碰到什么，导航白名单管窗口会被带到哪里，签名与公证管用户装到的是不是你的包。四层各管一段，任何一层单独使用都不够。'
    }
  ],
  stages: [
    {
      n: 1,
      title: 'CSP 解析与违规判定',
      think: '先把 CSP 头拆成指令表，再按「内联 / 外链」两条路判定。内联的关键是 nonce 与 hash 的优先级：源列表里一旦出现它们，unsafe-inline 就不再生效；外链则看 origin 是否命中源列表或 self。',
      hint: 'split 分号后 trim 再 split 空白；nonce 用 slice(7, -1) 去掉引号与前缀。',
      code: L2C1,
      test: L2S1,
      diag: [
        'parseCsp 没有 trim，指令名前面带了空格，policy 里根本查不到。',
        'checkCsp 只查了 policy[req.directive]，没有回落到 default-src。',
        'nonce 切片位置算错，slice(7) 把结尾的引号也留在了值里。',
        '只要出现 unsafe-inline 就放行，忽略了 nonce 与 hash 的优先级。',
        '外链只比较了 origin，没有处理 self，同源资源被误杀。',
        '空策略返回了 allow，等于默认放行一切。'
      ]
    },
    {
      n: 2,
      title: '开关评级与导航白名单',
      think: '四项开关不是简单相加：nodeIntegration 打开会抵消 contextIsolation 的价值，webSecurity 关闭则同源策略与证书校验一起失效。导航判定先看协议，再看 host 是否命中白名单或通配。',
      hint: 'rateSecurity 先扣分项再累加安全项；parseTarget 用 indexOf("://") 找协议分隔。',
      code: L2C2,
      test: L2S2,
      diag: [
        'rateSecurity 把 nodeIntegration 打开也算加分，分数虚高。',
        'level 阈值写反，70 分被归进了 safe 档。',
        'issues 里没写具体开关名，排障时只能猜。',
        'parseTarget 只按冒号切，https 后面的双斜杠被当成了 host。',
        'hostAllowed 用 includes 匹配，evil-example.com 命中了 example.com。',
        'classifyNavigation 对未知协议也返回 external，file: 被当成外部链接。'
      ]
    },
    {
      n: 3,
      title: '打包清单、发布门禁与更新决策',
      think: '发布是不可逆流水线：构建、签名、公证、发布必须逐级前进，失败可以回到构建重来。更新决策先比版本，再看签名，最后才看差分包基线是否匹配。',
      hint: 'matchIgnore 支持目录规则（以 /** 结尾）与精确文件名；decideUpdate 先调 compareVersions。',
      code: L2C3,
      test: L2S3,
      diag: [
        'matchIgnore 只做精确匹配，test/** 这类目录规则全部失效。',
        '清单没有排序，两台机器打出的 asar 顺序不同，构建不可复现。',
        '发布迁移表把 published 也写成可再签名，等于允许重复发布。',
        'advanceRelease 的迁移表漏了 failed 回到 built 的边，失败一次就卡死。',
        'compareVersions 直接比较字符串，1.10.0 被判定小于 1.9.0。',
        'decideUpdate 没有先比版本，旧版本更新被当成了可安装包。'
      ]
    }
  ],
  skeleton: `function parseCsp(header) {
  // TODO: 按分号拆指令，再按空白拆源列表
  throw new Error('parseCsp 还没实现')
}`,
  solution: L2C3,
  finalCode: L2C3,
  tests: `${L2S1}\n${L2S2}\n${L2S3}`
}

/* ============================================================ 第 3 关测试 */
const L3S1 = `{
  check('空元素不能包含任何子节点', () => {
    same(isVoidElement('img'), true)
    same(isVoidElement('div'), false)
    same(isLegalChild('img', 'span'), false)
  })
  check('p 里不允许块级元素', () => {
    same(isLegalChild('p', 'div'), false)
    same(isLegalChild('p', 'h1'), false)
    same(isLegalChild('p', 'span'), true)
  })
  check('a 不能再嵌套 a，但可以包任意短语内容', () => {
    same(isLegalChild('a', 'a'), false)
    same(isLegalChild('a', 'span'), true)
    same(isLegalChild('a', 'a'), false)
  })
  check('ul 的直接子元素只能是 li', () => {
    same(isLegalChild('ul', 'li'), true)
    same(isLegalChild('ul', 'div'), false)
    same(isLegalChild('table', 'tr'), true)
  })
  check('findViolations 只报出真正非法的嵌套路径', () => {
    const good = { tag: 'section', children: [{ tag: 'p', children: [{ tag: 'span', children: [] }] }] }
    same(findViolations(good), [])
    const bad = { tag: 'div', children: [{ tag: 'p', children: [{ tag: 'div', children: [] }] }] }
    const issues = findViolations(bad)
    same(issues.length, 1)
    ok(issues[0].indexOf('p > div') !== -1)
  })
}`

const L3S2 = `{
  check('导航意图里 nav 得满分，div 得零分', () => {
    same(scoreSemantic('nav', 'nav'), 3)
    same(scoreSemantic('nav', 'header'), 1)
    same(scoreSemantic('nav', 'div'), 0)
  })
  check('候选列表里选出得分最高的语义标签', () => {
    const best = bestSemanticTag('article', ['div', 'section', 'article'])
    same(best.tag, 'article')
    same(best.score, 3)
  })
  check('未知意图抛错，而不是静默返回零分', () => {
    throws(() => scoreSemantic('banner', 'div'))
    throws(() => bestSemanticTag('unknown', ['div']))
  })
  check('表单控件缺少可访问名称会被报出', () => {
    const issues = auditLabel({ tag: 'input' })
    same(issues.length, 1)
    ok(issues[0].indexOf('可访问名称') !== -1)
  })
  check('label 与 aria-label 同时存在算冗余', () => {
    const issues = auditLabel({ tag: 'input', hasLabel: true, ariaLabel: '搜索' })
    same(issues.length, 1)
    ok(issues[0].indexOf('两遍') !== -1)
  })
  check('aria-hidden 不能盖住可聚焦元素，div 冒充按钮要补键盘', () => {
    same(auditLabel({ tag: 'button', ariaHidden: true }).length, 1)
    same(auditLabel({ tag: 'div', role: 'button' }).length, 1)
    same(auditLabel({ tag: 'div', role: 'button', keyHandler: true }).length, 0)
  })
}`

const L3S3 = `{
  check('required 优先于 pattern 报错', () => {
    const f = { name: 'phone', required: true, pattern: '^1[0-9]{10}$' }
    same(validateField(f, '').code, 'REQUIRED')
    same(validateField(f, '   ').code, 'REQUIRED')
  })
  check('pattern 不匹配时报 PATTERN，匹配则通过', () => {
    const f = { required: true, pattern: '^1[0-9]{10}$' }
    same(validateField(f, '123').code, 'PATTERN')
    same(validateField(f, '13800138000').ok, true)
  })
  check('数值字段依次校验最小值、最大值与步长', () => {
    const f = { type: 'number', min: 1, max: 10, step: 2 }
    same(validateField(f, '0').code, 'RANGE_MIN')
    same(validateField(f, '12').code, 'RANGE_MAX')
    same(validateField(f, '4').code, 'STEP')
    same(validateField(f, '5').ok, true)
  })
  check('长度约束区分太短与太长', () => {
    const f = { minLength: 3, maxLength: 5 }
    same(validateField(f, 'ab').code, 'TOO_SHORT')
    same(validateField(f, 'abcdef').code, 'TOO_LONG')
    same(validateField(f, 'abc').ok, true)
  })
  check('序列化跳过 disabled 与未勾选项，多选重复 name', () => {
    const entries = [
      { name: 'q', value: 'a b' },
      { name: 'tag', value: ['x', 'y'] },
      { name: 'agree', type: 'checkbox', checked: false, value: 'on' },
      { name: 'secret', value: '1', disabled: true },
      { name: 'empty', value: '' }
    ]
    same(serializeForm(entries), 'q=a%20b&tag=x&tag=y&empty=')
  })
  check('非必填的空值直接通过校验', () => {
    same(validateField({}, '').ok, true)
    same(validateField({}, '').code, '')
  })
}`

/* ============================================================ 第 3 关代码 */
const L3C1 = `const VOID_TAGS = {
  area: true, base: true, br: true, col: true, embed: true, hr: true,
  img: true, input: true, link: true, meta: true, param: true, source: true,
  track: true, wbr: true
}

const FLOW_BLOCKERS = {
  address: true, article: true, aside: true, blockquote: true, div: true,
  dl: true, fieldset: true, figure: true, footer: true, form: true,
  h1: true, h2: true, h3: true, h4: true, h5: true, h6: true, header: true,
  hr: true, li: true, main: true, nav: true, ol: true, p: true, pre: true,
  section: true, table: true, ul: true
}

const PHRASING_ONLY = {
  p: true, h1: true, h2: true, h3: true, h4: true, h5: true, h6: true,
  span: true, a: true, button: true, label: true, strong: true, em: true, small: true
}

function isVoidElement(tag) {
  return VOID_TAGS[String(tag).toLowerCase()] === true
}

function isLegalChild(parent, child) {
  const p = String(parent).toLowerCase()
  const c = String(child).toLowerCase()
  if (isVoidElement(p)) return false
  if (p === 'a' && c === 'a') return false
  if (p === 'button' && (c === 'a' || c === 'button' || c === 'input')) return false
  if (PHRASING_ONLY[p] === true && FLOW_BLOCKERS[c] === true) return false
  if (p === 'ul' || p === 'ol') return c === 'li'
  if (p === 'li') return c !== 'li'
  if (p === 'table') return c === 'caption' || c === 'thead' || c === 'tbody' || c === 'tfoot' || c === 'tr'
  if (p === 'tr') return c === 'td' || c === 'th'
  return true
}

function findViolations(node, path) {
  const base = path || String(node.tag)
  const out = []
  const kids = node.children || []
  for (let i = 0; i < kids.length; i += 1) {
    const childPath = base + ' > ' + kids[i].tag
    if (isVoidElement(node.tag)) {
      out.push(node.tag + ' 是空元素，不能有子节点: ' + childPath)
      continue
    }
    if (!isLegalChild(node.tag, kids[i].tag)) out.push(childPath + ' 非法嵌套')
    const deeper = findViolations(kids[i], childPath)
    for (let j = 0; j < deeper.length; j += 1) out.push(deeper[j])
  }
  return out
}`

const L3C2 = `${L3C1}

const SEMANTIC_SCORES = {
  nav: { nav: 3, header: 1, div: 0 },
  article: { article: 3, section: 1, div: 0 },
  aside: { aside: 3, section: 1, div: 0 },
  footer: { footer: 3, div: 0 },
  card: { article: 2, section: 2, div: 0 },
  note: { aside: 2, p: 1, div: 0 }
}

function scoreSemantic(intent, tag) {
  const row = SEMANTIC_SCORES[intent]
  if (!row) throw new Error('unknown intent: ' + intent)
  const score = row[String(tag).toLowerCase()]
  return score === undefined ? 0 : score
}

function bestSemanticTag(intent, candidates) {
  let bestTag = null
  let bestScore = -1
  for (let i = 0; i < candidates.length; i += 1) {
    const score = scoreSemantic(intent, candidates[i])
    if (score > bestScore) {
      bestScore = score
      bestTag = candidates[i]
    }
  }
  return { tag: bestTag, score: bestScore }
}

function auditLabel(field) {
  const issues = []
  const f = field || {}
  const tag = String(f.tag || 'input').toLowerCase()
  if ((tag === 'input' || tag === 'select' || tag === 'textarea') && f.hasLabel !== true && !f.ariaLabel) {
    issues.push('表单控件缺少可访问名称：补 label[for] 或 aria-label')
  }
  if (f.hasLabel === true && f.ariaLabel) {
    issues.push('label 与 aria-label 同时存在，读屏可能念两遍')
  }
  if (f.ariaHidden === true && (tag === 'button' || tag === 'a' || f.tabIndex >= 0)) {
    issues.push('可聚焦元素不能 aria-hidden，否则键盘用户会掉进黑洞')
  }
  if (f.role === 'button' && tag === 'div' && f.keyHandler !== true) {
    issues.push('div 冒充按钮必须补键盘事件与 tabindex')
  }
  return issues
}`

const L3C3 = `${L3C2}

function validateField(field, value) {
  const f = field || {}
  const raw = value === undefined || value === null ? '' : String(value)
  if (f.required === true && raw.trim() === '') return { ok: false, code: 'REQUIRED', message: '必填项不能为空' }
  if (raw === '') return { ok: true, code: '', message: '' }
  if (f.pattern && new RegExp(f.pattern).test(raw) === false) {
    return { ok: false, code: 'PATTERN', message: '格式不符合 pattern' }
  }
  if (typeof f.minLength === 'number' && raw.length < f.minLength) {
    return { ok: false, code: 'TOO_SHORT', message: '长度不足' }
  }
  if (typeof f.maxLength === 'number' && raw.length > f.maxLength) {
    return { ok: false, code: 'TOO_LONG', message: '长度超限' }
  }
  if (f.type === 'number') {
    const num = Number(raw)
    if (isNaN(num)) return { ok: false, code: 'BAD_NUMBER', message: '不是合法数字' }
    if (typeof f.min === 'number' && num < f.min) return { ok: false, code: 'RANGE_MIN', message: '小于最小值' }
    if (typeof f.max === 'number' && num > f.max) return { ok: false, code: 'RANGE_MAX', message: '大于最大值' }
    if (typeof f.step === 'number' && f.step > 0) {
      const start = typeof f.min === 'number' ? f.min : 0
      const rest = (num - start) % f.step
      if (Math.abs(rest) > 1e-9 && Math.abs(rest - f.step) > 1e-9) {
        return { ok: false, code: 'STEP', message: '不在步长网格上' }
      }
    }
  }
  return { ok: true, code: '', message: '' }
}

function serializeForm(entries) {
  const pairs = []
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]
    if (entry.disabled === true) continue
    if ((entry.type === 'checkbox' || entry.type === 'radio') && entry.checked !== true) continue
    if (entry.name === undefined || entry.name === '') continue
    const values = Array.isArray(entry.value) ? entry.value : [entry.value]
    for (let j = 0; j < values.length; j += 1) {
      const v = values[j] === undefined || values[j] === null ? '' : String(values[j])
      pairs.push(encodeURIComponent(entry.name) + '=' + encodeURIComponent(v))
    }
  }
  return pairs.join('&')
}`

/* ============================================================ 第 3 关 */
const LV3 = {
  id: 'lv3',
  title: 'HTML 文档模型与表单：内容模型、语义与约束校验',
  emoji: '📄',
  xp: 55,
  goal: '实现内容模型判定 isVoidElement/isLegalChild/findViolations、语义标签评分 bestSemanticTag 与可访问名称审计 auditLabel，以及表单约束校验 validateField 与 serializeForm 序列化。',
  why: '浏览器不是「把标签渲染出来」这么简单：它会按内容模型纠正你的嵌套，按约束校验顺序挑出第一个错误，按提交规则决定哪些字段根本不会出现在请求里。写表单组件时如果不知道 p 里不能放 div、a 不能套 a、disabled 不提交、多选要重复 name，就会得到「本地好好的、上线全乱」的 bug。把这些规则写成函数，是理解浏览器行为最直接的方式。',
  nodes: [
    'fe.html.foundation',
    'fe.html.foundation.block-inline',
    'fe.html.foundation.semantic-tags',
    'fe.html.form',
    'fe.html.form.form-basics'
  ],
  thinking: [
    {
      title: '内容模型是解析器的纠错规则',
      md: '浏览器对错误 HTML 是容错的：p 里出现 div 时，解析器会在 div 前自动闭合 p；a 里再套 a 时，内层 a 会被拆出去。\n\n容错不等于合法：你以为的 DOM 结构和实际渲染出来的可能完全不同，样式与事件委托都会跟着错位。模拟器把常见规则抽成 `isLegalChild` 表，简化了完整的 flow / phrasing / palpable content 分类，只保留最容易踩坑的那几条。'
    },
    {
      title: '约束校验有优先级',
      md: '一个字段同时违反多条约束时，用户只会看到第一条错误。顺序大致是：required 是否为空、pattern 是否匹配、长度、数值范围、step 网格。\n\n不同浏览器与框架的报告顺序有细节差异，这里固定成一条教学顺序，目的是让你在写自定义校验时明确「先报什么」。真实项目里还要把错误信息映射到具体字段与无障碍提示。'
    },
    {
      title: '表单序列化只认成功控件',
      md: '提交时浏览器只收集「成功控件」：有 name、未 disabled、当前处于选中状态。空文本框仍然会提交 `name=`，而未勾选的 checkbox 根本不会出现。\n\n多选（select multiple 或多个同名 input）会重复同一个 name。理解这套规则，才知道后端为什么有时收不到字段——不是请求丢了，是控件从来就没被算进去。'
    }
  ],
  prereq: [
    {
      title: 'HTML 内容模型的分类',
      md: 'HTML 把元素分成 metadata、flow、sectioning、heading、phrasing、embedded 等类别。p 只允许 phrasing content，ul 的直接子元素必须是 li，a 是「透明」的：它自己可以出现在 phrasing 位置，但不能嵌套另一个 a。\n\n```html\n<p>合法 <span>短语</span></p>\n<p><div>非法：块级元素会提前闭合 p</div></p>\n```\n\n先记住这几条最常被问到的规则，再看完整规范会轻松很多。'
    },
    {
      title: '成功控件与可访问名称',
      md: '成功控件（successful controls）是提交时真正进入请求的那部分：必须有 name、不能 disabled、checkbox 必须勾选。与之配套的是可访问名称：input 需要 label[for] 指向它的 id，或者 aria-label；两者同时存在会让读屏重复播报。\n\naria-hidden 只能用在纯装饰元素上，盖住可聚焦元素会让键盘用户「看得见却摸不到」。'
    }
  ],
  api: [
    {
      name: 'isLegalChild',
      sig: 'isVoidElement(tag) => boolean；isLegalChild(parent, child) => boolean；findViolations(tree) => string[]',
      args: 'tag 是标签名（大小写不敏感）；tree 形如 { tag, children: [...] }，children 可省略。',
      returns: 'isVoidElement 判断是否为空元素；isLegalChild 判断嵌套是否合法；findViolations 返回从根开始的所有非法路径描述。',
      example: 'isLegalChild("p", "div")\n// false\nisLegalChild("ul", "li")\n// true\nfindViolations({ tag: "div", children: [{ tag: "p", children: [{ tag: "div" }] }] })\n// ["div > p > div 非法嵌套"]'
    },
    {
      name: 'validateField',
      sig: 'validateField(field, value) => { ok, code, message }',
      args: 'field 支持 required / pattern / minLength / maxLength / type / min / max / step；value 会被转成字符串再校验。',
      returns: '通过时 ok 为 true、code 为空串；失败时 code 是 REQUIRED / PATTERN / TOO_SHORT / TOO_LONG / BAD_NUMBER / RANGE_MIN / RANGE_MAX / STEP 之一。',
      example: 'validateField({ required: true, pattern: "^1[0-9]{10}$" }, "123")\n// { ok: false, code: "PATTERN", message: "格式不符合 pattern" }'
    },
    {
      name: 'serializeForm',
      sig: 'serializeForm(entries) => string',
      args: 'entries 每项形如 { name, value, type, checked, disabled }，value 可以是数组表示多选。',
      returns: '返回 application/x-www-form-urlencoded 形式的字符串，name 与 value 都经过 encodeURIComponent。',
      example: 'serializeForm([{ name: "q", value: "a b" }, { name: "tag", value: ["x", "y"] }])\n// "q=a%20b&tag=x&tag=y"'
    }
  ],
  usage: '组件里把字段配置与当前值交给校验器，再把表单状态交给序列化：\n```js\nconst err = validateField({ required: true, minLength: 2 }, input.value)\nif (!err.ok) showError(err.code)\nconst body = serializeForm([\n  { name: "q", value: input.value },\n  { name: "tag", value: selectedTags }\n])\n```\n渲染前也可以用 findViolations 在开发期断言模板结构，避免运行时被解析器悄悄改结构。',
  hints: [
    '第 1 步先列空元素名单，再写嵌套表；findViolations 用递归，注意空元素要提前 continue。',
    '第 2 步评分表写成意图到标签分的对象，bestSemanticTag 用严格大于保留第一个最高分。',
    '第 3 步先判 required 与空值，再按 pattern、长度、数值、step 的顺序返回第一个错误。'
  ],
  concepts: [
    {
      title: '语义标签不是装饰',
      md: 'nav、article、aside、footer 影响的是无障碍树与搜索引擎理解，不是视觉。用 div 拼出来的页面也能很好看，但读屏用户失去的是跳过导航、直达正文这类能力。选标签先问「这块内容在文档里扮演什么角色」。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '内容模型与非法嵌套',
      think: '先把空元素名单和嵌套表列出来，再让 findViolations 递归走整棵树。重点是空元素必须提前 continue，否则会一边报「不能有子节点」一边继续往下误报。',
      hint: 'VOID_TAGS 用对象查表；p 的规则交给 PHRASING_ONLY 与 FLOW_BLOCKERS 两张表组合。',
      code: L3C1,
      test: L3S1,
      diag: [
        '空元素名单漏了 img 或 input，空元素被当成普通容器。',
        '把 p 当成普通容器，只拦了 div 没拦 h1 与 ul。',
        'a 的嵌套只判断了单边，a 里放 a 被放过。',
        'ul 规则写成「子元素包含 li 就行」，div 混进去也不报。',
        'findViolations 只查了根节点，没有递归到子树。'
      ]
    },
    {
      n: 2,
      title: '语义标签选型与可访问名称',
      think: '语义选型本质是「意图到标签」的评分表：同一个意图下可能有多个候选，取最高分。可访问名称审计则要区分「没有名字」与「名字重复」，前者是缺失，后者是噪音。',
      hint: '评分表按意图分组；bestSemanticTag 用严格大于，保证同分时保留先出现的候选。',
      code: L3C2,
      test: L3S2,
      diag: [
        'scoreSemantic 对未知标签抛错，而不是按 0 分处理。',
        'bestSemanticTag 用大于等于比较，后出现的同分标签覆盖了前面的。',
        '评分表的意图键拼错，nav 与 navigation 对不上。',
        'auditLabel 只查 aria-label，漏了 label[for] 这条路径。',
        '重复命名的判断写反，只有 aria-label 时也报冗余。',
        'aria-hidden 没有排除可聚焦元素，div 检查也没看键盘处理。'
      ]
    },
    {
      n: 3,
      title: '约束校验与表单序列化',
      think: '校验函数要按固定优先级返回第一个错误，而不是把所有错误拼成一串；序列化则要严格按成功控件规则过滤。两者合起来，才解释得清「为什么后端收不到这个字段」。',
      hint: 'validateField 先处理 required 与空值，再依次 pattern、长度、数值、step；序列化对多选值循环。',
      code: L3C3,
      test: L3S3,
      diag: [
        'required 判断用了 == 而不是 ===，空字符串被当成了有值。',
        'pattern 用 indexOf 而不是 RegExp.test，正则边界完全失效。',
        'min/max 在校验数字之前就做了比较，字符串按字典序比大小。',
        'step 只算了余数没处理浮点误差，合法值被误杀。',
        'serializeForm 没有跳过 disabled 与未勾选的 checkbox。',
        '多选值只取了第一个，或者没有对 name 与 value 做 encodeURIComponent。'
      ]
    }
  ],
  skeleton: `function isLegalChild(parent, child) {
  // TODO: 空元素、p 的短语限制、a 嵌套、列表与表格的子元素规则
  throw new Error('isLegalChild 还没实现')
}`,
  solution: L3C3,
  finalCode: L3C3,
  tests: `${L3S1}\n${L3S2}\n${L3S3}`
}

export default {
  id: 'fe-electron',
  version: 3,
  domain: 'fe',
  cumulative: false,
  title: 'Electron 桌面端：进程边界、安全分发与文档表单',
  emoji: '🖥️',
  tagline: '三关：IPC 路由与窗口状态机、CSP 与发布门禁、HTML 内容模型与表单校验。',
  stack: ['Electron', 'Node.js', 'HTML'],
  intro: 'Electron 前端岗真正会问的不是 API 清单，而是边界：主进程凭什么相信渲染进程发来的消息，窗口为什么必须有明确的状态迁移，一次 invoke 的响应如何确定属于哪个请求，CSP 与打包签名又怎样把攻击面和发布风险压下去。本项目用三个纯函数模拟器把这些边界拆开：通道白名单与请求队列、窗口状态机与 requestId 配对、CSP 决策与发布门禁，再加上 HTML 内容模型与表单约束校验，全部能在判题沙箱里跑通。',
  outcome: '写完你能手写 IPC 路由与配对表、判断一条 CSP 会不会放行内联脚本、给窗口与发布流程画出合法迁移，并用内容模型和约束校验解释浏览器为什么拒绝一段 HTML 或一次表单提交。',
  levels: [LV1, LV2, LV3]
}