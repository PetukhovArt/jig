import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { loadConfig } from '../../core/config'
import { createMatcher } from '../../core/glob'
import { exclusionOf, toRootPaths } from '../../review/review-plan'
import { resolveUiBase } from '../base'
import { changedFiles } from '../reuse'
import { EXIT_FINDINGS, projectRootOf, UsageError, type UiSubcommand } from '../command'
import { collectCodeColors, loadCode } from './code'
import { hasNodes, parseExport } from './export'
import { FigmaFetchError, fetchExport } from './fetch'
import { buildReport, listTopNodes } from './report'

export const MOCKUP_USAGE = `usage: jig ui mockup (--figma <Figma URL with node-id> | --export <export file>) [--component <nodeId>] [--tokens <css file|dir|glob>]... [--base <ref>] [--role "<text>=[<file>:]<key>"]... [--ui] [<code path>...]

Compares a Figma node (figma-developer-mcp tree export) with the code that implements it.
  --figma      a Figma URL with node-id: fetched once with JIG_FIGMA_API_KEY, else FIGMA_API_KEY, into .jig/ui/figma/, which later runs read
  --export     a path to such an export instead of a URL
  --component  node id of one component on the canvas (e.g. 4067:47270); without it, lists the top nodes and exits
  --tokens     CSS files, folders or globs that define design tokens (--name: value): a token the code names (var(--a-b), 'a.b') counts as its color; default ui.tokens of the config
  --base       git ref the change started from (default: merge base with the upstream or origin/HEAD)
  --role       "<mockup text>=[<file>:]<key>": the code key that holds the font size of the text role the sample belongs to; one per typography row
  --ui         the component is app UI assembled from library instances (a panel, a toolbar), not a drawn one
  code paths   files or folders holding the component and its spec, tests are skipped; default: the changed files matching ui.components.files

Exit 1 while a MISSING, NOT IN MOCKUP, DUPLICATE, typography or WRONG NODE line stands.`

const EXIT_FAILURE = 2

export const mockup: UiSubcommand = (args, ctx) => {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      figma: { type: 'string' },
      export: { type: 'string' },
      component: { type: 'string' },
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
  if ((values.figma === undefined) === (values.export === undefined)) throw new UsageError(MOCKUP_USAGE)
  const root = projectRootOf(ctx.cwd)
  const config = loadConfig(root)
  if (config.error !== undefined) throw new Error(`config: ${config.error}`)
  const skip = (message: string): void => ctx.io.err(`${message}\n`)

  let exportFile: string
  try {
    exportFile = values.export === undefined ? fetchExport({ root, url: values.figma ?? '', log: ctx.io.err }) : resolve(ctx.cwd, values.export)
  } catch (error) {
    if (!(error instanceof FigmaFetchError)) throw error
    ctx.io.err(`jig: ${error.message}\n`)
    return EXIT_FAILURE
  }
  if (!existsSync(exportFile)) throw new Error(`${exportFile}: no such export file`)
  const source = readFileSync(exportFile, 'utf8')
  if (!hasNodes(source)) throw new Error(`no NODES: section in ${exportFile}`)
  const exported = parseExport(source)

  if (values.component === undefined) {
    ctx.io.out(`${listTopNodes(exported).join('\n')}\n`)
    return 0
  }
  if (!exported.nodes.some((node) => node.id === values.component)) {
    ctx.io.err(`node ${values.component} not in ${exportFile}\n`)
    return EXIT_FAILURE
  }

  const base = resolveUiBase(root, values.base, 'ui mockup')
  const given = toRootPaths(root, ctx.cwd, positionals)
  const matchesComponents = createMatcher(config.ui?.components?.files ?? [])
  const paths = given.length > 0 ? given : changedFiles(root, base.tracked).filter((path) => matchesComponents(path) && exclusionOf(path, root) === undefined)
  if (paths.length === 0) throw new UsageError(`no code paths: pass the files or folders of the component\n\n${MOCKUP_USAGE}`)
  const tokens = values.tokens === undefined || values.tokens.length === 0 ? (config.ui?.tokens ?? []) : toRootPaths(root, ctx.cwd, values.tokens)

  const code = loadCode(root, paths, skip)
  const colors = collectCodeColors(root, code, tokens, skip)
  const result = buildReport({
    root,
    exportName: exportFile.replace(/\\/g, '/').split('/').pop() ?? exportFile,
    exported,
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
  return result.report.blocking > 0 ? EXIT_FINDINGS : 0
}
