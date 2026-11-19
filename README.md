# 练习册 · Interview Forge

> 一个完全跑在本机的技术练习客户端：题库练习、闭卷考试、知识图谱、间隔重复，外加一个**能引用题库原文**的 AI 私教。

学技术最常见的困境不是"没题做"，而是**题做错了不知道为什么错、看了解析还是不懂**。这个项目的核心思路是：

- 把 997 道题、450 个考点及其前置关系组织成一张可导航的知识图谱，而不是一堆散装题目；
- 让 AI 讲解时**必须基于题库里的标准解析**（FTS5 检索注入），并在生成后校验是否出现了材料里没有的 API；
- 所有数据留在本地 SQLite，不联网也能跑完整流程。

## 功能

| 模块 | 说明 |
| --- | --- |
| **题库练习** | 997 道题、7 种题型（单选/多选/判断/填空/简答/代码/论述），按考点与难度筛 |
| **项目闯关** | 直接敲代码学：给一份能跑但不完整的工程骨架，在编辑器里补完、点「跑测试」看红绿，全绿通关。关卡线性解锁，答案通关后才给 |
| **闭卷考试** | 限时组卷、中途暂停、自评与 AI 批改，交卷后出成绩报告 |
| **知识图谱** | 450 个考点、1300+ 条关系边（进阶门槛 `advance` / 理解地基 `depend` / 平行 / 易混对比 / 类比 / 印证） |
| **FSRS 间隔重复** | 按遗忘曲线排期复习，错题自动加重权重 |
| **自适应摸底** | 沿前置链探测，定位真实水平，输出「从哪开始学」 |
| **AI 私教答疑** | 本地小模型（llama.cpp）多轮答疑，带作用域护栏；讲解时注入**当前题目的标准解析**，生成后做引用校验 |
| **知识体系** | 考点正文以 Markdown 管理，索引进 SQLite FTS5（中文二字词分词 + bm25 字段加权） |
| **游戏化** | XP / 等级 / 徽章 / 连续打卡 |

## 项目模式（直接敲代码）

光看题看不进去的时候，换一种入口：不先做题，先写一个能跑的东西。

- 每个项目是一串**线性关卡**，每关给一份能跑但不完整的骨架（`TODO` 标到具体行），用户在应用内的编辑器里补完，点「跑测试」看检查点红绿；
- 每关的阅读顺序是固定的：**目标 → 为什么 → 前置知识 → API 契约 → 分步 → 提示**。前置知识里讲清这一关要用到的概念（带可运行的小例子），API 契约给出函数签名、参数含义、返回值、调用示例——照着就能写；
- 分步卡片的「定位」按钮会直接把光标跳到编辑器里的那个 `TODO`，右栏顶部实时显示「还剩几个 TODO」；
- 判题在主进程的 `vm` 沙箱里跑（超时 4 秒，没有 `require`/`fs`），用户代码和测试源码都不进渲染进程——**断言不泄漏**；
- 全绿才算通关，通关才下发参考答案；上一关不通关，下一关既点不进去、后端也拒绝执行；
- 写到一半切走，草稿会自动存，回原处接着写；**内容改版后旧草稿会自动失效**（草稿绑定了骨架指纹），不会让人对着一份上一版的旧代码找 bug。

当前 9 个项目、33 关，按领域分栏（前端 / 后端 / 公共基础 / AI Agent）：

> **和知识图谱的关系**：每个关卡在 `nodes` 里显式声明它讲透的知识点，项目页按知识点 topic 分章、项目列表顶部有「知识图谱覆盖」总览（当前 **25 / 402 → 6.2%**，缺口清单可展开）。目标是把图谱里 402 个 L3/L4 知识点全部收编成关卡，覆盖口径、机检与补齐路线见 [项目闯关 · 知识图谱覆盖](docs/design/PROJECT-COVERAGE.md)。

| 方向 | 项目 | 关数 | 做什么 |
| --- | --- | --- | --- |
| 前端 | 从零写一个响应式内核 | 9 | Proxy 拦截 → 依赖收集 → 精确触发 → 分支清理 → 嵌套栈 → 调度器 → computed |
| 前端 | 手写日常工具箱 | 3 | 深拷贝（循环引用）→ 事件总线（once/off）→ 柯里化 |
| 前端 | 手写一个 Promise | 3 | 状态机与微任务派发 → then 链（thenable 展开 / 错误穿透）→ 静态方法（all/race/allSettled） |
| 后端 | 从零读懂 HTTP 报文 | 3 | 解析请求行（含 query）→ 解析请求头 → 路由分发（含动态段与静态优先） |
| 后端 | 从零写一个一致性哈希环 | 3 | 哈希环与二分查找 → 虚拟节点与负载均衡 → 故障转移与权重 |
| 公共基础 | 手写 LRU 缓存 | 3 | Map 版语义 → 双向链表（哨兵）→ 合成 O(1) 版本 |
| 公共基础 | 从零写一个 AC 自动机 | 3 | Trie → fail 指针与输出链 → 敏感词遮蔽与复杂度对比 |
| AI Agent | 最小可运行的 Agent 循环 | 3 | 解析工具调用 → 工具注册表（错误隔离）→ agent 循环（消息追加 + 轮数上限） |
| AI Agent | 从零写一个混合检索器 | 3 | BM25 打分 → 向量余弦召回 → RRF 名次融合（两路互补的证据） |

