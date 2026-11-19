// R13 临时诊断：审计每个板块摸底的真实起步难度。
// 重点：列出所有 gates=0（无外部前置门槛）的 L4 考点 + 其最简单母题的难度，
// 因为 pickStartNode 只会在这些「最基础」候选里按 ord 选第一个。
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const dbPath = process.argv[2] ? join(root, process.argv[2]) : join(root, 'data/app.db')
const db = new DatabaseSync(dbPath)
db.exec('PRAGMA foreign_keys=ON')

const domains = ['fe', 'be', 'cs', 'ai', 'eng']
const name = { fe: '前端', be: '后端', cs: '公共基础', ai: 'AI Agent', eng: '工程难题' }

for (const d of domains) {
  console.log(`\n==================== ${d} ${name[d]} ====================`)
  // 每个 L4 节点的外部前置门槛数 + 其最低难度母题
  const rows = db.prepare(`
    SELECT n.id, n.title, n.ord,
      (SELECT COUNT(*) FROM edges e WHERE e.to_id=n.id AND e.type='prereq') gates,
      (SELECT MIN(q.difficulty) FROM questions q WHERE q.node_id=n.id AND q.status='active' AND q.parent_id IS NULL) minDiff,
      (SELECT COUNT(*) FROM questions q WHERE q.node_id=n.id AND q.status='active' AND q.parent_id IS NULL) qn
    FROM nodes n
    WHERE n.level=4 AND n.domain=? AND n.status='active'
    ORDER BY gates ASC, n.ord ASC`).all(d)
  if (!rows.length) { console.log('  （无 L4 节点）'); continue }
  const zero = rows.filter((r) => r.gates === 0)
  console.log(`L4 考点 ${rows.length} 个，其中 gates=0（摸底起步候选）${zero.length} 个：`)
  for (const r of zero) {
    console.log(`  [gates=0 ord=${r.ord} 最低难度=${r.minDiff ?? '无题'} 题数=${r.qn}] ${r.title}  (${r.id})`)
  }
  // 模拟真实首节点 + 首题难度（R13 新护栏：gates → minDiff → ord）
  const start = db.prepare(`
    SELECT n.id, n.title,
      (SELECT COUNT(*) FROM edges e WHERE e.to_id=n.id AND e.type='prereq') gates,
      (SELECT MIN(q.difficulty) FROM questions q WHERE q.node_id=n.id AND q.status='active' AND q.parent_id IS NULL) minDiff
    FROM nodes n WHERE n.level=4 AND n.domain=? AND n.status='active'
    ORDER BY gates ASC, minDiff ASC, n.ord ASC LIMIT 1`).get(d)
  const firstQ = db.prepare(`SELECT id, difficulty FROM questions WHERE node_id=? AND status='active' AND parent_id IS NULL ORDER BY difficulty ASC, RANDOM() LIMIT 1`).get(start.id)
  console.log(`  >>> 摸底实际首节点：${start.title}（gates=${start.gates} 最低题难度=${start.minDiff ?? '无题'}），首题 ${firstQ?.id ?? '（暂无题）'} 难度=${firstQ?.difficulty ?? '-'}`)
  // 该板块整体难度分布
  const diff = db.prepare(`SELECT q.difficulty, COUNT(*) n FROM questions q JOIN nodes n ON n.id=q.node_id
    WHERE n.domain=? AND q.status='active' AND q.parent_id IS NULL GROUP BY q.difficulty ORDER BY q.difficulty`).all(d)
  console.log('  母题难度分布(1最易..4最难):', JSON.stringify(diff.map((x) => `D${x.difficulty}:${x.n}`)))
}
db.close()
