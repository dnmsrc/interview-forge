<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import MarkdownIt from 'markdown-it'
import Icon from './Icon.vue'
import { renderMd, message } from '../lib/ui'
import { ipc } from '../lib/ipc'
import type { KnowledgeEntry, TutorTurn, TutorPrereq } from '@shared/types'

/**
 * 知识阅读抽屉（R9-② 重构 / R22 追问升级为受限多轮辅导）。
 * 设计原则：默认给「精简卡片」而不是整篇长文扑面——
 *   一句话本质 + 核心要点（自动从正文提取/截取）+ 私教对话；想看完整讲义再手动展开。
 * 纯受控：父组件用 v-model:open + nodeId 驱动；双链点击在内部维护返回栈。
 */
const props = defineProps<{ open: boolean; nodeId: string | null; nodeTitle?: string | null; questionId?: string | null }>()
const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'navigate', nodeId: string): void
  /** R22：私教建议回补前置 / 用户主动要练基础题，请求父页面切到指定考点去练 */
  (e: 'practice-node', nodeId: string, nodeTitle: string): void
}>()

/** 快捷问法：仍是降低提问门槛的入口，但现在发出的是多轮对话的第一/下一轮消息 */
interface Chip { label: string; ask: string }

const loading = ref(false)
const entry = ref<KnowledgeEntry | null>(null)
const backStack = ref<string[]>([])
const loadedId = ref('')
const askText = ref('')
/** 完整讲义默认收起，只在用户主动展开时渲染长文（R9-②） */
const showFull = ref(false)

/* ---- R22 受限多轮辅导对话状态 ---- */
interface ChatMsg extends TutorTurn {
  id: number
  offTopic?: boolean
  /** 该轮私教建议回补的前置（来自服务端与真实前置求交后的结果） */
  prereq?: TutorPrereq | null
  meta?: string
  /** 该条答案由哪个模型产出：本地小模型 / 云端强档，决定是否显示「换云端重答」 */
  model?: string
}
const messages = ref<ChatMsg[]>([])
const tutorBusy = ref(false)
const tutorError = ref('')
const scrollEl = ref<HTMLElement | null>(null)
let msgSeq = 0

const CHIPS_FALLBACK: Chip[] = [
  { label: '我零基础，从头讲', ask: '我完全没接触过这块，相关术语都看不懂，请从最基础的前置知识一步步讲起' },
  { label: '再简单点', ask: '还是没懂，用更通俗的话讲，少用术语，尽量短' },
  { label: '举个例子', ask: '给我一个最小可运行的例子，逐行解释，别太长' },
  { label: '五句话讲完', ask: '我时间紧，用五句话把最关键的讲完' },
  { label: '该先学什么', ask: '以我现在的水平，应该先补哪个前置知识点？帮我理一条学习顺序' }
]
const chips = ref<Chip[]>(CHIPS_FALLBACK)
ipc.explain.followups().then((f) => {
  // 旧 followups 带 style 字段，这里只取 label/ask 适配多轮对话；拉不到就用兜底
  if (!Array.isArray(f) || !f.length) return
  const served = f.map((x) => ({ label: x.label, ask: x.ask }))
  // 「零基础从头讲」是本功能的核心入口，服务旧配置里没有，始终置顶补齐并按 label 去重
  const zero = CHIPS_FALLBACK[0]
  const merged = [zero, ...served]
  const seen = new Set<string>()
  chips.value = merged.filter((c) => (seen.has(c.label) ? false : (seen.add(c.label), true)))
}).catch(() => { /* 用兜底 */ })

