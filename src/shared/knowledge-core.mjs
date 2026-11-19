/**
 * 知识体系核心纯函数（契约：docs/design/KNOWLEDGE-SYSTEM.md §2 / §9）
 *
 * 这里只放**零依赖的纯函数**：主进程 services/knowledge.ts 与 scripts/kb-index.mjs
 * 共用同一份解析、分词与质量闸门，保证「应用里看到的」和「CI 里校验的」是同一套规则。
 * 因此本文件禁止 import electron / node:sqlite / fs —— CLI 脚本 import src/main 下的
 * 任何文件都会被 electron 拖死。
 */

/** §2.1 固定七个二级小节；缺哪个索引就 warn（渲染侧会自动跳过） */
export const REQUIRED_SECTIONS = [
  '一句话本质',
  '为什么需要它',
  '机制讲清楚',
  '关键结论',
  '常见误区',
  '常见问法',
  '前置知识',
  '相关'
]

/** 「一句话本质」小节名（列表页摘要取这里） */
export const SUMMARY_SECTION = '一句话本质'

/** §9 质量闸门阈值 */
export const MIN_WORDS = 900

/* ------------------------------------------------------------------ *
 * frontmatter（YAML 子集）解析
 * ------------------------------------------------------------------ */

/** 去掉 BOM、统一换行，避免 Windows CRLF 把 YAML 值带尾随 \r */
export function normalizeText(text) {
  return String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
}

/** 去掉行尾注释：引号内部的 # 不算注释 */
function stripComment(line) {
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === "'" && !inDouble) inSingle = !inSingle
    else if (c === '"' && !inSingle) inDouble = !inDouble
    else if (c === '#' && !inSingle && !inDouble) return line.slice(0, i)
  }
  return line
}

/** 标量转换：只支持本项目需要的类型（字符串/数字/布尔/null） */
function parseScalar(raw) {
  const s = String(raw ?? '').trim()
  if (s === '') return ''
  const quote = s[0]
  if ((quote === '"' || quote === "'") && s.length > 1 && s.endsWith(quote)) {
    const inner = s.slice(1, -1)
    // 双引号才处理转义；单引号按 YAML 规则只有 '' → '
    if (quote === '"') {
      return inner.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    }
    return inner.replace(/''/g, "'")
  }
  // flow 序列 [a, b]：本项目只用得到极简形态，够解析就行
  if (s.startsWith('[') && s.endsWith(']')) {
    const body = s.slice(1, -1).trim()
    if (!body) return []
    return body.split(',').map((x) => parseScalar(x)).filter((x) => x !== '')
  }
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  if (s === 'true') return true
  if (s === 'false') return false
  if (s === 'null' || s === '~') return null
  return s
}

