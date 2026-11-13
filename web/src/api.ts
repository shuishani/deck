export type Source = 'dingtalk' | 'channel'
export type GroupKind = 'test' | 'prod'
export type TaskStatus = 'todo' | 'doing' | 'review' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'

export interface TaskSource {
  group_id: number
  group_name: string
  message_id: number
  sender_name: string
  text: string
}

export interface Task {
  id: number
  title: string
  description: string
  project: string | null
  status: TaskStatus
  priority: TaskPriority
  due: string | null
  source: TaskSource | null
  created_by: 'me' | 'ai'
  created_at: string
  updated_at: string
  message_count: number
}

export type TaskInput = Partial<Pick<Task, 'title' | 'description' | 'project' | 'status' | 'priority' | 'due' | 'source'>>

export interface WatchState {
  /** off：会话已禁用 */
  mode: 'realtime' | 'poll' | 'paused' | 'off'
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
  kind: GroupKind
  today_count: number
  awaiting_count: number
  issue_count: number
  unread_count: number
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
  attachments: Attachment[]
  attention: AttentionReason | null
  handled: boolean
  quote: Quote | null
  retracted: boolean
  edited: boolean
  /** 以 AI 身份发出（deck 本地记录） */
  ai: boolean
  /** 由这条消息转成的任务；附件、搜索等接口可能不带 */
  tasks?: { id: number; title: string; status: TaskStatus }[]
}

export type Quote =
  | { found: true; id: number | null; sender_name: string; is_me: boolean; text: string }
  | { found: false }

export type AttentionReason = 'mention' | 'issue'

export interface Attachment {
  kind: 'image' | 'voice' | 'video' | 'file'
  name: string
  mime: string
  size: number | null
  width: number | null
  height: number | null
  duration_ms: number | null
  transcript: string | null
  transcribing: boolean
}

export interface AttentionMessage extends Message {
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
  kind: GroupKind
  remote_id: string
  added_at: string
  rules: GroupRules
  watch: WatchState
  mode: ConversationMode
  chat: 'group' | 'direct'
}

/** ai：监听并交给 AI；listen：只监听；off：禁用（不再拉取，保留消息） */
export type ConversationMode = 'ai' | 'listen' | 'off'
export type NotifyLevel = 'urgent' | 'high' | 'medium' | 'low'
/** 消息多少分钟没读也没回就推送；null 不推送。work 上班时间，off 下班后。 */
export type NotifyRule = { work: number | null; off: number | null }

export interface NotifySettings {
  enabled: boolean
  levels: Record<NotifyLevel, NotifyRule>
  /** 1 周一 … 7 周日 */
  work_days: number[]
  work_start: string
  work_end: string
  digest: boolean
  digest_time: string
  /** 钥匙串里有没有 Webhook / 加签密钥 */
  webhook: boolean
  signed: boolean
}
export type NotifyInput = Omit<NotifySettings, 'webhook' | 'signed'>

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
  /** 我以 AI 身份发送（不是 AI 自动执行）。 */
  as_ai: boolean
  /** 从哪个入口发起：web、cli、mcp、watcher；旧记录为 null。 */
  via: string | null
  action: string
  label: string
  category: string | null
  status: 'ok' | 'error'
  outcome: string
  result: string
  target: string
  object: { kind: 'group' | 'task' | 'project' | 'source' | 'device' | 'none'; id: number | string | null; label: string }
  detail: Record<string, unknown>
}

export interface LogQuery {
  category?: string
  failed?: boolean
  actor?: 'me' | 'ai'
  q?: string
  since?: string
  before?: number
  noise?: boolean
}

export interface Config {
  ai_prefix: string
  marks_ai: string[]
  retention_days: number
  poll_seconds: number
  sources: Source[]
  /** config.toml 里的默认值；overridden 是网页或 CLI 改过的字段。 */
  defaults: Partial<SettingsInput>
  overridden: (keyof SettingsInput)[]
  /** AI 已开启且配置完整；否则不显示 AI 入口 */
  ai_ready: boolean
}

