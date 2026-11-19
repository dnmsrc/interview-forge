/**
 * 前端 · CSS 基础与生态：层叠与盒子计算器 / 布局求解器 / React 机制与 SSR 对照 / 桌面容器与样式工程
 *
 * 四关互不依赖（cumulative: false），每关都是一个可以独立推导的「小型规格实现」：
 * 把 CSS 与前端生态里那些「说不清就写不对」的规则，落成纯函数 + 可断言的检查点。
 *
 * 判题沙箱没有 DOM、没有 require、没有定时器，所以这里全部是纯函数：
 * 输入是样式声明对象 / 规则数组 / 视口尺寸，输出是尺寸、赢家、匹配结果。
 * 每关的 thinking 里都写清了「简化了什么、对应真实系统的哪一部分」。
 */

/* ============================================================ 第 1 关测试 */

const L1S1 = `{
  check('单个类型选择器记一个类型权重', () => {
    same(specificity('div'), [0, 0, 1])
    same(specificity('ul li a'), [0, 0, 3])
  })
  check('类选择器落在第二列', () => {
    same(specificity('.item'), [0, 1, 0])
    same(specificity('.a .b .c'), [0, 3, 0])
  })
  check('id 是第一列，后代选择器要逐段累加', () => {
    same(specificity('#nav'), [1, 0, 0])
    same(specificity('#nav .item a'), [1, 1, 1])
  })
  check('属性选择器与伪类都算第二列', () => {
    same(specificity('input[type="text"]'), [0, 1, 1])
    same(specificity('a:hover'), [0, 1, 1])
    same(specificity(':not(.hidden)'), [0, 1, 0])
  })
  check('伪元素算类型权重，不是伪类', () => {
    same(specificity('a:hover::before'), [0, 1, 2])
    same(specificity('p::first-line'), [0, 0, 2])
  })
  check('通配符与组合符不贡献权重', () => {
    same(specificity('*'), [0, 0, 0])
    same(specificity('* > *'), [0, 0, 0])
    same(specificity('   '), [0, 0, 0])
  })
}`

const L1S2 = `{
  check('特异性高的规则赢', () => {
    const rules = [
      { selector: '.a', value: 'blue', order: 0 },
      { selector: '#x', value: 'red', order: 1 }
    ]
    same(cascadeWinner(rules).value, 'red')
  })
  check('同特异性时后写的赢（源顺序）', () => {
    const rules = [
      { selector: '.a', value: 'blue', order: 0 },
      { selector: '.b', value: 'green', order: 1 }
    ]
    same(cascadeWinner(rules).value, 'green')
  })
  check('!important 越过特异性', () => {
    const rules = [
      { selector: '#x', value: 'red', order: 0 },
      { selector: '.a', value: 'blue', order: 1, important: true }
    ]
    same(cascadeWinner(rules).value, 'blue')
  })
  check('同等重要性下行内样式赢过作者样式表', () => {
    const rules = [
      { selector: '#x', value: 'red', order: 0 },
      { selector: '(inline)', inline: true, value: 'purple', order: 1 }
    ]
    same(cascadeWinner(rules).value, 'purple')
  })
  check('两条 !important 之间回到特异性比较', () => {
    const rules = [
      { selector: '.a', value: 'one', order: 0, important: true },
      { selector: 'div .b', value: 'two', order: 1, important: true },
      { selector: '#x', value: 'three', order: 2, important: true }
    ]
    same(cascadeWinner(rules).value, 'three')
    same(cascadeWinner(rules.slice().reverse()).value, 'three')
  })
  check('空规则列表返回 null，调用方可以安全判空', () => {
    same(cascadeWinner([]), null)
  })
}`

const L1S3 = `{
  check('content-box：声明宽度就是内容宽度', () => {
    const box = boxSize({ width: 200, padding: 10, border: 2 })
    same(box.contentWidth, 200)
    same(box.borderBoxWidth, 224)
  })
  check('border-box：声明宽度含 padding 与 border', () => {
    const box = boxSize({ width: 200, padding: 10, border: 2, boxSizing: 'border-box' })
    same(box.borderBoxWidth, 200)
    same(box.contentWidth, 176)
  })
  check('margin 不进宽度，单独算成 margin box', () => {
    const box = boxSize({ width: 100, padding: 0, border: 0, margin: 25 })
    same(box.borderBoxWidth, 100)
    same(box.marginBoxWidth, 150)
  })
  check('border-box 下内边距超出声明宽度时内容宽度夹到 0', () => {
    const box = boxSize({ width: 20, padding: 15, border: 1, boxSizing: 'border-box' })
    same(box.contentWidth, 0)
    same(box.borderBoxWidth, 20)
  })
  check('浮动、绝对定位、非 visible 溢出、inline-block 都建立 BFC', () => {
    same(establishesBFC({ float: 'left' }), true)
    same(establishesBFC({ position: 'absolute' }), true)
    same(establishesBFC({ overflow: 'hidden' }), true)
    same(establishesBFC({ display: 'inline-block' }), true)
  })
  check('flow-root 与 flex 建立 BFC，普通块与 sticky 不建立', () => {
    same(establishesBFC({ display: 'flow-root' }), true)
    same(establishesBFC({ display: 'flex' }), true)
    same(establishesBFC({ display: 'block' }), false)
    same(establishesBFC({ position: 'sticky', overflow: 'visible' }), false)
  })
}`

/* ============================================================ 第 1 关：层叠与盒子计算器 */

