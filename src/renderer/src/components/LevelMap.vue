<script setup lang="ts">
/**
 * 闯关目录（R21）——纯 DOM 纵向手风琴，不再使用无限画布。
 * 设计依据：Duolingo 关卡选择器 + 用户反馈「最外层单纯是闯关类游戏目录」。
 * - 章节是手风琴条目：图标/主题名/进度条/Boss 状态/锁定迷雾，一屏看全章节；
 * - 章内考点是一行一个的关卡行（序号 + 四态 + 标题 + 标记），点击进关系聚焦；
 * - 不画任何连线：列表顺序即闯关顺序，连线在这里没有信息增量（旧蛇形连线的教训）。
 */
import { computed, ref, watch } from 'vue'
import Icon from './Icon.vue'
import { buildWorld, nextStage, type WorldNode } from '../lib/graph-world'
import type { GraphNode } from '@shared/types'
import type { ChapterDef } from '@shared/chapters'

const props = defineProps<{
  domain: string
  nodes: GraphNode[]
  /** Boss 关 id 集合 */
  bossIds: Set<string>
  beatenBossIds: Set<string>
}>()
const emit = defineEmits<{
  (e: 'pick', nodeId: string): void
  (e: 'next', nodeId: string): void
}>()

type StateKey = 'untouched' | 'learning' | 'mastered' | 'stale'
const stateKey = (n: GraphNode): StateKey => {
  const lv = Number(n.masteryLevel ?? n.mastery_level ?? 0)
  return lv === 2 ? 'mastered' : lv === 3 ? 'stale' : lv === 1 ? 'learning' : 'untouched'
}
const STATE_LABEL: Record<StateKey, string> = {
  untouched: '未接触', learning: '学习中', mastered: '已通关', stale: '已生疏'
}

/** 世界模型（章节 + 全局序号），复用共享章节划分 */
const world = computed(() => buildWorld(props.domain, props.nodes))
const nextId = computed(() => nextStage(world.value))

/** 按章节聚合成手风琴条目（布局坐标在目录里用不到，只取分组与序号） */
interface ChapterRow {
  def: ChapterDef
  members: WorldNode[]
  lit: number
  total: number
  fogged: boolean
  boss: WorldNode | null
  bossBeaten: boolean
  pct: number
}
const chapters = computed<ChapterRow[]>(() => {
  const map = new Map<string, ChapterRow>()
  for (const w of world.value) {
    const id = w.chapter.id
    if (!map.has(id)) {
      map.set(id, {
        def: w.chapter, members: [], lit: 0, total: 0,
        fogged: true, boss: null, bossBeaten: false, pct: 0
      })
    }
    const row = map.get(id)!
    row.members.push(w)
    row.total += 1
    if (w.node.lit === 1) row.lit += 1
    if ((w.node.answered ?? 0) > 0) row.fogged = false
    if (props.bossIds.has(w.node.id)) {
      row.boss = w
      row.bossBeaten = props.beatenBossIds.has(w.node.id)
    }
  }
  for (const row of map.values()) row.pct = row.total ? row.lit / row.total : 0
  return [...map.values()].sort((a, b) => a.def.no - b.def.no)
})

/** 默认展开「下一关」所在章；其余折叠。用户手动展开后不再被数据刷新覆盖 */
const openIds = ref<Set<string>>(new Set())
const userTouched = ref(false)
watch(chapters, (rows) => {
  if (userTouched.value) return
  const nid = nextId.value
  const target = rows.find((r) => r.members.some((w) => w.node.id === nid)) ?? rows[0]
  if (target) openIds.value = new Set([target.def.id])
}, { immediate: true })

function toggle(id: string) {
  userTouched.value = true
  const s = new Set(openIds.value)
  s.has(id) ? s.delete(id) : s.add(id)
  openIds.value = s
}
function isOpen(id: string) { return openIds.value.has(id) }

function onPick(w: WorldNode) { emit('pick', w.node.id) }
function goNext() { if (nextId.value) emit('next', nextId.value) }

defineExpose({ expand: (id: string) => openIds.value.add(id), nextId })
</script>

