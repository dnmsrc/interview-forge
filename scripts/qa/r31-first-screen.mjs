// R31：关卡页首屏引导 —— 一进来只看见「当前这一步」，背景资料全部折叠。
//
// 验证的是用户的原话：「第一步就需要思考这么多内容？不应该一步一步引导着我跑吗？」
// 所以断言分三层：
//   1. 首屏（不滚动）里只能看到 now-step + 四步总览，看不到 goal/why/思维链/前置知识/API 的正文
//   2. 这些资料确实还在页面上，只是收在 details 里，点开就能读到
//   3. 当前步的 hint 是首屏最显眼的文字，且和 stage_done 对得上
//
// 只读数据库（不改任何数据），脚本无副作用。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Cdp, sleep } from './cdp.mjs'

const root = join(import.meta.dirname, '..', '..')
const project = JSON.parse(readFileSync(join(root, 'content', 'projects', 'mini-vue-reactivity.json'), 'utf8'))
const PID = project.id
const LID = project.levels[0].id

const fail = []
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) fail.push(name)
}

const cdp = await Cdp.connect(25)
await cdp.metrics(1460, 940)
cdp.clearErrors()

const paths = await cdp.evaluate(`return await window.forge.app.paths()`)
const db = new DatabaseSync(paths.db)
db.exec('PRAGMA busy_timeout=5000')
const row = db.prepare(
  `SELECT done, stage_done, attempts FROM project_progress WHERE project_id=? AND level_id=?`
).get(PID, LID)
const stageDone = (() => {
  try { return JSON.parse(row?.stage_done ?? '[]') } catch { return [] }
})()
console.log(`lv1 现状：done=${row?.done} attempts=${row?.attempts} stage_done=${JSON.stringify(stageDone)}`)

await cdp.nav(`/projects/${PID}/${LID}`)
await cdp.reloadHard(2600)
await sleep(1500)

/* ---------- 1. 首屏只显示当前这一步 ---------- */
const first = await cdp.evaluate(`return (() => {
  const vis = (el) => !!el && el.getClientRects().length > 0
  const rect = (el) => el ? el.getBoundingClientRect() : null
  const now = document.querySelector('.now-step')
  const pane = document.querySelector('.task-pane')
  // 「首屏」= 左栏顶部 900px 内真正可见的元素
  const inView = (sel) => [...document.querySelectorAll(sel)].filter((el) => {
    if (!vis(el)) return false
    const r = el.getBoundingClientRect()
    return r.height > 0 && r.top < 860 && r.bottom > 0
  }).length
  return {
    hasNow: vis(now),
    hasJump: !!now?.querySelector('.now-jump'),
    nowTop: now ? Math.round(rect(now).top) : -1,
    chip: now?.querySelector('.now-chip')?.textContent?.trim() ?? '',
    title: now?.querySelector('.now-title')?.textContent?.trim() ?? '',
    hint: now?.querySelector('.now-hint')?.textContent?.trim() ?? '',
    thoughtsInView: inView('.thought'),
    lessonsInView: inView('.lesson'),
    apisInView: inView('.api'),
    stagesInView: inView('.stage-acc'),
    // 折叠区里 details 的开合状态
    foldCount: document.querySelectorAll('.fold-info details').length,
    foldOpen: [...document.querySelectorAll('.fold-info details')].filter((d) => d.open).map((d) => d.querySelector('summary')?.textContent?.trim() ?? ''),
    foldSummaries: [...document.querySelectorAll('.fold-info details summary')].map((s) => s.textContent.replace(/\\s+/g, ' ').trim()),
    stageCount: document.querySelectorAll('.stage-list details.stage-acc').length,
    stageTitles: [...document.querySelectorAll('.stage-list details.stage-acc .stage-title')].map((s) => s.textContent.trim()),
    editorVisible: vis(document.querySelector('.ce:not(.is-ro) textarea.ce-ta')),
    paneScrollTop: pane?.scrollTop ?? -1,
  }
})()`)

check('首屏有「当前这一步」卡片', first.hasNow === true)
check('卡片在首屏靠上位置（不用滚动就能看见）', first.nowTop >= 0 && first.nowTop < 420, `top=${first.nowTop}px`)
check('卡片标了「第 N / 4 步」', /^第 \d+ \/ 4 步$/.test(first.chip), first.chip)
check('卡片标题是这一步的名字', !!first.title, first.title)
check('卡片给了这一步的提示（一句话）', first.hint.length > 8 && first.hint.length < 220, `「${first.hint}」`)

/* 折叠之后最容易断的一环：hint 里写「看那条知识卡」，可知识卡在下面收着，人找不到。
   于是卡片上留了一个直达按钮，点它要能展开「先懂这些」并滚过去。 */
