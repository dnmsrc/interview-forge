#!/usr/bin/env node
/**
 * R19 一次性批量标注 learnFirst=true（幂等、带 id 白名单校验）。
 * 只处理「材料齐备、且确属不读特定资料无法推理」的高置信题；
 * 材料缺失的题不在此列，需先补 resources 再单独标注。
 * 做法：解析 JSON → 按 id 命中 → 置 learnFirst=true → 原格式（2 空格缩进）写回。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const Q = 'content/questions'
// id → 题目文件（白名单，双重校验，防止误标）
const TARGETS = {
  'Q-ai-harness-pos-0001': 'ai/harness/agent-loop.json',
  'Q-ai-harness-loop-0005': 'ai/harness/agent-loop.json',
  'Q-ai-rag-eval-0007': 'ai/rag/retrieval-pipeline.json',
  'Q-ai-tools-parallel-0002': 'ai/tools/tool-calling.json',
  'Q-ai-tools-mcp-blank-0007': 'ai/tools/tool-calling.json',
  'Q-ai-train-lora-0001': 'ai/train/finetune-vs-rag.json',
  'Q-ai-eval-mtbench-0004': 'ai/eval/evaluation-qa.json',
  'Q-ai-rag-chunk-0001': 'ai/rag/retrieval-pipeline.json',
  'Q-ai-tools-mcp-0004': 'ai/tools/tool-calling.json'
}

const byFile = {}
for (const [id, rel] of Object.entries(TARGETS)) (byFile[rel] ??= []).push(id)

let done = 0
for (const [rel, ids] of Object.entries(byFile)) {
  const path = join(process.cwd(), Q, rel)
  const arr = JSON.parse(readFileSync(path, 'utf8'))
  for (const q of arr) {
    if (!ids.includes(q.id)) continue
    const hasMat = Array.isArray(q.resources) && q.resources.some((r) => r.digest && String(r.digest).length > 30)
    if (!hasMat) { console.log(`跳过(材料不齐)：${q.id} @ ${rel}`); continue }
    if (q.learnFirst === true) { console.log(`已标注过，跳过：${q.id}`); continue }
    q.learnFirst = true
    done++
    console.log(`标注 learnFirst=true：${q.id} @ ${rel}`)
  }
  writeFileSync(path, JSON.stringify(arr, null, 2) + '\n', 'utf8')
}
console.log(`\n完成，本次新增标注 ${done} 道（含此前手工标注的 vLLM 题应为全量 9 道高置信题）`)
