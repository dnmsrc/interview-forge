/**
 * R26 项目闯关 CDP 端到端冒烟（对着运行中的 Electron，走真实 IPC + 真实 DOM）。
 *
 * 覆盖的四类风险，都是「只看代码看不出来」的：
 *   1) 入口与导航：侧栏新入口可点、子路由能正确高亮归属（顶栏标题不掉回「练习册」）
 *   2) 关卡门禁：未通关的关卡不能点进去、上一关没通关时后端也拒绝执行（前端 disabled 只是 UI）
 *   3) 判题闭环：骨架跑不过 / 参考解跑得过 / 参考答案只在通关后下发（未通关时字段为 null）
 *   4) 跨关回归：拿第 1 关的答案去跑第 2 关必须红 —— 否则后面每关都是白送
 *
 * 结束前 resetAll，把隔离库还原成「新用户」状态。
 * 注意：脚本会读 content/projects 的 solution 当输入，这是测试，不是产品路径。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Cdp, sleep } from './cdp.mjs'

const bad = []
const ok = (c, m) => { if (!c) bad.push(m); console.log(`  ${c ? 'OK ' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1 }

const root = join(import.meta.dirname, '..', '..')
const project = JSON.parse(readFileSync(join(root, 'content', 'projects', 'mini-vue-reactivity.json'), 'utf8'))
const lv1 = project.levels[0]
const lv2 = project.levels[1]

const cdp = await Cdp.connect(20)
await cdp.metrics(1460, 920)
// 硬刷新：dev 下 HMR 换过组件后，KeepAlive 缓存里可能是旧实例，
// 不清一次会测到「上一次脚本留下的脏页面」，把结论带偏。
await cdp.reloadHard(3200)
cdp.clearErrors()

// 窗口最小化时 CDP 的 Input.dispatchMouseEvent 不会到达渲染进程：
// 点击全都被吞掉，脚本会以「找不到元素/点了没反应」的形式误报，先拦掉。
const view = await cdp.evaluate(`return { vis: document.visibilityState, focus: document.hasFocus() }`)
if (view.vis !== 'visible') {
  console.error(`✗ 应用窗口当前不可见（visibilityState=${view.vis}）。先把窗口恢复（不要最小化）再重跑。`)
  process.exit(2)
}

/** 关掉可能弹出的庆祝弹窗（通关会给 XP，游戏层会庆祝），否则它盖住「下一关」 */
async function dismissCelebration() {
  const had = await cdp.evaluate(`
    const el = document.querySelector('[data-testid=game-celebrate]');
    if (!el) return false;
    const b = document.querySelector('[data-testid=game-celebrate-close]');
    if (b) b.click();
    return true`)
  if (had) await sleep(500)
  return had
}

// ---------- 1. 侧栏入口 ----------
const nav = await cdp.evaluate(`
  const links = [...document.querySelectorAll('.nav a')];
  const hit = links.find(a => (a.textContent || '').includes('项目闯关'));
  return hit ? { href: hit.getAttribute('href'), text: (hit.textContent || '').trim(), tag: hit.tagName } : null`)
ok(!!nav, '侧栏存在「项目闯关」入口')
ok(nav && /projects/.test(nav.href || ''), `入口 href 指向项目路由（实际 ${nav?.href}）`)

// ---------- 2. 项目列表页 ----------
await cdp.nav('/projects')
const list = await cdp.evaluate(`
  const cards = [...document.querySelectorAll('.pcard')];
  const c = cards[0];
  return {
    count: cards.length,
    title: c ? (c.querySelector('h2,h3,b')?.textContent || '').trim() : '',
    text: c ? (c.innerText || '').trim() : '',
    bar: c ? (c.querySelector('.bar i')?.style.width || '') : '',
    full: (document.body.innerText || '').includes('0 / 5 关')
  }`)
ok(list.count >= 1, `项目列表渲染出 ${list.count} 个卡片`)
ok(/从零写一个响应式内核/.test(list.title + list.text), '项目卡标题正确')
ok(/5 关/.test(list.text) && /JavaScript/.test(list.text), '项目卡显示关卡数与技术栈')
ok(/开始第 1 关/.test(list.text), '未开始时 CTA 是「开始第 1 关」')
ok(list.full, '进度显示 0 / 5 关')

