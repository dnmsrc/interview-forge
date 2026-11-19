# 项目闯关内容生产规范（v1）

> 这份文档写给「内容作者」（人或其他 agent）。目标是：照着它写出来的
> `content/projects-src/<slug>.mjs` 一次就能过 `project-build`，并且内容是**真的能教人**的，
> 不是「为了盖住知识点凑出来的空壳」。
>
> 先读两个现成范例（不要跳过，格式细节都在里面）：
> - `content/projects-src/lru-cache.mjs` —— 3 关工具箱式项目，结构最干净
> - `content/projects-src/redis-cache.mjs` —— 4 关模拟器式项目，适合后端/系统类
>
> 判题与校验的完整规则在 `src/shared/project-core.mjs`，构建脚本是 `scripts/project-build.mjs`。

---

## 0. 你要交付什么

一个文件：`content/projects-src/<slug>.mjs`，`export default` 一个项目对象。

- **不要**手写 `content/projects/*.json`——那是构建产物，由 `node scripts/project-build.mjs` 生成。
- **不要**修改其他任何文件（不改图谱、不改脚本、不动别人的项目）。
- 内容语言：中文讲解 + 英文/中文混排代码。讲解要像资深工程师带人写代码，不要像教科书念定义。

---

## 1. 项目对象

```js
export default {
  id: '<slug>',            // 与文件名一致，小写 kebab-case
  version: 3,              // 必须是 3：代表关卡使用 stages 分步制
  domain: '<domain>',      // 'fe' | 'be' | 'cs' | 'ai' | 'eng'，照分配清单
  cumulative: false,       // 工具箱式/模拟器式项目一律 false（关间不要求参考解互相兼容）
  title: '中文标题（10 字以内最好）',
  emoji: '🧩',
  tagline: '一句话说清这个项目做什么、分几关',
  stack: ['JavaScript', 'Redis'],   // 2~4 个技术关键词（数组）
  intro: '150~300 字：为什么值得做这个项目、它对应面试/工作里的什么问题、你会被逼着讲清楚哪些边界。',
  outcome: '80~200 字：做完之后你具体获得了什么能力（能白板写出什么、能解释什么、能判断什么）。',
  levels: [LV1, LV2, ...]
}
```

## 2. 关卡对象（每关都要完整）

```js
const LV1 = {
  id: 'lv1',
  title: '中文关卡名',
  emoji: '🗺️',
  xp: 40,                  // 30~60，越靠后越高
  goal: '1~3 句：这一关要交付什么能力（要具体到函数/行为）',
  why: '为什么需要这个能力、没有它会发生什么（≥60 字，不许写套话）',
  nodes: ['a.b.c', 'a.b.c.d'],   // ★ 覆盖映射：必须与分配清单完全一致，见 §4
  thinking: [                    // 1~3 条：这一关的关键判断/思维过程
    { title: '小标题', md: 'markdown 讲解，可以带代码块，150~400 字' }
  ],
  prereq: [                      // ≥1 条：动手前必须懂的前置知识
    { title: '小标题', md: '≥60 字：是什么 / 为什么 / 怎么用，最好带代码块' }
  ],
  api: [                         // ≥1 条：你要交付的函数契约（校验会查 5 个字段）
    {
      name: 'LRUCache',
      sig: 'new LRUCache(capacity) / get(key): any',
      args: '参数含义与取值范围',
      returns: '返回值 / 副作用',
      example: '可直接运行的调用示例（多行字符串）'
    }
  ],
  usage: '整关做完后，这段代码怎么用（一段可读的示例代码）',
  hints: ['卡住时的提示，1~3 条，不说完整答案'],
  concepts: [                    // 0~2 条：补一个「为什么这样设计」的背景，可选
    { title: '小标题', md: '100~300 字' }
  ],
  stages: [ /* 见 §3 */ ],
  skeleton: `/* 骨架代码：函数签名 + 抛错或空实现；语法必须合法，但跑 tests 必须红 */`,
  solution: `/* 整关参考解：跑 tests 必须全绿 */`,
  finalCode: `/* 通关后对照的完整实现，一般与 solution 相同 */`,
  tests: `${S1}\n${S2}\n${S3}`   // 整关测试 = 各 stage.test 拼接，见 §3
}
```

> 少任何一个必填字段构建都会失败。`thinking` 不强制但强烈建议写；`concepts` 可选。

## 3. stages 分步制（核心）

每一关拆成 **3~4 步**，每步一个独立的 `code`（这一步完成后的完整代码）+ 一个 `test`（只测这一步新增的能力）。

```js
const S1 = `{
  check('这一步要证明的行为 1', () => {
    same(fn(1), 2)
  })
  // …至少 4 个 check
}`

const S2 = `{ /* 只测第 2 步新增的能力，至少 4 个 check */ }`

stages: [
  {
    n: 1,
    title: '这一步做什么（≤20 字）',
    think: '为什么现在做这一步、不做会怎样（≥30 字）',
    hint: '怎么做，但不给完整代码（≥10 字）',
    code: `/* 第 1 步完成后的完整代码（可运行，不是片段） */`,
    test: S1,
    diag: ['第 1 个 check 失败时最可能的原因', '第 2 个 check 失败时…', '…', '…'],
    vocab: [{ term: '术语', desc: '解释' }]   // 可选
  },
  { n: 2, ... }
]
```

硬规则（构建器逐条机检，违反即失败）：

