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
  MoreHorizontal,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { api, type Group, type GroupKind, type OverviewGroup, type OverviewProject } from '../api'
import { SectionHeader } from '../components/SettingsLayout'
import { sourceName } from '../platforms'
import { AddGroupDialog } from '../components/AddGroupDialog'
import { GroupSettingsDialog } from '../components/GroupSettingsDialog'
import { ProjectDialog } from '../components/ProjectDialog'
import { EmptyState, ErrorBar, Skeleton } from '../components/Feedback'
import { MessageItem } from '../components/MessageItem'
import { iconButton, PageHeader } from '../components/PageHeader'
import { CountBadge, SourceBadge, StatusDot, watchLabel, watchShort } from '../components/SourceBadge'
import { TaskBoard } from '../components/TaskBoard'
import { KindTag, RepoPath } from '../components/Tags'
import { ComingSoon } from '../components/ComingSoon'
import { useToast } from '../components/Toast'
import { Button, ConfirmDialog, Menu, Tabs } from '../components/ui'
import { relative, shortTime } from '../format'
import { href, navigate, type ProjectTab } from '../router'
import { taskDraftFrom, useLoad, useActions, useData } from '../state'
import { useTasks } from '../tasks'
import { MessagesPane } from './Messages'

const tabs: { id: ProjectTab; label: string }[] = [
  { id: 'overview', label: '概览' },
  { id: 'tasks', label: '任务' },
  { id: 'messages', label: '消息' },
  { id: 'fixes', label: '修复与部署' },
  { id: 'settings', label: '设置' },
]

