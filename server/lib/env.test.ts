import { describe, expect, it } from 'vitest'
import { loadEnv, NotConfiguredError } from './env.js'

// A production deployment that is missing settings says which ones, by name,
// and never shows a value.

const KEY = `k1:${Buffer.alloc(32, 1).toString('base64')}`
const READY = {
  NODE_ENV: 'production', DATABASE_URL: 'postgresql://u:secret-pw@ep-x-pooler.us-east-1.aws.neon.tech/studio', STUDIO_MASTER_KEYS: KEY,
  STUDIO_SESSION_SECRET: 'session-secret', STORAGE_DRIVER: 's3', S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
  S3_BUCKET: 'studio', S3_ACCESS_KEY_ID: 'id', S3_SECRET_ACCESS_KEY: 'r2-secret',
}

describe('production settings', () => {
  it('names every missing setting', () => {
    let err: unknown
    try { loadEnv({ NODE_ENV: 'production', S3_SECRET_ACCESS_KEY: 'r2-secret' }) } catch (e) { err = e }
    expect(err).toBeInstanceOf(NotConfiguredError)
    const { missing, message } = err as NotConfiguredError
    expect(missing).toEqual(['DATABASE_URL', 'STUDIO_MASTER_KEYS', 'STUDIO_SESSION_SECRET', 'STORAGE_DRIVER=s3'])
    expect(message).not.toContain('r2-secret')
  })

  it('lists the R2 settings still missing once storage is s3, without values', () => {
    expect(() => loadEnv({ ...READY, S3_BUCKET: '', S3_ACCESS_KEY_ID: '' })).toThrow(/S3_BUCKET, S3_ACCESS_KEY_ID\.$/)
  })

  it('starts when everything is set', () => {
    expect(loadEnv(READY).isProduction).toBe(true)
  })
})
