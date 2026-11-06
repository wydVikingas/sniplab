import pyodidePackageJson from 'pyodide/package.json?raw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PYODIDE_ASSET_BASE,
  PYODIDE_CDN,
  PYODIDE_VERSION,
  PythonAssets,
  resolveAssetUrl,
} from './pythonAssets'

afterEach(() => vi.unstubAllGlobals())

describe('pythonAssets', () => {
  it('pins the CDN to the installed Pyodide version', () => {
    expect(PYODIDE_VERSION).toBe((JSON.parse(pyodidePackageJson) as { version: string }).version)
  })

  it('serves bundled runtime files locally', () => {
    expect(resolveAssetUrl(`${PYODIDE_ASSET_BASE}pyodide.asm.wasm`)).toEqual({
      kind: 'bundled',
      name: 'pyodide.asm.wasm',
    })
    expect(resolveAssetUrl(`${PYODIDE_CDN}pyodide-lock.json`)).toEqual({
      kind: 'bundled',
      name: 'pyodide-lock.json',
    })
  })

  it('maps other Pyodide files to the pinned CDN', () => {
    expect(resolveAssetUrl(`${PYODIDE_ASSET_BASE}numpy-2.0-cp314-pyodide.whl?x=1`)).toEqual({
      kind: 'package',
      url: `${PYODIDE_CDN}numpy-2.0-cp314-pyodide.whl`,
    })
  })

  it('allows PyPI for micropip', () => {
    expect(resolveAssetUrl('https://pypi.org/pypi/tabulate/json')).toMatchObject({ kind: 'pypi' })
    expect(resolveAssetUrl('https://files.pythonhosted.org/packages/x.whl')).toMatchObject({
      kind: 'pypi',
    })
  })

  it.each([
    'https://example.com/evil.js',
    'http://pypi.org/simple/',
    'https://user:pw@pypi.org/',
    `${PYODIDE_ASSET_BASE}../secret`,
    `${PYODIDE_ASSET_BASE}.hidden`,
    'https://cdn.jsdelivr.net/npm/anything',
    'https://cdn.jsdelivr.net/pyodide/v0.1.0/full/numpy.whl',
    'not a url',
  ])('refuses %s', (url) => {
    expect(resolveAssetUrl(url)).toBeNull()
  })

  it('caches package downloads and hands out independent copies', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])))
    vi.stubGlobal('fetch', fetchMock)
    const assets = new PythonAssets()
    const url = `${PYODIDE_ASSET_BASE}tiny.whl`

    const a = await assets.get(url, null)
    const b = await assets.get(url, null)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(`${PYODIDE_CDN}tiny.whl`, expect.anything())
    expect(a.body).not.toBe(b.body)
    expect(new Uint8Array(b.body)).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('forwards PyPI requests uncached with their Accept header', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)
    const assets = new PythonAssets()
    const response = await assets.get('https://pypi.org/simple/nope/', 'application/json')
    await assets.get('https://pypi.org/simple/nope/', 'application/json')
    expect(response.status).toBe(404)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledWith('https://pypi.org/simple/nope/', {
      credentials: 'omit',
      headers: { Accept: 'application/json' },
    })
  })

  it('rejects blocked URLs', async () => {
    await expect(new PythonAssets().get('https://example.com/', null)).rejects.toThrow(/Blocked/)
  })
})
