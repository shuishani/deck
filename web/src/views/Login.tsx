import { KeyRound, Loader2, Lock, WifiOff } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { api } from '../api'
import { Logo } from '../components/Logo'
import { Button, inputClass } from '../components/ui'

export function normalizeCode(text: string) {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)
}

export function Login({ initialCode, onDone }: { initialCode?: string; onDone: () => void }) {
  const [usePassword, setUsePassword] = useState(false)
  const [passwordAvailable, setPasswordAvailable] = useState(false)

  useEffect(() => {
    if (initialCode) return
    api
      .auth()
      .then((info) => {
        if (!info.password) return
        setPasswordAvailable(true)
        setUsePassword(true)
      })
      .catch(() => {})
  }, [initialCode])

  if (usePassword) return <PasswordLogin onDone={onDone} onUseCode={() => setUsePassword(false)} />
  return (
    <CodeLogin
      initialCode={initialCode}
      onDone={onDone}
      onUsePassword={passwordAvailable ? () => setUsePassword(true) : undefined}
    />
  )
}

function PasswordLogin({ onDone, onUseCode }: { onDone: () => void; onUseCode: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => input.current?.focus(), [])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!password || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.loginWithPassword(password)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
      input.current?.select()
    }
  }

  return (
    <AuthScreen>
      <h1 className="text-fs18 font-semibold">登录 deck</h1>
      <p className="mt-1 text-fs13 text-stone-500 dark:text-stone-400">输入本机密码。</p>
      <form onSubmit={onSubmit} className="mt-5 space-y-3">
        <div className="relative">
          <Lock className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" />
          <input
            ref={input}
            type="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
              setError(null)
            }}
            autoComplete="current-password"
            placeholder="本机密码"
            aria-label="本机密码"
            className={`${inputClass} h-11 pl-9 text-fs15`}
          />
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-fs13 text-red-700 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" className="h-10 w-full text-fs14" disabled={!password || busy}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {busy ? '登录中…' : '登录'}
        </Button>
      </form>
      <div className="mt-5 border-t border-stone-100 pt-4 text-fs12 leading-relaxed text-stone-500 dark:border-stone-800 dark:text-stone-400">
        忘记密码：在终端执行{' '}
        <code className="rounded bg-stone-100 px-1 py-0.5 font-mono text-fs11 text-stone-700 dark:bg-stone-800 dark:text-stone-300">
          deck access password
        </code>{' '}
        重新设置。
        <button type="button" onClick={onUseCode} className="ml-1 text-accent-700 hover:underline dark:text-accent-100">
          改用登录码
        </button>
      </div>
    </AuthScreen>
  )
}

function CodeLogin({
  initialCode,
  onDone,
  onUsePassword,
}: {
  initialCode?: string
  onDone: () => void
  onUsePassword?: () => void
}) {
  const [code, setCode] = useState(() => normalizeCode(initialCode ?? ''))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const autoTried = useRef(false)
  const input = useRef<HTMLInputElement>(null)

  async function submit(value: string) {
    if (value.length < 10 || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.login(value)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
      input.current?.focus()
    }
  }

  useEffect(() => {
    if (autoTried.current) return
    autoTried.current = true
    if (initialCode) void submit(normalizeCode(initialCode))
    else input.current?.focus()
    // 只在打开时用链接里的登录码自动登录一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void submit(code)
  }

  const autoSubmitting = busy && !!initialCode && !error

  return (
    <AuthScreen>
      <h1 className="text-fs18 font-semibold">登录 deck</h1>
      <p className="mt-1 text-fs13 text-stone-500 dark:text-stone-400">
        {autoSubmitting ? '正在使用链接中的登录码登录…' : '输入登录码以授权本设备访问 deck。'}
      </p>
      <form onSubmit={onSubmit} className="mt-5 space-y-3">
        <div className="relative">
          <KeyRound className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" />
          <input
            ref={input}
            value={code}
            onChange={(event) => {
              setCode(normalizeCode(event.target.value))
              setError(null)
            }}
            inputMode="text"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="10 位登录码"
            aria-label="登录码"
            className={`${inputClass} h-11 pl-9 font-mono text-fs16 tracking-[0.25em] placeholder:font-sans placeholder:tracking-normal`}
          />
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-fs13 text-red-700 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" className="h-10 w-full text-fs14" disabled={code.length < 10 || busy}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {busy ? '登录中…' : '登录'}
        </Button>
      </form>
      <div className="mt-5 border-t border-stone-100 pt-4 text-fs12 leading-relaxed text-stone-500 dark:border-stone-800 dark:text-stone-400">
        获取登录码：在运行 deck 的电脑上执行{' '}
        <code className="rounded bg-stone-100 px-1 py-0.5 font-mono text-fs11 text-stone-700 dark:bg-stone-800 dark:text-stone-300">
          deck access link
        </code>
        ，或在已登录设备的「设置 → 访问 → 添加设备」中扫码或复制。
        {onUsePassword && (
          <button type="button" onClick={onUsePassword} className="ml-1 text-accent-700 hover:underline dark:text-accent-100">
            改用本机密码
          </button>
        )}
      </div>
    </AuthScreen>
  )
}

export function Unreachable({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <AuthScreen>
      <div className="flex items-center gap-2">
        <WifiOff className="size-5 text-stone-400" />
        <h1 className="text-fs18 font-semibold">无法连接 deck</h1>
      </div>
      <p className="mt-2 text-fs13 leading-relaxed text-stone-500 dark:text-stone-400">{message}</p>
      <p className="mt-1 text-fs12 text-stone-400">正在自动重试，恢复后会继续使用原登录状态，无需换地址或重新配对。同 Wi-Fi 可直连，外网需开启 Tailscale；电脑需保持开机且 deck 正在运行。</p>
      <Button variant="primary" className="mt-5 h-10 w-full text-fs14" onClick={onRetry}>
        重试
      </Button>
    </AuthScreen>
  )
}

export function Checking() {
  return (
    <div className="flex h-dvh items-center justify-center text-stone-400">
      <Loader2 className="size-5 animate-spin" />
    </div>
  )
}

function AuthScreen({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-stone-50 px-4 py-10 dark:bg-stone-950">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <Logo className="size-9" />
          <span className="text-fs18 font-semibold tracking-tight">deck</span>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
          {children}
        </div>
      </div>
    </div>
  )
}
