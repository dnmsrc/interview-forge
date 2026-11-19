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

章节分组也来自它：一关的章节 = `nodes[0]` 所属的 topic（**第一个是主知识点**），章节名取该 topic 在知识图谱里的中文标题。
所以写内容时让同一章的关卡在项目里连续排：`lv1、lv2` 同属「过期与淘汰」，`lv3` 才切到「缓存三问题」。
否则章节网格里会出现「第 4 关又回到第 1 章」的跳号——UI 会如实列出「关 1、4」，但读起来别扭。
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

现状（2026-11）：9 个项目、33 关映射后覆盖 **25 / 402（6.2%）**。剩下的 377 个知识点要靠新项目承接，
粗略估：每关 3~5 个知识点 → 还需要 **70~100 关 / 25~35 个新项目**。这是几十个内容批次的工作量，
必须一批一批来，每批都要过构建、覆盖率可见上升、在真实应用里点一遍。

建项目的原则：

1. **一个 stack 一个项目**（fe.vue / fe.js / cs.algo …），项目内按 topic 分章，一章 1~3 关；超过 30 个知识点的 stack（fe.vue 48、cs.algo 25）拆成两个项目；
2. 每关 3~5 个知识点，优先吃 mustMaster；
3. `nodes[0]` 当主知识点，让同章的关卡在项目里连续排列（见 §2）；
4. 语言是 JavaScript（沙箱限制），后端/工程类的知识点用「可运行的模拟实现」承接——
   例如 Redis 过期策略写成过期字典 + 惰性/定期删除的模拟器，而不是连真 Redis；
5. 每关仍然遵守 v3 硬规则（分阶段、每步答案过本步不过下一步、骨架必红），不因为「覆盖」而放松质量线。

分批推进，每批完成后跑一遍 `project:build` + `project-coverage`，覆盖率必须可见上升；
每批都要在真实应用里点一遍（关卡网格、章节、筛选、跑一关），不允许「内容进了库但 UI 撑不住」。

## 5. 当前批次（补齐全量流水线）

**进度（2026-11-21 凌晨）**：20 个项目 / 69 关，覆盖 **175 / 402（43.5%）**；AI 域与后端域 100%，公共基础域 47.5%。
本轮新增：be-python（4 关 21 知识点 / 55 check）、cs-algo（3 关 12 / 45）、cs-design（5 关 22 / 75）、cs-os（3 关 14 / 45）。
累计已完成：ai-tools、ai-memory、ai-eval、be-java、be-micro、be-mysql、be-python、cs-algo、cs-design、cs-os。

剩余 227 个知识点、16 个项目：cs 域 4 个（devops/net/seceq/seceq-2）、fe 域 11 个、eng-warstory。
每个项目按「规划 → 写内容 → project-build 全绿 → project-audit → 覆盖率上升 → UI 回归 → 提交」推进。

2026-11 起把剩余缺口切成 **24 个项目 / 83 关**，规划文件在 `data/project-plan.json`
（`npm run project:plan -- --write` 可重算，图谱增删后要重跑）。

| 分组 | 项目 | 关数 | 覆盖 |
| --- | --- | --- | --- |
| ai | ai-eval、ai-memory、ai-tools | 8 | ai 33（100%） |
| be | be-java、be-micro、be-mysql、be-python | 13 | be 75（100%） |
| cs | cs-algo、cs-design、cs-os（已完成） | 11 | cs 57/120（47.5%） |
| fe | fe-vue、fe-vue-2、fe-vue-3、fe-js、fe-browser、fe-network、fe-css、fe-build、fe-perf、fe-eco、fe-uniapp、fe-electron | 33 | fe 151 |
| eng | eng-warstory | 4 | eng 13 |

生产流程（每个项目走一遍）：

1. 读 `docs/design/PROJECT-GEN-SPEC.md`（内容生产规范）与 `data/plans/<slug>.json`（关卡与 nodes 分配）；
2. 写 `content/projects-src/<slug>.mjs`，反复跑 `npm run project:build -- --only=<slug>` 到全绿；
3. `npm run project:audit -- --only=<slug>` 过质量线（步数/检查点/覆盖核对）；
4. 全量 `npm run project:build` + `npm run project:coverage`，覆盖率必须可见上升；
5. 在真实应用里点一遍（卡片墙、章节网格、筛掉没做的、跑一关）。

> 生产是串行的：本机同一时刻只允许 1 个内容子代理运行（并发上限），
> 所以按「一个项目一跑」推进，不要指望多代理同时写同一仓库。