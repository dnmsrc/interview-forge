# 知识库内容生产手册（并行生产唯一规范）

> 本文件是 interview-forge 题库/图谱扩写的**强制规范**。所有并行队友产出的 JSON 必须 100% 符合本文件，且最终通过 `node scripts/validate.mjs <domain>` 零错误。先读本文件再动手。

## 0. 两条铁律

1. **题库即文件**：`content/**.json` 是唯一真源。只允许在分配给自己的写范围内新建/改写文件，禁止动别人的文件、禁止动 `src/` 代码。
2. **事实必须可验证、禁止编造**：API、版本号、机制必须与官方文档/权威资料一致；拿不准的具体版本号不要写死。题干像真人提问的口吻，不出偏题怪题。

## 1. 目录与文件归属

```
content/nodes/<domain>/<stack>.json        # 节点树（L3 章节 + L4 考点），一个 stack 一个文件
content/questions/<domain>/<stack>/<topic>.json   # 题目，按 topic 归文件
```

- domain 取值固定：`fe` 前端 / `be` 后端 / `cs` 公共基础 / `ai` AI Agent / `eng` 工程难题。
- **本项目节点文件不写 level=2 实体**（L2 只存在于 `_skeleton.json` 规划里）。节点文件里从 **level=3（章节）** 起，下面挂 **level=4（具体考点）**。题目只能挂在 level=4 节点上。
- 一个 stack 一个 nodes 文件（如 `content/nodes/cs/os.json`）；题目按 topic 拆多个文件放进 `content/questions/cs/os/`。

## 2. 节点（node）契约

### 2.1 level=3 章节节点（最小字段）
```json
{ "id": "cs.os.process", "title": "进程与线程", "level": 3, "domain": "cs", "stack": "os", "topic": "process",
  "mustMaster": true, "estMinutes": 90,
  "summary": "一句话说清本章覆盖什么、为什么重要" }
```

### 2.2 level=4 考点节点（题目挂载点，字段最全）
```json
{ "id": "cs.os.process.thread-vs-process", "title": "进程与线程的本质区别", "level": 4,
  "domain": "cs", "stack": "os", "topic": "process",
  "prerequisites": ["cs.os.process.scheduling"],
  "related": ["be.java.concurrent.thread-lifecycle"],
  "mustMaster": true, "masteryThreshold": 2, "unlockOverrideAllowed": true, "estMinutes": 25,
  "summary": "以「要能讲清……」开头，写透这个考点要掌握的具体能力，80~200 字" }
```

硬性规则：
- `id` 段数必须等于 `level`：L3 有 3 段（`domain.stack.topic`），L4 有 4 段（`domain.stack.topic.slug`），全小写连字符。
- `id` 全局唯一；`prerequisites`/`related` 指向的节点 id 若由别的队友负责、暂不存在，允许前向引用（校验只警告），但**同文件内引用必须存在**，且尽量引用真实存在的 id。
- L4 必须有 `masteryThreshold: 2`、`unlockOverrideAllowed: true`、`estMinutes`、布尔 `mustMaster`。
- 可选 R19 显式关系 `relations: [{ "to": "节点id", "type": "advance|depend|apply|evolve|parallel|contrast|analogy|verify|relate", "note": "可选" }]`，type 只能是这 9 种。不确定就不用，`prerequisites`/`related` 已足够。
- `estMinutes`：L3 用 45~120，L4 用 20~35。

## 3. 题目（question）契约

顶层是**数组**（也兼容 `{questions:[...]}`，新文件一律用裸数组）。每题字段：

