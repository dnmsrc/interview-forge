import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { cpus, homedir, platform } from 'node:os'

/**
 * 内置答疑小模型托管（llama.cpp · 纯 CPU 推理）。
 *
 * 设计目标（对应 docs/ops/local-tutor-model.md）：
 * 1) **零显存**：走 llama.cpp 的 CPU 后端（Win 版 cpu-x64 包不含 CUDA），
 *    `--n-gpu-layers 0` 再明确一次，进程从头到尾不碰显存，绝不和 Strata / ComfyUI 抢卡。
 * 2) **懒启动**：没有请求就不留进程。第一次用到时 spawn，加载 2.6 GB GGUF 约 3-6s。
 * 3) **用完即卸**：空闲 TUTOR_IDLE_MS（默认 15 分钟）后自动 SIGTERM 退出，内存全部归还。
 * 4) **专精**：模型本身是通用小模型，专精靠提示词护栏 + 知识正文注入（见 explain.ts / tasks.ts）。
 *
 * 本模块刻意不 import electron，便于纯 Node 下跑 scripts/qa/tutor-model-smoke.mjs。
 */

const IS_WIN = platform() === 'win32'

/** 模型与可执行文件的根目录。必须放在纯 ASCII 路径上：llama.cpp 在 Windows 下读不了非 ASCII 路径。 */
export function tutorRoot(): string {
  if (process.env.FORGE_TUTOR_DIR) return process.env.FORGE_TUTOR_DIR
  return IS_WIN ? 'D:/model/forge-tutor' : join(homedir(), '.forge-tutor')
}

export const TUTOR_MODEL_FILE = process.env.FORGE_TUTOR_MODEL || 'qwen3.8-4b-distill-q4_k_m.gguf'
/**
 * 端口选择：1234 被 Strata 占用；1235 实测已被 Windows 系统服务（svchost）LISTENING，
 * 故答疑模型固定 18765（不在 netsh 的 tcp 排除范围里，也避开常见服务）。
 */
export const TUTOR_PORT = Number(process.env.FORGE_TUTOR_PORT || 18765)
export const TUTOR_ALIAS = process.env.FORGE_TUTOR_ALIAS || 'qwen3.8-4b-distill'
export const TUTOR_IDLE_MS = Number(process.env.FORGE_TUTOR_IDLE_MS || 15 * 60 * 1000)
export const TUTOR_CTX = Number(process.env.FORGE_TUTOR_CTX || 8192)

export const TUTOR_BASE_URL = `http://127.0.0.1:${TUTOR_PORT}/v1`
export const TUTOR_ENDPOINT_ID = 'local-tutor'

export type { TutorState, TutorStatus } from '../../shared/types'
import type { TutorState, TutorStatus } from '../../shared/types'

interface TutorProc {
  child: ChildProcess
  startedAt: number
}

let proc: TutorProc | null = null
let state: TutorState = 'idle'
let lastError = ''
let lastUsedAt = 0
let starting: Promise<{ ok: boolean; message: string; waitedMs: number }> | null = null
let idleTimer: NodeJS.Timeout | null = null
let logPath = ''
let logStream: ReturnType<typeof createWriteStream> | null = null

export function tutorModelPath(): string {
  return join(tutorRoot(), TUTOR_MODEL_FILE)
}

/** 在 <root>/llama 下探测 llama-server 可执行文件（不同版本解压层级不同：可能多套一层目录） */
export function findTutorBin(): string | null {
  const exe = IS_WIN ? 'llama-server.exe' : 'llama-server'
  const direct = [join(tutorRoot(), 'llama', exe), join(tutorRoot(), 'llama', 'build', 'bin', exe)]
  for (const p of direct) if (existsSync(p)) return p
  const base = join(tutorRoot(), 'llama')
  if (!existsSync(base)) return null
  try {
    for (const d of readdirSync(base, { withFileTypes: true })) {
      if (!d.isDirectory()) continue
      const p = join(base, d.name, exe)
      if (existsSync(p)) return p
    }
  } catch { /* 目录不可读当作没有 */ }
  return null
}

