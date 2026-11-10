// 现场取证：reload→nav practice 后到底什么状态；drawer ✕ 点击瞬间谁被命中
import { Cdp, sleep } from './cdp.mjs'
const log = (m) => process.stderr.write(`[f] ${m}\n`)
const cdp = await Cdp.connect()
await cdp.metrics(1460, 920)

// ---- practice reload 取证（复刻 A1 序列）----
cdp.clearErrors()
await cdp.evaluate("location.reload(); return 1").catch(() => {})
for (let i = 1; i <= 8; i++) {
  await sleep(4000)
  try {
    const st = await cdp.evaluate(`return JSON.stringify({
      t: Date.now() % 100000, hash: location.hash, ready: document.readyState,
      stems: document.querySelectorAll('.stem').length,
      spin: !!document.querySelector('.n-spin-content [aria-busy],.n-base-loader'),
      empty: document.querySelector('.n-empty')?.textContent || null,
      msg: [...document.querySelectorAll('.n-message__content')].map(e=>e.textContent.trim()).slice(0,2),
      body: document.body.innerText.slice(0, 100).replace(/\\s+/g,' ')
    })`)
    log(`t+${i * 4}s ${st}`)
  } catch (e) { log(`t+${i * 4}s EVAL失败: ${String(e.message).slice(0, 120)}`); break }
}
for (const e of cdp.errors()) log('err: ' + JSON.stringify(e).slice(0, 250))

// ---- drawer ✕ 取证（复刻 qa3 C 序列原样）----
await cdp.evaluate("location.hash = '#/'; return 1")
await sleep(1000)
await cdp.evaluate("location.hash = '#/graph'; return 1")
await sleep(3000)
const pick = await cdp.evaluate(`
  const els = [...document.querySelectorAll('.vf-node')].filter(e => e.getBoundingClientRect().width > 0);
  const el = els[3];
  if (!el) return null;
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
`)
log('node pick: ' + JSON.stringify(pick))
if (pick) {
  await cdp.mouse(pick.x, pick.y)
  await sleep(900)
  const info = await cdp.evaluate(`
    const btn = [...document.querySelectorAll('.drawer button')].find((b) => b.textContent.includes('✕'));
    if (!btn) return { drawer: false };
    const br = btn.getBoundingClientRect();
    const cx = br.x + br.width / 2, cy = br.y + br.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    return { drawer: true, rect: { x: Math.round(br.x), y: Math.round(br.y), w: Math.round(br.width), h: Math.round(br.height) }, point: [Math.round(cx), Math.round(cy)], hit: hit ? hit.tagName + '.' + String(hit.className).slice(0, 40) : null, ok: hit ? (hit === btn || btn.contains(hit)) : false }
  `)
  log('✕ 状态: ' + JSON.stringify(info))
  if (info.ok) {
    await cdp.mouse(info.point[0], info.point[1])
    await sleep(800)
    log('trusted click 后 drawer 还在吗: ' + await cdp.evaluate(`return !!document.querySelector('.drawer')`))
  }
}
await cdp.close()
