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

/** 列表用：一天内相对时间，更早只显示日期。 */
export function listTime(iso: string) {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000
  if (seconds < 86400) return relative(iso)
  const date = new Date(iso)
  return date.getFullYear() === new Date().getFullYear()
    ? `${date.getMonth() + 1}月${date.getDate()}日`
    : `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
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

/** 截止日期「11月20日」，不是今年时带年份。 */
export function dueDate(day: string) {
  const [year, month, date] = day.split('-').map(Number)
  return year === new Date().getFullYear() ? `${month}月${date}日` : `${year}年${month}月${date}日`
}

export function fullTime(iso: string) {
  const date = new Date(iso)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clock(iso)}:${pad(date.getSeconds())}`
}

const attachmentLabels = { image: '[图片]', voice: '[语音]', video: '[视频]', file: '[文件]' } as const

/** 一行摘要：文字加附件类型和语音转写。 */
export function summarize(message: { text: string; attachments: { kind: keyof typeof attachmentLabels; transcript: string | null }[] }) {
  return [message.text, ...message.attachments.map((a) => attachmentLabels[a.kind] + (a.transcript ? ` ${a.transcript}` : ''))]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 版本号里常带完整 commit hash：卡片里只显示简短形式，完整内容放进详情。 */
export function shortVersion(version: string | null | undefined, max = 24) {
  if (!version) return '未知'
  // CLI 的 --version 常带命令名和构建 hash，只取版本号。
  const semver = version.match(/\bv?\d+\.\d+\.\d+(?:[-+][\w.]+)?/)
  if (semver) return semver[0]
  const text = version.trim().replace(/\b[0-9a-f]{12,}\b/gi, (hash) => hash.slice(0, 7))
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
