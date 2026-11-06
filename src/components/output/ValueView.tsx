import { useState, type ReactNode } from 'react'
import type { SerializedValue } from '../../sandbox/protocol'
import {
  formatKey,
  formatPreview,
  formatValue,
  isContainer,
  valueClass,
  type ContainerValue,
} from './format'

/**
 * Renders a serialized value like a browser console: primitives inline and colored,
 * objects/arrays/maps/sets as a collapsed preview that expands into a tree.
 * Top-level strings (direct console.log arguments) are shown raw, without quotes.
 */
export function ValueView({
  value,
  topLevel = false,
}: {
  value: SerializedValue
  topLevel?: boolean
}) {
  if (topLevel && value.t === 'string') {
    return (
      <span>
        {value.v}
        {value.truncated && '…'}
      </span>
    )
  }
  if (isContainer(value)) return <ContainerView value={value} />
  return <span className={valueClass(value)}>{formatValue(value)}</span>
}

interface Row {
  key: string
  label: ReactNode
  value: SerializedValue
}

function childRows(value: ContainerValue): { rows: Row[]; hidden: number } {
  switch (value.t) {
    case 'array':
      return {
        rows: value.items.map((item, i) => ({ key: String(i), label: String(i), value: item })),
        hidden: value.length - value.items.length,
      }
    case 'object':
      return {
        rows: value.entries.map(([k, v]) => ({ key: k, label: formatKey(k), value: v })),
        hidden: value.size - value.entries.length,
      }
    case 'map':
      return {
        rows: value.entries.map(([k, v], i) => ({
          key: String(i),
          label: (
            <>
              <ValueView value={k} /> {'=>'}
            </>
          ),
          value: v,
        })),
        hidden: value.size - value.entries.length,
      }
    case 'set':
      return {
        rows: value.items.map((item, i) => ({ key: String(i), label: null, value: item })),
        hidden: value.size - value.items.length,
      }
  }
}

function ContainerView({ value }: { value: ContainerValue }) {
  const [open, setOpen] = useState(false)
  const { rows, hidden } = childRows(value)
  const expandable = rows.length > 0

  return (
    <span>
      <button
        type="button"
        aria-expanded={expandable ? open : undefined}
        disabled={!expandable}
        onClick={() => setOpen((o) => !o)}
        className="rounded text-left enabled:hover:bg-zinc-200/60 dark:enabled:hover:bg-zinc-700/50"
      >
        {expandable && (
          <span aria-hidden="true" className="inline-block w-3 text-zinc-400">
            {open ? '▾' : '▸'}
          </span>
        )}
        {formatPreview(value)}
      </button>
      {open && (
        <span className="ml-1 block border-l border-zinc-200 pl-4 dark:border-zinc-700">
          {rows.map((row) => (
            <span key={row.key} className="block">
              {row.label !== null && (
                <span className="text-violet-700 dark:text-violet-300">{row.label}: </span>
              )}
              <ValueView value={row.value} />
            </span>
          ))}
          {hidden > 0 && <span className="block text-zinc-500">… {hidden} more</span>}
        </span>
      )}
    </span>
  )
}
