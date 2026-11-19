/**
 * 项目闯关内容源：后端 · Redis 缓存（4 关 14 步）
 *
 * 为什么是「手写模拟器」而不是连真 Redis：判题跑在 Node vm 里，没有网络也没有
 * setTimeout，所以每个知识点都要落成「纯函数 + 可注入的 now / random」才能被真实判题。
 * 这也正好逼着我们说清楚每套机制的边界条件：
 *
 *   lv1 过期字典   —— 过期是惰性判断 + 定期抽样，淘汰是抽样近似 LRU
 *   lv2 编码选择   —— ZSet 的排序语义、编码阈值、HyperLogLog 的误差
 *   lv3 缓存三问题 —— Cache Aside、布隆防穿透、单飞防击穿、随机 TTL 防雪崩
 *   lv4 分片与锁   —— CRC16 槽位、槽迁移的 ASK/MOVED、SET NX 锁与 Redlock 争议
 *
 * 四关互不依赖（cumulative: false），每关自己一套完整的零件。
 */

/* ============================================================ 第 1 关测试 */

const L1S1 = `{
  check('set 之后 get 能读到原值', () => {
    const s = new RedisStore()
    s.set('name', 'redis', 0)
    same(s.get('name', 0), 'redis')
  })
  check('没存过的 key 读出来是 undefined', () => {
    const s = new RedisStore()
    same(s.get('nope', 0), undefined)
  })
  check('del 删掉返回 1，再删返回 0，删完读不到', () => {
    const s = new RedisStore()
    s.set('name', 'redis', 0)
    same(s.del('name'), 1)
    same(s.get('name', 0), undefined)
    same(s.del('name'), 0)
  })
  check('expire 到点之后，get 立刻读不到（惰性删除）', () => {
    const s = new RedisStore()
    s.set('code', '1234', 1000)
    same(s.expire('code', 2, 1000), 1)
    same(s.get('code', 2999), '1234', '还没到点，应该还活着')
    same(s.get('code', 3000), undefined, '到点那一刻就该消失')
  })
  check('ttl：-1 永不过期、-2 不存在、其余是剩余整秒', () => {
    const s = new RedisStore()
    s.set('forever', 1, 5000)
    same(s.ttl('forever', 5000), -1)
    same(s.ttl('ghost', 5000), -2)
    s.set('short', 1, 5000)
    s.expire('short', 10, 5000)
    same(s.ttl('short', 5000), 10)
    same(s.ttl('short', 12500), 3)
  })
  check('set 覆盖写会摘掉旧 TTL（Redis 的 SET 语义）', () => {
    const s = new RedisStore()
    s.set('k', 1, 6000)
    s.expire('k', 5, 6000)
    same(s.ttl('k', 6000), 5)
    s.set('k', 2, 6000)
    same(s.ttl('k', 6000), -1, '覆盖写之后不该再有 TTL')
    same(s.get('k', 99999999), 2, '没有 TTL 就不会过期')
  })
}`

const L1S2 = `{
  check('tick 把过期的 key 清掉，并返回清理数量', () => {
    const s = new RedisStore()
    s.set('a', 1, 0)
    s.set('b', 2, 0)
    s.set('c', 3, 0)
    s.expire('a', 1, 0)
    s.expire('b', 1, 0)
    s.expire('c', 1, 0)
    same(s.tick(5000), 3)
  })
  check('只清过期的：没过期的 key 一个都不许动', () => {
    const s = new RedisStore()
    s.set('alive', 1, 0)
    s.expire('alive', 100, 0)
    s.set('dead', 2, 0)
    s.expire('dead', 1, 0)
    same(s.tick(5000), 1)
    same(s.get('alive', 5000), 1, '还有 95 秒才过期的 key 不该被删')
  })
  check('没有 TTL 的 key 永远不进定期删除的抽样范围', () => {
    const s = new RedisStore()
    s.set('forever', 1, 0)
    same(s.tick(99999999), 0)
    same(s.get('forever', 99999999), 1)
  })
  check('tick 清掉之后 dbsize 也要跟着变', () => {
    const s = new RedisStore()
    s.set('x', 1, 0)
    s.set('y', 2, 0)
    s.expire('x', 1, 0)
    same(s.dbsize(0), 2)
    same(s.tick(5000), 1)
    same(s.dbsize(5000), 1)
  })
}`

const L1S3 = `{
  check('超过 maxmemory 就淘汰，淘汰完一定不再超上限', () => {
    const s = new RedisStore({ maxmemory: 12 })
    s.set('a', 'xx', 0)
    s.set('b', 'xx', 1)
    s.set('c', 'xx', 2)
    s.set('d', 'xx', 3)
    s.get('a', 4)
    s.set('e', 'xx', 5)
    ok(s.memoryUsed() <= 12, '淘汰之后内存必须回到上限以内，实际 ' + s.memoryUsed())
    same(s.evicted, 1)
    same(s.dbsize(5), 4)
  })
  check('一次塞爆太多条时要连续淘汰，直到回到上限以内', () => {
    const s = new RedisStore({ maxmemory: 12 })
    for (let i = 0; i < 20; i++) s.set(String.fromCharCode(97 + i), 'xx', i)
    ok(s.memoryUsed() <= 12, '20 条 × 3 = 60，必须一路淘汰到 12 以内，实际 ' + s.memoryUsed())
    same(s.dbsize(100), 4, '成本 3 一条，上限 12 只能留 4 条')
  })
  check('淘汰的是抽样里最久没被访问的那个，刚读过的 a 留着', () => {
    const s = new RedisStore({ maxmemory: 12 })
    s.set('a', 'xx', 0)
    s.set('b', 'xx', 1)
    s.set('c', 'xx', 2)
    s.set('d', 'xx', 3)
    s.get('a', 4)
    s.set('e', 'xx', 5)
    same(s.get('b', 6), undefined, 'b 是最久没被访问的，应该先走')
    same(s.get('a', 6), 'xx')
    same(s.get('c', 6), 'xx')
  })
  check('get 也算一次访问：读过之后就不再是淘汰对象', () => {
    const withoutRead = new RedisStore({ maxmemory: 12 })
    withoutRead.set('a', 'xx', 0)
    withoutRead.set('b', 'xx', 1)
    withoutRead.set('c', 'xx', 2)
    withoutRead.set('d', 'xx', 3)
    withoutRead.set('e', 'xx', 5)
    same(withoutRead.get('a', 6), undefined, '没人读 a 时，它是最旧的，应该被淘汰')

    const withRead = new RedisStore({ maxmemory: 12 })
    withRead.set('a', 'xx', 0)
    withRead.set('b', 'xx', 1)
    withRead.set('c', 'xx', 2)
    withRead.set('d', 'xx', 3)
    withRead.get('a', 10)
    withRead.set('e', 'xx', 11)
    same(withRead.get('a', 12), 'xx', '读过之后 a 变成最近访问，不该被淘汰')
    same(withRead.get('b', 12), undefined, '被淘汰的换成了 b')
  })
  check('没超过 maxmemory 时一个都不淘汰', () => {
    const s = new RedisStore({ maxmemory: 100 })
    s.set('a', 'xx', 0)
    s.set('b', 'xx', 1)
    s.set('c', 'xx', 2)
    same(s.evicted, 0)
    same(s.memoryUsed(), 9)
    same(s.get('a', 3), 'xx')
    same(s.get('b', 3), 'xx')
    same(s.get('c', 3), 'xx')
  })
  check('淘汰之后再写同一个 key 能正常写进去，没有残留半条记录', () => {
    const s = new RedisStore({ maxmemory: 12 })
    s.set('a', 'xx', 0)
    s.set('b', 'xx', 1)
    s.set('c', 'xx', 2)
    s.set('d', 'xx', 3)
    s.get('a', 4)
    s.set('e', 'xx', 5)
    same(s.get('b', 6), undefined)
    s.set('b', 'yy', 7)
    same(s.get('b', 8), 'yy')
    ok(s.memoryUsed() <= 12, '重新写回之后内存同样不能超上限')
  })
}`

/* ============================================================ 第 1 关代码 */

const L1_STEP1 = `/**
 * 第 1 关 · 第 1 步：读写 + TTL + 惰性删除
 *
 * 一条记录长这样：{ value, expireAt }
 *   expireAt === null  → 永不过期
 *   expireAt <= now    → 已经过期，读到就当场删掉（惰性删除）
 */
class RedisStore {
  constructor({ maxmemory = Infinity, sampleSize = 5 } = {}) {
    this.maxmemory = maxmemory
    this.sampleSize = sampleSize
    this.entries = new Map()
  }

  /** 内部读：顺手把过期的记录删掉 */
  lookup(key, now) {
    const entry = this.entries.get(key)
    if (!entry) return null
    if (entry.expireAt !== null && entry.expireAt <= now) {
      this.entries.delete(key)
      return null
    }
    return entry
  }

  set(key, value) {
    this.entries.set(key, { value, expireAt: null })
  }

  get(key, now = 0) {
    const entry = this.lookup(key, now)
    return entry ? entry.value : undefined
  }

  del(key) {
    return this.entries.delete(key) ? 1 : 0
  }

  expire(key, seconds, now = 0) {
    const entry = this.lookup(key, now)
    if (!entry) return 0
    entry.expireAt = now + seconds * 1000
    return 1
  }

  ttl(key, now = 0) {
    const entry = this.lookup(key, now)
    if (!entry) return -2
    if (entry.expireAt === null) return -1
    return Math.ceil((entry.expireAt - now) / 1000)
  }
}
`

const L1_STEP2 = `/**
 * 第 1 关 · 第 2 步：定期删除（tick 抽样）
 *
 * 谁都不读的过期 key 靠惰性删除是回收不了的，所以还要定期抽样：
 * 只从「带 TTL 的 key」里抽一小撮，删掉过期的；过期比例大于 25% 就再来一轮。
 */
class RedisStore {
  constructor({ maxmemory = Infinity, sampleSize = 5 } = {}) {
    this.maxmemory = maxmemory
    this.sampleSize = sampleSize
    this.maxRounds = 4
    this.cursor = 0
    this.entries = new Map()
    this.expired = 0
  }

  /** 内部读：顺手把过期的记录删掉 */
  lookup(key, now) {
    const entry = this.entries.get(key)
    if (!entry) return null
    if (entry.expireAt !== null && entry.expireAt <= now) {
      this.entries.delete(key)
      this.expired++
      return null
    }
    return entry
  }

  set(key, value) {
    this.entries.set(key, { value, expireAt: null })
  }

  get(key, now = 0) {
    const entry = this.lookup(key, now)
    return entry ? entry.value : undefined
  }

  del(key) {
    return this.entries.delete(key) ? 1 : 0
  }

  expire(key, seconds, now = 0) {
    const entry = this.lookup(key, now)
    if (!entry) return 0
    entry.expireAt = now + seconds * 1000
    return 1
  }

  ttl(key, now = 0) {
    const entry = this.lookup(key, now)
    if (!entry) return -2
    if (entry.expireAt === null) return -1
    return Math.ceil((entry.expireAt - now) / 1000)
  }

  /** 定期删除：抽样清理过期 key，返回这一轮删掉的数量 */
  tick(now = 0) {
    let removed = 0
    for (let round = 0; round < this.maxRounds; round++) {
      const withTtl = [...this.entries.keys()].filter((k) => this.entries.get(k).expireAt !== null)
      if (withTtl.length === 0) break

      const n = Math.min(this.sampleSize, withTtl.length)
      const step = Math.max(1, Math.floor(withTtl.length / n))
      const sample = []
      for (let i = 0; i < n; i++) sample.push(withTtl[(this.cursor + i * step) % withTtl.length])
      this.cursor = (this.cursor + 1) % withTtl.length

      let expiredThisRound = 0
      for (const k of sample) {
        const entry = this.entries.get(k)
        if (entry && entry.expireAt !== null && entry.expireAt <= now) {
          this.entries.delete(k)
          this.expired++
          expiredThisRound++
        }
      }
      removed += expiredThisRound
      if (expiredThisRound * 4 <= sample.length) break
    }
    return removed
  }

  /** 逻辑上还活着的 key（顺手做惰性清理） */
  keys(now = 0) {
    const out = []
    for (const k of [...this.entries.keys()]) if (this.lookup(k, now)) out.push(k)
    return out
  }

  dbsize(now = 0) {
    return this.keys(now).length
  }
}
`

const L1_STEP3 = `/**
 * 第 1 关 · 第 3 步：maxmemory + 抽样近似 LRU 淘汰
 *
 * Redis 的 allkeys-lru 不是精确 LRU：它给每个 key 记一个「最后访问时钟」，
 * 淘汰时随机抽 maxmemory-samples 个，挑其中最久没被访问的删掉。
 * 这里用「游标 + 步长」把随机抽样做成确定性的，测试才能复现。
 */
class RedisStore {
  constructor({ maxmemory = Infinity, sampleSize = 5 } = {}) {
    this.maxmemory = maxmemory
    this.sampleSize = sampleSize
    this.maxRounds = 4
    this.cursor = 0
    this.entries = new Map()
    this.expired = 0
    this.evicted = 0
  }

  lookup(key, now) {
    const entry = this.entries.get(key)
    if (!entry) return null
    if (entry.expireAt !== null && entry.expireAt <= now) {
      this.entries.delete(key)
      this.expired++
      return null
    }
    return entry
  }

  set(key, value, now = 0) {
    const entry = this.entries.get(key)
    if (entry) {
      entry.value = value
      entry.expireAt = null
      entry.lastAccess = now
    } else {
      this.entries.set(key, { value, expireAt: null, lastAccess: now })
    }
    this.evictIfNeeded(now)
  }

  get(key, now = 0) {
    const entry = this.lookup(key, now)
    if (!entry) return undefined
    entry.lastAccess = now
    return entry.value
  }

  del(key) {
    return this.entries.delete(key) ? 1 : 0
  }

  expire(key, seconds, now = 0) {
    const entry = this.lookup(key, now)
    if (!entry) return 0
    entry.expireAt = now + seconds * 1000
    return 1
  }

  ttl(key, now = 0) {
    const entry = this.lookup(key, now)
    if (!entry) return -2
    if (entry.expireAt === null) return -1
    return Math.ceil((entry.expireAt - now) / 1000)
  }

  /** 从给定 key 列表里游标抽样：确定性的「随机」 */
  pickFrom(keys) {
    if (keys.length === 0) return []
    const n = Math.min(this.sampleSize, keys.length)
    const step = Math.max(1, Math.floor(keys.length / n))
    const out = []
    for (let i = 0; i < n; i++) out.push(keys[(this.cursor + i * step) % keys.length])
    this.cursor = (this.cursor + 1) % keys.length
    return out
  }

  /** 简化内存计量：key 长度 + value 字符串长度（真实 Redis 用 jemalloc 实际占用） */
  memoryUsed() {
    let total = 0
    for (const [key, entry] of this.entries) total += key.length + String(entry.value).length
    return total
  }

  evictIfNeeded(now) {
    while (this.memoryUsed() > this.maxmemory) {
      const sample = this.pickFrom([...this.entries.keys()])
      if (sample.length === 0) return
      let victim = sample[0]
      for (const k of sample) {
        if (this.entries.get(k).lastAccess < this.entries.get(victim).lastAccess) victim = k
      }
      this.entries.delete(victim)
      this.evicted++
    }
  }

  tick(now = 0) {
    let removed = 0
    for (let round = 0; round < this.maxRounds; round++) {
      const withTtl = [...this.entries.keys()].filter((k) => this.entries.get(k).expireAt !== null)
      if (withTtl.length === 0) break

      const sample = this.pickFrom(withTtl)
      let expiredThisRound = 0
      for (const k of sample) {
        const entry = this.entries.get(k)
        if (entry && entry.expireAt !== null && entry.expireAt <= now) {
          this.entries.delete(k)
          this.expired++
          expiredThisRound++
        }
      }
      removed += expiredThisRound
      if (expiredThisRound * 4 <= sample.length) break
    }
    return removed
  }

  keys(now = 0) {
    const out = []
    for (const k of [...this.entries.keys()]) if (this.lookup(k, now)) out.push(k)
    return out
  }

  dbsize(now = 0) {
    return this.keys(now).length
  }
}
`

/* ============================================================ 第 1 关 */

