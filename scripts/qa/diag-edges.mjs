#!/usr/bin/env node
// 看 edges 表里到底建了哪些边：重点是「父模块 → 子考点」是否也被当成 prereq 门槛（会造成死锁）
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
const db = new DatabaseSync(join(process.cwd(), 'data', 'app.db'), { readOnly: true })
const all = (s, ...p) => db.prepare(s).all(...p)

console.log('edges type 分布:', JSON.stringify(all(`SELECT type, COUNT(*) c FROM edges GROUP BY type ORDER BY c DESC`)))

const target = process.argv[2] || 'fe.vue.compiler.ast-pipeline'
const pres = all(`SELECT e.from_id, e.type, n.level plit_level, COALESCE(m.lit,0) lit, COALESCE(m.scale4,0) scale4
                  FROM edges e LEFT JOIN nodes n ON n.id=e.from_id LEFT JOIN node_mastery m ON m.node_id=e.from_id
                  WHERE e.to_id=?`, target)
console.log(`\n${target} 的入边:`)
for (const p of pres) console.log(`  ${p.type} ← ${p.from_id} (level=${p.plit_level}, lit=${p.lit}, scale4=${p.scale4})`)

// 有多少节点的「唯一前置」其实是自己的祖先（= 自我锁死）
const selfLock = all(`
  SELECT n.id, n.title, n.level, e.from_id AS pre
  FROM nodes n JOIN edges e ON e.to_id=n.id AND e.type='prereq'
  WHERE n.parent = e.from_id OR e.from_id LIKE (n.id || '.%') OR n.parent IS NULL AND e.from_id = n.parent`)
console.log(`\n「前置=直接父模块」的节点数（这类门槛会导致 level3 无题→永远点不亮→子考点永远锁死）: ${selfLock.length}`)
for (const r of selfLock.slice(0, 6)) console.log(`  ${r.id} ← ${r.pre}`)

// level3 节点有没有题
const l3 = all(`SELECT COUNT(DISTINCT n.id) c FROM nodes n JOIN questions q ON q.node_id=n.id WHERE n.level=3`)[0].c
const l3total = all(`SELECT COUNT(*) c FROM nodes n WHERE n.level=3 AND n.status='active'`)[0].c
console.log(`\nlevel3 模块节点共 ${l3total} 个，其中挂了题的只有 ${l3} 个`)
db.close()
