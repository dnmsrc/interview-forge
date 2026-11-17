/**
 * 生成后引用校验（claim guard）：拦截「材料里根本没有的技术实体」。
 *
 * 为什么必须有这一层：
 *   prompt 里写「不许编造 API」对小模型基本无用——实测 4B 模型照样会写出不存在的
 *   `queuePostFlushCb` 之类。能机械验证的绝不交给模型：把回答里的「像代码标识符的东西」
 *   逐个拿到检索材料原文里找，找不到就是无依据，直接拦。
 *
 * 设计取舍（宁可漏拦，不可误杀）：
 *   只把**有强特征**的 token 当强制校验对象——驼峰、含 . _ $、全大写缩写、字母+数字混合。
 *   纯小写英文长词（pipeline / embedding / chunking）不校验：它们是叙述性词汇，
 *   误杀会毁掉可读性，且编造它们危害远小于编造 API 名。
 *
 * 纯函数、零依赖：主进程、CLI、单测共用同一份实现。
 */

/** 通用英文词与常见缩写：出现在回答里属正常叙述，不作为无依据证据 */
const STOP_WORDS = new Set(
  ('the and for with this that from into your you are not but can will more such when what how why ' +
   'all any use used using based need like just only also then than very each other some most both ' +
   'same way get set let new old one two three four five six seven eight nine ten yes ok eg ie etc ' +
   'and or if else while for each map filter reduce slice splice push pop shift unshift ' +
   'string number boolean object array function class method value key item list data type ' +
   'true false null undefined void return import export default async await then catch try finally ' +
   'const let var interface extends implements public private protected static readonly ' +
   'left right top bottom next prev first last index count size length text name id').split(' ')
)

/** 版本号：v3.5 / 18.2.0 这类；不带 v 前缀的纯小数（1.5 倍）不在此列，避免误抓数量 */
const VERSION_RE = /\bv\d+(?:\.\d+)+(?:-[a-z0-9.]+)?\b/gi

/** 拉丁 token（允许中间带 . _ $ - ，因为 API 名与配置键常这样写） */
const TOKEN_RE = /[A-Za-z][A-Za-z0-9_$.-]*/g

/** 判断一个 token 是否「必须能在材料里找到」的强实体 */
export function isStrongEntity(tok) {
  if (!tok || tok.length < 2) return false
  const lower = tok.toLowerCase()
  if (STOP_WORDS.has(lower)) return false
  if (/^[a-z]$/.test(tok)) return false            // 单个字母：选项 A/B/C/D 之类
  if (/[._$]/.test(tok)) return true               // req.body / api_key / q4_k_m
  if (/[a-z][A-Z]/.test(tok)) return true          // nextTick / queuePostFlushCb
  if (/[A-Z]{2,}/.test(tok)) return true           // LLM / RAG / FTS5
  // 单个大写字母 + 纯数字是季度/编号（Q3、A1），不是技术标识；vue3 / p99 / FTS5 仍算强
  if (/^[A-Z]\d+$/.test(tok)) return false
  if (/[A-Za-z]+\d|\d+[A-Za-z]/.test(tok)) return true  // vue3 / http2 / p99
  return false
}

/**
 * 从一段文本里抽出需要校验的技术实体。
 * @returns {{ strong: string[], versions: string[], weak: string[] }}
 */
export function extractEntities(text) {
  const src = String(text ?? '')
  const seen = new Set()
  const strong = []
  const weak = []
  const versions = []

  for (const m of src.match(TOKEN_RE) ?? []) {
    // 去掉尾部标点（"nextTick." / "req.body," 之类）
    const tok = m.replace(/[._$.-]+$/, '')
    if (!tok) continue
    const lower = tok.toLowerCase()
    const sig = lower
    if (seen.has(sig)) continue
    seen.add(sig)
    if (isStrongEntity(tok)) strong.push(tok)
    else if (!STOP_WORDS.has(lower) && tok.length >= 3) weak.push(tok)
  }
  for (const m of src.match(VERSION_RE) ?? []) {
    const v = m.trim()
    if (!versions.includes(v)) versions.push(v)
  }
  return { strong, versions, weak }
}

/**
 * 校验回答是否有材料支撑。
 *
 * @param {string} answer    模型生成的正文
 * @param {string[]|string} materials 检索材料的原文（corpus 集合）
 * @returns {{ ok: boolean, unknown: string[], unknownVersions: string[], supportRatio: number,
 *             checked: number, message: string }}
 */
export function checkClaims(answer, materials) {
  const corpus = (Array.isArray(materials) ? materials : [materials ?? ''])
    .join('\n')
    .toLowerCase()
  const { strong, versions } = extractEntities(answer)

  const unknown = strong.filter((t) => !corpus.includes(t.toLowerCase()))
  const unknownVersions = versions.filter((v) => !corpus.includes(v.toLowerCase()))

  const checked = strong.length + versions.length
  const supported = checked - unknown.length - unknownVersions.length
  const supportRatio = checked === 0 ? 1 : supported / checked
  const ok = unknown.length === 0 && unknownVersions.length === 0

  let message = ''
  if (!ok) {
    const parts = []
    if (unknown.length) parts.push(`材料中未出现的标识符：${unknown.join('、')}`)
    if (unknownVersions.length) parts.push(`材料中未出现的版本号：${unknownVersions.join('、')}`)
    message = parts.join('；')
  } else if (checked > 0) {
    message = `${checked} 个技术实体全部可在材料中找到`
  } else {
    message = '回答中没有需要校验的技术实体'
  }

  return { ok, unknown, unknownVersions, supportRatio, checked, message }
}

/**
 * 把校验失败项拼成给模型的重试指令：明确列出「这些词不要在回答里出现」，
 * 比笼统的「别编造」有效得多（实测小模型对具体黑名单的服从度更高）。
 */
export function buildRetryHint(guardResult) {
  if (!guardResult || guardResult.ok) return ''
  const bad = [...(guardResult.unknown ?? []), ...(guardResult.unknownVersions ?? [])]
  if (!bad.length) return ''
  return `\n\n【必须修正】上一版回答出现了材料中不存在的技术名词：${bad.join('、')}。` +
    `请重写，只使用材料原文里出现过的名词，需要泛指时用中文描述，不要凭空写出具体 API/类名/配置键/版本号。`
}