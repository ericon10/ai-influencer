import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

// One interface for file storage. Local disk for laptops and tests,
// S3-compatible (Cloudflare R2) for hosted deployments.
export interface BlobStore {
  readonly driver: 'local' | 's3' | 'memory'
  put(key: string, data: Buffer, contentType: string): Promise<void>
  get(key: string): Promise<Buffer>
  // Part of a file and its full size, for the editor's same-origin
  // fallback (a Vercel function answers up to 4.5 MB).
  getRange(key: string, start: number, end: number): Promise<{ data: Buffer; total: number }>
  exists(key: string): Promise<boolean>
  // Every file under a prefix, with its size and when it was written (the
  // daily clean and the storage readout, owner 2026-10-15).
  list(prefix: string): Promise<StoredFile[]>
  delete(key: string): Promise<void>
  // A short-lived direct URL when the driver supports it; otherwise null and
  // the API streams the bytes after its own auth check.
  // `downloadName` makes the browser save the file under that name.
  // Signed on the hour, so one file has one link for the hour and the
  // browser can keep it. `cors` gives a separate link for pages that read
  // the file with CORS (the editor), so a kept answer made for a plain
  // <img> or <video> (no CORS header) is never reused for them.
  presignGet(key: string, ttlSeconds: number, opts?: { downloadName?: string; cors?: boolean }): Promise<string | null>
  // A short-lived URL the browser PUTs a file to directly (R2), so uploads
  // never pass through the API (Vercel caps request bodies at 4.5 MB).
  // Null when the driver has none; the API then takes the bytes itself.
  presignPut(key: string, contentType: string, ttlSeconds: number): Promise<string | null>
  // Lets the Studio's own pages upload straight to the bucket (CORS).
  ensureCors?(origins: string[]): Promise<{ ok: boolean; message: string }>
  // An R2 lifecycle rule that deletes files under a prefix after some days,
  // when the key may set one (the daily clean does the same anyway).
  ensureExpiry?(prefix: string, days: number): Promise<{ ok: boolean; message: string }>
}

export interface StoredFile { key: string; size: number; lastModified: Date }

// The bucket's CORS rules for direct browser uploads. Also shown in Settings
// for pasting into the Cloudflare dashboard when the key cannot set them.
export function corsRules(origins: string[]) {
  return [{ AllowedOrigins: origins, AllowedMethods: ['PUT', 'GET', 'HEAD'], AllowedHeaders: ['content-type'], ExposeHeaders: ['etag'], MaxAgeSeconds: 3600 }]
}

const KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9._\-/]*$/

export function assertSafeKey(key: string): void {
  if (!KEY_RE.test(key) || key.includes('..') || key.includes('//')) {
    throw new Error(`Unsafe storage key: ${key}`)
  }
}

export function createLocalStore(rootDir: string): BlobStore {
  const root = resolve(rootDir)
  const pathFor = (key: string) => {
    assertSafeKey(key)
    const p = resolve(root, key)
    if (!p.startsWith(root + sep)) throw new Error(`Storage key escapes root: ${key}`)
    return p
  }
  return {
    driver: 'local',
    async put(key, data) {
      const p = pathFor(key)
      await mkdir(dirname(p), { recursive: true })
      await writeFile(p, data)
    },
    async get(key) { return readFile(pathFor(key)) },
    async getRange(key, start, end) {
      const all = await readFile(pathFor(key))
      return { data: all.subarray(start, Math.min(end, all.length - 1) + 1), total: all.length }
    },
    async exists(key) {
      try { await stat(pathFor(key)); return true } catch { return false }
    },
    async delete(key) { await rm(pathFor(key), { force: true }) },
    async list(prefix) {
      const out: StoredFile[] = []
      const walk = async (dir: string): Promise<void> => {
        let entries: Dirent[]
        try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
        for (const e of entries) {
          const p = join(dir, e.name)
          if (e.isDirectory()) await walk(p)
          else {
            const key = relative(root, p).split(sep).join('/')
            if (!key.startsWith(prefix)) continue
            const st = await stat(p)
            out.push({ key, size: st.size, lastModified: st.mtime })
          }
        }
      }
      // Walk from the deepest folder the prefix names.
      const base = prefix.includes('/') ? prefix.slice(0, prefix.lastIndexOf('/')) : ''
      await walk(base ? resolve(root, base) : root)
      return out
    },
    async presignGet() { return null },
    async presignPut() { return null },
  }
}

export function createMemoryStore(): BlobStore {
  const files = new Map<string, Buffer>()
  const written = new Map<string, Date>()
  return {
    driver: 'memory',
    async put(key, data) { assertSafeKey(key); files.set(key, Buffer.from(data)); written.set(key, new Date()) },
    async get(key) {
      const f = files.get(key)
      if (!f) throw new Error(`No such blob: ${key}`)
      return f
    },
    async getRange(key, start, end) {
      const f = files.get(key)
      if (!f) throw new Error(`No such blob: ${key}`)
      return { data: f.subarray(start, Math.min(end, f.length - 1) + 1), total: f.length }
    },
    async exists(key) { return files.has(key) },
    async delete(key) { files.delete(key); written.delete(key) },
    async list(prefix) { return [...files].filter(([k]) => k.startsWith(prefix)).map(([key, data]) => ({ key, size: data.length, lastModified: written.get(key) ?? new Date() })) },
    async presignGet() { return null },
    async presignPut() { return null },
  }
}

