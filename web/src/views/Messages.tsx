import clsx from 'clsx'
import { Check, MessagesSquare, Search, Sparkles } from 'lucide-react'
import { useState, type CSSProperties, type ReactNode } from 'react'
import { api, type AttentionMessage, type AttentionReason } from '../api'
import { Avatar } from '../components/Avatar'
import { Conversation } from '../components/Conversation'
import { EmptyState } from '../components/Feedback'
import { GroupFilterBar, NO_FILTER, filterGroups, type GroupFilter } from '../components/GroupFilter'
import { iconButton, SyncButton } from '../components/PageHeader'
import { ResizeHandle, usePaneWidth, type PaneSize } from '../components/ResizeHandle'
import { CountBadge, SourceBadge } from '../components/SourceBadge'
import { KindTag } from '../components/Tags'
import { useToast } from '../components/Toast'
import { fullTime, listTime, relative } from '../format'
import { navigate } from '../router'
import { useDesktop, type GroupInfo, useActions, useData } from '../state'

const LIST: PaneSize = { key: 'deck.messageListWidth', initial: 320, min: 260, max: 560 }
type Mode = 'groups' | AttentionReason

export function Messages({ group, anchor }: { group?: number; anchor?: number }) {
  const { openSearch, openAskAi } = useActions()
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MessagesPane
        selected={group}
        anchor={anchor}
        onSelect={(id) => navigate({ name: 'messages', group: id })}
        toolbar={
          <div className="flex h-12 items-center gap-1 px-3 max-md:h-14 max-md:px-4">
            <h1 className="flex-1 text-fs16 font-semibold tracking-tight max-md:text-fs18">消息</h1>
            <button onClick={openSearch} className={clsx(iconButton, 'md:hidden')} aria-label="搜索">
              <Search className="size-4" />
            </button>
            <button onClick={openAskAi} className={iconButton} title="问 AI" aria-label="问 AI">
              <Sparkles className="size-4" />
            </button>
            <SyncButton icon />
          </div>
        }
      />
    </div>
  )
}

