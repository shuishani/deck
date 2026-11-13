import clsx from 'clsx'
import type { Source, WatchState } from '../api'
import { relative } from '../format'
import { PLATFORMS } from '../platforms'

export function SourceBadge({ source, className }: { source: Source; className?: string }) {
  return (
    <span
      title={PLATFORMS[source].name}
      className={clsx(
        'inline-flex size-[18px] shrink-0 items-center justify-center rounded-[5px] text-fs10 leading-none font-semibold',
        PLATFORMS[source].tone,
        className,
      )}
    >
      {PLATFORMS[source].mark}
    </span>
  )
}

export function watchTone(watch: WatchState) {
  if (watch.mode === 'off') return 'off'
  if (watch.mode === 'paused') return 'paused'
  if (watch.error) return 'error'
  return watch.mode === 'realtime' ? 'realtime' : 'poll'
}

export function watchShort(watch: WatchState) {
  return { off: '已禁用', paused: '已暂停', error: '异常', realtime: '实时', poll: '轮询' }[watchTone(watch)]
}

export function watchLabel(watch: WatchState) {
  if (watch.mode === 'off') return '会话已禁用：不再拉取新消息，已有消息保留'
  if (watch.mode === 'paused') return '已暂停监听，可在「设置 → 连接」中恢复'
  if (watch.error) return `异常：${watch.error}`
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
          (tone === 'realtime' || tone === 'poll') && 'bg-emerald-500',
          (tone === 'paused' || tone === 'off') && 'border border-stone-400 dark:border-stone-500',
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
