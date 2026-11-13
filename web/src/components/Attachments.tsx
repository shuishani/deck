import clsx from 'clsx'
import { Download, FileText, ImageOff, Loader2, Pause, Play, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { mediaUrl, type Attachment } from '../api'

export function Attachments({ message, items, mine }: { message: number; items: Attachment[]; mine?: boolean }) {
  if (!items.length) return null
  return (
    <div className={clsx('flex flex-col gap-1.5', mine ? 'items-end' : 'items-start')}>
      {items.map((item, index) => {
        const url = mediaUrl(message, index)
        if (item.kind === 'image') return <ImageAttachment key={index} item={item} url={url} />
        if (item.kind === 'voice') return <VoiceAttachment key={index} item={item} url={url} mine={mine} />
        if (item.kind === 'video')
          return <video key={index} src={url} controls preload="metadata" className="max-h-72 max-w-[280px] rounded-xl bg-black" />
        return <FileAttachment key={index} item={item} url={url} />
      })}
    </div>
  )
}

function ImageAttachment({ item, url }: { item: Attachment; url: string }) {
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)
  const ratio = item.width && item.height ? item.width / item.height : undefined

  if (failed) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="flex h-24 w-40 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-stone-300 text-fs12 text-stone-400 dark:border-stone-700"
      >
        <ImageOff className="size-5" />
        图片加载失败
      </a>
    )
  }
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="block overflow-hidden rounded-xl border border-stone-200 bg-stone-100 dark:border-stone-800 dark:bg-stone-800"
        style={ratio ? { aspectRatio: ratio, width: ratio >= 1 ? 240 : Math.max(120, 240 * ratio) } : undefined}
        aria-label="查看大图"
      >
        <img
          src={url}
          alt={item.name || '图片'}
          loading="lazy"
          onError={() => setFailed(true)}
          className={clsx('block max-h-60 max-w-[240px] object-cover', ratio && 'size-full')}
        />
      </button>
      {open && <Lightbox url={url} name={item.name} onClose={() => setOpen(false)} />}
    </>
  )
}

function Lightbox({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4" onClick={onClose}>
      <img src={url} alt={name || '图片'} className="max-h-full max-w-full rounded-lg object-contain" />
      <div className="absolute top-3 right-3 flex gap-2">
        <a
          href={url}
          download={name || true}
          onClick={(event) => event.stopPropagation()}
          className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          aria-label="下载"
        >
          <Download className="size-5" />
        </a>
        <button onClick={onClose} className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20" aria-label="关闭">
          <X className="size-5" />
        </button>
      </div>
    </div>
  )
}

function VoiceAttachment({ item, url, mine }: { item: Attachment; url: string; mine?: boolean }) {
  const audio = useRef<HTMLAudioElement>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle')
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(item.duration_ms ? item.duration_ms / 1000 : 0)

  function toggle() {
    const el = audio.current
    if (!el) return
    if (state === 'playing') {
      el.pause()
      return
    }
    setState('loading')
    el.play().catch(() => setState('error'))
  }

  return (
    <div className={clsx('flex max-w-[280px] flex-col gap-1', mine ? 'items-end' : 'items-start')}>
      <div
        className={clsx(
          'flex w-52 items-center gap-2.5 rounded-full py-1.5 pr-3.5 pl-1.5',
          mine ? 'bg-accent-100 dark:bg-accent-700/30' : 'border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900',
        )}
      >
        <button
          onClick={toggle}
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900"
          aria-label={state === 'playing' ? '暂停' : '播放语音'}
        >
          {state === 'loading' ? (
            <Loader2 className="size-4 animate-spin" />
          ) : state === 'playing' ? (
            <Pause className="size-4" />
          ) : (
            <Play className="size-4 translate-x-px" />
          )}
        </button>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-stone-300/70 dark:bg-stone-700">
          <div className="h-full rounded-full bg-stone-700 dark:bg-stone-300" style={{ width: `${progress * 100}%` }} />
        </div>
        <span className="shrink-0 text-fs12 text-stone-500 tabular-nums">{duration ? seconds(duration) : ''}</span>
        <audio
          ref={audio}
          src={url}
          preload="none"
          onPlaying={() => setState('playing')}
          onPause={() => setState('idle')}
          onEnded={() => {
            setState('idle')
            setProgress(0)
          }}
          onError={() => setState('error')}
          onLoadedMetadata={(event) => Number.isFinite(event.currentTarget.duration) && setDuration(event.currentTarget.duration)}
          onTimeUpdate={(event) => {
            const el = event.currentTarget
            if (el.duration) setProgress(el.currentTime / el.duration)
          }}
        />
      </div>
      {state === 'error' && (
        <a href={url} download className="text-fs12 text-red-600 hover:underline dark:text-red-400">
          当前浏览器无法播放，点击下载
        </a>
      )}
      {(item.transcript || item.transcribing) && (
        <p className="px-1 text-fs12 leading-relaxed text-stone-500 dark:text-stone-400">
          {item.transcript ?? '转写中…'}
        </p>
      )}
    </div>
  )
}

function FileAttachment({ item, url }: { item: Attachment; url: string }) {
  return (
    <a
      href={url}
      download={item.name || true}
      className="flex w-64 items-center gap-3 rounded-xl border border-stone-200 bg-white px-3 py-2.5 transition-colors hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-900 dark:hover:bg-stone-800"
    >
      <FileText className="size-8 shrink-0 text-stone-400" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-fs13 font-medium">{item.name || '文件'}</span>
        <span className="text-fs11 text-stone-400">{item.size ? bytes(item.size) : '点击下载'}</span>
      </span>
      <Download className="size-4 shrink-0 text-stone-400" />
    </a>
  )
}

function seconds(value: number) {
  const total = Math.max(1, Math.round(value))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function bytes(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}