const LV1 = {
  id: 'lv1',
  title: '过期字典：TTL、惰性删除与近似 LRU',
  emoji: '⏳',
  xp: 40,
  goal:
    '实现 RedisStore：set/get/del/expire/ttl 的语义与 Redis 对齐，过期 key 靠「读时惰性删除 + tick 抽样清理」处理，内存超过 maxmemory 时按抽样近似 LRU 淘汰，并且淘汰之后内存一定不超上限。',
  why:
    '缓存最常见的两种生产事故都长在这一层：一种是「明明设了 EXPIRE，读出来还是老数据」，因为过期是读时判断、不是定时删除；另一种是「内存看着不多，突然 OOM」，因为淘汰策略没配或 maxmemory 没设。把这两套机制手写一遍，你才会明白 EXPIRE 之后 key 并没有立刻消失、RDB 里为什么还留着早该过期的键、以及 allkeys-lru 为什么只抽样不全量扫。',
  nodes: ['be.redis.persist', 'be.redis.persist.rdb-aof-expire'],
  thinking: [
    {
      title: '先问「过期是状态还是动作」，再决定谁来删',
      md: `我一开始想写个定时器，每秒把所有 key 扫一遍删掉过期的。很快就否掉了：Redis 的命令执行是单线程的，真的全量扫描会把主线程卡住几十毫秒，在生产上就是一次超时雪崩。

所以过期只能做成「状态」：每条记录挂一个 expireAt 绝对时间戳，读的时候跟 now 比一下。删除是读的副作用，不是独立动作。剩下的窟窿（没人读的过期 key）交给定期抽样——一次只抽一小撮，删掉里面过期的。

**「删不干净」是可以接受的**，因为下次读到还会再判断一次。这条取舍想通了，整个实现就只有十几行。`
    },
    {
      title: '为什么淘汰用抽样，而不是维护一条精确的 LRU 链表',
      md: `精确 LRU 要给每个 key 挂一个双向链表节点，内存开销直接翻倍；而且每次读写都要挪全局链表，真要多线程就是一把大锁。

Redis 的选择是：每个 key 只记一个「最后访问时钟」，要淘汰时随机抽 maxmemory-samples（默认 5）个，挑其中最久没被访问的删掉，还淘汰不够就继续抽。

抽样当然会挑错人，但分布上够好，而且成本是 O(样本数)。我在实现里照抄这个思路，只把「随机」换成「游标 + 步长」——确定性抽样，否则测试根本没法复现。**近似是策略的一部分，不是偷懒**。`
    },
    {
      title: '为什么 now 是参数，而不是在函数里取 Date.now()',
      md: `真实 Redis 用服务器时钟。但在一个要跑判题的模拟器里，直接读时钟等于把「三天后」变成不可测试的。

所以所有涉及时间的操作都把 now 作为入参：expire(key, 2, 1000) 表示「在第 1000ms 这一刻设 2 秒后过期」，get(key, 3000) 表示「在第 3000ms 读一次」。测试推进时间只需要改一个数字，不用等、也不用 mock 全局。

**把不确定性（时钟、随机）从函数体里挤到参数上**，是这类模拟器能写测试的唯一办法。后面第 3 关的随机 TTL、第 4 关的锁续期，用的都是同一招。`
    }
  ],
  prereq: [
    {
      title: 'RDB 与 AOF：持久化的是「数据 + 过期时间戳」，不是「删除动作」',
      md: `RDB 是快照：fork 出子进程，靠写时复制（COW）把某一刻的内存整体 dump 成二进制。恢复快，但两次快照之间的数据会丢。

AOF 是追加日志：每条写命令追加进文件，appendfsync 三档——always（每条都 fsync，最安全最慢）、everysec（每秒一次，默认，最多丢 1 秒）、no（交给操作系统，最快也最不可控）。文件会越来越大，所以要 AOF 重写：用最小命令集把当前数据集重建一遍。

Redis 4.0 之后默认混合持久化：AOF 重写时前半段写 RDB 格式快照，后半段追加增量命令，重启时先加载快照再重放增量。

关键的一点：**过期时间是作为数据被持久化的**（RDB 里存绝对时间戳，AOF 里是 PEXPIREAT 命令）。所以拿一份 RDB 恢复之后，早该过期的 key 还在，得靠惰性删除在第一次被读到时清掉。`
    },
    {
      title: '过期键的两把刀：惰性删除 + 定期删除',
      md: `惰性删除：每次读写一个 key 都先看 expireAt，过期就当场删掉并当作不存在。代价只落在「被访问到的 key」上；致命缺点是——**没人访问的过期 key 会一直占内存**。

定期删除：Redis 默认每秒跑 10 次 activeExpireCycle（每 100ms 一次），从带 TTL 的 key 里随机抽 20 个，删掉其中过期的；如果这一轮过期比例超过 25%，说明过期 key 还很密，就继续抽，直到比例降下来或时间片用完。

\`\`\`js
const sample = randomKeysFrom(expiresDict, 20)
const expired = sample.filter((k) => expireAt(k) <= now)
expired.forEach(del)
if (expired.length / sample.length > 0.25) tickAgain()
\`\`\`

两把刀合起来才成立：惰性删除保证「读到的一定是有效的」，定期删除保证「没人读的也能被回收」。少一把，要么读到脏数据，要么内存泄漏。`
    },
    {
      title: 'maxmemory 与 8 种淘汰策略（默认其实是 noeviction）',
      md: `used_memory 超过 maxmemory 之后，Redis 按 maxmemory-policy 决定怎么办：

- \`noeviction\`：拒绝写入（返回 OOM 错误），读还能用——**这是默认值**，很多人以为默认是 LRU
- \`allkeys-lru\` / \`allkeys-lfu\` / \`allkeys-random\`：在全部 key 里按「最近使用」/「使用频率」/ 随机淘汰
- \`volatile-lru\` / \`volatile-lfu\` / \`volatile-random\` / \`volatile-ttl\`：只在**设了过期时间**的 key 里挑，挑不出来就退化成 noeviction

LRU 保留「最近被访问」的，LFU 保留「被访问次数多」的（4.0 引入），后者能防住「偶尔被扫一次的冷 key 把热 key 挤掉」。

另外 maxmemory 只算数据内存，不含 fork 时的 COW 复制、AOF buffer，所以生产上一般留 10%~20% 余量。抽样数量是 maxmemory-samples，默认 5；调到 10 更接近精确 LRU，但更耗 CPU。`
    }
  ],
  api: [
    {
      name: 'RedisStore（读写与过期）',
      sig:
        'new RedisStore({ maxmemory = Infinity, sampleSize = 5 }) / set(key, value, now = 0) / get(key, now = 0) / del(key) / expire(key, seconds, now = 0) / ttl(key, now = 0)',
      args:
        'key 任意字符串；value 任意（内存计量时按 String(value) 算长度）；now 是「当前时刻」的毫秒数，由调用方推进；seconds 是 TTL 秒数，可以是负数（负数等于立刻过期）。',
      returns:
        'set 无返回；get 命中返回值，过期或不存在返回 undefined；del 删掉了返回 1、没删到返回 0；expire 设上了返回 1、key 不存在返回 0；ttl 返回剩余整秒（Math.ceil），永不过期返回 -1，key 不存在返回 -2。',
      example:
        "const s = new RedisStore()\ns.set('code', '1234', 1000)\ns.expire('code', 2, 1000)      // 1：到 3000ms 过期\ns.ttl('code', 1000)            // 2\ns.get('code', 2999)            // '1234'\ns.get('code', 3000)            // undefined —— 到点，惰性删除\ns.ttl('code', 3000)            // -2"
    },
    {
      name: 'RedisStore（内存治理）',
      sig: 'tick(now = 0) / memoryUsed() / keys(now = 0) / dbsize(now = 0) / evicted / expired',
      args:
        'tick 的 now 是「现在几点」，用来判断抽样里的 key 是否过期；memoryUsed 不需要参数，按 key.length + String(value).length 粗算；keys/dbsize 的 now 用来过滤掉已经过期的 key。',
      returns:
        'tick 返回本次抽掉的数量（可能是 0）；memoryUsed 返回简化字节数；keys 返回逻辑上存活的 key 数组（会顺手做惰性清理）；dbsize 返回数量；evicted 是累计淘汰条数、expired 是累计过期删除条数（只读属性，测试用来观察）。',
      example:
        "const s = new RedisStore({ maxmemory: 12 })\ns.set('a', 'xx', 0)            // 成本 1 + 2 = 3\ns.set('b', 'xx', 1)\ns.set('c', 'xx', 2)\ns.set('d', 'xx', 3)\ns.get('a', 4)                  // a 变成最近访问\ns.set('e', 'xx', 5)            // 15 > 12 → 淘汰最久没访问的 b\ns.memoryUsed()                 // 12\ns.evicted                      // 1\ns.get('b', 6)                  // undefined"
    }
  ],
  stages: [
    {
      n: 1,
      title: '先让读写和 TTL 对上 Redis 语义',
      think:
        '第一步只做两件事：一条记录长什么样（value + expireAt），以及 TTL 怎么读。我在 get 里塞进惰性删除——过期就当场删掉再返回 undefined。这一步故意不碰抽样和淘汰：先把 TTL 语义钉成唯一定义，后面两步才有参照物。',
      hint:
        '构造函数里 this.entries = new Map()。每条记录存 { value, expireAt }，expireAt 用绝对毫秒、null 表示永不过期。抽一个内部 lookup(key, now)：找不到返回 null；expireAt 不为 null 且 <= now 就删掉并返回 null。get / expire / ttl 全部走它。expire 把 expireAt 设成 now + seconds * 1000；ttl 分三种情况——不存在 -2、expireAt 为 null 返回 -1、其余用 Math.ceil((expireAt - now) / 1000)。',
      diag: [
        'get 读不到值：set 里要真的把 { value, expireAt } 存进 Map，只存 value 时空值判断全错。',
        '未命中返回了 null：Map 里没有就是 undefined，lookup 返回 null 之后 get 要转成 undefined。',
        'del 的返回值不对：Map.delete 返回布尔值，要自己转成 1 / 0。',
        '过期之后还能读到：get 里要先比 expireAt，而且条件是 expireAt <= now（正好到点也算过期）。',
        'ttl 的三种返回值串了：-1 是「永不过期」，-2 是「key 不存在」，别把两者写成同一个值。',
        '覆盖写之后 TTL 还在：set 要把 expireAt 重置成 null，Redis 的 SET 默认会摘掉过期时间。'
      ],
      vocab: [
        { term: 'expireAt', md: '绝对过期时刻（毫秒）。存绝对时间而不是「还剩多少秒」，是因为「剩余」会随时间漂移，而绝对时刻不会。' },
        { term: '惰性删除', md: '不在后台删，而是在读的时候判断并顺手删掉。好处是只对被访问到的 key 付代价。' }
      ],
      code: L1_STEP1,
      test: L1S1
    },
    {
      n: 2,
      title: '定期删除：tick 抽样清掉没人读的过期 key',
      think:
        '现在补「没人读的过期 key」这个窟窿。我不写全量扫描——那正是真实单线程 Redis 不敢做的事。照 activeExpireCycle 的做法：只从带 TTL 的 key 里抽样，删掉过期的；这一轮过期比例超过 25% 就说明还很密，再来一轮，最多 4 轮。tick 返回删掉的数量，测试才能验收「抽了几轮、删了几个」。',
      hint:
        '给 store 加 cursor 游标和 maxRounds（4）。tick(now) 每一轮：先把带 TTL 的 key 收集成数组；取 n = Math.min(sampleSize, 数组长度)、步长 Math.max(1, Math.floor(长度 / n))，用 (cursor + i * 步长) % 长度 取样本（这就是确定性的「随机抽样」），cursor 每轮 + 1；删掉样本里 expireAt <= now 的；删除数 × 4 <= 样本长度 就 break。顺手加 keys(now)（只返回逻辑存活的）和 dbsize(now)。',
      diag: [
        'tick 返回 0 但确实有过期 key：样本要取自「带 TTL 的那些 key」，别从全部 key 里抽。',
        '把没过期的 key 删了：删除条件必须是 expireAt !== null 且 expireAt <= now。',
        '没有 TTL 的 key 也被删了：它们根本不该进抽样范围，收集候选时就要把 expireAt 为 null 的过滤掉。',
        'tick 之后 dbsize 没变：dbsize 要走 keys(now) 的逻辑，不能直接返回 entries.size。'
      ],
      vocab: [
        { term: 'activeExpireCycle', md: 'Redis 的定期删除循环：默认每 100ms 抽 20 个带 TTL 的 key，过期比例 > 25% 就继续抽，且单次占用 CPU 不超过 25%。' },
        { term: '游标抽样', md: '用 (cursor + i * step) % len 取样本，cursor 每轮前进一步。它模拟随机抽样，但结果可复现——测试能断言「淘汰了谁」。' }
      ],
      code: L1_STEP2,
      test: L1S2
    },
    {
      n: 3,
      title: 'maxmemory：抽样近似 LRU 淘汰',
      think:
        '最后加内存上限。Redis 的 allkeys-lru 不是精确 LRU：它只记每个 key 最后一次被访问的时钟，淘汰时抽样挑「其中最久没被访问」的删。我沿用同一套游标抽样，并让 get 也更新 lastAccess。这一步的验收点写成「淘汰后内存一定不超上限」，而不是「淘汰的一定是最旧的那个」——因为近似本身就是策略的一部分。',
      hint:
        '每条记录加 lastAccess，set 和 get 都写成 now。memoryUsed() 把每条记录的 key.length + String(value).length 累加，用来和 maxmemory 比。把第 2 步的游标抽样抽成 pickFrom(keys)，给 tick 和淘汰共用：游标只有一份，curosr 前移才能让两次抽样的样本不同。set 的最后调 evictIfNeeded(now)：while (memoryUsed() > maxmemory) 从全部 key 里抽一批、删掉 lastAccess 最小的那个、evicted++；样本为空就退出，避免死循环。',
      diag: [
        '内存还是超上限：淘汰要放在 set 的最后，而且是 while 循环——一次可能不止淘汰一条。',
        '只淘汰了一条就停了：if 换成 while，循环条件看 memoryUsed() > maxmemory。',
        '淘汰的不是最久的：抽样里比较的是 lastAccess，不是 score 也不是插入顺序。',
        'get 之后淘汰顺序没变：get 命中时也要把 lastAccess 更新成 now，否则「读过」这件事对淘汰没有影响。',
        '没超上限也淘汰了：循环条件是 memoryUsed() > maxmemory，不是 >=。',
        '淘汰之后再写同一个 key 出问题：set 命中已有记录时要更新 value / lastAccess 并保留这一条，不能再插一条新的。'
      ],
      vocab: [
        { term: 'maxmemory-samples', md: '每次淘汰抽样多少个 key，默认 5。抽得越多越接近精确 LRU，CPU 也越贵。' },
        { term: '近似 LRU', md: '不维护全局链表，只保留「最后访问时钟」+ 抽样比较。省内存、省锁，代价是偶尔淘汰错。' }
      ],
      code: L1_STEP3,
      test: L1S3
    }
  ],
  finalCode: L1_STEP3,
  usage: `const store = new RedisStore({ maxmemory: 12 })

// 1) 过期：读的时候才删
store.set('code', '1234', 0)
store.expire('code', 2, 0)        // 2000ms 过期
store.ttl('code', 0)              // 2
store.get('code', 1999)           // '1234'
store.get('code', 2000)           // undefined（惰性删除）

// 2) 定期删除：没人读的过期 key 靠 tick 抽样回收
store.set('tmp', 'x', 0)
store.expire('tmp', 1, 0)
store.tick(5000)                  // 1

// 3) 淘汰：15 > 12，抽样挑最久没访问的删掉
store.set('a', 'xx', 0)
store.set('b', 'xx', 1)
store.set('c', 'xx', 2)
store.set('d', 'xx', 3)
store.get('a', 4)                 // a 成为最近访问
store.set('e', 'xx', 5)
store.evicted                     // 1
store.memoryUsed()                // 12
store.get('b', 6)                 // undefined —— b 被淘汰`,
  concepts: [
    {
      title: '通关后复盘：过期与淘汰是两套独立机制',
      md: `过期（expire/ttl）管的是「这一条还有没有意义」，淘汰（maxmemory-policy）管的是「内存不够时先扔谁」。两者会互相影响，但不是一回事：

- 一个没有 TTL 的 key，永远不会过期，但有可能被 allkeys-lru 淘汰；
- 一个设了 TTL 的 key，过期之后只是「逻辑上不存在」，真正的内存回收要等惰性删除或定期删除碰到它；
- volatile-* 系列策略只在「有 TTL 的 key」里挑，一个 TTL 都没设时它会退化成 noeviction——生产上「内存满了却什么也淘汰不掉」多半是踩了这个。`
    }
  ],
  skeleton: `/**
 * 第 1 关 · 过期字典：TTL、惰性删除与近似 LRU
 *
 * 要交付的行为：
 *   1. set / get / del / expire / ttl 的语义与 Redis 对齐
 *   2. 过期的 key 在第一次被读到时就消失（惰性删除）
 *   3. tick(now) 抽样清理「没人读」的过期 key，返回删了几个
 *   4. memoryUsed() 超过 maxmemory 时抽样淘汰最久没被访问的那条
 */
class RedisStore {
  constructor({ maxmemory = Infinity, sampleSize = 5 } = {}) {
    this.maxmemory = maxmemory
    this.sampleSize = sampleSize
    this.entries = new Map()
    // TODO 1：还要准备 cursor（抽样游标）、expired / evicted 两个计数器
  }

  /** 内部读：顺手把过期的记录删掉 */
  lookup(key, now) {
    // TODO 2：拿到记录；没拿到返回 null；expireAt 不为 null 且 <= now 就删掉并返回 null
    return null
  }

  set(key, value, now = 0) {
    // TODO 3：存 { value, expireAt: null, lastAccess: now }；写完调 evictIfNeeded(now)
  }

  get(key, now = 0) {
    // TODO 4：用 lookup 拿记录；拿到就更新 lastAccess，返回 value；没有返回 undefined
    return undefined
  }

  del(key) {
    // TODO 5：Map.delete 的布尔结果转成 1 / 0
    return 0
  }

  expire(key, seconds, now = 0) {
    // TODO 6：key 不存在返回 0；否则 expireAt = now + seconds * 1000，返回 1
    return 0
  }

  ttl(key, now = 0) {
    // TODO 7：-2 / -1 / Math.ceil((expireAt - now) / 1000) 三种情况
    return -2
  }

  tick(now = 0) {
    // TODO 8：只从带 TTL 的 key 里游标抽样，删掉过期的；过期比例 > 25% 再来一轮
    return 0
  }

  memoryUsed() {
    // TODO 9：累加 key.length + String(value).length
    return 0
  }

  evictIfNeeded(now) {
    // TODO 10：while (memoryUsed() > maxmemory) 抽样删掉 lastAccess 最小的那条
  }

  keys(now = 0) {
    // TODO 11：只把 lookup 还活着的 key 收进结果
    return []
  }

  dbsize(now = 0) {
    return this.keys(now).length
  }
}
`,
  solution: L1_STEP3,
  tests: [L1S1, L1S2, L1S3].join('\n\n')
}

/* ============================================================ 第 2 关测试 */

const L2S1 = `{
  check('add 新增返回 1、更新已有成员返回 0，分数读得回来', () => {
    const z = new ZSet()
    same(z.add('alice', 100), 1)
    same(z.add('bob', 90), 1)
    same(z.add('alice', 95), 0)
    same(z.score('alice'), 95)
    same(z.score('nobody'), undefined)
    same(z.size, 2)
  })
  check('同分时按 member 字典序排（不能靠插入顺序碰运气）', () => {
    const z = new ZSet()
    z.add('c', 10)
    z.add('a', 10)
    z.add('b', 10)
    same(z.range(0, -1), ['a', 'b', 'c'])
  })
  check('range 按分数升序返回成员', () => {
    const z = new ZSet()
    z.add('a', 30)
    z.add('b', 10)
    z.add('c', 20)
    same(z.range(0, -1), ['b', 'c', 'a'])
    same(z.range(0, 1), ['b', 'c'])
  })
  check('rank 是 0 起的下标，不存在的成员返回 null', () => {
    const z = new ZSet()
    z.add('a', 30)
    z.add('b', 10)
    z.add('c', 20)
    same(z.rank('b'), 0)
    same(z.rank('a'), 2)
    same(z.rank('nobody'), null)
  })
  check('range 支持负索引，越界要夹紧而不是报错', () => {
    const z = new ZSet()
    z.add('a', 1)
    z.add('b', 2)
    z.add('c', 3)
    z.add('d', 4)
    same(z.range(-2, -1), ['c', 'd'])
    same(z.range(0, 99), ['a', 'b', 'c', 'd'])
    same(z.range(3, 1), [])
  })
  check('同一个成员反复 add 不会变成多条（更新分数时旧位置要清掉）', () => {
    const z = new ZSet()
    z.add('x', 1)
    z.add('y', 2)
    z.add('x', 99)
    same(z.size, 2)
    same(z.range(0, -1), ['y', 'x'])
  })
}`

const L2S2 = `{
  check('hash：128 个字段还是 listpack，129 个转 hashtable', () => {
    same(pickEncoding('hash', 128), 'listpack')
    same(pickEncoding('hash', 129), 'hashtable')
  })
  check('zset：128 个成员以内 listpack，超过转 skiplist', () => {
    same(pickEncoding('zset', 128), 'listpack')
    same(pickEncoding('zset', 129), 'skiplist')
  })
  check('set：整数集合 intset 上限 512，普通集合 128 就转 hashtable', () => {
    same(pickEncoding('set', 512, { integer: true }), 'intset')
    same(pickEncoding('set', 513, { integer: true }), 'hashtable')
    same(pickEncoding('set', 128), 'listpack')
    same(pickEncoding('set', 129), 'hashtable')
  })
  check('string：44 字节内是 embstr，超过转 raw；装不进 long 的整数也得退回 embstr', () => {
    same(pickEncoding('string', 44), 'embstr')
    same(pickEncoding('string', 45), 'raw')
    same(pickEncoding('string', 20, { integer: true }), 'int')
    same(pickEncoding('string', 21, { integer: true }), 'embstr')
  })
  check('list：128 个元素以内 listpack，超过转 quicklist', () => {
    same(pickEncoding('list', 128), 'listpack')
    same(pickEncoding('list', 129), 'quicklist')
  })
  check('ZSet 自己会报编码：128 个成员还是 listpack，第 129 个转 skiplist', () => {
    const z = new ZSet()
    for (let i = 0; i < 128; i++) z.add('m' + i, i)
    same(z.encoding, 'listpack')
    z.add('m128', 128)
    same(z.encoding, 'skiplist')
  })
  check('未知类型和非法 size 都要抛错，别让脏参数换来一个假编码', () => {
    throws(() => pickEncoding('bitmap', 1))
    throws(() => pickEncoding('zset', -1))
    throws(() => pickEncoding('zset', NaN))
  })
}`

