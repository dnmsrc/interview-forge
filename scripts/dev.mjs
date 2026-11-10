#!/usr/bin/env node
/**
 * 开发 / 预览启动器。做两件在受限环境下必不可少的事：
 *
 * 1) 删掉 ELECTRON_RUN_AS_NODE —— VSCode 集成终端、各类 agent/CI 会预设它，
 *    那会让 electron.exe 退化成「纯 Node」：主进程里 require('electron').app 是 undefined，
 *    报 `Cannot read properties of undefined (reading 'isPackaged')`。
 * 2) 传 --noSandbox —— Chromium 的进程沙箱在受限令牌 / 沙箱化 shell 里起不来，
 *    Electron 会在 Node 业务代码执行前直接退出（连一行日志都没有）。
 *    实测本机：不带该开关时进程 1 秒内退出且零输出；带上后渲染层正常加载。
 *    （主进程里也留了 app.commandLine.appendSwitch('no-sandbox') 作兜底。）
 *
 * 需要恢复沙箱：设 FORGE_NO_SANDBOX=0。想跑预览：node scripts/dev.mjs --preview
 */
import { spawn } from 'node:child_process'
import process from 'node:process'

delete process.env.ELECTRON_RUN_AS_NODE

const modeFlag = process.argv.slice(2).includes('--preview') ? 'preview' : 'dev'
const extra = []
if (process.env.FORGE_NO_SANDBOX !== '0') extra.push('--noSandbox')
// 其余开关（如 --remote-debugging-port=9222）原样透传给 electron-vite → Electron
for (const a of process.argv.slice(2)) {
  if (a !== '--preview' && a.toLowerCase() !== '--nosandbox') extra.push(a)
}

const bin = process.platform === 'win32' ? 'electron-vite.cmd' : 'electron-vite'
const child = spawn(bin, [modeFlag, ...extra], {
  stdio: 'inherit',
  shell: process.platform === 'win32'
})
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0))
child.on('error', (e) => {
  console.error('启动 electron-vite 失败：', e.message)
  process.exit(1)
})
