import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Page, PageHeader } from '../components/PageHeader'
import { TaskBoard } from '../components/TaskBoard'
import { Button, Select } from '../components/ui'
import { useTasks } from '../tasks'
import { useActions, useData } from '../state'

export function Tasks() {
  const { overview } = useData()
  const { openTask } = useActions()
  const tasks = useTasks()
  const [project, setProject] = useState('')
  const open = tasks.filter((task) => task.status !== 'done' && (!project || task.project === project)).length

  return (
    <Page
      wide
      header={
        <PageHeader
          title="任务"
          subtitle={`${open} 项未完成`}
          actions={
            <>
              <div className="max-md:hidden">
                <Select
                  field
                  value={project}
                  options={[{ id: '', label: '全部项目' }, ...(overview ?? []).map((p) => ({ id: p.key, label: p.name }))]}
                  onChange={setProject}
                  label="按项目筛选"
                  className="!h-8 !w-auto max-w-52 !text-fs13"
                />
              </div>
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
        <TaskBoard key={project} project={project || undefined} />
      </div>
    </Page>
  )
}
