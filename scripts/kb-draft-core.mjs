/**
 * 讲义起草核心（契约 docs/design/KNOWLEDGE-SYSTEM.md §9）——单一真源。
 *
 * CLI scripts/kb-build.mjs 与主进程 services/kb-draft.ts 共用本文件，保证
 * 「命令行批量补齐」和「应用里点按钮生成」走完全相同的
 * 来源获取 → AI 起草 → 八小节质量闸门 流程，不会出现两套口径。
 *
 * 依赖约束：只 import node:fs/path 与 src/shared/knowledge-core.mjs（纯函数），
 * 禁止 import electron / node:sqlite —— chat / 查库回调由调用方注入（同 seed-core 模式）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseKnowledgeMd, qualityCheck, REQUIRED_SECTIONS } from '../src/shared/knowledge-core.mjs'

/* ---------------- 官方源白名单（kind 判定按域名；扩域在此登记） ---------------- */

export const OFFICIAL_HOSTS = [
  // 前端 / 浏览器
  'vuejs.org', 'cn.vuejs.org', 'router.vuejs.org', 'pinia.vuejs.org', 'react.dev', 'reactjs.org',
  'developer.mozilla.org', 'typescriptlang.org', 'vitejs.dev', 'vitest.dev',
  'nodejs.org', 'tc39.es', 'webpack.js.org', 'eslint.org',
  'web.dev', 'developers.google.com', 'v8.dev', 'whatwg.org', 'rfc-editor.org', 'datatracker.ietf.org',
  // 后端语言与框架
  'dev.java', 'docs.oracle.com', 'openjdk.org', 'docs.spring.io', 'spring.io',
  'docs.python.org', 'docs.rs', 'doc.rust-lang.org', 'go.dev', 'golang.org',
  'www.php.net', 'learn.microsoft.com', 'devblogs.microsoft.com',
  // 存储 / 中间件
  'dev.mysql.com', 'www.postgresql.org', 'redis.io', 'docs.redis.com', 'www.mongodb.com',
  'kafka.apache.org', 'rocketmq.apache.org', 'www.rabbitmq.com', 'nacos.io', 'www.emqx.com',
  // 运维 / 云原生
  'kubernetes.io', 'helm.sh', 'www.terraform.io', 'jenkins.io', 'git-scm.com', 'nginx.org',
  'docs.docker.com', 'github.com/docs',
  // AI / 大模型
  'platform.openai.com', 'huggingface.co', 'pytorch.org', 'tensorflow.org', 'ollama.com',
  'onnx.ai', 'python.langchain.com', 'docs.langchain.com', 'openreview.net', 'arxiv.org',
  // 工程方法论
  'sre.google', 'google.github.io', 'microservices.io', 'martinfowler.com',
  // 以下为主机可达性实测后补登记（scripts/tmp-reach*.mjs 三轮探测结论）：
  // 这些站的页面在本机能抓到正文，Bing 命中它们时应判 official 而不是 doc
  'docs.smith.langchain.com', 'smith.langchain.com', 'zh.d2l.ai', 'd2l.ai', 'developer.hashicorp.com',
  'prometheus.io', 'grafana.com', 'jenkins.io', 'opentelemetry.io', 'istio.io', 'argo-cd.readthedocs.io',
  'docs.djangoproject.com', 'fastapi.tiangolo.com', 'scikit-learn.org', 'pulsar.apache.org',
  'cassandra.apache.org', 'docs.pingcap.com', 'deno.land', 'bun.sh', 'expressjs.com', 'koajs.com',
  'www.elastic.co', 'min.io', 'developer.android.com', 'developer.apple.com', 'blog.csdn.net'
]
/**
 * 本机网络实测不可达 / 反爬的站点（探测脚本 EX:TypeError 或 403）。
 * 列入后 fetchText 直接跳过：单次超时要 21 秒，一篇讲义撞上两三个这种源就白等一分钟。
 * 注意这不是"该站没好内容"，只是这台机器（国内网络）拿不到，换环境应重新探测。
 */
export const UNREACHABLE_HOSTS = [
  'huggingface.co', 'huggingface.cn', 'cdn-lfs.huggingface.co',
  'zh.wikipedia.org', 'en.wikipedia.org', 'wikipedia.org',
  'www.tensorflow.org', 'tensorflow.org',
  'platform.openai.com', 'cookbook.openai.com', 'www.zhihu.com', 'zhihu.com',
  'research.google', 'queue.acm.org'
]
export const SOURCE_HOSTS = ['github.com']
export const CURATED_HOSTS = ['juejin.cn', 'cnblogs.com', 'segmentfault.com', 'stackoverflow.com', 'infoq.cn', 'time.geekbang.org']

export function kindOf(url) {
  const h = String(url).toLowerCase()
  if (OFFICIAL_HOSTS.some((d) => h.includes(d))) return 'official'
  if (SOURCE_HOSTS.some((d) => h.includes(d))) return 'source'
  if (CURATED_HOSTS.some((d) => h.includes(d))) return 'article'
  return 'doc'
}

/* ---------------- 官方文档 sitemap 主通道 ---------------- */
// Bing 的 site: 语法在本机实测不可靠；官方 sitemap 直连稳定且天然 official。
export const SITEMAPS = [
  { origin: 'https://cn.vuejs.org', url: 'https://cn.vuejs.org/sitemap.xml', domains: ['fe'] },
  { origin: 'https://vuejs.org', url: 'https://vuejs.org/sitemap.xml', domains: ['fe'] },
  { origin: 'https://developer.mozilla.org', url: 'https://developer.mozilla.org/sitemaps/zh-CN/sitemap.xml', domains: ['fe', 'be', 'cs'] },
  { origin: 'https://redis.io', url: 'https://redis.io/sitemap.xml', domains: ['be'] },
  { origin: 'https://kafka.apache.org', url: 'https://kafka.apache.org/sitemap.xml', domains: ['be'] },
  { origin: 'https://kubernetes.io', url: 'https://kubernetes.io/sitemap.xml', domains: ['be', 'cs', 'eng'] }
]
const sitemapCache = new Map()
export async function sitemapUrls(entry) {
  if (sitemapCache.has(entry.url)) return sitemapCache.get(entry.url)
  try {
    const res = await fetch(entry.url, { signal: AbortSignal.timeout(12000) })
    const xml = await res.text()
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim())
    sitemapCache.set(entry.url, urls)
    return urls
  } catch { sitemapCache.set(entry.url, []); return [] }
}

