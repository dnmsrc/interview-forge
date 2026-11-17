<script setup lang="ts">
/**
 * 知识图谱 · R21「双模式：闯关目录 + 关系聚焦」
 * ----------------------------------------------------------------------------
 * R19 单画布的问题（用户反馈 + 社区共识）：174 个考点 + 489 条边塞进同一张无限画布，
 * 蛇形纵向滚动没有导航价值、标签互相遮挡、路径连线只表达列表顺序、语义边制造毛球。
 * 参考 Cambridge Intelligence「hairball 不要进 UI」、Obsidian Local Graph、TheBrain
 * 的 ego network 范式，按用户任务拆成两个互斥模式：
 *
 * 模式 A · 闯关目录（LevelMap，默认）：纯 DOM 纵向手风琴章节，回答「我学到哪、下一关打谁」，
 *   不画任何连线（列表顺序即闯关顺序）；
 * 模式 B · 关系聚焦（FocusGraph）：点任意考点进入，只渲染它的一度关系子图，无关节点全隐藏，
 *   确定性辐射布局（前置在左/进阶在右/语义网在上下），点邻居即重定位中心，面包屑返回。
 *
 * 数据层零改动：9 类关系本体、graph IPC、游戏化 XP/Boss/徽章全部复用。
 */
import { computed, onActivated, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useForgeStore } from '../store'
import { useGameStore } from '../game-store'
import Icon from '../components/Icon.vue'
import KnowledgeDrawer from '../components/KnowledgeDrawer.vue'
import CelebrationModal from '../components/CelebrationModal.vue'
import BadgeWall from '../components/BadgeWall.vue'
import LevelMap from '../components/LevelMap.vue'
import FocusGraph from '../components/FocusGraph.vue'
import { DOMAIN_LABEL, TYPE_LABEL, message } from '../lib/ui'
import { ipc } from '../lib/ipc'
import { RELATION_META, RELATION_ORDER, type RelationType } from '@shared/relations'
import type { GraphNode, NodeDetail } from '@shared/types'
import { buildWorld, rankOf } from '../lib/graph-world'

const store = useForgeStore()
const game = useGameStore()
const route = useRoute()
const router = useRouter()
const badgeWallOpen = ref(false)
const visitedChapters = ref<Set<string>>(new Set())

/* ------------------------------- 掌握四态 ------------------------------- */
type StateKey = 'untouched' | 'learning' | 'mastered' | 'stale'
const stateKey = (data: any): StateKey => {
  const lv = Number(data?.masteryLevel ?? data?.mastery_level ?? 0)
  return lv === 2 ? 'mastered' : lv === 3 ? 'stale' : lv === 1 ? 'learning' : 'untouched'
}
const STATE_LABEL: Record<StateKey, string> = { untouched: '未接触', learning: '学习中', mastered: '已通关', stale: '已生疏' }

/* ------------------------------- 数据装载 ------------------------------- */
const domain = ref<string>((route.query.domain as string) || 'fe')
const rawNodes = ref<GraphNode[]>([])
const detail = ref<NodeDetail | null>(null)
const detailLoading = ref(false)
const selId = ref('')
const kw = ref('')
const onlyUnlit = ref(false)
/** 双模式：catalog 闯关目录 / focus 关系聚焦 */
const mode = ref<'catalog' | 'focus'>('catalog')
/** 聚焦中心的导航面包屑 */
const crumbs = ref<{ id: string; title: string }[]>([])

const byId = computed(() => new Map(rawNodes.value.map((n) => [n.id, n])))

/** Boss 关集合（游戏化服务提供） */
const bossIds = computed(() => game.bossNodeIds())
const beatenBossIds = computed(() => game.beatenBossNodeIds())

/** 叶子世界模型（HUD 统计与「下一关」用） */
const world = computed(() => buildWorld(domain.value, rawNodes.value))

/** 目录过滤：只看未点亮（在叶子全集上过滤后交给 LevelMap） */
const catalogNodes = computed<GraphNode[]>(() =>
  onlyUnlit.value ? rawNodes.value.filter((n) => !(n.level === 4 && n.lit === 1)) : rawNodes.value)

