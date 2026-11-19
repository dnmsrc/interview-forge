/**
 * fe-vue：前端双线 · uni-app 跨端 + Vue3 内核（5 关）
 *
 * 全部模型都是「可以在判题沙箱里跑」的纯函数简化版：
 *   - 没有真实编译器、没有真实小程序容器、没有定时器；
 *   - 需要「稍后执行」的地方用 Promise.resolve().then 表达微任务；
 *   - 需要「桥」的地方用显式 flush() 表达批量，而不是等真实 setData 回环。
 * 每关的 thinking / concepts 里都写明了简化了什么、为什么这样简化仍然成立。
 */

/* ============================================================ 第 1 关测试 */
const L1S1 = `{
  const SRC = [
    'A',
    '// #ifdef MP-WEIXIN',
    'B',
    '// #ifdef H5',
    'C',
    '// #endif',
    '// #endif',
    '// #ifndef H5',
    'D',
    '// #endif',
    'E'
  ].join('\\n')

  check('MP-WEIXIN：保留本平台分支与 ifndef 命中的行', () => {
    same(resolveConditional(SRC, 'MP-WEIXIN'), ['A', 'B', 'D', 'E'].join('\\n'))
  })
  check('H5：外层 ifdef 不命中时内层整块一起被丢掉', () => {
    same(resolveConditional(SRC, 'H5'), ['A', 'E'].join('\\n'))
  })
  check('嵌套的 #else 只在未命中时接管', () => {
    const src = ['// #ifdef MP-WEIXIN', 'X', '// #else', 'Y', '// #endif'].join('\\n')
    same(resolveConditional(src, 'MP-WEIXIN'), 'X')
    same(resolveConditional(src, 'H5'), 'Y')
    same(resolveConditional(src, 'APP'), 'Y')
  })
  check('指令行本身不会出现在任何产物里', () => {
    same(resolveConditional(SRC, 'H5').indexOf('#ifdef'), -1)
    same(resolveConditional(SRC, 'MP-WEIXIN').indexOf('#endif'), -1)
  })
  check('resolveMulti 一次求出三端产物', () => {
    const all = resolveMulti(SRC, ['MP-WEIXIN', 'H5', 'APP'])
    same(Object.keys(all).length, 3)
    same(all['MP-WEIXIN'], ['A', 'B', 'D', 'E'].join('\\n'))
    same(all['APP'], ['A', 'D', 'E'].join('\\n'))
  })
}`

const L1S2 = `{
  check('静态属性保留，:prop 变成双花括号绑定', () => {
    same(toWxml('<view id="app" :title="msg">{{ count }}</view>'),
      '<view id="app" title="{{msg}}">{{ count }}</view>')
  })
  check('v-if / v-else 映射成 wx:if / wx:else', () => {
    same(toWxml('<view v-if="ok">yes</view>'), '<view wx:if="{{ok}}">yes</view>')
    same(toWxml('<view v-else>no</view>'), '<view wx:else>no</view>')
  })
  check('v-for 的括号写法要展开 for-item 与 for-index', () => {
    same(toWxml('<view v-for="(item, index) in list">{{ item }}</view>'),
      '<view wx:for="{{list}}" wx:for-item="item" wx:for-index="index">{{ item }}</view>')
    same(toWxml('<view v-for="row in rows">{{ row }}</view>'),
      '<view wx:for="{{rows}}" wx:for-item="row">{{ row }}</view>')
  })
  check('事件前缀 bind，带 .stop 修饰符改用 catch', () => {
    same(toWxml('<button @tap="submit">ok</button>'), '<button bindtap="submit">ok</button>')
    same(toWxml('<button @tap.stop="submit">ok</button>'), '<button catchtap="submit">ok</button>')
  })
  check('v-show 只能近似成 hidden，v-model 必须编译期展开', () => {
    same(toWxml('<view v-show="open">box</view>'), '<view hidden="{{!open}}">box</view>')
    let err = null
    try { toWxml('<input v-model="text">') } catch (e) { err = e }
    same(err !== null, true, 'v-model 不能静默翻译，必须抛错')
  })
}`

const L1S3 = `{
  check('打开页面走 onLoad → onShow → onReady', () => {
    same(runNav(['open:index']), ['index:onLoad', 'index:onShow', 'index:onReady'])
  })
  check('navigateTo 先隐藏旧页再进新页，返回时旧页只 onShow', () => {
    same(runNav(['open:index', 'navigateTo:detail', 'navigateBack']), [
      'index:onLoad', 'index:onShow', 'index:onReady',
      'index:onHide',
      'detail:onLoad', 'detail:onShow', 'detail:onReady',
      'detail:onUnload',
      'index:onShow'
    ])
  })
  check('redirectTo 换掉当前页：旧页 onUnload 之后新页才进场', () => {
    same(runNav(['open:index', 'redirectTo:login']), [
      'index:onLoad', 'index:onShow', 'index:onReady',
      'index:onUnload',
      'login:onLoad', 'login:onShow', 'login:onReady'
    ])
  })
  check('reLaunch 从栈顶往下逐页 onUnload，再开目标页', () => {
    same(runNav(['open:index', 'navigateTo:detail', 'reLaunch:home']), [
      'index:onLoad', 'index:onShow', 'index:onReady',
      'index:onHide',
      'detail:onLoad', 'detail:onShow', 'detail:onReady',
      'detail:onUnload', 'index:onUnload',
      'home:onLoad', 'home:onShow', 'home:onReady'
    ])
  })
  check('setData 先同步改 this.data，flush 才拿到合并后的差量', () => {
    const page = createPageData({ count: 0, list: [] })
    page.setData({ count: 1 })
    same(page.data.count, 1, 'this.data 必须立刻可见')
    page.setData({ count: 1 })
    page.setData({ list: [1] })
    const diff = page.flush()
    same(Object.keys(diff).sort(), ['count', 'list'], '同值不产生差量，两次调用合批')
    same(diff.count, 1)
    same(Object.keys(page.flush()).length, 0, 'flush 之后桥队列必须清空')
  })
}`

/* ============================================================ 第 1 关 */
const LV1 = {
  id: 'lv1',
  title: '跨端编译与小程序运行时',
  emoji: '🧩',
  xp: 40,
  goal: '实现三个模型：resolveConditional / resolveMulti 求出多端产物、toWxml 把 Vue 模板指令映射成 WXML、runNav + createPageData 复现页面栈生命周期与 setData 桥接。',
  why: '跨端框架的面试题几乎都落在两处：编译期决定哪些代码根本进不了产物，运行时桥决定一次数据更新要付多少通信成本。条件编译的嵌套求值、v-for 到 wx:for 的参数展开、navigateBack 之后上一个页面只触发 onShow 而不是 onLoad、setData 为什么必须先合批再送桥——这些点背文档答不深，必须自己实现一遍才知道顺序为什么是这样。本关用纯函数把编译期与运行时的关键顺序钉死。',
  nodes: ['fe.uniapp.compile', 'fe.uniapp.compile.conditional', 'fe.uniapp.compile.cross-platform', 'fe.uniapp.mini', 'fe.uniapp.mini.lifecycle', 'fe.uniapp.mini.runtime'],
  thinking: [
    {
      title: '条件编译是「删代码」，不是「运行时 if」',
      md: '很多人以为 `// #ifdef MP-WEIXIN` 会被编译成 `if (platform === "MP-WEIXIN")`。不是的：它在**词法阶段就把不命中的行整段删掉**，产物里连注释都不剩。\n\n这个差别有真实后果：`#ifdef MP-WEIXIN` 里写的 `wx.login()` 在 H5 产物里根本不存在，所以运行时永远不会因为「平台不支持」而崩；反过来，如果你把平台判断写成运行时的 `if`，打包器就没法帮你摇掉那段代码。\n\n所以求值器要维护一个**栈**：每进入一层 ifdef/ifndef 就压一个 `{ on, taken }`，只有栈上每一层都 on 时当前行才输出。'
    },
    {
      title: '指令映射的难点是「一对多」和「无处可去」',
      md: '`v-if` 到 `wx:if` 是一对一，好办；`v-for` 是一对三（`wx:for` + `wx:for-item` + `wx:for-index`），因为 WXML 的循环变量名是属性而不是语法，你必须把 `(item, index) in list` 拆开重新拼。\n\n更麻烦的是「无处可去」：`v-show` 在小程序端没有对应指令，只能用 `hidden="{{!x}}"` 近似（差别是 hidden 仍然会创建节点、只是不渲染）；`v-model` 更彻底——它必须被编译期展开成 `value` 加 `bindinput`，映射器遇到它只能报错，让上层编译流程处理。这就是「不可映射项」的由来，第 2 关会系统整理。'
    },
    {
      title: 'setData 贵在「跨线程」，所以先合批再算差量',
      md: '小程序的逻辑层和视图层是两个线程，`setData` 的每一次调用都是一次跨线程序列化 + 通信。所以运行时做了两件事：**同一轮里多次 setData 合并成一条消息**，以及**只把真正变化的键送过去**。\n\n但有个反直觉的细节：`this.data` 是**同步**更新的——你调用完 setData 立刻读 `this.data.foo` 就能看到新值，哪怕视图还没刷新。原因是逻辑层必须保证后续代码读到一致的数据，而视图层的刷新是异步的。本关用 `flush()` 显式代替那一次异步回环，把「同步改 data、异步送桥」这个顺序固定下来。'
    }
  ],
  prereq: [
    {
      title: '先把「栈」当成状态机来用',
      md: '条件编译的嵌套和页面栈是同一种结构：一个数组，压栈 / 弹栈，任何时刻的行为只取决于栈的当前内容。\n\n```js\nconst stack = []\nstack.push({ on: true, taken: true })   // 进入一层 ifdef\nconst active = stack.every((f) => f.on)  // 当前行是否输出\nstack.pop()                              // #endif\n```\n\n页面栈同理：`stack` 存页面 id，`navigateTo` 压栈、`navigateBack` 弹栈，而生命周期事件是**栈变化的副作用**。写之前先问自己：这个操作改变了栈的哪一部分？被改变的那部分该发哪些事件？'
    },
    {
      title: '手写词法扫描比正则可靠',
      md: '解析 `<view v-for="(item, i) in list">` 这种属性串，用正则很容易在「带引号的值里有空格」上翻车。手写一个字符游标更稳：\n\n```js\nlet i = 0\nwhile (i < src.length) {\n  // 跳过空格 → 读名字直到 = 或空格 → 遇到 = 再读引号内的值\n}\n```\n\n本关的 `readAttrs` 就是这么写的：状态只有「读名字」和「读值」两种，读引号值时就一直吃到下一个引号。判题沙箱里没有 DOM 解析器可用，手写扫描是唯一路径。'
    }
  ],
  api: [
    {
      name: 'resolveConditional',
      sig: 'resolveConditional(src: string, platform: string) => string',
      args: 'src 是带 `// #ifdef` / `// #ifndef` / `// #else` / `// #endif` 指令的源码文本；platform 是目标平台名（MP-WEIXIN / H5 / APP）。',
      returns: '把不命中平台的行（含指令行本身）删掉之后剩下的文本，行序与缩进原样保留。',
      example: 'resolveConditional(\'// #ifdef H5\\nconsole.log(1)\\n// #endif\\nok\', \'MP-WEIXIN\')\n// => \'ok\''
    },
    {
      name: 'resolveMulti',
      sig: 'resolveMulti(src: string, platforms: string[]) => Record<string, string>',
      args: 'src 同上的源码文本；platforms 是要一次求值的平台列表（顺序决定返回对象的键序）。',
      returns: '平台名到产物的映射，用于「三端产物对比」。',
      example: 'const all = resolveMulti(src, [\'MP-WEIXIN\', \'H5\'])\nall[\'H5\']   // => H5 端的产物文本'
    },
    {
      name: 'toWxml',
      sig: 'toWxml(tpl: string) => string',
      args: 'tpl 是单个元素的模板字符串（可以有属性、文本子节点；不支持嵌套元素与自闭合标签写法）。',
      returns: '映射后的 WXML 文本：v-if/v-else → wx:if/wx:else，v-for → wx:for 三件套，:prop → 双花括号绑定，@evt → bind/catch 前缀，v-show → hidden 取反。',
      example: 'toWxml(\'<view v-if="ok" @tap="go">{{ msg }}</view>\')\n// => \'<view wx:if="{{ok}}" bindtap="go">{{ msg }}</view>\''
    },
    {
      name: 'runNav',
      sig: 'runNav(script: string[]) => string[]',
      args: 'script 是跳转指令序列，支持 `open:id`、`navigateTo:id`、`redirectTo:id`、`navigateBack`、`reLaunch:id`。',
      returns: '按发生顺序记录的生命周期事件数组，元素形如 `detail:onShow`。',
      example: 'runNav([\'open:index\', \'navigateTo:detail\', \'navigateBack\'])\n// => [\'index:onLoad\', \'index:onShow\', \'index:onReady\', \'index:onHide\', ...]'
    },
    {
      name: 'createPageData',
      sig: 'createPageData(initial: object) => { data, setData(patch), flush() }',
      args: 'initial 是页面初始 data；setData 接收一个键值补丁对象；flush 无参数。',
      returns: 'data 是同步可读的当前数据（getter）；setData 同步合并进 data 并把非零差量记进待发队列；flush 返回本轮合批后的差量对象（无变化时是空对象），并清空队列。',
      example: 'const page = createPageData({ count: 0 })\npage.setData({ count: 1 })\npage.data.count        // 1，立刻可见\npage.flush()           // { count: 1 }'
    }
  ],
  usage: '// 编译器插件的骨架：先按平台删代码，再把模板翻成目标 DSL\nconst pool = resolveMulti(readFile(entry), [\'MP-WEIXIN\', \'H5\', \'APP\'])\nfor (const platform of Object.keys(pool)) {\n  const wxml = toWxml(extractTemplate(pool[platform]))\n  writeFile(outDir(platform) + \'/index.wxml\', wxml)\n}\n\n// 运行时探针：把真机上的生命周期顺序拍下来，和 runNav 的期望值做对比\nconst real = []\nPage({ onLoad() { real.push(\'index:onLoad\') }, /* … */ })',
  hints: [
    '第 1 步别想平台差异，只维护一个 stack：每层存 { on, taken }，else 时把 on 改成 !taken。',
    '第 2 步先写 readAttrs 把属性拆成 [名字, 值] 数组，再逐条映射；v-for 一条要 push 三对。',
    '第 3 步把「栈变化」和「发事件」分开写：navigateTo = 旧页 onHide + 压栈 + 新页三连。',
    '第 3 步的 setData 用 JSON.stringify 判等来算差量，同值的键不要进 pending。'
  ],
  concepts: [
    {
      title: '逻辑层 / 视图层双线程是这套 API 的根源',
      md: '小程序把 JS 执行放在逻辑线程，把渲染放在视图线程（WebView 或原生渲染器），两边不能共享对象，只能传可序列化的 JSON。所以：setData 的参数必须是可序列化的、传大对象会卡、频繁调用会排队。uni-app 在 App 端多了第三种选择（weex 渲染或原生渲染），但「跨线程传数据」的本质不变。'
    },
    {
      title: '这条链上还有哪些真实环节被简化掉了',
      md: '真实的 uni-app 编译链是「vue-loader 拿到 SFC → 平台插件改写 AST → 生成 wxml/js/json/wxss 四件套」，本关只保留了最能量化的两端：条件编译删除与指令映射。真实的 setData 回环由框架调度，本关用显式 flush() 代替；页面栈还支持 switchTab / 分包预载，本关只保留四种最常见指令。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '条件编译：按平台删代码',
      think: '先做一个只会「删行」的求值器：不命中的分支整段不输出，指令行本身也不输出。关键是嵌套——外层不命中时内层连求值都不该发生。',
      hint: 'stack 每层存 { on, taken }，else 把 on 改成 !taken，endif 弹栈；active 用 every 判断。',
      code: `function resolveConditional(src, platform) {
  const out = []
  const stack = []

  const active = () => stack.every((frame) => frame.on)

  for (const raw of src.split('\\n')) {
    const line = raw.trim()
    const body = line.slice(0, 2) === '//' ? line.slice(2).trim() : ''
    if (body[0] === '#') {
      const parts = body.slice(1).trim().split(' ').filter(Boolean)
      const kind = parts[0]
      const name = parts[1] || ''
      if (kind === 'ifdef' || kind === 'ifndef') {
        const hit = name === platform
        const on = kind === 'ifdef' ? hit : !hit
        stack.push({ on, taken: on })
        continue
      }
      if (kind === 'else') {
        const top = stack[stack.length - 1]
        if (top) top.on = !top.taken
        continue
      }
      if (kind === 'endif') {
        stack.pop()
        continue
      }
    }
    if (active()) out.push(raw)
  }
  return out.join('\\n')
}

function resolveMulti(src, platforms) {
  const out = {}
  for (const p of platforms) out[p] = resolveConditional(src, p)
  return out
}`,
      test: L1S1,
      diag: [
        'active 没有考虑嵌套：只看了栈顶那一层，外层不命中时内层仍然输出。',
        'taken 记成了 hit 而不是 on，导致 #ifndef 的 #else 分支和内层同时输出。',
        'else 分支写成 on = true，没命中时两段都留下（必须用 !taken 判断）。',
        'endif 没有弹栈（或者弹了两次），后面所有行都跟着序列错乱。',
        '指令行自己也被 push 进了 out，产物里出现 // #ifdef 注释。'
      ]
    },
    {
      n: 2,
      title: '模板指令映射到 WXML',
      think: '把一条模板标签拆成「标签名 + 属性数组 + 内部文本」，再逐条改写属性。v-for 是一对多，需要把循环表达式拆成源数组、item 名和 index 名。',
      hint: 'readAttrs 用字符游标扫描；遇到名字以 : 开头就包双花括号，以 @ 开头就换成 bind/catch 前缀。',
      code: `function readAttrs(src) {
  const list = []
  let i = 0
  while (i < src.length) {
    while (src[i] === ' ') i++
    if (i >= src.length) break
    let name = ''
    while (i < src.length && src[i] !== '=' && src[i] !== ' ') {
      name += src[i]
      i++
    }
    let value = ''
    if (src[i] === '=') {
      i++
      if (src[i] === '"') {
        i++
        while (i < src.length && src[i] !== '"') {
          value += src[i]
          i++
        }
        i++
      } else {
        while (i < src.length && src[i] !== ' ') {
          value += src[i]
          i++
        }
      }
    }
    list.push([name, value])
  }
  return list
}

function parseFor(expr) {
  const at = expr.indexOf(' in ')
  if (at < 0) throw new Error('v-for 语法无法识别: ' + expr)
  const lhs = expr.slice(0, at).trim()
  const source = expr.slice(at + 4).trim()
  let item = lhs
  let index = ''
  if (lhs[0] === '(') {
    const names = lhs.slice(1, lhs.lastIndexOf(')')).split(',')
    item = names[0].trim()
    index = (names[1] || '').trim()
  }
  return { item, index, source }
}

function toWxml(tpl) {
  const s = tpl.trim()
  if (s[0] !== '<' || s.indexOf('>') < 0) throw new Error('非法模板: ' + tpl)
  const head = s.slice(1, s.indexOf('>'))
  const name = head.split(' ')[0]
  const attrs = readAttrs(head.slice(name.length))
  const closeAt = s.lastIndexOf('</')
  const inner = (closeAt > 0 ? s.slice(s.indexOf('>') + 1, closeAt) : '').trim()

  const out = []
  for (const pair of attrs) {
    const key = pair[0]
    const value = pair[1]
    if (key === 'v-if') out.push(['wx:if', '{{' + value + '}}'])
    else if (key === 'v-else') out.push(['wx:else', ''])
    else if (key === 'v-show') out.push(['hidden', '{{!' + value + '}}'])
    else if (key === 'v-for') {
      const f = parseFor(value)
      out.push(['wx:for', '{{' + f.source + '}}'])
      out.push(['wx:for-item', f.item])
      if (f.index) out.push(['wx:for-index', f.index])
    }
    else if (key === 'v-model') throw new Error('v-model 无法直接映射，需编译期展开为 value + bindinput')
    else if (key[0] === ':') {
      const target = key.slice(1) === 'key' ? 'wx:key' : key.slice(1)
      out.push([target, '{{' + value + '}}'])
    }
    else if (key[0] === '@') {
      const bits = key.slice(1).split('.')
      const prefix = bits.indexOf('stop') >= 0 ? 'catch' : 'bind'
      out.push([prefix + bits[0], value])
    }
    else out.push([key, value])
  }

  const attrText = out
    .map((pair) => (pair[1] === '' ? pair[0] : pair[0] + '="' + pair[1] + '"'))
    .join(' ')
  const openTag = '<' + name + (attrText ? ' ' + attrText : '') + '>'
  if (closeAt < 0) return openTag
  const text = inner.split(' ').filter(Boolean).join(' ')
  return openTag + text + '</' + name + '>'
}`,
      test: L1S2,
      diag: [
        'readAttrs 把带引号的值连同引号一起存了，输出里出现双重引号。',
        'v-for 只输出了 wx:for，忘了 for-item / for-index 两个伴随属性。',
        '@tap 的映射直接保留了 @ 号，没有换成 bind / catch 前缀。',
        'v-show 写成了 wx:if（语义差别是把节点真的删掉），应该用 hidden 取反。',
        'v-model 静默返回了原字符串，测试期望它抛错并提示编译期展开。'
      ]
    },
    {
      n: 3,
      title: '页面栈生命周期与 setData 桥',
      think: '生命周期不是一张顺序表，而是「栈变化」的副作用。把每个跳转指令翻译成 push / pop / 发事件三个原子动作，顺序就自然正确了。',
      hint: 'enter 固定发 onLoad → onShow → onReady；navigateBack 弹栈后如果还有页面，给新栈顶发 onShow。',
      code: `function runNav(script) {
  const stack = []
  const events = []
  const emit = (id, hook) => events.push(id + ':' + hook)
  const enter = (id) => {
    stack.push(id)
    emit(id, 'onLoad')
    emit(id, 'onShow')
    emit(id, 'onReady')
  }

  for (const op of script) {
    const cut = op.indexOf(':')
    const kind = cut < 0 ? op : op.slice(0, cut)
    const id = cut < 0 ? '' : op.slice(cut + 1)
    if (kind === 'open') {
      enter(id)
    } else if (kind === 'navigateTo') {
      if (stack.length) emit(stack[stack.length - 1], 'onHide')
      enter(id)
    } else if (kind === 'redirectTo') {
      if (stack.length) {
        emit(stack[stack.length - 1], 'onUnload')
        stack.pop()
      }
      enter(id)
    } else if (kind === 'navigateBack') {
      if (!stack.length) continue
      emit(stack[stack.length - 1], 'onUnload')
      stack.pop()
      if (stack.length) emit(stack[stack.length - 1], 'onShow')
    } else if (kind === 'reLaunch') {
      while (stack.length) {
        emit(stack[stack.length - 1], 'onUnload')
        stack.pop()
      }
      enter(id)
    } else {
      throw new Error('未知跳转指令: ' + op)
    }
  }
  return events
}

function createPageData(initial) {
  const data = Object.assign({}, initial)
  let pending = {}
  let hasPending = false

  return {
    get data() {
      return data
    },
    setData(patch) {
      for (const key of Object.keys(patch)) {
        const changed = JSON.stringify(data[key]) !== JSON.stringify(patch[key])
        if (changed) {
          pending[key] = patch[key]
          hasPending = true
        }
        data[key] = patch[key]
      }
    },
    flush() {
      if (!hasPending) return {}
      const out = pending
      pending = {}
      hasPending = false
      return out
    }
  }
}`,
      test: L1S3,
      diag: [
        'navigateTo 忘了给旧页发 onHide，事件序列里直接少了这一条。',
        'navigateBack 只弹栈没给新的栈顶发 onShow，返回后页面显示不出来。',
        'redirectTo 用成了 navigateTo（旧页只 onHide 没有 onUnload，栈越积越深）。',
        'reLaunch 从栈底往上发 onUnload，顺序反了（必须先销毁栈顶）。',
        'setData 没有同步写进 data，测试里 page.data.count 还是旧值。'
      ]
    }
  ],
  skeleton: `function resolveConditional(src, platform) {
  // TODO: 用栈记录每一层 ifdef/ifndef 的开关，不命中的行整段不输出
  throw new Error('resolveConditional 还没实现')
}

function resolveMulti(src, platforms) {
  throw new Error('resolveMulti 还没实现')
}

function toWxml(tpl) {
  // TODO: 拆出标签名与属性，逐条改写 v-if / v-for / :prop / @evt
  throw new Error('toWxml 还没实现')
}

function runNav(script) {
  // TODO: 用页面栈回放跳转指令，记录生命周期事件
  throw new Error('runNav 还没实现')
}

function createPageData(initial) {
  // TODO: 同步合并 data，合批差量等到 flush 再送出
  throw new Error('createPageData 还没实现')
}`,
  solution: `function resolveConditional(src, platform) {
  const out = []
  const stack = []

  const active = () => stack.every((frame) => frame.on)

  for (const raw of src.split('\\n')) {
    const line = raw.trim()
    const body = line.slice(0, 2) === '//' ? line.slice(2).trim() : ''
    if (body[0] === '#') {
      const parts = body.slice(1).trim().split(' ').filter(Boolean)
      const kind = parts[0]
      const name = parts[1] || ''
      if (kind === 'ifdef' || kind === 'ifndef') {
        const hit = name === platform
        const on = kind === 'ifdef' ? hit : !hit
        stack.push({ on, taken: on })
        continue
      }
      if (kind === 'else') {
        const top = stack[stack.length - 1]
        if (top) top.on = !top.taken
        continue
      }
      if (kind === 'endif') {
        stack.pop()
        continue
      }
    }
    if (active()) out.push(raw)
  }
  return out.join('\\n')
}

function resolveMulti(src, platforms) {
  const out = {}
  for (const p of platforms) out[p] = resolveConditional(src, p)
  return out
}

function readAttrs(src) {
  const list = []
  let i = 0
  while (i < src.length) {
    while (src[i] === ' ') i++
    if (i >= src.length) break
    let name = ''
    while (i < src.length && src[i] !== '=' && src[i] !== ' ') {
      name += src[i]
      i++
    }
    let value = ''
    if (src[i] === '=') {
      i++
      if (src[i] === '"') {
        i++
        while (i < src.length && src[i] !== '"') {
          value += src[i]
          i++
        }
        i++
      } else {
        while (i < src.length && src[i] !== ' ') {
          value += src[i]
          i++
        }
      }
    }
    list.push([name, value])
  }
  return list
}

function parseFor(expr) {
  const at = expr.indexOf(' in ')
  if (at < 0) throw new Error('v-for 语法无法识别: ' + expr)
  const lhs = expr.slice(0, at).trim()
  const source = expr.slice(at + 4).trim()
  let item = lhs
  let index = ''
  if (lhs[0] === '(') {
    const names = lhs.slice(1, lhs.lastIndexOf(')')).split(',')
    item = names[0].trim()
    index = (names[1] || '').trim()
  }
  return { item, index, source }
}

function toWxml(tpl) {
  const s = tpl.trim()
  if (s[0] !== '<' || s.indexOf('>') < 0) throw new Error('非法模板: ' + tpl)
  const head = s.slice(1, s.indexOf('>'))
  const name = head.split(' ')[0]
  const attrs = readAttrs(head.slice(name.length))
  const closeAt = s.lastIndexOf('</')
  const inner = (closeAt > 0 ? s.slice(s.indexOf('>') + 1, closeAt) : '').trim()

  const out = []
  for (const pair of attrs) {
    const key = pair[0]
    const value = pair[1]
    if (key === 'v-if') out.push(['wx:if', '{{' + value + '}}'])
    else if (key === 'v-else') out.push(['wx:else', ''])
    else if (key === 'v-show') out.push(['hidden', '{{!' + value + '}}'])
    else if (key === 'v-for') {
      const f = parseFor(value)
      out.push(['wx:for', '{{' + f.source + '}}'])
      out.push(['wx:for-item', f.item])
      if (f.index) out.push(['wx:for-index', f.index])
    }
    else if (key === 'v-model') throw new Error('v-model 无法直接映射，需编译期展开为 value + bindinput')
    else if (key[0] === ':') {
      const target = key.slice(1) === 'key' ? 'wx:key' : key.slice(1)
      out.push([target, '{{' + value + '}}'])
    }
    else if (key[0] === '@') {
      const bits = key.slice(1).split('.')
      const prefix = bits.indexOf('stop') >= 0 ? 'catch' : 'bind'
      out.push([prefix + bits[0], value])
    }
    else out.push([key, value])
  }

  const attrText = out
    .map((pair) => (pair[1] === '' ? pair[0] : pair[0] + '="' + pair[1] + '"'))
    .join(' ')
  const openTag = '<' + name + (attrText ? ' ' + attrText : '') + '>'
  if (closeAt < 0) return openTag
  const text = inner.split(' ').filter(Boolean).join(' ')
  return openTag + text + '</' + name + '>'
}

function runNav(script) {
  const stack = []
  const events = []
  const emit = (id, hook) => events.push(id + ':' + hook)
  const enter = (id) => {
    stack.push(id)
    emit(id, 'onLoad')
    emit(id, 'onShow')
    emit(id, 'onReady')
  }

  for (const op of script) {
    const cut = op.indexOf(':')
    const kind = cut < 0 ? op : op.slice(0, cut)
    const id = cut < 0 ? '' : op.slice(cut + 1)
    if (kind === 'open') {
      enter(id)
    } else if (kind === 'navigateTo') {
      if (stack.length) emit(stack[stack.length - 1], 'onHide')
      enter(id)
    } else if (kind === 'redirectTo') {
      if (stack.length) {
        emit(stack[stack.length - 1], 'onUnload')
        stack.pop()
      }
      enter(id)
    } else if (kind === 'navigateBack') {
      if (!stack.length) continue
      emit(stack[stack.length - 1], 'onUnload')
      stack.pop()
      if (stack.length) emit(stack[stack.length - 1], 'onShow')
    } else if (kind === 'reLaunch') {
      while (stack.length) {
        emit(stack[stack.length - 1], 'onUnload')
        stack.pop()
      }
      enter(id)
    } else {
      throw new Error('未知跳转指令: ' + op)
    }
  }
  return events
}

function createPageData(initial) {
  const data = Object.assign({}, initial)
  let pending = {}
  let hasPending = false

  return {
    get data() {
      return data
    },
    setData(patch) {
      for (const key of Object.keys(patch)) {
        const changed = JSON.stringify(data[key]) !== JSON.stringify(patch[key])
        if (changed) {
          pending[key] = patch[key]
          hasPending = true
        }
        data[key] = patch[key]
      }
    },
    flush() {
      if (!hasPending) return {}
      const out = pending
      pending = {}
      hasPending = false
      return out
    }
  }
}`,
  finalCode: '',
  tests: `${L1S1}\n${L1S2}\n${L1S3}`
}

