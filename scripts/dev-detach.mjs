#!/usr/bin/env node
/**
 * 分离式启动：把 Electron 从「当前终端 / agent 会话」的进程树里摘出去。
 *
 * 为什么需要它：开发模式下 `npm run dev` 的窗口是当前 shell 的子孙进程，终端一关、
 * 或者 agent 的后台 job 被回收，窗口就跟着没了（我们这边真实踩过：job 被顶掉后
 * 主进程死掉，只剩渲染子进程和 Vite server 挂着）。用 Start-Process / detached spawn
 * 起一个新进程，它不再受当前控制台生命周期影响。
 *
 * 用法：
 *   npm run dev:bg                    # 默认实例，后台常驻
 *   npm run dev:bg -- --instance=2    # 第二实例
 * 日志落到 data/detach[-iN].out.log / .err.log
 */
import { spawnSync, spawn } from 'node:child_process'
import { mkdirSync, openSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const root = join(import.meta.dirname, '..')
const args = process.argv.slice(2)
const inst = args.find((a) => a.startsWith('--instance='))?.slice('--instance='.length) || ''
const dataDir = join(root, 'data')
mkdirSync(dataDir, { recursive: true })
const out = join(dataDir, inst ? `detach-i${inst}.out.log` : 'detach.out.log')
const err = join(dataDir, inst ? `detach-i${inst}.err.log` : 'detach.err.log')
const nodeExe = process.execPath
const devScript = join(root, 'scripts', 'dev.mjs')
const label = inst ? `实例 ${inst}` : '默认实例'
// CDP 端口与 dev.mjs 里保持同一算法，只用于提示
const port = 9222 + Math.max(0, (Number(inst) || 1) - 1)

if (process.platform === 'win32') {
  // 用 -EncodedCommand（UTF-16LE base64）传脚本：绕开中文路径 + 引号在命令行里的转义坑。
  // 坑二：Start-Process 的 -ArgumentList 传数组时**不加引号**，含空格的路径会被拆成两个参数
  // （实测报成 `Cannot find module 'D:\学习\ai'`）。所以自己拼一条命令行，含空格的逐个加双引号。
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`
  const winArg = (s) => (/[\s"]/.test(String(s)) ? `"${String(s).replace(/"/g, '\\"')}"` : String(s))
  const argLine = [devScript, ...args].map(winArg).join(' ')
  const ps = [
    `Start-Process -FilePath ${q(nodeExe)}`,
    `-ArgumentList ${q(argLine)}`,
    `-WorkingDirectory ${q(root)}`,
    `-WindowStyle Hidden`,
    `-RedirectStandardOutput ${q(out)}`,
    `-RedirectStandardError ${q(err)}`,
    `-PassThru | Select-Object -ExpandProperty Id`
  ].join(' ')
  const r = spawnSync('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { encoding: 'utf8' })
  if (r.status !== 0 || !r.stdout.trim()) {
    console.error('分离启动失败：', (r.stderr || r.stdout || '').trim())
    process.exit(1)
  }
  console.log(`✅ ${label}已分离启动（PID ${r.stdout.trim()}），窗口独立于当前终端`)
} else {
  const fdOut = openSync(out, 'a')
  const fdErr = openSync(err, 'a')
  const child = spawn(nodeExe, [devScript, ...args], { detached: true, stdio: ['ignore', fdOut, fdErr], cwd: root })
  child.unref()
  console.log(`✅ ${label}已分离启动（PID ${child.pid}），窗口独立于当前终端`)
}

console.log(`   CDP ${port} · 日志 ${out}`)
console.log(`   约 15 秒后窗口出现；确认：netstat -ano | findstr :${port}`)