// 顶栏标题归属：/projects 前缀应归到「项目闯关」，不能掉回「练习册」
const crumb = await cdp.evaluate(`return (document.querySelector('.title-block h2')?.textContent || '').trim()`)
ok(crumb === '项目闯关', `顶栏标题正确（实际「${crumb}」）`)

// ---------- 3. 关卡地图门禁 ----------
await cdp.clickSel('.pcard')
await cdp.waitFor(`location.hash.includes('/projects/mini-vue-reactivity')`, 8000)
await sleep(900)
const map1 = await cdp.evaluate(`
  const steps = [...document.querySelectorAll('.lv-step')];
  return {
    n: steps.length,
    cur: steps.filter(s => s.classList.contains('current')).length,
    locked: steps.filter(s => s.classList.contains('locked')).length,
    done: steps.filter(s => s.classList.contains('done')).length,
    text: (document.querySelector('.lv-path')?.innerText || document.body.innerText || '').slice(0, 600)
  }`)
ok(map1.n === 5, `关卡地图渲染 5 关（实际 ${map1.n}）`)
ok(map1.cur === 1, '第 1 关是当前可做关卡')
ok(map1.locked === 4, `其余 4 关锁定（实际 ${map1.locked}）`)
ok(/通关第 1 关后解锁/.test(map1.text), '锁定关卡给出解锁条件说明')

// 点锁定关卡：不该跳转
const before = await cdp.evaluate(`return location.hash`)
await cdp.clickSel('.lv-step.locked')
await sleep(700)
const after = await cdp.evaluate(`return location.hash`)
ok(before === after, '点击锁定关卡不跳转（前端门禁生效）')

// 后端门禁：直接对未解锁关卡发起 run，必须报错
const denied = await cdp.evaluate(`
  try {
    await window.forge.project.run('mini-vue-reactivity', ${JSON.stringify(lv2.id)}, 'const x = 1')
    return { threw: false }
  } catch (e) { return { threw: true, msg: String(e?.message || e) } }`)
ok(denied.threw && /上一关/.test(denied.msg || ''), `后端拒绝未解锁关卡（${denied.msg?.slice(0, 60)}）`)

// ---------- 4. 工作台：骨架跑测试必须红 ----------
await cdp.clickSel('.lv-step.current')
await cdp.waitFor(`location.hash.includes('/lv1')`, 8000)
await cdp.waitFor(`!!document.querySelector('textarea.ce-ta')`, 10000)
const ed = await cdp.evaluate(`
  const ta = document.querySelector('textarea.ce-ta');
  return { len: ta.value.length, hasTodo: /TODO/.test(ta.value), skin: !!document.querySelector('.ce-gutter') || !!document.querySelector('.ce-lines'),
           task: (document.querySelector('.lv-task')?.innerText || document.body.innerText || '').includes('补完 4 个 TODO') }`)
ok(ed.hasTodo, `编辑器载入骨架（${ed.len} 字符，含 TODO）`)
ok(ed.len === lv1.skeleton.length, `编辑器内容就是这一关的骨架（${ed.len} / ${lv1.skeleton.length}）`)
ok(/补完 4 个 TODO/.test((await cdp.evaluate(`return document.body.innerText`)) || ''), '左栏任务说明渲染')

const runBtn = await cdp.evaluate(`
  const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim() === '跑测试');
  return b ? { dis: b.disabled } : null`)
ok(!!runBtn && !runBtn.dis, '「跑测试」按钮存在且可点')

await cdp.clickText('跑测试')
await cdp.waitFor(`!!document.querySelector('.result')`, 20000)
const red = await cdp.evaluate(`
  const r = document.querySelector('.result');
  const cases = [...document.querySelectorAll('.case')];
  const err = r.querySelector('.err-block');
  return { text: (r.innerText || '').slice(0, 300), cases: cases.length, bad: cases.filter(c => c.classList.contains('bad')).length,
           hasErr: !!err, errMsg: (err?.querySelector('.err-msg')?.textContent || '').slice(0, 120),
           hasSolution: (document.body.innerText || '').includes('参考答案') }`)