// finalCode 与 solution 同源：都是「整关测试全绿」的那份最终代码，避免把同一大段代码粘两遍。
LV1.finalCode = LV1.solution

/* ============================================================ 第 2 关测试 */
const L2S1 = `{
  const ROWS = [
    { name: 'uni-app', scores: { miniapp: 5, h5: 5, native: 3, eco: 4, perf: 3 } },
    { name: 'taro', scores: { miniapp: 4, h5: 4, native: 2, eco: 4, perf: 3 } },
    { name: 'flutter', scores: { miniapp: 0, h5: 2, native: 5, eco: 5, perf: 5 } },
    { name: 'native', scores: { miniapp: 5, h5: 0, native: 0, eco: 2, perf: 5 } }
  ]
  const W = { miniapp: 3, h5: 2, native: 2, eco: 1, perf: 2 }

  check('加权总分 = 各维度分乘权重再求和', () => {
    same(weightedTotal(ROWS[0], W), 41)
    same(weightedTotal(ROWS[3], W), 27)
  })
  check('缺失维度按 0 分计，不抛错', () => {
    same(weightedTotal({ name: 'x', scores: { miniapp: 5 } }, W), 15)
  })
  check('排名按总分从高到低', () => {
    const ranked = rankFrameworks(ROWS, W)
    same(ranked.map((r) => r.name), ['uni-app', 'taro', 'flutter', 'native'])
    same(ranked[0].total, 41)
    same(ranked.length, 4)
  })
  check('同分时按名称升序，保证结果稳定可复现', () => {
    const rows = [
      { name: 'beta', scores: { a: 1 } },
      { name: 'alpha', scores: { a: 1 } },
      { name: 'gamma', scores: { a: 2 } }
    ]
    same(rankFrameworks(rows, { a: 1 }).map((r) => r.name), ['gamma', 'alpha', 'beta'])
  })
}`

const L2S2 = `{
  const OPT = {
    props: ['title', 'count'],
    data: () => ({ msg: 'hi' }),
    methods: { onTap() { return 1 } },
    created() {},
    mounted() {},
    unmounted() {},
    watch: { msg() {} },
    computed: { total() { return 2 } },
    provide: { theme: 'dark' },
    scopedStyle: true
  }
  const res = mapComponent(OPT)

  check('props 变成 properties，data 函数被调用成对象', () => {
    same(Object.keys(res.mapped.properties), ['title', 'count'])
    same(res.mapped.data.msg, 'hi')
  })
  check('methods 原样搬过去，this 语义不变', () => {
    same(typeof res.mapped.methods.onTap, 'function')
    same(res.mapped.methods.onTap(), 1)
  })
  check('三个生命周期映射到 lifetimes 的 created / ready / detached', () => {
    same(Object.keys(res.mapped.lifetimes), ['created', 'ready', 'detached'])
    same(typeof res.mapped.lifetimes.ready, 'function')
  })
  check('computed / provide / scopedStyle 记为不可映射项，按固定顺序列出', () => {
    same(res.unmappable.map((x) => x.key), ['computed', 'provide', 'scopedStyle'])
    same(res.unmappable[0].reason.length > 10, true, '每条不可映射项都要给出原因')
    same(res.mapped.observers && Object.keys(res.mapped.observers), ['msg'])
  })
}`

const L2S3 = `{
  const ROWS = [
    { name: 'uni-app', scores: { miniapp: 5, h5: 5, native: 3, eco: 4, perf: 3 } },
    { name: 'taro', scores: { miniapp: 4, h5: 4, native: 2, eco: 4, perf: 3 } },
    { name: 'flutter', scores: { miniapp: 0, h5: 2, native: 5, eco: 5, perf: 5 } },
    { name: 'native', scores: { miniapp: 5, h5: 0, native: 0, eco: 2, perf: 5 } }
  ]
  const W = { miniapp: 3, h5: 2, native: 2, eco: 1, perf: 2 }

  check('先按硬性要求过滤，剩下的才参与排名', () => {
    const plan = recommendStack(ROWS, W, { miniapp: 4, native: 3 })
    same(plan.picked, ['uni-app'])
  })
  check('被淘汰的候选要带上没达标的维度', () => {
    const plan = recommendStack(ROWS, W, { miniapp: 4, native: 3 })
    same(plan.rejected.map((r) => r.name), ['taro', 'flutter', 'native'])
    same(plan.rejected[0].fails, ['native'])
    same(plan.rejected[1].fails, ['miniapp'])
  })
  check('没有硬性要求时退化成纯排名', () => {
    const plan = recommendStack(ROWS, W, {})
    same(plan.picked, ['uni-app', 'taro', 'flutter', 'native'])
    same(plan.rejected.length, 0)
  })
  check('全部不达标时 picked 为空，多项不达标都记进 fails', () => {
    const plan = recommendStack(ROWS, W, { native: 4, h5: 6 })
    same(plan.picked, [])
    same(plan.rejected.length, 4)
    same(plan.rejected[0].fails, ['native', 'h5'])
  })
}`

