import { z } from 'zod'
import type { Folder, Snippet } from '../db/schema'

/** URL search params that select what the snippet list shows. Invalid values are dropped. */
export const librarySearchSchema = z.object({
  view: z.enum(['favorites', 'recent', 'trash']).optional().catch(undefined),
  folder: z.string().min(1).max(100).optional().catch(undefined),
  tag: z.string().min(1).max(50).optional().catch(undefined),
})
export type LibrarySearch = z.infer<typeof librarySearchSchema>

export type LibraryFilter =
  | { kind: 'all' }
  | { kind: 'favorites' }
  | { kind: 'recent' }
  | { kind: 'trash' }
  | { kind: 'folder'; id: string }
  | { kind: 'tag'; tag: string }

export const RECENT_LIMIT = 20

export function toFilter(search: LibrarySearch): LibraryFilter {
  if (search.folder) return { kind: 'folder', id: search.folder }
  if (search.tag) return { kind: 'tag', tag: search.tag }
  if (search.view) return { kind: search.view }
  return { kind: 'all' }
}

export function toSearch(filter: LibraryFilter): LibrarySearch {
  switch (filter.kind) {
    case 'all':
      return {}
    case 'folder':
      return { folder: filter.id }
    case 'tag':
      return { tag: filter.tag }
    default:
      return { view: filter.kind }
  }
}

export function sameFilter(a: LibraryFilter, b: LibraryFilter): boolean {
  return JSON.stringify(toSearch(a)) === JSON.stringify(toSearch(b))
}

export function filterTitle(filter: LibraryFilter, folders: readonly Folder[]): string {
  switch (filter.kind) {
    case 'all':
      return 'All snippets'
    case 'favorites':
      return 'Favorites'
    case 'recent':
      return 'Recent'
    case 'trash':
      return 'Trash'
    case 'folder':
      return folders.find((f) => f.id === filter.id)?.name ?? 'Folder'
    case 'tag':
      return `#${filter.tag}`
  }
}

const byNewest = (key: 'updatedAt' | 'deletedAt' | 'lastOpenedAt') => (a: Snippet, b: Snippet) =>
  (b[key] ?? 0) - (a[key] ?? 0)

/** The snippets a view shows, in display order. Only the Trash shows trashed snippets. */
export function applyFilter(snippets: readonly Snippet[], filter: LibraryFilter): Snippet[] {
  if (filter.kind === 'trash') {
    return snippets.filter((s) => s.deletedAt !== null).sort(byNewest('deletedAt'))
  }
  const active = snippets.filter((s) => s.deletedAt === null)
  switch (filter.kind) {
    case 'all':
      return active.sort(byNewest('updatedAt'))
    case 'favorites':
      return active.filter((s) => s.favorite).sort(byNewest('updatedAt'))
    case 'recent':
      return active
        .filter((s) => s.lastOpenedAt !== null)
        .sort(byNewest('lastOpenedAt'))
        .slice(0, RECENT_LIMIT)
    case 'folder':
      return active.filter((s) => s.folderId === filter.id).sort(byNewest('updatedAt'))
    case 'tag':
      return active.filter((s) => s.tags.includes(filter.tag)).sort(byNewest('updatedAt'))
  }
}

export interface LibraryCounts {
  all: number
  favorites: number
  trash: number
  folders: Map<string, number>
  tags: { tag: string; count: number }[]
}

/** Counts for the navigation: active snippets per view, folder (direct) and tag. */
export function libraryCounts(snippets: readonly Snippet[]): LibraryCounts {
  const folders = new Map<string, number>()
  const tags = new Map<string, number>()
  let all = 0
  let favorites = 0
  let trash = 0
  for (const s of snippets) {
    if (s.deletedAt !== null) {
      trash++
      continue
    }
    all++
    if (s.favorite) favorites++
    if (s.folderId !== null) folders.set(s.folderId, (folders.get(s.folderId) ?? 0) + 1)
    for (const tag of s.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1)
  }
  return {
    all,
    favorites,
    trash,
    folders,
    tags: [...tags]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => a.tag.localeCompare(b.tag)),
  }
}
