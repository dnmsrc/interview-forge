<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useForgeStore } from '../store'
import type { EndpointConfig, TutorStatus, TutorCatalog, InferMode } from '@shared/types'
import EndpointRow from '../components/EndpointRow.vue'
import Icon from '../components/Icon.vue'
import { useNaiveTheme } from '../lib/theme'
import { toast, dialog } from '../lib/ui'
import { ipc } from '../lib/ipc'

const store = useForgeStore()
/* 外观能力全部来自 lib/theme.ts：themeMode / isDark / set(mode) / cycle()，
   它内部已持久化到 localStorage('forge.ui.theme') 并同步 html[data-theme]，这里不重写 */
const { themeMode, isDark, set: setTheme, cycle: cycleTheme } = useNaiveTheme()
const eps = ref<EndpointConfig[]>([])
const routing = ref<{ fastEndpointId: string | null; strongEndpointId: string | null; tutorEndpointId: string | null }>({ fastEndpointId: null, strongEndpointId: null, tutorEndpointId: null })
const learning = ref({ desiredRetention: 0.9, globalMixRatio: 0.35, dailyTarget: 20, strictTiming: true, autoWeekUpdate: false, reminderOnLaunch: true })
const testing = ref('')
const usage = ref<any>({})
const byTask = ref<any[]>([])
const errs = ref<any[]>([])

// pinia store 的 ref 在模板里会被再解包一层，这里摊平成普通 computed，避免类型噪音
const paths = computed(() => store.paths)
const runtime = computed(() => store.runtime)
const health = computed(() => store.aiHealth)
const endpointOptions = computed(() => eps.value.map((e) => ({ value: e.id, label: e.label })))
const testAll = () => { void store.testAllEndpoints() }
const window_open = (p?: string) => { if (p) void ipc.app.reveal(p) }

/* ---- 内置答疑小模型：状态轮询 + 推理模式 + 模型/运行时清单 ---- */
const tutor = ref<TutorStatus | null>(null)
const catalog = ref<TutorCatalog | null>(null)
const tutorLogs = ref<string[]>([])
const tutorBusy = ref('')
let tutorTimer: ReturnType<typeof setInterval> | null = null
const tutorReady = computed(() => tutor.value?.state === 'ready')
/** 三档推理模式；auto 由主进程按真实显存判定，不让用户猜 */
const inferModes: { id: InferMode; label: string }[] = [
  { id: 'auto', label: '自动（按显存判定）' },
  { id: 'gpu', label: '强制 GPU' },
  { id: 'cpu', label: '强制 CPU' }
]
/** 实际后端：GPU 时带层数，让「到底跑在卡上还是 CPU 上」一眼可见 */
const inferBackendText = computed(() => {
  const s = tutor.value
  if (!s) return '—'
  return s.backend === 'cpu' ? 'CPU（零显存）' : `${s.backend.toUpperCase()}（${s.gpuLayers} 层上卡）`
})
const gpuText = computed(() => {
  const g = tutor.value?.gpu
  return g ? `${g.name} · 空闲 ${g.freeMb} MB / 总 ${g.totalMb} MB` : '未检测到 NVIDIA 显卡'
})
const tutorStateText = computed(() => {
  const s = tutor.value
  if (!s) return '状态未知'
  if (!s.modelExists) return '模型未下载'
  if (!s.binExists) return '运行时缺失'
  return ({ idle: '已卸载 · 用时自动加载', starting: '正在加载…', ready: '就绪', error: '异常' } as Record<string, string>)[s.state] ?? s.state
})
const tutorIdleText = computed(() => {
  const ms = tutor.value?.idleLeftMs
  if (typeof ms !== 'number') return ''
  const m = Math.ceil(ms / 60000)
  return m > 0 ? `${m} 分钟后自动卸载` : '即将自动卸载'
})
const tutorForced = computed(() => !!routing.value.tutorEndpointId)
async function refreshTutor() {
  try { tutor.value = await ipc.ai.tutorStatus() } catch { /* 旧主进程没有该通道时静默 */ }
  try { catalog.value = await ipc.ai.tutorCatalog() } catch { catalog.value = null }
}
async function setInferMode(mode: InferMode) {
  tutorBusy.value = 'mode'
  try {
    tutor.value = await ipc.ai.tutorSetMode(mode)
    await refreshTutor()
    toast.ok(`推理模式已切换为「${inferModes.find((m) => m.id === mode)?.label ?? mode}」，下次加载时生效`)
  } catch (e: any) { toast.err(String(e?.message ?? e)) } finally { tutorBusy.value = '' }
}
async function setModel(id: string) {
  tutorBusy.value = 'model'
  try {
    tutor.value = await ipc.ai.tutorSetModel(id)
    await refreshTutor()
    toast.ok('模型已切换，下次加载时生效')
  } catch (e: any) { toast.err(String(e?.message ?? e)) } finally { tutorBusy.value = '' }
}
async function startTutor() {
  tutorBusy.value = 'start'
  try {
    const r = await ipc.ai.tutorStart()
    if (r.ok) toast.ok(r.message); else toast.err(r.message)
  } catch (e: any) { toast.err(String(e?.message ?? e)) } finally { tutorBusy.value = ''; await refreshTutor() }
}
async function stopTutor() {
  tutorBusy.value = 'stop'
  try { await ipc.ai.tutorStop(); toast.ok('已卸载，内存已归还') } catch (e: any) { toast.err(String(e?.message ?? e)) } finally { tutorBusy.value = ''; await refreshTutor() }
}
async function loadTutorLog() {
  try { tutorLogs.value = await ipc.ai.tutorLog(30) } catch { tutorLogs.value = [] }
}

