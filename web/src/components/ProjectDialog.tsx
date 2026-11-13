import { useState } from 'react'
import { api, type Project } from '../api'
import { navigate } from '../router'
import { useActions } from '../state'
import { useToast } from './Toast'
import { Button, Dialog, Field, inputClass } from './ui'

export function ProjectDialog({ open, onClose, project }: { open: boolean; onClose: () => void; project?: Project }) {
  const { bump } = useActions()
  const toast = useToast()
  const [key, setKey] = useState(project?.key || '')
  const [name, setName] = useState(project?.name || '')
  const [repo, setRepo] = useState(project?.repo || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready = key.trim() && name.trim()

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      if (project) await api.updateProject(project.key, { name: name.trim(), repo: repo.trim() || null })
      else await api.addProject({ key: key.trim(), name: name.trim(), repo: repo.trim() || undefined })
      toast(`项目「${name.trim()}」已${project ? '保存' : '创建'}`)
      bump()
      onClose()
      if (!project) navigate({ name: 'project', key: key.trim(), tab: 'overview' })
      setKey('')
      setName('')
      setRepo('')
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
      title={project ? '编辑项目' : '新建项目'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy || !ready}>
            {busy ? '保存中…' : project ? '保存' : '创建'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-[1fr_2fr] gap-3">
          <Field label="简称" hint="用于命令行，例如 mx">
            <input autoFocus={!project} disabled={!!project} value={key} onChange={(e) => setKey(e.target.value)} placeholder="mx" className={inputClass} />
          </Field>
          <Field label="名称">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Management-X" className={inputClass} />
          </Field>
        </div>
        <Field label="代码仓库（可选）">
          <input
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="/Users/you/project/repo"
            className={`${inputClass} font-mono text-fs13`}
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
