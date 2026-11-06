import { prepareJavaScript, type PreparedJavaScript } from './prepareJavaScript'
import {
  MAX_LOG_CALLS,
  RESULT_EXPORT,
  sandboxMessageSchema,
  type HostMessage,
  type LogLevel,
  type RunError,
  type SerializedValue,
} from './protocol'
import { buildSrcdoc } from './srcdoc'

export interface RunRequest {
  code: string
  timeoutMs: number
  allowNetwork: boolean
}

export interface RunCallbacks {
  onLog(level: LogLevel, args: SerializedValue[]): void
  onResult(value: SerializedValue): void
  onError(error: RunError): void
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
  callbacks: RunCallbacks
  prepared: PreparedJavaScript
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

/**
 * Runs untrusted snippets in a sandboxed, opaque-origin iframe that hosts one Web Worker
 * per run. Only one run is active at a time. Timeouts and Stop remove the whole iframe,
 * which terminates the worker even if it is stuck in an infinite loop.
 */
export class SandboxHost {
  readonly #container: HTMLElement
  readonly #maxLogs: number
  readonly #bootTimeoutMs: number
  #frame: Frame | null = null
  #active: ActiveRun | null = null

  constructor(options: SandboxHostOptions = {}) {
    this.#container = options.container ?? document.body
    this.#maxLogs = options.maxLogs ?? MAX_LOG_CALLS
    this.#bootTimeoutMs = options.bootTimeoutMs ?? 10_000
    window.addEventListener('message', this.#onMessage)
  }

  run(request: RunRequest, callbacks: RunCallbacks): RunHandle {
    if (this.#active) this.#finish(this.#active, 'stopped', true)

    let resolve!: (outcome: RunOutcome) => void
    const outcome = new Promise<RunOutcome>((r) => (resolve = r))

    const prepared = prepareJavaScript(request.code)
    if (!prepared.ok) {
      callbacks.onError(prepared.error)
      resolve({ status: 'failed', durationMs: 0 })
      return { outcome, stop: () => {} }
    }

    const run: ActiveRun = {
      id: crypto.randomUUID(),
      callbacks,
      prepared: prepared.prepared,
      startedAt: null,
      logCount: 0,
      timer: undefined,
      settled: false,
      resolve,
    }
    this.#active = run
    void this.#start(run, request)
    return { outcome, stop: () => this.#finish(run, 'stopped', true) }
  }

  /** Boot a sandbox frame ahead of time so the first run starts faster. */
  prewarm(allowNetwork: boolean): void {
    if (this.#active) return
    this.#getFrame(allowNetwork).catch(() => {})
  }

  dispose(): void {
    if (this.#active) this.#finish(this.#active, 'stopped', true)
    this.#destroyFrame()
    window.removeEventListener('message', this.#onMessage)
  }

  async #start(run: ActiveRun, request: RunRequest): Promise<void> {
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

    const message: HostMessage = {
      type: 'run',
      runId: run.id,
      runtime: 'javascript',
      source: run.prepared.source,
      hasResult: run.prepared.hasResult,
      resultExport: RESULT_EXPORT,
      maxLogs: this.#maxLogs,
    }
    run.startedAt = performance.now()
    run.timer = setTimeout(() => {
      if (this.#active !== run) return
      run.callbacks.onError(
        runError(
          'TimeoutError',
          `Execution timed out after ${formatDuration(request.timeoutMs)}. The run was stopped.`,
        ),
      )
      this.#finish(run, 'timed-out', true)
    }, request.timeoutMs)
    // The iframe has an opaque origin, so '*' is the only usable target origin.
    frame.iframe.contentWindow?.postMessage(message, '*')
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

    const run = this.#active
    if (!run || message.runId !== run.id) return

    switch (message.type) {
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
        const mapped = line && column ? run.prepared.mapPosition(line, column) : { line, column }
        run.callbacks.onError({ ...message.error, ...mapped })
        this.#finish(run, 'failed', false)
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