/* ---- 纯展示 computed（外观节 + 端点路由概览）---- */
const THEME_MODES = [
  { m: 'light' as const, l: '浅色', i: 'sun' },
  { m: 'dark' as const, l: '深色', i: 'moon' },
  { m: 'auto' as const, l: '跟随系统', i: 'auto' }
]
const activeThemeLabel = computed(() => (isDark.value ? '深色' : '浅色'))
const themeHint = computed(() => {
  const m = themeMode.value
  if (m === 'auto') return `跟随系统：当前系统偏好 ${activeThemeLabel.value}，界面已按${activeThemeLabel.value}渲染。`
  return `已锁定${activeThemeLabel.value}（偏好写在本地 localStorage，换设备不影响你的题库数据）。`
})
const enabledEps = computed(() => eps.value.filter((e) => e.enabled !== false))
const pickById = (id: string | null) => eps.value.find((e) => e.id === id)?.label ?? ''
const fastResolvedName = computed(() => pickById(routing.value.fastEndpointId) || enabledEps.value.find((e) => e.role === 'fast')?.label || enabledEps.value[0]?.label || '未配置')
const strongResolvedName = computed(() => pickById(routing.value.strongEndpointId) || enabledEps.value.find((e) => e.role === 'strong')?.label || enabledEps.value[0]?.label || '未配置')
const fastForced = computed(() => !!routing.value.fastEndpointId)
const strongForced = computed(() => !!routing.value.strongEndpointId)
const tutorResolvedName = computed(() => pickById(routing.value.tutorEndpointId) || enabledEps.value.find((e) => e.role === 'tutor')?.label || enabledEps.value.find((e) => e.role === 'fast')?.label || '未配置')

async function boot() {
  await store.boot()
  const s = store.settings!
  eps.value = JSON.parse(JSON.stringify(s.endpoints))
  // 老库的 ai.routing 里没有 tutorEndpointId，补一个 null（null = 按 role 自动挑，即走内置本地模型）
  routing.value = { ...s.routing, tutorEndpointId: (s.routing as any).tutorEndpointId ?? null }
  learning.value = {
    desiredRetention: s.desiredRetention, globalMixRatio: s.globalMixRatio, dailyTarget: s.dailyTarget,
    strictTiming: s.strictTiming, autoWeekUpdate: s.autoWeekUpdate, reminderOnLaunch: s.reminderOnLaunch
  }
}
async function saveEndpoints() {
  await ipc.ai.saveEndpoints(eps.value)
  await ipc.settings.set('routing', routing.value)
  await store.loadSettings()
  toast.ok('端点与路由已保存（立即对后续批改生效）')
}
function addEndpoint() {
  eps.value.push({ id: Math.random().toString(36).slice(2, 10), label: '新端点', baseUrl: 'https://api.deepseek.com/v1', apiKey: '', model: 'deepseek-chat', role: 'fast', enabled: true })
}
/** 破坏性操作统一走 dialog.warning（本页所有确认都用同一种） */
function removeAt(i: number) {
  const gone = eps.value[i]
  dialog.warning({
    title: '删除这个端点？',
    content: `「${gone?.label ?? '未命名'}」会从列表里移除；保存后端点与路由都不再使用它。想先试试关掉它，可以只关开关。`,
    positiveText: '删除',
    negativeText: '取消',
    type: 'error',
    onPositiveClick: () => {
      if (routing.value.fastEndpointId === gone?.id) routing.value.fastEndpointId = null
      if (routing.value.strongEndpointId === gone?.id) routing.value.strongEndpointId = null
      eps.value.splice(i, 1)
    }
  })
}
async function testOne(ep: EndpointConfig) {
  testing.value = ep.id
  try {
    const r = await ipc.ai.test(ep)
    store.aiHealth[ep.id] = { ok: r.ok, message: `${r.message}｜${r.latency}ms${r.models?.length ? `｜模型 ${r.models.slice(0, 4).join(', ')}` : ''}` }
  } catch (e: any) { store.aiHealth[ep.id] = { ok: false, message: String(e?.message ?? e) } } finally { testing.value = '' }
}
async function saveLearning() {
  for (const [k, v] of Object.entries(learning.value)) await ipc.settings.set(k, v as any)
  await store.loadSettings()
  toast.ok('学习参数已保存')
}
async function loadUsage() {
  usage.value = await ipc.ai.usage(7)
  byTask.value = await ipc.ai.byTask(30)
  errs.value = await ipc.ai.errors(8)
}
const totals = computed(() => {
  const u: any = usage.value ?? {}
  return { calls: u.calls ?? 0, tokens: u.tokens ?? 0, ms: u.ms ?? 0, fails: u.fails ?? 0 }
})
/** 路径复制：只写剪贴板，不碰 IPC（打开目录仍走原有 window_open） */
async function copyPath(p?: string) {
  if (!p) return
  try {
    await navigator.clipboard.writeText(p)
    toast.ok('路径已复制')
  } catch { toast.err('复制失败，请长按路径手动选中') }
}
/** 外观节危险项：清掉 lib/theme.ts 写入的本机偏好键（同一个 KEY，不是新键），刷新后回到默认档 */
function resetThemePref() {
  try { localStorage.removeItem('forge.ui.theme') } catch { /* 沙箱下 localStorage 可能不可写，忽略 */ }
  location.reload()
}
onMounted(async () => {
  await boot()
  await loadUsage()
  await refreshTutor()
  // 状态只有 4 态且带倒计时，5s 轮询足够；页面卸载时清掉，避免后台空转
  tutorTimer = setInterval(() => { void refreshTutor() }, 5000)
})
onUnmounted(() => { if (tutorTimer) { clearInterval(tutorTimer); tutorTimer = null } })
</script>