export type SettingsInput = Pick<Config, 'ai_prefix' | 'retention_days' | 'poll_seconds'>

export interface GroupRules {
  scope: 'all' | 'mentions' | 'keywords' | 'off'
  keywords: string[]
  quiet_start: string | null
  quiet_end: string | null
}

/** 各类数据的版本：内容变了才变。health 是监听状态（暂停、出错、实时/轮询）。 */
export interface VersionParts {
  messages: string
  groups: string
  tasks: string
  config: string
  health: string
}

export interface SourceHealth {
  available: boolean
  version: string | null
  account: string | null
  expires_at: string | null
  auth_state: 'configured' | 'missing' | 'needs_login' | 'unknown'
  error: string | null
  checked_at: string
}

export interface SendResult {
  operation_id: string
  status: 'sending' | 'sent' | 'failed' | 'unknown'
  sent: boolean
  message_id: number | null
  sync_error: string | null
  error?: string
}

export interface Preview {
  operation_id?: string
  expires_at?: string
  group: string
  source: Source
  kind: GroupKind
  notice: string | null
  text: string
  attachments?: PublicAttachment[]
}

/** 上传后暂存在本地的附件；发送前不会离开 deck。 */
export interface PublicAttachment {
  id: string
  name: string
  size: number
  mime: string
  kind: 'image' | 'file'
}

export interface SourceCapability {
  send_text: boolean
  send_images: boolean
  send_files: boolean
  reply: boolean
  reply_attachments?: boolean
  edit: boolean
  retract: boolean
  max_attachment_bytes: number
  max_files: number
}

export type Capabilities = Record<Source, SourceCapability>

export interface AiUsage {
  input_tokens: number
  output_tokens: number
}

export interface AiSettings {
  enabled: boolean
  provider: 'openai-compatible'
  base_url: string
  model: string
  /** macOS 钥匙串条目名；密钥本身不经过浏览器 */
  api_key_keychain: string
  monthly_token_budget: number
  max_output_tokens: number
  configured: boolean
  /** 本机地址自动批准；其他地址须在电脑上用 CLI 批准 */
  endpoint_approved: boolean
  usage: AiUsage & { total_tokens: number; requests: number; reserved_tokens?: number }
}

export type AiSettingsInput = Pick<
  AiSettings,
  'enabled' | 'base_url' | 'model' | 'api_key_keychain' | 'monthly_token_budget' | 'max_output_tokens'
>

export interface AiReference {
  kind: 'message' | 'task'
  id: number
  group_id?: number
  title: string
  text: string
}

export interface AiAnswer {
  answer: string
  references: AiReference[]
  usage: AiUsage
  context: { messages: number; tasks: number; limited: boolean }
}

export interface AiDraft extends AiAnswer {
  draft: string
  group_id: number
  reply_to: string
  ai: true
}

export interface DeviceSession {
  id: string
  created_at: string
  last_seen_at: string | null
  user_agent: string
  ip: string
  origin: string | null
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
  pinned?: boolean
  status: string
  remote?: 'active' | 'pending' | 'none'
  route?: string
}

export interface EntryPlan {
  url: string
  route: string
  remote: 'active' | 'pending' | 'none'
  running: boolean
  routes_known: boolean
  previous_routes: string[] | null
  advertise_routes: string[] | null
  command: string | null
  rollback_command: string | null
  warnings: string[]
}

