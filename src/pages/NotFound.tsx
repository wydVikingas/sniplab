import { Link } from '@tanstack/react-router'

export function NotFound({ message = 'This page does not exist.' }: { message?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Not found</h1>
      <p className="text-zinc-500 dark:text-zinc-400">{message}</p>
      <Link to="/" className="text-sm font-medium text-indigo-600 hover:underline">
        Back to library
      </Link>
    </div>
  )
}
