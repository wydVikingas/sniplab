import { memo, useId, useLayoutEffect, useRef, useState } from 'react'
import { DEFAULT_TIMEOUT_MS, type RunSettings } from '../../db/schema'
import { statusText } from '../../runner/status'
import type { OutputEntry, RunnerState } from '../../runner/useCodeRunner'
import type { LogLevel, RunError } from '../../sandbox/protocol'
import { formatDuration } from '../../sandbox/SandboxHost'
import { ValueView } from './ValueView'

const TIMEOUT_OPTIONS = [1_000, 3_000, DEFAULT_TIMEOUT_MS, 10_000, 30_000]

export interface OutputPanelProps {
  entries: OutputEntry[]
  state: RunnerState
  runSettings: RunSettings
  /** Language-specific hint for reading stdin, e.g. "input()". */
  stdinHint: string
  onRun(): void
  onStop(): void
  onClear(): void
  onRunSettingsChange(settings: RunSettings): void
  onJumpTo(line: number, column: number): void
}

export function OutputPanel({
  entries,
  state,
  runSettings,
  stdinHint,
  onRun,
  onStop,
  onClear,
  onRunSettingsChange,
  onJumpTo,
}: OutputPanelProps) {
  const running = state.phase === 'running'
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const [stdinOpen, setStdinOpen] = useState(runSettings.stdin !== '')
  const stdinId = useId()

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [entries])

  const timeoutOptions = TIMEOUT_OPTIONS.includes(runSettings.timeoutMs)
    ? TIMEOUT_OPTIONS
    : [...TIMEOUT_OPTIONS, runSettings.timeoutMs].sort((a, b) => a - b)

  return (
    <section aria-label="Output" className="flex min-h-0 flex-1 flex-col bg-white dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        {running ? (
          <button
            type="button"
            onClick={onStop}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500"
          >
            ■ Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={onRun}
            title="Run (Ctrl+Enter)"
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
          >
            ▶ Run
          </button>
        )}
        <span role="status" className="text-xs text-zinc-500">
          {statusText(state)}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-3 text-xs text-zinc-600 dark:text-zinc-400">
          <label className="flex items-center gap-1">
            Timeout
            <select
              value={runSettings.timeoutMs}
              onChange={(e) =>
                onRunSettingsChange({ ...runSettings, timeoutMs: Number(e.target.value) })
              }
              className="rounded border border-zinc-300 bg-transparent px-1 py-0.5 dark:border-zinc-700 dark:bg-zinc-900"
            >
              {timeoutOptions.map((ms) => (
                <option key={ms} value={ms}>
                  {formatDuration(ms)}
                </option>
              ))}
            </select>
          </label>
          <label
            className={`flex items-center gap-1 ${runSettings.allowNetwork ? 'font-medium text-amber-700 dark:text-amber-400' : ''}`}
            title="Lets this snippet make network requests and import modules from https URLs"
          >
            <input
              type="checkbox"
              checked={runSettings.allowNetwork}
              onChange={(e) =>
                onRunSettingsChange({ ...runSettings, allowNetwork: e.target.checked })
              }
            />
            Allow network
          </label>
          <button
            type="button"
            aria-expanded={stdinOpen}
            aria-controls={stdinId}
            onClick={() => setStdinOpen((open) => !open)}
            className="rounded px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Input{runSettings.stdin !== '' && ' •'}
          </button>
          <button
            type="button"
            onClick={onClear}
            disabled={entries.length === 0}
            className="rounded px-2 py-1 hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800"
          >
            Clear
          </button>
        </div>
      </div>

      {stdinOpen && (
        <div id={stdinId} className="border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <label className="mb-1 block text-xs text-zinc-500">
            Standard input — read it with <code className="font-mono">{stdinHint}</code>
            <textarea
              value={runSettings.stdin}
              onChange={(e) => onRunSettingsChange({ ...runSettings, stdin: e.target.value })}
              rows={3}
              spellCheck={false}
              placeholder="One line per value"
              className="mt-1 block w-full resize-y rounded border border-zinc-300 bg-transparent px-2 py-1 font-mono text-[13px] text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:text-zinc-100"
            />
          </label>
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
        aria-label="Console output"
        className="min-h-0 flex-1 overflow-auto font-mono text-[13px] leading-5"
      >
        {entries.length === 0 ? (
          <p className="p-3 font-sans text-sm text-zinc-500">
            {state.phase === 'finished'
              ? 'No output.'
              : state.phase === 'running'
                ? 'Waiting for output…'
                : 'Press Run or Ctrl+Enter to execute this snippet.'}
          </p>
        ) : (
          entries.map((entry) => <OutputRow key={entry.id} entry={entry} onJumpTo={onJumpTo} />)
        )}
      </div>
    </section>
  )
}

const LEVEL_CLASS: Record<LogLevel, string> = {
  log: '',
  info: 'text-sky-700 dark:text-sky-300',
  debug: 'text-zinc-500',
  warn: 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300',
  error: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300',
}

const rowClass =
  'border-b border-zinc-100 px-3 py-1 break-words whitespace-pre-wrap dark:border-zinc-800'

const OutputRow = memo(function OutputRow({
  entry,
  onJumpTo,
}: {
  entry: OutputEntry
  onJumpTo(line: number, column: number): void
}) {
  switch (entry.kind) {
    case 'log':
      return (
        <div className={`${rowClass} ${LEVEL_CLASS[entry.level]}`}>
          {entry.args.map((arg, i) => (
            <span key={i}>
              {i > 0 && ' '}
              <ValueView value={arg} topLevel />
            </span>
          ))}
        </div>
      )
    case 'result':
      return (
        <div className={rowClass}>
          <span className="mr-2 text-zinc-400 select-none" title="Value of the last expression">
            ←
          </span>
          <ValueView value={entry.value} />
        </div>
      )
    case 'error':
      return <ErrorRow error={entry.error} onJumpTo={onJumpTo} />
  }
})

function ErrorRow({
  error,
  onJumpTo,
}: {
  error: RunError
  onJumpTo(line: number, column: number): void
}) {
  const { line, column } = error
  return (
    <div className={`${rowClass} bg-red-50 py-2 text-red-700 dark:bg-red-500/10 dark:text-red-300`}>
      <div>
        <span className="font-semibold">{error.name}</span>: {error.message}
      </div>
      {line !== null && (
        <button
          type="button"
          onClick={() => onJumpTo(line, column ?? 1)}
          className="mt-1 font-sans text-xs underline hover:no-underline"
        >
          Go to line {line}
          {column !== null && `:${column}`}
        </button>
      )}
      {error.stack && (
        <details className="mt-1 text-xs">
          <summary className="cursor-pointer font-sans select-none">Stack trace</summary>
          <pre className="mt-1 whitespace-pre-wrap">{error.stack}</pre>
        </details>
      )}
    </div>
  )
}