const overview = computed(() => {
  const leaves = world.value
  const total = leaves.length
  const lit = leaves.filter((w) => w.node.lit === 1).length
  const stale = leaves.filter((w) => stateKey(w.node) === 'stale').length
  const due = leaves.reduce((a, w) => a + (w.node.qDue ?? 0), 0)
  const pct = total ? lit / total : 0
  return { total, lit, stale, due, pct, rank: rankOf(pct) }
})

/* ------------------------------- 数据加载与详情 ------------------------------- */
function flattenTree(roots: GraphNode[]): GraphNode[] {
  const out: GraphNode[] = []
  const walk = (list: GraphNode[], parentId: string | null) => {
    for (const n of list) {
      out.push({ ...n, parent: parentId ?? n.parent ?? null })
      if (Array.isArray(n.children) && n.children.length) walk(n.children as GraphNode[], n.id)
    }
  }
  walk(roots, null)
  return out
}
async function load(opts: { keepState?: boolean } = {}) {
  await store.boot()
  rawNodes.value = flattenTree(await ipc.graph.tree(domain.value))
  try { await game.boot(domain.value) } catch (e) { console.warn('[game] 初始化失败：', e) }
  const target = route.query.node as string
  if (target && (!opts.keepState || target !== selId.value)) {
    await enterFocus(target, { pushCrumb: false })
  }
}

async function openDetail(id: string) {
  detailLoading.value = true
  try { detail.value = await ipc.graph.node(id) }
  catch (e: any) { message.error(String(e?.message ?? e)) }
  finally { detailLoading.value = false }
}

/** 进入关系聚焦模式：拉详情、切模式、记录章节探索 */
async function enterFocus(id: string, opts: { pushCrumb?: boolean } = { pushCrumb: true }) {
  const prev = detail.value?.node
  selId.value = id
  mode.value = 'focus'
  await openDetail(id)
  if (opts.pushCrumb && prev && prev.id !== id) {
    if (crumbs.value.length === 0 || crumbs.value[crumbs.value.length - 1].id !== prev.id) {
      crumbs.value.push({ id: prev.id, title: prev.title })
    }
  }
  // 上报探索章节（打开该章任意关卡即算）
  const leaf = world.value.find((w) => w.node.id === id)
  if (leaf) {
    visitedChapters.value.add(leaf.chapter.id)
    void ipc.game.reportExplorer([...visitedChapters.value]).catch(() => {})
  }
}

/** 目录点关卡 / 聚焦图点邻居，统一走这里 */
function onPick(id: string) { void enterFocus(id) }
function onNext(id: string) { void enterFocus(id) }

/** 面包屑跳回某个中心 */
function jumpCrumb(idx: number) {
  const target = crumbs.value[idx]
  crumbs.value = crumbs.value.slice(0, idx)
  if (target) void enterFocus(target.id, { pushCrumb: false })
}
function backToCatalog() {
  mode.value = 'catalog'
  selId.value = ''
  detail.value = null
  crumbs.value = []
  kw.value = ''
  hiddenTypes.value = new Set()
}

async function unlock(on: boolean) {
  if (!detail.value) return
  await ipc.graph.forceUnlock(detail.value.node.id, on)
  await load({ keepState: true })
  await openDetail(detail.value.node.id)
}
function practiceNode(id: string) { void router.push({ path: '/practice', query: { node: id } }) }

/* ------------------------------- 知识抽屉 ------------------------------- */
const kbOpen = ref(false)
const kbNodeId = ref('')
const kbNodeTitle = ref<string | null>(null)
function openKnowledge(nodeId?: string | null, title?: string | null) {
  if (!nodeId) { message.warning('该节点没有可用考点 id，没法查讲义'); return }
  kbNodeId.value = nodeId; kbNodeTitle.value = title ?? null; kbOpen.value = true
}
function onKbNavigate(id: string) {
  kbNodeId.value = id
  // 讲义双链跳到别的考点时，聚焦中心同步切换
  if (byId.value.has(id)) void enterFocus(id, { pushCrumb: true })
}
async function openBadgeWall() {
  try { await game.loadBadges(domain.value) } catch (e) { console.warn('[game] 徽章加载失败：', e) }
  badgeWallOpen.value = true
}

