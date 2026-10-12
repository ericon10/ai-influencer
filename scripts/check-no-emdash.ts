// Fails when an em-dash (U+2014) appears in Studio source, config, docs,
// or (with --commits <range>) in commit messages. Standing rule from
// CLAUDE.md: no em-dashes anywhere.
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'

const EM_DASH = String.fromCharCode(0x2014)
const ROOT = process.cwd()

// Studio-owned paths. Legacy files are retired, not edited (see DECISIONS.md B13).
const SCAN = ['server', 'config', 'src/studio', 'docs/studio', 'scripts', 'fixtures', 'api/studio.ts', 'CLAUDE.md', 'SPEC.md', '.env.example', '.github']
const TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.yaml', '.yml', '.md', '.css', '.html', '.sql', '.txt', '.example', ''])
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.data'])

function walk(path: string, out: string[]): void {
  let st
  try { st = statSync(path) } catch { return }
  if (st.isDirectory()) {
    for (const name of readdirSync(path)) {
      if (!SKIP_DIRS.has(name)) walk(join(path, name), out)
    }
  } else if (TEXT_EXT.has(extname(path))) {
    out.push(path)
  }
}

export function findEmDashes(text: string): number[] {
  const lines: number[] = []
  text.split('\n').forEach((line, i) => { if (line.includes(EM_DASH)) lines.push(i + 1) })
  return lines
}

function main(): void {
  const problems: string[] = []
  const files: string[] = []
  for (const p of SCAN) walk(join(ROOT, p), files)
  for (const f of files) {
    for (const line of findEmDashes(readFileSync(f, 'utf8'))) {
      problems.push(`${relative(ROOT, f)}:${line}`)
    }
  }

  const i = process.argv.indexOf('--commits')
  const range = i > -1 ? process.argv[i + 1] : undefined
  if (range) {
    const log = execFileSync('git', ['log', '--format=%H%x00%B%x01', range], { encoding: 'utf8' })
    for (const entry of log.split('\x01')) {
      const [hash, body] = entry.trim().split('\x00')
      if (hash && body && body.includes(EM_DASH)) problems.push(`commit ${hash.slice(0, 10)}`)
    }
  }

  if (problems.length) {
    console.error(`Em-dash found (standing rule: none anywhere):\n  ${problems.join('\n  ')}`)
    process.exit(1)
  }
  console.log(`No em-dashes in ${files.length} Studio files${range ? ' or commit messages' : ''}.`)
}

if (process.argv[1] && process.argv[1].endsWith('check-no-emdash.ts')) main()
