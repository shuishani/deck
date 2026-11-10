import clsx from 'clsx'
import type { Source, WatchState } from '../api'
import { relative } from '../format'

export function SourceBadge({ source, className }: { source: Source; className?: string }) {
  return (
    <span
      title={source === 'dingtalk' ? '钉钉' : 'channel'}
      className={clsx(
        'inline-flex size-[18px] shrink-0 items-center justify-center rounded-[5px] text-fs10 leading-none font-semibold',
        source === 'dingtalk'
          ? 'bg-ding-100 text-ding-700 dark:bg-ding-500/20 dark:text-ding-100'
          : 'bg-chan-100 text-chan-700 dark:bg-chan-500/20 dark:text-chan-100',
        className,
      )}
    >
      {source === 'dingtalk' ? '钉' : 'C'}
    </span>
  )
}

export function sourceName(source: Source) {
  return source === 'dingtalk' ? '钉钉' : 'channel'
}

export function watchTone(watch: WatchState) {
  if (watch.error) return 'error'
  return watch.mode === 'realtime' ? 'realtime' : 'poll'
}

export function watchLabel(watch: WatchState) {
  if (watch.error) return `出错：${watch.error}`
  const mode = watch.mode === 'realtime' ? '实时监听' : '定时轮询'
  return `${mode} · 上次同步 ${relative(watch.last_sync_at)}`
}

export function StatusDot({ watch, className }: { watch: WatchState; className?: string }) {
  const tone = watchTone(watch)
  return (
    <span title={watchLabel(watch)} className={clsx('relative inline-flex size-2 shrink-0', className)}>
      {tone === 'realtime' && (
        <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-50" />
      )}
      <span
        className={clsx(
          'relative inline-flex size-2 rounded-full',
          tone === 'realtime' && 'bg-emerald-500',
          tone === 'poll' && 'bg-amber-400',
          tone === 'error' && 'bg-red-500',
        )}
      />
    </span>
  )
}

export function CountBadge({ count, className }: { count: number; className?: string }) {
  if (!count) return null
  return (
    <span
      className={clsx(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1.5 text-fs11 leading-none font-semibold text-white tabular-nums',
        className,
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}
