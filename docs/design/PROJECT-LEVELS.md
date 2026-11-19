# 项目闯关：关卡内容规范

> 项目模式回答的是另一个问题：**光看题看不进去的时候，直接敲代码能不能把知识点带出来。**
> 每关先讲清「要用的概念」和「要交付的函数长什么样」，再按阶段给一份完整实现和对应的测试；
> 用户跟着分步在编辑器里写、每步点「跑测试」看红绿，全绿才算通关。

## 1. 定位与边界

| 问 | 答 |
| --- | --- |
| 和「练习模式」什么关系 | 并列入口，进度互不影响。练习是「题 → 解析」，项目是「讲透 → 自己写出来」 |
| 判题在哪跑 | 主进程 `vm` 沙箱。用户代码永不进渲染进程，测试源码也不下发 |
| 内容存哪 | 源文件 `content/projects-src/*.mjs`，构建产物 `content/projects/*.json`；不进数据库，改了重建即生效 |
| 进度存哪 | SQLite 表 `project_progress`（`project_id + level_id` 一行，记 done / attempts / draft_code / draft_base） |
| 奖励 | 走同一个 game 服务、同一个 XP 池，不另起成长体系 |

## 2. 内容源：为什么是 `.mjs` 不是 `.json`

一关要写骨架、参考解、测试三段代码。JSON 里换行全靠 `\n` 转义，改一个字符要数一遍反斜杠，写到第 8 关就没人愿意再动内容。所以：

- **人写的是** `content/projects-src/<project-id>.mjs`：`export default { ... }`，代码段用模板字符串，能直接读、直接跑；
- **主进程读的是** `content/projects/<project-id>.json`：`npm run project:build` 序列化生成，别手改。

```bash
npm run project:build   # 校验 + 生成 JSON（构建即质检，不过就退出码非零、不写文件）
npm run project:check   # 对产出的 JSON 再验一遍（CI / 提交前用）
```

## 3. 一个项目的形状

```js
export default {
  id: 'mini-vue-reactivity',   // 唯一，也是路由段 /projects/<id>
  version: 3,                  // 3 起强制要求 prereq / api / thinking / stages / finalCode / usage
  cumulative: true,            // 可选，默认 true；false = 各关独立，跳过跨关回归
  title: '从零写一个响应式内核',
  emoji: '⚡',
  tagline: '一句话说清做完能拿到什么',
  stack: ['JavaScript'],
  intro: '整段说明：这个项目怎么玩、一共几关、通关规则',
  outcome: '做完之后手上有什么、能讲清什么',
  levels: [ /* 见下 */ ]
}
```

`cumulative` 的语义：`true` 表示「第 N 关的参考解是第 1..N 关的超集」（响应式内核这种一关加一块能力的项目）；
`false` 表示每关各写各的（手写工具箱：深拷贝 / 事件总线 / 柯里化三关互不依赖）。选错会让自检误报。

## 4. 一关的形状（v3）

