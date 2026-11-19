// 可达性探测第三轮（最后一批）：为仍缺官方源的堆栈补候选 URL。
// pipe>500 视为可用；EX/TypeError 视为被墙，将写入 UNREACHABLE_HOSTS 直接跳过（省 21s/篇）。
const CANDIDATES = [
  ['PyTorch-nn.Transformer', 'https://pytorch.org/docs/stable/generated/torch.nn.Transformer.html'],
  ['PyTorch-finetune', 'https://pytorch.org/tutorials/beginner/finetuning_tutorial.html'],
  ['TF-gitea?', 'https://github.com/tensorflow/docs/blob/master/site/en/guide/keras/training_with_builtin_trainingloop.md'],
  ['Sklearn-intro', 'https://scikit-learn.org/stable/tutorial/basic/tutorial.html'],
  ['Sklearn-metrics', 'https://scikit-learn.org/stable/modules/model_evaluation.html'],
  ['Sklearn-svm', 'https://scikit-learn.org/stable/modules/svm.html'],
  ['FastAPI?', 'https://fastapi.tiangolo.com/async/'],
  ['Django-orm?', 'https://docs.djangoproject.com/en/5.0/topics/db/queries/'],
  ['Redis-persist', 'https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/'],
  ['Redis-cluster-howto', 'https://redis.io/docs/latest/operate/oss_and_stack/management/scaling/'],
  ['Redis-io-threads', 'https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/latency/'],
  ['Redis-eval', 'https://redis.io/docs/latest/develop/interact/programmability/eval-intro/'],
  ['Kafka-zk?', 'https://kafka.apache.org/documentation/#architecture'],
  ['RocketMQ-arch', 'https://rocketmq.apache.org/docs/4.x/architecture/'],
  ['Pulsar?', 'https://pulsar.apache.org/docs/en/concepts-messaging/'],
  ['Minio?', 'https://min.io/docs/minio/linux/index.html'],
  ['ES-jvm?', 'https://www.elastic.co/guide/en/elasticsearch/reference/current/jvm-options.html'],
  ['Mongo-tx', 'https://www.mongodb.com/docs/manual/core/transactions/'],
  ['Mongo-index', 'https://www.mongodb.com/docs/manual/indexes/'],
  ['Cassandra?', 'https://cassandra.apache.org/doc/latest/cassandra/architecture/accessing.html'],
  ['TiDB?', 'https://docs.pingcap.com/tidb/stable/tidb-best-practices/'],
  ['Node-cluster-docs', 'https://nodejs.org/docs/latest/api/cluster.html'],
  ['Node-worker-docs', 'https://nodejs.org/docs/latest/api/worker_threads.html'],
  ['Node-http2', 'https://nodejs.org/docs/latest/api/http2.html'],
  ['Node-stream-concepts', 'https://nodejs.org/en/learn/modules/backpressuring-in-streams'],
  ['Go-context', 'https://go.dev/blog/context-and-structure'],
  ['Go-gc-trace', 'https://go.dev/doc/gc-guide'],
  ['Go-scheduler?', 'https://github.com/golang/go/blob/master/src/runtime/proc.go'],
  ['Deno?', 'https://deno.land/manual@v1.44.4/runtime/fundamentals'],
  ['K8s-probe2', 'https://kubernetes.io/docs/tasks/configure-container/container-health-checks/'],
  ['K8s-probe3', 'https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/'],
  ['K8s-network', 'https://kubernetes.io/docs/concepts/services-networking/service/'],
  ['Istio?', 'https://istio.io/latest/docs/ops/deployment/requirements/'],
  ['Helm-charts', 'https://helm.sh/docs/topics/charts/'],
  ['ArgoCD?', 'https://argo-cd.readthedocs.io/en/stable/'],
  ['OpenTelemetry-trace', 'https://opentelemetry.io/docs/concepts/signals/traces/'],
  ['Grafana-loki?', 'https://grafana.com/docs/loki/latest/get-started/'],
  ['ELK?', 'https://www.elastic.co/guide/en/elastic-stack-get-started/current/get-started-stack-monitoring.html'],
  ['Nginx-conf', 'https://nginx.org/en/docs/http/ngx_http_upstream_module.html'],
  ['Nginx-lb', 'https://nginx.org/en/docs/http/load_balancing.html'],
  ['HAProxy?', 'https://www.haproxy.com/blog/load-balancing-basics/'],
  ['OAuth-rfc', 'https://datatracker.ietf.org/doc/html/rfc6749'],
  ['JWT-rfc', 'https://datatracker.ietf.org/doc/html/rfc7519'],
  ['TLS-rfc', 'https://datatracker.ietf.org/doc/html/rfc8446'],
  ['HTTP-rfc', 'https://datatracker.ietf.org/doc/html/rfc9110'],
  ['WebSocket-rfc', 'https://datatracker.ietf.org/doc/html/rfc6455'],
  ['MDN-fetch', 'https://developer.mozilla.org/zh-CN/docs/Web/API/Fetch_API'],
  ['MDN-eventloop', 'https://developer.mozilla.org/zh-CN/docs/Web/HTML/Performance_and_gaming/Concurrency_model_and_worker_interfaces/Using_web_workers'],
  ['MDN-dns', 'https://developer.mozilla.org/zh-CN/docs/Glossary/DNS_prefetching'],
  ['MDN-idb', 'https://developer.mozilla.org/zh-CN/docs/Web/API/IndexedDB_API'],
  ['MDN-sse', 'https://developer.mozilla.org/zh-CN/docs/Web/API/Server-sent_events/Using_server-sent_events'],
  ['MDN-wasm', 'https://developer.mozilla.org/zh-CN/docs/WebAssembly'],
  ['V8-blog?', 'https://v8.dev/docs/embed'],
  ['TC39-proposals', 'https://github.com/tc39/proposals'],
  ['AOSP-binder?', 'https://developer.android.com/guide/components/ipc'],
  ['iOS-gcd?', 'https://developer.apple.com/documentation/dispatch'],
  ['Rust-book', 'https://doc.rust-lang.org/book/ch16-00-concurrency.html'],
  ['Rust-mysql?', 'https://www.rust-lang.org/learn'],
  ['Cpp-ref?', 'https://en.cppreference.com/w/cpp/thread/mutex'],
  ['Java-loom?', 'https://openjdk.org/projects/loom/'],
  ['JEP-444', 'https://openjdk.org/jeps/444'],
  ['Spring-cloud-circuit', 'https://spring.io/blog/2019/02/13/microservices-with-spring-circuit-breaker-patterns-with-spring-cloud'],
  ['Spring-security-oauth', 'https://docs.spring.io/spring-security/reference/servlet/oauth2/index.html'],
  ['Fowler-microservices', 'https://martinfowler.com/articles/microservice-trade-offs.html'],
  ['Fowler-evolution', 'https://martinfowler.com/articles/harness-engineering.html'],
  ['SRE-postmortem', 'https://sre.google/sre-book/postmortem-culture/'],
  ['SRE-canary', 'https://sre.google/workbook/canary-review-release-process/'],
  ['Google-papers-gfs?', 'https://research.google/pubs/pub51/'],
  // ---- 前端 CSS / JS 引擎（bfc、层叠、事件循环等）----
  ['MDN-BFC', 'https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_display/Block_formatting_context'],
  ['MDN-cascade', 'https://developer.mozilla.org/zh-CN/docs/Web/CSS/Cascade'],
  ['MDN-stacking', 'https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_positioned_layout/Understanding_z-index/Stacking_context'],
  ['MDN-flex', 'https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_flexible_box_layout/Basic_concepts_of_flexbox'],
  ['MDN-grid', 'https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_grid_layout/Basic_concepts_of_grid_layout'],
  ['MDN-containment', 'https://developer.mozilla.org/zh-CN/docs/Web/CSS/contain'],
  ['MDN-microtasks', 'https://developer.mozilla.org/zh-CN/docs/Web/API/HTML_DOM_API/Microtask_guide'],
  ['MDN-rAF', 'https://developer.mozilla.org/zh-CN/docs/Web/API/Window/requestAnimationFrame'],
  ['MDN-prototype', 'https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Inheritance_and_the_prototype_chain'],
  ['MDN-closures', 'https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Closures'],
  ['MDN-eventloop-tips', 'https://developer.mozilla.org/zh-CN/docs/Web/HTML/Performance_and_gaming/Application_competitiveness_with_cooperative_event_loops'],
  ['MDN-perf-nav-timing', 'https://developer.mozilla.org/zh-CN/docs/Web/API/Performance'],
  ['MDN-intl?', 'https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Intl']
]

