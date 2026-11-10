import clsx from 'clsx'
import { Ban, Check, CircleCheck, Copy, Laptop, LogOut, MonitorSmartphone, Plus, RefreshCw, ShieldAlert, Smartphone, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, UNAUTHORIZED_EVENT, type AccessAddress, type DeviceSession } from '../api'
import { EmptyState, ErrorBar, Skeleton } from '../components/Feedback'
import { useToast } from '../components/Toast'
import { Button, ConfirmDialog, Dialog } from '../components/ui'
import { fullTime, relative, shortTime } from '../format'
import { useLoad } from '../state'

export function Access() {
  const toast = useToast()
  const { data, error, loading, reload } = useLoad(() => api.access(), [])
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<DeviceSession | null>(null)
  const [disabling, setDisabling] = useState<DeviceSession | null>(null)
  const [loggingOut, setLoggingOut] = useState(false)
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
      if (session.current) {
        window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
        return
      }
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">已登录的设备</h2>
          <p className="text-fs12 text-stone-500 dark:text-stone-400">
            每台设备单独登录。禁用后暂时打不开 deck，随时可以再启用；移除后要重新配对。
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setLoggingOut(true)}>
            <LogOut className="size-3.5" />
            退出登录
          </Button>
          <Button variant="primary" onClick={() => setAdding(true)} disabled={!data}>
            <Plus className="size-3.5" />
            添加设备
          </Button>
        </div>
      </div>

      {error && <ErrorBar message={error} onRetry={reload} />}
      {loading && (
        <div className="space-y-2 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}
      {!loading && !error && sessions.length === 0 && (
        <EmptyState icon={<MonitorSmartphone className="size-5" />} title="还没有登录的设备" />
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
              <div className={clsx('min-w-0 flex-1', session.disabled_at && 'opacity-60')}>
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{deviceName(session.user_agent)}</span>
                  {session.current && (
                    <span className="rounded bg-accent-50 px-1.5 text-fs11 leading-[18px] font-medium text-accent-700 dark:bg-accent-500/15 dark:text-accent-100">
                      本机
                    </span>
                  )}
                  {session.disabled_at && (
                    <span className="rounded bg-stone-200 px-1.5 text-fs11 leading-[18px] font-medium text-stone-600 dark:bg-stone-700 dark:text-stone-300">
                      已禁用
                    </span>
                  )}
                </div>
                <p className="truncate text-fs12 text-stone-500 dark:text-stone-400">
                  <span className="font-mono">{session.ip || '未知 IP'}</span>
                  <span className="mx-1.5 text-stone-300 dark:text-stone-600">·</span>
                  <span title={fullTime(session.created_at)}>{shortTime(session.created_at)} 登录</span>
                  <span className="mx-1.5 text-stone-300 dark:text-stone-600">·</span>
                  {session.current
                    ? '正在使用'
                    : session.disabled_at
                      ? `${relative(session.disabled_at)}禁用`
                      : `${relative(session.last_seen_at)}活跃`}
                </p>
              </div>
              {!session.current &&
                (session.disabled_at ? (
                  <Button variant="ghost" size="sm" onClick={() => void toggle(session)} disabled={busy}>
                    <CircleCheck className="size-3.5" />
                    <span className="max-sm:hidden">启用</span>
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setDisabling(session)} className="text-stone-500 hover:text-amber-600">
                    <Ban className="size-3.5" />
                    <span className="max-sm:hidden">禁用</span>
                  </Button>
                ))}
              <Button variant="ghost" size="sm" onClick={() => setRemoving(session)} className="text-stone-500 hover:text-red-600">
                <Trash2 className="size-3.5" />
                <span className="max-sm:hidden">移除</span>
              </Button>
            </li>
          ))}
        </ul>
      )}

      {data && <AddDeviceDialog open={adding} onClose={() => setAdding(false)} addresses={data.addresses} />}
      <ConfirmDialog
        open={!!removing}
        title={removing?.current ? '移除这台设备？' : '移除设备？'}
        confirmLabel="移除"
        busy={busy}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && void remove(removing)}
      >
        {removing?.current
          ? '这是你正在用的设备，移除后会立即退出，需要新的登录码才能再登录。'
          : `${removing ? deviceName(removing.user_agent) : ''} 会被立即退出，需要新的登录码才能再登录。`}
      </ConfirmDialog>
      <ConfirmDialog
        open={!!disabling}
        title="禁用这台设备？"
        confirmLabel="禁用"
        busy={busy}
        onClose={() => setDisabling(null)}
        onConfirm={() => disabling && void toggle(disabling)}
      >
        {`${disabling ? deviceName(disabling.user_agent) : ''} 会立即打不开 deck；它的登录保留，之后在这里点「启用」就能恢复，不用重新配对。`}
      </ConfirmDialog>
      <ConfirmDialog
        open={loggingOut}
        title="退出登录？"
        confirmLabel="退出"
        busy={busy}
        onClose={() => setLoggingOut(false)}
        onConfirm={() => void signOut()}
      >
        退出后这台设备需要新的登录码才能再打开 deck。
      </ConfirmDialog>
    </div>
  )
}

