// 一次性迁移：渲染端所有 window.forge.xxx( → ipc.xxx(，并在 import 区尾部补 import { ipc }
import fs from 'node:fs'
import path from 'node:path'
const ROOT = 'src/renderer/src'
const files = []
const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(vue|ts)$/.test(f)) files.push(p) } }
walk(ROOT)
let changed = 0
for (const f of files) {
  if (f.endsWith('lib/ipc.ts')) continue
  let s = fs.readFileSync(f, 'utf8')
  if (!s.includes('window.forge.')) continue
  s = s.replace(/window\.forge\./g, 'ipc.')
  if (!s.includes("from '@renderer/lib/ipc'") && !s.includes("from '../lib/ipc'") && !s.includes("from './lib/ipc'")) {
    // 在最后一个顶层 import 行之后插入
    const rel = f.startsWith(path.join(ROOT, 'store')) || f === path.join(ROOT, 'store.ts') ? './lib/ipc' : f.includes('components') || f.includes('views') ? '../lib/ipc' : './lib/ipc'
    const lines = s.split('\n')
    let last = -1
    for (let i = 0; i < lines.length; i++) if (/^import .*from ['"].*['"]$/.test(lines[i].trim()) || /^\s*import .*from ['"].*['"]\s*$/.test(lines[i])) last = i
    if (last === -1) throw new Error('找不到 import 锚点: ' + f)
    lines.splice(last + 1, 0, `import { ipc } from '${rel}'`)
    s = lines.join('\n')
  }
  fs.writeFileSync(f, s)
  changed++
  console.log('改写:', f)
}
console.log(`共 ${changed} 个文件`)