内容源在 `content/projects-src/*.mjs`（用模板字符串写每步完整代码/测试/参考解），构建时序列化成 `content/projects/*.json` 给主进程读。改内容后：

```bash
npm run project:build   # 构建 JSON，同时校验：结构 + domain + nodes 合法性 + 每步答案（过本步、不过下一步）+ finalCode + 参考解全绿 + 骨架必红
npm run project:check   # 直接对产出的 JSON 再校验一遍（CI 用）
npm run project:coverage            # 覆盖率报表（按领域/技术栈）；--gaps 看未覆盖清单，--check --min=100 设门槛
```

新增一个项目 = 在 `content/projects-src/` 加一个 `.mjs`（带 `domain`），不用碰任何代码。写法与字段契约见 [项目闯关关卡规范](docs/design/PROJECT-LEVELS.md)，动笔前的质量线与迁移配方见 [项目闯关内容生产手册](docs/project-authoring.md)。

## 技术栈

- **桌面壳**：Electron 45 + electron-vite
- **前端**：Vue 3 + TypeScript + naive-ui + Pinia + Vue Router，Monaco Editor / ECharts / Vue Flow
- **存储**：`node:sqlite`（Node.js 内置，无需原生编译）+ **FTS5 全文检索**
- **本地推理**：llama.cpp（OpenAI 兼容 HTTP 接口），支持纯 CPU 或 CUDA 加速
- **中文检索**：自研分词（单字 + 相邻二字组合）+ `bm25()` 字段加权，避免 FTS5 `unicode61` 对中文不分词、「路由」这类两字术语搜不到的问题

## 快速开始

### 前置要求

- **Node.js ≥ 22**（依赖内置 `node:sqlite`；开发时用 24.x）
- Windows 10/11、macOS 或 Linux

### 安装与运行

```bash
npm install
npm run seed      # 把 content/ 下的题库灌进 data/app.db
npm run dev       # 启动开发模式（Vite + Electron）
```

其他脚本：

```bash
npm run build     # 构建产物到 out/
npm run typecheck # vue-tsc + tsc 双段类型检查
npm run qa        # 回归测试
```

### 同时开多个窗口（多开）

Electron 的「单实例锁」和 Chromium profile 都绑在 userData 目录上——两个进程共用一个目录，第二个窗口要么被锁踢掉、要么争抢 profile 起不来。所以多开的前提是**每个实例有独立身份**：

```bash
npm run dev:multi            # 一次起 2 个窗口（CDP 9222 / 9223），关掉这条命令就一起关
npm run dev:multi -- 3       # 3 个
npm run dev:2                # 只起第二实例（CDP 9223）
npm run dev:bg -- --instance=3   # 分离启动：窗口不再挂在当前终端 / agent 会话的进程树上
```

| 资源 | 默认实例 | 实例 N |
| --- | --- | --- |
| Chromium userData（缓存 / localStorage / 单实例锁） | `data/electron-userData` | `data/electron-userData-N` |
| 启动日志 | `forge-boot.log` | `forge-boot-N.log` |
| CDP 调试端口 | 9222 | `9222 + N - 1` |
| 渲染端 Vite 端口 | 5173 | 被占用时自动顺延（5174 / 5175…） |

数据目录默认共用 `data/`（题库和进度共享）；要连数据也隔离，加 `--own-data`：

```bash
node scripts/dev.mjs --instance=2 --own-data   # 数据写到 data/instances/2
```

**和别的 Electron 项目同时跑**也没问题，只要那个项目不硬编码 5173 / 9222：本项目的渲染端口会自动顺延，主进程用 electron-vite 注入的 `ELECTRON_RENDERER_URL` 取地址，不写死端口。实测本机 `resource-keeper`（占用 5173）与本项目两个实例（5174 / 5175，CDP 9222 / 9223）三个窗口并存。

验证多开：`node scripts/qa/multi-instance-check.mjs 9222 9223`（逐个连 CDP，检查列表页与第 1 关卡页都能渲染、IPC 通）。

## 本地模型（不随仓库分发）

模型文件有 1–3 GB，**不包含在本仓库中**。程序在首次调用 AI 私教会话时会懒启动本地推理服务，所以你需要先把模型与运行时准备好。

### 方式一：自动下载（推荐）

```bash
npm run tutor:fetch
```

该脚本会下载 llama.cpp 运行时（约 24 MB）与推荐模型（约 2.8 GB）到模型目录。

### 方式二：手动放置

把 llama.cpp 的 `llama-server` 可执行文件和 GGUF 模型放进模型目录：

- Windows：`D:/model/forge-tutor/`
- macOS / Linux：`~/.forge-tutor/`

