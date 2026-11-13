import clsx from 'clsx'
import { Bot } from 'lucide-react'
import type { GroupKind } from '../api'

/** 列表里只标出测试群；showProd 时正式群也标（会话页头，提醒发送会二次确认）。 */
export function KindTag({ kind, className, showProd }: { kind?: GroupKind; className?: string; showProd?: boolean }) {
  if (!kind || (kind === 'prod' && !showProd)) return null
  return (
    <span
      title={kind === 'prod' ? '正式群：发送前需二次确认' : '测试群'}
      className={clsx(
        'inline-flex shrink-0 items-center rounded px-1.5 text-fs11 leading-[18px] font-medium',
        kind === 'prod'
          ? 'text-stone-700 ring-1 ring-stone-300 ring-inset dark:text-stone-200 dark:ring-stone-700'
          : 'text-stone-500 ring-1 ring-stone-300 ring-inset dark:text-stone-400 dark:ring-stone-700',
        className,
      )}
    >
      {kind === 'prod' ? '正式' : '测试'}
    </span>
  )
}

export function AiTag({ className }: { className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 text-fs11 leading-[18px] font-semibold text-stone-600 ring-1 ring-stone-300 ring-inset dark:text-stone-300 dark:ring-stone-600',
        className,
      )}
    >
      <Bot className="size-3" />
      AI
    </span>
  )
}

export function ProjectTag({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex max-w-[10rem] shrink-0 items-center truncate rounded bg-stone-100 px-1.5 text-fs11 leading-[18px] font-medium text-stone-600 dark:bg-stone-800 dark:text-stone-300',
        className,
      )}
    >
      {name}
    </span>
  )
}

/** 路径太长时省略开头，保留最有辨识度的末段。 */
export function RepoPath({ path }: { path: string }) {
  const parts = path.split('/').filter(Boolean)
  const short = parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : path
  return (
    <span className="truncate" title={path}>
      {short}
    </span>
  )
}