const L2S3 = `{
  check('空的 HyperLogLog 基数是 0，桶数固定 64', () => {
    const h = new HyperLogLog()
    same(h.count(), 0)
    same(h.buckets, 64)
  })
  check('200 个不同元素：估算值落在真实值 ±20% 内', () => {
    const h = new HyperLogLog()
    for (let i = 0; i < 200; i++) h.add('u:' + i)
    const est = h.count()
    ok(Math.abs(est - 200) <= 40, '估算值该在 160~240，实际 ' + est.toFixed(1))
  })
  check('同一个元素加两次，基数不会翻倍（幂等）', () => {
    const once = new HyperLogLog()
    const twice = new HyperLogLog()
    for (let i = 0; i < 200; i++) {
      once.add('u:' + i)
      twice.add('u:' + i)
      twice.add('u:' + i)
    }
    same(twice.count(), once.count())
  })
  check('桶数是固定的：加 5000 个元素内存不涨，估算仍在同一量级', () => {
    const h = new HyperLogLog()
    for (let i = 0; i < 5000; i++) h.add('big:' + i)
    same(h.buckets, 64)
    const est = h.count()
    ok(est > 3000 && est < 5000, '64 个桶估 5000 误差很大但不能离谱，实际 ' + est.toFixed(1))
  })
  check('两个 HLL 可以合并（PFMERGE 语义：逐桶取 max）', () => {
    const a = new HyperLogLog()
    const b = new HyperLogLog()
    for (let i = 0; i < 100; i++) a.add('u:' + i)
    for (let i = 100; i < 200; i++) b.add('u:' + i)
    a.merge(b)
    const est = a.count()
    ok(Math.abs(est - 200) <= 40, '合并后该接近并集 200，实际 ' + est.toFixed(1))
    throws(() => a.merge(new HyperLogLog(4)), '桶数不同不能合并')
  })
  check('大量重复：1000 次 add 只落在 100 个不同值上，估算值该接近 100', () => {
    const h = new HyperLogLog()
    for (let i = 0; i < 1000; i++) h.add('id:' + (i % 100))
    const est = h.count()
    ok(Math.abs(est - 100) <= 25, '估算值该在 75~125，实际 ' + est.toFixed(1))
  })
}`

/* ============================================================ 第 2 关代码 */

const ZSET_STEP1 = `/**
 * 第 2 关 · 第 1 步：ZSet 的排序语义（listpack 视角：一条有序数组）
 *
 * 契约两条，缺一不可：
 *   1. 按 score 升序
 *   2. score 相同时按 member 字典序
 */
class ZSet {
  constructor() {
    this.items = []
  }

  get size() {
    return this.items.length
  }

  /** 教学版：线性找成员。真实 Redis 里 dict 负责 O(1) 查分数 */
  indexOf(member) {
    for (let i = 0; i < this.items.length; i++) if (this.items[i].member === member) return i
    return -1
  }

  /** 二分找插入点：第一个「排在 (score, member) 之后」的位置 */
  insertionPoint(score, member) {
    let lo = 0
    let hi = this.items.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      const cur = this.items[mid]
      const before = cur.score < score || (cur.score === score && String(cur.member) < String(member))
      if (before) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  /** 返回 1 = 新增成员，0 = 更新已有成员的分数（和 Redis ZADD 一致） */
  add(member, score) {
    if (typeof score !== 'number' || !Number.isFinite(score)) {
      throw new Error('score 必须是有限数字：' + score)
    }
    const at = this.indexOf(member)
    if (at >= 0) {
      if (this.items[at].score === score) return 0
      this.items.splice(at, 1)
      this.items.splice(this.insertionPoint(score, member), 0, { member, score })
      return 0
    }
    this.items.splice(this.insertionPoint(score, member), 0, { member, score })
    return 1
  }

  score(member) {
    const at = this.indexOf(member)
    return at < 0 ? undefined : this.items[at].score
  }

  rank(member) {
    const at = this.indexOf(member)
    return at < 0 ? null : at
  }

  /** ZRANGE 语义：闭区间，支持负索引，越界夹紧 */
  range(start, stop) {
    const n = this.items.length
    let s = start < 0 ? n + start : start
    let e = stop < 0 ? n + stop : stop
    if (s < 0) s = 0
    if (e > n - 1) e = n - 1
    if (s > e || s >= n) return []
    const out = []
    for (let i = s; i <= e; i++) out.push(this.items[i].member)
    return out
  }
}
`

const PICK_ENCODING = `/**
 * 编码决策：阈值来自 redis.conf，改配置就会改编码
 */
const ENCODING_LIMITS = {
  stringInt: 20,
  stringEmbstr: 44,
  hashListpack: 128,
  listListpack: 128,
  setIntset: 512,
  setListpack: 128,
  zsetListpack: 128
}

/**
 * @param {'string'|'hash'|'list'|'set'|'zset'} type
 * @param {number} size 该类型决定编码的度量：string 是字节数，其余是元素个数
 * @param {{ integer?: boolean }} [opts] 集合/字符串的成员是否全是整数
 */
function pickEncoding(type, size, opts = {}) {
  const n = Number(size)
  if (!Number.isFinite(n) || n < 0) throw new Error('size 必须是非负有限数字：' + size)

  switch (type) {
    case 'string':
      if (opts.integer && n <= ENCODING_LIMITS.stringInt) return 'int'
      return n <= ENCODING_LIMITS.stringEmbstr ? 'embstr' : 'raw'
    case 'hash':
      return n <= ENCODING_LIMITS.hashListpack ? 'listpack' : 'hashtable'
    case 'list':
      return n <= ENCODING_LIMITS.listListpack ? 'listpack' : 'quicklist'
    case 'set':
      if (opts.integer && n <= ENCODING_LIMITS.setIntset) return 'intset'
      return n <= ENCODING_LIMITS.setListpack ? 'listpack' : 'hashtable'
    case 'zset':
      return n <= ENCODING_LIMITS.zsetListpack ? 'listpack' : 'skiplist'
    default:
      throw new Error('未知的 value 类型：' + type)
  }
}
`

const ZSET_STEP2 = `/**
 * 第 2 关 · 第 2 步：ZSet 会自己报告编码
 *
 * 小集合用 listpack（连续内存、省指针），超过 zset-max-listpack-entries
 * 就换成 skiplist + dict。编码只会「升」，不会自动降回去。
 */
class ZSet {
  constructor() {
    this.items = []
  }

  get size() {
    return this.items.length
  }

  /** 这一条 zset 在 Redis 里会用哪种底层编码 */
  get encoding() {
    return pickEncoding('zset', this.items.length)
  }

  indexOf(member) {
    for (let i = 0; i < this.items.length; i++) if (this.items[i].member === member) return i
    return -1
  }

  insertionPoint(score, member) {
    let lo = 0
    let hi = this.items.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      const cur = this.items[mid]
      const before = cur.score < score || (cur.score === score && String(cur.member) < String(member))
      if (before) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  add(member, score) {
    if (typeof score !== 'number' || !Number.isFinite(score)) {
      throw new Error('score 必须是有限数字：' + score)
    }
    const at = this.indexOf(member)
    if (at >= 0) {
      if (this.items[at].score === score) return 0
      this.items.splice(at, 1)
      this.items.splice(this.insertionPoint(score, member), 0, { member, score })
      return 0
    }
    this.items.splice(this.insertionPoint(score, member), 0, { member, score })
    return 1
  }

  score(member) {
    const at = this.indexOf(member)
    return at < 0 ? undefined : this.items[at].score
  }

  rank(member) {
    const at = this.indexOf(member)
    return at < 0 ? null : at
  }

  range(start, stop) {
    const n = this.items.length
    let s = start < 0 ? n + start : start
    let e = stop < 0 ? n + stop : stop
    if (s < 0) s = 0
    if (e > n - 1) e = n - 1
    if (s > e || s >= n) return []
    const out = []
    for (let i = s; i <= e; i++) out.push(this.items[i].member)
    return out
  }
}
`

const L2_STEP2 = `${ZSET_STEP2}
${PICK_ENCODING}`

const HLL_CODE = `/**
 * 简化版 HyperLogLog：2^6 = 64 个桶
 *
 * 真实 Redis 用 16384 个桶（12KB，标准误差 0.81%）。桶少了误差大，
 * 但「用固定内存换近似值」这件事会看得更清楚。
 */
function hash32(str) {
  let h = 2166136261
  const s = String(str)
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  // 尾部混淆：让低位的分布也均匀，桶才不会被挤在一起
  h ^= h >>> 16
  h = Math.imul(h, 2246822507) >>> 0
  h ^= h >>> 13
  h = Math.imul(h, 3266489909) >>> 0
  h ^= h >>> 16
  return h >>> 0
}

class HyperLogLog {
  constructor(precision = 6) {
    this.precision = precision
    this.buckets = 1 << precision
    this.registers = new Array(this.buckets).fill(0)
  }

  /** 每个元素只影响一个桶：桶里存「哈希后缀里第一个 1 出现在第几位」 */
  add(item) {
    const h = hash32(item)
    const idx = h & (this.buckets - 1)
    let rest = h >>> this.precision
    let rank = 1
    while (rank <= 32 - this.precision && (rest & 1) === 0) {
      rank++
      rest >>>= 1
    }
    if (rank > this.registers[idx]) this.registers[idx] = rank
    return this
  }

  count() {
    const m = this.buckets
    let zeros = 0
    let sum = 0
    for (const r of this.registers) {
      if (r === 0) zeros++
      sum += Math.pow(2, -r)
    }
    const alpha = 0.7213 / (1 + 1.079 / m)
    const raw = (alpha * m * m) / sum
    // 基数小的时候桶还空着，用线性计数更准
    if (raw <= 2.5 * m && zeros > 0) return m * Math.log(m / zeros)
    return raw
  }

  /** PFMERGE：同桶数才能合并，逐桶取最大值 */
  merge(other) {
    if (!other || other.buckets !== this.buckets) throw new Error('桶数不同不能合并')
    for (let i = 0; i < this.buckets; i++) {
      if (other.registers[i] > this.registers[i]) this.registers[i] = other.registers[i]
    }
    return this
  }
}
`

const L2_STEP3 = `${L2_STEP2}
${HLL_CODE}`

/* ============================================================ 第 2 关 */

