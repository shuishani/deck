import assert from 'node:assert/strict'
import test from 'node:test'

import { startPolling } from '../src/connection.ts'

function clock() {
  const tasks = new Map()
  let id = 0
  return {
    tasks,
    schedule: (fn) => { tasks.set(++id, fn); return id },
    cancel: (key) => tasks.delete(key),
    fire: async () => { const [key, fn] = tasks.entries().next().value; tasks.delete(key); await fn(); },
  }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

test('连接失败后自动重试，同一版本恢复也通知重新加载', async () => {
  assert.equal(typeof startPolling, 'function')
  const timer = clock()
  let offline = false
  const values = [], states = []
  const poll = startPolling({
    probe: async () => { if (offline) throw new Error('切网'); return 42 },
    onValue: (value, recovered) => values.push([value, recovered]),
    onState: (state) => states.push(state),
    schedule: timer.schedule, cancel: timer.cancel,
  })
  await flush()
  offline = true
  await timer.fire()
  await flush()
  offline = false
  await timer.fire()
  await flush()
  assert.deepEqual(values, [[42, false], [42, true]])
  assert.deepEqual(states, ['online', 'reconnecting', 'online'])
  poll.stop()
  assert.equal(timer.tasks.size, 0)
})

test('系统报告切网后，即使版本没变也重新加载数据', async () => {
  assert.equal(typeof startPolling, 'function')
  const timer = clock()
  const values = []
  const poll = startPolling({ probe: async () => 7, onValue: (v, recovered) => values.push([v, recovered]),
    schedule: timer.schedule, cancel: timer.cancel })
  await flush()
  assert.equal(typeof poll.disconnect, 'function')
  poll.disconnect()
  poll.wake()
  await flush()
  assert.deepEqual(values, [[7, false], [7, true]])
  poll.stop()
})

test('online唤醒不会重叠请求，停止后不会再修改页面状态', async () => {
  assert.equal(typeof startPolling, 'function')
  const timer = clock()
  let finish
  let calls = 0
  const values = []
  const poll = startPolling({
    probe: () => { calls++; return new Promise((r) => { finish = r }) },
    onValue: (value) => values.push(value),
    schedule: timer.schedule, cancel: timer.cancel,
  })
  poll.wake(); poll.wake()
  assert.equal(calls, 1)
  poll.stop()
  finish(1)
  await flush()
  assert.deepEqual(values, [])
  assert.equal(timer.tasks.size, 0)
})
