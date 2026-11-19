# interview-forge 数据契约 v1

> 所有模块（UI、AI 层、题库生产、图谱、SRS）都以此文件为准。改字段必须先改这里。

## 0. 目录结构

```
interview-forge/
├─ content/
│  ├─ nodes/<domain>/<stack>.json         # 图谱节点（含前置依赖边）
│  ├─ questions/<domain>/<stack>/<topic>.json   # 题库（一个知识点一个文件，内含多题）
│  ├─ variants/<domain>/<stack>/<topic>.json    # 预生成变体池
│  ├─ papers/presets.json                 # 预置模拟卷模板
│  ├─ projects/<project-id>.json          # 项目闯关课程内容（v3 分步制：每关 stages，每步完整代码 + 测试）
│  └─ snapshots/<timestamp>/              # 每次题库更新的版本快照（可回滚）
├─ data/app.db                            # SQLite（node:sqlite）
├─ scripts/{seed.mjs,import-playbook.mjs,update-bank.mjs}
└─ src/{main,preload,renderer}
```

`domain ∈ { fe 前端, be 后端, cs 公共基础, ai AI Agent, eng 工程难题 }`

项目闯关的关卡字段契约不在本文件展开，见 `docs/design/PROJECT-LEVELS.md`（结构）与
`docs/project-authoring.md`（生产规范：v3 stages、每步自检、domain 分栏）。

## 1. 知识节点（四级 DAG）

```jsonc
{
  "id": "fe.vue.reactivity.proxify",   // domain.stack.topic.detail，点分 slug，全局唯一且不可变
  "title": "reactive 的 Proxy 拦截与懒代理",
  "level": 4,                          // 1=领域 2=技术栈 3=知识点 4=具体考点
  "domain": "fe", "stack": "vue", "topic": "reactivity",
  "prerequisites": ["fe.js.proxy.reflect"],   // 前置节点 id；未点亮则本节点锁定
  "related": ["fe.vue.reactivity.effect"],    // 横向关联（图谱虚线）
  "mustMaster": true,                  // 强制掌握的基础节点
  "masteryThreshold": 2,               // 内部四档 ≥ 该值才点亮
  "unlockOverrideAllowed": true,
  "estMinutes": 25,
  "summary": "要能讲清 Proxy 对 5 种 target 类型的处理，以及为什么 reactive 是懒代理"
}
```

## 2. 题目

```jsonc
{
  "id": "Q-fe-vue-react-0001",
  "nodeId": "fe.vue.reactivity.proxify",   // 必填，必须挂到 level=4 节点
  "type": "single",                        // single|multiple|judge|blank|short|essay|code
  "difficulty": 2,                         // 1-5
  "stem": "关于 `reactive(obj)`，下列说法**正确**的是：",
  "options": [{ "key": "A", "text": "…" }],          // single/multiple 必填
  "answer": {
    "keys": ["A"],                          // single/multiple
    "judge": true,                          // judge
    "blanks": ["getOwnPropertyValue"],      // blank，按顺序；支持 synonyms
    "ref": "参考答案全文",                   // short/essay/code
    "code": "function debounce(){}"         // code 可选参考实现
  },
  "scoringPoints": [                        // 主观题批改依据（AI 逐点判定）
    { "point": "说出 Proxy 五种 trap 中实际用到哪三种", "weight": 2 },
    { "point": "解释懒代理：嵌套对象在访问时才转 reactive", "weight": 2 }
  ],
  "analysis": "答案为什么对 + 每个错项为什么错（markdown）",
  "gapCheck": ["易漏点：toRaw 的场景", "常见误区：把 shallowReactive 当浅拷贝"],  // 查漏补缺
  "knowledgeLinks": {                       // 知识关联
    "prereq": ["fe.js.proxy.reflect"],
    "related": ["fe.vue.reactivity.effect"],
    "followUps": ["常接着问：为什么不用 Object.defineProperty？"]
  },
  "resources": [{ "title": "Vue 官方文档·响应式", "digest": "80-200 字要点摘要" }],  // 练习模式资料面板
  "openBookAllowed": true,                  // 练习时可查 resources；闭卷一律禁用
  "source": {
    "kind": "web | official | community | playbook | self-authored",
    "url": "https://…", "retrievedAt": "2026-11-09",
    "note": "面经出处/文档版本号", "reviewedBy": "agent+人工审核规则"
  },
  "tags": ["高频", "必考", "字节2026"],
  "scoringScaleNote": "主观题按 scoringPoints 折算 0-3 再映射百分制",
  "status": "active",                        // active|retired|dirty
  "meta": { "created": "2026-11-09", "version": 1, "history": [] }
}
```

