// 极简 CDP（Chrome DevTools Protocol）客户端：驱动 Electron 渲染端做 UI 自动化测试
// Node ≥22：全局 fetch / WebSocket，零依赖。
import fs from 'node:fs'
import path from 'node:path'

const DEBUG_PORT = process.env.QA_PORT || '9222'

export class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.handlers = new Map() // method -> [fn]
    this.consoleErrors = []
    ws.onmessage = (ev) => {
      let msg
      try { msg = JSON.parse(String(ev.data)) } catch { return }
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        msg.error ? p.reject(new Error(`${msg.method}: ${JSON.stringify(msg.error)}`)) : p.resolve(msg.result)
        return
      }
      if (msg.method) {
        for (const fn of this.handlers.get(msg.method) || []) { try { fn(msg.params) } catch { /* 观察者不干扰 */ } }
        for (const fn of this.handlers.get('*') || []) { try { fn(msg) } catch { /* noop */ } }
      }
    }
    ws.onerror = () => { /* close 会带 code，统一在 onclose 处理 */ }
  }

  static async connect(retries = 15) {
    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
        const list = await res.json()
        // 渲染端 dev server 端口可能因 5173 被占用而顺延（5174/5175…），按 localhost 任意端口匹配
        const page = list.find((t) => t.type === 'page' && /localhost:\d+|index\.html/.test(t.url))
        if (!page?.webSocketDebuggerUrl) throw new Error('没有 renderer page target')
        const cdp = await new Promise((resolve, reject) => {
          const ws = new WebSocket(page.webSocketDebuggerUrl)
          const timer = setTimeout(() => { try { ws.close() } catch { /* noop */ }; reject(new Error('WS 握手超时')) }, 8000).unref?.()
          ws.onopen = () => { clearTimeout(timer); resolve(new Cdp(ws)) }
          ws.onclose = (c) => { clearTimeout(timer); reject(new Error(`WS 关闭 code=${c.code} reason=${c.reason || '(空)'}`)) }
          ws.onerror = () => { clearTimeout(timer); reject(new Error('WS error')) }
        })
        await cdp.init()
        await cdp.ensureVisible()
        /**
         * 把窗口带到前台再开始点击。
         *
         * 窗口被别的窗口压住（或最小化后恢复）时，CDP 注入的鼠标事件会静默失效：
         * Input.dispatchMouseEvent 不报错、elementFromPoint 也正确，但 Vue 的 @click 不触发。
         * 表现是「点了没反应」，QA 里就变成「等结果面板超时」。
         */
        try { await cdp.cmd('Page.bringToFront') } catch { /* 老版本 Electron 不支持就算了 */ }
        return cdp
      } catch (e) {
        if (i === retries - 1) throw e
        await sleep(1200)
      }
    }
    throw new Error(`连不上 CDP 端口 ${DEBUG_PORT}`)
  }

  async init() {
    await this.cmd('Runtime.enable')
    await this.cmd('Page.enable')
    await this.cmd('Log.enable').catch(() => {})
    this.on('Runtime.exceptionThrown', (p) => {
      const d = p.exceptionDetails
      this.consoleErrors.push({ kind: 'exception', text: String(d?.exception?.description || d?.text || '').slice(0, 400), source: d?.url })
    })
    this.on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error' || p.type === 'warning') {
        const txt = (p.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 300)
        this.consoleErrors.push({ kind: 'console.' + p.type, text: txt })
      }
    })
    this.on('Log.entryAdded', (p) => {
      const e = p.entry
      if (e.level === 'error') this.consoleErrors.push({ kind: 'log.' + e.source, text: String(e.text).slice(0, 300), source: e.url })
    })
  }

  /** 恢复窗口到 normal 态：最小化会让 captureScreenshot 挂起 */
  async ensureVisible() {
    try {
      const { windowId } = await this.cmd('Browser.getWindowForTarget')
      await this.cmd('Browser.setWindowBounds', { windowId, bounds: { state: 'normal' } })
    } catch { /* 不支持就算了 */ }
  }

  cmd(method, params = {}, timeoutMs = 20000) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`${method} 超时 ${timeoutMs}ms`)) }
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v) },
        reject: (e) => { clearTimeout(timer); reject(e) }
      })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, [])
    this.handlers.get(method).push(fn)
  }

  /** 执行表达式（自动包 async IIFE），返回可序列化结果 */
  async evaluate(fnBody, { awaitPromise = true, timeoutMs = 20000 } = {}) {
    const expression = `(async () => { ${fnBody} })()`
    const r = await this.cmd('Runtime.evaluate', { expression, awaitPromise, returnByValue: true }, timeoutMs)
    if (r.exceptionDetails) {
      const d = r.exceptionDetails
      throw new Error('EVAL 异常: ' + String(d.exception?.description || d.text).slice(0, 500))
    }
    return r.result?.value
  }

  /** 轮询等待条件为真 */
  async waitFor(fnBody, timeout = 12000, label = 'condition') {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      let v
      try { v = await this.evaluate(`return (${fnBody});`, { timeoutMs: 5000 }) } catch { v = false }
      if (v) return true
      await sleep(400)
    }
    throw new Error(`waitFor 超时(${timeout}ms): ${label}`)
  }

  /** 截图存 PNG */
  async shot(file) {
    const r = await this.cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 25000)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'))
    return file
  }

  /** 覆盖设备视口（测自适应；影响布局与截图尺寸） */
  async metrics(width, height, dpr = 1) {
    await this.cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: false })
  }
  async clearMetrics() { await this.cmd('Emulation.clearDeviceMetricsOverride').catch(() => {}) }

  /**
   * 硬刷新（忽略 HTTP 缓存）。
   * ⚠️ location.reload() 在 Electron 里可能复用已缓存的懒加载 chunk：
   *    给某个 view 加了 data-testid / 改了模板后，普通刷新仍跑旧代码，
   *    表现为「磁盘上有 testid、dev server 输出也有、DOM 里没有」。
   */
  async reloadHard(waitMs = 2600) {
    await this.cmd('Page.reload', { ignoreCache: true })
    await sleep(waitMs)
  }

  /** 真实鼠标点击：按可见文本找元素，滚入视野后派发 trusted 事件序列 */
  async clickText(text, opts = {}) {
    // 窗口在后台时注入的鼠标事件会被静默丢弃（不报错、不触发 @click）——点之前先抬到前台
    try { await this.cmd('Page.bringToFront') } catch { /* 不支持就照常点 */ }
    const rect = await this.evaluate(`
      const sels = 'button,.n-button,a,.opt,label,.nav a,.vf-node,.pill,th,.q-item,.answer-cell,summary,[role="switch"],[role="option"],.n-base-select-option,.n-tree-node,.n-drawer .n-button';
      const els = [...document.querySelectorAll(sels)];
      const t = ${JSON.stringify(text)};
      const vis = els.filter(e => {
        const st = getComputedStyle(e);
        if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) < 0.05) return false;
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (e.textContent || '').trim().includes(t);
      });
      if (!vis.length) return null;
      const el = vis[${opts.nth || 0}] || vis[0];
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), tag: el.tagName, txt: el.textContent.trim().slice(0, 50) };
    `)
    if (!rect) throw new Error(`找不到可见元素包含文本「${text}」`)
    await this.mouse(rect.x, rect.y)
    return rect
  }

  /** 坐标点击（用于 naive-ui 弹层等无法按文本定位的场景前，先取坐标再点） */
  async clickSel(selector, nth = 0) {
    const rect = await this.evaluate(`
      const els = [...document.querySelectorAll(${JSON.stringify(selector)})].filter(e => e.getBoundingClientRect().width > 0);
      const el = els[${nth}];
      if (!el) return null;
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    `)
    if (!rect) throw new Error(`找不到可见元素 ${selector}[${nth}]`)
    await this.mouse(rect.x, rect.y)
    return rect
  }

  async mouse(x, y) {
    await this.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await this.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 })
    await sleep(60)
    await this.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0 })
  }

  /** 键盘按键（如 Enter） */
  async key(key, code, keyCode) {
    const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode }
    await this.cmd('Input.dispatchKeyEvent', { type: 'keyDown', ...base })
    await this.cmd('Input.dispatchKeyEvent', { type: 'char', ...base, text: key })
    await this.cmd('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  }

  /** 输入框写值（naive-ui 受控组件需要 input 事件） */
  async fill(selector, value) {
    const okv = await this.evaluate(`
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'no-el';
      el.focus();
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    `)
    if (okv !== 'ok') throw new Error(`fill 失败 ${selector}: ${okv}`)
  }

  /** hash 路由导航 */
  async nav(hash) {
    await this.evaluate(`location.hash = ${JSON.stringify('#' + hash)}; return 1;`)
    await sleep(900)
  }

  clearErrors() { this.consoleErrors = [] }
  errors() { return [...this.consoleErrors] }
  async close() { try { this.ws.close() } catch { /* noop */ } }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 页面内样式机检：横向溢出 / 右侧裁切 / 文字截断 / 零尺寸 / 深色残留 */
export const AUDIT_JS = `
  const vw = innerWidth, vh = innerHeight;
  const out = { hOverflow: null, clippedRight: [], textCut: [], zeroBox: [], badContrast: [], viewport: vw + 'x' + vh };
  if (document.documentElement.scrollWidth > vw + 2)
    out.hOverflow = 'scrollWidth=' + document.documentElement.scrollWidth + ' vw=' + vw;
  const isVisible = (el) => {
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) < 0.05) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  for (const el of document.querySelectorAll('button,input,select,textarea,a,.card,.stat,.pill,h2,h3,.nav a,pre,table,.big,.timer,.vf-node,.drawer,.legend,.kv,.row>*')) {
    if (!isVisible(el)) continue;
    const st = getComputedStyle(el);
    if (st.position === 'fixed' || st.position === 'absolute') continue;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 || r.left < -1)
      out.clippedRight.push({ tag: el.tagName, cls: String(el.className).slice(0, 36), txt: (el.textContent||'').trim().slice(0, 28), right: Math.round(r.right), left: Math.round(r.left) });
  }
  for (const el of document.querySelectorAll('span,b,h2,h3,h4,button,th,td,label,.tiny,.muted')) {
    if (!isVisible(el)) continue;
    const txt = (el.textContent||'').trim();
    if (!txt || txt.length > 120) continue;
    if (el.scrollWidth > el.clientWidth + 4 && el.clientWidth > 0) {
      const st = getComputedStyle(el);
      if (!(st.overflow === 'hidden' && st.textOverflow === 'ellipsis'))
        out.textCut.push({ tag: el.tagName, cls: String(el.className).slice(0, 30), txt: txt.slice(0, 30), sw: el.scrollWidth, cw: el.clientWidth });
    }
  }
  for (const el of document.querySelectorAll('.card,.stat,button,.pill')) {
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    if ((el.textContent||'').trim() && (r.width < 4 || r.height < 4))
      out.zeroBox.push({ tag: el.tagName, cls: String(el.className).slice(0, 30), txt: (el.textContent||'').trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) });
  }
  // 方向性判定：浅色主题下出现深色底 = 深色泄漏；深色主题下出现浅色底 = 浅色泄漏
  const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  for (const el of document.querySelectorAll('body,.shell,.side,.topbar,.main,.page,.card,.pre')) {
    const bg = getComputedStyle(el).backgroundColor;
    const m = bg.match(/rgba?\\((\\d+), *(\\d+), *(\\d+)(?: *, *([\\d.]+))?/);
    if (!m) continue;
    const alpha = m[4] === undefined ? 1 : parseFloat(m[4]);
    if (alpha <= 0.05) continue;
    const R = +m[1], G = +m[2], B = +m[3];
    const darkLeak = R < 40 && G < 40 && B < 50;
    const lightLeak = R > 235 && G > 235 && B > 235;
    if (theme === 'dark' ? lightLeak : darkLeak)
      out.badContrast.push({ sel: String(el.className || el.tagName).slice(0, 30), bg, kind: theme === 'dark' ? 'lightLeak' : 'darkLeak' });
  }
  return out;
`