const LV1 = {
  id: 'lv1',
  title: '层叠与盒子计算器',
  emoji: '🧮',
  xp: 40,
  goal: '交付 specificity / cascadeWinner / boxSize / establishesBFC 四个纯函数：算出选择器权重、按 important→inline→特异性→源顺序选出赢家、按 box-sizing 换算出内容宽度、判断元素是否建立 BFC。',
  why: '「这两个选择器谁生效」「width: 200px 里面到底能放多宽的内容」是面试出现频率最高、又最容易被糊弄过去的两类问题。它们真正的样子是两套可计算的规则：层叠是四级比较，盒模型是一次加减法。把规则写成函数之后，你就不是在背结论，而是在复现浏览器的判断；以后遇到「为什么我的样式没生效」也能按顺序自己查一遍，而不是盲改加 !important。',
  nodes: [
    'fe.css.foundation',
    'fe.css.foundation.selector-cascade',
    'fe.css.box',
    'fe.css.box.bfc',
    'fe.css.box.box-model'
  ],
  thinking: [
    {
      title: '先把权重做成「可比大小的三元组」，再谈谁赢',
      md: '很多人第一反应是给选择器「打一个分」，比如 id 100 分、类 10 分、标签 1 分，然后相加。这个心算模型很省事，但它只在「类不超过 9 个、不想象极端情况」时成立：`div .a .b .c .d .e .f .g .h .i .j` 用 1 + 10*10 会算成 101，和 `#x` 的 100 比就得出错误结论。\n\n真正的比较是**逐位比较**：(a, b, c) 先比 a，a 相等再比 b，再比 c——所以位数再多也不会「溢出」到上一列。我把返回值定成 `[a, b, c]` 数组而不是字符串，就是为了让「比较」这件事在下一步能直接写出来，而不是再解析一次。'
    },
    {
      title: '层叠不是打分，是四级排序：先问来源，再问特异性',
      md: '有了权重以后，初学者会顺手写「权重大的赢」，然后漏掉 `!important` 和行内样式。CSS 层叠的真实顺序（只看作者层面）是：`!important` 的作者声明 > 行内样式 > 特异性 > 源顺序。\n\n注意 `!important` 是**翻转来源顺序**的：正常声明里「作者 < 用户」，important 声明里「作者 important > 用户 important」。行内样式在真实规范里等价于一个 (1,0,0,0) 的特异性，比任何选择器都高；本关用一个 `inline` 布尔位在特异性之前比较，效果一致，但你要知道真实实现里它是权重的第 0 列。'
    },
    {
      title: '盒模型只算尺寸、不算布局，所以能被穷举',
      md: '`boxSize` 故意不接受 margin 折叠、百分比、视口单位——它只回答一个问题：**给定 width / padding / border / box-sizing，内容区有多宽**。这看起来「太简单」，但正是它能被穷举的原因：content-box 加、border-box 减、夹到 0，三个分支就覆盖了全部。\n\nBFC 同理：它不是某个属性，而是一组声明的副作用，所以判断函数本质是一个「开关列表」的并集。这一步唯一的坑是 `position: sticky` 和 `display: inline`——前者常被误以为建立 BFC，后者确实不建立。'
    }
  ],
  prereq: [
    {
      title: '选择器由「复合选择器 + 组合符」拼成',
      md: '`#nav .item a:hover` 不是一个整体，而是三段复合选择器被后代组合符 ` ` 连起来。权重按「每段自己的 (a, b, c) 相加」计算：`#nav` 是 (1,0,0)，`.item` 是 (0,1,0)，`a:hover` 是 (0,1,1)，合计 (1,2,1)。\n\n所以解析时只要按组合符切段、对每段数 `#` / `.` / `[...]` / `:伪类` / 类型名，再求和即可。常见误解：`*` 也「占了点权重」——它的权重是 (0,0,0)，`* > *` 同样是 (0,0,0)。'
    },
    {
      title: 'box-sizing 决定 width 指向哪一层盒子',
      md: '标准盒模型（content-box）里 `width` 只指内容区；IE/怪异盒模型（border-box）里 `width` 指 border box，也就是含 padding 和 border。工程上全局 `*, *::before, *::after { box-sizing: border-box }` 的原因很实际：你写 `width: 200px` 时希望它「就是 200px 宽」，而不是「200 加上一堆内边距」。\n\n换算只有两条：content-box 下 `contentWidth = width`，border-box 下 `contentWidth = width - 2*padding - 2*border`。margin 永远不进 width，它只影响这条盒子在父容器里占的总空间。'
    },
    {
      title: 'BFC：块级格式化上下文是一块「独立的布局容器」',
      md: 'BFC 最实用的三条效果：① 包住内部浮动（父元素不再高度塌陷）；② 阻止与相邻块的外边距折叠；③ 不与浮动元素重叠（所以两栏自适应常用 `overflow: hidden`）。\n\n触发条件要记「类别」而不是背清单：浮动（float 非 none）、绝对/固定定位、`display` 为 flow-root / inline-block / table-cell / flex / grid 等、`overflow` 非 visible、`contain` 为 layout/paint/strict/content。注意 `display: inline` 和 `position: sticky` **不**触发——这是两个高频误答。'
    }
  ],
  api: [
    {
      name: 'specificity',
      sig: 'specificity(selector: string) => [a, b, c]',
      args: 'selector 是单个选择器（可用后代 / 子代 / 兄弟组合符连接）。不要传逗号分隔的选择器列表——列表里每一项都是独立规则。',
      returns: '三元组：a = id 数量，b = 类 / 属性 / 伪类数量，c = 类型选择器与伪元素数量。比较时从左到右逐位比。',
      example: "same(specificity('#nav .item a:hover'), [1, 2, 1])\nsame(specificity('*'), [0, 0, 0])"
    },
    {
      name: 'cascadeWinner',
      sig: 'cascadeWinner(rules: Rule[]) => Rule | null',
      args: 'rules 每项为 { selector, value, important?, inline?, order? }。order 缺省时用数组下标；inline 为 true 表示这条来自元素 style 属性。',
      returns: '赢家规则（已补全默认值），列表为空时返回 null。比较顺序：important → inline → 特异性 → order。',
      example: "const rules = [\n  { selector: '.btn', value: 'blue', order: 0 },\n  { selector: '#submit', value: 'red', order: 1 }\n]\nsame(cascadeWinner(rules).value, 'red')"
    },
    {
      name: 'boxSize',
      sig: 'boxSize(style: { width?, padding?, border?, margin?, boxSizing? }) => { boxSizing, contentWidth, borderBoxWidth, marginBoxWidth }',
      args: '所有长度按 px 数字给（单值，等价于四边相同）。boxSizing 传 "border-box" 走怪异盒模型，其他值（含缺省）都按 content-box。',
      returns: '内容宽度、border box 宽度、margin box 宽度。border-box 下若 padding + border 吃满声明宽度，内容宽度夹到 0（不会出负数）。',
      example: 'const box = boxSize({ width: 200, padding: 10, border: 2 })\nsame(box.contentWidth, 200)\nsame(box.borderBoxWidth, 224)'
    },
    {
      name: 'establishesBFC',
      sig: 'establishesBFC(style: object) => boolean',
      args: 'style 只读几个关键声明：float、position、display、overflow、contain。未出现的声明按初始值处理（float: none / position: static / display: block / overflow: visible）。',
      returns: '该声明组合是否建立块级格式化上下文。',
      example: "same(establishesBFC({ overflow: 'hidden' }), true)\nsame(establishesBFC({ position: 'sticky' }), false)"
    }
  ],
  usage: "// 1) 排查「为什么我的样式没生效」\nconst rules = [\n  { selector: '.card .title', value: 'color: #333', order: 12 },\n  { selector: '.card .title', value: 'color: #fff', order: 88 },\n  { selector: '#hero .title', value: 'color: #000', order: 3 }\n]\nconsole.log(cascadeWinner(rules).value)   // '#000'：特异性 (1,1,0) 赢过 (0,2,0)\n\n// 2) 校验团队的全局 border-box 约定\nconst box = boxSize({ width: 320, padding: 16, border: 1, boxSizing: 'border-box' })\nconsole.log(box.contentWidth)             // 286\n\n// 3) 判断一个容器会不会包住内部浮动\nconsole.log(establishesBFC({ overflow: 'auto' }))   // true",
  hints: [
    '第一步先只做 specificity：从左到右扫一遍字符串，遇到 # / . / : / [ 就进对应分支，遇到括号整段跳过——不要用正则一把梭，先想清楚「`::before` 里的两个冒号要不要算两个伪类」。',
    '第二步的比较逻辑拆成 beats(candidate, current)：按 important、inline、compareSpecificity、order 四个 if 依次返回，最后再写 cascadeWinner 循环。',
    '第三步 border-box 的换算只有一个减号：content = width - 2*(padding + border)，记得 Math.max(0, ...)；BFC 判断把五个开关写成「任一命中即 true」。'
  ],
  concepts: [
    {
      title: '为什么规范要求「尽量不用 !important」',
      md: '`!important` 会翻转层叠的来源顺序，让一条规则越过整个作者样式表。一旦为了压住某个第三方组件加上它，后续任何正常声明都赢不了，只能再加一条 `!important` 去压——这是典型的「特异性军备竞赛」。\n\n工程上的替代手段是：降低选择器深度（`BEM` 或原子类）、用 CSS 变量在局部覆盖、把第三方样式收进 `:where()`（`:where()` 的权重恒为 0）。本关的 `cascadeWinner` 只是把规则显式化，真实项目里更该做的是让规则根本不需要打架。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '先让权重能被算出来',
      think: '先把「权重」变成一个能比较大小的东西，后面的层叠才有统一裁判。这一步刻意只做解析、不做选择：specificity 错一位，cascadeWinner 的结论就全歪，而它单独是能被穷举测出来的。',
      hint: '从左到右扫字符串：遇到 # / . / : / [ 进入对应计数分支，括号内的内容整段跳过；`::` 要单独判成伪元素。',
      vocab: [
        { term: 'specificity', desc: '选择器特异性，写成 (id, class, type) 三元组，逐位比较' },
        { term: 'inline style', desc: '元素 style 属性里的声明，特异性高于任何选择器' }
      ],
      code: `function isNameChar(ch) {
  if (!ch) return false
  const code = ch.charCodeAt(0)
  return (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || (code >= 48 && code <= 57) || ch === '-' || ch === '_'
}

/**
 * specificity(selector) -> [a, b, c]
 * a = id 数量；b = 类 / 属性 / 伪类数量；c = 类型选择器 / 伪元素数量
 * 简化：伪类括号内的参数不参与计算（真实规范里 :not()/:is() 取参数中的最高特异性）
 */
function specificity(selector) {
  const s = String(selector == null ? '' : selector).trim()
  let a = 0
  let b = 0
  let c = 0
  let i = 0

  while (i < s.length) {
    const ch = s[i]

    if (ch === '#') {
      let j = i + 1
      while (isNameChar(s[j])) j++
      if (j > i + 1) a += 1
      i = j
    } else if (ch === '.') {
      let j = i + 1
      while (isNameChar(s[j])) j++
      if (j > i + 1) b += 1
      i = j
    } else if (ch === '[') {
      // 属性选择器：整段跳到 ]，内部的引号与等号都不影响权重
      let j = i + 1
      while (j < s.length && s[j] !== ']') j++
      b += 1
      i = j + 1
    } else if (ch === ':') {
      if (s[i + 1] === ':') {
        // 伪元素算类型权重
        let j = i + 2
        while (isNameChar(s[j])) j++
        c += 1
        i = j
      } else {
        // 伪类算类权重，括号参数整段跳过
        let j = i + 1
        while (isNameChar(s[j])) j++
        b += 1
        if (s[j] === '(') {
          let depth = 1
          j += 1
          while (j < s.length && depth > 0) {
            if (s[j] === '(') depth++
            else if (s[j] === ')') depth--
            j++
          }
        }
        i = j
      }
    } else if (isNameChar(ch)) {
      // 类型选择器：连续的名字字符算一个
      let j = i
      while (isNameChar(s[j])) j++
      c += 1
      i = j
    } else {
      // 组合符（空格 > + ~）、逗号、* 都不贡献权重
      i++
    }
  }

  return [a, b, c]
}`,
      test: L1S1,
      diag: [
        '类型选择器没有单独计数，或者把名字后面的数字也当成了独立选择器——检查 isNameChar 的循环边界。',
        '类选择器分支里 j 没有往前走，`.item` 被算成了 0 个类。',
        'id 与后代的累加顺序写反，或者 `#nav .item a` 里空格没有触发新一段扫描。',
        '属性选择器没整段跳过，`[type="text"]` 里的 type 被当成了类型选择器多算一个 c。',
        '伪元素被当成了伪类：双冒号分支缺失，`::before` 记进了 b 列。',
        '通配符 `*` 被算成了类型选择器，或空字符串导致循环越界。'
      ]
    },
    {
      n: 2,
      title: '给层叠一个四级裁判',
      think: '层叠不是打分相加：`#a` 与 `div .x .y .z` 谁赢必须靠逐位比较，用 a*100 + b*10 + c 会在类数量超过 10 时翻车。所以第二步只加「比较器」，复用第一步算出的三元组，一行 specificity 都不用改。',
      hint: 'normalizeRule 把每条规则补成可比字段（important / inline / specificity / order）；beats 按 important → inline → 特异性 → order 逐级裁决。',
      vocab: [
        { term: 'source order', desc: '源顺序：同特异性、同重要性时，后出现的声明赢' },
        { term: 'cascade', desc: '层叠：决定多条规则同时命中一个元素时谁生效的整套规则' }
      ],
      code: `function isNameChar(ch) {
  if (!ch) return false
  const code = ch.charCodeAt(0)
  return (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || (code >= 48 && code <= 57) || ch === '-' || ch === '_'
}

function specificity(selector) {
  const s = String(selector == null ? '' : selector).trim()
  let a = 0
  let b = 0
  let c = 0
  let i = 0

  while (i < s.length) {
    const ch = s[i]

    if (ch === '#') {
      let j = i + 1
      while (isNameChar(s[j])) j++
      if (j > i + 1) a += 1
      i = j
    } else if (ch === '.') {
      let j = i + 1
      while (isNameChar(s[j])) j++
      if (j > i + 1) b += 1
      i = j
    } else if (ch === '[') {
      let j = i + 1
      while (j < s.length && s[j] !== ']') j++
      b += 1
      i = j + 1
    } else if (ch === ':') {
      if (s[i + 1] === ':') {
        let j = i + 2
        while (isNameChar(s[j])) j++
        c += 1
        i = j
      } else {
        let j = i + 1
        while (isNameChar(s[j])) j++
        b += 1
        if (s[j] === '(') {
          let depth = 1
          j += 1
          while (j < s.length && depth > 0) {
            if (s[j] === '(') depth++
            else if (s[j] === ')') depth--
            j++
          }
        }
        i = j
      }
    } else if (isNameChar(ch)) {
      let j = i
      while (isNameChar(s[j])) j++
      c += 1
      i = j
    } else {
      i++
    }
  }

  return [a, b, c]
}

/** 逐位比较：返回值 > 0 表示 x 更具体 */
function compareSpecificity(x, y) {
  for (let k = 0; k < 3; k++) {
    const d = (x[k] || 0) - (y[k] || 0)
    if (d !== 0) return d
  }
  return 0
}

/** 把一条规则补成可比较的完整形态 */
function normalizeRule(rule, index) {
  const inline = rule && rule.inline === true
  return {
    selector: String((rule && rule.selector) || '(inline)'),
    value: rule ? rule.value : undefined,
    important: !!(rule && rule.important),
    inline: inline,
    // 行内样式等价于一个 id 级的特异性；真实规范里它是权重的第 0 列
    specificity: inline ? [1, 0, 0] : specificity((rule && rule.selector) || '*'),
    order: rule && rule.order != null ? rule.order : index
  }
}

/** 四级裁决：important -> inline -> 特异性 -> 源顺序 */
function beats(candidate, current) {
  if (candidate.important !== current.important) return candidate.important
  if (candidate.inline !== current.inline) return candidate.inline
  const diff = compareSpecificity(candidate.specificity, current.specificity)
  if (diff !== 0) return diff > 0
  return candidate.order >= current.order
}

function cascadeWinner(rules) {
  let best = null
  const list = rules == null ? [] : rules
  for (let i = 0; i < list.length; i++) {
    const next = normalizeRule(list[i], i)
    if (best === null || beats(next, best)) best = next
  }
  return best
}`,
      test: L1S2,
      diag: [
        'cascadeWinner 里只比较了 specificity，忘了先比 important 与 inline。',
        '同特异性时用了 `>` 而不是 `>=`，先出现的那条反而赢；源顺序是「后写的赢」。',
        '!important 的方向写反（把 important 当成减分），或者只对赢家做了判断。',
        '行内样式没有单独的分支，被当成普通选择器去算特异性；或者 inline 判断写成了 `rule.inline` 的真值判断。',
        '比较符号反了导致结果依赖输入顺序（把数组 reverse 一次结论就变），说明某个环节不是全序比较。',
        '空数组没有返回 null，而是读了 undefined.value 抛错。'
      ]
    },
    {
      n: 3,
      title: '把盒子算清楚：尺寸与 BFC',
      think: '盒模型与 BFC 是同一个问题的两面：尺寸回答「这个盒子占多宽」，BFC 回答「里面的浮动和 margin 被谁兜住」。两个函数都只读声明对象、不做真实布局，所以能穷举所有边界——这正是它们适合作为面试白板题的原因。',
      hint: 'width 在 content-box 下就是内容宽度；border-box 下先减掉 2*(padding+border) 再夹到 0。BFC 按「浮动 / 绝对定位 / display / overflow / contain」五个开关逐个查，sticky 不在列表里。',
      code: `function isNameChar(ch) {
  if (!ch) return false
  const code = ch.charCodeAt(0)
  return (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || (code >= 48 && code <= 57) || ch === '-' || ch === '_'
}

function specificity(selector) {
  const s = String(selector == null ? '' : selector).trim()
  let a = 0
  let b = 0
  let c = 0
  let i = 0

  while (i < s.length) {
    const ch = s[i]

    if (ch === '#') {
      let j = i + 1
      while (isNameChar(s[j])) j++
      if (j > i + 1) a += 1
      i = j
    } else if (ch === '.') {
      let j = i + 1
      while (isNameChar(s[j])) j++
      if (j > i + 1) b += 1
      i = j
    } else if (ch === '[') {
      let j = i + 1
      while (j < s.length && s[j] !== ']') j++
      b += 1
      i = j + 1
    } else if (ch === ':') {
      if (s[i + 1] === ':') {
        let j = i + 2
        while (isNameChar(s[j])) j++
        c += 1
        i = j
      } else {
        let j = i + 1
        while (isNameChar(s[j])) j++
        b += 1
        if (s[j] === '(') {
          let depth = 1
          j += 1
          while (j < s.length && depth > 0) {
            if (s[j] === '(') depth++
            else if (s[j] === ')') depth--
            j++
          }
        }
        i = j
      }
    } else if (isNameChar(ch)) {
      let j = i
      while (isNameChar(s[j])) j++
      c += 1
      i = j
    } else {
      i++
    }
  }

  return [a, b, c]
}

function compareSpecificity(x, y) {
  for (let k = 0; k < 3; k++) {
    const d = (x[k] || 0) - (y[k] || 0)
    if (d !== 0) return d
  }
  return 0
}

function normalizeRule(rule, index) {
  const inline = rule && rule.inline === true
  return {
    selector: String((rule && rule.selector) || '(inline)'),
    value: rule ? rule.value : undefined,
    important: !!(rule && rule.important),
    inline: inline,
    specificity: inline ? [1, 0, 0] : specificity((rule && rule.selector) || '*'),
    order: rule && rule.order != null ? rule.order : index
  }
}

function beats(candidate, current) {
  if (candidate.important !== current.important) return candidate.important
  if (candidate.inline !== current.inline) return candidate.inline
  const diff = compareSpecificity(candidate.specificity, current.specificity)
  if (diff !== 0) return diff > 0
  return candidate.order >= current.order
}

function cascadeWinner(rules) {
  let best = null
  const list = rules == null ? [] : rules
  for (let i = 0; i < list.length; i++) {
    const next = normalizeRule(list[i], i)
    if (best === null || beats(next, best)) best = next
  }
  return best
}

const num = (v) => {
  const n = Number(v == null ? 0 : v)
  return Number.isFinite(n) ? n : 0
}

/**
 * boxSize(style) -> { boxSizing, contentWidth, borderBoxWidth, marginBoxWidth }
 * 简化：只支持 px 单值（等价于四边相同），不处理百分比 / auto / margin 折叠
 */
function boxSize(style) {
  const s = style == null ? {} : style
  const width = num(s.width)
  const padding = num(s.padding)
  const border = num(s.border)
  const margin = num(s.margin)
  const boxSizing = s.boxSizing === 'border-box' ? 'border-box' : 'content-box'

  let contentWidth
  let borderBoxWidth

  if (boxSizing === 'border-box') {
    borderBoxWidth = width
    contentWidth = Math.max(0, width - 2 * padding - 2 * border)
  } else {
    contentWidth = width
    borderBoxWidth = width + 2 * padding + 2 * border
  }

  return {
    boxSizing: boxSizing,
    contentWidth: contentWidth,
    borderBoxWidth: borderBoxWidth,
    marginBoxWidth: borderBoxWidth + 2 * margin
  }
}

const BFC_DISPLAY = ['flow-root', 'inline-block', 'table-cell', 'table-caption', 'flex', 'inline-flex', 'grid', 'inline-grid']
const BFC_CONTAIN = ['layout', 'paint', 'strict', 'content']

/**
 * establishesBFC(style) -> boolean
 * 判断这块盒子是否建立 BFC：它不是某个属性，而是一组声明的副作用
 */
function establishesBFC(style) {
  const s = style == null ? {} : style

  if (s.float && s.float !== 'none') return true
  if (s.position === 'absolute' || s.position === 'fixed') return true
  if (BFC_DISPLAY.indexOf(String(s.display == null ? '' : s.display)) >= 0) return true
  if (s.overflow && s.overflow !== 'visible') return true

  const contain = String(s.contain == null ? '' : s.contain).split(' ').filter(Boolean)
  for (let i = 0; i < contain.length; i++) {
    if (BFC_CONTAIN.indexOf(contain[i]) >= 0) return true
  }

  return false
}`,
      test: L1S3,
      diag: [
        'content-box 分支把 padding 也加进了内容宽度，或者忘了 border 是两边（2 * border）。',
        'border-box 分支的减号方向写错，或者把 width 直接当成了内容宽度。',
        'margin 参与进了 borderBoxWidth；margin 只影响 margin box，不影响盒子的宽度。',
        '没有对内容宽度做 Math.max(0, ...)，padding 吃满声明宽度时算出了负数。',
        'BFC 判断漏了 float 或 overflow 分支；注意 float: none 不能算触发。',
        'display 白名单漏了 flow-root / flex，或者把 sticky 误判成建立 BFC。'
      ]
    }
  ],
  skeleton: `function specificity(selector) {
  throw new Error('specificity 还没实现')
}

function cascadeWinner(rules) {
  throw new Error('cascadeWinner 还没实现')
}

function boxSize(style) {
  throw new Error('boxSize 还没实现')
}

function establishesBFC(style) {
  throw new Error('establishesBFC 还没实现')
}`,
  solution: `function isNameChar(ch) {
  if (!ch) return false
  const code = ch.charCodeAt(0)
  return (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || (code >= 48 && code <= 57) || ch === '-' || ch === '_'
}

function specificity(selector) {
  const s = String(selector == null ? '' : selector).trim()
  let a = 0
  let b = 0
  let c = 0
  let i = 0

  while (i < s.length) {
    const ch = s[i]

    if (ch === '#') {
      let j = i + 1
      while (isNameChar(s[j])) j++
      if (j > i + 1) a += 1
      i = j
    } else if (ch === '.') {
      let j = i + 1
      while (isNameChar(s[j])) j++
      if (j > i + 1) b += 1
      i = j
    } else if (ch === '[') {
      let j = i + 1
      while (j < s.length && s[j] !== ']') j++
      b += 1
      i = j + 1
    } else if (ch === ':') {
      if (s[i + 1] === ':') {
        let j = i + 2
        while (isNameChar(s[j])) j++
        c += 1
        i = j
      } else {
        let j = i + 1
        while (isNameChar(s[j])) j++
        b += 1
        if (s[j] === '(') {
          let depth = 1
          j += 1
          while (j < s.length && depth > 0) {
            if (s[j] === '(') depth++
            else if (s[j] === ')') depth--
            j++
          }
        }
        i = j
      }
    } else if (isNameChar(ch)) {
      let j = i
      while (isNameChar(s[j])) j++
      c += 1
      i = j
    } else {
      i++
    }
  }

  return [a, b, c]
}

function compareSpecificity(x, y) {
  for (let k = 0; k < 3; k++) {
    const d = (x[k] || 0) - (y[k] || 0)
    if (d !== 0) return d
  }
  return 0
}

function normalizeRule(rule, index) {
  const inline = rule && rule.inline === true
  return {
    selector: String((rule && rule.selector) || '(inline)'),
    value: rule ? rule.value : undefined,
    important: !!(rule && rule.important),
    inline: inline,
    specificity: inline ? [1, 0, 0] : specificity((rule && rule.selector) || '*'),
    order: rule && rule.order != null ? rule.order : index
  }
}

function beats(candidate, current) {
  if (candidate.important !== current.important) return candidate.important
  if (candidate.inline !== current.inline) return candidate.inline
  const diff = compareSpecificity(candidate.specificity, current.specificity)
  if (diff !== 0) return diff > 0
  return candidate.order >= current.order
}

function cascadeWinner(rules) {
  let best = null
  const list = rules == null ? [] : rules
  for (let i = 0; i < list.length; i++) {
    const next = normalizeRule(list[i], i)
    if (best === null || beats(next, best)) best = next
  }
  return best
}

const num = (v) => {
  const n = Number(v == null ? 0 : v)
  return Number.isFinite(n) ? n : 0
}

function boxSize(style) {
  const s = style == null ? {} : style
  const width = num(s.width)
  const padding = num(s.padding)
  const border = num(s.border)
  const margin = num(s.margin)
  const boxSizing = s.boxSizing === 'border-box' ? 'border-box' : 'content-box'

  let contentWidth
  let borderBoxWidth

  if (boxSizing === 'border-box') {
    borderBoxWidth = width
    contentWidth = Math.max(0, width - 2 * padding - 2 * border)
  } else {
    contentWidth = width
    borderBoxWidth = width + 2 * padding + 2 * border
  }

  return {
    boxSizing: boxSizing,
    contentWidth: contentWidth,
    borderBoxWidth: borderBoxWidth,
    marginBoxWidth: borderBoxWidth + 2 * margin
  }
}

const BFC_DISPLAY = ['flow-root', 'inline-block', 'table-cell', 'table-caption', 'flex', 'inline-flex', 'grid', 'inline-grid']
const BFC_CONTAIN = ['layout', 'paint', 'strict', 'content']

function establishesBFC(style) {
  const s = style == null ? {} : style

  if (s.float && s.float !== 'none') return true
  if (s.position === 'absolute' || s.position === 'fixed') return true
  if (BFC_DISPLAY.indexOf(String(s.display == null ? '' : s.display)) >= 0) return true
  if (s.overflow && s.overflow !== 'visible') return true

  const contain = String(s.contain == null ? '' : s.contain).split(' ').filter(Boolean)
  for (let i = 0; i < contain.length; i++) {
    if (BFC_CONTAIN.indexOf(contain[i]) >= 0) return true
  }

  return false
}`,
  finalCode: `function isNameChar(ch) {
  if (!ch) return false
  const code = ch.charCodeAt(0)
  return (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || (code >= 48 && code <= 57) || ch === '-' || ch === '_'
}

function specificity(selector) {
  const s = String(selector == null ? '' : selector).trim()
  let a = 0
  let b = 0
  let c = 0
  let i = 0

  while (i < s.length) {
    const ch = s[i]

    if (ch === '#') {
      let j = i + 1
      while (isNameChar(s[j])) j++
      if (j > i + 1) a += 1
      i = j
    } else if (ch === '.') {
      let j = i + 1
      while (isNameChar(s[j])) j++
      if (j > i + 1) b += 1
      i = j
    } else if (ch === '[') {
      let j = i + 1
      while (j < s.length && s[j] !== ']') j++
      b += 1
      i = j + 1
    } else if (ch === ':') {
      if (s[i + 1] === ':') {
        let j = i + 2
        while (isNameChar(s[j])) j++
        c += 1
        i = j
      } else {
        let j = i + 1
        while (isNameChar(s[j])) j++
        b += 1
        if (s[j] === '(') {
          let depth = 1
          j += 1
          while (j < s.length && depth > 0) {
            if (s[j] === '(') depth++
            else if (s[j] === ')') depth--
            j++
          }
        }
        i = j
      }
    } else if (isNameChar(ch)) {
      let j = i
      while (isNameChar(s[j])) j++
      c += 1
      i = j
    } else {
      i++
    }
  }

  return [a, b, c]
}

function compareSpecificity(x, y) {
  for (let k = 0; k < 3; k++) {
    const d = (x[k] || 0) - (y[k] || 0)
    if (d !== 0) return d
  }
  return 0
}

function normalizeRule(rule, index) {
  const inline = rule && rule.inline === true
  return {
    selector: String((rule && rule.selector) || '(inline)'),
    value: rule ? rule.value : undefined,
    important: !!(rule && rule.important),
    inline: inline,
    specificity: inline ? [1, 0, 0] : specificity((rule && rule.selector) || '*'),
    order: rule && rule.order != null ? rule.order : index
  }
}

function beats(candidate, current) {
  if (candidate.important !== current.important) return candidate.important
  if (candidate.inline !== current.inline) return candidate.inline
  const diff = compareSpecificity(candidate.specificity, current.specificity)
  if (diff !== 0) return diff > 0
  return candidate.order >= current.order
}

function cascadeWinner(rules) {
  let best = null
  const list = rules == null ? [] : rules
  for (let i = 0; i < list.length; i++) {
    const next = normalizeRule(list[i], i)
    if (best === null || beats(next, best)) best = next
  }
  return best
}

const num = (v) => {
  const n = Number(v == null ? 0 : v)
  return Number.isFinite(n) ? n : 0
}

function boxSize(style) {
  const s = style == null ? {} : style
  const width = num(s.width)
  const padding = num(s.padding)
  const border = num(s.border)
  const margin = num(s.margin)
  const boxSizing = s.boxSizing === 'border-box' ? 'border-box' : 'content-box'

  let contentWidth
  let borderBoxWidth

  if (boxSizing === 'border-box') {
    borderBoxWidth = width
    contentWidth = Math.max(0, width - 2 * padding - 2 * border)
  } else {
    contentWidth = width
    borderBoxWidth = width + 2 * padding + 2 * border
  }

  return {
    boxSizing: boxSizing,
    contentWidth: contentWidth,
    borderBoxWidth: borderBoxWidth,
    marginBoxWidth: borderBoxWidth + 2 * margin
  }
}

const BFC_DISPLAY = ['flow-root', 'inline-block', 'table-cell', 'table-caption', 'flex', 'inline-flex', 'grid', 'inline-grid']
const BFC_CONTAIN = ['layout', 'paint', 'strict', 'content']

function establishesBFC(style) {
  const s = style == null ? {} : style

  if (s.float && s.float !== 'none') return true
  if (s.position === 'absolute' || s.position === 'fixed') return true
  if (BFC_DISPLAY.indexOf(String(s.display == null ? '' : s.display)) >= 0) return true
  if (s.overflow && s.overflow !== 'visible') return true

  const contain = String(s.contain == null ? '' : s.contain).split(' ').filter(Boolean)
  for (let i = 0; i < contain.length; i++) {
    if (BFC_CONTAIN.indexOf(contain[i]) >= 0) return true
  }

  return false
}`,
  tests: `${L1S1}

${L1S2}

${L1S3}`
}

/* ============================================================ 第 2 关测试 */

const L2S1 = `{
  check('没有弹性系数时各占自己的 basis，gap 从容器里先扣', () => {
    const out = solveFlex([
      { id: 'a', basis: 100 },
      { id: 'b', basis: 100 },
      { id: 'c', basis: 100 }
    ], { mainSize: 600, gap: 10 })
    same(out.map((it) => it.mainSize), [100, 100, 100])
  })
  check('basis 为 0 时按 flex-grow 比例分配剩余空间', () => {
    const out = solveFlex([
      { id: 'a', basis: 0, grow: 1 },
      { id: 'b', basis: 0, grow: 2 },
      { id: 'c', basis: 0, grow: 1 }
    ], { mainSize: 400 })
    same(out.map((it) => it.mainSize), [100, 200, 100])
  })
  check('溢出时按 flex-shrink × basis 加权收缩', () => {
    const out = solveFlex([
      { id: 'a', basis: 200, shrink: 1 },
      { id: 'b', basis: 100, shrink: 1 }
    ], { mainSize: 200 })
    same(out.map((it) => it.mainSize), [133.33, 66.67])
  })
  check('增长碰到 max 就冻结，剩下的空间再分给没到上限的项', () => {
    const out = solveFlex([
      { id: 'a', basis: 100, grow: 1 },
      { id: 'b', basis: 100, grow: 1, max: 150 }
    ], { mainSize: 400 })
    same(out.map((it) => it.mainSize), [250, 150])
  })
  check('收缩碰到 min 就冻结，其余项继续让出空间', () => {
    const out = solveFlex([
      { id: 'a', basis: 100, shrink: 1, min: 60 },
      { id: 'b', basis: 100, shrink: 1 }
    ], { mainSize: 100 })
    same(out.map((it) => it.mainSize), [60, 40])
  })
  check('空间被 gap 吃光时收缩到 0，不会出现负数', () => {
    const out = solveFlex([
      { id: 'a', basis: 100 },
      { id: 'b', basis: 100 }
    ], { mainSize: 10, gap: 20 })
    same(out.map((it) => it.mainSize), [0, 0])
  })
}`

const L2S2 = `{
  check('纯 fr 轨道按比例分整行宽度', () => {
    same(solveGrid({ width: 900, columns: [{ unit: 'fr', value: 1 }, { unit: 'fr', value: 2 }] }), [300, 600])
  })
  check('固定轨道先扣掉，fr 分剩下的空间', () => {
    same(solveGrid({ width: 900, columns: [
      { unit: 'px', value: 200 },
      { unit: 'fr', value: 1 },
      { unit: 'fr', value: 1 }
    ] }), [200, 350, 350])
  })
  check('gap 先扣再分，不参与 fr 的比例计算', () => {
    same(solveGrid({ width: 620, gap: 10, columns: [
      { unit: 'fr', value: 1 },
      { unit: 'fr', value: 1 }
    ] }), [305, 305])
  })
  check('minmax 的下限顶住轨道，空档退给其他轨道', () => {
    same(solveGrid({ width: 400, columns: [
      { unit: 'minmax', min: 300, fr: 1 },
      { unit: 'fr', value: 1 }
    ] }), [300, 100])
  })
  check('auto-fit 先按可用宽度算列数，再等分成 fr', () => {
    same(solveGrid({ width: 900, gap: 10, columns: [{ unit: 'auto-fit', min: 200 }] }), [217.5, 217.5, 217.5, 217.5])
  })
  check('容器比最小列宽还窄时仍留一列并守住下限（允许溢出）', () => {
    same(solveGrid({ width: 100, gap: 10, columns: [{ unit: 'auto-fit', min: 200 }] }), [200])
  })
}`

