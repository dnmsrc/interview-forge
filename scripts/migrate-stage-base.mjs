/**
 * 一次性数据迁移：把 project_progress.stage_base 换成「新算法」的指纹。
 *
 * 为什么需要它：
 *   stage_base 以前把「步骤号 + 标题 + 参考代码 + 测试全文」一起 hash。
 *   这次修了两个判定（__setCount / __deleteCount 只核对增量，不再绑死初始值），
 *   测试全文变了一个字，旧 stage_base 就全部对不上，用户过了的步骤会被整份作废——
 *   而实际通过的代码在新判定下依然通过（新判定只会更宽）。
 *
 *   新的 stage_base 只认「步骤号 + 标题 + 检查点名字」这些结构性信息（见
 *   src/main/services/project.ts 的 stageHash）。对没改过内容的其他项目，
 *   迁移等于换个哈希写法，进度含义不变。
 *
 * 另外清掉 mini-vue-reactivity / lv1 被误记的 stage_fails：
 *   旧逻辑拿「上一步的参考代码」当基线，手写实现永远对不上，于是每次从第 3 步
 *   推进到第 4 步都会白记一次失败。那一笔不是用户的错，删掉。
 *
 * 用法：
 *   node scripts/migrate-stage-base.mjs --dry    # 只看会改什么
 *   node scripts/migrate-stage-base.mjs          # 真的写库（先关掉 App）
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const root = join(import.meta.dirname, '..')
const dry = process.argv.includes('--dry')

/** 与 src/main/services/project.ts 的 baseHash 保持一致 */
function baseHash(s) {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h.toString(36)
}
/** 与 project.ts 的 caseNamesOf 保持一致 */
function caseNamesOf(test) {
  return [...String(test ?? '').matchAll(/check\(\s*['"`]([^'"`]*)['"`]/g)].map((m) => m[1])
}
function stageHash(stages) {
  if (!stages?.length) return ''
  return baseHash(stages.map((s) => `${s.n}|${s.title}|${caseNamesOf(s.test).join(',')}`).join('\n'))
}

/** project_id → level_id → 新指纹 */
const newBase = new Map()
const dir = join(root, 'content', 'projects')
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
  const p = JSON.parse(readFileSync(join(dir, f), 'utf8'))
  const byLevel = new Map()
  for (const lv of p.levels ?? []) {
    const h = stageHash(lv.stages)
    if (h) byLevel.set(lv.id, h)
  }
  newBase.set(p.id, byLevel)
}

const db = new DatabaseSync(join(root, 'data', 'app.db'))
db.exec('PRAGMA busy_timeout=4000;')
const rows = db.prepare(
  `SELECT project_id, level_id, stage_done, stage_base, stage_fails, answer_steps FROM project_progress`
).all()

let changed = 0
const updates = []
for (const r of rows) {
  const want = newBase.get(r.project_id)?.get(r.level_id)
  if (!want) continue
  const fixes = []
  if (r.stage_base !== want) fixes.push(want)
  else fixes.push(r.stage_base)
  // mini-vue lv1：那条 {"4":1} 是旧逻辑的假账，见文件头
  let fails = r.stage_fails
  if (r.project_id === 'mini-vue-reactivity' && r.level_id === 'lv1' && fails) {
    console.log(`   · lv1 stage_fails ${fails} → NULL（旧逻辑把「刚推进到第 4 步」误记成一次失败）`)
    fails = null
  }
  const same = fixes[0] === r.stage_base && fails === r.stage_fails
  if (!same) {
    changed++
    updates.push({ pid: r.project_id, lid: r.level_id, from: r.stage_base, to: fixes[0], fails })
    console.log(`   · ${r.project_id}/${r.level_id}: stage_base ${r.stage_base} → ${fixes[0]}` +
      (r.stage_done ? `（保留 stage_done=${r.stage_done}）` : '（stage_done 为空，无需保留）'))
  }
}

console.log(`\n共 ${rows.length} 行进度，需要改 ${changed} 行${dry ? '（--dry，不写库）' : ''}`)
if (!dry && changed) {
  const up = db.prepare(
    `UPDATE project_progress SET stage_base=?, stage_fails=?, updated_at=datetime('now','localtime')
     WHERE project_id=? AND level_id=?`
  )
  for (const u of updates) up.run(u.to, u.fails, u.pid, u.lid)
  console.log('✓ 已写入')
}
db.close()