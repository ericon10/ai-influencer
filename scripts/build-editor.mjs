// Builds the Studio's editor (DECISIONS G29): the owner's OpenReel fork at
// the commit pinned in editor/openreel.json, served at /editor/. Output goes
// to dist-editor/; with --into <dir> it is also copied to <dir>/editor
// (the Vercel build passes --into dist). A local clone can be used instead
// with OPENREEL_DIR=/path/to/openreel-video.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = process.cwd()
const pin = JSON.parse(readFileSync(join(root, 'editor/openreel.json'), 'utf8'))
const out = join(root, 'dist-editor')
const intoArg = process.argv.indexOf('--into')
const into = intoArg > 0 ? resolve(process.argv[intoArg + 1]) : null
const local = process.env.OPENREEL_DIR ? resolve(process.env.OPENREEL_DIR) : null
const src = local ?? join(root, '.data', 'openreel')
const stamp = join(out, '.openreel-commit')

const run = (cmd, args, cwd) => {
  console.log(`[editor] ${cmd} ${args.join(' ')}`)
  execFileSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, COREPACK_ENABLE_STRICT: '0', COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' } })
}

const upToDate = !local && existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === pin.commit
if (upToDate) {
  console.log(`[editor] dist-editor is already at ${pin.commit.slice(0, 7)}`)
} else {
  if (!local) {
    if (!existsSync(join(src, '.git'))) {
      rmSync(src, { recursive: true, force: true })
      run('git', ['clone', '--depth', '1', '--branch', pin.branch, pin.repo, src], root)
    }
    run('git', ['fetch', '--depth', '1', 'origin', pin.commit], src)
    run('git', ['checkout', '--detach', pin.commit], src)
  }
  // pnpm through corepack (the fork pins its pnpm version).
  const pnpm = (args, cwd) => run('corepack', ['pnpm', ...args], cwd)
  pnpm(['install', '--filter', '@openreel/web...', '--frozen-lockfile'], src)
  // The small AssemblyScript helpers (FFT, WAV, beat detection).
  pnpm(['--filter', '@openreel/core', 'build:wasm'], src)
  run(join(src, 'apps/web/node_modules/.bin/vite'), ['build', '--base', '/editor/', '--outDir', out, '--emptyOutDir'], join(src, 'apps/web'))
  // ffmpeg.wasm served next to the editor, so the isolated page never
  // needs a CDN.
  const pnpmDir = join(src, 'node_modules/.pnpm')
  const core = readdirSync(pnpmDir).find(d => /^@ffmpeg\+core@0\.12\.6/.test(d))
  if (!core) throw new Error('@ffmpeg/core 0.12.6 is missing from the editor install')
  mkdirSync(join(out, 'ffmpeg'), { recursive: true })
  cpSync(join(pnpmDir, core, 'node_modules/@ffmpeg/core/dist/esm'), join(out, 'ffmpeg'), { recursive: true })
  writeFileSync(stamp, `${local ? 'local' : pin.commit}\n`)
}
if (into) {
  rmSync(join(into, 'editor'), { recursive: true, force: true })
  cpSync(out, join(into, 'editor'), { recursive: true })
  console.log(`[editor] copied to ${join(into, 'editor')}`)
}
