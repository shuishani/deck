import type { Source } from './api'

/** 每个平台在界面上的全部差异都在这里；接入新平台时只改这里和后端 adapters。 */
export interface Platform {
  source: Source
  name: string
  /** 平台图标里的字。 */
  mark: string
  /** 收发消息用的命令行工具。 */
  cli: string
  /** 添加群时输入框的示例。 */
  example: string
  /** 以 AI 身份发送时，平台上显示的标注。 */
  aiMark: string
  /** 定时拉取（可调拉取间隔）；否则是实时推送为主。 */
  polls: boolean
  /** 平台图标配色。 */
  tone: string
}

export const PLATFORMS: Record<Source, Platform> = {
  dingtalk: {
    source: 'dingtalk',
    name: '钉钉',
    mark: '钉',
    cli: 'dws',
    example: 'management-x-dev-TEST',
    aiMark: '通过 AI 发送',
    polls: false,
    tone: 'bg-ding-100 text-ding-700 dark:bg-ding-500/20 dark:text-ding-100',
  },
  channel: {
    source: 'channel',
    name: 'channel',
    mark: 'C',
    cli: 'drlee',
    example: '测试dev-1023',
    aiMark: '拍档',
    polls: true,
    tone: 'bg-chan-100 text-chan-700 dark:bg-chan-500/20 dark:text-chan-100',
  },
}

export const SOURCES = Object.keys(PLATFORMS) as Source[]

export function sourceName(source: Source) {
  return PLATFORMS[source].name
}

export function isSource(value: unknown): value is Source {
  return typeof value === 'string' && value in PLATFORMS
}

/** 「钉钉显示「通过 AI 发送」，channel 显示「拍档」」 */
export function aiMarks(sources: Source[] = SOURCES) {
  return sources.map((s) => `${spaced(PLATFORMS[s].name)}显示「${PLATFORMS[s].aiMark}」`).join('，')
}

/** 拉丁字母结尾的名称后接中文时加空格。 */
function spaced(name: string) {
  return /[A-Za-z0-9]$/.test(name) ? `${name} ` : name
}
