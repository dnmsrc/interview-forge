/**
 * fe-perf · 前端性能与类型系统三关
 * lv1 性能指标与测量定位 / lv2 大数据量渲染 / lv3 TypeScript 类型系统与类型体操
 *
 * 判题沙箱只有 check / same / ok / throws / notSame + console：
 * 没有 performance、没有 PerformanceObserver、没有 setTimeout，也没有 TypeScript 编译器。
 * 所以这里的实现是「纯函数化的数据层」：时间戳、滚动位置、任务预算、资源清单全部由参数传入，
 * 浏览器里只是把这些数据换成真实观测值再喂进来。
 */

/* ============================================================ 第 1 关测试 */
const L1S1 = `{
  check('没有任何内容绘制时 LCP 返回空而不是零', () => {
    same(computeLCP([]), null)
  })
  check('多条候选里取尺寸最大的那条，与出现先后无关', () => {
    const r = computeLCP([
      { type: 'text', size: 300, startTime: 100 },
      { type: 'image', size: 1200, startTime: 900 },
      { type: 'text', size: 700, startTime: 400 }
    ])
    same(r.size, 1200)
    same(r.startTime, 900)
    same(r.type, 'image')
  })
  check('尺寸并列时保留更早绘制的那条作为 LCP', () => {
    const r = computeLCP([
      { type: 'image', size: 900, startTime: 640 },
      { type: 'text', size: 900, startTime: 210 }
    ])
    same(r.startTime, 210)
    same(r.type, 'text')
  })
  check('同一会话窗口内连续位移累加成一个分数', () => {
    const r = computeCLS([
      { start: 100, end: 140, value: 0.05 },
      { start: 200, end: 240, value: 0.03 },
      { start: 300, end: 350, value: 0.02 }
    ])
    same(r.windowCount, 1)
    same(r.cls, 0.1)
  })
  check('间隔超过五百毫秒另开窗口，只取最大窗口并忽略带输入的位移', () => {
    const r = computeCLS([
      { start: 0, end: 100, value: 0.04 },
      { start: 900, end: 1000, value: 0.12 },
      { start: 1100, end: 1200, value: 0.2, hadInput: true }
    ])
    same(r.windowCount, 2)
    same(r.cls, 0.12)
  })
}`

const L1S2 = `{
  check('没有任何交互时 INP 与 P75 都是零', () => {
    const r = computeINP([])
    same(r.inp, 0)
    same(r.p75, 0)
  })
  check('INP 取最差交互的耗时并同时给出 P75', () => {
    const r = computeINP([
      { id: 'c1', duration: 120 },
      { id: 'c2', duration: 340 },
      { id: 'c3', duration: 80 },
      { id: 'c4', duration: 200 }
    ])
    same(r.inp, 340)
    same(r.p75, 200)
  })
  check('最近秩法分位数在两端取到最小与最大值', () => {
    const values = [80, 120, 200, 340]
    same(percentile(values, 0), 80)
    same(percentile(values, 100), 340)
  })
  check('中间分位数按最近秩落到排序后的对应位置', () => {
    same(percentile([80, 120, 200, 340], 50), 120)
    same(percentile([5, 1, 9], 75), 9)
  })
  check('分位数对空数组返回空，直方图末桶接住超出上界的值', () => {
    same(percentile([], 50), null)
    same(histogram([40, 100, 250, 800], [100, 300]), [2, 1, 1])
  })
}`

const L1S3 = `{
  check('TBT 只累加每个任务超过五十毫秒的部分', () => {
    same(computeTBT([
      { start: 0, duration: 120 },
      { start: 200, duration: 40 },
      { start: 400, duration: 210 }
    ]), 230)
  })
  check('全部是短任务时 TBT 为零', () => {
    same(computeTBT([{ start: 0, duration: 50 }, { start: 100, duration: 30 }]), 0)
  })
  check('关键路径取阻塞资源链最深的那条并累加链上字节', () => {
    const r = criticalPath([
      { url: 'app.css', blocking: true, sizeBytes: 20, deps: [] },
      { url: 'theme.css', blocking: true, sizeBytes: 10, deps: ['app.css'] },
      { url: 'hero.js', blocking: true, sizeBytes: 60, deps: ['theme.css'] },
      { url: 'font.woff2', blocking: false, sizeBytes: 90, deps: ['theme.css'] }
    ])
    same(r.depth, 3)
    same(r.bytes, 90)
    same(r.chain, ['app.css', 'theme.css', 'hero.js'])
  })
  check('全部是非阻塞资源时关键路径为空', () => {
    const r = criticalPath([{ url: 'x.js', blocking: false, sizeBytes: 500, deps: [] }])
    same(r.depth, 0)
    same(r.bytes, 0)
    same(r.chain, [])
  })
  check('资源提示按首屏与阻塞性分桶，跨域来源去重', () => {
    const r = matchResourceHints([
      { url: 'https://cdn.x.com/app.js', blocking: true, inViewport: true, crossOrigin: true },
      { url: 'https://cdn.x.com/vendor.js', blocking: true, inViewport: true, crossOrigin: true },
      { url: 'https://cdn.x.com/lazy.js', blocking: false, inViewport: false, crossOrigin: true },
      { url: '/local.css', blocking: true, inViewport: false }
    ])
    same(r.preload, ['https://cdn.x.com/app.js', 'https://cdn.x.com/vendor.js', '/local.css'])
    same(r.prefetch, ['https://cdn.x.com/lazy.js'])
    same(r.preconnect, ['https://cdn.x.com'])
  })
}`

/* ============================================================ 第 1 关实现（最终形态） */
const L1_FINAL = `function computeLCP(entries) {
  let best = null
  for (const e of entries) {
    if (!best) { best = e; continue }
    if (e.size > best.size) best = e
    else if (e.size === best.size && e.startTime < best.startTime) best = e
  }
  if (!best) return null
  return { size: best.size, startTime: best.startTime, type: best.type }
}

function computeCLS(shifts) {
  const list = shifts
    .filter((s) => s.hadInput !== true)
    .slice()
    .sort((a, b) => a.start - b.start)
  let best = 0
  let windows = 0
  let sum = 0
  let firstStart = 0
  let prevEnd = 0
  for (const s of list) {
    const gap = s.start - prevEnd
    const fresh = windows === 0 || gap > 500 || s.start - firstStart > 5000
    if (fresh) {
      if (windows > 0 && sum > best) best = sum
      windows++
      sum = 0
      firstStart = s.start
    }
    sum += s.value
    prevEnd = typeof s.end === 'number' ? s.end : s.start
  }
  if (windows > 0 && sum > best) best = sum
  return { cls: Math.round(best * 10000) / 10000, windowCount: windows }
}

function percentile(values, p) {
  if (values.length === 0) return null
  const sorted = values.slice().sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))]
}

function histogram(values, bounds) {
  const counts = []
  for (let i = 0; i < bounds.length + 1; i++) counts.push(0)
  for (const v of values) {
    let i = 0
    while (i < bounds.length && v > bounds[i]) i++
    counts[i]++
  }
  return counts
}

function computeINP(interactions) {
  if (interactions.length === 0) return { inp: 0, p75: 0 }
  let worst = interactions[0]
  for (const it of interactions) {
    if (it.duration > worst.duration) worst = it
  }
  const p75 = percentile(interactions.map((it) => it.duration), 75)
  return { inp: worst.duration, p75 }
}

function computeTBT(tasks) {
  let total = 0
  for (const t of tasks) {
    const over = t.duration - 50
    if (over > 0) total += over
  }
  return Math.round(total * 100) / 100
}

function criticalPath(resources) {
  const byUrl = {}
  for (const r of resources) byUrl[r.url] = r
  const memo = {}
  const walk = (url) => {
    if (memo[url]) return memo[url]
    const r = byUrl[url]
    if (!r || r.blocking !== true) return { depth: 0, bytes: 0, chain: [] }
    memo[url] = { depth: 1, bytes: r.sizeBytes, chain: [url] }
    let best = { depth: 0, bytes: 0, chain: [] }
    for (const dep of r.deps || []) {
      const sub = walk(dep)
      if (sub.depth > best.depth || (sub.depth === best.depth && sub.bytes > best.bytes)) best = sub
    }
    const cur = { depth: best.depth + 1, bytes: best.bytes + r.sizeBytes, chain: best.chain.concat([url]) }
    memo[url] = cur
    return cur
  }
  let best = { depth: 0, bytes: 0, chain: [] }
  for (const r of resources) {
    if (r.blocking !== true) continue
    const c = walk(r.url)
    if (c.depth > best.depth || (c.depth === best.depth && c.bytes > best.bytes)) best = c
  }
  return best
}

function matchResourceHints(resources) {
  const out = { preload: [], prefetch: [], preconnect: [] }
  const seen = []
  for (const r of resources) {
    if (r.inViewport === true || r.blocking === true) out.preload.push(r.url)
    else out.prefetch.push(r.url)
    if (r.crossOrigin === true) {
      const origin = r.url.split('/').slice(0, 3).join('/')
      if (seen.indexOf(origin) < 0) {
        seen.push(origin)
        out.preconnect.push(origin)
      }
    }
  }
  return out
}`