const L2S3 = `{
  check('absolute 找最近的非 static 祖先', () => {
    same(containingBlock('absolute', [{ position: 'static' }, { position: 'relative' }]), 1)
    same(containingBlock('absolute', [{ position: 'relative' }]), 0)
  })
  check('fixed 默认相对视口，遇到 transform 祖先才改参照', () => {
    same(containingBlock('fixed', [{ position: 'relative' }, { position: 'absolute' }]), -1)
    same(containingBlock('fixed', [{ position: 'static', transform: 'translateX(10px)' }]), 0)
  })
  check('sticky 的参照物是最近的滚动容器', () => {
    same(containingBlock('sticky', [{ position: 'static', overflow: 'auto' }]), 0)
    same(containingBlock('sticky', [{ position: 'relative' }]), -1)
  })
  check('static 与 relative 都不脱标，交给正常流父元素布局', () => {
    same(containingBlock('static', [{ position: 'relative' }]), -1)
    same(containingBlock('relative', [{ position: 'relative' }]), -1)
  })
  check('媒体查询的 and / or 与媒体类型都要参与判断', () => {
    const vp = { width: 900, height: 800 }
    same(matchesMedia('screen and (min-width: 768px) and (max-width: 1023px)', vp), true)
    same(matchesMedia('screen and (min-width: 768px) and (max-width: 1023px)', { width: 1200, height: 800 }), false)
    same(matchesMedia('screen and (min-width: 768px)', { width: 600, height: 800 }), false)
    same(matchesMedia('print and (min-width: 768px)', vp), false)
    same(matchesMedia('(max-width: 600px) or (min-width: 1200px)', { width: 1300, height: 800 }), true)
    same(matchesMedia('(max-width: 600px) or (min-width: 1200px)', { width: 800, height: 800 }), false)
  })
  check('断点序列取命中的最后一个，与书写顺序无关', () => {
    const bps = [
      { name: 'lg', min: 1024 },
      { name: 'base', min: 0 },
      { name: 'md', min: 768 }
    ]
    same(pickBreakpoint(1000, bps), 'md')
    same(pickBreakpoint(500, bps), 'base')
    same(pickBreakpoint(2000, bps), 'lg')
  })
}`

/* ============================================================ 第 2 关：布局求解器 */

