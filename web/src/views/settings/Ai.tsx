import clsx from 'clsx'
import { Copy, Workflow } from 'lucide-react'
import { useState } from 'react'
import { api, type AiSettings, type AiSettingsInput } from '../../api'
import { copyText } from '../../clipboard'
import { ComingSoon } from '../../components/ComingSoon'
import { ErrorBar } from '../../components/Feedback'
import { SaveBar, Section, SettingRow, StatusPill, numberInput } from '../../components/SettingsLayout'
import { useToast } from '../../components/Toast'
import { Switch, inputClass } from '../../components/ui'
import { aiMarks, isSource } from '../../platforms'
import { useData, useLoad } from '../../state'

const number = new Intl.NumberFormat('zh-CN')
const APPROVE = "deck ai configure '{}' --approve-endpoint"
const keychainCommand = (item: string) => `security add-generic-password -U -s ${item} -a deck -w`
const MODEL_FIELDS: (keyof AiSettingsInput)[] = ['enabled', 'base_url', 'model', 'api_key_keychain']
const textInput = clsx(inputClass, 'sm:w-80')

type Status = { tone: 'green' | 'amber' | 'stone'; label: string; problem?: string; command?: string }

/** 只按已保存的配置判断；未保存的修改先保存再看。 */
function statusOf(s: AiSettings): Status {
  if (!s.base_url || !s.model) return { tone: 'stone', label: '待配置' }
  if (!s.endpoint_approved) {
    return { tone: 'amber', label: '待批准', problem: '接口地址不在本机，须在运行 deck 的电脑上执行以下命令批准：', command: APPROVE }
  }
  if (!s.configured) {
    return {
      tone: 'amber',
      label: '缺少密钥',
      problem: `钥匙串中未找到「${s.api_key_keychain}」。请在运行 deck 的电脑上执行以下命令并按提示粘贴密钥，无需重启：`,
      command: keychainCommand(s.api_key_keychain),
    }
  }
  return s.enabled ? { tone: 'green', label: '已就绪' } : { tone: 'stone', label: '未开启' }
}

/** 设置 → AI。 */
export function AiSettingsPage() {
  const { versions, config } = useData()
  const loaded = useLoad(() => api.aiSettings(), [versions.config])
  const settings = loaded.data?.settings
  if (loaded.error && !settings) return <ErrorBar message={loaded.error} onRetry={loaded.reload} />
  if (!settings) return <div className="h-40 animate-pulse rounded-xl bg-stone-200/70 dark:bg-stone-800" />
  const unmarked = config?.sources.some((source) => !config.marks_ai.includes(source))

  return (
    <div className="space-y-8">
      <AiForm settings={settings} onSaved={loaded.setData} />
      <Section title="AI 身份" description="以 AI 身份发送时，群成员通过以下方式识别该消息由 AI 发送。">
        <SettingRow label="平台标注" hint={`${aiMarks(config?.marks_ai.filter(isSource))}；deck 中显示「AI 发送」，不添加文字前缀。`} />
        {unmarked && (
          <SettingRow
            label="文字前缀"
            hint={`不支持标注的平台，在正文前添加${config?.ai_prefix ? `「${config.ai_prefix}」` : '前缀'}；可通过 deck config set 修改。`}
          />
        )}
      </Section>
      <ComingSoon title="自动化规则" icon={<Workflow className="size-4" />}>
        配置由 AI 起草回复的群、可触发自动修复的发送人，以及修复的 L0–L3 分级规则。
      </ComingSoon>
    </div>
  )
}

