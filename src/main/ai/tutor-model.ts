import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cpus, homedir, platform } from 'node:os'
import { RUNTIMES, MODELS, runtimeOf, modelOf, recommendBackend, type InferBackend, type InferMode, type GpuInfo } from './model-registry'
import type { TutorCatalog } from '../../shared/types'

/**
 * 内置答疑小模型托管（llama.cpp）。
 *
 * 设计目标（对应 docs/ops/local-tutor-model.md）：
 * 1) **可跑 GPU 也可纯 CPU**：推理模式分 auto/cpu/gpu 三档（见 model-registry.ts）。
 *    auto 会真实检测 NVIDIA 显卡与空闲显存：够就全量上卡，不够就退回 CPU。
 *    显式选 cpu 时 `--n-gpu-layers 0`，进程从头到尾不碰显存，绝不和 Strata / ComfyUI 抢卡。
 * 2) **懒启动**：没有请求就不留进程。第一次用到时 spawn，加载 2.6 GB GGUF 约 3-6s。
 * 3) **用完即卸**：空闲 TUTOR_IDLE_MS（默认 15 分钟）后自动 SIGTERM 退出，内存全部归还。
 * 4) **专精**：模型本身是通用小模型，专精靠提示词护栏 + 知识正文注入（见 explain.ts / tasks.ts）。
 *
 * 本模块刻意不 import electron，推理模式存在 tutorRoot()/infer-config.json 而不是 settings 表，
 * 这样纯 Node 下也能跑 scripts/qa 的冒烟（import db 会把 electron 拖进来）。
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

/* ---------------- 推理模式与显卡检测 ---------------- */

interface InferConfig {
  mode: InferMode
  /** 选定的模型 id（缺省用注册表第一个） */
  modelId?: string
}

function inferConfigPath(): string {
  return join(tutorRoot(), 'infer-config.json')
}

/** 读推理配置。首次运行、文件损坏、字段非法都回落到 auto，绝不让坏配置把应用卡死 */
export function readInferConfig(): InferConfig {
  try {
    const raw = JSON.parse(readFileSync(inferConfigPath(), 'utf8')) as Partial<InferConfig>
    const mode: InferMode = raw?.mode === 'cpu' || raw?.mode === 'gpu' ? raw.mode : 'auto'
    return { mode, modelId: typeof raw?.modelId === 'string' ? raw.modelId : undefined }
  } catch {
    return { mode: 'auto' }
  }
}

export function writeInferConfig(patch: Partial<InferConfig>): InferConfig {
  const next = { ...readInferConfig(), ...patch }
  try {
    mkdirSync(tutorRoot(), { recursive: true })
    writeFileSync(inferConfigPath(), JSON.stringify(next, null, 2), 'utf8')
  } catch { /* 写失败不影响本次推理，下次仍读旧值 */ }
  gpuCache = null   // 配置变了，下一次判定重新算
  return next
}

/** 当前选定的模型（显存估算与下载提示都用它） */
export function currentModelId(): string {
  return readInferConfig().modelId ?? 'qwen3.8-4b-distill'
}

function currentModel() {
  return modelOf(currentModelId())
}

let gpuCache: { at: number; gpu: GpuInfo | null } | null = null

/**
 * 检测 NVIDIA 显卡并取真实显存。没装 nvidia-smi 就当作无 GPU——
 * 宁可回落到 CPU，也不假装检测成功（假检测会让 UI 显示「已启用 GPU」却还在用 CPU）。
 * 结果缓存 60s：设置页会频繁查状态，不能每次都 spawn 一个进程。
 */
export function detectGpu(force = false): GpuInfo | null {
  if (!force && gpuCache && Date.now() - gpuCache.at < 60_000) return gpuCache.gpu
  let gpu: GpuInfo | null = null
  try {
    const out = execFileSync(
      'nvidia-smi',
      ['--query-gpu=name,memory.total,memory.free', '--format=csv,noheader,nounits'],
      { encoding: 'utf8', timeout: 4000, windowsHide: true }
    ).trim()
    const [name, total, free] = (out.split('\n')[0] ?? '').split(',').map((s) => s.trim())
    if (name && Number(total) > 0) gpu = { name, totalMb: Number(total), freeMb: Number(free) || 0 }
  } catch {
    gpu = null
  }
  gpuCache = { at: Date.now(), gpu }
  return gpu
}

/** 已下载的 GPU 运行时里挑一个：优先 vulkan（运行时只有 36MB），再 cuda */
function availableGpuBackend(): InferBackend | null {
  for (const id of ['vulkan', 'cuda'] as const) {
    if (findTutorBin(id)) return id
  }
  return null
}

export interface ResolvedInfer {
  mode: InferMode
  backend: InferBackend
  /** 实际传给 llama-server 的 --n-gpu-layers */
  gpuLayers: number
  reason: string
}

/**
 * 把「用户模式 + 显卡现状 + 已下载运行时」综合成一个可执行决策。
 * 最容易踩的坑是「显存够但运行时没下载」——这种情况必须回落 CPU 并把原因说清，
 * 而不是静默走慢路径让用户以为开了 GPU。
 */
