// 临时探针：读取本地 naive-ui 2.45.3 各组件主题默认值（self vars）
import fs from 'node:fs'
import path from 'node:path'
const root = 'D:/学习/ai agent/interview-forge/node_modules/naive-ui/es'
const comps = ['card', 'modal', 'input', 'button', 'tag', 'message', 'data-table', 'tabs', 'layout', 'menu', 'tooltip', 'dialog', 'notification', 'skeleton', 'spin', 'scrollbar', 'alert', 'empty']
for (const c of comps) {
  const f = path.join(root, c, 'styles', '_common.mjs')
  const g = path.join(root, c, 'styles', 'light.mjs')
  const target = fs.existsSync(f) ? f : g
  if (!fs.existsSync(target)) { console.log('#### ' + c + ': NO FILE'); continue }
  const src = fs.readFileSync(target, 'utf8')
  const lines = src.split('\n').filter((l) => /^  [a-zA-Z0-9_]+:\s/.test(l))
  console.log('#### ' + c + ' (' + path.basename(target) + ', ' + lines.length + ' keys)')
  console.log(lines.slice(0, 40).join('\n'))
}