function AddDeviceDialog({
  open,
  onClose,
  addresses: initial,
}: {
  open: boolean
  onClose: () => void
  addresses: AccessAddress[]
}) {
  const [pairing, setPairing] = useState<{ code: string; expires_at: string } | null>(null)
  const [addresses, setAddresses] = useState(initial)
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
    setAddresses(initial)
    void generate()
    // 手机连上 Tailscale 时二维码自动换过去。
    const timer = setInterval(() => {
      api.access().then((info) => setAddresses(info.addresses)).catch(() => {})
    }, 4000)
    return () => clearInterval(timer)
  }, [open])

  const primary = addresses.find((a) => a.recommended) ?? addresses[0]
  const networks = addresses.filter((a) => a.kind !== 'local')

  return (
    <Dialog
      open={open}
      title="添加设备"
      onClose={onClose}
      width="max-w-md"
      footer={
        <Button variant="primary" onClick={onClose}>
          完成
        </Button>
      }
    >
      <div className="space-y-4">
        {pairing && primary ? (
          <PairingView pairing={pairing} address={primary} onRegenerate={() => void generate()} busy={busy} />
        ) : (
          <div className="flex justify-center">
            <Skeleton className="size-[216px]" />
          </div>
        )}
        {error && <p className="text-fs13 text-red-600">{error}</p>}

        {networks.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-fs12 font-medium text-stone-500 dark:text-stone-400">识别到的网络</p>
            <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200 dark:divide-stone-800 dark:border-stone-700">
              {networks.map((address) => (
                <li key={address.url} className="flex items-center gap-2.5 px-3 py-2">
                  <span
                    className={clsx(
                      'size-2 shrink-0 rounded-full',
                      address.usable ? 'bg-emerald-500' : 'bg-stone-300 dark:bg-stone-600',
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-fs13 font-medium">
                      {address.label}
                      {address.recommended && (
                        <span className="rounded bg-accent-50 px-1.5 text-fs11 leading-[18px] font-medium text-accent-700 dark:bg-accent-500/15 dark:text-accent-100">
                          二维码用的
                        </span>
                      )}
                    </p>
                    <p className="truncate text-fs12 text-stone-500 dark:text-stone-400">
                      <span className="font-mono">{address.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>
                      <span className="mx-1.5 text-stone-300 dark:text-stone-600">·</span>
                      {address.status}
                    </p>
                  </div>
                  {pairing && !address.recommended && (
                    <CopyIcon text={`${address.url}#/login?code=${pairing.code}`} label="复制这个地址的登录链接" />
                  )}
                </li>
              ))}
            </ul>
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
          {expired ? '已过期' : `手机扫码登录 · 经${address.label} · ${formatLeft(left)} 后过期`}
        </p>
        {expired && (
          <Button size="sm" className="mt-2" onClick={onRegenerate} disabled={busy}>
            <RefreshCw className={clsx('size-3.5', busy && 'animate-spin')} />
            重新生成
          </Button>
        )}
      </div>
      <CopyRow label="登录码" value={pairing.code} big />
      {!address.secure && (
        <p className="flex items-start gap-1.5 text-fs12 leading-relaxed text-amber-700 dark:text-amber-300">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
          局域网是明文传输，只在信得过的网络里用；手机连上 Tailscale 后二维码会自动换成加密的地址。
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
      className="shrink-0 rounded-md p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800"
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
      <span className="w-10 shrink-0 text-fs12 text-stone-500">{label}</span>
      <span
        className={clsx(
          'min-w-0 flex-1 truncate font-mono select-all',
          big ? 'text-fs18 font-semibold tracking-[0.2em]' : 'text-fs12 text-stone-600 dark:text-stone-300',
        )}
        title={value}
      >
        {value}
      </span>
      <button
        type="button"
        onClick={() => void copy()}
        className="rounded-md p-1.5 text-stone-500 hover:bg-stone-200/70 dark:hover:bg-stone-800"
        aria-label={`复制${label}`}
      >
        {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
      </button>
    </div>
  )
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // HTTP 局域网地址不是安全上下文，没有 clipboard API，退回旧办法。
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
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
