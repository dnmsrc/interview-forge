/**
 * cs-seceq-2 —— 安全工程一关：OWASP 分类、审计字段、WAF/限流规则匹配。
 * 分配见 data/plans/cs-seceq-2.json；全部是可判定的纯函数。
 */

/* ============================================================ 第 1 关测试 */
const L1S1 = `{
  check('SQL 注入与 XSS 都归 A03 Injection', () => {
    same(classifyOwasp('CWE-89'), 'A03:2021')
    same(classifyOwasp({ cwe: 'CWE-79' }), 'A03:2021')
  })
  check('路径穿越与 CSRF 都归 A01 失效的访问控制', () => {
    same(classifyOwasp('CWE-22'), 'A01:2021')
    same(classifyOwasp('CWE-352'), 'A01:2021')
  })
  check('硬编码凭证归 A07 认证失败', () => {
    same(classifyOwasp('CWE-798'), 'A07:2021')
    same(classifyOwasp('CWE-287'), 'A07:2021')
  })
  check('反序列化归 A08，SSRF 归 A10', () => {
    same(classifyOwasp('CWE-502'), 'A08:2021')
    same(classifyOwasp('CWE-918'), 'A10:2021')
  })
  check('未知 CWE 返回 unknown，不硬塞进某一类', () => {
    same(classifyOwasp('CWE-9999'), 'unknown')
    same(classifyOwasp({}), 'unknown')
  })
}`

const L1S2 = `{
  check('完整的审计事件 valid 且无缺失', () => {
    const r = auditFields({
      ts: 1700000000000, actor: 'u1', action: 'read', target: 'order/1',
      result: 'ok', ip: '10.0.0.1', traceId: 't-1'
    })
    same(r.missing, [])
    same(r.valid, true)
  })
  check('缺 actor / action 时按固定顺序列出', () => {
    const r = auditFields({ ts: 1, target: 'x', result: 'ok', ip: '1.1.1.1', traceId: 't' })
    same(r.missing, ['actor', 'action'])
  })
  check('高危动作（grant / delete）标记 high', () => {
    const base = { ts: 1, actor: 'a', target: 'x', result: 'ok', ip: '1.1.1.1', traceId: 't' }
    same(auditFields({ ...base, action: 'grant' }).risk, 'high')
    same(auditFields({ ...base, action: 'delete' }).risk, 'high')
    same(auditFields({ ...base, action: 'read' }).risk, 'normal')
  })
  check('ts 必须是正数，字符串或 0 都算缺失', () => {
    const e = { actor: 'a', action: 'read', target: 'x', result: 'ok', ip: '1.1.1.1', traceId: 't' }
    same(auditFields({ ...e, ts: '2024-01-01' }).missing, ['ts'])
    same(auditFields({ ...e, ts: 0 }).missing, ['ts'])
  })
  check('空对象列出全部 7 个必填字段', () => {
    same(auditFields({}).missing, ['ts', 'actor', 'action', 'target', 'result', 'ip', 'traceId'])
    same(auditFields({}).valid, false)
  })
}`

const L1S3 = `{
  check('路径前缀 + 方法都匹配才命中；/api/login-evil 不命中', () => {
    const rules = [{ id: 'login', method: 'POST', prefix: '/api/login', minRate: 5, action: 'rate-limit' }]
    same(matchRule({ path: '/api/login', method: 'POST', rate: 10 }, rules), { rule: 'login', action: 'rate-limit' })
    same(matchRule({ path: '/api/login-evil', method: 'POST', rate: 10 }, rules).rule, null)
  })
  check('方法不匹配则跳过', () => {
    const rules = [{ id: 'login', method: 'POST', prefix: '/api/login', minRate: 5 }]
    same(matchRule({ path: '/api/login', method: 'GET', rate: 99 }, rules), { rule: null, action: 'allow' })
  })
  check('速率没到阈值不命中（限流规则只拦高频）', () => {
    const rules = [{ id: 'login', method: 'POST', prefix: '/api/login', minRate: 5 }]
    same(matchRule({ path: '/api/login', method: 'POST', rate: 4 }, rules).rule, null)
  })
  check('第一条匹配的规则生效（规则顺序即优先级）', () => {
    const rules = [
      { id: 'block-admin', prefix: '/admin', action: 'block' },
      { id: 'rate-admin', prefix: '/admin', minRate: 1, action: 'rate-limit' }
    ]
    same(matchRule({ path: '/admin/users', method: 'GET', rate: 999 }, rules).rule, 'block-admin')
  })
  check('没有规则命中返回 allow', () => {
    same(matchRule({ path: '/public', method: 'GET', rate: 1 }, []), { rule: null, action: 'allow' })
    same(matchRule({ path: '/public' }, [{ id: 'x', prefix: '/admin' }]).rule, null)
  })
}`

