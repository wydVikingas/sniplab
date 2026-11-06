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

export async function updateSnippet(id: string, patch: SnippetPatch): Promise<void> {
  const parsed = snippetPatchSchema.parse(patch)
  if (parsed.tags) parsed.tags = normalizeTags(parsed.tags)
  const changed = await db.snippets.update(id, { ...parsed, updatedAt: Date.now() })
  if (changed === 0) throw new Error(`Snippet not found: ${id}`)
}

export async function moveToTrash(id: string): Promise<void> {
  const now = Date.now()
  const changed = await db.snippets.update(id, { deletedAt: now, updatedAt: now })
  if (changed === 0) throw new Error(`Snippet not found: ${id}`)
}
