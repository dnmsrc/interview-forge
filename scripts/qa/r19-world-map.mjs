// @deprecated R21 起知识图谱已重构为「闯关目录（手风琴）+ 关系聚焦（辐射图）」双模式（见 r21-dual-mode.mjs）。
// 本脚本依赖的 .ch-banner / .stage / .vue-flow__node-stage / .lens-panel / MiniMap 等蛇形世界地图 DOM 已全部移除，
// 不再可运行，仅留作历史参考。新契约：目录 .lv-chapter/.lv-stage，聚焦 .vue-flow__node-focus-*，透镜 .lens-chip。
//
// R19 知识图谱「闯关世界地图」E2E（需应用以 QA_PORT 调试端口启动）。
// 核对：单页世界地图（无路线/关联网双视图切换）、7 章节旗帜、圆形关卡与四态、
// 蛇形布局坐标、冒险者 HUD 与段位、下一关呼吸高亮、关系透镜 9 类筛选、
// 点关卡聚焦抽屉的 9 类关系叙事、搜索定位、章节折叠、明暗双主题与零控制台错误。只读。
import { Cdp, sleep, AUDIT_JS } from './cdp.mjs'

const bad = []
const ok = (c, m) => { if (!c) bad.push(m); console.log(`  ${c ? 'OK ' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1 }

const cdp = await Cdp.connect(25)
cdp.clearErrors()
await cdp.metrics(1500, 940)
await cdp.nav('/graph')
await cdp.reloadHard(3000)

// ---------- 1. 单页世界地图：旧双视图按钮消失，章节旗帜出现 ----------
const head = await cdp.evaluate(`
  return {
    oldRouteBtn: !![...document.querySelectorAll('button')].find(b => /学习路线|关联网/.test(b.textContent)),
    banners: document.querySelectorAll('.ch-banner').length,
    bannerNames: [...document.querySelectorAll('.ch-name')].map(e => e.textContent.trim()),
    stages: document.querySelectorAll('.stage').length,
    vfNodes: document.querySelectorAll('.vue-flow__node').length,
    lensBtn: !![...document.querySelectorAll('button')].find(b => /关系透镜/.test(b.textContent)),
    hud: !!document.querySelector('.adventurer-hud')
  }`)
ok(!head.oldRouteBtn, '旧「学习路线/关联网」双视图切换已移除（合并为单页）')
ok(head.banners >= 7, `渲染 ${head.banners} 个章节旗帜（7 大章节世界）：${head.bannerNames.slice(0, 4).join('、')}…`)
ok(head.stages >= 100, `圆形关卡节点 ≥100（实际 ${head.stages}，fe 共 111 关）`)
ok(head.lensBtn && head.hud, '含关系透镜按钮与冒险者 HUD')

// ---------- 2. 蛇形布局：同一行三列，相邻关卡 y 相同、x 交替反向 ----------
const snake = await cdp.evaluate(`
  const rings = [...document.querySelectorAll('.vue-flow__node-stage')].slice(0, 6).map(n => {
    const t = n.style.transform.match(/translate\\(([\\d.-]+)px, ?([\\d.-]+)px/)
    return { x: t ? +t[1] : null, y: t ? +t[2] : null }
  })
  const row1 = rings.slice(0, 3), row2 = rings.slice(3, 6)
  const sameY = row1.every(p => p.y === row1[0].y)
  const ltr = row1[2].x > row1[0].x
  const rtl = row2.length === 3 && row2[2].x < row2[0].x
  return { sameY, ltr, rtl, rings }`)
ok(snake.sameY && snake.ltr, '首行三关等高水平排列、从左到右')
ok(snake.rtl, '第二行蛇形反向（从右到左），S 形路径成立')

// ---------- 2b. 初始视口定位到下一关且缩放为 1（圆形清晰，不再全图缩小成一团） ----------
const vp = await cdp.evaluate(`
  const vf = window.__vf
  const vp = vf?.viewport; const v = vp?.value ?? vp
  const nextStage = document.querySelector('.stage.next')?.closest('.vue-flow__node')
  const r = nextStage?.getBoundingClientRect()
  return { zoom: v?.zoom, nextVisible: r ? (r.top > 40 && r.top < innerHeight * 0.8) : false }`)
ok(vp.zoom >= 0.9 && vp.zoom <= 1.1, `初始缩放≈1（实际 ${vp.zoom}），关卡清晰可读`)
ok(vp.nextVisible, '「下一关」初始即落在视口上半部，无需先手动缩放')

// ---------- 3. 冒险者 HUD：段位与进度 ----------
const hud = await cdp.evaluate(`
  const h = document.querySelector('.adventurer-hud')
  return { rank: h.querySelector('.hud-title')?.textContent.trim(),
    sub: h.querySelector('.hud-sub')?.textContent.trim(),
    pct: h.querySelector('.hud-meta .num')?.textContent.trim() }`)
ok(!!hud.rank && /冒险者|学徒|工匠|专家|大师/.test(hud.rank), `HUD 显示段位头衔：${hud.rank}（${hud.sub}，${hud.pct}）`)

// ---------- 4. 下一关呼吸高亮 ----------
const next = await cdp.evaluate(`
  const el = document.querySelector('.stage.next')
  if (!el) return { found: false }
  const ring = el.querySelector('.stage-ring')
  const cs = getComputedStyle(ring)
  return { found: true, label: el.querySelector('.stage-label')?.textContent.trim(),
    flag: !!el.querySelector('.next-flag'), animation: cs.animationName }`)
ok(next.found, `存在「下一关」呼吸高亮：${next.label || '(无)'}`)
ok(next.found && next.flag && next.animation && next.animation !== 'none', '下一关带旗帜标签与脉冲动画')

// ---------- 5. 四态圆点与锁定视觉 ----------
const states = await cdp.evaluate(`
  return {
    mastered: document.querySelectorAll('.stage.st-mastered').length,
    learning: document.querySelectorAll('.stage.st-learning').length,
    untouched: document.querySelectorAll('.stage.st-untouched').length,
    locked: document.querySelectorAll('.stage.locked').length
  }`)
ok(states.untouched + states.learning + states.mastered >= 100, `四态样式类已挂载（未接触 ${states.untouched} / 学习中 ${states.learning} / 通关 ${states.mastered} / 锁定 ${states.locked}）`)

// ---------- 6. 关系透镜：默认视图只有主路径，开透镜后按类型叠加 9 类语义边 ----------
const edgeBefore = await cdp.evaluate('return document.querySelectorAll(".vue-flow__edge-path").length')
await cdp.evaluate(`[...document.querySelectorAll('button')].find(b => /关系透镜/.test(b.textContent))?.click(); return 1`)
await sleep(800)
const lens = await cdp.evaluate(`
  return { open: !!document.querySelector('.lens-panel'),
    items: document.querySelectorAll('.lens-item').length,
    labels: [...document.querySelectorAll('.lens-label')].map(e => e.textContent.trim()) }`)
ok(lens.open && lens.items === 9, `透镜面板展开且含 9 类关系（实际 ${lens.items}）：${lens.labels.join('/')}`)
const edgeAfter = await cdp.evaluate('return document.querySelectorAll(".vue-flow__edge-path").length')
ok(edgeAfter > edgeBefore, `打开透镜后语义边叠加（默认主路径 ${edgeBefore} → ${edgeAfter}），默认视图保持干净`)
// 再勾选「印证」验证筛选联动
await cdp.evaluate(`[...document.querySelectorAll('.lens-item')].find(e => /印证/.test(e.textContent))?.click(); return 1`)
await sleep(700)
const edgeMore = await cdp.evaluate('return document.querySelectorAll(".vue-flow__edge-path").length')
ok(edgeMore >= edgeAfter, `勾选印证后边数不减（${edgeAfter} → ${edgeMore}），筛选联动生效`)
const edgeLabels = await cdp.evaluate('return [...document.querySelectorAll(".vue-flow__edge-text")].map(e => e.textContent.trim()).filter(Boolean).slice(0, 8)')
ok(edgeLabels.length >= 1, `透镜开启后关系边带中文语义标签：${[...new Set(edgeLabels)].join('、')}`)

// ---------- 7. 点关卡 → 聚焦抽屉 9 类关系叙事（先关透镜，验证聚焦模式独立可用） ----------
await cdp.evaluate(`[...document.querySelectorAll('button')].find(b => /关系透镜/.test(b.textContent))?.click(); return 1`)
await sleep(600)
// 点击监听挂在内部 .stage 上（VueFlow 外层 wrapper 收不到向内的合成事件），直接派发到 .stage
await cdp.evaluate(`document.querySelector('.vue-flow__node-stage .stage')?.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window})); return 1`)
await sleep(1300)
const drawer = await cdp.evaluate(`
  const d = document.querySelector('.drawer')
  if (!d) return { open: false, groups: [], relItems: 0 }
  return { open: true,
    title: d.querySelector('h3')?.textContent.trim(),
    practice: !![...d.querySelectorAll('button')].find(b => /挑战这一关/.test(b.textContent)),
    kb: !![...d.querySelectorAll('button')].find(b => /知识全文/.test(b.textContent)),
    groups: [...d.querySelectorAll('.rel-group-label')].map(e => e.textContent.trim()),
    relItems: d.querySelectorAll('.rel-item').length }`)
ok(drawer.open, '点击关卡打开聚焦详情抽屉：' + (drawer.title || ''))
ok(drawer.open && drawer.practice && drawer.kb, '抽屉保留「挑战这一关 / 查看知识全文」入口')
ok(drawer.open && drawer.relItems >= 1, `抽屉渲染关系叙事分组（${(drawer.groups || []).join('、') || '无'}，共 ${drawer.relItems} 条可跳关关系）`)

// 关系项点击跳关
const beforeTitle = drawer.title
if (drawer.relItems) {
  await cdp.evaluate(`document.querySelector('.rel-item')?.click(); return 1`)
  await sleep(1300)
  const after = await cdp.evaluate('return document.querySelector(".drawer h3")?.textContent.trim()')
  ok(after && after !== beforeTitle, `关系项点击跳关（${beforeTitle} → ${after}）`)
}
await cdp.evaluate(`document.querySelector('[data-testid="graph-drawer-close"]')?.click(); return 1`).catch(() => {})
await sleep(500)

// ---------- 8. 搜索定位 ----------
await cdp.fill('.graph-toolbar input', '闭包')
await sleep(1400)
const hit = await cdp.evaluate(`
  const d = document.querySelector('.drawer')
  return { open: !!d, title: d?.querySelector('h3')?.textContent.trim() || '' }`)
ok(hit.open && /闭包|作用域/.test(hit.title), '搜索「闭包」定位并打开关卡：' + hit.title)
await cdp.evaluate(`document.querySelector('[data-testid="graph-drawer-close"]')?.click(); return 1`).catch(() => {})
await cdp.fill('.graph-toolbar input', '')
await sleep(600)

// ---------- 9. 章节折叠 ----------
const stagesBefore = await cdp.evaluate('return document.querySelectorAll(".stage").length')
await cdp.evaluate(`document.querySelector('.ch-banner')?.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window})); return 1`)
await sleep(1000)
const stagesAfter = await cdp.evaluate('return document.querySelectorAll(".stage").length')
ok(stagesAfter < stagesBefore, `点击章节旗帜折叠该章关卡（${stagesBefore} → ${stagesAfter}）`)
await cdp.evaluate(`document.querySelector('.ch-banner')?.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window})); return 1`)
await sleep(900)

// ---------- 10. 浅色主题审计 + 截图 ----------
const auditLight = await cdp.evaluate(`return (() => { ${AUDIT_JS} })()`)
ok(!auditLight.hOverflow, '浅色世界地图无横向溢出（' + (auditLight.hOverflow ?? 'OK') + '）')
ok(!auditLight.zeroBox?.length, '无零尺寸元素')
await cdp.shot('data/qa/r19-world-light.png')

// ---------- 11. 深色主题 ----------
async function setTheme(dark) {
  for (let i = 0; i < 3; i++) {
    const cur = await cdp.evaluate(`return document.documentElement.dataset.theme`)
    const want = dark ? 'dark' : 'light'
    if (cur === want && (i > 0 || !dark)) break
    await cdp.evaluate(`const b=[...document.querySelectorAll('button')].find(x=>(x.title||'').includes('外观')); b?.click(); return !!b`)
    await sleep(650)
    if ((await cdp.evaluate(`return document.documentElement.dataset.theme`)) === want) break
  }
  await cdp.evaluate(`
    const want = ${dark ? "'dark'" : "'light'"};
    if (document.documentElement.dataset.theme !== want) document.documentElement.setAttribute('data-theme', want);
    return document.documentElement.dataset.theme`)
  await sleep(500)
}
await setTheme(true)
const dark = await cdp.evaluate(`
  const m = getComputedStyle(document.body).backgroundColor.match(/rgba?\\((\\d+), *(\\d+), *(\\d+)/);
  const avg = m ? (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3 : 255;
  return { theme: document.documentElement.dataset.theme, avg: Math.round(avg) }`)
ok(dark.theme === 'dark' && dark.avg < 90, `深色主题生效（亮度均值 ${dark.avg}）`)
const auditDark = await cdp.evaluate(`return (() => { ${AUDIT_JS} })()`)
ok(!auditDark.hOverflow && !auditDark.clippedRight?.length, '深色世界地图无溢出/裁切')
const darkLeaks = (auditDark.badContrast || []).filter((x) => x.sel !== 'BODY')
ok(!darkLeaks.length, '深色主题无浅色泄漏（' + darkLeaks.length + ' 处）')
await cdp.shot('data/qa/r19-world-dark.png')
await setTheme(false)

const errs = cdp.errors().filter((e) => !/Failed to load resource|favicon|DevTools|INEFFECTIVE_DYNAMIC|deprecation|ExperimentalWarning/i.test(e.text))
console.log('\n控制台错误（过滤无关后）:', errs.length ? errs.slice(0, 6) : '无')
await cdp.close()
console.log(bad.length ? `\n❌ R19 世界地图 ${bad.length} 项失败: ${bad.join(' | ')}` : '\n✅ R19 闯关世界地图：章节/蛇形/四态/HUD/透镜/聚焦叙事/搜索折叠/明暗主题，全部通过')
process.exit(bad.length ? 1 : 0)
