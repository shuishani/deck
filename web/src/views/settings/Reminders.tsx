import clsx from 'clsx'
import { BellOff, ChevronRight, X } from 'lucide-react'
import { useState } from 'react'
import { api, type Config, type Group, type Source } from '../../api'
import { useLoad, useData } from '../../state'
import { ErrorBar } from '../../components/Feedback'
import { GroupSettingsDialog } from '../../components/GroupSettingsDialog'
import { Modified, SaveBar, Section, SettingRow, numberInput, useSettingsSave } from '../../components/SettingsLayout'
import { GroupFilterBar, NO_FILTER, filterGroups, type GroupFilter } from '../../components/GroupFilter'
import { SourceBadge, StatusDot, watchLabel, watchShort, watchTone } from '../../components/SourceBadge'

const SCOPE = {
  mentions: { label: '仅 @我', tone: 'bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' },
  keywords: { label: '关键词', tone: 'bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300' },
} as const

/** 设置 → 群与提醒：全局默认规则，下面是所有监测群的唯一完整列表。 */
export function Reminders({ source }: { source?: Source }) {
  const { config } = useData()
  if (!config) return <div className="h-40 animate-pulse rounded-xl bg-stone-200/70 dark:bg-stone-800" />
  return (
    <div className="space-y-8">
      <Defaults config={config} />
      <GroupList initialSource={source} />
    </div>
  )
}

function Defaults({ config }: { config: Config }) {
  const [hours, setHours] = useState<string | null>(null)
  const [names, setNames] = useState<string[] | null>(null)
  const { save, busy, error, setError } = useSettingsSave()
  const parsed = Number(hours)
  const hoursProblem = hours !== null && (!hours.trim() || !Number.isFinite(parsed) || parsed <= 0 || parsed > 8760) ? '超时时间须为 0～8760 小时' : null
  const dirty = hours !== null || names !== null

  function cancel() {
    setHours(null)
    setNames(null)
    setError(null)
  }
  async function submit() {
    if (hoursProblem) return
    const ok = await save(
      { ...(hours !== null ? { reply_reminder_hours: parsed } : {}), ...(names !== null ? { ignore_senders: names } : {}) },
      '提醒设置已保存',
    )
    if (ok) cancel()
  }
  const reset = (field: 'reply_reminder_hours' | 'ignore_senders') => void save({ reset: [field] }, '已恢复默认值')

  return (
    <Section title="默认规则" description="对所有群生效；单个群可以在下方单独设置，群的设置优先。">
      <div className="grid divide-y divide-stone-100 lg:grid-cols-2 lg:divide-x lg:divide-y-0 dark:divide-stone-800">
      <SettingRow
        stacked
        label="@我 多久没回算超时"
        hint="有人 @你或回复你，超过这个时间你还没在该群说话，「需回复」里会标为超时。"
        badge={
          config.overridden.includes('reply_reminder_hours') &&
          hours === null && <Modified defaultText={`${config.defaults.reply_reminder_hours ?? 2} 小时`} onReset={() => reset('reply_reminder_hours')} disabled={busy} />
        }
      >
        <label className="flex items-center gap-2 text-fs13 text-stone-500">
          <input
            type="number"
            inputMode="decimal"
            min="0.5"
            max="8760"
            step="0.5"
            value={hours ?? config.reply_reminder_hours}
            onChange={(event) => setHours(event.target.value)}
            aria-invalid={!!hoursProblem}
            aria-label="超时小时数"
            className={clsx(numberInput, hoursProblem && '!border-red-400')}
          />
          小时
        </label>
      </SettingRow>
      <SettingRow
        stacked
        label="不提醒的发送人"
        hint="按姓名完全匹配，适合通知机器人。消息仍会保存，只是不算未读、不进「需回复」。"
        badge={
          config.overridden.includes('ignore_senders') &&
          names === null && (
            <Modified
              defaultText={config.defaults.ignore_senders?.length ? config.defaults.ignore_senders.join('、') : '（无）'}
              onReset={() => reset('ignore_senders')}
              disabled={busy}
            />
          )
        }
      >
        <NameList value={names ?? config.ignore_senders} onChange={setNames} />
      </SettingRow>
      </div>
      {dirty && <SaveBar busy={busy} disabled={!!hoursProblem} error={hoursProblem ?? error} onCancel={cancel} onSave={() => void submit()} />}
    </Section>
  )
}

