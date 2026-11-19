// R22 受限多轮辅导 CDP 冒烟：通过运行中 Electron 的真实 IPC + DOM 验证
//   1. explain.tutor IPC 真实可达：返回 answer_md / offTopic / suggestPrereq 结构（依赖本地 qwen 在线）；
//   2. 作用域护栏：问一个与考点无关的问题，链路不报错（offTopic 由模型判定，不硬断言真假，只验形状）；
//   3. 私教 DOM：打开知识抽屉，确认多轮对话容器、快捷问法、输入区、发送按钮渲染；
//   4. 间距修复：未收录/正常场景下，私教卡片与上方内容存在 margin，不再紧贴。
// 全程只读 + 一次性对话，不写学习进度、不落库（tutor 对话不持久化）。
import { Cdp } from './cdp.mjs'

const bad = []
const ok = (c, m) => { if (!c) bad.push(m); console.log(`  ${c ? 'OK ' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1 }

// 选一个真实考点（截图同域，且有前置边，便于验证 suggestPrereq 形状）
const NODE = 'ai.eval.evaluation-qa.online-regression'

const cdp = await Cdp.connect(20)
await cdp.metrics(1460, 920)
cdp.clearErrors()

// ---- 1. 真实 IPC：explain.tutor 可达且返回判别联合的成功分支（本地模型首响慢，给足超时）----
const r1 = await cdp.evaluate(`
  const r = await window.forge.explain.tutor(${JSON.stringify(NODE)}, '我完全没接触过离线评估，从零讲，该先学什么', [], { questionId: null });
  return { hasError: 'error' in r, keys: Object.keys(r), answerLen: ('answer_md' in r) ? r.answer_md.length : 0,
           offTopic: ('offTopic' in r) ? r.offTopic : null,
           prereq: ('suggestPrereq' in r) ? r.suggestPrereq : 'NO_FIELD',
           model: r.model }`, { timeoutMs: 90000 })
console.log('  tutor 返回：', JSON.stringify(r1).slice(0, 260))
ok(r1 && r1.hasError === false, 'explain.tutor 成功返回（无 error 分支）')
ok(r1 && typeof r1.answerLen === 'number' && r1.answerLen > 10, 'answer_md 有实质讲解内容（长度 ' + r1?.answerLen + '）')
ok(r1 && typeof r1.offTopic === 'boolean', 'offTopic 为布尔字段')
ok(r1 && (r1.prereq === null || (typeof r1.prereq === 'object' && r1.prereq && r1.prereq.id && r1.prereq.title)),
  'suggestPrereq 为 null 或带 id/title 的真实前置（实际：' + JSON.stringify(r1?.prereq)?.slice(0, 80) + '）')

// ---- 2. 多轮上下文：第二轮带着历史发问，链路不报错 ----
const r2 = await cdp.evaluate(`
  const history = [{ role:'user', content:'我完全没接触过离线评估' }, { role:'assistant', content:'先从评估集是什么讲起' }];
  const r = await window.forge.explain.tutor(${JSON.stringify(NODE)}, '那 pass@k 和这个有什么关系', history, { questionId: null });
  return { hasError: 'error' in r, answerLen: ('answer_md' in r) ? r.answer_md.length : 0 }`, { timeoutMs: 90000 })
ok(r2 && r2.hasError === false && r2.answerLen > 10, '带 history 的第二轮对话成功（多轮上下文透传）')

// ---- 3. 私教 DOM：进练习页 → 打开知识抽屉 ----
await cdp.nav('/practice?node=' + NODE)
await cdp.waitFor(`document.querySelector('[data-testid=practice-read-kb]')`, 12000).catch(() => false)
await cdp.clickSel('[data-testid=practice-read-kb]')
await cdp.waitFor(`document.querySelector('[data-testid=kb-tutor]')`, 10000)
const dom = await cdp.evaluate(`
  const tutor = document.querySelector('[data-testid=kb-tutor]');
  const scroll = document.querySelector('[data-testid=kb-tutor-scroll]');
  const chips = document.querySelectorAll('[data-testid=kb-tutor] [data-testid=kb-chip]');
  const send = document.querySelector('[data-testid=kb-tutor] [data-testid=kb-ask]');
  const input = document.querySelector('[data-testid=kb-tutor] textarea');
  return { hasTutor: !!tutor, hasScroll: !!scroll, chipCount: chips.length, hasSend: !!send, hasInput: !!input,
           scopeHint: !!tutor.querySelector('.tutor-scope') }`)
ok(dom.hasTutor, '私教区 [data-testid=kb-tutor] 渲染')
ok(dom.hasScroll, '消息流容器 kb-tutor-scroll 存在')
ok(dom.chipCount >= 5, '快捷问法 ≥5 个（含置顶零基础入口，实际 ' + dom.chipCount + '）')
ok(dom.hasSend && dom.hasInput, '发送按钮 + 输入框存在')
ok(dom.scopeHint, '作用域提示语渲染（告知只答本考点）')

// ---- 4. 真实发一条消息，验证用户气泡 + 私教气泡进消息流 ----
await cdp.evaluate(`
  const ta = document.querySelector('[data-testid=kb-tutor] textarea');
  const proto = HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(proto,'value').set.call(ta, '用大白话讲一下这是干嘛的');
  ta.dispatchEvent(new Event('input', { bubbles:true }));
  return ta.value`)
await cdp.clickSel('[data-testid=kb-tutor] [data-testid=kb-ask]')
// 等私教回复气泡（assistant 消息）出现，本地模型可能慢，给足时间
await cdp.waitFor(`document.querySelectorAll('[data-testid=kb-tutor-scroll] .tutor-msg.assistant .tutor-answer-body').length > 0`, 60000)
const conv = await cdp.evaluate(`
  const msgs = document.querySelectorAll('[data-testid=kb-tutor-scroll] .tutor-msg');
  const userMsgs = document.querySelectorAll('[data-testid=kb-tutor-scroll] .tutor-msg.user').length;
  const aiMsgs = document.querySelectorAll('[data-testid=kb-tutor-scroll] .tutor-msg.assistant .tutor-answer-body').length;
  const busyGone = !document.querySelector('[data-testid=kb-tutor-busy]');
  return { total: msgs.length, userMsgs, aiMsgs, busyGone }`)
ok(conv.userMsgs >= 1 && conv.aiMsgs >= 1, '对话流出现用户气泡 + 私教回复气泡（user=' + conv.userMsgs + ' ai=' + conv.aiMsgs + '）')
ok(conv.busyGone, '生成结束后打字等待动效消失')

// ---- 5. 间距修复：私教卡片与上方兄弟节点之间有 margin ----
const gap = await cdp.evaluate(`
  const tutor = document.querySelector('[data-testid=kb-tutor]');
  const cs = getComputedStyle(tutor);
  return { marginTop: parseFloat(cs.marginTop), marginBottom: parseFloat(cs.marginBottom) }`)
ok(gap.marginTop >= 12 && gap.marginBottom >= 8, '私教卡片带分组间距（marginTop=' + gap.marginTop + ' marginBottom=' + gap.marginBottom + '），不再紧贴')

// ---- 6. 控制台无 JS 错误 ----
const errs = cdp.errors().filter((e) => !/favicon|DevTools|Download the React/i.test(e.text))
ok(errs.length === 0, '全程无 JS 控制台错误（实际 ' + errs.length + (errs.length ? '：' + JSON.stringify(errs.slice(0, 2)) : '') + '）')

await cdp.close()
console.log(bad.length ? `\n❌ R22 CDP 冒烟失败 ${bad.length} 项` : '\n✅ R22 CDP 冒烟全部通过')
process.exit(bad.length ? 1 : 0)