/* ============================================================ 第 1 关 */
const LV1 = {
  id: 'lv1',
  title: '性能指标与测量定位：把体感翻译成数字',
  emoji: '📊',
  xp: 40,
  goal: '实现一组纯函数：用内容绘制候选算 LCP，用位移记录算 CLS，用交互耗时算 INP 与 P75，用采样算直方图，用长任务算 TBT，再判定关键渲染路径与资源提示该给谁。',
  why: '性能优化最怕两件事：没有数字，和数字对不上体感。面试里问「首屏慢」，答「图片大」是感受，答「LCP 取的是尺寸最大的那条绘制、它在 2.4 秒，其中 1.1 秒被一条三层的阻塞 CSS 链占住」才是定位。这一关就是把定位过程拆成可验证的纯函数：每个函数只回答一个问题，答完拼起来才是完整归因。',
  nodes: [
    'fe.perf.metrics',
    'fe.perf.metrics.core',
    'fe.perf.metrics.profiling',
    'fe.perf.loading',
    'fe.perf.loading.critical-path',
    'fe.perf.loading.resource-hint'
  ],
  thinking: [
    {
      title: '指标不是「取个最大值」，而是先定窗口再定聚合',
      md: '三个核心指标的聚合口径完全不同：\n\n- `LCP` 是**单点**——从候选条目里挑一条（尺寸最大，并列取更早），不是求和也不是平均。\n- `CLS` 是**窗口聚合**——把位移按会话窗口分组（间隔超过 500ms 或单窗超过 5s 就断开），取最大的那个窗口，因为用户记住的是最跳的那一下。\n- `INP` 是**尾部**——浏览器报 P75 而不是平均值，因为平均值会掩盖住那 25% 卡到骂人的交互。\n\n先回答「在哪个窗口里、按什么规则聚合」，代码几乎自己就写出来了。'
    },
    {
      title: '为什么定位要拆成 TBT、关键路径、资源提示三层',
      md: '三者回答的是不同层级的问题：\n\n1. `TBT` 回答**主线程被谁占住**：长任务里超过 50ms 的部分才是阻塞，短任务串起来并不产生 TBT。\n2. 关键渲染路径回答**为什么首屏要等**：阻塞资源的依赖链每深一层就多一次往返，链上字节数决定下载时间。\n3. 资源提示回答**还能不能提前**：首屏与阻塞资源给 `preload`，其余给 `prefetch`，跨域域名给 `preconnect`。\n\n真实浏览器里这三层分别来自 Long Tasks API、Resource Timing 和人工配置；这里用参数传入同样的数据。'
    }
  ],
  prereq: [
    {
      title: '先分清「观测值」和「计算值」',
      md: '`PerformanceObserver` 给你的只是**原始条目**：一条内容绘制有 `startTime` 和 `size`，一次位移有 `value` 和 `hadInput`，一个长任务有 `duration`。指标是**计算值**，必须由你自己聚合。\n\n这解释了为什么同一个页面的 LCP 在实验室和真实用户手里差很远：实验室只有一次冷启动观测，真实用户是成千上万条采样取 P75。写代码时把「输入是条目数组、输出是标量」这条边界守住，指标层就能单独测。'
    },
    {
      title: '浮点求和要收口，否则断言会莫名其妙红',
      md: '`0.05 + 0.03 + 0.02` 在双精度里不是精确的 `0.1`，而是 `0.10000000000000001`。直接 `same(cls, 0.1)` 会失败，而且看起来像逻辑错误。\n\n工业做法是统一换算成整数单位（比如万分之一）再除回去：`Math.round(sum * 10000) / 10000`。本关的 CLS 与 TBT 都做了这个收口，你写自己的实现时也要做。'
    }
  ],
  api: [
    {
      name: 'computeLCP',
      sig: 'computeLCP(entries) => { size, startTime, type } | null',
      args: 'entries 是内容绘制候选数组，每条含 type（text 或 image）、size（像素面积）、startTime（毫秒）。',
      returns: 'size 最大的那条的摘要；尺寸并列时取 startTime 更早的一条；空数组返回 null。',
      example: `computeLCP([
  { type: 'text', size: 300, startTime: 100 },
  { type: 'image', size: 1200, startTime: 900 }
])
// => { size: 1200, startTime: 900, type: 'image' }`
    },
    {
      name: 'computeCLS',
      sig: 'computeCLS(shifts) => { cls, windowCount }',
      args: 'shifts 是位移记录数组，每条含 start、end、value（0~1 的位移分数），可选 hadInput 表示该次位移紧跟用户输入。',
      returns: 'cls 是最大会话窗口的分数和（保留四位），windowCount 是窗口数量；带 hadInput 的记录整体不计分。',
      example: `computeCLS([
  { start: 0, end: 100, value: 0.04 },
  { start: 900, end: 1000, value: 0.12 }
])
// => { cls: 0.12, windowCount: 2 }`
    },
    {
      name: 'computeINP / percentile',
      sig: 'computeINP(interactions) => { inp, p75 }；percentile(values, p) => number | null',
      args: 'interactions 每条含 id 与 duration（毫秒）；percentile 的 values 是数值数组，p 是 0~100 的百分位。',
      returns: 'inp 取最差一次交互的 duration，p75 用最近秩法（ceil(p/100*n)-1）在排序后取值；空输入时 inp 与 p75 都是 0，percentile 返回 null。',
      example: `computeINP([{ id: 'c1', duration: 120 }, { id: 'c2', duration: 340 }])
// => { inp: 340, p75: 340 }
percentile([80, 120, 200, 340], 50)
// => 120`
    }
  ],
  usage: 'const lcp = computeLCP(entries)\nconst cls = computeCLS(shifts)\nconst inp = computeINP(interactions)\n// 上报时把窗口口径一起带上，否则后端无法复算：\nreport({ lcp: lcp.startTime, cls: cls.cls, inp: inp.p75, windows: cls.windowCount })\n// 再把 TBT 与关键路径链拼进同一条诊断记录：\nreport({ tbt: computeTBT(longTasks), slowChain: criticalPath(resources).chain })',
  hints: [
    '第 1 步：LCP 是一个「扫描并替换最优」的循环，比较键是 size，并列时用 startTime 打破平局；CLS 先过滤 hadInput 再排序，然后维护一个当前窗口的 sum 与 firstStart。',
    '第 2 步：percentile 的排名公式是 ceil(p/100 * n) - 1，再用 Math.max(0, ...) 与 n-1 夹住两端；histogram 用 while 找到第一个 v <= bounds[i] 的桶。',
    '第 3 步：TBT 就是 Σ max(0, duration - 50)；criticalPath 用带记忆化的 DFS，只对 blocking === true 的资源开链，防环靠先写入 memo 再覆盖。'
  ],
  concepts: [
    {
      title: '实验室指标与现场指标的差别',
      md: 'Lighthouse 给的是「一次冷启动 + 模拟网络」的实验室数字，适合回归对比；真实用户监控（RUM）给的是分布，适合看尾部。面试里被问「你们 LCP 多少」，专业回答要带口径：设备、网络、样本量、P75 还是中位数。同一个页面 P75 可能是中位数的两倍。'
    },
    {
      title: '为什么 INP 用 P75 而不是平均值',
      md: '交互耗时是长尾分布：绝大多数交互在 100ms 内，偶尔一次 1.2s。平均值会被长尾拉高但又被大量快交互稀释，看着「还行」；P75 直接告诉你「每四次交互就有一次超过这个数」。阈值 200ms 就是按 P75 定的——这就是为什么优化尾部比优化均值有用。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '先算出 LCP 与 CLS',
      think: 'LCP 的关键是「挑一条」而不是「算一个平均」，所以先把比较规则定死：尺寸优先，并列看谁更早。CLS 的关键是「先分窗再取最大」，顺序反了就会得到全页求和这种吓人的错数。',
      hint: 'LCP 用一个 best 变量滚动替换；CLS 先 filter 掉 hadInput，再 sort 按 start，然后逐条判断是否开新窗。',
      code: `function computeLCP(entries) {
  let best = null
  for (const e of entries) {
    if (!best) { best = e; continue }
    if (e.size > best.size) best = e
    else if (e.size === best.size && e.startTime < best.startTime) best = e
  }
  if (!best) return null
  return { size: best.size, startTime: best.startTime, type: best.type }
}

function computeCLS(shifts) {
  const list = shifts
    .filter((s) => s.hadInput !== true)
    .slice()
    .sort((a, b) => a.start - b.start)
  let best = 0
  let windows = 0
  let sum = 0
  let firstStart = 0
  let prevEnd = 0
  for (const s of list) {
    const gap = s.start - prevEnd
    const fresh = windows === 0 || gap > 500 || s.start - firstStart > 5000
    if (fresh) {
      if (windows > 0 && sum > best) best = sum
      windows++
      sum = 0
      firstStart = s.start
    }
    sum += s.value
    prevEnd = typeof s.end === 'number' ? s.end : s.start
  }
  if (windows > 0 && sum > best) best = sum
  return { cls: Math.round(best * 10000) / 10000, windowCount: windows }
}`,
      test: L1S1,
      diag: [
        'LCP 用了「最后一条」而不是「尺寸最大的一条」——检查比较键是不是 size。',
        '尺寸并列时没有比较 startTime，保留了后出现的那条，导致并列用例失败。',
        'CLS 忘了过滤 hadInput，带输入的位移被计入分数。',
        '开新窗的条件写成了 start 间隔，而应该用 start 与上一条 end 的间隔；另外单窗超过 5000ms 也要断开。',
        '窗口切换时没有把上一个窗口的 sum 结算进 best，只保留了最后一个窗口。'
      ]
    },
    {
      n: 2,
      title: 'INP、分位数与直方图',
      think: 'INP 本身只是「最差的一次」，但真实上报要 P75，所以顺手把分位数做出来。直方图则回答「分布长什么样」——只看 P75 你不知道另一半是 50ms 还是 500ms。',
      hint: '最近秩法：排序后取索引 ceil(p/100*n)-1，再夹到 [0, n-1]；直方图循环里用 while 找到第一个 v <= bounds[i]。',
      code: `function computeLCP(entries) {
  let best = null
  for (const e of entries) {
    if (!best) { best = e; continue }
    if (e.size > best.size) best = e
    else if (e.size === best.size && e.startTime < best.startTime) best = e
  }
  if (!best) return null
  return { size: best.size, startTime: best.startTime, type: best.type }
}

function computeCLS(shifts) {
  const list = shifts
    .filter((s) => s.hadInput !== true)
    .slice()
    .sort((a, b) => a.start - b.start)
  let best = 0
  let windows = 0
  let sum = 0
  let firstStart = 0
  let prevEnd = 0
  for (const s of list) {
    const gap = s.start - prevEnd
    const fresh = windows === 0 || gap > 500 || s.start - firstStart > 5000
    if (fresh) {
      if (windows > 0 && sum > best) best = sum
      windows++
      sum = 0
      firstStart = s.start
    }
    sum += s.value
    prevEnd = typeof s.end === 'number' ? s.end : s.start
  }
  if (windows > 0 && sum > best) best = sum
  return { cls: Math.round(best * 10000) / 10000, windowCount: windows }
}

function percentile(values, p) {
  if (values.length === 0) return null
  const sorted = values.slice().sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))]
}

function histogram(values, bounds) {
  const counts = []
  for (let i = 0; i < bounds.length + 1; i++) counts.push(0)
  for (const v of values) {
    let i = 0
    while (i < bounds.length && v > bounds[i]) i++
    counts[i]++
  }
  return counts
}

function computeINP(interactions) {
  if (interactions.length === 0) return { inp: 0, p75: 0 }
  let worst = interactions[0]
  for (const it of interactions) {
    if (it.duration > worst.duration) worst = it
  }
  const p75 = percentile(interactions.map((it) => it.duration), 75)
  return { inp: worst.duration, p75 }
}`,
      test: L1S2,
      diag: [
        'INP 空数组时没有提前返回，percentile 拿到空数组返回 null，p75 变成了 null。',
        'INP 的 p75 传成了「最差的那条」而不是对全部 duration 求分位数。',
        '分位数公式用了 floor 或没减 1，p=100 时会越界成 undefined。',
        'p=0 时排名算出 -1，没有用 Math.max 夹住下界，取到了 undefined。',
        '直方图桶数少算了一个，超出最后一个上界的值没有落进末桶；边界值等于上界时应留在当前桶。'
      ]
    },
    {
      n: 3,
      title: '长任务归因、关键路径与资源提示',
      think: '前两步是「测到了多少」，这一步是「慢在哪里」。TBT 把长任务削成阻塞量，关键路径顺着依赖链找最重的一条，资源提示则给出「还能提前什么」的建议。三者的输入都只是普通数组，所以可以独立求值、独立断言。',
      hint: 'TBT 逐条累加 duration - 50 的正部；criticalPath 记忆化 DFS 后取全局最优；资源提示按 inViewport 或 blocking 进 preload，其余进 prefetch。',
      code: L1_FINAL,
      test: L1S3,
      diag: [
        'TBT 把整段 duration 都累加了，没有减掉 50ms 的容差窗口。',
        '短任务也被计入 TBT，出现了负数或非零结果，应该只取 Math.max(0, duration - 50)。',
        '关键路径没有按 deps 递归，只算了单个资源的字节，深度恒为 1。',
        '非阻塞资源也被开链了，深度与字节数被放大；应该先判断 blocking === true。',
        'preconnect 没有按 origin 去重，跨域资源有几条就推几个 origin；另外阻塞但不在首屏的资源应进 preload。'
      ]
    }
  ],
  skeleton: `function computeLCP(entries) {
  throw new Error('computeLCP 还没实现')
}

function computeCLS(shifts) {
  throw new Error('computeCLS 还没实现')
}

function percentile(values, p) {
  throw new Error('percentile 还没实现')
}

function histogram(values, bounds) {
  throw new Error('histogram 还没实现')
}

function computeINP(interactions) {
  throw new Error('computeINP 还没实现')
}

function computeTBT(tasks) {
  throw new Error('computeTBT 还没实现')
}

function criticalPath(resources) {
  throw new Error('criticalPath 还没实现')
}

function matchResourceHints(resources) {
  throw new Error('matchResourceHints 还没实现')
}`,
  solution: L1_FINAL,
  finalCode: L1_FINAL,
  tests: `${L1S1}\n${L1S2}\n${L1S3}`
}