/* ------------------------------- 搜索 ------------------------------- */
const matched = computed(() => {
  const q = kw.value.trim().toLowerCase()
  if (!q) return []
  return rawNodes.value.filter((n) => n.domain === domain.value && String(n.title || '').toLowerCase().includes(q))
    .sort((a, b) => (b.level ?? 0) - (a.level ?? 0)).slice(0, 20)
})
let searchTimer: number | undefined
watch(kw, () => {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => {
    const q = kw.value.trim()
    if (!q) return
    const hits = matched.value
    if (!hits.length) { message.info(`没有找到含「${q}」的考点`); return }
    const leaf = hits.find((n) => n.level === 4) ?? hits[0]
    void enterFocus(leaf.id, { pushCrumb: false })
  }, 280)
})

/* ------------------------------- 关系透镜（聚焦图内类型过滤） ------------------------------- */
const hiddenTypes = ref<Set<RelationType>>(new Set())
function toggleType(t: RelationType) {
  const s = new Set(hiddenTypes.value)
  s.has(t) ? s.delete(t) : s.add(t)
  hiddenTypes.value = s
}
const relationOrder = RELATION_ORDER
const relationMeta = RELATION_META
/** 当前中心实际出现的关系类型（透镜芯片只列这些，避免空开关） */
const presentTypes = computed<RelationType[]>(() =>
  detail.value ? detail.value.relationGroups.map((g) => g.type as RelationType) : [])

watch(domain, () => {
  detail.value = null; selId.value = ''; kw.value = ''; crumbs.value = []
  hiddenTypes.value = new Set(); mode.value = 'catalog'
  void load()
})
/** 路由往返（keep-alive 激活）：带 node query 直达聚焦，否则回到闯关目录，避免聚焦态残留 */
watch(() => route.fullPath, (p) => {
  if (!p.includes('/graph')) return
  if (route.query.node) void enterFocus(String(route.query.node), { pushCrumb: false })
  else if (mode.value === 'focus') backToCatalog()
})
onMounted(load)
onActivated(() => {
  // 无 node query 的重新进入强制回目录（keep-alive 会保留上次 mode）
  if (!route.query.node && mode.value === 'focus') backToCatalog()
  void load({ keepState: true })
})
</script>