| 字段 | 要求 |
|---|---|
| `id` | 全局唯一，格式 `Q-<domain>-<stack>-<topic>-<序号4位>`，如 `Q-cs-os-process-0001` |
| `nodeId` | **必须指向一个已存在的 level=4 节点**，否则校验报错 |
| `type` | `single` / `multiple` / `judge` / `blank` / `short` / `essay` / `code` |
| `difficulty` | 整数 1~5 |
| `stem` | 题干，≥6 字，真人提问口吻；代码用反引号 |
| `analysis` | **必填**。讲透正确项为什么对、错误项为什么错（客观题逐项分析） |
| `gapCheck` | **必填**，3 条字符串：易漏点 / 常见误区 / 加分项 |
| `knowledgeLinks` | **必填**对象：`{ "prereq": [节点id], "related": [节点id], "followUps": ["追问问题"] }` |
| `openBookAllowed` | 显式布尔；闭卷核心概念用 false，可查文档的应用题 true |
| `source` | **必填**：`{ "kind": "self-authored", "note": "来源说明" }`；kind 只能 web/official/community/playbook/self-authored |
| `tags` | 3~5 个中文标签数组 |

### 3.1 客观题（single / multiple）
- `options` ≥2 项，每项 `{ "key": "A", "text": "..." }`，key 用 A/B/C/D，常规 4 项。
- `answer: { "keys": ["A"] }`；**single 有且仅有 1 个正确 key；multiple 至少 2 个**。
- 正确 key 必须在 options 内。

### 3.2 判断题 judge
- `answer: { "judge": true|false }`（布尔，不是字符串）。stem 以「判断正误：」开头。

### 3.3 填空题 blank
- `answer: { "blanks": ["答案1","答案2"], "synonyms": { "答案1": ["可接受的别写"] } }`，blanks 顺序对应题干空格（用 `______` 标记）。

### 3.4 主观题（short / essay / code）
- **必须**有 `scoringPoints: [{ "point": "得分点", "weight": 2 }]`（非空数组）。
- **必须**有 `answer.ref`（参考答案文本）；code 题再加 `answer.code`（可运行的代码字符串，注意转义换行用 `\n`）。
- short 偏有确定要点的简答，essay 偏开放论述，code 是手写代码。

### 3.5 变体（可选，不强制）
可在题内加 `variants: [{ "angle": "换问法/追问延伸/场景变体", "stem": "...", "analysis": "..." }]`，变体 stem 不能与父题相同。

## 4. 题型配比与题量目标

- 每个 **level=4 考点至少 3 道题**（这是 `coverageGaps` 的达标线）；重点（`mustMaster:true`）考点做到 **5 道**。
- 同一考点**不要全是选择题**：推荐配比 2 客观（single/multiple/judge/blank）+ 1 主观（short/code），5 题时再加 1 判断/填空 + 1 主观。
- 难度有梯度：基础题 difficulty 1~2，进阶 3，拔高/战例 4~5，不要全堆在 2。
- 题干全局不得重复（校验会做归一化查重），同考点多角度出题。

## 5. 一个新 stack 的标准生产流程（以 cs/os 为例）

1. 建 `content/nodes/cs/os.json`：先列 4~7 个 L3 章节，每个章节下挂 3~6 个 L4 考点（共约 15~22 个 L4），写全 summary 与前置/关联关系。
2. 建 `content/questions/cs/os/<topic>.json`：按 topic 分文件，每个 L4 考点配 ≥3 题，nodeId 严格对应上一步的 L4 id。
3. 自检：`node scripts/validate.mjs cs`（参数传 domain），必须 `✅ 校验通过`、错误 0。跨域 dangling 警告可接受，本域节点 id/level/题挂载错误必须清零。
4. 报告：写清新增节点数、题目数、题型分布、文件清单、validate 结果。

## 6. 质量红线（出现即返工）

- 题目挂在非 L4 节点 / nodeId 不存在 / 单选多答案 / 主观题缺 scoringPoints 或 answer.ref / 缺 analysis|gapCheck|knowledgeLinks / source.kind 非法 / JSON 语法错误。
- 内容注水：analysis 只说「A 正确」不解释错项、gapCheck 三条雷同、summary 一句话敷衍。
- 事实错误或臆造 API、版本号。
- 越界写别的队友负责的文件。
