// JSON 抢救函数单测（extractJson/salvageElements 在 shared 纯函数模块里）
import { extractJson, salvageElements } from '../../src/shared/knowledge-core.mjs'

const truncated = '好的，题目如下：\n```json\n{"questions":[{"id":"","stem":"第一题","type":"short"},{"id":"","stem":"第二题","type":"essay"},{"id":"","stem":"截断中'
const a = salvageElements(truncated)
console.log('截断抢救:', a?.length === 2 ? 'PASS' : 'FAIL', JSON.stringify(a))

const ok = '{"questions":[{"stem":"x","type":"single"}]}'
const parsed = extractJson(ok)
console.log('正常 extractJson:', parsed?.questions?.length === 1 ? 'PASS' : 'FAIL')

const b = salvageElements('[{"a":1},{"a":2},{"a":3}]')
console.log('完整数组:', b?.length === 3 ? 'PASS' : 'FAIL')

console.log('无数组返回 null:', salvageElements('没有任何 JSON 数组的闲话') === null ? 'PASS' : 'FAIL')

// 尾随逗号 + markdown 围栏
const fenced = '```json\n[{"x":1,}, {"x":2,}]\n```'
const c = salvageElements(fenced)
console.log('围栏+尾逗号:', c?.length === 2 ? 'PASS' : 'FAIL')

// extractJson 对围栏尾逗号的容错
const d = extractJson(fenced)
console.log('extractJson 围栏:', Array.isArray(d) && d.length === 2 ? 'PASS' : 'FAIL')
