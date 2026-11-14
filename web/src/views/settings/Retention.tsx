import clsx from 'clsx'
import { ChevronDown, Copy } from 'lucide-react'
import { useState } from 'react'
import type { Config } from '../../api'
import { copyText } from '../../clipboard'
import { SaveBar, Section, SettingRow, numberInput, useSettingsSave } from '../../components/SettingsLayout'
import { useToast } from '../../components/Toast'
import { useData } from '../../state'

/** 消息保留：放在「会话」页签。 */
export function Retention() {
  const { config } = useData()
  if (!config) return null
  return <RetentionForm config={config} />
}

function RetentionForm({ config }: { config: Config }) {
  const toast = useToast()
  const [days, setDays] = useState<string | null>(null)
  const { save, busy, error, setError } = useSettingsSave()
  const parsed = Number(days)
  const problem = days !== null && (!Number.isInteger(parsed) || parsed < 1 || parsed > 3650) ? '保留天数须为 1～3650 的整数' : null
  const changed = days !== null && (!!problem || parsed !== config.retention_days)
  const command = 'deck prune'

  return (
    <Section title="消息保留">
      <details className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 text-fs13 text-stone-600 focus-visible:outline-2 focus-visible:outline-accent-500 dark:text-stone-300 [&::-webkit-details-marker]:hidden">
          <span>仅手动清理 · 保留最近 {config.retention_days} 天</span>
          <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <SettingRow
          label="清理时保留"
          hint={
            <>
              手动执行 <code className="rounded bg-stone-100 px-1 font-mono text-fs11 dark:bg-stone-800">{command}</code> 会删除更早的本地消息，跳过当前关联任务的消息。不会自动清理。
            </>
          }
        >
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-fs13 text-stone-500">
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="3650"
                  value={days ?? config.retention_days}
                  disabled={busy}
                  onChange={(event) => setDays(event.target.value)}
                  aria-invalid={!!problem}
                  aria-label="保留天数"
                  className={clsx(numberInput, problem && '!border-red-400')}
                />
                天
              </label>
              <button
                disabled={busy || changed}
                onClick={async () => toast((await copyText(command)) ? '已复制，请在运行 deck 的电脑上执行' : '复制失败', 'info')}
                title="复制清理命令"
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-stone-200 px-2.5 text-fs12 text-stone-600 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50 max-md:h-11 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
              >
                <Copy className="size-3.5" />
                复制命令
              </button>
            </div>
            {changed && <p className="text-fs12 text-stone-500">请先保存天数，再复制命令。</p>}
          </div>
        </SettingRow>
        {changed && (
          <SaveBar
            busy={busy}
            disabled={!!problem}
            error={problem ?? error}
            onCancel={() => (setDays(null), setError(null))}
            onSave={async () => (await save({ retention_days: parsed }, '清理保留天数已保存')) && setDays(null)}
          />
        )}
      </details>
    </Section>
  )
}
