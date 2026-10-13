import { describe, expect, it } from 'vitest'
import { workerBaseUrl } from './wake.js'

// The worker's address is pasted by hand into the deployment settings, so it
// is taken with or without https:// and a trailing slash.
describe('worker address', () => {
  it('accepts the address however it was pasted', () => {
    expect(workerBaseUrl('ai-influencer-production-2eca.up.railway.app')).toBe('https://ai-influencer-production-2eca.up.railway.app')
    expect(workerBaseUrl(' https://w.example.com/ ')).toBe('https://w.example.com')
    expect(workerBaseUrl('http://localhost:8899')).toBe('http://localhost:8899')
    expect(workerBaseUrl('')).toBeNull()
    expect(workerBaseUrl(undefined)).toBeNull()
  })
})
