import clsx from 'clsx'
import { BellOff, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { api, type Group, type GroupRules, type Source } from '../../api'
import { useLoad, useData } from '../../state'
import { ErrorBar } from '../../components/Feedback'
import { GroupSettingsDialog } from '../../components/GroupSettingsDialog'
import { Section } from '../../components/SettingsLayout'
import { GroupFilterBar, NO_FILTER, filterGroups, type GroupFilter } from '../../components/GroupFilter'
import { SourceBadge, StatusDot, watchLabel, watchShort, watchTone } from '../../components/SourceBadge'

export const SCOPE: Record<Exclude<GroupRules['scope'], 'all'>, { label: string; tone: string }> = {
  mentions: { label: '仅 @我', tone: 'bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' },
  keywords: { label: '关键词', tone: 'bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300' },
  off: { label: '不提醒', tone: 'bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400' },
}
const CHATS = [
  { id: 'group', label: '群聊' },
  { id: 'direct', label: '单聊' },
] as const

const customReminder = (rules: GroupRules) => rules.scope !== 'all' || !!(rules.quiet_start && rules.quiet_end)

/** 设置 → 会话：所有群聊和单聊，点开改监听、AI、提醒和所属项目。 */
export function GroupList({ initialSource }: { initialSource?: Source }) {
  const { versions, overview } = useData()
  const groups = useLoad(() => api.groups(), [versions.groups, versions.health])
  const [editing, setEditing] = useState<Group | null>(null)
  const [filter, setFilter] = useState<GroupFilter>({ ...NO_FILTER, source: initialSource ?? 'all' })
  const [chat, setChat] = useState<'group' | 'direct'>('group')
  const projectName = (key: string) => overview?.find((p) => p.key === key)?.name ?? key
  const loaded = groups.data?.groups ?? []
  const all = loaded.filter((g) => g.chat === chat)
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
      id="chats"
      title="会话列表"
      description={
        <>
          点一个会话，改监听、AI 分析、提醒范围和所属项目。停止监听后不再拉取，已有消息保留。新群在项目里添加。
          {errors > 0 && <span className="text-red-600 dark:text-red-400"> {errors} 个会话监听异常，已标红并置顶。</span>}
        </>
      }
    >
      <div className="px-3 py-2.5">
        <GroupFilterBar
          groups={all}
          value={filter}
          onChange={setFilter}
          projects={projects.map((key) => ({ key, name: projectName(key) }))}
          fields={all.length ? undefined : []}
          placeholder={chat === 'group' ? '搜索群名或项目' : '搜索联系人'}
          leading={
            <div className="grid h-8 shrink-0 grid-cols-2 gap-1 rounded-lg bg-stone-100 p-1 max-md:h-10 dark:bg-stone-800/70" role="tablist" aria-label="会话类型">
              {CHATS.map((item) => (
                <button
                  key={item.id}
                  role="tab"
                  aria-selected={chat === item.id}
                  onClick={() => (setChat(item.id), setFilter({ ...NO_FILTER, source: filter.source }))}
                  className={clsx(
                    'inline-flex items-center justify-center gap-1 rounded-md px-3 text-fs12 font-medium transition-colors max-md:text-fs13',
                    chat === item.id
                      ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-900 dark:text-stone-100'
                      : 'text-stone-500 hover:text-stone-700 dark:hover:text-stone-300',
                  )}
                >
                  {item.label}
                  <span className="tabular-nums opacity-60">{loaded.filter((g) => g.chat === item.id).length}</span>
                </button>
              ))}
            </div>
          }
        />
      </div>
      {groups.error && (
        <div className="p-3">
          <ErrorBar message={groups.error} onRetry={groups.reload} />
        </div>
      )}
      {!groups.data && !groups.error && <p className="px-4 py-4 text-fs13 text-stone-400">加载中…</p>}
      {groups.data && all.length === 0 && (
        <p className="px-4 py-4 text-fs13 text-stone-400">{chat === 'group' ? '暂无监测的群，可在项目中添加。' : '还没有单聊，有人单聊你后会自动出现。'}</p>
      )}
      {all.length > 0 && rows.length === 0 && <p className="px-4 py-4 text-fs13 text-stone-400">没有匹配的会话</p>}
      {rows.length > 0 && (
        <div className="hidden items-center gap-3 bg-stone-50/60 px-4 py-1.5 text-fs11 text-stone-400 md:flex dark:bg-stone-950/30">
          <span className="w-8 shrink-0" />
          <span className="flex-1">会话</span>
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
              <span className="text-fs11 text-stone-400 tabular-nums">{section.rows.length} 个</span>
            </div>
          )}
          {section.rows.map((group) => (
            <GroupRow key={group.id} group={group} project={grouped || chat === 'direct' ? undefined : projectName(group.project)} onOpen={() => setEditing(group)} />
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
  const custom = customReminder(group.rules) || group.mode === 'listen'
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
        {group.mode === 'listen' && (
          <span className="rounded-full bg-stone-100 px-2 text-fs11 leading-5 text-stone-600 dark:bg-stone-800 dark:text-stone-300">AI 关</span>
        )}
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
