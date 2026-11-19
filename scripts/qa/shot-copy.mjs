// 截图核对改文案后的首页
import { Cdp, sleep } from './cdp.mjs'

const cdp = await Cdp.connect()
await sleep(2000)
const text = await cdp.evaluate(`return document.body.innerText.slice(0, 1200)`)
console.log('=== 首页可见文本 ===')
console.log(text)
await cdp.shot('data/copy-check-home.png')
console.log('截图: data/copy-check-home.png')
process.exit(0)