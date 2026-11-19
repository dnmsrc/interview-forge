#!/usr/bin/env node
/**
 * R24「我不会」提交后即时 AI 讲解 —— 真实链路冒烟（CDP，跑在隔离数据目录上的 dev 实例）。
 *
 * 验的是用户报的那句「我提交了自己的疑问，但是你并没有给我解答」：
 *   提交缺口后系统必须当场给出针对这段描述的 AI 讲解，并给出看知识点的入口。
 *
 *   A. 真实 IPC：tutor 拿用户原话直问 → 有非空 Markdown 回答、未误判越界、模型元信息齐全。
 *   B. DOM：进摸底 → 点「我不会」→ 输入原话 → 提交 → **自动出现 AI 讲解区**，
 *      用户原话被当作首问回显，回答正文非空且不是错误文案（不需要再手动点任何按钮）。
 *   C. DOM：讲解区「看本考点讲义」→ 打开知识抽屉（真实知识点入口），标题即本题考点。
 *   D. DOM：追问 chip 能再发一轮，回答条数 +1（讲解不是一次性死文本）。
 *   E. 落库：本轮 turn 的 gap_type=concept、gap_note 完整保留原话（记录与讲解并存）。
 *
 * 运行前提：dev 实例带 FORGE_DATA_DIR 指向临时副本，且真实实例已停（Electron 单实例锁）：
 *   node -e "const{DatabaseSync}=require('node:sqlite');const s=new DatabaseSync('data/app.db');s.exec(\"VACUUM INTO 'data/r24-qa/app.db'\")"
 *   FORGE_DATA_DIR="$PWD/data/r24-qa" npm run dev -- --remote-debugging-port=9233 &
 *   QA_PORT=9233 node scripts/qa/r24-gap-tutor-cdp-smoke.mjs
 * 绝不要对着用户真实 data/ 直接跑：本脚本会真实发起 AI 调用并写入一轮缺口。
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
const call = (body, opts) => cdp.evaluate(body, opts)

/* ---------------- A. 真实 IPC：tutor 回答用户原话 ---------------- */
console.log('\n— A. 真实 IPC：tutor 按用户原话作答 —')
const sess = await call(`
  const s = await window.forge.placement.start('ai', { force: true });
  window.__r24 = { sid: s.sessionId, qid: s.item.id, node: s.item.node_id, title: s.item.nodeTitle };
  return window.__r24`)
ok(!!sess?.qid && !!sess?.node, 'start 建会话出题：' + sess?.qid + ' ｜ ' + sess?.title)

const ipcR = await call(`
  const t0 = performance.now();
  // 用「我不懂这个考点」这类真实描述（与当前考点天然相关），而不是跨域的样例句子：
  // 否则被测出的是「描述与本考点无关」这条护栏，而不是「按描述开讲」这条主路径。
  const note = '我不懂「' + window.__r24.title + '」，这个概念我完全没学过，请从最基础的地方讲起，别假设我懂相关术语。';
  const r = await window.forge.explain.tutor(window.__r24.node, note, [], { questionId: window.__r24.qid });
  return { ms: Math.round(performance.now() - t0), note, r }`, { timeoutMs: 180000 })
const ans = ipcR?.r ?? {}
ok(!ans.error, 'tutor 未报错（error=' + JSON.stringify(ans.error ?? null) + '）')
if (!ans.error) {
  ok(typeof ans.answer_md === 'string' && ans.answer_md.trim().length >= 80,
    `回答正文够长、不是空壳（${(ans.answer_md || '').trim().length} 字，${ipcR.ms}ms / ${ans.tokens ?? '?'} tokens）`)
  ok(ans.offTopic === false, '用户描述被判定为「与本考点相关」，没有被护栏挡回')
  ok(!!ans.model, '回答带上模型元信息（' + ans.model + '）')
  ok(!/<<<(OFFTOPIC|PREREQ)/.test(ans.answer_md || ''), '回答正文里没有泄漏内部信号标记（信号已在服务端剥离）')
}

