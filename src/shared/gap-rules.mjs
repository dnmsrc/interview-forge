/**
 * R23「我不会」缺口分类的纯规则（零依赖、可被 node 直接 import 单测）。
 *
 * 为什么要放到 shared 而不是服务里：服务层 placement.ts 会拉起 sqlite/AI 依赖，
 * 纯 node 测试无法直接 import；把判定规则做成零依赖纯函数，qa 脚本才能与服务同源断言，
 * 避免「测试里复刻一份规则、上线后两份走偏」。与 placement-core.mjs 同样的组织约定。
 */

/** 「跳过」信号：用户明确表达这题不想做了，优先级最高 */
const GAP_RULE_SKIP = /跳过|不想答|不想做|先不做|不做了|算了|懒得|没兴趣|下次再|放弃|略过/
/** 「手写/编码」信号：明确指向动手实现的能力短板，比概念缺失更具体 */
const GAP_RULE_CODE = /手写|写不出|写不出来|不会写|敲代码|敲不出|敲不出来|打不出|编码|白板|实现不了|让我写|动手写|手撕|拼不出|写码/
/** 「概念/原理」信号：知识态缺失（不知道某概念是什么、没学过、看不懂） */
const GAP_RULE_CONCEPT = /不懂|不明白|不知道|不清楚|不记得|没学过|没学|没接触|没见过|概念|原理|模糊|忘了|听不懂|理解不了|是什么|啥是/

/**
 * 把用户一句「我不会」的自由描述按中文强信号归类（命中即返回，未命中返回 null 交给 AI）。
 * 判定顺序：skip → code → concept。code 先于 concept 的原因是像
 * 「原理大概懂，但让我写就写不出来」这种，短板在手写而不是概念；
 * 而「不知道 Proxy 为什么能拦截」只命中 concept 词，不会被 code 抢走。
 *
 * @param {string} note 用户原话
 * @returns {'concept'|'code'|'skip'|null} 命中时返回缺口类型，未命中返回 null
 */
export function classifyGapNote(note) {
  const t = String(note ?? '')
  if (!t.trim()) return null
  if (GAP_RULE_SKIP.test(t)) return 'skip'
  if (GAP_RULE_CODE.test(t)) return 'code'
  if (GAP_RULE_CONCEPT.test(t)) return 'concept'
  return null
}

/**
 * 把 AI 的自由输出（JSON 原文 / 英文枚举 / 中文标签 / 带解释的长句）归一化为三类之一。
 * 模型可能回 `{"gapType":"concept"}`，也可能只回一个 `code` 或「知识点不懂」，都要吃得下。
 *
 * @param {unknown} raw 模型输出原文
 * @returns {'concept'|'code'|'skip'|null} 归一化结果，无法识别返回 null
 */
export function normalizeGapKind(raw) {
  const t = String(raw ?? '').trim().toLowerCase()
  if (!t) return null
  // 1) 整段就是一个枚举词（模型最常见的裸输出：concept / CODE / {"gapType":"concept"}）
  //    先剥掉标点/空白/引号/代码块记号，规整成单词再精确比对，避免把解释长句里的 concept 误判
  const bare = t.replace(/[\s`"'{}:;,.。，、-]/g, '')
  if (bare === 'concept' || bare === 'gaptypeconcept') return 'concept'
  if (bare === 'code' || bare === 'gaptypecode') return 'code'
  if (bare === 'skip' || bare === 'gaptypeskip') return 'skip'
  // 2) 夹在解释长句里 / 只给了中文标签：按语义关键词兜底
  if (/"skip"|跳过|不答/.test(t)) return 'skip'
  if (/"code"|手写|写代码|编码|写不出/.test(t)) return 'code'
  if (/"concept"|知识点不懂|概念|原理|没学过/.test(t)) return 'concept'
  return null
}