const LV2 = {
  id: 'lv2',
  title: '布局求解器：主轴、轨道与参照物',
  emoji: '📐',
  xp: 50,
  goal: '实现 solveFlex / solveGrid / containingBlock / matchesMedia / pickBreakpoint：按 flex 的 basis-grow-shrink 与 min/max 夹取算主轴尺寸、按 px/fr/minmax/auto-fit 算网格轨道、判断绝对/固定/粘性定位的参照物、匹配媒体查询与断点。',
  why: '布局是 CSS 里唯一「写错就一定看得见」的部分，也是面试官最喜欢让你「手算一下」的部分：`flex: 1` 和 `width: 200px` 混排时为什么窄的那个不缩？`repeat(auto-fit, minmax(200px, 1fr))` 到底出几列？`position: fixed` 什么时候不相对视口？这些问题靠试出来是运气，靠算出来才是能力。把分配算法写成函数，你就会发现它们全部是「先扣固定量、再按比例分、碰到上下限就冻结重分」这一条主线，只是参数不同。',
  nodes: [
    'fe.css.layout',
    'fe.css.layout.flex',
    'fe.css.layout.grid',
    'fe.css.layout.position',
    'fe.css.responsive',
    'fe.css.responsive.media-query'
  ],
  thinking: [
    {
      title: '把所有布局问题都看成「一条轴上的空间分配」',
      md: 'Flex 主轴、Grid 的 fr 轨道、甚至 auto-fit 的列数计算，本质都是同一件事：容器给了一笔总宽，先扣掉固定开销（gap、固定轨道、basis），把剩下的按权重分下去，碰到 min/max 就冻结、再分剩余。\n\n所以我第二步不是另起一套 Grid 实现，而是把第一步 flex 的「分配 + 夹取」循环照抄一遍，只换权重公式：flex 增长用 `grow`，收缩用 `shrink × basis`；grid 用 `fr`，下限用 `minmax` 的 min。**这也是真实引擎的做法**——它们共用同一个「可用空间分配」抽象，只是属性名不同。'
    },
    {
      title: '收缩为什么按 shrink × basis 加权，而不是平均分',
      md: '如果按平均分，一个 400px 的项和一个 100px 的项各自让出同样多的空间，结果是小项先被压扁到 0、大项还绰绰有余——这不符合直觉，也会让「控制某个项缩放速度」失去手段。\n\n真实规范按 `flex-shrink × flex-basis` 加权：basis 越大让得越多，比例大致保持不变。这也是为什么给某个项写 `flex-shrink: 0` 就能让它「一点不让」，而 `flex: 1` 的默认 shrink 是 1。本关的 `solveFlex` 把这条规则直接写进权重里，测试专门用 200/100 这一对验证收缩后的 133.33/66.67。'
    },
    {
      title: '定位、媒体查询、断点：三个「参照物」问题',
      md: '这一步看起来是三件事，其实是同一个问题：**相对于谁**。absolute 相对于最近的非 static 祖先，fixed 相对于视口（除非祖先有 transform/filter/perspective/contain，此时相对那个祖先），sticky 相对于最近的滚动容器；媒体查询相对于视口尺寸，断点序列取「命中的最后一个」。\n\n所以我用一个统一的循环去「从近到远找第一个满足条件的祖先」，`containingBlock` 返回的是索引，`-1` 表示视口/正常流。这种「返回索引而不是对象」的约定很好用：调用方可以自己决定拿这个祖先干什么，测试也只需要比数字。'
    }
  ],
  prereq: [
    {
      title: '主轴、交叉轴与 flex 的三个系数',
      md: '`flex-direction: row` 时主轴是水平方向，`justify-content` 作用于主轴、`align-items` 作用于交叉轴；换成 `column` 两者互换。这是「主轴」这个词唯一需要记住的事。\n\n`flex-grow` 决定**有剩余空间时**怎么分，`flex-shrink` 决定**溢出时**怎么让，`flex-basis` 是分配前的基础尺寸（`auto` 时取 width）。`flex: 1` 展开是 `1 1 0%`——注意基数是 0，所以它的起点比 `width: 200px` 的项低得多，混排时显得「更愿意长」。'
    },
    {
      title: 'fr 不是百分比，minmax 与 auto-fit 各自解决什么',
      md: '`1fr` 的意思是「分掉固定轨道与 gap 之后的剩余空间」，所以 `200px 1fr 1fr` 在 900px 容器里是 200/350/350，而不是 200/300/400。百分比则是相对容器宽度的，会跟 padding 打架——这是 fr 更适合做栅格的原因。\n\n`minmax(300px, 1fr)` 给弹性轨道加了下限：空间不够时轨道不会被压到 300 以下，代价是别的轨道要让位。`repeat(auto-fit, minmax(200px, 1fr))` 先算「这一行最多放几列」= `floor((容器 + gap) / (最小列 + gap))`，再把这几个列等分——这就是响应式卡片墙不用写断点的原因。'
    },
    {
      title: '定位的五种取值与「脱标」',
      md: '`static` 是默认，`relative` 相对自身原位偏移但不脱标（原位置仍然占着），`absolute` 脱标、相对最近的非 static 祖先定位，`fixed` 脱标、相对视口定位，`sticky` 在滚动到阈值前是 relative、之后是 fixed 的行为。\n\n高频追问是「为什么我的 fixed 不相对视口了」：祖先元素上有 `transform` / `filter` / `perspective` / `contain` 时，它会成为 fixed 的包含块——动画库给容器加个 `transform` 就经常触发这个坑。另一个坑是 sticky 不生效：它需要最近的滚动祖先，且祖先不能是 `overflow: hidden`（那会让它没有可滚动的容器）。'
    }
  ],
  api: [
    {
      name: 'solveFlex',
      sig: 'solveFlex(items, container) => [{ id, mainSize }]',
      args: 'container 为 { mainSize, gap? }；items 每项为 { id, basis?, grow?=0, shrink?=1, min?=0, max?=Infinity }。只算单行、水平主轴，padding/border 请由调用方折进 mainSize。',
      returns: '每一项分配后的主轴尺寸，保留两位小数。空间不足且已到 min 时收缩到 0，不会出现负数。',
      example: "same(solveFlex([\n  { id: 'a', basis: 0, grow: 1 },\n  { id: 'b', basis: 0, grow: 3 }\n], { mainSize: 400 }).map((it) => it.mainSize), [100, 300])"
    },
    {
      name: 'solveGrid',
      sig: 'solveGrid({ width, gap?, columns }) => number[]',
      args: 'columns 里每项是 { unit: "px", value } | { unit: "fr", value?=1 } | { unit: "minmax", min, fr?=1 } | { unit: "auto-fit", min }。auto-fit 先算列数再按等分 fr 处理。',
      returns: '每条轨道的宽度数组（顺序与 columns 一致，auto-fit 会展开成多列），保留两位小数。',
      example: "same(solveGrid({ width: 900, columns: [\n  { unit: 'px', value: 200 },\n  { unit: 'fr', value: 1 },\n  { unit: 'fr', value: 1 }\n] }), [200, 350, 350])"
    },
    {
      name: 'containingBlock',
      sig: "containingBlock(position, ancestors) => number",
      args: 'position 是 static/relative/absolute/fixed/sticky；ancestors 是「从最近的父元素到最外层」的数组，每项可含 position/overflow/transform/filter/perspective/contain。',
      returns: '作为包含块的祖先下标；返回 -1 表示视口或正常流（static/relative）。',
      example: "same(containingBlock('absolute', [{ position: 'static' }, { position: 'relative' }]), 1)\nsame(containingBlock('fixed', [{ position: 'relative' }]), -1)"
    },
    {
      name: 'matchesMedia',
      sig: 'matchesMedia(query, viewport) => boolean',
      args: 'query 形如 "(min-width: 768px) and (max-width: 1023px)"、"screen and (...)"、"(max-width: 600px) or (min-width: 1200px)"；viewport 为 { width, height }。',
      returns: '整条查询是否匹配。本实现只解析 width/height 的 min/max 与 orientation，未知特性一律视为不匹配。',
      example: "same(matchesMedia('screen and (min-width: 768px)', { width: 900, height: 800 }), true)"
    },
    {
      name: 'pickBreakpoint',
      sig: 'pickBreakpoint(width, breakpoints) => string | null',
      args: 'breakpoints 每项为 { name, min }，数组顺序无所谓——内部按 min 升序排。',
      returns: 'width 命中的最小断点集合里「min 最大」的那个 name；一个都不命中返回 null。',
      example: "same(pickBreakpoint(1000, [{ name: 'base', min: 0 }, { name: 'md', min: 768 }, { name: 'lg', min: 1024 }]), 'md')"
    }
  ],
  usage: "// 1) 手算一行「侧栏 + 主区」的分配\nconst row = solveFlex([\n  { id: 'aside', basis: 240, grow: 0, shrink: 0 },\n  { id: 'main', basis: 0, grow: 1 }\n], { mainSize: 1200, gap: 16 })\nconsole.log(row)   // [{ id: 'aside', mainSize: 240 }, { id: 'main', mainSize: 944 }]\n\n// 2) 卡片墙：不写断点的响应式\nconst tracks = solveGrid({ width: 900, gap: 10, columns: [{ unit: 'auto-fit', min: 200 }] })\nconsole.log(tracks.length)   // 4\n\n// 3) 排查「fixed 不跟视口走」\nconst idx = containingBlock('fixed', [\n  { position: 'static' },\n  { position: 'static', transform: 'translateZ(0)' }\n])\nconsole.log(idx)             // 1：第二层祖先成了包含块\n\n// 4) 视口 1000px 命中哪个断点\nconsole.log(pickBreakpoint(1000, [{ name: 'base', min: 0 }, { name: 'md', min: 768 }, { name: 'lg', min: 1024 }]))   // 'md'",
  hints: [
    '第一步先写「算剩余空间」的一行：容器宽 - gap*(n-1) - Σbasis。正数走 grow、负数走 shrink，两边的循环结构是一样的。',
    '第二步把 flex 的循环抄过来，只换权重：grid 用 fr，下限用 minmax.min；auto-fit 先在展开阶段把一条定义变成 N 条等分轨道。',
    '第三步三个函数都很短：containingBlock 是从近到远找「第一个让这个 position 认它为参照物」的祖先，matchesMedia 按 or 切子句、按 and 切条件，pickBreakpoint 排序后取最后一个命中。'
  ],
  concepts: [
    {
      title: '为什么真实引擎要用「冻结-重分」循环',
      md: '理想情况下一次比例分配就能解决，但 min/max 会打破线性关系：某个项被上限顶住之后，它「少拿」的那部分必须还给其他项，而其他项里可能又有被下限顶住的——所以要循环到没有人再被夹住为止。\n\nCSS 规范的 flex 解析算法里也是这个结构（resolve flexible lengths 的 freeze 循环），网格的 fr 分配同理。本关每一轮只冻结「碰到边界」的项，并在下一轮把它们排除在权重分母之外，最多跑 n+1 轮就收敛，所以不会死循环。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '先分配主轴：basis、grow、shrink',
      think: '先把「一笔空间怎么按权重分下去」这条主线跑通。不处理 min/max 也能覆盖大多数场景，所以第 1 步只做纯比例分配加 gap——但一定先用 200/100 这一对验证收缩的加权方式，否则后面加夹取时会觉得「怎么比例不对」。',
      hint: '先算 spare = mainSize - gap*(n-1) - Σbasis；spare>0 用 grow 做权重，spare<0 用 shrink*basis 做权重，循环里把「已经碰到 min/max」的项冻结。',
      vocab: [
        { term: 'flex-basis', desc: '分配前的基础尺寸，auto 时回落到 width；flex: 1 展开为 1 1 0%' },
        { term: 'freeze', desc: '冻结：某一项已经碰到 min/max，后续轮次不再参与分配，把它让出的空间给别人' }
      ],
      code: `const round2 = (n) => Math.round(n * 100) / 100

/**
 * solveFlex(items, container) -> [{ id, mainSize }]
 * 简化：只算单行、水平主轴；容器 padding/border 请由调用方折进 mainSize
 */
function solveFlex(items, container) {
  const box = container == null ? {} : container
  const gap = box.gap == null ? 0 : box.gap
  const mainSize = box.mainSize == null ? 0 : box.mainSize
  const list = (items == null ? [] : items).map((it) => ({
    id: it.id,
    basis: it.basis == null ? 0 : it.basis,
    grow: it.grow == null ? 0 : it.grow,
    shrink: it.shrink == null ? 1 : it.shrink,
    min: it.min == null ? 0 : it.min,
    max: it.max == null ? Infinity : it.max
  }))

  const n = list.length
  const gaps = gap * Math.max(0, n - 1)
  const basisTotal = list.reduce((sum, it) => sum + it.basis, 0)
  let spare = mainSize - gaps - basisTotal

  const sizes = list.map((it) => it.basis)
  const frozen = list.map(() => false)

  // 最多 n+1 轮：每轮按权重分一次，碰到 min/max 的冻结，剩下的下一轮再分
  for (let pass = 0; pass <= n && Math.abs(spare) > 0.001; pass++) {
    const open = []
    for (let i = 0; i < n; i++) if (!frozen[i]) open.push(i)
    if (open.length === 0) break

    let total = 0
    for (const i of open) {
      total += spare > 0 ? list[i].grow : list[i].shrink * list[i].basis
    }
    if (total <= 0) break

    let delivered = 0
    for (const i of open) {
      const weight = spare > 0 ? list[i].grow : list[i].shrink * list[i].basis
      const share = spare * (weight / total)
      let next = sizes[i] + share
      if (next > list[i].max) next = list[i].max
      if (next < list[i].min) next = list[i].min
      delivered += next - sizes[i]
      sizes[i] = next
      if (next === list[i].max || next === list[i].min) frozen[i] = true
    }
    spare -= delivered
    if (Math.abs(delivered) < 0.001) break
  }

  return list.map((it, i) => ({ id: it.id, mainSize: round2(sizes[i]) }))
}`,
      test: L2S1,
      diag: [
        'forgot 先扣 gap 与 Σbasis 就直接分：spare 应等于 mainSize - gap*(n-1) - Σbasis。',
        'grow 权重用了固定值或平均分，没有按每项的 grow 占比算 share。',
        'shrink 权重用了 grow 或平均分；溢出收缩要按 shrink × basis 加权。',
        '碰到 max 后没有冻结，导致下一轮又把空间分回给它、其他项没拿到。',
        '碰到 min 后没有冻结，或者冻结了却没把「少让出的部分」重新分配。',
        '没有把尺寸夹到 min（默认 0），负空间一路穿透算出了负数。'
      ]
    },
    {
      n: 2,
      title: '换成网格：fr、minmax 与 auto-fit',
      think: 'Grid 的 fr 分配与 flex 的剩余空间分配是同一个循环，所以这一步不改第一步的骨架，只加一个「展开轨道定义 + 换成 fr 权重」的新函数。真正的难点在 auto-fit：它要求在分配之前先算列数，属于「展开」阶段而不是「分配」阶段。',
      hint: '先把 px / fr / minmax / auto-fit 四种定义展开成统一的内部轨道（px 记死尺寸，其余记 fr 与下限）；再扣掉固定轨道与 gap，剩下的按 fr 分，下限顶住就冻结重分。',
      code: `const round2 = (n) => Math.round(n * 100) / 100

function solveFlex(items, container) {
  const box = container == null ? {} : container
  const gap = box.gap == null ? 0 : box.gap
  const mainSize = box.mainSize == null ? 0 : box.mainSize
  const list = (items == null ? [] : items).map((it) => ({
    id: it.id,
    basis: it.basis == null ? 0 : it.basis,
    grow: it.grow == null ? 0 : it.grow,
    shrink: it.shrink == null ? 1 : it.shrink,
    min: it.min == null ? 0 : it.min,
    max: it.max == null ? Infinity : it.max
  }))

  const n = list.length
  const gaps = gap * Math.max(0, n - 1)
  const basisTotal = list.reduce((sum, it) => sum + it.basis, 0)
  let spare = mainSize - gaps - basisTotal

  const sizes = list.map((it) => it.basis)
  const frozen = list.map(() => false)

  for (let pass = 0; pass <= n && Math.abs(spare) > 0.001; pass++) {
    const open = []
    for (let i = 0; i < n; i++) if (!frozen[i]) open.push(i)
    if (open.length === 0) break

    let total = 0
    for (const i of open) {
      total += spare > 0 ? list[i].grow : list[i].shrink * list[i].basis
    }
    if (total <= 0) break

    let delivered = 0
    for (const i of open) {
      const weight = spare > 0 ? list[i].grow : list[i].shrink * list[i].basis
      const share = spare * (weight / total)
      let next = sizes[i] + share
      if (next > list[i].max) next = list[i].max
      if (next < list[i].min) next = list[i].min
      delivered += next - sizes[i]
      sizes[i] = next
      if (next === list[i].max || next === list[i].min) frozen[i] = true
    }
    spare -= delivered
    if (Math.abs(delivered) < 0.001) break
  }

  return list.map((it, i) => ({ id: it.id, mainSize: round2(sizes[i]) }))
}

/**
 * solveGrid({ width, gap, columns }) -> number[]
 * 简化：单行轨道，不处理 grid-template-areas / span / 隐式轨道
 */
function solveGrid(config) {
  const cfg = config == null ? {} : config
  const width = cfg.width == null ? 0 : cfg.width
  const gap = cfg.gap == null ? 0 : cfg.gap
  const defs = cfg.columns == null ? [] : cfg.columns

  // 阶段一：展开定义 —— auto-fit 要在这里先算出「这一行能放几列」
  const tracks = []
  for (const def of defs) {
    const d = def == null ? {} : def
    const unit = d.unit == null ? 'fr' : d.unit
    if (unit === 'auto-fit') {
      const min = d.min == null ? 0 : d.min
      const count = Math.max(1, Math.floor((width + gap) / (min + gap)))
      for (let i = 0; i < count; i++) tracks.push({ px: null, fr: 1, floor: min })
    } else if (unit === 'minmax') {
      tracks.push({ px: null, fr: d.fr == null ? 1 : d.fr, floor: d.min == null ? 0 : d.min })
    } else if (unit === 'fr') {
      tracks.push({ px: null, fr: d.value == null ? 1 : d.value, floor: 0 })
    } else {
      tracks.push({ px: d.value == null ? 0 : d.value, fr: 0, floor: 0 })
    }
  }

  // 阶段二：固定轨道与 gap 先扣，剩下的按 fr 分
  let fixed = 0
  let frTotal = 0
  for (const t of tracks) {
    if (t.px != null) fixed += t.px
    else frTotal += t.fr
  }
  let spare = width - gap * Math.max(0, tracks.length - 1) - fixed

  const sizes = tracks.map((t) => (t.px != null ? t.px : 0))
  const frozen = tracks.map((t) => t.px != null || t.fr <= 0)

  for (let pass = 0; pass <= tracks.length && Math.abs(spare) > 0.001; pass++) {
    const open = []
    for (let i = 0; i < tracks.length; i++) if (!frozen[i]) open.push(i)
    if (open.length === 0) break

    let total = 0
    for (const i of open) total += tracks[i].fr
    if (total <= 0) break

    let delivered = 0
    for (const i of open) {
      const share = spare * (tracks[i].fr / total)
      let next = sizes[i] + share
      if (next < tracks[i].floor) next = tracks[i].floor
      if (next < 0) next = 0
      delivered += next - sizes[i]
      sizes[i] = next
      if (next === tracks[i].floor) frozen[i] = true
    }
    spare -= delivered
    if (Math.abs(delivered) < 0.001) break
  }

  return sizes.map((s) => round2(s))
}`,
      test: L2S2,
      diag: [
        'fr 分配用了「容器宽 / fr 总和」而不是「剩余空间 / fr 总和」，固定轨道没有先扣掉。',
        '固定轨道被算进了 fr 的分母，或者 px 轨道还参与了比例分配。',
        'gap 只在最后减掉、没有在分配前扣除，于是 fr 轨道分到了含 gap 的宽度。',
        'minmax 的下限没有夹取，或者夹取后没有把空档退回给其他轨道（少了一轮循环）。',
        'auto-fit 的列数公式写错：应是 floor((width + gap) / (min + gap))，再把这 N 列当等分 fr。',
        'auto-fit 在窄容器里算出 0 列后没有回退到至少 1 列，返回了空数组；列数下限是 1，且这一列仍守住 minmax 的 min（允许溢出容器）。'
      ]
    },
    {
      n: 3,
      title: '参照物与断点：相对谁定位、按多大视口生效',
      think: '前三步都在算长度，这一步换成算「参照物」。它和第 1、2 步没有任何代码依赖，但它是同一类问题的收尾：布局里所有「位置」都必须回答「相对于谁」。断点序列同理——它是「视口这个参照物落在哪一档」的查表。',
      hint: 'containingBlock 从近到远扫祖先，按 position 决定「什么样的祖先算参照物」；matchesMedia 先按 or 切子句再按 and 切条件；pickBreakpoint 排序后取最后一个命中的。',
      vocab: [
        { term: '包含块', desc: 'containing block：绝对/固定定位元素计算 top/left 百分比时的参照矩形' },
        { term: '断点', desc: 'breakpoint：一组 min-width 阈值，超过哪一档就启用对应样式' }
      ],
      code: `const round2 = (n) => Math.round(n * 100) / 100

function solveFlex(items, container) {
  const box = container == null ? {} : container
  const gap = box.gap == null ? 0 : box.gap
  const mainSize = box.mainSize == null ? 0 : box.mainSize
  const list = (items == null ? [] : items).map((it) => ({
    id: it.id,
    basis: it.basis == null ? 0 : it.basis,
    grow: it.grow == null ? 0 : it.grow,
    shrink: it.shrink == null ? 1 : it.shrink,
    min: it.min == null ? 0 : it.min,
    max: it.max == null ? Infinity : it.max
  }))

  const n = list.length
  const gaps = gap * Math.max(0, n - 1)
  const basisTotal = list.reduce((sum, it) => sum + it.basis, 0)
  let spare = mainSize - gaps - basisTotal

  const sizes = list.map((it) => it.basis)
  const frozen = list.map(() => false)

  for (let pass = 0; pass <= n && Math.abs(spare) > 0.001; pass++) {
    const open = []
    for (let i = 0; i < n; i++) if (!frozen[i]) open.push(i)
    if (open.length === 0) break

    let total = 0
    for (const i of open) {
      total += spare > 0 ? list[i].grow : list[i].shrink * list[i].basis
    }
    if (total <= 0) break

    let delivered = 0
    for (const i of open) {
      const weight = spare > 0 ? list[i].grow : list[i].shrink * list[i].basis
      const share = spare * (weight / total)
      let next = sizes[i] + share
      if (next > list[i].max) next = list[i].max
      if (next < list[i].min) next = list[i].min
      delivered += next - sizes[i]
      sizes[i] = next
      if (next === list[i].max || next === list[i].min) frozen[i] = true
    }
    spare -= delivered
    if (Math.abs(delivered) < 0.001) break
  }

  return list.map((it, i) => ({ id: it.id, mainSize: round2(sizes[i]) }))
}

function solveGrid(config) {
  const cfg = config == null ? {} : config
  const width = cfg.width == null ? 0 : cfg.width
  const gap = cfg.gap == null ? 0 : cfg.gap
  const defs = cfg.columns == null ? [] : cfg.columns

  const tracks = []
  for (const def of defs) {
    const d = def == null ? {} : def
    const unit = d.unit == null ? 'fr' : d.unit
    if (unit === 'auto-fit') {
      const min = d.min == null ? 0 : d.min
      const count = Math.max(1, Math.floor((width + gap) / (min + gap)))
      for (let i = 0; i < count; i++) tracks.push({ px: null, fr: 1, floor: min })
    } else if (unit === 'minmax') {
      tracks.push({ px: null, fr: d.fr == null ? 1 : d.fr, floor: d.min == null ? 0 : d.min })
    } else if (unit === 'fr') {
      tracks.push({ px: null, fr: d.value == null ? 1 : d.value, floor: 0 })
    } else {
      tracks.push({ px: d.value == null ? 0 : d.value, fr: 0, floor: 0 })
    }
  }

  let fixed = 0
  let frTotal = 0
  for (const t of tracks) {
    if (t.px != null) fixed += t.px
    else frTotal += t.fr
  }
  let spare = width - gap * Math.max(0, tracks.length - 1) - fixed

  const sizes = tracks.map((t) => (t.px != null ? t.px : 0))
  const frozen = tracks.map((t) => t.px != null || t.fr <= 0)

  for (let pass = 0; pass <= tracks.length && Math.abs(spare) > 0.001; pass++) {
    const open = []
    for (let i = 0; i < tracks.length; i++) if (!frozen[i]) open.push(i)
    if (open.length === 0) break

    let total = 0
    for (const i of open) total += tracks[i].fr
    if (total <= 0) break

    let delivered = 0
    for (const i of open) {
      const share = spare * (tracks[i].fr / total)
      let next = sizes[i] + share
      if (next < tracks[i].floor) next = tracks[i].floor
      if (next < 0) next = 0
      delivered += next - sizes[i]
      sizes[i] = next
      if (next === tracks[i].floor) frozen[i] = true
    }
    spare -= delivered
    if (Math.abs(delivered) < 0.001) break
  }

  return sizes.map((s) => round2(s))
}

/**
 * containingBlock(position, ancestors) -> number
 * 返回作为包含块的祖先下标；-1 表示视口 / 正常流
 * 简化：只看 position / overflow / transform / filter / perspective / contain 这几个声明
 */
function containingBlock(position, ancestors) {
  const list = ancestors == null ? [] : ancestors

  for (let i = 0; i < list.length; i++) {
    const a = list[i] == null ? {} : list[i]
    const notNone = (v) => v != null && v !== 'none'
    const isolated = notNone(a.transform) || notNone(a.filter) || notNone(a.perspective) || notNone(a.contain)
    const positioned = a.position != null && a.position !== 'static'

    if (position === 'fixed') {
      // 视口是默认参照，但如果祖先带 transform/filter/contain，它就变成包含块
      if (isolated) return i
      continue
    }
    if (position === 'absolute') {
      if (positioned || isolated) return i
      continue
    }
    if (position === 'sticky') {
      // 粘性定位的参照物是最近的滚动容器
      if (a.overflow != null && a.overflow !== 'visible') return i
      continue
    }
    // static / relative 不脱标：交给正常流父元素
    return -1
  }

  return -1
}

function matchCondition(text, viewport) {
  const part = String(text == null ? '' : text).trim().toLowerCase()
  if (!part) return true
  if (part[0] !== '(') {
    // 媒体类型：只认 screen / all
    return part === 'screen' || part === 'all'
  }
  const close = part.lastIndexOf(')')
  const inner = (close > 0 ? part.slice(1, close) : part.slice(1)).trim()
  const colon = inner.indexOf(':')
  if (colon < 0) return true   // 布尔特性，例如 (hover)，本实现视为匹配
  const name = inner.slice(0, colon).trim()
  const raw = inner.slice(colon + 1).trim()

  if (name === 'min-width') return viewport.width >= parseFloat(raw)
  if (name === 'max-width') return viewport.width <= parseFloat(raw)
  if (name === 'min-height') return viewport.height >= parseFloat(raw)
  if (name === 'max-height') return viewport.height <= parseFloat(raw)
  if (name === 'orientation') {
    return raw === (viewport.width >= viewport.height ? 'landscape' : 'portrait')
  }
  return false
}

function matchesMedia(query, viewport) {
  const text = String(query == null ? '' : query).trim().toLowerCase()
  const vp = viewport == null ? { width: 0, height: 0 } : viewport
  if (!text) return true

  // 媒体查询列表用 or 连接（规范里逗号也是 or）；子句内部用 and 连接
  const clauses = text.split(' or ')
  for (const clause of clauses) {
    const parts = clause.split(' and ')
    let all = true
    for (const part of parts) {
      if (!matchCondition(part, vp)) {
        all = false
        break
      }
    }
    if (all) return true
  }
  return false
}

/**
 * pickBreakpoint(width, breakpoints) -> string | null
 * 取「min <= width」里 min 最大的那个 —— 与断点书写顺序无关
 */
function pickBreakpoint(width, breakpoints) {
  const list = (breakpoints == null ? [] : breakpoints).slice()
  list.sort((a, b) => (a.min == null ? 0 : a.min) - (b.min == null ? 0 : b.min))

  let picked = null
  for (const bp of list) {
    if (width >= (bp.min == null ? 0 : bp.min)) picked = bp.name
  }
  return picked
}`,
      test: L2S3,
      diag: [
        'absolute 分支没有跳过 static 祖先，或者遇到第一个祖先就返回了。',
        'fixed 分支直接 return -1 而不是 continue，导致更外层带 transform 的祖先没被看到。',
        'sticky 用了 position 而不是 overflow 作为判断条件；粘性定位看的是滚动容器。',
        'static/relative 也走了「找祖先」的逻辑，而它们根本不脱标，应直接返回 -1。',
        '媒体查询只按一种连接词切分：`or` 必须先切子句、再在子句内按 `and` 切条件；媒体类型 print 没有判掉。',
        '断点没有排序，或者用了「第一个命中」而不是「最后一个命中」。'
      ]
    }
  ],
  skeleton: `function solveFlex(items, container) {
  throw new Error('solveFlex 还没实现')
}

function solveGrid(config) {
  throw new Error('solveGrid 还没实现')
}

function containingBlock(position, ancestors) {
  throw new Error('containingBlock 还没实现')
}

function matchesMedia(query, viewport) {
  throw new Error('matchesMedia 还没实现')
}

function pickBreakpoint(width, breakpoints) {
  throw new Error('pickBreakpoint 还没实现')
}`,
  solution: `const round2 = (n) => Math.round(n * 100) / 100

function solveFlex(items, container) {
  const box = container == null ? {} : container
  const gap = box.gap == null ? 0 : box.gap
  const mainSize = box.mainSize == null ? 0 : box.mainSize
  const list = (items == null ? [] : items).map((it) => ({
    id: it.id,
    basis: it.basis == null ? 0 : it.basis,
    grow: it.grow == null ? 0 : it.grow,
    shrink: it.shrink == null ? 1 : it.shrink,
    min: it.min == null ? 0 : it.min,
    max: it.max == null ? Infinity : it.max
  }))

  const n = list.length
  const gaps = gap * Math.max(0, n - 1)
  const basisTotal = list.reduce((sum, it) => sum + it.basis, 0)
  let spare = mainSize - gaps - basisTotal

  const sizes = list.map((it) => it.basis)
  const frozen = list.map(() => false)

  for (let pass = 0; pass <= n && Math.abs(spare) > 0.001; pass++) {
    const open = []
    for (let i = 0; i < n; i++) if (!frozen[i]) open.push(i)
    if (open.length === 0) break

    let total = 0
    for (const i of open) {
      total += spare > 0 ? list[i].grow : list[i].shrink * list[i].basis
    }
    if (total <= 0) break

    let delivered = 0
    for (const i of open) {
      const weight = spare > 0 ? list[i].grow : list[i].shrink * list[i].basis
      const share = spare * (weight / total)
      let next = sizes[i] + share
      if (next > list[i].max) next = list[i].max
      if (next < list[i].min) next = list[i].min
      delivered += next - sizes[i]
      sizes[i] = next
      if (next === list[i].max || next === list[i].min) frozen[i] = true
    }
    spare -= delivered
    if (Math.abs(delivered) < 0.001) break
  }

  return list.map((it, i) => ({ id: it.id, mainSize: round2(sizes[i]) }))
}

function solveGrid(config) {
  const cfg = config == null ? {} : config
  const width = cfg.width == null ? 0 : cfg.width
  const gap = cfg.gap == null ? 0 : cfg.gap
  const defs = cfg.columns == null ? [] : cfg.columns

  const tracks = []
  for (const def of defs) {
    const d = def == null ? {} : def
    const unit = d.unit == null ? 'fr' : d.unit
    if (unit === 'auto-fit') {
      const min = d.min == null ? 0 : d.min
      const count = Math.max(1, Math.floor((width + gap) / (min + gap)))
      for (let i = 0; i < count; i++) tracks.push({ px: null, fr: 1, floor: min })
    } else if (unit === 'minmax') {
      tracks.push({ px: null, fr: d.fr == null ? 1 : d.fr, floor: d.min == null ? 0 : d.min })
    } else if (unit === 'fr') {
      tracks.push({ px: null, fr: d.value == null ? 1 : d.value, floor: 0 })
    } else {
      tracks.push({ px: d.value == null ? 0 : d.value, fr: 0, floor: 0 })
    }
  }

  let fixed = 0
  let frTotal = 0
  for (const t of tracks) {
    if (t.px != null) fixed += t.px
    else frTotal += t.fr
  }
  let spare = width - gap * Math.max(0, tracks.length - 1) - fixed

  const sizes = tracks.map((t) => (t.px != null ? t.px : 0))
  const frozen = tracks.map((t) => t.px != null || t.fr <= 0)

  for (let pass = 0; pass <= tracks.length && Math.abs(spare) > 0.001; pass++) {
    const open = []
    for (let i = 0; i < tracks.length; i++) if (!frozen[i]) open.push(i)
    if (open.length === 0) break

    let total = 0
    for (const i of open) total += tracks[i].fr
    if (total <= 0) break

    let delivered = 0
    for (const i of open) {
      const share = spare * (tracks[i].fr / total)
      let next = sizes[i] + share
      if (next < tracks[i].floor) next = tracks[i].floor
      if (next < 0) next = 0
      delivered += next - sizes[i]
      sizes[i] = next
      if (next === tracks[i].floor) frozen[i] = true
    }
    spare -= delivered
    if (Math.abs(delivered) < 0.001) break
  }

  return sizes.map((s) => round2(s))
}

function containingBlock(position, ancestors) {
  const list = ancestors == null ? [] : ancestors

  for (let i = 0; i < list.length; i++) {
    const a = list[i] == null ? {} : list[i]
    const notNone = (v) => v != null && v !== 'none'
    const isolated = notNone(a.transform) || notNone(a.filter) || notNone(a.perspective) || notNone(a.contain)
    const positioned = a.position != null && a.position !== 'static'

    if (position === 'fixed') {
      if (isolated) return i
      continue
    }
    if (position === 'absolute') {
      if (positioned || isolated) return i
      continue
    }
    if (position === 'sticky') {
      if (a.overflow != null && a.overflow !== 'visible') return i
      continue
    }
    return -1
  }

  return -1
}

function matchCondition(text, viewport) {
  const part = String(text == null ? '' : text).trim().toLowerCase()
  if (!part) return true
  if (part[0] !== '(') {
    return part === 'screen' || part === 'all'
  }
  const close = part.lastIndexOf(')')
  const inner = (close > 0 ? part.slice(1, close) : part.slice(1)).trim()
  const colon = inner.indexOf(':')
  if (colon < 0) return true
  const name = inner.slice(0, colon).trim()
  const raw = inner.slice(colon + 1).trim()

  if (name === 'min-width') return viewport.width >= parseFloat(raw)
  if (name === 'max-width') return viewport.width <= parseFloat(raw)
  if (name === 'min-height') return viewport.height >= parseFloat(raw)
  if (name === 'max-height') return viewport.height <= parseFloat(raw)
  if (name === 'orientation') {
    return raw === (viewport.width >= viewport.height ? 'landscape' : 'portrait')
  }
  return false
}

function matchesMedia(query, viewport) {
  const text = String(query == null ? '' : query).trim().toLowerCase()
  const vp = viewport == null ? { width: 0, height: 0 } : viewport
  if (!text) return true

  const clauses = text.split(' or ')
  for (const clause of clauses) {
    const parts = clause.split(' and ')
    let all = true
    for (const part of parts) {
      if (!matchCondition(part, vp)) {
        all = false
        break
      }
    }
    if (all) return true
  }
  return false
}

function pickBreakpoint(width, breakpoints) {
  const list = (breakpoints == null ? [] : breakpoints).slice()
  list.sort((a, b) => (a.min == null ? 0 : a.min) - (b.min == null ? 0 : b.min))

  let picked = null
  for (const bp of list) {
    if (width >= (bp.min == null ? 0 : bp.min)) picked = bp.name
  }
  return picked
}`,
  finalCode: `const round2 = (n) => Math.round(n * 100) / 100

function solveFlex(items, container) {
  const box = container == null ? {} : container
  const gap = box.gap == null ? 0 : box.gap
  const mainSize = box.mainSize == null ? 0 : box.mainSize
  const list = (items == null ? [] : items).map((it) => ({
    id: it.id,
    basis: it.basis == null ? 0 : it.basis,
    grow: it.grow == null ? 0 : it.grow,
    shrink: it.shrink == null ? 1 : it.shrink,
    min: it.min == null ? 0 : it.min,
    max: it.max == null ? Infinity : it.max
  }))

  const n = list.length
  const gaps = gap * Math.max(0, n - 1)
  const basisTotal = list.reduce((sum, it) => sum + it.basis, 0)
  let spare = mainSize - gaps - basisTotal

  const sizes = list.map((it) => it.basis)
  const frozen = list.map(() => false)

  for (let pass = 0; pass <= n && Math.abs(spare) > 0.001; pass++) {
    const open = []
    for (let i = 0; i < n; i++) if (!frozen[i]) open.push(i)
    if (open.length === 0) break

    let total = 0
    for (const i of open) {
      total += spare > 0 ? list[i].grow : list[i].shrink * list[i].basis
    }
    if (total <= 0) break

    let delivered = 0
    for (const i of open) {
      const weight = spare > 0 ? list[i].grow : list[i].shrink * list[i].basis
      const share = spare * (weight / total)
      let next = sizes[i] + share
      if (next > list[i].max) next = list[i].max
      if (next < list[i].min) next = list[i].min
      delivered += next - sizes[i]
      sizes[i] = next
      if (next === list[i].max || next === list[i].min) frozen[i] = true
    }
    spare -= delivered
    if (Math.abs(delivered) < 0.001) break
  }

  return list.map((it, i) => ({ id: it.id, mainSize: round2(sizes[i]) }))
}

function solveGrid(config) {
  const cfg = config == null ? {} : config
  const width = cfg.width == null ? 0 : cfg.width
  const gap = cfg.gap == null ? 0 : cfg.gap
  const defs = cfg.columns == null ? [] : cfg.columns

  const tracks = []
  for (const def of defs) {
    const d = def == null ? {} : def
    const unit = d.unit == null ? 'fr' : d.unit
    if (unit === 'auto-fit') {
      const min = d.min == null ? 0 : d.min
      const count = Math.max(1, Math.floor((width + gap) / (min + gap)))
      for (let i = 0; i < count; i++) tracks.push({ px: null, fr: 1, floor: min })
    } else if (unit === 'minmax') {
      tracks.push({ px: null, fr: d.fr == null ? 1 : d.fr, floor: d.min == null ? 0 : d.min })
    } else if (unit === 'fr') {
      tracks.push({ px: null, fr: d.value == null ? 1 : d.value, floor: 0 })
    } else {
      tracks.push({ px: d.value == null ? 0 : d.value, fr: 0, floor: 0 })
    }
  }

  let fixed = 0
  let frTotal = 0
  for (const t of tracks) {
    if (t.px != null) fixed += t.px
    else frTotal += t.fr
  }
  let spare = width - gap * Math.max(0, tracks.length - 1) - fixed

  const sizes = tracks.map((t) => (t.px != null ? t.px : 0))
  const frozen = tracks.map((t) => t.px != null || t.fr <= 0)

  for (let pass = 0; pass <= tracks.length && Math.abs(spare) > 0.001; pass++) {
    const open = []
    for (let i = 0; i < tracks.length; i++) if (!frozen[i]) open.push(i)
    if (open.length === 0) break

    let total = 0
    for (const i of open) total += tracks[i].fr
    if (total <= 0) break

    let delivered = 0
    for (const i of open) {
      const share = spare * (tracks[i].fr / total)
      let next = sizes[i] + share
      if (next < tracks[i].floor) next = tracks[i].floor
      if (next < 0) next = 0
      delivered += next - sizes[i]
      sizes[i] = next
      if (next === tracks[i].floor) frozen[i] = true
    }
    spare -= delivered
    if (Math.abs(delivered) < 0.001) break
  }

  return sizes.map((s) => round2(s))
}

function containingBlock(position, ancestors) {
  const list = ancestors == null ? [] : ancestors

  for (let i = 0; i < list.length; i++) {
    const a = list[i] == null ? {} : list[i]
    const notNone = (v) => v != null && v !== 'none'
    const isolated = notNone(a.transform) || notNone(a.filter) || notNone(a.perspective) || notNone(a.contain)
    const positioned = a.position != null && a.position !== 'static'

    if (position === 'fixed') {
      if (isolated) return i
      continue
    }
    if (position === 'absolute') {
      if (positioned || isolated) return i
      continue
    }
    if (position === 'sticky') {
      if (a.overflow != null && a.overflow !== 'visible') return i
      continue
    }
    return -1
  }

  return -1
}

function matchCondition(text, viewport) {
  const part = String(text == null ? '' : text).trim().toLowerCase()
  if (!part) return true
  if (part[0] !== '(') {
    return part === 'screen' || part === 'all'
  }
  const close = part.lastIndexOf(')')
  const inner = (close > 0 ? part.slice(1, close) : part.slice(1)).trim()
  const colon = inner.indexOf(':')
  if (colon < 0) return true
  const name = inner.slice(0, colon).trim()
  const raw = inner.slice(colon + 1).trim()

  if (name === 'min-width') return viewport.width >= parseFloat(raw)
  if (name === 'max-width') return viewport.width <= parseFloat(raw)
  if (name === 'min-height') return viewport.height >= parseFloat(raw)
  if (name === 'max-height') return viewport.height <= parseFloat(raw)
  if (name === 'orientation') {
    return raw === (viewport.width >= viewport.height ? 'landscape' : 'portrait')
  }
  return false
}

function matchesMedia(query, viewport) {
  const text = String(query == null ? '' : query).trim().toLowerCase()
  const vp = viewport == null ? { width: 0, height: 0 } : viewport
  if (!text) return true

  const clauses = text.split(' or ')
  for (const clause of clauses) {
    const parts = clause.split(' and ')
    let all = true
    for (const part of parts) {
      if (!matchCondition(part, vp)) {
        all = false
        break
      }
    }
    if (all) return true
  }
  return false
}

function pickBreakpoint(width, breakpoints) {
  const list = (breakpoints == null ? [] : breakpoints).slice()
  list.sort((a, b) => (a.min == null ? 0 : a.min) - (b.min == null ? 0 : b.min))

  let picked = null
  for (const bp of list) {
    if (width >= (bp.min == null ? 0 : bp.min)) picked = bp.name
  }
  return picked
}`,
  tests: `${L2S1}

${L2S2}

${L2S3}`
}