// 知识正文专用渲染器：在标准 markdown-it 上加 [[id]] / [[id|别名]] inline 规则。
const kbMd = new MarkdownIt({ html: false, linkify: true, breaks: true })
kbMd.inline.ruler.before('linkify', 'wikilink', (state, silent) => {
  if (state.src.charCodeAt(state.pos) !== 0x5b /* [ */) return false
  if (state.src.charCodeAt(state.pos + 1) !== 0x5b) return false
  const end = state.src.indexOf(']]', state.pos + 2)
  if (end < 0) return false
  const inner = state.src.slice(state.pos + 2, end)
  const bar = inner.indexOf('|')
  const id = (bar >= 0 ? inner.slice(0, bar) : inner).trim()
  const label = (bar >= 0 ? inner.slice(bar + 1) : inner).trim()
  if (!id) return false
  if (!silent) {
    const open = state.push('wikilink_open', 'a', 1)
    open.attrSet('href', 'javascript:void(0)')
    open.attrSet('class', 'wikilink')
    open.attrSet('data-wiki', id)
    const txt = state.push('text', '', 0)
    txt.content = label
    state.push('wikilink_close', 'a', -1)
  }
  state.pos = end + 2
  return true
})
const bodyHtml = computed(() => (entry.value?.bodyMd ? kbMd.render(entry.value.bodyMd) : ''))

/**
 * 精简要点：优先取正文里的「一句话本质」段，再从各 ## 小节抽取首个有信息量的句子，
 * 最多 5 条、每条压到 ~60 字，保证不把长文直接倒给用户。
 */
