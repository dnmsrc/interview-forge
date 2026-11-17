<script setup lang="ts">
import { nextTick, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Icon from './Icon.vue'
import { renderMd } from '../lib/ui'
import { ipc } from '../lib/ipc'
import type { TutorPrereq, TutorTurn } from '@shared/types'

/**
 * R24 摸底「我不会」提交后的即时 AI 专项辅导。
 *
 * 背景：R23 只做到「把你写的原话判成缺口类型并落库」，用户提交后回到界面发现
 * 系统只回了句「已记录缺口」，没人给他讲 —— 记录是记录，学习闭环缺了「当场解答」。
 * 做法：提交缺口后本组件立刻把用户原话当作第一问发给 tutor（作用域护栏、零基础从前置讲起
 * 都由服务端做），答案就地渲染；同时给「本考点讲义」「去补前置」两个入口，让用户能直接去看知识点。
 *
 * 组件自包含：不落库、不缓存（对话本就只活在本轮界面里），切题即销毁重建。
 */
const props = withDefaults(defineProps<{
  nodeId: string
  nodeTitle?: string | null
  questionId?: string | null
  /** 首问内容（通常是用户提交的那句「我不会」原话）；变化时会自动开讲 */
  seedAsk?: string | null
}>(), { nodeTitle: null, questionId: null, seedAsk: null })

const router = useRouter()

const emit = defineEmits<{
  (e: 'open-knowledge', nodeId: string, nodeTitle: string | null): void
  (e: 'practice-node', nodeId: string, nodeTitle: string): void
}>()

interface Msg extends TutorTurn {
  id: number
  offTopic?: boolean
  prereq?: TutorPrereq | null
  meta?: string
  /** 该条答案由哪个模型产出：本地小模型 / 云端强档，决定是否显示「换云端重答」 */
  model?: string
}

const messages = ref<Msg[]>([])
const busy = ref(false)
const err = ref('')
const askText = ref('')
const scrollEl = ref<HTMLElement | null>(null)
let seq = 0
let seededKey = ''
/** 组件被切题销毁后，迟到的 AI 响应不要再写进新题的面板 */
let alive = true
onUnmounted(() => { alive = false })

const CHIPS = [
  { label: '我零基础，从头讲', ask: '我完全没接触过这块，相关术语都看不懂，请从最基础的前置知识一步步讲起' },
  { label: '再简单点', ask: '还是没太懂，用更通俗的话讲，少用术语，尽量短' },
  { label: '举个例子', ask: '给我一个最小可运行的例子，逐行解释，别太长' },
  { label: '该先学什么', ask: '以我现在的水平，应该先补哪个前置知识点？帮我理一条学习顺序' }
]

function scrollToBottom() {
  nextTick(() => {
    const el = scrollEl.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

/** 发送一轮：历史只回传 role/content，UI 态（offTopic/prereq/meta）不上送 */
async function send(raw?: string) {
  const question = (raw ?? askText.value).trim()
  if (!props.nodeId || !question || busy.value) return
  const history: TutorTurn[] = messages.value.map((m) => ({ role: m.role, content: m.content }))
  messages.value.push({ id: ++seq, role: 'user', content: question })
  askText.value = ''
  busy.value = true
  err.value = ''
  scrollToBottom()
  try {
    const r = await ipc.explain.tutor(props.nodeId, question, history, { questionId: props.questionId ?? null })
    if (!alive) return
    if ('error' in r) {
      err.value = r.message || '尚未配置可用的 AI 端点，先到设置页加一个再回来'
      messages.value.pop()
      askText.value = question
      return
    }
    messages.value.push({
      id: ++seq, role: 'assistant', content: r.answer_md,
      offTopic: r.offTopic, prereq: r.suggestPrereq,
      model: r.model,
      meta: `${r.model} · ${r.tokens} tokens · ${(r.ms / 1000).toFixed(1)}s`
    })
    scrollToBottom()
  } catch (e: any) {
    if (!alive) return
    err.value = `AI 讲解失败：${String(e?.message ?? e).slice(0, 120)}`
    messages.value.pop()
    askText.value = question
  } finally {
    if (alive) busy.value = false
  }
}

const onSend = () => { void send() }
const sendChip = (c: { ask: string }) => { void send(c.ask) }

/** 本地小模型答得不满意：把这轮提问交给云端强档重答，就地替换该条答案（不新增消息） */
const isLocalAnswer = (m: Msg) => !!m.model && !/^deepseek/i.test(m.model) && /qwen|tutor/i.test(m.model)
async function upgradeToCloud(m: Msg) {
  if (busy.value || !props.nodeId) return
  const idx = messages.value.findIndex((x) => x.id === m.id)
  if (idx < 0) return
  // 这条答案对应的提问（往前找第一条 user），以及它之前的上下文
  let u = idx - 1
  while (u >= 0 && messages.value[u].role !== 'user') u--
  if (u < 0) return
  const question = messages.value[u].content
  const history: TutorTurn[] = messages.value.slice(0, u).map((x) => ({ role: x.role, content: x.content }))
  busy.value = true
  err.value = ''
  try {
    const r = await ipc.explain.tutor(props.nodeId, question, history, { questionId: props.questionId ?? null, role: 'strong' })
    if (!alive) return
    if ('error' in r) { err.value = r.message || '云端端点不可用，请到设置页检查强档端点'; return }
    messages.value.splice(idx, 1, {
      ...m, content: r.answer_md, offTopic: r.offTopic, prereq: r.suggestPrereq,
      model: r.model, meta: `云端兜底 · ${r.model} · ${r.tokens} tokens · ${(r.ms / 1000).toFixed(1)}s`
    })
  } catch (e: any) {
    if (alive) err.value = `换云端重答失败：${String(e?.message ?? e).slice(0, 120)}`
  } finally {
    if (alive) busy.value = false
  }
}

function openKnowledge() {
  if (!props.nodeId) return
  emit('open-knowledge', props.nodeId, props.nodeTitle)
}
function openPrereq(p: TutorPrereq) {
  emit('open-knowledge', p.id, p.title)
}
function practicePrereq(p: TutorPrereq) {
  emit('practice-node', p.id, p.title)
}

/**
 * 首问：seedAsk 一到位就自动开讲，用户不用再重复打字。
 * 切题/换题时（nodeId 变化）清空上一题的对话，避免串台。
 */
watch(
  () => [props.nodeId, props.seedAsk] as const,
  ([nodeId, seed]) => {
    if (!nodeId) return
    const key = `${nodeId}::${seed ?? ''}`
    if (!seed || key === seededKey) return
    seededKey = key
    messages.value = []
    err.value = ''
    void send(seed)
  },
  { immediate: true }
)

/** AI 没端点时给出可操作的下一步，别让用户只看到一串报错 */
function goSettings() { void router.push('/settings') }
</script>

<template>
  <section class="gap-tutor" data-testid="pl-gap-tutor">
    <div class="gt-head">
      <span class="gt-badge"><Icon name="brain" :size="17" /></span>
      <div class="gt-title">
        <b>AI 专门讲这一题</b>
        <span class="micro faint">按你刚才的描述、从你现在这个水平能听懂的地方讲起，只讲与本考点相关的内容</span>
      </div>
      <button v-if="nodeId" type="button" class="gt-know" data-testid="pl-gap-tutor-know" @click="openKnowledge">
        <Icon name="book" :size="13" /> 看本考点讲义
      </button>
    </div>

    <div ref="scrollEl" class="gt-scroll" data-testid="pl-gap-tutor-scroll">
      <template v-for="m in messages" :key="m.id">
        <div v-if="m.role === 'user'" class="gt-user">
          <span class="gt-user-tag">你的疑问</span>
          <span class="gt-user-text">{{ m.content }}</span>
        </div>
        <div v-else class="gt-answer" data-testid="pl-gap-tutor-answer">
          <p v-if="m.offTopic" class="gt-offtopic tiny">
            <Icon name="alert" :size="12" /> 这轮提问和当前考点关系不大，AI 已把它拉回本题
          </p>
          <div class="md gt-md" v-html="renderMd(m.content)" />
          <p v-if="m.meta" class="micro faint gt-meta">
            {{ m.meta }}
            <!-- 本地小模型是默认，云端是兜底：不满意时一键交给强档端点重讲这一问 -->
            <button v-if="!busy && isLocalAnswer(m)" type="button" class="gt-cloud" data-testid="pl-gap-tutor-cloud" @click="upgradeToCloud(m)">
              不满意？换云端重答
            </button>
          </p>
          <!-- 私教点名要先补的前置：直接给「看讲义 / 去练」两个台阶，不让用户自己再找 -->
          <div v-if="m.prereq" class="gt-prereq" data-testid="pl-gap-tutor-prereq">
            <span class="tiny"><Icon name="route" :size="13" />
              建议先补前置：<b>{{ m.prereq.title }}</b><template v-if="!m.prereq.lit">（你还没学过，正好从它开始）</template>
            </span>
            <span class="gt-prereq-acts">
              <button type="button" class="gt-mini" @click="openPrereq(m.prereq!)">
                <Icon name="book" :size="12" /> 看它的讲义
              </button>
              <button type="button" class="gt-mini primary" data-testid="pl-gap-tutor-practice" @click="practicePrereq(m.prereq!)">
                <Icon name="play" :size="12" /> 去练这个基础点
              </button>
            </span>
          </div>
        </div>
      </template>
      <div v-if="busy" class="gt-typing" data-testid="pl-gap-tutor-busy">
        <span class="gt-dots"><i></i><i></i><i></i></span>
        <span class="micro faint">AI 正在按你的描述准备讲解…</span>
      </div>
    </div>

    <p v-if="err" class="gt-err tiny" data-testid="pl-gap-tutor-err">
      <Icon name="alert" :size="13" /> {{ err }}
      <button type="button" class="gt-link" @click="goSettings">去设置端点</button>
    </p>

    <div class="gt-chips">
      <button v-for="(c, i) in CHIPS" :key="i" type="button" class="gt-chip"
        :disabled="busy" :title="c.ask" @click="sendChip(c)">{{ c.label }}</button>
    </div>
    <div class="gt-input">
      <n-input v-model:value="askText" size="small" type="textarea" :autosize="{ minRows: 1, maxRows: 3 }"
        :disabled="busy" placeholder="还没懂？继续追问（只聊本题相关的内容），回车发送"
        @keydown.enter.exact.prevent="onSend" />
      <n-button size="small" type="primary" :loading="busy" :disabled="!askText.trim() || busy"
        data-testid="pl-gap-tutor-send" @click="onSend">
        追问
      </n-button>
    </div>
    <p class="micro faint gt-scope">
      <Icon name="lock" :size="11" /> 只讲解与「{{ nodeTitle || nodeId }}」相关的内容，闲聊与无关问题会被拉回正题
    </p>
  </section>
</template>

<style scoped>
.gap-tutor {
  margin-top: var(--sp-4); padding: var(--sp-4);
  border: 1px solid color-mix(in oklab, var(--purple) 32%, var(--border));
  border-left: 3px solid var(--purple);
  border-radius: var(--r-lg);
  background: color-mix(in oklab, var(--purple) 6%, var(--surface));
}
.gt-head { display: flex; align-items: flex-start; gap: 10px; flex-wrap: wrap }
.gt-badge {
  display: grid; place-items: center; width: 28px; height: 28px; flex: none;
  border-radius: 50%; color: var(--purple);
  background: color-mix(in oklab, var(--purple) 16%, transparent);
}
.gt-title { flex: 1; min-width: 180px; display: flex; flex-direction: column; gap: 2px }
.gt-title b { font-size: 14px }
.gt-know {
  display: inline-flex; align-items: center; gap: 5px; flex: none;
  padding: 6px 10px; border: 1px solid var(--border); border-radius: var(--r-md);
  background: var(--surface); color: var(--text); font: inherit; font-size: 12px; cursor: pointer;
  transition: border-color var(--dur-fast), color var(--dur-fast);
}
.gt-know:hover { border-color: var(--purple); color: var(--purple) }
.gt-scroll { max-height: 340px; overflow-y: auto; margin-top: var(--sp-3); display: flex; flex-direction: column; gap: 10px }
.gt-user {
  align-self: flex-end; max-width: 92%; display: flex; gap: 8px; align-items: baseline;
  padding: 8px 11px; border-radius: var(--r-md);
  background: color-mix(in oklab, var(--accent) 10%, transparent);
  border: 1px solid color-mix(in oklab, var(--accent) 22%, transparent);
}
.gt-user-tag { flex: none; font-size: 11px; color: var(--accent); font-weight: 600 }
.gt-user-text { font-size: 12.5px; line-height: 1.6; white-space: pre-wrap; word-break: break-word }
.gt-answer {
  align-self: flex-start; max-width: 100%; padding: 10px 12px; border-radius: var(--r-md);
  background: var(--surface); border: 1px solid var(--border);
}
.gt-md { font-size: 12.8px; line-height: 1.7 }
.gt-meta { margin: 6px 0 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap }
.gt-cloud {
  border: 1px solid color-mix(in oklab, var(--accent) 40%, var(--border)); border-radius: 999px;
  background: transparent; color: var(--accent); font: inherit; font-size: 11px; padding: 2px 9px;
  cursor: pointer; transition: background-color var(--dur-fast), border-color var(--dur-fast);
}
.gt-cloud:hover { background: color-mix(in oklab, var(--accent) 10%, transparent); border-color: var(--accent) }
.gt-offtopic { display: inline-flex; align-items: center; gap: 5px; margin: 0 0 8px; color: var(--warn) }
.gt-prereq {
  margin-top: 10px; padding: 9px 10px; border-radius: var(--r-md);
  border: 1px dashed color-mix(in oklab, var(--warn) 45%, var(--border));
  background: color-mix(in oklab, var(--warn) 8%, transparent);
  display: flex; flex-direction: column; gap: 7px;
}
.gt-prereq .tiny { color: var(--text) }
.gt-prereq-acts { display: flex; gap: 8px; flex-wrap: wrap }
.gt-mini {
  display: inline-flex; align-items: center; gap: 4px; padding: 4px 9px;
  font: inherit; font-size: 11.5px; cursor: pointer; border-radius: var(--r-sm);
  border: 1px solid var(--border); background: var(--surface); color: var(--text);
}
.gt-mini.primary { border-color: var(--accent); color: var(--accent) }
.gt-mini:hover { border-color: var(--purple); color: var(--purple) }
.gt-typing { display: flex; align-items: center; gap: 8px }
.gt-dots { display: inline-flex; gap: 3px }
.gt-dots i {
  width: 5px; height: 5px; border-radius: 50%; background: var(--purple);
  animation: gt-blink 1.1s infinite ease-in-out;
}
.gt-dots i:nth-child(2) { animation-delay: .18s }
.gt-dots i:nth-child(3) { animation-delay: .36s }
@keyframes gt-blink { 0%, 80%, 100% { opacity: .25; transform: translateY(0) } 40% { opacity: 1; transform: translateY(-2px) } }
.gt-err { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: var(--sp-3) 0 0; color: var(--warn) }
.gt-link {
  border: 0; background: none; padding: 0; font: inherit; font-size: 12px;
  color: var(--accent); cursor: pointer; text-decoration: underline;
}
.gt-chips { display: flex; flex-wrap: wrap; gap: 7px; margin-top: var(--sp-3) }
.gt-chip {
  padding: 5px 10px; border-radius: 999px; font: inherit; font-size: 11.5px; cursor: pointer;
  border: 1px solid var(--border); background: var(--surface); color: var(--text);
  transition: border-color var(--dur-fast), color var(--dur-fast);
}
.gt-chip:hover:not(:disabled) { border-color: var(--purple); color: var(--purple) }
.gt-chip:disabled { opacity: .5; cursor: not-allowed }
.gt-input { display: flex; gap: 8px; align-items: flex-end; margin-top: 10px }
.gt-input :deep(.n-input) { flex: 1 }
.gt-scope { display: flex; align-items: center; gap: 5px; margin: 8px 0 0 }
</style>
