---
node: fe.vue.scheduler.nexttick
title: nextTick 与异步更新队列
sources:
  - url: https://vuejs.org/api/general.html
    title: Vue 官方文档 · Global API: General（nextTick）
    kind: official
  - url: https://github.com/vuejs/core/blob/v3.5.45/packages/runtime-core/src/scheduler.ts
    title: vuejs/core v3.5.45 packages/runtime-core/src/scheduler.ts
    kind: source
  - url: https://vuejs.org/guide/essentials/reactivity-fundamentals.html
    title: Vue 官方文档 · Reactivity Fundamentals
    kind: official
  - url: https://github.com/vuejs/core/blob/v3.5.45/packages/runtime-core/src/component.ts
    title: vuejs/core v3.5.45 packages/runtime-core/src/component.ts
    kind: source
updated: 2026-11-10T06:40:00Z
generator: hand-written@1
reviewed: true
confidence: high
---

## 一句话本质
响应式改动不会立刻写 DOM：更新被塞进一个去重、排序的任务队列，等当前同步代码跑完后在**微任务**里统一 flush；`nextTick()` 返回的就是「排到这次 flush 之后」的 Promise，所以 `await nextTick()` 之后 DOM 已更新、但还没绘制。

## 为什么需要它
如果每次属性赋值都同步改 DOM，一段循环里的十次赋值会产生十次重排重绘，而且多个组件读同一份状态时会重复渲染。官方文档对这件事的说法很直接：改动响应式状态后 DOM 更新不是同步应用的，Vue 会把它们缓冲到「next tick」，**保证每个组件无论被改多少次都只更新一次**[^1]。

异步化还带来第二个必需能力：**顺序**。组件更新必须父先于子（否则子组件读到的还是旧 props），而 watcher 又要在所属组件渲染之前跑完（pre-flush）。这两条只能靠给任务排队排序来实现，不能靠触发顺序——因为触发顺序取决于谁先写了那个字段[^2]。

第三条约束是防失控：effect 里改自己的依赖会无限递归（模板、`updated` 钩子、watch source 都可能犯），必须有上限并把错误报出来而不是让浏览器卡死[^2]。

## 机制讲清楚
入队只有一个入口 `queueJob()`[^2]：

```ts
// vuejs/core v3.5.45 packages/runtime-core/src/scheduler.ts（节选）
export function queueJob(job) {
  if (!(job.flags & SchedulerJobFlags.QUEUED)) {          // 去重：靠位标记，不用 Set
    const jobId = getId(job)
    const lastJob = queue[queue.length - 1]
    if (!lastJob || (!(job.flags & SchedulerJobFlags.PRE) && jobId >= getId(lastJob))) {
      queue.push(job)                                      // id 比队尾大 → 尾部追加快路径
    } else {
      queue.splice(findInsertionIndex(jobId), 0, job)      // 否则二分插入，保持 id 升序
    }
    job.flags |= SchedulerJobFlags.QUEUED
    queueFlush()
  }
}
function queueFlush() {
  if (!currentFlushPromise) currentFlushPromise = resolvedPromise.then(flushJobs)
}
```

三个要点：**(a)** 去重用 `SchedulerJobFlags.QUEUED` 位标记而不是集合，同一个 job 在一轮 flush 内只会执行一次，这就是「改一百次只渲染一次」的实现位置[^2]。**(b)** 队列按 job id 升序维护，源码注释解释得很清楚：组件的 id 就是它的 uid，父组件先创建所以 id 更小，因此升序天然给出「父先于子」；`flush: 'pre'` 的 watcher 与所属组件的更新 job **id 相同**，二分时会被插到更新 job 之前，于是当父组件更新过程中把该子组件卸载掉时，这个 watcher 可以顺带被跳过[^2]。**(c)** 只有 `currentFlushPromise` 为空时才挂新的 flush，也就是整轮批量只会有一个微任务[^2]。

`getId` 的兜底值同样有讲究：没有 id 的 job，带 PRE 标记算 `-1`（排最前），不带算 `Infinity`（排最后）——前者是 pre watcher，后者通常是外部 `queueJob` 的匿名任务[^2]。

flush 阶段（`flushJobs`）[^2]：

1. 正序遍历 `queue`，跳过带 `DISPOSED` 的 job；执行前对 ALLOW_RECURSE 的 job 先清掉 QUEUED（允许它在本轮再次入队，组件更新与 watch 回调属于这类，`Array.prototype.push` 这种「写中带读」的普通 effect 则不允许自递归）；
2. 每个 job 都用 `callWithErrorHandling` 包一层，错误码是 `COMPONENT_UPDATE` / `SCHEDULER`——所以**某个组件渲染抛错不会打断同批其他组件**，错误走 `app.config.errorHandler`；
3. `finally` 里无条件清空 QUEUED 标记、重置队列，然后 `flushPostFlushCbs(seen)`（`flush: 'post'` 的 watcher 与 `mounted`/`updated` 钩子在这一批里跑，先 `new Set` 去重再按 id 升序排），最后把 `currentFlushPromise` 置 null；若此时两个队列又有了新任务，就**递归再 flush 一轮**[^2]。

pre-flush 由 `flushPreFlushCbs(instance?, minUid?)` 负责：它从 `flushIndex + 1` 开始扫剩余队列，只挑带 PRE 标记、且 `cb.id === instance.uid` 的 job 提前执行——这是「组件渲染前先跑它的 pre watcher」这条规则的落点；3.5 还加了 `minUid`，让挂载/卸载只冲刷本次创建的组件的任务，别的组件任务留在队列里保持原顺序（源码注释引了 #5721 / #6728 两个 issue）[^2]。

