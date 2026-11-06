import { Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { useSnippets } from '../db/hooks'
import type { Snippet } from '../db/schema'
import { LANGUAGE_INFO } from '../lib/languages'
import { formatRelativeTime } from '../lib/time'
import { useCreateSnippet } from '../lib/useCreateSnippet'
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

export function Sidebar() {
  const snippets = useSnippets()
  const createSnippet = useCreateSnippet()
  const [filter, setFilter] = useState('')

  const visible = useMemo(
    () => snippets?.filter((s) => matchesFilter(s, filter.trim())),
    [snippets, filter],
  )

  return (
    <aside className="flex max-h-72 shrink-0 flex-col border-b border-zinc-200 bg-white md:max-h-none md:w-72 md:border-r md:border-b-0 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-3">
        <Link to="/" className="text-lg font-bold tracking-tight">
          SnipLab
        </Link>
        <button
          type="button"
          onClick={() => void createSnippet()}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
        >
          New snippet
        </button>
      </div>

      <div className="px-4 pb-3">
        <input
          aria-label="Filter snippets"
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by title, tag, language…"
          className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none dark:border-zinc-700"
        />
      </div>

      <nav aria-label="Snippets" className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {visible === undefined ? null : visible.length === 0 ? (
          <p className="px-2 py-4 text-sm text-zinc-500">
            {snippets?.length ? 'No snippets match your filter.' : 'No snippets yet.'}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {visible.map((snippet) => (
              <li key={snippet.id}>
                <Link
                  to="/s/$snippetId"
                  params={{ snippetId: snippet.id }}
                  className="block rounded-md px-2 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  activeProps={{
                    className: 'bg-indigo-50 hover:bg-indigo-50 dark:bg-indigo-500/15',
                    'aria-current': 'page',
                  }}
                >
                  <div className="flex items-center gap-2">
                    <LanguageBadge language={snippet.language} />
                    <span className="truncate text-sm font-medium">
                      {snippet.title || 'Untitled'}
                    </span>
                  </div>
                  <div className="mt-1 truncate pl-0.5 text-xs text-zinc-500">
                    {formatRelativeTime(snippet.updatedAt)}
                    {snippet.tags.length > 0 && ` · ${snippet.tags.map((t) => `#${t}`).join(' ')}`}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </nav>
    </aside>
  )
}
