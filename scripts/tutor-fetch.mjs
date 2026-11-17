#!/usr/bin/env node
/**
 * 下载内置答疑小模型（Qwen3.5-4B Q4_K_M）+ llama.cpp CPU 运行时。
 *
 * 用法：
 *   npm run tutor:fetch              # 缺什么补什么（已存在则跳过）
 *   npm run tutor:fetch -- --force   # 强制重下模型
 *
 * 产物落在 FORGE_TUTOR_DIR（默认 D:/model/forge-tutor；必须纯 ASCII 路径，llama.cpp 读不了中文路径）：
 *   qwen3.5-4b-q4_k_m.gguf     约 2.55 GiB
 *   llama/llama-server.exe     约 24 MB（CPU 版，不含 CUDA → 推理全程 0 显存）
 *
 * 下载通道：
 *   - 模型走 HF 镜像（HF_ENDPOINT，默认 hf-mirror.com），8 段并行 Range 提速
 *   - llama.cpp 走 GitHub Release（可用 FORGE_TUTOR_LLAMA_URL 覆盖成镜像地址）
 */
import { createReadStream, createWriteStream, existsSync, mkdirSync, openSync, writeSync, closeSync, rmSync, statSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, platform } from 'node:os'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { execFileSync } from 'node:child_process'

const IS_WIN = platform() === 'win32'
const ROOT = process.env.FORGE_TUTOR_DIR || (IS_WIN ? 'D:/model/forge-tutor' : join(homedir(), '.forge-tutor'))
const MODEL_FILE = process.env.FORGE_TUTOR_MODEL || 'qwen3.8-4b-distill-q4_k_m.gguf'
/** 远端仓库里的文件名（大小写敏感；本地落盘名可自定义） */
const REMOTE_FILE = process.env.FORGE_TUTOR_REMOTE_FILE || 'Qwen3.8-4B-Q4_K_M.gguf'
const HF = (process.env.HF_ENDPOINT || 'https://hf-mirror.com').replace(/\/+$/, '')
const REPO = process.env.FORGE_TUTOR_REPO || 'empero-ai/Qwen3.8-4B-Distill-GGUF'
const LLAMA_BUILD = process.env.FORGE_TUTOR_LLAMA_BUILD || 'b12468'
const LLAMA_ZIP = `llama-${LLAMA_BUILD}-bin-win-cpu-x64.zip`
const LLAMA_URL = process.env.FORGE_TUTOR_LLAMA_URL
  || `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_BUILD}/${LLAMA_ZIP}`

/**
 * 运行时分发：CPU 24MB / Vulkan 36MB / CUDA 305MB+373MB。
 * 体积差 19 倍，但 Vulkan 已能让 NVIDIA/AMD/Intel 的显卡全部用上，
 * 所以默认推荐 Vulkan，CUDA 留给追求极限吞吐的用户。
 * 各后端解压到独立子目录，与 src/main/ai/model-registry.ts 的 dirName 必须一致。
 */
const RUNTIMES = {
  cpu: {
    asset: `llama-${LLAMA_BUILD}-bin-win-cpu-x64.zip`,
    dir: 'llama',
    label: 'CPU 版（约 24MB）'
  },
  vulkan: {
    asset: `llama-${LLAMA_BUILD}-bin-win-vulkan-x64.zip`,
    dir: 'llama-vulkan',
    label: 'Vulkan 版（约 36MB，推荐）'
  },
  cuda: {
    asset: `llama-${LLAMA_BUILD}-bin-win-cuda-12.4-x64.zip`,
    dir: 'llama-cuda',
    label: 'CUDA 版（约 678MB，含 CUDA 运行时）',
    extra: `cudart-llama-bin-win-cuda-12.4-x64.zip`
  }
}
/** --runtime=cpu|vulkan|cuda（默认 cpu，保持原有行为） */
const runtimeArg = (process.argv.find((a) => a.startsWith('--runtime=')) || '').split('=')[1] || 'cpu'
if (!RUNTIMES[runtimeArg]) {
  console.error(`[tutor:fetch] 未知运行时：${runtimeArg}（可选 ${Object.keys(RUNTIMES).join(' / ')}）`)
  process.exit(1)
}
const RUNTIME = RUNTIMES[runtimeArg]
const releaseUrl = (asset) => `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_BUILD}/${asset}`
const PARTS = 8
const force = process.argv.includes('--force')

const mb = (n) => `${(n / 1048576).toFixed(0)} MB`
const bytes = (p) => { try { return statSync(p).size } catch { return 0 } }
const say = (s) => console.log(`[tutor:fetch] ${s}`)

async function headSize(url) {
  const r = await fetch(url, { method: 'HEAD', redirect: 'follow' })
  if (!r.ok) throw new Error(`HEAD ${url} -> ${r.status}`)
  // 镜像给的是 302 → xet-bridge，最终的 content-length 才是真实大小
  const n = Number(r.headers.get('content-length') || 0)
  if (!n) throw new Error(`拿不到 Content-Length：${url}`)
  return n
}

async function downloadRange(url, from, to, dest) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const want = to - from + 1
      const r = await fetch(url, { headers: { Range: `bytes=${from}-${to}` } })
      if (!r.ok && r.status !== 206) throw new Error(`HTTP ${r.status}`)
      await pipeline(Readable.fromWeb(r.body), createWriteStream(dest))
      const got = bytes(dest)
      if (got !== want) throw new Error(`分段不完整 ${got}/${want}`)
      return
    } catch (e) {
      if (attempt === 4) throw e
      await new Promise((r) => setTimeout(r, 1000 * attempt))
    }
  }
}

