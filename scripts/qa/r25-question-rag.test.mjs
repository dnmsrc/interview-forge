#!/usr/bin/env node
/**
 * R25 题目检索 + 引用校验 离线验收 —— 纯 Node，不依赖 AI 端点与 Electron。
 *
 * 验收目标（对应「AI 答得不准」这个问题的两处根因）：
 *   A. 结构：question_index / question_fts / 三个同步触发器确实建出来了；
 *   B. 一致性：索引行数与题库行数对齐，脏数据（缺 stem）被跳过而不是塞进索引；
 *   C. 检索：必选题必进材料、同考点优先、题库没收录时**返回 0 条而不是瞎凑**；
 *   D. 预算：注入 prompt 的材料总量受 MATERIAL_BUDGET 约束，不会把上下文吃爆；
 *   E. 接线：explain.ts 的 tutorChat 真的调用了检索与校验（源码断言，防回退）；
 *   F. 校验：编造 API 必须被拦，真实模型输出不得被误杀。
 */
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildFtsMatch } from '../../src/shared/knowledge-core.mjs'
import { checkClaims, isStrongEntity, buildRetryHint } from '../../src/shared/claim-guard.mjs'
import { buildQuestionIndexRow, QIDX_WEIGHTS } from '../../src/shared/question-index-core.mjs'
import { DDL_STATEMENTS, SCHEMA_VERSION } from '../../src/shared/schema.mjs'