/* ============================================================ 第 2 关测试 */
const L2S1 = `{
  check('列表在顶部时窗口从第一行开始且总高等于行数乘行高', () => {
    const r = computeWindow({ scrollTop: 0, viewportHeight: 400, rowHeight: 50, count: 100, overscan: 2 })
    same(r.start, 0)
    same(r.offsetY, 0)
    same(r.totalHeight, 5000)
  })
  check('滚动到中部时首行与偏移按行高换算', () => {
    const r = computeWindow({ scrollTop: 1000, viewportHeight: 400, rowHeight: 50, count: 100, overscan: 1 })
    same(r.start, 19)
    same(r.end, 29)
    same(r.offsetY, 950)
  })
  check('滚到底部时结束索引被夹到总行数', () => {
    const r = computeWindow({ scrollTop: 4800, viewportHeight: 400, rowHeight: 50, count: 100, overscan: 2 })
    same(r.start, 94)
    same(r.end, 100)
  })
  check('收起 overscan 后窗口不额外扩行，空列表返回全零', () => {
    const r = computeWindow({ scrollTop: 0, viewportHeight: 400, rowHeight: 50, count: 100, overscan: 0 })
    same(r.end, 8)
    const empty = computeWindow({ scrollTop: 0, viewportHeight: 400, rowHeight: 50, count: 0, overscan: 2 })
    same(empty.start, 0)
    same(empty.end, 0)
    same(empty.totalHeight, 0)
  })
  check('动态行高按前缀和给出每行起点与总高', () => {
    const g = buildGeometry([50, null, 30], 40)
    same(g.heights, [50, 40, 30])
    same(g.offsets, [0, 50, 90])
    same(g.totalHeight, 120)
  })
}`

const L2S2 = `{
  check('空队列执行一次时间片立刻结束', () => {
    const s = createTimeSlicer({ budget: 8 })
    const r = s.run(0)
    same(r.done, true)
    same(r.executed, 0)
    same(r.spent, 0)
  })
  check('预算足够时一次跑完全部任务', () => {
    const s = createTimeSlicer({ budget: 10 })
    s.add(() => 2)
    s.add(() => 3)
    const r = s.run(0)
    same(r.done, true)
    same(r.executed, 2)
    same(r.spent, 5)
  })
  check('预算被吃满就停下，剩下的任务留给下一片', () => {
    const s = createTimeSlicer({ budget: 8 })
    for (let i = 0; i < 4; i++) s.add(() => 3)
    const r = s.run(0)
    same(r.executed, 3)
    same(r.spent, 9)
    same(r.done, false)
    same(s.remaining(), 1)
  })
  check('第二次时间片从上次中断的位置继续算', () => {
    const s = createTimeSlicer({ budget: 8 })
    for (let i = 0; i < 4; i++) s.add(() => 3)
    s.run(0)
    const r = s.run(9)
    same(r.executed, 1)
    same(r.done, true)
    same(s.remaining(), 0)
  })
  check('单个任务超过预算也只执行它一个，不会空转', () => {
    const s = createTimeSlicer({ budget: 5 })
    s.add(() => 20)
    s.add(() => 1)
    const r = s.run(0)
    same(r.executed, 1)
    same(r.spent, 20)
  })
}`

const L2S3 = `{
  check('高优先级的任务先于低优先级执行', () => {
    const s = createScheduler()
    const order = []
    s.add(() => { order.push('low'); return 1 }, 1)
    s.add(() => { order.push('high'); return 1 }, 3)
    s.add(() => { order.push('mid'); return 1 }, 2)
    s.run(100)
    same(order, ['high', 'mid', 'low'])
  })
  check('同优先级按进入顺序先进先出', () => {
    const s = createScheduler()
    const order = []
    s.add(() => { order.push('a'); return 1 }, 2)
    s.add(() => { order.push('b'); return 1 }, 2)
    s.run(100)
    same(order, ['a', 'b'])
  })
  check('预算耗尽时让出主线程，未执行的任务留在队列', () => {
    const s = createScheduler()
    const order = []
    s.add(() => { order.push(1); return 4 }, 1)
    s.add(() => { order.push(2); return 4 }, 1)
    s.add(() => { order.push(3); return 4 }, 1)
    const r = s.run(8)
    same(r.executed, 2)
    same(r.done, false)
    same(s.pending(), 1)
    same(order, [1, 2])
  })
  check('key 复用能区分插入与删除', () => {
    const r = reconcileKeys(['a', 'b', 'c'], ['b', 'c', 'd'])
    same(r.kept, ['b', 'c'])
    same(r.inserted, ['d'])
    same(r.removed, ['a'])
  })
  check('位移只统计保留下来的 key 位置变化', () => {
    const r = reconcileKeys(['a', 'b', 'c'], ['c', 'b', 'a'])
    same(r.kept, ['c', 'b', 'a'])
    same(r.movedCount, 2)
    same(r.inserted, [])
  })
}`

