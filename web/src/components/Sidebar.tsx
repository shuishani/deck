import clsx from 'clsx'
import { FolderKanban, ListTodo, MessagesSquare, PanelLeftClose, PanelLeftOpen, ScrollText, Search, Settings } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTasks } from '../tasks'
import { href, type Route } from '../router'
import { localStore } from '../localStore'
import { useMediaQuery, type GroupInfo, useActions, useData } from '../state'
import { Logo } from './Logo'
import { ResizeHandle, usePaneWidth, type PaneSize } from './ResizeHandle'
import { CountBadge, watchTone } from './SourceBadge'

type Section = 'messages' | 'tasks' | 'projects' | 'log' | 'settings'

interface NavEntry {
  id: Section
  label: string
  icon: ReactNode
  href: string
  count?: number
  muted?: number
  hint?: string
  /** 只在手机底栏显示；桌面端由侧边栏底部的监听状态提示。 */
  dot?: boolean
}

const CONNECTIONS = href({ name: 'settings', tab: 'connections' })

export function sectionOf(route: Route): Section {
  return route.name === 'project' ? 'projects' : route.name
}

function useNav(): NavEntry[] {
  const { attention, groups } = useData()
  const tasks = useTasks()
  const open = tasks.filter((task) => task.status !== 'done').length
  const mentions = attention?.filter((m) => m.attention === 'mention').length ?? 0
  const hasError = groups.some((group) => watchTone(group.watch) === 'error')
  return [
    {
      id: 'messages',
      label: '消息',
      icon: <MessagesSquare className="size-4" />,
      href: href({ name: 'messages' }),
      count: mentions,
      hint: mentions ? `需回复 ${mentions} 条` : undefined,
    },
    {
      id: 'tasks',
      label: '任务',
      icon: <ListTodo className="size-4" />,
      href: href({ name: 'tasks' }),
      muted: open,
      hint: open ? `未完成 ${open} 项` : undefined,
    },
    { id: 'projects', label: '项目', icon: <FolderKanban className="size-4" />, href: href({ name: 'projects' }) },
    { id: 'log', label: '日志', icon: <ScrollText className="size-4" />, href: href({ name: 'log' }) },
    {
      id: 'settings',
      label: '设置',
      icon: <Settings className="size-4" />,
      href: CONNECTIONS,
      dot: hasError,
    },
  ]
}

// null 表示跟随窗口宽度：窄于 1024px 时自动收起。
const collapsedPref = localStore<boolean | null>('deck.sidebarCollapsed', () => null)
const SIDEBAR: PaneSize = { key: 'deck.sidebarWidth', initial: 240, min: 200, max: 360 }

export function Sidebar({ route }: { route: Route }) {
  const { groups } = useData()
  const { openSearch } = useActions()
  const items = useNav()
  const active = sectionOf(route)
  const narrow = useMediaQuery('(max-width: 1023px)')
  const collapsed = collapsedPref.use() ?? narrow
  const toggle = () => collapsedPref.set(!collapsed)
  const [width] = usePaneWidth(SIDEBAR)

  if (collapsed) return <Rail items={items} active={active} onExpand={toggle} />

  return (
    <aside
      style={{ width }}
      className="relative hidden shrink-0 flex-col border-r border-stone-200 bg-stone-100/70 md:flex dark:border-stone-800 dark:bg-stone-900/70"
    >
      <ResizeHandle size={SIDEBAR} label="调整侧边栏宽度" />
      <div className="flex h-14 items-center justify-between gap-2 px-4">
        <a href="#/messages" className="flex items-center gap-2">
          <Logo className="size-7" />
          <span className="text-fs15 font-semibold tracking-tight">deck</span>
        </a>
        <button
          onClick={toggle}
          className="rounded-md p-1 text-stone-400 hover:bg-white/70 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
          title="收起侧边栏"
          aria-label="收起侧边栏"
        >
          <PanelLeftClose className="size-4" />
        </button>
      </div>

      <div className="px-2 pb-3">
        <button
          onClick={openSearch}
          className="flex h-8 w-full items-center gap-2 rounded-lg border border-stone-200 bg-white px-2.5 text-fs13 text-stone-400 transition-colors hover:border-stone-300 dark:border-stone-700 dark:bg-stone-900 dark:hover:border-stone-600"
        >
          <Search className="size-3.5" />
          <span className="flex-1 text-left">搜索…</span>
          <kbd className="rounded border border-stone-200 px-1 font-sans text-fs10 text-stone-400 dark:border-stone-700">
            ⌘K
          </kbd>
        </button>
      </div>

      <nav className="space-y-0.5 px-2">
        {items.slice(0, 4).map((item) => (
          <NavItem key={item.id} item={item} active={active === item.id} />
        ))}
        <div className="mx-2.5 my-2 h-px bg-stone-200 dark:bg-stone-800" />
        <NavItem item={items[4]} active={active === 'settings'} />
      </nav>

      <div className="flex-1" />
      <WatchStatus groups={groups} />
    </aside>
  )
}

