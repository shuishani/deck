import assert from 'node:assert/strict'
import test from 'node:test'
import { href, parse } from '../src/router.ts'

test('消息链接带 anchor 可往返解析', () => {
  assert.deepEqual(parse('#/messages/5?anchor=12'), { name: 'messages', group: 5, anchor: 12 })
  assert.equal(href({ name: 'messages', group: 5, anchor: 12 }), '#/messages/5?anchor=12')
  assert.equal(href({ name: 'messages', group: 5 }), '#/messages/5')
  assert.equal(parse('#/messages/5?anchor=abc').anchor, undefined)
})

test('设置链接可带平台筛选', () => {
  assert.equal(href({ name: 'settings', tab: 'connections', source: 'channel' }), '#/settings?source=channel')
  assert.deepEqual(parse('#/settings?source=channel'), { name: 'settings', tab: 'connections', source: 'channel' })
  assert.equal(parse('#/settings?source=x').source, undefined)
  assert.equal(href({ name: 'settings', tab: 'connections' }), '#/settings')
})
