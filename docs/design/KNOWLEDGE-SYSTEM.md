# 知识体系设计（知识点正文 · AI 通俗解析 · 图谱掌握状态）

> 版本 v1（2026-11-10）。目的：把项目从「只存题库」升级为「知识体系驱动」。
> 本文是**实施契约**：字段名、文件路径、IPC 通道名都按此执行，改设计要同步改本文。

## 0. 用户诉求原文对应关系

| 用户提的 | 本设计的哪一节 |
| --- | --- |
| 没存知识点，只存了题库；要存完整知识点和文档，出变体题时用得上 | §2 存储 + §4 出题引用 |
| 答题时完全不知道某个知识点，要能直接去查，而不是瞎猜；只有解析没有知识点看不懂 | §5 应用内查阅 |
| 知识点要有 AI 解析：按用户提的意见给更简单易懂的解答 | §6 AI 通俗解析 |
| 知识图谱应是完整知识体系架构：含全部知识点、系统拆分、能看出前置依赖与归属 | §3 图谱即体系（已有骨架，补正文与状态） |
| 只能通过做题点亮；反复练习多遍才算掌握；忘记要降级并在图上体现 | §7 掌握状态机 |
| 「没有一点前置准备就让我答题？学到这里了吗？」 | §8 出题门槛（已修，见 §8.1） |

## 1. 现状事实（已核对，别重复发明）

- `nodes` 表已有：`id / parent / title / level / domain / stack / topic / summary / est_minutes / must_master / threshold`。**只有 summary（一句话能力描述），没有正文**。
- `edges(from_id,to_id,type)` 三种 type：`prereq`(75) / `contains`(122) / `related`(112)。level3 模块节点共 19 个，**挂了题的 0 个**，题只挂在 level4 考点上。
- 题库 JSON 已有 `knowledgeLinks: { prereq[], related[], followUps[] }`（`content/questions/**.json`），但**运行时没用起来**（除图谱抽屉读 edges）。
- `graph.ts::nodeDetail()` 已经返回 `prerequisites/dependents/related`（含 lit 状态）与 `advice`。
- `node_mastery(node_id, scale4, lit, needs_work, answered, correct, forced_unlock, last_practice)` —— 只有布尔点亮，没有"反复练习""遗忘降级"。
- `srs(question_id, stability, difficulty, reps, lapses, state, due, avg_score, weight)` —— FSRS 在**题目**级，不在考点级。
- IPC 是自动注册：`src/main/ipc.ts` 里的 `impl` 对象 `{ 命名空间: { 函数名: fn } }` → 通道名 `命名空间.函数名`；新增服务只要在 impl 加一个命名空间，再同步 `src/preload/index.ts` 与 `src/renderer/src/lib/ipc.ts` 三处。
- AI 网关：`chat(o)` / `chatJson<T>(o)` / `pickEndpoint('fast'|'strong')`；用量已入 `ai_log`。

## 2. 存储：Markdown 为源 + SQLite 索引/FTS

选它的三条理由（对应用户要求「好扩展、快、量大之后不卡」）：内容可读可 git diff 可手改；查询走 DB 与 FTS5 虚拟表，几万个知识点也不会卡；增量同步靠 hash，不全量重扫。

### 2.1 文件

```
content/knowledge/fe/vue/reactivity.proxify.md      ← 文件名 = 考点 id
content/knowledge/ai/rag/retrieval-pipeline.chunking-strategies.md
content/knowledge/_stale/                            ← 采集失败或待重写的隔离区
```

frontmatter（YAML，只放机器要用的字段）+ 固定小节（渲染与检索都依赖小节标题）：

