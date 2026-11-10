// r6 UI 重设计验收：锁定 FORGE_QA 后台窗（URL 带 ?qa=1），逐页 × 主题 × 视口截图 + 机检。
// 用法：node scripts/qa/r6-ui.mjs [themes] [widths]  例：node scripts/qa/r6-ui.mjs light,dark 1440x900,900x720
import fs from 'node:fs'
import path from 'node:path'
import { Cdp, AUDIT_JS, sleep } from './cdp.mjs'

const PORT = process.env.QA_PORT || '9222'
const OUT = 'data/qa'
const THEMES = (process.argv[2] || 'light').split(',').filter(Boolean)
const VIEWS = (process.argv[3] || '1440x900').split(',').map((s) => {
  const [w, h] = s.split('x').map(Number)
  return { w, h }
})
const PAGES = [
  ['/', 'home'],
  ['/practice', 'practice'],
  ['/exam', 'exam'],
  ['/graph', 'graph'],
  ['/dashboard', 'dash'],
  ['/bank', 'bank'],
  ['/settings', 'settings']
]

function openWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const t = setTimeout(() => reject(new Error('WS 握手超时')), 9000)
    ws.onopen = () => { clearTimeout(t); resolve(ws) }
    ws.onerror = () => reject(new Error('WS error'))
    ws.onclose = (c) => reject(new Error(`WS close ${c.code}`))
  })
}
async function connectQa() {
  let lastErr = 'no attempt'
  for (let i = 0; i < 25; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const qa = list.filter((t) => t.type === 'page' && /qa=1/.test(t.url))
      const page = qa[0]
      if (!page?.webSocketDebuggerUrl) throw new Error('无 ?qa=1 目标，现有：' + list.map((t) => t.url).join(' | '))
      const cdp = new Cdp(await openWs(page.webSocketDebuggerUrl))
      await cdp.init()
      await cdp.ensureVisible()
      return cdp
    } catch (e) {
      lastErr = String(e?.message ?? e)
      await sleep(1500)
    }
  }
  throw new Error('连不上 QA 窗口：' + lastErr)
}

async function setTheme(cdp, mode) {
  await cdp.evaluate(`localStorage.setItem('forge.ui.theme', ${JSON.stringify(mode)}); return 1;`)
  await cdp.evaluate('location.reload(); return 1;').catch(() => {})
  await sleep(2600)
  await cdp.waitFor(`!!document.querySelector('.shell')`, 15000, 'shell 挂载').catch(() => {})
  await cdp.waitFor(`!!document.querySelector('.side-foot')`, 12000, 'store boot 完成').catch(() => {})
}

const report = []
const cdp = await connectQa()
console.log('已连接 QA 窗口')

/**
 * 补充机检：AUDIT_JS 只管横向溢出/右侧裁切/文字截断/对比度，抓不到两类"内容看不见"的问题：
 *  ① 容器高度塌缩或被自己的 overflow:hidden 裁掉（scrollHeight > clientHeight）——首页 hero 就踩过；
 *  ② 控件被兄弟/后继元素盖住，点不到（elementFromPoint 命中的不是自己也不是自己的后代）。
 */
const EXTRA_JS = `
  const clipped = [];
  for (const el of document.querySelectorAll('.card, .hero, .fb, .kpi, .stat, .panel-head, aside, details.acc, .grid > *, .page > *')) {
    const cs = getComputedStyle(el);
    if (cs.overflowY !== 'hidden' && cs.overflowY !== 'clip') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 60 || r.height < 14) continue;
    const lost = el.scrollHeight - el.clientHeight;
    if (lost > 4) clipped.push({ cls: String(el.className).slice(0, 30), lost, sh: el.scrollHeight, ch: el.clientHeight, txt: (el.innerText || '').replace(/\\s+/g, ' ').slice(0, 34) });
  }
  const covered = [];
  for (const el of document.querySelectorAll('button, a, [role="button"], input, textarea, .q-item, .tpl-card, .pill')) {
    const r = el.getBoundingClientRect();
    if (r.width < 22 || r.height < 12 || r.top < 0 || r.bottom > innerHeight) continue;
    const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2);
    const top = document.elementFromPoint(cx, cy);
    if (!top) continue;
    if (top === el || el.contains(top) || top.contains(el)) continue;
    covered.push({ cls: String(el.className).slice(0, 26), txt: (el.innerText || el.value || '').replace(/\\s+/g, ' ').slice(0, 24), by: top.tagName + '.' + String(top.className).split(' ')[0].slice(0, 22) });
  }
  return { clippedCount: clipped.length, clipped: clipped.slice(0, 6), coveredCount: covered.length, covered: covered.slice(0, 6) };
`

