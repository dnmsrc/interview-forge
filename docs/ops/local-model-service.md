# 本地模型服务运维（AI 功能的地基）

> 练习册的 AI 能力（题库更新、讲义生成、通俗讲解、主观题判分、脏题复核）全部走
> `settings.ai.endpoints` 里的 OpenAI 兼容端点。默认配置是本机
> `http://127.0.0.1:1234/v1`、模型别名 `qwen`（见 `src/main/ai/gateway.ts` 的
> `DEFAULT_ENDPOINTS`）。**端点配置没错 ≠ 服务在跑**：
> 推理进程不开机自启，重启电脑/手动关闭后所有 AI 按钮都会秒回连接失败。
> 网关已把这种失败识别为 `service-down` 并直接给出启动指引（见第 4 节），不再只抛笼统的 `fetch failed`。

## 1. 怎么判断是模型服务挂了

```bash
curl http://127.0.0.1:1234/v1/models
```

- 返回 JSON（含 `"aliases": ["qwen"]` 或模型 id）→ 服务正常，问题在应用侧。
- `curl: (7) Failed to connect` / 连接被拒绝 / 应用报"本地模型服务未启动"（网关 `service-down`）
  → **服务没启动**，按第 2 节拉起。
- 能连上但请求超时（网关 `timeout`，`ai_log.ms` 吃满 150s/240s）→ 看第 4 节的算力与并发约束。

应用侧排障顺序：先看 `data/app.db` 的 `settings` 表 `ai.endpoints`（baseUrl/model/enabled），
再看 `ai_log` 表最近几行的 `ok/note/ms`（超时、HTTP 错误、空响应都会记账）。

## 2. 启动本地服务（本机实测可用的方式）

本机推理栈是 **Strata 引擎 + Qwen3.8-Flash-Next（IQ2_XS / IQ3_S 量化）**，不是 LM Studio：

```powershell
cd D:\model\Strata
.\.venv\Scripts\python.exe serve\server.py `
  --engine strata `
  --config strata-abliterated-iq3_s-256k-vision.json `
  --port 1234
```

历史启动脚本（等价）：`D:\model\backups\pre-update-20261022\run-*.bat`，
轻量纯文本档可用 `run-iq2_xs.bat`（同端口 1234）。配置里的 `aliases: "qwen"`
必须与应用 `ai.endpoints` 的 `model: "qwen"` 对应。

启动后终端出现 `ready: http://127.0.0.1:1234/v1` 才算完成；加载 35B MoE 权重
（约 55 GB 进内存）需要 1-3 分钟，期间 `curl /v1/models` 会连接失败，属正常。

冒烟验证（**用英文，Windows 终端的中文会被按 GBK 编码导致服务端 UTF-8 报错**）：

```bash
curl http://127.0.0.1:1234/v1/chat/completions -H "content-type: application/json" \
  -d '{"model":"qwen","messages":[{"role":"user","content":"Reply OK"}],"max_tokens":50}'
```

## 3. 应用里的超时与重试约定（改参数前先看这里）

这些数字是用 `ai_log` 的真实耗时校准的（2026-11），不要凭感觉调：

| 任务 | 成功均值 | 超时上限 | 重试策略 | 依据 |
| --- | --- | --- | --- | --- |
| `bank_update` 出题 | ~78s | 150s | 超时**不**重试，仅 HTTP/网络瞬时错误重试 1 次 | 重试同样重 payload 必然再超时，一次失败从 90s 变 180s |
| `kb_draft` 讲义 | ~121s | 240s | 同上 | 长文生成，150s 会把快完成的输出打断 |
| `:repair` JSON 修复 | 排版任务 | 60s 封顶 | 仅在抢救函数也失败时才触发 | 见下 |

- **批量讲义默认串行（concurrency=1）**：实测并发 2 时两个请求抢同一块 GPU 算力，
  双双 150s 超时（0 篇成功）。只有接了远程独立端点才适合 `--concurrency 2+`。
- 输出 JSON 被 `max_tokens` 截断时，先走 `salvageElements()` 逐元素抢救已闭合的题，
  救不回才发 `:repair`；讲义缺尾部小节先走 `ensureTailSections`（零成本补双链），
  再走一次 `completeMissingSections` 续写，而不是整篇重跑。

## 4. 常见故障清单

1. **服务没起（秒级报错，`ai_log.ms` 只有几百毫秒）**：网关把 `ECONNREFUSED` /
   `fetch failed`（含 undici 嵌套在 `error.cause` 里的形态）统一识别为 `kind=service-down`，
   本地端点直接返回启动指引与 `curl .../v1/models` 排查命令，且**不重试**（没人监听，重试只会再秒拒）。
   按第 2 节启动，确认端口 1234 在监听（`netstat -ano | findstr 1234`）。
   分类规则是纯函数 `src/shared/ai-error-core.mjs`，单测 `scripts/qa/ai-error-classify.test.mjs`。
2. **`'utf-8' codec can't decode byte ...`**：请求体不是 UTF-8。检查调用方是否用
   Node `fetch`（应用内都是，正常）；手工 curl 冒烟只用英文 payload 或用 `--data-binary @file.json`。
3. **大量"请求超时（150000ms / 240000ms）"**：服务在跑但算力跟不上。先确认没有第二个并发批量在跑；
   再看 `nvidia-smi` 显存是否被别的进程占满（Strata 日志里 `no VRAM is left` 会降级到纯内存，速度暴跌）。
   2026-11-15 实测：服务已 `loaded` 但重负载下 `bank_update` 连吃 3 次 150s、`kb_draft` 连吃 2 次 240s
   超时——此时服务没挂，是单请求生成太久，应降低输入体量或换更强端点，而不是重启服务。
4. **`content: null` + `finish_reason: length`**：`max_tokens` 太小，输出被推理过程
   （reasoning_content）吃光。应用内各任务已给到 1200-4000，不要往下调。
5. **模型返回空内容（`kind=empty`）**：网关会重试一次；连续失败在 `ai_log.ok=0` 留痕，先重启模型服务再怀疑代码。
6. **讲义一直 `no-official`**：不是模型问题，是来源通道。跑
   `node scripts/qa/kb-source-probe.mjs 6 3` 看各域可起草率；换网络环境（挂代理/换机器）
   后必须重跑 `scripts/qa/reach-probe*.mjs` 重建 `UNREACHABLE_HOSTS` 与 `HINT_SOURCES`。

## 5. 网关错误分类与重试约定（`ai-error-core.mjs`）

`chat()` 捕获异常后统一过 `classifyError()`，按 `kind` 决定是否重试，错误对象上挂 `err.kind`：

| kind | 触发场景 | retryable | 处理 |
| --- | --- | --- | --- |
| `service-down` | 连接被拒 / DNS 失败 / 服务没起 | 否 | 本地给启动指引，远程给网络排查；不重试 |
| `timeout` | AbortController 到点 | 否 | 重 payload 再试必再超时，直接失败 |
| `http` | 非 2xx 响应 | 是 | 间隔 800ms 重试 1 次 |
| `empty` | 模型返回空串 | 是 | 重试 1 次 |
| `network` | 其它瞬时网络错误 | 是 | 保留原始信息，重试 1 次 |

改动分类规则后必须跑 `node scripts/qa/ai-error-classify.test.mjs`（16 项断言，覆盖 undici
嵌套 cause、两层 cause、AbortError、本地/远程差异、非法 URL 兜底）。
