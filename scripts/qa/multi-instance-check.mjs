// 多开验证：同一台机器同时跑多个 Electron 实例，各自 CDP 端口独立，页面都能拿到数据。
// 用法：node scripts/qa/multi-instance-check.mjs [portA] [portB] …（默认 9222 / 9223）
const ports = process.argv.slice(2).map(Number).filter(Boolean)
const targets = ports.length ? ports : [9222, 9223]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function open(port) {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const page = list.find((t) => t.type === 'page' && /localhost:\d+|index\.html/.test(t.url))
      if (!page) throw new Error('无 renderer target')
      const ws = new WebSocket(page.webSocketDebuggerUrl)
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
      let id = 0
      const pending = new Map()
      ws.onmessage = (ev) => {
        const m = JSON.parse(String(ev.data))
        if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
      }
      const send = (method, params = {}) => new Promise((resolve, reject) => {
        const n = ++id
        pending.set(n, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)))
        ws.send(JSON.stringify({ id: n, method, params }))
      })
      return { port, send, close: () => ws.close(), url: page.url, targetId: page.id }
    } catch { await sleep(500) }
  }
  throw new Error(`连不上 CDP ${port}`)
}

async function ev(c, expr) {
  const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
  return r.result.value
}

const fail = []
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) fail.push(name)
}

/** 切路由并等它生效：hash 有可能被守卫重定向，所以轮询确认而不是 sleep 死等 */
async function goto(c, hash) {
  for (let i = 0; i < 12; i++) {
    await ev(c, `location.hash = ${JSON.stringify(hash)}`)
    await sleep(450)
    const href = await ev(c, 'location.hash')
    if (href === hash) return true
  }
  return (await ev(c, 'location.hash')) === hash
}

const seen = []
for (const port of targets) {
  const c = await open(port)

  const okList = await goto(c, '#/projects')
  await sleep(900)
  const info = await ev(c, `(() => {
    const txt = document.body.innerText
    return { cards: (txt.match(/开始第 1 关|继续第|已全部通关/g) || []).length,
             overflow: document.documentElement.scrollWidth > innerWidth + 2,
             api: !!window.forge,
             hasErr: /加载失败|出错了|Error:/i.test(txt) }
  })()`)
  check(`实例 @${port} 项目列表可渲染（${c.url.replace(/^http:\/\//, '')}）`,
    okList && info.cards >= 4 && !info.hasErr,
    `卡片 ${info.cards} 个 · 无溢出=${!info.overflow} · IPC=${info.api}`)

  // 打开第 1 关：同时验证 IPC 与共用数据库在这个实例里都能正常读
  const okLv = await goto(c, '#/projects/mini-vue-reactivity/lv1')
  await sleep(1400)
  const lv = await ev(c, `(() => { const t = document.body.innerText
    const m = t.match(/第 (\\d+)\\/(\\d+) 关/)
    return { level: m ? m[0] : '', goal: /让读写经过你的代码/.test(t),
             concepts: /Proxy 是/.test(t), editor: !!document.querySelector('.work-pane, textarea') } })()`)
  check(`实例 @${port} 打开第 1 关`, okLv && lv.goal && lv.level === '第 1/9 关',
    `${lv.level || '无级别'} · 前置知识=${lv.concepts} · 编辑器=${lv.editor}`)

  seen.push(c.targetId)
  c.close()
}

check(`共 ${targets.length} 个实例，各自是独立的渲染目标`, new Set(seen).size === targets.length, `targetId ${seen.map((s) => s.slice(0, 8)).join(' / ')}`)

console.log(fail.length ? `\n❌ ${fail.length} 项失败：${fail.join('、')}` : '\n✅ 多开验证全部通过')
process.exit(fail.length ? 1 : 0)