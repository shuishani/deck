import { FolderGit2, FolderKanban, Inbox, ListTodo, MessagesSquare, Plus } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { OverviewProject } from '../api'
import { toneClass } from '../components/Avatar'
import { CardSkeleton, EmptyState, ErrorBar } from '../components/Feedback'
import { Page, PageHeader } from '../components/PageHeader'
import { ProjectDialog } from '../components/ProjectDialog'
import { CountBadge, SourceBadge } from '../components/SourceBadge'
import { Button } from '../components/ui'
import { useTasks } from '../tasks'
import { href } from '../router'
import { useData } from '../state'
import { RepoPath } from '../components/Tags'

export function Projects() {
  const { overview, overviewError, reloadOverview } = useData()
  const [creating, setCreating] = useState(false)

  return (
    <Page
      header={
        <PageHeader
          title="项目"
          subtitle={overview ? `${overview.length} 个项目` : undefined}
          actions={
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-3.5" />
              <span className="max-md:hidden">新建项目</span>
            </Button>
          }
        />
      }
    >
      {overviewError && <ErrorBar message={overviewError} onRetry={reloadOverview} />}
      {!overview && !overviewError && <CardSkeleton rows={3} />}
      {overview?.length === 0 && (
        <EmptyState
          icon={<FolderKanban className="size-5" />}
          title="暂无项目"
          hint="项目用于集中管理相关的群、仓库和任务。请先创建项目，再添加群。"
          action={
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-3.5" />
              新建项目
            </Button>
          }
        />
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {overview?.map((project) => (
          <ProjectCard key={project.key} project={project} />
        ))}
      </div>
      <ProjectDialog open={creating} onClose={() => setCreating(false)} />
    </Page>
  )
}

function ProjectCard({ project }: { project: OverviewProject }) {
  const tasks = useTasks().filter((task) => task.project === project.key && task.status !== 'done')
  return (
    <a
      href={href({ name: 'project', key: project.key, tab: 'overview' })}
      className="group flex flex-col rounded-xl border border-stone-200 bg-white p-4 transition-all hover:border-stone-300 hover:shadow-sm dark:border-stone-800 dark:bg-stone-900 dark:hover:border-stone-700"
    >
      <div className="flex items-start gap-3">
        <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg text-fs14 font-bold ${toneClass(project.name)}`}>
          {[...project.name][0]?.toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="min-w-0 truncate font-semibold group-hover:text-accent-700 dark:group-hover:text-accent-500" title={project.name}>
              {project.name}
            </h3>
            <span className="shrink-0 rounded bg-stone-100 px-1.5 font-mono text-fs11 text-stone-500 dark:bg-stone-800">{project.key}</span>
          </div>
          {project.repo ? (
            <p className="mt-0.5 flex min-w-0 items-center gap-1 font-mono text-fs11 text-stone-500">
              <FolderGit2 className="size-3 shrink-0" />
              <RepoPath path={project.repo} />
            </p>
          ) : (
            <p className="mt-0.5 text-fs12 text-stone-400">未关联仓库</p>
          )}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-stone-100 pt-3 text-fs12 dark:border-stone-800">
        <Stat icon={<MessagesSquare className="size-3.5" />} label="群" value={project.groups.length} />
        <Stat icon={<Inbox className="size-3.5" />} label="需回复" value={project.awaiting_count} alert />
        <Stat icon={<ListTodo className="size-3.5" />} label="任务" value={tasks.length} />
      </div>
      {project.groups.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {project.groups.map((group) => (
            <span
              key={group.id}
              className="inline-flex max-w-full items-center gap-1 truncate rounded-md bg-stone-50 py-0.5 pr-1.5 pl-0.5 text-fs11 text-stone-600 dark:bg-stone-800/60 dark:text-stone-300"
            >
              <SourceBadge source={group.source} className="!size-4 !text-fs9" />
              <span className="truncate">{group.name}</span>
              <CountBadge count={group.awaiting_count} className="!h-4 !min-w-4 !text-fs10" />
            </span>
          ))}
        </div>
      )}
    </a>
  )
}

function Stat({ icon, label, value, alert }: { icon: ReactNode; label: string; value: number; alert?: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-1 text-stone-400">
        {icon}
        {label}
      </div>
      <div className={`mt-0.5 text-fs16 font-semibold tabular-nums ${alert && value ? 'text-red-600 dark:text-red-400' : ''}`}>
        {value}
      </div>
    </div>
  )
}
