import clsx from 'clsx'
import { CalendarDays, MessageSquare, MoreHorizontal, Plus } from 'lucide-react'
import { useState } from 'react'
import { api, type Task, type TaskInput, type TaskStatus } from '../api'
import { dueDate } from '../format'
import { href } from '../router'
import { useActions, useData } from '../state'
import { isOverdue, priorities, statuses, useTaskReply, useTasks } from '../tasks'
import { ErrorBar } from './Feedback'
import { AiTag, ProjectTag } from './Tags'
import { useToast } from './Toast'
import { Button, ConfirmDialog, Menu } from './ui'

function useTaskActions() {
  const { bump } = useActions()
  const toast = useToast()
  async function run(action: () => Promise<unknown>) {
    try {
      await action()
      bump()
      return true
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
      return false
    }
  }
  return {
    update: (id: number, body: TaskInput) => run(() => api.updateTask(id, body)),
    remove: (id: number) => run(() => api.removeTask(id)),
  }
}

/** newButton：页头里没有「新建任务」时（项目页的任务页签）在看板上方放一个。 */
export function TaskBoard({ project, newButton }: { project?: string; newButton?: boolean }) {
  const tasks = useTasks()
  const { tasksError } = useData()
  const { bump, openTask } = useActions()
  const [column, setColumn] = useState<TaskStatus>('todo')
  // 完成带来源的任务后问一句要不要回群说明；卡片换列会重建，所以放在看板这层。
  const [finished, setFinished] = useState<Task | null>(null)
  const replyInGroup = useTaskReply()
  const shown = project ? tasks.filter((task) => task.project === project) : tasks

  return (
    <div className="space-y-3">
      {tasksError && <ErrorBar message={tasksError} onRetry={bump} />}
      {newButton && (
        <div className="flex justify-end">
          <Button variant="primary" size="sm" onClick={() => openTask({ project: project ?? null })}>
            <Plus className="size-3.5" />
            新建任务
          </Button>
        </div>
      )}
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
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
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
              {/* 手机上上方已有分段页签，不再重复列标题。 */}
              <header className="flex items-center gap-2 px-1.5 pt-0.5 pb-2 max-md:hidden">
                <StatusIcon status={status.id} />
                <h3 className="text-fs13 font-semibold">{status.label}</h3>
                <span className="text-fs12 text-stone-400 tabular-nums">{items.length}</span>
              </header>
              <div className="space-y-2">
                {items.map((task) => (
                  <TaskCard key={task.id} task={task} showProject={!project} onFinished={setFinished} />
                ))}
                {items.length === 0 && <p className="px-2 py-6 text-center text-fs12 text-stone-400">暂无</p>}
              </div>
            </section>
          )
        })}
      </div>
      <ConfirmDialog
        open={!!finished}
        title="回群说明进展？"
        confirmLabel="起草说明"
        cancelLabel="暂不"
        tone="primary"
        onClose={() => setFinished(null)}
        onConfirm={() => {
          if (finished) void replyInGroup({ ...finished, status: 'done' })
          setFinished(null)
        }}
      >
        「{finished?.title}」已完成。将在「{finished?.source?.group_name}」引用 {finished?.source?.sender_name} 的原消息起草说明，
        修改后预览确认才会发送。
      </ConfirmDialog>
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

function TaskCard({ task, showProject, onFinished }: { task: Task; showProject: boolean; onFinished: (task: Task) => void }) {
  const { overview } = useData()
  const { openTaskDetail } = useActions()
  const { update, remove } = useTaskActions()
  const replyInGroup = useTaskReply()
  const [confirming, setConfirming] = useState(false)
  const [removing, setRemoving] = useState(false)

  async function move(status: TaskStatus) {
    if ((await update(task.id, { status })) && status === 'done' && task.source) onFinished(task)
  }
  const priority = priorities.find((p) => p.id === task.priority)!
  const projectName = overview?.find((p) => p.key === task.project)?.name ?? task.project
  const overdue = isOverdue(task)
  // 只标出高、紧急；中、低不占位置。
  const urgent = task.priority === 'high' || task.priority === 'urgent'
  const hasMeta =
    urgent || task.created_by === 'ai' || (showProject && !!projectName) || !!task.due || !!task.source || task.message_count > 1

  return (
    <article className="group rounded-lg border border-stone-200 bg-white p-3 shadow-sm shadow-stone-900/[0.02] dark:border-stone-800 dark:bg-stone-900">
      <div className="flex items-start gap-2">
        <h4 className="min-w-0 flex-1 leading-snug font-medium">
          <button
            onClick={() => openTaskDetail(task.id)}
            className={clsx('text-left hover:text-accent-700 dark:hover:text-accent-500', task.status === 'done' && 'text-stone-400 line-through')}
          >
            {task.title}
          </button>
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
              .map((s) => ({ label: `移至「${s.label}」`, onClick: () => void move(s.id) })),
            'divider' as const,
            { label: '查看详情', onClick: () => openTaskDetail(task.id) },
            ...(task.source ? [{ label: '回群说明进展', onClick: () => void replyInGroup(task) }] : []),
            'divider' as const,
            { label: '删除', danger: true, onClick: () => setConfirming(true) },
          ]}
        />
      </div>
      {task.description && (
        <p className="mt-1 line-clamp-2 text-fs12 leading-relaxed text-stone-500 dark:text-stone-400">{task.description}</p>
      )}
      {hasMeta && (
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-fs11">
        {urgent && (
          <span className={clsx('rounded px-1 leading-[18px] font-medium', priority.tag)}>{priority.label}</span>
        )}
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
            {dueDate(task.due)}
            {overdue && ' 逾期'}
          </span>
        )}
        {task.source && (
          <a
            href={href({ name: 'messages', group: task.source.group_id, anchor: task.source.message_id })}
            title={`查看原消息：${task.source.sender_name}：${task.source.text}`}
            className="inline-flex max-w-full items-center gap-1 truncate text-stone-500 hover:text-accent-600"
          >
            <MessageSquare className="size-3 shrink-0" />
            <span className="truncate">{task.source.group_name}</span>
          </a>
        )}
        {task.message_count > 1 && (
          <button
            onClick={() => openTaskDetail(task.id)}
            title="查看全部相关消息"
            className="rounded bg-stone-100 px-1 leading-[18px] text-stone-500 tabular-nums hover:text-accent-700 dark:bg-stone-800 dark:text-stone-400"
          >
            {task.message_count} 条消息
          </button>
        )}
      </div>
      )}
      <ConfirmDialog
        open={confirming}
        title="删除任务"
        confirmLabel="删除"
        busy={removing}
        onClose={() => setConfirming(false)}
        onConfirm={async () => {
          setRemoving(true)
          if (await remove(task.id)) setConfirming(false)
          setRemoving(false)
        }}
      >
        确定删除「{task.title}」？删除后无法恢复。
      </ConfirmDialog>
    </article>
  )
}
