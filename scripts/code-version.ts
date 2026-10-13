// Prints the worker's code version (server/lib/codeVersion.ts). The worker's
// Docker build saves it next to the bundle.
import { codeVersion } from '../server/lib/codeVersion.js'

process.stdout.write(`${codeVersion(process.cwd()) ?? 'unknown'}\n`)
