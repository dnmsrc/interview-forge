/**
 * 项目闯关 ↔ 知识图谱覆盖统计（纯函数，不碰文件系统）。
 *
 * 为什么单独成模块：
 * 1) 主进程要给「项目闯关」页算覆盖总览，CI 脚本要算覆盖率，两边必须是同一份口径——
 *    否则页面上说 60%、脚本说 58%，补内容的人不知道该信哪个。
 * 2) 覆盖口径本身就是产品决策，值得写进代码而不是散在 UI 里：
 *
 *    - 统计对象是知识图谱里 level 3（topic 摘要）与 level 4（具体知识点）的节点，
 *      即「用户真正要学的知识点」；level 1/2 是领域/技术栈的聚合根，不单独计覆盖。
 *    - 一个知识点被「覆盖」= 至少有一关在 nodes 里显式声明了它。声明不是标签，
 *      是承诺：这一关的讲解、API 契约和检查点确实围绕它设计（构建时人工审，机检兜底线）。
 *    - 允许一个知识点被多关覆盖（同一概念在不同项目里以不同角度出现是好事），
 *      覆盖率按「被至少一关覆盖」计，不按次数。
 */

/**
 * 从知识图谱节点数组建立索引。
 * @param {Array<{id:string,title?:string,level?:number,domain?:string,stack?:string,topic?:string,mustMaster?:boolean,summary?:string}>} nodes
 */
export function indexNodes(nodes) {
  const byId = new Map()
  for (const n of nodes) {
    if (!n?.id) continue
    byId.set(n.id, n)
  }
  return byId
}

/** 节点 id 的段：domain.stack.topic.sub…；level 3 是 topic 根，level 4 是具体知识点 */
function segments(id) {
  return String(id).split('.')
}

/** 一个节点是否计入覆盖目标：L3 / L4（L1/L2 是聚合根） */
export function isCoverageTarget(node) {
  const lvl = Number(node?.level ?? segments(node?.id ?? '').length)
  return lvl >= 3
}

/** topic 归属：domain.stack.topic（前三段）；不足三段时退回整个 id */
export function topicKey(id) {
  const seg = segments(id)
  return seg.length >= 3 ? seg.slice(0, 3).join('.') : String(id)
}

/** stack 归属：domain.stack（前两段） */
export function stackKey(id) {
  const seg = segments(id)
  return seg.length >= 2 ? seg.slice(0, 2).join('.') : String(id)
}

/**
 * 统一入口：把项目内容与知识图谱节点合起来，算出覆盖账。
 *
 * @param {Array<{id:string,domain?:string,title?:string,levels:Array<{id:string,title?:string,nodes?:string[]}>}>} projects
 * @param {Array<object>} nodes
 * @returns {{
 *   totalTargets: number, covered: number, missing: number, ratio: number,
 *   byDomain: Array<{key:string,total:number,covered:number,ratio:number}>,
 *   byStack: Array<{key:string,total:number,covered:number,ratio:number}>,
 *   byNode: Array<{id:string,title:string,level:number,domain:string,stack:string,topic:string,mustMaster:boolean,projects:string[]}>,
 *   missingNodes: Array<object>,
 *   invalid: Array<{project:string,level:string,node:string,reason:string}>,
 *   unmappedLevels: Array<{project:string,level:string}>,
 *   extra: number
 * }}
 */
export function computeCoverage(projects, nodes) {
  const byId = indexNodes(nodes)
  /** nodeId -> 覆盖它的「项目/关卡」标签集合 */
  const hits = new Map()
  const invalid = []
  const unmappedLevels = []

  for (const p of projects) {
    for (const lv of p.levels ?? []) {
      const list = Array.isArray(lv.nodes) ? lv.nodes : []
      if (!list.length) {
        unmappedLevels.push({ project: p.id, level: lv.id })
        continue
      }
      const seen = new Set()
      for (const raw of list) {
        const id = String(raw ?? '').trim()
        if (!id) {
          invalid.push({ project: p.id, level: lv.id, node: id, reason: '空节点 id' })
          continue
        }
        if (seen.has(id)) {
          invalid.push({ project: p.id, level: lv.id, node: id, reason: '同一关重复声明' })
          continue
        }
        seen.add(id)
        if (!byId.has(id)) {
          invalid.push({ project: p.id, level: lv.id, node: id, reason: '知识图谱里没有这个节点' })
          continue
        }
        const label = `${p.id}/${lv.id}`
        const set = hits.get(id)
        if (set) set.push(label)
        else hits.set(id, [label])
      }
    }
  }

  const targets = nodes.filter(isCoverageTarget)
  const covered = targets.filter((n) => hits.has(n.id))

  const bucket = (keyFn) => {
    const m = new Map()
    for (const n of targets) {
      const key = keyFn(n)
      const b = m.get(key) ?? { key, total: 0, covered: 0 }
      b.total++
      if (hits.has(n.id)) b.covered++
      m.set(key, b)
    }
    return [...m.values()]
      .map((b) => ({ ...b, ratio: b.total ? b.covered / b.total : 0 }))
      .sort((a, b) => a.key.localeCompare(b.key))
  }

  const byNode = targets.map((n) => ({
    id: n.id,
    title: n.title ?? '',
    level: Number(n.level ?? 0),
    domain: n.domain ?? segments(n.id)[0] ?? '',
    stack: stackKey(n.id),
    topic: topicKey(n.id),
    mustMaster: !!n.mustMaster,
    projects: hits.get(n.id) ?? []
  }))

  return {
    totalTargets: targets.length,
    covered: covered.length,
    missing: targets.length - covered.length,
    ratio: targets.length ? covered.length / targets.length : 0,
    byDomain: bucket((n) => n.domain ?? segments(n.id)[0] ?? '?'),
    byStack: bucket((n) => stackKey(n.id)),
    byNode,
    missingNodes: byNode.filter((n) => !n.projects.length),
    invalid,
    unmappedLevels,
    extra: 0
  }
}