<script setup lang="ts">
/**
 * 游戏化庆祝弹窗（R20）：监听 game-store 的未读事件队列，逐条播放。
 * - 升级 / 徽章 / Boss / 章节通关这类「高光事件」弹窗 + 满屏彩带；
 * - 纯 XP / 打卡等轻事件合并成一条小结，不打断学习节奏；
 * - 彩带用原生 canvas 粒子实现，零第三方依赖，结束自动回收，尊重 prefers-reduced-motion。
 */
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { useGameStore } from '../game-store'
import type { GameEventDto } from '@shared/game'

const store = useGameStore()
const canvasRef = ref<HTMLCanvasElement | null>(null)
const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

interface Celebration {
  big: boolean
  icon: string
  title: string
  sub: string
  accent: string
  events: GameEventDto[]
}

const HIGHLIGHT = new Set(['level-up', 'badge', 'boss-beaten', 'chapter-clear'])

/** 把事件队列归并成一次庆祝：有高光则单独成卡，其余轻事件合并 */
const current = computed<Celebration | null>(() => {
  const evs = store.pendingEvents
  if (!evs.length) return null
  const hi = evs.find((e) => HIGHLIGHT.has(e.kind))
  const rest = evs.filter((e) => e !== hi)
  if (hi) {
    const meta = META[hi.kind] ?? META.xp
    const subParts: string[] = []
    if (hi.xpGain) subParts.push(`+${hi.xpGain} XP`)
    const xpEvent = evs.find((e) => e.kind === 'xp')
    if (xpEvent?.text) subParts.push(xpEvent.text)
    if (rest.length) subParts.push(`另有 ${rest.length} 项奖励已入账`)
    return { big: true, icon: hi.badgeIcon ?? meta.icon, title: hi.title ?? meta.title, sub: subParts.join(' · '), accent: meta.accent, events: evs }
  }
  // 无高光：合并轻事件为小结
  const xp = evs.find((e) => e.kind === 'xp')
  const streak = evs.find((e) => e.kind === 'streak')
  const titles = evs.map((e) => e.title).filter(Boolean).slice(0, 3)
  return {
    big: false,
    icon: streak ? '🔥' : '⭐',
    title: streak?.title ?? (xp?.text ?? '获得奖励'),
    sub: titles.join(' · '),
    accent: 'var(--accent)',
    events: evs
  }
})

const META: Record<string, { icon: string; title: string; accent: string }> = {
  'level-up': { icon: '⭐', title: '等级提升', accent: 'var(--warn)' },
  badge: { icon: '🏅', title: '获得徽章', accent: 'var(--purple)' },
  'boss-beaten': { icon: '🐲', title: '击败 Boss', accent: 'var(--hot)' },
  'chapter-clear': { icon: '🏆', title: '章节通关', accent: 'var(--ok)' },
  xp: { icon: '⭐', title: '获得 XP', accent: 'var(--accent)' }
}

async function close() {
  await store.clearEvents()
  stopConfetti()
}

/* ------------------------------- 彩带粒子 ------------------------------- */
let raf = 0
let particles: { x: number; y: number; vx: number; vy: number; rot: number; vr: number; color: string; size: number; shape: number }[] = []
const COLORS = ['#f5b942', '#3fb950', '#58a6ff', '#bc8cff', '#f778ba', '#f0883e']

function startConfetti() {
  if (reduced || !canvasRef.value) return
  const canvas = canvasRef.value
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
  particles = Array.from({ length: 140 }, () => ({
    x: Math.random() * canvas.width,
    y: -20 - Math.random() * canvas.height * 0.4,
    vx: (Math.random() - 0.5) * 3,
    vy: 2 + Math.random() * 4,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    size: 6 + Math.random() * 7,
    shape: Math.floor(Math.random() * 2)
  }))
  let frames = 0
  const tick = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    frames++
    for (const p of particles) {
      p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.vy += 0.04
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rot)
      ctx.fillStyle = p.color
      if (p.shape === 0) ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6)
      else { ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2); ctx.fill() }
      ctx.restore()
    }
    if (frames < 220 && particles.some((p) => p.y < canvas.height + 30)) raf = requestAnimationFrame(tick)
    else ctx.clearRect(0, 0, canvas.width, canvas.height)
  }
  raf = requestAnimationFrame(tick)
}
function stopConfetti() {
  cancelAnimationFrame(raf)
  const ctx = canvasRef.value?.getContext('2d')
  if (ctx && canvasRef.value) ctx.clearRect(0, 0, canvasRef.value.width, canvasRef.value.height)
  particles = []
}

