import clsx from 'clsx'
import { AlertTriangle, RotateCw } from 'lucide-react'
import type { ReactNode } from 'react'

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-md bg-stone-200/70 dark:bg-stone-800', className)} />
}

export function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="mt-4 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-3/4" />
          <Skeleton className="mt-5 h-3 w-1/3" />
        </div>
      ))}
    </div>
  )
}

export function MessageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-5">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="size-8 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-40" />
            <Skeleton className={clsx('h-3', i % 2 ? 'w-2/3' : 'w-5/6')} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: ReactNode
  title: string
  hint?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-stone-300 px-6 py-14 text-center dark:border-stone-700">
      <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400">
        {icon}
      </div>
      <p className="font-medium">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-fs13 text-stone-500 dark:text-stone-400">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorBar({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
      <AlertTriangle className="size-4 shrink-0" />
      <p className="flex-1 break-words">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-fs13 font-medium hover:bg-red-100 dark:hover:bg-red-500/20"
        >
          <RotateCw className="size-3.5" />
          重试
        </button>
      )}
    </div>
  )
}
