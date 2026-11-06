/*
 * SnipLab sandbox frame — runs inside <iframe sandbox="allow-scripts"> (opaque origin).
 *
 * Relays each run request from the app to a fresh Web Worker and forwards the worker's
 * messages back. User code never runs here, so this thread stays responsive even if the
 * snippet loops forever; the app enforces timeouts by removing the whole iframe.
 *
 * Imported with `?raw` and inlined into the iframe's srcdoc after a `WORKER_SOURCE` string.
 */
/* global WORKER_SOURCE */
;(function startFrame(workerSource) {
  'use strict'
  const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }))
  let worker = null

  function send(message) {
    window.parent.postMessage(message, '*')
  }

  function stopWorker() {
    if (worker) worker.terminate()
    worker = null
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return
    const message = event.data
    if (!message || message.type !== 'run') return

    stopWorker()
    const runId = String(message.runId)
    const current = new Worker(workerUrl, { name: 'sniplab-run' })
    worker = current

    current.addEventListener('message', (e) => {
      if (worker !== current) return
      const data = e.data
      if (!data || typeof data !== 'object') return
      // Pin the run id so a snippet can't impersonate a different run.
      send({ ...data, runId })
      if (data.type === 'done' || data.type === 'error') stopWorker()
    })

    current.addEventListener('error', (e) => {
      e.preventDefault()
      if (worker !== current) return
      send({
        type: 'error',
        runId,
        error: {
          name: 'Error',
          message: e.message || 'The sandbox worker crashed.',
          stack: null,
          line: null,
          column: null,
        },
      })
      stopWorker()
    })

    current.postMessage(message)
  })

  send({ type: 'ready' })
})(WORKER_SOURCE)
