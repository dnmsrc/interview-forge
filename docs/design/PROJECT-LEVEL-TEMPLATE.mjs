/**
 * ★ 关卡内容模板：照着这个文件的结构写你的项目。
 *
 * 这个文件本身是一个「2 关项目」的完整例子（第 2 关只写字段名，结构同第 1 关）。
 * 它演示了 v3 分步制里最容易写错的四件事：
 *   1) 每步 code 是「这一步完成后的完整代码」，不是 diff 片段；
 *   2) 每步 test 只测这一步的新能力，所以下一步的测试必须还过不了；
 *   3) tests 是各步 test 的拼接（整关测试）；
 *   4) skeleton 语法合法但必然跑红。
 *
 * 跑在校验沙箱里的限制：没有 setTimeout / require / fetch，只能纯函数 + 注入时钟，
 * 所以这里的 debounce 用 `tick(now)` 手动推进时间——真实 setTimeout 由调用方负责。
 *
 * 用法：复制这个文件到 content/projects-src/<slug>.mjs，把 id/title/nodes 换掉，
 * 按 data/plans/<slug>.json 的分配逐关扩展，然后 `node scripts/project-build.mjs --only=<slug>`。
 */

/* ============================================================ 第 1 关测试 */
const L1S1 = `{
  check('call 之后还没到期，tick 不执行', () => {
    const fn = (...a) => { calls.push(a) }
    const calls = []
    const d = createDebounce(fn, 100)
    d.call('a', 0)
    same(d.tick(99), false)
    same(calls.length, 0, '99 < 100，不该执行')
  })
  check('到期后 tick 执行一次，参数对得上', () => {
    const calls = []
    const d = createDebounce((x) => calls.push(x), 100)
    d.call('a', 0)
    same(d.tick(100), true)
    same(calls, ['a'])
  })
  check('执行完就清空，再 tick 不会重复执行', () => {
    const calls = []
    const d = createDebounce((x) => calls.push(x), 100)
    d.call('a', 0)
    d.tick(100)
    same(d.tick(200), false)
    same(calls.length, 1)
  })
  check('没有任何 call 时 tick 返回 false', () => {
    const d = createDebounce(() => {}, 10)
    same(d.tick(999), false)
  })
}`

const L1S2 = `{
  check('等待期内的新调用会重置到期时间（真正的 debounce）', () => {
    const calls = []
    const d = createDebounce((x) => calls.push(x), 100)
    d.call('a', 0)
    d.call('b', 50)          // 立刻重置：due 从 100 变成 150
    same(d.tick(100), false, '旧计时器必须被取消')
    same(d.tick(149), false)
    same(d.tick(150), true)
    same(calls, ['b'], '只执行最后一次调用的参数')
  })
  check('连续快速调用只算一次执行', () => {
    const calls = []
    const d = createDebounce((x) => calls.push(x), 50)
    for (let i = 0; i < 5; i++) d.call(i, i * 10)   // 最后一次 at 40，due 90
    same(d.tick(89), false)
    same(d.tick(90), true)
    same(calls, [4])
  })
  check('两次执行之间互不影响', () => {
    const calls = []
    const d = createDebounce((x) => calls.push(x), 10)
    d.call('first', 0); d.tick(10)
    d.call('second', 100); d.tick(110)
    same(calls, ['first', 'second'])
  })
}`

const L1S3 = `{
  check('cancel 之后待执行的调用不会再触发', () => {
    const calls = []
    const d = createDebounce((x) => calls.push(x), 100)
    d.call('a', 0)
    d.cancel()
    same(d.tick(200), false)
    same(calls, [])
  })
  check('flush 可以立刻执行待执行的调用（不等到期）', () => {
    const calls = []
    const d = createDebounce((x) => calls.push(x), 1000)
    d.call('now', 0)
    same(d.flush(), true)
    same(calls, ['now'])
    same(d.tick(2000), false, 'flush 之后不应再执行第二次')
  })
  check('没有待执行项时 flush 返回 false', () => {
    const d = createDebounce(() => {}, 100)
    same(d.flush(), false)
  })
}`