/* ============================================================ 第 2 关实现（最终形态） */
const L2_FINAL = `function computeWindow(opts) {
  const scrollTop = opts.scrollTop
  const viewportHeight = opts.viewportHeight
  const rowHeight = opts.rowHeight
  const count = opts.count
  const overscan = opts.overscan
  const totalHeight = count * rowHeight
  if (count === 0) return { start: 0, end: 0, offsetY: 0, totalHeight: 0 }
  const first = Math.floor(scrollTop / rowHeight)
  const last = Math.ceil((scrollTop + viewportHeight) / rowHeight)
  const start = Math.max(0, first - overscan)
  const end = Math.min(count, last + overscan)
  return { start, end, offsetY: start * rowHeight, totalHeight }
}

function buildGeometry(heights, defaultHeight) {
  const resolved = heights.map((h) => (typeof h === 'number' ? h : defaultHeight))
  const offsets = []
  let acc = 0
  for (const h of resolved) {
    offsets.push(acc)
    acc += h
  }
  return { offsets, totalHeight: acc, heights: resolved }
}

function createTimeSlicer(opts) {
  const budget = opts.budget
  const queue = []
  return {
    add(task) { queue.push(task) },
    remaining() { return queue.length },
    run(now) {
      let spent = 0
      let executed = 0
      while (queue.length > 0) {
        const task = queue[0]
        queue.shift()
        spent += task()
        executed++
        if (spent >= budget) break
      }
      return { done: queue.length === 0, executed, spent, at: now }
    }
  }
}

function createScheduler() {
  const queue = []
  return {
    add(task, priority) { queue.push({ task, priority: priority === undefined ? 0 : priority }) },
    pending() { return queue.length },
    run(budget) {
      let spent = 0
      let executed = 0
      while (queue.length > 0) {
        let best = 0
        for (let i = 1; i < queue.length; i++) {
          if (queue[i].priority > queue[best].priority) best = i
        }
        const item = queue[best]
        queue.splice(best, 1)
        spent += item.task()
        executed++
        if (spent >= budget) break
      }
      return { done: queue.length === 0, executed, spent }
    }
  }
}

function reconcileKeys(prevKeys, nextKeys) {
  const prevIndex = {}
  for (let i = 0; i < prevKeys.length; i++) prevIndex[prevKeys[i]] = i
  const kept = []
  const inserted = []
  const removed = []
  let movedCount = 0
  for (let i = 0; i < nextKeys.length; i++) {
    const key = nextKeys[i]
    if (Object.prototype.hasOwnProperty.call(prevIndex, key)) {
      kept.push(key)
      if (prevIndex[key] !== i) movedCount++
    } else {
      inserted.push(key)
    }
  }
  for (const key of prevKeys) {
    if (nextKeys.indexOf(key) < 0) removed.push(key)
  }
  return { kept, inserted, removed, movedCount }
}`