/* ============================================================ 第 2 关 */
const LV2 = {
  id: 'lv2',
  title: 'uni-app 生态定位与跨框架对照',
  emoji: '🗺️',
  xp: 50,
  goal: '实现选型与迁移两件工具：weightedTotal / rankFrameworks / recommendStack 做多端覆盖与生态的加权选型，mapComponent / migrationReport 把 Vue3 组件选项映射到小程序组件并列出不可映射项。',
  why: '选型题最怕两种答法：一种是「我们用了 uni-app 所以它最好」，另一种是罗列参数却不给权重。可用的答法是先确定硬性约束（必须覆盖哪些端、最低性能要求），再用权重打分排序，并明确说出每个候选在哪一维不达标。迁移题同理：跨框架不是「写法差不多」，而是有一批选项在小程序端根本没有等价物，必须提前点名，否则迁移到一半才发现 computed 和 provide 全要重写。本关把这两件事做成可复现的评分与映射模型。',
  nodes: ['fe.uniapp.ecosystem', 'fe.uniapp.ecosystem.cross-framework'],
  thinking: [
    {
      title: '选型的正确顺序：先硬约束，再软打分',
      md: '把「多端覆盖」当成硬约束、把「生态 / 性能」当成软指标，是一个能落地的判断框架：业务如果必须上微信小程序 + H5，那 Flutter 再怎么性能好也不该进候选（它的 web 端是另一套产物、小程序基本没有官方路径）。\n\n所以 `recommendStack` 先按 `needs` 过滤，剩下的才用权重算总分。这样回答面试官时可以说清「为什么排除」而不是只给一个排名。权重本身要能解释：多端覆盖权重高，是因为它在编译期就决定了项目能不能做；生态权重低，是因为它可以用时间和人力补。'
    },
    {
      title: '不可映射项才是跨框架的真成本',
      md: '能映射的东西（props、methods、data、生命周期）其实都很便宜，真正吃工期的是「没有等价物」的那一批：`computed` 在小程序里不存在，只能用 `data` 加 `observers` 手动维护派生值；`provide/inject` 没有跨层注入，只能挂 `globalData` 或事件总线；`scoped` 样式的隔离机制完全不同。\n\n所以迁移评估的产出不应该是「兼容度 80%」这种数字，而应该是一张「不可映射清单加替代方案」。本关的 `migrationReport` 就是把清单变成可计数的风险等级：blocked 越多、占比越高，风险越高。'
    },
    {
      title: '生命周期名不同，语义也不是一一对应',
      md: 'Vue 的 `created` 对应小程序的 `created`、`mounted` 对应 `ready`、`unmounted` 对应 `detached`，看起来整齐，但触发时机并不等价：小程序的 `ready` 只保证「视图层首次渲染完成」，而 Vue 的 `mounted` 在 H5 端对应 DOM 已插入。更麻烦的是 `onShow` / `onHide` 这对页面级钩子在 Vue 组件里根本没有对应位置，跨端框架只能把它挂在页面组件上。映射表要写「名字对照」也要写「时机差异」。'
    }
  ],
  prereq: [
    {
      title: '把「矩阵」组织成可计算的结构',
      md: '评分表的最小结构是「行 = 候选、列 = 维度」：\n\n```js\nconst ROWS = [{ name: \'uni-app\', scores: { miniapp: 5, h5: 5 } }]\nconst W = { miniapp: 3, h5: 2 }\n```\n\n用对象而不是数组存维度，好处是缺列不会错位（少一个维度就是少一个键），坏处是要自己保证 `Object.keys(W)` 的顺序。总分 = Σ 分数 × 权重，不需要做除法归一化——只要所有权重同量级，排序结果就够了，而且全是整数，不会踩浮点比较的坑。'
    },
    {
      title: '映射函数要区分「搬家」和「重写」',
      md: '写 `mapComponent` 之前先把 Vue 的选项分三类：\n\n1. **可直接搬家**：`props` → `properties`、`methods` → `methods`、`data()` → `data`；\n2. **改名但要改写**：`created/mounted/unmounted` → `lifetimes.created/ready/detached`；\n3. **没有等价物**：`computed`、`provide/inject`、`scoped` 样式。\n\n前两类进 `mapped`，第三类进 `unmappable` 并且必须带原因。返回值里保留原因，是让报告能直接当迁移文档用。'
    }
  ],
  api: [
    {
      name: 'weightedTotal',
      sig: 'weightedTotal(row: { name, scores }, weights: Record<string, number>) => number',
      args: 'row.scores 是维度到分数的映射（整数）；weights 是维度到权重的映射，键集合决定参与计算的维度。',
      returns: '加权总分（整数）；缺失的维度按 0 分计，不抛错。',
      example: 'weightedTotal({ name: \'uni-app\', scores: { miniapp: 5, h5: 5 } }, { miniapp: 3, h5: 2 })\n// => 25'
    },
    {
      name: 'rankFrameworks',
      sig: 'rankFrameworks(rows, weights) => Array<{ name, total }>',
      args: 'rows 是候选数组；weights 同 weightedTotal（所有行共用一套权重）。',
      returns: '按总分降序排列的新数组；同分时按 name 的字符序升序，保证多次调用结果一致。',
      example: 'rankFrameworks(ROWS, W).map((r) => r.name)\n// => [\'uni-app\', \'taro\', \'flutter\', \'native\']'
    },
    {
      name: 'recommendStack',
      sig: 'recommendStack(rows, weights, needs) => { picked: string[], rejected: Array<{ name, fails }> }',
      args: 'needs 是硬性最低分（维度名到最低分）；为空对象表示没有硬约束。',
      returns: 'picked 是达标候选按总分排序后的名字数组；rejected 是不达标候选，fails 列出未达标的维度（按 needs 的键序）。',
      example: 'recommendStack(ROWS, W, { miniapp: 4, native: 3 })\n// => { picked: [\'uni-app\'], rejected: [{ name: \'taro\', fails: [\'native\'] }, ...] }'
    },
    {
      name: 'mapComponent',
      sig: 'mapComponent(option) => { mapped, unmappable }',
      args: 'option 是 Vue3 组件选项对象，支持 props / data / methods / created / mounted / unmounted / watch / computed / provide / scopedStyle / emits。',
      returns: 'mapped 里放小程序组件能直接用的字段（properties、data、methods、lifetimes、observers）；unmappable 是 [{ key, reason }] 数组，按固定顺序列出没有等价物的选项。',
      example: 'const { mapped, unmappable } = mapComponent({ props: [\'title\'], computed: { a() {} } })\n// mapped.properties.title.value === null\n// unmappable[0].key === \'computed\''
    },
    {
      name: 'migrationReport',
      sig: 'migrationReport(option) => { total, mapped, blocked, risk }',
      args: 'option 同 mapComponent。',
      returns: 'total 是声明的选项类数，mapped 是成功映射出的类数，blocked 是不可映射的 key 数组，risk 按 blocked 占比落到 low / medium / high（占比大于 0.4 才算 high）。',
      example: 'migrationReport({ props: [\'a\'], data: () => ({}), computed: { b() {} } })\n// => { total: 3, mapped: 2, blocked: [\'computed\'], risk: \'medium\' }'
    }
  ],
  usage: '// 一次技术选型评审的产出：硬约束过滤 + 加权排名 + 迁移风险\nconst plan = recommendStack(candidates, weights, { miniapp: 4, native: 3 })\nconsole.log(plan.picked, plan.rejected)\n\n// 迁移前先跑一遍现状组件，把不可映射项折算成工时\nfor (const file of vueFiles) {\n  const report = migrationReport(readComponent(file))\n  if (report.risk === \'high\') console.log(file, report.blocked)\n}',
  hints: [
    '第 1 步用 Object.keys(weights) 遍历维度，总分不需要归一化。',
    '第 1 步排序比较器里同分分支必须返回名称比较结果，否则顺序会随引擎变。',
    '第 2 步 props 用 Array.isArray 判断两种写法（数组 / 对象）。',
    '第 2 步 unmappable 的顺序固定成 computed → provide → scopedStyle → emits，测试才好断言。',
    '第 3 步先算 fails 再决定去留；rejected 里不要丢掉 fails 数组。'
  ],
  concepts: [
    {
      title: 'uni-app / Taro / Flutter / 原生小程序的位置',
      md: 'uni-app 与 Taro 都是「编译期转译」路线：把 Vue 或 React 的写法转成各端 DSL，优点是复用 Web 生态、缺点是被各端能力天花板压住；Flutter 是「自带渲染引擎」路线，一套 Skia 渲染保证一致，代价是包体与 web 端体验；原生小程序最贴近平台能力，但多端就要多套代码。没有普适赢家，只有「硬约束下谁不达标」。'
    },
    {
      title: '本关简化了什么',
      md: '真实评分表的维度要更细（团队技能、CI 支持、包体、社区活跃度、长期维护风险），而且权重需要评审共识；本关只保留五个可量化的技术维度。映射部分也做了简化：真实的 uni-app 会生成完整的小程序组件四件套（wxml/js/json/wxss），本关只输出组件选项这一层，样式与模板分别在第 1 关和第 4 关处理。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '加权评分表：把选型变成可复现的排名',
      think: '先只做「算总分 + 排序」这两件最基础的事。分数和权重都用整数，避免浮点比较；同分必须有确定的次序，否则同一个评审跑两次结论不同。',
      hint: '总分遍历 Object.keys(weights)，缺维度用 0 兜底；排序比较器返回 (b.total - a.total) 或名称比较。',
      code: `function weightedTotal(row, weights) {
  let total = 0
  for (const dim of Object.keys(weights)) {
    total += (row.scores[dim] || 0) * weights[dim]
  }
  return total
}

function rankFrameworks(rows, weights) {
  const scored = rows.map((row) => ({ name: row.name, total: weightedTotal(row, weights) }))
  scored.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total
    if (a.name < b.name) return -1
    if (a.name > b.name) return 1
    return 0
  })
  return scored
}`,
      test: L2S1,
      diag: [
        'weightedTotal 把维度写死成数组下标，缺一个维度就整体错位。',
        '排序比较器只写了总分差，同分时顺序不稳定（测试要求名称升序）。',
        'rankFrameworks 直接改了入参数组的顺序（应该 map 出新数组）。',
        '缺失维度没有兜底，row.scores[dim] 是 undefined 导致 total 变成 NaN。'
      ]
    },
    {
      n: 2,
      title: '跨框架映射：能搬的搬，不能搬的列出来',
      think: '把 Vue 选项分三类：直接搬家、改名、没有等价物。前两类进 mapped，第三类进 unmappable 并带上原因——原因比布尔值有用得多。',
      hint: 'props 可能是数组也可能是对象；生命周期用 lifetimes.created / ready / detached 承载。',
      code: `function mapComponent(option) {
  const mapped = {}
  const unmappable = []
  const block = (key, reason) => unmappable.push({ key, reason })

  if (option.props) {
    const names = Array.isArray(option.props) ? option.props : Object.keys(option.props)
    const properties = {}
    for (const name of names) properties[name] = { type: null, value: null }
    mapped.properties = properties
  }
  if (typeof option.data === 'function') mapped.data = option.data()
  if (option.methods) mapped.methods = Object.assign({}, option.methods)

  const lifetimes = {}
  if (option.created) lifetimes.created = option.created
  if (option.mounted) lifetimes.ready = option.mounted
  if (option.unmounted) lifetimes.detached = option.unmounted
  if (Object.keys(lifetimes).length) mapped.lifetimes = lifetimes

  if (option.watch) {
    const observers = {}
    for (const key of Object.keys(option.watch)) observers[key] = option.watch[key]
    mapped.observers = observers
  }

  if (option.computed) block('computed', '小程序没有 computed，只能用 data 加 observers 手动维护派生值')
  if (option.provide) block('provide', '没有跨层注入，只能挂 globalData 或事件总线')
  if (option.scopedStyle) block('scopedStyle', '样式隔离由 styleIsolation 决定，scoped 属性没有对应物')
  if (option.emits) block('emits', '组件事件要手写 triggerEvent，声明式 emits 不参与编译')
  return { mapped, unmappable }
}

function migrationReport(option) {
  const res = mapComponent(option)
  const total = Object.keys(option).length
  const mapped = Object.keys(res.mapped).length
  const blocked = res.unmappable.map((x) => x.key)
  const ratio = total === 0 ? 0 : blocked.length / total
  const risk = blocked.length === 0 ? 'low' : ratio > 0.4 ? 'high' : 'medium'
  return { total, mapped, blocked, risk }
}`,
      test: L2S2,
      diag: [
        'props 只处理了数组写法，对象写法的键被当成空数组。',
        'data 直接把函数塞进 mapped.data，没有调用，下游读不到字段。',
        '生命周期名照搬 Vue（mounted 还是 mounted），没有落到 lifetimes.ready。',
        'unmappable 里只放了 key 没有 reason，测试断言 reason 长度时失败。'
      ]
    },
    {
      n: 3,
      title: '先过硬约束，再谈排名',
      think: '选型的最后一步是把「必须满足的条件」和「越高越好」分开：不达标的候选直接出局并说明哪一维不够，达标者才参与加权排名。',
      hint: '对每个 needs 的键比较 row.scores[dim] 与最低分，任一不达标就进 rejected 并记 fails。',
      code: `function weightedTotal(row, weights) {
  let total = 0
  for (const dim of Object.keys(weights)) {
    total += (row.scores[dim] || 0) * weights[dim]
  }
  return total
}

function rankFrameworks(rows, weights) {
  const scored = rows.map((row) => ({ name: row.name, total: weightedTotal(row, weights) }))
  scored.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total
    if (a.name < b.name) return -1
    if (a.name > b.name) return 1
    return 0
  })
  return scored
}

function recommendStack(rows, weights, needs) {
  const dims = Object.keys(needs || {})
  const passed = []
  const rejected = []
  for (const row of rows) {
    const fails = dims.filter((dim) => (row.scores[dim] || 0) < needs[dim])
    if (fails.length) rejected.push({ name: row.name, fails })
    else passed.push(row)
  }
  return {
    picked: rankFrameworks(passed, weights).map((row) => row.name),
    rejected
  }
}`,
      test: L2S3,
      diag: [
        'needs 为空数组或空对象时抛错，没有退化成纯排名。',
        '把不达标候选也塞进了 picked，只是排在后面。',
        'fails 只记了第一个不达标维度，漏掉其它维度。',
        'rejected 的顺序跟着排名走，而应该保持输入的候选顺序。'
      ]
    }
  ],
  skeleton: `function weightedTotal(row, weights) {
  // TODO: 按 weights 的键遍历维度，累加 scores[dim] * weights[dim]
  throw new Error('weightedTotal 还没实现')
}

function rankFrameworks(rows, weights) {
  throw new Error('rankFrameworks 还没实现')
}

function mapComponent(option) {
  // TODO: 分三类处理 Vue 选项：搬家、改名、无等价物
  throw new Error('mapComponent 还没实现')
}

function migrationReport(option) {
  throw new Error('migrationReport 还没实现')
}

function recommendStack(rows, weights, needs) {
  throw new Error('recommendStack 还没实现')
}`,
  solution: `function weightedTotal(row, weights) {
  let total = 0
  for (const dim of Object.keys(weights)) {
    total += (row.scores[dim] || 0) * weights[dim]
  }
  return total
}

function rankFrameworks(rows, weights) {
  const scored = rows.map((row) => ({ name: row.name, total: weightedTotal(row, weights) }))
  scored.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total
    if (a.name < b.name) return -1
    if (a.name > b.name) return 1
    return 0
  })
  return scored
}

function mapComponent(option) {
  const mapped = {}
  const unmappable = []
  const block = (key, reason) => unmappable.push({ key, reason })

  if (option.props) {
    const names = Array.isArray(option.props) ? option.props : Object.keys(option.props)
    const properties = {}
    for (const name of names) properties[name] = { type: null, value: null }
    mapped.properties = properties
  }
  if (typeof option.data === 'function') mapped.data = option.data()
  if (option.methods) mapped.methods = Object.assign({}, option.methods)

  const lifetimes = {}
  if (option.created) lifetimes.created = option.created
  if (option.mounted) lifetimes.ready = option.mounted
  if (option.unmounted) lifetimes.detached = option.unmounted
  if (Object.keys(lifetimes).length) mapped.lifetimes = lifetimes

  if (option.watch) {
    const observers = {}
    for (const key of Object.keys(option.watch)) observers[key] = option.watch[key]
    mapped.observers = observers
  }

  if (option.computed) block('computed', '小程序没有 computed，只能用 data 加 observers 手动维护派生值')
  if (option.provide) block('provide', '没有跨层注入，只能挂 globalData 或事件总线')
  if (option.scopedStyle) block('scopedStyle', '样式隔离由 styleIsolation 决定，scoped 属性没有对应物')
  if (option.emits) block('emits', '组件事件要手写 triggerEvent，声明式 emits 不参与编译')
  return { mapped, unmappable }
}

function migrationReport(option) {
  const res = mapComponent(option)
  const total = Object.keys(option).length
  const mapped = Object.keys(res.mapped).length
  const blocked = res.unmappable.map((x) => x.key)
  const ratio = total === 0 ? 0 : blocked.length / total
  const risk = blocked.length === 0 ? 'low' : ratio > 0.4 ? 'high' : 'medium'
  return { total, mapped, blocked, risk }
}

function recommendStack(rows, weights, needs) {
  const dims = Object.keys(needs || {})
  const passed = []
  const rejected = []
  for (const row of rows) {
    const fails = dims.filter((dim) => (row.scores[dim] || 0) < needs[dim])
    if (fails.length) rejected.push({ name: row.name, fails })
    else passed.push(row)
  }
  return {
    picked: rankFrameworks(passed, weights).map((row) => row.name),
    rejected
  }
}`,
  finalCode: '',
  tests: `${L2S1}\n${L2S2}\n${L2S3}`
}

LV2.finalCode = LV2.solution

/* ============================================================ 第 3 关测试 */
const L3S1 = `{
  check('读过的属性被收集，写入后 effect 重跑', () => {
    const sys = createReactiveSystem()
    const state = sys.reactive({ a: 1, b: 2 })
    const seen = []
    sys.effect(() => seen.push(state.a))
    same(seen, [1])
    state.a = 10
    same(seen, [1, 10])
  })
  check('没读过的属性不会建立依赖', () => {
    const sys = createReactiveSystem()
    const state = sys.reactive({ a: 1, b: 2 })
    let runs = 0
    sys.effect(() => { runs++; state.a })
    state.b = 3
    same(runs, 1, 'b 从未被读过，不该触发')
    state.a = 2
    same(runs, 2)
  })
  check('同一 effect 读同一属性两次，依赖表去重后只跑一次', () => {
    const sys = createReactiveSystem()
    const state = sys.reactive({ a: 1 })
    let runs = 0
    sys.effect(() => { runs++; state.a + state.a })
    state.a = 2
    same(runs, 2)
  })
  check('嵌套 effect 结束后恢复外层，依赖互不串味', () => {
    const sys = createReactiveSystem()
    const state = sys.reactive({ a: 1, b: 1 })
    const log = []
    let outer = 0
    let inner = 0
    sys.effect(() => {
      outer++
      log.push('outer:' + state.a)
      sys.effect(() => {
        inner++
        log.push('inner:' + state.b)
      })
    })
    same(outer, 1)
    same(inner, 1)
    state.b = 2
    same(inner, 2, '内层依赖 b，b 变了只重跑内层')
    same(outer, 1, '外层没读过 b，不能被连带重跑')
    state.a = 2
    same(outer, 2)
    same(log[0], 'outer:1')
    same(log[1], 'inner:1')
  })
  check('写入同值不触发（Object.is 判定）', () => {
    const sys = createReactiveSystem()
    const state = sys.reactive({ a: 1, s: 'x' })
    let runs = 0
    sys.effect(() => { runs++; state.a; state.s })
    state.a = 1
    state.s = 'x'
    same(runs, 1)
    state.s = 'y'
    same(runs, 2)
  })
}`

