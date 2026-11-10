import clsx from 'clsx'
import { X } from 'lucide-react'
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  return (
    <button
      {...props}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
        size === 'md' ? 'h-8 px-3 text-fs13' : 'h-7 px-2.5 text-fs12',
        variant === 'primary' && 'bg-accent-600 text-white hover:bg-accent-700',
        variant === 'secondary' &&
          'border border-stone-200 bg-white text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800',
        variant === 'ghost' && 'text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800',
        variant === 'danger' && 'bg-red-600 text-white hover:bg-red-700',
        className,
      )}
    />
  )
}

export function Dialog({
  open,
  title,
  onClose,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-stone-900/30 backdrop-blur-[2px] dark:bg-black/50" onClick={onClose} />
      <div
        role="dialog"
        aria-modal
        className={clsx(
          'relative flex max-h-[90vh] w-full flex-col rounded-t-2xl border border-stone-200 bg-white shadow-xl sm:rounded-2xl dark:border-stone-800 dark:bg-stone-900',
          width,
        )}
      >
        <div className="flex items-center justify-between border-b border-stone-100 px-5 py-3.5 dark:border-stone-800">
          <h2 className="text-fs15 font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800"
            aria-label="关闭"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="scroll-thin overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-stone-100 px-5 py-3 dark:border-stone-800">{footer}</div>
        )}
      </div>
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-fs13 font-medium text-stone-700 dark:text-stone-300">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-fs12 text-stone-500 dark:text-stone-400">{hint}</span>}
    </label>
  )
}

export const inputClass =
  'w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-fs14 outline-none placeholder:text-stone-400 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20 dark:border-stone-700 dark:bg-stone-950'

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: ReactNode
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative inline-flex h-[18px] w-8 shrink-0 rounded-full transition-colors',
          checked ? 'bg-accent-600' : 'bg-stone-300 dark:bg-stone-700',
        )}
      >
        <span
          className={clsx(
            'absolute top-[2px] size-[14px] rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-[16px]' : 'translate-x-[2px]',
          )}
        />
      </button>
      <span className="text-fs13 text-stone-700 dark:text-stone-300">{label}</span>
    </label>
  )
}

export function Chips<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T
  options: { id: T; label: ReactNode; count?: number }[]
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div className={clsx('no-scrollbar flex gap-1.5 overflow-x-auto', className)}>
      {options.map((option) => (
        <button
          key={option.id}
          onClick={() => onChange(option.id)}
          className={clsx(
            'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 text-fs12 font-medium transition-colors',
            value === option.id
              ? 'border-stone-900 bg-stone-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900'
              : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800',
          )}
        >
          {option.label}
          {option.count !== undefined && option.count > 0 && (
            <span className={clsx('tabular-nums', value === option.id ? 'opacity-70' : 'text-stone-400')}>
              {option.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

export function Tabs<T extends string>({
  value,
  options,
  hrefOf,
  className,
}: {
  value: T
  options: { id: T; label: ReactNode }[]
  hrefOf: (id: T) => string
  className?: string
}) {
  return (
    <nav className={clsx('no-scrollbar flex gap-1 overflow-x-auto', className)}>
      {options.map((option) => (
        <a
          key={option.id}
          href={hrefOf(option.id)}
          className={clsx(
            'relative shrink-0 px-2.5 pt-1.5 pb-2.5 text-fs13 font-medium transition-colors',
            value === option.id
              ? 'text-stone-900 after:absolute after:inset-x-2 after:bottom-0 after:h-[2px] after:rounded-full after:bg-accent-600 dark:text-stone-50'
              : 'text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200',
          )}
        >
          {option.label}
        </a>
      ))}
    </nav>
  )
}

export function Menu({
  trigger,
  items,
  align = 'right',
}: {
  trigger: (toggle: () => void) => ReactNode
  items: ({ label: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean } | 'divider')[]
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div ref={ref} className="relative">
      {trigger(() => setOpen((value) => !value))}
      {open && (
        <div
          className={clsx(
            'absolute top-full z-30 mt-1 min-w-36 rounded-lg border border-stone-200 bg-white p-1 shadow-lg shadow-stone-900/5 dark:border-stone-700 dark:bg-stone-900',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((item, index) =>
            item === 'divider' ? (
              <div key={index} className="my-1 h-px bg-stone-100 dark:bg-stone-800" />
            ) : (
              <button
                key={index}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false)
                  item.onClick()
                }}
                className={clsx(
                  'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-fs13 disabled:opacity-40',
                  item.danger
                    ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10'
                    : 'text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800',
                )}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  onConfirm,
  onClose,
  busy,
}: {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
  busy?: boolean
}) {
  return (
    <Dialog
      open={open}
      title={title}
      onClose={busy ? () => {} : onClose}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? '处理中…' : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-fs14 leading-relaxed text-stone-600 dark:text-stone-300">{children}</div>
    </Dialog>
  )
}
