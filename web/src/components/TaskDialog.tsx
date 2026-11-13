import clsx from 'clsx'
import { MessageSquare, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api, type Task, type TaskPriority } from '../api'
import { taskSource, type TaskDraft, useActions, useData } from '../state'
import { priorities, statusLabel, useTasks } from '../tasks'
import { ProjectTag } from './Tags'
import { useToast } from './Toast'
import { Button, Dialog, Field, inputClass, Select } from './ui'

type Mode = 'new' | 'join'

export function TaskDialog({ draft, onClose }: { draft: TaskDraft | null; onClose: () => void }) {
  const { overview } = useData()
  const { bump, setPicking } = useActions()
  const toast = useToast()
  const [mode, setMode] = useState<Mode>('new')
  const [title, setTitle] = useState('')
  const [project, setProject] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [due, setDue] = useState('')
  const [description, setDescription] = useState('')
  const [target, setTarget] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!draft) return
    setMode('new')
    setTitle(draft.title ?? '')
    setProject(draft.project ?? '')
    setPriority('medium')
    setDue('')
    setDescription(
      draft.extra
        ? [draft.source!, ...draft.extra.map(taskSource)].map((m) => `${m.sender_name}（${m.group_name}）：${m.text}`).join('\n')
        : (draft.source?.text ?? ''),
    )
    setTarget(null)
    setError(null)
  }, [draft])

  if (!draft) return null
  const source = draft.source
  const joining = !!source && mode === 'join'
  const extra = draft.extra?.map((m) => m.id) ?? []

  async function submit() {
    if (busy || (joining ? target === null : !title.trim())) return
    setBusy(true)
    setError(null)
    try {
      if (joining) {
        const { task } = await api.linkTaskMessages(target!, [source!.message_id, ...extra])
        toast(`已加入「${task.title}」`)
      } else {
        await api.addTask({
          title: title.trim(),
          description: description.trim(),
          project: project || null,
          priority,
          due: due || null,
          source: source ?? null,
          message_ids: extra.length ? extra : undefined,
        })
        toast('任务已创建')
      }
      bump()
      setPicking(null)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={busy ? () => {} : onClose}
      title={source ? '消息转任务' : '新建任务'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy || (joining ? target === null : !title.trim())}>
            {busy ? '处理中…' : joining ? '加入任务' : '创建'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {source && (
          <>
            <SourceSummary draft={draft} />
            <div role="radiogroup" aria-label="处理方式" className="grid grid-cols-2 gap-1 rounded-lg bg-stone-100 p-1 dark:bg-stone-800/60">
              {(
                [
                  ['new', '新建任务'],
                  ['join', '加入已有任务'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  role="radio"
                  aria-checked={mode === id}
                  onClick={() => setMode(id)}
                  className={clsx(
                    'rounded-md py-1.5 text-fs13 font-medium transition-colors',
                    mode === id ? 'bg-white shadow-sm dark:bg-stone-900' : 'text-stone-500 hover:text-stone-800 dark:hover:text-stone-200',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
        {joining ? (
          <TaskPicker project={draft.project ?? null} linked={draft.linked ?? []} value={target} onChange={setTarget} onCreate={() => setMode('new')} />
        ) : (
          <>
            <Field label="标题">
              <input
                autoFocus
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && !event.nativeEvent.isComposing && void submit()}
                placeholder="简要说明要做的事"
                className={inputClass}
              />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="项目">
                <Select
                  field
                  value={project}
                  options={[{ id: '', label: '不关联项目' }, ...(overview ?? []).map((p) => ({ id: p.key, label: p.name }))]}
                  onChange={setProject}
                  label="项目"
                />
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
          </>
        )}
        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-fs13 text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>
        )}
      </div>
    </Dialog>
  )
}

function TaskPicker({
  project,
  linked,
  value,
  onChange,
  onCreate,
}: {
  project: string | null
  linked: number[]
  value: number | null
  onChange: (id: number) => void
  onCreate: () => void
}) {
  const tasks = useTasks()
  const { overview } = useData()
  const [query, setQuery] = useState('')
  // 未完成的任务，同项目的排前面；已完成的问题再出现时通常该新建或先重新打开。
  const candidates = useMemo(() => {
    const words = query.trim().toLowerCase()
    return tasks
      .filter((task) => task.status !== 'done' && (!words || task.title.toLowerCase().includes(words)))
      .sort((a, b) => Number(b.project === project) - Number(a.project === project) || b.updated_at.localeCompare(a.updated_at))
  }, [tasks, query, project])
  const open = tasks.some((task) => task.status !== 'done')

  if (!open) {
    return (
      <p className="rounded-lg border border-dashed border-stone-200 px-3 py-6 text-center text-fs13 text-stone-500 dark:border-stone-700">
        还没有未完成的任务。
        <button onClick={onCreate} className="ml-1 font-medium text-accent-600 hover:underline">
          新建一个
        </button>
      </p>
    )
  }
  return (
    <div className="space-y-2">
      <label className="relative block">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-stone-400" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索任务标题"
          className={`${inputClass} pl-8`}
        />
      </label>
      <div role="radiogroup" aria-label="选择任务" className="scroll-thin max-h-72 space-y-1 overflow-y-auto">
        {candidates.map((task) => (
          <PickerRow
            key={task.id}
            task={task}
            selected={value === task.id}
            included={linked.includes(task.id)}
            projectName={task.project && task.project !== project ? (overview?.find((p) => p.key === task.project)?.name ?? task.project) : null}
            onSelect={() => onChange(task.id)}
          />
        ))}
        {candidates.length === 0 && <p className="px-2 py-4 text-center text-fs12 text-stone-400">没有匹配的未完成任务</p>}
      </div>
    </div>
  )
}

function PickerRow({
  task,
  selected,
  included,
  projectName,
  onSelect,
}: {
  task: Task
  selected: boolean
  included: boolean
  projectName: string | null
  onSelect: () => void
}) {
  return (
    <button
      role="radio"
      aria-checked={selected}
      disabled={included}
      onClick={onSelect}
      className={clsx(
        'flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        selected
          ? 'border-accent-500 bg-accent-50 ring-2 ring-accent-500/15 dark:bg-accent-500/10'
          : 'border-stone-200 hover:bg-stone-50 dark:border-stone-700 dark:hover:bg-stone-800',
      )}
    >
      <span
        className={clsx(
          'flex size-3.5 shrink-0 items-center justify-center rounded-full border',
          selected ? 'border-accent-600' : 'border-stone-300 dark:border-stone-600',
        )}
      >
        {selected && <span className="size-1.5 rounded-full bg-accent-600" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-fs13 font-medium">{task.title}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-fs11 text-stone-500 dark:text-stone-400">
          <span>{statusLabel(task.status)}</span>
          <span>·</span>
          <span>{task.message_count} 条消息</span>
          {projectName && <ProjectTag name={projectName} />}
        </span>
      </span>
      {included && <span className="shrink-0 text-fs11 text-stone-400">已包含</span>}
    </button>
  )
}

function SourceSummary({ draft }: { draft: TaskDraft }) {
  const items = [draft.source!, ...(draft.extra ?? []).map(taskSource)]
  const groups = new Set(items.map((m) => m.group_id)).size
  return (
    <div className="rounded-lg bg-stone-50 px-3 py-2 text-fs12 text-stone-500 dark:bg-stone-800/60 dark:text-stone-400">
      {items.length > 1 && (
        <p className="mb-1.5 font-medium text-stone-600 dark:text-stone-300">
          共 {items.length} 条消息{groups > 1 && `，来自 ${groups} 个群`}；最早的一条作为来源
        </p>
      )}
      <ul className="space-y-1">
        {items.slice(0, 4).map((m) => (
          <li key={m.message_id} className="flex min-w-0 items-start gap-2">
            <MessageSquare className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0">
              「{m.group_name}」· {m.sender_name}
              <span className="block truncate text-stone-600 dark:text-stone-300">{m.text || '（无文本内容）'}</span>
            </span>
          </li>
        ))}
      </ul>
      {items.length > 4 && <p className="mt-1 pl-5.5">还有 {items.length - 4} 条</p>}
    </div>
  )
}
