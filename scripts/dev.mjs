#!/usr/bin/env node
/**
 * 开发 / 预览启动器。做三件在受限 / 多开环境下必不可少的事：
 *
 * 1) 删掉 ELECTRON_RUN_AS_NODE —— VSCode 集成终端、各类 agent/CI 会预设它，
 *    那会让 electron.exe 退化成「纯 Node」：主进程里 require('electron').app 是 undefined，
 *    报 `Cannot read properties of undefined (reading 'isPackaged')`。
 * 2) 传 --noSandbox —— Chromium 的进程沙箱在受限令牌 / 沙箱化 shell 里起不来，
 *    Electron 会在 Node 业务代码执行前直接退出（连一行日志都没有）。
 *    实测本机：不带该开关时进程 1 秒内退出且零输出；带上后渲染层正常加载。
 *    （主进程里也留了 app.commandLine.appendSwitch('no-sandbox') 作兜底。）
 * 3) 多开（--instance=N）—— Electron 的「单实例锁」和 Chromium profile 都绑在 userData 目录上，
 *    两个实例共用一个目录，第二个要么被锁踢掉、要么争抢 profile 起不来。这里给每个实例
 *    独立身份：userData / boot 日志 / CDP 端口分开，于是同一台机器能同时开多个窗口。
 *
 * 用法：
 *   npm run dev                    # 默认实例（data/electron-userData）
 *   npm run dev:2                  # 第二实例（data/electron-userData-2，CDP 9223）
 *   npm run dev -- --instance=3 --own-data
 *                                  # --own-data：连数据目录也隔离到 data/instances/3（进度互不影响）
 *   需要恢复沙箱：设 FORGE_NO_SANDBOX=0
 *   想跑预览：npm run dev -- --preview
 */
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import process from 'node:process'

delete process.env.ELECTRON_RUN_AS_NODE

const root = join(import.meta.dirname, '..')
const argv = process.argv.slice(2)
const modeFlag = argv.includes('--preview') ? 'preview' : 'dev'

let instance = (process.env.FORGE_INSTANCE || '').trim()
let ownData = false
const passthrough = []
for (const a of argv) {
  const m = /^--instance=(.+)$/i.exec(a)
  if (m) { instance = m[1].trim(); continue }
  if (a === '--own-data') { ownData = true; continue }
  if (a === '--preview') continue
  if (a.toLowerCase() === '--nosandbox') continue
  passthrough.push(a)
}

const portFor = (i) => 9222 + Math.max(0, (Number(i) || 1) - 1)
if (instance) {
  process.env.FORGE_INSTANCE = instance
  if (ownData && !process.env.FORGE_DATA_DIR) {
    process.env.FORGE_DATA_DIR = join(root, 'data', 'instances', instance)
  }
  // CDP 端口也分开：否则第二个实例的 devtools 绑不上（窗口能用，但 QA 脚本会连到第一个进程上）
  if (!passthrough.some((a) => /^--remote-debugging-port=/i.test(a))) {
    passthrough.push(`--remote-debugging-port=${portFor(instance)}`)
  }
}

const extra = []
if (process.env.FORGE_NO_SANDBOX !== '0') extra.push('--noSandbox')
// 其余开关（如 --remote-debugging-port=9222）原样透传给 electron-vite → Electron
extra.push(...passthrough)

if (instance) {
  console.log(
    `[多开] 实例 ${instance}：userData=data/electron-userData-${instance}` +
      ` · 数据=${process.env.FORGE_DATA_DIR || join(root, 'data')}` +
      ` · 日志=forge-boot-${instance}.log · CDP=${portFor(instance)}`
  )
}

// 直接用 node 跑 electron-vite 的 CLI 文件：绝不依赖 PATH。
// 以前 spawn('electron-vite.cmd', { shell: true }) 只在「由 npm run 启动」时才能找到命令
// （npm 会把 node_modules/.bin 前置进 PATH）；一旦被 Start-Process / 别的进程树直接拉起，
// 就会报 `'electron-vite.cmd' 不是内部或外部命令` 并以 127 退出——连日志都只有一行。
const cli = join(root, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
const child = spawn(process.execPath, [cli, modeFlag, ...extra], { stdio: 'inherit', cwd: root })
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0))
child.on('error', (e) => {
  console.error('启动 electron-vite 失败：', e.message)
  process.exit(1)
})