import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const FORGES = ['github', 'gitlab', 'local']
const GITLAB_DEFAULT_UPLOAD_LIMIT_MB = 10

export async function attachVideo({ file, target, body, settings, isDryRun }) {
  const to = settings.attach?.to ?? detectForge()
  if (!FORGES.includes(to)) fail(`attach.to: ${to}; supported: ${FORGES.join(', ')}`)
  const sizeMb = statSync(file).size / 2 ** 20
  if (to === 'local') return copyToFolder(file, settings.attach?.dir ?? fail('attach.to "local" needs attach.dir'), isDryRun)
  if (!target) fail('attach: --to <PR/MR number or url>')
  if (to === 'github') {
    const argv = ['gh', 'pr', 'comment', target, '--body', body, '--attach', file]
    if (isDryRun) return quoteCommand(argv)
    run(argv)
    return `attached ${path.basename(file)} (${sizeMb.toFixed(1)} MB) to PR ${target}`
  }
  if (sizeMb > GITLAB_DEFAULT_UPLOAD_LIMIT_MB) console.warn(`${sizeMb.toFixed(1)} MB: GitLab rejects uploads over the instance limit (${GITLAB_DEFAULT_UPLOAD_LIMIT_MB} MB by default); hand over video-fast.mp4 or a shorter cut`)
  const { host, projectPath } = gitlabRemote()
  const iid = /(\d+)\/?$/.exec(target)?.[1] ?? fail(`attach: no MR number in ${target}`)
  if (isDryRun) return `upload ${file} to https://${host}/api/v4/projects/${encodeURIComponent(projectPath)}/uploads, then note it on !${iid}`
  const api = gitlabApi(host, projectPath)
  const form = new FormData()
  form.append('file', new Blob([readFileSync(file)]), path.basename(file))
  const { markdown } = await api('uploads', { method: 'POST', body: form })
  await api(`merge_requests/${iid}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: `${body}\n\n${markdown}` }) })
  return `attached ${path.basename(file)} (${sizeMb.toFixed(1)} MB) to MR !${iid}`
}

function detectForge() {
  const remote = git(['remote', 'get-url', 'origin'])
  return /github/i.test(remote) ? 'github' : 'gitlab'
}

function gitlabRemote() {
  const remote = git(['remote', 'get-url', 'origin']).trim()
  const parsed = /^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)(?::\d+)?[:/](.+?)(?:\.git)?\/?$/i.exec(remote) ?? fail(`cannot parse origin ${remote}`)
  return { host: parsed[1], projectPath: parsed[2] }
}

function gitlabApi(host, projectPath) {
  const token = process.env.GITLAB_TOKEN ?? spawnSync('glab', ['config', 'get', 'token', '--host', host], { encoding: 'utf8' }).stdout?.trim()
  if (!token) fail(`no GitLab token for ${host}: set GITLAB_TOKEN or glab auth login --hostname ${host}`)
  return async (resource, init) => {
    const response = await fetch(`https://${host}/api/v4/projects/${encodeURIComponent(projectPath)}/${resource}`, { ...init, headers: { ...init.headers, 'PRIVATE-TOKEN': token } })
    if (!response.ok) fail(`GitLab ${resource}: ${response.status} ${await response.text()}`)
    return response.json()
  }
}

function copyToFolder(file, folder, isDryRun) {
  const out = path.resolve(folder, path.basename(file))
  if (isDryRun) return `copy ${file} to ${out}`
  mkdirSync(path.dirname(out), { recursive: true })
  copyFileSync(file, out)
  return out
}

function quoteCommand(argv) {
  return argv.map((a) => (/^[\w./:#=@-]+$/.test(a) ? a : `"${a.replace(/(["\\$`])/g, '\\$1')}"`)).join(' ')
}

function git(args) {
  const r = spawnSync('git', args, { encoding: 'utf8' })
  if (r.status !== 0) fail(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout
}

function run([bin, ...args]) {
  const r = spawnSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (r.status !== 0) fail(`${bin} failed:\n${r.stderr || r.error?.message || ''}`)
  return r.stdout
}

function fail(msg) {
  console.error(msg)
  process.exit(1)
}
