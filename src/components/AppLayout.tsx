import { Outlet } from '@tanstack/react-router'
import { useColorScheme } from '../lib/useColorScheme'
import { Sidebar } from './Sidebar'

export function AppLayout() {
  useColorScheme()
  return (
    <div className="flex h-full flex-col bg-zinc-50 text-zinc-900 md:flex-row dark:bg-zinc-950 dark:text-zinc-100">
      <Sidebar />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  )
}
