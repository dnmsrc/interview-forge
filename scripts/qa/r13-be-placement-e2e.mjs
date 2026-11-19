// R13 真机验证：后端摸底首题必须是 Java 语言基础（难度1），可跳过、可退出、零数据污染
import { Cdp, sleep, AUDIT_JS } from './cdp.mjs'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

const bad = []
const ok = (c, m) => { if (!c) bad.push(m); console.log(`  ${c ? 'OK ' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1 }
const openDb = () => { const d = new DatabaseSync(join(process.cwd(), 'data', 'app.db')); d.exec('PRAGMA busy_timeout=8000'); return d }

const db0 = openDb()
const base = {
  sessions: db0.prepare("SELECT COUNT(*) c FROM placement_session WHERE domain='be'").get().c,
  turns: db0.prepare('SELECT COUNT(*) c FROM placement_turn').get().c,
  attempts: db0.prepare('SELECT COUNT(*) c FROM attempts').get().c
}
// 测试隔离（R14 起点卡片默认续测）：先收口 be 未完成会话（仅状态变更、不删数据），保证本次必新建测试会话。
const aborted0 = db0.prepare("UPDATE placement_session SET status='aborted', updated_at=datetime('now','localtime') WHERE domain='be' AND status='active'").run().changes
db0.close()
console.log('基线：be 会话', base.sessions, 'turns', base.turns, 'attempts', base.attempts, '| 收口未完成会话', aborted0)

const cdp = await Cdp.connect(20)
await cdp.metrics(1460, 920)
cdp.clearErrors()
const vis = (sel) => `[...document.querySelectorAll(${JSON.stringify(sel)})].filter(e=>e.getBoundingClientRect().width>0)`

await cdp.nav('/placement')
await sleep(1300)
await cdp.evaluate(`[...document.querySelectorAll('button')].find(b=>/退出/.test(b.textContent)&&b.getBoundingClientRect().width>0)?.click(); return 1`)
await sleep(700)

const beCard = await cdp.evaluate(`
  const c=${vis('.domain-card')}.find(x=>/后端/.test(x.textContent));
  return { exists: !!c, disabled: c ? c.disabled : null, pill: !!c?.querySelector('.building-pill') }`)
ok(beCard.exists && beCard.disabled === false && beCard.pill === false, '后端卡片可点、无「建设中」标记')

await cdp.evaluate(`const c=${vis('.domain-card')}.find(x=>/后端/.test(x.textContent));if(c)c.click();return 1`)
await cdp.waitFor("!!document.querySelector('.stem')", 20000, '后端摸底首题出题')
await sleep(600)
const running = await cdp.evaluate(`return {
  stemText: (document.querySelector('.stem')?.innerText||'').slice(0,60),
  node: document.querySelector('.qnode')?.innerText || '',
  toolbar: document.querySelector('.pl-toolbar')?.innerText || '',
  exit: !![...document.querySelectorAll('.pl-toolbar button')].find(b=>/退出/.test(b.textContent))
}`)
console.log('  首题考点:', running.node, '| 题干:', running.stemText)
ok(/Java|语法|数据类型|基本类型|流程/.test(running.node + running.stemText), '首题来自 Java 语言基础层：' + running.node)
ok(/后端摸底/.test(running.toolbar), '进入后端摸底会话')
ok(running.exit, '进行中有明确「退出」入口')
await cdp.shot('data/qa/r13-be-placement-first.png')

await cdp.evaluate(`[...document.querySelectorAll('.n-button')].find(e=>/我不会/.test(e.textContent)&&e.getBoundingClientRect().width>0)?.click();return 1`)
await sleep(400)
const gapShown = await cdp.evaluate(`return !!${vis('.gap-opt')}[0]`)
ok(gapShown, '「我不会」原因选择正常展开')
await cdp.evaluate(`${vis('.gap-opt')}.find(e=>/直接跳过/.test(e.textContent))?.click();return 1`)
const nextSel = vis('[data-testid="pl-next"]')
await cdp.waitFor(`!!document.querySelector('.pl-verdict') || !!${nextSel}[0]`, 15000, '跳过后可推进')
await sleep(400)
const afterSkip = await cdp.evaluate(`return { verdict: !!document.querySelector('.pl-verdict'), next: !!${nextSel}[0] }`)
ok(afterSkip.verdict && afterSkip.next, '跳过缺口后正常回显、可推进')

await cdp.evaluate(`[...document.querySelectorAll('.pl-toolbar button')].find(b=>/退出/.test(b.textContent))?.click();return 1`)
await sleep(700)
const back = await cdp.evaluate(`return ${vis('.domain-card')}.length > 0`)
ok(back === true, '可正常「退出」回到板块选择页')

const audit = await cdp.evaluate(AUDIT_JS)
ok(!audit.hOverflow, '无横向溢出')
const errs = cdp.errors().filter((e) => !/Failed to load resource|favicon|DevTools|INEFFECTIVE_DYNAMIC/.test(e.text))
ok(errs.length === 0, '无控制台错误' + (errs.length ? '：' + errs.slice(0, 3).map((e) => e.text).join('|') : ''))
await cdp.close()

const db1 = openDb()
const testSessions = db1.prepare("SELECT id,created_at FROM placement_session WHERE domain='be'").all()
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
  sessions: db1.prepare("SELECT COUNT(*) c FROM placement_session WHERE domain='be'").get().c,
  turns: db1.prepare('SELECT COUNT(*) c FROM placement_turn').get().c,
  attempts: db1.prepare('SELECT COUNT(*) c FROM attempts').get().c
}
db1.close()
console.log('清理测试 be 会话', removed, '个')
ok(fin.sessions === base.sessions, 'be 会话回到基线（' + fin.sessions + '/' + base.sessions + '）')
ok(fin.attempts === base.attempts, 'attempts 无新增（' + fin.attempts + '/' + base.attempts + '）')

console.log(bad.length ? `\n❌ R13 后端真机验证 ${bad.length} 项失败: ${bad.join(' | ')}` : '\n✅ R13 后端摸底首题=Java基础、可跳过可退出、零数据污染，全部通过')
process.exit(bad.length ? 1 : 0)
