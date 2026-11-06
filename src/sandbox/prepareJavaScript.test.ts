import { describe, expect, it } from 'vitest'
import { prepareJavaScript, type PreparedJavaScript } from './prepareJavaScript'
import { RESULT_EXPORT } from './protocol'

function prepared(code: string): PreparedJavaScript {
  const result = prepareJavaScript(code)
  if (!result.ok) throw new Error(`Unexpected syntax error: ${result.error.message}`)
  return result.prepared
}

describe('prepareJavaScript', () => {
  it('exports the value of a final expression statement', () => {
    const p = prepared('const a = 1\na + 1;')
    expect(p.hasResult).toBe(true)
    expect(p.source).toBe(`const a = 1\nexport const ${RESULT_EXPORT} = (a + 1);`)
  })

  it('keeps the line structure and trailing comments', () => {
    const p = prepared('let x = 2\n\nx * 3 // six\n')
    expect(p.source.split('\n')).toHaveLength(4)
    expect(p.source).toContain(`export const ${RESULT_EXPORT} = (x * 3); // six`)
  })

  it('leaves code alone when the last statement is not an expression', () => {
    for (const code of ['const a = 1', 'function f() {}', 'if (true) {}', '']) {
      const p = prepared(code)
      expect(p.hasResult).toBe(false)
      expect(p.source).toBe(code)
    }
  })

  it('supports top-level await and await in the last expression', () => {
    const p = prepared('const v = await Promise.resolve(1)\nawait Promise.resolve(v)')
    expect(p.source).toContain(`= (await Promise.resolve(v));`)
  })

  it('drops redundant parentheses around the expression', () => {
    expect(prepared('({ a: 1 })').source).toBe(`export const ${RESULT_EXPORT} = ({ a: 1 });`)
  })

  it('reports syntax errors with 1-based positions', () => {
    const result = prepareJavaScript('const ok = 1\nconst broken = ;')
    expect(result).toEqual({
      ok: false,
      error: {
        name: 'SyntaxError',
        message: 'Unexpected token',
        stack: null,
        line: 2,
        column: 16,
      },
    })
  })

  it('maps positions on the rewritten line back to the original code', () => {
    const p = prepared('foo()')
    // In the rewritten source `foo` starts right after the inserted prefix.
    const prefixLength = `export const ${RESULT_EXPORT} = (`.length
    expect(p.mapPosition(1, prefixLength + 1)).toEqual({ line: 1, column: 1 })
    expect(p.mapPosition(1, prefixLength + 4)).toEqual({ line: 1, column: 4 })
    expect(p.mapPosition(1, 3)).toEqual({ line: 1, column: 1 }) // inside the prefix
    expect(prepared('a\nb()').mapPosition(1, 1)).toEqual({ line: 1, column: 1 }) // other lines
  })
})