/* ============================================================ 第 1 关代码 */
const L1C1 = `// OWASP Top 10 (2021) 与 CWE 的映射：面试要能说清「同一个类目下有哪些 CWE」
const OWASP_BY_CWE = {
  'CWE-89': 'A03:2021',    // SQL 注入
  'CWE-79': 'A03:2021',    // XSS
  'CWE-22': 'A01:2021',    // 路径穿越 → 失效的访问控制
  'CWE-352': 'A01:2021',   // CSRF 在 2021 版被并入 A01
  'CWE-287': 'A07:2021',   // 认证不当
  'CWE-798': 'A07:2021',   // 硬编码凭证
  'CWE-1104': 'A06:2021',  // 过时组件
  'CWE-502': 'A08:2021',   // 不安全反序列化
  'CWE-918': 'A10:2021'    // SSRF
}

function classifyOwasp(v) {
  const cwe = typeof v === 'string' ? v : (v && v.cwe)
  return OWASP_BY_CWE[cwe] || 'unknown'
}`

const L1C2 = `${L1C1}

// 审计事件的必填字段：少任何一个，事后都无法还原「谁在什么时候对什么做了什么」
const AUDIT_REQUIRED = ['ts', 'actor', 'action', 'target', 'result', 'ip', 'traceId']
const HIGH_RISK_ACTIONS = ['grant', 'delete', 'rotate-key', 'impersonate']

function auditFields(event) {
  const e = event || {}
  const missing = AUDIT_REQUIRED.filter(function (k) {
    const v = e[k]
    // 时间戳必须是正数：字符串时间和 0 都无法用于排序/回溯
    if (k === 'ts') return typeof v !== 'number' || !(v > 0)
    if (v === undefined || v === null) return true
    return String(v).trim() === ''
  })
  return {
    missing,
    valid: missing.length === 0,
    risk: HIGH_RISK_ACTIONS.indexOf(e.action) >= 0 ? 'high' : 'normal'
  }
}`

const L1C3 = `${L1C2}

function pathMatches(path, prefix) {
  if (!prefix) return true
  if (path === prefix) return true
  // 按路径段匹配：/api/login 不该命中 /api/login-evil（前缀匹配的经典漏洞）
  return path.indexOf(prefix + '/') === 0
}

function matchRule(req, rules) {
  const r = req || {}
  for (const rule of rules || []) {
    if (rule.method && rule.method !== r.method) continue
    if (!pathMatches(String(r.path || ''), rule.prefix)) continue
    if (rule.minRate !== undefined && !((r.rate || 0) >= rule.minRate)) continue
    // 第一条命中的规则生效：规则表的顺序就是优先级
    return { rule: rule.id, action: rule.action || 'block' }
  }
  return { rule: null, action: 'allow' }
}`

