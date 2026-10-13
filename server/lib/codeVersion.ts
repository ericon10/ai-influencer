import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// The worker's code version (owner, 2026-10-13): a hash of the files the
// worker is built from, which are a subset of Railway's watch paths
// (railway.json). The API and the worker compute it the same way, so when
// they differ the worker is still deploying the new code; a push that only
// touches the UI changes neither.

const SOURCES: Array<[dir: string, file: RegExp]> = [['server', /\.(ts|sql|json)$/], ['config', /\.ya?ml$/]]
const ROOT_FILES = ['package.json', 'package-lock.json']

export function codeFiles(root: string): string[] {
  const out: string[] = []
  const walk = (rel: string, re: RegExp) => {
    for (const name of readdirSync(join(root, rel)).sort()) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const path = `${rel}/${name}`
      if (statSync(join(root, path)).isDirectory()) walk(path, re)
      else if (re.test(name)) out.push(path)
    }
  }
  for (const [dir, re] of SOURCES) if (existsSync(join(root, dir))) walk(dir, re)
  for (const f of ROOT_FILES) if (existsSync(join(root, f))) out.push(f)
  return out.sort()
}

// Null when the sources are not there to hash (the version is then unknown).
export function codeVersion(root: string): string | null {
  const files = codeFiles(root)
  if (!files.some(f => f.startsWith('server/'))) return null
  const h = createHash('sha256')
  for (const f of files) {
    h.update(f).update('\0').update(readFileSync(join(root, f))).update('\0')
  }
  return h.digest('hex').slice(0, 10)
}
