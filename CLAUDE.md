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
- The app talks to the sandbox only via the typed, Zod-validated postMessage protocol.
- Every execution has a timeout that terminates the worker; the editor must stay responsive during infinite loops.
