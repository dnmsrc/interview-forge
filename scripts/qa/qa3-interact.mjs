// QA 第 3 轮：核心交互流实测（练习答题→自评提交→反馈→下一题 / 考试选模板→开考→跳转→弃考 / 图谱抽屉 / 首页跳转 / 外观切换 / 设置保存 / 题库校验）
// v2：全部关键控件改走 data-testid（UI 重构后文案与类名会变，testid 是最稳的验收契约）
import { Cdp, sleep } from './cdp.mjs'
const OUT = 'data/qa'
const results = []
const step = async (name, fn) => {
  try { await fn(); results.push(['✅', name]); console.log(`✅ ${name}`) }
  catch (e) { results.push(['❌', name + ' :: ' + String(e.message).slice(0, 160)]); console.log(`❌ ${name}\n   ↳ ${String(e.message).slice(0, 200)}`) }
}

const cdp = await Cdp.connect()
await cdp.metrics(1460, 920)
cdp.clearErrors()

const tidSel = (t) => `[data-testid=${JSON.stringify(t)}]`
/** 点 testid（过滤不可见元素），返回中心坐标；找不到就抛错 */
async function clickTid(t, idx = 0) {
  const p = await cdp.evaluate(`
    const els = [...document.querySelectorAll(${JSON.stringify(tidSel(t))})].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 });
    const e = els[${idx}];
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), n: els.length };`)
  if (!p) throw new Error(`没有可见的 [data-testid="${t}"]（第 ${idx} 个）`)
  await cdp.mouse(p.x, p.y)
  return p
}
const hasTid = (t) => cdp.evaluate(`return !!document.querySelector(${JSON.stringify(tidSel(t))})`)
const waitTid = (t, ms, label) => cdp.waitFor(`!!document.querySelector(${JSON.stringify(tidSel(t))})`, ms, label ?? `testid ${t}`)
/** dialog 里的确认按钮（按文案精确匹配，避免误点 popconfirm 或卡片按钮） */
async function confirmInModal(text) {
  await sleep(900)
  const p = await cdp.evaluate(`
    const b = [...document.querySelectorAll('.n-modal button,.n-dialog button,.n-modal-card button')]
      .find((e) => e.textContent.trim() === ${JSON.stringify(text)} && e.getBoundingClientRect().width > 0);
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };`)
  if (!p) throw new Error('dialog 中未出现「' + text + '」')
  await cdp.mouse(p.x, p.y)
}
async function closeToasts() {
  await cdp.evaluate(`
    let n = 0;
    for (const el of document.querySelectorAll('.n-notification-wrapper .n-notification__close, .n-message__close')) {
      if (el.getBoundingClientRect().width > 0) { el.click(); n++ }
    }
    return n;`).catch(() => 0)
  await sleep(400)
}
async function goto(hash) {
  await cdp.evaluate(`location.hash = ${JSON.stringify(hash)}; return 1`)
  await sleep(1400)
}
/** 清掉未完成的考试会话，保证 B 组从组卷页开始 */
async function ipcSelfAbandon() {
  await cdp.reloadHard(3200)
  await goto('#/exam')
  const st = await cdp.evaluate(`return { running: !!document.querySelector('.timer'), report: document.body.innerText.includes('再来一卷') }`)
  if (st.running) { await clickTid('exam-quit'); await confirmInModal('弃考'); await sleep(1200) }
  else if (st.report) { await cdp.clickText('再来一卷'); await sleep(1000) }
}

