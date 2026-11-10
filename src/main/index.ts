import { app, BrowserWindow, Menu, shell } from 'electron'
import { join, dirname } from 'node:path'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { initDatabase, resolveDataDir, settingGet, seedStats } from './db'
import { registerIpc } from './ipc'

// 用本地常量持有路径：打包器做 tree-shaking 时可能认为「给 process.env 赋值」无副作用而挪动/丢弃语句，
// 后面再读 process.env 就会拿到 undefined。本地常量能保证求值顺序。
const PROJECT_ROOT = process.env.FORGE_ROOT || join(__dirname, '..', '..')
process.env.FORGE_ROOT = PROJECT_ROOT
const DATA_DIR = process.env.FORGE_DATA_DIR || (app.isPackaged ? join(app.getPath('userData'), 'forge-data') : join(PROJECT_ROOT, 'data'))
process.env.FORGE_DATA_DIR = DATA_DIR
// 便携模式：Electron 自身的 userData（Chromium 缓存、localStorage、单实例锁）也放进项目内，
// 既不污染系统 AppData，也让「content + data」两目录即为全部状态，拷走就是完整备份。
if (!app.isPackaged) app.setPath('userData', join(PROJECT_ROOT, 'data', 'electron-userData'))

/**
 * 启动日志同时落到 data/boot.log —— Windows 下 electron.exe 是 GUI 子系统程序，
 * 从终端 spawn 时 stdout 往往拿不到，落盘是唯一可靠的排障手段（菜单里没有控制台时也一样）。
 */
const LOG_FILE = join(PROJECT_ROOT, 'forge-boot.log')
export function bootLog(msg: string) {
  const line = `${new Date().toISOString()} ${msg}`
  console.log(msg)
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true })
    appendFileSync(LOG_FILE, line + '\n')
  } catch (e: any) {
    try { appendFileSync(join(process.env.TEMP || 'C:/Windows/Temp', 'forge-boot.log'), line + ' ERR ' + String(e?.message ?? e) + '\n') } catch { /* 无处可写 */ }
  }
}
bootLog(`bundle loaded root=${PROJECT_ROOT} data=${DATA_DIR} packaged=${app.isPackaged} electron=${process.versions.electron}`)
process.on('uncaughtException', (e) => bootLog(`uncaughtException: ${String(e?.stack || e)}`))
process.on('unhandledRejection', (r) => bootLog(`unhandledRejection: ${String((r as any)?.stack || r)}`))

// node:sqlite 目前会打实验警告，桌面应用里没必要展示
process.removeAllListeners('warning' as any)
process.on('warning', (w) => { if (w.name !== 'ExperimentalWarning') bootLog(`[warn] ${w.message}`) })

/**
 * 兼容性开关（必须在 app ready 之前设置）：
 * - Chromium 的进程沙箱在受限环境（agent 终端、部分沙箱化 shell、某些企业策略机）里会 CHECK 失败，
 *   表现为进程直接以 EXCEPTION_BREAKPOINT 退出（我们已在 webPreferences 里关掉渲染进程沙箱，安全损失有限）。
 * - 远程桌面 / 无独立显卡的机器上，硬件加速会导致白屏或启动失败。
 * 想恢复：设 FORGE_NO_SANDBOX=0 或 FORGE_GPU=1。
 */
if (process.env.FORGE_NO_SANDBOX !== '0') app.commandLine.appendSwitch('no-sandbox')
if (process.env.FORGE_GPU !== '1') app.disableHardwareAcceleration()

let win: BrowserWindow | null = null
let qaWin: BrowserWindow | null = null

