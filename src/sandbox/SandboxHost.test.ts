import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HostMessage } from './protocol'
import type { PythonAssets } from './pythonAssets'
import {
  formatDuration,
  SandboxHost,
  type RunRequest,
  type SandboxHostOptions,
} from './SandboxHost'

type RunMessage = Extract<HostMessage, { type: 'run' }>

const request = (overrides: Partial<RunRequest> = {}): RunRequest => ({
  language: 'javascript',
  code: 'console.log(1)',
  timeoutMs: 1_000,
  allowNetwork: false,
  stdin: '',
  ...overrides,
})

let cleanup: (() => void) | null = null
afterEach(() => {
  cleanup?.()
  cleanup = null
})

/** A SandboxHost whose iframe we drive by hand, since jsdom doesn't run the sandbox. */
function setup(options: SandboxHostOptions = {}) {
  const container = document.createElement('div')
  document.body.append(container)
  const host = new SandboxHost({ container, ...options })
  cleanup = () => {
    host.dispose()
    container.remove()
  }
  const frames = () => [...container.querySelectorAll('iframe')]
  const frame = () => {
    const [iframe] = frames()
    if (!iframe?.contentWindow) throw new Error('No sandbox frame')
    return iframe
  }
  const callbacks = { onLog: vi.fn(), onResult: vi.fn(), onError: vi.fn(), onStatus: vi.fn() }

  const send = (data: unknown, source: Window | null = frame().contentWindow) =>
    window.dispatchEvent(new MessageEvent('message', { data, source }))

  /** Wait for the frame, report it ready, and capture what the host posts to it. */
  async function bootFrame() {
    await vi.waitFor(() => expect(frames()).toHaveLength(1))
    const post = vi.spyOn(frame().contentWindow!, 'postMessage')
    send({ type: 'ready' })
    return post
  }

  /** Boot the frame and return the run message the host posts to it. */
  async function boot(): Promise<RunMessage> {
    const post = await bootFrame()
    await vi.waitFor(() => expect(post).toHaveBeenCalled())
    const [message, targetOrigin] = post.mock.calls[0]!
    expect(targetOrigin).toBe('*')
    return message as RunMessage
  }

  /** Boot and report that user code started (so the run timeout applies). */
  async function start(): Promise<RunMessage> {
    const message = await boot()
    send({ type: 'started', runId: message.runId })
    return message
  }

  return { host, frames, frame, callbacks, send, bootFrame, boot, start }
}

