# 面试熔炉 · Interview Forge

> 一个完全跑在本机的面试训练客户端：题库练习、闭卷考试、知识图谱、间隔重复，外加一个**能引用题库原文**的 AI 私教。

面试准备最常见的困境不是"没题做"，而是**题做错了不知道为什么错、看了解析还是不懂**。这个项目的核心思路是：

- 把 997 道题、450 个考点及其前置关系组织成一张可导航的知识图谱，而不是一堆散装题目；
- 让 AI 讲解时**必须基于题库里的标准解析**（FTS5 检索注入），并在生成后校验是否出现了材料里没有的 API；
- 所有数据留在本地 SQLite，不联网也能跑完整流程。

## 功能

| 模块 | 说明 |
| --- | --- |
| **题库练习** | 997 道题、7 种题型（单选/多选/判断/填空/简答/代码/论述），按考点与难度筛 |
| **闭卷考试** | 限时组卷、中途暂停、自评与 AI 批改，交卷后出成绩报告 |
| **知识图谱** | 450 个考点、1300+ 条关系边（进阶门槛 `advance` / 理解地基 `depend` / 平行 / 易混对比 / 类比 / 印证） |
| **FSRS 间隔重复** | 按遗忘曲线排期复习，错题自动加重权重 |
| **自适应摸底** | 沿前置链探测，定位真实水平，输出「从哪开始学」 |
| **AI 私教答疑** | 本地小模型（llama.cpp）多轮答疑，带作用域护栏；讲解时注入**当前题目的标准解析**，生成后做引用校验 |
| **知识体系** | 考点正文以 Markdown 管理，索引进 SQLite FTS5（中文二字词分词 + bm25 字段加权） |
| **游戏化** | XP / 等级 / 徽章 / 连续打卡 |

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

### 推理模式

默认**自动检测**：发现可用 NVIDIA GPU 且显存足够时全量上卡（`--n-gpu-layers 99`），否则退回纯 CPU（`--n-gpu-layers 0`，零显存占用）。也可以在设置里强制指定 CPU / GPU。

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
| `FORGE_RESEED` | 设为 `1` 强制重灌题库 | 未设置 |
| `DEEPSEEK_BASE_URL` | 「换云端重答」用的 OpenAI 兼容地址 | `https://api.deepseek.com/v1` |

## 项目结构

```
src/
  main/          主进程：窗口、IPC、SQLite、AI 网关、本地模型托管
    ai/          gateway.ts（多端点路由）/ tutor-model.ts（llama.cpp 懒启动）
    services/    explain.ts（私教答疑）/ knowledge.ts（知识检索）/ question-retrieval.ts（题目检索）
  preload/       预加载脚本，暴露类型化 IPC
  renderer/      Vue 3 前端
  shared/        主进程与渲染进程共用：schema、分词、校验等纯函数
content/         题库内容（JSON）：questions / nodes / knowledge / variants
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
- [本地模型服务运维](docs/ops/local-model-service.md)
- [题库生产指南](docs/content-production-guide.md)
- [数据契约](docs/data-contracts.md)

## 许可

[MIT](LICENSE)