/** 姓名标签：回车或逗号添加，× 删除。 */
function NameList({ value, onChange }: { value: string[]; onChange: (names: string[]) => void }) {
  const [text, setText] = useState('')
  function add() {
    const name = text.trim()
    if (name && !value.includes(name)) onChange([...value, name])
    setText('')
  }
  return (
    <div className="flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-lg border border-stone-200 bg-white p-1.5 focus-within:border-accent-500 focus-within:ring-2 focus-within:ring-accent-500/20 dark:border-stone-700 dark:bg-stone-950">
      {value.map((name) => (
        <span key={name} className="inline-flex max-w-full items-center gap-1 rounded-md bg-stone-100 py-0.5 pr-1 pl-2 text-fs12 text-stone-700 dark:bg-stone-800 dark:text-stone-200">
          <span className="truncate">{name}</span>
          <button onClick={() => onChange(value.filter((n) => n !== name))} aria-label={`移除 ${name}`} className="rounded p-0.5 text-stone-400 hover:bg-stone-200 hover:text-stone-700 dark:hover:bg-stone-700">
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Enter' || event.key === ',' || event.key === '，') {
            event.preventDefault()
            add()
          } else if (event.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1))
        }}
        onBlur={add}
        placeholder={value.length ? '添加…' : '输入姓名后回车'}
        className="min-w-24 flex-1 bg-transparent px-1 text-fs13 outline-none placeholder:text-stone-400"
      />
    </div>
  )
}

function GroupList({ initialSource }: { initialSource?: Source }) {
  const { versions, overview } = useData()
  const groups = useLoad(() => api.groups(), [versions.groups, versions.health])
  const [editing, setEditing] = useState<Group | null>(null)
  const [filter, setFilter] = useState<GroupFilter>({ ...NO_FILTER, source: initialSource ?? 'all' })
  const projectName = (key: string) => overview?.find((p) => p.key === key)?.name ?? key
  const all = groups.data?.groups ?? []
  const order = (key: string) => {
    const index = overview?.findIndex((p) => p.key === key) ?? -1
    return index < 0 ? Infinity : index
  }
  const projects = [...new Set(all.map((g) => g.project))].sort((a, b) => order(a) - order(b))
  const rows = filterGroups(all, filter, projectName).sort(
    (a, b) => Number(watchTone(b.watch) === 'error') - Number(watchTone(a.watch) === 'error'),
  )
  const grouped = filter.project === 'all' && new Set(rows.map((g) => g.project)).size > 1
  const sections = grouped
    ? projects.map((key) => ({ key, rows: rows.filter((g) => g.project === key) })).filter((section) => section.rows.length)
    : [{ key: null, rows }]
  const errors = all.filter((g) => watchTone(g.watch) === 'error').length

  return (
    <Section
      title={`监测的群${all.length ? ` · ${all.length}` : ''}`}
      description={
        <>
          提醒范围和免打扰只影响提醒和待处理，消息仍会完整保存。群在项目里添加。
          {errors > 0 && <span className="text-red-600 dark:text-red-400"> {errors} 个群监听异常，已标红并排在前面。</span>}
        </>
      }
    >
      {all.length > 0 && (
        <div className="px-3 py-2.5">
          <GroupFilterBar
            groups={all}
            value={filter}
            onChange={setFilter}
            projects={projects.map((key) => ({ key, name: projectName(key) }))}
          />
        </div>
      )}
      {groups.error && (
        <div className="p-3">
          <ErrorBar message={groups.error} onRetry={groups.reload} />
        </div>
      )}
      {!groups.data && !groups.error && <p className="px-4 py-4 text-fs13 text-stone-400">加载中…</p>}
      {groups.data && all.length === 0 && <p className="px-4 py-4 text-fs13 text-stone-400">还没有监测的群，可在项目中添加。</p>}
      {all.length > 0 && rows.length === 0 && <p className="px-4 py-4 text-fs13 text-stone-400">没有匹配的群</p>}
      {rows.length > 0 && (
        <div className="hidden items-center gap-3 bg-stone-50/60 px-4 py-1.5 text-fs11 text-stone-400 md:flex dark:bg-stone-950/30">
          <span className="w-8 shrink-0" />
          <span className="flex-1">群</span>
          <span className="w-28 shrink-0">监听</span>
          <span className="w-52 shrink-0 text-right">提醒</span>
          <span className="w-4 shrink-0" />
        </div>
      )}
      {sections.map((section) => (
        <div key={section.key ?? 'all'} className="divide-y divide-stone-100 dark:divide-stone-800">
          {section.key !== null && (
            <div className="flex items-baseline gap-2 px-4 pt-3 pb-1.5">
              <span className="text-fs12 font-semibold text-stone-700 dark:text-stone-200">{projectName(section.key)}</span>
              <span className="text-fs11 text-stone-400 tabular-nums">{section.rows.length} 个群</span>
            </div>
          )}
          {section.rows.map((group) => (
            <GroupRow key={group.id} group={group} project={grouped ? undefined : projectName(group.project)} onOpen={() => setEditing(group)} />
          ))}
        </div>
      ))}
      {editing && <GroupSettingsDialog group={editing} onClose={() => setEditing(null)} />}
    </Section>
  )
}