for (const theme of THEMES) {
  for (const { w, h } of VIEWS) {
    await setTheme(cdp, theme)
    await cdp.metrics(w, h, 1)
    for (const [hash, tag] of PAGES) {
      cdp.clearErrors()
      await cdp.nav(hash)
      await sleep(hash === '/graph' ? 2800 : 1500)
      const file = path.join(OUT, `r6-${tag}-${theme}-${w}x${h}.png`)
      let audit = null
      try { audit = await cdp.evaluate(`return (function(){${AUDIT_JS}})()`) } catch (e) { audit = { err: String(e?.message ?? e) } }
      let extra = null
      try { extra = await cdp.evaluate(`return (function(){${EXTRA_JS}})()`) } catch (e) { extra = { err: String(e?.message ?? e) } }
      try { await cdp.shot(file) } catch (e) { console.log(`  ! 截图失败 ${tag}: ${e?.message}`) }
      const errs = cdp.errors()
      const bad = (audit && !audit.err)
        ? [audit.hOverflow && `横向溢出(${audit.hOverflow})`,
            audit.clippedRight?.length && `右侧裁切×${audit.clippedRight.length}`,
            audit.textCut?.length && `文字截断×${audit.textCut.length}`,
            audit.zeroBox?.length && `零尺寸×${audit.zeroBox.length}`,
            audit.badContrast?.length && `深色残留×${audit.badContrast.length}`,
            extra?.clippedCount && `内容被裁×${extra.clippedCount}`,
            extra?.coveredCount && `控件被遮挡×${extra.coveredCount}`].filter(Boolean)
        : [`机检失败:${audit?.err}`]
      const line = `${theme} ${w}x${h} ${tag}: ${bad.length ? bad.join(' / ') : 'OK'}${errs.length ? ` | JS错误×${errs.length}` : ''}`
      report.push(line)
      console.log('  ' + line)
      if (audit && !audit.err) {
        for (const c of (audit.clippedRight ?? []).slice(0, 4)) console.log(`      裁切 ${c.tag}.${c.cls} "${c.txt}" right=${c.right}`)
        for (const c of (audit.textCut ?? []).slice(0, 4)) console.log(`      截断 ${c.tag}.${c.cls} "${c.txt}" sw=${c.sw} cw=${c.cw}`)
        for (const c of (audit.zeroBox ?? []).slice(0, 3)) console.log(`      零尺 ${c.tag}.${c.cls} "${c.txt}" ${c.w}x${c.h}`)
      }
      for (const c of (extra?.clipped ?? []).slice(0, 5)) console.log(`      内裁 .${c.cls} 少${c.lost}px (${c.ch}/${c.sh}) "${c.txt}"`)
      for (const c of (extra?.covered ?? []).slice(0, 5)) console.log(`      遮挡 .${c.cls} "${c.txt}" 被 ${c.by} 盖住`)
      for (const e of errs.slice(0, 3)) console.log(`      JS ${e.kind}: ${String(e.text).slice(0, 160)}`)
    }
  }
}
await cdp.clearMetrics()
await cdp.close()
fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, 'r6-report.txt'), report.join('\n') + '\n')
const fail = report.filter((l) => !l.endsWith('OK')).length
console.log(`\n完成：${report.length} 项检查，${fail} 项有问题`)
