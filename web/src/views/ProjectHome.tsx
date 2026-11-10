import clsx from 'clsx'
import {
  BookOpen,
  Clock,
  FolderGit2,
  FolderX,
  GitPullRequest,
  ListTodo,
  MessagesSquare,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { api, type Group, type OverviewGroup, type OverviewProject } from '../api'
import { AddGroupDialog } from '../components/AddGroupDialog'
import { EmptyState, ErrorBar, Skeleton } from '../components/Feedback'
import { MessageItem } from '../components/MessageItem'
import { PageHeader } from '../components/PageHeader'
import { CountBadge, SourceBadge, StatusDot, sourceName, watchLabel } from '../components/SourceBadge'
import { MockNotice, TaskBoard } from '../components/TaskBoard'
import { KindTag } from '../components/Tags'
import { ComingSoon } from '../mock/ComingSoon'
import { useToast } from '../components/Toast'
import { Button, ConfirmDialog, Tabs } from '../components/ui'
import { relative, shortTime } from '../format'
import { useTasks } from '../mock/tasks'
import { href, navigate, type ProjectTab } from '../router'
import { taskSource, taskTitle, useDeck, useLoad } from '../state'
import { MessagesPane } from './Messages'

const tabs: { id: ProjectTab; label: string }[] = [
  { id: 'overview', label: '概览' },
  { id: 'tasks', label: '任务' },
  { id: 'messages', label: '消息' },
  { id: 'fixes', label: '修复与部署' },
  { id: 'settings', label: '设置' },
]

export function ProjectHome({ projectKey, tab }: { projectKey: string; tab: ProjectTab }) {
  const { overview, overviewError, reloadOverview } = useDeck()
  const [group, setGroup] = useState<number | undefined>()
  const project = overview?.find((p) => p.key === projectKey)

  if (overviewError) {
    return (
      <div className="p-6">
        <ErrorBar message={overviewError} onRetry={reloadOverview} />
      </div>
    )
  }
  if (!overview) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }
  if (!project) {
    return (
      <div className="p-6">
        <EmptyState
          icon={<FolderX className="size-5" />}
          title={`没有项目「${projectKey}」`}
          action={
            <a href={href({ name: 'projects' })}>
              <Button>回到项目列表</Button>
            </a>
          }
        />
      </div>
    )
  }

  const header = (
    <div className={clsx(tab === 'messages' && group !== undefined && 'max-md:hidden')}>
      <PageHeader
        back={{ href: href({ name: 'projects' }), label: '项目' }}
        title={
          <span className="flex items-center gap-2">
            {project.name}
            <span className="rounded bg-stone-200/70 px-1.5 font-mono text-fs11 font-normal text-stone-600 dark:bg-stone-800 dark:text-stone-400">
              {project.key}
            </span>
          </span>
        }
        subtitle={
          project.repo ? (
            <span className="inline-flex items-center gap-1 font-mono">
              <FolderGit2 className="size-3" />
              {project.repo}
            </span>
          ) : (
            '未关联仓库'
          )
        }
        syncProject={project.key}
      >
        <Tabs
          value={tab}
          options={tabs}
          hrefOf={(id) => href({ name: 'project', key: project.key, tab: id })}
          className="px-2 md:px-4"
        />
      </PageHeader>
    </div>
  )

  if (tab === 'messages') {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {header}
        <MessagesPane project={project.key} selected={group} onSelect={setGroup} />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className={clsx('mx-auto px-4 py-6 md:px-6', tab === 'tasks' ? 'max-w-7xl' : 'max-w-6xl')}>
          {tab === 'overview' && <OverviewTab project={project} />}
          {tab === 'tasks' && (
            <div className="space-y-4">
              <MockNotice />
              <TaskBoard project={project.key} />
            </div>
          )}
          {tab === 'fixes' && <FixesTab />}
          {tab === 'settings' && <SettingsTab project={project} />}
        </div>
      </div>
    </div>
  )
}

