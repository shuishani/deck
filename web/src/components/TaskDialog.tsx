import clsx from 'clsx'
import { MessageSquare } from 'lucide-react'
import { useEffect, useState } from 'react'
import { addTask, priorities, type TaskPriority } from '../mock/tasks'
import { useDeck, type TaskDraft } from '../state'
import { useToast } from './Toast'
import { Button, Dialog, Field, inputClass } from './ui'

export function TaskDialog({ draft, onClose }: { draft: TaskDraft | null; onClose: () => void }) {
  const { overview } = useDeck()
  const toast = useToast()
  const [title, setTitle] = useState('')
  const [project, setProject] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [due, setDue] = useState('')
  const [description, setDescription] = useState('')

  useEffect(() => {
    if (!draft) return
    setTitle(draft.title ?? '')
    setProject(draft.project ?? '')
    setPriority('medium')
    setDue('')
    setDescription(draft.source ? draft.source.text : '')
  }, [draft])

  if (!draft) return null

  function submit() {
    addTask({
      title: title.trim(),
      description: description.trim(),
      project: project || null,
      status: 'todo',
      priority,
      due: due || null,
      source: draft!.source ?? null,
      created_by: 'me',
    })
    toast('已建任务')
    onClose()
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={draft.source ? '消息转任务' : '新建任务'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={submit} disabled={!title.trim()}>
            建任务
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {draft.source && (
          <div className="flex items-start gap-2 rounded-lg bg-stone-50 px-3 py-2 text-fs12 text-stone-500 dark:bg-stone-800/60 dark:text-stone-400">
            <MessageSquare className="mt-0.5 size-3.5 shrink-0" />
            <span>
              来自「{draft.source.group_name}」· {draft.source.sender_name}
            </span>
          </div>
        )}
        <Field label="标题">
          <input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && title.trim() && submit()}
            placeholder="要做什么"
            className={inputClass}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="项目">
            <select value={project} onChange={(event) => setProject(event.target.value)} className={inputClass}>
              <option value="">不属于任何项目</option>
              {overview?.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="截止日期">
            <input type="date" value={due} onChange={(event) => setDue(event.target.value)} className={inputClass} />
          </Field>
        </div>
        <Field label="优先级">
          <div className="grid grid-cols-4 gap-2">
            {priorities.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setPriority(option.id)}
                className={clsx(
                  'flex items-center justify-center gap-1.5 rounded-lg border py-1.5 text-fs13 transition-colors',
                  priority === option.id
                    ? 'border-accent-500 bg-accent-50 font-medium ring-2 ring-accent-500/15 dark:bg-accent-500/10'
                    : 'border-stone-200 hover:bg-stone-50 dark:border-stone-700 dark:hover:bg-stone-800',
                )}
              >
                <span className={clsx('size-2 rounded-full', option.dot)} />
                {option.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="描述">
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
            placeholder="补充说明（可选）"
            className={`${inputClass} resize-y leading-[1.6]`}
          />
        </Field>
      </div>
    </Dialog>
  )
}
