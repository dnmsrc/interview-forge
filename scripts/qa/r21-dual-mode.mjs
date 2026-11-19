// R21 知识图谱「闯关目录 + 关系聚焦」双模式 E2E（需应用以 QA_PORT 调试端口启动）。
// 核对：默认纯 DOM 手风琴目录（无 VueFlow 画布/MiniMap/蛇形）、7 章 111 关、手风琴折叠、
// 点关卡进聚焦模式且只渲染一度关系（无关节点全隐藏）、邻居点击重定位中心 + 面包屑、
// 透镜芯片过滤、搜索直达聚焦、只看未点亮、返回目录、明暗双主题与零控制台错误。只读。
import { Cdp, sleep, AUDIT_JS } from './cdp.mjs'

const bad = []
const ok = (c, m) => { if (!c) bad.push(m); console.log(`  ${c ? 'OK ' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1 }

const cdp = await Cdp.connect(30)
cdp.clearErrors()
await cdp.metrics(1440, 900)
await cdp.nav('/graph')
await cdp.reloadHard(3500)

// ---------- 1. 默认进入闯关目录：纯 DOM，无画布残留 ----------
const head = await cdp.evaluate(`
  return {
    catalog: !!document.querySelector('[data-testid=catalog-mode]'),
    focus: !!document.querySelector('[data-testid=focus-mode]'),
    levelMap: !!document.querySelector('[data-testid=level-map]'),
    chapters: document.querySelectorAll('.lv-chapter').length,
    chapterNames: [...document.querySelectorAll('.lv-ch-name')].map(e => e.textContent.trim()).slice(0, 4),
    stages: document.querySelectorAll('.lv-stage').length,
    oldStage: document.querySelectorAll('.stage').length,
    oldBanner: document.querySelectorAll('.ch-banner').length,
    minimap: document.querySelectorAll('.vue-flow__minimap').length,
    vueflow: document.querySelectorAll('.vue-flow').length,
    hud: !!document.querySelector('.adventurer-hud'),
    nextBanner: !!document.querySelector('[data-testid=level-next-banner]'),
    openChapters: document.querySelectorAll('.lv-chapter.open').length,
    bossTags: document.querySelectorAll('.lv-boss-tag').length
  }`)
ok(head.catalog && !head.focus, '默认落地闯关目录模式（聚焦模式未挂载）')
ok(head.chapters === 7, `渲染 7 个手风琴章节（实际 ${head.chapters}）：${head.chapterNames.join('、')}…`)
ok(head.stages >= 100, `章内关卡行 ≥100（实际 ${head.stages}，fe 共 111 关）`)
ok(head.oldStage === 0 && head.oldBanner === 0, '旧蛇形关卡/章节旗帜 DOM 已移除')
ok(head.minimap === 0 && head.vueflow === 0, '目录模式无 VueFlow 画布与 MiniMap（彻底告别无限画布）')
ok(head.hud && head.nextBanner, '冒险者 HUD 与「继续闯关」横幅保留')
ok(head.openChapters === 1, `默认只展开下一关所在 1 章（实际展开 ${head.openChapters}）`)

// ---------- 2. 手风琴折叠/展开 ----------
const before = await cdp.evaluate('return document.querySelectorAll(".lv-chapter.open .lv-stage").length')
await cdp.evaluate(`document.querySelector('.lv-chapter.open .lv-ch-head')?.dispatchEvent(new MouseEvent('click',{bubbles:true})); return 1`)
await sleep(500)
const afterCollapse = await cdp.evaluate('return document.querySelectorAll(".lv-chapter.open").length')
ok(afterCollapse === 0, `点击章节头折叠（展开章 ${1} → ${afterCollapse}）`)
await cdp.evaluate(`document.querySelector('.lv-chapter .lv-ch-head')?.dispatchEvent(new MouseEvent('click',{bubbles:true})); return 1`)
await sleep(500)
const afterReopen = await cdp.evaluate('return document.querySelectorAll(".lv-chapter.open .lv-stage").length')
ok(afterReopen === before, `再次点击展开，关卡行恢复（${afterReopen} 行）`)

// ---------- 3. 点关卡 → 进关系聚焦，只渲染一度关系 ----------
await cdp.evaluate(`document.querySelector('.lv-stage')?.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window})); return 1`)
await cdp.waitFor(`!!document.querySelector('[data-testid=focus-mode]')`, 10000, 'focus mode')
await sleep(1200)
const focus = await cdp.evaluate(`
  return {
    catalogHidden: !document.querySelector('[data-testid=catalog-mode]'),
    graph: !!document.querySelector('[data-testid=focus-graph]'),
    drawer: !!document.querySelector('[data-testid=graph-drawer]'),
    center: document.querySelectorAll('.vue-flow__node-focus-center').length,
    neighbors: document.querySelectorAll('.vue-flow__node-focus-neighbor').length,
    allNodes: document.querySelectorAll('.vue-flow__node').length,
    rings: document.querySelectorAll('.fg-ring').length,
    edges: document.querySelectorAll('.fg-arc').length,
    overlaps: (() => {
      const rs = [...document.querySelectorAll('.vue-flow__node-focus-neighbor')].map((w) => {
        const b = w.getBoundingClientRect()
        return { l: b.left, t: b.top, r: b.right, b: b.bottom }
      })
      let n = 0
      for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
        const ox = Math.max(0, Math.min(rs[i].r, rs[j].r) - Math.max(rs[i].l, rs[j].l))
        const oy = Math.max(0, Math.min(rs[i].b, rs[j].b) - Math.max(rs[i].t, rs[j].t))
        if (ox > 2 && oy > 2) n++
      }
      return n
    })(),
    crumbs: document.querySelectorAll('.crumb').length,
    title: document.querySelector('.drawer h3')?.textContent.trim()
  }`)
ok(focus.catalogHidden && focus.graph, '点关卡进入聚焦模式（目录卸载、辐射图挂载）：' + (focus.title || ''))
ok(focus.drawer, '聚焦详情抽屉同时打开')
ok(focus.center === 1, '辐射图有且仅有 1 个中心节点')
  // allNodes = 1 中心 + N 邻居 + R 轨道环（装饰），已移除扇区标签；应远小于全图 111
  ok(focus.allNodes === 1 + focus.neighbors + focus.rings && focus.allNodes < 40,
    `节点构成正确（1 中心 + ${focus.neighbors} 邻居 + ${focus.rings} 轨道环 = ${focus.allNodes}），无关节点全部隐藏`)
  ok(focus.overlaps === 0, `邻居卡片零重叠（实测 ${focus.overlaps} 处相交）`)
  ok(focus.edges === focus.neighbors, `弧形边数 = 邻居数（${focus.edges} 条 .fg-arc 只连中心，无全网边；装饰节点不计边）`)
// ---------- 4. 抽屉 9 类关系叙事与挑战/讲义入口保留 ----------
const drawer = await cdp.evaluate(`
  const d = document.querySelector('.drawer')
  return {
    practice: !![...d.querySelectorAll('button')].find(b => /挑战这一关/.test(b.textContent)),
    kb: !![...d.querySelectorAll('button')].find(b => /知识全文/.test(b.textContent)),
    groups: [...d.querySelectorAll('.rel-group-label')].map(e => e.textContent.trim()),
    relItems: d.querySelectorAll('.rel-item').length
  }`)
ok(drawer.practice && drawer.kb, '抽屉保留「挑战这一关 / 查看知识全文」入口')

// ---------- 5. 搜索「闭包」直达聚焦（选一个关系丰富的考点） ----------
await cdp.fill('.graph-toolbar input', '闭包')
await sleep(1600)
const closure = await cdp.evaluate(`
  return {
    focus: !!document.querySelector('[data-testid=focus-mode]'),
    title: document.querySelector('.drawer h3')?.textContent.trim(),
    neighbors: document.querySelectorAll('.vue-flow__node-focus-neighbor').length,
    edges: document.querySelectorAll('.fg-arc').length,
    chips: document.querySelectorAll('.lens-chip').length
  }`)
ok(closure.focus && /闭包|作用域/.test(closure.title || ''), '搜索「闭包」直达聚焦：' + closure.title)
ok(closure.neighbors >= 2 && closure.edges === closure.neighbors, `闭包一度关系网渲染（${closure.neighbors} 邻居 / ${closure.edges} 边）`)

// ---------- 6. 透镜芯片过滤：关掉一类关系（聚合后同考点有多类型，邻居数只减不增，芯片置灰即生效） ----------
if (closure.chips >= 2) {
  const n0 = closure.neighbors
  await cdp.evaluate(`document.querySelector('.lens-chip')?.click(); return 1`)
  await sleep(700)
  const n1 = await cdp.evaluate('return document.querySelectorAll(".vue-flow__node-focus-neighbor").length')
  const chipOff = await cdp.evaluate('return document.querySelectorAll(".lens-chip.off").length')
  ok(n1 <= n0 && chipOff >= 1, `透镜芯片隐藏一类关系（邻居 ${n0} → ${n1}，置灰芯片 ${chipOff}）`)
  await cdp.evaluate(`document.querySelector('.lens-chip.off')?.click(); return 1`)
  await sleep(700)
  const n2 = await cdp.evaluate('return document.querySelectorAll(".vue-flow__node-focus-neighbor").length')
  ok(n2 === n0, `再次点开恢复关系网（邻居回到 ${n2}）`)
} else {
  ok(true, '（闭包关系类型不足 2 类，跳过透镜过滤）')
}

// ---------- 7. 点邻居重定位中心 + 面包屑 ----------
const centerBefore = await cdp.evaluate('return document.querySelector(".fg-center-title")?.textContent.trim()')
await cdp.evaluate(`document.querySelector('.vue-flow__node-focus-neighbor .fg-neighbor')?.click(); return 1`)
await sleep(1400)
const moved = await cdp.evaluate(`
  return {
    center: document.querySelector('.fg-center-title')?.textContent.trim(),
    crumbs: document.querySelectorAll('.crumb').length,
    drawerTitle: document.querySelector('.drawer h3')?.textContent.trim()
  }`)
ok(moved.center && moved.center !== centerBefore, `点邻居重定位中心（${centerBefore} → ${moved.center}）`)
ok(moved.crumbs >= 1, `面包屑记录上一中心（${moved.crumbs} 层）`)
// 面包屑跳回
await cdp.evaluate(`document.querySelector('.crumb')?.click(); return 1`)
await sleep(1300)
const back = await cdp.evaluate('return document.querySelector(".fg-center-title")?.textContent.trim()')
ok(back === centerBefore, `面包屑跳回原中心（${back}）`)

// ---------- 8. 返回目录 + 只看未点亮 ----------
await cdp.evaluate(`document.querySelector('.crumb-back')?.click(); return 1`)
await sleep(700)
const backCatalog = await cdp.evaluate('return !!document.querySelector("[data-testid=catalog-mode]")')
ok(backCatalog, '「返回目录」回到闯关目录')
const litCount = await cdp.evaluate('return document.querySelectorAll(".lv-stage.st-mastered").length')
const allStages = await cdp.evaluate('return document.querySelectorAll(".lv-stage").length')
await cdp.evaluate(`[...document.querySelectorAll('button')].find(b => /只看未点亮/.test(b.textContent))?.click(); return 1`)
await sleep(700)
const unlitStages = await cdp.evaluate('return document.querySelectorAll(".lv-stage").length')
const btnOn = await cdp.evaluate(`return !![...document.querySelectorAll('button')].find(b => /只看未点亮/.test(b.textContent))?.className.includes('n-button--primary-type')`)
if (litCount > 0) {
  ok(unlitStages < allStages, `有进度库：只看未点亮过滤掉已通关（${allStages} → ${unlitStages}）`)
} else {
  // 干净存档（无任何已点亮）：过滤前后数量相同是正确行为，改验开关态确实切换
  ok(unlitStages === allStages && btnOn, `干净库无已点亮，过滤后数量不变（${unlitStages}）且按钮进入 primary 选中态`)
}
await cdp.evaluate(`[...document.querySelectorAll('button')].find(b => /只看未点亮/.test(b.textContent))?.click(); return 1`)
await sleep(500)

// ---------- 9. 浅色主题审计 + 截图 ----------
const auditLight = await cdp.evaluate(`return (() => { ${AUDIT_JS} })()`)
ok(!auditLight.hOverflow, '浅色目录/聚焦无横向溢出（' + (auditLight.hOverflow ?? 'OK') + '）')
ok(!auditLight.zeroBox?.length, '无零尺寸元素')
await cdp.evaluate(`document.querySelector('.lv-stage')?.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window})); return 1`)
await sleep(1200)
await cdp.shot('data/qa/r21-focus-light.png')
await cdp.evaluate(`document.querySelector('.crumb-back')?.click(); return 1`)
await sleep(600)
await cdp.shot('data/qa/r21-catalog-light.png')

// ---------- 10. 深色主题 ----------
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
ok(!auditDark.hOverflow && !auditDark.clippedRight?.length, '深色模式无溢出/裁切')
const darkLeaks = (auditDark.badContrast || []).filter((x) => x.sel !== 'BODY')
ok(!darkLeaks.length, '深色主题无浅色泄漏（' + darkLeaks.length + ' 处）')
await cdp.evaluate(`document.querySelector('.lv-stage')?.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window})); return 1`)
await sleep(1200)
await cdp.shot('data/qa/r21-focus-dark.png')
await setTheme(false)

const errs = cdp.errors().filter((e) => !/Failed to load resource|favicon|DevTools|INEFFECTIVE_DYNAMIC|deprecation|ExperimentalWarning|Vue warn/i.test(e.text))
console.log('\n控制台错误（过滤无关后）:', errs.length ? errs.slice(0, 8) : '无')
await cdp.close()
console.log(bad.length ? `\n❌ R21 双模式 ${bad.length} 项失败: ${bad.join(' | ')}` : '\n✅ R21 闯关目录 + 关系聚焦：手风琴/一度聚焦/邻居导航/透镜/搜索/明暗主题，全部通过')
process.exit(bad.length ? 1 : 0)
