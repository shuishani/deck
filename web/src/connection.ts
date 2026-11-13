export type ConnectionState = 'connecting' | 'online' | 'reconnecting'

export const RECONNECTED_EVENT = 'deck:reconnected'

interface PollOptions<T> {
  probe: (signal: AbortSignal) => Promise<T>
  onValue: (value: T, recovered: boolean) => void
  onState?: (state: ConnectionState) => void
  onError?: (error: unknown) => void
  interval?: number
  schedule?: (run: () => void, ms: number) => number
  cancel?: (id: number) => void
}

/** 仅用于只读探测；不会重试发送、配对或其他写请求。 */
export function startPolling<T>({ probe, onValue, onState, onError, interval = 3000,
  schedule = (run, ms) => window.setTimeout(run, ms),
  cancel = (id) => window.clearTimeout(id),
}: PollOptions<T>) {
  let stopped = false
  let busy = false
  let failed = false
  let timer: number | undefined
  let controller: AbortController | undefined

  async function run() {
    if (stopped || busy) return
    if (timer !== undefined) cancel(timer)
    timer = undefined
    busy = true
    controller = new AbortController()
    try {
      const value = await probe(controller.signal)
      if (stopped) return
      const recovered = failed
      failed = false
      onState?.('online')
      onValue(value, recovered)
    } catch (error) {
      if (stopped) return
      failed = true
      onState?.('reconnecting')
      onError?.(error)
    } finally {
      busy = false
      if (!stopped) timer = schedule(() => { void run() }, interval)
    }
  }

  void run()
  return {
    wake: () => { void run() },
    disconnect: () => {
      if (stopped) return
      failed = true
      onState?.('reconnecting')
    },
    stop: () => {
      stopped = true
      if (timer !== undefined) cancel(timer)
      controller?.abort()
    },
  }
}