async function fetchModel() {
  const target = join(ROOT, MODEL_FILE)
  const url = `${HF}/${REPO}/resolve/main/${REMOTE_FILE}`
  // 先看本地：已完整下载就完全不依赖网络（离线/镜像挂了也能跑）
  const local = bytes(target)
  if (!force && local > 2_000_000_000) { say(`模型已就位（${mb(local)}），跳过`); return }
  const size = await headSize(url)
  say(`开始下载模型 ${MODEL_FILE}（${mb(size)}，${PARTS} 段并行）…`)
  const partDir = join(ROOT, '.parts')
  mkdirSync(partDir, { recursive: true })
  const chunk = Math.ceil(size / PARTS)
  const tasks = []
  for (let i = 0; i < PARTS; i++) {
    const from = i * chunk
    const to = Math.min(from + chunk - 1, size - 1)
    if (from > to) break
    tasks.push((async () => {
      const t0 = Date.now()
      await downloadRange(url, from, to, join(partDir, `p${i}`))
      say(`分段 ${i} 完成（${mb(to - from + 1)}，${((Date.now() - t0) / 1000).toFixed(1)}s）`)
    })())
  }
  await Promise.all(tasks)
  // 顺序拼接（不要并发写同一文件）
  const tmp = `${target}.tmp`
  const fd = openSync(tmp, 'w')
  try {
    for (let i = 0; i < PARTS; i++) {
      const p = join(partDir, `p${i}`)
      if (!existsSync(p)) continue
      await new Promise((resolve, reject) => {
        const rs = createReadStream(p)
        rs.on('data', (buf) => writeSync(fd, buf))
        rs.on('end', resolve)
        rs.on('error', reject)
      })
      rmSync(p, { force: true })
    }
  } finally {
    closeSync(fd)
  }
  rmSync(partDir, { recursive: true, force: true })
  const got = bytes(tmp)
  if (got !== size) { rmSync(tmp, { force: true }); throw new Error(`拼接后大小不符：${got} != ${size}`) }
  rmSync(target, { force: true })
  renameSync(tmp, target)
  say(`模型下载完成：${target}（${mb(size)}）`)
}

/** 下载一个 zip（Windows 用 PowerShell，其它平台用 curl；都不走 node 的 fetch，避免大文件占内存） */
function downloadZip(url, dest) {
  if (IS_WIN) {
    // PowerShell 5.1 的 Invoke-WebRequest 走 IE 引擎，配合 -UseBasicParsing 才可靠
    execFileSync('powershell', ['-NoProfile', '-Command',
      `$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri '${url}' -OutFile '${dest}'`],
      { stdio: 'inherit' })
  } else {
    execFileSync('curl', ['-sL', url, '-o', dest], { stdio: 'inherit' })
  }
}

/** 解压 zip 到指定目录（目录由调用方保证已清空/创建） */
function extractZip(zip, dir) {
  if (IS_WIN) {
    execFileSync('powershell', ['-NoProfile', '-Command',
      `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dir}' -Force`], { stdio: 'inherit' })
  } else {
    execFileSync('unzip', ['-oq', zip, '-d', dir], { stdio: 'inherit' })
  }
}

/** 按 --runtime 下载并解压对应后端；CUDA 会把 cudart 运行时一并铺到同一目录 */
function fetchLlama() {
  const dir = join(ROOT, RUNTIME.dir)
  const exe = join(dir, IS_WIN ? 'llama-server.exe' : 'llama-server')
  if (!force && existsSync(exe)) { say(`llama.cpp 运行时已就位（${runtimeArg} / ${LLAMA_BUILD}），跳过`); return }
  mkdirSync(ROOT, { recursive: true })
  const zip = join(ROOT, `llama-${runtimeArg}.zip`)
  const url = process.env.FORGE_TUTOR_LLAMA_URL || releaseUrl(RUNTIME.asset)
  say(`下载 llama.cpp 运行时：${RUNTIME.label}`)
  say(`  来源：${url}`)
  downloadZip(url, zip)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  extractZip(zip, dir)
  if (RUNTIME.extra) {
    const extraZip = join(ROOT, `llama-cudart.zip`)
    say(`  额外下载 CUDA 运行时分包：${RUNTIME.extra}（约 373MB）`)
    downloadZip(releaseUrl(RUNTIME.extra), extraZip)
    extractZip(extraZip, dir)
    rmSync(extraZip, { force: true })
  }
  rmSync(zip, { force: true })
  if (!existsSync(exe)) throw new Error(`解压后没找到 llama-server：${exe}\n检查压缩包结构是否变化`)
  say(`llama.cpp 运行时就位：${exe}`)
}

async function main() {
  mkdirSync(ROOT, { recursive: true })
  say(`目标目录：${ROOT}`)
  try {
    fetchLlama()
  } catch (e) {
    say(`运行时下载失败（可继续只下载模型）：${String(e?.message ?? e)}`)
  }
  await fetchModel()
  say('完成。启动应用后到「设置 → 本地答疑模型」点「立即加载」做一次预热即可。')
}

main().catch((e) => { console.error(`[tutor:fetch] 失败：${e?.stack ?? e}`); process.exitCode = 1 })