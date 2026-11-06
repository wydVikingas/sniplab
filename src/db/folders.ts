import { descendantIds } from '../lib/folderTree'
import { db } from './db'
import { folderSchema, type Folder } from './schema'

async function siblingsOf(parentId: string | null, exceptId?: string): Promise<Folder[]> {
  const all = await db.folders.toArray()
  return all
    .filter((f) => f.parentId === parentId && f.id !== exceptId)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
}

export async function createFolder(name: string, parentId: string | null = null): Promise<Folder> {
  return db.transaction('rw', db.folders, async () => {
    if (parentId !== null && !(await db.folders.get(parentId))) {
      throw new Error(`Folder not found: ${parentId}`)
    }
    const siblings = await siblingsOf(parentId)
    const folder = folderSchema.parse({
      id: crypto.randomUUID(),
      name,
      parentId,
      order: (siblings.at(-1)?.order ?? -1) + 1,
      createdAt: Date.now(),
    })
    await db.folders.add(folder)
    return folder
  })
}

export async function renameFolder(id: string, name: string): Promise<void> {
  const parsed = folderSchema.shape.name.parse(name)
  const changed = await db.folders.update(id, { name: parsed })
  if (changed === 0) throw new Error(`Folder not found: ${id}`)
}

/**
 * Move a folder under `parentId` (null = top level) at position `index` among its new
 * siblings. Refuses to move a folder into itself or one of its descendants.
 */
export async function moveFolder(
  id: string,
  parentId: string | null,
  index: number,
): Promise<void> {
  await db.transaction('rw', db.folders, async () => {
    const all = await db.folders.toArray()
    if (!all.some((f) => f.id === id)) throw new Error(`Folder not found: ${id}`)
    if (parentId !== null) {
      if (!all.some((f) => f.id === parentId)) throw new Error(`Folder not found: ${parentId}`)
      if (descendantIds(all, id).has(parentId)) {
        throw new Error('A folder cannot be moved into itself')
      }
    }
    const siblings = await siblingsOf(parentId, id)
    const position = Math.max(0, Math.min(index, siblings.length))
    const ordered = [...siblings.slice(0, position), { id }, ...siblings.slice(position)]
    await Promise.all(
      ordered.map((folder, order) =>
        db.folders.update(folder.id, folder.id === id ? { parentId, order } : { order }),
      ),
    )
  })
}

/** Delete a folder; its snippets and subfolders move up to its parent. */
export async function deleteFolder(id: string): Promise<void> {
  await db.transaction('rw', db.folders, db.snippets, async () => {
    const folder = await db.folders.get(id)
    if (!folder) return
    const children = (await db.folders.toArray())
      .filter((f) => f.parentId === id)
      .sort((a, b) => a.order - b.order)
    const lastOrder = (await siblingsOf(folder.parentId, id)).at(-1)?.order ?? -1
    await Promise.all(
      children.map((child, i) =>
        db.folders.update(child.id, { parentId: folder.parentId, order: lastOrder + 1 + i }),
      ),
    )
    await db.snippets.where('folderId').equals(id).modify({ folderId: folder.parentId })
    await db.folders.delete(id)
  })
}