```markdown
---
node: fe.vue.reactivity.proxify
title: Proxy 拦截与懒代理
sources:
  - url: https://vuejs.org/guide/essentials/reactivity-fundamentals.html
    title: Reactivity Fundamentals
    kind: official            # official | doc | spec | article | curated
  - url: https://github.com/vuejs/core/blob/main/packages/reactivity/src/baseHandlers.ts
    title: baseHandlers.ts 源码
    kind: source
updated: 2026-11-10T04:00:00Z
generator: kb-build@1
reviewed: false               # 人工/复核标记，AI 起草一律 false
confidence: high              # high | medium | low：来源是否权威、是否互相印证
---

## 一句话本质
reactive 用 Proxy 按需拦截读写字段，嵌套对象只在访问时才递归转代理（懒代理），因此能覆盖新增/删除属性且初始开销低。

## 为什么需要它
...

## 机制讲清楚
（正文允许代码块、表格；代码块必须标语言）
```ts
const seen = new WeakMap()
function reactive(target) { /* ... */ }
```

## 关键结论
- 五条 5 种 target 类型的处理边界
- ...

## 常见误区
- 「Proxy 能拦截到原始对象快照」——错，toRaw 拿到的普通对象改动不会触发。

## 常见问法
- 追问链：为什么懒代理 → defineProperty 差在哪 → Proxy 的局限 → markRaw/toRaw 边界

## 前置知识
- [[fe.vue.reactivity]] — 响应式总体
- [[cs.lang.js-proxy]] — Proxy/Reflect 语义

## 相关
- [[fe.vue.reactivity.effect-dep]]
```

规则：
- `[[node-id]]` 双链是知识点之间的唯一跳转语法，渲染时转内部路由；**必须能在 nodes 表里找到 id**，索引时校验，找不到的记入 `_stale` 报告。
- 小节标题固定为上面**八个**（含最后的「相关」；缺哪个就渲染时跳过，但索引会 warn）。清单的唯一真源是
  `src/shared/knowledge-core.mjs` 导出的 `REQUIRED_SECTIONS`，闸门与 CLI 都用它——别在别的脚本里再抄一份，
  抄了就会漂（曾经 kb-build.mjs 自己抄成七个，漏掉「相关」）。
- `sources.kind='official'` 至少 1 条是硬要求（用户明确说"主要从官方文档来"）；只有二手来源时 `confidence: medium` 及以下。

### 2.2 表（新增，走 schema.mjs 的 SCHEMA_VERSION 迁移）

```sql
CREATE TABLE IF NOT EXISTS knowledge (
  node_id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
  body_md TEXT NOT NULL, summary TEXT,                        -- 正文首节「一句话本质」，列表页用
  hash TEXT NOT NULL, confidence TEXT DEFAULT 'medium', reviewed INTEGER DEFAULT 0,
  generator TEXT, updated_at TEXT, indexed_at TEXT DEFAULT (datetime('now','localtime')),
  word_count INTEGER DEFAULT 0, quality_flags TEXT,            -- JSON 数组：缺哪些小节/断链
  search_text TEXT DEFAULT ''                                  -- tokenizeForSearch 后的空格串，见下方 FTS 说明
);
CREATE TABLE IF NOT EXISTS knowledge_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT, node_id TEXT NOT NULL,
  url TEXT NOT NULL, title TEXT, kind TEXT, fetched_at TEXT, trust REAL DEFAULT 0.5,
  snippet TEXT                                                 -- 抓取摘要，供 AI 起草与溯源展示
);
CREATE INDEX IF NOT EXISTS idx_ks_node ON knowledge_sources(node_id);

-- 全文检索：FTS5（外部内容表指向 knowledge，不重复存正文，省一半空间）
-- 第三列是 search_text（不是 body）：**必须喂「分词串」**。unicode61 会把一整串连续中文当成一个
-- token，直接索引 body 的话「懒代理」「编译器」这类词全 MATCH 不到；knowledge-core 的
-- tokenizeForSearch 把 CJK 切成「单字 + 相邻二字组合」、拉丁整词小写，索引侧与查询侧共用它，
-- 两端口径一致才搜得到。body_md 仍存原文，供渲染与高亮定位。
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
  title, summary, search_text, content='knowledge', content_rowid='rowid', tokenize='unicode61'
);
-- 触发器保持 FTS 与主表同步（INSERT/UPDATE/DELETE 三个）

CREATE TABLE IF NOT EXISTS ai_explain (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id TEXT NOT NULL, ask TEXT NOT NULL, style TEXT NOT NULL DEFAULT 'easier',
  model TEXT, tokens INTEGER DEFAULT 0, ms INTEGER DEFAULT 0,
  answer_md TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_explain_lookup ON ai_explain(node_id, ask, style);
```

