// 铺量性能验收（契约 §2.3 / §11：应用启动的轻量同步在 5000 篇下必须 <1 秒）
//
// 造 5000 篇「能过闸门」的 md（约 5KB/篇，含八小节 + 代码块 + 2 条来源），
// 用真实 CLI（scripts/kb-index.mjs，独立临时库）连跑三轮：
//   第 1 轮 全量入库（读文件 + 分词 + 闸门，慢是应该的）
//   第 2 轮 零变化  → 断言 < 1000ms（走 size:mtime 扫描缓存，连文件都不读）
//   第 3 轮 改 1 篇 → 断言只更新 1 行、耗时 < 1500ms
// 用法：node scripts/qa/kb-perf.mjs [--files 5000] [--keep]
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync, existsSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { wordCountOf, parseKnowledgeMd } from '../../src/shared/knowledge-core.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const argv = process.argv.slice(2)
const numOpt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d }
const N = Math.max(100, numOpt('files', 5000))
const KEEP = argv.includes('--keep')

const TMP = join(tmpdir(), `kb-perf-${Date.now()}`)
const KB = join(TMP, 'knowledge')
const DB = join(TMP, 'perf.db')
mkdirSync(KB, { recursive: true })

const LOREM = '这一段用来说明机制细节与边界条件，配合上面的代码把因果链讲完，顺便凑够字数下限。'
function doc(i) {
  const body = [`## 一句话本质`,
    `压测样本 ${i}：用固定话术描述一个虚构机制的本质，保证每篇内容都不同。`,
    ``, `## 为什么需要它`,
    Array(10).fill(`${LOREM}第 ${i} 号样本的第 ${'一二三四五六'[i % 6]} 种动机说明。`).join('\n'),
    ``, `## 机制讲清楚`,
    '```ts', `const sample${i} = () => ${i}`, '```',
    Array(14).fill(LOREM + ` 变体 ${i}-${'abcdefgh'[i % 8]}。`).join('\n'),
    ``, `## 关键结论`, `- 结论一：样本 ${i} 的适用边界在阈值以内`, `- 结论二：超出阈值后成本线性上升`,
    ``, `## 常见误区`, `- 「压测样本不能代表真实分布」——部分成立，见前置说明`,
    ``, `## 常见问法`, `- 追问链：为什么要压测 → 阈值怎么定 → 缓存为什么有效`,
    ``, `## 前置知识`, `- 无（压测夹具不引用真实考点，避免制造断链）`,
    ``, `## 相关`, `- 无`, ''].join('\n')
  return `---
node: perf.dom${i % 40}.sample${i}
title: 压测样本 ${i}
sources:
  - url: https://example.com/official/${i}
    title: 官方文档 ${i}
    kind: official
  - url: https://example.com/doc/${i}
    title: 参考文档 ${i}
    kind: doc
updated: 2026-11-10T06:00:00Z
generator: kb-perf@1
reviewed: false
confidence: medium
---

${body}
`
}

console.log(`造样中：${N} 篇 → ${KB}`)
const t0 = Date.now()
for (let i = 0; i < N; i++) {
  const dir = join(KB, `dom${i % 40}`, `b${Math.floor(i / 40) % 10}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `sample${i}.md`), doc(i), 'utf8')
}
console.log(`  生成耗时 ${Date.now() - t0}ms`)

// 夹具本身必须先过字数线，否则闸门会把它全打回去，测的就不是性能而是配置错误
{
  const sample = readFileSync(join(KB, 'dom0', 'b0', 'sample0.md'), 'utf8')
  const words = wordCountOf(parseKnowledgeMd(sample).bodyMd)
  console.log(`  单篇字数：${words}`)
  if (words < 950) {
    console.log(`✗ 夹具字数不足（闸门线 900），请加长 doc() 的正文（当前 ${words}）`)
    rmSync(TMP, { recursive: true, force: true })
    process.exit(1)
  }
}

// 用真库副本当底座：nodes 表里有真实节点，双链校验才有意义（空 nodes 表会把所有 [[链接]] 判成断链）
const baseDb = join(ROOT, 'data', 'app.db')
copyFileSync(baseDb, DB)
for (const side of ['-wal', '-shm']) {
  if (existsSync(baseDb + side)) copyFileSync(baseDb + side, DB + side)
}

function runCli(label, maxMs, expectLine) {
  const t = Date.now()
  let out = ''
  try {
    out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'kb-index.mjs'), '--db', DB, '--content', KB], { encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024 })
  } catch (e) {
    console.log(`✗ ${label} CLI 非 0 退出：${String(e?.stdout ?? '').slice(0, 800)}\n${e?.stderr ?? e}`)
    process.exitCode = 1
    return null
  }
  const ms = Date.now() - t
  const line = out.split('\n').find((l) => l.includes('扫描')) ?? ''
  const pass = ms < maxMs
  console.log(`${pass ? '✓' : '✗'} ${label}：${ms}ms（阈值 ${maxMs}ms）｜${line.trim()}`)
  if (expectLine && !line.includes(expectLine)) { console.log(`  ✗ 输出缺少预期片段「${expectLine}」`); process.exitCode = 1 }
  if (!pass) process.exitCode = 1
  if (/问题 \d+ 条/.test(out)) { console.log('  ✗ CLI 报了质量问题：\n' + out.split('\n').filter((l) => /^\s+[·└]/.test(l)).slice(0, 8).join('\n')); process.exitCode = 1 }
  return ms
}

console.log('\n跑 CLI 三轮：')
runCli('第 1 轮 全量入库', 60000, `新增 ${N}`)          // 首轮慢是合理的，只要不出错
runCli('第 2 轮 零变化（启动路径）', 1000, `跳过 ${N}`)  // ← 契约硬指标
// 改一篇：mtime 变了 → 走读文件比 hash 的路径
const victim = join(KB, 'dom7', 'b0', 'sample7.md')
if (existsSync(victim)) {
  writeFileSync(victim, doc(7) + '\n补一段：验证增量只动一行。\n', 'utf8')
  const future = new Date(Date.now() + 5000)
  utimesSync(victim, future, future)
  runCli('第 3 轮 改 1 篇', 1500, '更新 1')
}

if (KEEP) console.log(`\n保留临时目录：${TMP}`)
else { rmSync(TMP, { recursive: true, force: true }); console.log('\n已清理临时目录') }
