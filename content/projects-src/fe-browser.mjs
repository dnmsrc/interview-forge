/**
 * 项目闯关内容源：fe-browser（前端 · 浏览器运行时与构建链）
 *
 * 4 关：
 *   lv1 渲染与事件循环  —— 一个主线程模拟器：三级失效 → 事件循环 → 输入帧与 INP
 *   lv2 存储、Worker 与堆 —— 一个离线缓存层：配额计量 → Worker 卸载 → 分代 GC 回收
 *   lv3 构建工具链        —— 依赖布局 → Vite 式按需 dev → Webpack 式编译
 *   lv4 模块与打包        —— 模块互操作 → tree-shaking → chunk 拆分与缓存
 *
 * 判题沙箱只有 check/same/ok/throws + console，没有 require/process/fs/定时器/Promise 之外的调度器，
 * 所以每一关都是「纯函数 + 注入时钟/注入预算」的模拟器；真实系统里由谁驱动、简化了什么，在每关的
 * thinking / concepts 里写清。
 */

/* ============================================================ 第 1 关测试（帧流水线与事件循环） */
const L1S1 = `{
  check('几何变化触发 layout → paint → composite 三级齐动', () => {
    const loop = createFrameLoop()
    loop.useStyles(true)
    loop.setHeight('hero', 200)
    same(loop.flush(), ['layout', 'paint', 'composite'])
  })
  check('只改颜色不重排：paint 与 composite 跟上，layout 不动', () => {
    const loop = createFrameLoop()
    loop.useStyles(true)
    loop.setColor('hero', 'red')
    same(loop.flush(), ['paint', 'composite'])
    same(loop.stats().layout, 0)
  })
  check('只改 transform 走合成层：连 paint 都跳过', () => {
    const loop = createFrameLoop()
    loop.useStyles(true)
    loop.setTransform('hero', 'translateX(10px)')
    same(loop.flush(), ['composite'])
    same(loop.stats().paint, 0)
  })
  check('写同值不产生失效，flush 空转返回空数组且不算一帧', () => {
    const loop = createFrameLoop()
    loop.useStyles(true)
    loop.setHeight('hero', 100)
    loop.flush()
    same(loop.setHeight('hero', 100), false)
    same(loop.flush(), [])
    same(loop.stats().frames, 1)
  })
  check('CSSOM 未就绪时首帧不 layout，只记一次 stall（白屏权衡）', () => {
    const loop = createFrameLoop()
    loop.setHeight('hero', 100)
    same(loop.flush(), [])
    same(loop.stats().layout, 0)
    same(loop.stats().stalls, 1)
    loop.useStyles(true)
    same(loop.flush(), ['layout', 'paint', 'composite'])
  })
}`

const L1S2 = `{
  check('一个宏任务之后清空全部微任务，递归登记的同轮执行', () => {
    const loop = createFrameLoop()
    loop.useStyles(true)
    const turns = loop.run([
      { name: 'click', cost: 2, microTasks: [{ name: 'm1', cost: 0, then: [{ name: 'm2', cost: 0 }] }] }
    ])
    same(turns.length, 1)
    same(turns[0].micros, ['m1', 'm2'])
  })
  check('微任务里的修改在绘制之前生效，同一轮就能看到 layout', () => {
    const loop = createFrameLoop()
    loop.useStyles(true)
    const turns = loop.run([
      { name: 'click', cost: 2, microTasks: [{ name: 'flush-list', cost: 1, mutate: () => loop.setHeight('hero', 50) }] }
    ])
    ok(turns[0].painted, '这一轮应该发生绘制')
    same(turns[0].tasks[0], 'layout', '微任务改了几何，绘制必须从 layout 开始')
  })
  check('没有失效的回合不绘制，别做无用帧', () => {
    const loop = createFrameLoop()
    loop.useStyles(true)
    const turns = loop.run([{ name: 'a', cost: 2 }, { name: 'b', cost: 2 }, { name: 'c', cost: 2 }])
    same(turns.map((t) => t.painted), [false, false, false])
    same(loop.stats().frames, 0)
  })
  check('同一帧窗口内的多个宏任务只绘制一次（帧合并）', () => {
    const loop = createFrameLoop({ frameMs: 16 })
    loop.useStyles(true)
    loop.setHeight('hero', 100)
    const turns = loop.run([
      { name: 'a', cost: 2 },
      { name: 'b', cost: 2, mutate: () => loop.setColor('hero', 'red') }
    ])
    same(turns.map((t) => t.painted), [true, false], '第二次失效落在同一帧窗口内，只能等下一帧')
    same(loop.pending().paint, true, '失效位要留给下一帧，不能丢')
  })
  check('超过 50ms 的宏任务记为 long task', () => {
    const loop = createFrameLoop()
    loop.useStyles(true)
    const turns = loop.run([{ name: 'big', cost: 60 }])
    same(turns[0].long, true)
    same(loop.stats().longTasks, 1)
    ok(turns[0].end - turns[0].start >= 60)
  })
}`

const L1S3 = `{
  check('处理器没改 DOM 也要等下一次绘制：INP = 排队 + 工作 + 光栅', () => {
    const loop = createFrameLoop({ paintCost: 4 })
    loop.useStyles(true)
    const r = loop.dispatch({ name: 'click', work: 8, slice: 20 })
    same(r.inp, 12, '8ms 处理器 + 4ms 呈现，0 排队')
  })
  check('长任务切片后首帧提前：INP 只算到第一次绘制', () => {
    const loop = createFrameLoop({ paintCost: 4 })
    loop.useStyles(true)
    const big = loop.dispatch({ name: 'search', work: 100, slice: 20, mutate: () => loop.setHeight('list', 800) })
    same(big.slices, 5)
    same(big.inp, 24, '切片让第一次绘制落在 20 + 4')
    same(big.presentedAt, 24)
  })
  check('切片次数与让出次数对得上：yields = slices - 1', () => {
    const loop = createFrameLoop()
    loop.useStyles(true)
    const r = loop.dispatch({ name: 'scroll', work: 100, slice: 20 })
    same(r.yields, 4)
    same(r.slices, 5)
  })
  check('passive:true 时 preventDefault 不生效，滚动不被阻塞', () => {
    const loop = createFrameLoop()
    loop.useStyles(true)
    const blocked = loop.dispatch({ name: 'wheel', work: 4, passive: false, preventDefault: true })
    same(blocked.applied, true, '非 passive 监听器可以吃掉默认行为')
    const passive = loop.dispatch({ name: 'wheel', work: 4, passive: true, preventDefault: true })
    same(passive.applied, false, 'passive 监听器里 preventDefault 是无效的')
    same(passive.passive, true)
  })
  check('INP 取 P75：4 个交互里第 3 小的那个', () => {
    const loop = createFrameLoop()
    same(loop.p75([24, 12, 104, 40]), 40)
    same(loop.p75([8]), 8)
    same(loop.p75([]), 0)
  })
}`

/* ============================================================ 第 2 关测试（存储、Worker 与堆） */
const L2S1 = `{
  check('读写：值一律字符串化，缺失 key 返回 null', () => {
    const st = createStorage({ quotaKB: 5 })
    st.set('n', 42)
    same(st.get('n'), '42')
    same(st.get('missing'), null)
    same(st.keys(), ['n'])
  })
  check('同 key 覆盖按差值计费，值变短后用量回落', () => {
    const st = createStorage({ quotaKB: 5 })
    st.set('k', '0123456789')
    same(st.info().used, 22, '(key 1 + value 10) * 2')
    st.set('k', 'yy')
    same(st.info().used, 6)
    same(st.info().count, 1)
  })
  check('按 UTF-16 双字节计量且 key 也占配额：1KB 正好卡在边界', () => {
    const st = createStorage({ quotaKB: 1 })
    st.set('a', 'x'.repeat(510))
    same(st.info().used, 1022)
    throws(() => st.set('b', 'y'), '再写 4 字节就超过 1024 了')
  })
  check('超配额抛 QuotaExceededError 且旧值不被破坏', () => {
    const st = createStorage({ quotaKB: 1 })
    st.set('a', 'x'.repeat(510))
    const err = throws(() => st.set('a', 'x'.repeat(513)))
    same(err.name, 'QuotaExceededError')
    same(st.get('a').length, 510, '失败的写入不能改掉旧值')
    same(st.info().used, 1022)
  })
  check('remove 腾出配额后能继续写；quota 为 0 时任何写都抛', () => {
    const st = createStorage({ quotaKB: 1 })
    st.set('a', 'x'.repeat(510))
    same(st.remove('a'), true)
    same(st.remove('a'), false, '删不存在的 key 返回 false')
    same(st.info().used, 0)
    st.set('b', 'y')
    same(st.get('b'), 'y')
    const zero = createStorage({ quotaKB: 0 })
    throws(() => zero.set('any', 'v'))
  })
  check('存储选型：鉴权走 Cookie、大对象走 IndexedDB、会话级走 sessionStorage', () => {
    same(pickStorage({ perRequest: true, size: 200 }), 'cookie', '每次请求都要带上，只有 Cookie 会被自动携带')
    same(pickStorage({ size: 6 * 1024 * 1024 }), 'indexeddb', '超过同源 5MB 配额，只能走异步 KV')
    same(pickStorage({ blob: true, size: 100 }), 'indexeddb', '要存 File/Blob 也只有 IndexedDB 收得下')
    same(pickStorage({ session: true, size: 2000 }), 'sessionStorage')
    same(pickStorage({ size: 2000 }), 'localStorage')
  })
}`

const L2S2 = `{
  check('消息按 FIFO 处理，每条都带 oldValue', () => {
    const st = createStorage({ quotaKB: 5 })
    const w = createStorageWorker(st)
    w.post({ key: 'a', value: '1' })
    w.post({ key: 'b', value: '2' })
    w.post({ key: 'c', value: '3' })
    const r = w.drain(64)
    same(r.done, 3)
    same(r.pending, 0)
    const ev = w.takeEvents()
    same(ev.map((e) => e.key), ['a', 'b', 'c'])
    same(ev[0].oldValue, null)
    same(st.get('c'), '3')
  })
  check('预算不够就留在队列里，下个 tick 继续', () => {
    const st = createStorage({ quotaKB: 64 })
    const w = createStorageWorker(st)
    const pad = 'x'.repeat(298)
    w.post({ key: 'k0', value: pad })
    w.post({ key: 'k1', value: pad })
    w.post({ key: 'k2', value: pad })
    const first = w.drain(1)
    same(first.done, 1, '每条 600 字节，1KB 预算只放得下一条')
    same(first.pending, 2)
    const second = w.drain(1)
    same(second.done, 1)
    same(second.pending, 1)
    const third = w.drain(1)
    same(third.done, 1)
    same(w.stats().handled, 3)
  })
  check('Transferable 只转移所有权：不计克隆字节，也不受预算限制', () => {
    const st = createStorage({ quotaKB: 64 })
    const w = createStorageWorker(st)
    const pad = 'x'.repeat(298)
    w.post({ key: 'buf', value: pad }, true)
    const r = w.drain(0.1)
    same(r.done, 1, '转移不占主线程拷贝时间，额度再小也能立刻处理')
    same(w.stats().clonedBytes, 0)
    same(w.stats().transferredBytes, 602, '(3 字节 key + 298 字节 value) * 2')
  })
  check('超配额的消息进 failed 列表，不炸主线程', () => {
    const st = createStorage({ quotaKB: 1 })
    const w = createStorageWorker(st)
    const r = w.drain(64)
    same(r.done, 0)
    w.post({ key: 'big', value: 'y'.repeat(700) })
    const out = w.drain(64)
    same(out.done, 1)
    same(w.failed.length, 1)
    same(w.failed[0].reason, 'QuotaExceededError')
    same(st.get('big'), null, '失败的写入不该落盘')
    same(w.stats().events, 0)
  })
  check('storage 事件带新旧值，这就是跨标签广播的依据', () => {
    const st = createStorage({ quotaKB: 5 })
    const w = createStorageWorker(st)
    w.post({ key: 'cart', value: 'v1' })
    w.post({ key: 'cart', value: 'v2' })
    w.drain(64)
    const ev = w.takeEvents()
    same(ev.length, 2)
    same(ev[0].newValue, 'v1')
    same(ev[1].oldValue, 'v1')
    same(ev[1].newValue, 'v2')
    same(w.takeEvents().length, 0, '取过一次就清空')
  })
}`

const L2S3 = `{
  check('Scavenge 回收不可达对象，存活对象长一岁', () => {
    const h = createHeap()
    const a = h.alloc(8, 'node')
    const b = h.alloc(8, 'node')
    h.release(a)
    const r = h.scavenge()
    same(r.collected, 1)
    same(r.survivors, 1)
    same(b.age, 1)
    same(a.age, 0, '被回收的对象不再长年龄')
    const snap = h.snapshot()
    same(snap.young, 1)
    same(snap.youngBytes, 8)
  })
  check('活过两轮 Scavenge 的对象晋升老生代', () => {
    const h = createHeap({ promoteAge: 2 })
    h.alloc(8, 'node')
    same(h.scavenge().promoted, 0)
    same(h.snapshot().young, 1)
    const r = h.scavenge()
    same(r.promoted, 1)
    const snap = h.snapshot()
    same(snap.young, 0)
    same(snap.old, 1)
    same(snap.oldBytes, 8)
    same(snap.promoted, 1)
  })
  check('Mark-Sweep 回收不可达的老生代并释放字节', () => {
    const h = createHeap()
    const a = h.alloc(10, 'cache')
    const b = h.alloc(20, 'cache')
    h.scavenge()
    h.scavenge()
    same(h.snapshot().oldBytes, 30)
    h.release(a)
    const r = h.markSweep()
    same(r.collected, 1)
    same(r.freedBytes, 10)
    same(r.oldBytes, 20)
    same(h.snapshot().old, 1)
  })
  check('泄漏判定看回收后的基线抬升，不看峰值', () => {
    const h = createHeap({ promoteAge: 1 })
    for (let round = 0; round < 3; round++) {
      h.alloc(10, 'listener')
      h.scavenge()
      h.markSweep()
    }
    const trend = h.leakTrend()
    same(trend.leaking, true, '每轮回收之后基线都在抬高 = 有东西被长期持有')
    ok(trend.growth > 0)
    same(h.leakTrend([30, 20, 20]).leaking, false, '锯齿回落说明只是峰值高')
    same(h.leakTrend([10]).leaking, false, '样本不足不下结论')
  })
  check('survivors 只算留在新生代的，晋升的不重复统计', () => {
    const h = createHeap({ promoteAge: 2 })
    const a = h.alloc(1, 'a')
    const b = h.alloc(1, 'b')
    const c = h.alloc(1, 'c')
    h.release(b)
    const r1 = h.scavenge()
    same(r1.survivors, 2)
    same(r1.promoted, 0)
    same(r1.collected, 1)
    h.release(c)
    const r2 = h.scavenge()
    same(r2.promoted, 1, 'a 活过两轮，晋升')
    same(r2.survivors, 0, '晋升的对象不算 survivors')
    same(r2.collected, 1)
    same(h.snapshot().old, 1)
    same(a.age, 2)
  })
}`