- 正文只在 `knowledge.body_md` 存一份；FTS 用 external content 模式 → **量大不卡**、体积小。
- `ai_explain` 兼当缓存：同 `(node_id, ask, style)` 命中直接返回，避免重复烧 token。

### 2.3 同步（增量、幂等）

`scripts/kb-index.mjs`：扫 `content/knowledge/**/*.md` → 解析 frontmatter → 计算 `hash=sha256(整篇文件文本，含 frontmatter)`（不是只算 body：`sources` 改了也要重建 `knowledge_sources`，只比 body 会漏）→ 与库中 hash 比对 → 不同才 upsert + 重建该行的 FTS 条目；文件消失则删行。同时做质量闸门：小节齐全、字数 ≥900、`sources ≥2 且至少 1 official`、`[[双链]]` 全部可解析、代码块有语言标注。退出码非 0 表示有问题（CI/自查用）。
CLI 与主进程服务共用 `src/shared/knowledge-core.mjs` 这套纯函数（解析 / 分词 / 闸门 / MATCH 构造），所以「命令行验过的行为」等于「应用里的行为」；CLI 因此不能 import `src/main/**`（那里依赖 electron）。

**应用启动时也调一次轻量同步**：先比 `size:mtimeMs` 扫描缓存（存在 `meta.kb_scan_cache`），命中就连文件都不读；没命中才读文件比 sha256。5000 篇无变化的场景实测远低于 1 秒（`node scripts/qa/kb-perf.mjs` 会造 5000 篇量一遍并断言耗时）。带 `quality_flags` 的文件不吃缓存，每次都会重新过闸门，避免不合格正文被静默跳过。

## 3. 图谱即知识体系

已有的骨架是对的（三级拆分 + prereq/contains/related）。要补的是**让它承载正文与状态**：

- 节点抽屉：`已点亮/学习中/已掌握/已生疏` 四态徽标（§7）、「查看知识全文」按钮（→ 知识阅读抽屉）、前置清单显示每个前置的状态与一键跳转、「相关知识点」列表。
- 抽屉里若该考点还没有知识正文，显示"尚未收录（可一键生成）"，点了就走 §4 的起草流程。
- 图例改成四态 + 必考标记；节点卡的进度点保持（已有点亮圆点）。
- **不要动** fitView / 节点测量逻辑（VueFlow 1.48 的 Ref 陷阱见记忆库）。

## 4. 出题要用知识（不只是出题后给解析）

- 出变体题（BankView「让 AI 更新题库」/ PracticeView「补变体」）时，prompt 里**必须带上该考点的知识正文**（截断到 ~1200 tokens）+ 原题 + 追问链，要求"基于这份材料出题，不得引入材料外的事实"。`grading.ts` 判分同理：带知识正文时评分理由能引用出处。
- 题目卡顶部新增一行「考点要求」：取 `nodes.summary`（那句"要能讲清…"）+ 前置就绪状态（未点亮的前置标出来并可点开知识）。这直接回答"学到这里了吗"。
- `questions.knowledgeLinks.prereq` 入库时并入 `edges(type='prereq')`（若该边不存在）→ 图谱门槛与题库一致。`related` 同理并入 `type='related'`。
  - 并入走 `seed-core.mjs` 的 `addPrereq`，统一带**环检测**：加 `pre→node` 前若 `node` 已能沿现有 prereq 边到达 `pre`，则该边成环（双向标注 A 前置 B、B 又前置 A 会让两个考点互相死锁、永远 blocked），跳过并记入 `seed_stats.skipped`。节点级与题目级前置共用这一道闸门；指向自身祖先的归属边照旧剔除（已有 `contains` 边）。

