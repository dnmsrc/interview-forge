/**
 * 轻量语法高亮：把源码切成 token 再套 span，供两处复用。
 *
 * 为什么不用 prism / highlight.js：
 * 1) 教学页里的代码块只有几十行，却分布在每一关的讲解和示例里，包体积和初始化时机都要算账；
 * 2) 编辑器是 textarea + 高亮叠层（见 CodeEditor.vue），要求「切出来的 HTML 与源码逐字符对得上」，
 *    自己写一个扫描器反而最容易保证这条——第三方库会改变空白与换行，叠层立刻错位。
 *
 * 支持的语言都走同一套 C 系词法（js / ts / json / java / go / python 的注释与字符串规则相近），
 * 只有注释符号和模板串有差异，用 lang 参数微调即可。高亮失败时返回转义后的纯文本，绝不抛错。
 */

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case',
  'default', 'break', 'continue', 'new', 'class', 'extends', 'super', 'this', 'try', 'catch', 'finally',
  'throw', 'typeof', 'instanceof', 'in', 'of', 'delete', 'void', 'yield', 'await', 'async', 'import',
  'export', 'from', 'as', 'static', 'get', 'set', 'true', 'false', 'null', 'undefined', 'NaN',
  'interface', 'type', 'enum', 'implements', 'public', 'private', 'protected', 'readonly', 'declare',
  'def', 'elif', 'lambda', 'pass', 'raise', 'with', 'None', 'True', 'False', 'and', 'or', 'not',
  'func', 'package', 'struct', 'map', 'chan', 'go', 'defer', 'range'
])

/** 会被染成「类型/内置」色的常用全局名，让教学代码一眼能分清哪些是语言给的 */
const BUILTINS = new Set([
  'Object', 'Array', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Proxy', 'Reflect', 'Promise', 'JSON',
  'Math', 'Date', 'Error', 'TypeError', 'String', 'Number', 'Boolean', 'Symbol', 'RegExp',
  'console', 'document', 'window', 'globalThis', 'process', 'setTimeout', 'clearTimeout',
  'queueMicrotask', 'fetch', 'require', 'module', 'exports'
])

const escapeHtml = (s: string): string =>
  s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)

const span = (cls: string, text: string): string => `<span class="tk-${cls}">${escapeHtml(text)}</span>`

const isIdStart = (c: string): boolean => /[A-Za-z_$]/.test(c)
const isId = (c: string): boolean => /[A-Za-z0-9_$]/.test(c)
const isDigit = (c: string): boolean => c >= '0' && c <= '9'

/** 单行注释的起始符：python / bash 用 #，其余用 // */
function lineCommentPrefix(lang: string): string {
  return lang === 'python' || lang === 'py' || lang === 'bash' || lang === 'sh' || lang === 'yaml' ? '#' : '//'
}

/**
 * 把源码切成带 class 的 HTML。返回的文本内容与输入完全一致（只做转义），
 * 这样它可以直接垫在 textarea 底下做叠层。
 */
export function highlightCode(code: string, lang = 'js'): string {
  const src = String(code ?? '')
  const lc = lineCommentPrefix(lang)
  const out: string[] = []
  let i = 0

  while (i < src.length) {
    const c = src[i]
    const rest = src.slice(i)

    // 换行：原样保留，叠层靠它对齐
    if (c === '\n') { out.push('\n'); i++; continue }

    // 行注释
    if (rest.startsWith(lc)) {
      const end = src.indexOf('\n', i)
      const stop = end === -1 ? src.length : end
      out.push(span('com', src.slice(i, stop)))
      i = stop
      continue
    }

    // 块注释
    if (rest.startsWith('/*')) {
      const end = src.indexOf('*/', i + 2)
      const stop = end === -1 ? src.length : end + 2
      out.push(span('com', src.slice(i, stop)))
      i = stop
      continue
    }

    // 字符串：单引号 / 双引号
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === c || src[j] === '\n') { j++; break }
        j++
      }
      out.push(span('str', src.slice(i, j)))
      i = j
      continue
    }

    // 模板字符串：整段当一个字符串处理（内部的 ${} 不再细分，够用且不会错位）
    if (c === '`') {
      let j = i + 1
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === '`') { j++; break }
        j++
      }
      out.push(span('str', src.slice(i, j)))
      i = j
      continue
    }

    // 数字
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1] ?? ''))) {
      let j = i + 1
      while (j < src.length && /[0-9a-fA-FxX._eE+-]/.test(src[j])) j++
      out.push(span('num', src.slice(i, j)))
      i = j
      continue
    }

    // 标识符：关键字 / 内置 / 普通 / 函数名（后面紧跟左括号）
    if (isIdStart(c)) {
      let j = i + 1
      while (j < src.length && isId(src[j])) j++
      const word = src.slice(i, j)
      if (KEYWORDS.has(word)) out.push(span('kw', word))
      else if (BUILTINS.has(word)) out.push(span('bi', word))
      else {
        let k = j
        while (k < src.length && (src[k] === ' ' || src[k] === '\t')) k++
        out.push(span(src[k] === '(' ? 'fn' : 'var', word))
      }
      i = j
      continue
    }

    // 剩余：标点与空白
    out.push(escapeHtml(c))
    i++
  }

  return out.join('')
}

/** 从语言标识推断用哪套词法；认不出来就按 JS 处理 */
export function langOf(raw?: string): string {
  const l = String(raw ?? '').toLowerCase()
  if (l === 'ts' || l === 'typescript') return 'ts'
  if (l === 'py' || l === 'python') return 'python'
  if (l === 'bash' || l === 'sh' || l === 'shell') return 'bash'
  return 'js'
}