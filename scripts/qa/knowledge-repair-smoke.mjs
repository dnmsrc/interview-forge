// 离线验证修补链：拿真实未过闸草稿（缺尾部两节），不调 AI，只看机器补齐能否过闸。
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { parseKnowledgeMd } from '../../src/shared/knowledge-core.mjs'
import { ensureTailSections, ensureMetaAndSources, qualityGate } from '../kb-draft-core.mjs'

const db = new DatabaseSync('data/app.db', { readOnly: true })
const nodeId = process.argv[2] ?? 'fe.css.box.bfc'
const node = db.prepare(`SELECT id,title,summary FROM nodes WHERE id=?`).get(nodeId)
const validNodeIds = new Set(db.prepare(`SELECT id FROM nodes`).all().map((r) => r.id))
const prereqIds = db.prepare(`SELECT from_id FROM edges WHERE to_id=? AND type IN ('advance','depend') LIMIT 5`).all(nodeId).map((r) => r.from_id)
const parent = String(nodeId).split('.').slice(0, -1).join('.') + '.'
const siblingIds = db.prepare(`SELECT id FROM nodes WHERE id LIKE ? AND id != ? AND level=4 AND status='active' LIMIT 4`).all(parent + '%', nodeId).map((r) => r.id)
db.close()

const raw = readFileSync(`content/knowledge/_stale/${nodeId.replace(/\./g, '-')}.md`, 'utf8')
const md0 = raw.replace(/^<!--[^>]*-->\s*/, '')
const before = qualityGate(md0, validNodeIds, nodeId)
console.log('原草稿闸门：', JSON.stringify(before))

let md = ensureTailSections(md0, prereqIds, siblingIds)
const parsed = parseKnowledgeMd(md)
const fetched = (parsed.meta?.sources ?? []).filter((s) => s?.url)
md = ensureMetaAndSources(md, node, fetched)
const after = qualityGate(md, validNodeIds, nodeId)
console.log('补齐后闸门：', JSON.stringify(after))
console.log('prereq:', prereqIds.join(',') || '(无)', '| siblings:', siblingIds.join(',') || '(无)')
console.log('补出的尾部：\n' + ['前置知识', '相关'].map((s) => `## ${s}\n${String(parsed.sections?.[s] ?? '').trim()}`).join('\n\n'))
if (after.ok) {
  const out = `content/knowledge/${nodeId.split('.').slice(1, -1).join('/')}/${nodeId.split('.').pop()}.md`
  console.log('\n可直接入库 →', out)
  if (process.argv[3] === '--write') {
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const { dirname } = await import('node:path')
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, md, 'utf8')
    console.log('已写入', out)
  }
}
