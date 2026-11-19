/**
 * 项目闯关内容源：从零读懂 HTTP 报文（后端方向，3 关）
 *
 * 教学顺序刻意做成「先拆请求行 → 再拆请求头 → 最后按路由分发」：
 * 这三步正好对应一次真实请求进入 Node 进程后被逐层拆开的过程。
 * 全部手写，不用 http 模块，是为了让学习者看清「框架帮你做的事」到底长什么样。
 *
 * v3 分步制：每关拆成「写完就能跑测试」的几步，每步都给完整可运行文件。
 * 沙箱里没有 URL / URLSearchParams / require，所以 query 解析全部手写。
 */

/** 把多行文本拼成一段 md：每行一个参数，输出用 \n 连接 */
const md = (...lines) => lines.join('\n')

/* ------------------------------------------------------------ 第 1 关测试 */
const L1S1 = `{
  check('普通 GET：方法、目标、版本各就各位', () => {
    const r = parseRequestLine('GET / HTTP/1.1')
    same(r.method, 'GET')
    same(r.version, 'HTTP/1.1')
    same(r.path, '/')
  })
  check('POST 方法原样透传', () => {
    const r = parseRequestLine('POST /login HTTP/1.1')
    same(r.method, 'POST')
    same(r.path, '/login')
  })
  check('路径里的多个斜杠不被合并', () => {
    same(parseRequestLine('GET /api//users//3 HTTP/1.1').path, '/api//users//3')
  })
  check('行尾带 CRLF 也能解析', () => {
    same(parseRequestLine('GET /x HTTP/1.1\\r\\n').path, '/x')
  })
  check('段数不足时要抛错', () => {
    throws(() => parseRequestLine('GET /'), '少一段 method/target/version，应当抛错')
  })
  check('空行要抛错', () => {
    throws(() => parseRequestLine(''), '空行不可能是合法请求行')
  })
}`

const L1S2 = `{
  check('带 query string 时 path 不含问号后面那截', () => {
    same(parseRequestLine('GET /api/users/3?tab=info HTTP/1.1').path, '/api/users/3')
  })
  check('没有 query 时返回空对象而不是 undefined', () => {
    same(parseRequestLine('GET /plain HTTP/1.1').query, {})
  })
}`

const L1S3 = `{
  check('多个 query 参数都保留', () => {
    same(parseRequestLine('GET /search?q=http&page=2 HTTP/1.1').query, {
      q: 'http', page: '2'
    })
  })
  check('值里带等号只按第一个等号切', () => {
    same(parseRequestLine('GET /x?a=b=c HTTP/1.1').query, { a: 'b=c' })
  })
  check('只有键没有值时值为空字符串', () => {
    same(parseRequestLine('GET /x?flag HTTP/1.1').query, { flag: '' })
  })
  check('query 里的 + 解码成空格，百分号编码被还原', () => {
    same(parseRequestLine('GET /x?name=%E4%B8%AD&q=a+b HTTP/1.1').query, {
      name: '中', q: 'a b'
    })
  })
}`

/* ------------------------------------------------------------ 第 2 关测试 */
const L2S1 = `{
  check('基本请求头：值里的冒号全部保留', () => {
    same(parseHeaders(['x-trace: a:b:c', 'date: 12:30:00']), {
      'x-trace': 'a:b:c', date: '12:30:00'
    })
  })
  check('值两边的空白被 trim 掉', () => {
    same(parseHeaders(['x-pad:   v  ']), { 'x-pad': 'v' })
  })
  check('空值保留为空字符串而不是丢掉', () => {
    same(parseHeaders(['x-empty:', 'x-blank:   ']), {
      'x-empty': '', 'x-blank': ''
    })
  })
}`

const L2S2 = `{
  check('名字归一为小写', () => {
    same(parseHeaders(['Host: example.com', 'Content-Type: application/json']), {
      host: 'example.com', 'content-type': 'application/json'
    })
  })
  check('全大写的头名也是同一个键', () => {
    same(parseHeaders(['HOST: h', 'X-CUSTOM-Header: v']), {
      host: 'h', 'x-custom-header': 'v'
    })
  })
  check('同名头后一个覆盖前一个（大小写不同也算同名）', () => {
    same(parseHeaders(['Accept: a', 'accept: b', 'ACCEPT: c']), { accept: 'c' })
  })
  check('没有冒号的畸形行被跳过，不影响其他头', () => {
    same(parseHeaders(['Host: a', 'this line has no colon', '', '   ', 'X-Ok: 1']), {
      host: 'a', 'x-ok': '1'
    })
  })
  check('名字为空的行被跳过', () => {
    same(parseHeaders([': value', '  :  v2', 'Host: a']), { host: 'a' })
  })
  check('空数组返回空对象', () => {
    same(parseHeaders([]), {})
  })
}`

/* ------------------------------------------------------------ 第 3 关测试 */
const L3S1 = `{
  check('静态路由命中，params 是空对象', () => {
    const h = () => 'users'
    const router = createRouter({ 'GET /users': h })
    const m = router('GET', '/users')
    ok(m !== null, '应当命中 /users')
    ok(m.handler === h, 'handler 应当就是注册的那个函数')
    same(m.params, {})
  })
  check('根路径 / 也能命中', () => {
    const h = () => 'root'
    const router = createRouter({ 'GET /': h })
    ok(router('GET', '/').handler === h, '/ 应当命中根路由')
  })
  check('方法不匹配返回 null', () => {
    const router = createRouter({ 'GET /users': () => {} })
    same(router('POST', '/users'), null)
    same(router('DELETE', '/users'), null)
  })
  check('路径未命中返回 null', () => {
    const router = createRouter({ 'GET /users': () => {} })
    same(router('GET', '/nope'), null)
  })
  check('段数不等就是不匹配', () => {
    const router = createRouter({ 'GET /users': () => {} })
    same(router('GET', '/users/42/extra'), null)
    same(router('GET', '/user'), null)
  })
  check('方法比较前统一大写', () => {
    const h = () => 'x'
    const router = createRouter({ 'get /ping': h })
    ok(router('GET', '/ping').handler === h, '路由表里的小写方法也应当能命中')
  })
}`

