import { execFile, spawn } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const BIN = join(ROOT, 'bin', 'jig.mjs')

const EDIT_TOOLS = { edit: 'Edit', write: 'Write', multiedit: 'MultiEdit', apply_patch: 'apply_patch', patch: 'apply_patch' }
const TOUCH_TOOLS = { read: 'Read', grep: 'Grep', glob: 'Glob', list: 'Glob' }
const SHELL_TOOLS = { bash: 'Bash' }

const TIMEOUTS = { 'session-start': 15, compact: 10, 'user-prompt-submit': 10, 'pre-edit': 10, 'pre-shell': 10, 'post-edit': 30, touch: 10, 'post-shell': 10, stop: 120 }

const EVENT_NAMES = {
  'session-start': 'SessionStart',
  compact: 'PostCompact',
  'user-prompt-submit': 'UserPromptSubmit',
  'pre-edit': 'PreToolUse',
  'pre-shell': 'PreToolUse',
  'post-edit': 'PostToolUse',
  touch: 'PostToolUse',
  'post-shell': 'PostToolUse',
  stop: 'Stop',
}

const defined = (object) => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined))

const toClaudeInput = (tool, args = {}) => {
  if (tool === 'apply_patch' || tool === 'patch') return { command: args.patchText }
  if (tool === 'multiedit') {
    return { file_path: args.filePath, edits: (args.edits ?? []).map((edit) => ({ old_string: edit.oldString, new_string: edit.newString })) }
  }
  return defined({
    file_path: args.filePath,
    old_string: args.oldString,
    new_string: args.newString,
    content: args.content,
    command: args.command,
    pattern: args.pattern,
    path: args.path,
  })
}

const toClaudeCall = (tool, args) => {
  const name = EDIT_TOOLS[tool] ?? TOUCH_TOOLS[tool] ?? SHELL_TOOLS[tool]
  return name === undefined ? undefined : { tool_name: name, tool_input: toClaudeInput(tool, args) }
}

const hooksFor = (tool) => {
  if (Object.hasOwn(EDIT_TOOLS, tool)) return { before: 'pre-edit', after: 'post-edit' }
  if (Object.hasOwn(SHELL_TOOLS, tool)) return { before: 'pre-shell', after: 'post-shell' }
  if (Object.hasOwn(TOUCH_TOOLS, tool)) return { after: 'touch' }
  return {}
}

const parse = (stdout) => {
  try {
    return JSON.parse(stdout)
  } catch {
    return undefined
  }
}

const NODE = /^node(\.exe)?$/i.test(basename(process.execPath)) ? process.execPath : 'node'

const STDERR_TAIL = 2000

const debugLog = () => {
  const value = process.env.JIG_DEBUG
  if (!value) return undefined
  return value === '1' ? join(tmpdir(), 'jig-opencode.log') : value
}

const logRun = (entry) => {
  const path = debugLog()
  if (path === undefined) return
  try {
    appendFileSync(path, `${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`)
  } catch {}
}

const runJig = (hook, payload, cwd) =>
  new Promise((resolve) => {
    const started = Date.now()
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let child
    const finish = (result, entry) => {
      logRun({ hook, ms: Date.now() - started, timeout: timedOut, ...entry })
      resolve(result)
    }
    try {
      child = spawn(NODE, [BIN, 'hook', hook, '--agent', 'opencode'], {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      finish(undefined, { spawnError: String(error) })
      return
    }
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, (TIMEOUTS[hook] ?? 10) * 1000)
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-STDERR_TAIL)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      finish(undefined, { spawnError: String(error), stderr })
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      const result = parse(stdout)
      const parseFailed = result === undefined && stdout.trim() !== ''
      finish(result, { code, signal, stderr, ...(parseFailed ? { parseError: stdout.slice(0, STDERR_TAIL) } : {}) })
    })
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify({ ...payload, hook_event_name: EVENT_NAMES[hook] }))
  })

const TIER_AGENTS = {
  deep: 'strongest reasoning: synthesis, judging, design, root cause',
  standard: 'balanced reasoning and cost: exploring, finding, fixing',
  fast: 'cheapest capable model: mechanical work',
}
const REVIEW_DEPTH = 2

const skillPaths = (root = ROOT) => {
  try {
    const manifest = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8'))
    return (manifest.skills ?? []).map((path) => join(root, path))
  } catch {
    return [join(root, 'skills')]
  }
}

const tierModels = () =>
  new Promise((resolve) => {
    execFile(NODE, [BIN, 'tiers', '--agent', 'opencode', '--json'], { timeout: 10_000, windowsHide: true }, (error, stdout) => {
      if (error) logRun({ hook: 'tiers', spawnError: String(error) })
      resolve(error ? undefined : parse(stdout)?.tiers ?? undefined)
    })
  })