/* ---------------- B. DOM：提交后自动开讲 ---------------- */
console.log('\n— B. DOM：提交缺口 → 自动出现 AI 讲解 —')
const submitR = await call(`
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // 回到板块选择（遗留 running 态先退出），再进 AI Agent 摸底
  if (document.querySelector('.pl-q')) {
    const exit = document.querySelector('.pl-exit');
    if (exit) exit.click();
    for (let i = 0; i < 40; i++) { await sleep(150); if (document.querySelector('.domain-card')) break; }
  }
  if (!document.querySelector('.domain-card')) {
    location.hash = '#/placement';
    for (let i = 0; i < 60; i++) { await sleep(150); if (document.querySelector('.domain-card')) break; }
  }
  const cards = [...document.querySelectorAll('.domain-card')];
  const card = cards.find((c) => /AI Agent/.test(c.textContent));
  if (!card) return { err: 'no-ai-card', labels: cards.map((c) => c.querySelector('.dc-name')?.textContent) };
  card.click();
  let q = null;
  for (let i = 0; i < 40; i++) { await sleep(150); q = document.querySelector('.pl-q'); if (q) break; }
  // 万一该板块上一轮已摸完（进的是完成页），用「重新测一次」再开一轮新会话
  if (!q && document.querySelector('.done-retest')) {
    window.confirm = () => true;
    document.querySelector('.done-retest').click();
    for (let i = 0; i < 60; i++) { await sleep(150); q = document.querySelector('.pl-q'); if (q) break; }
  }
  if (!q) return { err: 'no-running-view' };
  // 若停在只读判定态（本题已提交过），先推进到新题
  if (document.querySelector('.pl-verdict')) {
    const next = document.querySelector('[data-testid="pl-next"]');
    if (next && !next.disabled) {
      next.click();
      for (let i = 0; i < 30; i++) { await sleep(150); if (!document.querySelector('.pl-verdict') && document.querySelector('.pl-q')) break; }
    }
  }
  const gapBtn = [...document.querySelectorAll('button')].find((b) => /我不会/.test(b.textContent) && b.getBoundingClientRect().width > 0);
  if (!gapBtn) return { err: 'no-gap-entry' };
  gapBtn.click();
  await sleep(300);
  const ta = document.querySelector('.pl-gap textarea');
  const send = document.querySelector('[data-testid="pl-gap-send"]');
  if (!ta || !send) return { err: 'no-gap-ui', ta: !!ta, send: !!send };
  const nodeTitle = q.querySelector('.qnode')?.getAttribute('title') || '这道题';
  const note = '我不懂「' + nodeTitle + '」，这个概念我完全没学过，请从最基础的地方讲起，别假设我懂相关术语。';
  ta.focus();
  ta.value = note;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(320);
  const disabledBeforeClick = send.disabled;
  send.click();
  // 等缺口判定回显
  let verdict = null;
  for (let i = 0; i < 60; i++) { await sleep(150); verdict = document.querySelector('.pl-verdict'); if (verdict) break; }
  return {
    ok: true,
    disabledBeforeClick,
    note,
    verdict: verdict ? verdict.textContent.replace(/\\s+/g, ' ').trim() : null,
    hasTutor: !!document.querySelector('[data-testid="pl-gap-tutor"]'),
    nodeTitle
  }`, { timeoutMs: 60000 })

ok(submitR.ok === true, '进入摸底页 → 打开「我不会」→ 填字 → 提交（无报错路径）' + (submitR.ok ? '' : '：' + JSON.stringify(submitR)))
if (submitR.ok) {
  ok(submitR.disabledBeforeClick === false, '写了字后提交按钮可用')
  ok(!!submitR.verdict, '提交后出现缺口判定回显：' + (submitR.verdict || '（无）'))
  ok(submitR.hasTutor === true, '提交后 **立刻** 出现 AI 讲解区（不需要用户再点任何按钮）')
}

// 等 AI 真正把回答写出来（自动首问已在提交时发出）
const answerR = await call(`
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 240; i++) {
    await sleep(400);
    const answers = document.querySelectorAll('[data-testid="pl-gap-tutor-answer"]');
    const busy = document.querySelector('[data-testid="pl-gap-tutor-busy"]');
    const err = document.querySelector('[data-testid="pl-gap-tutor-err"]');
    if (answers.length && !busy) {
      return {
        answers: answers.length,
        text: answers[answers.length - 1].textContent.replace(/\\s+/g, ' ').trim().slice(0, 500),
        userEcho: (document.querySelector('.gt-user-text')?.textContent || '').trim(),
        err: err ? err.textContent.replace(/\\s+/g, ' ').trim() : null,
        title: (document.querySelector('[data-testid="pl-gap-tutor"] .gt-title b')?.textContent || '').trim()
      };
    }
    if (err) return { err: err.textContent.replace(/\\s+/g, ' ').trim(), answers: answers.length };
  }
  return { timeout: true, answers: document.querySelectorAll('[data-testid="pl-gap-tutor-answer"]').length };
`, { timeoutMs: 150000 })

ok(!!answerR && !answerR.timeout, 'AI 讲解在超时前产出回答' + (answerR?.timeout ? '（120s 内没等到）' : ''))
if (answerR && !answerR.timeout && !answerR.err) {
  ok(Number(answerR.answers) >= 1, '讲解区有 ' + answerR.answers + ' 条回答')
  ok((answerR.text || '').length >= 80, `回答正文非空且成段（${(answerR.text || '').length} 字）：${(answerR.text || '').slice(0, 60)}…`)
  ok((answerR.userEcho || '').includes('完全没学过'), '用户原话被当作首问回显（不是让用户再重复一遍）：' + JSON.stringify(answerR.userEcho?.slice(0, 60)))
  ok(/AI 专门讲这一题/.test(answerR.title || ''), '讲解区标题明确是「AI 专门讲这一题」：' + answerR.title)
}
if (answerR?.err) console.log('  讲解区错误文案：' + answerR.err)

