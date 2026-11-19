/**
 * 项目闯关的执行内核。
 *
 * 为什么独立成 .mjs、放在 shared 下：
 * 1) 它不依赖 Electron。scripts/qa 可以直接 import 跑「关卡内容自检」——每关的参考解
 *    必须把自己的测试全部跑绿，否则内容就是坏的。否则每改一次关卡都要开应用手点一遍。
 * 2) 关卡内容与执行器是同一个契约：测试代码里的 check/same/ok/throws 全部由这里注入。
 *    只有放在 shared 下，才能保证「写内容时看到的断言 API」和「真正跑测试的引擎」是同一份定义。
 *
 * 沙箱纪律：关卡代码只能拿到 console、断言函数和一组安全内置，没有 require / process / fs。
 * content/ 下的 json 虽然在本地，但仍按不可信代码执行——以后题库可能来自网络。
 */
import vm from 'node:vm'
import { inspect } from 'node:util'

const DEFAULT_TIMEOUT_MS = 4000
const MAX_LOGS = 80

/** 关卡内容的必填字段：缺一个就在校验阶段报出来，而不是等运行时报 TypeError */
const LEVEL_FIELDS = ['id', 'title', 'goal', 'skeleton', 'solution', 'tests']

/**
 * v2 起，每一关必须先把「学」讲清楚再让人动手。
 *
 * 起因很具体：第一版关卡只给了 goal/why/task 三段散文，用户的原话是
 * 「reactive(obj) 是做什么的？我根据你的信息只能写一个空函数」。
 * 所以 v2 把教学结构硬编码进契约，缺一块就校验不过：
 *
 *   prereq  —— 动手前必须看懂的前置知识（Proxy 是什么、Map 怎么用）
 *   api     —— 你要交付的函数契约（签名 / 参数含义 / 返回值 / 调用示例）
 *   steps   —— 分步做法，每步对应骨架里一个 TODO
 *
 * 关键约束：steps 里的 todo 必须与 skeleton 里的 `// TODO n` 一一对应（下面 validateProject 会查）。
 * 这条约束让「讲解」和「代码」不可能各写各的：漏讲一个 TODO、或多讲一个不存在的 TODO，都会报错。
 */
const LEVEL_FIELDS_V2 = ['prereq', 'api', 'steps']

function formatArg(v) {
  if (typeof v === 'string') return v
  try { return inspect(v, { depth: 2, breakLength: 140, compact: 3 }) } catch { return String(v) }
}

/** 跨 realm 的安全比较：vm context 里的对象原型链与宿主不同，instanceof 不可靠，只走 JSON 形态 */
function normalize(v, depth = 0) {
  if (depth > 6) return '[deep]'
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'function') return '[function]'
    if (typeof v === 'number' && Number.isNaN(v)) return '[NaN]'
    if (v === undefined) return '[undefined]'
    return v
  }
  if (Array.isArray(v)) return v.map((x) => normalize(x, depth + 1))
  if (typeof v.then === 'function') return '[promise]'
  const out = {}
  for (const k of Object.keys(v).sort()) {
    // 只读自有可枚举属性：reactive 代理读到的就是原对象的键，顺序无关
    try { out[k] = normalize(v[k], depth + 1) } catch (e) { out[k] = `[getter throws: ${e?.message ?? e}]` }
  }
  return out
}

function sameValue(a, b) {
  if (Object.is(a, b)) return true
  if (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  try { return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b)) } catch { return false }
}

/**
 * 跑一关：先执行用户代码，再执行本关测试。
 * 两者共享同一个 vm context，所以测试代码可以直接引用用户代码里顶层声明的 const/let/function。
 * 测试代码整体包在 async IIFE 里，因此允许 await（computed/nextTick 这类关卡需要微任务）。
 */
