import { createContext, useCallback, useContext, useEffect, useRef, useState, type DependencyList } from 'react'
import type { AwaitingMessage, Config, Message, OverviewGroup, OverviewProject, Source } from './api'
import type { TaskSource } from './mock/tasks'

export interface GroupInfo extends OverviewGroup {
  project: string | null
  projectName: string | null
}

export interface SendTarget {
  group: number
  groupName: string
  source: Source
  replyTo?: Message
  text?: string
  ai?: boolean
  onSent?: () => void
}

export interface TaskDraft {
  title?: string
  project?: string | null
  source?: TaskSource | null
}

export interface DeckState {
  version: number
  bump: () => void
  config: Config | null
  overview: OverviewProject[] | null
  overviewError: string | null
  reloadOverview: () => void
  groups: GroupInfo[]
  awaiting: AwaitingMessage[] | null
  openSend: (target: SendTarget) => void
  openTask: (draft: TaskDraft) => void
  openSearch: () => void
  openAskAi: () => void
}

export const DeckContext = createContext<DeckState | null>(null)

export function useDeck() {
  const value = useContext(DeckContext)
  if (!value) throw new Error('DeckContext missing')
  return value
}

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
    text: message.text,
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
