import { spawn } from 'node:child_process'
// Rspack has no --strictPort flag; keep the managed preview host/port arguments.
const args = process.argv.slice(2).filter((a) => a !== '--strictPort')
const child = spawn(
  process.execPath,
  ['node_modules/@rspack/cli/bin/rspack.js', 'serve', '-c', 'rspack.config.ts', ...args],
  { stdio: 'inherit' }
)
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('exit', (code) => process.exit(code ?? 0))
