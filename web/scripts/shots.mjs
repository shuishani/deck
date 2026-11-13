// 用本机 Chrome 把各页面按电脑和手机两种宽度截图，供改 UI 后整体检查。
// 由 scripts/ui-shots.sh 调用：node scripts/shots.mjs <登录链接> <输出目录> [页面名过滤]
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

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

/** 页面名 → 地址；act 在截图前操作页面。 */
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
  { name: 'settings-connections', hash: '#/settings' },
  { name: 'settings-reminders', hash: '#/settings/reminders' },
  { name: 'settings-ai', hash: '#/settings/ai' },
  { name: 'settings-access', hash: '#/settings/access' },
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
  const page = await context.newPage()
  page.on('pageerror', (error) => failures.push(`${device}: ${error.message}`))
  page.on('response', (response) => {
    if (response.url().includes('/api/') && response.status() >= 500) failures.push(`${device}: ${response.status()} ${response.url()}`)
  })
  for (const item of PAGES) {
    if (only && !item.name.includes(only)) continue
    // 带不同的查询参数：每张都重新加载，不继承上一张切换的页签等状态。
    await page.goto(`${base}?shot=${item.name}${item.hash}`)
    await page.waitForLoadState('networkidle')
    try {
      if (item.act) await item.act(page)
    } catch (error) {
      failures.push(`${device} ${item.name}: 操作失败 ${error.message.split('\n')[0]}`)
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
