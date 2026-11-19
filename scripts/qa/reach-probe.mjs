// 可达性矩阵：逐 URL 实测 HTTP 状态 + 正文可用字节数。
// 决定 DOC_HINTS 里哪些路径是真的能抓到（fetchText 失败最常见原因是 404 路径写错 / 403 反爬）。
const CANDIDATES = [
  // --- MDN：zh-CN vs en-US 路径形态对比 ---
  ['MDN-zh', 'https://developer.mozilla.org/zh-CN/docs/Web/HTTP/CORS'],
  ['MDN-en', 'https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS'],
  ['MDN-zh-storage', 'https://developer.mozilla.org/zh-CN/docs/Web/API/Window/localStorage'],
  ['MDN-zh-complexity', 'https://developer.mozilla.org/zh-CN/docs/Glossary/Complexity'],
  ['MDN-zh-collections', 'https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Guide/Indexed_collections'],
  ['MDN-zh-csp', 'https://developer.mozilla.org/zh-CN/docs/Web/HTTP/CSP'],
  ['MDN-sitemap', 'https://developer.mozilla.org/sitemaps/zh-CN/sitemap.xml'],
  // --- Java / JVM ---
  ['Oracle-concurrency', 'https://docs.oracle.com/javase/tutorial/essential/concurrency/index.html'],
  ['Oracle-collections', 'https://docs.oracle.com/javase/tutorial/collections/index.html'],
  ['DevJava-concurrency', 'https://dev.java/learn/concurrency/'],
  ['OpenJDK-gc', 'https://openjdk.org/projects/jvm.html'],
  // --- MySQL（正确 refman 前缀）---
  ['MySQL-tx', 'https://dev.mysql.com/doc/refman/8.0/en/innodb-transaction-model.html'],
  ['MySQL-index', 'https://dev.mysql.com/doc/refman/8.0/en/optimization-indexes.html'],
  ['MySQL-old-path', 'https://dev.mysql.com/en/select-statement.html'],
  // --- Redis ---
  ['Redis-datatypes', 'https://redis.io/docs/latest/develop/data-types/'],
  ['Redis-persistence', 'https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/'],
  ['Redis-sitemap', 'https://redis.io/sitemap.xml'],
  // --- Kafka / MQ ---
  ['Kafka-doc', 'https://kafka.apache.org/documentation/'],
  ['Kafka-semantics', 'https://kafka.apache.org/documentation/#semantics'],
  ['Rabbit-confirms', 'https://www.rabbitmq.com/confirms.html'],
  // --- Python / Node / Go ---
  ['Py-asyncio', 'https://docs.python.org/3/library/asyncio.html'],
  ['Py-datamodel', 'https://docs.python.org/3/reference/datamodel.html'],
  ['Node-stream', 'https://nodejs.org/docs/latest/api/stream.html'],
  ['Node-eventloop', 'https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick'],
  ['Node-hint-wrong', 'https://nodejs.org/latest/api/stream.html'],
  ['Go-effective', 'https://go.dev/doc/effective_go'],
  // --- 云原生 / DevOps ---
  ['K8s-concepts', 'https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/'],
  ['K8s-quickstart', 'https://kubernetes.io/docs/setup/quick_start'],
  ['K8s-sitemap', 'https://kubernetes.io/sitemap.xml'],
  ['Docker-getstart', 'https://docs.docker.com/get-started/'],
  ['Git-branch', 'https://git-scm.com/book/zh/v2/Git-%E5%88%86%E6%94%AF-%E5%88%86%E6%94%AF%E7%AE%80%E8%BF%B0'],
  // --- AI ---
  ['HF-nlp1', 'https://huggingface.co/learn/nlp-course/chapter1/6'],
  ['HF-embed', 'https://huggingface.co/learn/big-model/tokens'],
  ['HF-agents', 'https://huggingface.co/learn/agents/unit1/chapter1'],
  ['OpenAI-fc', 'https://platform.openai.com/docs/guides/function-calling'],
  ['OpenAI-rag', 'https://platform.openai.com/docs/guides/retrieval-augmented-generation'],
  ['Arxiv-attn', 'https://arxiv.org/abs/1706.03762'],
  // --- 微服务 / 工程 ---
  ['Micro-patterns', 'https://microservices.io/patterns/microservices.html'],
  ['Fowler-disttx', 'https://martinfowler.com/articles/patterns-of-distributed-systems/'],
  ['SRE-book', 'https://sre.google/sre-book/management-of-risk/'],
  // --- 中文可达候选（放宽闸门时用）---
  ['Zhihu?', 'https://www.zhihu.com/topic/19550617/hot'],
  ['Juejin-search', 'https://juejin.cn/search?query=hash'],
  ['Wikipedia-zh', 'https://zh.wikipedia.org/wiki/%E5%93%88%E5%B8%8C%E8%A1%A8'],
  ['Runoob', 'https://www.runoob.com/python3/python3-asyncio.html']
]

import('../kb-draft-core.mjs').then(async ({ fetchText, kindOf }) => {
  const CONC = Number(process.argv[2] ?? 4)
  let i = 0
  const rows = []
  async function worker() {
    while (i < CANDIDATES.length) {
      const [label, url] = CANDIDATES[i++]
      const t0 = Date.now()
      let status = 'ERR', bytes = 0
      try {
        const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) interview-forge-probe' }, signal: AbortSignal.timeout(15000), redirect: 'follow' })
        status = String(res.status)
        const html = await res.text()
        const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
        bytes = text.length
      } catch (e) { status = 'EX:' + String(e?.name ?? e).slice(0, 12) }
      // 同时测 fetchText（管道真正用的那个函数）能否拿到 ≥500 字正文
      const pipe = (await fetchText(url)).length
      rows.push({ label, host: new URL(url).host, kind: kindOf(url), status, bytes, pipe, ms: Date.now() - t0 })
      console.log(`${String(rows.length).padStart(2)} ${status.padEnd(14)} raw=${String(bytes).padStart(7)} pipe=${String(pipe).padStart(6)} ${(Date.now() - t0 + 'ms').padStart(7)}  ${label}  ${new URL(url).host}`)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, CANDIDATES.length) }, worker))
  const byHost = {}
  for (const r of rows) {
    const b = (byHost[r.host] ??= { n: 0, ok: 0, kinds: new Set() })
    b.n++; if (r.pipe > 500) b.ok++; b.kinds.add(r.kind)
  }
  console.log('\n=== 按主机汇总（pipe>500 视为可用）===')
  for (const [h, b] of Object.entries(byHost).sort((a, b) => b[1].ok / b[1].n - a[1].ok / a[1].n))
    console.log(`${b.ok}/${b.n}  ${h}  kind=${[...b.kinds].join('/')}`)
})