const L3S2 = `{
  check('队列在微任务里按 id 升序执行，同步阶段一个都不跑', async () => {
    const s = createScheduler()
    const log = []
    s.queueJob({ id: 3, run: () => log.push(3) })
    s.queueJob({ id: 1, run: () => log.push(1) })
    s.queueJob({ id: 2, run: () => log.push(2) })
    same(log.length, 0)
    await Promise.resolve()
    same(log, [1, 2, 3])
  })
  check('同 id 的 job 只保留一个，后入的覆盖回调', () => {
    const s = createScheduler()
    const log = []
    s.queueJob({ id: 1, run: () => log.push('first') })
    s.queueJob({ id: 1, run: () => log.push('second') })
    same(s.size(), 1)
    s.flushJobs()
    same(log, ['second'], '去重是「覆盖回调」，不是「执行两次」')
  })
  check('nextTick 的回调排在整轮 flush 之后', async () => {
    const s = createScheduler()
    const log = []
    s.queueJob({ id: 1, run: () => log.push('job') })
    const p = s.nextTick(() => log.push('tick'))
    log.push('sync')
    await p
    same(log, ['sync', 'job', 'tick'])
  })
  check('run 里再次入队形成递归，超过上限必须抛错', () => {
    const s = createScheduler()
    let n = 0
    const job = { id: 9, run: () => { n++; s.queueJob(job) } }
    s.queueJob(job)
    let err = null
    try { s.flushJobs() } catch (e) { err = e }
    same(err !== null, true)
    same(n >= 100, true)
    same(s.size(), 0, '抛错后队列必须清空，不能留脏状态')
  })
  check('空队列 flush 返回空数组，不抛错', () => {
    const s = createScheduler()
    same(s.flushJobs(), [])
    same(s.runs.length, 0)
  })
}`

const L3S3 = `{
  check('ref / isRef / unref：只解包真 ref，普通值原样返回', () => {
    const count = ref(0)
    same(isRef(count), true)
    same(isRef(0), false)
    same(unref(count), 0)
    same(unref(7), 7)
    same(unref(null), null)
  })
  check('toRef 与原对象双向同步，toRefs 批量包裹', () => {
    const state = { msg: 'a', n: 1 }
    const msg = toRef(state, 'msg')
    same(msg.value, 'a')
    msg.value = 'b'
    same(state.msg, 'b')
    state.msg = 'c'
    same(msg.value, 'c', '源对象改了，ref 也要跟着变')
    same(Object.keys(toRefs(state)), ['msg', 'n'])
  })
  check('模板解包只做一层：对象属性解包，数组元素不解包', () => {
    const view = unwrapForTemplate({ count: ref(1), list: [ref(2)], raw: 3 })
    same(view.count, 1)
    same(view.raw, 3)
    same(isRef(view.list[0]), true, '数组里的 ref 在模板里不会自动解包')
  })
  check('pre 组整体先于 post 组，组内按 id 升序（父子序由此保证）', () => {
    same(flushWatchers([
      { id: 5, flush: 'post' },
      { id: 9, flush: 'pre' },
      { id: 2, flush: 'pre' },
      { id: 7, flush: 'post' }
    ]), [2, 9, 5, 7])
  })
  check('同一 watcher 多次入队只跑一次，sync 不进 flush 队列', () => {
    same(flushWatchers([
      { id: 3, flush: 'pre' },
      { id: 3, flush: 'pre' },
      { id: 4, flush: 'sync' },
      { id: 1, flush: 'pre' }
    ]), [1, 3])
  })
}`

/* ============================================================ 第 3 关 */
const LV3 = {
  id: 'lv3',
  title: '响应式与更新调度',
  emoji: '⚡',
  xp: 60,
  goal: '实现依赖收集（reactive + effect + deps 去重 + effect 栈）、异步调度器（job 去重、按 id 排序、递归上限、nextTick）、ref 家族与模板解包规则，以及 pre/post watcher 的刷新顺序。',
  why: 'Vue3 的更新为什么是异步的、为什么同一个组件一轮里只重渲染一次、为什么在 effect 里改状态可能死循环、为什么模板里数组元素的 ref 不解包——这些问题都指向同一套机制：依赖表 + 微任务队列。背结论的人会说「因为用了微任务」，能讲清的人会说「effect 运行时把自己记进 deps 的 Set，trigger 时把 Set 快照出来逐个跑，而 queueJob 用 id 去重并保证父组件先于子组件」。本关把这套机制拆成可以单独断言的三段。',
  nodes: ['fe.vue.reactivity', 'fe.vue.reactivity.ref-family', 'fe.vue.scheduler', 'fe.vue.scheduler.nexttick', 'fe.vue.scheduler.watcher-flush'],
  thinking: [
    {
      title: '依赖表是「属性 → 一组函数」的 Map',
      md: '响应式的全部秘密就是一张表：`Map<key, Set<effect>>`。读属性时如果当前有 activeEffect，就把它塞进对应 key 的 Set；写属性时把 Set 里的函数挨个跑一遍。\n\n两个细节决定了它能不能用：**Set 天然去重**（同一个 effect 读两次同一属性只会记一次，触发时不会跑两遍）；**effect 必须用栈管理**（effect 里嵌套 effect 时，内层跑完要把 activeEffect 恢复成外层，否则内层之后的读取会记到内层头上）。这两点都在第 1 步的测试里。'
    },
    {
      title: '为什么要排队，而不是立刻重渲染',
      md: '如果每次改状态都立刻重渲染，`a = 1; b = 2; c = 3` 会触发三次渲染，而三次改的是同一份数据，前两次完全是浪费。所以 Vue 把「组件更新」这个动作包成 job 丢进队列，用一个微任务统一 flush。\n\n队列还顺手解决了两个正确性问题：**同 id 去重**（父组件和子组件在同一轮都被标脏，父的渲染会带着子一起更新，子的 job 就该被折叠）；**按 id 排序**（id 在创建时递增，所以父的 id 一定小于子，排序就等于保证父先于子）。第 2 步把这三件事——去重、排序、递归上限——都做成了可断言的。'
    },
    {
      title: 'ref 家族的分歧点在「解包」而不是「存值」',
      md: '`ref` 和 `shallowRef` 的区别不在 API，而在内部要不要递归地把对象转成响应式代理；`toRef` 的价值是让一个普通对象的属性也能以 `.value` 的形式参与响应式；`unref` 是唯一安全的读取入口（非 ref 原样返回）。\n\n最容易踩的坑是模板解包只做一层：`{ count: ref(1) }` 在模板里 `count` 直接是 1，但 `{ list: [ref(2)] }` 里 `list[0]` 仍然是 ref 对象——因为数组元素不会被自动解包。这不是 bug，是编译器只对「顶层属性访问」插入 `.value`。'
    }
  ],
  prereq: [
    {
      title: 'Proxy 的 get / set 两个陷阱',
      md: '```js\nnew Proxy(target, {\n  get(obj, key) { track(key); return obj[key] },\n  set(obj, key, value) {\n    if (Object.is(obj[key], value)) return true\n    obj[key] = value\n    trigger(key)\n    return true\n  }\n})\n```\n\n`get` 里必须先 track 再取值（顺序反了依赖就记不上）；`set` 里必须用 `Object.is` 拦掉同值写入（否则 `state.a = 1` 也会重渲染）。还有一点：set 的 handler 必须 `return true`，否则严格模式下赋值会抛 TypeError。'
    },
    {
      title: '微任务在判题沙箱里怎么写',
      md: '沙箱没有 setTimeout，但有 Promise。`Promise.resolve().then(fn)` 就是「本轮同步代码跑完后立刻执行」的微任务，和浏览器里 Vue 调度器用的是同一个机制（Vue 在有 Promise 时优先用它，没有才退化到 setTimeout）。\n\n所以测试里写 `await Promise.resolve()` 就能等到 flush 完成：await 之后的续体会被排到已注册的微任务后面。注意不要用真实定时器去「等一会」，那样既不确定也不可复现。'
    }
  ],
  api: [
    {
      name: 'createReactiveSystem',
      sig: 'createReactiveSystem() => { reactive(target), effect(fn), trigger(key) }',
      args: '无参数。每次调用得到一套独立的依赖表（便于测试之间互不干扰）。',
      returns: 'reactive 返回 Proxy 包装的对象；effect 立即执行一次 fn 并在之后被依赖触发时重跑，返回一个可手动重跑的 run；trigger 手动触发某个 key 的依赖，返回被触发的 effect 数量。',
      example: 'const sys = createReactiveSystem()\nconst state = sys.reactive({ a: 1 })\nconst seen = []\nsys.effect(() => seen.push(state.a))\nstate.a = 2      // seen => [1, 2]'
    },
    {
      name: 'createScheduler',
      sig: 'createScheduler() => { queueJob(job), flushJobs(), nextTick(fn), runs, size() }',
      args: 'job 是 { id: number, run: Function }；id 越小越先执行。nextTick 的回调在本轮 flush 之后跑。',
      returns: 'queueJob 入队（同 id 覆盖回调）并在微任务里自动 flush；flushJobs 手动 flush 并返回本次执行过的 id 数组；nextTick 返回 Promise；runs 是历史执行记录；size() 返回当前队列长度。',
      example: 'const s = createScheduler()\ns.queueJob({ id: 2, run: () => {} })\ns.queueJob({ id: 1, run: () => {} })\ns.size()   // 2，flush 之后 runs 里是 [1, 2]'
    },
    {
      name: 'ref / unref / toRef / shallowRef',
      sig: 'ref(v) / shallowRef(v) / toRef(obj, key) / unref(x) / isRef(x) / unwrapForTemplate(v)',
      args: 'ref 包原始值或对象；shallowRef 不递归代理；toRef 把源对象的一个键做成读写访问器；unref 接受任意值。',
      returns: 'ref 家族都返回 { __v_isRef: true, value }；isRef 判断标记；unref 解包（非 ref 原样返回）；unwrapForTemplate 对普通对象做一层解包、对数组原样返回。',
      example: 'const count = ref(0)\nunref(count)                       // 0\nunwrapForTemplate({ a: ref(1) })   // { a: 1 }'
    },
    {
      name: 'flushWatchers',
      sig: 'flushWatchers(watchers: Array<{ id, flush }>) => number[]',
      args: 'watchers 里每项至少带 id 与 flush（pre / post / sync）；同一 id 只保留第一次出现的。',
      returns: '按执行顺序返回 id 数组：pre 组全部在前、post 组全部在后，组内按 id 升序；sync 型 watcher 不进 flush 队列。',
      example: 'flushWatchers([{ id: 5, flush: \'post\' }, { id: 2, flush: \'pre\' }])\n// => [2, 5]'
    }
  ],
  usage: '// 一个最小响应式系统装配起来的样子\nconst sys = createReactiveSystem()\nconst sched = createScheduler()\nconst state = sys.reactive({ count: 0 })\n\nsys.effect(() => {\n  // 依赖收集发生在读的时候，重渲染被丢进队列\n  sched.queueJob({ id: 1, run: () => render(state.count) })\n})\n\nstate.count = 1        // 只排一次队\nstate.count = 2        // 同 id 覆盖，仍然只跑一次\nawait sched.nextTick() // 等渲染落地',
  hints: [
    '第 1 步的 deps 用 Map<key, Set<fn>>，effect 的 fn 本身就是标记身份，天然去重。',
    '第 1 步嵌套时务必用 stack 保存外层 active，finally 里恢复，否则内层跑完全局 active 变成 null。',
    '第 2 步在 queueJob 里判断 !pending 才挂微任务，避免每次入队都注册一次 flush。',
    '第 2 步的递归上限放在 shift 之后、run 之前计数，抛错路径用 finally 清空队列。',
    '第 3 步 unwrapForTemplate 用 Array.isArray 先挡住数组，再做对象的一层解包。'
  ],
  concepts: [
    {
      title: '为什么 Vue 用 id 排序而不是拓扑排序',
      md: '组件的父子关系天然是树，而组件实例的 uid 在创建时单调递增——父组件一定先创建，所以父的 uid 一定小于子。于是「父先于子更新」这件事不需要拓扑排序，按 id 排一遍就够了。这是用一个不变量换掉一个算法的典型例子：只要保证 id 单调，排序就从 O(V+E) 降到 O(n log n)。'
    },
    {
      title: '本关简化了什么',
      md: '真实的 Vue 响应式还有：嵌套对象的递归代理（本关只代理最外层）、数组方法的拦截（push 要触发 length）、effect 的 cleanup 与 stop、computed 的懒求值与缓存、调度器里的 flush 分桶（pre / queue / post 三个队列）。本关保留的是最能体现机制的部分：Set 去重、effect 栈、id 排序、微任务 flush、递归上限。'
    }
  ],
  stages: [
    {
      n: 1,
      title: '依赖收集：Map 加 Set 就够了',
      think: '先让「读的时候登记、写的时候重跑」跑通。要点有三个：依赖表用 Set 去重、effect 运行时把自己记成 active、嵌套时用栈恢复外层。',
      hint: 'deps 是 Map<key, Set<fn>>；track 时 active 为空就直接返回，trigger 时先快照再遍历。',
      code: `function createReactiveSystem() {
  const deps = new Map()
  let active = null
  const stack = []

  function track(key) {
    if (!active) return
    let bucket = deps.get(key)
    if (!bucket) {
      bucket = new Set()
      deps.set(key, bucket)
    }
    bucket.add(active)
  }

  function trigger(key) {
    const bucket = deps.get(key)
    if (!bucket) return 0
    const snapshot = Array.from(bucket)
    for (const fn of snapshot) fn()
    return snapshot.length
  }

  function reactive(target) {
    return new Proxy(target, {
      get(obj, key) {
        track(key)
        return obj[key]
      },
      set(obj, key, value) {
        if (Object.is(obj[key], value)) return true
        obj[key] = value
        trigger(key)
        return true
      }
    })
  }

  function effect(fn) {
    const run = () => {
      stack.push(active)
      active = fn
      try {
        return fn()
      } finally {
        active = stack.pop()
      }
    }
    run()
    return run
  }

  return { reactive, effect, trigger }
}`,
      test: L3S1,
      diag: [
        'deps 用了普通对象存数组，同一个 effect 被重复收集，触发时跑两遍。',
        'get 里先取值再 track，或者忘了 track，写入后 effect 根本不重跑。',
        '嵌套 effect 没有保存外层 active，内层跑完后外层读属性记到了内层身上。',
        'set 缺少 Object.is 判断，把同一个值写回去也触发重跑。',
        'trigger 直接遍历 Set 同时 Set 被修改（effect 里又读了新属性），必须先用 Array.from 快照。'
      ]
    },
    {
      n: 2,
      title: '调度器：去重、排序、别死循环',
      think: '把更新动作包成 job 丢进队列，等一个微任务统一执行。三件事必须同时成立：同 id 只跑一次、按 id 升序、run 里又入队时要能收敛（否则死循环）。',
      hint: 'queueJob 里 find 同 id 就覆盖；首次入队时挂 Promise.resolve().then(flush)，用 pending 标志防止重复注册。',
      code: `function createScheduler() {
  const queue = []
  const runs = []
  let flushing = false
  let pending = false

  function queueJob(job) {
    const found = queue.find((item) => item.id === job.id)
    if (found) {
      found.run = job.run
      return
    }
    queue.push(job)
    if (!flushing) queue.sort((a, b) => a.id - b.id)
    if (!pending) {
      pending = true
      Promise.resolve().then(() => {
        pending = false
        flushJobs()
      })
    }
  }

  function flushJobs() {
    if (flushing) return []
    flushing = true
    const ran = []
    try {
      while (queue.length) {
        queue.sort((a, b) => a.id - b.id)
        const job = queue.shift()
        if (ran.length >= 100) throw new Error('调度器递归触发超过上限 100 次')
        job.run()
        ran.push(job.id)
        runs.push(job.id)
      }
    } finally {
      flushing = false
      queue.length = 0
    }
    return ran
  }

  function nextTick(fn) {
    return Promise.resolve().then(fn || function () {})
  }

  return {
    queueJob,
    flushJobs,
    nextTick,
    runs,
    size: () => queue.length
  }
}`,
      test: L3S2,
      diag: [
        'queueJob 没有去重，同一个组件被标脏两次就渲染两次。',
        'flush 前没排序，输出顺序变成入队顺序而不是 id 顺序。',
        'nextTick 用了同步执行或定时器，顺序跑到 flush 前面去了。',
        '递归上限没做，job 在 run 里再次入队会无限循环直到超时。',
        '抛错后队列没清空，下一次 flush 又跑了一遍残留 job。'
      ]
    },
    {
      n: 3,
      title: 'ref 家族与 watcher 刷新顺序',
      think: 'ref 的核心是「带标记的盒子」，解包只在读取时发生；watcher 的核心是「两个阶段加一个 id 序」：pre 在渲染前、post 在渲染后，组内按 id 升序。',
      hint: 'unref 用 isRef 判断后取 .value；flushWatchers 先按 flush 分两桶，各自按 id 排序再拼接。',
      code: `function isRef(value) {
  return !!value && value.__v_isRef === true
}

function ref(value) {
  return { __v_isRef: true, value }
}

function shallowRef(value) {
  return { __v_isRef: true, __shallow: true, value }
}

function unref(value) {
  return isRef(value) ? value.value : value
}

function toRef(source, key) {
  return {
    __v_isRef: true,
    get value() {
      return source[key]
    },
    set value(next) {
      source[key] = next
    }
  }
}

function toRefs(source) {
  const out = {}
  for (const key of Object.keys(source)) out[key] = toRef(source, key)
  return out
}

function unwrapForTemplate(value) {
  if (Array.isArray(value)) return value.slice()
  if (value && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value)) out[key] = unref(value[key])
    return out
  }
  return unref(value)
}

function flushWatchers(watchers) {
  const seen = []
  const pre = []
  const post = []
  for (const item of watchers) {
    if (seen.indexOf(item.id) >= 0) continue
    seen.push(item.id)
    if (item.flush === 'sync') continue
    if (item.flush === 'post') post.push(item)
    else pre.push(item)
  }
  const byId = (a, b) => a.id - b.id
  pre.sort(byId)
  post.sort(byId)
  return pre.concat(post).map((item) => item.id)
}`,
      test: L3S3,
      diag: [
        'isRef 只判断了 value 是否存在，把普通对象也当成 ref，unref 时炸掉。',
        'toRef 只做了 get 没做 set，写回源对象时同步失败。',
        'unwrapForTemplate 对数组也逐项解包，数组里的 ref 被错误地拍平。',
        'flushWatchers 只按 id 排了一遍，post 型 watcher 混进 pre 组里提前执行。',
        'sync 型 watcher 也被放进 flush 队列，导致同一个回调执行两次。'
      ]
    }
  ],
  skeleton: `function createReactiveSystem() {
  // TODO: deps = Map<key, Set<fn>>，effect 运行时记录 active，trigger 时快照后逐个跑
  throw new Error('createReactiveSystem 还没实现')
}

function createScheduler() {
  // TODO: job 队列去重 + 按 id 排序 + 微任务 flush + 递归上限
  throw new Error('createScheduler 还没实现')
}

function ref(value) {
  throw new Error('ref 还没实现')
}

function isRef(value) {
  throw new Error('isRef 还没实现')
}

function unref(value) {
  throw new Error('unref 还没实现')
}

function toRef(source, key) {
  throw new Error('toRef 还没实现')
}

function toRefs(source) {
  throw new Error('toRefs 还没实现')
}

function unwrapForTemplate(value) {
  throw new Error('unwrapForTemplate 还没实现')
}

function flushWatchers(watchers) {
  throw new Error('flushWatchers 还没实现')
}`,
  solution: `function createReactiveSystem() {
  const deps = new Map()
  let active = null
  const stack = []

  function track(key) {
    if (!active) return
    let bucket = deps.get(key)
    if (!bucket) {
      bucket = new Set()
      deps.set(key, bucket)
    }
    bucket.add(active)
  }

  function trigger(key) {
    const bucket = deps.get(key)
    if (!bucket) return 0
    const snapshot = Array.from(bucket)
    for (const fn of snapshot) fn()
    return snapshot.length
  }

  function reactive(target) {
    return new Proxy(target, {
      get(obj, key) {
        track(key)
        return obj[key]
      },
      set(obj, key, value) {
        if (Object.is(obj[key], value)) return true
        obj[key] = value
        trigger(key)
        return true
      }
    })
  }

  function effect(fn) {
    const run = () => {
      stack.push(active)
      active = fn
      try {
        return fn()
      } finally {
        active = stack.pop()
      }
    }
    run()
    return run
  }

  return { reactive, effect, trigger }
}

function createScheduler() {
  const queue = []
  const runs = []
  let flushing = false
  let pending = false

  function queueJob(job) {
    const found = queue.find((item) => item.id === job.id)
    if (found) {
      found.run = job.run
      return
    }
    queue.push(job)
    if (!flushing) queue.sort((a, b) => a.id - b.id)
    if (!pending) {
      pending = true
      Promise.resolve().then(() => {
        pending = false
        flushJobs()
      })
    }
  }

  function flushJobs() {
    if (flushing) return []
    flushing = true
    const ran = []
    try {
      while (queue.length) {
        queue.sort((a, b) => a.id - b.id)
        const job = queue.shift()
        if (ran.length >= 100) throw new Error('调度器递归触发超过上限 100 次')
        job.run()
        ran.push(job.id)
        runs.push(job.id)
      }
    } finally {
      flushing = false
      queue.length = 0
    }
    return ran
  }

  function nextTick(fn) {
    return Promise.resolve().then(fn || function () {})
  }

  return {
    queueJob,
    flushJobs,
    nextTick,
    runs,
    size: () => queue.length
  }
}

function isRef(value) {
  return !!value && value.__v_isRef === true
}

function ref(value) {
  return { __v_isRef: true, value }
}

function shallowRef(value) {
  return { __v_isRef: true, __shallow: true, value }
}

function unref(value) {
  return isRef(value) ? value.value : value
}

function toRef(source, key) {
  return {
    __v_isRef: true,
    get value() {
      return source[key]
    },
    set value(next) {
      source[key] = next
    }
  }
}

function toRefs(source) {
  const out = {}
  for (const key of Object.keys(source)) out[key] = toRef(source, key)
  return out
}

function unwrapForTemplate(value) {
  if (Array.isArray(value)) return value.slice()
  if (value && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value)) out[key] = unref(value[key])
    return out
  }
  return unref(value)
}

function flushWatchers(watchers) {
  const seen = []
  const pre = []
  const post = []
  for (const item of watchers) {
    if (seen.indexOf(item.id) >= 0) continue
    seen.push(item.id)
    if (item.flush === 'sync') continue
    if (item.flush === 'post') post.push(item)
    else pre.push(item)
  }
  const byId = (a, b) => a.id - b.id
  pre.sort(byId)
  post.sort(byId)
  return pre.concat(post).map((item) => item.id)
}`,
  finalCode: '',
  tests: `${L3S1}\n${L3S2}\n${L3S3}`
}