/* ============================================================ 第 1 关 */
const LV1 = {
  id: 'lv1',
  title: '手写 debounce：最后说话的人赢',
  emoji: '⏳',
  xp: 40,
  goal: '实现 createDebounce(fn, wait)：调用 call(args, now) 登记一次调用，tick(now) 在静默 wait 后执行 fn(args)；支持 cancel 与 flush。',
  why: '搜索框输入、窗口 resize、滚动加载这些场景里，每一次事件都触发请求会打爆后端。debounce 的语义只有一句话：连续调用只认最后一次，静默 wait 之后才执行——但它有三个容易漏的边界：等待期内的新调用必须重置计时器、cancel 之后不能有幽灵执行、flush 要能强制兑现。',
  nodes: ['fe.js.async', 'fe.js.async.promise', 'fe.js.scope.hoisting'],
  thinking: [
    {
      title: '先想清楚「时间归谁管」',
      md: '浏览器里 debounce 靠 `setTimeout` + `clearTimeout`；判题沙箱没有定时器，所以这里把时间交给调用方：`tick(now)` 推进虚拟时钟。\n\n这不是为了测试而扭曲实现——它恰好把 debounce 的核心抽出来了：**「到期时间」只是一个数字，「重置」就是覆盖这个数字**。真实实现里的 `clearTimeout(timer)` 在这里等价于把 pending 的 due 改掉。'
    },
    {
      title: '为什么第 1 步故意不重置',
      md: '第 1 步只做「登记 + 到期执行」，等待期内的新调用只更新参数、不更新到期时间。这是错的 debounce（更像「首次调用后固定窗口」），但正是这样，第 2 步的「重置」测试才有东西可证明：它会在 `tick(100)` 直接返回 true，暴露出「旧计时器没被取消」。\n\n**分步的意义就是让错误先发生一次**：你先看到行为不对，再理解为什么要重置。'
    }
  ],
  prereq: [
    {
      title: '闭包 + 调用方注入时钟',
      md: 'debounce 的状态（待执行参数、到期时间）必须活在两次调用之间，这正是闭包的用途：\n\n```js\nfunction makeTimer() {\n  let due = null            // 闭包里的私有状态\n  return {\n    set(t) { due = t },\n    get() { return due }\n  }\n}\n```\n\n本关的 `now` 由调用方传入（`call(args, now)`、`tick(now)`），实现不读 `Date.now()`——这样测试可以精确制造「99ms 未到期 / 100ms 到期」这种边界。'
    },
    {
      title: '「最后一次生效」是语义，不是优化',
      md: 'debounce 不是「攒着所有参数批量执行」，而是**只执行最后一次**：用户停了才发请求，中间打的字都不算。\n\n所以参数只保留最后一份（覆盖即可），而不是 push 进数组。第 2 步的测试会检查 `calls` 里只有 `["b"]` 而不是 `["a", "b"]`。'
    }
  ],
  api: [
    {
      name: 'createDebounce',
      sig: 'createDebounce(fn: Function, wait: number) => { call(args, now), tick(now), cancel(), flush() }',
      args: 'fn 是到期要执行的函数；wait 是静默毫秒数；call 的 args 是透传给 fn 的参数（单值）；now 是调用方提供的虚拟时间戳。',
      returns: 'call：无返回值。tick(now)：到期待执行项被触发时返回 true，否则 false。flush()：有 pending 时立即执行并返回 true。cancel()：清空 pending。',
      example: 'const calls = []\nconst d = createDebounce((x) => calls.push(x), 100)\nd.call(\'a\', 0)\nd.call(\'b\', 50)      // 重置，due = 150\nd.tick(100)          // false\nd.tick(150)          // true，calls = [\'b\']'
    }
  ],
  usage: 'const send = createDebounce((kw) => fetchSuggestions(kw), 300)\ninput.addEventListener(\'input\', () => send.call(input.value, performance.now()))\n// 一个每 16ms 的渲染循环里推进：\nfunction frame() { send.tick(performance.now()); requestAnimationFrame(frame) }',
  hints: [
    '第 1 步只需要一个 pending 变量（存 args 和 due），call 覆盖它，tick 比较 now 与 due。',
    '第 2 步的关键是：每次 call 都把 due 重新算成 now + wait，不管之前有没有 pending。',
    '第 3 步 cancel = pending 置空；flush = 有 pending 就立刻执行并清空（注意别让它再被 tick 执行第二次）。'
  ],
  concepts: [
    {
      title: 'debounce vs throttle',
      md: 'debounce 等「静默」，throttle 保「节奏」：前者在连续事件停下来之后才执行一次，后者保证每 wait 内最多执行一次（首次通常立即执行）。搜索联想用 debounce，滚动进度条用 throttle。第 2 关会写 throttle，正好对照。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '先能登记和到期执行',
      think: '先让最朴素的「登记一次调用、到点执行」跑通。这一步刻意不处理等待期内的新调用——那是第 2 步的事，先让错误暴露出来。',
      hint: 'pending 存 { args, due }；call 直接覆盖 pending；tick 在 now >= due 时执行并清空。',
      code: `function createDebounce(fn, wait) {
  let pending = null

  return {
    call(args, now) {
      // 第 1 步：首次调用决定到期时间；后续调用只更新参数、不重置计时
      if (pending) pending.args = args
      else pending = { args, due: now + wait }
    },
    tick(now) {
      if (!pending || now < pending.due) return false
      const { args } = pending
      pending = null
      fn(args)
      return true
    }
  }
}`,
      test: L1S1,
      diag: [
        'tick 里少了 now < due 的判断，或者 due 算错了（应该是 now + wait）。',
        '执行完没有把 pending 置空，导致下一次 tick 又执行一遍。',
        'pending 置空后仍返回 true——检查 return 的位置。',
        '没有 pending 时直接读了 pending.due，抛错或行为不对；先判断 !pending。'
      ]
    },
    {
      n: 2,
      title: '等待期内的新调用要重置计时',
      think: '用户打了第二个字，第一次的计时必须作废——这就是 debounce 与「固定窗口」的分界。实现上只是把 due 重新算一遍，但需要保证旧计时不会同时生效。',
      hint: '每次 call 都无条件 pending = { args, due: now + wait }，不需要判断有没有旧 pending。',
      code: `function createDebounce(fn, wait) {
  let pending = null

  return {
    call(args, now) {
      pending = { args, due: now + wait }
    },
    tick(now) {
      if (!pending || now < pending.due) return false
      const { args } = pending
      pending = null
      fn(args)
      return true
    }
  }
}`,
      test: L1S2,
      diag: [
        'call 只在 pending 为空时设置计时器，第二次调用没有重置 due。',
        '重置之后仍然执行了第一次的参数（应该只保留最后一次 args）。',
        '循环调用里 due 只加了一次 wait，应该每次 call 都 now + wait。'
      ]
    },
    {
      n: 3,
      title: '补上 cancel 与 flush',
      think: '组件卸载要取消待执行的回调（否则对已销毁的 DOM 发请求），而某些场景（点提交按钮）要立刻兑现当前输入。两个都是 debounce 的常用接口，也是面试追问点。',
      hint: 'cancel 直接 pending = null；flush 判断有 pending 就取出执行、清空、返回 true，没有则返回 false。',
      code: `function createDebounce(fn, wait) {
  let pending = null

  return {
    call(args, now) {
      pending = { args, due: now + wait }
    },
    tick(now) {
      if (!pending || now < pending.due) return false
      const { args } = pending
      pending = null
      fn(args)
      return true
    },
    cancel() {
      pending = null
    },
    flush() {
      if (!pending) return false
      const { args } = pending
      pending = null
      fn(args)
      return true
    }
  }
}`,
      test: L1S3,
      diag: [
        'cancel 只清了 due 没清 args（或者根本没清 pending）。',
        'flush 执行完没有清空 pending，随后 tick 又执行一次。',
        'flush 在 pending 为空时没有返回 false，或者读 pending.args 抛错。'
      ]
    }
  ],
  skeleton: `function createDebounce(fn, wait) {
  // TODO: 用闭包保存待执行的调用（参数 + 到期时间），提供 call / tick / cancel / flush
  throw new Error('createDebounce 还没实现')
}`,
  solution: `function createDebounce(fn, wait) {
  let pending = null

  return {
    call(args, now) {
      pending = { args, due: now + wait }
    },
    tick(now) {
      if (!pending || now < pending.due) return false
      const { args } = pending
      pending = null
      fn(args)
      return true
    },
    cancel() {
      pending = null
    },
    flush() {
      if (!pending) return false
      const { args } = pending
      pending = null
      fn(args)
      return true
    }
  }
}`,
  finalCode: `function createDebounce(fn, wait) {
  let pending = null

  return {
    call(args, now) {
      pending = { args, due: now + wait }
    },
    tick(now) {
      if (!pending || now < pending.due) return false
      const { args } = pending
      pending = null
      fn(args)
      return true
    },
    cancel() {
      pending = null
    },
    flush() {
      if (!pending) return false
      const { args } = pending
      pending = null
      fn(args)
      return true
    }
  }
}`,
  tests: `${L1S1}\n${L1S2}\n${L1S3}`
}

