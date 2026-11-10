import clsx from 'clsx'
import { Send, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { inputClass } from './ui'

const examples = ['总结今天 MX 群里的问题', '这周有哪些 bug 还没修？', '谁 @ 了我还没回？', '帮我写一份今天的日报']

interface Turn {
  question: string
}

export function AskAiDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const input = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!open) return
    setTimeout(() => input.current?.focus(), 0)
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  function ask(question: string) {
    if (!question.trim()) return
    setTurns((all) => [...all, { question: question.trim() }])
    setText('')
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
                以后可以直接问 deck 里的数据：各群的消息、你的回复、任务和操作记录。比如：
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
              <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-stone-900 px-3.5 py-2 text-stone-50 dark:bg-stone-100 dark:text-stone-900">
                {turn.question}
              </div>
              <div className="w-fit max-w-[85%] rounded-2xl rounded-bl-md bg-stone-100 px-3.5 py-2 text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                AI 问答即将推出：接上模型后，会在这里根据 deck 的数据回答。
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-stone-100 p-3 dark:border-stone-800">
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
              placeholder="问点什么…（Enter 发送）"
              className={`${inputClass} resize-none`}
            />
            <button
              onClick={() => ask(text)}
              disabled={!text.trim()}
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
