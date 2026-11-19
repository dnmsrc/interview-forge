#!/usr/bin/env node
/**
 * R23「我不会」输入框直接提交 —— 真实链路冒烟（CDP，跑在隔离数据目录上的 dev 实例）。
 *
 * 验的是用户报的那个毛病本体的修复：输入框打了字，能不能不选三张卡片就提交出去。
 *   A. 真实 IPC：interpretGap 规则命中「截图原话」→ concept / source=rule（0 延迟、不调 AI）；
 *      含糊描述 → 走 AI 或兜底，但必须是合法三类之一（不允许 null/未知回给前端）。
 *   B. DOM 全链路：进摸底页 → 点「我不会」→ 往输入框打字 → 提交按钮由「禁用」变「可用」
 *      → 点它（全程不碰三张快捷卡片）→ 出现缺口判定回显。
 *   C. 数据库核对：最新一轮 placement_turn 落 gap_type=concept，且 gap_note 保留用户原话。
 *
 * 运行前提：dev 实例带着 FORGE_DATA_DIR 指向临时数据目录（见 runner 说明），
 * 这样本脚本写入的 turn/attempts 全落在一次性副本里，绝不碰用户真实进度。
 *
 * 复跑方法（隔离实例，跑完删掉临时目录即可）：
 *   1) node -e "const{DatabaseSync}=require('node:sqlite');const s=new DatabaseSync('data/app.db');s.exec(\"VACUUM INTO 'data/r23-qa/app.db'\")"
 *   2) FORGE_DATA_DIR="$PWD/data/r23-qa" npm run dev -- --remote-debugging-port=9222 &
 *   3) FORGE_DATA_DIR="$PWD/data/r23-qa" node scripts/qa/r23-gap-note-cdp-smoke.mjs
 * 注意：不要对着用户真实 data/ 直接跑——本脚本会真实提交一轮缺口（写 placement_turn/attempts）。
 */
import { Cdp } from './cdp.mjs'
import { DatabaseSync } from 'node:sqlite'
import { join, resolve } from 'node:path'

