/**
 * R27 项目闯关冒烟：走一遍「讲解渲染 → 写入参考解 → 跑测试 → 通关 → 下一关解锁」。
 *
 * 目的不是替代内容自检（那是 vm 里跑的），而是验证 UI 与主进程的接线：
 * 前置知识 / API 契约 / 分步三块确实渲染出来了，草稿能存，
 * 判题走真实 IPC，通关面板与「下一关」按钮真的出现。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Cdp } from './cdp.mjs'

const root = join(import.meta.dirname, '..', '..')
const projectId = 'js-core-toolkit'
const project = JSON.parse(readFileSync(join(root, 'content', 'projects', `${projectId}.json`), 'utf8'))
const lv1 = project.levels[0]
const lv2 = project.levels[1]

let failed = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ✓ ${name}`)
  else { failed++; console.error(`  ✗ ${name}${detail ? `｜${detail}` : ''}`) }
}

const cdp = await Cdp.connect()
// 先进列表页再进关卡：如果上一次运行停在同一个地址，直接改 hash 是 no-op，
// 会读到 KeepAlive 里缓存的旧页面状态（旧草稿、旧结果）
await cdp.nav('/projects')
await new Promise((r) => setTimeout(r, 500))
await cdp.nav(`/projects/${projectId}/${lv1.id}`)
// 路由切换 + IPC 拉详情是异步的，等讲解真正渲染出来再断言（固定 sleep 会偶发抢跑）
for (let i = 0; i < 25; i++) {
  const n = await cdp.evaluate("return document.querySelectorAll('.lesson').length")
  if (n >= 2) break
  await new Promise((r) => setTimeout(r, 300))
}

const rendered = await cdp.evaluate(`
  return {
    lessons: document.querySelectorAll('.lesson').length,
    apis: document.querySelectorAll('.api').length,
    steps: document.querySelectorAll('.step').length,
    goal: document.querySelector('.goal p')?.innerText ?? '',
    chip: document.querySelector('.todo-chip')?.innerText ?? '',
    tokens: document.querySelectorAll('.ce-hl .tk-kw').length
  }
`)
check('前置知识渲染出来了', rendered.lessons >= 2, JSON.stringify(rendered))
check('API 契约卡渲染出来了', rendered.apis >= 1)
check('分步卡片渲染出来了', rendered.steps >= 2)
check('目标文案存在', rendered.goal.length > 10)
check('编辑器有语法高亮', rendered.tokens >= 3, `token=${rendered.tokens}`)
check('TODO 计数条显示剩余数', /还剩\s*\d+\/\d+/.test(rendered.chip), rendered.chip)
await cdp.shot(join(root, 'data', 'qa', 'r27-smoke-lv1.png'))

// 写入参考解 → 触发草稿 → 跑测试
const filled = await cdp.evaluate(`
  const ta = document.querySelector('.ce-ta')
  const code = ${JSON.stringify(lv1.solution)}
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(ta, code)
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 400))
  return { len: ta.value.length }
`)
check('参考解已写入编辑器', filled.len > 50)

// 用 DOM click 而不是坐标点击：sticky 工具栏在滚动容器里，坐标点击偶发落空
await cdp.evaluate(`
  const b = [...document.querySelectorAll('button')].find((x) => /跑测试/.test(x.innerText))
  if (!b) throw new Error('找不到「跑测试」按钮')
  b.click()
  return 1
`)
for (let i = 0; i < 30; i++) {
  if (await cdp.evaluate("return !!document.querySelector('.pass-panel, .result')")) break
  await new Promise((r) => setTimeout(r, 300))
}
const result = await cdp.evaluate(`
  return {
    pass: !!document.querySelector('.pass-panel'),
    passText: document.querySelector('.pass-panel')?.innerText?.slice(0, 60) ?? '',
    cases: document.querySelectorAll('.case').length,
    green: document.querySelectorAll('.case.ok').length,
    next: [...document.querySelectorAll('button')].some((b) => /下一关/.test(b.innerText)),
    chip: document.querySelector('.todo-chip')?.innerText ?? ''
  }
`)
check('通关面板出现', result.pass, result.passText)
check('检查点全部变绿', result.cases > 0 && result.green === result.cases, `${result.green}/${result.cases}`)
check('出现「下一关」按钮', result.next)
check('TODO 计数条变成「都补完了」', /都补完/.test(result.chip), result.chip)
await cdp.shot(join(root, 'data', 'qa', 'r27-smoke-pass.png'))

// 下一关应当解锁（不再是「还没解锁」的拦截页）
await cdp.nav(`/projects/${projectId}/${lv2.id}`)
await new Promise((r) => setTimeout(r, 1200))
const unlocked = await cdp.evaluate(`
  return {
    gate: !!document.querySelector('.gate'),
    lessons: document.querySelectorAll('.lesson').length,
    title: document.querySelector('.lv-name')?.innerText?.slice(0, 40) ?? ''
  }
`)
check('下一关已解锁（不是拦截页）', !unlocked.gate, unlocked.title)
check('下一关也渲染了讲解', unlocked.lessons >= 2)

await cdp.close()
console.log(failed ? `\n✗ ${failed} 项失败` : '\n=== 项目闯关冒烟全部通过 ===')
process.exit(failed ? 1 : 0)