function AiForm({ settings, onSaved }: { settings: AiSettings; onSaved: (data: { settings: AiSettings }) => void }) {
  const toast = useToast()
  const [changes, setChanges] = useState<Partial<AiSettingsInput>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const draft: AiSettings = { ...settings, ...changes }
  const set = (patch: Partial<AiSettingsInput>) => setChanges({ ...changes, ...patch })
  const changed = Object.keys(changes) as (keyof AiSettingsInput)[]
  const status = statusOf(settings)
  const usage = settings.usage
  const used = usage.total_tokens + (usage.reserved_tokens ?? 0)
  const ratio = Math.min(1, used / Math.max(1, settings.monthly_token_budget))

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
  const bar = <SaveBar busy={busy} error={error} onCancel={() => (setChanges({}), setError(null))} onSave={save} />

  return (
    <>
      <Section
        title="AI 模型"
        description="使用 OpenAI 兼容接口，仅在提问或起草时调用，结果不会自动发送。"
        action={<StatusPill tone={status.tone}>{status.label}</StatusPill>}
      >
        <SettingRow label="启用 AI" hint="关闭后隐藏「问 AI」和「AI 起草」入口。" className="!flex-row items-center">
          <Switch checked={draft.enabled} onChange={(enabled) => set({ enabled })} label={<span className="sr-only">启用 AI</span>} />
        </SettingRow>
        {status.problem && (
          <div className="bg-amber-50/60 px-4 py-3 dark:bg-amber-500/5">
            <p className="text-fs12 text-amber-800 dark:text-amber-200">{status.problem}</p>
            <div className="mt-2 flex items-center gap-2 rounded-md border border-amber-200/70 bg-white px-2.5 py-1.5 dark:border-amber-500/20 dark:bg-stone-950">
              <code className="min-w-0 flex-1 truncate font-mono text-fs12 text-stone-700 dark:text-stone-200">{status.command}</code>
              <button
                type="button"
                onClick={async () => toast((await copyText(status.command!)) ? '已复制命令' : '复制失败，请手动选择', 'info')}
                className="shrink-0 rounded p-1 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
                aria-label="复制命令"
              >
                <Copy className="size-3.5" />
              </button>
            </div>
          </div>
        )}
        <SettingRow label="接口地址" hint="以 /v1 结尾，例如 https://api.example.com/v1">
          <input value={draft.base_url} onChange={(e) => set({ base_url: e.target.value })} placeholder="https://…/v1" inputMode="url" autoComplete="off" spellCheck={false} disabled={busy} className={textInput} />
        </SettingRow>
        <SettingRow label="模型名称">
          <input value={draft.model} onChange={(e) => set({ model: e.target.value })} placeholder="gpt-5.5" autoComplete="off" spellCheck={false} disabled={busy} className={textInput} />
        </SettingRow>
        <SettingRow label="钥匙串条目" hint="密钥保存在运行 deck 的电脑的钥匙串中，此处仅填写条目名；本机无需密钥的服务请留空。">
          <input value={draft.api_key_keychain} onChange={(e) => set({ api_key_keychain: e.target.value })} placeholder="deck-ai" autoComplete="off" spellCheck={false} disabled={busy} className={textInput} />
        </SettingRow>
        {changed.some((key) => MODEL_FIELDS.includes(key)) && bar}
      </Section>

      <Section title="用量与限制" description="达到每月预算后停止调用模型，每月 1 日重置。">
        <SettingRow
          label="本月用量"
          hint={!!usage.reserved_tokens && `其中 ${number.format(usage.reserved_tokens)} token 为结果未知的请求预留，并非供应商确认的用量。`}
        >
          <div className="w-full sm:w-64">
            <p className="text-right text-fs12 text-stone-500 tabular-nums">
              <span className="font-medium text-stone-800 dark:text-stone-100">{number.format(used)}</span> / {number.format(settings.monthly_token_budget)} token · {number.format(usage.requests)} 次
            </p>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
              <div
                className={clsx('h-full rounded-full', ratio > 0.9 ? 'bg-red-500' : ratio > 0.7 ? 'bg-amber-500' : 'bg-accent-600')}
                style={{ width: `${ratio * 100}%` }}
              />
            </div>
          </div>
        </SettingRow>
        <SettingRow label="每月预算" hint={`按每次项目范围提问约 2 万 token 估算，约可使用 ${number.format(Math.floor(draft.monthly_token_budget / 20000))} 次。`}>
          <label className="flex items-center gap-2 text-fs13 text-stone-500">
            <input
              type="number"
              inputMode="numeric"
              min="1"
              max="100000000"
              step="100000"
              value={draft.monthly_token_budget}
              onChange={(e) => set({ monthly_token_budget: Number(e.target.value) })}
              disabled={busy}
              aria-label="每月预算"
              className={clsx(numberInput, '!w-32')}
            />
            token
          </label>
        </SettingRow>
        <SettingRow label="单次输出上限" hint="单次回答或草稿的 token 上限，包含推理模型的思考过程；设置过小会导致输出被截断。">
          <label className="flex items-center gap-2 text-fs13 text-stone-500">
            <input
              type="number"
              inputMode="numeric"
              min="128"
              max="32768"
              step="1024"
              value={draft.max_output_tokens}
              onChange={(e) => set({ max_output_tokens: Number(e.target.value) })}
              disabled={busy}
              aria-label="单次输出上限"
              className={clsx(numberInput, '!w-24')}
            />
            token
          </label>
        </SettingRow>
        {changed.some((key) => !MODEL_FIELDS.includes(key)) && bar}
      </Section>
    </>
  )
}
