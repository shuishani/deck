export type Source = 'dingtalk' | 'channel'

export interface WatchState {
  mode: 'realtime' | 'poll'
  last_sync_at: string | null
  error: string | null
}

export interface LastMessage {
  sender_name: string
  is_me: boolean
  text: string
  sent_at: string
}

export interface OverviewGroup {
  id: number
  source: Source
  name: string
  today_count: number
  awaiting_count: number
  last_message: LastMessage | null
  watch: WatchState
}

export interface OverviewProject {
  key: string
  name: string
  repo: string | null
  awaiting_count: number
  groups: OverviewGroup[]
}

export interface Message {
  id: number
  group_id: number
  group_name: string
  source: Source
  sender_name: string
  is_me: boolean
  text: string
  sent_at: string
  reply_to: string | null
  remote_id: string
  awaiting: boolean
}

export interface AwaitingMessage extends Message {
  waiting_minutes: number
  overdue: boolean
}

export interface Project {
  key: string
  name: string
  repo: string | null
}

export interface Group {
  id: number
  project: string
  source: Source
  name: string
  remote_id: string
  added_at: string
  watch: WatchState
}

export interface SyncResult {
  id: number
  name: string
  added: number
  error: string | null
}

export interface LogEntry {
  id: number
  at: string
  actor: 'me' | 'ai'
  action: string
  target: string
  detail: string
  result: string
}

export interface Config {
  ai_prefix: string
  retention_days: number
  reply_reminder_hours: number
}

export interface Preview {
  group: string
  source: Source
  text: string
}

export interface DeviceSession {
  id: string
  created_at: string
  last_seen_at: string | null
  user_agent: string
  ip: string
  current: boolean
  disabled_at: string | null
}

export interface AccessAddress {
  kind: 'tailscale' | 'lan' | 'relay' | 'other' | 'local'
  label: string
  url: string
  secure: boolean
  usable: boolean
  recommended: boolean
  status: string
}

export interface AccessInfo {
  sessions: DeviceSession[]
  addresses: AccessAddress[]
  tls: boolean
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message)
  }
}

export const UNAUTHORIZED_EVENT = 'deck:unauthorized'

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (method !== 'GET') headers['X-Deck'] = '1'
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  let response: Response
  try {
    // 相对当前页面解析，deck 挂在中继的子路径下也能找到接口。
    response = await fetch(`api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError('连不上 deck 服务，确认 deck serve 在运行')
  }
  const text = await response.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      throw new ApiError(`服务返回了无法解析的内容（${response.status}）`, response.status)
    }
  }
  if (!response.ok) {
    const payload = data as { error?: string; auth?: boolean } | null
    if (response.status === 401 && payload?.auth) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    throw new ApiError(payload?.error || `请求失败（${response.status}）`, response.status)
  }
  return data as T
}

function query(params: Record<string, string | number | boolean | undefined | null>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === false) continue
    search.set(key, value === true ? '1' : String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

export interface TimelineFilter {
  project?: string
  group?: number
  mine?: boolean
}

export const api = {
  version: () => request<{ version: number }>('GET', '/version'),
  config: () => request<Config>('GET', '/config'),
  overview: () => request<{ projects: OverviewProject[] }>('GET', '/overview'),
  timeline: (filter: TimelineFilter & { limit?: number; before?: number }) =>
    request<{ messages: Message[]; has_more: boolean }>(
      'GET',
      `/timeline${query({ ...filter, limit: filter.limit ?? 50 })}`,
    ),
  awaiting: (project?: string) =>
    request<{ messages: AwaitingMessage[] }>('GET', `/awaiting${query({ project })}`),
  projects: () => request<{ projects: Project[] }>('GET', '/projects'),
  addProject: (body: { key: string; name: string; repo?: string }) =>
    request<unknown>('POST', '/projects', body),
  groups: () => request<{ groups: Group[] }>('GET', '/groups'),
  addGroup: (body: { project: string; source: Source; query: string }) =>
    request<{ id: number; name: string }>('POST', '/groups', body),
  removeGroup: (id: number) => request<unknown>('DELETE', `/groups/${id}`),
  sync: (project?: string) =>
    request<{ results: SyncResult[] }>('POST', '/sync', project ? { project } : {}),
  preview: (body: { group: number; text: string; reply_to?: string | null; ai: boolean }) =>
    request<{ preview: Preview }>('POST', '/send', { ...body, confirm: false }),
  send: (body: { group: number; text: string; reply_to?: string | null; ai: boolean }) =>
    request<{ sent: boolean }>('POST', '/send', { ...body, confirm: true }),
  log: (limit = 100) => request<{ entries: LogEntry[] }>('GET', `/log${query({ limit })}`),
  auth: () => request<{ authenticated: boolean }>('GET', '/auth'),
  login: (code: string) => request<{ ok: boolean }>('POST', '/session', { code }),
  logout: () => request<unknown>('DELETE', '/session'),
  access: () => request<AccessInfo>('GET', '/access'),
  removeSession: (id: string) => request<unknown>('DELETE', `/sessions/${encodeURIComponent(id)}`),
  setSessionDisabled: (id: string, disabled: boolean) =>
    request<unknown>('POST', `/sessions/${encodeURIComponent(id)}/${disabled ? 'disable' : 'enable'}`),
  pair: () => request<{ code: string; expires_at: string }>('POST', '/pairings'),
}
