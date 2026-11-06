import type { Language } from '../db/schema'
import { prepareJavaScript } from './prepareJavaScript'
import type { RunError, SandboxRuntime } from './protocol'

/** Code ready to send to the sandbox. */
export interface PreparedRun {
  runtime: SandboxRuntime
  source: string
  /** JS only: whether the source exports its last expression's value. */
  hasResult: boolean
  /** Python only: packages to install with micropip first. */
  packages: string[]
  /** Maps a 1-based position reported by the runtime back to the user's code. */
  mapPosition(line: number, column: number): { line: number; column: number }
}

export type PrepareResult = { ok: true; run: PreparedRun } | { ok: false; error: RunError }

/** Adding a language = implementing this and registering it in RUNTIMES. */
export interface Runtime {
  prepare(code: string): Promise<PrepareResult>
}

const identity = (line: number, column: number) => ({ line, column })

function prepareJs(code: string): PrepareResult {
  const result = prepareJavaScript(code)
  if (!result.ok) return result
  const { source, hasResult, mapPosition } = result.prepared
  return { ok: true, run: { runtime: 'javascript', source, hasResult, packages: [], mapPosition } }
}

export const javascriptRuntime: Runtime = {
  prepare: async (code) => prepareJs(code),
}

/**
 * TypeScript: strip types with Sucrase (no type checking — the editor shows type errors),
 * then run as JavaScript. Sucrase preserves line numbers, so error lines stay accurate.
 */
export const typescriptRuntime: Runtime = {
  async prepare(code) {
    const { transform } = await import('sucrase')
    let output: string
    try {
      output = transform(code, { transforms: ['typescript'], disableESTransforms: true }).code
    } catch (error) {
      if (error instanceof SyntaxError && 'loc' in error) {
        const loc = error.loc as { line: number; column: number }
        return {
          ok: false,
          error: {
            name: 'SyntaxError',
            message: error.message.replace(/ \(\d+:\d+\)$/, ''),
            stack: null,
            line: loc.line,
            column: Math.max(loc.column, 1),
          },
        }
      }
      throw error
    }
    return prepareJs(output)
  },
}

const REQUIRES_LINE = /^#\s*requires:\s*(.*)$/gim
const NAME = '[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?'
const EXTRAS = '(?:\\[[A-Za-z0-9._-]+(?:,[A-Za-z0-9._-]+)*\\])?'
const VERSION = '(?:===|==|!=|<=|>=|~=|<|>)\\s*[A-Za-z0-9.*+!_-]+'
const PACKAGE_SPEC = new RegExp(`^${NAME}${EXTRAS}(?:\\s*${VERSION}(?:\\s*,\\s*${VERSION})*)?$`)

/** Split "a, b[x,y], c>=1,<2" on the commas that separate packages. */
function splitSpecs(list: string): string[] {
  const specs: string[] = []
  for (const part of list.split(',').map((p) => p.trim())) {
    const prev = specs.at(-1)
    const continuesPrev =
      prev !== undefined &&
      ((prev.includes('[') && !prev.includes(']')) || /^(?:===|==|!=|<=|>=|~=|<|>)/.test(part))
    if (continuesPrev) specs[specs.length - 1] = `${prev},${part}`
    else if (part) specs.push(part)
  }
  return specs
}

/** Packages listed in `# requires: numpy, requests>=2` comments. */
export function parseRequires(code: string): { packages: string[]; invalid: string[] } {
  const packages: string[] = []
  const invalid: string[] = []
  for (const match of code.matchAll(REQUIRES_LINE)) {
    for (const spec of splitSpecs(match[1] ?? '')) {
      ;(PACKAGE_SPEC.test(spec) ? packages : invalid).push(spec)
    }
  }
  return { packages: [...new Set(packages)], invalid }
}

export const pythonRuntime: Runtime = {
  async prepare(code) {
    const { packages, invalid } = parseRequires(code)
    if (invalid.length > 0) {
      return {
        ok: false,
        error: {
          name: 'RequirementError',
          message: `Invalid package name in "# requires:": ${invalid.join(', ')}`,
          stack: null,
          line: null,
          column: null,
        },
      }
    }
    return {
      ok: true,
      run: { runtime: 'python', source: code, hasResult: true, packages, mapPosition: identity },
    }
  },
}

export const RUNTIMES: Record<Language, Runtime> = {
  javascript: javascriptRuntime,
  typescript: typescriptRuntime,
  python: pythonRuntime,
}