推荐模型：

| 模型 | 量化 | 体积 | 适用 |
| --- | --- | --- | --- |
| Qwen3.8-4B-Distill | Q4_K_M | ≈ 2.8 GB | 主力，答疑质量较好 |
| LFM3-1.7B | Q4_K_M | ≈ 1.1 GB | 轻量，低配机器可用 |

> 模型目录必须是**纯 ASCII 路径**：Windows 下 llama.cpp 读不了含中文的路径。

### 推理模式与运行时

默认**自动判定**：检测到 NVIDIA 显卡且空闲显存足够就全量上卡（`--n-gpu-layers 99`），否则退回纯 CPU（`--n-gpu-layers 0`，零显存占用）。设置页可在「自动 / 强制 GPU / 强制 CPU」之间切换，并直接显示**判定理由**（为什么走了这条路）。

GPU 后端提供两种运行时，体积差 19 倍但能力接近：

| 运行时 | 体积 | 适用 |
| --- | --- | --- |
| **Vulkan**（推荐） | 36 MB | NVIDIA / AMD / Intel 通用，不需要装 CUDA 运行时 |
| CUDA | 305 MB + 373 MB cudart | 仅 NVIDIA，追求极限吞吐时才值得这个体积 |
| CPU | 24 MB | 零显存占用，所有机器可用 |

```bash
npm run tutor:fetch -- --runtime=vulkan   # 下载 Vulkan 运行时（36MB）
npm run tutor:fetch -- --runtime=cuda     # 下载 CUDA 运行时（约 678MB）
```

设置页会列出可选模型（4B 主力 / 1.7B 轻量）、各运行时是否就绪，并在缺依赖时给出**可复制的补下载命令**。

参考速度（i7-13700KF 纯 CPU，Q4_K_M）：约 13–17 tok/s。一道短答题的完整回答通常在 4–16 秒。

### 环境变量

| 变量 | 含义 | 默认值 |
| --- | --- | --- |
| `FORGE_TUTOR_DIR` | 模型与运行时目录 | Windows `D:/model/forge-tutor`；其他 `~/.forge-tutor` |
| `FORGE_TUTOR_MODEL` | GGUF 文件名 | `qwen3.8-4b-distill-q4_k_m.gguf` |
| `FORGE_TUTOR_PORT` | 本地推理端口 | `18765` |
| `FORGE_TUTOR_CTX` | 上下文长度 | `8192` |
| `FORGE_TUTOR_IDLE_MS` | 空闲多久卸载模型 | `900000`（15 分钟） |
| `FORGE_TUTOR_DISABLE` | 设为 `1` 完全禁用本地模型 | 未设置 |
| `FORGE_DATA_DIR` | 数据目录 | 开发模式用项目内 `data/`，打包后用 `userData` |
| `FORGE_INSTANCE` | 实例号（多开用）：隔离 userData / 日志 / CDP 端口 | 未设置（默认实例） |
| `FORGE_RESEED` | 设为 `1` 强制重灌题库 | 未设置 |
| `DEEPSEEK_BASE_URL` | 「换云端重答」用的 OpenAI 兼容地址 | `https://api.deepseek.com/v1` |

## 项目结构

```
src/
  main/          主进程：窗口、IPC、SQLite、AI 网关、本地模型托管
    ai/          gateway.ts（多端点路由）/ tutor-model.ts（llama.cpp 懒启动）
    services/    explain.ts（私教答疑）/ knowledge.ts（知识检索）/ question-retrieval.ts（题目检索）/ project.ts（关卡判题）
  preload/       预加载脚本，暴露类型化 IPC
  renderer/      Vue 3 前端
  shared/        主进程与渲染进程共用：schema、分词、校验等纯函数
content/         内容（JSON）：questions / nodes / knowledge / variants / projects
scripts/         灌库、QA、探针脚本
docs/            设计文档与运维说明
```

## 数据与隐私

- 所有学习数据保存在本地 SQLite（`data/app.db`），不上传任何服务器。
- 默认离线可跑：题库、图谱、复习排期、本地 AI 答疑都不需要网络。
- 只有显式点击「换云端重答」时才会调用外部 API（需自备 Key，通过环境变量配置）。

## 已知限制

- 本地 4B 模型能力有限：**适合短答与逐步引导，不适合一次性生成长篇教程**。长文讲解请用「换云端重答」。
- 知识体系（`content/knowledge/`）目前只收录了少量考点，覆盖面还在扩充。
- 未做代码签名与安装包分发，macOS 首次运行需要手动放行。
- 题库内容由 AI 辅助生成并经人工审校，**不能保证零错误**；发现错题请在 issue 里指出。

## 文档

- [知识体系设计](docs/design/KNOWLEDGE-SYSTEM.md)
- [项目闯关关卡规范](docs/design/PROJECT-LEVELS.md)
- [本地模型服务运维](docs/ops/local-model-service.md)
- [题库生产指南](docs/content-production-guide.md)
- [数据契约](docs/data-contracts.md)

## 许可

[MIT](LICENSE)