# 练习册

一个跑在本机的技术练习客户端。题库和知识图谱连着用，项目闯关可以直接写代码，AI 私教用本地模型答疑。数据存在本地 SQLite，不联网也能走完整个流程。

做题时最常遇到的情况是答错了说不清错在哪，看了解析还是没弄懂。所以项目围绕这些场景来做。题目带标准解析，考点之间连成图谱，AI 讲解必须引用题库原文，项目闯关直接写代码。

| 题库 | 知识图谱 | 项目闯关 | 图谱覆盖 |
| --- | --- | --- | --- |
| 997 道题 / 7 种题型 | 450 个考点 / 1809 条关系边 | 34 个项目 / 120 关 / 358 个分步 / 1663 个检查点 | 402 / 402 |

产品名叫「练习册」。仓库名和 npm 包名仍然是 `interview-forge`，脚本、数据目录和已有链接都用这个标识，改名的成本比收益大，就留着了。除代码标识外，文档里不再出现旧称。

## 功能

| 模块 | 说明 |
| --- | --- |
| 今日 | 今天的任务清单（到期复习、薄弱变体和未做的新题），以及入门摸底和最近一次考试。侧栏常驻显示考点点亮率 |
| 题库练习 | 997 道题，七种题型（单选 267 / 多选 183 / 判断 205 / 填空 118 / 简答 143 / 代码 54 / 论述 27），可以按考点和难度筛 |
| 项目闯关 | 给一份能跑但没写完的工程骨架，在应用内的编辑器里补完，点「跑测试」看检查点是否通过。关卡按顺序解锁，参考答案要通关后才给 |
| 错题本 | 按作答记录实时算出来，可按板块筛，单条移除或清空当前筛选。历史记录不删，再答错会重新出现，也能一键「练这个考点」 |
| 闭卷考试 | 限时组卷，中途可以暂停。交卷后出成绩报告，主观题支持自评和 AI 批改 |
| 知识图谱 | 450 个考点之间有 1809 条关系边（进阶 230 / 依存 80 / 平行 79 / 易混对比 49 / 印证 110 / 关联 816，另有 445 条层级归属）。每个考点有掌握状态和前置门槛，关系可以按类型分开看 |
| FSRS 间隔重复 | 按遗忘曲线排复习时间，错题权重自动加重 |
| 自适应摸底 | 沿前置链往上探，定位真实水平，给出从哪开始学 |
| AI 私教 | 用本地小模型（llama.cpp）多轮答疑。讲解时注入当前题目的标准解析，生成后再校验有没有编出材料里不存在的 API |
| 知识体系 | 考点讲义以 Markdown 为源文件，带来源与复核标记，同步进 SQLite FTS5（中文按二字词分词，bm25 字段加权）。目前有 3 篇 |
| 数据面板 | 考点掌握分布、各板块掌握度和近 30 天正确率。另有最弱题型、AI 用量和高频错题 |
| 题库与版本 | 缺什么补什么：AI 按图谱节点出题，先存整目录快照，再逐节点出题，最后重建索引。版本时间线可以一键回滚，脏题单独排队 |
| 游戏化 | 经验值、等级和徽章，另有连续打卡记录 |

## 项目闯关（34 个项目 / 120 关）

题看不进去的时候可以换个入口，先写一个能跑的小东西。

- 每个项目是一串线性关卡。每关给一份能跑但没写完的工程骨架，`TODO` 标到具体行，用户在应用里的编辑器里补完，点「跑测试」看这一关的检查点是不是都过了。
- 阅读顺序固定为 目标 → 为什么 → 前置知识 → API 契约 → 分步 → 提示。「前置知识」讲这一关用到的概念，配可运行的小例子。「API 契约」给出函数签名和参数含义，也写清返回值和调用示例，照着就能写。
- 120 关合计 358 个分步、1663 个检查点。分步卡片上的「定位」按钮直接把光标跳到编辑器里对应的 `TODO`，右栏顶部实时显示还剩几个 `TODO`。
- 判题在主进程的 `vm` 沙箱里跑，超时 4 秒，没有 `require` 和 `fs`。用户代码和测试源码都不进渲染进程，断言不会泄漏。
- 检查点全过才算通关，通关后才下发参考解。上一关没过，下一关既点不进去，后端也拒绝执行。
- 草稿写到一半切走会自动保存，回来接着写。内容改版后旧草稿自动失效，因为草稿绑定了骨架指纹。

