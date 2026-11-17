---
node: fe.vue.compiler.ast-pipeline
title: 三阶段编译流水线与 render 产物
sources:
  - url: https://vuejs.org/guide/extras/rendering-mechanism.html
    title: Vue 官方文档 · Rendering Mechanism
    kind: official
  - url: https://github.com/vuejs/core/blob/v3.5.45/packages/compiler-core/src/compile.ts
    title: vuejs/core v3.5.45 packages/compiler-core/src/compile.ts
    kind: source
  - url: https://github.com/vuejs/core/blob/v3.5.45/packages/compiler-core/src/options.ts
    title: vuejs/core v3.5.45 packages/compiler-core/src/options.ts
    kind: source
  - url: https://template-explorer.vuejs.org/
    title: Vue 官方 Template Explorer
    kind: official
updated: 2026-11-10T06:25:00Z
generator: hand-written@1
reviewed: true
confidence: high
---

## 一句话本质
模板编译是「字符串 → AST → 带优化标记的 AST → render 函数字符串」三段流水：`baseParse` 负责还原结构，`transform` 负责把静态信息榨成 PatchFlag / 提升常量 / block 树，`generate` 只按 AST 上现成的标记吐代码——编译器不懂的部分运行期就得全量 diff。

## 为什么需要它
虚拟 DOM 的通病是「不知道哪里会变」：纯运行时的 reconciliation 必须整树遍历、逐节点比 props，即使某棵子树永远不变也照样重建 vnode[^1]。Vue 同时掌握编译器和运行时，于是可以把**静态分析结论塞进产物**让运行时走捷径，官方把这层关系叫 Compiler-Informed Virtual DOM[^1]。

模板又比 render 函数更适合静态分析：语法确定、结构可枚举，所以「哪里是静态的」「这个元素只有 class 在变」「这几个根节点顺序不会变」这类事实都能在编译期判定[^1]。编译时机有两种：构建期预编译（SFC / Vite 插件），或浏览器里现场编译（runtime compiler，`mode: 'function'` + `new Function`）[^3]。两条路产物形态不同，但都出自同一个 `baseCompile`[^2]。

## 机制讲清楚
`baseCompile` 的骨架就三行调用（v3.5.45）[^2]：

```ts
// vuejs/core v3.5.45 packages/compiler-core/src/compile.ts（节选）
export function baseCompile(source, options = {}) {
  const prefixIdentifiers = !__BROWSER__ && (options.prefixIdentifiers === true || isModuleMode)
  const resolvedOptions = extend({}, options, { prefixIdentifiers })
  // ① parse：字符串 → RootNode（已经是 AST 就直接用，方便 SFC 复用）
  const ast = isString(source) ? baseParse(source, resolvedOptions) : source
  // ② transform：一遍 DFS，节点级 + 指令级两组转换，外加用户自定义转换追加在后面
  const [nodeTransforms, directiveTransforms] = getBaseTransformPreset(prefixIdentifiers)
  transform(ast, extend({}, resolvedOptions, { nodeTransforms, directiveTransforms }))
  // ③ generate：按 AST 上的标记吐代码
  return generate(ast, resolvedOptions)
}
```

`getBaseTransformPreset` 给出的**顺序本身就是语义**[^2]：`transformVBindShorthand → transformOnce → transformIf → transformMemo → transformFor →（必要时 trackVForSlotScopes / transformExpression）→ transformSlotOutlet → transformElement → trackSlotScopes → transformText`。`v-if` / `v-for` 必须排在 `transformElement` 前面，因为块结构的建立、slot 作用域的判定都依赖它们先落位；指令侧固定注册 `on` / `bind` / `model` 三个[^2]。

**parse 阶段**产出 `RootNode`：`type: ROOT`，`children` 里是 Element / Text / Comment / Interpolation 等节点，每个节点带 `loc`（源位置）供报错定位。解析模式由 `parseMode: 'base' | 'html' | 'sfc'` 决定——base 是平台无关的通用语法，html 额外处理 `<script>/<style>/<title>/<textarea>`，sfc 把除 `<template>` 外的根级标签当纯文本交给上层[^3]。插值分隔符默认 `['{{','}}']`，空白策略默认 `'condense'`，注释是否进 AST 取决于 dev/prod（`comments` 在开发期为 true、生产为 false）[^3]。**3.4 重写过 parser**，官方发布说明写的是「重写后的模板解析器快 2 倍」，属于内部重构、无破坏性变更[^4]。

**transform 阶段的三类产出**：