const L3S2 = `{
  check('动态段把值收进 params', () => {
    const h = (params) => 'user ' + params.id
    const router = createRouter({ 'GET /users/:id': h })
    const m = router('GET', '/users/42')
    ok(m.handler === h, '应当命中动态路由')
    same(m.params, { id: '42' })
  })
  check('多个动态段各自取值', () => {
    const router = createRouter({ 'GET /users/:uid/posts/:pid': () => {} })
    const m = router('GET', '/users/7/posts/9')
    same(m.params, { uid: '7', pid: '9' })
  })
}`

const L3S3 = `{
  check('带 query 的 path 先剥掉 query 再匹配', () => {
    const router = createRouter({ 'GET /users/:id': () => {} })
    const m = router('GET', '/users/42?tab=info&page=2')
    ok(m !== null, '带 query 也应当命中')
    same(m.params, { id: '42' })
  })
}`

const L3S4 = `{
  check('静态段优先于动态段（即使动态先注册）', () => {
    const dynamic = () => 'dynamic'
    const fixed = () => 'fixed'
    const router = createRouter({
      'GET /users/:id': dynamic,
      'GET /users/me': fixed
    })
    ok(router('GET', '/users/me').handler === fixed, '/users/me 应当走静态路由')
    ok(router('GET', '/users/42').handler === dynamic, '/users/42 应当走动态路由')
  })
}`

/** 第 1 关完整实现 */
const LINE_FINAL = `function parseRequestLine(line) {
  const parts = String(line).trim().split(' ')
  if (parts.length !== 3) throw new Error('请求行格式错误：' + line)
  const [method, target, version] = parts

  const mark = target.indexOf('?')
  const path = mark === -1 ? target : target.slice(0, mark)
  const queryText = mark === -1 ? '' : target.slice(mark + 1)

  const query = {}
  for (const pair of queryText.split('&')) {
    if (!pair) continue
    const eq = pair.indexOf('=')
    const rawKey = eq === -1 ? pair : pair.slice(0, eq)
    const rawVal = eq === -1 ? '' : pair.slice(eq + 1)
    const key = decodeURIComponent(rawKey.replace(/\\+/g, ' '))
    query[key] = decodeURIComponent(rawVal.replace(/\\+/g, ' '))
  }

  return { method, path, version, query }
}
`

/** 第 2 关完整实现 */
const HEADERS_FINAL = `function parseRequestLine(line) {
  const parts = String(line).trim().split(' ')
  if (parts.length !== 3) throw new Error('请求行格式错误：' + line)
  const [method, target, version] = parts

  const mark = target.indexOf('?')
  const path = mark === -1 ? target : target.slice(0, mark)
  const queryText = mark === -1 ? '' : target.slice(mark + 1)

  const query = {}
  for (const pair of queryText.split('&')) {
    if (!pair) continue
    const eq = pair.indexOf('=')
    const rawKey = eq === -1 ? pair : pair.slice(0, eq)
    const rawVal = eq === -1 ? '' : pair.slice(eq + 1)
    const key = decodeURIComponent(rawKey.replace(/\\+/g, ' '))
    query[key] = decodeURIComponent(rawVal.replace(/\\+/g, ' '))
  }

  return { method, path, version, query }
}

function parseHeaders(lines) {
  const out = {}
  for (const line of lines) {
    const i = line.indexOf(':')
    if (i === -1) continue

    const name = line.slice(0, i).trim().toLowerCase()
    if (!name) continue

    out[name] = line.slice(i + 1).trim()
  }
  return out
}
`

/** 第 3 关完整实现 */
const ROUTER_FINAL = HEADERS_FINAL + `
function createRouter(routes) {
  const table = []
  for (const key of Object.keys(routes)) {
    const space = key.indexOf(' ')
    const method = key.slice(0, space).trim().toUpperCase()
    const pattern = key.slice(space + 1).trim()
    const segments = pattern.split('/')
    let dynamic = 0
    for (const seg of segments) if (seg.charAt(0) === ':') dynamic++
    table.push({ method, segments, dynamic, handler: routes[key] })
  }

  return function match(method, path) {
    const q = path.indexOf('?')
    const pathOnly = q === -1 ? path : path.slice(0, q)
    const reqSegs = pathOnly.split('/')
    const want = String(method).toUpperCase()

    let best = null
    for (const route of table) {
      if (route.method !== want) continue
      if (route.segments.length !== reqSegs.length) continue

      const params = {}
      let matched = true
      for (let i = 0; i < route.segments.length; i++) {
        const p = route.segments[i]
        if (p.charAt(0) === ':') params[p.slice(1)] = reqSegs[i]
        else if (p !== reqSegs[i]) { matched = false; break }
      }
      if (!matched) continue

      if (!best || route.dynamic < best.dynamic) {
        best = { handler: route.handler, params, dynamic: route.dynamic }
      }
    }
    return best ? { handler: best.handler, params: best.params } : null
  }
}
`