LV3.finalCode = LV3.solution

/* ============================================================ 第 4 关测试 */
const L4S1 = `{
  check('静态元素 + 文本：直接生成 _c / _v 嵌套', () => {
    same(compile('<div id="app">Hello</div>'), '_c("div",{id:"app"},[_v("Hello")])')
    same(compile('<div></div>'), '_c("div",null,null)')
  })
  check('插值编译成 _v(_s(expr))', () => {
    same(compile('<p>{{ msg }}</p>'), '_c("p",null,[_v(_s(msg))])')
    same(compile('<p>{{ user.name }}</p>'), '_c("p",null,[_v(_s(user.name))])')
  })
  check('动态绑定去掉引号，静态属性保留字符串', () => {
    same(compile('<span :class="cls" title="hi">x</span>'),
      '_c("span",{class:cls,title:"hi"},[_v("x")])')
  })
  check('事件编译成 on 加首字母大写的驼峰键', () => {
    same(compile('<button @click="go">ok</button>'), '_c("button",{onClick:go},[_v("ok")])')
  })
  check('parse 阶段产出可检查的 AST：指令与动态绑定分开标记', () => {
    const ast = parseTemplate('<div v-if="ok" :id="x" class="c">t</div>')
    same(ast.children.length, 1)
    const node = ast.children[0]
    same(node.type, 'element')
    same(node.tag, 'div')
    same(node.props[0].key, 'v-if')
    same(node.props[0].directive, true)
    same(node.props[1].key, 'id')
    same(node.props[1].dynamic, true)
    same(node.props[2].dynamic, false)
  })
}`

const L4S2 = `{
  const T = '<div id="app"><h1>Title</h1><p>{{ msg }}</p><ul v-for="item in list"><li :class="item.cls">{{ item.name }}</li></ul></div>'
  const res = analyzeTree(parseTemplate(T))

  check('root 是第一个 block，它自己的 patchFlag 只描述自身', () => {
    same(res.blocks.length, 2)
    same(res.blocks[0].tag, 'div')
    same(res.blocks[0].patchFlag, 0)
    const direct = analyzeTree(parseTemplate('<div id="app">{{ msg }}</div>'))
    same(direct.blocks[0].patchFlag, 1, '子节点是插值时才是 TEXT 位')
  })
  check('完全静态的子树记入提升名单', () => {
    same(res.hoisted, ['h1'])
  })
  check('v-for 宿主自成一个 block，动态项只统计块内', () => {
    same(res.blocks[1].tag, 'ul')
    same(res.blocks[1].patchFlag, 0, 'v-for 块不靠 patchFlag 跳过 children')
    same(res.blocks[1].dynamic, 2)
  })
  check('外层 block 不重复统计内层 block 的动态项', () => {
    same(res.blocks[0].dynamic, 1)
  })
  check('class / style / 其它动态属性的位可以叠加', () => {
    const r = analyzeTree(parseTemplate('<div :class="a" :style="b" :id="c">{{ t }}</div>'))
    same(r.blocks.length, 1)
    same(r.blocks[0].patchFlag, 15)
    same(r.hoisted, [])
  })
}`

const L4S3 = `{
  const SLOTS = [
    { name: 'header', scope: [], tpl: '<h1>Head</h1>' },
    { name: '', scope: [], tpl: '<p>{{ title }}</p>' },
    { name: 'row', scope: ['item'], tpl: '<span>{{ item.name }}</span>' }
  ]
  const out = compileSlots(SLOTS)

  check('静态普通 slot 判定为稳定，code 里只有名字', () => {
    same(out[0].name, 'header')
    same(out[0].scoped, false)
    same(out[0].stable, true)
    same(out[0].code, '_t("header")')
  })
  check('含插值的普通 slot 不稳定，缺省 name 归一成 default', () => {
    same(out[1].name, 'default')
    same(out[1].scoped, false)
    same(out[1].stable, false)
    same(out[1].body, '_c("p",null,[_v(_s(title))])')
  })
  check('作用域 slot 要把参数交给插槽函数，且永远不稳定', () => {
    same(out[2].code, '_t("row",{item:item})')
    same(out[2].scoped, true)
    same(out[2].stable, false)
    same(out[2].body, '_c("span",null,[_v(_s(item.name))])')
  })
  check('slot 的顺序与入参一致，数量不多不少', () => {
    same(out.length, 3)
    same(out.map((s) => s.name), ['header', 'default', 'row'])
  })
  check('静态提升的拒绝条件：动态绑定 / 指令 / ref / 插值', () => {
    const pass = parseTemplate('<div class="static">t</div>').children[0]
    same(hoistDecision(pass).ok, true)
    const dyn = parseTemplate('<div :id="x">t</div>').children[0]
    same(hoistDecision(dyn).ok, false)
    same(hoistDecision(dyn).reason.length > 6, true)
    const loop = parseTemplate('<div v-for="a in b">t</div>').children[0]
    same(hoistDecision(loop).ok, false)
    const box = parseTemplate('<div ref="box">t</div>').children[0]
    same(hoistDecision(box).ok, false, 'ref 每轮都要重新绑定真实节点')
    const interp = parseTemplate('<div>{{ t }}</div>').children[0]
    same(hoistDecision(interp).ok, false)
  })
}`