/* ============================================================ 第 1 关：帧流水线与事件循环 */
const LV1 = {
  id: 'lv1',
  title: '主线程模拟器：从脏标记到 INP',
  emoji: '🎞️',
  xp: 40,
  goal:
    '实现 createFrameLoop(opts)：用「几何 / 外观 / 仅合成」三级失效驱动 layout→paint→composite 流水线，flush() 返回本帧真正执行的任务；run(macros) 演一遍「宏任务 → 清空微任务（递归）→ 必要时渲染，一帧最多一次」；dispatch(input) 把慢处理器按切片让出，并算出这次交互的 INP。',
  why:
    '面试里「浏览器怎么把一帧画出来」最容易被问穿的地方不是名词，而是时序：哪个改动会强制重排、微任务为什么在绘制之前、一帧里能渲染几次、INP 到底从哪一刻算到哪一刻。这些结论只要写成代码就必须给出数字，含糊不过去。反过来，写不出这套时序的人，优化起来只能靠猜：把 will-change 满地撒、把长任务塞进 setTimeout，然后在真机上发现 INP 反而更差。',
  nodes: [
    'fe.browser.render',
    'fe.browser.render.pipeline',
    'fe.browser.render.reflow-repaint',
    'fe.browser.events',
    'fe.browser.events.event-loop',
    'fe.browser.events.input-frame'
  ],
  thinking: [
    {
      title: '先把「时间」从实现里拿出去',
      md:
        '真实浏览器里时间由 vsync 驱动：合成器每 16.7ms 要一帧，主线程上的任务排队、微任务清空、rAF 回调、样式与布局、光栅化，全都被这个节拍挟持。判题沙箱没有 setTimeout / rAF，正好逼我把节拍抽象成「调用方推进的虚拟时钟」。\n\n于是 opts.frameMs 就是 vsync 周期，cost 就是任务耗时，flush() 就是「这一帧真正跑了哪几个阶段」。这个抽象不是为测试而扭曲实现——它恰好就是渲染流水线的骨架：一旦你把「谁在什么时候花了多少毫秒」写清楚，剩下的全是判断。\n\n反过来说，任何依赖 Date.now() 的写法在这里都跑不动，这也在提醒：能被测量的性能问题才有优化的可能，靠「感觉卡」定位不到 reflow。'
    },
    {
      title: '三级失效，比一个 dirty 布尔值多出来的正是面试要问的',
      md:
        '如果只用一个 dirty 布尔值，你就分不清「改 width」和「改 transform」的代价差在哪。我把它拆成三级：\n\n1. 几何变化（width/height/padding）→ layout 一定要重算，并向下传播到子孙；\n2. 外观变化（color/background）→ 跳过 layout，但 paint 要重来；\n3. transform / opacity → 只换合成层的变换矩阵，主线程连 paint 都不用跑。\n\n这三级的包含关系是 几何 ⊃ 外观 ⊃ 仅合成。写好之后你会立刻看到「transform 动画比 left 动画便宜」不是玄学，而是差在任务列表里少了两个阶段。\n\n我还刻意让「写同值」不产生失效（先比较再赋值）：真实 DOM 上 el.style.width = 同样的值浏览器也会做脏检查，这是很多「我明明只改了一次」的错觉来源。'
    },
    {
      title: '微任务在绘制之前清空，不是规范怪癖，是正确性要求',
      md:
        '一帧的末尾要「提交」一份确定的 DOM 状态去画。如果微任务能在绘制之后跑，就会出现「画的是旧值、读的是新值」的撕裂。所以事件循环的规则是硬顺序：取一个宏任务 → 把它产生的微任务全部清空（微任务里再登记微任务，也仍然在这一轮清空）→ 需要时渲染。\n\n这也是 Vue 的 nextTick 用 Promise 微任务的因果链：改完数据，微任务里 flush 完 DOM 更新，await nextTick 之后就能读到新 DOM。\n\n第 2 步的测试会专门验证这一点：微任务里改了几何，同一轮的绘制任务列表必须以 layout 开头。'
    }
  ],
  prereq: [
    {
      title: '渲染流水线的四个阶段，以及它们各自的入口条件',
      md:
        '一次帧生产大致是：样式计算（style）→ 布局（layout，算盒子几何）→ 绘制（paint，生成绘制指令/display list）→ 合成（composite，合成线程按层叠加交给 GPU）。\n\n关键在「入口条件」：\n\n- 只有 DOM/CSSOM 变了才需要重算样式；\n- 只有几何变了才需要 layout；\n- 只有绘制指令变了才需要 paint；\n- transform / opacity 只改层的变换矩阵，走合成线程，主线程可以完全不参与。\n\n还有一条常被忽略的前置条件：首次绘制之前浏览器要等完整 CSSOM。CSS 不阻塞 DOM 解析，但阻塞渲染，所以「HTML 到了、CSS 还在路上」时首帧是白屏（FOUC 的另一个方向）。这一关用 useStyles(false) 把这个状态显式化：没就绪就不进 layout。'
    },
    {
      title: '宏任务、微任务与渲染时机',
      md:
        '浏览器事件循环每一轮：从任务队列取一个宏任务执行（script、事件回调、定时器、postMessage 都算），执行完把微任务队列清空（Promise.then、queueMicrotask、MutationObserver），然后判断「需不需要渲染」——需要才走 rAF 回调 + 样式/布局/绘制/合成，且每帧最多渲染一次。\n\n注意 rAF 的位置：它在渲染之前、微任务清空之后。所以 rAF 里读 offsetWidth 是安全的（此时布局已定稿），而在微任务里读可能触发强制同步布局。\n\n和 Node 的区别值得单独记一句：Node 是 libuv 六阶段 + process.nextTick 优先于 Promise，没有「渲染」这一步；浏览器是「一个宏任务 + 清空微任务 + 可能渲染」。'
    },
    {
      title: 'INP 是什么口径，50ms 长任务为什么是分界线',
      md:
        'INP（Interaction to Next Paint）取代了 FID：FID 只量「输入到事件回调开始」的排队延迟，INP 量到「下一次绘制」，所以处理器自己慢也会被算进去。取 P75，因为长尾体验比平均值更接近用户感受。\n\n所以一个 100ms 的处理器，无论排队多短，INP 都至少 100ms 起——这也是「事件处理函数本身慢」成为主因的原因。治理手段就两类：把工作切片，让浏览器在切片之间有绘制机会（scheduler.yield 保留优先级地让出，比 setTimeout 粗切更可控）；或者把纯计算搬进 Worker 彻底离开主线程。\n\n50ms 是长任务（long task）的界：超过它，主线程在这段时间内无法响应用户输入。'
    }
  ],
  api: [
    {
      name: 'createFrameLoop',
      sig: 'createFrameLoop(opts?: { frameMs?: number, paintCost?: number }) => FrameLoop',
      args:
        'frameMs 是模拟的 vsync 周期（默认 16ms）：两次绘制之间至少隔这么久；paintCost 是一次光栅化+提交合成器的固定开销（默认 4ms）。两者都由测试注入，保证时间可复现。',
      returns:
        'FrameLoop 对象：setHeight/setColor/setTransform(id, value) 制造三级失效（写同值返回 false）；useStyles(bool) 切换 CSSOM 是否就绪；pending() 读当前失效位；flush() 跑本帧流水线并返回任务名数组（如 ["layout","paint","composite"]），没活干返回 []；stats() 返回各阶段累计次数与 stalls（CSSOM 未就绪的空转帧）；run(macros) 与 dispatch(input) 见后续步骤。',
      example:
        'const loop = createFrameLoop({ frameMs: 16 })\nloop.useStyles(true)\nloop.setColor("hero", "red")\nloop.flush()          // ["paint", "composite"]\nloop.stats()          // { frames: 1, layout: 0, paint: 1, composite: 1, stalls: 0, longTasks: 0 }'
    },
    {
      name: 'FrameLoop.dispatch',
      sig: 'dispatch(input: { name?, work?, slice?, queued?, passive?, preventDefault?, mutate? }) => InputRecord',
      args:
        'work 是处理器总耗时（ms）；slice 是每次让出前最多连续跑多久（缺省等于 work，即不切片）；queued 是事件到达后排队等了多久（计入 INP）；passive 是监听器是否声明 passive；preventDefault 表示处理器想阻止默认行为；mutate 是处理器里改 DOM 的回调（由调用方注入，模拟写样式）。',
      returns:
        'InputRecord：{ arrivedAt, presentedAt, inp, slices, yields, frames, passive, applied, tasks }。applied 只有在非 passive 且调了 preventDefault 时才为 true。p75(values) 是同一对象上的工具方法，按 nearest-rank 取 P75。',
      example:
        'const loop = createFrameLoop({ paintCost: 4 })\nloop.useStyles(true)\nconst r = loop.dispatch({ name: "search", work: 100, slice: 20, mutate: () => loop.setHeight("list", 800) })\nr.inp        // 24：第一次绘制在 20 + 4\nr.slices     // 5\nr.yields     // 4'
    }
  ],
  usage:
    '这套模拟器最实用的地方是当「预算尺」用：把生产环境里量到的处理器耗时喂进去，看 INP 会落在哪。\n\n```js\n// 真实页面里：一个 100ms 的搜索处理器，主线程被占满\nconst loop = createFrameLoop({ frameMs: 16, paintCost: 4 })\nloop.useStyles(true)\nconst before = loop.dispatch({ name: "search", work: 100, slice: 100, mutate: () => loop.setHeight("list", 800) })\n// before.inp === 104 -> 用户感觉「点了没反应」\n\nconst after = loop.dispatch({ name: "search", work: 100, slice: 20, mutate: () => loop.setHeight("list", 800) })\n// after.inp === 24，总耗时没变，但第一次绘制提前了 80ms\n\nconsole.log(after.inp, loop.p75([before.inp, after.inp]))\n```\n\n对应到真实 API：slice 就是 `await scheduler.yield()` 的切点，passive 就是 `addEventListener("wheel", fn, { passive: true })` 的第三个参数。',
  hints: [
    '第 1 步只要想清楚三件事：三级失效各置哪些位、flush 按 layout → paint → composite 的顺序收集任务、CSSOM 未就绪时直接返回空数组。',
    '第 2 步的 run 是对宏任务数组做一遍循环：每个宏任务先跑 mutate 和 cost，再 while 循环把微任务队列清空（注意 m.then 要 concat 进队列，而不是递归调用）。',
    '第 3 步的 dispatch 是「切片循环 + 每片之后看脏标记」：第一次绘制决定 INP，所以 presentedAt 只在第一次赋值，后面别再覆盖。'
  ],
  concepts: [
    {
      title: '局部位图 vs 真实浏览器：这个模拟器简化了什么',
      md:
        '简化点有三个，说清楚才不会误用结论：\n\n1. 失效位是全局三个布尔值，真实系统里是每个 LayoutObject 的 dirty bit 加脏矩形（dirty rects），重排只影响受影响的子树——所以我的「一次几何变化 = 全局 layout」是悲观估计。\n2. 没有层树：真实浏览器要决定哪个元素提升为合成层（will-change、translateZ、canvas/video 等），滥用 will-change 会让每层都变成纹理，显存爆掉反而掉帧。这里只有「只改 transform 就等于只跑 composite」这一条结论。\n3. 没有强制同步布局：真实代码里 getBoundingClientRect / offsetTop 会 flush pending layout，读写交错就变成 layout thrashing。这里把「读几何」整个省了，所以别拿它证明「读属性免费」。'
    },
    {
      title: 'INP、TBT、长任务：三个指标不是一回事',
      md:
        '长任务只说明主线程被占了多久，不管用户是否正好在交互；TBT（Total Blocking Time）把首屏之后所有 >50ms 任务的超出部分累加，衡量的是「可交互性」；INP 只看真实交互到下一次绘制，并且按 P75 取值。\n\n一个页面可以 TBT 很高但 INP 很好（长任务都发生在用户没操作的时段），也可以反过来（处理器只有 60ms，但每次交互都撞在它上面）。所以优化前先看是哪个指标坏：INP 坏要拆处理器，TBT 坏要拆初始化。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '用三级失效驱动流水线',
      think:
        '先只做「失效 → 本帧跑哪几个阶段」这一层，因为后面的事件循环和 INP 全都建立在「此刻有没有脏标记」上。这一步刻意把渲染时机交给调用方（谁调 flush 谁就是一帧），先让「哪些改动会触发哪些阶段」变得可验证。',
      hint:
        '三个布尔位：layout / paint / composite。几何置三位，外观置后两位，transform 只置 composite。flush 按固定顺序收集非空位、累加统计、再一起清空；useStyles(false) 时直接返回空数组并记一次 stall。',
      vocab: [
        { term: 'dirty bit', desc: '元素上标记「需要重算」的位；真实浏览器按 LayoutObject 存，这里用一个全局集合代替' },
        { term: 'CSSOM', desc: 'CSS 对象模型，样式表解析后的结果；它没就绪时浏览器不会进入首帧布局' }
      ],
      code: `function createFrameLoop(opts) {
  const config = opts || {}
  const frameMs = config.frameMs || 16
  const nodes = {}
  const dirty = { layout: false, paint: false, composite: false }
  const stats = { frames: 0, layout: 0, paint: 0, composite: 0, stalls: 0, longTasks: 0 }
  let stylesReady = false

  function node(id) {
    if (!nodes[id]) nodes[id] = { id: id, height: 0, color: '', transform: 'none' }
    return nodes[id]
  }

  // 三级失效：几何 ⊃ 外观 ⊃ 仅合成
  function invalidate(level) {
    if (level === 'geometry') {
      dirty.layout = true
      dirty.paint = true
      dirty.composite = true
    } else if (level === 'appearance') {
      dirty.paint = true
      dirty.composite = true
    } else {
      dirty.composite = true
    }
  }

  function setHeight(id, px) {
    const n = node(id)
    if (n.height === px) return false
    n.height = px
    invalidate('geometry')
    return true
  }

  function setColor(id, color) {
    const n = node(id)
    if (n.color === color) return false
    n.color = color
    invalidate('appearance')
    return true
  }

  function setTransform(id, t) {
    const n = node(id)
    if (n.transform === t) return false
    n.transform = t
    invalidate('transform')
    return true
  }

  function useStyles(ready) {
    stylesReady = !!ready
    return stylesReady
  }

  function pending() {
    return { layout: dirty.layout, paint: dirty.paint, composite: dirty.composite }
  }

  function flush() {
    if (!stylesReady) {
      stats.stalls += 1
      return []
    }
    if (!dirty.layout && !dirty.paint && !dirty.composite) return []
    const tasks = []
    if (dirty.layout) tasks.push('layout')
    if (dirty.paint) tasks.push('paint')
    if (dirty.composite) tasks.push('composite')
    stats.frames += 1
    if (dirty.layout) stats.layout += 1
    if (dirty.paint) stats.paint += 1
    if (dirty.composite) stats.composite += 1
    dirty.layout = false
    dirty.paint = false
    dirty.composite = false
    return tasks
  }

  function snapshot() {
    return {
      frames: stats.frames,
      layout: stats.layout,
      paint: stats.paint,
      composite: stats.composite,
      stalls: stats.stalls,
      longTasks: stats.longTasks
    }
  }

  return {
    frameMs: frameMs,
    setHeight: setHeight,
    setColor: setColor,
    setTransform: setTransform,
    useStyles: useStyles,
    pending: pending,
    flush: flush,
    stats: snapshot
  }
}`,
      test: L1S1,
      diag: [
        '几何失效只置了 layout，忘了 paint / composite 也要跟着脏（重排之后必然要重画、重新合成）。',
        'setColor 走了 geometry 分支，导致 layout 被白跑一次；外观变化只该置 paint + composite。',
        'setTransform 也置了 paint 位；transform 只改变合成层的变换矩阵，主线程不该跑 paint。',
        'setHeight 里没做同值比较，或者 flush 没清空失效位，导致第二次 flush 仍然返回任务。',
        'flush 开头少了 stylesReady 判断，CSSOM 未就绪也进了 layout；stalls 也没累加。'
      ]
    },
    {
      n: 2,
      title: '接上事件循环：宏任务、微任务与渲染时机',
      think:
        '有了失效位，下一件事是决定「谁在一帧里跑」。真实浏览器每轮取一个宏任务、清空微任务、再判断是否渲染，而「是否渲染」由失效位和 vsync 节拍共同决定。这一步要把「一帧最多渲染一次」做成可观测的 painted 标记，否则后面算 INP 时根本分不清哪次绘制属于哪次交互。',
      hint:
        'run 里对每个宏任务：先跑 mutate 与 cost，再用 while 循环把微任务队列清空（m.then 要 concat 到队列尾部，保持同轮），最后判断 now - lastPaint >= frameMs 且存在失效位才调用 paint()。',
      code: `function createFrameLoop(opts) {
  const config = opts || {}
  const frameMs = config.frameMs || 16
  const paintCost = config.paintCost || 4
  const nodes = {}
  const dirty = { layout: false, paint: false, composite: false }
  const stats = { frames: 0, layout: 0, paint: 0, composite: 0, stalls: 0, longTasks: 0 }
  let stylesReady = false
  let now = 0
  let lastPaint = -1000000000

  function node(id) {
    if (!nodes[id]) nodes[id] = { id: id, height: 0, color: '', transform: 'none' }
    return nodes[id]
  }

  function invalidate(level) {
    if (level === 'geometry') {
      dirty.layout = true
      dirty.paint = true
      dirty.composite = true
    } else if (level === 'appearance') {
      dirty.paint = true
      dirty.composite = true
    } else {
      dirty.composite = true
    }
  }

  function setHeight(id, px) {
    const n = node(id)
    if (n.height === px) return false
    n.height = px
    invalidate('geometry')
    return true
  }

  function setColor(id, color) {
    const n = node(id)
    if (n.color === color) return false
    n.color = color
    invalidate('appearance')
    return true
  }

  function setTransform(id, t) {
    const n = node(id)
    if (n.transform === t) return false
    n.transform = t
    invalidate('transform')
    return true
  }

  function useStyles(ready) {
    stylesReady = !!ready
    return stylesReady
  }

  function pending() {
    return { layout: dirty.layout, paint: dirty.paint, composite: dirty.composite }
  }

  function flush() {
    if (!stylesReady) {
      stats.stalls += 1
      return []
    }
    if (!dirty.layout && !dirty.paint && !dirty.composite) return []
    const tasks = []
    if (dirty.layout) tasks.push('layout')
    if (dirty.paint) tasks.push('paint')
    if (dirty.composite) tasks.push('composite')
    stats.frames += 1
    if (dirty.layout) stats.layout += 1
    if (dirty.paint) stats.paint += 1
    if (dirty.composite) stats.composite += 1
    dirty.layout = false
    dirty.paint = false
    dirty.composite = false
    return tasks
  }

  // 一帧的渲染：跑流水线 + 光栅化（真实系统里光栅化在合成线程，这里算进主线程预算）
  function paint() {
    const tasks = flush()
    if (!tasks.length) return tasks
    now += paintCost
    lastPaint = now
    return tasks
  }

  function run(macros) {
    const list = macros || []
    const turns = []
    for (let t = 0; t < list.length; t++) {
      const macro = list[t] || {}
      const start = now
      if (typeof macro.mutate === 'function') macro.mutate()
      now += macro.cost || 0

      // 清空微任务：微任务里再登记微任务，仍在同一轮清空
      const micros = []
      let queue = (macro.microTasks || []).slice()
      let i = 0
      while (i < queue.length) {
        const m = queue[i] || {}
        if (typeof m.mutate === 'function') m.mutate()
        now += m.cost || 0
        micros.push(m.name || 'micro-' + i)
        if (Array.isArray(m.then)) queue = queue.concat(m.then)
        i += 1
      }

      // 渲染时机：有失效 + 距上次绘制至少一个 vsync 周期
      const due = now - lastPaint >= frameMs
      const dirtyNow = dirty.layout || dirty.paint || dirty.composite
      const tasks = due && dirtyNow ? paint() : []
      const isLong = now - start > 50
      if (isLong) stats.longTasks += 1
      turns.push({
        task: macro.name || 'task-' + t,
        start: start,
        end: now,
        micros: micros,
        painted: tasks.length > 0,
        tasks: tasks,
        long: isLong
      })
    }
    return turns
  }

  function snapshot() {
    return {
      frames: stats.frames,
      layout: stats.layout,
      paint: stats.paint,
      composite: stats.composite,
      stalls: stats.stalls,
      longTasks: stats.longTasks
    }
  }

  return {
    frameMs: frameMs,
    setHeight: setHeight,
    setColor: setColor,
    setTransform: setTransform,
    useStyles: useStyles,
    pending: pending,
    flush: flush,
    run: run,
    stats: snapshot,
    clock: function () { return now }
  }
}`,
      test: L1S2,
      diag: [
        '微任务只跑了第一层，没有把 m.then 里的微任务 concat 进队列，所以 micros 只有一条。',
        '绘制放在了清空微任务之前；同一轮里必须先让 DOM 定稿再画，任务列表也要以 layout 开头。',
        'run 里没有判断脏标记，每个宏任务都画一帧，导致 frames 白涨。',
        '帧节拍判断写成了 now - lastPaint > frameMs 却忘了 lastPaint 在 paint 里更新，或者两处都更新导致第二帧永远等不到。',
        'long task 判定漏了 > 50 的分界，或者统计写在 paint 之前导致 60ms 的任务没被计入。'
      ]
    },
    {
      n: 3,
      title: '输入帧：切片让出与 INP 口径',
      think:
        '最后把「人按了一下」放进来。同一个 100ms 的处理器，不切片时 INP 是 104ms，切片后第一次绘制落在 24ms——总工作量一点没变，但用户感知完全不同。这一步的关键是守住「INP 只算到第一次绘制」，presentedAt 一旦赋值就不能再被后面的切片覆盖，否则切片反而会把指标算大。',
      hint:
        'dispatch 先记 arrivedAt 再累加 queued，然后 while 循环按 slice 切：每片结束若存在脏标记就 paint 一次并记住首次 presentedAt；循环结束后如果还没呈现过，强制跑一次帧（交互必须等到下一次绘制才算结束）。',
      code: `function createFrameLoop(opts) {
  const config = opts || {}
  const frameMs = config.frameMs || 16
  const paintCost = config.paintCost || 4
  const nodes = {}
  const dirty = { layout: false, paint: false, composite: false }
  const stats = { frames: 0, layout: 0, paint: 0, composite: 0, stalls: 0, longTasks: 0 }
  const inputs = []
  let stylesReady = false
  let now = 0
  let lastPaint = -1000000000

  function node(id) {
    if (!nodes[id]) nodes[id] = { id: id, height: 0, color: '', transform: 'none' }
    return nodes[id]
  }

  function invalidate(level) {
    if (level === 'geometry') {
      dirty.layout = true
      dirty.paint = true
      dirty.composite = true
    } else if (level === 'appearance') {
      dirty.paint = true
      dirty.composite = true
    } else {
      dirty.composite = true
    }
  }

  function setHeight(id, px) {
    const n = node(id)
    if (n.height === px) return false
    n.height = px
    invalidate('geometry')
    return true
  }

  function setColor(id, color) {
    const n = node(id)
    if (n.color === color) return false
    n.color = color
    invalidate('appearance')
    return true
  }

  function setTransform(id, t) {
    const n = node(id)
    if (n.transform === t) return false
    n.transform = t
    invalidate('transform')
    return true
  }

  function useStyles(ready) {
    stylesReady = !!ready
    return stylesReady
  }

  function pending() {
    return { layout: dirty.layout, paint: dirty.paint, composite: dirty.composite }
  }

  function flush() {
    if (!stylesReady) {
      stats.stalls += 1
      return []
    }
    if (!dirty.layout && !dirty.paint && !dirty.composite) return []
    const tasks = []
    if (dirty.layout) tasks.push('layout')
    if (dirty.paint) tasks.push('paint')
    if (dirty.composite) tasks.push('composite')
    stats.frames += 1
    if (dirty.layout) stats.layout += 1
    if (dirty.paint) stats.paint += 1
    if (dirty.composite) stats.composite += 1
    dirty.layout = false
    dirty.paint = false
    dirty.composite = false
    return tasks
  }

  function paint() {
    const tasks = flush()
    if (!tasks.length) return tasks
    now += paintCost
    lastPaint = now
    return tasks
  }

  function run(macros) {
    const list = macros || []
    const turns = []
    for (let t = 0; t < list.length; t++) {
      const macro = list[t] || {}
      const start = now
      if (typeof macro.mutate === 'function') macro.mutate()
      now += macro.cost || 0

      const micros = []
      let queue = (macro.microTasks || []).slice()
      let i = 0
      while (i < queue.length) {
        const m = queue[i] || {}
        if (typeof m.mutate === 'function') m.mutate()
        now += m.cost || 0
        micros.push(m.name || 'micro-' + i)
        if (Array.isArray(m.then)) queue = queue.concat(m.then)
        i += 1
      }

      const due = now - lastPaint >= frameMs
      const dirtyNow = dirty.layout || dirty.paint || dirty.composite
      const tasks = due && dirtyNow ? paint() : []
      const isLong = now - start > 50
      if (isLong) stats.longTasks += 1
      turns.push({
        task: macro.name || 'task-' + t,
        start: start,
        end: now,
        micros: micros,
        painted: tasks.length > 0,
        tasks: tasks,
        long: isLong
      })
    }
    return turns
  }

  // 一次交互：事件到达 -> 可能排队 -> 处理器切片 -> 下一次绘制（INP 的终点）
  function dispatch(input) {
    const spec = input || {}
    const arrivedAt = now
    now += spec.queued || 0
    if (typeof spec.mutate === 'function') spec.mutate()

    const work = spec.work || 0
    const slice = spec.slice > 0 ? spec.slice : (work > 0 ? work : 1)
    const passive = spec.passive === true
    const applied = !passive && spec.preventDefault === true

    let remaining = work
    let slices = 0
    let presentedAt = -1
    let frames = 0
    const tasks = []

    while (remaining > 0) {
      const cost = Math.min(slice, remaining)
      remaining -= cost
      now += cost
      slices += 1
      // 每个切片结束都是一次让出：有脏标记就趁这个间隙画一帧
      if (dirty.layout || dirty.paint || dirty.composite) {
        const done = paint()
        for (let k = 0; k < done.length; k++) tasks.push(done[k])
        frames += 1
        if (presentedAt < 0) presentedAt = now
      }
    }

    // 即使处理器没改 DOM，交互也要等到「下一次绘制」才结束：
    // 没有脏标记时 flush 是空转，但提交合成器这一下仍然要花时间
    if (presentedAt < 0) {
      flush()
      now += paintCost
      lastPaint = now
      frames += 1
      presentedAt = now
    }

    const record = {
      name: spec.name || 'input',
      arrivedAt: arrivedAt,
      presentedAt: presentedAt,
      queued: spec.queued || 0,
      slices: slices,
      yields: slices - 1,
      frames: frames,
      passive: passive,
      applied: applied,
      inp: presentedAt - arrivedAt,
      tasks: tasks
    }
    if (record.inp > 50) stats.longTasks += 1
    inputs.push(record)
    return record
  }

  // INP 的口径：nearest-rank 取 P75
  function p75(values) {
    const list = (values || []).slice().sort(function (a, b) { return a - b })
    if (!list.length) return 0
    const idx = Math.ceil(list.length * 0.75) - 1
    return list[idx < 0 ? 0 : idx]
  }

  function snapshot() {
    return {
      frames: stats.frames,
      layout: stats.layout,
      paint: stats.paint,
      composite: stats.composite,
      stalls: stats.stalls,
      longTasks: stats.longTasks,
      inputs: inputs.length
    }
  }

  return {
    frameMs: frameMs,
    setHeight: setHeight,
    setColor: setColor,
    setTransform: setTransform,
    useStyles: useStyles,
    pending: pending,
    flush: flush,
    run: run,
    dispatch: dispatch,
    p75: p75,
    stats: snapshot,
    clock: function () { return now }
  }
}`,
      test: L1S3,
      diag: [
        'dispatch 里没有强制「处理器结束后至少绘制一次」，presentedAt 一直是 -1，inp 变成负数或 NaN。',
        '切片时每片都重算了 presentedAt，INP 被算成最后一次绘制，切片反而让指标变差。',
        'yields 写成了 slices，或者循环条件让最后一片没跑（remaining > 0 写成 >= 0）。',
        'passive 的判断写反了：passive:true 反而允许 preventDefault，滚动就会被错误地阻塞。',
        'p75 用了向下取整的下标（Math.floor(n*0.75)），4 个样本会取到第 4 个而正确的是第 3 个。'
      ]
    }
  ],
  skeleton: `function createFrameLoop(opts) {
  // 主线程模型：JS 执行与渲染共用一条线程。
  // TODO 第 1 步：三级失效位（几何 / 外观 / 仅合成）与 flush 的 layout → paint → composite
  // TODO 第 2 步：run 的事件循环：宏任务 → 清空微任务（递归同轮）→ 一帧最多渲染一次
  // TODO 第 3 步：dispatch 把长任务切片让出，统计排队与首绘时间算 INP
  // 返回 { invalidate, run, dispatch, stats }
  throw new Error('createFrameLoop 还没实现')
}`,
  solution: `function createFrameLoop(opts) {
  const config = opts || {}
  const frameMs = config.frameMs || 16
  const paintCost = config.paintCost || 4
  const nodes = {}
  const dirty = { layout: false, paint: false, composite: false }
  const stats = { frames: 0, layout: 0, paint: 0, composite: 0, stalls: 0, longTasks: 0 }
  const inputs = []
  let stylesReady = false
  let now = 0
  let lastPaint = -1000000000

  function node(id) {
    if (!nodes[id]) nodes[id] = { id: id, height: 0, color: '', transform: 'none' }
    return nodes[id]
  }

  function invalidate(level) {
    if (level === 'geometry') {
      dirty.layout = true
      dirty.paint = true
      dirty.composite = true
    } else if (level === 'appearance') {
      dirty.paint = true
      dirty.composite = true
    } else {
      dirty.composite = true
    }
  }

  function setHeight(id, px) {
    const n = node(id)
    if (n.height === px) return false
    n.height = px
    invalidate('geometry')
    return true
  }

  function setColor(id, color) {
    const n = node(id)
    if (n.color === color) return false
    n.color = color
    invalidate('appearance')
    return true
  }

  function setTransform(id, t) {
    const n = node(id)
    if (n.transform === t) return false
    n.transform = t
    invalidate('transform')
    return true
  }

  function useStyles(ready) {
    stylesReady = !!ready
    return stylesReady
  }

  function pending() {
    return { layout: dirty.layout, paint: dirty.paint, composite: dirty.composite }
  }

  function flush() {
    if (!stylesReady) {
      stats.stalls += 1
      return []
    }
    if (!dirty.layout && !dirty.paint && !dirty.composite) return []
    const tasks = []
    if (dirty.layout) tasks.push('layout')
    if (dirty.paint) tasks.push('paint')
    if (dirty.composite) tasks.push('composite')
    stats.frames += 1
    if (dirty.layout) stats.layout += 1
    if (dirty.paint) stats.paint += 1
    if (dirty.composite) stats.composite += 1
    dirty.layout = false
    dirty.paint = false
    dirty.composite = false
    return tasks
  }

  function paint() {
    const tasks = flush()
    if (!tasks.length) return tasks
    now += paintCost
    lastPaint = now
    return tasks
  }

  function run(macros) {
    const list = macros || []
    const turns = []
    for (let t = 0; t < list.length; t++) {
      const macro = list[t] || {}
      const start = now
      if (typeof macro.mutate === 'function') macro.mutate()
      now += macro.cost || 0

      const micros = []
      let queue = (macro.microTasks || []).slice()
      let i = 0
      while (i < queue.length) {
        const m = queue[i] || {}
        if (typeof m.mutate === 'function') m.mutate()
        now += m.cost || 0
        micros.push(m.name || 'micro-' + i)
        if (Array.isArray(m.then)) queue = queue.concat(m.then)
        i += 1
      }

      const due = now - lastPaint >= frameMs
      const dirtyNow = dirty.layout || dirty.paint || dirty.composite
      const tasks = due && dirtyNow ? paint() : []
      const isLong = now - start > 50
      if (isLong) stats.longTasks += 1
      turns.push({
        task: macro.name || 'task-' + t,
        start: start,
        end: now,
        micros: micros,
        painted: tasks.length > 0,
        tasks: tasks,
        long: isLong
      })
    }
    return turns
  }

  function dispatch(input) {
    const spec = input || {}
    const arrivedAt = now
    now += spec.queued || 0
    if (typeof spec.mutate === 'function') spec.mutate()

    const work = spec.work || 0
    const slice = spec.slice > 0 ? spec.slice : (work > 0 ? work : 1)
    const passive = spec.passive === true
    const applied = !passive && spec.preventDefault === true

    let remaining = work
    let slices = 0
    let presentedAt = -1
    let frames = 0
    const tasks = []

    while (remaining > 0) {
      const cost = Math.min(slice, remaining)
      remaining -= cost
      now += cost
      slices += 1
      if (dirty.layout || dirty.paint || dirty.composite) {
        const done = paint()
        for (let k = 0; k < done.length; k++) tasks.push(done[k])
        frames += 1
        if (presentedAt < 0) presentedAt = now
      }
    }

    if (presentedAt < 0) {
      flush()
      now += paintCost
      lastPaint = now
      frames += 1
      presentedAt = now
    }

    const record = {
      name: spec.name || 'input',
      arrivedAt: arrivedAt,
      presentedAt: presentedAt,
      queued: spec.queued || 0,
      slices: slices,
      yields: slices - 1,
      frames: frames,
      passive: passive,
      applied: applied,
      inp: presentedAt - arrivedAt,
      tasks: tasks
    }
    if (record.inp > 50) stats.longTasks += 1
    inputs.push(record)
    return record
  }

  function p75(values) {
    const list = (values || []).slice().sort(function (a, b) { return a - b })
    if (!list.length) return 0
    const idx = Math.ceil(list.length * 0.75) - 1
    return list[idx < 0 ? 0 : idx]
  }

  function snapshot() {
    return {
      frames: stats.frames,
      layout: stats.layout,
      paint: stats.paint,
      composite: stats.composite,
      stalls: stats.stalls,
      longTasks: stats.longTasks,
      inputs: inputs.length
    }
  }

  return {
    frameMs: frameMs,
    setHeight: setHeight,
    setColor: setColor,
    setTransform: setTransform,
    useStyles: useStyles,
    pending: pending,
    flush: flush,
    run: run,
    dispatch: dispatch,
    p75: p75,
    stats: snapshot,
    clock: function () { return now }
  }
}`,
  finalCode: `function createFrameLoop(opts) {
  const config = opts || {}
  const frameMs = config.frameMs || 16
  const paintCost = config.paintCost || 4
  const nodes = {}
  const dirty = { layout: false, paint: false, composite: false }
  const stats = { frames: 0, layout: 0, paint: 0, composite: 0, stalls: 0, longTasks: 0 }
  const inputs = []
  let stylesReady = false
  let now = 0
  let lastPaint = -1000000000

  function node(id) {
    if (!nodes[id]) nodes[id] = { id: id, height: 0, color: '', transform: 'none' }
    return nodes[id]
  }

  function invalidate(level) {
    if (level === 'geometry') {
      dirty.layout = true
      dirty.paint = true
      dirty.composite = true
    } else if (level === 'appearance') {
      dirty.paint = true
      dirty.composite = true
    } else {
      dirty.composite = true
    }
  }

  function setHeight(id, px) {
    const n = node(id)
    if (n.height === px) return false
    n.height = px
    invalidate('geometry')
    return true
  }

  function setColor(id, color) {
    const n = node(id)
    if (n.color === color) return false
    n.color = color
    invalidate('appearance')
    return true
  }

  function setTransform(id, t) {
    const n = node(id)
    if (n.transform === t) return false
    n.transform = t
    invalidate('transform')
    return true
  }

  function useStyles(ready) {
    stylesReady = !!ready
    return stylesReady
  }

  function pending() {
    return { layout: dirty.layout, paint: dirty.paint, composite: dirty.composite }
  }

  function flush() {
    if (!stylesReady) {
      stats.stalls += 1
      return []
    }
    if (!dirty.layout && !dirty.paint && !dirty.composite) return []
    const tasks = []
    if (dirty.layout) tasks.push('layout')
    if (dirty.paint) tasks.push('paint')
    if (dirty.composite) tasks.push('composite')
    stats.frames += 1
    if (dirty.layout) stats.layout += 1
    if (dirty.paint) stats.paint += 1
    if (dirty.composite) stats.composite += 1
    dirty.layout = false
    dirty.paint = false
    dirty.composite = false
    return tasks
  }

  function paint() {
    const tasks = flush()
    if (!tasks.length) return tasks
    now += paintCost
    lastPaint = now
    return tasks
  }

  function run(macros) {
    const list = macros || []
    const turns = []
    for (let t = 0; t < list.length; t++) {
      const macro = list[t] || {}
      const start = now
      if (typeof macro.mutate === 'function') macro.mutate()
      now += macro.cost || 0

      const micros = []
      let queue = (macro.microTasks || []).slice()
      let i = 0
      while (i < queue.length) {
        const m = queue[i] || {}
        if (typeof m.mutate === 'function') m.mutate()
        now += m.cost || 0
        micros.push(m.name || 'micro-' + i)
        if (Array.isArray(m.then)) queue = queue.concat(m.then)
        i += 1
      }

      const due = now - lastPaint >= frameMs
      const dirtyNow = dirty.layout || dirty.paint || dirty.composite
      const tasks = due && dirtyNow ? paint() : []
      const isLong = now - start > 50
      if (isLong) stats.longTasks += 1
      turns.push({
        task: macro.name || 'task-' + t,
        start: start,
        end: now,
        micros: micros,
        painted: tasks.length > 0,
        tasks: tasks,
        long: isLong
      })
    }
    return turns
  }

  function dispatch(input) {
    const spec = input || {}
    const arrivedAt = now
    now += spec.queued || 0
    if (typeof spec.mutate === 'function') spec.mutate()

    const work = spec.work || 0
    const slice = spec.slice > 0 ? spec.slice : (work > 0 ? work : 1)
    const passive = spec.passive === true
    const applied = !passive && spec.preventDefault === true

    let remaining = work
    let slices = 0
    let presentedAt = -1
    let frames = 0
    const tasks = []

    while (remaining > 0) {
      const cost = Math.min(slice, remaining)
      remaining -= cost
      now += cost
      slices += 1
      if (dirty.layout || dirty.paint || dirty.composite) {
        const done = paint()
        for (let k = 0; k < done.length; k++) tasks.push(done[k])
        frames += 1
        if (presentedAt < 0) presentedAt = now
      }
    }

    if (presentedAt < 0) {
      flush()
      now += paintCost
      lastPaint = now
      frames += 1
      presentedAt = now
    }

    const record = {
      name: spec.name || 'input',
      arrivedAt: arrivedAt,
      presentedAt: presentedAt,
      queued: spec.queued || 0,
      slices: slices,
      yields: slices - 1,
      frames: frames,
      passive: passive,
      applied: applied,
      inp: presentedAt - arrivedAt,
      tasks: tasks
    }
    if (record.inp > 50) stats.longTasks += 1
    inputs.push(record)
    return record
  }

  function p75(values) {
    const list = (values || []).slice().sort(function (a, b) { return a - b })
    if (!list.length) return 0
    const idx = Math.ceil(list.length * 0.75) - 1
    return list[idx < 0 ? 0 : idx]
  }

  function snapshot() {
    return {
      frames: stats.frames,
      layout: stats.layout,
      paint: stats.paint,
      composite: stats.composite,
      stalls: stats.stalls,
      longTasks: stats.longTasks,
      inputs: inputs.length
    }
  }

  return {
    frameMs: frameMs,
    setHeight: setHeight,
    setColor: setColor,
    setTransform: setTransform,
    useStyles: useStyles,
    pending: pending,
    flush: flush,
    run: run,
    dispatch: dispatch,
    p75: p75,
    stats: snapshot,
    clock: function () { return now }
  }
}`,
  tests: `${L1S1}\n${L1S2}\n${L1S3}`
}