// 骨架有两条失败形态：跑完部分检查点后红（cases 有 bad），或一进来就抛错（cases 为 0 + 错误块）。
// 两种都必须给出可读的失败信息，不能是空面板。
ok(red.cases >= 1 || red.hasErr, `失败时给出可读结果（检查点 ${red.cases} 条${red.hasErr ? ' + 错误块' : ''}）`)
ok(red.bad >= 1 || /代码运行出错|还没跑到/.test(red.text), `骨架跑测试是红的（失败 ${red.bad}/${red.cases}${red.hasErr ? '，报错：' + red.errMsg : ''}）`)
ok(!red.hasSolution, '未通关时不显示参考答案（答案不泄漏）')

// ---------- 5. 写入参考解 → 通关 ----------
await cdp.fill('textarea.ce-ta', lv1.solution)
await sleep(300)
await cdp.clickText('跑测试')
await cdp.waitFor(`document.querySelector('.result') && /本关通过/.test(document.querySelector('.result').innerText)`, 25000)
await sleep(800)
const green = await cdp.evaluate(`
  const r = document.querySelector('.result');
  const cases = [...document.querySelectorAll('.case')];
  return { text: (r.innerText || '').slice(0, 260), allOk: cases.every(c => c.classList.contains('ok')),
           hasSolution: (document.body.innerText || '').includes('参考答案'),
           celebrate: !!document.querySelector('[data-testid=game-celebrate]') }`)
ok(green.allOk, '全部检查点变绿')
ok(/本关通过/.test(green.text), '出现「本关通过」横幅')
ok(green.hasSolution, '通关后参考答案才出现')
console.log(`  · 庆祝弹窗：${green.celebrate ? '弹出' : '未弹出（XP 事件可能已被消费）'}`)
// 先关掉庆祝弹窗再截图：遮罩会把整页压暗加模糊，等于拍到一张看不清的图
await dismissCelebration()
await sleep(400)
await cdp.shot(join(root, 'data', 'qa', 'r26-lv1-passed.png'))

// ---------- 6. 下一关：跨关回归不能白送 ----------
const nextBtn = await cdp.evaluate(`
  const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim().startsWith('下一关'));
  return b ? { dis: b.disabled, txt: (b.innerText || '').trim() } : null`)
ok(!!nextBtn && !nextBtn.dis, '通关后出现「下一关」按钮')

const cross = await cdp.evaluate(`
  const r = await window.forge.project.run('mini-vue-reactivity', ${JSON.stringify(lv2.id)}, ${JSON.stringify(lv1.solution)});
  return { passed: r.passed, total: r.cases.length, passedCases: r.cases.filter(c => c.ok).length }`)
ok(cross.passed === false, `第 1 关的答案跑第 2 关必须红（实际 ${cross.passedCases}/${cross.total}）`)

// ---------- 7. IPC 层：进度、解锁、答案下发 ----------
const detail = await cdp.evaluate(`
  const d = await window.forge.project.detail('mini-vue-reactivity');
  const l1 = d.levels.find(l => l.id === ${JSON.stringify(lv1.id)});
  const l2 = d.levels.find(l => l.id === ${JSON.stringify(lv2.id)});
  return { doneCount: d.doneCount, next: d.nextLevelId, started: d.started, finished: d.finished,
           l1: { done: l1.done, unlocked: l1.unlocked, attempts: l1.attempts, hasSol: !!l1.solution, xp: l1.xp, caseCount: l1.caseCount, draftLen: (l1.draft||'').length },
           l2: { done: l2.done, unlocked: l2.unlocked, hasSol: !!l2.solution },
           levelCount: d.levelCount }`)