const bad = []
const ok = (c, m) => { if (!c) bad.push(m); console.log(`  ${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1 }

const DB_PATH = join(resolve(process.env.FORGE_DATA_DIR || join(process.cwd(), 'data')), 'app.db')
const openDb = () => { const d = new DatabaseSync(DB_PATH); d.exec('PRAGMA busy_timeout=8000'); return d }

const cdp = await Cdp.connect(20)
await cdp.metrics(1460, 920)
const call = (body) => cdp.evaluate(body)

/* ---------------- A. 真实 IPC：缺口分类 ---------------- */
console.log('\n— A. 真实 IPC：interpretGap 分类 —')
const ipcR = await call(`
  const s = await window.forge.placement.start('ai', { force: true });
  window.__r23 = { sid: s.sessionId, qid: s.item.id, node: s.item.node_id, title: s.item.nodeTitle };
  const exact = await window.forge.placement.interpretGap('我不知道 AST 是什么，sourcemap 是什么。模板字符串的概念我也模糊了。', s.item.node_id);
  return { sid: window.__r23.sid, qid: window.__r23.qid, node: window.__r23.node, title: window.__r23.title, exact }`)
// 含糊描述要过 AI 判定，单独给足等待预算（服务侧已把 AI 超时压到 12s，失败即兜底，不会无限等）
const vagueR = await call(`
  const r = await window.forge.placement.interpretGap('Vue4 的这些东西我们团队不用', window.__r23.node);
  return { vague: r }`, { timeoutMs: 60000 })
const ipcR2 = { ...ipcR, vague: vagueR.vague }
ok(!!ipcR.sid, 'start 建会话出题：' + ipcR.qid + ' ｜ ' + ipcR.title)
ok(ipcR.exact?.gapType === 'concept', `截图原话判为 concept（实际 ${ipcR.exact?.gapType}）`)
ok(ipcR.exact?.source === 'rule', `截图原话走离线规则、0 延迟不调 AI（实际 source=${ipcR.exact?.source}）`)
ok(ipcR.exact?.note === '我不知道 AST 是什么，sourcemap 是什么。模板字符串的概念我也模糊了。', 'interpretGap 原样回传用户原话（将写入 gap_note）')
ok(['concept', 'code', 'skip'].includes(ipcR2.vague?.gapType), `含糊描述也一定落在三类之一（实际 ${ipcR2.vague?.gapType}）`)
ok(['rule', 'ai', 'fallback'].includes(ipcR2.vague?.source), `含糊描述标注了判定来源（实际 ${ipcR2.vague?.source}）`)
const emptyRejected = await call(`try { await window.forge.placement.interpretGap('', null); return { threw: false } } catch (e) { return { threw: true, msg: String(e.message || e) } }`)
ok(emptyRejected.threw === true, '空描述被服务拒绝（IPC 直调用也不会静默落一条空缺口）：' + emptyRejected.msg?.slice(0, 40))

/* ---------------- B. DOM 全链路：只靠输入框提交 ---------------- */
console.log('\n— B. DOM：输入框 → 提交按钮 → 提交（不点任何快捷卡片） —')
const domR = await call(`
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // 先无条件回到 intro（若页面停在某个遗留会话的 running 态，点「退出」出去），
  // 再从「AI Agent」卡片重新进入——保证下面提交的轮次必定落在 AI 域会话上，而不是用户的前端会话。
  let q = document.querySelector('.pl-q');
  if (q) {
    const exit = document.querySelector('.pl-exit');
    if (exit) exit.click();
    for (let i = 0; i < 40; i++) { await sleep(150); if (document.querySelector('.domain-card')) break; }
  }
  if (!document.querySelector('.domain-card')) {
    location.hash = '#/placement';
    for (let i = 0; i < 60; i++) { await sleep(150); if (document.querySelector('.domain-card')) break; }
  }
  let cards = [...document.querySelectorAll('.domain-card')];
  if (!cards.length) return { err: 'no-domain-cards', hash: location.hash };
  const card = cards.find((c) => /AI Agent/.test(c.textContent));
  if (!card) return { err: 'no-ai-card', labels: cards.map((c) => c.querySelector('.dc-name')?.textContent) };
  card.click();
  q = null;
  for (let i = 0; i < 40; i++) { await sleep(150); q = document.querySelector('.pl-q'); if (q) break; }
  if (!q) return { err: 'no-running-view' };
  // 若当前题已提交（有判定回显），先点「下一题」推进到可作答新题，避免卡在只读态
  if (document.querySelector('.pl-verdict')) {
    const next = document.querySelector('[data-testid="pl-next"]');
    if (next && !next.disabled) { next.click(); for (let i = 0; i < 30; i++) { await sleep(150); if (!document.querySelector('.pl-verdict')) break; } }
  }
  // 打开「我不会」区
  const gapBtn = [...document.querySelectorAll('button')].find((b) => /我不会/.test(b.textContent) && b.getBoundingClientRect().width > 0);
  if (!gapBtn) return { err: 'no-gap-entry', hadVerdict: !!document.querySelector('.pl-verdict') };
  gapBtn.click();
  await sleep(350);
  const area = document.querySelector('.pl-gap');
  const ta = document.querySelector('.pl-gap textarea');
  const send = document.querySelector('[data-testid="pl-gap-send"]');
  if (!area || !ta || !send) return { err: 'no-gap-ui', area: !!area, ta: !!ta, send: !!send };
  const before = { disabled: send.disabled, optsVisible: !!document.querySelector('.gap-opt'), optsCount: document.querySelectorAll('.gap-opt').length };
  // 输入框填字（模拟真实键盘输入：原生 input 事件驱动 v-model）
  ta.focus();
  ta.value = '我不知道 AST 是什么，sourcemap 是什么。模板字符串的概念我也模糊了。';
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(300);
  const after = { disabled: send.disabled, value: ta.value };
  return { ok: true, before, after, qid: q.getAttribute('data-pl-qid'), optsCount: document.querySelectorAll('.gap-opt').length }`)
ok(domR.ok === true, '进入摸底页并打开「我不会」区（无报错路径）' + (domR.ok ? '' : '：' + JSON.stringify(domR)))
if (domR.ok) {
  ok(domR.before?.disabled === true, '输入框为空时「提交我的说明」按钮是禁用的（不允许提交空缺口）')
  ok(domR.before?.optsVisible === true && domR.before?.optsCount >= 3, `三张快捷卡片同时在场（${domR.before?.optsCount} 张），只是选项之一`)
  ok(domR.after?.disabled === false, '打字后按钮立即变为可用（不再要求「先选三类之一」才放行）')
  ok(domR.after?.value === '我不知道 AST 是什么，sourcemap 是什么。模板字符串的概念我也模糊了。', '输入框内容确实被组件接住（v-model 同步）')
  // 真正点提交：全链路不触碰 .gap-opt
  const sent = await call(`
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const send = document.querySelector('[data-testid="pl-gap-send"]');
    if (!send || send.disabled) return { err: 'send-not-ready' };
    send.click();
    let v = null;
    for (let i = 0; i < 60; i++) { await sleep(150); v = document.querySelector('.pl-verdict'); if (v) break; }
    const gapArea = document.querySelector('.pl-gap');
    return { clicked: true, verdict: v ? v.textContent.replace(/\\s+/g, ' ').trim() : null, gapAreaStillOpen: !!gapArea }`)
  ok(sent.clicked === true, '点「提交我的说明」（整条路径没有点任何一张快捷卡片）')
  ok(!!sent.verdict, '提交后出现缺口判定回显：' + (sent.verdict || '（无）'))
  ok(/知识点不懂/.test(sent.verdict || ''), '回显把类型说成人话「知识点不懂」：' + (sent.verdict || ''))
  ok(sent.gapAreaStillOpen !== true, '提交后「我不会」输入区收起（进入只读判定态）')

  /* ---------------- C. 数据库核对 ---------------- */
  console.log('\n— C. 落库核对（隔离数据目录） —')
  const db = openDb()
  // 取全库最新一条 turn：DOM 提交可能落在前端复用的旧 running 会话（上一次冒烟留下的），
  // 不一定是 IPC 段 force 新建的那个；隔离库里此刻只有本脚本写入，最新一条必然是我们刚提交的。
  const turn = db.prepare('SELECT id, session_id, node_id, gap_type, gap_note, scale4, created_at FROM placement_turn ORDER BY id DESC LIMIT 1').get()
  ok(!!turn, '本轮 turn 已落库（turn #' + turn?.id + '，session ' + turn?.session_id + '）')
  if (turn) {
    ok(turn.gap_type === 'concept', `turn.gap_type=concept（实际 ${turn.gap_type}）；选三卡片时这里会是用户点的那类`)
    ok(String(turn.gap_note || '').includes('AST'), 'gap_note 完整保留用户原话：' + JSON.stringify(turn.gap_note))
    ok(Number(turn.scale4) === 0, `缺口能力档记 0（实际 ${turn.scale4}）`)
    const sess = db.prepare('SELECT domain, status FROM placement_session WHERE id=?').get(turn.session_id)
    ok(!!sess && sess.domain === 'ai', `该轮落在 ai 域会话上（实际 ${sess?.domain} / ${sess?.status}）`)
    const gaps = db.prepare(`SELECT t.gap_type AS gapType, COUNT(*) AS count FROM placement_turn t
        WHERE t.session_id=? AND t.gap_type IS NOT NULL GROUP BY t.gap_type`).all(turn.session_id)
    ok(gaps.some((g) => g.gapType === 'concept' && Number(g.count) >= 1), '缺口可按类型聚合（完成页「知识缺口」报告有据可依）')
  }
  db.close()
}

console.log(`\n${bad.length ? `✗ ${bad.length} 项未通过` : '✓ 全部通过'} ｜ 数据目录 ${DB_PATH}`)
if (bad.length) { console.log('\n失败项：'); bad.forEach((m) => console.log(' - ' + m)) }