/* ============================================================ 第 3 关测试 */

const L3S1 = `{
  check('同 key 同类型的列表一次 DOM 操作都不需要', () => {
    const prev = [{ key: 'a', type: 'div' }, { key: 'b', type: 'div' }, { key: 'c', type: 'div' }]
    const next = [{ key: 'a', type: 'div' }, { key: 'b', type: 'div' }, { key: 'c', type: 'div' }]
    const res = reconcileChildren(prev, next)
    same(res.ops, [])
    same(res.reused, 3)
    same(res.removed, 0)
  })
  check('多出来的 key 记为一次 insert，位置要写对', () => {
    const prev = [{ key: 'a', type: 'div' }, { key: 'b', type: 'div' }]
    const next = [{ key: 'a', type: 'div' }, { key: 'x', type: 'div' }, { key: 'b', type: 'div' }]
    const res = reconcileChildren(prev, next)
    same(res.ops.length, 1)
    same(res.ops[0].op, 'insert')
    same(res.ops[0].index, 1)
    same(res.reused, 2)
  })
  check('消失的 key 记为一次 remove', () => {
    const prev = [{ key: 'a', type: 'div' }, { key: 'b', type: 'div' }, { key: 'c', type: 'div' }]
    const next = [{ key: 'a', type: 'div' }, { key: 'c', type: 'div' }]
    const res = reconcileChildren(prev, next)
    same(res.ops.length, 1)
    same(res.ops[0].op, 'remove')
    same(res.ops[0].from, 1)
    same(res.reused, 2)
    same(res.inserted, 0)
  })
  check('顺序反过来只产生一次 move，不会整体重建', () => {
    const prev = [{ key: 'a', type: 'div' }, { key: 'b', type: 'div' }, { key: 'c', type: 'div' }]
    const next = [{ key: 'b', type: 'div' }, { key: 'a', type: 'div' }, { key: 'c', type: 'div' }]
    const res = reconcileChildren(prev, next)
    same(res.reused, 3)
    same(res.ops.length, 1)
    same(res.ops[0].op, 'move')
    same(res.ops[0].from, 0)
    same(res.ops[0].to, 1)
  })
  check('同 key 但类型变了不能复用：先插新的，再删旧的', () => {
    const prev = [{ key: 'a', type: 'div' }]
    const next = [{ key: 'a', type: 'span' }]
    const res = reconcileChildren(prev, next)
    same(res.inserted, 1)
    same(res.removed, 1)
    same(res.reused, 0)
    same(res.ops.map((o) => o.op), ['insert', 'remove'])
  })
  check('没有 key 的列表按位置对齐，末尾追加只插一个新节点', () => {
    const prev = [{ type: 'div' }, { type: 'p' }]
    const next = [{ type: 'div' }, { type: 'p' }, { type: 'span' }]
    const res = reconcileChildren(prev, next)
    same(res.reused, 2)
    same(res.inserted, 1)
    same(res.ops.length, 1)
    same(res.ops[0].index, 2)
  })
}`

const L3S2 = `{
  check('同一 lane 的多次更新合并成一批', () => {
    const plan = planFlush([
      { id: 'a', lane: 1 },
      { id: 'b', lane: 1 },
      { id: 'c', lane: 1 }
    ])
    same(plan.batches.length, 1)
    same(plan.batches[0].ids, ['a', 'b', 'c'])
    same(plan.deferred, 0)
  })
  check('不同 lane 分开成多批，优先级高的排在前', () => {
    const plan = planFlush([
      { id: 'low', lane: 2 },
      { id: 'high', lane: 1 }
    ])
    same(plan.batches.map((b) => b.lane), [1, 2])
    same(plan.batches[0].ids, ['high'])
    same(plan.batches[1].ids, ['low'])
  })
  check('位掩码把参与本次渲染的 lane 合成一个整数', () => {
    same(planFlush([{ id: 'a', lane: 1 }, { id: 'b', lane: 3 }]).mask, 10)
    same(planFlush([{ id: 'a', lane: 3 }]).deferred, 1)
  })
  check('空更新计划不会伪造一个批次', () => {
    const plan = planFlush([])
    same(plan.mask, 0)
    same(plan.batches, [])
  })
  check('浅比较同值 props 可以 bailout，键数量变化则不行', () => {
    same(shouldBailOut({ a: 1, b: 'x' }, { a: 1, b: 'x' }), true)
    same(shouldBailOut({ a: 1 }, { a: 1, b: 2 }), false)
  })
  check('嵌套对象换了引用就必须重渲染（浅比较只到第一层）', () => {
    const shared = { title: 'hi' }
    same(shouldBailOut({ item: shared }, { item: shared }), true)
    same(shouldBailOut({ item: { title: 'hi' } }, { item: { title: 'hi' } }), false)
  })
}`

const L3S3 = `{
  check('预算充足时 shell 与关键块拼进第一个 chunk', () => {
    const res = renderToChunks({
      shell: '<main>',
      budget: 1000,
      sections: [
        { id: 'hero', html: '<h1>A</h1>', critical: true },
        { id: 'list', html: '<ul></ul>', critical: true }
      ]
    })
    same(res.chunks[0], '<main><h1>A</h1><ul></ul>')
    same(res.deferred, [])
    same(res.bytes, 25)
  })
  check('预算卡住的关键块改为后续分块，首屏字节不超预算', () => {
    const res = renderToChunks({
      shell: '<main>',
      budget: 16,
      sections: [
        { id: 'hero', html: '<h1>A</h1>', critical: true },
        { id: 'list', html: '<ul></ul>', critical: true }
      ]
    })
    same(res.chunks[0], '<main><h1>A</h1>')
    same(res.chunks[1], '<ul></ul>')
    same(res.deferred, ['list'])
  })
  check('tag 不一致：服务端渲染的节点在客户端根本对不上', () => {
    const out = hydrationMismatch({ tag: 'div' }, { tag: 'span' })
    same(out.length, 1)
    same(out[0].kind, 'tag')
    same(out[0].server, 'div')
  })
  check('文本、属性、子节点数量差异都要报出来', () => {
    const out = hydrationMismatch(
      { tag: 'div', text: 'a', props: { id: 'x' }, children: [{ tag: 'p' }, { tag: 'i' }] },
      { tag: 'div', text: 'b', props: { id: 'y' }, children: [{ tag: 'p' }] }
    )
    same(out.map((m) => m.kind), ['text', 'prop', 'count'])
  })
  check('强个性化又要 SEO 走流式 SSR，登录后后台直接 CSR', () => {
    same(pickRenderMode({ personalized: true, seo: true }), 'ssr-stream')
    same(pickRenderMode({ authed: true, seo: false }), 'csr')
  })
  check('时效性决定静态策略：按小时刷新走 ISR，纯静态走 SSG', () => {
    same(pickRenderMode({ freshness: 'hourly' }), 'isr')
    same(pickRenderMode({ freshness: 'static' }), 'ssg')
    same(pickRenderMode({ freshness: 'realtime' }), 'ssr')
  })
}`

/* ============================================================ 第 3 关：React 机制与 SSR 对照 */

