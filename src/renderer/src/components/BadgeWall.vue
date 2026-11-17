<script setup lang="ts">
/**
 * 徽章墙（R20）：网格展示全部成就，已解锁彩色、未解锁置灰并显示解锁条件。
 * 静态徽章 + 每章「通关/屠龙」动态徽章，按稀有度与解锁状态排序。
 */
import { computed } from 'vue'
import { useGameStore } from '../game-store'
import { RARITY_LABEL } from '../lib/game-ui'
import Icon from './Icon.vue'

const props = defineProps<{ open: boolean; domain?: string }>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>()
const store = useGameStore()

const items = computed(() => store.badges)
const unlockedCount = computed(() => items.value.filter((b) => b.unlocked).length)

const rarityClass: Record<string, string> = {
  common: 'r-common', rare: 'r-rare', epic: 'r-epic', legendary: 'r-legendary'
}

function close() { emit('update:open', false) }
</script>

<template>
  <transition name="badge-wall">
    <div v-if="props.open" class="badge-mask" @click.self="close">
      <div class="badge-wall" data-testid="badge-wall">
        <header class="wall-head">
          <div>
            <h3><Icon name="trophy" :size="18" /> 徽章墙</h3>
            <p class="tiny muted">已解锁 {{ unlockedCount }} / {{ items.length }} 枚成就</p>
          </div>
          <button class="icon-btn" aria-label="关闭" @click="close"><Icon name="close" :size="16" /></button>
        </header>
        <div class="wall-grid">
          <div v-for="b in items" :key="b.id" class="badge-cell" :class="[rarityClass[b.rarity], { locked: !b.unlocked }]"
            :title="b.unlocked ? `${b.name}（${RARITY_LABEL[b.rarity]}）` : `未解锁：${b.desc}`">
            <div class="badge-icon">{{ b.unlocked ? b.icon : '🔒' }}</div>
            <div class="badge-name">{{ b.name }}</div>
            <div class="badge-desc tiny">{{ b.desc }}</div>
            <span class="badge-rarity">{{ RARITY_LABEL[b.rarity] }}</span>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.badge-mask {
  position: fixed; inset: 0; z-index: 1500;
  display: grid; place-content: center;
  background: color-mix(in oklab, var(--bg) 55%, transparent);
  backdrop-filter: blur(3px); padding: 24px;
}
.badge-wall {
  width: min(860px, 92vw); max-height: 84vh; overflow: auto;
  background: var(--surface); border: 1px solid var(--border-2);
  border-radius: var(--r-xl, 18px); padding: 20px 22px; box-shadow: var(--sh-3);
}
.wall-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px }
.wall-head h3 { display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 800; margin: 0 }
.wall-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px;
}
.badge-cell {
  position: relative; text-align: center; padding: 16px 10px 12px;
  border: 1px solid var(--border); border-radius: var(--r-lg, 14px);
  background: var(--surface-2); transition: transform var(--dur-fast, .15s), box-shadow var(--dur-fast, .15s);
}
.badge-cell:hover { transform: translateY(-3px); box-shadow: var(--sh-2) }
.badge-icon { font-size: 38px; line-height: 1; margin-bottom: 8px }
.badge-name { font-size: 13.5px; font-weight: 800; color: var(--text); margin-bottom: 3px }
.badge-desc { color: var(--text-dim); line-height: 1.4; min-height: 32px }
.badge-rarity {
  display: inline-block; margin-top: 6px; font-size: 10px; font-weight: 700;
  padding: 2px 8px; border-radius: var(--r-pill, 999px);
}
.badge-cell.locked { opacity: .55; filter: grayscale(.85) }
.badge-cell.locked .badge-icon { filter: grayscale(1) }
.r-common .badge-rarity { background: color-mix(in oklab, var(--text-faint) 20%, transparent); color: var(--text-dim) }
.r-rare .badge-rarity { background: color-mix(in oklab, #58a6ff 18%, transparent); color: #58a6ff }
.r-epic .badge-rarity { background: color-mix(in oklab, #bc8cff 20%, transparent); color: #bc8cff }
.r-legendary .badge-rarity { background: linear-gradient(90deg, #f5b942, #f0883e); color: #1c1300 }
.r-legendary:not(.locked) { border-color: color-mix(in oklab, #f5b942 55%, transparent) }
.badge-wall-enter-active, .badge-wall-leave-active { transition: opacity .25s }
.badge-wall-enter-from, .badge-wall-leave-to { opacity: 0 }
</style>
