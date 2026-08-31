// Runs the sync server and the web app together, with zero extra dependencies.
import { spawn } from 'node:child_process'
import process from 'node:process'

const targets = [
  { name: 'server', color: '\x1b[36m', args: ['run', 'dev', '--workspace', '@pos/server'] },
  { name: 'web   ', color: '\x1b[35m', args: ['run', 'dev', '--workspace', '@pos/web'] },
]

const children = targets.map(({ name, color, args }) => {
  const child = spawn('npm', args, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const prefix = `${color}[${name}]\x1b[0m `
  const pipe = (stream, out) => {
    let buffer = ''
    stream.on('data', (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) out.write(prefix + line + '\n')
    })
  }
  pipe(child.stdout, process.stdout)
  pipe(child.stderr, process.stderr)
  return child
})

const shutdown = () => {
  for (const child of children) child.kill()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
