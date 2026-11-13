import { useEffect, useState } from 'react'
import type { Source } from './api'
// 带扩展名：node 直接跑路由测试时需要。
import { isSource } from './platforms.ts'

export type ProjectTab = 'overview' | 'tasks' | 'messages' | 'fixes' | 'settings'
export type SettingsTab = 'connections' | 'reminders' | 'ai' | 'access'

export type Route =
  | { name: 'messages'; group?: number; anchor?: number }
  | { name: 'tasks' }
  | { name: 'projects' }
  | { name: 'project'; key: string; tab: ProjectTab }
  | { name: 'log' }
  | { name: 'settings'; tab: SettingsTab; source?: Source }

const projectTabs: ProjectTab[] = ['overview', 'tasks', 'messages', 'fixes', 'settings']
const settingsTabs: SettingsTab[] = ['connections', 'reminders', 'ai', 'access']

const redirects: Record<string, string> = {
  overview: '#/projects',
  timeline: '#/messages',
  inbox: '#/messages',
  awaiting: '#/messages',
  groups: '#/projects',
}

export function parse(hash: string): Route {
  const [path, search = ''] = hash.replace(/^#\/?/, '').split('?')
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent)
  const [head, a, b] = parts
  switch (head) {
    case 'messages': {
      const group = Number(a)
      const anchor = Number(new URLSearchParams(search).get('anchor'))
      return {
        name: 'messages',
        group: Number.isFinite(group) && a ? group : undefined,
        anchor: Number.isInteger(anchor) && anchor > 0 ? anchor : undefined,
      }
    }
    case 'tasks':
      return { name: 'tasks' }
    case 'projects':
      if (!a) return { name: 'projects' }
      return { name: 'project', key: a, tab: projectTabs.includes(b as ProjectTab) ? (b as ProjectTab) : 'overview' }
    case 'log':
      return { name: 'log' }
    case 'settings': {
      // 日志原先在设置下，旧链接 #/settings/log 仍然有效。
      if (a === 'log') return { name: 'log' }
      const source = new URLSearchParams(search).get('source')
      return {
        name: 'settings',
        tab: settingsTabs.includes(a as SettingsTab) ? (a as SettingsTab) : 'connections',
        source: isSource(source) ? source : undefined,
      }
    }
    default:
      return { name: 'messages' }
  }
}

export function href(route: Route): string {
  switch (route.name) {
    case 'messages':
      return `${route.group ? `#/messages/${route.group}` : '#/messages'}${route.anchor ? `?anchor=${route.anchor}` : ''}`
    case 'tasks':
      return '#/tasks'
    case 'projects':
      return '#/projects'
    case 'project':
      return `#/projects/${encodeURIComponent(route.key)}${route.tab === 'overview' ? '' : `/${route.tab}`}`
    case 'log':
      return '#/log'
    case 'settings':
      return `${route.tab === 'connections' ? '#/settings' : `#/settings/${route.tab}`}${route.source ? `?source=${route.source}` : ''}`
  }
}

export function navigate(route: Route) {
  const next = href(route)
  if (window.location.hash !== next) window.location.hash = next
}

function current(): Route {
  const head = window.location.hash.replace(/^#\/?/, '').split(/[/?]/)[0]
  const redirect = redirects[head]
  if (redirect) {
    window.history.replaceState(null, '', redirect)
    return parse(redirect)
  }
  return parse(window.location.hash)
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(current)
  useEffect(() => {
    const onHash = () => setRoute(current())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return route
}
