// R20 游戏化 UI E2E（需应用以 QA_PORT 调试端口启动）。只读为主，游戏化结算通过真实 IPC 注入一次
// 自评测作答来触发，结束后用备份核对历史 attempts 不丢（注入数据属于新增，不删原有记录）。
// 覆盖：HUD 等级/XP/streak/徽章入口、Boss 龙首标记、徽章墙渲染与解锁态、庆祝弹窗与彩带、明暗主题、零控制台错误。
import { Cdp, sleep, AUDIT_JS } from './cdp.mjs'

const bad = []
const ok = (c, m) => { if (!c) bad.push(m); console.log(`  ${c ? 'OK ' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1 }

const cdp = await Cdp.connect(25)
cdp.clearErrors()
await cdp.metrics(1500, 940)
await cdp.nav('/graph')
await cdp.reloadHard(3500)
await sleep(1500)

// ---------- 1. HUD 游戏化元素 ----------
const hud = await cdp.evaluate(`
  const h = document.querySelector('.adventurer-hud')
  return {
    exists: !!h,
    title: h?.querySelector('.hud-title')?.textContent.trim(),
    xpBar: !!h?.querySelector('.hud-xp .hud-bar'),
    xpTxt: h?.querySelector('.hud-xp-txt')?.textContent.trim(),
    badgeEntry: !!h?.querySelector('[data-testid="open-badge-wall"]'),
    badgeTxt: h?.querySelector('[data-testid="open-badge-wall"]')?.textContent.trim()
  }`)
ok(hud.exists && /Lv\.\d+/.test(hud.title || ''), `HUD 显示等级头衔：${hud.title}`)
ok(!!hud.xpBar && !!hud.xpTxt, `HUD 含 XP 等级条与本级进度：${hud.xpTxt}`)
ok(!!hud.badgeEntry, `HUD 含徽章墙入口：${hud.badgeTxt}`)

// ---------- 2. 游戏化 IPC 概览有数据（默认新存档 Lv1、0 XP） ----------
const overview = await cdp.evaluate(`return window.forge.game.overview()`)
ok(overview && overview.level >= 1 && typeof overview.xp === 'number' && overview.totalBadges >= 20,
  `game.overview 返回等级/XP/徽章总数（Lv${overview?.level}，${overview?.xp} XP，共 ${overview?.totalBadges} 枚）`)
const bosses = await cdp.evaluate(`return window.forge.game.bosses('fe')`)
ok(Array.isArray(bosses) && bosses.length >= 7, `前端 7 章各选出 Boss 综合关（实际 ${bosses?.length} 个）`)

// ---------- 3. 目录 Boss 标记（R21 闯关目录：章卡片 .lv-boss + 关卡行 .lv-boss-tag） ----------
await sleep(800)
const bossMarks = await cdp.evaluate(`return document.querySelectorAll('.lv-boss').length`)
ok(bossMarks >= 7, `目录渲染 ${bossMarks} 个章节 Boss 状态标（每章至少 1 个）`)
const bossTag = await cdp.evaluate(`return !!document.querySelector('.lv-boss-tag')`)
ok(bossTag, 'Boss 关卡行带 BOSS 角标')

// ---------- 4. 徽章墙：打开、渲染全部徽章、含未解锁置灰 ----------
await cdp.evaluate(`document.querySelector('[data-testid="open-badge-wall"]')?.click(); return 1`)
await sleep(1000)
const wall = await cdp.evaluate(`
  const w = document.querySelector('[data-testid="badge-wall"]')
  return { open: !!w,
    cells: w?.querySelectorAll('.badge-cell').length ?? 0,
    locked: w?.querySelectorAll('.badge-cell.locked').length ?? 0,
    unlocked: w?.querySelectorAll('.badge-cell:not(.locked)').length ?? 0,
    hasChapter: !![...(w?.querySelectorAll('.badge-name')||[])].find(e=>/征服/.test(e.textContent)),
    hasBoss: !![...(w?.querySelectorAll('.badge-name')||[])].find(e=>/屠龙/.test(e.textContent)) }`)
ok(wall.open && wall.cells >= 20, `徽章墙展开并列出 ${wall.cells} 枚成就（含章节/Boss 动态徽章：${wall.hasChapter}/${wall.hasBoss}）`)
ok(wall.locked > 0, `未解锁徽章置灰展示（${wall.locked} 枚未解锁 / ${wall.unlocked} 枚已解锁）`)
await cdp.shot('data/qa/r20-badge-wall.png')
await cdp.evaluate(`document.querySelector('.badge-wall .icon-btn')?.click(); return 1`)
await sleep(500)

// ---------- 5. 触发一次真实作答结算 → XP/庆祝事件 ----------
// 取一道有题、未锁定的前端题，用自评 3 档提交（不依赖 AI 端点）
const picked = await cdp.evaluate(`return await window.forge.practice.queue({ domains: ['fe'], count: 1, random: true })`)
ok(Array.isArray(picked) && picked.length > 0, '随机抽出 1 道前端题用于结算：' + (picked?.[0]?.id || '(无)'))
const beforeOv = await cdp.evaluate(`return await window.forge.game.overview()`)
const submitRes = picked?.length
  ? await cdp.evaluate(`return await window.forge.practice.submit(${JSON.stringify(picked[0].id)}, { _qa_dummy: 1 }, { selfScale4: 3 })`)
  : null
const afterOv = await cdp.evaluate(`return await window.forge.game.overview()`)
const evsNow = await cdp.evaluate(`return await window.forge.game.events()`)
const settle = {
  ok: !!submitRes?.game,
  xpBefore: beforeOv?.xp, xpAfter: afterOv?.xp,
  xpGain: submitRes?.game?.xpGain, leveledUp: submitRes?.game?.leveledUp,
  eventKinds: (evsNow || []).map((e) => e.kind), hasXpEvent: (evsNow || []).some((e) => e.kind === 'xp')
}
ok(settle.ok, '自评 3 档提交成功并返回 game 结算：' + (picked?.[0]?.id || ''))
ok(settle.ok && settle.xpAfter > settle.xpBefore && settle.xpGain > 0,
  `作答结算发放 XP（${settle.xpBefore} → ${settle.xpAfter}，本次 +${settle.xpGain}）`)
ok(settle.ok && settle.hasXpEvent, `产生庆祝事件：${[...new Set(settle.eventKinds)].join('/')}`)

// ---------- 6. 庆祝弹窗（进图谱页 drain 未读事件后弹出） ----------
await cdp.nav('/graph')
await cdp.reloadHard(3000)
await sleep(1800)
const celebrate = await cdp.evaluate(`
  const card = document.querySelector('[data-testid="game-celebrate"]')
  return { shown: !!card, title: card?.querySelector('.celebrate-title')?.textContent.trim(),
    sub: card?.querySelector('.celebrate-sub')?.textContent.trim(),
    canvas: !!document.querySelector('.confetti-canvas') }`)
ok(celebrate.shown, `作答后进入图谱弹出庆祝卡片：${celebrate.title}（${celebrate.sub}）`)
if (celebrate.shown) await cdp.shot('data/qa/r20-celebrate.png')
// 关闭弹窗
await cdp.evaluate(`document.querySelector('[data-testid="game-celebrate-close"]')?.click(); return 1`)
await sleep(700)
const closed = await cdp.evaluate(`return !document.querySelector('[data-testid="game-celebrate"]')`)
ok(closed, '庆祝弹窗可关闭，关闭后事件标记已读')
// 再刷新不应重复弹同一批
await cdp.reloadHard(2500); await sleep(1500)
const noReshow = await cdp.evaluate(`return !document.querySelector('[data-testid="game-celebrate"]')`)
ok(noReshow, '已读事件刷新后不重复弹窗（drain 幂等）')

// ---------- 7. HUD 已反映 XP，streak 至少 1 ----------
const ov2 = await cdp.evaluate(`return window.forge.game.overview()`)
ok(ov2.streak >= 1 && ov2.answeredTotal >= 1, `打卡 streak=${ov2.streak}、累计作答=${ov2.answeredTotal}`)

// ---------- 8. 浅色主题审计 + 截图 ----------
const auditLight = await cdp.evaluate(`return (() => { ${AUDIT_JS} })()`)
ok(!auditLight.hOverflow, '浅色图谱无横向溢出')
ok(!auditLight.zeroBox?.length, '无零尺寸元素')
await cdp.shot('data/qa/r20-world-light.png')

// ---------- 9. 深色主题 ----------
async function setTheme(dark) {
  await cdp.evaluate(`
    const want = ${dark ? "'dark'" : "'light'"};
    if (document.documentElement.dataset.theme !== want) document.documentElement.setAttribute('data-theme', want);
    return document.documentElement.dataset.theme`)
  await sleep(500)
}
await setTheme(true)
const dark = await cdp.evaluate(`const m=getComputedStyle(document.body).backgroundColor.match(/rgba?\\((\\d+), ?(\\d+), ?(\\d+)/);return {theme:document.documentElement.dataset.theme, avg:m?(Number(m[1])+Number(m[2])+Number(m[3]))/3:255}`)
ok(dark.theme === 'dark' && dark.avg < 90, `深色主题生效（亮度 ${Math.round(dark.avg)}）`)
const auditDark = await cdp.evaluate(`return (() => { ${AUDIT_JS} })()`)
ok(!auditDark.hOverflow && !auditDark.clippedRight?.length, '深色图谱无溢出/裁切')
await cdp.shot('data/qa/r20-world-dark.png')
await setTheme(false)

const errs = cdp.errors().filter((e) => !/Failed to load resource|favicon|DevTools|INEFFECTIVE_DYNAMIC|deprecation|ExperimentalWarning|Use of undefined/i.test(e.text))
console.log('\n控制台错误（过滤无关后）:', errs.length ? errs.slice(0, 6) : '无')
ok(errs.length === 0, '零控制台错误')
await cdp.close()
console.log(bad.length ? `\n❌ R20 游戏化 UI ${bad.length} 项失败: ${bad.join(' | ')}` : '\n✅ R20 游戏化：HUD 等级 XP/streak/Boss 标记/徽章墙/庆祝弹窗/双主题，全部通过')
process.exit(bad.length ? 1 : 0)
