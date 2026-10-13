import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'

// One interface for file storage. Local disk for laptops and tests,
// S3-compatible (Cloudflare R2) for hosted deployments.
export interface BlobStore {
  readonly driver: 'local' | 's3' | 'memory'
  put(key: string, data: Buffer, contentType: string): Promise<void>
  get(key: string): Promise<Buffer>
  exists(key: string): Promise<boolean>
  delete(key: string): Promise<void>
  // A short-lived direct URL when the driver supports it; otherwise null and
  // the API streams the bytes after its own auth check.
  presignGet(key: string, ttlSeconds: number): Promise<string | null>
  // A short-lived URL the browser PUTs a file to directly (R2), so uploads
  // never pass through the API (Vercel caps request bodies at 4.5 MB).
  // Null when the driver has none; the API then takes the bytes itself.
  presignPut(key: string, contentType: string, ttlSeconds: number): Promise<string | null>
  // Lets the Studio's own pages upload straight to the bucket (CORS).
  ensureCors?(origins: string[]): Promise<{ ok: boolean; message: string }>
}

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
    async exists(key) {
      try { await stat(pathFor(key)); return true } catch { return false }
    },
    async delete(key) { await rm(pathFor(key), { force: true }) },
    async presignGet() { return null },
    async presignPut() { return null },
  }
}

export function createMemoryStore(): BlobStore {
  const files = new Map<string, Buffer>()
  return {
    driver: 'memory',
    async put(key, data) { assertSafeKey(key); files.set(key, Buffer.from(data)) },
    async get(key) {
      const f = files.get(key)
      if (!f) throw new Error(`No such blob: ${key}`)
      return f
    },
    async exists(key) { return files.has(key) },
    async delete(key) { files.delete(key) },
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
  const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand, GetBucketCorsCommand, PutBucketCorsCommand } = await import('@aws-sdk/client-s3')
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
    async exists(key) {
      try { await client.send(new HeadObjectCommand({ Bucket: o.bucket, Key: key })); return true } catch { return false }
    },
    async delete(key) { await client.send(new DeleteObjectCommand({ Bucket: o.bucket, Key: key })) },
    async presignGet(key, ttlSeconds) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: o.bucket, Key: key }), { expiresIn: ttlSeconds })
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
        const covered = origins.every(origin => have.some(r => (r.AllowedOrigins ?? []).includes(origin) && (r.AllowedMethods ?? []).includes('PUT')))
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
