<script setup lang="ts">
/**
 * 轻量代码编辑器：语法高亮 + 行号槽 + Tab 缩进 + 自动继承缩进 + 当前行高亮。
 *
 * 高亮的实现方式是「叠层」：真正的输入仍然发生在 textarea 上，
 * 底下垫一层由 highlightCode 生成的 pre 节点，把 textarea 的文字设成透明。
 * 这样输入法、撤销/重做、系统复制粘贴全部保持浏览器原生行为，
 * 同时又能有 token 级着色。代价是两层必须逐像素对齐——所以字体、行高、
 * 内边距、空白处理全部走同一组 CSS 变量，滚动位置也由 textarea 单向驱动。
 *
 * 不引入 monaco / codemirror：关卡代码只有几十行，而重型编辑器会带来 worker、
 * 主题同步和首屏成本；教学场景里「一个页面立刻能打开」比自动补全更值钱。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { highlightCode } from '../lib/highlight'

const props = withDefaults(defineProps<{
  modelValue: string
  readonly?: boolean
  minHeight?: number
}>(), {
  readonly: false,
  minHeight: 320
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'run'): void
}>()

const ta = ref<HTMLTextAreaElement | null>(null)
const gutter = ref<HTMLElement | null>(null)

/**
 * 内部真值：输入时先写这里再向外 emit。
 * 不能只依赖 props 回写——受控 textarea 每次 input 都重设 value 会打断输入法组合，
 * 也会把光标顶回末尾。只有外部值真的不同时（重置/切关）才同步进来。
 */
const text = ref(props.modelValue)
const scrollTop = ref(0)
const scrollLeft = ref(0)
const caretLine = ref(1)
/** 选区覆盖的整行范围 [首行, 末行]，用于「选中整行」的淡底高亮 */
const selRange = ref<[number, number] | null>(null)

/** 与 textarea 的 13px × 1.65 对齐；挂载后按计算值校正，避免 subpixel 累积偏移 */
const lineH = ref(13 * 1.65)
const padTop = ref(10)

const lineCount = computed(() => Math.max(1, text.value.split('\n').length))
const lineNumbers = computed(() => Array.from({ length: lineCount.value }, (_, i) => i + 1))
/** 末尾补一个换行：让「最后一行为空」也占住一行高度，否则叠层比 textarea 少一行 */
const highlighted = computed(() => `${highlightCode(text.value, 'js')}\n`)

watch(() => props.modelValue, (v) => {
  if (v === text.value) return
  text.value = v
  void nextTick(() => {
    syncCaret()
    // 外部换了一整段代码（切关/重置）时回到顶部，行号与高亮不会停在旧位置
    if (ta.value) {
      ta.value.scrollTop = 0
      ta.value.scrollLeft = 0
      if (!props.readonly) ta.value.setSelectionRange(0, 0)
    }
    syncScroll()
  })
})

watch(lineCount, () => { void nextTick(syncCaret) })

function onInput(e: Event) {
  const el = e.target as HTMLTextAreaElement
  text.value = el.value
  emit('update:modelValue', el.value)
  syncCaret()
}

/** 把新全文写回内部状态，并同步 DOM 光标（Vue 的 patch 在微任务后，先手写避免闪一跳） */
function applyEdit(next: string, start: number, end = start) {
  const el = ta.value
  if (!el) return
  text.value = next
  emit('update:modelValue', next)
  el.value = next
  el.setSelectionRange(start, end)
  syncCaret()
}

function syncCaret() {
  const el = ta.value
  if (!el) return
  const pos = el.selectionStart
  caretLine.value = el.value.slice(0, pos).split('\n').length
  if (el.selectionEnd > el.selectionStart) {
    const start = el.value.slice(0, el.selectionStart).split('\n').length
    const end = el.value.slice(0, el.selectionEnd).split('\n').length
    selRange.value = [start, end]
  } else {
    selRange.value = null
  }
}

/**
 * 把 textarea 的滚动位置同步给「行号槽 + 高亮叠层」。
 * 三者的滚动是分离的：行号和高亮都不是 textarea 的子节点，
 * 只要有一处没跟上，用户看到的行号就会和代码错位（这是叠层方案唯一的坑）。
 */
function syncScroll() {
  const el = ta.value
  if (!el) return
  scrollTop.value = el.scrollTop
  scrollLeft.value = el.scrollLeft
  if (gutter.value) gutter.value.scrollTop = el.scrollTop
}

function onScroll() {
  syncScroll()
}

function onKeydown(e: KeyboardEvent) {
  if (e.isComposing) return
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    emit('run')
    return
  }
  if (props.readonly) return
  if (e.key === 'Tab') {
    e.preventDefault()
    handleTab(e.shiftKey)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    handleEnter()
  }
}