const tierAgents = (tiers) =>
  Object.fromEntries(
    Object.entries(TIER_AGENTS).map(([tier, description]) => {
      const model = tiers?.[tier]?.[0]
      return [`jig-${tier}`, { description: `jig ${tier} tier: ${description}`, mode: 'subagent', permission: { task: 'allow' }, ...(model ? { model } : {}) }]
    }),
  )

const registerJig = (config, tiers, root = ROOT) => {
  config.skills = { ...config.skills, paths: [...new Set([...(config.skills?.paths ?? []), ...skillPaths(root)])] }
  const agents = tierAgents(tiers)
  config.agent = { ...config.agent }
  for (const [name, agent] of Object.entries(agents)) config.agent[name] = { ...agent, ...config.agent[name] }
  config.subagent_depth ??= REVIEW_DEPTH
}

const contextOf = (result) => result?.hookSpecificOutput?.additionalContext
const denialOf = (result) =>
  result?.hookSpecificOutput?.permissionDecision === 'deny' ? (result.hookSpecificOutput.permissionDecisionReason ?? 'denied by jig') : undefined

export const JigPlugin = async ({ client, directory, worktree }) => {
  const projectDir = worktree && worktree !== '/' ? worktree : directory
  const base = (sessionID) => ({ session_id: sessionID, cwd: projectDir })
  const jig = (hook, payload) => runJig(hook, payload, projectDir).catch(() => undefined)
  const systemContext = new Map()
  const stopActive = new Set()
  const children = new Map()
  const ownParts = new WeakSet()

  const isChild = async (sessionID) => {
    if (!children.has(sessionID)) {
      try {
        const session = await client.session.get({ path: { id: sessionID } })
        children.set(sessionID, typeof session?.data?.parentID === 'string')
      } catch {
        return false
      }
    }
    return children.get(sessionID)
  }

  const startContext = async (sessionID) => {
    if (!systemContext.has(sessionID)) {
      systemContext.set(sessionID, contextOf(await jig('session-start', { ...base(sessionID), source: 'startup' })) ?? '')
    }
    return systemContext.get(sessionID)
  }

  return {
    config: async (config) => {
      registerJig(config, await tierModels())
    },
    'tool.execute.before': async (input, output) => {
      const hook = hooksFor(input.tool).before
      const call = toClaudeCall(input.tool, output.args)
      if (hook === undefined || call === undefined) return
      const reason = denialOf(await jig(hook, { ...base(input.sessionID), ...call, tool_use_id: input.callID }))
      if (reason !== undefined) throw new Error(reason)
    },
    'tool.execute.after': async (input, output) => {
      const hook = hooksFor(input.tool).after
      const call = toClaudeCall(input.tool, input.args)
      if (hook === undefined || call === undefined) return
      const context = contextOf(await jig(hook, { ...base(input.sessionID), ...call, tool_use_id: input.callID }))
      if (context !== undefined && typeof output.output === 'string') output.output = `${output.output}\n\n${context}`
    },
    'chat.message': async (input, output) => {
      const texts = output.parts.filter((part) => part.type === 'text' && !ownParts.has(part))
      if (texts.length === 0 || texts.every((part) => part.synthetic === true)) return
      stopActive.delete(input.sessionID)
      const prompt = texts.map((part) => part.text).join('\n')
      const context = contextOf(await jig('user-prompt-submit', { ...base(input.sessionID), prompt }))
      if (context === undefined) return
      const part = { type: 'text', text: context, synthetic: true }
      ownParts.add(part)
      output.parts.push(part)
    },
    'experimental.chat.system.transform': async (input, output) => {
      if (input.sessionID === undefined) return
      const context = await startContext(input.sessionID)
      if (context !== '') output.system.push(context)
    },
    event: async ({ event }) => {
      const sessionID = event.properties?.sessionID ?? event.properties?.info?.id
      if (sessionID === undefined) return
      if (event.type === 'session.created') {
        children.set(sessionID, typeof event.properties.info?.parentID === 'string')
      } else if (event.type === 'session.compacted') {
        const before = await startContext(sessionID)
        const context = contextOf(await jig('compact', base(sessionID)))
        if (context !== undefined) systemContext.set(sessionID, before === '' ? context : `${before}\n\n${context}`)
      } else if (event.type === 'session.idle') {
        if (await isChild(sessionID)) return
        const result = await jig('stop', { ...base(sessionID), stop_hook_active: stopActive.has(sessionID) })
        if (result?.decision !== 'block' || typeof result.reason !== 'string') return
        stopActive.add(sessionID)
        const prompt = client.session.promptAsync ?? client.session.prompt
        try {
          await prompt.call(client.session, { path: { id: sessionID }, body: { parts: [{ type: 'text', text: result.reason, synthetic: true }] } })
        } catch {
          stopActive.delete(sessionID)
        }
      }
    },
  }
}
