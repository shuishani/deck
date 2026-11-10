import clsx from 'clsx'
import { Bot, CheckCheck, ChevronLeft, Clock, GitPullRequest, ListPlus, MessageSquareReply, MessagesSquare, Rocket } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { AwaitingMessage } from '../api'
import { Avatar } from '../components/Avatar'
import { EmptyState, MessageSkeleton } from '../components/Feedback'
import { PageHeader } from '../components/PageHeader'
import { SourceBadge, sourceName } from '../components/SourceBadge'
import { KindTag, ProjectTag } from '../components/Tags'
import { Button, Chips } from '../components/ui'
import { fullTime, shortTime, waiting } from '../format'
import { href } from '../router'
import { taskSource, taskTitle, useDeck } from '../state'

type Kind = 'all' | 'reply' | 'draft' | 'fix' | 'deploy'

const upcoming: Record<Exclude<Kind, 'all' | 'reply'>, { title: string; hint: string; icon: ReactNode }> = {
  draft: {
    title: 'AI 草稿即将推出',
    hint: 'AI 替你起草的群回复会放在这里，你改一改、确认后再发出去。',
    icon: <Bot className="size-5" />,
  },
  fix: {
    title: 'AI 修复即将推出',
    hint: 'AI 根据群里的 bug 反馈改好的代码会放在这里，附上改动和测试结果，等你批准或打回。',
    icon: <GitPullRequest className="size-5" />,
  },
  deploy: {
    title: '待部署即将推出',
    hint: '审过的修复要上测试或正式环境时，会在这里等你点头。',
    icon: <Rocket className="size-5" />,
  },
}

