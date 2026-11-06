import { useEffect, useSyncExternalStore } from 'react'

export type ColorScheme = 'light' | 'dark'

const QUERY = '(prefers-color-scheme: dark)'

function getMediaQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(QUERY)
    : null
}

function subscribe(onChange: () => void): () => void {
  const mql = getMediaQuery()
  mql?.addEventListener('change', onChange)
  return () => mql?.removeEventListener('change', onChange)
}

function getSnapshot(): ColorScheme {
  return getMediaQuery()?.matches ? 'dark' : 'light'
}

/** Follows the OS color scheme and keeps the `dark` class on <html> in sync. */
export function useColorScheme(): ColorScheme {
  const scheme = useSyncExternalStore(subscribe, getSnapshot, () => 'light' as const)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', scheme === 'dark')
  }, [scheme])
  return scheme
}