export interface S3Options {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

export async function createS3Store(o: S3Options): Promise<BlobStore> {
  const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand, GetBucketCorsCommand, PutBucketCorsCommand, ListObjectsV2Command, GetBucketLifecycleConfigurationCommand, PutBucketLifecycleConfigurationCommand } = await import('@aws-sdk/client-s3')
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')
  const client = new S3Client({
    region: o.region,
    endpoint: o.endpoint || undefined,
    credentials: { accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey },
  })
  return {
    driver: 's3',
    async put(key, data, contentType) {
      assertSafeKey(key)
      await client.send(new PutObjectCommand({ Bucket: o.bucket, Key: key, Body: data, ContentType: contentType }))
    },
    async get(key) {
      const r = await client.send(new GetObjectCommand({ Bucket: o.bucket, Key: key }))
      return Buffer.from(await r.Body!.transformToByteArray())
    },
    async getRange(key, start, end) {
      const r = await client.send(new GetObjectCommand({ Bucket: o.bucket, Key: key, Range: `bytes=${start}-${end}` }))
      const total = Number(/\/(\d+)$/.exec(r.ContentRange ?? '')?.[1] ?? r.ContentLength ?? 0)
      return { data: Buffer.from(await r.Body!.transformToByteArray()), total }
    },
    async exists(key) {
      try { await client.send(new HeadObjectCommand({ Bucket: o.bucket, Key: key })); return true } catch { return false }
    },
    async delete(key) { await client.send(new DeleteObjectCommand({ Bucket: o.bucket, Key: key })) },
    async list(prefix) {
      const out: StoredFile[] = []
      let token: string | undefined
      do {
        const r = await client.send(new ListObjectsV2Command({ Bucket: o.bucket, Prefix: prefix, ContinuationToken: token }))
        for (const x of r.Contents ?? []) if (x.Key) out.push({ key: x.Key, size: x.Size ?? 0, lastModified: x.LastModified ?? new Date(0) })
        token = r.IsTruncated ? r.NextContinuationToken : undefined
      } while (token)
      return out
    },
    async ensureExpiry(prefix, days) {
      const id = `studio-expire-${prefix.replace(/[^a-z0-9]+/gi, '-')}`
      try {
        // Only "no rules yet" reads as empty: any other failure stops here,
        // so the bucket's own rules are never overwritten by mistake.
        const current = await client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: o.bucket })).catch((e: Error & { name?: string; Code?: string }) => {
          if (e.name === 'NoSuchLifecycleConfiguration' || e.Code === 'NoSuchLifecycleConfiguration') return null
          throw e
        })
        const rules = current?.Rules ?? []
        if (rules.some(r => r.ID === id && r.Expiration?.Days === days)) return { ok: true, message: `Files under ${prefix} already expire after ${days} day${days === 1 ? '' : 's'}.` }
        const next = [...rules.filter(r => r.ID !== id), { ID: id, Status: 'Enabled' as const, Filter: { Prefix: prefix }, Expiration: { Days: days } }]
        await client.send(new PutBucketLifecycleConfigurationCommand({ Bucket: o.bucket, LifecycleConfiguration: { Rules: next } }))
        return { ok: true, message: `Set: files under ${prefix} expire after ${days} day${days === 1 ? '' : 's'}.` }
      } catch (e) {
        return { ok: false, message: `The storage key cannot set a lifecycle rule (${(e as Error).message.slice(0, 120)}); the daily clean deletes them instead.` }
      }
    },
    async presignGet(key, ttlSeconds, opts) {
      const disposition = opts?.downloadName ? `attachment; filename="${opts.downloadName.replace(/[^\w.-]+/g, '_')}"` : opts?.cors ? 'inline' : undefined
      const hour = 3_600_000
      const signingDate = new Date(Math.floor(Date.now() / hour) * hour)
      return getSignedUrl(client, new GetObjectCommand({ Bucket: o.bucket, Key: key, ...(disposition ? { ResponseContentDisposition: disposition } : {}) }), { expiresIn: ttlSeconds + 3600, signingDate })
    },
    async presignPut(key, contentType, ttlSeconds) {
      assertSafeKey(key)
      return getSignedUrl(client, new PutObjectCommand({ Bucket: o.bucket, Key: key, ContentType: contentType }), { expiresIn: ttlSeconds })
    },
    async ensureCors(origins) {
      const want = corsRules(origins)
      try {
        const current = await client.send(new GetBucketCorsCommand({ Bucket: o.bucket })).catch(() => null)
        const have = current?.CORSRules ?? []
        // The editor reads files straight from storage too (GET), so both.
        const covered = origins.every(origin => have.some(r => (r.AllowedOrigins ?? []).includes(origin) && ['PUT', 'GET'].every(m => (r.AllowedMethods ?? []).includes(m))))
        if (covered) return { ok: true, message: 'Direct uploads are allowed for this Studio.' }
        await client.send(new PutBucketCorsCommand({ Bucket: o.bucket, CORSConfiguration: { CORSRules: want } }))
        return { ok: true, message: 'Set the bucket CORS rules for direct uploads.' }
      } catch (e) {
        const name = (e as { name?: string }).name ?? ''
        return { ok: false, message: name === 'AccessDenied' || /denied|forbidden/i.test((e as Error).message) ? 'The storage key cannot change the bucket CORS rules. Add them in the Cloudflare dashboard (Settings, Storage shows them).' : `Could not check the bucket CORS rules: ${(e as Error).message}` }
      }
    },
  }
}