watch(current, (c) => {
  if (c?.big) startConfetti()
  else stopConfetti()
})
onBeforeUnmount(stopConfetti)
</script>

<template>
  <canvas ref="canvasRef" class="confetti-canvas" aria-hidden="true" />
  <transition name="celebrate">
    <div v-if="current" class="celebrate-mask" @click.self="close">
      <div class="celebrate-card" :style="{ '--accent-cele': current.accent }" data-testid="game-celebrate">
        <div class="celebrate-icon" :class="{ big: current.big }">{{ current.icon }}</div>
        <div class="celebrate-title">{{ current.title }}</div>
        <div class="celebrate-sub">{{ current.sub }}</div>
        <div v-if="current.events.filter(e => e.kind === 'badge').length" class="celebrate-badges">
          <span v-for="b in current.events.filter(e => e.kind === 'badge')" :key="b.badgeId" class="celebrate-badge">
            {{ b.badgeIcon }} {{ b.badgeName }}
          </span>
        </div>
        <button class="celebrate-btn" data-testid="game-celebrate-close" @click="close">太棒了，继续</button>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.confetti-canvas {
  position: fixed; inset: 0; width: 100vw; height: 100vh;
  pointer-events: none; z-index: 2000;
}
.celebrate-mask {
  position: fixed; inset: 0; z-index: 2001;
  display: grid; place-content: center;
  background: color-mix(in oklab, var(--bg) 55%, transparent);
  backdrop-filter: blur(3px);
}
.celebrate-card {
  width: min(420px, calc(100vw - 48px));
  background: var(--glass-solid, var(--surface));
  border: 1px solid var(--border-2);
  border-top: 4px solid var(--accent-cele);
  border-radius: var(--r-xl, 18px);
  padding: 28px 26px 24px;
  text-align: center;
  box-shadow: var(--sh-3, 0 20px 60px rgba(0,0,0,.35));
  animation: card-pop .45s var(--ease-out, cubic-bezier(.2,.9,.3,1.3));
}
@keyframes card-pop {
  0% { transform: scale(.8) translateY(16px); opacity: 0 }
  100% { transform: scale(1) translateY(0); opacity: 1 }
}
.celebrate-icon { font-size: 44px; line-height: 1; animation: icon-bob 1.6s ease-in-out infinite }
.celebrate-icon.big { font-size: 64px }
@keyframes icon-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-8px) } }
.celebrate-title { font-size: 22px; font-weight: 800; color: var(--text); margin: 14px 0 6px }
.celebrate-sub { font-size: 13px; color: var(--text-dim); line-height: 1.6 }
.celebrate-badges { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 14px }
.celebrate-badge {
  font-size: 12.5px; font-weight: 700; color: var(--text);
  background: color-mix(in oklab, var(--purple) 14%, var(--surface-2));
  border: 1px solid color-mix(in oklab, var(--purple) 40%, transparent);
  padding: 5px 11px; border-radius: var(--r-pill, 999px);
}
.celebrate-btn {
  margin-top: 22px; width: 100%;
  background: var(--accent-cele); color: #fff;
  border: 0; border-radius: var(--r-lg, 12px);
  padding: 11px; font-size: 14px; font-weight: 700; cursor: pointer;
  transition: filter var(--dur-fast, .15s);
}
.celebrate-btn:hover { filter: brightness(1.08) }
.celebrate-enter-active, .celebrate-leave-active { transition: opacity .3s }
.celebrate-enter-from, .celebrate-leave-to { opacity: 0 }
@media (prefers-reduced-motion: reduce) {
  .celebrate-card, .celebrate-icon { animation: none }
}
</style>
