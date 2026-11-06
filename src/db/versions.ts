import Dexie from 'dexie'
import { db } from './db'
import type { Snippet, SnippetVersion } from './schema'

export const MAX_VERSIONS = 50

type VersionContent = Pick<Snippet, 'title' | 'language' | 'code'>

/** A snippet's versions, newest first. */
export function listVersions(snippetId: string): Promise<SnippetVersion[]> {
  return db.versions
    .where('[snippetId+createdAt]')
    .between([snippetId, Dexie.minKey], [snippetId, Dexie.maxKey])
    .reverse()
    .toArray()
}

/**
 * Record the given content as a new version, unless it is identical to the latest one.
 * Keeps at most MAX_VERSIONS per snippet (oldest are dropped).
 */
export async function saveVersion(
  snippetId: string,
  content: VersionContent,
): Promise<SnippetVersion | null> {
  return db.transaction('rw', db.versions, async () => {
    const versions = await listVersions(snippetId)
    const latest = versions[0]
    if (
      latest &&
      latest.code === content.code &&
      latest.title === content.title &&
      latest.language === content.language
    ) {
      return null
    }
    const version: SnippetVersion = {
      id: crypto.randomUUID(),
      snippetId,
      title: content.title,
      language: content.language,
      code: content.code,
      // Strictly increasing per snippet, even for saves within the same millisecond.
      createdAt: Math.max(Date.now(), (latest?.createdAt ?? 0) + 1),
    }
    await db.versions.add(version)
    const excess = versions.slice(MAX_VERSIONS - 1)
    if (excess.length > 0) await db.versions.bulkDelete(excess.map((v) => v.id))
    return version
  })
}
