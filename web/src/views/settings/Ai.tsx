import clsx from 'clsx'
import { ChevronDown, Copy } from 'lucide-react'
import { useState } from 'react'
import { api, type AiSettings, type AiSettingsInput } from '../../api'
import { copyText } from '../../clipboard'
import { ErrorBar } from '../../components/Feedback'
import { SaveBar, Section, SettingRow, StatusPill, numberInput } from '../../components/SettingsLayout'
import { useToast } from '../../components/Toast'
import { Switch, inputClass } from '../../components/ui'
import { aiMarks, isSource } from '../../platforms'
import { useData, useLoad } from '../../state'

const number = new Intl.NumberFormat('zh-CN')
const APPROVE = "deck ai configure '{}' --approve-endpoint"
const keychainCommand = (item: string) => `security add-generic-password -U -s ${item} -a deck -w`
const textInput = clsx(inputClass, 'sm:w-80')
const summaryClass = 'flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-4 py-3 text-fs13 text-stone-600 focus-visible:outline-2 focus-visible:outline-accent-500 dark:text-stone-300 [&::-webkit-details-marker]:hidden'

type Status = { tone: 'green' | 'amber' | 'stone'; label: string; problem?: string; command?: string }

/** 只按已保存的配置判断；不代表接口已通过连通性验证。 */
function statusOf(s: AiSettings): Status {
  if (!s.base_url || !s.model) return { tone: 'stone', label: '待配置' }
  if (!s.endpoint_approved) {
    return { tone: 'amber', label: '待批准', problem: '非本机接口须在运行 deck 的电脑上批准。', command: APPROVE }
  }
  if (!s.configured) {
    return {
      tone: 'amber',
      label: '缺少密钥',
      problem: `钥匙串条目「${s.api_key_keychain}」中未找到密钥，请在运行 deck 的电脑上添加。`,
      command: keychainCommand(s.api_key_keychain),
    }
  }
  return s.enabled ? { tone: 'green', label: '已配置' } : { tone: 'stone', label: '已关闭' }
}

/** 设置 → AI。 */
export function AiSettingsPage() {
  const { versions } = useData()
  const loaded = useLoad(() => api.aiSettings(), [versions.config])
  const settings = loaded.data?.settings
  if (loaded.error && !settings) return <ErrorBar message={loaded.error} onRetry={loaded.reload} />
  if (!settings) return <div className="h-40 animate-pulse rounded-xl bg-stone-200/70 dark:bg-stone-800" />
  return <div className="space-y-8"><AiForm settings={settings} onSaved={loaded.setData} /></div>
}

