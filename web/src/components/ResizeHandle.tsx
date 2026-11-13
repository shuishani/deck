import clsx from 'clsx'
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { localStore } from '../localStore'

export interface PaneSize {
  key: string
  initial: number
  min: number
  max: number
}

const stores = new Map<string, ReturnType<typeof localStore<number>>>()

function storeOf(size: PaneSize) {
  let store = stores.get(size.key)
  if (!store) {
    store = localStore<number>(size.key, () => size.initial)
    stores.set(size.key, store)
  }
  return store
}

const clamp = (size: PaneSize, value: number) => Math.round(Math.min(size.max, Math.max(size.min, value)))

export function usePaneWidth(size: PaneSize) {
  const store = storeOf(size)
  const width = clamp(size, store.use())
  return [width, (value: number) => store.set(clamp(size, value))] as const
}

/** 贴在面板右边缘的拖动条；父元素需 relative。双击恢复默认宽度。 */
export function ResizeHandle({ size, label }: { size: PaneSize; label: string }) {
  const [width, setWidth] = usePaneWidth(size)
  const [dragging, setDragging] = useState(false)
  const start = useRef<{ x: number; width: number } | null>(null)

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    start.current = { x: event.clientX, width }
    setDragging(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!start.current) return
    setWidth(start.current.width + event.clientX - start.current.x)
  }

  function stop() {
    start.current = null
    setDragging(false)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 48 : 16
    if (event.key === 'ArrowLeft') setWidth(width - step)
    else if (event.key === 'ArrowRight') setWidth(width + step)
    else return
    event.preventDefault()
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={size.min}
      aria-valuemax={size.max}
      tabIndex={0}
      title={`拖动调整宽度，双击恢复默认`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onDoubleClick={() => setWidth(size.initial)}
      onKeyDown={onKeyDown}
      className="group absolute inset-y-0 -right-1.5 z-20 w-3 cursor-col-resize touch-none outline-none max-md:hidden"
    >
      <span
        className={clsx(
          'absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 transition-colors',
          dragging
            ? 'bg-accent-500'
            : 'bg-transparent group-hover:bg-stone-300 group-focus-visible:bg-accent-500 dark:group-hover:bg-stone-600',
        )}
      />
    </div>
  )
}