<template>
  <div class="page page-narrow">
    <!-- ===== 页头 ===== -->
    <header class="page-head">
      <div class="grow col">
        <h1><Icon name="gear" :size="20" class="hd-ic" /> 设置</h1>
        <p>四节各自独立保存：AI 端点与路由改完必须点「保存端点与路由」才生效；外观即时生效、不进云端。</p>
      </div>
      <div class="acts">
        <n-button quaternary :disabled="!!testing" @click="testAll">
          <template #icon><Icon name="zap" :size="15" /></template>全部测试
        </n-button>
        <n-button type="primary" :loading="!!testing" @click="saveEndpoints">
          <template #icon><Icon name="check" :size="15" /></template>保存端点与路由
        </n-button>
      </div>
    </header>

    <!-- ===== 1. AI 端点 ===== -->
    <section class="card rise" style="--i:1">
      <div class="panel-head">
        <h3><Icon name="route" :size="16" class="hd-ic" /> AI 端点</h3>
        <span class="desc">OpenAI 兼容 · 谁来判分、谁来讲解，全部由你控制</span>
        <span class="grow" />
        <span class="pill" :class="enabledEps.length ? 'ok' : 'bad'"><span class="num">{{ enabledEps.length }}</span> 个已启用</span>
        <n-button size="small" @click="addEndpoint">
          <template #icon><Icon name="pen" :size="14" /></template>添加端点
        </n-button>
      </div>

      <div class="tiny muted ep-hint wrap-any">
        建议至少配两个：<b>快模型</b>用于讲解/追问（便宜、要快），<b>强模型</b>用于主观题判分与题库生成（准、可信）。
        DeepSeek 填 <code>https://api.deepseek.com/v1</code> + <code>deepseek-chat</code> / <code>deepseek-reasoner</code>；本机 Strata 填 <code>http://127.0.0.1:1234/v1</code> + <code>qwen</code> 并勾选「本机」（Ollama 则用 <code>http://127.0.0.1:11434/v1</code>）。启动方式见 <code>docs/ops/local-model-service.md</code>。
      </div>

      <div v-if="!eps.length" class="empty">
        <span class="ic"><Icon name="route" :size="24" /></span>
        <div class="t">还没有配置任何 AI 端点</div>
        <div class="d">没有端点时判分会降级为「自评 + 参考答案」，讲评与题库更新也用不了。</div>
        <div class="cta"><n-button type="primary" size="small" @click="addEndpoint"><template #icon><Icon name="pen" :size="14" /></template>添加第一个端点</n-button></div>
      </div>

      <template v-else>
        <EndpointRow v-for="(ep, i) in eps" :key="ep.id" :ep="ep" :busy="testing === ep.id" :health="health[ep.id]"
          @test="testOne(ep)" @remove="removeAt(i)" />
      </template>
    </section>

    <!-- ===== 2. 模型路由 ===== -->
    <section class="card rise" style="--i:2">
      <div class="panel-head">
        <h3><Icon name="layers" :size="16" class="hd-ic" /> 模型路由</h3>
        <span class="desc">留空 = 按端点 role 自动选；指定后该类任务固定走它</span>
        <span class="grow" />
        <n-button size="small" :loading="!!testing" :disabled="!!testing" @click="testAll">
          <template #icon><Icon name="zap" :size="14" /></template>全部测试
        </n-button>
      </div>

      <div class="grid g2 rt-grid">
        <label class="fld">
          <span class="fld-l">讲评 / 追问 / 答疑 用哪个端点</span>
          <n-select v-model:value="routing.fastEndpointId" size="small" clearable placeholder="自动按 role 选" :options="endpointOptions" />
          <span class="micro faint rt-resolved">实际会走：<b>{{ fastResolvedName }}</b><span v-if="!fastForced">（自动挑选）</span><span v-else>（已指定）</span></span>
        </label>
        <label class="fld">
          <span class="fld-l">判分 / 组卷 / 题库更新 用哪个端点</span>
          <n-select v-model:value="routing.strongEndpointId" size="small" clearable placeholder="自动按 role 选" :options="endpointOptions" />
          <span class="micro faint rt-resolved">实际会走：<b>{{ strongResolvedName }}</b><span v-if="!strongForced">（自动挑选）</span><span v-else>（已指定）</span></span>
        </label>
        <label class="fld">
          <span class="fld-l">答疑 / 追问 / 私教（默认本地小模型）</span>
          <n-select v-model:value="routing.tutorEndpointId" size="small" clearable placeholder="自动：优先内置本地模型" :options="endpointOptions" data-testid="route-tutor" />
          <span class="micro faint rt-resolved">实际会走：<b>{{ tutorResolvedName }}</b><span v-if="!tutorForced">（自动挑选）</span><span v-else>（已指定）</span></span>
        </label>
      </div>

      <div class="row rt-acts">
        <span class="tiny faint grow">路由只在保存后对后续批改生效，不影响历史成绩</span>
        <n-button type="primary" size="small" :loading="!!testing" @click="saveEndpoints">
          <template #icon><Icon name="check" :size="14" /></template>保存端点与路由
        </n-button>
      </div>
    </section>

    <!-- ===== 3. 本地答疑模型（内置小模型，CPU 推理，显存 0）===== -->
    <section class="card rise" style="--i:3">
      <div class="panel-head">
        <h3><Icon name="brain" :size="16" class="hd-ic" /> 本地答疑模型</h3>
        <span class="desc">{{ tutor?.mode === 'auto' ? '自动判定后端' : tutor?.mode === 'gpu' ? '强制 GPU' : '强制 CPU' }} · {{ inferBackendText }}</span>
        <span class="grow" />
        <span class="pill" :class="tutorReady ? 'ok' : (tutor && (!tutor.modelExists || !tutor.binExists || tutor.state === 'error')) ? 'bad' : 'info'" data-testid="tutor-state">
          <Icon :name="tutorReady ? 'check' : 'alert'" :size="12" /> {{ tutorStateText }}
        </span>
      </div>

      <div class="tiny muted ep-hint wrap-any">
        答疑、追问、「我不会」讲解默认走这个内置小模型。默认<b>自动选择后端</b>：检测到 NVIDIA 显卡且显存足够就全量上卡（推荐 Vulkan 运行时，仅 36 MB，NVIDIA/AMD/Intel 通用），显存不够则纯 CPU（零显存占用，不和 Strata / ComfyUI 抢卡）。不使用时进程自动退出，首次加载约 3-6 秒。
      </div>

      <div class="path-list">
        <div class="kv path-row">
          <span class="micro faint path-k shrink">状态</span>
          <span class="tiny grow wrap-any">{{ tutorStateText }}<template v-if="tutorIdleText"> · {{ tutorIdleText }}</template></span>
        </div>
        <div class="kv path-row">
          <span class="micro faint path-k shrink">显卡</span>
          <span class="tiny grow wrap-any">{{ gpuText }}</span>
        </div>
        <div class="kv path-row">
          <span class="micro faint path-k shrink">实际推理</span>
          <span class="tiny grow"><b>{{ inferBackendText }}</b> · {{ tutor?.threads ?? '—' }} 线程 · 上下文 {{ tutor?.ctx ?? '—' }} · 端口 {{ tutor?.port ?? '—' }}</span>
        </div>
        <div class="kv path-row">
          <span class="micro faint path-k shrink">推理模式</span>
          <span class="row grow" style="gap:6px;flex-wrap:wrap">
            <n-button
              v-for="m in inferModes" :key="m.id" size="tiny"
              :type="tutor?.mode === m.id ? 'primary' : 'default'" :disabled="!!tutorBusy"
              :data-testid="'tutor-mode-' + m.id" @click="setInferMode(m.id)"
            >{{ m.label }}</n-button>
          </span>
        </div>
        <div class="kv path-row">
          <span class="micro faint path-k shrink">判定理由</span>
          <span class="tiny grow wrap-any faint">{{ tutor?.reason ?? '—' }}</span>
        </div>
        <div class="kv path-row">
          <span class="micro faint path-k shrink">模型</span>
          <button class="path-copy ellip" type="button" :title="'点击复制路径：' + (tutor?.modelPath ?? '')" @click="copyPath(tutor?.modelPath)">
            <Icon name="copy" :size="13" /> <span class="ellip">{{ tutor?.modelPath ?? '—' }}</span>
          </button>
          <span class="pill" :class="tutor?.modelExists ? 'ok' : 'bad'">{{ tutor?.modelExists ? '已就位' : '缺失' }}</span>
        </div>
        <div class="kv path-row">
          <span class="micro faint path-k shrink">运行时</span>
          <button class="path-copy ellip" type="button" :title="'点击复制路径：' + (tutor?.binPath ?? '')" @click="copyPath(tutor?.binPath)">
            <Icon name="copy" :size="13" /> <span class="ellip">{{ tutor?.binPath || '—' }}</span>
          </button>
          <span class="pill" :class="tutor?.binExists ? 'ok' : 'bad'">{{ tutor?.binExists ? 'llama.cpp' : '缺失' }}</span>
        </div>
      </div>

      <!-- 模型与运行时分发：不下模型也能先看到「该下哪个、多大、下了没」 -->
      <template v-if="catalog">
        <div class="section-title">可选模型</div>
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <div v-for="m in catalog.models" :key="m.id" class="kv" style="min-width:240px;flex:1;gap:4px">
            <span class="tiny"><b>{{ m.label }}</b> <span class="faint">{{ m.params }} · {{ m.quant }} · {{ m.sizeMb }} MB</span></span>
            <span class="micro faint wrap-any">{{ m.note }}</span>
            <span class="row" style="gap:6px">
              <span class="pill" :class="m.ready ? 'ok' : 'bad'">{{ m.ready ? '已下载' : '未下载' }}</span>
              <span v-if="m.selected" class="pill ok">使用中</span>
              <n-button v-else size="tiny" :disabled="!!tutorBusy" @click="setModel(m.id)">用这个</n-button>
            </span>
          </div>
        </div>

        <div class="section-title">推理运行时</div>
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <div v-for="r in catalog.runtimes" :key="r.id" class="kv" style="min-width:240px;flex:1;gap:4px">
            <span class="tiny"><b>{{ r.label }}</b> <span class="faint">{{ r.sizeMb }} MB</span></span>
            <span class="micro faint wrap-any">{{ r.note }}</span>
            <span class="pill" :class="r.ready ? 'ok' : 'bad'">{{ r.ready ? '已就绪' : '未下载' }}</span>
          </div>
        </div>
        <div class="tiny muted wrap-any" style="margin-top:6px">
          推荐后端：<b>{{ catalog.recommendBackend === 'cpu' ? 'CPU' : catalog.recommendBackend.toUpperCase() }}</b> —— {{ catalog.recommendReason }}
        </div>
        <div class="kv path-row" style="margin-top:6px">
          <span class="micro faint path-k shrink">补下载</span>
          <button class="path-copy ellip" type="button" :title="'点击复制命令：' + catalog.fetchHint" @click="copyPath(catalog.fetchHint)">
            <Icon name="copy" :size="13" /> <span class="ellip">{{ catalog.fetchHint }}</span>
          </button>
        </div>
      </template>

      <div class="row rt-acts">
        <n-button size="small" type="primary" :loading="tutorBusy === 'start'" :disabled="!!tutorBusy || (tutor?.state === 'ready')" data-testid="tutor-start" @click="startTutor">
          <template #icon><Icon name="zap" :size="14" /></template>{{ tutorReady ? '已就绪' : '立即加载' }}
        </n-button>
        <n-button size="small" :loading="tutorBusy === 'stop'" :disabled="!!tutorBusy || !tutorReady" @click="stopTutor">
          <template #icon><Icon name="close" :size="14" /></template>立即卸载
        </n-button>
        <n-button size="small" quaternary @click="loadTutorLog">
          <template #icon><Icon name="refresh" :size="13" /></template>日志
        </n-button>
        <span class="tiny faint grow">{{ tutor?.modelExists && tutor?.binExists ? (tutorReady ? tutorIdleText : '') : '缺依赖时按上面的「补下载」命令拉取' }}</span>
      </div>

      <template v-if="tutorLogs.length">
        <div class="section-title">最近日志</div>
        <pre class="err-pre tiny tutor-log">{{ tutorLogs.join('\n') }}</pre>
      </template>
    </section>

    <!-- ===== 4. 本地数据 ===== -->
    <section class="card rise" style="--i:4">
      <div class="panel-head">
        <h3><Icon name="folder" :size="16" class="hd-ic" /> 本地数据</h3>
        <span class="desc">题库是真源，SQLite 只是缓存</span>
        <span class="grow" />
        <span class="pill" :class="runtime?.sqlite ? 'ok' : 'bad'"><Icon :name="runtime?.sqlite ? 'check' : 'alert'" :size="12" /> SQLite {{ runtime?.sqlite ? '可用' : '不可用' }}</span>
      </div>

      <div class="path-list">
        <div v-for="p in [{ k: '数据库', v: paths?.db }, { k: '题库真源', v: paths?.content }, { k: '快照目录', v: paths?.snapshots }]" :key="p.k" class="kv path-row">
          <span class="micro faint path-k shrink">{{ p.k }}</span>
          <button class="path-copy ellip" type="button" :title="'点击复制全文：' + (p.v ?? '')" @click="copyPath(p.v)">
            <Icon name="copy" :size="13" /> <span class="ellip">{{ p.v ?? '—' }}</span>
          </button>
          <n-button size="tiny" quaternary aria-label="在文件夹中打开" @click="window_open(p.v)">
            <template #icon><Icon name="external" :size="13" /></template>打开
          </n-button>
        </div>
        <div class="kv"><span class="micro faint path-k">Electron / Node</span><span class="tiny num muted">{{ runtime?.electron }} / {{ runtime?.node }}</span></div>
      </div>

      <div class="fb warn data-fb">
        <h4><Icon name="alert" :size="15" /> 备份就拷这两个目录</h4>
        <div class="tiny muted wrap-any">
          题库是 content/ 下的 JSON 文件，SQLite 只是缓存。备份只要拷 <code>content/</code> + <code>data/</code>；改坏了可在「题库·版本」页一键回滚。
        </div>
      </div>

      <div class="section-title">危险区</div>
      <div class="row danger-row">
        <div class="col grow dang-txt">
          <span class="tiny">清掉界面偏好（主题档位）</span>
          <span class="micro faint">只删本机外观偏好，不动题库与答题记录；清掉后下次启动回到浅色</span>
        </div>
        <button class="btn danger shrink" type="button"
          @click="dialog.warning({ title: '清掉界面偏好？', content: '会把本机的外观档位（浅色 / 深色 / 跟随系统）恢复默认，题库与答题记录不受影响。', positiveText: '清除', negativeText: '取消', type: 'error', onPositiveClick: () => resetThemePref() })">
          <Icon name="close" :size="13" /> 清除偏好
        </button>
      </div>
    </section>

    <!-- ===== 5. 外观（新增节，全部复用 lib/theme.ts）===== -->
    <section class="card rise" style="--i:5">
      <div class="panel-head">
        <h3><Icon name="sun" :size="16" class="hd-ic" /> 外观</h3>
        <span class="desc">即时生效，只存在本机</span>
        <span class="grow" />
        <span class="pill" :class="isDark ? 'purple' : 'info'">
          <Icon :name="isDark ? 'moon' : 'sun'" :size="12" /> 当前{{ activeThemeLabel }}
        </span>
      </div>

      <div class="grid g2 ap-grid">
        <div class="fld">
          <span class="fld-l">配色档位</span>
          <div class="seg" role="group" aria-label="配色档位">
            <button v-for="t in THEME_MODES" :key="t.m" type="button" :aria-pressed="themeMode === t.m"
              :class="{ on: themeMode === t.m }" @click="setTheme(t.m)">
              <Icon :name="t.i" :size="13" /> {{ t.l }}
            </button>
          </div>
          <span class="micro faint ap-hint">{{ themeHint }}</span>
        </div>

        <div class="fld">
          <span class="fld-l">快速试一轮</span>
          <div class="row ap-acts">
            <button class="btn ghost" type="button" title="按 浅色 → 深色 → 跟随系统 顺序切一档" @click="cycleTheme()">
              <Icon name="refresh" :size="13" /> 立即预览
            </button>
            <span class="micro faint">依次轮换三档，随时点回你想要的那档</span>
          </div>
        </div>

        <div class="kv ap-kv">
          <span class="grow col">
            <span class="tiny">启动时提醒今日任务</span>
            <span class="micro faint">对应设置项 <code>ui.reminderOnLaunch</code>；随「保存参数」一起写入</span>
          </span>
          <n-switch v-model:value="learning.reminderOnLaunch" size="small" aria-label="启动时提醒今日任务" />
        </div>
      </div>
    </section>

    <!-- ===== 6. 学习算法参数 ===== -->
    <section class="card rise" style="--i:6">
      <div class="panel-head">
        <h3><Icon name="brain" :size="16" class="hd-ic" /> 学习算法参数</h3>
        <span class="desc">FSRS 排期与组卷口径</span>
        <span class="grow" />
        <n-button data-testid="settings-save" type="primary" size="small" @click="saveLearning">
          <template #icon><Icon name="check" :size="14" /></template>保存参数
        </n-button>
      </div>

      <div class="grid g2 lm-grid">
        <div class="kv">
          <span class="grow col">
            <span class="tiny">目标保持率 desiredRetention <span class="num muted">{{ learning.desiredRetention.toFixed(2) }}</span></span>
            <span class="micro faint">FSRS 想让你记住的概率；越高排期越紧、每天题越多</span>
          </span>
          <n-slider v-model:value="learning.desiredRetention" class="lm-slider" :min="0.7" :max="0.97" :step="0.01"
            :format-tooltip="(v: number) => v.toFixed(2)" />
        </div>
        <div class="kv">
          <span class="grow col">
            <span class="tiny">旧题 / 变体混入比例 <span class="num muted">{{ Math.round(learning.globalMixRatio * 100) }}%</span></span>
            <span class="micro faint">练习组卷里「已考点变体 + 到期复习」的占比</span>
          </span>
          <n-slider v-model:value="learning.globalMixRatio" class="lm-slider" :min="0" :max="0.9" :step="0.05"
            :format-tooltip="(v: number) => `${Math.round(v * 100)}%`" />
        </div>
        <label class="kv lm-inline">
          <span class="grow tiny">每日题量目标</span>
          <n-input-number v-model:value="learning.dailyTarget" class="num" size="small" :min="5" :max="100" />
        </label>
        <label class="kv lm-inline">
          <span class="grow tiny">闭卷严格计时（到点自动交卷）</span>
          <n-switch v-model:value="learning.strictTiming" size="small" />
        </label>
        <label class="kv lm-inline">
          <span class="grow tiny">每周自动扩充题库（AI 补覆盖缺口）</span>
          <n-switch v-model:value="learning.autoWeekUpdate" size="small" />
        </label>
      </div>
    </section>

    <!-- ===== 7. AI 用量与故障 ===== -->
    <section class="card rise" style="--i:7">
      <div class="panel-head">
        <h3><Icon name="chart" :size="16" class="hd-ic" /> AI 用量与故障</h3>
        <span class="desc">近 7 天</span>
        <span class="grow" />
        <n-button size="tiny" quaternary @click="loadUsage">
          <template #icon><Icon name="refresh" :size="13" /></template>刷新
        </n-button>
      </div>

      <div class="kpis us-kpis">
        <div class="kpi"><div class="k">调用</div><div class="v num">{{ totals.calls }}</div><div class="d">近 7 天</div></div>
        <div class="kpi"><div class="k">tokens</div><div class="v num">{{ totals.tokens }}</div><div class="d">输入 + 输出</div></div>
        <div class="kpi"><div class="k">累计耗时</div><div class="v num">{{ (totals.ms / 1000).toFixed(0) }}s</div><div class="d">含重试</div></div>
        <div class="kpi"><div class="k">失败</div><div class="v num" :style="{ color: totals.fails ? 'var(--bad)' : undefined }">{{ totals.fails }}</div><div class="d">见下方错误原文</div></div>
      </div>

      <div class="tbl-wrap">
        <table class="us-tbl">
          <thead><tr><th>任务</th><th class="ta-r">次数</th><th class="ta-r">tokens</th><th class="ta-r">耗时</th><th class="ta-r">失败</th></tr></thead>
          <tbody>
            <tr v-for="t in byTask" :key="t.task">
              <td class="ellip">{{ t.task }}</td>
              <td class="ta-r num">{{ t.calls }}</td>
              <td class="ta-r num">{{ t.tokens }}</td>
              <td class="ta-r num">{{ (t.ms / 1000).toFixed(0) }}s</td>
              <td class="ta-r num" :class="{ 't-bad': t.fails }">{{ t.fails ?? 0 }}</td>
            </tr>
            <tr v-if="!byTask.length"><td colspan="5" class="ta-r faint tiny">近 7 天没有 AI 调用记录</td></tr>
          </tbody>
        </table>
      </div>

      <template v-if="errs.length">
        <div class="section-title">最近的 AI 错误（点开看原文）</div>
        <details v-for="e in errs" :key="e.id" class="err">
          <summary><span class="t-bad num">{{ (e.ts || '').slice(0, 16) }}</span> · {{ e.task }} · <span class="ellip">{{ (e.note || '').slice(0, 90) }}</span></summary>
          <pre class="err-pre tiny">{{ e.note }}</pre>
        </details>
      </template>
    </section>
  </div>
