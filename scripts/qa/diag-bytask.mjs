// 精确探测：window.forge.api.ai.byTask 的原始返回（含类型），判断是不是 BigInt / 别名丢失
import { Cdp, sleep } from './cdp.mjs'
const cdp = await Cdp.connect(process.env.QA_PORT || '9222')
await cdp.nav('/dashboard')
await sleep(2200)
const out = await cdp.evaluate(`return (async function(){
  const raw = await window.forge.api.ai.byTask(30);
  const shape = (v) => Array.isArray(v) ? { arr: v.length, first: v[0] === undefined ? null : Object.fromEntries(Object.entries(v[0]).map(([k, x]) => [k, typeof x + ':' + String(x).slice(0, 14)])) } : { type: typeof v, val: String(v).slice(0, 120) };
  let err = null;
  try { JSON.stringify(raw) } catch (e) { err = String(e.message).slice(0, 120) }
  const also7 = await window.forge.api.ai.byTask().catch((e) => 'ERR ' + e.message)
  return { keys: Object.keys(window.forge.api.ai || {}), n30: Array.isArray(raw) ? raw.length : typeof raw, shape30: shape(raw), jsonErr: err, shapeDefault: typeof also7 === 'string' ? also7 : shape(also7) };
})()`)
console.log(JSON.stringify(out, null, 1))
await cdp.close()
