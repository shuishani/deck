import clsx from 'clsx'
import { Bot, ChevronRight, ScrollText, User } from 'lucide-react'
import { Fragment, useState } from 'react'
import { api } from '../api'
import { EmptyState, ErrorBar, Skeleton } from '../components/Feedback'
import { fullTime, shortTime } from '../format'
import { useDeck, useLoad } from '../state'

const actions: Record<string, string> = {
  'project.add': '登记项目',
  'group.add': '添加监测群',
  'group.remove': '移除监测群',
  'message.send': '发送消息',
  'message.prune': '清理过期消息',
}

function pretty(detail: string) {
  try {
    return JSON.stringify(JSON.parse(detail), null, 2)
  } catch {
    return detail
  }
}

export function Log() {
  const { version } = useDeck()
  const { data, error, loading, reload } = useLoad(() => api.log(100), [version])
  const [open, setOpen] = useState<number | null>(null)
  const entries = [...(data?.entries ?? [])].reverse()

  return (
    <div className="space-y-4">
        {error && <ErrorBar message={error} onRetry={reload} />}
        {loading && (
          <div className="space-y-2 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        )}
        {!loading && !error && entries.length === 0 && (
          <EmptyState icon={<ScrollText className="size-5" />} title="还没有记录" />
        )}
        {entries.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full min-w-[720px] text-left">
                <thead className="border-b border-stone-100 bg-stone-50/80 text-fs12 text-stone-500 dark:border-stone-800 dark:bg-stone-800/40">
                  <tr>
                    <th className="w-8 px-3 py-2.5" />
                    <th className="px-3 py-2.5 font-medium">时间</th>
                    <th className="px-3 py-2.5 font-medium">执行者</th>
                    <th className="px-3 py-2.5 font-medium">动作</th>
                    <th className="px-3 py-2.5 font-medium">对象</th>
                    <th className="px-3 py-2.5 font-medium">结果</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                  {entries.map((entry) => {
                    const failed = entry.result !== 'ok' && !entry.result.startsWith('removed')
                    const expanded = open === entry.id
                    return (
                      <Fragment key={entry.id}>
                        <tr
                          onClick={() => setOpen(expanded ? null : entry.id)}
                          className="cursor-pointer hover:bg-stone-50/60 dark:hover:bg-stone-800/30"
                        >
                          <td className="px-3 py-2.5 text-stone-400">
                            <ChevronRight className={clsx('size-3.5 transition-transform', expanded && 'rotate-90')} />
                          </td>
                          <td className="px-3 py-2.5 text-fs13 whitespace-nowrap text-stone-500 tabular-nums" title={fullTime(entry.at)}>
                            {shortTime(entry.at)}
                          </td>
                          <td className="px-3 py-2.5">
                            {entry.actor === 'ai' ? (
                              <span className="inline-flex items-center gap-1 rounded-md bg-accent-50 px-1.5 py-0.5 text-fs12 font-medium text-accent-700 dark:bg-accent-500/15 dark:text-accent-500">
                                <Bot className="size-3" />
                                AI
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-md bg-stone-100 px-1.5 py-0.5 text-fs12 font-medium text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                                <User className="size-3" />我
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="font-medium">{actions[entry.action] ?? entry.action}</span>
                            <span className="ml-1.5 font-mono text-fs11 text-stone-400">{entry.action}</span>
                          </td>
                          <td className="max-w-[16rem] px-3 py-2.5">
                            <code className="block truncate font-mono text-fs12 text-stone-500" title={entry.target}>
                              {entry.target}
                            </code>
                          </td>
                          <td className="px-3 py-2.5">
                            <span
                              className={clsx(
                                'inline-block max-w-[18rem] truncate rounded-md px-1.5 py-0.5 text-fs12 font-medium',
                                failed
                                  ? 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300'
                                  : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
                              )}
                              title={entry.result}
                            >
                              {entry.result === 'ok' ? '成功' : entry.result}
                            </span>
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="bg-stone-50/60 dark:bg-stone-950/40">
                            <td />
                            <td colSpan={5} className="px-3 pt-1 pb-3">
                              <pre className="scroll-thin overflow-x-auto rounded-lg border border-stone-200 bg-white p-3 font-mono text-fs12 leading-relaxed text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300">
                                {pretty(entry.detail)}
                              </pre>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
    </div>
  )
}
