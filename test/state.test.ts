import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildSync } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { jigPaths } from '../src/core/paths'
import { createSessionState, pruneStates, readState, sessionStatePath, writeState } from '../src/core/state'

const WRITERS = 4
const WRITES_PER_WRITER = 60
const SESSION = 'parallel-session'

let workDir: string

const writerScript = (stateModule: string): string => `
import { readFileSync } from 'node:fs'
import { createSessionState, sessionStatePath, writeState } from ${JSON.stringify(stateModule)}
const [root, writer, count] = process.argv.slice(2)
const path = sessionStatePath(root, ${JSON.stringify(SESSION)})
let torn = 0
for (let n = 0; n < Number(count); n++) {
  const state = createSessionState(${JSON.stringify(SESSION)}, {})
  state.sessionAtoms = Array.from({ length: 200 + n }, () => 'w' + writer + '-' + n)
  writeState(root, state)
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    continue
  }
  try {
    JSON.parse(text)
  } catch {
    torn++
  }
}
process.stdout.write(String(torn))
`

const runWriter = (script: string, root: string, writer: number): Promise<{ code: number | null; torn: number }> =>
  new Promise((done) => {
    const child = spawn(process.execPath, [script, root, String(writer), String(WRITES_PER_WRITER)], { windowsHide: true })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    child.on('close', (code) => done({ code, torn: Number(output) }))
  })

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'jig-state-'))
})

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true })
})

describe('session state', () => {
  it('round-trips a written state', () => {
    const root = join(workDir, 'roundtrip')
    const state = createSessionState('s-1', { 'a.ts': { mtimeMs: 1, size: 2 } }, new Date('2026-01-01T00:00:00Z'))
    writeState(root, state, new Date('2026-01-02T00:00:00Z'))
    expect(readState(root, 's-1')).toEqual({ ...state, updatedAt: '2026-01-02T00:00:00.000Z' })
    expect(readState(root, 'missing')).toBeUndefined()
  })

  it('keeps the file whole under parallel writers from several processes', async () => {
    const root = join(workDir, 'parallel')
    const bundle = join(workDir, 'state.mjs')
    buildSync({
      entryPoints: [join(import.meta.dirname, '..', 'src', 'core', 'state.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node20',
      outfile: bundle,
      logLevel: 'silent',
    })
    const script = join(workDir, 'writer.mjs')
    writeFileSync(script, writerScript(pathToFileURL(bundle).href))

    const results = await Promise.all(Array.from({ length: WRITERS }, (_, writer) => runWriter(script, root, writer)))

    expect(results).toEqual(Array.from({ length: WRITERS }, () => ({ code: 0, torn: 0 })))
    const final = JSON.parse(readFileSync(sessionStatePath(root, SESSION), 'utf8')) as { sessionAtoms: string[] }
    expect(final.sessionAtoms).toHaveLength(200 + WRITES_PER_WRITER - 1)
    expect(readdirSync(jigPaths(root).sessions)).toEqual([`${SESSION}.json`])
  }, 60_000)

  it('prunes states older than seven days', () => {
    const root = join(workDir, 'prune')
    writeState(root, createSessionState('old', {}))
    writeState(root, createSessionState('fresh', {}))
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    utimesSync(sessionStatePath(root, 'old'), eightDaysAgo, eightDaysAgo)
    expect(pruneStates(root)).toEqual(['old.json'])
    expect(readState(root, 'fresh')).toBeDefined()
  })
})