/** 术语相关性：URL slug 命中考点词根越多越靠前 */
export function scoreUrl(u, terms) {
  const slug = u.toLowerCase()
  let score = 0
  for (const t of terms) {
    const k = t.toLowerCase()
    if (slug.includes(k)) score += slug.includes(`/${k}`) ? 3 : 2
  }
  return score
}

/**
 * 语义兜底映射：sitemap 是页面粒度，很多考点没有独立页（内容散在大章），
 * 纯 slug 匹配会落空；按 node id / 标题关键词映射到最相关的官方页。
 * 新域扩展只需往这里加条目，不改主流程。
 */
export const DOC_HINTS = [
  // ---- 前端 Vue（存量）----
  { match: ['compiler', 'ast', 'pipeline', 'block-tree', 'static-hoist', 'slot-compile', 'render-function'],
    docs: ['guide/extras/rendering-mechanism.html', 'guide/extras/render-function.html', 'api/compile-time-flags.html'] },
  { match: ['reactivity', 'proxify', 'effect', 'ref', 'reactive', 'computed', 'watch'],
    docs: ['guide/essentials/reactivity-fundamentals.html', 'guide/extras/reactivity-in-depth.html', 'api/reactivity-core.html', 'api/reactivity-advanced.html'] },
  { match: ['scheduler', 'nexttick'],
    docs: ['guide/essentials/lifecycle.html', 'api/general.html'] },
  { match: ['composition', 'setup', 'lifecycle', 'composable'],
    docs: ['api/composition-api-setup.html', 'api/composition-api-lifecycle.html', 'guide/reusability/composables.html', 'guide/extras/composition-api-faq.html'] },
  { match: ['router', 'history', 'navigation', 'route'],
    docs: ['guide/scaling-up/routing.html'] },
  { match: ['state', 'pinia', 'vuex', 'store'],
    docs: ['guide/scaling-up/state-management.html'] },
  { match: ['component', 'props', 'emit', 'slot', 'provide', 'inject', 'v-model', 'attrs'],
    docs: ['guide/essentials/component-basics.html', 'guide/components/props.html', 'guide/components/slots.html', 'guide/components/provide-inject.html', 'guide/components/events.html'] },
  { match: ['directive', 'vdom', 'patch', 'diff', 'key'],
    docs: ['guide/built-ins/keep-alive.html', 'guide/best-practices/performance.html'] },
  { match: ['sfc', 'macros', 'script-setup', 'css'],
    docs: ['api/sfc-script-setup.html', 'api/sfc-spec.html', 'api/sfc-css-features.html'] },
  { match: ['ssr', 'hydration'],
    docs: ['api/ssr.html', 'guide/scaling-up/ssr.html'] },
  { match: ['typescript', 'type', 'generic'],
    docs: ['guide/typescript/overview.html', 'guide/typescript/composition-api.html'] },
  { match: ['transition', 'animation', 'teleport', 'suspense'],
    docs: ['guide/built-ins/transition.html', 'guide/built-ins/teleport.html', 'guide/built-ins/suspense.html'] },
  // ---- 后端 Java / JVM ----
  { match: ['concurrent', 'thread', 'jmm', 'volatile', 'atomic', 'lock', 'threadlocal', 'cas', 'aqs', 'pool'],
    docs: ['essential/concurrency/index.html', 'tutorial/concurrency/index.html'] },
  { match: ['collection', 'hashtable', 'arraylist', 'linkedlist', 'hashmap', 'copy-on-write', 'fail-fast'],
    docs: ['collections/index.html', 'tutorial/java/collections/CCollection.html'] },
  { match: ['gc', 'jvm', 'memory', 'oom', 'classload', 'jit', 'safepoint'],
    docs: ['vm/index.html', 'gc/gctuning/index.html'] },
  { match: ['io', 'nio', 'netty', 'epoll', 'bio', 'aio', 'multiplex'],
    docs: ['tutorial/java/nio/index.html', 'api/java.base/java/nio/package-summary.html'] },
  // ---- MySQL / 存储 ----
  { match: ['index', 'explain', 'optimizer', 'covering', 'filesort', 'join', 'slow'],
    docs: ['man/man-parameters.html', 'en/select-statement.html', 'en/optimizing-information-schema.html'] },
  { match: ['transaction', 'isolation', 'lock', 'deadlock', 'mvcc', 'undo', 'redo', 'binlog'],
    docs: ['en/innodb-transaction-model.html', 'en/innodb-locking.html', 'en/dictionary-transactional-system-variables.html'] },
  { match: ['redis', '数据类型', '持久化', 'rdb', 'aof', '过期', '内存淘汰', '哨兵', '集群', '分布式锁'],
    docs: ['docs/latest/develop/clients/nodejs.html', 'docs/latest/operate/rs/databases/durability-ok/backup.html', 'docs/latest/develop/data-types/index.html#data-types'] },
  // ---- Python ----
  { match: ['python', 'gil', 'asyncio', '协程', '装饰器', '生成器', '元类'],
    docs: ['3/library/asyncio.html', '3/howto/asyncio.html', '3/reference/datamodel.html'] },
  // ---- Node ----
  { match: ['node', 'libuv', 'eventloop', 'stream', 'cluster', 'worker', 'worker_threads'],
    docs: ['latest/api/libuv.html', 'latest/api/event_loop.html', 'latest/api/stream.html', 'latest/api/worker_threads.html'] },
  // ---- 消息队列 / 微服务 ----
  { match: ['kafka', '分区', '重平衡', 'offset', '幂等', '事务'],
    docs: ['documentation.html#semantics', 'documentation.html#design'] },
  { match: ['mq', '消息', '投递', '重试', '死信', '顺序', '积压'],
    docs: ['documentation.html#semantics'] },
  { match: ['微服务', 'micro', '熔断', '限流', '降级', '分布式事务', 'saga', '最终一致'],
    docs: ['articles/patterns/services.html', 'microservices/'] },
  // ---- 公共基础 ----
  { match: ['进程', '线程', '调度', '死锁', '页表', '虚拟内存', '缺页', 'ipc'],
    docs: ['zh-CN/docs/Glossary/Multithreading', 'zh-CN/docs/Web/API/Worker', 'en-US/docs/Glossary/Deadlock'] },
  { match: ['网络', 'tcp', 'udp', 'http', 'tls', '握手', '拥塞', 'dns', 'quic'],
    docs: ['zh-CN/docs/Web/HTTP', 'zh-CN/docs/Web/HTTP/CORS', 'en-US/docs/Web/HTTP/Headers/Cache-Control', 'zh-CN/docs/Web/Performance/How_browsers_work'] },
  { match: ['算法', '复杂度', '排序', '二叉', '堆', '图', '动态规划', '回溯'],
    docs: ['zh-CN/docs/Web/JavaScript/Guide/Indexed_collections', 'en-US/docs/Web/API'] },
  { match: ['设计模式', '单例', '观察者', '策略', '工厂', '代理', '装饰'],
    docs: ['zh-CN/docs/Glossary/Design_pattern', 'en-US/docs/Web/API/Observer'] },
  { match: ['安全', 'xss', 'csrf', 'sql注入', '加密', '哈希', 'jwt', 'oauth', '签名'],
    docs: ['zh-CN/docs/Web/HTTP/CSP', 'zh-CN/docs/Web/Security', 'zh-CN/docs/Web/HTTP/Authentication'] },
  { match: ['git', '分支', '合并', '变基', '标签'],
    docs: ['zh-CN/docs/Getting_started_with_Git', 'doc/github-flow'] },
  { match: ['docker', '容器', '镜像', 'k8s', 'kubernetes', '编排', 'pod'],
    docs: ['docs/setup/quick-start', 'docs/tasks/configure-pod-container'] },
  { match: ['ci', 'cd', '流水线', '灰度', '蓝绿', '金丝雀', '发布'],
    docs: ['docs/deploying-applications', 'blog/2021/08/24/kubernetes-canary-deployments.html'] },
  // ---- AI 大模型 ----
  { match: ['transformer', '注意力', 'self-attention', '多头', '位置编码', 'kv-cache'],
    docs: ['learn/nlp-course/chapter1/6', 'learn/nlp-course/chapter7/6'] },
  { match: ['token', '分词', 'tokenizer', 'bpe'],
    docs: ['learn/nlp-course/chapter6/5', 'learn/big-model/tokens', 'docs/guides/token-counting'] },
  { match: ['微调', 'lora', 'peft', 'qlora', 'rlhf', 'dpo', '对齐'],
    docs: ['learn/nlp-course/chapter11/1', 'docs/guides/fine-tuning'] },
  { match: ['rag', '检索', '嵌入', 'embedding', '向量', '重排', 'rerank'],
    docs: ['learn/nlp-course/chapter5/5', 'learn/big-model/embeddings', 'docs/guides/retrieval-augmented-generation'] },
  { match: ['agent', '工具调用', 'function-call', 'mcp', '多智能体', '编排', '规划'],
    docs: ['docs/guides/function-calling', 'docs/guides/agents', 'learn/agents'] },
  { match: ['推理', '量化', 'vllm', 'llamacpp', '投机解码', '批处理', '显存'],
    docs: ['docs/guides/latency-optimization', 'docs/guides/optimizing-llm-inference'] },
  { match: ['提示', '上下文', 'system-prompt', 'few-shot', '思维链'],
    docs: ['docs/guides/prompt-engineering', 'docs/guides/prompt-caching'] },
  { match: ['评估', 'benchmark', '幻觉', 'judge', '数据集'],
    docs: ['docs/guides/eval-methods', 'docs/guides/evaluation-best-practices'] }
]

