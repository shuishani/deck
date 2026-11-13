import clsx from 'clsx'
import { CalendarDays, Crosshair, MessageSquareReply, X } from 'lucide-react'
import { useState } from 'react'
import { api, type Message, type Task } from '../api'
import { dueDate, fullTime, shortTime } from '../format'
import { href } from '../router'
import { useLoad, useActions, useData } from '../state'
import { priorities, statusLabel, useTaskReply } from '../tasks'
import { ErrorBar, MessageSkeleton } from './Feedback'
import { MessageItem } from './MessageItem'
import { AiTag, ProjectTag } from './Tags'
import { useToast } from './Toast'
import { Button, Dialog } from './ui'

export function TaskDetail({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { versions, overview } = useData()
  const { bump } = useActions()
  const toast = useToast()
  const replyInGroup = useTaskReply()
  const [removing, setRemoving] = useState<number | null>(null)
  const detail = useLoad(() => (id === null ? Promise.resolve(null) : api.task(id)), [id, versions.tasks, versions.messages])

  if (id === null) return null
  const data = detail.data?.task.id === id ? detail.data : null
  const task = data?.task

  async function unlink(message: Message) {
    setRemoving(message.id)
    try {
      await api.unlinkTaskMessage(id!, message.id)
      bump()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setRemoving(null)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      width="max-w-2xl"
      title={task ? task.title : '任务'}
      footer={
        task?.source && (
            <Button
              variant="primary"
              onClick={() => {
                onClose()
                void replyInGroup(task)
              }}
            >
              <MessageSquareReply className="size-3.5" />
              回群说明进展
            </Button>
        )
      }
    >
      {detail.error && !data && <ErrorBar message={detail.error} onRetry={detail.reload} />}
      {!data && !detail.error && <MessageSkeleton rows={3} />}
      {task && data && (
        <div className="space-y-4">
          <Meta task={task} projectName={overview?.find((p) => p.key === task.project)?.name} />
          {task.description && (
            <p className="text-fs13 leading-relaxed whitespace-pre-wrap text-stone-600 dark:text-stone-300">{task.description}</p>
          )}
          <section>
            <header className="mb-2">
              <div className="flex items-baseline gap-2">
                <h3 className="text-fs13 font-semibold whitespace-nowrap">相关消息</h3>
                <span className="text-fs12 text-stone-400 tabular-nums">{data.messages.length + data.missing.length}</span>
              </div>
              <p className="mt-0.5 text-fs12 text-stone-400">在消息上点「转为任务」或「多选」可加入更多</p>
            </header>
            <ol className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
              {data.messages.map((message) => {
                const primary = task.source?.message_id === message.id
                return (
                  <li key={message.id}>
                    <MessageItem message={{ ...message, tasks: message.tasks?.filter((t) => t.id !== task.id) }} variant="list" showGroup />
                    <div className="flex items-center gap-1 px-3 pb-2 pl-[3.25rem] text-fs12">
                      {primary && (
                        <span className="rounded bg-stone-100 px-1.5 leading-[18px] text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                          来源
                        </span>
                      )}
                      <a
                        href={href({ name: 'messages', group: message.group_id, anchor: message.id })}
                        onClick={onClose}
                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-stone-500 hover:bg-stone-100 hover:text-stone-800 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                      >
                        <Crosshair className="size-3" />
                        定位原消息
                      </a>
                      {!primary && (
                        <button
                          onClick={() => void unlink(message)}
                          disabled={removing === message.id}
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-stone-500 hover:bg-stone-100 hover:text-red-600 disabled:opacity-50 dark:hover:bg-stone-800"
                        >
                          <X className="size-3" />
                          移出任务
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
              {data.missing.length > 0 && (
                <li className="px-3 py-2.5 text-fs12 text-stone-400">
                  {data.missing.length} 条消息已过保留期限被清理
                  {task.source && data.missing.includes(task.source.message_id) && (
                    <span>；来源消息原文：{task.source.sender_name}：{task.source.text}</span>
                  )}
                </li>
              )}
              {data.messages.length + data.missing.length === 0 && (
                <li className="px-3 py-6 text-center text-fs12 text-stone-400">这个任务没有关联消息</li>
              )}
            </ol>
          </section>
        </div>
      )}
    </Dialog>
  )
}

function Meta({ task, projectName }: { task: Task; projectName?: string }) {
  const priority = priorities.find((p) => p.id === task.priority)!
  return (
    <div className="flex flex-wrap items-center gap-2 text-fs12 text-stone-500 dark:text-stone-400">
      <span
        className={clsx(
          'rounded px-1.5 leading-[20px] font-medium',
          task.status === 'done'
            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
            : 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-200',
        )}
      >
        {statusLabel(task.status)}
      </span>
      <span className="inline-flex items-center gap-1">
        <span className={clsx('size-2 rounded-full', priority.dot)} />
        优先级{priority.label}
      </span>
      {task.project && <ProjectTag name={projectName ?? task.project} />}
      {task.due && (
        <span className="inline-flex items-center gap-1">
          <CalendarDays className="size-3" />
          截止 {dueDate(task.due)}
        </span>
      )}
      {task.created_by === 'ai' && <AiTag />}
      <span className="ml-auto" title={fullTime(task.created_at)}>
        创建于 {shortTime(task.created_at)}
      </span>
    </div>
  )
}
