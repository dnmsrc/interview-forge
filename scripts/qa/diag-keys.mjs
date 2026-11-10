// 直接问渲染层 IPC：ai.byTask / dashboard.wrongNotes 的真实字段名与样例值
import { Cdp, sleep } from './cdp.mjs'
const cdp = await Cdp.connect(process.env.QA_PORT || '9222')
await cdp.nav('/dashboard')
await sleep(2200)
const out = await cdp.evaluate(`return (async function(){
  const { ipc } = await import('/src/lib/ipc.ts');
  const byTask = await ipc.ai.byTask(30);
  const wrong = await ipc.dashboard.wrongNotes(3);
  const dash = await ipc.dashboard.summary();
  return {
    byTaskKeys: byTask?.[0] ? Object.keys(byTask[0]) : [],
    byTaskRow: byTask?.[0],
    wrongKeys: wrong?.[0] ? Object.keys(wrong[0]) : [],
    typeStatsKeys: dash?.typeStats?.[0] ? Object.keys(dash.typeStats[0]) : [],
    bandKeys: dash?.interviewBand ? Object.keys(dash.interviewBand) : [],
    topWrongKeys: dash?.topWrong?.[0] ? Object.keys(dash.topWrong[0]) : [],
    masteryKeys: dash?.mastery?.[0] ? Object.keys(dash.mastery[0]) : [],
    trendKeys: dash?.accuracyTrend?.[0] ? Object.keys(dash.accuracyTrend[0]) : []
  };
})()`)
console.log(JSON.stringify(out, null, 1))
await cdp.close()
