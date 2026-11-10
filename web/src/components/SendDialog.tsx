import { AlertTriangle, ArrowLeft, Bot, Send } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, type Preview } from '../api'
import { groupKind } from '../mock/groupKind'
import type { SendTarget } from '../state'
import { useDeck } from '../state'
import { SourceBadge, sourceName } from './SourceBadge'
import { KindTag } from './Tags'
import { useToast } from './Toast'
import { Button, Dialog, Switch, inputClass } from './ui'

const TOUCH = window.matchMedia('(pointer: coarse)').matches

export function SendDialog({ target, onClose }: { target: SendTarget | null; onClose: () => void }) {
  const { config, bump } = useDeck()
  const toast = useToast()
  const [text, setText] = useState('')
  const [ai, setAi] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setText(target?.text ?? '')
    setAi(target?.ai ?? false)
    setPreview(null)
    setError(null)
    if (target?.text?.trim()) {
      void runPreview({ group: target.group, text: target.text.trim(), reply_to: target.replyTo?.remote_id ?? null, ai: !!target.ai })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])

  if (!target) return null
  const prod = groupKind(target.groupName) === 'prod'
  const body = { group: target.group, text: text.trim(), reply_to: target.replyTo?.remote_id ?? null, ai }

  async function runPreview(request: typeof body) {
    setBusy(true)
    setError(null)
    try {
      setPreview((await api.preview(request)).preview)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function doSend() {
    setBusy(true)
    setError(null)
    try {
      await api.send(body)
      toast(`已发到 ${target!.groupName}`)
      target!.onSent?.()
      bump()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={busy ? () => {} : onClose}
      title={preview ? '确认发送' : target.replyTo ? '回复消息' : '发送消息'}
      footer={
        preview ? (
          <>
            <Button variant="ghost" onClick={() => setPreview(null)} disabled={busy}>
              <ArrowLeft className="size-3.5" />
              返回修改
            </Button>
            <Button variant={prod ? 'danger' : 'primary'} onClick={doSend} disabled={busy}>
              <Send className="size-3.5" />
              {busy ? '发送中…' : prod ? '确认发到正式群' : '确认发送'}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button variant="primary" onClick={() => runPreview(body)} disabled={busy || !body.text}>
              {busy ? '生成预览…' : '预览'}
            </Button>
          </>
        )
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2 text-fs13 text-stone-500 dark:text-stone-400">
        <span>发到</span>
        <span className="inline-flex items-center gap-1.5 rounded-md bg-stone-100 px-2 py-0.5 font-medium text-stone-700 dark:bg-stone-800 dark:text-stone-200">
          <SourceBadge source={target.source} className="!size-4 !text-fs9" />
          {target.groupName}
        </span>
        <KindTag name={target.groupName} />
        <span className="text-stone-400">· {sourceName(target.source)}</span>
      </div>

      {target.replyTo && (
        <blockquote className="mb-4 rounded-lg border-l-[3px] border-stone-300 bg-stone-50 px-3 py-2 text-fs13 text-stone-600 dark:border-stone-600 dark:bg-stone-800/60 dark:text-stone-300">
          <div className="mb-0.5 font-medium">{target.replyTo.sender_name}</div>
          <p className="line-clamp-3 whitespace-pre-wrap">{target.replyTo.text || '（无文本内容）'}</p>
        </blockquote>
      )}

      {preview ? (
        <div className="space-y-3">
          {prod && (
            <div className="flex items-center gap-2 rounded-xl border border-orange-300 bg-orange-50 px-3.5 py-2.5 text-fs13 font-medium text-orange-800 dark:border-orange-500/40 dark:bg-orange-500/10 dark:text-orange-300">
              <AlertTriangle className="size-4 shrink-0" />
              这是正式群，请确认内容无误。
            </div>
          )}
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-fs13 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            确认后会真的发到「{preview.group}」，群里所有人都能看到。
          </div>
          <div className="rounded-xl border border-stone-200 bg-white px-4 py-3 leading-[1.6] whitespace-pre-wrap dark:border-stone-700 dark:bg-stone-950">
            {preview.text}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <textarea
            autoFocus
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && body.text) void runPreview(body)
            }}
            rows={5}
            placeholder={TOUCH ? '输入要发送的内容…' : '输入要发送的内容…（⌘ + Enter 预览）'}
            className={`${inputClass} resize-y leading-[1.6]`}
          />
          <Switch
            checked={ai}
            onChange={setAi}
            label={
              <span className="inline-flex items-center gap-1">
                <Bot className="size-3.5 text-stone-500" />
                以 AI 身份发送
                {config?.ai_prefix && <span className="text-stone-400">（自动加前缀：{config.ai_prefix}）</span>}
              </span>
            }
          />
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-fs13 text-red-700 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </p>
      )}
    </Dialog>
  )
}
