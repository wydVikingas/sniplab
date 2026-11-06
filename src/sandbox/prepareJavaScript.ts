import { parse } from 'acorn'
import { RESULT_EXPORT, type RunError } from './protocol'

export interface PreparedJavaScript {
  /** ES module source to execute. Line structure matches the original code. */
  source: string
  /** Whether `source` exports the value of the final expression statement. */
  hasResult: boolean
  /** Maps a 1-based position in `source` back to the user's original code. */
  mapPosition(line: number, column: number): { line: number; column: number }
}

export type PrepareResult =
  { ok: true; prepared: PreparedJavaScript } | { ok: false; error: RunError }

const identity = (line: number, column: number) => ({ line, column })

/**
 * Parses the snippet as an ES module (catching syntax errors with exact positions, which
 * the browser doesn't report for dynamic imports) and, if the last statement is an
 * expression, rewrites it to `export const RESULT_EXPORT = (expr);` so the sandbox can
 * show its value — like a REPL.
 */
export function prepareJavaScript(code: string): PrepareResult {
  let program: ReturnType<typeof parse>
  try {
    program = parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
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
          column: loc.column + 1,
        },
      }
    }
    throw error
  }

  const last = program.body.at(-1)
  const expr = last?.type === 'ExpressionStatement' ? last.expression : null
  if (!last?.loc || !expr?.loc) {
    return { ok: true, prepared: { source: code, hasResult: false, mapPosition: identity } }
  }

  const prefix = `export const ${RESULT_EXPORT} = (`
  const source =
    code.slice(0, last.start) +
    prefix +
    code.slice(expr.start, expr.end) +
    ');' +
    code.slice(last.end)

  // Only the line where the statement starts gets shifted (by the inserted prefix).
  const stmtLine = last.loc.start.line
  const stmtCol = last.loc.start.column + 1
  const exprCol = expr.loc.start.column + 1
  const mapPosition = (line: number, column: number) => {
    if (line !== stmtLine || column < stmtCol) return { line, column }
    if (column < stmtCol + prefix.length) return { line, column: exprCol }
    return { line, column: column - prefix.length + (exprCol - stmtCol) }
  }

  return { ok: true, prepared: { source, hasResult: true, mapPosition } }
}