/* ============================================================ 第 2 关：存储配额、Worker 与堆 */
const LV2 = {
  id: 'lv2',
  title: '离线缓存层：配额、Worker 与 GC',
  emoji: '🗄️',
  xp: 50,
  goal:
    '实现三层缓存基础设施：createStorage 按 UTF-16 字节记账、超配额抛 QuotaExceededError 且不破坏旧值；createStorageWorker 把写入搬进 Worker 队列，按预算 drain，区分结构化克隆与 Transferable 零拷贝，写失败只进 failed 列表；createHeap 模拟分代回收（Scavenge 复制 + 年龄晋升、老生代 Mark-Sweep），并用「回收后基线是否持续抬升」判定泄漏。',
  why:
    '「localStorage 存不下怎么办」这类问题真正考的是三件事：配额怎么算（key 算不算、一个字符几字节）、超了之后数据完整性怎么保、以及同步写入为什么会在低端机上卡死。答不出字节数的人，往往也不知道 5MB 是同源共享而不是单 key。\n\n再往下就是线程和内存：把写入搬进 Worker 时，postMessage 的结构化克隆是要付费的（大对象整份复制），只有 Transferable 才是零拷贝；而缓存层最容易变成内存泄漏的重灾区——Map 无限增长、监听器忘了摘、对象被闭包攥住。所以这一关把「配额 → 卸载 → 回收」串成一条链：先能记账，再能把写入挪出主线程，最后能看懂为什么回收之后的基线还在往上爬。',
  nodes: [
    'fe.browser.storage',
    'fe.browser.storage.local',
    'fe.browser.worker.thread',
    'fe.browser.v8',
    'fe.browser.v8.engine',
    'fe.browser.v8.memory'
  ],
  thinking: [
    {
      title: '选型先看生命周期和线程模型，再看容量',
      md:
        '存储家族对比我习惯按三列排：容量、生命周期、是否阻塞主线程。\n\n- Cookie：4KB/条，随同域请求自动携带，可设 HttpOnly（JS 读不到，防 XSS 偷 token）与 SameSite（防 CSRF），但每个请求都背着它，只适合放会话标识；\n- localStorage：约 5MB/同源，永久直到手动清，同步 API——写 2MB 的 JSON 就是一次主线程停顿；\n- sessionStorage：同源同标签页，会话级，复制标签页会带过去；\n- IndexedDB：异步事务、可建索引、能存 File/Blob，配额按磁盘比例给，适合真正的离线数据。\n\n所以这一关的缓存层只做「小而热」的键值 + 一条 Worker 通道处理大对象，不是因为 localStorage 好用，而是因为它够小、够快、典型到值得把它的边界写清楚。真存附件就走 IndexedDB，别硬塞 localStorage。'
    },
    {
      title: '为什么配额要按字节算，而且必须「先算再写」',
      md:
        'localStorage 存的永远是字符串，且规范按 UTF-16 计量，一个字符 2 字节——所以 5MB 配额其实只装得下约 250 万个字符（中文按字符算，不按 UTF-8 字节算，这点常被说反）。key 也占配额，这一点几乎所有人第一次都漏。\n\n更关键的是顺序：必须先把「这次写入之后的总量」算出来再决定要不要写。如果先写后检查，超配额时数据已经被改坏，catch 只能吞掉异常，用户读到的是半份新半份旧。测试里专门有一条：写入失败后 get 到的仍是旧值、used 不变。\n\n顺带一个反直觉点：给同一个 key 写更短的值，用量会回落。按差值计费而不是按「整份重算」，既省事又和浏览器行为一致。'
    },
    {
      title: '结构化克隆是收费的，Transferable 才是免费通道',
      md:
        'postMessage 传对象不是「把引用递过去」，而是结构化克隆：整份数据在两侧各有一份副本，成本随体积线性增长。你传一个 10MB 的 TypedArray，主线程就要为这次复制付出可观的毫秒数——本来是为了不卡主线程才搬进 Worker，结果卡在传输上。\n\nTransferable（ArrayBuffer、OffscreenCanvas、MessagePort）是唯一零拷贝的通道：所有权转移，原来的对象在发送侧变成 detached（byteLength 归零）。\n\n这一关的 drain 用「预算」模拟这件事：克隆消息要花预算、预算不够就留到下一个 tick；Transferable 消息不花预算，所以额度再小也能立刻处理。这正好解释了为什么大图处理要走 ImageBitmap/OffscreenCanvas 而不是把 ImageData 拷来拷去。'
    },
    {
      title: '泄漏判定为什么必须看基线，而不是峰值',
      md:
        'GC 之后堆会回落，正常应用的堆形状是锯齿：涨上去、回收、再涨。看峰值会把「业务本来就要缓存 50MB」误判成泄漏。所以判定要看每次 full GC 之后的**锯齿底**：如果底在持续抬升，说明每一轮都有东西被留下来。\n\n这也是 DevTools 里 Heap Snapshot 要拍三张比对的原因：单张只能看谁大，三张才能看谁在涨（Retained Size 增长）。\n\n在模拟器里我把「回收之后的 oldBytes」记成 baseline，leakTrend 只要每一步都比上一步高就判 leaking。第 3 步还会看到另一面：一个对象即使已经不可达，只要你还攥着引用（release 没调），它就永远在基线里——这就是闭包持有大对象、Map 当缓存、detached DOM 的同一副面孔。'
    }
  ],
  prereq: [
    {
      title: 'localStorage 的同步语义与配额边界',
      md:
        'localStorage 是最简单的同步 KV：`setItem/getItem/removeItem/clear/key/length`，值一律字符串。同步意味着调用即写盘，主线程在等 IO，写大 value 直接掉帧。\n\n配额是「同源共享」的约 5MB，不是每个 key 5MB；超了浏览器抛 `QuotaExceededError`（DOMException）。\n\n```js\ntry {\n  localStorage.setItem("doc", JSON.stringify(big))\n} catch (e) {\n  if (e.name === "QuotaExceededError") evictOldest()   // 先腾地方再重试\n}\n```\n\n还有一点必须知道：localStorage 没有变更通知，多标签一致性要靠 `storage` 事件（只在**其他**标签页触发，本页不触发）或 BroadcastChannel 自建。'
    },
    {
      title: 'Worker 的边界：没有 DOM，只有消息',
      md:
        'Dedicated Worker 是一个独立线程、独立全局环境：没有 document/window，不能碰 DOM，能用的只有 fetch、IndexedDB、crypto、WebSocket 这些。它的通信只有 postMessage / onmessage，且消息要过结构化克隆。\n\nSharedWorker 同源多标签共享一个实例（协作光标、连接复用），Service Worker 是网络拦截层（install/fetch/activate 生命周期，必须有 HTTPS），Worklet 是渲染管线里的小回调（音频、CSS paint）。三者的共同点：都在主线程之外，都靠消息进出。\n\n所以「把计算搬进 Worker」真正的成本不在计算，而在两次序列化：输入进去一次、结果出来一次。数据量大就该用 Transferable，或者干脆用 SharedArrayBuffer + Atomics（需要 COOP/COEP 跨源隔离头）。'
    },
    {
      title: 'V8 的分代假设与两种回收器',
      md:
        'V8 的堆分新生代和老生代，依据是「大部分对象朝生夕死」这个分代假设。\n\n- 新生代用 Scavenge：把存活对象从 from-space 复制到 to-space，然后整块清空 from-space。复制成本只和存活量有关，所以「死的多」时极快；活过一次的对象年龄 +1，够老就晋升老生代。\n- 老生代用 Mark-Sweep-Compact：三色标记（白未访问 / 灰待处理 / 黑已确认存活），标记完把白色对象回收，碎片多了再压缩。为了不让主线程长时间停顿，标记是增量+并发做的，靠写屏障记录「黑色对象指向白色对象」的变更（否则会把活对象当垃圾收掉）。\n\n判定泄漏的方法因此变成：看每次 full GC 之后的存活量（黑色对象的字节数）是不是在涨。'
    }
  ],
  api: [
    {
      name: 'createStorage',
      sig: 'createStorage(opts?: { quotaKB?: number }) => { set, get, remove, keys, info, clear }',
      args:
        'quotaKB 是同源配额（默认 5KB 的倍数表示法：5 * 1024 字节；传 0 表示不给任何空间）。key/value 都会被 String() 化，按 UTF-16 一个字符 2 字节计量，key 也计入。',
      returns:
        'set(key, value) 成功返回 true，超配额抛 name 为 QuotaExceededError 的 Error 且不改动已有数据；get 缺失返回 null；remove 删除成功返回 true，不存在返回 false；info() 返回 { used, quota, count, ratio }。',
      example:
        'const st = createStorage({ quotaKB: 1 })\nst.set("a", "x".repeat(510))   // (1 + 510) * 2 = 1022 字节\nst.info().used                // 1022\nst.set("b", "y")              // 抛 QuotaExceededError（再加 4 字节就超 1024）\nst.get("a").length            // 510：失败的写入没有动旧值'
    },
    {
      name: 'createStorageWorker',
      sig: 'createStorageWorker(storage, opts?) => { post, drain, takeEvents, stats, failed }',
      args:
        'storage 是上面那层；post(message, transfer) 的 message 是 { key, value, transfer? }，第二个参数为 true（或 message.transfer 为 true）表示走 Transferable；drain(budgetKB) 的预算是这一次同步处理最多能花的克隆字节数。',
      returns:
        'drain 返回 { done, spent, pending }；takeEvents() 取走并清空已产生的 storage 事件（{ key, oldValue, newValue }）；stats() 返回 { handled, pending, clonedBytes, transferredBytes, events, failed }。写失败的消息进 failed 数组，不会向主线程抛错。',
      example:
        'const st = createStorage({ quotaKB: 64 })\nconst w = createStorageWorker(st)\nw.post({ key: "cart", value: "v1" })\nw.post({ key: "big", value: "x".repeat(298) }, true)\nw.drain(1)\nw.stats()   // { handled: 2, clonedBytes: 10, transferredBytes: 600, ... }'
    },
    {
      name: 'createHeap',
      sig: 'createHeap(opts?: { promoteAge?: number }) => { alloc, release, scavenge, markSweep, snapshot, leakTrend }',
      args:
        'promoteAge 是晋升老生代所需的年龄（默认 2，即活过两轮 Scavenge）。alloc(size, tag) 分配一个对象，release(obj) 把它标成不可达（真实系统里是引用消失，这里显式化）。',
      returns:
        'scavenge() 返回 { survivors, promoted, collected }，只统计本轮；markSweep() 返回 { collected, freedBytes, oldBytes } 并记录一次回收后基线；snapshot() 给出各代数量与字节；leakTrend(list?) 返回 { leaking, growth, rises }，leaking 为真表示回收后基线每一步都在抬升。',
      example:
        'const h = createHeap({ promoteAge: 2 })\nconst a = h.alloc(10, "cache")\nh.scavenge(); h.scavenge()      // a 晋升老生代\nh.release(a); h.markSweep()     // 回收 10 字节，oldBytes 归零\nh.leakTrend()                   // 基线没抬升 -> leaking: false'
    }
  ],
  usage:
    '这一关的三层可以按真实链路直接拼起来：\n\n```js\nconst st = createStorage({ quotaKB: 5 * 1024 })\nconst worker = createStorageWorker(st)\n\n// 主线程只负责登记，不在主线程序列化大对象\nfunction saveSnapshot(key, data) {\n  worker.post({ key, value: JSON.stringify(data) })\n  worker.drain(128)                 // 每个空闲片处理 128KB，超出的留到下个 tick\n}\n\n// 每帧末尾检查积压\nfunction onIdle() {\n  const r = worker.drain(128)\n  if (r.pending > 0) requestIdleCallback(onIdle)\n  for (const ev of worker.takeEvents()) broadcastToOtherTabs(ev)   // 对齐 storage 事件\n}\n```\n\n真实系统里 worker.drain 对应 Worker 线程里的 `onmessage` 队列，budget 对应一次 `scheduler.yield()` 的时间片；takeEvents 对应你在 Worker 里写完 IndexedDB 后 `postMessage` 回主线程通知其他标签页（或直接用 BroadcastChannel）。',
  hints: [
    '第 1 步：先写 bytesOf(key, value) = (key.length + value.length) * 2，set 里算出 delta 再和 quota 比较，差值可能为负（覆盖成更短的值）。',
    '第 2 步：drain 是 while 循环 + 预算累加，注意「已处理至少一条」才允许因为预算不足 break，否则预算小于单条时会永远卡住。',
    '第 3 步：scavenge 用两个数组（keep 与 old）分流，markSweep 只扫老生代；baselines 在每次 markSweep 末尾 push 一次 oldBytes。'
  ],
  concepts: [
    {
      title: '为什么所有缓存层最后都要有「淘汰策略」',
      md:
        '配额是硬上限，缓存是软目标，两者之间只能靠淘汰来调和。localStorage 的做法是抛错让业务自己腾地方；IndexedDB 在配额吃紧时由浏览器按 LRU/来源清理整个源的数据（且不可依赖）；Service Worker 的 Cache Storage 需要你自己版本化——旧版本 cache 不清，用户磁盘会被历次发布撑爆。\n\n共同结论：缓存层必须自带容量上限 + 淘汰顺序（LRU / 按大小 / 按 TTL），并且淘汰要能触发一次 compaction。没有淘汰的 Map 缓存是内存泄漏最经典的形态，和这一关第 3 步的 leaking 判定是同一件事。'
    },
    {
      title: '这个模拟器简化了什么',
      md:
        '1. 存储的 key 顺序：真实 localStorage 按插入序迭代，这里用 Map 也是插入序，但删了再插会变成队尾——真实的顺序行为各家实现有差异，别指望它。\n2. Worker 没有真正的线程：drain 是同步函数，用预算模拟「一次时间片能处理多少」。真实 Worker 的队列由浏览器调度，主线程只负责 postMessage。\n3. GC 没有写屏障和三色不变式：release 是显式置位，真实系统靠可达性分析。所以这里的「泄漏」只能演示「引用没释放」这一类，演示不了「闭包里意外捕获」。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '先按字节记账：配额与字符串化',
      think:
        '先把「能不能写进去」这一层钉死，因为后续 Worker 和堆都建立在「写入会成功或可预期地失败」上。这一步的验收点全在边界：key 算不算配额、一个字符几字节、覆盖写怎么计费、失败后旧值是否完好。把这些数字写对，才谈得上淘汰策略。',
      hint:
        'bytesOf 用 (String(key).length + String(value).length) * 2；set 先算 delta（覆盖时减去旧值的字节）再判断 used + delta > quota，抛错要在 data.set 之前。',
      vocab: [
        { term: 'QuotaExceededError', desc: '写入超出同源配额时抛出的 DOMException，name 就是 QuotaExceededError' },
        { term: 'UTF-16', desc: 'JS 字符串的内部编码；localStorage 配额按字符数 * 2 字节计量' }
      ],
      code: `function createStorage(opts) {
  const config = opts || {}
  const quotaKB = config.quotaKB != null ? config.quotaKB : 5
  const quotaBytes = quotaKB * 1024
  const data = new Map()
  let usedBytes = 0

  // localStorage 里一切都是字符串，且按 UTF-16 计费：一个字符 2 字节，key 也占配额
  function bytesOf(key, value) {
    return (String(key).length + String(value).length) * 2
  }

  function get(key) {
    const k = String(key)
    return data.has(k) ? data.get(k) : null
  }

  function set(key, value) {
    const k = String(key)
    const v = String(value)
    const old = data.has(k) ? bytesOf(k, data.get(k)) : 0
    const delta = bytesOf(k, v) - old
    // 先算再写：超配额时一个字节都不能落盘，否则旧值被改成半份新数据
    if (usedBytes + delta > quotaBytes) {
      const err = new Error('QuotaExceededError')
      err.name = 'QuotaExceededError'
      throw err
    }
    data.set(k, v)
    usedBytes += delta
    return true
  }

  function remove(key) {
    const k = String(key)
    if (!data.has(k)) return false
    usedBytes -= bytesOf(k, data.get(k))
    data.delete(k)
    return true
  }

  function keys() {
    return Array.from(data.keys())
  }

  function info() {
    return {
      used: usedBytes,
      quota: quotaBytes,
      count: data.size,
      ratio: quotaBytes > 0 ? usedBytes / quotaBytes : 0
    }
  }

  function clear() {
    data.clear()
    usedBytes = 0
  }

  return { set: set, get: get, remove: remove, keys: keys, info: info, clear: clear }
}

// 存储选型：容量 / 生命周期 / 是否阻塞主线程，三列一过就知道该选谁
function pickStorage(need) {
  const n = need || {}
  const size = n.size || 0
  if (n.perRequest) return 'cookie'
  if (n.blob) return 'indexeddb'
  if (size > 5 * 1024 * 1024) return 'indexeddb'
  if (n.session) return 'sessionStorage'
  return 'localStorage'
}`,
      test: L2S1,
      diag: [
        'set 里没有 String(value)，存进去的还是数字，get 回来不等于字符串。',
        '覆盖写时没减掉旧值的字节（或没算 key 的字节），用量只涨不落。',
        'bytesOf 用了 value.length（单字节），少乘 2，1KB 边界那条就压不住。',
        '先 data.set 再判断配额，超配额时旧值已经被覆盖，get 拿不到原数据。',
        'remove 没扣减 usedBytes（或没判 has 直接 delete），用量对不上且删除返回值错。',
        'pickStorage 没把「随请求携带」放在第一位，或者 5MB 阈值写成了 5 * 1000 * 1000 这类近似值。'
      ]
    },
    {
      n: 2,
      title: '把写入搬进 Worker：克隆、预算与失败隔离',
      think:
        '主线程不该为大 value 付序列化的钱，所以写入进队列、按预算处理。这一步真正要证明的是三件事：队列是 FIFO 的；预算不够就留到下一轮而不是丢；Transferable 不花克隆预算。再加一条真实边界——Worker 里写失败不能把异常抛回主线程，只能进失败列表。',
      hint:
        'drain 用 while (queue.length > 0)，先取 queue[0] 算 size，只有「已处理过至少一条」且非 transfer 且超预算时才 break，然后 shift、计费、try/catch 写入。',
      code: `function createStorage(opts) {
  const config = opts || {}
  const quotaKB = config.quotaKB != null ? config.quotaKB : 5
  const quotaBytes = quotaKB * 1024
  const data = new Map()
  let usedBytes = 0

  function bytesOf(key, value) {
    return (String(key).length + String(value).length) * 2
  }

  function get(key) {
    const k = String(key)
    return data.has(k) ? data.get(k) : null
  }

  function set(key, value) {
    const k = String(key)
    const v = String(value)
    const old = data.has(k) ? bytesOf(k, data.get(k)) : 0
    const delta = bytesOf(k, v) - old
    if (usedBytes + delta > quotaBytes) {
      const err = new Error('QuotaExceededError')
      err.name = 'QuotaExceededError'
      throw err
    }
    data.set(k, v)
    usedBytes += delta
    return true
  }

  function remove(key) {
    const k = String(key)
    if (!data.has(k)) return false
    usedBytes -= bytesOf(k, data.get(k))
    data.delete(k)
    return true
  }

  function keys() {
    return Array.from(data.keys())
  }

  function info() {
    return {
      used: usedBytes,
      quota: quotaBytes,
      count: data.size,
      ratio: quotaBytes > 0 ? usedBytes / quotaBytes : 0
    }
  }

  function clear() {
    data.clear()
    usedBytes = 0
  }

  return { set: set, get: get, remove: remove, keys: keys, info: info, clear: clear }
}

// 存储选型：容量 / 生命周期 / 是否阻塞主线程，三列一过就知道该选谁
function pickStorage(need) {
  const n = need || {}
  const size = n.size || 0
  if (n.perRequest) return 'cookie'
  if (n.blob) return 'indexeddb'
  if (size > 5 * 1024 * 1024) return 'indexeddb'
  if (n.session) return 'sessionStorage'
  return 'localStorage'
}

function createStorageWorker(storage, opts) {
  const config = opts || {}
  const queue = []
  const events = []
  const failed = []
  let handled = 0
  let clonedBytes = 0
  let transferredBytes = 0

  // postMessage 的成本 = 结构化克隆（整份复制）；Transferable 只转移所有权，零拷贝
  function post(message, transfer) {
    const msg = message || {}
    const isTransfer = transfer === true || msg.transfer === true
    queue.push({ key: String(msg.key), value: String(msg.value), transfer: isTransfer })
    return queue.length
  }

  function drain(budgetKB) {
    const budget = (budgetKB != null ? budgetKB : 64) * 1024
    let spent = 0
    let done = 0
    while (queue.length > 0) {
      const msg = queue[0]
      const size = (msg.key.length + msg.value.length) * 2
      // 至少处理一条再考虑预算，否则额度小于单条时会永远卡死
      if (!msg.transfer && done > 0 && spent + size > budget) break
      queue.shift()
      if (msg.transfer) {
        transferredBytes += size
      } else {
        clonedBytes += size
        spent += size
      }
      try {
        const old = storage.get(msg.key)
        storage.set(msg.key, msg.value)
        events.push({ key: msg.key, oldValue: old, newValue: msg.value })
      } catch (e) {
        failed.push({ key: msg.key, reason: e.name || 'Error' })
      }
      done += 1
      handled += 1
    }
    return { done: done, spent: spent, pending: queue.length }
  }

  function takeEvents() {
    return events.splice(0, events.length)
  }

  function stats() {
    return {
      handled: handled,
      pending: queue.length,
      clonedBytes: clonedBytes,
      transferredBytes: transferredBytes,
      events: events.length,
      failed: failed.length
    }
  }

  return {
    post: post,
    drain: drain,
    takeEvents: takeEvents,
    stats: stats,
    failed: failed
  }
}`,
      test: L2S2,
      diag: [
        'drain 用了 pop 而不是 shift，处理顺序变成 LIFO，storage 事件的老新值也就错位了。',
        '预算判断少了 done > 0 的保护，额度小于单条消息时一条都处理不了（死循环或永远 pending）。',
        'Transferable 消息也累加进 clonedBytes 并被预算拦住；transfer 分支应该跳过计费与 break。',
        'storage.set 没包 try/catch，超配额异常直接抛到调用方，一条坏消息炸掉整批。',
        'takeEvents 用了 slice 而不是 splice，取完不清空，第二次还能取到同一批事件。'
      ]
    },
    {
      n: 3,
      title: '分代回收：Scavenge、Mark 与泄漏基线',
      think:
        '缓存淘汰之后，对象在堆上才是真的「死」。这一步要证明两件平时只能靠背的事：新生代复制式回收只按存活量付费、老生代要活过两轮才晋升；以及泄漏判定必须用「回收后基线」而不是峰值——同一份数据，峰值高只是缓存大，基线涨才是有人攥着不放。',
      hint:
        'young/old 两个数组；scavenge 遍历 young，死对象计 collected，活对象 age+1，age >= promoteAge 的塞进 old，其余留在 keep；markSweep 只扫 old，末尾记一次 oldBytes 进 baselines。',
      vocab: [
        { term: 'Scavenge', desc: '新生代复制式回收：存活对象搬到 to-space，from-space 整块丢弃' },
        { term: '晋升', desc: '对象活过足够多次新生代回收后转入老生代，此后由 Mark-Sweep 管理' }
      ],
      code: `function createStorage(opts) {
  const config = opts || {}
  const quotaKB = config.quotaKB != null ? config.quotaKB : 5
  const quotaBytes = quotaKB * 1024
  const data = new Map()
  let usedBytes = 0

  function bytesOf(key, value) {
    return (String(key).length + String(value).length) * 2
  }

  function get(key) {
    const k = String(key)
    return data.has(k) ? data.get(k) : null
  }

  function set(key, value) {
    const k = String(key)
    const v = String(value)
    const old = data.has(k) ? bytesOf(k, data.get(k)) : 0
    const delta = bytesOf(k, v) - old
    if (usedBytes + delta > quotaBytes) {
      const err = new Error('QuotaExceededError')
      err.name = 'QuotaExceededError'
      throw err
    }
    data.set(k, v)
    usedBytes += delta
    return true
  }

  function remove(key) {
    const k = String(key)
    if (!data.has(k)) return false
    usedBytes -= bytesOf(k, data.get(k))
    data.delete(k)
    return true
  }

  function keys() {
    return Array.from(data.keys())
  }

  function info() {
    return {
      used: usedBytes,
      quota: quotaBytes,
      count: data.size,
      ratio: quotaBytes > 0 ? usedBytes / quotaBytes : 0
    }
  }

  function clear() {
    data.clear()
    usedBytes = 0
  }

  return { set: set, get: get, remove: remove, keys: keys, info: info, clear: clear }
}

// 存储选型：容量 / 生命周期 / 是否阻塞主线程，三列一过就知道该选谁
function pickStorage(need) {
  const n = need || {}
  const size = n.size || 0
  if (n.perRequest) return 'cookie'
  if (n.blob) return 'indexeddb'
  if (size > 5 * 1024 * 1024) return 'indexeddb'
  if (n.session) return 'sessionStorage'
  return 'localStorage'
}

function createStorageWorker(storage, opts) {
  const config = opts || {}
  const queue = []
  const events = []
  const failed = []
  let handled = 0
  let clonedBytes = 0
  let transferredBytes = 0

  function post(message, transfer) {
    const msg = message || {}
    const isTransfer = transfer === true || msg.transfer === true
    queue.push({ key: String(msg.key), value: String(msg.value), transfer: isTransfer })
    return queue.length
  }

  function drain(budgetKB) {
    const budget = (budgetKB != null ? budgetKB : 64) * 1024
    let spent = 0
    let done = 0
    while (queue.length > 0) {
      const msg = queue[0]
      const size = (msg.key.length + msg.value.length) * 2
      if (!msg.transfer && done > 0 && spent + size > budget) break
      queue.shift()
      if (msg.transfer) {
        transferredBytes += size
      } else {
        clonedBytes += size
        spent += size
      }
      try {
        const old = storage.get(msg.key)
        storage.set(msg.key, msg.value)
        events.push({ key: msg.key, oldValue: old, newValue: msg.value })
      } catch (e) {
        failed.push({ key: msg.key, reason: e.name || 'Error' })
      }
      done += 1
      handled += 1
    }
    return { done: done, spent: spent, pending: queue.length }
  }

  function takeEvents() {
    return events.splice(0, events.length)
  }

  function stats() {
    return {
      handled: handled,
      pending: queue.length,
      clonedBytes: clonedBytes,
      transferredBytes: transferredBytes,
      events: events.length,
      failed: failed.length
    }
  }

  return { post: post, drain: drain, takeEvents: takeEvents, stats: stats, failed: failed }
}

function createHeap(opts) {
  const config = opts || {}
  const promoteAge = config.promoteAge || 2
  const young = []
  const old = []
  const baselines = []
  const stats = { scavenges: 0, marks: 0, collected: 0, promoted: 0, freedBytes: 0 }
  let nextId = 1

  function alloc(size, tag) {
    const obj = { id: nextId, size: size || 1, tag: tag || 'obj', age: 0, alive: true }
    nextId += 1
    young.push(obj)
    return obj
  }

  function release(obj) {
    if (obj) obj.alive = false
    return obj
  }

  function bytesOf(list) {
    let n = 0
    for (let i = 0; i < list.length; i++) n += list[i].size
    return n
  }

  // 新生代：复制存活对象，清空 from-space；活过一次长一岁，够老就晋升
  function scavenge() {
    stats.scavenges += 1
    const keep = []
    let collected = 0
    let promotedNow = 0
    for (let i = 0; i < young.length; i++) {
      const o = young[i]
      if (!o.alive) {
        collected += 1
        continue
      }
      o.age += 1
      if (o.age >= promoteAge) {
        old.push(o)
        promotedNow += 1
        stats.promoted += 1
      } else {
        keep.push(o)
      }
    }
    young.length = 0
    for (let i = 0; i < keep.length; i++) young.push(keep[i])
    stats.collected += collected
    return { survivors: keep.length, promoted: promotedNow, collected: collected }
  }

  // 老生代：三色标记之后，没被染黑的直接回收（这里用 alive 位代替标记位）
  function markSweep() {
    stats.marks += 1
    const keep = []
    let freed = 0
    let collected = 0
    for (let i = 0; i < old.length; i++) {
      const o = old[i]
      if (o.alive) keep.push(o)
      else {
        freed += o.size
        collected += 1
      }
    }
    old.length = 0
    for (let i = 0; i < keep.length; i++) old.push(keep[i])
    stats.collected += collected
    stats.freedBytes += freed
    // 每次全量回收之后的存活字节 = 锯齿的底部，泄漏判定就看这条线
    baselines.push(bytesOf(old))
    return { collected: collected, freedBytes: freed, oldBytes: bytesOf(old) }
  }

  function snapshot() {
    return {
      young: young.length,
      old: old.length,
      youngBytes: bytesOf(young),
      oldBytes: bytesOf(old),
      live: young.length + old.length,
      collected: stats.collected,
      promoted: stats.promoted,
      freedBytes: stats.freedBytes,
      scavenges: stats.scavenges,
      marks: stats.marks
    }
  }

  function leakTrend(list) {
    const values = (list || baselines).slice()
    if (values.length < 2) return { leaking: false, growth: 0, rises: 0 }
    let rises = 0
    for (let i = 1; i < values.length; i++) {
      if (values[i] > values[i - 1]) rises += 1
    }
    const growth = values[values.length - 1] - values[0]
    return { leaking: rises === values.length - 1 && growth > 0, growth: growth, rises: rises }
  }

  return {
    alloc: alloc,
    release: release,
    scavenge: scavenge,
    markSweep: markSweep,
    snapshot: snapshot,
    leakTrend: leakTrend,
    baselines: baselines
  }
}`,
      test: L2S3,
      diag: [
        'scavenge 里把死对象的 age 也加了 1，或者 survivors 统计了全部 young 长度。',
        '晋升判断写成了 age > promoteAge，活过两轮的对象要等到第三轮才进老生代。',
        'markSweep 只删了数组元素没累计 freedBytes，或者把存活字节算在回收之前。',
        'leakTrend 用了 >= 判断（持平也算涨），或者只看首尾差值不看每一步是否都抬升。',
        'survivors 把已晋升的对象也算进去了，导致 survivors + promoted 大于本轮存活数。'
      ]
    }
  ],
  skeleton: `function createStorage(opts) {
  // TODO: 字节计量 + 配额检查 + 差值计费
  throw new Error('createStorage 还没实现')
}

function createStorageWorker(storage, opts) {
  // TODO: 消息队列 + 预算 drain + 克隆/转移计费
  throw new Error('createStorageWorker 还没实现')
}

function createHeap(opts) {
  // TODO: 新生代 Scavenge + 老生代 Mark-Sweep + 泄漏基线
  throw new Error('createHeap 还没实现')
}`,
  solution: `function createStorage(opts) {
  const config = opts || {}
  const quotaKB = config.quotaKB != null ? config.quotaKB : 5
  const quotaBytes = quotaKB * 1024
  const data = new Map()
  let usedBytes = 0

  function bytesOf(key, value) {
    return (String(key).length + String(value).length) * 2
  }

  function get(key) {
    const k = String(key)
    return data.has(k) ? data.get(k) : null
  }

  function set(key, value) {
    const k = String(key)
    const v = String(value)
    const old = data.has(k) ? bytesOf(k, data.get(k)) : 0
    const delta = bytesOf(k, v) - old
    if (usedBytes + delta > quotaBytes) {
      const err = new Error('QuotaExceededError')
      err.name = 'QuotaExceededError'
      throw err
    }
    data.set(k, v)
    usedBytes += delta
    return true
  }

  function remove(key) {
    const k = String(key)
    if (!data.has(k)) return false
    usedBytes -= bytesOf(k, data.get(k))
    data.delete(k)
    return true
  }

  function keys() {
    return Array.from(data.keys())
  }

  function info() {
    return {
      used: usedBytes,
      quota: quotaBytes,
      count: data.size,
      ratio: quotaBytes > 0 ? usedBytes / quotaBytes : 0
    }
  }

  function clear() {
    data.clear()
    usedBytes = 0
  }

  return { set: set, get: get, remove: remove, keys: keys, info: info, clear: clear }
}

// 存储选型：容量 / 生命周期 / 是否阻塞主线程，三列一过就知道该选谁
function pickStorage(need) {
  const n = need || {}
  const size = n.size || 0
  if (n.perRequest) return 'cookie'
  if (n.blob) return 'indexeddb'
  if (size > 5 * 1024 * 1024) return 'indexeddb'
  if (n.session) return 'sessionStorage'
  return 'localStorage'
}

function createStorageWorker(storage, opts) {
  const config = opts || {}
  const queue = []
  const events = []
  const failed = []
  let handled = 0
  let clonedBytes = 0
  let transferredBytes = 0

  function post(message, transfer) {
    const msg = message || {}
    const isTransfer = transfer === true || msg.transfer === true
    queue.push({ key: String(msg.key), value: String(msg.value), transfer: isTransfer })
    return queue.length
  }

  function drain(budgetKB) {
    const budget = (budgetKB != null ? budgetKB : 64) * 1024
    let spent = 0
    let done = 0
    while (queue.length > 0) {
      const msg = queue[0]
      const size = (msg.key.length + msg.value.length) * 2
      if (!msg.transfer && done > 0 && spent + size > budget) break
      queue.shift()
      if (msg.transfer) {
        transferredBytes += size
      } else {
        clonedBytes += size
        spent += size
      }
      try {
        const old = storage.get(msg.key)
        storage.set(msg.key, msg.value)
        events.push({ key: msg.key, oldValue: old, newValue: msg.value })
      } catch (e) {
        failed.push({ key: msg.key, reason: e.name || 'Error' })
      }
      done += 1
      handled += 1
    }
    return { done: done, spent: spent, pending: queue.length }
  }

  function takeEvents() {
    return events.splice(0, events.length)
  }

  function stats() {
    return {
      handled: handled,
      pending: queue.length,
      clonedBytes: clonedBytes,
      transferredBytes: transferredBytes,
      events: events.length,
      failed: failed.length
    }
  }

  return { post: post, drain: drain, takeEvents: takeEvents, stats: stats, failed: failed }
}

function createHeap(opts) {
  const config = opts || {}
  const promoteAge = config.promoteAge || 2
  const young = []
  const old = []
  const baselines = []
  const stats = { scavenges: 0, marks: 0, collected: 0, promoted: 0, freedBytes: 0 }
  let nextId = 1

  function alloc(size, tag) {
    const obj = { id: nextId, size: size || 1, tag: tag || 'obj', age: 0, alive: true }
    nextId += 1
    young.push(obj)
    return obj
  }

  function release(obj) {
    if (obj) obj.alive = false
    return obj
  }

  function bytesOf(list) {
    let n = 0
    for (let i = 0; i < list.length; i++) n += list[i].size
    return n
  }

  function scavenge() {
    stats.scavenges += 1
    const keep = []
    let collected = 0
    let promotedNow = 0
    for (let i = 0; i < young.length; i++) {
      const o = young[i]
      if (!o.alive) {
        collected += 1
        continue
      }
      o.age += 1
      if (o.age >= promoteAge) {
        old.push(o)
        promotedNow += 1
        stats.promoted += 1
      } else {
        keep.push(o)
      }
    }
    young.length = 0
    for (let i = 0; i < keep.length; i++) young.push(keep[i])
    stats.collected += collected
    return { survivors: keep.length, promoted: promotedNow, collected: collected }
  }

  function markSweep() {
    stats.marks += 1
    const keep = []
    let freed = 0
    let collected = 0
    for (let i = 0; i < old.length; i++) {
      const o = old[i]
      if (o.alive) keep.push(o)
      else {
        freed += o.size
        collected += 1
      }
    }
    old.length = 0
    for (let i = 0; i < keep.length; i++) old.push(keep[i])
    stats.collected += collected
    stats.freedBytes += freed
    baselines.push(bytesOf(old))
    return { collected: collected, freedBytes: freed, oldBytes: bytesOf(old) }
  }

  function snapshot() {
    return {
      young: young.length,
      old: old.length,
      youngBytes: bytesOf(young),
      oldBytes: bytesOf(old),
      live: young.length + old.length,
      collected: stats.collected,
      promoted: stats.promoted,
      freedBytes: stats.freedBytes,
      scavenges: stats.scavenges,
      marks: stats.marks
    }
  }

  function leakTrend(list) {
    const values = (list || baselines).slice()
    if (values.length < 2) return { leaking: false, growth: 0, rises: 0 }
    let rises = 0
    for (let i = 1; i < values.length; i++) {
      if (values[i] > values[i - 1]) rises += 1
    }
    const growth = values[values.length - 1] - values[0]
    return { leaking: rises === values.length - 1 && growth > 0, growth: growth, rises: rises }
  }

  return {
    alloc: alloc,
    release: release,
    scavenge: scavenge,
    markSweep: markSweep,
    snapshot: snapshot,
    leakTrend: leakTrend,
    baselines: baselines
  }
}`,
  finalCode: `function createStorage(opts) {
  const config = opts || {}
  const quotaKB = config.quotaKB != null ? config.quotaKB : 5
  const quotaBytes = quotaKB * 1024
  const data = new Map()
  let usedBytes = 0

  function bytesOf(key, value) {
    return (String(key).length + String(value).length) * 2
  }

  function get(key) {
    const k = String(key)
    return data.has(k) ? data.get(k) : null
  }

  function set(key, value) {
    const k = String(key)
    const v = String(value)
    const old = data.has(k) ? bytesOf(k, data.get(k)) : 0
    const delta = bytesOf(k, v) - old
    if (usedBytes + delta > quotaBytes) {
      const err = new Error('QuotaExceededError')
      err.name = 'QuotaExceededError'
      throw err
    }
    data.set(k, v)
    usedBytes += delta
    return true
  }

  function remove(key) {
    const k = String(key)
    if (!data.has(k)) return false
    usedBytes -= bytesOf(k, data.get(k))
    data.delete(k)
    return true
  }

  function keys() {
    return Array.from(data.keys())
  }

  function info() {
    return {
      used: usedBytes,
      quota: quotaBytes,
      count: data.size,
      ratio: quotaBytes > 0 ? usedBytes / quotaBytes : 0
    }
  }

  function clear() {
    data.clear()
    usedBytes = 0
  }

  return { set: set, get: get, remove: remove, keys: keys, info: info, clear: clear }
}

// 存储选型：容量 / 生命周期 / 是否阻塞主线程，三列一过就知道该选谁
function pickStorage(need) {
  const n = need || {}
  const size = n.size || 0
  if (n.perRequest) return 'cookie'
  if (n.blob) return 'indexeddb'
  if (size > 5 * 1024 * 1024) return 'indexeddb'
  if (n.session) return 'sessionStorage'
  return 'localStorage'
}

function createStorageWorker(storage, opts) {
  const config = opts || {}
  const queue = []
  const events = []
  const failed = []
  let handled = 0
  let clonedBytes = 0
  let transferredBytes = 0

  function post(message, transfer) {
    const msg = message || {}
    const isTransfer = transfer === true || msg.transfer === true
    queue.push({ key: String(msg.key), value: String(msg.value), transfer: isTransfer })
    return queue.length
  }

  function drain(budgetKB) {
    const budget = (budgetKB != null ? budgetKB : 64) * 1024
    let spent = 0
    let done = 0
    while (queue.length > 0) {
      const msg = queue[0]
      const size = (msg.key.length + msg.value.length) * 2
      if (!msg.transfer && done > 0 && spent + size > budget) break
      queue.shift()
      if (msg.transfer) {
        transferredBytes += size
      } else {
        clonedBytes += size
        spent += size
      }
      try {
        const old = storage.get(msg.key)
        storage.set(msg.key, msg.value)
        events.push({ key: msg.key, oldValue: old, newValue: msg.value })
      } catch (e) {
        failed.push({ key: msg.key, reason: e.name || 'Error' })
      }
      done += 1
      handled += 1
    }
    return { done: done, spent: spent, pending: queue.length }
  }

  function takeEvents() {
    return events.splice(0, events.length)
  }

  function stats() {
    return {
      handled: handled,
      pending: queue.length,
      clonedBytes: clonedBytes,
      transferredBytes: transferredBytes,
      events: events.length,
      failed: failed.length
    }
  }

  return { post: post, drain: drain, takeEvents: takeEvents, stats: stats, failed: failed }
}

function createHeap(opts) {
  const config = opts || {}
  const promoteAge = config.promoteAge || 2
  const young = []
  const old = []
  const baselines = []
  const stats = { scavenges: 0, marks: 0, collected: 0, promoted: 0, freedBytes: 0 }
  let nextId = 1

  function alloc(size, tag) {
    const obj = { id: nextId, size: size || 1, tag: tag || 'obj', age: 0, alive: true }
    nextId += 1
    young.push(obj)
    return obj
  }

  function release(obj) {
    if (obj) obj.alive = false
    return obj
  }

  function bytesOf(list) {
    let n = 0
    for (let i = 0; i < list.length; i++) n += list[i].size
    return n
  }

  function scavenge() {
    stats.scavenges += 1
    const keep = []
    let collected = 0
    let promotedNow = 0
    for (let i = 0; i < young.length; i++) {
      const o = young[i]
      if (!o.alive) {
        collected += 1
        continue
      }
      o.age += 1
      if (o.age >= promoteAge) {
        old.push(o)
        promotedNow += 1
        stats.promoted += 1
      } else {
        keep.push(o)
      }
    }
    young.length = 0
    for (let i = 0; i < keep.length; i++) young.push(keep[i])
    stats.collected += collected
    return { survivors: keep.length, promoted: promotedNow, collected: collected }
  }

  function markSweep() {
    stats.marks += 1
    const keep = []
    let freed = 0
    let collected = 0
    for (let i = 0; i < old.length; i++) {
      const o = old[i]
      if (o.alive) keep.push(o)
      else {
        freed += o.size
        collected += 1
      }
    }
    old.length = 0
    for (let i = 0; i < keep.length; i++) old.push(keep[i])
    stats.collected += collected
    stats.freedBytes += freed
    baselines.push(bytesOf(old))
    return { collected: collected, freedBytes: freed, oldBytes: bytesOf(old) }
  }

  function snapshot() {
    return {
      young: young.length,
      old: old.length,
      youngBytes: bytesOf(young),
      oldBytes: bytesOf(old),
      live: young.length + old.length,
      collected: stats.collected,
      promoted: stats.promoted,
      freedBytes: stats.freedBytes,
      scavenges: stats.scavenges,
      marks: stats.marks
    }
  }

  function leakTrend(list) {
    const values = (list || baselines).slice()
    if (values.length < 2) return { leaking: false, growth: 0, rises: 0 }
    let rises = 0
    for (let i = 1; i < values.length; i++) {
      if (values[i] > values[i - 1]) rises += 1
    }
    const growth = values[values.length - 1] - values[0]
    return { leaking: rises === values.length - 1 && growth > 0, growth: growth, rises: rises }
  }

  return {
    alloc: alloc,
    release: release,
    scavenge: scavenge,
    markSweep: markSweep,
    snapshot: snapshot,
    leakTrend: leakTrend,
    baselines: baselines
  }
}`,
  tests: `${L2S1}\n${L2S2}\n${L2S3}`
}

