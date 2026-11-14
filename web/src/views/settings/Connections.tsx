import clsx from 'clsx'
import { AlertTriangle, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { api, type Source, type SourceHealth } from '../../api'
import { ErrorBar } from '../../components/Feedback'
import { SectionHeader, numberInput, useSettingsSave } from '../../components/SettingsLayout'
import { SourceBadge, watchTone } from '../../components/SourceBadge'
import { useToast } from '../../components/Toast'
import { Switch } from '../../components/ui'
import { shortTime, shortVersion } from '../../format'
import { PLATFORMS, type Platform } from '../../platforms'
import { useLoad, type GroupInfo, useActions, useData } from '../../state'
import { GroupList } from './Chats'
import { Retention } from './Retention'

/** 设置 → 会话：deck 从哪些平台拉哪些会话、多久拉一次、存多久。 */
export function Connections({ source }: { source?: Source }) {
  const { groups, versions, config } = useData()
  const { bump } = useActions()
  const toast = useToast()
  const sources = useLoad(() => api.sources(), [versions.health, versions.config])
  const paused = new Set(sources.data?.sources.filter((s) => s.paused).map((s) => s.source))
  // 点平台卡片上的会话数：列表按这个平台筛选并滚过去。
  const [picked, setPicked] = useState<{ source?: Source; at: number }>({ source, at: 0 })

  function showChats(source: Source) {
    setPicked({ source, at: Date.now() })
    requestAnimationFrame(() => document.getElementById('chats')?.scrollIntoView({ behavior: 'smooth' }))
  }

  async function toggle(source: Source, name: string, pause: boolean) {
    try {
      await api.setSourcePaused(source, pause)
      toast(pause ? `已暂停 ${name} 监听，恢复后将补齐期间的消息` : `已恢复 ${name} 监听`)
      bump()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  return (
    <div className="space-y-8">
      <section>
      <SectionHeader title="平台" />
      {sources.error && (
        <div className="mb-3">
          <ErrorBar message={sources.error} onRetry={sources.reload} />
        </div>
      )}
      <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2">
        {Object.values(PLATFORMS).map((platform) => (
          <PlatformCard
            key={platform.source}
            {...platform}
            health={sources.data?.sources.find((s) => s.source === platform.source)?.health}
            paused={paused.has(platform.source)}
            loaded={!!sources.data}
            onToggle={(pause) => toggle(platform.source, platform.name, pause)}
            groups={groups.filter((g) => g.source === platform.source)}
            pollSeconds={config?.poll_seconds}
            onShowChats={() => showChats(platform.source)}
          />
        ))}
      </div>
      </section>
      <GroupList key={picked.at} initialSource={picked.source} />
      <Retention />
    </div>
  )
}

/** 拉取间隔：存的是秒，这里按分钟填；所有平台共用。 */
function PollMinutes({ seconds }: { seconds: number }) {
  const [value, setValue] = useState<string | null>(null)
  const { save, busy } = useSettingsSave()
  const toast = useToast()
  const shown = value ?? String(Math.round((seconds / 60) * 10) / 10)

  async function commit() {
    if (value === null) return
    const minutes = Number(value)
    if (!value.trim() || !Number.isFinite(minutes) || minutes < 0.5 || minutes > 60) {
      toast('拉取间隔须为 0.5～60 分钟', 'error')
      setValue(null)
      return
    }
    const next = Math.round(minutes * 60)
    if (next === seconds || (await save({ poll_seconds: next }, '拉取间隔已保存'))) setValue(null)
  }

  return (
    <label className="inline-flex items-center gap-1.5" title="所有平台共用；钉钉实时推送中断时也按这个间隔拉取">
      每
      <input
        type="number"
        inputMode="decimal"
        min="0.5"
        max="60"
        step="0.5"
        value={shown}
        disabled={busy}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') setValue(null)
        }}
        aria-label="拉取间隔（分钟）"
        className={clsx(numberInput, '!h-7 !w-16')}
      />
      分钟拉取
    </label>
  )
}

const STATE = {
  realtime: { label: '监听中', tone: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', dot: 'bg-emerald-500' },
  poll: { label: '监听中', tone: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', dot: 'bg-emerald-500' },
  error: { label: '异常', tone: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300', dot: 'bg-red-500' },
  paused: { label: '已暂停', tone: 'bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400', dot: 'bg-stone-400' },
  idle: { label: '未使用', tone: 'bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400', dot: 'bg-stone-400' },
} as const

function PlatformCard({
  source,
  name,
  cli,
  polls,
  groups,
  health,
  paused,
  loaded,
  onToggle,
  pollSeconds,
  onShowChats,
}: Platform & {
  groups: GroupInfo[]
  health?: SourceHealth
  paused: boolean
  loaded: boolean
  onToggle: (pause: boolean) => void
  pollSeconds?: number
  onShowChats: () => void
}) {
  const { bump } = useActions()
  const toast = useToast()
  const [syncing, setSyncing] = useState(false)
  const errors = groups.filter((g) => watchTone(g.watch) === 'error')
  const realtime = groups.some((g) => watchTone(g.watch) === 'realtime')
  const loginBad = !!health && (health.auth_state === 'missing' || health.auth_state === 'needs_login')
  const unhealthy = !!health && (!health.available || !!health.error || loginBad)
  const state: keyof typeof STATE = paused ? 'paused' : unhealthy || errors.length ? 'error' : !groups.length ? 'idle' : realtime ? 'realtime' : 'poll'
  const problems = [
    ...(health?.error ? [{ key: 'health', where: `${name}命令行工具`, text: health.error }] : []),
    ...(loginBad ? [{ key: 'auth', where: `${name}登录`, text: health!.auth_state === 'missing' ? 'not logged in' : 'reauthentication_required' }] : []),
    ...errors.map((g) => ({ key: `g${g.id}`, where: g.name, text: g.watch.error ?? '监听异常' })),
  ]
  const login = health ? { configured: '已登录', missing: '未登录', needs_login: '需重新登录', unknown: '登录状态未知' }[health.auth_state] : null
  const interval = pollSeconds ? `每 ${Math.round((pollSeconds / 60) * 10) / 10} 分钟拉取` : '定时拉取'
  const receive = polls ? (pollSeconds ? <PollMinutes seconds={pollSeconds} /> : interval) : groups.length && !paused && !realtime ? `推送中断，${interval}` : '实时推送'

  async function syncNow() {
    setSyncing(true)
    try {
      const { results } = await api.sync(undefined, source)
      const failed = results.filter((r) => r.error)
      const added = results.reduce((sum, r) => sum + r.added, 0)
      toast(failed.length ? `${failed.length} 个群同步失败，原因见卡片` : added ? `已同步，新增 ${added} 条消息` : '已同步，没有新消息', failed.length ? 'error' : 'success')
      bump()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <section className="flex flex-col overflow-hidden rounded-xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
      <header className="flex items-center gap-3 px-4 pt-4 pb-3">
        <SourceBadge source={source} className={clsx('!size-9 shrink-0 !rounded-lg !text-fs14', paused && 'opacity-50')} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-fs15 font-semibold">{name}</h4>
            <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2 text-fs11 leading-5 font-medium', STATE[state].tone)}>
              <span className={clsx('size-1.5 rounded-full', STATE[state].dot)} />
              {STATE[state].label}
            </span>
          </div>
          <p className="mt-0.5 truncate text-fs12 text-stone-500">
            {health ? (
              <>
                {health.account || '账号未知'} · <span className={clsx(loginBad && 'text-red-600 dark:text-red-400')}>{login}</span>
              </>
            ) : (
              '正在读取账号…'
            )}
          </p>
        </div>
        {loaded && (
          <span title={paused ? `恢复 ${name} 监听` : `暂停 ${name} 监听：不再接收新消息，仍可发送`}>
            <Switch checked={!paused} onChange={(on) => onToggle(!on)} label={<span className="sr-only">{name}监听</span>} />
          </span>
        )}
      </header>

      {problems.length > 0 && (
        <ul className="space-y-2 px-4 pb-3">
          {problems.map((problem) => (
            <Problem key={problem.key} where={problem.where} text={problem.text} cli={cli} />
          ))}
        </ul>
      )}

      <div className={clsx('flex-1 space-y-3 px-4 pb-4', paused && 'opacity-60')}>
        {groups.length ? (
          <button
            onClick={onShowChats}
            title="在下方会话列表里查看"
            className="flex min-h-11 w-full items-center gap-2 text-left rounded-lg bg-stone-50 px-3 py-2 transition-colors hover:bg-stone-100 dark:bg-stone-800/50 dark:hover:bg-stone-800"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-fs13 font-medium text-stone-800 dark:text-stone-100">
                {groups.length} 个会话
                {errors.length > 0 && <span className="text-red-600 dark:text-red-400"> · {errors.length} 个异常</span>}
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-stone-400" />
          </button>
        ) : (
          <p className="rounded-lg bg-stone-50 px-3 py-2 text-fs12 text-stone-500 dark:bg-stone-800/50">暂无监测的会话，群可在项目中添加</p>
        )}
        <dl className="border-t border-stone-100 pt-3 dark:border-stone-800">
          <Fact label="接收方式">{receive}</Fact>
        </dl>
        <details className="group text-fs12 text-stone-500 dark:text-stone-400">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-md focus-visible:outline-2 focus-visible:outline-accent-500 sm:min-h-8 [&::-webkit-details-marker]:hidden">
            连接详情
            <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
          </summary>
          <dl className="space-y-1.5 pt-1">
            <Fact label="命令行工具">
              <span className="font-mono text-fs12" title={health?.version || undefined}>
                {cli} {health ? shortVersion(health.version) : '…'}
              </span>
            </Fact>
            <Fact label="登录凭据">
              {health?.expires_at ? `${shortTime(health.expires_at)} 到期 · 自动续期` : `由 ${cli} 管理`}
            </Fact>
          </dl>
          <p className="mt-2">登录状态读取自本机，未联网验证。</p>
        </details>
      </div>

      {groups.length > 0 && !paused && (
        <footer className="flex justify-end border-t border-stone-100 px-2 py-1.5 dark:border-stone-800">
          <button
            onClick={() => void syncNow()}
            disabled={syncing}
            title="立即同步这个平台的群"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-fs12 font-medium text-stone-600 hover:bg-stone-100 disabled:opacity-50 dark:text-stone-300 dark:hover:bg-stone-800"
          >
            <RefreshCw className={clsx('size-3.5', syncing && 'animate-spin')} />
            {syncing ? '同步中' : '立即同步'}
          </button>
        </footer>
      )}
    </section>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-4">
      <dt className="shrink-0 text-fs12 text-stone-500">{label}</dt>
      <dd className="min-w-0 text-right text-fs13 text-stone-800 [overflow-wrap:anywhere] dark:text-stone-100">{children}</dd>
    </div>
  )
}

/** 常见错误给出处理办法；原文可展开。 */
function hintFor(text: string, cli: string) {
  if (/upgrade required|cli_upgrade_required|upgrade to cli version/i.test(text))
    return `${cli} 版本过低，平台要求升级。请在运行 deck 的电脑上执行「${cli} update --confirm」（路径见 config.toml 的 [tools]），然后点击「立即同步」。`
  if (/reauthentication_required|not logged in|unauthori[sz]ed|\b401\b|token.*expired|未登录|重新登录/i.test(text))
    return `${cli} 需要重新登录。请在运行 deck 的电脑上执行「${cli} auth login」（路径见 config.toml 的 [tools]）。`
  if (/找不到 CLI|No such file|not found/i.test(text)) return `未找到 ${cli}，请检查 config.toml 中的工具路径。`
  if (/timed? ?out|超时/i.test(text)) return '平台响应超时，deck 将自动重试；如持续出现，请检查网络。'
  if (/监听断开/.test(text)) return '实时推送已中断，deck 将自动重连；期间改为定时拉取，消息不会丢失。'
  return null
}

function Problem({ where, text, cli }: { where: string; text: string; cli: string }) {
  const [open, setOpen] = useState(false)
  const hint = hintFor(text, cli)
  return (
    <li className="flex gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-fs12 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{where}</p>
        <p className="mt-0.5 leading-relaxed">{hint ?? text}</p>
        {hint && (
          <>
            <button onClick={() => setOpen(!open)} className="mt-1 inline-flex items-center gap-0.5 text-red-700/80 hover:underline dark:text-red-300/80">
              <ChevronDown className={clsx('size-3 transition-transform', open && 'rotate-180')} />
              {open ? '收起原始错误' : '查看原始错误'}
            </button>
            {open && <p className="mt-1 font-mono text-fs11 break-all text-red-700/90 dark:text-red-300/90">{text}</p>}
          </>
        )}
      </div>
    </li>
  )
}