1. **PatchFlag**：动态绑定类型被编码成 vnode 创建调用的最后一个参数，例如 `createElementVNode("div", { class: _normalizeClass({ active: _ctx.active }) }, null, 2 /* CLASS */)`，运行时用位运算 `vnode.patchFlag & 2` 判断要不要动 class；一个元素可以有多个 flag，合并成一个整数[^1]。children 类型同样编码，多根 fragment 会带 `64 /* STABLE_FRAGMENT */`，从而跳过子节点顺序协调[^1]。flag 常量定义在 `packages/shared/src/patchFlags.ts`[^1]。
2. **静态提升与预字符串化**：`hoistStatic` 会把不含动态绑定的子树提成 `_hoisted_x` 常量（选项注释原文：Cache static VNodes and props objects to `_hoisted_x` constants），连续足够多的静态元素还会并成一个「static vnode」，里面直接存 HTML 字符串，挂载时靠 `innerHTML` 一次成型，运行期连 diff 都不做[^1][^3]。`cacheHandlers` 则把内联事件函数缓存进 `_cache[0] || (_cache[0] = e => _ctx.foo(e))`，省掉每次 render 新建闭包，前提是开启 `prefixIdentifiers`（要靠作用域分析才能断定能缓存）[^3]。
3. **Block Tree（Tree Flattening）**：block 是「内部结构稳定」的模板片段，每个 block 记录所有**后代**中带 PatchFlag 的节点，形成扁平数组；重渲染时只遍历这层扁平树，静态部分被整体跳过[^1]。`v-if` / `v-for` 会生成新的子 block，并被登记进父 block 的动态后代列表，因此父 block 结构保持稳定[^1]。产物里表现为 `_openBlock()` + `createElementBlock(...)`[^1]。这套标记还顺带优化 SSR hydration：hydration 只遍历 block 根与其动态后代[^1]。

**generate 阶段**只有两种输出形态（`mode`）[^3]：`module` 输出 ES import 并 `export function render`（构建期预编译走这条，模块是 strict 模式所以强制 `prefixIdentifiers`）；`function` 是默认值，输出一段能在 `new Function(code)()` 里执行的代码，helper 从全局 `Vue` 解构（浏览器里的 runtime compiler 用它）。不开 `prefixIdentifiers` 时表达式会被包进 `with(this){...}`，开了才写成 `_ctx.foo`[^3]。SFC 场景下编译器还会读 `<script setup>` 的 binding 元数据（`BindingTypes.SETUP_REF / SETUP_MAYBE_REF / LITERAL_CONST / PROPS ...`）来决定表达式要不要加 `.value` / `_unref()`，这是 `<script setup>` 模板能直接裸用变量的原因[^3]。

## 关键结论
- 三阶段职责必须分清：parse 只管「还原结构」，**所有优化决策都在 transform**，codegen 只是格式化输出。能把这句讲清就已经超过一半回答。
- 编译可以发生在构建期也可以发生在浏览器里，但产物都是 render 函数；「Vue 3 编译后就没有 diff」是错的——diff 还在，只是被 PatchFlag + block tree 缩小了范围[^1]。
- PatchFlag 是位掩码，可叠加；运行时判定是一次位运算，成本恒定[^1]。
- 静态内容收益有两级：提升成常量（少创建）与并成 static vnode（少 diff，直接 innerHTML）[^1]。
- `v-if` / `v-for` 之所以特殊，是因为它们是**结构变化**的来源，必须切成 block；把它们当成普通属性绑定理解就会误判更新粒度[^1]。
- 转换函数的注册顺序不可随意调换：指令/元素类 transform 依赖 `v-if`、`v-for` 先执行完（源码注释直接写了 order is important）[^2]。
- `prefixIdentifiers` 不只是风格选择：它决定能否缓存事件处理器、能否用 bindingMetadata 精化取值，且 module 模式下强制开启[^3]。

## 常见误区
- 「静态提升 = 运行时缓存」——错。提升发生在编译产物里（`_hoisted_x` 常量在 render 外创建），跟 `v-memo` 的运行期缓存是两回事[^1][^3]。
- 「编译器认识所有写法」——错。表达式交给 Babel 解析，插件列表由 `expressionPlugins` 决定（TS 场景编译器会自己补 typescript 插件）[^2][^3]。
- 「PatchFlag 越多越慢」——错。flag 只是提示，位检查恒定；真正的成本来自动态项数量本身。
- 「fragment 一定需要 key 协调」——错。顺序可静态确定的 fragment 带 `STABLE_FRAGMENT`，运行时直接跳过顺序协调[^1]。
- 「runtime compiler 和 SFC 编译产物一模一样」——不完全一样：浏览器里不支持 `prefixIdentifiers: true` 与 module 模式（`baseCompile` 会直接报错），因此少了作用域分析类优化[^2]。
- 「模板注释都会被丢掉」——不一定：dev 下 `comments` 默认为 true，会进 AST[^3]。

## 面试怎么问
追问链：模板到 DOM 中间经过哪几步 → 编译器凭什么说某段是静态的 → PatchFlag 是什么、怎么参与运行时判定 → block tree 解决什么问题、v-if/v-for 为什么要切块 → 静态提升和预字符串化的区别 → 浏览器内编译和构建期编译差在哪 → `<script setup>` 的 bindingMetadata 起什么作用。
加分线：把「编译器懂模板 → 运行时才敢靶向更新」这条因果讲透，再对比 [[fe.vue.ecosystem.vue-vs-react]] 里 React 纯运行时 reconciliation 的取舍。

## 前置知识
- [[fe.vue.compiler]] — 编译与编译优化总览（本考点是它的主干）
- [[fe.vue.compiler.block-tree]] — PatchFlag 位值与 block 收集的细节
- [[fe.vue.compiler.static-hoist]] — hoistStatic 判定规则与预字符串化边界
- [[fe.vue.runtime.update-flow]] — render 产物被 render effect 消费的过程

## 相关
- [[fe.vue.composition.sfc-macros]] — `<script setup>` 宏与 bindingMetadata 的另一半
- [[fe.vue.compiler.slot-compile]] — slot 编译如何影响 block 与 patch 粒度
- [[fe.vue.runtime.diff-key]] — 有 PatchFlag 之外仍然要做 key 协调的场景