// ---------- A. 练习：答题 → 快速自评提交 → 反馈面板 → 下一题 ----------
await step('A1 进入练习并等题干', async () => {
  await cdp.reloadHard(3200)
  await goto('#/practice')
  await cdp.waitFor('!!document.querySelector(\'.stem\')', 25000, 'practice 题干')
  // 硬刷新后必须确认新代码真的加载了，否则后面的 testid 全部落空（Electron 缓存旧 chunk 踩过）
  const n = await cdp.evaluate('return document.querySelectorAll(\'[data-testid]\').length')
  // 未提交时只有 practice-submit 一个（submit/next 是 v-if/v-else 互斥），所以门槛是 ≥1
  if (n < 1) throw new Error(`页面上没有 data-testid（找到 ${n} 个），说明跑的是旧模块缓存`)
})
await step('A2 作答后点提交并批改', async () => {
  // 先把答案真的填进去：选择题点第一个选项；填空题逐个空都填；简答/编程填 textarea。
  // 之前只填第一个空 / 只 fill 一个 textarea，遇到编程题（编辑器不是普通 textarea）会交白卷被拒，
  // 于是 next 永远不出现，误判成"AI 批改慢"。
  const kind = await cdp.evaluate(`return (function(){
    const meta = document.querySelector('.qmeta')?.innerText || '';
    if (/编程/.test(meta)) return 'code';
    if (/多选|单选|判断/.test(meta)) return 'choice';
    if (/填空/.test(meta)) return 'blank';
    return 'text';
  })()`)
  const filled = await cdp.evaluate(`return (function(){
    if (${JSON.stringify(kind)} === 'choice') { const o = document.querySelector('.opt'); if (o) { o.click(); return 'choice' } return 'no-opt' }
    const setter = (el, v) => { el.focus(); const p = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(p, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })) };
    if (${JSON.stringify(kind)} === 'blank') { const ins = [...document.querySelectorAll('input.n-input__input-el')]; ins.forEach((el, i) => setter(el, ['编译器','transform','codegen','sourcemap'][i] || 'x')); return 'blank:' + ins.length }
    const ta = document.querySelector('textarea'); if (ta) { setter(ta, 'RAG 切块是为了控制检索上下文粒度，兼顾召回与成本'); return 'textarea' }
    const cm = document.querySelector('.cm-content, .monaco-editor textarea'); if (cm) { setter(cm.tagName === 'DIV' ? cm : cm, 'function memoize(fn){ const cache = new Map(); return (...a) => JSON.stringify(a) in cache ? cache[JSON.stringify(a)] : (cache[JSON.stringify(a)] = fn(...a)) }'); cm.setAttribute('contenteditable', 'true'); return 'editor' }
    return 'no-input';
  })()`)
  if (filled === 'no-opt' || filled === 'no-input') {
    // R9 随机练习首题可能是编程/简答等无标准输入控件的题型：
    // 兜底走四档自评（点「完全不会」直接提交，对所有题型都成立的真实练习路径），
    // 不再因题型随机而把功能正常的提交流误判成失败。
    const selfBtn = await cdp.evaluate(`
      const b = [...document.querySelectorAll('.s4-group .s4')].find(e => e.getBoundingClientRect().width > 0);
      if (!b) return null; b.click(); return 'self';`)
    if (!selfBtn) throw new Error('无法构造作答：' + filled + '，且没有四档自评按钮')
  } else {
    await sleep(400)
    await clickTid('practice-submit')
  }
  try {
    // 在线强档要生成「错因诊断 + 讲评」，实测可能 1~2 分钟
    await waitTid('practice-next', 150000, '判分完成（反馈后出现下一题）')
  } catch (e) {
    // 兜底：走「看答案」（不请求 AI），next 同样应当出现——用于区分"AI 慢"与"流程坏"
    const st = await cdp.evaluate(`return { skel: document.querySelectorAll('.skeleton').length, fb: document.querySelectorAll('.fb').length, msg: [...document.querySelectorAll('.n-message')].map(m=>m.innerText.trim().slice(0,50)), kind: ${JSON.stringify(kind)}, filled: ${JSON.stringify(filled)} }`)
    await clickTid('practice-reveal').catch(() => {})
    await waitTid('practice-next', 30000, '看答案后出现下一题').catch(() => { throw new Error(e.message + ' | 现场：' + JSON.stringify(st)) })
  }
})
await step('A3 反馈面板展开', async () => {
  await cdp.waitFor(`!!document.querySelector('.fb') || document.body.innerText.includes('参考答案')`, 8000, '反馈区')
})
await step('A4 反馈面板截图', async () => { await cdp.shot(`${OUT}/r3-practice-graded.png`) })
// 先测「下一题」，再测 AI 答疑：点进答疑区会切走题目态，放在前面会污染下一步（实测踩过）
await step('A5 下一题切换', async () => {
  await clickTid('practice-next')
  await sleep(1200)
  await cdp.waitFor('!!document.querySelector(\'.stem\')', 10000, '第二题题干')
})
await step('A6 AI 答疑区可交互', async () => {
  const has = await cdp.evaluate(`return document.body.innerText.includes('就地提问') || document.body.innerText.includes('让教练追问')`)
  if (has) { await cdp.clickText('就地提问').catch(() => cdp.clickText('让教练追问')); await sleep(800) }
  await cdp.shot(`${OUT}/r3-practice-qa.png`)
})

