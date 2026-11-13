import clsx from 'clsx'
import { ArrowRight, FolderKanban, ListTodo, MessageSquare, MessagesSquare, ScrollText, Search, Settings } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, type MessageSearchResult } from '../api'
import { shortTime } from '../format'
import { href, type Route } from '../router'
import { useData } from '../state'
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
  { label: '消息', icon: <MessagesSquare className="size-4" />, to: { name: 'messages' } },
  { label: '任务', icon: <ListTodo className="size-4" />, to: { name: 'tasks' } },
  { label: '项目', icon: <FolderKanban className="size-4" />, to: { name: 'projects' } },
  { label: '日志', icon: <ScrollText className="size-4" />, to: { name: 'log' } },
  { label: '设置 · 连接', icon: <Settings className="size-4" />, to: { name: 'settings', tab: 'connections' } },
  { label: '设置 · 群与提醒', icon: <Settings className="size-4" />, to: { name: 'settings', tab: 'reminders' } },
  { label: '设置 · AI', icon: <Settings className="size-4" />, to: { name: 'settings', tab: 'ai' } },
  { label: '设置 · 访问', icon: <Settings className="size-4" />, to: { name: 'settings', tab: 'access' } },
]

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { overview, groups } = useData()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<MessageSearchResult['hits']>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const ticket = useRef(0)
  const pending = useRef<AbortController | null>(null)
  const needle = query.trim()

  useEffect(() => {
    if (!open) return
    setQuery('')
    setIndex(0)
    setTimeout(() => input.current?.focus(), 0)
  }, [open])

  // 防抖后查询本地已同步的全部消息；新输入会取消旧请求，过期结果不会覆盖新结果。
  useEffect(() => {
    pending.current?.abort()
    const mine = ++ticket.current
    setHits([])
    setCursor(null)
    setSearchError(null)
    if (!open || !needle) {
      setSearching(false)
      return
    }
    setSearching(true)
    const controller = new AbortController()
    pending.current = controller
    const timer = setTimeout(() => {
      api
        .search({ q: needle }, controller.signal)
        .then((page) => {
          if (mine !== ticket.current) return
          setHits(page.hits)
          setCursor(page.next_cursor)
        })
        .catch((err) => {
          if (mine === ticket.current && !controller.signal.aborted) setSearchError(err instanceof Error ? err.message : String(err))
        })
        .finally(() => {
          if (mine === ticket.current) setSearching(false)
        })
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [needle, open])

  async function loadMore() {
    if (!cursor || searching) return
    const mine = ticket.current
    setSearching(true)
    try {
      const page = await api.search({ q: needle, cursor }, pending.current?.signal)
      if (mine !== ticket.current) return
      setHits((all) => [...all, ...page.hits.filter((hit) => !all.some((old) => old.message.id === hit.message.id))])
      setCursor(page.next_cursor)
    } catch (err) {
      if (mine === ticket.current) setSearchError(err instanceof Error ? err.message : String(err))
    } finally {
      if (mine === ticket.current) setSearching(false)
    }
  }

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
    if (q) {
      for (const { message, excerpt } of hits)
        result.push({
          id: `message:${message.id}`,
          section: '消息',
          label: <Snippet text={excerpt || message.text} query={q} />,
          hint: `${message.is_me ? '我' : message.sender_name} · ${message.group_name} · ${shortTime(message.sent_at)}`,
          icon: <MessageSquare className="size-4" />,
          to: { name: 'messages', group: message.group_id, anchor: message.id },
          text: message.text,
        })
    }
    return result
  }, [query, overview, groups, hits])

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
            placeholder="搜索消息、群、项目或页面"
            className="h-12 flex-1 bg-transparent text-fs15 outline-none placeholder:text-stone-400"
          />
          <kbd className="rounded border border-stone-200 px-1.5 text-fs11 text-stone-400 dark:border-stone-700">esc</kbd>
        </div>
        <p className="px-4 pt-2 text-fs11 text-stone-400">消息检索本地已同步的全部历史；点击结果定位到原消息。</p>
        {searchError && <p role="alert" className="px-4 pt-2 text-fs12 break-words text-red-600">{searchError}</p>}
        <div className="scroll-thin max-h-[55vh] overflow-y-auto p-2">
          {items.length === 0 && (
            <p className="px-3 py-8 text-center text-fs13 text-stone-400">
              {searching ? '搜索中…' : '无匹配结果'}
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
          {needle && searching && items.length > 0 && <p className="px-3 py-2 text-center text-fs12 text-stone-400">搜索中…</p>}
          {cursor && !searching && (
            <button onClick={() => void loadMore()} className="w-full rounded-lg px-3 py-2 text-center text-fs12 font-medium text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800">
              加载更多消息
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Snippet({ text, query }: { text: string; query: string }) {
  const flat = text.replace(/\s+/g, ' ')
  const at = flat.toLowerCase().indexOf(query)
  if (at < 0) return <>{flat.slice(0, 80)}</>
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