const LV3 = {
  id: 'lv3',
  title: 'React 机制与 SSR 对照',
  emoji: '⚛️',
  xp: 55,
  goal: '实现 reconcileChildren / planFlush / shouldBailOut / renderToChunks / hydrationMismatch / pickRenderMode：让列表只做最小的 DOM 变更、把多次更新合并成有优先级的批次、按 props 浅比较决定 bailout、按首屏预算把 HTML 切成流式分块、判定水合不一致，并给页面选出渲染模式。',
  why: '「React 和 Vue 的更新模型差在哪」这一问，答「一个是 setState 一个是响应式」基本等于没答。真正的差别在于：React 每次更新都从组件函数重跑，所以它必须靠 key 让复用可判定、靠 memo/浅比较手工圈出边界、靠 lane 把一批更新合并成一次渲染；而 SSR 把这些决策又放大一遍——服务端先产出字节，客户端再「水合」接管，任何一边不一致都会在控制台炸出一条 mismatch。把这三层写成可断言的函数之后，你讲 React 就不再是背 API，而是能说清「每个机制在省掉哪一份工作」。',
  nodes: [
    'fe.eco.react',
    'fe.eco.react.mechanism',
    'fe.eco.ssr',
    'fe.eco.ssr.frameworks'
  ],
  thinking: [
    {
      title: 'key 不是用来消警告的，是用来让「复用」可判定的',
      md: '列表重排时 React 需要一个身份来回答「这个新节点还是不是刚才那个」：有 key 就按 key 找旧 Fiber，没 key 就按位置对——位置对齐的代价是重排时整段重建，输入框里的光标和内部状态全丢。\n\n所以我的 `reconcileChildren` 只维护一个 `key -> 旧下标` 的 Map 和一个 `lastPlacedIndex`：新列表从左往右扫，旧下标小于 lastPlacedIndex 说明它被「往后挪了」，记一次 move；大于等于就更新 lastPlacedIndex。这是 React 单遍协调算法的简化版（真实实现在 completeWork 阶段真正移动 DOM），但它足以解释「为什么反序只产生一次 move」。'
    },
    {
      title: 'bailout 与 lane 合并，都在回答「这一次到底要算多少」',
      md: 'React 的性能问题几乎都能归到两个问题：**该不该重算**（memo / shallow compare）和**一次算多少**（batching / lane）。\n\n`shouldBailOut` 我只做 props 浅比较：同引用或每个键 `Object.is` 相等就跳过子树。这里必须讲清边界——`Object.is` 只到第一层，`{ item: { title } }` 每次父组件重渲染都是新对象，浅比较必然 false，这就是「明明用了 memo 还在重渲染」的第一大原因。`planFlush` 则用位掩码把同一批的 lane 合起来：同一 lane 的多条更新只渲染一次，不同 lane 按位序排队，数字小的先跑（对应 React 的 lane 优先级位序）。'
    },
    {
      title: 'SSR 的两笔账：首屏字节预算，和客户端能不能接管',
      md: '服务端渲染不是「把 HTML 一次吐完」，而是先用最小的 shell 抢到首屏，剩下的关键块按预算决定「现在发还是挂到 Suspense 边界后发」。`renderToChunks` 把这件事简化为一个累加器：shell 先计入字节，关键块按顺序尝试塞进预算，塞不下的和所有非关键块一起压到后续 chunk——这正是流式 SSR 用 Suspense 边界分块 flush 的心智模型。\n\n但服务端产出的 HTML 必须能被客户端「认领」，认领失败的判定条件就是 `hydrationMismatch` 里的那几条：tag、文本、属性、子节点数量。真实项目里最常见的成因是随机数、`Date.now()`、locale 格式化和浏览器扩展改 DOM——所以这些值要在服务端与客户端之间显式传递，而不是各自算一遍。'
    }
  ],
  prereq: [
    {
      title: 'React 的更新模型：不可变状态 + 组件函数重执行',
      md: 'React 里 `setState` 不是「改一个字段」，而是「标记这个组件需要重跑」。组件函数重跑后返回一棵新的元素树，协调器拿它和上一次的 Fiber 树比对。\n\n所以 React 的默认行为是「子树全重渲染」，性能要靠手工圈边界：`React.memo`（props 浅比较）、`useMemo`（缓存值）、`useCallback`（缓存函数引用）。而 Vue 的响应式是「谁用了这个字段就精确更新谁」——两边不是快慢之分，而是「运行时重执行」与「编译期追踪依赖」的分工不同。'
    },
    {
      title: 'Fiber：把协调拆成可中断的小单元',
      md: 'React 15 的栈式协调是递归，一旦开始就必须跑完，长列表会把主线程卡住。Fiber 把每个节点变成一个带 `child / sibling / return` 指针的工作单元，render 阶段可以随时 yield 给浏览器，commit 阶段再一次性同步改 DOM。\n\n这也是 lane 模型存在的原因：既然渲染可以被切分、可以推迟，就必须知道「哪些更新更急」。用户输入的 lane 优先于数据请求的 transition lane——`useTransition` / `useDeferredValue` 就是把这个优先级暴露给业务的 API。'
    },
    {
      title: '渲染模式矩阵：CSR / SSR / SSG / ISR / Streaming 各自缓存什么',
      md: '选型的判断维度只有三个：**内容是否个性化**、**时效性**、**SEO 是否重要**。后台系统登录后才有内容、SEO 无价值 → CSR 最省；营销页内容固定 → SSG 构建期出静态；电商详情页要 SEO 又会变价 → ISR（静态 + 定时/按需 revalidate）；强个性化首屏又要 SEO → SSR 先给骨架和关键块、其余 Suspense 流式补。\n\n`pickRenderMode` 把这套判断写成了一条决策链，顺序很重要：先判「登录且不要 SEO」，再判「个性化 + SEO」，否则「个性化」会盖掉流式这个更合适的选择。'
    }
  ],
  api: [
    {
      name: 'reconcileChildren',
      sig: 'reconcileChildren(prevList, nextList) => { ops, reused, inserted, removed }',
      args: '列表项为 { key?, type }。key 缺省时按位置对齐（下标即身份）；type 是标签名或组件类型，type 不同即使 key 相同也不能复用。',
      returns: 'ops 只记录需要动 DOM 的操作：{ op: "move" | "insert" | "remove", ... }；reuse 不产生 op（零成本）。',
      example: "const res = reconcileChildren(\n  [{ key: 'a', type: 'div' }, { key: 'b', type: 'div' }],\n  [{ key: 'b', type: 'div' }, { key: 'a', type: 'div' }]\n)\nsame(res.reused, 2)  // 只有一次 move"
    },
    {
      name: 'planFlush',
      sig: 'planFlush(updates: { id, lane }[]) => { mask, batches, deferred }',
      args: 'lane 是优先级编号（数字越小越急）；id 只用来在测试里辨认更新。',
      returns: 'mask 是参与本次渲染的 lane 位掩码（1 << lane 的或）；batches 按 lane 升序分批，同 lane 的 id 合并进一批；deferred 统计 lane >= 3（transition 类）的更新条数。',
      example: "const plan = planFlush([{ id: 'typing', lane: 1 }, { id: 'fetch', lane: 3 }])\nsame(plan.mask, 10)\nsame(plan.batches.length, 2)"
    },
    {
      name: 'shouldBailOut',
      sig: 'shouldBailOut(prevProps, nextProps) => boolean',
      args: '两个 props 对象。null/undefined 按空对象处理。',
      returns: '浅比较结果：键数量相同且每个键 Object.is 相等才为 true。嵌套对象换引用一律 false。',
      example: "same(shouldBailOut({ a: 1 }, { a: 1 }), true)\nsame(shouldBailOut({ a: {} }, { a: {} }), false)"
    },
    {
      name: 'renderToChunks',
      sig: 'renderToChunks({ shell, budget, sections }) => { chunks, bytes, deferred }',
      args: 'sections 每项为 { id, html, critical }；budget 是首屏字节上限（按 html.length 计，不是真实压缩后字节）。',
      returns: 'chunks[0] 是首屏（shell + 预算内的关键块），chunks[1] 是后续分块；deferred 是没进首屏的 section id（保持原顺序）。',
      example: "const res = renderToChunks({ shell: '<main>', budget: 16, sections: [\n  { id: 'hero', html: '<h1>A</h1>', critical: true },\n  { id: 'list', html: '<ul></ul>', critical: true }\n] })\nsame(res.deferred, ['list'])"
    },
    {
      name: 'hydrationMismatch',
      sig: 'hydrationMismatch(serverTree, clientTree) => { kind, path, ... }[]',
      args: '树节点为 { tag, text?, props?, children? }。只比对结构，不执行组件。',
      returns: '不一致列表，kind 取 tag / text / prop / count / missing；同一节点只报第一处属性差异；最多报 8 条。',
      example: "const out = hydrationMismatch({ tag: 'div' }, { tag: 'span' })\nsame(out[0].kind, 'tag')"
    },
    {
      name: 'pickRenderMode',
      sig: 'pickRenderMode(scene) => "csr" | "ssr" | "ssr-stream" | "isr" | "ssg"',
      args: 'scene 可含 authed / seo / personalized 三个布尔位，以及 freshness: "static" | "hourly" | "realtime"。',
      returns: '按决策链顺序返回一个渲染模式字符串。',
      example: "same(pickRenderMode({ personalized: true, seo: true }), 'ssr-stream')\nsame(pickRenderMode({ freshness: 'hourly' }), 'isr')"
    }
  ],
  usage: "// 1) 列表从 a,b,c 变成 b,a,c：只该有一次 move\nconst res = reconcileChildren(\n  [{ key: 'a', type: 'div' }, { key: 'b', type: 'div' }, { key: 'c', type: 'div' }],\n  [{ key: 'b', type: 'div' }, { key: 'a', type: 'div' }, { key: 'c', type: 'div' }]\n)\nconsole.log(res.ops)   // [{ op: 'move', key: 'a', from: 0, to: 1 }]\n\n// 2) 输入框打字（lane 1）+ 后台请求回来（lane 3）落在同一批里吗\nconst plan = planFlush([{ id: 'typing', lane: 1 }, { id: 'fetch', lane: 3 }, { id: 'fetch2', lane: 3 }])\nconsole.log(plan.batches.map((b) => b.lane))   // [1, 3]：两次 fetch 合成一批\n\n// 3) memo 为什么没生效\nconsole.log(shouldBailOut({ item: { id: 1 } }, { item: { id: 1 } }))   // false：嵌套对象换了引用\n\n// 4) 首屏只有 16 字节预算时，谁能先发出去\nconsole.log(renderToChunks({ shell: '<main>', budget: 16, sections: [\n  { id: 'hero', html: '<h1>A</h1>', critical: true },\n  { id: 'list', html: '<ul></ul>', critical: true }\n] }).deferred)   // ['list']\n\n// 5) 给页面选一个渲染模式\nconsole.log(pickRenderMode({ personalized: true, seo: true }))   // 'ssr-stream'",
  hints: [
    '第一步先把「key -> 旧下标」的 Map 建好，再从左往右扫新列表；判断移动只需要一个 lastPlacedIndex，不需要真的算最长递增子序列。',
    '第二步的 planFlush 用 Map + 排序就够了，mask 用一个整数不断按位或；shouldBailOut 把 Object.keys 的长度和各键的 Object.is 都比一遍。',
    '第三步最难的是 hydrationMismatch 的递归：先比 tag（不同就 return，不再往下比），再比 text/props，最后比 children 数量，长度不同也 return。'
  ],
  concepts: [
    {
      title: '从 React 18/19 的视角看这三层',
      md: 'React 18 把 concurrent 能力变成默认（lane 模型、Suspense 流式 SSR），React 19 加上 Server Components 与 Server Actions——但本关这三层机制没有变：**复用判定**（key/diff）、**重算边界**（memo/浅比较）、**批次与优先级**（batching/lane）。\n\n2024 年之后的新变量是编译器：React Compiler 在构建期自动插入 memo 化，减少手写 `useMemo` 的负担；但它的前提仍是「组件是纯函数、props 不突变」——也就是本关 `shouldBailOut` 假设的那套语义。所以先把这套语义吃透，再谈编译器省掉了哪几步。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '先让列表只改该改的节点',
      think: '列表重排是 React 面试的保留题，也是最好验证的：如果没有 key 复用，任何重排都是「全删全建」。这一步只做协调本身（哪些复用、插在哪、删哪个），不做 props 比较，也不做批次——那是下一步的主题，先把「最小 DOM 变更」算对。',
      hint: '先遍历旧列表建 Map（key 缺失就用下标当身份），再遍历新列表；旧下标小于 lastPlacedIndex 记 move，否则更新 lastPlacedIndex。最后把没用到的旧节点记 remove。',
      vocab: [
        { term: 'reconcile', desc: '协调：拿新旧两棵树比对，算出最小的 DOM 变更集合' },
        { term: 'lastPlacedIndex', desc: '已处理节点里旧下标的峰值；新节点的旧下标小于它，说明它得往后挪' }
      ],
      code: `const identity = (node, index) => (node && node.key != null ? 'k:' + node.key : 'i:' + index)

/**
 * reconcileChildren(prevList, nextList) -> { ops, reused, inserted, removed }
 * 简化：只处理同层级列表，不递归子树、不比较 props（props 的 bailout 由 shouldBailOut 负责）
 */
function reconcileChildren(prevList, nextList) {
  const prev = prevList == null ? [] : prevList
  const next = nextList == null ? [] : nextList
  const ops = []

  const prevMap = new Map()
  for (let i = 0; i < prev.length; i++) {
    prevMap.set(identity(prev[i], i), { node: prev[i], index: i, used: false })
  }

  let lastPlacedIndex = 0
  let reused = 0
  let inserted = 0
  let removed = 0

  for (let i = 0; i < next.length; i++) {
    const node = next[i]
    const slot = prevMap.get(identity(node, i))

    // 同 key 还要同 type 才能复用：从 div 换成 span，旧节点没有任何可继承的东西
    if (slot && !slot.used && slot.node && node && slot.node.type === node.type) {
      slot.used = true
      reused += 1
      if (slot.index < lastPlacedIndex) {
        ops.push({ op: 'move', key: node.key == null ? null : node.key, from: slot.index, to: i })
      } else {
        lastPlacedIndex = slot.index
      }
    } else {
      inserted += 1
      ops.push({ op: 'insert', key: node.key == null ? null : node.key, index: i })
    }
  }

  for (let i = 0; i < prev.length; i++) {
    const slot = prevMap.get(identity(prev[i], i))
    if (slot && !slot.used) {
      removed += 1
      ops.push({ op: 'remove', key: prev[i] && prev[i].key != null ? prev[i].key : null, from: i })
    }
  }

  return { ops: ops, reused: reused, inserted: inserted, removed: removed }
}`,
      test: L3S1,
      diag: [
        '把复用也当成一次 DOM 操作塞进了 ops；复用应该是零成本，ops 只记 move/insert/remove。',
        'insert 的位置记成了旧列表下标，或者压根没记 index。',
        'remove 的循环只跑了新列表的长度，漏掉了尾部被删掉的旧节点。',
        '缺少 lastPlacedIndex 判断（或用了 > 而不是 <），反序时会把所有节点都标记成 move。',
        '复用条件只比了 key 没比 type，同 key 换标签也被当成复用。',
        '无 key 时没有用下标兜底身份，两个不同下标被误判成同 key 无法匹配。'
      ]
    },
    {
      n: 2,
      title: '再决定「这一次要算多少」',
      think: '第 1 步算的是「改哪些节点」，这一步算的是「要不要算、算几批」。这两件事在真实 React 里分别由 memo/浅比较和 batching/lane 负责，但本质相同：都是在削减一次渲染的工作量，所以我放在同一步。',
      hint: 'planFlush 里用 Map<lane, ids> 收集，再用排序后的 lane 列表生成 batches；mask 用 1 << lane 不断按位或。shouldBailOut 就是 Object.keys 长度 + 每键 Object.is。',
      vocab: [
        { term: 'bailout', desc: '跳过重渲染：memo 判定 props 没变，直接复用上一次的渲染结果' },
        { term: 'lane', desc: 'React 18 的优先级位掩码，数字小的 lane 更急；同一次渲染会把多条 lane 合成一个 mask' }
      ],
      code: `const identity = (node, index) => (node && node.key != null ? 'k:' + node.key : 'i:' + index)

function reconcileChildren(prevList, nextList) {
  const prev = prevList == null ? [] : prevList
  const next = nextList == null ? [] : nextList
  const ops = []

  const prevMap = new Map()
  for (let i = 0; i < prev.length; i++) {
    prevMap.set(identity(prev[i], i), { node: prev[i], index: i, used: false })
  }

  let lastPlacedIndex = 0
  let reused = 0
  let inserted = 0
  let removed = 0

  for (let i = 0; i < next.length; i++) {
    const node = next[i]
    const slot = prevMap.get(identity(node, i))
    if (slot && !slot.used && slot.node && node && slot.node.type === node.type) {
      slot.used = true
      reused += 1
      if (slot.index < lastPlacedIndex) {
        ops.push({ op: 'move', key: node.key == null ? null : node.key, from: slot.index, to: i })
      } else {
        lastPlacedIndex = slot.index
      }
    } else {
      inserted += 1
      ops.push({ op: 'insert', key: node.key == null ? null : node.key, index: i })
    }
  }

  for (let i = 0; i < prev.length; i++) {
    const slot = prevMap.get(identity(prev[i], i))
    if (slot && !slot.used) {
      removed += 1
      ops.push({ op: 'remove', key: prev[i] && prev[i].key != null ? prev[i].key : null, from: i })
    }
  }

  return { ops: ops, reused: reused, inserted: inserted, removed: removed }
}

/**
 * planFlush(updates) -> { mask, batches, deferred }
 * 简化：lane 用 0..4 的小整数表示优先级；真实 React 的 lane 位序更绕（InputContinuous / Transition 等）
 */
function planFlush(updates) {
  const list = updates == null ? [] : updates
  const byLane = new Map()
  let mask = 0

  for (const update of list) {
    const lane = update && update.lane != null ? update.lane : 0
    mask |= 1 << lane
    if (!byLane.has(lane)) byLane.set(lane, [])
    byLane.get(lane).push(update ? update.id : undefined)
  }

  const lanes = []
  byLane.forEach((ids, lane) => lanes.push(lane))
  lanes.sort((a, b) => a - b)

  const batches = []
  let deferred = 0
  for (const lane of lanes) {
    batches.push({ lane: lane, ids: byLane.get(lane) })
    if (lane >= 3) deferred += byLane.get(lane).length
  }

  return { mask: mask, batches: batches, deferred: deferred }
}

function shallowEqual(a, b) {
  if (a === b) return true
  if (a == null || b == null) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    if (!(k in b)) return false
    if (!Object.is(a[k], b[k])) return false
  }
  return true
}

/** shouldBailOut(prevProps, nextProps) -> boolean */
function shouldBailOut(prevProps, nextProps) {
  const a = prevProps == null ? {} : prevProps
  const b = nextProps == null ? {} : nextProps
  return shallowEqual(a, b)
}`,
      test: L3S2,
      diag: [
        'planFlush 每条更新都造一个批次，没有按 lane 归并；同一个 lane 应该只出一批。',
        'batches 没有按 lane 升序排，或者排序反了（数字小的是高优先级，要排前面）。',
        'mask 用了加法（lane 相加）而不是按位或；或者 deferred 把 lane 0 也算进去了。',
        '空数组时仍然走了一次循环造出空批次，或 mask 初始化成了 undefined。',
        '浅比较只比了一个键、或者用 JSON.stringify 比较（顺序不同就误判），键数量变化没判。',
        '嵌套对象用 === 之外的深比较（或者直接 return true），于是新引用也被 bailout。'
      ]
    },
    {
      n: 3,
      title: '最后看服务端产出：分块、水合与模式选型',
      think: '前三步都在浏览器里算，这一步换到服务端：产出的 HTML 要按首屏预算分块，客户端还要能认领。三个函数分别对应「发什么」「对不对得上」「用哪种渲染策略」，是同一份页面在服务端视角下的三个问题。',
      hint: 'renderToChunks 是一个累加器：shell 先计入字节，关键块按顺序试着塞进预算，塞不下和非关键块一起进后续 chunk。hydrationMismatch 递归比 tag → text/props → children 数量。',
      vocab: [
        { term: 'hydration', desc: '水合：客户端拿服务端 HTML 建树、复用已有 DOM 并挂上事件' },
        { term: 'streaming SSR', desc: '流式 SSR：不等待整页数据，按 Suspense 边界分块 flush 出去' }
      ],
      code: `const identity = (node, index) => (node && node.key != null ? 'k:' + node.key : 'i:' + index)

function reconcileChildren(prevList, nextList) {
  const prev = prevList == null ? [] : prevList
  const next = nextList == null ? [] : nextList
  const ops = []

  const prevMap = new Map()
  for (let i = 0; i < prev.length; i++) {
    prevMap.set(identity(prev[i], i), { node: prev[i], index: i, used: false })
  }

  let lastPlacedIndex = 0
  let reused = 0
  let inserted = 0
  let removed = 0

  for (let i = 0; i < next.length; i++) {
    const node = next[i]
    const slot = prevMap.get(identity(node, i))
    if (slot && !slot.used && slot.node && node && slot.node.type === node.type) {
      slot.used = true
      reused += 1
      if (slot.index < lastPlacedIndex) {
        ops.push({ op: 'move', key: node.key == null ? null : node.key, from: slot.index, to: i })
      } else {
        lastPlacedIndex = slot.index
      }
    } else {
      inserted += 1
      ops.push({ op: 'insert', key: node.key == null ? null : node.key, index: i })
    }
  }

  for (let i = 0; i < prev.length; i++) {
    const slot = prevMap.get(identity(prev[i], i))
    if (slot && !slot.used) {
      removed += 1
      ops.push({ op: 'remove', key: prev[i] && prev[i].key != null ? prev[i].key : null, from: i })
    }
  }

  return { ops: ops, reused: reused, inserted: inserted, removed: removed }
}

function planFlush(updates) {
  const list = updates == null ? [] : updates
  const byLane = new Map()
  let mask = 0

  for (const update of list) {
    const lane = update && update.lane != null ? update.lane : 0
    mask |= 1 << lane
    if (!byLane.has(lane)) byLane.set(lane, [])
    byLane.get(lane).push(update ? update.id : undefined)
  }

  const lanes = []
  byLane.forEach((ids, lane) => lanes.push(lane))
  lanes.sort((a, b) => a - b)

  const batches = []
  let deferred = 0
  for (const lane of lanes) {
    batches.push({ lane: lane, ids: byLane.get(lane) })
    if (lane >= 3) deferred += byLane.get(lane).length
  }

  return { mask: mask, batches: batches, deferred: deferred }
}

function shallowEqual(a, b) {
  if (a === b) return true
  if (a == null || b == null) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    if (!(k in b)) return false
    if (!Object.is(a[k], b[k])) return false
  }
  return true
}

function shouldBailOut(prevProps, nextProps) {
  const a = prevProps == null ? {} : prevProps
  const b = nextProps == null ? {} : nextProps
  return shallowEqual(a, b)
}

/**
 * renderToChunks(page) -> { chunks, bytes, deferred }
 * 简化：字节数用 html.length 近似（不做 gzip / chunked transfer 的真实编码）
 */
function renderToChunks(page) {
  const p = page == null ? {} : page
  const shell = p.shell == null ? '' : p.shell
  const budget = p.budget == null ? Infinity : p.budget
  const sections = p.sections == null ? [] : p.sections

  const first = [shell]
  const later = []
  const deferred = []
  let bytes = shell.length

  for (const section of sections) {
    const s = section == null ? {} : section
    const html = s.html == null ? '' : s.html
    const critical = s.critical === true

    if (critical && bytes + html.length <= budget) {
      first.push(html)
      bytes += html.length
    } else {
      later.push(html)
      deferred.push(s.id)
    }
  }

  return { chunks: [first.join(''), later.join('')], bytes: bytes, deferred: deferred }
}

/**
 * hydrationMismatch(server, client) -> [{ kind, path, ... }]
 * 简化：只比结构，不执行组件、不做属性语义归一（class/style 的写法差异会被当成差异）
 */
function hydrationMismatch(server, client) {
  const out = []

  function walk(s, c, path) {
    if (out.length >= 8) return
    if (!s || !c) {
      out.push({ kind: 'missing', path: path })
      return
    }

    const sTag = s.tag == null ? '' : s.tag
    const cTag = c.tag == null ? '' : c.tag
    if (sTag !== cTag) {
      out.push({ kind: 'tag', path: path, server: sTag, client: cTag })
      return
    }

    const sText = s.text == null ? '' : s.text
    const cText = c.text == null ? '' : c.text
    if (sText !== cText) {
      out.push({ kind: 'text', path: path, server: sText, client: cText })
    }

    const sp = s.props == null ? {} : s.props
    const cp = c.props == null ? {} : c.props
    const keys = Object.keys(sp)
    for (const k of Object.keys(cp)) {
      if (!(k in sp)) keys.push(k)
    }
    for (const k of keys) {
      if (!Object.is(sp[k], cp[k])) {
        out.push({ kind: 'prop', path: path, name: k })
        break
      }
    }

    const sc = s.children == null ? [] : s.children
    const cc = c.children == null ? [] : c.children
    if (sc.length !== cc.length) {
      out.push({ kind: 'count', path: path, server: sc.length, client: cc.length })
      return
    }
    for (let i = 0; i < sc.length; i++) {
      const tag = cc[i] && cc[i].tag ? cc[i].tag : '#' + i
      walk(sc[i], cc[i], path + '>' + tag)
    }
  }

  walk(server, client, 'root')
  return out
}

/**
 * pickRenderMode(scene) -> 'csr' | 'ssr' | 'ssr-stream' | 'isr' | 'ssg'
 * 决策链的顺序就是优先级：登录态、SEO、个性化、时效性
 */
function pickRenderMode(scene) {
  const s = scene == null ? {} : scene

  if (s.authed === true && s.seo !== true) return 'csr'
  if (s.personalized === true && s.seo === true) return 'ssr-stream'
  if (s.personalized === true) return 'ssr'
  if (s.freshness === 'realtime') return 'ssr'
  if (s.freshness === 'hourly') return 'isr'
  return 'ssg'
}`,
      test: L3S3,
      diag: [
        '首屏累加器没有把 shell 的长度算进 bytes，或者关键块全部无条件塞进第一个 chunk。',
        '预算判断用了 < 而不是 <=，边界上刚好装得下的块被推后；非关键块也没有强制推后。',
        'tag 不一致之后还继续往下比，或者返回的 kind 写成了别的字符串。',
        '只比了 text 没比 props，或者 children 长度不同时没有 return（导致越界递归）。',
        'pickRenderMode 的决策顺序搞反：个性化判断放在了登录判断之前，或者漏了 seo 条件。',
        '时效性分支把 hourly 和 static 弄混，或者 realtime 没有回落到 ssr。'
      ]
    }
  ],
  skeleton: `function reconcileChildren(prevList, nextList) {
  throw new Error('reconcileChildren 还没实现')
}

function planFlush(updates) {
  throw new Error('planFlush 还没实现')
}

function shouldBailOut(prevProps, nextProps) {
  throw new Error('shouldBailOut 还没实现')
}

function renderToChunks(page) {
  throw new Error('renderToChunks 还没实现')
}

function hydrationMismatch(server, client) {
  throw new Error('hydrationMismatch 还没实现')
}

function pickRenderMode(scene) {
  throw new Error('pickRenderMode 还没实现')
}`,
  solution: `const identity = (node, index) => (node && node.key != null ? 'k:' + node.key : 'i:' + index)

function reconcileChildren(prevList, nextList) {
  const prev = prevList == null ? [] : prevList
  const next = nextList == null ? [] : nextList
  const ops = []

  const prevMap = new Map()
  for (let i = 0; i < prev.length; i++) {
    prevMap.set(identity(prev[i], i), { node: prev[i], index: i, used: false })
  }

  let lastPlacedIndex = 0
  let reused = 0
  let inserted = 0
  let removed = 0

  for (let i = 0; i < next.length; i++) {
    const node = next[i]
    const slot = prevMap.get(identity(node, i))
    if (slot && !slot.used && slot.node && node && slot.node.type === node.type) {
      slot.used = true
      reused += 1
      if (slot.index < lastPlacedIndex) {
        ops.push({ op: 'move', key: node.key == null ? null : node.key, from: slot.index, to: i })
      } else {
        lastPlacedIndex = slot.index
      }
    } else {
      inserted += 1
      ops.push({ op: 'insert', key: node.key == null ? null : node.key, index: i })
    }
  }

  for (let i = 0; i < prev.length; i++) {
    const slot = prevMap.get(identity(prev[i], i))
    if (slot && !slot.used) {
      removed += 1
      ops.push({ op: 'remove', key: prev[i] && prev[i].key != null ? prev[i].key : null, from: i })
    }
  }

  return { ops: ops, reused: reused, inserted: inserted, removed: removed }
}

function planFlush(updates) {
  const list = updates == null ? [] : updates
  const byLane = new Map()
  let mask = 0

  for (const update of list) {
    const lane = update && update.lane != null ? update.lane : 0
    mask |= 1 << lane
    if (!byLane.has(lane)) byLane.set(lane, [])
    byLane.get(lane).push(update ? update.id : undefined)
  }

  const lanes = []
  byLane.forEach((ids, lane) => lanes.push(lane))
  lanes.sort((a, b) => a - b)

  const batches = []
  let deferred = 0
  for (const lane of lanes) {
    batches.push({ lane: lane, ids: byLane.get(lane) })
    if (lane >= 3) deferred += byLane.get(lane).length
  }

  return { mask: mask, batches: batches, deferred: deferred }
}

function shallowEqual(a, b) {
  if (a === b) return true
  if (a == null || b == null) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    if (!(k in b)) return false
    if (!Object.is(a[k], b[k])) return false
  }
  return true
}

function shouldBailOut(prevProps, nextProps) {
  const a = prevProps == null ? {} : prevProps
  const b = nextProps == null ? {} : nextProps
  return shallowEqual(a, b)
}

function renderToChunks(page) {
  const p = page == null ? {} : page
  const shell = p.shell == null ? '' : p.shell
  const budget = p.budget == null ? Infinity : p.budget
  const sections = p.sections == null ? [] : p.sections

  const first = [shell]
  const later = []
  const deferred = []
  let bytes = shell.length

  for (const section of sections) {
    const s = section == null ? {} : section
    const html = s.html == null ? '' : s.html
    const critical = s.critical === true

    if (critical && bytes + html.length <= budget) {
      first.push(html)
      bytes += html.length
    } else {
      later.push(html)
      deferred.push(s.id)
    }
  }

  return { chunks: [first.join(''), later.join('')], bytes: bytes, deferred: deferred }
}

function hydrationMismatch(server, client) {
  const out = []

  function walk(s, c, path) {
    if (out.length >= 8) return
    if (!s || !c) {
      out.push({ kind: 'missing', path: path })
      return
    }

    const sTag = s.tag == null ? '' : s.tag
    const cTag = c.tag == null ? '' : c.tag
    if (sTag !== cTag) {
      out.push({ kind: 'tag', path: path, server: sTag, client: cTag })
      return
    }

    const sText = s.text == null ? '' : s.text
    const cText = c.text == null ? '' : c.text
    if (sText !== cText) {
      out.push({ kind: 'text', path: path, server: sText, client: cText })
    }

    const sp = s.props == null ? {} : s.props
    const cp = c.props == null ? {} : c.props
    const keys = Object.keys(sp)
    for (const k of Object.keys(cp)) {
      if (!(k in sp)) keys.push(k)
    }
    for (const k of keys) {
      if (!Object.is(sp[k], cp[k])) {
        out.push({ kind: 'prop', path: path, name: k })
        break
      }
    }

    const sc = s.children == null ? [] : s.children
    const cc = c.children == null ? [] : c.children
    if (sc.length !== cc.length) {
      out.push({ kind: 'count', path: path, server: sc.length, client: cc.length })
      return
    }
    for (let i = 0; i < sc.length; i++) {
      const tag = cc[i] && cc[i].tag ? cc[i].tag : '#' + i
      walk(sc[i], cc[i], path + '>' + tag)
    }
  }

  walk(server, client, 'root')
  return out
}

function pickRenderMode(scene) {
  const s = scene == null ? {} : scene

  if (s.authed === true && s.seo !== true) return 'csr'
  if (s.personalized === true && s.seo === true) return 'ssr-stream'
  if (s.personalized === true) return 'ssr'
  if (s.freshness === 'realtime') return 'ssr'
  if (s.freshness === 'hourly') return 'isr'
  return 'ssg'
}`,
  finalCode: `const identity = (node, index) => (node && node.key != null ? 'k:' + node.key : 'i:' + index)

function reconcileChildren(prevList, nextList) {
  const prev = prevList == null ? [] : prevList
  const next = nextList == null ? [] : nextList
  const ops = []

  const prevMap = new Map()
  for (let i = 0; i < prev.length; i++) {
    prevMap.set(identity(prev[i], i), { node: prev[i], index: i, used: false })
  }

  let lastPlacedIndex = 0
  let reused = 0
  let inserted = 0
  let removed = 0

  for (let i = 0; i < next.length; i++) {
    const node = next[i]
    const slot = prevMap.get(identity(node, i))
    if (slot && !slot.used && slot.node && node && slot.node.type === node.type) {
      slot.used = true
      reused += 1
      if (slot.index < lastPlacedIndex) {
        ops.push({ op: 'move', key: node.key == null ? null : node.key, from: slot.index, to: i })
      } else {
        lastPlacedIndex = slot.index
      }
    } else {
      inserted += 1
      ops.push({ op: 'insert', key: node.key == null ? null : node.key, index: i })
    }
  }

  for (let i = 0; i < prev.length; i++) {
    const slot = prevMap.get(identity(prev[i], i))
    if (slot && !slot.used) {
      removed += 1
      ops.push({ op: 'remove', key: prev[i] && prev[i].key != null ? prev[i].key : null, from: i })
    }
  }

  return { ops: ops, reused: reused, inserted: inserted, removed: removed }
}

function planFlush(updates) {
  const list = updates == null ? [] : updates
  const byLane = new Map()
  let mask = 0

  for (const update of list) {
    const lane = update && update.lane != null ? update.lane : 0
    mask |= 1 << lane
    if (!byLane.has(lane)) byLane.set(lane, [])
    byLane.get(lane).push(update ? update.id : undefined)
  }

  const lanes = []
  byLane.forEach((ids, lane) => lanes.push(lane))
  lanes.sort((a, b) => a - b)

  const batches = []
  let deferred = 0
  for (const lane of lanes) {
    batches.push({ lane: lane, ids: byLane.get(lane) })
    if (lane >= 3) deferred += byLane.get(lane).length
  }

  return { mask: mask, batches: batches, deferred: deferred }
}

function shallowEqual(a, b) {
  if (a === b) return true
  if (a == null || b == null) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    if (!(k in b)) return false
    if (!Object.is(a[k], b[k])) return false
  }
  return true
}

function shouldBailOut(prevProps, nextProps) {
  const a = prevProps == null ? {} : prevProps
  const b = nextProps == null ? {} : nextProps
  return shallowEqual(a, b)
}

function renderToChunks(page) {
  const p = page == null ? {} : page
  const shell = p.shell == null ? '' : p.shell
  const budget = p.budget == null ? Infinity : p.budget
  const sections = p.sections == null ? [] : p.sections

  const first = [shell]
  const later = []
  const deferred = []
  let bytes = shell.length

  for (const section of sections) {
    const s = section == null ? {} : section
    const html = s.html == null ? '' : s.html
    const critical = s.critical === true

    if (critical && bytes + html.length <= budget) {
      first.push(html)
      bytes += html.length
    } else {
      later.push(html)
      deferred.push(s.id)
    }
  }

  return { chunks: [first.join(''), later.join('')], bytes: bytes, deferred: deferred }
}

function hydrationMismatch(server, client) {
  const out = []

  function walk(s, c, path) {
    if (out.length >= 8) return
    if (!s || !c) {
      out.push({ kind: 'missing', path: path })
      return
    }

    const sTag = s.tag == null ? '' : s.tag
    const cTag = c.tag == null ? '' : c.tag
    if (sTag !== cTag) {
      out.push({ kind: 'tag', path: path, server: sTag, client: cTag })
      return
    }

    const sText = s.text == null ? '' : s.text
    const cText = c.text == null ? '' : c.text
    if (sText !== cText) {
      out.push({ kind: 'text', path: path, server: sText, client: cText })
    }

    const sp = s.props == null ? {} : s.props
    const cp = c.props == null ? {} : c.props
    const keys = Object.keys(sp)
    for (const k of Object.keys(cp)) {
      if (!(k in sp)) keys.push(k)
    }
    for (const k of keys) {
      if (!Object.is(sp[k], cp[k])) {
        out.push({ kind: 'prop', path: path, name: k })
        break
      }
    }

    const sc = s.children == null ? [] : s.children
    const cc = c.children == null ? [] : c.children
    if (sc.length !== cc.length) {
      out.push({ kind: 'count', path: path, server: sc.length, client: cc.length })
      return
    }
    for (let i = 0; i < sc.length; i++) {
      const tag = cc[i] && cc[i].tag ? cc[i].tag : '#' + i
      walk(sc[i], cc[i], path + '>' + tag)
    }
  }

  walk(server, client, 'root')
  return out
}

function pickRenderMode(scene) {
  const s = scene == null ? {} : scene

  if (s.authed === true && s.seo !== true) return 'csr'
  if (s.personalized === true && s.seo === true) return 'ssr-stream'
  if (s.personalized === true) return 'ssr'
  if (s.freshness === 'realtime') return 'ssr'
  if (s.freshness === 'hourly') return 'isr'
  return 'ssg'
}`,
  tests: `${L3S1}

${L3S2}

${L3S3}`
}

