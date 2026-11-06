import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDebouncedSaver, type SaveStatus } from './debouncedSaver'

describe('createDebouncedSaver', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function setup(save = vi.fn<(v: string) => Promise<void>>().mockResolvedValue(undefined)) {
    const statuses: SaveStatus[] = []
    const saver = createDebouncedSaver(save, 500, (s) => statuses.push(s))
    return { save, saver, statuses }
  }

  it('saves only the latest value after the delay', async () => {
    const { save, saver, statuses } = setup()
    saver.schedule('a')
    saver.schedule('b')
    await vi.advanceTimersByTimeAsync(499)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(save).toHaveBeenCalledExactlyOnceWith('b')
    expect(statuses.at(-1)).toBe('saved')
  })

  it('flush saves immediately and is a no-op when nothing is queued', async () => {
    const { save, saver } = setup()
    await saver.flush()
    expect(save).not.toHaveBeenCalled()
    saver.schedule('a')
    await saver.flush()
    expect(save).toHaveBeenCalledExactlyOnceWith('a')
    await vi.runAllTimersAsync()
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('cancel drops the queued value', async () => {
    const { save, saver } = setup()
    saver.schedule('a')
    saver.cancel()
    await vi.runAllTimersAsync()
    expect(save).not.toHaveBeenCalled()
  })

  it('does not report saved while newer edits are queued', async () => {
    let resolveSave: () => void = () => {}
    const save = vi.fn(() => new Promise<void>((r) => (resolveSave = r)))
    const { saver, statuses } = setup(save)
    saver.schedule('a')
    const flushing = saver.flush()
    saver.schedule('b')
    resolveSave()
    await flushing
    expect(statuses.at(-1)).toBe('dirty')
  })

  it('reports errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { saver, statuses } = setup(vi.fn().mockRejectedValue(new Error('disk full')))
    saver.schedule('a')
    await saver.flush()
    expect(statuses.at(-1)).toBe('error')
  })
})
