import clsx from 'clsx'
import { Bot, Check, Copy, CornerUpLeft, ListChecks, ListPlus, MessageSquareReply, Sparkles, Pencil, RotateCcw, SquareCheck, Undo2, type LucideIcon } from 'lucide-react'
import { forwardRef, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Message, Quote } from '../api'
import { aiMarks } from '../platforms'
import { copyText } from '../clipboard'
import { clock, fullTime, summarize } from '../format'
import { useActions } from '../state'
import { statusLabel } from '../tasks'
import { Attachments } from './Attachments'
import { Avatar } from './Avatar'
import { SourceBadge } from './SourceBadge'
import { useToast } from './Toast'

// 触屏上没有悬停，图标工具栏又小又看不出含义：点消息改为从底部弹出带文字的操作面板。
const TOUCH = window.matchMedia('(pointer: coarse)').matches

interface Actions {
  onReply?: (message: Message) => void
  onTask?: (message: Message) => void
  onHandled?: (message: Message, handled: boolean) => void
  onJump?: (message: number) => void
  onEdit?: (message: Message) => void
  onRetract?: (message: Message) => void
  onDraft?: (message: Message) => void
  /** 进入多选（没在选时）或切换选中（在选时）。 */
  onPick?: (message: Message) => void
}

export const MessageItem = forwardRef<
  HTMLElement,
  Actions & {
    message: Message
    compact?: boolean
    highlight?: boolean
    showGroup?: boolean
    variant?: 'chat' | 'list'
    picking?: boolean
    picked?: boolean
  }
