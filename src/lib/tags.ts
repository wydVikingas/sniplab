const MAX_TAGS = 30
const MAX_TAG_LENGTH = 50

/** Trim, lowercase, collapse inner whitespace to `-`, drop empties/duplicates, enforce limits. */
export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>()
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, '-').slice(0, MAX_TAG_LENGTH)
    if (tag) seen.add(tag)
    if (seen.size >= MAX_TAGS) break
  }
  return [...seen]
}

/** Parse a comma-separated tag string, e.g. "sorting, Algorithms" → ["sorting", "algorithms"]. */
export function parseTags(input: string): string[] {
  return normalizeTags(input.split(','))
}

export function formatTags(tags: readonly string[]): string {
  return tags.join(', ')
}