const briefPoints = computed<string[]>(() => {
  const md = entry.value?.bodyMd
  if (!md) return []
  const lines = md.split(/\r?\n/)
  const points: string[] = []
  // 一句话本质：找标题后第一段非空正文
  const essenceIdx = lines.findIndex((l) => /一句话本质|本质|概述|是什么/.test(l))
  if (essenceIdx >= 0) {
    const para = nextParagraph(lines, essenceIdx + 1)
    if (para) points.push(clip(para, 90))
  }
  // 各二级小节的首段（机制/为什么/区别等高价值段），跳过代码块和标题本身
  let inFence = false
  for (let i = 0; i < lines.length && points.length < 5; i++) {
    const l = lines[i]
    if (l.trim().startsWith('```')) { inFence = !inFence; continue }
    if (inFence) continue
    if (/^##\s+/.test(l)) {
      const para = nextParagraph(lines, i + 1)
      if (para && !points.some((p) => p.includes(para.slice(0, 20)))) points.push(clip(para, 80))
    }
  }
  return points.slice(0, 5)
})
function nextParagraph(lines: string[], start: number): string {
  for (let i = start; i < lines.length; i++) {
    const t = lines[i].trim()
    if (t && !t.startsWith('#') && !t.startsWith('```') && !t.startsWith('-') && !t.startsWith('|')) return t
  }
  return ''
}
function clip(s: string, n: number) {
  const clean = s.replace(/\*\*|`/g, '')
  return clean.length > n ? `${clean.slice(0, n)}…` : clean
}

async function load(id: string) {
  loading.value = true
  entry.value = null
  resetChat()
  showFull.value = false
  try {
    entry.value = await ipc.knowledge.get(id)
  } catch (e: any) {
    message.error(`读取知识失败：${String(e?.message ?? e).slice(0, 120)}`)
  } finally {
    loading.value = false
    loadedId.value = id
  }
}

/** 切换考点 / 首次打开：清空上一个考点的私教对话，避免跨考点串台 */
function resetChat() {
  messages.value = []
  askText.value = ''
  tutorError.value = ''
  tutorBusy.value = false
}

function scrollToBottom() {
  nextTick(() => {
    const el = scrollEl.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

/**
 * R22 发送一轮辅导：把历史对话回传给服务端（作用域护栏 + 前置引导都在服务端做）。
 * 对话只活在内存，不落库；空内容/忙碌中直接忽略。
 */
async function sendTutor(raw?: string) {
  const question = (raw ?? askText.value).trim()
  if (!props.nodeId || !question || tutorBusy.value) return
  // 历史只回传 user/assistant 文本，剥离 UI 态（offTopic/prereq/meta）
  const history: TutorTurn[] = messages.value.map((m) => ({ role: m.role, content: m.content }))
  messages.value.push({ id: ++msgSeq, role: 'user', content: question })
  askText.value = ''
  tutorBusy.value = true
  tutorError.value = ''
  scrollToBottom()
  try {
    const r = await ipc.explain.tutor(props.nodeId, question, history, { questionId: props.questionId ?? null })
    if ('error' in r) {
      tutorError.value = r.message || '尚未配置可用的 AI 端点，先去设置页加一个'
      // 端点缺失时把刚追加的用户问题撤回，允许用户配好后原样重发
      messages.value.pop()
      askText.value = question
      return
    }
    messages.value.push({
      id: ++msgSeq, role: 'assistant', content: r.answer_md,
      offTopic: r.offTopic, prereq: r.suggestPrereq,
      model: r.model,
      meta: `${r.model} · ${r.tokens} tokens · ${(r.ms / 1000).toFixed(1)}s`
    })
    scrollToBottom()
  } catch (e: any) {
    tutorError.value = `AI 辅导失败：${String(e?.message ?? e).slice(0, 120)}`
    messages.value.pop()
    askText.value = question
  } finally {
    tutorBusy.value = false
  }
}

const onSend = () => sendTutor()
const sendChip = (c: Chip) => sendTutor(c.ask)

/** 本地小模型答得不满意：把这轮提问交给云端强档重答，就地替换该条答案（不新增消息） */
const isLocalAnswer = (m: ChatMsg) => !!m.model && !/^deepseek/i.test(m.model) && /qwen|tutor/i.test(m.model)
async function upgradeToCloud(m: ChatMsg) {
  if (tutorBusy.value || !props.nodeId) return
  const idx = messages.value.findIndex((x) => x.id === m.id)
  if (idx < 0) return
  let u = idx - 1
  while (u >= 0 && messages.value[u].role !== 'user') u--
  if (u < 0) return
  const question = messages.value[u].content
  const history: TutorTurn[] = messages.value.slice(0, u).map((x) => ({ role: x.role, content: x.content }))
  tutorBusy.value = true
  tutorError.value = ''
  try {
    const r = await ipc.explain.tutor(props.nodeId, question, history, { questionId: props.questionId ?? null, role: 'strong' })
    if ('error' in r) { tutorError.value = r.message || '云端端点不可用，请到设置页检查强档端点'; return }
    messages.value.splice(idx, 1, {
      ...m, content: r.answer_md, offTopic: r.offTopic, prereq: r.suggestPrereq,
      model: r.model, meta: `云端兜底 · ${r.model} · ${r.tokens} tokens · ${(r.ms / 1000).toFixed(1)}s`
    })
  } catch (e: any) {
    tutorError.value = `换云端重答失败：${String(e?.message ?? e).slice(0, 120)}`
  } finally {
    tutorBusy.value = false
  }
}

/** 跟着私教的建议走：跳到前置考点的讲义（抽屉内导航，保留返回栈） */
function openPrereq(id: string) {
  if (!props.nodeId || id === props.nodeId) return
  backStack.value.push(props.nodeId)
  showFull.value = false
  emit('navigate', id)
}

/** 不想只看讲解，直接退到前置考点去练更基础的题（交给父页面组卷） */
function practicePrereq(p: TutorPrereq) {
  emit('practice-node', p.id, p.title)
}

watch(() => [props.open, props.nodeId] as const, ([open, id]) => {
  if (!open || !id) return
  if (id === loadedId.value && entry.value) return
  load(id)
}, { immediate: true })

function close() { emit('update:open', false) }

function onBodyClick(ev: MouseEvent) {
  const a = (ev.target as HTMLElement).closest('a.wikilink') as HTMLAnchorElement | null
  if (!a) return
  const target = a.dataset.wiki
  if (!target || target === props.nodeId) return
  if (props.nodeId) backStack.value.push(props.nodeId)
  showFull.value = false
  emit('navigate', target)
}
function goBack() {
  const prev = backStack.value.pop()
  if (prev) { showFull.value = false; emit('navigate', prev) }
}

/* ---- AI 生成讲义：未收录考点的一键补齐入口（管道 = kb-draft-core） ---- */
const genBusy = ref(false)
const genNote = ref('')
const GEN_NOTE: Record<string, string> = {
  stale: 'AI 已起草但没过八小节质量闸门（草稿已存隔离区，可重跑）',
  'no-official': '暂未匹配到官方文档来源，为保证可溯源没有入库',
  'fetch-thin': '来源正文抓取不足（少于 2 篇），没有起草',
  'skip-exists': '讲义文件已存在（可能尚未同步进索引，可在题库页点同步）',
  'no-endpoint': '未配置可用 AI 端点，请先到设置页添加',
  error: '生成过程出错'
}
async function generateLecture() {
  if (!props.nodeId || genBusy.value) return
  genBusy.value = true
  genNote.value = ''
  message.info('AI 正在抓官方源并起草讲义，本机模型约需 2-4 分钟…')
  try {
    const r = await ipc.knowledge.generate(props.nodeId)
    if (r.status === 'written') {
      message.success('讲义已生成并入索引')
      await load(props.nodeId)
    } else {
      genNote.value = `${GEN_NOTE[r.status] ?? r.status}${r.flags?.length ? `：${r.flags.join('；')}` : ''}${r.error ? `：${r.error}` : ''}`
    }
  } catch (e: any) {
    message.error(`生成失败：${String(e?.message ?? e).slice(0, 140)}`)
  } finally {
    genBusy.value = false
  }
}

const sourceKindLabel: Record<string, string> = { official: '官方', source: '源码', doc: '文档', article: '整理' }
</script>

<template>
  <aside v-if="open" class="kb-drawer" data-testid="knowledge-drawer">
    <header class="panel-head kb-head">
      <button v-if="backStack.length" class="icon-btn" title="返回上一个知识点" @click="goBack"><Icon name="chevron" :size="16" style="transform: rotate(180deg)" /></button>
      <h3 class="ellip">{{ entry?.title ?? nodeTitle ?? '知识点' }}</h3>
      <span class="grow" />
      <button class="icon-btn" data-testid="knowledge-drawer-close" title="关闭" aria-label="关闭" @click="close">
        <Icon name="close" :size="16" />
      </button>
    </header>

    <div v-if="loading" class="kb-loading tiny faint">正在载入知识正文…</div>

    <template v-else-if="entry">
      <!-- 未收录：给出可操作的补齐入口，而不是让用户去跑外部脚本 -->
      <div v-if="entry.missing" class="kb-card warn">
        <h4>尚未收录这个考点的讲义</h4>
        <p class="tiny">可让 AI 现在抓取官方文档并起草（八小节结构 + 质量闸门，来源可溯源）；也可以直接在下方问 AI。</p>
        <n-button size="small" type="primary" :loading="genBusy" data-testid="kb-generate" style="margin-top:10px" @click="generateLecture">
          <template #icon><Icon name="sparkles" :size="13" /></template>
          {{ genBusy ? 'AI 起草中（约 2-4 分钟）…' : 'AI 生成讲义' }}
        </n-button>
        <p v-if="genNote" class="tiny faint" style="margin-top:8px">{{ genNote }}</p>
      </div>

      <template v-else>
        <!-- 元信息：收成一行小标签，不抢注意力 -->
        <div class="kb-meta tiny faint">
          <span class="tag" :class="entry.confidence === 'high' ? 'ok' : 'warn'">置信度 {{ entry.confidence }}</span>
          <span v-if="entry.reviewed" class="tag info">已复核</span>
          <span>{{ entry.wordCount }} 字</span>
          <span v-if="entry.updatedAt">· {{ String(entry.updatedAt).slice(0, 10) }}</span>
        </div>

        <!-- ① 精简卡片：默认主视图，长文不直接倒给用户 -->
        <section class="kb-brief">
          <div class="brief-title"><Icon name="zap" :size="14" /> 一分钟看懂</div>
          <ul v-if="briefPoints.length" class="brief-list">
            <li v-for="(p, i) in briefPoints" :key="i">{{ p }}</li>
          </ul>
          <p v-else class="tiny faint">暂无提炼要点，可展开完整讲义或直接向 AI 提问。</p>
        </section>

        <!-- ③ 完整讲义：默认折叠，主动展开才渲染长文 -->
        <details class="kb-full" :open="showFull" @toggle="showFull = ($event.target as HTMLDetailsElement).open">
          <summary>
            <Icon name="book" :size="14" />
            <span>{{ showFull ? '收起完整讲义' : `展开完整讲义（${entry.wordCount} 字）` }}</span>
            <Icon name="chevronDown" :size="13" class="sum-ic" :class="{ up: showFull }" />
          </summary>
          <div class="md kb-body" @click="onBodyClick" v-html="bodyHtml" />

          <div v-if="entry.sources?.length" class="kb-sources">
            <div class="src-title">来源（优先官方，可溯源）</div>
            <a v-for="(s, i) in entry.sources" :key="i" class="kb-src" :title="s.url" @click="ipc.app.openExternal(s.url)">
              <span class="kb-src-kind">{{ sourceKindLabel[s.kind ?? 'doc'] ?? '文档' }}</span>
              <span class="ellip">{{ s.title || s.url }}</span>
            </a>
          </div>
        </details>
      </template>

      <!-- R22 受限多轮辅导：围绕本考点的随身私教，未收录考点也能用 -->
      <section class="kb-tutor" data-testid="kb-tutor">
        <div class="tutor-head">
          <div class="brief-title"><Icon name="brain" :size="14" /> AI 私教 · 只讲这个考点</div>
          <button v-if="messages.length" type="button" class="tutor-clear" title="清空本轮对话" @click="resetChat">
            <Icon name="refresh" :size="12" /> 清空
          </button>
        </div>
        <p class="tutor-scope tiny faint">
          <Icon name="target" :size="12" /> 问答限定在「{{ entry?.title ?? nodeTitle ?? '当前考点' }}」及其前置知识，问别的会被温柔拉回正题
        </p>

        <!-- 对话消息流 -->
        <div ref="scrollEl" class="tutor-scroll" data-testid="kb-tutor-scroll">
          <div v-if="!messages.length" class="tutor-empty tiny faint">
            看不懂题、术语陌生、不知道从哪学起？直接在下面问，或点一个快捷问法开始。
          </div>
          <div v-for="m in messages" :key="m.id" class="tutor-msg" :class="m.role">
            <div class="tutor-bubble">
              <div v-if="m.role === 'assistant' && m.offTopic" class="tutor-offtopic tiny">
                <Icon name="alert" :size="12" /> 这个问题和当前考点无关，私教已把话题拉回
              </div>
              <!-- 用户消息纯文本换行；私教消息走 Markdown -->
              <div v-if="m.role === 'user'" class="tutor-user-text">{{ m.content }}</div>
              <div v-else class="md tutor-answer-body" v-html="renderMd(m.content)" />
              <div v-if="m.role === 'assistant' && m.meta" class="tiny faint tutor-meta">
                {{ m.meta }}
                <!-- 本地小模型是默认，云端是兜底：不满意时一键交给强档端点重讲这一问 -->
                <button v-if="!tutorBusy && isLocalAnswer(m)" type="button" class="tutor-cloud" data-testid="kb-tutor-cloud" @click="upgradeToCloud(m)">
                  不满意？换云端重答
                </button>
              </div>

              <!-- 私教点名的前置回补：看讲义 / 直接去练更基础的题 -->
              <div v-if="m.role === 'assistant' && m.prereq" class="tutor-prereq" data-testid="kb-tutor-prereq">
                <div class="prereq-text tiny">
                  <Icon name="route" :size="13" />
                  <span>建议先补前置：<b>{{ m.prereq.title }}</b><template v-if="!m.prereq.lit">（你还没学过）</template></span>
                </div>
                <div class="prereq-acts">
                  <button type="button" class="prereq-btn" @click="openPrereq(m.prereq!.id)">
                    <Icon name="book" :size="12" /> 看它的讲义
                  </button>
                  <button type="button" class="prereq-btn primary" data-testid="kb-tutor-practice" @click="practicePrereq(m.prereq!)">
                    <Icon name="play" :size="12" /> 去练这个基础点
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div v-if="tutorBusy" class="tutor-msg assistant" data-testid="kb-tutor-busy">
            <div class="tutor-bubble"><span class="tutor-typing"><i></i><i></i><i></i></span></div>
          </div>
        </div>

        <p v-if="tutorError" class="tutor-error tiny" data-testid="kb-tutor-error">{{ tutorError }}</p>

        <!-- 快捷问法：零基础入口前置，降低开口门槛 -->
        <div class="kb-chips">
          <button v-for="(c, i) in chips" :key="i" type="button" class="chip" data-testid="kb-chip"
            :disabled="tutorBusy" :title="c.ask" @click="sendChip(c)">
            {{ c.label }}
          </button>
        </div>

        <!-- 输入区：回车发送，Shift+Enter 换行 -->
        <div class="tutor-input">
          <n-input v-model:value="askText" type="textarea" :autosize="{ minRows: 1, maxRows: 3 }" size="small"
            :disabled="tutorBusy" placeholder="用大白话写下你的困惑，回车发送 / Shift+回车换行"
            @keydown.enter.exact.prevent="onSend" />
          <n-button size="small" type="primary" data-testid="kb-ask" :loading="tutorBusy"
            :disabled="!askText.trim()" @click="onSend">
            <template #icon><Icon name="arrowRight" :size="14" /></template>
            发送
          </n-button>
        </div>
      </section>
    </template>
  </aside>
</template>

<style scoped>
.kb-drawer {
  position: fixed; right: 0; top: 0; bottom: 0; width: 440px; max-width: 94%; z-index: 60;
  background: var(--surface); border-left: 1px solid var(--border); box-shadow: var(--sh-4);
  padding: var(--sp-5); overflow: auto; animation: kb-slide var(--dur) var(--ease-enter) both;
}
@keyframes kb-slide { from { transform: translateX(20px); opacity: 0 } }
.kb-head { position: sticky; top: calc(var(--sp-5) * -1); background: var(--surface); padding-bottom: var(--sp-3); margin-bottom: var(--sp-2); z-index: 2 }
.kb-loading { padding: 40px 0; text-align: center }

.kb-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 14px }
.tag { font-size: 10px; font-weight: 700; padding: 1px 7px; border-radius: var(--r-pill) }
.tag.ok { color: var(--ok); background: color-mix(in oklab, var(--ok) 13%, transparent) }
.tag.warn { color: var(--warn); background: color-mix(in oklab, var(--warn) 14%, transparent) }
.tag.info { color: var(--accent-2); background: color-mix(in oklab, var(--accent) 12%, transparent) }

/* 精简卡片：统一卡片化，视觉分组清晰 */
.kb-brief {
  border: 1px solid var(--border); border-radius: var(--r-lg);
  background: var(--surface-2); padding: var(--sp-3) var(--sp-4); margin-bottom: var(--sp-3)
}
/* R22 间距修复：未收录提示卡（.kb-card.warn）与下方私教区之间留白，不再紧贴 */
.kb-card.warn { margin-bottom: var(--sp-4) }
.brief-title { display: flex; align-items: center; gap: 6px; font-size: var(--fs-sm); font-weight: 650; color: var(--text); margin-bottom: 8px }
.brief-title svg { color: var(--accent-2) }
.brief-list { margin: 0; padding-left: 18px; display: grid; gap: 7px }
.brief-list li { font-size: var(--fs-sm); line-height: 1.6; color: var(--text-dim) }
.brief-list li::marker { color: var(--accent) }

/* ---- R22 受限多轮辅导私教区 ---- */
.kb-tutor {
  border: 1px solid var(--border); border-radius: var(--r-lg);
  background: var(--surface-2); padding: var(--sp-3) var(--sp-4); margin-bottom: var(--sp-3);
  /* 与上方内容始终保持分组间距（含未收录卡场景） */
  margin-top: var(--sp-4)
}
.tutor-head { display: flex; align-items: center; justify-content: space-between; gap: 8px }
.tutor-head .brief-title { margin-bottom: 2px }
.tutor-head .brief-title svg { color: var(--purple) }
.tutor-clear { display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto;
  font-size: var(--fs-xs); color: var(--text-faint); background: none; border: none; cursor: pointer; padding: 2px 4px; border-radius: var(--r-sm) }
.tutor-clear:hover { color: var(--accent-2) }
.tutor-scope { display: flex; align-items: flex-start; gap: 5px; margin: 0 0 10px; line-height: 1.5 }
.tutor-scope svg { flex: 0 0 auto; margin-top: 2px; color: var(--accent-2) }

/* 消息流：限高可滚，长对话不把整个抽屉撑爆 */
.tutor-scroll { display: grid; gap: 10px; max-height: 340px; overflow-y: auto; padding: 2px 2px 6px }
.tutor-empty { padding: 14px 4px; line-height: 1.6 }
.tutor-msg { display: flex }
.tutor-msg.user { justify-content: flex-end }
.tutor-bubble { max-width: 88%; padding: 9px 12px; border-radius: var(--r-lg); font-size: var(--fs-sm); line-height: 1.65 }
.tutor-msg.user .tutor-bubble {
  background: color-mix(in oklab, var(--accent) 14%, var(--surface)); border: 1px solid color-mix(in oklab, var(--accent) 30%, transparent);
  color: var(--text); border-bottom-right-radius: 4px
}
.tutor-msg.assistant .tutor-bubble {
  background: var(--surface); border: 1px solid var(--border); border-bottom-left-radius: 4px; width: 100%; max-width: 100%
}
.tutor-user-text { white-space: pre-wrap; word-break: break-word }
.tutor-answer-body { font-size: var(--fs-sm); line-height: 1.65 }
.tutor-answer-body :deep(p) { margin: 4px 0 }
.tutor-answer-body :deep(p:first-child) { margin-top: 0 }
.tutor-answer-body :deep(p:last-child) { margin-bottom: 0 }
.tutor-answer-body :deep(code) { font-family: var(--mono); font-size: .92em; background: var(--surface-2); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px }
.tutor-answer-body :deep(pre) { background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--r-md); padding: 10px; overflow: auto; margin: 6px 0 }
.tutor-answer-body :deep(pre code) { background: none; border: none; padding: 0 }
.tutor-answer-body :deep(ul), .tutor-answer-body :deep(ol) { padding-left: 18px; margin: 6px 0; display: grid; gap: 3px }
.tutor-meta { margin-top: 6px; font-size: 10px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap }
.tutor-cloud {
  border: 1px solid color-mix(in oklab, var(--accent) 40%, var(--border)); border-radius: 999px;
  background: transparent; color: var(--accent); font: inherit; font-size: 10.5px; padding: 1px 8px;
  cursor: pointer; transition: background-color var(--dur-fast), border-color var(--dur-fast);
}
.tutor-cloud:hover { background: color-mix(in oklab, var(--accent) 10%, transparent); border-color: var(--accent) }
.tutor-offtopic { display: flex; align-items: center; gap: 5px; color: var(--warn); margin-bottom: 6px; font-weight: 600 }
.tutor-offtopic svg { flex: 0 0 auto }

/* 前置回补卡片：私教点名 → 看讲义 / 去练基础题 */
.tutor-prereq { margin-top: 10px; padding: 9px 10px; border-radius: var(--r-md);
  background: color-mix(in oklab, var(--purple, var(--accent)) 9%, var(--surface)); border: 1px solid color-mix(in oklab, var(--purple, var(--accent)) 28%, transparent) }
.prereq-text { display: flex; align-items: center; gap: 6px; color: var(--text); line-height: 1.5; margin-bottom: 8px }
.prereq-text svg { flex: 0 0 auto; color: var(--purple, var(--accent-2)) }
.prereq-acts { display: flex; gap: 8px; flex-wrap: wrap }
.prereq-btn { display: inline-flex; align-items: center; gap: 5px; font-size: var(--fs-xs); font-weight: 600;
  padding: 5px 11px; border-radius: var(--r-pill); border: 1px solid var(--border); background: var(--surface);
  color: var(--text-dim); cursor: pointer; transition: all var(--dur-fast) }
.prereq-btn:hover { border-color: var(--accent); color: var(--accent-2) }
.prereq-btn.primary { background: var(--accent); border-color: var(--accent); color: #fff }
.prereq-btn.primary:hover { opacity: .88; color: #fff }

/* 打字等待动效 */
.tutor-typing { display: inline-flex; gap: 4px; padding: 2px 0 }
.tutor-typing i { width: 6px; height: 6px; border-radius: 50%; background: var(--text-faint); animation: tutor-blink 1.2s infinite ease-in-out }
.tutor-typing i:nth-child(2) { animation-delay: .2s }
.tutor-typing i:nth-child(3) { animation-delay: .4s }
@keyframes tutor-blink { 0%, 80%, 100% { opacity: .25 } 40% { opacity: 1 } }

.tutor-error { margin: 8px 2px 0; padding: 7px 10px; border-radius: var(--r-md);
  color: var(--warn); background: color-mix(in oklab, var(--warn) 10%, transparent); line-height: 1.5 }

.kb-chips { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0 }
.chip { font-size: var(--fs-xs); padding: 4px 11px; border-radius: var(--r-pill); border: 1px solid var(--border);
  background: var(--surface); color: var(--text-dim); cursor: pointer; transition: all var(--dur-fast) }
.chip:hover:not(:disabled) { border-color: var(--accent); color: var(--accent-2) }
.chip:disabled { opacity: .5; cursor: not-allowed }

/* 输入区：文本框自适应 + 发送按钮并排 */
.tutor-input { display: flex; align-items: flex-end; gap: 8px }
.tutor-input .n-input { flex: 1 1 auto; min-width: 0 }

/* 完整讲义折叠头 */
.kb-full > summary {
  display: flex; align-items: center; gap: 8px; cursor: pointer; list-style: none;
  padding: 10px 12px; border: 1px dashed var(--border); border-radius: var(--r-md);
  color: var(--text-dim); font-size: var(--fs-sm); font-weight: 600; user-select: none
}
.kb-full > summary::-webkit-details-marker { display: none }
.kb-full > summary:hover { border-color: var(--accent); color: var(--accent-2) }
.sum-ic { margin-left: auto; transition: transform var(--dur) }
.sum-ic.up { transform: rotate(180deg) }

/* 长文阅读排版：加大行距、标题层级、代码块留白，提升阅读性 */
.kb-body { font-size: var(--fs-sm); line-height: 1.85; margin-top: 14px; color: var(--text) }
.kb-body :deep(h1), .kb-body :deep(h2), .kb-body :deep(h3) { line-height: 1.4; margin: 18px 0 8px; font-weight: 650 }
.kb-body :deep(h2) { font-size: var(--fs-md); padding-bottom: 6px; border-bottom: 1px solid var(--border) }
.kb-body :deep(h3) { font-size: var(--fs-base) }
.kb-body :deep(p) { margin: 8px 0 }
.kb-body :deep(ul), .kb-body :deep(ol) { padding-left: 20px; margin: 8px 0; display: grid; gap: 5px }
.kb-body :deep(code) { font-family: var(--mono); font-size: .92em; background: var(--surface-2); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px }
.kb-body :deep(pre) { background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--r-md); padding: 12px; overflow: auto; margin: 10px 0 }
.kb-body :deep(pre code) { background: none; border: none; padding: 0 }
.kb-body :deep(blockquote) { margin: 10px 0; padding: 6px 12px; border-left: 3px solid var(--accent); background: var(--surface-2); border-radius: 0 var(--r-sm) var(--r-sm) 0; color: var(--text-dim) }
.kb-body :deep(table) { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: var(--fs-xs) }
.kb-body :deep(th), .kb-body :deep(td) { border: 1px solid var(--border); padding: 6px 9px; text-align: left }
.kb-body :deep(.wikilink) { color: var(--accent-2); cursor: pointer; text-decoration: none; border-bottom: 1px dashed var(--accent) }
.kb-body :deep(.wikilink:hover) { opacity: .8 }

.kb-sources { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--border) }
.src-title { font-size: var(--fs-xs); font-weight: 650; color: var(--text-faint); margin-bottom: 6px }
.kb-src { display: flex; gap: 8px; align-items: center; padding: 6px 0; cursor: pointer; color: var(--text-dim); font-size: var(--fs-xs) }
.kb-src:hover { color: var(--accent-2) }
.kb-src-kind { flex: 0 0 auto; font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: var(--r-pill);
  background: color-mix(in oklab, var(--accent) 14%, transparent); color: var(--accent-2) }
</style>
