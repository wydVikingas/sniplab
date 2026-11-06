import Dexie, { type EntityTable } from 'dexie'
import type { Folder, Snippet, SnippetVersion } from './schema'

export class SnipLabDB extends Dexie {
  // `declare` (not `!`) so class-field semantics don't overwrite the tables Dexie assigns.
  declare snippets: EntityTable<Snippet, 'id'>
  declare folders: EntityTable<Folder, 'id'>
  declare versions: EntityTable<SnippetVersion, 'id'>

  constructor(name = 'sniplab') {
    super(name)
    // Booleans and nulls can't be IndexedDB keys, so `favorite`/`deletedAt` are filtered in memory.
    this.version(1).stores({
      snippets: 'id, updatedAt, language, folderId, *tags',
      folders: 'id, parentId',
      versions: 'id, snippetId, [snippetId+createdAt]',
    })
  }
}

export const db = new SnipLabDB()
