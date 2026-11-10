import { localStore } from './store'

export type TaskStatus = 'todo' | 'doing' | 'review' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'

export interface TaskSource {
  group_id: number
  group_name: string
  message_id: number
  sender_name: string
  text: string
}

export interface Task {
  id: string
  title: string
  description: string
  project: string | null
  status: TaskStatus
  priority: TaskPriority
  due: string | null
  source: TaskSource | null
  created_by: 'me' | 'ai'
  created_at: string
}

export const statuses: { id: TaskStatus; label: string }[] = [
  { id: 'todo', label: '待处理' },
  { id: 'doing', label: '进行中' },
  { id: 'review', label: '待审阅' },
  { id: 'done', label: '已完成' },
]

export const priorities: { id: TaskPriority; label: string; dot: string }[] = [
  { id: 'low', label: '低', dot: 'bg-stone-300 dark:bg-stone-600' },
  { id: 'medium', label: '中', dot: 'bg-sky-400' },
  { id: 'high', label: '高', dot: 'bg-amber-500' },
  { id: 'urgent', label: '紧急', dot: 'bg-red-500' },
]

function daysFromToday(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function seed(): Task[] {
  const now = new Date().toISOString()
  return [
    {
      id: 'seed-1',
      title: '排版反馈上传网盘失败',
      description: '群里反馈「网盘保存文件失败，请联系技术人员」，需要排查网盘上传接口。',
      project: 'mx',
      status: 'todo',
      priority: 'high',
      due: daysFromToday(1),
      source: null,
      created_by: 'ai',
      created_at: now,
    },
    {
      id: 'seed-2',
      title: '整理 deck 测试群的监听规则',
      description: '确定哪些群算正式群、哪些发送人不算要我回复。',
      project: 'mx',
      status: 'doing',
      priority: 'medium',
      due: daysFromToday(3),
      source: null,
      created_by: 'me',
      created_at: now,
    },
    {
      id: 'seed-3',
      title: '报价分析进度展示复核',
      description: '',
      project: 'mx',
      status: 'review',
      priority: 'low',
      due: daysFromToday(-1),
      source: null,
      created_by: 'me',
      created_at: now,
    },
  ]
}

const store = localStore<Task[]>('deck.tasks', seed)

export const useTasks = store.use

export function addTask(task: Omit<Task, 'id' | 'created_at'>) {
  const created: Task = { ...task, id: `t-${Date.now().toString(36)}`, created_at: new Date().toISOString() }
  store.set((tasks) => [created, ...tasks])
  return created
}

export function updateTask(id: string, patch: Partial<Task>) {
  store.set((tasks) => tasks.map((task) => (task.id === id ? { ...task, ...patch } : task)))
}

export function removeTask(id: string) {
  store.set((tasks) => tasks.filter((task) => task.id !== id))
}

export function isOverdue(task: Task) {
  return !!task.due && task.status !== 'done' && task.due < new Date().toISOString().slice(0, 10)
}