## 5. 应用内查阅（答题时不懂立刻能查）

入口三处，全部走同一个 `KnowledgeDrawer` 组件：
1. 题目卡「考点要求」行 → 「看知识」；
2. 反馈面板「看不懂？」→ 「查知识点」/「AI 换个说法」（§6）；
3. 图谱节点抽屉 + 命令面板搜索（FTS）。

渲染复用现有 `.md` 样式与 markdown 组件；`[[双链]]` 点击 → 抽屉内切换（保留返回栈）。加载方式：`knowledge.get(nodeId)` 一次返回正文 + 来源列表 + 前后置清单。

## 6. AI 通俗解析

- 输入：知识点 id + 用户的困惑原话（可选：当前题目 id）+ 风格档（`easier` 更通俗 / `example` 举例为主 / `short` 压缩到 5 句 / `from-prereq` 从前置讲起）。
- 上下文：该考点正文 + 前置考点的「一句话本质」拼接（**这是"由浅入深重讲"的关键**），要求"只用我已经点亮的前置作为已知概念，不要引入未点亮节点的术语"。
- 走 `fast` 端点（便宜快），强档只在 `from-prereq` 长文时可选。
- 结果写 `ai_explain` 并显示 token/耗时；同一问法二次打开直接显示缓存（标注"上次生成于 …"）。
- 输出必须允许追问：卡片底部一排 chips（「再简单一点」「举个例子」「和 X 什么关系」），chips 就是新的 ask 值。

## 7. 掌握状态机（图谱四态 + 推送联动）

`node_mastery` 增列（ALTER 迁移，默认值兼容旧数据）：

```sql
ALTER TABLE node_mastery ADD COLUMN mastery_level INTEGER DEFAULT 0;  -- 0 未接触 1 学习中 2 已掌握 3 已生疏
ALTER TABLE node_mastery ADD COLUMN pass_reps INTEGER DEFAULT 0;      -- ≥80 分的次数（跨该考点所有题累计）
ALTER TABLE node_mastery ADD COLUMN total_reps INTEGER DEFAULT 0;
ALTER TABLE node_mastery ADD COLUMN lapses INTEGER DEFAULT 0;
ALTER TABLE node_mastery ADD COLUMN next_review TEXT;                 -- 该考点最近一道题的到期时间聚合(min)
ALTER TABLE node_mastery ADD COLUMN retention REAL DEFAULT 0;         -- FSRS 预测保持率
ALTER TABLE node_mastery ADD COLUMN stale INTEGER DEFAULT 0;          -- 生疏标记（图上橙色）
```

判定（提交作答后与打开图谱时各算一次，纯 SQL/纯函数，不请求 AI）：

- `total_reps == 0` → `mastery_level=0`（灰，未接触）
- 否则若 `pass_reps>=3 AND avg_score>=0.8 AND retention>=0.9 AND 距 last_practice < 14 天` → `mastery_level=2`（绿，已掌握）
- 否则若 `next_review` 已过期 或 `lapses>=1` → `mastery_level=3`（橙，已生疏）并 `scale4 = max(0, scale4-1)`、`stale=1`
- 其余 → `mastery_level=1`（黄，学习中）

与推送的联动（这才叫"减少推送频率/忘记了又回来"）：
- 已掌握：该考点的题 `srs.weight *= 0.6`、队列里出现频率下降，只在到期时以**变体题**形式回归；
- 已生疏：`srs.weight = min(3, weight*1.5)`、`due` 提前到当天，并优先出**原题**（不是变体）先确认是否真会；
- 闭卷考试里答错该考点的题 → 直接记一次 lapse（考试是最强的遗忘探测）。

