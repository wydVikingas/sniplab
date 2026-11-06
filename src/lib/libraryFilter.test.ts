import { describe, expect, it } from 'vitest'
import { buildSnippet } from '../db/snippets'
import type { Snippet, SnippetPatch } from '../db/schema'
import {
  RECENT_LIMIT,
  applyFilter,
  libraryCounts,
  librarySearchSchema,
  toFilter,
  toSearch,
  type LibraryFilter,
} from './libraryFilter'

function snippet(
  title: string,
  patch: SnippetPatch = {},
  extra: Partial<Pick<Snippet, 'updatedAt' | 'deletedAt' | 'lastOpenedAt'>> = {},
): Snippet {
  return { ...buildSnippet({ title, ...patch }, 0), ...extra }
}

const titles = (list: Snippet[]) => list.map((s) => s.title)

describe('library search params', () => {
  it('round-trips filters', () => {
    const filters: LibraryFilter[] = [
      { kind: 'all' },
      { kind: 'favorites' },
      { kind: 'recent' },
      { kind: 'trash' },
      { kind: 'folder', id: 'f1' },
      { kind: 'tag', tag: 'math' },
    ]
    for (const filter of filters) expect(toFilter(toSearch(filter))).toEqual(filter)
  })

  it('drops invalid values instead of failing', () => {
    expect(librarySearchSchema.parse({ view: 'bogus', folder: '', tag: 'ok' })).toEqual({
      tag: 'ok',
    })
  })
})

describe('applyFilter', () => {
  const old = snippet('old', { tags: ['math'] }, { updatedAt: 1 })
  const fav = snippet('fav', { favorite: true, folderId: 'f1' }, { updatedAt: 3, lastOpenedAt: 5 })
  const mid = snippet('mid', { folderId: 'f1', tags: ['math'] }, { updatedAt: 2, lastOpenedAt: 9 })
  const trashed = snippet('trashed', { favorite: true, tags: ['math'] }, { deletedAt: 7 })
  const all = [old, fav, mid, trashed]

  it('shows active snippets, newest first', () => {
    expect(titles(applyFilter(all, { kind: 'all' }))).toEqual(['fav', 'mid', 'old'])
  })

  it('filters favorites, folders and tags without trashed snippets', () => {
    expect(titles(applyFilter(all, { kind: 'favorites' }))).toEqual(['fav'])
    expect(titles(applyFilter(all, { kind: 'folder', id: 'f1' }))).toEqual(['fav', 'mid'])
    expect(titles(applyFilter(all, { kind: 'tag', tag: 'math' }))).toEqual(['mid', 'old'])
  })

  it('lists recently opened snippets, capped', () => {
    expect(titles(applyFilter(all, { kind: 'recent' }))).toEqual(['mid', 'fav'])
    const many = Array.from({ length: 30 }, (_, i) => snippet(`s${i}`, {}, { lastOpenedAt: i + 1 }))
    expect(applyFilter(many, { kind: 'recent' })).toHaveLength(RECENT_LIMIT)
  })

  it('shows only trashed snippets in the Trash', () => {
    expect(titles(applyFilter(all, { kind: 'trash' }))).toEqual(['trashed'])
  })

  it('counts views, folders and tags', () => {
    const counts = libraryCounts(all)
    expect(counts).toMatchObject({ all: 3, favorites: 1, trash: 1 })
    expect(counts.folders.get('f1')).toBe(2)
    expect(counts.tags).toEqual([{ tag: 'math', count: 2 }])
  })
})
