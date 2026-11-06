import type { Language } from '../db/schema'
import { LANGUAGE_INFO } from '../lib/languages'

export function LanguageBadge({ language }: { language: Language }) {
  const info = LANGUAGE_INFO[language]
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${info.badgeClass}`}
      title={info.label}
    >
      {info.short}
    </span>
  )
}
