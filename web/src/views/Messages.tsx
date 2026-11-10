import clsx from 'clsx'
import { MessagesSquare, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Conversation } from '../components/Conversation'
import { EmptyState } from '../components/Feedback'
import { PageHeader } from '../components/PageHeader'
import { CountBadge, SourceBadge } from '../components/SourceBadge'
import { KindTag } from '../components/Tags'
import { Chips } from '../components/ui'
import { relative } from '../format'
import { navigate } from '../router'
import { useDeck, useDesktop, type GroupInfo } from '../state'

const UNASSIGNED = '__none__'

export function Messages({ group }: { group?: number }) {
  const { groups } = useDeck()
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={group ? 'max-md:hidden' : undefined}>
        <PageHeader title="消息" subtitle={`${groups.length} 个群 · 按最近活跃排序`} />
      </div>
      <MessagesPane selected={group} onSelect={(id) => navigate({ name: 'messages', group: id })} />
    </div>
  )
}

export function MessagesPane({
  selected,
  onSelect,
  project,
}: {
  selected?: number
  onSelect: (group: number | undefined) => void
  project?: string
}) {
  const { groups, overview } = useDeck()
  const desktop = useDesktop()
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<string>('all')

  const pool = project ? groups.filter((g) => g.project === project) : groups
  const hasUnassigned = pool.some((g) => !g.project)
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return pool
      .filter((g) => scope === 'all' || (scope === UNASSIGNED ? !g.project : g.project === scope))
      .filter((g) => !q || g.name.toLowerCase().includes(q))
      .sort((a, b) => (b.last_message?.sent_at ?? '').localeCompare(a.last_message?.sent_at ?? ''))
  }, [pool, scope, query])

  const effective = selected ?? (desktop ? shown[0]?.id : undefined)
  const active = pool.find((g) => g.id === effective)

  const scopes = [
    { id: 'all', label: '全部' },
    ...(project ? [] : (overview ?? []).map((p) => ({ id: p.key, label: p.name }))),
    ...(hasUnassigned ? [{ id: UNASSIGNED, label: '未归类' }] : []),
  ]

  return (
    <div className="flex min-h-0 flex-1">
      <aside
        className={clsx(
          'flex w-full shrink-0 flex-col border-r border-stone-200 bg-white md:w-80 dark:border-stone-800 dark:bg-stone-900',
          active && 'max-md:hidden',
        )}
      >
        <div className="space-y-2.5 border-b border-stone-100 p-3 dark:border-stone-800">
          <label className="flex h-8 items-center gap-2 rounded-lg bg-stone-100 px-2.5 dark:bg-stone-800">
            <Search className="size-3.5 text-stone-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜群名"
              className="min-w-0 flex-1 bg-transparent text-fs13 outline-none placeholder:text-stone-400"
            />
          </label>
          {scopes.length > 1 && <Chips value={scope} options={scopes} onChange={setScope} />}
        </div>
        <ul className="scroll-thin min-h-0 flex-1 overflow-y-auto p-1.5">
          {shown.length === 0 && (
            <li className="p-3">
              <EmptyState
                icon={<MessagesSquare className="size-5" />}
                title={pool.length ? '没有匹配的群' : '还没有监测的群'}
                hint={pool.length ? undefined : '去项目的「设置」里添加群。'}
              />
            </li>
          )}
          {shown.map((group) => (
            <li key={group.id}>
              <GroupRow group={group} active={group.id === effective} onClick={() => onSelect(group.id)} />
            </li>
          ))}
        </ul>
      </aside>
      {active ? (
        <Conversation group={active} onBack={() => onSelect(undefined)} />
      ) : (
        <div className="hidden flex-1 items-center justify-center md:flex">
          <p className="text-fs13 text-stone-400">选一个群开始</p>
        </div>
      )}
    </div>
  )
}

function GroupRow({ group, active, onClick }: { group: GroupInfo; active: boolean; onClick: () => void }) {
  const last = group.last_message
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex w-full items-start gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors',
        active ? 'bg-accent-50 dark:bg-accent-500/10' : 'hover:bg-stone-50 dark:hover:bg-stone-800/60',
      )}
    >
      <SourceBadge source={group.source} className="!mt-0.5 !size-8 !rounded-lg !text-fs13" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium">{group.name}</span>
          <KindTag name={group.name} />
          <span className="ml-auto shrink-0 text-fs11 text-stone-400 tabular-nums">
            {last ? relative(last.sent_at) : ''}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-fs12 text-stone-500 dark:text-stone-400">
            {last ? `${last.is_me ? '我' : last.sender_name}：${last.text.replace(/\s+/g, ' ') || '（无文本）'}` : '还没有消息'}
          </p>
          <CountBadge count={group.awaiting_count} />
        </div>
      </div>
    </button>
  )
}
