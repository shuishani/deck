import clsx from 'clsx'
import { ChevronDown, FolderKanban, Inbox, ListTodo, MessagesSquare, Search, Settings } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTasks } from '../mock/tasks'
import { href, type Route } from '../router'
import { useDeck, type GroupInfo } from '../state'
import { Logo } from './Logo'
import { AiPill } from './PageHeader'
import { CountBadge, SourceBadge, StatusDot, watchLabel, watchTone } from './SourceBadge'

type Section = 'inbox' | 'messages' | 'tasks' | 'projects' | 'settings'

interface NavEntry {
  id: Section
  label: string
  icon: ReactNode
  href: string
  count?: number
  muted?: number
  dot?: boolean
}

export function sectionOf(route: Route): Section {
  return route.name === 'project' ? 'projects' : route.name
}

function useNav(): NavEntry[] {
  const { awaiting, groups } = useDeck()
  const tasks = useTasks()
  const open = tasks.filter((task) => task.status !== 'done').length
  const hasError = groups.some((group) => watchTone(group.watch) === 'error')
  return [
    { id: 'inbox', label: '收件箱', icon: <Inbox className="size-4" />, href: href({ name: 'inbox' }), count: awaiting?.length ?? 0 },
    { id: 'messages', label: '消息', icon: <MessagesSquare className="size-4" />, href: href({ name: 'messages' }) },
    { id: 'tasks', label: '任务', icon: <ListTodo className="size-4" />, href: href({ name: 'tasks' }), muted: open },
    { id: 'projects', label: '项目', icon: <FolderKanban className="size-4" />, href: href({ name: 'projects' }) },
    {
      id: 'settings',
      label: '设置',
      icon: <Settings className="size-4" />,
      href: href({ name: 'settings', tab: 'connections' }),
      dot: hasError,
    },
  ]
}

export function Sidebar({ route }: { route: Route }) {
  const { openSearch, groups } = useDeck()
  const items = useNav()
  const active = sectionOf(route)

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-stone-200 bg-stone-100/70 md:flex dark:border-stone-800 dark:bg-stone-900/70">
      <div className="flex h-14 items-center justify-between gap-2 px-4">
        <a href="#/inbox" className="flex items-center gap-2">
          <Logo className="size-7" />
          <span className="text-fs15 font-semibold tracking-tight">deck</span>
        </a>
        <AiPill />
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
      <WatchSummary groups={groups} />
    </aside>
  )
}

function NavItem({ item, active }: { item: NavEntry; active: boolean }) {
  return (
    <a
      href={item.href}
      className={clsx(
        'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 transition-colors',
        active
          ? 'bg-white font-medium text-stone-900 shadow-sm dark:bg-stone-800 dark:text-stone-50'
          : 'text-stone-600 hover:bg-white/60 dark:text-stone-400 dark:hover:bg-stone-800/60',
      )}
    >
      <span className="text-stone-500 dark:text-stone-400">{item.icon}</span>
      <span className="flex-1">{item.label}</span>
      {item.dot && <span className="size-2 rounded-full bg-red-500" title="有连接出错" />}
      {!!item.count && <CountBadge count={item.count} />}
      {!item.count && !!item.muted && <span className="text-fs12 text-stone-400 tabular-nums">{item.muted}</span>}
    </a>
  )
}

function WatchSummary({ groups }: { groups: GroupInfo[] }) {
  const [open, setOpen] = useState(false)
  if (!groups.length) return null
  const count = (tone: string) => groups.filter((g) => watchTone(g.watch) === tone).length
  const realtime = count('realtime')
  const poll = count('poll')
  const errors = count('error')
  return (
    <div className="border-t border-stone-200 px-2 py-2 text-fs12 dark:border-stone-800">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-stone-600 hover:bg-white/60 dark:text-stone-400 dark:hover:bg-stone-800/60"
      >
        <span className="font-medium text-stone-500">监听</span>
        <span className="flex flex-1 flex-wrap gap-x-2.5">
          {realtime > 0 && <Legend tone="bg-emerald-500" label={`实时 ${realtime}`} />}
          {poll > 0 && <Legend tone="bg-amber-400" label={`轮询 ${poll}`} />}
          {errors > 0 && <Legend tone="bg-red-500" label={`出错 ${errors}`} />}
        </span>
        <ChevronDown className={clsx('size-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5 px-1">
          {groups.map((group) => (
            <li key={group.id}>
              <a
                href={href({ name: 'messages', group: group.id })}
                title={watchLabel(group.watch)}
                className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-white/60 dark:hover:bg-stone-800/60"
              >
                <StatusDot watch={group.watch} />
                <SourceBadge source={group.source} className="!size-4 !text-fs9" />
                <span className="min-w-0 flex-1 truncate text-stone-600 dark:text-stone-300">{group.name}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Legend({ tone, label }: { tone: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={clsx('size-1.5 rounded-full', tone)} />
      {label}
    </span>
  )
}

export function MobileTabs({ route }: { route: Route }) {
  const items = useNav()
  const active = sectionOf(route)
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-stone-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden dark:border-stone-800 dark:bg-stone-900/95">
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