export async function runLevel(code, testsCode, opts = {}) {
  const timeout = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS
  const logs = []
  const cases = []
  const started = Date.now()

  const pushLog = (level) => (...args) => {
    if (logs.length >= MAX_LOGS) return
    logs.push({ level, text: args.map(formatArg).join(' ') })
  }

  let currentCase = null

  /**
   * 异步检查点。
   *
   * Promise / async 类关卡没法用同步断言写：then 的回调要在微任务之后才执行，
   * 于是只能 check('x', async () => { same(await p, 42) })。
   * 早先 check() 只调 fn()，async fn 抛的错会变成「没人接的 rejection」——
   * 进程直接崩（v8 默认把 unhandled rejection 升级成致命错误），连用例名都对不上。
   *
   * 现在：fn 返回 thenable 就登记到 pending，等测试脚本跑完后统一 await，
   * 失败照样落回这条用例的 message。同步用例的行为完全不变。
   */
  const pending = []

  const ctx = vm.createContext({
    console: {
      log: pushLog('log'), info: pushLog('info'), warn: pushLog('warn'),
      error: pushLog('error'), debug: pushLog('log'),
      // console.table 之类在关卡里没有意义，但别让用户一用就崩
      table: pushLog('log'), dir: pushLog('log')
    },
    /**
     * 注册一条测试用例；fn 里抛错即视为该用例失败，后续用例继续跑。
     *
     * fn 可以是 async 函数（Promise 类关卡要用）。返回 thenable 时先登记，
     * 由 runLevel 在所有用例登记完之后统一结算，不让 rejection 逃到宿主进程。
     */
    check(name, fn) {
      const c = { name: String(name), ok: false, message: '' }
      cases.push(c)
      const prev = currentCase
      currentCase = c
      try {
        const ret = fn()
        if (ret && typeof ret.then === 'function') {
          pending.push(Promise.resolve(ret).then(
            () => { c.ok = true },
            (e) => { c.ok = false; c.message = String(e?.message ?? e) }
          ))
        } else {
          c.ok = true
        }
      } catch (e) {
        c.ok = false
        c.message = String(e?.message ?? e)
      } finally {
        currentCase = prev
      }
    },
    /** 断言为真 */
    ok(cond, msg = '断言失败：期望为真') {
      if (!cond) throw new Error(msg)
    },
    /** 深比较相等（数字/字符串/布尔/数组/普通对象） */
    same(actual, expected, msg = '') {
      if (!sameValue(actual, expected)) {
        const detail = `期望 ${formatArg(expected)}，实际 ${formatArg(actual)}`
        throw new Error(msg ? `${msg}｜${detail}` : detail)
      }
    },
    /** 深比较不相等 */
    notSame(actual, expected, msg = '') {
      if (sameValue(actual, expected)) {
        throw new Error(msg ? `${msg}｜两者都等于 ${formatArg(actual)}` : `不应等于 ${formatArg(actual)}`)
      }
    },
    /** 期望 fn 抛错（或抛出的错误信息匹配 pattern） */
    throws(fn, msg = '期望抛出错误') {
      let threw = false
      let err = null
      try { fn() } catch (e) { threw = true; err = e }
      if (!threw) throw new Error(msg)
      return err
    },
    /** 允许关卡测试自己拿到的用例计数 */
    get __caseCount() { return cases.length }
  })

  const wrap = (e) => ({ message: String(e?.message ?? e), stack: String(e?.stack ?? '') })
  const finish = (error) => ({
    ok: !error && cases.length > 0 && cases.every((c) => c.ok),
    cases, logs, error, ms: Date.now() - started
  })

  try {
    vm.runInContext(String(code ?? ''), ctx, { timeout, filename: 'level-code.js' })
    const script = new vm.Script(`(async () => {\n${String(testsCode ?? '')}\n})()`, { filename: 'level-tests.js' })
    const p = script.runInContext(ctx, { timeout })
    // 测试内部的 await 不受 runInContext 的 timeout 约束（它只管同步段）。
    // 这里再压一层总超时，避免 await 永不 resolve 把主进程的 IPC 挂死。
    /**
     * 总超时闸：测试内部的 await 不受 runInContext 的 timeout 约束（它只管同步段），
     * 所以这里再压一层，避免「永远不 resolve 的 await」把主进程的 IPC 挂死。
     *
     * 这个 timer 必须**保持引用**（不能 unref）：用户代码里如果有一个永远不落定的
     * promise，事件循环就只剩这个 timer 了；unref 掉的话 Node 直接退出并抛
     * 「unsettled top-level await」，把「某一步卡住」伪装成「构建脚本崩了」。
     * 用完 clearTimeout，不让它拖住进程。
     */
    let timer = null
    const timeoutErr = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ __timeout: true }), timeout + 1000)
    })
    const raced = await Promise.race([
      // 脚本跑完后还要等异步用例结算：check 里登记的 pending 才是「最后一句断言」
      Promise.resolve(p)
        .then(() => (pending.length ? Promise.all(pending) : null))
        .then(() => ({ __done: true }), (e) => ({ __error: e })),
      timeoutErr
    ])
    if (timer) clearTimeout(timer)
    if (raced.__timeout) return finish({ message: `测试超时（${timeout + 1000}ms）：检查是否有 await 永远等不到结果`, stack: '' })
    if (raced.__error) return finish(wrap(raced.__error))
    return finish(null)
  } catch (e) {
    return finish(wrap(e))
  }
}

