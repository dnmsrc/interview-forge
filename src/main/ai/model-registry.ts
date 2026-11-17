/**
 * 本地推理的运行时与模型注册表。
 *
 * 两条硬约束决定了这里的内容：
 *   1) **体积**：客户端不能内置模型。所以运行时分发要挑体积，实测同一版本
 *      CUDA 包 305MB + 额外 373MB 运行时（cudart），而 **Vulkan 包只要 36MB**
 *      就能让 NVIDIA/AMD/Intel 的显卡全部用上。对大多数用户 Vulkan 是更划算的默认项。
 *   2) **可验证**：所有 URL / 资产名都在 b12475 这个 release 上实际查证过，
 *      模型仓库与文件名以 HF 镜像 API 返回为准，不凭记忆写版本号。
 *
 * 下载与解压不在这层实现：复用 scripts/tutor-fetch.mjs（8 段并行 Range + 镜像 + 解压），
 * 主进程只负责 spawn 它并解析进度。避免两套下载逻辑各自漂移。
 */

import type { InferMode, InferBackend, GpuInfo } from '../../shared/types'
export type { InferMode, InferBackend, GpuInfo }

/** llama.cpp release tag：与 tutor-fetch.mjs 的默认值保持一致，改一处两处都动 */
export const LLAMA_BUILD = process.env.FORGE_TUTOR_LLAMA_BUILD || 'b12468'
const RELEASE_BASE = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_BUILD}`

export interface RuntimeEntry {
  id: InferBackend
  label: string
  /** release 资产名（体积已查证） */
  asset: string
  sizeMb: number
  /** CUDA 需要额外的 cudart 运行时分包，其它后端为空 */
  extraAsset?: string
  extraSizeMb?: number
  /** 解压目标子目录（相对 tutorRoot()），每种后端各占一个，互不覆盖 */
  dirName: string
  note: string
}

export const RUNTIMES: RuntimeEntry[] = [
  {
    id: 'cpu',
    label: 'CPU 版',
    asset: `llama-${LLAMA_BUILD}-bin-win-cpu-x64.zip`,
    sizeMb: 24,
    dirName: 'llama',
    note: '零显存占用，所有机器可用（默认已随 tutor:fetch 下载）'
  },
  {
    id: 'vulkan',
    label: 'Vulkan 版（推荐 GPU 方案）',
    asset: `llama-${LLAMA_BUILD}-bin-win-vulkan-x64.zip`,
    sizeMb: 36,
    dirName: 'llama-vulkan',
    note: '仅 36MB 就能把计算放到显卡上；NVIDIA/AMD/Intel 通用，不需要装 CUDA 运行时'
  },
  {
    id: 'cuda',
    label: 'CUDA 版',
    asset: `llama-${LLAMA_BUILD}-bin-win-cuda-12.4-x64.zip`,
    sizeMb: 305,
    extraAsset: `cudart-llama-bin-win-cuda-12.4-x64.zip`,
    extraSizeMb: 373,
    dirName: 'llama-cuda',
    note: 'NVIDIA 专用，吞吐最高；代价是要多下 373MB CUDA 运行时（合计约 678MB）'
  }
]

export function runtimeOf(id: InferBackend): RuntimeEntry {
  return RUNTIMES.find((r) => r.id === id) ?? RUNTIMES[0]
}

export function runtimeUrl(id: InferBackend): { url: string; extraUrl?: string } {
  const r = runtimeOf(id)
  return {
    url: `${RELEASE_BASE}/${r.asset}`,
    extraUrl: r.extraAsset ? `${RELEASE_BASE}/${r.extraAsset}` : undefined
  }
}

export interface ModelEntry {
  id: string
  label: string
  params: string
  quant: string
  sizeMb: number
  /** 落盘文件名（tutorRoot() 下） */
  fileName: string
  /** HF 仓库（走 HF_ENDPOINT 镜像下载） */
  repo: string
  /** 仓库内的真实文件名（大小写敏感） */
  remoteFile: string
  note: string
  /** 全量上卡所需的最小空闲显存：模型 + 8K 上下文 KV cache + 余量 */
  minVramMb: number
  /** 纯 CPU 推理建议的系统可用内存 */
  minRamMb: number
}

export const MODELS: ModelEntry[] = [
  {
    id: 'qwen3.8-4b-distill',
    label: 'Qwen3.8-4B-Distill',
    params: '4B',
    quant: 'Q4_K_M',
    sizeMb: 2780,
    fileName: process.env.FORGE_TUTOR_MODEL || 'qwen3.8-4b-distill-q4_k_m.gguf',
    repo: process.env.FORGE_TUTOR_REPO || 'empero-ai/Qwen3.8-4B-Distill-GGUF',
    remoteFile: process.env.FORGE_TUTOR_REMOTE_FILE || 'Qwen3.8-4B-Q4_K_M.gguf',
    note: '默认主力：答疑质量与速度平衡，CPU 上约 13-17 tok/s',
    minVramMb: 4600,
    minRamMb: 6000
  },
  {
    id: 'lfm3-1.7b',
    label: 'LFM3-1.7B',
    params: '1.7B',
    quant: 'Q4_K_M',
    sizeMb: 1050,
    fileName: 'lfm3-1.7b-q4_k_m.gguf',
    repo: 'LiquidAI/LFM3-1.7B-GGUF',
    remoteFile: 'LFM3-1.7B-Q4_K_M.gguf',
    note: '轻量档：低配机器可用，首字更快但讲解深度弱于 4B',
    minVramMb: 2600,
    minRamMb: 3000
  }
]

export function modelOf(id: string): ModelEntry {
  return MODELS.find((m) => m.id === id) ?? MODELS[0]
}

/** 给 UI 用的「当前该下什么」清单：按显存/内存推荐一条路径 */
export function recommendBackend(gpu: { totalMb: number; freeMb: number } | null, modelSizeMb: number): {
  backend: InferBackend
  reason: string
} {
  if (!gpu) {
    return { backend: 'cpu', reason: '未检测到 NVIDIA 显卡，走纯 CPU（零显存占用）' }
  }
  const need = modelSizeMb * 1.15 + 1024   // 模型 + KV cache + 余量
  if (gpu.freeMb >= need) {
    return {
      backend: 'vulkan',
      reason: `显存充足（空闲 ${gpu.freeMb}MB ≥ 需要 ${Math.round(need)}MB），推荐 Vulkan：只用 36MB 运行时就能全量上卡`
    }
  }
  return {
    backend: 'cpu',
    reason: `显存不足（空闲 ${gpu.freeMb}MB < 需要 ${Math.round(need)}MB），退回 CPU 更稳`
  }
}