<template>
  <div class="graph-wrap graph-r21">
    <!-- 顶部工具栏 -->
    <div class="graph-toolbar">
      <n-select v-model:value="domain" size="small" style="width:118px"
        :options="Object.entries(DOMAIN_LABEL).map(([value, label]) => ({ value, label }))" />
      <n-input v-model:value="kw" size="small" placeholder="搜索考点" clearable style="width:150px" />
      <n-button v-if="mode === 'catalog'" size="small" :type="onlyUnlit ? 'primary' : 'default'" @click="onlyUnlit = !onlyUnlit">
        只看未点亮
      </n-button>
      <n-button v-else size="small" quaternary @click="backToCatalog">
        <Icon name="target" :size="14" /> 返回闯关目录
      </n-button>
    </div>

    <!-- 冒险者 HUD：等级/XP + 段位 + 总进度 + 连续打卡 + 徽章入口 -->
    <div class="adventurer-hud">
      <div class="hud-rank">
        <span class="hud-avatar">{{ game.overview?.levelIcon ?? '⚔️' }}</span>
        <div>
          <div class="hud-title">
            Lv.{{ game.overview?.level ?? 1 }} {{ game.overview?.levelTitle ?? overview.rank }}
          </div>
          <div class="hud-sub">前端征程 · {{ overview.lit }}/{{ overview.total }} 关已通关</div>
        </div>
      </div>
      <div class="hud-right">
        <div class="hud-xp" :title="`累计 ${game.overview?.xp ?? 0} XP`">
          <div class="hud-bar"><i :style="{ width: (game.overview ? game.overview.levelPct * 100 : overview.pct * 100) + '%' }" /></div>
          <span class="hud-xp-txt num">
            {{ game.overview ? `${game.overview.into}/${game.overview.span || '满'} XP` : `${Math.round(overview.pct * 100)}%` }}
          </span>
        </div>
        <div class="hud-chips">
          <span v-if="game.overview?.streak" class="hud-chip streak" :title="`连续打卡 ${game.overview.streak} 天（最长 ${game.overview.bestStreak} 天）`">
            🔥 <span class="num">{{ game.overview.streak }}</span>
          </span>
          <button class="hud-chip badge-entry" data-testid="open-badge-wall" @click="openBadgeWall" title="打开徽章墙">
            🏅 <span class="num">{{ game.overview?.badgeCount ?? 0 }}</span>/{{ game.overview?.totalBadges ?? 0 }}
          </button>
          <span v-if="overview.stale" class="hud-chip warn">↺ {{ overview.stale }}</span>
          <span v-if="overview.due" class="hud-chip hot" title="待复习题数">⏰ {{ overview.due }}</span>
        </div>
      </div>
    </div>

    <!-- 模式 A：闯关目录 -->
    <main v-if="mode === 'catalog'" class="catalog-scroll" data-testid="catalog-mode">
      <div class="catalog-head">
        <h2 class="catalog-title">🗺️ 闯关目录</h2>
        <p class="catalog-desc">沿章节顺序逐关推进；点任意关卡查看它的知识关系网。锁定关卡需先打通前置。</p>
      </div>
      <LevelMap :domain="domain" :nodes="catalogNodes" :boss-ids="bossIds" :beaten-boss-ids="beatenBossIds"
        @pick="onPick" @next="onNext" />
    </main>

    <!-- 模式 B：关系聚焦 -->
    <template v-else>
      <div class="focus-topbar" data-testid="focus-mode">
        <button class="crumb-back" @click="backToCatalog">
          <Icon name="arrowLeft" :size="14" /> 目录
        </button>
        <nav class="crumbs">
          <template v-for="(c, i) in crumbs" :key="c.id">
            <button class="crumb" @click="jumpCrumb(i)">{{ c.title }}</button>
            <Icon name="arrowRight" :size="12" class="crumb-sep" />
          </template>
          <span class="crumb-current" :title="detail?.node.title">{{ detail?.node.title }}</span>
        </nav>
      </div>

      <!-- 透镜芯片：只列当前中心实际存在的关系类型 -->
      <div v-if="presentTypes.length" class="focus-lens">
        <span class="lens-cap"><Icon name="graph" :size="13" /> 关系过滤</span>
        <button v-for="t in presentTypes" :key="t" class="lens-chip" :class="{ off: hiddenTypes.has(t) }"
          @click="toggleType(t)">
          <i class="chip-swatch" :style="{ background: `var(${relationMeta[t].colorVar})` }" />
          {{ relationMeta[t].label }}
        </button>
      </div>

      <FocusGraph v-if="detail" :detail="detail" :by-id="byId" :hidden-types="hiddenTypes"
        :boss-ids="bossIds" :beaten-boss-ids="beatenBossIds" @navigate="onPick" />

      <!-- 聚焦详情抽屉 -->
      <aside class="drawer focus-drawer" data-testid="graph-drawer">
        <header class="panel-head">
          <h3>{{ detail?.node.title }}</h3>
          <span class="grow" />
          <button class="icon-btn" data-testid="graph-drawer-close" title="关闭详情" aria-label="关闭详情" @click="backToCatalog">
            <Icon name="close" :size="16" />
          </button>
        </header>

        <template v-if="detail">
          <div class="row" style="margin-bottom:12px">
            <span class="pill" :class="'state-pill st-' + stateKey(detail.node)">{{ STATE_LABEL[stateKey(detail.node)] }}</span>
            <span class="pill lock">L{{ detail.node.level }} · {{ detail.node.stack }}</span>
            <span v-if="detail.node.must_master" class="pill purple">必考基础</span>
          </div>

          <div v-if="detail.node.summary" class="card" style="margin-bottom:12px;background:var(--surface-2)">
            <div class="tiny muted" style="margin-bottom:4px">能力要求</div>
            <div class="tiny" style="line-height:1.6">{{ detail.node.summary }}</div>
          </div>

          <n-button type="primary" block style="margin-bottom:10px" @click="practiceNode(detail.node.id)">🎯 挑战这一关</n-button>
          <n-button block secondary style="margin-bottom:12px" data-testid="graph-read-kb"
            @click="openKnowledge(detail.node.id, detail.node.title)">
            <Icon name="book" :size="14" /> 查看知识全文
          </n-button>

          <div v-if="detail.node.locked" class="fb warn" style="margin-bottom:12px">
            <h4>🔒 前置关卡未通关</h4>
            <div class="tiny">先打通左侧的前置/依存关；也可强行解锁（不推荐，容易地基不稳）。</div>
            <n-switch :value="!!detail.node.forced_unlock" size="small" style="margin-top:8px"
              @update:value="(v: boolean) => unlock(v)">
              <template #checked>已强行解锁</template><template #unchecked>按地图锁定</template>
            </n-switch>
          </div>

          <!-- 9 类关系叙事（辐射图的文字版，可跳关） -->
          <div v-if="detail.relationGroups?.length" class="rel-groups">
            <div class="section-title">知识关系网（点击可跳关）</div>
            <div v-for="g in detail.relationGroups" :key="g.type" class="rel-group">
              <div class="rel-group-head">
                <i class="lens-swatch" :style="{ background: `var(${relationMeta[g.type as RelationType]?.colorVar})` }" />
                <span class="rel-group-label">{{ g.label }}</span>
                <span class="rel-group-dir">{{ g.directed ? '有向' : '无向' }}</span>
              </div>
              <button v-for="it in g.items" :key="it.id" class="rel-item" @click="onPick(it.id)">
                <span class="rel-item-title">{{ it.title }}</span>
                <span class="rel-item-note tiny muted">{{ it.note || relationMeta[g.type as RelationType]?.hint }}</span>
                <span class="pill" :class="it.lit ? 'ok' : 'bad'">{{ it.lit ? '已通关' : '未通关' }}</span>
              </button>
            </div>
          </div>
          <div v-else class="tiny muted" style="margin:8px 0">这个考点暂时没有标注关系。</div>

          <div class="section-title" style="margin-top:14px">本关题目（{{ detail.questions?.length ?? 0 }}）</div>
          <div class="q-list">
            <div v-for="qq in detail.questions?.slice(0, 30)" :key="qq.id" class="q-item" @click="practiceNode(detail.node.id)">
              <span class="pill lock">{{ TYPE_LABEL[qq.type] }}</span>
              <span style="flex:1;font-size:12.5px;line-height:1.5">{{ qq.stem }}</span>
              <span v-if="qq.answered" class="pill" :class="(qq.bestPct ?? 0) >= 60 ? 'ok' : 'warn'">最好 {{ qq.bestPct }}</span>
              <span v-else class="pill info">未做</span>
            </div>
          </div>

          <div style="margin-top:14px">
            <div class="tiny muted" style="margin-bottom:4px">个人重要度权重（影响组卷优先级）：{{ detail.node.weight ?? 1 }}</div>
            <n-slider :value="detail.node.weight ?? 1" :min="0" :max="3" :step="0.5"
              @update:value="(v: number) => ipc.graph.setWeight(detail!.node.id, v)" />
          </div>
        </template>
      </aside>
    </template>

    <!-- 图例（目录模式） -->
    <div v-if="mode === 'catalog'" class="legend r21-legend">
      <div><i class="lg st-untouched" />未接触</div>
      <div><i class="lg st-learning" />学习中</div>
      <div><i class="lg st-mastered" />已通关 ✓</div>
      <div><i class="lg st-stale" />已生疏 ↺</div>
      <div><i class="lg lock" />🔒 未解锁</div>
    </div>

    <n-spin v-if="detailLoading" style="position:absolute;inset:0;display:grid;place-content:center;z-index:30" />
    <KnowledgeDrawer v-model:open="kbOpen" :node-id="kbNodeId" :node-title="kbNodeTitle"
      @navigate="onKbNavigate" @practice-node="(id) => { kbOpen = false; practiceNode(id) }" />
    <BadgeWall v-model:open="badgeWallOpen" :domain="domain" />
    <CelebrationModal />
  </div>
