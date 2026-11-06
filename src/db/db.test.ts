import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { SnipLabDB } from './db'

describe('database migrations', () => {
  it('upgrades v1 snippets: empty stdin (v2) and no lastOpenedAt (v3)', async () => {
    const name = `migration-test-${crypto.randomUUID()}`
    const v1 = new Dexie(name)
    v1.version(1).stores({
      snippets: 'id, updatedAt, language, folderId, *tags',
      folders: 'id, parentId',
      versions: 'id, snippetId, [snippetId+createdAt]',
    })
    await v1.table('snippets').add({
      id: 'old',
      title: 'Old',
      runSettings: { timeoutMs: 5000, allowNetwork: true },
    })
    v1.close()

    const db = new SnipLabDB(name)
    const snippet = await db.snippets.get('old')
    expect(snippet?.runSettings).toEqual({ timeoutMs: 5000, allowNetwork: true, stdin: '' })
    expect(snippet?.lastOpenedAt).toBeNull()
    db.close()
    await Dexie.delete(name)
  })
})
