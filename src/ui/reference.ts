import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { loadConfig } from '../core/config'
import { EXIT_FINDINGS, EXIT_USAGE, projectRootOf, UsageError, type UiContext, type UiSubcommand } from './command'
import { recordPassed } from './proof'
import { attachFile, readReferences, referenceDir, REFERENCE_IMAGE, REFERENCE_TREE, writeReferences, type ReferenceEntry, type References } from './references'
import { fillTemplate, failureOf, shellRunner } from './run'
import { parseTree } from './tree'
import { attachRule } from '../pre-mr/ui-requirements'

export const REFERENCE_USAGE = `usage: jig ui reference
       jig ui reference add "<source>" [--covers "<screen or state>"] [--fetch]
       jig ui reference none "<reason>"
       jig ui reference attach <n> [--image <png>] [--tree <json>] [--fetch]
       jig ui reference attach <n> --none "<why no image or tree can be made>"

add      list one reference of the task: its source exactly as the user gave it (a link, a path, a name) and the screen or state it covers
none     the task has no reference: the user said so, answered so, or nobody can be asked (afk)
attach   give reference <n> its jig-format files: a PNG and a node tree (schema/ui-tree.schema.json); jig pre-mr asks this for every listed reference
--none   reference <n> has no visual form (a text spec): its criteria go to the reviewer; never for a design, a screenshot or an export
--fetch  with ui.reference.fetch set in .jig/config.local.jsonc: jig runs it for the source and attaches {out}/image.png and {out}/tree.json
no args  print the list`

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const emptyReferences = (): References => ({ version: 1, entries: [] })

const describeEntry = (entry: ReferenceEntry): string => {
  const files = [entry.image === undefined ? undefined : 'image', entry.tree === undefined ? undefined : 'tree'].filter((part) => part !== undefined)
  const state = entry.unattached === undefined ? (files.length === 0 ? 'no files attached' : files.join(', ')) : `no files: ${entry.unattached}`
  return `${entry.n}  ${entry.source}${entry.covers === undefined ? '' : `  covers: ${entry.covers}`}  [${state}]`
}

const list = (root: string, ctx: UiContext): number => {
  const references = readReferences(root)
  if (references === undefined) {
    ctx.io.out('no references recorded for this branch\n')
    return 0
  }
  const lines = references.none === undefined ? references.entries.map(describeEntry) : [`none: ${references.none}`]
  ctx.io.out(`${lines.join('\n')}\n`)
  return 0
}

const fetchInto = (root: string, entry: ReferenceEntry, ctx: UiContext): ReferenceEntry => {
  const config = loadConfig(root)
  if (config.error !== undefined) throw new Error(`config: ${config.error}`)
  const template = config.ui?.reference?.fetch
  if (template === undefined) throw new UsageError('--fetch: ui.reference.fetch is not set; put it in .jig/config.local.jsonc')
  const out = referenceDir(root, entry.n)
  const result = (ctx.run ?? shellRunner)(fillTemplate(template, { source: entry.source, out }), root)
  if (result.code !== 0) throw new Error(`ui.reference.fetch failed for reference ${entry.n}: ${failureOf(result)}`)
  const image = join(out, REFERENCE_IMAGE)
  const tree = join(out, REFERENCE_TREE)
  if (!existsSync(image) && !existsSync(tree)) throw new Error(`ui.reference.fetch wrote neither ${image} nor ${tree}`)
  return attachChecked(root, entry, existsSync(image) ? image : undefined, existsSync(tree) ? tree : undefined)
}

const attachChecked = (root: string, entry: ReferenceEntry, image: string | undefined, tree: string | undefined): ReferenceEntry => {
  let next = entry
  if (image !== undefined) {
    if (!existsSync(image)) throw new UsageError(`${image}: no such file`)
    if (!readFileSync(image).subarray(0, 8).equals(PNG_SIGNATURE)) throw new UsageError(`${image}: not a PNG file`)
    next = attachFile(root, next, 'image', image)
  }
  if (tree !== undefined) {
    if (!existsSync(tree)) throw new UsageError(`${tree}: no such file`)
    const parsed = parseTree(readFileSync(tree, 'utf8'))
    if (parsed.tree === undefined) throw new UsageError(`${tree} is not a jig node tree (schema/ui-tree.schema.json):\n${parsed.errors.join('\n')}`)
    next = attachFile(root, next, 'tree', tree)
  }
  return next
}