图上四态颜色（token 化，深浅色都要能区分）：灰 `--text-faint` / 黄 `--warn` / 绿 `--ok` / 橙 `--hot`（生疏用斜纹边框 + 小叹号图标）。

## 8. 出题门槛（本轮已修，记录原因防回潮）

### 8.1 已修：祖先节点被当成门槛导致死锁
`content/nodes/*.json` 的 `prerequisites` 里有 **49 处指向自己的父模块**（如 `fe.vue.compiler.ast-pipeline` 的前置写成 `fe.vue.compiler`）。seed 把这些建成 `prereq` 边后：level3 模块**一道题都没挂**（19 个模块 0 题）→ 永远无法靠做题点亮 → 其全部 level4 子考点 `blocked=1` → 队列只能走兜底 `allowLocked=true` 放开限制 → **第一次练习就抽到深水区考点**（用户："没有一点前置准备你就让别人答题？"）。

修法：`scripts/seed-core.mjs` 写 prerequisites 时跳过 `n.id.startsWith(pre+'.')` 的祖先项；对已有库跑 `scripts/migrate-drop-ancestor-prereq.mjs`（备份 + DELETE，prereq 124→75）。

### 8.2 已修：blocked 判定漏掉"前置从未做过"
`fetchNew` 里 blocked 子查询原本是 `JOIN node_mastery pm`，前置若无 mastery 行（全新用户）EXISTS 直接不成立 → blocked 恒 0。改 `LEFT JOIN` + `COALESCE(pm.lit,0)=0`。

### 8.3 已修：排序失真
`ORDER BY q.difficulty ASC` 会被题库乐观标注带偏（`tags:['送分题']` 的填空题对没学过编译器的人并不送分），且 `nodes.level` 全是 4 排了等于没排。改为按 **gates（外部前置数量）ASC → difficulty ASC**，并用 `ROW_NUMBER() OVER (PARTITION BY node_id)` 限制**同一考点一次最多 2 题**（原来 RANDOM() 会把同考点三道题连着塞进队列）。

验证脚本：`scripts/qa/diag-prereq-gating.mjs`（队列前 12 题的 gates/难度/考点分布）、`scripts/qa/diag-edges.mjs`（边分布与祖先边）。

### 8.4 待做：难度实测校准
`difficulty` 是题库里写死的（AI 生成时标的）。等 attempts 有量之后：按考点统计错误率，与标注重合度低于阈值时在洞察页标「标注偏乐观」，并把校准后的难度用于排序。**不要在本题库里手工改数字**（用户是学生，无法复核）。

## 9. 采集与生成（联网为主，用户明确要官方文档）

**单一真源 `scripts/kb-draft-core.mjs`**：命令行 `scripts/kb-build.mjs` 与应用内
`services/kb-draft.ts`（IPC `knowledge.generate` / `knowledge.generateBatch`）**共用同一份管道**，
不允许两边各写一套来源/闸门逻辑（历史上正是"只有外部 CLI 能出讲义、应用里没有入口"导致讲义只有 3 篇）。
调用方只注入三样东西：`chat(system,user)`、`prereqOf(nodeId)`、`validNodeIds` + 落盘目录。

### 9.1 来源获取（决定能不能生成，比 prompt 更关键）

按优先级合并，去重后按 kind 与命中分排序，取前 6 个候选逐个抓正文，**够 3 篇就停**：

1. **`HINT_SOURCES`（主力）**：考点关键词 → **绝对 URL** 的精选表，每条都是
   `scripts/qa/reach-probe*.mjs` 实测「fetchText 能拿到 ≥600 字符正文」的官方整页。