`nextTick` 本体只有两行[^2]：

```ts
const resolvedPromise = Promise.resolve()
let currentFlushPromise = null
export function nextTick(fn) {
  const p = currentFlushPromise || resolvedPromise   // 有正在排的 flush → 挂在它后面
  return fn ? p.then(this ? fn.bind(this) : fn) : fn
}
```

于是语义变得非常精确：**已经有 flush 在微任务里等着** → `nextTick` 的回调接在它之后，即 DOM 更新完之后；**没有 flush** → 退化成普通微任务，同样在当前同步栈结束后执行[^2]。官方给的用法正是在改状态之后 `await nextTick()` 再读 DOM，并特别提示：在 `created` / setup 阶段还早于首次渲染，要用 `onMounted` 而不是 `nextTick`[^1]。

递归保护只在开发期生效：`checkRecursiveUpdates` 用一个 `CountMap` 计数，超过 `RECURSION_LIMIT = 100` 就报 `Maximum recursive updates exceeded in component <X>` 并跳过该 job[^2]。生产构建里这段被摇掉，代价是自递归的 effect 可能真的转很多轮。

## 关键结论
- 「异步」的实现位置是 `queueFlush()` 里那一句 `resolvedPromise.then(flushJobs)`：一个微任务，不是宏任务、也不是 rAF[^2]。
- 去重靠 job 上的 QUEUED 位标记；一个组件的更新 job 在一轮里最多跑一次[^2]。
- 顺序靠 id 升序 + 二分插入：父先于子；pre watcher 与宿主组件同 id 并被插在更新之前，因而可随卸载一起跳过[^2]。
- `flush: 'pre' | 'post' | 'sync'` 三种 watcher 对应队列的三个位置：pre 进主队列靠前的 PRE 段、post 进 `pendingPostFlushCbs`（等 DOM 更新后才跑，适合读 DOM）、sync 完全不入队立即执行[^2]。
- `nextTick()` 等的是「本轮 flush 完成」，不是「浏览器已绘制」；要看真实绘制结果还得 `requestAnimationFrame`（这是两条不同的边界）[^1][^2]。
- post-flush 里新入队的任务会触发递归 flush，因此「post 钩子里再改状态」不会丢更新，但可能被 `RECURSION_LIMIT` 拦下[^2]。
- 3.5.45 的调度器还带了 Suspense 相关标记（`REQUEUE_ON_SUSPENSE_DISCARD` / `FLUSH_ON_SUSPENSE_RESOLVE`）与 `flushOnAppMount`，用来处理挂起分支被丢弃时 post 任务不丢失[^2]。

## 常见误区
- 「nextTick 是 setTimeout / setImmediate 的降级链」——那是 Vue 2 的事；Vue 3 只有微任务（`Promise.resolve().then`）[^2]。
- 「await nextTick() 就能看到画面」——不准确：此时 DOM 已改，但样式计算与绘制在下一帧；测布局尺寸通常够用，截图对比要用 rAF[^1][^2]。
- 「setup 里 nextTick 能拿到 DOM」——不行，那时还没挂载，应该用 `onMounted`[^1]。
- 「nextTick 里抛错会让整批更新崩掉」——不会：队列里的 job 都被 `callWithErrorHandling` 包着，`finally` 还会把 QUEUED 标记清干净；只有你写在 `nextTick(cb)` 里的 cb 抛错会 reject 你自己的 promise[^2]。
- 「多次连续修改要 nextTick 多次才生效」——一次都不需要手动 nextTick，除非你要读 DOM；需要「变化后的值」就用 computed/watch[^1][^3]。
- 「nextTick 能保证在下一个 watcher 之前执行」——不保证：post-flush 与递归 flush 都会改变相对顺序，别把 nextTick 当同步点用[^2]。
- 「生产环境也有 100 次递归上限」——没有，`RECURSION_LIMIT` 检查只在 `__DEV__` 分支里[^2]。

## 面试怎么问
追问链：为什么改状态不立刻更新 DOM → 队列怎么去重（位标记）→ 为什么能保证父先于子（uid + 二分插入）→ pre/post/sync 三种 watcher 分别排在哪儿 → `await nextTick()` 之后 DOM 和绘制各处于什么状态 → 一个 job 抛错会发生什么 → 无限递归更新怎么被发现。
加分线：顺手说 3.5 的 `flushPreFlushCbs` 用 `minUid` 限定挂载范围、以及 Suspense 的两个 post 标记，说明你真读过源码而不是背结论。

## 前置知识
- [[fe.vue.reactivity.effect-dep]] — trigger 之后 job 是怎么被排进队列的
- [[fe.vue.runtime.update-flow]] — 组件更新 job（render effect）长什么样
- [[fe.vue.scheduler.watcher-flush]] — sync/pre/post 三种 flush 时机与 watcher 队列位置
- [[fe.vue.lifecycle.mount-unmount]] — 为什么 setup 里 nextTick 拿不到 DOM

## 相关
- [[fe.vue.scheduler.flush-jobs]] — 任务队列与批量更新：高频更新为什么仍然只渲染一次
- [[fe.vue.perf.granularity-tools]] — shallowRef / triggerRef 等粒度工具，自动批处理之外的兜底手段
- 微任务与渲染帧的边界（事件循环基础）——理解 `await nextTick()` 之后为什么仍可能看不到绘制结果
