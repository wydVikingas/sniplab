import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HostMessage } from './protocol'
import { formatDuration, SandboxHost, type RunRequest } from './SandboxHost'

const request = (overrides: Partial<RunRequest> = {}): RunRequest => ({
  code: 'console.log(1)',
  timeoutMs: 1_000,
  allowNetwork: false,
  ...overrides,
})

let cleanup: (() => void) | null = null
afterEach(() => {
  cleanup?.()
  cleanup = null
})

/** A SandboxHost whose iframe we drive by hand, since jsdom doesn't run the sandbox. */
function setup(options: { maxLogs?: number; bootTimeoutMs?: number } = {}) {
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
  const callbacks = { onLog: vi.fn(), onResult: vi.fn(), onError: vi.fn() }

  const send = (data: unknown, source: Window | null = frame().contentWindow) =>
    window.dispatchEvent(new MessageEvent('message', { data, source }))

  /** Boot the current frame and return the run message the host posts to it. */
  async function boot(): Promise<HostMessage> {
    const post = vi.spyOn(frame().contentWindow!, 'postMessage')
    send({ type: 'ready' })
    await vi.waitFor(() => expect(post).toHaveBeenCalled())
    const [message, targetOrigin] = post.mock.calls[0]!
    expect(targetOrigin).toBe('*')
    return message as HostMessage
  }

  return { host, frames, frame, callbacks, send, boot }
}

describe('SandboxHost', () => {
  it('runs code in a locked-down iframe and relays output', async () => {
    const { host, frame, callbacks, send, boot } = setup()
    const handle = host.run(request({ code: 'console.log(1)\n1 + 1' }), callbacks)

    expect(frame().getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame().srcdoc).toContain("connect-src 'none'")

    const message = await boot()
    expect(message).toMatchObject({ type: 'run', runtime: 'javascript', hasResult: true })
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

  it('ignores foreign, malformed and stale messages', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { host, callbacks, send, boot } = setup()
    const handle = host.run(request(), callbacks)
    const { runId } = await boot()

    const log = { type: 'log', runId, level: 'log', args: [{ t: 'string', v: 'x' }] }
    send(log, window) // wrong source
    send({ type: 'log', runId, level: 'shout', args: [] }) // invalid level
    send({ ...log, runId: 'other-run' }) // wrong run
    send({ type: 'log', runId, level: 'log', args: [{ t: 'object', entries: 'nope' }] })
    expect(callbacks.onLog).not.toHaveBeenCalled()

    send({ type: 'done', runId })
    await expect(handle.outcome).resolves.toMatchObject({ status: 'completed' })
  })

  it('times out stuck code and tears down the frame', async () => {
    const { host, frames, callbacks, boot } = setup()
    const handle = host.run(request({ timeoutMs: 30 }), callbacks)
    await boot()

    await expect(handle.outcome).resolves.toMatchObject({ status: 'timed-out' })
    expect(callbacks.onError).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'TimeoutError' }),
    )
    expect(frames()).toHaveLength(0)
  })

  it('stops a run on request and ignores its later messages', async () => {
    const { host, frames, callbacks, send, boot } = setup()
    const handle = host.run(request(), callbacks)
    const { runId } = await boot()
    const stoppedFrame = frames()[0]!.contentWindow

    handle.stop()
    await expect(handle.outcome).resolves.toMatchObject({ status: 'stopped' })
    expect(frames()).toHaveLength(0)

    send({ type: 'log', runId, level: 'log', args: [] }, stoppedFrame)
    expect(callbacks.onLog).not.toHaveBeenCalled()
  })

  it('starting a new run stops the previous one', async () => {
    const { host, callbacks, boot } = setup()
    const first = host.run(request(), callbacks)
    await boot()
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
    const { host, callbacks, send, boot } = setup()
    const handle = host.run(request({ code: 'boom()' }), callbacks)
    const { runId } = await boot()
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
    const { host, frames, callbacks, send, boot } = setup({ maxLogs: 2 })
    const handle = host.run(request(), callbacks)
    const { runId } = await boot()
    for (let i = 0; i < 3; i++) send({ type: 'log', runId, level: 'log', args: [] })

    await expect(handle.outcome).resolves.toMatchObject({ status: 'failed' })
    expect(callbacks.onLog).toHaveBeenCalledTimes(2)
    expect(callbacks.onError).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'OutputLimitError' }),
    )
    expect(frames()).toHaveLength(0)
  })

  it('reuses the frame between runs and rebuilds it when network access changes', async () => {
    const { host, frames, frame, callbacks, send, boot } = setup()
    const first = host.run(request(), callbacks)
    const { runId } = await boot()
    send({ type: 'done', runId })
    await first.outcome
    const original = frame()

    host.run(request(), callbacks)
    expect(frame()).toBe(original)

    host.run(request({ allowNetwork: true }), callbacks)
    expect(frames()).toHaveLength(1)
    expect(frame()).not.toBe(original)
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
})

describe('formatDuration', () => {
  it.each([
    [12.4, '12 ms'],
    [1_000, '1 s'],
    [1_540, '1.5 s'],
    [12_400, '12 s'],
  ])('%d → %s', (ms, text) => expect(formatDuration(ms)).toBe(text))
})
