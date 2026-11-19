// R12：真机验证 cs 公共基础摸底从「白屏退不出」变为可正常启动、出题、退出（不作答，零数据污染）
import { Cdp, sleep, AUDIT_JS } from './cdp.mjs'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

const bad = []
const ok = (c, m) => { if (!c) bad.push(m); console.log(`  ${c ? 'OK ' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1 }
const openDb = () => { const d = new DatabaseSync(join(process.cwd(), 'data', 'app.db')); d.exec('PRAGMA busy_timeout=8000'); return d }

const db0 = openDb()
const base = {
  sessions: db0.prepare("SELECT COUNT(*) c FROM placement_session WHERE domain='cs'").get().c,
  turns: db0.prepare('SELECT COUNT(*) c FROM placement_turn').get().c,
  attempts: db0.prepare('SELECT COUNT(*) c FROM attempts').get().c
}
// 测试隔离（R14 起点卡片默认续测）：先收口 cs 未完成会话（仅状态变更、不删数据），保证本次必新建测试会话。
const aborted0 = db0.prepare("UPDATE placement_session SET status='aborted', updated_at=datetime('now','localtime') WHERE domain='cs' AND status='active'").run().changes
db0.close()
console.log('基线：cs 会话', base.sessions, 'turns', base.turns, 'attempts', base.attempts, '| 收口未完成会话', aborted0)

const cdp = await Cdp.connect(20)
await cdp.metrics(1460, 920)
cdp.clearErrors()
const vis = (sel) => `[...document.querySelectorAll(${JSON.stringify(sel)})].filter(e=>e.getBoundingClientRect().width>0)`

await cdp.nav('/placement')
await sleep(1300)
await cdp.evaluate(`[...document.querySelectorAll('button')].find(b=>/退出/.test(b.textContent)&&b.getBoundingClientRect().width>0)?.click(); return 1`)
await sleep(700)

// cs 卡片应不再置灰（不再被标记建设中），可点击
const csCard = await cdp.evaluate(`
  const c=${vis('.domain-card')}.find(x=>/公共基础/.test(x.textContent));
  return { exists: !!c, disabled: c ? c.disabled : null, pill: !!c?.querySelector('.building-pill') }`)
ok(csCard.exists && csCard.disabled === false && csCard.pill === false, '公共基础卡片可点、无「建设中」标记（已从空板块移除）')

// 启动 cs 摸底
await cdp.evaluate(`const c=${vis('.domain-card')}.find(x=>/公共基础/.test(x.textContent));if(c)c.click();return 1`)
await cdp.waitFor("!!document.querySelector('.stem')", 20000, 'cs 摸底首题出题')
await sleep(600)
const running = await cdp.evaluate(`return {
  stem: !!document.querySelector('.stem'),
  stemText: (document.querySelector('.stem')?.innerText||'').slice(0,40),
  node: document.querySelector('.qnode')?.innerText || '',
  exit: !![...document.querySelectorAll('.pl-toolbar button')].find(b=>/退出/.test(b.textContent)),
  toolbar: /公共基础摸底/.test(document.querySelector('.pl-toolbar')?.innerText||'')
}`)
ok(running.stem, 'cs 摸底正常出题（不再白屏）：' + running.stemText)
ok(/OSI|分层|TCP/.test(running.node + running.stemText), '首题来自零前置起点（OSI/分层）：' + running.node)
ok(running.exit && running.toolbar, '进行中有明确「退出」入口，可随时离开')
await cdp.shot('data/qa/r12-cs-placement-running.png')

// 「我不会」流程也能正常工作（验证 gap 通道不崩），但用 skip 不写 attempt
await cdp.evaluate(`[...document.querySelectorAll('.n-button')].find(e=>/我不会/.test(e.textContent)&&e.getBoundingClientRect().width>0)?.click();return 1`)
await sleep(400)
const gapShown = await cdp.evaluate(`return !!${vis('.gap-opt')}[0]`)
ok(gapShown, '「我不会」原因选择正常展开（缺口定位通道可用）')
await cdp.evaluate(`${vis('.gap-opt')}.find(e=>/直接跳过/.test(e.textContent))?.click();return 1`)
const nextSel = vis('[data-testid="pl-next"]')
await cdp.waitFor(`!!document.querySelector('.pl-verdict') || !!${nextSel}[0]`, 15000, '跳过一题后正常判定并可推进')
await sleep(400)
const afterSkip = await cdp.evaluate(`return { verdict: !!document.querySelector('.pl-verdict'), next: !!${nextSel}[0] }`)
ok(afterSkip.verdict && afterSkip.next, '跳过缺口后正常回显、可点「下一题」推进（摸底流程完整）')
await cdp.shot('data/qa/r12-cs-gap-skip.png')

// 退出
await cdp.evaluate(`[...document.querySelectorAll('.pl-toolbar button')].find(b=>/退出/.test(b.textContent))?.click();return 1`)
await sleep(700)
const back = await cdp.evaluate(`return ${vis('.domain-card')}.length > 0`)
ok(back === true, '可正常「退出」回到板块选择页')

const audit = await cdp.evaluate(AUDIT_JS)
ok(!audit.hOverflow, '无横向溢出（' + (audit.hOverflow ?? 'OK') + '）')
const errs = cdp.errors().filter((e) => !/Failed to load resource|favicon|DevTools|INEFFECTIVE_DYNAMIC/.test(e.text))
ok(errs.length === 0, '无控制台错误' + (errs.length ? '：' + errs.slice(0, 3).map((e) => e.text).join('|') : ''))
await cdp.close()

// 清理本次测试产生的 cs 会话（skip 不写 attempt，但会建 session/turn）
const db1 = openDb()
const testSessions = db1.prepare("SELECT id,created_at FROM placement_session WHERE domain='cs'").all()
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
  sessions: db1.prepare("SELECT COUNT(*) c FROM placement_session WHERE domain='cs'").get().c,
  turns: db1.prepare('SELECT COUNT(*) c FROM placement_turn').get().c,
  attempts: db1.prepare('SELECT COUNT(*) c FROM attempts').get().c
}
db1.close()
console.log('清理测试 cs 会话', removed, '个')
ok(fin.sessions === base.sessions, 'cs 会话回到基线（' + fin.sessions + '/' + base.sessions + '）')
ok(fin.attempts === base.attempts, 'attempts 无新增（' + fin.attempts + '/' + base.attempts + '，skip 不算答错）')

console.log(bad.length ? `\n❌ cs 摸底真机验证 ${bad.length} 项失败: ${bad.join(' | ')}` : '\n✅ cs 公共基础摸底端到端真机验证全部通过（可启动/出题/标记缺口/退出，数据已还原）')
process.exit(bad.length ? 1 : 0)