const LV2 = {
  id: 'lv2',
  title: '编码选择：ZSet、阈值与 HyperLogLog',
  emoji: '🧬',
  xp: 50,
  goal:
    '实现有序集合 ZSet（add/score/rank/range），写出编码决策函数 pickEncoding 覆盖五种类型的阈值，再用 64 个桶的 HyperLogLog 做基数估算与合并。',
  why:
    'Redis 快，一半靠数据结构选得对：一个 zset 在 128 个成员以内是紧凑的 listpack，第 129 个就变成 skiplist + dict。不知道编码切换，你会在「排行榜才 10 万元素怎么这么占内存」和「SINTER 怎么慢得像全表扫」这两类问题上来回踩坑。这一关把「阈值决定编码」做成一个能调用的函数，把 ZSet 的排序语义写死，最后用 HLL 体会「用 0.81% 误差换 12KB 固定内存」这笔交易。',
  nodes: ['be.redis.data', 'be.redis.data.structures', 'be.redis.data.advanced-types'],
  thinking: [
    {
      title: '先把排序语义写对，再谈底层结构',
      md: `ZSet 的对外契约只有两条：按 score 升序；score 相同时按 member 字典序。这两条是**可以被测试钉死**的，而「底层是 listpack 还是 skiplist」随时可以换。

所以我先写一条有序数组 + 二分插入，把语义跑绿。同分那条尤其要想清楚：如果只按 score 排序，同分成员的相对位置就取决于插入顺序，ZRANGEBYSCORE 的结果会随写入历史变化——这是很多人上线后才发现「排行榜顺序偶尔会抖」的根因。

真实 skiplist 只是把这套语义换个实现：dict 管「成员 → 分数」的 O(1) 查询，skiplist 管「按分数排序 + span 数排名」。`
    },
    {
      title: '编码阈值不是拍脑袋，是两条成本曲线的交点',
      md: `小集合用 listpack（ziplist 的后继）：连续内存、没有指针开销，遍历一个 30 个成员的 zset 就是走一段内存，快得离谱。但它是顺序结构，插入 O(n)。

大集合必须 skiplist：O(log n) 插入，代价是每个节点带一堆指针和层级。

128 这个数字来自 Redis 作者的实测：再大下去，listpack 的插入/删除代价超过 skiplist 的指针开销。同理 hash 的 128、set 的 intset 512、string 的 44（embstr 一次性分配 redisObject + SDS）。

**这些是 redis.conf 里的配置项，不是硬编码的天理**——线上真要调，改的是 hash-max-listpack-entries 这类参数。`
    },
    {
      title: 'HLL 为什么只给 64 个桶，而不照着 16384 写',
      md: `真实 HLL 用 16384 个 6 位桶 = 12KB，标准误差 0.81%。照抄不难，但你会失去「误差」这个最重要的体感——估算值看起来永远是对的。

64 个桶的误差在 10%~20%，测试里能直接看到「200 个元素估成 181」。这时候你才会认真想：HLL 不是「计数器」，它是**用固定内存换近似值**的赌博，赌的是「我不需要知道精确有多少个，只需要知道量级」。

顺带一个常被忽略的事实：HLL 可以合并（PFMERGE 逐桶取 max），所以它能做「按天分桶再合并成月活」。` 
    }
  ],
  prereq: [
    {
      title: '五种基础类型的编码与切换阈值',
      md: `同一个类型在 Redis 里有好几套底层编码，**元素少用紧凑结构，多了换成哈希表/跳表**：

\`\`\`text
string   int（纯整数且 ≤20 位） / embstr（≤44 字节） / raw（>44 字节）
hash     listpack（≤128 字段） / hashtable
list     listpack（≤128 元素） / quicklist（分段的双向链表）
set      intset（全整数且 ≤512） / listpack（≤128） / hashtable
zset     listpack（≤128 成员） / skiplist + dict
\`\`\`

为什么要这样分？因为小集合的两大成本是「每条记录的指针开销」和「缓存局部性」，紧凑结构两头都赢；大集合的两大成本是「插入/查找的复杂度」，这时候必须上哈希表和跳表。

编码**只升不降**：一个 zset 涨到 129 个成员变成 skiplist 之后，就算删回 10 个也不会变回 listpack，除非把 key 删了重建。`
    },
    {
      title: 'ZSet = dict + skiplist：一个管查分，一个管排名',
      md: `ZSet 同时要满足两种查询：

- 给我 member 的分数（O(1)）→ dict：member → score
- 给我分数区间 / 第几名是谁（O(log n)）→ skiplist：按 (score, member) 有序，节点上还存 span（这一层跨过多少个节点），用来算排名

\`\`\`text
dict:      alice → 100
skiplist:  head → [bob 90] → [alice 100] → [carol 120] → null
\`\`\`

两个结构共享同一份 member/score 数据，改分数要同时改两边。这就是为什么 ZSet 的内存开销明显高于同规模的 Set——它把「有序」这件事的代价摆在了明面上。`
    },
    {
      title: 'HyperLogLog：固定内存、可合并、有误差',
      md: `HLL 解决的是「统计去重后的数量」：UV、日活、搜索词去重数。它不存元素，只存「哈希值的特征」。

机制：把哈希值分成两段，前 p 位决定落在哪个桶（桶数 m = 2^p），剩下的位里「第一个 1 出现在第几位」记进桶（寄存器），每个桶只保留见过的最大值。基数估算靠调和平均：桶里 0 越多说明见的元素越少。

三个必须记住的事实：

1. **内存固定**：16384 个 6 位桶 = 12KB，存 1 个和存 1 亿个都一样大；
2. **可合并**：PFMERGE 逐桶取 max，所以能按天算再合并成月；
3. **有误差**：标准误差约 0.81%，且**不能取回元素**（没有 PFMEMBERS）。要精确去重就得用 Set 或 Bitmap，那是另一笔内存账。`
    }
  ],
  api: [
    {
      name: 'ZSet',
      sig: 'new ZSet() / add(member, score): 0|1 / score(member): number|undefined / rank(member): number|null / range(start, stop): string[] / size / encoding',
      args:
        'member 任意字符串；score 必须是有限数字（否则抛错）；range 的两个下标是闭区间，支持负数（-1 表示最后一个），越界会被夹紧。',
      returns:
        'add 新增成员返回 1、更新已有成员的分数返回 0（和 ZADD 一致）；score 未命中返回 undefined；rank 是 0 起的下标，未命中返回 null；range 返回按 (score, member) 升序的成员数组；encoding 返回当前 size 对应的底层编码名。',
      example:
        "const z = new ZSet()\nz.add('alice', 100)     // 1\nz.add('bob', 90)        // 1\nz.add('alice', 95)      // 0：更新分数\nz.rank('bob')           // 0（90 最小）\nz.range(0, -1)          // ['bob', 'alice']\nz.encoding              // 'listpack'"
    },
    {
      name: 'pickEncoding',
      sig: "pickEncoding(type, size, opts?): string",
      args:
        "type 是 'string' | 'hash' | 'list' | 'set' | 'zset'；size 是该类型决定编码的度量（string 用字节数，其余用元素个数）；opts.integer 表示「成员是否全是整数」——只有 string / set 用得到。size 非法（负数、NaN）或 type 未知时抛错。",
      returns:
        "编码名：'int' | 'embstr' | 'raw' | 'listpack' | 'hashtable' | 'quicklist' | 'intset' | 'skiplist'。阈值取 redis.conf 的默认值。",
      example:
        "pickEncoding('hash', 128)                  // 'listpack'\npickEncoding('hash', 129)                  // 'hashtable'\npickEncoding('zset', 129)                  // 'skiplist'\npickEncoding('set', 512, { integer: true })// 'intset'\npickEncoding('string', 45)                 // 'raw'"
    },
    {
      name: 'HyperLogLog',
      sig: 'new HyperLogLog(precision = 6) / add(item) / count(): number / merge(other) / buckets',
      args:
        'precision 决定桶数（2^precision），默认 6 就是 64 个桶；item 任意字符串；merge 要求两边桶数相同，否则抛错。',
      returns:
        'add / merge 返回 this（可链式）；count 返回基数的估算值（是小数，不是精确整数）；buckets 是桶数，用来观察「内存不随基数增长」。',
      example:
        "const h = new HyperLogLog()\nfor (let i = 0; i < 200; i++) h.add('u:' + i)\nh.count()        // 约 181，真实 200（64 个桶误差就是这么大）\nh.buckets        // 64：存 200 个还是 5000 个，内存都一样"
    }
  ],
  stages: [
    {
      n: 1,
      title: 'ZSet：先按 (score, member) 把顺序写死',
      think:
        '第一步只做 ZSet 的排序语义。我用有序数组 + 二分插入，而不是一上来写跳表：跳表的指针错误会伪装成「顺序偶尔不对」，而顺序不对到底是语义错还是实现错，很难分。先让 add/score/rank/range 全绿，跳表只是第 3 步之后的性能替换。同分那条我在这一步就钉死成字典序，避免埋雷。',
      hint:
        'items 存 { member, score }。写一个二分 insertionPoint(score, member)：比较规则是 cur.score < score 或者分数相等且 String(cur.member) < String(member) 就往后走，返回插入位置。add 先 indexOf(member)：已有就把旧记录 splice 掉、按新分数重新插；没有就直接插，返回 1 / 0 区分。range 把负下标换算成 n + start，夹紧之后逐个 push。',
      diag: [
        'add 的返回值不对：新增返回 1、更新已有成员返回 0，别都返回 undefined。',
        '同分成员顺序随插入顺序变：比较时分数相等还要再比 member 的字典序。',
        'range 的顺序不是按分数升序：插入位置要用二分按 (score, member) 找，push 到末尾只会得到插入顺序。',
        'rank 返回了 -1 或 undefined：不存在的成员统一返回 null，命中返回 0 起的下标。',
        '负索引报错或返回空：start/stop 为负时要先换算成 n + 下标，再夹紧到 [0, n-1]。',
        '同一个成员变成两条：更新分数时要把旧位置的记录删掉再重新插入。'
      ],
      vocab: [
        { term: '字典序', md: '按字符编码逐位比较。JS 的 < 对 ASCII 字符串等价于 Redis 的二进制比较，测试里只用 ASCII 就不会踩 locale 的坑。' },
        { term: 'span', md: 'skiplist 每层指针跨过多少个节点。有了它，算排名才能是 O(log n)——这是 ZSet 用跳表而不是只用 dict 的原因。' }
      ],
      code: ZSET_STEP1,
      test: L2S1
    },
    {
      n: 2,
      title: 'pickEncoding：把阈值变成可调用的判断',
      think:
        '有了 ZSet，第二步回答「它现在用哪种编码」。我把阈值抽成 ENCODING_LIMITS 常量 + 一个 switch：这样「128 是配置项」这件事在代码里是可见的，而不是散落在 if 里。顺带把另外四种类型的阈值一起写掉——它们本来就是同一张表，分开写反而容易记混。ZSet 上加一个 encoding getter，让编码这件事能从一个真实对象上观察。',
      hint:
        '先写 ENCODING_LIMITS 常量表（string 20 / 44、hash 128、list 128、set 512 / 128、zset 128），再写 pickEncoding(type, size, opts)：入口先校验 size 是非负有限数字，然后 switch(type)，每个分支只比阈值返回编码名，default 抛「未知类型」。ZSet 上加 get encoding()，内部就是 pickEncoding(\'zset\', this.size)。',
      diag: [
        'hash 的 128 边界差一：阈值是「≤ 128 用 listpack」，129 才转 hashtable。',
        'zset 在 129 个成员时还报 listpack：判断要用 > 阈值，别写成 >=。',
        'set 的 intset 与普通集合混了：opts.integer 为真时按 512 判 intset，否则按 128 判 listpack/hashtable。',
        'string 的 int / embstr / raw 三档串了：整数且 ≤20 位才是 int，装不进 64 位的「整数」要退回按 44 字节判 embstr / raw。',
        'list 的编码名写成了 hashtable：list 超过 128 个元素是 quicklist（分段的双向链表）。',
        'ZSet.encoding 一直是 skiplist：getter 里传的是常量而不是 this.size，或者把 128 写成了 1280。',
        '非法参数没抛错：入口要先校验 Number.isFinite(size) 且 size >= 0，default 分支要 throw。'
      ],
      vocab: [
        { term: 'embstr', md: '长度 ≤44 的字符串，redisObject 和 SDS 一次 malloc 分配，读的时候少一次内存跳转。超过就变成 raw。' },
        { term: 'listpack', md: 'Redis 5.0 引入、7.0 全面取代 ziplist 的紧凑结构：连续内存 + 变长编码，省掉每个元素的指针。' }
      ],
      code: L2_STEP2,
      test: L2S2
    },
    {
      n: 3,
      title: 'HyperLogLog：64 个桶怎么估出 200',
      think:
        '最后一块是基数估算。我不照抄 16384 桶：桶太多误差小到看不出来，反而学不到东西。64 个桶、FNV-1a + 混淆做哈希、用「哈希后缀里第一个 1 的位置」当特征，最后用调和平均 + 线性计数兜小基数。这一步的验收点特意写成「落在 ±20% 内」而不是「等于 200」——HLL 的契约本来就是近似。',
      hint:
        '先写 hash32(str)：FNV-1a 逐字符乘 16777619，最后做三轮 xor-shift + 乘法混淆，保证桶号分布均匀。add 里：idx 取低位、rest 取高位，数 rest 尾部连续 0 的个数得到 rank（至少 1），只保留桶里的最大值。count 里累加 2^-r 与 0 桶数，公式 alpha * m * m / sum；raw 小且还有空桶时改用 m * ln(m / zeros)。merge 逐桶取 max，桶数不同直接抛错。',
      diag: [
        '空 HLL 的 count 不是 0：sum 全是 1 时要走线性计数分支，zeros = m 时 ln(1) = 0。',
        '估算值离 200 太远：rank 要取「高位部分」的尾部 0 个数，取错位会让所有元素挤进少数桶。',
        '重复 add 让基数翻倍：寄存器只保留更大的 rank，不能累加。',
        '加 5000 个元素后估算爆了：桶数要固定为 1 << precision，寄存器数组不能随元素增长。',
        'merge 之后估算偏小：合并要逐桶取 max（并集的特征），不能相加也不能取平均。',
        '大量重复元素估得太大：重复元素的哈希相同、落在同一个桶，寄存器不会涨——检查是不是每次 add 都新建了桶。'
      ],
      vocab: [
        { term: '调和平均', md: 'HLL 用 1 / Σ(2^-r) 而不是算术平均。因为只要有一个桶的 rank 很大，算术平均会被它带偏，调和平均更稳。' },
        { term: '线性计数', md: '基数远小于桶数时，用「空桶比例」估基数：m * ln(m / 空桶数)，比原始公式准得多。' }
      ],
      code: L2_STEP3,
      test: L2S3
    }
  ],
  finalCode: L2_STEP3,
  usage: `// 1) 排行榜：分数 + 排名 + 区间
const board = new ZSet()
board.add('alice', 100)
board.add('bob', 90)
board.add('carol', 120)
board.range(0, -1)     // ['bob', 'alice', 'carol']
board.rank('carol')    // 2
board.add('alice', 130)
board.range(0, 0)      // ['alice']

// 2) 编码：同一份数据在 128 个成员前后用两套结构
board.encoding                            // 'listpack'
pickEncoding('zset', 128)                 // 'listpack'
pickEncoding('zset', 129)                 // 'skiplist'
pickEncoding('hash', 129)                 // 'hashtable'
pickEncoding('set', 600, { integer: true }) // 'hashtable'

// 3) 基数：日活按天算，再合并成月活
const monday = new HyperLogLog()
const tuesday = new HyperLogLog()
for (let i = 0; i < 200; i++) monday.add('user:' + i)
for (let i = 100; i < 300; i++) tuesday.add('user:' + i)
monday.count()          // 200.1（真实 200，64 个桶这次刚好猜中）
monday.merge(tuesday)
monday.count()          // 284.3（并集是 300，误差 5%）`,
  concepts: [
    {
      title: '通关后复盘：编码是「成本模型」的产物',
      md: `这一关真正该带走的是三句话：

1. **编码只升不降**。zset 涨到 129 个成员变 skiplist 之后，删回 10 个也不会变回 listpack；要变回去只能删 key 重建。这就是为什么临时塞进大集合再清空的 key，内存不会降下来。
2. **阈值是配置，不是常量**。线上调 hash-max-listpack-entries 会直接改变内存和 CPU 的平衡；改之前先想清楚你更缺哪一个。
3. **HLL 是「量级」工具，不是计数器**。要精确值就用 Set / Bitmap，代价是内存随基数线性涨。`
    }
  ],
  skeleton: `/**
 * 第 2 关 · 编码选择：ZSet、阈值与 HyperLogLog
 *
 * 交付三样东西：
 *   ZSet        —— add / score / rank / range，按 (score, member) 升序
 *   pickEncoding—— 按 redis.conf 的阈值判断五种类型各自的编码
 *   HyperLogLog —— 64 个桶的基数估算，支持合并
 */
class ZSet {
  constructor() {
    this.items = []
  }

  get size() {
    return this.items.length
  }

  /** 当前编码（第 2 步才需要实现） */
  get encoding() {
    // TODO 1：交给 pickEncoding('zset', this.size)
    return 'listpack'
  }

  add(member, score) {
    // TODO 2：已有成员先摘掉再按新分数插入；返回 1（新增）/ 0（更新）
    return 0
  }

  score(member) {
    // TODO 3：找不到返回 undefined
    return undefined
  }

  rank(member) {
    // TODO 4：找不到返回 null
    return null
  }

  range(start, stop) {
    // TODO 5：负索引换算 + 夹紧，返回闭区间内的成员
    return []
  }
}

const ENCODING_LIMITS = {
  stringInt: 20,
  stringEmbstr: 44,
  hashListpack: 128,
  listListpack: 128,
  setIntset: 512,
  setListpack: 128,
  zsetListpack: 128
}

function pickEncoding(type, size, opts = {}) {
  // TODO 6：校验 size；switch(type) 逐个比阈值返回编码名；未知类型抛错
  throw new Error('TODO 6 未实现：按 ENCODING_LIMITS 判断编码')
}

function hash32(str) {
  // TODO 7：FNV-1a + 混淆，返回 32 位无符号整数
  return 0
}

class HyperLogLog {
  constructor(precision = 6) {
    this.precision = precision
    this.buckets = 1 << precision
    this.registers = new Array(this.buckets).fill(0)
  }

  add(item) {
    // TODO 8：桶号取低位，rank 取高位尾部 0 的个数，只保留最大值
    return this
  }

  count() {
    // TODO 9：调和平均 + 线性计数兜小基数
    return 0
  }

  merge(other) {
    // TODO 10：桶数不同抛错，逐桶取 max
    return this
  }
}
`,
  solution: L2_STEP3,
  tests: [L2S1, L2S2, L2S3].join('\n\n')
}
/* ============================================================ 第 3 关测试 */

const L3S1 = `{
  check('未命中会回源，并把值按 TTL 写进缓存', async () => {
    const cache = new MemoryCache()
    const rows = { user: 'A' }
    let calls = 0
    const db = {
      async get(k) { calls++; return rows[k] },
      async set(k, v) { rows[k] = v }
    }
    const aside = new CacheAside({ cache, db, ttlSeconds: 60 })
    same(await aside.readThrough('user'), 'A')
    same(calls, 1)
    same(cache.get('user'), 'A')
    same(cache.ttl('user'), 60)
    same(aside.stats().misses, 1)
  })
  check('第二次读命中缓存，不再回源', async () => {
    const cache = new MemoryCache()
    let calls = 0
    const db = {
      async get() { calls++; return 'V' },
      async set() {}
    }
    const aside = new CacheAside({ cache, db })
    await aside.readThrough('k')
    same(await aside.readThrough('k'), 'V')
    same(calls, 1, '第二次不该再打数据库')
    same(aside.stats().hits, 1)
    same(aside.stats().misses, 1)
  })
  check('hitRate = 命中 / (命中 + 未命中)', async () => {
    const cache = new MemoryCache()
    const db = {
      async get() { return 'V' },
      async set() {}
    }
    const aside = new CacheAside({ cache, db })
    await aside.readThrough('a')
    await aside.readThrough('a')
    await aside.readThrough('a')
    same(aside.stats().hitRate, 2 / 3)
    same(aside.stats().dbLoads, 1)
  })
  check('writeThrough：先落库成功，再删缓存', async () => {
    const log = []
    const store = new Map([['k', { value: 'old', ttl: 60 }]])
    const cache = {
      get: (k) => (store.has(k) ? store.get(k).value : undefined),
      set: (k, v, ttl) => store.set(k, { value: v, ttl }),
      del: (k) => { log.push('cache.del'); return store.delete(k) ? 1 : 0 },
      ttl: (k) => (store.has(k) ? store.get(k).ttl : null)
    }
    const rows = { k: 'old' }
    const db = {
      async get(k) { return rows[k] },
      async set(k, v) { await Promise.resolve(); rows[k] = v; log.push('db.set') }
    }
    const aside = new CacheAside({ cache, db })
    await aside.writeThrough('k', 'new')
    same(log, ['db.set', 'cache.del'], '必须先落库、再删缓存')
    same(cache.get('k'), undefined)
    same(await aside.readThrough('k'), 'new', '缓存删掉之后，下一次读会从库里重新回填')
  })
}`

const L3S2 = `{
  check('布隆过滤器：加进去的一定判 true，稀疏时不会假阳性', () => {
    const f = new BloomFilter({ bits: 64, hashes: 3 })
    for (const k of ['a', 'b', 'c']) f.add(k)
    for (const k of ['a', 'b', 'c']) ok(f.has(k), k + ' 是加进去的，绝不能判 false（布隆没有假阴性）')
    ok(!f.has('zzz'), '只加了 3 个元素时不该假阳性')
  })
  check('布隆过滤器：位图饱和之后会假阳性，这是固有限制不是 bug', () => {
    const f = new BloomFilter({ bits: 16, hashes: 3 })
    for (let i = 0; i < 12; i++) f.add('user:' + i)
    ok(f.has('ghost'), '16 个位几乎全被填满之后，任何 key 都容易命中')
  })
  check('布隆挡住的 key 一次都不回源（防穿透的核心收益）', async () => {
    const cache = new MemoryCache()
    let calls = 0
    const db = {
      async get() { calls++; return undefined },
      async set() {}
    }
    const bloom = new BloomFilter({ bits: 64, hashes: 3 })
    bloom.add('real')
    const aside = new CacheAside({ cache, db, bloom })
    same(await aside.readThrough('ghost'), undefined)
    same(calls, 0, '布隆说不存在就是不存在，不要打数据库')
    same(aside.stats().penetrationBlocked, 1)
  })
  check('回源结果为空也要写进缓存（空值缓存顶住穿透）', async () => {
    const cache = new MemoryCache()
    let calls = 0
    const db = {
      async get() { calls++; return undefined },
      async set() {}
    }
    const aside = new CacheAside({ cache, db })
    same(await aside.readThrough('nope'), undefined)
    same(await aside.readThrough('nope'), undefined)
    same(calls, 1, '第二次应该命中空值缓存，不再回源')
    same(aside.stats().nullCached, 1)
    same(aside.stats().nullHits, 1)
  })
  check('空值命中不算进 hitRate（否则缓存指标会失真）', async () => {
    const cache = new MemoryCache()
    const db = {
      async get() { return undefined },
      async set() {}
    }
    const aside = new CacheAside({ cache, db })
    await aside.readThrough('x')
    await aside.readThrough('x')
    same(aside.stats().hits, 0)
    same(aside.stats().misses, 1)
    same(aside.stats().hitRate, 0)
  })
}`

const L3S3 = `{
  check('并发读同一个 key：数据库只被查一次', async () => {
    const cache = new MemoryCache()
    let calls = 0
    let openGate
    const gate = new Promise((resolve) => { openGate = resolve })
    const db = {
      async get() { calls++; await gate; return 'V' },
      async set() {}
    }
    const aside = new CacheAside({ cache, db })
    const p1 = aside.readThrough('hot')
    const p2 = aside.readThrough('hot')
    const p3 = aside.readThrough('hot')
    openGate()
    const vals = await Promise.all([p1, p2, p3])
    same(vals, ['V', 'V', 'V'], '三个请求都该拿到那次回源的结果')
    same(calls, 1, '三个并发请求只该回源一次')
    same(aside.stats().stampedeSaved, 2)
  })
  check('回源抛错：错误原样抛出，互斥标记要清掉（否则这个 key 永久卡死）', async () => {
    const cache = new MemoryCache()
    let failing = true
    const db = {
      async get() {
        if (failing) throw new Error('db down')
        return 'ok'
      },
      async set() {}
    }
    const aside = new CacheAside({ cache, db })
    let caught = null
    try {
      await aside.readThrough('x')
    } catch (e) {
      caught = e
    }
    ok(caught && /db down/.test(caught.message), '回源的错误必须原样抛给调用方')
    failing = false
    same(await aside.readThrough('x'), 'ok', '上一次失败留下的互斥标记必须被清掉')
  })
  check('不同 key 各自回源，互斥只锁同一个 key', async () => {
    const cache = new MemoryCache()
    let calls = 0
    const db = {
      async get(k) { calls++; return 'v:' + k },
      async set() {}
    }
    const aside = new CacheAside({ cache, db })
    const vals = await Promise.all([aside.readThrough('a'), aside.readThrough('b')])
    same(vals, ['v:a', 'v:b'])
    same(calls, 2)
    same(aside.stats().stampedeSaved, 0)
  })
}`

const L3S4 = `{
  check('TTL = 基础值 + 随机抖动，且不超过基础值 + 抖动上限', async () => {
    const cache = new MemoryCache()
    const seq = [0, 0.9]
    let i = 0
    const db = {
      async get() { return 'v' },
      async set() {}
    }
    const aside = new CacheAside({
      cache, db, ttlSeconds: 60, jitterSeconds: 30, random: () => seq[i++]
    })
    await aside.readThrough('a')
    await aside.readThrough('b')
    same(cache.ttl('a'), 60)
    same(cache.ttl('b'), 87)
    ok(cache.ttl('b') >= 60 && cache.ttl('b') <= 90, '抖动之后必须落在 [60, 90]')
  })
  check('抖动配置为 0 时 TTL 固定（默认行为不能被改变）', async () => {
    const cache = new MemoryCache()
    const db = {
      async get() { return 'v' },
      async set() {}
    }
    const aside = new CacheAside({ cache, db, ttlSeconds: 60 })
    await aside.readThrough('k')
    same(cache.ttl('k'), 60)
  })
}`

/* ============================================================ 第 3 关代码 */

const L3_CACHE_CORE = `/**
 * 空值的哨兵：缓存里放一个不可能等于业务值的标记，
 * 用来区分「没缓存过」（undefined）和「缓存过、结果是空」。
 */
const NULL_MARK = '__LF_NULL__'

/**
 * 极简缓存后端，模拟 Redis 的 get / set(EX) / del。
 * 这里只记 TTL 数值，真正的过期机制在第 1 关已经写过了。
 */
class MemoryCache {
  constructor() {
    this.map = new Map()
  }

  get(key) {
    const entry = this.map.get(key)
    return entry === undefined ? undefined : entry.value
  }

  set(key, value, ttlSeconds = null) {
    this.map.set(key, { value, ttl: ttlSeconds })
  }

  del(key) {
    return this.map.delete(key) ? 1 : 0
  }

  has(key) {
    return this.map.has(key)
  }

  ttl(key) {
    const entry = this.map.get(key)
    return entry === undefined ? null : entry.ttl
  }

  keys() {
    return [...this.map.keys()]
  }
}
`

const L3_BLOOM_CORE = `function hash32(str) {
  let h = 2166136261
  const s = String(str)
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  h ^= h >>> 16
  h = Math.imul(h, 2246822507) >>> 0
  h ^= h >>> 13
  h = Math.imul(h, 3266489909) >>> 0
  h ^= h >>> 16
  return h >>> 0
}

/**
 * 布隆过滤器：用 k 个哈希位置表示一个元素在不在集合里。
 * 只有假阳性、没有假阴性；而且**不能删除**（删一个会把别人也删掉）。
 */
class BloomFilter {
  constructor({ bits = 64, hashes = 3 } = {}) {
    this.bits = bits
    this.hashes = hashes
    this.data = new Array(bits).fill(0)
  }

  /** 双哈希：h1 + i * h2，只需要算两次哈希就能得到 k 个位置 */
  positions(item) {
    const h1 = hash32(item)
    const h2 = hash32('#:' + item) | 1
    const out = []
    for (let i = 0; i < this.hashes; i++) out.push(((h1 + Math.imul(i, h2)) >>> 0) % this.bits)
    return out
  }

  add(item) {
    for (const p of this.positions(item)) this.data[p] = 1
    return this
  }

  has(item) {
    for (const p of this.positions(item)) if (this.data[p] === 0) return false
    return true
  }

  /** 已置位的位数占比，用来观察「饱和」 */
  get fill() {
    let n = 0
    for (const b of this.data) if (b) n++
    return n / this.bits
  }
}
`

