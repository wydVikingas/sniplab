import { useNavigate, useParams } from '@tanstack/react-router'
import { Trash2 } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { LanguageBadge } from '../components/LanguageBadge'
import { useSnippet } from '../db/hooks'
import type { Snippet } from '../db/schema'
import { deleteForever, restoreFromTrash } from '../db/snippets'
import { EditorLoading } from '../editor/EditorLoading'
import { formatRelativeTime } from '../lib/time'
import { useColorScheme } from '../lib/useColorScheme'
import { NotFound } from './NotFound'
import { SnippetEditor } from './SnippetEditor'

const CodeEditor = lazy(() => import('../editor/CodeEditor'))

export function SnippetPage() {
  const { snippetId } = useParams({ from: '/s/$snippetId' })
  const snippet = useSnippet(snippetId)

  if (snippet === undefined) return null
  if (snippet === null) return <NotFound message="This snippet doesn't exist or was deleted." />
  if (snippet.deletedAt !== null) return <TrashedSnippet key={snippet.id} snippet={snippet} />
  // Keyed so switching snippets resets the draft instead of mixing state.
  return <SnippetEditor key={snippet.id} snippet={snippet} />
}

/** Read-only view of a snippet in the Trash, with Restore / Delete forever. */
function TrashedSnippet({ snippet }: { snippet: Snippet }) {
  const scheme = useColorScheme()
  const navigate = useNavigate()
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
        <Trash2 size={16} aria-hidden="true" />
        <p className="flex-1">
          This snippet is in the Trash (deleted {formatRelativeTime(snippet.deletedAt ?? 0)}).
        </p>
        <button
          type="button"
          onClick={() => void restoreFromTrash(snippet.id)}
          className="rounded-md bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-500"
        >
          Restore
        </button>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="rounded-md px-3 py-1.5 font-medium text-red-700 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-500/10"
        >
          Delete forever
        </button>
      </div>
      <header className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <LanguageBadge language={snippet.language} />
        <h1 className="truncate text-lg font-semibold">{snippet.title || 'Untitled snippet'}</h1>
      </header>
      <div className="min-h-64 flex-1">
        <Suspense fallback={<EditorLoading />}>
          <CodeEditor
            value={snippet.code}
            language={snippet.language}
            theme={scheme}
            readOnly
            onChange={() => {}}
          />
        </Suspense>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title="Delete forever?"
        message={`"${snippet.title || 'Untitled snippet'}" and its version history will be permanently deleted. This can't be undone.`}
        confirmLabel="Delete forever"
        onConfirm={() => {
          setConfirmOpen(false)
          void deleteForever([snippet.id]).then(() => navigate({ to: '/', search: (prev) => prev }))
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}