2. `SITEMAPS` + `scoreUrl`：官方 sitemap 的 slug 相关性匹配（fe 域主要靠这条 + MDN 中文 sitemap）。
3. `searchWeb`：Bing 普通检索（**不能用 `site:` 语法**，本机实测拿不到结果），命中域名再按白名单判 kind。

两个必须记住的坑（都是实测出来的，别再踩）：

- **可达性 ≠ 白名单**。这台机器（国内网络）拿不到 `huggingface.co`、`*.wikipedia.org`、
  `www.tensorflow.org`、`platform.openai.com`(403)、`zhihu`(403)、`research.google`、`developer.android.com`；
  单次超时要 21 秒，一篇讲义撞两三个这种源就白等一分钟。所以有 `UNREACHABLE_HOSTS` 预置 +
  运行时 `brokenHosts`（403/429/5xx/连接异常 → 拉黑整站本轮不再试；**404 只算单页失效不拉黑**，
  因为我们自拼的路径常有偏差）。换网络环境（挂代理/换机器）必须重新探测。
- **200 不等于有正文**。`kafka.apache.org/documentation`、`docs.docker.com`、`juejin.cn/search`
  返回 200 但是 SPA 空壳（几十~几百字符）。因此 `MIN_TEXT = 600` 作为正文下限，
  低于它不算一个有效来源（否则 AI 会对着空壳编内容）。

实测可起草率（每域抽 6 个 L4 考点，判据 = ≥1 official 且 ≥2 篇可抓正文）：
补 `HINT_SOURCES` 前 **4/30**（ai/be/cs/eng 全 0，只有 fe 4 个），补完后 **29/30**
（唯一漏网 `be.java.dsa.linear`）。复测命令：`node scripts/qa/kb-source-probe.mjs 6 3`。

### 9.2 起草与闸门

- AI：`chat({ task:'kb_draft', role:'strong', maxTokens:4000, timeoutMs:240000 })` —— 长文写作走强档；
  本机 local-qwen 成功生成均值约 120 秒，150 秒上限会把快完成的长文打断。**批量默认串行（concurrency=1）**：
  实测并发 2 时两篇抢算力双双 150s 超时；只有接了远程端点才适合 `--concurrency 2+`。
- 输入压载：每个来源正文只取前 3000 字、最多 3 篇（约 9000 字符）。之前 3×5000 让生成长度普遍越过 150s。
- Prompt 硬约束：八个二级小节一个不能少；事实只能来自参考材料并按 `[^n]` 标源；代码块 ≤30 行且标语言；
  「前置知识」「相关」只用输入给的 node id 写 `[[双链]]`，不许发明 id；并明确要求**先把八小节写完再展开**
  （「机制讲清楚」≤600 字），因为本机模型常在第三节写太久导致后五节整体丢失。
- **草稿修补链（过闸前的三道机器兜底，本地小模型必备）**：
  1. `ensureTailSections`：缺「前置知识/相关」时用图谱里真实存在的 prereq/sibling id 自动补（零 AI 成本）；
     没有可用 id 就写说明句，绝不发明 id（发明了就是 broken-link）。
  2. `completeMissingSections`：仍缺硬骨头小节（机制/结论/误区/常见问法…）时做**一次续写调用**，
     只补缺失小节、不重跑全文，成本约为重跑的一半。
  3. `ensureMetaAndSources`：frontmatter 的 `sources` 由程序按实际抓到的来源覆写，
     模型复述 URL 漏条数/改 kind 都不影响闸门；`node/title/updated/generator/reviewed/confidence` 缺失一并补。
- 质量闸门（真源在 `src/shared/knowledge-core.mjs` 的 `qualityCheck`，core 只做一致性包装）：
  小节齐全、正文 ≥900 字、来源 ≥2 且至少 1 个 `official`、`[[双链]]` 全部能解析成真实 node id、
  frontmatter 的 `node` 与目标一致。任一不过 → 写进 `content/knowledge/_stale/<id>.md` 并在首行注明原因（含已执行过的修补），不入库。
