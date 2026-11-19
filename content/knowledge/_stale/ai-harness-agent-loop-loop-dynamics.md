<!-- gate failed: missing-section:关键结论; missing-section:常见误区; missing-section:常见问法; missing-section:前置知识; missing-section:相关 -->
---
node: ai.harness.agent-loop.loop-dynamics
title: Agent 循环动态：终止条件、停滞与护栏
sources:
  - url: https://arxiv.org/abs/2201.11903
    title: Chain-of-Thought Prompting Elicits Reasoning in Large Language Models
    kind: official
  - url: https://python.langchain.com/docs/introduction/
    title: LangChain overview - Docs by LangChain
    kind: official
  - url: https://ollama.com/search
    title: Ollama search
    kind: official
updated: 2026-06-17
generator: kb-draft@1
reviewed: false
confidence: medium
---

## 一句话本质

Agent 循环动态，就是模型在“推理—调用工具—观察结果—再推理”的循环里如何继续、何时停止、怎样避免失控；参考材料给出的核心事实是：中间推理步骤能显著提升复杂任务表现，而生产级 Agent 不只是模型本身，而是“模型 + harness”，即围绕模型循环的 prompt、tools 和 middleware 共同决定行为边界 [^1][^2]。

## 为什么需要它

如果只让模型一次性回答，复杂任务容易缺少可展开的推理路径；Chain-of-Thought 论文指出，生成一系列中间推理步骤会显著提升大语言模型完成复杂推理任务的能力，并且这种能力会在足够大的模型中通过少量思维链示例自然出现 [^1]。这说明 Agent 需要“多步推进”的能力。

但多步推进会带来新问题：每一步都可能消耗上下文、时间、成本和外部动作权限。LangChain 文档把 Agent 定义为 `Model + Harness`，并明确 harness 是模型循环之外的一切：prompt、tools，以及塑造行为的 middleware [^2]。因此，循环动态不是模型内部自动保证的，而是由 harness 设计出来的。实际讨论里问终止条件、停滞检测、预算和护栏，本质上是在问：你如何把“自由推理”变成可控工程系统。

## 机制讲清楚

先看最小循环。一个可运行的 Agent 可以只有模型、工具和系统提示。下面代码来自 LangChain 文档示例，展示 `create_agent` 如何把模型、工具和 system_prompt 组合起来，并通过 `invoke` 传入用户消息 [^2]：

```python
from langchain.agents import create_agent

def get_weather(city: str) -> str:
    """Get weather for a given city."""
    return f"It's always sunny in {city}!"

agent = create_agent(
    model="openai:gpt-6.1-sol",
    tools=[get_weather],
    system_prompt="You are a helpful assistant",
)

result = agent.invoke(
    {"messages": [{"role": "user", "content": "What's the weather in San Francisco?"}]}
)

print(result["messages"][-1].content_blocks)
```

这个例子里，`get_weather` 是 tool，`system_prompt` 是 prompt，`create_agent` 是 harness 入口。模型是否调用工具、调用后如何继续，都发生在 harness 管理的循环里 [^2]。

再看推理步骤的作用。CoT 论文的关键事实是：提供少量 chain of thought 示例，可以让模型生成中间推理步骤，从而提升算术、常识和符号推理任务表现；例如 540B 参数模型用八个思维链示例在 GSM8K 上达到 SOTA，甚至超过带 verifier 的微调 GPT-3 [^1]。映射到 Agent 循环，这意味着“先想再做”不是装饰，而是提高复杂任务成功率的重要机制。

现代 tool-use loop 可以把“想”理解为模型生成下一步计划或选择工具，把“做”理解为调用 tool，把“看”理解为 tool 返回 observation，再把 observation 放回上下文继续推理。LangChain 文档没有给出每个内部状态名，但它明确说 harness 包含 prompt、tools 和 middleware，并支持 OpenAI、Anthropic、Google 等模型 [^2]。这说明循环控制点通常不在模型权重里，而在 harness 的配置和中间件里。

关于终止与护栏，参考材料没有直接列出 max turns、token budget、cost budget、time budget 这些字段名，因此不能把它们当作具体 API 事实。但可以依据 LangChain 对 harness 的定义推出：如果要限制循环，就要在模型循环之外加入 middleware 或 orchestration 层。LangChain 文档还区分了不同层级：`create_agent` 是高度可定制 harness；LangGraph 是低层编排框架，用于结合确定性和 agentic workflow；Deep Agents 提供 context compression、virtual filesystem、subagents 等生产化能力；LangSmith 用于 tracing、debugging、evaluation，LangSmith Engine 还能监控 traces、检测问题并提出修复建议 [^2]。这些能力分别对应循环动态里的观测、评估、压缩上下文、子任务拆分和问题发现。

停滞检测也可以从同一逻辑理解。若 Agent 反复调用同一个工具、反复得到相似 observation、或者没有产生有效进展，就需要 harness 识别并干预。参考材料没有给出具体算法，但 LangSmith 的 trace/debug/evaluate 和 Engine 的 issues detection 说明：停滞不是靠感觉判断，而是要基于轨迹、状态和评估信号来定位 [^2]。

危险动作确认门同样属于 harness 问题。工具可能改变外部世界，因此是否允许执行、是否需要确认、是否要人工升级，应由 tools 与 middleware 的组合策略决定。