/* ============================================================ 第 2 关 */
const LV2 = {
  id: 'lv2',
  title: '大数据量渲染：虚拟列表、时间切片与调度',
  emoji: '🧱',
  xp: 50,
  goal: '实现 computeWindow 与 buildGeometry 算出可视窗口与滚动偏移，实现可中断的 createTimeSlicer 按帧预算推进，再实现带优先级的 createScheduler 与 reconcileKeys 处理 key 复用与位移。',
  why: '一万行数据直接渲染，浏览器不是「慢一点」，而是卡住主线程几秒——用户看到白屏加滚动条抖动。性能问题的根因往往不是渲染本身，而是「一次做完所有事」：一次性建一万个节点、一次性算完所有高度、一次性跑完所有任务。这一关的三步分别对应三种拆分：空间上只渲染可视区，时间上切成小片并允许中断，顺序上按优先级决定谁先跑。',
  nodes: ['fe.perf.longlist', 'fe.perf.longlist.offload', 'fe.perf.longlist.virtual'],
  thinking: [
    {
      title: '虚拟列表的本质是「三个数字的换算」',
      md: '不要被上千行的实现吓到，核心只有：`first = floor(scrollTop / rowHeight)`、`last = ceil((scrollTop + viewport) / rowHeight)`，再各自加减 `overscan`。\n\n但真正让滚动顺滑的不是这两个下标，而是**占位高度**：上下各留一个 `offsetY` 与 `totalHeight - end * rowHeight` 的空白，滚动条长度才不会因为窗口变化而抖动。行高不确定时就要用「已测高度 + 未测按估值」的前缀和（buildGeometry），这才是动态行高列表的工业做法。'
    },
    {
      title: '时间切片的关键是「敢停」与「记住停在哪」',
      md: '一个 16ms 的帧里，把 8ms 留给渲染，剩下的才做计算。切片器每执行一个任务就累加耗时，一旦超出预算立即 `break`，并把没做的任务留在队列里。\n\n两个反面教材：一是「不检查预算，先把这一批跑完」；二是「超出预算的任务直接丢弃」。正确做法是**保留现场**——任务留在队列、下次从队首继续，这就是可中断续算。React 的并发渲染、`requestIdleCallback` 的分片、虚拟滚动的批量测量，都是这个模型。'
    }
  ],
  prereq: [
    {
      title: '先理解为什么「渲染一万行」会卡',
      md: '浏览器每帧的预算大约 16.7ms（60Hz），主线程同时负责 JS 执行、样式计算、布局、绘制。你在一次 JS 任务里创建一万个 DOM 节点，这一帧就必然超时，超时的部分就是长任务，用户感知为「点了没反应」。\n\n虚拟列表解决的是**节点数量**，时间切片解决的是**单次任务时长**，优先级调度解决的是**先做谁**。三个手段互不替代：节点少但计算重，照样卡；计算切碎了但顺序错，用户先看到骨架屏而首屏内容迟迟不来。'
    }
  ],
  api: [
    {
      name: 'computeWindow',
      sig: 'computeWindow({ scrollTop, viewportHeight, rowHeight, count, overscan }) => { start, end, offsetY, totalHeight }',
      args: 'scrollTop 是滚动位置，viewportHeight 是可视区高度，rowHeight 是固定行高，count 是总行数，overscan 是上下各多渲染的行数。',
      returns: 'start 与 end 是需要渲染的区间（end 为开区间），offsetY 是上方占位高度（start * rowHeight），totalHeight 是整表高度（count * rowHeight）。',
      example: `computeWindow({ scrollTop: 1000, viewportHeight: 400, rowHeight: 50, count: 100, overscan: 1 })
// => { start: 19, end: 29, offsetY: 950, totalHeight: 5000 }`
    },
    {
      name: 'createTimeSlicer',
      sig: 'createTimeSlicer({ budget }) => { add(task), run(now), remaining() }',
      args: 'budget 是单个时间片的毫秒预算；add 接受一个返回数字的函数，返回值表示该任务耗时；run 的 now 是调用方给的帧时间戳。',
      returns: 'run 返回 { done, executed, spent, at }：done 表示队列是否已空，executed 是本次执行的任务数，spent 是本次累计耗时。remaining() 返回队列剩余长度。',
      example: `const s = createTimeSlicer({ budget: 8 })
for (let i = 0; i < 4; i++) s.add(() => 3)
s.run(0)   // => { done: false, executed: 3, spent: 9, at: 0 }
s.run(9)   // => { done: true, executed: 1, spent: 3, at: 9 }`
    },
    {
      name: 'reconcileKeys',
      sig: 'reconcileKeys(prevKeys, nextKeys) => { kept, inserted, removed, movedCount }',
      args: 'prevKeys 与 nextKeys 是前后两帧的 key 数组（顺序即渲染顺序）。',
      returns: 'kept 是按新顺序排列的复用 key，inserted 是新增 key，removed 是消失 key，movedCount 是复用 key 中位置发生变化的数量。',
      example: `reconcileKeys(['a', 'b', 'c'], ['b', 'c', 'd'])
// => { kept: ['b', 'c'], inserted: ['d'], removed: ['a'], movedCount: 2 }`
    }
  ],
  usage: 'const win = computeWindow({ scrollTop: el.scrollTop, viewportHeight: el.clientHeight, rowHeight: 44, count: rows.length, overscan: 4 })\nconst slice = rows.slice(win.start, win.end)\n// 用 offsetY 与下半占位撑出滚动条长度：\nrender({ top: win.offsetY, bottom: win.totalHeight - win.end * 44, items: slice })\n// 大量节点挂载时分片：\nconst slicer = createTimeSlicer({ budget: 8 })\nfor (const row of slice) slicer.add(() => mountRow(row))\nfunction frame(now) { if (!slicer.run(now).done) requestAnimationFrame(frame) }',
  hints: [
    '第 1 步：用 floor 与 ceil 算可见行区间，再各自加减 overscan 并夹到 [0, count]；动态行高先把 null 换成默认值，再扫一遍累加出 offsets。',
    '第 2 步：循环里取出队首执行、累加返回值，只要 spent >= budget 就 break，别用 if/return 提前把队列清空。',
    '第 3 步：调度器每次线性扫描队列找最高优先级（同优先级取更靠前的），reconcileKeys 则先建 prev 下标表再遍历 next。'
  ],
  concepts: [
    {
      title: 'overscan 是「稳定性」与「成本」的交换',
      md: 'overscan 越大，快速滚动时越不容易看到空白，但一次挂载的节点也越多。工业实现通常给 2~6 行，并在滚动方向变化时让「前进方向」多留几行（双向 overscan）。面试里能说出这个权衡，比背 API 有用。'
    },
    {
      title: 'key 用的不是「复用」本身，而是「复用谁」',
      md: '列表里用数组下标当 key，删除中间一项会让后面所有项都错位复用，输入框里的内容会跑到别人身上。用稳定 id 作 key，React 才能算出「谁被移动、谁被删除」。reconcileKeys 里的 movedCount 就是这个过程的简化版：位置变化不等于重建，但位置变化需要移动操作。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '算出可视窗口与占位高度',
      think: '先只做固定行高的窗口换算。这一步的产出是三个数字：要渲染哪几行、上方留多高、整表多高。动态行高先做最小版本——未测量的行按默认高度估值，用来撑占位。',
      hint: 'first 用 floor，last 用 ceil；start 与 end 都要夹到 [0, count]；offsetY 直接是 start 乘行高。',
      code: `function computeWindow(opts) {
  const scrollTop = opts.scrollTop
  const viewportHeight = opts.viewportHeight
  const rowHeight = opts.rowHeight
  const count = opts.count
  const overscan = opts.overscan
  const totalHeight = count * rowHeight
  if (count === 0) return { start: 0, end: 0, offsetY: 0, totalHeight: 0 }
  const first = Math.floor(scrollTop / rowHeight)
  const last = Math.ceil((scrollTop + viewportHeight) / rowHeight)
  const start = Math.max(0, first - overscan)
  const end = Math.min(count, last + overscan)
  return { start, end, offsetY: start * rowHeight, totalHeight }
}

function buildGeometry(heights, defaultHeight) {
  const resolved = heights.map((h) => (typeof h === 'number' ? h : defaultHeight))
  const offsets = []
  let acc = 0
  for (const h of resolved) {
    offsets.push(acc)
    acc += h
  }
  return { offsets, totalHeight: acc, heights: resolved }
}`,
      test: L2S1,
      diag: [
        'last 用了 floor，可视区底部半行没有算进去，end 少了一行。',
        'start 与 end 没有夹到 [0, count]，滚到底部时 end 超过了总行数。',
        'offsetY 用了 scrollTop 或 first 而不是 start，overscan 的行没有把占位撑开。',
        '空列表没有提前返回，totalHeight 算成 0 但 start 可能变成负数。',
        'buildGeometry 遇到 null 直接相加得到 NaN，没有回落到 defaultHeight；offsets 也少算了首行零点。'
      ]
    },
    {
      n: 2,
      title: '把批量工作切成可中断的时间片',
      think: '光标移到新的一行就挂载对应节点，这在数据量大时会连续触发长任务。时间切片器把「一批任务」变成「每帧做一点」，关键行为是超预算就停、下次接着做。',
      hint: 'while 队列非空：取队首、执行、累加 spent、executed++，一旦 spent >= budget 就 break；返回 done 用队列长度判断。',
      code: `function computeWindow(opts) {
  const scrollTop = opts.scrollTop
  const viewportHeight = opts.viewportHeight
  const rowHeight = opts.rowHeight
  const count = opts.count
  const overscan = opts.overscan
  const totalHeight = count * rowHeight
  if (count === 0) return { start: 0, end: 0, offsetY: 0, totalHeight: 0 }
  const first = Math.floor(scrollTop / rowHeight)
  const last = Math.ceil((scrollTop + viewportHeight) / rowHeight)
  const start = Math.max(0, first - overscan)
  const end = Math.min(count, last + overscan)
  return { start, end, offsetY: start * rowHeight, totalHeight }
}

function buildGeometry(heights, defaultHeight) {
  const resolved = heights.map((h) => (typeof h === 'number' ? h : defaultHeight))
  const offsets = []
  let acc = 0
  for (const h of resolved) {
    offsets.push(acc)
    acc += h
  }
  return { offsets, totalHeight: acc, heights: resolved }
}

function createTimeSlicer(opts) {
  const budget = opts.budget
  const queue = []
  return {
    add(task) { queue.push(task) },
    remaining() { return queue.length },
    run(now) {
      let spent = 0
      let executed = 0
      while (queue.length > 0) {
        const task = queue[0]
        queue.shift()
        spent += task()
        executed++
        if (spent >= budget) break
      }
      return { done: queue.length === 0, executed, spent, at: now }
    }
  }
}`,
      test: L2S2,
      diag: [
        '预算判断放到了循环外面，一次时间片把队列全跑完了。',
        '超预算后把剩余任务清空了，done 直接返回 true，违背了可中断续算的语义。',
        '累加的 spent 用的是任务数量而不是任务返回的耗时，预算变成按个数算。',
        '取出任务后没有 shift，同一个任务被反复执行直到预算耗尽。',
        '单个任务本身就超预算时仍然继续执行下一个，一次时间片做了两件事。'
      ]
    },
    {
      n: 3,
      title: '优先级调度与 key 复用',
      think: '同样是「先做谁」，切片器只管切，调度器还要排序：用户输入的反馈优先于后台预渲染。最后补上 key 复用统计，把「重建」和「移动」区分开——这是列表性能的第二大来源。',
      hint: '调度器每轮线性扫描找优先级最高的那一项（同优先级取靠前的），执行后 splice 掉；reconcileKeys 先建 prev 下标表，再遍历 next 收集 kept 与 inserted。',
      code: L2_FINAL,
      test: L2S3,
      diag: [
        '调度器只按进入顺序执行，完全没有读 priority 参数。',
        '同优先级用 >= 比较，导致后进的同优先级任务插到了前面，破坏了 FIFO。',
        '预算耗尽后没有保留剩余任务，pending 变成 0，后续帧无活可干。',
        'reconcileKeys 只算了两边长度差，没区分 inserted 与 removed，输出了错位的结果。',
        'movedCount 统计成了「所有 kept 的数量」，或者用下标比较时没有按下标表算位移。'
      ]
    }
  ],
  skeleton: `function computeWindow(opts) {
  throw new Error('computeWindow 还没实现')
}

function buildGeometry(heights, defaultHeight) {
  throw new Error('buildGeometry 还没实现')
}

function createTimeSlicer(opts) {
  throw new Error('createTimeSlicer 还没实现')
}

function createScheduler() {
  throw new Error('createScheduler 还没实现')
}

function reconcileKeys(prevKeys, nextKeys) {
  throw new Error('reconcileKeys 还没实现')
}`,
  solution: L2_FINAL,
  finalCode: L2_FINAL,
  tests: `${L2S1}\n${L2S2}\n${L2S3}`
}

/* ============================================================ 第 3 关测试 */
const L3S1 = `{
  check('结构完全一致的两个对象类型互相兼容', () => {
    const a = { k: 'object', props: { id: 'number', name: 'string' }, optional: [] }
    const r = isAssignable(a, { k: 'object', props: { id: 'number', name: 'string' }, optional: [] })
    same(r.ok, true)
    same(r.missing, [])
  })
  check('源类型缺少目标要求的属性时不兼容', () => {
    const r = isAssignable(
      { k: 'object', props: { id: 'number' }, optional: [] },
      { k: 'object', props: { id: 'number', name: 'string' }, optional: [] }
    )
    same(r.ok, false)
    same(r.missing, ['name'])
  })
  check('多出来的属性不影响兼容，这正是结构化类型的关键', () => {
    const r = isAssignable(
      { k: 'object', props: { id: 'number', name: 'string', email: 'string' }, optional: [] },
      { k: 'object', props: { id: 'number', name: 'string' }, optional: [] }
    )
    same(r.ok, true)
    same(r.missing, [])
  })
  check('目标要求必选而源里是可选的，仍然不兼容', () => {
    const r = isAssignable(
      { k: 'object', props: { id: 'number', radius: 'number' }, optional: ['radius'] },
      { k: 'object', props: { id: 'number', radius: 'number' }, optional: [] }
    )
    same(r.ok, false)
    same(r.missing, ['radius'])
  })
  check('目标为联合时命中一个成员即可，源为联合时每个成员都要兼容', () => {
    same(isAssignable('string', { k: 'union', of: ['string', 'null'] }).ok, true)
    same(isAssignable({ k: 'union', of: ['string', 'null'] }, 'string').ok, false)
  })
}`

