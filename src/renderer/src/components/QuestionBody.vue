<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Question } from '@shared/types'
import { renderMd, renderInline, TYPE_LABEL } from '../lib/ui'

const props = defineProps<{
  q: Question
  modelValue: any
  revealed?: boolean
  disabled?: boolean
  showReference?: boolean
}>()
const emit = defineEmits<{ (e: 'update:modelValue', v: any): void; (e: 'submit'): void }>()

const sel = computed<string[]>(() => {
  const a = props.modelValue
  if (!a) return []
  if (Array.isArray(a.keys)) return a.keys
  return []
})
const blanks = computed<string[]>(() => {
  const n = props.q.answer?.blanks?.length ?? 1
  const given = Array.isArray(props.modelValue?.blanks) ? props.modelValue.blanks : []
  return Array.from({ length: n }, (_, i) => String(given[i] ?? ''))
})
const textVal = computed<string>(() => String(props.modelValue?.text ?? ''))
const codeVal = computed<string>(() => String(props.modelValue?.code ?? ''))
const judgeVal = computed<boolean | null>(() => (typeof props.modelValue?.judge === 'boolean' ? props.modelValue.judge : null))

const isObjChoice = computed(() => props.q.type === 'single' || props.q.type === 'multiple')
const charCount = computed(() => (props.q.type === 'short' || props.q.type === 'essay' ? textVal.value.replace(/\s/g, '').length : 0))
const suggestMin = computed(() => (props.q.type === 'short' ? 60 : 200))

function pick(key: string) {
  if (props.disabled) return
  if (props.q.type === 'single') return emit('update:modelValue', { keys: [key] })
  const next = sel.value.includes(key) ? sel.value.filter((k) => k !== key) : [...sel.value, key]
  emit('update:modelValue', { keys: next.sort() })
}
function setBlank(i: number, v: string) {
  const next = blanks.value.slice()
  next[i] = v
  emit('update:modelValue', { blanks: next })
}
function onCodeKey(e: KeyboardEvent) {
  const ta = e.target as HTMLTextAreaElement
  if (e.key === 'Tab') {
    e.preventDefault()
    const s = ta.selectionStart, en = ta.selectionEnd
    ta.value = `${ta.value.slice(0, s)}  ${ta.value.slice(en)}`
    ta.selectionStart = ta.selectionEnd = s + 2
    emit('update:modelValue', { code: ta.value, lang: props.modelValue?.lang ?? 'javascript' })
  }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) emit('submit')
}
const lang = ref('javascript')
watch(() => props.q.id, () => { lang.value = 'javascript' })

const refAnswerHtml = computed(() => {
  const parts: string[] = []
  if (props.q.answer?.ref) parts.push(String(props.q.answer.ref))
  if (props.q.answer?.code) parts.push('```js\n' + String(props.q.answer.code) + '\n```')
  if (props.q.type === 'blank') parts.push('逐空标准答案：' + (props.q.answer?.blanks ?? []).map((b, i) => `(${i + 1}) \`${b}\``).join('　'))
  if (['single', 'multiple'].includes(props.q.type)) parts.push(`正确答案：**${(props.q.answer?.keys ?? []).join('')}**`)
  if (props.q.type === 'judge') parts.push(`正确判断：**${props.q.answer?.judge ? '对' : '错'}**`)
  return renderMd(parts.join('\n\n'))
})
</script>

