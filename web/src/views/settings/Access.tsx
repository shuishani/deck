import clsx from 'clsx'
import { Ban, Check, CircleCheck, Copy, Laptop, LogOut, MonitorSmartphone, Plus, RefreshCw, ShieldAlert, Smartphone, Trash2 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { api, UNAUTHORIZED_EVENT, type AccessAddress, type DeviceSession, type EntryPlan } from '../../api'
import { SectionHeader } from '../../components/SettingsLayout'
import { EmptyState, ErrorBar, Skeleton } from '../../components/Feedback'
import { useToast } from '../../components/Toast'
import { Button, ConfirmDialog, Dialog } from '../../components/ui'
import { copyText } from '../../clipboard'
import { fullTime, relative } from '../../format'
import { useLoad } from '../../state'

export function Access() {
  const toast = useToast()
  const { data, error, loading, reload } = useLoad(() => api.access(), [])
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<DeviceSession | null>(null)
  const [disabling, setDisabling] = useState<DeviceSession | null>(null)
  const [loggingOut, setLoggingOut] = useState(false)
  const [viewing, setViewing] = useState<DeviceSession | null>(null)
  const [busy, setBusy] = useState(false)

  async function signOut() {
    setBusy(true)
    try {
      await api.logout()
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
      setBusy(false)
      setLoggingOut(false)
    }
  }

  async function remove(session: DeviceSession) {
    setBusy(true)
    try {
      await api.removeSession(session.id)
      toast(`已移除 ${deviceName(session.user_agent)}`)
      setRemoving(null)
      void reload()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function toggle(session: DeviceSession) {
    const disable = !session.disabled_at
    setBusy(true)
    try {
      await api.setSessionDisabled(session.id, disable)
      toast(`已${disable ? '禁用' : '启用'} ${deviceName(session.user_agent)}`)
      setDisabling(null)
      void reload()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const sessions = [...(data?.sessions ?? [])].sort(
    (a, b) => Number(b.current) - Number(a.current) || (b.last_seen_at ?? '').localeCompare(a.last_seen_at ?? ''),
  )
  const primary = data ? (data.addresses.find((a) => a.recommended) ?? data.addresses[0]) : undefined

  return (
    <div className="space-y-8">
      {data && primary && <Addresses addresses={data.addresses} primary={primary} plan={data.entry_plan} onSaved={reload} />}
      <section className="space-y-4">
      <SectionHeader
        title="已登录的设备"
        action={
          <Button variant="primary" onClick={() => setAdding(true)} disabled={!data}>
            <Plus className="size-3.5" />
            添加设备
          </Button>
        }
      />

      {error && <ErrorBar message={error} onRetry={reload} />}
      {loading && (
        <div className="space-y-2 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}
      {!loading && !error && sessions.length === 0 && (
        <EmptyState icon={<MonitorSmartphone className="size-5" />} title="暂无已登录设备" />
      )}
      {sessions.length > 0 && (
        <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 bg-white dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
          {sessions.map((session) => (
            <li key={session.id} className={clsx('flex items-center gap-3 px-4 py-3', session.disabled_at && 'bg-stone-50/80 dark:bg-stone-950/40')}>
              <span
                className={clsx(
                  'flex size-9 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400',
                  session.disabled_at && 'opacity-50',
                )}
              >
                {isPhone(session.user_agent) ? <Smartphone className="size-4" /> : <Laptop className="size-4" />}
              </span>
              <button
                onClick={() => setViewing(session)}
                disabled={busy}
                className={clsx('min-h-11 min-w-0 flex-1 text-left', session.disabled_at && 'opacity-60')}
                title="查看设备详情"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 truncate font-medium">{deviceName(session.user_agent)}</span>
                  {session.current && (
                    <span className="rounded bg-accent-50 px-1.5 text-fs11 leading-[18px] font-medium text-accent-700 dark:bg-accent-500/15 dark:text-accent-100">
                      当前设备
                    </span>
                  )}
                  {session.disabled_at && (
                    <span className="rounded bg-stone-200 px-1.5 text-fs11 leading-[18px] font-medium text-stone-600 dark:bg-stone-700 dark:text-stone-300">
                      已禁用
                    </span>
                  )}
                  {primary && offPrimary(session, primary) && (
                    <span title="通过其他地址登录，点开查看">
                      <Badge tone="amber">其他地址</Badge>
                    </span>
                  )}
                </div>
                <p className="truncate text-fs12 text-stone-500 dark:text-stone-400">
                  {session.current
                    ? '正在使用'
                    : session.disabled_at
                      ? `${relative(session.disabled_at)}禁用`
                      : `${relative(session.last_seen_at)}活跃`}
                </p>
              </button>
              <Button variant="ghost" size="sm" onClick={() => setViewing(session)} disabled={busy} aria-label={`管理 ${deviceName(session.user_agent)}`} className="max-sm:h-11">
                管理
              </Button>
            </li>
          ))}
        </ul>
      )}
      </section>

      <DeviceDialog
        session={viewing}
        primary={primary}
        busy={busy}
        onClose={() => setViewing(null)}
        onLogout={() => (setViewing(null), setLoggingOut(true))}
        onDisable={(session) => (setViewing(null), setDisabling(session))}
        onEnable={(session) => (setViewing(null), void toggle(session))}
        onRemove={(session) => (setViewing(null), setRemoving(session))}
      />
      {primary && <AddDeviceDialog open={adding} onClose={() => setAdding(false)} address={primary} />}
      <ConfirmDialog
        open={!!removing}
        title="移除设备？"
        confirmLabel="移除"
        busy={busy}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && void remove(removing)}
      >
        {`${removing ? deviceName(removing.user_agent) : ''} 的登录凭据将失效。再次访问需重新配对。`}
      </ConfirmDialog>
      <ConfirmDialog
        open={!!disabling}
        title="禁用该设备？"
        confirmLabel="禁用"
        busy={busy}
        onClose={() => setDisabling(null)}
        onConfirm={() => disabling && void toggle(disabling)}
      >
        {`${disabling ? deviceName(disabling.user_agent) : ''} 将无法访问 deck。登录状态保留，可重新启用。`}
      </ConfirmDialog>
      <ConfirmDialog
        open={loggingOut}
        title="退出登录？"
        confirmLabel="退出"
        busy={busy}
        onClose={() => setLoggingOut(false)}
        onConfirm={() => void signOut()}
      >
        退出后，当前设备需重新配对登录。
      </ConfirmDialog>
    </div>
  )
}

function Addresses({ addresses, primary, plan, onSaved }: { addresses: AccessAddress[]; primary: AccessAddress; plan: EntryPlan | null; onSaved: () => Promise<void> }) {
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  async function pin() {
    setSaving(true)
    try {
      await api.pinEntry(primary.url)
      toast('入口地址已保存，网络路由未修改', 'info')
      await onSaved()
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setSaving(false)
    }
  }
  const here = window.location.origin
  const isHere = (address: AccessAddress) => originOf(address.url) === here
  const others = addresses.filter((a) => a !== primary)
  return (
    <section className="space-y-3">
      <SectionHeader title="访问地址" />
      <div className="space-y-3 rounded-xl border border-stone-200 bg-white px-4 py-3.5 dark:border-stone-800 dark:bg-stone-900">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-1.5">
              <span className="truncate font-mono text-fs15 font-medium">{displayUrl(primary.url)}</span>
              {isHere(primary) && <Badge tone="accent">当前使用</Badge>}
              {primary.pinned && <Badge tone="stone">固定入口</Badge>}
              {!primary.secure && primary.kind !== 'local' && <Badge tone="amber">未加密</Badge>}
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-fs12 text-stone-500 dark:text-stone-400">
              <span
                className={clsx(
                  'size-2 shrink-0 rounded-full',
                  !primary.usable ? 'bg-red-500' : primary.kind === 'lan' && primary.remote !== 'active' ? 'bg-amber-500' : 'bg-emerald-500',
                )}
              />
              {primary.label}
              <span className="text-stone-300 dark:text-stone-600">·</span>
              {primary.status}
            </p>
          </div>
          <CopyIcon text={primary.url} label="复制地址" />
        </div>
        {!primary.usable && <p role="alert" className="text-fs12 text-red-600 dark:text-red-400">入口地址当前不可用，请检查服务器地址及监听配置。</p>}
        {!primary.secure && primary.kind !== 'local' && <p className="text-fs12 text-amber-700 dark:text-amber-300">此地址使用 HTTP，仅应在可信网络中访问。</p>}
        {!primary.pinned && plan && (
          <div className="space-y-1.5">
            <Button onClick={pin} disabled={saving}>{saving ? '保存中…' : '固定入口'}</Button>
            <p className="text-fs12 text-stone-500">仅保存地址，不修改网络路由。</p>
          </div>
        )}
        {primary.kind === 'lan' && primary.remote !== 'active' && plan && (
          <RemoteSetup plan={plan} />
        )}
      </div>
      {others.length > 0 && (
        <details className="group">
          <summary className="min-h-11 content-center cursor-pointer rounded-md text-fs12 text-stone-500 select-none hover:text-stone-700 focus-visible:outline-2 focus-visible:outline-accent-500 dark:text-stone-400 dark:hover:text-stone-200">
            其他地址
          </summary>
          <p className="mt-1 text-fs12 text-stone-500">仅用于网络诊断，日常访问请使用上方入口。</p>
          <ul className="mt-2 divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 bg-white dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
            {others.map((address) => (
              <li key={address.url} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-fs13 font-medium">
                    {address.label}
                    {isHere(address) && <Badge tone="accent">当前使用</Badge>}
                  </p>
                  <p className="truncate text-fs12 text-stone-500 dark:text-stone-400">
                    <span className="font-mono">{displayUrl(address.url)}</span>
                    <span className="mx-1.5 text-stone-300 dark:text-stone-600">·</span>
                    {address.status}
                  </p>
                </div>
                <CopyIcon text={address.url} label="复制地址" />
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

function RemoteSetup({ plan }: { plan: EntryPlan }) {
  return (
    <div className="space-y-2 text-fs12 leading-relaxed text-stone-600 dark:text-stone-300">
      {!plan.running && <p role="status" className="text-amber-700 dark:text-amber-300">Tailscale 未运行，远程访问不可用。</p>}
      {!plan.routes_known
        ? <p role="alert" className="text-amber-700 dark:text-amber-300">无法读取现有路由，暂不提供配置命令。</p>
        : plan.running && <p role="status" className="text-amber-700 dark:text-amber-300">{plan.remote === 'pending' ? '远程路由待批准，暂不可远程访问。' : '远程访问尚未配置。'}</p>}
      <details>
        <summary className="min-h-11 content-center cursor-pointer rounded-md text-stone-500 focus-visible:outline-2 focus-visible:outline-accent-500 dark:text-stone-400">远程访问设置</summary>
        <div className="space-y-2 rounded-lg bg-stone-50 px-3 py-2.5 dark:bg-stone-950">
          <p>配置完成后，可通过同一地址在局域网或 Tailscale 网络中访问。</p>
          {plan.remote === 'pending' ? (
            <p>路由 <span className="font-mono">{plan.route}</span> 待批准。请在 Tailscale 管理后台批准路由并检查访问规则。</p>
          ) : (
            <>
              <p>{plan.routes_known ? '以下命令会修改 Tailscale 路由。确认影响后在运行 deck 的电脑上执行，随后须由管理员批准。' : '为避免覆盖现有路由，须先恢复 Tailscale 状态查询。'}</p>
              {plan.command && <CopyRow label="宣告路由" value={plan.command} />}
              {plan.rollback_command && <CopyRow label="恢复原路由" value={plan.rollback_command} />}
            </>
          )}
          {plan.warnings.map((warning) => <p key={warning} className="text-stone-500 dark:text-stone-400">{warning}</p>)}
        </div>
      </details>
    </div>
  )
}

function originOf(url: string) {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}

function displayUrl(url: string) {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

function offPrimary(session: DeviceSession, primary: AccessAddress) {
  if (!session.origin) return false
  const host = new URL(session.origin).hostname
  if (host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]') return false
  return session.origin !== originOf(primary.url)
}

function Badge({ tone, children }: { tone: 'accent' | 'stone' | 'amber'; children: string }) {
  return (
    <span
      className={clsx(
        'rounded px-1.5 text-fs11 leading-[18px] font-medium',
        tone === 'accent' && 'bg-accent-50 text-accent-700 dark:bg-accent-500/15 dark:text-accent-100',
        tone === 'stone' && 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300',
        tone === 'amber' && 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
      )}
    >
      {children}
    </span>
  )
}

function networkOf(ip: string) {
  if (!ip) return '未知'
  if (ip === '127.0.0.1' || ip === '::1') return '服务器本机'
  const [a, b] = ip.split('.').map(Number)
  if (a === 100 && b >= 64 && b <= 127) return 'Tailscale'
  if (a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) return '局域网'
  return '其他网络'
}

function DeviceDialog({
  session,
  primary,
  busy,
  onClose,
  onLogout,
  onDisable,
  onEnable,
  onRemove,
}: {
  session: DeviceSession | null
  primary: AccessAddress | undefined
  busy: boolean
  onClose: () => void
  onLogout: () => void
  onDisable: (session: DeviceSession) => void
  onEnable: (session: DeviceSession) => void
  onRemove: (session: DeviceSession) => void
}) {
  if (!session) return null
  const status = session.current ? '当前设备' : session.disabled_at ? `已禁用（${fullTime(session.disabled_at)}）` : '正常'
  const off = primary && offPrimary(session, primary)
  const rows: [string, ReactNode][] = [
    ['设备', deviceName(session.user_agent)],
    ['状态', status],
    ['登录地址', session.origin ? <span className="font-mono break-all">{displayUrl(session.origin)}</span> : '未记录'],
    ['来源 IP', <span className="font-mono">{session.ip || '未知'}</span>],
    ['网络', networkOf(session.ip)],
    ['登录时间', fullTime(session.created_at)],
    ['最近活跃', session.last_seen_at ? `${fullTime(session.last_seen_at)}（${relative(session.last_seen_at)}）` : '—'],
    ['登录有效期', '最近一次活跃后 30 天'],
    ['浏览器标识', <span className="font-mono text-fs11 break-all text-stone-500">{session.user_agent || '未知'}</span>],
  ]
  return (
    <Dialog
      open
      onClose={onClose}
      title="设备管理"
      width="max-w-md"
      footer={
        <>
          <Button onClick={onClose} disabled={busy} className="max-sm:h-11">关闭</Button>
          {session.current ? (
            <Button onClick={onLogout} disabled={busy} className="max-sm:h-11"><LogOut className="size-3.5" />退出登录</Button>
          ) : (
            <>
              {session.disabled_at
                ? <Button onClick={() => onEnable(session)} disabled={busy} className="max-sm:h-11"><CircleCheck className="size-3.5" />启用</Button>
                : <Button onClick={() => onDisable(session)} disabled={busy} className="max-sm:h-11"><Ban className="size-3.5" />禁用</Button>}
              <Button variant="danger" onClick={() => onRemove(session)} disabled={busy} className="max-sm:h-11"><Trash2 className="size-3.5" />移除</Button>
            </>
          )}
        </>
      }
    >
      <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-2.5 text-fs13">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-stone-500 dark:text-stone-400">{label}</dt>
            <dd className="min-w-0">{value}</dd>
          </div>
        ))}
      </dl>
      {off && primary && (
        <p className="mt-4 flex items-start gap-1.5 text-fs12 leading-relaxed text-amber-700 dark:text-amber-300">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
          此设备使用其他地址登录。请通过 {displayUrl(primary.url)} 重新配对后，再移除旧登录。
        </p>
      )}
    </Dialog>
  )
}

function AddDeviceDialog({
  open,
  onClose,
  address,
}: {
  open: boolean
  onClose: () => void
  address: AccessAddress
}) {
  const [pairing, setPairing] = useState<{ code: string; expires_at: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function generate() {
    setBusy(true)
    setError(null)
    try {
      setPairing(await api.pair())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!open) return
    setPairing(null)
    void generate()
  }, [open])

  return (
    <Dialog
      open={open}
      title="添加设备"
      onClose={onClose}
      width="max-w-md"
      footer={
        <Button variant="primary" onClick={onClose}>
          关闭
        </Button>
      }
    >
      <div className="space-y-4">
        {pairing ? (
          <PairingView pairing={pairing} address={address} onRegenerate={() => void generate()} busy={busy} />
        ) : busy ? (
          <div className="flex justify-center">
            <Skeleton className="size-[216px]" />
          </div>
        ) : null}
        {error && (
          <div className="space-y-3">
            <p role="alert" className="text-fs13 text-red-600">{error}</p>
            <Button onClick={() => void generate()} disabled={busy}>重试</Button>
          </div>
        )}
      </div>
    </Dialog>
  )
}

function PairingView({
  pairing,
  address,
  onRegenerate,
  busy,
}: {
  pairing: { code: string; expires_at: string }
  address: AccessAddress
  onRegenerate: () => void
  busy: boolean
}) {
  const link = `${address.url}#/login?code=${pairing.code}`
  const [qr, setQr] = useState<string | null>(null)
  const left = useCountdown(pairing.expires_at)
  const expired = left <= 0

  useEffect(() => {
    let alive = true
    import('qrcode')
      .then(({ default: QRCode }) => QRCode.toDataURL(link, { margin: 1, width: 440, errorCorrectionLevel: 'M' }))
      .then((url) => alive && setQr(url))
      .catch(() => alive && setQr(null))
    return () => {
      alive = false
    }
  }, [link])

  return (
    <div className="space-y-3">
      <div className="flex flex-col items-center">
        <div className={clsx('relative rounded-xl border border-stone-200 bg-white p-2 dark:border-stone-700', expired && 'opacity-30')}>
          {qr ? <img src={qr} alt="登录二维码" className="size-[200px]" /> : <Skeleton className="size-[200px]" />}
        </div>
        <p className={clsx('mt-2 text-fs12 tabular-nums', expired ? 'text-red-600' : 'text-stone-500 dark:text-stone-400')}>
          {expired ? '已过期' : `扫码登录 · ${formatLeft(left)} 后过期`}
        </p>
        {expired && (
          <Button size="sm" className="mt-2" onClick={onRegenerate} disabled={busy}>
            <RefreshCw className={clsx('size-3.5', busy && 'animate-spin')} />
            重新生成
          </Button>
        )}
      </div>
      <CopyRow label="登录码" value={pairing.code} big />
      {!address.secure && address.kind !== 'local' && (
        <p className="flex items-start gap-1.5 text-fs12 leading-relaxed text-amber-700 dark:text-amber-300">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
          同一 Wi-Fi 下为明文传输，请仅在可信网络中使用；外网经 Tailscale 访问时链路加密。
        </p>
      )}
    </div>
  )
}

function CopyIcon({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    if (await copyText(text)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }
  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={label}
      aria-label={label}
      className="flex size-11 shrink-0 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100 hover:text-stone-600 focus-visible:outline-2 focus-visible:outline-accent-500 dark:text-stone-400 dark:hover:bg-stone-800"
    >
      {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
    </button>
  )
}

function CopyRow({ label, value, big }: { label: string; value: string; big?: boolean }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    if (await copyText(value)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }
  return (
    <div className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 dark:border-stone-700 dark:bg-stone-950">
      <span className="w-16 shrink-0 text-fs12 text-stone-500">{label}</span>
      <span
        className={clsx(
          'min-w-0 flex-1 font-mono select-all',
          big ? 'truncate text-fs18 font-semibold tracking-[0.2em]' : 'text-fs12 break-all text-stone-600 dark:text-stone-300',
        )}
        title={value}
      >
        {value}
      </span>
      <button
        type="button"
        onClick={() => void copy()}
        className="flex size-11 shrink-0 items-center justify-center rounded-md text-stone-500 hover:bg-stone-200/70 focus-visible:outline-2 focus-visible:outline-accent-500 dark:hover:bg-stone-800"
        aria-label={`复制${label}`}
      >
        {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
      </button>
    </div>
  )
}

function useCountdown(expiresAt: string) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000))
}

function formatLeft(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

function isPhone(ua: string) {
  return /iPhone|iPad|Android|Mobile/i.test(ua)
}

export function deviceName(ua: string) {
  const os = /iPhone/i.test(ua)
    ? 'iPhone'
    : /iPad/i.test(ua)
      ? 'iPad'
      : /Android/i.test(ua)
        ? 'Android'
        : /Mac OS X|Macintosh/i.test(ua)
          ? 'Mac'
          : /Windows/i.test(ua)
            ? 'Windows'
            : /Linux/i.test(ua)
              ? 'Linux'
              : '未知设备'
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /MicroMessenger/i.test(ua)
      ? '微信'
      : /DingTalk/i.test(ua)
        ? '钉钉'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /CriOS|Chrome\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : ''
  return browser ? `${os} · ${browser}` : os
}
