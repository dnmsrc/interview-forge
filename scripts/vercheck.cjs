// 运行时能力探测：在 Electron 内置 Node 下执行，打印版本与 sqlite 支持情况
const out = []
out.push('electron-node=' + process.versions.node)
out.push('electron-abi=' + process.versions.modules)
try {
  const s = require('node:sqlite')
  const db = new s.DatabaseSync(':memory:')
  db.exec('create table t(a int)')
  db.prepare('insert into t values(?)').run(42)
  out.push('node:sqlite=yes row=' + JSON.stringify(db.prepare('select * from t').all()))
} catch (e) {
  out.push('node:sqlite=no ' + String(e.message).split('\n')[0])
}
console.log(out.join('\n'))
