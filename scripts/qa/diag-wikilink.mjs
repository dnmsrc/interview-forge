import MarkdownIt from 'markdown-it'
const md = new MarkdownIt({ html: false, linkify: true, breaks: true })

// 在 linkify 之前注册 [[id]] / [[id|别名]] 规则：产生真正的 link token，走标准渲染管线，不被 html:false 转义
md.inline.ruler.before('linkify', 'wikilink', (state, silent) => {
  if (state.src.charCodeAt(state.pos) !== 0x5b /* [ */) return false
  if (state.src.charCodeAt(state.pos + 1) !== 0x5b) return false
  const end = state.src.indexOf(']]', state.pos + 2)
  if (end < 0) return false
  const inner = state.src.slice(state.pos + 2, end)
  const bar = inner.indexOf('|')
  const id = (bar >= 0 ? inner.slice(0, bar) : inner).trim()
  const label = (bar >= 0 ? inner.slice(bar + 1) : inner).trim()
  if (!id) return false
  if (!silent) {
    const tok = state.push('wikilink', 'a', 1)
    tok.attrSet('href', 'javascript:void(0)')
    tok.attrSet('class', 'wikilink')
    tok.attrSet('data-wiki', id)
    const txt = state.push('text', '', 0)
    txt.content = label
    state.push('wikilink', 'a', -1)
  }
  state.pos = end + 2
  return true
})

const src = '前置见 [[fe.vue.compiler.block-tree]]，别名 [[fe.vue.runtime.update-flow|更新流程]]，代码里的 `[[x]]` 不动。'
const out = md.render(src)
console.log(out)
console.log('wikilink 锚点数:', (out.match(/class="wikilink"/g) || []).length)
