import type { Language } from '../db/schema'

export interface LanguageInfo {
  label: string
  short: string
  monacoId: string
  tabSize: number
  starter: string
  badgeClass: string
}

export const LANGUAGE_INFO: Record<Language, LanguageInfo> = {
  javascript: {
    label: 'JavaScript',
    short: 'JS',
    monacoId: 'javascript',
    tabSize: 2,
    starter: "console.log('Hello, SnipLab!')\n",
    badgeClass: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-400/15 dark:text-yellow-300',
  },
  typescript: {
    label: 'TypeScript',
    short: 'TS',
    monacoId: 'typescript',
    tabSize: 2,
    starter:
      "const greet = (name: string): string => `Hello, ${name}!`\n\nconsole.log(greet('SnipLab'))\n",
    badgeClass: 'bg-blue-100 text-blue-800 dark:bg-blue-400/15 dark:text-blue-300',
  },
  python: {
    label: 'Python',
    short: 'PY',
    monacoId: 'python',
    tabSize: 4,
    starter: "print('Hello, SnipLab!')\n",
    badgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-300',
  },
}
