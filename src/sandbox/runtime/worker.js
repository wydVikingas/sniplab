/*
 * SnipLab sandbox worker — runs ONE user snippet, then reports `done` or `error`.
 *
 * This file is imported with `?raw` and executed verbatim from a blob: URL inside the
 * opaque-origin sandbox iframe, so it (and the user code it imports) has no access to the
 * app's origin, storage, cookies or DOM, and inherits the iframe's Content-Security-Policy.
 *
 * Keep it dependency-free, and keep message shapes in sync with src/sandbox/protocol.ts.
 */
'use strict'

/** Convert any JS value into plain, bounded data that can cross postMessage. */
function serializeValue(root) {
  const MAX_DEPTH = 6
  const MAX_ITEMS = 100
  const MAX_STRING = 10000
  let budget = 2000

  function ctorName(value) {
    try {
      const proto = Object.getPrototypeOf(value)
      if (proto === null) return null
      const ctor = proto.constructor
      return typeof ctor === 'function' && typeof ctor.name === 'string' && ctor.name
        ? ctor.name.slice(0, 200)
        : null
    } catch {
      return null
    }
  }

  function str(s) {
    return s.length > MAX_STRING
      ? { t: 'string', v: s.slice(0, MAX_STRING), truncated: true }
      : { t: 'string', v: s }
  }

  function kindOf(value) {
    if (Array.isArray(value) || (ArrayBuffer.isView(value) && !(value instanceof DataView))) {
      return 'array'
    }
    if (value instanceof Map) return 'map'
    if (value instanceof Set) return 'set'
    return 'object'
  }

  function walk(value, depth, ancestors) {
    budget--
    switch (typeof value) {
      case 'undefined':
        return { t: 'undefined' }
      case 'boolean':
        return { t: 'boolean', v: value }
      case 'number':
        return { t: 'number', v: Object.is(value, -0) ? '-0' : String(value) }
      case 'bigint':
        return { t: 'bigint', v: String(value).slice(0, MAX_STRING) }
      case 'string':
        return str(value)
      case 'symbol':
        return { t: 'symbol', v: String(value.description ?? '').slice(0, MAX_STRING) }
      case 'function': {
        let name = ''
        let isClass = false
        try {
          name = typeof value.name === 'string' ? value.name.slice(0, 200) : ''
          isClass = /^class[\s{]/.test(Function.prototype.toString.call(value))
        } catch {
          // Proxies and exotic functions may throw; keep the defaults.
        }
        return { t: 'function', name, isClass }
      }
    }
    if (value === null) return { t: 'null' }

    try {
      if (ancestors.includes(value)) return { t: 'circular' }
      if (value instanceof Date) {
        return {
          t: 'date',
          v: Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString(),
        }
      }
      if (value instanceof RegExp) return { t: 'regexp', v: String(value).slice(0, MAX_STRING) }
      if (value instanceof Error) {
        return {
          t: 'error',
          name: String(value.name).slice(0, 200),
          message: String(value.message).slice(0, MAX_STRING),
          stack: typeof value.stack === 'string' ? value.stack.slice(0, MAX_STRING) : null,
        }
      }
      if (value instanceof Promise) return { t: 'promise' }

      const kind = kindOf(value)
      if (depth >= MAX_DEPTH || budget <= 0) return { t: 'depth', kind, ctor: ctorName(value) }
      const next = ancestors.concat([value])

      if (kind === 'array') {
        const length = value.length
        const items = []
        for (let i = 0; i < Math.min(length, MAX_ITEMS); i++) {
          items.push(walk(value[i], depth + 1, next))
        }
        return { t: 'array', ctor: Array.isArray(value) ? null : ctorName(value), length, items }
      }
      if (kind === 'map') {
        const entries = []
        for (const [k, v] of value) {
          if (entries.length >= MAX_ITEMS) break
          entries.push([walk(k, depth + 1, next), walk(v, depth + 1, next)])
        }
        return { t: 'map', size: value.size, entries }
      }
      if (kind === 'set') {
        const items = []
        for (const v of value) {
          if (items.length >= MAX_ITEMS) break
          items.push(walk(v, depth + 1, next))
        }
        return { t: 'set', size: value.size, items }
      }

      // Plain or class object: own enumerable keys. Getters are NOT invoked.
      const entries = []
      let size = 0
      for (const key of Reflect.ownKeys(value)) {
        const desc = Object.getOwnPropertyDescriptor(value, key)
        if (!desc || !desc.enumerable) continue
        size++
        if (entries.length >= MAX_ITEMS) continue
        const name = (typeof key === 'symbol' ? '[' + String(key) + ']' : key).slice(0, 1000)
        entries.push([name, 'value' in desc ? walk(desc.value, depth + 1, next) : { t: 'getter' }])
      }
      const ctor = ctorName(value)
      return { t: 'object', ctor: ctor === 'Object' ? null : ctor, size, entries }
    } catch {
      return { t: 'unknown', v: '[Unserializable value]' }
    }
  }

  return walk(root, 0, [])
}

/** Describe a thrown value, locating it in the snippet module when possible. */
function describeError(error, moduleUrl) {
  const MAX = 10000
  try {
    if (error !== null && typeof error === 'object' && 'message' in error) {
      let stack = null
      let line = null
      let column = null
      if (typeof error.stack === 'string' && moduleUrl) {
        const at = error.stack.indexOf(moduleUrl + ':')
        if (at !== -1) {
          const match = /^:(\d+):(\d+)/.exec(error.stack.slice(at + moduleUrl.length))
          if (match) {
            line = Number(match[1]) || null
            column = Number(match[2]) || null
          }
        }
        // Keep only frames from the snippet itself, with the blob URL made readable.
        const frames = error.stack
          .split(moduleUrl)
          .join('snippet.js')
          .split('\n')
          .filter((frame) => frame.includes('snippet.js'))
        stack = frames.length ? frames.join('\n').slice(0, MAX) : null
      }
      return {
        name: String(error.name || 'Error').slice(0, 200),
        message: String(error.message).slice(0, MAX),
        stack,
        line,
        column,
      }
    }
  } catch {
    // Fall through to the generic description.
  }
  let message
  try {
    message = typeof error === 'string' ? error : (JSON.stringify(error) ?? String(error))
  } catch {
    message = '[unknown value]'
  }
  return { name: 'Uncaught', message: message.slice(0, MAX), stack: null, line: null, column: null }
}

function startWorker() {
  // Capture originals before any user code runs.
  const post = self.postMessage.bind(self)
  const realSetTimeout = self.setTimeout.bind(self)
  const realClearTimeout = self.clearTimeout.bind(self)
  const realSetInterval = self.setInterval.bind(self)
  const realClearInterval = self.clearInterval.bind(self)
  const realFetch = typeof self.fetch === 'function' ? self.fetch.bind(self) : null
  const now = () => self.performance.now()

  const activeTimers = new Set()
  let inflight = 0
  let runId = null
  let moduleUrl = null
  let maxLogs = 10000
  let logCount = 0
  let mainDone = false
  let finished = false

  function finish(message) {
    if (finished) return
    finished = true
    post(message)
  }

  function fail(error) {
    finish({ type: 'error', runId, error: describeError(error, moduleUrl) })
  }

  // The run is done once the module has evaluated and no timers or fetches are pending
  // (like Node.js exiting when its event loop is empty).
  function checkIdle() {
    if (finished || !mainDone) return
    realSetTimeout(() => {
      if (!finished && activeTimers.size === 0 && inflight === 0) finish({ type: 'done', runId })
    }, 0)
  }

  // --- console -------------------------------------------------------------------------
  function emit(level, args) {
    if (finished || runId === null) return
    logCount++
    if (logCount > maxLogs) {
      finish({
        type: 'error',
        runId,
        error: {
          name: 'OutputLimitError',
          message: 'Output limit reached (' + maxLogs + ' console calls). The run was stopped.',
          stack: null,
          line: null,
          column: null,
        },
      })
      return
    }
    const items = []
    for (let i = 0; i < Math.min(args.length, 100); i++) items.push(serializeValue(args[i]))
    post({ type: 'log', runId, level, args: items })
  }

  const counts = new Map()
  const timers = new Map()
  const label = (value) => (value === undefined ? 'default' : String(value))
  Object.assign(self.console, {
    log: (...args) => emit('log', args),
    info: (...args) => emit('info', args),
    warn: (...args) => emit('warn', args),
    error: (...args) => emit('error', args),
    debug: (...args) => emit('debug', args),
    trace: (...args) => emit('debug', args),
    dir: (value) => emit('log', [value]),
    table: (value) => emit('log', [value]),
    group: (...args) => emit('log', args),
    groupCollapsed: (...args) => emit('log', args),
    groupEnd: () => {},
    assert: (condition, ...args) => {
      if (!condition) emit('error', ['Assertion failed:', ...args])
    },
    count: (name) => {
      const key = label(name)
      const n = (counts.get(key) ?? 0) + 1
      counts.set(key, n)
      emit('log', [key + ': ' + n])
    },
    countReset: (name) => counts.delete(label(name)),
    time: (name) => timers.set(label(name), now()),
    timeLog: (name, ...args) => {
      const start = timers.get(label(name))
      if (start !== undefined)
        emit('log', [label(name) + ': ' + (now() - start).toFixed(2) + ' ms', ...args])
    },
    timeEnd: (name) => {
      const start = timers.get(label(name))
      if (start === undefined) return
      timers.delete(label(name))
      emit('log', [label(name) + ': ' + (now() - start).toFixed(2) + ' ms'])
    },
  })

  // --- timers & fetch: tracked so we know when the snippet is idle ------------------------
  self.setTimeout = function setTimeout(callback, delay, ...args) {
    const id = realSetTimeout(() => {
      activeTimers.delete(id)
      try {
        if (typeof callback === 'function') callback(...args)
      } finally {
        checkIdle()
      }
    }, delay)
    activeTimers.add(id)
    return id
  }
  self.setInterval = function setInterval(callback, delay, ...args) {
    const id = realSetInterval(() => {
      if (typeof callback === 'function') callback(...args)
    }, delay)
    activeTimers.add(id)
    return id
  }
  self.clearTimeout = function clearTimeout(id) {
    activeTimers.delete(id)
    realClearTimeout(id)
    checkIdle()
  }
  self.clearInterval = function clearInterval(id) {
    activeTimers.delete(id)
    realClearInterval(id)
    checkIdle()
  }
  if (realFetch) {
    self.fetch = function fetch(...args) {
      inflight++
      let request
      try {
        request = realFetch(...args)
      } catch (error) {
        inflight--
        throw error
      }
      return request.finally(() => {
        inflight--
        checkIdle()
      })
    }
  }

  // --- uncaught errors end the run -------------------------------------------------------
  self.addEventListener('error', (event) => {
    event.preventDefault()
    fail(event.error ?? new Error(event.message))
  })
  self.addEventListener('unhandledrejection', (event) => {
    event.preventDefault()
    fail(event.reason)
  })

  // --- run --------------------------------------------------------------------------------
  self.addEventListener('message', async (event) => {
    const message = event.data
    if (
      runId !== null ||
      !message ||
      message.type !== 'run' ||
      typeof message.source !== 'string'
    ) {
      return
    }
    runId = String(message.runId)
    maxLogs = Number(message.maxLogs) || maxLogs
    moduleUrl = URL.createObjectURL(new Blob([message.source], { type: 'text/javascript' }))
    try {
      const module = await import(moduleUrl)
      if (message.hasResult && !finished) {
        const value = module[message.resultExport]
        if (value !== undefined) post({ type: 'result', runId, value: serializeValue(value) })
      }
      mainDone = true
      checkIdle()
    } catch (error) {
      fail(error)
    }
  })
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) startWorker()