/* ---------------- C. 知识点入口：看本考点讲义 ---------------- */
console.log('\n— C. DOM：讲解区 → 看本考点讲义（真实知识点入口） —')
const knowR = await call(`
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const btn = document.querySelector('[data-testid="pl-gap-tutor-know"]');
  if (!btn) return { err: 'no-know-button' };
  btn.click();
  let d = null;
  for (let i = 0; i < 60; i++) { await sleep(150); d = document.querySelector('[data-testid="knowledge-drawer"]'); if (d) break; }
  if (!d) return { err: 'drawer-not-open' };
  const title = (d.querySelector('h3')?.textContent || '').trim();
  const hasBody = !!d.querySelector('.kb-body');
  // 该考点可能还没收录知识正文：此时抽屉展示「未收录 + 一键 AI 生成讲义」，同样是真实入口
  const missing = !!d.querySelector('.kb-card.warn');
  const hasTutor = !!d.querySelector('[data-testid="kb-tutor"]');
  const closed = document.querySelector('[data-testid="knowledge-drawer-close"]');
  if (closed) closed.click();
  await sleep(400);
  return { title, hasBody, missing, hasTutor, stillOpen: !!document.querySelector('[data-testid="knowledge-drawer"]') };
`, { timeoutMs: 60000 })
ok(!knowR?.err, '「看本考点讲义」能打开知识抽屉' + (knowR?.err ? '（' + knowR.err + '）' : ''))
if (!knowR?.err) {
  ok(!!knowR.title, '抽屉里是真实考点讲义，标题：' + knowR.title)
  ok(knowR.hasBody === true || knowR.missing === true,
    '抽屉内容真实加载：' + (knowR.hasBody ? '已收录讲义正文已渲染' : '该考点尚未收录正文，展示「未收录 + AI 生成」入口'))
  ok(knowR.hasTutor === true, '抽屉内仍带 AI 私教对话，用户可在这里继续深聊')
  ok(knowR.stillOpen === false, '关闭按钮能正常收起抽屉')
}

/* ---------------- D. 追问：讲解可继续 ---------------- */
console.log('\n— D. DOM：追问一轮，讲解可继续 —')
const followR = await call(`
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const before = document.querySelectorAll('[data-testid="pl-gap-tutor-answer"]').length;
  const chip = [...document.querySelectorAll('.gt-chip')].find((c) => /再简单点/.test(c.textContent));
  if (!chip) return { err: 'no-chip' };
  chip.click();
  for (let i = 0; i < 240; i++) {
    await sleep(400);
    const n = document.querySelectorAll('[data-testid="pl-gap-tutor-answer"]').length;
    const busy = document.querySelector('[data-testid="pl-gap-tutor-busy"]');
    if (n > before && !busy) {
      const last = document.querySelectorAll('[data-testid="pl-gap-tutor-answer"]')[n - 1];
      return { before, after: n, text: last.textContent.replace(/\\s+/g, ' ').trim().slice(0, 300) };
    }
  }
  return { before, after: document.querySelectorAll('[data-testid="pl-gap-tutor-answer"]').length, timeout: true };
`, { timeoutMs: 150000 })
ok(!followR?.err && !followR?.timeout, '追问 chip 能再发一轮并拿到新回答')
if (!followR?.err && !followR?.timeout) {
  ok(Number(followR.after) > Number(followR.before), `回答条数 ${followR.before} → ${followR.after}（多轮对话成立）`)
  ok((followR.text || '').trim().length >= 30, '追问后的回答也有实质内容：' + (followR.text || '').slice(0, 50) + '…')
}

/* ---------------- E. 落库核对 ---------------- */
console.log('\n— E. 落库（隔离数据目录） —')
const db = openDb()
const turn = db.prepare('SELECT id, session_id, node_id, gap_type, gap_note, scale4 FROM placement_turn ORDER BY id DESC LIMIT 1').get()
ok(!!turn, '本轮 turn 已落库（turn #' + turn?.id + '）')
if (turn) {
  ok(turn.gap_type === 'concept', `gap_type=concept（实际 ${turn.gap_type}）`)
  ok(String(turn.gap_note || '').includes('我不懂'), 'gap_note 完整保留用户原话：' + JSON.stringify(turn.gap_note))
  ok(Number(turn.scale4) === 0, `缺口能力档记 0（实际 ${turn.scale4}）`)
  // AI 讲解不落库（本轮对话只活在前端）：确认没有偷偷往 ai_explain 写脏数据
  const explainRows = db.prepare('SELECT COUNT(*) AS c FROM ai_explain').get()
  console.log('  参考：ai_explain 现存 ' + explainRows.c + ' 条（tutor 对话按设计不落库）')
}
db.close()

console.log(`\n${bad.length ? `✗ ${bad.length} 项未通过` : '✓ 全部通过'} ｜ 数据目录 ${DB_PATH}`)
if (bad.length) { console.log('\n失败项：'); bad.forEach((m) => console.log(' - ' + m)) }
