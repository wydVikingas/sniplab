import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import type { Folder, Snippet, SnippetVersion } from './schema'
import { listSnippets } from './snippets'
import { listVersions } from './versions'

/** Active snippets, newest first. `undefined` while loading. */
export function useSnippets(): Snippet[] | undefined {
  return useLiveQuery(listSnippets, [])
}

/** Every snippet, including trashed ones. `undefined` while loading. */
export function useAllSnippets(): Snippet[] | undefined {
  return useLiveQuery(() => db.snippets.toArray(), [])
}

/** `undefined` while loading, `null` if missing. Trashed snippets are returned too. */
export function useSnippet(id: string): Snippet | null | undefined {
  return useLiveQuery(async () => (await db.snippets.get(id)) ?? null, [id])
}

export function useFolders(): Folder[] | undefined {
  return useLiveQuery(() => db.folders.toArray(), [])
}

export function useVersions(snippetId: string): SnippetVersion[] | undefined {
  return useLiveQuery(() => listVersions(snippetId), [snippetId])
}
