import clsx from 'clsx'
import { AlertTriangle, Bot, ChevronDown, ChevronRight, ScrollText, Search, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, type LogEntry, type LogQuery } from '../api'
import { SOURCES, sourceName } from '../platforms'
import { EmptyState, ErrorBar, Skeleton } from '../components/Feedback'
import { Page, PageHeader } from '../components/PageHeader'
import { Chips, inputClass, Select, Switch } from '../components/ui'
import { clock, dayKey, dayLabel, fullTime } from '../format'
import { href } from '../router'
import { useLoad, useActions, useData } from '../state'
import { statusLabel } from '../tasks'
import { deviceName } from './settings/Access'

export const LOG_SUBTITLE = 'deck 的全部变更与发送记录'

/** 电脑端独立的日志页；手机端日志显示在设置页签里。 */
export function LogPage() {
  return (
    <Page header={<PageHeader title="日志" subtitle={LOG_SUBTITLE} />}>
      <Log />
    </Page>
  )
}

const RANGES = [
  { id: 'all', label: '全部时间', days: null },
  { id: '1', label: '今天', days: 0 },
  { id: '7', label: '近 7 天', days: 7 },
  { id: '30', label: '近 30 天', days: 30 },
] as const

/** 操作从哪里发起。 */
const VIA: Record<string, string> = { web: '网页', cli: '命令行', watcher: '自动监听', mcp: 'AI 助手' }

const ACTORS: { id: '' | 'me' | 'ai'; label: string }[] = [
  { id: '', label: '所有执行者' },
  { id: 'me', label: '我' },
  { id: 'ai', label: 'AI' },
]

function sinceOf(days: number | null) {
  if (days === null) return undefined
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - days)
  return date.toISOString()
}

const SEEN_FAILURES = 'deck.log.seenFailure'

