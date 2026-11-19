#!/usr/bin/env node
/**
 * 一条命令起多个实例：父进程统一管住所有子窗口，串行启动避免并发抢 Vite 端口 / 并发写 out/。
 *
 * 为什么不用「开多个终端各跑一次 dev」：每个 electron-vite 都要自己找渲染端口、写 out/，
 * 同时起会互相踩；而 agent / CI 环境里每个后台任务常常只能活一个，多开会被回收顶掉。
 * 这里让一个父进程负责全部：子进程退出父进程跟着退，关掉这一条命令就等于关掉所有窗口。
 *
 * 用法：
 *   node scripts/dev-multi.mjs        # 2 个实例（CDP 9222 / 9223）
 *   node scripts/dev-multi.mjs 3      # 3 个实例（CDP 9222 / 9223 / 9224）
 *   npm run dev:multi -- 3
 * 每个实例仍是独立 userData（data/electron-userData-N）、独立 boot 日志（forge-boot-N.log）。
 * 数据目录共用 data/（进度、题库共享），要隔离用单个 dev.mjs --instance=N --own-data。
 */
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import process from 'node:process'

const root = join(import.meta.dirname, '..')
// 同 dev.mjs：终端/agent 会预设 ELECTRON_RUN_AS_NODE，electron.exe 会退化成纯 Node，
// 主进程里 app 是 undefined，启动立刻死在 `Cannot read properties of undefined (reading 'isPackaged')`。
delete process.env.ELECTRON_RUN_AS_NODE
const cli = join(root, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
const count = Math.min(4, Math.max(1, Number(process.argv[2]) || 2))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const children = []
let closing = false

function launch(n) {
  const port = 9222 + n - 1
  const child = spawn(
    process.execPath,
    [cli, 'dev', '--noSandbox', `--remote-debugging-port=${port}`],
    { cwd: root, env: { ...process.env, FORGE_INSTANCE: String(n) }, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  const prefix = `[i${n}]`
  const tag = (chunk) =>
    String(chunk)
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => `${prefix} ${l}\n`)
      .join('')
  child.stdout.on('data', (d) => process.stdout.write(tag(d)))
  child.stderr.on('data', (d) => process.stderr.write(tag(d)))
  child.on('exit', (code) => {
    console.log(`${prefix} 已退出（${code}）`)
    if (!closing) shutdown(code ?? 0)
  })
  children.push(child)
  return child
}

function shutdown(code) {
  if (closing) return
  closing = true
  for (const c of children) { try { c.kill() } catch { /* 已退出 */ } }
  setTimeout(() => process.exit(code), 1500)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

for (let n = 1; n <= count; n++) {
  console.log(`[multi] 启动实例 ${n} …（CDP ${9222 + n - 1}）`)
  launch(n)
  // 串行：等上一个把 out/ 构建完、Vite 端口定下来再起下一个，避免同时写同一份产物
  if (n < count) await sleep(n === 1 ? 14000 : 9000)
}
console.log(`[multi] ${count} 个实例已启动。关掉本进程（Ctrl+C）会一起关闭。`)