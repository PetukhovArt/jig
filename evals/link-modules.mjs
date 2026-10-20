import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, rmdirSync, symlinkSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const CACHE_ENTRIES = new Set(['.cache', '.vite', '.vite-temp', '.vitest', '.eslintcache', '.tmp'])

const linkModules = (source, target) => {
  mkdirSync(target, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (CACHE_ENTRIES.has(entry.name)) continue
    const from = resolve(source, entry.name)
    const to = join(target, entry.name)
    if (entry.isFile()) copyFileSync(from, to)
    else symlinkSync(from, to, 'junction')
  }
}

const unlinkModules = (dir) => {
  if (!existsSync(dir)) return
  const unlink = (path) => {
    try {
      unlinkSync(path)
    } catch {
      rmdirSync(path)
    }
  }
  if (lstatSync(dir).isSymbolicLink()) return unlink(dir)
  for (const entry of readdirSync(dir)) if (lstatSync(join(dir, entry)).isSymbolicLink()) unlink(join(dir, entry))
}

export { CACHE_ENTRIES, linkModules, unlinkModules }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, target] = process.argv.slice(2)
  if (!source || !target) {
    process.stderr.write(`usage: node evals/link-modules.mjs <node_modules to share> <new node_modules dir>
Makes <new node_modules dir> a real directory whose packages are junctions into the shared one, so tools
that write caches under node_modules (.vite, .vitest, .cache) write into the new project, never the shared one.
`)
    process.exit(2)
  }
  linkModules(source, target)
}
