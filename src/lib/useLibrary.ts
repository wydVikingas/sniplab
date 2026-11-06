import { useNavigate, useSearch } from '@tanstack/react-router'
import { useCallback, useMemo } from 'react'
import { createSnippet } from '../db/snippets'
import type { SnippetPatch } from '../db/schema'
import { toFilter, toSearch, type LibraryFilter } from './libraryFilter'

/** The view the snippet list currently shows, from the URL. */
export function useLibraryFilter(): LibraryFilter {
  const search = useSearch({ from: '__root__' })
  return useMemo(() => toFilter(search), [search])
}

/** Switch the list to another view, keeping the open snippet (if any). */
export function useShowView() {
  const navigate = useNavigate()
  return useCallback(
    (filter: LibraryFilter) => navigate({ to: '.', search: toSearch(filter) }),
    [navigate],
  )
}

/**
 * Creates a snippet that fits the current view (in the open folder, with the open tag,
 * favorited in Favorites) and opens it.
 */
export function useCreateSnippet() {
  const navigate = useNavigate()
  const filter = useLibraryFilter()
  return useCallback(async () => {
    const patch: SnippetPatch =
      filter.kind === 'folder'
        ? { folderId: filter.id }
        : filter.kind === 'tag'
          ? { tags: [filter.tag] }
          : filter.kind === 'favorites'
            ? { favorite: true }
            : {}
    const snippet = await createSnippet(patch)
    // Trash/Recent wouldn't list the new snippet, so fall back to All.
    const keepView = filter.kind !== 'trash' && filter.kind !== 'recent'
    await navigate({
      to: '/s/$snippetId',
      params: { snippetId: snippet.id },
      search: keepView ? toSearch(filter) : {},
    })
  }, [navigate, filter])
}
