/**
 * Serves Pyodide's files to the sandbox. The sandbox has an opaque origin, so it can't use
 * the HTTP cache or fetch the app's own files; the Python worker asks the host instead
 * (`asset-request`), and the host answers from this provider.
 *
 * - Core runtime files are bundled with the app (works offline, cached by the browser).
 * - Extra Pyodide packages (numpy, …) come from the Pyodide CDN, pinned to our version.
 * - micropip may reach PyPI. Nothing else is served.
 */
import lockUrl from 'pyodide/pyodide-lock.json?url'
import wasmUrl from 'pyodide/pyodide.asm.wasm?url'
import stdlibUrl from 'pyodide/python_stdlib.zip?url'

export const PYODIDE_VERSION = '314.0.7'
/** Fake origin the Python worker uses as Pyodide's indexURL; every request to it is proxied. */
export const PYODIDE_ASSET_BASE = 'https://sniplab.invalid/pyodide/'
export const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`
const PYPI_ORIGINS = ['https://pypi.org', 'https://files.pythonhosted.org']
const MAX_BYTES = 200 * 1024 * 1024

export interface AssetResponse {
  status: number
  contentType: string
  body: ArrayBuffer
}

type Progress = (loaded: number, total: number) => void

const CONTENT_TYPES: Record<string, string> = {
  wasm: 'application/wasm',
  mjs: 'text/javascript',
  js: 'text/javascript',
  json: 'application/json',
  zip: 'application/zip',
  whl: 'application/zip',
}

function contentTypeFor(name: string): string {
  return CONTENT_TYPES[name.split('.').pop() ?? ''] ?? 'application/octet-stream'
}

const encode = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer

async function fetchBytes(url: string, onProgress?: Progress): Promise<ArrayBuffer> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
  const total = Number(response.headers.get('content-length')) || 0
  if (!onProgress || !response.body) return response.arrayBuffer()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.byteLength
    onProgress(loaded, Math.max(total, loaded))
  }
  const bytes = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes.buffer
}

/** Runtime files shipped with the app. The JS ones are lazy `?raw` chunks. */
const BUNDLED: Record<string, (onProgress: Progress) => Promise<ArrayBuffer>> = {
  'pyodide.mjs': () => import('pyodide/pyodide.mjs?raw').then((m) => encode(m.default)),
  'pyodide.asm.mjs': () => import('pyodide/pyodide.asm.mjs?raw').then((m) => encode(m.default)),
  'pyodide-lock.json': () => fetchBytes(lockUrl),
  'python_stdlib.zip': (onProgress) => fetchBytes(stdlibUrl, onProgress),
  'pyodide.asm.wasm': (onProgress) => fetchBytes(wasmUrl, onProgress),
}

export type ResolvedAsset =
  | { kind: 'bundled'; name: string }
  | { kind: 'package'; url: string }
  | { kind: 'pypi'; url: string }

/** Decide whether the host will serve a URL requested by the sandbox; `null` means refuse. */
export function resolveAssetUrl(url: string): ResolvedAsset | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null

  const path = parsed.origin + parsed.pathname
  for (const base of [PYODIDE_ASSET_BASE, PYODIDE_CDN]) {
    if (!path.startsWith(base)) continue
    const name = path.slice(base.length)
    if (!/^[A-Za-z0-9_+-][A-Za-z0-9_.+-]*$/.test(name)) return null
    return name in BUNDLED
      ? { kind: 'bundled', name }
      : { kind: 'package', url: PYODIDE_CDN + name }
  }
  if (PYPI_ORIGINS.includes(parsed.origin)) return { kind: 'pypi', url: parsed.href }
  return null
}

async function fetchRemote(url: string, accept: string | null): Promise<AssetResponse> {
  const response = await fetch(url, {
    credentials: 'omit',
    headers: accept ? { Accept: accept } : undefined,
  })
  if (Number(response.headers.get('content-length')) > MAX_BYTES) {
    throw new Error(`Response too large: ${url}`)
  }
  const body = await response.arrayBuffer()
  if (body.byteLength > MAX_BYTES) throw new Error(`Response too large: ${url}`)
  return {
    status: response.status,
    contentType: response.headers.get('content-type') ?? contentTypeFor(url),
    body,
  }
}

export class PythonAssets {
  readonly #cache = new Map<string, Promise<AssetResponse>>()
  readonly #progress = new Map<string, { loaded: number; total: number }>()
  /** Called with combined download progress of the core runtime files. */
  onProgress: ((loaded: number, total: number) => void) | null = null

  /** Fetch an asset for the sandbox. The returned body is a fresh copy, safe to transfer. */
  async get(url: string, accept: string | null): Promise<AssetResponse> {
    const resolved = resolveAssetUrl(url)
    if (!resolved) throw new Error(`Blocked request to ${url}`)

    let response: AssetResponse
    switch (resolved.kind) {
      case 'bundled':
        response = await this.#cached(resolved.name, async () => ({
          status: 200,
          contentType: contentTypeFor(resolved.name),
          body: await BUNDLED[resolved.name]!((loaded, total) =>
            this.#reportProgress(resolved.name, loaded, total),
          ),
        }))
        break
      case 'package':
        response = await this.#cached(resolved.url, () => fetchRemote(resolved.url, null))
        break
      case 'pypi':
        return fetchRemote(resolved.url, accept)
    }
    return { ...response, body: response.body.slice(0) }
  }

  #cached(key: string, load: () => Promise<AssetResponse>): Promise<AssetResponse> {
    let entry = this.#cache.get(key)
    if (!entry) {
      entry = load()
      this.#cache.set(key, entry)
      // Don't cache failures; a later request retries.
      entry.catch(() => this.#cache.delete(key))
    }
    return entry
  }

  #reportProgress(name: string, loaded: number, total: number): void {
    this.#progress.set(name, { loaded, total })
    let sumLoaded = 0
    let sumTotal = 0
    for (const p of this.#progress.values()) {
      sumLoaded += p.loaded
      sumTotal += p.total
    }
    this.onProgress?.(sumLoaded, sumTotal)
  }
}
