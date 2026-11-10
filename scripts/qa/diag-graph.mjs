// 图谱页诊断：轮询节点数量与几何状态，找出 clickSel 失败瞬间的真相
import { Cdp, sleep } from './cdp.mjs'
const log = (m) => process.stderr.write(`[graph] ${m}\n`)
const cdp = await Cdp.connect()
await cdp.metrics(1460, 920)
await cdp.evaluate("location.reload(); return 1").catch(() => {})
await sleep(2800)
await cdp.evaluate("location.hash = '#/graph'; return 1")
for (let i = 1; i <= 10; i++) {
  const st = await cdp.evaluate(`return {
    n: document.querySelectorAll('.vf-node').length,
    visible: [...document.querySelectorAll('.vf-node')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 }).length,
    flowEl: !!document.querySelector('.vue-flow__node'),
    empty: document.querySelector('.n-empty')?.textContent || null,
    spin: !!document.querySelector('.n-spin-container .n-spin-content'),
    bodySnippet: document.body.innerText.slice(0, 120).replace(/\\s+/g, ' ')
  }`)
  log(`t=${i * 700}ms ${JSON.stringify(st)}`)
  if (st.visible >= 4) break
  await sleep(700)
}
// 模拟 clickSel 完整逻辑
const pick = await cdp.evaluate(`
  const els = [...document.querySelectorAll('.vf-node')].filter(e => e.getBoundingClientRect().width > 0);
  const el = els[3];
  if (!el) return { count: els.length, hit: null };
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  const r = el.getBoundingClientRect();
  return { count: els.length, hit: { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), inView: r.y > 0 && r.y < innerHeight }, txt: el.textContent.trim().slice(0, 30) };
`)
log('pick: ' + JSON.stringify(pick))
if (pick.hit) {
  await cdp.mouse(pick.hit.x, pick.hit.y)
  await sleep(900)
  const drawer = await cdp.evaluate(`return !!document.querySelector('.drawer') ? document.querySelector('.drawer h3')?.textContent : null`)
  log('抽屉标题: ' + drawer)
  await cdp.shot('data/qa/r3-graph-drawer.png')
}
await cdp.close()
