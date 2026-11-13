import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
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

const runJig = (hook, payload, projectDir) =>
  new Promise((resolve) => {
    let stdout = ''
    let child
    try {
      child = spawn(process.execPath.includes('node') ? process.execPath : 'node', [BIN, 'hook', hook, '--agent', 'opencode'], {
        env: { ...process.env, JIG_PROJECT_DIR: projectDir },
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true,
      })
    } catch {
      resolve(undefined)
      return
    }
    const timer = setTimeout(() => child.kill(), (TIMEOUTS[hook] ?? 10) * 1000)
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve(undefined)
    })
    child.on('close', () => {
      clearTimeout(timer)
      resolve(parse(stdout))
    })
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify({ ...payload, hook_event_name: EVENT_NAMES[hook] }))
  })

const contextOf = (result) => result?.hookSpecificOutput?.additionalContext
const denialOf = (result) =>
  result?.hookSpecificOutput?.permissionDecision === 'deny' ? (result.hookSpecificOutput.permissionDecisionReason ?? 'denied by jig') : undefined

export const JigPlugin = async ({ client, directory, worktree }) => {
  const projectDir = worktree && worktree !== '/' ? worktree : directory
  const base = (sessionID) => ({ session_id: sessionID, cwd: directory })
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