const L3_ASIDE1 = `/**
 * Cache Aside：
 *   读：先读缓存 → 未命中回源 → 回填缓存
 *   写：先更新数据库 → 再删缓存（不是更新缓存）
 */
class CacheAside {
  constructor({ cache, db, ttlSeconds = 60, nullTtlSeconds = 5 } = {}) {
    this.cache = cache
    this.db = db
    this.ttlSeconds = ttlSeconds
    this.nullTtlSeconds = nullTtlSeconds
    this.counters = { hits: 0, misses: 0, dbLoads: 0 }
  }

  async readThrough(key) {
    const cached = this.cache.get(key)
    if (cached !== undefined) {
      this.counters.hits++
      return cached
    }

    this.counters.misses++
    this.counters.dbLoads++
    const value = await this.db.get(key)
    if (value !== undefined && value !== null) this.cache.set(key, value, this.ttlSeconds)
    return value
  }

  async writeThrough(key, value) {
    await this.db.set(key, value)
    this.cache.del(key)
    return value
  }

  stats() {
    const total = this.counters.hits + this.counters.misses
    return { ...this.counters, hitRate: total === 0 ? 0 : this.counters.hits / total }
  }
}`

const L3_ASIDE2 = `/**
 * 第 3 关 · 第 2 步：靠布隆 + 空值缓存挡住「查不存在的 key」
 *
 * 穿透的两种形态：
 *   1. key 根本不存在（伪造 id 扫库）→ 布隆过滤器在入口就拦掉
 *   2. key 存在但结果为空（软删除、脏数据）→ 把空值也缓存一小会儿
 */
class CacheAside {
  constructor({ cache, db, ttlSeconds = 60, nullTtlSeconds = 5, bloom = null } = {}) {
    this.cache = cache
    this.db = db
    this.ttlSeconds = ttlSeconds
    this.nullTtlSeconds = nullTtlSeconds
    this.bloom = bloom
    this.counters = {
      hits: 0, misses: 0, dbLoads: 0,
      nullHits: 0, nullCached: 0, penetrationBlocked: 0
    }
  }

  async readThrough(key) {
    const cached = this.cache.get(key)
    if (cached === NULL_MARK) {
      this.counters.nullHits++
      return undefined
    }
    if (cached !== undefined) {
      this.counters.hits++
      return cached
    }

    // 布隆说不存在，就一定不存在（没有假阴性），连库都不用查
    if (this.bloom && !this.bloom.has(key)) {
      this.counters.penetrationBlocked++
      return undefined
    }

    this.counters.misses++
    return this.load(key)
  }

  async load(key) {
    this.counters.dbLoads++
    const value = await this.db.get(key)
    if (value === undefined || value === null) {
      this.counters.nullCached++
      this.cache.set(key, NULL_MARK, this.nullTtlSeconds)
      return undefined
    }
    this.cache.set(key, value, this.ttlSeconds)
    return value
  }

  async writeThrough(key, value) {
    await this.db.set(key, value)
    this.cache.del(key)
    return value
  }

  stats() {
    const total = this.counters.hits + this.counters.misses
    return { ...this.counters, hitRate: total === 0 ? 0 : this.counters.hits / total }
  }
}`

const L3_ASIDE3 = `/**
 * 第 3 关 · 第 3 步：单飞（single-flight）互斥重建
 *
 * 击穿的典型场景：热点 key 一过期，一万个请求同时发现 miss，同时回源。
 * 解法不是「加锁再查一次」，而是让并发的请求**共享同一个回源 Promise**：
 * 只有第一个请求真的去查库，其余的都 await 它。
 */
class CacheAside {
  constructor({ cache, db, ttlSeconds = 60, nullTtlSeconds = 5, bloom = null } = {}) {
    this.cache = cache
    this.db = db
    this.ttlSeconds = ttlSeconds
    this.nullTtlSeconds = nullTtlSeconds
    this.bloom = bloom
    this.inflight = new Map()
    this.counters = {
      hits: 0, misses: 0, dbLoads: 0,
      nullHits: 0, nullCached: 0, penetrationBlocked: 0, stampedeSaved: 0
    }
  }

  async readThrough(key) {
    const cached = this.cache.get(key)
    if (cached === NULL_MARK) {
      this.counters.nullHits++
      return undefined
    }
    if (cached !== undefined) {
      this.counters.hits++
      return cached
    }

    if (this.bloom && !this.bloom.has(key)) {
      this.counters.penetrationBlocked++
      return undefined
    }

    const running = this.inflight.get(key)
    if (running) {
      this.counters.stampedeSaved++
      return running
    }

    this.counters.misses++
    const task = this.load(key)
    this.inflight.set(key, task)
    try {
      return await task
    } finally {
      // 无论成功还是失败都要摘掉标记，否则这个 key 永久卡死
      if (this.inflight.get(key) === task) this.inflight.delete(key)
    }
  }

  async load(key) {
    this.counters.dbLoads++
    const value = await this.db.get(key)
    if (value === undefined || value === null) {
      this.counters.nullCached++
      this.cache.set(key, NULL_MARK, this.nullTtlSeconds)
      return undefined
    }
    this.cache.set(key, value, this.ttlSeconds)
    return value
  }

  async writeThrough(key, value) {
    await this.db.set(key, value)
    this.cache.del(key)
    return value
  }

  stats() {
    const total = this.counters.hits + this.counters.misses
    return { ...this.counters, hitRate: total === 0 ? 0 : this.counters.hits / total }
  }
}`

const L3_ASIDE4 = `/**
 * 第 3 关 · 第 4 步：TTL 加随机抖动（防雪崩）
 *
 * 雪崩：一批 key 在同一秒过期，缓存集体失效，请求全部压到数据库。
 * 解法之一：让过期时间散开。random 是注入的，测试才能给固定序列。
 */
class CacheAside {
  constructor({
    cache, db, ttlSeconds = 60, nullTtlSeconds = 5,
    jitterSeconds = 0, random = Math.random, bloom = null
  } = {}) {
    this.cache = cache
    this.db = db
    this.ttlSeconds = ttlSeconds
    this.nullTtlSeconds = nullTtlSeconds
    this.jitterSeconds = jitterSeconds
    this.random = random
    this.bloom = bloom
    this.inflight = new Map()
    this.counters = {
      hits: 0, misses: 0, dbLoads: 0,
      nullHits: 0, nullCached: 0, penetrationBlocked: 0, stampedeSaved: 0
    }
  }

  /** 基础 TTL + [0, jitterSeconds] 的随机偏移，把过期时刻打散 */
  ttlFor() {
    if (this.jitterSeconds <= 0) return this.ttlSeconds
    return this.ttlSeconds + Math.floor(this.random() * (this.jitterSeconds + 1))
  }

  async readThrough(key) {
    const cached = this.cache.get(key)
    if (cached === NULL_MARK) {
      this.counters.nullHits++
      return undefined
    }
    if (cached !== undefined) {
      this.counters.hits++
      return cached
    }

    if (this.bloom && !this.bloom.has(key)) {
      this.counters.penetrationBlocked++
      return undefined
    }

    const running = this.inflight.get(key)
    if (running) {
      this.counters.stampedeSaved++
      return running
    }

    this.counters.misses++
    const task = this.load(key)
    this.inflight.set(key, task)
    try {
      return await task
    } finally {
      if (this.inflight.get(key) === task) this.inflight.delete(key)
    }
  }

  async load(key) {
    this.counters.dbLoads++
    const value = await this.db.get(key)
    if (value === undefined || value === null) {
      this.counters.nullCached++
      this.cache.set(key, NULL_MARK, this.nullTtlSeconds)
      return undefined
    }
    this.cache.set(key, value, this.ttlFor())
    return value
  }

  async writeThrough(key, value) {
    await this.db.set(key, value)
    this.cache.del(key)
    return value
  }

  stats() {
    const total = this.counters.hits + this.counters.misses
    return { ...this.counters, hitRate: total === 0 ? 0 : this.counters.hits / total }
  }
}`

const L3_STEP1 = `${L3_CACHE_CORE}
${L3_ASIDE1}`

const L3_STEP2 = `${L3_CACHE_CORE}
${L3_BLOOM_CORE}
${L3_ASIDE2}`

const L3_STEP3 = `${L3_CACHE_CORE}
${L3_BLOOM_CORE}
${L3_ASIDE3}`

const L3_STEP4 = `${L3_CACHE_CORE}
${L3_BLOOM_CORE}
${L3_ASIDE4}`

/* ============================================================ 第 3 关 */

const LV3 = {
  id: 'lv3',
  title: '缓存三问题：布隆、互斥与抖动',
  emoji: '🛡️',
  xp: 60,
  goal:
    '实现 CacheAside（readThrough / writeThrough + 命中率统计），并接入布隆过滤器与空值缓存防穿透、单飞互斥防击穿、随机 TTL 抖动防雪崩。',
  why:
    '缓存从来不是一个 get/set，而是一整套「数据库扛不住时缓存怎么兜」的约定。穿透、击穿、雪崩三种事故长得像，药完全不同：穿透要拦住不存在的 key，击穿要别让一万个请求同时重建同一个 key，雪崩要别让所有 key 同时过期。更难的是写路径——先更新库还是先删缓存，顺序错了就是长期脏数据。这一关把四条纪律都写成能跑、能测的代码。',
  nodes: ['be.redis.cache', 'be.redis.cache.patterns'],
  thinking: [
    {
      title: '写路径为什么必须是「先更新数据库，再删缓存」',
      md: `我先把三种写法都摆出来比：

1. **先删缓存再更新库**：删完到写完之间有个窗口，这期间的读会 miss 回源，把**旧值**重新填进缓存，然后新值落库——缓存从此长期是旧的。
2. **更新数据库 + 更新缓存**：两个并发写可能以「A 写库 → B 写库 → B 写缓存 → A 写缓存」的顺序交错，缓存留下的是 A 的旧值。
3. **更新数据库 + 删缓存**：窗口期只有「库已新、缓存为空」这一小段，这期间最多多一次回源，回源读到的是新值。

所以标准答案是第三种。它不是绝对一致（删缓存也可能失败），所以真实系统还要靠 TTL 兜底、延迟双删、或者订阅 binlog 异步补偿。这一关我把它做成可观察的：测试里用注入的 cache 记录「db.set 和 cache.del 谁先发生」。`
    },
    {
      title: '布隆挡不住的那部分，要靠空值缓存接住',
      md: `第一反应是「有布隆就够了」。但布隆有两个性质决定了它不够：**有假阳性**（不存在的 key 可能被判存在），**不能删除**（删一个会把同位置的别人也删掉）。

假阳性意味着总有漏网之鱼会打到数据库。这时候第二道闸是空值缓存：回源结果是空，也写一条带短 TTL 的标记。这样同一个不存在的 key 在 TTL 内只会打库一次。

所以防穿透是两层：布隆挡掉绝大多数（不耗内存里的真实数据），空值缓存挡住假阳性和「存在但为空」的情况。测试里我把两层的收益分别记成 penetrationBlocked 和 nullCached，就是为了说明它们不是同一件事。`
    },
    {
      title: '互斥重建为什么是「共享同一个 Promise」，而不是「等锁再查一次」',
      md: `击穿的标准答案常被写成「加分布式锁，拿到锁的去回源，没拿到的 sleep 再重试」。在单进程里，「重试」意味着再来一次 cache miss、再判一次锁——而更直接的写法是把**这次回源本身**共享出去。

我用一个 inflight: Map<key, Promise>：第一个请求发现 miss，就把 load(key) 的 Promise 存进去；后到的请求直接 await 同一个 Promise。它们拿到的结果完全一致，也不需要 sleep 或轮询。

关键在 finally 里必须清标记——否则回源抛错之后，这个 key 的标记永远留着，后续请求会一直 await 一个已经 reject 的 Promise，变成永久卡死。这条我专门写了一个 check。`
    }
  ],
  prereq: [
    {
      title: 'Cache Aside：读路径和写路径各四条边',
      md: `读：读缓存 → 命中就返回；未命中 → 查库 → 回填缓存 → 返回。

写：更新数据库 → 删缓存（**不是更新缓存**）→ 返回。

为什么删而不是更新？因为「更新缓存」在并发写时会乱序（后写的可能先执行），缓存里留下旧值；而「删」是幂等的，删错了最多多一次回源。

为什么不是「先删再写库」？因为删完到写库之间，读请求会把旧值回填进去，这个脏数据会一直留到 TTL 过期。

它保证的是**最终一致**，不是强一致：删缓存可能失败、主从延迟可能让读拿到旧库。所以真实系统还要 TTL 兜底、延迟双删（写库后延迟几百毫秒再删一次，把窗口期内回填的旧值清掉）、或者订阅 binlog 异步删。`
    },
    {
      title: '穿透 / 击穿 / 雪崩：三种事故，三种药',
      md: `\`\`\`text
穿透  查一个根本不存在的 key（伪造 id 扫库）   布隆过滤器 / 空值缓存
击穿  一个热点 key 突然过期，瞬间全压到数据库   互斥重建 / 逻辑过期 / 永不过期
雪崩  大批 key 同时过期，或缓存集群整体挂掉     随机 TTL / 多级缓存 / 熔断限流
\`\`\`

区分它们的方法很简单：**问「失效的是零个、一个还是很多个 key」**。

- 查不到 → 穿透，问题在「key 不存在」
- 一个热点 key → 击穿，问题在「重建瞬间的并发」
- 一大片 key → 雪崩，问题在「过期时刻撞车」或「缓存层整体不可用」

三者经常同时出现（比如大促前批量预热、同一时刻过期），所以要按顺序都做掉，而不是选一个。`
    },
    {
      title: '布隆过滤器：没有假阴性，不能删除',
      md: `布隆过滤器 = 一个位数组 + k 个哈希函数。加入元素时把 k 个位置置 1；查询时只要有一个位置是 0，就一定**不在**集合里。

两个必须记住的性质：

1. **没有假阴性**：加进去的元素一定判 true。所以它可以放在缓存前面做「一定不存在」的拦截。
2. **有假阳性，且不能删除**：位是共享的，删一个元素会把共用这些位的其他元素也「删掉」，制造假阴性。要支持删除得用计数布隆（每个位改成计数器）或布谷鸟过滤器。

容量估算：n 个元素、误判率 p，需要 m = -n·ln(p)/(ln2)² 位，k = (m/n)·ln2 个哈希。所以 1 亿元素、1% 误判率大约 96MB——比存真实元素省太多，这也是它常驻在缓存前面的原因。`
    }
  ],
  api: [
    {
      name: 'MemoryCache',
      sig: 'new MemoryCache() / get(key) / set(key, value, ttlSeconds?) / del(key) / has(key) / ttl(key) / keys()',
      args: 'key 任意字符串；value 任意；ttlSeconds 只记录数值（过期机制在第 1 关，这里不重复实现）。',
      returns: 'get 未命中返回 undefined；set 无返回；del 删掉返回 1、没删到返回 0；has 返回布尔；ttl 返回记录的 TTL 或 null；keys 返回全部 key。',
      example:
        "const cache = new MemoryCache()\ncache.set('user:1', 'A', 60)\ncache.get('user:1')   // 'A'\ncache.ttl('user:1')   // 60\ncache.del('user:1')   // 1"
    },
    {
      name: 'BloomFilter',
      sig: 'new BloomFilter({ bits = 64, hashes = 3 }) / add(item) / has(item) / fill',
      args: 'bits 是位数组长度；hashes 是哈希个数（双哈希展开）。item 任意字符串。',
      returns: 'add 返回 this；has 返回布尔（true 只能说「可能存在」，false 一定不存在）；fill 返回已置位比例（0~1），用来观察饱和。',
      example:
        "const f = new BloomFilter({ bits: 16, hashes: 3 })\nf.add('user:1')\nf.has('user:1')   // true\nf.has('user:2')   // false（还没加过）\nfor (let i = 0; i < 12; i++) f.add('user:' + i)\nf.has('ghost')    // true —— 位图饱和后的假阳性"
    },
    {
      name: 'CacheAside',
      sig: 'new CacheAside({ cache, db, ttlSeconds, nullTtlSeconds, jitterSeconds, random, bloom }) / readThrough(key) / writeThrough(key, value) / stats()',
      args:
        'cache 是缓存后端（get/set/del/ttl）；db 是数据源（async get(key) / async set(key, value)）；ttlSeconds 基础 TTL；nullTtlSeconds 空值缓存的 TTL；jitterSeconds 抖动上限；random 是注入的随机函数（默认 Math.random）；bloom 可选，传了就启用穿透拦截。',
      returns:
        'readThrough / writeThrough 都返回 Promise：读返回值（不存在返回 undefined），写返回写入的值。stats() 返回 { hits, misses, dbLoads, nullHits, nullCached, penetrationBlocked, stampedeSaved, hitRate }，hitRate 只算真实值命中。',
      example:
        "const aside = new CacheAside({ cache, db, ttlSeconds: 60, bloom })\nawait aside.readThrough('user:1')    // 回源一次\nawait aside.readThrough('user:1')    // 命中缓存\nawait aside.readThrough('ghost')     // 布隆拦掉，不回源\nawait aside.writeThrough('user:1', 'B')   // 写库 + 删缓存\naside.stats().hitRate                // 0.5"
    }
  ],
  stages: [
    {
      n: 1,
      title: 'Cache Aside 的两条路：读回填、写删缓存',
      think:
        '第一步只做读写主路，不碰穿透/击穿/雪崩。我想先把「写路径的顺序」这件事变成可观测的：CacheAside 的 cache 是注入的，测试可以塞一个记录调用的假 cache，直接看 db.set 和 cache.del 谁先发生。顺序这件事光讲没用，写一条断言才记得住。',
      hint:
        'MemoryCache 用 Map 存 { value, ttl }，get 未命中返回 undefined。CacheAside 构造函数收 cache / db / ttlSeconds。readThrough：先 cache.get，不是 undefined 就 hits++ 并返回；否则 misses++、dbLoads++，await db.get(key)，拿到非空值就 cache.set(key, value, ttlSeconds)。writeThrough 必须先 await db.set，成功之后才 cache.del。stats 里 hitRate 分母是 hits + misses。',
      diag: [
        '回源之后忘了写缓存：cache.set 要带上 ttlSeconds，否则下一次读还是未命中。',
        '第二次读还是回源：命中判断要用 !== undefined（缓存里可能存的是空串或 0），并且命中要 hits++。',
        'hitRate 算错：分母是命中 + 未命中，只除命中会得到 1 或者 NaN。',
        '写路径顺序反了：必须 await db.set 成功之后再 cache.del，先删缓存会把旧值放回缓存。'
      ],
      vocab: [
        { term: 'Cache Aside', md: '旁路缓存：业务代码自己读写缓存，缓存不感知数据库。读 miss 回填、写先库后删，是最常用的模式。' },
        { term: 'hitRate', md: '命中率 = 命中 / 总请求。它是缓存效果的唯一硬指标，比 QPS 更能说明缓存有没有起作用。' }
      ],
      code: L3_STEP1,
      test: L3S1
    },
    {
      n: 2,
      title: '防穿透：布隆过滤器 + 空值缓存',
      think:
        '第二步解决「查不存在的 key」。我特意分两层写：布隆拦掉绝大多数伪造 id（不占真实数据内存），空值缓存接住布隆的假阳性和「存在但值为空」的情况。如果只做布隆，测试里那条「回源结果为空也要缓存」就会红——这正是我想让人看见的：布隆不是万能的，它有假阳性。',
      hint:
        'BloomFilter 用双哈希：h1 = hash32(item)，h2 = hash32(\'#:\' + item) | 1（保证奇数），位置就是 (h1 + i * h2) % bits。add 置位、has 逐位检查。CacheAside 里：构造收 bloom 和 nullTtlSeconds，新增三个计数器；readThrough 先判缓存值是不是 NULL_MARK（是就 nullHits++ 返回 undefined），再判 bloom.has，false 就 penetrationBlocked++ 返回 undefined；把回源那段抽成 load(key)，值为空时写 NULL_MARK。',
      diag: [
        '布隆把加进去的元素判成 false：置位和查询必须用同一套 positions，别一处用 % bits 另一处用 & (bits-1)。',
        '稀疏布隆就假阳性：位置算错时所有元素会挤到同几个位上，检查 h2 取的是不是另一路哈希。',
        '布隆没拦住请求：readThrough 里查布隆要在 cache miss 之后、回源之前，且用 !has 判断。',
        '空值没被缓存：load 里值为 undefined 或 null 时要写 NULL_MARK，并且 nullCached++。',
        'hitRate 被空值污染：NULL_MARK 命中要走 nullHits 分支，不能算进 hits。'
      ],
      vocab: [
        { term: '假阳性', md: '布隆说「可能存在」，但实际不在。概率由位数和哈希个数决定，无法消除，只能压低。' },
        { term: '空值缓存', md: '把「查过了，是空」也缓存一小会儿（TTL 通常几秒到几分钟），挡住重复打库。' }
      ],
      code: L3_STEP2,
      test: L3S2
    },
    {
      n: 3,
      title: '防击穿：让并发请求共享同一次回源',
      think:
        '第三步处理热点 key 过期瞬间的并发。我不写「加锁 + 重试」，而是用 inflight: Map<key, Promise> 把**回源这件事本身**共享出去。想清楚这点之后，剩下的全是细节：promise 要在 load 之前就登记（否则第二个请求看不到），finally 里要清标记（否则失败一次就永久卡死）。这两个细节各写一条检查。',
      hint:
        '构造函数加 this.inflight = new Map() 和 stampedeSaved 计数器。readThrough 里在 miss 计数之前：如果 inflight 里已经有 key，stampedeSaved++ 然后直接 return 那个 Promise；否则 misses++，先 const task = this.load(key)，再 inflight.set(key, task)，最后 try { return await task } finally { if (inflight.get(key) === task) inflight.delete(key) }。',
      diag: [
        '数据库被查了三次：inflight 必须在调用 load 之后、await 之前就 set 进去，后到的请求才看得到。',
        '回源失败后这个 key 一直失败：finally 里要删掉 inflight 标记，而且要用 === task 判断别删掉别人的。',
        '不同 key 互相等：map 的 key 必须是缓存 key，不能用一个全局标记。'
      ],
      vocab: [
        { term: 'single-flight', md: '把并发的同一个请求合并成一次执行，其余调用者共享结果。Go 的 singleflight 包就是这个语义。' },
        { term: '击穿', md: '单个热点 key 失效瞬间，大量请求同时回源。注意和「穿透」区分：击穿的 key 是存在的。' }
      ],
      code: L3_STEP3,
      test: L3S3
    },
    {
      n: 4,
      title: '防雪崩：TTL 加随机抖动',
      think:
        '最后一块最小：把固定 TTL 换成「基础值 + 随机偏移」。这一步只改一处，但它对应的是雪崩里最常见的那个原因——批量预热的 key 过期时刻完全一致。我把 random 做成构造参数，因为不注入的话测试只能写「TTL 在区间内」这种弱断言，注入之后可以精确断言 60 和 87。',
      hint:
        '构造函数加 jitterSeconds = 0 和 random = Math.random。写一个 ttlFor()：jitterSeconds <= 0 时返回 ttlSeconds，否则返回 ttlSeconds + Math.floor(random() * (jitterSeconds + 1))。load 里 cache.set 的第三个参数改成 this.ttlFor()。',
      diag: [
        'TTL 没有抖动：load 里写缓存时传的还要是 this.ttlFor()，别继续用 this.ttlSeconds。',
        '抖动为 0 时 TTL 变了：jitterSeconds <= 0 要直接返回基础值，不能去调 random 再乘 0（会多一次随机调用）。'
      ],
      code: L3_STEP4,
      test: L3S4
    }
  ],
  finalCode: L3_STEP4,
  usage: `const cache = new MemoryCache()
const rows = { 'user:1': 'A' }
const db = {
  async get(k) { return rows[k] },
  async set(k, v) { rows[k] = v }
}

// 布隆：上线时把「库里确实存在的 id」全部灌进去
const bloom = new BloomFilter({ bits: 1024, hashes: 3 })
bloom.add('user:1')

const aside = new CacheAside({
  cache, db, bloom,
  ttlSeconds: 60,      // 基础 TTL
  jitterSeconds: 10,   // 再随机加 0~10 秒，避免同时过期
  nullTtlSeconds: 5    // 空值只缓存 5 秒
})

await aside.readThrough('user:1')     // 回源 + 回填
await aside.readThrough('user:1')     // 命中
await aside.readThrough('user:404')   // 布隆拦掉，一次库都不打

await aside.writeThrough('user:1', 'B')   // 先写库，再删缓存

aside.stats()
// { hits: 1, misses: 1, dbLoads: 1,
//   nullHits: 0, nullCached: 0, penetrationBlocked: 1,
//   stampedeSaved: 0, hitRate: 0.5 }`,
  concepts: [
    {
      title: '通关后复盘：这三个问题的药为什么不能互换',
      md: `穿透、击穿、雪崩的核心区别是「失效的 key 有几个」：

- 穿透是 0 个（key 不存在），所以只能拦、不能重建，布隆 + 空值缓存；
- 击穿是 1 个（热点 key），要控制「重建的并发」，互斥 / 逻辑过期 / 永不过期；
- 雪崩是一大片（同时过期或缓存层整体挂），要打散过期时刻 + 多级缓存 + 限流降级。

把布隆拿去治击穿是无效的（key 存在，布隆一定放行）；把互斥锁拿去治穿透也不对（重建一个不存在的东西）。所以面试里先说「这三种不是一回事」，再逐个给方案，比罗列名词有效得多。`
    }
  ],
  skeleton: `/**
 * 第 3 关 · 缓存三问题：布隆、互斥与抖动
 *
 * 交付：
 *   MemoryCache —— 极简缓存后端（get / set / del / ttl）
 *   BloomFilter —— 防穿透：只有假阳性，没有假阴性
 *   CacheAside  —— 读回填 + 写删缓存 + 单飞互斥 + TTL 抖动
 */
const NULL_MARK = '__LF_NULL__'

class MemoryCache {
  constructor() {
    this.map = new Map()
  }

  get(key) {
    const entry = this.map.get(key)
    return entry === undefined ? undefined : entry.value
  }

  set(key, value, ttlSeconds = null) {
    this.map.set(key, { value, ttl: ttlSeconds })
  }

  del(key) {
    return this.map.delete(key) ? 1 : 0
  }

  has(key) {
    return this.map.has(key)
  }

  ttl(key) {
    const entry = this.map.get(key)
    return entry === undefined ? null : entry.ttl
  }

  keys() {
    return [...this.map.keys()]
  }
}

function hash32(str) {
  // TODO 1：FNV-1a + 混淆，返回 32 位无符号整数
  return 0
}

class BloomFilter {
  constructor({ bits = 64, hashes = 3 } = {}) {
    this.bits = bits
    this.hashes = hashes
    this.data = new Array(bits).fill(0)
  }

  positions(item) {
    // TODO 2：双哈希 h1 + i * h2 取模到 bits
    return []
  }

  add(item) {
    // TODO 3：把 positions 全部置 1
    return this
  }

  has(item) {
    // TODO 4：只要有一位是 0 就返回 false
    return true
  }

  get fill() {
    let n = 0
    for (const b of this.data) if (b) n++
    return n / this.bits
  }
}

class CacheAside {
  constructor({ cache, db, ttlSeconds = 60, nullTtlSeconds = 5, jitterSeconds = 0, random = Math.random, bloom = null } = {}) {
    this.cache = cache
    this.db = db
    this.ttlSeconds = ttlSeconds
    this.nullTtlSeconds = nullTtlSeconds
    this.jitterSeconds = jitterSeconds
    this.random = random
    this.bloom = bloom
    this.inflight = new Map()
    this.counters = { hits: 0, misses: 0, dbLoads: 0, nullHits: 0, nullCached: 0, penetrationBlocked: 0, stampedeSaved: 0 }
  }

  ttlFor() {
    // TODO 5：基础 TTL + [0, jitterSeconds] 的随机偏移
    return this.ttlSeconds
  }

  async readThrough(key) {
    // TODO 6：空值命中 → 布隆拦截 → 单飞 → 回源；每一步都要记计数器
    return undefined
  }

  async load(key) {
    // TODO 7：回源；值为空写 NULL_MARK，否则写值和 ttlFor()
    return undefined
  }

  async writeThrough(key, value) {
    // TODO 8：先 await db.set，再 cache.del
    return value
  }

  stats() {
    const total = this.counters.hits + this.counters.misses
    return { ...this.counters, hitRate: total === 0 ? 0 : this.counters.hits / total }
  }
}
`,
  solution: L3_STEP4,
  tests: [L3S1, L3S2, L3S3, L3S4].join('\n\n')
}
/* ============================================================ 第 4 关测试 */

