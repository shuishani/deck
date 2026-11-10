import clsx from 'clsx'

const TONES = 6

function hash(text: string) {
  let value = 0
  for (const char of text) value = (value * 31 + char.codePointAt(0)!) | 0
  return Math.abs(value)
}

export function toneClass(name: string) {
  return `tone-${hash(name) % TONES}`
}

export function Avatar({ name, me, size = 'md' }: { name: string; me?: boolean; size?: 'sm' | 'md' }) {
  const initial = [...(name.trim() || '?')][0].toUpperCase()
  return (
    <span
      className={clsx(
        'inline-flex shrink-0 items-center justify-center rounded-full font-medium select-none',
        size === 'md' ? 'size-8 text-fs13' : 'size-6 text-fs11',
        me ? 'bg-stone-800 text-stone-50 dark:bg-stone-200 dark:text-stone-900' : toneClass(name),
      )}
      aria-hidden
    >
      {initial}
    </span>
  )
}
