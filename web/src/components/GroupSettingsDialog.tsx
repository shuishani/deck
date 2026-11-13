import { useState } from 'react'
import clsx from 'clsx'
import { api, type Group, type GroupRules } from '../api'
import { useActions, useData } from '../state'
import { useToast } from './Toast'
import { Button, ConfirmDialog, Dialog, Field, inputClass, Select, Switch } from './ui'

const SCOPES: { id: GroupRules['scope']; label: string; hint: string }[] = [
  { id: 'all', label: '全部', hint: '@我、回复我的消息和疑似问题都提醒' },
  { id: 'mentions', label: '仅 @我', hint: '只提醒 @我 或回复我的消息' },
  { id: 'keywords', label: '关键词', hint: '只提醒包含关键词的消息' },
  { id: 'off', label: '不提醒', hint: '不进「需回复」、不推送；消息照常保存' },
]

export function GroupSettingsDialog({ group, onClose }: { group: Group; onClose: () => void }) {
  const { overview } = useData()
  const { bump } = useActions()
  const toast = useToast()
  const [rule, setRule] = useState<GroupRules>(group.rules)
  const [words, setWords] = useState(group.rules.keywords.join('\n'))
  const [quiet, setQuiet] = useState(!!group.rules.quiet_start)
  const [mode, setMode] = useState(group.mode)
  const [removing, setRemoving] = useState(false)
  const direct = group.chat === 'direct'
  const [project, setProject] = useState(group.project)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const keywords = words.split('\n').map((w) => w.trim()).filter(Boolean)
  const problem =
    rule.scope === 'keywords' && !keywords.length
      ? '请至少填写一个关键词'
      : quiet && (!rule.quiet_start || !rule.quiet_end)
        ? '请填写安静时段的开始和结束时间'
        : null

  async function saveRules() {
    setBusy(true)
    setError(null)
    try {
      if (mode !== group.mode) await api.setGroupMode(group.id, mode)
      await api.setGroupRules(group.id, {
        ...rule,
        keywords,
        quiet_start: quiet ? rule.quiet_start : null,
        quiet_end: quiet ? rule.quiet_end : null,
      })
      toast('已保存')
      bump()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      await api.removeGroup(group.id)
      toast(direct ? `已移除「${group.name}」` : `已停止监测「${group.name}」`)
      bump()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setRemoving(false)
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
      title={`${direct ? '单聊' : '群'}设置 · ${group.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={() => setRemoving(true)} disabled={busy} className="mr-auto text-stone-500 hover:text-red-600">
            移除
          </Button>
          <Button onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" onClick={saveRules} disabled={busy || !!problem}>
            {busy ? '保存中…' : '保存'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <section className="space-y-3">
          <ToggleRow
            label="监听"
            hint={mode === 'off' ? '已停止：不再拉取新消息，已有消息保留，随时可恢复。' : '拉取新消息，可在 deck 里查看、搜索和回复。'}
            checked={mode !== 'off'}
            onChange={(on) => setMode(on ? 'ai' : 'off')}
          />
          <ToggleRow
            label="AI 分析"
            hint="AI 记住上下文、判断紧急程度、写进日报；关闭后 AI 不读这个会话。"
            checked={mode === 'ai'}
            disabled={mode === 'off'}
            onChange={(on) => setMode(on ? 'ai' : 'listen')}
          />
        </section>

        <section className="space-y-3 border-t border-stone-200 pt-4 dark:border-stone-800">
          <div>
            <h3 className="text-fs13 font-medium">提醒</h3>
            <p className="mt-0.5 text-fs12 text-stone-500">哪些消息进「需回复」「疑似问题」和推送；优先于「设置 → 提醒」的全局规则。</p>
          </div>
          <div className="grid grid-cols-4 gap-1 rounded-lg bg-stone-100 p-1 dark:bg-stone-800/70" role="radiogroup" aria-label="提醒范围">
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
                <p className="text-fs13 font-medium">安静时段</p>
                <p className="text-fs12 text-stone-500">这个会话在时段内不提醒、不推送，结束后未处理的消息重新出现。</p>
              </div>
              <Switch checked={quiet} onChange={setQuiet} label={<span className="sr-only">安静时段</span>} />
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

        {!direct && (
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
        )}
        {error && (
          <p role="alert" className="text-fs12 text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
      <ConfirmDialog
        open={removing}
        title={`移除「${group.name}」？`}
        confirmLabel="移除"
        onConfirm={() => void remove()}
        onClose={() => setRemoving(false)}
        busy={busy}
      >
        {direct
          ? '从列表移除并清除本地消息，挂在任务上的消息会显示为已清理。对方再发新消息时会重新出现；只想暂时不收，关掉「监听」。'
          : '停止监测这个群并删除本地消息，挂在任务上的消息会显示为已清理。之后要重新在项目里添加。'}
      </ConfirmDialog>
    </Dialog>
  )
}

function ToggleRow({ label, hint, checked, disabled, onChange }: {
  label: string
  hint: string
  checked: boolean
  disabled?: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <div className={clsx('flex items-center justify-between gap-3', disabled && 'opacity-50')}>
      <div>
        <p className="text-fs13 font-medium">{label}</p>
        <p className="text-fs12 text-stone-500">{hint}</p>
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} label={<span className="sr-only">{label}</span>} />
    </div>
  )
}
