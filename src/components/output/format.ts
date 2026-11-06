import type { SerializedValue } from '../../sandbox/protocol'

export type ContainerValue = Extract<SerializedValue, { t: 'array' | 'object' | 'map' | 'set' }>

export function isContainer(value: SerializedValue): value is ContainerValue {
  return value.t === 'array' || value.t === 'object' || value.t === 'map' || value.t === 'set'
}

const DEFAULT_CTOR = { array: 'Array', object: 'Object', map: 'Map', set: 'Set' } as const

export function quoteString(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`
}

export function formatKey(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) || /^\[Symbol\(.*\)\]$/.test(key) ? key : quoteString(key)
}

/** Short label for a container nested inside a preview, e.g. `Array(3)` or `{…}`. */
export function containerLabel(value: ContainerValue): string {
  switch (value.t) {
    case 'array':
      return `${value.ctor ?? 'Array'}(${value.length})`
    case 'object':
      return value.ctor ? `${value.ctor} {…}` : value.size === 0 ? '{}' : '{…}'
    case 'map':
      return `Map(${value.size})`
    case 'set':
      return `Set(${value.size})`
  }
}

/** One-line text for any value; containers get a compact preview. */
export function formatValue(value: SerializedValue, quoteStrings = true): string {
  switch (value.t) {
    case 'undefined':
    case 'null':
      return value.t
    case 'boolean':
      return String(value.v)
    case 'number':
      return value.v
    case 'bigint':
      return `${value.v}n`
    case 'string':
      return (quoteStrings ? quoteString(value.v) : value.v) + (value.truncated ? '…' : '')
    case 'symbol':
      return `Symbol(${value.v})`
    case 'function':
      return value.isClass
        ? `class ${value.name || '(anonymous)'}`
        : `ƒ ${value.name || '(anonymous)'}()`
    case 'date':
    case 'regexp':
    case 'unknown':
      return value.v
    case 'error':
      return value.message ? `${value.name}: ${value.message}` : value.name
    case 'promise':
      return 'Promise {…}'
    case 'circular':
      return '[Circular]'
    case 'getter':
      return '[Getter]'
    case 'depth':
      return `[${value.ctor ?? DEFAULT_CTOR[value.kind]}]`
    default:
      return formatPreview(value)
  }
}

/** Compact preview of a container, e.g. `Array(3) [1, 2, 3]` or `Point {x: 1, y: 2}`. */
export function formatPreview(value: ContainerValue, maxItems = 5): string {
  const nested = (v: SerializedValue) => (isContainer(v) ? containerLabel(v) : formatValue(v))
  const join = (parts: string[], total: number) =>
    (total > maxItems ? [...parts, '…'] : parts).join(', ')

  switch (value.t) {
    case 'array': {
      const parts = value.items.slice(0, maxItems).map(nested)
      return `${value.ctor ?? 'Array'}(${value.length}) [${join(parts, value.length)}]`
    }
    case 'object': {
      const parts = value.entries
        .slice(0, maxItems)
        .map(([key, v]) => `${formatKey(key)}: ${nested(v)}`)
      return `${value.ctor ? `${value.ctor} ` : ''}{${join(parts, value.size)}}`
    }
    case 'map': {
      const parts = value.entries.slice(0, maxItems).map(([k, v]) => `${nested(k)} => ${nested(v)}`)
      return `Map(${value.size}) {${join(parts, value.size)}}`
    }
    case 'set': {
      const parts = value.items.slice(0, maxItems).map(nested)
      return `Set(${value.size}) {${join(parts, value.size)}}`
    }
  }
}

/** Tailwind classes for coloring a non-container value. */
export function valueClass(value: SerializedValue): string {
  switch (value.t) {
    case 'string':
      return 'text-emerald-700 dark:text-emerald-400'
    case 'number':
    case 'bigint':
      return 'text-blue-700 dark:text-sky-400'
    case 'boolean':
    case 'symbol':
      return 'text-purple-700 dark:text-purple-400'
    case 'undefined':
    case 'null':
    case 'circular':
    case 'getter':
    case 'depth':
    case 'unknown':
      return 'text-zinc-500'
    case 'function':
      return 'italic text-amber-700 dark:text-amber-400'
    case 'error':
      return 'text-red-700 dark:text-red-400'
    default:
      return ''
  }
}
