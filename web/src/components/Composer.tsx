import clsx from 'clsx'
import { AlertTriangle, ArrowLeft, Bot, CornerUpLeft, Loader2, Paperclip, Pencil, Send, Sparkles, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { api, type Message, type PublicAttachment, type Preview } from '../api'
import { aiMarks } from '../platforms'
import { summarize } from '../format'
import { useLoad, type GroupInfo, type ReplyDraft, useActions, useData } from '../state'
import { checkAttachment, sizeLabel } from '../upload'
import { useToast } from './Toast'

const TOUCH = window.matchMedia('(pointer: coarse)').matches

export function Composer({
  group,
  reply,
  onClearReply,
}: {
  group: GroupInfo
  reply: ReplyDraft | null
  onClearReply: () => void
}) {
  const { config } = useData()
  const { bump } = useActions()
  const toast = useToast()
  const [text, setText] = useState('')
  const [ai, setAi] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const prod = group.kind === 'prod'
  const editing = !!reply?.edit
  const [saved, setSaved] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [aiDraft, setAiDraft] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [uploaded, setUploaded] = useState<PublicAttachment | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  const capabilities = useLoad(() => api.capabilities(), [])
  const cap = capabilities.data?.sources[group.source]
  const attachmentReplyBlocked = !!reply && cap?.reply_attachments === false
  const canAttach = !!cap && cap.max_files >= 1 && (cap.send_images || cap.send_files) && !attachmentReplyBlocked
  const thumb = useMemo(() => (file?.type.startsWith('image/') ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => { if (thumb) URL.revokeObjectURL(thumb) }, [thumb])

  function choose(next: File | null) {
    setFileError(null)
    if (!next) {
      setFile(null)
      setUploaded(null)
      return
    }
    if (attachmentReplyBlocked) return setFileError('该平台不支持带附件的引用回复，请先取消引用')
    const problem = cap ? checkAttachment(next, cap) : '正在读取平台能力，请稍后再试'
    // 新文件不合格时保留原来选好的附件，只提示，不挡发送。
    if (problem) return setFileError(file ? `${problem}；仍使用原附件` : problem)
    setUploaded(null)
    setFile(next)
  }

  async function aiAssist(message: Message, instruction?: string) {
    if (drafting) return
    setDrafting(true)
    setError(null)
    try {
      const result = await api.draftAi({ message_id: message.id, instruction })
      setText(result.draft)
      setAi(true)
      setAiDraft(true)
      setTimeout(() => input.current?.focus(), 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDrafting(false)
    }
  }

  useEffect(() => {
    setPreview(null)
    setError(null)
    if (reply?.edit) {
      // 进入编辑时先把正在写的内容存起来，退出编辑再放回去。
      setSaved((current) => (editing ? current : text))
      setText(reply.replyTo.text)
    }
    if (reply?.initialText !== undefined) {
      // 已写了内容时不覆盖，把草稿接在后面。
      setText((current) => (current.trim() ? `${current.trimEnd()}\n\n${reply.initialText}` : reply.initialText!))
      setAi(!!reply.ai)
      setAiDraft(!!reply.ai)
    }
    if (reply) setTimeout(() => input.current?.focus(), 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reply])

  function cancel() {
    if (editing) setText(saved)
    onClearReply()
  }

  const body = {
    group: group.id,
    text: text.trim(),
    reply_to: editing ? null : (reply?.replyTo.remote_id ?? null),
    ai: editing ? false : ai,
    attachments: uploaded ? [uploaded.id] : undefined,
  }
  const unchanged = editing && body.text === reply!.replyTo.text.trim()

  async function review() {
    if ((!body.text && !file) || busy || unchanged) return
    setBusy(true)
    setError(null)
    try {
      if (file && attachmentReplyBlocked) throw new Error('该平台不支持带附件的引用回复，请先取消引用')
      let attachment = uploaded
      if (file && !attachment && !editing) {
        // 只暂存到本地；失败时保留已选文件，可直接重试。
        attachment = (await api.upload(group.id, file)).attachment
        setUploaded(attachment)
      }
      setPreview((editing ? await api.previewEdit(reply!.replyTo.id, body.text) : await api.preview({ ...body, attachments: attachment ? [attachment.id] : undefined, handle: reply?.handle })).preview)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      let warning: string | null = null
      if (editing) await api.editMessage(reply!.replyTo.id, body.text)
      else {
        if (!preview?.operation_id) throw new Error('请重新预览后发送')
        const result = await api.send(preview.operation_id)
        if (!result.sent) {
          setError(result.error || '发送结果待核实，请先查看群消息，不要重复发送')
          // 确定没发出时回到编辑，可修改后重新发送；结果未知时停在预览，避免重复发送。
          if (result.status === 'failed') back()
          bump()
          return
        }
        warning = result.sync_error
      }
      setText(editing ? saved : '')
      setFile(null)
      setUploaded(null)
      setAiDraft(false)
      setPreview(null)
      onClearReply()
      toast(warning ? `已发送，回读尚未完成。${warning}` : editing ? '已修改' : `已发送到「${group.name}」`, warning ? 'info' : 'success')
      bump()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  function back() {
    setPreview(null)
    setTimeout(() => input.current?.focus(), 0)
  }

  // 预览出现后把焦点放到确认按钮：Enter 只在输入区内生效，不会被页面别处（搜索框、对话框）的 Enter 触发。
  const confirmButton = useRef<HTMLButtonElement>(null)
  const backButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (preview) confirmButton.current?.focus()
  }, [preview])

  function onPreviewKey(event: KeyboardEvent) {
    if (!preview) return
    if (event.key === 'Escape') {
      event.preventDefault()
      back()
    } else if (event.key === 'Enter') {
      // 按住 Enter 产生的重复按键不算确认，免得一次按键连过「预览」和「确认」。
      if (event.repeat || event.nativeEvent.isComposing) return event.preventDefault()
      if (event.target === backButton.current) return
      event.preventDefault()
      void confirm()
    }
  }

  return (
    <div className="shrink-0 border-t border-stone-200 bg-white px-3 py-2.5 md:px-5 dark:border-stone-800 dark:bg-stone-950">
      <div
        onKeyDown={onPreviewKey}
        className={clsx(
          'mx-auto max-w-3xl rounded-xl border bg-white dark:bg-stone-900',
          preview
            ? prod
              ? 'border-rose-300 dark:border-rose-500/40'
              : 'border-accent-500/60'
            : 'border-stone-200 focus-within:border-accent-500 focus-within:ring-2 focus-within:ring-accent-500/15 dark:border-stone-700',
        )}
      >
        {reply && (
          <div className="flex items-center gap-2 border-b border-stone-100 px-3 py-1.5 text-fs12 text-stone-500 dark:border-stone-800 dark:text-stone-400">
            {editing ? <Pencil className="size-3.5 shrink-0" /> : <CornerUpLeft className="size-3.5 shrink-0" />}
            <span className="min-w-0 flex-1 truncate">
              {editing ? (
                <>
                  编辑消息：{summarize(reply.replyTo)}
                </>
              ) : (
                <>
              回复 <span className="font-medium text-stone-700 dark:text-stone-200">{reply.replyTo.is_me ? '我' : reply.replyTo.sender_name}</span>：
              {summarize(reply.replyTo) || '（无文本内容）'}
                </>
              )}
            </span>
            {!preview && (
              <button onClick={cancel} className="rounded p-0.5 hover:bg-stone-100 dark:hover:bg-stone-800" aria-label={editing ? '取消编辑' : '取消回复'}>
                <X className="size-3.5" />
              </button>
            )}
          </div>
        )}

        {preview ? (
          <div className="space-y-2 px-3 pt-2.5">
            <p
              className={clsx(
                'flex items-center gap-1.5 text-fs12 font-medium',
                prod ? 'text-rose-700 dark:text-rose-300' : 'text-stone-600 dark:text-stone-300',
              )}
            >
              {prod && <AlertTriangle className="size-3.5 shrink-0" />}
              {editing
                ? `确认修改「${preview.group}」中的这条消息？`
                : prod
                  ? `正式群「${preview.group}」，请核对内容后再发送，群内所有成员可见。`
                  : `确认发送到「${preview.group}」，群内所有成员可见。`}
            </p>
            {preview.notice && <p className="text-fs12 text-stone-500">{preview.notice}</p>}
            <p className="max-h-40 overflow-y-auto rounded-lg bg-stone-50 px-3 py-2 leading-[1.6] break-words whitespace-pre-wrap dark:bg-stone-800/60">
              {preview.text}
            </p>
            {preview.attachments?.map((item) => (
              <div key={item.id} className="flex items-center gap-2 rounded-lg bg-stone-50 p-2 text-fs12 dark:bg-stone-800/60">
                {item.kind === 'image' ? (
                  <img src={api.uploadUrl(item.id)} alt={item.name} className="size-12 rounded object-cover" />
                ) : (
                  <Paperclip className="size-4 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                <span className="shrink-0 text-stone-400">{sizeLabel(item.size)}</span>
              </div>
            ))}
          </div>
        ) : (
          <textarea
            ref={input}
            value={text}
            readOnly={drafting}
            aria-busy={drafting}
            onChange={(event) => setText(event.target.value)}
            onPaste={(event) => {
              if (editing || !canAttach) return
              const image = Array.from(event.clipboardData.files).find((item) => item.type.startsWith('image/'))
              if (!image) return
              event.preventDefault()
              choose(image)
            }}
            onKeyDown={(event) => {
              // Enter 发送；⌘/Ctrl + Enter、Shift + Enter 换行；输入法选词时的 Enter 不算。手机上 Enter 换行，用按钮发送。
              if (event.key === 'Enter' && !event.nativeEvent.isComposing && !TOUCH) {
                if (event.metaKey || event.ctrlKey) {
                  event.preventDefault()
                  const el = event.currentTarget
                  el.setRangeText('\n', el.selectionStart, el.selectionEnd, 'end')
                  setText(el.value)
                } else if (!event.shiftKey) {
                  event.preventDefault()
                  void review()
                }
              }
              if (event.key === 'Escape' && reply) cancel()
            }}
            rows={Math.min(6, Math.max(2, text.split('\n').length))}
            placeholder={
              TOUCH
                ? '输入消息'
                : editing
                  ? '修改内容（Enter 保存，⌘ + Enter 换行，Esc 取消）'
                  : reply
                    ? '输入回复（Enter 发送，⌘ + Enter 换行，Esc 取消回复）'
                    : '输入消息（Enter 发送，⌘ + Enter 换行）'
            }
            className="block w-full resize-none bg-transparent px-3 pt-2.5 text-fs14 leading-[1.6] outline-none placeholder:text-stone-400"
          />
        )}

        {!preview && aiDraft && !editing && (
          <p className="px-3 pt-2 text-fs12 text-stone-500">AI 起草的内容，尚未发送；请核对修改，点「发送」后仍会先预览再确认。</p>
        )}
        {!preview && file && (
          <div className="mx-3 mt-2 flex items-center gap-2 rounded-lg bg-stone-50 p-2 text-fs12 dark:bg-stone-800/60">
            {thumb ? <img src={thumb} alt="" className="size-12 rounded object-cover" /> : <Paperclip className="size-4 shrink-0" />}
            <span className="min-w-0 flex-1 truncate">{file.name || '粘贴的图片'}</span>
            <span className="shrink-0 text-stone-400">{sizeLabel(file.size)}</span>
            <button onClick={() => choose(null)} disabled={busy} className="rounded p-0.5 hover:bg-stone-200 dark:hover:bg-stone-700" aria-label="移除附件">
              <X className="size-3.5" />
            </button>
          </div>
        )}
        {fileError && <p role="alert" className="px-3 pt-2 text-fs12 text-red-600 dark:text-red-400">{fileError}</p>}
        {error && <p role="alert" className="px-3 pt-2 text-fs12 break-words text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex items-center justify-between gap-2 px-2 py-2">
          {preview ? (
            <button
              ref={backButton}
              onClick={back}
              disabled={busy}
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-fs12 font-medium text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
            >
              <ArrowLeft className="size-3.5" />
              返回修改
            </button>
          ) : editing ? (
            <span />
          ) : (
            <div className="flex min-w-0 flex-wrap items-center gap-1">
              <input
                ref={picker}
                type="file"
                hidden
                accept={cap && !cap.send_files ? 'image/*' : undefined}
                onChange={(event) => {
                  choose(event.target.files?.[0] ?? null)
                  event.target.value = ''
                }}
              />
              {capabilities.data && (
                <button
                  type="button"
                  onClick={() => picker.current?.click()}
                  disabled={!canAttach || busy}
                  title={canAttach ? '添加图片或文件（最大 10 MB，也可直接粘贴图片）' : attachmentReplyBlocked ? '该平台不支持带附件的引用回复，请先取消引用' : '该平台暂不支持发送图片或文件'}
                  aria-label="添加附件"
                  className="inline-flex h-7 items-center rounded-md px-2 text-stone-500 hover:bg-stone-100 disabled:opacity-40 max-md:h-10 max-md:px-3 max-md:[&_svg]:size-[18px] dark:hover:bg-stone-800"
                >
                  <Paperclip className="size-3.5" />
                </button>
              )}
              {reply && !reply.replyTo.is_me && (
                <button
                  type="button"
                  onClick={() => void aiAssist(reply.replyTo, text.trim() || undefined)}
                  disabled={drafting || busy}
                  title="让 AI 起草回复：只填入输入框，不会自动发送；已输入的文字会作为要点"
                  className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-fs12 font-medium text-stone-500 hover:bg-stone-100 disabled:opacity-40 max-md:h-10 max-md:px-3 max-md:text-fs13 dark:hover:bg-stone-800"
                >
                  {drafting ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                  AI 起草
                </button>
              )}
              <button
                type="button"
                onClick={() => setAi(!ai)}
                aria-pressed={ai}
                title={
                  config?.marks_ai.includes(group.source)
                    ? `以 AI 身份发送：${aiMarks([group.source])}`
                    : config?.ai_prefix
                      ? `以 AI 身份发送：自动添加前缀「${config.ai_prefix}」`
                      : '以 AI 身份发送'
                }
                className={clsx(
                  'inline-flex h-7 items-center gap-1 rounded-md px-2 text-fs12 font-medium transition-colors max-md:h-10 max-md:px-3 max-md:text-fs13',
                  ai
                    ? 'bg-stone-900 text-stone-50 dark:bg-stone-100 dark:text-stone-900'
                    : 'text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800',
                )}
              >
                <Bot className="size-3.5" />
                以 AI 身份
              </button>
            </div>
          )}
          {preview ? (
            <button
              ref={confirmButton}
              onClick={() => void confirm()}
              disabled={busy}
              className={clsx(
                'inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-fs12 font-medium text-white disabled:opacity-50',
                prod ? 'bg-red-600 hover:bg-red-700' : 'bg-accent-600 hover:bg-accent-700',
              )}
            >
              <Send className="size-3.5" />
              {busy ? (editing ? '保存中…' : '发送中…') : editing ? '确认修改' : prod ? '确认发送到正式群' : '确认发送'}
            </button>
          ) : (
            <button
              onClick={() => void review()}
              disabled={(!body.text && !file) || busy || unchanged}
              className="inline-flex h-7 items-center gap-1.5 rounded-md bg-accent-600 px-3 text-fs12 font-medium text-white hover:bg-accent-700 disabled:opacity-40"
            >
              {editing ? <Pencil className="size-3.5" /> : <Send className="size-3.5" />}
              {busy ? '请稍候…' : editing ? '保存修改' : '发送'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