/* ============================================================ 第 4 关测试 */

const L4S1 = `{
  check('体积与常驻内存敏感的常驻工具型软件选 Tauri', () => {
    const res = scoreContainer({ bundle: true, memory: true })
    same(res.pick, 'tauri')
    same(res.tauri, 6)
    same(res.electron, 0)
    ok(res.risks.length >= 1, '应该提示团队需要补 Rust')
  })
  check('要确定性渲染且要直接复用小生态原生模块，选 Electron', () => {
    const res = scoreContainer({ renderConsistency: true, nodeNative: true })
    same(res.pick, 'electron')
    same(res.electron, 6)
    same(res.tauri, 0)
  })
  check('桌面与移动一份代码、团队能写 Rust 时 Tauri 没有额外风险', () => {
    const res = scoreContainer({ mobile: true, rust: true })
    same(res.pick, 'tauri')
    same(res.tauri, 6)
    same(res.risks.length, 0)
  })
  check('没有任何特殊诉求时平手回落到生态更成熟的 Electron', () => {
    const res = scoreContainer({})
    same(res.pick, 'electron')
    same(res.matched, [])
    same(res.risks.length, 1)
  })
  check('声明式权限收口是加分项，而不是一票否决', () => {
    const res = scoreContainer({ permission: true })
    same(res.tauri, 3)
    same(res.electron, 1)
    same(res.pick, 'tauri')
    same(res.matched, ['permission'])
  })
  check('体积敏感 + 渲染一致性打平时，选 Electron 但要把成本写进风险', () => {
    const res = scoreContainer({ bundle: true, renderConsistency: true })
    same(res.electron, 3)
    same(res.tauri, 3)
    same(res.pick, 'electron')
    ok(res.risks.join('|').indexOf('包体积') >= 0, '风险里要写明包体积与内存的固定成本')
  })
}`

const L4S2 = `{
  const registry = {
    'text-blue': [{ prop: 'color', value: 'blue' }],
    'text-red': [{ prop: 'color', value: 'red' }],
    'force-red': [{ prop: 'color', value: 'red', important: true }],
    'p-2': [{ prop: 'padding', value: '8px' }],
    'pt-8': [{ prop: 'padding-top', value: '32px' }],
    'px-4': [{ prop: 'padding-left', value: '16px' }, { prop: 'padding-right', value: '16px' }],
    'gap-2': [{ prop: 'gap', value: '8px' }],
    'gap-x-4': [{ prop: 'column-gap', value: '16px' }]
  }

  check('同一属性后者覆盖前者', () => {
    const out = resolveUtilities(['text-blue', 'text-red'], registry)
    same(out.length, 1)
    same(out[0].prop, 'color')
    same(out[0].value, 'red')
  })
  check('!important 即使写在前面也赢', () => {
    const out = resolveUtilities(['force-red', 'text-blue'], registry)
    same(out[0].value, 'red')
    same(out[0].important, true)
  })
  check('简写先展开成四个长写，再让后面的长写覆盖', () => {
    const out = resolveUtilities(['p-2', 'pt-8'], registry)
    same(out.map((d) => d.prop), ['padding-bottom', 'padding-left', 'padding-right', 'padding-top'])
    const top = out.filter((d) => d.prop === 'padding-top')[0]
    same(top.value, '32px')
    const left = out.filter((d) => d.prop === 'padding-left')[0]
    same(left.value, '8px')
  })
  check('顺序反过来时简写覆盖前面写过的长写（源顺序才是最后裁判）', () => {
    const out = resolveUtilities(['pt-8', 'p-2'], registry)
    const top = out.filter((d) => d.prop === 'padding-top')[0]
    same(top.value, '8px')
  })
  check('未注册的类被忽略，空输入得到空声明表', () => {
    same(resolveUtilities(['not-exist', 'text-blue'], registry).length, 1)
    same(resolveUtilities([], registry), [])
  })
  check('gap 这类简写按方向展开，后写的方向覆盖对应方向', () => {
    const out = resolveUtilities(['gap-2', 'gap-x-4'], registry)
    same(out.map((d) => d.prop), ['column-gap', 'row-gap'])
    same(out[0].value, '16px')
    same(out[1].value, '8px')
  })
}`

const L4S3 = `{
  check('token 直接命中时原样返回', () => {
    const theme = { '--space-2': '8px' }
    same(resolveToken('--space-2', theme), '8px')
  })
  check('var() 引用要一路解析到最终值', () => {
    const theme = {
      '--color-brand': '#3b82f6',
      '--color-text': 'var(--color-brand)'
    }
    same(resolveToken('--color-text', theme), '#3b82f6')
  })
  check('缺失的 token 走 var() 的 fallback，没有 fallback 就是 undefined', () => {
    const theme = { '--space-2': '8px' }
    ok(resolveToken('--missing', theme) === undefined, '缺失 token 应返回 undefined 而不是字符串 undefined')
    same(resolveValue('var(--missing, 4px)', theme), '4px')
  })
  check('循环引用不会死循环，直接视为无法解析', () => {
    const theme = { '--a': 'var(--b)', '--b': 'var(--a)' }
    ok(resolveToken('--a', theme) === undefined, '循环应安全回落到 undefined')
    same(resolveValue('var(--a, 12px)', theme), '12px')
  })
  check('自定义属性沿继承链合并，子级同名覆盖父级', () => {
    const merged = inheritTokens([
      { '--gap': '4px', '--color': 'red' },
      { '--gap': '8px' }
    ])
    same(merged['--gap'], '8px')
    same(merged['--color'], 'red')
  })
  check('继承只收自定义属性，空链得到空表', () => {
    same(inheritTokens([{ color: 'red', padding: '4px' }]), {})
    same(inheritTokens([]), {})
  })
}`

/* ============================================================ 第 4 关：桌面容器与样式工程 */

