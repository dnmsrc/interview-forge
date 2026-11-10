import MarkdownIt from 'markdown-it'
import { computed } from 'vue'
import { createDiscreteApi, darkTheme } from 'naive-ui'
import { isDark, naiveOverrides } from './theme'

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
export const md: InstanceType<typeof MarkdownIt> = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  highlight: (str: string, lang?: string): string => `<pre><code class="lang-${lang || 'text'}">${escapeHtml(str)}</code></pre>`
})
export const renderMd = (s: unknown): string => (s == null ? '' : md.render(String(s)))
/**  inline 代码风格的短文本（题干里的 `x`） */
export const renderInline = (s: unknown): string => (s == null ? '' : md.renderInline(String(s)))

/**
 * ⚠️ 关键事实（naive-ui 2.45 源码实测，见 docs/design/COMMUNITY-UI-BENCHMARK.md §6.1）：
 * createDiscreteApi 会**另挂一棵 NConfigProvider**，不继承 App.vue 上的主题层。
 * 因此必须把 theme / themeOverrides 以「响应式 computed」的形式传进去，
 * 否则深色模式下 message/dialog 仍是浅白底，且切换主题不生效。
 */
export const { message, dialog, notification } = createDiscreteApi(
  ['message', 'dialog', 'notification'],
  {
    configProviderProps: computed(() => ({
      theme: isDark.value ? darkTheme : null,
      themeOverrides: naiveOverrides(isDark.value),
      hljsTheme: null as string | null
    })) as never,
    messageProviderProps: { placement: 'top', duration: 3500, keepAliveOnHover: true, max: 3 },
    // NotificationProvider 没有 provider 级 duration（时长只在单条 notification 上给）
    notificationProviderProps: { placement: 'bottom-right', max: 3 }
  }
)

/**
 * 反馈时长契约（业界下限 5s 起，Byrne-Haber / Deque cauldron#2099）。
 * 禁止在视图里裸调 message.xxx() 带随意时长——统一走这里。
 * naive 用 `if (duration)` 判断，传 0 即「不设定时器 = 常驻」，错误提示必须常驻 + closable。
 */
export const DUR = { ok: 2200, info: 3500, warn: 6000, err: 0, note: 8000 } as const
export const toast = {
  /** 高频轻确认：已保存 / 已刷新 / 已导出 */
  ok: (m: string) => message.success(m, { duration: DUR.ok }),
  info: (m: string) => message.info(m, { duration: DUR.info }),
  /** 需要读完并可能采取行动 */
  warn: (m: string) => message.warning(m, { duration: DUR.warn, keepAliveOnHover: true }),
  /** 失败必须让用户主动关闭，不能自己消失 */
  err: (m: string) => message.error(m, { duration: DUR.err, closable: true }),
  /** 后台任务完成，允许稍后再看 */
  note: (title: string, content: string) => notification.success({ title, content, duration: DUR.note, keepAliveOnHover: true }),
  noteError: (title: string, content: string) => notification.error({ title, content, duration: 0, keepAliveOnHover: true })
}

export const TYPE_LABEL: Record<string, string> = {
  single: '单选', multiple: '多选', judge: '判断', blank: '填空', short: '简答', essay: '论述', code: '编程'
}
export const TYPE_ICON: Record<string, string> = {
  single: '🔘', multiple: '☑️', judge: '⚖️', blank: '✏️', short: '💬', essay: '📁', code: '⌨️'
}
/** 题型 → 线性图标名（配合 components/Icon.vue，替代 emoji） */
export const TYPE_ICON_NAME: Record<string, string> = {
  single: 'target', multiple: 'check', judge: 'filter', blank: 'pen', short: 'book', essay: 'layers', code: 'zap'
}
export const DOMAIN_LABEL: Record<string, string> = {
  fe: '前端', be: '后端', cs: '公共基础', ai: 'AI Agent', eng: '工程难题'
}
export const SCALE_LABEL = ['完全不会', '提示后会', '独立说清', '能追问并举证']
/**
 * 语义色一律返回 CSS 变量表达式而非 hex：这样明暗主题与用户偏好自动生效，
 * 也让「第二处硬编码品牌色」不可能出现（token 唯一真值源在 styles.css / lib/theme.ts）。
 * 只可用于 style/CSS 绑定；SVG presentation attribute 里要用类（见 UI-DESIGN-SYSTEM.md §5）。
 */
export const SCALE_COLOR = ['var(--bad)', 'var(--warn)', 'var(--ok)', 'var(--purple)']
export const SCALE_SOFT = SCALE_COLOR.map((c) => `color-mix(in oklab, ${c} 14%, transparent)`)
export const DIFF_LABEL = ['', '送分', '常规', '中档', '较难', '压轴']

const clamp4 = (s: unknown) => Math.max(0, Math.min(3, Math.round(Number(s ?? 0))))
export const scale4Color = (s: number) => SCALE_COLOR[clamp4(s)]
export const scale4Soft = (s: number) => SCALE_SOFT[clamp4(s)]
export const pctColor = (p: number) =>
  p >= 81 ? 'var(--ok)'
    : p >= 56 ? 'color-mix(in oklab, var(--ok) 74%, var(--text-dim))'
    : p >= 26 ? 'var(--warn)' : 'var(--bad)'
/** 给内联 style 用的半透明底（替代旧代码里 hex + '22' 的 alpha 拼接） */
export const softOf = (cssColor: string, pct = 14) => `color-mix(in oklab, ${cssColor} ${pct}%, transparent)`
export const lineOf = (cssColor: string, pct = 34) => `color-mix(in oklab, ${cssColor} ${pct}%, transparent)`
export const nodeClass = (n: { lit?: number; needs_work?: number; locked?: number }) =>
  n.lit ? 'lit' : n.locked ? 'locked' : n.needs_work ? 'needs' : ''

export function fmtAgo(s?: string | null): string {
  if (!s) return '从未'
  const t = new Date(String(s).replace(' ', 'T')).getTime()
  if (!Number.isFinite(t)) return String(s)
  const d = Date.now() - t
  if (d < 60000) return '刚刚'
  if (d < 3600000) return `${Math.floor(d / 60000)} 分钟前`
  if (d < 86400000) return `${Math.floor(d / 3600000)} 小时前`
  if (d < 86400000 * 30) return `${Math.floor(d / 86400000)} 天前`
  return String(s).slice(0, 10)
}
export const fmtClock = (ms: number) => {
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
export const fmtNum = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(n))

/** 题目在 UI 上的稳定颜色（用于图谱与列表的一致性） */
export function typePillClass(t: string): string {
  return { single: 'info', multiple: 'purple', judge: 'lock', blank: 'warn', short: 'ok', essay: 'cyan', code: 'purple' }[t] ?? 'lock'
}

export function downloadText(name: string, text: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf8' }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}
