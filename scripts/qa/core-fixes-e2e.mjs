// 核心功能修复端到端验收（CDP 驱动真实应用，无需手动点 UI）：
//  1) bank.update 不再因 SQL 保留字崩溃，且能为 noSubjective 节点定向补主观题
//  2) knowledge.generate 对"只缺尾部两节"的草稿能自动补齐并入库（不再一律进 _stale）
//  3) 跨域（fe / be）讲义生成状态与索引同步
import { Cdp } from './cdp.mjs'
import { DatabaseSync } from 'node:sqlite'

const cdp = await Cdp.connect()
const J = (label, v) => console.log(`\n### ${label}\n` + JSON.stringify(v, null, 1).slice(0, 1800))
const dbPath = 'data/app.db'

const gaps1 = await cdp.evaluate(`return await window.forge.bank.gaps({perNodeTarget:3})`, { timeoutMs: 30000 })
J('① 修复前缺口', { empty: gaps1.empty.length, thin: gaps1.thin.length, noSubjective: (gaps1.noSubjective ?? []).length })

console.log('\n>>> bank.update（maxNodes=3，验证 SQL 修复 + 主观题定向，约 2-6 分钟）…')
const t0 = Date.now()
let upd
try {
  upd = await cdp.evaluate(`return await window.forge.bank.update({domains:[], perNodeTarget:3, maxNodes:3, note:''})`, { timeoutMs: 1100000 })
} catch (e) {
  upd = { ok: false, added: 0, retired: 0, error: String(e?.message ?? e) }
}
J(`② AI 更新题库（${((Date.now() - t0) / 1000).toFixed(0)}s）`, {
  ok: upd.ok, added: upd.added, retired: upd.retired, error: upd.error,
  targets: upd.report?.targets, notes: (upd.report?.notes ?? []).slice(0, 3)
})

if (upd.added > 0) {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  const fresh = db.prepare(`SELECT node_id, json_extract(data,'$.type') t, substr(json_extract(data,'$.stem'),1,30) stem
    FROM questions WHERE json_extract(data,'$.source.note')='bank_update 自动生成' ORDER BY created_at DESC LIMIT 6`).all()
  const subj = fresh.filter((f) => ['short', 'essay', 'code'].includes(f.t)).length
  J('②b 新增题题型核对', { total: fresh.length, 主观题: subj, rows: fresh })
  db.close()
}

const kb1 = await cdp.evaluate(`return await window.forge.knowledge.status()`, { timeoutMs: 20000 })
J('③ 讲义现状（生成前）', { total: kb1.total, missingBody: kb1.missingBody })

for (const [id, label] of [['fe.css.box.bfc', '前端·BFC'], ['be.java.dsa.hash', '后端·HashMap']]) {
  console.log(`\n>>> knowledge.generate ${label}（约 2-4 分钟/篇，超时不重试、来源已压载）…`)
  const t1 = Date.now()
  const g = await cdp.evaluate(`return await window.forge.knowledge.generate(${JSON.stringify(id)}, {force:true})`, { timeoutMs: 560000 })
  J(`④ 单点生成 ${label}（${((Date.now() - t1) / 1000).toFixed(0)}s）`, { status: g.status, words: g.words, sources: g.sources, flags: g.flags, repaired: g.repaired, error: g.error })
  const entry = await cdp.evaluate(`return await window.forge.knowledge.get(${JSON.stringify(id)})`, { timeoutMs: 20000 })
  J(`⑤ 抽屉读取 ${label}`, { missing: entry.missing, words: entry.wordCount, confidence: entry.confidence, sources: entry.sources?.length })
}

const kb2 = await cdp.evaluate(`return await window.forge.knowledge.status()`, { timeoutMs: 20000 })
const gaps2 = await cdp.evaluate(`return await window.forge.bank.gaps({perNodeTarget:3})`, { timeoutMs: 30000 })
const stats2 = await cdp.evaluate(`return await window.forge.bank.stats()`, { timeoutMs: 20000 })
J('⑥ 最终状态', {
  bankQuestions: stats2.questions,
  gaps: { empty: gaps2.empty.length, thin: gaps2.thin.length, noSubjective: (gaps2.noSubjective ?? []).length },
  knowledge: { total: kb2.total, missingBody: kb2.missingBody }
})

await cdp.evaluate(`location.hash = '#/bank'; return true`, { timeoutMs: 5000 })
await new Promise((r) => setTimeout(r, 3500))
const shot = await cdp.shot('data/e2e-bank-after-fix.png')
console.log('\n截图:', shot)
process.exit(0)
