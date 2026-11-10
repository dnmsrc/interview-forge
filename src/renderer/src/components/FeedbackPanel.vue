<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Question, GradeResult } from '@shared/types'
import { renderMd, SCALE_LABEL, scale4Color, softOf, lineOf, TYPE_ICON, message } from '../lib/ui'
import { ipc } from '../lib/ipc'

const props = defineProps<{ q: Question; grade: GradeResult | null; nodeTitle?: string; nodeId?: string; myAnswer?: string }>()
const emit = defineEmits<{ (e: 'openNode', id: string): void; (e: 'reported'): void }>()
const openUrl = (u?: string) => { if (u) void ipc.app.openExternal(u) }

const busy = ref<'teach' | 'probe' | 'qa' | ''>('')
const teach = ref<any>(null)
const qaMsgs = ref<{ role: string; content: string }[]>([])
const qaInput = ref('')
const probeHistory = ref<{ me: string; probe: string }[]>([])
const probeCurrent = ref('')
const probeLast = ref('')
const probeDone = ref(false)
const showQa = ref(false)
watch(() => props.q?.id, () => { teach.value = null; qaMsgs.value = []; probeHistory.value = []; probeCurrent.value = ''; probeLast.value = ''; probeDone.value = false; showQa.value = false })

const myAnswerText = computed(() => String(props.myAnswer ?? ''))

async function runTeach() {
  busy.value = 'teach'
  try { teach.value = await ipc.practice.teach(props.q.id, myAnswerText.value) } catch (e: any) { message.error(String(e?.message ?? e)) } finally { busy.value = '' }
}
async function runProbe(start = false) {
  busy.value = 'probe'
  try {
    const r = await ipc.practice.probe(props.q.id, probeHistory.value, start ? myAnswerText.value : probeLast.value)
    if (r.done || !r.question) { probeDone.value = true; message.info('追问链已结束') } else { probeCurrent.value = r.question }
  } catch (e: any) { message.error(String(e?.message ?? e)) } finally { busy.value = '' }
}
function sendProbeAnswer() {
  if (!probeCurrent.value) return
  probeHistory.value.push({ me: probeLast.value || myAnswerText.value, probe: probeCurrent.value })
  probeLast.value = ''
  void runProbe(false)
}
async function sendQa() {
  const text = qaInput.value.trim()
  if (!text) return
  qaMsgs.value.push({ role: 'me', content: text })
  qaInput.value = ''
  busy.value = 'qa'
  try {
    const r = await ipc.practice.qa(props.q.id, text, qaMsgs.value.filter((m) => m.role === 'ai').map((m, i) => ({ role: 'assistant', content: m.content })).slice(-6))
    qaMsgs.value.push({ role: 'ai', content: r.answer + (r.miniExample ? `\n\n\`\`\`\n${r.miniExample}\n\`\`\`` : '') })
  } catch (e: any) { qaMsgs.value.push({ role: 'ai', content: `⚠️ ${String(e?.message ?? e)}` }) } finally { busy.value = '' }
}

async function report(kind: 'wrong' | 'outdated' | 'ambiguous') {
  const reason = { wrong: '答案或有误', outdated: '考点已过时', ambiguous: '题干/选项有歧义' }[kind]
  try { await ipc.dirty.report(props.q.id, reason); message.success('已举报，后台会自动复核处理'); emit('reported') } catch (e: any) { message.error(String(e?.message ?? e)) }
}

const awardedPct = computed(() => {
  const list = props.grade?.awarded ?? []
  if (!list.length) return null
  return Math.round(list.reduce((s, a) => s + Math.min(100, Number(a.got ?? 0)), 0) / list.length)
})
</script>