export function Inbox() {
  const { awaiting, groups, config } = useDeck()
  const [kind, setKind] = useState<Kind>('all')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const items = awaiting ?? []
  const overdue = items.filter((m) => m.overdue).length
  const selected = items.find((m) => m.id === selectedId) ?? null

  const options: { id: Kind; label: string; count?: number }[] = [
    { id: 'all', label: '全部', count: items.length },
    { id: 'reply', label: '待我回复', count: items.length },
    { id: 'draft', label: 'AI 草稿' },
    { id: 'fix', label: 'AI 修复' },
    { id: 'deploy', label: '待部署' },
  ]
  const showReplies = kind === 'all' || kind === 'reply'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={selected ? 'max-md:hidden' : undefined}>
        <PageHeader
          title="收件箱"
          subtitle={
            awaiting
              ? items.length
                ? `${items.length} 件等你处理${overdue ? ` · ${overdue} 件超过 ${config?.reply_reminder_hours ?? 2} 小时` : ''}`
                : '没有等你处理的事'
              : undefined
          }
        >
          <div className="px-4 pb-3 md:px-6">
            <Chips value={kind} options={options} onChange={setKind} />
          </div>
        </PageHeader>
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          className={clsx(
            'scroll-thin min-h-0 w-full overflow-y-auto border-stone-200 md:w-[400px] md:shrink-0 md:border-r dark:border-stone-800',
            selected && 'max-md:hidden',
          )}
        >
          {!showReplies ? (
            <div className="p-4">
              <EmptyState {...upcoming[kind as keyof typeof upcoming]} />
            </div>
          ) : !awaiting ? (
            <div className="p-4">
              <MessageSkeleton rows={4} />
            </div>
          ) : items.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={<CheckCheck className="size-5" />}
                title="都处理完了"
                hint="有人在群里 @你 而你还没回时，会出现在这里；以后 AI 的草稿和修复也会放进来。"
              />
            </div>
          ) : (
            <ul className="divide-y divide-stone-100 dark:divide-stone-800/80">
              {items.map((message) => (
                <li key={message.id}>
                  <InboxRow
                    message={message}
                    active={message.id === selected?.id}
                    projectName={groups.find((g) => g.id === message.group_id)?.projectName ?? null}
                    onClick={() => setSelectedId(message.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={clsx('min-h-0 min-w-0 flex-1', !selected && 'max-md:hidden')}>
          {selected ? (
            <Detail message={selected} onBack={() => setSelectedId(null)} />
          ) : (
            <div className="hidden h-full items-center justify-center md:flex">
              <p className="text-fs13 text-stone-400">{showReplies && items.length ? '选一条查看详情' : ''}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function InboxRow({
  message,
  active,
  projectName,
  onClick,
}: {
  message: AwaitingMessage
  active: boolean
  projectName: string | null
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'relative flex w-full gap-3 px-4 py-3 text-left transition-colors',
        active ? 'bg-accent-50 dark:bg-accent-500/10' : 'hover:bg-white dark:hover:bg-stone-900',
      )}
    >
      {message.overdue && <span className="absolute top-3 bottom-3 left-0 w-[3px] rounded-r-full bg-red-500" />}
      <Avatar name={message.sender_name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium">{message.sender_name}</span>
          <span className="rounded bg-amber-50 px-1.5 text-fs11 leading-[18px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
            待我回复
          </span>
          <span
            className={clsx(
              'ml-auto shrink-0 text-fs11 tabular-nums',
              message.overdue ? 'font-medium text-red-600 dark:text-red-400' : 'text-stone-400',
            )}
          >
            {waiting(message.waiting_minutes)}
          </span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-fs13 leading-[1.5] text-stone-600 dark:text-stone-300">
          {message.text.replace(/\s+/g, ' ') || '（无文本内容）'}
        </p>
        <div className="mt-1.5 flex items-center gap-1.5 text-fs12 text-stone-400">
          <SourceBadge source={message.source} className="!size-4 !text-fs9" />
          <span className="truncate">{message.group_name}</span>
          {projectName && <ProjectTag name={projectName} />}
        </div>
      </div>
    </button>
  )
}

function Detail({ message, onBack }: { message: AwaitingMessage; onBack: () => void }) {
  const { openSend, openTask, groups } = useDeck()
  const group = groups.find((g) => g.id === message.group_id)
  return (
    <div className="flex h-full flex-col bg-white dark:bg-stone-950">
      <div className="flex min-h-14 shrink-0 items-center gap-2 border-b border-stone-200 px-3 md:hidden dark:border-stone-800">
        <button onClick={onBack} className="inline-flex items-center gap-0.5 rounded-md p-1 text-stone-500">
          <ChevronLeft className="size-5" />
          收件箱
        </button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-5 py-6 md:px-8">
          <div className="flex flex-wrap items-center gap-2 text-fs12 text-stone-500">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-stone-100 px-2 py-0.5 font-medium text-stone-700 dark:bg-stone-800 dark:text-stone-200">
              <SourceBadge source={message.source} className="!size-4 !text-fs9" />
              {message.group_name}
            </span>
            <KindTag name={message.group_name} />
            {group?.projectName && <ProjectTag name={group.projectName} />}
            <span>{sourceName(message.source)}</span>
          </div>

          <div className="mt-5 flex items-center gap-3">
            <Avatar name={message.sender_name} />
            <div>
              <div className="font-semibold">{message.sender_name}</div>
              <div className="text-fs12 text-stone-400" title={fullTime(message.sent_at)}>
                {shortTime(message.sent_at)} 在群里 @了你
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50/60 px-4 py-3.5 leading-[1.7] break-words whitespace-pre-wrap dark:border-stone-800 dark:bg-stone-900">
            {message.text || '（无文本内容）'}
          </div>

          <div
            className={clsx(
              'mt-4 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-fs13 font-medium',
              message.overdue
                ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300'
                : 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300',
            )}
          >
            <Clock className="size-3.5" />
            已等待 {waiting(message.waiting_minutes)}
            {message.overdue && ' · 超时'}
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <Button
              variant="primary"
              onClick={() =>
                openSend({ group: message.group_id, groupName: message.group_name, source: message.source, replyTo: message })
              }
            >
              <MessageSquareReply className="size-3.5" />
              回复
            </Button>
            <Button
              onClick={() =>
                openTask({ title: taskTitle(message.text), project: group?.project ?? null, source: taskSource(message) })
              }
            >
              <ListPlus className="size-3.5" />
              转任务
            </Button>
            <a href={href({ name: 'messages', group: message.group_id })}>
              <Button variant="ghost">
                <MessagesSquare className="size-3.5" />
                在会话中查看
              </Button>
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
