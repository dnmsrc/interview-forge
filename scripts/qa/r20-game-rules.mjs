// R20 游戏化「纯规则」自测：不 import 任何 .ts / electron，只验证 XP 曲线与等级换算的数学性质。
// DB/IPC/徽章/Boss 等需要 electron 运行时的部分交给 r20-game-e2e.mjs 走真机 + 直连库断言。
// 这里把 shared/game.ts 的权威公式原样内联（改公式时两处同步），保证曲线本身正确。
const LEVEL_BASE = 120, MAX_LEVEL = 30
const xpThresholdForLevel = (level) => level <= 1 ? 0 : Math.round(LEVEL_BASE * Math.pow(Math.min(level, MAX_LEVEL + 1) - 1, 1.5))
function levelForXp(xp) { let l = 1; while (l < MAX_LEVEL && xp >= xpThresholdForLevel(l + 1)) l++; return l }
function xpProgress(xp) {
  const level = levelForXp(xp)
  if (level >= MAX_LEVEL) return { level, pct: 1 }
  const floor = xpThresholdForLevel(level), ceil = xpThresholdForLevel(level + 1)
  return { level, pct: (xp - floor) / (ceil - floor) }
}
const TITLES = [1, 3, 6, 10, 15, 20, 25]
const titleForLevel = (lv) => TITLES.filter((m) => lv >= m).length - 1

const bad = []
const ok = (c, m) => { if (!c) bad.push(m); console.log(`  ${c ? 'OK ' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1 }

ok(xpThresholdForLevel(1) === 0, 'Lv1 门槛=0')
ok(xpThresholdForLevel(2) === LEVEL_BASE, 'Lv2 门槛=BASE(120)，前期升级快')
let mono = true
for (let l = 2; l <= MAX_LEVEL; l++) if (!(xpThresholdForLevel(l) < xpThresholdForLevel(l + 1))) mono = false
ok(mono, '升级门槛 1..30 严格单调递增')
ok(levelForXp(0) === 1, '0 XP=Lv1')
ok(levelForXp(xpThresholdForLevel(5)) === 5, '踩到 Lv5 门槛即 Lv5')
ok(levelForXp(xpThresholdForLevel(5) - 1) === 4, '差 1 XP 仍是 Lv4')
ok(levelForXp(10 ** 9) === MAX_LEVEL, '超大 XP 封顶 Lv30 不溢出')
const pr = xpProgress(xpThresholdForLevel(4) + 10)
ok(pr.level === 4 && pr.pct > 0 && pr.pct < 1, 'xpProgress 比例落在 (0,1)')
// 前期升级体感：前 5 级累计所需 XP 应明显小于后 5 级
ok(xpThresholdForLevel(6) - xpThresholdForLevel(1) < xpThresholdForLevel(30) - xpThresholdForLevel(25), '前期升级比后期快（正反馈前置）')
ok(titleForLevel(1) === 0 && titleForLevel(25) === 6 && titleForLevel(29) === 6, '段位头衔随等级单调映射且末端兜底')

console.log(bad.length ? `\n❌ R20 纯规则自测 ${bad.length} 项失败: ${bad.join(' | ')}` : '\n✅ R20 游戏化纯规则：XP 曲线/等级/进度/段位，全部通过')
process.exit(bad.length ? 1 : 0)
