import { useState } from 'react'
import { api } from '../api'
import { navigate } from '../router'
import { useDeck } from '../state'
import { useToast } from './Toast'
import { Button, Dialog, Field, inputClass } from './ui'

export function ProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { bump } = useDeck()
  const toast = useToast()
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [repo, setRepo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready = key.trim() && name.trim()

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await api.addProject({ key: key.trim(), name: name.trim(), repo: repo.trim() || undefined })
      toast(`已建项目「${name.trim()}」`)
      bump()
      onClose()
      navigate({ name: 'project', key: key.trim(), tab: 'overview' })
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
      title="新建项目"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy || !ready}>
            {busy ? '创建中…' : '创建'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-[1fr_2fr] gap-3">
          <Field label="简称" hint="命令行里用，如 mx">
            <input autoFocus value={key} onChange={(e) => setKey(e.target.value)} placeholder="mx" className={inputClass} />
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
