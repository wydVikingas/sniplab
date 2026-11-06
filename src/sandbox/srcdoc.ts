import frameSource from './runtime/frame.js?raw'
import workerSource from './runtime/worker.js?raw'

export interface SandboxOptions {
  /** Allow fetch/WebSocket to any host and `import()` of modules from https URLs. */
  allowNetwork: boolean
}

/**
 * Content-Security-Policy for the sandbox iframe. Workers created from blob: URLs inherit
 * it, so this is what actually constrains user code.
 */
export function buildCsp({ allowNetwork }: SandboxOptions): string {
  return [
    "default-src 'none'",
    // 'unsafe-inline' for the frame's own inline script; 'unsafe-eval' so snippets may use
    // eval(); blob: for the worker and the snippet module.
    `script-src 'unsafe-inline' 'unsafe-eval' blob:${allowNetwork ? ' https:' : ''}`,
    'worker-src blob:',
    `connect-src ${allowNetwork ? '*' : "'none'"}`,
  ].join('; ')
}

/** Make text safe to place inside an inline <script> element. */
export function escapeInlineScript(js: string): string {
  return js.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--')
}

export function buildSrcdoc(options: SandboxOptions): string {
  const script = `const WORKER_SOURCE = ${JSON.stringify(workerSource)};\n${frameSource}`
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${buildCsp(options)}">`,
    `</head><body><script>${escapeInlineScript(script)}</script></body></html>`,
  ].join('')
}