/* ============================================================ 第 1 关 */
const LV1 = {
  id: 'lv1',
  title: '安全工程：OWASP 分类、审计、WAF 规则',
  emoji: '🚦',
  xp: 55,
  goal: '实现 classifyOwasp 把 CWE 映射到 OWASP Top 10 (2021) 类目，auditFields 校验审计事件必填字段并标记高危动作，pathMatches / matchRule 按路径段、方法与速率阈值匹配 WAF/限流规则。',
  why: '安全工程的价值不在「知道 OWASP 有十项」，而在于三个能落地的动作：把扫描器报的 CWE 归到正确的类目（决定修复优先级）、让每条敏感操作都留下可回放的审计记录（决定事后能不能追责）、用规则在入口拦住高频与越权访问（决定攻击成本）。这三件事都能写成纯函数，也都能在面试里被追问细节。',
  nodes: [
    'cs.seceq.sec-eng',
    'cs.seceq.sec-eng.audit',
    'cs.seceq.sec-eng.owasp',
    'cs.seceq.sec-eng.ratelimit-waf'
  ],
  thinking: [
    {
      title: 'OWASP 是类目，不是漏洞清单',
      md: 'A03 Injection 底下同时装着 SQL 注入（CWE-89）、XSS（CWE-79）、命令注入（CWE-78）。所以「我们做了参数化，A03 就解决了」是错的——XSS 还在。\n\n分类的意义是「按修复手段聚类」：A01 靠权限模型，A03 靠输入处理，A07 靠认证流程。拿到一个 CWE 先归类，再谈修法，比逐个漏洞打补丁高效得多。2021 版把 CSRF 并进 A01 也是这个逻辑：它本质是「服务端没验证请求来源」，属于访问控制失效。'
    },
    {
      title: '审计日志的必填字段是「事后可还原」的最小集',
      md: '谁（actor）、什么时候（ts）、对什么（target）、做了什么（action）、结果如何（result）、从哪来（ip）、关联哪次请求（traceId）——少一个，事后就只能猜。\n\ntraceId 是最容易被漏掉的：没有它，审计日志和链路追踪对不上，排查「这次删除是不是那个接口触发的」要多花几小时。ts 必须是数字（时间戳），字符串时间无法排序、无法做窗口聚合。'
    },
    {
      title: 'WAF 规则匹配的两个陷阱：前缀与顺序',
      md: '前缀匹配不做路径段边界，`/api/login` 会命中 `/api/login-evil`——攻击者只要注册一个相似路径就能绕过或误伤。正确做法是按段比较：等于前缀，或以 `前缀 + /` 开头。\n\n顺序即优先级：先 block 后 rate-limit，和反过来结果完全不同。规则表必须是有序数组，不能用对象（对象键序在语义上不可依赖）。'
    }
  ],
  prereq: [
    {
      title: 'OWASP Top 10 (2021) 的十项是什么',
      md: 'A01 失效的访问控制、A02 加密机制失效、A03 注入、A04 不安全设计、A05 安全配置错误、A06 过时组件、A07 认证与身份识别失败、A08 软件与数据完整性失效、A09 日志与监控失效、A10 SSRF。\n\n注意 A04「不安全设计」是 2021 新增的：它强调「设计阶段就缺威胁建模」，代码写得再规范也补不上。A09 直接把「日志监控不足」列进前十，说明可观测性已经是安全能力。'
    },
    {
      title: '限流为什么常和 WAF 一起出现',
      md: 'WAF 拦「已知恶意特征」（SQL 关键字、路径穿越、恶意 UA），限流拦「行为异常」（同一 IP 每秒 100 次登录）。前者看内容，后者看频率，互补。\n\n但限流阈值不能一刀切：登录接口按账号 + IP 双维度，普通查询按令牌桶给突发额度。阈值太低会误伤正常用户，太高等于没限。所以规则要能按路径配置不同阈值——这正是本关 matchRule 的输入。'
    }
  ],
  api: [
    {
      name: 'classifyOwasp',
      sig: 'classifyOwasp(cwe | { cwe }) => string',
      args: 'cwe 形如 "CWE-89"，也可以传 { cwe } 对象。',
      returns: '返回 OWASP 2021 类目 id（如 "A03:2021"），未收录的返回 "unknown"。',
      example: 'classifyOwasp("CWE-89")   // "A03:2021"\nclassifyOwasp({ cwe: "CWE-352" })   // "A01:2021"'
    },
    {
      name: 'auditFields',
      sig: 'auditFields(event) => { missing, valid, risk }',
      args: 'event 是一条审计记录；必填 ts/actor/action/target/result/ip/traceId。',
      returns: 'missing 按固定顺序列出缺失字段；valid 表示是否齐全；risk 对 grant/delete/rotate-key/impersonate 标 high。',
      example: 'auditFields({ ts: 1, actor: "a", target: "x", result: "ok", ip: "1.1.1.1", traceId: "t" }).missing\n// ["action"]'
    },
    {
      name: 'pathMatches / matchRule',
      sig: 'pathMatches(path, prefix) => boolean；matchRule({ path, method, rate }, rules) => { rule, action }',
      args: 'rules 是有序数组，每项 { id, prefix?, method?, minRate?, action? }。',
      returns: 'pathMatches 按路径段匹配；matchRule 返回第一条命中的规则 id 与动作，未命中返回 { rule: null, action: "allow" }。',
      example: 'matchRule({ path: "/api/login", method: "POST", rate: 10 },\n  [{ id: "login", method: "POST", prefix: "/api/login", minRate: 5, action: "rate-limit" }])\n// { rule: "login", action: "rate-limit" }'
    }
  ],
  usage: '// 扫描报告入库前先归类，按类目排修复优先级：\nconst cat = classifyOwasp(finding.cwe)   // "A03:2021"\n// 敏感操作统一走审计：\nconst audit = auditFields({ ts: Date.now(), actor: user.id, action: "grant", target: role, result: "ok", ip, traceId })\nif (!audit.valid) alert(`审计缺字段：${audit.missing.join(",")}`)\n// 网关入口匹配规则：\nconst hit = matchRule({ path: req.path, method: req.method, rate: rateOf(req) }, wafRules)\nif (hit.action === "block") return res.status(403).end()',
  hints: [
    '第 1 步：建一张 CWE → OWASP 类目的表；入参既支持字符串也支持对象；查不到返回 unknown。',
    '第 2 步：固定字段表 filter；ts 单独判 typeof number && > 0；risk 看 action 是否在高危列表里。',
    '第 3 步：pathMatches 先判相等，再判以 prefix + "/" 开头；matchRule 按数组顺序返回第一条命中项。'
  ],
  concepts: [
    {
      title: 'A09 为什么把「日志监控」算作安全问题',
      md: '大多数入侵不是被防住的，是被发现的：平均驻留时间以周计，靠的是异常日志和告警。没有审计日志，就无法回答「谁在什么时候删了数据」。\n\n所以 A09 的修复不是买 SIEM，而是三件小事：敏感操作必须记审计、日志必须能按 traceId 串起来、异常必须能触发告警。这三件事和可观测性是同一套基础设施。'
    },
    {
      title: 'WAF 不是边界安全，是成本抬高器',
      md: 'WAF 用规则匹配已知攻击特征，绕过方式很多（编码变形、分片、语义等价）。它的真实价值是「把脚本小子的成本抬高」，而不是「挡住所有攻击」。\n\n所以 WAF 必须和代码层修复叠加：WAF 拦 90% 的扫描流量，参数化/输出编码负责「万一漏了也不出事」。只有 WAF 的系统，等于把安全交给正则表达式。'
    }
  ],
  stages: [
    {
      n: 1,
      title: 'CWE 到 OWASP 类目的映射',
      think: '先做分类。它是最简单的查表，但表本身要能说清「为什么 CSRF 在 A01 而不是 A03」——这决定了你后面怎么排修复优先级。',
      hint: '建一张 CWE → "A03:2021" 这种字符串的表；入参兼容字符串与 { cwe }；没命中返回 "unknown"。',
      code: L1C1,
      test: L1S1,
      diag: [
        '把 XSS 单独归到了别的类目（2021 版与 SQL 注入同属 A03）。',
        'CSRF 归到了 A03 或 A05（2021 版并入 A01）。',
        '只支持字符串入参，传对象时查表失败。',
        '未知 CWE 返回 undefined 或抛错，报表里出现空类目。',
        '类目 id 少写了年份后缀，与前端枚举对不上。'
      ]
    },
    {
      n: 2,
      title: '审计事件必填字段与高危标记',
      think: '分类之后是留痕。这一步的关键是「ts 的类型校验」和「高危动作识别」——前者决定日志能不能排序，后者决定要不要实时告警。',
      hint: '用固定字段数组 filter；ts 单独判 typeof number 且 > 0；risk 用高危动作数组 indexOf 判定。',
      code: L1C2,
      test: L1S2,
      diag: [
        '只判了 undefined，空串字段被当成已填。',
        'ts 没做类型校验，字符串时间混进审计表。',
        '高危动作列表漏了 grant/delete，敏感操作没有告警。',
        '缺失字段顺序随对象键序变化，前端对不上。',
        '空对象没有列出全部必填字段（filter 在 undefined 上崩了）。'
      ]
    },
    {
      n: 3,
      title: 'WAF / 限流规则匹配',
      think: '最后一步把规则匹配做对。两个细节决定它是「防护」还是「摆设」：路径必须按段匹配，规则必须按顺序短路。',
      hint: 'pathMatches 先判 path === prefix，再判 path 以 prefix + "/" 开头；matchRule 遍历数组，第一条全条件满足的就返回。',
      code: L1C3,
      test: L1S3,
      diag: [
        '用了 startsWith(prefix)，/api/login-evil 也被拦或误放。',
        'method 比较没统一大小写，post 与 POST 对不上。',
        'minRate 判断方向反了（低于阈值才命中）。',
        '遍历完所有规则取最后一条，优先级反了。',
        '没有默认返回，未命中时返回 undefined。'
      ]
    }
  ],
  skeleton: `function classifyOwasp(v) {
  // TODO: CWE → OWASP 2021 类目，未收录返回 unknown
  throw new Error('classifyOwasp 还没实现')
}

function auditFields(event) {
  // TODO: 必填字段校验 + 高危动作标记
  throw new Error('auditFields 还没实现')
}

function pathMatches(path, prefix) {
  // TODO: 按路径段匹配，避免 /api/login 命中 /api/login-evil
  throw new Error('pathMatches 还没实现')
}

function matchRule(req, rules) {
  // TODO: 方法 + 路径段 + 速率阈值，返回第一条命中规则
  throw new Error('matchRule 还没实现')
}`,
  solution: L1C3,
  finalCode: L1C3,
  tests: `${L1S1}\n${L1S2}\n${L1S3}`
}

export default {
  id: 'cs-seceq-2',
  version: 3,
  domain: 'cs',
  cumulative: false,
  title: '安全工程：分类、审计、规则匹配',
  emoji: '🚦',
  xp: 50,
  tagline: '1 关 3 步：OWASP Top10 分类 → 审计必填字段与高危标记 → WAF/限流规则按路径段匹配。',
  stack: ['安全工程', 'Web'],
  intro: '安全工程最容易做成「清单式安全」：OWASP 十项背一遍、审计日志打一条、WAF 规则抄一份。但清单解决不了判断——扫描器报的 CWE 该归哪一类、这条审计缺了什么、这个规则为什么没拦住攻击。这个项目把三个动作写成可判定函数，让你在面对「这条告警严重吗」「这次删除能追责吗」「这条规则会误伤吗」时，能给出确定的答案。',
  outcome: '你能把 CWE 映射到 OWASP 2021 类目并解释归类理由、校验审计事件的七个必填字段并标记高危操作、实现按路径段与方法与速率阈值匹配的 WAF/限流规则并说明优先级。',
  levels: [LV1]
}