export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

export interface DebouncedSaver<T> {
  /** Queue a value; it is saved after `delayMs` of inactivity. Later calls replace earlier ones. */
  schedule(value: T): void
  /** Save the queued value now (no-op if nothing is queued). */
  flush(): Promise<void>
  /** Drop the queued value without saving. */
  cancel(): void
}

/**
 * Debounces saves and reports status. Only the latest scheduled value is saved, and a
 * save that completes while newer edits are queued does not report `saved`.
 */
export function createDebouncedSaver<T>(
  save: (value: T) => Promise<void>,
  delayMs: number,
  onStatus: (status: SaveStatus) => void,
): DebouncedSaver<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let queued: { value: T } | undefined

  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  const flush = async () => {
    clearTimer()
    if (!queued) return
    const { value } = queued
    queued = undefined
    onStatus('saving')
    try {
      await save(value)
      if (!queued) onStatus('saved')
    } catch (error) {
      console.error('Save failed', error)
      onStatus('error')
    }
  }

  return {
    schedule(value) {
      queued = { value }
      onStatus('dirty')
      clearTimer()
      timer = setTimeout(() => void flush(), delayMs)
    },
    flush,
    cancel() {
      clearTimer()
      queued = undefined
    },
  }
}
