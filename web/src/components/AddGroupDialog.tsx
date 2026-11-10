import clsx from 'clsx'
import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, type Project, type Source } from '../api'
import { useDeck } from '../state'
import { SourceBadge } from './SourceBadge'
import { useToast } from './Toast'
import { Button, Dialog, Field, inputClass } from './ui'

const NEW = '__new__'

export function AddGroupDialog({
  open,
  onClose,
  defaultProject,
}: {
  open: boolean
  onClose: () => void
  defaultProject?: string
}) {
  const { bump } = useDeck()
  const toast = useToast()
  const [projects, setProjects] = useState<Project[]>([])
  const [project, setProject] = useState('')
  const [newKey, setNewKey] = useState('')
  const [newName, setNewName] = useState('')
  const [source, setSource] = useState<Source>('dingtalk')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setError(null)
    api
      .projects()
      .then(({ projects }) => {
        setProjects(projects)
        setProject((current) => defaultProject || current || projects[0]?.key || NEW)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [open, defaultProject])

  const creating = project === NEW
  const ready = query.trim() && (creating ? newKey.trim() && newName.trim() : project)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      let key = project
      if (creating) {
        key = newKey.trim()
        await api.addProject({ key, name: newName.trim() })
      }
      const added = await api.addGroup({ project: key, source, query: query.trim() })
      toast(`已开始监测「${added.name}」`)
      setProject(key)
      bump()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={busy ? () => {} : onClose}
      title="添加监测的群"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy || !ready}>
            {busy ? '查找并添加…' : '添加'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="项目">
          <select value={project} onChange={(event) => setProject(event.target.value)} className={inputClass}>
            {projects.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}（{p.key}）
              </option>
            ))}
            <option value={NEW}>+ 新建项目…</option>
          </select>
        </Field>
        {creating && (
          <div className="grid grid-cols-[1fr_2fr] gap-3 rounded-xl bg-stone-50 p-3 dark:bg-stone-800/50">
            <Field label="简称">
              <input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="mx" className={inputClass} />
            </Field>
            <Field label="名称">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Management-X"
                className={inputClass}
              />
            </Field>
          </div>
        )}
        <Field label="来源">
          <div className="grid grid-cols-2 gap-2">
            {(['dingtalk', 'channel'] as Source[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setSource(value)}
                className={clsx(
                  'flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors',
                  source === value
                    ? 'border-accent-500 bg-accent-50 ring-2 ring-accent-500/15 dark:bg-accent-500/10'
                    : 'border-stone-200 hover:bg-stone-50 dark:border-stone-700 dark:hover:bg-stone-800',
                )}
              >
                <SourceBadge source={value} />
                <span className="font-medium">{value === 'dingtalk' ? '钉钉' : 'channel'}</span>
              </button>
            ))}
          </div>
        </Field>
        <Field label="群名或原始 id" hint="按名字查找时必须唯一匹配；同名的群请直接填原始 id。">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && ready && !busy && void submit()}
            placeholder={source === 'dingtalk' ? '如 management-x-dev-TEST' : '如 测试dev-1023'}
            className={inputClass}
          />
        </Field>
        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-fs13 text-red-700 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}

export function AddGroupButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="primary" onClick={onClick}>
      <Plus className="size-3.5" />
      添加群
    </Button>
  )
}
