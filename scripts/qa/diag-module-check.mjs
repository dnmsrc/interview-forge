// 判定「浏览器加载的 PracticeView 模块」与「dev server 当前编译结果」是否一致
import { Cdp, sleep } from './cdp.mjs'
const cdp = await Cdp.connect()
await cdp.metrics(1460, 920)
await cdp.evaluate('location.hash = "#/practice"; return 1')
await sleep(2500)
const out = await cdp.evaluate(`return (async function(){
  const urls = performance.getEntriesByType('resource').map((e) => e.name).filter((u) => /PracticeView/.test(u));
  const used = urls[0] || null;
  const probe = async (u, cache) => { try { const r = await fetch(u, { cache }); const t = await r.text(); return { status: r.status, hasSubmit: /practice-submit/.test(t), hasNext: /practice-next/.test(t), len: t.length } } catch (e) { return { err: String(e.message).slice(0, 60) } } };
  const sameUrlDefault = used ? await probe(used, 'default') : null;
  const sameUrlReload = used ? await probe(used, 'reload') : null;
  const plain = await probe('/src/views/PracticeView.vue', 'reload');
  return { usedUrls: urls.slice(0, 3), sameUrlDefault, sameUrlReload, plain,
    dom: { tids: [...document.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid')),
           actBtns: [...document.querySelectorAll('.act-row button')].map((b) => (b.getAttribute('data-testid') || 'NO-TID:' + b.className.split(' ')[0]) + '|' + b.innerText.trim().slice(0, 10)) } };
})()`)
console.log(JSON.stringify(out, null, 1))
await cdp.close()