按技术方向分成五栏，一个 stack 一个项目，一个 topic 一章关：

| 方向 | 项目 · 关数 |
| --- | --- |
| 前端（12 个项目 / 47 关 / 161 个知识点） | 从零写一个响应式内核（9）· 前端双线：uni-app 跨端与 Vue3 内核（5）· 浏览器运行时与构建链（4）· CSS 规则引擎：从层叠到布局求解（4）· 前端网络层：从 ES6+ 到传输与加载优化（4）· Electron 桌面端：进程边界、安全分发与文档表单（3）· JS 内核：数据结构、类型系统与执行模型（3）· 前端性能与类型系统：从指标到渲染再到类型（3）· Vue3 三关：实例代理、组件通信、生命周期与状态（3）· Vue3 深水区：状态、路由、性能与生态（3）· 手写日常工具箱（3）· 从零写一个 Promise（3） |
| 后端（7 个项目 / 23 关 / 75 个知识点） | 服务端运行时：从事件循环到 MVC 分发（4）· Redis 缓存闯关（4）· Java 数据结构、核心机制与并发（3）· JVM、微服务治理与分布式通信（3）· MySQL 与消息队列（3）· 从零写一个一致性哈希环（3）· 从零读懂 HTTP 报文（3） |
| 公共基础（9 个项目 / 32 关 / 120 个知识点） | 算法范式与系统设计：从排序到削峰（5）· 系统设计与 DevOps：限流熔断、短链、容器与流水线（5）· 系统与安全：IO、Linux、Web、认证、密码学（5）· 网络与可观测性：预算、协议栈、DNS（4）· 从零写一个 AC 自动机（3）· 算法三连：复杂度、树、图（3）· 操作系统：调度、同步、虚拟内存（3）· 手写 LRU 缓存（3）· 安全工程：分类、审计、规则匹配（1） |
| AI Agent（5 个项目 / 14 关 / 33 个知识点） | 最小可运行的 Agent 循环（3）· 评测、编排与上下文工程（3）· 记忆、检索与推理服务（3）· 从零写一个混合检索器（3）· 工具调用与微调取舍（2） |
| 工程难题（1 个项目 / 4 关 / 13 个知识点） | 事故复盘：从溢出到死循环的四次现场（4） |

每个关卡在 `nodes` 里声明它讲透的知识点，第一个是主知识点，决定章节归属。项目列表顶部有覆盖总览，402 个 L3/L4 节点已全部有关卡对应，缺口为零。覆盖口径、机检方式和内容增删后的补齐路线见 [项目闯关 · 知识图谱覆盖](docs/design/PROJECT-COVERAGE.md)。

内容源在 `content/projects-src/*.mjs`，用模板字符串写每步的代码、测试和参考解，构建时序列化成 `content/projects/*.json` 给主进程读。改完内容跑这些命令：

```bash
npm run project:build            # 构建 + 校验：结构 / domain / nodes 合法性 / 每步答案（过本步、不过下一步）/ finalCode / 参考解全绿 / 骨架必红，末尾打印覆盖率
npm run project:check            # 只校验已构建的 JSON（CI 用）
npm run project:coverage         # 覆盖率报表（按领域 / 技术栈）；加 -- --gaps 看未覆盖清单，--check --min=100 设门槛
npm run project:audit            # 内容质量审计：每关步数、每步检查点数、nodes 数量与规划单是否一致
npm run project:plan -- --write  # 图谱节点增删后重算「项目 → 关 → nodes」规划草案
```

新增一个项目等于在 `content/projects-src/` 里加一个带 `domain` 的 `.mjs` 文件，不用碰产品代码。字段契约见 [项目闯关关卡规范](docs/design/PROJECT-LEVELS.md)，质量线和迁移配方见 [项目闯关内容生产手册](docs/project-authoring.md)。

