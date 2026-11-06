/*
 * SnipLab Python worker. Runs Pyodide (CPython compiled to WebAssembly) inside the sandbox.
 *
 * Started by frame.js as a *module* worker from a data: URL (Pyodide refuses classic
 * workers, and module workers can't be created from blob: URLs in an opaque-origin frame).
 * The interpreter stays warm between runs; each run gets a fresh globals dict.
 *
 * The sandbox can't fetch Pyodide's files itself, so `fetch` is patched: requests to the
 * Pyodide asset base, the Pyodide CDN and PyPI are relayed to the app (`asset-request`),
 * which decides what to serve. Everything else goes to the real fetch, governed by the CSP.
 *
 * Imported with `?raw`; keep it dependency-free and in sync with src/sandbox/protocol.ts.
 */
'use strict'

const PY_ASSET_BASE = 'https://sniplab.invalid/pyodide/'
const PROXIED_ORIGINS = [
  'https://sniplab.invalid',
  'https://cdn.jsdelivr.net',
  'https://pypi.org',
  'https://files.pythonhosted.org',
]

/** Turn a Python traceback (PythonError.message) into the protocol's error shape. */
function parsePythonTraceback(text) {
  const MAX = 10000
  const lines = String(text).replace(/\s+$/, '').split('\n')

  // The exception text starts at the first unindented line after the last frame
  // (or is just the last line when there are no frames).
  let lastFrame = -1
  for (let i = 0; i < lines.length; i++) if (/^\s+File "/.test(lines[i])) lastFrame = i
  let start = lastFrame + 1
  while (lastFrame !== -1 && start < lines.length && /^\s/.test(lines[start])) start++
  if (lastFrame === -1 || start >= lines.length) start = lines.length - 1
  const exception = lines.slice(start).join('\n')
  const match = /^([A-Za-z_][\w.]*)(?::\s?([\s\S]*))?$/.exec(exception)

  // Report the deepest frame in the user's code; hide Pyodide's own frames above it.
  let firstSnippet = -1
  let line = null
  for (let i = 0; i < start; i++) {
    const frame = /^\s*File "<snippet>", line (\d+)/.exec(lines[i])
    if (frame) {
      if (firstSnippet === -1) firstSnippet = i
      line = Number(frame[1]) || null
    }
  }
  const stack = firstSnippet === -1 ? null : lines.slice(firstSnippet, start).join('\n')

  return {
    name: (match ? match[1] : 'Error').slice(0, 200),
    message: (match ? (match[2] ?? '') : exception).slice(0, MAX),
    stack: stack ? stack.slice(0, MAX) : null,
    line,
    column: null,
  }
}

function describePythonError(error) {
  if (error && typeof error === 'object' && typeof error.message === 'string') {
    // PythonError carries the exception class name in `type` and a traceback as message.
    if (typeof error.type === 'string') return parsePythonTraceback(error.message)
    return {
      name: String(error.name || 'Error').slice(0, 200),
      message: error.message.slice(0, 10000),
      stack: null,
      line: null,
      column: null,
    }
  }
  return {
    name: 'Error',
    message: String(error).slice(0, 10000),
    stack: null,
    line: null,
    column: null,
  }
}

function startPythonWorker() {
  const post = self.postMessage.bind(self)
  const realFetch = self.fetch.bind(self)

  // --- asset relay -----------------------------------------------------------------------
  const pending = new Map()
  let nextRequestId = 0

  function requestAsset(url, accept) {
    return new Promise((resolve, reject) => {
      const requestId = nextRequestId++
      pending.set(requestId, { resolve, reject })
      post({ type: 'asset-request', requestId, url, accept: accept ?? null })
    })
  }

  function onAssetResponse(message) {
    const entry = pending.get(message.requestId)
    if (!entry) return
    pending.delete(message.requestId)
    if (!message.ok) {
      entry.reject(new TypeError(String(message.error)))
      return
    }
    const nullBody = [101, 204, 205, 304].includes(message.status)
    entry.resolve(
      new Response(nullBody ? null : message.body, {
        status: message.status,
        headers: { 'Content-Type': String(message.contentType) },
      }),
    )
  }

  function shouldProxy(url) {
    try {
      return PROXIED_ORIGINS.includes(new URL(url).origin)
    } catch {
      return false
    }
  }

  self.fetch = function fetch(input, init) {
    const request = input instanceof Request ? input : null
    const url = request ? request.url : String(input instanceof URL ? input.href : input)
    const method = String((init && init.method) || (request && request.method) || 'GET')
    if (method.toUpperCase() === 'GET' && shouldProxy(url)) {
      const headers = new Headers((init && init.headers) || (request && request.headers) || {})
      return requestAsset(url, headers.get('accept'))
    }
    return realFetch(input, init)
  }

  // --- run state & output -----------------------------------------------------------------
  let runId = null
  let finished = true
  let lineCount = 0
  let maxLogs = 10000
  let stdinText = ''

  function finish(message) {
    if (finished) return
    finished = true
    post(message)
  }

  function status(text) {
    if (runId !== null && !finished)
      post({ type: 'status', runId, text: String(text).slice(0, 500) })
  }

  function emit(level, text) {
    if (finished || runId === null) return
    lineCount++
    if (lineCount > maxLogs) {
      finish({
        type: 'error',
        runId,
        error: {
          name: 'OutputLimitError',
          message: 'Output limit reached (' + maxLogs + ' lines). The run was stopped.',
          stack: null,
          line: null,
          column: null,
        },
      })
      // Raises inside Python, which ends the program.
      throw new Error('SnipLab output limit reached')
    }
    post({ type: 'log', runId, level, args: [{ t: 'string', v: String(text).slice(0, 10000) }] })
  }

  // --- Pyodide ----------------------------------------------------------------------------
  let pyodidePromise = null
  let pyodideReady = false

  function getPyodide() {
    pyodidePromise ??= (async () => {
      const load = async (name) => {
        const text = await (await requestAsset(PY_ASSET_BASE + name, null)).text()
        return URL.createObjectURL(new Blob([text], { type: 'text/javascript' }))
      }
      const [loaderUrl, asmUrl] = await Promise.all([load('pyodide.mjs'), load('pyodide.asm.mjs')])
      const [loader, asm] = await Promise.all([import(loaderUrl), import(asmUrl)])
      const pyodide = await loader.loadPyodide({
        indexURL: PY_ASSET_BASE,
        createPyodideModule: asm.default,
      })
      pyodide.setStdout({ batched: (line) => emit('log', line) })
      pyodide.setStderr({ batched: (line) => emit('error', line) })
      // Hand Python the whole stdin text once, then EOF.
      pyodide.setStdin({
        stdin: () => {
          const text = stdinText
          stdinText = ''
          return text === '' ? null : text
        },
      })
      pyodideReady = true
      return pyodide
    })()
    pyodidePromise.catch(() => {
      pyodidePromise = null
    })
    return pyodidePromise
  }

  function flushStreams(pyodide) {
    try {
      pyodide.runPython('import sys\nsys.stdout.flush()\nsys.stderr.flush()')
    } catch {
      // Output limit or a closed stream; nothing more to show.
    }
  }

  async function run(message) {
    runId = String(message.runId)
    finished = false
    lineCount = 0
    maxLogs = Number(message.maxLogs) || 10000
    let pyodide = null
    let globals = null
    try {
      if (!pyodideReady) status('Starting Python…')
      pyodide = await getPyodide()

      const packages = Array.isArray(message.packages) ? message.packages.map(String) : []
      if (packages.length > 0) {
        status('Installing ' + packages.join(', ') + '…')
        await pyodide.loadPackage('micropip', { messageCallback: () => {} })
        const micropip = pyodide.pyimport('micropip')
        try {
          await micropip.install(packages)
        } finally {
          micropip.destroy()
        }
      }
      await pyodide.loadPackagesFromImports(message.source, {
        messageCallback: (text) => status(text),
        errorCallback: (text) => status(text),
      })

      stdinText = String(message.stdin ?? '')
      post({ type: 'started', runId })

      globals = pyodide.globals.get('dict')()
      globals.set('__name__', '__main__')
      const result = await pyodide.runPythonAsync(message.source, {
        globals,
        filename: '<snippet>',
      })
      flushStreams(pyodide)
      if (result !== undefined && !finished) {
        const repr = pyodide.globals.get('repr')
        post({
          type: 'result',
          runId,
          value: { t: 'repr', v: String(repr(result)).slice(0, 10000) },
        })
        repr.destroy()
      }
      if (result && typeof result.destroy === 'function') result.destroy()
      finish({ type: 'done', runId })
    } catch (error) {
      if (pyodide) flushStreams(pyodide)
      finish({ type: 'error', runId, error: describePythonError(error) })
    } finally {
      if (globals) globals.destroy()
    }
  }

  self.addEventListener('message', (event) => {
    const message = event.data
    if (!message || typeof message !== 'object') return
    if (message.type === 'asset-response') onAssetResponse(message)
    else if (message.type === 'prewarm') getPyodide().catch(() => {})
    else if (message.type === 'run' && typeof message.source === 'string') void run(message)
  })
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope)
  startPythonWorker()
