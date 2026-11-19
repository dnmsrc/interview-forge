/**
 * 项目闯关内容自检（纯 Node，不用启动应用）。
 *
 * 关卡内容是本功能最容易坏的部分，而且坏法很隐蔽：测试写得过松，用户瞎写也能过；
 * 骨架本身就写对了，等于白送一关。这里用机器把三类问题挡住：
 *   1) 结构：字段缺失、关卡 id 重复、没有 check() 用例
 *   2) 参考解：必须把自己这一关、以及前面每一关的测试全部跑绿（累积式教学的一致性）
 *   3) 骨架：必须跑不过（否则这一关没有可做的事），且必须是语法合法的代码（不能一进来就 SyntaxError）
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { validateProject, dryRunProject, runLevel } from '../../src/shared/project-core.mjs'

const dir = join(import.meta.dirname, '..', '..', 'content', 'projects')
let failures = 0

function fail(msg) { failures++; console.error(`  ✗ ${msg}`) }
function okLine(msg) { console.log(`  ✓ ${msg}`) }

if (!existsSync(dir)) {
  fail(`内容目录不存在：${dir}`)
  process.exit(1)
}

const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
if (!files.length) fail('一个项目都没有')

for (const file of files) {
  console.log(`\n▸ ${file}`)
  let project
  try {
    project = JSON.parse(readFileSync(join(dir, file), 'utf8'))
  } catch (e) {
    fail(`JSON 解析失败：${e.message}`)
    continue
  }

  const structErrs = validateProject(project)
  if (structErrs.length) {
    structErrs.forEach((e) => fail(`结构：${e}`))
    continue
  }
  okLine(`结构完整：${project.levels.length} 关`)

  // 参考解自检（含跨关回归）+ 分步自检 + finalCode 自检
  const report = await dryRunProject(project)
  for (const lv of report.levels) {
    if (lv.own.ok) okLine(`${lv.id} 参考解 ${lv.own.passed}/${lv.own.total} 通过`)
    else {
      fail(`${lv.id} 参考解未通过 ${lv.own.passed}/${lv.own.total}${lv.own.error ? `（运行错误：${lv.own.error}）` : ''}`)
      for (const f of lv.own.failed) console.error(`      - ${f.name}：${f.message}`)
    }
    for (const r of lv.regress) fail(`${lv.id} 的参考解破坏了 ${r.level}：${r.failed.join(', ')} ${r.error ?? ''}`)

    /**
     * 分步质量：每一步的答案要能过本步、且不能过下一步（防照抄跳步）；
     * finalCode 要能过整关测试。这两件事错了，用户看到的「这一步的答案」就是假答案。
     */
    for (const s of lv.stages ?? []) {
      if (!s.ok) fail(`${lv.id} 第 ${s.n} 步答案未通过本步测试（${s.passed}/${s.total}）${s.failed?.length ? `：${s.failed.join('、')}` : ''}`)
      if (s.nextAheadOk === true) fail(`${lv.id} 第 ${s.n} 步答案已能过第 ${s.n + 1} 步——两步该拆或该并`)
    }
    if (lv.final && !lv.final.ok) {
      fail(`${lv.id} finalCode 未通过整关测试（${lv.final.passed}/${lv.final.total}）${lv.final.failed?.length ? `：${lv.final.failed.join('、')}` : ''}`)
    }
  }

  // 骨架自检：必须跑不过，但不能是语法错误
  for (const lv of project.levels) {
    const r = await runLevel(lv.skeleton, 'check("骨架可运行", () => {})')
    if (/SyntaxError/.test(r.error?.message ?? '')) fail(`${lv.id} 骨架有语法错误：${r.error?.message}`)
    const own = await runLevel(lv.skeleton, lv.tests)
    if (own.ok) fail(`${lv.id} 的骨架本身就通过了测试 —— 这一关白送，检查测试是否写得太松`)
    else okLine(`${lv.id} 骨架未通过（${own.cases.filter((c) => c.ok).length}/${own.cases.length}），有活可干`)
    // 骨架必须让人知道「从哪开始」：v3 关卡靠空的函数签名 + 阶段说明
    if (!/\b(function|const|class)\b/.test(lv.skeleton)) fail(`${lv.id} 骨架里连一个函数/变量声明都没有，用户不知道从哪开始写`)
  }
}

/**
 * v3 门禁：这一轮把「所有项目」都重做成分步制，这里把承诺钉住。
 *
 * 只靠每份内容自己写 version:3 不够——漏写一行 version 的项目会静悄悄地走老流程，
 * 用户看到的还是「骨架塞 TODO、整关一次跑」，而作者以为已经迁移完了。
 * 所以在发布前的内容自检里显式要求：每个项目 version≥3，每关 ≥2 步。
 */
{
  const legacy = []
  for (const file of files.filter((f) => f.endsWith('.json'))) {
    const project = JSON.parse(readFileSync(join(dir, file), 'utf8'))
    if (Number(project.version ?? 1) < 3) { legacy.push(`${file}：version=${project.version ?? 1}（应为 3）`); continue }
    for (const lv of project.levels) {
      if (!Array.isArray(lv.stages) || lv.stages.length < 2) legacy.push(`${file} 的 ${lv.id}：只有 ${lv.stages?.length ?? 0} 步（至少 2 步）`)
    }
  }
  if (legacy.length) {
    for (const msg of legacy) fail(`v3 门禁：${msg}`)
  } else okLine(`v3 门禁：${files.length} 个项目全部为分步制`)
}

/**
 * 引擎自检：check 必须支持 async 回调。
 *
 * Promise 类关卡只能写 check('...', async () => ...)。这条如果坏了，
 * 表现是「关卡一跑就把主进程带崩」，而不是一条红——所以单独钉一条最小用例。
 */
{
  const r = await runLevel('const later = (v) => Promise.resolve(v)',
    `check('async 通过', async () => { same(await later(42), 42) })
     check('async 失败能落回用例', async () => { same(await later(1), 2) })`)
  const [good, bad] = r.cases
  if (!good?.ok) fail('引擎：check 的 async 回调无法通过')
  else if (bad?.ok !== false || !bad.message) fail('引擎：check 的 async 回调失败时没有落回用例 message')
  else okLine('引擎：check 支持 async 回调（失败能定位到用例）')
}

console.log(failures ? `\n=== 项目内容自检失败 ${failures} 项 ===` : '\n=== 项目内容自检全部通过 ===')
process.exit(failures ? 1 : 0)