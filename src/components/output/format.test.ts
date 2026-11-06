import { describe, expect, it } from 'vitest'
import type { SerializedValue } from '../../sandbox/protocol'
import { formatKey, formatValue } from './format'

const num = (v: number): SerializedValue => ({ t: 'number', v: String(v) })
const str = (v: string): SerializedValue => ({ t: 'string', v })

describe('formatValue', () => {
  it('formats primitives like a console', () => {
    expect(formatValue(str("it's"))).toBe("'it\\'s'")
    expect(formatValue(str('raw'), false)).toBe('raw')
    expect(formatValue({ t: 'bigint', v: '9' })).toBe('9n')
    expect(formatValue({ t: 'function', name: 'f', isClass: false })).toBe('ƒ f()')
    expect(formatValue({ t: 'function', name: '', isClass: true })).toBe('class (anonymous)')
    expect(formatValue({ t: 'depth', kind: 'object', ctor: null })).toBe('[Object]')
  })

  it('previews arrays, objects, maps and sets', () => {
    expect(formatValue({ t: 'array', ctor: null, length: 2, items: [num(1), str('a')] })).toBe(
      "Array(2) [1, 'a']",
    )
    expect(
      formatValue({
        t: 'object',
        ctor: 'Point',
        size: 2,
        entries: [
          ['x', num(1)],
          ['nested', { t: 'object', ctor: null, size: 1, entries: [['a', num(1)]] }],
        ],
      }),
    ).toBe('Point {x: 1, nested: {…}}')
    expect(formatValue({ t: 'map', size: 1, entries: [[str('k'), num(1)]] })).toBe(
      "Map(1) {'k' => 1}",
    )
    expect(formatValue({ t: 'set', size: 3, items: [num(1), num(2), num(3)] })).toBe(
      'Set(3) {1, 2, 3}',
    )
  })

  it('elides long containers', () => {
    const items = Array.from({ length: 8 }, (_, i) => num(i))
    expect(formatValue({ t: 'array', ctor: null, length: 8, items })).toBe(
      'Array(8) [0, 1, 2, 3, 4, …]',
    )
  })
})

describe('formatKey', () => {
  it('quotes keys that are not identifiers', () => {
    expect(formatKey('plain')).toBe('plain')
    expect(formatKey('with space')).toBe("'with space'")
    expect(formatKey('[Symbol(id)]')).toBe('[Symbol(id)]')
  })
})
