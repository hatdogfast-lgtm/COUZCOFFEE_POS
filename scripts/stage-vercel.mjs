import { cp, rm, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Put a copy of the built site at the repository root.
 *
 * Vite writes to `packages/web/dist`, which is also what Capacitor bundles, so
 * that is where it has to stay. Vercel, though, looks wherever its project
 * settings tell it to - and a Root Directory or a Framework Preset chosen in
 * the dashboard quietly overrides `vercel.json`, which is how a perfectly good
 * build fails with "No Output Directory named dist found".
 *
 * Rather than depend on a setting nobody can see from here, the build leaves
 * the site in both places. Whichever one Vercel looks in, it finds the same
 * files. The copy is ignored by git, so nothing is committed twice.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const from = resolve(root, 'packages/web/dist')
const to = resolve(root, 'dist')

const built = await stat(from).catch(() => null)
if (!built?.isDirectory()) {
  console.error(`[stage] ${from} does not exist — did the web build run?`)
  process.exit(1)
}

// Removed first so a file dropped from the build cannot survive in the copy.
await rm(to, { recursive: true, force: true })
await cp(from, to, { recursive: true })

console.log(`[stage] copied packages/web/dist to dist/ for hosting`)