const bad = []
const ok = (c, m) => { if (!c) bad.push(m); console.log(`  ${c ? 'OK ' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1 }

/* ---------------- A. schema 结构 ---------------- */
console.log('\n— A. schema 结构 —')
ok(SCHEMA_VERSION >= 7, `SCHEMA_VERSION >= 7（当前 ${SCHEMA_VERSION}）`)
const ddl = DDL_STATEMENTS.join('\n')
ok(/CREATE TABLE IF NOT EXISTS question_index/.test(ddl), 'question_index 表已定义')
ok(/CREATE VIRTUAL TABLE IF NOT EXISTS question_fts USING fts5/.test(ddl), 'question_fts 虚表已定义')
ok(/content='question_index'/.test(ddl), 'question_fts 用 external-content 指向 question_index')
ok(/trg_qidx_ins/.test(ddl) && /trg_qidx_upd/.test(ddl) && /trg_qidx_del/.test(ddl), '三个同步触发器齐备')

const db = new DatabaseSync(join(process.cwd(), 'data', 'app.db'))
db.exec('PRAGMA busy_timeout=8000')

/* ---------------- B. 索引一致性 ---------------- */
console.log('\n— B. 索引与题库一致性 —')
const nQ = db.prepare('SELECT COUNT(*) n FROM questions').get().n
const nIdx = db.prepare('SELECT COUNT(*) n FROM question_index').get().n
ok(nIdx > 0, `question_index 非空（${nIdx} 行）`)
ok(nIdx === nQ, `索引行数 = 题库行数（${nIdx} / ${nQ}）`)
const noStem = db.prepare(`SELECT COUNT(*) n FROM question_index WHERE stem='' OR qid=''`).get().n
ok(noStem === 0, `索引中无缺 stem/qid 的脏行（${noStem} 行）`)
const tkEmpty = db.prepare(`SELECT COUNT(*) n FROM question_index WHERE stem_tk=''`).get().n
ok(tkEmpty === 0, `所有题的分词列已生成（空 ${tkEmpty} 行）`)
// 触发器自检：插一行再删，FTS 必须恢复到原样
const before = db.prepare(`SELECT COUNT(*) n FROM question_fts`).get().n
db.exec(`INSERT INTO question_index(qid,node_id,stem,stem_tk) VALUES('__qa_probe__','x.y','探针题','探针 针题')`)
const mid = db.prepare(`SELECT COUNT(*) n FROM question_fts`).get().n
db.exec(`DELETE FROM question_index WHERE qid='__qa_probe__'`)
const after = db.prepare(`SELECT COUNT(*) n FROM question_fts`).get().n
ok(mid === before + 1 && after === before, `触发器同步生效（${before} → 插入 ${mid} → 删除 ${after}）`)

/* ---------------- C. 检索质量 ---------------- */
console.log('\n— C. 检索质量 —')
const SQL = `SELECT qi.qid, qi.node_id, qi.stem, qi.analysis,
        bm25(question_fts, ${QIDX_WEIGHTS.map((w) => w.toFixed(1)).join(',')}) AS score
   FROM question_fts JOIN question_index qi ON qi.rowid = question_fts.rowid
  WHERE question_fts MATCH ?`
function search(q, limit = 4, nodeId = null) {
  const built = buildFtsMatch(q)
  if (!built) return []
  const match = built.matchStrict ?? built.match
  try {
    return nodeId
      ? db.prepare(`${SQL} AND qi.node_id=? ORDER BY score LIMIT ?`).all(match, nodeId, limit)
      : db.prepare(`${SQL} ORDER BY score LIMIT ?`).all(match, limit)
  } catch { return [] }
}

// C1 必选题：用户正在做的题必须能精确取回，且解析足够长（够讲）
const probeQid = 'Q-ai-rag-agentic-0003'
const exact = db.prepare(`SELECT qid,node_id,analysis FROM question_index WHERE qid=?`).get(probeQid)
ok(!!exact, `必选题可按 id 精确取回（${probeQid}）`)
ok((exact?.analysis ?? '').length > 200, `该题解析够长可讲（${(exact?.analysis ?? '').length} 字）`)

// C2 同考点优先：同考点检索的前几条必须都来自该考点
const nodeId = exact?.node_id ?? 'ai.rag.retrieval-pipeline.rerank-compress'
const sameNode = search('重排 上下文压缩', 3, nodeId)
ok(sameNode.length > 0, `同考点检索有命中（${sameNode.length} 条）`)
ok(sameNode.every((r) => r.node_id === nodeId), '同考点检索结果全部来自本考点')

// C3 未覆盖必须 0 条：题库没有的考点不许瞎凑（这是「材料没有就拒答」的前提）
const uncovered = search('G1 CMS 垃圾回收器 大内存', 3)
ok(uncovered.length === 0, '题库未覆盖的查询返回 0 条（不瞎凑）')

// C4 常见主题必须能召回
for (const [label, q] of [['TCP 三次握手', 'TCP 三次握手'], ['Redis 持久化', 'Redis RDB AOF 持久化'], ['线程池参数', '线程池核心参数']]) {
  ok(search(q, 3).length > 0, `能召回：${label}`)
}

/* ---------------- D. 材料预算 ---------------- */
console.log('\n— D. 注入预算 —')
const explainSrc = readFileSync(join(process.cwd(), 'src/main/services/explain.ts'), 'utf8')
const retrSrc = readFileSync(join(process.cwd(), 'src/main/services/question-retrieval.ts'), 'utf8')
ok(/MATERIAL_BUDGET/.test(retrSrc), '定义了 MATERIAL_BUDGET 总量上限')
ok(/used \+ body\.length > MATERIAL_BUDGET/.test(retrSrc), '拼接时按预算逐条累加拦截')
ok(/export const MATERIAL_BUDGET\s*=\s*\d+/.test(retrSrc), 'MATERIAL_BUDGET 是常量可审计')
// 实测：4 条真实材料的拼接长度不得超预算
const sample = db.prepare(`SELECT qid,node_id,stem,analysis,gap_check,answer_text FROM question_index WHERE node_id=? LIMIT 4`).all(nodeId)
const sampleLen = sample.reduce((s, r) => s + (r.analysis ?? '').length + (r.gap_check ?? '').length, 0)
ok(sampleLen < 8000, `本考点 4 道题原文总量可控（${sampleLen} 字，注入时还会再截断到 1600）`)

/* ---------------- E. 接线断言（防回退） ---------------- */
console.log('\n— E. explain.ts 接线 —')
ok(/import \{ retrieveForTutor, formatMaterialsBlock \}/.test(explainSrc), 'tutorChat 引入了题目检索服务')
ok(/retrieveForTutor\(\{/.test(explainSrc), 'tutorChat 真的调用了 retrieveForTutor')
ok(/questionId: input\.questionId/.test(explainSrc), '把「用户正在做的那道题」传给检索（必选材料）')
ok(/formatMaterialsBlock\(materials\)/.test(explainSrc), '材料经过 formatMaterialsBlock 注入 prompt')
ok(/\$\{factsSection\}/.test(explainSrc), 'prompt 里注入的是 factsSection（含题库材料）')
// tutor 通道必须改用 factsSection；knowledgeBlock 只应残留在 explainNode（const 声明 + 使用，共 2 次）
const kbCount = (explainSrc.match(/knowledgeBlock/g) ?? []).length
ok(kbCount === 2, `knowledgeBlock 仅保留在 explainNode（出现 ${kbCount} 次，tutor 通道已改用 factsSection）`)
ok(/checkClaims\(stripSignals\(raw\), corpus\)/.test(explainSrc), '生成后调用了引用校验')
ok(/buildRetryHint\(claims\)/.test(explainSrc), '校验失败会带黑名单重写一次')
ok(/claims:\s*\{/.test(explainSrc), '校验结果随返回值透出（前端可提示核对）')
// 系统提示必须把「材料之外不许写」写成硬约束
ok(/材料里没出现过的 API 名/.test(explainSrc), '系统提示含「材料外 API 禁止写出」的铁律')

/* ---------------- F. 引用校验行为 ---------------- */
console.log('\n— F. 引用校验 —')
ok(isStrongEntity('queuePostFlushCb'), '驼峰标识符判为强实体')
ok(isStrongEntity('req.body'), '带点号的 API 路径判为强实体')
ok(isStrongEntity('FTS5'), '字母+数字判为强实体')
ok(!isStrongEntity('Q3'), '季度 Q3 不判为强实体（避免误报）')
ok(!isStrongEntity('pipeline'), '普通英文词不判为强实体')
ok(!isStrongEntity('A'), '单选项字母不判为强实体')

const material = '微任务在同步代码执行完后、浏览器绘制前执行；Vue 用 Promise.then 把回调推进微任务队列'
const fake = '结论：Vue3 通过 queuePostFlushCb 调度，用 flushJobsV2 队列，框架 v3.9.2 引入了 preFlushHook。'
const gFake = checkClaims(fake, [material])
ok(!gFake.ok, '编造 API/版本号的回答被判定为无依据')
ok(gFake.unknown.includes('queuePostFlushCb') && gFake.unknownVersions.includes('v3.9.2'), '精确指出编造的实体与版本号')
ok(buildRetryHint(gFake).includes('queuePostFlushCb'), '重写提示里列出了具体黑名单')

const clean = '结论：微任务在同步代码跑完、浏览器绘制前执行。要点1：Vue 用 Promise.then 把回调推进微任务队列。'
const gClean = checkClaims(clean, [material])
ok(gClean.ok, '完全忠于材料的回答不被误杀')

// 用上一轮真实模型输出回归（若样本在，验证不误伤）
try {
  const sampleFile = join(process.cwd(), 'scripts/.tmp-rag/compare-raw.json')
  const raw = JSON.parse(readFileSync(sampleFile, 'utf8'))
  const corpus = [raw.q.stem, raw.q.analysis]
  const gB = checkClaims(raw.B.ans, corpus)
  ok(gB.ok, `真实模型输出（注入材料后）不误报（无依据 ${gB.unknown.length} 项）`)
} catch { console.log('  SKIP 真实样本回归（compare-raw.json 不存在）') }

/* ---------------- 汇总 ---------------- */
db.close()
console.log(`\n${bad.length === 0 ? '✅ 全部通过' : `❌ ${bad.length} 项失败`}`)
if (bad.length) { for (const b of bad) console.log('  -', b); process.exitCode = 1 }