function createWindow() {
  win = new BrowserWindow({
    width: 1460,
    height: 920,
    minWidth: 980,
    minHeight: 640,
    title: '面试熔炉 interview-forge',
    backgroundColor: '#f7f8fa',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })
  win.on('ready-to-show', () => win?.show())
  // 外链一律走系统浏览器；window.open（无特征串，QA 测试窗口用的就是这种）开应用内新窗口，
  // 带 features 的 popup（width=... 等）维持旧行为交系统浏览器处理
  win.webContents.setWindowOpenHandler(({ url, disposition }) => {
    if (disposition === 'new-window') return { action: 'allow' }
    shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('did-fail-load', (_e, code, desc, url) => bootLog(`did-fail-load ${code} ${desc} ${url}`))
  win.webContents.on('render-process-gone', (_e, d) => bootLog(`render-process-gone ${JSON.stringify(d)}`))
  win.on('closed', () => { win = null })

  if (process.env['ELECTRON_RENDERER_URL']) {
    bootLog(`loadURL ${process.env['ELECTRON_RENDERER_URL']}`)
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    bootLog(`loadFile ${join(__dirname, '../renderer/index.html')}`)
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // FORGE_QA=1：起一个隐藏的后台测试窗口（独立 page target）。QA 脚本对它做导航/视口 override，
  // 绝不干扰用户正在使用的主窗口（比如正在进行的闭卷考试）。不抢焦点、不参与单实例逻辑。
  if (process.env.FORGE_QA === '1') {
    const qa = new BrowserWindow({
      width: 1440, height: 880, show: false, backgroundColor: '#f7f8fa', webPreferences: {
        preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: false
      }
    })
    const url = process.env['ELECTRON_RENDERER_URL']
    // ?qa=1 是给 QA 脚本认的靶子：CDP target 列表里靠它精确锁定后台窗，不会误操作用户主窗
    if (url) void qa.loadURL(url.replace(/\/+$/, '') + '/?qa=1#/graph')
    else void qa.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/graph', query: { qa: '1' } })
    qa.on('ready-to-show', () => qa.showInactive())   // 任务栏可见便于肉眼旁观；不抢主窗焦点
    qa.on('closed', () => { qaWin = null })
    qaWin = qa
    bootLog('FORGE_QA 后台测试窗口已创建 (#/graph)')
  }
}

function buildMenu() {
  const isMac = process.platform === 'darwin'
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: '应用',
      submenu: [
        { label: '刷新界面', accelerator: 'CmdOrCtrl+R', click: () => win?.webContents.reloadIgnoringCache() },
        { label: '开发者工具', accelerator: 'CmdOrCtrl+Alt+I', click: () => win?.webContents.toggleDevTools() },
        { type: 'separator' },
        isMac ? { role: 'close', label: '关闭窗口' } : { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '数据',
      submenu: [
        { label: '打开数据库所在目录', click: () => shell.openPath(resolveDataDir()) },
        { label: '打开题库目录', click: () => shell.openPath(join(PROJECT_ROOT, 'content')) },
        { label: '打开快照目录', click: () => shell.openPath(join(PROJECT_ROOT, 'snapshots')) },
        { label: '打开启动日志', click: () => shell.openPath(join(DATA_DIR, 'boot.log')) }
      ]
    },
    { label: '视图', submenu: [{ role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }, { type: 'separator' }, { role: 'togglefullscreen', label: '全屏' }] }
  ]))
}

/** 每周自动扩充（默认关；开启后距上次更新超 7 天且在用的端点可用时静默跑） */
async function maybeAutoUpdate() {
  if (!settingGet<boolean>('bank.autoWeekUpdate')) return
  try {
    const { get } = await import('./db')
    const last = get?.<{ created_at: string }>(`SELECT created_at FROM bank_versions WHERE kind='update' ORDER BY created_at DESC LIMIT 1`)?.created_at
    if (last && Date.now() - new Date(last.replace(' ', 'T')).getTime() < 7 * 86400000) return
    const bank = await import('./services/bank')
    const r = await bank.updateBank({ maxNodes: 6, note: '每周自动扩充' })
    bootLog(`[auto-update] ${JSON.stringify(r).slice(0, 300)}`)
  } catch (e: any) {
    bootLog(`[auto-update] 跳过：${String(e?.message ?? e).slice(0, 160)}`)
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  bootLog('已有实例在运行（单实例锁），本进程退出')
  app.quit()
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus() } })
  app.on('child-process-gone', (_e, d) => bootLog(`child-process-gone ${JSON.stringify(d)}`))
  void app.whenReady().then(() => {
    bootLog(`ready electron=${process.versions.electron} node=${process.versions.node} chrome=${process.versions.chrome} data=${process.env.FORGE_DATA_DIR}`)
    try {
      initDatabase()
    } catch (e: any) {
      bootLog(`[db] 初始化失败：${String(e?.stack || e)}`)
    }
    if (seedStats?.error) bootLog(`[db] 题库导入报错：${seedStats.error}`)
    else if (seedStats) bootLog(`[db] 导入 节点${seedStats.nodes} 题目${seedStats.questions} 变体${seedStats.variants}`)
    try {
      registerIpc()
      buildMenu()
      createWindow()
    } catch (e: any) {
      bootLog(`[ui] 启动失败：${String(e?.stack || e)}`)
    }
    // FORGE_SELFSHOT=1：加载完成后拍一张窗口图存到 data/selfshot.png，用于无头排障与交付验证
    if (process.env.FORGE_SELFSHOT) {
      win?.webContents.once('did-finish-load', () => {
        setTimeout(async () => {
          try {
            const img = await win?.webContents.capturePage()
            if (img) { writeFileSync(join(DATA_DIR, 'selfshot.png'), img.toPNG()); bootLog(`selfshot -> ${join(DATA_DIR, 'selfshot.png')}`) }
            else bootLog('selfshot：capturePage 返回空')
          } catch (e: any) { bootLog(`selfshot 失败：${String(e?.message ?? e)}`) }
          app.exit(0)
        }, 3000)
      })
    }
    void maybeAutoUpdate()
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  }).catch((e) => bootLog(`whenReady 失败：${String(e?.stack || e)}`))
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}
