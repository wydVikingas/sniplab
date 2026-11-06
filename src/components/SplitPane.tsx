import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

export type SplitPaneSide = 'first' | 'second'

export interface SplitPaneProps {
  first: ReactNode
  second: ReactNode
  firstLabel: string
  secondLabel: string
  /** Which pane is visible on small screens, where the panes become tabs. */
  mobileActive: SplitPaneSide
  onMobileActiveChange(side: SplitPaneSide): void
  storageKey: string
  defaultRatio?: number
}

const MIN = 0.2
const MAX = 0.8
const clamp = (ratio: number) => Math.min(MAX, Math.max(MIN, ratio))

function readRatio(key: string, fallback: number): number {
  try {
    const stored = Number(localStorage.getItem(key))
    return stored ? clamp(stored) : fallback
  } catch {
    return fallback
  }
}

/** Two panes side by side with a draggable divider (md+), or tabs on small screens. */
export function SplitPane({
  first,
  second,
  firstLabel,
  secondLabel,
  mobileActive,
  onMobileActiveChange,
  storageKey,
  defaultRatio = 0.6,
}: SplitPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [ratio, setRatio] = useState(() => readRatio(storageKey, defaultRatio))

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(ratio))
    } catch {
      // Storage may be unavailable (private mode); the ratio just won't persist.
    }
  }, [storageKey, ratio])

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const container = containerRef.current
    if (!container) return
    e.preventDefault()
    const rect = container.getBoundingClientRect()
    const divider = e.currentTarget
    divider.setPointerCapture(e.pointerId)
    const onMove = (ev: PointerEvent) => setRatio(clamp((ev.clientX - rect.left) / rect.width))
    const onUp = () => {
      divider.removeEventListener('pointermove', onMove)
      divider.removeEventListener('pointerup', onUp)
      divider.removeEventListener('pointercancel', onUp)
    }
    divider.addEventListener('pointermove', onMove)
    divider.addEventListener('pointerup', onUp)
    divider.addEventListener('pointercancel', onUp)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.02
    const next =
      e.key === 'ArrowLeft'
        ? ratio - step
        : e.key === 'ArrowRight'
          ? ratio + step
          : e.key === 'Home'
            ? MIN
            : e.key === 'End'
              ? MAX
              : null
    if (next === null) return
    e.preventDefault()
    setRatio(clamp(next))
  }

  const tabClass = (side: SplitPaneSide) =>
    `flex-1 border-b-2 px-3 py-2 text-sm font-medium ${
      mobileActive === side
        ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
        : 'border-transparent text-zinc-500'
    }`

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" className="flex border-b border-zinc-200 md:hidden dark:border-zinc-800">
        <button
          type="button"
          role="tab"
          aria-selected={mobileActive === 'first'}
          onClick={() => onMobileActiveChange('first')}
          className={tabClass('first')}
        >
          {firstLabel}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobileActive === 'second'}
          onClick={() => onMobileActiveChange('second')}
          className={tabClass('second')}
        >
          {secondLabel}
        </button>
      </div>
      <div
        ref={containerRef}
        className="flex min-h-0 flex-1"
        style={{ '--split': `${ratio * 100}%` } as CSSProperties}
      >
        <div
          className={`min-h-0 min-w-0 flex-1 flex-col md:flex md:shrink-0 md:grow-0 md:basis-(--split) ${mobileActive === 'first' ? 'flex' : 'hidden'}`}
        >
          {first}
        </div>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panels"
          aria-valuemin={MIN * 100}
          aria-valuemax={MAX * 100}
          aria-valuenow={Math.round(ratio * 100)}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onKeyDown={onKeyDown}
          className="hidden w-1.5 shrink-0 cursor-col-resize touch-none bg-zinc-200 hover:bg-indigo-400 focus-visible:bg-indigo-500 focus-visible:outline-none md:block dark:bg-zinc-800"
        />
        <div
          className={`min-h-0 min-w-0 flex-1 flex-col md:flex ${mobileActive === 'second' ? 'flex' : 'hidden'}`}
        >
          {second}
        </div>
      </div>
    </div>
  )
}
