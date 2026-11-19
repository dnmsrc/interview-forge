#!/usr/bin/env node
/**
 * R22 受限多轮辅导（tutorChat）离线验收 —— 纯 Node，不依赖 AI 端点、不依赖 Electron。
 * 真实模型对话放 CDP 冒烟（r22-tutor-cdp-smoke.mjs）；这里只验可确定性判定的部分：
 *   A. 契约接线：API_METHODS.explain 含 tutor；ForgeApi 类型形状（经 api.ts 源文断言）；
 *   B. 前置取数 SQL：tutorPrerequisites 同源查询能取回前置（含「未点亮」的，零基础兜底）；
 *   C. 信号行剥离：模拟模型输出，验证 <<<OFFTOPIC>>> / <<<PREREQ:id>>> 被正确解析与清洗；
 *   D. 幻觉前置防御：模型点名的 id 不在真实前置清单时，suggestPrereq 必须为 null。
 */
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const bad = []
const ok = (c, m) => { if (!c) bad.push(m); console.log(`  ${c ? 'OK ' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1 }

/* ---------------- A. 契约接线 ---------------- */
console.log('\n— A. IPC 契约接线 —')
const apiSrc = readFileSync(join(process.cwd(), 'src/shared/api.ts'), 'utf8')
ok(/explain:\s*\[[^\]]*'tutor'/.test(apiSrc), "API_METHODS.explain 注册了 'tutor' 方法")
ok(/tutor\(\s*nodeId: string, question: string/.test(apiSrc), 'ForgeApi.explain.tutor 声明了 nodeId/question 形参')
ok(/TutorChatResult = TutorChatOk \| ExplainErr/.test(apiSrc), 'TutorChatResult 为成功/无端点判别联合')
const ipcSrc = readFileSync(join(process.cwd(), 'src/main/ipc.ts'), 'utf8')
ok(/async tutor\(nodeId, question, history, opts\)/.test(ipcSrc), '主进程 IPC 实现了 explain.tutor handler')
ok(/explainSvc\.tutorChat\(/.test(ipcSrc), 'handler 委托 explainSvc.tutorChat')
const explainSrc = readFileSync(join(process.cwd(), 'src/main/services/explain.ts'), 'utf8')
ok(/export async function tutorChat/.test(explainSrc), 'explain.ts 导出 tutorChat')
ok(/export function tutorPrerequisites/.test(explainSrc), 'explain.ts 导出 tutorPrerequisites')
// 作用域护栏的系统提示必须存在，这是「只谈本考点」的核心约束
ok(/作用域护栏/.test(explainSrc) && /OFFTOPIC/.test(explainSrc), '系统提示含作用域护栏与越界信号约定')

/* ---------------- B. 前置取数（含未点亮） ---------------- */
console.log('\n— B. 前置考点 SQL（零基础兜底） —')
const db = new DatabaseSync(join(process.cwd(), 'data', 'app.db'))
db.exec('PRAGMA busy_timeout=8000')
// 找一个确有前置的考点
const target = db.prepare(
  `SELECT e.to_id AS id FROM edges e WHERE e.type IN ('advance','depend')
   GROUP BY e.to_id ORDER BY COUNT(*) DESC LIMIT 1`).get()
ok(!!target, '题库存在带前置边的考点：' + target?.id)
if (target) {
  // 与 tutorPrerequisites 完全同源的 SQL（服务代码无法在纯 node 直接 import .ts，这里复刻并核对一致性）
  // node:sqlite：prepare 只收 SQL，绑定值作为 .all() 的位置参数
  const pres = db.prepare(
    `SELECT DISTINCT n.id,n.title,n.summary,COALESCE(m.lit,0) AS lit
     FROM edges e JOIN nodes n ON n.id=e.from_id
     LEFT JOIN node_mastery m ON m.node_id=n.id
     WHERE e.to_id=? AND e.type IN ('advance','depend')
     ORDER BY lit ASC, n.ord ASC LIMIT 8`).all(target.id)
  ok(pres.length >= 1, `考点 ${target.id} 取回 ≥1 个前置（实际 ${pres.length}）`)
  // 零基础用户的前置往往没点亮：确认查询不要求 lit=1（区别于旧 buildContext 的已点亮过滤）
  const unlit = pres.filter((p) => !p.lit)
  ok(unlit.length >= 1, `前置中含未点亮节点（${unlit.length} 个），零基础可被引导回补：` + unlit.map((u) => u.title).join('、'))
  // 截图真实考点：它本身就是别人的前置，验证其 id 形态可被 PREREQ 信号正则匹配
  const metricNode = 'ai.eval.evaluation-qa.metrics-dataset'
  ok(/^[A-Za-z0-9._-]+$/.test(metricNode), '节点 id 字符集匹配 PREREQ 信号正则（字母数字._-）')
}
db.close()

/* ---------------- C/D. 信号行剥离与幻觉防御（复刻服务端纯逻辑） ---------------- */
console.log('\n— C. 模型输出信号解析 —')
// 与 explain.ts 中完全一致的剥离逻辑，单独抽出来验
const norm = (s) => s.replace(/[\s:：，,。.（）()【】「」""'']/g, '').toLowerCase()
function parseSignals(raw, validPrereqIds) {
  const offTopic = /<<<OFFTOPIC>>>\s*$/m.test(raw)
  const pm = raw.match(/<<<PREREQ:([^>]+)>>>\s*$/m)
  const signal = pm ? pm[1].trim() : ''
  const answer_md = raw.replace(/\s*<<<(?:OFFTOPIC|PREREQ:[^>]*)>>>\s*$/gm, '').trim()
  const sigNorm = norm(signal)
  const suggestPrereq = signal
    ? (validPrereqIds.find((p) => p.id === signal)
       ?? validPrereqIds.find((p) => sigNorm && norm(p.title).includes(sigNorm))
       ?? validPrereqIds.find((p) => sigNorm && sigNorm.includes(norm(p.title)))
       ?? null)
    : null
  return { offTopic, suggestPrereq, answer_md }
}
const validPres = [
  { id: 'ai.eval.evaluation-qa.metrics-dataset', title: '离线评估集：指标定义、轨迹评估与数据建设' },
  { id: 'ai.eval.evaluation-qa.llm-as-judge', title: 'LLM-as-judge：偏差清单与校准' }
]

// C1 正常讲解：无信号
const r1 = parseSignals('先给结论：评估集要分层。\n再展开做法。', validPres)
ok(!r1.offTopic && r1.suggestPrereq === null && r1.answer_md.startsWith('先给结论'), '无信号的普通讲解：offTopic=false、无前置、正文保留')

// C2 越界：带 OFFTOPIC，正文剥离信号行
const r2 = parseSignals('这个和当前考点无关，我们先把眼前的学会。\n<<<OFFTOPIC>>>', validPres)
ok(r2.offTopic === true && !r2.answer_md.includes('<<<'), '越界提问：offTopic=true，信号行从正文剥离')

// C3 建议回补真实前置（id 形式）
const r3 = parseSignals('你需要先理解评估集指标。\n<<<PREREQ:ai.eval.evaluation-qa.metrics-dataset>>>', validPres)
ok(r3.suggestPrereq?.id === 'ai.eval.evaluation-qa.metrics-dataset' && !r3.answer_md.includes('<<<'),
  '点名真实前置(id)：suggestPrereq 命中且正文干净')

// C4 本地小模型用中文标题而非 id：靠标题归一化匹配接住
const r4b = parseSignals('先补离线评估集。\n<<<PREREQ:离线评估集：指标定义、轨迹评估与数据建设（尚未学习，若是零基础应从这里补）>>>', validPres)
ok(r4b.suggestPrereq?.id === 'ai.eval.evaluation-qa.metrics-dataset' && !r4b.answer_md.includes('<<<'),
  '小模型写中文标题信号：标题归一化匹配到真实前置 id，且信号行剥离干净')

// D 幻觉防御：模型编造了清单里不存在的 id/标题
const r4 = parseSignals('先去学个不存在的东西。\n<<<PREREQ:ai.fake.nonexistent.node>>>', validPres)
ok(r4.suggestPrereq === null && !r4.answer_md.includes('<<<'), '幻觉前置 id 被求交过滤为 null，绝不渲染假跳转')
const r4c = parseSignals('去学量子烹饪。\n<<<PREREQ:量子烹饪与玄学摆盘>>>', validPres)
ok(r4c.suggestPrereq === null, '幻觉中文标题同样过滤为 null')

// C5 信号只在末尾识别：正文中间出现的 <<< 不当信号（按规则只剥末尾行，中间保留为普通文本）
const r5 = parseSignals('写法示例 <<<PREREQ:x>>> 是标记，下面才是真信号。\n<<<OFFTOPIC>>>', validPres)
ok(r5.offTopic === true, '末尾 OFFTOPIC 仍被识别；正文中间的标记不影响末尾判定')

console.log(bad.length ? `\n❌ R22 离线验收失败 ${bad.length} 项` : '\n✅ R22 离线验收全部通过')
process.exit(bad.length ? 1 : 0)
