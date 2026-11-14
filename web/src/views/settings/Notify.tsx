import clsx from 'clsx'
import { Send } from 'lucide-react'
import { useState } from 'react'
import { api, type NotifyInput, type NotifyLevel, type NotifyRule, type NotifySettings } from '../../api'
import { ErrorBar } from '../../components/Feedback'
import { SaveBar, Section, SettingRow, StatusPill } from '../../components/SettingsLayout'
import { useToast } from '../../components/Toast'
import { Button, Select, Switch, inputClass } from '../../components/ui'
import { useData, useLoad } from '../../state'

const LEVELS: { id: NotifyLevel; label: string; hint: string; tone: string }[] = [
  { id: 'urgent', label: '紧急', hint: 'AI 判定的生产故障、阻塞等严重问题', tone: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300' },
  { id: 'high', label: '高', hint: '@我、回复我、单聊', tone: 'bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300' },
  { id: 'medium', label: '中', hint: '疑似问题或求助', tone: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  { id: 'low', label: '低', hint: '其他值得一提的消息。', tone: 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300' },
]
const WAITS = [null, 0, 5, 15, 30, 60, 120, 240]
const DAYS = ['一', '二', '三', '四', '五', '六', '日']
const timeInput = clsx(inputClass, '!h-8 !w-28 !py-0 tabular-nums max-md:!h-10 max-md:!w-36')

function waitLabel(minutes: number | null) {
  return minutes === null ? '不推送' : minutes === 0 ? '立即推送' : minutes < 60 ? `${minutes} 分钟` : `${minutes / 60} 小时`
}

/** 设置 → 提醒：各级别的推送规则和推送渠道。 */
export function NotifySection() {
  const { versions } = useData()
  const loaded = useLoad(() => api.notify(), [versions.config])
  const settings = loaded.data?.settings
  if (loaded.error && !settings) return <ErrorBar message={loaded.error} onRetry={loaded.reload} />
  if (!settings) return <div className="h-40 animate-pulse rounded-xl bg-stone-200/70 dark:bg-stone-800" />
  return <NotifyForm settings={settings} onSaved={loaded.setData} />
}

function NotifyForm({ settings, onSaved }: { settings: NotifySettings; onSaved: (data: { settings: NotifySettings }) => void }) {
  const toast = useToast()
  const [changes, setChanges] = useState<Partial<NotifyInput>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const draft = { ...settings, ...changes }
  const set = (patch: Partial<NotifyInput>) => setChanges({ ...changes, ...patch })
  const setLevel = (level: NotifyLevel, rule: Partial<NotifyRule>) =>
    set({ levels: { ...draft.levels, [level]: { ...draft.levels[level], ...rule } } })
  const changed = Object.keys(changes).length > 0
  const problem = draft.work_start >= draft.work_end ? '下班时间须晚于上班时间' : !draft.work_days.length ? '至少选一个工作日' : null

  async function save() {
    setBusy(true)
    setError(null)
    try {
      onSaved(await api.updateNotify(changes))
      setChanges({})
      toast('本页提醒设置已保存')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <fieldset disabled={busy} className="min-w-0 space-y-8" aria-label="提醒设置">
        <Section
          title="提醒级别"
          description="未读未回的消息，按以下等待时间推送。"
          action={<StatusPill tone="amber">自动推送尚未上线，规则可先保存</StatusPill>}
        >
          {LEVELS.map((level) => (
            <SettingRow
              key={level.id}
              label={<span className={clsx('rounded-full px-2 text-fs12 leading-5 font-medium', level.tone)}>{level.label}</span>}
              hint={level.hint}
            >
              <div className="grid grid-cols-2 gap-2 sm:w-80">
                {(['work', 'off'] as const).map((when) => {
                  const value = draft.levels[level.id][when]
                  const waits = WAITS.includes(value) ? WAITS : [...WAITS, value].sort((a, b) => (a ?? -1) - (b ?? -1))
                  return (
                    <label key={when} className="space-y-1">
                      <span className="block text-fs11 text-stone-400">{when === 'work' ? '上班时间' : '下班后'}</span>
                      <Select
                        field
                        value={String(value)}
                        options={waits.map((w) => ({ id: String(w), label: waitLabel(w) }))}
                        onChange={(id) => setLevel(level.id, { [when]: id === 'null' ? null : Number(id) })}
                        label={`${level.label}·${when === 'work' ? '上班时间' : '下班后'}`}
                        className="!h-8 w-full !text-fs13"
                      />
                    </label>
                  )
                })}
              </div>
            </SettingRow>
          ))}
          <SettingRow label="工作时间" hint="按运行 deck 的电脑所在时区区分上班和下班。">
            <div className="flex flex-col gap-2 sm:items-end">
              <div className="flex gap-1" role="group" aria-label="工作日">
                {DAYS.map((name, i) => {
                  const day = i + 1
                  const on = draft.work_days.includes(day)
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={on}
                      onClick={() => set({ work_days: on ? draft.work_days.filter((d) => d !== day) : [...draft.work_days, day].sort() })}
                      className={clsx(
                        'size-8 rounded-lg text-fs12 font-medium transition-colors',
                        on ? 'bg-accent-600 text-white' : 'bg-stone-100 text-stone-500 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700',
                      )}
                    >
                      {name}
                    </button>
                  )
                })}
              </div>
              <div className="flex items-center gap-2 text-fs13 text-stone-500">
                <input type="time" value={draft.work_start} onChange={(e) => set({ work_start: e.target.value })} aria-label="上班时间" className={timeInput} />
                至
                <input type="time" value={draft.work_end} onChange={(e) => set({ work_end: e.target.value })} aria-label="下班时间" className={timeInput} />
              </div>
            </div>
          </SettingRow>
          <details className="px-4 py-2 text-fs12 text-stone-500 dark:text-stone-400">
            <summary className="min-h-11 content-center cursor-pointer rounded-md focus-visible:outline-2 focus-visible:outline-accent-500 sm:min-h-8">规则说明</summary>
            <div className="space-y-2 pb-2 leading-relaxed">
              <p>级别与任务优先级一致。不推送的消息仍按会话范围进入「需回复」或「疑似问题」。</p>
              <p>「高」级别的等待时间也用于「需回复」的超时标记；选「不推送」或「立即推送」时不标超时。</p>
            </div>
          </details>
        </Section>
        <Section title="推送到钉钉" description="由「deck管家」机器人发到你的钉钉群。">
          <SettingRow label="自动推送" badge={<StatusPill tone="amber">尚未上线</StatusPill>} hint="上线后按级别规则推送，当前仅保存设置。" className="!flex-row items-center">
            <Switch checked={draft.enabled} onChange={(enabled) => set({ enabled })} label={<span className="sr-only">自动推送</span>} />
          </SettingRow>
          <RobotSettings settings={settings} onSaved={onSaved} />
          <SettingRow label="每日汇报" badge={<StatusPill tone="amber">尚未上线</StatusPill>} hint="整理前一天的消息、问题和待办，当前仅保存设置。" className={draft.digest ? undefined : '!flex-row items-center'}>
            <div className="flex flex-wrap items-center gap-3 sm:justify-end">
              {draft.digest && <input type="time" value={draft.digest_time} onChange={(e) => set({ digest_time: e.target.value })} aria-label="汇报时间" className={timeInput} />}
              <Switch checked={draft.digest} onChange={(digest) => set({ digest })} label={<span className="sr-only">每日汇报</span>} />
            </div>
          </SettingRow>
        </Section>
      </fieldset>
      {changed && (
        <div className="sticky bottom-0 z-10 overflow-hidden rounded-xl border border-stone-200 shadow-lg dark:border-stone-700">
          <SaveBar
            busy={busy}
            disabled={!!problem}
            error={problem ?? error}
            message="本页有未保存的修改"
            saveLabel="保存本页修改"
            onCancel={() => (setChanges({}), setError(null))}
            onSave={() => void save()}
          />
        </div>
      )}
    </>
  )
}

function RobotSettings({ settings, onSaved }: { settings: NotifySettings; onSaved: (data: { settings: NotifySettings }) => void }) {
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [testing, setTesting] = useState(false)
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname)

  async function test() {
    setTesting(true)
    try {
      await api.testNotify()
      toast('测试消息已发送，去钉钉看看')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setTesting(false)
    }
  }

  return (
    <>
      <SettingRow
        label="机器人"
        badge={<StatusPill tone={settings.webhook ? 'green' : 'amber'}>{settings.webhook ? '已配置' : '未配置'}</StatusPill>}
        hint={!settings.webhook ? '添加钉钉自定义机器人，安全设置选「加签」。' : undefined}
      >
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {settings.webhook && (
              <Button size="sm" onClick={() => void test()} disabled={testing}>
                <Send className="size-3.5" />
                {testing ? '发送中…' : '发送测试'}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setEditing(!editing)} aria-expanded={editing}>
              {editing ? '收起配置' : settings.webhook ? '更换' : '配置'}
            </Button>
          </div>
          {settings.webhook && <p className="text-fs12 text-stone-500">测试会实际发钉钉，不受自动推送开关影响。</p>}
          {settings.webhook && (
            <details className="text-fs12 text-stone-500 dark:text-stone-400">
              <summary className="min-h-11 content-center cursor-pointer rounded-md focus-visible:outline-2 focus-visible:outline-accent-500 sm:min-h-8">配置详情</summary>
              <p className="py-2 leading-relaxed">Webhook{settings.signed ? ' 和加签密钥' : ''}保存在本机钥匙串中，页面不显示密钥。{!settings.signed && '尚未配置加签密钥。'}</p>
            </details>
          )}
        </div>
      </SettingRow>
      {editing && (local
        ? <WebhookForm onDone={(data) => (onSaved(data), setEditing(false), toast('机器人已保存'))} />
        : <p role="status" className="px-4 py-3 text-fs12 text-stone-500">请在运行 deck 的电脑上通过 127.0.0.1 打开本页配置机器人。</p>
      )}
    </>
  )
}

function WebhookForm({ onDone }: { onDone: (data: { settings: NotifySettings }) => void }) {
  const [url, setUrl] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function save() {
    setBusy(true)
    setError(null)
    try {
      onDone(await api.setWebhook(url, secret))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-2 bg-stone-50 px-4 py-3 dark:bg-stone-800/40">
      <p className="text-fs12 text-stone-500">机器人配置单独保存，立即生效；地址和密钥保存在本机钥匙串中。</p>
      <input value={url} onChange={(e) => setUrl(e.target.value)} disabled={busy} placeholder="https://oapi.dingtalk.com/robot/send?access_token=…" autoComplete="off" spellCheck={false} aria-label="Webhook" className={inputClass} />
      <input value={secret} onChange={(e) => setSecret(e.target.value)} disabled={busy} type="password" placeholder="加签密钥 SEC…" autoComplete="off" spellCheck={false} aria-label="加签密钥" className={inputClass} />
      {error && <p role="alert" className="text-fs12 text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex justify-end">
        <Button size="sm" variant="primary" onClick={() => void save()} disabled={busy || !url.trim()}>
          {busy ? '保存中…' : '保存机器人'}
        </Button>
      </div>
    </div>
  )
}
