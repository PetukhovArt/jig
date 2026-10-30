import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { git } from '../src/core/git'
import { findImporters, flowIndex, type ChangedFile } from '../src/review/flow-index'

const STORE = [
  "import { defineStore } from 'pinia'",
  "import { api } from '@/shared/api'",
  "export const useJournalStore = defineStore('journal', () => {",
  "  const rows = ref([])",
  "  watch(() => filters.value, reload)",
  "  const reload = () => api.get('/journal/events')",
  "  window.addEventListener('focus', reload)",
  "  ipcRenderer.invoke('journal:export')",
  '  setTimeout(reload, 1000)',
  '})',
].join('\n')

describe('flow index', () => {
  const dirs: string[] = []
  afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

  it('lists the flow sites of a changed script by line and kind, marking the lines the diff adds', () => {
    const file: ChangedFile = { path: 'src/journal/store.ts', partition: 'p2', source: STORE, added: new Set([3, 5]) }
    const lines = flowIndex([file], []).split('\n')
    expect(lines).toContain('== src/journal/store.ts [p2] changed +3,5')
    expect(lines).toContain('imports: pinia, @/shared/api')
    expect(lines).toContain('exports: useJournalStore')
    expect(lines.filter((line) => /^L\d/.test(line)).map((line) => line.split(/\s+/).slice(0, 2).join(' '))).toEqual([
      'L3* store',
      'L5* watch',
      'L6 request',
      'L7 event',
      'L8 ipc',
      'L9 timer',
    ])
  })

  it('gives a file of an unknown extension its imports and no sites', () => {
    const file: ChangedFile = { path: 'tools/build.py', partition: 'p1', source: "from x import y\nrequire('./lib')\nsetTimeout(run)\n", added: new Set() }
    const section = flowIndex([file], []).split('\n').filter((line) => line.startsWith('L'))
    expect(section).toEqual([])
  })

  it('finds the direct importers of a changed file through aliases and lists where they use what they import', () => {
    const root = mkdtempSync(join(tmpdir(), 'jig-flow-index-'))
    dirs.push(root)
    const write = (path: string, text: string): void => {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), text)
    }
    expect(git(['init', '-q'], root).ok).toBe(true)
    write('src/journal/store.ts', STORE)
    write('src/widgets/panel.vue', "<script setup>\nimport { useJournalStore as useStore } from '@/journal/store'\nconst store = useStore()\nonMounted(() => store.reload())\n</script>\n")
    write('src/other/unrelated.ts', "import { x } from './x'\nexport const y = x\n")

    const importers = findImporters(root, ['src/journal/store.ts'])
    const lines = flowIndex([], importers).split('\n')

    expect(importers.map((importer) => importer.path)).toEqual(['src/widgets/panel.vue'])
    expect(lines).toContain('== src/widgets/panel.vue [importer] of src/journal/store.ts')
    expect(lines.filter((line) => /^L\d/.test(line)).map((line) => line.split(/\s+/).slice(0, 2).join(' '))).toEqual(['L3 store-use'])
  })
})
