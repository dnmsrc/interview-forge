import { contextBridge, ipcRenderer } from 'electron'
import { API_METHODS } from '../shared/api'
import type { ForgeApi } from '../shared/api'

/**
 * 把渲染层传进来的值转换成「可结构化克隆」的纯数据。
 * Vue 3 的 reactive()/readonly() 返回的是 Proxy，Electron IPC 的结构化克隆
 * 算法无法克隆 Proxy，会直接抛 DataCloneError（An object could not be cloned.）。
 * 这里通过递归重建普通对象/数组来彻底脱离 Proxy —— reactive Proxy 对
 * Array.isArray / Object.keys / instanceof / 属性读取都是透传的，无需依赖 vue。
 * 同时覆盖 Map/Set/Date/RegExp/ArrayBuffer/TypedArray 与循环引用。
 */
function toPlain<T>(value: T, seen: WeakMap<object, any> = new WeakMap()): T {
  if (value === null || typeof value !== 'object') return value
  const target = value as any

  // 循环引用兜底：同一源对象只构建一次
  if (seen.has(target)) return seen.get(target)

  // 结构化克隆原生支持的内建类型，按其语义重建
  if (target instanceof Date) return new Date(target.getTime()) as unknown as T
  if (target instanceof RegExp) return new RegExp(target.source, target.flags) as unknown as T
  if (target instanceof ArrayBuffer) return target.slice(0) as unknown as T
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(target)) {
    // TypedArray / DataView：拷贝视图，避免共享底层缓冲
    return new (target.constructor as any)(target) as unknown as T
  }
  if (target instanceof Map) {
    const m = new Map()
    seen.set(target, m)
    for (const [k, v] of target.entries()) m.set(toPlain(k, seen), toPlain(v, seen))
    return m as unknown as T
  }
  if (target instanceof Set) {
    const s = new Set()
    seen.set(target, s)
    for (const v of target.values()) s.add(toPlain(v, seen))
    return s as unknown as T
  }

  // 数组 / 普通对象（含 reactive Proxy）：逐字段递归，重建为无 Proxy 的纯壳
  const out: any = Array.isArray(target) ? new Array(target.length) : {}
  seen.set(target, out)
  for (const key of Object.keys(target)) {
    out[key] = toPlain(target[key], seen)
  }
  return out as T
}

/** 按 API_METHODS 生成同名桥接方法，渲染层调用即 ipcRenderer.invoke('<ns>.<fn>') */
function buildBridge(): ForgeApi {
  const out: Record<string, Record<string, (...args: unknown[]) => Promise<any>>> = {}
  for (const [ns, fns] of Object.entries(API_METHODS)) {
    out[ns] = {}
    for (const fn of fns) {
      // 必须显式包一层：contextBridge 只搬运可序列化对象，Proxy 会丢属性；
      // 同时在 invoke 前把每个入参深度转成可克隆的纯数据，根治 DataCloneError。
      out[ns][fn] = (...args: unknown[]) =>
        ipcRenderer.invoke(`${ns}.${fn}`, ...args.map((a) => toPlain(a)))
    }
  }
  return out as unknown as ForgeApi
}

const bridge = buildBridge()
contextBridge.exposeInMainWorld('forge', bridge)
contextBridge.exposeInMainWorld('forgeMeta', { platform: process.platform, versions: process.versions })

export type { ForgeApi }
