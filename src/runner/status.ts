import { formatDuration } from '../sandbox/SandboxHost'
import type { RunnerState } from './useCodeRunner'

export function statusText(state: RunnerState): string {
  if (state.phase === 'idle') return ''
  if (state.phase === 'running') return 'Running…'
  const { status, durationMs } = state.outcome
  const d = formatDuration(durationMs)
  switch (status) {
    case 'completed':
      return `Finished in ${d}`
    case 'failed':
      return durationMs > 0 ? `Failed after ${d}` : 'Failed'
    case 'stopped':
      return `Stopped after ${d}`
    case 'timed-out':
      return `Timed out after ${d}`
  }
}
