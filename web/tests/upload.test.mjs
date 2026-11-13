import assert from 'node:assert/strict'
import test from 'node:test'
import { checkAttachment } from '../src/upload.ts'

const cap = { send_text: true, send_images: true, send_files: false, reply: true, edit: false, retract: false, max_attachment_bytes: 5 * 1024 * 1024, max_files: 1 }
const file = (type, size, name = 'a') => ({ type, size, name })

test('能力为 false 时拒绝，不静默忽略附件', () => {
  assert.match(checkAttachment(file('application/pdf', 10), cap), /不支持发送文件/)
  assert.match(checkAttachment(file('image/png', 10), { ...cap, send_images: false, send_files: true }), /不支持发送图片/)
  assert.match(checkAttachment(file('image/png', 10), { ...cap, max_files: 0 }), /不支持/)
  assert.equal(checkAttachment(file('image/png', 10), cap), null)
})

test('大小取 10MiB 与平台上限的较小值', () => {
  assert.match(checkAttachment(file('image/png', 6 * 1024 * 1024), cap), /5 MB/)
  assert.match(checkAttachment(file('image/png', 11 * 1024 * 1024), { ...cap, max_attachment_bytes: 0 }), /10 MB/)
  assert.match(checkAttachment(file('image/png', 0), cap), /空文件/)
})