const L4S1 = `{
  check('CRC16 + 16384 取模，结果和 Redis 的 CLUSTER KEYSLOT 一致', () => {
    same(hashSlot('foo'), 12182)
    same(hashSlot('bar'), 5061)
  })
  check('hash tag 让同一用户的两把 key 落在同一个槽（跨槽操作的前提）', () => {
    same(hashSlot('{user1000}.following'), hashSlot('{user1000}.followers'))
    notSame(hashSlot('user1000.following'), hashSlot('user1000.followers'))
  })
  check('槽号永远落在 0..16383：ASCII 和中文 key 都要在范围内', () => {
    const keys = ['a', 'b', '', 'user:1', 'pool-' + 'x'.repeat(200), '你好', '用户:42']
    for (const k of keys) {
      const s = hashSlot(k)
      ok(Number.isInteger(s) && s >= 0 && s < 16384, k + ' 的槽号越界：' + s)
    }
  })
  check('三个节点分走全部 16384 个槽，一个不重一个不漏', () => {
    const c = new Cluster(['A', 'B', 'C'])
    const counts = { A: 0, B: 0, C: 0 }
    for (let s = 0; s < 16384; s++) counts[c.ownerOf(s)]++
    same(counts.A + counts.B + counts.C, 16384)
    ok(counts.A >= 5460 && counts.B >= 5460 && counts.C >= 5460, '三个节点分到的槽数应该基本均等')
  })
  check('问错节点时返回 MOVED 和真正的属主，客户端据此重定向', () => {
    const c = new Cluster(['A', 'B', 'C'])
    const owner = c.nodeOf('foo')
    const wrong = ['A', 'B', 'C'].filter((n) => n !== owner)[0]
    same(c.route(wrong, 'foo'), { ok: false, kind: 'MOVED', node: owner, slot: 12182 })
    same(c.route(owner, 'foo'), { ok: true, node: owner, slot: 12182 })
  })
  check('写入落到属主节点：别的节点上根本找不到这个 key', () => {
    const c = new Cluster(['A', 'B', 'C'])
    c.set('user:1', 'A')
    const owner = c.nodeOf('user:1')
    same(c.get('user:1'), 'A')
    ok(c.keysOn(owner).indexOf('user:1') >= 0, '属主节点上应该有这个 key')
    for (const n of ['A', 'B', 'C']) {
      if (n === owner) continue
      same(c.keysOn(n).indexOf('user:1'), -1)
    }
  })
}`

const L4S2 = `{
  const key = '{tag1}alpha'
  const otherKey = 'plain-key'
  const c = new Cluster(['A', 'B', 'C'])
  const slot = hashSlot(key)
  const owner = c.nodeOf(key)
  const target = ['A', 'B', 'C'].filter((n) => n !== owner)[0]
  c.set(key, 'v')
  c.set(otherKey, 'other')

  check('开始迁移：源节点对这个槽的请求返回 ASK，指向目标节点', () => {
    same(c.startMigration(slot, target), { from: owner, to: target, slot })
    same(c.route(owner, key), { ok: false, kind: 'ASK', node: target, slot })
  })
  check('迁移是逐个槽的：别的槽完全不受影响', () => {
    const otherSlot = hashSlot(otherKey)
    const otherOwner = c.ownerOf(otherSlot)
    same(c.route(otherOwner, otherKey), { ok: true, node: otherOwner, slot: otherSlot })
  })
  check('migrateKey 把 key 搬到目标节点，源节点上就没有了', () => {
    same(c.migrateKey(key), 1)
    same(c.keysOn(owner).indexOf(key), -1)
    ok(c.keysOn(target).indexOf(key) >= 0, '目标节点上应该出现这个 key')
    same(c.get(key), 'v', '迁移过程中读请求也要能读到')
  })
  check('迁移完成：槽归目标节点，源节点再问就是 MOVED', () => {
    same(c.finishMigration(slot), target)
    same(c.ownerOf(slot), target)
    same(c.route(owner, key), { ok: false, kind: 'MOVED', node: target, slot })
    same(c.route(target, key), { ok: true, node: target, slot })
  })
  check('没在迁移的槽不能搬 key，也不能收尾（别让脏调用改坏拓扑）', () => {
    throws(() => c.migrateKey('some-other-key'))
    throws(() => c.finishMigration(1234))
  })
}`

const L4S3 = `{
  check('acquire 拿到 token 与到期时间，别人再拿就是 null', () => {
    const lock = new DistributedLock(new LockStore())
    const got = lock.acquire('job:42', 'A', 5000, 0)
    ok(got !== null, '第一个请求应该拿到锁')
    same(got.expiresAt, 5000)
    ok(got.token > 0, 'token 是 fencing 的依据，必须是正数')
    same(lock.acquire('job:42', 'B', 5000, 100), null)
    same(lock.ownerOf('job:42', 100), 'A')
  })
  check('锁不可重入：同一个 owner 再来一次也拿不到（SET NX 的语义）', () => {
    const lock = new DistributedLock(new LockStore())
    lock.acquire('k', 'A', 5000, 0)
    same(lock.acquire('k', 'A', 5000, 10), null)
  })
  check('到点之后锁自己失效，不需要别人来删', () => {
    const lock = new DistributedLock(new LockStore())
    lock.acquire('k', 'A', 5000, 0)
    same(lock.ownerOf('k', 4999), 'A')
    same(lock.ownerOf('k', 5000), undefined)
    ok(lock.acquire('k', 'B', 5000, 5000) !== null, '过期之后别人应该能拿到')
  })
  check('释放必须校验持有者，否则会误删别人的锁', () => {
    const lock = new DistributedLock(new LockStore())
    lock.acquire('k', 'A', 5000, 0)
    same(lock.release('k', 'B', 100), false, 'B 不是持有者，删不掉')
    same(lock.ownerOf('k', 100), 'A')
    same(lock.release('k', 'A', 200), true)
    same(lock.ownerOf('k', 200), undefined)
  })
  check('看门狗续期：renew 把剩余时间推回满值，别人还是拿不到', () => {
    const lock = new DistributedLock(new LockStore())
    lock.acquire('k', 'A', 5000, 0)
    same(lock.ttl('k', 3000), 2000)
    same(lock.renew('k', 'A', 5000, 3000), true)
    same(lock.ttl('k', 3000), 5000)
    same(lock.acquire('k', 'B', 5000, 7000), null, '续期之后别人还是拿不到')
    same(lock.renew('k', 'B', 5000, 7000), false, '不是持有者不能续')
  })
  check('释放之后可以重新拿到，而且 fencing token 一定递增', () => {
    const lock = new DistributedLock(new LockStore())
    const first = lock.acquire('k', 'A', 5000, 0)
    same(lock.release('k', 'A', 10), true)
    const second = lock.acquire('k', 'B', 5000, 10)
    ok(second.token > first.token, '后拿到的锁 token 必须更大，下游才能拒绝旧持有者')
  })
}`

const L4S4 = `{
  const deadStore = () => ({
    setNx() { return 0 },
    delIfValue() { return false },
    get() { return undefined }
  })

  check('五个节点里三个可用：凑够多数派，锁成立', () => {
    const live = [new LockStore(), new LockStore(), new LockStore()]
    const nodes = [live[0], live[1], live[2], deadStore(), deadStore()]
    const got = acquireRedlock(nodes, 'job', 'A', 5000, 0)
    same(got.ok, true)
    same(got.votes, 3)
    same(got.quorum, 3)
    same(got.expiresAt, 4950, '有效时间要扣掉时钟漂移的余量')
  })
  check('只有两个可用：锁不成立，已经拿到的那两把必须回滚', () => {
    const live = [new LockStore(), new LockStore()]
    const nodes = [live[0], live[1], deadStore(), deadStore(), deadStore()]
    const got = acquireRedlock(nodes, 'job', 'A', 5000, 0)
    same(got.ok, false)
    same(got.votes, 2)
    same(live[0].get('job', 0), undefined, '没凑够多数派，拿到手的锁要吐出去')
    same(live[1].get('job', 0), undefined)
  })
  check('Redlock 争议检查点：租期过了两个持有者并存，只有 fencing token 能救', () => {
    const store = new LockStore()
    const tokenA = store.setNx('job', 'A', 5000, 0)
    const tokenB = store.setNx('job', 'B', 5000, 5001)
    ok(tokenB > tokenA, 'B 的 token 必须更大')
    same(store.get('job', 5001), 'B')
    same(store.delIfValue('job', 'A', 5001), false, 'A 拿着过期租约来释放，删不掉 B 的锁')
    same(store.get('job', 5001), 'B', 'A 以为自己还持有锁 —— 这就是 Redlock 保证不了的东西')
  })
  check('releaseRedlock 把每个节点上的锁都释放掉', () => {
    const nodes = [new LockStore(), new LockStore(), new LockStore(), new LockStore(), new LockStore()]
    const got = acquireRedlock(nodes, 'job', 'A', 5000, 0)
    same(got.votes, 5)
    same(releaseRedlock(nodes, 'job', 'A', 100), 5)
    for (const s of nodes) same(s.get('job', 100), undefined)
  })
}`

/* ============================================================ 第 4 关代码 */

