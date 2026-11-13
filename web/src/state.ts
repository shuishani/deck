import { createContext, useCallback, useContext, useEffect, useRef, useState, type DependencyList } from 'react'
import { RECONNECTED_EVENT } from './connection'
import { summarize } from './format'
import type { AttentionMessage, Config, Message, OverviewGroup, OverviewProject, Task, TaskSource, VersionParts } from './api'

export interface GroupInfo extends OverviewGroup {
  project: string | null
  projectName: string | null
}

export interface ReplyDraft {
  group: number
  replyTo: Message
  /** 发出后把这条标为已处理 */
  handle?: number
  /** 修改 replyTo 这条自己发的消息，而不是回复它 */
  edit?: boolean
  /** AI 起草的内容：只填进输入框，仍需用户审核并走预览确认 */
  initialText?: string
  /** 起草内容按「以 AI 身份」发送 */
  ai?: boolean
}

export interface TaskDraft {
  title?: string
  project?: string | null
  source?: TaskSource | null
  /** 已挂着全部这些消息的任务，加入已有任务时标为已包含。 */
  linked?: number[]
  /** 多选时除来源外的其余消息。 */
  extra?: Message[]
}

/** 服务端数据：有新数据时才变。 */
export interface DeckData {
  /** 任一类数据变了就变（不含监听状态）；只关心某一类时用 versions。 */
  version: string
  versions: Record<keyof VersionParts, string>
  /** 只在有新日志（或本地操作）时变，日志页用它刷新，不必跟着每条新消息重载。 */
  auditVersion: string
  config: Config | null
  overview: OverviewProject[] | null
  overviewError: string | null
  reloadOverview: () => void
  groups: GroupInfo[]
  attention: AttentionMessage[] | null
  tasks: Task[] | null
  tasksError: string | null
}

/** 全局操作：引用始终不变，只用操作的组件不会因数据或界面状态变化而重渲染。 */
export interface DeckActions {
  /** 本地改了数据后调用：全部重新拉取。 */
  bump: () => void
  openReply: (draft: ReplyDraft) => void
  clearReply: () => void
  openTask: (draft: TaskDraft) => void
  openTaskDetail: (id: number) => void
  setPicking: (messages: Message[] | null) => void
  openSearch: () => void
  openAskAi: () => void
}

/** 跨页面的界面状态。 */
export interface DeckUi {
  reply: ReplyDraft | null
  /** 多选消息：null 表示没在选。可跨群选，切换群时保留。 */
  picking: Message[] | null
}

export const DataContext = createContext<DeckData | null>(null)
export const ActionsContext = createContext<DeckActions | null>(null)
export const UiContext = createContext<DeckUi | null>(null)

function required<T>(value: T | null, name: string): T {
  if (!value) throw new Error(`${name} missing`)
  return value
}

export const useData = () => required(useContext(DataContext), 'DataContext')
export const useActions = () => required(useContext(ActionsContext), 'ActionsContext')
export const useUi = () => required(useContext(UiContext), 'UiContext')

export function flattenGroups(projects: OverviewProject[] | null): GroupInfo[] {
  return (projects ?? []).flatMap((project) =>
    project.groups.map((group) => ({ ...group, project: project.key, projectName: project.name })),
  )
}

export function taskSource(message: Message): TaskSource {
  return {
    group_id: message.group_id,
    group_name: message.group_name,
    message_id: message.id,
    sender_name: message.sender_name,
    text: summarize(message),
  }
}

/** 按时间排，最早的一条作为来源；标题取第一条有文字的。 */
export function taskDraftFrom(messages: Message[], project: string | null): TaskDraft {
  const sorted = [...messages].sort((a, b) => a.sent_at.localeCompare(b.sent_at) || a.id - b.id)
  const [first, ...rest] = sorted
  const common = sorted.map((m) => new Set(m.tasks?.map((t) => t.id) ?? []))
  return {
    title: taskTitle(sorted.find((m) => m.text.trim())?.text ?? ''),
    project,
    source: taskSource(first),
    linked: [...common[0]].filter((id) => common.every((set) => set.has(id))),
    extra: rest.length ? rest : undefined,
  }
}

export function taskTitle(text: string) {
  const line = text.split('\n').map((part) => part.trim()).find(Boolean) ?? ''
  const cleaned = line.replace(/^@\S+\s*/, '')
  return cleaned.length > 40 ? `${cleaned.slice(0, 40)}…` : cleaned
}

export function useLoad<T>(load: () => Promise<T>, deps: DependencyList) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const latest = useRef(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps)

  const reload = useCallback(async () => {
    const ticket = ++latest.current
    try {
      const value = await run()
      if (ticket !== latest.current) return
      setData(value)
      setError(null)
    } catch (err) {
      if (ticket !== latest.current) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (ticket === latest.current) setLoading(false)
    }
  }, [run])

  useEffect(() => {
    void reload()
    const reconnect = () => { void reload() }
    window.addEventListener(RECONNECTED_EVENT, reconnect)
    return () => window.removeEventListener(RECONNECTED_EVENT, reconnect)
  }, [reload])

  return { data, error, loading: loading && data === null, reload, setData }
}

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const onChange = () => setMatches(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [query])
  return matches
}

export const useDesktop = () => useMediaQuery('(min-width: 768px)')
