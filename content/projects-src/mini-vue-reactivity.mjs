/**
 * 内容源：从零写一个响应式内核（Vue3 reactivity）
 *
 * 这一季的关卡划分原则只有一条：**一关只解决一个「我也想问」的问题**。
 * 第一版把 track/trigger/reactive/effect 四件事塞进同一关，用户的反馈是
 * 「reactive(obj) 是做什么的？我只能写出一个空函数」——所以现在从
 * Proxy 本身开始，每关只增加一个能力，且前置知识写清楚到「照着抄都行」。
 *
 * 改完跑 `node scripts/project-build.mjs --only=mini-vue` 重新生成 JSON。
 */
export default {
  id: 'mini-vue-reactivity',
  version: 3,
  title: '从零写一个响应式内核',
  emoji: '⚡',
  domain: 'fe',
  tagline: '9 关，从「Proxy 是什么」开始，一路写到 computed：数据一变，用到它的代码自动重跑。',
  stack: ['JavaScript'],
  intro: '这一季不背概念，只写代码。每一关都是：先读一段前置知识（带可运行的小例子），再照着分阶段提示，一步一步写出当步的完整代码，每步都点「跑测试」看红绿。第 1 关你只会写两行代码，第 9 关你会得到一份完整的响应式实现。',
  outcome: '做完你手上有一份能跑、能讲清每一步为什么这么写的实现：Proxy 拦截、依赖收集、精确触发、分支清理、嵌套栈、调度器、computed 缓存。面试被问到 Vue3 响应式，你可以直接照着这九关讲。',
  levels: [
    /* ------------------------------------------------------------ 第 1 关 */
    {
      id: 'lv1',
      title: '让读写经过你的代码',
      emoji: '🧩',
      xp: 30,
      // 本关的 __raw/__setCount/__deleteCount 是专属观察孔，不参与跨关回归
      regress: false,
      goal: '写出 reactive(obj)：它返回一个「替身」，读、写、删、查都会先经过你写的函数，最后才落到原对象上。从空白开始写，每写完一步都能立刻跑测试。',
      why: '响应式的全部魔法都发生在「读」和「写」这两个瞬间。可 JavaScript 默认不给你插手的机会：state.count 这一行，引擎直接把值给你了，你没有任何机会知道「有人在读 count」。Proxy 就是那个能插手的口子。这一关先把口子接到「读、写、删、查」四个位置，并且每接一个就跑一次测试——不靠猜，靠红绿确认自己接对了。',
      nodes: ['fe.vue.reactivity.proxify'],
      thinking: [
        {
          title: '先问「我要在哪一刻插手」，再问「用什么工具」',
          md: `拿到「做一个 reactive」这个需求，我没有先想 Proxy，而是先问：响应式到底需要我在哪一刻拿到控制权？

答案只有两个瞬间——**有人读我的属性**、**有人写我的属性**。因为「数据变了要通知」这件事，必然是先有人读，才知道该通知谁；先有人写，才知道该通知了。把这两个瞬间想清楚，剩下的只是选工具。

这个顺序很重要。反过来先想工具，就会陷进「Proxy 有 13 个陷阱，我该用哪几个」；先想需求，答案自己会收敛到 get 和 set。`
        },
        {
          title: '为什么不用 Object.defineProperty（Vue2 走的路）',
          md: `Vue2 是把对象上已有的每个属性改写成 getter/setter。它能拦读写，但有三件事拦不到，每一件都要额外打补丁：

- **新增属性**：obj.newKey = 1 不触发，所以 Vue2 才需要 $set
- **数组下标和 length**：arr[0] = x、arr.push 都不触发，所以它重写了 7 个数组方法
- **必须初始化时递归遍历**所有嵌套属性，对象一大启动就卡

Proxy 是在对象外面套一层，**访问发生的那一刻才拦**：新增属性、数组下标、in、delete 天然就拦得到，不需要提前遍历。

我选它不是因为「新」，是因为它把 Vue2 的三个补丁变成了零个。`
        },
        {
          title: '第一步为什么先写「一个空 handler」',
          md: `很多人一上来就写 get / set。我先写 new Proxy(target, {})——handler 是空对象——然后直接跑一遍测试。

理由：我需要先确认「Proxy 的默认行为是不是透明的」。如果空 handler 就已经等价于原对象，我就有了一个可靠的基线：之后任何行为异常，都只可能来自我新加的那几行，排错范围立刻从「整个机制不可信」缩小到「我刚写的 3 行」。

一跑，测试全绿。这 30 秒买到的是对机制的确认，不是功能。

这是我最常用的调试习惯：**先让最小版本跑通，再一格一格加功能**。`
        },
        {
          title: 'get 里为什么必须写 Reflect.get(t, key, receiver)，而不是 t[key]',
          md: `这两行在普通对象上结果一模一样，所以我一开始也觉得无所谓。区别在一个参数上：**receiver**——正在被访问的那个代理。

对象上如果有 getter，getter 里的 this 指向谁，取决于这次访问是怎么发起的。用 Reflect.get(t, key, receiver)，getter 的 this 就是代理；写成 t[key]，this 就退化成原对象。一旦 getter 内部又去读被代理的属性（响应式里极其常见），this 错了，后面的追踪就全断了。

还有一个更实用的理由：Proxy 和 Reflect 是**官方设计上的对称**。你拦到的每一种操作，都有一个同名的 Reflect 方法替你去真正做这件事：

- 拦 get，就用 Reflect.get
- 拦 set，就用 Reflect.set
- 拦 deleteProperty，就用 Reflect.deleteProperty
- 拦 has，就用 Reflect.has
- 拦 ownKeys，就用 Reflect.ownKeys

记住这条对称，就不用背 API：**我拦什么，就交给同名的 Reflect 去做。**`
        },
        {
          title: '每一步为什么都要留下一个「看得见的证据」',
          md: `如果第 2 步的 get 里只写了原样转发，测试照样是绿的——因为 Proxy 默认转发本来就是对的行为。那种绿什么也没证明。

所以每一步我都让它留下一点可观察的东西：

- 第 2 步：读 \`__raw\` 能拿回原对象
- 第 3 步：读 \`__setCount\` 能看到「写入发生过几次」
- 第 4 步：读 \`__deleteCount\` 能看到「删除发生过几次」

这不是写测试的套路，是我随时要能回答「我这一步真的接上去了吗」。看不到现象，就等于没接。

顺便说一句，这三笔「记账」正是下一关的地基：get 里记账就是**依赖收集**，set 里记账就是**触发更新**。我现在写的是最小版本，但它和最终的响应式是同一个形状。`
        }
      ],
      prereq: [
        {
          title: 'Proxy 是什么：new Proxy(target, handler)',
          md: `Proxy 是 JavaScript 内置的构造函数，用来给一个对象造一个**替身**。

\`\`\`js
const raw = { count: 1 }
const state = new Proxy(raw, {})   // 两个参数：原对象、陷阱集合

state.count        // 1，读得到
state.count = 2    // 写进去
raw.count          // 2，原对象真的变了
\`\`\`

三个要点：

1. **不是拷贝**。整个过程中只有一个对象，raw 和 state 是「本体」与「影子」，改一个另一个立刻是一样。
2. **handler 可以为空**。空 handler 的代理行为和原对象完全一致——因为 Proxy 本来就会把操作原样转发给 target。
3. **它拦的是「操作」，不是「属性」**。拦截发生在你**访问的那一刻**，而不是初始化的时候逐个属性改写。这就是它比 defineProperty 强的地方。`
        },
        {
          title: 'handler 里的「陷阱」：这一关只用 5 个',
          md: `handler 上每个方法就是一个**陷阱（trap）**，同名于你要拦截的操作。JavaScript 一共有 13 种，这一关只需要 5 个：

| 陷阱 | 拦截的是什么 |
| --- | --- |
| get(t, key, receiver) | 读 t[key] |
| set(t, key, value, receiver) | 写 t[key] = value |
| deleteProperty(t, key) | delete t[key] |
| has(t, key) | key in t |
| ownKeys(t) | Object.keys(t)、for...in、Object.getOwnPropertyNames |

其余几个（apply、construct、defineProperty、getOwnPropertyDescriptor…）等用到再说。

**返回值规则不一样，这点最容易踩**：

- get 返回什么，调用方就拿到什么
- set 必须返回布尔。返回 false（或者不写 return，等于 undefined→false）在严格模式下会直接抛 TypeError
- deleteProperty / has 必须返回布尔
- ownKeys 必须返回数组（元素是字符串或 Symbol）`
        },
        {
          title: 'Reflect：和 Proxy 一一对应的「真正干活的人」',
          md: `Reflect 是内置对象，13 个方法和 Proxy 的陷阱名一一对应。陷阱里负责**通知**，Reflect 负责**照做**。

\`\`\`js
Reflect.get(t, key, receiver)          // 读 t[key]，this 绑到 receiver
Reflect.set(t, key, value, receiver)   // 写 t[key] = value，返回 true / false
Reflect.has(t, key)                    // 等价于 key in t
Reflect.deleteProperty(t, key)         // 等价于 delete t[key]，返回布尔
Reflect.ownKeys(t)                     // 返回自有键数组
\`\`\`

为什么不用 obj[key] 这种写法？两个原因：

1. **receiver 传不下去**。obj[key] 的 this 永远是 obj，而 Reflect.get 能显式指定 this。
2. **拿得到布尔结果**。delete 用操作符在严格模式下失败会抛错，Reflect.deleteProperty 只返回 false，你可以在陷阱里把它原样交回去。

一句话：**陷阱里我拦，Reflect 里它做，中间的 return 就是通知的出口。**`
        },
        {
          title: 'get / set 的四个参数，逐个认一遍',
          md: `\`\`\`js
get(target, key, receiver)                // 3 个
set(target, key, value, receiver)         // 4 个
\`\`\`

- **target**：原对象（不是代理）。这一关里我习惯写成 t
- **key**：被读/写的属性名，字符串或 Symbol
- **value**：只出现在 set，准备写进去的新值
- **receiver**：正在被访问的**代理本身**。上面那条思维链讲过它为什么重要

读一个代理上和原型链上的属性都会触发 get；但 set 里如果这个属性其实是原型上的 setter，receiver 会决定 setter 被谁调用。

这一关你只要记住：**t 永远是原对象，receiver 永远是代理**。写错这两个是最常见的 bug。`
        }
      ],
      api: [
        {
          name: 'reactive',
          sig: 'reactive(target: object): object',
          args: 'target —— 任意普通对象，例如 { count: 1 }。函数不会改动它的结构，只在它外面包一层代理。',
          returns: '一个代理对象 proxy。读 proxy.x 得到 target.x；写 proxy.x = v 会真的写进 target；delete、in、Object.keys 的行为都和普通对象一致。',
          example: `const raw = { count: 1 }
const state = reactive(raw)

state.count        // 1
state.count = 5    // 写进 raw
raw.count          // 5

delete state.count
'count' in raw     // false`
        },
        {
          name: '两个调试约定（这一关的测试会用到）',
          sig: 'proxy.__raw / proxy.__setCount / proxy.__deleteCount',
          args: '不是标准 API，是这一关额外约定的「观察孔」。它们必须由 get 陷阱里返回。',
          returns: '__raw 返回原对象；__setCount 返回到目前发生过多少次写入；__deleteCount 返回到目前发生过多少次删除。',
          example: `const raw = { a: 1 }
const state = reactive(raw)

state.__raw          // { a: 1 }，就是 raw 本身
state.a = 2
state.__setCount     // 1
delete state.a
state.__deleteCount  // 1`
        }
      ],
      stages: [
        {
          n: 1,
          title: '先让它「什么都不改」也能用',
          think: '我要先确认 Proxy 默认行为是透明的。空 handler 的代理如果能完全等价于原对象，我就有了一个可靠基线：后面出问题只可能是我新加的那几行。这一步只需要 3 行。',
          hint: '写一个函数 reactive(target)，参数是原对象，返回值应该是一个「替身」。注意：这一步不要写任何拦截逻辑——空着就行。具体怎么造替身，看左栏 Proxy 那条知识卡。',
          diag: [
            '这条查「替身」读出来必须和原对象一模一样。现在不一致，多半是你给 handler 写了逻辑（自己判断 key、自己给默认值）——第 1 步的第二个参数要空着 `{}`，全交给 Proxy 默认转发。',
            '原对象上没有这个键，代理读出来也该是 undefined。你读到了别的值，说明 get 里凭空造了值（默认值、`??` 兜底），而不是把读取原样转发。',
            '这条查「透过替身写，原对象要跟着变」。raw 没变，说明写入被你的 handler 吞掉了——第 1 步不写 set，让默认行为落回原对象。',
            '`in` 走 has 陷阱。两边不一致，说明你写了 has 却没把结果交给 `Reflect.has(t, key)`，或者写死了一个布尔。',
            '`Object.keys` 走 ownKeys 陷阱，必须返回数组。不一致通常是没返回 `Reflect.ownKeys(t)`，或返回了字符串/对象。',
            '`delete` 走 deleteProperty。删完原对象还读得到，说明陷阱里没真删（可能返回了 true 但没删），或者你多接了这条路径。'
          ],
          vocab: [
            { term: 'Proxy 的第二个参数', md: '必须是一个对象。传 {} 表示「一个陷阱都不拦」，这时 Proxy 会透明转发所有操作。省略第二个参数会直接 TypeError。' }
          ],
          code: `function reactive(target) {
  // handler 给空对象：Proxy 的默认行为就是「原样转发」
  return new Proxy(target, {})
}
`,
          test: `{
  const raw = { count: 1, name: 'vue' }
  const state = reactive(raw)

  check('读到的值和原对象一致', () => { same(state.count, 1); same(state.name, 'vue') })
  check('读不存在的属性得到 undefined', () => { same(state.nope, undefined) })
  check('写入会落到原对象上', () => { state.count = 5; same(raw.count, 5) })
  check('in 判断一致', () => { ok('name' in state); same('nope' in state, false) })
  check('Object.keys 一致', () => { same(Object.keys(state).sort(), ['count', 'name']) })
  check('delete 之后两边都读不到', () => { delete state.name; same('name' in raw, false) })
}
`
        },
        {
          n: 2,
          title: '让「读」经过我',
          think: '基线有了，现在开始插手。为什么先做读、后做写？因为响应式里读先于写发生——先知道「谁在读」，后面的「谁该更新」才有对象。而且读坏了我立刻能看到 undefined，比写更好验证。',
          hint: '在 handler 里加一个方法，用来接住「读」。转发交给 Reflect 里同名的方法；另外加一个约定：读 __raw 时直接返回原对象。',
          diag: [
            '加了 get 也得能读普通属性。这里是 undefined，通常是 get 里忘了 `return`，或者 return 的不是 `Reflect.get(t, key, receiver)` 的结果。',
            '对象上的 getter 里写了 `this`，它必须指向代理，否则 getter 内部再读属性会绕过你的拦截。现在不对，通常是调用 `Reflect.get(t, key)` 时漏了第三个参数 receiver。',
            '`__raw` 不是原对象上的键，交给 Reflect 转发只能读到 undefined。get 里要给它单独一个分支：一命中就返回原对象本身，不走转发。',
            '不存在的键必须还是 undefined。你现在造出了值，说明 get 里对未知 key 有兜底（默认值/`??`），或者特判写宽了，把别的键也拦了。'
          ],
          vocab: [
            { term: 'Reflect.get(target, key, receiver)', md: '和读 target[key] 等价，但能显式指定 this（receiver），并且对象上有 getter 时 this 会正确指向 receiver。' },
            { term: '为什么 getter 的 this 很重要', md: '对象上的 getter 里如果写了 this.x，this 是谁决定了读到哪个 x。代理场景下必须让 this 是代理，否则内部读取绕过了你的拦截。' }
          ],
          code: `function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      // 调试口：读 __raw 拿到原对象
      if (key === '__raw') return t
      return Reflect.get(t, key, receiver)
    }
  })
}
`,
          test: `{
  let proxyRef = null
  const raw = { n: 2, get dbl() { return this.n * 2 }, get isProxy() { return this === proxyRef } }
  const state = reactive(raw)
  proxyRef = state

  check('普通属性读得到', () => { same(state.n, 2) })
  check('getter 里的 this 是代理本身，不是原对象', () => { same(state.isProxy, true) })
  check('读取 __raw 拿到原对象', () => { same(state.__raw, raw) })
  check('读不存在的属性还是 undefined', () => { same(state.nope, undefined) })
}
`
        },
        {
          n: 3,
          title: '让「写」经过我',
          think: '读能拦了，写还没。写这里有两个细节：一是必须把 Reflect.set 的布尔结果原样 return（漏了 return，严格模式下会抛 TypeError）；二是我想在这里顺手留一笔「写入发生过几次」的记录——这正是下一关「写触发通知」的位置。',
          hint: '再加一个接住「写」的方法：先给计数加一，再交给 Reflect 的写方法，并把它返回的布尔值原样交回去。别忘了让 __setCount 能读到这个计数——计数器要放在 reactive 内部（每个代理各有一份）。计数器从 0 还是从 1 开始都行，测试只核对「每写一次多一笔」。',
          diag: [
            'set 只负责「接住」，真要落盘得交给 `Reflect.set(t, key, value, receiver)`。raw 没变，说明你只记了数、没有转发这次写入（或转发后把结果丢了）。',
            '新键和已有键一样要能写进去。失败说明 set 里对「原对象上还没有的键」有判断或拦截，把它吞掉了。',
            'set 的返回值必须是布尔：成功 true、失败 false；返回 undefined 会被当成失败，严格模式下直接抛 TypeError。这里要把 Reflect.set 的真实结果原样交回，而不是写死 true。',
            '冻结对象上写入必须返回 false——这正是不能写死 `return true` 的原因。你返回了 true，等于骗调用方「写成功了」，而对象其实没变。',
            '计数器要放在 reactive 内部、Proxy 之前（每个代理各一份），并在 get 里开一个 `__setCount` 出口。对不上，多半是计数器写在模块外层（所有代理共用），或 get 里少了这个分支。'
          ],
          vocab: [
            { term: 'set 陷阱的返回值', md: '必须返回 true / false。返回 false 表示「这次写入没成功」，在严格模式代码里会变成 TypeError 抛出。所以不要硬写 return true，要返回 Reflect.set 的真实结果。' },
            { term: '闭包里的计数器', md: 'let setCount = 0 写在 reactive 内部、new Proxy 之前，get/set 两个陷阱都能访问到它。每个代理对象都有一份自己的计数，互不干扰。' },
            {
              term: '为什么键名是 __setCount，而变量叫 setCount',
              md: `这是两个不同的东西，名字当然不一样：

- \`let setCount\` 是 **reactive 函数内部的闭包变量**。函数外的人（包括拿着代理的调用方）看不见它，直接 \`state.setCount\` 也读不到——除非你在 get 里给它开一个出口。
- \`'__setCount'\` 是 **代理对象上暴露出来的键名**，也就是那个出口。调用方读 \`state.__setCount\`，get 陷阱里命中这个键，然后把闭包里的 \`setCount\` 交出去。

为什么不直接叫 \`setCount\`？因为原对象上可能真的存在一个叫 \`setCount\` 的业务属性（比如 \`{ setCount: 5 }\`）。两个同名，读 \`state.setCount\` 时你就分不清要的是「用户的数据」还是「你记的账」——前者必须原样转发给 Reflect，后者必须拦下来返回计数，同一行代码没法同时做两件事。

\`__\` 前缀是 JavaScript 世界约定俗成的「内部 / 调试专用」标记（英文叫 dunder，double underscore）。它不改变任何语法，只是给读代码的人一个信号：**这个键不是业务数据**。你在别处见过它很多次：\`__proto__\`、Node 的 \`__dirname\`，Vue 内部自己的 \`__v_isReactive\`、\`__v_raw\`。

所以那一行读作：「如果有人访问代理上名为 \`__setCount\` 的键，把我在闭包里数着的 \`setCount\` 给他。」`
            }
          ],
          code: `function reactive(target) {
  let setCount = 0

  return new Proxy(target, {
    get(t, key, receiver) {
      if (key === '__raw') return t
      if (key === '__setCount') return setCount
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      setCount++
      return Reflect.set(t, key, value, receiver)
    }
  })
}
`,
          test: `{
  const raw = { a: 1 }
  const state = reactive(raw)

  check('写入落到原对象', () => { state.a = 9; same(raw.a, 9); same(state.a, 9) })
  check('写一个新属性也能落下去', () => { state.b = 2; same(raw.b, 2) })
  check('写入成功时返回 true', () => { same(Reflect.set(state, 'c', 3), true); same(raw.c, 3) })
  check('写到冻结对象上返回 false，且不修改', () => {
    const frozen = Object.freeze({ x: 1 })
    const st = reactive(frozen)
    same(Reflect.set(st, 'x', 2), false)
    same(frozen.x, 1)
  })
  check('每一次写入都会被记下来（__setCount）', () => {
    const raw2 = { a: 1 }
    const s = reactive(raw2)
    // 只核对「增量」：计数器从 0 开始、从 1 开始、从 10 开始都算对。
    // 以前这里写死 same(s.__setCount, 0)，把「记对了但初始值不同」判成失败——
    // 题面从没规定起点是几，这不是用户该猜的东西。
    const before = s.__setCount
    s.a = 2
    s.b = 3
    same(s.__setCount - before, 2)
  })
}
`
        },
        {
          n: 4,
          title: '把「删」和「查」也接进来',
          think: '读和写都接好了，但对象操作不止这两种：delete、in、Object.keys 也要么经过我，要么默认转发。我现在把它们显式写出来，不是这一步就需要，而是因为下一关我要在这些位置记账——得先有位置可写。这是「先接好口子、再灌业务」的工程习惯。',
          hint: '再加三个方法，分别接住 delete、in、Object.keys；其中 delete 要记一笔。转发继续用 Reflect 的同名方法，最后在 get 里补一个 __deleteCount 分支。',
          diag: [
            'delete 要真正落到原对象上：交给 `Reflect.deleteProperty(t, key)`。删不掉通常是陷阱里没转发，或只记了数没删。',
            '和 `__setCount` 一样：计数器在 reactive 内部，get 里要有 `__deleteCount` 出口。数字不对，检查是不是计数写在 Proxy 外面、或 get 漏了这个分支。',
            '`in` 走 has 陷阱，要原样转发 `Reflect.has(t, key)`。判断错了，多半是写死了 true/false。',
            '`Object.keys` 走 ownKeys，必须返回数组。这里不一致，通常是没返回 `Reflect.ownKeys(t)` 或返回了非数组。',
            '这是回归检查：新加的 delete/in/keys 不能把前面的读写和 `__raw` 弄坏。它红通常是某个新陷阱挡住了老路径——先把前面几条红清掉再看这条。'
          ],
          vocab: [
            { term: 'Reflect 的删除 / 查询方法', md: 'Reflect.deleteProperty(t, key) 等价 delete t[key] 并返回布尔；Reflect.has(t, key) 等价 key in t；Reflect.ownKeys(t) 返回自有键数组（含 Symbol）。' },
            { term: 'ownKeys 返回什么', md: '必须是数组，元素是字符串或 Symbol，否则 Proxy 会抛 TypeError。Reflect.ownKeys 刚好满足这个要求。' },
            { term: '`__deleteCount` 的 `__` 又是什么', md: '和上一步的 `__setCount` 同一套约定：闭包变量 `deleteCount` 在里面，代理上的键名 `__deleteCount` 是给外面看的窗口。`__` 只是「内部 / 调试专用」的记号，防止和原对象上的真实属性重名。起点是几不影响测试：第 4 步只核对「删除一次，账上多一笔」。' }
          ],
          code: `function reactive(target) {
  let setCount = 0
  let deleteCount = 0

  return new Proxy(target, {
    get(t, key, receiver) {
      if (key === '__raw') return t
      if (key === '__setCount') return setCount
      if (key === '__deleteCount') return deleteCount
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      setCount++
      return Reflect.set(t, key, value, receiver)
    },
    deleteProperty(t, key) {
      deleteCount++
      return Reflect.deleteProperty(t, key)
    },
    has(t, key) {
      return Reflect.has(t, key)
    },
    ownKeys(t) {
      return Reflect.ownKeys(t)
    }
  })
}
`,
          test: `{
  const raw = { a: 1, b: 2 }
  const state = reactive(raw)
  // 和 __setCount 一样只看增量：起点是几不影响判定
  const beforeDel = state.__deleteCount

  check('delete 之后两边都读不到', () => { delete state.a; same('a' in raw, false); same(state.a, undefined) })
  check('delete 会被记一次（__deleteCount）', () => { same(state.__deleteCount - beforeDel, 1) })
  check('in 判断仍然正确', () => { ok('b' in state); same('a' in state, false) })
  check('Object.keys 和原对象一致', () => { same(Object.keys(state).sort(), ['b']) })
  check('回归：读、写、__raw 都没被弄坏', () => {
    const r2 = { x: 1 }
    const s2 = reactive(r2)
    const beforeSet = s2.__setCount
    s2.x = 5
    same(r2.x, 5)
    same(s2.__raw, r2)
    same(s2.__setCount - beforeSet, 1)
  })
}
`
        }
      ],
      finalCode: `/**
 * 第 1 关 · reactive(obj)：让读、写、删、查都经过你的函数
 *
 * 到这里你手上有一个「行为和普通对象一致，但每个操作都能插手」的代理。
 * 它现在只做了记账（__setCount / __deleteCount），下一关开始用这些账去通知别人。
 */
function reactive(target) {
  let setCount = 0      // 写入发生了多少次
  let deleteCount = 0   // 删除发生了多少次

  return new Proxy(target, {
    // 读：包括 __raw / __setCount / __deleteCount 这类观察孔
    get(t, key, receiver) {
      if (key === '__raw') return t
      if (key === '__setCount') return setCount
      if (key === '__deleteCount') return deleteCount
      return Reflect.get(t, key, receiver)
    },
    // 写：先记账，再交给 Reflect 真正写进去
    set(t, key, value, receiver) {
      setCount++
      return Reflect.set(t, key, value, receiver)
    },
    // 删：同样先记账
    deleteProperty(t, key) {
      deleteCount++
      return Reflect.deleteProperty(t, key)
    },
    has(t, key) {
      return Reflect.has(t, key)
    },
    ownKeys(t) {
      return Reflect.ownKeys(t)
    }
  })
}
`,
      usage: `// 1) 最普通的用法：把它当成原对象来用
const raw = { count: 0, name: 'vue' }
const state = reactive(raw)

state.count          // 0
state.count = 1      // 写进 raw
raw.count            // 1，原对象真的变了
state.name = 'js'    // 新值也能写

// 2) 观察孔：随时确认「我的拦截接上了没有」
state.__raw          // raw 本身
state.__setCount     // 1（写了一次 count）… 再加一次 name 就是 2
state.__deleteCount  // 0

delete state.name
state.__deleteCount  // 1

// 3) 一个真实场景：把它当「数据源」用
function render() {
  return 'count = ' + state.count
}
render()             // 'count = 1'
state.count = 2
render()             // 'count = 2' —— 但这次是手动调用的

// 第 4 关会解决最后那一行：让 render 自动重跑。
// 现在你还没有「谁在读」的账本，所以只能手动。`,
      hints: [
        'Proxy 完全没用过：先看左栏「先懂这些」第 1 条，那里有一段能直接抄进编辑器的代码，抄完改成你要的样子。',
        '一次只加一个陷阱，加完立刻跑测试。一次加两个，红了就分不清是谁的问题——这条在真实开发里同样成立。',
        'set 陷阱忘了写 return，在严格模式下会抛 TypeError：因为返回 undefined 被当成 false，表示「写入失败」。'
      ],
      concepts: [
        {
          title: '空 handler 的 Proxy 就已经是透明的',
          md: '这是我第一步敢于先写 3 行的原因：Proxy 的默认行为就是把所有操作原样转发给 target。你不需要写任何陷阱，它就已经和原对象行为一致。**陷阱是「额外插入的代码」，不是「必须补全的骨架」**——这一点想明白，就不会把 Proxy 当成一件要「实现」的东西。'
        },
        {
          title: '为什么每个拦截都要配一个同名的 Reflect',
          md: '因为拦截和真正执行是两件事，必须分开写。只有分开，你才能在「真正执行」的前后插入自己的逻辑——记账、通知、校验。Reflect 提供了「真正执行」的标准写法，并且把结果（成功/失败）交还给你。\n\n这也是 Vue3 响应式源码里的固定写法：get 里 track 完再 Reflect.get，set 里 trigger 完再 Reflect.set。你现在写的形状，和它是同一个。'
        },
        {
          title: '这几笔「账」下一关马上要用',
          md: 'setCount 和 deleteCount 现在只是给人看的。下一关它们会变成一个 Map：记录「哪个函数的哪次执行读了哪个对象的哪个属性」。到那时候，get 里不再只 +1，而是把这个函数登记进账本；set 里不再只 +1，而是把账本里相关的函数全叫醒重跑。\n\n所以这一关不是热身，是你把「通知的出口」提前留好了。'
        }
      ],
      skeleton: `/**
 * 第 1 关 · reactive(obj)：让读写经过你的代码
 *
 * 目标：返回一个「替身」，行为和原对象一致，
 *       但读、写、删、查都先经过你写的函数。
 *
 * 按左栏「第 1 步」开始，每写完一步就点一次「跑这一步测试」。
 *
 * 测试会用到的约定（照着实现）：
 *   proxy.__raw          读到原对象
 *   proxy.__setCount     到目前为止写入过几次
 *   proxy.__deleteCount  到目前为止删除过几次
 */

function reactive(target) {
  // 第 1 步：先让它「什么都不改」也能用
  // 写完跑一次测试，全绿再进第 2 步
}
`,
      solution: `/**
 * 第 1 关 · 参考答案：reactive(obj) 的完整实现
 *
 * 四个阶段合起来就是这一份：
 *   1) 空 handler → 通透的代理
 *   2) get → 读经过我
 *   3) set → 写经过我
 *   4) deleteProperty / has / ownKeys → 删和查也经过我
 */
function reactive(target) {
  let setCount = 0
  let deleteCount = 0

  return new Proxy(target, {
    get(t, key, receiver) {
      if (key === '__raw') return t
      if (key === '__setCount') return setCount
      if (key === '__deleteCount') return deleteCount
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      setCount++
      return Reflect.set(t, key, value, receiver)
    },
    deleteProperty(t, key) {
      deleteCount++
      return Reflect.deleteProperty(t, key)
    },
    has(t, key) {
      return Reflect.has(t, key)
    },
    ownKeys(t) {
      return Reflect.ownKeys(t)
    }
  })
}
`,
      tests: `{
  const raw = { count: 1, name: 'vue' }
  const state = reactive(raw)

  check('读到的值和原对象一致', () => { same(state.count, 1); same(state.name, 'vue') })
  check('读不存在的属性得到 undefined', () => { same(state.nope, undefined) })
  check('写入会落到原对象上', () => { state.count = 5; same(raw.count, 5) })
  check('in 判断一致', () => { ok('name' in state); same('nope' in state, false) })
  check('Object.keys 一致', () => { same(Object.keys(state).sort(), ['count', 'name']) })
  check('delete 之后两边都读不到', () => { delete state.name; same('name' in raw, false) })
}
{
  let proxyRef = null
  const raw = { n: 2, get dbl() { return this.n * 2 }, get isProxy() { return this === proxyRef } }
  const state = reactive(raw)
  proxyRef = state

  check('普通属性读得到', () => { same(state.n, 2) })
  check('getter 里的 this 是代理本身，不是原对象', () => { same(state.isProxy, true) })
  check('读取 __raw 拿到原对象', () => { same(state.__raw, raw) })
  check('读不存在的属性还是 undefined', () => { same(state.nope, undefined) })
}
{
  const raw = { a: 1 }
  const state = reactive(raw)

  check('写入落到原对象', () => { state.a = 9; same(raw.a, 9); same(state.a, 9) })
  check('写一个新属性也能落下去', () => { state.b = 2; same(raw.b, 2) })
  check('写入成功时返回 true', () => { same(Reflect.set(state, 'c', 3), true); same(raw.c, 3) })
  check('写到冻结对象上返回 false，且不修改', () => {
    const frozen = Object.freeze({ x: 1 })
    const st = reactive(frozen)
    same(Reflect.set(st, 'x', 2), false)
    same(frozen.x, 1)
  })
  check('每一次写入都会被记下来（__setCount）', () => {
    const raw2 = { a: 1 }
    const s = reactive(raw2)
    // 只核对「增量」：计数器从 0 开始、从 1 开始、从 10 开始都算对。
    // 以前这里写死 same(s.__setCount, 0)，把「记对了但初始值不同」判成失败——
    // 题面从没规定起点是几，这不是用户该猜的东西。
    const before = s.__setCount
    s.a = 2
    s.b = 3
    same(s.__setCount - before, 2)
  })
}
{
  const raw = { a: 1, b: 2 }
  const state = reactive(raw)
  // 和 __setCount 一样只看增量：起点是几不影响判定
  const beforeDel = state.__deleteCount

  check('delete 之后两边都读不到', () => { delete state.a; same('a' in raw, false); same(state.a, undefined) })
  check('delete 会被记一次（__deleteCount）', () => { same(state.__deleteCount - beforeDel, 1) })
  check('in 判断仍然正确', () => { ok('b' in state); same('a' in state, false) })
  check('Object.keys 和原对象一致', () => { same(Object.keys(state).sort(), ['b']) })
  check('回归：读、写、__raw 都没被弄坏', () => {
    const r2 = { x: 1 }
    const s2 = reactive(r2)
    const beforeSet = s2.__setCount
    s2.x = 5
    same(r2.x, 5)
    same(s2.__raw, r2)
    same(s2.__setCount - beforeSet, 1)
  })
}
`
    },
    /* ------------------------------------------------------------ 第 2 关 */
    {
      id: 'lv2',
      title: '把「谁在读」记下来',
      emoji: '📒',
      xp: 40,
      goal: '实现 track(target, key)：把「当前正在执行的那个函数」登记到「对象 → 属性」名下，建立一张依赖账本。',
      why: '第 1 关已经能在读写时插一手了，但插了手什么也没做。响应式需要的第一份信息是：**谁读了什么**。没有这份账本，后面就算数据变了，你也不知道该通知谁。这一关只记账、不通知——把账本建对，下一关通知才有对象可叫。',
      prereq: [
        {
          title: '账本为什么是「对象 → 属性 → 函数集合」三层',
          md: `一个函数可能读 state.a 也可能读 state.b。如果只按对象记账，改 b 会把只读过 a 的函数也叫醒——白跑一趟。

所以在 Map 里再分一层：先按对象分，再按属性名分，最后一层是 Set（用到这个属性的所有函数，自动去重）。

\`\`\`js
WeakMap<原对象, Map<属性名, Set<函数>>>
\`\`\`

最外层用 WeakMap 不是为了快，是为了内存正确：业务上已经不用的对象，不能因为账本还引用着就回收不掉。`
        },
        {
          title: 'activeEffect：此刻「谁在读」的唯一线索',
          md: `get 陷阱被调用的时候，它只知道「有人在读 count」，不知道是谁。所以需要一个全局变量记录「当前正在执行的那个函数」，在函数开始执行前设好、执行完清掉：

\`\`\`js
let activeEffect = null   // 第 4 关会用 effect() 自动维护它
\`\`\`

这一关先手动赋值，模拟「有个函数正在执行」：

\`\`\`js
activeEffect = () => state.count
state.count          // 此刻读属性，track 就能记下这个函数
activeEffect = null
\`\`\`

先手动、后自动，是为了让你看清这个变量到底在干什么。`
        }
      ],
      api: [
        {
          name: 'track',
          sig: 'track(target: object, key: string): void',
          args: 'target —— 原对象（不是代理）；key —— 刚被读的那个属性名。两者都由 get 陷阱直接传进来。',
          returns: '没有返回值。它的产出写在 targetMap 里：targetMap.get(target).get(key) 是一个 Set，里面装着读过它的函数。',
          example: `const raw = { count: 1 }
const state = reactive(raw)
const fn = () => state.count

activeEffect = fn
state.count            // 触发 get → track(raw, 'count')
activeEffect = null

targetMap.get(raw).get('count').has(fn)   // true`
        }
      ],
      nodes: ['fe.vue.reactivity.effect-dep'],
      thinking: [
        {
          title: '先做「只记不通知」的一半，而不是一口气写完',
          md: `拿到这一关，我没有先想 trigger，而是先问：通知的前提是什么？是知道该通知谁。也就是说账本必须先存在、且形状正确。所以这一关只做记账，把「谁读了哪个对象的哪个属性」这本账建对；通知留给下一关。分开做的好处很直接：账本错了，这一关的测试立刻红；不用在「既可能记错、又可能叫错」的两处之间猜。这和我在真实项目里拆重构是一个顺序：先让数据可信，再让数据流动。`
        },
        {
          title: '三层结构不是设计出来的，是「精确通知」逼出来的',
          md: `最直觉的版本是「一个对象对应一个函数集合」。但只要一个函数读了 count、另一个读了 name，改 count 时就会把只读 name 的那位也叫醒——白跑一趟，还可能在回调里读到它根本不依赖的数据。所以账本必须分到属性这一层：对象 → 属性 → 函数集合。最外层用 WeakMap 也不是为了快，而是内存正确：业务上不再使用的对象，不能因为账本还引用它就回收不掉。第三层的 Set 解决重复登记，同一个函数把同一个属性读一百次也只占一份。`
        },
        {
          title: '为什么这一关让我手动设置 activeEffect',
          md: `get 陷阱被调用时只知道「有人在读 count」，不知道是谁。所以需要一个全局变量记录当前正在执行的函数。这一关没有 effect() 自动维护它，我让你手动赋值，是为了把「变量到底在什么时候被设、什么时候被清」看清。手动一遍，你才知道下一关 effect 包的那两行不是装饰：函数执行前设好、执行完清空，中间所有读取都归属这个函数。先手动、后自动，比一上来给你一个黑盒函数更容易讲清。`
        }
      ],
      stages: [
        {
          n: 1,
          title: '没有「正在执行的人」，就什么都不记',
          think: 'track 的第一步不是建表，而是判断这次读取有没有归属。控制台里随手读一下、或者组件外读一下，都不该产生依赖。先把这个出口堵上，后面建表的代码就只在确实有函数执行时运行，出问题也更容易定位到范围。',
          hint: '在 track 开头判断 activeEffect 是否为空；为空就直接 return，先别碰 Map 和 Set。',
          vocab: [
            { term: 'activeEffect', md: '一个模块级变量，表示「此刻正在执行的函数」。get 陷阱触发时靠它才知道这次读取该记到谁名下。这一关由测试手动赋值。' },
            { term: '旁路（副作用不改主流程）', md: 'track 是接在 get 旁边的旁路：它负责记账，但不改变「读到什么值」。所以它没有返回值，也不能替换 Reflect.get 的结果。' }
          ],
          diag: [
            '读属性必须仍然返回原值：track 只该在记账后放行，不能把 get 的返回值吞掉或改写。',
            '只有 activeEffect 存在时才该建账；现在账本出现了，说明空值判断写反了，或者 return 漏写了。'
          ],
          code: `/**
 * 第 2 关 · 第 1 步：先挡住「没有正在执行的函数」的读取
 *
 * 这一步 track 只做一件事：没有 activeEffect 就地返回。
 * 账本结构留到下一步，先保证读取行为不受影响。
 */
const targetMap = new WeakMap()
let activeEffect = null

function track(target, key) {
  // 没有正在执行的函数：这次读取不属于任何依赖，直接放行
  if (!activeEffect) return
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      return Reflect.set(t, key, value, receiver)
    }
  })
}
`,
          test: `{
  const raw = { count: 1 }
  const state = reactive(raw)

  check('没有账本代码时，读属性仍然返回正确值', () => {
    same(state.count, 1)
  })
  check('当前这一步还不会凭空建账本', () => {
    activeEffect = () => state.count
    state.count
    activeEffect = null
    same(targetMap.get(raw), undefined)
  })
}
`
        },
        {
          n: 2,
          title: '把对象和属性的格子先搭出来',
          think: '确认了「只在有函数执行时记账」，下一步解决记到哪。账本要分两层：对象一层、属性一层。先只把容器搭好、不塞人，这样测试能单独验证结构对不对；如果连 add 一起写，结构错了和登记错了会混在同一条红里。',
          hint: '从 targetMap 取对象对应的 Map，没有就新建并 set 回去；再从这张 Map 里取属性对应的 Set，没有就新建。两次都是「有就用、没有就建」。',
          vocab: [
            { term: 'WeakMap', md: '键必须是对象、且是弱引用的 Map。对象被回收时，它名下的整本账自动释放，不会造成内存泄漏。' },
            { term: 'depsMap', md: '每个原对象对应的一张 Map，键是属性名，值是这个属性专属的函数集合。' }
          ],
          diag: [
            '对象或属性名下的容器没建出来：检查两次「有就用、没有就 set 一个 new」是否都写了。',
            '格子不该有内容，也不该给没读过的属性建格子：add 要留到下一步，key 要用 get 传进来的那个。'
          ],
          code: `/**
 * 第 2 关 · 第 2 步：搭出「对象 → 属性 → 集合」两层容器
 *
 * 这一步只建格子，不往里放函数。结构对了，下一步再登记。
 */
const targetMap = new WeakMap()
let activeEffect = null

function track(target, key) {
  if (!activeEffect) return

  // 对象这一层：没有就建一张 Map
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))

  // 属性这一层：没有就建一个 Set
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      return Reflect.set(t, key, value, receiver)
    }
  })
}
`,
          test: `{
  const raw = { count: 1, name: 'vue' }
  const state = reactive(raw)
  const fn = () => state.count

  activeEffect = fn
  state.count
  activeEffect = null

  const depsMap = targetMap.get(raw)

  check('读过属性后，对象名下建起 depsMap，属性名下建起 Set 格子', () => {
    ok(depsMap instanceof Map, 'targetMap 里没有这个对象的 Map')
    ok(depsMap.get('count') instanceof Set, 'count 名下不是 Set')
  })
  check('这一步只建空格子，还没登记函数', () => {
    same(depsMap.get('count').size, 0)
    same(depsMap.has('name'), false)
  })
}
`
        },
        {
          n: 3,
          title: '把当前函数登记进格子',
          think: '容器搭好，最后一步才是把人放进去。这里唯一要守住的是「登记的是函数本身」——用 Set 的 add，天然去重。登记完，账本就能回答「count 被谁读过」，下一关的 trigger 才有数据可查。',
          hint: '用 dep.add(activeEffect) 把当前函数加进这个属性的 Set；不要用数组，也不要在 add 之前改写 activeEffect。',
          vocab: [
            { term: 'Set.add 的幂等性', md: '对同一个值重复 add，Set 只保留一份，size 不会增长。这正好对应「一个函数读同一个属性多次只算一个依赖」。' }
          ],
          diag: [
            '函数没进 Set：track 结尾少了 dep.add(activeEffect)，或者 add 进去的不是 activeEffect。',
            '重复项说明你用了数组 push：用 Set 的 add 才能天然去重，size 才对。'
          ],
          code: `/**
 * 第 2 关 · 第 3 步：把 activeEffect 登记到属性名下
 */
const targetMap = new WeakMap()
let activeEffect = null

function track(target, key) {
  if (!activeEffect) return

  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))

  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))

  // 当前函数读过这个属性，登记一份
  dep.add(activeEffect)
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      return Reflect.set(t, key, value, receiver)
    }
  })
}
`,
          test: `{
  const raw = { count: 1, name: 'vue' }
  const state = reactive(raw)
  const fnA = () => state.count
  const fnB = () => state.count

  activeEffect = fnA
  state.count
  activeEffect = fnB
  state.count
  state.count
  activeEffect = null

  const dep = targetMap.get(raw).get('count')

  check('读过的函数被登记进对应属性的 Set', () => {
    ok(dep.has(fnA), 'fnA 没被登记')
    ok(dep.has(fnB), 'fnB 没被登记')
  })
  check('同一个函数重复读取，Set 里只保留一份', () => {
    same(dep.size, 2)
  })
}
`
        }
      ],
      finalCode: `/**
 * 第 2 关 · 把「谁在读」记下来（完整实现）
 *
 * 账本三层：targetMap(原对象) → depsMap(属性名) → dep(读过该属性的函数 Set)。
 * get 陷阱里调用 track；set 这一关仍然只负责把值写进去。
 */
const targetMap = new WeakMap()
let activeEffect = null

function track(target, key) {
  if (!activeEffect) return

  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))

  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))

  dep.add(activeEffect)
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      return Reflect.set(t, key, value, receiver)
    }
  })
}
`,
      usage: `// 手动模拟「有个函数正在执行」
const raw = { count: 1 }
const state = reactive(raw)
const render = () => 'count = ' + state.count

activeEffect = render
state.count          // get 陷阱 → track(raw, 'count')
activeEffect = null

targetMap.get(raw).get('count').has(render)   // true

// 换一个函数读另一个属性，账本按属性分开记
activeEffect = () => state.name
state.name
activeEffect = null

targetMap.get(raw).get('count').size          // 1
targetMap.get(raw).get('name').size           // 1

// 第 3 关会拿这本账去通知 render；这一关只保证账记得对。`,
      hints: [
        '`targetMap.set(target, (depsMap = new Map()))` 这种「赋值表达式顺手返回新对象」的写法很常见，等价于先 set 再取值，写不惯可以拆成三行。',
        '两次「有就用、没有就建」是顺序依赖的：没建 depsMap 就没有 dep，没有 dep 就没地方 add。卡住时按顺序检查哪一层是 undefined。',
        '测试里访问的是 targetMap.get(raw)（原对象），不是 state（代理）。因为 get 陷阱里的 t 就是原对象，记账时也必须用这个 t。'
      ],
      concepts: [
        {
          title: '为什么用 Set 而不是数组',
          md: '同一个函数读同一个属性多次很常见（循环里读、条件分支里重复读）。用数组会存进很多重复项，触发时就要重复执行很多次；Set 天然去重，还自带 O(1) 的 has/delete——第 6 关清理依赖时靠的就是 delete。'
        },
        {
          title: '依赖是「运行时」收集的，不是「声明时」',
          md: '很多人以为依赖是初始化时静态分析出来的。实际上它是执行到哪读到哪就记到哪：if (flag) 读 a else 读 b，这一轮跑哪个分支，就只记哪个分支的属性。这也解释了第 6 关为什么必须清理——上一轮记的账，这一轮可能已经作废了。'
        }
      ],
      skeleton: `/**
 * 第 2 关 · 把「谁在读」记下来
 *
 * 第 1 关的 reactive 已经能在读写时插一手。这一关开始记账：
 * 谁读了哪个对象的哪个属性，就把它记在 targetMap 里。
 */

/**
 * 依赖账本：WeakMap<原对象, Map<属性名, Set<读过它的函数>>>
 * 用 WeakMap：对象被回收时，它名下的依赖一起释放。
 */
const targetMap = new WeakMap()

/**
 * 当前正在执行的函数 —— 「谁在读」的唯一线索。
 * 这一关由你在测试/调用代码里手动设置，第 4 关会交给 effect() 自动维护。
 */
let activeEffect = null

/**
 * 收集依赖：把 activeEffect 登记到 target[key] 名下。
 * 调用点在 reactive 的 get 陷阱里：读了一次，就说明这个函数用到了它。
 */
function track(target, key) {
  // TODO 1：没有正在执行的函数（activeEffect 为 null）就直接返回
  // TODO 2：从 targetMap 取出 target 的 depsMap，没有就新建一个 Map 放进去
  //         再从 depsMap 取出 key 对应的 dep（一个 Set），没有就新建一个 Set 放进去
  // TODO 3：把 activeEffect 加进这个 Set
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      // 接线已经帮你写好：先记账，再真正读
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      return Reflect.set(t, key, value, receiver)
    }
  })
}
`,
      solution: `/**
 * 第 2 关 · 把「谁在读」记下来（参考答案）
 */
const targetMap = new WeakMap()
let activeEffect = null

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  dep.add(activeEffect)
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      return Reflect.set(t, key, value, receiver)
    }
  })
}
`,
      tests: `const raw = { count: 1, name: 'vue' }
const state = reactive(raw)
const fnA = () => state.count
const fnB = () => state.name

activeEffect = fnA
state.count
activeEffect = fnB
state.name
activeEffect = null

check('读到哪个属性，就记在哪个属性名下', () => {
  const byKey = targetMap.get(raw)
  ok(byKey, 'targetMap 里根本没有这个对象：depsMap 没建起来')
  ok(byKey.get('count')?.has(fnA), 'count 名下没有 fnA')
  ok(!byKey.get('count')?.has(fnB), 'count 名下不该有 fnB，它读的是 name')
  ok(byKey.get('name')?.has(fnB), 'name 名下没有 fnB')
})

check('同一个函数反复读同一个属性，只记一份', () => {
  activeEffect = fnA
  state.count
  state.count
  state.count
  activeEffect = null
  same(targetMap.get(raw).get('count').size, 1)
})

check('没有正在执行的函数时，读属性不记账', () => {
  const before = targetMap.get(raw).get('count').size
  state.count
  same(targetMap.get(raw).get('count').size, before)
})

check('两个不同的对象各记各的，不会串', () => {
  const raw2 = { count: 1 }
  const s2 = reactive(raw2)
  activeEffect = fnA
  s2.count
  activeEffect = null
  ok(targetMap.get(raw2).get('count').has(fnA), 'raw2 的 count 名下应该有 fnA')
  same(targetMap.get(raw).get('count').size, 1)
})

check('两个函数读同一个属性，账本里两个都在', () => {
  const raw3 = { count: 0 }
  const s3 = reactive(raw3)
  activeEffect = fnA
  s3.count
  activeEffect = fnB
  s3.count
  activeEffect = null
  const dep = targetMap.get(raw3).get('count')
  same(dep.size, 2)
  ok(dep.has(fnA) && dep.has(fnB), '两个函数都该登记')
})

check('离开 effect 之后的读取，连格子都不会建', () => {
  const raw4 = { n: 1 }
  const s4 = reactive(raw4)
  s4.n
  same(targetMap.get(raw4), undefined)
})`
    },
    /* ------------------------------------------------------------ 第 3 关 */
    {
      id: 'lv3',
      title: '写完之后，把该醒的人叫醒',
      emoji: '🔔',
      xp: 40,
      goal: '实现 trigger(target, key)：数据变了，就照着账本把 target[key] 名下登记过的函数全部执行一遍。',
      why: '第 2 关的账本只记不用。现在数据一变，你得翻到那一页，把名字上有的人挨个叫起来。这一步叫「触发」。做完这关，「记账 + 叫人」这套最小闭环就通了——剩下的关卡都是在修补这个闭环的漏洞。',
      prereq: [
        {
          title: '触发 = 遍历 Set，逐个调用',
          md: `账本里存的是一个 Set，里面是函数。所谓「触发更新」，就是把它们挨个调用一次：

\`\`\`js
const dep = targetMap.get(target).get(key)   // Set
for (const fn of dep) fn()
\`\`\`

但真正的实现要写成 for (const fn of [...dep]) fn() —— 先把 Set 拷成数组再遍历。原因见下一条。`
        },
        {
          title: '为什么遍历前必须拷贝一份',
          md: `函数被调用时会干两件事：先把自己从旧的 dep 里删掉（第 6 关的清理），再往新的 dep 里加回去（这一轮的 track）。也就是说，**你正在遍历的那个 Set，会被遍历过程本身修改**。

JS 的 Set 迭代器遇到「删除再新增」会出现同一个元素被访问两次，极端情况下变成死循环。所以规矩是：遍历一个会在遍历中变化的集合，先 [...copy]。

现在还没有清理逻辑，所以看不出差别；但第 6 关一加清理，没写拷贝的实现立刻会坏。这就是为什么这一关就要求你写上。`
        }
      ],
      api: [
        {
          name: 'trigger',
          sig: 'trigger(target: object, key: string): void',
          args: 'target —— 原对象；key —— 刚被写入的属性名。两者都由 set 陷阱传进来。',
          returns: '没有返回值。效果是把 targetMap 里 target[key] 名下所有函数各执行一次。',
          example: `const raw = { count: 1 }
const state = reactive(raw)
let runs = 0

activeEffect = () => { runs++ }
state.count          // 记账
activeEffect = null

state.count = 2      // 触发 → runs 变成 1`
        }
      ],
      nodes: ['fe.vue.reactivity.effect-dep'],
      thinking: [
        {
          title: '触发不是「重新执行所有函数」，而是拿账本点名',
          md: `这一关最容易写错的方向是：数据一变，把所有登记过的函数全跑一遍。那样也能「看起来生效」，但一个只读 name 的组件会因为 count 变化而重渲染。真正的触发必须先定位到对象，再定位到属性，最后只叫这个属性名下的人。这也是为什么第 2 关非要把账本分到属性这一层——如果只按对象记账，这一关根本做不到精确。我的判断顺序是：先接受「查不到是正常情况」，再写调用；而不是先写遍历、再补防御。`
        },
        {
          title: '先写返回值、再写通知：set 陷阱的顺序不能反',
          md: `写 set 的时候我特意把 trigger 放在 Reflect.set 之后。原因不是风格，而是语义：被叫醒的函数会立刻读状态，如果这时候值还没真正写进原对象，它读到的就是旧值，界面会晚一拍。先落盘、再通知，是响应式能「改完马上一致」的前提。另一件事是遍历前先拷贝：这一关还没有清理逻辑，直接遍历 Set 也能跑；但第 6 关一加「执行前先清旧依赖」，正在遍历的 Set 会被遍历过程本身修改，同一个函数可能被访问两次。现在多写三个点，是给后面的清理买保险。`
        }
      ],
      stages: [
        {
          n: 1,
          title: '先把「没账可查」的情况挡掉',
          think: 'trigger 一进来不能假设账本存在。对象从没被读过就没有 depsMap，属性从没被读过就没有 dep，这两件事都是正常状态，不是异常。先按「对象 → 属性」两层查一遍、各自查不到就返回，下一步再谈怎么叫人。这样写出来的第一版虽然不通知，但不会因为 undefined 直接抛错。',
          hint: '先取 target 的 depsMap，取不到就 return；再取 key 的 dep，取不到也 return。这一步先不要遍历 Set。',
          vocab: [
            { term: 'trigger 的入口参数', md: 'target 是原对象、key 是刚被写入的属性名，两者都由 set 陷阱直接传进来；和 track 的参数含义完全一致。' },
            { term: '「查不到」是正常分支', md: '对象没被读过、属性没被读过，说明没人依赖它，本来就不需要通知。这里的 return 不是防御性补丁，而是业务语义。' }
          ],
          diag: [
            '改属性不能抛错，值也必须真的写进去：trigger 只是在写完之后做通知，不能挡住 Reflect.set 的结果。',
            '对象有账本、但改的是没被读过的属性，也必须安全返回；这里抛错通常是取到 undefined 的 dep 后还继续用了它。',
            '这一步还不该调用任何函数：runs 不为 0，说明 trigger 里已经开始遍历 Set 了，先把调用去掉、只留两层查询。'
          ],
          code: `/**
 * 第 3 关 · 第 1 步：先查账，暂时不通知
 *
 * 对象没被读过、属性没被读过都是正常情况，查到就返回。
 * 这一步先把两条出口堵上，下一步再遍历 Set 叫醒函数。
 */
const targetMap = new WeakMap()
let activeEffect = null

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  dep.add(activeEffect)
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return

  const dep = depsMap.get(key)
  if (!dep) return
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const ok = Reflect.set(t, key, value, receiver)
      trigger(t, key)
      return ok
    }
  })
}
`,
          test: `{
  const raw = { count: 1 }
  const state = reactive(raw)

  check('从没被读过的对象，改属性不报错且值写进去了', () => {
    state.count = 2
    same(raw.count, 2)
  })
  check('读过 count、改没读过的 name，不报错', () => {
    activeEffect = () => state.count
    state.count
    activeEffect = null
    state.name = 'vue'
    same(raw.name, 'vue')
  })
  check('这一步还不会叫醒函数', () => {
    let runs = 0
    activeEffect = () => { runs++ }
    state.count
    activeEffect = null
    state.count = 3
    same(runs, 0)
  })
}
`
        },
        {
          n: 2,
          title: '拷贝一份，再挨个叫醒',
          think: '账查到了，最后一步才是调用。两个细节必须同时做对：遍历前用 [...dep] 拷贝，避免正在遍历的集合被回调修改；并且每个函数都要调用。拷贝现在看不出效果，但第 6 关加清理后，不拷贝的写法会立刻出问题，所以这一关就把它当成规矩写进去。',
          hint: '在 dep 存在之后，用 for (const eff of [...dep]) eff() 挨个调用；注意先拷贝再遍历，不要直接在 dep 上迭代。',
          vocab: [
            { term: '快照遍历', md: '把集合展开成数组再遍历。遍历的是那一刻的成员快照，回调里增删原集合不会影响这一轮循环。' }
          ],
          diag: [
            '函数没被调用：trigger 结尾少了 for...of 遍历，或者调用的不是 dep 里的函数。',
            '只叫醒了一个：遍历要在 [...dep] 上做，并且循环体里每个函数都调用，别在循环里提前 return。',
            '回调读到旧值：set 陷阱里 trigger 要放在 Reflect.set 之后，先写值再通知。'
          ],
          code: `/**
 * 第 3 关 · 第 2 步：触发更新（完整实现）
 *
 * 先 Reflect.set 落盘，再 trigger 通知；
 * trigger 里先拷贝 Set 再遍历，为第 6 关的依赖清理留好余地。
 */
const targetMap = new WeakMap()
let activeEffect = null

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  dep.add(activeEffect)
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return

  const dep = depsMap.get(key)
  if (!dep) return

  // 先展开成数组快照，再遍历
  for (const eff of [...dep]) eff()
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const ok = Reflect.set(t, key, value, receiver)
      trigger(t, key)
      return ok
    }
  })
}
`,
          test: `{
  const raw = { count: 1 }
  const state = reactive(raw)
  let runs = 0

  activeEffect = () => { runs++ }
  state.count
  activeEffect = null

  check('改一个被读过的属性，登记的函数被叫醒一次', () => {
    state.count = 2
    same(runs, 1)
  })
  check('两个函数登记在同一属性，两个都要跑', () => {
    let a = 0
    let b = 0
    activeEffect = () => { a++ }
    state.count
    activeEffect = () => { b++ }
    state.count
    activeEffect = null
    state.count = 4
    same(a, 1)
    same(b, 1)
  })
  check('被叫醒时读到的是已经写入的新值', () => {
    const s = reactive({ n: 0 })
    let seen = -1
    activeEffect = () => { seen = s.n }
    s.n
    activeEffect = null
    s.n = 7
    same(seen, 7)
  })
}
`
        }
      ],
      finalCode: `/**
 * 第 3 关 · 写完之后，把该醒的人叫醒（完整实现）
 *
 * set：先 Reflect.set 落盘，再 trigger。
 * trigger：先查对象账本，再查属性名单，最后遍历快照逐个调用。
 */
const targetMap = new WeakMap()
let activeEffect = null

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  dep.add(activeEffect)
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return

  const dep = depsMap.get(key)
  if (!dep) return

  for (const eff of [...dep]) eff()
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const ok = Reflect.set(t, key, value, receiver)
      trigger(t, key)
      return ok
    }
  })
}
`,
      usage: `const raw = { count: 1 }
const state = reactive(raw)
let runs = 0

activeEffect = () => { runs++ }
state.count
activeEffect = null

state.count = 2       // set → 先写 raw.count = 2，再 trigger
runs                  // 1
raw.count             // 2

state.count = 2       // 再写一次：这一关还没有「值没变就不通知」，所以
runs                  // 2

// 改一个没人读过的属性，不会误伤
state.name = 'vue'
runs                  // 2

// 第 5 关会补上「新旧值相同就别通知」，第 6 关会补依赖清理。`,
      hints: [
        '两个 if (!xxx) return 不是防御性代码写多了：对象没被读过、属性没被读过都是正常情况，不 return 就会在 undefined 上继续取东西。',
        '`[...dep]` 里的三个点不能省。省了现在能跑，第 6 关一加清理就会坏。',
        'set 陷阱的顺序是先 Reflect.set 再 trigger：必须先真的把值写进去，再通知别人；反过来的话，被叫醒的函数读到的还是旧值。'
      ],
      concepts: [
        {
          title: '同步触发：改了立刻跑，还是攒一攒再跑',
          md: '这一关是同步触发：state.count = 2 这一行执行完，所有依赖它的函数已经跑完了。好处是「改完马上就能读到新状态」；坏处是同一轮改 10 个属性就会跑 10 轮。第 8 关的 scheduler 就是为解决这个而生的。'
        }
      ],
      skeleton: `/**
 * 第 3 关 · 写完之后，把该醒的人叫醒
 *
 * 账本（targetMap）已经能记下「谁读了什么」。这一关补上另一半：
 * 数据变了，照着账本把相关函数执行一遍。
 */

const targetMap = new WeakMap()
let activeEffect = null

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  dep.add(activeEffect)
}

/**
 * 触发更新：target[key] 变了，把用过它的函数全部重新跑一遍。
 */
function trigger(target, key) {
  // TODO 1：取出 target 的 depsMap；没有（这个对象从没被读过）就直接 return
  // TODO 2：取出 key 对应的 dep；没有（被改的属性没人读过）就直接 return
  // TODO 3：遍历 dep 里的每个函数并调用它
  //         注意：要用 [...dep] 先拷贝一份再遍历，原因见左栏前置知识
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const ok = Reflect.set(t, key, value, receiver)
      // 先不判断「值有没有变」，第 5 关再补
      trigger(t, key)
      return ok
    }
  })
}
`,
      solution: `/**
 * 第 3 关 · 写完之后，把该醒的人叫醒（参考答案）
 */
const targetMap = new WeakMap()
let activeEffect = null

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  dep.add(activeEffect)
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (!dep) return
  for (const eff of [...dep]) eff()
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const ok = Reflect.set(t, key, value, receiver)
      trigger(t, key)
      return ok
    }
  })
}
`,
      tests: `const raw = { count: 1 }
const state = reactive(raw)
let runs = 0

activeEffect = () => { runs++ }
state.count
activeEffect = null

check('改一个被读过的属性，会把函数叫醒一次', () => { state.count = 2; same(runs, 1) })
check('改一个没人读过的属性，谁都不该被叫醒', () => { state.name = 'x'; same(runs, 1) })
check('登记了两个函数，改值两个都要跑', () => {
  let a = 0
  let b = 0
  activeEffect = () => { a++ }
  state.count
  activeEffect = () => { b++ }
  state.count
  activeEffect = null
  state.count = 3
  same(a, 1)
  same(b, 1)
})
check('没人读过的新对象，改它不会报错', () => {
  const s2 = reactive({ v: 1 })
  s2.v = 2
  same(s2.v, 2)
})
check('同一个函数登记两次，也只会被叫醒一次', () => {
  const s3 = reactive({ n: 0 })
  let hits = 0
  const fn = () => { hits++ }
  activeEffect = fn
  s3.n
  s3.n
  activeEffect = null
  s3.n = 1
  same(hits, 1)
})

check('同一轮里改了两次，每次都同步通知', () => {
  const raw2 = { n: 0 }
  const s = reactive(raw2)
  let hits = 0
  activeEffect = () => { hits++ }
  s.n
  activeEffect = null
  s.n = 1
  s.n = 2
  same(hits, 2)
  same(raw2.n, 2)
})`
    },
    /* ------------------------------------------------------------ 第 4 关 */
    {
      id: 'lv4',
      title: 'effect：把「谁在读」这件事自动化',
      emoji: '🔁',
      xp: 50,
      goal: '实现 effect(fn)：注册一个函数，立刻执行一次，执行期间 activeEffect 指向它自己。',
      why: '前三关的 activeEffect 都是测试里手动赋值的。真实代码不可能这么写：使用者只会写 effect(() => { document.title = state.count })，他不想、也不该知道有个全局变量要维护。这关把这个动作包进 effect 里，前三关的所有零件才算第一次真正拼起来。',
      prereq: [
        {
          title: '为什么要把回调再包一层 runner',
          md: `effect 不能直接调用 fn 就完事，因为**调用方以后可能想再执行一次**（比如 watch 要手动触发、computed 要按需重算）。所以要把 fn 包成一个函数返回出去：

\`\`\`js
function effect(fn) {
  const runner = () => fn()
  runner()      // 注册时立刻跑一次
  return runner // 交出去，别人以后还能再调
}
\`\`\`

包了一层之后，「执行一次」这个动作就有了名字，随时可以重复。`
        },
        {
          title: '为什么用 try / finally 还原 activeEffect',
          md: `activeEffect 必须在执行结束后还原，否则一次意外的抛错就会让它永远停在某个函数上，之后所有读取都被记到它头上——表现是「改什么都会莫名其妙地重跑一个不相干的函数」。

finally 保证「不管正常返回还是抛错，都还原」：

\`\`\`js
activeEffect = runner
try {
  return fn()
} finally {
  activeEffect = null
}
\`\`\`

第 7 关会把它从「置空」改成「弹出栈顶」，但 try/finally 的结构不变。`
        }
      ],
      api: [
        {
          name: 'effect',
          sig: 'effect(fn: Function): Function',
          args: 'fn —— 要执行的函数（通常被叫「副作用」）。它没有参数，返回值会被 effect 原样透传出去。',
          returns: 'runner —— 一个可以被再次调用的函数。调用 runner() 会重新执行一遍 fn，并重新收集依赖。',
          example: `const state = reactive({ count: 1 })

const runner = effect(() => {
  console.log('count 变了：', state.count)
})
// 立刻打印一次「count 变了：1」

state.count = 2     // 自动再打印一次「count 变了：2」

runner()            // 手动再执行一次`
        }
      ],
      nodes: ['fe.vue.reactivity.effect-dep'],
      thinking: [
        {
          title: '这一关真正要交出去的，不是 effect，而是 runner',
          md: `我拿到这关先问的是：调用方以后还要不要再执行这个副作用？答案是会——watch 要手动跑、computed 要按需重算，连我自己的测试都要写 runner()。所以 effect 的产物不能是「跑完了」这个事实，而必须是一个函数。确定这一点之后，代码形状就定了：先包一层 runner，再 runner()，最后 return runner。反过来如果直接 fn() 完事，后面任何「再跑一次」都得由调用方自己重新拼一遍 activeEffect，等于把这一关的封装意义全部丢掉。`
        },
        {
          title: '为什么第一步偏偏不碰 activeEffect',
          md: `很多人会一口气把 activeEffect = runner 也写进去，我刻意把它们拆开。理由是「红的时候能分清是谁的锅」：如果第一步就同时做「执行」和「归属」，那「注册时立刻执行」这条测试红了，你分不清是执行顺序错了，还是依赖记错了。先让 fn 干净地跑一次，确认 effect 这个壳子没问题；再往里加归属。真实项目里我也是这个顺序——先让新函数能被调用，再让它产生副作用，出问题时排查范围小一半。`
        },
        {
          title: 'finally 里的还原位置，比「记得还原」更容易写错',
          md: `这一版能想到「执行完要清空」，但最容易写错的是清理的位置：写成 fn(); activeEffect = null 时，fn 一抛错清理就永远执行不到，之后所有读取都被错记到这个已经死掉的函数名下。所以我选 try { return fn() } finally { activeEffect = null }，让「还原」与「是否抛错」解耦。我知道这仍然只是置空、撑不住嵌套 effect——第 7 关会用栈替掉它。但先写对结构、再换实现，比一步到位写一个自己都说不清的版本可靠。`
        }
      ],
      stages: [
        {
          n: 1,
          title: '先把 fn 包成可以再调用的 runner',
          think: 'effect 的第一步不是设置全局变量，而是给「执行一次」这个动作起个名字。包成 runner 之后，注册时能立刻跑、调用方能手动再调，后面两行代码才有地方可加。这一步只确认执行链路通不通，读取归属留给下一步。',
          hint: '写一个 const runner = () => fn()，然后 runner() 执行一次、return runner 交出去；先别动 activeEffect。',
          vocab: [
            { term: '副作用函数的执行器', md: 'runner 本身不读任何响应式数据，它只是「把 fn 跑一遍」这个动作的可调用包装。有了它，同一次注册产生的执行可以被重复触发。' }
          ],
          diag: [
            '注册时没执行：检查 effect 里调用的是不是 runner()，而不是只写 const runner = ...。',
            'runner 没被交出去：函数末尾少了 return runner，调用方拿到的是 undefined。',
            '依赖被自动收集了：说明你在 runner 里额外设置了 activeEffect，这一步故意不设置它。'
          ],
          code: `/**
 * 第 4 关 · 第 1 步：把 fn 包成可以再调用的 runner
 *
 * effect 只做三件事：包一层、立刻跑一次、把 runner 交出去。
 * 这一步故意不碰 activeEffect —— 先确认「执行」这条链路通。
 */
const targetMap = new WeakMap()
let activeEffect = null

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  dep.add(activeEffect)
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (!dep) return
  for (const eff of [...dep]) eff()
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const ok = Reflect.set(t, key, value, receiver)
      trigger(t, key)
      return ok
    }
  })
}

function effect(fn) {
  // 把「执行 fn」这个动作包装成可重复调用的函数
  const runner = () => fn()
  runner()        // 注册时立刻执行一次
  return runner   // 交出去，之后还能再调
}
`,
          test: `{
  const state = reactive({ count: 1 })

  check('注册 effect 时会立刻执行一次', () => {
    let n = 0
    effect(() => { n++ })
    same(n, 1)
  })
  check('effect 返回的 runner 可以再叫一次', () => {
    let n = 0
    const runner = effect(() => { n++ })
    same(typeof runner, 'function')
    runner()
    same(n, 2)
  })
  check('还没设置 activeEffect，依赖变化不会自动重跑', () => {
    let seen = 0
    effect(() => { seen = state.count })
    same(seen, 1)
    state.count = 2
    same(seen, 1)
  })
}
`
        },
        {
          n: 2,
          title: '执行前把 activeEffect 指向 runner',
          think: '执行链路通了，接下来补归属：fn 读属性时，track 必须知道这次读取算谁的。答案就是即将执行的那个 runner。所以赋值只能写在 runner 内部、fn 之前——顺序反了，fn 里第一次读取时 activeEffect 还是 null，依赖一条都收不到。',
          hint: '在 runner 的箭头函数体第一行写 activeEffect = runner，然后再 return fn()。',
          vocab: [
            { term: '依赖归属', md: '同一次执行里读到的每个属性，都记到「当前正在执行的 runner」名下。这也是为什么后续改这些属性时，被叫醒的正好是这个 render 函数。' }
          ],
          diag: [
            '注册时没跑：runner() 这一行漏了，或者被写成 return runner() 提前退出。',
            '依赖没被自动重跑：activeEffect = runner 写在了 fn() 之后，或者根本没写。',
            '两个函数互相串台：activeEffect 只有一个，说明第二个 effect 执行时没重新指向自己。'
          ],
          code: `/**
 * 第 4 关 · 第 2 步：执行前把 activeEffect 指向自己
 *
 * fn 里每一次读取都要归属到「当前正在执行的人」，
 * 所以赋值只能放在 runner 内部、且在 fn() 之前。
 */
const targetMap = new WeakMap()
let activeEffect = null

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  dep.add(activeEffect)
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (!dep) return
  for (const eff of [...dep]) eff()
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const ok = Reflect.set(t, key, value, receiver)
      trigger(t, key)
      return ok
    }
  })
}

function effect(fn) {
  const runner = () => {
    // 先声明「谁在读」，再执行；反过来一条依赖都收不到
    activeEffect = runner
    return fn()
  }
  runner()
  return runner
}
`,
          test: `{
  const state = reactive({ count: 1 })

  check('注册时立刻执行一次', () => {
    let n = 0
    effect(() => { n++; state.count })
    same(n, 1)
  })
  check('依赖的属性变化，函数自动重跑', () => {
    let runs = 0
    effect(() => { runs++; state.count })
    state.count = 2
    same(runs, 2)
  })
  check('多个 effect 各记各的依赖，互不串台', () => {
    let a = 0
    let b = 0
    effect(() => { a++; state.count })
    effect(() => { b++; state.name })
    state.count = 3
    same(a, 2)
    same(b, 1)
  })
}
`
        },
        {
          n: 3,
          title: '用 try / finally 把 activeEffect 交还回去',
          think: '现在能收集依赖了，但执行完没人把 activeEffect 收回去，它会一直停在上一个 runner 上，之后所有读取都错记到它名下。还原必须放进 finally：这样 fn 抛错时同样会还原，异常照旧向外传播，账本却不会脏。',
          hint: '把 return fn() 放进 try，在 finally 里写 activeEffect = null；清理不能写在 try 里面。',
          vocab: [
            { term: 'finally 的契约', md: '不管 try 里是正常返回还是抛出异常，finally 都会执行。用它做「还原现场」，比在 fn() 后面补一行更可靠。' }
          ],
          diag: [
            'activeEffect 没被清空：runner 少了 finally 分支，或者清理写在了 fn() 之后。',
            '抛错后账本脏了：还原写在了 try 里，异常一跳过就永远执行不到那一行。',
            '手动重跑收不到更新：runner 里没重新设置 activeEffect，只有第一次执行时记上了依赖。'
          ],
          code: `/**
 * 第 4 关 · 第 3 步：执行完把 activeEffect 还原
 *
 * try / finally 保证「不管 fn 正常返回还是抛错，现场都要还原」。
 * 这一步之后，effect 外部的读取才不会被错记到上一个 runner 名下。
 */
const targetMap = new WeakMap()
let activeEffect = null

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  dep.add(activeEffect)
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (!dep) return
  for (const eff of [...dep]) eff()
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const ok = Reflect.set(t, key, value, receiver)
      trigger(t, key)
      return ok
    }
  })
}

function effect(fn) {
  const runner = () => {
    activeEffect = runner
    try {
      return fn()
    } finally {
      // 正常返回、抛错，都要还原，否则账本会一直算在这个函数头上
      activeEffect = null
    }
  }
  runner()
  return runner
}
`,
          test: `{
  const state = reactive({ count: 1 })

  check('effect 跑完，activeEffect 回到 null', () => {
    effect(() => { state.count })
    same(activeEffect, null)
  })
  check('effect 里抛错时，异常照旧抛出，activeEffect 也已还原', () => {
    let caught = null
    try {
      effect(() => { throw new Error('boom') })
    } catch (e) {
      caught = e.message
    }
    same(caught, 'boom')
    same(activeEffect, null)
  })
  check('手动重跑 runner 之后，后续变化依然收得到', () => {
    let n = 0
    const runner = effect(() => { n++; state.count })
    same(n, 1)
    runner()
    same(n, 2)
    state.count = 4
    same(n, 3)
  })
}
`
        }
      ],
      finalCode: `/**
 * 第 4 关 · effect：把「谁在读」这件事自动化（完整实现）
 *
 * effect(fn)：注册时立刻跑一次，跑之前把 activeEffect 指向 runner，
 * 跑完（无论成功还是抛错）在 finally 里还原。
 */
const targetMap = new WeakMap()
let activeEffect = null

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  dep.add(activeEffect)
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (!dep) return
  for (const eff of [...dep]) eff()
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const ok = Reflect.set(t, key, value, receiver)
      trigger(t, key)
      return ok
    }
  })
}

function effect(fn) {
  const runner = () => {
    activeEffect = runner
    try {
      return fn()
    } finally {
      activeEffect = null
    }
  }
  runner()
  return runner
}
`,
      usage: `// 1) 注册一个会自动重跑的副作用：不用再手动管 activeEffect
const state = reactive({ count: 1 })

const runner = effect(() => {
  console.log('count =', state.count)
})
// 注册时立刻打印一次：count = 1

state.count = 2
// 依赖变化后自动再打印：count = 2

// 2) runner 就是「再执行一次」的入口，常见于 watch 的立即执行、调试重放
runner()
// 手动再打印一次：count = 2

// 3) effect 返回的是函数，可以交给调用方保管
const stopLater = [runner]
stopLater[0]()

// 4) effect 执行完后 activeEffect 是干净的，外部读取不会被误记账
activeEffect        // null`,
      hints: [
        'runner 是一个箭头函数，它调用时才需要 activeEffect 指向自己——所以赋值写在 runner 内部，不写在 effect 内部。',
        '顺序很重要：先 activeEffect = runner，再 fn()。反过来写，fn 里读属性时 activeEffect 还是 null，依赖一条都收不到（测试会全红）。',
        'effect 的返回值测试会用到：`const r = effect(...)`；r() 再执行一次，n 应该再加 1。'
      ],
      concepts: [
        {
          title: '为什么叫「副作用」',
          md: '函数式说法里，一个函数如果除了返回值之外还改变了外部世界（改 DOM、打印、写文件），就叫有副作用。effect(fn) 的名字就是这么来的：它执行的是「读数据 + 对外部世界做点什么」这类函数，并且会在数据变化时自动重放。Vue 的渲染函数、watch 回调、computed 的 getter，本质都是 effect。'
        },
        {
          title: '这版实现还藏着一个 bug',
          md: 'finally 里写的是 activeEffect = null。只要 effect 里再套一个 effect，内层跑完把 activeEffect 置空，外层后面读的属性就全丢了。现在测试测不出来，因为还没有嵌套的场景。第 7 关会用栈把它修掉。'
        }
      ],
      skeleton: `/**
 * 第 4 关 · effect：把「谁在读」这件事自动化
 *
 * 到上一关为止，activeEffect 都是外部手动设置的。这一关把它包进来：
 * effect(fn) 负责「设置 activeEffect → 执行 fn → 还原 activeEffect」。
 */

const targetMap = new WeakMap()
let activeEffect = null

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  dep.add(activeEffect)
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (!dep) return
  for (const eff of [...dep]) eff()
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const ok = Reflect.set(t, key, value, receiver)
      trigger(t, key)
      return ok
    }
  })
}

/**
 * 注册一个副作用函数：立刻执行一次，之后它的依赖变化时再执行。
 * 返回 runner，调用 runner() 可以手动再执行一次。
 */
function effect(fn) {
  const runner = () => {
    // TODO 1：执行 fn 之前，先让 activeEffect 指向 runner 自己
    // TODO 2：用 try / finally 执行 fn，并在 finally 里把 activeEffect 还原成 null
    //         （只写 fn() 不还原，测试「effect 外读属性」那条会红）
    return fn()
  }
  runner()
  return runner
}
`,
      solution: `/**
 * 第 4 关 · effect：把「谁在读」这件事自动化（参考答案）
 */
const targetMap = new WeakMap()
let activeEffect = null

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  dep.add(activeEffect)
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (!dep) return
  for (const eff of [...dep]) eff()
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const ok = Reflect.set(t, key, value, receiver)
      trigger(t, key)
      return ok
    }
  })
}

function effect(fn) {
  const runner = () => {
    activeEffect = runner
    try {
      return fn()
    } finally {
      activeEffect = null
    }
  }
  runner()
  return runner
}
`,
      tests: `const state = reactive({ count: 1 })
let runs = 0

effect(() => { runs++; state.count })

check('注册时立刻执行一次', () => same(runs, 1))
check('依赖的属性变化，函数自动重跑', () => { state.count = 2; same(runs, 2) })
check('没被读过的属性变化，不重跑', () => { state.name = 'vue3'; same(runs, 2) })
check('函数里读到的永远是最新值', () => {
  let seen = 0
  effect(() => { seen = state.count })
  state.count = 7
  same(seen, 7)
})
check('多个 effect 互不干扰', () => {
  let a = 0
  let b = 0
  effect(() => { a++; state.count })
  effect(() => { b++; state.count })
  state.count = 8
  same(a, 2)
  same(b, 2)
})
check('effect 返回的 runner 可以手动再执行一次', () => {
  let n = 0
  const runner = effect(() => { n++ })
  same(n, 1)
  runner()
  same(n, 2)
})
check('effect 执行完之后，activeEffect 是干净的 null', () => {
  effect(() => {})
  same(activeEffect, null)
})
check('effect 里抛错时异常继续抛出，而且 activeEffect 已被还原', () => {
  let thrown = null
  try {
    effect(() => { throw new Error('boom') })
  } catch (e) {
    thrown = e.message
  }
  same(thrown, 'boom')
  same(activeEffect, null)
})
check('手动重跑 runner 之后，后续变化依然收得到', () => {
  let hit = 0
  const runner = effect(() => { hit++; state.count })
  same(hit, 1)
  runner()
  same(hit, 2)
  state.count = 11
  same(hit, 3)
})`
    },
    /* ------------------------------------------------------------ 第 5 关 */
    {
      id: 'lv5',
      title: '写相同的值，不算变化',
      emoji: '🧮',
      xp: 40,
      goal: '在 set 陷阱里加判断：只有写入成功、并且新旧值真的不同，才去 trigger。',
      why: '第 4 关一跑通，你就能看到问题：state.count = 2 连写两次，依赖它的函数会跑两次，第二次纯属白跑。真实项目里父组件重渲染、表单反复赋值，这类「写了但没变」的场景非常密集，它是「莫名其妙卡顿」最常见的来源之一。这一关用一个判断把它挡掉。',
      prereq: [
        {
          title: '判断「变没变」要用 Object.is，不是 !==',
          md: `大多数时候 old !== value 就够了，但有两个特例会坑人：

- NaN !== NaN 恒为 true。所以 state.n = NaN 写两次，会被当成「变了」，触发两轮更新。
- +0 和 -0 用 !== 比较是相等的。而它们在 Object.is 里不相等（这个差异通常不影响业务，但知道有差别没坏处）。

Object.is 的行为正好是「除了 +0/-0 之外，和 === 一致，但 NaN 等于自己」：

\`\`\`js
old !== value          // NaN 写两次 → true（误判成变了）
!Object.is(old, value) // NaN 写两次 → false（正确）
\`\`\`

所以公式是：写入成功 && 值真的变了。

\`\`\`js
if (ok && !Object.is(old, value)) trigger(t, key)
\`\`\``
        },
        {
          title: '为什么必须先 Reflect.set 再比较',
          md: `也可以先把旧值存下来、比较、再写入，逻辑上等价。但顺序上要先写再通知：trigger 会同步执行依赖函数，那些函数读到的必须是**写入之后**的新值。所以标准顺序是：

1. const old = t[key]（写入前记下旧值）
2. const ok = Reflect.set(...)（真正写入）
3. if (ok && !Object.is(old, value)) trigger(...)（通知）`
        }
      ],
      api: [
        {
          name: 'reactive（set 陷阱的行为升级）',
          sig: 'set(t, key, value, receiver): boolean',
          args: 't —— 原对象；key —— 属性名；value —— 准备写入的新值；receiver —— 正在写的代理。',
          returns: 'boolean，Reflect.set 的结果：写入成功 true，失败 false（例如属性只读）。',
          example: `const state = reactive({ count: 1 })
let runs = 0
effect(() => { runs++; state.count })

state.count = 2     // 值真的变了 → runs = 2
state.count = 2     // 值没变     → runs 仍然是 2
state.count = 3     // 又变了     → runs = 3`
        }
      ],
      nodes: ['fe.vue.reactivity.effect-dep'],
      thinking: [
        {
          title: '先确认问题真的存在，再改代码',
          md: `改 set 之前我先数了一遍代价：父组件重渲染会把一整套 props 重新赋值下去，其中绝大多数值跟上一次相同。没有这层判断，每个「写了但没变」都会被当成变化，一路放大成整棵子树重算。这不是理论上的浪费，而是「莫名其妙卡顿」最常见的来源之一。所以这一关不是可有可无的优化，而是把「通知」的语义从「有人写」修正成「值真的变了」：语义先对，性能只是顺带的结果。`
        },
        {
          title: '比较必须用 Object.is，而不是 !==',
          md: `我一开始也想用 old !== value，直到想起 NaN：NaN !== NaN 恒为 true，写两次 NaN 会被判成「变了」两次，白跑一轮。Object.is 正好补上这个洞——NaN 等于自己，其余行为和 === 一致（+0/-0 的差异对业务基本没有影响）。改一个字符的成本，换掉一个「为什么这里用 !== 那里不用」的坑。既然这一关的主题就是「精确判断变没变」，判断工具本身也不该有例外。`
        },
        {
          title: '为什么条件里还要带上 Reflect.set 的返回值',
          md: `只写 !Object.is(old, value) 有个盲区：写入可能失败。冻结对象、只读属性、setter 里拒绝，这时原对象上的值并没有变，但 old 与 value 不同，代码照样会 trigger——通知了一次根本没发生的变更，依赖函数重跑后读到的还是旧值，等于白跑还骗了调用方。所以条件必须是「写成功 && 值变了」。把 ok 放进条件几乎不增加成本，却让「通知」和「状态真的改变」严格对齐，这也是我看一个响应式实现靠不靠谱的细节之一。`
        }
      ],
      stages: [
        {
          n: 1,
          title: '先把 set 拆成「记旧值 → 写 → 返回结果」',
          think: '先不改通知条件，而是把写入动作拆清楚：写入前记下旧值，写入后接住 Reflect.set 的成功标记，最后原样返回。拆开之后每一步都可见，下一步才有地方安放比较。顺序也不能反：通知必须在真正写入之后发，否则依赖函数读到的还是旧值。',
          hint: '在 set 陷阱里依次写 const old = t[key]、const ok = Reflect.set(t, key, value, receiver)，然后无条件 trigger，最后 return ok。',
          vocab: [
            { term: 'Reflect.set 的返回值', md: '写入成功返回 true，失败（只读、冻结、setter 拒绝）返回 false。它是 set 陷阱唯一能拿到的「这次到底写进去没有」的证据。' }
          ],
          diag: [
            'set 返回了 undefined：最后少写 return ok，调用方拿不到写入结果。',
            '原对象没被改：Reflect.set 的参数顺序写错了，或者忘了传 receiver。',
            '依赖函数读到旧值：trigger 写在了 Reflect.set 前面，通知发得太早。'
          ],
          code: `/**
 * 第 5 关 · 第 1 步：把 set 拆成「记旧值 → 写 → 返回结果」
 *
 * 这一步通知条件还是老样子（写了就通知）。
 * 先把旧值的抓取点、写入结果、返回值三件事分开摆清楚。
 */
const targetMap = new WeakMap()
let activeEffect = null

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  dep.add(activeEffect)
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (!dep) return
  for (const eff of [...dep]) eff()
}

function effect(fn) {
  const runner = () => {
    activeEffect = runner
    try {
      return fn()
    } finally {
      activeEffect = null
    }
  }
  runner()
  return runner
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      // 写入前唯一一次机会：把旧值留下来，下一步要拿它比较
      const old = t[key]
      const ok = Reflect.set(t, key, value, receiver)
      // 这一步还是「写了就通知」，旧值暂时没派上用场
      trigger(t, key)
      return ok
    }
  })
}
`,
          test: `{
  const state = reactive({ count: 1 })

  check('写入成功时，set 返回 true', () => {
    same(Reflect.set(state, 'count', 2), true)
  })
  check('写入之后，原对象上的值也真的变了', () => {
    const raw = { v: 1 }
    const s = reactive(raw)
    s.v = 5
    same(raw.v, 5)
    same(s.v, 5)
  })
  check('值变了，依赖函数同步就能读到最新值', () => {
    const s = reactive({ n: 1 })
    let seen = 0
    effect(() => { seen = s.n })
    s.n = 4
    same(seen, 4)
  })
}
`
        },
        {
          n: 2,
          title: '用 Object.is 把「写了但没变」挡在前面',
          think: '脚手架摆好，这一步才加入真正的判断：旧值和新值真的不同，才通知。用 Object.is 而不是 !==，是为了让 NaN 写两次也算「没变」；否则每次写 NaN 都要白跑一轮依赖。这一步还不看写入是否成功，先只解决「变没变」。',
          hint: '把无条件的 trigger 包进 if (!Object.is(old, value)) 里；注意是 old 在前、value 在后。',
          vocab: [
            { term: 'Object.is 与 NaN', md: 'Object.is(NaN, NaN) 为 true，所以写两次 NaN 会被判成没变；而 NaN !== NaN 恒为 true，用 !== 就会误判成变了两次。' }
          ],
          diag: [
            '改新值不重跑：if 写反了（写成 Object.is 而不是 !Object.is），或者 trigger 被整个删掉。',
            '写相同值仍然重跑：trigger 还留在 if 外面，条件只包住了别的东西。',
            'NaN 那条红了：比较用了 !==，换成 Object.is 才能把两个 NaN 判成相等。'
          ],
          code: `/**
 * 第 5 关 · 第 2 步：值真的变了，才通知
 *
 * 写入前记下 old，写入后用 Object.is 判断变没变。
 * 注意这里还没检查写入是否成功，那是下一步的事。
 */
const targetMap = new WeakMap()
let activeEffect = null

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  dep.add(activeEffect)
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (!dep) return
  for (const eff of [...dep]) eff()
}

function effect(fn) {
  const runner = () => {
    activeEffect = runner
    try {
      return fn()
    } finally {
      activeEffect = null
    }
  }
  runner()
  return runner
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const old = t[key]
      const ok = Reflect.set(t, key, value, receiver)

      // 只有值真的变了才通知；Object.is 让 NaN 写两次算「没变」
      if (!Object.is(old, value)) trigger(t, key)

      return ok
    }
  })
}
`,
          test: `{
  const state = reactive({ count: 1 })

  check('改成一个新值，依赖重跑一次', () => {
    let runs = 0
    effect(() => { runs++; state.count })
    state.count = 2
    same(runs, 2)
  })
  check('连写两次相同的值，第二次不重跑', () => {
    let runs = 0
    effect(() => { runs++; state.count })
    state.count = 5
    state.count = 5
    same(runs, 2)
  })
  check('NaN 写两次，同样视为没有变化', () => {
    const s = reactive({ n: 0 })
    let runs = 0
    effect(() => { runs++; s.n })
    s.n = NaN
    same(runs, 2)
    s.n = NaN
    same(runs, 2)
  })
}
`
        },
        {
          n: 3,
          title: '把「写入成功」也纳入条件',
          think: '最后补上盲区：写入可能失败。冻结对象、只读属性下 Reflect.set 返回 false，原对象上的值没变，但 old 与 value 不同，只比较值就会通知一次根本没发生的变更。所以条件要扩成「写成功 && 值变了」，同时返回值照旧交给调用方。',
          hint: '把 if 的条件改成 ok && !Object.is(old, value)，两个条件用 && 连起来，顺序上先看 ok。',
          vocab: [
            { term: '写入失败的通知', md: '没写进去却通知了依赖：依赖函数重跑后读到的还是旧值，调用方还收到一次无意义的执行。这就是必须把 ok 放进条件的原因。' }
          ],
          diag: [
            '冻结对象那条红了：条件里少了 ok，写入失败时仍然调用了 trigger，于是依赖白跑一次。',
            '正常改写不再触发或返回值丢了：&& 写成了 ||，或者加条件时把 return ok 一起删掉了。'
          ],
          code: `/**
 * 第 5 关 · 第 3 步：写成功 && 值变了，才通知
 *
 * Reflect.set 可能失败（冻结、只读、setter 拒绝），失败时原对象没变，
 * 也就不该 trigger。条件补上 ok 之后，通知与状态改变严格对齐。
 */
const targetMap = new WeakMap()
let activeEffect = null

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  dep.add(activeEffect)
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (!dep) return
  for (const eff of [...dep]) eff()
}

function effect(fn) {
  const runner = () => {
    activeEffect = runner
    try {
      return fn()
    } finally {
      activeEffect = null
    }
  }
  runner()
  return runner
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const old = t[key]
      const ok = Reflect.set(t, key, value, receiver)

      // 写成功、并且值真的变了，才值得叫醒依赖
      if (ok && !Object.is(old, value)) trigger(t, key)

      return ok
    }
  })
}
`,
          test: `{
  check('冻结对象上的写入失败时，依赖不该被叫醒', () => {
    const raw = Object.freeze({ locked: 1 })
    const s = reactive(raw)
    let runs = 0
    effect(() => { runs++; s.locked })
    same(Reflect.set(s, 'locked', 2), false)
    same(runs, 1)
    same(s.locked, 1)
  })
  check('正常对象上照旧：新值触发一次、同值不再触发', () => {
    const s = reactive({ n: 0 })
    let runs = 0
    effect(() => { runs++; s.n })
    s.n = 1
    same(runs, 2)
    s.n = 1
    same(runs, 2)
  })
}
`
        }
      ],
      finalCode: `/**
 * 第 5 关 · 写相同的值，不算变化（完整实现）
 *
 * set 陷阱的顺序：记旧值 → 真正写入 → 判断写成功且值变了才通知 → 返回写入结果。
 */
const targetMap = new WeakMap()
let activeEffect = null

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  dep.add(activeEffect)
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (!dep) return
  for (const eff of [...dep]) eff()
}

function effect(fn) {
  const runner = () => {
    activeEffect = runner
    try {
      return fn()
    } finally {
      activeEffect = null
    }
  }
  runner()
  return runner
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const old = t[key]
      const ok = Reflect.set(t, key, value, receiver)
      if (ok && !Object.is(old, value)) trigger(t, key)
      return ok
    }
  })
}
`,
      usage: `// 1) 同一个值反复写，依赖只跑一次
const state = reactive({ count: 1 })
let runs = 0

effect(() => { runs++; state.count })

state.count = 2     // 值真的变了 → runs = 2
state.count = 2     // 值没变     → runs 仍然是 2
state.count = 2     // 还是没变   → runs 仍然是 2
state.count = 3     // 又变了     → runs = 3

// 2) 表单里常见的「把上次的值再赋一遍」，现在完全不会惊动下游
const form = reactive({ name: '' })
const render = effect(() => { console.log('render:', form.name), form.name })
form.name = 'vue'   // 打印 render: vue
form.name = 'vue'   // 不打印，值没变

// 3) 写入结果照旧可以拿到：失败（只读/冻结）时返回 false，也不通知
const frozen = reactive(Object.freeze({ locked: 1 }))
let hits = 0
effect(() => { hits++; frozen.locked })
Reflect.set(frozen, 'locked', 2)    // false，hits 仍然是 1
frozen.locked                       // 1`,
      hints: [
        '三步都在同一个 set 陷阱里：先把 old / ok 拆出来，再加 Object.is，最后把 ok 并进条件。其它函数一行都不用动。',
        '别写成 `if (old !== value)`：测试里有一条会写两次 NaN，用 !== 会误判成「变了」。',
        '如果测试「写相同的值不重跑」还是红的，先检查是不是把 trigger 写在了 if 外面。'
      ],
      concepts: [
        {
          title: '这个判断能省掉多少工作',
          md: '在组件树里，一个父组件重渲染会把一整套 props 重新赋值下去。其中大部分值和上次相同，没有这个判断，每一个都会被当成「变化」触发下游重算，一路放大到整棵子树。Vue3 在 set 陷阱里做这个判断，和在 diff 里做 key 复用是同一类思路：先把不可能变化的排除掉，再算真正需要算的。'
        }
      ],
      skeleton: `/**
 * 第 5 关 · 写相同的值，不算变化
 *
 * 上一关的 set 陷阱不管值有没有变，只要写了就 trigger。
 * 这一关把它改成：写成功了、并且值真的变了，才通知依赖。
 */

const targetMap = new WeakMap()
let activeEffect = null

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  dep.add(activeEffect)
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (!dep) return
  for (const eff of [...dep]) eff()
}

function effect(fn) {
  const runner = () => {
    activeEffect = runner
    try {
      return fn()
    } finally {
      activeEffect = null
    }
  }
  runner()
  return runner
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      // TODO 1：写入之前，先把旧值记下来
      // TODO 2：真正写入，并接住 Reflect.set 返回的 ok
      // TODO 3：只有 ok 为真、且 !Object.is(old, value) 时才 trigger(t, key)
      // TODO 4：return ok
    }
  })
}
`,
      solution: `/**
 * 第 5 关 · 写相同的值，不算变化（参考答案）
 */
const targetMap = new WeakMap()
let activeEffect = null

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  dep.add(activeEffect)
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (!dep) return
  for (const eff of [...dep]) eff()
}

function effect(fn) {
  const runner = () => {
    activeEffect = runner
    try {
      return fn()
    } finally {
      activeEffect = null
    }
  }
  runner()
  return runner
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const old = t[key]
      const ok = Reflect.set(t, key, value, receiver)
      if (ok && !Object.is(old, value)) trigger(t, key)
      return ok
    }
  })
}
`,
      tests: `const state = reactive({ count: 1 })
let runs = 0
effect(() => { runs++; state.count })

check('注册时执行一次', () => same(runs, 1))
check('改成一个新值，重跑一次', () => { state.count = 2; same(runs, 2) })
check('再写一次相同的值，不该重跑', () => { state.count = 2; same(runs, 2) })
check('effect 里读到的一定是最新值', () => {
  let seen = 0
  effect(() => { seen = state.count })
  state.count = 9
  same(seen, 9)
})
check('NaN 写两次视为「没有变化」', () => {
  const s2 = reactive({ n: 0 })
  let r = 0
  effect(() => { r++; s2.n })
  s2.n = NaN
  same(r, 2)
  s2.n = NaN
  same(r, 2)
})
check('set 依然返回 true，写入本身是成功的', () => {
  same(Reflect.set(state, 'count', 3), true)
})
check('只读属性写入失败：返回 false，而且不触发重跑', () => {
  const frozen = reactive(Object.freeze({ locked: 1 }))
  let hits = 0
  effect(() => { hits++; frozen.locked })
  same(Reflect.set(frozen, 'locked', 2), false)
  same(hits, 1)
  same(frozen.locked, 1)
})
check('连写三个不同值，每次都该通知', () => {
  const s = reactive({ k: 0 })
  let hits = 0
  effect(() => { hits++; s.k })
  s.k = 1
  s.k = 2
  s.k = 3
  same(hits, 4)
})`
    },
    /* ------------------------------------------------------------ 第 6 关 */
    {
      id: 'lv6',
      title: '分支变了，旧依赖要清账',
      emoji: '🧹',
      xp: 50,
      goal: '实现 cleanupEffect：每轮执行前先把自己上一轮登记的依赖全部作废，再执行、再按这一轮实际读到的重新登记。',
      why: '上一关的实现藏着一个 bug：effect 里写 state.flag ? state.a : state.b，第一次执行时读了 flag 和 a。之后 flag 变成 false，effect 重跑、读了 b——但它对 a 的依赖还留在账本上。从此以后，a 怎么变都会把这个 effect 叫醒一次，而它压根不再读 a。跑一次无意义的执行是小事，在真实项目里它会一层层放大成整棵组件树重渲染。',
      prereq: [
        {
          title: '依赖是「每轮重新收集」的，不是一次性的',
          md: `很多人默认依赖关系在第一次执行时就定死了。实际不是：这一轮走 if 分支读了 a，下一轮走 else 分支读了 b，**依赖表应该跟着换**。

所以 effect 每轮执行的正确姿势是：

1. 先假设上一轮的依赖全部作废 → 清空
2. 再执行函数 → 读到什么记什么

这就是 cleanup 的意义：不是修补，而是「每轮重新记账」。Vue3 源码里这个函数叫 cleanupEffect，在 effect 每次 setup 时调用。`
        },
        {
          title: '清理需要「反向指针」',
          md: `dep 是「属性 → 用到它的 effect 集合」，这个方向只能回答「这个属性变了该叫醒谁」。可清理要回答反过来的问题：**这个 effect 应该从哪些集合里删掉自己？**

光靠 dep 找不到。所以要在 effect 身上存一份反向清单：

~~~js
dep.add(activeEffect)          // 正向：属性 → effect
activeEffect.deps.push(dep)    // 反向：effect → 它进过哪些 dep
~~~

两边的增删必须成对：track 时两边都加，cleanup 时两边都删。少写一边，清理就会漏。`
        }
      ],
      api: [
        {
          name: 'cleanupEffect',
          sig: 'cleanupEffect(eff: Function): void',
          args: 'eff —— 要清理的 effect（实际传的是 runner）。它身上必须有 deps 数组，记录着自己进过哪些 Set；没有就先兜底成空数组。',
          returns: '没有返回值。效果是：每一个 dep 里都不再有 eff，并且 eff.deps 变成长度为 0 的空数组。',
          example: `const state = reactive({ flag: true, a: 1, b: 2 })
let runs = 0
effect(() => { runs++; state.flag ? state.a : state.b })

state.flag = false   // 重跑一次，依赖换成 flag + b
state.a++            // 不再触发（a 已经从账本里清掉了）
runs                 // 仍然是 2`
        }
      ],
      nodes: ['fe.vue.reactivity.effect-dep'],
      thinking: [
        {
          title: '先确认「多跑的那一次」真的会发生，再动手改',
          md: `我拿上一关的实现跑了一遍分支切换：flag 从 true 变 false，effect 重跑；接着把 a 加一，它又跑了一次，而这次执行里根本没读 a。这一下我才确定问题不是「理论上可能浪费」，而是账本里确实留着一条已经失效的边。
确认了现象，改法才有方向：问题出在「账本只加不减」，不在 trigger 的判断，也不在 set 的顺序。先定位到出问题的那一行，再写代码，能省掉一大半试错。`
        },
        {
          title: '为什么清理不能「顺手在 trigger 里跳过」',
          md: `也有人会想：在 trigger 遍历 dep 时判断一下这个 effect 还需不需要这个属性，不就行了。可 effect 是函数，它「以后需不需要」只有在下次执行完才知道，trigger 那一刻无法预判。
而且这种判断要读一次 effect 的依赖状态，等于把成本搬到每次触发上——热点路径反而更贵。Vue3 选择在**执行前**清账：成本只在 effect 真正要跑的时候付一次，语义也干净——上一轮的账，执行前就归零。`
        },
        {
          title: '反向清单为什么是数组，而不是清理时重新遍历 targetMap',
          md: `一个直觉的替代方案：清理时把整个 targetMap 扫一遍，把 eff 从所有 Set 里删掉。这能work，但每次执行都要遍历所有对象的所有属性，成本和「我这个 effect 依赖了几个属性」无关，和数据规模成正比。
存 deps 数组把成本压到「我进过几个 dep」，而且天然只碰自己那一份，不会误删别人的登记。用一点内存换掉一次全表扫描，在渲染函数这种高频路径上尤其划算。`
        },
        {
          title: '为什么清空 deps 用 length = 0，而不是换一个新数组',
          md: `我一开始写的是 eff.deps = []，看起来更干净。但 deps 是 effect 的身份信息之一，外面（调试工具、或者 effect 自己的其它引用）可能还握着这个数组的引用；换新数组等于让旧引用永远停在过期状态。
用 length = 0 原地清空，引用不变、内容归零，所有持有者看到的是同一份真相。这个小习惯在真实项目里能免掉一类「我明明清了啊，怎么还触发」的悬案。`
        }
      ],
      stages: [
        {
          n: 1,
          title: '登记依赖时，顺手记下反向指针',
          think: '清理要回答的是「我该从哪些集合里删掉自己」，可 dep 只写了正向指针。所以第一步不写清理，先让每次登记都成对地把 dep 记到 effect 身上；只有这份反向清单真的存在，下一步的删除才有名单可循。',
          hint: '在 dep.add(activeEffect) 之后，把同一个 dep push 进 activeEffect.deps；push 之前先判断 deps 存不存在、这个 dep 是不是已经记过。',
          vocab: [
            { term: '反向指针', md: 'dep 只记「属性 → effect」，清理需要反方向：effect 身上存一份 deps 数组，记录「我进过哪些 dep」。两边同时增删，清理才有名单。' },
            { term: 'deps 不存在时的兜底', md: '第 2、3 关的测试会把 activeEffect 手动设成普通函数，这种函数身上没有 deps。track 里先建，才不会在跨关回归里报错。' }
          ],
          diag: [
            '正向账本里查不到这个 effect：track 里漏了 dep.add(activeEffect)，或者 dep 建在了别的 depsMap 上。',
            'effect 身上没有反向指针：track 里少了把 dep push 进 activeEffect.deps 那一行。',
            '反向清单里出现了重复：push 之前没用 dep.has(activeEffect) 挡住「已经登记过」的情况。',
            '两个属性只记了一条：读 b 的时候也要各自 push 一次，一条 dep 对一个属性。',
            '普通函数登记时报错或没记上：activeEffect.deps 不存在时要先建空数组再 push。'
          ],
          code: `/**
 * 第 6 关 · 第 1 步：登记依赖时顺手记下反向指针
 *
 * 这一步还不清理，只把「这个 effect 进过哪些 dep」记在它自己身上。
 * 没有这份清单，下一步的清理根本不知道该从哪些 Set 里删自己。
 */
const targetMap = new WeakMap()
let activeEffect = null

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  if (!dep.has(activeEffect)) {
    dep.add(activeEffect)
    // 反向指针：同时让 effect 记住它进过这个 dep
    if (!activeEffect.deps) activeEffect.deps = []
    activeEffect.deps.push(dep)
  }
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (!dep) return
  for (const eff of [...dep]) eff()
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const old = t[key]
      const ok = Reflect.set(t, key, value, receiver)
      if (ok && !Object.is(old, value)) trigger(t, key)
      return ok
    }
  })
}

function effect(fn) {
  const runner = () => {
    activeEffect = runner
    try {
      return fn()
    } finally {
      activeEffect = null
    }
  }
  // 反向清单：先给空数组，track 会往里 push 它进过的 dep
  runner.deps = []
  runner()
  return runner
}
`,
          test: `{
  const raw = { a: 1, b: 2 }
  const state = reactive(raw)
  let runs = 0
  const runner = effect(() => { runs++; state.a })

  check('正向账本里登记了这个 effect', () => {
    const dep = targetMap.get(raw).get('a')
    ok(dep.has(runner))
  })
  check('effect 身上记下了它进过的那个 dep', () => {
    same(runner.deps.length, 1)
    ok(runner.deps[0] === targetMap.get(raw).get('a'))
  })
  check('同一个属性读两次，反向清单里也只有一份', () => {
    runner()
    runner()
    same(runner.deps.length, 1)
  })
  check('读两个属性，反向清单里就有两条', () => {
    const r2 = effect(() => { state.a; state.b })
    same(r2.deps.length, 2)
  })
  check('手动把 activeEffect 设成普通函数，也能现建一份清单', () => {
    const plain = () => { runs++ }
    activeEffect = plain
    state.a
    activeEffect = null
    same(plain.deps.length, 1)
  })
}
`
        },
        {
          n: 2,
          title: '实现 cleanupEffect：从每个 dep 里把自己摘掉',
          think: '名单有了，这一步终于能删。我刻意先不把它接进执行流程：单独实现、单独验证「删除」这个动作本身，这样「删不干净」和「删干净了但时机不对」能分开排错，不用一上来就同时怀疑两件事。',
          hint: '遍历 eff.deps 里的每个 dep，调 dep.delete(eff)；遍历完把 eff.deps 的长度清成 0，别重新赋值成新数组。',
          vocab: [
            { term: '原地清空 length = 0', md: '用 eff.deps.length = 0 而不是 eff.deps = []：引用不变，所有还握着这个数组的人看到的是同一份真相。' }
          ],
          diag: [
            'dep 里还有这个 effect：cleanupEffect 没有遍历 eff.deps 并逐个 dep.delete(eff)。',
            '反向清单没被清空：循环之后少了 eff.deps.length = 0，或者写成了重新赋值。',
            '清理之后属性变化仍然触发：dep 没删干净，或者删的是另一个 dep 集合。',
            '重跑之后依赖回不来：说明清理把 effect 的 deps 数组换成了新数组，track 往里 push 的不是同一份。'
          ],
          code: `/**
 * 第 6 关 · 第 2 步：实现 cleanupEffect
 *
 * 把某个 effect 从它进过的每一个 dep 里摘掉，并清空它自己的清单。
 * 这一步还不在执行流程里调用它 —— 先单独把「删」验证清楚。
 */
const targetMap = new WeakMap()
let activeEffect = null

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  if (!dep.has(activeEffect)) {
    dep.add(activeEffect)
    if (!activeEffect.deps) activeEffect.deps = []
    activeEffect.deps.push(dep)
  }
}

function cleanupEffect(eff) {
  // 反向清单在这里派上用场：逐个 dep 把自己摘出去
  for (const dep of eff.deps ?? []) dep.delete(eff)
  // 原地清空：引用不变，外面握着的还是同一份清单
  eff.deps.length = 0
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (!dep) return
  for (const eff of [...dep]) eff()
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const old = t[key]
      const ok = Reflect.set(t, key, value, receiver)
      if (ok && !Object.is(old, value)) trigger(t, key)
      return ok
    }
  })
}

function effect(fn) {
  const runner = () => {
    activeEffect = runner
    try {
      return fn()
    } finally {
      activeEffect = null
    }
  }
  runner.deps = []
  runner()
  return runner
}
`,
          test: `{
  const raw = { a: 1, b: 2 }
  const state = reactive(raw)
  let runs = 0
  const runner = effect(() => { runs++; state.a; state.b })
  const depA = targetMap.get(raw).get('a')
  const depB = targetMap.get(raw).get('b')

  check('清理之后，每个 dep 里都不再有这个 effect', () => {
    same(runner.deps.length, 2)
    cleanupEffect(runner)
    same(depA.has(runner), false)
    same(depB.has(runner), false)
  })
  check('清理之后，effect 自己的反向清单也空了', () => {
    same(runner.deps.length, 0)
  })
  check('清理之后，属性变化不再叫醒它', () => {
    const before = runs
    state.a = 10
    same(runs, before)
  })
  check('清理之后再执行一次，依赖会重新登记回来', () => {
    runner()
    same(runner.deps.length, 2)
    state.a = 20
    same(runs, 3)
  })
}
`
        },
        {
          n: 3,
          title: '每轮执行前先清账，再重新收集',
          think: '最后一步才是把清理接进执行流程，顺序不能反：先清空上一轮的账，再执行，最后由这一轮的读取重新登记。清理放在执行之后，会把刚登记的也删掉；放在执行中间，则会留下「这轮没读、上轮读过」的残留。',
          hint: '在 runner 的开头、设置 activeEffect 之前调用 cleanupEffect(runner)，位置在 try 之前。',
          vocab: [
            { term: '清理的时机', md: '必须在设置 activeEffect 之前、在 fn 执行之前。放在执行之后等于「读完再清」，会把这一轮刚登记的依赖也删掉。' }
          ],
          diag: [
            '切换分支没有重新执行：cleanupEffect 调用位置不对，或者把 runner 自己的 deps 清空后没有重新 track。',
            '切换后旧分支还在触发：runner 里没有调用 cleanupEffect(runner)，上一轮的 a 还留在 dep 里。',
            '新分支的属性不触发：清理跑在了 track 之后，把这一轮刚登记的依赖也删掉了。',
            '切回原分支后旧的属性没生效：说明清理把 deps 数组换成了新数组，track 后续 push 到了另一份上。'
          ],
          code: `/**
 * 第 6 关 · 第 3 步：每轮执行前先清账
 *
 * 执行流程变成三步：清掉上一轮的依赖 → 执行 → 这一轮的读取重新登记。
 * 顺序是语义的一部分：先清后跑，账本里只剩「这一轮真正读到的」。
 */
const targetMap = new WeakMap()
let activeEffect = null

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  if (!dep.has(activeEffect)) {
    dep.add(activeEffect)
    if (!activeEffect.deps) activeEffect.deps = []
    activeEffect.deps.push(dep)
  }
}

function cleanupEffect(eff) {
  for (const dep of eff.deps ?? []) dep.delete(eff)
  eff.deps.length = 0
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (!dep) return
  for (const eff of [...dep]) eff()
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const old = t[key]
      const ok = Reflect.set(t, key, value, receiver)
      if (ok && !Object.is(old, value)) trigger(t, key)
      return ok
    }
  })
}

function effect(fn) {
  const runner = () => {
    // 上一轮的账先归零，接下来读到的才是这一轮的依赖
    cleanupEffect(runner)
    activeEffect = runner
    try {
      return fn()
    } finally {
      activeEffect = null
    }
  }
  runner.deps = []
  runner()
  return runner
}
`,
          test: `{
  const state = reactive({ flag: true, a: 1, b: 2 })
  let runs = 0
  effect(() => { runs++; state.flag ? state.a : state.b })

  check('切换分支时，effect 会重新执行', () => {
    state.flag = false
    same(runs, 2)
  })
  check('切换后，旧分支的属性不再触发', () => {
    state.a++
    same(runs, 2)
  })
  check('切换后，新分支的属性能触发', () => {
    state.b++
    same(runs, 3)
  })
  check('切回原分支，另一边的属性不再触发', () => {
    state.flag = true
    same(runs, 4)
    state.b++
    same(runs, 4)
  })
}
`
        }
      ],
      finalCode: `/**
 * 第 6 关 · 分支变了，旧依赖要清账（完整实现）
 *
 * 两处改动互相配合：
 *   1) track 里登记反向指针：effect.deps 记下「我进过哪些 dep」
 *   2) runner 执行前先 cleanupEffect：上一轮的依赖全部作废，再重新收集
 */
const targetMap = new WeakMap()
let activeEffect = null

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  // 正向登记 + 反向指针，必须成对出现
  if (!dep.has(activeEffect)) {
    dep.add(activeEffect)
    if (!activeEffect.deps) activeEffect.deps = []
    activeEffect.deps.push(dep)
  }
}

function cleanupEffect(eff) {
  for (const dep of eff.deps ?? []) dep.delete(eff)
  eff.deps.length = 0
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (!dep) return
  for (const eff of [...dep]) eff()
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const old = t[key]
      const ok = Reflect.set(t, key, value, receiver)
      if (ok && !Object.is(old, value)) trigger(t, key)
      return ok
    }
  })
}

function effect(fn) {
  const runner = () => {
    cleanupEffect(runner)
    activeEffect = runner
    try {
      return fn()
    } finally {
      activeEffect = null
    }
  }
  runner.deps = []
  runner()
  return runner
}
`,
      usage: `// 1) 分支切换：账本跟着分支走，不再留旧账
const state = reactive({ flag: true, a: 1, b: 2 })
let runs = 0
effect(() => { runs++; state.flag ? state.a : state.b })

state.flag = false   // 重跑一次 → runs = 2，依赖换成 flag + b
state.a++            // 不触发，runs 仍然是 2
state.b++            // 触发 → runs = 3

// 2) 每轮执行前都会清一次，所以反复切换也不会把账越记越多
state.flag = true    // runs = 4，依赖换回 flag + a
state.b++            // 不触发，runs 仍然是 4
state.a++            // 触发 → runs = 5

// 3) 手动清理：把一个 effect 从账本上摘干净（注销、销毁组件时用得上）
const runner = effect(() => { state.a })
cleanupEffect(runner)
state.a++            // 不再触发这个 runner
runner.deps.length   // 0`,
      concepts: [
        {
          title: '为什么每轮都要清，而不是「只加不减」',
          md: '如果只加不减，账本会随着分支切换越记越多，最后每个 effect 都依赖一切，等于没有依赖追踪。Vue3 的渲染函数每次重渲染都重新收集依赖，靠的就是这套 cleanup + track 的循环。'
        },
        {
          title: '清理之后留下的空 Set',
          md: '清理会让某些属性名下的 Set 变空。这一关不用管它——空 Set 在 trigger 里遍历一次什么也不会发生。真实实现里会顺手把空格子删掉，但那属于内存优化的范畴，先把手上的语义做对。'
        }
      ],
      skeleton: `/**
 * 第 6 关 · 分支变了，旧依赖要清账
 *
 * 上一关的账本只加不减：effect 换成另一条分支之后，
 * 旧分支里已经不再读的属性，照样一变化就把它叫醒。
 *
 * 这一关要做到：每轮执行前先把自己上一轮的依赖清掉，
 * 再执行、再按这一轮实际读到的重新登记。
 */

const targetMap = new WeakMap()
let activeEffect = null

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  // 只做了正向登记：dep 里有了这个 effect，但 effect 不知道自己进过哪些 dep
  dep.add(activeEffect)
}

function cleanupEffect(eff) {
  // 这里还空着：应该从每个 dep 里删掉 eff，并清空 eff 的反向清单
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (!dep) return
  for (const eff of [...dep]) eff()
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const old = t[key]
      const ok = Reflect.set(t, key, value, receiver)
      if (ok && !Object.is(old, value)) trigger(t, key)
      return ok
    }
  })
}

function effect(fn) {
  const runner = () => {
    // 执行前没有清账：上一轮的依赖会一直留在账本里
    activeEffect = runner
    try {
      return fn()
    } finally {
      activeEffect = null
    }
  }
  runner.deps = []
  runner()
  return runner
}
`,
      solution: `/**
 * 第 6 关 · 分支变了，旧依赖要清账（完整实现）
 *
 * 两处改动互相配合：
 *   1) track 里登记反向指针：effect.deps 记下「我进过哪些 dep」
 *   2) runner 执行前先 cleanupEffect：上一轮的依赖全部作废，再重新收集
 */
const targetMap = new WeakMap()
let activeEffect = null

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  // 正向登记 + 反向指针，必须成对出现
  if (!dep.has(activeEffect)) {
    dep.add(activeEffect)
    if (!activeEffect.deps) activeEffect.deps = []
    activeEffect.deps.push(dep)
  }
}

function cleanupEffect(eff) {
  for (const dep of eff.deps ?? []) dep.delete(eff)
  eff.deps.length = 0
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (!dep) return
  for (const eff of [...dep]) eff()
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const old = t[key]
      const ok = Reflect.set(t, key, value, receiver)
      if (ok && !Object.is(old, value)) trigger(t, key)
      return ok
    }
  })
}

function effect(fn) {
  const runner = () => {
    cleanupEffect(runner)
    activeEffect = runner
    try {
      return fn()
    } finally {
      activeEffect = null
    }
  }
  runner.deps = []
  runner()
  return runner
}
`,
      tests: `const state = reactive({ flag: true, a: 1, b: 2 })
let runs = 0
effect(() => { runs++; state.flag ? state.a : state.b })

check('第一次执行', () => same(runs, 1))
check('切换分支会重新执行', () => { state.flag = false; same(runs, 2) })
check('切换后，旧分支的属性变化不再触发', () => { state.a++; same(runs, 2) })
check('切换后，新分支的属性变化能触发', () => { state.b++; same(runs, 3) })
check('切回原分支，另一边的属性不再触发', () => { state.flag = true; same(runs, 4); state.b++; same(runs, 4) })
check('切回后，原来的属性重新生效', () => { state.a++; same(runs, 5) })
{
  const raw = { a: 1, b: 2 }
  const s = reactive(raw)
  let n = 0
  const runner = effect(() => { n++; s.a })

  check('第 1 步：正向账本里登记了这个 effect', () => {
    const dep = targetMap.get(raw).get('a')
    ok(dep.has(runner))
  })
  check('第 1 步：effect 身上记下了它进过的那个 dep', () => {
    same(runner.deps.length, 1)
    ok(runner.deps[0] === targetMap.get(raw).get('a'))
  })
  check('第 1 步：同一个属性读两次，反向清单里也只有一份', () => {
    runner()
    runner()
    same(runner.deps.length, 1)
  })
  check('第 1 步：读两个属性，反向清单里就有两条', () => {
    const r2 = effect(() => { s.a; s.b })
    same(r2.deps.length, 2)
  })
  check('第 1 步：手动把 activeEffect 设成普通函数，也能现建一份清单', () => {
    const plain = () => { n++ }
    activeEffect = plain
    s.a
    activeEffect = null
    same(plain.deps.length, 1)
  })
}
{
  const raw = { a: 1, b: 2 }
  const s = reactive(raw)
  let n = 0
  const runner = effect(() => { n++; s.a; s.b })
  const depA = targetMap.get(raw).get('a')
  const depB = targetMap.get(raw).get('b')

  check('第 2 步：清理之后，每个 dep 里都不再有这个 effect', () => {
    same(runner.deps.length, 2)
    cleanupEffect(runner)
    same(depA.has(runner), false)
    same(depB.has(runner), false)
  })
  check('第 2 步：清理之后，effect 自己的反向清单也空了', () => {
    same(runner.deps.length, 0)
  })
  check('第 2 步：清理之后，属性变化不再叫醒它', () => {
    const before = n
    s.a = 10
    same(n, before)
  })
  check('第 2 步：清理之后再执行一次，依赖会重新登记回来', () => {
    runner()
    same(runner.deps.length, 2)
    s.a = 20
    same(n, 3)
  })
}
{
  const s = reactive({ flag: true, a: 1, b: 2 })
  let n = 0
  effect(() => { n++; s.flag ? s.a : s.b })

  check('第 3 步：切换分支时，effect 会重新执行', () => {
    s.flag = false
    same(n, 2)
  })
  check('第 3 步：切换后，旧分支的属性不再触发', () => {
    s.a++
    same(n, 2)
  })
  check('第 3 步：切换后，新分支的属性能触发', () => {
    s.b++
    same(n, 3)
  })
  check('第 3 步：切回原分支，另一边的属性不再触发', () => {
    s.flag = true
    same(n, 4)
    s.b++
    same(n, 4)
  })
}`
    },
    /* ------------------------------------------------------------ 第 7 关 */
    {
      id: 'lv7',
      title: 'effect 套 effect：把「当前是谁」换成栈',
      emoji: '🪜',
      xp: 60,
      goal: '用 effectStack 替代「执行完就置空」，让嵌套的 effect 各自收集自己的依赖，互不吞掉对方。',
      why: '上一关的 finally 里写的是 activeEffect = null。只要 effect 里再套一个 effect（真实框架里这是常态：父组件渲染时会触发子组件渲染），内层跑完就把 activeEffect 清空了——外层后面读的属性，一条依赖都记不上。表现是「改了数据，外层那个函数再也不更新」，而且极难查，因为看起来一切正常。',
      prereq: [
        {
          title: '栈顶就是「当前正在执行的 effect」',
          md: `进入一个 effect：把它压栈，activeEffect 指向它。离开时：弹栈，activeEffect 指向**新的栈顶**（而不是 null）。

~~~js
effectStack.push(runner)
activeEffect = runner
// ...执行...
effectStack.pop()
activeEffect = effectStack[effectStack.length - 1] ?? null
~~~

栈这个东西在编译器、事件循环、浏览器历史里都是同一个作用：只在两端操作，天然记住「上一层是谁」。用单个变量存 prev 也能work，但嵌套三层、或中途抛错时很容易漏恢复。`
        },
        {
          title: '为什么必须放在 finally 里',
          md: `如果 fn 抛错，后面的 pop 就不会执行，栈里永久留着一个死掉的 runner，activeEffect 也就永远指错人。finally 保证「无论正常返回还是抛错都要收尾」。

这也是 Vue3 源码里 effect 的标准写法：try 里执行 fn，finally 里 pop + 恢复 activeEffect。`
        }
      ],
      api: [
        {
          name: 'effect（嵌套安全版）',
          sig: 'effect(fn: Function): Function',
          args: '签名不变。变化是内部维护方式：从「一个全局变量」换成「一个栈」。',
          returns: 'runner，和之前一样。',
          example: `const state = reactive({ a: 1, b: 2 })
let outer = 0
effect(() => {
  outer++
  effect(() => { state.b })   // 内层 effect
  state.a                     // 这一行必须仍然记在外层名下
})

state.a = 2   // 外层要重跑（上一关的实现里，这一行会失效）`
        }
      ],
      nodes: ['fe.vue.reactivity.effect-dep'],
      thinking: [
        {
          title: '先问「嵌套时这次读取该算谁的」，再问用什么数据结构',
          md: `拿到这一关，我先写了一个最小的嵌套场景：外层 effect 里创建一个内层 effect，内层之后再读外层的属性。跑下来发现外层那次读取根本没进账本——问题不在 track，而在「退出时把 activeEffect 置成了 null」。
于是问题被重述成一句话：内层退出时，activeEffect 应该指向谁？答案显然是「进入内层之前的那个」。一旦这样问，数据结构就不是「要不要用栈」，而是「什么东西能天然记住上一层」。`
        },
        {
          title: '为什么用栈，而不是在 effect 里存一个 prev 变量',
          md: `最省事的写法是 const prev = activeEffect; activeEffect = runner; ... finally { activeEffect = prev }。它works，而且很多教程就是这么教的。
但它依赖一个前提：每次赋值都记得先存 prev。只要有一处漏了、或者有人从别的地方直接改 activeEffect，恢复链就断了，而且断了以后表现是「某个函数偶尔不更新」，极难定位。栈把「上一层是谁」变成结构本身：push 和 pop 一一对应，谁也不需要记住上一层的变量。多一层嵌套就多一个栈元素，不需要改代码。`
        },
        {
          title: '为什么先做「进出配平」，再改「退出后指向谁」',
          md: `这两件事我刻意分成两步。原因是它们的失败现象完全一样——都是「依赖莫名其妙丢了」——如果同时改，红了以后你分不清是栈没弹干净，还是弹完指向错了。
先让 push/pop 成对，确认栈不会越堆越高、异常路径也能收尾；这时嵌套仍然是错的（因为退出时还置 null），但错的原因唯一。再改那一行指向栈顶，测试立刻转绿。把两个可变因素分开，是排错成本最低的做法。`
        },
        {
          title: 'pop 和取栈顶的顺序不能反',
          md: `我第一版写成了先取栈顶再 pop：activeEffect = effectStack[effectStack.length - 1]，然后 effectStack.pop()。结果内层退出后 activeEffect 指向的还是它自己——因为它还没被弹掉。
这种 bug 特别阴：单层调用完全正常，只有嵌套时才错，而且栈里看起来「都对」。正确的顺序是「先把自己弹掉，再看现在栈顶是谁」。一行代码的位置，决定了你是从栈里往外看，还是站在栈里看自己。`
        }
      ],
      stages: [
        {
          n: 1,
          title: '进入时压栈，让栈顶等于「正在执行的那个」',
          think: '嵌套的第一件事是进入时登记：谁在执行，栈顶就应该是谁。这一步只做进入侧，退出侧维持原来的置空——先把「当前是谁」从单个变量升级成栈，再谈退出之后该把指针还给谁。',
          hint: '在 cleanup 之后、执行 fn 之前，把 runner push 进 effectStack，然后让 activeEffect 指向它。',
          vocab: [
            { term: 'effectStack', md: '一个模块级的数组，进入 effect 时 push、退出时 pop。栈顶永远等于「此刻正在执行的 effect」，嵌套几层都不会错。' }
          ],
          diag: [
            '栈里查不到正在执行的那一层：runner 里少了对 effectStack 的 push，或者 push 的不是 runner 自己。',
            '内层读到的属性记到了外层头上：activeEffect 没有在进入内层时重新指向内层。',
            '最外层跑完后 activeEffect 不是 null：退出侧的收尾被漏掉了，指针停在上一个执行者身上。'
          ],
          code: `/**
 * 第 7 关 · 第 1 步：进入时压栈
 *
 * 把「此刻谁在执行」从单个变量升级成一个栈：
 * 进入时 push，栈顶就是当前 effect。
 * 退出侧这一步先维持原样（置 null），下一步再谈还给谁。
 */
const targetMap = new WeakMap()
let activeEffect = null
const effectStack = []

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  if (!dep.has(activeEffect)) {
    dep.add(activeEffect)
    if (!activeEffect.deps) activeEffect.deps = []
    activeEffect.deps.push(dep)
  }
}

function cleanupEffect(eff) {
  for (const dep of eff.deps ?? []) dep.delete(eff)
  eff.deps.length = 0
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (!dep) return
  for (const eff of [...dep]) eff()
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const old = t[key]
      const ok = Reflect.set(t, key, value, receiver)
      if (ok && !Object.is(old, value)) trigger(t, key)
      return ok
    }
  })
}

function effect(fn) {
  const runner = () => {
    cleanupEffect(runner)
    // 进入：压栈，并让「当前 effect」指向自己
    effectStack.push(runner)
    activeEffect = runner
    try {
      return fn()
    } finally {
      activeEffect = null
    }
  }
  runner.deps = []
  runner()
  return runner
}
`,
          test: `{
  const s = reactive({ a: 1, b: 2 })

  check('嵌套时，栈里能查到正在执行的那一层', () => {
    const base = effectStack.length
    const depths = []
    effect(() => {
      depths.push(effectStack.length - base)
      effect(() => { depths.push(effectStack.length - base) })
    })
    same(depths, [1, 2])
  })
  check('内层执行期间读到的属性，只算在内层头上', () => {
    let outerRuns = 0
    let innerRuns = 0
    effect(() => {
      outerRuns++
      effect(() => { innerRuns++; s.b })
    })
    same([outerRuns, innerRuns], [1, 1])
    s.b = 1
    same([outerRuns, innerRuns], [1, 2])
  })
  check('最外层跑完后，外部读取不会被记账', () => {
    effect(() => {})
    same(activeEffect, null)
  })
}
`
        },
        {
          n: 2,
          title: '退出时弹栈，先把进出配平',
          think: '栈先进不出，等于只记了一份越来越长的日志：内层结束后栈还认为它在执行，下一次进入的深度就全错了，异常路径更是直接把栈留脏。这一步只做退出时弹掉自己，把进出配平；activeEffect 暂时仍置 null，恢复给谁留到下一步。',
          hint: '在 finally 里先 effectStack.pop()，再把 activeEffect 置为 null。注意顺序：先弹掉自己。',
          vocab: [
            { term: '进出配平', md: '栈的 push 和 pop 必须成对。只要有一条路径只 push 不 pop，栈顶就会一直指向一个已经执行完的函数，后面的归属全错。' }
          ],
          diag: [
            '嵌套跑完栈里还有东西：finally 里少了 effectStack.pop()，每执行一次就多留一层。',
            '顶层跑完栈不空或指针没归位：pop 写了，但 activeEffect 没有跟着置回 null。',
            '抛错时栈留脏：pop 写在了 try 里而不是 finally 里，异常一跳过就执行不到。',
            '手动重跑之后栈不平衡：pop 只在首次执行路径上，runner 再调用时没走同一段收尾。'
          ],
          code: `/**
 * 第 7 关 · 第 2 步：退出时弹栈
 *
 * 进出必须成对：进入时 push，退出时 pop（放在 finally 里，抛错也收尾）。
 * 这一步 activeEffect 仍按老规矩置 null —— 先让栈自己干净。
 */
const targetMap = new WeakMap()
let activeEffect = null
const effectStack = []

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  if (!dep.has(activeEffect)) {
    dep.add(activeEffect)
    if (!activeEffect.deps) activeEffect.deps = []
    activeEffect.deps.push(dep)
  }
}

function cleanupEffect(eff) {
  for (const dep of eff.deps ?? []) dep.delete(eff)
  eff.deps.length = 0
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (!dep) return
  for (const eff of [...dep]) eff()
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const old = t[key]
      const ok = Reflect.set(t, key, value, receiver)
      if (ok && !Object.is(old, value)) trigger(t, key)
      return ok
    }
  })
}

function effect(fn) {
  const runner = () => {
    cleanupEffect(runner)
    effectStack.push(runner)
    activeEffect = runner
    try {
      return fn()
    } finally {
      // 先把自己弹掉，再收尾；这里还只是置 null
      effectStack.pop()
      activeEffect = null
    }
  }
  runner.deps = []
  runner()
  return runner
}
`,
          test: `{
  check('嵌套跑完之后，栈里不留东西', () => {
    effect(() => { effect(() => {}) })
    same(effectStack.length, 0)
  })
  check('顶层跑完之后，栈空、activeEffect 回到 null', () => {
    effect(() => {})
    same(effectStack.length, 0)
    same(activeEffect, null)
  })
  check('内层抛错时，栈同样会被弹干净', () => {
    try {
      effect(() => { effect(() => { throw new Error('boom') }) })
    } catch (e) {}
    same(effectStack.length, 0)
    same(activeEffect, null)
  })
  check('手动重跑 runner，进出依然平衡', () => {
    const runner = effect(() => {})
    runner()
    runner()
    same(effectStack.length, 0)
  })
}
`
        },
        {
          n: 3,
          title: '退出时把 activeEffect 交还给新的栈顶',
          think: '配平之后问题只剩一句：内层退出，activeEffect 该指向谁？指向 null 会吞掉外层剩下的读取，指向自己会死循环。唯一正确的答案是「新的栈顶」，而栈空时用 ?? null 兜住。',
          hint: '把 finally 里的 activeEffect = null 改成 effectStack[effectStack.length - 1] ?? null；顺序仍然是先 pop 再取栈顶。',
          vocab: [
            { term: '?? null 兜底', md: '最外层退出后栈是空的，effectStack[effectStack.length - 1] 是 undefined，而 activeEffect 必须是 null——track 里靠 !activeEffect 判断有没有人在读。' }
          ],
          diag: [
            '嵌套时内外各跑一次就不是 1：说明注册时的 effectStack 环境已经脏了，先检查上一步的收尾。',
            '内层变化把外层也带跑了：trigger 遍历 dep 时把两个 effect 都叫醒了，通常是 cleanup 没生效、旧依赖还在。',
            '内层跑完后外层依赖丢了：finally 里仍然把 activeEffect 置成 null，没有交给新的栈顶。',
            '最外层结束后 activeEffect 不是 null：?? null 兜底漏了，栈空时拿到了 undefined。'
          ],
          code: `/**
 * 第 7 关 · 第 3 步：退出时把指针还给新的栈顶
 *
 * 内层退出后，外层还要继续执行、继续收集依赖，
 * 所以 activeEffect 必须指向「弹栈之后的新栈顶」，栈空时才是 null。
 */
const targetMap = new WeakMap()
let activeEffect = null
const effectStack = []

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  if (!dep.has(activeEffect)) {
    dep.add(activeEffect)
    if (!activeEffect.deps) activeEffect.deps = []
    activeEffect.deps.push(dep)
  }
}

function cleanupEffect(eff) {
  for (const dep of eff.deps ?? []) dep.delete(eff)
  eff.deps.length = 0
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (!dep) return
  for (const eff of [...dep]) eff()
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const old = t[key]
      const ok = Reflect.set(t, key, value, receiver)
      if (ok && !Object.is(old, value)) trigger(t, key)
      return ok
    }
  })
}

function effect(fn) {
  const runner = () => {
    cleanupEffect(runner)
    effectStack.push(runner)
    activeEffect = runner
    try {
      return fn()
    } finally {
      // 先弹出自己，再把「当前是谁」交还给新的栈顶；栈空时才是 null
      effectStack.pop()
      activeEffect = effectStack[effectStack.length - 1] ?? null
    }
  }
  runner.deps = []
  runner()
  return runner
}
`,
          test: `{
  const state = reactive({ a: 1, b: 2 })
  let outerRuns = 0
  let innerRuns = 0
  effect(() => {
    outerRuns++
    effect(() => { innerRuns++; state.b })
    state.a
  })

  check('嵌套时内外各执行一次', () => {
    same(outerRuns, 1)
    same(innerRuns, 1)
  })
  check('内层依赖变化，只重跑内层', () => {
    state.b = 3
    same(innerRuns, 2)
    same(outerRuns, 1)
  })
  check('内层跑完后，外层读的属性仍然记在外层名下', () => {
    state.a = 2
    same(outerRuns, 2)
  })
  check('顶层结束后 activeEffect 回到 null，栈也是空的', () => {
    same(activeEffect, null)
    same(effectStack.length, 0)
  })
}
`
        }
      ],
      finalCode: `/**
 * 第 7 关 · effect 套 effect：把「当前是谁」换成栈（完整实现）
 *
 * 进入时 push + activeEffect = runner；
 * 退出时（finally）先 pop，再把 activeEffect 交给新的栈顶，栈空才置 null。
 */
const targetMap = new WeakMap()
let activeEffect = null
const effectStack = []

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  if (!dep.has(activeEffect)) {
    dep.add(activeEffect)
    if (!activeEffect.deps) activeEffect.deps = []
    activeEffect.deps.push(dep)
  }
}

function cleanupEffect(eff) {
  for (const dep of eff.deps ?? []) dep.delete(eff)
  eff.deps.length = 0
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (!dep) return
  for (const eff of [...dep]) eff()
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const old = t[key]
      const ok = Reflect.set(t, key, value, receiver)
      if (ok && !Object.is(old, value)) trigger(t, key)
      return ok
    }
  })
}

function effect(fn) {
  const runner = () => {
    cleanupEffect(runner)
    effectStack.push(runner)
    activeEffect = runner
    try {
      return fn()
    } finally {
      effectStack.pop()
      activeEffect = effectStack[effectStack.length - 1] ?? null
    }
  }
  runner.deps = []
  runner()
  return runner
}
`,
      usage: `// 1) 嵌套 effect：内外各自记账，谁也不吞谁的依赖
const state = reactive({ a: 1, b: 2 })
let outerRuns = 0
let innerRuns = 0

effect(() => {
  outerRuns++
  effect(() => { innerRuns++; state.b })   // 组件渲染里挂载子组件，就是这个形状
  state.a                                   // 这一行必须仍然记在外层名下
})

state.b = 3    // 只重跑内层：innerRuns = 2，outerRuns 仍然是 1
state.a = 2    // 外层重跑：outerRuns = 2

// 2) 异常也不会把栈留脏
try {
  effect(() => { throw new Error('render failed') })
} catch (e) {
  // activeEffect 已经回到 null，effectStack 也是空的
}

// 3) 手动重跑同样走同一条进出路径
const runner = effect(() => { state.a })
runner()
activeEffect      // null`,
      concepts: [
        {
          title: '组件树就是天然的嵌套 effect',
          md: '父组件的 render effect 执行时会挂载子组件，子组件的 render effect 在内层执行。如果 activeEffect 恢复错，子组件更新完之后父组件的依赖就散了——这类 bug 在线上通常表现为「偶尔不更新」，因为只有在特定渲染顺序下才触发。用栈之后，嵌套多深都不会错。'
        }
      ],
      skeleton: `/**
 * 第 7 关 · effect 套 effect：把「当前是谁」换成栈
 *
 * 上一关 finally 里把 activeEffect 直接置成了 null。
 * 一旦 effect 里再套一个 effect，内层结束就把外层弄丢了：
 * 外层后面读的属性收不到依赖，之后再也不会被叫醒。
 */

const targetMap = new WeakMap()
let activeEffect = null
// 栈已经声明好了，但还没被用起来：进入不 push，退出不 pop
const effectStack = []

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  if (!dep.has(activeEffect)) {
    dep.add(activeEffect)
    if (!activeEffect.deps) activeEffect.deps = []
    activeEffect.deps.push(dep)
  }
}

function cleanupEffect(eff) {
  for (const dep of eff.deps ?? []) dep.delete(eff)
  eff.deps.length = 0
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (!dep) return
  for (const eff of [...dep]) eff()
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const old = t[key]
      const ok = Reflect.set(t, key, value, receiver)
      if (ok && !Object.is(old, value)) trigger(t, key)
      return ok
    }
  })
}

function effect(fn) {
  const runner = () => {
    cleanupEffect(runner)
    // 进入时没有压栈
    activeEffect = runner
    try {
      return fn()
    } finally {
      // 退出时直接把指针扔掉，外层还在等它呢
      activeEffect = null
    }
  }
  runner.deps = []
  runner()
  return runner
}
`,
      solution: `/**
 * 第 7 关 · effect 套 effect：把「当前是谁」换成栈（完整实现）
 *
 * 进入时 push + activeEffect = runner；
 * 退出时（finally）先 pop，再把 activeEffect 交给新的栈顶，栈空才置 null。
 */
const targetMap = new WeakMap()
let activeEffect = null
const effectStack = []

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  if (!dep.has(activeEffect)) {
    dep.add(activeEffect)
    if (!activeEffect.deps) activeEffect.deps = []
    activeEffect.deps.push(dep)
  }
}

function cleanupEffect(eff) {
  for (const dep of eff.deps ?? []) dep.delete(eff)
  eff.deps.length = 0
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (!dep) return
  for (const eff of [...dep]) eff()
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const old = t[key]
      const ok = Reflect.set(t, key, value, receiver)
      if (ok && !Object.is(old, value)) trigger(t, key)
      return ok
    }
  })
}

function effect(fn) {
  const runner = () => {
    cleanupEffect(runner)
    effectStack.push(runner)
    activeEffect = runner
    try {
      return fn()
    } finally {
      effectStack.pop()
      activeEffect = effectStack[effectStack.length - 1] ?? null
    }
  }
  runner.deps = []
  runner()
  return runner
}
`,
      tests: `const state = reactive({ a: 1, b: 2 })
let outerRuns = 0
let innerRuns = 0

effect(() => {
  outerRuns++
  effect(() => { innerRuns++; state.b })
  state.a
})

check('外层与内层各执行一次', () => { same(outerRuns, 1); same(innerRuns, 1) })
check('内层依赖变化，只重跑内层', () => { state.b = 3; same(innerRuns, 2); same(outerRuns, 1) })
check('内层跑完后，外层的依赖没有被弄丢', () => { state.a = 2; same(outerRuns, 2) })
check('外层再变一次，仍然能触发（依赖是持续有效的）', () => { state.a = 3; same(outerRuns, 3) })
{
  const s = reactive({ a: 1, b: 2 })

  check('第 1 步：嵌套时，栈里能查到正在执行的那一层', () => {
    const base = effectStack.length
    const depths = []
    effect(() => {
      depths.push(effectStack.length - base)
      effect(() => { depths.push(effectStack.length - base) })
    })
    same(depths, [1, 2])
  })
  check('第 1 步：内层执行期间读到的属性，只算在内层头上', () => {
    let outer = 0
    let inner = 0
    effect(() => {
      outer++
      effect(() => { inner++; s.b })
    })
    same([outer, inner], [1, 1])
    s.b = 1
    same([outer, inner], [1, 2])
  })
  check('第 1 步：最外层跑完后，外部读取不会被记账', () => {
    effect(() => {})
    same(activeEffect, null)
  })
}
{
  check('第 2 步：嵌套跑完之后，栈里不留东西', () => {
    effect(() => { effect(() => {}) })
    same(effectStack.length, 0)
  })
  check('第 2 步：顶层跑完之后，栈空、activeEffect 回到 null', () => {
    effect(() => {})
    same(effectStack.length, 0)
    same(activeEffect, null)
  })
  check('第 2 步：内层抛错时，栈同样会被弹干净', () => {
    try {
      effect(() => { effect(() => { throw new Error('boom') }) })
    } catch (e) {}
    same(effectStack.length, 0)
    same(activeEffect, null)
  })
  check('第 2 步：手动重跑 runner，进出依然平衡', () => {
    const runner = effect(() => {})
    runner()
    runner()
    same(effectStack.length, 0)
  })
}
{
  const s = reactive({ a: 1, b: 2 })
  let outer = 0
  let inner = 0
  effect(() => {
    outer++
    effect(() => { inner++; s.b })
    s.a
  })

  check('第 3 步：嵌套时内外各执行一次', () => {
    same(outer, 1)
    same(inner, 1)
  })
  check('第 3 步：内层依赖变化，只重跑内层', () => {
    s.b = 3
    same(inner, 2)
    same(outer, 1)
  })
  check('第 3 步：内层跑完后，外层读的属性仍然记在外层名下', () => {
    s.a = 2
    same(outer, 2)
  })
  check('第 3 步：顶层结束后 activeEffect 回到 null，栈也是空的', () => {
    same(activeEffect, null)
    same(effectStack.length, 0)
  })
}`
    },
    /* ------------------------------------------------------------ 第 8 关 */
    {
      id: 'lv8',
      title: '调度器：什么时候执行，交给调用方',
      emoji: '⏱️',
      xp: 60,
      goal: '给 effect 加上 scheduler 选项：依赖变化时不直接执行，而是把「要执行谁」交给调用方；再配一个去重队列，把同一轮的多次触发合并成一次。',
      why: '现在同一轮里改 10 个属性，effect 就会同步跑 10 次，其中 9 次是白跑。真实框架不会这么干：它把要执行的 effect 放进队列，等这一轮同步代码跑完，再统一刷新一次——这就是 Vue 的 nextTick 和批量更新。要做到这一点，effect 就不能「触发即执行」，得有一个中间人决定时机。',
      prereq: [
        {
          title: 'scheduler 的契约：收到的是 effect 本身',
          md: `scheduler 不是「执行结果」的回调，它收到的是 **runner 函数本身**：

~~~js
effect(fn, { scheduler: (eff) => jobs.push(eff) })
~~~

为什么传函数？因为调度方需要两件事：决定何时执行（先存着）、以及在队列里做去重（同一个 eff 只留一份）。如果直接传结果，这两件事都做不了。

watch 就是这么实现的：数据变了不重跑回调，而是把回调对应的 effect 丢进队列，等下一次刷新。`
        },
        {
          title: '同步触发 vs 调度执行，各自付什么代价',
          md: `同步执行：改完马上就能读到新状态，但无法合并，一次改 10 个就重渲染 10 次。

调度执行（微任务）：能合并、能保证顺序，代价是「这一轮同步代码里读到的还是旧值」。

这解释了一个常见疑问：Vue 里 state.a = 1 之后 console.log(state.a) 打印的是 1（数据已经写了），但 DOM 要等 nextTick 之后才更新（渲染 effect 被调度了）。数据和视图是两套东西。`
        },
        {
          title: '队列为什么用 Set：去重是它的默认行为',
          md: `同一轮里可能有很多条路把同一个 effect 扔进队列：改 a 触发它、改 b 也触发它。如果按数组存，flush 时它会被执行两次，第二次纯属重复劳动。

Set 的 add 天然去重：同一个函数引用只留一份。再配合「flush 时先拷成数组、再清空队列」，执行过程中重新入队也不会丢——这个细节在第 9 关的 computed 里很关键。`
        }
      ],
      api: [
        {
          name: 'effect（带调度器版）',
          sig: 'effect(fn: Function, options?: { scheduler?: (eff: Function) => void }): Function',
          args: 'options.scheduler —— 可选。给了它，依赖变化时不会直接执行 fn，而是调用 scheduler(eff)，由它决定什么时候调 eff()。',
          returns: 'runner，和之前一样。runner.scheduler 上挂着传进来的调度器（没传就是 undefined）。',
          example: `const state = reactive({ n: 1 })
let runs = 0
const jobs = []

effect(() => { runs++; state.n }, { scheduler: (eff) => jobs.push(eff) })
// 注册时仍然执行一次 → runs = 1

state.n = 2      // 不直接执行 → runs 还是 1，jobs 里有 1 个待办

jobs[0]()        // 手动执行 → runs = 2`
        },
        {
          name: 'queueJob / flushJobs',
          sig: 'queueJob(job: Function): void ｜ flushJobs(): void',
          args: 'queueJob —— 一个现成的 scheduler：把 effect 塞进队列并去重。flushJobs —— 由调用方在合适时机调用，执行队列里所有 job 并清空队列。',
          returns: '都没有返回值。queueJob 只入队，不执行；flushJobs 才真正执行。',
          example: `const state = reactive({ v: 0 })
let runs = 0
effect(() => { runs++; state.v }, { scheduler: queueJob })

state.v = 1
state.v = 2
state.v = 3
runs              // 1：三次写入只入队一次

flushJobs()
runs              // 2：真正执行了一次
state.v = 4
flushJobs()
runs              // 3`
        }
      ],
      nodes: ['fe.vue.scheduler.flush-jobs', 'fe.vue.reactivity.effect-dep'],
      thinking: [
        {
          title: '先问「谁有权决定时机」，再问队列长什么样',
          md: `这一关最容易被写歪的地方是：在 trigger 里直接加一个队列、然后自己 flush。那样调用方永远没有机会插入别的动作，批量更新的时机又被内核偷偷决定了。
我的判断是：内核只负责「把要执行的东西交出去」，至于什么时候执行、要不要合并，全是调用方的事。于是改动收敛成一句：trigger 里看到 scheduler 就调它，看不到才直接跑。队列是实现细节，放在调用方那一侧（这一关最后给了个最小实现）。`
        },
        {
          title: '为什么传 runner，而不是传「已经跑完的结果」',
          md: `如果 scheduler 收到的是执行结果，那它就只能做事后处理，既不能延迟、也不能去重——因为执行已经发生了。
传函数还带来一个额外好处：同一个 effect 被触发多次，传进去的是同一个函数引用，Set 去重就成立；如果每次传一个新闭包，去重立刻失效。判断一个调度接口设计得好不好，就看它交给你的东西能不能被你「再决定一次」。`
        },
        {
          title: '先让 trigger 认这个约定，再让 effect 生产它',
          md: `我拆成两步：第一步只改 trigger，测试里手动给 runner 挂一个 scheduler 来验证分流；第二步才让 effect 从 options 里把 scheduler 挂上去。
这样拆的原因很实际：如果同时改两处，测试红了以后你不知道是「trigger 没看 scheduler」还是「effect 没挂 scheduler」。中间那一步用「手动挂」把两侧解耦，任何一边坏了都只有一个嫌疑人。`
        },
        {
          title: '队列里 clear 的时机：先拷再清，而不是边跑边删',
          md: `flush 我写成「先把 Set 拷成数组，立刻 clear，再逐个执行」。顺序看着啰嗦，但它是唯一能同时满足两件事的写法：执行过程中重新入队不会丢（因为队列已经清了），一次 flush 也不会重复执行同一个 job（因为拷出来的是快照）。
如果写成边遍历边删，执行期间新入队的 job 会在本轮被顺手执行掉，flush 的边界就糊了——「一个 tick 内最多刷新一次」这个承诺也就没了。`
        }
      ],
      stages: [
        {
          n: 1,
          title: 'trigger 里分流：有 scheduler 就交给它',
          think: '先只改通知那一侧：遍历 dep 时先看这个 effect 有没有 scheduler，有就把「它自己」交出去，没有才直接执行。这一步用测试手动给 runner 挂调度器来验证，不碰 effect 的签名，出问题只可能出在分流这一行。',
          hint: '把 trigger 里的 eff() 包进判断：eff.scheduler 存在就调 eff.scheduler(eff)，否则才 eff()。',
          vocab: [
            { term: 'runner.scheduler', md: 'effect 返回的 runner 是普通函数，可以直接挂属性。trigger 遍历 dep 时检查这个属性：有就交给它，没有就直接执行。' }
          ],
          diag: [
            '依赖变化后函数仍然直接跑了：trigger 里还是无条件 eff()，没有先看 eff.scheduler。',
            'scheduler 收到的东西不对：传进去的应该是 effect 本身（那个函数），而不是它的返回值。',
            '手动执行之后没有真正更新：runner 被调度后执行的仍是原来那段逻辑，检查是否误把 scheduler 当成了要执行的函数。'
          ],
          code: `/**
 * 第 8 关 · 第 1 步：trigger 里认 scheduler 这个约定
 *
 * 只改通知侧：有 scheduler 就把 effect 交出去，没有才直接执行。
 * effect 的生产侧（从 options 里挂 scheduler）留到下一步。
 */
const targetMap = new WeakMap()
let activeEffect = null
const effectStack = []

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  if (!dep.has(activeEffect)) {
    dep.add(activeEffect)
    if (!activeEffect.deps) activeEffect.deps = []
    activeEffect.deps.push(dep)
  }
}

function cleanupEffect(eff) {
  for (const dep of eff.deps ?? []) dep.delete(eff)
  eff.deps.length = 0
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (!dep) return
  for (const eff of [...dep]) {
    // 有调度器就交给它决定时机；没有才同步执行
    if (eff.scheduler) eff.scheduler(eff)
    else eff()
  }
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const old = t[key]
      const ok = Reflect.set(t, key, value, receiver)
      if (ok && !Object.is(old, value)) trigger(t, key)
      return ok
    }
  })
}

function effect(fn) {
  const runner = () => {
    cleanupEffect(runner)
    effectStack.push(runner)
    activeEffect = runner
    try {
      return fn()
    } finally {
      effectStack.pop()
      activeEffect = effectStack[effectStack.length - 1] ?? null
    }
  }
  runner.deps = []
  runner()
  return runner
}
`,
          test: `{
  const state = reactive({ n: 1 })
  let runs = 0
  const jobs = []
  const runner = effect(() => { runs++; state.n })
  runner.scheduler = (eff) => jobs.push(eff)

  check('运行时挂上 scheduler 后，依赖变化不再直接执行', () => {
    state.n = 2
    same(runs, 1)
    same(jobs.length, 1)
  })
  check('交给 scheduler 的是 effect 本身', () => {
    same(typeof jobs[0], 'function')
  })
  check('手动执行交出来的 effect，才真正更新', () => {
    jobs[0]()
    same(runs, 2)
    same(state.n, 2)
  })
}
`
        },
        {
          n: 2,
          title: 'effect 把 options.scheduler 挂到 runner 上',
          think: '分流写好了，现在让 effect 真的能生产这种 runner：签名加第二个参数 options，把 scheduler 挂到返回的 runner 上。挂的位置要在 runner() 之前，否则首次执行期间触发的那次变化会找不到调度器。',
          hint: '把签名改成 effect(fn, options = {})，在 runner.deps = [] 旁边加 runner.scheduler = options.scheduler。',
          vocab: [
            { term: 'options 默认值 {}', md: 'effect(fn, options = {}) 里的默认值不能省：只传一个参数的调用会拿到 undefined，取 options.scheduler 会直接抛 TypeError。' }
          ],
          diag: [
            '注册时没有立刻执行：effect 里那句 runner() 被误删或写成了 return runner()。',
            '有 scheduler 时依赖变化仍然直接执行：runner 上没有挂 scheduler，或者挂成了 options.scheduler()。',
            'scheduler 收到的东西不对：应该把 eff 本身交给它，而不是先调一遍再传结果。',
            '只传 fn 的调用报错：函数签名少了 options 的默认值 {}。'
          ],
          code: `/**
 * 第 8 关 · 第 2 步：effect 生产带 scheduler 的 runner
 *
 * options 是可选的，scheduler 挂在 runner 上交给 trigger 判断。
 * 注册时的首次执行不受影响：调度只改变「依赖变化之后」的时机。
 */
const targetMap = new WeakMap()
let activeEffect = null
const effectStack = []

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  if (!dep.has(activeEffect)) {
    dep.add(activeEffect)
    if (!activeEffect.deps) activeEffect.deps = []
    activeEffect.deps.push(dep)
  }
}

function cleanupEffect(eff) {
  for (const dep of eff.deps ?? []) dep.delete(eff)
  eff.deps.length = 0
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (!dep) return
  for (const eff of [...dep]) {
    if (eff.scheduler) eff.scheduler(eff)
    else eff()
  }
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const old = t[key]
      const ok = Reflect.set(t, key, value, receiver)
      if (ok && !Object.is(old, value)) trigger(t, key)
      return ok
    }
  })
}

function effect(fn, options = {}) {
  const runner = () => {
    cleanupEffect(runner)
    effectStack.push(runner)
    activeEffect = runner
    try {
      return fn()
    } finally {
      effectStack.pop()
      activeEffect = effectStack[effectStack.length - 1] ?? null
    }
  }
  runner.deps = []
  // 挂到 runner 上，trigger 遍历 dep 时会读它
  runner.scheduler = options.scheduler
  runner()
  return runner
}
`,
          test: `{
  const state = reactive({ n: 1 })
  let runs = 0
  const jobs = []
  effect(() => { runs++; state.n }, { scheduler: (eff) => jobs.push(eff) })

  check('注册时仍然立刻执行一次', () => same(runs, 1))
  check('有 scheduler 时，依赖变化不直接执行，而是交给 scheduler', () => {
    state.n = 2
    same(runs, 1)
    same(jobs.length, 1)
  })
  check('scheduler 收到的是 effect 本身，可以直接调用', () => {
    same(typeof jobs[0], 'function')
    jobs[0]()
    same(runs, 2)
    same(state.n, 2)
  })
  check('没传 scheduler 的 effect 仍然同步执行，只传 fn 也不报错', () => {
    const s2 = reactive({ v: 0 })
    let r = 0
    effect(() => { r++; s2.v })
    s2.v = 1
    same(r, 2)
  })
}
`
        },
        {
          n: 3,
          title: '给调用方一个去重队列：queueJob + flushJobs',
          think: '调度权交出去之后，调用方最常写的第一版就是「push 进数组，然后挨个跑」。但同一轮里同一个 effect 可能被触发很多次，数组会把它们全执行一遍。所以补一个最小实现：Set 去重入队，flush 时先拷快照再清空，保证一次刷新里每个 effect 只跑一次。',
          hint: '加一个模块级的 const jobQueue = new Set()；queueJob(job) 里 add，flushJobs() 里先拷贝成数组、clear 队列、再逐个执行。',
          vocab: [
            { term: 'Set 做队列天然去重', md: '同一个 effect 在一轮里被触发多次，add 到 Set 里只留一份；flush 时先拷成数组、再 clear，执行过程中重新入队才不会丢。' }
          ],
          diag: [
            '改三次就跑了三次：scheduler 没有用 queueJob，或者 queueJob 里直接执行了 job。',
            'flush 之后没跑或跑了两次：拷贝、清空、执行这三步的顺序或次数不对。',
            'flush 完之后队列没清空：少了 jobQueue.clear()，下一次变化会被上一次的残留挡住。',
            '两个 effect 只跑了一个：queueJob 里用了 Map 的键或者字符串去重，把不同的函数合并成了一份。'
          ],
          code: `/**
 * 第 8 关 · 第 3 步：最小调度队列
 *
 * queueJob 只入队并去重，不执行；flushJobs 由调用方决定何时调用。
 * 真实框架里 flush 挂在微任务上，这一关交给调用方手动触发。
 */
const targetMap = new WeakMap()
let activeEffect = null
const effectStack = []

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  if (!dep.has(activeEffect)) {
    dep.add(activeEffect)
    if (!activeEffect.deps) activeEffect.deps = []
    activeEffect.deps.push(dep)
  }
}

function cleanupEffect(eff) {
  for (const dep of eff.deps ?? []) dep.delete(eff)
  eff.deps.length = 0
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (!dep) return
  for (const eff of [...dep]) {
    if (eff.scheduler) eff.scheduler(eff)
    else eff()
  }
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const old = t[key]
      const ok = Reflect.set(t, key, value, receiver)
      if (ok && !Object.is(old, value)) trigger(t, key)
      return ok
    }
  })
}

function effect(fn, options = {}) {
  const runner = () => {
    cleanupEffect(runner)
    effectStack.push(runner)
    activeEffect = runner
    try {
      return fn()
    } finally {
      effectStack.pop()
      activeEffect = effectStack[effectStack.length - 1] ?? null
    }
  }
  runner.deps = []
  runner.scheduler = options.scheduler
  runner()
  return runner
}

/**
 * 最小调度队列：Set 保证同一个 effect 在一轮里只排一次。
 * queueJob 只负责排队，什么时候刷新由调用方决定。
 */
const jobQueue = new Set()

function queueJob(job) {
  jobQueue.add(job)
}

function flushJobs() {
  // 先取快照、立刻清空：执行过程中重新入队的 job 留到下一轮
  const jobs = [...jobQueue]
  jobQueue.clear()
  for (const job of jobs) job()
}
`,
          test: `{
  const state = reactive({ v: 0 })
  let runs = 0
  effect(() => { runs++; state.v }, { scheduler: queueJob })

  check('同一轮改三次，只会入队一次', () => {
    state.v = 1
    state.v = 2
    state.v = 3
    same(runs, 1)
    same(jobQueue.size, 1)
  })
  check('flush 之后，effect 才真正执行一次', () => {
    flushJobs()
    same(runs, 2)
    same(state.v, 3)
  })
  check('flush 会清空队列，下一次变化重新入队', () => {
    same(jobQueue.size, 0)
    state.v = 4
    same(jobQueue.size, 1)
    flushJobs()
    same(runs, 3)
  })
  check('两个 effect 各自入队一次，flush 后都执行', () => {
    const s2 = reactive({ x: 0 })
    let a = 0
    let b = 0
    effect(() => { a++; s2.x }, { scheduler: queueJob })
    effect(() => { b++; s2.x }, { scheduler: queueJob })
    s2.x = 1
    same(jobQueue.size, 2)
    flushJobs()
    same(a, 2)
    same(b, 2)
  })
}
`
        }
      ],
      finalCode: `/**
 * 第 8 关 · 调度器：什么时候执行，交给调用方（完整实现）
 *
 * trigger 发现 eff.scheduler 就把 effect 交出去；
 * effect 负责把 options.scheduler 挂到 runner 上；
 * queueJob / flushJobs 是调用方那一侧的最小去重队列。
 */
const targetMap = new WeakMap()
let activeEffect = null
const effectStack = []

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  if (!dep.has(activeEffect)) {
    dep.add(activeEffect)
    if (!activeEffect.deps) activeEffect.deps = []
    activeEffect.deps.push(dep)
  }
}

function cleanupEffect(eff) {
  for (const dep of eff.deps ?? []) dep.delete(eff)
  eff.deps.length = 0
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (!dep) return
  for (const eff of [...dep]) {
    if (eff.scheduler) eff.scheduler(eff)
    else eff()
  }
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const old = t[key]
      const ok = Reflect.set(t, key, value, receiver)
      if (ok && !Object.is(old, value)) trigger(t, key)
      return ok
    }
  })
}

function effect(fn, options = {}) {
  const runner = () => {
    cleanupEffect(runner)
    effectStack.push(runner)
    activeEffect = runner
    try {
      return fn()
    } finally {
      effectStack.pop()
      activeEffect = effectStack[effectStack.length - 1] ?? null
    }
  }
  runner.deps = []
  runner.scheduler = options.scheduler
  runner()
  return runner
}

const jobQueue = new Set()

function queueJob(job) {
  jobQueue.add(job)
}

function flushJobs() {
  const jobs = [...jobQueue]
  jobQueue.clear()
  for (const job of jobs) job()
}
`,
      usage: `// 1) 最直接的用法：把时机交给自己
const state = reactive({ n: 1 })
let runs = 0
const jobs = []

effect(() => { runs++; state.n }, { scheduler: (eff) => jobs.push(eff) })

// 注册时执行一次 → runs = 1
state.n = 2   // 不执行 → runs 还是 1，jobs 里有 1 个待办
jobs[0]()     // 手动执行 → runs = 2

// 2) 配上去重队列：一个 tick 内改多次，只刷新一次
const form = reactive({ a: 0, b: 0 })
let renders = 0
effect(() => { renders++; form.a; form.b }, { scheduler: queueJob })

form.a = 1
form.b = 2
form.a = 3
renders        // 1：还没刷新
flushJobs()
renders        // 2：一次刷新把三次修改合并掉了

// 3) 这就是 nextTick 的雏形：flush 放到微任务里
// Promise.resolve().then(flushJobs)`,
      concepts: [
        {
          title: 'nextTick 就是「把调度接到微任务上」',
          md: 'Vue 的 nextTick 并不神秘：调度器把 job 塞进一个 Set 队列，然后用 Promise.then（微任务）在同步代码结束后统一 flush。浏览器渲染前一定会清空微任务，所以「一个 tick 内改多次、只渲染一次」是这么来的。第 8 关你交出的那个 eff，就是可以放进这个队列的东西。'
        },
        {
          title: '调度之后，「读到旧值」是预期行为',
          md: '被调度的 effect 不会立刻执行，所以这一轮同步代码里读到的还是旧值。这不是 bug，而是用「延迟」换「合并」的代价。理解这一点，就不会在 nextTick 之前去读 DOM。'
        }
      ],
      skeleton: `/**
 * 第 8 关 · 调度器：什么时候执行，交给调用方
 *
 * 现在 trigger 一发现依赖就立刻执行 effect。同一轮改 10 个属性 = 跑 10 次。
 * 这一关把「什么时候跑」变成可选项：effect 传了 scheduler，就交给它决定。
 */

const targetMap = new WeakMap()
let activeEffect = null
const effectStack = []

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  if (!dep.has(activeEffect)) {
    dep.add(activeEffect)
    if (!activeEffect.deps) activeEffect.deps = []
    activeEffect.deps.push(dep)
  }
}

function cleanupEffect(eff) {
  for (const dep of eff.deps ?? []) dep.delete(eff)
  eff.deps.length = 0
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (!dep) return
  for (const eff of [...dep]) {
    // 不管有没有调度器，都直接执行了：时机没有交给调用方
    eff()
  }
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const old = t[key]
      const ok = Reflect.set(t, key, value, receiver)
      if (ok && !Object.is(old, value)) trigger(t, key)
      return ok
    }
  })
}

function effect(fn, options = {}) {
  const runner = () => {
    cleanupEffect(runner)
    effectStack.push(runner)
    activeEffect = runner
    try {
      return fn()
    } finally {
      effectStack.pop()
      activeEffect = effectStack[effectStack.length - 1] ?? null
    }
  }
  runner.deps = []
  // 还没有把 options.scheduler 挂到 runner 上
  runner()
  return runner
}
`,
      solution: `/**
 * 第 8 关 · 调度器：什么时候执行，交给调用方（完整实现）
 *
 * trigger 发现 eff.scheduler 就把 effect 交出去；
 * effect 负责把 options.scheduler 挂到 runner 上；
 * queueJob / flushJobs 是调用方那一侧的最小去重队列。
 */
const targetMap = new WeakMap()
let activeEffect = null
const effectStack = []

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  if (!dep.has(activeEffect)) {
    dep.add(activeEffect)
    if (!activeEffect.deps) activeEffect.deps = []
    activeEffect.deps.push(dep)
  }
}

function cleanupEffect(eff) {
  for (const dep of eff.deps ?? []) dep.delete(eff)
  eff.deps.length = 0
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (!dep) return
  for (const eff of [...dep]) {
    if (eff.scheduler) eff.scheduler(eff)
    else eff()
  }
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const old = t[key]
      const ok = Reflect.set(t, key, value, receiver)
      if (ok && !Object.is(old, value)) trigger(t, key)
      return ok
    }
  })
}

function effect(fn, options = {}) {
  const runner = () => {
    cleanupEffect(runner)
    effectStack.push(runner)
    activeEffect = runner
    try {
      return fn()
    } finally {
      effectStack.pop()
      activeEffect = effectStack[effectStack.length - 1] ?? null
    }
  }
  runner.deps = []
  runner.scheduler = options.scheduler
  runner()
  return runner
}

const jobQueue = new Set()

function queueJob(job) {
  jobQueue.add(job)
}

function flushJobs() {
  const jobs = [...jobQueue]
  jobQueue.clear()
  for (const job of jobs) job()
}
`,
      tests: `const state = reactive({ n: 1 })
let runs = 0
const jobs = []

effect(() => { runs++; state.n }, { scheduler: (eff) => jobs.push(eff) })

check('注册时仍然立刻执行一次', () => same(runs, 1))
check('有 scheduler 时，依赖变化不直接执行', () => { state.n = 2; same(runs, 1); same(jobs.length, 1) })
check('scheduler 拿到的是 effect 本身（可以直接调用）', () => same(typeof jobs[0], 'function'))
check('手动执行 scheduler 交出来的 effect，才真正更新', () => { jobs[0](); same(runs, 2); same(state.n, 2) })
check('没有 scheduler 的 effect 仍然同步执行', () => {
  const s2 = reactive({ v: 0 })
  let r = 0
  effect(() => { r++; s2.v })
  s2.v = 1
  same(r, 2)
})
check('批量修改时，调用方可以把同一个 effect 去重成一条', () => {
  const s3 = reactive({ v: 0 })
  let r = 0
  const q = []
  effect(() => { r++; s3.v }, { scheduler: (eff) => { if (!q.includes(eff)) q.push(eff) } })
  s3.v = 1
  s3.v = 2
  s3.v = 3
  same(q.length, 1)
  same(r, 1)
  q[0]()
  same(r, 2)
})
{
  const s = reactive({ n: 1 })
  let n = 0
  const list = []
  const runner = effect(() => { n++; s.n })
  runner.scheduler = (eff) => list.push(eff)

  check('第 1 步：运行时挂上 scheduler 后，依赖变化不再直接执行', () => {
    s.n = 2
    same(n, 1)
    same(list.length, 1)
  })
  check('第 1 步：交给 scheduler 的是 effect 本身', () => {
    same(typeof list[0], 'function')
  })
  check('第 1 步：手动执行交出来的 effect，才真正更新', () => {
    list[0]()
    same(n, 2)
    same(s.n, 2)
  })
}
{
  const s = reactive({ n: 1 })
  let n = 0
  const list = []
  effect(() => { n++; s.n }, { scheduler: (eff) => list.push(eff) })

  check('第 2 步：注册时仍然立刻执行一次', () => same(n, 1))
  check('第 2 步：有 scheduler 时，依赖变化不直接执行，而是交给 scheduler', () => {
    s.n = 2
    same(n, 1)
    same(list.length, 1)
  })
  check('第 2 步：scheduler 收到的是 effect 本身，可以直接调用', () => {
    same(typeof list[0], 'function')
    list[0]()
    same(n, 2)
    same(s.n, 2)
  })
  check('第 2 步：没传 scheduler 的 effect 仍然同步执行，只传 fn 也不报错', () => {
    const s2 = reactive({ v: 0 })
    let r = 0
    effect(() => { r++; s2.v })
    s2.v = 1
    same(r, 2)
  })
}
{
  const s = reactive({ v: 0 })
  let n = 0
  effect(() => { n++; s.v }, { scheduler: queueJob })

  check('第 3 步：同一轮改三次，只会入队一次', () => {
    s.v = 1
    s.v = 2
    s.v = 3
    same(n, 1)
    same(jobQueue.size, 1)
  })
  check('第 3 步：flush 之后，effect 才真正执行一次', () => {
    flushJobs()
    same(n, 2)
    same(s.v, 3)
  })
  check('第 3 步：flush 会清空队列，下一次变化重新入队', () => {
    same(jobQueue.size, 0)
    s.v = 4
    same(jobQueue.size, 1)
    flushJobs()
    same(n, 3)
  })
  check('第 3 步：两个 effect 各自入队一次，flush 后都执行', () => {
    const s2 = reactive({ x: 0 })
    let a = 0
    let b = 0
    effect(() => { a++; s2.x }, { scheduler: queueJob })
    effect(() => { b++; s2.x }, { scheduler: queueJob })
    s2.x = 1
    same(jobQueue.size, 2)
    flushJobs()
    same(a, 2)
    same(b, 2)
  })
}`
    },
    /* ------------------------------------------------------------ 第 9 关 */
    {
      id: 'lv9',
      title: 'computed：懒计算、缓存、还能被依赖',
      emoji: '💎',
      xp: 80,
      goal: '实现 computed(getter)：第一次读取才算，结果缓存；依赖变了下次读才重算；并且能被 effect 当成依赖。',
      why: '如果每次读 computed 都重算一遍，它只是个语法糖；如果依赖一变就立刻重算，它比直接用函数还慢。computed 的价值在于「既缓存、又精确地知道自己什么时候该失效」——它是这一季所有零件（effect、track、trigger、scheduler、cleanup）的总装。',
      prereq: [
        {
          title: 'computed 身上有两层依赖，方向相反',
          md: `一个 computed 同时扮演两个角色：

- **它读了谁**：getter 里读 state.a、state.b —— 靠 lazy effect 收集，依赖变了它才知道自己该脏。
- **谁读了它**：别的 effect 或 computed 读 sum.value —— 靠 track(this, value) 收集，它变了才知道该通知谁。

少任何一层都会出现「该更新时不更新」：只做第一层，依赖 computed 的 effect 永远收不到通知；只做第二层，computed 永远不知道该重算。`
        },
        {
          title: '脏标记：用一个布尔值代替「算一遍看看」',
          md: `computed 不需要在依赖变化时立刻重算。它只需要记一句「我可能过期了」：

~~~js
this._dirty = true    // 依赖变了 → 标脏
// 下次有人读 value：
if (this._dirty) { this._dirty = false; this._value = 重算() }
return this._value
~~~

这就是「懒计算 + 缓存」：没人读就一次都不算（比如一个不在当前 tab 里的面板）；有人读，也只在下一次读的时候算一次。

关键顺序：**先把 dirty 置回 false，再执行 getter**。反过来的话，getter 内部只要再读到自己一次，就会永远脏、无限递归。`
        }
      ],
      api: [
        {
          name: 'computed',
          sig: 'computed(getter: () => any): { value: any }',
          args: 'getter —— 无参函数，里面读响应式数据并返回一个值。它不会在创建时执行。',
          returns: '一个对象，只有 .value 属性：读它拿到缓存值（必要时重算），写它没有意义（这一关不实现 setter）。',
          example: `const state = reactive({ a: 1, b: 2 })
let computes = 0
const sum = computed(() => { computes++; return state.a + state.b })

computes          // 0 —— 创建时不计算

sum.value         // 3，此时 computes 变成 1
sum.value         // 3，仍然只算过 1 次（缓存）

state.a = 10
computes          // 1 —— 依赖变了，但还没人读，所以不重算
sum.value         // 12，这次读才重算 → computes = 2`
        }
      ],
      nodes: ['fe.vue.reactivity.computed-watch', 'fe.vue.reactivity.effect-dep'],
      thinking: [
        {
          title: '先问「什么时候该算」，再问怎么缓存',
          md: `拿到这一关，我先列了三种可能的实现：每次读都算、依赖一变就算、没人读就不算且脏了才重算。第一种是语法糖、第二种比直接调函数还慢，只有第三种同时拿到了「省计算」和「结果新」。
确定了策略，代码形状才定下来：getter 必须包成 lazy effect（创建时不执行），并且必须有一个 dirty 标记来推迟重算。缓存不是目的，它只是「懒」的副产品；如果一开始就想「我要加个缓存」，很容易写成依赖变了也不更新。`
        },
        {
          title: '为什么先做懒计算，最后才做「通知读过我的人」',
          md: `computed 有两层依赖，我刻意分层做。第一层是「它读了谁」——由 lazy effect 负责，这一层决定它什么时候脏；第二层是「谁读了它」——由 track(this, value) 和 scheduler 里的 trigger 负责，这一层决定别人什么时候被叫醒。
先做第一层，测试能验证「没人读就不算、脏了才重算」；再做第二层，才谈「依赖它的 effect 能自动更新」。反过来的话，第一次读值都算不对，通知得再及时也没有意义。分层推进让每一步的失败现象都很窄。`
        },
        {
          title: '为什么 track(this, value) 必须无条件调用',
          md: `我第一版把 track 写在了 if (this._dirty) 里面，理由是「反正只有重算时值才会变」。结果第二次读同一个 computed 的时候，依赖它的 effect 不再被登记——因为它命中了缓存，没进重算分支。
后来想明白了：登记依赖和算值是两件事。算不算取决于缓存，登不登记取决于「有人在读我」，每次读都必须登记。把这两件事分开之后，代码反而更短：先算（如果需要），再无条件 track，最后返回值。`
        },
        {
          title: 'scheduler 里那个 if (!this._dirty) 是干什么的',
          md: `依赖变化时，computed 的 scheduler 会被调用。如果每次都无脑标脏 + trigger，同一个 tick 里依赖改三次，就会通知下游三次，白白把 effect 叫起来排队。
所以在标脏之前先看自己脏不脏：已经脏了，说明这一轮已经通知过了，直接返回。这个短路还能避免「重算过程中改数据」引发的重复通知。写响应式的时候，这种「状态没变就别再喊」的判断几乎每一层都要有。`
        }
      ],
      stages: [
        {
          n: 1,
          title: '先把 getter 包成懒 effect',
          think: 'computed 的第一步不是缓存，而是「创建时不执行」。这需要 effect 支持 lazy：只把 runner 交出去，不立刻调用。先把这个能力补上，computed 的构造才可能做到「没人读就一次都不算」。',
          hint: '给 effect 的结尾加条件：只有 !options.lazy 时才 runner()；computed 里用 effect(getter, { lazy: true }) 拿到 runner。',
          vocab: [
            { term: 'lazy effect', md: '创建时不执行，只把 runner 交出去，等别人需要时再调。computed 的第一个能力就是「没人读就一次都不算」。' }
          ],
          diag: [
            '创建 computed 时 getter 就跑了：effect 结尾还是无条件 runner()，没有看 options.lazy。',
            '第一次读拿不到值：get value 里没有调用 lazy effect 交回来的那个 runner。',
            'lazy 的 effect 注册时就执行了：runner() 没有放进 !options.lazy 的条件里。',
            '不传 lazy 的 effect 不执行了：条件写反了，变成只有 lazy 才执行。'
          ],
          code: `/**
 * 第 9 关 · 第 1 步：getter 包成 lazy effect
 *
 * effect 增加 lazy 选项：lazy 时只交出 runner，不立刻执行。
 * computed 用它把「什么时候算」的主动权拿在自己手里。
 */
const targetMap = new WeakMap()
let activeEffect = null
const effectStack = []

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  if (!dep.has(activeEffect)) {
    dep.add(activeEffect)
    if (!activeEffect.deps) activeEffect.deps = []
    activeEffect.deps.push(dep)
  }
}

function cleanupEffect(eff) {
  for (const dep of eff.deps ?? []) dep.delete(eff)
  eff.deps.length = 0
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (!dep) return
  for (const eff of [...dep]) {
    if (eff.scheduler) eff.scheduler(eff)
    else eff()
  }
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const old = t[key]
      const ok = Reflect.set(t, key, value, receiver)
      if (ok && !Object.is(old, value)) trigger(t, key)
      return ok
    }
  })
}

function effect(fn, options = {}) {
  const runner = () => {
    cleanupEffect(runner)
    effectStack.push(runner)
    activeEffect = runner
    try {
      return fn()
    } finally {
      effectStack.pop()
      activeEffect = effectStack[effectStack.length - 1] ?? null
    }
  }
  runner.deps = []
  runner.scheduler = options.scheduler
  // lazy 的 effect 不立刻执行：等调用方需要时手动调 runner
  if (!options.lazy) runner()
  return runner
}

const jobQueue = new Set()

function queueJob(job) {
  jobQueue.add(job)
}

function flushJobs() {
  const jobs = [...jobQueue]
  jobQueue.clear()
  for (const job of jobs) job()
}

/**
 * 这一步先只做到「懒」：每次读 value 都手动跑一遍 lazy effect。
 * 缓存和通知是后面两步的事。
 */
class ComputedRefImpl {
  constructor(getter) {
    this._value = undefined
    this.effect = effect(getter, { lazy: true })
  }

  get value() {
    this._value = this.effect()
    return this._value
  }
}

function computed(getter) {
  return new ComputedRefImpl(getter)
}
`,
          test: `{
  const state = reactive({ a: 1, b: 2 })
  let computes = 0
  const sum = computed(() => { computes++; return state.a + state.b })

  check('创建 computed 时不执行 getter', () => same(computes, 0))
  check('第一次读才算，值也对', () => {
    same(sum.value, 3)
    same(computes, 1)
  })
  check('lazy 的 effect 不立刻执行，交回来的 runner 调用才执行', () => {
    let n = 0
    const runner = effect(() => { n++ }, { lazy: true })
    same(n, 0)
    runner()
    same(n, 1)
  })
  check('不传 lazy 的 effect 仍然在注册时立刻执行', () => {
    let n = 0
    effect(() => { n++ })
    same(n, 1)
  })
}
`
        },
        {
          n: 2,
          title: '加脏标记：读过一次就缓存，脏了才重算',
          think: '懒已经做到了，但每次读都算一遍，等于没有缓存。这一步加两个字段：_dirty 表示「结果可能过期」，_value 存上一次的结果；读 value 时只在脏的时候重算。注意先把 dirty 置回 false 再算，否则 getter 里再读到自己会无限递归。',
          hint: '构造函数里加 this._dirty = true 和 this._value = undefined；get value 里写 if (this._dirty) { this._dirty = false; this._value = this.effect() }，最后 return this._value。',
          vocab: [
            { term: '脏标记 _dirty', md: '一个布尔值代替「算一遍看看」：依赖变了只标记「可能过期」，真正重算推迟到下一次读 value 的时候。' }
          ],
          diag: [
            '第一次读没算出值：get value 少了重算分支，或者 dirty 初值写成了 false。',
            '读两次算两次：没有缓存，get value 每次都调 this.effect()。',
            '读很多次仍在重算：dirty 判断写反了，或者算完没有把 dirty 置回 false。'
          ],
          code: `/**
 * 第 9 关 · 第 2 步：脏标记 + 缓存
 *
 * _dirty 为真表示「结果可能过期」，_value 存上一次算出来的值。
 * 读 value：脏了才重算，不脏直接给缓存。
 */
const targetMap = new WeakMap()
let activeEffect = null
const effectStack = []

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  if (!dep.has(activeEffect)) {
    dep.add(activeEffect)
    if (!activeEffect.deps) activeEffect.deps = []
    activeEffect.deps.push(dep)
  }
}

function cleanupEffect(eff) {
  for (const dep of eff.deps ?? []) dep.delete(eff)
  eff.deps.length = 0
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (!dep) return
  for (const eff of [...dep]) {
    if (eff.scheduler) eff.scheduler(eff)
    else eff()
  }
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const old = t[key]
      const ok = Reflect.set(t, key, value, receiver)
      if (ok && !Object.is(old, value)) trigger(t, key)
      return ok
    }
  })
}

function effect(fn, options = {}) {
  const runner = () => {
    cleanupEffect(runner)
    effectStack.push(runner)
    activeEffect = runner
    try {
      return fn()
    } finally {
      effectStack.pop()
      activeEffect = effectStack[effectStack.length - 1] ?? null
    }
  }
  runner.deps = []
  runner.scheduler = options.scheduler
  if (!options.lazy) runner()
  return runner
}

const jobQueue = new Set()

function queueJob(job) {
  jobQueue.add(job)
}

function flushJobs() {
  const jobs = [...jobQueue]
  jobQueue.clear()
  for (const job of jobs) job()
}

class ComputedRefImpl {
  constructor(getter) {
    this._dirty = true
    this._value = undefined
    this.effect = effect(getter, { lazy: true })
  }

  get value() {
    if (this._dirty) {
      // 先置回 false 再算：getter 里如果又读到自己，才不会无限递归
      this._dirty = false
      this._value = this.effect()
    }
    return this._value
  }
}

function computed(getter) {
  return new ComputedRefImpl(getter)
}
`,
          test: `{
  const state = reactive({ a: 1, b: 2 })
  let computes = 0
  const sum = computed(() => { computes++; return state.a + state.b })

  check('第一次读才计算', () => {
    same(sum.value, 3)
    same(computes, 1)
  })
  check('再读一次用缓存，不重算', () => {
    same(sum.value, 3)
    same(sum.value, 3)
    same(computes, 1)
  })
  check('依赖没变时，读多少次都只算一次', () => {
    same(sum.value, 3)
    same(computes, 1)
  })
}
`
        },
        {
          n: 3,
          title: '接上第二层依赖：失效就标脏，并且通知读过我的人',
          think: '第一层依赖（它读了谁）已经在跑了，靠的是懒 effect。这一步补第二层：scheduler 里标脏并 trigger(this, value)，get value 里无条件 track(this, value)。两层都接上，computed 才能真正「既知道自己过期、又让别人知道该重跑」。',
          hint: '构造函数里给 effect 传 scheduler：不脏时先 this._dirty = true 再 trigger(this, "value")；get value 里算完（或不需算）之后无条件 track(this, "value")。',
          vocab: [
            { term: '两层依赖', md: 'computed 既要 track 自己读的 data（靠 lazy effect），又要被读过它的 effect track（track(this, value)）。少一层就有一边永远不更新。' }
          ],
          diag: [
            '依赖变了之后读到的还是旧值：scheduler 没有把 _dirty 置为 true，或者根本没挂 scheduler。',
            '依赖 computed 的 effect 不更新：scheduler 里只标了脏，没有 trigger(this, "value")。',
            'computed 套 computed 不联动：get value 里少了 track(this, "value")，或者 track 只在重算时才调用。',
            '没人读的时候也在重算：scheduler 里直接调了 this.effect()，把懒计算绕过去了。'
          ],
          code: `/**
 * 第 9 关 · 第 3 步：两层依赖合起来
 *
 * 第一层：getter 包成 lazy effect —— 它读了谁，谁变了就进 scheduler。
 * 第二层：scheduler 标脏并 trigger(this, value)，get value 里 track(this, value)。
 */
const targetMap = new WeakMap()
let activeEffect = null
const effectStack = []

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  if (!dep.has(activeEffect)) {
    dep.add(activeEffect)
    if (!activeEffect.deps) activeEffect.deps = []
    activeEffect.deps.push(dep)
  }
}

function cleanupEffect(eff) {
  for (const dep of eff.deps ?? []) dep.delete(eff)
  eff.deps.length = 0
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (!dep) return
  for (const eff of [...dep]) {
    if (eff.scheduler) eff.scheduler(eff)
    else eff()
  }
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const old = t[key]
      const ok = Reflect.set(t, key, value, receiver)
      if (ok && !Object.is(old, value)) trigger(t, key)
      return ok
    }
  })
}

function effect(fn, options = {}) {
  const runner = () => {
    cleanupEffect(runner)
    effectStack.push(runner)
    activeEffect = runner
    try {
      return fn()
    } finally {
      effectStack.pop()
      activeEffect = effectStack[effectStack.length - 1] ?? null
    }
  }
  runner.deps = []
  runner.scheduler = options.scheduler
  if (!options.lazy) runner()
  return runner
}

const jobQueue = new Set()

function queueJob(job) {
  jobQueue.add(job)
}

function flushJobs() {
  const jobs = [...jobQueue]
  jobQueue.clear()
  for (const job of jobs) job()
}

class ComputedRefImpl {
  constructor(getter) {
    this._dirty = true
    this._value = undefined
    this.effect = effect(getter, {
      lazy: true,
      // 第一层依赖变了：只标脏 + 通知读过我的人，绝不在这里重算
      scheduler: () => {
        if (!this._dirty) {
          this._dirty = true
          trigger(this, 'value')
        }
      }
    })
  }

  get value() {
    if (this._dirty) {
      this._dirty = false
      this._value = this.effect()
    }
    // 不管算没算，只要有人读，就登记「谁读了我」
    track(this, 'value')
    return this._value
  }
}

function computed(getter) {
  return new ComputedRefImpl(getter)
}
`,
          test: `{
  const state = reactive({ a: 1, b: 2 })
  let computes = 0
  const sum = computed(() => { computes++; return state.a + state.b })

  check('依赖变了不会立刻重算，下次读才重算', () => {
    same(sum.value, 3)
    state.a = 10
    same(computes, 1)
    same(sum.value, 12)
    same(computes, 2)
  })
  check('computed 能被 effect 依赖：依赖一变，读它的 effect 自动重跑', () => {
    let seen = 0
    effect(() => { seen = sum.value })
    same(seen, 12)
    state.b = 20
    same(seen, 30)
  })
  check('computed 可以依赖 computed', () => {
    const double = computed(() => sum.value * 2)
    same(double.value, 60)
    state.a = 0
    same(double.value, 40)
  })
  check('没人读的时候，依赖变化不会触发重算', () => {
    const s2 = reactive({ n: 1 })
    let c = 0
    const v = computed(() => { c++; return s2.n })
    same(v.value, 1)
    s2.n = 2
    same(c, 1)
  })
}
`
        }
      ],
      finalCode: `/**
 * 第 9 关 · computed：懒计算、缓存、还能被依赖（完整实现）
 *
 * 1) getter 包成 lazy effect：创建时不算
 * 2) _dirty + _value：脏了才重算，不脏给缓存
 * 3) 两层依赖：lazy effect 负责「我读了谁」，track(this, value) 负责「谁读了我」
 */
const targetMap = new WeakMap()
let activeEffect = null
const effectStack = []

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  if (!dep.has(activeEffect)) {
    dep.add(activeEffect)
    if (!activeEffect.deps) activeEffect.deps = []
    activeEffect.deps.push(dep)
  }
}

function cleanupEffect(eff) {
  for (const dep of eff.deps ?? []) dep.delete(eff)
  eff.deps.length = 0
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (!dep) return
  for (const eff of [...dep]) {
    if (eff.scheduler) eff.scheduler(eff)
    else eff()
  }
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const old = t[key]
      const ok = Reflect.set(t, key, value, receiver)
      if (ok && !Object.is(old, value)) trigger(t, key)
      return ok
    }
  })
}

function effect(fn, options = {}) {
  const runner = () => {
    cleanupEffect(runner)
    effectStack.push(runner)
    activeEffect = runner
    try {
      return fn()
    } finally {
      effectStack.pop()
      activeEffect = effectStack[effectStack.length - 1] ?? null
    }
  }
  runner.deps = []
  runner.scheduler = options.scheduler
  if (!options.lazy) runner()
  return runner
}

const jobQueue = new Set()

function queueJob(job) {
  jobQueue.add(job)
}

function flushJobs() {
  const jobs = [...jobQueue]
  jobQueue.clear()
  for (const job of jobs) job()
}

class ComputedRefImpl {
  constructor(getter) {
    this._dirty = true
    this._value = undefined
    this.effect = effect(getter, {
      lazy: true,
      scheduler: () => {
        if (!this._dirty) {
          this._dirty = true
          trigger(this, 'value')
        }
      }
    })
  }

  get value() {
    if (this._dirty) {
      this._dirty = false
      this._value = this.effect()
    }
    track(this, 'value')
    return this._value
  }
}

function computed(getter) {
  return new ComputedRefImpl(getter)
}
`,
      usage: `// 1) 懒 + 缓存：没人读就一次都不算
const state = reactive({ a: 1, b: 2 })
let computes = 0
const sum = computed(() => { computes++; return state.a + state.b })

computes      // 0：创建时不计算
sum.value     // 3，此时 computes = 1
sum.value     // 3，仍然只算过 1 次（缓存）

// 2) 依赖变了：只标脏，不重算
state.a = 10
computes      // 1：还没人读，不重算
sum.value     // 12，这次读才重算 → computes = 2

// 3) 被 effect 依赖：依赖一变，读它的那个函数自动重跑
let seen = 0
effect(() => { seen = sum.value })
state.b = 20
seen          // 30

// 4) computed 叠 computed
const double = computed(() => sum.value * 2)
double.value  // 60
state.a = 0
double.value  // 40`,
      concepts: [
        {
          title: '现在你手上有完整的 Vue3 响应式内核',
          md: '把九关连起来看：Proxy 拦截读写 → track 记账 → trigger 通知 → effect 负责「谁在读」→ 同值判断省掉无效触发 → cleanup 让依赖跟着分支走 → effectStack 让嵌套安全 → scheduler 把时机交出去 → computed 在这一套地基上做缓存。Vue3 的 ref、watch、nextTick、甚至是 v-memo，都是这几个零件的不同组合。'
        },
        {
          title: 'computed 与 ref 的区别',
          md: 'ref 是「可写的响应式格子」，读写直接落到 dep 上；computed 是「由别的数据算出来的格子」，它自己不可写，值由 getter 决定。所以 computed 必须同时管两件事：自己依赖谁、谁依赖它。理解了这两层，再看 Vue 源码里的 ComputedRefImpl 就不会觉得它绕。'
        }
      ],
      skeleton: `/**
 * 第 9 关 · computed：懒计算、缓存、还能被依赖
 *
 * computed 要同时做到三件事：
 * 1) 创建时不计算（可能根本没人读）
 * 2) 读过一次就把结果缓存住
 * 3) 依赖变了，下一次读才重算；并且读过它的 effect 要被通知
 *
 * 它要用到前面所有零件：lazy effect、scheduler、track、trigger。
 */

const targetMap = new WeakMap()
let activeEffect = null
const effectStack = []

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  if (!dep.has(activeEffect)) {
    dep.add(activeEffect)
    if (!activeEffect.deps) activeEffect.deps = []
    activeEffect.deps.push(dep)
  }
}

function cleanupEffect(eff) {
  for (const dep of eff.deps ?? []) dep.delete(eff)
  eff.deps.length = 0
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (!dep) return
  for (const eff of [...dep]) {
    if (eff.scheduler) eff.scheduler(eff)
    else eff()
  }
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const old = t[key]
      const ok = Reflect.set(t, key, value, receiver)
      if (ok && !Object.is(old, value)) trigger(t, key)
      return ok
    }
  })
}

function effect(fn, options = {}) {
  const runner = () => {
    cleanupEffect(runner)
    effectStack.push(runner)
    activeEffect = runner
    try {
      return fn()
    } finally {
      effectStack.pop()
      activeEffect = effectStack[effectStack.length - 1] ?? null
    }
  }
  runner.deps = []
  runner.scheduler = options.scheduler
  // effect 还不认识 lazy：getter 在这里就会被执行一次
  runner()
  return runner
}

const jobQueue = new Set()

function queueJob(job) {
  jobQueue.add(job)
}

function flushJobs() {
  const jobs = [...jobQueue]
  jobQueue.clear()
  for (const job of jobs) job()
}

/**
 * computed 的实现体，目前只搭好了壳：
 * 有 dirty 标记、有 lazy effect，但取值还没实现。
 */
class ComputedRefImpl {
  constructor(getter) {
    this._dirty = true
    this._value = undefined
    this.effect = effect(getter, { lazy: true })
  }

  get value() {
    // 还没实现：脏了要重算、要缓存、要登记「谁读了我」
    throw new Error('computed 的取值还没实现')
  }
}

function computed(getter) {
  return new ComputedRefImpl(getter)
}
`,
      solution: `/**
 * 第 9 关 · computed：懒计算、缓存、还能被依赖（完整实现）
 *
 * 1) getter 包成 lazy effect：创建时不算
 * 2) _dirty + _value：脏了才重算，不脏给缓存
 * 3) 两层依赖：lazy effect 负责「我读了谁」，track(this, value) 负责「谁读了我」
 */
const targetMap = new WeakMap()
let activeEffect = null
const effectStack = []

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  if (!dep.has(activeEffect)) {
    dep.add(activeEffect)
    if (!activeEffect.deps) activeEffect.deps = []
    activeEffect.deps.push(dep)
  }
}

function cleanupEffect(eff) {
  for (const dep of eff.deps ?? []) dep.delete(eff)
  eff.deps.length = 0
}

function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (!dep) return
  for (const eff of [...dep]) {
    if (eff.scheduler) eff.scheduler(eff)
    else eff()
  }
}

function reactive(target) {
  return new Proxy(target, {
    get(t, key, receiver) {
      track(t, key)
      return Reflect.get(t, key, receiver)
    },
    set(t, key, value, receiver) {
      const old = t[key]
      const ok = Reflect.set(t, key, value, receiver)
      if (ok && !Object.is(old, value)) trigger(t, key)
      return ok
    }
  })
}

function effect(fn, options = {}) {
  const runner = () => {
    cleanupEffect(runner)
    effectStack.push(runner)
    activeEffect = runner
    try {
      return fn()
    } finally {
      effectStack.pop()
      activeEffect = effectStack[effectStack.length - 1] ?? null
    }
  }
  runner.deps = []
  runner.scheduler = options.scheduler
  if (!options.lazy) runner()
  return runner
}

const jobQueue = new Set()

function queueJob(job) {
  jobQueue.add(job)
}

function flushJobs() {
  const jobs = [...jobQueue]
  jobQueue.clear()
  for (const job of jobs) job()
}

class ComputedRefImpl {
  constructor(getter) {
    this._dirty = true
    this._value = undefined
    this.effect = effect(getter, {
      lazy: true,
      scheduler: () => {
        if (!this._dirty) {
          this._dirty = true
          trigger(this, 'value')
        }
      }
    })
  }

  get value() {
    if (this._dirty) {
      this._dirty = false
      this._value = this.effect()
    }
    track(this, 'value')
    return this._value
  }
}

function computed(getter) {
  return new ComputedRefImpl(getter)
}
`,
      tests: `const state = reactive({ a: 1, b: 2 })
let computes = 0
const sum = computed(() => { computes++; return state.a + state.b })

check('创建 computed 时并不计算', () => same(computes, 0))
check('第一次读才计算', () => { same(sum.value, 3); same(computes, 1) })
check('第二次读用缓存，不重算', () => { same(sum.value, 3); same(computes, 1) })
check('依赖变了，不会立刻重算；下次读才重算', () => {
  state.a = 10
  same(computes, 1)
  same(sum.value, 12)
  same(computes, 2)
})
check('computed 能被 effect 依赖，跟着更新', () => {
  let seen = 0
  effect(() => { seen = sum.value })
  same(seen, 12)
  state.b = 20
  same(seen, 30)
})
check('computed 可以依赖 computed', () => {
  const double = computed(() => sum.value * 2)
  same(double.value, 60)
  state.a = 0
  same(double.value, 40)
})
{
  const s = reactive({ a: 1, b: 2 })
  let c = 0
  const v = computed(() => { c++; return s.a + s.b })

  check('第 1 步：创建 computed 时不执行 getter', () => same(c, 0))
  check('第 1 步：第一次读才算，值也对', () => {
    same(v.value, 3)
    same(c, 1)
  })
  check('第 1 步：lazy 的 effect 不立刻执行，交回来的 runner 调用才执行', () => {
    let n = 0
    const runner = effect(() => { n++ }, { lazy: true })
    same(n, 0)
    runner()
    same(n, 1)
  })
  check('第 1 步：不传 lazy 的 effect 仍然在注册时立刻执行', () => {
    let n = 0
    effect(() => { n++ })
    same(n, 1)
  })
}
{
  const s = reactive({ a: 1, b: 2 })
  let c = 0
  const v = computed(() => { c++; return s.a + s.b })

  check('第 2 步：第一次读才计算', () => {
    same(v.value, 3)
    same(c, 1)
  })
  check('第 2 步：再读一次用缓存，不重算', () => {
    same(v.value, 3)
    same(v.value, 3)
    same(c, 1)
  })
  check('第 2 步：依赖没变时，读多少次都只算一次', () => {
    same(v.value, 3)
    same(c, 1)
  })
}
{
  const s = reactive({ a: 1, b: 2 })
  let c = 0
  const v = computed(() => { c++; return s.a + s.b })

  check('第 3 步：依赖变了不会立刻重算，下次读才重算', () => {
    same(v.value, 3)
    s.a = 10
    same(c, 1)
    same(v.value, 12)
    same(c, 2)
  })
  check('第 3 步：computed 能被 effect 依赖，依赖一变 effect 自动重跑', () => {
    let seen = 0
    effect(() => { seen = v.value })
    same(seen, 12)
    s.b = 20
    same(seen, 30)
  })
  check('第 3 步：computed 可以依赖 computed', () => {
    const double = computed(() => v.value * 2)
    same(double.value, 60)
    s.a = 0
    same(double.value, 40)
  })
  check('第 3 步：没人读的时候，依赖变化不会触发重算', () => {
    const s2 = reactive({ n: 1 })
    let n = 0
    const v2 = computed(() => { n++; return s2.n })
    same(v2.value, 1)
    s2.n = 2
    same(n, 1)
  })
}`
    }
  ]
}
