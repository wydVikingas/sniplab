# SnipLab

A local-first code snippet manager with safe in-browser code execution.

Save, tag, and search your snippets, and run **JavaScript**, **TypeScript**, and **Python** right in the browser — no server required. User code runs inside a sandboxed, opaque-origin iframe + Web Worker, so it can't touch your library or freeze the UI.

> 🚧 Work in progress. See [docs/SPEC.md](docs/SPEC.md) for the full specification and roadmap.

## Planned features

- Snippet library with folders, tags, favorites, trash, and version history with diffs
- Monaco editor with run / stop, timeouts, and rich console output
- Python via Pyodide (WebAssembly), TypeScript via in-browser transpilation
- Full-text search with filters (`lang:python tag:sorting`) and a Ctrl+K command palette
- Import / export (JSON, ZIP) and GitHub Gist import
- Works offline as an installable PWA

## Tech stack

Vite · React · TypeScript · Tailwind CSS · Dexie (IndexedDB) · Monaco Editor · TanStack Router · Zustand · Zod · Vitest

## Getting started

Requires Node.js 24+.

```bash
npm install
npm run dev
```

## Scripts

| Command              | What it does                                 |
| -------------------- | -------------------------------------------- |
| `npm run dev`        | Start the dev server                         |
| `npm run build`      | Type-check and build for production          |
| `npm test`           | Run unit tests once                          |
| `npm run test:watch` | Run unit tests in watch mode                 |
| `npm run lint`       | Lint with oxlint                             |
| `npm run typecheck`  | Type-check with TypeScript                   |
| `npm run format`     | Format all files with Prettier               |
| `npm run check`      | Lint + typecheck + format check + tests (CI) |

## License

[MIT](LICENSE)