<template>
  <div v-if="grade">
    <!-- 评分卡 -->
    <div class="fb" :class="grade.scale4 >= 2 ? 'ok' : grade.scale4 >= 1 ? 'warn' : 'bad'">
      <div class="row" style="gap:14px">
        <div>
          <div class="tiny muted">{{ grade.gradingKind === 'ai' ? 'AI 批改' : grade.gradingKind === 'self' ? '自评' : '客观题自动判分' }}</div>
          <div class="big" :style="{ color: scale4Color(grade.scale4) }">{{ grade.pct }}<span style="font-size:14px">/100</span></div>
        </div>
        <div style="flex:1">
          <div class="row" style="gap:8px">
            <span class="pill" :style="{ background: softOf(scale4Color(grade.scale4)), color: scale4Color(grade.scale4), borderColor: lineOf(scale4Color(grade.scale4)) }">
              四档 {{ grade.scale4 }} · {{ SCALE_LABEL[grade.scale4] }}
            </span>
            <span v-if="awardedPct != null" class="pill info">评分点命中 {{ awardedPct }}%</span>
            <span v-if="grade.model" class="pill lock">{{ grade.model }}</span>
            <span v-if="grade.ms" class="pill lock">{{ (grade.ms / 1000).toFixed(1) }}s</span>
          </div>
          <div v-if="grade.verdict" class="tiny" style="margin-top:6px;color:var(--text)">{{ grade.verdict }}</div>
          <div v-if="grade.error" class="tiny" style="color:var(--warn);margin-top:4px">⚠️ {{ grade.error }}</div>
        </div>
      </div>

      <template v-if="grade.awarded?.length">
        <div class="section-title">逐评分点判定</div>
        <div v-for="(a, i) in grade.awarded" :key="i" class="kv">
          <div style="flex:1">
            <div>{{ i + 1 }}. {{ a.point }}</div>
            <div class="tiny muted" style="margin-top:2px">{{ a.why }}</div>
          </div>
          <span class="pill" :class="Number(a.got) >= 70 ? 'ok' : Number(a.got) >= 40 ? 'warn' : 'bad'">{{ Math.round(Number(a.got) || 0) }}%</span>
        </div>
      </template>

      <template v-if="grade.missing?.length">
        <div class="section-title">你漏掉的关键点</div>
        <ul><li v-for="(m, i) in grade.missing" :key="i">{{ m }}</li></ul>
      </template>
      <div v-if="grade.comment" class="tiny" style="margin-top:10px;color:var(--text-dim)">💡 {{ grade.comment }}</div>
    </div>

    <!-- 个性化讲评 -->
    <div class="card" style="margin-top:14px">
      <h3>🧠 针对我这份作答的讲评</h3>
      <div class="row" style="margin-bottom:10px">
        <n-button size="small" type="primary" :loading="busy === 'teach'" @click="runTeach">AI 诊断我的错因</n-button>
        <n-button size="small" :loading="busy === 'probe'" :disabled="!probeCurrent && probeDone" @click="probeCurrent ? undefined : runProbe(true)">
          {{ probeCurrent ? '继续追问链 ↓' : '让面试官追问' }}
        </n-button>
        <n-button size="small" @click="showQa = !showQa">{{ showQa ? '收起答疑' : '就地提问' }}</n-button>
      </div>

      <div v-if="teach" class="grid" style="gap:10px">
        <div v-if="teach.errors?.length">
          <div class="section-title">我说错的地方</div>
          <div v-for="(e, i) in teach.errors" :key="i" class="fb bad" style="margin:0 0 8px">
            <div class="tiny" style="color:var(--bad)">「{{ e.claim }}」</div>
            <div class="tiny" style="margin-top:4px">{{ e.why_wrong }}</div>
          </div>
        </div>
        <div v-if="teach.termFixes?.length">
          <div class="section-title">术语纠正</div>
          <div v-for="(t, i) in teach.termFixes" :key="i" class="kv">
            <div><span style="color:var(--bad)">{{ t.wrong }}</span> → <span style="color:var(--ok)">{{ t.right }}</span>
              <div class="tiny muted">{{ t.why }}</div>
            </div>
          </div>
        </div>
        <div v-if="teach.missingPoints?.length">
          <div class="section-title">面试官会追问但我没提</div>
          <ul><li v-for="(m, i) in teach.missingPoints" :key="i">{{ m }}</li></ul>
        </div>
        <div v-if="teach.howToRemember" class="fb warn"><h4>🔖 记忆锚点</h4><div class="tiny">{{ teach.howToRemember }}</div></div>
        <div v-if="teach.betterAnswer" class="fb ok"><h4>✍️ 补齐后的示范</h4><div class="md" v-html="renderMd(teach.betterAnswer)" /></div>
      </div>

      <!-- 追问链 -->
      <div v-if="probeCurrent || probeHistory.length">
        <div class="section-title">模拟面试追问链（最多 3 轮）</div>
        <div v-for="(h, i) in probeHistory" :key="i" style="margin-bottom:10px">
          <div class="tiny" style="color:var(--accent-2)">面试官 Q{{ i + 1 }}：{{ h.probe }}</div>
          <div class="tiny muted" style="margin-top:2px">我：{{ h.me || '（空）' }}</div>
        </div>
        <template v-if="probeCurrent && !probeDone">
          <div class="tiny" style="color:var(--accent-2);margin-bottom:6px">面试官：{{ probeCurrent }}</div>
          <textarea class="code-area" style="min-height:90px;font-family:inherit" v-model="probeLast" placeholder="口头回答也行，写下关键词即可" />
          <div class="row" style="margin-top:8px">
            <n-button size="small" type="primary" :loading="busy === 'probe'" @click="sendProbeAnswer">回答并继续</n-button>
            <n-button size="small" quaternary @click="probeDone = true">结束追问</n-button>
          </div>
        </template>
        <div v-else-if="probeDone" class="tiny" style="color:var(--ok)">✓ 这一串追问到此为止，把上面的问题回去补进解析里的知识点。</div>
      </div>

      <!-- 就地答疑 -->
      <div v-if="showQa">
        <div class="section-title">带着这道题问 AI</div>
        <div v-for="(m, i) in qaMsgs" :key="i" style="margin-bottom:8px">
          <div class="tiny" :style="{ color: m.role === 'me' ? 'var(--text-dim)' : 'var(--ok)' }">{{ m.role === 'me' ? '我：' : 'AI：' }}</div>
          <div class="md tiny" v-html="renderMd(m.content)" />
        </div>
        <div class="row">
          <n-input v-model:value="qaInput" size="small" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }"
            placeholder="例如：为什么这里不能用 defineProperty？" @keyup.enter.exact.prevent="sendQa" />
          <n-button size="small" type="primary" :loading="busy === 'qa'" @click="sendQa">提问</n-button>
        </div>
      </div>
    </div>

    <!-- 解析 + 查漏补缺 + 知识关联 -->
    <div class="grid g2" style="margin-top:14px">
      <div class="card">
        <h3>📖 答案解析</h3>
        <div class="md" v-html="renderMd(q.analysis)" />
      </div>
      <div class="grid" style="gap:14px;align-content:start">
        <div class="card">
          <h3>🩹 查漏补缺</h3>
          <ul v-if="q.gapCheck?.length"><li v-for="(g, i) in q.gapCheck" :key="i">{{ g }}</li></ul>
          <div v-else class="tiny muted">这道题没写查漏项，可以举报让 AI 补上。</div>
        </div>
        <div class="card">
          <h3>🔗 知识关联</h3>
          <div v-if="q.knowledgeLinks?.prereq?.length" style="margin-bottom:8px">
            <div class="tiny muted">前置</div>
            <div class="row" style="margin-top:4px">
              <n-button v-for="p in q.knowledgeLinks.prereq" :key="p" size="tiny" quaternary @click="emit('openNode', p)">↗ {{ p }}</n-button>
            </div>
          </div>
          <div v-if="q.knowledgeLinks?.related?.length" style="margin-bottom:8px">
            <div class="tiny muted">横向相关</div>
            <div class="row" style="margin-top:4px">
              <n-button v-for="r in q.knowledgeLinks.related" :key="r" size="tiny" quaternary @click="emit('openNode', r)">· {{ r }}</n-button>
            </div>
          </div>
          <div v-if="q.knowledgeLinks?.followUps?.length">
            <div class="tiny muted">面试官接着会问</div>
            <ul><li v-for="(f, i) in q.knowledgeLinks.followUps" :key="i">{{ f }}</li></ul>
          </div>
          <div v-if="nodeId" class="row" style="margin-top:8px">
            <n-button size="tiny" @click="emit('openNode', nodeId)">在图谱里定位这个考点</n-button>
            <span class="tiny muted">{{ nodeTitle }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 资料面板 + 举报 -->
    <div class="card" style="margin-top:14px">
      <details v-if="q.resources?.length">
        <summary style="cursor:pointer;font-size:13px">📚 本题可查资料（闭卷时不可用）</summary>
        <div v-for="(r, i) in q.resources" :key="i" style="margin-top:10px">
          <div style="font-size:13px">{{ r.title }}</div>
          <div class="tiny muted" style="margin-top:3px">{{ r.digest }}</div>
        </div>
      </details>
      <div class="row tiny muted" style="margin-top:10px">
        <span>来源：{{ q.source?.kind }}{{ q.source?.url ? ' · ' : '' }}</span>
        <n-button v-if="q.source?.url" size="tiny" quaternary @click="openUrl(q.source?.url)">{{ q.source.url }}</n-button>
        <span v-if="q.source?.note">· {{ q.source.note }}</span>
        <span class="grow" />
        <span>这题有问题：</span>
        <n-button size="tiny" quaternary @click="report('wrong')">答案存疑</n-button>
        <n-button size="tiny" quaternary @click="report('outdated')">已过时</n-button>
        <n-button size="tiny" quaternary @click="report('ambiguous')">有歧义</n-button>
      </div>
    </div>
  </div>
</template>
