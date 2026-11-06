import { describe, expect, it } from 'vitest'
import { formatTags, normalizeTags, parseTags } from './tags'

describe('tags', () => {
  it('parses, trims, lowercases and dedupes a comma-separated string', () => {
    expect(parseTags(' Sorting, algorithms ,sorting,, ')).toEqual(['sorting', 'algorithms'])
  })

  it('turns inner whitespace into dashes', () => {
    expect(normalizeTags(['dynamic   programming'])).toEqual(['dynamic-programming'])
  })

  it('caps tag length and count', () => {
    expect(normalizeTags(['x'.repeat(80)])[0]).toHaveLength(50)
    expect(normalizeTags(Array.from({ length: 40 }, (_, i) => `t${i}`))).toHaveLength(30)
  })

  it('round-trips through formatTags', () => {
    expect(parseTags(formatTags(['a', 'b-c']))).toEqual(['a', 'b-c'])
  })
})
