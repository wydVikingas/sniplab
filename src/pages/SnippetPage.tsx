import { useNavigate, useParams } from '@tanstack/react-router'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useSnippet } from '../db/hooks'
import { LANGUAGES, type Language, type Snippet, type SnippetPatch } from '../db/schema'
import { moveToTrash, updateSnippet } from '../db/snippets'
import { EditorLoading } from '../editor/EditorLoading'
import { createDebouncedSaver, type SaveStatus } from '../lib/debouncedSaver'
import { LANGUAGE_INFO } from '../lib/languages'
import { formatTags, parseTags } from '../lib/tags'
import { useColorScheme } from '../lib/useColorScheme'
import { NotFound } from './NotFound'

// Monaco is large: load it only when a snippet is opened.
const CodeEditor = lazy(() => import('../editor/CodeEditor'))

const AUTOSAVE_DELAY_MS = 500

export function SnippetPage() {
  const { snippetId } = useParams({ from: '/s/$snippetId' })
  const snippet = useSnippet(snippetId)

  if (snippet === undefined) return null
  if (snippet === null) return <NotFound message="This snippet doesn't exist or was deleted." />
  // Keyed so switching snippets resets the draft instead of mixing state.
  return <SnippetEditor key={snippet.id} initial={snippet} />
}

interface Draft {
  title: string
  description: string
  language: Language
  code: string
  tagsInput: string
}

function toDraft(snippet: Snippet): Draft {
  return {
    title: snippet.title,
    description: snippet.description,
    language: snippet.language,
    code: snippet.code,
    tagsInput: formatTags(snippet.tags),
  }
}

function toPatch(draft: Draft): SnippetPatch {
  return {
    title: draft.title,
    description: draft.description,
    language: draft.language,
    code: draft.code,
    tags: parseTags(draft.tagsInput),
  }
}

const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: '',
  dirty: 'Unsaved changes',
  saving: 'Saving…',
  saved: 'Saved',
  error: "Couldn't save",
}

const inputClass =
  'rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none dark:border-zinc-700'

function SnippetEditor({ initial }: { initial: Snippet }) {
  const scheme = useColorScheme()
  const navigate = useNavigate()
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial))
  const draftRef = useRef(draft)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [saver] = useState(() =>
    createDebouncedSaver<SnippetPatch>(
      (patch) => updateSnippet(initial.id, patch),
      AUTOSAVE_DELAY_MS,
      setStatus,
    ),
  )

  // Save pending edits when leaving the snippet or the page, and on Ctrl/Cmd+S.
  useEffect(() => {
    const flush = () => void saver.flush()
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        flush()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [saver])

  // Always derive from the ref so rapid edits (e.g. Monaco keystrokes) never use a stale draft.
  const setDraftFields = (changes: Partial<Draft>) => {
    const next = { ...draftRef.current, ...changes }
    draftRef.current = next
    setDraft(next)
    return next
  }

  const update = (changes: Partial<Draft>) => {
    saver.schedule(toPatch(setDraftFields(changes)))
  }

  const changeLanguage = (language: Language) => {
    const current = draftRef.current
    // Swap the starter code only if the user hasn't touched it.
    const untouched = current.code === LANGUAGE_INFO[current.language].starter
    update(untouched ? { language, code: LANGUAGE_INFO[language].starter } : { language })
  }

  const handleDelete = async () => {
    setConfirmOpen(false)
    await saver.flush()
    await navigate({ to: '/' })
    await moveToTrash(initial.id)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <input
          aria-label="Title"
          value={draft.title}
          maxLength={200}
          onChange={(e) => update({ title: e.target.value })}
          placeholder="Untitled snippet"
          className="min-w-0 flex-1 bg-transparent text-lg font-semibold placeholder:text-zinc-400 focus:outline-none"
        />
        <span
          role="status"
          aria-live="polite"
          className={`text-xs ${status === 'error' ? 'text-red-600' : 'text-zinc-500'}`}
        >
          {STATUS_TEXT[status]}
        </span>
        <label className="sr-only" htmlFor="snippet-language">
          Language
        </label>
        <select
          id="snippet-language"
          value={draft.language}
          onChange={(e) => changeLanguage(e.target.value as Language)}
          className={`${inputClass} dark:bg-zinc-900`}
        >
          {LANGUAGES.map((lang) => (
            <option key={lang} value={lang}>
              {LANGUAGE_INFO[lang].label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="rounded-md px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
        >
          Delete
        </button>
      </header>

      <div className="grid gap-2 border-b border-zinc-200 px-4 py-3 md:grid-cols-[1fr_2fr] dark:border-zinc-800">
        <input
          aria-label="Tags"
          value={draft.tagsInput}
          onChange={(e) => update({ tagsInput: e.target.value })}
          onBlur={() =>
            setDraftFields({ tagsInput: formatTags(parseTags(draftRef.current.tagsInput)) })
          }
          placeholder="Tags, comma separated"
          className={inputClass}
        />
        <textarea
          aria-label="Description"
          value={draft.description}
          onChange={(e) => update({ description: e.target.value })}
          placeholder="Description (Markdown)"
          rows={1}
          className={`${inputClass} resize-y`}
        />
      </div>

      <div className="min-h-64 flex-1">
        <Suspense fallback={<EditorLoading />}>
          <CodeEditor
            value={draft.code}
            language={draft.language}
            theme={scheme}
            onChange={(code) => update({ code })}
          />
        </Suspense>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Delete snippet?"
        message={`"${draft.title || 'Untitled snippet'}" will be moved to the Trash.`}
        confirmLabel="Delete"
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}
