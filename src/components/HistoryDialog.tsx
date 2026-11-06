import { X } from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useVersions } from '../db/hooks'
import type { Language, SnippetVersion } from '../db/schema'
import { EditorLoading } from '../editor/EditorLoading'
import type { ColorScheme } from '../lib/useColorScheme'
import { formatRelativeTime } from '../lib/time'

const CodeDiffEditor = lazy(() => import('../editor/CodeDiffEditor'))

export interface HistoryDialogProps {
  snippetId: string
  current: { title: string; language: Language; code: string }
  theme: ColorScheme
  onSaveVersion(): void
  onRestore(version: SnippetVersion): void
  onClose(): void
}

const formatTimestamp = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** Lists saved versions and diffs the selected one against the current code. */
export function HistoryDialog({
  snippetId,
  current,
  theme,
  onSaveVersion,
  onRestore,
  onClose,
}: HistoryDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const versions = useVersions(snippetId)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = versions?.find((v) => v.id === selectedId) ?? versions?.[0]

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  return (
    <dialog
      ref={ref}
      aria-labelledby="history-title"
      onClose={onClose}
      className="m-auto flex h-[85vh] w-[min(1100px,95vw)] max-w-none flex-col overflow-hidden rounded-lg bg-white p-0 text-zinc-900 shadow-xl backdrop:bg-black/40 dark:bg-zinc-900 dark:text-zinc-100"
    >
      <header className="flex items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 id="history-title" className="flex-1 text-base font-semibold">
          Version history
        </h2>
        <button
          type="button"
          onClick={onSaveVersion}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Save current version
        </button>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <X size={18} />
        </button>
      </header>

      {versions === undefined ? null : versions.length === 0 || !selected ? (
        <p className="p-6 text-sm text-zinc-500">
          No saved versions yet. Press <kbd className="font-mono">Ctrl+S</kbd> in the editor (or
          “Save current version”) to save one.
        </p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <ul
            aria-label="Saved versions"
            className="max-h-40 shrink-0 overflow-y-auto border-b border-zinc-200 md:max-h-none md:w-60 md:border-r md:border-b-0 dark:border-zinc-800"
          >
            {versions.map((version) => (
              <li key={version.id}>
                <button
                  type="button"
                  aria-pressed={version.id === selected.id}
                  onClick={() => setSelectedId(version.id)}
                  className={`block w-full px-4 py-2 text-left text-sm ${
                    version.id === selected.id
                      ? 'bg-indigo-50 dark:bg-indigo-500/15'
                      : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  <span className="block font-medium">{formatRelativeTime(version.createdAt)}</span>
                  <span className="block truncate text-xs text-zinc-500">
                    {formatTimestamp(version.createdAt)} · {version.title || 'Untitled'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-800">
              <span className="flex-1">
                Left: version from {formatTimestamp(selected.createdAt)} · Right: current code
              </span>
              <button
                type="button"
                onClick={() => onRestore(selected)}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
              >
                Restore this version
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <Suspense fallback={<EditorLoading />}>
                <CodeDiffEditor
                  original={selected.code}
                  modified={current.code}
                  language={current.language}
                  theme={theme}
                />
              </Suspense>
            </div>
          </div>
        </div>
      )}
    </dialog>
  )
}