```js
{
  id: 'lv1', title: '让读写经过你的代码', emoji: '🧩', xp: 30,
  goal: '一句话：这一关交付什么能力',
  why: '为什么需要它（2-4 句，讲清不这么做会出什么问题）',

  // ⓪ 覆盖映射：这一关讲透知识图谱里的哪些知识点（构建时校验 id 存在；UI 按它分章节）
  nodes: ['fe.vue.reactivity.proxify', 'fe.vue.reactivity.effect-dep'],

  // ① 前置知识：动手之前必须先看懂的概念，UI 里无条件展开
  prereq: [
    { title: 'Proxy 是「替身」，不是「拷贝」', md: '……至少 60 字，最好带 ```js 代码块……' }
  ],

  // ② API 契约：你要交付的函数长什么样，五个字段都必填
  api: [{
    name: 'reactive',
    sig: 'reactive(target: object): object',
    args: 'target —— 任意普通对象，例如 { count: 1 }',
    returns: '一个代理对象：读 proxy.x 拿到 target.x，写 proxy.x = v 会真的写进 target',
    example: 'const state = reactive({ count: 1 })\\nstate.count = 5   // raw.count 也变成 5'
  }],

  // ③ 思维链：先做什么、排除了什么写法、为什么（整关 ≥3 条，旗舰内容 4~5 条）
  thinking: [
    { title: '先问「我要在哪一刻插手」，再问「用什么工具」', md: '……≥50 字：当时的判断 + 排除了什么 + 为什么……' }
  ],

  // ④ 分阶段：每步一份完整可运行代码 + 只验这一步的测试
  stages: [{
    n: 1,                                  // 从 1 连续递增
    title: '先让它「什么都不改」也能用',
    think: '这一步为什么现在做（≥30 字）',
    hint: '要做成什么样，但不给可粘贴的完整代码（≥10 字）',
    diag: ['这条 check 红了时最可能少写了什么（与 check 一一对应，≥12 字/条）'],
    vocab: [{ term: 'Proxy 的第二个参数', md: '这个 API 怎么用、有什么坑' }],
    code: `……这一步完成后的完整代码（累积式整段，不是片段）……`,
    test: `check('用例名', () => { …… })`
  }],

  finalCode: `……整关做完的完整实现……`,
  usage: `……怎么调用它，含一个真实使用场景……`,

  concepts: [{ title: '通关后复盘', md: '……' }],   // 复盘，不是前置知识
  skeleton: `……骨架：可运行、语法正确，但过不了测试……`,
  solution: `……参考解：完整可运行（= finalCode）……`,
  tests: `check('用例名', () => { …… })`         // 覆盖所有 stage 的检查点
}
```

### 硬性规则（`validateProject` + `dryRunProject` 逐条查，不过就不写文件）

1. **每个 stage 的 `code` 必须能过自己的 `test`**，且**不能过下一步的 `test`**——能过说明这两步其实是一件事，该合并或该拆。这一条把「阶段是不是真的递进」变成了机器可判定的，而不是靠作者感觉。
2. **`tests` 必须覆盖所有 stage 的检查点**：原有断言一条不许删、不许放宽，可补集成检查；check 数 ≥ 各 stage 相加。
3. **`hint` 只说要做什么，写法放进 `vocab`**。提示里出现可直接粘贴的语句，就等于把答案给了；API 用法属于「单词提示」，在单词卡里展开。
4. **骨架必须跑不过测试**（否则这一关白送），**但不能有语法错误**（否则一进来就是一片红，用户连从哪下手都不知道）。
5. **参考解必须让本关测试全绿**；`cumulative: true` 的项目还要通过前面每一关的测试。
6. **`diag` 条数与这一步 `check()` 数量严格一一对应**，写「失败时最可能少写了什么」，只在跑红时回给前端。
7. **测试只暴露现象，不暴露实现**：断言写在「外部可观察的行为」上（effect 跑了几次、get 返回什么），不要写「必须用 Set 存」。
8. **讲解要具体到照着能写**。反例：「实现依赖清理」。正例：「`eff.deps` 是数组，存着这个 effect 被登记进哪些 Set；遍历它，对每个 dep 调 `dep.delete(eff)`，最后把长度清零」。
9. **`nodes` 必填且必须真实**：每个知识点 id 都要存在于 `content/nodes`（构建逐个校验），并且这一关的讲解与检查点确实覆盖它。覆盖口径与补齐路线见 [知识图谱覆盖](PROJECT-COVERAGE.md)。

### v3 是怎么来的（2026-11）

v2 的「骨架塞 TODO」不够。用户做完第 1 关的原话：

> 我一开始读题都读不懂……你最多提供一些步骤的提示。我需要看到完整的代码，包括你在开发这个功能的所有，以及如何调用它。

他要的不是「填两行 Reflect」，是**思维链**：为什么先做这一步、为什么排除另一种写法、用了哪些知识。所以 v2 的 `steps`（TODO 编号一一对应）和 `hints` 被 `thinking` + `stages` + `finalCode` + `usage` 取代。

**v3 是唯一形态（2026-11 全量迁移）**：旧「骨架 + TODO」式关卡已全部重做为 `stages` 分步制。`version: 3` 是承诺——项目里每一关都必须有 `stages`，构建器与 `project:check` 都会拦。UI 不再有老流程分支。

**`domain` 必填**：`fe` 前端 / `be` 后端 / `cs` 公共基础 / `ai` AI Agent / `eng` 工程难题。「项目闯关」列表按它分栏，写错等于分类丢失。

**`regress: false`**：某关的测试若是「本关专属观察孔」（例如第 1 关的 `__setCount` / `__deleteCount`），标上这个字段就从跨关回归里排除——后续关卡没有这些孔，不该算「破坏了前一关」。

内容怎么写得让人看懂（质量线、迁移配方、常见构建失败），见 [项目闯关内容生产手册](../project-authoring.md)。

### 断言 API（沙箱内全局可用）

| API | 用途 |
| --- | --- |
| `check(name, fn)` | 注册一条用例；`fn` 抛错/返回的 promise reject 即该用例失败，其余用例继续跑 |
| `ok(cond, msg?)` | 断言为真 |
| `same(actual, expected, msg?)` | 深比较相等（数字/字符串/布尔/数组/普通对象） |
| `notSame(actual, expected, msg?)` | 深比较不相等 |
| `throws(fn, msg?)` | 期望抛出错误，返回该错误 |
| `console.log/info/warn/error` | 输出收集到结果面板，最多 80 条 |

允许 `await`：测试整体包在 async IIFE 里，**`check` 的回调也可以是 async**（Promise/异步类关卡必须用它，否则 rejection 会逃出沙箱）——失败会落回那条用例的 message，不会带崩主进程。

### 沙箱纪律

- 用户代码只能拿到 `console` + 上述断言函数 + `vm` 上下文自带的语言内置（`JSON`、`Map`、`Set`、`Promise`、`Reflect`、`Date`、`decodeURIComponent` 等）。
  **没有** `require` / `process` / `fs`，也**没有** `URL` / `URLSearchParams` / `setTimeout` / `queueMicrotask`——它们是 Node/浏览器宿主对象，不是语言内置。
  写内容时如果要解析 URL，就用 `indexOf` + `split` + `decodeURIComponent` 手写；要「稍后执行」，用 `Promise.resolve().then(...)` 借一次微任务。
- 单关超时 4 秒（同步段 `timeout`，await 段额外压 1 秒总闸），超时即判失败，不会挂死主进程。
- 跨 realm 的对象原型链不同，`instanceof` 在测试里不可靠；`same()` 内部走 JSON 形态归一化。

## 5. 草稿与内容改版的兼容

`project_progress.draft_base` 存着「这份草稿是在哪一版骨架下写的」的指纹（骨架字符串哈希）。
读关卡时指纹对不上就退回骨架——内容改版后，用户不会打开关卡看到一段上一版的旧代码、跑测试满屏红却不知道为什么。

`project_progress.stage_base` 是分阶段进度的指纹，只认**结构性信息**：步骤号 + 标题 + 该步的检查点名字列表
（`check('……')` 的名字，不含断言正文）。调整某条断言的严宽不算「这一步被重新定义」——
否则修一句 `same(x, 0)` 就会把用户已经过掉的步骤整份作废。加检查点、改检查点名、调整步骤划分才会作废。

写内容时不需要关心这件事，但**不要改已发布关卡骨架后又保留同 id** 而不重建：重建会顺带让旧草稿失效，属于预期行为。

## 5.1 一步一块代码（2026-11 交互改版）

以前全关只有一份草稿：第 3 步的实现接着写第 4 步，第 3 步那份就没了。现在按步存：
渲染层 localStorage 里 `lf.stepSnaps.<project>.<level>` 存 `{ code, start, ran }`，
`start` 是「这一步开始时的代码」，`ran` 是「这一步真的跑过测试」。

- 顶部步骤条可以在做过的步之间切换；**已通过的旧步只读**（改旧步等于改掉后面几步的地基）。
- 新的一步以「刚写好的那份代码」为起点，于是它天然是「还没开始写」。
- 判红字是否摊开只看两件事：这一步跑过测试没有、代码是否动过。
  没跑过 = 红字只是下一步的验收标准，收着；真改了 = 如实摊开。
- 主进程在算「连续失败次数」时收前端传来的 `stepBase`（就是 `start`）：
  代码与它逐字相同 = 人还没动笔，这一次红不计入失败，答案按钮不会在没尝试时就冒出来。

## 6. 内容自检做与不做

自检（`npm run project:build` / `project:check`）挡的是「内容坏了」：字段缺失、TODO 与分步对不上、参考解跑不绿、骨架直接能过、跨关回归破坏。

它**不挡**体验问题：讲解是否真的能让人看懂、难度曲线是否合理、测试会不会太宽松。这些只能靠「自己按关卡走一遍」和用户反馈。

## 7. 追加一关的流程

1. 在 `content/projects-src/<id>.mjs` 的 `levels` 末尾追加关卡对象，`id` 用 `lv<n+1>`；
2. 写 `goal / why / thinking / prereq / api`，再写 `stages`（至少 2 步，每步完整代码 + 该步测试）；
3. 写 `finalCode`、`usage`、`skeleton`、`solution`、`tests` → 跑 `node scripts/project-build.mjs --only=<id>`，确认：每步答案能过本步且不过下一步、finalCode 全绿、骨架红、前面所有关卡的测试也全绿；
4. 起应用走一遍：锁定态、解锁、读前置知识、按分步写完、跑绿、通关横幅、下一关按钮；
5. 新项目就在 `content/projects-src/` 新建一个 `.mjs`，带上 `domain`，不用改任何代码。

## 8. 已知边界

- 只有 JavaScript：执行器是 Node `vm`，跑不了别的语言或多文件工程。
- 判题只看测试，不看代码风格；把参考解原样粘贴也能过——防作弊目前只有「答案通关后才给」。
- 关卡之间是线性解锁（上一关 done 才开下一关），没有分支或跳关。
- 沙箱不注入定时器和 Web/Node 全局，涉及异步的关卡只能用 `Promise` / 微任务，不能用 `setTimeout` 做真实计时。
- `concepts` 在通关后随结果面板展示，不进知识图谱检索。