import clsx from 'clsx'
import { Bot, ChevronLeft, ChevronUp, MessagesSquare, Send } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api, type Message } from '../api'
import { dayKey, dayLabel } from '../format'
import { href } from '../router'
import { taskSource, taskTitle, useDeck, useLoad, type GroupInfo } from '../state'
import { EmptyState, ErrorBar, MessageSkeleton } from './Feedback'
import { MessageItem } from './MessageItem'
import { SourceBadge, StatusDot, sourceName, watchLabel } from './SourceBadge'
import { KindTag, ProjectTag } from './Tags'

const GROUP_GAP_MS = 5 * 60 * 1000
const NEAR_BOTTOM_PX = 120

function continues(previous: Message | undefined, message: Message) {
  return (
    !!previous &&
    !message.awaiting &&
    previous.is_me === message.is_me &&
    previous.sender_name === message.sender_name &&
    Date.parse(message.sent_at) - Date.parse(previous.sent_at) < GROUP_GAP_MS
  )
}

const TOUCH = window.matchMedia('(pointer: coarse)').matches

export function Conversation({ group, onBack }: { group: GroupInfo; onBack?: () => void }) {
  const { version, config, openSend, openTask } = useDeck()
  const { data, error, loading, reload } = useLoad(
    () => api.timeline({ group: group.id, limit: 50 }),
    [group.id, version],
  )
  const [older, setOlder] = useState<Message[]>([])
  const [olderHasMore, setOlderHasMore] = useState<boolean | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [olderError, setOlderError] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const keepFromBottom = useRef<number | null>(null)

  useEffect(() => {
    setOlder([])
    setOlderHasMore(null)
    setOlderError(null)
    stickToBottom.current = true
  }, [group.id])

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    if (keepFromBottom.current !== null) {
      el.scrollTop = el.scrollHeight - keepFromBottom.current
      keepFromBottom.current = null
    } else if (data && stickToBottom.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [data, older])

  // 消息排好后高度还会变（长文测出要折叠、字体加载），停在底部时跟着贴底。
  const content = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scroller.current
    const inner = content.current
    if (!el || !inner) return
    const observer = new ResizeObserver(() => {
      if (stickToBottom.current && keepFromBottom.current === null) el.scrollTop = el.scrollHeight
    })
    observer.observe(inner)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const messages = useMemo(() => {
    const recent = data?.messages ?? []
    const seen = new Set(recent.map((m) => m.id))
    return [...older.filter((m) => !seen.has(m.id)), ...recent]
  }, [older, data])
  const hasMore = olderHasMore ?? data?.has_more ?? false

  const days = useMemo(() => {
    const result: { key: string; label: string; items: Message[] }[] = []
    for (const message of messages) {
      const key = dayKey(message.sent_at)
      const last = result[result.length - 1]
      if (last?.key === key) last.items.push(message)
      else result.push({ key, label: dayLabel(message.sent_at), items: [message] })
    }
    return result
  }, [messages])

  async function loadOlder() {
    const first = messages[0]
    if (!first) return
    setLoadingOlder(true)
    setOlderError(null)
    try {
      const page = await api.timeline({ group: group.id, limit: 50, before: first.id })
      const el = scroller.current
      if (el) keepFromBottom.current = el.scrollHeight - el.scrollTop
      setOlder((current) => [...page.messages, ...current])
      setOlderHasMore(page.has_more)
    } catch (err) {
      setOlderError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingOlder(false)
    }
  }

  const target = { group: group.id, groupName: group.name, source: group.source }
  const reply = (message: Message) => openSend({ ...target, replyTo: message })
  const toTask = (message: Message) =>
    openTask({ title: taskTitle(message.text), project: group.project, source: taskSource(message) })

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-white dark:bg-stone-950">
      <header className="flex min-h-14 shrink-0 items-center gap-2.5 border-b border-stone-200 px-3 py-2 md:px-5 dark:border-stone-800">
        {onBack && (
          <button onClick={onBack} className="-ml-1 rounded-md p-1 text-stone-500 md:hidden" aria-label="返回">
            <ChevronLeft className="size-5" />
          </button>
        )}
        <SourceBadge source={group.source} className="!size-6 !text-fs11" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate font-semibold">{group.name}</h2>
            <KindTag name={group.name} />
          </div>
          <div className="flex items-center gap-1.5 text-fs12 text-stone-500">
            <StatusDot watch={group.watch} />
            <span className="truncate" title={watchLabel(group.watch)}>
              {sourceName(group.source)} · {group.watch.mode === 'realtime' ? '实时' : '轮询'}
            </span>
            {group.projectName && group.project && (
              <a href={href({ name: 'project', key: group.project, tab: 'overview' })}>
                <ProjectTag name={group.projectName} className="hover:bg-stone-200 dark:hover:bg-stone-700" />
              </a>
            )}
          </div>
        </div>
      </header>

      <div
        ref={scroller}
        onScroll={(event) => {
          const el = event.currentTarget
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
        }}
        className="scroll-thin min-h-0 flex-1 overflow-y-auto bg-stone-50/60 dark:bg-stone-950"
      >
        <div ref={content} className="mx-auto max-w-3xl px-2 py-3 md:px-4">
          {error && <ErrorBar message={error} onRetry={reload} />}
          {loading && (
            <div className="px-3 py-2">
              <MessageSkeleton />
            </div>
          )}
          {!loading && !error && messages.length === 0 && (
            <EmptyState icon={<MessagesSquare className="size-5" />} title="还没有消息" hint="点右上角「同步」拉取最新消息。" />
          )}
          {hasMore && messages.length > 0 && (
            <div className="flex flex-col items-center gap-2 pb-2">
              <button
                onClick={loadOlder}
                disabled={loadingOlder}
                className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-fs12 font-medium text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
              >
                <ChevronUp className="size-3.5" />
                {loadingOlder ? '加载中…' : '加载更早'}
              </button>
              {olderError && <p className="text-fs12 text-red-600">{olderError}</p>}
            </div>
          )}
          {days.map((day) => (
            <section key={day.key}>
              <div className="sticky top-0 z-[2] flex justify-center py-2">
                <span className="rounded-full border border-stone-200 bg-white/90 px-3 py-0.5 text-fs12 font-medium text-stone-500 backdrop-blur dark:border-stone-800 dark:bg-stone-900/90 dark:text-stone-400">
                  {day.label}
                </span>
              </div>
              <div className="space-y-0.5">
                {day.items.map((message, index) => (
                  <MessageItem
                    key={message.id}
                    message={message}
                    compact={continues(day.items[index - 1], message)}
                    onReply={reply}
                    onTask={toTask}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      <Composer
        key={group.id}
        aiPrefix={config?.ai_prefix}
        onSend={(text, ai, clear) => openSend({ ...target, text, ai, onSent: clear })}
      />
    </section>
  )
}

function Composer({
  aiPrefix,
  onSend,
}: {
  aiPrefix?: string
  onSend: (text: string, ai: boolean, clear: () => void) => void
}) {
  const [text, setText] = useState('')
  const [ai, setAi] = useState(false)
  const ready = !!text.trim()
  const submit = () => ready && onSend(text, ai, () => setText(''))

  return (
    <div className="shrink-0 border-t border-stone-200 bg-white px-3 py-2.5 md:px-5 dark:border-stone-800 dark:bg-stone-950">
      <div className="mx-auto max-w-3xl rounded-xl border border-stone-200 bg-white focus-within:border-accent-500 focus-within:ring-2 focus-within:ring-accent-500/15 dark:border-stone-700 dark:bg-stone-900">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              submit()
            }
          }}
          rows={Math.min(6, Math.max(2, text.split('\n').length))}
          placeholder={TOUCH ? '写消息…' : '写消息…（⌘ + Enter 预览并发送）'}
          className="block w-full resize-none bg-transparent px-3 pt-2.5 text-fs14 leading-[1.6] outline-none placeholder:text-stone-400"
        />
        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <button
            type="button"
            onClick={() => setAi(!ai)}
            title={aiPrefix ? `开头会加上「${aiPrefix}」` : undefined}
            className={clsx(
              'inline-flex h-7 items-center gap-1 rounded-md px-2 text-fs12 font-medium transition-colors',
              ai
                ? 'bg-stone-900 text-stone-50 dark:bg-stone-100 dark:text-stone-900'
                : 'text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800',
            )}
          >
            <Bot className="size-3.5" />
            以 AI 身份
          </button>
          <button
            onClick={submit}
            disabled={!ready}
            className="inline-flex h-7 items-center gap-1.5 rounded-md bg-accent-600 px-3 text-fs12 font-medium text-white hover:bg-accent-700 disabled:opacity-40"
          >
            <Send className="size-3.5" />
            发送
          </button>
        </div>
      </div>
    </div>
  )
}
