/**
 * 项目闯关内容质量审计：构建全绿 ≠ 内容够厚。
 *
 * 构建器管的是「能不能跑」（字段、参考解、每步答案、骨架），这个脚本管「值不值得学」：
 *   - 关数/步数/检查点数是否达到规范下限（每关 ≥3 步、每步 ≥4 check、每关 ≥12 check）
 *   - nodes 是否 1~6 个、存在、不重复
 *   - 该项目的 nodes 并集是否与 data/plans/<slug>.json 的分配**完全一致**（漏一个 = 覆盖缺口）
 *
 * 用法：
 *   node scripts/project-audit.mjs            # 全量审计
 *   node scripts/project-audit.mjs --only=be-java
 *   node scripts/project-audit.mjs --strict   # 有 warning 也退出非零（发版前用）
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const projDir = join(root, 'content', 'projects')
const nodesDir = join(root, 'content', 'nodes')
const planDir = join(root, 'data', 'plans')
const args = process.argv.slice(2)
const only = args.find((a) => a.startsWith('--only='))?.slice('--only='.length)
const strict = args.includes('--strict')

/* 图谱 id 集合 */
const graph = new Set()
for (const rel of readdirSync(nodesDir, { recursive: true })) {
  if (typeof rel !== 'string' || !rel.endsWith('.json') || rel.endsWith('_skeleton.json')) continue
  try {
    const data = JSON.parse(readFileSync(join(nodesDir, rel), 'utf8'))
    const list = Array.isArray(data) ? data : data?.nodes
    if (Array.isArray(list)) for (const n of list) if (n?.id) graph.add(n.id)
  } catch { /* ignore */ }
}

/* 规划分配 */
const plans = new Map()
if (existsSync(planDir)) {
  for (const f of readdirSync(planDir)) {
    if (!f.endsWith('.json')) continue
    try {
      const p = JSON.parse(readFileSync(join(planDir, f), 'utf8'))
      plans.set(p.slug, new Set(p.levels.flatMap((l) => l.nodes)))
    } catch { /* ignore */ }
  }
}

const rows = []
let errors = 0
let warns = 0
const err = (slug, msg) => { errors++; rows.push({ slug, level: 'err', msg }) }
const warn = (slug, msg) => { warns++; rows.push({ slug, level: 'warn', msg }) }

const countCheck = (src) => (String(src ?? '').match(/\bcheck\s*\(/g) ?? []).length

for (const f of readdirSync(projDir).sort()) {
  if (!f.endsWith('.json')) continue
  const p = JSON.parse(readFileSync(join(projDir, f), 'utf8'))
  if (only && p.id !== only) continue
  const slug = p.id
  const levels = p.levels ?? []

  if (levels.length < 2) warn(slug, `只有 ${levels.length} 关——项目至少 2 关才像「项目」`)

  const allNodes = new Set()
  for (const [i, lv] of levels.entries()) {
    const tag = `第 ${i + 1} 关`
    const nodeList = lv.nodes ?? []
    if (!nodeList.length) err(slug, `${tag} 没写 nodes`)
    if (nodeList.length > 6) warn(slug, `${tag} 挂了 ${nodeList.length} 个 nodes（>6 通常说明这关设计太大）`)
    for (const id of nodeList) {
      if (!graph.has(id)) err(slug, `${tag} 的 node 不存在：${id}`)
      // 同一关内重复是构建器拦的错；跨关重复是允许的（同一知识点换角度再讲一遍）
      allNodes.add(id)
    }

    const stages = lv.stages ?? []
    if (stages.length < 3) warn(slug, `${tag} 只有 ${stages.length} 步（规范 ≥3）`)
    if (stages.length > 4) warn(slug, `${tag} 有 ${stages.length} 步（规范 3~4）`)
    let total = 0
    for (const st of stages) {
      const n = countCheck(st.test)
      total += n
      if (n < 4) warn(slug, `${tag} 第 ${st.n} 步只有 ${n} 个 check（规范 ≥4）`)
    }
    if (total < 12) warn(slug, `${tag} 总共 ${total} 个 check（规范 ≥12）`)
    // tests 是整关测试，允许比各步之和多（整关有专属的集成检查点），但不能少
    if (countCheck(lv.tests) < total) err(slug, `${tag} 的 tests（${countCheck(lv.tests)}）少于各步 check 之和（${total}），整关自检会漏跑`)
    if (!lv.finalCode) err(slug, `${tag} 缺 finalCode`)
    if (!lv.usage) err(slug, `${tag} 缺 usage`)
  }

  const want = plans.get(slug)
  if (want) {
    const missing = [...want].filter((id) => !allNodes.has(id))
    const extra = [...allNodes].filter((id) => !want.has(id))
    if (missing.length) err(slug, `漏了分配里的 ${missing.length} 个 node：${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ' …' : ''}`)
    if (extra.length) warn(slug, `多收了分配外的 ${extra.length} 个 node：${extra.slice(0, 4).join(', ')}`)
  } /* 老项目没有规划分配时跳过覆盖核对 */

  const steps = levels.reduce((a, lv) => a + (lv.stages?.length ?? 0), 0)
  const checks = levels.reduce((a, lv) => a + countCheck(lv.tests), 0)
  rows.push({ slug, level: 'info', msg: `${levels.length} 关 / ${steps} 步 / ${checks} check / ${allNodes.size} node` })
}

/* 打印 */
const infos = rows.filter((r) => r.level === 'info')
const errs = rows.filter((r) => r.level === 'err')
const warnRows = rows.filter((r) => r.level === 'warn')
console.log('项目闯关 · 内容质量审计\n')
for (const r of infos) console.log(`  ✓ ${r.slug.padEnd(18)} ${r.msg}`)
if (warnRows.length) {
  console.log('\n警告：')
  for (const r of warnRows) console.log(`  ! ${r.slug}: ${r.msg}`)
}
if (errs.length) {
  console.log('\n错误：')
  for (const r of errs) console.log(`  ✗ ${r.slug}: ${r.msg}`)
}
console.log(`\n合计 ${infos.length} 个项目，${errors} 个错误，${warns} 个警告`)
process.exit(errors || (strict && warns) ? 1 : 0)