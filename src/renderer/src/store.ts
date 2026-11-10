import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { AppSettings, DailyPlan, DashboardSummary } from '@shared/types'
import { ipc } from './lib/ipc'

export const useForgeStore = defineStore('forge', () => {
  const settings = ref<AppSettings | null>(null)
  const bankStats = ref<any>(null)
  const gaps = ref<any>(null)
  const plan = ref<DailyPlan | null>(null)
  const dash = ref<DashboardSummary | null>(null)
  const paths = ref<{ db: string; content: string; snapshots: string } | null>(null)
  const runtime = ref<{ app: string; electron: string; node: string; sqlite: boolean } | null>(null)
  const aiHealth = ref<Record<string, { ok: boolean; message: string }>>({})
  const booted = ref(false)

  const endpointById = computed(() => {
    const m = new Map<string, AppSettings['endpoints'][number]>()
    for (const e of settings.value?.endpoints ?? []) m.set(e.id, e)
    return m
  })
  const activeFast = computed(() => endpointById.value.get(settings.value?.routing.fastEndpointId ?? '') ??
    (settings.value?.endpoints ?? []).find((e) => e.role === 'fast' && e.enabled !== false))
  const activeStrong = computed(() => endpointValue('strong'))
  function endpointValue(role: 'fast' | 'strong') {
    const list = settings.value?.endpoints ?? []
    const forced = role === 'fast' ? settings.value?.routing.fastEndpointId : settings.value?.routing.strongEndpointId
    return (forced && endpointById.value.get(forced)) || list.find((e) => e.role === role && e.enabled !== false) || (role === 'strong' ? undefined : list.find((e) => e.enabled !== false))
  }
  const anyEndpoint = computed(() => (settings.value?.endpoints ?? []).some((e) => e.enabled !== false))

  async function boot() {
    if (booted.value) return
    await Promise.all([loadSettings(), loadBank(), loadPlan(), loadPaths()])
    booted.value = true
  }
  async function loadSettings() { settings.value = await ipc.settings.all() }
  async function loadBank() {
    bankStats.value = await ipc.bank.stats()
    gaps.value = await ipc.bank.gaps({ perNodeTarget: 3 })
  }
  async function loadPlan() { plan.value = await ipc.daily.plan() }
  async function loadDash() { dash.value = await ipc.dashboard.summary() }
  async function loadPaths() {
    paths.value = await ipc.app.paths()
    runtime.value = await ipc.app.versions()
  }
  async function setSetting(key: string, value: unknown) {
    await ipc.settings.set(key, value)
    await loadSettings()
  }
  async function testAllEndpoints() {
    for (const ep of settings.value?.endpoints ?? []) {
      if (ep.enabled === false) continue
      aiHealth.value[ep.id] = { ok: false, message: '测试中…' }
      const r = await ipc.ai.test(ep)
      aiHealth.value[ep.id] = { ok: r.ok, message: `${r.message}（${r.latency}ms）` }
    }
  }

  return {
    settings, bankStats, gaps, plan, dash, paths, runtime, aiHealth, booted,
    activeFast, activeStrong, anyEndpoint, endpointById,
    boot, loadSettings, loadBank, loadPlan, loadDash, loadPaths, setSetting, testAllEndpoints
  }
})
