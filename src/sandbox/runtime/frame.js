/*
 * SnipLab sandbox frame — runs inside <iframe sandbox="allow-scripts"> (opaque origin).
 *
 * Relays run requests from the app to Web Workers and forwards their messages back:
 * - JavaScript/TypeScript: a fresh classic worker per run (from a blob: URL).
 * - Python: one long-lived module worker (from a data: URL) that keeps Pyodide loaded.
 * User code never runs here, so this thread stays responsive even if a snippet loops
 * forever; the app enforces timeouts by removing the whole iframe.
 *
 * Imported with `?raw` and inlined into the iframe's srcdoc after the WORKER_SOURCE and
 * PYTHON_WORKER_SOURCE strings.
 */
/* global WORKER_SOURCE, PYTHON_WORKER_SOURCE */
;(function startFrame(workerSource, pythonWorkerSource) {
  'use strict'
  const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }))
  let jsWorker = null
  let python = null
  let pythonRunId = null

  function send(message) {
    window.parent.postMessage(message, '*')
  }

  function crashed(runId, message) {
    send({
      type: 'error',
      runId,
      error: { name: 'Error', message, stack: null, line: null, column: null },
    })
  }

  function stopJsWorker() {
    if (jsWorker) jsWorker.terminate()
    jsWorker = null
  }

  function runJavaScript(message) {
    stopJsWorker()
    const runId = String(message.runId)
    const current = new Worker(workerUrl, { name: 'sniplab-run' })
    jsWorker = current

    current.addEventListener('message', (e) => {
      if (jsWorker !== current) return
      const data = e.data
      if (!data || typeof data !== 'object') return
      // Pin the run id so a snippet can't impersonate a different run.
      send({ ...data, runId })
      if (data.type === 'done' || data.type === 'error') stopJsWorker()
    })
    current.addEventListener('error', (e) => {
      e.preventDefault()
      if (jsWorker !== current) return
      crashed(runId, e.message || 'The sandbox worker crashed.')
      stopJsWorker()
    })
    current.postMessage(message)
  }

  function getPython() {
    if (python) return python
    const current = new Worker(
      'data:text/javascript;charset=utf-8,' + encodeURIComponent(pythonWorkerSource),
      { type: 'module', name: 'sniplab-python' },
    )
    python = current

    current.addEventListener('message', (e) => {
      if (python !== current) return
      const data = e.data
      if (!data || typeof data !== 'object') return
      if (data.type === 'asset-request') {
        send({
          type: 'asset-request',
          requestId: data.requestId,
          url: data.url,
          accept: data.accept ?? null,
        })
        return
      }
      if (pythonRunId === null) return
      send({ ...data, runId: pythonRunId })
      if (data.type === 'done' || data.type === 'error') pythonRunId = null
    })
    current.addEventListener('error', (e) => {
      e.preventDefault()
      if (python !== current) return
      python = null
      current.terminate()
      if (pythonRunId !== null) {
        crashed(pythonRunId, e.message || 'The Python runtime crashed.')
        pythonRunId = null
      }
    })
    return current
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return
    const message = event.data
    if (!message || typeof message !== 'object') return

    if (message.type === 'run' && message.runtime === 'python') {
      pythonRunId = String(message.runId)
      getPython().postMessage(message)
    } else if (message.type === 'run') {
      runJavaScript(message)
    } else if (message.type === 'prewarm' && message.runtime === 'python') {
      getPython().postMessage({ type: 'prewarm' })
    } else if (message.type === 'asset-response' && python) {
      python.postMessage(message, message.body instanceof ArrayBuffer ? [message.body] : [])
    }
  })

  send({ type: 'ready' })
})(WORKER_SOURCE, PYTHON_WORKER_SOURCE)