const LV4 = {
  id: 'lv4',
  title: '桌面容器与样式工程',
  emoji: '🧱',
  xp: 60,
  goal: '实现 scoreContainer / resolveUtilities / resolveToken / inheritTokens：按需求给 Electron 与 Tauri 打分并给出风险清单、按「展开简写 + important 提升 + 源顺序」消解原子类冲突、解析 var() 引用链与自定义属性的继承。',
  why: '「选 Electron 还是 Tauri」「Tailwind 不过是把 CSS 写进 class 里，凭什么说它工程化」这两个问题，答得像个人样的前提是能算。容器选型的本质是把接缝成本量化：包体积、内存、渲染一致性、原生能力、权限模型各值多少分，平手时回落到谁；原子化的本质是「类名只是声明集合的语法糖」，所以冲突消解必须回到 CSS 层叠——展开简写、important 提升、源顺序裁决；而设计 token 的价值全在「一个 var() 链能一路解析到真实值」。这一关不给结论，只给你一套能算的模型。',
  nodes: [
    'fe.eco.desktop',
    'fe.eco.desktop.tauri',
    'fe.eco.styles',
    'fe.eco.styles.tailwind'
  ],
  thinking: [
    {
      title: '选型不站队，把「接缝成本」折成可加的分',
      md: '网上关于 Electron 与 Tauri 的争论大多是站队，因为双方比的不是同一件事。把需求拆成七个信号（体积、内存、渲染一致性、Node 原生生态、移动端、Rust 能力、权限收口）之后，每个信号对两种容器的权重是明确的：**Tauri 省的是「自带浏览器」那 100MB 和几百 MB 内存，代价是系统 WebView 的版本分裂与 Rust 的进入门槛**。\n\n所以我让 `scoreContainer` 输出两个分数和一份风险清单，而不是一个「谁更好」。平手时回落到 Electron 是有意的：它的生态、Node 原生模块、Chromium 版本锁定都是「省事」的，而 Tauri 的优势只在特定需求下才兑现。面试里能说出「平手我选 Electron，因为迁移成本」，比背参数更有说服力。'
    },
    {
      title: '原子类的冲突消解必须回到层叠，而不是「谁更具体」',
      md: 'Tailwind 的类选择器都是单类，特异性完全一样，所以「谁生效」只剩两件事：`!important` 和源顺序。这也是为什么 `twMerge` 这类工具做的事情根本不是在算特异性，而是在**合并同一属性的声明**——它知道 `p-2` 和 `pt-8` 是同一族（padding），所以能判断后者的 top 该覆盖前者。\n\n我的 `resolveUtilities` 就是这件事的教学版：先把简写展开成四个长写（`padding` → 四个方向），再按属性分组，`!important` 无条件提升，平级比较 order。注意第四步的测试——`pt-8` 写在 `p-2` 前面时，简写反而覆盖了长写：**源顺序永远比「简写/长写」的身份更强势**，这跟很多人以为的「长写更具体所以赢」正好相反。'
    },
    {
      title: 'token 的两个坑：var() 是引用不是值，自定义属性会继承',
      md: '`var(--color-text)` 不是把字符串塞进去，而是一次查表；查表可能再遇到 `var()`，于是要有递归和**环检测**。浏览器遇到循环引用会让该属性变成无效值（回落到 fallback 或继承值），我的实现返回 `undefined` 交给调用方决定——这是「纯函数不做 IO、把策略留给上层」的典型取舍。\n\n第二个坑是继承：CSS 自定义属性默认继承，所以子组件不用重新声明就能读到父级 token，而同名 token 在子级声明就覆盖。`inheritTokens` 就是这条规则：从外到内依次合并，只认 `--` 开头的键。工程上这意味着「主题切换只要换最外层的一个 class，整棵树自动生效」。'
    }
  ],
  prereq: [
    {
      title: 'Electron 与 Tauri 的进程模型差在哪',
      md: 'Electron 自带一份锁定版本的 Chromium + Node.js：主进程跑 Node、渲染进程跑浏览器，两者用 IPC 通信，任何 Node 原生模块（PDF 生成、抓取、串口）都能直接用——代价是安装包 100MB 级别、内存占用高，且 Chromium 版本要自己跟着升级。\n\nTauri 不带浏览器，渲染层用系统 WebView（Windows 的 WebView2、macOS 的 WKWebView、Linux 的 WebKitGTK），核心是 Rust：`wry` 包 WebView、`tao` 跑事件循环，能力通过 `#[tauri::command]` 暴露，权限用 capability 的 JSON 清单按窗口粒度声明。所以它小、省内存、权限收得住，但渲染一致性依赖系统 WebView 版本，扩展原生能力要写 Rust。'
    },
    {
      title: '原子化 CSS 的成立逻辑与 JIT 扫描',
      md: '原子化的核心不是「短类名」，而是**把样式选择压成「声明 + 约束」**：`p-4` 只能取设计系统里的间距阶梯，于是「随手写 13px」这件事从机制上消失了；同时每条规则只有一个类选择器，特异性恒定，不存在 BEM 那种越写越深的心算。\n\n代价是构建期必须知道「你用到了哪些类」：Tailwind 的 JIT 扫描源文件里的完整字面量，把类名拆成两段再拼起来（比如 text- 加 color 变量）就扫不到、也就不生成——这是新手第一坑，解法是写完整字面量或 safelist。产物因此从「全量几 MB 再 purge」变成「用到才生成」的几十 KB。'
    },
    {
      title: 'CSS 自定义属性与 var() 的回退',
      md: '`--brand: #3b82f6` 定义的是「一个可继承的自定义属性」，用 `var(--brand)` 取值。`var()` 支持回退：`var(--brand, #000)` 在 `--brand` 未定义（或非法）时用 `#000`。\n\n它和 Sass 变量的根本区别是**运行时**：自定义属性在浏览器里参与层叠与继承，可以被媒体查询、`:hover`、甚至 JS 改写；Sass 变量在编译期就被替换掉了。所以设计 token 现在普遍用 CSS 变量承载——换主题只是换最外层的一组变量值。'
    }
  ],
  api: [
    {
      name: 'scoreContainer',
      sig: 'scoreContainer(demand) => { electron, tauri, pick, matched, risks }',
      args: 'demand 是布尔需求集合，可含 bundle / memory / renderConsistency / nodeNative / mobile / rust / permission。未出现的键视为「无所谓」。',
      returns: '两个分数、选型结果 pick（平手回落 electron）、命中的信号列表、以及按选型生成的风险清单。',
      example: "const res = scoreContainer({ bundle: true, memory: true })\nsame(res.pick, 'tauri')\nsame(res.tauri, 6)"
    },
    {
      name: 'resolveUtilities',
      sig: 'resolveUtilities(classList, registry) => { prop, value, important }[]',
      args: 'classList 是类名数组（按出现顺序）；registry 是「类名 → 声明数组」的映射，声明为 { prop, value, important? }。padding/margin/inset/gap 会被展开成四个长写。',
      returns: '按属性名排序的生效声明表；每属性只有一个赢家：important 优先，其次源顺序靠后者。',
      example: "const out = resolveUtilities(['p-2', 'pt-8'], {\n  'p-2': [{ prop: 'padding', value: '8px' }],\n  'pt-8': [{ prop: 'padding-top', value: '32px' }]\n})\nsame(out.length, 4)"
    },
    {
      name: 'resolveToken',
      sig: 'resolveToken(name, theme, seen?) => string | undefined',
      args: 'name 形如 "--color-text"；theme 是 token 名到值的映射，值里可以再写 var(--other)。seen 是内部用的环检测栈，调用方不用传。',
      returns: '解析到最终值；token 不存在或引用成环时返回 undefined。',
      example: "same(resolveToken('--color-text', {\n  '--color-brand': '#3b82f6',\n  '--color-text': 'var(--color-brand)'\n}), '#3b82f6')"
    },
    {
      name: 'inheritTokens',
      sig: 'inheritTokens(chain) => object',
      args: 'chain 是从最外层到最内层的 token 对象数组；非 "--" 开头的键会被忽略。',
      returns: '合并后的 token 表，内层同名键覆盖外层。',
      example: "same(inheritTokens([{ '--gap': '4px' }, { '--gap': '8px' }])['--gap'], '8px')"
    }
  ],
  usage: "// 1) 立项时给容器选型打分（把结论和风险一起贴进设计文档）\nconst choice = scoreContainer({ bundle: true, memory: true, rust: true })\nconsole.log(choice.pick, choice.risks)   // 'tauri' []\n\n// 2) 组件库合并外部传入的原子类，避免「谁覆盖谁」靠猜\nconst merged = resolveUtilities(['p-2', 'px-4', 'pt-8'], registry)\nconsole.log(merged.map((d) => d.prop + '=' + d.value).join(' '))\n\n// 3) 解析设计系统的主题链\nconst theme = {\n  '--brand': '#3b82f6',\n  '--text': 'var(--brand)',\n  '--border': 'var(--brand-dark, #dbeafe)'\n}\nconsole.log(resolveToken('--text', theme))    // '#3b82f6'\nconsole.log(resolveToken('--border', theme))  // '#dbeafe'（fallback 生效）\n\n// 4) 主题覆盖：外层定义、内层只改一个 token\nconsole.log(inheritTokens([theme, { '--brand': '#ef4444' }])['--text'])   // 仍是 var(--brand)，换的是变量本身",
  hints: [
    '第一步先把七个信号写成一张权重表（每个信号两边各一个分值），scoreContainer 只剩「查表求和 + 平手回落 + 生成风险」三件事。',
    '第二步的关键是「展开」：先在展开阶段把 padding/margin/inset/gap 变成四个长写，再让所有声明一起按属性分组比 important 和 order——不要在比之前就按简写/长写分优先级。',
    '第三步要给 resolveToken 加一个 seen 数组做环检测；inheritTokens 就是按外层到内层的顺序赋值，只挑 "--" 开头的键。'
  ],
  concepts: [
    {
      title: '为什么 Tailwind 的类名冲突需要专门的合并器',
      md: '原生 CSS 里 `p-2` 和 `px-4` 谁赢取决于源顺序，而原子类的源顺序由**构建产物里的规则顺序**决定，跟你写在 `class` 属性里的顺序无关——这就是「两个类同时生效、结果看运气」的根源。\n\n`tailwind-merge`（twMerge）在运行时按「属性族」解析类名：它知道 `px-4` 覆盖 `p-2` 的左右内边距，也知道 `text-sm` 和 `text-red-500` 不是同一族（字号 vs 颜色），合并后只留下该留的类。本关的 `resolveUtilities` 把这件事降维成声明级合并：不解析类名语义，直接吃「类名 → 声明」的映射，但覆盖规则一模一样。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '先给容器接缝打分',
      think: '选型题最容易变成站队，所以第一步先把「需求 → 分数」写成一张表。这张表一旦固定下来，讨论就从「我觉得 Tauri 更好」变成「你这项需求打几分」，而平手回落策略也必须显式写出来，否则每次评审都要重吵一遍。',
      hint: '写一张 CONTAINER_SIGNALS 权重表（每个信号 electron/tauri 各一个分值），遍历命中项求和；pick 用 tauri > electron 判断，平手回落 electron；最后按结果拼风险清单。',
      vocab: [
        { term: 'WebView2', desc: 'Windows 上 Tauri 使用的系统浏览器内核，未预装的系统需要 bootstrapper' },
        { term: 'capability', desc: 'Tauri 2 的权限清单：用 JSON 按窗口声明允许调用的命令与作用域' }
      ],
      code: `const CONTAINER_SIGNALS = {
  bundle: { electron: 0, tauri: 3 },              // 安装包体积敏感
  memory: { electron: 0, tauri: 3 },              // 常驻内存敏感
  renderConsistency: { electron: 3, tauri: 0 },   // 需要锁定版本渲染 / 老系统兼容
  nodeNative: { electron: 3, tauri: 0 },          // 直接复用 Node 原生模块（PDF、抓取）
  mobile: { electron: 0, tauri: 3 },              // 桌面与移动一份代码
  rust: { electron: 0, tauri: 3 },                // 团队能写 Rust
  permission: { electron: 1, tauri: 3 }           // 权限要声明式收口
}

/**
 * scoreContainer(demand) -> { electron, tauri, pick, matched, risks }
 * 简化：权重是固定的教学值，真实项目应按团队与交付周期调整
 */
function scoreContainer(demand) {
  const d = demand == null ? {} : demand
  let electron = 0
  let tauri = 0
  const matched = []

  for (const key of Object.keys(CONTAINER_SIGNALS)) {
    if (d[key] === true) {
      electron += CONTAINER_SIGNALS[key].electron
      tauri += CONTAINER_SIGNALS[key].tauri
      matched.push(key)
    }
  }

  // 平手回落 Electron：生态与 Node 原生模块的「省事」是默认值，Tauri 的优势要需求来兑现
  const pick = tauri > electron ? 'tauri' : 'electron'
  const risks = []

  if (pick === 'tauri') {
    if (d.rust !== true) risks.push('团队需要补 Rust：command / 插件 / sidecar 都要写')
    if (d.renderConsistency === true) risks.push('WebView 版本随系统走，渲染一致性要按平台测')
  } else {
    if (d.bundle === true || d.memory === true) risks.push('包体积与常驻内存是 Electron 的固定成本')
    risks.push('Chromium 版本要自己升级，安全补丁得跟官方版本')
  }

  return { electron: electron, tauri: tauri, pick: pick, matched: matched, risks: risks }
}`,
      test: L4S1,
      diag: [
        '权重表被写成了「谁赢就加谁」，或者漏掉了 bundle/memory 两项；两项都命中应该是 tauri 6 分。',
        'nodeNative 的权重给了 Tauri，或者 renderConsistency 的权重给了 Tauri——这两项恰恰是 Electron 的强项。',
        '平手判断写成了 tauri >= electron，于是空需求也会选 Tauri；平手要回落 Electron。',
        'matched 记录了所有信号而不是只记录命中的；空需求时应该是空数组。',
        'permission 被当成一票否决（直接 return tauri），实际它是 1:3 的加分项。',
        '风险清单只在单一分支里拼，打平时没有把「包体积/内存」这项成本写进去。'
      ]
    },
    {
      n: 2,
      title: '再消解原子类冲突',
      think: '这一步故意不复用第 1 步的代码，因为它是另一条主线（样式工程）。但思路是延续的：第 1 步把选型拆成权重表，这一步把「类名覆盖」拆成「展开 + 分组 + 裁决」三步——同样是把凭感觉的事变成能算的事。',
      hint: '先把 padding/margin/inset/gap 展开成四个长写，再遍历所有声明按属性分组；每组里 important 优先，平级比 order（越后越大）。',
      vocab: [
        { term: 'JIT', desc: 'Just-In-Time：构建期扫描源码里出现的完整类名，用到才生成对应 CSS' },
        { term: 'twMerge', desc: 'tailwind-merge：按属性族合并冲突的原子类，后写的覆盖先写的' }
      ],
      code: `const SHORTHANDS = {
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  inset: ['top', 'right', 'bottom', 'left'],
  gap: ['row-gap', 'column-gap']
}

/**
 * resolveUtilities(classList, registry) -> [{ prop, value, important }]
 * 简化：不解析类名语义，只吃「类名 -> 声明」的映射；真实工具（twMerge）是按类名规则解析的
 */
function resolveUtilities(classList, registry) {
  const list = classList == null ? [] : classList
  const map = registry == null ? {} : registry
  const decls = []
  let order = 0

  // 阶段一：展开 —— 简写变成四个长写，顺序就是源顺序
  for (const cls of list) {
    const entry = map[cls]
    if (!entry) continue
    for (const d of entry) {
      const props = SHORTHANDS[d.prop] == null ? [d.prop] : SHORTHANDS[d.prop]
      for (const prop of props) {
        decls.push({ prop: prop, value: d.value, important: d.important === true, order: order })
      }
      order += 1
    }
  }

  // 阶段二：裁决 —— important 无条件提升，平级看谁写得靠后
  const winners = new Map()
  for (const d of decls) {
    const cur = winners.get(d.prop)
    if (!cur) {
      winners.set(d.prop, d)
      continue
    }
    if (d.important && !cur.important) {
      winners.set(d.prop, d)
      continue
    }
    if (!d.important && cur.important) continue
    if (d.order >= cur.order) winners.set(d.prop, d)
  }

  const props = []
  winners.forEach((d, prop) => props.push(prop))
  props.sort()

  return props.map((prop) => {
    const w = winners.get(prop)
    return { prop: prop, value: w.value, important: w.important }
  })
}`,
      test: L4S2,
      diag: [
        '没有按属性分组，而是直接返回所有声明；同一属性只该留一个赢家。',
        'important 比较放在了 order 之后，于是靠后的普通声明赢过了 important。',
        '简写没有展开成四个长写，`p-2` 只产出了一条 padding 声明。',
        '展开后没有更新 order（所有声明共用 0），导致后写的长写覆盖不了先写的简写。',
        '未注册的类抛错或产出了空值声明；空输入应该直接返回空数组。',
        'gap 的展开方向写反（row/column 对调），或者 gap 没有进 SHORTHANDS。'
      ]
    },
    {
      n: 3,
      title: '最后解析 token 与继承',
      think: '原子类和 token 是同一套设计系统的两面：类名管「用哪个阶梯」，token 管「阶梯的值是多少」。这一步做 token 的解析与继承，重点不是哈希表，而是两个边界——var() 的引用链可能成环，自定义属性的继承必须沿链合并。',
      hint: 'resolveValue 遇到 var( 就剥出名字和 fallback 递归查；resolveToken 用一个 seen 数组挡环。inheritTokens 从外到内合并，只收 "--" 开头的键。',
      vocab: [
        { term: 'design token', desc: '设计令牌：把颜色/间距/字号命名成变量，让设计约束能进代码' },
        { term: 'fallback', desc: 'var() 的第二个参数：变量未定义或非法时使用的回退值' }
      ],
      code: `const SHORTHANDS = {
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  inset: ['top', 'right', 'bottom', 'left'],
  gap: ['row-gap', 'column-gap']
}

function resolveUtilities(classList, registry) {
  const list = classList == null ? [] : classList
  const map = registry == null ? {} : registry
  const decls = []
  let order = 0

  for (const cls of list) {
    const entry = map[cls]
    if (!entry) continue
    for (const d of entry) {
      const props = SHORTHANDS[d.prop] == null ? [d.prop] : SHORTHANDS[d.prop]
      for (const prop of props) {
        decls.push({ prop: prop, value: d.value, important: d.important === true, order: order })
      }
      order += 1
    }
  }

  const winners = new Map()
  for (const d of decls) {
    const cur = winners.get(d.prop)
    if (!cur) {
      winners.set(d.prop, d)
      continue
    }
    if (d.important && !cur.important) {
      winners.set(d.prop, d)
      continue
    }
    if (!d.important && cur.important) continue
    if (d.order >= cur.order) winners.set(d.prop, d)
  }

  const props = []
  winners.forEach((d, prop) => props.push(prop))
  props.sort()

  return props.map((prop) => {
    const w = winners.get(prop)
    return { prop: prop, value: w.value, important: w.important }
  })
}

/**
 * resolveValue(raw, theme, seen) -> string | undefined
 * var(--name, fallback) 的解析器；fallback 本身也可以是 var()
 */
function resolveValue(raw, theme, seen) {
  const text = String(raw == null ? '' : raw).trim()

  if (text.length > 4 && text.slice(0, 4) === 'var(' && text[text.length - 1] === ')') {
    const inner = text.slice(4, text.length - 1)
    const comma = inner.indexOf(',')
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim()
    const fallback = comma < 0 ? '' : inner.slice(comma + 1).trim()

    const resolved = resolveToken(name, theme, seen)
    if (resolved !== undefined) return resolved
    return fallback === '' ? undefined : resolveValue(fallback, theme, seen)
  }

  return text
}

/**
 * resolveToken(name, theme, seen) -> string | undefined
 * seen 是环检测栈：拿不到值就返回 undefined，把「用不用回退」留给调用方
 */
function resolveToken(name, theme, seen) {
  const map = theme == null ? {} : theme
  const guard = seen == null ? [] : seen

  if (guard.indexOf(name) >= 0) return undefined
  if (!(name in map)) return undefined

  return resolveValue(map[name], map, guard.concat([name]))
}

/**
 * inheritTokens(chain) -> object
 * 自定义属性默认继承：从最外层到最内层依次覆盖，只收 "--" 开头的键
 */
function inheritTokens(chain) {
  const layers = chain == null ? [] : chain
  const out = {}

  for (const layer of layers) {
    const source = layer == null ? {} : layer
    for (const key of Object.keys(source)) {
      if (key.slice(0, 2) === '--') out[key] = source[key]
    }
  }

  return out
}`,
      test: L4S3,
      diag: [
        'resolveToken 直接返回 theme[name] 而没有走 resolveValue，于是 var() 原样漏了出去。',
        'resolveValue 只剥了 var( 没有剥最后的 )，或者逗号切分把整个 fallback 当成了名字。',
        '缺失 token 时返回了字符串 undefined（或者直接抛错），没有交给调用方决定回退。',
        '没有 seen 环检测，循环引用把调用栈打爆；或者检测后抛错而不是返回值。',
        'inheritTokens 用了 Object.assign 但没收 "--" 前缀判断，把 color/padding 这类普通属性也继承下去了。',
        '合并顺序反了（从内到外），于是父级覆盖了子级；空链没有返回空对象。'
      ]
    }
  ],
  skeleton: `function scoreContainer(demand) {
  throw new Error('scoreContainer 还没实现')
}

function resolveUtilities(classList, registry) {
  throw new Error('resolveUtilities 还没实现')
}

function resolveToken(name, theme) {
  throw new Error('resolveToken 还没实现')
}

function inheritTokens(chain) {
  throw new Error('inheritTokens 还没实现')
}`,
  solution: `const CONTAINER_SIGNALS = {
  bundle: { electron: 0, tauri: 3 },
  memory: { electron: 0, tauri: 3 },
  renderConsistency: { electron: 3, tauri: 0 },
  nodeNative: { electron: 3, tauri: 0 },
  mobile: { electron: 0, tauri: 3 },
  rust: { electron: 0, tauri: 3 },
  permission: { electron: 1, tauri: 3 }
}

function scoreContainer(demand) {
  const d = demand == null ? {} : demand
  let electron = 0
  let tauri = 0
  const matched = []

  for (const key of Object.keys(CONTAINER_SIGNALS)) {
    if (d[key] === true) {
      electron += CONTAINER_SIGNALS[key].electron
      tauri += CONTAINER_SIGNALS[key].tauri
      matched.push(key)
    }
  }

  const pick = tauri > electron ? 'tauri' : 'electron'
  const risks = []

  if (pick === 'tauri') {
    if (d.rust !== true) risks.push('团队需要补 Rust：command / 插件 / sidecar 都要写')
    if (d.renderConsistency === true) risks.push('WebView 版本随系统走，渲染一致性要按平台测')
  } else {
    if (d.bundle === true || d.memory === true) risks.push('包体积与常驻内存是 Electron 的固定成本')
    risks.push('Chromium 版本要自己升级，安全补丁得跟官方版本')
  }

  return { electron: electron, tauri: tauri, pick: pick, matched: matched, risks: risks }
}

const SHORTHANDS = {
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  inset: ['top', 'right', 'bottom', 'left'],
  gap: ['row-gap', 'column-gap']
}

function resolveUtilities(classList, registry) {
  const list = classList == null ? [] : classList
  const map = registry == null ? {} : registry
  const decls = []
  let order = 0

  for (const cls of list) {
    const entry = map[cls]
    if (!entry) continue
    for (const d of entry) {
      const props = SHORTHANDS[d.prop] == null ? [d.prop] : SHORTHANDS[d.prop]
      for (const prop of props) {
        decls.push({ prop: prop, value: d.value, important: d.important === true, order: order })
      }
      order += 1
    }
  }

  const winners = new Map()
  for (const d of decls) {
    const cur = winners.get(d.prop)
    if (!cur) {
      winners.set(d.prop, d)
      continue
    }
    if (d.important && !cur.important) {
      winners.set(d.prop, d)
      continue
    }
    if (!d.important && cur.important) continue
    if (d.order >= cur.order) winners.set(d.prop, d)
  }

  const props = []
  winners.forEach((d, prop) => props.push(prop))
  props.sort()

  return props.map((prop) => {
    const w = winners.get(prop)
    return { prop: prop, value: w.value, important: w.important }
  })
}

function resolveValue(raw, theme, seen) {
  const text = String(raw == null ? '' : raw).trim()

  if (text.length > 4 && text.slice(0, 4) === 'var(' && text[text.length - 1] === ')') {
    const inner = text.slice(4, text.length - 1)
    const comma = inner.indexOf(',')
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim()
    const fallback = comma < 0 ? '' : inner.slice(comma + 1).trim()

    const resolved = resolveToken(name, theme, seen)
    if (resolved !== undefined) return resolved
    return fallback === '' ? undefined : resolveValue(fallback, theme, seen)
  }

  return text
}

function resolveToken(name, theme, seen) {
  const map = theme == null ? {} : theme
  const guard = seen == null ? [] : seen

  if (guard.indexOf(name) >= 0) return undefined
  if (!(name in map)) return undefined

  return resolveValue(map[name], map, guard.concat([name]))
}

function inheritTokens(chain) {
  const layers = chain == null ? [] : chain
  const out = {}

  for (const layer of layers) {
    const source = layer == null ? {} : layer
    for (const key of Object.keys(source)) {
      if (key.slice(0, 2) === '--') out[key] = source[key]
    }
  }

  return out
}`,
  finalCode: `const CONTAINER_SIGNALS = {
  bundle: { electron: 0, tauri: 3 },
  memory: { electron: 0, tauri: 3 },
  renderConsistency: { electron: 3, tauri: 0 },
  nodeNative: { electron: 3, tauri: 0 },
  mobile: { electron: 0, tauri: 3 },
  rust: { electron: 0, tauri: 3 },
  permission: { electron: 1, tauri: 3 }
}

function scoreContainer(demand) {
  const d = demand == null ? {} : demand
  let electron = 0
  let tauri = 0
  const matched = []

  for (const key of Object.keys(CONTAINER_SIGNALS)) {
    if (d[key] === true) {
      electron += CONTAINER_SIGNALS[key].electron
      tauri += CONTAINER_SIGNALS[key].tauri
      matched.push(key)
    }
  }

  const pick = tauri > electron ? 'tauri' : 'electron'
  const risks = []

  if (pick === 'tauri') {
    if (d.rust !== true) risks.push('团队需要补 Rust：command / 插件 / sidecar 都要写')
    if (d.renderConsistency === true) risks.push('WebView 版本随系统走，渲染一致性要按平台测')
  } else {
    if (d.bundle === true || d.memory === true) risks.push('包体积与常驻内存是 Electron 的固定成本')
    risks.push('Chromium 版本要自己升级，安全补丁得跟官方版本')
  }

  return { electron: electron, tauri: tauri, pick: pick, matched: matched, risks: risks }
}

const SHORTHANDS = {
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  inset: ['top', 'right', 'bottom', 'left'],
  gap: ['row-gap', 'column-gap']
}

function resolveUtilities(classList, registry) {
  const list = classList == null ? [] : classList
  const map = registry == null ? {} : registry
  const decls = []
  let order = 0

  for (const cls of list) {
    const entry = map[cls]
    if (!entry) continue
    for (const d of entry) {
      const props = SHORTHANDS[d.prop] == null ? [d.prop] : SHORTHANDS[d.prop]
      for (const prop of props) {
        decls.push({ prop: prop, value: d.value, important: d.important === true, order: order })
      }
      order += 1
    }
  }

  const winners = new Map()
  for (const d of decls) {
    const cur = winners.get(d.prop)
    if (!cur) {
      winners.set(d.prop, d)
      continue
    }
    if (d.important && !cur.important) {
      winners.set(d.prop, d)
      continue
    }
    if (!d.important && cur.important) continue
    if (d.order >= cur.order) winners.set(d.prop, d)
  }

  const props = []
  winners.forEach((d, prop) => props.push(prop))
  props.sort()

  return props.map((prop) => {
    const w = winners.get(prop)
    return { prop: prop, value: w.value, important: w.important }
  })
}

function resolveValue(raw, theme, seen) {
  const text = String(raw == null ? '' : raw).trim()

  if (text.length > 4 && text.slice(0, 4) === 'var(' && text[text.length - 1] === ')') {
    const inner = text.slice(4, text.length - 1)
    const comma = inner.indexOf(',')
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim()
    const fallback = comma < 0 ? '' : inner.slice(comma + 1).trim()

    const resolved = resolveToken(name, theme, seen)
    if (resolved !== undefined) return resolved
    return fallback === '' ? undefined : resolveValue(fallback, theme, seen)
  }

  return text
}

function resolveToken(name, theme, seen) {
  const map = theme == null ? {} : theme
  const guard = seen == null ? [] : seen

  if (guard.indexOf(name) >= 0) return undefined
  if (!(name in map)) return undefined

  return resolveValue(map[name], map, guard.concat([name]))
}

function inheritTokens(chain) {
  const layers = chain == null ? [] : chain
  const out = {}

  for (const layer of layers) {
    const source = layer == null ? {} : layer
    for (const key of Object.keys(source)) {
      if (key.slice(0, 2) === '--') out[key] = source[key]
    }
  }

  return out
}`,
  tests: `${L4S1}

${L4S2}

${L4S3}`
}

/* ============================================================ 项目导出 */

export default {
  id: 'fe-css',
  version: 3,
  domain: 'fe',
  cumulative: false,
  title: 'CSS 规则引擎：从层叠到布局求解',
  emoji: '🎨',
  tagline: '4 关 12 步：把「说不清」的 CSS 与前端生态规则，写成能断言的纯函数。',
  stack: ['CSS', '布局', 'React', 'Tauri/Tailwind'],
  intro: 'CSS 最难的地方不是「写不出效果」，而是「说不清为什么是这个效果」。这一季把四组最容易说不清的知识点拆成可计算的模型：层叠与盒模型、Flex/Grid/定位/媒体查询、React 的 diff 与 SSR 分块、以及 Electron/Tauri 与原子化 CSS 的工程取舍。每一关都要求你交出纯函数——没有 DOM、没有浏览器，只有声明对象和视口尺寸进、尺寸与判定出。把规则写成函数之后，你才能在面试里当场推导，而不是背结论。',
  outcome: '做完之后，你能白板写出选择器权重的三元组比较、用四级顺序解释「为什么我的样式没生效」、手算 border-box 的内容宽度、判断一个容器是否建立 BFC；能按 flex-basis/grow/shrink 与 min/max 夹取手算主轴分配、按 fr + minmax + auto-fit 手算网格轨道、说清 absolute/fixed/sticky 各相对谁定位、手写媒体查询与断点序列；能讲清 Fiber 的 key 复用与 move、lane 合并与 memo bailout、SSR 的分块预算与渲染模式矩阵；也能给 Electron 与 Tauri 打分、消解原子化类冲突、解析设计 token 的 var() 链。',
  levels: [LV1, LV2, LV3, LV4]
}