题型判分规则：`single` 全对得分；`multiple` 漏选半分、错选零分；`judge` 对/错；`blank` 逐空精确匹配 + 同义表兜底 + AI 语义等价复核；`short/essay/code` 交 AI 按 `scoringPoints` 给 0–3；`code` 走 Monaco 提交后 AI 评审（不做本机运行）。

## 3. 变体题

存 `content/variants/**`，结构与题目一致，额外两个字段：

```jsonc
{ "parentId": "Q-fe-vue-react-0001", "angle": "换场景|换问法|加约束|反向问|追问延伸" }
```

硬约束：变体 `stem` 不得与父题相同或仅改标点数字；必须仍指向同一 `nodeId`。

## 4. SQLite DDL（node:sqlite，主进程执行）

```sql
CREATE TABLE nodes (
  id TEXT PRIMARY KEY, parent TEXT, title TEXT NOT NULL, level INTEGER NOT NULL,
  domain TEXT, stack TEXT, topic TEXT, summary TEXT, est_minutes INTEGER,
  must_master INTEGER DEFAULT 0, threshold INTEGER DEFAULT 2, locked_by_default INTEGER DEFAULT 0,
  ord INTEGER DEFAULT 0, status TEXT DEFAULT 'active'
);
CREATE TABLE edges ( from_id TEXT, to_id TEXT, type TEXT, weight REAL DEFAULT 1,
  PRIMARY KEY (from_id, to_id, type) );

CREATE TABLE questions (
  id TEXT PRIMARY KEY, node_id TEXT NOT NULL REFERENCES nodes(id),
  parent_id TEXT, angle TEXT, type TEXT NOT NULL, difficulty INTEGER NOT NULL,
  data TEXT NOT NULL,            -- 完整题目 JSON
  status TEXT DEFAULT 'active', open_book INTEGER DEFAULT 1,
  created_at TEXT, updated_at TEXT
);

CREATE TABLE attempts (          -- 每次作答（练习 & 考试都写这张）
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id TEXT NOT NULL, exam_id TEXT,                -- 练习为 NULL
  answer TEXT, score REAL, scale4 INTEGER,                -- 百分制 / 内部四档
  grading_kind TEXT,             -- auto | ai | self
  ai_model TEXT, tokens INTEGER, ms INTEGER,
  wrong_points TEXT,             -- JSON: 丢分归因
  created_at TEXT
);

CREATE TABLE srs (               -- FSRS 状态（沿用 playbook study-progress 语义）
  question_id TEXT PRIMARY KEY, stability REAL, difficulty REAL,
  reps INTEGER DEFAULT 0, lapses INTEGER DEFAULT 0, state INTEGER DEFAULT 0,
  due TEXT, last_review TEXT, avg_score REAL, weight REAL DEFAULT 1
);

CREATE TABLE node_mastery (
  node_id TEXT PRIMARY KEY, scale4 INTEGER DEFAULT 0, lit INTEGER DEFAULT 0,
  needs_work INTEGER DEFAULT 0, answered INTEGER DEFAULT 0, correct INTEGER DEFAULT 0,
  last_practice TEXT, unlocked INTEGER DEFAULT 0
);

CREATE TABLE exams (
  id TEXT PRIMARY KEY, title TEXT, spec TEXT,             -- 组卷条件 JSON
  started_at TEXT, deadline_at TEXT, submitted_at TEXT,
  paused_ms INTEGER DEFAULT 0, status TEXT,               -- running|submitted|grading|done
  total REAL, pass_line REAL, self_est REAL,
  ai_report TEXT,                                            -- 逐题点评 + 丢分归因
  model TEXT
);
CREATE TABLE exam_questions ( exam_id TEXT, qid TEXT, ord INTEGER, answer TEXT, self_est REAL,
  PRIMARY KEY (exam_id, qid) );

CREATE TABLE bank_versions (
  id TEXT PRIMARY KEY, created_at TEXT, kind TEXT,        -- seed|update|rollback|manual-edit
  added INTEGER, revised INTEGER, retired INTEGER, report TEXT, dir TEXT
);
CREATE TABLE dirty_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT, qid TEXT, reason TEXT, user_edit TEXT,
  ai_action TEXT, ai_result TEXT, status TEXT, created_at TEXT
);
CREATE TABLE ai_log ( ts TEXT, task TEXT, model TEXT, in_tokens INTEGER, out_tokens INTEGER,
  ms INTEGER, ref_type TEXT, ref_id TEXT, ok INTEGER );
CREATE TABLE settings ( key TEXT PRIMARY KEY, value TEXT );   -- AI 端点表存这里（加密后）
CREATE TABLE checkins ( day TEXT PRIMARY KEY, done INTEGER, plan TEXT );

-- 项目闯关进度：内容（关卡本身）在 content/projects/*.json，库里只存用户状态
CREATE TABLE project_progress (
  project_id TEXT NOT NULL, level_id TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,      -- 1 = 本关检查点全绿
  draft_code TEXT,                      -- 编辑中的草稿；没写过时为 NULL（前端回落到骨架）
  attempts INTEGER NOT NULL DEFAULT 0,  -- 跑测试次数，用于「已尝试 N 次」
  xp INTEGER NOT NULL DEFAULT 0,        -- 首次通关发的 XP；重做不重复计
  passed_at TEXT,
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (project_id, level_id)
);
```

