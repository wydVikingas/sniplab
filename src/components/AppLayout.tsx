import { Outlet } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useColorScheme } from '../lib/useColorScheme'
import { NavPane } from './nav/NavPane'
import { SnippetList } from './SnippetList'

/** Below `lg` the library nav lives in a modal drawer. */
function NavDrawer({ onClose }: { onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])
  return (
    <dialog
      ref={ref}
      aria-label="Library"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose() // backdrop click
      }}
      className="m-0 h-dvh max-h-dvh w-72 max-w-[85vw] bg-white p-0 text-zinc-900 backdrop:bg-black/40 dark:bg-zinc-900 dark:text-zinc-100"
    >
      <NavPane onNavigate={onClose} />
    </dialog>
  )
}

export function AppLayout() {
  useColorScheme()
  const [navOpen, setNavOpen] = useState(false)
  return (
    <div className="flex h-full flex-col bg-zinc-50 text-zinc-900 md:flex-row dark:bg-zinc-950 dark:text-zinc-100">
      <aside className="hidden w-56 shrink-0 border-r border-zinc-200 bg-zinc-50 lg:block dark:border-zinc-800 dark:bg-zinc-950">
        <NavPane />
      </aside>
      {navOpen && <NavDrawer onClose={() => setNavOpen(false)} />}
      <SnippetList onOpenNav={() => setNavOpen(true)} />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  )
}
