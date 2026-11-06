import type { Language } from '../db/schema'
import {
  MAX_LOG_CALLS,
  RESULT_EXPORT,
  sandboxMessageSchema,
  type HostMessage,
  type LogLevel,
  type RunError,
  type SandboxMessage,
  type SerializedValue,
} from './protocol'
import { PythonAssets } from './pythonAssets'
import { RUNTIMES, type PreparedRun } from './runtimes'
import { buildSrcdoc } from './srcdoc'

export interface RunRequest {
  language: Language
  code: string
  timeoutMs: number
  allowNetwork: boolean
  stdin: string
}

export interface RunCallbacks {
  onLog(level: LogLevel, args: SerializedValue[]): void
  onResult(value: SerializedValue): void
  onError(error: RunError): void
  /** Progress before user code starts (loading Python, installing packages); null once it runs. */
  onStatus?(text: string | null): void
}

export type RunStatus = 'completed' | 'failed' | 'stopped' | 'timed-out'

export interface RunOutcome {
  status: RunStatus
  durationMs: number
}

export interface RunHandle {
  readonly outcome: Promise<RunOutcome>
  stop(): void
}

export interface SandboxHostOptions {
  container?: HTMLElement
  maxLogs?: number
  bootTimeoutMs?: number
  /** How long a run may take to start (load its runtime, install packages). */
  prepareTimeoutMs?: Partial<Record<'javascript' | 'python', number>>
  assets?: PythonAssets
}

interface Frame {
  iframe: HTMLIFrameElement
  allowNetwork: boolean
  ready: Promise<void>
  /** Set once booting failed or the frame was destroyed; a failed frame is never reused. */
  failed: boolean
  markReady(): void
  fail(error: Error): void
}

interface ActiveRun {
  id: string
  request: RunRequest
  callbacks: RunCallbacks
  prepared: PreparedRun | null
  startedAt: number | null
  logCount: number
  timer: ReturnType<typeof setTimeout> | undefined
  settled: boolean
  resolve(outcome: RunOutcome): void
}

const runError = (name: string, message: string): RunError => ({
  name,
  message,
  stack: null,
  line: null,
  column: null,
})

/** "12 ms", "1 s", "1.5 s", "12 s". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  const seconds = ms / 1000
  return `${seconds < 10 ? Number(seconds.toFixed(1)) : Math.round(seconds)} s`
}

const formatMb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)

/**
 * Runs untrusted snippets in a sandboxed, opaque-origin iframe that hosts Web Workers.
 * Only one run is active at a time. Timeouts and Stop remove the whole iframe, which
 * terminates its workers even if they are stuck in an infinite loop.
 */
export class SandboxHost {
  readonly #container: HTMLElement
  readonly #maxLogs: number
  readonly #bootTimeoutMs: number
  readonly #prepareTimeoutMs: Record<'javascript' | 'python', number>
  readonly #assets: PythonAssets
  #frame: Frame | null = null
  #active: ActiveRun | null = null