const L3S2 = `{
  check('typeof 守卫把联合类型收窄成命中的那个原子类型', () => {
    const t = { k: 'union', of: ['string', 'number'] }
    same(narrow(t, { k: 'typeof', name: 'string' }), 'string')
  })
  check('in 守卫从联合里挑出带该属性的成员', () => {
    const circle = { k: 'object', props: { kind: { k: 'lit', value: 'circle' }, radius: 'number' }, optional: [] }
    const square = { k: 'object', props: { kind: { k: 'lit', value: 'square' }, side: 'number' }, optional: [] }
    const r = narrow({ k: 'union', of: [circle, square] }, { k: 'in', key: 'radius' })
    same(Object.keys(r.props), ['kind', 'radius'])
  })
  check('字面量判别式按 kind 的值收窄到具体成员', () => {
    const circle = { k: 'object', props: { kind: { k: 'lit', value: 'circle' }, radius: 'number' }, optional: [] }
    const square = { k: 'object', props: { kind: { k: 'lit', value: 'square' }, side: 'number' }, optional: [] }
    const r = narrow({ k: 'union', of: [circle, square] }, { k: 'literal', key: 'kind', value: 'square' })
    same(Object.keys(r.props), ['kind', 'side'])
    same(r.props.side, 'number')
  })
  check('没有任何成员命中时收窄成 never，用来做穷尽兜底', () => {
    same(narrow({ k: 'union', of: ['string', 'number'] }, { k: 'typeof', name: 'boolean' }), 'never')
  })
  check('工具类型按定义展开：Pick 保留、Partial 全可选、ReturnType 取返回', () => {
    const t = { k: 'object', props: { id: 'number', name: 'string' }, optional: [] }
    same(Object.keys(applyUtility('Pick', t, ['id']).props), ['id'])
    same(applyUtility('Partial', t, null).optional, ['id', 'name'])
    const fn = { k: 'func', params: ['string'], ret: { k: 'object', props: { id: 'number' }, optional: [] } }
    same(Object.keys(applyUtility('ReturnType', fn, null).props), ['id'])
  })
}`

const L3S3 = `{
  check('映射类型按键重命名生成新的属性名', () => {
    const t = { k: 'object', props: { id: 'number', name: 'string' }, optional: [] }
    const r = evalMapped(t, { prefix: 'get' })
    same(Object.keys(r.props), ['getId', 'getName'])
    same(r.props.getId, 'number')
  })
  check('加可选与去可选分别对应 +? 和 -?', () => {
    const t = { k: 'object', props: { id: 'number', name: 'string' }, optional: ['name'] }
    same(evalMapped(t, { optional: 'add' }).optional, ['id', 'name'])
    same(evalMapped(t, { optional: 'drop' }).optional, [])
  })
  check('映射过程可以先把某些键剔除再重命名', () => {
    const t = { k: 'object', props: { id: 'number', name: 'string', age: 'number' }, optional: [] }
    const r = evalMapped(t, { drop: ['age'], suffix: 'Key' })
    same(Object.keys(r.props), ['idKey', 'nameKey'])
  })
  check('条件类型对非联合成员按命中选择分支', () => {
    same(evalConditional('string', { check: 'string', then: 'string', else: 'never' }), 'string')
  })
  check('条件类型对联合做分布式求值，结果按成员去重合并', () => {
    const r = evalConditional({ k: 'union', of: ['string', 'null'] }, { check: 'string', then: 'string', else: 'undefined' })
    same(r.of, ['string', 'undefined'])
    const dedup = evalConditional({ k: 'union', of: ['a', 'b'] }, { check: { k: 'union', of: ['a', 'b'] }, then: 'yes', else: 'no' })
    same(dedup, 'yes')
  })
}`

/* ============================================================ 第 3 关实现（最终形态） */
const L3_FINAL = `function typeKey(t) {
  if (typeof t === 'string') return t
  if (t.k === 'lit') return 'lit:' + String(t.value)
  if (t.k === 'union') return 'union(' + t.of.map(typeKey).join('|') + ')'
  if (t.k === 'object') {
    const keys = Object.keys(t.props)
    return 'object(' + keys.map((k) => k + ':' + typeKey(t.props[k])).join(',') + ')'
  }
  if (t.k === 'func') return 'func(' + t.params.map(typeKey).join(',') + ')=>' + typeKey(t.ret)
  return 'never'
}

function uniq(list) {
  const out = []
  for (const item of list) {
    if (out.indexOf(item) < 0) out.push(item)
  }
  return out
}

function isAssignable(src, tgt) {
  const missing = []
  const ok = checkAssign(src, tgt, missing)
  return { ok, missing: uniq(missing) }
}

function checkAssign(src, tgt, missing) {
  if (typeof tgt === 'string') {
    if (tgt === 'never') return false
    if (typeof src === 'string') return src === tgt
    if (src.k === 'union') return src.of.every((m) => checkAssign(m, tgt, []))
    if (tgt === 'string' && src.k === 'lit' && typeof src.value === 'string') return true
    if (tgt === 'number' && src.k === 'lit' && typeof src.value === 'number') return true
    return false
  }
  if (tgt.k === 'union') return tgt.of.some((m) => checkAssign(src, m, []))
  if (tgt.k === 'object') {
    if (typeof src === 'string' || src.k !== 'object') return false
    const srcOptional = src.optional || []
    for (const key of Object.keys(tgt.props)) {
      const tgtOptional = (tgt.optional || []).indexOf(key) >= 0
      const has = Object.prototype.hasOwnProperty.call(src.props, key)
      if (!has) {
        if (!tgtOptional) missing.push(key)
        continue
      }
      if (!tgtOptional && srcOptional.indexOf(key) >= 0) {
        missing.push(key)
        continue
      }
      if (!checkAssign(src.props[key], tgt.props[key], missing) && !tgtOptional) missing.push(key)
    }
    return missing.length === 0
  }
  return typeKey(src) === typeKey(tgt)
}

function unionOf(members) {
  const out = []
  const seen = []
  for (const m of members) {
    const key = typeKey(m)
    if (seen.indexOf(key) < 0) {
      seen.push(key)
      out.push(m)
    }
  }
  if (out.length === 0) return 'never'
  if (out.length === 1) return out[0]
  return { k: 'union', of: out }
}

function matchesGuard(t, guard) {
  if (guard.k === 'typeof') {
    if (typeof t === 'string') return t === guard.name
    return false
  }
  if (guard.k === 'in') {
    if (typeof t !== 'object' || t.k !== 'object') return false
    return Object.prototype.hasOwnProperty.call(t.props, guard.key)
  }
  if (guard.k === 'literal') {
    if (typeof t !== 'object' || t.k !== 'object') return false
    const v = t.props[guard.key]
    return v !== undefined && typeof v === 'object' && v.k === 'lit' && v.value === guard.value
  }
  return false
}

function narrow(type, guard) {
  if (typeof type === 'object' && type.k === 'union') {
    return unionOf(type.of.filter((m) => matchesGuard(m, guard)))
  }
  return matchesGuard(type, guard) ? type : 'never'
}

function applyUtility(name, type, arg) {
  const props = {}
  if (name === 'Pick' || name === 'Omit') {
    const keys = arg || []
    const optional = []
    const srcOptional = type.optional || []
    for (const key of Object.keys(type.props)) {
      const picked = keys.indexOf(key) >= 0
      if (name === 'Pick' ? !picked : picked) continue
      props[key] = type.props[key]
      if (srcOptional.indexOf(key) >= 0) optional.push(key)
    }
    return { k: 'object', props, optional }
  }
  if (name === 'Partial' || name === 'Required') {
    for (const key of Object.keys(type.props)) props[key] = type.props[key]
    return { k: 'object', props, optional: name === 'Partial' ? Object.keys(type.props) : [] }
  }
  if (name === 'Record') {
    for (const key of arg.keys || []) props[key] = arg.value
    return { k: 'object', props, optional: [] }
  }
  if (name === 'Exclude' || name === 'Extract') {
    const members = type.k === 'union' ? type.of : [type]
    const kept = members.filter((m) => {
      const hit = isAssignable(m, arg).ok
      return name === 'Extract' ? hit : !hit
    })
    return unionOf(kept)
  }
  if (name === 'ReturnType') {
    if (type.k !== 'func') return 'never'
    return type.ret
  }
  return 'never'
}

function evalMapped(type, opts) {
  const options = opts || {}
  const prefix = options.prefix || ''
  const suffix = options.suffix || ''
  const drop = options.drop || []
  const addAll = options.optional === 'add'
  const dropAll = options.optional === 'drop'
  const srcOptional = type.optional || []
  const props = {}
  const optional = []
  for (const key of Object.keys(type.props)) {
    if (drop.indexOf(key) >= 0) continue
    // 有 prefix 时把键名首字母大写，等价于 prefix + Capitalize<key>
    const head = prefix.length > 0 ? key.charAt(0).toUpperCase() + key.slice(1) : key
    const newKey = prefix + head + suffix
    props[newKey] = type.props[key]
    const wasOptional = srcOptional.indexOf(key) >= 0
    if (addAll || (!dropAll && wasOptional)) optional.push(newKey)
  }
  return { k: 'object', props, optional }
}

function evalConditional(type, opts) {
  const members = typeof type === 'object' && type.k === 'union' ? type.of : [type]
  const out = []
  for (const m of members) {
    out.push(isAssignable(m, opts.check).ok ? opts.then : opts.else)
  }
  return unionOf(out)
}`

