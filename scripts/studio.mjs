// One command for local development: starts the Studio API (with its job
// worker) and the Vite dev server together. Ctrl+C stops both.
import { spawn } from 'node:child_process'

const procs = [
  spawn('npm', ['run', 'dev:api'], { stdio: 'inherit' }),
  spawn('npm', ['run', 'dev'], { stdio: 'inherit' }),
]
const stop = () => { for (const p of procs) p.kill('SIGINT') }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
for (const p of procs) p.on('exit', code => { if (code) process.exitCode = code })