</template>

<style scoped>
.graph-r21 {
  background:
    radial-gradient(1200px 600px at 80% -10%, color-mix(in oklab, var(--accent) 8%, transparent), transparent 60%),
    var(--bg);
}

/* ---------------- 闯关目录 ---------------- */
.catalog-scroll {
  position: absolute; inset: 0; overflow: auto;
  padding: 84px 24px 90px;
}
.catalog-head { max-width: 880px; margin: 0 auto 18px; }
.catalog-title { font-size: var(--fs-2xl); font-weight: 850; margin: 0 0 6px; color: var(--text) }
.catalog-desc { font-size: var(--fs-sm); color: var(--text-faint); margin: 0; line-height: 1.6 }

/* ---------------- 聚焦模式顶栏与面包屑 ---------------- */
.focus-topbar {
  position: absolute; top: 64px; left: var(--sp-3); z-index: 9;
  display: flex; align-items: center; gap: 10px; max-width: calc(100% - 380px);
}
.crumb-back {
  display: inline-flex; align-items: center; gap: 3px;
  background: var(--glass-solid); backdrop-filter: blur(12px);
  border: 1px solid var(--border-2); border-radius: var(--r-pill);
  padding: 6px 12px; font-size: var(--fs-sm); font-weight: 700; color: var(--text-dim);
  cursor: pointer; font-family: inherit; flex: 0 0 auto;
}
.crumb-back:hover { color: var(--accent-2); border-color: var(--accent) }
.crumbs { display: flex; align-items: center; gap: 4px; min-width: 0;
  background: var(--glass-solid); backdrop-filter: blur(12px);
  border: 1px solid var(--border); border-radius: var(--r-pill); padding: 5px 12px; }
