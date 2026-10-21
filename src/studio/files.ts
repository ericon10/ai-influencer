import { ApiError } from './api'

// Files in the browser: whole folders dropped in, sheet names normalized,
// and direct uploads to storage (R2) so big images never pass through the
// API.

// "REF 00.png", "ref_3.jpg", "Callie REF-11 final.webp" -> "REF-00" etc.
export function sheetRefOf(name: string): string | null {
  const m = name.replace(/\.[a-z0-9]+$/i, '').toUpperCase().match(/REF[\s_-]*(\d{1,2})(?!\d)/)
  if (!m) return null
  const n = Number(m[1])
  return n >= 0 && n <= 13 ? `REF-${String(n).padStart(2, '0')}` : null
}

const IMAGE_EXT: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }

export function typeOf(file: File): string {
  if (file.type) return file.type
  return IMAGE_EXT[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? ''
}

interface Entry { isFile: boolean; isDirectory: boolean; name: string; file?(ok: (f: File) => void, err: (e: unknown) => void): void; createReader?(): { readEntries(ok: (e: Entry[]) => void, err: (e: unknown) => void): void } }

async function walk(entry: Entry, out: File[]): Promise<void> {
  if (entry.isFile && entry.file) {
    out.push(await new Promise<File>((ok, err) => entry.file!(ok, err)))
  } else if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader()
    // readEntries returns batches until it returns an empty one.
    for (;;) {
      const batch = await new Promise<Entry[]>((ok, err) => reader.readEntries(ok, err))
      if (!batch.length) break
      for (const e of batch) if (!e.name.startsWith('.')) await walk(e, out)
    }
  }
}

// Every file in a drop, including the contents of dropped folders.
export async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const items = Array.from(dt.items ?? [])
  const entries = items.map(i => (i as DataTransferItem & { webkitGetAsEntry?: () => Entry | null }).webkitGetAsEntry?.() ?? null)
  if (!entries.some(Boolean)) return Array.from(dt.files)
  const out: File[] = []
  for (const e of entries) if (e) await walk(e, out)
  return out
}

export interface UploadRef { uploadId: string; name: string; type: string }

async function getSlots(files: File[]): Promise<Array<{ uploadId: string; name: string; url: string; headers: Record<string, string> }>> {
  const res = await fetch('/api/v1/uploads', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-studio-request': '1' },
    body: JSON.stringify({ files: files.map(f => ({ name: f.name, type: typeOf(f), size: f.size })) }),
  })
  const json = await res.json().catch(() => null) as { slots?: Array<{ uploadId: string; name: string; url: string; headers: Record<string, string> }>; error?: { code?: string; message?: string } } | null
  if (!res.ok || !json?.slots) throw new ApiError(res.status, json?.error?.code ?? 'error', json?.error?.message ?? `Could not start the upload (${res.status}).`)
  return json.slots
}

// Uploads straight to storage, four at a time. Local development uploads
// through the Studio instead (the slot URL is the API's own).
export async function uploadFiles(files: File[], onProgress?: (done: number, total: number) => void): Promise<UploadRef[]> {
  if (!files.length) return []
  const slots = await getSlots(files)
  let done = 0
  const queue = files.map((f, i) => ({ f, slot: slots[i]! }))
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const { f, slot } = item
      const local = slot.url.startsWith('/')
      let res: Response
      try {
        res = await fetch(slot.url, {
          method: 'PUT', body: f,
          headers: local ? { ...slot.headers, 'x-studio-request': '1' } : slot.headers,
          credentials: local ? 'same-origin' : 'omit',
        })
      } catch {
        throw new ApiError(0, 'upload_blocked', `${f.name} could not reach storage. If this keeps happening, Settings, Storage shows the bucket rules that allow uploads from the Studio.`)
      }
      if (!res.ok) throw new ApiError(res.status, 'upload_failed', `${f.name} did not upload (${res.status}). Try again.`)
      done += 1
      onProgress?.(done, files.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, files.length) }, worker))
  return files.map((f, i) => ({ uploadId: slots[i]!.uploadId, name: f.name, type: typeOf(f) }))
}