export interface AccessInfo {
  entry_plan: EntryPlan | null
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

export function mediaUrl(message: number, index: number) {
  return `api/media/${message}/${index}`
}

export const UNAUTHORIZED_EVENT = 'deck:unauthorized'

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = {}
  if (method !== 'GET') headers['X-Deck'] = '1'
  const raw = body instanceof Blob
  if (raw) headers['Content-Type'] = body.type || 'application/octet-stream'
  else if (body !== undefined) headers['Content-Type'] = 'application/json'
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  const timeout = method === 'GET' ? setTimeout(abort, path === '/version' || path === '/auth' ? 8000 : 30000) : undefined
  let response: Response
  let text: string
  try {
    // 始终留在同一 origin；网络路径变化不切换 IP，不重放任何写请求。
    response = await fetch(`api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      signal: controller.signal,
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    })
    text = await response.text()
  } catch {
    throw new ApiError('连接暂时中断，正在等待网络恢复；无需重新登录')
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      throw new ApiError(`服务返回内容无法解析（${response.status}）`, response.status)
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

// 全量搜索：独立于时间线，游标分页，结果可定位到具体消息。
export interface MessageSearchQuery {
  q: string
  project?: string
  group?: number
  cursor?: string
  limit?: number
}

export interface MessageSearchResult {
  hits: { message: Message; excerpt: string }[]
  next_cursor: string | null
}

export interface TimelineFilter {
  project?: string
  group?: number
  mine?: boolean
  /** 取这条消息前后的上下文，用于从搜索结果定位 */
  around?: number
}

export const api = {
  version: (signal?: AbortSignal) =>
    request<{ version: string; parts: VersionParts; audit: number }>('GET', '/version', undefined, signal),
  config: () => request<Config>('GET', '/config'),
  updateConfig: (body: Partial<SettingsInput> & { reset?: (keyof SettingsInput)[] }) =>
    request<{ config: SettingsInput }>('POST', '/config', body),
  sources: () => request<{ sources: { source: Source; paused: boolean; health: SourceHealth }[] }>('GET', '/sources'),
  setSourcePaused: (source: Source, paused: boolean) => request<unknown>('POST', `/sources/${source}/paused`, { paused }),
  overview: () => request<{ projects: OverviewProject[] }>('GET', '/overview'),
  timeline: (filter: TimelineFilter & { limit?: number; before?: number }) =>
    request<{ messages: Message[]; has_more: boolean }>(
      'GET',
      `/timeline${query({ ...filter, limit: filter.limit ?? 50 })}`,
    ),
  attention: (project?: string) =>
    request<{ messages: AttentionMessage[] }>('GET', `/attention${query({ project })}`),
  setHandled: (id: number, handled: boolean) =>
    request<unknown>('POST', `/messages/${id}/handled`, { handled }),
  previewEdit: (id: number, text: string) =>
    request<{ preview: Preview }>('POST', `/messages/${id}/edit`, { text }),
  editMessage: (id: number, text: string) => request<unknown>('POST', `/messages/${id}/edit`, { text, confirm: true }),
  retract: (id: number) => request<unknown>('POST', `/messages/${id}/retract`, { confirm: true }),
  message: (id: number) => request<{ message: Message }>('GET', `/messages/${id}`),
  markRead: (group: number) => request<unknown>('POST', `/groups/${group}/read`),
  projects: () => request<{ projects: Project[] }>('GET', '/projects'),
  addProject: (body: { key: string; name: string; repo?: string }) =>
    request<unknown>('POST', '/projects', body),
  updateProject: (key: string, body: { name?: string; repo?: string | null }) =>
    request<{ project: Project }>('POST', `/projects/${encodeURIComponent(key)}`, body),
  moveGroup: (id: number, project: string) => request<unknown>('POST', `/groups/${id}/project`, { project }),
  setGroupRules: (id: number, rules: GroupRules) => request<unknown>('POST', `/groups/${id}/rules`, rules),
  groups: () => request<{ groups: Group[] }>('GET', '/groups'),
  addGroup: (body: { project: string; source: Source; query: string }) =>
    request<{ id: number; name: string }>('POST', '/groups', body),
  removeGroup: (id: number) => request<unknown>('DELETE', `/groups/${id}`),
  setGroupKind: (id: number, kind: GroupKind) => request<unknown>('POST', `/groups/${id}/kind`, { kind }),
  setGroupMode: (id: number, mode: ConversationMode) => request<unknown>('POST', `/groups/${id}/mode`, { mode }),
  notify: () => request<{ settings: NotifySettings }>('GET', '/notify'),
  updateNotify: (body: Partial<NotifyInput>) => request<{ settings: NotifySettings }>('POST', '/notify', body),
  setWebhook: (url: string, secret: string) => request<{ settings: NotifySettings }>('POST', '/notify/webhook', { url, secret }),
  testNotify: () => request<unknown>('POST', '/notify/test'),
  tasks: () => request<{ tasks: Task[] }>('GET', '/tasks'),
  addTask: (body: TaskInput & { message_ids?: number[] }) => request<{ task: Task }>('POST', '/tasks', body),
  updateTask: (id: number, body: TaskInput) => request<{ task: Task }>('POST', `/tasks/${id}`, body),
  removeTask: (id: number) => request<unknown>('DELETE', `/tasks/${id}`),
  task: (id: number) => request<{ task: Task; messages: Message[]; missing: number[] }>('GET', `/tasks/${id}`),
  linkTaskMessages: (id: number, messages: number[]) =>
    request<{ task: Task }>('POST', `/tasks/${id}/messages`, { message_ids: messages }),
  unlinkTaskMessage: (id: number, message: number) => request<{ task: Task }>('DELETE', `/tasks/${id}/messages/${message}`),
  sync: (project?: string, source?: Source) =>
    request<{ results: SyncResult[] }>('POST', '/sync', { ...(project ? { project } : {}), ...(source ? { source } : {}) }),
  preview: (body: { group: number; text: string; reply_to?: string | null; ai: boolean; handle?: number; attachments?: string[] }) =>
    request<{ preview: Preview }>('POST', '/send', { ...body, confirm: false }),
  send: (operation_id: string) => request<SendResult>('POST', '/send', { operation_id, confirm: true }),
  capabilities: () => request<{ sources: Capabilities }>('GET', '/capabilities'),
  upload: (group: number, file: File, signal?: AbortSignal) =>
    request<{ attachment: PublicAttachment }>('POST', `/uploads${query({ group, name: file.name || 'image.png' })}`, file, signal),
  uploadUrl: (id: string) => `api/uploads/${encodeURIComponent(id)}`,
  search: (params: MessageSearchQuery, signal?: AbortSignal) =>
    request<MessageSearchResult>('GET', `/search${query({ ...params, limit: params.limit ?? 30 })}`, undefined, signal),
  aiSettings: () => request<{ settings: AiSettings }>('GET', '/ai/settings'),
  updateAiSettings: (body: Partial<AiSettingsInput>) => request<{ settings: AiSettings }>('POST', '/ai/settings', body),
  askAi: (body: { question: string; project?: string; group?: number }, signal?: AbortSignal) =>
    request<AiAnswer>('POST', '/ai/ask', body, signal),
  draftAi: (body: { message_id: number; instruction?: string }, signal?: AbortSignal) =>
    request<AiDraft>('POST', '/ai/draft', body, signal),
  log: ({ failed, noise, ...rest }: LogQuery = {}) =>
    request<{ entries: LogEntry[]; has_more: boolean; categories: { id: string; label: string }[] }>(
      'GET',
      `/log${query({ ...rest, failed: failed ? 1 : undefined, noise: noise === false ? 0 : undefined, limit: 50 })}`,
    ),
  auth: (signal?: AbortSignal) => request<{ authenticated: boolean; password?: boolean }>('GET', '/auth', undefined, signal),
  login: (code: string) => request<{ ok: boolean }>('POST', '/session', { code }),
  loginWithPassword: (password: string) => request<{ ok: boolean }>('POST', '/session', { password }),
  logout: () => request<unknown>('DELETE', '/session'),
  access: () => request<AccessInfo>('GET', '/access'),
  pinEntry: (url: string) => request<EntryPlan>('POST', '/access/entry', { url }),
  removeSession: (id: string) => request<unknown>('DELETE', `/sessions/${encodeURIComponent(id)}`),
  setSessionDisabled: (id: string, disabled: boolean) =>
    request<unknown>('POST', `/sessions/${encodeURIComponent(id)}/${disabled ? 'disable' : 'enable'}`),
  pair: () => request<{ code: string; expires_at: string }>('POST', '/pairings'),
}
