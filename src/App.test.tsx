import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from './db/db'
import { createSnippet, listSnippets } from './db/snippets'
import type { CodeEditorProps } from './editor/CodeEditor'
import { createAppRouter } from './router'
import type { RunCallbacks, RunRequest } from './sandbox/SandboxHost'

// Monaco doesn't run in jsdom; a textarea stands in for it.
vi.mock('./editor/CodeEditor', () => ({
  default: ({ value, onChange }: CodeEditorProps) => (
    <textarea aria-label="Code editor" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

// Nor does the iframe sandbox; SandboxHost has its own tests.
const fakeSandbox = vi.hoisted(() => ({ run: vi.fn(), prewarm: vi.fn() }))
vi.mock('./sandbox/SandboxHost', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./sandbox/SandboxHost')>()),
  getSandbox: () => fakeSandbox,
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

  it('runs a JavaScript snippet and shows its output', async () => {
    fakeSandbox.run.mockImplementation((_request: RunRequest, callbacks: RunCallbacks) => {
      callbacks.onLog('log', [{ t: 'string', v: 'hello from the sandbox' }])
      callbacks.onResult({ t: 'number', v: '42' })
      return { outcome: Promise.resolve({ status: 'completed', durationMs: 12 }), stop: vi.fn() }
    })
    const { id } = await createSnippet({ code: 'console.log(1)' })
    renderApp(`/s/${id}`)

    fireEvent.click(await screen.findByRole('button', { name: '▶ Run' }))

    expect(await screen.findByText('hello from the sandbox')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(await screen.findByText('Finished in 12 ms')).toBeInTheDocument()
    expect(fakeSandbox.run).toHaveBeenCalledWith(
      {
        language: 'javascript',
        code: 'console.log(1)',
        timeoutMs: 5_000,
        allowNetwork: false,
        stdin: '',
      },
      expect.anything(),
    )
  })

  it('shows start-up progress, then passes saved stdin to Python runs', async () => {
    let finish: (value: unknown) => void = () => {}
    fakeSandbox.run.mockImplementation((_request: RunRequest, callbacks: RunCallbacks) => {
      callbacks.onStatus?.('Starting Python…')
      return { outcome: new Promise((resolve) => (finish = resolve)), stop: vi.fn() }
    })
    const { id } = await createSnippet({ language: 'python', code: 'print(input())' })
    renderApp(`/s/${id}`)

    fireEvent.click(await screen.findByRole('button', { name: 'Input' }))
    fireEvent.change(screen.getByRole('textbox', { name: /Standard input/ }), {
      target: { value: 'Ada' },
    })
    expect(screen.getByText('input()')).toBeInTheDocument()
    await waitFor(async () => {
      const [saved] = await listSnippets()
      expect(saved?.runSettings.stdin).toBe('Ada')
    })

    fireEvent.click(screen.getByRole('button', { name: '▶ Run' }))
    expect(await screen.findByText('Starting Python…')).toBeInTheDocument()
    expect(fakeSandbox.run).toHaveBeenLastCalledWith(
      expect.objectContaining({ language: 'python', code: 'print(input())', stdin: 'Ada' }),
      expect.anything(),
    )
    finish({ status: 'completed', durationMs: 3 })
    expect(await screen.findByText('Finished in 3 ms')).toBeInTheDocument()
  })

  it('shows a not-found message for unknown snippets', async () => {
    renderApp('/s/does-not-exist')
    expect(
      await screen.findByText("This snippet doesn't exist or was deleted."),
    ).toBeInTheDocument()
  })
})