export function tutorThreads(): number {
  const n = cpus().length
  // 13700KF 实测（llama-bench b12468）：4 线程 12.7、8 → 13.4、12 → 14.0、16 → 17.0 tok/s。
  // P 核吃满后 E 核仍有收益，取 16（24 线程的 2/3），再多会被调度争抢拉低。
  return Math.max(4, Math.min(16, Math.round(n * 0.67)))
}

function writeLog(line: string) {
  if (!logPath) {
    try {
      mkdirSync(tutorRoot(), { recursive: true })
      logPath = join(tutorRoot(), 'tutor.log')
      logStream = createWriteStream(logPath, { flags: 'a' })
    } catch { return }
  }
  try { logStream?.write(`${new Date().toISOString()} ${line}\n`) } catch { /* 日志失败不影响主流程 */ }
}

async function health(): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${TUTOR_PORT}/health`, { signal: AbortSignal.timeout(1500) })
    if (!r.ok) return false
    const j = (await r.json()) as { status?: string }
    return j?.status === 'ok'
  } catch { return false }
}

export function tutorStatus(): TutorStatus {
  const modelPath = tutorModelPath()
  const binPath = findTutorBin()
  const modelExists = (() => { try { return existsSync(modelPath) && statSync(modelPath).size > 1024 * 1024 } catch { return false } })()
  return {
    state,
    vramMb: 0,
    port: TUTOR_PORT,
    pid: proc?.child.pid,
    modelPath,
    modelExists,
    binPath: binPath ?? '',
    binExists: !!binPath,
    ctx: TUTOR_CTX,
    threads: tutorThreads(),
    idleUnloadMs: TUTOR_IDLE_MS,
    startedAt: proc?.startedAt,
    lastUsedAt: lastUsedAt || undefined,
    lastError: lastError || undefined,
    idleLeftMs: state === 'ready' && lastUsedAt ? Math.max(0, TUTOR_IDLE_MS - (Date.now() - lastUsedAt)) : undefined
  }
}

/** 记录一次使用：重置空闲计时器（每次请求成功或发起时调用） */
export function touchTutor() {
  lastUsedAt = Date.now()
  if (idleTimer) clearInterval(idleTimer)
  idleTimer = setInterval(() => {
    if (!lastUsedAt || state !== 'ready') return
    if (Date.now() - lastUsedAt >= TUTOR_IDLE_MS) {
      writeLog(`[idle] 空闲 ${Math.round(TUTOR_IDLE_MS / 60000)} 分钟，自动卸载`)
      stopTutor('idle')
    }
  }, 30_000)
  if (idleTimer.unref) idleTimer.unref()
}

export function stopTutor(reason = 'manual'): void {
  if (idleTimer) { clearInterval(idleTimer); idleTimer = null }
  if (!proc) { state = 'idle'; return }
  const p = proc
  proc = null
  state = 'idle'
  writeLog(`[stop] ${reason} pid=${p.child.pid}`)
  try {
    p.child.kill('SIGTERM')
    // llama-server 收到 SIGTERM 正常退出很快；3s 不退说明卡在加载/解码，强杀
    const killer = setTimeout(() => { try { p.child.kill('SIGKILL') } catch { /* 已退出 */ } }, 3000)
    if (killer.unref) killer.unref()
  } catch { /* 已经退出 */ }
}

/**
 * 确保本地答疑模型在线。已有进程/正在启动则直接复用，否则拉起并等 /health 就绪。
 * 失败原因写得足够具体，让 gateway 能把「模型没下载 / 二进制缺失 / 端口被占」区分开。
 */
export async function ensureTutor(): Promise<{ ok: boolean; message: string; waitedMs: number }> {
  const t0 = Date.now()
  if (process.env.FORGE_TUTOR_DISABLE === '1') return { ok: false, message: '已通过 FORGE_TUTOR_DISABLE=1 禁用本地答疑模型', waitedMs: 0 }
  if (proc && state === 'ready') { touchTutor(); return { ok: true, message: '已就绪', waitedMs: 0 } }
  if (starting) return starting

  const modelPath = tutorModelPath()
  if (!existsSync(modelPath)) {
    const msg = `本地答疑模型缺失：${modelPath}\n先运行 npm run tutor:fetch 下载（约 2.6 GB）`
    lastError = msg; state = 'error'
    return { ok: false, message: msg, waitedMs: Date.now() - t0 }
  }
  const bin = findTutorBin()
  if (!bin) {
    const msg = `llama-server 可执行文件缺失：${join(tutorRoot(), 'llama')}\n先运行 npm run tutor:fetch 下载运行时（约 24 MB）`
    lastError = msg; state = 'error'
    return { ok: false, message: msg, waitedMs: Date.now() - t0 }
  }

  starting = (async () => {
    state = 'starting'
    const args = [
      '--model', modelPath,
      '--host', '127.0.0.1',
      '--port', String(TUTOR_PORT),
      '--ctx-size', String(TUTOR_CTX),
      '--n-gpu-layers', '0',      // 双保险：即便换了带 CUDA 的二进制也强制 0 层上卡
      '--threads', String(tutorThreads()),
      '--parallel', '1',
      '--jinja',
      '--no-webui',
      '--alias', TUTOR_ALIAS
    ]
    writeLog(`[spawn] ${bin} ${args.join(' ')}`)
    let child: ChildProcess
    try {
      mkdirSync(tutorRoot(), { recursive: true })
      child = spawn(bin, args, { cwd: tutorRoot(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e: any) {
      state = 'error'; lastError = `拉起失败：${String(e?.message ?? e)}`
      return { ok: false, message: lastError, waitedMs: Date.now() - t0 }
    }
    proc = { child, startedAt: Date.now() }
    child.stdout?.on('data', (b) => writeLog(`[out] ${String(b).trim()}`))
    child.stderr?.on('data', (b) => {
      const s = String(b)
      writeLog(`[err] ${s.trim()}`)
      if (/error|failed|cannot|not found/i.test(s)) lastError = s.trim().slice(0, 400)
    })
    child.on('exit', (code, sig) => {
      writeLog(`[exit] code=${code} signal=${sig}`)
      if (proc?.child === child) { proc = null; state = 'idle' }
    })

    // 冷启动：2.6 GB mmap + 预热，实测 3-6s；给 45s 上限兜住机械盘/杀毒扫描
    const deadline = Date.now() + 45_000
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 400))
      if (!proc) return { ok: false, message: lastError || '推理进程启动后立即退出', waitedMs: Date.now() - t0 }
      if (await health()) {
        state = 'ready'
        lastError = ''
        touchTutor()
        writeLog(`[ready] ${Date.now() - t0}ms`)
        return { ok: true, message: `本地答疑模型就绪（${Date.now() - t0}ms，CPU 推理，显存占用 0）`, waitedMs: Date.now() - t0 }
      }
    }
    state = 'error'
    lastError = `等待就绪超时（45s），见日志 ${join(tutorRoot(), 'tutor.log')}`
    stopTutor('start-timeout')
    return { ok: false, message: lastError, waitedMs: Date.now() - t0 }
  })()

  try {
    return await starting
  } finally {
    starting = null
  }
}

/** 读最近若干行日志（设置页排障用） */
export function tutorLogTail(lines = 60): string[] {
  const p = join(tutorRoot(), 'tutor.log')
  if (!existsSync(p)) return []
  try {
    const raw = require('node:fs').readFileSync(p, 'utf8') as string
    return raw.trimEnd().split('\n').slice(-lines)
  } catch { return [] }
}

// 进程退出时尽量收掉子进程，避免留下僵尸 llama-server
process.once('exit', () => { try { proc?.child.kill('SIGKILL') } catch { /* ignore */ } })