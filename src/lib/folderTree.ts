import type { Folder } from '../db/schema'

export interface FolderNode {
  folder: Folder
  depth: number
  children: FolderNode[]
}

const byOrder = (a: Folder, b: Folder) => a.order - b.order || a.name.localeCompare(b.name)

/**
 * Build the folder tree. Folders whose parent is missing become top-level, and any
 * accidental cycle is broken (each folder appears exactly once).
 */
export function buildFolderTree(folders: readonly Folder[]): FolderNode[] {
  const ids = new Set(folders.map((f) => f.id))
  const childrenOf = new Map<string | null, Folder[]>()
  for (const folder of folders) {
    const parent = folder.parentId !== null && ids.has(folder.parentId) ? folder.parentId : null
    const list = childrenOf.get(parent) ?? []
    list.push(folder)
    childrenOf.set(parent, list)
  }

  const placed = new Set<string>()
  const build = (parentId: string | null, depth: number): FolderNode[] =>
    (childrenOf.get(parentId) ?? [])
      .sort(byOrder)
      .filter((folder) => !placed.has(folder.id) && placed.add(folder.id))
      .map((folder) => ({ folder, depth, children: build(folder.id, depth + 1) }))

  const roots = build(null, 0)
  // Folders only reachable through a cycle: surface them at the top level.
  const stranded = folders.filter((f) => !placed.has(f.id)).sort(byOrder)
  for (const folder of stranded) {
    if (placed.has(folder.id)) continue
    placed.add(folder.id)
    roots.push({ folder, depth: 0, children: build(folder.id, 1) })
  }
  return roots
}

/** Depth-first list of nodes, e.g. for a <select>. Pass `collapsed` to skip their children. */
export function flattenTree(
  nodes: readonly FolderNode[],
  collapsed?: ReadonlySet<string>,
): FolderNode[] {
  return nodes.flatMap((node) => [
    node,
    ...(collapsed?.has(node.folder.id) ? [] : flattenTree(node.children, collapsed)),
  ])
}

/** The folder and everything nested inside it. */
export function descendantIds(folders: readonly Folder[], id: string): Set<string> {
  const result = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const folder of folders) {
      if (folder.parentId !== null && result.has(folder.parentId) && !result.has(folder.id)) {
        result.add(folder.id)
        grew = true
      }
    }
  }
  return result
}

/** Ancestors from the top level down to (and including) the folder. */
export function folderPath(folders: readonly Folder[], id: string): Folder[] {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const path: Folder[] = []
  let current = byId.get(id)
  while (current && !path.includes(current)) {
    path.unshift(current)
    current = current.parentId === null ? undefined : byId.get(current.parentId)
  }
  return path
}

export type DropPosition = 'before' | 'inside' | 'after'

/** Where a drop lands on a folder row, from the pointer's vertical position within it. */
export function dropPositionAt(offsetY: number, height: number): DropPosition {
  if (offsetY < height * 0.25) return 'before'
  if (offsetY > height * 0.75) return 'after'
  return 'inside'
}

/** Translate a drop on `target` into the (parentId, index) that moveFolder expects. */
export function dropDestination(
  folders: readonly Folder[],
  target: Folder,
  position: DropPosition,
): { parentId: string | null; index: number } {
  if (position === 'inside') {
    return { parentId: target.id, index: Number.MAX_SAFE_INTEGER }
  }
  const siblings = folders.filter((f) => f.parentId === target.parentId).sort(byOrder)
  const index = siblings.findIndex((f) => f.id === target.id)
  return { parentId: target.parentId, index: position === 'before' ? index : index + 1 }
}
