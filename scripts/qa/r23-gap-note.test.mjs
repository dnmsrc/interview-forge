#!/usr/bin/env node
/**
 * R23「我不会」输入框直接提交 —— 离线验收（纯 Node，不依赖 AI 端点 / Electron / GUI）。
 *
 * 修的问题：摸底页「我不会」区提供了输入框，但真正能提交的只有三个快捷卡片，
 * 用户打了一大段「不知道 AST 是什么」却按不下提交 —— 输入框形同摆设。
 *
 * 这里验可确定性判定的部分：
 *   A. 契约接线：API_METHODS.placement 含 interpretGap；服务/主进程/前端三处接好；
 *   B. 规则分类：直接 import shared/gap-rules.mjs（与服务同一份实现）跑真实用例；
 *   C. AI 输出归一化：模型回 JSON / 裸枚举 / 中文标签 / 带解释长句都要吃得下；
 *   D. 前端交互：输入框自带提交按钮、Ctrl+Enter、三卡片定位为「不想打字」的快捷方式。
 * 真实点击提交与落库见 r23-gap-note-cdp-smoke.mjs。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { classifyGapNote, normalizeGapKind } from '../../src/shared/gap-rules.mjs'

const bad = []
const ok = (c, m) => { if (!c) bad.push(m); console.log(`  ${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1 }

/* ---------------- A. 契约接线 ---------------- */
console.log('\n— A. 契约接线（共享类型 / 主进程 / 前端） —')
const apiSrc = readFileSync(join(process.cwd(), 'src/shared/api.ts'), 'utf8')
const ipcSrc = readFileSync(join(process.cwd(), 'src/main/ipc.ts'), 'utf8')
const svcSrc = readFileSync(join(process.cwd(), 'src/main/services/placement.ts'), 'utf8')
const viewSrc = readFileSync(join(process.cwd(), 'src/renderer/src/views/PlacementView.vue'), 'utf8')

