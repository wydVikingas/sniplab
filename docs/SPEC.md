# SnipLab — Product Specification

A local-first code snippet manager with safe in-browser code execution. Work in milestones, commit after each one, and keep the app runnable at every step.

## Product

A developer's personal library of code snippets. Users create, organize, search, and run snippets in JavaScript, TypeScript, and Python directly in the browser, with output shown beside the editor. Everything works offline. An optional small backend allows sharing a snippet via public link.

## Tech stack

- Vite + React + TypeScript (strict), TanStack Router, Tailwind CSS, Zustand for UI state.
- Editor: Monaco Editor (`@monaco-editor/react`) with language-aware syntax highlighting, themes, and keybindings.
- Storage: IndexedDB via Dexie.js (local-first; the app is fully functional without a backend).
- Search: MiniSearch full-text index over title, description, tags, and code, kept in sync with the DB.
- Execution:
  - JavaScript: native, inside the sandbox described below.
  - TypeScript: transpiled in-browser with esbuild-wasm (or sucrase), then run as JS.
  - Python: Pyodide (WebAssembly CPython), lazy-loaded only when first needed.
- PWA via vite-plugin-pwa (app shell + Pyodide assets cached after first load).
- Optional backend (last milestone): Hono + SQLite (Drizzle) for share links.
- Tooling: oxlint, Prettier, Vitest (unit), Playwright (E2E), GitHub Actions CI.

## Security model for code execution (critical — design this first)

User code must never access the app's IndexedDB, DOM, cookies, or localStorage, and must never freeze the UI.

- The main app creates an `<iframe sandbox="allow-scripts">` (**no** `allow-same-origin`) loaded via `srcdoc`, so it has an opaque origin.
- Inside that iframe, a Web Worker runs the actual user code (JS or Pyodide). The iframe only relays messages.
- Communication is `postMessage` only, with a typed message protocol defined in one shared module (`src/sandbox/protocol.ts`: `ready`, `run`, `log`, `result`, `error`, `done`). Everything arriving from the sandbox is validated with Zod on the host; the sandbox scripts are plain JS served verbatim and do structural checks.
- Timeout (default 5s, configurable per snippet, max 30s): on expiry the worker is terminated and the sandbox iframe recreated. Infinite loops must not freeze the editor.
- A strict Content-Security-Policy inside the sandbox; network access from user code disabled by default with a per-snippet "allow network" toggle that is clearly labelled.
- Output is capped (e.g. 1 MB / 10,000 lines) to prevent memory blowups.
- Document the threat model and design decisions in `SECURITY.md`.

## Features

### 1. Snippet library

- Snippet fields: title, description (Markdown), language, code, tags, folder, favorite flag, created/updated timestamps, run settings (timeout, network toggle).
- Sidebar: folders (nested, drag to reorder/move), tag list with counts, Favorites, Recent, Trash.
- Soft delete to Trash with restore; empty Trash permanently with confirmation.
- Version history: save a version on each explicit save (Ctrl+S); view diff between versions (Monaco diff editor); restore any version.

### 2. Editor & runner

- Split layout: Monaco editor | output panel (resizable). Mobile: tabs instead of split.
- Run with Ctrl+Enter or a button; Stop button kills a running execution.
- Output panel shows stdout/stderr with distinct styling, the returned value of the last expression (JS/TS), execution time, and errors with clickable line numbers that jump to the line in the editor.
- `console.log` of objects renders as an expandable tree, not `[object Object]`.
- Python: support `print`, exceptions with traceback, and installing pure-Python packages via micropip (`# requires: package1, package2` comment at the top of the snippet).
- Stdin field for snippets that read input (Python `input()`, JS via a provided `readInput()` helper).
- Pyodide loading shows a progress indicator; it's cached so later runs are instant.

### 3. Search & navigation

- Global command palette (Ctrl+K): fuzzy search snippets, jump to folders/tags, run commands (new snippet, toggle theme, etc.).
- Full-text search with filters: `lang:python tag:sorting fav:true`, with highlighted matches.
- Keyboard-first: every main action has a shortcut; a `?` overlay lists them.

### 4. Import / export

- Export entire library or a selection as JSON (versioned schema) and as a ZIP of plain source files organized by folder.
- Import JSON (with validation, duplicate detection, and a preview of what will be imported).
- Import from a public GitHub Gist URL (fetch via the Gist API, one snippet per file).

### 5. Sharing (optional backend, last milestone)

- "Share" publishes a read-only copy to the server and returns a short URL.
- Public share page: syntax-highlighted code, description, Run button (same sandbox), "Copy to my library" button.
- Owner can unpublish. Rate-limit publishing; cap snippet size at 100 KB.

### 6. Polish

- Light/dark theme synced to the Monaco theme; respects system preference.
- Templates: starter snippets for each language on first launch (e.g. quicksort, fetch example, dataclass example).
- Settings page: default language, font size, tab size, default timeout, word wrap.

## Non-goals

No user accounts beyond what sharing needs, no real-time collaboration, no server-side code execution, no languages beyond JS/TS/Python in v1 — but design the runner so adding a language is one new module implementing a `Runtime` interface.

## Quality bar

- TypeScript strict; no `any` without a justifying comment; oxlint + Prettier.
- Accessible: full keyboard operation, ARIA labels, focus management in dialogs, WCAG AA contrast.
- Unit tests: search query parser, import/export validation and round-trip, version diffing, message protocol validation.
- Playwright E2E:
  - create snippet → run JS → see output;
  - infinite loop `while(true){}` → times out → UI stays responsive → next run works;
  - user code tries `indexedDB.open(...)`, `parent.document`, and `localStorage` → all fail, app data intact;
  - Python snippet runs and prints;
  - export → wipe → import → library identical.
- Lighthouse: PWA installable, performance ≥ 90 on the library page (Monaco and Pyodide lazy-loaded).

## Milestones

- [x] **0. Setup** — Vite + React + TS scaffold, Tailwind, oxlint, Prettier, Vitest, CI, GitHub repo.
- [x] **1. Foundation** — routing, app layout, Dexie schema, CRUD for snippets, Monaco editor.
- [x] **2. Sandbox** — iframe + worker architecture with JS execution, timeouts, stop button, output panel.
- [ ] **3. Runtimes** — TypeScript and Python runtimes behind a common `Runtime` interface.
- [ ] **4. Organization** — folders, tags, favorites, trash, version history with diff.
- [ ] **5. Search** — search index, query filters, command palette, keyboard shortcuts.
- [ ] **6. Data & offline** — import/export, Gist import, templates, settings, PWA/offline.
- [ ] **7. Sharing (optional)** — backend + share links.
- [ ] **8. Hardening** — test suite completion, accessibility pass, `SECURITY.md`, README with screenshots and architecture diagram.
