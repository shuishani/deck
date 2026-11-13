import assert from 'node:assert/strict'
import test from 'node:test'
import { listTime, shortVersion } from '../src/format.ts'

test('版本号只取语义化版本；没有时缩短 hash，整体不超过 24 字符', () => {
  assert.equal(shortVersion('v1.0.19 (1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d)'), 'v1.0.19')
  assert.equal(shortVersion('dws version v1.0.67 (63ab12cd34ef5678)'), 'v1.0.67')
  assert.equal(shortVersion('drlee 0.0.7'), '0.0.7')
  assert.equal(shortVersion('build 1a2b3c4d5e6f708192a3'), 'build 1a2b3c4')
  assert.ok(shortVersion('x'.repeat(60)).length <= 24)
  assert.equal(shortVersion('1.2.3'), '1.2.3')
  assert.equal(shortVersion(null), '未知')
})

test('列表时间：一天内相对时间，更早只显示日期', () => {
  const ago = (hours) => new Date(Date.now() - hours * 3600_000).toISOString()
  assert.equal(listTime(ago(3)), '3 小时前')
  const old = new Date(Date.now() - 3 * 86400_000)
  const expected = old.getFullYear() === new Date().getFullYear() ? `${old.getMonth() + 1}月${old.getDate()}日` : `${old.getFullYear()}/${old.getMonth() + 1}/${old.getDate()}`
  assert.equal(listTime(old.toISOString()), expected)
  assert.equal(listTime('2020-03-05T08:00:00Z'), '2020/3/5')
})