import('../kb-draft-core.mjs').then(async ({ fetchText, kindOf }) => {
  const CONC = Number(process.argv[2] ?? 5)
  let i = 0
  const rows = []
  async function worker() {
    while (i < CANDIDATES.length) {
      const [label, url] = CANDIDATES[i++]
      const t0 = Date.now()
      let status = 'ERR'
      try { const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 interview-forge-probe' }, signal: AbortSignal.timeout(15000), redirect: 'follow' }); status = String(res.status); await res.text().catch(() => '') } catch (e) { status = 'EX:' + String(e?.name ?? e).slice(0, 10) }
      const pipe = (await fetchText(url)).length
      rows.push({ host: new URL(url).host, status, pipe })
      console.log(`${String(rows.length).padStart(2)} ${status.padEnd(14)} pipe=${String(pipe).padStart(6)} ${(((Date.now() - t0)) + 'ms').padStart(7)}  ${label.padEnd(24)} ${new URL(url).host}`)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, CANDIDATES.length) }, worker))
  const byHost = {}
  for (const r of rows) { const b = (byHost[r.host] ??= { n: 0, ok: 0 }); b.n++; if (r.pipe > 500) b.ok++ }
  console.log('\n=== 按主机 ===')
  for (const [h, b] of Object.entries(byHost).sort((a, b) => b[1].ok / b[1].n - a[1].ok / a[1].n)) console.log(`${b.ok}/${b.n}  ${h}`)
})
