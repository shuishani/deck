import { ChevronLeft, ChevronUp, ListPlus, MessagesSquare } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api, type Message } from '../api'
import { sourceName } from '../platforms'
import { dayKey, dayLabel } from '../format'
import { href, navigate } from '../router'
import { taskDraftFrom, useLoad, type GroupInfo, useActions, useData, useUi } from '../state'
import { Composer } from './Composer'
import { EmptyState, ErrorBar, MessageSkeleton } from './Feedback'
import { MessageItem } from './MessageItem'
import { SourceBadge, StatusDot, watchLabel, watchShort } from './SourceBadge'
import { KindTag, ProjectTag } from './Tags'
import { useToast } from './Toast'
import { Button, ConfirmDialog } from './ui'

const GROUP_GAP_MS = 5 * 60 * 1000
const NEAR_BOTTOM_PX = 120

function continues(previous: Message | undefined, message: Message) {
  return (
    !!previous &&
    !previous.retracted &&
    !message.retracted &&
    !message.attention &&
    previous.is_me === message.is_me &&
    previous.sender_name === message.sender_name &&
    Date.parse(message.sent_at) - Date.parse(previous.sent_at) < GROUP_GAP_MS
  )
}


export function Conversation({ group, onBack, focus, anchored }: { group: GroupInfo; onBack?: () => void; focus?: number; anchored?: boolean }) {
  const { versions, groups, config } = useData()
  const { openReply, clearReply, openTask, bump, setPicking } = useActions()
  const { reply: draft, picking } = useUi()
  const toast = useToast()
  // 从搜索结果进入时先取该消息前后的上下文；点「回到最新」再恢复普通时间线。
  const [around, setAround] = useState<number | undefined>(anchored ? focus : undefined)
  const { data, error, loading, reload } = useLoad(
    () => api.timeline({ group: group.id, limit: 50, around }),
    [group.id, versions.messages, versions.tasks, around],
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
    stickToBottom.current = !around
  }, [group.id, around])

  useEffect(() => {
    if (anchored && focus) setAround(focus)
  }, [anchored, focus])

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

  // 打开着、页面在前台时，新消息直接算已读。同一群的同一条最新消息只标一次：
  // 标完会刷新数据，而群列表的未读数要等下一次加载才变，不加限制会反复请求。
  const marked = useRef<string | null>(null)
  const bumpRef = useRef(bump)
  bumpRef.current = bump
  useEffect(() => {
    if (!data || !group.unread_count || document.visibilityState !== 'visible') return
    const key = `${group.id}:${data.messages.at(-1)?.id ?? 0}`
    if (marked.current === key) return
    marked.current = key
    api.markRead(group.id).then(() => bumpRef.current(), () => {
      marked.current = null
    })
  }, [data, group.id, group.unread_count])

  const items = useRef(new Map<number, HTMLElement>())
  const [flash, setFlash] = useState<number | null>(null)
  const jump = (id: number) => {
    const el = items.current.get(id)
    if (!el) return
    stickToBottom.current = false
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setFlash(id)
    setTimeout(() => setFlash((current) => (current === id ? null : current)), 1500)
  }
  const focused = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (!focus || !data || focused.current === focus) return
    const el = items.current.get(focus)
    if (!el) return
    focused.current = focus
    stickToBottom.current = false
    el.scrollIntoView({ block: 'center' })
    setFlash(focus)
    const timer = setTimeout(() => setFlash(null), 2000)
    return () => clearTimeout(timer)
  }, [focus, data])

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

  const reply = (message: Message) =>
    openReply({ group: group.id, replyTo: message, handle: message.attention ? message.id : undefined })
  const [drafting, setDrafting] = useState<number | null>(null)
  const draftReply = async (message: Message) => {
    if (drafting) return
    setDrafting(message.id)
    try {
      const result = await api.draftAi({ message_id: message.id })
      // 只填进输入框；发送仍要经过预览和确认。
      openReply({
        group: result.group_id,
        replyTo: message,
        handle: message.attention ? message.id : undefined,
        initialText: result.draft,
        ai: true,
      })
      toast('AI 已起草，尚未发送，请核对后再发送', 'info')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setDrafting(null)
    }
  }
  const [retracting, setRetracting] = useState<Message | null>(null)
  const [retractBusy, setRetractBusy] = useState(false)
  const retract = async () => {
    if (!retracting) return
    setRetractBusy(true)
    try {
      await api.retract(retracting.id)
      toast('已撤回')
      setRetracting(null)
      bump()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setRetractBusy(false)
    }
  }
  const startEdit = (message: Message) => openReply({ group: group.id, replyTo: message, edit: true })
  const setHandled = async (message: Message, handled: boolean) => {
    try {
      await api.setHandled(message.id, handled)
      bump()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    }
  }
  const toTask = (message: Message) => openTask(taskDraftFrom([message], group.project))
  const pick = (message: Message) => {
    if (!picking) return setPicking([message])
    setPicking(picking.some((m) => m.id === message.id) ? picking.filter((m) => m.id !== message.id) : [...picking, message])
  }
  const pickedToTask = () => {
    if (!picking?.length) return
    const first = [...picking].sort((a, b) => a.sent_at.localeCompare(b.sent_at) || a.id - b.id)[0]
    openTask(taskDraftFrom(picking, groups.find((g) => g.id === first.group_id)?.project ?? group.project))
  }

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
          <h2 className="truncate font-semibold max-md:line-clamp-2 max-md:whitespace-normal max-md:leading-snug max-md:[overflow-wrap:anywhere]" title={group.name}>
            {group.name}
          </h2>
          <div className="flex items-center gap-1.5 text-fs12 text-stone-500">
            <KindTag kind={group.kind} showProd />
            <StatusDot watch={group.watch} />
            <span className="truncate" title={watchLabel(group.watch)}>
              {sourceName(group.source)} · {watchShort(group.watch)}
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
          {around && (
            <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-1.5 text-fs12 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <span>正在查看定位到的历史消息</span>
              <button
                onClick={() => {
                  focused.current = undefined
                  setAround(undefined)
                  stickToBottom.current = true
                  navigate({ name: 'messages', group: group.id })
                }}
                className="shrink-0 font-medium underline"
              >
                回到最新
              </button>
            </div>
          )}
          {error && <ErrorBar message={error} onRetry={reload} />}
          {loading && (
            <div className="px-3 py-2">
              <MessageSkeleton />
            </div>
          )}
          {!loading && !error && messages.length === 0 && (
            <EmptyState icon={<MessagesSquare className="size-5" />} title="暂无消息" hint="点击右上角「同步」获取最新消息。" />
          )}
          {hasMore && messages.length > 0 && (
            <div className="flex flex-col items-center gap-2 pb-2">
              <button
                onClick={loadOlder}
                disabled={loadingOlder}
                className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-fs12 font-medium text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
              >
                <ChevronUp className="size-3.5" />
                {loadingOlder ? '加载中…' : '加载更早的消息'}
              </button>
              {olderError && <p className="text-fs12 text-red-600">{olderError}</p>}
            </div>
          )}
          {days.map((day) => (
            <section key={day.key}>
              <div className="flex justify-center py-2">
                <span className="rounded-full bg-stone-200/60 px-3 py-0.5 text-fs12 font-medium text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                  {day.label}
                </span>
              </div>
              <div className="space-y-0.5">
                {day.items.map((message, index) => (
                  <MessageItem
                    key={message.id}
                    ref={(el) => {
                      if (el) items.current.set(message.id, el)
                      else items.current.delete(message.id)
                    }}
                    message={message}
                    compact={continues(day.items[index - 1], message)}
                    highlight={flash === message.id}
                    onReply={reply}
                    onTask={toTask}
                    onHandled={setHandled}
                    onJump={jump}
                    onEdit={startEdit}
                    onRetract={setRetracting}
                    onDraft={config?.ai_ready && !drafting ? draftReply : undefined}
                    onPick={pick}
                    picking={!!picking}
                    picked={!!picking?.some((m) => m.id === message.id)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      <ConfirmDialog
        open={!!retracting}
        title="撤回这条消息？"
        confirmLabel="撤回"
        busy={retractBusy}
        onClose={() => setRetracting(null)}
        onConfirm={() => void retract()}
      >
        撤回后，「{group.name}」内所有成员都将看不到这条消息。超过平台允许的时间（channel 为 24 小时）会撤回失败。
      </ConfirmDialog>
      {picking ? (
        <PickBar messages={picking} onCancel={() => setPicking(null)} onTask={pickedToTask} />
      ) : (
        <Composer key={group.id} group={group} reply={draft?.group === group.id ? draft : null} onClearReply={clearReply} />
      )}
    </section>
  )
}

function PickBar({ messages, onCancel, onTask }: { messages: Message[]; onCancel: () => void; onTask: () => void }) {
  const groupCount = new Set(messages.map((m) => m.group_id)).size
  return (
    <div className="shrink-0 border-t border-stone-200 bg-white px-3 py-2.5 md:px-5 dark:border-stone-800 dark:bg-stone-950">
      <div className="mx-auto flex max-w-3xl items-center gap-3 rounded-xl border border-accent-500/50 bg-white px-3 py-2 dark:bg-stone-900">
        <div className="min-w-0 flex-1">
          <p className="text-fs13 font-medium">
            已选 <span className="tabular-nums">{messages.length}</span> 条消息
            {groupCount > 1 && <span className="font-normal text-stone-500">，来自 {groupCount} 个群</span>}
          </p>
          <p className="truncate text-fs12 text-stone-500">点消息选择或取消，可跨群选</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          取消
        </Button>
        <Button variant="primary" size="sm" onClick={onTask} disabled={!messages.length}>
          <ListPlus className="size-3.5" />
          转为任务
        </Button>
      </div>
    </div>
  )
}