/* ============================================================ 第 3 关 */
const LV3 = {
  id: 'lv3',
  title: 'TypeScript 类型系统：用普通数据模拟类型运算',
  emoji: '🧮',
  xp: 60,
  goal: '用普通 JS 对象表示类型 AST，实现结构化兼容判定 isAssignable、类型收窄 narrow、工具类型展开 applyUtility，以及映射类型 evalMapped 与分布式条件类型 evalConditional。',
  why: '类型体操看着玄，其实全是集合运算加几条固定规则：结构化兼容只看「目标要的键源里有没有、类型兼不兼容」，收窄就是从联合里按守卫条件过滤成员，工具类型是对属性表做增删与重映射。把这些规则写成可执行的 JS，你就不再是背 Pick 和 Omit 的定义，而是能推导任意组合出来是什么。面试追问 infer 与分布式条件时，你能一步一步展开给面试官看。',
  nodes: [
    'fe.ts.type-system',
    'fe.ts.type-system.structural-typing',
    'fe.ts.type-system.type-narrowing',
    'fe.ts.advanced',
    'fe.ts.advanced.generics-utility',
    'fe.ts.advanced.mapped-conditional'
  ],
  thinking: [
    {
      title: '类型 AST 用「规范化字符串」当等号',
      md: '判等是类型运算里最容易被忽略的一环。这里的做法是给每种类型一个规范形式：原子就是自己的名字，字面量是 `lit:值`，联合是 `union(成员|成员)`，对象是 `object(键:类型,键:类型)`。\n\n有了 `typeKey` 就能做三件事：联合去重、判断两个类型是否同一个、以及给条件类型挑分支。它不追求和 TypeScript 完全一致（比如不处理泛型参数、不处理索引签名），但把「结构化 + 集合语义」这条主线完整跑通了。'
    },
    {
      title: '分布式条件类型为什么是「先拆再合」',
      md: '`T extends U ? X : Y` 在 T 是联合类型时会**逐成员**求值，再把结果联合起来。这就是分布式条件类型，也是 `Exclude` 能做到「从联合里剔掉某类」的原因。\n\n实现上就是要先把 `type.of` 摊开，对每个成员单独判定，最后用 `unionOf` 合并并去重。如果直接对整条联合判一次，`string | null extends string` 会整体为假，行为就全错了。'
    }
  ],
  prereq: [
    {
      title: '结构化类型 = 只看形状，不看名字',
      md: 'TypeScript 不是名义类型系统：一个对象只要「形状满足」目标类型就能赋值，哪怕它来自完全不同的类。判断规则只有三条：\n\n1. 目标每个**必需**属性，源里必须存在；\n2. 对应属性的类型必须兼容（递归判定）；\n3. 源里多出来的属性不影响兼容。\n\n本关的 `isAssignable` 就是这三条的直接翻译，`missing` 数组额外告诉你缺了哪个键——这比一个布尔值有用得多。'
    }
  ],
  api: [
    {
      name: 'isAssignable / narrow',
      sig: 'isAssignable(src, tgt) => { ok, missing }；narrow(type, guard) => 类型',
      args: 'src 与 tgt 是类型 AST：原子用字符串，字面量用 { k: "lit", value }，联合用 { k: "union", of }，对象用 { k: "object", props, optional }。guard 支持 { k: "typeof", name }、{ k: "in", key }、{ k: "literal", key, value }。',
      returns: 'isAssignable 返回兼容性与缺失的键名数组；narrow 返回收窄后的类型，没有成员命中时返回字符串 never。',
      example: `isAssignable(
  { k: 'object', props: { id: 'number' }, optional: [] },
  { k: 'object', props: { id: 'number', name: 'string' }, optional: [] }
)
// => { ok: false, missing: ['name'] }
narrow({ k: 'union', of: ['string', 'number'] }, { k: 'typeof', name: 'string' })
// => 'string'`
    },
    {
      name: 'applyUtility / evalMapped / evalConditional',
      sig: 'applyUtility(name, type, arg) => 类型；evalMapped(type, opts) => 类型；evalConditional(type, opts) => 类型',
      args: 'applyUtility 的 name 支持 Pick、Omit、Partial、Required、Record、Exclude、Extract、ReturnType，arg 是键数组或 { keys, value }。evalMapped 的 opts 支持 prefix、suffix、drop 与 optional（add 或 drop）；prefix 非空时键名首字母会大写，等价于 prefix + Capitalize<key>。evalConditional 的 opts 是 { check, then, else }。',
      returns: '三者都返回新的类型 AST；联合结果会被去重，单成员联合会塌缩成那个成员本身。',
      example: `applyUtility('Pick', { k: 'object', props: { id: 'number', name: 'string' }, optional: [] }, ['id'])
// => { k: 'object', props: { id: 'number' }, optional: [] }
evalConditional({ k: 'union', of: ['string', 'null'] }, { check: 'string', then: 'string', else: 'undefined' })
// => { k: 'union', of: ['string', 'undefined'] }`
    }
  ],
  usage: 'const loose = isAssignable(actualShape, expectedShape)\nif (!loose.ok) console.warn(\'缺少属性\', loose.missing)\n// 用收窄模拟 switch 的穷尽检查：\nconst afterKind = narrow(shapeUnion, { k: \'literal\', key: \'kind\', value: \'square\' })\n// 用工具类型推导派生的接口：\nconst dto = applyUtility(\'Omit\', entityType, [\'createdAt\', \'updatedAt\'])\nconst getters = evalMapped(dto, { prefix: \'get\' })',
  hints: [
    '第 1 步：把「对象兼容」写成一个递归的 checkAssign，缺键往 missing 里 push，返回 missing 是否为空；原子比较最后落到 typeKey 上。',
    '第 2 步：收窄就是 filter——联合用 filter 后再 unionOf，单类型直接判一次；工具类型都是对 props 与 optional 做增删。',
    '第 3 步：映射类型遍历 Object.keys 生成新键名，条件类型先用 k === "union" 取出成员数组，逐个判 isAssignable 再合并。'
  ],
  concepts: [
    {
      title: '为什么 infer 在这里被省略了',
      md: '真实 TS 的 `infer` 是在条件类型里「声明一个待推断的变量」，编译器做类型匹配时把它绑定成具体类型。本关用普通数据模拟，没有真正的匹配求解器，所以 `ReturnType` 直接从函数 AST 的 `ret` 字段取——效果等价，过程被简化了。理解这一点，你就知道类型体操的「难」主要难在编译器如何求解，而不是规则本身。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '结构化兼容判定',
      think: '先只做一件事：给定源类型和目标类型，判断能不能赋值，并说清缺了哪些键。这一步把「多属性不影响兼容」和「可选不能顶必需」两条最容易混的规则钉死。',
      hint: '递归函数 checkAssign(src, tgt, missing)：对象分支遍历目标的必需键，缺了或源里是可选就 push 键名；联合目标用 some，联合源用 every。',
      code: `function typeKey(t) {
  if (typeof t === 'string') return t
  if (t.k === 'lit') return 'lit:' + String(t.value)
  if (t.k === 'union') return 'union(' + t.of.map(typeKey).join('|') + ')'
  if (t.k === 'object') {
    const keys = Object.keys(t.props)
    return 'object(' + keys.map((k) => k + ':' + typeKey(t.props[k])).join(',') + ')'
  }
  if (t.k === 'func') return 'func(' + t.params.map(typeKey).join(',') + ')=>' + typeKey(t.ret)
  return 'never'
}

function uniq(list) {
  const out = []
  for (const item of list) {
    if (out.indexOf(item) < 0) out.push(item)
  }
  return out
}

function isAssignable(src, tgt) {
  const missing = []
  const ok = checkAssign(src, tgt, missing)
  return { ok, missing: uniq(missing) }
}

function checkAssign(src, tgt, missing) {
  if (typeof tgt === 'string') {
    if (tgt === 'never') return false
    if (typeof src === 'string') return src === tgt
    if (src.k === 'union') return src.of.every((m) => checkAssign(m, tgt, []))
    if (tgt === 'string' && src.k === 'lit' && typeof src.value === 'string') return true
    if (tgt === 'number' && src.k === 'lit' && typeof src.value === 'number') return true
    return false
  }
  if (tgt.k === 'union') return tgt.of.some((m) => checkAssign(src, m, []))
  if (tgt.k === 'object') {
    if (typeof src === 'string' || src.k !== 'object') return false
    const srcOptional = src.optional || []
    for (const key of Object.keys(tgt.props)) {
      const tgtOptional = (tgt.optional || []).indexOf(key) >= 0
      const has = Object.prototype.hasOwnProperty.call(src.props, key)
      if (!has) {
        if (!tgtOptional) missing.push(key)
        continue
      }
      if (!tgtOptional && srcOptional.indexOf(key) >= 0) {
        missing.push(key)
        continue
      }
      if (!checkAssign(src.props[key], tgt.props[key], missing) && !tgtOptional) missing.push(key)
    }
    return missing.length === 0
  }
  return typeKey(src) === typeKey(tgt)
}`,
      test: L3S1,
      diag: [
        '把源类型的键和目标类型的键做了严格相等，多一个属性就判不兼容，违背结构化类型。',
        '源里的可选属性被当成满足目标必需属性，missing 里没有记录该键。',
        '联合目标用 every 判断，要求所有成员都兼容，导致 string 赋给 string | null 失败。',
        '联合源用 some 判断，只要一个成员兼容就通过，null 赋给 string 被误判成功。',
        'missing 没有去重，同一个键在多条递归路径里被重复 push。'
      ]
    },
    {
      n: 2,
      title: '类型收窄与工具类型展开',
      think: '收窄不需要新信息，只需要「从现有联合里过滤」。typeof、in、字面量判别式三种守卫分别对应三种过滤条件，过滤空了就落到 never——那正是穷尽检查的原理。工具类型则是属性表的增删。',
      hint: 'narrow 里先判断 type.k === "union" 再 filter；matchesGuard 按 guard.k 分支；applyUtility 对 Pick/Omit 写一个循环，对 Partial/Required 直接重写 optional。',
      code: `function typeKey(t) {
  if (typeof t === 'string') return t
  if (t.k === 'lit') return 'lit:' + String(t.value)
  if (t.k === 'union') return 'union(' + t.of.map(typeKey).join('|') + ')'
  if (t.k === 'object') {
    const keys = Object.keys(t.props)
    return 'object(' + keys.map((k) => k + ':' + typeKey(t.props[k])).join(',') + ')'
  }
  if (t.k === 'func') return 'func(' + t.params.map(typeKey).join(',') + ')=>' + typeKey(t.ret)
  return 'never'
}

function uniq(list) {
  const out = []
  for (const item of list) {
    if (out.indexOf(item) < 0) out.push(item)
  }
  return out
}

function isAssignable(src, tgt) {
  const missing = []
  const ok = checkAssign(src, tgt, missing)
  return { ok, missing: uniq(missing) }
}

function checkAssign(src, tgt, missing) {
  if (typeof tgt === 'string') {
    if (tgt === 'never') return false
    if (typeof src === 'string') return src === tgt
    if (src.k === 'union') return src.of.every((m) => checkAssign(m, tgt, []))
    if (tgt === 'string' && src.k === 'lit' && typeof src.value === 'string') return true
    if (tgt === 'number' && src.k === 'lit' && typeof src.value === 'number') return true
    return false
  }
  if (tgt.k === 'union') return tgt.of.some((m) => checkAssign(src, m, []))
  if (tgt.k === 'object') {
    if (typeof src === 'string' || src.k !== 'object') return false
    const srcOptional = src.optional || []
    for (const key of Object.keys(tgt.props)) {
      const tgtOptional = (tgt.optional || []).indexOf(key) >= 0
      const has = Object.prototype.hasOwnProperty.call(src.props, key)
      if (!has) {
        if (!tgtOptional) missing.push(key)
        continue
      }
      if (!tgtOptional && srcOptional.indexOf(key) >= 0) {
        missing.push(key)
        continue
      }
      if (!checkAssign(src.props[key], tgt.props[key], missing) && !tgtOptional) missing.push(key)
    }
    return missing.length === 0
  }
  return typeKey(src) === typeKey(tgt)
}

function unionOf(members) {
  const out = []
  const seen = []
  for (const m of members) {
    const key = typeKey(m)
    if (seen.indexOf(key) < 0) {
      seen.push(key)
      out.push(m)
    }
  }
  if (out.length === 0) return 'never'
  if (out.length === 1) return out[0]
  return { k: 'union', of: out }
}

function matchesGuard(t, guard) {
  if (guard.k === 'typeof') {
    if (typeof t === 'string') return t === guard.name
    return false
  }
  if (guard.k === 'in') {
    if (typeof t !== 'object' || t.k !== 'object') return false
    return Object.prototype.hasOwnProperty.call(t.props, guard.key)
  }
  if (guard.k === 'literal') {
    if (typeof t !== 'object' || t.k !== 'object') return false
    const v = t.props[guard.key]
    return v !== undefined && typeof v === 'object' && v.k === 'lit' && v.value === guard.value
  }
  return false
}

function narrow(type, guard) {
  if (typeof type === 'object' && type.k === 'union') {
    return unionOf(type.of.filter((m) => matchesGuard(m, guard)))
  }
  return matchesGuard(type, guard) ? type : 'never'
}

function applyUtility(name, type, arg) {
  const props = {}
  if (name === 'Pick' || name === 'Omit') {
    const keys = arg || []
    const optional = []
    const srcOptional = type.optional || []
    for (const key of Object.keys(type.props)) {
      const picked = keys.indexOf(key) >= 0
      if (name === 'Pick' ? !picked : picked) continue
      props[key] = type.props[key]
      if (srcOptional.indexOf(key) >= 0) optional.push(key)
    }
    return { k: 'object', props, optional }
  }
  if (name === 'Partial' || name === 'Required') {
    for (const key of Object.keys(type.props)) props[key] = type.props[key]
    return { k: 'object', props, optional: name === 'Partial' ? Object.keys(type.props) : [] }
  }
  if (name === 'Record') {
    for (const key of arg.keys || []) props[key] = arg.value
    return { k: 'object', props, optional: [] }
  }
  if (name === 'Exclude' || name === 'Extract') {
    const members = type.k === 'union' ? type.of : [type]
    const kept = members.filter((m) => {
      const hit = isAssignable(m, arg).ok
      return name === 'Extract' ? hit : !hit
    })
    return unionOf(kept)
  }
  if (name === 'ReturnType') {
    if (type.k !== 'func') return 'never'
    return type.ret
  }
  return 'never'
}`,
      test: L3S2,
      diag: [
        'narrow 直接对整条联合判一次，没有 filter 成员，typeof 守卫总是返回原联合。',
        'typeof 守卫把对象成员也当成了匹配，类型标签与本体混在一起判定。',
        'in 守卫只查了 optional 数组，没查 props，带该属性但可选的成员被漏掉。',
        '字面量守卫比较的是 typeKey 而不是 lit 的 value，kind 判断永远不成立。',
        '工具类型把 optional 整个丢弃了，Pick 之后原本可选的键变成了必选。'
      ]
    },
    {
      n: 3,
      title: '映射类型与分布式条件类型',
      think: '最后一步把前面两块拼起来：映射类型对属性表做遍历与重命名（顺带处理 +? 与 -?），条件类型对联合逐成员判定再合并。两者叠加就能推导出 Omit、Exclude、Partial 这些内置类型的组合效果。',
      hint: 'evalMapped 遍历 Object.keys，新键 = prefix + key + suffix，optional 按 add/drop 重算；evalConditional 先摊开联合，逐个 isAssignable 后 unionOf。',
      code: L3_FINAL,
      test: L3S3,
      diag: [
        '映射只改了键名没有搬值，新属性全是 undefined。',
        '加可选时把原有的可选键漏掉了，optional 里只有新增的键。',
        '去可选（-?）后 optional 还是原数组，没有清空。',
        'drop 的键名是在重命名之后的键上比对，导致剔除失效。',
        '条件类型对整条联合判了一次，null 没有走 else 分支，结果缺了 undefined。'
      ]
    }
  ],
  skeleton: `function isAssignable(src, tgt) {
  throw new Error('isAssignable 还没实现')
}

function narrow(type, guard) {
  throw new Error('narrow 还没实现')
}

function applyUtility(name, type, arg) {
  throw new Error('applyUtility 还没实现')
}

function evalMapped(type, opts) {
  throw new Error('evalMapped 还没实现')
}

function evalConditional(type, opts) {
  throw new Error('evalConditional 还没实现')
}`,
  solution: L3_FINAL,
  finalCode: L3_FINAL,
  tests: `${L3S1}\n${L3S2}\n${L3S3}`
}