/* ============================================================ 第 2 关（只留结构示意，写法同第 1 关） */
// const L2S1 = `{ …至少 4 个 check… }`
// const L2 = {
//   id: 'lv2', title: '…', emoji: '…', xp: 50,
//   goal: '…', why: '…',
//   nodes: [ /* 照 data/plans/<slug>.json 的下一行原样抄 */ ],
//   thinking: [...], prereq: [...], api: [...],
//   usage: '…', hints: [...], concepts: [...],
//   stages: [ { n: 1, title, think, hint, code, test: L2S1, diag: [...] }, … ],
//   skeleton: `…`, solution: `…`, finalCode: `…`,
//   tests: `${L2S1}`
// }

export default {
  id: '_template-2lv',
  version: 3,
  domain: 'fe',
  cumulative: false,
  title: '模板 · 手写 debounce 与 throttle',
  emoji: '📐',
  tagline: '2 关：debounce（静默后执行）与 throttle（固定节奏）的闭包实现。',
  stack: ['JavaScript', '异步与事件'],
  intro: '这个文件是内容模板，不是正式项目。它演示了 v3 分步制关卡该怎么写：每步的完整代码、只测本步的测试、整关测试的拼接、骨架与最终解的关系，以及 nodes 覆盖映射。',
  outcome: '照着这个结构扩展，你能写出「每步都能自己跑绿、下一步还过不了」的闯关内容。',
  levels: [LV1]
}