function Rail({ items, active, onExpand }: { items: NavEntry[]; active: Section; onExpand: () => void }) {
  const { groups } = useData()
  const { openSearch } = useActions()
  const errors = groups.filter((g) => watchTone(g.watch) === 'error').length
  const cell = 'relative flex size-10 items-center justify-center rounded-lg transition-colors'
  const idle = 'text-stone-500 hover:bg-white/60 dark:text-stone-400 dark:hover:bg-stone-800/60'
  const link = (item: NavEntry) => (
    <a
      key={item.id}
      href={item.href}
      title={item.hint ? `${item.label} · ${item.hint}` : item.label}
      aria-label={item.label}
      className={clsx(cell, active === item.id ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-800 dark:text-stone-50' : idle)}
    >
      {item.icon}
      {!!item.count && (
        <CountBadge count={item.count} className="absolute -top-0.5 -right-0.5 !h-4 !min-w-4 !px-1 !text-fs10" />
      )}
    </a>
  )
  return (
    <aside className="hidden w-14 shrink-0 flex-col items-center gap-1 border-r border-stone-200 bg-stone-100/70 pb-3 md:flex dark:border-stone-800 dark:bg-stone-900/70">
      <div className="flex h-14 items-center">
        <button
          onClick={onExpand}
          title="展开侧边栏"
          aria-label="展开侧边栏"
          className="group relative flex size-9 items-center justify-center rounded-lg text-stone-500 hover:bg-white/60 dark:text-stone-400 dark:hover:bg-stone-800/60"
        >
          <Logo className="size-7 group-hover:opacity-0" />
          <PanelLeftOpen className="absolute size-4 opacity-0 group-hover:opacity-100" />
        </button>
      </div>
      <button onClick={openSearch} title="搜索（⌘K）" aria-label="搜索" className={clsx(cell, idle)}>
        <Search className="size-4" />
      </button>
      {items.slice(0, 4).map(link)}
      <div className="my-1 h-px w-6 bg-stone-200 dark:bg-stone-800" />
      {link(items[4])}
      <div className="flex-1" />
      {groups.length > 0 && (
        <a
          href={CONNECTIONS}
          className={clsx('mb-1 size-2 rounded-full', errors ? 'bg-red-500' : 'bg-emerald-500')}
          title={errors ? `${errors} 个群监听异常，点击查看` : `监听正常 · ${groups.length} 个群`}
          aria-label={errors ? `${errors} 个群监听异常` : '监听正常'}
        />
      )}
    </aside>
  )
}

function NavItem({ item, active }: { item: NavEntry; active: boolean }) {
  return (
    <a
      href={item.href}
      title={item.hint}
      className={clsx(
        'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 transition-colors',
        active
          ? 'bg-white font-medium text-stone-900 shadow-sm dark:bg-stone-800 dark:text-stone-50'
          : 'text-stone-600 hover:bg-white/60 dark:text-stone-400 dark:hover:bg-stone-800/60',
      )}
    >
      <span className="text-stone-500 dark:text-stone-400">{item.icon}</span>
      <span className="flex-1">{item.label}</span>
      {!!item.count && <CountBadge count={item.count} />}
      {!item.count && !!item.muted && <span className="text-fs12 text-stone-400 tabular-nums">{item.muted}</span>}
    </a>
  )
}

/** 平时一行灰字；有群监听异常时变红，点进「设置 → 连接」。 */
function WatchStatus({ groups }: { groups: GroupInfo[] }) {
  if (!groups.length) return null
  const failing = groups.filter((g) => watchTone(g.watch) === 'error')
  const paused = groups.filter((g) => watchTone(g.watch) === 'paused').length
  const watching = groups.length - paused
  return (
    <div className="border-t border-stone-200 px-2 py-2 text-fs12 dark:border-stone-800">
      <a
        href={CONNECTIONS}
        title={failing.length ? failing.map((g) => `${g.name}：${g.watch.error}`).join('\n') : '查看连接状态'}
        className={clsx(
          'flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-white/60 dark:hover:bg-stone-800/60',
          failing.length ? 'font-medium text-red-600 dark:text-red-400' : 'text-stone-500 dark:text-stone-400',
        )}
      >
        <span
          className={clsx(
            'size-1.5 shrink-0 rounded-full',
            failing.length ? 'bg-red-500' : watching ? 'bg-emerald-500' : 'border border-stone-400',
          )}
        />
        {failing.length
          ? `${failing.length} 个群监听异常`
          : watching
            ? `监听正常 · ${watching} 个群${paused ? `，${paused} 个已暂停` : ''}`
            : '监听已全部暂停'}
      </a>
    </div>
  )
}

export function MobileTabs({ route }: { route: Route }) {
  // 手机底栏只有 4 格：日志收在设置里，打开日志时高亮设置。
  const items = useNav().filter((item) => item.id !== 'log')
  const section = sectionOf(route)
  const active = section === 'log' ? 'settings' : section
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-stone-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden dark:border-stone-800 dark:bg-stone-900/95">
      {items.map((item) => (
        <a
          key={item.id}
          href={item.href}
          className={clsx(
            'relative flex flex-col items-center gap-1 pt-2 pb-1.5 text-fs11 [&_svg]:size-6',
            active === item.id ? 'font-medium text-accent-600 dark:text-accent-500' : 'text-stone-500',
          )}
        >
          {item.icon}
          {item.label}
          {!!item.count && (
            <CountBadge
              count={item.count}
              className="absolute top-1 left-[calc(50%+6px)] !h-[18px] !min-w-[18px] !px-1 !text-fs10"
            />
          )}
          {item.dot && <span className="absolute top-1.5 left-[calc(50%+8px)] size-2 rounded-full bg-red-500" />}
        </a>
      ))}
    </nav>
  )
}
