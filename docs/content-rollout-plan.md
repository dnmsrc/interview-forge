# 知识库滚动扩写规划（19 新栈 + 现有考点补厚）

> 配套 `docs/content-production-guide.md`（数据契约）。本文件定每个栈的 L3 章节 / L4 考点大纲与题量目标。生产 worker 直接按对应章节建节点。
> 通用规则：每 L4 考点 ≥3 题，标【核】的 mustMaster 考点做到 5 题；八股与实战均衡，同考点不全是选择题。题量为目标值，可按考点数浮动 ±10%。

---

## 第一批 公共基础 cs

### cs/algo 算法与数据结构（目标 18~22 L4，55~65 题）
- L3 `cs.algo.complexity` 复杂度分析：【核】大O时间/空间复杂度与均摊分析；主定理与递归复杂度
- L3 `cs.algo.linear` 线性结构：【核】数组 vs 链表及操作复杂度；栈/队列与单调栈/单调队列；【核】哈希表、哈希冲突与扩容
- L3 `cs.algo.tree` 树与堆：【核】二叉树遍历(递归/迭代)与 BST；AVL/红黑树性质与平衡；【核】堆原理与 TopK/中位数；Trie 字典树
- L3 `cs.algo.graph` 图：BFS/DFS 与连通性；【核】最短路 Dijkstra/Floyd；最小生成树与拓扑排序；并查集
- L3 `cs.algo.sort` 排序与查找：【核】快排/归并/堆排/桶排对比与稳定性；【核】二分查找及左右边界
- L3 `cs.algo.paradigm` 算法范式：双指针/滑动窗口；回溯(全排列/N皇后)；贪心与分治；【核】动态规划(背包/LIS/编辑距离/状态转移)

### cs/design 系统设计与高并发（目标 16~18 L4，50~58 题）
- L3 `cs.design.method` 设计方法论：【核】容量估算(QPS/存储/带宽)与性能指标；【核】CAP/BASE 与一致性取舍
- L3 `cs.design.cache` 缓存架构：缓存读写模式(Cache Aside/Write Through)；【核】穿透/击穿/雪崩与多级缓存；缓存与 DB 一致性
- L3 `cs.design.dbscale` 数据库扩展：读写分离与主从；【核】分库分表(水平/垂直)与分片键；分布式 ID 生成(雪花/号段)
- L3 `cs.design.ha` 高可用与限流：负载均衡算法；限流(令牌桶/漏桶/计数器)与熔断降级；集群容灾与备份
- L3 `cs.design.case` 经典案例：【核】秒杀系统；短链系统；Feed 流与粉丝关系；排行榜(ZSet)；【核】分布式锁设计

### cs/seceq 安全常识（目标 12~14 L4，40~46 题）
- L3 `cs.seceq.web` Web 攻防：【核】XSS(存储/反射/DOM)与 CSP；【核】CSRF 与 SameSite/SyncToken；SQL 注入与预编译；SSRF 与文件上传漏洞
- L3 `cs.seceq.auth` 认证授权：Session/Cookie 与 Token；【核】JWT 结构与利弊；OAuth2 四种授权与 SSO；水平/垂直越权与 RBAC
- L3 `cs.seceq.crypto` 密码学：对称(AES) vs 非对称(RSA)；哈希与加盐(bcrypt)；数字签名/证书；【核】HTTPS/TLS 与混合加密
- L3 `cs.seceq.eng` 工程安全：敏感信息与密钥管理；依赖漏洞(CVE)与供应链安全；接口限流与风控、最小权限

### cs/devops 容器化与 DevOps（目标 13~15 L4，42~48 题）
- L3 `cs.devops.docker` Docker：镜像/容器/仓库与 Dockerfile 最佳实践；多阶段构建与镜像瘦身；网络模式与数据卷
- L3 `cs.devops.k8s` Kubernetes：Pod/Deployment/Service/Ingress 核心对象；ConfigMap/Secret 与探针；自愈、HPA 扩缩容
- L3 `cs.devops.cicd` CI/CD：Git 分支策略(GitFlow/Trunk)；流水线阶段与制品管理；蓝绿/金丝雀/滚动发布
- L3 `cs.devops.observ` 可观测性：日志/指标/链路追踪三支柱；Prometheus+Grafana 与告警；APM 与全链路 trace
- L3 `cs.devops.git` Git 协作：merge vs rebase、cherry-pick、冲突解决与 reset/revert

