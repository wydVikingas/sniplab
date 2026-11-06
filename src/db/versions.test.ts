import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { MAX_VERSIONS, listVersions, saveVersion } from './versions'

const content = (code: string) => ({ title: 'T', language: 'javascript' as const, code })

describe('versions', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()))
  })

  it('saves versions newest first and skips duplicates of the latest', async () => {
    expect(await saveVersion('s1', content('a'))).not.toBeNull()
    expect(await saveVersion('s1', content('a'))).toBeNull()
    await saveVersion('s1', content('b'))
    await saveVersion('s2', content('other'))
    expect((await listVersions('s1')).map((v) => v.code)).toEqual(['b', 'a'])
  })

  it('treats a title or language change as a new version', async () => {
    await saveVersion('s1', content('a'))
    expect(await saveVersion('s1', { ...content('a'), title: 'Renamed' })).not.toBeNull()
    expect(
      await saveVersion('s1', { ...content('a'), title: 'Renamed', language: 'python' }),
    ).not.toBeNull()
  })

  it(`keeps at most ${MAX_VERSIONS} versions per snippet`, async () => {
    for (let i = 0; i < MAX_VERSIONS + 5; i++) await saveVersion('s1', content(`v${i}`))
    const versions = await listVersions('s1')
    expect(versions).toHaveLength(MAX_VERSIONS)
    expect(versions[0]?.code).toBe(`v${MAX_VERSIONS + 4}`)
    expect(versions.at(-1)?.code).toBe('v5')
    expect(await db.versions.count()).toBe(MAX_VERSIONS)
  })
})
