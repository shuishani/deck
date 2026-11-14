import assert from 'node:assert/strict'

const AI = {
  enabled: true, provider: 'openai-compatible', base_url: 'https://api.example.com/v1', model: 'gpt-5.5',
  api_key_keychain: 'deck-ai', monthly_token_budget: 2000000, max_output_tokens: 8192,
  configured: true, endpoint_approved: true,
  usage: { input_tokens: 120000, output_tokens: 30000, total_tokens: 150000, reserved_tokens: 10000, requests: 8 },
}
const at = (minutes) => new Date(Date.now() - minutes * 60000).toISOString()
const address = {
  kind: 'lan', label: '局域网', url: 'http://192.0.2.10:18790/', secure: false,
  usable: true, recommended: true, pinned: true, status: '远程路由已批准', remote: 'active',
}
const plan = {
  url: address.url, route: '192.0.2.10/32', remote: 'none', running: true, routes_known: true,
  previous_routes: [], advertise_routes: ['192.0.2.10/32'],
  command: 'tailscale set --advertise-routes=192.0.2.10/32', rollback_command: "tailscale set --advertise-routes=''",
  warnings: ['此路由不限制端口，请在访问规则中仅开放所需端口。', '配置后仍须管理员批准。', '变更前应确认恢复方案。'],
}
const ACCESS = {
  tls: false, entry_plan: null,
  addresses: [address, { kind: 'local', label: '本机', url: 'http://127.0.0.1:18790/', secure: true, usable: true, recommended: false, status: '仅限本机' }],
  sessions: [
    { id: 'demo-current', current: true, user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130.0.0.0', ip: '127.0.0.1', origin: 'http://127.0.0.1:18790', created_at: at(120), last_seen_at: at(0), disabled_at: null },
    { id: 'demo-phone', current: false, user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Safari/604.1', ip: '192.0.2.20', origin: address.url.slice(0, -1), created_at: at(60), last_seen_at: at(10), disabled_at: null },
    { id: 'demo-disabled', current: false, user_agent: 'Mozilla/5.0 (Linux; Android 15) Chrome/130.0.0.0', ip: '100.64.0.20', origin: 'http://100.64.0.10:18790', created_at: at(240), last_seen_at: at(60), disabled_at: at(30) },
  ],
}
const blocked = (route) => route.fulfill({ status: 403, json: { error: '演示环境禁止实际修改模型配置、访问权限或网络入口' } })

/** 模型、凭据、设备和网络入口仅使用演示响应，不触及真实配置。 */
export async function mockAiAccess(context) {
  await context.route('**/api/ai/**', blocked)
  await context.route('**/api/ai/settings', (route) => route.request().method() === 'GET' ? route.fulfill({ json: { settings: AI } }) : blocked(route))
  await context.route('**/api/access/**', blocked)
  await context.route('**/api/access', (route) => route.fulfill({ json: ACCESS }))
  await context.route('**/api/sessions/**', blocked)
  await context.route('**/api/session', blocked)
  await context.route('**/api/pairings', (route) => route.fulfill({ json: { code: 'DEMO1234', expires_at: new Date(Date.now() + 300000).toISOString() } }))
}

async function withAi(page, patch) {
  await page.route('**/api/ai/settings', (route) => route.request().method() === 'GET' ? route.fulfill({ json: { settings: { ...AI, ...patch } } }) : blocked(route))
}
async function withAccess(page, patch) {
  await page.route('**/api/access', (route) => route.fulfill({ json: { ...ACCESS, ...patch } }))
}
async function changeAi(page) {
  await page.locator('summary').filter({ hasText: '模型配置' }).click()
  await page.getByRole('textbox', { name: '模型名称', exact: true }).fill('gpt-5.5-demo')
  await page.getByRole('spinbutton', { name: '每月 token 上限', exact: true }).fill('3000000')
  await page.getByRole('switch', { name: '启用 AI', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '保存本页修改', exact: true }).count(), 1)
}
async function manage(page, name) {
  await page.getByRole('button', { name: `管理 ${name}`, exact: true }).click()
}
const aiPage = (name, act, setup) => ({ name: `settings-ai${name}`, hash: '#/settings/ai', act, setup })
const accessPage = (name, act, setup) => ({ name: `settings-access${name}`, hash: '#/settings/access', act, setup })

export const AI_ACCESS_PAGES = [
  aiPage('', async (page) => {
    assert.equal(await page.getByRole('textbox', { name: '接口地址', exact: true }).isVisible(), false)
    assert.equal(await page.getByRole('spinbutton', { name: '单次输出上限', exact: true }).isVisible(), false)
    assert.equal(await page.getByText('已配置', { exact: true }).isVisible(), true)
    assert.equal(await page.getByText('自动化规则', { exact: true }).count(), 0)
    assert.equal(await page.getByRole('progressbar', { name: '本月 token 用量' }).getAttribute('aria-valuenow'), '160000')
  }),
  aiPage('-unconfigured', async (page) => {
    assert.equal(await page.getByRole('textbox', { name: '接口地址', exact: true }).isVisible(), true)
    assert.equal(await page.getByText('待配置', { exact: true }).isVisible(), true)
  }, (page) => withAi(page, { enabled: false, base_url: '', model: '', configured: false, endpoint_approved: false })),
  ...[
    ['-approval', { endpoint_approved: false, configured: false }, '待批准'],
    ['-missing-key', { configured: false }, '缺少密钥'],
  ].map(([name, patch, status]) => aiPage(name, async (page) => {
    assert.equal(await page.getByText(status, { exact: true }).isVisible(), true)
    assert.equal(await page.getByRole('button', { name: '复制配置命令', exact: true }).isEnabled(), true)
    await page.getByRole('textbox', { name: '模型名称', exact: true }).fill('gpt-5.5-demo')
    assert.equal(await page.getByRole('button', { name: '复制配置命令', exact: true }).isDisabled(), true)
  }, (page) => withAi(page, patch))),
  aiPage('-configuration', async (page) => {
    await page.locator('summary').filter({ hasText: '模型配置' }).click()
    assert.equal(await page.getByRole('textbox', { name: '接口地址', exact: true }).isVisible(), true)
    assert.equal(await page.getByText('所选消息和任务内容会发送至此接口。非本机接口须在运行 deck 的电脑上批准。', { exact: true }).isVisible(), true)
  }),
  aiPage('-advanced', async (page) => {
    await page.locator('summary').filter({ hasText: '高级设置' }).click()
    const output = page.getByRole('spinbutton', { name: '单次输出上限', exact: true })
    for (const value of ['127', '32769', '8192']) {
      await output.fill(value)
      assert.equal(await page.getByRole('button', { name: '保存本页修改', exact: true }).isDisabled(), value !== '8192')
    }
    await page.getByRole('button', { name: '还原', exact: true }).click()
    await output.scrollIntoViewIfNeeded()
    assert.equal(await page.getByText('含 10,000 token 预留用量，尚未经供应商确认。', { exact: true }).isVisible(), true)
  }),
  aiPage('-identity', async (page) => {
    await page.locator('summary').filter({ hasText: '发送标识说明' }).click()
    assert.equal(await page.getByText('平台标注', { exact: true }).isVisible(), true)
  }),
  aiPage('-pending', async (page) => {
    await changeAi(page)
    await page.getByRole('button', { name: '还原', exact: true }).click()
    assert.equal(await page.getByRole('textbox', { name: '模型名称', exact: true }).inputValue(), AI.model)
    assert.equal(await page.getByRole('spinbutton', { name: '每月 token 上限', exact: true }).inputValue(), String(AI.monthly_token_budget))
    assert.equal(await page.getByRole('switch', { name: '启用 AI', exact: true }).getAttribute('aria-checked'), 'true')
    await page.getByRole('textbox', { name: '模型名称', exact: true }).fill('gpt-5.5-demo')
    const budget = page.getByRole('spinbutton', { name: '每月 token 上限', exact: true })
    for (const value of ['0', '7.5', '100000001', '3000000']) {
      await budget.fill(value)
      assert.equal(await page.getByRole('button', { name: '保存本页修改', exact: true }).isDisabled(), value !== '3000000')
    }
  }),
  aiPage('-save', async (page) => {
    let submitted
    await page.route('**/api/ai/settings', async (route) => {
      submitted = route.request().postDataJSON()
      await route.fulfill({ json: { settings: { ...AI, ...submitted } } })
    })
    await changeAi(page)
    await page.getByRole('button', { name: '保存本页修改', exact: true }).click()
    await page.getByText('本页有未保存的修改', { exact: true }).waitFor({ state: 'hidden' })
    assert.equal(submitted.model, 'gpt-5.5-demo')
    assert.equal(submitted.monthly_token_budget, 3000000)
    assert.equal(submitted.enabled, false)
    assert.equal(await page.getByText('已关闭', { exact: true }).isVisible(), true)
  }),
  aiPage('-save-error', async (page) => {
    await page.route('**/api/ai/settings', (route) => route.fulfill({ status: 400, json: { error: '演示：AI 设置保存失败' } }))
    await changeAi(page)
    await page.getByRole('button', { name: '保存本页修改', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '演示：AI 设置保存失败' }).waitFor()
    assert.equal(await page.getByRole('textbox', { name: '模型名称', exact: true }).inputValue(), 'gpt-5.5-demo')
  }),
  accessPage('', async (page) => {
    assert.equal(await page.getByText('当前设备', { exact: true }).isVisible(), true)
    assert.equal(await page.getByRole('button', { name: '禁用', exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: '移除', exact: true }).count(), 0)
    assert.equal(await page.getByText('此地址使用 HTTP，仅应在可信网络中访问。', { exact: true }).isVisible(), true)
  }),
  accessPage('-current', async (page) => {
    await manage(page, 'Mac · Chrome')
    const dialog = page.getByRole('dialog')
    assert.equal(await dialog.getByRole('button', { name: '退出登录', exact: true }).isVisible(), true)
    assert.equal(await dialog.getByRole('button', { name: '禁用', exact: true }).count(), 0)
    assert.equal(await dialog.getByRole('button', { name: '移除', exact: true }).count(), 0)
  }),
  accessPage('-device', async (page) => {
    await manage(page, 'iPhone · Safari')
    assert.equal(await page.getByRole('dialog').getByRole('button', { name: '禁用', exact: true }).isVisible(), true)
  }),
  ...[['-disable', '禁用'], ['-remove', '移除'], ['-logout', '退出登录']].map(([name, action]) => accessPage(name, async (page) => {
    let writes = 0
    await page.route(/\/api\/sessions?\//, (route) => { writes += 1; return blocked(route) })
    await page.route('**/api/session', (route) => { writes += 1; return blocked(route) })
    await manage(page, action === '退出登录' ? 'Mac · Chrome' : 'iPhone · Safari')
    await page.getByRole('dialog').getByRole('button', { name: action, exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).waitFor()
    assert.equal(writes, 0)
  })),
  accessPage('-enable', async (page) => {
    const data = structuredClone(ACCESS)
    await withAccess(page, data)
    let enabled = false
    await page.route('**/api/sessions/demo-disabled/enable', async (route) => {
      enabled = true
      data.sessions.find((session) => session.id === 'demo-disabled').disabled_at = null
      await route.fulfill({ json: { ok: true } })
    })
    await manage(page, 'Android · Chrome')
    await page.getByRole('dialog').getByRole('button', { name: '启用', exact: true }).click()
    await page.getByText('已启用 Android · Chrome', { exact: true }).waitFor()
    await page.getByText('已禁用', { exact: true }).waitFor({ state: 'hidden' })
    assert.equal(enabled, true)
  }),
  accessPage('-pairing', async (page) => {
    await page.getByRole('button', { name: '添加设备', exact: true }).click()
    await page.getByAltText('登录二维码', { exact: true }).waitFor()
  }),
  accessPage('-pairing-error', async (page) => {
    await page.route('**/api/pairings', (route) => route.fulfill({ status: 400, json: { error: '演示：登录信息生成失败' } }))
    await page.getByRole('button', { name: '添加设备', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '演示：登录信息生成失败' }).waitFor()
    assert.equal(await page.getByRole('button', { name: '重试', exact: true }).isVisible(), true)
  }),
  ...[
    ['-remote-pending', { ...plan, remote: 'pending' }, '远程路由待批准，暂不可远程访问。'],
    ['-remote-stopped', { ...plan, running: false }, 'Tailscale 未运行，远程访问不可用。'],
    ['-remote-unknown', { ...plan, routes_known: false, previous_routes: null, advertise_routes: null, command: null, rollback_command: null }, '无法读取现有路由，暂不提供配置命令。'],
  ].map(([name, entryPlan, notice]) => accessPage(name, async (page) => {
    assert.equal(await page.getByText(notice, { exact: true }).isVisible(), true)
    assert.equal(await page.getByText('宣告路由', { exact: true }).isVisible(), false)
    await page.locator('summary').filter({ hasText: '远程访问设置' }).click()
    if (!entryPlan.routes_known) assert.equal(await page.getByText('宣告路由', { exact: true }).count(), 0)
  }, (page) => withAccess(page, {
    addresses: [{ ...address, remote: entryPlan.remote, status: !entryPlan.running ? 'Tailscale 未运行' : !entryPlan.routes_known ? '远程路由状态未知' : entryPlan.remote === 'pending' ? '远程路由待批准' : '远程路由未配置' }],
    entry_plan: entryPlan,
  }))),
  accessPage('-candidate', async (page) => {
    assert.equal(await page.getByRole('button', { name: '固定入口', exact: true }).isVisible(), true)
    assert.equal(await page.getByText('仅保存地址，不修改网络路由。', { exact: true }).isVisible(), true)
  }, (page) => withAccess(page, { addresses: [{ ...address, pinned: false, remote: 'none', status: '远程路由未配置' }], entry_plan: plan })),
  accessPage('-local', async (page) => {
    assert.equal(await page.getByText(/^本机\s*·\s*仅限本机$/).isVisible(), true)
    assert.equal(await page.getByRole('button', { name: '固定入口', exact: true }).count(), 0)
  }, (page) => withAccess(page, { addresses: [{ ...ACCESS.addresses[1], recommended: true }], sessions: [ACCESS.sessions[0]] })),
  accessPage('-unavailable', async (page) => {
    assert.equal(await page.getByText('入口地址当前不可用，请检查服务器地址及监听配置。', { exact: true }).isVisible(), true)
  }, (page) => withAccess(page, { addresses: [{ ...address, usable: false, status: '地址不可用' }] })),
]
