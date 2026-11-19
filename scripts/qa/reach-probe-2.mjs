// 可达性探测第二轮：为 be/cs/eng/ai 找真能抓到正文的官方页（第一轮已证：HF/Wikipedia/OpenAI 不通或 403，
// kafka/docker/git/dev.java/openjdk/sre 拿不到正文）。pipe>500 视为可用。
const CANDIDATES = [
  // ---- AI 域候选官方源 ----
  ['PyTorch-bp', 'https://pytorch.org/tutorials/beginner/basics/autogradqs_tutorial.html'],
  ['PyTorch-home', 'https://pytorch.org/docs/stable/generated/torch.nn.Transformer.html'],
  ['TF-keras', 'https://www.tensorflow.org/guide/keras/training_with_builtin_trainingloop'],
  ['LangChain-rag', 'https://python.langchain.com/docs/introduction/'],
  ['LangSmith-eval', 'https://docs.smith.langchain.com/evaluation'],
  ['Ollama', 'https://ollama.com/search'],
  ['ONNX', 'https://onnx.ai/onnx/'],
  ['OpenReview', 'https://openreview.net/forum?id=B1MDtUYPH'],
  ['Arxiv-rag', 'https://arxiv.org/abs/2005.11401'],
  ['Arxiv-lora', 'https://arxiv.org/abs/2106.09685'],
  ['Arxiv-cot', 'https://arxiv.org/abs/2201.11903'],
  ['Arxiv-dpo', 'https://arxiv.org/abs/2305.18290'],
  ['Arxiv-mhatt', 'https://arxiv.org/abs/2311.05232'],
  ['Scikit-ml', 'https://scikit-learn.org/stable/tutorial/statistical_inference/supervised_learning.html'],
  ['D2L-zh', 'https://zh.d2l.ai/chapter_attention-mechanisms/attention-cues.html'],
  ['Transformers-book-zh', 'https://huggingface.co/course/zh/chapter1/4'],
  // ---- be：Java / JVM / MySQL / Redis / MQ ----
  ['Oracle-threads', 'https://docs.oracle.com/javase/tutorial/essential/concurrency/runinter.html'],
  ['Oracle-collections-iface', 'https://docs.oracle.com/javase/tutorial/collections/interfaces/index.html'],
  ['Oracle-io', 'https://docs.oracle.com/javase/tutorial/essential/io/index.html'],
  ['Spring-ioc', 'https://docs.spring.io/spring-framework/reference/core/beans.html'],
  ['Spring-tx', 'https://docs.spring.io/spring-framework/reference/data-access/transaction.html'],
  ['Spring-boot', 'https://docs.spring.io/spring-boot/index.html'],
  ['MySQL-lock', 'https://dev.mysql.com/doc/refman/8.0/en/innodb-locking.html'],
  ['MySQL-mvcc?', 'https://dev.mysql.com/doc/refman/8.0/en/glossary.html'],
  ['Redis-transactions', 'https://redis.io/docs/latest/develop/interact/transactions/'],
  ['Redis-cluster', 'https://redis.io/docs/latest/operate/rs/databases/durability-ok/'],
  ['Rabbit-consume', 'https://www.rabbitmq.com/consumers.html'],
  ['Rabbit-flow', 'https://www.rabbitmq.com/flow-control.html'],
  ['RocketMQ?', 'https://rocketmq.apache.org/docs/domainModel/01intro/'],
  ['Kafka-static', 'https://kafka.apache.org/38/documentation.html'],
  ['Kafka-design', 'https://kafka.apache.org/38/documentation/#design'],
  ['Nacos?', 'https://nacos.io/en/docs/latest/manual/user/docker/'],
  ['PgSQL-vacuum', 'https://www.postgresql.org/docs/current/sql-vacuum.html'],
  ['PgSQL-index', 'https://www.postgresql.org/docs/current/indexes-types.html'],
  // ---- cs：算法 / OS / 网络（可达官方）----
  ['MDN-hash?', 'https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Guide/Working_with_objects'],
  ['MDN-sort', 'https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Array/sort'],
  ['MDN-map', 'https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Map'],
  ['MDN-worker', 'https://developer.mozilla.org/zh-CN/docs/Web/API/Web_Workers_API'],
  ['MDN-http-cache', 'https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Caching'],
  ['MDN-tls?', 'https://developer.mozilla.org/zh-CN/docs/Web/Security'],
  ['Go-tour-conc', 'https://go.dev/tour/concurrency/1'],
  ['Go-spec-mem', 'https://go.dev/ref/mem'],
  ['Go-blog-waitgroup', 'https://go.dev/blog/pipelines'],
  ['Py-gil?', 'https://docs.python.org/3/glossary.html#term-global-interpreter-lock'],
  ['Py-gc', 'https://docs.python.org/3/library/gc.html'],
  ['Py-itertools', 'https://docs.python.org/3/library/itertools.html'],
  ['Py-sorthowto', 'https://docs.python.org/3/howto/sorting.html'],
  ['Node-clustering', 'https://nodejs.org/en/learn/scalability/cluster-concepts'],
  ['Node-workers', 'https://nodejs.org/en/learn/worker-options'],
  // ---- eng：可观测 / K8s / 发布 / Git ----
  ['K8s-probes', 'https://kubernetes.io/docs/tasks/configure-container/container-health-checks/'],
  ['K8s-resources', 'https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/'],
  ['K8s-hpa', 'https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/'],
  ['K8s-deploy-cmd', 'https://kubernetes.io/docs/reference/kubectl/cheatsheet/'],
  ['Prometheus?', 'https://prometheus.io/docs/introduction/overview/'],
  ['Grafana?', 'https://grafana.com/docs/grafana/latest/fundamentals/getting-started/'],
  ['Git-doc-stash', 'https://git-scm.com/docs/git-stash'],
  ['Git-doc-rebase', 'https://git-scm.com/docs/git-rebase'],
  ['Git-doc-blame', 'https://git-scm.com/docs/git-blame'],
  ['Terraform?', 'https://developer.hashicorp.com/terraform/language/resources/syntax'],
  ['Jenkins?', 'https://www.jenkins.io/doc/book/pipeline/'],
  ['GHActions?', 'https://docs.github.com/en/actions/writing-workflows/workflow-choice/choosing-how-to-approve-workflow-runs'],
  ['Fowler-circuit', 'https://martinfowler.com/bliki/CircuitBreaker.html'],
  ['SRE-alerting', 'https://sre.google/workbook/alerting-on-slos/'],
  ['Google-SRE-book', 'https://sre.google/sre-book/table-of-contents/']
]

