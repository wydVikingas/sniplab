import { describe, expect, it } from 'vitest'
import { runErrorSchema, type RunError } from '../protocol'
import pythonWorkerSource from './python-worker.js?raw'

// Evaluate the exact source the sandbox runs; it doesn't auto-start outside a worker.
const { parsePythonTraceback, describePythonError } = new Function(
  `${pythonWorkerSource}\nreturn { parsePythonTraceback, describePythonError }`,
)() as {
  parsePythonTraceback(text: string): RunError
  describePythonError(error: unknown): RunError
}

const parse = (text: string) => runErrorSchema.parse(parsePythonTraceback(text))

describe('python worker tracebacks', () => {
  it('reports the deepest snippet frame and hides Pyodide internals', () => {
    const traceback = [
      'Traceback (most recent call last):',
      '  File "/lib/python314.zip/_pyodide/_base.py", line 619, in eval_code_async',
      '    await CodeRunner(',
      '  File "<snippet>", line 3, in <module>',
      '  File "<snippet>", line 1, in <lambda>',
      'ZeroDivisionError: division by zero',
      '',
    ].join('\n')
    expect(parse(traceback)).toEqual({
      name: 'ZeroDivisionError',
      message: 'division by zero',
      stack: '  File "<snippet>", line 3, in <module>\n  File "<snippet>", line 1, in <lambda>',
      line: 1,
      column: null,
    })
  })

  it('keeps the source excerpt of syntax errors', () => {
    const traceback = [
      'Traceback (most recent call last):',
      '  File "/lib/python314.zip/_pyodide/_base.py", line 151, in _parse_and_compile_gen',
      '    mod = compile(source, filename, mode, flags | ast.PyCF_ONLY_AST)',
      '  File "<snippet>", line 2',
      '    x = (',
      '        ^',
      "SyntaxError: '(' was never closed",
    ].join('\n')
    expect(parse(traceback)).toMatchObject({
      name: 'SyntaxError',
      message: "'(' was never closed",
      line: 2,
      stack: '  File "<snippet>", line 2\n    x = (\n        ^',
    })
  })

  it('handles multi-line messages and dotted exception names', () => {
    const traceback = [
      'Traceback (most recent call last):',
      '  File "<snippet>", line 4, in <module>',
      'pyodide.ffi.JsException: first line',
      'second line',
    ].join('\n')
    expect(parse(traceback)).toMatchObject({
      name: 'pyodide.ffi.JsException',
      message: 'first line\nsecond line',
      line: 4,
    })
  })

  it('describes PythonErrors via their traceback and other errors directly', () => {
    const pythonError = Object.assign(new Error('Traceback:\nValueError: bad'), {
      type: 'ValueError',
    })
    expect(describePythonError(pythonError)).toMatchObject({ name: 'ValueError', message: 'bad' })
    expect(describePythonError(new TypeError('Failed to fetch'))).toMatchObject({
      name: 'TypeError',
      message: 'Failed to fetch',
    })
  })
})
