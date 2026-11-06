import { normalizeTags } from '../lib/tags'
import { LANGUAGE_INFO } from '../lib/languages'
import { db } from './db'
import {
  DEFAULT_TIMEOUT_MS,
  snippetPatchSchema,
  snippetSchema,
  type Snippet,
  type SnippetPatch,
} from './schema'

export const DEFAULT_TITLE = 'Untitled snippet'

export function buildSnippet(patch: SnippetPatch = {}, now = Date.now()): Snippet {
  const language = patch.language ?? 'javascript'
  return snippetSchema.parse({
    id: crypto.randomUUID(),
    title: DEFAULT_TITLE,
    description: '',
    code: LANGUAGE_INFO[language].starter,
    folderId: null,
    favorite: false,
    runSettings: { timeoutMs: DEFAULT_TIMEOUT_MS, allowNetwork: false, stdin: '' },
    ...patch,
    tags: normalizeTags(patch.tags ?? []),
    language,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    lastOpenedAt: null,
  })
}

export async function createSnippet(patch: SnippetPatch = {}): Promise<Snippet> {
  const snippet = buildSnippet(snippetPatchSchema.parse(patch))
  await db.snippets.add(snippet)
  return snippet
}

export async function getSnippet(id: string): Promise<Snippet | undefined> {
  const snippet = await db.snippets.get(id)
  return snippet && snippet.deletedAt === null ? snippet : undefined
}

/** Active (not trashed) snippets, most recently updated first. */
export async function listSnippets(): Promise<Snippet[]> {
  const all = await db.snippets.orderBy('updatedAt').reverse().toArray()
  return all.filter((s) => s.deletedAt === null)
}

/** Edit a snippet's content or settings; bumps `updatedAt`. */
export async function updateSnippet(id: string, patch: SnippetPatch): Promise<void> {
  const parsed = snippetPatchSchema.parse(patch)
  if (parsed.tags) parsed.tags = normalizeTags(parsed.tags)
  const changed = await db.snippets.update(id, { ...parsed, updatedAt: Date.now() })
  if (changed === 0) throw new Error(`Snippet not found: ${id}`)
}

/** Organizational changes (below) don't bump `updatedAt`: they aren't content edits. */
async function organize(id: string, changes: Partial<Snippet>): Promise<void> {
  const changed = await db.snippets.update(id, changes)
  if (changed === 0) throw new Error(`Snippet not found: ${id}`)
}

export const setFavorite = (id: string, favorite: boolean) => organize(id, { favorite })

export async function moveSnippet(id: string, folderId: string | null): Promise<void> {
  if (folderId !== null && !(await db.folders.get(folderId))) {
    throw new Error(`Folder not found: ${folderId}`)
  }
  await organize(id, { folderId })
}

export const markOpened = (id: string) => organize(id, { lastOpenedAt: Date.now() })

export const moveToTrash = (id: string) => organize(id, { deletedAt: Date.now() })

/** Take a snippet out of the Trash; if its folder is gone, it lands at the top level. */
export async function restoreFromTrash(id: string): Promise<void> {
  await db.transaction('rw', db.snippets, db.folders, async () => {
    const snippet = await db.snippets.get(id)
    if (!snippet) throw new Error(`Snippet not found: ${id}`)
    const folderExists = snippet.folderId !== null && (await db.folders.get(snippet.folderId))
    await db.snippets.update(id, {
      deletedAt: null,
      folderId: folderExists ? snippet.folderId : null,
    })
  })
}

/** Permanently delete snippets and their version history. */
export async function deleteForever(ids: string[]): Promise<void> {
  await db.transaction('rw', db.snippets, db.versions, async () => {
    await db.versions.where('snippetId').anyOf(ids).delete()
    await db.snippets.bulkDelete(ids)
  })
}

export async function emptyTrash(): Promise<number> {
  const trashed = await db.snippets.filter((s) => s.deletedAt !== null).primaryKeys()
  await deleteForever(trashed)
  return trashed.length
}
