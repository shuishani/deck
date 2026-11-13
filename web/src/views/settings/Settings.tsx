import type { Source } from '../../api'
import { Page, PageHeader } from '../../components/PageHeader'
import { Tabs } from '../../components/ui'
import { href, type SettingsTab } from '../../router'
import { useMediaQuery } from '../../state'
import { Access } from './Access'
import { AiSettingsPage } from './Ai'
import { Connections } from './Connections'
import { Reminders } from './Reminders'
import { Retention } from './Retention'
import { Log, LOG_SUBTITLE } from '../Log'

// 电脑端日志在侧边栏有独立入口；手机底栏只有 4 格，日志仍放在设置里。
type Tab = SettingsTab | 'log'

const tabs: { id: Tab; label: string }[] = [
  { id: 'connections', label: '连接' },
  { id: 'reminders', label: '群与提醒' },
  { id: 'ai', label: 'AI' },
  { id: 'access', label: '访问' },
  { id: 'log', label: '日志' },
]

const subtitles: Record<Tab, string> = {
  connections: '已接入的平台及登录状态',
  reminders: '监测的群，以及哪些消息需要你处理',
  ai: 'AI 功能、模型与用量',
  access: '可访问 deck 的设备、消息保留',
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
      {tab === 'connections' && <Connections />}
      {tab === 'reminders' && <Reminders key={source ?? 'all'} source={source} />}
      {tab === 'ai' && <AiSettingsPage />}
      {tab === 'access' && (
        <div className="space-y-8">
          <Access />
          <Retention />
        </div>
      )}
      {tab === 'log' && <Log />}
    </Page>
  )
}
