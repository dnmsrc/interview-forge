/**
 * 自适应摸底「边界探测」状态机（零依赖纯函数，v18）。
 *
 * 设计（用户诉求）：不预设固定题量，由浅入深一道道做、动态推送，直到能判准水准即停。
 *   1. 每个模块先 1 道最基础的探针题；
 *   2. 探针通过（scale4≥2）→ 进入 climbing：沿同方向逐级上探更难的题（同节点更难母题 → advance 后继链）；
 *   3. 探针或爬升中一旦不会（scale4≤1 或主动标缺口）→ 该模块立即 capped 收束，
 *      默认后续进阶题都不会，不再纠缠；边界就是最后答对的位置；
 *   4. 爬到该路径无题可出（到顶）→ topped 收束；所有模块都收束即摸底结束。
 *
 * 本文件只做「状态怎么变」，不含任何 SQL / electron，CLI 单测与主进程服务共用同一份规则
 * （约束同 knowledge-core.mjs / ai-error-core.mjs）。节点与题目选择由 placement.ts 用 DB 完成，
 * 再把结果交给这里回写状态。
 */

export const PLACEMENT_VERSION = 18

/** 探针/爬升判定：达到 2 档（能独立说清机制）算「会」，继续；0/1 档算「不会」，收束 */
export function isPass(scale4) {
  return Number(scale4) >= 2
}

/** 模块四态：待探针 / 爬升中 / 不会收束 / 到顶收束 */
export const MODULE_STATE = { PROBING: 'probing', CLIMBING: 'climbing', CAPPED: 'capped', TOPPED: 'topped' }

/**
 * @typedef {Object} ModuleState
 * @property {string} state      probing | climbing | capped | topped
 * @property {string|null} lastNode  本模块最近作答的叶子节点（爬升沿它找 advance 后继）
 * @property {boolean} probed   是否已经完成探针
 * @property {number} turns     本模块已作答题数
 * @property {number} pass      本模块答对（scale4≥2）题数
 */

/** 初始化调度态：moduleOrder 由服务层按学习阶段排序后传入 */
export function emptyPlacement18(moduleOrder = []) {
  const modules = {}
  for (const id of moduleOrder) {
    modules[id] = { state: MODULE_STATE.PROBING, lastNode: null, probed: false, turns: 0, pass: 0 }
  }
  return { v: PLACEMENT_VERSION, moduleOrder: [...moduleOrder], modules }
}

/** 旧会话/续测惰性接入：没有 v18 状态时按当前模块队列重建（已作答情况由服务层通过 recordAnswer 补回） */
export function isPlacement18(state) {
  return !!state && state.v === PLACEMENT_VERSION && state.modules
}

/**
 * 回写一轮作答结果，返回更新后的模块状态（纯函数，不改入参）。
 * @param {object} prev      v18 调度态
 * @param {string} moduleId  当前题所属 L2 模块
 * @param {object} turn      { nodeId, scale4, isGap }
 */
export function recordAnswer(prev, moduleId, turn) {
  const next = structuredClone(prev)
  if (!next.modules[moduleId]) {
    next.modules[moduleId] = { state: MODULE_STATE.PROBING, lastNode: null, probed: false, turns: 0, pass: 0 }
    if (!next.moduleOrder.includes(moduleId)) next.moduleOrder.push(moduleId)
  }
  const m = next.modules[moduleId]
  const pass = isPass(turn.scale4) && !turn.isGap
  m.turns += 1
  if (pass) m.pass += 1
  m.lastNode = turn.nodeId ?? m.lastNode

  if (!m.probed) {
    // 探针轮
    m.probed = true
    m.state = pass ? MODULE_STATE.CLIMBING : MODULE_STATE.CAPPED
    return next
  }
  // 爬升轮：不会即收束；会则继续爬（是否到顶由服务层选题结果决定，再调用 markTopped）
  if (!pass) m.state = MODULE_STATE.CAPPED
  return next
}

/** 模块在当前路径上已无题可出（同节点更难题与 advance 后继都穷尽）→ 到顶收束 */
export function markTopped(prev, moduleId) {
  const next = structuredClone(prev)
  const m = next.modules[moduleId]
  if (m && m.state !== MODULE_STATE.CAPPED) m.state = MODULE_STATE.TOPPED
  return next
}

/** 下一个该出题的模块：探针阶段按学习顺序取首个 probing；探针做完后取首个 climbing。null=全部收束 */
export function nextPendingModule(state) {
  const probing = state.moduleOrder.find((id) => state.modules[id]?.state === MODULE_STATE.PROBING)
  if (probing) return { moduleId: probing, phase: 'probe' }
  const climbing = state.moduleOrder.find((id) => state.modules[id]?.state === MODULE_STATE.CLIMBING)
  if (climbing) return { moduleId: climbing, phase: 'climb' }
  return null
}

/** 所有模块都已收束（capped/topped），摸底可以结束 */
export function allSettled(state) {
  const list = state.moduleOrder.map((id) => state.modules[id]?.state)
  return list.length > 0 && list.every((s) => s === MODULE_STATE.CAPPED || s === MODULE_STATE.TOPPED)
}

/**
 * 进度：done=已收束模块数，total=模块数。前端用它替代「已探考点/全部叶子」的庞分母，
 * 避免用户看到要做几百题的错觉。
 */
export function progressOf18(state) {
  const total = state.moduleOrder.length
  const done = state.moduleOrder.filter((id) => {
    const s = state.modules[id]?.state
    return s === MODULE_STATE.CAPPED || s === MODULE_STATE.TOPPED
  }).length
  return { done, total }
}

/** 一句话状态文案（前端 hint 用）：告诉用户现在处于扫盲还是爬升、整体还要探几个模块 */
export function describeState(state) {
  const probing = state.moduleOrder.filter((id) => state.modules[id]?.state === MODULE_STATE.PROBING).length
  const climbing = state.moduleOrder.filter((id) => state.modules[id]?.state === MODULE_STATE.CLIMBING).length
  const settled = progressOf18(state).done
  if (probing > 0) return { phase: 'probe', text: `模块扫盲中，还需探 ${probing} 个模块；会就往深里考，不会立刻收束` }
  if (climbing > 0) return { phase: 'climb', text: `正在 ${climbing} 个你表现不错的方向上逐级加难，探到你的能力边界为止` }
  return { phase: 'done', text: `已收束 ${settled} 个方向，摸底完成` }
}