<template>
  <div class="level-map" data-testid="level-map">
    <div v-if="nextId" class="next-banner" data-testid="level-next-banner" @click="goNext">
      <Icon name="sparkles" :size="15" />
      <span class="nb-txt">继续闯关 · 下一关已就绪</span>
      <span class="nb-go">前往 <b>›</b></span>
    </div>

    <section v-for="ch in chapters" :key="ch.def.id" class="lv-chapter" :class="{ open: isOpen(ch.def.id) }"
      :style="{ '--hue': ch.def.hue }">
      <header class="lv-ch-head" :data-testid="'lv-chapter-' + ch.def.no" @click="toggle(ch.def.id)">
        <span class="lv-ch-icon">{{ ch.def.icon }}</span>
        <div class="lv-ch-titles">
          <div class="lv-ch-name">
            <span class="lv-ch-no">第 {{ ch.def.no }} 章</span>{{ ch.def.name }}
            <span v-if="ch.fogged" class="lv-fog">🌫 未探索</span>
            <span v-else-if="ch.pct >= 1" class="lv-done">✓ 全章通关</span>
          </div>
          <div class="lv-ch-sub">{{ ch.def.sub }}</div>
        </div>
        <div class="lv-ch-meta">
          <div class="lv-prog">
            <div class="lv-bar"><i :style="{ width: ch.pct * 100 + '%' }" /></div>
            <span class="lv-count num">{{ ch.lit }}/{{ ch.total }}</span>
          </div>
          <span v-if="ch.boss" class="lv-boss" :class="{ done: ch.bossBeaten }" :title="ch.bossBeaten ? 'Boss 已击败' : '章节 Boss 综合关（需已掌握）'">
            🐲 {{ ch.bossBeaten ? '已击败' : 'Boss' }}
          </span>
          <Icon name="chevronDown" :size="16" class="lv-caret" />
        </div>
      </header>

      <transition name="lv-expand">
        <div v-show="isOpen(ch.def.id)" class="lv-stages">
          <button v-for="w in ch.members" :key="w.node.id" type="button"
            class="lv-stage" :class="['st-' + stateKey(w.node), {
              locked: w.node.locked, next: nextId === w.node.id,
              boss: bossIds.has(w.node.id), 'boss-done': beatenBossIds.has(w.node.id)
            }]" :data-testid="'lv-stage-' + w.node.id" @click="onPick(w)">
            <span class="lv-dot">
              <Icon v-if="w.node.locked" name="lock" :size="13" />
              <span v-else-if="stateKey(w.node) === 'mastered'">✓</span>
              <span v-else-if="stateKey(w.node) === 'stale'">↺</span>
              <span v-else class="num">{{ w.globalSeq + 1 }}</span>
            </span>
            <span class="lv-title" :title="w.node.title">
              <i v-if="bossIds.has(w.node.id)" class="lv-boss-tag">BOSS</i>
              <i v-else-if="w.node.must_master && !w.node.lit" class="lv-must" title="基础必修">🛡</i>
              {{ w.node.title }}
            </span>
            <span class="lv-state">{{ STATE_LABEL[stateKey(w.node)] }}</span>
            <Icon v-if="nextId === w.node.id" name="sparkles" :size="13" class="lv-next-ic" />
            <Icon name="arrowRight" :size="14" class="lv-arrow" />
          </button>
        </div>
      </transition>
    </section>
  </div>
</template>

<style scoped>
.level-map { display: flex; flex-direction: column; gap: 12px; max-width: 880px; margin: 0 auto; }

.next-banner {
  display: flex; align-items: center; gap: 10px;
  background: linear-gradient(120deg, color-mix(in oklab, var(--accent) 16%, var(--surface)), var(--surface));
  border: 1px solid color-mix(in oklab, var(--accent) 38%, var(--border));
  border-radius: var(--r-lg); padding: 12px 16px; cursor: pointer;
  box-shadow: var(--sh-1); transition: box-shadow var(--dur-fast), transform var(--dur-fast) var(--ease-out);
  color: var(--accent-2);
}
.next-banner:hover { box-shadow: var(--sh-2); transform: translateY(-1px) }
.nb-txt { font-weight: 700; font-size: var(--fs-md); color: var(--text) }
.nb-go { margin-left: auto; font-size: var(--fs-sm); font-weight: 700; display: inline-flex; align-items: center; gap: 2px }
.nb-go b { font-size: 17px }

.lv-chapter {
  border: 1px solid var(--border); border-radius: var(--r-lg);
  background: var(--surface); overflow: hidden; box-shadow: var(--sh-1);
  transition: box-shadow var(--dur);
}
.lv-chapter.open { box-shadow: var(--sh-2); border-color: color-mix(in oklab, hsl(var(--hue) 60% 55%) 38%, var(--border)) }
.lv-ch-head {
  display: flex; align-items: center; gap: 12px; width: 100%;
  padding: 14px 16px; cursor: pointer; text-align: left;
  background: linear-gradient(120deg, hsl(var(--hue) 60% 60% / .10), transparent 62%);
  border: 0; font-family: inherit;
}
.lv-ch-head:hover { background: linear-gradient(120deg, hsl(var(--hue) 60% 60% / .16), var(--surface-2) 70%) }
.lv-ch-icon { font-size: 26px; flex: 0 0 auto }
.lv-ch-titles { flex: 1; min-width: 0 }
.lv-ch-name { font-size: var(--fs-lg); font-weight: 800; color: var(--text); display: flex; align-items: center; gap: 8px; flex-wrap: wrap }
.lv-ch-no {
  font-size: var(--fs-xs); font-weight: 700; color: hsl(var(--hue) 58% 42%);
  background: hsl(var(--hue) 60% 60% / .14); padding: 2px 8px; border-radius: var(--r-pill);
}
.lv-ch-sub { font-size: var(--fs-xs); color: var(--text-faint); margin-top: 3px }
.lv-fog, .lv-done { font-size: 10.5px; font-weight: 700; padding: 2px 8px; border-radius: var(--r-pill) }
.lv-fog { color: var(--text-faint); background: var(--surface-3) }
.lv-done { color: var(--ok); background: color-mix(in oklab, var(--ok) 13%, transparent) }
.lv-ch-meta { display: flex; align-items: center; gap: 12px; flex: 0 0 auto }
.lv-prog { display: flex; align-items: center; gap: 8px; width: 132px }
.lv-bar { flex: 1; height: 7px; background: var(--surface-3); border-radius: var(--r-pill); overflow: hidden }
.lv-bar i { display: block; height: 100%; border-radius: var(--r-pill);
  background: linear-gradient(90deg, hsl(var(--hue) 62% 52%), hsl(var(--hue) 70% 62%));
  transition: width var(--dur-slow) var(--ease-out) }
