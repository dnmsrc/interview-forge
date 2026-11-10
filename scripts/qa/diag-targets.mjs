// 逐 target 核对：哪个 graph 窗口在跑新代码（unrefV）
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
for (const t of list.filter((x) => x.type === 'page')) {
  const url = decodeURIComponent(t.url || '')
  if (!/graph/.test(url)) { console.log('[skip]', url.slice(-30)); continue }
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let id = 0
  const send = (method, params) => new Promise((res) => {
    const mid = ++id
    const on = (ev) => { const m = JSON.parse(String(ev.data)); if (m.id === mid) { ws.removeEventListener('message', on); res(m.result) } }
    ws.addEventListener('message', on)
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }))
  })
  await send('Runtime.enable')
  const r = await send('Runtime.evaluate', { expression: 'JSON.stringify({ hasVf: typeof window.__vf !== "undefined", fitdbg: window.__fitdbg ? { pane: window.__fitdbg.pane, waited: window.__fitdbg.waited, n: window.__fitdbg.n } : null })', returnByValue: true })
  console.log('[graph target]', t.id?.slice(0, 10), r.result?.value)
  ws.close()
}
process.exit(0)
