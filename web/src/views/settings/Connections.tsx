import clsx from 'clsx'
import { AlertTriangle, ChevronDown, ChevronRight, Plus, RefreshCw } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { api, type Source, type SourceHealth } from '../../api'
import { ErrorBar } from '../../components/Feedback'
import { numberInput } from '../../components/SettingsLayout'
import { SourceBadge, watchTone } from '../../components/SourceBadge'
import { useToast } from '../../components/Toast'
import { Switch } from '../../components/ui'
import { shortTime, shortVersion } from '../../format'
import { PLATFORMS, type Platform } from '../../platforms'
import { href } from '../../router'
import { useLoad, type GroupInfo, useActions, useData } from '../../state'

/** 设置 → 连接：各平台的登录状态、监听状态和命令行工具。 */
export function Connections() {
  const { groups, versions } = useData()
  const { bump } = useActions()
  const toast = useToast()
  const sources = useLoad(() => api.sources(), [versions.health, versions.config])
  const paused = new Set(sources.data?.sources.filter((s) => s.paused).map((s) => s.source))

  async function toggle(source: Source, name: string, pause: boolean) {
    try {
      await api.setSourcePaused(source, pause)
      toast(pause ? `已暂停监听：${name}。恢复后会补齐期间的消息` : `已恢复监听：${name}`)
      bump()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  return (
    <div className="space-y-3">
      {sources.error && <ErrorBar message={sources.error} onRetry={sources.reload} />}
      <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Object.values(PLATFORMS).map((platform) => (
          <PlatformCard
            key={platform.source}
            {...platform}
            health={sources.data?.sources.find((s) => s.source === platform.source)?.health}
            paused={paused.has(platform.source)}
            loaded={!!sources.data}
            onToggle={(pause) => toggle(platform.source, platform.name, pause)}
            groups={groups.filter((g) => g.source === platform.source)}
          />
        ))}
        <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-stone-300 p-5 text-center text-stone-400 dark:border-stone-700">
          <span className="flex size-9 items-center justify-center rounded-lg bg-stone-100 dark:bg-stone-800">
            <Plus className="size-4" />
          </span>
          <p className="mt-2 font-medium text-stone-500">接入新平台</p>
          <p className="mt-1 text-fs12">以后：飞书、GitHub、Plane…</p>
        </div>
      </div>
    </div>
  )
}

const STATE = {
  realtime: { label: '实时监听', tone: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', dot: 'bg-emerald-500' },
  poll: { label: '定时拉取', tone: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', dot: 'bg-emerald-500' },
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
}: Platform & {
  groups: GroupInfo[]
  health?: SourceHealth
  paused: boolean
  loaded: boolean
  onToggle: (pause: boolean) => void
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
          <span title={paused ? `恢复${name}监听` : `暂停${name}监听：不再接收新消息，仍可发送`}>
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
          <a
            href={href({ name: 'settings', tab: 'reminders', source })}
            title="查看这些群的监听状态和提醒设置"
            className="flex items-center gap-2 rounded-lg bg-stone-50 px-3 py-2 transition-colors hover:bg-stone-100 dark:bg-stone-800/50 dark:hover:bg-stone-800"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-fs13 font-medium text-stone-800 dark:text-stone-100">
                监测 {groups.length} 个群
                {errors.length > 0 && <span className="text-red-600 dark:text-red-400"> · {errors.length} 个异常</span>}
              </span>
              <span className="block truncate text-fs12 text-stone-500">{groups.map((g) => g.name).join('、')}</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-stone-400" />
          </a>
        ) : (
          <p className="rounded-lg bg-stone-50 px-3 py-2 text-fs12 text-stone-500 dark:bg-stone-800/50">还没有监测的群，在项目里添加</p>
        )}
        <dl className="space-y-1.5 border-t border-stone-100 pt-3 dark:border-stone-800">
          {polls && <PollFact />}
          <Fact label="命令行工具">
            <span className="font-mono text-fs12" title={health?.version || undefined}>
              {cli} {health ? shortVersion(health.version) : '…'}
            </span>
          </Fact>
          <Fact label="登录凭据">
            <span title="读取本机状态，未联网验证">{health?.expires_at ? `${shortTime(health.expires_at)} 到期 · 自动续期` : `由 ${cli} 管理`}</span>
          </Fact>
        </dl>
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
    return `${cli} 版本过低，平台要求升级。在运行 deck 的电脑上执行「${cli} update --confirm」（${cli} 的路径见 config.toml 的 [tools]），再点「同步」。`
  if (/reauthentication_required|not logged in|unauthori[sz]ed|\b401\b|token.*expired|未登录|重新登录/i.test(text))
    return `${cli} 需要重新登录。在运行 deck 的电脑上执行「${cli} auth login」（${cli} 的路径见 config.toml 的 [tools]）。`
  if (/找不到 CLI|No such file|not found/i.test(text)) return `找不到 ${cli}，请检查 config.toml 里的工具路径。`
  if (/timed? ?out|超时/i.test(text)) return '平台响应超时，deck 会自动重试；持续出现时检查网络。'
  if (/监听断开/.test(text)) return '实时监听断开，deck 会自动重连，期间改为定时拉取，消息不会丢。'
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

function PollFact() {
  const { config } = useData()
  const { bump } = useActions()
  const toast = useToast()
  const [value, setValue] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!config) return null
  const parsed = Number(value)
  const valid = Number.isInteger(parsed) && parsed >= 5 && parsed <= 3600

  async function save(body: Parameters<typeof api.updateConfig>[0]) {
    setBusy(true)
    try {
      await api.updateConfig(body)
      toast('拉取间隔已保存')
      setValue(null)
      bump()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Fact label="拉取间隔">
      {value === null ? (
        <span className="flex flex-wrap items-center justify-end gap-x-2.5 gap-y-1">
          每 {config.poll_seconds} 秒
          <button onClick={() => setValue(String(config.poll_seconds))} className="text-fs12 text-accent-700 hover:underline dark:text-accent-500">
            修改
          </button>
          {config.overridden.includes('poll_seconds') && (
            <button onClick={() => void save({ reset: ['poll_seconds'] })} disabled={busy} className="text-fs12 text-stone-500 hover:underline">
              恢复默认 {config.defaults.poll_seconds ?? 30} 秒
            </button>
          )}
        </span>
      ) : (
        <span className="flex flex-wrap items-center justify-end gap-1.5">
          <input
            type="number"
            inputMode="numeric"
            min="5"
            max="3600"
            value={value}
            autoFocus
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && valid) void save({ poll_seconds: parsed })
              if (event.key === 'Escape') setValue(null)
            }}
            aria-label="拉取间隔（秒）"
            aria-invalid={!valid}
            className={clsx(numberInput, !valid && '!border-red-400')}
          />
          <span className="text-stone-500">秒</span>
          <button onClick={() => setValue(null)} disabled={busy} className="h-7 rounded-md px-2 text-fs12 text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800">
            取消
          </button>
          <button
            onClick={() => void save({ poll_seconds: parsed })}
            disabled={busy || !valid}
            className="h-7 rounded-md bg-accent-600 px-2.5 text-fs12 font-medium text-white hover:bg-accent-700 disabled:opacity-50"
          >
            保存
          </button>
        </span>
      )}
    </Fact>
  )
}
