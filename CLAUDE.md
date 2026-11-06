# SnipLab

Local-first code snippet manager with safe in-browser execution (JS, TS, Python).
The full product spec, security model, and milestone roadmap live in `docs/SPEC.md` — read it before starting a milestone.

## Commands

- `npm run dev` — dev server
- `npm run check` — lint (oxlint) + typecheck (tsc) + Prettier check + Vitest. Run before every commit.
- `npm run build` — production build

## Conventions

- TypeScript strict (`strict`, `noUncheckedIndexedAccess`). No `any` without a comment justifying it.
- Prettier: no semicolons, single quotes, 100 cols, Tailwind class sorting.
- Validate all data crossing a boundary (sandbox messages, imports, IndexedDB migrations, network) with Zod.
- Unit tests sit next to the code as `*.test.ts(x)`. IndexedDB is faked in tests via `fake-indexeddb` (see `src/test/setup.ts`).
- One commit per logical step; keep `main` green (CI runs `npm run check` equivalents + build).

## Security invariants (never break these)

- User code never runs on the app's origin. It runs in a Worker spawned inside an `<iframe sandbox="allow-scripts">` (no `allow-same-origin`).
- The app talks to the sandbox only via the typed postMessage protocol; every message from the sandbox is Zod-validated on the host and checked against the active run id.
- Every execution has a timeout that terminates the worker; the editor must stay responsive during infinite loops.

## Data & library conventions

- IndexedDB schema changes need a new `this.version(n).upgrade(...)` in `src/db/db.ts` plus a test in `db.test.ts` (current: v3).
- `updateSnippet` is for content edits and bumps `updatedAt`; organizational changes (favorite, folder, trash, `lastOpenedAt`) go through dedicated functions in `src/db/snippets.ts` that don't.
- Trash is a soft delete (`deletedAt`); only `deleteForever`/`emptyTrash` remove data, and they also remove the snippet's versions. Deleting a folder moves its contents up a level.
- The list's current view (folder, tag, favorites, recent, trash) lives in URL search params on the root route (`src/lib/libraryFilter.ts`); `applyFilter`/`libraryCounts` derive everything from one live query of all snippets.
- Layout: library nav (≥ lg, drawer below) · snippet list · editor. The editor keeps content in a local draft (autosaved); favorite/folder are read live from the DB.

## Sandbox architecture (`src/sandbox/`)

- `SandboxHost.ts` — app side: one hidden srcdoc iframe, one run at a time; timeout/Stop/output-limit remove the whole iframe (killing its workers). `getSandbox()` is the shared instance. A run has two time limits: a generous _prepare_ limit until the sandbox reports `started` (runtime boot, package installs), then the snippet's own timeout.
- `runtimes.ts` — the `Runtime` interface and one implementation per language (`RUNTIMES`). JS: `prepareJavaScript`. TS: Sucrase strips types (line-preserving), then JS. Python: parses `# requires:` comments.
- `runtime/frame.js`, `runtime/worker.js` (JS/TS, classic worker from a blob: URL, fresh per run), `runtime/python-worker.js` (Pyodide, **module** worker from a **data:** URL — Pyodide rejects classic workers and module workers can't load from blob: URLs in an opaque-origin frame; stays warm between runs). All three are plain JS imported with `?raw` and inlined into the iframe's `srcdoc` (see `srcdoc.ts`), so they must stay dependency-free and mirror the shapes in `protocol.ts` by hand. Their helpers are unit-tested by evaluating the raw source.
- `pythonAssets.ts` — the opaque-origin sandbox can't use the HTTP cache or fetch app files, so the Python worker patches `fetch` and relays requests (`asset-request`) to the host, which serves bundled Pyodide files or fetches from an allowlist (pinned Pyodide CDN, PyPI). Keep `PYODIDE_VERSION` in sync with the `pyodide` package (a test enforces it).
- `srcdoc.ts` — builds the iframe document and its CSP (`connect-src 'none'` unless the snippet allows network). blob:/data: workers inherit this CSP (verified in Chrome, including the Python worker).
- `prepareJavaScript.ts` — parses with acorn on the host (exact syntax-error positions) and rewrites a final expression into `export const __sniplab_result__ = (…)`; the snippet runs as an ES module via `import(blobUrl)`, so top-level `await` works.
- A JS run ends with `done` once the module has evaluated and no tracked timers/fetches remain (like Node's event loop), or with `error`. A Python run ends when `runPythonAsync` settles.
- Known limitation: user code can call the worker's `postMessage` directly and fake output for its own run. That only affects its own output, never the app.

## Dev notes

- On Windows, Vite's watcher sometimes serves a stale in-between version of a module after several quick edits (symptom: "X is not defined" for something that exists). Restart the dev server.