>(function MessageItem({ message, compact, highlight, showGroup, variant = 'chat', picking, picked, ...actions }, ref) {
  const [armed, setArmed] = useState(false)
  const [sheet, setSheet] = useState(false)
  const { openTaskDetail } = useActions()
  const items = useActionItems(message, actions)
  const mine = variant === 'chat' && message.is_me

  if (message.retracted) {
    return (
      <article ref={ref} className="flex justify-center py-1.5">
        <span className="text-fs12 text-stone-400" title={fullTime(message.sent_at)}>
          {message.is_me ? '你' : message.sender_name || '对方'}撤回了一条消息
        </span>
      </article>
    )
  }

  const hasText = !!message.text.trim()
  const onlyMedia = !hasText && message.attachments.length > 0 && !message.quote

  const body = onlyMedia ? (
    <Attachments message={message.id} items={message.attachments} mine={mine} />
  ) : (
    <div
      className={clsx(
        'min-w-0',
        variant === 'chat' && 'rounded-2xl px-3 py-2',
        variant === 'chat' &&
          (mine
            ? clsx('bg-accent-100 dark:bg-accent-700/30', !compact && 'rounded-tr-md')
            : clsx('border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900', !compact && 'rounded-tl-md')),
      )}
    >
      {message.quote && <QuoteBlock quote={message.quote} mine={mine} onJump={actions.onJump} />}
      {hasText && <MessageText text={message.text} />}
      {message.attachments.length > 0 && (
        <div className={clsx(hasText && 'mt-2')}>
          <Attachments message={message.id} items={message.attachments} mine={mine} />
        </div>
      )}
      {!hasText && !message.attachments.length && <p className="text-stone-400 italic">（无文本内容）</p>}
    </div>
  )

  return (
    <article
      ref={ref}
      onClick={(event) => {
        // 操作面板挂在 body 上，React 事件仍会冒泡到这里，要排除。
        if (!event.currentTarget.contains(event.target as Node)) return
        if ((event.target as HTMLElement).closest('button, a, audio, video')) return
        if (picking) actions.onPick?.(message)
        else if (TOUCH) setSheet(items.length > 0)
        else setArmed((value) => !value)
      }}
      onMouseLeave={() => setArmed(false)}
      aria-selected={picking ? !!picked : undefined}
      className={clsx(
        'group relative flex gap-2.5 rounded-xl px-3 transition-colors',
        picking && 'cursor-pointer pl-10 hover:bg-stone-100/70 dark:hover:bg-stone-900',
        picked && '!bg-accent-50 dark:!bg-accent-500/10',
        compact || mine ? 'py-0.5' : 'pt-2 pb-0.5',
        mine && !compact && 'mt-1.5',
        mine && 'flex-row-reverse',
        highlight && 'bg-amber-50 dark:bg-amber-500/10',
        variant === 'list' && 'py-2.5 hover:bg-stone-50 dark:hover:bg-stone-900/60',
      )}
    >
      {picking && (
        <button
          onClick={() => actions.onPick?.(message)}
          role="checkbox"
          aria-checked={!!picked}
          aria-label={picked ? '取消选择' : '选择这条消息'}
          className={clsx(
            'absolute top-1/2 left-3 flex size-[18px] -translate-y-1/2 items-center justify-center rounded-full border-2 transition-colors',
            picked ? 'border-accent-600 bg-accent-600 text-white' : 'border-stone-300 bg-white dark:border-stone-600 dark:bg-stone-900',
          )}
        >
          {picked && <Check className="size-3" strokeWidth={3} />}
        </button>
      )}
      {mine ? null : compact ? <span className="w-8 shrink-0" /> : <Avatar name={message.sender_name} />}
      <div className={clsx('relative flex min-w-0 flex-col', variant === 'chat' ? 'max-w-[min(40rem,82%)]' : 'flex-1', mine && 'items-end')}>
        {!compact && !mine && (
          <header className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 leading-5">
            <span className="text-fs13 font-semibold">{message.is_me ? '我' : message.sender_name || '未知'}</span>
            <time className="text-fs12 text-stone-400 tabular-nums" title={fullTime(message.sent_at)}>
              {clock(message.sent_at)}
            </time>
            {message.edited && <span className="text-fs12 text-stone-400">已编辑</span>}
            {showGroup && (
              <span className="inline-flex max-w-[16rem] items-center gap-1 rounded-md bg-stone-100 py-0.5 pr-1.5 pl-0.5 text-fs12 text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                <SourceBadge source={message.source} className="!size-4 !text-fs9" />
                <span className="truncate">{message.group_name}</span>
              </span>
            )}
            <StateTag message={message} />
          </header>
        )}
        {mine ? (
          <div className="relative flex items-end gap-1.5">
            {!picking && !TOUCH && <Toolbar items={items} armed={armed} mine compact={compact} />}
            <span
              className={clsx(
                'mb-0.5 flex shrink-0 flex-col items-end text-fs11 leading-tight text-stone-400 tabular-nums',
                compact && !message.edited && 'opacity-0 transition-opacity group-hover:opacity-100',
              )}
              title={fullTime(message.sent_at)}
            >
              {message.edited && <span>已编辑</span>}
              <span>{clock(message.sent_at)}</span>
            </span>
            {body}
          </div>
        ) : (
          body
        )}
        {message.ai && (
          <span
            className="mt-1 inline-flex items-center gap-1 rounded-full border border-stone-200 bg-white px-2 py-px text-fs11 text-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400"
            title={`以 AI 身份发送：${aiMarks()}`}
          >
            <Bot className="size-3" />
            AI 发送
          </span>
        )}
        {!!message.tasks?.length && (
          <div className={clsx('mt-1 flex max-w-full flex-wrap gap-1', mine && 'justify-end')}>
            {message.tasks.map((task) => (
              <button
                key={task.id}
                onClick={() => openTaskDetail(task.id)}
                title={`查看任务：${task.title}`}
                className="inline-flex max-w-[16rem] items-center gap-1 rounded-full border border-stone-200 bg-white px-2 py-px text-fs11 text-stone-500 hover:border-accent-500/50 hover:text-accent-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400"
              >
                <ListChecks className="size-3 shrink-0" />
                <span className={clsx('shrink-0', task.status === 'done' ? 'text-emerald-600 dark:text-emerald-400' : 'text-stone-600 dark:text-stone-300')}>
                  {statusLabel(task.status)}
                </span>
                <span className="truncate">{task.title}</span>
              </button>
            ))}
          </div>
        )}
        {compact && message.attention && (
          <div className="mt-1">
            <StateTag message={message} />
          </div>
        )}
      </div>
      {!mine && !picking && !TOUCH && <Toolbar items={items} armed={armed} mine={false} compact={compact} />}
      {sheet && <ActionSheet message={message} items={items} onClose={() => setSheet(false)} />}
    </article>
  )
})

