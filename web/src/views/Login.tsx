import { KeyRound, Loader2, WifiOff } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { api } from '../api'
import { Logo } from '../components/Logo'
import { Button, inputClass } from '../components/ui'

export function normalizeCode(text: string) {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)
}

export function Login({ initialCode, onDone }: { initialCode?: string; onDone: () => void }) {
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
        {autoSubmitting ? '正在用链接里的登录码登录…' : '输入登录码，把这台设备加入 deck。'}
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
        ，或在已登录的设备上打开 设置 → 访问 → 添加设备，扫码或复制登录码。
      </div>
    </AuthScreen>
  )
}

export function Unreachable({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <AuthScreen>
      <div className="flex items-center gap-2">
        <WifiOff className="size-5 text-stone-400" />
        <h1 className="text-fs18 font-semibold">连不上 deck</h1>
      </div>
      <p className="mt-2 text-fs13 leading-relaxed text-stone-500 dark:text-stone-400">{message}</p>
      <p className="mt-1 text-fs12 text-stone-400">确认运行 deck 的电脑开着、deck serve 在运行，并且这台设备能连到它的网络或中继。</p>
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
