// 契约对齐包装：设计文档 §11 验收命令写作 r7-knowledge.mjs，实际端到端实现已演化为
// r8-kb-drawer.mjs（覆盖「考点要求入口 → 看知识出抽屉 → 正文含代码块 → [[前置]] 双链切换 → 来源可见」，
// 并额外校验返回栈、missing 态）。这里保留契约文件名，转调 r8 的无 AI 路径，退出码透传，便于 CI 直接照文档跑。
// 用法：node scripts/qa/r7-knowledge.mjs
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const r = spawnSync(process.execPath, [join(here, 'r8-kb-drawer.mjs'), '--no-ai'], { stdio: 'inherit' })
process.exit(r.status ?? 1)