</template>

<style scoped>
.hd-ic { color: var(--accent); vertical-align: -3px }
.ep-hint { margin-bottom: var(--sp-3); line-height: var(--lh-loose) }
.ep-hint code { font-family: var(--mono); font-size: var(--fs-xs); background: var(--surface-2); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px }

/* ---- 统一表单字段结构：label 在上、控件在下（与 PracticeView/ExamView 同名类保持同形状）---- */
.fld { display: flex; flex-direction: column; gap: var(--sp-1); min-width: 0 }
.fld-l { font-size: var(--fs-xs); color: var(--text-faint); font-weight: 600; letter-spacing: .02em }

/* ---- 路由节 ---- */
.rt-grid { gap: var(--sp-4) }
.rt-resolved { margin-top: 2px }
.rt-resolved b { color: var(--text-dim) }
.rt-acts { margin-top: var(--sp-3); row-gap: var(--sp-2) }

/* ---- 本地数据：路径行（点即复制）---- */
.path-list { display: grid; gap: 2px }
.path-row { gap: var(--sp-2) }
.path-k { min-width: 62px; letter-spacing: .04em }
.path-copy {
  flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 6px;
  border: 1px solid transparent; background: transparent; color: var(--text-dim);
  font: inherit; font-size: var(--fs-sm); text-align: left; padding: 4px 8px; border-radius: var(--r-md); cursor: pointer;
  transition: background-color var(--dur-fast), border-color var(--dur-fast), color var(--dur-fast)
}
.path-copy:hover { background: var(--surface-2); border-color: var(--border); color: var(--text) }
.path-copy:focus-visible { box-shadow: var(--ring-soft) }
.data-fb { margin-top: var(--sp-3) }
.data-fb h4 { font-size: var(--fs-sm) }
.danger-row { margin-top: var(--sp-2); padding: var(--sp-3); border: 1px solid color-mix(in oklab, var(--bad) 26%, var(--border)); border-radius: var(--r-md); background: color-mix(in oklab, var(--bad) 5%, var(--surface)); row-gap: var(--sp-2) }
.dang-txt { gap: 2px }

