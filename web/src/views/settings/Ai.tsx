import clsx from 'clsx'
import { Bot, Copy, Sparkles, Workflow } from 'lucide-react'
import { useState } from 'react'
import { api, type AiSettings, type AiSettingsInput } from '../../api'
import { copyText } from '../../clipboard'
import { useLoad, useData } from '../../state'
import { ErrorBar } from '../../components/Feedback'
import { useToast } from '../../components/Toast'
import { Button, Field, inputClass, Switch } from '../../components/ui'
import { ComingSoon } from '../../components/ComingSoon'
import { aiMarks, isSource } from '../../platforms'

const number = new Intl.NumberFormat('zh-CN')
const APPROVE = "uv run deck ai configure '{}' --approve-endpoint"

/** 可配置的 OpenAI 兼容模型。密钥只通过环境变量名引用，浏览器不接触明文。 */
function AiSettingsCard() {
  const toast = useToast()
  const { versions } = useData()
  const loaded = useLoad(() => api.aiSettings(), [versions.config])
  const [changes, setChanges] = useState<Partial<AiSettingsInput>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const settings = loaded.data?.settings
  if (loaded.error && !settings) return <ErrorBar message={loaded.error} onRetry={loaded.reload} />
  if (!settings) return <div className="h-40 animate-pulse rounded-xl bg-stone-200/70 dark:bg-stone-800" />

  const draft: AiSettings = { ...settings, ...changes }
  const dirty = Object.keys(changes).length > 0
  const missing = [!draft.base_url.trim() && '接口地址', !draft.model.trim() && '模型名称'].filter(Boolean)
  const set = (patch: Partial<AiSettingsInput>) => setChanges({ ...changes, ...patch })
  const usage = settings.usage
  const used = usage.total_tokens + (usage.reserved_tokens ?? 0)
  const ratio = Math.min(1, used / Math.max(1, settings.monthly_token_budget))

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const result = await api.updateAiSettings(changes)
      loaded.setData(result)
      setChanges({})
      toast('AI 设置已保存')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // 只按已保存的配置判断状态；未保存的修改先保存再看。
  const status = !settings.base_url || !settings.model
    ? null
    : !settings.endpoint_approved
      ? { tone: 'amber', text: '接口地址未批准：本机以外的地址须在运行 deck 的电脑上批准后才能调用' }
      : !settings.configured
        ? { tone: 'amber', text: '密钥环境变量未设置，请在运行 deck 的电脑上设置后重启服务' }
        : { tone: 'green', text: settings.enabled ? '已就绪' : '已配置，开启后可用' }

  return (
    <section className="min-w-0 rounded-xl border border-stone-200 bg-white p-4 sm:p-5 dark:border-stone-800 dark:bg-stone-900">
      <div className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300">
          <Sparkles className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">AI 模型</h3>
          <p className="text-fs12 leading-relaxed text-stone-500">只在提问或起草时调用，结果不会自动发送</p>
        </div>
        <Switch checked={draft.enabled} onChange={(enabled) => set({ enabled })} label={<span className="sr-only">启用 AI</span>} />
      </div>

      {status && !dirty && (
        <div
          role="status"
          className={clsx(
            'mt-4 rounded-lg px-3 py-2 text-fs12',
            status.tone === 'amber'
              ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
              : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
          )}
        >
          <p className="flex items-center gap-1.5">
            <span className={clsx('size-1.5 shrink-0 rounded-full', status.tone === 'amber' ? 'bg-amber-500' : 'bg-emerald-500')} />
            {status.text}
          </p>
          {!settings.endpoint_approved && (
            <div className="mt-2 flex items-center gap-2 rounded-md bg-white/70 px-2 py-1.5 font-mono text-fs11 text-stone-700 dark:bg-black/20 dark:text-stone-200">
              <code className="min-w-0 flex-1 truncate">{APPROVE}</code>
              <button
                type="button"
                onClick={async () => toast((await copyText(APPROVE)) ? '已复制命令' : '复制失败，请手动选择', 'info')}
                className="shrink-0 rounded p-1 hover:bg-stone-100 dark:hover:bg-stone-800"
                aria-label="复制批准命令"
              >
                <Copy className="size-3.5" />
              </button>
            </div>
          )}
        </div>
      )}
      {draft.enabled && missing.length > 0 && (
        <p className="mt-3 text-fs12 text-amber-700 dark:text-amber-400">请填写{missing.join('、')}，否则 AI 功能不可用。</p>
      )}

      <fieldset disabled={busy} className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="接口地址" hint="OpenAI 兼容接口，例如 https://api.example.com/v1">
          <input value={draft.base_url} onChange={(e) => set({ base_url: e.target.value })} placeholder="https://…/v1" inputMode="url" autoComplete="off" className={inputClass} />
        </Field>
        <Field label="模型名称">
          <input value={draft.model} onChange={(e) => set({ model: e.target.value })} autoComplete="off" className={inputClass} />
        </Field>
        <Field label="密钥环境变量名" hint="只填变量名，密钥留在运行 deck 的电脑上；本机免密服务可留空">
          <input value={draft.api_key_env} onChange={(e) => set({ api_key_env: e.target.value })} placeholder="DECK_AI_API_KEY" autoComplete="off" spellCheck={false} className={inputClass} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="每月预算（token）">
            <input type="number" min="1" max="100000000" value={draft.monthly_token_budget} onChange={(e) => set({ monthly_token_budget: Number(e.target.value) })} className={inputClass} />
          </Field>
          <Field label="单次输出上限">
            <input type="number" min="128" max="8192" value={draft.max_output_tokens} onChange={(e) => set({ max_output_tokens: Number(e.target.value) })} className={inputClass} />
          </Field>
        </div>
      </fieldset>

      <div className="mt-5 border-t border-stone-100 pt-4 dark:border-stone-800">
        <div className="flex items-baseline justify-between gap-3 text-fs12">
          <span className="text-stone-500">本月用量</span>
          <span className="tabular-nums">
            <span className="font-medium">{number.format(used)}</span>
            <span className="text-stone-400"> / {number.format(settings.monthly_token_budget)} token · {number.format(usage.requests)} 次</span>
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
          <div
            className={clsx('h-full rounded-full', ratio > 0.9 ? 'bg-red-500' : ratio > 0.7 ? 'bg-amber-500' : 'bg-accent-600')}
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
        {!!usage.reserved_tokens && (
          <p className="mt-2 text-fs12 text-stone-500">
            其中 {number.format(usage.reserved_tokens)} token 是结果未知的请求预留的，不是供应商确认的用量。
          </p>
        )}
      </div>

      {error && <p role="alert" className="mt-3 text-fs12 break-words text-red-600 dark:text-red-400">{error}</p>}
      {dirty && (
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setChanges({})} disabled={busy}>
            还原
          </Button>
          <Button variant="primary" onClick={save} disabled={busy}>
            {busy ? '保存中…' : '保存'}
          </Button>
        </div>
      )}
    </section>
  )
}

/** 设置 → AI。 */
export function AiSettingsPage() {
  const { config } = useData()
  return (
    <div className="space-y-4">
      <AiSettingsCard />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300">
              <Bot className="size-4" />
            </span>
            <h3 className="font-semibold">助手身份</h3>
          </div>
          <p className="mt-3 text-fs13 leading-relaxed text-stone-500 dark:text-stone-400">
            以 AI 身份发送时由平台标注：{aiMarks(config?.marks_ai.filter(isSource))}，deck 中显示「AI 发送」，不加文字前缀。
          </p>
          {config && config.sources.some((source) => !config.marks_ai.includes(source)) && (
            <p className="mt-2 text-fs12 leading-relaxed text-stone-400">
              不支持标注的平台改为加前缀{config.ai_prefix ? `「${config.ai_prefix}」` : ''}，可用命令 deck config set 修改。
            </p>
          )}
        </div>
        <ComingSoon title="自动化规则" icon={<Workflow className="size-4" />}>
          设置哪些群由 AI 起草回复、哪些发送人可触发自动修复，以及修复的 L0–L3 分级规则。
        </ComingSoon>
      </div>
    </div>
  )
}