export function Log() {
  const { auditVersion: version } = useData()
  const [showFilters, setShowFilters] = useState(false)
  const [seen, setSeen] = useState(() => Number(localStorage.getItem(SEEN_FAILURES)) || 0)
  const [category, setCategory] = useState('all')
  const [failed, setFailed] = useState(false)
  const [actor, setActor] = useState<'' | 'me' | 'ai'>('')
  const [range, setRange] = useState<(typeof RANGES)[number]['id']>('all')
  const [typed, setTyped] = useState('')
  const [search, setSearch] = useState('')
  const [noise, setNoise] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setSearch(typed.trim()), 300)
    return () => clearTimeout(timer)
  }, [typed])

  const filters: LogQuery = useMemo(
    () => ({
      category: category === 'all' ? undefined : category,
      failed,
      actor: actor || undefined,
      q: search || undefined,
      since: sinceOf(RANGES.find((r) => r.id === range)!.days),
      noise,
    }),
    [category, failed, actor, search, range, noise],
  )
  const key = JSON.stringify(filters)
  const first = useLoad(() => api.log(filters), [key, version])
  // 「加载更早」拿到的页；换筛选条件时清空。
  const [older, setOlder] = useState<{ key: string; entries: LogEntry[]; more: boolean } | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [olderError, setOlderError] = useState<string | null>(null)
  const pages = older?.key === key ? older : null
  const entries = useMemo(() => {
    const seen = new Set<number>()
    return [...(first.data?.entries ?? []), ...(pages?.entries ?? [])].filter((e) => !seen.has(e.id) && seen.add(e.id))
  }, [first.data, pages])
  const hasMore = pages ? pages.more : (first.data?.has_more ?? false)

  const recentFailures = useLoad(() => api.log({ failed: true, since: sinceOf(7) }), [version])
  const fresh = recentFailures.data?.entries.filter((entry) => entry.id > seen) ?? []
  const filtering = category !== 'all' || failed || !!actor || range !== 'all' || !!search
  const categories = [{ id: 'all', label: '全部' }, ...(first.data?.categories ?? [])]
  // 手机上筛选收起时，用小标签显示已选条件，点 × 单独去掉。
  const active = [
    category !== 'all' && { label: categories.find((c) => c.id === category)?.label ?? category, clear: () => setCategory('all') },
    range !== 'all' && { label: RANGES.find((r) => r.id === range)!.label, clear: () => setRange('all') },
    actor && { label: actor === 'me' ? '我' : 'AI', clear: () => setActor('') },
    failed && { label: '只看失败', clear: () => setFailed(false) },
    noise && { label: '含登录码、监听开关', clear: () => setNoise(false) },
  ].filter((item): item is { label: string; clear: () => void } => !!item)

  function markSeen() {
    const top = Math.max(seen, ...fresh.map((entry) => entry.id))
    localStorage.setItem(SEEN_FAILURES, String(top))
    setSeen(top)
  }

  async function loadOlder() {
    const last = entries.at(-1)
    if (!last) return
    setLoadingOlder(true)
    setOlderError(null)
    try {
      const page = await api.log({ ...filters, before: last.id })
      setOlder({ key, entries: [...(pages?.entries ?? []), ...page.entries], more: page.has_more })
    } catch (err) {
      setOlderError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingOlder(false)
    }
  }

  function reset() {
    setCategory('all')
    setFailed(false)
    setActor('')
    setRange('all')
    setTyped('')
  }

  const days = useMemo(() => {
    const result: { key: string; label: string; items: LogEntry[] }[] = []
    for (const entry of entries) {
      const k = dayKey(entry.at)
      const last = result.at(-1)
      if (last?.key === k) last.items.push(entry)
      else result.push({ key: k, label: dayLabel(entry.at), items: [entry] })
    }
    return result
  }, [entries])

  return (
    <div className="space-y-3">
      {fresh.length > 0 && !failed && (
        <div className="flex items-center gap-1 rounded-xl border border-red-200 bg-red-50 py-1 pr-1 pl-3 text-fs13 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
          <AlertTriangle className="mr-1.5 size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            近 7 天有 {fresh.length}
            {recentFailures.data?.has_more ? '+' : ''} 条新的操作失败
          </span>
          <button
            onClick={() => {
              markSeen()
              setFailed(true)
            }}
            className="h-8 shrink-0 rounded-md px-2.5 font-medium hover:bg-red-100 max-md:h-9 dark:hover:bg-red-500/20"
          >
            查看
          </button>
          <button onClick={markSeen} className="h-8 shrink-0 rounded-md px-2.5 text-red-700/80 hover:bg-red-100 max-md:h-9 dark:text-red-300/80 dark:hover:bg-red-500/20">
            知道了
          </button>
        </div>
      )}

      <div className="space-y-2.5 rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900">
        <div className="flex items-center gap-2">
          <label className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-stone-400" />
            <input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder="搜索日志"
              className={clsx(inputClass, '!py-1.5 pl-8 !text-fs13')}
            />
          </label>
          <div className="flex gap-2 max-md:hidden">
          <Select field value={range} options={RANGES.map((r) => ({ id: r.id, label: r.label }))} onChange={setRange} label="时间范围" className="!h-[38px] !text-fs13 md:!w-36" />
          <Select field value={actor} options={ACTORS} onChange={setActor} label="执行者" className="!h-[38px] !text-fs13 md:!w-32" />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            aria-expanded={showFilters}
            className={clsx(
              'inline-flex h-[38px] shrink-0 items-center gap-1.5 rounded-lg border px-3 text-fs13 md:hidden',
              showFilters || active.length ? 'border-accent-500/60 text-accent-700 dark:text-accent-500' : 'border-stone-200 text-stone-600 dark:border-stone-700 dark:text-stone-300',
            )}
          >
            <SlidersHorizontal className="size-4" />
            筛选
            {active.length > 0 && <span className="rounded-full bg-accent-600 px-1.5 text-fs11 leading-4 text-white tabular-nums">{active.length}</span>}
          </button>
        </div>
        <div className={clsx('space-y-2.5', !showFilters && 'max-md:hidden')}>
          <Chips value={category} onChange={setCategory} options={categories} />
          <div className="grid grid-cols-2 gap-2 md:hidden">
          <Select field value={range} options={RANGES.map((r) => ({ id: r.id, label: r.label }))} onChange={setRange} label="时间范围" className="!h-[38px] !text-fs13 md:!w-36" />
          <Select field value={actor} options={ACTORS} onChange={setActor} label="执行者" className="!h-[38px] !text-fs13 md:!w-32" />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Switch checked={failed} onChange={setFailed} label="只看失败" />
            <Switch checked={noise} onChange={setNoise} label="显示登录码、监听开关" />
            {filtering && (
              <button onClick={reset} className="ml-auto inline-flex items-center gap-1 text-fs12 text-stone-500 hover:text-stone-800 dark:hover:text-stone-200">
                <X className="size-3" />
                清除筛选
              </button>
            )}
          </div>
        </div>
        {!showFilters && active.length > 0 && (
          <div className="flex flex-wrap gap-1.5 md:hidden">
            {active.map((item) => (
              <button
                key={item.label}
                onClick={item.clear}
                className="inline-flex items-center gap-1 rounded-full bg-stone-100 py-1 pr-2 pl-2.5 text-fs12 text-stone-600 dark:bg-stone-800 dark:text-stone-300"
              >
                {item.label}
                <X className="size-3" />
              </button>
            ))}
          </div>
        )}
      </div>

      {first.error && <ErrorBar message={first.error} onRetry={first.reload} />}
      {first.loading && (
        <div className="space-y-2 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      )}
      {!first.loading && !first.error && entries.length === 0 && (
        <EmptyState
          icon={<ScrollText className="size-5" />}
          title={filtering ? '没有符合条件的记录' : '暂无记录'}
          hint={filtering ? '换个条件，或清除筛选。' : noise ? undefined : '登录码、监听开关等记录已隐藏，可在上方打开。'}
        />
      )}

      {days.map((day) => (
        <section key={day.key}>
          <h3 className="px-1 pb-1.5 text-fs12 font-medium text-stone-500">{day.label}</h3>
          <ol className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 bg-white dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
            {day.items.map((entry) => (
              <Row key={entry.id} entry={entry} />
            ))}
          </ol>
        </section>
      ))}

      {hasMore && entries.length > 0 && (
        <div className="flex flex-col items-center gap-1">
          <button
            onClick={() => void loadOlder()}
            disabled={loadingOlder}
            className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-fs12 font-medium text-stone-500 hover:bg-stone-100 disabled:opacity-50 dark:hover:bg-stone-800"
          >
            <ChevronDown className="size-3.5" />
            {loadingOlder ? '加载中…' : '加载更早的记录'}
          </button>
          {olderError && <p className="text-fs12 text-red-600">{olderError}</p>}
        </div>
      )}
    </div>
  )
}

function Row({ entry }: { entry: LogEntry }) {
  const [open, setOpen] = useState(false)
  const error = entry.status === 'error'
  const fields = Object.entries(entry.detail).filter(([, value]) => value !== null && value !== '' && !(Array.isArray(value) && !value.length))
  return (
    <li>
      <div
        onClick={(event) => !(event.target as HTMLElement).closest('a, button') && setOpen(!open)}
        className="flex cursor-pointer items-start gap-2 px-3 py-2.5 hover:bg-stone-50/70 dark:hover:bg-stone-800/30"
      >
        {/* 箭头、时间、标题都按 20px 行高对齐首行。 */}
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={open ? '收起详情' : '展开详情'}
          className="-mx-1 flex h-5 shrink-0 items-center rounded px-0.5 text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800"
        >
          <ChevronRight className={clsx('size-3.5 transition-transform', open && 'rotate-90')} />
        </button>
        <time className="w-11 shrink-0 text-fs12 leading-5 text-stone-400 tabular-nums" title={fullTime(entry.at)}>
          {clock(entry.at)}
        </time>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={clsx('text-fs13 leading-5 font-medium', error && 'text-red-700 dark:text-red-300')}>{entry.label}</span>
            <ObjectLink entry={entry} />
            {entry.actor === 'ai' && (
              <span className="inline-flex items-center gap-1 rounded bg-accent-50 px-1.5 text-fs11 leading-[18px] font-medium text-accent-700 dark:bg-accent-500/15 dark:text-accent-500">
                <Bot className="size-3" />
                AI 执行
              </span>
            )}
            {entry.as_ai && (
              <span className="inline-flex items-center gap-1 rounded bg-stone-100 px-1.5 text-fs11 leading-[18px] text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                <Bot className="size-3" />
                以 AI 身份
              </span>
            )}
          </div>
          {error && <p className="mt-0.5 text-fs12 break-words text-red-600 dark:text-red-400">{entry.outcome}</p>}
        </div>
        {!error && entry.outcome !== '成功' && <span className="shrink-0 text-fs12 leading-5 text-stone-400">{entry.outcome}</span>}
        {entry.via && <span className="shrink-0 text-fs12 leading-5 text-stone-400 max-md:hidden">{VIA[entry.via] ?? entry.via}</span>}
      </div>
      {open && (
        <dl className="mx-3 mb-3 grid md:ml-[4.5rem] grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-stone-50 px-3 py-2 text-fs12 dark:bg-stone-800/50">
          {fields.map(([key, value]) => (
            <Field key={key} name={key} value={value} />
          ))}
          <dt className="text-stone-400">记录</dt>
          <dd className="font-mono text-stone-400 break-all">
            #{entry.id} · {entry.action} · {entry.target}
          </dd>
        </dl>
      )}
    </li>
  )
}

function ObjectLink({ entry }: { entry: LogEntry }) {
  const { openTaskDetail } = useActions()
  const { kind, id } = entry.object
  const ua = entry.detail.user_agent
  const label = typeof ua === 'string' && ua ? deviceName(ua) : entry.object.label
  const style = 'max-w-[16rem] truncate text-fs12 text-stone-500'
  const link = clsx(style, 'hover:text-accent-700 hover:underline dark:hover:text-accent-500')
  if (kind === 'group' && id !== null) {
    return (
      <a href={href({ name: 'messages', group: Number(id) })} className={link}>
        {label}
      </a>
    )
  }
  if (kind === 'task' && id !== null) {
    return (
      <button onClick={() => openTaskDetail(Number(id))} className={link}>
        {label}
      </button>
    )
  }
  if (kind === 'project' && id !== null) {
    return (
      <a href={href({ name: 'project', key: String(id), tab: 'overview' })} className={link}>
        {label}
      </a>
    )
  }
  return <span className={style}>{label}</span>
}

const NAMES: Record<string, string> = {
  group: '群',
  source: '平台',
  kind: '群类型',
  text: '内容',
  before: '修改前',
  reply_to: '回复的消息',
  notice: '提示',
  attachments: '附件',
  ai: '以 AI 身份',
  title: '标题',
  project: '项目',
  status: '状态',
  due: '截止',
  priority: '优先级',
  messages: '消息',
  message: '消息',
  name: '名称',
  repo: '仓库',
  from: '原项目',
  to: '新项目',
  fields: '修改项',
  user_agent: '设备',
  route: '路由',
  days: '保留天数',
  size: '大小',
  sender: '发送人',
  call: '调用',
  context: '数据范围',
}

const VALUES: Record<string, Record<string, string>> = {
  kind: { test: '测试群', prod: '正式群' },
  source: Object.fromEntries(SOURCES.map((s) => [s, sourceName(s)])),
}

function Field({ name, value }: { name: string; value: unknown }) {
  let shown: ReactNode
  if (typeof value === 'boolean') shown = value ? '是' : '否'
  else if (name === 'user_agent' && typeof value === 'string') shown = <span title={value}>{deviceName(value)}</span>
  else if (name === 'status' && typeof value === 'string') shown = statusLabel(value as never)
  else if (name === 'size' && typeof value === 'number') shown = `${(value / 1024).toFixed(1)} KB`
  else if (typeof value === 'string') shown = VALUES[name]?.[value] ?? value
  else if (Array.isArray(value) && value.every((v) => typeof v !== 'object')) shown = value.join('、')
  else shown = <code className="font-mono break-all">{JSON.stringify(value)}</code>
  return (
    <>
      <dt className="text-stone-400">{NAMES[name] ?? name}</dt>
      <dd className="break-words whitespace-pre-wrap text-stone-700 dark:text-stone-300">{shown}</dd>
    </>
  )
}
