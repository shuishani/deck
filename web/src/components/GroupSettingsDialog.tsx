import { useState } from 'react'
import { api, type Group, type GroupRules } from '../api'
import { useActions, useData } from '../state'
import { useToast } from './Toast'
import { Button, Dialog, Field, inputClass, Select, Switch } from './ui'

const SCOPES: { id: GroupRules['scope']; label: string; hint: string }[] = [
  { id: 'all', label: '全部', hint: '@我、回复我的消息和疑似问题都提醒' },
  { id: 'mentions', label: '仅 @我', hint: '只提醒 @我 或回复我的消息' },
  { id: 'keywords', label: '关键词', hint: '只提醒包含关键词的消息' },
]

export function GroupSettingsDialog({ group, onClose }: { group: Group; onClose: () => void }) {
  const { overview } = useData()
  const { bump } = useActions()
  const toast = useToast()
  const [rule, setRule] = useState<GroupRules>(group.rules)
  const [words, setWords] = useState(group.rules.keywords.join('\n'))
  const [quiet, setQuiet] = useState(!!group.rules.quiet_start)
  const [project, setProject] = useState(group.project)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const keywords = words.split('\n').map((w) => w.trim()).filter(Boolean)
  const problem =
    rule.scope === 'keywords' && !keywords.length
      ? '请至少填写一个关键词'
      : quiet && (!rule.quiet_start || !rule.quiet_end)
        ? '请填写免打扰的开始和结束时间'
        : null

  async function saveRules() {
    setBusy(true)
    setError(null)
    try {
      await api.setGroupRules(group.id, {
        ...rule,
        keywords,
        quiet_start: quiet ? rule.quiet_start : null,
        quiet_end: quiet ? rule.quiet_end : null,
      })
      toast('提醒规则已保存')
      bump()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function move() {
    setBusy(true)
    setError(null)
    try {
      await api.moveGroup(group.id, project)
      toast('已调整所属项目，历史消息和已有任务不变')
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
      open
      onClose={busy ? () => {} : onClose}
      title={`群设置 · ${group.name}`}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" onClick={saveRules} disabled={busy || !!problem}>
            {busy ? '保存中…' : '保存提醒规则'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <section className="space-y-3">
          <div>
            <h3 className="text-fs13 font-medium">提醒规则</h3>
            <p className="mt-0.5 text-fs12 text-stone-500">只影响「需回复」「疑似问题」的提醒，消息仍完整同步。</p>
          </div>
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-stone-100 p-1 dark:bg-stone-800/70" role="radiogroup" aria-label="提醒范围">
            {SCOPES.map((scope) => (
              <button
                key={scope.id}
                type="button"
                role="radio"
                aria-checked={rule.scope === scope.id}
                onClick={() => setRule({ ...rule, scope: scope.id })}
                className={
                  rule.scope === scope.id
                    ? 'rounded-md bg-white py-1 text-fs12 font-medium shadow-sm dark:bg-stone-900'
                    : 'rounded-md py-1 text-fs12 text-stone-500 hover:text-stone-700 dark:hover:text-stone-300'
                }
              >
                {scope.label}
              </button>
            ))}
          </div>
          <p className="text-fs12 text-stone-500">{SCOPES.find((s) => s.id === rule.scope)?.hint}</p>
          {rule.scope === 'keywords' && (
            <Field label="关键词" hint="每行一个，命中任意一个即提醒，不区分大小写">
              <textarea rows={3} value={words} onChange={(e) => setWords(e.target.value)} className={inputClass} />
            </Field>
          )}

          <div className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-fs13 font-medium">免打扰</p>
                <p className="text-fs12 text-stone-500">时段内不显示提醒，结束后未处理的消息重新出现。</p>
              </div>
              <Switch checked={quiet} onChange={setQuiet} label={<span className="sr-only">免打扰</span>} />
            </div>
            {quiet && (
              <>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Field label="开始">
                    <input type="time" value={rule.quiet_start || ''} onChange={(e) => setRule({ ...rule, quiet_start: e.target.value || null })} className={inputClass} />
                  </Field>
                  <Field label="结束">
                    <input type="time" value={rule.quiet_end || ''} onChange={(e) => setRule({ ...rule, quiet_end: e.target.value || null })} className={inputClass} />
                  </Field>
                </div>
                <p className="mt-2 text-fs12 text-stone-400">按运行 deck 的电脑所在时区；可跨午夜，开始和结束相同表示全天。</p>
              </>
            )}
          </div>
          {problem && <p className="text-fs12 text-amber-700 dark:text-amber-400">{problem}</p>}
        </section>

        <section className="space-y-3 border-t border-stone-200 pt-4 dark:border-stone-800">
          <Field label="所属项目" hint="历史消息保留，已有任务的项目不变">
            <div className="flex gap-2">
              <Select field value={project} options={(overview ?? []).map((p) => ({ id: p.key, label: p.name }))} onChange={setProject} label="所属项目" />
              <Button onClick={move} disabled={busy || project === group.project}>
                调整
              </Button>
            </div>
          </Field>
        </section>
        {error && (
          <p role="alert" className="text-fs12 text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