const isStr = (v) => typeof v === 'string' && v.trim().length > 0

/**
 * v3：关卡由「若干可跑测试的阶段」递进组成，不再是「一个骨架塞几个 TODO」。
 *
 * 起因还是用户的原话：「一开始读题都读不懂；你最多提供一些步骤的提示，
 * 但我需要看到完整的代码，包括你在开发这个功能的所有，以及如何调用它」。
 * 只让人填两行 Reflect.get，学不到「为什么这样想」。所以 v3 逼着内容作者交出：
 *
 *   thinking   —— 我的思维链：先问什么、为什么选这条路、踩了什么坑、用了哪些知识
 *   stages     —— 每一步都有「完整代码 + 该步测试」，写完就能跑，绿了再往下
 *   finalCode  —— 整关做完后的完整实现（学生自己写完才看得到）
 *   usage      —— 这段代码怎么被调用（不然「能跑」和「会用」是两回事）
 *
 * 与 v2 的 steps/TODO 并存：有 stages 的关卡走新流程，没有的仍按老流程。
 */
const LEVEL_FIELDS_V3 = ['thinking', 'stages', 'finalCode', 'usage']

function validateStages(lv, i, errs) {
  const tag = `第 ${i + 1} 关`

  if (!Array.isArray(lv.thinking) || lv.thinking.length < 2) {
    errs.push(`${tag} 缺少思维链 thinking（至少 2 条：先想什么、为什么这样选）`)
  } else {
    lv.thinking.forEach((t, k) => {
      if (!isStr(t?.title)) errs.push(`${tag} 的 thinking[${k}] 缺少 title`)
      if (!isStr(t?.md) || t.md.trim().length < 50) {
        errs.push(`${tag} 的 thinking[${k}] 太短（≥50 字：要写出「我当时的判断」和「为什么排除另一种做法」）`)
      }
    })
  }

  if (!Array.isArray(lv.stages) || lv.stages.length < 2) {
    errs.push(`${tag} 缺少分阶段 stages（至少 2 步，每步都要能独立跑测试）`)
    return
  }

  lv.stages.forEach((st, k) => {
    const t = `${tag} 的 stages[${k}]`
    if (Number(st?.n) !== k + 1) errs.push(`${t}.n 必须是 ${k + 1}（阶段编号从 1 连续递增）`)
    if (!isStr(st?.title)) errs.push(`${t} 缺少 title`)
    if (!isStr(st?.think) || st.think.trim().length < 30) errs.push(`${t} 缺少 think（这一步为什么现在做，≥30 字）`)
    if (!isStr(st?.hint) || st.hint.trim().length < 10) errs.push(`${t} 缺少 hint（怎么做，但不给完整代码）`)
    if (!isStr(st?.code)) errs.push(`${t} 缺少 code（这一步完成后的完整代码）`)
    if (!isStr(st?.test) || !/check\s*\(/.test(st.test)) errs.push(`${t} 的 test 必须用 check() 注册检查点`)
    if (st?.vocab != null && !Array.isArray(st.vocab)) errs.push(`${t}.vocab 必须是数组`)

    // 失败诊断：按检查点顺序一一对应，只在「跑红」时由主进程附加到失败的用例上。
    // 不写进 test 源码（那会改变 stage_hash，把用户已经通过的进度作废）。
    if (st?.diag != null) {
      const caseN = (String(st.test ?? '').match(/\bcheck\s*\(/g) ?? []).length
      if (!Array.isArray(st.diag)) {
        errs.push(`${t}.diag 必须是数组（与检查点顺序一一对应）`)
      } else {
        if (st.diag.length !== caseN) {
          errs.push(`${t}.diag 有 ${st.diag.length} 条，但这步有 ${caseN} 个检查点（顺序一一对应，不能多也不能少）`)
        }
        st.diag.forEach((d, j) => {
          if (!isStr(d) || d.trim().length < 12) errs.push(`${t}.diag[${j}] 太短（≥12 字：说清失败时最可能少写了什么）`)
        })
      }
    }
  })

  // 阶段的 code 必须是「可运行的一整段」，不是片段：至少要出现 function/const/return 之一
  for (const [k, st] of lv.stages.entries()) {
    if (isStr(st?.code) && !/\b(function|const|let|return|class)\b/.test(st.code)) {
      errs.push(`${tag} 的 stages[${k}].code 看起来不是完整代码（缺 function/const/return）`)
    }
  }

  if (!isStr(lv.finalCode)) errs.push(`${tag} 缺少 finalCode（整关做完的完整代码）`)
  if (!isStr(lv.usage)) errs.push(`${tag} 缺少 usage（这段代码怎么调用）`)

  // 拼起来的 tests 必须覆盖每个阶段的检查点，否则整关自检会漏掉某一步
  const allFromStages = lv.stages.reduce((n, st) => n + (String(st?.test ?? '').match(/\bcheck\s*\(/g) ?? []).length, 0)
  const allFromTests = (String(lv.tests ?? '').match(/\bcheck\s*\(/g) ?? []).length
  if (allFromTests < allFromStages) {
    errs.push(`${tag} 的 tests（${allFromTests} 个检查点）少于各 stage 相加（${allFromStages} 个）：整关自检会漏跑`)
  }
}
function validateTeaching(lv, i, errs) {
  const tag = `第 ${i + 1} 关`

  if (!isStr(lv.why)) errs.push(`${tag}缺少 why（为什么要有这个能力）`)

  if (!Array.isArray(lv.prereq) || lv.prereq.length < 1) {
    errs.push(`${tag}缺少前置知识 prereq（至少 1 条）`)
  } else {
    lv.prereq.forEach((r, k) => {
      if (!isStr(r?.title)) errs.push(`${tag} 的 prereq[${k}] 缺少 title`)
      // 60 字是底线：只写「Proxy 很好用」这种一句话，等于没讲
      if (!isStr(r?.md) || r.md.trim().length < 60) {
        errs.push(`${tag} 的 prereq[${k}] 讲解太短（≥60 字：是什么 / 为什么 / 怎么用，最好带代码块）`)
      }
    })
  }

  if (!Array.isArray(lv.api) || lv.api.length < 1) {
    errs.push(`${tag}缺少 API 契约 api（至少 1 条）`)
  } else {
    lv.api.forEach((a, k) => {
      for (const f of ['name', 'sig', 'args', 'returns', 'example']) {
        if (!isStr(a?.[f])) errs.push(`${tag} 的 api[${k}] 缺少 ${f}`)
      }
    })
  }

  // v3 关卡用 stages 取代「骨架里塞 TODO」，所以分步讲解与 TODO 对齐只对老关卡强制
  const staged = Array.isArray(lv.stages) && lv.stages.length >= 1
  if (!staged) {
    if (!Array.isArray(lv.steps) || lv.steps.length < 2) {
      errs.push(`${tag}缺少分步 steps（至少 2 步，每步只做一小件事）`)
    } else {
      lv.steps.forEach((s, k) => {
        if (!/^TODO\s+\d+$/.test(String(s?.todo ?? '').trim())) {
          errs.push(`${tag} 的 steps[${k}].todo 必须写成「TODO 1」这样的形式`)
        }
        if (!isStr(s?.title)) errs.push(`${tag} 的 steps[${k}] 缺少 title`)
        if (!isStr(s?.how)) errs.push(`${tag} 的 steps[${k}] 缺少 how（这一步具体怎么写）`)
      })
    }

    // 讲解与代码的硬对齐：骨架里出现的 TODO 编号集合，必须和分步讲解的集合完全一致
    const fromSkeleton = [...String(lv.skeleton ?? '').matchAll(/TODO\s+(\d+)/g)].map((m) => m[1])
    const fromSteps = (lv.steps ?? [])
      .map((s) => (String(s?.todo ?? '').match(/(\d+)/) ?? [])[1])
      .filter(Boolean)
    const a = [...new Set(fromSkeleton)].sort((x, y) => Number(x) - Number(y))
    const b = [...new Set(fromSteps)].sort((x, y) => Number(x) - Number(y))
    if (a.join(',') !== b.join(',')) {
      errs.push(`${tag} 骨架里的 TODO（${a.join(',') || '无'}）和分步讲解（${b.join(',') || '无'}）对不上`)
    }
  }
}

/** 关卡内容对象的结构校验：返回错误字符串数组，空数组表示通过 */
const PROJECT_DOMAINS = ['fe', 'be', 'cs', 'ai', 'eng']

export function validateProject(p) {
  const errs = []
  if (!p || typeof p !== 'object') return ['项目内容不是对象']
  if (!p.id) errs.push('缺少 id')
  if (!p.title) errs.push('缺少 title')
  // 领域决定项目落在「项目闯关」的哪一栏（前端 / 后端 / 公共基础 / AI）。写错等于分类丢失。
  if (!p.domain) errs.push('缺少 domain（fe / be / cs / ai / eng 之一）')
  else if (!PROJECT_DOMAINS.includes(p.domain)) errs.push(`domain 只能是 ${PROJECT_DOMAINS.join(' / ')}，收到 ${p.domain}`)
  if (!Array.isArray(p.levels) || p.levels.length === 0) return [...errs, 'levels 必须是非空数组']
  const v2 = Number(p.version ?? 1) >= 2
  const v3 = Number(p.version ?? 1) >= 3
  const seen = new Set()
  p.levels.forEach((lv, i) => {
    for (const f of LEVEL_FIELDS) if (!lv?.[f]) errs.push(`第 ${i + 1} 关缺少 ${f}`)
    if (lv?.id) {
      if (seen.has(lv.id)) errs.push(`关卡 id 重复：${lv.id}`)
      seen.add(lv.id)
    }
    if (lv?.tests && !/check\s*\(/.test(lv.tests)) errs.push(`第 ${i + 1} 关没有用 check() 注册任何用例`)
    if (lv?.xp != null && !(lv.xp > 0)) errs.push(`第 ${i + 1} 关 xp 必须为正数`)
    if (v2 && lv) {
      validateTeaching(lv, i, errs)
      const staged = Array.isArray(lv.stages) && lv.stages.length >= 1
      if (!Array.isArray(lv.hints) || lv.hints.length < 1) {
        if (!staged) errs.push(`第 ${i + 1} 关缺少 hints（卡住时的提示）`)
      }
    }
    /**
     * v3 项目：每一关都必须有 stages。
     *
     * 这条以前是「有 stages 才校验」，于是写了一半的内容（version 改成 3 但关卡还是
     * TODO 填空式）能悄悄通过构建——用户在界面上看到的仍是老流程，作者以为已经迁移完。
     * 现在把版本号当成承诺：声明 v3，就必须全关卡分步。
     */
    if (v3 && lv) validateStages(lv, i, errs)
  })
  return errs
}

/**
 * 分阶段跑一关：每阶段独立测试，一旦某一步没过就停在那里。
 *
 * 为什么一旦失败就停：后面的测试依赖前面的实现，必然连着红一片，刷屏对学习者没有信息量。
 * 停下的位置就是「你推进到第几步」，前端据此点亮进度条。
 */
export async function runStages(code, stageList, opts = {}) {
  const results = []
  const allCases = []
  const allLogs = []
  let error = null
  let ms = 0
  let stopped = false

  for (const st of stageList) {
    if (stopped) {
      results.push({ n: st.n, title: st.title, ok: false, cases: [], skipped: true })
      continue
    }
    const r = await runLevel(code, st.test, opts)
    ms += r.ms
    allCases.push(...r.cases)
    for (const l of r.logs) if (allLogs.length < MAX_LOGS) allLogs.push(l)
    if (r.error && !error) error = r.error
    results.push({ n: st.n, title: st.title, ok: r.ok, cases: r.cases })
    if (!r.ok) stopped = true
  }

  const failedAt = results.findIndex((r) => !r.ok)
  return {
    ok: failedAt < 0 && !error,
    stages: results,
    stageIndex: failedAt < 0 ? results.length : failedAt,
    cases: allCases,
    logs: allLogs,
    error,
    ms
  }
}

/**
 * 内容自检：逐关用参考解跑本关测试。
 *
 * 跨关回归只对「累积式」项目有意义（响应式内核那种：后一关的代码是前一关的超集），
 * 对「工具箱式」项目反而是误报——深拷贝、事件总线、柯里化三关各自独立，
 * 第 2 关的参考解没必要包含第 1 关的函数。项目可以用 `cumulative: false` 关掉这项检查。
 */
export async function dryRunProject(p) {
  const cumulative = p?.cumulative !== false
  const out = { id: p?.id, ok: true, levels: [] }
  if (Array.isArray(p?.levels)) {
    for (let i = 0; i < p.levels.length; i++) {
      const lv = p.levels[i]
      const own = await runLevel(lv.solution, lv.tests)
      const regress = []
      if (cumulative) {
        for (let j = 0; j < i; j++) {
          const prev = p.levels[j]
          // regress:false —— 这一关的测试是「本关专属脚手架」，不参与跨关回归。
          // 例：第 1 关的 __raw / __setCount 是让人确认拦截接上了的观察孔，
          // 后面的关卡没有这些孔不该算「破坏了前一关」。
          if (prev.regress === false) continue
          const r = await runLevel(lv.solution, prev.tests)
          if (!r.ok) regress.push({ level: prev.id, failed: r.cases.filter((c) => !c.ok).map((c) => c.name), error: r.error?.message })
        }
      }
      const row = {
        id: lv.id, title: lv.title,
        own: { ok: own.ok, passed: own.cases.filter((c) => c.ok).length, total: own.cases.length, failed: own.cases.filter((c) => !c.ok), error: own.error?.message },
        regress
      }

      // v3 阶段自检：每一步的「完整代码」必须能过这一步的测试；
      // 同时看它是否直接过了下一步（能过说明两步其实是一件事，该合并或该拆）。
      if (Array.isArray(lv.stages) && lv.stages.length) {
        row.stages = []
        for (let k = 0; k < lv.stages.length; k++) {
          const st = lv.stages[k]
          const r = await runLevel(st.code, st.test, { timeoutMs: 4000 })
          const next = lv.stages[k + 1]
          const ahead = next ? await runLevel(st.code, next.test, { timeoutMs: 4000 }) : null
          const srow = {
            n: st.n, title: st.title,
            ok: r.ok,
            passed: r.cases.filter((c) => c.ok).length,
            total: r.cases.length,
            failed: r.cases.filter((c) => !c.ok).map((c) => c.name),
            error: r.error?.message,
            nextAheadOk: ahead ? ahead.ok : null
          }
          if (!srow.ok) out.ok = false
          row.stages.push(srow)
        }
        const fin = await runLevel(lv.finalCode, lv.tests, { timeoutMs: 4000 })
        row.final = { ok: fin.ok, passed: fin.cases.filter((c) => c.ok).length, total: fin.cases.length, failed: fin.cases.filter((c) => !c.ok).map((c) => c.name), error: fin.error?.message }
        if (!row.final.ok) out.ok = false
      }

      if (!own.ok || regress.length) out.ok = false
      out.levels.push(row)
    }
  }
  return out
}