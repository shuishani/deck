import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { CheckCircle2, AlertCircle, X } from 'lucide-react'
import clsx from 'clsx'

type Tone = 'success' | 'error' | 'info'
interface Toast {
  id: number
  tone: Tone
  text: string
}

const ToastContext = createContext<(text: string, tone?: Tone) => void>(() => {})

export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), [])
  const show = useCallback(
    (text: string, tone: Tone = 'success') => {
      const id = Date.now() + Math.random()
      setToasts((all) => [...all.slice(-3), { id, tone, text }])
      setTimeout(() => dismiss(id), tone === 'error' ? 6000 : 3200)
    },
    [dismiss],
  )
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="animate-toast-in pointer-events-auto flex items-start gap-2.5 rounded-xl border border-stone-200 bg-white px-3.5 py-3 shadow-lg shadow-stone-900/5 dark:border-stone-800 dark:bg-stone-900"
          >
            {toast.tone === 'error' ? (
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-500" />
            ) : (
              <CheckCircle2
                className={clsx('mt-0.5 size-4 shrink-0', toast.tone === 'success' ? 'text-emerald-500' : 'text-accent-500')}
              />
            )}
            <p className="flex-1 leading-5 break-words whitespace-pre-line">{toast.text}</p>
            <button
              onClick={() => dismiss(toast.id)}
              className="rounded p-0.5 text-stone-400 hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800"
              aria-label="关闭"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
