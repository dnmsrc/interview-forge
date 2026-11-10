// 检测 ✕ 点击点被谁占据 + DOM click 逻辑验证
import { Cdp, sleep } from './cdp.mjs'
const cdp = await Cdp.connect()
await cdp.metrics(1460, 920)
await cdp.evaluate("location.hash = '#/graph'; return 1")
await sleep(3000)
await cdp.clickSel('.vf-node', 3)
await sleep(900)

const r = await cdp.evaluate(`
  const btn = [...document.querySelectorAll('.drawer button')].find((b) => b.textContent.includes('✕'));
  if (!btn) return { err: 'no drawer btn' };
  const br = btn.getBoundingClientRect();
  const cx = br.x + br.width / 2, cy = br.y + br.height / 2;
  const hit = document.elementFromPoint(cx, cy);
  return {
    btnRect: { x: Math.round(br.x), y: Math.round(br.y), w: Math.round(br.width), h: Math.round(br.height) },
    point: [Math.round(cx), Math.round(cy)],
    hitEl: hit ? hit.tagName + '.' + String(hit.className).slice(0, 60) : null,
    hitIsBtnOrChild: hit ? (hit === btn || btn.contains(hit)) : false,
    parentChainTop: (() => { let e = hit, s = []; while (e && s.length < 5) { s.push(e.tagName + '.' + String(e.className).slice(0, 30)); e = e.parentElement } return s.join(' < ') })()
  }
`)
console.log(JSON.stringify(r, null, 1))

if (r.hitIsBtnOrChild) {
  // trusted 事件再点一次（用真实中心点）
  await cdp.mouse(r.point[0], r.point[1])
  await sleep(800)
  const afterTrusted = await cdp.evaluate(`return !document.querySelector('.drawer')`)
  console.log('trusted mouse 能关闭:', afterTrusted)
}
const closed = await cdp.evaluate(`
  const btn = [...document.querySelectorAll('.drawer button')].find((b) => b.textContent.includes('✕'));
  if (!btn) return 'already-closed';
  btn.click();
  await new Promise((res) => setTimeout(res, 700));
  return !document.querySelector('.drawer')
`)
console.log('DOM .click() 能关闭:', closed)
await cdp.close()
