import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ipc } from './lib/ipc'
import type { GameOverviewDto, BadgeWallItem, GameEventDto, BossStage, ChapterProgressDto } from '@shared/game'

/**
 * 游戏化全局状态（R20）：HUD 概览、徽章墙、庆祝事件。
 * 与业务 store 解耦：练习/考试提交后由各页面调用 syncAfterSettle 拉最新概览与未读事件，
 * 庆祝弹窗只认 pendingEvents 队列，drain 后清空，重开应用也能从 game_events 补回未展示奖励。
 */
export const useGameStore = defineStore('game', () => {
  const overview = ref<GameOverviewDto | null>(null)
  const badges = ref<BadgeWallItem[]>([])
  const bosses = ref<BossStage[]>([])
  const chapters = ref<ChapterProgressDto[]>([])
  const pendingEvents = ref<GameEventDto[]>([])
  const loaded = ref(false)

  async function loadOverview() {
    overview.value = await ipc.game.overview()
  }
  async function loadBadges(domain = 'fe') {
    badges.value = await ipc.game.badges(domain)
  }
  async function loadBosses(domain = 'fe') {
    bosses.value = await ipc.game.bosses(domain)
    chapters.value = await ipc.game.chapters(domain)
  }

  /** 进页面：拉概览 + 只读未读事件（不标已读，避免用户没看到就被清掉） */
  async function boot(domain = 'fe') {
    await Promise.all([loadOverview(), loadBosses(domain)])
    const evs = await ipc.game.events()
    if (evs.length) pendingEvents.value = [...pendingEvents.value, ...evs].filter(uniqEvent)
    loaded.value = true
  }

  /** 作答/考试结算后：刷新概览，把新产生的未读事件入队并标记已读 */
  async function syncAfterSettle() {
    await loadOverview()
    const evs = await ipc.game.drainEvents()
    if (evs.length) pendingEvents.value = [...pendingEvents.value, ...evs].filter(uniqEvent)
    return evs
  }

  /** 弹窗展示完一批后清队列，并向主进程确认这些事件已读（drain 会把库中未读置 read=1） */
  async function clearEvents() {
    pendingEvents.value = []
    try { await ipc.game.drainEvents() } catch { /* 已读标记失败不影响使用，下次仍可重复弹窗 */ }
  }

  function dismissEvent(idx: number) {
    pendingEvents.value.splice(idx, 1)
  }

  const bossNodeIds = () => new Set(bosses.value.map((b) => b.nodeId))
  const beatenBossNodeIds = () =>
    new Set(chapters.value.filter((c) => c.boss?.beaten).map((c) => c.boss!.nodeId))

  return {
    overview, badges, bosses, chapters, pendingEvents, loaded,
    loadOverview, loadBadges, loadBosses, boot, syncAfterSettle, clearEvents, dismissEvent,
    bossNodeIds, beatenBossNodeIds
  }
})

function uniqEvent(e: GameEventDto, i: number, arr: GameEventDto[]): boolean {
  return arr.findIndex((x) => eventKey(x) === eventKey(e)) === i
}
function eventKey(e: GameEventDto): string {
  return `${e.kind}:${e.badgeId ?? e.nodeId ?? e.level ?? e.title ?? e.text ?? ''}`
}
