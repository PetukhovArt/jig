import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { loadConfig } from '../../core/config'
import { exclusionOf, toRootPaths } from '../../review/review-plan'
import { mockupRule } from '../../pre-mr/ui-requirements'
import { resolveUiBase } from '../base'
import { EXIT_FINDINGS, projectRootOf, requireReferences, UsageError, type UiSubcommand } from '../command'
import { recordPassed } from '../proof'
import { referencePath } from '../references'
import { changedFiles } from '../reuse'
import { shellRunner } from '../run'
import { loadTokens } from '../tokens'
import { flattenTree, parseTree } from '../tree'
import { collectCodeColors, loadCode } from './code'
import { buildReport, listTopNodes } from './report'

export const MOCKUP_USAGE = `usage: jig ui mockup <n> [--component <node id>] [--theme <name>] [--tokens <DTCG file>]... [--base <ref>] [--role "<text>=[<file>:]<key>"]... [--ui] [<code path>...]

Compares the node tree attached to reference <n> (jig ui reference attach <n> --tree, schema/ui-tree.schema.json) with the code that implements it.
  <n>          the reference number from jig ui reference
  --component  node id of one component in the tree; without it, lists the top nodes and exits
  --theme      the theme whose token values stand for the reference (default: the first of ui.themes)
  --tokens     DTCG token files (schema/ui-tokens.schema.json) instead of ui.tokens: a token whose refs the code names counts as its color
  --base       git ref the change started from (default: merge base with the upstream or origin/HEAD)
  --role       "<mockup text>=[<file>:]<key>": the code key that holds the font size of the text role the sample belongs to; one per typography row
  --ui         the component is app UI assembled from library instances (a panel, a toolbar), not a drawn one
  code paths   files or folders holding the component and its spec, tests are skipped; default: every changed file

Exit 1 while a MISSING, NOT IN MOCKUP, DUPLICATE, typography or WRONG NODE line stands.`

const EXIT_FAILURE = 2

export const mockup: UiSubcommand = (args, ctx) => {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      component: { type: 'string' },
      theme: { type: 'string' },
      tokens: { type: 'string', multiple: true },
      base: { type: 'string' },
      role: { type: 'string', multiple: true },
      ui: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  if (values.help === true) {
    ctx.io.out(`${MOCKUP_USAGE}\n`)
    return 0
  }
  const [reference, ...codePaths] = positionals
  const n = Number(reference)
  if (reference === undefined || !Number.isInteger(n)) throw new UsageError(MOCKUP_USAGE)
  const root = projectRootOf(ctx.cwd)
  const config = loadConfig(root)
  if (config.error !== undefined) throw new Error(`config: ${config.error}`)
  const entry = requireReferences(root).entries.find((own) => own.n === n)
  if (entry === undefined) throw new UsageError(`no reference ${n}: jig ui reference lists them`)
  if (entry.tree === undefined) throw new UsageError(`reference ${n} has no tree: jig ui reference attach ${n} --tree <json>`)
  const parsed = parseTree(readFileSync(referencePath(root, entry.tree), 'utf8'))
  if (parsed.tree === undefined) throw new Error(`reference ${n} tree is not a jig node tree (schema/ui-tree.schema.json):\n${parsed.errors.join('\n')}`)
  const { tree } = parsed

  if (values.component === undefined) {
    ctx.io.out(`${listTopNodes(flattenTree(tree)).join('\n')}\n`)
    return 0
  }
  if (!flattenTree(tree).some((node) => node.id === values.component)) {
    ctx.io.err(`node ${values.component} not in the tree of reference ${n}\n`)
    return EXIT_FAILURE
  }

  const base = resolveUiBase(root, values.base, 'ui mockup')
  const given = toRootPaths(root, ctx.cwd, codePaths)
  const paths = given.length > 0 ? given : changedFiles(root, base.tracked).filter((path) => exclusionOf(path, root) === undefined)
  if (paths.length === 0) throw new UsageError(`no code paths: pass the files or folders of the component\n\n${MOCKUP_USAGE}`)

  const skip = (message: string): void => ctx.io.err(`${message}\n`)
  const loaded = loadTokens(root, ctx.cwd, config.ui?.tokens ?? { files: [] }, values.tokens ?? [], ctx.run ?? shellRunner)
  if (loaded.errors.length > 0) {
    ctx.io.err(`${loaded.errors.map((error) => `jig: tokens: ${error}`).join('\n')}\n`)
    return EXIT_FAILURE
  }
  const code = loadCode(root, paths, skip)
  const colors = collectCodeColors(code, loaded.tokens, values.theme ?? config.ui?.themes[0]?.name)
  const result = buildReport({
    root,
    referenceName: `reference ${n}`,
    tree,
    componentId: values.component,
    code,
    colors,
    roles: values.role ?? [],
    isAppUi: values.ui === true,
    base: base.mergeBase,
    paths,
  })
  if (result.type === 'unknown-node') return EXIT_FAILURE
  ctx.io.out(`${result.report.lines.join('\n')}\n`)
  if (result.report.blocking > 0) return EXIT_FINDINGS
  recordPassed(root, mockupRule(n), `jig ui mockup ${n} --component ${values.component}`, ctx.io)
  return 0
}
