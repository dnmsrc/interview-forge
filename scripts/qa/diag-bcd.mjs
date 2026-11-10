// 诊断：考试中弃考按钮在哪；抽屉 ✕ 为何关不掉；练习页 reload 后为何无题干
import { Cdp, sleep } from './cdp.mjs'
const log = (m) => process.stderr.write(`[d] ${m}\n`)
const cdp = await Cdp.connect()
await cdp.metrics(1460, 920)

// ---- 练习页 reload 后状态（A1 失败复现）----
cdp.clearErrors()
await cdp.evaluate("location.reload(); return 1").catch(() => {})
await sleep(3000)
await cdp.evaluate("location.hash = '#/practice'; return 1")
await sleep(4000)
const a = await cdp.evaluate(`return {
  hash: location.hash, stems: document.querySelectorAll('.stem').length,
  empty: document.querySelector('.n-empty')?.textContent || null,
  toast: [...document.querySelectorAll('.n-message__content,.n-notification__description,.n-modal h3,.n-card-header__main')].map(e=>e.textContent.trim()).slice(0,5).join(' || ') || '(无)',
  modalOpen: !!document.querySelector('.n-modal-body-wrapper,.n-modal-container .n-modal'),
  btns: [...document.querySelectorAll('button')].map(b=>b.textContent.trim()).filter(Boolean).slice(0, 20).join(' | '),
  errs: (window.__lastErrs||[]).length
}`)
log('练习页: ' + JSON.stringify(a))
for (const e of cdp.errors()) log('  err: ' + JSON.stringify(e).slice(0, 220))

// ---- 考试运行页：找弃考 ----
await cdp.evaluate("location.hash = '#/exam'; return 1")
await sleep(1200)
await cdp.clickSel('.stat', 0)
await sleep(2500)
const b = await cdp.evaluate(`return {
  timer: !!document.querySelector('.timer'),
  hasQuitText: document.body.innerText.includes('弃考'),
  quitBtns: [...document.querySelectorAll('button,.n-button')].filter(e=>e.textContent.includes('弃考')).map(e=>{const r=e.getBoundingClientRect();return {txt:e.textContent.trim(),w:Math.round(r.width),h:Math.round(r.height),y:Math.round(r.y)}}),
  topbar: [...document.querySelectorAll('.q-bar,.topbar,.row')].slice(0,3).map(e=>e.textContent.trim().slice(0,80)),
  allBtnTexts: [...document.querySelectorAll('.graph-wrap button, .page button')].map(e=>e.textContent.trim()).filter(t=>t && t.length<12).slice(0,25).join(' | ')
}`)
log('考试页: ' + JSON.stringify(b, null, 1))
await cdp.shot('data/qa/diag-exam-running.png')

// ---- 图谱抽屉关闭 ----
await cdp.evaluate("location.hash = '#/graph'; return 1")
await sleep(3000)
await cdp.clickSel('.vf-node', 3)
await sleep(900)
const c0 = await cdp.evaluate(`return { drawer: !!document.querySelector('.drawer'), xBtns: [...document.querySelectorAll('button,.n-button')].filter(e=>e.textContent.trim()==='✕'||e.textContent.includes('✕')).map(e=>{const r=e.getBoundingClientRect();return {txt:e.textContent.trim(),w:Math.round(r.width),y:Math.round(r.y),x:Math.round(r.x)}}) }`)
log('抽屉打开态: ' + JSON.stringify(c0))
if (c0.drawer && c0.xBtns.length) {
  const xb = c0.xBtns[0]
  await cdp.mouse(xb.x + 10, xb.y + 10)
  await sleep(700)
  const c1 = await cdp.evaluate(`return { drawerAfterClick: !!document.querySelector('.drawer'), detailStill: document.querySelector('.drawer h3')?.textContent || null }`)
  log('点 ✕ 后: ' + JSON.stringify(c1))
}
await cdp.close()
