import clsx from 'clsx'
import { CornerUpLeft, ListPlus, MessageSquareReply } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import type { Message } from '../api'
import { clock, fullTime } from '../format'
import { Avatar } from './Avatar'
import { SourceBadge } from './SourceBadge'

export function MessageItem({
  message,
  showGroup,
  compact,
  onReply,
  onTask,
}: {
  message: Message
  showGroup?: boolean
  compact?: boolean
  onReply?: (message: Message) => void
  onTask?: (message: Message) => void
}) {
  const [armed, setArmed] = useState(false)
  return (
    <article
      onClick={(event) => {
        if (!(event.target as HTMLElement).closest('button, a')) setArmed((value) => !value)
      }}
      onMouseLeave={() => setArmed(false)}
      className={clsx(
        'group relative flex gap-3 rounded-xl px-3 transition-colors',
        compact ? 'py-1' : 'py-2.5',
        message.is_me
          ? 'bg-stone-100/60 dark:bg-stone-900/70'
          : 'hover:bg-white dark:hover:bg-stone-900/60',
        message.awaiting && 'pl-4',
      )}
    >
      {message.awaiting && (
        <span className="absolute top-2.5 bottom-2.5 left-0 w-[3px] rounded-full bg-red-500" aria-hidden />
      )}
      {compact ? (
        <time
          className="w-8 shrink-0 pt-0.5 text-right text-fs11 text-stone-400 tabular-nums opacity-0 transition-opacity group-hover:opacity-100"
          title={fullTime(message.sent_at)}
        >
          {clock(message.sent_at)}
        </time>
      ) : (
        <Avatar name={message.sender_name} me={message.is_me} />
      )}
      <div className="min-w-0 flex-1">
        {!compact && (
          <header className="flex flex-wrap items-center gap-x-2 gap-y-1 leading-5">
            <span className="font-semibold">{message.sender_name || '未知'}</span>
            {message.is_me && (
              <span className="rounded px-1.5 text-fs11 leading-[18px] font-medium text-stone-600 ring-1 ring-stone-300 ring-inset dark:text-stone-300 dark:ring-stone-600">我</span>
            )}
            <time className="text-fs12 text-stone-400 tabular-nums" title={fullTime(message.sent_at)}>
              {clock(message.sent_at)}
            </time>
            {showGroup && (
              <span className="inline-flex max-w-[16rem] items-center gap-1 rounded-md bg-stone-100 py-0.5 pr-1.5 pl-0.5 text-fs12 text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                <SourceBadge source={message.source} className="!size-4 !text-fs9" />
                <span className="truncate">{message.group_name}</span>
              </span>
            )}
            {message.reply_to && (
              <span className="inline-flex items-center gap-1 text-fs12 text-stone-400">
                <CornerUpLeft className="size-3" />
                回复
              </span>
            )}
            {message.awaiting && (
              <span className="rounded bg-red-50 px-1.5 text-fs11 leading-[18px] font-medium text-red-600 dark:bg-red-500/15 dark:text-red-300">
                待回复
              </span>
            )}
          </header>
        )}
        <MessageText text={message.text} />
      </div>
      {(onReply || onTask) && (
        <div
          className={clsx(
            'absolute right-2 z-[1] flex overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm transition-opacity focus-within:opacity-100 md:group-hover:opacity-100 dark:border-stone-700 dark:bg-stone-900',
            armed ? 'opacity-100' : 'pointer-events-none opacity-0 md:pointer-events-auto',
            compact ? '-top-3' : 'top-1.5',
          )}
        >
          {onReply && (
            <button
              onClick={() => onReply(message)}
              title="回复"
              className="inline-flex items-center gap-1 px-2 py-1 text-fs12 font-medium text-stone-600 hover:bg-stone-50 dark:text-stone-300 dark:hover:bg-stone-800"
            >
              <MessageSquareReply className="size-3.5" />
              回复
            </button>
          )}
          {onTask && (
            <button
              onClick={() => onTask(message)}
              title="转成任务"
              className="inline-flex items-center gap-1 border-l border-stone-200 px-2 py-1 text-fs12 font-medium text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
            >
              <ListPlus className="size-3.5" />
              转任务
            </button>
          )}
        </div>
      )}
    </article>
  )
}

function MessageText({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (el && !expanded) setOverflowing(el.scrollHeight > el.clientHeight + 2)
  }, [text, expanded])

  if (!text.trim()) return <p className="mt-0.5 text-stone-400 italic">（无文本内容）</p>
  return (
    <div className="mt-0.5">
      <p
        ref={ref}
        className={clsx(
          'leading-[1.6] break-words whitespace-pre-wrap text-stone-800 dark:text-stone-200',
          !expanded && 'line-clamp-6',
        )}
      >
        {text}
      </p>
      {(overflowing || expanded) && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-fs12 font-medium text-accent-600 hover:underline dark:text-accent-500"
        >
          {expanded ? '收起' : '展开全文'}
        </button>
      )}
    </div>
  )
}