function OverviewTab({ project }: { project: OverviewProject }) {
  const { version, openSend, openTask } = useDeck()
  const tasks = useTasks().filter((task) => task.project === project.key)
  const recent = useLoad(() => api.timeline({ project: project.key, limit: 5 }), [project.key, version])
  const today = project.groups.reduce((n, g) => n + g.today_count, 0)
  const doing = tasks.filter((t) => t.status === 'doing').length
  const open = tasks.filter((t) => t.status !== 'done').length

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="监测的群" value={project.groups.length} icon={<MessagesSquare className="size-4" />} />
        <Tile label="今日消息" value={today} icon={<Clock className="size-4" />} />
        <Tile label="待我回复" value={project.awaiting_count} icon={<MessagesSquare className="size-4" />} alert />
        <Tile label="进行中任务" value={doing} hint={`共 ${open} 件未完成`} icon={<ListTodo className="size-4" />} />
      </div>

      <section>
        <SectionTitle
          title="群"
          action={
            <a href={href({ name: 'project', key: project.key, tab: 'settings' })} className="text-fs12 text-accent-600 hover:underline">
              管理群
            </a>
          }
        />
        {project.groups.length === 0 ? (
          <EmptyState
            icon={<MessagesSquare className="size-5" />}
            title="这个项目还没有群"
            hint="去「设置」把相关的钉钉群或 channel 频道加进来。"
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {project.groups.map((group) => (
              <GroupCard key={group.id} group={group} />
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionTitle
          title="最近消息"
          action={
            <a href={href({ name: 'project', key: project.key, tab: 'messages' })} className="text-fs12 text-accent-600 hover:underline">
              查看全部
            </a>
          }
        />
        <div className="rounded-xl border border-stone-200 bg-white p-1.5 dark:border-stone-800 dark:bg-stone-900">
          {recent.error && <ErrorBar message={recent.error} onRetry={recent.reload} />}
          {recent.loading && <Skeleton className="m-2 h-20" />}
          {recent.data?.messages.length === 0 && <p className="p-4 text-center text-fs13 text-stone-400">还没有消息</p>}
          {[...(recent.data?.messages ?? [])].reverse().map((message) => (
            <MessageItem
              key={message.id}
              message={message}
              showGroup
              onReply={(m) => openSend({ group: m.group_id, groupName: m.group_name, source: m.source, replyTo: m })}
              onTask={(m) => openTask({ title: taskTitle(m.text), project: project.key, source: taskSource(m) })}
            />
          ))}
        </div>
      </section>
    </div>
  )
}

function Tile({
  label,
  value,
  icon,
  hint,
  alert,
}: {
  label: string
  value: number
  icon: ReactNode
  hint?: string
  alert?: boolean
}) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <div className="flex items-center gap-1.5 text-fs12 text-stone-500">
        <span className="text-stone-400">{icon}</span>
        {label}
      </div>
      <div className={clsx('mt-1.5 text-fs24 font-semibold tabular-nums', alert && value > 0 && 'text-red-600 dark:text-red-400')}>
        {value}
      </div>
      {hint && <div className="text-fs12 text-stone-400">{hint}</div>}
    </div>
  )
}

function SectionTitle({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-fs14 font-semibold">{title}</h2>
      {action}
    </div>
  )
}

function GroupCard({ group }: { group: OverviewGroup }) {
  const last = group.last_message
  return (
    <button
      onClick={() => navigate({ name: 'messages', group: group.id })}
      className="flex flex-col rounded-xl border border-stone-200 bg-white p-4 text-left transition-all hover:border-stone-300 hover:shadow-sm dark:border-stone-800 dark:bg-stone-900 dark:hover:border-stone-700"
    >
      <div className="flex items-center gap-2">
        <SourceBadge source={group.source} />
        <span className="min-w-0 flex-1 truncate font-semibold">{group.name}</span>
        <KindTag name={group.name} />
        <CountBadge count={group.awaiting_count} />
      </div>
      <div className="mt-3 rounded-lg bg-stone-50 px-3 py-2 text-fs13 dark:bg-stone-800/50">
        {last ? (
          <>
            <div className="flex justify-between text-fs12 text-stone-500">
              <span className="font-medium text-stone-700 dark:text-stone-300">{last.is_me ? '我' : last.sender_name}</span>
              <span className="tabular-nums">{shortTime(last.sent_at)}</span>
            </div>
            <p className="mt-0.5 truncate text-stone-600 dark:text-stone-300">{last.text.replace(/\s+/g, ' ') || '（无文本）'}</p>
          </>
        ) : (
          <p className="text-stone-400">还没有消息</p>
        )}
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-fs12 text-stone-500" title={watchLabel(group.watch)}>
        <StatusDot watch={group.watch} />
        {group.watch.error ? '出错' : group.watch.mode === 'realtime' ? '实时' : '轮询'}
        <span className="text-stone-300">·</span>今日 {group.today_count} 条
        <span className="text-stone-300">·</span>
        {relative(group.watch.last_sync_at)}
      </div>
    </button>
  )
}

function FixesTab() {
  const levels = [
    { id: 'L0', name: '自动', text: '文案、样式、配置等小改，有测试覆盖：AI 修复、测试、部署到测试环境，上正式前等你批准。' },
    { id: 'L1', name: 'AI 修、你审', text: '改到逻辑：AI 修复并跑测试，改动进收件箱等你批准或打回。' },
    { id: 'L2', name: '只分析', text: '原因不清或要改多处：AI 给出原因、复现步骤和方案，由你决定。' },
    { id: 'L3', name: '不碰', text: '权限、支付、数据迁移、安全、生产配置：只建任务并通知你。' },
  ]
  return (
    <div className="space-y-4">
      <ComingSoon title="AI 修复与部署" icon={<GitPullRequest className="size-4" />}>
        群里的 bug 反馈会先转成任务，再按下面的分级交给 AI 处理。AI 自评的级别会用改动行数、是否碰到禁区、测试结果再核一遍，不满足就降级；部署起步每次都要你审核。
      </ComingSoon>
      <div className="grid gap-3 md:grid-cols-2">
        {levels.map((level) => (
          <div key={level.id} className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-stone-900 px-1.5 font-mono text-fs12 font-semibold text-white dark:bg-stone-100 dark:text-stone-900">
                {level.id}
              </span>
              <span className="font-semibold">{level.name}</span>
            </div>
            <p className="mt-2 text-fs13 leading-relaxed text-stone-500 dark:text-stone-400">{level.text}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function SettingsTab({ project }: { project: OverviewProject }) {
  const { version, bump } = useDeck()
  const toast = useToast()
  const groups = useLoad(() => api.groups(), [version])
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<Group | null>(null)
  const [busy, setBusy] = useState(false)
  const mine = (groups.data?.groups ?? []).filter((g) => g.project === project.key)

  async function remove() {
    if (!removing) return
    setBusy(true)
    try {
      await api.removeGroup(removing.id)
      toast(`已不再监测「${removing.name}」`)
      setRemoving(null)
      bump()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <SectionTitle
          title="监测的群"
          action={
            <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
              <Plus className="size-3.5" />
              添加群
            </Button>
          }
        />
        {groups.error && <ErrorBar message={groups.error} onRetry={groups.reload} />}
        {groups.loading && <Skeleton className="h-24 w-full" />}
        {groups.data && mine.length === 0 && (
          <EmptyState icon={<MessagesSquare className="size-5" />} title="还没有群" hint="添加钉钉群或 channel 频道，deck 会持续拉取消息。" />
        )}
        {mine.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
            <ul className="divide-y divide-stone-100 dark:divide-stone-800">
              {mine.map((group) => (
                <li key={group.id} className="flex items-center gap-3 px-4 py-3">
                  <SourceBadge source={group.source} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{group.name}</span>
                      <KindTag name={group.name} />
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-fs12 text-stone-500">
                      <span>{sourceName(group.source)}</span>
                      <span className="text-stone-300">·</span>
                      <code className="truncate font-mono text-fs11" title={group.remote_id}>
                        {group.remote_id}
                      </code>
                    </div>
                  </div>
                  <span className="hidden items-center gap-1.5 text-fs12 text-stone-500 sm:inline-flex" title={watchLabel(group.watch)}>
                    <StatusDot watch={group.watch} />
                    {group.watch.error ? '出错' : group.watch.mode === 'realtime' ? '实时' : '轮询'}
                  </span>
                  <button
                    onClick={() => setRemoving(group)}
                    className="rounded-md p-1.5 text-stone-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                    title="不再监测"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="mt-2 text-fs12 text-stone-400">「正式 / 测试」目前按群名里是否含 TEST、测试 自动判断，以后可以手动设。</p>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <ComingSoon title="AI 不许碰的目录" icon={<ShieldCheck className="size-4" />}>
          列出 AI 修复时禁止改动的路径，比如支付、权限、数据库迁移。碰到这些目录的改动会自动降到「只分析」。
        </ComingSoon>
        <ComingSoon title="知识库" icon={<BookOpen className="size-4" />}>
          放项目背景、常见问题和答复口径，AI 起草回复和分析问题时会先参考这里。
        </ComingSoon>
      </section>

      <AddGroupDialog open={adding} onClose={() => setAdding(false)} defaultProject={project.key} />
      <ConfirmDialog
        open={!!removing}
        title="不再监测这个群"
        confirmLabel="移除"
        busy={busy}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
      >
        移除「{removing?.name}」后，deck 不再拉它的消息，<strong className="text-stone-900 dark:text-stone-100">本地保存的消息也会一起删除</strong>。群本身不受影响。
      </ConfirmDialog>
    </div>
  )
}