ok(/placement:\s*\[[^\]]*'interpretGap'/.test(apiSrc), "API_METHODS.placement 注册了 'interpretGap'（preload 会自动生成同名桥接）")
ok(/interpretGap\(note: string, nodeId\?: string \| null\): Promise<GapInterpret>/.test(apiSrc), 'ForgeApi.placement.interpretGap 声明了 note/nodeId 形参与 GapInterpret 返回')
ok(/interface GapInterpret\s*\{[^}]*gapType: 'concept' \| 'code' \| 'skip'/.test(apiSrc), 'GapInterpret 的 gapType 是三值联���（不含 guess）')
ok(/source: 'rule' \| 'ai' \| 'fallback'/.test(apiSrc), 'GapInterpret 标了判定来源 rule/ai/fallback（误判可追溯）')
ok(/async interpretGap\(note, nodeId\)\s*\{[^}]*placementSvc\.interpretGapNote\(/.test(ipcSrc), '主进程 ipc 实现 interpretGap 并委托 placementSvc.interpretGapNote')
ok(/export async function interpretGapNote\(/.test(svcSrc), 'placement.ts 导出 interpretGapNote')
ok(/import .* from '\.\.\/\.\.\/shared\/gap-rules\.mjs'/.test(svcSrc), '服务改用 shared/gap-rules.mjs 的规则实现（与测试同源，不各写一份）')
ok(/export function classifyGapNote/.test(svcSrc) && /export function normalizeGapKind/.test(svcSrc), '服务仍导出两个纯函数供上层/诊断复用')
// 落库：原话必须写进 gap_note，缺口报告才能既按类型聚合又保留用户原话
ok(/gapNote: note/.test(viewSrc) || /gapNote: note \?\?/.test(viewSrc), '前端把用户原话作为 gap_note 提交')

/* ---------------- B. 规则分类（与服务同一份实现） ---------------- */
console.log('\n— B. 中文强信号规则（真实用例） —')
const cases = [
  // [描述, 期望, 说明]
  ['我不知道 AST 是什么，sourcemap 是什么。模板字符串的概念我也模糊了。', 'concept', '截图原话：知识态缺失 → 知识点不懂'],
  ['不知道 Proxy 为什么能拦截删除属性', 'concept', '不知道某原理 → concept'],
  ['这个原理我根本没学过', 'concept', '没学过 → concept'],
  ['完全看不懂它在问啥', 'concept', '看不懂 → concept'],
  ['原理大概懂，但让我写就写不出来', 'code', '写不出来 → 手写短板'],
  ['给我白板手写一个防抖函数我就不行', 'code', '白板/手写 → code'],
  ['这段代码我自己敲不出来', 'code', '敲不出来 → code'],
  ['这题先跳过吧，我还没复习到', 'skip', '跳过 → skip（优先级最高）'],
  ['算了这题不做了', 'skip', '算了/不做 → skip'],
  ['这题我完全不会', null, '没有类型信号（只有「不会」）→ 交 AI 判'],
  ['Vue4 的这些东西我们团队不用', null, '纯业务背景描述 → 交 AI 判'],
  ['', null, '空描述 → null（前端按钮本应禁用，IPC 直调由服务抛错兜住）']
]
for (const [note, want, why] of cases) {
  const got = classifyGapNote(note)
  ok(got === want, `${why}：期望 ${String(want)}，实际 ${String(got)} ｜ ${note.slice(0, 26) || '（空）'}`)
}

/* ---------------- C. AI 输出归一化 ---------------- */
console.log('\n— C. AI 输出归一化（模型输出不稳的兜底） —')
const normCases = [
  ['{"gapType":"concept"}', 'concept', '标准 JSON'],
  ['{"gapType":"code"}', 'code', '标准 JSON(code)'],
  ['```json\n{"gapType":"skip"}\n```', 'skip', '带 markdown 代码块'],
  ['concept', 'concept', '裸英文枚举'],
  ['CODE', 'code', '大写枚举'],
  ['知识点不懂', 'concept', '中文标签'],
  ['不会手写代码', 'code', '中文标签(code)'],
  ['直接跳过', 'skip', '中文标签(skip)'],
  ['我认为属于 gapType: concept，因为用户没学过', 'concept', '夹在解释长句里'],
  ['完全没头绪', null, '无法归一化 → null（服务落到 fallback=concept）'],
  ['', null, '空输出 → null']
]
for (const [raw, want, why] of normCases) {
  const got = normalizeGapKind(raw)
  ok(got === want, `${why}：期望 ${String(want)}，实际 ${String(got)}`)
}

/* ---------------- D. 前端交互约束 ---------------- */
console.log('\n— D. 前端：输入框是主路径，三卡片是快捷方式 —')
ok(/data-testid="pl-gap-send"/.test(viewSrc), '输入框下方有独立提交按钮（pl-gap-send）')
ok(/@click="submitNote"/.test(viewSrc), '提交按钮绑定 submitNote')
ok(/@keydown\.ctrl\.enter\.prevent="submitNote"/.test(viewSrc), 'Ctrl+Enter 可直接提交（中文输入法下普通 Enter 不误触）')
ok(/:disabled="!gapNote\.trim\(\) \|\| busy"/.test(viewSrc), '说明为空时按钮禁用（有字即可提交，不再要求先选三卡片）')
ok(/async function submitNote\(/.test(viewSrc) && /ipc\.placement\.interpretGap\(note, item\.value\.node_id\)/.test(viewSrc), 'submitNote 先调 interpretGap 判类型，再带原话提交')
ok(/await doGapSubmit\(r\.gapType, r\.note \|\| note\)/.test(viewSrc), '判定结果与用户原话一起走同一条落库路径')
ok(/不想打字？直接选一类/.test(viewSrc), '三卡片上方文案点明它只是「不想打字」的快捷方式')
ok(!/占位|可选：补充一句你哪里不懂/.test(viewSrc), '输入框占位文案不再自称「可选补充」（避免继续误导）')
// 三卡片与说明走同一落库函数，保证两条路径行为一致（类型由点选决定 vs 由语义判定决定）
ok(/async function doGapSubmit\(type: GapType, note: string \| null\)/.test(viewSrc), '两条提交路径共用 doGapSubmit，避免逻辑分叉')
ok(/async function submitGap\(type: GapType\)\s*\{[\s\S]{0,160}doGapSubmit\(type, gapNote\.value\.trim\(\) \|\| null\)/.test(viewSrc), '快捷卡片提交时也会带上框里写的说明')
// 提交前打开「我不会」区的入口仍然在，且先学后测题未被锁死
ok(/showGap = !showGap/.test(viewSrc), '「我不会」仍是打开该区域的入口')

console.log(`\n${bad.length ? `✗ ${bad.length} 项未通过` : '✓ 全部通过'} ｜ 规则用例 ${cases.length} 条 · 归一化 ${normCases.length} 条`)
if (bad.length) { console.log('\n失败项：'); bad.forEach((m) => console.log(' - ' + m)) }