/* ============================================================ 第 4 关 */
const LV4 = {
  id: 'lv4',
  title: '模板编译器：从 AST 到 block tree',
  emoji: '🧠',
  xp: 70,
  goal: '实现一条迷你编译流水线：parseTemplate 生成 AST，compile 走 parse → transform → codegen 输出 render 函数字符串，analyzeTree 产出 block 与 patchFlag 并给出静态提升名单，compileSlots 处理普通 / 作用域 slot，hoistDecision 说明什么不能提升。',
  why: '面试里问「Vue3 为什么比 Vue2 快」，标准答案里的三个词——静态提升、patchFlag、block tree——如果不自己实现一遍，就只能是三个名词。真正的机制是：编译器在 codegen 阶段就把「哪些节点永远不变」「哪个 block 里有哪些动态后代」算清楚，运行时拿着这些信息跳过大量 diff。本关把这条流水线拆成可断言的中间产物，你能看到 AST 上怎么标动态、block 怎么收集动态后代、什么条件下提升会被拒绝。',
  nodes: ['fe.vue.compiler', 'fe.vue.compiler.ast-pipeline', 'fe.vue.compiler.block-tree', 'fe.vue.compiler.slot-compile', 'fe.vue.compiler.static-hoist'],
  thinking: [
    {
      title: '编译产物是一串字符串，所以它天然可断言',
      md: 'render 函数在真实项目里是 `new Function(code)` 出来的，但在编译器的输出阶段它就是一串文本。这意味着测试不需要真的执行它——直接比较字符串就够了，而且比字符串更容易定位问题：多一个逗号、少一层 `_v`，一眼就能看出来。\n\n所以本关的输出格式固定成 `_c(标签, props, children)` / `_v(文本)` / `_v(_s(表达式))` 三种。`_c` 创建元素 vnode，`_v` 创建文本 vnode，`_s` 把值转成字符串——这三个就是运行时最小的创建 API，第 5 关会接着用它们。'
    },
    {
      title: 'patchFlag 是「这位节点哪里会变」的位掩码',
      md: 'TEXT=1、CLASS=2、STYLE=4、PROPS=8 这些数字不是随便定的，它们是可以按位或起来的：一个节点同时有动态 class 和动态文本，flag 就是 3；有 class + style + 其它 props + 文本就是 15。运行时拿到 3 就知道「只需要比 class 和文本」，于是跳过整个 props 对象的逐键对比。\n\n注意 patchFlag 描述的是**这一个节点自己**哪里会变，不是它的子树。子树的动态信息由 block 的 `dynamicChildren` 收集——这是两个层次，第 2 步的测试分别断言它们。'
    },
    {
      title: '静态提升的拒绝条件比「是不是静态」更细',
      md: '看似纯静态的 `<div ref="box">t</div>` 是不能提升的：ref 需要在每次 patch 时把真实节点挂回组件实例，提升之后这段逻辑就被跳过了，ref 会指向旧节点（甚至第一次之后就再也拿不到）。同理，带 `v-if` / `v-for` 的节点结构会变，动态绑定的值每轮都可能变。\n\n所以提升判定要按「会不会变」而不是「看起来静不静」：动态绑定 → 不提升；指令 → 不提升；ref → 不提升；子树里任意一处有插值 → 整棵都不提升（因为提升的是整棵子树）。'
    }
  ],
  prereq: [
    {
      title: '递归下降解析：状态只有「标签内」和「文本里」',
      md: '解析器的核心是一个游标 `i` 加一个栈：\n\n- 遇到 `<` 且下一个字符是 `/` → 弹栈（闭合标签）；\n- 遇到 `<` → 读到 `>`，解析标签名与属性，压栈；\n- 否则 → 读到下一个 `<`，那就是一段文本；若形如 `{{ x }}` 就产出插值节点。\n\n栈的作用是让 `children` 自动挂到正确的父节点上。自闭合标签（`img`、`input`）要特殊处理：压栈后立刻弹栈，否则后面所有兄弟节点都会变成它的子节点——这是手写解析器最经典的坑。'
    },
    {
      title: '为什么用字符串输出而不是直接建对象树',
      md: '真实编译器必须输出字符串，因为产物要被 `new Function` 执行；输出对象树只是中间态（AST）。本关把这个差异显式化：`parseTemplate` 给 AST（给分析用），`compile` 给字符串（给运行用）。\n\n字符串输出还有个副作用：格式完全由你决定，测试可以精确断言。代价是每次改动格式都要同步改测试——所以在写 codegen 之前先把格式定死（本关定成 `_c("tag",{k:v},[...])`），别一边写一边改。'
    }
  ],
  api: [
    {
      name: 'parseTemplate',
      sig: 'parseTemplate(template: string) => { type: "root", children: Node[] }',
      args: 'template 是一段模板字符串，支持嵌套元素、文本、`{{ }}` 插值、静态属性、动态绑定（`:prop`）、事件（`@evt`）与指令（`v-if` / `v-for`）。',
      returns: '根节点；元素节点形如 { type: "element", tag, props, children }，props 每项带 key / value / directive / dynamic 四个标记；文本与插值分别是 { type: "text" } 与 { type: "interp", expr }。',
      example: 'const ast = parseTemplate(\'<div :id="x">t</div>\')\nast.children[0].props[0].dynamic   // true'
    },
    {
      name: 'compile',
      sig: 'compile(template: string) => string',
      args: 'template 同 parseTemplate。',
      returns: 'render 函数体字符串：元素是 `_c(标签, props, children)`，文本是 `_v("...")`，插值是 `_v(_s(expr))`；无 props 输出 null，无 children 输出 null。',
      example: 'compile(\'<p>{{ msg }}</p>\')\n// => \'_c("p",null,[_v(_s(msg))])\''
    },
    {
      name: 'analyzeTree',
      sig: 'analyzeTree(ast) => { blocks: Array<{ tag, patchFlag, dynamic }>, hoisted: string[] }',
      args: 'ast 是 parseTemplate 的返回值。',
      returns: 'blocks 按「root 优先」的顺序列出所有 block（root 与 v-if/v-for 宿主），patchFlag 是该节点自身的位掩码，dynamic 是它块内的动态项数量（不进内层 block）；hoisted 是整棵可提升的静态子树的标签名。',
      example: 'const r = analyzeTree(parseTemplate(\'<div id="a">{{ msg }}</div>\'))\nr.blocks[0].patchFlag   // 1'
    },
    {
      name: 'compileSlots',
      sig: 'compileSlots(slots: Array<{ name, scope, tpl }>) => Array<{ name, scoped, stable, code, body }>',
      args: 'slots 每项：name 缺省为 default；scope 是作用域变量名数组；tpl 是该 slot 的模板片段。',
      returns: '每项给出 slot 的编译结果：普通 slot 的 code 是 `_t("name")`，作用域 slot 是 `_t("name",{var:var})`；stable 表示内容是否稳定（无插值、无动态绑定、无 ref）；body 是内容自身的 render 代码。',
      example: 'compileSlots([{ name: \'row\', scope: [\'item\'], tpl: \'<span>{{ item.name }}</span>\' }])[0]\n// => { name: \'row\', scoped: true, stable: false, code: \'_t("row",{item:item})\', ... }'
    },
    {
      name: 'hoistDecision',
      sig: 'hoistDecision(node) => { ok: boolean, reason: string }',
      args: 'node 是 AST 里的一个元素节点。',
      returns: 'ok 表示这个子树能否被静态提升；不能提升时 reason 给出具体原因（动态绑定 / 指令 / ref / 含插值 / 非元素）。',
      example: 'hoistDecision(parseTemplate(\'<div ref="box">t</div>\').children[0]).ok\n// => false'
    }
  ],
  usage: '// 编译器插件的三个输出：render 代码、patch 提示、slots 形态\nconst ast = parseTemplate(source)\nconst code = compile(source)\nconst { blocks, hoisted } = analyzeTree(ast)\n\n// 用 patchFlag 决定运行时要不要做全量 props diff\nfor (const block of blocks) {\n  if (block.patchFlag === 0 && block.dynamic === 0) skipPatch(block)\n}',
  hints: [
    '第 1 步先定输出格式再写代码：`_c("tag",{k:v},[...])`，props 为空写 null。',
    '第 1 步遇到 img / input 这类自闭合标签，压栈后立刻弹栈，否则兄弟节点会掉进它里面。',
    '第 2 步先写 isStaticElement（递归判断全静态），它是提升名单和拒绝条件的共同基础。',
    '第 2 步的 collect 遇到内层 block 要直接返回 0，把统计权交给内层自己。',
    '第 3 步的 stable 判定就是「不是作用域 slot 且内容是静态元素」，作用域 slot 永远不稳定。'
  ],
  concepts: [
    {
      title: 'block tree 解决的是「diff 要不要下钻」',
      md: '没有 block tree 时，diff 要递归遍历整棵 vnode 树；有了 block 之后，每个 block 维护一份 dynamicChildren 列表，diff 只沿着这份列表走，静态子树整棵跳过。所以 block tree 不是数据结构上的新树，而是「在原来的树上加了一层跳表」：root block 的 dynamicChildren 直接指向所有动态后代，中间那些静态层根本不进入遍历。'
    },
    {
      title: '本关简化了什么',
      md: '真实编译器还有：指令的 transform 阶段（v-if 会改写成三元表达式）、静态提升的 `_hoisted_N` 常量、`v-once`、`v-memo`、缓存事件处理函数（cacheHandlers）、以及 slot 的作用域变量前缀改写（把 `item` 改写成 `slotProps.item`）。本关保留的是决策本身：谁算动态、谁进 block、谁能提升、slot 稳不稳定，这些都是面试真正考的点。'
    }
  ],
  stages: [
    {
      n: 1,
      title: 'parse 到 codegen：把模板变成 render 字符串',
      think: '先做最小的三段流水线：游标加栈解析出 AST，给属性打上「指令 / 动态 / 静态」三态标记，再把 AST 递归拼成 `_c` / `_v` 字符串。',
      hint: '属性串用字符游标读名字和值；genNode 按 text / interp / element 三种类型分支。',
      code: `const VOID_TAGS = ['input', 'img', 'image', 'br', 'hr']

function readAttrs(source) {
  const out = []
  let i = 0
  while (i < source.length) {
    if (source[i] === ' ') {
      i++
      continue
    }
    let name = ''
    while (i < source.length && source[i] !== '=' && source[i] !== ' ') {
      name += source[i]
      i++
    }
    let value = ''
    if (source[i] === '=') {
      i++
      while (i < source.length && source[i] !== ' ') {
        value += source[i]
        i++
      }
      if (value[0] === '"') value = value.slice(1, -1)
    }
    out.push([name, value])
  }
  return out
}

function toProps(pairs) {
  return pairs.map((pair) => {
    const name = pair[0]
    const value = pair[1]
    if (name.slice(0, 2) === 'v-') return { key: name, value, directive: true, dynamic: false }
    if (name[0] === ':') return { key: name.slice(1), value, directive: false, dynamic: true }
    if (name[0] === '@') {
      const evt = name.slice(1)
      return { key: 'on' + evt[0].toUpperCase() + evt.slice(1), value, directive: false, dynamic: false }
    }
    return { key: name, value: '"' + value + '"', directive: false, dynamic: false }
  })
}

function parseTemplate(src) {
  const root = { type: 'root', children: [] }
  const stack = [root]
  let i = 0
  while (i < src.length) {
    if (src[i] === '<') {
      const end = src.indexOf('>', i)
      if (src[i + 1] === '/') {
        stack.pop()
        i = end + 1
        continue
      }
      const head = src.slice(i + 1, end)
      const tag = head.split(' ')[0]
      const node = { type: 'element', tag, props: toProps(readAttrs(head.slice(tag.length))), children: [] }
      stack[stack.length - 1].children.push(node)
      if (VOID_TAGS.indexOf(tag) < 0) {
        stack.push(node)
      }
      i = end + 1
    } else {
      const next = src.indexOf('<', i)
      const raw = src.slice(i, next < 0 ? src.length : next)
      const text = raw.trim()
      if (text) {
        const parent = stack[stack.length - 1]
        if (text.slice(0, 2) === '{{') {
          parent.children.push({ type: 'interp', expr: text.slice(2, text.length - 2).trim() })
        } else {
          parent.children.push({ type: 'text', text })
        }
      }
      i = next < 0 ? src.length : next
    }
  }
  return root
}

function genProps(node) {
  const items = []
  for (const p of node.props) {
    if (p.directive) continue
    items.push(p.key + ':' + p.value)
  }
  return items.length ? '{' + items.join(',') + '}' : 'null'
}

function genNode(node) {
  if (node.type === 'text') return '_v("' + node.text + '")'
  if (node.type === 'interp') return '_v(_s(' + node.expr + '))'
  const kids = node.children.length ? '[' + node.children.map(genNode).join(',') + ']' : 'null'
  return '_c("' + node.tag + '",' + genProps(node) + ',' + kids + ')'
}

function compile(template) {
  const ast = parseTemplate(template)
  return ast.children.map(genNode).join(',')
}`,
      test: L4S1,
      diag: [
        '属性值忘了剥引号，props 里出现 id:"\\"app\\"" 这种双重引号。',
        '自闭合标签也压栈了，后面的兄弟节点全变成它的子节点。',
        '插值没走 _s 包装，生成的代码在运行时拿到的是 vnode 而不是字符串。',
        '事件没有转换成 on 加驼峰键，运行时监听不到。',
        'genNode 没有区分 text 与 interp，{{ msg }} 被当成普通文本原样输出。'
      ]
    },
    {
      n: 2,
      title: 'block tree 与 patchFlag',
      think: '在每个节点上算两件事：它自己哪里会变（patchFlag 位掩码），以及它作为 block 能收集到多少动态后代（dynamic，遇到内层 block 就停）。静态子树单独记进提升名单。',
      hint: 'isStaticElement 递归判断；isBlock 只认 root 与带 v-if/v-for 的节点；collect 遇到内层 block 返回 0。',
      code: `const VOID_TAGS = ['input', 'img', 'image', 'br', 'hr']

function readAttrs(source) {
  const out = []
  let i = 0
  while (i < source.length) {
    if (source[i] === ' ') {
      i++
      continue
    }
    let name = ''
    while (i < source.length && source[i] !== '=' && source[i] !== ' ') {
      name += source[i]
      i++
    }
    let value = ''
    if (source[i] === '=') {
      i++
      while (i < source.length && source[i] !== ' ') {
        value += source[i]
        i++
      }
      if (value[0] === '"') value = value.slice(1, -1)
    }
    out.push([name, value])
  }
  return out
}

function toProps(pairs) {
  return pairs.map((pair) => {
    const name = pair[0]
    const value = pair[1]
    if (name.slice(0, 2) === 'v-') return { key: name, value, directive: true, dynamic: false }
    if (name[0] === ':') return { key: name.slice(1), value, directive: false, dynamic: true }
    if (name[0] === '@') {
      const evt = name.slice(1)
      return { key: 'on' + evt[0].toUpperCase() + evt.slice(1), value, directive: false, dynamic: false }
    }
    return { key: name, value: '"' + value + '"', directive: false, dynamic: false }
  })
}

function parseTemplate(src) {
  const root = { type: 'root', children: [] }
  const stack = [root]
  let i = 0
  while (i < src.length) {
    if (src[i] === '<') {
      const end = src.indexOf('>', i)
      if (src[i + 1] === '/') {
        stack.pop()
        i = end + 1
        continue
      }
      const head = src.slice(i + 1, end)
      const tag = head.split(' ')[0]
      const node = { type: 'element', tag, props: toProps(readAttrs(head.slice(tag.length))), children: [] }
      stack[stack.length - 1].children.push(node)
      if (VOID_TAGS.indexOf(tag) < 0) {
        stack.push(node)
      }
      i = end + 1
    } else {
      const next = src.indexOf('<', i)
      const raw = src.slice(i, next < 0 ? src.length : next)
      const text = raw.trim()
      if (text) {
        const parent = stack[stack.length - 1]
        if (text.slice(0, 2) === '{{') {
          parent.children.push({ type: 'interp', expr: text.slice(2, text.length - 2).trim() })
        } else {
          parent.children.push({ type: 'text', text })
        }
      }
      i = next < 0 ? src.length : next
    }
  }
  return root
}

function isStaticElement(node) {
  if (node.type !== 'element') return false
  if (node.props.some((p) => p.directive || p.dynamic)) return false
  if (!node.children.length) return true
  return node.children.every((child) => child.type === 'text' || isStaticElement(child))
}

function ownFlag(node) {
  let flag = 0
  const props = node.props || []
  for (const p of props) {
    if (!p.dynamic) continue
    if (p.key === 'class') flag |= 2
    else if (p.key === 'style') flag |= 4
    else flag |= 8
  }
  for (const child of node.children) {
    if (child.type === 'interp') flag |= 1
  }
  return flag
}

function analyzeTree(ast) {
  const nodeList = ast.children || []
  const root = nodeList.length === 1 && nodeList[0].type === 'element'
    ? nodeList[0]
    : { type: 'root', tag: 'root', props: [], children: nodeList }
  const blocks = []
  const hoisted = []
  const isBlock = (node) => node === root || (node.props || []).some((p) => p.key === 'v-if' || p.key === 'v-for')

  function collect(node, top) {
    if (!top && isBlock(node)) return 0
    let count = 0
    for (const p of node.props || []) {
      if (p.dynamic && !p.directive) count++
    }
    for (const child of node.children || []) {
      if (child.type === 'interp') count++
      else if (child.type === 'text') continue
      else count += collect(child, false)
    }
    return count
  }

  blocks.push({ tag: root.tag || 'root', patchFlag: ownFlag(root), dynamic: collect(root, true) })

  const walk = (node) => {
    for (const child of node.children || []) {
      if (child.type !== 'element') continue
      if (isBlock(child)) {
        blocks.push({ tag: child.tag, patchFlag: ownFlag(child), dynamic: collect(child, true) })
        walk(child)
      } else if (isStaticElement(child)) {
        hoisted.push(child.tag)
      } else {
        walk(child)
      }
    }
  }
  walk(root)

  return { blocks, hoisted }
}`,
      test: L4S2,
      diag: [
        'TEXT 位判定看成了「有没有文本子节点」，静态文本也被标成 1。',
        'v-for 宿主的 patchFlag 被算成了自身动态属性的位，应该为 0。',
        'collect 进了内层 block，外层把内层的动态项重复统计了一遍。',
        '静态判定没有排除指令，带 v-if 的子树也被提升，运行时结构变了就崩。',
        'hoisted 里放的是整棵子树的每个节点，而不是只记被提升的那一个根。'
      ]
    },
    {
      n: 3,
      title: 'slot 编译与提升的拒绝条件',
      think: '普通 slot 只需要名字，作用域 slot 必须把参数传进去；稳定 slot 的前提是内容完全静态。再把提升判定写成「带原因」的函数，让每次拒绝都能落到具体理由上。',
      hint: 'stable = 非作用域 slot + 内容是静态元素；hoistDecision 依次检查 ref、指令、动态绑定、子树静态性。',
      code: `const VOID_TAGS = ['input', 'img', 'image', 'br', 'hr']

function readAttrs(source) {
  const out = []
  let i = 0
  while (i < source.length) {
    if (source[i] === ' ') {
      i++
      continue
    }
    let name = ''
    while (i < source.length && source[i] !== '=' && source[i] !== ' ') {
      name += source[i]
      i++
    }
    let value = ''
    if (source[i] === '=') {
      i++
      while (i < source.length && source[i] !== ' ') {
        value += source[i]
        i++
      }
      if (value[0] === '"') value = value.slice(1, -1)
    }
    out.push([name, value])
  }
  return out
}

function toProps(pairs) {
  return pairs.map((pair) => {
    const name = pair[0]
    const value = pair[1]
    if (name.slice(0, 2) === 'v-') return { key: name, value, directive: true, dynamic: false }
    if (name[0] === ':') return { key: name.slice(1), value, directive: false, dynamic: true }
    if (name[0] === '@') {
      const evt = name.slice(1)
      return { key: 'on' + evt[0].toUpperCase() + evt.slice(1), value, directive: false, dynamic: false }
    }
    return { key: name, value: '"' + value + '"', directive: false, dynamic: false }
  })
}

function parseTemplate(src) {
  const root = { type: 'root', children: [] }
  const stack = [root]
  let i = 0
  while (i < src.length) {
    if (src[i] === '<') {
      const end = src.indexOf('>', i)
      if (src[i + 1] === '/') {
        stack.pop()
        i = end + 1
        continue
      }
      const head = src.slice(i + 1, end)
      const tag = head.split(' ')[0]
      const node = { type: 'element', tag, props: toProps(readAttrs(head.slice(tag.length))), children: [] }
      stack[stack.length - 1].children.push(node)
      if (VOID_TAGS.indexOf(tag) < 0) {
        stack.push(node)
      }
      i = end + 1
    } else {
      const next = src.indexOf('<', i)
      const raw = src.slice(i, next < 0 ? src.length : next)
      const text = raw.trim()
      if (text) {
        const parent = stack[stack.length - 1]
        if (text.slice(0, 2) === '{{') {
          parent.children.push({ type: 'interp', expr: text.slice(2, text.length - 2).trim() })
        } else {
          parent.children.push({ type: 'text', text })
        }
      }
      i = next < 0 ? src.length : next
    }
  }
  return root
}

function genProps(node) {
  const items = []
  for (const p of node.props) {
    if (p.directive) continue
    items.push(p.key + ':' + p.value)
  }
  return items.length ? '{' + items.join(',') + '}' : 'null'
}

function genNode(node) {
  if (node.type === 'text') return '_v("' + node.text + '")'
  if (node.type === 'interp') return '_v(_s(' + node.expr + '))'
  const kids = node.children.length ? '[' + node.children.map(genNode).join(',') + ']' : 'null'
  return '_c("' + node.tag + '",' + genProps(node) + ',' + kids + ')'
}

function isStaticElement(node) {
  if (node.type !== 'element') return false
  if (node.props.some((p) => p.directive || p.dynamic)) return false
  if (!node.children.length) return true
  return node.children.every((child) => child.type === 'text' || isStaticElement(child))
}

function hasRef(node) {
  return (node.props || []).some((p) => p.key === 'ref')
}

function hoistDecision(node) {
  if (!node || node.type !== 'element') return { ok: false, reason: '只有元素节点才谈得上提升' }
  if (hasRef(node)) return { ok: false, reason: 'ref 需要在每轮 patch 时绑定真实节点' }
  if (node.props.some((p) => p.directive)) return { ok: false, reason: '指令会让结构变化，不能提前算死' }
  if (node.props.some((p) => p.dynamic)) return { ok: false, reason: '动态绑定的值每轮都可能变' }
  if (!isStaticElement(node)) return { ok: false, reason: '子树里还有插值或动态后代' }
  return { ok: true, reason: '' }
}

function compileSlots(slots) {
  return slots.map((slot) => {
    const name = slot.name || 'default'
    const scope = slot.scope || []
    const ast = parseTemplate(slot.tpl)
    const body = ast.children[0]
    const scoped = scope.length > 0
    const stable = !scoped && isStaticElement(body) && !hasRef(body)
    const code = scoped
      ? '_t("' + name + '",{' + scope.map((v) => v + ':' + v).join(',') + '})'
      : '_t("' + name + '")'
    return { name, scoped, stable, code, body: genNode(body) }
  })
}`,
      test: L4S3,
      diag: [
        'stable 只看有没有插值，忘了作用域 slot 必须每次重新生成函数。',
        '作用域 slot 的 code 没把 scope 变量传进去，运行时拿不到 item。',
        'name 缺省时返回空字符串，没有归一成 default。',
        'hoistDecision 里 ref 判定放在动态绑定之后，带 ref 的静态节点被判成可提升。',
        'slot 顺序被重新排序（先排普通 slot），应该严格保持入参顺序。'
      ]
    }
  ],
  skeleton: `function parseTemplate(src) {
  // TODO: 游标加栈，遇到 <tag> 压栈、</tag> 弹栈、其它当文本或插值
  throw new Error('parseTemplate 还没实现')
}

function compile(template) {
  throw new Error('compile 还没实现')
}

function analyzeTree(root) {
  // TODO: 算 patchFlag 位掩码、收集 block 的动态项、记录可提升的静态子树
  throw new Error('analyzeTree 还没实现')
}

function compileSlots(slots) {
  throw new Error('compileSlots 还没实现')
}

function hoistDecision(node) {
  throw new Error('hoistDecision 还没实现')
}`,
  solution: `const VOID_TAGS = ['input', 'img', 'image', 'br', 'hr']

function readAttrs(source) {
  const out = []
  let i = 0
  while (i < source.length) {
    if (source[i] === ' ') {
      i++
      continue
    }
    let name = ''
    while (i < source.length && source[i] !== '=' && source[i] !== ' ') {
      name += source[i]
      i++
    }
    let value = ''
    if (source[i] === '=') {
      i++
      while (i < source.length && source[i] !== ' ') {
        value += source[i]
        i++
      }
      if (value[0] === '"') value = value.slice(1, -1)
    }
    out.push([name, value])
  }
  return out
}

function toProps(pairs) {
  return pairs.map((pair) => {
    const name = pair[0]
    const value = pair[1]
    if (name.slice(0, 2) === 'v-') return { key: name, value, directive: true, dynamic: false }
    if (name[0] === ':') return { key: name.slice(1), value, directive: false, dynamic: true }
    if (name[0] === '@') {
      const evt = name.slice(1)
      return { key: 'on' + evt[0].toUpperCase() + evt.slice(1), value, directive: false, dynamic: false }
    }
    return { key: name, value: '"' + value + '"', directive: false, dynamic: false }
  })
}

function parseTemplate(src) {
  const root = { type: 'root', children: [] }
  const stack = [root]
  let i = 0
  while (i < src.length) {
    if (src[i] === '<') {
      const end = src.indexOf('>', i)
      if (src[i + 1] === '/') {
        stack.pop()
        i = end + 1
        continue
      }
      const head = src.slice(i + 1, end)
      const tag = head.split(' ')[0]
      const node = { type: 'element', tag, props: toProps(readAttrs(head.slice(tag.length))), children: [] }
      stack[stack.length - 1].children.push(node)
      if (VOID_TAGS.indexOf(tag) < 0) {
        stack.push(node)
      }
      i = end + 1
    } else {
      const next = src.indexOf('<', i)
      const raw = src.slice(i, next < 0 ? src.length : next)
      const text = raw.trim()
      if (text) {
        const parent = stack[stack.length - 1]
        if (text.slice(0, 2) === '{{') {
          parent.children.push({ type: 'interp', expr: text.slice(2, text.length - 2).trim() })
        } else {
          parent.children.push({ type: 'text', text })
        }
      }
      i = next < 0 ? src.length : next
    }
  }
  return root
}

function genProps(node) {
  const items = []
  for (const p of node.props) {
    if (p.directive) continue
    items.push(p.key + ':' + p.value)
  }
  return items.length ? '{' + items.join(',') + '}' : 'null'
}

function genNode(node) {
  if (node.type === 'text') return '_v("' + node.text + '")'
  if (node.type === 'interp') return '_v(_s(' + node.expr + '))'
  const kids = node.children.length ? '[' + node.children.map(genNode).join(',') + ']' : 'null'
  return '_c("' + node.tag + '",' + genProps(node) + ',' + kids + ')'
}

function compile(template) {
  const ast = parseTemplate(template)
  return ast.children.map(genNode).join(',')
}

function isStaticElement(node) {
  if (node.type !== 'element') return false
  if (node.props.some((p) => p.directive || p.dynamic)) return false
  if (!node.children.length) return true
  return node.children.every((child) => child.type === 'text' || isStaticElement(child))
}

function ownFlag(node) {
  let flag = 0
  const props = node.props || []
  for (const p of props) {
    if (!p.dynamic) continue
    if (p.key === 'class') flag |= 2
    else if (p.key === 'style') flag |= 4
    else flag |= 8
  }
  for (const child of node.children) {
    if (child.type === 'interp') flag |= 1
  }
  return flag
}

function analyzeTree(ast) {
  const nodeList = ast.children || []
  const root = nodeList.length === 1 && nodeList[0].type === 'element'
    ? nodeList[0]
    : { type: 'root', tag: 'root', props: [], children: nodeList }
  const blocks = []
  const hoisted = []
  const isBlock = (node) => node === root || (node.props || []).some((p) => p.key === 'v-if' || p.key === 'v-for')

  function collect(node, top) {
    if (!top && isBlock(node)) return 0
    let count = 0
    for (const p of node.props || []) {
      if (p.dynamic && !p.directive) count++
    }
    for (const child of node.children || []) {
      if (child.type === 'interp') count++
      else if (child.type === 'text') continue
      else count += collect(child, false)
    }
    return count
  }

  blocks.push({ tag: root.tag || 'root', patchFlag: ownFlag(root), dynamic: collect(root, true) })

  const walk = (node) => {
    for (const child of node.children || []) {
      if (child.type !== 'element') continue
      if (isBlock(child)) {
        blocks.push({ tag: child.tag, patchFlag: ownFlag(child), dynamic: collect(child, true) })
        walk(child)
      } else if (isStaticElement(child)) {
        hoisted.push(child.tag)
      } else {
        walk(child)
      }
    }
  }
  walk(root)

  return { blocks, hoisted }
}

function hasRef(node) {
  return (node.props || []).some((p) => p.key === 'ref')
}

function hoistDecision(node) {
  if (!node || node.type !== 'element') return { ok: false, reason: '只有元素节点才谈得上提升' }
  if (hasRef(node)) return { ok: false, reason: 'ref 需要在每轮 patch 时绑定真实节点' }
  if (node.props.some((p) => p.directive)) return { ok: false, reason: '指令会让结构变化，不能提前算死' }
  if (node.props.some((p) => p.dynamic)) return { ok: false, reason: '动态绑定的值每轮都可能变' }
  if (!isStaticElement(node)) return { ok: false, reason: '子树里还有插值或动态后代' }
  return { ok: true, reason: '' }
}

function compileSlots(slots) {
  return slots.map((slot) => {
    const name = slot.name || 'default'
    const scope = slot.scope || []
    const ast = parseTemplate(slot.tpl)
    const body = ast.children[0]
    const scoped = scope.length > 0
    const stable = !scoped && isStaticElement(body) && !hasRef(body)
    const code = scoped
      ? '_t("' + name + '",{' + scope.map((v) => v + ':' + v).join(',') + '})'
      : '_t("' + name + '")'
    return { name, scoped, stable, code, body: genNode(body) }
  })
}`,
  finalCode: '',
  tests: `${L4S1}\n${L4S2}\n${L4S3}`
}