/**
 * Tab / Shift+Tab。
 * 无选区时 Tab 插两个空格；有选区时按整行缩进，退出时同样整行退格——
 * 块级缩进是写代码最常用的操作，逐字符插入会让用户放弃用 Tab。
 */
function handleTab(shift: boolean) {
  const el = ta.value
  if (!el) return
  const value = text.value
  const start = el.selectionStart
  const end = el.selectionEnd

  if (start === end && !shift) {
    applyEdit(value.slice(0, start) + '  ' + value.slice(start), start + 2)
    return
  }

  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  // 选区终点恰好落在下一行行首时，不该把下一行也算进块里
  const endProbe = end > start && value[end - 1] === '\n' ? end - 1 : end
  let lineEnd = value.indexOf('\n', endProbe)
  if (lineEnd === -1) lineEnd = value.length

  const lines = value.slice(lineStart, lineEnd).split('\n')
  let firstCut = 0
  let totalCut = 0
  const next = lines.map((line, i) => {
    if (!shift) return '  ' + line
    const tabCut = line.startsWith('\t') ? 1 : 0
    const spaceCut = tabCut ? 0 : line.startsWith('  ') ? 2 : line.startsWith(' ') ? 1 : 0
    const cut = tabCut || spaceCut
    if (i === 0) firstCut = cut
    totalCut += cut
    return line.slice(cut)
  }).join('\n')

  const newStart = shift ? Math.max(lineStart, start - firstCut) : start + 2
  const newEnd = shift ? Math.max(newStart, end - totalCut) : end + 2 * lines.length
  applyEdit(value.slice(0, lineStart) + next + value.slice(lineEnd), newStart, newEnd)
}

/**
 * Enter 自动缩进。
 * 三条规则合起来就是写代码的肌肉记忆：继承当前行缩进、开括号后多缩一级、
 * 空的 {} / () / [] 直接把光标夹在中间。不做这些，用户每行都要手敲空格。
 */
