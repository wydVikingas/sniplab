import {
  ChevronDown,
  ChevronRight,
  Folder as FolderIcon,
  FolderOpen,
  MoreHorizontal,
  Plus,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createFolder, deleteFolder, moveFolder, renameFolder } from '../../db/folders'
import type { Folder } from '../../db/schema'
import { moveSnippet } from '../../db/snippets'
import { FOLDER_MIME, SNIPPET_MIME, dragKind, startDrag } from '../../lib/dnd'
import {
  buildFolderTree,
  dropDestination,
  dropPositionAt,
  flattenTree,
  type DropPosition,
} from '../../lib/folderTree'
import { ConfirmDialog } from '../ConfirmDialog'
import { Menu } from '../Menu'

const COLLAPSED_KEY = 'sniplab:collapsed-folders'

function loadCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

export interface FolderTreeProps {
  folders: Folder[]
  counts: ReadonlyMap<string, number>
  activeFolderId: string | null
  /** Show a folder's snippets; `null` means all snippets. */
  onSelect(folderId: string | null): void
}

export function FolderTree({ folders, counts, activeFolderId, onSelect }: FolderTreeProps) {
  const tree = useMemo(() => buildFolderTree(folders), [folders])
  const [collapsed, setCollapsed] = useState(loadCollapsed)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Folder | null>(null)
  const [dropTarget, setDropTarget] = useState<{
    id: string | null
    position: DropPosition
  } | null>(null)
  const rows = flattenTree(tree, collapsed)

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]))
    } catch {
      // Not persisted; fine.
    }
  }, [collapsed])

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const addFolder = async (parentId: string | null) => {
    const folder = await createFolder('New folder', parentId)
    if (parentId) setCollapsed((prev) => new Set([...prev].filter((id) => id !== parentId)))
    setEditingId(folder.id)
  }

  const commitRename = async (folder: Folder, name: string) => {
    setEditingId(null)
    const trimmed = name.trim()
    if (trimmed && trimmed !== folder.name) await renameFolder(folder.id, trimmed)
  }

  const handleDrop = async (e: React.DragEvent, target: Folder | null) => {
    e.preventDefault()
    const position = dropTarget?.position ?? 'inside'
    setDropTarget(null)
    const snippetId = e.dataTransfer.getData(SNIPPET_MIME)
    const folderId = e.dataTransfer.getData(FOLDER_MIME)
    try {
      if (snippetId) {
        await moveSnippet(snippetId, target?.id ?? null)
      } else if (folderId && folderId !== target?.id) {
        const dest = target
          ? dropDestination(folders, target, position)
          : { parentId: null, index: Number.MAX_SAFE_INTEGER }
        await moveFolder(folderId, dest.parentId, dest.index)
      }
    } catch (error) {
      // e.g. dropping a folder into its own subfolder: nothing to do.
      console.warn(error)
    }
  }

  const dropClass = (id: string | null) => {
    if (dropTarget?.id !== id) return ''
    if (dropTarget.position === 'before') return 'shadow-[inset_0_2px_0_0] shadow-indigo-500'
    if (dropTarget.position === 'after') return 'shadow-[inset_0_-2px_0_0] shadow-indigo-500'
    return 'bg-indigo-100 dark:bg-indigo-500/20'
  }

  return (
    <section aria-labelledby="folders-heading" className="mt-4">
      <div
        className={`flex items-center justify-between rounded px-2 py-1 ${dropClass(null)}`}
        onDragOver={(e) => {
          if (!dragKind(e)) return
          e.preventDefault()
          setDropTarget({ id: null, position: 'inside' })
        }}
        onDragLeave={() => setDropTarget(null)}
        onDrop={(e) => void handleDrop(e, null)}
      >
        <h2
          id="folders-heading"
          className="text-xs font-semibold tracking-wide text-zinc-500 uppercase"
        >
          Folders
        </h2>
        <button
          type="button"
          aria-label="New folder"
          title="New folder"
          onClick={() => void addFolder(null)}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
        >
          <Plus size={14} />
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="px-2 py-1 text-xs text-zinc-500">No folders yet.</p>
      ) : (
        <ul>
          {rows.map(({ folder, depth, children }) => {
            const isCollapsed = collapsed.has(folder.id)
            const active = folder.id === activeFolderId
            const count = counts.get(folder.id) ?? 0
            return (
              <li key={folder.id}>
                <div
                  draggable={editingId !== folder.id}
                  onDragStart={(e) => startDrag(e, FOLDER_MIME, folder.id)}
                  onDragOver={(e) => {
                    const kind = dragKind(e)
                    if (!kind) return
                    e.preventDefault()
                    const rect = e.currentTarget.getBoundingClientRect()
                    const position =
                      kind === 'snippet'
                        ? 'inside'
                        : dropPositionAt(e.clientY - rect.top, rect.height)
                    setDropTarget({ id: folder.id, position })
                  }}
                  onDragLeave={() => setDropTarget(null)}
                  onDrop={(e) => void handleDrop(e, folder)}
                  className={`group flex items-center gap-1 rounded py-0.5 pr-1 text-sm ${
                    active
                      ? 'bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'
                      : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  } ${dropClass(folder.id)}`}
                  style={{ paddingLeft: 4 + depth * 14 }}
                >
                  <button
                    type="button"
                    aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${folder.name}`}
                    aria-expanded={!isCollapsed}
                    onClick={() => toggle(folder.id)}
                    className={`rounded p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 ${children.length === 0 ? 'invisible' : ''}`}
                  >
                    {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  </button>
                  {editingId === folder.id ? (
                    <input
                      aria-label="Folder name"
                      defaultValue={folder.name}
                      autoFocus
                      maxLength={100}
                      onFocus={(e) => e.currentTarget.select()}
                      onBlur={(e) => void commitRename(folder, e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur()
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      className="min-w-0 flex-1 rounded border border-indigo-500 bg-white px-1 text-sm text-zinc-900 focus:outline-none dark:bg-zinc-900 dark:text-zinc-100"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSelect(folder.id)}
                      onDoubleClick={() => setEditingId(folder.id)}
                      aria-current={active ? 'page' : undefined}
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    >
                      {active ? (
                        <FolderOpen size={14} className="shrink-0" />
                      ) : (
                        <FolderIcon size={14} className="shrink-0 text-zinc-500" />
                      )}
                      <span className="truncate">{folder.name}</span>
                    </button>
                  )}
                  {count > 0 && <span className="text-xs text-zinc-500 tabular-nums">{count}</span>}
                  <Menu
                    label={`Actions for ${folder.name}`}
                    trigger={<MoreHorizontal size={14} />}
                    className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                    items={[
                      { label: 'New subfolder', onSelect: () => void addFolder(folder.id) },
                      { label: 'Rename', onSelect: () => setEditingId(folder.id) },
                      { label: 'Delete', danger: true, onSelect: () => setDeleting(folder) },
                    ]}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Delete folder?"
        message={`"${deleting?.name ?? ''}" will be removed. Its snippets and subfolders move up one level — nothing is deleted.`}
        confirmLabel="Delete folder"
        onConfirm={() => {
          if (deleting) {
            void deleteFolder(deleting.id)
            // Viewing the deleted folder: show where its snippets went.
            if (deleting.id === activeFolderId) onSelect(deleting.parentId)
          }
          setDeleting(null)
        }}
        onCancel={() => setDeleting(null)}
      />
    </section>
  )
}
