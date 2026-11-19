// R12：收口历史遗留的空摸底僵尸会话（current_node_id 为空、或节点已无 active 母题）
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const db = new DatabaseSync(join(root, 'data/app.db'))

const actives = db.prepare(`SELECT id,domain,current_node_id FROM placement_session WHERE status='active'`).all()
console.log('清理前 active 会话：', JSON.stringify(actives))

let cleaned = 0
for (const s of actives) {
  let zombie = !s.current_node_id
  if (!zombie) {
    const hasQ = db.prepare(
      `SELECT 1 FROM questions WHERE node_id=? AND status='active' AND parent_id IS NULL LIMIT 1`).get(s.current_node_id)
    if (!hasQ) zombie = true
  }
  if (zombie) {
    db.prepare(`UPDATE placement_session SET status='aborted', updated_at=datetime('now','localtime') WHERE id=?`).run(s.id)
    console.log(`  收口僵尸会话 ${s.id} (domain=${s.domain}, node=${s.current_node_id}) -> aborted`)
    cleaned++
  }
}
console.log(`清理完成，收口 ${cleaned} 个；剩余 active：`,
  JSON.stringify(db.prepare(`SELECT id,domain FROM placement_session WHERE status='active'`).all()))
db.close()
