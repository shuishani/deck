import clsx from 'clsx'

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={clsx('shrink-0', className)} aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-stone-900 dark:fill-stone-100" />
      <rect x="10.5" y="7.5" width="11" height="3" rx="1.5" className="fill-stone-50/30 dark:fill-stone-900/30" />
      <rect x="8.5" y="11.5" width="15" height="3" rx="1.5" className="fill-stone-50/55 dark:fill-stone-900/55" />
      <rect x="6.5" y="15.5" width="19" height="9" rx="2.5" className="fill-accent-500" />
    </svg>
  )
}
