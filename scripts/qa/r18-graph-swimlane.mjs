// @deprecated R19 起知识图谱已重构为「闯关世界地图」（见 r19-world-map.mjs），
// 本脚本依赖的 lane-* 泳道类与「学习路线/关联网」双视图均已移除，不再可运行，仅留作历史参考。
// R18 知识图谱「学习路线泳道」重构 E2E（需应用以 QA_PORT 调试端口启动）。
// 核对：默认 roadmap 视图、阶段泳道列头、模块头/关卡节点、下一步推荐学习边界、
// prereq 带箭头实线 + related 虚线、视图切换到关联网不回归、展开模块关卡、搜索定位、
// 节点详情抽屉、明暗双主题与零横向溢出。只读，不提交任何作答，不写用户数据。
import { Cdp, sleep, AUDIT_JS } from './cdp.mjs'

const bad = []
const ok = (c, m) => { if (!c) bad.push(m); console.log(`  ${c ? 'OK ' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1 }

const cdp = await Cdp.connect(25)
cdp.clearErrors()
await cdp.metrics(1500, 940)
await cdp.nav('/graph')
// 硬刷新：VueFlow 自定义节点类型与全局样式的 HMR 增量更新不完整，整页重载拿到干净的泳道渲染
await cdp.reloadHard(2800)

// ---------- 1. 默认进入 roadmap 泳道视图 ----------
const mode = await cdp.evaluate(`
  return {
    hasRouteBtn: !![...document.querySelectorAll('button')].find(b => /学习路线/.test(b.textContent)),
    hasNetworkBtn: !![...document.querySelectorAll('button')].find(b => /关联网/.test(b.textContent)),
    laneTitles: [...document.querySelectorAll('.lane-title-name')].map(e => e.textContent.trim()),
    laneHeads: document.querySelectorAll('.lane-head').length,
    laneCards: document.querySelectorAll('.lane-card').length,
    vfNodes: document.querySelectorAll('.vue-flow__node').length
  }`)
ok(mode.hasRouteBtn && mode.hasNetworkBtn, '工具栏含「学习路线 / 关联网」视图切换')
ok(mode.laneTitles.length >= 8, `渲染阶段泳道列头 ${mode.laneTitles.length} 个：${mode.laneTitles.slice(0, 6).join('、')}…`)
ok(mode.laneHeads >= 10, `泳道模块头 ≥10（实际 ${mode.laneHeads}，对应 12 个前端模块，只看未点亮可能过滤）`)
// 学习阶段顺序：页面基础(HTML) 必须排在 框架/工程化 之前
const iBase = mode.laneTitles.findIndex((t) => /页面基础|HTML/.test(t))
const iFrame = mode.laneTitles.findIndex((t) => /框架|生态/.test(t))
ok(iBase >= 0 && iFrame > iBase, `泳道按学习阶段排序（基础#${iBase} 早于 框架#${iFrame}）`)
ok(mode.vfNodes >= mode.laneHeads + mode.laneTitles.length, 'VueFlow 已渲染泳道节点')

// ---------- 2. 学习边界：下一步推荐高亮 ----------
const rec = await cdp.evaluate(`
  const el = document.querySelector('.lane-card.next-rec');
  if (!el) return { found: false }
  const dot = el.querySelector('.lane-state-dot');
  const ic = el.querySelector('.next-ic');
  const cs = getComputedStyle(el);
  return { found: true, title: el.querySelector('.lane-card-title')?.textContent.trim(),
    hasDot: !!dot, hasIcon: !!ic, animation: cs.animationName, border: cs.borderColor }`)
ok(rec.found, '存在「下一步推荐」学习边界关卡：' + (rec.title || '(无)'))
ok(rec.found && rec.hasIcon && rec.animation && rec.animation !== 'none', '推荐关卡带 sparkles 图标与呼吸高亮动画')

// ---------- 3. 连线：prereq 带箭头实线、related 虚线 ----------
const edges = await cdp.evaluate(`
  const paths = [...document.querySelectorAll('.vue-flow__edge-path')];
  const info = paths.map(p => { const cs = getComputedStyle(p); return { dash: cs.strokeDasharray, marker: p.parentElement?.querySelector('marker') ? 1 : 0 } });
  return { total: paths.length, dashed: info.filter(i => i.dash && i.dash !== 'none' && i.dash !== '').length,
    withMarker: document.querySelectorAll('.vue-flow__edge marker, marker').length }`)
ok(edges.total >= 8, `泳道已绘制关系连线 ${edges.total} 条（前置+层级+相关）`)
ok(edges.dashed >= 1, '存在虚线 related 横向关联边（' + edges.dashed + ' 条）')

// ---------- 4. 双击模块头折叠/展开（泳道默认全展开，双击先折叠、再双击恢复）----------
const beforeCards = await cdp.evaluate(`return document.querySelectorAll('.lane-card').length`)
// 合成 dblclick（CDP 真实鼠标坐标会被 VueFlow 画布平移层拦截，合成事件可靠触发节点 @dblclick）
await cdp.evaluate(`document.querySelector('.lane-head')?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,view:window,detail:2})); return 1`)
await sleep(1100)
const afterCollapse = await cdp.evaluate(`return document.querySelectorAll('.lane-card').length`)
ok(afterCollapse < beforeCards, `双击模块头折叠关卡（${beforeCards} → ${afterCollapse}）`)
// 再双击恢复
await cdp.evaluate(`document.querySelector('.lane-head')?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,view:window,detail:2})); return 1`)
await sleep(1100)
const afterReopen = await cdp.evaluate(`return document.querySelectorAll('.lane-card').length`)
ok(afterReopen >= beforeCards, `再次双击恢复展开（${afterCollapse} → ${afterReopen}）`)
const cardAudit = await cdp.evaluate(`
  const c = document.querySelector('.lane-card'); if (!c) return null;
  const r = c.getBoundingClientRect();
  return { w: Math.round(r.width), stateDot: !!c.querySelector('.lane-state-dot'), meta: c.querySelector('.lane-card-meta')?.textContent.trim() }`)
ok(!!cardAudit && cardAudit.w >= 200 && cardAudit.stateDot, '关卡卡尺寸正常且含状态圆点与题量元信息（宽' + cardAudit?.w + 'px）：' + (cardAudit?.meta || ''))

// ---------- 5. 点击关卡打开详情抽屉（合成 click，不回归）----------
await cdp.evaluate(`document.querySelector('.lane-card')?.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window})); return 1`)
await sleep(1200)
const drawer = await cdp.evaluate(`
  const d = document.querySelector('.drawer');
  return { open: !!d, hasPractice: !![...d?.querySelectorAll('button')||[]].find(b=>/开练/.test(b.textContent)),
    hasKb: !![...d?.querySelectorAll('button')||[]].find(b=>/知识全文/.test(b.textContent)) }`)
ok(drawer.open, '点击关卡打开节点详情抽屉')
ok(drawer.hasPractice && drawer.hasKb, '抽屉保留「开练考点 / 查看知识全文」入口')
// 关闭抽屉
await cdp.evaluate(`document.querySelector('[data-testid="graph-drawer-close"]')?.click(); return 1`).catch(() => {})
await sleep(600)

// ---------- 6. 切换到关联网视图（原 tidy-tree 不回归）----------
await cdp.evaluate(`return [...document.querySelectorAll('button')].find(b=>/关联网/.test(b.textContent))?.click()`)
await sleep(1600)
const net = await cdp.evaluate(`
  return { gnNodes: document.querySelectorAll('.gn').length, root: !!document.querySelector('.gn-root'),
    l2: document.querySelectorAll('.gn-l2').length, minimap: !!document.querySelector('.vue-flow__minimap'),
    controls: !!document.querySelector('.vue-flow__controls') }`)
ok(net.gnNodes >= 5 && net.root, '关联网视图渲染原层级树节点（gn/gn-root），能力不回归')
ok(net.minimap && net.controls, 'MiniMap 与缩放控件仍在')

// ---------- 7. 搜索定位（关联网视图下，沿用原搜索链路）----------
await cdp.fill('.graph-toolbar input', '闭包')
await sleep(1400)
const searchHit = await cdp.evaluate(`
  const d = document.querySelector('.drawer');
  return { drawerOpen: !!d, title: d?.querySelector('h3')?.textContent.trim() || '' }`)
ok(searchHit.drawerOpen && /闭包|作用域/.test(searchHit.title), '搜索「闭包」能定位并打开节点详情：' + searchHit.title)
await cdp.evaluate(`document.querySelector('[data-testid="graph-drawer-close"]')?.click(); return 1`).catch(() => {})
await cdp.fill('.graph-toolbar input', '')
await sleep(700)

// 切回泳道视图
await cdp.evaluate(`return [...document.querySelectorAll('button')].find(b=>/学习路线/.test(b.textContent))?.click()`)
await sleep(1400)

// ---------- 8. 浅色主题溢出审计 ----------
const auditLight = await cdp.evaluate(`return (() => { ${AUDIT_JS} })()`)
ok(!auditLight.hOverflow, '浅色泳道无横向溢出（' + (auditLight.hOverflow ?? 'OK') + '）')
ok(!auditLight.zeroBox?.length, '无零尺寸节点')
await cdp.shot('data/qa/r18-graph-roadmap-light.png')

// ---------- 9. 深色主题（走应用真实主题按钮，保证 naive-ui 与 body 背景同步）----------
async function setTheme(dark) {
  // 走应用真实主题按钮（cycle: light→dark→auto），最多点 3 次直到 data-theme 命中目标
  for (let i = 0; i < 3; i++) {
    const cur = await cdp.evaluate(`return document.documentElement.dataset.theme`)
    const want = dark ? 'dark' : 'light'
    if (cur === want && i > 0) break
    if (cur === want && !dark) break
    await cdp.evaluate(`const b=[...document.querySelectorAll('button')].find(x=>(x.title||'').includes('外观')); b?.click(); return !!b`)
    await sleep(650)
    const now = await cdp.evaluate(`return document.documentElement.dataset.theme`)
    if (now === want) break
  }
  // 兜底：若 auto 跟随系统仍不符，直接写 DOM 属性（CSS 变量按 [data-theme] 切换，body 背景随之变）
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
  return { theme: document.documentElement.dataset.theme, bodyBg: getComputedStyle(document.body).backgroundColor, avg: Math.round(avg) }`)
ok(dark.theme === 'dark' && dark.avg < 90, `深色主题生效（body=${dark.bodyBg}，亮度均值 ${dark.avg}）`)
const auditDark = await cdp.evaluate(`return (() => { ${AUDIT_JS} })()`)
ok(!auditDark.hOverflow && !auditDark.clippedRight?.length, '深色泳道无溢出/裁切')
// body 根容器在深色下本就该是深色（AUDIT 的 lightLeak 针对卡片/面板，根背景排除）
const darkLeaks = (auditDark.badContrast || []).filter((x) => x.sel !== 'BODY')
ok(!darkLeaks.length, '深色主题无浅色泄漏（' + darkLeaks.length + ' 处）')
await cdp.shot('data/qa/r18-graph-roadmap-dark.png')
await setTheme(false)

const errs = cdp.errors().filter((e) => !/Failed to load resource|favicon|DevTools|INEFFECTIVE_DYNAMIC|deprecation/i.test(e.text))
console.log('\n控制台错误（过滤无关后）:', errs.length ? errs.slice(0, 6) : '无')
await cdp.close()
console.log(bad.length ? `\n❌ R18 图谱泳道 ${bad.length} 项失败: ${bad.join(' | ')}` : '\n✅ R18 学习路线泳道：阶段列/学习边界/关系连线/视图切换/搜索抽屉/明暗主题/零溢出，全部通过')
process.exit(bad.length ? 1 : 0)