### cs/net 补厚（现有 11 L4，每点补到 ≥3，核心 ≥5，新增约 18 题，不新建节点）

---

## 第一批 后端 be

### be/spring Spring 生态（目标 16~18 L4，52~60 题）
- L3 `be.spring.core` IoC 与 AOP：【核】Bean 生命周期与作用域；依赖注入方式与循环依赖(三级缓存)；【核】JDK/CGLIB 动态代理与 AOP；Bean 线程安全
- L3 `be.spring.mvc` Spring MVC：【核】DispatcherServlet 处理流程；拦截器 vs 过滤器；参数绑定与数据校验；全局异常处理与 RESTful
- L3 `be.spring.tx` 事务：【核】声明式事务与传播行为；隔离级别与脏读/幻读；【核】@Transactional 失效场景；分布式事务引子
- L3 `be.spring.boot` Boot/Cloud：自动装配原理与 starter；Actuator 与配置(多环境/热更新)；Nacos 注册配置、OpenFeign、Gateway 网关

### be/redis Redis（目标 14~16 L4，46~54 题）
- L3 `be.redis.ds` 数据结构：【核】5 基础类型+Stream/Bitmap/HyperLogLog 及场景；底层 ziplist/skiplist/intset 编码
- L3 `be.redis.persist` 持久化与内存：RDB vs AOF 与混合持久化；过期策略与内存淘汰算法；大 key/热 key 治理
- L3 `be.redis.ha` 高可用：主从复制；哨兵 Sentinel 故障转移；【核】Cluster 分片与 16384 槽
- L3 `be.redis.practice` 缓存实战：【核】分布式锁 SETNX/Redlock 与看门狗；缓存与 DB 一致性方案；限流/排行榜/延迟队列应用

### be/mq 消息队列（目标 12~14 L4，40~46 题）
- L3 `be.mq.kafka` Kafka：分区/副本/ISR 架构；【核】消息可靠性(不丢)与重试；顺序消息与消息积压；Exactly Once 与 rebalance
- L3 `be.mq.rabbit` RabbitMQ：交换机/路由键/队列模型；确认机制与死信队列；延迟队列实现
- L3 `be.mq.general` 通用设计：【核】消费幂等设计；削峰填谷与最终一致；事务消息与选型对比(Kafka/RocketMQ/RabbitMQ)

### be/micro 微服务与分布式（目标 14~16 L4，46~52 题）
- L3 `be.micro.gov` 服务治理：注册发现与配置中心；网关与负载均衡；熔断/限流/降级(Sentinel)
- L3 `be.micro.tx` 分布式事务：【核】2PC/3PC 与 TCC；Saga 与本地消息表；【核】CAP/BASE 与最终一致实践
- L3 `be.micro.coord` 分布式协调：分布式锁对比；链路追踪与上下文透传；幂等设计与服务拆分边界(DDL 引子)

### be/node Node.js（目标 11~13 L4，36~42 题）
- L3 `be.node.runtime` 运行时原理：【核】事件循环各阶段与 libuv；宏任务/微任务时序(与浏览器差异)；process 与 cluster
- L3 `be.node.module` 模块与流：CommonJS vs ESM；【核】Stream(可读/可写/管道)与背压；Buffer 与内存
- L3 `be.node.server` 服务实战：HTTP 服务与中间件；错误处理与进程守护(PM2)；BFF 层与鉴权透传

### be/python Python（目标 11~13 L4，36~42 题）
- L3 `be.python.core` 语言核心：【核】GIL 与多线程/多进程；可变/不可变与深拷贝；【核】装饰器/生成器/迭代器；引用计数与 GC
- L3 `be.python.async` 异步：asyncio 事件循环与协程；await 与任务调度、与多线程区别
- L3 `be.python.web` Web 框架：FastAPI 与 Pydantic 校验；Django/Flask 对比与 ORM；异步框架选型

