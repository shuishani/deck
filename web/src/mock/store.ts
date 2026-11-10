import { useSyncExternalStore } from 'react'

export function localStore<T>(key: string, initial: () => T) {
  let value: T = (() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw !== null) return JSON.parse(raw) as T
    } catch {
      // 读不出来就用初始值
    }
    return initial()
  })()
  const listeners = new Set<() => void>()

  function set(next: T | ((current: T) => T)) {
    value = typeof next === 'function' ? (next as (current: T) => T)(value) : next
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // 存不进去也不影响当前页面
    }
    listeners.forEach((listener) => listener())
  }

  function subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  function use(): T {
    return useSyncExternalStore(subscribe, () => value)
  }

  return { get: () => value, set, use }
}
