import frameSource from './runtime/frame.js?raw'
import pythonWorkerSource from './runtime/python-worker.js?raw'
import workerSource from './runtime/worker.js?raw'

export interface SandboxOptions {
  /** Allow fetch/WebSocket to any host and `import()` of modules from https URLs. */
  allowNetwork: boolean
}

/**
 * Content-Security-Policy for the sandbox iframe. Workers created from blob:/data: URLs
 * inherit it, so this is what actually constrains user code.
 */
export function buildCsp({ allowNetwork }: SandboxOptions): string {
  return [
    "default-src 'none'",
    // 'unsafe-inline' for the frame's own inline script; 'unsafe-eval' so snippets may use
    // eval(); 'wasm-unsafe-eval' for Pyodide; blob: for workers and snippet modules.
    `script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:${allowNetwork ? ' https:' : ''}`,
    // data: for the Python module worker (module workers can't load from opaque blob: URLs).
    'worker-src blob: data:',
    `connect-src ${allowNetwork ? '*' : "'none'"}`,
  ].join('; ')
}

/** Make text safe to place inside an inline <script> element. */
export function escapeInlineScript(js: string): string {
  return js.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--')
}

export function buildSrcdoc(options: SandboxOptions): string {
  const script = [
    `const WORKER_SOURCE = ${JSON.stringify(workerSource)};`,
    `const PYTHON_WORKER_SOURCE = ${JSON.stringify(pythonWorkerSource)};`,
    frameSource,
  ].join('\n')
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${buildCsp(options)}">`,
    `</head><body><script>${escapeInlineScript(script)}</script></body></html>`,
  ].join('')
}