.lv-count { font-size: var(--fs-xs); color: var(--text-dim) }
.lv-boss {
  font-size: 10.5px; font-weight: 800; white-space: nowrap;
  color: var(--hot); background: color-mix(in oklab, var(--hot) 12%, var(--surface));
  border: 1px solid color-mix(in oklab, var(--hot) 40%, transparent);
  padding: 3px 8px; border-radius: var(--r-pill);
}
.lv-boss.done { color: var(--ok); background: color-mix(in oklab, var(--ok) 12%, transparent); border-color: color-mix(in oklab, var(--ok) 40%, transparent) }
.lv-caret { color: var(--text-faint); transition: transform var(--dur) var(--ease-out) }
.lv-chapter.open .lv-caret { transform: rotate(180deg) }

.lv-stages { display: flex; flex-direction: column; padding: 4px 10px 10px; gap: 2px }
.lv-stage {
  display: flex; align-items: center; gap: 11px; width: 100%;
  padding: 9px 10px; border: 0; border-radius: var(--r-md);
  background: transparent; font-family: inherit; text-align: left; cursor: pointer;
  transition: background var(--dur-fast);
}
.lv-stage:hover { background: var(--surface-2) }
.lv-dot {
  width: 30px; height: 30px; flex: 0 0 30px; border-radius: 50%;
  display: grid; place-content: center; font-weight: 800; font-size: 13px;
  background: var(--surface-2); border: 2px solid var(--border-2); color: var(--text-dim);
}
.lv-stage.st-mastered .lv-dot {
  background: hsl(var(--hue, 230) 58% 48%); border-color: var(--ok); color: #fff;
}
.lv-stage.st-learning .lv-dot { border-color: var(--warn); color: var(--warn); background: color-mix(in oklab, var(--warn) 12%, var(--surface)) }
.lv-stage.st-stale .lv-dot { border-style: dashed; border-color: var(--hot); color: var(--hot); background: color-mix(in oklab, var(--hot) 12%, var(--surface)) }
.lv-stage.locked .lv-dot { background: var(--surface-3); color: var(--text-faint) }
.lv-stage.must:not(.st-mastered) .lv-dot { border-color: var(--purple) }
.lv-stage.next .lv-dot {
  border-color: var(--accent);
  animation: lv-pulse 1.8s var(--ease-in-out) infinite;
}
@keyframes lv-pulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--accent) 45%, transparent) }
  50% { box-shadow: 0 0 0 8px color-mix(in oklab, var(--accent) 0%, transparent) }
}
.lv-title { flex: 1; min-width: 0; font-size: var(--fs-base); font-weight: 600; color: var(--text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 6px }
.lv-stage.locked .lv-title { color: var(--text-faint) }
.lv-boss-tag {
  font-style: normal; font-size: 9px; font-weight: 900; letter-spacing: .05em;
  color: var(--hot); background: color-mix(in oklab, var(--hot) 14%, var(--surface));
  border: 1px solid color-mix(in oklab, var(--hot) 42%, transparent);
  padding: 1px 5px; border-radius: 4px;
}
.lv-must { font-style: normal; font-size: 11px }
.lv-state { font-size: var(--fs-xs); color: var(--text-faint); flex: 0 0 auto; width: 52px; text-align: right }
.lv-stage.st-mastered .lv-state { color: var(--ok) }
.lv-stage.st-stale .lv-state { color: var(--hot) }
.lv-next-ic { color: var(--accent); flex: 0 0 auto }
.lv-arrow { color: var(--text-faint); flex: 0 0 auto }
@media (prefers-reduced-motion: reduce) { .lv-stage.next .lv-dot { animation: none } }

.lv-expand-enter-active, .lv-expand-leave-active { transition: opacity var(--dur) var(--ease-out), grid-template-rows var(--dur) var(--ease-out);
  display: grid; grid-template-rows: 1fr }
.lv-expand-enter-from, .lv-expand-leave-to { opacity: 0; grid-template-rows: 0fr }
.lv-expand-enter-active .lv-stages, .lv-expand-leave-active .lv-stages { overflow: hidden }
</style>
