import { describe, expect, it } from 'vitest'
import type { Folder } from '../db/schema'
import {
  buildFolderTree,
  descendantIds,
  dropDestination,
  dropPositionAt,
  flattenTree,
  folderPath,
} from './folderTree'

const folder = (id: string, parentId: string | null, order: number, name = id): Folder => ({
  id,
  name,
  parentId,
  order,
  createdAt: 0,
})

const folders = [
  folder('b', null, 1),
  folder('a', null, 0),
  folder('a2', 'a', 1),
  folder('a1', 'a', 0),
  folder('a1x', 'a1', 0),
]

const names = (nodes: ReturnType<typeof flattenTree>) =>
  nodes.map((n) => `${'-'.repeat(n.depth)}${n.folder.id}`)

describe('folderTree', () => {
  it('builds a sorted, nested tree', () => {
    expect(names(flattenTree(buildFolderTree(folders)))).toEqual(['a', '-a1', '--a1x', '-a2', 'b'])
  })

  it('hides children of collapsed folders when flattening', () => {
    expect(names(flattenTree(buildFolderTree(folders), new Set(['a1'])))).toEqual([
      'a',
      '-a1',
      '-a2',
      'b',
    ])
  })

  it('treats orphans as top-level and survives cycles', () => {
    const broken = [folder('orphan', 'missing', 0), folder('x', 'y', 0), folder('y', 'x', 1)]
    const flat = flattenTree(buildFolderTree(broken)).map((n) => n.folder.id)
    expect(flat.sort()).toEqual(['orphan', 'x', 'y'])
  })

  it('finds descendants and paths', () => {
    expect([...descendantIds(folders, 'a')].sort()).toEqual(['a', 'a1', 'a1x', 'a2'])
    expect(folderPath(folders, 'a1x').map((f) => f.id)).toEqual(['a', 'a1', 'a1x'])
  })

  it('maps pointer position to a drop position', () => {
    expect(dropPositionAt(2, 20)).toBe('before')
    expect(dropPositionAt(10, 20)).toBe('inside')
    expect(dropPositionAt(18, 20)).toBe('after')
  })

  it('translates drops into move destinations', () => {
    const a2 = folders.find((f) => f.id === 'a2')!
    expect(dropDestination(folders, a2, 'before')).toEqual({ parentId: 'a', index: 1 })
    expect(dropDestination(folders, a2, 'after')).toEqual({ parentId: 'a', index: 2 })
    expect(dropDestination(folders, a2, 'inside')).toEqual({
      parentId: 'a2',
      index: Number.MAX_SAFE_INTEGER,
    })
  })
})
