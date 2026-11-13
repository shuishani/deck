import assert from 'node:assert/strict'
import test from 'node:test'
import { api } from '../src/api.ts'

test('连接探测有超时，不会因挂起请求永远停止重连', async (t) => {
  const original = globalThis.fetch
  let observed
  let fail
  globalThis.fetch = (_url, options) => {
    observed = options.signal
    return new Promise((_resolve, reject) => {
      fail = reject
      options.signal?.addEventListener('abort', () => reject(new Error('中断')), { once: true })
    })
  }
  t.mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const pending = api.version().catch((e) => e)
    assert.ok(observed instanceof AbortSignal)
    t.mock.timers.tick(8000)
    const result = await pending
    assert.ok(result instanceof Error)
    assert.equal(result.status, 0)
  } finally {
    fail?.(new Error('结束测试'))
    globalThis.fetch = original
  }
})

test('网络恢复不会自动重放发送请求', async () => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => { calls++; throw new Error('网络中断') }
  try {
    await assert.rejects(() => api.send('local-operation'), /连接暂时中断/)
    assert.equal(calls, 1)
  } finally {
    globalThis.fetch = original
  }
})

function stubFetch(t, payload = {}) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return new Response(JSON.stringify(payload), { status: 200 })
  }
  t.after(() => { globalThis.fetch = original })
  return calls
}

test('上传以原始二进制发送，带 X-Deck，文件名与群编码进查询', async (t) => {
  const calls = stubFetch(t, { attachment: { id: 'a1', name: 'a b.png', size: 3, mime: 'image/png', kind: 'image' } })
  const file = new File([new Uint8Array([1, 2, 3])], 'a b.png', { type: 'image/png' })
  const result = await api.upload(7, file)
  assert.equal(result.attachment.id, 'a1')
  assert.equal(calls[0].url, 'api/uploads?group=7&name=a+b.png')
  assert.equal(calls[0].options.body, file)
  assert.equal(calls[0].options.headers['X-Deck'], '1')
  assert.equal(calls[0].options.headers['Content-Type'], 'image/png')
})

test('搜索带游标与范围，空参数不进查询', async (t) => {
  const calls = stubFetch(t, { hits: [], next_cursor: null })
  await api.search({ q: '登录 失败', project: 'mx', cursor: 'c1' })
  assert.equal(calls[0].url, 'api/search?q=%E7%99%BB%E5%BD%95+%E5%A4%B1%E8%B4%A5&project=mx&cursor=c1&limit=30')
})

test('时间线支持 around 定位', async (t) => {
  const calls = stubFetch(t, { messages: [], has_more: false })
  await api.timeline({ group: 2, around: 99 })
  assert.match(calls[0].url, /around=99/)
})

test('AI 设置只提交环境变量名，不含明文密钥字段', async (t) => {
  const calls = stubFetch(t, { settings: {} })
  await api.updateAiSettings({ enabled: true, api_key_keychain: 'deck-ai' })
  assert.deepEqual(JSON.parse(calls[0].options.body), { enabled: true, api_key_keychain: 'deck-ai' })
})

test('AI 起草与预览携带附件 ID，确认发送仍只带 operation_id', async (t) => {
  const calls = stubFetch(t, {})
  await api.preview({ group: 1, text: 'x', ai: false, attachments: ['a1'] })
  assert.deepEqual(JSON.parse(calls[0].options.body).attachments, ['a1'])
  await api.send('op')
  assert.deepEqual(JSON.parse(calls[1].options.body), { operation_id: 'op', confirm: true })
})
