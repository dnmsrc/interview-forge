<script setup lang="ts">
import { computed } from 'vue'
/**
 * 内联线性图标（stroke = currentColor，24 网格 / 1.7 描边，Lucide 风格）。
 * 不引第三方图标库：Electron 离线可用、体积可控、颜色跟随文本 token 自动适配明暗。
 */
const P: Record<string, string[]> = {
  flame: ['M8.5 14.5A3.5 3.5 0 0 0 12 18a3.5 3.5 0 0 0 3.5-3.5c0-1.6-1-2.7-2-3.9-.9-1-1.5-1.9-1.5-3.1 0 0-3 1.3-3 4.2a4.6 4.6 0 0 1-.5 1.8Z', 'M12 22a8 8 0 0 0 8-8c0-5-4-6.5-4-11'],
  pen: ['M12.5 6.5 17 11 8 20H4v-4Z', 'M15.5 3.5a2.1 2.1 0 0 1 3 3L17 8 14 5Z'],
  timer: ['M10 2h4', 'M12 8v4l2.5 2.5', 'M22 16a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z'],
  graph: ['M5 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm14 4a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm-7 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z', 'M7 6.5h5M15.5 9.5 12 13.5'],
  chart: ['M3 3v16a2 2 0 0 0 2 2h16', 'M7 15l3.5-4 3 3L20 7'],
  folder: ['M4 6a2 2 0 0 1 2-2h3.5l2 2.5H18a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z'],
  gear: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.5 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 15H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 5 8.5l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 4.6V4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.5 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5.9Z'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', 'm21 21-4.3-4.3'],
  sun: ['M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z', 'M12 1v3M12 20v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1 12h3M20 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1'],
  moon: ['M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z'],
  auto: ['M12 3v18', 'M4.2 7.5h15.6', 'M12 21a9 9 0 0 0 0-18'],
  refresh: ['M21 12a9 9 0 1 1-2.6-6.4', 'M21 3v6h-6'],
  chevron: ['m9 6 6 6-6 6'],
  chevronDown: ['m6 9 6 6 6-6'],
  check: ['M20 6 9 17l-5-5'],
  alert: ['M12 9v4M12 17h.01', 'M10.3 3.8 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z'],
  close: ['M18 6 6 18M6 6l12 12'],
  play: ['m6 4 14 8-14 8Z'],
  arrowRight: ['M5 12h14', 'm13 6 6 6-6 6'],
  arrowLeft: ['M19 12H5', 'm11 18-6-6 6-6'],
  flag: ['M4 22V4', 'M4 4h13l-2 4 2 4H4'],
  panelLeft: ['M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z', 'M10 4v16'],
  sparkles: ['M12 3.5 13.6 8 18 9.5 13.6 11 12 15.5 10.4 11 6 9.5 10.4 8Z', 'M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z'],
  book: ['M4 4h10a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3Z', 'M17 20h3V7a3 3 0 0 0-3-3h-3'],
  target: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z', 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z'],
  layers: ['m12 2 9 5-9 5-9-5Z', 'm3 12 9 5 9-5', 'm3 17 9 5 9-5'],
  trophy: ['M7 4h10v5a5 5 0 0 1-10 0Z', 'M7 6H4v1a4 4 0 0 0 3 3.9M17 6h3v1a4 4 0 0 1-3 3.9', 'M9 20h6M12 14v6'],
  brain: ['M9.5 4a3 3 0 0 0-3 3 3 3 0 0 0-1.5 5.5A3 3 0 0 0 8 18a3 3 0 0 0 4 2V4.5A2.5 2.5 0 0 0 9.5 4Z', 'M14.5 4a3 3 0 0 1 3 3 3 3 0 0 1 1.5 5.5A3 3 0 0 1 16 18a3 3 0 0 1-4 2'],
  download: ['M12 3v12', 'm7 11 5 5 5-5', 'M4 21h16'],
  filter: ['M3 5h18l-7 8v6l-4-2v-4Z'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7v5l3.5 2'],
  zap: ['m13 2-9 12h7l-1 8 9-12h-7Z'],
  route: ['M6 19a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm12-10a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z', 'M15 6h-3a3 3 0 0 0-3 3v.5', 'M9 16.5h3a3 3 0 0 0 3-3V9'],
  external: ['M14 4h6v6', 'M20 4 11 13', 'M18 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5'],
  lock: ['M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z', 'M8 11V8a4 4 0 0 1 8 0v3', 'M12 15v2']
}
const props = withDefaults(defineProps<{ name: string; size?: number | string; stroke?: number }>(), { size: 18, stroke: 1.7 })

/**
 * 直接给 <svg> 生成本身 innerHTML 会踩 Vue 模板解析坑（属性值里的 < 与引号转义），
 * 因此在 script 里算好 path 串；用 <g> 承载，颜色靠 currentColor 继承。
 */
const inner = computed(() => {
  const list = P[props.name] ?? []
  return list.map((d) => `<path d="${esc(d)}"/>`).join('')
})
function esc(s: string): string {
  return s.replace(/"/g, '&quot;')
}
</script>

<template>
  <svg
    class="ic"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="stroke"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <g v-html="inner" />
  </svg>
</template>

<style scoped>
.ic { display: inline-block; vertical-align: -3px; flex: 0 0 auto }
</style>