export default {
  id: 'fe-perf',
  version: 3,
  domain: 'fe',
  cumulative: false,
  title: '前端性能与类型系统：从指标到渲染再到类型',
  emoji: '⚡',
  tagline: '3 关：Web Vitals 计算与定位 / 虚拟列表与时间切片 / TypeScript 类型运算模拟',
  stack: ['Performance', 'TypeScript'],
  intro: '性能优化最怕两件事：没有数字，和数字对不上体感。这个项目先把体感翻译成指标——LCP 决定大图什么时候画出来，CLS 决定页面有没有乱跳，INP 决定点了之后多久有反应，再叠上 P75 分位数与直方图，让尾部有多长一眼可见。随后转向定位：TBT 把长任务拆出超过 50ms 的阻塞部分，关键渲染路径指出哪个阻塞资源链最深最重，资源提示匹配决定谁该 preload、谁该 prefetch、哪个域名该 preconnect。第二关换到渲染侧，用纯函数算虚拟列表窗口、写可中断的时间切片器与优先级调度器，并处理 key 复用与位移。第三关用 JS 数据结构模拟 TypeScript 的类型运算：结构化兼容、联合与交叉的集合语义、类型收窄、工具类型展开、映射与条件类型。所有时间、位置、预算、类型定义都由参数传入。',
  outcome: '你能独立写出一层可解释的指标计算代码：拿到条目就知道 LCP 取哪条、CLS 该不该开新窗、INP 的 P75 怎么算；拿到长任务能算出 TBT 并指出主线程被谁占住；拿到资源清单能判断关键路径深度与字节并给出提示建议。渲染侧你能从零写虚拟列表窗口、时间切片器与优先级调度器，并说清 key 复用为什么比重新渲染便宜。类型侧你能用普通 JS 复现结构化兼容、收窄、工具类型与条件类型的推导规则，面试里被追问类型体操时能讲清每一步展开。',
  levels: [LV1, LV2, LV3]
}