/* ============================================================ 第 3 关测试（依赖布局与构建工具链） */
const L3S1 = `{
  check('semver：^ 锁大版本、~ 锁次版本、精确匹配才算相等', () => {
    same(satisfies('1.4.2', '^1.2.0'), true)
    same(satisfies('2.0.0', '^1.2.0'), false)
    same(satisfies('1.2.9', '~1.2.3'), true)
    same(satisfies('1.3.0', '~1.2.3'), false)
    same(satisfies('0.2.5', '^0.2.3'), true, '0.x 的 ^ 只放开补丁位')
    same(satisfies('0.3.0', '^0.2.3'), false)
  })
  check('npm 扁平提升：同名多版本提最高，其余嵌套', () => {
    const reg = {
      a: { '1.0.0': { deps: { c: '1.0.0' } } },
      b: { '1.0.0': { deps: { c: '2.0.0' } } },
      c: { '1.0.0': { deps: {} }, '2.0.0': { deps: {} } }
    }
    const rows = npmLayout(reg, { a: '1.0.0', b: '1.0.0' })
    const tops = rows.filter((r) => r.hoisted).map((r) => r.name)
    same(tops.sort(), ['a', 'b', 'c'])
    const cRows = rows.filter((r) => r.name === 'c')
    same(cRows.filter((r) => r.hoisted)[0].version, '2.0.0')
    same(cRows.filter((r) => !r.hoisted)[0].version, '1.0.0')
  })
  check('幽灵依赖：扁平结构下能解析到未声明的包，pnpm 结构下消失', () => {
    const reg = {
      a: { '1.0.0': { deps: { c: '1.0.0' } } },
      b: { '1.0.0': { deps: { c: '2.0.0' } } },
      c: { '1.0.0': { deps: {} }, '2.0.0': { deps: {} } }
    }
    const deps = { a: '1.0.0', b: '1.0.0' }
    same(ghostDeps(npmLayout(reg, deps), deps), ['c'], 'c 能 require 到，但没在 package.json 里声明')
    same(ghostDeps(pnpmLayout(reg, deps), deps), [], '顶层只有直接依赖的软链，幽灵依赖没有生存空间')
  })
  check('peer 依赖必须由使用方提供，且版本要落在区间内', () => {
    const reg = {
      p: { '1.0.0': { deps: {}, peer: { react: '^18.0.0' } } },
      react: { '17.0.0': { deps: {} }, '18.0.0': { deps: {} } }
    }
    const bad = peerConflicts(reg, { p: '1.0.0', react: '17.0.0' })
    same(bad.length, 1)
    same(bad[0].peer, 'react')
    same(bad[0].got, '17.0.0')
    same(peerConflicts(reg, { p: '1.0.0', react: '18.0.0' }), [])
    same(peerConflicts(reg, { p: '1.0.0' })[0].got, null, '压根没装也算冲突')
  })
  check('frozen-lockfile：lock 版本不满足区间就是漂移，CI 必须失败', () => {
    const deps = { a: '^1.0.0', b: '~2.1.0' }
    same(lockDrift(deps, { a: '1.4.0', b: '2.1.7' }), [])
    const drift = lockDrift(deps, { a: '0.9.0', b: '2.2.0' })
    same(drift.length, 2)
    same(drift[0].name, 'a')
    same(drift[1].got, '2.2.0')
    same(lockDrift(deps, { a: '1.0.0' }).length, 1, 'lock 里缺条目也算漂移')
  })
}`