## 技术栈

- 桌面壳：Electron 45 + electron-vite
- 前端：Vue 3 + TypeScript + naive-ui + Pinia + Vue Router。编辑器用 Monaco Editor，图表用 ECharts，图谱用 Vue Flow
- 存储：Node.js 内置的 `node:sqlite`，不需要编译原生模块。全文检索用 FTS5
- 本地推理：llama.cpp 的 OpenAI 兼容 HTTP 接口，支持纯 CPU 或 Vulkan / CUDA 加速
- 中文检索：自己写的分词（单字加相邻二字组合）配 `bm25()` 字段加权。FTS5 自带的 `unicode61` 对中文不分词，「路由」这类两字术语会搜不到

## 快速开始

需要 Node.js 22 以上（用到内置 `node:sqlite`，开发时用 24.x）。Windows、macOS 和 Linux 都能跑。

```bash
npm install
npm run seed      # 把 content/ 下的题库、图谱、讲义灌进 data/app.db
npm run dev       # 启动开发模式（Vite + Electron）
```

其他脚本：

```bash
npm run build     # 构建产物到 out/
npm run typecheck # vue-tsc + tsc 双段类型检查
npm run qa        # 回归测试
npm run kb:index  # 讲义 Markdown 增量同步进 FTS5 索引（--check-only / --force）
npm run kb:build  # 按考点采集来源并起草讲义（需要模型；--dry / --no-ai 可只抓来源）
```

### 多开

Electron 的单实例锁和 Chromium profile 都绑在 userData 目录上。两个进程共用一个目录时，第二个窗口要么被锁踢掉，要么争抢 profile 起不来。所以多开的前提是每个实例有独立的身份：

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

数据目录默认共用 `data/`，题库和进度共享。要连数据一起隔离，加 `--own-data`：

```bash
node scripts/dev.mjs --instance=2 --own-data   # 数据写到 data/instances/2
```

和别的 Electron 项目同时跑也没问题，只要那个项目不硬编码 5173 / 9222 这两个端口。本项目的渲染端口被占用时会自动顺延，主进程用 electron-vite 注入的 `ELECTRON_RENDERER_URL` 取地址，不写死端口。

想验证多开是否正常，运行 `node scripts/qa/multi-instance-check.mjs 9222 9223`，脚本会逐个连 CDP，检查列表页与第 1 关卡页都能渲染、IPC 通。

## 本地模型（不随仓库分发）

模型文件有 1 到 3 GB，不放进仓库。程序在第一次调用 AI 私教时才懒启动本地推理服务，所以要先把模型和运行时准备好。

**自动下载。** 运行 `npm run tutor:fetch`，脚本会下载 llama.cpp 运行时（约 24 MB）和推荐模型（约 2.8 GB）到模型目录。

**手动放置。** 把 llama.cpp 的 `llama-server` 可执行文件和 GGUF 模型放进模型目录：Windows 是 `D:/model/forge-tutor/`，macOS 和 Linux 是 `~/.forge-tutor/`。

推荐模型：

| 模型 | 量化 | 体积 | 资源建议 | 适用 |
| --- | --- | --- | --- | --- |
| Qwen3.8-4B-Distill | Q4_K_M | 约 2.8 GB | 全量上卡要 4.6 GB 以上空闲显存，纯 CPU 建议 6 GB 以上可用内存 | 主力，答疑质量较好 |
| LFM3-1.7B | Q4_K_M | 约 1.1 GB | 2.6 GB 以上空闲显存，纯 CPU 建议 3 GB 以上可用内存 | 轻量，低配机器可用 |

模型目录必须是纯 ASCII 路径，Windows 下 llama.cpp 读不了含中文的路径。

### 推理模式与运行时

默认自动判定。检测到 NVIDIA 显卡并且空闲显存够，就全量上卡（`--n-gpu-layers 99`）。显存不够就退回纯 CPU（`--n-gpu-layers 0`，不占显存）。设置页可以在自动 / 强制 GPU / 强制 CPU 之间切换，并直接说明这次判定的理由。

