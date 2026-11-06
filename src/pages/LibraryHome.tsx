import { useSnippets } from '../db/hooks'
import { useCreateSnippet } from '../lib/useLibrary'

export function LibraryHome() {
  const snippets = useSnippets()
  const createSnippet = useCreateSnippet()

  if (snippets === undefined) return null

  const isEmpty = snippets.length === 0
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">
        {isEmpty ? 'Your snippet library is empty' : 'Pick a snippet'}
      </h1>
      <p className="max-w-md text-zinc-500 dark:text-zinc-400">
        {isEmpty
          ? 'Create your first snippet to start building your library.'
          : 'Select a snippet from the sidebar, or create a new one.'}
      </p>
      <button
        type="button"
        onClick={() => void createSnippet()}
        className="mt-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
      >
        Create a snippet
      </button>
    </div>
  )
}
