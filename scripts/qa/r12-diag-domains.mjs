// R12 临时诊断：逐板块统计 L4 节点、挂题节点、active 母题，定位摸底空白根因
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const db = new DatabaseSync(join(root, 'data/app.db'))
db.exec('PRAGMA foreign_keys=ON')

const domains = ['fe', 'be', 'cs', 'ai', 'eng']
console.log('板块 | L4节点 | 有active母题的L4节点 | active母题数 | 全部节点(各级) | 题总数')
for (const d of domains) {
  const l4 = db.prepare(`SELECT COUNT(*) n FROM nodes WHERE level=4 AND domain=? AND status='active'`).get(d).n
  const allNodes = db.prepare(`SELECT COUNT(*) n FROM nodes WHERE domain=?`).get(d).n
  const withQ = db.prepare(`
    SELECT COUNT(DISTINCT n.id) n FROM nodes n
    JOIN questions q ON q.node_id=n.id AND q.status='active' AND q.parent_id IS NULL
    WHERE n.level=4 AND n.domain=? AND n.status='active'`).get(d).n
  const activeQ = db.prepare(`
    SELECT COUNT(*) n FROM questions q JOIN nodes n ON n.id=q.node_id
    WHERE n.domain=? AND q.status='active' AND q.parent_id IS NULL`).get(d).n
  const allQ = db.prepare(`SELECT COUNT(*) n FROM questions q JOIN nodes n ON n.id=q.node_id WHERE n.domain=?`).get(d).n
  const bare = l4 - withQ
  console.log(`${d} | ${l4} | ${withQ} | ${activeQ} | ${allNodes} | ${allQ}${bare ? `  ⚠️ ${bare} 个L4叶子无母题` : ''}`)
}

// 摸底首节点模拟：每板块 pickStartNode 实际会选到谁、能不能出题
console.log('\n模拟 startPlacement 首节点：')
for (const d of domains) {
  const start = db.prepare(`
    SELECT n.id,n.title,
      (SELECT COUNT(*) FROM edges e WHERE e.to_id=n.id AND e.type='prereq') gates
    FROM nodes n WHERE n.level=4 AND n.domain=? AND n.status='active'
    ORDER BY gates ASC, n.ord ASC LIMIT 1`).get(d)
  if (!start) { console.log(`${d}: ❌ 无 L4 节点 -> item=null -> 前端空白卡死`); continue }
  const q = db.prepare(`SELECT id FROM questions WHERE node_id=? AND status='active' AND parent_id IS NULL LIMIT 1`).get(start.id)
  console.log(`${d}: 首节点=${start.title} (gates=${start.gates}) 母题=${q ? q.id : '❌ 无 -> item=null'}`)
}

// 未完成的 active 摸底会话（resume 也可能 item=null）
const actives = db.prepare(`SELECT id,domain,current_node_id,status FROM placement_session WHERE status='active'`).all()
console.log('\n未完成 placement_session：', JSON.stringify(actives))
db.close()
