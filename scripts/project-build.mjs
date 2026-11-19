/**
 * 项目闯关内容构建器：content/projects-src/*.mjs → content/projects/*.json
 *
 * 为什么内容源不是 JSON：
 * 一关要写骨架、参考解、测试三段代码，JSON 里换行全靠 \n 转义，改一个字符要数一遍反斜杠，
 * 写 8 关以后没人愿意再动内容。源文件用 .mjs + 模板字符串，人写的是能直接读的代码；
 * 构建时再序列化成 JSON，交给主进程照旧读。
 *
 * 构建即质检（不过就退出码非零，不写文件）：
 *   1. 结构：v2 必填字段（prereq / api / steps）齐全，TODO 与分步讲解一一对应
 *   2. 参考解：本关测试全绿，并且能通过前面每一关的测试（累积式教学一致性）
 *   3. 骨架：必须跑不过（否则这关没东西可写），但不能是语法错误（否则一进来就红一片）
 *
 * 用法：
 *   node scripts/project-build.mjs            # 全量构建
 *   node scripts/project-build.mjs --only=mini-vue-reactivity
 *   node scripts/project-build.mjs --dry      # 只校验不写文件
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateProject, dryRunProject, runLevel } from '../src/shared/project-core.mjs'
import { computeCoverage } from '../src/shared/project-coverage.mjs'

const root = join(import.meta.dirname, '..')
const srcDir = join(root, 'content', 'projects-src')
const outDir = join(root, 'content', 'projects')

const args = process.argv.slice(2)
const only = args.find((a) => a.startsWith('--only='))?.slice('--only='.length) ?? null
const dry = args.includes('--dry')

let failed = 0
const fail = (msg) => { failed++; console.error(`   ✗ ${msg}`) }
const ok = (msg) => console.log(`   ✓ ${msg}`)

if (!existsSync(srcDir)) {
  console.error(`✗ 内容源目录不存在：${srcDir}`)
  process.exit(1)
}
if (!dry) mkdirSync(outDir, { recursive: true })

const files = readdirSync(srcDir).filter((f) => f.endsWith('.mjs')).sort()
if (!files.length) {
  console.error('✗ 一个内容源文件都没有')
  process.exit(1)
}

/**
 * 覆盖契约的底座：关卡声明的 nodes 必须真的存在于知识图谱。
 *
 * 「项目闯关要涵盖图谱里所有知识点」这件事只有变成机检才守得住：
 * 手写 id 一个字母错，构建就失败，而不是等到覆盖率报表里出现一个「永远补不上」的幽灵节点。
 */
const graphNodeIds = new Set()
const graphNodes = []
{
  const nodesDir = join(root, 'content', 'nodes')
  if (!existsSync(nodesDir)) {
    console.error(`✗ 知识点目录不存在：${nodesDir}`)
    process.exit(1)
  }
  for (const rel of readdirSync(nodesDir, { recursive: true })) {
    if (typeof rel !== 'string' || !rel.endsWith('.json') || rel.endsWith('_skeleton.json')) continue
    try {
      const data = JSON.parse(readFileSync(join(nodesDir, rel), 'utf8'))
      const list = Array.isArray(data) ? data : data?.nodes
      if (Array.isArray(list)) {
        for (const n of list) if (n?.id) { graphNodeIds.add(n.id); graphNodes.push(n) }
      }
    } catch (e) {
      console.error(`✗ 解析知识点文件 ${rel} 失败：${e?.message ?? e}`)
      process.exit(1)
    }
  }
  if (!graphNodeIds.size) {
    console.error('✗ 知识图谱是空的，无法校验覆盖映射')
    process.exit(1)
  }
}

/** 每关必须声明讲透哪些知识点；id 必须存在、同一关不许重复 */
function validateLevelNodes(project) {
  const errs = []
  for (const lv of project.levels) {
    const list = Array.isArray(lv.nodes) ? lv.nodes : []
    if (!list.length) { errs.push(`${lv.id} 没声明 nodes：这一关讲透图谱里的哪些知识点？`); continue }
    const seen = new Set()
    for (const raw of list) {
      const id = String(raw ?? '').trim()
      if (!id) { errs.push(`${lv.id} 的 nodes 里有空 id`); continue }
      if (!graphNodeIds.has(id)) errs.push(`${lv.id} 的 nodes 引用了图谱里不存在的节点：${id}`)
      else if (seen.has(id)) errs.push(`${lv.id} 的 nodes 重复声明：${id}`)
      seen.add(id)
    }
  }
  return errs
}