const SLOT_CODE = `/** Redis Cluster 的槽位总数：2^14，槽位图用位图表示只要 2KB */
const SLOT_COUNT = 16384

/** 把字符串拆成 UTF-8 字节：Redis 的槽号是按字节算的，不是按字符 */
function utf8Bytes(str) {
  const s = String(str)
  const bytes = []
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const next = s.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (next - 0xdc00)
        i++
      }
    }
    if (c < 0x80) bytes.push(c)
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f))
    else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
    else bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
  }
  return bytes
}

/** CRC16-CCITT（XMODEM）：Redis 用的就是这个多项式 0x1021 */
function crc16(str) {
  const bytes = utf8Bytes(str)
  let crc = 0
  for (const b of bytes) {
    crc ^= b << 8
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x8000) ? (((crc << 1) ^ 0x1021) & 0xffff) : ((crc << 1) & 0xffff)
    }
  }
  return crc & 0xffff
}

/**
 * hash tag：只看第一个 { 和它后面的第一个 } 之间的内容。
 * {user1000}.following 和 {user1000}.followers 因此落在一个槽上。
 */
function hashTag(key) {
  const s = String(key)
  const l = s.indexOf('{')
  if (l === -1) return s
  const r = s.indexOf('}', l + 1)
  if (r === -1 || r === l + 1) return s
  return s.slice(l + 1, r)
}

function hashSlot(key) {
  return crc16(hashTag(key)) % SLOT_COUNT
}
`

const CLUSTER_STEP1 = `${SLOT_CODE}
/**
 * 第 4 关 · 第 1 步：槽位分片与 MOVED 重定向
 *
 * 每个节点分走一段连续的槽（真实集群由 CLUSTER ADDSLOTS 手工/工具分配，
 * 这里为了可复现做平均分）。key 落到哪个槽由 CRC16 决定，槽归谁由拓扑决定——
 * 这样「数据分布」和「节点数量」就解耦了。
 */
class Cluster {
  constructor(nodeIds) {
    if (!Array.isArray(nodeIds) || nodeIds.length === 0) throw new Error('至少需要一个节点')
    this.nodes = [...nodeIds]
    this.slots = new Array(SLOT_COUNT).fill(this.nodes[0])
    this.stores = new Map()
    for (const id of this.nodes) this.stores.set(id, new Map())

    const per = Math.ceil(SLOT_COUNT / this.nodes.length)
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      this.slots[slot] = this.nodes[Math.min(Math.floor(slot / per), this.nodes.length - 1)]
    }
  }

  ownerOf(slot) {
    return this.slots[slot]
  }

  nodeOf(key) {
    return this.ownerOf(hashSlot(key))
  }

  set(key, value) {
    const owner = this.nodeOf(key)
    this.stores.get(owner).set(key, value)
    return owner
  }

  get(key) {
    const store = this.stores.get(this.nodeOf(key))
    return store ? store.get(key) : undefined
  }

  keysOn(nodeId) {
    const store = this.stores.get(nodeId)
    return store ? [...store.keys()].sort() : []
  }

  /** 客户端拿这个结果决定要不要重定向 */
  route(fromNode, key) {
    const slot = hashSlot(key)
    const owner = this.ownerOf(slot)
    if (owner === fromNode) return { ok: true, node: owner, slot }
    return { ok: false, kind: 'MOVED', node: owner, slot }
  }
}
`

const CLUSTER_STEP2 = `${SLOT_CODE}
/**
 * 第 4 关 · 第 2 步：槽迁移与 ASK 重定向
 *
 * 迁移一个槽是三步：SETSLOT IMPORTING/MIGRATING → 逐个 MIGRATE key → SETSLOT NODE。
 * 迁移途中，源节点上「这个 key 不在了」要回 ASK，客户端带着 ASKING 去目标节点再问一次；
 * 迁移完成后槽的归属改了，此时回 MOVED（永久改道）。
 */
class Cluster {
  constructor(nodeIds) {
    if (!Array.isArray(nodeIds) || nodeIds.length === 0) throw new Error('至少需要一个节点')
    this.nodes = [...nodeIds]
    this.slots = new Array(SLOT_COUNT).fill(this.nodes[0])
    this.stores = new Map()
    this.migrating = new Map()
    for (const id of this.nodes) this.stores.set(id, new Map())

    const per = Math.ceil(SLOT_COUNT / this.nodes.length)
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      this.slots[slot] = this.nodes[Math.min(Math.floor(slot / per), this.nodes.length - 1)]
    }
  }

  ownerOf(slot) {
    return this.slots[slot]
  }

  nodeOf(key) {
    return this.ownerOf(hashSlot(key))
  }

  set(key, value) {
    const owner = this.nodeOf(key)
    this.stores.get(owner).set(key, value)
    return owner
  }

  get(key) {
    const slot = hashSlot(key)
    const owner = this.ownerOf(slot)
    const store = this.stores.get(owner)
    if (store && store.has(key)) return store.get(key)
    // 迁移途中，key 可能已经在目标节点上了
    const task = this.migrating.get(slot)
    if (task) {
      const target = this.stores.get(task.to)
      if (target && target.has(key)) return target.get(key)
    }
    return undefined
  }

  keysOn(nodeId) {
    const store = this.stores.get(nodeId)
    return store ? [...store.keys()].sort() : []
  }

  /** 标记某个槽开始从当前属主迁到 toNode */
  startMigration(slot, toNode) {
    if (!this.stores.has(toNode)) throw new Error('目标节点不存在：' + toNode)
    const from = this.ownerOf(slot)
    if (from === toNode) throw new Error('这个槽已经在这个节点上了')
    this.migrating.set(slot, { from, to: toNode })
    return { from, to: toNode, slot }
  }

  /** 搬一个 key：返回 1 搬了、0 本来就不在源节点 */
  migrateKey(key) {
    const slot = hashSlot(key)
    const task = this.migrating.get(slot)
    if (!task) throw new Error('这个槽没有正在进行的迁移：' + slot)
    const from = this.stores.get(task.from)
    const to = this.stores.get(task.to)
    if (!from.has(key)) return 0
    to.set(key, from.get(key))
    from.delete(key)
    return 1
  }

  /** 收尾：槽的归属正式改成目标节点 */
  finishMigration(slot) {
    const task = this.migrating.get(slot)
    if (!task) throw new Error('这个槽没有正在进行的迁移：' + slot)
    this.slots[slot] = task.to
    this.migrating.delete(slot)
    return task.to
  }

  route(fromNode, key) {
    const slot = hashSlot(key)
    const owner = this.ownerOf(slot)
    const task = this.migrating.get(slot)
    // 迁移途中：源节点自己都知道该让客户端去目标节点问一次
    if (task && fromNode === task.from) return { ok: false, kind: 'ASK', node: task.to, slot }
    if (owner === fromNode) return { ok: true, node: owner, slot }
    return { ok: false, kind: 'MOVED', node: owner, slot }
  }
}
`

const LOCK_CODE = `/**
 * 模拟 Redis 的锁存储。
 *
 * setNx 一条命令同时做「不存在才写」和「设过期」——真实 Redis 里是
 * SET key owner NX PX 5000。用 setnx + expire 两条命令写的版本，
 * 两条之间宕机就是一把永不过期的死锁。
 */
class LockStore {
  constructor() {
    this.map = new Map()
    this.seq = 0
  }

  peek(key, now) {
    const entry = this.map.get(key)
    if (!entry) return null
    if (entry.expireAt <= now) {
      this.map.delete(key)
      return null
    }
    return entry
  }

  /** 成功返回本次的 fencing token（单调递增），失败返回 0 */
  setNx(key, owner, ttlMs, now) {
    if (this.peek(key, now)) return 0
    this.seq += 1
    this.map.set(key, { value: owner, expireAt: now + ttlMs, token: this.seq })
    return this.seq
  }

  get(key, now) {
    const entry = this.peek(key, now)
    return entry ? entry.value : undefined
  }

  ttl(key, now) {
    const entry = this.peek(key, now)
    return entry ? entry.expireAt - now : -2
  }

  tokenOf(key, now) {
    const entry = this.peek(key, now)
    return entry ? entry.token : 0
  }

  /** 等价于 Lua 的 if redis.call('get',KEYS[1]) == ARGV[1] then del end */
  delIfValue(key, owner, now) {
    const entry = this.peek(key, now)
    if (!entry || entry.value !== owner) return false
    this.map.delete(key)
    return true
  }

  /** 看门狗续期：只有当前持有者能续 */
  touch(key, owner, ttlMs, now) {
    const entry = this.peek(key, now)
    if (!entry || entry.value !== owner) return -1
    entry.expireAt = now + ttlMs
    return entry.token
  }
}

class DistributedLock {
  constructor(store) {
    this.store = store
  }

  /** 返回 { token, expiresAt }，没抢到返回 null */
  acquire(key, owner, ttlMs, now = 0) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('ttlMs 必须是正数：' + ttlMs)
    const token = this.store.setNx(key, owner, ttlMs, now)
    if (!token) return null
    return { token, expiresAt: now + ttlMs }
  }

  /** 看门狗：业务没跑完时由定时任务反复调它把租期续上 */
  renew(key, owner, ttlMs, now = 0) {
    return this.store.touch(key, owner, ttlMs, now) > 0
  }

  release(key, owner, now = 0) {
    return this.store.delIfValue(key, owner, now)
  }

  ownerOf(key, now = 0) {
    return this.store.get(key, now)
  }

  ttl(key, now = 0) {
    return this.store.ttl(key, now)
  }
}
`

const REDLOCK_CODE = `/**
 * Redlock：在 N 个独立主节点上加锁，拿到 (N/2 + 1) 个才算成功。
 *
 * 两个容易漏的点：
 *   1. 没凑够多数派时，已经拿到的锁必须**立刻回滚**，否则别人要等 TTL 才能拿；
 *   2. 有效时间要扣掉时钟漂移的余量，否则「这边算没过期、那边其实已经过期」。
 *
 * 它保证不了什么（Kleppmann 的批评）：持有者一次长 GC 停顿之后，
 * 锁在它自己以为的租期内已经过期，另一个进程拿到了锁——两个持有者并存。
 * 这时只能靠单调递增的 fencing token 让下游拒绝旧持有者的写入。
 */
function acquireRedlock(stores, key, owner, ttlMs, now, opts = {}) {
  const quorum = Math.floor(stores.length / 2) + 1
  const drift = opts.driftMs ?? Math.max(2, Math.floor(ttlMs * 0.01))
  const granted = []
  const tokens = []

  for (const store of stores) {
    const token = store.setNx(key, owner, ttlMs, now)
    if (token) {
      granted.push(store)
      tokens.push(token)
    }
  }

  if (granted.length >= quorum && ttlMs > drift) {
    return { ok: true, votes: granted.length, quorum, tokens, expiresAt: now + ttlMs - drift }
  }

  for (const store of granted) store.delIfValue(key, owner, now)
  return { ok: false, votes: granted.length, quorum, tokens: [], expiresAt: 0 }
}

function releaseRedlock(stores, key, owner, now = 0) {
  let released = 0
  for (const store of stores) {
    if (store.delIfValue(key, owner, now)) released++
  }
  return released
}
`

const L4_STEP1 = CLUSTER_STEP1
const L4_STEP2 = CLUSTER_STEP2
const L4_STEP3 = `${CLUSTER_STEP2}
${LOCK_CODE}`
const L4_STEP4 = `${CLUSTER_STEP2}
${LOCK_CODE}
${REDLOCK_CODE}`

/* ============================================================ 第 4 关 */

