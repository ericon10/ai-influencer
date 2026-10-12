import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

// Downloads provider outputs into our own storage (provider URLs expire).
// Guards against SSRF: https only, host allowlist per provider, private and
// loopback addresses refused after DNS resolution, redirects re-checked,
// and a hard size cap.

export class DownloadError extends Error {}

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number]
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  }
  const v6 = ip.toLowerCase()
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7))
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb') || v6.startsWith('ff')
}

export function hostAllowed(host: string, allowed: string[]): boolean {
  const h = host.toLowerCase()
  return allowed.some(a => h === a || h.endsWith(`.${a}`))
}

export async function assertSafeUrl(raw: string, allowed: string[]): Promise<URL> {
  let url: URL
  try { url = new URL(raw) } catch { throw new DownloadError('Output URL is not valid.') }
  if (url.protocol !== 'https:') throw new DownloadError('Output URLs must use https.')
  if (!hostAllowed(url.hostname, allowed)) throw new DownloadError(`Output host ${url.hostname} is not on the allowlist.`)
  const addrs = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true })
  if (addrs.some(a => isPrivateAddress(a.address))) throw new DownloadError('Output URL points at a private address.')
  return url
}

export async function safeDownload(raw: string, opts: { allowedHosts: string[]; maxBytes: number; timeoutMs: number; fetchImpl?: typeof fetch }): Promise<{ data: Buffer; contentType: string }> {
  const doFetch = opts.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs)
  try {
    let current = raw
    for (let hop = 0; hop < 4; hop++) {
      const url = await assertSafeUrl(current, opts.allowedHosts)
      const res = await doFetch(url, { redirect: 'manual', signal: controller.signal })
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        current = new URL(res.headers.get('location')!, url).toString()
        continue
      }
      if (!res.ok || !res.body) throw new DownloadError(`Download failed with status ${res.status}.`)
      const declared = Number(res.headers.get('content-length') ?? 0)
      if (declared > opts.maxBytes) throw new DownloadError('Output is larger than the size limit.')
      const chunks: Buffer[] = []
      let total = 0
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        total += chunk.length
        if (total > opts.maxBytes) throw new DownloadError('Output is larger than the size limit.')
        chunks.push(Buffer.from(chunk))
      }
      return { data: Buffer.concat(chunks), contentType: res.headers.get('content-type') ?? '' }
    }
    throw new DownloadError('Too many redirects.')
  } finally {
    clearTimeout(timer)
  }
}
