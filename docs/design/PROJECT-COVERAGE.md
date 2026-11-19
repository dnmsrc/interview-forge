# 项目闯关 · 知识图谱覆盖

> 「项目闯关」要回答的不只是「能不能敲出一个能跑的东西」，还要回答
> **「做完这些项目，知识图谱里的知识点是不是都摸过了」**。
> 这份文档定的是覆盖口径、机检方式和补齐路线——不写清楚，覆盖率就会变成一张没人看得懂的报表。

## 1. 覆盖口径

| 概念 | 定义 |
| --- | --- |
| 目标知识点 | 知识图谱里 **level 3（topic 摘要）+ level 4（具体知识点）** 的节点，共 **402 个**；level 1/2 是领域与技术栈的聚合根，不单独计数 |
| 被覆盖 | 至少有一关在 `nodes` 字段里显式声明了这个节点 id |
| 覆盖率 | 被覆盖的目标知识点 / 402 |
| 不做的事 | 不按「提到过一句」算覆盖。声明 `nodes` 是承诺：这一关的讲解、API 契约与检查点确实围绕它设计 |

一个知识点可以被多关覆盖（同一概念在不同项目里以不同角度出现是好事），覆盖率按「至少一次」计。

## 2. 内容契约

每个关卡对象必须带 `nodes`：

```js
{
  id: 'lv3',
  title: 'computed：懒计算与缓存',
  nodes: ['fe.vue.reactivity.computed-watch', 'fe.vue.scheduler.flush-jobs'],
  // …其余 v3 字段
}
```

- `nodes` 非空，1~6 个为宜（超过 6 个通常说明这一关设计得太大，该拆）；
- 同一关内不重复；
- **id 必须存在于 `content/nodes`**——写错一个字母构建直接失败，不会留到覆盖率报表里变成「永远补不上的幽灵节点」。

章节分组也来自它：一关的章节 = `nodes[0]` 所属的 topic，章节名取该 topic 在知识图谱里的中文标题。
没写 `nodes` 的关卡在 UI 上归入「主线」，并且不参与覆盖统计（会在报表里单独列出来）。

## 3. 机检

```bash
npm run project:build          # 结构 + 参考解 + 骨架 + nodes 合法性；末尾打印覆盖率
node scripts/project-coverage.mjs          # 覆盖率报表（按领域 / 技术栈）
node scripts/project-coverage.mjs --gaps   # 按 stack 列出全部未覆盖知识点（* = mustMaster）
node scripts/project-coverage.mjs --check --min=100   # 覆盖率门槛（CI 用）
```

应用内也有一份同口径的总览：项目列表页顶部的「知识图谱覆盖」条，点击展开未收编清单。
主进程与服务脚本共用 `src/shared/project-coverage.mjs`，不允许出现第二套口径。

## 4. 补齐路线

现状（2026-11）：9 个项目、33 关，先做**映射**（给现有关卡补 `nodes`），再按 stack 缺口建新项目。

建项目的原则：

1. **一个 stack 一个项目**（fe.vue / fe.js / cs.algo …），项目内按 topic 分章，一章 2~4 关；
2. 每关 3~6 个知识点，优先吃 mustMaster；
3. 语言是 JavaScript（沙箱限制），后端/工程类的知识点用「可运行的模拟实现」承接——
   例如 Redis 过期策略写成过期字典 + 惰性/定期删除的模拟器，而不是连真 Redis；
4. 一个 stack 的知识点如果超过 30 个（如 fe.vue 49 个），允许拆成多个项目（内核 / 渲染编译 / 生态）。

分批推进，每批完成后跑一遍 `project:build` + `project-coverage --check`，覆盖率必须可见上升；
每批都要在真实应用里点一遍（关卡网格、章节、筛选、跑一关），不允许「内容进了库但 UI 撑不住」。

## 5. 当前批次

| 批次 | 范围 | 目标 |
| --- | --- | --- |
| B0 | 现有 9 项目 33 关补 `nodes` 映射 | 先让覆盖率从 0 变成一个真数 |
| B1 | fe.vue 剩余 / fe.js 剩余 | 前端主力栈先打穿 |
| B2 | cs.*（algo/design/devops/net/os/seceq） | 公共基础 |
| B3 | be.*（java/spring/mysql/redis/mq/micro/node/python） | 后端 |
| B4 | ai.* + fe 周边（browser/css/html/network/perf/build/ts/eco/electron/uniapp） | AI 与前端周边 |
| B5 | eng（warstory） | 工程难题 |