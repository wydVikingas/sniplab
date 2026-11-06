import { useLiveQuery } from 'dexie-react-hooks'
import type { Snippet } from './schema'
import { getSnippet, listSnippets } from './snippets'

/** `undefined` while loading. */
export function useSnippets(): Snippet[] | undefined {
  return useLiveQuery(listSnippets, [])
}

/** `undefined` while loading, `null` if missing or trashed. */
export function useSnippet(id: string): Snippet | null | undefined {
  return useLiveQuery(async () => (await getSnippet(id)) ?? null, [id])
}
