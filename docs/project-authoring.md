# 项目闯关内容生产手册（v3 分步制）

> 本文件是 `content/projects-src/*.mjs` 的**唯一生产规范**。写内容前先读一遍，写完必须让
> `node scripts/project-build.mjs --only=<文件名片段>` 零错误退出。
> 产物 `content/projects/*.json` 是构建生成物，**永远不要手改**。

## 0. 数据链路

```
content/projects-src/<id>.mjs   ← 人写这份（模板字符串 + export default）
        │  node scripts/project-build.mjs
        ▼
content/projects/<id>.json      ← 构建产物，主进程读它；不要手改
```

构建器做四件事，任何一件不过就退出码非零、不写文件：

1. **结构校验**（`validateProject`）：字段缺失、domain 非法、阶段编号不连续、diag 条数对不上……
2. **参考解自检**（`dryRunProject`）：`solution` 要过本关全部测试；累积式项目还要过前面每一关。
3. **分步答案自检**：每一步的 `code` 必须过**本步**测试，且**不能**过下一步测试（否则照抄会跳步）。
4. **finalCode 自检**：整关完成后的完整实现必须过整关测试。
5. **骨架自检**：必须跑不过（不能白送），但不能是语法错误。

## 1. 项目顶层契约

```js
export default {
  id: 'promise-aplus',        // 文件名同 id
  version: 3,                 // 声明 v3 = 每一关都必须有 stages；写 2 会按老流程校验
  domain: 'fe',               // 必填：fe 前端 / be 后端 / cs 公共基础 / ai AI Agent / eng 工程难题
  title: '手写一个 Promise',
  emoji: '🪄',
  tagline: '3 关 11 步：先把状态机写对，再让 then 能串，最后补齐静态方法。',
  stack: ['JavaScript', 'Promise'],   // 卡片上的技术标签
  intro: '……',                // 2~4 句：这一季做什么、为什么值得做
  outcome: '……',              // 做完之后用户手上有什么、能讲清什么
  // cumulative: false,       // 三关互不累积（工具箱式）时写 false，默认 true
  levels: [ /* 见下 */ ]
}
```

领域归属（决定列表分栏）：

| domain | 列表文案 | 适合的内容 |
| --- | --- | --- |
| `fe` | 前端 | JS 语言机制、浏览器、框架内核、构建 |
| `be` | 后端 | HTTP/服务端、数据库、缓存、分布式、并发 |
| `cs` | 公共基础 | 数据结构、算法、操作系统、网络 |
| `ai` | AI Agent | 推理循环、RAG、工具调用、评测 |
| `eng` | 工程难题 | 偏工程决策/排障的题（本季暂不放代码关） |

## 2. 关卡契约（v3 必填）

```js
{
  id: 'lv1', title: '状态机：一个 Promise 只能落定一次', emoji: '🧩',
  xp: 40,
  goal: '一句话说清这一关交付什么（动词开头，带验收标准）',
  why: '为什么需要这个能力、不这么做会怎样。2~4 句，不要复述 goal。',
  regress: false,             // 可选：本关有专属观察孔、不参与跨关回归时写 false
  thinking: [                 // ≥2 条，每条 md ≥50 字
    { title: '先问「什么时候落定」，再问「怎么存状态」', md: '...' },
  ],
  prereq: [                   // ≥1 条，每条 md ≥60 字，最好带代码块
    { title: 'Promise 的三个状态与单向迁移', md: '...' },
  ],
  api: [                      // ≥1 条，五个字段都不能缺
    { name: 'MyPromise', sig: 'new MyPromise(executor)', args: '...', returns: '...', example: '...' },
  ],
  stages: [                   // ≥2 步；每一步 = 完整代码 + 该步测试
    {
      n: 1,                   // 从 1 连续递增
      title: '先把状态存下来',
      think: '这一步为什么现在做、验收什么（≥30 字，写决策不写步骤清单）',
      hint: '怎么做，但不给完整代码（≥10 字）',
      vocab: [{ term: 'state', md: '...' }],   // 可选：陌生 API 的单词卡
      diag: ['这条检查点没做到时，最可能少写了什么（条数必须等于本步 check 数，每条 ≥12 字）'],
      code: `...`,            // 这一步完成后的「完整可运行文件」，不是片段
      test: `...`             // 这一步的测试，全部通过才算这一步绿
    },
  ],
  finalCode: `...`,           // 整关做完的完整实现，必须过整关 tests
  usage: `...`,               // 这段代码怎么被调用（真实调用示例 + 输出）
  skeleton: `...`,            // 用户拿到的起点：可运行但过不了测试，含 function/const/class 声明
  solution: `...`,            // 参考答案（通关后才下发），必须过 tests
  tests: `...`,               // 整关测试；check 数必须 ≥ 各 stage 相加
  hints: ['...'],             // 可选（staged 关卡不再强制）
  concepts: [{ title: '...', md: '...' }]   // 可选：通关后的知识点收束
}
```

### 2.1 stages 的硬规则（构建器会逐条查）

1. **每步的 code 是完整文件**：从 `function`/`class`/`const` 开始，能独立跑。
   ✅ `function reactive(t){...}`；❌ 只写一段 `this.map = new Map()`。
2. **每步绿了才算推进**：本步 test 全绿 → 下一步开放。
3. **不能一步干两件事**：本步 code 如果已经能过下一步 test，构建器报错，要求拆/并。
4. **步与步之间必须是「加零件」**：第 k 步的 code 是第 k+1 步 code 的基础，不要推倒重写。
5. **diag 与 check 一一对应**：先写 test 里的 check 顺序，再按顺序写 diag。
6. `vocab` 只放这一步会用到、且用户可能没见过的 API；不要放常识。