- 状态语义（UI 直接拿来提示，不要吞掉）：`written` / `stale`(带 flags，可附 `repaired`) / `no-official` /
  `fetch-thin` / `skip-exists` / `no-endpoint` / `error`。
- `written` 之后**立刻** `syncFromFiles()` 增量入索引，抽屉刷新即可读，不需要用户手动同步。

### 9.3 应用内入口（这次补的核心功能）

- 讲义抽屉未收录态：「AI 生成讲义」按钮 → `knowledge.generate(nodeId)`；未过闸时把 `flags`
  原样显示给用户（例如"缺 ## 常见误区"），让用户知道该重跑而不是以为坏了。
- 题库页「讲义补齐」行：板块 + 篇数 → `knowledge.generateBatch({domain, limit})`，
  默认只补没有讲义的 L4 考点、**mustMaster 优先**（重点先有可读材料），返回 tally 汇总。
- 批量是长任务（串行，每篇 2-4 分钟），UI 必须给"保持页面打开"的预期文案，别做成无反馈的 spinner。

## 10. 实施顺序（先端到端闭环，再铺量）

1. **P0**：schema 迁移（§2.2 + §7 列）+ `services/knowledge.ts` + IPC 三处接线 + `kb-index.mjs`；手写 3 篇样板知识（含 `fe.vue.reactivity.proxify`、`fe.vue.compiler.ast-pipeline`）→ 跑通「题目卡→知识抽屉→双链跳转」。
2. **P0'**：`KnowledgeDrawer.vue` + 题目卡「考点要求」行 + 反馈面板「查知识点」。
3. **P1**：掌握状态机（§7）+ 图谱四态着色 + 推送权重联动 + `r7-mastery.mjs` 验收脚本。
4. **P1'**：`kb-build.mjs` 联网采集，先做 fe 域 19 个模块下的考点，质量闸门通过再铺 ai/cs 域。
5. **P2**：AI 通俗解析 UI（§6）+ 缓存 + 出题 prompt 注入知识正文（§4）。
6. **P2'**：命令面板搜知识（FTS）、洞察页「知识覆盖 vs 题目覆盖」对照、难度实测校准（§8.4）。

## 11. 验收（每条都要能机检）

- `node scripts/kb-index.mjs` 退出码 0：无断链、无缺小节、每篇 ≥1 official 来源。
- `node scripts/qa/kb-source-probe.mjs 6 3`：各域可起草率 ≥5/6（判据 = ≥1 official 且 ≥2 篇正文 ≥600 字）。
  掉到 0 通常只有两种原因：网络环境变了（重跑 `scripts/qa/reach-probe*.mjs` 重建可达表），或官方改了 URL 路径。
- 应用内生成闭环（不碰命令行）：抽屉未收录态点「AI 生成讲义」→ 状态 `written` → 立刻能读到八小节正文；
  题库页「AI 批量补齐讲义」→ tally 里 `written ≥1` → `knowledge.status().missingBody` 相应下降。
- `node scripts/qa/r7-knowledge.mjs`：题目卡能看到「考点要求」→ 点「看知识」出抽屉 → 正文渲染（含代码块）→ 点 `[[前置]]` 切换成功 → 来源链接可见。
- `node scripts/qa/r7-mastery.mjs`：构造 3 次 ≥80 分 → 图谱节点转绿（已掌握）；把 `last_practice` 推到 20 天前 → 转橙（已生疏）且 `scale4` 降 1、该考点题重新进入今日队列。
- `node scripts/qa/r7-keepalive.mjs`（已有）：切页不丢状态。
- `npx vue-tsc --noEmit -p tsconfig.web.json` 零错误；`node scripts/validate.mjs` 零错误。
- 大库性能：5000 篇知识下 `knowledge.search('编译器')` < 30ms、图谱首屏 < 1.5s（用 `scripts/qa/perf-kb.mjs` 造量测）。