.crumb { background: transparent; border: 0; font-family: inherit; font-size: var(--fs-xs);
  color: var(--accent-2); cursor: pointer; padding: 0; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.crumb:hover { text-decoration: underline }
.crumb-sep { color: var(--text-faint); flex: 0 0 auto }
.crumb-current { font-size: var(--fs-sm); font-weight: 800; color: var(--text);
  max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }

.focus-lens {
  position: absolute; left: var(--sp-3); bottom: var(--sp-3); z-index: 9;
  display: flex; align-items: center; gap: 7px; flex-wrap: wrap; max-width: calc(100% - 380px);
  background: var(--glass-solid); backdrop-filter: blur(12px);
  border: 1px solid var(--border); border-radius: var(--r-lg); padding: 8px 12px; box-shadow: var(--sh-2);
}
.lens-cap { display: inline-flex; align-items: center; gap: 4px; font-size: var(--fs-xs);
  font-weight: 800; color: var(--text-dim); margin-right: 2px }
.lens-chip {
  display: inline-flex; align-items: center; gap: 5px;
  border: 1px solid var(--border-2); background: var(--surface);
  border-radius: var(--r-pill); padding: 4px 10px; font-size: var(--fs-xs); font-weight: 700;
  color: var(--text); cursor: pointer; font-family: inherit; transition: opacity var(--dur-fast), border-color var(--dur-fast);
}
.lens-chip .chip-swatch { width: 10px; height: 10px; border-radius: 3px }
.lens-chip.off { opacity: .38; text-decoration: line-through }
.lens-chip:hover { border-color: var(--accent) }

/* ---------------- 冒险者 HUD（沿用 R20） ---------------- */
.adventurer-hud {
  position: absolute; top: var(--sp-3); left: var(--sp-3); z-index: 8;
  display: flex; align-items: center; gap: var(--sp-3);
  background: var(--glass-solid); backdrop-filter: blur(14px);
  border: 1px solid var(--border-2); border-radius: var(--r-lg);
  padding: 10px 16px; box-shadow: var(--sh-3); min-width: 360px; max-width: 460px;
}
.hud-rank { display: flex; align-items: center; gap: 10px; flex: 0 0 auto }
.hud-avatar { font-size: 26px }
.hud-title { font-size: var(--fs-md); font-weight: 800; color: var(--text); white-space: nowrap }
.hud-sub { font-size: 10.5px; color: var(--text-faint); white-space: nowrap }
.hud-right { flex: 1; display: flex; flex-direction: column; gap: 6px; min-width: 0 }
.hud-xp { display: flex; align-items: center; gap: 8px }
.hud-bar { flex: 1; height: 9px; background: var(--surface-3); border-radius: var(--r-pill); overflow: hidden; min-width: 70px }
.hud-bar i { display: block; height: 100%; border-radius: var(--r-pill);
  background: linear-gradient(90deg, var(--accent), var(--purple)); transition: width var(--dur-slow) var(--ease-out) }
.hud-xp-txt { font-size: 10px; color: var(--text-dim); white-space: nowrap; font-variant-numeric: tabular-nums }
.hud-chips { display: flex; align-items: center; gap: 6px; flex-wrap: wrap }
.hud-chip {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: var(--r-pill);
  background: var(--surface-2); border: 1px solid var(--border); color: var(--text-dim);
}
.hud-chip.streak { color: var(--hot); border-color: color-mix(in oklab, var(--hot) 40%, transparent); background: color-mix(in oklab, var(--hot) 12%, var(--surface)) }
.hud-chip.warn { color: var(--hot) }
.hud-chip.hot { color: var(--hot) }
button.hud-chip.badge-entry { cursor: pointer; font-family: inherit; transition: background var(--dur-fast), transform var(--dur-fast) }
button.hud-chip.badge-entry:hover { background: color-mix(in oklab, var(--purple) 16%, var(--surface-2)); transform: translateY(-1px) }

/* ---------------- 图例 ---------------- */
.r21-legend {
  display: flex; gap: 14px; flex-wrap: wrap; left: var(--sp-3); transform: none;
  bottom: var(--sp-3); width: auto; max-width: calc(100% - 24px);
  position: absolute; z-index: 7;
  background: var(--glass-solid); backdrop-filter: blur(10px);
  border: 1px solid var(--border); border-radius: var(--r-lg); padding: 8px 14px; box-shadow: var(--sh-1);
}
.r21-legend i.lg { width: 12px; height: 12px; border-radius: 50% }
.r21-legend i.lg.st-untouched { background: var(--text-faint) }
.r21-legend i.lg.st-learning { background: var(--warn) }
.r21-legend i.lg.st-mastered { background: var(--ok) }
.r21-legend i.lg.st-stale { background: var(--hot) }
.r21-legend i.lg.lock { background: var(--surface-3); border: 1.5px solid var(--border-2) }

/* ---------------- 抽屉 ---------------- */
.focus-drawer { z-index: 20; width: 348px }
.rel-groups { display: grid; gap: 10px }
.rel-group { border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden }
.rel-group-head { display: flex; align-items: center; gap: 7px; padding: 7px 10px; background: var(--surface-2) }
.rel-group-label { font-size: var(--fs-sm); font-weight: 700; color: var(--text) }
.rel-group-dir { margin-left: auto; font-size: 10px; color: var(--text-faint) }
.rel-item { width: 100%; display: flex; flex-direction: column; gap: 3px; text-align: left;
  background: transparent; border: 0; border-bottom: 1px solid var(--border); padding: 8px 10px; cursor: pointer;
  transition: background var(--dur-fast); font-family: inherit }
.rel-item:last-child { border-bottom: 0 }
.rel-item:hover { background: var(--surface-2) }
.rel-item-title { font-size: var(--fs-sm); font-weight: 600; color: var(--text); display: flex; justify-content: space-between; gap: 8px; align-items: center }
.rel-item-note { line-height: 1.4 }
.lens-swatch { width: 12px; height: 12px; border-radius: 3px; flex: 0 0 auto }

/* 抽屉与聚焦图留出间距 */
.graph-r21 :deep(.vue-flow) { right: 360px }
</style>
