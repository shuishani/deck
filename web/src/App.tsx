import { useEffect, useMemo, useState } from 'react'
import { api } from './api'
import { AskAiDrawer } from './components/AskAiDrawer'
import { CommandPalette } from './components/CommandPalette'
import { SendDialog } from './components/SendDialog'
import { MobileTabs, Sidebar } from './components/Sidebar'
import { TaskDialog } from './components/TaskDialog'
import { useRoute } from './router'
import { DeckContext, flattenGroups, useLoad, type DeckState, type SendTarget, type TaskDraft } from './state'
import { Inbox } from './views/Inbox'
import { Messages } from './views/Messages'
import { ProjectHome } from './views/ProjectHome'
import { Projects } from './views/Projects'
import { Settings } from './views/Settings'
import { Tasks } from './views/Tasks'

export default function App() {
  const route = useRoute()
  const [version, setVersion] = useState(0)
  const [local, setLocal] = useState(0)
  const [sendTarget, setSendTarget] = useState<SendTarget | null>(null)
  const [taskDraft, setTaskDraft] = useState<TaskDraft | null>(null)
  const [searching, setSearching] = useState(false)
  const [asking, setAsking] = useState(false)

  useEffect(() => {
    let alive = true
    const tick = () =>
      api
        .version()
        .then(({ version }) => alive && setVersion((current) => (current === version ? current : version)))
        .catch(() => {})
    void tick()
    const timer = setInterval(tick, 3000)
    return () => {
      alive = false
      clearInterval(timer)
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

  const stamp = version * 1000 + local
  const config = useLoad(() => api.config(), [])
  const overview = useLoad(() => api.overview(), [stamp])
  const awaiting = useLoad(() => api.awaiting(), [stamp])

  const state = useMemo<DeckState>(
    () => ({
      version: stamp,
      bump: () => setLocal((n) => n + 1),
      config: config.data,
      overview: overview.data?.projects ?? null,
      overviewError: overview.error,
      reloadOverview: overview.reload,
      groups: flattenGroups(overview.data?.projects ?? null),
      awaiting: awaiting.data?.messages ?? null,
      openSend: setSendTarget,
      openTask: setTaskDraft,
      openSearch: () => setSearching(true),
      openAskAi: () => setAsking(true),
    }),
    [stamp, config.data, overview.data, overview.error, overview.reload, awaiting.data],
  )

  return (
    <DeckContext.Provider value={state}>
      <div className="flex h-dvh">
        <Sidebar route={route} />
        <main className="flex min-w-0 flex-1 flex-col max-md:pb-[calc(64px+env(safe-area-inset-bottom))]">
          {route.name === 'inbox' && <Inbox />}
          {route.name === 'messages' && <Messages group={route.group} />}
          {route.name === 'tasks' && <Tasks />}
          {route.name === 'projects' && <Projects />}
          {route.name === 'project' && <ProjectHome key={route.key} projectKey={route.key} tab={route.tab} />}
          {route.name === 'settings' && <Settings tab={route.tab} />}
        </main>
      </div>
      <MobileTabs route={route} />
      <SendDialog target={sendTarget} onClose={() => setSendTarget(null)} />
      <TaskDialog draft={taskDraft} onClose={() => setTaskDraft(null)} />
      <CommandPalette open={searching} onClose={() => setSearching(false)} />
      <AskAiDrawer open={asking} onClose={() => setAsking(false)} />
    </DeckContext.Provider>
  )
}
