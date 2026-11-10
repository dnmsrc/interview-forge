/**
 * 设计系统主题层：把「语义 token」同时喂给 CSS 变量与 naive-ui，保证自研 UI 与
 * naive-ui 组件（按钮/输入/弹窗/表格/提示）视觉同源。切换只改 html[data-theme] + store。
 *
 * 依据 docs/design/COMMUNITY-UI-BENCHMARK.md：中性色用冷灰阶 + 透明度叠加边框、
 * 主色单一 indigo、surface 三级、圆角/阴影分级、过渡时长三档。
 */
import { ref, computed } from 'vue'
import { darkTheme } from 'naive-ui'
import type { GlobalThemeOverrides } from 'naive-ui'

export type ThemeMode = 'light' | 'dark' | 'auto'

const KEY = 'forge.ui.theme'
export const themeMode = ref<ThemeMode>((() => {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'dark' || v === 'auto' ? (v as ThemeMode) : 'light'
  } catch {
    return 'light'
  }
})())

const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
export const isDark = computed(() => {
  const m = themeMode.value
  if (m === 'dark') return true
  if (m === 'light') return false
  return !!mq?.matches
})

/** 实际生效值：写入 DOM 属性供 CSS 变量切换，并持久化偏好 */
export function applyTheme(): void {
  const dark = isDark.value
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  try {
    localStorage.setItem(KEY, themeMode.value)
  } catch {
    /* 沙箱下 localStorage 可能不可写，忽略 */
  }
}
export function cycleTheme(): ThemeMode {
  const order: ThemeMode[] = ['light', 'dark', 'auto']
  themeMode.value = order[(order.indexOf(themeMode.value) + 1) % order.length]
  applyTheme()
  return themeMode.value
}
if (mq) mq.addEventListener?.('change', () => applyTheme())