export default {
  id: 'http-server',
  version: 3,
  domain: 'be',
  title: '从零读懂 HTTP 报文',
  emoji: '🌐',
  tagline: '3 关：把一行原始请求拆成方法/路径/头，再按路由分发。',
  stack: ['Node.js', 'HTTP'],
  intro: '浏览器发出一次请求，网络那头收到的其实只是一段纯文本：一行请求行、若干行请求头、一个空行、再跟一坨 body。这三关不调用任何框架，亲手把这段文本拆成程序能用的结构。',
  outcome: '做完三关，你能解释「GET /users/3?tab=info HTTP/1.1」这行字是怎么变成一次函数调用的：谁决定了方法、谁去掉了 query、谁把 /users/:id 匹配到真正的处理函数。以后读 Express/Koa 的源码时，你会认出里面每一段在干什么。',
  levels: [
    {
      id: 'lv1',
      title: '解析请求行',
      emoji: '📨',
      xp: 40,
      goal: '把一行「方法 + 目标 + 版本」的原始文本，拆成 { method, path, version, query } 四件套。',
      why: '服务器拿到的第一手数据是一串字符，不是对象。如果直接把这串字符往下传，后面每一处逻辑都要重新做一次字符串切割，切错一次就是 404，或者把 query 当成路径的一部分。只在入口处解析一次、之后全部用结构化字段，是后面所有路由、鉴权、日志能写下去的前提。',
      thinking: [
        {
          title: '先问「入口该交出什么结构」，再问怎么切',
          md: `拿到一串请求行，我第一反应不是 split，而是问：下游到底需要哪几样东西？

答案是四样：**方法**（决定语义）、**路径**（决定路由）、**版本**（决定协议行为）、**query**（决定参数）。这四样一旦被拆开存好，后面每一层都不用再碰原始字符串。

所以第一步先把「方法/目标/版本」切出来并校验段数，第二步才处理 target 里「问号前后是两种东西」这件事。顺序错了，就会写出「路径里带着 ?tab=info」这种脏数据，路由永远匹配不上。`
        },
        {
          title: '为什么必须抛错，而不是返回 undefined',
          md: `入口函数面对的是不可信输入：空行、被代理截断的半行、扫描器发来的垃圾。如果这时返回 undefined，错误会一路漂到路由层才炸，堆栈里看不出是哪一行坏数据。

约定「段数不是 3 就 throw，并把原始行写进错误信息」：上游 catch 住可以回 400，日志里也能看到坏在哪一行。错误在边界处当场暴露，是解析层最重要的责任。`
        },
        {
          title: '为什么 query 解析要手写（而不是用 URLSearchParams）',
          md: `真实项目里直接 new URLSearchParams 就完了。但这一关的沙箱只给语言内置，没有 URL / URLSearchParams——正好逼你看清它替我们挡了哪三个坑：

1) 一对键值只能按**第一个** = 切（值里可能还有 =）；
2) 值里的 + 在 query 语境下代表空格（表单提交的历史包袱）；
3) 中文是百分号编码，要 decodeURIComponent 还原。

知道这三个坑，你以后用 URLSearchParams 才知道它为什么能「一步做对」。`
        }
      ],
      prereq: [
        {
          title: 'HTTP 请求行就是三块文本，用一个空格隔开',
          md: md(
            '一次 HTTP/1.1 请求的第一行叫「请求行」，格式固定为：方法 + 空格 + 目标 + 空格 + 协议版本：',
            '```text',
            'GET /api/users/3?tab=info HTTP/1.1',
            '```',
            '从左到右：方法 GET（要做哪种操作）、目标 /api/users/3?tab=info（要访问哪个资源）、版本 HTTP/1.1。解析第一步非常机械：按空格切一刀，应该正好三段。',
            '切之前先 line.trim()：从网络读到的行尾常常带 \\r\\n，不 trim 的话版本会变成 "HTTP/1.1\\r"。',
            '注意用单个空格 split，而不是正则 \\s+：请求行里只允许单空格，多空格本身就是畸形报文，该抛错而不是被悄悄容忍。'
          )
        },
        {
          title: 'query string 不是路径：问号后面的一切都要单独摘出来',
          md: md(
            '目标里问号后面的部分叫 query string，形如 ?tab=info&page=2。它不属于 path：/users/3 和 /users/3?tab=info 应该路由到同一个处理函数。',
            '切法只有一个正确姿势：先 indexOf(\'?\') 找**第一个**问号，再 slice 两刀。不要 split(\'?\')——值里也可能出现问号，全切会把后面当成第二个元素。',
            '```js',
            "const mark = target.indexOf('?')",
            "const path = mark === -1 ? target : target.slice(0, mark)",
            "const qs   = mark === -1 ? '' : target.slice(mark + 1)",
            '```'
          )
        }
      ],
      api: [
        {
          name: 'parseRequestLine',
          sig: 'parseRequestLine(line: string): { method: string, path: string, version: string, query: Record<string, string> }',
          args: 'line —— 一整行请求行文本，允许行尾带 \\r\\n（函数内部 trim）。若按空格切不出三段，抛 Error。',
          returns: '四个字段：method 原始方法名；path 不含 query；version 原样保留；query 是普通对象，没有 query 时给 {}，绝不返回 undefined。',
          example: md(
            "parseRequestLine('GET /api/users/3?tab=info HTTP/1.1')",
            "// { method: 'GET', path: '/api/users/3', version: 'HTTP/1.1', query: { tab: 'info' } }",
            '',
            "parseRequestLine('POST /login HTTP/1.1')",
            "// { method: 'POST', path: '/login', version: 'HTTP/1.1', query: {} }"
          )
        }
      ],
      stages: [
        {
          n: 1,
          title: '切成三段，段数不对就抛错',
          think: '先只做最机械的一层：trim、按空格切、校验长度、解构。这一步故意先不拆 path/query——先把「输入可不可信」这个边界立起来，后面切错才有可能被立刻发现。',
          hint: '先 line.trim()，再 const parts = line.split(\' \')。紧接着 if (parts.length !== 3) throw new Error(\'请求行格式错误：\' + line)，通过后 const [method, target, version] = parts，返回 { method, target, version }。',
          diag: [
            '段数校验没做：split 之后必须检查 length === 3，否则解构会拿到 undefined。',
            '行尾 \\r 没去掉：切之前先 trim()，否则版本会带 \\r。',
            'POST 方法被改写了：方法原样返回，不要 toUpperCase（那是路由层的事）。',
            '多个斜杠被合并了：不要用 split(\'/\').filter(Boolean)，原样保留 target。',
            'CRLF 用例红：说明 trim 没生效，检查是不是先 split 后 trim。',
            '该抛错的地方没抛：段数不足/空行都必须 throw，测试用 throws 断言。'
          ],
          vocab: [
            { term: '请求行', md: 'HTTP/1.x 报文的第一行，格式为「方法 目标 版本」，用单空格分隔。' }
          ],
          code: `/**
 * 第 1 关 · 第 1 步：切成三段并校验
 */
function parseRequestLine(line) {
  const parts = String(line).trim().split(' ')
  if (parts.length !== 3) throw new Error('请求行格式错误：' + line)
  const [method, target, version] = parts
  return { method, path: target, version, query: {} }
}
`,
          test: L1S1
        },
        {
          n: 2,
          title: '拆 path 与 query 串',
          think: '现在处理「目标里问号前后是两种东西」。这一步只切、不解析 query——先把边界切干净，最后一步再逐对解析。验收看两件事：path 不含问号后面那截；没有 query 时给空对象而不是 undefined。',
          hint: 'mark = target.indexOf(\'?\')；mark === -1 时 path = target、queryText = \'\'；否则 path = target.slice(0, mark)、queryText = target.slice(mark + 1)。返回 { method, path, version, query: {} }。',
          diag: [
            'path 里还带着 ?tab=info：要用 indexOf + slice 切，不要拿 target 直接当 path。',
            '用了 split(\'?\') 全切：值里还有问号时会切碎，必须只认第一个问号。',
          ],
          code: `/**
 * 第 1 关 · 第 2 步：拆出 path 和 query 串
 */
function parseRequestLine(line) {
  const parts = String(line).trim().split(' ')
  if (parts.length !== 3) throw new Error('请求行格式错误：' + line)
  const [method, target, version] = parts

  const mark = target.indexOf('?')
  const path = mark === -1 ? target : target.slice(0, mark)
  const queryText = mark === -1 ? '' : target.slice(mark + 1)

  return { method, path, version, query: {} }
}
`,
          test: L1S2
        },
        {
          n: 3,
          title: '逐对解析 query 串',
          think: '最后把 query 串变成对象。这里全是边界：空 pair、只有键没有值、值里带等号、+ 代表空格、百分号编码。四个坑一口气处理掉，每一条都有测试。',
          hint: '先 const query = {}。queryText.split(\'&\') 遍历，空串 continue；每对用 indexOf(\'=\') 找第一个等号；键和值都先 replace(/\\+/g, \' \') 再 decodeURIComponent；最后 query[key] = value。',
          diag: [
            '多个参数只保留了一个：遍历 queryText.split(\'&\')，每个 pair 都要处理。',
            '值里的 = 被切碎：用 indexOf(\'=\') 只切第一个等号，不要 split(\'=\')。',
            '只有键的参数变成 undefined：等号为 -1 时值给空字符串。',
            '+ 没有还原成空格：decode 之前先 replace(/\\+/g, \' \')。',
          ],
          vocab: [
            { term: '百分号编码', md: 'URL 里非 ASCII 字符会被编码成 %XX。decodeURIComponent 负责还原。' },
            { term: '+ 的历史包袱', md: 'query 语境里 + 代表空格（来自表单提交的 application/x-www-form-urlencoded），所以解码前要先把 + 换成空格。' }
          ],
          code: LINE_FINAL,
          test: L1S3
        }
      ],
      finalCode: LINE_FINAL,
      usage: `const { method, path, version, query } = parseRequestLine(
  'GET /api/users/3?tab=info&page=2 HTTP/1.1'
)
// method: 'GET'
// path:   '/api/users/3'
// query:  { tab: 'info', page: '2' }

// 路由只认 path，参数从 query 里取
if (method === 'GET' && path === '/api/users/3') {
  console.log('第', query.page, '页', query.tab)
}`,
      hints: [
        '卡在切三段：先 console.log(line.trim().split(\' \')) 看看切出来几段，多半是行尾有 \\r。',
        '测试说「期望 {}，实际 undefined」：return 时漏了 query 字段，或者 query 变量还没定义。',
        '路径里的 // 被合并了：不要用 split(\'/\').filter(Boolean)，那会把双斜杠吃掉；这里用 slice 原样保留。',
        '值里带 = 时结果被切碎：用了 split(\'=\') 全切，改成 indexOf(\'=\') 只切第一个。',
        '中文 query 变成 %E4%B8%AD：漏了 decodeURIComponent。'
      ],
      concepts: [
        {
          title: '通关后复盘：解析只做一次，之后都用结构体',
          md: md(
            '你刚写下的是整条链路的入口。真实框架里这段逻辑在 node:http 的解析器里，C++ 层拆完才回调你的 (req, res) => {}；req.method 和 req.url 就是这里的 method 和 target。',
            '一个值得记住的取舍：path 和 query 必须分开存。如果把 "/users/3?tab=info" 整串当路径去匹配，那么同一路由带不同参数就会被当成不同路由，缓存、日志、限流全部对不上号。'
          )
        }
      ],
      skeleton: `/**
 * 解析一行 HTTP 请求行。
 * @param {string} line 形如 'GET /api/users/3?tab=info HTTP/1.1'
 * @returns {{ method: string, path: string, version: string, query: Record<string, string> }}
 */
function parseRequestLine(line) {
  // TODO 1：line.trim() 后按空格切成三段，段数不是 3 就抛错
  // TODO 2：用 indexOf('?') 找到问号，切出 path 与 query 串
  // TODO 3：逐对解析 query 串，组装 { method, path, version, query } 返回
  throw new Error('TODO 1 未实现：先把请求行切成三段')
}
`,
      solution: LINE_FINAL,
      tests: [L1S1, L1S2, L1S3].join('\n\n')
    },
    {
      id: 'lv2',
      title: '解析请求头',
      emoji: '🏷️',
      xp: 50,
      goal: '把若干行 "Name: value" 文本读成一个键统一小写、能直接 headers[\'host\'] 取值的对象。',
      why: '请求行只告诉你要访问哪个资源，真正决定这次请求怎么处理的信息几乎都在头里：Content-Type 决定 body 怎么解、Authorization 决定你是谁、Host 决定虚拟主机路由到哪个站点。如果头解析得随意——大小写不统一、值里带冒号就切坏、空值被当成不存在——鉴权和缓存就会出现「本地好好的、线上一半请求失败」这种最难查的 bug。',
      thinking: [
        {
          title: '为什么要在入口做「归一化」',
          md: `请求头最烦人的地方是它明明叫一个名字，却可以有无数种写法：Host / host / HOST 都是同一个头，协议明确规定字段名不区分大小写。

如果原样当键存，下游就得写 \`headers['Host'] || headers['host'] || ...\`。所以正确的做法是在解析层一次性归一：**名字转小写，值只 trim**。值不能 toLowerCase——Bearer token、application/JSON 里的大小写是有意义的。

这条「在边界处归一」的原则，比这个函数本身更值钱。`
        },
        {
          title: '为什么只认第一个冒号',
          md: `值里出现冒号太常见了：\`Location: http://example.com/a\`、\`Date: 12:30:00\`。用 split(\':\') 全切，一行会碎成一堆片段，怎么拼都是猜。

正确姿势是先 indexOf(\':\') 找位置，再 slice 两刀——第一个冒号左边是名字，右边全部是值。一步之差，决定这个解析器能不能处理真实报文。`
        },
        {
          title: '为什么畸形行要跳过而不是抛错',
          md: `头段落里可能混进被折叠的续行、代理塞的垃圾字节、空行。这些行不该让整个请求 500——但也不能 break 掉循环，因为后面还有正常头。

正确动作是 continue：跳过这一行，继续读下一行。同时「名字为空」要单独判断（": value" 这种情况），否则对象里会多一个空键，后面按名取值时容易踩坑。`
        }
      ],
      prereq: [
        {
          title: '头名不区分大小写，所以统一存小写',
          md: md(
            '请求头一行一条，形状是「名字 + 冒号 + 值」：',
            '```text',
            'Host: example.com',
            'Content-Type: application/json',
            '```',
            'HTTP/1.1 规范明确规定：字段名不区分大小写。注意只有「名字」归一，值不要动：值区分大小写。',
            '```js',
            "const name = line.slice(0, i).trim().toLowerCase()  // 键归一",
            'const value = line.slice(i + 1).trim()              // 值原样，只去空白',
            '```'
          )
        },
        {
          title: '只能按第一个冒号切，且值可以是空字符串',
          md: md(
            '值里出现冒号非常常见：X-Trace: a:b、Date: 12:30:00、Location: http://example.com/a。用 split(\':\') 全切，一行会碎成一堆。',
            '正确做法是先找位置再切：indexOf(\':\') 只返回第一个冒号。',
            '两边都要 trim：协议允许「Host:example.com」，也允许「Host:   example.com」。',
            '值 trim 之后可能是空字符串（"X-Empty:"），这是合法的头，必须存成 \'\'，不能丢掉。'
          )
        }
      ],
      api: [
        {
          name: 'parseHeaders',
          sig: 'parseHeaders(lines: string[]): Record<string, string>',
          args: 'lines —— 请求头段落按行切好的字符串数组。可能混入空行、没有冒号的行。',
          returns: '普通对象：键是头名 toLowerCase 的结果，值是冒号右边 trim 后的原样字符串。空值保留 \'\'。同名头后一个覆盖前一个。非法行跳过不抛错。空数组返回 {}。',
          example: md(
            "parseHeaders(['Host: example.com', 'X-Trace: a:b'])",
            "// { host: 'example.com', 'x-trace': 'a:b' }",
            '',
            "parseHeaders(['Accept: a', 'accept: b'])",
            "// { accept: 'b' }   大小写不同也算同一个头，后一个赢"
          )
        }
      ],
      stages: [
        {
          n: 1,
          title: '基本解析：切第一个冒号、归一名字、去空白',
          think: '先只处理「合法头」。关键是三行：找第一个冒号、名字 trim + 小写、值只 trim。先不做跳过畸形行——那样会把「切分」和「容错」混在一起。',
          hint: 'const out = {}；for (const line of lines) { const i = line.indexOf(\':\'); const name = line.slice(0, i).trim().toLowerCase(); const value = line.slice(i + 1).trim(); out[name] = value }；最后 return out。',
          diag: [
            '值里的冒号被切掉了：必须用 indexOf(\':\') 找第一个冒号再 slice 两刀。',
            '值两边空白没去掉：值要 trim，但不要 toLowerCase。',
            '空值被丢掉了：trim 后是空串也要存 \'\'，不能因为「看起来没内容」跳过。'
          ],
          code: `/**
 * 第 2 关 · 第 1 步：合法头的基本解析
 */
function parseHeaders(lines) {
  const out = {}
  for (const line of lines) {
    const i = line.indexOf(':')
    const name = line.slice(0, i).trim().toLowerCase()
    const value = line.slice(i + 1).trim()
    out[name] = value
  }
  return out
}
`,
          test: L2S1
        },
        {
          n: 2,
          title: '跳过畸形行、合并重复头、处理空输入',
          think: '现在补容错：没有冒号的行、名字为空的行都要 continue；同名头靠「后写覆盖」自然合并；空数组要返回 {}。这里没有新算法，全是对「真实报文有脏数据」的防御。',
          hint: '在循环里先 if (i === -1) continue；名字算出后 if (!name) continue；其余照旧赋值（重复键自然覆盖）；空数组不特判。',
          diag: [
            '归一没生效：名字必须 trim().toLowerCase()，全大写同名头才会合并成同一个键。',
            '全大写没有归到同一个键：HOST 与 host 大小写不同，解析时必须统一 toLowerCase。',
            '同名头没合并：out[name] = value 本身就是覆盖，别额外 push 成数组。',
            '没有冒号的行被当成头：i === -1 时直接 continue。',
            '出现空键：名字为空（": value"）要 continue，不能存进对象。',
            '空数组报错：lines 为空时循环不执行，最后返回 {}。'
          ],
          code: HEADERS_FINAL,
          test: L2S2
        }
      ],
      finalCode: HEADERS_FINAL,
      usage: `const headers = parseHeaders([
  'Host: example.com',
  'Content-Type: application/json',
  'Authorization: Bearer abc',
  'Accept: a',
  'accept: b'
])

headers['host']            // 'example.com'
headers['content-type']    // 'application/json'
headers['accept']          // 'b'（后一个覆盖）

// 下游可以放心地只写小写键
if (headers['content-type'] === 'application/json') {
  // 按 JSON 解析 body
}`,
      hints: [
        '取不到 headers[\'host\']：名字忘了 toLowerCase，客户端发的是 Host。',
        '值只剩最后一个字符：用了 split(\':\') 全切，改成 indexOf + slice。',
        '出现空键 \'\'：漏了 if (!name) continue。',
        '空值的头不见了：把空字符串当成假值跳过了，注意空值要保留。',
        '遍历时抛错中断：用了 throw 处理畸形行，这里应该 continue。'
      ],
      concepts: [
        {
          title: '通关后复盘：归一化发生在边界',
          md: md(
            '这一关真正的知识点不是「切字符串」，而是「在边界处归一化」。大小写差异、空格、空值、重复，全都在进口处一次性处理干净，下游代码就永远不用再怀疑 headers 的键长什么样。',
            '真实框架里这一步对应的就是 Node 的 req.headers：它返回的键全部是小写，重复的某些头（set-cookie）给你数组，其余用逗号合并。'
          )
        }
      ],
      skeleton: `function parseRequestLine(line) {
  const parts = String(line).trim().split(' ')
  if (parts.length !== 3) throw new Error('请求行格式错误：' + line)
  const [method, target, version] = parts
  const mark = target.indexOf('?')
  const path = mark === -1 ? target : target.slice(0, mark)
  const queryText = mark === -1 ? '' : target.slice(mark + 1)
  const query = {}
  for (const pair of queryText.split('&')) {
    if (!pair) continue
    const eq = pair.indexOf('=')
    const rawKey = eq === -1 ? pair : pair.slice(0, eq)
    const rawVal = eq === -1 ? '' : pair.slice(eq + 1)
    query[decodeURIComponent(rawKey.replace(/\\+/g, ' '))] = decodeURIComponent(rawVal.replace(/\\+/g, ' '))
  }
  return { method, path, version, query }
}

/**
 * 解析请求头段落。
 * @param {string[]} lines 每项形如 'Host: example.com'
 * @returns {Record<string, string>} 键统一小写
 */
function parseHeaders(lines) {
  // TODO 1：const out = {}，for...of 逐行遍历
  // TODO 2：line.indexOf(':')，为 -1 就 continue 跳过非法行
  // TODO 3：name = 左边 trim + toLowerCase，value = 右边 trim，
  //         空名 continue，out[name] = value，最后 return out
  throw new Error('TODO 1 未实现：先建一个空对象，把每一行都过一遍')
}
`,
      solution: HEADERS_FINAL,
      tests: [L2S1, L2S2].join('\n\n')
    },
    {
      id: 'lv3',
      title: '路由分发',
      emoji: '🧭',
      xp: 60,
      goal: '把「方法 + 路径模式」的路由表编译成匹配器：传入方法和路径，拿回 handler 与 params。',
      why: '请求行和请求头解析完，你还只是一个「能读懂请求的服务器」，还不知道该由哪段业务代码处理它。路由就是这张分发表：它在几十条规则里找出唯一命中的那条，并把 /users/42 里的 42 取出来交给处理函数。这段逻辑写错，症状是「这个接口明明注册了却 404」，或者更糟——两个路由抢同一个路径，线上随机走错分支。',
      thinking: [
        {
          title: '为什么路由不能拿整串字符串比较',
          md: `注册时写的是模式 \`/users/:id\`，请求时拿到的是 \`/users/42\`，两者不相等。如果只会===，你就得给每个 id 注册一条路由——不可能。

所以路由的本质是「按段相等 + 动态段捕获」：把模式和路径都按 / 切成段数组，长度一致才比较，逐段判断这一段是字面量还是参数。想到这一层，整个实现就变成两层循环。`
        },
        {
          title: '为什么必须先编译成表，再匹配',
          md: `路由表在启动时就固定了。每个键都要做的「找空格、拆方法、切段、数动态段」是纯静态计算，没必要每次请求都做一遍。

所以 createRouter 分成两段：启动时编译成 table，请求时只做匹配。这不是性能炫技，而是把「注册期」和「请求期」的责任分开——匹配函数因此短到只有十几行。`
        },
        {
          title: '为什么静态段要赢动态段',
          md: `GET /users/:id 和 GET /users/me 都能匹配 /users/me。如果不做优先级，先注册的那条赢——而 :id 通常是先注册的，于是「当前用户」那条路由永远进不去。

框架的共识是「更具体的赢」：动态段越少越具体。实现上就是收集所有候选、挑 dynamic 最小的那条，同分时保留先注册的。这也解释了为什么不能「找到第一条命中就 return」。`
        }
      ],
      prereq: [
        {
          title: '路由是「方法 + 路径模式」的查表，不能整串比较',
          md: md(
            '注册路由时你写的是模式（pattern），收到请求时拿到的是具体路径。两者往往不相等：',
            '```js',
            "routes['GET /users/:id']   // 注册时的模式",
            "'/users/42'                // 请求时的真实路径",
            '```',
            '路由的核心不是字符串相等，而是「按段相等 + 动态段捕获」：把模式按 / 切成段数组，把请求路径也切成段数组，长度一样才有戏，然后一段一段比。',
            '注意开头的空字符串：/users/42 按 / 切是 [\'\', \'users\', \'42\']，模式侧也一样，天然对齐。'
          )
        },
        {
          title: '动态段：名字以 : 开头，值从请求路径的同位置取',
          md: md(
            ':id 这种段叫动态段。判断方式：段的首字符是 :，它就不是字面量，而是参数名。',
            '```js',
            "params[segments[i].slice(1)] = reqSegs[i]",
            '```',
            '非动态段必须严格相等：/users 不等于 /user，也不因大小写「差不多」就放过。长度不等直接不匹配——多出来的一段说明是另一个资源。'
          )
        },
        {
          title: '静态段优先于动态段',
          md: md(
            '同时存在 GET /users/:id 和 GET /users/me 时，/users/me 请求两条都能匹配，共识是「更具体的赢」。',
            '实现方式：给每条路由算动态段数量，匹配成功时保留分数最低的那条；同分按注册顺序。',
            '注意必须「先收集全部命中者再挑」，不能在找到第一条命中时直接 return。'
          )
        }
      ],
      api: [
        {
          name: 'createRouter',
          sig: 'createRouter(routes: Record<string, Function>): (method: string, path: string) => { handler: Function, params: Record<string, string> } | null',
          args: 'routes —— 键是 "方法 空格 路径模式"；值是处理函数。方法名大小写都接受。以 : 开头的段是动态段。',
          returns: 'match(method, path)。命中返回 { handler, params }；未命中返回 null。path 带 ?query 也接受，匹配前会先去掉。',
          example: md(
            'const router = createRouter({',
            "  'GET /users/:id': (params) => 'user ' + params.id,",
            "  'GET /users/me': () => 'me'",
            '})',
            '',
            "router('GET', '/users/42')      // { handler, params: { id: '42' } }",
            "router('GET', '/users/me')      // { handler: 静态那条, params: {} }",
            "router('DELETE', '/users/42')   // null，方法不匹配"
          )
        }
      ],
      stages: [
        {
          n: 1,
          title: '编译路由表，先只匹配静态段',
          think: '先做编译 + 字面匹配。编译期把每个键拆成方法/段数组/动态段数量存起来；匹配期只处理「方法相同、段数相同、每段字面相等」这一条路。动态段先不做——它和「优先级」是两个独立问题。',
          hint: 'createRouter 里建 table：遍历 Object.keys(routes)，用 indexOf(\' \') 拆方法（toUpperCase）和模式，模式 split(\'/\') 得到 segments，数一下 : 开头的段存 dynamic，push { method, segments, dynamic, handler }。然后 return function match(method, path) { 按段比较，全部相等才返回 { handler, params: {} }，否则 null }。',
          diag: [
            '所有请求都返回 null：先看 method 是不是空串，多半是 indexOf(\' \') 之后忘了 slice(space + 1)。',
            '根路径 / 不命中：/ 按 / 切是 [\'\', \'\']，模式侧也一样，长度天然相等。',
            '方法不匹配也命中了：比较前两边都 toUpperCase。',
            '路径未命中却返回了对象：逐段比较时任何一段不等就要判失败。',
            '段数不等也命中了：长度不同必须先 continue，不能只看前几段。',
            '小写方法的路由命中不了：注册时方法要 toUpperCase。'
          ],
          vocab: [
            { term: '编译期 vs 请求期', md: '注册时固定不变的计算放编译期（建表），每次请求都要做的放请求期（匹配）。' }
          ],
          code: `/**
 * 第 3 关 · 第 1 步：编译路由表 + 静态匹配
 */
function createRouter(routes) {
  const table = []
  for (const key of Object.keys(routes)) {
    const space = key.indexOf(' ')
    const method = key.slice(0, space).trim().toUpperCase()
    const pattern = key.slice(space + 1).trim()
    const segments = pattern.split('/')
    let dynamic = 0
    for (const seg of segments) if (seg.charAt(0) === ':') dynamic++
    table.push({ method, segments, dynamic, handler: routes[key] })
  }

  return function match(method, path) {
    const reqSegs = String(path).split('/')
    const want = String(method).toUpperCase()

    for (const route of table) {
      if (route.method !== want) continue
      if (route.segments.length !== reqSegs.length) continue

      let matched = true
      for (let i = 0; i < route.segments.length; i++) {
        if (route.segments[i] !== reqSegs[i]) { matched = false; break }
      }
      if (matched) return { handler: route.handler, params: {} }
    }
    return null
  }
}
`,
          test: L3S1
        },
        {
          n: 2,
          title: '动态段：把路径里的值收进 params',
          think: '加动态段。关键判断只有一句：段首是 :，就把它当参数名，值取请求路径同下标。注意每轮比较都要新建 params，否则上一个路由收集的参数会串进来。',
          hint: '逐段比较时：if (seg.charAt(0) === \':\') params[seg.slice(1)] = reqSegs[i]，否则字面比较。命中时返回 { handler, params }。params 在 for(route) 循环体内新建。',
          diag: [
            'params 是空的：判断写成了 seg === \':id\'，应该用 charAt(0) === \':\' 通用判断。',
            '多个动态段只收到一个：循环里每一段都要判断，不能只看第一段。',
          ],
          code: `/**
 * 第 3 关 · 第 2 步：动态段捕获
 */
function createRouter(routes) {
  const table = []
  for (const key of Object.keys(routes)) {
    const space = key.indexOf(' ')
    const method = key.slice(0, space).trim().toUpperCase()
    const pattern = key.slice(space + 1).trim()
    const segments = pattern.split('/')
    let dynamic = 0
    for (const seg of segments) if (seg.charAt(0) === ':') dynamic++
    table.push({ method, segments, dynamic, handler: routes[key] })
  }

  return function match(method, path) {
    const reqSegs = String(path).split('/')
    const want = String(method).toUpperCase()

    for (const route of table) {
      if (route.method !== want) continue
      if (route.segments.length !== reqSegs.length) continue

      const params = {}
      let matched = true
      for (let i = 0; i < route.segments.length; i++) {
        const p = route.segments[i]
        if (p.charAt(0) === ':') params[p.slice(1)] = reqSegs[i]
        else if (p !== reqSegs[i]) { matched = false; break }
      }
      if (matched) return { handler: route.handler, params }
    }
    return null
  }
}
`,
          test: L3S2
        },
        {
          n: 3,
          title: '先剥 query：别把 ?tab=info 收进参数',
          think: '现在修一个很隐蔽的 bug：路径带 query 时，按 / 切完最后一段是 "42?tab=info&page=2"，动态段会把整串收进 params.id。所以匹配前必须先剥掉问号后面那截。',
          hint: '在 match 开头：const q = path.indexOf(\'?\')；const pathOnly = q === -1 ? path : path.slice(0, q)；用 pathOnly.split(\'/\') 得到 reqSegs。',
          diag: [
            'params.id 变成 "42?tab=info"：split 之前先剥掉问号后面那截。',
          ],
          code: `/**
 * 第 3 关 · 第 3 步：匹配前剥掉 query
 */
function createRouter(routes) {
  const table = []
  for (const key of Object.keys(routes)) {
    const space = key.indexOf(' ')
    const method = key.slice(0, space).trim().toUpperCase()
    const pattern = key.slice(space + 1).trim()
    const segments = pattern.split('/')
    let dynamic = 0
    for (const seg of segments) if (seg.charAt(0) === ':') dynamic++
    table.push({ method, segments, dynamic, handler: routes[key] })
  }

  return function match(method, path) {
    const q = String(path).indexOf('?')
    const pathOnly = q === -1 ? String(path) : String(path).slice(0, q)
    const reqSegs = pathOnly.split('/')
    const want = String(method).toUpperCase()

    for (const route of table) {
      if (route.method !== want) continue
      if (route.segments.length !== reqSegs.length) continue

      const params = {}
      let matched = true
      for (let i = 0; i < route.segments.length; i++) {
        const p = route.segments[i]
        if (p.charAt(0) === ':') params[p.slice(1)] = reqSegs[i]
        else if (p !== reqSegs[i]) { matched = false; break }
      }
      if (matched) return { handler: route.handler, params }
    }
    return null
  }
}
`,
          test: L3S3
        },
        {
          n: 4,
          title: '静态段优先：收集候选，挑动态段最少的',
          think: '最后处理优先级。如果第一条命中就 return，先注册的 /users/:id 会抢走 /users/me。正确做法是收集所有候选、按动态段数量挑最少的，同分保留先注册的。',
          hint: '把 for 循环里的 return 改成候选比较：if (!best || route.dynamic < best.dynamic) best = { handler, params, dynamic }；循环结束后 return best ? { handler: best.handler, params: best.params } : null。',
          diag: [
            '/users/me 走了 :id：不能第一条命中就 return，要先收集再按 dynamic 挑最小。',
          ],
          code: ROUTER_FINAL,
          test: L3S4
        }
      ],
      finalCode: ROUTER_FINAL,
      usage: `// 三关连起来就是一次请求的生命周期
const { method, path } = parseRequestLine('GET /users/42?tab=info HTTP/1.1')
const headers = parseHeaders(['Host: example.com'])

const router = createRouter({
  'GET /users/:id': (params) => 'user ' + params.id,
  'GET /users/me': () => 'me'
})

const hit = router(method, path)   // { handler, params: { id: '42' } }
hit.handler(hit.params)            // 'user 42'`,
      hints: [
        '所有请求都返回 null：先 console.log(table) 看 method 是不是空字符串——多半 key.indexOf(\' \') 用错或忘了 slice(space + 1)。',
        '动态段 params 是空的：判断写成了 seg === \':id\'，应该用 charAt(0) === \':\' 通用判断。',
        '/users/me 走了 :id 那条：只收集了第一个命中就 return，改成先收集再按 dynamic 挑最小。',
        '带 query 时 params.id 变成 "42?tab=info"：忘了在 split(\'/\') 之前剥掉问号后面。',
        '参数串到了别的路由：params 对象提到了循环外面，每轮都要新建。',
        '未命中返回了 {} 而不是 null：return best ? ... : null 写成了 return best || {}。'
      ],
      concepts: [
        {
          title: '通关后复盘：三关连起来就是一次请求的生命周期',
          md: md(
            '现在你的代码能完整走完：原始文本 → parseRequestLine 得到 method 和 path → parseHeaders 得到 headers → createRouter 的 match 找到 handler 和 params → 调 handler。',
            '这也正是 Express 的内核顺序。再往前走一步的方向：动态段 decodeURIComponent、末尾斜杠归一、405 与 404 分开报。'
          )
        }
      ],
      skeleton: `function parseRequestLine(line) {
  const parts = String(line).trim().split(' ')
  if (parts.length !== 3) throw new Error('请求行格式错误：' + line)
  const [method, target, version] = parts
  const mark = target.indexOf('?')
  const path = mark === -1 ? target : target.slice(0, mark)
  const queryText = mark === -1 ? '' : target.slice(mark + 1)
  const query = {}
  for (const pair of queryText.split('&')) {
    if (!pair) continue
    const eq = pair.indexOf('=')
    const rawKey = eq === -1 ? pair : pair.slice(0, eq)
    const rawVal = eq === -1 ? '' : pair.slice(eq + 1)
    query[decodeURIComponent(rawKey.replace(/\\+/g, ' '))] = decodeURIComponent(rawVal.replace(/\\+/g, ' '))
  }
  return { method, path, version, query }
}

function parseHeaders(lines) {
  const out = {}
  for (const line of lines) {
    const i = line.indexOf(':')
    if (i === -1) continue
    const name = line.slice(0, i).trim().toLowerCase()
    if (!name) continue
    out[name] = line.slice(i + 1).trim()
  }
  return out
}

/**
 * 创建路由匹配函数。
 * @param {Record<string, Function>} routes 键形如 'GET /users/:id'
 * @returns {(method: string, path: string) => { handler: Function, params: Record<string, string> } | null}
 */
function createRouter(routes) {
  // TODO 1：把每个 '方法 模式' 编译成 { method, segments, dynamic, handler } 放进 table
  // TODO 2：返回 match(method, path)，先剥掉 path 上的 query 再 split('/')
  // TODO 3：逐条筛方法、比段数、逐段比对并收集 params
  // TODO 4：在候选里挑动态段最少的，返回 { handler, params } 或 null
  throw new Error('TODO 1 未实现：先把 routes 编译成内部表')
}
`,
      solution: ROUTER_FINAL,
      tests: [L3S1, L3S2, L3S3, L3S4].join('\n\n')
    }
  ]
}