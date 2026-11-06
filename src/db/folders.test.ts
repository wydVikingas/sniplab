import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { createFolder, deleteFolder, moveFolder, renameFolder } from './folders'
import { createSnippet, moveSnippet } from './snippets'

async function tree(): Promise<string[]> {
  const folders = await db.folders.toArray()
  const label = (id: string | null): string => {
    if (id === null) return ''
    const f = folders.find((x) => x.id === id)!
    return `${label(f.parentId)}/${f.name}`
  }
  return folders
    .sort((a, b) => a.order - b.order)
    .map((f) => `${label(f.id)}#${f.order}`)
    .sort()
}

describe('folders', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()))
  })

  it('creates folders in order and nests them', async () => {
    const a = await createFolder('A')
    await createFolder('B')
    await createFolder('A1', a.id)
    expect(await tree()).toEqual(['/A#0', '/A/A1#0', '/B#1'])
    await expect(createFolder('x', 'missing')).rejects.toThrow(/not found/)
  })

  it('renames with validation', async () => {
    const a = await createFolder('A')
    await renameFolder(a.id, 'Algorithms')
    expect((await db.folders.get(a.id))?.name).toBe('Algorithms')
    await expect(renameFolder(a.id, '   ')).rejects.toThrow()
  })

  it('reorders siblings and moves folders between parents', async () => {
    const a = await createFolder('A')
    const b = await createFolder('B')
    const c = await createFolder('C')
    await moveFolder(c.id, null, 0)
    expect(await tree()).toEqual(['/A#1', '/B#2', '/C#0'])
    await moveFolder(b.id, a.id, 0)
    expect(await tree()).toEqual(['/A#1', '/A/B#0', '/C#0'])
  })

  it('refuses to move a folder into itself or a descendant', async () => {
    const a = await createFolder('A')
    const a1 = await createFolder('A1', a.id)
    await expect(moveFolder(a.id, a1.id, 0)).rejects.toThrow(/itself/)
    await expect(moveFolder(a.id, a.id, 0)).rejects.toThrow(/itself/)
  })

  it('deleting a folder moves its snippets and subfolders up a level', async () => {
    const a = await createFolder('A')
    const b = await createFolder('B', a.id)
    await createFolder('C', b.id)
    const snippet = await createSnippet()
    await moveSnippet(snippet.id, b.id)

    await deleteFolder(b.id)
    expect(await tree()).toEqual(['/A#0', '/A/C#0'])
    expect((await db.snippets.get(snippet.id))?.folderId).toBe(a.id)
  })
})