### be/java、be/mysql 补厚（现有 18 L4，每点补到 ≥3、核心 ≥5，约新增 30 题，不新建节点）

---

## 第二批 AI Agent（ai）

### ai/llm 大模型原理（目标 12~14 L4，40~46 题）
- L3 `ai.llm.arch` 模型结构：【核】Transformer 与自注意力；位置编码与多头；分词 BPE/tokenizer
- L3 `ai.llm.infer` 推理机制：【核】Prefill/Decode 两阶段；【核】KV Cache 与显存；采样 temperature/top_p/top_k；上下文窗口与外推
- L3 `ai.llm.train` 训练基础：预训练/SFT 目标；RLHF/DPO 对齐；参数量/显存估算与 Loss

### ai/context 上下文工程（目标 8~10 L4，28~34 题）
- L3 `ai.context.budget` 预算与截断：【核】token 预算分配；截断/滑动窗口策略与信息损失
- L3 `ai.context.organize` 摘要与组织：滚动摘要与摘要失真；证据组织/引用与 prompt 结构化

### ai/multi 多智能体协作（目标 8~10 L4，28~34 题）
- L3 `ai.multi.pattern` 编排模式：单/多 Agent 边界；Orchestrator-Worker 与分工；Agent 交接(handoff)
- L3 `ai.multi.state` 状态与恢复：共享状态/黑板与一致性；失败恢复、终止条件与防环

### ai/reliability 可靠性与安全（目标 10~12 L4，34~40 题）
- L3 `ai.reliability.robust` 可靠性：【核】超时/重试/指数退避/幂等；终态设计与护栏；降级与成本/延迟治理
- L3 `ai.reliability.security` 安全：【核】prompt 注入与防御；越权工具调用与最小权限；数据泄露/输出约束与审计

### ai/framework 应用框架与 Prompt（目标 10~12 L4，34~40 题）
- L3 `ai.framework.libs` 框架选型：LangChain vs LangGraph(状态图) vs CrewAI；编排范式与选型取舍
- L3 `ai.framework.prompt` Prompt 与存储：Few-shot/CoT/结构化输出/函数调用；向量库选型(pgvector/Milvus/FAISS)与 RAG 框架

### ai 现有 7 栈补厚（25 L4 中 16 个偏薄，约新增 25 题）

---

## 第三批 工程难题 eng

### eng/incident 线上故障排查（目标 10~12 L4，34~40 题）
- L3 `eng.incident.method` 排查方法论：监控/日志/链路定位；根因分析(5why/鱼骨)与回滚决策；故障分级与复盘
- L3 `eng.incident.case` 典型故障：服务雪崩与雪崩隔离；数据库慢查询/连接池打满；OOM/内存泄漏/CPU 100%；网络分区与 DNS 故障

### eng/consist 一致性与幂等（目标 9~11 L4，30~36 题）
- L3 `eng.consist.idem` 幂等：【核】重复提交与幂等键；防重表/唯一约束/状态机幂等
- L3 `eng.consist.data` 数据一致：对账机制与差异修复；最终一致补偿(TCC/消息)；分布式去重与乱序处理

### eng/release 发布与灰度（目标 8~10 L4，28~34 题）
- L3 `eng.release.strategy` 发布策略：蓝绿/金丝雀/灰度对比；特性开关与紧急回滚
- L3 `eng.release.compat` 兼容性：接口向后兼容与版本管理；数据库变更(扩缩容/零停机)与配置开关

---

## 第四批 前端 fe 补厚（不新建节点）
现有 111 个 L4 中 105 个仅 1~2 题，全部补到 ≥3、vue/js/browser/network 等 mustMaster 考点补到 ≥5。按 stack 分批：vue(37)、js(17)、browser/network/build/perf/css/ts/electron/uniapp/eco/html(57)。约新增 250~300 题。

---

## 总量测算
新栈 19 个 ≈ 230 个新 L4 考点、约 720 题容量；按每点 3 题、核心 5 题落地约 600+ 新题；叠加现有考点补厚约 300 题，最终活跃题目标 850~950 道，5 大板块题量分布从「fe 独大」转为「fe/be/cs/ai/eng 相对均衡」。
