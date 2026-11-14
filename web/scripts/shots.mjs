// 用本机 Chrome 把各页面按电脑和手机两种宽度截图，供改 UI 后整体检查。
// 由 scripts/ui-shots.sh 调用：node scripts/shots.mjs <登录链接> <输出目录> [页面名过滤]
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { AI_ACCESS_PAGES, mockAiAccess } from './ai-access-shots.mjs'

const [login, out, only] = process.argv.slice(2)
if (!login || !out) {
  console.error('用法：node scripts/shots.mjs <登录链接> <输出目录> [页面名过滤]')
  process.exit(1)
}
const base = login.split('#')[0]

const VIEWPORTS = {
  // 页面在内部滚动，整页截图截不到下方：电脑端用较高的窗口。
  desktop: { viewport: { width: 1440, height: 1500 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
}

const NOTIFY = {
  enabled: true,
  levels: { urgent: { work: 15, off: 30 }, high: { work: null, off: null }, medium: { work: null, off: null }, low: { work: null, off: null } },
  work_days: [1, 2, 3, 4, 5], work_start: '09:30', work_end: '18:30',
  digest: true, digest_time: '09:30', webhook: true, signed: true,
}

async function openChatSettings(page) {
  await page.locator('#chats').getByRole('button', { name: /客户A 项目群/ }).first().click()
}

async function changeReminders(page) {
  await page.getByRole('button', { name: '紧急·上班时间', exact: true }).click()
  await page.getByRole('option', { name: '5 分钟', exact: true }).click()
  await page.getByRole('switch', { name: '自动推送', exact: true }).click()
  await page.getByRole('switch', { name: '每日汇报', exact: true }).click()
  assert.equal(await page.getByLabel('汇报时间', { exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: '保存本页修改', exact: true }).count(), 1)
}

async function openRetention(page) {
  await page.locator('summary').filter({ hasText: '仅手动清理' }).click()
  return page.getByRole('spinbutton', { name: '保留天数', exact: true })
}

/** 页面名 → 地址；act 在截图前操作页面，也检查展开状态。 */
const PAGES = [
  { name: 'messages', hash: '#/messages' },
  { name: 'messages-group', hash: '#/messages/3' },
  { name: 'messages-long-name', hash: '#/messages/10' },
  { name: 'messages-mentions', hash: '#/messages', act: (page) => page.getByRole('tab', { name: /需回复/ }).click() },
  { name: 'messages-project-filter', hash: '#/messages', act: (page) => page.getByLabel('按项目筛选').first().click() },
  { name: 'tasks', hash: '#/tasks' },
  { name: 'task-detail', hash: '#/tasks', act: (page) => page.getByText('登录页白屏排查').first().click() },
  { name: 'projects', hash: '#/projects' },
  { name: 'project-overview', hash: '#/projects/mx' },
  { name: 'project-delivery', hash: '#/projects/delivery' },
  { name: 'project-tasks', hash: '#/projects/mx/tasks' },
  { name: 'project-messages', hash: '#/projects/mx/messages' },
  { name: 'project-settings', hash: '#/projects/mx/settings' },
  { name: 'log', hash: '#/log' },
  { name: 'settings-connections', hash: '#/settings', act: async (page) => {
    assert.equal(await page.getByText('命令行工具', { exact: true }).first().isVisible(), false)
    assert.equal(await page.getByText('平台响应超时，deck 将自动重试；如持续出现，请检查网络。', { exact: true }).isVisible(), true)
  } },
  { name: 'settings-connections-details', hash: '#/settings', act: async (page) => {
    await page.locator('summary').filter({ hasText: '连接详情' }).first().click()
    assert.equal(await page.getByText('命令行工具', { exact: true }).first().isVisible(), true)
    assert.equal(await page.getByText('登录状态读取自本机，未联网验证。').first().isVisible(), true)
  } },
  { name: 'settings-connections-list', hash: '#/settings', act: async (page) => {
    await page.locator('#chats').evaluate((element) => element.scrollIntoView({ block: 'start' }))
    assert.equal(await page.locator('#chats').getByText('默认', { exact: true }).count(), 0)
    assert.equal(await page.getByPlaceholder('搜索会话').isVisible(), true)
    assert.equal(await page.getByText('接入新平台', { exact: true }).count(), 0)
  } },
  { name: 'settings-connections-retention', hash: '#/settings', act: async (page) => {
    await page.locator('summary').filter({ hasText: '仅手动清理' }).scrollIntoViewIfNeeded()
    assert.equal(await page.getByRole('spinbutton', { name: '保留天数', exact: true }).isVisible(), false)
  } },
  { name: 'settings-connections-retention-edit', hash: '#/settings', act: async (page) => {
    const input = await openRetention(page)
    const original = await input.inputValue()
    const copy = page.getByRole('button', { name: '复制命令', exact: true })
    for (const value of ['0', '7.5', '3651', '45']) {
      await input.fill(value)
      assert.equal(await copy.isDisabled(), true)
      assert.equal(await page.getByRole('button', { name: '保存', exact: true }).isDisabled(), value !== '45')
    }
    await page.getByRole('button', { name: '还原', exact: true }).click()
    assert.equal(await input.inputValue(), original)
    assert.equal(await copy.isEnabled(), true)
    await input.fill('45')
    await page.getByRole('button', { name: '保存', exact: true }).scrollIntoViewIfNeeded()
  } },
  { name: 'settings-connections-retention-save', hash: '#/settings', act: async (page) => {
    const input = await openRetention(page)
    const original = await input.inputValue()
    const next = String(Number(original) + 1)
    await input.fill(next)
    const fail = (route) => route.request().method() === 'POST'
      ? route.fulfill({ status: 400, json: { error: '演示：天数保存失败' } })
      : route.continue()
    await page.route('**/api/config', fail)
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '演示：天数保存失败' }).waitFor()
    assert.equal(await page.getByRole('button', { name: '复制命令', exact: true }).isDisabled(), true)
    await page.unroute('**/api/config', fail)
    // 只写入隔离的演示库，保存后恢复原值；不执行清理命令。
    for (const value of [next, original]) {
      await input.fill(value)
      await page.getByRole('button', { name: '保存', exact: true }).click()
      await page.getByText(`仅手动清理 · 保留最近 ${value} 天`, { exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: '复制命令', exact: true }).isEnabled(), true)
    }
  } },
  { name: 'settings-reminders', hash: '#/settings/reminders', act: async (page) => {
    assert.equal(await page.getByText('自动推送尚未上线，规则可先保存').isVisible(), true)
    assert.equal(await page.getByRole('button', { name: '紧急·上班时间', exact: true }).innerText(), '15 分钟')
  } },
  { name: 'settings-reminders-help', hash: '#/settings/reminders', act: async (page) => {
    await page.locator('summary').filter({ hasText: '规则说明' }).click()
    assert.equal(await page.getByText('「高」级别的等待时间也用于', { exact: false }).isVisible(), true)
  } },
  { name: 'settings-reminders-delivery', hash: '#/settings/reminders', act: async (page) => {
    await page.getByLabel('汇报时间', { exact: true }).scrollIntoViewIfNeeded()
    assert.equal(await page.getByText('Webhook 和加签密钥保存在本机钥匙串中，页面不显示密钥。', { exact: true }).isVisible(), false)
    assert.equal(await page.getByRole('switch', { name: '自动推送', exact: true }).isVisible(), true)
  } },
  { name: 'settings-reminders-details', hash: '#/settings/reminders', act: async (page) => {
    await page.locator('summary').filter({ hasText: '配置详情' }).click()
    assert.equal(await page.getByText('Webhook 和加签密钥保存在本机钥匙串中，页面不显示密钥。', { exact: true }).isVisible(), true)
  } },
  { name: 'settings-reminders-configure', hash: '#/settings/reminders', act: async (page) => {
    await page.getByRole('button', { name: '更换', exact: true }).click()
    assert.equal(await page.getByRole('textbox', { name: 'Webhook', exact: true }).isVisible(), true)
    assert.equal(await page.getByRole('button', { name: '保存机器人', exact: true }).isDisabled(), true)
  } },
  { name: 'settings-reminders-unconfigured', hash: '#/settings/reminders', act: async (page) => {
    await page.route('**/api/notify', (route) => route.fulfill({ json: { settings: { ...NOTIFY, webhook: false, signed: false } } }))
    await page.reload()
    await page.getByRole('button', { name: '配置', exact: true }).click()
    assert.equal(await page.getByRole('textbox', { name: 'Webhook', exact: true }).isVisible(), true)
    assert.equal(await page.getByRole('button', { name: '发送测试', exact: true }).count(), 0)
  } },
  { name: 'settings-reminders-remote', hash: '#/settings/reminders', act: async (page) => {
    // 虚拟远程地址的全部请求在浏览器内转到演示服务，不访问外网。
    const remote = 'http://deck.demo.test'
    await page.route(`${remote}/**`, async (route) => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/notify') return route.fulfill({ json: { settings: NOTIFY } })
      if (route.request().method() !== 'GET') return route.abort()
      const response = await page.request.get(new URL(url.pathname + url.search, base).href)
      await route.fulfill({ response })
    })
    await page.goto(`${remote}/#/settings/reminders`)
    await page.getByRole('button', { name: '更换', exact: true }).click()
    assert.equal(await page.getByText('请在运行 deck 的电脑上通过 127.0.0.1 打开本页配置机器人。', { exact: true }).isVisible(), true)
    assert.equal(await page.getByRole('textbox', { name: 'Webhook', exact: true }).count(), 0)
  } },
  { name: 'settings-reminders-pending', hash: '#/settings/reminders', act: async (page) => {
    const documentFits = () => page.evaluate(() => document.documentElement.scrollHeight === innerHeight && scrollY === 0)
    assert.equal(await documentFits(), true)
    await changeReminders(page)
    const save = page.getByRole('button', { name: '保存本页修改', exact: true })
    assert.equal(await save.isVisible(), true)
    const viewport = page.viewportSize()
    const box = await save.boundingBox()
    assert.ok(box && box.y >= 0 && box.y + box.height <= viewport.height)
    await page.getByRole('button', { name: '还原', exact: true }).click()
    assert.equal(await page.getByLabel('汇报时间', { exact: true }).count(), 1)
    assert.equal(await page.getByRole('switch', { name: '自动推送', exact: true }).getAttribute('aria-checked'), 'true')
    assert.equal(await documentFits(), true)
    await changeReminders(page)
    assert.equal(await documentFits(), true)
    const select = page.getByRole('button', { name: '紧急·上班时间', exact: true })
    await select.click()
    const scrolled = await page.locator('main .scroll-thin').evaluate((element) => {
      const before = element.scrollTop
      element.scrollTop += 40
      return element.scrollTop !== before
    })
    if (scrolled) await page.getByRole('listbox', { name: '紧急·上班时间', exact: true }).waitFor({ state: 'hidden' })
    else await select.click()
    await page.getByRole('switch', { name: '每日汇报', exact: true }).scrollIntoViewIfNeeded()
  } },
  { name: 'settings-reminders-save', hash: '#/settings/reminders', act: async (page) => {
    let submitted
    await page.route('**/api/notify', async (route) => {
      submitted = route.request().postDataJSON()
      await route.fulfill({ json: { settings: { ...NOTIFY, ...submitted } } })
    })
    await changeReminders(page)
    await page.getByRole('button', { name: '保存本页修改', exact: true }).click()
    await page.getByText('本页有未保存的修改', { exact: true }).waitFor({ state: 'hidden' })
    assert.equal(submitted.enabled, false)
    assert.equal(submitted.digest, false)
    assert.equal(submitted.levels.urgent.work, 5)
    assert.equal(await page.getByRole('switch', { name: '自动推送', exact: true }).getAttribute('aria-checked'), 'false')
  } },
  { name: 'settings-reminders-save-error', hash: '#/settings/reminders', act: async (page) => {
    await page.route('**/api/notify', (route) => route.fulfill({ status: 400, json: { error: '演示：保存失败，请重试' } }))
    await changeReminders(page)
    await page.getByRole('button', { name: '保存本页修改', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '演示：保存失败，请重试' }).waitFor()
    assert.equal(await page.getByRole('button', { name: '保存本页修改', exact: true }).isEnabled(), true)
    assert.equal(await page.getByRole('switch', { name: '自动推送', exact: true }).getAttribute('aria-checked'), 'false')
  } },
  { name: 'settings-reminders-test', hash: '#/settings/reminders', act: async (page) => {
    let finish
    const pending = new Promise((resolve) => { finish = resolve })
    await page.route('**/api/notify/test', async (route) => {
      await pending
      await route.fulfill({ status: 400, json: { error: '演示：测试发送失败，未实际发消息' } })
    })
    await page.getByRole('switch', { name: '自动推送', exact: true }).click()
    await page.getByRole('button', { name: '发送测试', exact: true }).click()
    try {
      const sending = page.getByRole('button', { name: '发送中…', exact: true })
      await sending.waitFor()
      assert.equal(await sending.isDisabled(), true)
    } finally {
      finish()
    }
    await page.getByText('演示：测试发送失败，未实际发消息', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '发送测试', exact: true }).isEnabled(), true)
  } },
  { name: 'settings-chats', hash: '#/settings', act: (page) => page.getByRole('tab', { name: /单聊/ }).click() },
  { name: 'settings-chat-dialog', hash: '#/settings', act: async (page) => {
    await openChatSettings(page)
    assert.equal(await page.getByText('接收新消息', { exact: true }).isVisible(), true)
    assert.equal(await page.getByRole('dialog').locator('input[type="time"]').count(), 0)
  } },
  { name: 'settings-chat-dialog-help', hash: '#/settings', act: async (page) => {
    await openChatSettings(page)
    await page.getByRole('dialog').locator('summary').click()
    assert.equal(await page.getByText('会话范围决定哪些消息进入', { exact: false }).isVisible(), true)
  } },
  { name: 'settings-chat-dialog-off', hash: '#/settings', act: async (page) => {
    await openChatSettings(page)
    await page.getByRole('radio', { name: '不提醒', exact: true }).click()
    assert.equal(await page.getByText('消息仍保存，不进入「需回复」「疑似问题」，也不推送。').isVisible(), true)
  } },
  { name: 'settings-chat-dialog-keywords', hash: '#/settings', act: async (page) => {
    await openChatSettings(page)
    await page.getByRole('radio', { name: '关键词', exact: true }).click()
    assert.equal(await page.getByRole('dialog').getByRole('textbox').isVisible(), true)
    assert.equal(await page.getByRole('button', { name: '保存', exact: true }).isDisabled(), true)
  } },
  { name: 'settings-chat-dialog-quiet', hash: '#/settings', act: async (page) => {
    await openChatSettings(page)
    const toggle = page.getByRole('switch', { name: '安静时段', exact: true })
    await toggle.click()
    assert.equal(await page.getByRole('dialog').locator('input[type="time"]').count(), 2)
    assert.equal(await page.getByText('时段内不提醒、不推送，结束后恢复符合规则的未处理消息。').isVisible(), true)
  } },
  { name: 'settings-chat-dialog-project', hash: '#/settings', act: async (page) => {
    await openChatSettings(page)
    await page.getByRole('button', { name: '所属项目', exact: true }).click()
    await page.getByRole('option', { name: 'Management-X', exact: true }).click()
    assert.equal(await page.getByText('点击「调整」立即生效', { exact: false }).isVisible(), true)
    assert.equal(await page.getByRole('button', { name: '调整', exact: true }).isEnabled(), true)
  } },
  ...AI_ACCESS_PAGES,
]

mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
// 登录码只能用一次：登录一次后各设备共用登录状态。
const first = await browser.newContext()
const entry = await first.newPage()
await entry.goto(login)
await entry.waitForURL(/#\/messages/)
const storageState = await first.storageState()
await first.close()

const failures = []
for (const [device, options] of Object.entries(VIEWPORTS)) {
  const context = await browser.newContext({ ...options, storageState, locale: 'zh-CN', colorScheme: 'light' })
  // 推送使用固定演示响应，禁止实际发送消息或修改钥匙串。
  await context.route('**/api/notify', (route) => route.fulfill({ json: { settings: NOTIFY } }))
  await context.route('**/api/notify/**', (route) => route.fulfill({ status: 403, json: { error: '演示环境禁止实际发送或修改机器人' } }))
  await mockAiAccess(context)
  const page = await context.newPage()
  page.on('pageerror', (error) => failures.push(`${device}: ${error.message}`))
  page.on('response', (response) => {
    if (response.url().includes('/api/') && response.status() >= 500) failures.push(`${device}: ${response.status()} ${response.url()}`)
  })
  for (const item of PAGES) {
    if (only && !item.name.includes(only)) continue
    // 带不同的查询参数：每张都重新加载，不继承上一张切换的页签等状态。
    await page.unrouteAll({ behavior: 'wait' })
    if (item.setup) await item.setup(page)
    await page.goto(`${base}?shot=${item.name}${item.hash}`)
    await page.waitForLoadState('networkidle')
    try {
      if (item.act) await item.act(page)
    } catch (error) {
      failures.push(`${device} ${item.name}: 操作失败 ${error.message}`)
    }
    await page.waitForTimeout(400)
    await page.screenshot({ path: join(out, `${item.name}-${device}.png`) })
  }
  await context.close()
}
await browser.close()
if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log(`截图已保存到 ${out}`)