for (const file of files) {
  if (only && !file.includes(only)) continue
  console.log(`\n▸ ${file}`)
  const failedBefore = failed
  let project
  try {
    const mod = await import(pathToFileURL(join(srcDir, file)).href)
    project = mod.default
  } catch (e) {
    fail(`加载失败：${e?.message ?? e}`)
    continue
  }

  const structErrs = validateProject(project)
  if (structErrs.length) {
    structErrs.forEach(fail)
    continue
  }

  // 覆盖映射：nodes 必须存在、非空、不许重复
  const nodeErrs = validateLevelNodes(project)
  if (nodeErrs.length) {
    nodeErrs.forEach(fail)
    continue
  }

  // 参考解自检（含跨关回归）
  const report = await dryRunProject(project)
  for (const lv of report.levels) {
    if (lv.own.ok) ok(`${lv.id} 参考解 ${lv.own.passed}/${lv.own.total} 通过`)
    else {
      fail(`${lv.id} 参考解未通过 ${lv.own.passed}/${lv.own.total}${lv.own.error ? `（${lv.own.error}）` : ''}`)
      for (const f of lv.own.failed) console.error(`      - ${f.name}：${f.message}`)
    }
    for (const r of lv.regress) fail(`${lv.id} 的参考解破坏了 ${r.level}：${r.failed.join('、')} ${r.error ?? ''}`)

    /**
     * 「这一步的答案」自检。
     *
     * 卡片上的答案用的就是 stage.code，所以两件事必须成立：
     * 1) 它得真能过这一步的测试——否则用户照着抄还是红，等于给了一份错答案；
     * 2) 它不能顺带过下一步的测试——能过说明这一步的答案其实已经做完了下一步，
     *    用户抄完会「白得一步」，后面的步骤也就失去意义了。
     */
    for (const s of lv.stages ?? []) {
      if (!s.ok) {
        fail(`${lv.id} 第 ${s.n} 步的答案没过这一步的测试（${s.passed}/${s.total}）${s.failed?.length ? `：${s.failed.join('、')}` : ''}${s.error ? `（${s.error}）` : ''}`)
        continue
      }
      if (s.nextAheadOk === true) {
        fail(`${lv.id} 第 ${s.n} 步的答案已经能过第 ${s.n + 1} 步的测试——照着抄会直接跳过一步，这两步该合并或该拆`)
        continue
      }
      ok(`${lv.id} 第 ${s.n} 步答案自检通过（能过本步、不外溢到下一步）`)
    }

    /**
     * finalCode 自检：整关做完后的完整实现必须过整关测试。
     *
     * 以前只验 solution 与各步答案，漏了 finalCode——它是用户在「通关后对照」看到的
     * 那一份，写错了比不给更糟（照着抄还是红）。这里和 stage 自检一样机器兜住。
     */
    const fin = lv.final
    if (fin && !fin.ok) {
      fail(`${lv.id} finalCode 未通过整关测试（${fin.passed}/${fin.total}）${fin.failed?.length ? `：${fin.failed.join('、')}` : ''}${fin.error ? `（${fin.error}）` : ''}`)
    } else if (fin) ok(`${lv.id} finalCode 整关测试全绿（${fin.passed}/${fin.total}）`)
  }

  // 骨架自检
  for (const lv of project.levels) {
    const probe = await runLevel(lv.skeleton, 'check("骨架可运行", () => {})')
    if (/SyntaxError/.test(probe.error?.message ?? '')) {
      fail(`${lv.id} 骨架有语法错误：${probe.error?.message}`)
      continue
    }
    const own = await runLevel(lv.skeleton, lv.tests)
    if (own.ok) fail(`${lv.id} 骨架直接就能跑通，这一关等于白送`)
    else ok(`${lv.id} 骨架如期未通过（${own.cases.filter((c) => c.ok).length}/${own.cases.length} 绿）`)
  }

  if (failed > failedBefore) continue
  if (!dry) {
    const outFile = join(outDir, `${project.id}.json`)
    writeFileSync(outFile, `${JSON.stringify(project, null, 2)}\n`, 'utf8')
    ok(`已写出 ${join('content', 'projects', `${project.id}.json`)}（${project.levels.length} 关）`)
  }
}

if (failed) {
  console.error(`\n✗ 共有 ${failed} 处问题，未写文件。`)
  process.exit(1)
}

// 构建完顺手报一次全站覆盖：补内容的人不用再单独跑一遍报告
if (!dry && !only) {
  const built = []
  for (const f of readdirSync(outDir)) {
    if (!f.endsWith('.json')) continue
    try { built.push(JSON.parse(readFileSync(join(outDir, f), 'utf8'))) } catch { /* 忽略坏文件：上面的构建已经拦过 */ }
  }
  const cov = computeCoverage(built, graphNodes)
  console.log(`\n覆盖：${cov.totalTargets} 个知识点（L3/L4）中已收编 ${cov.covered} 个（${(cov.ratio * 100).toFixed(1)}%），还差 ${cov.missing} 个`)
  if (cov.missing) console.log('  未覆盖清单：node scripts/project-coverage.mjs --gaps')
}

// 构建完顺手提醒：JSON 是产物，改内容要改 .mjs
if (!dry) console.log('\n完成。内容源在 content/projects-src/，JSON 是构建产物，不要直接编辑。')