const L3S2 = `{
  const MODS = [
    { id: 'main', deps: ['a'] },
    { id: 'a', deps: ['b'], accept: true },
    { id: 'b', deps: [] }
  ]
  check('按需编译：冷启动只转入口，第二个模块请求到了才转', () => {
    const dev = createDevServer({ modules: MODS, vendor: ['react'], lockHash: 'L1' })
    const boot = dev.boot('main')
    same(boot.mode, 'on-demand')
    same(dev.stats().transforms, 1)
    dev.request('b')
    same(dev.stats().transforms, 2)
    same(dev.stats().requests, 2)
  })
  check('同一个模块重复请求只编译一次，其余命中缓存', () => {
    const dev = createDevServer({ modules: MODS, vendor: ['react'], lockHash: 'L1' })
    dev.request('a')
    dev.request('a')
    dev.request('a')
    same(dev.stats().transforms, 1)
    same(dev.stats().cacheHits, 2)
  })
  check('第三方依赖走预构建：多个 CJS 合成一个 chunk，只构建一次', () => {
    const dev = createDevServer({ modules: MODS, vendor: ['react', 'react-dom'], lockHash: 'L1' })
    same(dev.request('react').from, 'prebundle')
    same(dev.stats().prebundles, 1)
    dev.request('react-dom')
    same(dev.stats().prebundles, 1, '同一份 lockfile 下不该重复预构建')
  })
  check('lockfile 变了就作废预构建结果（深缓存按 hash 失效）', () => {
    const dev = createDevServer({ modules: MODS, vendor: ['react'], lockHash: 'L1' })
    dev.request('react')
    same(dev.stats().prebundleHash, 'L1')
    dev.setLockHash('L2')
    dev.request('react')
    same(dev.stats().prebundles, 2)
    same(dev.stats().prebundleHash, 'L2')
  })
  check('HMR 冒泡：最近一个 acceptor 接住，没人接就整页 reload', () => {
    const dev = createDevServer({ modules: MODS, vendor: [], lockHash: 'L1' })
    const up = dev.hmr('b')
    same(up.boundary, 'a', 'b 没人 accept，冒泡到 import 它的 a')
    same(up.reload, false)
    same(up.path, ['b', 'a'])
    same(dev.hmr('a').boundary, 'a', '自己 accept 自己就地热替换')
    same(dev.hmr('main').reload, true, '入口模块没人能接住')
  })
}`

const L3S3 = `{
  const MODS = [
    { id: 'main', ext: 'ts', rev: 1 },
    { id: 'a', ext: 'ts', rev: 1 },
    { id: 'b', ext: 'js', rev: 1 }
  ]
  check('loader 从右到左执行：数组末尾的先跑', () => {
    const c = createCompiler({ modules: [{ id: 'main', ext: 'ts', rev: 1, code: 'src' }] })
    const r = c.build({ rules: [{ test: 'ts', use: ['babel', 'ts-loader'] }] })
    same(r.compiled[0].loaders, ['ts-loader', 'babel'])
    same(r.compiled[0].code, 'babel(ts-loader(src))')
  })
  check('plugin 挂在编译事件链上，顺序固定', () => {
    const c = createCompiler({ modules: [{ id: 'main', ext: 'js', rev: 1 }] })
    const r = c.build({ rules: [] })
    same(r.hooks, ['normalModuleFactory', 'buildModule', 'seal', 'emit'])
  })
  check('持久缓存：第二次构建全部命中，一个模块都不重编', () => {
    const c = createCompiler({ modules: MODS })
    const rules = [{ test: 'ts', use: ['babel', 'ts-loader'] }]
    const first = c.build({ rules: rules })
    same(first.stats.compiled, 3)
    const second = c.build({ rules: rules })
    same(second.stats.compiled, 0)
    same(second.stats.cached, 3)
  })
  check('增量重建：只重编被改的那个模块，其余复用缓存', () => {
    const c = createCompiler({ modules: MODS })
    const rules = [{ test: 'ts', use: ['babel', 'ts-loader'] }]
    c.build({ rules: rules })
    c.touch('b')
    const r = c.build({ rules: rules })
    same(r.compiled.map((x) => x.id), ['b'])
    same(r.stats.cached, 2)
    same(c.hitRate(), 2 / 3)
  })
  check('关掉缓存就全量重编（排查缓存污染时的第一手段）', () => {
    const c = createCompiler({ modules: MODS })
    const rules = [{ test: 'ts', use: ['babel', 'ts-loader'] }]
    c.build({ rules: rules })
    const cold = c.build({ rules: rules, cache: false })
    same(cold.stats.compiled, 3)
    same(cold.stats.cached, 0)
  })
}`