LV4.finalCode = LV4.solution

/* ============================================================ 第 5 关测试 */
const L5S1 = `{
  check('元素加字符串子节点：ELEMENT 与 TEXT_CHILDREN 两个位', () => {
    const vnode = createVNode('div', null, 'hi')
    same(vnode.shapeFlag, 17)
    same(isElement(vnode), true)
    same(hasTextChildren(vnode), true)
    same(hasArrayChildren(vnode), false)
  })
  check('元素加数组子节点：ARRAY_CHILDREN 位', () => {
    const vnode = createVNode('ul', null, [createVNode('li', null, 'a')])
    same(vnode.shapeFlag, 9)
    same(hasArrayChildren(vnode), true)
    same(hasTextChildren(vnode), false)
  })
  check('函数类型被识别成组件，不占用元素位', () => {
    const vnode = createVNode(function Foo() {}, null, [])
    same(vnode.shapeFlag, 10)
    same(isComponent(vnode), true)
    same(isElement(vnode), false)
  })
  check('文本 vnode 只有 TEXT 位，没有子节点标记', () => {
    const vnode = createTextVNode(1)
    same(vnode.shapeFlag, 4)
    same(vnode.children, '1')
    same(isElement(vnode), false)
    same(hasTextChildren(vnode), false)
  })
  check('位运算判定互不污染：有文本位不代表有数组位', () => {
    const vnode = createVNode('p', null, '')
    same(vnode.shapeFlag, 17)
    same((vnode.shapeFlag & 8) === 0, true)
    same((vnode.shapeFlag & 1) > 0, true)
  })
}`

const L5S2 = `{
  check('挂载单个元素：create → props → text → insert 的顺序', () => {
    const r = createRenderer()
    r.mount(createVNode('div', { id: 'a' }, 'hi'), 'root')
    same(r.ops, [
      'createElement:div',
      'patchProp:div.id',
      'setElementText:div:hi',
      'insert:div:root'
    ])
  })
  check('数组子节点先挂进父容器，父节点最后才 insert', () => {
    const r = createRenderer()
    r.mount(createVNode('ul', null, [
      createVNode('li', null, 'a'),
      createVNode('li', null, 'b')
    ]), 'root')
    same(r.ops, [
      'createElement:ul',
      'createElement:li',
      'setElementText:li:a',
      'insert:li:ul',
      'createElement:li',
      'setElementText:li:b',
      'insert:li:ul',
      'insert:ul:root'
    ])
  })
  check('unmount 只记一次 remove，不再碰子节点', () => {
    const r = createRenderer()
    r.unmount(createVNode('div', null, [createVNode('span', null, 'x')]))
    same(r.ops, ['remove:div'])
  })
  check('patch 同类型元素只改文本，不重建节点', () => {
    const r = createRenderer()
    const n1 = createVNode('div', { id: 'a' }, 'hi')
    const n2 = createVNode('div', { id: 'a' }, 'bye')
    r.patch(n1, n2)
    same(r.ops, ['setElementText:div:bye'])
    const r2 = createRenderer()
    r2.patch(createVNode('div', null, 'a'), createVNode('p', null, 'a'))
    same(r2.ops, ['remove:div', 'createElement:p', 'setElementText:p:a', 'insert:p:root'])
  })
  check('keyed diff：裁剪首尾后按 key 复用，多出来的删除、新的挂载', () => {
    const P = [
      createVNode('li', { key: 'a' }, 'A'),
      createVNode('li', { key: 'b' }, 'B'),
      createVNode('li', { key: 'c' }, 'C'),
      createVNode('li', { key: 'd' }, 'D')
    ]
    const N = [
      createVNode('li', { key: 'a' }, 'A2'),
      createVNode('li', { key: 'c' }, 'C2'),
      createVNode('li', { key: 'b' }, 'B2'),
      createVNode('li', { key: 'e' }, 'E')
    ]
    const plan = diffKeyed(P, N).map((step) => step.op + ':' + step.key)
    same(plan, ['patch:c', 'patch:b', 'mount:e', 'unmount:d'])
  })
}`

const L5S3 = `{
  check('props 完全没变时直接跳过，不进入渲染', () => {
    const instance = { props: { title: 'a', count: 1 } }
    const res = updateComponent(instance, { title: 'a', count: 1 })
    same(res.changed, [])
    same(res.phases.join('>'), 'props>skip')
  })
  check('props 变了：props → shouldUpdate → render → patchChildren', () => {
    const instance = { props: { title: 'a', count: 1 } }
    const res = updateComponent(instance, { title: 'b', count: 1 })
    same(res.changed, ['title'])
    same(res.phases.join('>'), 'props>shouldUpdate>render>patchChildren')
    same(instance.props.title, 'b')
  })
  check('KeepAlive：命中把 key 移到队尾，超上限淘汰最久未用的', () => {
    const cache = ['a', 'b']
    const hit = keepAlivePush(cache, 'a', 3)
    same(hit.keys, ['b', 'a'])
    same(hit.evicted, [])
    const added = keepAlivePush(cache, 'c', 3)
    same(added.keys, ['b', 'a', 'c'])
    const over = keepAlivePush(cache, 'd', 3)
    same(over.keys, ['a', 'c', 'd'])
    same(over.evicted, ['b'])
  })
  check('缓存键：优先显式 key，其次标签名或组件名', () => {
    same(cacheKeyOf({ type: 'div', props: null }), 'tag:div')
    same(cacheKeyOf({ type: 'div', props: { key: 'x' } }), 'key:x')
    function List() {}
    same(cacheKeyOf({ type: List }), 'component:List')
  })
  check('Teleport 目标解析与 Transition 的类名阶段', () => {
    const targets = { '#modal': 'div#modal', body: 'body' }
    same(resolveTeleportTarget('#modal', targets), 'div#modal')
    let err = null
    try { resolveTeleportTarget('#missing', targets) } catch (e) { err = e }
    same(err !== null, true, '目标不存在必须报错，不能静默挂到 body')
    same(transitionPhases('fade'), ['fade-enter-from', 'fade-enter-active', 'fade-enter-to'])
    same(transitionPhases('fade', 'leave'), ['fade-leave-from', 'fade-leave-active', 'fade-leave-to'])
  })
}`

