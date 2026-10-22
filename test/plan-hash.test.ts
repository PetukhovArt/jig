import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { planInputsHash } from '../src/core/plan'

const dir = mkdtempSync(join(tmpdir(), 'jig-plan-hash-'))

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('planInputsHash', () => {
  it('changes when the plugin bundle is rebuilt at the same version', () => {
    const project = join(dir, 'project')
    const plugin = join(dir, 'plugin')
    mkdirSync(project, { recursive: true })
    mkdirSync(join(plugin, 'bin'), { recursive: true })
    const bundle = join(plugin, 'bin', 'jig.mjs')
    writeFileSync(bundle, 'old')
    utimesSync(bundle, 1_000, 1_000)
    const before = planInputsHash(project, plugin)
    writeFileSync(bundle, 'new bundle')
    utimesSync(bundle, 2_000, 2_000)
    expect(planInputsHash(project, plugin)).not.toBe(before)
  })
})
