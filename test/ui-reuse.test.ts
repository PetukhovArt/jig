import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { git } from '../src/core/git'
import { ui } from '../src/ui/ui'

let root: string
let out: string[]
let err: string[]

const write = (file: string, text: string): void => {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), text)
}

const gitIn = (...args: string[]): void => {
  const result = git(['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], root)
  expect(result.ok, result.stderr).toBe(true)
}

const reuse = (...args: string[]): number => ui(['reuse', ...args], { cwd: root, io: { out: (text) => out.push(text), err: (text) => err.push(text) } })

const profile = (map: Record<string, string>): string =>
  JSON.stringify({
    ui: { targets: [{ name: 'web', runtime: 'browser', widths: [1280] }], themes: [{ name: 'light' }], components: { dirs: ['src/shared/ui'], map } },
  })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jig-ui-reuse-'))
  out = []
  err = []
  gitIn('init', '-q', '-b', 'main')
  write('.jig/config.jsonc', profile({ button: 'Button (@/shared/ui/buttons)', input: 'TextField' }))
  write('src/Old.tsx', 'export const Old = () => <button>old</button>\n')
  write('src/shared/ui/Button.tsx', 'export const Button = () => <button />\n')
  gitIn('add', '-A')
  gitIn('commit', '-q', '-m', 'base')
  gitIn('checkout', '-q', '-b', 'feat')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('jig ui reuse', () => {
  it('flags raw elements on lines the branch changes, in templates and in render calls, outside shared dirs and tests', () => {
    write('src/Old.tsx', 'export const Old = () => <button>old</button>\nexport const Added = () => <input value="a" />\n')
    write('src/Page.vue', '<template>\n  <div>\n    <button class="x">go</button>\n    <Button>ok</Button>\n  </div>\n</template>\n')
    write('src/view.tsx', "export const view = () => h('button', { onClick }, 'go')\n")
    write('src/shared/ui/Field.tsx', 'export const Field = () => <input />\n')
    write('src/Page.test.tsx', 'it("x", () => render(<button />))\n')
    gitIn('add', '-A')
    gitIn('commit', '-q', '-m', 'feat')
    write('src/Late.svelte', '<button on:click={go}>late</button>\n')

    expect(reuse('--base', 'main', '--json')).toBe(1)
    const found = JSON.parse(out.join('')).findings.map((finding: { file: string; line: number; element: string; use: string }) => `${finding.file}:${finding.line} ${finding.element} → ${finding.use}`)
    expect(found.sort()).toEqual([
      'src/Late.svelte:1 button → Button (@/shared/ui/buttons)',
      'src/Old.tsx:2 input → TextField',
      'src/Page.vue:3 button → Button (@/shared/ui/buttons)',
      'src/view.tsx:1 button → Button (@/shared/ui/buttons)',
    ])
  })

  it('prints the spec line and exits 0 when the changed lines use components', () => {
    write('src/Fine.tsx', 'export const Fine = () => <Button>ok</Button>\n')
    expect(reuse('--base', 'main')).toBe(0)
    expect(out.join('')).toMatch(/^ui reuse: no raw elements on changed lines/)
    out = []
    write('src/Raw.tsx', 'export const Raw = () => <button>x</button>\n')
    expect(reuse('--base', 'main')).toBe(1)
    expect(out.join('')).toContain('src/Raw.tsx:1 ui/raw-element → use Button (@/shared/ui/buttons) instead of <button>')
  })

  it('names the library component where the map points at the library', () => {
    write('.jig/config.jsonc', profile({ button: 'v-btn' }))
    write('src/Page.vue', '<template><button>go</button></template>\n')
    expect(reuse('--base', 'main')).toBe(1)
    expect(out.join('')).toContain('src/Page.vue:1 ui/raw-element → use v-btn instead of <button>')
  })

  it('refuses a profile without a component map', () => {
    write('.jig/config.jsonc', profile({}))
    expect(() => reuse()).toThrow(/ui\.components\.map is empty/)
  })
})