/**
 * 精选官方源直连表：按考点关键词 → **绝对 URL**（已用 scripts/tmp-reach*.mjs 实测可达、
 * fetchText 能拿到 ≥600 字符正文）。
 *
 * 为什么不复用 DOC_HINTS：那份表挂在 SITEMAPS 的 origin 下，只对 sitemap 里的站生效，
 * 且路径写错就是 404；be/cs/eng/ai 四个域因此几乎拿不到任何官方源（探测：0/6 可起草）。
 * 这里直接给可用整页 URL，是"讲义能不能生成"的决定性一张表。
 *
 * 维护方法：新加 URL 先跑一次 tmp-reach 探测；换网络环境（如挂代理）要重新探测，
 * 被墙清单见 UNREACHABLE_HOSTS。
 */
export const HINT_SOURCES = [
  // ===== AI / 大模型（HF 与 OpenAI 本机不通，用 arXiv + LangChain + D2L + PyTorch 教程）=====
  { match: ['transformer', 'attention', 'self-attention', '多头', '位置编码', 'kv-cache', '注意力'],
    urls: ['https://arxiv.org/abs/1706.03762', 'https://zh.d2l.ai/chapter_attention-mechanisms/attention-cues.html', 'https://arxiv.org/abs/2311.05232'] },
  { match: ['token', '分词', 'tokenizer', 'bpe', '词表'],
    urls: ['https://arxiv.org/abs/2311.05232', 'https://zh.d2l.ai/chapter_attention-mechanisms/attention-cues.html'] },
  { match: ['微调', 'lora', 'peft', 'qlora', 'rlhf', 'dpo', '对齐', 'sft'],
    urls: ['https://arxiv.org/abs/2106.09685', 'https://arxiv.org/abs/2305.18290', 'https://pytorch.org/tutorials/beginner/finetuning_tutorial.html'] },
  { match: ['rag', '检索增强', '嵌入', 'embedding', '向量', '重排', 'rerank', '切块', 'chunk'],
    urls: ['https://arxiv.org/abs/2005.11401', 'https://python.langchain.com/docs/introduction/', 'https://docs.smith.langchain.com/evaluation'] },
  { match: ['agent', '智能体', '工具调用', 'function-call', 'mcp', '多智能体', '编排', '规划', '循环', '上下文预算'],
    urls: ['https://arxiv.org/abs/2201.11903', 'https://python.langchain.com/docs/introduction/', 'https://ollama.com/search'] },
  { match: ['推理优化', '量化', 'vllm', 'llamacpp', '投机解码', '批处理', '显存', '部署'],
    urls: ['https://ollama.com/search', 'https://onnx.ai/onnx/', 'https://arxiv.org/abs/2311.05232'] },
  { match: ['提示', 'prompt', 'few-shot', '思维链', 'system-prompt', '上下文工程'],
    urls: ['https://arxiv.org/abs/2201.11903', 'https://arxiv.org/abs/2005.11401'] },
  { match: ['评估', '评测', 'benchmark', '幻觉', 'judge', '数据集', '指标'],
    urls: ['https://docs.smith.langchain.com/evaluation', 'https://arxiv.org/abs/2005.11401'] },

  // ===== Java / JVM / Spring =====
  { match: ['concurrent', 'thread', '线程', 'jmm', 'volatile', 'atomic', 'lock', 'threadlocal', 'cas', 'aqs', 'pool', '线程池', '并发'],
    urls: ['https://docs.oracle.com/javase/tutorial/essential/concurrency/index.html', 'https://docs.oracle.com/javase/tutorial/essential/concurrency/runinter.html'] },
  { match: ['collection', 'hashtable', 'arraylist', 'linkedlist', 'hashmap', 'copy-on-write', 'fail-fast', '集合'],
    urls: ['https://docs.oracle.com/javase/tutorial/collections/index.html', 'https://docs.oracle.com/javase/tutorial/collections/interfaces/index.html'] },
  { match: ['io', 'nio', 'netty', 'epoll', 'bio', 'aio', 'multiplex', '多路复用'],
    urls: ['https://docs.oracle.com/javase/tutorial/essential/io/index.html', 'https://go.dev/doc/effective_go'] },
  { match: ['spring', 'ioc', 'aop', 'bean', '事务', 'transaction', 'boot', 'mvc'],
    urls: ['https://docs.spring.io/spring-framework/reference/core/beans.html', 'https://docs.spring.io/spring-framework/reference/data-access/transaction.html', 'https://docs.spring.io/spring-boot/index.html'] },

  // ===== MySQL / PostgreSQL / Redis =====
  { match: ['mysql', 'index', 'explain', 'optimizer', 'covering', 'filesort', 'join', 'slow', '索引', '慢查询', '执行计划'],
    urls: ['https://dev.mysql.com/doc/refman/8.0/en/optimization-indexes.html', 'https://dev.mysql.com/doc/refman/8.0/en/glossary.html'] },
  { match: ['transaction', 'isolation', 'lock', 'deadlock', 'mvcc', 'undo', 'redo', 'binlog', '事务', '隔离', '死锁', '锁', '日志'],
    urls: ['https://dev.mysql.com/doc/refman/8.0/en/innodb-transaction-model.html', 'https://dev.mysql.com/doc/refman/8.0/en/innodb-locking.html', 'https://www.postgresql.org/docs/current/sql-vacuum.html'] },
  { match: ['postgres', 'pgsql', 'vacuum', '索引类型', 'gist', 'gin'],
    urls: ['https://www.postgresql.org/docs/current/indexes-types.html', 'https://www.postgresql.org/docs/current/sql-vacuum.html'] },
  { match: ['redis', '数据类型', '持久化', 'rdb', 'aof', '过期', '内存淘汰', '哨兵', '集群', '分布式锁', '缓存'],
    urls: ['https://redis.io/docs/latest/develop/data-types/', 'https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/'] },

  // ===== 消息队列 / 微服务 =====
  { match: ['kafka', '分区', '重平衡', 'offset', '幂等', '事务', '消费者组'],
    urls: ['https://www.rabbitmq.com/consumers.html', 'https://www.rabbitmq.com/confirms.html', 'https://microservices.io/patterns/microservices.html'] },
  { match: ['mq', '消息', '投递', '重试', '死信', '顺序', '积压', '背压', '流量控制', 'rabbit'],
    urls: ['https://www.rabbitmq.com/confirms.html', 'https://www.rabbitmq.com/consumers.html', 'https://www.rabbitmq.com/flow-control.html'] },
  { match: ['微服务', 'micro', '熔断', '限流', '降级', '分布式事务', 'saga', '最终一致', '服务发现', '网关'],
    urls: ['https://microservices.io/patterns/microservices.html', 'https://martinfowler.com/bliki/CircuitBreaker.html', 'https://martinfowler.com/articles/patterns-of-distributed-systems/'] },

  // ===== 公共基础：算法 / OS / 网络 / Python / Go / Node =====
  { match: ['算法', '复杂度', '排序', '二叉', '堆', '图', '动态规划', '回溯', 'big-o', 'amortized'],
    urls: ['https://docs.python.org/3/howto/sorting.html', 'https://docs.python.org/3/library/itertools.html', 'https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Array/sort'] },
  { match: ['hash-table', '哈希表', '字典', 'map', 'set', 'hashtable'],
    urls: ['https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Map', 'https://docs.oracle.com/javase/tutorial/collections/interfaces/index.html', 'https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Guide/Working_with_objects'] },
  { match: ['tree', 'bst', 'traversal', '堆', 'topk', 'heap', 'trie', '树'],
    urls: ['https://docs.python.org/3/library/heapq.html', 'https://docs.python.org/3/library/itertools.html'] },
  { match: ['graph', 'shortest-path', 'bfs', 'dfs', 'dijkstra', '拓扑', '图'],
    urls: ['https://docs.python.org/3/library/itertools.html', 'https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Guide/Indexed_collections'] },
  { match: ['进程', '线程', '调度', '死锁', '页表', '虚拟内存', '缺页', 'ipc', '协程', 'gil'],
    urls: ['https://docs.python.org/3/glossary.html#term-global-interpreter-lock', 'https://docs.python.org/3/library/gc.html', 'https://doc.rust-lang.org/book/ch16-00-concurrency.html'] },
  { match: ['网络', 'tcp', 'udp', 'http', 'tls', '握手', '拥塞', 'dns', 'quic', 'cors', '缓存头', 'http/2'],
    urls: ['https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Caching', 'https://developer.mozilla.org/zh-CN/docs/Web/HTTP/CORS', 'https://developer.mozilla.org/zh-CN/docs/Web/Security'] },
  { match: ['安全', 'xss', 'csrf', 'sql注入', '加密', '哈希', 'jwt', 'oauth', '签名', 'csp'],
    urls: ['https://developer.mozilla.org/zh-CN/docs/Web/HTTP/CSP', 'https://developer.mozilla.org/zh-CN/docs/Web/Security'] },
  { match: ['python', 'asyncio', '装饰器', '生成器', '元类', '描述符', 'gc'],
    urls: ['https://docs.python.org/3/library/asyncio.html', 'https://docs.python.org/3/reference/datamodel.html', 'https://docs.python.org/3/library/gc.html'] },
  { match: ['node', 'libuv', 'eventloop', '事件循环', 'stream', '背压', 'cluster', 'worker', 'worker_threads'],
    urls: ['https://nodejs.org/docs/latest/api/stream.html', 'https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick'] },
  { match: ['golang', 'go语言', 'goroutine', 'channel', '内存模型', '调度器', 'gc'],
    urls: ['https://go.dev/ref/mem', 'https://go.dev/blog/pipelines', 'https://go.dev/doc/effective_go'] },
  { match: ['浏览器', '渲染', '回流', '重排', 'worker', '存储', 'localstorage', 'indexeddb', '事件循环'],
    urls: ['https://developer.mozilla.org/zh-CN/docs/Web/API/Web_Workers_API', 'https://developer.mozilla.org/zh-CN/docs/Web/API/Window/localStorage', 'https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Guide/Indexed_collections'] },

  // ===== 工程 / DevOps / 可观测 / 发布 =====
  { match: ['git', '分支', '合并', '变基', '标签', 'stash', 'blame', 'rebase'],
    urls: ['https://git-scm.com/docs/git-rebase', 'https://git-scm.com/docs/git-stash', 'https://git-scm.com/docs/git-blame'] },
  { match: ['docker', '容器', '镜像', 'k8s', 'kubernetes', '编排', 'pod', '探针', '资源限制', 'hpa'],
    urls: ['https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/', 'https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/', 'https://kubernetes.io/docs/reference/kubectl/cheatsheet/'] },
  { match: ['监控', '告警', '可观测', 'tracing', '链路', '日志', 'metrics', 'slo', 'prometheus', 'grafana'],
    urls: ['https://sre.google/workbook/alerting-on-slos/', 'https://prometheus.io/docs/introduction/overview/', 'https://grafana.com/docs/grafana/latest/fundamentals/getting-started/'] },
  { match: ['ci', 'cd', '流水线', '灰度', '蓝绿', '金丝雀', '发布', '基础设施即代码', 'terraform', 'jenkins', 'pipeline'],
    urls: ['https://www.jenkins.io/doc/book/pipeline/', 'https://developer.hashicorp.com/terraform/language/resources/syntax', 'https://sre.google/workbook/alerting-on-slos/'] },
  { match: ['事故', '复盘', 'postmortem', '故障', '容量', '压测', '性能'] ,
    urls: ['https://sre.google/sre-book/table-of-contents/', 'https://sre.google/workbook/alerting-on-slos/', 'https://martinfowler.com/bliki/CircuitBreaker.html'] },
  { match: ['nginx', '负载均衡', '反向代理', 'upstream'],
    urls: ['https://kubernetes.io/docs/concepts/services-networking/service/', 'https://martinfowler.com/bliki/CircuitBreaker.html'] },

  // ===== 第三轮实测补充（scripts/tmp-reach3.mjs，pipe>500 的可达页）=====
  { match: ['css', 'bfc', 'block-formatting', '格式化上下文', '层叠', 'cascade', '特异性', 'specificity', '堆叠', 'stacking', 'z-index', 'flex', 'grid', 'contain', '回流', '重排'],
    urls: ['https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_display/Block_formatting_context',
      'https://developer.mozilla.org/zh-CN/docs/Web/CSS/Cascade',
      'https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_positioned_layout/Understanding_z-index/Stacking_context',
      'https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_flexible_box_layout/Basic_concepts_of_flexbox',
      'https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_grid_layout/Basic_concepts_of_grid_layout',
      'https://developer.mozilla.org/zh-CN/docs/Web/CSS/contain'] },
  { match: ['原型', 'prototype', '继承', '闭包', 'closure', '作用域', 'this', '微任务', 'microtask', 'promise', '事件循环', 'eventloop', 'requestanimationframe', '渲染帧', '引擎', 'v8', 'jit'],
    urls: ['https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Inheritance_and_the_prototype_chain',
      'https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Closures',
      'https://developer.mozilla.org/zh-CN/docs/Web/API/HTML_DOM_API/Microtask_guide',
      'https://developer.mozilla.org/zh-CN/docs/Web/API/Window/requestAnimationFrame',
      'https://v8.dev/docs/embed'] },
  { match: ['fetch', 'indexeddb', 'idb', 'sse', 'server-sent', 'websocket', 'wasm', 'webassembly', '跨域', 'postmessage'],
    urls: ['https://developer.mozilla.org/zh-CN/docs/Web/API/Fetch_API',
      'https://developer.mozilla.org/zh-CN/docs/Web/API/IndexedDB_API',
      'https://developer.mozilla.org/zh-CN/docs/Web/API/Server-sent_events/Using_server-sent_events',
      'https://developer.mozilla.org/zh-CN/docs/WebAssembly'] },
  { match: ['rfc', '协议', '语义', '报文', '状态码', 'header', '握手', '加密套件', '1-rtt'],
    urls: ['https://datatracker.ietf.org/doc/html/rfc9110', 'https://datatracker.ietf.org/doc/html/rfc8446', 'https://datatracker.ietf.org/doc/html/rfc6455'] },
  { match: ['oauth', 'oidc', 'jwt', 'token', '鉴权', '认证', '授权', '单点登录', 'sso'],
    urls: ['https://datatracker.ietf.org/doc/html/rfc6749', 'https://datatracker.ietf.org/doc/html/rfc7519',
      'https://docs.spring.io/spring-security/reference/servlet/oauth2/index.html'] },
  { match: ['nginx', '负载均衡', '反向代理', 'upstream', '健康检查', '四层', '七层'],
    urls: ['https://nginx.org/en/docs/http/ngx_http_upstream_module.html', 'https://nginx.org/en/docs/http/load_balancing.html'] },
  { match: ['node', 'libuv', 'eventloop', 'cluster', 'worker', 'worker_threads', 'http2', '背压', 'backpressure'],
    urls: ['https://nodejs.org/docs/latest/api/cluster.html', 'https://nodejs.org/docs/latest/api/worker_threads.html',
      'https://nodejs.org/docs/latest/api/http2.html', 'https://nodejs.org/en/learn/modules/backpressuring-in-streams'] },
  { match: ['golang', 'goroutine', 'channel', '内存模型', '调度器', 'go-gc', '垃圾回收'],
    urls: ['https://go.dev/doc/gc-guide'] },
  { match: ['redis', '持久化', 'rdb', 'aof', '集群', '分片', '哨兵', '高可用', '延迟', 'io-threads', '内存淘汰'],
    urls: ['https://redis.io/docs/latest/operate/oss_and_stack/management/scaling/',
      'https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/latency/'] },
  { match: ['k8s', 'kubernetes', 'pod', '探针', 'liveness', 'readiness', '生命周期', 'service', 'ingress'],
    urls: ['https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/', 'https://kubernetes.io/docs/concepts/services-networking/service/'] },
  { match: ['helm', 'chart', 'argo', 'gitops', '声明式', 'otel', 'opentelemetry', 'tracing', '分布式追踪', 'span'],
    urls: ['https://helm.sh/docs/topics/charts/', 'https://argo-cd.readthedocs.io/en/stable/', 'https://opentelemetry.io/docs/concepts/signals/traces/'] },
  { match: ['loki', '日志聚合', 'elastic', 'elasticsearch', 'es', '倒排', '索引库', 'kibana', 'jvm'],
    urls: ['https://grafana.com/docs/loki/latest/get-started/', 'https://www.elastic.co/guide/en/elasticsearch/reference/current/jvm-options.html'] },
  { match: ['mongo', 'mongodb', '文档型', '事务', '嵌套', '数组字段'],
    urls: ['https://www.mongodb.com/docs/manual/core/transactions/', 'https://www.mongodb.com/docs/manual/indexes/'] },
  { match: ['pulsar', '消息模型', '多租户', '分层存储', 'rocketmq', 'kafka'],
    urls: ['https://pulsar.apache.org/docs/en/concepts-messaging/'] },
  { match: ['虚拟线程', 'loom', 'project-loom', 'carrier', '结构化并发', '线程池'],
    urls: ['https://openjdk.org/jeps/444', 'https://docs.oracle.com/javase/tutorial/essential/concurrency/index.html'] },
  { match: ['fastapi', 'django', 'flask', 'asgi', 'wsgi', 'orm', 'web框架'],
    urls: ['https://fastapi.tiangolo.com/async/', 'https://docs.djangoproject.com/en/5.0/topics/db/queries/'] },
  { match: ['sklearn', '机器学习', 'svm', '过拟合', '交叉验证', '准确率', '召回', 'f1', 'auc', '回归'],
    urls: ['https://scikit-learn.org/stable/modules/model_evaluation.html', 'https://scikit-learn.org/stable/modules/svm.html'] },
  { match: ['复盘', 'postmortem', '无指责', '故障演练', '混沌', '容量规划', '技术债', '演进', '遗留系统'],
    urls: ['https://sre.google/sre-book/postmortem-culture/', 'https://martinfowler.com/articles/microservice-trade-offs.html',
      'https://martinfowler.com/articles/harness-engineering.html'] }
]

