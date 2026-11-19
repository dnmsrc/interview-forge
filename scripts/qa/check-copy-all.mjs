// 遍历所有路由：检查「面试」残留 + 抓取各页可见文案供人工审视
import { Cdp, sleep } from './cdp.mjs'

const cdp = await Cdp.connect()
await sleep(1200)

const ROUTES = [
  ['/', '今日'],
  ['/placement', '入门摸底'],
  ['/practice', '练习模式'],
  ['/mistakes', '错题本'],
  ['/exam', '闭卷考试'],
  ['/graph', '知识图谱'],
  ['/dashboard', '数据面板'],
  ['/bank', '题库·版本'],
  ['/settings', '设置'],
  ['/projects', '项目闯关'],
  ['/projects/mini-vue-reactivity', '项目地图'],
  ['/projects/mini-vue-reactivity/lv1', '关卡工作台']
]

let bad = 0
for (const [path, name] of ROUTES) {
  await cdp.evaluate(`return (function(){ location.hash = '#${path}'; return true })()`)
  await sleep(900)
  const t = await cdp.evaluate(`return document.body.innerText || ''`)
  const hit = t.includes('面试')
  if (hit) {
    bad++
    const i = t.indexOf('面试')
    console.log(`✗ ${name} (${path}) 仍含「面试」: ...${t.slice(Math.max(0, i - 50), i + 50).replace(/\n/g, ' | ')}...`)
  } else {
    console.log(`✓ ${name}`)
  }
  await cdp.shot(`data/qa/copy-${path === '/' ? 'home' : path.replace(/[\/]/g, '_').replace(/^_/, '')}.png`)
}
console.log(bad === 0 ? '\n全部页面无「面试」' : `\n仍有 ${bad} 个页面含「面试」`)
process.exit(0)