const replaceEntry = (references: References, entry: ReferenceEntry): References => ({ ...references, entries: references.entries.map((own) => (own.n === entry.n ? entry : own)) })

const add = (args: string[], root: string, ctx: UiContext): number => {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: { covers: { type: 'string' }, fetch: { type: 'boolean' } } })
  const source = positionals.join(' ').trim()
  if (source === '') throw new UsageError(REFERENCE_USAGE)
  const current = readReferences(root) ?? emptyReferences()
  const n = current.entries.reduce((max, entry) => Math.max(max, entry.n), 0) + 1
  const covers = values.covers?.trim()
  const entry: ReferenceEntry = { n, source, ...(covers === undefined || covers === '' ? {} : { covers }) }
  const entries = [...current.entries, entry]
  writeReferences(root, { version: 1, entries })
  ctx.io.out(`reference ${n} listed\n`)
  if (!recordPassed(root, 'ui-reference', `jig ui reference add: ${entries.length} references listed`, ctx.io)) return EXIT_FINDINGS
  if (values.fetch !== true) return 0
  writeReferences(root, replaceEntry({ version: 1, entries }, fetchInto(root, entry, ctx)))
  ctx.io.out(`reference ${n} fetched\n`)
  return 0
}

const none = (args: string[], root: string, ctx: UiContext): number => {
  const { positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {} })
  const reason = positionals.join(' ').trim()
  if (reason === '') throw new UsageError(REFERENCE_USAGE)
  const current = readReferences(root)
  if ((current?.entries.length ?? 0) > 0) throw new UsageError('references are already listed: none would contradict them')
  writeReferences(root, { version: 1, none: reason, entries: [] })
  return recordPassed(root, 'ui-reference', `jig ui reference none: ${reason}`, ctx.io) ? 0 : EXIT_FINDINGS
}

const attach = (args: string[], root: string, ctx: UiContext): number => {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: { image: { type: 'string' }, tree: { type: 'string' }, fetch: { type: 'boolean' }, none: { type: 'string' } },
  })
  const n = Number(positionals[0])
  const files = values.image !== undefined || values.tree !== undefined || values.fetch === true
  const reason = values.none?.trim()
  if (positionals.length !== 1 || !Number.isInteger(n) || files === (reason !== undefined) || reason === '') throw new UsageError(REFERENCE_USAGE)
  const references = readReferences(root)
  const entry = references?.entries.find((own) => own.n === n)
  if (references === undefined || entry === undefined) throw new UsageError(`no reference ${n}: list it first with jig ui reference add "<source>"`)
  const next = reason === undefined ? attachChecked(root, values.fetch === true ? fetchInto(root, entry, ctx) : entry, values.image === undefined ? undefined : resolve(ctx.cwd, values.image), values.tree === undefined ? undefined : resolve(ctx.cwd, values.tree)) : { ...entry, unattached: reason }
  writeReferences(root, replaceEntry(references, next))
  ctx.io.out(`${describeEntry(next)}\n`)
  return recordPassed(root, attachRule(n), `jig ui reference attach ${n}: ${reason === undefined ? 'files attached' : `none: ${reason}`}`, ctx.io) ? 0 : EXIT_FINDINGS
}

export const reference: UiSubcommand = (args, ctx) => {
  const [action, ...rest] = args
  const root = projectRootOf(ctx.cwd)
  if (action === undefined) return list(root, ctx)
  if (action === 'add') return add(rest, root, ctx)
  if (action === 'none') return none(rest, root, ctx)
  if (action === 'attach') return attach(rest, root, ctx)
  ctx.io.err(`jig: ${REFERENCE_USAGE}\n`)
  return EXIT_USAGE
}