export function hintDocs(nodeId) {
  const id = String(nodeId).toLowerCase()
  const out = []
  for (const h of DOC_HINTS) {
    if (h.match.some((k) => id.includes(k))) out.push(...h.docs)
  }
  return [...new Set(out)]
}

/**
 * 关键词打分：只对「URL 整页直连表」负责。
 * 规则保守，避免短词误伤（例如 id 段 io/go 不能命中 concurrent 里的 "io"）：
 * 完全相等 > 前缀互含（双方至少 4 字符）> 标题包含。
 */
export function hintTextMatch(node, matchers) {
  const segs = String(node.id ?? '').toLowerCase().split(/[._\-/]/).filter(Boolean)
  const title = String(node.title ?? '').toLowerCase()
  let score = 0
  for (const raw of matchers) {
    const k = String(raw ?? '').toLowerCase().trim()
    if (!k) continue
    if (segs.some((s) => s === k)) score += 4
    else if (k.length >= 4 && segs.some((s) => s.length >= 4 && (s.startsWith(k) || k.startsWith(s)))) score += 3
    else if (title.includes(k)) score += 2
  }
  return score
}

function urlTitle(u) {
  const seg = String(u).replace(/[#?].*$/, '').split('/').filter(Boolean).pop() ?? u
  return decodeURIComponent(seg).replace(/\.(html?|php|md)$/, '')
}

/** 直连表命中（不联网即可判定），按得分从高到低 */
export function hintUrlHits(node) {
  const scored = []
  for (const h of HINT_SOURCES) {
    const sc = hintTextMatch(node, h.match)
    if (sc > 0) for (const u of h.urls) scored.push({ url: u, title: urlTitle(u), kind: kindOf(u), score: sc })
  }
  return scored.sort((a, b) => b.score - a.score)
}

/**
 * 官方候选汇总：直连表（主力，已实测可达）优先，其次官方 sitemap 的 slug 相关性匹配。
 * 之前只走 sitemap，be/cs/eng/ai 四个域 0/6 能拿到官方源 —— 因为那些域根本没有对应 sitemap 条目。
 */
export async function officialHits(node) {
  const out = hintUrlHits(node)
  const domain = node.id.split('.')[0]
  const terms = node.id.split('.').slice(2).flatMap((seg) => seg.split(/[\-_]/)).filter((w) => w.length > 3)
  for (const entry of SITEMAPS) {
    if (!entry.domains.includes(domain)) continue
    const urls = await sitemapUrls(entry)
    const ranked = urls.map((u) => ({ u, s: scoreUrl(u, terms) })).filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s).slice(0, 3)
    for (const r of ranked) out.push({ url: r.u, title: urlTitle(r.u), kind: kindOf(r.u), score: 1 })
  }
  const seen = new Set()
  return out.filter((h) => (seen.has(h.url) ? false : (seen.add(h.url), true)))
}

/* ---------------- 二手补充：Bing 普通检索（不用 site: 语法） ---------------- */

export function unwrapBingUrl(href) {
  if (!href.includes('/ck/a')) return href
  const u = href.match(/[?&]u=([^&]+)/)
  if (!u) return href
  let raw = u[1]
  if (raw.startsWith('a1')) raw = raw.slice(2)
  try { return Buffer.from(raw, 'base64url').toString('utf8') } catch { return href }
}
export async function searchWeb(query) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-CN&count=10`
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) interview-forge-kb' }, signal: AbortSignal.timeout(12000) })
    if (!res.ok) return []
    const html = await res.text()
    const out = []
    for (const m of html.matchAll(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const href = unwrapBingUrl(m[1].replace(/&amp;/g, '&'))
      const title = m[2].replace(/<[^>]+>/g, '').trim()
      if (href.startsWith('http') && !href.includes('bing.com')) out.push({ url: href, title })
    }
    return out.slice(0, 8)
  } catch { return [] }
}

/**
 * 正文可用长度下限：很多站（kafka/apache、docs.docker.com）返回 200 但是 SPA 空壳，
 * 只有几十~几百字符。闸门若只判"非空"就会让 AI 拿空壳编内容，故要求真实正文。
 */
export const MIN_TEXT = 600
const brokenHosts = new Set(UNREACHABLE_HOSTS)
function hostOf(u) { try { return new URL(u).host } catch { return '' } }
export function brokenHostList() { return [...brokenHosts] }

export async function fetchText(url) {
  const host = hostOf(url)
  if (brokenHosts.has(host)) return ''
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 interview-forge-kb' }, signal: AbortSignal.timeout(15000) })
    // 403/429/5xx 视为整站对本机封锁（反爬 / 过载），本轮不再浪费该站其它 URL；
    // 404 只算单页失效（我们自拼的 hint 路径常有偏差），不能因此拉黑整站
    if (!res.ok) { if (res.status === 403 || res.status === 429 || res.status >= 500) brokenHosts.add(host); return '' }
    const html = await res.text()
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ').replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/\s+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
    return text.slice(0, 9000)
  } catch { brokenHosts.add(host); return '' }   // 连接被重置/超时：本机到不了这台站
}

/* ---------------- 质量闸门（真源在 knowledge-core，这里只包装一致性校验） ---------------- */

export function qualityGate(md, validNodeIds, nodeId) {
  const parsed = parseKnowledgeMd(md)
  const qc = qualityCheck({ meta: parsed.meta, sections: parsed.sections, bodyMd: parsed.bodyMd }, validNodeIds)
  const flags = [...qc.flags]
  if (parsed.meta?.node && parsed.meta.node !== nodeId) flags.push(`node 字段不匹配：${parsed.meta.node} ≠ ${nodeId}`)
  return { ok: flags.length === 0, flags }
}

export function outPath(kbDir, nodeId) {
  const segs = String(nodeId).split('.')
  const file = segs.slice(2).join('.') || segs[1]
  return join(kbDir, segs[0], segs[1] ?? 'misc', `${file}.md`)
}

/* ---------------- 起草 prompt ---------------- */

export function draftPrompt(node, snippets, prereqIds) {
  const system = `你是技术教练，正在为一个考点写学习讲义，读者是想把基础打牢的工程师。
硬性要求：
1. 严格使用下面八个二级小节（## 一句话本质 / ## 为什么需要它 / ## 机制讲清楚 / ## 关键结论 / ## 常见误区 / ## 常见问法 / ## 前置知识 / ## 相关），一个都不能少；
2. 事实只能来自「参考材料」，每个关键结论后用上标 [^n] 标注对应来源序号，禁止编造材料外的 API、参数与版本号；
3. 代码块必须标注语言且可运行/可对照，单块不超过 30 行；
4. 「前置知识」与「相关」两个小节都用 [[node-id]] 双链（可用 id 见输入），不要发明 id；若确实没有可用 id，相关小节保留标题并写一句说明，不得留空；
5. 正文（不含代码）不少于 900 字，语言准确但通俗，先讲是什么再讲为什么。
6. **先把八个小节各写一段，再考虑展开**：「机制讲清楚」控制在 600 字以内。缺小节比每节偏短严重得多——实测本机模型常在第三节写太久，导致后面五个小节直接没输出。
输出只含 YAML frontmatter + Markdown 正文，不要任何解释。frontmatter 字段：node/title/sources(url,title,kind 列表)/updated(ISO 日期)/generator: kb-draft@1/reviewed: false/confidence。`
  const user = `# 考点
id: ${node.id}
标题：${node.title}
能力要求：${node.summary ?? '（无）'}
可用于双链的前置 id：${prereqIds ?? '（无外部前置，前置知识小节可写基础概念而不用双链）'}

# 参考材料（事实唯一来源，[^n] 的序号按下面顺序）
${snippets.map((s, i) => `[^${i + 1}] ${s}`).join('\n\n---\n\n')}

请按八个小节起草（最后一节是「相关」），frontmatter 的 sources 与上面材料一一对应，confidence 在有多条 official 且互相印证时写 high，否则 medium。`
  return { system, user }
}

/* ---------------- 草稿修补（本机小模型常犯的结构问题，机器能补的就别丢） ---------------- */

/** 把实际抓到的来源写进 frontmatter —— 模型复述 URL 经常漏条数或改 kind，程序来写更可靠 */
export function ensureMetaAndSources(md, node, fetched) {
  const norm = String(md ?? '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const m = norm.match(/^---\n([\s\S]*?)\n---/)
  let head = m ? m[1] : ''
  let body = m ? norm.slice(m[0].length) : norm
  const setScalar = (key, val) => {
    const re = new RegExp(`^${key}:.*$`, 'm')
    if (re.test(head)) head = head.replace(re, `${key}: ${val}`)
    else head = `${key}: ${val}\n` + head
  }
  // sources 整段替换为真实抓取结果（缩进两格的对象数组，与手写讲义同一格式）
  const srcBlock = ['sources:', ...fetched.flatMap((s) => [
    `  - url: ${s.url}`,
    `    title: ${String(s.title ?? s.url).replace(/[:#]/g, ' ').trim()}`,
    `    kind: ${s.kind}`
  ])].join('\n')
  if (/^sources:/m.test(head)) head = head.replace(/^sources:[\s\S]*?(?=^\S)/m, srcBlock + '\n')
  else head = `title: ${node.title}\n` + head.replace(/^title:.*$/m, (t) => t) + '\n' + srcBlock + '\n'
  setScalar('node', node.id)
  if (!/^title:/m.test(head)) head = `title: ${node.title}\n` + head
  setScalar('updated', new Date().toISOString().slice(0, 19) + 'Z')
  setScalar('generator', 'kb-draft@1')
  setScalar('reviewed', 'false')
  if (!/^confidence:/m.test(head)) head += 'confidence: medium\n'
  return `---\n${head.trim()}\n---${body}`
}

