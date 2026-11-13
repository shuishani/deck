import clsx from 'clsx'
import { ChevronLeft, RefreshCw, Search, Sparkles } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { api } from '../api'
import { useActions } from '../state'
import { useToast } from './Toast'
import { Button } from './ui'

export function SyncButton({ project, compact, icon }: { project?: string; compact?: boolean; icon?: boolean }) {
  const { bump } = useActions()
  const toast = useToast()
  const [syncing, setSyncing] = useState(false)

  async function sync() {
    setSyncing(true)
    try {
      const { results } = await api.sync(project)
      const failed = results.filter((r) => r.error)
      const added = results.reduce((sum, r) => sum + r.added, 0)
      if (failed.length) toast(failed.map((r) => `${r.name}：${r.error}`).join('\n'), 'error')
      else toast(added ? `同步完成，新增 ${added} 条消息` : '同步完成，暂无新消息', added ? 'success' : 'info')
      bump()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setSyncing(false)
    }
  }

  if (icon) {
    return (
      <button onClick={sync} disabled={syncing} title="同步：获取各群最新消息" aria-label="同步" className={iconButton}>
        <RefreshCw className={clsx('size-4', syncing && 'animate-spin')} />
      </button>
    )
  }
  return (
    <Button onClick={sync} disabled={syncing} title="获取各群最新消息" className={clsx(compact && '!px-2')}>
      <RefreshCw className={clsx('size-3.5', syncing && 'animate-spin')} />
      <span className={clsx(compact && 'max-md:hidden')}>{syncing ? '同步中' : '同步'}</span>
    </Button>
  )
}

/** 页头、工具栏里的图标按钮：手机上 40×40。 */
export const iconButton =
  'inline-flex items-center justify-center rounded-lg p-1.5 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 disabled:opacity-50 max-md:size-10 max-md:p-0 max-md:[&_svg]:size-5 dark:hover:bg-stone-800 dark:hover:text-stone-200'

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
  const { openSearch, openAskAi } = useActions()
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
        <div className="flex shrink-0 items-center gap-2 max-md:gap-0.5 max-md:[&>button]:size-10 max-md:[&>button]:!px-0">
          <button onClick={openSearch} className={clsx(iconButton, 'md:hidden')} aria-label="搜索">
            <Search className="size-4" />
          </button>
          {actions}
          <Button onClick={openAskAi} title="问 AI" className="max-md:hidden">
            <Sparkles className="size-3.5" />
            问 AI
          </Button>
          <button onClick={openAskAi} className={clsx(iconButton, 'md:hidden')} aria-label="问 AI">
            <Sparkles className="size-4" />
          </button>
          <span className="max-md:hidden">
            <SyncButton project={syncProject} compact />
          </span>
          <span className="md:hidden">
            <SyncButton project={syncProject} icon />
          </span>
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
        {/* 靠左对齐，和页头标题同一条左边线。 */}
        <div className={clsx('px-4 py-6 md:px-6', wide ? 'max-w-7xl' : 'max-w-6xl')}>{children}</div>
      </div>
    </div>
  )
}
