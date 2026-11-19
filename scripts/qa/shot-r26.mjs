// 一次性截图：项目闯关三页的画面走查（列表 / 关卡地图 / 工作台）
import { join } from 'node:path'
import { Cdp, sleep } from './cdp.mjs'

const root = join(import.meta.dirname, '..', '..')
const cdp = await Cdp.connect(20)
await cdp.metrics(1460, 920)
await cdp.reloadHard(3000)

await cdp.nav('/projects')
await sleep(1300)
await cdp.shot(join(root, 'data', 'qa', 'r26-p1-list.png'))

await cdp.nav('/projects/mini-vue-reactivity')
await sleep(1300)
await cdp.shot(join(root, 'data', 'qa', 'r26-p2-board.png'))

await cdp.nav('/projects/mini-vue-reactivity/lv1')
await sleep(1500)
await cdp.shot(join(root, 'data', 'qa', 'r26-p3-workbench.png'))

// 窄窗：工作台应降为单列
await cdp.metrics(1180, 900)
await sleep(900)
await cdp.shot(join(root, 'data', 'qa', 'r26-p4-workbench-narrow.png'))
const narrow = await cdp.evaluate(`
  const t = document.querySelector('.task-pane'), w = document.querySelector('.work-pane');
  return { hOverflow: document.documentElement.scrollWidth > innerWidth + 2,
           cols: getComputedStyle(document.querySelector('.level-page')).gridTemplateColumns }`)
console.log('窄窗检查：', JSON.stringify(narrow))

await cdp.clearMetrics()
console.log('截图完成')
await cdp.close()