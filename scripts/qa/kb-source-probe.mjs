// 来源命中率探测：不接 AI、不改库，只统计各域考点能否拿到「≥1 官方源 + ≥2 可抓取正文」。
// 决定批量铺讲义前还需不需要继续扩 sitemap / DOC_HINTS / 白名单。
import { DatabaseSync } from 'node:sqlite'
import { officialHits, fetchText, kindOf, searchWeb } from '../kb-draft-core.mjs'

const db = new DatabaseSync('data/app.db', { readOnly: true })
const SAMPLE_PER_DOMAIN = Number(process.argv[2] ?? 8)
const concurrency = Number(process.argv[3] ?? 3)

const rows = db.prepare(`SELECT id,title,domain FROM nodes WHERE level=4 AND status='active' ORDER BY domain, must_master DESC, ord ASC`).all()
db.close()
const byDomain = {}
for (const r of rows) (byDomain[r.domain] ??= []).push(r)

async function probe(node) {
  // 与 buildDraft 同口径：官方 sitemap/语义映射 + Bing 普通检索合并后按域名判 kind
  const hits = await officialHits(node)
  const extra = await searchWeb(`${node.title} 原理 源码`)
  const seen = new Set()
  const merged = []
  for (const h of [...hits, ...extra]) {
    if (seen.has(h.url)) continue
    seen.add(h.url)
    merged.push({ ...h, kind: kindOf(h.url) })
  }
  const officialCount = merged.filter((h) => h.kind === 'official').length
  // 实测两篇能否真抓到正文（与 buildDraft 的 fetch 门槛一致）
  let fetched = 0
  for (const h of merged.slice(0, 3)) {
    if (await fetchText(h.url)) fetched++
  }
  const pass = officialCount > 0 && fetched >= 2
  return { id: node.id, official: officialCount, total: merged.length, fetched, pass }
}

for (const [domain, list] of Object.entries(byDomain)) {
  const sample = list.slice(0, SAMPLE_PER_DOMAIN)
  const results = []
  let cur = 0
  async function w() { while (cur < sample.length) results.push(await probe(sample[cur++])) }
  await Promise.all(Array.from({ length: Math.min(concurrency, sample.length) }, w))
  const ok = results.filter((r) => r.pass).length
  const noOff = results.filter((r) => r.official === 0).map((r) => r.id)
  const thin = results.filter((r) => r.official > 0 && !r.pass).map((r) => r.id)
  console.log(`${domain}: ${ok}/${results.length} 可起草 | 无官方源 ${noOff.length} [${noOff.slice(0, 4).join(', ')}] | 有源但抓不满 ${thin.length} [${thin.slice(0, 4).join(', ')}]`)
  for (const r of results.filter((x) => !x.pass).slice(0, 6)) console.log(`   ✗ ${r.id} official=${r.official} total=${r.total} fetched=${r.fetched}`)
}
console.log('\n探测完成')