/* ============================================================ 第 3 关代码（三步共用，写一份） */
const L3C1 = `function parseVersion(v) {
  const parts = String(v).split('.')
  return [Number(parts[0] || 0), Number(parts[1] || 0), Number(parts[2] || 0)]
}

function compareVersion(a, b) {
  const x = parseVersion(a)
  const y = parseVersion(b)
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1
  }
  return 0
}

// 只支持 ^ / ~ / 精确 / *（够解释 npm 的语义，不实现完整的 range 语法）
function satisfies(version, range) {
  const r = String(range == null ? '*' : range).trim()
  if (r === '' || r === '*' || r === 'latest') return true
  const first = r.charAt(0)
  const op = first === '^' || first === '~' ? first : ''
  const base = op ? r.slice(1) : r
  if (compareVersion(version, base) < 0) return false
  const b = parseVersion(base)
  const v = parseVersion(version)
  if (op === '^') {
    if (b[0] > 0) return v[0] === b[0]
    if (b[1] > 0) return v[0] === 0 && v[1] === b[1]
    return v[0] === 0 && v[1] === 0 && v[2] === b[2]
  }
  if (op === '~') return v[0] === b[0] && v[1] === b[1]
  return compareVersion(version, r) === 0
}

function readMeta(registry, name, version) {
  const pkg = registry[name]
  if (!pkg) throw new Error('ENOENT: ' + name)
  const meta = pkg[version]
  if (!meta) throw new Error('ETARGET: ' + name + '@' + version)
  return meta
}

// 整个依赖闭包里每个包出现过的所有版本（BFS + seen 防循环）
function resolveClosure(registry, deps, devDeps) {
  const versions = {}
  const seen = {}
  const queue = []
  const roots = Object.keys(deps || {}).concat(Object.keys(devDeps || {}))
  for (let i = 0; i < roots.length; i++) {
    const n = roots[i]
    queue.push({ name: n, version: (deps && deps[n] != null) ? deps[n] : (devDeps || {})[n] })
  }
  while (queue.length > 0) {
    const item = queue.shift()
    const meta = readMeta(registry, item.name, item.version)
    if (!versions[item.name]) versions[item.name] = []
    if (versions[item.name].indexOf(item.version) < 0) versions[item.name].push(item.version)
    const key = item.name + '@' + item.version
    if (seen[key]) continue
    seen[key] = true
    const d = meta.deps || {}
    const names = Object.keys(d)
    for (let i = 0; i < names.length; i++) queue.push({ name: names[i], version: d[names[i]] })
  }
  return versions
}

// npm：能提就提到顶层（同名多版本提最高的那个），冲突版本嵌套在下面兜底
function npmLayout(registry, deps, devDeps) {
  const versions = resolveClosure(registry, deps, devDeps)
  const rows = []
  const names = Object.keys(versions).sort()
  for (let i = 0; i < names.length; i++) {
    const name = names[i]
    const list = versions[name].slice().sort(compareVersion)
    const top = list[list.length - 1]
    rows.push({ path: 'node_modules/' + name, name: name, version: top, hoisted: true })
    for (let k = 0; k < list.length; k++) {
      if (list[k] === top) continue
      rows.push({
        path: 'node_modules/' + name + '/node_modules/' + name,
        name: name,
        version: list[k],
        hoisted: false
      })
    }
  }
  return rows
}

// pnpm：顶层只放直接依赖的软链，其余全在 .pnpm 的内容寻址目录里（dirname 带 only-Child-Of 信息）
function pnpmLayout(registry, deps, devDeps) {
  const versions = resolveClosure(registry, deps, devDeps)
  const rows = []
  const names = Object.keys(versions).sort()
  for (let i = 0; i < names.length; i++) {
    const name = names[i]
    const list = versions[name].slice().sort(compareVersion)
    const declared = (deps && deps[name] != null) || (devDeps && devDeps[name] != null)
    for (let k = 0; k < list.length; k++) {
      rows.push({
        path: '.pnpm/' + name + '@' + list[k] + '/node_modules/' + name,
        name: name,
        version: list[k],
        hoisted: false
      })
      if (declared && list[k] === list[list.length - 1]) {
        rows.push({ path: 'node_modules/' + name, name: name, version: list[k], hoisted: true })
      }
    }
  }
  return rows
}

// 幽灵依赖：能解析到、但 package.json 里没声明
function ghostDeps(rows, deps, devDeps) {
  const out = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (!r.hoisted) continue
    if ((deps && deps[r.name] != null) || (devDeps && devDeps[r.name] != null)) continue
    if (out.indexOf(r.name) < 0) out.push(r.name)
  }
  return out
}

function peerConflicts(registry, deps, devDeps) {
  const versions = resolveClosure(registry, deps, devDeps)
  const top = {}
  const names = Object.keys(versions).sort()
  for (let i = 0; i < names.length; i++) {
    const list = versions[names[i]].slice().sort(compareVersion)
    top[names[i]] = list[list.length - 1]
  }
  const out = []
  for (let i = 0; i < names.length; i++) {
    const list = versions[names[i]]
    for (let k = 0; k < list.length; k++) {
      const peer = readMeta(registry, names[i], list[k]).peer || {}
      const pnames = Object.keys(peer)
      for (let j = 0; j < pnames.length; j++) {
        const got = top[pnames[j]] == null ? null : top[pnames[j]]
        if (got === null || !satisfies(got, peer[pnames[j]])) {
          out.push({ pkg: names[i], peer: pnames[j], want: peer[pnames[j]], got: got })
        }
      }
    }
  }
  return out
}

// frozen-lockfile：lock 里的版本不满足 manifest 的区间就是漂移，CI 必须失败
function lockDrift(deps, lock) {
  const l = lock || {}
  const out = []
  const names = Object.keys(deps || {})
  for (let i = 0; i < names.length; i++) {
    const want = deps[names[i]]
    const got = l[names[i]] == null ? null : l[names[i]]
    if (got === null || !satisfies(got, want)) out.push({ name: names[i], want: want, got: got })
  }
  return out
}`

const L3C2 = `${L3C1}

function createDevServer(opts) {
  const config = opts || {}
  const modules = (config.modules || []).slice()
  const vendor = (config.vendor || []).slice()
  let lockHash = config.lockHash || 'lock-1'
  let prebundleHash = null
  let prebundles = 0
  const cache = {}
  const stats = { requests: 0, transforms: 0, cacheHits: 0 }

  function findModule(id) {
    for (let i = 0; i < modules.length; i++) {
      if (modules[i].id === id) return modules[i]
    }
    return null
  }

  // 第三方依赖：CJS 统一转 ESM、上千个小文件合成一个 chunk，结果按 lockfile hash 落深缓存
  function prebundle() {
    prebundles += 1
    prebundleHash = lockHash
    return { chunks: vendor.length > 0 ? 1 : 0, deps: vendor.length, hash: lockHash }
  }

  // 按需编译：请求到达才 transform 这个模块，冷启动成本只跟入口有关
  function request(id) {
    stats.requests += 1
    if (vendor.indexOf(id) >= 0) {
      if (prebundleHash !== lockHash) prebundle()
      return { id: id, from: 'prebundle', code: 'vendor:' + id }
    }
    if (cache[id]) {
      stats.cacheHits += 1
      return cache[id]
    }
    const m = findModule(id)
    if (!m) throw new Error('ENOENT: ' + id)
    const out = { id: id, from: 'on-demand', code: 'compiled:' + id }
    cache[id] = out
    stats.transforms += 1
    return out
  }

  function boot(entry) {
    const id = entry || (modules[0] && modules[0].id)
    const out = request(id)
    return { entry: id, mode: out.from, requests: stats.requests }
  }

  function importersOf(id) {
    const out = []
    for (let i = 0; i < modules.length; i++) {
      const d = modules[i].deps || []
      if (d.indexOf(id) >= 0) out.push(modules[i].id)
    }
    return out
  }

  // HMR 边界：自己 accept 就地替换；否则沿 importer 图冒泡，冒泡不到就整页 reload
  function hmr(id) {
    const self = findModule(id)
    if (!self) return { boundary: null, reload: true, path: [] }
    if (self.accept) return { boundary: id, reload: false, path: [id] }
    const seen = {}
    seen[id] = true
    const queue = []
    const parents = importersOf(id)
    for (let i = 0; i < parents.length; i++) {
      seen[parents[i]] = true
      queue.push({ id: parents[i], path: [id, parents[i]] })
    }
    while (queue.length > 0) {
      const cur = queue.shift()
      const m = findModule(cur.id)
      if (m && m.accept) return { boundary: cur.id, reload: false, path: cur.path }
      const next = importersOf(cur.id)
      for (let i = 0; i < next.length; i++) {
        if (seen[next[i]]) continue
        seen[next[i]] = true
        queue.push({ id: next[i], path: cur.path.concat([next[i]]) })
      }
    }
    return { boundary: null, reload: true, path: [] }
  }

  function setLockHash(h) {
    lockHash = h
    return lockHash
  }

  function devStats() {
    return {
      requests: stats.requests,
      transforms: stats.transforms,
      cacheHits: stats.cacheHits,
      prebundles: prebundles,
      prebundleHash: prebundleHash,
      cached: Object.keys(cache).length
    }
  }

  return {
    request: request,
    boot: boot,
    prebundle: prebundle,
    hmr: hmr,
    setLockHash: setLockHash,
    stats: devStats
  }
}`

const L3C3 = `${L3C2}

function createCompiler(opts) {
  const config = opts || {}
  const modules = (config.modules || []).slice()
  const cache = {}
  let runs = 0
  let lastBuild = null

  // loader 是模块级翻译器：同一条 rule 内 use 从右到左，多条 rule 串起来也是整体右到左
  function loaderChain(ext, rules) {
    const chain = []
    const list = rules || []
    for (let i = 0; i < list.length; i++) {
      if (list[i].test !== ext) continue
      const use = list[i].use || []
      for (let k = 0; k < use.length; k++) chain.push(use[k])
    }
    return chain.reverse()
  }

  function applyLoaders(code, chain) {
    let out = code
    for (let i = 0; i < chain.length; i++) out = chain[i] + '(' + out + ')'
    return out
  }

  // 编译事件链：NormalModuleFactory -> buildModule -> seal -> emit
  function build(options) {
    const opt = options || {}
    const rules = opt.rules || []
    const hooks = ['normalModuleFactory', 'buildModule', 'seal', 'emit']
    runs += 1
    const compiled = []
    const cached = []
    for (let i = 0; i < modules.length; i++) {
      const m = modules[i]
      const chain = loaderChain(m.ext, rules)
      const key = m.id + '@' + (m.rev || 1) + '@' + chain.join('>')
      if (opt.cache !== false && cache[key]) {
        cached.push(m.id)
        continue
      }
      cache[key] = true
      compiled.push({ id: m.id, loaders: chain, code: applyLoaders(m.code || 'src', chain) })
    }
    lastBuild = { compiled: compiled, cached: cached }
    return {
      hooks: hooks,
      compiled: compiled,
      cached: cached,
      stats: { runs: runs, compiled: compiled.length, cached: cached.length }
    }
  }

  // 改一个文件：只让它的缓存键失效（module graph hash 持久化的意义）
  function touch(id) {
    for (let i = 0; i < modules.length; i++) {
      if (modules[i].id !== id) continue
      modules[i].rev = (modules[i].rev || 1) + 1
      return modules[i].rev
    }
    return null
  }

  function hitRate() {
    if (!lastBuild || modules.length === 0) return 0
    return lastBuild.cached.length / modules.length
  }

  return { build: build, touch: touch, hitRate: hitRate }
}`

/* ============================================================ 第 3 关：依赖治理与构建工具链 */
const LV3 = {
  id: 'lv3',
  title: '构建工具链：从 node_modules 到产物',
  emoji: '🏗️',
  xp: 55,
  goal:
    '实现一套构建工具链的骨架：satisfies/npmLayout/pnpmLayout/ghostDeps/peerConflicts/lockDrift 把依赖治理算清楚；createDevServer 复现 Vite 的按需编译、预构建与 HMR 冒泡；createCompiler 复现 webpack 的 loader 右到左、插件钩子顺序与持久缓存增量。',
  why:
    '工具链的问题在生产里都以「事故」的形式出现：某天 CI 装出了一个没声明的包（幽灵依赖），本地却复现不了；双 React 实例导致 hooks 报错，npm ls 一看版本分叉；dev 冷启动 40 秒，因为没人知道它在启动时把整个项目都编译了一遍。这些都不是「配置写错」，而是没搞清楚工具在做什么。\n\n把依赖布局、按需编译、loader 顺序这三件事写成代码之后，面试里的「你了解 Vite 原理吗」就不再是背几句 esbuild + 原生 ESM，而是能说清冷启动为什么是 O(入口)、预构建解决的是连接风暴还是 CJS 互操作、HMR 边界为什么能保住组件状态。',
  nodes: ['fe.build.toolchain', 'fe.build.toolchain.package-manager', 'fe.build.toolchain.vite', 'fe.build.toolchain.webpack'],
  thinking: [
    {
      title: '先分清「装」和「编」：两条完全不同的时间线',
      md:
        '依赖安装和代码编译经常被混在一起讲，但它们是两件独立的事，坏起来的表现也完全不同。\n\n安装侧的关键词是「磁盘上长什么样」：npm 把能提的包都提到顶层（dedupe 上提、嵌套兜底），于是你能 require 到没声明的包——这就是幽灵依赖的物理来源；pnpm 把真实文件放在全局 store 里硬链接，node_modules 顶层只放直接依赖的软链，物理隔离把幽灵依赖堵死。\n\n编译侧的关键词是「什么时候花 CPU」：webpack 在启动时把入口闭包全走一遍（一次编译全部模块），Vite 把编译推到请求到达时（只编译被请求的模块），并额外用 esbuild 预构建第三方依赖。所以「Vite 冷启动快」不是编译器快，而是它什么都不做。'
    },
    {
      title: '预构建不是加速器，是修复器',
      md:
        '很多人以为 esbuild 预构建只是为了快，其实它先解决两个正确性问题：\n\n1. CJS/UMD 的依赖（React 生态里一大片）在浏览器原生 ESM 下根本跑不起来，预构建把它们转成 ESM；\n2. 一个依赖包里几百个小文件会变成几百个 HTTP 请求，浏览器连接数一拥就崩，预构建把它们合成一个 chunk。\n\n"否" 的代价是：预构建结果必须能失效。所以它按 lockfile hash 落深缓存（node_modules/.vite），配置里依赖变了要重新 build。这一关的 setLockHash + prebundles 就是这个失效逻辑——面试里问「为什么改了个依赖要重启 dev server」时，答案在这里。'
    },
    {
      title: 'loader 的顺序与插件的钩子，决定了你能改什么',
      md:
        'webpack 的一切都挂在编译事件链上：NormalModuleFactory 建模块 → loadModule/buildModule 跑 loader → seal 阶段做 chunk 与优化（tree-shaking 在这里发生）→ emit 写产物。\n\nloader 是模块级翻译器，`use: [babel, ts-loader]` 里 ts-loader 先跑（把 TS 变 JS），babel 后跑（再按 browserslist 降级）。所以「从右到左」不是怪癖：它是管道语义，最后一个 loader 的输出就是模块的最终源码。\n\n记住这两条以后，很多问题就自解了：为什么改 loader 顺序会炸（ts 还没转就送进 babel）；为什么 plugin 能改整体产物而 loader 只能改单个模块（钩子的层级不同）；为什么缓存键必须包含 loader 链（换了 loader 就是另一份产物）。'
    }
  ],
  prereq: [
    {
      title: 'node_modules 的两种物理形态',
      md:
        'npm 的扁平化：把依赖尽量提到顶层 node_modules，同名多版本时提一个、剩下的嵌套在需要它的包下面。好处是去重、路径短；坏处是**你的代码能解析到没声明的包**，本地跑得通、CI 装完就崩。\n\n```\n# npm：c 被提升到顶层\nnode_modules/a  node_modules/c  node_modules/b\nnode_modules/a/node_modules/c   # 冲突版本嵌套兜底\n```\n\npnpm 的隔离：真实文件在全局 store（内容寻址，同内容只存一份），node_modules 顶层只有你声明的依赖的软链，传递依赖只出现在 `.pnpm/<pkg>@<ver>/node_modules/` 里。目录名带 only-Child-Of 信息，webpack 这类按真实路径解析的工具照样能命中。代价是有些工具要靠 shamefully-hoist 妥协。'
    },
    {
      title: 'Vite dev 的两大支柱与 HMR 边界',
      md:
        '支柱一：浏览器原生 ESM 按需编译。dev server 只在你请求 `/src/App.vue` 时才 transform 它，冷启动与项目规模无关，只与入口有关。\n\n支柱二：esbuild 预构建（见上）。结果缓存在 node_modules/.vite，按 lockfile hash 失效。\n\nHMR 的规则值得单独背：一个模块被改，HMR 从它出发沿 **importer（反向依赖）图** 冒泡，找到最近一个 `import.meta.hot.accept` 的边界就地替换；一路到入口都没人 accept，就整页 reload。Vue SFC 天生带 fast refresh 边界，所以组件状态能保住；裸 React 组件需要 react-refresh 的 preamble 注入才有同样效果。'
    },
    {
      title: 'webpack 的编译事件链与持久缓存',
      md:
        'webpack 的核心是一个 tapable 事件流：`NormalModuleFactory`（解析出模块）→ `buildModule`（跑 loader 产出源码）→ `seal`（出 chunk、做 tree-shaking 与优化）→ `emit`（写文件）。loader 只能作用于单个模块，plugin 订阅钩子可以改整体产物——这是两者能力的边界。\n\nwebpack 5 的 filesystem cache 把 module graph、依赖 hash、产物都落盘，第二次启动直接复用，所以「重启 dev server 秒开」；增量重建时靠 module 的 hash 判断哪些模块需要重跑 loader。\n\n选型上：存量项目继续 webpack + cache/swc-loader/thread-loader 提速是 ROI 最高的路；新项目直接 Vite，但要先盘点 loader 资产（css modules、图片、HTML 模板插件）Vite 是否原生覆盖。'
    }
  ],
  api: [
    {
      name: 'npmLayout / pnpmLayout / ghostDeps',
      sig: 'npmLayout(registry, deps, devDeps) => Row[]；ghostDeps(rows, deps, devDeps) => string[]',
      args:
        'registry 是「包名 → 版本 → { deps, peer }」的元数据表；deps/devDeps 是 package.json 里的声明。Row = { path, name, version, hoisted }，hoisted 表示它出现在能被项目直接解析到的位置。',
      returns:
        'npmLayout 返回扁平提升后的全部行（冲突版本 hoisted=false 并嵌套）；pnpmLayout 返回隔离结构（顶层只有直接依赖）；ghostDeps 返回「hoisted 但没声明」的包名去重列表。',
      example:
        'const reg = { a: { "1.0.0": { deps: { c: "1.0.0" } } }, c: { "1.0.0": { deps: {} } } }\nghostDeps(npmLayout(reg, { a: "1.0.0" }), { a: "1.0.0" })    // ["c"]\nghostDeps(pnpmLayout(reg, { a: "1.0.0" }), { a: "1.0.0" })   // []'
    },
    {
      name: 'createDevServer',
      sig: 'createDevServer({ modules, vendor, lockHash }) => { boot, request, hmr, setLockHash, stats }',
      args:
        'modules 是 { id, deps, accept } 的模块表（accept 表示它有 import.meta.hot.accept 边界）；vendor 是需要预构建的第三方依赖名；lockHash 决定预构建缓存是否有效。',
      returns:
        'request(id) 返回 { id, from, code }，from 为 "on-demand" 或 "prebundle"，重复请求命中缓存不重复 transform；boot(entry) 只转入口；hmr(id) 返回 { boundary, reload, path }；stats() 返回 { requests, transforms, cacheHits, prebundles, prebundleHash, cached }。',
      example:
        'const dev = createDevServer({ modules: [{ id: "main", deps: ["a"] }, { id: "a", deps: ["b"], accept: true }, { id: "b", deps: [] }], vendor: ["react"], lockHash: "L1" })\ndev.boot("main")\ndev.stats().transforms   // 1\ndev.hmr("b").boundary    // "a"'
    },
    {
      name: 'createCompiler',
      sig: 'createCompiler({ modules }) => { build, touch, hitRate }',
      args:
        'modules 是 { id, ext, rev, code }；build({ rules, cache }) 的 rules 是 [{ test: ext, use: [...loaders] }]，cache 传 false 强制全量重编；touch(id) 把某个模块的 rev 加一，模拟文件被改动。',
      returns:
        'build 返回 { hooks, compiled: [{ id, loaders, code }], cached: [id], stats: { runs, compiled, cached } }；hooks 是固定顺序的事件链；hitRate() 返回上一次构建的缓存命中率。',
      example:
        'const c = createCompiler({ modules: [{ id: "main", ext: "ts" }, { id: "b", ext: "js" }] })\nc.build({ rules: [{ test: "ts", use: ["babel", "ts-loader"] }] }).compiled[0].loaders\n// ["ts-loader", "babel"]\nc.touch("main")\nc.build({ rules: [{ test: "ts", use: ["babel", "ts-loader"] }] }).stats.cached    // 1'
    }
  ],
  usage:
    '这三块在真实项目里是这样接起来的：\n\n```bash\n# 1) 装：CI 必须 frozen，别让 lockfile 漂移\npnpm install --frozen-lockfile\n# 2) 查幽灵依赖（迁移到 pnpm 的收益之一）\npnpm why lodash\n# 3) dev：Vite 只编译被请求的模块\nvite --port 5173\n# 4) build：生产走 rollup（或 rolldown），缓存与分包策略在 rollupOptions 里\nvite build\n```\n\n对应到这一关的代码：`lockDrift` 就是 `--frozen-lockfile` 的判据，`ghostDeps` 是迁移前必跑的体检，`dev.hmr` 解释了你为什么能在改组件时保住表单输入，`compiler.touch + hitRate` 就是「改一行只重编一个模块」的量化版本。',
  hints: [
    '第 1 步：先写 parseVersion/compareVersion，satisfies 里 ^ 要单独处理 0.x（只放开补丁位）；resolveClosure 用队列 + seen 集合，别用递归（依赖图可能有环）。',
    '第 2 步：request 里三路分支——第三方走预构建（且检查 hash）、缓存命中、否则 transform；hmr 用 BFS，队列里带 path 才能返回冒泡路径。',
    '第 3 步：loaderChain 先收集再 reverse；build 的缓存键要包含 module id + rev + loader 链，缺一样就会出现「改了配置还在用旧产物」。'
  ],
  concepts: [
    {
      title: 'Vite 与 webpack 的取舍不是快慢，是「什么时候付钱」',
      md:
        'webpack 在启动时把整个依赖图编译完（付全款），换来的是 dev 与 prod 行为高度一致、生态与 loader 资产极全；Vite 在请求时才编译（按次付费），冷启动几乎免费，但 dev 与 build 是两套管线（dev 用 esbuild 预构建 + 按需 transform，build 用 rollup），插件要同时适配两边——这正是 Vite 6 的 Environment API 与 Rolldown 想消除的「插件双标」问题。\n\n选型判断可以落成三个问题：存量 loader 资产多不多（多则 webpack 更省事）、团队能否接受 dev/prod 差异（不能则慎选）、是否需要 Module Federation（webpack 2.0 的运行时共享仍是强项）。'
    },
    {
      title: '这个模拟器简化了什么',
      md:
        '1. 版本只有 x.y.z 三段，不支持 pre-release、范围组合（>= < ||）、overrides/resolutions；semver 的真实语义比这里复杂一个量级。\n2. npm 的提升策略被简化成「提最高版本」，真实的 npm 是「提最近的（层级最浅的）」，所以真实项目里顶层版本可能是较低的。\n3. Vite 的 transform 没有真实的编译过程（返回 compiled:id 字符串），预构建也没有增量；webpack 的 seal 阶段没有真的做 chunk 图。\n4. 没有模拟软链接的真实解析：pnpm 的 node_modules 结构在这里只是一张路径表。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '先把依赖布局和版本区间算清楚',
      think:
        '这一关的后面两步都要靠「谁依赖谁」这张表，所以先把安装侧的物理结构立起来。这一步刻意把 semver 也实现掉：不写 satisfies 就没法判断 lockfile 是否漂移，也没法判断 peer 是否满足——而这两个正是 CI 里最常见的静默失败。',
      hint:
        'parseVersion/compareVersion 是地基；resolveClosure 用队列 BFS 收集每个包出现过的所有版本（seen 防环）；npmLayout 取排序后的最高版本做顶层，pnpmLayout 只在 hoisted 位置放直接依赖。',
      vocab: [
        { term: '幽灵依赖', desc: '代码里 require 了 package.json 没声明的包，靠扁平提升偶然能解析到' },
        { term: 'peerDependency', desc: '要求使用方提供、自己不去装的依赖（React 插件生态的典型约定）' }
      ],
      code: L3C1,
      test: L3S1,
      diag: [
        'satisfies 里 ^ 一律按「大版本相同」处理，忘了 0.x 的 ^ 只放开补丁位；~ 也要单独锁次版本。',
        'npmLayout 取排序后的第一个（最低版本）做顶层，导致 c 顶层是 1.0.0 而不是 2.0.0。',
        'ghostDeps 把非 hoisted 的行也算进去了，或者没排除 devDependencies，导致声明过的包被误报。',
        'peerConflicts 只查了「peer 是否安装」没查版本区间，或者把没装的情况漏掉（got 应为 null）。',
        'lockDrift 只比较了 lock 里存在的条目，漏了 lock 缺条目也算漂移这一支。'
      ]
    },
    {
      n: 2,
      title: '接上按需编译、预构建与 HMR',
      think:
        '有了依赖表，下一步是 dev server：它要证明「冷启动只编译入口」和「第三方只预构建一次」这两条。HMR 冒泡放在这里不是凑数——它是同一张反向依赖图上的 BFS，写出来比背十遍「accept 边界」有用。',
      hint:
        'request 分三路：vendor 命中就走预构建（先比较 prebundleHash 与 lockHash），否则查 cache，再否则 transform 并写入 cache。hmr 用 BFS 从 importers 出发，队列元素带 path。',
      code: L3C2,
      test: L3S2,
      diag: [
        'boot 把整个 modules 都 transform 了一遍（等价于 webpack 的全量启动），transforms 一开始就不是 1。',
        'request 里先 transform 再查缓存，或者缓存键没存住返回值，重复请求仍然多算一次。',
        '第三方请求每次都调 prebundle，没用 prebundleHash 挡住重复构建。',
        'setLockHash 没有改变用于比较的状态，第二次预构建永远不触发。',
        'hmr 用了 DFS 且没记 path，冒泡路径和最近 acceptor 都可能错；入口模块忘了也算 full-reload。'
      ]
    },
    {
      n: 3,
      title: '装上编译事件链与持久缓存',
      think:
        '最后一步是生产构建侧：loader 顺序、插件钩子、缓存增量。这三件事的共同点是「错了都不会报错，只会静默产出坏产物」——所以必须用编译结果（loaders 数组、code 形态、compiled 列表）来断言，而不是靠「看起来没问题」。',
      hint:
        'loaderChain 先按 rules 顺序收集 use，再整体 reverse；applyLoaders 依次包裹成 f(g(src))；缓存键用 id + rev + chain.join(">")；touch 只改 rev。',
      code: L3C3,
      test: L3S3,
      diag: [
        'loaderChain 没有 reverse，code 变成 ts-loader(babel(src))，顺序刚好反了。',
        'hooks 少了一环（常见是漏掉 seal 或把 emit 写在 seal 前面）。',
        '缓存键只用模块 id，第二次构建全部命中但改了内容也不重编。',
        'touch 改的是模块内容而不是 rev，或者缓存键没带 rev，增量重建失效。',
        'cache: false 没有短路缓存写入，全量重编那条检查拿到的还是命中结果。'
      ]
    }
  ],
  skeleton: `function satisfies(version, range) {
  // TODO: 解析 ^ / ~ / 精确区间
  throw new Error('satisfies 还没实现')
}

function npmLayout(registry, deps, devDeps) {
  // TODO: 扁平提升 + 冲突嵌套
  throw new Error('npmLayout 还没实现')
}

function createDevServer(opts) {
  // TODO: 按需编译 + 预构建 + HMR 冒泡
  throw new Error('createDevServer 还没实现')
}

function createCompiler(opts) {
  // TODO: loader 右到左 + 钩子顺序 + 持久缓存
  throw new Error('createCompiler 还没实现')
}`,
  solution: L3C3,
  finalCode: L3C3,
  tests: `${L3S1}\n${L3S2}\n${L3S3}`
}

