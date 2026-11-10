import clsx from 'clsx'
import { Bot } from 'lucide-react'
import { groupKind } from '../mock/groupKind'

export function KindTag({ name, className }: { name: string; className?: string }) {
  const kind = groupKind(name)
  return (
    <span
      title={kind === 'prod' ? '正式群：发送前会多一道确认' : '测试群'}
      className={clsx(
        'inline-flex shrink-0 items-center rounded px-1.5 text-fs11 leading-[18px] font-medium',
        kind === 'prod'
          ? 'text-rose-700 ring-1 ring-rose-300 ring-inset dark:text-rose-300 dark:ring-rose-500/40'
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
