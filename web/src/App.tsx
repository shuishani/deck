import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, type Message, type VersionParts } from './api'
import { RECONNECTED_EVENT, startPolling, type ConnectionState } from './connection'
import { AskAiDrawer } from './components/AskAiDrawer'
import { CommandPalette } from './components/CommandPalette'
import { MobileTabs, Sidebar } from './components/Sidebar'
import { TaskDetail } from './components/TaskDetail'
import { TaskDialog } from './components/TaskDialog'
import { navigate, useRoute } from './router'
import {
  ActionsContext,
  DataContext,
  UiContext,
  flattenGroups,
  useLoad,
  useMediaQuery,
  type DeckActions,
  type DeckData,
  type DeckUi,
  type ReplyDraft,
  type TaskDraft,
} from './state'
import { LogPage } from './views/Log'
import { Messages } from './views/Messages'
import { ProjectHome } from './views/ProjectHome'
import { Projects } from './views/Projects'
import { Settings } from './views/settings/Settings'
import { Tasks } from './views/Tasks'

const NO_PARTS: VersionParts = { messages: '', groups: '', tasks: '', config: '', health: '' }

function sameParts(a: VersionParts, b: VersionParts) {
  return (Object.keys(a) as (keyof VersionParts)[]).every((key) => a[key] === b[key])
}

export default function App() {
  const route = useRoute()
  const mobile = useMediaQuery('(max-width: 767px)')
  const [parts, setParts] = useState<VersionParts>(NO_PARTS)
  const [audit, setAudit] = useState(0)
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const [local, setLocal] = useState(0)
  const [reply, setReply] = useState<ReplyDraft | null>(null)
  const [taskDraft, setTaskDraft] = useState<TaskDraft | null>(null)
  const [taskDetail, setTaskDetail] = useState<number | null>(null)
  const [picking, setPicking] = useState<Message[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [asking, setAsking] = useState(false)

  useEffect(() => {
    const poll = startPolling({
      probe: (signal) => api.version(signal),
      onState: setConnection,
      onValue: ({ parts: next, audit }, recovered) => {
        setParts((current) => (sameParts(current, next) ? current : next))
        setAudit(audit)
        if (recovered) window.dispatchEvent(new Event(RECONNECTED_EVENT))
      },
    })
    const wake = () => { if (document.visibilityState === 'visible') poll.wake() }
    const offline = () => poll.disconnect()
    window.addEventListener('online', wake)
    window.addEventListener('offline', offline)
    window.addEventListener('focus', wake)
    document.addEventListener('visibilitychange', wake)
    return () => {
      poll.stop()
      window.removeEventListener('online', wake)
      window.removeEventListener('offline', offline)
      window.removeEventListener('focus', wake)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearching((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 各类数据只在自己的版本变了时重拉；本地操作（bump）一律全部刷新。
  const versions = useMemo(
    () => Object.fromEntries(Object.entries(parts).map(([key, value]) => [key, `${value}:${local}`])) as Record<keyof VersionParts, string>,
    [parts, local],
  )
  const stamp = `${parts.messages}:${parts.groups}:${parts.tasks}:${parts.config}:${local}`
  const config = useLoad(() => api.config(), [versions.config])
  const overview = useLoad(() => api.overview(), [versions.messages, versions.groups, versions.health])
  const attention = useLoad(() => api.attention(), [versions.messages, versions.groups, versions.config])
  const tasks = useLoad(() => api.tasks(), [versions.tasks])

  const data = useMemo<DeckData>(
    () => ({
      version: stamp,
      versions,
      auditVersion: `${audit}:${local}`,
      config: config.data,
      overview: overview.data?.projects ?? null,
      overviewError: overview.error,
      reloadOverview: overview.reload,
      groups: flattenGroups(overview.data?.projects ?? null),
      attention: attention.data?.messages ?? null,
      tasks: tasks.data?.tasks ?? null,
      tasksError: tasks.error,
    }),
    [stamp, versions, audit, local, config.data, overview.data, overview.error, overview.reload, attention.data, tasks.data, tasks.error],
  )
  // 只用到 setState，引用永远不变。
  const actions = useMemo<DeckActions>(
    () => ({
      bump: () => setLocal((n) => n + 1),
      openReply: (draft: ReplyDraft) => {
        setReply(draft)
        navigate({ name: 'messages', group: draft.group })
      },
      clearReply: () => setReply(null),
      openTask: setTaskDraft,
      openTaskDetail: setTaskDetail,
      setPicking,
      openSearch: () => setSearching(true),
      openAskAi: () => setAsking(true),
    }),
    [],
  )
  const ui = useMemo<DeckUi>(() => ({ reply, picking }), [reply, picking])

  return (
    <DeckProvider actions={actions} data={data} ui={ui}>
      <div className="flex h-dvh">
        <Sidebar route={route} />
        <main className="flex min-w-0 flex-1 flex-col max-md:pb-[calc(64px+env(safe-area-inset-bottom))]">
          {connection !== 'online' && (
            <div role="status" className="flex shrink-0 items-center justify-between gap-2 bg-amber-50 px-4 py-2 text-fs12 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <span>{connection === 'connecting' ? '正在连接 deck…' : '网络暂时中断，正在自动重连；登录和未发送内容会保留'}</span>
              <button onClick={() => window.dispatchEvent(new Event('online'))} className="shrink-0 underline">立即重试</button>
            </div>
          )}
          {route.name === 'messages' && <Messages group={route.group} anchor={route.anchor} />}
          {route.name === 'tasks' && <Tasks />}
          {route.name === 'projects' && <Projects />}
          {route.name === 'project' && <ProjectHome key={route.key} projectKey={route.key} tab={route.tab} />}
          {route.name === 'log' && (mobile ? <Settings tab="log" /> : <LogPage />)}
          {route.name === 'settings' && <Settings tab={route.tab} source={route.source} />}
        </main>
      </div>
      <MobileTabs route={route} />
      <TaskDialog draft={taskDraft} onClose={() => setTaskDraft(null)} />
      <TaskDetail id={taskDetail} onClose={() => setTaskDetail(null)} />
      <CommandPalette open={searching} onClose={() => setSearching(false)} />
      <AskAiDrawer open={asking} onClose={() => setAsking(false)} />
    </DeckProvider>
  )
}

function DeckProvider({ actions, data, ui, children }: { actions: DeckActions; data: DeckData; ui: DeckUi; children: ReactNode }) {
  return (
    <ActionsContext.Provider value={actions}>
      <DataContext.Provider value={data}>
        <UiContext.Provider value={ui}>{children}</UiContext.Provider>
      </DataContext.Provider>
    </ActionsContext.Provider>
  )
}
