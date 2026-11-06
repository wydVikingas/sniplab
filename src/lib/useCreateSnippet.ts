import { useNavigate } from '@tanstack/react-router'
import { useCallback } from 'react'
import { createSnippet } from '../db/snippets'

/** Creates a new snippet and opens it in the editor. */
export function useCreateSnippet() {
  const navigate = useNavigate()
  return useCallback(async () => {
    const snippet = await createSnippet()
    await navigate({ to: '/s/$snippetId', params: { snippetId: snippet.id } })
  }, [navigate])
}
