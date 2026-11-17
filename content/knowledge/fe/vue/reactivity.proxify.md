---
node: fe.vue.reactivity.proxify
title: Proxy 拦截与懒代理（对比 defineProperty）
sources:
  - url: https://vuejs.org/guide/essentials/reactivity-fundamentals.html
    title: Vue 官方文档 · Reactivity Fundamentals
    kind: official
  - url: https://vuejs.org/guide/extras/reactivity-in-depth.html
    title: Vue 官方文档 · Reactivity in Depth
    kind: official
  - url: https://github.com/vuejs/core/blob/v3.5.45/packages/reactivity/src/baseHandlers.ts
    title: vuejs/core v3.5.45 packages/reactivity/src/baseHandlers.ts
    kind: source
  - url: https://github.com/vuejs/core/blob/v3.5.45/packages/reactivity/src/reactive.ts
    title: vuejs/core v3.5.45 packages/reactivity/src/reactive.ts
    kind: source
  - url: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy
    title: MDN · Proxy
    kind: doc
  - url: https://v2.vuejs.org/v2/guide/reactivity.html
    title: Vue 2 官方文档 · Reactivity in Detail
    kind: official
updated: 2026-11-10T06:20:00Z
generator: hand-written@1
reviewed: true
confidence: high
---

## 一句话本质
reactive() 返回的是原对象的 Proxy：读写字段被 get/set 陷阱拦下来做依赖收集与派发；嵌套对象不在初始化时递归转换，而是**访问到那一层才转**（懒代理），因此既能感知新增/删除属性，初始开销又只跟「真正被碰到的数据」成正比。

## 为什么需要它
响应式的起点是「知道某个东西被读、被写」。局部变量在 JS 里无从拦截，能拦截的只有对象属性访问[^1]。Vue 2 时代用 getter / setter：初始化时把对象上**已存在**的每个 key 改成带 track/trigger 的访问器[^6]。这条路有两个结构性缺口——新增属性不会被发现，删除属性同样无法感知；数组还得为索引和 length 单独打补丁[^6]。

Proxy 是对**整个对象**的拦截层：get / set / deleteProperty / has / ownKeys 五个陷阱正好覆盖「读、写、删、探测存在、枚举」五种操作，新增和删除天然就在拦截范围内[^2][^5]。这也是 Vue 3 只在 `ref` / `computed` 上保留 getter/setter（它们本来就是自己构造的对象），而 `reactive` 一律走 Proxy 的原因[^1]。

defineProperty 与 Proxy 的取舍不是「谁更快」，而是**能力边界**：前者劫持值，后者劫持操作。代价是 Proxy 有自己的语义约束（见「常见误区」），并且无法对原始对象本身生效[^5]。

## 机制讲清楚
一个对象能不能变成 reactive，由 `createReactiveObject()` 依次判定[^3]：

```ts
// vuejs/core v3.5.45 packages/reactivity/src/reactive.ts（节选）
function createReactiveObject(target, isReadonly, baseHandlers, collectionHandlers, proxyMap) {
  if (!isObject(target)) return target                        // 原始类型直接返回
  if (target[ReactiveFlags.RAW] && !(isReadonly && target[ReactiveFlags.IS_REACTIVE])) return target
  if (target[ReactiveFlags.SKIP] || !Object.isExtensible(target)) return target  // markRaw / 冻结
  const existingProxy = proxyMap.get(target)
  if (existingProxy) return existingProxy                      // WeakMap 缓存：引用稳定
  const targetType = targetTypeMap(toRawType(target))          // Object/Array | Map/Set/WeakMap/WeakSet | 其它
  if (targetType === TargetType.INVALID) return target
  const proxy = new Proxy(target, targetType === TargetType.COLLECTION ? collectionHandlers : baseHandlers)
  proxyMap.set(target, proxy)
  return proxy
}
```

**懒代理的证据在 get 陷阱末尾**：`BaseReactiveHandler.get` 取到属性值以后，最后一句是 `if (isObject(res)) return isReadonly ? readonly(res) : reactive(res)`[^4]。也就是说深层对象是「读到才包」，源码注释同时点明这样绕开了自引用造成的循环递归。官方文档用的是同一句话：nested objects are also wrapped with `reactive()` **when accessed**[^1]。由此可以推出三条面试爱问的行为差异：初始 `reactive(deepBigTree)` 只创建一个 Proxy；从未访问过的分支永远不会建立依赖；`proxy.nested === rawNested` 恒为 false（新塞进去的裸对象，读出来已经是代理）[^1]。

get 陷阱的完整顺序值得背下来（v3.5.45）[^4]：

1. `key === ReactiveFlags.SKIP` 直接返回，不 track；
2. `__v_isReactive` / `__v_isReadonly` / `__v_shallow` / `__v_raw` 四个标记键短路返回，其中 `__v_raw` 会校验 receiver 是否是本类 proxy map 里的那个代理，防止「拿错壳」；
3. 目标若是数组且 key 命中 `arrayInstrumentations`，直接返回插装方法；`hasOwnProperty` 也换成自定义实现（内部先 `toRaw` 再 track，否则 HAS 记到代理身上）；
4. `Reflect.get(target, key, isRef(target) ? target : receiver)` —— 包 ref 时把 receiver 换回裸 ref，省得每个方法内部都 toRaw；
5. `__proto__` / `__v_isRef` / `__isVue` 这些键，以及 `Symbol.toStringTag` 一类内置 symbol，不参与收集；
6. 非 readonly 才 `track(target, GET, key)`；
7. `isShallow` 为真 → 原样返回（这就是 shallowReactive 只有一层响应的原因）；
8. 值是 ref → 解包 `.value`，**但数组 + 整数 key 不解包**（所以 `reactive([ref(1)])[0].value` 仍然要写 .value）[^1]；
9. 值是对象 → 递归包装（懒代理）。

