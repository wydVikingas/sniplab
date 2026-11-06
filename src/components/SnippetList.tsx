import { Link, useNavigate } from '@tanstack/react-router'
import { Menu as MenuIcon, Plus, Star } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useAllSnippets, useFolders } from '../db/hooks'
import type { Snippet } from '../db/schema'
import { emptyTrash } from '../db/snippets'
import { SNIPPET_MIME, startDrag } from '../lib/dnd'
import { LANGUAGE_INFO } from '../lib/languages'
import { applyFilter, filterTitle, type LibraryFilter } from '../lib/libraryFilter'
import { formatRelativeTime } from '../lib/time'
import { useCreateSnippet, useLibraryFilter } from '../lib/useLibrary'
import { ConfirmDialog } from './ConfirmDialog'
import { LanguageBadge } from './LanguageBadge'

function matchesFilter(snippet: Snippet, query: string): boolean {
  if (!query) return true
  const haystack = [snippet.title, LANGUAGE_INFO[snippet.language].label, ...snippet.tags]
    .join(' ')
    .toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((term) => haystack.includes(term))
}

function emptyMessage(filter: LibraryFilter, hasQuery: boolean): string {
  if (hasQuery) return 'No snippets match your filter.'
  switch (filter.kind) {
    case 'favorites':
      return 'No favorites yet. Star a snippet to see it here.'
    case 'recent':
      return 'Snippets you open will show up here.'
    case 'trash':
      return 'The Trash is empty.'
    case 'folder':
      return 'This folder is empty. Drag snippets here or create one.'
    case 'tag':
      return 'No snippets with this tag.'
    default:
      return 'No snippets yet.'
  }
}

function metaTime(snippet: Snippet, filter: LibraryFilter): string {
  if (filter.kind === 'trash' && snippet.deletedAt !== null) {
    return `deleted ${formatRelativeTime(snippet.deletedAt)}`
  }
  if (filter.kind === 'recent' && snippet.lastOpenedAt !== null) {
    return `opened ${formatRelativeTime(snippet.lastOpenedAt)}`
  }
  return formatRelativeTime(snippet.updatedAt)
}

/** The middle pane: snippets in the current view. */
export function SnippetList({ onOpenNav }: { onOpenNav(): void }) {
  const snippets = useAllSnippets()
  const folders = useFolders()
  const filter = useLibraryFilter()
  const createSnippet = useCreateSnippet()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [confirmEmpty, setConfirmEmpty] = useState(false)

  const listed = useMemo(
    () => (snippets ? applyFilter(snippets, filter) : undefined),
    [snippets, filter],
  )
  const visible = useMemo(
    () => listed?.filter((s) => matchesFilter(s, query.trim())),
    [listed, query],
  )
  const inTrash = filter.kind === 'trash'

  return (
    <aside className="flex max-h-72 shrink-0 flex-col border-b border-zinc-200 bg-white md:max-h-none md:w-72 md:border-r md:border-b-0 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-1 px-3 pt-3 pb-2">
        <button
          type="button"
          onClick={onOpenNav}
          aria-label="Show library"
          className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 lg:hidden dark:hover:bg-zinc-800"
        >
          <MenuIcon size={18} />
        </button>
        <h2 className="min-w-0 flex-1 truncate px-1 text-base font-semibold">
          {filterTitle(filter, folders ?? [])}
          {listed && listed.length > 0 && (
            <span className="ml-2 text-sm font-normal text-zinc-500">{listed.length}</span>
          )}
        </h2>
        {inTrash ? (
          <button
            type="button"
            disabled={!listed?.length}
            onClick={() => setConfirmEmpty(true)}
            className="rounded-md px-2 py-1 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 dark:hover:bg-red-500/10"
          >
            Empty trash
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void createSnippet()}
            className="flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            <Plus size={15} />
            New snippet
          </button>
        )}
      </div>

      <div className="px-3 pb-2">
        <input
          aria-label="Filter snippets"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by title, tag, language…"
          className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none dark:border-zinc-700"
        />
      </div>

      <nav aria-label="Snippets" className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {visible === undefined ? null : visible.length === 0 ? (
          <p className="px-2 py-4 text-sm text-zinc-500">
            {emptyMessage(filter, query.trim() !== '')}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {visible.map((snippet) => (
              <li key={snippet.id}>
                <Link
                  to="/s/$snippetId"
                  params={{ snippetId: snippet.id }}
                  search={(prev) => prev}
                  draggable={!inTrash}
                  onDragStart={(e) => startDrag(e, SNIPPET_MIME, snippet.id)}
                  className="block rounded-md px-2 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  activeProps={{
                    className: 'bg-indigo-50 hover:bg-indigo-50 dark:bg-indigo-500/15',
                    'aria-current': 'page',
                  }}
                >
                  <div className="flex items-center gap-2">
                    <LanguageBadge language={snippet.language} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {snippet.title || 'Untitled'}
                    </span>
                    {snippet.favorite && (
                      <Star
                        size={13}
                        aria-label="Favorite"
                        className="shrink-0 fill-amber-400 text-amber-400"
                      />
                    )}
                  </div>
                  <div className="mt-1 truncate pl-0.5 text-xs text-zinc-500">
                    {metaTime(snippet, filter)}
                    {snippet.tags.length > 0 && ` · ${snippet.tags.map((t) => `#${t}`).join(' ')}`}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </nav>

      <ConfirmDialog
        open={confirmEmpty}
        title="Empty the Trash?"
        message={`${listed?.length ?? 0} snippet(s) and their version history will be permanently deleted. This can't be undone.`}
        confirmLabel="Delete forever"
        onConfirm={() => {
          setConfirmEmpty(false)
          void emptyTrash().then(() => navigate({ to: '/', search: { view: 'trash' } }))
        }}
        onCancel={() => setConfirmEmpty(false)}
      />
    </aside>
  )
}
