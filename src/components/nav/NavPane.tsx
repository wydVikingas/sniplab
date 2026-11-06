import { Link } from '@tanstack/react-router'
import { Clock, Files, Hash, Star, Trash2, type LucideIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useAllSnippets, useFolders } from '../../db/hooks'
import { moveToTrash, setFavorite } from '../../db/snippets'
import { SNIPPET_MIME, dragKind } from '../../lib/dnd'
import { libraryCounts, sameFilter, type LibraryFilter } from '../../lib/libraryFilter'
import { useLibraryFilter, useShowView } from '../../lib/useLibrary'
import { FolderTree } from './FolderTree'

interface NavItemProps {
  icon: LucideIcon
  label: string
  count?: number
  active: boolean
  onClick(): void
  /** Called with a snippet id dropped onto this item. */
  onSnippetDrop?(id: string): void
}

function NavItem({ icon: Icon, label, count, active, onClick, onSnippetDrop }: NavItemProps) {
  const [dropping, setDropping] = useState(false)
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      onDragOver={(e) => {
        if (!onSnippetDrop || dragKind(e) !== 'snippet') return
        e.preventDefault()
        setDropping(true)
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        setDropping(false)
        const id = e.dataTransfer.getData(SNIPPET_MIME)
        if (onSnippetDrop && id) {
          e.preventDefault()
          onSnippetDrop(id)
        }
      }}
      className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm ${
        active
          ? 'bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'
          : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
      } ${dropping ? 'bg-indigo-100 dark:bg-indigo-500/20' : ''}`}
    >
      <Icon size={15} className={active ? '' : 'text-zinc-500'} />
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="text-xs text-zinc-500 tabular-nums">{count}</span>
      )}
    </button>
  )
}

/** Library navigation: views, folders and tags. */
export function NavPane({ onNavigate }: { onNavigate?: () => void }) {
  const snippets = useAllSnippets()
  const folders = useFolders()
  const filter = useLibraryFilter()
  const showView = useShowView()
  const counts = useMemo(() => libraryCounts(snippets ?? []), [snippets])

  const show = (next: LibraryFilter) => {
    void showView(next)
    onNavigate?.()
  }
  const item = (next: LibraryFilter) => ({
    active: sameFilter(filter, next),
    onClick: () => show(next),
  })

  return (
    <nav aria-label="Library" className="flex h-full flex-col overflow-y-auto px-2 py-3">
      <Link
        to="/"
        search={{}}
        onClick={onNavigate}
        className="mb-3 px-2 text-lg font-bold tracking-tight"
      >
        SnipLab
      </Link>

      <NavItem icon={Files} label="All snippets" count={counts.all} {...item({ kind: 'all' })} />
      <NavItem
        icon={Star}
        label="Favorites"
        count={counts.favorites}
        {...item({ kind: 'favorites' })}
        onSnippetDrop={(id) => void setFavorite(id, true)}
      />
      <NavItem icon={Clock} label="Recent" {...item({ kind: 'recent' })} />
      <NavItem
        icon={Trash2}
        label="Trash"
        count={counts.trash}
        {...item({ kind: 'trash' })}
        onSnippetDrop={(id) => void moveToTrash(id)}
      />

      <FolderTree
        folders={folders ?? []}
        counts={counts.folders}
        activeFolderId={filter.kind === 'folder' ? filter.id : null}
        onSelect={(id) => show(id === null ? { kind: 'all' } : { kind: 'folder', id })}
      />

      <section aria-labelledby="tags-heading" className="mt-4">
        <h2
          id="tags-heading"
          className="px-2 py-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase"
        >
          Tags
        </h2>
        {counts.tags.length === 0 ? (
          <p className="px-2 py-1 text-xs text-zinc-500">No tags yet.</p>
        ) : (
          counts.tags.map(({ tag, count }) => (
            <NavItem
              key={tag}
              icon={Hash}
              label={tag}
              count={count}
              {...item({ kind: 'tag', tag })}
            />
          ))
        )}
      </section>
    </nav>
  )
}
