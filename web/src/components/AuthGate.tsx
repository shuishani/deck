import { useCallback, useEffect, useState } from 'react'
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

  const check = useCallback(() => {
    setGate({ state: 'checking' })
    api
      .auth()
      .then(({ authenticated }) => {
        if (authenticated && loginLink()) window.history.replaceState(null, '', '#/inbox')
        setGate(authenticated ? { state: 'in' } : { state: 'out' })
      })
      .catch((err) => {
        // 还没有登录功能的旧后端：没有 /auth，直接进。
        if (err instanceof ApiError && err.status === 404) return setGate({ state: 'in' })
        setGate({ state: 'unreachable', message: err instanceof Error ? err.message : String(err) })
      })
  }, [])

  useEffect(() => {
    // 只在第一次进来时检查；之后靠 401 事件和登录结果切换。
    if (gate.state === 'checking') check()
  }, [])

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
      return <Unreachable message={gate.message} onRetry={check} />
    case 'out':
      return <Login key={gate.code ?? 'manual'} initialCode={gate.code} onDone={loggedIn} />
    case 'in':
      return <App />
  }
}