### 2.2 测试 API 与沙箱边界

测试代码整体包在 async IIFE 里跑，因此**支持 await**；`check` 也支持 async 回调——
命名时直接写 `check('...', async () => { ... })`，断言失败会落回这条用例。

```js
check('名字', () => { ... })        // 同步
check('名字', async () => { ... })  // 异步（Promise 类关卡用）
ok(cond, '失败说明')                 // 断言为真
same(actual, expected, '失败说明')   // 深比较
notSame(actual, expected, '失败说明')
throws(fn, '失败说明')               // 期望抛错
console.log(...)                     // 结果面板里能看到
```

沙箱里**没有** `setTimeout` / `queueMicrotask` / `require` / `process` / `fs` / `fetch` /
`setInterval`。有 `Promise`、`Map`、`Set`、`WeakMap`、`Reflect`、`JSON`、`Math`、`Object` 等标准内置。

- 需要「稍后再执行」时，用 `Promise.resolve().then(...)` 借一次微任务（Promise 关卡的调度就这么写）。
- 需要定时/随机时，把它做成参数注入（测试传固定值），不要依赖宿主环境。

单步测试 4 秒超时；不要写死循环或永远不 resolve 的 await。

### 2.3 tests 与 stages 的关系

`tests` 是整关一次跑的合集（构建器要求 check 数 ≥ 各 stage 相加，防止漏跑）。
推荐写法：**把各步 test 原样拼起来，再补几条跨步集成检查**。
各步 test 里建议用 `{ ... }` 包一层，避免同名 const 冲突（参考 mini-vue）。

## 3. 质量线（不是格式，是内容该长什么样）

这一节是「写得好」与「能过校验」的区别。过校验只要半小时，写好要按下面写。

1. **thinking 写决策，不写步骤**。
   反例：「第一步创建对象，第二步写 get」。
   正例：「先验证空 handler 的默认行为是否透明——这样后面出错时排错范围只剩新加的 3 行」。
   每条至少交代：我当时的判断 / 为什么排除另一种做法 / 踩过什么坑。
2. **prereq 要能「照着抄都行」**：概念 + 最小可运行例子 + 常见误解。
3. **api 是契约不是目录**：签名、参数含义、返回值、真实调用示例、边界（空值/非法输入）。
4. **hint 只拆解不代抄**：告诉用户「用哪个 API、改哪一处」，不给整段答案。
5. **diag 要具体到「少写了什么」**：反例「检查你的实现」；正例「get 里忘了 return，值被吞了」。
6. **goal / why 分工**：goal = 交付什么；why = 没有它会怎样。不要两段都在介绍背景。
7. **不编造**：API 名、行为、边界以官方规范/权威资料为准；拿不准就不写版本号。
8. **中文、口语、像人说话**；术语第一次出现时给一句解释（或进 vocab）。
9. **一关只解决一个问题**。一关里出现两个不相干概念，拆成两关。

## 4. 从老内容（v2 的 TODO 式）迁移的配方

老关卡是「骨架塞 TODO + 整关一次跑」。迁移不是机械替换，按下面顺序做：

1. 列出这一关的**交付能力**，把它拆成 2~4 个「每步都能跑」的阶段。
2. 每一步的 `code` = 把第 1..k 步做完后的**完整文件**。
3. 把原来的 `tests` 按「需要第几步才能过」分组：只依赖第 1 步的进 stage1.test；依赖前两步的进
   stage2.test……最后剩余的跨步/边界检查留在整关 `tests`。
4. 每步写 `think`（为什么这一步现在做）、`hint`（怎么做）、`diag`（按 check 顺序）。
5. 关卡级补 `thinking`（≥2 条决策链）、`finalCode`（= 完整解）、`usage`（真实调用）。
6. 删掉 `steps`（v3 不再用 TODO 对齐），保留 `hints`/`concepts`（可选）。
7. 运行构建器，按报错修，直到零错误。

## 5. 命令

```bash
# 只构建/校验一个项目（文件名片段匹配）
node scripts/project-build.mjs --only=promise

# 只校验不写文件
node scripts/project-build.mjs --only=promise --dry

# 全量内容自检（构建产物层；发布前跑）
npm run project:check
```

看到 `✗ 共有 N 处问题，未写文件。` 就按报错逐条修；只有 `✓ 已写出 content/projects/xxx.json`
才算完成。

## 6. 常见失败与修法

| 报错 | 原因 | 怎么改 |
| --- | --- | --- |
| `第 k 步的答案已经能过第 k+1 步的测试` | 两步其实是一件事，或 test 写太松 | 合并两步，或让下一步 test 检出新行为 |
| `第 k 步的答案没过这一步的测试` | code 与 test 不匹配（少零件/顺序反了） | 先让 code 过本步 test，再写下一步 |
| `finalCode 未通过整关测试` | finalCode 漏了某步实现 | 用 solution 对照补齐 |
| `tests（N 个检查点）少于各 stage 相加（M 个）` | 整关 tests 没拼全 | 把各步 test 拼进 tests |
| `diag 有 N 条，但这步有 M 个检查点` | diag 与 check 顺序/条数没对齐 | 按 check 顺序补/删 |
| `骨架直接就能跑通` | 骨架写了完整实现 | 留最关键的 1~2 处空白 |
| `骨架有语法错误` | 占位符没闭合 | 保证骨架是合法 JS |
| `缺少 domain` | 顶层没写领域 | 补 `domain: 'fe'` 等 |

## 7. 范例

`content/projects-src/mini-vue-reactivity.mjs` 第 1 关是标杆：4 步、每步完整代码 + 测试 +
think/hint/vocab/diag，关卡级 thinking 写了 5 条决策链。新内容照着它的密度写。