function handleEnter() {
  const el = ta.value
  if (!el) return
  const value = text.value
  const start = el.selectionStart
  const end = el.selectionEnd
  const before = value.slice(0, start)
  const after = value.slice(end)
  const lineStart = before.lastIndexOf('\n') + 1
  const lineText = before.slice(lineStart)
  const indent = /^[ \t]*/.exec(lineText)?.[0] ?? ''
  const trimmed = lineText.trimEnd()
  const prevChar = value[start - 1] ?? ''
  const nextChar = value[end] ?? ''
  const closer: Record<string, string> = { '{': '}', '(': ')', '[': ']' }

  let insert = `\n${indent}`
  let caretOffset = insert.length
  if (closer[prevChar] === nextChar) {
    // 光标正夹在一对空括号中间：换行后右括号留在下一行，光标停在缩进后的空行
    insert = `\n${indent}  \n${indent}`
    caretOffset = `\n${indent}  `.length
  } else if (/[{[(]$/.test(trimmed)) {
    insert = `\n${indent}  `
  }
  applyEdit(before + insert + after, start + caretOffset)
}

function focusEditor() {
  if (props.readonly) return
  if (document.activeElement !== ta.value) ta.value?.focus()
}

function bandStyle(line: number, count = 1) {
  return {
    top: `${padTop.value + (line - 1) * lineH.value}px`,
    height: `${Math.max(1, count) * lineH.value}px`
  }
}

/**
 * 把光标送到某个 TODO 那一行 —— 左栏「分步」卡片点一下就跳过来。
 * 找不到这个 TODO（比如用户已经把它删了或改写了）就静默不动，
 * 不能因为「讲解跟不上代码」而弹错误打断人。
 */
function focusTodo(todo: string) {
  const el = ta.value
  if (!el || !todo) return
  const needle = String(todo)
  const at = text.value.indexOf(needle)
  if (at < 0) return
  const line = text.value.slice(0, at).split('\n').length
  el.focus()
  el.setSelectionRange(at, at + needle.length)
  const viewH = el.clientHeight
  const target = Math.max(0, padTop.value + (line - 1) * lineH.value - viewH / 2)
  el.scrollTop = target
  onScroll()
  caretLine.value = line
}

defineExpose({ focusTodo })

onMounted(() => {
  const el = ta.value
  if (el) {
    const cs = getComputedStyle(el)
    const lh = Number.parseFloat(cs.lineHeight)
    const pt = Number.parseFloat(cs.paddingTop)
    if (Number.isFinite(lh) && lh > 0) lineH.value = lh
    if (Number.isFinite(pt) && pt >= 0) padTop.value = pt
    if (!props.readonly) {
      el.focus()
      // 受控赋值会把光标落在文末，focus 时浏览器会「滚动到光标」——于是编辑器一打开
      // 就停在最后一屏，行号和高亮也跟着错位。教学页面必须从头开始读，这里强制回顶部。
      el.setSelectionRange(0, 0)
    }
    el.scrollTop = 0
    el.scrollLeft = 0
    syncScroll()
  }
  syncCaret()
})
</script>

<template>
  <div class="ce" :class="{ 'is-ro': readonly }" :style="{ '--ce-lh': `${lineH}px` }">
    <!-- 行号槽：独立滚动容器，滚动位置由 textarea 的 scroll 事件驱动 -->
    <div ref="gutter" class="ce-gutter" aria-hidden="true">
      <div class="ce-lns">
        <span v-for="n in lineNumbers" :key="n" class="ce-ln" :class="{ cur: n === caretLine }">{{ n }}</span>
      </div>
    </div>

    <div class="ce-edit" @click="focusEditor">
      <!-- 行高亮叠层 + 语法高亮叠层：都在 textarea 下面，纯视觉、不接管鼠标事件 -->
      <div class="ce-overlay" aria-hidden="true">
        <div class="ce-bands" :style="{ transform: `translateY(${-scrollTop}px)` }">
          <span v-if="selRange" class="ce-band sel" :style="bandStyle(selRange[0], selRange[1] - selRange[0] + 1)" />
          <span class="ce-band cur" :style="bandStyle(caretLine)" />
        </div>
        <pre
          class="ce-hl"
          :style="{ transform: `translate(${-scrollLeft}px, ${-scrollTop}px)`, minHeight: `${minHeight}px` }"
          v-html="highlighted"
        />
      </div>
      <textarea
        ref="ta"
        class="ce-ta"
        :value="text"
        :readonly="readonly"
        :style="{ minHeight: `${minHeight}px` }"
        spellcheck="false"
        autocapitalize="off"
        autocomplete="off"
        wrap="off"
        aria-label="代码编辑器"
        @input="onInput"
        @scroll="onScroll"
        @keydown="onKeydown"
        @click="syncCaret"
        @keyup="syncCaret"
        @select="syncCaret"
        @focus="syncCaret"
      />
    </div>
  </div>
</template>

<style scoped>
.ce {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: stretch;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
  transition: border-color var(--dur-fast), box-shadow var(--dur-fast), background-color var(--dur-fast);
}
.ce:focus-within { border-color: var(--accent); box-shadow: var(--ring-soft) }
.ce.is-ro { background: var(--surface-2); border-color: var(--border) }

.ce-gutter {
  overflow: hidden;
  background: color-mix(in oklab, var(--surface-2) 82%, var(--surface));
  border-right: 1px solid var(--border);
  user-select: none;
}
.ce-lns { padding: 10px 0; min-width: 48px }
.ce-ln {
  display: block;
  height: var(--ce-lh);
  line-height: var(--ce-lh);
  padding: 0 12px 0 14px;
  text-align: right;
  font-family: ui-monospace, Consolas, "Cascadia Mono", monospace;
  font-size: 12px;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
  transition: color var(--dur-fast), background-color var(--dur-fast);
}
.ce-ln.cur { color: var(--accent-2); background: color-mix(in oklab, var(--accent) 9%, transparent) }
.ce.is-ro .ce-ln.cur { color: var(--text-dim); background: transparent }
.ce.is-ro .ce-band.cur { background: transparent }

.ce-edit { position: relative; min-width: 0; display: flex; flex-direction: column }
.ce-overlay { position: absolute; inset: 0; overflow: hidden; pointer-events: none }
.ce-bands { position: absolute; top: 0; left: 0; right: 0 }
.ce-band { position: absolute; left: 0; right: 0; display: block; border-radius: 2px }
.ce-band.cur { background: color-mix(in oklab, var(--accent) 7%, transparent) }
.ce-band.sel { background: color-mix(in oklab, var(--accent) 4%, transparent) }

/* 高亮层：与 textarea 的字号/行高/内边距/空白完全一致，否则会错行 */
.ce-hl {
  position: absolute;
  top: 0;
  left: 0;
  margin: 0;
  padding: 10px 14px;
  font-family: ui-monospace, Consolas, "Cascadia Mono", monospace;
  font-size: 13px;
  line-height: 1.65;
  tab-size: 2;
  white-space: pre;
  color: var(--text);
  will-change: transform;
}

.ce-ta {
  position: relative;
  display: block;
  width: 100%;
  flex: 1 1 auto;
  padding: 10px 14px;
  border: 0;
  background: transparent;
  /* 文字透明、光标保留：看到的是下面那层高亮，操作的仍是 textarea */
  color: transparent;
  caret-color: var(--accent);
  font-family: ui-monospace, Consolas, "Cascadia Mono", monospace;
  font-size: 13px;
  line-height: 1.65;
  tab-size: 2;
  white-space: pre;
  resize: vertical;
  outline: none;
  overflow: auto;
}
.ce-ta::selection { background: color-mix(in oklab, var(--accent) 26%, transparent); color: transparent }
.ce.is-ro .ce-ta { caret-color: transparent; cursor: default }
</style>