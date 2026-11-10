import clsx from 'clsx'
import { ChevronLeft, RefreshCw, Search, Sparkles } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { api } from '../api'
import { setAiPaused, useAiPaused } from '../mock/aiSwitch'
import { useDeck } from '../state'
import { useToast } from './Toast'
import { Button } from './ui'

export function AiPill({ className }: { className?: string }) {
  const paused = useAiPaused()
  return (
    <button
      onClick={() => setAiPaused(!paused)}
      title={paused ? '点击恢复 AI 自动化' : '点击暂停所有 AI 自动化'}
      className={clsx(
        'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2 text-fs11 font-medium transition-colors',
        paused
          ? 'border-stone-300 bg-stone-100 text-stone-500 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400'
          : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300',
        className,
      )}
    >
      <span className={clsx('size-1.5 rounded-full', paused ? 'bg-stone-400' : 'bg-emerald-500')} />
      {paused ? 'AI 已暂停' : 'AI 运行中'}
    </button>
  )
}

export function SyncButton({ project, compact }: { project?: string; compact?: boolean }) {
  const { bump } = useDeck()
  const toast = useToast()
  const [syncing, setSyncing] = useState(false)

  async function sync() {
    setSyncing(true)
    try {
      const { results } = await api.sync(project)
      const failed = results.filter((r) => r.error)
      const added = results.reduce((sum, r) => sum + r.added, 0)
      if (failed.length) toast(failed.map((r) => `${r.name}：${r.error}`).join('\n'), 'error')
      else toast(added ? `同步完成，新增 ${added} 条消息` : '同步完成，没有新消息', added ? 'success' : 'info')
      bump()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <Button onClick={sync} disabled={syncing} title="从各群拉取最新消息" className={clsx(compact && '!px-2')}>
      <RefreshCw className={clsx('size-3.5', syncing && 'animate-spin')} />
      <span className={clsx(compact && 'max-md:hidden')}>{syncing ? '同步中' : '同步'}</span>
    </Button>
  )
}

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
  syncProject,
  children,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  back?: { href: string; label: string }
  syncProject?: string
  children?: ReactNode
}) {
  const { openSearch, openAskAi } = useDeck()
  return (
    <header className="shrink-0 border-b border-stone-200 bg-stone-50/90 backdrop-blur dark:border-stone-800 dark:bg-stone-950/90">
      <div className="flex min-h-14 items-center gap-3 px-4 py-2 md:px-6">
        <div className="min-w-0 flex-1">
          {back && (
            <a
              href={back.href}
              className="mb-0.5 inline-flex items-center gap-0.5 text-fs12 text-stone-500 hover:text-stone-800 dark:hover:text-stone-200"
            >
              <ChevronLeft className="size-3.5" />
              {back.label}
            </a>
          )}
          <h1 className="truncate text-fs16 font-semibold tracking-tight max-md:text-fs18">{title}</h1>
          {subtitle && <p className="truncate text-fs12 text-stone-500 dark:text-stone-400">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2 max-md:[&_svg]:size-[18px] max-md:[&>button]:min-h-9">
          <button
            onClick={openSearch}
            className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100 md:hidden dark:hover:bg-stone-800"
            aria-label="搜索"
          >
            <Search className="size-4" />
          </button>
          <AiPill className="md:hidden" />
          {actions}
          <Button onClick={openAskAi} title="问 AI" className="max-md:!px-2">
            <Sparkles className="size-3.5" />
            <span className="max-md:hidden">问 AI</span>
          </Button>
          <SyncButton project={syncProject} compact />
        </div>
      </div>
      {children}
    </header>
  )
}

export function Page({ header, children, wide }: { header: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className={clsx('mx-auto px-4 py-6 md:px-6', wide ? 'max-w-7xl' : 'max-w-6xl')}>{children}</div>
      </div>
    </div>
  )
}
