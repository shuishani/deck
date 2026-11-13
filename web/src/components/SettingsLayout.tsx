import clsx from 'clsx'
import { RotateCcw } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { api } from '../api'
import { useActions } from '../state'
import { useToast } from './Toast'

/** 区块标题：全站统一，标题 + 说明 + 右侧操作。 */
export function SectionHeader({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-fs15 font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-fs12 leading-relaxed text-stone-500 dark:text-stone-400">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

/** 设置页的一块：标题、说明，下面是一张分行的卡片。 */
export function Section({ title, description, action, children, className }: {
  title: string
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={className}>
      <SectionHeader title={title} description={description} action={action} />
      <div className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm shadow-stone-900/[0.02] dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
        {children}
      </div>
    </section>
  )
}

/** 一行设置：左边名称和说明，右边控件；手机上或 stacked 时上下排。 */
export function SettingRow({ label, hint, badge, stacked, children, className }: {
  label: ReactNode
  hint?: ReactNode
  badge?: ReactNode
  stacked?: boolean
  children?: ReactNode
  className?: string
}) {
  return (
    <div className={clsx('flex flex-col gap-3 px-4 py-4', !stacked && 'sm:flex-row sm:items-center sm:gap-8', className)}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-fs14 font-medium text-stone-800 dark:text-stone-100">{label}</span>
          {badge}
        </div>
        {hint && <p className="mt-1 text-fs12 leading-relaxed text-stone-500 dark:text-stone-400">{hint}</p>}
      </div>
      {children && <div className={clsx('shrink-0', !stacked && 'sm:max-w-[60%]')}>{children}</div>}
    </div>
  )
}

/** 改过的设置：「已修改」标记和恢复默认。 */
export function Modified({ defaultText, onReset, disabled }: { defaultText: string; onReset: () => void; disabled?: boolean }) {
  return (
    <>
      <span className="rounded-full bg-amber-50 px-2 text-fs11 leading-[18px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
        已修改
      </span>
      <button
        onClick={onReset}
        disabled={disabled}
        className="inline-flex items-center gap-1 text-fs12 text-stone-500 hover:text-stone-800 disabled:opacity-50 dark:hover:text-stone-200"
      >
        <RotateCcw className="size-3" />
        恢复默认 {defaultText}
      </button>
    </>
  )
}

/** 卡片底部的保存条：有改动时出现。 */
export function SaveBar({ busy, disabled, error, onCancel, onSave }: {
  busy: boolean
  disabled?: boolean
  error?: string | null
  onCancel: () => void
  onSave: () => void
}) {
  return (
    <div className="flex items-center gap-2 bg-stone-50 px-4 py-2.5 dark:bg-stone-800/40">
      <p className={clsx('min-w-0 flex-1 text-fs12', error ? 'text-red-600 dark:text-red-400' : 'text-stone-500')}>{error ?? '有未保存的修改'}</p>
      <button onClick={onCancel} disabled={busy} className="h-7 rounded-md px-2.5 text-fs12 font-medium text-stone-600 hover:bg-stone-200/60 dark:text-stone-300 dark:hover:bg-stone-700">
        还原
      </button>
      <button
        onClick={onSave}
        disabled={busy || disabled}
        className="h-7 rounded-md bg-accent-600 px-3 text-fs12 font-medium text-white hover:bg-accent-700 disabled:opacity-50"
      >
        {busy ? '保存中…' : '保存'}
      </button>
    </div>
  )
}

export const numberInput =
  'h-8 w-20 rounded-lg border border-stone-200 bg-white px-2.5 text-right text-fs13 text-stone-900 tabular-nums outline-none dark:text-stone-100 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20 dark:border-stone-700 dark:bg-stone-950'

/** 保存设置：成功后提示并刷新，失败把原因留给保存条显示。 */
export function useSettingsSave() {
  const { bump } = useActions()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function save(body: Parameters<typeof api.updateConfig>[0], done: string) {
    setBusy(true)
    setError(null)
    try {
      await api.updateConfig(body)
      toast(done)
      bump()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      setBusy(false)
    }
  }
  return { save, busy, error, setError }
}
