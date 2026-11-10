import clsx from 'clsx'
import { Bot, Gauge, Plus, Power, Sparkles, Workflow } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Source } from '../api'
import { Page, PageHeader } from '../components/PageHeader'
import { SourceBadge, StatusDot, watchLabel, watchTone } from '../components/SourceBadge'
import { ComingSoon } from '../mock/ComingSoon'
import { Tabs } from '../components/ui'
import { setAiPaused, useAiPaused } from '../mock/aiSwitch'
import { href, type SettingsTab } from '../router'
import { useDeck, type GroupInfo } from '../state'
import { Access } from './Access'
import { Log } from './Log'

const tabs: { id: SettingsTab; label: string }[] = [
  { id: 'connections', label: '连接' },
  { id: 'ai', label: 'AI' },
  { id: 'access', label: '访问' },
  { id: 'log', label: '日志' },
]

const subtitles: Record<SettingsTab, string> = {
  connections: '接入的平台和它们的登录状态',
  ai: 'AI 能做什么、用哪个模型、花多少',
  access: '哪些设备能打开 deck，怎么添加新设备',
  log: 'deck 做过的每一次改动和发送',
}

export function Settings({ tab }: { tab: SettingsTab }) {
  return (
    <Page
      header={
        <PageHeader title="设置" subtitle={subtitles[tab]}>
          <Tabs value={tab} options={tabs} hrefOf={(id) => href({ name: 'settings', tab: id })} className="px-2 md:px-4" />
        </PageHeader>
      }
    >
      {tab === 'connections' && <Connections />}
      {tab === 'ai' && <AiSettings />}
      {tab === 'access' && <Access />}
      {tab === 'log' && <Log />}
    </Page>
  )
}

const platforms: { source: Source; name: string; cli: string; note: string }[] = [
  { source: 'dingtalk', name: '钉钉', cli: 'dws', note: '官方 Workspace CLI · 群消息实时监听' },
  { source: 'channel', name: 'channel', cli: 'drlee', note: '内部 channel CLI · 定时轮询' },
]

function Connections() {
  const { groups } = useDeck()
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {platforms.map((platform) => (
        <PlatformCard key={platform.source} {...platform} groups={groups.filter((g) => g.source === platform.source)} />
      ))}
      <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-stone-300 p-5 text-center text-stone-400 dark:border-stone-700">
        <span className="flex size-9 items-center justify-center rounded-lg bg-stone-100 dark:bg-stone-800">
          <Plus className="size-4" />
        </span>
        <p className="mt-2 font-medium text-stone-500">接入新平台</p>
        <p className="mt-1 text-fs12">以后：飞书、GitHub、Plane…</p>
      </div>
    </div>
  )
}