function QuoteBlock({ quote, mine, onJump }: { quote: Quote; mine: boolean; onJump?: (id: number) => void }) {
  const box = clsx(
    'mb-1.5 block w-full rounded-md border-l-2 px-2 py-1 text-left text-fs12 leading-[1.5]',
    mine ? 'border-accent-500/60 bg-white/50 dark:bg-black/15' : 'border-stone-300 bg-stone-50 dark:border-stone-600 dark:bg-stone-800/60',
  )
  if (!quote.found) {
    return (
      <span className={clsx(box, 'flex items-center gap-1 text-stone-400')}>
        <CornerUpLeft className="size-3" />
        回复了一条较早的消息
      </span>
    )
  }
  const inner = (
    <>
      <span className="block font-medium text-stone-600 dark:text-stone-300">{quote.is_me ? '我' : quote.sender_name}</span>
      <span className="line-clamp-2 text-stone-500 dark:text-stone-400">{quote.text || '（无文本内容）'}</span>
    </>
  )
  return onJump && quote.id !== null ? (
    <button onClick={() => onJump(quote.id!)} className={clsx(box, 'hover:opacity-80')} title="定位到原消息">
      {inner}
    </button>
  ) : (
    <span className={box}>{inner}</span>
  )
}

function StateTag({ message }: { message: Message }) {
  if (message.attention === 'mention') return <Tag tone="red">需回复</Tag>
  if (message.attention === 'issue') return <Tag tone="amber">疑似问题</Tag>
  if (message.handled) return <Tag tone="stone">已处理</Tag>
  return null
}

function Tag({ tone, children }: { tone: 'red' | 'amber' | 'stone'; children: ReactNode }) {
  return (
    <span
      className={clsx(
        'rounded px-1.5 text-fs11 leading-[18px] font-medium',
        tone === 'red' && 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300',
        tone === 'amber' && 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
        tone === 'stone' && 'text-stone-500 ring-1 ring-stone-200 ring-inset dark:text-stone-400 dark:ring-stone-700',
      )}
    >
      {children}
    </span>
  )
}

interface ActionItem {
  label: string
  icon: LucideIcon
  danger?: boolean
  run: () => void
}

function useActionItems(
  message: Message,
  { onReply, onTask, onHandled, onEdit, onRetract, onDraft, onPick }: Actions,
): ActionItem[] {
  const toast = useToast()
  const canCopy = !!message.text.trim()
  const items: (ActionItem | false)[] = [
    !!onHandled && !message.is_me && (!!message.attention || message.handled) &&
      (message.handled
        ? { label: '撤销已处理', icon: Undo2, run: () => onHandled(message, false) }
        : { label: '标记已处理', icon: Check, run: () => onHandled(message, true) }),
    !!onReply && { label: '回复', icon: MessageSquareReply, run: () => onReply(message) },
    !!onDraft && !message.is_me && canCopy && { label: 'AI 起草', icon: Sparkles, run: () => onDraft(message) },
    !!onTask && { label: '转为任务', icon: ListPlus, run: () => onTask(message) },
    !!onPick && { label: '多选', icon: SquareCheck, run: () => onPick(message) },
    canCopy && {
      label: '复制',
      icon: Copy,
      run: () => void copyText(message.text).then((ok) => toast(ok ? '已复制' : '复制失败，请手动选择文字复制', 'info')),
    },
    // 只有纯文字消息能改；图片、语音只能撤回。
    !!onEdit && message.is_me && canCopy && !message.attachments.length && { label: '编辑', icon: Pencil, run: () => onEdit(message) },
    !!onRetract && message.is_me && { label: '撤回', icon: RotateCcw, danger: true, run: () => onRetract(message) },
  ]
  return items.filter((item): item is ActionItem => !!item)
}

