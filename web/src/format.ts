const pad = (n: number) => String(n).padStart(2, '0')

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function dayDiff(date: Date, now = new Date()) {
  return Math.round((startOfDay(now).getTime() - startOfDay(date).getTime()) / 86_400_000)
}

export function clock(iso: string) {
  const date = new Date(iso)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function shortTime(iso: string | null | undefined) {
  if (!iso) return '—'
  const date = new Date(iso)
  if (dayDiff(date) === 0) return clock(iso)
  return `${date.getMonth() + 1}月${date.getDate()}日 ${clock(iso)}`
}

export function dayLabel(iso: string) {
  const date = new Date(iso)
  const diff = dayDiff(date)
  if (diff === 0) return '今天'
  if (diff === 1) return '昨天'
  const sameYear = date.getFullYear() === new Date().getFullYear()
  const label = `${date.getMonth() + 1}月${date.getDate()}日`
  return sameYear ? label : `${date.getFullYear()}年${label}`
}

export function dayKey(iso: string) {
  const date = new Date(iso)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

export function relative(iso: string | null | undefined) {
  if (!iso) return '从未'
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return '刚刚'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`
  return shortTime(iso)
}

export function waiting(minutes: number) {
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    const rest = minutes % 60
    return rest && hours < 3 ? `${hours} 小时 ${rest} 分` : `${hours} 小时`
  }
  return `${Math.floor(hours / 24)} 天`
}

export function fullTime(iso: string) {
  const date = new Date(iso)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clock(iso)}:${pad(date.getSeconds())}`
}