/* ============================================================ 第 4 关测试（模块、打包与缓存） */
const L4S1 = `{
  check('静态依赖只认 import/export from，动态 import() 与注释不算', () => {
    const src = [
      "import { a } from './a.js'",
      "import './styles.css'",
      "export { b } from './b.js'",
      "// import { c } from './c.js'",
      "const lazy = () => import('./lazy.js')"
    ].join('\\n')
    same(parseImports(src), ['./a.js', './styles.css', './b.js'])
  })
  check('exports 条件映射：import 与 require 各走各的分支', () => {
    const pkg = { exports: { '.': { import: './esm.js', require: './cjs.js' } } }
    same(exportsField(pkg, '.', ['import', 'node']), './esm.js')
    same(exportsField(pkg, '.', ['require', 'node']), './cjs.js')
    same(exportsField({ exports: './main.js' }, '.', ['import']), './main.js')
    same(exportsField({ main: './legacy.js' }, '.', ['import']), './legacy.js', '没有 exports 就退回 main')
  })
  check('条件顺序敏感：default 写在最前面会吃掉所有分支', () => {
    const bad = { exports: { '.': { default: './index.js', import: './esm.js' } } }
    same(exportsField(bad, '.', ['import']), './index.js', 'Node 按 key 的书写顺序匹配，default 是通配')
    const good = { exports: { '.': { import: './esm.js', default: './index.js' } } }
    same(exportsField(good, '.', ['import']), './esm.js')
    same(exportsField({ exports: { './feature': './feature.js' } }, './feature', ['import']), './feature.js')
  })
  check('ESM 导入 CJS 的互操作：默认导入是 module.exports 本体', () => {
    same(interopDefault({ a: 1 }), { a: 1 })
    same(interopDefault({ __esModule: true, default: 'D', a: 1 }), 'D', '带 __esModule 标记时才取 default')
    same(interopNamespace({ a: 1 }), { default: { a: 1 }, a: 1 })
    same(interopNamespace({ __esModule: true, default: 'D', a: 1 }), { default: 'D', a: 1 })
  })
  check('双包陷阱：import 与 require 指向不同文件就有状态分裂风险', () => {
    const dual = dualHazard({ exports: { '.': { import: './esm/index.js', require: './cjs/index.js' } } })
    same(dual.hazard, true)
    same(dual.import, './esm/index.js')
    same(dual.require, './cjs/index.js')
    const single = dualHazard({ exports: { '.': { import: './index.js', require: './index.js' } } })
    same(single.hazard, false, '两个条件指回同一个文件就不会分裂')
  })
}`

const L4S2 = `{
  const graph = () => [
    { id: 'entry', imports: ['util', 'flags'], exports: ['main'], used: { util: ['format'], flags: [] }, sideEffects: true },
    { id: 'util', imports: [], exports: ['format', 'unusedDeep'], sideEffects: false },
    { id: 'flags', imports: [], exports: ['FLAG'], sideEffects: true },
    { id: 'extra', imports: [], exports: ['x'], sideEffects: false }
  ]
  check('拓扑序：依赖永远排在依赖者前面', () => {
    const g = [
      { id: 'entry', imports: ['a'] },
      { id: 'a', imports: ['util'] },
      { id: 'util', imports: [] }
    ]
    const r = topoOrder(g)
    same(r.order, ['util', 'a', 'entry'])
    same(r.cycle, null)
  })
  check('循环依赖：回边要被抓住并给出环上的路径', () => {
    const g = [
      { id: 'a', imports: ['b'] },
      { id: 'b', imports: ['a'] }
    ]
    same(topoOrder(g).cycle, ['a', 'b', 'a'])
    same(topoOrder(g).order, [], '有环就不该给出可执行顺序')
  })
  check('tree-shaking：只保留被 import 的导出名', () => {
    const r = treeShake(graph(), 'entry')
    same(r.modules.sort(), ['entry', 'flags', 'util'])
    same(r.exports.util, ['format'])
    ok(r.dropped.indexOf('util#unusedDeep') >= 0, '没被 import 的导出要删掉')
  })
  check('sideEffects 决定「整块摇掉」还是「只摇导出」', () => {
    const r = treeShake(graph(), 'entry')
    ok(r.dropped.indexOf('extra#x') >= 0, '没人 import 又无副作用：整块摇掉')
    same(r.modules.indexOf('extra'), -1)
    ok(r.modules.indexOf('flags') >= 0, '有副作用的模块必须保留，哪怕它的导出全没用上')
    ok(r.dropped.indexOf('flags#FLAG') >= 0, '模块留下，但导出名照样摇掉')
  })
  check('browserslist 决定语法降级：es2015 吃不下可选链', () => {
    const r = featureGaps(['arrow', 'optionalChaining', 'Promise'], 'es2015')
    same(r.missing, ['optionalChaining'])
    same(r.ok, ['arrow', 'Promise'])
    const modern = featureGaps(['arrow', 'optionalChaining', 'Promise'], 'es2020')
    same(modern.missing, [])
  })
  check('同一个目标也决定 polyfill：API 缺失与语法缺失分开算', () => {
    same(featureGaps(['Promise', 'structuredClone'], 'es2019').missing, ['structuredClone'])
    same(featureGaps(['Promise', 'structuredClone'], 'es2022').missing, [])
    same(featureGaps(['Map', 'BigInt'], 'es2019').missing, ['BigInt'])
  })
}`

const L4S3 = `{
  const mods = () => [
    { id: 'entry', imports: ['a', 'util'], dynamic: ['lazy'], rev: 1, size: 100 },
    { id: 'a', imports: ['util'], rev: 1, size: 80 },
    { id: 'util', imports: [], rev: 1, size: 40 },
    { id: 'lazy', imports: ['util'], rev: 1, size: 60 }
  ]
  check('按入口与动态 import 边界出 chunk', () => {
    const plan = chunkPlan(mods(), 'entry')
    same(plan.map((c) => c.name), ['shared', 'index', 'lazy-lazy'])
    same(plan[1].modules, ['entry', 'a'])
    same(plan[2].modules, ['lazy'])
  })
  check('被两个 chunk 都引用的模块抽成 shared', () => {
    const plan = chunkPlan(mods(), 'entry')
    same(plan[0].modules, ['util'])
    ok(plan[1].modules.indexOf('util') < 0, '共享模块不该重复出现在入口 chunk 里')
  })
  check('contenthash 只随内容变化：改 util 不炸入口 chunk', () => {
    const before = hashChunks(chunkPlan(mods(), 'entry'))
    const changed = mods()
    changed[2].rev = 2
    const after = hashChunks(chunkPlan(changed, 'entry'))
    ok(before[0].hash !== after[0].hash, 'shared 里有 util，hash 必须变')
    same(before[1].hash, after[1].hash, '入口 chunk 没动，hash 不该变')
    same(before[2].hash, after[2].hash)
  })
  check('缓存命中率 = 未变 chunk / 总 chunk', () => {
    const before = hashChunks(chunkPlan(mods(), 'entry'))
    const changed = mods()
    changed[2].rev = 2
    const after = hashChunks(chunkPlan(changed, 'entry'))
    const rate = cacheRate(before, after)
    same(rate.hit, 2)
    same(rate.total, 3)
    same(rate.rate, 2 / 3)
  })
  check('碎片合并：小于阈值的 chunk 并进 shared，少一轮 RTT', () => {
    const small = () => [
      { id: 'entry', imports: [], dynamic: ['lazy'], rev: 1, size: 200 },
      { id: 'lazy', imports: [], rev: 1, size: 5 }
    ]
    const plan = chunkPlan(small(), 'entry', { minSize: 20 })
    same(plan.map((c) => c.name), ['shared', 'index'])
    same(plan[0].modules, ['lazy'])
    ok(plan[1].modules.indexOf('entry') >= 0, '入口 chunk 不参与合并')
  })
}`

/* ============================================================ 第 4 关代码（三步共用，写一份） */
const L4C1 = `// ESM 的依赖是静态结构：解析阶段就能读出边，不需要执行
function firstQuoted(text) {
  const quotes = ["'", '"']
  for (let q = 0; q < quotes.length; q++) {
    const i = text.indexOf(quotes[q])
    if (i < 0) continue
    const j = text.indexOf(quotes[q], i + 1)
    if (j > i) return text.slice(i + 1, j)
  }
  return null
}

function parseImports(source) {
  const lines = String(source).split('\\n')
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.indexOf('//') === 0) continue
    if (line.indexOf('import') !== 0 && line.indexOf('export') !== 0) continue
    if (line.indexOf('import(') >= 0) continue
    let spec = null
    const fromIdx = line.indexOf(' from ')
    if (fromIdx >= 0) {
      spec = firstQuoted(line.slice(fromIdx + 6).trim())
    } else if (line.indexOf('import ') === 0 && line.charAt(6) !== '(') {
      spec = firstQuoted(line.slice(7))
    }
    if (spec && out.indexOf(spec) < 0) out.push(spec)
  }
  return out
}

// exports 条件映射：按 key 的书写顺序匹配，default 是通配（所以它必须放最后）
function pickCondition(entry, active) {
  if (typeof entry === 'string') return entry
  if (Array.isArray(entry)) {
    for (let i = 0; i < entry.length; i++) {
      const got = pickCondition(entry[i], active)
      if (got) return got
    }
    return null
  }
  if (!entry || typeof entry !== 'object') return null
  const keys = Object.keys(entry)
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]
    if (k !== 'default' && !active[k]) continue
    const got = pickCondition(entry[k], active)
    if (got) return got
  }
  return null
}

function toSet(list) {
  const out = {}
  for (let i = 0; i < (list || []).length; i++) out[list[i]] = true
  return out
}

function exportsField(pkg, key, conditions) {
  const exp = pkg ? pkg.exports : null
  if (exp == null) return (pkg && pkg.main) || './index.js'
  const active = toSet(conditions)
  let entry = exp
  if (typeof exp === 'string') return exp
  if (key && exp[key] != null) entry = exp[key]
  else if (key && exp['.'] != null) entry = exp['.']
  return pickCondition(entry, active)
}

// ESM 加载 CJS：默认导入 = module.exports 本体；带 __esModule 才是转译器产物的 default
function interopDefault(cjs) {
  if (cjs && cjs.__esModule) return cjs.default
  return cjs
}

function interopNamespace(cjs) {
  const out = { default: cjs && cjs.__esModule ? cjs.default : cjs }
  const keys = Object.keys(cjs || {})
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] === 'default' || keys[i] === '__esModule') continue
    out[keys[i]] = cjs[keys[i]]
  }
  return out
}

// 双包陷阱：同一库被 import 与 require 各载一份，instanceof 失败、状态分裂
function dualHazard(pkg) {
  const exp = pkg ? pkg.exports : null
  if (exp == null) {
    const main = (pkg && pkg.main) || './index.js'
    return { hazard: false, import: main, require: main }
  }
  const root = exp['.'] != null ? exp['.'] : exp
  if (typeof root === 'string') return { hazard: false, import: root, require: root }
  const imp = pickCondition(root, { import: true, node: true })
  const req = pickCondition(root, { require: true, node: true })
  return { hazard: imp !== req, import: imp, require: req }
}`

const L4C2 = `${L4C1}

// 三色 DFS：白未访问 / 灰在栈上 / 黑已完成；遇到灰色就是回边 = 有环
function topoOrder(modules) {
  const byId = {}
  const list = modules || []
  for (let i = 0; i < list.length; i++) byId[list[i].id] = list[i]
  const state = {}
  const order = []
  let cycle = null

  function visit(id, path) {
    if (cycle) return
    if (state[id] === 2) return
    if (state[id] === 1) {
      const start = path.indexOf(id)
      cycle = path.slice(start < 0 ? 0 : start).concat([id])
      return
    }
    state[id] = 1
    const m = byId[id]
    const deps = m ? (m.imports || []) : []
    for (let i = 0; i < deps.length; i++) visit(deps[i], path.concat([id]))
    if (cycle) return
    state[id] = 2
    order.push(id)
  }

  for (let i = 0; i < list.length; i++) {
    if (!state[list[i].id]) visit(list[i].id, [])
  }
  return { order: order, cycle: cycle }
}

// tree-shaking 的可达性判定：从入口出发，只有真正被 import 的导出名才保留；
// 没被引用但自己声明了 sideEffects 的模块整块保留（css / polyfill / 注册类副作用）
function treeShake(modules, entry) {
  const byId = {}
  const list = modules || []
  for (let i = 0; i < list.length; i++) byId[list[i].id] = list[i]
  const keptModules = []
  const keptExports = {}
  const dropped = []
  if (!byId[entry]) return { modules: keptModules, exports: keptExports, dropped: dropped }

  keptExports[entry] = (byId[entry].exports || []).slice()
  const queue = [entry]
  const seen = {}
  while (queue.length > 0) {
    const id = queue.shift()
    if (seen[id]) continue
    seen[id] = true
    keptModules.push(id)
    const m = byId[id]
    const imports = m.imports || []
    for (let i = 0; i < imports.length; i++) {
      const depId = imports[i]
      const dep = byId[depId]
      if (!dep) continue
      const names = (m.used && m.used[depId]) || []
      if (names.length > 0) {
        if (!keptExports[depId]) keptExports[depId] = []
        for (let k = 0; k < names.length; k++) {
          if (keptExports[depId].indexOf(names[k]) < 0) keptExports[depId].push(names[k])
        }
        if (!seen[depId]) queue.push(depId)
      } else if (dep.sideEffects) {
        if (!keptExports[depId]) keptExports[depId] = []
        if (!seen[depId]) queue.push(depId)
      }
    }
  }

  for (let i = 0; i < list.length; i++) {
    const m = list[i]
    const kept = keptExports[m.id] || []
    if (keptModules.indexOf(m.id) < 0) {
      const names = m.exports || []
      for (let k = 0; k < names.length; k++) dropped.push(m.id + '#' + names[k])
      continue
    }
    const names = m.exports || []
    for (let k = 0; k < names.length; k++) {
      if (kept.indexOf(names[k]) < 0) dropped.push(m.id + '#' + names[k])
    }
  }
  return { modules: keptModules, exports: keptExports, dropped: dropped }
}

// 同一个 browserslist 目标同时决定「语法要不要降级」和「API 要不要 polyfill」
const CAPABILITY = {
  es5: {},
  es2015: {
    arrow: true, const: true, class: true, template: true, destructuring: true,
    Promise: true, Map: true, Set: true
  },
  es2019: {
    arrow: true, const: true, class: true, template: true, destructuring: true,
    Promise: true, Map: true, Set: true, 'Object.fromEntries': true
  },
  es2020: {
    arrow: true, const: true, class: true, template: true, destructuring: true,
    Promise: true, Map: true, Set: true, 'Object.fromEntries': true,
    optionalChaining: true, nullish: true, BigInt: true, globalThis: true
  },
  es2022: {
    arrow: true, const: true, class: true, template: true, destructuring: true,
    Promise: true, Map: true, Set: true, 'Object.fromEntries': true,
    optionalChaining: true, nullish: true, BigInt: true, globalThis: true,
    classFields: true, topLevelAwait: true, 'Array.prototype.at': true, structuredClone: true
  }
}

function featureGaps(used, target) {
  const support = CAPABILITY[target] || CAPABILITY.es2022
  const missing = []
  const okList = []
  const list = used || []
  for (let i = 0; i < list.length; i++) {
    if (support[list[i]]) okList.push(list[i])
    else missing.push(list[i])
  }
  return { target: target, missing: missing, ok: okList }
}`