/* ============================================================ 第 5 关 */
const LV5 = {
  id: 'lv5',
  title: '运行时与渲染器：vnode 到 patch',
  emoji: '🏗️',
  xp: 80,
  goal: '实现运行时最小闭环：createVNode 用位掩码记录节点类型与子节点形态，createRenderer 录制 host 操作序列，diffKeyed 做首尾裁剪加 key 复用，updateComponent / keepAlivePush / cacheKeyOf / resolveTeleportTarget / transitionPhases 覆盖组件更新与内置组件。',
  why: '运行时的面试题集中在三处：vnode 长什么样（为什么用位运算而不是多个布尔字段）、自定义渲染器怎样把同一套 diff 复用到 DOM / 小程序 / canvas（host 操作的抽象边界在哪）、以及 keyed diff 凭什么能做到「最小移动」。这些如果不落到操作序列上，讲起来永远是抽象的「diff 算法」。本关把渲染器输出的 host 操作录成数组，于是「先创建子节点再插入父节点」「同类型只改文本」「复用三个删除一个」都变成了可以直接断言的序列。',
  nodes: ['fe.vue.runtime', 'fe.vue.runtime.builtin-components', 'fe.vue.runtime.custom-renderer', 'fe.vue.runtime.diff-key', 'fe.vue.runtime.update-flow'],
  thinking: [
    {
      title: 'shapeFlag 用一个数字装下所有「像什么」',
      md: 'vnode 需要回答三个问题：这是元素还是组件？children 是字符串还是数组？是不是文本节点？如果用三个布尔字段，每个 vnode 多 3 个属性，一万个 vnode 就是三万次属性访问；用一个数字的位，一次按位与就能判断。\n\n`ELEMENT=1`、`COMPONENT=2`、`TEXT=4`、`ARRAY_CHILDREN=8`、`TEXT_CHILDREN=16` 这些常量互不重叠，所以 `shapeFlag & ELEMENT` 只回答「是不是元素」。注意 children 的标记要加在同一个数字上：`createVNode("div", null, "hi")` 的 shapeFlag 是 17（1+16），不是 1。'
    },
    {
      title: '渲染器的抽象边界就是 host 操作',
      md: '自定义渲染器的做法是把「创建节点、插节点、删节点、改属性」这几件事抽成接口，diff 逻辑只调用接口、不碰 DOM。于是同一份 patch 代码可以跑在浏览器（createElement）、小程序（setData 构造节点）、canvas（绘图指令）上。\n\n本关把接口的调用记录下来变成字符串序列，这是最省事的可观测方式。序列本身还暴露了顺序问题：mount 一个元素必须是「创建 → 设属性 → 挂子节点 → 插入父容器」，插入放最后是为了让节点带着完整子树一次性进文档，避免中间态闪烁。'
    },
    {
      title: 'keyed diff 的「裁剪 + key 表」只是半张答案',
      md: '真实实现分两步：先用双端对比裁掉相同的头和尾（大多数列表更新只有局部变化，裁剪之后要处理的中段很短），再用 key 到旧下标的映射判断「复用还是新建」。Vue3 更进一步，对中段求最长递增子序列（LIS），LIS 里的节点保持相对顺序不动，只移动不在 LIS 里的节点——这就是「最小移动」的来源。\n\n本关只做前两步，输出复用 / 新增 / 删除三类操作，不计算移动。这不是偷懒，是因为移动的最小性依赖 LIS，而 LIS 本身是一道独立的算法题（第 5 关的扩展练习）。能说清「为什么需要 LIS」比背下 LIS 的代码更重要。'
    }
  ],
  prereq: [
    {
      title: '位掩码的三个惯用法',
      md: '```js\nconst flag = a | b          // 打标记：把多个位合到一个数字\nconst has = (f, bit) => (f & bit) > 0   // 判标记\nconst clear = (f, bit) => f & ~bit      // 清标记\n```\n\n要点是常量必须是 2 的幂（1、2、4、8、16……），否则位会重叠。判标记时用 `> 0` 而不是 `=== bit`，因为一个数字里可能同时有多个位。'
    },
    {
      title: '为什么 mount 要「子节点先、插入后」',
      md: '如果你先 `insert(parent, container)` 再挂子节点，浏览器会先把空的父节点渲染出来，下一帧才补上内容——用户看到的是闪烁。正确顺序是把整棵子树在内存里建好，最后一次插入。\n\n这个顺序在测试里非常显眼：`insert:ul:root` 一定排在两个 `insert:li:ul` 之后。同理 unmount 时只需要删根节点（`remove:div`），子节点会跟着一起离开文档，不需要逐个删。'
    }
  ],
  api: [
    {
      name: 'createVNode / createTextVNode',
      sig: 'createVNode(type, props, children) / createTextVNode(text)',
      args: 'type 是字符串（元素）或函数（组件）；props 是属性对象或 null；children 是字符串、数组或 null。',
      returns: 'vnode 对象 { type, props, children, shapeFlag }，shapeFlag 是位掩码；createTextVNode 直接产出 TEXT 位的文本节点。',
      example: 'createVNode(\'div\', null, \'hi\').shapeFlag   // 17 = 1 + 16'
    },
    {
      name: 'createRenderer',
      sig: 'createRenderer() => { ops, mount(vnode, container), patch(n1, n2), unmount(vnode) }',
      args: '无参数（本关把 host 操作直接录进 ops；真实实现会注入 createElement / insert 等接口）。',
      returns: 'ops 是按发生顺序记录的 host 操作字符串数组；mount 建树并插入；patch 按「类型是否相同 / 文本是否变化 / 数组子节点」分支处理；unmount 只删根。',
      example: 'const r = createRenderer()\nr.mount(createVNode(\'div\', { id: \'a\' }, \'hi\'), \'root\')\nr.ops   // [\'createElement:div\', \'patchProp:div.id\', \'setElementText:div:hi\', \'insert:div:root\']'
    },
    {
      name: 'diffKeyed',
      sig: 'diffKeyed(prevChildren, nextChildren) => Array<{ op, key }>',
      args: '两个 vnode 数组，key 取值优先级为 vnode.key 再 props.key。',
      returns: '操作数组：op 是 patch / mount / unmount，key 是对应键。先裁掉首尾相同的部分，中段按 key 表判复用或新建。',
      example: 'diffKeyed(prev, next).map((s) => s.op + \':\' + s.key)\n// => [\'patch:c\', \'patch:b\', \'mount:e\', \'unmount:d\']'
    },
    {
      name: 'updateComponent',
      sig: 'updateComponent(instance, nextProps) => { changed, phases }',
      args: 'instance 至少带 props；nextProps 是新的 props 对象。',
      returns: 'changed 是浅比较后变化的键；phases 是本次走到的阶段名数组——无变化时是 [props, skip]，有变化时是 [props, shouldUpdate, render, patchChildren]，并同步把 instance.props 更新掉。',
      example: 'updateComponent({ props: { a: 1 } }, { a: 2 }).phases.join(\'>\')\n// => \'props>shouldUpdate>render>patchChildren\''
    },
    {
      name: 'keepAlivePush / cacheKeyOf',
      sig: 'keepAlivePush(cache, key, max) => { keys, evicted } / cacheKeyOf(vnode) => string',
      args: 'cache 是 LRU 顺序的 key 数组（最久未用在前）；max 是缓存上限。',
      returns: '命中的 key 移到队尾，超上限时从队首淘汰并放进 evicted；cacheKeyOf 返回 key: / tag: / component: 前缀的缓存键。',
      example: 'const cache = [\'a\', \'b\']\nkeepAlivePush(cache, \'a\', 3).keys   // [\'b\', \'a\']'
    },
    {
      name: 'resolveTeleportTarget / transitionPhases',
      sig: 'resolveTeleportTarget(to, targets) => node / transitionPhases(name, mode) => string[]',
      args: 'to 是选择器；targets 是选择器到节点的映射；mode 缺省 enter，可传 leave。',
      returns: '目标节点（不存在时抛错）；Transition 的类名序列 [from, active, to]。',
      example: 'resolveTeleportTarget(\'#modal\', { \'#modal\': node })   // node\ntransitionPhases(\'fade\')   // [\'fade-enter-from\', \'fade-enter-active\', \'fade-enter-to\']'
    }
  ],
  usage: '// 渲染器的两种用法：真 DOM 与「录制模式」\nconst renderer = createRenderer()\nrenderer.patch(prevTree, nextTree)\nconsole.log(renderer.ops)   // 交给测试或 devtools 观察\n\n// 组件更新：props 没变就不进 render\nconst { changed, phases } = updateComponent(instance, nextProps)\nif (phases[phases.length - 1] === \'skip\') return',
  hints: [
    '第 1 步的常量必须互不重叠；ELEMENT 与 COMPONENT 用三元表达式二选一，children 位再或上去。',
    '第 2 步的 mountElement 顺序固定：createElement → patchProp → children → insert。',
    '第 2 步的 diffKeyed 先裁首尾，中段用对象建 key 到下标的映射，匹配过的标记成 -1。',
    '第 3 步的 updateComponent 用 Object.assign 合并键集再逐键比较，避免漏掉新增键。',
    '第 3 步的 keepAlivePush 命中时先 splice 再 push，淘汰用 while 而不是 if（max 可能很小）。'
  ],
  concepts: [
    {
      title: '同一份 diff，三种宿主',
      md: 'Vue 的 runtime-core 不引用任何 DOM API，所有平台差异都被收进 nodeOps。浏览器用 document.createElement，uni-app 的小程序端把 createElement 变成「拼 setData 的节点描述」，canvas 渲染器则把 createElement 变成绘图指令。这就是为什么「换渲染目标」在 Vue3 里是加一个包，而不是 fork 一份代码。'
    },
    {
      title: '本关简化了什么',
      md: '真实实现里还有：patchProps 的逐键 diff（class / style 单独处理）、事件卸载、fragment 与数组根节点、Teleport 的占位符与 target 变化重定位、Suspense、KeepAlive 的 include / exclude 与组件实例复用、Transition 的钩子与 duration 推算，以及 diff 的 LIS 最小移动。本关保留的是三条主线的骨架：位掩码判型、host 操作序列、key 复用与淘汰。'
    }
  ],
  stages: [
    {
      n: 1,
      title: 'vnode 与位掩码',
      think: '先只做「造节点 + 判类型」。三个问题（是不是元素、是不是组件、子节点是文本还是数组）用一个数字回答，判定全部走按位与。',
      hint: 'type 是字符串就是元素、否则算组件；children 是字符串加 TEXT_CHILDREN、是数组加 ARRAY_CHILDREN。',
      code: `const ShapeFlags = {
  ELEMENT: 1,
  COMPONENT: 2,
  TEXT: 4,
  ARRAY_CHILDREN: 8,
  TEXT_CHILDREN: 16
}

function createVNode(type, props, children) {
  let shapeFlag = typeof type === 'string' ? ShapeFlags.ELEMENT : ShapeFlags.COMPONENT
  if (typeof children === 'string') shapeFlag |= ShapeFlags.TEXT_CHILDREN
  else if (Array.isArray(children)) shapeFlag |= ShapeFlags.ARRAY_CHILDREN
  return {
    type,
    props: props || null,
    children: typeof children === 'undefined' ? null : children,
    shapeFlag
  }
}

function createTextVNode(text) {
  return { type: 'text', props: null, children: String(text), shapeFlag: ShapeFlags.TEXT }
}

function isElement(vnode) {
  return (vnode.shapeFlag & ShapeFlags.ELEMENT) > 0
}

function isComponent(vnode) {
  return (vnode.shapeFlag & ShapeFlags.COMPONENT) > 0
}

function hasTextChildren(vnode) {
  return (vnode.shapeFlag & ShapeFlags.TEXT_CHILDREN) > 0
}

function hasArrayChildren(vnode) {
  return (vnode.shapeFlag & ShapeFlags.ARRAY_CHILDREN) > 0
}`,
      test: L5S1,
      diag: [
        'shapeFlag 只存了类型位，children 的位没或上去，17 变成了 1。',
        '常量不是 2 的幂（比如 COMPONENT 写成 3），按位与判定串位。',
        'isElement 用 === 比较，遇到 17 这种复合位就判成 false。',
        'createTextVNode 忘了加 TEXT 位，文本节点被当成元素进 patch。',
        '函数类型的组件也被算进了 ELEMENT 位，isComponent 一直是 false。'
      ]
    },
    {
      n: 2,
      title: '渲染器与 keyed diff',
      think: '把 host 操作录成字符串，顺序就变成了可以直接断言的证据。再写 keyed diff：裁首尾、建 key 表、复用 / 新增 / 删除三类操作。',
      hint: 'mountElement 里 insert 放最后；diffKeyed 里匹配过的旧下标记成 -1，最后扫一遍没被标记的就是要删的。',
      code: `const ShapeFlags = {
  ELEMENT: 1,
  COMPONENT: 2,
  TEXT: 4,
  ARRAY_CHILDREN: 8,
  TEXT_CHILDREN: 16
}

function createVNode(type, props, children) {
  let shapeFlag = typeof type === 'string' ? ShapeFlags.ELEMENT : ShapeFlags.COMPONENT
  if (typeof children === 'string') shapeFlag |= ShapeFlags.TEXT_CHILDREN
  else if (Array.isArray(children)) shapeFlag |= ShapeFlags.ARRAY_CHILDREN
  return {
    type,
    props: props || null,
    children: typeof children === 'undefined' ? null : children,
    shapeFlag
  }
}

function keyOf(vnode) {
  if (vnode.key !== undefined && vnode.key !== null) return vnode.key
  if (vnode.props && vnode.props.key !== undefined) return vnode.props.key
  return undefined
}

function diffKeyed(prev, next) {
  let start = 0
  while (start < prev.length && start < next.length && keyOf(prev[start]) === keyOf(next[start])) start++

  let endPrev = prev.length - 1
  let endNext = next.length - 1
  while (endPrev >= start && endNext >= start && keyOf(prev[endPrev]) === keyOf(next[endNext])) {
    endPrev--
    endNext--
  }

  const index = {}
  for (let i = start; i <= endPrev; i++) index[String(keyOf(prev[i]))] = i

  const ops = []
  for (let j = start; j <= endNext; j++) {
    const key = String(keyOf(next[j]))
    if (index[key] === undefined) {
      ops.push({ op: 'mount', key })
    } else {
      ops.push({ op: 'patch', key })
      index[key] = -1
    }
  }
  for (let i = start; i <= endPrev; i++) {
    const key = String(keyOf(prev[i]))
    if (index[key] !== -1) ops.push({ op: 'unmount', key })
  }
  return ops
}

function createRenderer() {
  const ops = []

  function mountElement(vnode, container) {
    ops.push('createElement:' + vnode.type)
    for (const key of Object.keys(vnode.props || {})) {
      if (key === 'key') continue
      ops.push('patchProp:' + vnode.type + '.' + key)
    }
    if (typeof vnode.children === 'string') {
      ops.push('setElementText:' + vnode.type + ':' + vnode.children)
    } else if (Array.isArray(vnode.children)) {
      for (const child of vnode.children) mountElement(child, vnode.type)
    }
    ops.push('insert:' + vnode.type + ':' + container)
  }

  function mount(vnode, container) {
    if (typeof vnode.type === 'string') mountElement(vnode, container)
    else ops.push('mountComponent:' + (vnode.type.name || 'anonymous') + ':' + container)
  }

  function unmount(vnode) {
    ops.push('remove:' + vnode.type)
  }

  function patch(n1, n2) {
    if (!n1) return mount(n2, 'root')
    if (n1.type !== n2.type) {
      unmount(n1)
      return mount(n2, 'root')
    }
    if (typeof n2.children === 'string' && n2.children !== n1.children) {
      ops.push('setElementText:' + n2.type + ':' + n2.children)
      return
    }
    if (Array.isArray(n1.children) && Array.isArray(n2.children)) {
      const plan = diffKeyed(n1.children, n2.children)
      for (const step of plan) ops.push(step.op + ':' + step.key)
    }
  }

  return { ops, mount, patch, unmount }
}`,
      test: L5S2,
      diag: [
        'insert 写在 children 之前，父节点先进文档再补子节点（会出现空节点闪烁）。',
        'diffKeyed 没有裁首尾，整段重新 patch，输出里多了无意义的 patch 操作。',
        'key 表匹配过的旧下标没有标记成 -1，最后又被当成删除输出一次。',
        'patch 遇到类型不同没有先 remove，直接改文本导致旧节点残留。',
        'mountElement 把 props 里的 key 也当成属性打了一条 patchProp。'
      ]
    },
    {
      n: 3,
      title: '组件更新流与内置组件',
      think: '组件更新的判定其实是一次浅比较：键集合并后逐键比，没变化就跳过整轮渲染。内置组件各有各的状态：KeepAlive 是 LRU，Teleport 是目标解析，Transition 是类名的三段式。',
      hint: 'updateComponent 先用 Object.assign 合并键集再 filter；keepAlivePush 命中先 splice 再 push，超限用 while 淘汰。',
      code: `function updateComponent(instance, nextProps) {
  const prev = instance.props || {}
  const keys = Object.keys(Object.assign({}, prev, nextProps))
  const changed = keys.filter((key) => prev[key] !== nextProps[key])
  const phases = ['props']
  if (changed.length === 0) {
    phases.push('skip')
    return { changed, phases }
  }
  phases.push('shouldUpdate')
  instance.props = Object.assign({}, prev, nextProps)
  phases.push('render')
  phases.push('patchChildren')
  return { changed, phases }
}

function cacheKeyOf(vnode) {
  const key = vnode.key !== undefined && vnode.key !== null
    ? vnode.key
    : vnode.props && vnode.props.key
  if (key !== undefined && key !== null) return 'key:' + key
  const type = vnode.type
  if (typeof type === 'string') return 'tag:' + type
  return 'component:' + (type && type.name ? type.name : 'anonymous')
}

function keepAlivePush(cache, key, max) {
  const at = cache.indexOf(key)
  if (at >= 0) cache.splice(at, 1)
  cache.push(key)
  const evicted = []
  while (cache.length > max) evicted.push(cache.shift())
  return { keys: cache.slice(), evicted }
}

function resolveTeleportTarget(to, targets) {
  const node = targets[to]
  if (!node) throw new Error('teleport 目标不存在: ' + to)
  return node
}

function transitionPhases(name, mode) {
  const m = mode || 'enter'
  return [name + '-' + m + '-from', name + '-' + m + '-active', name + '-' + m + '-to']
}`,
      test: L5S3,
      diag: [
        'updateComponent 只比较 nextProps 自己的键，漏掉了被删除的键。',
        'props 没变时没有提前返回，还是走了 render，白白重渲染一次。',
        'instance.props 忘了更新，下一轮比较的基准还是旧的，导致永远「有变化」。',
        'keepAlivePush 命中时没有先 splice，队里出现重复 key。',
        '淘汰用 if 而不是 while，max 比当前长度小很多时一次淘汰不干净。'
      ]
    }
  ],
  skeleton: `const ShapeFlags = { ELEMENT: 1, COMPONENT: 2, TEXT: 4, ARRAY_CHILDREN: 8, TEXT_CHILDREN: 16 }

function createVNode(type, props, children) {
  // TODO: 组装 { type, props, children, shapeFlag }
  throw new Error('createVNode 还没实现')
}

function createTextVNode(text) {
  throw new Error('createTextVNode 还没实现')
}

function createRenderer() {
  // TODO: 把 host 操作录成数组，mount 顺序是 create → props → children → insert
  throw new Error('createRenderer 还没实现')
}

function diffKeyed(prev, next) {
  throw new Error('diffKeyed 还没实现')
}

function updateComponent(instance, nextProps) {
  throw new Error('updateComponent 还没实现')
}

function keepAlivePush(cache, key, max) {
  throw new Error('keepAlivePush 还没实现')
}

function cacheKeyOf(vnode) {
  throw new Error('cacheKeyOf 还没实现')
}

function resolveTeleportTarget(to, targets) {
  throw new Error('resolveTeleportTarget 还没实现')
}

function transitionPhases(name, mode) {
  throw new Error('transitionPhases 还没实现')
}`,
  solution: `const ShapeFlags = {
  ELEMENT: 1,
  COMPONENT: 2,
  TEXT: 4,
  ARRAY_CHILDREN: 8,
  TEXT_CHILDREN: 16
}

function createVNode(type, props, children) {
  let shapeFlag = typeof type === 'string' ? ShapeFlags.ELEMENT : ShapeFlags.COMPONENT
  if (typeof children === 'string') shapeFlag |= ShapeFlags.TEXT_CHILDREN
  else if (Array.isArray(children)) shapeFlag |= ShapeFlags.ARRAY_CHILDREN
  return {
    type,
    props: props || null,
    children: typeof children === 'undefined' ? null : children,
    shapeFlag
  }
}

function createTextVNode(text) {
  return { type: 'text', props: null, children: String(text), shapeFlag: ShapeFlags.TEXT }
}

function isElement(vnode) {
  return (vnode.shapeFlag & ShapeFlags.ELEMENT) > 0
}

function isComponent(vnode) {
  return (vnode.shapeFlag & ShapeFlags.COMPONENT) > 0
}

function hasTextChildren(vnode) {
  return (vnode.shapeFlag & ShapeFlags.TEXT_CHILDREN) > 0
}

function hasArrayChildren(vnode) {
  return (vnode.shapeFlag & ShapeFlags.ARRAY_CHILDREN) > 0
}

function keyOf(vnode) {
  if (vnode.key !== undefined && vnode.key !== null) return vnode.key
  if (vnode.props && vnode.props.key !== undefined) return vnode.props.key
  return undefined
}

function diffKeyed(prev, next) {
  let start = 0
  while (start < prev.length && start < next.length && keyOf(prev[start]) === keyOf(next[start])) start++

  let endPrev = prev.length - 1
  let endNext = next.length - 1
  while (endPrev >= start && endNext >= start && keyOf(prev[endPrev]) === keyOf(next[endNext])) {
    endPrev--
    endNext--
  }

  const index = {}
  for (let i = start; i <= endPrev; i++) index[String(keyOf(prev[i]))] = i

  const ops = []
  for (let j = start; j <= endNext; j++) {
    const key = String(keyOf(next[j]))
    if (index[key] === undefined) {
      ops.push({ op: 'mount', key })
    } else {
      ops.push({ op: 'patch', key })
      index[key] = -1
    }
  }
  for (let i = start; i <= endPrev; i++) {
    const key = String(keyOf(prev[i]))
    if (index[key] !== -1) ops.push({ op: 'unmount', key })
  }
  return ops
}

function createRenderer() {
  const ops = []

  function mountElement(vnode, container) {
    ops.push('createElement:' + vnode.type)
    for (const key of Object.keys(vnode.props || {})) {
      if (key === 'key') continue
      ops.push('patchProp:' + vnode.type + '.' + key)
    }
    if (typeof vnode.children === 'string') {
      ops.push('setElementText:' + vnode.type + ':' + vnode.children)
    } else if (Array.isArray(vnode.children)) {
      for (const child of vnode.children) mountElement(child, vnode.type)
    }
    ops.push('insert:' + vnode.type + ':' + container)
  }

  function mount(vnode, container) {
    if (typeof vnode.type === 'string') mountElement(vnode, container)
    else ops.push('mountComponent:' + (vnode.type.name || 'anonymous') + ':' + container)
  }

  function unmount(vnode) {
    ops.push('remove:' + vnode.type)
  }

  function patch(n1, n2) {
    if (!n1) return mount(n2, 'root')
    if (n1.type !== n2.type) {
      unmount(n1)
      return mount(n2, 'root')
    }
    if (typeof n2.children === 'string' && n2.children !== n1.children) {
      ops.push('setElementText:' + n2.type + ':' + n2.children)
      return
    }
    if (Array.isArray(n1.children) && Array.isArray(n2.children)) {
      const plan = diffKeyed(n1.children, n2.children)
      for (const step of plan) ops.push(step.op + ':' + step.key)
    }
  }

  return { ops, mount, patch, unmount }
}

function updateComponent(instance, nextProps) {
  const prev = instance.props || {}
  const keys = Object.keys(Object.assign({}, prev, nextProps))
  const changed = keys.filter((key) => prev[key] !== nextProps[key])
  const phases = ['props']
  if (changed.length === 0) {
    phases.push('skip')
    return { changed, phases }
  }
  phases.push('shouldUpdate')
  instance.props = Object.assign({}, prev, nextProps)
  phases.push('render')
  phases.push('patchChildren')
  return { changed, phases }
}

function cacheKeyOf(vnode) {
  const key = vnode.key !== undefined && vnode.key !== null
    ? vnode.key
    : vnode.props && vnode.props.key
  if (key !== undefined && key !== null) return 'key:' + key
  const type = vnode.type
  if (typeof type === 'string') return 'tag:' + type
  return 'component:' + (type && type.name ? type.name : 'anonymous')
}

function keepAlivePush(cache, key, max) {
  const at = cache.indexOf(key)
  if (at >= 0) cache.splice(at, 1)
  cache.push(key)
  const evicted = []
  while (cache.length > max) evicted.push(cache.shift())
  return { keys: cache.slice(), evicted }
}

function resolveTeleportTarget(to, targets) {
  const node = targets[to]
  if (!node) throw new Error('teleport 目标不存在: ' + to)
  return node
}

function transitionPhases(name, mode) {
  const m = mode || 'enter'
  return [name + '-' + m + '-from', name + '-' + m + '-active', name + '-' + m + '-to']
}`,
  finalCode: '',
  tests: `${L5S1}\n${L5S2}\n${L5S3}`
}

LV5.finalCode = LV5.solution

export default {
  id: 'fe-vue',
  version: 3,
  domain: 'fe',
  cumulative: false,
  title: '前端双线：uni-app 跨端与 Vue3 内核',
  emoji: '🛠️',
  tagline: '5 关手写跨端编译与 Vue3 内嵌机制：条件编译、WXML 映射、页面栈、响应式调度、编译器、渲染器。',
  stack: ['Vue3', 'uni-app', '小程序', '模板编译', '渲染器'],
  intro: '这个项目把前端的两条主线拼在一起：跨端框架（uni-app 一套代码编译到小程序 / H5 / App）和 Vue3 内核（响应式、调度器、编译器、运行时与渲染器）。五关都是从零手写的可运行模型——条件编译的嵌套求值、模板到 WXML 的指令映射、小程序页面生命周期与 setData 桥接、依赖收集与 job 队列、模板编译流水线与 block tree、自定义渲染器与 keyed diff。每个模型都明确标注了简化边界：不依赖真实编译器与真实小程序容器，行为用纯函数与注入的事件数组表达，因此每一条断言都能在判题沙箱里精确复现。',
  outcome: '写完这套模型，你能把「uni-app 为什么能一套代码多端跑」「setData 为什么贵」「Vue3 的更新为什么是异步批量的」「编译器凭什么跳过静态节点」从源码级讲到取舍级，而不是背结论。同时你手上会有五个可以现场手写的实现：条件编译求值器、WXML 指令映射器、页面栈与 setData 桥、依赖收集加调度器、迷你模板编译器、自定义渲染器与双端 diff。',
  levels: [LV1, LV2, LV3, LV4, LV5]
}