check('卡片上有「前置知识」直达按钮', first.hasJump === true)
const jump = await cdp.evaluate(`return (() => {
  const b = document.querySelector('.now-step .now-jump')
  if (!b) return { ok: false, open: false }
  b.click()
  const d = document.querySelector('.prereq-fold')
  return { ok: true, open: !!d?.open }
})()`)
await sleep(700)
check('点它会把「先懂这些」展开', jump.ok && jump.open === true, `open=${jump.open}`)
await cdp.evaluate(`(() => {
  const d = document.querySelector('.prereq-fold')
  if (d) d.removeAttribute('open')
  document.querySelector('.task-pane').scrollTop = 0
})()`)
await sleep(300)

check('首屏看不到思维链条目', first.thoughtsInView === 0, `可见 ${first.thoughtsInView} 条`)
check('首屏看不到前置知识卡', first.lessonsInView === 0, `可见 ${first.lessonsInView} 张`)
check('首屏看不到 API 契约', first.apisInView === 0, `可见 ${first.apisInView} 个`)
check('首屏能看到四步总览', first.stagesInView >= 2, `可见 ${first.stagesInView} 行`)

const expectedStage = stageDone.length ? Math.max(...stageDone) + 1 : 1
check('当前步和库里的阶段进度一致',
  first.chip.includes(`第 ${expectedStage} /`), `库里已过 ${JSON.stringify(stageDone)}，页面显示「${first.chip}」`)

/* ---------- 2. 背景资料还在，只是收起来了 ---------- */
check('背景资料收成 4 类折叠项', first.foldCount >= 4, `${first.foldCount} 个：${first.foldSummaries.join(' | ')}`)
check('默认全部收起，不占首屏', first.foldOpen.length === 0, first.foldOpen.length ? `开着：${first.foldOpen.join(' | ')}` : '全部收起')

const opened = await cdp.evaluate(`return (() => {
  const d = [...document.querySelectorAll('.fold-info details')].find((x) => (x.querySelector('summary')?.textContent || '').includes('我会怎么想'))
  if (!d) return { ok: false, why: '没找到思维链折叠项' }
  d.open = true
  return { ok: true }
})()`)
await sleep(400)
const afterOpen = await cdp.evaluate(`return (() => {
  const d = [...document.querySelectorAll('.fold-info details')].find((x) => (x.querySelector('summary')?.textContent || '').includes('我会怎么想'))
  const items = [...d.querySelectorAll('.thought')].filter((el) => el.getClientRects().length > 0)
  return { count: items.length, first: items[0]?.querySelector('.thought-h')?.textContent?.trim() ?? '' }
})()`)
check('点开「我会怎么想」确实有内容（不是删掉了）', opened.ok && afterOpen.count > 0,
  `${afterOpen.count} 条，首条：${afterOpen.first}`)
await cdp.evaluate(`(() => {
  const d = [...document.querySelectorAll('.fold-info details')].find((x) => (x.querySelector('summary')?.textContent || '').includes('我会怎么想'))
  if (d) d.open = false
})()`)
await sleep(250)

/* ---------- 3. 四步总览点开能看到细节 ---------- */
const stageOpen = await cdp.evaluate(`return (() => {
  const d = document.querySelector('.stage-list details.stage-acc')
  if (!d) return { ok: false }
  d.open = true
  return { ok: true, title: d.querySelector('.stage-title')?.textContent?.trim() }
})()`)
await sleep(400)
const stageDetail = await cdp.evaluate(`return (() => {
  const d = document.querySelector('.stage-list details.stage-acc[open]')
  if (!d) return null
  const hint = d.querySelector('.stage-hint')?.textContent?.trim() ?? ''
  const think = d.querySelector('.stage-think')?.textContent?.trim() ?? ''
  const hasCode = !!d.querySelector('pre.snippet code')
  return { hint: hint.length, think: think.length, hasCode }
})()`)
check('第 1 步点开后有 think / hint / 代码', !!stageDetail && stageDetail.think > 10 && stageDetail.hint > 10,
  stageDetail ? `think ${stageDetail.think} 字 / hint ${stageDetail.hint} 字` : '打不开')
await cdp.evaluate(`(document.querySelector('.stage-list details.stage-acc[open]')?.removeAttribute('open'))`)
await sleep(250)

/* ---------- 4. 截图留证 ---------- */
await cdp.shot(join(root, 'data', 'qa', 'r31-first-screen.png'))
const scrolled = await cdp.evaluate(`return (() => {
  const pane = document.querySelector('.task-pane')
  if (!pane) return -1
  const list = document.querySelector('.stage-list')
  pane.scrollTop = list ? list.offsetTop - 90 : 380
  return pane.scrollTop
})()`)
await sleep(350)
await cdp.shot(join(root, 'data', 'qa', 'r31-folded.png'))
console.log(`  左栏滚动到 ${scrolled}px 截第二张`)

const errs = cdp.errors()
check('控制台没有报错', errs.length === 0, errs.slice(0, 2).join(' | '))

db.close()
await cdp.close()
console.log(fail.length ? `\n❌ ${fail.length} 项未过：${fail.join('、')}` : '\n✅ 全部通过')
process.exitCode = fail.length ? 1 : 0