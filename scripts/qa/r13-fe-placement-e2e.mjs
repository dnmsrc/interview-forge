// R13 真机验证：前端摸底首题必须是 HTML 基础（难度1），可标记缺口、可退出，且零数据污染
import { Cdp, sleep, AUDIT_JS } from './cdp.mjs'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

const bad = []
const ok = (c, m) => { if (!c) bad.push(m); console.log(`  ${c ? 'OK ' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1 }
const openDb = () => { const d = new DatabaseSync(join(process.cwd(), 'data', 'app.db')); d.exec('PRAGMA busy_timeout=8000'); return d }

const db0 = openDb()
const base = {
  sessions: db0.prepare("SELECT COUNT(*) c FROM placement_session WHERE domain='fe'").get().c,
  turns: db0.prepare('SELECT COUNT(*) c FROM placement_turn').get().c,
  attempts: db0.prepare('SELECT COUNT(*) c FROM attempts').get().c
}
// 测试隔离（R14 起点卡片默认续测而非新建）：先把 fe 未完成会话收口为 aborted（仅状态变更、不删数据，
// 已完成的摸底结果不受影响），保证本次点卡片必然新建测试会话，也避免清理段误删用户真实进度。
const aborted0 = db0.prepare("UPDATE placement_session SET status='aborted', updated_at=datetime('now','localtime') WHERE domain='fe' AND status='active'").run().changes
db0.close()
console.log('基线：fe 会话', base.sessions, 'turns', base.turns, 'attempts', base.attempts, '| 收口未完成会话', aborted0)

const cdp = await Cdp.connect(20)
await cdp.metrics(1460, 920)
cdp.clearErrors()
const vis = (sel) => `[...document.querySelectorAll(${JSON.stringify(sel)})].filter(e=>e.getBoundingClientRect().width>0)`

await cdp.nav('/placement')
await sleep(1300)
// 若有进行中的会话先退出回到板块选择
await cdp.evaluate(`[...document.querySelectorAll('button')].find(b=>/退出/.test(b.textContent)&&b.getBoundingClientRect().width>0)?.click(); return 1`)
await sleep(700)

// 前端卡片应可点、无建设中标记
const feCard = await cdp.evaluate(`
  const c=${vis('.domain-card')}.find(x=>/前端/.test(x.textContent));
  return { exists: !!c, disabled: c ? c.disabled : null, pill: !!c?.querySelector('.building-pill') }`)
ok(feCard.exists && feCard.disabled === false && feCard.pill === false, '前端卡片可点、无「建设中」标记')

// 启动前端摸底
await cdp.evaluate(`const c=${vis('.domain-card')}.find(x=>/前端/.test(x.textContent));if(c)c.click();return 1`)
await cdp.waitFor("!!document.querySelector('.stem')", 20000, '前端摸底首题出题')
await sleep(600)
const running = await cdp.evaluate(`return {
  stemText: (document.querySelector('.stem')?.innerText||'').slice(0,60),
  node: document.querySelector('.qnode')?.innerText || '',
  toolbar: document.querySelector('.pl-toolbar')?.innerText || '',
  exit: !![...document.querySelectorAll('.pl-toolbar button')].find(b=>/退出/.test(b.textContent))
}`)
console.log('  首题考点:', running.node, '| 题干:', running.stemText)
ok(/HTML|语义|DOCTYPE|标签/.test(running.node + running.stemText), '首题来自 HTML 基础层（语义化/DOCTYPE/标签）：' + running.node)
ok(/前端摸底/.test(running.toolbar), '进入前端摸底会话')
ok(running.exit, '进行中有明确「退出」入口')
await cdp.shot('data/qa/r13-fe-placement-first.png')

// 「我不会」gap 通道可用，但用 skip 不写 attempt
await cdp.evaluate(`[...document.querySelectorAll('.n-button')].find(e=>/我不会/.test(e.textContent)&&e.getBoundingClientRect().width>0)?.click();return 1`)
await sleep(400)
const gapShown = await cdp.evaluate(`return !!${vis('.gap-opt')}[0]`)
ok(gapShown, '「我不会」原因选择正常展开')
await cdp.evaluate(`${vis('.gap-opt')}.find(e=>/直接跳过/.test(e.textContent))?.click();return 1`)
const nextSel = vis('[data-testid="pl-next"]')
await cdp.waitFor(`!!document.querySelector('.pl-verdict') || !!${nextSel}[0]`, 15000, '跳过后可推进')
await sleep(400)
const afterSkip = await cdp.evaluate(`return { verdict: !!document.querySelector('.pl-verdict'), next: !!${nextSel}[0] }`)
ok(afterSkip.verdict && afterSkip.next, '跳过缺口后正常回显、可推进（摸底流程完整）')
await cdp.shot('data/qa/r13-fe-gap-skip.png')

// 退出回板块选择
await cdp.evaluate(`[...document.querySelectorAll('.pl-toolbar button')].find(b=>/退出/.test(b.textContent))?.click();return 1`)
await sleep(700)
const back = await cdp.evaluate(`return ${vis('.domain-card')}.length > 0`)
ok(back === true, '可正常「退出」回到板块选择页')

const audit = await cdp.evaluate(AUDIT_JS)
ok(!audit.hOverflow, '无横向溢出')
const errs = cdp.errors().filter((e) => !/Failed to load resource|favicon|DevTools|INEFFECTIVE_DYNAMIC/.test(e.text))
ok(errs.length === 0, '无控制台错误' + (errs.length ? '：' + errs.slice(0, 3).map((e) => e.text).join('|') : ''))
await cdp.close()

// 清理本次测试产生的 fe 会话（skip 不写 attempt，但会建 session/turn）
const db1 = openDb()
const testSessions = db1.prepare("SELECT id,created_at FROM placement_session WHERE domain='fe'").all()
let removed = 0
for (const s of testSessions) {
  const ageMin = (Date.now() - new Date(s.created_at.replace(' ', 'T') + 'Z').getTime()) / 60000
  if (ageMin < 8) {
    db1.prepare('DELETE FROM placement_turn WHERE session_id=?').run(s.id)
    db1.prepare('DELETE FROM placement_session WHERE id=?').run(s.id)
    removed++
  }
}
const fin = {
  sessions: db1.prepare("SELECT COUNT(*) c FROM placement_session WHERE domain='fe'").get().c,
  turns: db1.prepare('SELECT COUNT(*) c FROM placement_turn').get().c,
  attempts: db1.prepare('SELECT COUNT(*) c FROM attempts').get().c
}
db1.close()
console.log('清理测试 fe 会话', removed, '个')
ok(fin.sessions === base.sessions, 'fe 会话回到基线（' + fin.sessions + '/' + base.sessions + '）')
ok(fin.attempts === base.attempts, 'attempts 无新增（' + fin.attempts + '/' + base.attempts + '，skip 不算答错）')

console.log(bad.length ? `\n❌ R13 前端真机验证 ${bad.length} 项失败: ${bad.join(' | ')}` : '\n✅ R13 前端摸底首题=HTML基础、可跳过可退出、零数据污染，全部通过')
process.exit(bad.length ? 1 : 0)
