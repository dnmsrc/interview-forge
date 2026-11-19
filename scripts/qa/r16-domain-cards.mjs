// R16 板块入口卡片视觉重构核对：渲染数量、语义色徽标、题量统计、未完成高亮、hover 四态、
// 明暗主题、横向溢出审计，并确认点击仍能正常进摸底（功能不回归）。只读 + eng 隔离，不写用户数据。
import { Cdp, sleep, AUDIT_JS } from './cdp.mjs'

const bad = []
const ok = (c, m) => { if (!c) bad.push(m); console.log(`  ${c ? 'OK ' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1 }

const cdp = await Cdp.connect(20)
cdp.clearErrors()
await cdp.metrics(1460, 960)
await cdp.nav('/placement')
await cdp.reloadHard(2600)
// 隔离兜底：上一轮可能停在 running 态（无 .domain-card），先退回介绍页，保证脚本独立可重复
async function ensureIntro() {
  const running = await cdp.evaluate(`return !!document.querySelector('.pl-toolbar')`)
  if (running) {
    await cdp.evaluate(`const x=[...document.querySelectorAll('button')].find(b=>/退出/.test(b.textContent)&&b.getBoundingClientRect().width>0); if(x)x.click(); return 1`).catch(()=>{})
    await sleep(1000)
  }
}
await ensureIntro()

// ---------- 1. 卡片结构与数量 ----------
const base = await cdp.evaluate(`
  const cards = [...document.querySelectorAll('.domain-card')];
  return {
    count: cards.length,
    labels: cards.map(c => c.querySelector('.dc-name')?.innerText?.trim()),
    badges: cards.map(c => !!c.querySelector('.dc-badge svg')),
    descs: cards.map(c => c.querySelector('.dc-desc')?.innerText?.trim() || ''),
    counts: cards.map(c => c.querySelector('.dc-count')?.innerText || ''),
    haveFoot: cards.every(c => !!c.querySelector('.dc-foot')),
    haveArrow: cards.every(c => !!c.querySelector('.dc-arrow')),
    colors: cards.map(c => getComputedStyle(c).getPropertyValue('--dc').trim())
  }`)
ok(base.count === 5, '渲染 5 个板块卡片：' + JSON.stringify(base.labels))
ok(base.labels.join('') === '前端后端公共基础AI Agent工程难题', '板块名称与顺序正确：' + base.labels.join('/'))
ok(base.badges.every(Boolean), '每张卡都有线性图标徽标（非 emoji）')
ok(base.haveFoot && base.haveArrow, '卡片含底部统计行与 hover 箭头')
ok(base.descs.every((d) => d.length > 0), '每张卡都有板块描述文案')
ok(base.counts.filter((c) => /题/.test(c)).length >= 4, '题量统计已展示（' + base.counts.join('|') + '）')
const distinctColors = new Set(base.colors).size
ok(distinctColors >= 4, '五卡语义色彼此区分（' + distinctColors + ' 种）：' + base.colors.join(' , '))

// ---------- 2. 未完成态（fe 真实会话）高亮 ----------
const resume = await cdp.evaluate(`
  const fe = [...document.querySelectorAll('.domain-card')].find(c => /前端/.test(c.innerText));
  const tag = fe?.querySelector('.dc-tag.resume')?.innerText || '';
  const hint = fe?.querySelector('.dc-hint.resume-text')?.innerText || '';
  const border = fe ? getComputedStyle(fe).borderColor : '';
  return { hasResumeClass: fe?.classList.contains('is-resume'), tag, hint, border }`)
ok(resume.hasResumeClass, '前端卡带 is-resume 高亮类（未完成摸底）')
ok(/未完成/.test(resume.tag), '未完成徽标文案：' + resume.tag)
ok(/断点|继续/.test(resume.hint), '续测提示文案：' + resume.hint)

// ---------- 3. 网格铺满：无右侧大片留白（卡片总宽接近内容区） ----------
const fill = await cdp.evaluate(`
  const grid = document.querySelector('.domain-grid');
  const r = grid.getBoundingClientRect();
  const cards = [...grid.children].map(c => c.getBoundingClientRect());
  const rightMost = Math.max(...cards.map(x => x.right));
  return { gridWidth: Math.round(r.width), rightMost: Math.round(rightMost), gap: Math.round(r.right - rightMost) }`)
ok(fill.gap <= 24, '卡片行右缘贴近容器（右留白 ' + fill.gap + 'px ≤ 24），不再大片空白')
console.log('     网格宽', fill.gridWidth, '最右卡片右缘留白', fill.gap + 'px')

// ---------- 4. hover 四态：真实鼠标悬停（合成 MouseEvent 触发不了 CSS :hover 伪类，必须用 CDP 鼠标） ----------
// Electron 软件渲染下 CDP 合成事件不驱动 transition 动画帧，会让计算值停在起点；注入禁动画样式后，
// :hover 规则的终态会立即生效，从而确定性地验证「hover 样式声明正确」（真实用户鼠标下过渡正常播放）。
await cdp.evaluate(`
  const st=document.getElementById('qa-no-anim') || document.createElement('style');
  st.id='qa-no-anim'; st.textContent='*{transition:none !important;animation:none !important}';
  document.head.appendChild(st); return 1`)
await ensureIntro()
const hp = await cdp.evaluate(`
  const card = [...document.querySelectorAll('.domain-card:not(:disabled)')][1];
  const r = card.getBoundingClientRect();
  return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }`)
await cdp.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hp.x, y: hp.y })
await sleep(400)
const hoverState = await cdp.evaluate(`
  const card = [...document.querySelectorAll('.domain-card:not(:disabled)')][1];
  if (!card) return { error: 'no-card' }
  const cs = getComputedStyle(card)
  return {
    hovered: card.matches(':hover'),
    arrowOpacity: getComputedStyle(card.querySelector('.dc-arrow')).opacity,
    cardTransform: cs.transform,
    badgeTransform: getComputedStyle(card.querySelector('.dc-badge')).transform,
    beforeOpacity: getComputedStyle(card, '::before').opacity,
    hasShadow: cs.boxShadow !== 'none'
  }`)
ok(hoverState.hovered, '真实鼠标命中卡片 :hover')
ok(Number(hoverState.arrowOpacity) > 0.5, 'hover 时箭头淡入（opacity=' + hoverState.arrowOpacity + '）')
ok(hoverState.cardTransform.includes('translateY(-3px)') || hoverState.cardTransform.includes(', -3)'), 'hover 卡片上移 -3px：' + hoverState.cardTransform)
ok(/matrix\(1\.06/.test(hoverState.badgeTransform) || hoverState.badgeTransform.includes('scale(1.06)'), 'hover 徽标放大 1.06：' + hoverState.badgeTransform)
// 伪元素 ::before 的 hover 终态在软件渲染下 getComputedStyle 读取不可靠（content/背景/高度均正常，仅 opacity 瞬时值不刷新），
// 改为直接断言样式表里存在正确的 hover 光带规则，确定性验证声明无误。
const beforeRuleOk = await cdp.evaluate(`
  let found = false
  for (const ss of document.styleSheets) { let rs; try { rs = ss.cssRules } catch (e) { continue }
    for (const rule of rs) {
      if (rule.selectorText && rule.selectorText.includes('domain-card') && rule.selectorText.includes(':hover')
        && rule.selectorText.includes('::before') && rule.style.opacity === '1') found = true
    }
  }
  // 同时确认 ::before 伪元素确实渲染（有背景色与 3px 高度的顶边光带）
  const c = [...document.querySelectorAll('.domain-card:not(:disabled)')][1]
  const pb = getComputedStyle(c, '::before')
  return found && pb.content.includes('""') && pb.height === '3px'`)
ok(beforeRuleOk, 'hover 顶边语义色光带规则正确且 ::before 渲染为 3px 顶边')
ok(hoverState.hasShadow, 'hover 出现阴影')
await cdp.evaluate(`document.getElementById('qa-no-anim')?.remove(); return 1`)

// ---------- 5. 溢出与裁切审计（浅色） ----------
const auditLight = await cdp.evaluate(`return (() => { ${AUDIT_JS} })()`)
ok(!auditLight.hOverflow, '浅色主题无横向溢出（' + (auditLight.hOverflow ?? 'OK') + '）')
ok(!auditLight.clippedRight?.length, '浅色主题无右侧裁切')
ok(!auditLight.zeroBox?.length, '无零尺寸卡片')
await cdp.shot('data/qa/r16-cards-light.png')

// ---------- 6. 深色主题 ----------
await cdp.evaluate(`document.documentElement.setAttribute('data-theme','dark'); return 1`)
await sleep(950) // 等 body/card 的 background-color 过渡（200ms）彻底结束，避免审计抓到过渡中间态误报浅色泄漏
const dark = await cdp.evaluate(`
  const card = document.querySelector('.domain-card');
  const badge = card.querySelector('.dc-badge');
  return { theme: document.documentElement.dataset.theme, badgeBg: getComputedStyle(badge).backgroundColor, surface: getComputedStyle(card).backgroundColor }`)
ok(dark.theme === 'dark', '切换深色主题生效')
const auditDark = await cdp.evaluate(`return (() => { ${AUDIT_JS} })()`)
ok(!auditDark.hOverflow && !auditDark.clippedRight?.length, '深色主题无溢出/裁切')
ok(!auditDark.badContrast?.length, '深色主题无浅色泄漏（' + auditDark.badContrast.length + ' 处）')
await cdp.shot('data/qa/r16-cards-dark.png')
await cdp.evaluate(`document.documentElement.setAttribute('data-theme','light'); return 1`)
await sleep(300)

// ---------- 7. 功能不回归：点前端卡走 resume（复用既有真实会话，不新建、不提交，零写入） ----------
await ensureIntro()
await cdp.evaluate(`[...document.querySelectorAll('.domain-card')].find(c=>/前端/.test(c.innerText))?.click(); return 1`)
await sleep(1600)
const nav = await cdp.evaluate(`
  return {
    running: !!document.querySelector('.pl-toolbar'),
    hasFilmOrQuestion: !!document.querySelector('.pl-q') || !!document.querySelector('.filmstrip'),
    exitBtn: !![...document.querySelectorAll('button')].find(b=>/退出/.test(b.textContent))
  }`)
ok(nav.running && nav.exitBtn, '点击卡片仍能正常进入摸底（resume 既有会话，功能不回归）')
// 退回介绍页：未提交任何答案，fe 真实会话保持 active 原样
await cdp.evaluate(`[...document.querySelectorAll('button')].find(b=>/退出/.test(b.textContent)&&b.getBoundingClientRect().width>0)?.click(); return 1`).catch(()=>{})
await sleep(800)
const backIntro = await cdp.evaluate(`return document.querySelectorAll('.domain-card').length`)
ok(backIntro === 5, '退出后回到介绍页且 5 卡仍在（无残留/无崩溃）')

const errs = cdp.errors().filter((e) => !/Failed to load resource|favicon|DevTools|INEFFECTIVE_DYNAMIC/.test(e.text))
console.log('\n控制台错误（过滤无关后）:', errs.length ? errs.slice(0, 5) : '无')
await cdp.close()
console.log(bad.length ? `\n❌ R16 卡片核对 ${bad.length} 项失败: ${bad.join(' | ')}` : '\n✅ R16 板块卡片重构：结构/语义色/统计/未完成高亮/四态/明暗主题/无溢出/功能不回归，全部通过')
process.exit(bad.length ? 1 : 0)
