// 本地对照：Node 里真实 Vue reactive Proxy 经 structuredClone 的确切报错类型
import { reactive } from 'vue'
const spec = reactive({ domains: ['fe'], count: 10 })
try {
  structuredClone(spec)
  console.log('clone(spec) 直接成功')
} catch (e) {
  console.log('clone(spec):', e.constructor.name, '->', e.message)
}
console.log('toString(spec):', Object.prototype.toString.call(spec))
console.log('toString(spec.domains):', Object.prototype.toString.call(spec.domains))
console.log('has PROTO Symbol:', typeof Symbol.toStringTag in spec)

// 模拟我 preload 的 toPlain 再 clone
function toPlain(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value
  const target = value
  if (seen.has(target)) return seen.get(target)
  if (target instanceof Date) return new Date(target.getTime())
  if (target instanceof ArrayBuffer) return target.slice(0)
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(target)) return new target.constructor(target)
  if (target instanceof Map) { const m = new Map(); seen.set(target, m); for (const [k, v] of target.entries()) m.set(toPlain(k, seen), toPlain(v, seen)); return m }
  if (target instanceof Set) { const s = new Set(); seen.set(target, s); for (const v of target.values()) s.add(toPlain(v, seen)); return s }
  const out = Array.isArray(target) ? new Array(target.length) : {}
  seen.set(target, out)
  for (const key of Object.keys(target)) out[key] = toPlain(target[key], seen)
  return out
}
const p = toPlain(spec)
console.log('toPlain 后 toString:', Object.prototype.toString.call(p))
try { const c = structuredClone(p); console.log('clone(toPlain(spec)): ok, domains[0]=', c.domains[0]) } catch (e) { console.log('clone(toPlain) 失败:', e.message) }
