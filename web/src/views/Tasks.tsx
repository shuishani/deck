import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Page, PageHeader } from '../components/PageHeader'
import { MockNotice, TaskBoard } from '../components/TaskBoard'
import { Button, inputClass } from '../components/ui'
import { useTasks } from '../mock/tasks'
import { useDeck } from '../state'

export function Tasks() {
  const { overview, openTask } = useDeck()
  const tasks = useTasks()
  const [project, setProject] = useState('')
  const open = tasks.filter((task) => task.status !== 'done' && (!project || task.project === project)).length

  return (
    <Page
      wide
      header={
        <PageHeader
          title="任务"
          subtitle={`${open} 件未完成`}
          actions={
            <>
              <select
                value={project}
                onChange={(event) => setProject(event.target.value)}
                className={`${inputClass} !h-8 !w-auto !py-0 text-fs13 max-md:hidden`}
              >
                <option value="">全部项目</option>
                {overview?.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name}
                  </option>
                ))}
              </select>
              <Button variant="primary" onClick={() => openTask({ project: project || null })}>
                <Plus className="size-3.5" />
                <span className="max-md:hidden">新建任务</span>
              </Button>
            </>
          }
        />
      }
    >
      <div className="space-y-4">
        <MockNotice />
        <TaskBoard key={project} project={project || undefined} />
      </div>
    </Page>
  )
}
