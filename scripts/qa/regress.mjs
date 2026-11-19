// 一键回归：串跑三轮 QA（退出码非零 = 有失败项）
import { execSync } from 'node:child_process'
const run = (f) => {
  console.log(`\n######## ${f} ########`)
  try { console.log(execSync(`node scripts/qa/${f}`, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 600000 })) }
  catch (e) { console.log(e.stdout || ''); console.error('!! ' + f + ' 异常退出'); process.exitCode = 1 }
}
run('qa1-pages.mjs')
run('qa2-responsive.mjs')
run('qa3-interact.mjs')
// 项目闯关：内容库逐关渲染（r42）+ 项目卡片墙、覆盖总览、关卡章节网格（r44）
run('r42-project-library.mjs')
run('r44-project-grid.mjs')
console.log(process.exitCode ? '\n=== 回归存在失败 ===' : '\n=== 全部通过 ===')
