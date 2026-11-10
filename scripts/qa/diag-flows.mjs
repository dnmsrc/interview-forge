// 诊断 A/C/D 三组失败：图谱节点是否渲染、home 按钮是否被遮挡、练习提交后卡在哪个状态
import { Cdp, sleep } from './cdp.mjs'
const cdp = await Cdp.connect()
await cdp.metrics(1460, 920)

async function probeHash(hash, waitMs = 2600) {
  await cdp.evaluate(`location.hash = ${JSON.stringify(hash)}; return 1`)
  await sleep(waitMs)
  return cdp.evaluate(`return (function(){
    const q = (s) => document.querySelectorAll(s).length;
    const wrap = document.querySelector('.graph-wrap');
    const rw = wrap && wrap.getBoundingClientRect();
    const start = document.querySelector('[data-testid="home-start"]');
    let cover = null;
    if (start) {
      const r = start.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      cover = top ? (top.tagName + '.' + String(top.className || '')).slice(0, 60) : 'null';
      window.__startRect = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    }
    return {
      hash: location.hash,
      counts: { vfNode: q('.vf-node'), vueFlow: q('.vue-flow'), graphWrap: q('.graph-wrap'), stem: q('.stem'), opt: q('.opt'), fb: q('.fb'), skel: q('.skeleton'), msg: q('.n-message'), notif: q('.n-notification-wrapper'), modal: q('.n-modal-body-wrapper,.n-dialog') },
      graphWrap: rw ? { w: Math.round(rw.width), h: Math.round(rw.height) } : null,
      startRect: start ? window.__startRect : null,
      startCovered: cover,
      bodyHead: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 170)
    };
  })()`)
}

console.log('--- /graph ---')
console.log(JSON.stringify(await probeHash('#/graph', 4000), null, 1))
console.log('--- / ---')
console.log(JSON.stringify(await probeHash('#/', 2500), null, 1))
console.log('--- /practice ---')
console.log(JSON.stringify(await probeHash('#/practice', 3500), null, 1))

// 练习：作答 → 提交 → 每 5s 打一次状态，最多 40s
await cdp.evaluate(`return (function(){
  const opt = document.querySelector('.opt'); if (opt) opt.click();
  const b = document.querySelector('[data-testid="practice-submit"]'); if (b) b.click();
  return !!b;})()`)
for (let i = 0; i < 8; i++) {
  await sleep(5000)
  const st = await cdp.evaluate(`return (function(){
    const q = (s) => document.querySelectorAll(s).length;
    return { t: ${''}Date.now() % 100000, submitBtn: q('[data-testid="practice-submit"]'), nextBtn: q('[data-testid="practice-next"]'),
      fb: q('.fb'), skel: q('.skeleton'), acc: q('details.acc'), msg: [...document.querySelectorAll('.n-message')].map(m=>m.innerText.trim().slice(0,40)),
      txt: document.body.innerText.replace(/\\s+/g,' ').slice(0, 150) };
  })()`)
  console.log(i * 5 + 's', JSON.stringify(st))
}
await cdp.shot('data/qa/diag-practice-after-submit.png')
await cdp.close()
