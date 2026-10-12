import { describe, expect, it } from 'vitest'
import { assertSafeUrl, hostAllowed } from './download'

describe('output download guards', () => {
  it('matches allowlisted hosts by suffix only', () => {
    expect(hostAllowed('cdn.higgsfield.ai', ['higgsfield.ai'])).toBe(true)
    expect(hostAllowed('higgsfield.ai', ['higgsfield.ai'])).toBe(true)
    expect(hostAllowed('evilhiggsfield.ai', ['higgsfield.ai'])).toBe(false)
    expect(hostAllowed('higgsfield.ai.evil.com', ['higgsfield.ai'])).toBe(false)
  })

  it('refuses http, unlisted hosts and private addresses', async () => {
    await expect(assertSafeUrl('http://cdn.higgsfield.ai/x.png', ['higgsfield.ai'])).rejects.toThrow(/https/)
    await expect(assertSafeUrl('https://example.org/x.png', ['higgsfield.ai'])).rejects.toThrow(/allowlist/)
    await expect(assertSafeUrl('https://127.0.0.1/x.png', ['127.0.0.1'])).rejects.toThrow(/private/)
    await expect(assertSafeUrl('https://169.254.169.254/latest', ['169.254.169.254'])).rejects.toThrow(/private/)
    await expect(assertSafeUrl('https://[::1]/x', ['[::1]', '::1'])).rejects.toThrow()
  })
})
