import { useCallback, useEffect, useRef, useState } from 'react'
import type { LogLevel, RunError, SerializedValue } from '../sandbox/protocol'
import {
  getSandbox,
  type RunHandle,
  type RunOutcome,
  type RunRequest,
} from '../sandbox/SandboxHost'

export type OutputEntry =
  | { id: number; kind: 'log'; level: LogLevel; args: SerializedValue[] }
  | { id: number; kind: 'result'; value: SerializedValue }
  | { id: number; kind: 'error'; error: RunError }

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
type NewEntry = DistributiveOmit<OutputEntry, 'id'>

export type RunnerState =
  | { phase: 'idle' }
  /** `detail` describes preparation progress, e.g. "Downloading Python… 3.1 / 12.1 MB". */
  | { phase: 'running'; detail: string | null }
  | { phase: 'finished'; outcome: RunOutcome }

/**
 * Runs code in the shared sandbox and collects its output. Output is buffered and flushed
 * once per animation frame so chatty snippets don't trigger a render per console.log.
 */
export function useCodeRunner() {
  const [entries, setEntries] = useState<OutputEntry[]>([])
  const [state, setState] = useState<RunnerState>({ phase: 'idle' })
  const handleRef = useRef<RunHandle | null>(null)
  const bufferRef = useRef<OutputEntry[]>([])
  const rafRef = useRef<number | null>(null)
  const nextIdRef = useRef(0)
  const runTokenRef = useRef(0)

  const flush = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    const buffered = bufferRef.current
    if (buffered.length === 0) return
    bufferRef.current = []
    setEntries((prev) => prev.concat(buffered))
  }, [])

  const run = useCallback(
    (request: RunRequest): Promise<RunOutcome> => {
      handleRef.current?.stop()
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      bufferRef.current = []
      setEntries([])
      setState({ phase: 'running', detail: null })

      const push = (entry: NewEntry) => {
        bufferRef.current.push({ ...entry, id: nextIdRef.current++ } as OutputEntry)
        rafRef.current ??= requestAnimationFrame(flush)
      }

      // Callbacks may fire before `run` returns, so identify this run by a token, not its handle.
      const token = ++runTokenRef.current
      const handle: RunHandle = getSandbox().run(request, {
        onLog: (level, args) => push({ kind: 'log', level, args }),
        onResult: (value) => push({ kind: 'result', value }),
        onError: (error) => push({ kind: 'error', error }),
        onStatus: (detail) => {
          if (runTokenRef.current === token) setState({ phase: 'running', detail })
        },
      })
      handleRef.current = handle

      return handle.outcome.then((outcome) => {
        if (handleRef.current === handle) {
          handleRef.current = null
          flush()
          setState({ phase: 'finished', outcome })
        }
        return outcome
      })
    },
    [flush],
  )

  const stop = useCallback(() => handleRef.current?.stop(), [])

  const clear = useCallback(() => {
    bufferRef.current = []
    setEntries([])
    if (!handleRef.current) setState({ phase: 'idle' })
  }, [])

  // Stop any running snippet when the editor unmounts (e.g. switching snippets).
  useEffect(
    () => () => {
      handleRef.current?.stop()
      handleRef.current = null
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    },
    [],
  )

  return { entries, state, run, stop, clear }
}
