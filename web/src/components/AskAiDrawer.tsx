import clsx from 'clsx'
import { Loader2, Send, Sparkles, Square, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api, type AiAnswer, type AiReference } from '../api'
import { href } from '../router'
import { useData } from '../state'
import { inputClass, Select } from './ui'

const examples = ['总结所选范围最近反馈的问题', '所选项目还有哪些未完成任务？', '哪些消息还需要我处理？', '根据所选范围起草项目小结']

type Turn = {
  question: string
  scope: string
  state: 'loading' | 'done' | 'error'
  result?: AiAnswer
  error?: string
}

/** 范围编码：'' 不带本地上下文，'p:key' 整个项目，'g:id' 单个群。 */
function scopeBody(scope: string): { project?: string; group?: number } {
  if (scope.startsWith('p:')) return { project: scope.slice(2) }
  if (scope.startsWith('g:')) return { group: Number(scope.slice(2)) }
  return {}
}

export function referenceHref(ref: AiReference) {
  return ref.kind === 'task' ? href({ name: 'tasks' }) : href({ name: 'messages', group: ref.group_id, anchor: ref.id })
}

export function AskAiDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { overview } = useData()
  const [text, setText] = useState('')
  const [scope, setScope] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const input = useRef<HTMLTextAreaElement>(null)
  const pending = useRef<AbortController | null>(null)
  const end = useRef<HTMLDivElement>(null)
  const busy = turns.some((turn) => turn.state === 'loading')

  useEffect(() => {
    if (!open) return
    setTimeout(() => input.current?.focus(), 0)
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => () => pending.current?.abort(), [])
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }) }, [turns])

  function update(index: number, patch: Partial<Turn>) {
    setTurns((all) => all.map((turn, i) => (i === index ? { ...turn, ...patch } : turn)))
  }

  async function ask(raw: string) {
    const question = raw.trim()
    if (!question || busy) return
    const index = turns.length
    const controller = new AbortController()
    pending.current = controller
    setTurns((all) => [...all, { question, scope, state: 'loading' }])
    setText('')
    try {
      const result = await api.askAi({ question, ...scopeBody(scope) }, controller.signal)
      if (!controller.signal.aborted) update(index, { state: 'done', result })
    } catch (err) {
      if (controller.signal.aborted) update(index, { state: 'error', error: '已停止等待；已送达模型服务的请求仍可能完成并计费' })
      else update(index, { state: 'error', error: err instanceof Error ? err.message : String(err) })
    } finally {
      if (pending.current === controller) pending.current = null
    }
  }

  function scopeLabel(value: string) {
    if (value.startsWith('p:')) return overview?.find((p) => p.key === value.slice(2))?.name ?? value.slice(2)
    if (value.startsWith('g:')) return overview?.flatMap((p) => p.groups).find((g) => g.id === Number(value.slice(2)))?.name ?? '群'
    return ''
  }

  return (
    <>
      <div
        className={clsx(
          'fixed inset-0 z-40 bg-stone-900/20 transition-opacity dark:bg-black/40',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
      />
      <aside
        className={clsx(
          'fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-stone-200 bg-white transition-[translate,visibility,box-shadow] dark:border-stone-800 dark:bg-stone-900',
          open ? 'visible translate-x-0 shadow-2xl' : 'invisible translate-x-full shadow-none',
        )}
      >
        <header className="flex h-14 items-center gap-2 border-b border-stone-100 px-4 dark:border-stone-800">
          <span className="flex size-7 items-center justify-center rounded-lg bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-200">
            <Sparkles className="size-4" />
          </span>
          <h2 className="flex-1 font-semibold">问 AI</h2>
          <button onClick={onClose} className="rounded-md p-1 text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800" aria-label="关闭">
            <X className="size-4" />
          </button>
        </header>
        <div className="scroll-thin flex-1 space-y-4 overflow-y-auto p-4">
          {turns.length === 0 && (
            <div>
              <p className="text-fs13 leading-relaxed text-stone-500 dark:text-stone-400">
                选择范围后，使用其中最近最多 100 条消息和 50 条任务；不选范围则不附带本地数据。每次独立提问，不自动提交历史问答。例如：
              </p>
              <div className="mt-3 flex flex-col gap-2">
                {examples.map((example) => (
                  <button
                    key={example}
                    onClick={() => ask(example)}
                    className="rounded-lg border border-stone-200 px-3 py-2 text-left text-fs13 text-stone-700 transition-colors hover:border-stone-300 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-200 dark:hover:border-stone-600 dark:hover:bg-stone-800"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          )}
          {turns.map((turn, i) => (
            <div key={i} className="space-y-2">
              <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-stone-900 px-3.5 py-2 break-words whitespace-pre-wrap text-stone-50 dark:bg-stone-100 dark:text-stone-900">
                {turn.question}
                {turn.scope && <span className="mt-0.5 block text-fs11 opacity-60">范围：{scopeLabel(turn.scope)}</span>}
              </div>
              <div className="w-fit max-w-[92%] rounded-2xl rounded-bl-md bg-stone-100 px-3.5 py-2 text-stone-700 dark:bg-stone-800 dark:text-stone-200">
                {turn.state === 'loading' && (
                  <span className="inline-flex items-center gap-2 text-stone-500">
                    <Loader2 className="size-3.5 animate-spin" />
                    思考中…
                    <button onClick={() => pending.current?.abort()} className="inline-flex items-center gap-1 text-fs12 underline">
                      <Square className="size-3" />停止
                    </button>
                  </span>
                )}
                {turn.state === 'error' && <span role="alert" className="break-words text-red-600 dark:text-red-400">{turn.error}</span>}
                {turn.state === 'done' && turn.result && <Answer result={turn.result} onNavigate={onClose} />}
              </div>
            </div>
          ))}
          <div ref={end} />
        </div>
        <div className="border-t border-stone-100 p-3 dark:border-stone-800">
          <label className="mb-2 flex items-center gap-2 text-fs12 text-stone-500">
            <span className="shrink-0">范围</span>
            <Select
              field
              value={scope}
              options={[
                { id: '', label: '不带本地数据（仅提问）' },
                ...(overview ?? []).flatMap((project) => [
                  { id: `p:${project.key}`, label: `整个项目：${project.name}`, section: project.name },
                  ...project.groups.map((group) => ({ id: `g:${group.id}`, label: `群：${group.name}` })),
                ]),
              ]}
              onChange={setScope}
              label="数据范围"
              className="!h-8 min-w-0 flex-1 !text-fs13"
            />
          </label>
          <div className="flex items-end gap-2">
            <textarea
              ref={input}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  ask(text)
                }
              }}
              rows={2}
              placeholder="输入问题（Enter 发送）；选择范围后才会带上对应的本地数据"
              className={`${inputClass} resize-none`}
            />
            <button
              onClick={() => ask(text)}
              disabled={!text.trim() || busy}
              className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-stone-900 text-stone-50 hover:bg-stone-700 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
              aria-label="发送"
            >
              <Send className="size-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}

function Answer({ result, onNavigate }: { result: AiAnswer; onNavigate: () => void }) {
  const { answer, references, context, usage } = result
  return (
    <div className="space-y-2">
      <p className="leading-relaxed break-words whitespace-pre-wrap">{answer}</p>
      {references.length > 0 && (
        <ul className="space-y-1 border-t border-stone-200 pt-2 text-fs12 dark:border-stone-700">
          {references.map((ref) => (
            <li key={`${ref.kind}-${ref.id}`}>
              <a href={referenceHref(ref)} onClick={onNavigate} className="block min-w-0 rounded px-1 py-0.5 hover:bg-stone-200/70 dark:hover:bg-stone-700/60">
                <span className="text-stone-400">{ref.kind === 'task' ? '任务' : '消息'} #{ref.id} · </span>
                <span className="font-medium">{ref.title}</span>
                <span className="line-clamp-2 break-words text-stone-500">{ref.text}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className="text-fs11 text-stone-400">
        参考 {context.messages} 条消息、{context.tasks} 个任务{context.limited ? '（内容过多，已截取）' : ''} · {usage.input_tokens + usage.output_tokens} token
      </p>
    </div>
  )
}
