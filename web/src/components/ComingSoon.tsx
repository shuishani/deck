import clsx from 'clsx'
import { Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'

export function ComingSoon({
  title,
  icon,
  children,
  className,
}: {
  title: string
  icon?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <div
      className={clsx(
        'rounded-xl border border-dashed border-stone-300 bg-white/50 p-5 dark:border-stone-700 dark:bg-stone-900/40',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-lg bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400">
          {icon ?? <Sparkles className="size-4" />}
        </span>
        <h3 className="font-semibold">{title}</h3>
        <span className="ml-auto rounded-full bg-stone-100 px-2 py-0.5 text-fs11 font-medium text-stone-500 dark:bg-stone-800 dark:text-stone-400">
          即将推出
        </span>
      </div>
      {children && <div className="mt-3 text-fs13 leading-relaxed text-stone-500 dark:text-stone-400">{children}</div>}
    </div>
  )
}