ok(detail.l1.done === true, '第 1 关已记录通关')
ok(detail.doneCount === 1, `总进度 1 / 5（实际 ${detail.doneCount}/${detail.levelCount}）`)
ok(detail.l2.unlocked === true, '第 2 关已解锁')
ok(detail.next && detail.next !== lv1.id, `nextLevelId 指向下一关（${detail.next}）`)
ok(detail.l1.hasSol === true, '已通关关卡才下发参考答案')
ok(detail.l2.hasSol === false, '未通关的下一关不下发参考答案')
ok(detail.l1.caseCount === 6, `检查点数与内容一致（${detail.l1.caseCount}）`)
ok(detail.l1.draftLen > 500, '通关时把代码存成了草稿（切走再回来能接着写）')

const cards = await cdp.evaluate(`
  const cs = await window.forge.project.list();
  const c = cs.find(x => x.id === 'mini-vue-reactivity');
  return { doneCount: c.doneCount, started: c.started, finished: c.finished, next: c.nextLevelId, levelCount: c.levelCount }`)
ok(cards.started === true && cards.doneCount === 1, '列表页进度与详情一致（已开始 1/5）')
ok(cards.finished === false, '未全部完成时 finished 为 false')

// ---------- 8. 地图页回显 + 截图 ----------
await cdp.nav('/projects/mini-vue-reactivity')
await sleep(1200)
const map2 = await cdp.evaluate(`
  const steps = [...document.querySelectorAll('.lv-step')];
  return { done: steps.filter(s => s.classList.contains('done')).length,
           cur: steps.filter(s => s.classList.contains('current')).length,
           text: (document.getElementById('app')?.innerText || document.body.innerText).slice(0, 400) }`)
ok(map2.done === 1, `地图上第 1 关照常显示已通关（实际 done=${map2.done}）`)
ok(map2.cur >= 1, '当前关推进到第 2 关')
await cdp.shot(join(root, 'data', 'qa', 'r26-board-progress.png'))

// ---------- 9. resetAll 复原 ----------
const reset = await cdp.evaluate(`
  await window.forge.project.resetAll('mini-vue-reactivity');
  const d = await window.forge.project.detail('mini-vue-reactivity');
  return { doneCount: d.doneCount, next: d.nextLevelId, unlock2: d.levels[1].unlocked,
           draft: (d.levels[0].draft || '').length, skel: (d.levels[0].skeleton || '').length }`)
ok(reset.doneCount === 0, 'resetAll 清空全部关卡进度')
ok(reset.unlock2 === false, 'resetAll 后第 2 关重新锁定')
ok(reset.draft === reset.skel, 'resetAll 后草稿回到骨架（不留上次的答案）')

// ---------- 9b. 从零重做后，KeepAlive 里缓存的工作台不能吐回旧代码 ----------
// 这是最容易漏的一环：进度清了、编辑器却还是上次的答案，用户会以为没重做成功。
await cdp.nav('/')
await sleep(600)
await cdp.nav('/projects/mini-vue-reactivity')
await sleep(900)
await cdp.clickSel('.lv-step.current')
await cdp.waitFor(`!!document.querySelector('textarea.ce-ta')`, 8000)
await sleep(900)
const revived = await cdp.evaluate(`
  const ta = document.querySelector('textarea.ce-ta');
  const r = document.querySelector('.result');
  return { len: ta.value.length, hasTodo: /TODO/.test(ta.value), staleResult: !!r }`)
ok(revived.hasTodo && revived.len === lv1.skeleton.length, `重做后编辑器回到骨架，没有残留旧答案（${revived.len} 字符${revived.staleResult ? '，但还留着上次的结果面板' : ''}）`)
ok(!revived.staleResult, '重做后不残留上一次的测试结果面板')

// ---------- 10. 控制台干净 ----------
const errs = cdp.errors().filter((e) => !/DevTools|Autofill|Electron Security Warning/i.test(e.text))
ok(errs.length === 0, `渲染端无报错（${errs.length} 条${errs.length ? '：' + JSON.stringify(errs.slice(0, 3)) : ''}）`)

console.log(bad.length ? `\n=== 项目闯关冒烟失败 ${bad.length} 项 ===` : '\n=== 项目闯关冒烟全部通过 ===')
await sleep(200)
await cdp.close()
process.exit(bad.length ? 1 : 0)