export function ProjectHome({ projectKey, tab }: { projectKey: string; tab: ProjectTab }) {
  const { overview, overviewError, reloadOverview } = useData()
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
          title={`项目「${projectKey}」不存在`}
          action={
            <a href={href({ name: 'projects' })}>
              <Button>返回项目列表</Button>
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
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate" title={project.name}>{project.name}</span>
            <span className="shrink-0 rounded bg-stone-200/70 px-1.5 font-mono text-fs11 font-normal text-stone-600 dark:bg-stone-800 dark:text-stone-400">
              {project.key}
            </span>
          </span>
        }
        subtitle={
          project.repo ? (
            <span className="flex min-w-0 items-center gap-1 font-mono">
              <FolderGit2 className="size-3 shrink-0" />
              <RepoPath path={project.repo} />
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
        <div className={clsx('px-4 py-6 md:px-6', tab === 'tasks' ? 'max-w-7xl' : 'max-w-6xl')}>
          {tab === 'overview' && <OverviewTab project={project} />}
          {tab === 'tasks' && (
            <TaskBoard project={project.key} newButton />
          )}
          {tab === 'fixes' && <FixesTab />}
          {tab === 'settings' && <SettingsTab project={project} />}
        </div>
      </div>
    </div>
  )
}

function OverviewTab({ project }: { project: OverviewProject }) {
  const { versions } = useData()
  const { openReply, openTask } = useActions()
  const tasks = useTasks().filter((task) => task.project === project.key)
  const recent = useLoad(() => api.timeline({ project: project.key, limit: 5 }), [project.key, versions.messages])
  const today = project.groups.reduce((n, g) => n + g.today_count, 0)
  const doing = tasks.filter((t) => t.status === 'doing').length
  const open = tasks.filter((t) => t.status !== 'done').length

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="监测的群" value={project.groups.length} icon={<MessagesSquare className="size-4" />} />
        <Tile label="今日消息" value={today} icon={<Clock className="size-4" />} />
        <Tile label="需回复" value={project.awaiting_count} icon={<MessagesSquare className="size-4" />} alert />
        <Tile label="进行中任务" value={doing} hint={`共 ${open} 项未完成`} icon={<ListTodo className="size-4" />} />
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
            title="该项目暂无群"
            hint="添加要监测的群后，deck 会持续同步消息。"
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
          {recent.data?.messages.length === 0 && <p className="p-4 text-center text-fs13 text-stone-400">暂无消息</p>}
          {[...(recent.data?.messages ?? [])].reverse().map((message) => (
            <MessageItem
              key={message.id}
              message={message}
              showGroup
              variant="list"
              onReply={(m) =>
                openReply({ group: m.group_id, replyTo: m, handle: m.attention ? m.id : undefined })
              }
              onTask={(m) => openTask(taskDraftFrom([m], project.key))}
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
      {/* 说明放在数字同一行：各卡同高，不留空。 */}
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className={clsx('text-fs24 font-semibold tabular-nums', alert && value > 0 && 'text-red-600 dark:text-red-400')}>{value}</span>
        {hint && <span className="truncate text-fs12 text-stone-400">{hint}</span>}
      </div>
    </div>
  )
}

function SectionTitle({ title, action }: { title: string; action?: ReactNode }) {
  return <SectionHeader title={title} action={action} />
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
        <KindTag kind={group.kind} />
        <CountBadge count={group.awaiting_count} />
      </div>
      <div className="mt-3 rounded-lg bg-stone-50 px-3 py-2 text-fs13 dark:bg-stone-800/50">
        {last ? (
          <>
            <div className="flex justify-between text-fs12 text-stone-500">
              <span className="font-medium text-stone-700 dark:text-stone-300">{last.is_me ? '我' : last.sender_name}</span>
              <span className="tabular-nums">{shortTime(last.sent_at)}</span>
            </div>
            <p className="mt-0.5 truncate text-stone-600 dark:text-stone-300">{last.text.replace(/\s+/g, ' ') || '（无文本内容）'}</p>
          </>
        ) : (
          <p className="text-stone-400">暂无消息</p>
        )}
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-fs12 text-stone-500" title={watchLabel(group.watch)}>
        <StatusDot watch={group.watch} />
        {watchShort(group.watch)}
        <span className="text-stone-300">·</span>今日 {group.today_count} 条
        <span className="text-stone-300">·</span>
        {relative(group.watch.last_sync_at)}
      </div>
    </button>
  )
}

function GroupMenu({ group, onSettings, onRemove }: { group: Group; onSettings: () => void; onRemove: () => void }) {
  const { bump } = useActions()
  const toast = useToast()
  const next: GroupKind = group.kind === 'prod' ? 'test' : 'prod'

  async function setKind() {
    try {
      await api.setGroupKind(group.id, next)
      toast(`已将「${group.name}」设为${next === 'prod' ? '正式群' : '测试群'}`)
      bump()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  return (
    <Menu
      trigger={(toggle) => (
        <button onClick={toggle} className={iconButton} aria-label={`「${group.name}」的更多操作`}>
          <MoreHorizontal className="size-4" />
        </button>
      )}
      items={[
        { label: '群设置', onClick: onSettings },
        { label: next === 'prod' ? '设为正式群（发送前二次确认）' : '设为测试群', onClick: () => void setKind() },
        'divider',
        { label: '停止监测…', onClick: onRemove, danger: true },
      ]}
    />
  )
}

function FixesTab() {
  const levels = [
    { id: 'L0', name: '自动', text: '文案、样式、配置等小范围改动且有测试覆盖：AI 修复、测试并部署到测试环境，上线正式环境前需批准。' },
    { id: 'L1', name: 'AI 修复，人工审核', text: '涉及业务逻辑：AI 修复并运行测试，改动进入收件箱，待批准或退回。' },
    { id: 'L2', name: '只分析', text: '原因不明或改动面较大：AI 提供原因分析、复现步骤和方案，由人工决定。' },
    { id: 'L3', name: '禁止改动', text: '权限、支付、数据迁移、安全、生产配置：仅创建任务并通知。' },
  ]
  return (
    <div className="space-y-4">
      <ComingSoon title="AI 修复与部署" icon={<GitPullRequest className="size-4" />}>
        群内的 bug 反馈先转为任务，再按以下分级交由 AI 处理。AI 自评的级别会根据改动行数、是否涉及禁区和测试结果复核，不满足条件则降级。初期每次部署均需人工审核。
      </ComingSoon>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
  const { versions } = useData()
  const { bump } = useActions()
  const toast = useToast()
  const groups = useLoad(() => api.groups(), [versions.groups, versions.health])
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<Group | null>(null)
  const [editing, setEditing] = useState(false)
  const [groupSettings, setGroupSettings] = useState<Group | null>(null)
  const [busy, setBusy] = useState(false)
  const mine = (groups.data?.groups ?? []).filter((g) => g.project === project.key)

  async function remove() {
    if (!removing) return
    setBusy(true)
    try {
      await api.removeGroup(removing.id)
      toast(`已停止监测「${removing.name}」`)
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
        <SectionTitle title="项目信息" action={<Button size="sm" onClick={() => setEditing(true)}>编辑项目</Button>} />
        <p className="text-fs13 text-stone-500">{project.name} · {project.repo || '未关联仓库'}。简称 {project.key} 保持不变。</p>
      </section>
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
          <EmptyState icon={<MessagesSquare className="size-5" />} title="暂无群" hint="添加要监测的群后，deck 会持续同步消息。" />
        )}
        {mine.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
            <ul className="divide-y divide-stone-100 dark:divide-stone-800">
              {mine.map((group) => (
                <li key={group.id} className="flex items-center gap-1 pr-2">
                  <button
                    onClick={() => setGroupSettings(group)}
                    className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 text-left hover:bg-stone-50 dark:hover:bg-stone-800/40"
                    title="群设置：提醒范围、免打扰、所属项目"
                  >
                    <SourceBadge source={group.source} className="!size-8 !rounded-lg" />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 font-medium [overflow-wrap:anywhere]">{group.name}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-fs12 text-stone-500">
                        <span>{sourceName(group.source)}</span>
                        <span className="text-stone-300">·</span>
                        <span className="inline-flex items-center gap-1" title={watchLabel(group.watch)}>
                          <StatusDot watch={group.watch} />
                          {watchShort(group.watch)}
                        </span>
                        <span className="text-stone-300">·</span>
                        <span className={clsx(group.kind === 'prod' && 'text-stone-700 dark:text-stone-300')}>
                          {group.kind === 'prod' ? '正式群' : '测试群'}
                        </span>
                      </span>
                    </span>
                  </button>
                  <GroupMenu group={group} onSettings={() => setGroupSettings(group)} onRemove={() => setRemoving(group)} />
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="mt-2 text-fs12 text-stone-400">新增群时按群名识别类型：含 TEST 或「测试」为测试群，其余为正式群。向正式群发送前需二次确认。</p>
      </section>

      {editing && <ProjectDialog open project={project} onClose={() => setEditing(false)} />}
      {groupSettings && <GroupSettingsDialog group={groupSettings} onClose={() => setGroupSettings(null)} />}
      <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <ComingSoon title="AI 禁止改动的目录" icon={<ShieldCheck className="size-4" />}>
          指定 AI 修复时禁止改动的路径，例如支付、权限、数据库迁移。涉及这些路径的改动将自动降级为「只分析」。
        </ComingSoon>
        <ComingSoon title="知识库" icon={<BookOpen className="size-4" />}>
          存放项目背景、常见问题和答复口径，供 AI 起草回复和分析问题时参考。
        </ComingSoon>
      </section>

      <AddGroupDialog open={adding} onClose={() => setAdding(false)} defaultProject={project.key} />
      <ConfirmDialog
        open={!!removing}
        title="停止监测该群"
        confirmLabel="移除"
        busy={busy}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
      >
        移除「{removing?.name}」后，deck 将停止同步该群消息，<strong className="text-stone-900 dark:text-stone-100">本地已保存的消息也将一并删除</strong>。群本身不受影响。
      </ConfirmDialog>
    </div>
  )
}
