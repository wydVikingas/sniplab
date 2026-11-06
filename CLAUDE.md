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

## Sandbox architecture (`src/sandbox/`)

- `SandboxHost.ts` — app side: one hidden srcdoc iframe, one run at a time; timeout/Stop/output-limit remove the whole iframe (killing the worker). `getSandbox()` is the shared instance.
- `runtime/frame.js` + `runtime/worker.js` — run inside the sandbox. They are plain JS imported with `?raw` and inlined into the iframe's `srcdoc` (see `srcdoc.ts`), so they must stay dependency-free and mirror the shapes in `protocol.ts` by hand. Their helpers are unit-tested by evaluating the raw source.
- `srcdoc.ts` — builds the iframe document and its CSP (`connect-src 'none'` unless the snippet allows network). Blob workers inherit this CSP.
- `prepareJavaScript.ts` — parses with acorn on the host (exact syntax-error positions) and rewrites a final expression into `export const __sniplab_result__ = (…)`; the snippet runs as an ES module via `import(blobUrl)`, so top-level `await` works.
- A run ends with `done` once the module has evaluated and no tracked timers/fetches remain (like Node's event loop), or with `error`.
- Known limitation: user code can call the worker's `postMessage` directly and fake output for its own run. That only affects its own output, never the app.