<template>
  <div class="stem" v-html="renderMd(q.stem)" />

  <div style="margin-top:14px">
    <!-- 单选 / 多选 -->
    <template v-if="isObjChoice">
      <div v-for="o in q.options" :key="o.key" class="opt"
        :class="{ sel: sel.includes(o.key), right: revealed && q.answer?.keys?.includes(o.key), wrong: revealed && sel.includes(o.key) && !q.answer?.keys?.includes(o.key) }"
        @click="pick(o.key)">
        <span class="key">{{ o.key }}.</span>
        <span class="txt" v-html="renderInline(o.text)" />
        <span v-if="revealed && q.answer?.keys?.includes(o.key)" class="pill ok">正确</span>
        <span v-else-if="revealed && sel.includes(o.key)" class="pill bad">你选的</span>
      </div>
    </template>

    <!-- 判断 -->
    <div v-else-if="q.type === 'judge'" class="row">
      <n-button v-for="opt in [{ v: true, t: '✓ 说法正确' }, { v: false, t: '✗ 说法错误' }]" :key="String(opt.v)"
        size="large" :type="judgeVal === opt.v ? 'primary' : 'default'" :disabled="disabled"
        @click="!disabled && emit('update:modelValue', { judge: opt.v })" style="min-width:150px">
        {{ opt.t }}
      </n-button>
      <span v-if="revealed" class="pill" :class="judgeVal === q.answer?.judge ? 'ok' : 'bad'">
        标准答案：{{ q.answer?.judge ? '对' : '错' }}
      </span>
    </div>

    <!-- 填空 -->
    <div v-else-if="q.type === 'blank'" class="grid" style="gap:10px">
      <div v-for="(b, i) in blanks" :key="i" class="row" style="gap:8px">
        <span class="muted tiny" style="min-width:34px">第{{ i + 1 }}空</span>
        <input class="code-area" style="min-height:auto;padding:9px 12px" :disabled="disabled" :value="b"
          :placeholder="revealed ? '' : '填写关键术语/参数名/命令'" @input="setBlank(i, ($event.target as HTMLInputElement).value)" />
        <span v-if="revealed" class="tiny" style="color:var(--ok)">{{ q.answer?.blanks?.[i] }}</span>
      </div>
    </div>

    <!-- 简答 / 论述 -->
    <div v-else-if="q.type === 'short' || q.type === 'essay'">
      <textarea class="code-area" style="min-height:190px;font-family:inherit" :disabled="disabled" :value="textVal"
        :placeholder="q.type === 'short' ? '口述式作答：先给结论，再讲机制与因果，最后补一句边界或失败场景' : '论述作答：按「机制 → 取舍 → 数据佐证 → 失败路径」四段展开，写到能撑住两轮追问'"
        @input="emit('update:modelValue', { text: ($event.target as HTMLTextAreaElement).value })" />
      <div class="row tiny" style="margin-top:6px;color:var(--text-faint)">
        <span>{{ charCount }} 字</span>
        <span v-if="charCount < suggestMin" style="color:var(--warn)">建议至少 {{ suggestMin }} 字：面试答太短会被追问到卡住</span>
        <span v-else style="color:var(--ok)">字数够，注意结构是否完整</span>
        <span class="grow" />
        <span>Ctrl+Enter 提交</span>
      </div>
    </div>

    <!-- 编程 -->
    <div v-else-if="q.type === 'code'" class="grid" style="gap:8px">
      <div class="row tiny muted">
        <span>语言</span>
        <n-select v-model:value="lang" size="tiny" style="width:140px" :disabled="disabled"
          :options="[{ label: 'JavaScript', value: 'javascript' }, { label: 'TypeScript', value: 'typescript' }, { label: 'Python', value: 'python' }, { label: 'Java', value: 'java' }, { label: 'Vue 模板', value: 'vue' }, { label: 'SQL', value: 'sql' }, { label: 'Go', value: 'go' }]"
          @update:value="(v: string) => emit('update:modelValue', { code: codeVal, lang: v })" />
        <span>Tab 缩进已接管 · Ctrl+Enter 提交</span>
      </div>
      <textarea class="code-area" style="min-height:300px" :disabled="disabled" :value="codeVal" @keydown="onCodeKey"
        placeholder="// 在这里手写实现或修复代码&#10;// 写完自查三件事：边界输入、异常分支、复杂度"
        @input="emit('update:modelValue', { code: ($event.target as HTMLTextAreaElement).value, lang })" />
    </div>
  </div>

  <div v-if="revealed && showReference !== false && (q.answer?.ref || q.answer?.code || q.type === 'blank')" class="fb ok" style="margin-top:16px">
    <h4>✅ 参考答案</h4>
    <div class="md" v-html="refAnswerHtml" />
  </div>
</template>
