// R33 只读探针：确认设置页出现「从零开始」入口、地图页页头出现「从零重做」
import { Cdp, sleep } from './cdp.mjs'

const cdp = await Cdp.connect()

// 1) 进度总账（只读）
const sum = await cdp.evaluate(`
  const r = await window.forge.progress.summary()
  return r
`)
console.log('summary =', JSON.stringify(sum, null, 2))

// 2) 设置页危险区
await cdp.nav('/settings')
await sleep(1500)
const settings = await cdp.evaluate(`
  const vis = (el) => {
    const st = getComputedStyle(el); if (st.display === 'none' || st.visibility === 'hidden') return false
    const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0
  }
  const row = [...document.querySelectorAll('.danger-reset')].find(vis)
  const btn = [...document.querySelectorAll('button')].find(b => vis(b) && /从头开始/.test(b.textContent || ''))
  return {
    hash: location.hash,
    hasRow: !!row,
    rowText: row ? row.textContent.trim().replace(/\\s+/g, ' ') : null,
    btnText: btn ? btn.textContent.trim().replace(/\\s+/g, ' ') : null,
    btnDisabled: btn ? !!btn.disabled : null,
    btnInView: btn ? (() => { const r = btn.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight })() : null,
  }
`)
console.log('settings =', JSON.stringify(settings, null, 2))
// 滚到危险区截图
await cdp.evaluate(`
  const row = document.querySelector('.danger-reset')
  if (row) row.scrollIntoView({ block: 'center', behavior: 'instant' })
  return 1
`)
await sleep(400)
await cdp.shot('data/qa/r33-settings-reset.png')

// 3) 地图页页头
await cdp.nav('/projects/mini-vue-reactivity')
await sleep(1400)
const board = await cdp.evaluate(`
  const vis = (el) => {
    const st = getComputedStyle(el); if (st.display === 'none' || st.visibility === 'hidden') return false
    const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0
  }
  const btn = [...document.querySelectorAll('button')].find(b => vis(b) && /从零重做/.test(b.textContent || ''))
  if (!btn) return { found: false }
  const r = btn.getBoundingClientRect()
  return {
    found: true,
    text: btn.textContent.trim().replace(/\\s+/g, ' '),
    disabled: !!btn.disabled,
    inView: r.top >= 0 && r.bottom <= innerHeight,
    top: Math.round(r.top), right: Math.round(r.right),
  }
`)
console.log('board =', JSON.stringify(board, null, 2))
await cdp.shot('data/qa/r33-board-header.png')
await cdp.close()