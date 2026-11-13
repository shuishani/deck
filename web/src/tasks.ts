import { api, type Task, type TaskPriority, type TaskStatus } from './api'
import { useToast } from './components/Toast'
import { useActions, useData } from './state'

export const statuses: { id: TaskStatus; label: string }[] = [
  { id: 'todo', label: '待处理' },
  { id: 'doing', label: '进行中' },
  { id: 'review', label: '待审阅' },
  { id: 'done', label: '已完成' },
]

export const priorities: { id: TaskPriority; label: string; dot: string; tag: string }[] = [
  { id: 'low', label: '低', dot: 'bg-stone-300 dark:bg-stone-600', tag: 'bg-stone-100 text-stone-500 dark:bg-stone-800' },
  { id: 'medium', label: '中', dot: 'bg-sky-400', tag: 'bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' },
  { id: 'high', label: '高', dot: 'bg-amber-500', tag: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  { id: 'urgent', label: '紧急', dot: 'bg-red-500', tag: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300' },
]

export function useTasks(): Task[] {
  return useData().tasks ?? []
}

function today() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function isOverdue(task: Task) {
  return !!task.due && task.status !== 'done' && task.due < today()
}

export function statusLabel(status: TaskStatus) {
  return statuses.find((s) => s.id === status)?.label ?? status
}

/** 回群说明的初稿，只填进输入框，由用户修改后再预览、确认发送。 */
export function progressText(task: Pick<Task, 'title' | 'status'>) {
  return {
    todo: `已收到，已记录为待处理：${task.title}`,
    doing: `正在处理：${task.title}`,
    review: `已修复，正在验证：${task.title}`,
    done: `已处理完成：${task.title}。如仍有问题请告知。`,
  }[task.status]
}

/** 打开原消息所在的群，引用原消息起草进展说明。 */
export function useTaskReply() {
  const { openReply } = useActions()
  const toast = useToast()
  return async (task: Task) => {
    if (!task.source) return
    try {
      const { message } = await api.message(task.source.message_id)
      openReply({
        group: message.group_id,
        replyTo: message,
        handle: message.is_me ? undefined : message.id,
        initialText: progressText(task),
      })
      toast('已填入进展说明，修改后发送，发送前仍会预览确认', 'info')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    }
  }
}
