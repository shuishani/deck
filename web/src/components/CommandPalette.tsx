import clsx from 'clsx'
import { ArrowRight, FolderKanban, Inbox, ListTodo, MessageSquare, MessagesSquare, Search, Settings } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, type Message } from '../api'
import { shortTime } from '../format'
import { href, type Route } from '../router'
import { useDeck } from '../state'
import { SourceBadge } from './SourceBadge'

interface Item {
  id: string
  section: string
  label: ReactNode
  hint?: ReactNode
  icon: ReactNode
  to: Route
  text: string
}

const pages: { label: string; icon: ReactNode; to: Route }[] = [
  { label: '收件箱', icon: <Inbox className="size-4" />, to: { name: 'inbox' } },
  { label: '消息', icon: <MessagesSquare className="size-4" />, to: { name: 'messages' } },
  { label: '任务', icon: <ListTodo className="size-4" />, to: { name: 'tasks' } },
  { label: '项目', icon: <FolderKanban className="size-4" />, to: { name: 'projects' } },
  { label: '设置 · 连接', icon: <Settings className="size-4" />, to: { name: 'settings', tab: 'connections' } },
  { label: '设置 · AI', icon: <Settings className="size-4" />, to: { name: 'settings', tab: 'ai' } },
  { label: '设置 · 日志', icon: <Settings className="size-4" />, to: { name: 'settings', tab: 'log' } },
]

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { overview, groups } = useDeck()
  const [query, setQuery] = useState('')
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setIndex(0)
    setMessages(null)
    api
      .timeline({ limit: 200 })
      .then(({ messages }) => setMessages(messages))
      .catch(() => setMessages([]))
    setTimeout(() => input.current?.focus(), 0)
  }, [open])

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase()
    const match = (text: string) => !q || text.toLowerCase().includes(q)
    const result: Item[] = []
    for (const page of pages) {
      if (match(page.label)) result.push({ id: `page:${page.label}`, section: '页面', label: page.label, icon: page.icon, to: page.to, text: page.label })
    }
    for (const project of overview ?? []) {
      const text = `${project.name} ${project.key}`
      if (match(text))
        result.push({
          id: `project:${project.key}`,
          section: '项目',
          label: project.name,
          hint: project.key,
          icon: <FolderKanban className="size-4" />,
          to: { name: 'project', key: project.key, tab: 'overview' },
          text,
        })
    }
    for (const group of groups) {
      if (match(group.name))
        result.push({
          id: `group:${group.id}`,
          section: '群',
          label: group.name,
          hint: group.projectName,
          icon: <SourceBadge source={group.source} />,
          to: { name: 'messages', group: group.id },
          text: group.name,
        })
    }
    if (q && messages) {
      const hits = [...messages].reverse().filter((m) => m.text.toLowerCase().includes(q)).slice(0, 8)
      for (const message of hits)
        result.push({
          id: `message:${message.id}`,
          section: '消息',
          label: <Snippet text={message.text} query={q} />,
          hint: `${message.is_me ? '我' : message.sender_name} · ${message.group_name} · ${shortTime(message.sent_at)}`,
          icon: <MessageSquare className="size-4" />,
          to: { name: 'messages', group: message.group_id },
          text: message.text,
        })
    }
    return result
  }, [query, overview, groups, messages])

  useEffect(() => setIndex(0), [query])

  if (!open) return null

  function go(item: Item | undefined) {
    if (!item) return
    window.location.hash = href(item.to)
    onClose()
  }

  let lastSection = ''
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
      <div className="absolute inset-0 bg-stone-900/30 backdrop-blur-[2px] dark:bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl dark:border-stone-800 dark:bg-stone-900">
        <div className="flex items-center gap-2.5 border-b border-stone-100 px-4 dark:border-stone-800">
          <Search className="size-4 text-stone-400" />
          <input
            ref={input}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose()
              else if (event.key === 'ArrowDown') {
                event.preventDefault()
                setIndex((i) => Math.min(i + 1, items.length - 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setIndex((i) => Math.max(i - 1, 0))
              } else if (event.key === 'Enter') go(items[index])
            }}
            placeholder="搜索消息、群、项目，或跳到某个页面…"
            className="h-12 flex-1 bg-transparent text-fs15 outline-none placeholder:text-stone-400"
          />
          <kbd className="rounded border border-stone-200 px-1.5 text-fs11 text-stone-400 dark:border-stone-700">esc</kbd>
        </div>
        <div className="scroll-thin max-h-[55vh] overflow-y-auto p-2">
          {items.length === 0 && (
            <p className="px-3 py-8 text-center text-fs13 text-stone-400">
              {messages === null && query ? '正在读取消息…' : '没有找到'}
            </p>
          )}
          {items.map((item, i) => {
            const header = item.section !== lastSection
            lastSection = item.section
            return (
              <div key={item.id}>
                {header && <div className="px-3 pt-2 pb-1 text-fs11 font-semibold text-stone-400">{item.section}</div>}
                <button
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => go(item)}
                  className={clsx(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left',
                    i === index ? 'bg-stone-100 dark:bg-stone-800' : '',
                  )}
                >
                  <span className="text-stone-400">{item.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.label}</span>
                    {item.hint && <span className="block truncate text-fs12 text-stone-400">{item.hint}</span>}
                  </span>
                  {i === index && <ArrowRight className="size-3.5 text-stone-400" />}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Snippet({ text, query }: { text: string; query: string }) {
  const flat = text.replace(/\s+/g, ' ')
  const at = flat.toLowerCase().indexOf(query)
  const start = Math.max(0, at - 20)
  const before = (start > 0 ? '…' : '') + flat.slice(start, at)
  return (
    <>
      {before}
      <mark className="rounded bg-amber-200/70 px-0.5 text-inherit dark:bg-amber-500/30">{flat.slice(at, at + query.length)}</mark>
      {flat.slice(at + query.length, at + query.length + 60)}
    </>
  )
}