export function MessagesPane({
  selected,
  anchor,
  onSelect,
  project,
  toolbar,
}: {
  selected?: number
  /** 从搜索或 AI 引用跳来时要定位的消息 */
  anchor?: number
  onSelect: (group: number | undefined) => void
  project?: string
  toolbar?: ReactNode
}) {
  const { groups, overview, attention } = useData()
  const desktop = useDesktop()
  const [listWidth] = usePaneWidth(LIST)
  const [mode, setMode] = useState<Mode>('groups')
  const [focus, setFocus] = useState<number | undefined>()
  const [filter, setFilter] = useState<GroupFilter>(NO_FILTER)

  const projectPool = project ? groups.filter((g) => g.project === project) : groups
  const projectName = (key: string) => overview?.find((p) => p.key === key)?.name ?? key
  // 待处理列表只按平台筛；群列表三项都用。
  const pool = filterGroups(projectPool, filter, projectName, ['source'])
  const inProject = new Set(projectPool.map((g) => g.id))
  const ids = new Set(pool.map((g) => g.id))
  const items = (attention ?? []).filter((m) => ids.has(m.group_id))
  const counts = {
    mention: items.filter((m) => m.attention === 'mention').length,
    issue: items.filter((m) => m.attention === 'issue').length,
  }
  const listed = mode === 'groups' ? [] : items.filter((m) => m.attention === mode)

  const shown = filterGroups(projectPool, filter, projectName).sort((a, b) =>
    (b.last_message?.sent_at ?? '').localeCompare(a.last_message?.sent_at ?? ''),
  )

  const fallback = mode === 'groups' ? shown[0]?.id : listed[0]?.group_id
  const effective = selected ?? (desktop ? fallback : undefined)
  const active = projectPool.find((g) => g.id === effective)

  return (
    <div className="flex min-h-0 flex-1">
      <aside
        style={{ '--pane-w': `${listWidth}px` } as CSSProperties}
        className={clsx(
          'relative flex w-full shrink-0 flex-col border-r border-stone-200 bg-white md:w-(--pane-w) dark:border-stone-800 dark:bg-stone-900',
          active && 'max-md:hidden',
        )}
      >
        <ResizeHandle size={LIST} label="调整消息列表宽度" />
        {toolbar}
        <div className={clsx('space-y-2 border-b border-stone-100 px-3 pb-2.5 max-md:space-y-2.5 max-md:px-4 max-md:pb-3 dark:border-stone-800', !toolbar && 'pt-3')}>
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-stone-100 p-1 dark:bg-stone-800/70" role="tablist">
            {(
              [
                ['groups', '群', 0],
                ['mention', '需回复', counts.mention],
                ['issue', '疑似问题', counts.issue],
              ] as const
            ).map(([id, label, count]) => (
              <button
                key={id}
                role="tab"
                aria-selected={mode === id}
                onClick={() => setMode(id)}
                className={clsx(
                  'inline-flex items-center justify-center gap-1 rounded-md py-1 text-fs12 font-medium transition-colors max-md:h-8 max-md:py-0',
                  mode === id
                    ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-900 dark:text-stone-100'
                    : 'text-stone-500 hover:text-stone-700 dark:hover:text-stone-300',
                )}
              >
                {label}
                {count > 0 && (
                  <span
                    className={clsx(
                      'tabular-nums',
                      id === 'mention' ? 'text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-400',
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            ))}
          </div>
          <GroupFilterBar
            groups={projectPool}
            value={filter}
            onChange={setFilter}
            projects={project ? [] : (overview ?? []).map((p) => ({ key: p.key, name: p.name }))}
            fields={mode === 'groups' ? undefined : ['source']}
            counts={
              mode === 'groups'
                ? undefined
                : (source) => (attention ?? []).filter((m) => m.attention === mode && inProject.has(m.group_id) && (source === 'all' || m.source === source)).length
            }
          />
        </div>
        <ul className="scroll-thin min-h-0 flex-1 overflow-y-auto p-1.5">
          {mode === 'groups' ? (
            <>
              {shown.length === 0 && (
                <li className="p-3">
                  <EmptyState
                    icon={<MessagesSquare className="size-5" />}
                    title={projectPool.length ? '没有匹配的群' : '暂无监测的群'}
                    hint={projectPool.length ? undefined : '请在项目的「设置」中添加群。'}
                  />
                </li>
              )}
              {shown.map((group) => (
                <li key={group.id}>
                  <GroupRow
                    group={group}
                    active={group.id === effective}
                    onClick={() => {
                      setFocus(undefined)
                      onSelect(group.id)
                    }}
                  />
                </li>
              ))}
            </>
          ) : (
            <>
              {listed.length === 0 && (
                <li className="p-3">
                  <EmptyState
                    icon={<Check className="size-5" />}
                    title={mode === 'mention' ? '暂无需回复的消息' : '暂无疑似问题'}
                    hint={
                      mode === 'mention'
                        ? '@我 或回复我的消息会显示在此，回复或标记已处理后移除。'
                        : '最近 3 天内疑似反馈问题的消息会显示在此，标记已处理后移除。'
                    }
                  />
                </li>
              )}
              {listed.map((message) => (
                <li key={message.id}>
                  <AttentionRow
                    message={message}
                    active={message.id === focus}
                    onClick={() => {
                      setFocus(message.id)
                      onSelect(message.group_id)
                    }}
                  />
                </li>
              ))}
            </>
          )}
        </ul>
      </aside>
      {active ? (
        <Conversation key={active.id} group={active} focus={anchor ?? focus} anchored={anchor !== undefined} onBack={() => onSelect(undefined)} />
      ) : (
        <div className="hidden flex-1 items-center justify-center md:flex">
          <p className="text-fs13 text-stone-400">选择一个群查看消息</p>
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
        'flex w-full items-start gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors max-md:py-3',
        active ? 'bg-accent-50 dark:bg-accent-500/10' : 'hover:bg-stone-50 dark:hover:bg-stone-800/60',
      )}
    >
      <SourceBadge source={group.source} className="!mt-0.5 !size-8 !rounded-lg !text-fs13 max-md:!size-10 max-md:!rounded-xl" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={clsx('min-w-0 truncate', group.unread_count ? 'font-semibold' : 'font-medium')} title={group.name}>
            {group.name}
          </span>
          <span className="ml-auto shrink-0 pl-1 text-fs11 text-stone-400 tabular-nums" title={last ? fullTime(last.sent_at) : undefined}>
            {last ? listTime(last.sent_at) : ''}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <KindTag kind={group.kind} />
          <p className="min-w-0 flex-1 truncate text-fs12 text-stone-500 dark:text-stone-400">
            {last ? `${last.is_me ? '我' : last.sender_name}：${last.text || '（无文本内容）'}` : '暂无消息'}
          </p>
          <CountBadge count={group.awaiting_count} />
          {group.unread_count > 0 && (
            <span
              className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-stone-200 px-1.5 text-fs11 leading-none font-semibold text-stone-700 tabular-nums dark:bg-stone-700 dark:text-stone-200"
              title="未读"
            >
              {group.unread_count > 99 ? '99+' : group.unread_count}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

const labels = { image: '[图片]', voice: '[语音]', video: '[视频]', file: '[文件]' } as const

function AttentionRow({ message, active, onClick }: { message: AttentionMessage; active: boolean; onClick: () => void }) {
  const { bump } = useActions()
  const toast = useToast()
  const summary = [message.text, ...message.attachments.map((a) => labels[a.kind] + (a.transcript ? ` ${a.transcript}` : ''))]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')

  async function done() {
    try {
      await api.setHandled(message.id, true)
      toast('已标记为已处理')
      bump()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  return (
    <div
      className={clsx(
        'group relative flex gap-2 rounded-lg px-2.5 py-2.5 transition-colors',
        active ? 'bg-accent-50 dark:bg-accent-500/10' : 'hover:bg-stone-50 dark:hover:bg-stone-800/60',
      )}
    >
      <button onClick={onClick} className="flex min-w-0 flex-1 gap-3 text-left">
        <Avatar name={message.sender_name} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-medium">{message.sender_name}</span>
            {message.overdue && (
              <span className="shrink-0 rounded bg-red-50 px-1 text-fs11 leading-[18px] font-medium text-red-600 dark:bg-red-500/15 dark:text-red-300">
                已超时
              </span>
            )}
            <span className="ml-auto shrink-0 text-fs11 text-stone-400 tabular-nums">{relative(message.sent_at)}</span>
          </span>
          <span className="mt-0.5 line-clamp-2 text-fs13 leading-[1.5] text-stone-600 dark:text-stone-300">
            {summary || '（无文本内容）'}
          </span>
          <span className="mt-1 flex items-center gap-1.5 text-fs12 text-stone-400">
            <SourceBadge source={message.source} className="!size-4 !text-fs9" />
            <span className="truncate">{message.group_name}</span>
          </span>
        </span>
      </button>
      <button
        onClick={done}
        className="self-center rounded-md p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 max-md:-mr-1 max-md:size-10 max-md:p-0 max-md:[&>svg]:mx-auto max-md:[&>svg]:size-5 md:opacity-0 md:group-hover:opacity-100 dark:hover:bg-stone-800 dark:hover:text-stone-200"
        title="标记已处理"
        aria-label="标记已处理"
      >
        <Check className="size-4" />
      </button>
    </div>
  )
}