  constructor(options: SandboxHostOptions = {}) {
    this.#container = options.container ?? document.body
    this.#maxLogs = options.maxLogs ?? MAX_LOG_CALLS
    this.#bootTimeoutMs = options.bootTimeoutMs ?? 10_000
    this.#prepareTimeoutMs = {
      javascript: 15_000,
      // First Python run downloads ~13 MB and may install packages.
      python: 300_000,
      ...options.prepareTimeoutMs,
    }
    this.#assets = options.assets ?? new PythonAssets()
    this.#assets.onProgress = (loaded, total) => {
      const run = this.#active
      if (run && run.startedAt === null && run.prepared?.runtime === 'python') {
        run.callbacks.onStatus?.(`Downloading Python… ${formatMb(loaded)} / ${formatMb(total)} MB`)
      }
    }
    window.addEventListener('message', this.#onMessage)
  }

  run(request: RunRequest, callbacks: RunCallbacks): RunHandle {
    if (this.#active) this.#finish(this.#active, 'stopped', true)

    let resolve!: (outcome: RunOutcome) => void
    const outcome = new Promise<RunOutcome>((r) => (resolve = r))
    const run: ActiveRun = {
      id: crypto.randomUUID(),
      request,
      callbacks,
      prepared: null,
      startedAt: null,
      logCount: 0,
      timer: undefined,
      settled: false,
      resolve,
    }
    this.#active = run
    void this.#start(run)
    return { outcome, stop: () => this.#finish(run, 'stopped', true) }
  }

  /** Boot a sandbox (and, for Python, the interpreter) ahead of time so runs start faster. */
  prewarm(language: Language, allowNetwork: boolean): void {
    if (this.#active) return
    this.#getFrame(allowNetwork)
      .then((frame) => {
        if (language === 'python' && this.#frame === frame && !this.#active) {
          this.#post(frame, { type: 'prewarm', runtime: 'python' })
        }
      })
      .catch(() => {})
  }

  dispose(): void {
    if (this.#active) this.#finish(this.#active, 'stopped', true)
    this.#destroyFrame()
    window.removeEventListener('message', this.#onMessage)
  }

  async #start(run: ActiveRun): Promise<void> {
    const { request } = run
    try {
      const prepared = await RUNTIMES[request.language].prepare(request.code)
      if (this.#active !== run) return
      if (!prepared.ok) {
        run.callbacks.onError(prepared.error)
        this.#finish(run, 'failed', false)
        return
      }
      run.prepared = prepared.run
    } catch (error) {
      if (this.#active !== run) return
      console.error('Preparing the snippet failed', error)
      run.callbacks.onError(runError('SandboxError', 'The snippet could not be prepared to run.'))
      this.#finish(run, 'failed', false)
      return
    }

    let frame: Frame
    try {
      frame = await this.#getFrame(request.allowNetwork)
    } catch {
      if (this.#active !== run) return
      run.callbacks.onError(runError('SandboxError', 'The code sandbox failed to start.'))
      this.#finish(run, 'failed', true)
      return
    }
    if (this.#active !== run) return

    const { runtime, source, hasResult, packages } = run.prepared
    const prepareTimeoutMs = this.#prepareTimeoutMs[runtime]
    run.timer = setTimeout(() => {
      if (this.#active !== run) return
      const what = runtime === 'python' ? 'Python' : 'The sandbox'
      run.callbacks.onError(
        runError(
          'TimeoutError',
          `${what} took longer than ${formatDuration(prepareTimeoutMs)} to start. The run was stopped.`,
        ),
      )
      this.#finish(run, 'timed-out', true)
    }, prepareTimeoutMs)

    this.#post(frame, {
      type: 'run',
      runId: run.id,
      runtime,
      source,
      hasResult,
      resultExport: RESULT_EXPORT,
      maxLogs: this.#maxLogs,
      stdin: request.stdin,
      packages,
    })
  }

  /** User code is running: switch from the prepare timeout to the snippet's own timeout. */
  #markStarted(run: ActiveRun): void {
    if (run.startedAt !== null) return
    clearTimeout(run.timer)
    run.startedAt = performance.now()
    run.callbacks.onStatus?.(null)
    const { timeoutMs } = run.request
    run.timer = setTimeout(() => {
      if (this.#active !== run) return
      run.callbacks.onError(
        runError(
          'TimeoutError',
          `Execution timed out after ${formatDuration(timeoutMs)}. The run was stopped.`,
        ),
      )
      this.#finish(run, 'timed-out', true)
    }, timeoutMs)
  }

  #post(frame: Frame, message: HostMessage, transfer: Transferable[] = []): void {
    // The iframe has an opaque origin, so '*' is the only usable target origin.
    frame.iframe.contentWindow?.postMessage(message, '*', transfer)
  }

  #getFrame(allowNetwork: boolean): Promise<Frame> {
    const existing = this.#frame
    if (existing && !existing.failed && existing.allowNetwork === allowNetwork) {
      return existing.ready.then(() => existing)
    }
    this.#destroyFrame()

    const iframe = document.createElement('iframe')
    iframe.setAttribute('sandbox', 'allow-scripts')
    iframe.setAttribute('aria-hidden', 'true')
    iframe.tabIndex = -1
    iframe.title = 'Code sandbox'
    iframe.style.display = 'none'
    iframe.srcdoc = buildSrcdoc({ allowNetwork })

    let markReady!: () => void
    let reject!: (error: Error) => void
    const ready = new Promise<void>((res, rej) => {
      markReady = res
      reject = rej
    })
    ready.catch(() => {}) // Callers handle failures; avoid unhandled-rejection noise.

    const frame: Frame = {
      iframe,
      allowNetwork,
      ready,
      failed: false,
      markReady,
      fail: (error) => {
        frame.failed = true
        reject(error)
      },
    }
    const bootTimer = setTimeout(
      () => frame.fail(new Error('Sandbox boot timed out')),
      this.#bootTimeoutMs,
    )
    void ready.finally(() => clearTimeout(bootTimer)).catch(() => {})

    this.#frame = frame
    this.#container.append(iframe)
    return ready.then(() => frame)
  }

  #destroyFrame(): void {
    const frame = this.#frame
    if (!frame) return
    this.#frame = null
    frame.fail(new Error('Sandbox destroyed'))
    frame.iframe.remove()
  }

  #finish(run: ActiveRun, status: RunStatus, kill: boolean): void {
    if (run.settled) return
    run.settled = true
    clearTimeout(run.timer)
    if (this.#active === run) this.#active = null
    if (kill) this.#destroyFrame()
    run.resolve({
      status,
      durationMs: run.startedAt === null ? 0 : performance.now() - run.startedAt,
    })
  }

  async #serveAsset(
    frame: Frame,
    message: Extract<SandboxMessage, { type: 'asset-request' }>,
  ): Promise<void> {
    const { requestId, url, accept } = message
    try {
      const { status, contentType, body } = await this.#assets.get(url, accept)
      if (this.#frame !== frame) return
      this.#post(
        frame,
        { type: 'asset-response', requestId, ok: true, status, contentType, body },
        [body],
      )
    } catch (error) {
      if (this.#frame !== frame) return
      const reason = error instanceof Error ? error.message : String(error)
      this.#post(frame, { type: 'asset-response', requestId, ok: false, error: reason })
    }
  }

  #onMessage = (event: MessageEvent): void => {
    const frame = this.#frame
    if (!frame || event.source !== frame.iframe.contentWindow) return

    const parsed = sandboxMessageSchema.safeParse(event.data)
    if (!parsed.success) {
      console.warn('Ignoring invalid message from the sandbox', parsed.error)
      return
    }
    const message = parsed.data
    if (message.type === 'ready') {
      frame.markReady()
      return
    }
    if (message.type === 'asset-request') {
      void this.#serveAsset(frame, message)
      return
    }

    const run = this.#active
    if (!run || message.runId !== run.id) return

    switch (message.type) {
      case 'started':
        this.#markStarted(run)
        break
      case 'status':
        if (run.startedAt === null) run.callbacks.onStatus?.(message.text)
        break
      case 'log':
        // Defense in depth: the worker enforces this too, but it runs untrusted code.
        if (++run.logCount > this.#maxLogs) {
          run.callbacks.onError(
            runError(
              'OutputLimitError',
              `Output limit reached (${this.#maxLogs} console calls). The run was stopped.`,
            ),
          )
          this.#finish(run, 'failed', true)
          return
        }
        run.callbacks.onLog(message.level, message.args)
        break
      case 'result':
        run.callbacks.onResult(message.value)
        break
      case 'error': {
        const { line, column } = message.error
        const mapped =
          line && column && run.prepared ? run.prepared.mapPosition(line, column) : { line, column }
        run.callbacks.onError({ ...message.error, ...mapped })
        // A Python program that hit the output limit may still be running: kill it.
        this.#finish(run, 'failed', message.error.name === 'OutputLimitError')
        break
      }
      case 'done':
        this.#finish(run, 'completed', false)
        break
    }
  }
}

let shared: SandboxHost | null = null

/** The app-wide sandbox (created on first use). */
export function getSandbox(): SandboxHost {
  shared ??= new SandboxHost()
  return shared
}