function PlatformCard({
  source,
  name,
  cli,
  note,
  groups,
}: {
  source: Source
  name: string
  cli: string
  note: string
  groups: GroupInfo[]
}) {
  const errors = groups.filter((g) => watchTone(g.watch) === 'error')
  const realtime = groups.some((g) => watchTone(g.watch) === 'realtime')
  const state = !groups.length ? 'idle' : errors.length ? 'error' : realtime ? 'realtime' : 'poll'
  const label = { idle: '未使用', error: '出错', realtime: '实时监听中', poll: '轮询中' }[state]

  return (
    <div className="flex flex-col rounded-xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
      <div className="flex items-start gap-3">
        <SourceBadge source={source} className="!size-9 !rounded-lg !text-fs15" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{name}</h3>
            <code className="rounded bg-stone-100 px-1.5 font-mono text-fs11 text-stone-500 dark:bg-stone-800">{cli}</code>
          </div>
          <p className="mt-0.5 text-fs12 text-stone-500">{note}</p>
        </div>
        <span
          className={clsx(
            'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-fs11 font-medium',
            state === 'error' && 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300',
            state === 'realtime' && 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
            state === 'poll' && 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
            state === 'idle' && 'bg-stone-100 text-stone-500 dark:bg-stone-800',
          )}
        >
          {label}
        </span>
      </div>

      <dl className="mt-4 space-y-2 border-t border-stone-100 pt-4 text-fs13 dark:border-stone-800">
        <Row label="监测的群">{groups.length} 个</Row>
        <Row label="账号">
          <Pending />
        </Row>
        <Row label="登录剩余">
          <Pending />
        </Row>
        <Row label="版本">
          <Pending />
        </Row>
      </dl>

      {groups.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {groups.map((group) => (
            <li key={group.id} className="flex items-center gap-2 text-fs12" title={watchLabel(group.watch)}>
              <StatusDot watch={group.watch} />
              <span className="min-w-0 flex-1 truncate text-stone-600 dark:text-stone-300">{group.name}</span>
              {group.watch.error && <span className="truncate text-red-600 dark:text-red-400">{group.watch.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-stone-500">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  )
}

function Pending() {
  return <span className="text-fs12 font-normal text-stone-400">后端未接</span>
}

function AiSettings() {
  const paused = useAiPaused()
  const { config } = useDeck()
  return (
    <div className="space-y-4">
      <div
        className={clsx(
          'flex flex-wrap items-center gap-4 rounded-xl border p-5',
          paused
            ? 'border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900'
            : 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/30 dark:bg-emerald-500/10',
        )}
      >
        <span
          className={clsx(
            'flex size-11 items-center justify-center rounded-xl',
            paused ? 'bg-stone-200 text-stone-500 dark:bg-stone-800' : 'bg-emerald-500 text-white',
          )}
        >
          <Power className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-fs15 font-semibold">{paused ? 'AI 已暂停' : 'AI 运行中'}</h3>
          <p className="mt-0.5 text-fs13 text-stone-500 dark:text-stone-400">
            总开关：暂停后，起草回复、自动修复、对外发消息等所有 AI 自动化都会停下，已有的草稿保留。
          </p>
        </div>
        <button
          onClick={() => setAiPaused(!paused)}
          className={clsx(
            'h-9 rounded-lg px-4 text-fs13 font-medium transition-colors',
            paused ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-red-600 text-white hover:bg-red-700',
          )}
        >
          {paused ? '恢复 AI' : '暂停所有 AI'}
        </button>
      </div>
      <p className="text-fs12 text-stone-400">开关目前只存在这个浏览器里，后端接上后会对所有入口（命令行、MCP、看板）生效。</p>

      <div className="grid gap-3 md:grid-cols-2">
        <ComingSoon title="模型" icon={<Sparkles className="size-4" />}>
          选用哪家的模型；起草回复、总结、修代码可以分别用不同的模型。
        </ComingSoon>
        <div className="rounded-xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300">
              <Bot className="size-4" />
            </span>
            <h3 className="font-semibold">助手身份</h3>
            <button disabled className="ml-auto text-fs12 text-stone-400" title="即将推出">
              编辑
            </button>
          </div>
          <p className="mt-3 text-fs13 text-stone-500 dark:text-stone-400">AI 对外发的每条消息开头都会加上：</p>
          <div className="mt-2 rounded-lg bg-stone-50 px-3 py-2 font-medium dark:bg-stone-800/60">
            {config?.ai_prefix || <span className="text-stone-400">（未设置）</span>}
          </div>
          <p className="mt-2 text-fs12 text-stone-400">现在改 ~/.deck/config.toml 里的 ai_prefix。</p>
        </div>
        <ComingSoon title="自动化规则" icon={<Workflow className="size-4" />}>
          哪些群让 AI 起草回复、哪些发送人可以触发自动修复、修复按 L0–L3 怎么分级。
        </ComingSoon>
        <ComingSoon title="预算与用量" icon={<Gauge className="size-4" />}>
          按项目设 token 上限，看每个项目、每个任务花了多少。
        </ComingSoon>
      </div>
    </div>
  )
}
