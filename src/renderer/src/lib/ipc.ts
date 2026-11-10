import { API_METHODS } from '@shared/api'
import type { ForgeApi } from '@shared/api'

/**
 * Electron 的 contextBridge 在主世界（Vue 应用）与隔离世界（preload）之间搬运参数时，
 * 无法序列化 Vue 3 的 reactive Proxy —— 哪怕是 `{ ...reactiveObj }` 浅拷贝后残留的
 * 嵌套数组 Proxy，也会在跨世界传参那一刻抛 "An object could not be cloned."，
 * 且主进程 handler 根本不会被调用。
 *
 * 因此必须在渲染端（主世界）调用前把参数深度还原成纯 JS 数据。
 * preload 侧的同名 toPlain 保留作第二道防线（处理非 contextBridge 路径）。
 */
function deepClean<T>(value: T, seen = new WeakMap<object, any>()): T {
  if (value === null || typeof value !== 'object') return value
  const target = value as any
  if (seen.has(target)) return seen.get(target)
  if (target instanceof Date) return new Date(target.getTime()) as unknown as T
  if (target instanceof RegExp) return new RegExp(target.source, target.flags) as unknown as T
  if (target instanceof ArrayBuffer) return target.slice(0) as unknown as T
  if (ArrayBuffer.isView(target)) return new (target.constructor as any)(target) as unknown as T
  if (target instanceof Map) {
    const m = new Map()
    seen.set(target, m)
    for (const [k, v] of target.entries()) m.set(deepClean(k, seen), deepClean(v, seen))
    return m as unknown as T
  }
  if (target instanceof Set) {
    const s = new Set()
    seen.set(target, s)
    for (const v of target.values()) s.add(deepClean(v, seen))
    return s as unknown as T
  }
  // reactive Proxy 对 Array.isArray / Object.keys / 索引读取全部透传：
  // 逐字段重建即得无 Proxy 的纯壳，跨 contextBridge 安全
  const out: any = Array.isArray(target) ? new Array(target.length) : {}
  seen.set(target, out)
  for (const key of Object.keys(target)) out[key] = deepClean(target[key], seen)
  return out as T
}

/** 包裹 window.forge：每个方法先把入参深度净化再透传，返回值原样 */
function buildIpc(): ForgeApi {
  const out: Record<string, Record<string, Function>> = {}
  for (const [ns, fns] of Object.entries(API_METHODS)) {
    out[ns] = {}
    for (const fn of fns) {
      out[ns][fn] = (...args: unknown[]) => (window.forge as any)[ns][fn](...args.map((a) => deepClean(a)))
    }
  }
  return out as unknown as ForgeApi
}

export const ipc = buildIpc()