/** 缩进块解析：支持「标量」「字符串数组」「对象数组」以及一层嵌套映射 */
function parseBlock(lines, start, indent) {
  const isList = /^\s*-(\s|$)/.test(lines[start] ?? '')
  if (isList) {
    const items = []
    let i = start
    while (i < lines.length) {
      const raw = lines[i]
      const ind = leadingIndent(raw)
      if (ind < indent) break
      if (ind > indent) { i++; continue }          //  deeper 行交给下面的递归吃
      const m = /^(\s*)-(\s*)(.*)$/.exec(raw)
      if (!m) break
      const after = m[3] ?? ''
      // 键的真实列号 = 前导空格 + 「-」占 1 列 + 「-」后的空格数；
      // 同项的兄弟键（title/kind…）与首个键对齐，缩进必须按这一列判定。
      const contentIndent = m[1].length + 1 + m[2].length
      const item = stripComment(after).trim()
      if (item === '') {
        // 纯容器项：值在后续更深缩进的行里
        const nested = findValueStart(lines, i + 1, indent)
        if (nested < 0) { items.push(null); i++; continue }
        const [val, next] = parseBlock(lines, nested, leadingIndent(lines[nested]))
        items.push(val)
        i = next
        continue
      }
      // 只有「无空格键名 + 冒号」才算对象项（`- url: https://…`），
      // 否则整项按字符串处理（中文条目里常见全角冒号，不会误判）
      const kv = /^([^\s:]{1,64}):(?:\s+(.*))?$/.exec(item)
      if (!kv || item.startsWith('"') || item.startsWith("'")) {
        items.push(parseScalar(item))
        i++
        continue
      }
      // 列表项本身是映射：把 `- ` 换成等宽空格再交给 map 分支吃，
      // 这样同项后续兄弟键（title/kind）会自然并入同一个对象。
      // （lines 是本函数私有的切片，就地改写安全）
      lines[i] = ' '.repeat(contentIndent) + item
      const [obj, next] = parseBlock(lines, i, contentIndent)
      items.push(obj ?? {})
      i = Math.max(next, i + 1)
    }
    return [items, i]
  }

  // 映射块
  const map = {}
  let i = start
  while (i < lines.length) {
    const line = stripComment(lines[i])
    if (leadingIndent(line) < indent) break
    const m = /^(\s*)([^:#]+?)\s*:\s*(.*)$/.exec(line)
    if (!m) { i++; continue }
    const key = m[2].trim().replace(/^["']|["']$/g, '')
    const rest = m[3].trim()
    if (rest !== '') {
      map[key] = parseScalar(rest)
      i++
      continue
    }
    const nested = findValueStart(lines, i + 1, indent)
    if (nested < 0) { map[key] = null; i++; continue }
    const [val, next] = parseBlock(lines, nested, leadingIndent(lines[nested]))
    map[key] = val
    i = Math.max(next, i + 1)
  }
  return [map, i]
}

function leadingIndent(line) {
  const m = /^\s*/.exec(String(line ?? ''))
  return m ? m[0].length : 0
}

/** 找到第一个属于 parentIndent 子级的非空行（列表项允许与父级同缩进） */
function findValueStart(lines, from, parentIndent) {
  for (let i = from; i < lines.length; i++) {
    const l = lines[i]
    if (!l || l.trim() === '') continue
    const ind = leadingIndent(l)
    const isListItem = /^\s*-(\s|$)/.test(l)
    if (ind > parentIndent || (isListItem && ind === parentIndent)) return i
    return -1
  }
  return -1
}

/**
 * 解析 frontmatter（只支持本项目用到的简单 YAML 结构）。
 * @returns {{ meta: Record<string, any>, bodyMd: string }}
 */
export function parseFrontmatter(text) {
  const src = normalizeText(text)
  if (!src.startsWith('---')) return { meta: {}, bodyMd: src }
  const end = src.indexOf('\n---', 3)
  if (end < 0) return { meta: {}, bodyMd: src }
  const fmText = src.slice(src.indexOf('\n') + 1, end)
  let bodyMd = src.slice(end + 4)
  if (bodyMd.startsWith('\n')) bodyMd = bodyMd.slice(1)

  const lines = fmText.split('\n').filter((l) => l.trim() !== '' && stripComment(l).trim() !== '')
  const [meta] = lines.length ? parseBlock(lines, 0, leadingIndent(lines[0])) : [{}, 0]
  return { meta: meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {}, bodyMd }
}

/* ------------------------------------------------------------------ *
 * 小节切分
 * ------------------------------------------------------------------ */

/**
 * 按 `## 标题` 切小节（跳过代码围栏内的 ## 行）。
 * @returns {{ sections: Record<string,string>, sectionOrder: string[], bodyMd: string }}
 */
export function splitSections(bodyMd) {
  const src = normalizeText(bodyMd)
  const lines = src.split('\n')
  const sections = {}
  const order = []
  let current = null
  let buf = []
  let fence = null
  const flush = () => {
    if (current === null) return
    const text = buf.join('\n').replace(/\s+$/, '')
    if (!(current in sections)) sections[current] = text
    order.push(current)
  }
  for (const line of lines) {
    const fenceMatch = /^\s*(```|~~~)/.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      if (fence === null) fence = marker
      else if (line.trim().startsWith(fence)) fence = null
    }
    const head = fence === null ? /^##\s+(.+?)\s*$/.exec(line) : null
    if (head) {
      flush()
      current = head[1].trim()
      buf = []
      continue
    }
    if (current !== null) buf.push(line)
  }
  flush()
  return { sections, sectionOrder: order, bodyMd: src }
}

/** 一步出「meta + sections + bodyMd」（契约要求的 parseKnowledgeMd 形状） */
export function parseKnowledgeMd(text) {
  const { meta, bodyMd } = parseFrontmatter(text)
  const { sections, sectionOrder } = splitSections(bodyMd)
  return { meta, sections, sectionOrder, bodyMd }
}

/* ------------------------------------------------------------------ *
 * 中文检索分词
 * ------------------------------------------------------------------ */

/**
 * CJK 词内字符判定：中日韩统一表意文字（BMP 主区 + 扩展 A + 兼容区）+ 假名。
 * 「」《》、，。（）等 CJK 标点（U+3000-U+303F / U+FF00-U+FFEF）不算词内字符，
 * 一律当分隔符丢弃，否则会把不相干的字黏成假 bigram。
 */
function isCjkWordChar(ch) {
  const c = ch.codePointAt(0)
  return (
    (c >= 0x4e00 && c <= 0x9fff) ||   // 统一表意文字
    (c >= 0x3400 && c <= 0x4dbf) ||   // 扩展 A
    (c >= 0xf900 && c <= 0xfaff) ||   // 兼容表意文字
    (c >= 0x3040 && c <= 0x30ff)      // 平假名 / 片假名
  )
}

function isLatinWordChar(ch) {
  return /[A-Za-z0-9_$]/.test(ch)
}

/**
 * 建索引 / 查询共用的分词（这是中文能不能搜到的关键）：
 * - CJK 连续段：输出「单字 + 相邻二字组合」。FTS5 用 unicode61 时查询串里的中文
 *   会被再切成单字（如「编译器」→ 编/译/器），所以索引必须同时存单字，否则 AND 语义下
 *   永远搜不到；二字组合则让「懒代理」「编译器」这类术语在文档里紧邻时可被精确命中。
 * - 拉丁/数字串：整词小写（proxy / 3.5 / vue）。
 * - 其余（空白、中英文标点）一律丢弃，token 之间用空格连接。
 * 中英混排「Proxy 懒代理」→ proxy 懒 代 理 懒代 代理。
 */
export function tokenizeForSearch(text) {
  const src = normalizeText(text).toLowerCase()
  const tokens = []
  let cjkRun = []
  let latinRun = ''
  const flushCjk = () => {
    const n = cjkRun.length
    if (!n) return
    for (let i = 0; i < n; i++) tokens.push(cjkRun[i])
    for (let i = 0; i + 1 < n; i++) tokens.push(cjkRun[i] + cjkRun[i + 1])
    cjkRun = []
  }
  const flushLatin = () => {
    if (latinRun) { tokens.push(latinRun); latinRun = '' }
  }
  for (const ch of src) {
    if (isCjkWordChar(ch)) { flushLatin(); cjkRun.push(ch); continue }
    if (isLatinWordChar(ch)) { flushCjk(); latinRun += ch; continue }
    flushCjk(); flushLatin()
  }
  flushCjk(); flushLatin()
  // 去重并排序：BM25 只关心词频，字典序排列便于人工核对分词结果
  return Array.from(new Set(tokens)).sort().join(' ')
}

/** FTS5 短语转义：串里的双引号翻倍即可 */
export function quoteFtsTerm(term) {
  return `"${String(term ?? '').replace(/"/g, '""')}"`
}

/**
 * 把用户查询串编成 FTS5 MATCH 表达式（服务与 CLI 共用，保证两端行为一致）。
 *
 * 一个中文词会被切成「单字 + 相邻二字组合」多个 token，所以有两种口径都要备好：
 *   match       —— 词内 OR（宽松）：任一 token 命中即算命中该词。召回率高，
 *                  但单字（如「代」「理」）会把不相干的文档也捞进来。
 *   matchStrict —— 词内只保留长度 ≥2 的 token（二字组合 / 拉丁整词）。精度明显更高，
 *                  代价是长句里跨词边界的二字组合不存在时会漏。
 * 检索侧的正确用法是先 strict、不够再补 loose，两个口径都在同一次调用里给出，
 * 免得两边各写一套分词逻辑对不上。
 * @returns {{ match: string, matchStrict: string|null, terms: string[], strictTerms: string[] } | null}
 */
export function buildFtsMatch(raw) {
  const words = String(raw ?? '').trim().split(/[\s,，。、;；]+/).filter(Boolean)
  const looseGroups = []
  const strictGroups = []
  const terms = []
  const strictTerms = []
  for (const w of words) {
    const toks = Array.from(new Set(tokenizeForSearch(w).split(' ').filter(Boolean)))
    if (!toks.length) continue
    looseGroups.push(toks)
    terms.push(...toks)
    // 只留多字 token；整句全是单字时这一组留空，下面整体退化成 loose
    const strictToks = toks.filter((t) => t.length >= 2)
    strictGroups.push(strictToks.length ? strictToks : toks)
    strictTerms.push(...(strictToks.length ? strictToks : toks))
  }
  if (!looseGroups.length) return null
  const joinGroups = (groups) =>
    groups.map((g) => '(' + g.map(quoteFtsTerm).join(' OR ') + ')').join(' AND ')
  const hasStrict = strictGroups.some((g) => g.length && g[0].length >= 2)
  return {
    match: joinGroups(looseGroups),
    matchStrict: hasStrict ? joinGroups(strictGroups) : null,
    terms: Array.from(new Set(terms)),
    strictTerms: Array.from(new Set(strictTerms))
  }
}

/* ------------------------------------------------------------------ *
 * 字数统计 / 双链 / 摘要
 * ------------------------------------------------------------------ */

/** 字数口径：CJK 每字计 1，拉丁/数字按词计 1（与 §9「字数 ≥900」一致） */
export function wordCountOf(md) {
  const src = normalizeText(md)
    .replace(/```[\s\S]*?```/g, ' ')     // 代码块不计字数（正文要求以讲解为主）
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, ' ')
  let n = 0
  let latin = ''
  for (const ch of src) {
    if (isCjkWordChar(ch)) {
      if (latin) { n++; latin = '' }
      n++
      continue
    }
    if (isLatinWordChar(ch)) { latin += ch; continue }
    if (latin) { n++; latin = '' }
  }
  if (latin) n++
  return n
}

/** 抽 [[node-id]] 双链（去重、保持出现顺序） */
export function extractWikilinks(text) {
  const out = []
  const seen = new Set()
  const re = /\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g
  let m
  while ((m = re.exec(String(text ?? ''))) !== null) {
    const id = m[1].trim()
    if (id && !seen.has(id)) { seen.add(id); out.push(id) }
  }
  return out
}

/** 取「一句话本质」小节首段（列表页与图谱抽屉用） */
export function summaryOf(sections) {
  if (!sections) return ''
  const raw = sections[SUMMARY_SECTION] ?? ''
  const first = String(raw).split(/\n{2,}/)[0] ?? ''
  return first.replace(/\s+/g, ' ').trim().slice(0, 300)
}

/* ------------------------------------------------------------------ *
 * 质量闸门（§9）
 * ------------------------------------------------------------------ */

/** 扫正文代码围栏：返回缺语言标注的下标列表 */
function fencedBlocksWithoutLang(md) {
  const lines = normalizeText(md).split('\n')
  const bad = []
  let fence = null
  let openLine = -1
  let lang = ''
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(```|~~~)(.*)$/.exec(lines[i])
    if (!m) continue
    if (fence === null) {
      fence = m[1]
      openLine = i + 1
      lang = m[2].trim().split(/\s+/)[0] ?? ''
      continue
    }
    if (lines[i].trim().startsWith(fence)) {
      if (!lang) bad.push(openLine)
      fence = null
      lang = ''
    }
  }
  if (fence !== null && !lang) bad.push(openLine)   // 文件结尾未闭合也算问题
  return bad
}

/**
 * 质量闸门。validNodeIds 传入时校验断链（不传就跳过该项，留给调用方补校验）。
 * @param {{meta:any, sections:Record<string,string>, bodyMd:string}} doc
 * @param {Set<string>|string[]|null} validNodeIds
 * @returns {{ ok: boolean, flags: string[] }}
 */
export function qualityCheck(doc, validNodeIds = null) {
  const { meta, sections, bodyMd } = doc ?? {}
  const flags = []
  const m = meta ?? {}

  // 1) 必备小节齐全
  for (const name of REQUIRED_SECTIONS) {
    const has = sections && String(sections[name] ?? '').trim().length > 0
    if (!has) flags.push(`missing-section:${name}`)
  }

  // 2) 字数
  const words = wordCountOf(bodyMd ?? '')
  if (words < MIN_WORDS) flags.push(`word-count:${words}<${MIN_WORDS}`)

  // 3) 来源：≥2 且至少 1 条 kind='official'
  const sources = Array.isArray(m.sources) ? m.sources.filter(Boolean) : []
  if (sources.length < 2) flags.push(`sources-count:${sources.length}<2`)
  const kinds = new Set(sources.map((s) => String(s?.kind ?? '').toLowerCase()))
  if (!kinds.has('official')) flags.push('sources-no-official')

  // 4) 双链可解析
  const ids = validNodeIds instanceof Set ? validNodeIds : validNodeIds ? new Set(validNodeIds) : null
  if (ids) {
    for (const id of extractWikilinks(bodyMd ?? '')) {
      if (!ids.has(id)) flags.push(`broken-link:${id}`)
    }
  }

  // 5) 代码块必须有语言标注
  for (const line of fencedBlocksWithoutLang(bodyMd ?? '')) flags.push(`code-block-no-lang:line${line}`)

  // 6) 机器字段缺失会让后续流程抓瞎，一并计入闸门
  if (!m.node) flags.push('meta-missing:node')
  if (!m.title) flags.push('meta-missing:title')
  if (!String(summaryOf(sections ?? {}) ?? '').trim()) flags.push('summary-empty')

  return { ok: flags.length === 0, flags }
}

/** JSON 抽取：容忍 ```json 包裹、前后闲话、尾随逗号（本地模型输出高频问题） */
export function extractJson(text) {
  if (!text) throw new Error('空响应')
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const raw = fence ? fence[1] : text
  const candidates = []
  const firstObj = raw.search(/[[{]/)
  if (firstObj >= 0) {
    const open = raw[firstObj]
    const close = open === '{' ? '}' : ']'
    let depth = 0, inStr = false, esc = false
    for (let i = firstObj; i < raw.length; i++) {
      const c = raw[i]
      if (esc) { esc = false; continue }
      if (c === '\\') { esc = true; continue }
      if (c === '"') inStr = !inStr
      if (inStr) continue
      if (c === open) depth++
      else if (c === close) { depth--; if (depth === 0) { candidates.push(raw.slice(firstObj, i + 1)); break } }
    }
  }
  candidates.push(raw.trim())
  for (const c of candidates) {
    for (const variant of [c, c.replace(/,\s*([}\]])/g, '$1')]) {
      try { return JSON.parse(variant) } catch { /* next */ }
    }
  }
  throw new Error('无法从模型输出中解析 JSON')
}

/**
 * 抢救被截断或夹带闲话的 JSON 数组：本地模型常在 max_tokens 处截断、或先解释再给 JSON，
 * 整段 parse 失败时逐元素扫描仍能拿到已闭合的那几道题。不做这件事就会触发 `:repair`
 * 二次请求 —— 实测多花 90-180 秒且经常再次超时，是「AI 更新题库半天没反应」的主要耗时来源。
 */
export function salvageElements(text) {
  if (!text) return null
  let start = text.indexOf('[')
  const q = text.search(/"questions"\s*:\s*\[/)
  if (q >= 0) start = text.indexOf('[', q)
  if (start < 0) return null
  const out = []
  let depth = 0, inStr = false, esc = false, elemStart = -1
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (esc) { esc = false; continue }
    if (c === '\\') { esc = true; continue }
    if (c === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (c === '[' || c === '{') {
      depth++
      if (depth === 2 && c === '{') elemStart = i
    } else if (c === ']' || c === '}') {
      if (depth === 2 && c === '}' && elemStart >= 0) {
        const span = text.slice(elemStart, i + 1)
        try { out.push(JSON.parse(span.replace(/,\s*([}\]])/g, '$1'))) } catch { /* 单个残缺元素跳过 */ }
        elemStart = -1
        if (out.length >= 8) break
      }
      depth--
      if (depth <= 0) break
    }
  }
  return out.length ? out : null
}

export default { parseKnowledgeMd, parseFrontmatter, splitSections, tokenizeForSearch, buildFtsMatch, quoteFtsTerm, qualityCheck, extractWikilinks, summaryOf, wordCountOf, REQUIRED_SECTIONS, MIN_WORDS, extractJson, salvageElements }