describe('SandboxHost', () => {
  it('runs code in a locked-down iframe and relays output', async () => {
    const { host, frame, callbacks, send, start } = setup()
    const handle = host.run(request({ code: 'console.log(1)\n1 + 1', stdin: 'a\nb' }), callbacks)

    const message = await start()
    expect(frame().getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame().srcdoc).toContain("connect-src 'none'")
    expect(message).toMatchObject({
      type: 'run',
      runtime: 'javascript',
      hasResult: true,
      stdin: 'a\nb',
      packages: [],
    })
    expect(message.source).toContain('export const __sniplab_result__ = (1 + 1);')

    const { runId } = message
    send({ type: 'log', runId, level: 'log', args: [{ t: 'number', v: '1' }] })
    send({ type: 'result', runId, value: { t: 'number', v: '2' } })
    send({ type: 'done', runId })

    await expect(handle.outcome).resolves.toMatchObject({ status: 'completed' })
    expect(callbacks.onLog).toHaveBeenCalledWith('log', [{ t: 'number', v: '1' }])
    expect(callbacks.onResult).toHaveBeenCalledWith({ t: 'number', v: '2' })
    expect(callbacks.onError).not.toHaveBeenCalled()
  })

  it('transpiles TypeScript before running it', async () => {
    const { host, callbacks, boot } = setup()
    host.run(request({ language: 'typescript', code: 'const n: number = 1\nn + 1' }), callbacks)
    const message = await boot()
    expect(message.runtime).toBe('javascript')
    expect(message.source).not.toContain(': number')
    expect(message.source).toContain('export const __sniplab_result__ = (n + 1);')
  })

  it('sends Python runs with their required packages', async () => {
    const { host, callbacks, boot } = setup()
    host.run(request({ language: 'python', code: '# requires: tabulate\nprint(1)' }), callbacks)
    const message = await boot()
    expect(message).toMatchObject({ runtime: 'python', packages: ['tabulate'] })
  })

  it('ignores foreign, malformed and stale messages', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { host, callbacks, send, start } = setup()
    const handle = host.run(request(), callbacks)
    const { runId } = await start()

    const log = { type: 'log', runId, level: 'log', args: [{ t: 'string', v: 'x' }] }
    send(log, window) // wrong source
    send({ type: 'log', runId, level: 'shout', args: [] }) // invalid level
    send({ ...log, runId: 'other-run' }) // wrong run
    send({ type: 'log', runId, level: 'log', args: [{ t: 'object', entries: 'nope' }] })
    expect(callbacks.onLog).not.toHaveBeenCalled()

    send({ type: 'done', runId })
    await expect(handle.outcome).resolves.toMatchObject({ status: 'completed' })
  })

  it('reports preparation status until user code starts', async () => {
    const { host, callbacks, send, boot } = setup()
    host.run(request({ language: 'python', code: 'print(1)' }), callbacks)
    const { runId } = await boot()

    send({ type: 'status', runId, text: 'Starting Python…' })
    expect(callbacks.onStatus).toHaveBeenLastCalledWith('Starting Python…')
    send({ type: 'started', runId })
    expect(callbacks.onStatus).toHaveBeenLastCalledWith(null)
    send({ type: 'status', runId, text: 'late' })
    expect(callbacks.onStatus).not.toHaveBeenCalledWith('late')
  })

  it('times out stuck code and tears down the frame', async () => {
    const { host, frames, callbacks, start } = setup()
    const handle = host.run(request({ timeoutMs: 30 }), callbacks)
    await start()

    await expect(handle.outcome).resolves.toMatchObject({ status: 'timed-out' })
    expect(callbacks.onError).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'TimeoutError',
        message: expect.stringContaining('timed out'),
      }),
    )
    expect(frames()).toHaveLength(0)
  })

  it('does not count runtime start-up against the run timeout', async () => {
    const { host, callbacks, boot } = setup({ prepareTimeoutMs: { python: 30 } })
    const handle = host.run(request({ language: 'python', timeoutMs: 10_000 }), callbacks)
    await boot()
    // Never "started": the separate start-up limit applies.
    await expect(handle.outcome).resolves.toEqual({ status: 'timed-out', durationMs: 0 })
    expect(callbacks.onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Python took longer') }),
    )
  })

  it('stops a run on request and ignores its later messages', async () => {
    const { host, frames, callbacks, send, start } = setup()
    const handle = host.run(request(), callbacks)
    const { runId } = await start()
    const stoppedFrame = frames()[0]!.contentWindow

    handle.stop()
    await expect(handle.outcome).resolves.toMatchObject({ status: 'stopped' })
    expect(frames()).toHaveLength(0)

    send({ type: 'log', runId, level: 'log', args: [] }, stoppedFrame)
    expect(callbacks.onLog).not.toHaveBeenCalled()
  })

  it('starting a new run stops the previous one', async () => {
    const { host, callbacks, start } = setup()
    const first = host.run(request(), callbacks)
    await start()
    host.run(request(), callbacks)
    await expect(first.outcome).resolves.toMatchObject({ status: 'stopped' })
  })

  it('reports syntax errors without starting a sandbox', async () => {
    const { host, frames, callbacks } = setup()
    const handle = host.run(request({ code: 'let = ;' }), callbacks)
    await expect(handle.outcome).resolves.toEqual({ status: 'failed', durationMs: 0 })
    expect(callbacks.onError).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'SyntaxError', line: 1 }),
    )
    expect(frames()).toHaveLength(0)
  })

  it('maps runtime error positions back to the original code', async () => {
    const { host, callbacks, send, start } = setup()
    const handle = host.run(request({ code: 'boom()' }), callbacks)
    const { runId } = await start()
    const column = 'export const __sniplab_result__ = ('.length + 1
    send({
      type: 'error',
      runId,
      error: {
        name: 'ReferenceError',
        message: 'boom is not defined',
        stack: null,
        line: 1,
        column,
      },
    })
    await expect(handle.outcome).resolves.toMatchObject({ status: 'failed' })
    expect(callbacks.onError).toHaveBeenCalledWith(expect.objectContaining({ line: 1, column: 1 }))
  })

  it('enforces the output limit even if the sandbox does not', async () => {
    const { host, frames, callbacks, send, start } = setup({ maxLogs: 2 })
    const handle = host.run(request(), callbacks)
    const { runId } = await start()
    for (let i = 0; i < 3; i++) send({ type: 'log', runId, level: 'log', args: [] })

    await expect(handle.outcome).resolves.toMatchObject({ status: 'failed' })
    expect(callbacks.onLog).toHaveBeenCalledTimes(2)
    expect(callbacks.onError).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'OutputLimitError' }),
    )
    expect(frames()).toHaveLength(0)
  })

  it('reuses the frame between runs and rebuilds it when network access changes', async () => {
    const { host, frames, frame, callbacks, send, start } = setup()
    const first = host.run(request(), callbacks)
    const { runId } = await start()
    send({ type: 'done', runId })
    await first.outcome
    const original = frame()

    host.run(request(), callbacks)
    await new Promise((r) => setTimeout(r, 10))
    expect(frame()).toBe(original)

    host.run(request({ allowNetwork: true }), callbacks)
    await vi.waitFor(() => expect(frame()).not.toBe(original))
    expect(frames()).toHaveLength(1)
    expect(frame().srcdoc).toContain('connect-src *')
  })

  it('fails cleanly when the sandbox never boots', async () => {
    const { host, frames, callbacks } = setup({ bootTimeoutMs: 20 })
    const handle = host.run(request(), callbacks)
    await expect(handle.outcome).resolves.toMatchObject({ status: 'failed' })
    expect(callbacks.onError).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'SandboxError' }),
    )
    expect(frames()).toHaveLength(0)
  })

  it('prewarms the Python runtime', async () => {
    const { host, bootFrame } = setup()
    host.prewarm('python', false)
    const post = await bootFrame()
    await vi.waitFor(() =>
      expect(post).toHaveBeenCalledWith({ type: 'prewarm', runtime: 'python' }, '*', []),
    )
  })

  it('serves asset requests through PythonAssets and transfers the body', async () => {
    const body = new ArrayBuffer(3)
    const get = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('blocked')) throw new Error(`Blocked request to ${url}`)
      return { status: 200, contentType: 'application/wasm', body }
    })
    const assets = { get, onProgress: null } as unknown as PythonAssets
    const { host, send, bootFrame } = setup({ assets })
    host.prewarm('python', false)
    const post = await bootFrame()

    send({
      type: 'asset-request',
      requestId: 1,
      url: 'https://sniplab.invalid/pyodide/a',
      accept: null,
    })
    send({ type: 'asset-request', requestId: 2, url: 'https://blocked.example/', accept: null })
    await vi.waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        {
          type: 'asset-response',
          requestId: 1,
          ok: true,
          status: 200,
          contentType: 'application/wasm',
          body,
        },
        '*',
        [body],
      ),
    )
    await vi.waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        {
          type: 'asset-response',
          requestId: 2,
          ok: false,
          error: 'Blocked request to https://blocked.example/',
        },
        '*',
        [],
      ),
    )
  })
})

describe('formatDuration', () => {
  it.each([
    [12.4, '12 ms'],
    [1_000, '1 s'],
    [1_540, '1.5 s'],
    [12_400, '12 s'],
  ])('%d → %s', (ms, text) => expect(formatDuration(ms)).toBe(text))
})
