import { describe, expect, it } from 'vitest'
import type { RunError, SerializedValue } from '../protocol'
import { serializedValueSchema } from '../protocol'
import workerSource from './worker.js?raw'

// Evaluate the exact source the sandbox runs and pull out its helpers. The auto-start
// guard is false here because jsdom has no WorkerGlobalScope.
const { serializeValue, describeError } = new Function(
  `${workerSource}\nreturn { serializeValue, describeError }`,
)() as {
  serializeValue(value: unknown): SerializedValue
  describeError(error: unknown, moduleUrl: string | null): RunError
}

function roundTrip(value: unknown): SerializedValue {
  // Output must survive structured cloning and satisfy the host's schema.
  return serializedValueSchema.parse(structuredClone(serializeValue(value)))
}

describe('worker serializeValue', () => {
  it('handles primitives, including ones JSON loses', () => {
    expect(roundTrip(undefined)).toEqual({ t: 'undefined' })
    expect(roundTrip(null)).toEqual({ t: 'null' })
    expect(roundTrip(true)).toEqual({ t: 'boolean', v: true })
    expect(roundTrip(NaN)).toEqual({ t: 'number', v: 'NaN' })
    expect(roundTrip(-0)).toEqual({ t: 'number', v: '-0' })
    expect(roundTrip(10n)).toEqual({ t: 'bigint', v: '10' })
    expect(roundTrip(Symbol('id'))).toEqual({ t: 'symbol', v: 'id' })
    expect(roundTrip('hi')).toEqual({ t: 'string', v: 'hi' })
  })

  it('describes functions and classes', () => {
    expect(roundTrip(function greet() {})).toEqual({ t: 'function', name: 'greet', isClass: false })
    expect(roundTrip(class Point {})).toEqual({ t: 'function', name: 'Point', isClass: true })
  })

  it('serializes nested containers with constructor names', () => {
    class Point {
      x = 1
    }
    const value = roundTrip({
      list: [1, 'a'],
      map: new Map([['k', 1]]),
      set: new Set([2]),
      p: new Point(),
    })
    expect(value).toEqual({
      t: 'object',
      ctor: null,
      size: 4,
      entries: [
        [
          'list',
          {
            t: 'array',
            ctor: null,
            length: 2,
            items: [
              { t: 'number', v: '1' },
              { t: 'string', v: 'a' },
            ],
          },
        ],
        [
          'map',
          {
            t: 'map',
            size: 1,
            entries: [
              [
                { t: 'string', v: 'k' },
                { t: 'number', v: '1' },
              ],
            ],
          },
        ],
        ['set', { t: 'set', size: 1, items: [{ t: 'number', v: '2' }] }],
        ['p', { t: 'object', ctor: 'Point', size: 1, entries: [['x', { t: 'number', v: '1' }]] }],
      ],
    })
  })

  it('serializes dates, regexps, errors, typed arrays and promises', () => {
    expect(roundTrip(new Date(0))).toEqual({ t: 'date', v: '1970-01-01T00:00:00.000Z' })
    expect(roundTrip(/a+/g)).toEqual({ t: 'regexp', v: '/a+/g' })
    expect(roundTrip(new TypeError('bad'))).toMatchObject({
      t: 'error',
      name: 'TypeError',
      message: 'bad',
    })
    expect(roundTrip(new Uint8Array([1, 2]))).toMatchObject({
      t: 'array',
      ctor: 'Uint8Array',
      length: 2,
    })
    expect(roundTrip(Promise.resolve(1))).toEqual({ t: 'promise' })
  })

  it('marks circular references and does not invoke getters', () => {
    let called = false
    const obj: Record<string, unknown> = {
      get secret() {
        called = true
        return 1
      },
    }
    obj.self = obj
    expect(roundTrip(obj)).toEqual({
      t: 'object',
      ctor: null,
      size: 2,
      entries: [
        ['secret', { t: 'getter' }],
        ['self', { t: 'circular' }],
      ],
    })
    expect(called).toBe(false)
  })

  it('bounds depth, item count and string length', () => {
    let deep: unknown = 'bottom'
    for (let i = 0; i < 10; i++) deep = [deep]
    let node = roundTrip(deep)
    let depth = 0
    while (node.t === 'array') {
      node = node.items[0]!
      depth++
    }
    expect(depth).toBe(6)
    expect(node).toEqual({ t: 'depth', kind: 'array', ctor: 'Array' })

    const big = roundTrip(Array.from({ length: 500 }, (_, i) => i))
    expect(big).toMatchObject({ t: 'array', length: 500 })
    expect(big.t === 'array' && big.items).toHaveLength(100)

    expect(roundTrip('x'.repeat(20_000))).toMatchObject({ t: 'string', truncated: true })
  })

  it('survives hostile proxies', () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('nope')
        },
      },
    )
    expect(roundTrip(hostile)).toEqual({ t: 'unknown', v: '[Unserializable value]' })
  })
})

describe('worker describeError', () => {
  const url = 'blob:null/1234'

  it('extracts the snippet position and keeps only snippet frames', () => {
    const error = new TypeError('x is not a function')
    error.stack = `TypeError: x is not a function\n    at f (${url}:3:7)\n    at ${url}:5:1\n    at internal (blob:null/other:1:1)`
    expect(describeError(error, url)).toEqual({
      name: 'TypeError',
      message: 'x is not a function',
      stack: '    at f (snippet.js:3:7)\n    at snippet.js:5:1',
      line: 3,
      column: 7,
    })
  })

  it('handles thrown non-errors', () => {
    expect(describeError('oops', url)).toMatchObject({ name: 'Uncaught', message: 'oops' })
    expect(describeError({ code: 1 }, url)).toMatchObject({
      name: 'Uncaught',
      message: '{"code":1}',
    })
  })
})
