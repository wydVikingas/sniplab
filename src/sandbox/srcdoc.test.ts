import { describe, expect, it } from 'vitest'
import { buildCsp, buildSrcdoc, escapeInlineScript } from './srcdoc'

describe('sandbox srcdoc', () => {
  it('blocks network access by default', () => {
    const csp = buildCsp({ allowNetwork: false })
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("connect-src 'none'")
    expect(csp).not.toContain('https:')
  })

  it('opens fetch and https module imports when network is allowed', () => {
    const csp = buildCsp({ allowNetwork: true })
    expect(csp).toContain('connect-src *')
    expect(csp).toMatch(/script-src [^;]*https:/)
  })

  it('embeds the CSP and both runtime scripts', () => {
    const html = buildSrcdoc({ allowNetwork: false })
    expect(html).toContain(`content="${buildCsp({ allowNetwork: false })}"`)
    expect(html).toContain('const WORKER_SOURCE = ')
    expect(html).toContain('function startWorker()')
    expect(html).toContain('function startFrame(')
    // Exactly one script element: nothing inside it can close it early.
    expect(html.match(/<\/script>/g)).toHaveLength(1)
  })

  it('escapes sequences that would break out of an inline script', () => {
    expect(escapeInlineScript('"</script><b>"')).toBe('"<\\/script><b>"')
    expect(escapeInlineScript('"<!--"')).toBe('"<\\!--"')
  })
})