/** 尾部两节（前置知识 / 相关）用图谱里真实存在的 id 补齐；没有可用 id 就写说明句，绝不发明 id */
export function ensureTailSections(md, prereqIds, siblingIds) {
  const parsed = parseKnowledgeMd(md)
  const has = (name) => String(parsed.sections?.[name] ?? '').trim().length > 0
  const links = (ids) => ids.length ? ids.map((i) => `- [[${i}]]`).join('\n') : '（本考点是其模块下的入口考点，无外部前置，建议直接掌握本节）'
  let out = md
  if (!has('前置知识')) {
    const block = `## 前置知识\n\n${links(prereqIds)}\n`
    if (/^## 相关/m.test(out)) out = out.replace(/^## 相关/m, block + '\n## 相关')
    else out = out.trimEnd() + '\n\n' + block
  }
  if (!has('相关')) {
    const alt = siblingIds.length ? siblingIds.map((i) => `- [[${i}]]`).join('\n') : '（同模块暂无相邻考点可对照，后续铺量时补）'
    out = out.trimEnd() + `\n\n## 相关\n\n${alt}\n`
  }
  return out
}

/**
 * 缺关键小节时的一次 AI 续写：本机模型常在「机制讲清楚」里写太久导致后面全丢
 * （实测 loop-dynamics 草稿只有 3 个小节）。续写比重跑省一半时间，也不会推翻已写好的内容。
 */
export async function completeMissingSections(md, node, ctx, fetched) {
  const parsed = parseKnowledgeMd(md)
  const missing = REQUIRED_SECTIONS.filter((n) => !String(parsed.sections?.[n] ?? '').trim())
  if (!missing.length) return { md, added: [] }
  if (!ctx.chat) return { md, added: missing }
  const system = `你在补写一份学习讲义里缺失的小节，必须与已有正文风格一致、事实只来自给定来源。
硬性要求：只输出缺失的那些二级小节（形如：## 名称），不要重复已有内容、不要任何解释文字；
每节不少于 200 字；代码块必须标语言且不超过 30 行；关键结论后标 [^n] 来源序号。`
  const user = `考点：${node.title}（id: ${node.id}）
缺失小节：${missing.join('、')}
已有正文结尾片段（用于衔接，不要重复它）：
"""
${String(md).slice(-1200)}
"""
可用来源（[^n] 按此顺序）：
${fetched.map((s, i) => `[^${i + 1}] ${s.title} — ${s.url}`).join('\n')}
来源正文摘录：
${(ctx.snippets ?? []).join('\n\n---\n\n').slice(0, 6000)}`
  try {
    const extra = await ctx.chat(system, user)
    const cleaned = String(extra ?? '').replace(/^```(?:markdown|md)?\s*/i, '').replace(/```\s*$/, '').trim()
    if (!cleaned) return { md, added: missing }
    return { md: md.trimEnd() + '\n\n' + cleaned + '\n', added: missing }
  } catch {
    return { md, added: missing }
  }
}

/* ---------------- 单节点完整管道 ---------------- */

/**
 * ctx 注入项：
 *   chat(system, user) → md 文本（AI 起草）
 *   prereqOf(nodeId)   → 逗号分隔的前置 id 字符串 | null
 *   validNodeIds       → Set<string>
 *   kbDir              → content/knowledge 绝对路径
 *   force/dry/noAi     → 行为开关
 *   staleDir           → 过闸失败落盘目录（默认 kbDir/_stale）
 */
export async function buildDraft(node, ctx) {
  const target = outPath(ctx.kbDir, node.id)
  if (existsSync(target) && !ctx.force) {
    const head = readFileSync(target, 'utf8').slice(0, 400)
    if (!/confidence:\s*low/.test(head)) return { node: node.id, status: 'skip-exists', path: target }
  }
  const official = await officialHits(node)
  const extra = await searchWeb(`${node.title} 原理 源码`)
  const seen = new Set()
  const sources = []
  for (const h of [...official, ...extra]) {
    if (seen.has(h.url)) continue
    seen.add(h.url)
    if (brokenHosts.has(hostOf(h.url))) continue     // 本机到不了的站直接不列，省 15-21s/篇
    sources.push({ ...h, kind: kindOf(h.url) })
  }
  const KIND_RANK = { official: 0, source: 1, doc: 2, article: 3 }
  sources.sort((a, b) => (KIND_RANK[a.kind] - KIND_RANK[b.kind]) || ((b.score ?? 0) - (a.score ?? 0)))
  const picked = sources.slice(0, 6)
  if (!picked.some((s) => s.kind === 'official')) return { node: node.id, status: 'no-official', sources: picked.length }

  // 逐源抓正文：够 3 篇就停（每篇 9000 字已够模型写讲义，多抓只是拖时间与挤爆上下文）
  const fetched = []
  const snippets = []
  for (const s of picked) {
    if (fetched.length >= 3) break
    const text = await fetchText(s.url)
    if (text.length < MIN_TEXT) continue
    fetched.push({ url: s.url, title: s.title, kind: s.kind })
    // 单篇来源压到 3000 字：3 篇 = 9000 字符输入，足够写 900 字讲义；
    // 之前 3×5000 让本地模型生成普遍超过 150 秒（ai_log 实测成功均值 121 秒，大量超时）。
    snippets.push(`# 来源：${s.title}\nURL: ${s.url}（kind=${s.kind}）\n\n${text.slice(0, 3000)}`)
  }
  if (fetched.length < 2) return { node: node.id, status: 'fetch-thin', fetched: fetched.length }
  if (ctx.noAi) return { node: node.id, status: 'sources-only', sources: fetched.length }

  const prereqIds = String(ctx.prereqOf?.(node.id) ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const siblingIds = (ctx.siblingsOf?.(node.id) ?? []).filter((id) => id !== node.id)
  const { system, user } = draftPrompt(node, snippets, prereqIds.join(', ') || null)
  let md = await ctx.chat(system, user)

  // 修补链：先用图谱事实补齐尾部两节（零成本），仍缺硬骨头小节再做一次续写，
  // 最后由程序覆写 frontmatter 的来源与机器字段。三件事都做完才过闸 —— 之前是模型
  // 少写「## 前置知识」「## 相关」就直接进 _stale，用户看到的永远是"生成失败"。
  md = ensureTailSections(md, prereqIds, siblingIds)
  const comp = await completeMissingSections(md, node, { ...ctx, snippets }, fetched)
  md = ensureMetaAndSources(comp.md, node, fetched)
  const repaired = [...(prereqIds.length || siblingIds.length ? ['tail-sections'] : []), ...(comp.added.length ? [`ai-complete:${comp.added.join('/')}`] : [])]

  const gate = qualityGate(md, ctx.validNodeIds, node.id)
  if (ctx.dry) return { node: node.id, status: 'dry', gate, repaired, preview: md.slice(0, 200) }
  if (!gate.ok) {
    const staleDir = ctx.staleDir ?? join(ctx.kbDir, '_stale')
    mkdirSync(staleDir, { recursive: true })
    writeFileSync(join(staleDir, `${node.id.replace(/\./g, '-')}.md`), `<!-- gate failed: ${gate.flags.join('; ')}${repaired.length ? ` | repaired: ${repaired.join(', ')}` : ''} -->\n${md}`, 'utf8')
    return { node: node.id, status: 'stale', flags: gate.flags, repaired }
  }
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, md, 'utf8')
  return { node: node.id, status: 'written', path: target, sources: fetched.length, repaired, words: md.replace(/\s/g, '').length }
}
