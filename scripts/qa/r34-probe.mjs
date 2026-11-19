import { Cdp, sleep } from './cdp.mjs'
const cdp = await Cdp.connect()
const pid = 'mini-vue-reactivity'
const d = await cdp.evaluate(`return await window.forge.project.detail(${JSON.stringify(pid)})`)
const l1 = d.levels[0]
console.log(JSON.stringify({
  hash: await cdp.evaluate(`return location.hash`),
  done: l1.done, attempts: l1.attempts, stageDone: l1.stageDone,
  draftHead: (l1.draft || '').slice(0, 200),
  draftLen: (l1.draft || '').length,
  skeletonHead: (l1.skeleton || '').slice(0, 200),
  stages: l1.stages.map(s => ({ n: s.n, title: s.title, caseCount: s.caseCount, hasCode: !!s.code, codeLen: (s.code || '').length })),
}, null, 2))
cdp.close()