const L4C3 = `${L4C2}

function fnv1a(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0
  }
  return h.toString(16)
}

// 分包：入口的静态闭包一个 chunk、每个动态 import 边界一个 chunk、被两个以上 chunk 引用的抽 shared
function chunkPlan(modules, entry, opts) {
  const config = opts || {}
  const minSize = config.minSize || 0
  const byId = {}
  const list = modules || []
  for (let i = 0; i < list.length; i++) byId[list[i].id] = list[i]

  function staticClosure(rootId) {
    const out = []
    const stack = [rootId]
    const seen = {}
    while (stack.length > 0) {
      const id = stack.pop()
      if (seen[id]) continue
      seen[id] = true
      const m = byId[id]
      if (!m) continue
      out.push(id)
      const deps = m.imports || []
      for (let i = 0; i < deps.length; i++) {
        if (!seen[deps[i]]) stack.push(deps[i])
      }
    }
    return out
  }

  function chunkSize(ids) {
    let n = 0
    for (let i = 0; i < ids.length; i++) {
      const m = byId[ids[i]]
      if (m) n += m.size || 0
    }
    return n
  }

  const entryMod = byId[entry]
  const roots = [entry]
  const dyn = entryMod ? (entryMod.dynamic || []) : []
  for (let i = 0; i < dyn.length; i++) roots.push(dyn[i])

  const closures = {}
  const counts = {}
  for (let r = 0; r < roots.length; r++) {
    const cl = staticClosure(roots[r])
    closures[roots[r]] = cl
    for (let i = 0; i < cl.length; i++) {
      counts[cl[i]] = (counts[cl[i]] || 0) + 1
    }
  }

  const chunkOf = {}
  const chips = []
  const shared = []
  for (const id in counts) {
    if (counts[id] > 1) {
      shared.push(id)
      chunkOf[id] = 'shared'
    }
  }
  shared.sort()

  // 每个 chunk 记下它包含模块的版本号，contenthash 要用它们判断内容有没有变
  function revsOf(ids) {
    const revs = {}
    for (let i = 0; i < ids.length; i++) {
      const m = byId[ids[i]]
      revs[ids[i]] = m && m.rev ? m.rev : 1
    }
    return revs
  }

  if (shared.length > 0) chips.push({ name: 'shared', modules: shared, revs: revsOf(shared) })

  for (let r = 0; r < roots.length; r++) {
    const root = roots[r]
    const name = root === entry ? 'index' : 'lazy-' + root
    const own = []
    const cl = closures[root]
    for (let i = 0; i < cl.length; i++) {
      const id = cl[i]
      if (chunkOf[id]) continue
      chunkOf[id] = name
      own.push(id)
    }
    if (own.length > 0) chips.push({ name: name, modules: own, revs: revsOf(own) })
  }

  // 碎片合并：小于阈值的非入口 chunk 并进 shared（换来少一轮 RTT，代价是首屏多下一点）
  const mergedShared = []
  const finalChips = []
  for (let i = 0; i < chips.length; i++) {
    const c = chips[i]
    if (minSize > 0 && c.name !== 'index' && chunkSize(c.modules) < minSize) {
      for (let k = 0; k < c.modules.length; k++) mergedShared.push(c.modules[k])
      continue
    }
    finalChips.push(c)
  }
  if (mergedShared.length > 0) {
    let hit = null
    for (let i = 0; i < finalChips.length; i++) {
      if (finalChips[i].name === 'shared') hit = finalChips[i]
    }
    if (hit) hit.modules = hit.modules.concat(mergedShared)
    else finalChips.unshift({ name: 'shared', modules: mergedShared })
  }
  for (let i = 0; i < finalChips.length; i++) {
    finalChips[i].revs = revsOf(finalChips[i].modules)
  }
  return finalChips
}

// contenthash = chunk 内容的指纹：模块 id + 版本号都进内容，改哪块炸哪块
function hashChunks(plan) {
  const out = []
  const list = plan || []
  for (let i = 0; i < list.length; i++) {
    const c = list[i]
    let content = c.name + ':'
    for (let k = 0; k < c.modules.length; k++) {
      const id = c.modules[k]
      const rev = c.revs && c.revs[id] ? c.revs[id] : 1
      content += id + '@' + rev + ','
    }
    out.push({ name: c.name, modules: c.modules.slice(), hash: fnv1a(content) })
  }
  return out
}

function cacheRate(before, after) {
  const prev = {}
  const b = before || []
  for (let i = 0; i < b.length; i++) prev[b[i].name] = b[i].hash
  const a = after || []
  let hit = 0
  for (let i = 0; i < a.length; i++) {
    if (prev[a[i].name] === a[i].hash) hit += 1
  }
  return { hit: hit, total: a.length, rate: a.length === 0 ? 0 : hit / a.length }
}`

/* ============================================================ 第 4 关：模块、打包与缓存 */
const LV4 = {
  id: 'lv4',
  title: '迷你打包器：从 ESM 到分 chunk 产物',
  emoji: '📦',
  xp: 60,
  goal:
    '实现一个最小打包器：parseImports/exportsField/interopDefault/dualHazard 处理模块解析与 ESM-CJS 互操作；topoOrder/treeShake/featureGaps 做依赖图拓扑序、循环检测、tree-shaking 可达性与语法降级判定；chunkPlan/hashChunks/cacheRate 完成按动态边界分包、shared 抽取、contenthash 与缓存命中率。',
  why:
    'Tree-shaking 失效、chunk 全量失效、双包陷阱这三类问题在生产里都很贵：第一个让包体白白多几百 KB，第二个让用户每次发布都重下全量产物，第三个让 instanceof 和单例状态在运行时节外生枝。它们的共同点是——从产物上看不出来，只能靠机制解释。\n\n所以这一关不背结论，直接把机制写成代码：可达性判定（谁被 import、模块有没有副作用）决定哪些导出能删；chunk 的 contenthash 包含哪些输入决定缓存能不能复用；exports 条件映射的 key 顺序决定 Node 和打包器会不会解析到不同文件。写一遍之后，再看 vite build 的产物目录，你能说出每个 hash 变了是因为哪一处改动。',
  nodes: ['fe.build.module', 'fe.build.module.esm-cjs', 'fe.build.module.transform', 'fe.build.bundle', 'fe.build.bundle.caching', 'fe.build.bundle.optimization'],
  thinking: [
    {
      title: '先分清「静态可分析」与「运行时才知道」',
      md:
        'ESM 与 CJS 的分野不在语法糖，而在**什么时候能知道依赖**：ESM 的 import 是静态声明，解析阶段就能读出整个依赖图，所以能 tree-shake、能提前并行加载；CJS 的 require 可以写在 if 里、路径可以拼字符串，只能运行时求值，所以整包保活。\n\n这也是「CommonJS 库不可摇」的根本原因，不是工具不给力。\n\nlive binding 是另一个 ESM 特有的点：import 拿到的是绑定而不是值拷贝，所以循环引用时 ESM 能拿到「还没初始化」而不会像 CJS 那样拿到半成品 exports。这就是我在第 1 步把「静态解析」和「互操作形状」放在一起的原因：它们是同一件事的两面。'
    },
    {
      title: '互操作的所有坑都来自「默认导入到底是谁」',
      md:
        'Node 加载 CJS 时，`module.exports` 就是默认导出；而 Babel/TS 编译出来的 ESM 会在 exports 上挂 `__esModule: true` 并把真正的默认值放在 `.default`。于是同一个「默认导入」在不同加载器下有两条路径，互相导入时就会出现「default 是对象还是值」的分裂。\n\n这条规则我写成 interopDefault：有 `__esModule` 取 `.default`，否则整个 module.exports。namespace 导入则要额外补一个 default 字段（值同样是 module.exports），否则 `import * as ns` 之后 `ns.default` 是 undefined——这是最常见的一类线上 bug。\n\n再加上双包陷阱：exports 里 import 与 require 指向两个不同文件，运行时就真的有两份实例。所以「single package」是最省事的解法。'
    },
    {
      title: '缓存能不能复用，取决于 hash 里放了什么',
      md:
        'contenthash 的本质是「这个 chunk 的内容指纹」。设计它的时候要先回答：哪些输入会影响产物？至少是模块 id、模块内容、以及**loader 链与构建配置**。少放一样，就会出现「改了配置产物没变」；多放一样（比如把时间戳、构建序号塞进去），就会出现「每次发布全量失效」。\n\n分包策略同理：把 react 全家桶塞进一个 vendor chunk，等于让最稳定的依赖跟着最高频的业务一起变；按稳定性分层（框架核心一层、业务一层、runtime 单独一层）才能让 hash 连锁污染停下来。这一关第 3 步的 cacheRate 就是这套设计的度量：改动一个模块，理想情况只有包含它的那个 chunk 换 hash。'
    }
  ],
  prereq: [
    {
      title: 'ESM 与 CJS 的语义差异（面试必问的四条）',
      md:
        '1. 加载时机：ESM 静态分析、链接在前执行在后；CJS 边执行边 require。\n2. 绑定方式：ESM 是 live binding（导出变了导入方能看到），CJS 是值拷贝（`exports.x` 重新赋值后导入方看不到，除非改的是对象属性）。\n3. 顶层语义：ESM 的 this 是 undefined、有 top-level await；CJS 的 this 是 module.exports、顶层可以随便写。\n4. 循环引用：CJS 拿到「半成品 exports」（可能缺字段），ESM 拿到未初始化的绑定（TDZ 报错但结构完整）。\n\n```js\n// cjs/a.js\nexports.x = 1\nconst b = require("./b")   // b 里看到 a.x 已经是 1\n// esm/a.js\nexport const x = 1\nimport { y } from "./b.js"  // b 若先执行，y 可能是 TDZ\n```\n\n打包器要同时吃这两种模块，所以内部会有一套 interop helper 做形状适配。'
    },
    {
      title: 'exports 字段：条件映射、顺序敏感与通配',
      md:
        '`exports` 用条件映射决定「什么环境拿什么文件」，key 的**书写顺序**就是匹配优先级，`default` 是通配兜底，所以它必须放最后——放在最前面会让所有条件都解析到它。\n\n```json\n{\n  "exports": {\n    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.mjs", "require": "./dist/index.cjs" }\n  }\n}\n```\n\n`types` 必须写在 import/require 分支里（或至少同一层且靠前），否则 TS 会走错解析。另外 `imports` 是给 `#internal` 这类内部别名用的，与 `exports` 不是一回事。\n\n条件顺序敏感这一点，也是「本地能跑、发布后报错」的高发区。'
    },
    {
      title: 'tree-shaking 的三个前提与失效场景',
      md:
        '三前提：模块是 ESM 静态结构；依赖方声明了 `sideEffects: false`（或 glob 数组，css 要豁免）；死代码在 seal 阶段被删且 terser 做二次清除。\n\n失效场景几乎都能归到「工具不敢删」：顶层副作用（axios 实例配置、RxJS 的 patch 式注册）、具名再导出链条断裂（`export * from` 有时让工具放弃）、require 混入导致模块整体保活、CommonJS 库不可摇。\n\n```json\n{ "sideEffects": ["*.css", "./src/polyfill.js"] }\n```\n\n类的方法被当死代码删掉时，需要 `/*#__PURE__*/` 注释告诉压缩器「这个调用没有副作用」。'
    }
  ],
  api: [
    {
      name: 'exportsField / interopDefault / dualHazard',
      sig: 'exportsField(pkg, key, conditions) => string|null；interopDefault(cjs) => any；dualHazard(pkg) => { hazard, import, require }',
      args:
        'pkg 是 package.json 形态的对象；key 是子路径（"." 或 "./feature"）；conditions 是当前环境的条件集合（如 ["import","node"]，顺序无关，匹配按 exports 里 key 的书写顺序）。',
      returns:
        'exportsField 返回解析到的文件路径，没有 exports 时退回 main；interopDefault 返回 ESM 侧看到的默认值；dualHazard 返回两条解析路径以及它们是否指向不同文件（hazard 为 true 表示有状态分裂风险）。',
      example:
        'const pkg = { exports: { ".": { import: "./esm.js", require: "./cjs.js" } } }\nexportsField(pkg, ".", ["import"])       // "./esm.js"\ndualHazard(pkg).hazard                    // true\ninteropDefault({ __esModule: true, default: 42 })   // 42'
    },
    {
      name: 'topoOrder / treeShake / featureGaps',
      sig: 'topoOrder(modules) => { order, cycle }；treeShake(modules, entry) => { modules, exports, dropped }；featureGaps(used, target) => { target, missing, ok }',
      args:
        'modules 是 { id, imports, exports, used, sideEffects }；used[depId] 是「从这个依赖里 import 了哪些名字」，空数组表示只要副作用；target 是 es5/es2015/es2019/es2020/es2022 之一。',
      returns:
        'topoOrder 给出依赖在前的顺序，有环时 cycle 是环上的路径（首尾同 id）且 order 为空；treeShake 返回保留下来的模块与导出名、以及被删掉的 "模块#导出" 列表；featureGaps 把用到的能力分成 missing（要降级/补 polyfill）与 ok 两组。',
      example:
        'treeShake([{ id: "entry", imports: ["u"], used: { u: ["format"] } }, { id: "u", exports: ["format", "deep"], sideEffects: false }], "entry")\n// { modules: ["entry", "u"], exports: { entry: [], u: ["format"] }, dropped: ["u#deep"] }'
    },
    {
      name: 'chunkPlan / hashChunks / cacheRate',
      sig: 'chunkPlan(modules, entry, { minSize }) => [{ name, modules }]；hashChunks(plan) => [{ name, modules, hash }]；cacheRate(before, after) => { hit, total, rate }',
      args:
        'modules 里每个模块带 imports（静态）、dynamic（动态 import 边界）、size（字节）、rev（版本号，用来模拟内容变化）；minSize 是碎片合并阈值（0 表示不合并）。',
      returns:
        'chunkPlan 返回 chunk 列表：index 是入口静态闭包、lazy-<id> 是动态边界、shared 是被多个 chunk 引用的公共依赖；hashChunks 给出每个 chunk 的 contenthash；cacheRate 给出两次构建之间未变 chunk 的占比。',
      example:
        'const plan = chunkPlan([{ id: "entry", imports: ["a", "util"], dynamic: ["lazy"] }, { id: "a", imports: ["util"] }, { id: "util" }, { id: "lazy", imports: ["util"] }], "entry")\nplan.map((c) => c.name)     // ["shared", "index", "lazy-lazy"]\ncacheRate(hashChunks(plan), hashChunks(plan)).rate   // 1'
    }
  ],
  usage:
    '这一关的函数在真实项目里对应的都是配置项与排查动作：\n\n```js\n// 1) 查双包陷阱：同一个库是不是被载了两份\n// pnpm why react  -> 看解析链是不是分叉到两个路径\n// npm ls react    -> 看 dedupe 有没有生效\n\n// 2) 分包：按稳定性分层，而不是按「是不是 node_modules」\n// vite.config.js\nbuild: {\n  rollupOptions: {\n    output: {\n      manualChunks: { react: ["react", "react-dom"], vendor: ["lodash-es"] }\n    }\n  }\n}\n\n// 3) 体积预算进 CI\n// npx size-limit\n```\n\n对应关系：dualHazard 是「pnpm why 该看什么」的理论；chunkPlan 是 manualChunks 的规则化版本（入口 + 动态边界 + 共享抽取）；hashChunks 解释了你为什么要把 runtime 单独拆出来——runtime 里带着 chunk 映射表，它一变，所有 chunk 的引用路径都变，hash 连锁污染就来了。',
  hints: [
    '第 1 步：parseImports 用逐行扫描而不是正则（沙箱里正则转义容易写错）；pickCondition 按 key 顺序遍历，default 永远算命中。',
    '第 2 步：topoOrder 用 state 1/2 三色标记，path 用 concat 传递（不要共享同一个数组）；treeShake 是 BFS + 只保留被 import 的名字，sideEffects 为真但导出没用的模块要保留模块本身。',
    '第 3 步：先算每个 root 的静态闭包，被引用次数 > 1 的进 shared；hashChunks 的内容串里要带模块 rev，否则改了代码 hash 不变。'
  ],
  concepts: [
    {
      title: '为什么 runtime chunk 要单独拆',
      md:
        'Rollup/webpack 的运行时里存着「chunk id → 文件名」的映射表。如果不把 runtime 拆出来，任何一次发布改变某个 chunk 的 hash，这个映射表就会变，而它被打进每个依赖它的 chunk 里——于是所有 chunk 的 hash 都跟着变，长效缓存彻底失效。\n\n这就是「hash 连锁污染」：改动一个业务模块，用户却要重下整个应用。拆出 runtime 之后，只有 runtime 与真正改动的 chunk 换 hash。\n\n同理，vendor 也要按稳定性分层：框架核心一年不动，业务组件天天变，混在一起等于每次都让最贵的那部分失效。'
    },
    {
      title: '这个模拟器简化了什么',
      md:
        '1. 模块图是手写的静态表：没有真实的解析（resolve）过程，bare specifier 与相对路径的区别被省掉了，imports 里直接写模块 id。\n2. tree-shaking 只看「有没有被 import 名字」：真实工具还要做作用域分析、再导出链条追踪、PURE 注释判定，以及 terser 的二次清除。\n3. contenthash 用 FNV-1a 拼内容串：真实工具对 chunk 做 AST/源串 hash，并受 sourcemap 注释、压缩结果影响。\n4. 分包没有考虑循环依赖导致的 chunk 环、没有 sideEffects 豁免表，也没有 modulePreload 的依赖注入顺序。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '先能读懂模块：静态依赖与互操作形状',
      think:
        '打包器的第一步永远是「读出边和形状」：哪些 import 是静态的（能进图）、exports 条件到底解析到哪个文件、CJS 转成 ESM 之后默认导入长什么样。这一步不碰图算法，因为后面的拓扑序和 tree-shaking 全部建立在这份读数上，读错了后面全错。',
      hint:
        'parseImports 逐行扫描，只认行首 import/export 且跳过 import(；pickCondition 是递归的：字符串直接返回，对象按 key 顺序找第一个命中的条件。',
      vocab: [
        { term: 'live binding', desc: 'ESM 的导入是指向导出绑定的引用，导出方改值，导入方能立刻看到' },
        { term: '双包陷阱', desc: 'dual package hazard：同一库被 ESM/CJS 各载一份，导致 instanceof 失败与状态分裂' }
      ],
      code: L4C1,
      test: L4S1,
      diag: [
        'parseImports 用整段 indexOf 找 import，把 import() 也当成了静态依赖；动态 import 必须排除。',
        'exportsField 忽略了 pkg.main 兜底，没有 exports 的包直接返回 null。',
        'pickCondition 先按条件集顺序匹配而不是按 key 书写顺序，default 提前的问题就测不出来。',
        'interopDefault 无条件取 .default，导致普通 CJS 的默认导入变成 undefined。',
        'dualHazard 只比较了是否有 exports，没真正比较 import/require 解析出来的两个路径。'
      ]
    },
    {
      n: 2,
      title: '把图跑通：拓扑序、循环与可达性',
      think:
        '有了静态边，第二步是「图本身」：能不能排出执行顺序、有环怎么报、哪些导出真的需要保留。这一步的验收点是「删对了」而不是「跑通了」——tree-shaking 最容易写成一个永远返回全量的摆设，必须用 dropped 列表证明它真的删了东西。',
      hint:
        'topoOrder 的 state 用 1 表示在栈上、2 表示已完成，遇到 1 就是回边；treeShake 用队列 BFS，used 里有名字就只保留这些名字，空数组时看 dep.sideEffects 决定整块留还是整块丢。',
      code: L4C2,
      test: L4S2,
      diag: [
        'topoOrder 把 id 在自己出栈时就 push，导致依赖排到了依赖者后面（成了逆序）。',
        '循环检测没有用「在栈上」这个状态，或者把环的路径截成了空数组。',
        'treeShake 把被 import 的依赖的**所有**导出都保留，等于没摇（dropped 里查不到 unusedDeep）。',
        'sideEffects 判断反了：无副作用的未引用模块被留下，有副作用的反而被整块删掉。',
        '语法降级表写错：es2015 里漏了 arrow，或者把 optionalChaining 也算成 es2015 支持。',
        'featureGaps 只判了语法没判 API：es2019 的 structuredClone 被当成可用，polyfill 就不会注入。'
      ]
    },
    {
      n: 3,
      title: '分包、hash 与缓存命中率',
      think:
        '最后一步把图变成产物：入口静态闭包一个 chunk、每个动态边界一个 chunk、多个 chunk 都引用的抽 shared；hash 只随内容变，缓存命中率才有意义。这一步的量化验收很直接——同一份图改一个模块，应该只有一个 chunk 换 hash。',
      hint:
        '先对每个 root（入口 + 每个动态边界）求静态闭包并统计引用次数，>1 的进 shared；hashChunks 的内容串拼上模块 rev；cacheRate 按 chunk 名比对 hash。',
      code: L4C3,
      test: L4S3,
      diag: [
        'chunkPlan 没有把动态边界当成独立 root，所有模块都塞进入口 chunk。',
        'shared 的判断写成了「出现在两个 root 的闭包里就抽」，但没去重，导致模块在两个 chunk 里重复出现。',
        'hashChunks 只拼了 chunk 名和模块 id，没带 rev，改了内容 hash 也不变。',
        'cacheRate 按「chunk 数」算命中而不是按 hash 是否相同，永远返回 100%。',
        'minSize 合并把入口 chunk 也合并了，首屏直接变成同步加载全部代码。'
      ]
    }
  ],
  skeleton: `function parseImports(source) {
  // TODO: 逐行扫描出静态 import/export 的 specifier
  throw new Error('parseImports 还没实现')
}

function topoOrder(modules) {
  // TODO: 三色 DFS + 环检测
  throw new Error('topoOrder 还没实现')
}

function treeShake(modules, entry) {
  // TODO: 可达性判定 + sideEffects 保留
  throw new Error('treeShake 还没实现')
}

function chunkPlan(modules, entry, opts) {
  // TODO: 入口/动态边界分包 + shared 抽取
  throw new Error('chunkPlan 还没实现')
}`,
  solution: L4C3,
  finalCode: L4C3,
  tests: `${L4S1}\n${L4S2}\n${L4S3}`
}

export default {
  id: 'fe-browser',
  version: 3,
  domain: 'fe',
  cumulative: false,
  title: '浏览器运行时与构建链',
  emoji: '🌐',
  tagline: '4 关 12 步：帧流水线、存储配额与 GC、构建工具链、打包产物，全部落成可算数的模拟器。',
  stack: ['浏览器渲染', '事件循环', 'V8', '构建工具链'],
  intro:
    '浏览器和构建链是前端面试最容易「背了但答不透」的两块：名词都听过，一问时序和边界就露馅。这个项目不给定义，给四个可运行的模拟器——先是主线程怎么把一帧画出来（脏标记 → 事件循环 → INP），再是同源存储怎么计配额、Worker 怎么卸载、V8 怎么分代回收，然后是依赖树、按需编译与编译缓存，最后是模块互操作、tree-shaking 与 chunk 缓存。每一关都用参数注入的时钟和预算把行为量化，写不出数字就说明还没想清楚。',
  outcome:
    '做完之后你能白板画出「一次点击到一帧上屏」的完整时序，能解释 reflow / repaint / composite 的边界与 INP 的算法，能写出带配额淘汰和跨标签同步的存储层，能讲清 pnpm 的隔离结构为什么根治幽灵依赖、Vite 冷启动为什么是 O(入口)、webpack 的 loader 为什么从右到左；也能手写一个最小打包器，把 tree-shaking 的可达性判定、动态边界分包和 contenthash 缓存命中率算出来。',
  levels: [LV1, LV2, LV3, LV4]
}