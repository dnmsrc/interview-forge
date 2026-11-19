// R42：项目库全量验收 —— 9 个项目按领域分栏，且每个项目第 1 关的 v3 内容
// （前置知识 / API 契约 / 思维链 / 分阶段步骤条 / 骨架编辑器）都能在应用里渲染出来。
//
// 这个脚本只读不写：不推荐答案、不写草稿、不跑测试，不会改任何进度。
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Cdp, sleep } from './cdp.mjs'

const root = join(import.meta.dirname, '..', '..')
const dir = join(root, 'content', 'projects')
const projects = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
  // 列表页的领域顺序：fe / be / cs / ai / eng
  .sort((a, b) => ['fe', 'be', 'cs', 'ai', 'eng'].indexOf(a.domain) - ['fe', 'be', 'cs', 'ai', 'eng'].indexOf(b.domain))

const fail = []
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) fail.push(name)
}

const cdp = await Cdp.connect(25)
await cdp.metrics(1460, 940)
await cdp.reloadHard(2500)

// ---------- 1. 项目列表 ----------
await cdp.nav('/projects')
for (let i = 0; i < 40; i++) {
  const n = await cdp.evaluate("return document.querySelectorAll('.pcard').length")
  if (n >= projects.length) break
  await sleep(300)
}

const list = await cdp.evaluate(`return (() => {
  const groups = [...document.querySelectorAll('.pgroup')].map((g) => ({
    label: (g.querySelector('.pgroup-head h2') || {}).textContent?.trim() || '',
    count: g.querySelectorAll('.pcard').length,
    cards: [...g.querySelectorAll('.ptitle')].map((t) => t.textContent.trim())
  }))
  return {
    groups,
    total: document.querySelectorAll('.pcard').length,
    // 每张卡都应该有关数徽标与进度读数，不能是空列表
    hasMeta: [...document.querySelectorAll('.pcard')].every((c) =>
      !!c.querySelector('.pmeta') && /\\d+ \\/ \\d+/.test(c.querySelector('.pprog')?.textContent || ''))
  }
})()`)

check(`项目列表共 ${projects.length} 个项目`, list.total === projects.length, `实际 ${list.total}`)
const byLabel = Object.fromEntries(list.groups.map((g) => [g.label, g.count]))
// 期望值从内容库算：新加项目时这里不会误报，只验「分栏数与各栏数量跟内容一致」
const DOMAIN_LABEL = { fe: '前端', be: '后端', cs: '公共基础', ai: 'AI Agent', eng: '工程难题' }
const wantByLabel = {}
for (const p of projects) {
  const label = DOMAIN_LABEL[p.domain] ?? '其它'
  wantByLabel[label] = (wantByLabel[label] ?? 0) + 1
}
check(
  '按领域分栏且各栏数量与内容一致',
  list.groups.length === Object.keys(wantByLabel).length &&
    Object.entries(wantByLabel).every(([k, v]) => byLabel[k] === v),
  JSON.stringify(byLabel)
)
check('每张卡都有「N 关」徽标与进度读数', list.hasMeta)
const listedTitles = list.groups.flatMap((g) => g.cards).sort()
const wantTitles = projects.map((p) => p.title).sort()
check('列表里的项目标题与内容一一对应', JSON.stringify(listedTitles) === JSON.stringify(wantTitles), `${listedTitles.length} 张卡`)

// ---------- 2. 每个项目的第 1 关 ----------
async function openLevel(project) {
  const lv = project.levels[0]
  await cdp.nav(`/projects/${project.id}/${lv.id}`)
  for (let i = 0; i < 45; i++) {
    const ready = await cdp.evaluate("return !!document.querySelector('.work-pane textarea') && document.querySelectorAll('.stage-tab').length > 0")
    if (ready) break
    await sleep(300)
  }
  const r = await cdp.evaluate(`return (() => {
    const txt = document.body.innerText
    return {
      title: (document.querySelector('.lv-name') || {}).textContent?.trim() || '',
      gate: !!document.querySelector('.gate'),
      lessons: document.querySelectorAll('.lesson').length,
      apis: document.querySelectorAll('.api').length,
      thoughts: document.querySelectorAll('.thought').length,
      stageTabs: document.querySelectorAll('.stage-tab').length,
      activeTabs: document.querySelectorAll('.stage-tab.now').length,
      editorLines: (document.querySelector('.work-pane textarea')?.value || '').split('\\n').length,
      runButton: [...document.querySelectorAll('button')].some((b) => /下一步|跑测试|运行中/.test(b.textContent)),
      chip: (document.querySelector('.todo-chip') || {}).textContent?.replace(/\\s+/g, ' ').trim() || ''
    }
  })()`)
  return { lv, r }
}

for (const project of projects) {
  const { lv, r } = await openLevel(project)
  const tag = project.id
  check(`[${tag}] 第 1 关可进入（不是锁定拦截页）`, !r.gate, r.title)
  check(`[${tag}] 前置知识 ≥2 条`, r.lessons >= 2, `${r.lessons} 条`)
  check(`[${tag}] API 契约卡渲染`, r.apis >= 1, `${r.apis} 张`)
  check(`[${tag}] 思维链条数一致`, r.thoughts === lv.thinking.length, `${r.thoughts}/${lv.thinking.length}`)
  check(`[${tag}] 分阶段步骤条条数一致`, r.stageTabs === lv.stages.length, `${r.stageTabs}/${lv.stages.length}`)
  // 用户可能已经在某一关里推进到中间步（本机真实进度就是这样），所以只断言
  // 「恰好有一个正在做的步，且计数条与步骤总数对得上」，不假设一定是第 1 步
  check(
    `[${tag}] 恰好一个步骤是「正在做」，计数条为「第 x / N 步」`,
    r.activeTabs === 1 && new RegExp(`第 \\d+ / ${lv.stages.length} 步`).test(r.chip),
    r.chip
  )
  check(`[${tag}] 编辑器有骨架（≥8 行）且运行按钮可点`, r.editorLines >= 8 && r.runButton, `${r.editorLines} 行`)
}

await cdp.shot(join(root, 'data', 'qa', 'r42-library.png'))

const consoleErrors = (cdp.consoleErrors || []).slice(0, 3)
check('无 console 报错', consoleErrors.length === 0, consoleErrors.join(' | '))

await cdp.clearMetrics()
await cdp.close()
console.log(fail.length ? `\n❌ ${fail.length} 项失败：${fail.join('、')}` : '\n✅ 项目库验收全部通过')
process.exit(fail.length ? 1 : 0)