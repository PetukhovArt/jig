import { version } from '../../package.json'
import { runAtom, runBuild } from '../atoms/atoms'
import { runDash } from '../dash/dash'
import { runDoctor } from '../doctor'
import { runCheck } from '../gates/stop'
import { runHook } from '../hook/dispatch'
import { runLoop } from '../loop/loop'
import { runAllowNoVerify } from '../rules/no-verify'
import { runSlot } from '../slot/slot'

type Command = (args: string[]) => number | Promise<number>

const EXIT_FAILURE = 2
const MIN_NODE_MAJOR = 20

const runVersion: Command = () => {
  process.stdout.write(`jig ${version}\n`)
  return 0
}

const commands = new Map<string, Command>([
  ['hook', runHook],
  ['check', runCheck],
  ['build', runBuild],
  ['atom', runAtom],
  ['slot', runSlot],
  ['dash', runDash],
  ['loop', runLoop],
  ['allow-no-verify', runAllowNoVerify],
  ['doctor', runDoctor],
  ['version', runVersion],
])

const fail = (message: string): number => {
  process.stderr.write(`jig: ${message}\n`)
  return EXIT_FAILURE
}

const run = async (argv: string[]): Promise<number> => {
  const nodeVersion = process.versions.node
  const nodeMajor = Number(nodeVersion.split('.')[0])
  if (nodeMajor < MIN_NODE_MAJOR) {
    return fail(`Node >= ${MIN_NODE_MAJOR} required, found ${nodeVersion}`)
  }

  const [name, ...args] = argv
  if (name === undefined) {
    return fail(`missing command, expected one of: ${[...commands.keys()].join(', ')}`)
  }

  const command = commands.get(name)
  if (command === undefined) {
    return fail(`unknown command ${name}`)
  }

  try {
    return await command(args)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return fail(message)
  }
}

process.exitCode = await run(process.argv.slice(2))
