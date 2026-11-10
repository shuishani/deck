import { useEffect, useState } from 'react'

export type ProjectTab = 'overview' | 'tasks' | 'messages' | 'fixes' | 'settings'
export type SettingsTab = 'connections' | 'ai' | 'access' | 'log'

export type Route =
  | { name: 'inbox' }
  | { name: 'messages'; group?: number }
  | { name: 'tasks' }
  | { name: 'projects' }
  | { name: 'project'; key: string; tab: ProjectTab }
  | { name: 'settings'; tab: SettingsTab }

const projectTabs: ProjectTab[] = ['overview', 'tasks', 'messages', 'fixes', 'settings']
const settingsTabs: SettingsTab[] = ['connections', 'ai', 'access', 'log']

const redirects: Record<string, string> = {
  overview: '#/projects',
  timeline: '#/messages',
  awaiting: '#/inbox',
  groups: '#/projects',
  log: '#/settings/log',
}

export function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean).map(decodeURIComponent)
  const [head, a, b] = parts
  switch (head) {
    case 'messages': {
      const group = Number(a)
      return { name: 'messages', group: Number.isFinite(group) && a ? group : undefined }
    }
    case 'tasks':
      return { name: 'tasks' }
    case 'projects':
      if (!a) return { name: 'projects' }
      return { name: 'project', key: a, tab: projectTabs.includes(b as ProjectTab) ? (b as ProjectTab) : 'overview' }
    case 'settings':
      return { name: 'settings', tab: settingsTabs.includes(a as SettingsTab) ? (a as SettingsTab) : 'connections' }
    default:
      return { name: 'inbox' }
  }
}

export function href(route: Route): string {
  switch (route.name) {
    case 'inbox':
      return '#/inbox'
    case 'messages':
      return route.group ? `#/messages/${route.group}` : '#/messages'
    case 'tasks':
      return '#/tasks'
    case 'projects':
      return '#/projects'
    case 'project':
      return `#/projects/${encodeURIComponent(route.key)}${route.tab === 'overview' ? '' : `/${route.tab}`}`
    case 'settings':
      return route.tab === 'connections' ? '#/settings' : `#/settings/${route.tab}`
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
