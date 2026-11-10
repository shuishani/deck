import clsx from 'clsx'
import { CalendarDays, Info, MessageSquare, MoreHorizontal, Plus } from 'lucide-react'
import { useState } from 'react'
import { ConfirmDialog, Menu } from './ui'
import { AiTag, ProjectTag } from './Tags'
import { isOverdue, priorities, removeTask, statuses, updateTask, useTasks, type Task, type TaskStatus } from '../mock/tasks'
import { href } from '../router'
import { useDeck } from '../state'

export function MockNotice() {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-fs12 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300">
      <Info className="size-3.5 shrink-0" />
      示例数据：任务后端还没接，数据只存在这个浏览器里。
    </div>
  )
}

export function TaskBoard({ project }: { project?: string }) {
  const tasks = useTasks()
  const { openTask } = useDeck()
  const [column, setColumn] = useState<TaskStatus>('todo')
  const shown = project ? tasks.filter((task) => task.project === project) : tasks

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-1 rounded-lg bg-stone-100 p-1 md:hidden dark:bg-stone-800/60">
        {statuses.map((status) => (
          <button
            key={status.id}
            onClick={() => setColumn(status.id)}
            className={clsx(
              'rounded-md py-1.5 text-fs12 font-medium',
              column === status.id ? 'bg-white shadow-sm dark:bg-stone-900' : 'text-stone-500',
            )}
          >
            {status.label}
            <span className="ml-1 text-stone-400 tabular-nums">{shown.filter((t) => t.status === status.id).length}</span>
          </button>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        {statuses.map((status) => {
          const items = shown.filter((task) => task.status === status.id)
          return (
            <section
              key={status.id}
              className={clsx(
                'flex min-h-40 flex-col rounded-xl bg-stone-100/70 p-2 dark:bg-stone-900/60',
                column !== status.id && 'max-md:hidden',
              )}
            >
              <header className="flex items-center gap-2 px-1.5 pt-0.5 pb-2">
                <StatusIcon status={status.id} />
                <h3 className="text-fs13 font-semibold">{status.label}</h3>
                <span className="text-fs12 text-stone-400 tabular-nums">{items.length}</span>
                {status.id === 'todo' && (
                  <button
                    onClick={() => openTask({ project: project ?? null })}
                    className="ml-auto rounded-md p-1 text-stone-400 hover:bg-white hover:text-stone-600 dark:hover:bg-stone-800"
                    aria-label="新建任务"
                  >
                    <Plus className="size-3.5" />
                  </button>
                )}
              </header>
              <div className="space-y-2">
                {items.map((task) => (
                  <TaskCard key={task.id} task={task} showProject={!project} />
                ))}
                {items.length === 0 && <p className="px-2 py-6 text-center text-fs12 text-stone-400">暂无</p>}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

function StatusIcon({ status }: { status: TaskStatus }) {
  return (
    <span
      className={clsx(
        'size-2.5 rounded-full border-2',
        status === 'todo' && 'border-stone-400',
        status === 'doing' && 'border-amber-500 bg-amber-500/30',
        status === 'review' && 'border-sky-600 bg-sky-600/30',
        status === 'done' && 'border-emerald-500 bg-emerald-500',
      )}
    />
  )
}

function TaskCard({ task, showProject }: { task: Task; showProject: boolean }) {
  const { overview } = useDeck()
  const [confirming, setConfirming] = useState(false)
  const priority = priorities.find((p) => p.id === task.priority)!
  const projectName = overview?.find((p) => p.key === task.project)?.name ?? task.project
  const overdue = isOverdue(task)

  return (
    <article className="group rounded-lg border border-stone-200 bg-white p-3 shadow-sm shadow-stone-900/[0.02] dark:border-stone-800 dark:bg-stone-900">
      <div className="flex items-start gap-2">
        <span className={clsx('mt-1.5 size-2 shrink-0 rounded-full', priority.dot)} title={`优先级：${priority.label}`} />
        <h4 className={clsx('min-w-0 flex-1 leading-snug font-medium', task.status === 'done' && 'text-stone-400 line-through')}>
          {task.title}
        </h4>
        <Menu
          trigger={(toggle) => (
            <button
              onClick={toggle}
              className="-mt-0.5 -mr-1 rounded-md p-1 text-stone-400 opacity-0 group-hover:opacity-100 hover:bg-stone-100 max-md:opacity-100 dark:hover:bg-stone-800"
              aria-label="更多"
            >
              <MoreHorizontal className="size-4" />
            </button>
          )}
          items={[
            ...statuses
              .filter((s) => s.id !== task.status)
              .map((s) => ({ label: `移到「${s.label}」`, onClick: () => updateTask(task.id, { status: s.id }) })),
            'divider' as const,
            { label: '删除', danger: true, onClick: () => setConfirming(true) },
          ]}
        />
      </div>
      {task.description && (
        <p className="mt-1 line-clamp-2 pl-4 text-fs12 leading-relaxed text-stone-500 dark:text-stone-400">{task.description}</p>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 pl-4 text-fs11">
        {task.created_by === 'ai' && <AiTag />}
        {showProject && projectName && <ProjectTag name={projectName} />}
        {task.due && (
          <span
            className={clsx(
              'inline-flex items-center gap-1 rounded px-1 leading-[18px]',
              overdue ? 'bg-red-50 font-medium text-red-600 dark:bg-red-500/15 dark:text-red-300' : 'text-stone-500',
            )}
          >
            <CalendarDays className="size-3" />
            {task.due.slice(5).replace('-', '/')}
            {overdue && ' 逾期'}
          </span>
        )}
        {task.source && (
          <a
            href={href({ name: 'messages', group: task.source.group_id })}
            title={task.source.text}
            className="inline-flex max-w-full items-center gap-1 truncate text-stone-500 hover:text-accent-600"
          >
            <MessageSquare className="size-3 shrink-0" />
            <span className="truncate">{task.source.group_name}</span>
          </a>
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        title="删除任务"
        confirmLabel="删除"
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          removeTask(task.id)
          setConfirming(false)
        }}
      >
        确定删除「{task.title}」吗？删除后找不回来。
      </ConfirmDialog>
    </article>
  )
}