function AiForm({ settings, onSaved }: { settings: AiSettings; onSaved: (data: { settings: AiSettings }) => void }) {
  const toast = useToast()
  const [changes, setChanges] = useState<Partial<AiSettingsInput>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const draft: AiSettings = { ...settings, ...changes }
  const set = (patch: Partial<AiSettingsInput>) => setChanges({ ...changes, ...patch })
  const changed = Object.keys(changes).length > 0
  const status = statusOf(settings)
  const usage = settings.usage
  const used = usage.total_tokens + (usage.reserved_tokens ?? 0)
  const ratio = Math.min(1, used / Math.max(1, settings.monthly_token_budget))
  const problem = !Number.isInteger(draft.monthly_token_budget) || draft.monthly_token_budget < 1 || draft.monthly_token_budget > 100000000
    ? '每月 token 上限须为 1～100000000 的整数'
    : !Number.isInteger(draft.max_output_tokens) || draft.max_output_tokens < 128 || draft.max_output_tokens > 32768
      ? '单次输出上限须为 128～32768 的整数'
      : null

  async function save() {
    setBusy(true)
    setError(null)
    try {
      onSaved(await api.updateAiSettings(changes))
      setChanges({})
      toast('AI 设置已保存')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <fieldset disabled={busy} className="min-w-0 space-y-8" aria-label="AI 设置">
        <Section
          title="AI 模型"
          description="仅在提问或起草时调用，不自动发送到会话。"
          action={<StatusPill tone={status.tone}>{status.label}</StatusPill>}
        >
          <SettingRow label="启用 AI" className="!flex-row items-center">
            <Switch checked={draft.enabled} onChange={(enabled) => set({ enabled })} label={<span className="sr-only">启用 AI</span>} />
          </SettingRow>
          {status.problem && (
            <div role="alert" className="bg-amber-50/60 px-4 py-3 dark:bg-amber-500/5">
              <p className="text-fs12 text-amber-800 dark:text-amber-200">{status.problem}</p>
              <div className="mt-2 flex items-center gap-2 rounded-md border border-amber-200/70 bg-white px-2.5 py-1.5 dark:border-amber-500/20 dark:bg-stone-950">
                <code className="min-w-0 flex-1 break-all font-mono text-fs12 text-stone-700 dark:text-stone-200">{status.command}</code>
                <button
                  type="button"
                  disabled={changed}
                  onClick={async () => toast((await copyText(status.command!)) ? '命令已复制' : '复制失败，请手动复制', 'info')}
                  className="flex size-11 shrink-0 items-center justify-center rounded text-stone-500 hover:bg-stone-100 disabled:opacity-50 dark:hover:bg-stone-800"
                  aria-label="复制配置命令"
                >
                  <Copy className="size-4" />
                </button>
              </div>
              {changed && <p className="mt-2 text-fs12 text-amber-800 dark:text-amber-200">请先保存修改，再执行配置命令。</p>}
            </div>
          )}
          <SettingRow label="当前模型" className="!flex-row items-center">
            <span className="block max-w-48 text-right text-fs13 break-all text-stone-600 dark:text-stone-300">{settings.model || '未配置'}</span>
          </SettingRow>
          <details className="group" open={!settings.configured}>
            <summary className={summaryClass}>
              模型配置
              <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" />
            </summary>
            <p className="px-4 pb-2 text-fs12 leading-relaxed text-stone-500">所选消息和任务内容会发送至此接口。非本机接口须在运行 deck 的电脑上批准。</p>
            <SettingRow label="接口地址" hint="使用 OpenAI 兼容接口，地址以 /v1 结尾。">
              <input value={draft.base_url} onChange={(e) => set({ base_url: e.target.value })} placeholder="https://api.example.com/v1" aria-label="接口地址" inputMode="url" autoComplete="off" spellCheck={false} className={textInput} />
            </SettingRow>
            <SettingRow label="模型名称">
              <input value={draft.model} onChange={(e) => set({ model: e.target.value })} placeholder="gpt-5.5" aria-label="模型名称" autoComplete="off" spellCheck={false} className={textInput} />
            </SettingRow>
            <SettingRow label="钥匙串条目" hint="仅填写条目名，不填写密钥。无需密钥的本机服务可留空。">
              <input value={draft.api_key_keychain} onChange={(e) => set({ api_key_keychain: e.target.value })} placeholder="deck-ai" aria-label="钥匙串条目" autoComplete="off" spellCheck={false} className={textInput} />
            </SettingRow>
          </details>
        </Section>

        <Section title="用量与限制" description="预计超出上限的请求不会执行，每月 1 日重置用量。">
          <SettingRow
            label="本月用量"
            hint={usage.reserved_tokens ? `含 ${number.format(usage.reserved_tokens)} token 预留用量，尚未经供应商确认。` : '按 deck 本地记录统计。'}
          >
            <div className="w-full sm:w-64">
              <p className="text-right text-fs12 text-stone-500 tabular-nums">
                <span className="font-medium text-stone-800 dark:text-stone-100">{number.format(used)}</span> / {number.format(settings.monthly_token_budget)} token · {number.format(usage.requests)} 次
              </p>
              <div
                role="progressbar"
                aria-label="本月 token 用量"
                aria-valuemin={0}
                aria-valuemax={settings.monthly_token_budget}
                aria-valuenow={Math.min(used, settings.monthly_token_budget)}
                aria-valuetext={`${number.format(used)} / ${number.format(settings.monthly_token_budget)} token`}
                className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800"
              >
                <div className={clsx('h-full rounded-full', ratio > 0.9 ? 'bg-red-500' : ratio > 0.7 ? 'bg-amber-500' : 'bg-accent-600')} style={{ width: `${ratio * 100}%` }} />
              </div>
            </div>
          </SettingRow>
          <SettingRow label="每月 token 上限">
            <label className="flex items-center gap-2 text-fs13 text-stone-500">
              <input
                type="number"
                inputMode="numeric"
                min="1"
                max="100000000"
                step="100000"
                value={draft.monthly_token_budget}
                onChange={(e) => set({ monthly_token_budget: Number(e.target.value) })}
                aria-label="每月 token 上限"
                className={clsx(numberInput, '!w-32')}
              />
              token
            </label>
          </SettingRow>
          <details className="group">
            <summary className={summaryClass}>
              高级设置
              <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" />
            </summary>
            <SettingRow label="单次输出上限" hint="包含推理消耗的 token；上限过低可能导致回答截断。">
              <label className="flex items-center gap-2 text-fs13 text-stone-500">
                <input
                  type="number"
                  inputMode="numeric"
                  min="128"
                  max="32768"
                  step="1024"
                  value={draft.max_output_tokens}
                  onChange={(e) => set({ max_output_tokens: Number(e.target.value) })}
                  aria-label="单次输出上限"
                  className={clsx(numberInput, '!w-24')}
                />
                token
              </label>
            </SettingRow>
          </details>
        </Section>
        <AiIdentity />
      </fieldset>
      {changed && (
        <div className="sticky bottom-0 z-10 overflow-hidden rounded-xl border border-stone-200 shadow-lg dark:border-stone-700">
          <SaveBar busy={busy} disabled={!!problem} error={problem ?? error} message="本页有未保存的修改" saveLabel="保存本页修改" onCancel={() => (setChanges({}), setError(null))} onSave={save} />
        </div>
      )}
    </>
  )
}

function AiIdentity() {
  const { config } = useData()
  const unmarked = config?.sources.some((source) => !config.marks_ai.includes(source))
  return (
    <Section title="AI 身份">
      <details className="group">
        <summary className={summaryClass}>
          发送标识说明
          <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <SettingRow label="平台标注" hint={`${aiMarks(config?.marks_ai.filter(isSource))}；deck 中显示「AI 发送」。`} />
        {unmarked && <SettingRow label="文字前缀" hint={`不支持平台标注时，添加${config?.ai_prefix ? `「${config.ai_prefix}」` : '文字前缀'}，可通过 deck config set 修改。`} />}
      </details>
    </Section>
  )
}