## 5. 评分映射（展示百分制 / 内部四档）

| 内部四档 | 含义 | 百分制映射 | 图谱效果 |
|---|---|---|---|
| 0 | 完全不会 | 0–25 | 橙色·待巩固 |
| 1 | 给提示后能答上 | 26–55 | 橙色·待巩固 |
| 2 | 独立说清机制 | 56–80 | **绿色·点亮**（默认阈值） |
| 3 | 能追问并举证/讲取舍 | 81–100 | 绿色·精通（发光边） |

客观题：对=3、错=0；多选题漏选=1。考试总分 = 各题百分制加权平均，及格线默认 60。

## 6. AI 任务契约（统一 JSON 进出，便于换模型）

| 任务 | 输入 | 输出 JSON |
|---|---|---|
| `grade_subjective` | 题目(含 scoringPoints)+我的答案 | `{scale4,total,awarded:[{point,got,why}],verdict,missing[],comment}` |
| `personal_teaching` | 题目+我的答案+标准解析 | `{errors:[{claim,why_wrong,severity}],missing_points[],term_fixes[],how_to_remember,better_answer}` |
| `interview_probe` | 历史轮次+我上一答 | `{question,followup_of,intent,difficulty}`（最多 3 轮，每轮可评 0-3） |
| `qa_explain` | 当前题上下文+用户问题 | `{answer,confidence,related_nodes[],mini_example}` |
| `gen_variants` | 原题+已存在变体+节点信息 | `[{stem,answer,scoringPoints,analysis,gapCheck,angle}]` |
| `bank_update` | 联网检索摘要+现有题库摘要+覆盖缺口 | `{added[],revised[{id,patch}],retired[{id,reason}],coverage_report}` |
| `dirty_triage` | 举报理由+题目原文 | `{action:fix|retire|replace|keep,patch,reason}` |
| `diagnose_plan` | 图谱薄弱点+SRS 到期+错题分布 | `{today_plan:[{qid,why}],weak_clusters[],week_plan}` |

模型路由：`blank/judge/single` 无需 AI；`short` 走便宜/本地档；`essay/code/bank_update/diagnose_plan` 走强模型档。失败重试 2 次后降级为"仅显示标准答案"，并在 UI 标注未经 AI 批改。