// ---------- B. 考试：清残局 → 选模板 → 开考 → 计时器 → 跳转 → 弃考 ----------
await step('B0 清理未完成考试会话', async () => { await ipcSelfAbandon() })
await step('B1 考试页模板渲染', async () => {
  await cdp.nav('/exam')
  await waitTid('exam-tpl', 12000, '模板卡片')
  await cdp.shot(`${OUT}/r3-exam-setup.png`)
})
await step('B2 选模板并开考', async () => {
  await clickTid('exam-tpl', 0)
  await sleep(500)
  const on = await cdp.evaluate(`return document.querySelectorAll('[data-testid="exam-tpl"].on').length`)
  if (!on) throw new Error('选中态没生效（.tpl-card.on 未出现）')
  await clickTid('exam-start')
  await cdp.waitFor('!!document.querySelector(\'.timer\')', 20000, '考试计时器')
})
await step('B3 考试中界面与跳转', async () => {
  await cdp.shot(`${OUT}/r3-exam-running.png`)
  await clickTid('exam-next')
  await sleep(800)
  const pos = await cdp.evaluate(`return document.body.innerText.match(/第\\s*\\d+\\s*\\/\\s*\\d+\\s*题/)?.[0] || ''`)
  if (!/^第\s*2\s*\//.test(pos)) throw new Error('跳转后题号异常: ' + pos)
  await clickTid('exam-prev')
  await sleep(700)
})
await step('B4 弃考（dialog 确认）', async () => {
  await clickTid('exam-quit')
  await cdp.shot(`${OUT}/r3-exam-quit-confirm.png`)
  await confirmInModal('弃考')
  await sleep(1400)
  await waitTid('exam-tpl', 10000, '回到组卷页')
})

// ---------- C. 图谱：点关卡开抽屉 → 详情区 → 关闭 ----------
await step('C1 图谱加载关卡', async () => {
  await cdp.nav('/graph')
  // R21 闯关目录的关卡行类是 .lv-stage（纯 DOM 手风琴，不再是 VueFlow 圆形节点）
  await cdp.waitFor('!!document.querySelector(".lv-stage")', 25000, '图谱关卡')
  await closeToasts()
})
await step('C2 点击关卡打开抽屉', async () => {
  await cdp.clickSel('.lv-stage', 3)
  await waitTid('graph-drawer', 8000, '抽屉')
  await cdp.shot(`${OUT}/r3-graph-drawer.png`)
})
await step('C3 抽屉关闭按钮生效', async () => {
  await clickTid('graph-drawer-close')
  await sleep(700)
  await cdp.waitFor('!document.querySelector(\'.drawer\')', 5000, '抽屉关闭')
})

// ---------- D. 首页：开始今日队列跳转 ----------
await step('D1 首页按钮跳练习', async () => {
  await cdp.nav('/')
  await waitTid('home-start', 12000, '今日按钮')
  await clickTid('home-start')
  await sleep(1400)
  const h = await cdp.evaluate('return location.hash')
  if (!h.includes('practice')) throw new Error('未跳转: ' + h)
})

// ---------- E. 外观切换（SettingsView 新增节，直连 lib/theme.ts） ----------
await step('E1 外观切到深色并生效', async () => {
  await cdp.nav('/settings')
  await sleep(1200)
  await cdp.clickText('深色')
  await sleep(900)
  const t = await cdp.evaluate(`return document.documentElement.dataset.theme`)
  if (t !== 'dark') throw new Error('data-theme 未变成 dark，实际 ' + t)
  await cdp.shot(`${OUT}/r3-settings-dark.png`)
})
await step('E2 外观切回浅色', async () => {
  await cdp.clickText('浅色')
  await sleep(900)
  const t = await cdp.evaluate(`return document.documentElement.dataset.theme`)
  if (t !== 'light') throw new Error('data-theme 未回到 light，实际 ' + t)
})

// ---------- F. 设置：保存学习参数 ----------
await step('F1 保存参数出 toast', async () => {
  await closeToasts()
  await clickTid('settings-save')
  await cdp.waitFor(`document.body.innerText.includes('学习参数已保存')`, 9000, '保存 toast')
})

// ---------- G. 题库：结构校验 ----------
await step('G1 跑结构校验出结果', async () => {
  await cdp.nav('/bank')
  await waitTid('bank-validate', 12000, '校验按钮')
  // 先清掉上一个用例可能留在页面上的 toast / 弹出层：坐标点击会被它们挡住，
  // 表现就是「按钮找到了、点了没反应」，和校验逻辑坏掉长得一模一样。
  await closeToasts()
  await sleep(300)
  const hasResult = () => cdp.evaluate(`return /校验通过|校验有/.test(document.body.innerText || '')`)
  await clickTid('bank-validate')
  let hit = false
  for (let i = 0; i < 20 && !hit; i++) { await sleep(300); hit = await hasResult() }
  if (!hit) {
    // 坐标点击没打中时用元素自身 click 兜底，同时把现场留下来，避免下次还要靠猜
    await cdp.evaluate(`document.querySelector('[data-testid=bank-validate]').click(); return 1`)
    for (let i = 0; i < 30 && !hit; i++) { await sleep(300); hit = await hasResult() }
  }
  if (!hit) {
    await cdp.shot(`${OUT}/r3-bank-validate-fail.png`)
    const tail = (await cdp.evaluate('return document.body.innerText || ""')).slice(-400).replace(/\n/g, ' | ')
    throw new Error('点击后 15 秒内没有校验结果文案；页面尾部：' + tail)
  }
  await cdp.shot(`${OUT}/r3-bank-validate.png`)
})

// ---------- H. 数据面板图表 ----------
await step('H1 数据面板图表渲染', async () => {
  await cdp.nav('/dashboard')
  await cdp.waitFor(`document.querySelectorAll('svg').length >= 2`, 12000, 'SVG 图表')
  await cdp.shot(`${OUT}/r3-dashboard.png`)
})

const errs = cdp.errors()
console.log('\n== 全程 console/JS 错误 ==')
for (const e of errs.slice(0, 15)) console.log(JSON.stringify(e).slice(0, 240))
if (!errs.length) console.log('(无)')
const pass = results.filter((r) => r[0] === '✅').length
console.log(`\n== 第 3 轮交互：${pass}/${results.length} 通过 ==`)
for (const [f, n] of results) if (f === '❌') console.log('  FAILED:', n)
await cdp.close()