1. **每步的 `code` 必须过本步的 `test`**（全绿）。
2. **每步的 `code` 必须过不了下一步的 `test`**（否则说明两步是一件事，合并或拆开）。
3. `diag` 数组长度必须等于本步 `test` 里 `check(` 的个数，顺序一一对应，每条 ≥12 字。
4. `tests` 里的 `check` 总数必须 ≥ 各 `stages[].test` 的 `check` 数之和（一般就是按顺序拼接）。
5. `solution` / `finalCode` 跑 `tests` 必须全绿。
6. `skeleton` 必须**语法合法**（不能是语法错误），但跑 `tests` **必须红**。

典型的写法：`finalCode` 写一份完整实现；`stages[k].code` 是它的渐进版本（第 k 步只完成第 k 部分，允许后面步骤要用的函数暂时不存在/空实现，只要本步测试不碰它）；`tests` 用模板字符串把各步 test 拼起来。

### 判题沙箱能做什么、不能做什么

- 代码跑在 `node:vm` 的独立 context 里，只有 `console` 和断言函数 `check / same / ok / throws`，**没有** `require` / `process` / `fs` / `Buffer` / `setTimeout` / `setInterval` / `fetch` / `XMLHttpRequest`。
- 可用 `Promise`、`async/await`（`check` 的回调可以是 async，测试脚本整体在 async IIFE 里）。
- 单步超时 4000ms，别写大循环（< 10^6 次迭代量级）。
- `same(actual, expected, msg?)` 用跨 realm 安全比较（对象按 JSON 形态比），`ok(cond, msg?)`、`throws(fn, msg?)`。
- 这不是缺点，是纪律：**每个知识点都要落成「纯函数 + 可注入的 now / random / 时钟」**，讲不清边界就写不出测试。后端/系统类知识点就用「可运行的模拟器」承接（见 redis-cache 的写法）。

### 测试质量

- 每步至少 **4 个 check**，每关 ≥12 个 check。要测边界：空输入、容量 0/1、重复操作、顺序变化、错误路径。
- check 的 name 用**中文陈述句**，说清「这一条在证明什么」。
- 不要用 `ok(true)` 这种假测试；不要只测 happy path。
- 测试之间可以共享同一段 `code` 里的类/函数，但每个 check 自己构造实例，避免相互污染。

## 4. 覆盖映射 nodes（最重要）

- 每关的 `nodes` 必须**精确等于分配清单**里的那一行：不多、不少、不重复、顺序照抄。
- `nodes[0]` 是主知识点，决定这关在 UI 里归到哪一章（章节 = 该节点的 topic）。所以同 topic 的关在项目里连续排——分配清单已经帮你排好了。
- 这些 id 都来自 `content/nodes/**` 知识图谱，构建器会校验存在性；写错一个字母构建直接失败。
- 想查节点详情（title/summary/level/topic）：`node scripts/node-lookup.mjs <id 或 id 前缀>`。

**覆盖是承诺，不是贴标签**：这一关的讲解、API 契约、检查点必须真的围绕这些节点设计。如果一关里挂了 4 个节点，就要让 4 个节点各自有对应的讲解与检查点，不能只讲其中一个、其余凑数。

## 5. 自检（必须做到全绿才算交付）

```bash
node scripts/project-build.mjs --only=<slug>
```

退出码 0 且每一关都打印 ✓ 才算完。构建器会依次检查：结构字段 → nodes 映射 → 参考解过本关 + 不破坏前面关卡 → 每步答案过本步/不过下一步 → finalCode 全绿 → 骨架语法合法且必红 → 写出 JSON。

### 常见失败与修法

| 报错 | 原因 | 修法 |
| --- | --- | --- |
| `第 N 步的答案没过这一步的测试` | stage.code 还不完整 | 补齐 code 直到本步 test 全绿 |
| `第 N 步的答案已经能过第 N+1 步的测试` | 两步做的是同一件事 | 拆细：第 N 步只做一半；或合并两步 |
| `stage.test must 用 check()` / `diag 有 x 条，但这步有 y 个检查点` | diag 与 check 数不一致 | 逐条对齐 |
| `骨架有语法错误` | skeleton 不是合法 JS | 修语法（用 `throw new Error('TODO')` 或空返回） |
| `骨架直接就能跑通，这一关等于白送` | skeleton 已经实现了 | 把实现删掉，只留签名 |
| `参考解未通过` | solution ≠ finalCode 或漏实现 | 让 solution = finalCode |
| `tests 少于各 stage 相加` | 漏拼某一步的 test | `tests` 按 `${S1}\n${S2}` 全拼 |

## 6. 质量底线（人工复核会看）

1. **真**：代码真能跑、测试真能证明行为、讲解里的结论真成立。不许编 API、编输出。
2. **深**：一关围绕一个 topic 讲透——为什么这样设计、边界在哪、和相邻方案怎么选。不要三段话敷衍。
3. **不重复**：同一个项目里不同关不要用同一个实现换个名字再讲一遍。
4. **可教**：读者照着 stages 一步步写，每步都能自己跑绿。`think` 要讲「为什么现在做这一步」，不是复述标题。
5. **有取舍**：模拟器实现要说明简化了什么、对应真实系统的哪一部分（例如 redis-cache 明确写了「纯函数 + 可注入 now/random」）。

## 7. 交付报告

写完并构建全绿后，报告：项目 id、关数、每关步数与 check 数、`--only` 构建结果、覆盖了哪些 topic。