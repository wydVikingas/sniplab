import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from './db/db'
import { createSnippet, listSnippets } from './db/snippets'
import type { CodeEditorProps } from './editor/CodeEditor'
import { createAppRouter } from './router'

// Monaco doesn't run in jsdom; a textarea stands in for it.
vi.mock('./editor/CodeEditor', () => ({
  default: ({ value, onChange }: CodeEditorProps) => (
    <textarea aria-label="Code editor" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

beforeAll(() => {
  // jsdom lacks modal <dialog> support.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true
  }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false
    this.dispatchEvent(new Event('close'))
  }
})

function renderApp(path = '/') {
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) })
  render(<RouterProvider router={router} />)
  return router
}

describe('SnipLab app', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((table) => table.clear()))
  })

  it('creates, edits, autosaves and deletes a snippet', async () => {
    const router = renderApp()
    expect(await screen.findByText('Your snippet library is empty')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'New snippet' }))
    const title = await screen.findByRole('textbox', { name: 'Title' })
    expect(title).toHaveValue('Untitled snippet')
    expect(router.state.location.pathname).toMatch(/^\/s\//)

    fireEvent.change(title, { target: { value: 'Hello world' } })
    const tags = screen.getByRole('textbox', { name: 'Tags' })
    fireEvent.change(tags, { target: { value: 'Demo, basics ,demo' } })
    fireEvent.blur(tags)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Code editor' }), {
      target: { value: 'console.log(42)' },
    })
    // Normalized on blur, and later edits must not restore the raw text.
    expect(tags).toHaveValue('demo, basics')

    await waitFor(async () => {
      const [saved] = await listSnippets()
      expect(saved).toMatchObject({
        title: 'Hello world',
        tags: ['demo', 'basics'],
        code: 'console.log(42)',
      })
    })
    const nav = screen.getByRole('navigation', { name: 'Snippets' })
    expect(await within(nav).findByText('Hello world')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete snippet?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(await screen.findByText('Your snippet library is empty')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
    expect(await listSnippets()).toEqual([])
    expect(await db.snippets.count()).toBe(1) // soft-deleted, still restorable
  })

  it('filters the sidebar list', async () => {
    await createSnippet({ title: 'Quicksort', tags: ['sorting'] })
    await createSnippet({ title: 'Fetch JSON', language: 'typescript' })
    renderApp()
    const nav = await screen.findByRole('navigation', { name: 'Snippets' })
    await within(nav).findByText('Quicksort')

    const filter = screen.getByRole('searchbox', { name: 'Filter snippets' })
    fireEvent.change(filter, { target: { value: 'typescript' } })
    expect(within(nav).queryByText('Quicksort')).not.toBeInTheDocument()
    expect(within(nav).getByText('Fetch JSON')).toBeInTheDocument()

    fireEvent.change(filter, { target: { value: 'sorting' } })
    expect(within(nav).getByText('Quicksort')).toBeInTheDocument()
    expect(within(nav).queryByText('Fetch JSON')).not.toBeInTheDocument()
  })

  it('shows a not-found message for unknown snippets', async () => {
    renderApp('/s/does-not-exist')
    expect(
      await screen.findByText("This snippet doesn't exist or was deleted."),
    ).toBeInTheDocument()
  })
})
