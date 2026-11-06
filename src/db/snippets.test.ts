import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from './db'
import { snippetSchema } from './schema'
import {
  DEFAULT_TITLE,
  createSnippet,
  getSnippet,
  listSnippets,
  moveToTrash,
  updateSnippet,
} from './snippets'

describe('snippet repository', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()))
    // Fake only Date so IndexedDB's internal timers keep working.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_000)
  })
  afterEach(() => vi.useRealTimers())

  it('creates a valid snippet with sensible defaults', async () => {
    const snippet = await createSnippet()
    expect(snippetSchema.parse(snippet)).toEqual(snippet)
    expect(snippet).toMatchObject({
      title: DEFAULT_TITLE,
      language: 'javascript',
      tags: [],
      favorite: false,
      deletedAt: null,
      createdAt: 1_000,
      updatedAt: 1_000,
    })
    expect(await getSnippet(snippet.id)).toEqual(snippet)
  })

  it('uses the starter code of the requested language and normalizes tags', async () => {
    const snippet = await createSnippet({ language: 'python', tags: ['Algo', 'algo'] })
    expect(snippet.code).toContain('print(')
    expect(snippet.tags).toEqual(['algo'])
  })

  it('updates fields, normalizes tags and bumps updatedAt', async () => {
    const { id } = await createSnippet()
    vi.setSystemTime(2_000)
    await updateSnippet(id, { title: 'Quicksort', code: 'x', tags: [' Sorting '] })
    expect(await getSnippet(id)).toMatchObject({
      title: 'Quicksort',
      code: 'x',
      tags: ['sorting'],
      createdAt: 1_000,
      updatedAt: 2_000,
    })
  })

  it('rejects invalid patches', async () => {
    const { id } = await createSnippet()
    // @ts-expect-error — invalid language on purpose
    await expect(updateSnippet(id, { language: 'ruby' })).rejects.toThrow()
    // @ts-expect-error — repository-managed fields can't be patched
    await expect(updateSnippet(id, { createdAt: 0 })).rejects.toThrow()
  })

  it('throws when updating a missing snippet', async () => {
    await expect(updateSnippet('nope', { title: 'x' })).rejects.toThrow(/not found/)
  })

  it('lists active snippets most recently updated first', async () => {
    const a = await createSnippet({ title: 'a' })
    vi.setSystemTime(2_000)
    const b = await createSnippet({ title: 'b' })
    vi.setSystemTime(3_000)
    await updateSnippet(a.id, { title: 'a2' })
    expect((await listSnippets()).map((s) => s.id)).toEqual([a.id, b.id])
  })

  it('moveToTrash hides the snippet but keeps the record', async () => {
    const { id } = await createSnippet()
    await moveToTrash(id)
    expect(await getSnippet(id)).toBeUndefined()
    expect(await listSnippets()).toEqual([])
    expect((await db.snippets.get(id))?.deletedAt).toBe(1_000)
  })
})