export function resolveInfer(modeOverride?: InferMode): ResolvedInfer {
  const mode = modeOverride ?? readInferConfig().mode
  const model = currentModel()
  const gpu = detectGpu()

  if (mode === 'cpu') {
    return { mode, backend: 'cpu', gpuLayers: 0, reason: '已指定纯 CPU 模式（零显存占用）' }
  }
  if (!gpu) {
    return { mode, backend: 'cpu', gpuLayers: 0, reason: '未检测到 NVIDIA 显卡，走纯 CPU' }
  }
  const rec = recommendBackend(gpu, model.sizeMb)
  if (rec.backend === 'cpu') {
    return { mode, backend: 'cpu', gpuLayers: 0, reason: rec.reason }
  }
  const backend = availableGpuBackend()
  if (!backend) {
    return {
      mode, backend: 'cpu', gpuLayers: 0,
      reason: `显存充足（空闲 ${gpu.freeMb}MB），但还没下载 GPU 运行时；下载 Vulkan 版（${RUNTIMES[1].sizeMb}MB）后即可全量上卡`
    }
  }
  return { mode, backend, gpuLayers: 99, reason: rec.reason }
}
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
  // 环境变量优先级最高（脚本/测试可覆盖），否则按注册表里选定的模型文件名落盘
  if (process.env.FORGE_TUTOR_MODEL) return join(tutorRoot(), process.env.FORGE_TUTOR_MODEL)
  return join(tutorRoot(), currentModel().fileName)
}

/** 在 <root>/llama 下探测 llama-server 可执行文件（不同版本解压层级不同：可能多套一层目录） */
export function findTutorBin(backend: InferBackend = 'cpu'): string | null {
  const exe = IS_WIN ? 'llama-server.exe' : 'llama-server'
  // 每种后端各占一个子目录（llama / llama-vulkan / llama-cuda），互不覆盖
  const base = join(tutorRoot(), runtimeOf(backend).dirName)
  const direct = [join(base, exe), join(base, 'build', 'bin', exe)]
  for (const p of direct) if (existsSync(p)) return p
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
  const resolved = resolveInfer()
  const binPath = findTutorBin(resolved.backend)
  const gpu = detectGpu()
  const modelExists = (() => { try { return existsSync(modelPath) && statSync(modelPath).size > 1024 * 1024 } catch { return false } })()
  return {
    state,
    mode: resolved.mode,
    backend: resolved.backend,
    gpuLayers: resolved.gpuLayers,
    gpu,
    reason: resolved.reason,
    vramMb: gpu?.totalMb ?? 0,
    port: TUTOR_PORT,
    pid: proc?.child.pid,
    modelPath,
    modelExists,
    modelId: currentModelId(),
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
  // 先把「该用哪个后端」定下来，再据此找对应二进制；显存够但运行时没下载时会回落 CPU
  const resolved = resolveInfer()
  const bin = findTutorBin(resolved.backend)
  if (!bin) {
    const msg = resolved.backend === 'cpu'
      ? `llama-server 可执行文件缺失：${join(tutorRoot(), 'llama')}\n先运行 npm run tutor:fetch 下载运行时（约 24 MB）`
      : `已判定该走 GPU（${resolved.backend}），但对应运行时未下载：${join(tutorRoot(), runtimeOf(resolved.backend).dirName)}\n到「设置 → 本地模型与推理」里下载即可`
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
      // GPU 层数由推理模式决定：0 = 纯 CPU（零显存），99 = 全部层上卡
      '--n-gpu-layers', String(resolved.gpuLayers),
      '--threads', String(tutorThreads()),
      '--parallel', '1',
      '--jinja',
      '--no-webui',
      '--alias', TUTOR_ALIAS
    ]
    writeLog(`[spawn] mode=${resolved.mode} backend=${resolved.backend} gpu_layers=${resolved.gpuLayers} | ${bin} ${args.join(' ')}`)
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
        const where = resolved.gpuLayers > 0
          ? `${resolved.backend.toUpperCase()} 推理，${resolved.gpuLayers} 层已上卡`
          : 'CPU 推理，显存占用 0'
        return { ok: true, message: `本地答疑模型就绪（${Date.now() - t0}ms，${where}）`, waitedMs: Date.now() - t0 }
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

/** 设置页「本地模型与推理」：模型/运行时清单 + 推荐后端 + 补下载命令 */
export function tutorCatalog(): TutorCatalog {
  const status = tutorStatus()
  const fileReady = (fileName: string) => {
    try {
      const p = join(tutorRoot(), fileName)
      return existsSync(p) && statSync(p).size > 1024 * 1024
    } catch { return false }
  }
  const models = MODELS.map((m) => ({
    id: m.id, label: m.label, params: m.params, quant: m.quant, sizeMb: m.sizeMb, note: m.note,
    ready: fileReady(m.fileName),
    selected: m.id === status.modelId
  }))
  const runtimes = RUNTIMES.map((r) => ({
    id: r.id,
    label: r.label,
    sizeMb: r.sizeMb + (r.extraSizeMb ?? 0),
    note: r.note,
    ready: !!findTutorBin(r.id)
  }))
  const model = modelOf(status.modelId)
  const rec = recommendBackend(status.gpu, model.sizeMb)
  const gpuRuntimeReady = runtimes.some((r) => (r.id === 'vulkan' || r.id === 'cuda') && r.ready)
  const modelReady = models.find((m) => m.id === status.modelId)?.ready ?? false
  const hints: string[] = []
  // 只有「显存够但没下 GPU 运行时」才提示下运行时，避免 CPU 机器被误导多下 36MB
  if (rec.backend !== 'cpu' && !gpuRuntimeReady) hints.push('npm run tutor:fetch -- --runtime=vulkan')
  if (!modelReady) hints.push('npm run tutor:fetch')
  return {
    models,
    runtimes,
    recommendBackend: rec.backend,
    recommendReason: rec.reason,
    fetchHint: hints.join('  &&  ') || '依赖齐全，无需额外下载'
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