<script setup lang="ts">
import { computed } from 'vue'
import type { EndpointConfig } from '@shared/types'
import Icon from './Icon.vue'

const props = defineProps<{
  ep: EndpointConfig
  busy?: boolean
  health?: { ok: boolean; message: string } | null
}>()
const emit = defineEmits<{ (e: 'test'): void; (e: 'remove'): void }>()

const roleOpts = [
  { value: 'fast', label: '快模型（讲评/追问/答疑）' },
  { value: 'strong', label: '强模型（判分/组卷/题库更新）' },
  { value: 'any', label: '通用' }
]
const setField = (k: keyof EndpointConfig, v: any) => { (props.ep as any)[k] = v }

/** 纯展示：本机正在测、或 store 批量测试写入的「测试中…」都算进行中，不冒充失败 */
const pending = computed(() => !!props.busy || /测试中|检测中/.test(props.health?.message ?? ''))
</script>

<template>
  <!-- 观感与可达性重构：props / emits / setField 契约与 IPC 调用一字未改 -->
  <section class="card flat ep rise" :class="{ off: ep.enabled === false }" :aria-label="'端点 ' + (ep.label || '未命名')">
    <div class="ep-head">
      <span class="ep-dot-wrap" :title="pending ? '正在测试连通' : health ? (health.ok ? '连通正常' : '连通失败') : '尚未测试'"
        :aria-label="pending ? '正在测试连通' : health ? (health.ok ? '连通正常' : '连通失败') : '尚未测试'">
        <span class="dotmark ep-dot" :class="[pending ? 'idle' : health?.ok ? 'ok' : 'bad', { pulse: pending }]" />
      </span>

      <n-switch class="shrink" :value="ep.enabled !== false" size="small" aria-label="启用该端点"
        @update:value="(v: boolean) => setField('enabled', v)" />
      <n-input class="ep-label" :value="ep.label" size="small" placeholder="名称" aria-label="端点名称"
        @update:value="(v: string) => setField('label', v)" />
      <n-select class="ep-role" :value="ep.role" size="small" aria-label="该端点承担的角色" :options="roleOpts"
        @update:value="(v: 'fast' | 'strong' | 'any') => setField('role', v)" />
      <n-checkbox class="shrink" :checked="!!ep.local" size="small" aria-label="标记为本机端点"
        @update:checked="(v: boolean) => setField('local', v)">本机端点（也保留 key 槽）</n-checkbox>

      <span class="grow" />
      <span class="row ep-acts">
        <n-button size="small" :loading="!!busy" :disabled="!!busy" @click="emit('test')">
          <template #icon><Icon name="zap" :size="14" /></template>
          {{ busy ? '测试中…' : '测试连通' }}
        </n-button>
        <n-button size="small" quaternary type="error" :disabled="!!busy" @click="emit('remove')">删除</n-button>
      </span>
    </div>

    <div class="grid g2 ep-fields">
      <label class="fld">
        <span class="fld-l">Base URL</span>
        <n-input :value="ep.baseUrl" size="small" placeholder="https://api.deepseek.com/v1" aria-label="Base URL"
          @update:value="(v: string) => setField('baseUrl', v)" />
      </label>
      <label class="fld">
        <span class="fld-l">模型名</span>
        <n-input :value="ep.model" size="small" placeholder="deepseek-chat" aria-label="模型名"
          @update:value="(v: string) => setField('model', v)" />
      </label>
      <label class="fld">
        <span class="fld-l">API Key（留空走环境变量）</span>
        <n-input :value="ep.apiKey" size="small" type="password" show-password-on="click" placeholder="sk-…"
          aria-label="API Key" @update:value="(v: string) => setField('apiKey', v)" />
      </label>
      <div class="fld">
        <span class="fld-l">采样参数</span>
        <div class="row ep-nums">
          <span class="micro faint">temperature</span>
          <n-input-number class="num" :value="ep.temperature" size="tiny" :min="0" :max="2" :step="0.1"
            aria-label="temperature" @update:value="(v: number | null) => setField('temperature', v)" />
          <span class="micro faint">maxTokens</span>
          <n-input-number class="num" :value="ep.maxTokens" size="tiny" :min="256" :max="16000" :step="256"
            placeholder="留空按端点默认" clearable
            aria-label="maxTokens" @update:value="(v: number | null) => setField('maxTokens', v)" />
        </div>
      </div>
    </div>

    <div v-if="health" class="fb ep-fb" :class="pending ? '' : health.ok ? 'ok' : 'bad'" role="status" aria-live="polite">
      <h4>
        <Icon :name="pending ? 'refresh' : health.ok ? 'check' : 'alert'" :size="14" :class="{ spin: pending }"
        />{{ pending ? '正在测试连通…' : health.ok ? '连通正常' : '连通失败' }}</h4>
      <div class="tiny muted wrap-any">{{ health.message }}</div>
    </div>
  </section>
</template>

<style scoped>
/* 卡片态：未启用的端点降饱和而不是降对比，避免深色下文字发灰读不清 */
.ep { display: flex; flex-direction: column; gap: var(--sp-3); margin-bottom: var(--sp-3) }
.ep.off { background: var(--surface-2) }
.ep.off .ep-head { opacity: .58 }
.ep.off::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 3px; border-radius: var(--r-lg) 0 0 var(--r-lg); background: var(--text-faint) }

.ep-head { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap }
.ep-dot-wrap { display: inline-flex; align-items: center; padding: var(--sp-1); margin-left: calc(var(--sp-1) * -1) }
.ep-dot.ok { background: var(--ok) }
.ep-dot.bad { background: var(--bad) }
.ep-dot.idle { background: var(--text-faint) }
.ep-dot.pulse { animation: pulse 1.2s var(--ease-in-out) infinite }

.ep-label { flex: 1 1 132px; max-width: 190px }
.ep-role { flex: 1 1 190px; max-width: 230px }
.ep-acts { gap: var(--sp-1); flex: 0 0 auto }
/* 命中区：naive small 已 30px，这里兜底保证 ≥28px 且 hover/focus 明确 */
.ep-acts :deep(.n-button) { min-height: 28px; transition: transform var(--dur-fast) var(--spring), box-shadow var(--dur-fast), border-color var(--dur-fast) }
.ep-acts :deep(.n-button:not(.n-button--disabled):hover) { transform: translateY(-1px) }
.ep-acts :deep(.n-button:focus-visible) { box-shadow: var(--ring-soft) }

/* 字段栅格：label 在上、控件在下，窄窗自动单列（继承 .grid.g2 的 auto-fit） */
.ep-fields { gap: var(--sp-3) }
.fld { display: flex; flex-direction: column; gap: var(--sp-1); min-width: 0 }
.fld-l { font-size: var(--fs-xs); color: var(--text-faint); font-weight: 600; letter-spacing: .02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
.ep-nums { gap: var(--sp-2); flex-wrap: wrap }
.ep-nums :deep(.n-input-number) { font-variant-numeric: tabular-nums }

.ep-fb { margin-top: 0 }
.ep-fb h4 { font-size: var(--fs-sm) }
.ep-fb .spin { animation: ep-spin 1.1s linear infinite }
@keyframes ep-spin { to { transform: rotate(360deg) } }

@media (max-width: 720px) {
  .ep-role, .ep-label { max-width: none }
  .ep-acts { flex: 1 1 100%; justify-content: flex-end }
}
</style>
