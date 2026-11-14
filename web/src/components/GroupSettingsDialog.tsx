import { useState } from 'react'
import clsx from 'clsx'
import { api, type Group, type GroupRules } from '../api'
import { useActions, useData } from '../state'
import { useToast } from './Toast'
import { Button, ConfirmDialog, Dialog, Field, inputClass, Select, Switch } from './ui'

const SCOPES: { id: GroupRules['scope']; label: string; hint: string }[] = [
  { id: 'all', label: '全部', hint: '@我、回复我及疑似问题都提醒。' },
  { id: 'mentions', label: '仅 @我', hint: '只提醒 @我或回复我的消息。' },
  { id: 'keywords', label: '关键词', hint: '只提醒包含关键词的消息。' },
  { id: 'off', label: '不提醒', hint: '消息仍保存，不进入「需回复」「疑似问题」，也不推送。' },
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
            hint={mode === 'off' ? '已停止接收，已有消息保留' : '接收新消息'}
            checked={mode !== 'off'}
            onChange={(on) => setMode(on ? 'ai' : 'off')}
          />
          <ToggleRow
            label="AI 分析"
            hint={mode === 'ai' ? '分析消息，供问题研判和日报使用' : '关闭后不再分析此会话'}
            checked={mode === 'ai'}
            disabled={mode === 'off'}
            onChange={(on) => setMode(on ? 'ai' : 'listen')}
          />
        </section>

        <section className="space-y-3 border-t border-stone-200 pt-4 dark:border-stone-800">
          <details className="text-fs12 text-stone-500 dark:text-stone-400">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-md focus-visible:outline-2 focus-visible:outline-accent-500 sm:min-h-8 [&::-webkit-details-marker]:hidden">
              <span className="text-fs13 font-medium text-stone-900 dark:text-stone-100">提醒范围</span>
              <span className="underline decoration-dotted underline-offset-4">规则说明</span>
            </summary>
            <p className="mt-1 leading-relaxed">会话范围决定哪些消息进入「需回复」「疑似问题」；自动推送上线后，推送时间按「设置 → 提醒」的全局规则。选「全部」不会覆盖全局的「不推送」。</p>
          </details>
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
          <p className="text-fs12 text-stone-500">
            {direct && (rule.scope === 'all' || rule.scope === 'mentions') ? '单聊消息都提醒。' : SCOPES.find((s) => s.id === rule.scope)?.hint}
          </p>
          {rule.scope === 'keywords' && (
            <Field label="关键词" hint="每行一个，命中任意一个即提醒，不区分大小写">
              <textarea rows={3} value={words} onChange={(e) => setWords(e.target.value)} className={inputClass} />
            </Field>
          )}

          <div className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
            <div className="flex min-h-11 items-center justify-between gap-3 sm:min-h-8">
              <p className="text-fs13 font-medium">安静时段</p>
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
                <p className="mt-2 text-fs12 text-stone-500">时段内不提醒、不推送，结束后恢复符合规则的未处理消息。</p>
                <p className="mt-1 text-fs12 text-stone-400">按运行 deck 的电脑所在时区；可跨午夜，开始和结束相同表示全天。</p>
              </>
            )}
          </div>
          {problem && <p className="text-fs12 text-amber-700 dark:text-amber-400">{problem}</p>}
        </section>

        {!direct && (
          <section className="space-y-3 border-t border-stone-200 pt-4 dark:border-stone-800">
            <Field label="所属项目" hint={project !== group.project ? '点击「调整」立即生效，不随底部保存；历史消息保留，已有任务仍留在原项目。' : undefined}>
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
    <div className={clsx('flex min-h-11 items-center justify-between gap-3', disabled && 'opacity-50')}>
      <div>
        <p className="text-fs13 font-medium">{label}</p>
        <p className="text-fs12 text-stone-500">{hint}</p>
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} label={<span className="sr-only">{label}</span>} />
    </div>
  )
}