set 陷阱的关键在两处：写入前先 `toRaw` 新旧值，并且「旧值是 ref、新值不是 ref」时写 `oldValue.value`，而不是把 ref 换成裸值——否则响应链就断了；写入后只有 `target === toRaw(receiver)` 才 trigger，因此在原型上赋值不会污染实例的派发[^4]。新增（`hadKey` 为假，数组整数键用 `Number(key) < length` 判断）发 ADD，其余用 `hasChanged` 决定是否发 SET。`deleteProperty` 发 DELETE，`has` 发 HAS，`ownKeys` 发 ITERATE（数组记 `length`，对象记 ITERATE_KEY），这四类操作共同支撑了 `v-for` 换 key、`Object.keys`、`in` 的响应式[^4]。

3.5 对数组做了单独一层插装：`map/filter/forEach/reduce/迭代器` 等方法改在**裸数组**上执行、统一 track 一个 `ARRAY_ITERATE_KEY`，`push/pop/splice/unshift/shift` 则先 `pauseTracking()` + `startBatch()` 再执行（避免 length 被反复触发导致的死循环与重复派发），`includes/indexOf/lastIndexOf` 先用原参数跑一次、没命中再用 `toRaw` 后的参数重试（解决「拿代理去比较裸元素」的恒等性坑）[^3]。

## 关键结论
- 判定能否代理的优先级是：非对象 → 已是别的代理 → `markRaw`（SKIP 标记）或不可扩展（`Object.freeze`）→ WeakMap 复用 → 类型白名单[^3]。**冻结对象在 3.4 与 3.5 里都不会被代理**（直接返回原对象）：3.4 把它藏在 `getTargetType()` 返回 INVALID 里，3.5 挪成 `createReactiveObject` 开头一条显式提前返回——只是重构位置，行为一致[^3]。
- 同一个 target 在任何位置取到的都是同一个 proxy（WeakMap 缓存），这是 diff 能靠引用相等跳过整棵子树的前提[^3]。
- 深响应不等于深转换：懒代理把成本摊到访问路径上；要主动降成本用 `shallowRef` / `shallowReactive`，别指望「少几个字段」[^1]。
- 只有代理是响应式的，裸对象的读写既不收集也不派发；`reactive()` 返回值 `!==` 原对象，必须只用代理这一份引用[^1]。
- 新增/删除属性能感知，靠的是 set/deleteProperty/has/ownKeys 四个陷阱，而不是「Proxy 更聪明」[^4]。
- 与「靠引用变化触发渲染」的不可变模型对比：Vue 的依赖收集发生在**属性读取**上，所以 `state.x.y = 1` 只会唤醒读过 `x.y` 的 effect，不需要为了触发更新去新建整条对象链[^2]。

## 常见误区
- 「Proxy 能拦住原始对象的快照」——错。`toRaw(proxy)` 之后读写都不会 track/trigger，`toRaw` 只是排障逃生口，别长期持有裸引用[^1]。
- 「reactive 会把原对象改掉」——错。原对象保持干净，代理是外面的一层壳；把裸对象存进别处（比如模块级 Map）就脱离响应式了[^1]。
- 「懒代理等于浅响应」——错。懒代理是「晚一点深转换」，`shallowReactive` 是「永远不深转换」，两者机制不同（get 陷阱第 7 步 vs 第 9 步）[^4]。
- 「整体替换 state 也一样响应」——错。`let state = reactive({...}); state = reactive({...})` 会丢掉收集连接，因为追踪发生在属性访问上而不是变量上[^1]。
- 「解构出来的字段还能响应」——错。解构基本类型等于拿走了值，不再经过陷阱；要保响应就用 `toRef` / `toRefs`[^1]。
- 「Symbol 都会被收集」——错。内置 symbol 与非可跟踪键被显式跳过[^4]。

## 面试怎么问
追问链：为什么用 Proxy 而不是 defineProperty → 五个陷阱分别覆盖什么操作 → 懒代理在源码哪一行、为什么不当场递归 → 冻结对象和 markRaw 怎么处理 → 数组为什么要单独插装（3.5 改了什么）→ ref 为什么还要用 getter/setter → Proxy 的局限是什么。
加分线：把「引用稳定 → diff 跳过」「深响应 ≠ 深转换」这两条讲成因果；再顺手对比 [[fe.vue.ecosystem.vue-vs-react]] 的更新传播模型。

## 前置知识
- [[fe.vue.reactivity]] — 响应式总体（proxify 是其中「对象怎么被代理」这一环）
- [[fe.vue.reactivity.ref-family]] — ref 为什么用 getter/setter、解包规则边界
- [[fe.vue.reactivity.effect-dep]] — track/trigger 之后依赖到底存在哪
- [[fe.vue.perf.granularity-tools]] — shallowRef / shallowReactive 的成本账

## 相关
- [[fe.vue.runtime.update-flow]] — render effect 如何消费这套读追踪
- [[fe.vue.compiler.block-tree]] — 编译期 PatchFlag 与运行期靶向更新的配合
- [[fe.vue.scheduler.nexttick]] — trigger 之后何时真正更新 DOM