GPU 后端有两种运行时，体积差 19 倍，能力接近：

| 运行时 | 体积 | 适用 |
| --- | --- | --- |
| Vulkan（推荐） | 36 MB | NVIDIA / AMD / Intel 通用，不用装 CUDA 运行时 |
| CUDA | 305 MB + 373 MB cudart | 仅 NVIDIA，追求极限吞吐时才值得这个体积 |
| CPU | 24 MB | 不占显存，所有机器可用 |

```bash
npm run tutor:fetch -- --runtime=vulkan   # 下载 Vulkan 运行时（36MB）
npm run tutor:fetch -- --runtime=cuda     # 下载 CUDA 运行时（约 678MB）
```

设置页会列出可选模型（4B 主力 / 1.7B 轻量）和各运行时是否就绪，缺依赖时给出可以直接复制的下载命令。

参考速度：i7-13700KF 纯 CPU 跑 Q4_K_M 大约 13 到 17 tok/s，一道短答题的完整回答通常 4 到 16 秒。

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
| `FORGE_INSTANCE` | 实例号（多开用），隔离 userData、日志和 CDP 端口 | 未设置（默认实例） |
| `FORGE_RESEED` | 设为 `1` 强制重灌题库 | 未设置 |
| `DEEPSEEK_BASE_URL` | 「换云端重答」用的 OpenAI 兼容地址 | `https://api.deepseek.com/v1` |

## 项目结构

```
src/
  main/          主进程：窗口、IPC、SQLite、AI 网关、本地模型托管
    ai/          gateway.ts（多端点路由）/ tutor-model.ts（llama.cpp 懒启动）/ model-registry.ts（模型与运行时清单）
    services/    practice / exam / graph / srs / mastery / explain / knowledge / project / bank / insights …
  preload/       预加载脚本，暴露类型化 IPC
  renderer/      Vue 3 前端（今日、练习、项目闯关、图谱、考试、错题、面板、题库版本、设置）
  shared/        主进程与渲染进程共用：schema、分词、引用校验、项目覆盖口径等纯函数
content/
  questions/     题库 JSON
  nodes/         知识图谱节点（450 个）
  knowledge/     考点讲义 Markdown
  projects-src/  项目内容源（.mjs）
  projects/      项目构建产物（.json，不要手改）
scripts/         灌库、项目构建 / 覆盖 / 审计、QA 与探针脚本
docs/            设计文档与运维说明
```

## 数据与隐私

- 学习数据都在本地 SQLite（`data/app.db`），不上传服务器。
- 默认离线可跑。做题和图谱不需要网络，复习排期在本地算，AI 答疑也走本地模型。
- 只有点「换云端重答」时才会调用外部 API，Key 自己配，通过环境变量传入。

## 已知限制

- 本地 4B 模型能力有限，适合短答和逐步引导，不适合一次性写长篇教程。长讲解建议用「换云端重答」。
- 考点讲义（`content/knowledge/`）现在只有 3 篇，采集和起草靠 `npm run kb:build`，覆盖面还在补。
- 项目关卡跑在没有依赖的 `vm` 沙箱里，装不了真实依赖也连不了网，内容偏手写核心机制，不做整框架集成。
- 没做代码签名和安装包分发，macOS 第一次运行需要手动放行。
- 题库和项目内容由 AI 辅助生成并人工审校，不能保证零错误。发现错题请在 issue 里指出。

## 文档

- [知识体系设计](docs/design/KNOWLEDGE-SYSTEM.md)
- [项目闯关关卡规范](docs/design/PROJECT-LEVELS.md)
- [项目闯关 · 知识图谱覆盖](docs/design/PROJECT-COVERAGE.md)
- [项目闯关内容生产手册](docs/project-authoring.md)
- [题库生产指南](docs/content-production-guide.md)
- [数据契约](docs/data-contracts.md)
- [本地模型服务运维](docs/ops/local-model-service.md)

## 许可

[MIT](LICENSE)