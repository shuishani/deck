import type { Source } from '../../api'
import { Page, PageHeader } from '../../components/PageHeader'
import { Tabs } from '../../components/ui'
import { href, type SettingsTab } from '../../router'
import { useMediaQuery } from '../../state'
import { Access } from './Access'
import { AiSettingsPage } from './Ai'
import { Connections } from './Connections'
import { Reminders } from './Reminders'
import { Log, LOG_SUBTITLE } from '../Log'

// 电脑端日志在侧边栏有独立入口；手机底栏只有 4 格，日志仍放在设置里。
type Tab = SettingsTab | 'log'

const tabs: { id: Tab; label: string }[] = [
  { id: 'connections', label: '会话' },
  { id: 'reminders', label: '提醒' },
  { id: 'ai', label: 'AI' },
  { id: 'access', label: '访问' },
  { id: 'log', label: '日志' },
]

const subtitles: Record<Tab, string> = {
  connections: 'deck 从哪些平台拉哪些会话、存多久',
  reminders: '什么消息要我处理、什么时候推送到钉钉',
  ai: '模型、用量与 AI 身份',
  access: '从哪些地址、哪些设备打开 deck',
  log: LOG_SUBTITLE,
}

export function Settings({ tab, source }: { tab: Tab; source?: Source }) {
  const mobile = useMediaQuery('(max-width: 767px)')
  const shown = mobile ? tabs : tabs.filter((option) => option.id !== 'log')
  return (
    <Page
      header={
        <PageHeader title="设置" subtitle={subtitles[tab]}>
          <Tabs
            value={tab}
            options={shown}
            hrefOf={(id) => (id === 'log' ? href({ name: 'log' }) : href({ name: 'settings', tab: id }))}
            className="px-2 md:px-4"
          />
        </PageHeader>
      }
    >
      {tab === 'connections' && <Connections key={source ?? 'all'} source={source} />}
      {tab === 'reminders' && <Reminders />}
      {tab === 'ai' && <AiSettingsPage />}
      {tab === 'access' && <Access />}
      {tab === 'log' && <Log />}
    </Page>
  )
}
