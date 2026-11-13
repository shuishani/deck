import { useEffect, useState } from 'react'
import { startPolling } from '../connection'
import { api, ApiError, UNAUTHORIZED_EVENT } from '../api'
import { Checking, Login, Unreachable } from '../views/Login'
import App from '../App'

type Gate =
  | { state: 'checking' }
  | { state: 'in' }
  | { state: 'out'; code?: string }
  | { state: 'unreachable'; message: string }

function loginLink(): { code?: string } | null {
  const hash = window.location.hash
  if (!/^#\/?login(?:[/?]|$)/.test(hash)) return null
  const query = hash.split('?')[1] ?? ''
  return { code: new URLSearchParams(query).get('code') ?? undefined }
}

export function AuthGate() {
  const [gate, setGate] = useState<Gate>(() => {
    const link = loginLink()
    return link?.code ? { state: 'out', code: link.code } : { state: 'checking' }
  })

  const [attempt, setAttempt] = useState(0)
  const needsCheck = gate.state === 'checking' || gate.state === 'unreachable'

  useEffect(() => {
    if (!needsCheck) return
    const poll = startPolling({
      probe: async (signal) => {
        try {
          return await api.auth(signal)
        } catch (error) {
          // 兼容尚未提供登录接口的旧后端。
          if (error instanceof ApiError && error.status === 404) return { authenticated: true }
          throw error
        }
      },
      onValue: ({ authenticated }) => {
        if (authenticated && loginLink()) window.history.replaceState(null, '', '#/messages')
        setGate(authenticated ? { state: 'in' } : { state: 'out' })
      },
      onError: (error) => setGate({ state: 'unreachable', message: error instanceof Error ? error.message : String(error) }),
    })
    const wake = () => { if (document.visibilityState === 'visible') poll.wake() }
    window.addEventListener('online', wake)
    window.addEventListener('focus', wake)
    document.addEventListener('visibilitychange', wake)
    return () => {
      poll.stop()
      window.removeEventListener('online', wake)
      window.removeEventListener('focus', wake)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [needsCheck, attempt])

  useEffect(() => {
    const onUnauthorized = () => setGate((current) => (current.state === 'out' ? current : { state: 'out' }))
    const onHash = () => {
      const link = loginLink()
      if (link?.code) setGate({ state: 'out', code: link.code })
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    window.addEventListener('hashchange', onHash)
    return () => {
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
      window.removeEventListener('hashchange', onHash)
    }
  }, [])

  function loggedIn() {
    // 登录链接用完就去掉，免得留在历史和地址栏里；其他情况回到原来的页面。
    if (loginLink()) window.history.replaceState(null, '', '#/inbox')
    setGate({ state: 'in' })
  }

  switch (gate.state) {
    case 'checking':
      return <Checking />
    case 'unreachable':
      return <Unreachable message={gate.message} onRetry={() => setAttempt((n) => n + 1)} />
    case 'out':
      return <Login key={gate.code ?? 'manual'} initialCode={gate.code} onDone={loggedIn} />
    case 'in':
      return <App />
  }
}