function Toolbar({ items, armed, mine, compact }: { items: ActionItem[]; armed: boolean; mine: boolean; compact?: boolean }) {
  if (!items.length) return null
  return (
    <div
      className={clsx(
        'absolute z-[2] flex w-max items-center gap-px rounded-lg border border-stone-200 bg-white p-0.5 shadow-sm transition-opacity focus-within:pointer-events-auto focus-within:opacity-100 md:group-hover:pointer-events-auto md:group-hover:opacity-100 dark:border-stone-700 dark:bg-stone-900',
        // 隐藏时不接收鼠标，免得盖住相邻消息、抢走悬停。
        armed ? 'opacity-100' : 'pointer-events-none opacity-0',
        // 我的消息放在气泡左侧，仍在这条消息的范围内，鼠标移过去不会离开；窄窗口放不下时改放在气泡上方。
        mine
          ? 'right-0 bottom-full mb-1 md:top-1/2 md:right-full md:bottom-auto md:mr-1 md:mb-0 md:-translate-y-1/2'
          : clsx('right-3', compact ? '-top-3' : 'top-1'),
      )}
    >
      {items.map((item) => (
        <Action key={item.label} {...item} />
      ))}
    </div>
  )
}

function Action({ label, icon: Icon, danger, run }: ActionItem) {
  return (
    <button
      onClick={run}
      aria-label={label}
      className={clsx(
        'group/action relative flex size-7 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800',
        danger ? 'hover:text-red-600 dark:hover:text-red-400' : 'hover:text-stone-900 dark:hover:text-stone-100',
      )}
    >
      <Icon className="size-4" />
      <span className="pointer-events-none absolute top-full left-1/2 mt-1.5 -translate-x-1/2 rounded bg-stone-900 px-1.5 py-0.5 text-fs11 whitespace-nowrap text-white opacity-0 transition-opacity delay-150 group-hover/action:opacity-100 dark:bg-stone-100 dark:text-stone-900">
        {label}
      </span>
    </button>
  )
}

function ActionSheet({ message, items, onClose }: { message: Message; items: ActionItem[]; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-stone-900/30 dark:bg-black/50" />
      <div
        role="dialog"
        aria-label="消息操作"
        onClick={(event) => event.stopPropagation()}
        className="relative w-full rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-xl dark:bg-stone-900"
      >
        <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-stone-300 dark:bg-stone-700" />
        <p className="line-clamp-2 border-b border-stone-100 px-5 pt-3 pb-2.5 text-fs13 text-stone-500 dark:border-stone-800">
          <span className="font-medium text-stone-700 dark:text-stone-200">{message.is_me ? '我' : message.sender_name || '对方'}</span>：
          {summarize(message) || '（无文本内容）'}
        </p>
        <ul className="p-2">
          {items.map(({ label, icon: Icon, danger, run }) => (
            <li key={label}>
              <button
                onClick={() => {
                  onClose()
                  run()
                }}
                className={clsx(
                  'flex h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-fs15 active:bg-stone-100 dark:active:bg-stone-800',
                  danger ? 'text-red-600 dark:text-red-400' : 'text-stone-800 dark:text-stone-100',
                )}
              >
                <Icon className={clsx('size-5', danger ? '' : 'text-stone-500 dark:text-stone-400')} />
                {label}
              </button>
            </li>
          ))}
        </ul>
        <div className="px-2 pb-2">
          <button onClick={onClose} className="h-12 w-full rounded-xl bg-stone-100 text-fs15 font-medium text-stone-700 dark:bg-stone-800 dark:text-stone-200">
            取消
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function MessageText({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (el && !expanded) setOverflowing(el.scrollHeight > el.clientHeight + 2)
  }, [text, expanded])

  return (
    <div>
      <p
        ref={ref}
        className={clsx(
          'leading-[1.6] break-words whitespace-pre-wrap text-stone-800 dark:text-stone-200',
          !expanded && 'line-clamp-6',
        )}
      >
        {highlightMentions(text)}
      </p>
      {(overflowing || expanded) && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-fs12 font-medium text-accent-600 hover:underline dark:text-accent-500"
        >
          {expanded ? '收起' : '展开全文'}
        </button>
      )}
    </div>
  )
}

function highlightMentions(text: string) {
  return text.split(/(@[^\s@]+)/g).map((part, index) =>
    part.startsWith('@') && part.length > 1 ? (
      <span key={index} className="font-medium text-accent-700 dark:text-accent-500">
        {part}
      </span>
    ) : (
      part
    ),
  )
}