/* ---- 外观节 ---- */
.ap-grid { gap: var(--sp-4) }
.ap-grid .seg button { display: inline-flex; align-items: center; gap: 5px }
.ap-hint { line-height: 1.5 }
.ap-acts { flex-wrap: wrap }
.ap-kv { grid-column: 1 / -1 }

/* ---- 学习参数 ---- */
.lm-grid { gap: 0 var(--sp-4) }
.lm-slider { flex: 0 0 150px }
.lm-inline { gap: var(--sp-3) }
.lm-grid .kv > .col { gap: 2px }

/* ---- 用量表 ---- */
.us-kpis { margin-bottom: var(--sp-3) }
.tbl-wrap { overflow-x: auto }
.us-tbl { width: 100%; border-collapse: collapse; font-size: var(--fs-sm) }
.us-tbl th { text-align: left; color: var(--text-faint); font-weight: 620; font-size: var(--fs-xs); padding: 6px 8px; border-bottom: 1px solid var(--border) }
.us-tbl td { padding: 6px 8px; border-bottom: 1px dashed var(--border) }
.us-tbl tbody tr:last-child td { border-bottom: 0 }
.us-tbl tbody tr:hover td { background: color-mix(in oklab, var(--accent) 4%, transparent) }
.ta-r { text-align: right }
.t-bad { color: var(--bad) }

.err { margin-top: 6px; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--surface-2); overflow: hidden }
.err summary { cursor: pointer; display: flex; align-items: center; gap: 6px; padding: 8px var(--sp-3); font-size: var(--fs-sm); color: var(--text-dim); list-style: none; min-width: 0 }
.err summary::-webkit-details-marker { display: none }
.err summary:hover { background: color-mix(in oklab, var(--bad) 6%, transparent) }
.err[open] summary { border-bottom: 1px solid var(--border) }
.err-pre { white-space: pre-wrap; overflow-wrap: anywhere; padding: var(--sp-3); margin: 0; background: var(--surface); color: var(--text-dim); max-height: 260px; overflow: auto }
.tutor-log { margin-top: 6px; max-height: 220px }

@media (max-width: 720px) {
  .rt-grid, .ap-grid, .lm-grid, .g2 { grid-template-columns: minmax(0, 1fr) }
  .lm-slider { flex: 1 1 120px }
  .path-k { min-width: 0 }
}
</style>