function GroupRow({ group, project, onOpen }: { group: Group; project?: string; onOpen: () => void }) {
  const { scope, keywords, quiet_start, quiet_end } = group.rules
  const error = watchTone(group.watch) === 'error'
  const custom = scope !== 'all' || (quiet_start && quiet_end)
  const status = (
    <span className={clsx('inline-flex items-center gap-1.5', error && 'text-red-600 dark:text-red-400')} title={watchLabel(group.watch)}>
      <StatusDot watch={group.watch} />
      {watchShort(group.watch)}
    </span>
  )
  return (
    <button onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-stone-50 dark:hover:bg-stone-800/40">
      <SourceBadge source={group.source} className="!size-8 shrink-0 !rounded-lg" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-fs14 font-medium">{group.name}</span>
        <span className="flex items-center gap-1.5 text-fs12 text-stone-500">
          {project && <span className="truncate">{project}</span>}
          <span className="shrink-0 md:hidden">
            {project && '· '}
            {status}
          </span>
        </span>
      </span>
      <span className="hidden w-28 shrink-0 text-fs12 text-stone-600 md:block dark:text-stone-300">{status}</span>
      <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 md:w-52">
        {!custom && <span className="text-fs12 text-stone-400">默认</span>}
        {scope !== 'all' && (
          <span className={clsx('rounded-full px-2 text-fs11 leading-5 font-medium', SCOPE[scope].tone)} title={scope === 'keywords' ? keywords.join('、') : undefined}>
            {SCOPE[scope].label}
            {scope === 'keywords' && keywords.length > 0 && ` · ${keywords.length}`}
          </span>
        )}
        {quiet_start && quiet_end && (
          <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 text-fs11 leading-5 text-stone-600 dark:bg-stone-800 dark:text-stone-300">
            <BellOff className="size-3" />
            {quiet_start === quiet_end ? '全天' : `${quiet_start}–${quiet_end}`}
          </span>
        )}
      </span>
      <ChevronRight className="size-4 shrink-0 text-stone-300 dark:text-stone-600" />
    </button>
  )
}
