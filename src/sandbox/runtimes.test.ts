import { describe, expect, it } from 'vitest'
import { parseRequires, pythonRuntime, typescriptRuntime } from './runtimes'

describe('typescriptRuntime', () => {
  it('strips types, keeps runtime constructs and preserves line numbers', async () => {
    const code = [
      'enum Color { Red, Green }',
      'interface P {',
      '  x: number',
      '}',
      'const p: P = { x: 1 } satisfies P',
      'Color[Color.Green]',
    ].join('\n')
    const result = await typescriptRuntime.prepare(code)
    if (!result.ok) throw new Error(result.error.message)
    const lines = result.run.source.split('\n')
    expect(lines).toHaveLength(6)
    expect(result.run.runtime).toBe('javascript')
    expect(lines[0]).toContain('Color')
    expect(lines[4]).toMatch(/^const p = \{ x: 1 \}/)
    expect(lines[5]).toBe('export const __sniplab_result__ = (Color[Color.Green]);')
  })

  it('reports TypeScript syntax errors with their position', async () => {
    const result = await typescriptRuntime.prepare('const ok = 1\nconst x: number = ;')
    expect(result).toMatchObject({
      ok: false,
      error: { name: 'SyntaxError', message: 'Unexpected token', line: 2 },
    })
  })
})

describe('parseRequires', () => {
  it('collects packages from "# requires:" lines', () => {
    expect(
      parseRequires(
        '# requires: numpy, requests>=2,<3\nimport numpy\n#requires: rich[jupyter,ansi]',
      ),
    ).toEqual({ packages: ['numpy', 'requests>=2,<3', 'rich[jupyter,ansi]'], invalid: [] })
  })

  it('ignores other comments and dedupes', () => {
    expect(parseRequires('# requirements are fun\n# requires: a, a').packages).toEqual(['a'])
  })

  it('flags invalid specs', () => {
    expect(parseRequires('# requires: ok, ../etc/passwd, https://x.y/z').invalid).toEqual([
      '../etc/passwd',
      'https://x.y/z',
    ])
  })
})

describe('pythonRuntime', () => {
  it('passes code through unchanged with its packages', async () => {
    const code = '# requires: tabulate\nprint(1)'
    const result = await pythonRuntime.prepare(code)
    expect(result).toMatchObject({
      ok: true,
      run: { runtime: 'python', source: code, hasResult: true, packages: ['tabulate'] },
    })
  })

  it('rejects invalid requirements before running', async () => {
    expect(await pythonRuntime.prepare('# requires: $(rm -rf)')).toMatchObject({
      ok: false,
      error: { name: 'RequirementError' },
    })
  })
})