/* ---------- 共用数值：CSS 与 naive-ui 共用同一份，避免两套刻度漂移 ---------- */
export const RADIUS = { small: '6px', medium: '10px', large: '14px', huge: '20px' } as const
const FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`

const lightCommon = {
  primaryColor: '#5e6ad2',
  primaryColorHover: '#6e79e0',
  primaryColorPressed: '#4f5ac0',
  primaryColorSuppl: '#5e6ad2',
  infoColor: '#2563eb',
  successColor: '#157f3d',
  warningColor: '#a16207',
  errorColor: '#d1242f',
  bodyColor: '#f7f8fa',
  cardColor: '#ffffff',
  modalColor: '#ffffff',
  popoverColor: '#ffffff',
  borderColor: '#e3e8ef',
  dividerColor: '#eceff4',
  textColorBase: '#16191f',
  textColor: '#16191f',
  textColor1: '#16191f',
  textColor2: '#5b6472',
  textColor3: '#8b95a3'
}

const darkCommon = {
  primaryColor: '#7b83eb',
  primaryColorHover: '#8b93f0',
  primaryColorPressed: '#6a72dd',
  primaryColorSuppl: '#7b83eb',
  infoColor: '#58a6ff',
  successColor: '#3fb950',
  warningColor: '#d29922',
  errorColor: '#f85149',
  bodyColor: '#0b0d12',
  cardColor: '#14171d',
  modalColor: '#171b22',
  popoverColor: '#1a1e26',
  borderColor: '#262c38',
  dividerColor: '#222834',
  textColorBase: '#e6eaf0',
  textColor: '#e6eaf0',
  textColor1: '#e6eaf0',
  textColor2: '#9aa4b2',
  textColor3: '#6b7684'
}

/** naive-ui 主题覆盖：把组件对齐到我们的圆角/字号/控件高度节奏 */
export function naiveOverrides(dark: boolean): GlobalThemeOverrides {
  const common = {
    ...(dark ? darkCommon : lightCommon),
    fontFamily: FONT,
    borderRadius: RADIUS.medium,
    borderRadiusSmall: RADIUS.small,
    fontSize: '14px',
    fontSizeSm: '13px',
    heightSmall: '30px',
    heightMedium: '36px',
    heightLarge: '42px'
  }
  return {
    common: common as GlobalThemeOverrides['common'],
    Button: {
      fontWeight: '550',
      paddingMedium: '0 16px',
      paddingSmall: '0 12px',
      paddingLarge: '0 20px',
      borderRadius: RADIUS.medium,
      borderStylePrimary: 'none'
    },
    Card: {
      paddingMedium: '18px',
      paddingSmall: '14px',
      titleFontSizeMedium: '14px',
      titleFontWeight: '600' as unknown as number,
      borderColor: dark ? '#262c38' : '#e3e8ef'
    },
    Input: {
      borderStyle: 'solid',
      colorFocus: dark ? '#1a1e26' : '#ffffff',
      borderRadius: RADIUS.medium
    },
    Modal: { titleFontSize: '16px', paddingContent: '20px', borderRadius: RADIUS.large },
    Dialog: { titleFontSize: '16px', borderRadius: RADIUS.large },
    DataTable: { thColor: dark ? '#1a1e26' : '#f2f4f8', tdFontSize: '13px', thFontSize: '12.5px' },
    Tag: { borderRadius: '999px', barHeight: '20px' },
    Tabs: { barColorPrimary: dark ? '#7b83eb' : '#5e6ad2' },
    Message: { paddingContent: '10px 14px', borderRadius: RADIUS.medium },
    Notification: { padding: '14px 18px', borderRadius: RADIUS.large },
    Tooltip: { borderRadius: RADIUS.medium, padding: '6px 10px', fontSize: '12.5px' },
    Popover: { borderRadius: RADIUS.large },
    Progress: { railColor: dark ? '#232833' : '#e9edf3' },
    Switch: { railColor: dark ? '#363e4d' : '#cbd3dd' },
    Divider: { color: dark ? '#222834' : '#eceff4' },
    Scrollbar: { color: dark ? 'rgba(255,255,255,.16)' : 'rgba(16,24,40,.16)', colorHover: dark ? 'rgba(255,255,255,.26)' : 'rgba(16,24,40,.26)' }
  }
}

export const useNaiveTheme = () => ({
  themeMode,
  isDark,
  naiveTheme: computed(() => (isDark.value ? darkTheme : null)),
  themeOverrides: computed(() => naiveOverrides(isDark.value)),
  cycle: cycleTheme,
  set: (m: ThemeMode) => {
    themeMode.value = m
    applyTheme()
  }
})

/* ---------- 图表配色：与 tokens 同源，明暗各一套（对标 dashboard 规范） ---------- */
export const chartPalette = (dark: boolean) => ({
  series: dark
    ? ['#7b83eb', '#3fb950', '#d29922', '#f85149', '#a78bfa', '#34b3c7']
    : ['#5e6ad2', '#157f3d', '#a16207', '#d1242f', '#8b5cf6', '#0e7490'],
  text: dark ? '#9aa4b2' : '#5b6472',
  grid: dark ? '#222834' : '#eceff4',
  axis: dark ? '#262c38' : '#e3e8ef'
})

/** 供 ECharts / 手写 SVG 复用的基础 option 片段 */
export function chartBase(dark: boolean) {
  const p = chartPalette(dark)
  return {
    color: p.series,
    textStyle: { fontFamily: FONT, color: p.text, fontSize: 12 },
    grid: { left: 36, right: 16, top: 22, bottom: 26, containLabel: true },
    tooltip: {
      backgroundColor: dark ? '#1a1e26' : '#ffffff',
      borderColor: p.axis,
      borderWidth: 1,
      textStyle: { color: dark ? '#e6eaf0' : '#16191f', fontSize: 12.5 },
      extraCssText: 'border-radius:10px;box-shadow:0 8px 24px rgba(16,24,40,.16)'
    }
  }
}