import('../kb-draft-core.mjs').then(async ({ fetchText, kindOf }) => {
  const CONC = Number(process.argv[2] ?? 4)
  let i = 0
  const rows = []
  async function worker() {
    while (i < CANDIDATES.length) {
      const [label, url] = CANDIDATES[i++]
      const t0 = Date.now()
      let status = 'ERR'
      try {
        const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) interview-forge-probe' }, signal: AbortSignal.timeout(15000), redirect: 'follow' })
        status = String(res.status)
        await res.text().catch(() => '')
      } catch (e) { status = 'EX:' + String(e?.name ?? e).slice(0, 12) }
      const pipe = (await fetchText(url)).length
      rows.push({ host: new URL(url).host, kind: kindOf(url), status, pipe })
      console.log(`${String(rows.length).padStart(2)} ${status.padEnd(14)} pipe=${String(pipe).padStart(6)} ${((Date.now() - t0) + 'ms').padStart(7)}  ${label.padEnd(22)} ${new URL(url).host}`)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, CANDIDATES.length) }, worker))
  const byHost = {}
  for (const r of rows) { const b = (byHost[r.host] ??= { n: 0, ok: 0 }); b.n++; if (r.pipe > 500) b.ok++ }
  console.log('\n=== 按主机 ===')
  for (const [h, b] of Object.entries(byHost).sort((a, b) => b[1].ok / b[1].n - a[1].ok / a[1].n)) console.log(`${b.ok}/${b.n}  ${h}`)
})
