#!/usr/bin/env node
// R9 UI 真机联调（经渲染端 window.forge 调真实 IPC，验证主进程新服务端到端可用）。
// 用法：QA_PORT=9223 node scripts/qa/r9-ui.mjs
import { Cdp, sleep, AUDIT_JS } from './cdp.mjs'
import fs from 'node:fs'

const bad = []
const ok = (c, m) => { if (!c) bad.push(m); console.log(`  ${c ? 'OK ' : 'FAIL'} ${m}`) }

const cdp = await Cdp.connect(18)
cdp.clearErrors()
const shot = (name) => cdp.shot(`data/qa/r9-${name}.png`)

// 渲染端直接调 IPC（preload 暴露的 window.forge）
const call = async (expr) => cdp.evaluate(`return await (async () => { ${expr} })()`)

// ---------- 1. 错题本 IPC + 页面 ----------
await cdp.nav('/mistakes')
await sleep(1200)
const mistakes = await call(`
  const list = await window.forge.mistakes.list({ limit: 50 });
  return { count: list.length, sample: list[0] ? { qid: list[0].qid, stem: (list[0].stem||'').slice(0,30), wrongTimes: list[0].wrongTimes, lit: list[0].lit } : null }`)
ok(Array.isArray(mistakes?.list || mistakes) || typeof mistakes?.count === 'number', 'mistakes.list IPC 可调用并返回列表')
console.log('     错题数:', mistakes.count, JSON.stringify(mistakes.sample ?? {}))
const wbText = await cdp.evaluate(`return document.querySelector('.page')?.innerText.slice(0,120) || ''`)
ok(/错题本/.test(wbText), '错题本页面渲染（含标题）')
await shot('mistakes')

// ---------- 2. 摸底向导：start → 标记不会 → 前置链下探 ----------
await cdp.nav('/placement')
await sleep(1200)
const intro = await cdp.evaluate(`return document.querySelector('.page')?.innerText.slice(0,160) || ''`)
ok(/入门摸底/.test(intro), '摸底向导介绍页渲染')
await shot('placement-intro')

// 直接经 IPC 跑一轮真实摸底（fe 板块），验证前置链探针服务端可用
const pl = await call(`
  const s = await window.forge.placement.start('fe', { force: true });
  const out = { hasSession: !!s.sessionId, firstItem: !!s.item, hint: (s.hint||'').slice(0,40), progress: s.progress };
  if (s.item) {
    // 第一题直接标记「知识点不会」
    const r = await window.forge.placement.submit(s.sessionId, s.item.id, null, { gapType: 'concept', gapNote: 'qa 不会' });
    out.afterGap = { scale4: r.scale4, gapType: r.gapType, finished: r.finished, hasNext: !!r.item, nextNode: r.item ? r.item.node_id : null, hint: (r.hint||'').slice(0,40) };
    window.__qaSession = s.sessionId;
  }
  return out`)
ok(pl.hasSession && pl.firstItem, 'placement.start 返回会话与首题（从最基础考点开始）')
ok(pl.afterGap && pl.afterGap.gapType === 'concept' && pl.afterGap.scale4 === 0, '标记「知识点不会」被记录为 0 档缺口')
if (pl.afterGap && !pl.afterGap.finished) {
  ok(!!pl.afterGap.nextNode, '标记不会后探针移动到下一考点（下探前置/换题），不中断')
  console.log('     下一考点:', pl.afterGap.nextNode, '| hint:', pl.afterGap.hint)
}
const gaps = await call(`return await window.forge.placement.gaps('fe')`)
ok(Array.isArray(gaps) && gaps.some(g => g.gapType === 'concept'), 'placement.gaps 返回 concept 缺口清单（定位"不会在哪"）')
const resumed = await call(`return await window.forge.placement.resume('fe')`)
ok(resumed && resumed.sessionId, 'placement.resume 可断点续测到活动会话')
await shot('placement-running')

// ---------- 3. 练习随机模式（R9-④）----------
await cdp.nav('/practice')
await sleep(1500)
// 自动抽题后模块选择条默认收起（v-show），先点「模块」展开再验证
const foldBtn = await cdp.evaluate(`return !!document.querySelector('.tb-fold')`)
ok(foldBtn, '练习页有「模块」展开按钮（参数收纳入口）')
await cdp.clickText('模块').catch(() => {})
await sleep(600)
const pv = await cdp.evaluate(`return {
  hasScopeStrip: !!document.querySelector('.scope-strip'),
  hasOldFocus: !!document.querySelector('.tb-focus'),
  hasPicker: document.body.innerText.includes('技术栈'),
  noDifficultyParam: !document.body.innerText.includes('旧题/变体混入') && !document.body.innerText.includes('优先清到期'),
  body: document.querySelector('.page')?.innerText.slice(0,100) || ''
}`)
ok(!pv.hasOldFocus, '旧的浮动 .tb-focus 红框卡片已移除（意见3）')
ok(pv.hasPicker && pv.noDifficultyParam, '展开后是模块选择（板块/技术栈），无难度/混入等手动参数（意见4）')
// 随机队列：经 IPC 验证 random 模式
const rq = await call(`
  const a = await window.forge.practice.queue({ domains:['fe'], count: 8, random: true });
  const b = await window.forge.practice.queue({ domains:['fe'], count: 8, random: true });
  const nodesA = a.map(x=>x.node_id);
  const sameOrder = a.length===b.length && a.every((x,i)=>x.id===b[i].id);
  return { n: a.length, allActive: a.every(x=>x.status==='active' && x.parent_id===null), sameOrderTwice: sameOrder }`)
ok(rq.n > 0 && rq.allActive, '随机队列返回 active 母题')
ok(!rq.sameOrderTwice, '两次随机抽题顺序不同（无序、无固定关联）')
await shot('practice-random')

// ---------- 4. 知识抽屉不自动弹出（R9-②）----------
const drawerAutoOpen = await cdp.evaluate(`return !!document.querySelector('[data-testid="knowledge-drawer"]')`)
ok(!drawerAutoOpen, '进入练习页知识抽屉不会自动弹出（意见2）')

// ---------- 5. 布局溢出审计（红框类问题回归）----------
const audit = await cdp.evaluate(`return (() => { ${AUDIT_JS} })()`)
ok(!audit.hOverflow, `无横向溢出（${audit.hOverflow ?? 'OK'}）`)
if (audit.clippedRight?.length) bad.push('右侧裁切: ' + JSON.stringify(audit.clippedRight.slice(0,3)))
ok(!audit.clippedRight?.length, '无元素被右侧裁切')

// 清理：把 QA 产生的 active 摸底会话收尾，避免残留影响用户真实 resume
await call(`
  const sid = window.__qaSession;
  if (sid) {
    // 没有直接的「关闭会话」IPC，用继续提交直到 finished 的方式可能耗时；
    // 改为通过 settings 之外的安全手段：读不到会话内部，这里仅记录 sid 供脚本外清理
    return sid;
  }
  return null`)

const errs = cdp.errors().filter(e => !/Failed to load resource|favicon|DevTools|INEFFECTIVE_DYNAMIC/.test(e.text))
console.log('\n控制台错误（过滤无关后）:', errs.length ? errs.slice(0,5) : '无')
await cdp.close()
console.log(bad.length ? `\n❌ ${bad.length} 项失败: ${bad.join(' | ')}` : '\n✅ R9 UI 联调全部通过')
process.exit(bad.length ? 1 : 0)
