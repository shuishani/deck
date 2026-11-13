import { Search } from 'lucide-react'
import type { Source } from '../api'
import { SOURCES, sourceName } from '../platforms'
import { SourceBadge } from './SourceBadge'
import { Chips, Select } from './ui'

/** 未归入任何项目的群。 */
export const UNASSIGNED = '__unassigned__'

export interface GroupFilter {
  query: string
  /** 'all'、项目 key 或 UNASSIGNED */
  project: string
  source: 'all' | Source
}

export const NO_FILTER: GroupFilter = { query: '', project: 'all', source: 'all' }

interface Filterable {
  name: string
  source: Source
  project: string | null
}

export type FilterField = keyof GroupFilter

function matches(group: Filterable, filter: GroupFilter, field: FilterField, projectName: (key: string) => string) {
  if (field === 'source') return filter.source === 'all' || group.source === filter.source
  if (field === 'project')
    return filter.project === 'all' || (filter.project === UNASSIGNED ? !group.project : group.project === filter.project)
  const q = filter.query.trim().toLowerCase()
  return !q || group.name.toLowerCase().includes(q) || (!!group.project && projectName(group.project).toLowerCase().includes(q))
}

/** 按筛选条件过滤；fields 限定只看哪几项（例如待处理列表只按平台筛）。 */
export function filterGroups<G extends Filterable>(
  groups: G[],
  filter: GroupFilter,
  projectName: (key: string) => string,
  fields: FilterField[] = ['query', 'project', 'source'],
  skip?: FilterField,
): G[] {
  return groups.filter((g) => fields.every((field) => field === skip || matches(g, filter, field, projectName)))
}

/**
 * 搜索框 + 项目下拉 + 平台标签。每一项的计数只受其余几项筛选影响，
 * 选了项目后平台数量随之变化，反之亦然。
 */
export function GroupFilterBar({
  groups,
  value,
  onChange,
  projects,
  fields = ['query', 'project', 'source'],
  placeholder = '搜索群名或项目',
  counts,
}: {
  groups: Filterable[]
  value: GroupFilter
  onChange: (value: GroupFilter) => void
  /** 下拉里的项目（按显示顺序）；少于两个时不显示下拉。 */
  projects: { key: string; name: string }[]
  fields?: FilterField[]
  placeholder?: string
  /** 平台标签上显示的数量；不给时数群。 */
  counts?: (source: 'all' | Source) => number
}) {
  const projectName = (key: string) => projects.find((p) => p.key === key)?.name ?? key
  const count = (skip: FilterField, test: (g: Filterable) => boolean) =>
    filterGroups(groups, value, projectName, fields, skip).filter(test).length
  const unassigned = groups.some((g) => !g.project)
  const projectOptions = [
    { id: 'all', label: '全部项目', hint: count('project', () => true) },
    ...projects.map((p) => ({ id: p.key, label: p.name, hint: count('project', (g) => g.project === p.key) })),
    ...(unassigned ? [{ id: UNASSIGNED, label: '未归类', hint: count('project', (g) => !g.project) }] : []),
  ]
  const present = SOURCES.filter((s) => groups.some((g) => g.source === s))
  const sourceOptions = [
    { id: 'all' as const, label: '全部', count: counts ? counts('all') : count('source', () => true) },
    ...present.map((s) => ({
      id: s,
      label: (
        <span className="inline-flex items-center gap-1.5">
          <SourceBadge source={s} className="!size-4 !text-fs9" />
          {sourceName(s)}
        </span>
      ),
      count: counts ? counts(s) : count('source', (g) => g.source === s),
    })),
  ]
  const showSearch = fields.includes('query')
  const showProject = fields.includes('project') && projectOptions.length > 2

  return (
    <div className="space-y-2">
      {(showSearch || showProject) && (
        <div className="flex gap-1.5">
          {showSearch && (
            <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg bg-stone-100 px-2.5 max-md:h-10 max-md:px-3 dark:bg-stone-800">
              <Search className="size-3.5 shrink-0 text-stone-400 max-md:size-4" />
              <input
                value={value.query}
                onChange={(event) => onChange({ ...value, query: event.target.value })}
                placeholder={placeholder}
                aria-label="搜索群"
                className="min-w-0 flex-1 bg-transparent text-fs13 outline-none placeholder:text-stone-400"
              />
            </label>
          )}
          {showProject && (
            <Select
              value={value.project}
              options={projectOptions}
              onChange={(project) => onChange({ ...value, project })}
              label="按项目筛选"
              className="h-8 max-w-[10.5rem] shrink-0 rounded-lg bg-stone-100 px-2.5 text-fs12 text-stone-600 max-md:h-10 max-md:px-3 max-md:text-fs13 dark:bg-stone-800 dark:text-stone-300"
            />
          )}
        </div>
      )}
      {fields.includes('source') && present.length > 1 && (
        <Chips value={value.source} options={sourceOptions} onChange={(source) => onChange({ ...value, source })} />
      )}
    </div>
  )
}
