// knowledge-core.mjs 的最小自测：frontmatter / 分词 / 闸门 / 双链。
// 用法：node scripts/qa/kb-core-check.mjs
import {
  parseKnowledgeMd, tokenizeForSearch, qualityCheck, extractWikilinks, summaryOf, wordCountOf
} from '../../src/shared/knowledge-core.mjs'

const md = `---
node: fe.vue.reactivity.proxify
title: Proxy 拦截与懒代理
sources:
  - url: https://vuejs.org/guide/essentials/reactivity-fundamentals.html
    title: Reactivity Fundamentals
    kind: official
  - url: https://github.com/vuejs/core/blob/v3.5.45/packages/reactivity/src/baseHandlers.ts
    title: baseHandlers.ts 源码
    kind: source
updated: 2026-11-10T04:00:00Z
generator: kb-build@1
reviewed: false
confidence: high
---

## 一句话本质
reactive 用 Proxy 按需拦截读写字段，嵌套对象只在访问时才递归转代理（懒代理）。

## 为什么需要它
defineProperty 无法感知新增/删除属性[^1]。

## 机制讲清楚
\`\`\`ts
const p = reactive({})
\`\`\`
缺语言标注检查在下面单独测。

## 关键结论
- [[fe.vue.reactivity]] — 响应式总体
- [[fe.vue.scheduler.nexttick|nextTick]]

## 常见误区
「Proxy 能拦截原始对象快照」——错。

## 常见问法
- 追问链：为什么懒代理 → defineProperty 差在哪

## 前置知识
- [[cs.lang.js-proxy]]

## 相关
- [[fe.vue.compiler.ast-pipeline]]
`

const parsed = parseKnowledgeMd(md)
console.log('meta.node        =', parsed.meta.node)
console.log('meta.title       =', parsed.meta.title)
console.log('meta.reviewed    =', parsed.meta.reviewed, typeof parsed.meta.reviewed)
console.log('meta.confidence  =', parsed.meta.confidence)
console.log('meta.updated     =', parsed.meta.updated)
console.log('sources          =', JSON.stringify(parsed.meta.sources))
console.log('sectionOrder     =', JSON.stringify(parsed.sectionOrder))
console.log('summary          =', summaryOf(parsed.sections))
console.log('bodyMd 开头      =', JSON.stringify(parsed.bodyMd.slice(0, 24)))
console.log('wikilinks        =', JSON.stringify(extractWikilinks(parsed.bodyMd)))
console.log('wordCount        =', wordCountOf(parsed.bodyMd))

console.log('\n--- 分词 ---')
for (const s of ['Proxy 懒代理', '编译器优化', 'nextTick 时序', '3.5 数组追踪', '「路由」「闭包」']) {
  console.log(`${JSON.stringify(s)} → ${tokenizeForSearch(s)}`)
}

console.log('\n--- 闸门（validNodeIds 只给两个真 id）---')
const ids = new Set(['fe.vue.reactivity', 'fe.vue.compiler.ast-pipeline'])
console.log(JSON.stringify(qualityCheck(parsed, ids), null, 1))
console.log('\n--- 闸门（不校验断链）---')
console.log(JSON.stringify(qualityCheck(parsed).flags))
