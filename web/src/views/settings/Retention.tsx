import clsx from 'clsx'
import { Copy } from 'lucide-react'
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
  const command = 'deck prune'

  return (
    <Section title="消息保留" description="deck 不会自动删除消息；已关联任务的消息始终保留。">
      <SettingRow
        label="保留期限"
        hint={
          <>
            执行 <code className="rounded bg-stone-100 px-1 font-mono text-fs11 dark:bg-stone-800">{command}</code> 时，删除早于该天数的消息。
          </>
        }
      >
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-fs13 text-stone-500">
            <input
              type="number"
              inputMode="numeric"
              min="1"
              max="3650"
              value={days ?? config.retention_days}
              onChange={(event) => setDays(event.target.value)}
              aria-invalid={!!problem}
              aria-label="保留天数"
              className={clsx(numberInput, problem && '!border-red-400')}
            />
            天
          </label>
          <button
            onClick={async () => toast((await copyText(command)) ? '已复制，请在运行 deck 的电脑上执行' : '复制失败', 'info')}
            title="复制清理命令"
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-stone-200 px-2.5 text-fs12 text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
          >
            <Copy className="size-3.5" />
            复制命令
          </button>
        </div>
      </SettingRow>
      {days !== null && (
        <SaveBar
          busy={busy}
          disabled={!!problem}
          error={problem ?? error}
          onCancel={() => (setDays(null), setError(null))}
          onSave={async () => (await save({ retention_days: parsed }, '保留期限已保存')) && setDays(null)}
        />
      )}
    </Section>
  )
}