const LV4 = {
  id: 'lv4',
  title: '分片与锁：16384 槽、迁移与 SET NX',
  emoji: '🗺️',
  xp: 70,
  goal:
    '实现 CRC16 槽位分片（key → slot → node，支持 hash tag）、槽迁移的 ASK/MOVED 重定向，以及基于 SET NX 的分布式锁（TTL、持有者校验、看门狗续期），最后用 Redlock 多数派 + fencing token 收尾。',
  why:
    '单机 Redis 只有一根 CPU 和一台机器的内存，要扛更多数据只能分片；分片之后马上冒出新问题——跨槽操作做不了、迁移期间请求会打到错的节点。分布式锁是另一条线：setnx + expire 两条命令中间宕机就是死锁，业务跑得比 TTL 久就是两个进程同时写。这一关把「槽位路由」「迁移重定向」「锁的唯一标识与续期」写成可测的代码，顺带把 Redlock 的争议落成一条能跑的检查点。',
  nodes: ['be.redis.cache.distributed-lock', 'be.redis.persist.cluster'],
  thinking: [
    {
      title: '为什么是 16384 个槽，而不是直接上一致性哈希',
      md: `我第一反应是一致性哈希：加节点只影响相邻区间，多优雅。但 Redis Cluster 选了「槽位」这条路，理由很实际：

1. **槽位把「数据分布」和「节点数量」解耦**。key 只跟槽绑定（CRC16 % 16384），槽归谁可以随时改；一致性哈希里 key 直接跟节点绑定，迁移要重算环。
2. **迁移粒度可控**。槽是 16384 个离散单位，可以按槽迁、可以回滚，也能精确说「这个槽还没迁完」——对应 ASK 重定向。一致性哈希的虚拟节点粒度不可控。
3. **广播成本**。16384 个槽的位图只要 2KB，节点之间交换槽位信息很便宜；槽数再多，gossip 消息就变大。

16384 = 2^14 这个数字是权衡：够细（平均值 1000 个 key 一个槽左右），又够小（2KB 位图）。`
    },
    {
      title: '迁移期间为什么必须区分 ASK 和 MOVED',
      md: `两个都是「去问别的节点」，但语义完全不同：

- **MOVED**：这个槽**永久**不在我这了，以后所有关于它的请求都去新节点。
- **ASK**：这个槽正在迁，我这儿这个 key 已经搬走了，**这一次**去目标节点问；但下一个 key 可能还在我这。

如果迁移期间也对客户端回 MOVED，客户端会把整个槽的流量永久改道，可实际上还有一半 key 留在源节点没搬完——那些请求会全部落空。

所以客户端收到 ASK 必须「只这一次改道」，并且要先发 ASKING 命令；收到 MOVED 才更新本地槽位缓存。这也是「迁移期间客户端行为会变复杂」的原因，测试里我让 route 返回 kind 就为了把这两条分开验。`
    },
    {
      title: '释放锁为什么要校验持有者，为什么还要 fencing token',
      md: `SET key owner NX PX 5000 只保证「同一时刻只有一个 owner 拿到锁」，它不保证「持有者只在自己以为的租期内写」。

两个场景会破约：业务跑得比 TTL 久（GC 停顿、慢查询），锁在别人手里已经重新发放；主从切换把锁丢给一个新的主库（异步复制还没同步过去）。

第一层防御是释放时校验：删之前比较 value 是不是自己的，这个比较+删除必须是原子的（Lua 脚本），否则「比完到删之间」锁刚好过期并被别人拿到，你就会删掉别人的锁。

第二层是 fencing token：每次加锁拿一个单调递增的编号，下游（存储、消息队列）记住见过的最大编号，只接受更大的写入。这样即使旧持有者醒来继续写，也会被下游拒绝。**这正是 Kleppmann 对 Redlock 的批评落点：锁本身保证不了互斥，只能靠下游的 token 校验兜底。**`
    }
  ],
  prereq: [
    {
      title: '主从复制与 Sentinel：全量 RDB + 增量 repl_backlog',
      md: `主从复制三步：从库连上来发 PSYNC → 主库 fork 出 RDB 做全量同步 → 之后的写命令通过 repl_backlog（环形缓冲区）增量补发。

复制是**异步**的：主库写完立刻返回，不等从库确认。所以主库宕机时，还没同步过去的那部分写会丢——这也是 Redis 锁在故障切换时可能丢锁的根源。

Sentinel 做的是「监控 + 选主 + 通知」：多个哨兵进程互相监控，主观下线（单个哨兵认为挂了）凑够 quorum 变成客观下线，然后选一个从库提升为主（按优先级、复制偏移量、runid 排序），最后通知客户端新地址。

注意 Sentinel 只解决「主挂了怎么办」，不解决「数据怎么分片」。要分片得用 Cluster。`
    },
    {
      title: 'Redis Cluster：16384 槽、MOVED / ASK、hash tag',
      md: `集群把 key 空间切成 16384 个槽，每个节点负责一段。key 落哪个槽：\`CRC16(key) % 16384\`。

\`\`\`text
CLUSTER KEYSLOT foo   → 12182
CLUSTER KEYSLOT bar   → 5061
\`\`\`

客户端问错节点时，节点回 \`-MOVED 12182 10.0.0.2:6379\`，客户端更新本地槽位缓存再试。槽在迁移时回 \`-ASK\`，只这一次改道（要先发 ASKING）。

跨槽操作（MGET 多个 key、事务、Lua 脚本）会被拒绝，除非多个 key 落在同一个槽——这就是 hash tag 的作用：\`{user1000}.following\` 和 \`{user1000}.followers\` 都只按 \`user1000\` 算槽，于是能一起操作。

另外集群要求至少 3 主 3 从：多数派才能选出新主，少于两个从节点时脑裂风险很高。`
    },
    {
      title: 'SET NX + Lua 释放 + 看门狗 + Redlock 争议',
      md: `\`\`\`bash
SET lock:job {owner} NX PX 5000     # 一条命令同时做「不存在才写」和「设过期」
\`\`\`

为什么不是 \`SETNX\` + \`EXPIRE\` 两条？两条之间进程崩了，锁就没有过期时间，永久死锁。一条命令是原子的。

释放为什么用 Lua？因为「比较 owner」和「删除」必须原子：\`if get(key) == owner then del(key)\`。否则比完的瞬间锁过期被别人拿走，你删掉的是别人的锁。

业务可能跑得比 TTL 久 → **看门狗**：后台每 TTL/3 续一次期（Redisson 的做法），业务结束就停。代价是「进程还活着但卡死」时锁会一直被续，所以看门狗也要有上限。

Redlock：在 N 个**独立**主节点上依次加锁，拿到 (N/2+1) 个且总耗时小于 TTL 才算成功。Kleppmann 的批评是：它依赖各节点的时钟，一次长 GC 停顿就能让两个持有者并存；正确做法是 fencing token + 下游校验。Redis 作者的反驳是「时钟漂移没那么严重」。面试里能说清这两边，比背结论值钱。`
    }
  ],
  api: [
    {
      name: 'Cluster（路由）',
      sig: 'new Cluster(nodeIds) / hashSlot(key) / nodeOf(key) / ownerOf(slot) / set(key, value) / get(key) / keysOn(nodeId) / route(fromNode, key)',
      args:
        'nodeIds 是节点 id 数组（至少一个），槽按 ceil(16384 / n) 平均分配；key 任意字符串，支持 {tag} 语法；fromNode 是「客户端刚才问的那个节点」。',
      returns:
        'hashSlot 返回 0~16383 的整数；nodeOf / ownerOf 返回节点 id；set 返回属主节点 id；get 未命中返回 undefined；keysOn 返回该节点上 key 的有序数组；route 返回 { ok: true, node, slot } 或 { ok: false, kind: \'MOVED\' | \'ASK\', node, slot }。',
      example:
        "const c = new Cluster(['A', 'B', 'C'])\nhashSlot('foo')            // 12182\nc.nodeOf('foo')            // 'C'（槽按 5462 一段平均分给三个节点）\nc.route('A', 'foo')        // { ok: false, kind: 'MOVED', node: 'C', slot: 12182 }\nc.route('C', 'foo')        // { ok: true, node: 'C', slot: 12182 }"
    },
    {
      name: 'Cluster（槽迁移）',
      sig: 'startMigration(slot, toNode) / migrateKey(key) / finishMigration(slot)',
      args:
        'slot 是 0~16383；toNode 必须存在且不是当前属主；migrateKey 的 key 必须落在正在迁移的槽上，否则抛错。',
      returns:
        'startMigration 返回 { from, to, slot }；migrateKey 返回 1（搬了）/ 0（本来就不在源节点）；finishMigration 返回目标节点 id，并把槽的归属改过去。迁移途中 route 对源节点返回 ASK，迁移完成后返回 MOVED。',
      example:
        "const c = new Cluster(['A', 'B', 'C'])\nc.set('{tag1}alpha', 'v')\nconst slot = hashSlot('{tag1}alpha')\nc.startMigration(slot, 'B')      // { from: 'A', to: 'B', slot }\nc.route('A', '{tag1}alpha')     // { ok: false, kind: 'ASK', node: 'B', slot }\nc.migrateKey('{tag1}alpha')     // 1\nc.finishMigration(slot)         // 'B'\nc.route('A', '{tag1}alpha')     // { ok: false, kind: 'MOVED', node: 'B', slot }"
    },
    {
      name: 'DistributedLock',
      sig: 'new DistributedLock(store) / acquire(key, owner, ttlMs, now) / renew(key, owner, ttlMs, now) / release(key, owner, now) / ownerOf(key, now) / ttl(key, now)',
      args:
        'store 是 LockStore（setNx / delIfValue / touch / get / ttl）；owner 是持有者唯一标识（进程 id + 随机串）；ttlMs 必须为正；now 是当前毫秒时刻。',
      returns:
        'acquire 成功返回 { token, expiresAt }，失败返回 null；renew 返回布尔（只有当前持有者能续）；release 返回布尔（只有持有者能删）；ownerOf 返回持有者或 undefined；ttl 返回剩余毫秒或 -2。',
      example:
        "const lock = new DistributedLock(new LockStore())\nconst got = lock.acquire('job:42', 'A', 5000, 0)   // { token: 1, expiresAt: 5000 }\nlock.acquire('job:42', 'B', 5000, 100)             // null\nlock.renew('job:42', 'A', 5000, 3000)              // true（看门狗续期）\nlock.release('job:42', 'B', 3100)                  // false（不是持有者）\nlock.release('job:42', 'A', 3100)                  // true"
    },
    {
      name: 'acquireRedlock / releaseRedlock',
      sig: 'acquireRedlock(stores, key, owner, ttlMs, now, opts?) / releaseRedlock(stores, key, owner, now)',
      args:
        'stores 是 N 个独立节点的存储数组；opts.driftMs 是时钟漂移余量（默认 max(2, ttl * 1%)）。多数派 = floor(N/2) + 1。',
      returns:
        'acquireRedlock 返回 { ok, votes, quorum, tokens, expiresAt }；没凑够多数派时已经拿到的锁会被回滚，ok 为 false。releaseRedlock 返回成功释放的节点数。',
      example:
        "const nodes = [new LockStore(), new LockStore(), new LockStore()]\nconst got = acquireRedlock(nodes, 'job', 'A', 5000, 0)\n// { ok: true, votes: 3, quorum: 2, tokens: [1, 1, 1], expiresAt: 4950 }\nreleaseRedlock(nodes, 'job', 'A', 100)   // 3"
    }
  ],
  stages: [
    {
      n: 1,
      title: 'CRC16 + 槽位：key 怎么变成「归哪个节点」',
      think:
        '第一步只做路由，不做迁移。我特意先写 hashTag：它是「同槽」这件事的唯一手段，也是后面迁移测试能用「一批同槽 key」的前提。CRC16 我按 UTF-8 字节算，因为 Redis 对中文 key 也是按字节求 CRC——用 charCodeAt 直接塞进去，非 ASCII 的 key 会算出错的槽，而这种错在测试里最难发现。',
      hint:
        '先 utf8Bytes(str) 把字符串拆成字节数组（注意代理对要合并成 4 字节），再对字节逐个做 CRC16：crc ^= b << 8，然后 8 轮「最高位是 1 就左移后异或 0x1021」。hashTag 只取第一个 { 和其后第一个 } 之间的内容（空标签或没有 } 就整串算）。hashSlot = crc16(hashTag(key)) % 16384。Cluster 构造时按 ceil(16384 / 节点数) 给每个节点分一段连续槽。route 里先算槽、再看属主是不是 fromNode。',
      diag: [
        'foo 算出来不是 12182：CRC16 的多项式要是 0x1021、初值 0，且按字节（不是按字符）逐位算。',
        'hash tag 没生效：{} 里为空、或者没有闭合的 } 时，要退回整串 key 参与计算。',
        '槽号出现负数或越界：CRC 结果要 & 0xffff 之后再 % 16384，中间别用有符号位移。',
        '三个节点的槽数差很多：per = Math.ceil(16384 / 节点数)，索引用 Math.min(floor(slot / per), 节点数 - 1) 夹紧。',
        'MOVED 里的属主不对：route 要先算 slot 再查 ownerOf(slot)，别拿 fromNode 直接当答案。',
        '写进去之后 keysOn 到处都能看到：set 必须写到 nodeOf(key) 对应的那个 store，不能写到一个全局 Map。'
      ],
      vocab: [
        { term: 'hash tag', md: 'key 里 {…} 之间的内容才是参与槽计算的字符串。用来强制多个 key 落在同一个槽。' },
        { term: 'MOVED', md: '「这个槽永久搬家了」。客户端收到后要更新本地槽位缓存，后续请求直接发新节点。' }
      ],
      code: L4_STEP1,
      test: L4S1
    },
    {
      n: 2,
      title: '槽迁移：ASK 只改道一次，MOVED 才永久改道',
      think:
        '第二步加迁移。这一关最值钱的不是「怎么搬 key」，而是「迁移途中回什么」。我让 route 返回 kind 字段，就是为了让 ASK 和 MOVED 在测试里能被分开断言。另外 get 要做「源节点没有就去目标节点找」的兜底，否则迁移到一半的读会全部读不到——真实集群里客户端靠 ASKING 解决，模拟器里由集群自己兜。',
      hint:
        '构造里加 this.migrating = new Map()。startMigration(slot, toNode)：校验目标存在、不是当前属主，记下 { from, to } 并返回。migrateKey(key)：查这个 key 所属槽的迁移任务，没任务抛错；源节点上没有返回 0；有就搬到目标节点并从源删掉，返回 1。finishMigration(slot)：把 slots[slot] 改成目标节点、删掉迁移标记、返回目标 id。route：先看有没有迁移任务且 fromNode 是源节点 → ASK；再看属主 → ok；否则 MOVED。',
      diag: [
        '迁移中源节点回的是 MOVED：迁移未完成时要回 ASK（kind: ASK），否则客户端会把整槽流量永久改道。',
        '别的槽也被改道了：迁移任务要以「槽号」为 key 存，不能用一个全局标记。',
        'migrateKey 搬完源节点还留着：搬到目标之后要 from.delete(key)。',
        '迁移中 get 读不到：属主节点没有这个 key 时，要去 migrating 里的目标节点找一次。',
        '没在迁移的槽也能搬：migrateKey / finishMigration 里都要先判断有没有迁移任务，没有就抛错。'
      ],
      vocab: [
        { term: 'ASK', md: '「这个 key 暂时不在这儿，去目标节点问一次」。客户端要带 ASKING，且不更新本地槽位缓存。' },
        { term: 'MIGRATE', md: 'Redis 的逐 key 搬迁命令：源节点把 key 序列化后传给目标节点，成功后本地删除。' }
      ],
      code: L4_STEP2,
      test: L4S2
    },
    {
      n: 3,
      title: 'SET NX 锁：TTL、持有者校验与看门狗',
      think:
        '第三步做锁。我把「原子性」压在 LockStore 这一层：setNx 一条调用同时完成「不存在才写」和「设过期」，正是 SET NX PX 的语义——这样上层就不可能写出 setnx + expire 那种两条命令的经典 bug。释放用 delIfValue（等价于 Lua 的 GET+DEL），续期用 touch（只有持有者能续，就是看门狗）。acquire 返回 token，是为第 4 步的争议检查点留的接口。',
      hint:
        'LockStore 用 Map 存 { value, owner 的标识, expireAt, token }，peek(key, now) 负责过期清理；setNx 里 peek 到就返回 0，否则 seq++ 写入并返回 token；delIfValue 先 peek、比对 value 再删；touch 比对 value 后把 expireAt 设成 now + ttlMs；ttl 返回 expireAt - now 或 -2。DistributedLock 只是薄封装：acquire 校验 ttlMs 为正、调 setNx、返回 { token, expiresAt } 或 null。',
      diag: [
        'acquire 的返回值不对：要返回 { token, expiresAt }，不是布尔——token 是第 4 步 fencing 的依据。',
        '同一个 owner 再 acquire 成功了：SET NX 只看 key 存不存在，不看是不是同一个持有者，锁不可重入。',
        '到点之后锁还在：peek 里要判断 expireAt <= now 并清掉，所有读路径都要走 peek。',
        '用别人的 owner 也能删掉锁：delIfValue 要先比对 value，相等才删。',
        'renew 把别人的锁也续了：touch 同样要校验 value，不是持有者返回 -1。',
        '释放之后 token 又从 1 开始：seq 是 store 级别的单调计数，不能每次 acquire 重置。'
      ],
      vocab: [
        { term: 'fencing token', md: '每次加锁拿到的单调递增编号。下游只接受更大编号的写入，用来挡住「租约已过期但还在写」的旧持有者。' },
        { term: '看门狗', md: 'Redisson 的续期机制：后台每 TTL/3 续一次，业务结束后停止。代价是卡死的进程会一直被续期。' }
      ],
      code: L4_STEP3,
      test: L4S3
    },
    {
      n: 4,
      title: 'Redlock：多数派、回滚与那条争议检查点',
      think:
        '最后一步是 Redlock。它代码不长，但有两个必须写对的细节：没凑够多数派要把已经拿到的锁**回滚**（否则别的客户端要白等一个 TTL），以及有效时间要减去漂移余量。至于「争议」，我不写一段散文了事，而是写成一条能跑的检查点：锁过期后两个持有者并存时，只有 token 更大的那个能被下游接受。',
      hint:
        'acquireRedlock(stores, key, owner, ttlMs, now, opts)：quorum = floor(长度 / 2) + 1，drift = max(2, floor(ttlMs * 0.01))；遍历 stores 调 setNx 收集 granted 和 tokens；granted.length >= quorum 且 ttlMs > drift 就返回 ok，expiresAt = now + ttlMs - drift；否则对 granted 逐个 delIfValue 回滚再返回 ok: false。releaseRedlock 遍历 stores 调 delIfValue，数成功次数。',
      diag: [
        '三个可用节点也算失败：quorum 是 floor(N/2) + 1，N=5 时是 3，不是超过一半的「> 2.5」写成整数就行。',
        '失败时锁没回滚：没凑够多数派时要对 granted 里每个节点 delIfValue，否则别人要等 TTL。',
        'expiresAt 没扣漂移：有效时间是 now + ttlMs - drift，drift 至少 2ms。',
        '争议检查点没写对：锁过期后 token 大的才是新持有者，旧持有者的 delIfValue 必须失败。'
      ],
      vocab: [
        { term: 'Redlock', md: 'Redis 作者提出的多节点锁算法：在 N 个独立主节点上加锁，拿到多数派且耗时小于 TTL 才算成功。' },
        { term: '时钟漂移', md: '各节点的本地时钟不可能完全一致。Redlock 靠时间判断租约，因此对漂移敏感——这是它最大的争议点。' }
      ],
      code: L4_STEP4,
      test: L4S4
    }
  ],
  finalCode: L4_STEP4,
  usage: `// 1) 分片：key → 槽 → 节点
const cluster = new Cluster(['A', 'B', 'C'])
hashSlot('foo')                    // 12182
cluster.set('user:1', 'alice')
cluster.nodeOf('user:1')           // 'B'（槽 10778 落在 B）
cluster.route('A', 'user:1')       // { ok: false, kind: 'MOVED', node: 'B', slot: 10778 }

// 2) hash tag：两个 key 强制同槽，才能一起做 MGET / 事务
hashSlot('{u1}.name') === hashSlot('{u1}.email')   // true，都是 4574

// 3) 迁移一个槽（4574 归 A，迁给 B）
cluster.set('{u1}.name', 'alice')
const slot = hashSlot('{u1}.name')
cluster.startMigration(slot, 'B')
cluster.route('A', '{u1}.name')    // { ok: false, kind: 'ASK', node: 'B', slot }
cluster.migrateKey('{u1}.name')    // 1
cluster.finishMigration(slot)      // 'B'
cluster.route('A', '{u1}.name')    // { ok: false, kind: 'MOVED', node: 'B', slot }

// 4) 分布式锁
const lock = new DistributedLock(new LockStore())
const got = lock.acquire('job:42', 'worker-1', 5000, 0)
lock.renew('job:42', 'worker-1', 5000, 3000)   // 看门狗续期
lock.release('job:42', 'worker-1', 4000)       // true

// 5) Redlock + fencing
const nodes = [new LockStore(), new LockStore(), new LockStore()]
const red = acquireRedlock(nodes, 'job:42', 'worker-1', 5000, 0)
red.ok        // true
red.expiresAt // 4950（扣掉 50ms 漂移）

// 锁过期后旧持有者醒来：下游只认更大的 token
const oldToken = red.tokens[0]
const newToken = nodes[0].setNx('job:42', 'worker-2', 5000, 6000)
newToken > oldToken                    // true
nodes[0].delIfValue('job:42', 'worker-1', 6000)   // false：旧持有者删不掉`,
  concepts: [
    {
      title: '通关后复盘：分片解决容量，锁解决互斥，两者都不免费',
      md: `分片把「一台机器装不下」变成「多台机器各装一点」，代价是跨槽操作做不了、迁移期间客户端要处理 ASK/MOVED、多了一整套故障转移的复杂度。所以真实系统的顺序往往是：先垂直扩容 + 读写分离，撑不住了才分片。

分布式锁把「同一时刻只能有一个执行」从单进程扩展到多进程，代价是它依赖租约（TTL）——而租约依赖时钟。凡是依赖时钟的互斥，在「进程暂停 + 时钟漂移」的组合下都会破约，所以工业界的共识是：**锁只用来减少重复劳动，真正的正确性靠下游的幂等和 fencing token**。

把这两句话讲清楚，比会背「16384 个槽」有用得多。`
    }
  ],
  skeleton: `/**
 * 第 4 关 · 分片与锁：16384 槽、迁移与 SET NX
 *
 * 交付四样：
 *   hashSlot / hashTag —— CRC16 分片（含 hash tag）
 *   Cluster            —— 槽位路由、MOVED/ASK 重定向、槽迁移
 *   DistributedLock    —— SET NX 锁、TTL、持有者校验、看门狗续期
 *   acquireRedlock     —— 多节点多数派 + fencing token
 */
const SLOT_COUNT = 16384

function utf8Bytes(str) {
  // TODO 1：把字符串拆成 UTF-8 字节（代理对要合并成 4 字节）
  return []
}

function crc16(str) {
  // TODO 2：对 utf8Bytes 的结果做 CRC16-CCITT（多项式 0x1021，初值 0）
  return 0
}

function hashTag(key) {
  // TODO 3：取第一个 { 与其后第一个 } 之间的内容；空标签或没有闭合就整串算
  return String(key)
}

function hashSlot(key) {
  // TODO 4：crc16(hashTag(key)) % SLOT_COUNT
  return 0
}

class Cluster {
  constructor(nodeIds) {
    this.nodes = [...nodeIds]
    this.slots = new Array(SLOT_COUNT).fill(this.nodes[0])
    this.stores = new Map()
    this.migrating = new Map()
    for (const id of this.nodes) this.stores.set(id, new Map())
    // TODO 5：按 ceil(SLOT_COUNT / 节点数) 给每个节点分一段连续槽
  }

  ownerOf(slot) {
    return this.slots[slot]
  }

  nodeOf(key) {
    return this.ownerOf(hashSlot(key))
  }

  set(key, value) {
    // TODO 6：写到 nodeOf(key) 对应的 store
    return this.nodeOf(key)
  }

  get(key) {
    // TODO 7：先查属主节点，迁移中再查目标节点
    return undefined
  }

  keysOn(nodeId) {
    const store = this.stores.get(nodeId)
    return store ? [...store.keys()].sort() : []
  }

  startMigration(slot, toNode) {
    // TODO 8：校验目标节点、记录 { from, to }
    return { from: this.ownerOf(slot), to: toNode, slot }
  }

  migrateKey(key) {
    // TODO 9：没在迁移就抛错；搬到目标节点并从源删掉
    return 0
  }

  finishMigration(slot) {
    // TODO 10：把槽归属改成目标节点、删掉迁移标记
    return this.ownerOf(slot)
  }

  route(fromNode, key) {
    // TODO 11：迁移中源节点回 ASK；属主就是 fromNode 回 ok；否则回 MOVED
    return { ok: true, node: this.nodeOf(key), slot: hashSlot(key) }
  }
}

class LockStore {
  constructor() {
    this.map = new Map()
    this.seq = 0
  }

  peek(key, now) {
    // TODO 12：拿到记录；过期就删掉并返回 null
    return null
  }

  setNx(key, owner, ttlMs, now) {
    // TODO 13：已存在返回 0；否则 seq++ 写入，返回 token
    return 0
  }

  get(key, now) {
    return undefined
  }

  ttl(key, now) {
    return -2
  }

  delIfValue(key, owner, now) {
    // TODO 14：value 相等才删
    return false
  }

  touch(key, owner, ttlMs, now) {
    // TODO 15：只有持有者能续期
    return -1
  }
}

class DistributedLock {
  constructor(store) {
    this.store = store
  }

  acquire(key, owner, ttlMs, now = 0) {
    // TODO 16：返回 { token, expiresAt } 或 null
    return null
  }

  renew(key, owner, ttlMs, now = 0) {
    return false
  }

  release(key, owner, now = 0) {
    return this.store.delIfValue(key, owner, now)
  }

  ownerOf(key, now = 0) {
    return this.store.get(key, now)
  }

  ttl(key, now = 0) {
    return this.store.ttl(key, now)
  }
}

function acquireRedlock(stores, key, owner, ttlMs, now, opts = {}) {
  // TODO 17：多数派 + 漂移余量；没凑够要把已经拿到的锁回滚
  return { ok: false, votes: 0, quorum: Math.floor(stores.length / 2) + 1, tokens: [], expiresAt: 0 }
}

function releaseRedlock(stores, key, owner, now = 0) {
  return 0
}
`,
  solution: L4_STEP4,
  tests: [L4S1, L4S2, L4S3, L4S4].join('\n\n')
}

export default {
  id: 'redis-cache',
  version: 3,
  domain: 'be',
  cumulative: false,
  title: 'Redis 缓存闯关',
  emoji: '🧊',
  tagline: '4 关 14 步：过期与淘汰、编码与 HLL、缓存三问题、分片与分布式锁。',
  stack: ['JavaScript', 'Redis', '缓存'],
  intro:
    'Redis 的知识点很容易「背过但没写过」：过期是惰性删除还是定时删除、zset 什么时候从 listpack 变成 skiplist、缓存穿透到底该用布隆还是空值、分布式锁为什么必须一条 SET NX EX。这一季把九个知识点全部落成能跑的 JavaScript：每个机制都写成可测试的函数，时间用 now 参数推进、随机用注入的 random，判题跑绿了才算真的懂了。',
  outcome:
    '做完四关，你手上有一套能跑通测试的 Redis 核心模拟器：过期字典 + 抽样淘汰、ZSet 与编码决策、HyperLogLog、Cache Aside 三件套、16384 槽分片与 SET NX 锁。面试里再被问「过期 key 怎么删的」「zset 底层是什么」「缓存击穿怎么防」「Redis 集群为什么是 16384 个槽」，你能直接说清机制、数字和取舍，而不是背结论。',
  levels: [LV1, LV2, LV3, LV4]
}