import type { ForgeName } from '../core/config'
import { EnvironmentError, firstLine, parseJsonPages, type Exec } from './exec'

export interface Note {
  id: string
  author: string
  system: boolean
  resolvable: boolean
  resolved: boolean
  createdAt: string
  body: string
}

export interface Discussion {
  id: string
  notes: Note[]
}

export interface ReviewRequest {
  iid: number
  sourceBranch: string
  draft: boolean
  webUrl: string
}

/** What the review cycle reads from and deletes on the forge. Everything else goes through the forge CLI by the skill. */
export interface Forge {
  readonly name: ForgeName
  /** The current user: GitLab numeric id, GitHub login. */
  me(): string
  /** Open merge requests where the current user is a reviewer. */
  reviewQueue(): ReviewRequest[]
  /** Anyone approved. */
  approved(iid: number): boolean
  headSha(iid: number): string
  commitDates(iid: number): string[]
  discussions(iid: number): Discussion[]
  /** undefined: no such thread on the merge request. */
  discussion(iid: number, id: string): Discussion | undefined
  deleteNote(iid: number, noteId: string): void
}

/** `github` when the remote is on a GitHub host, `gitlab` otherwise (self-hosted GitLab often has no "gitlab" in its host). */
export const detectForge = (remote: string): ForgeName => (/github/i.test(remote) ? 'github' : 'gitlab')

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '')

class Cli {
  constructor(
    private readonly exec: Exec,
    private readonly bin: string,
    private readonly cwd: string,
  ) {}

  run(args: readonly string[], label: string): string {
    const result = this.exec(this.bin, args, this.cwd)
    if (result.code === 0) return result.stdout
    const reason = result.error ?? (firstLine(result.stderr) || firstLine(result.stdout) || `exit ${String(result.code)}`)
    throw new EnvironmentError(`${this.bin} ${label}: ${reason}`)
  }

  json(args: readonly string[], label: string): unknown[] {
    const output = this.run(args, label)
    try {
      return parseJsonPages(output)
    } catch {
      throw new EnvironmentError(`${this.bin} ${label}: unreadable JSON`)
    }
  }

  one(args: readonly string[], label: string): Json {
    const [value] = this.json(args, label)
    if (!isObject(value)) throw new EnvironmentError(`${this.bin} ${label}: expected an object`)
    return value
  }
}

const objects = (values: unknown[]): Json[] => values.filter(isObject)

const gitlabNote = (raw: Json): Note => ({
  id: text(raw['id']),
  author: isObject(raw['author']) ? text(raw['author']['id']) : '',
  system: raw['system'] === true,
  resolvable: raw['resolvable'] === true,
  resolved: raw['resolved'] === true,
  createdAt: text(raw['created_at']),
  body: text(raw['body']),
})

export const gitlabDiscussion = (raw: Json): Discussion => ({
  id: text(raw['id']),
  notes: Array.isArray(raw['notes']) ? objects(raw['notes']).map(gitlabNote) : [],
})

export const gitlabForge = (exec: Exec, cwd: string): Forge => {
  const cli = new Cli(exec, 'glab', cwd)
  const mr = (iid: number): string => `projects/:fullpath/merge_requests/${iid}`
  let me: string | undefined
  return {
    name: 'gitlab',
    me() {
      if (me !== undefined) return me
      const id = text(cli.one(['api', 'user'], 'api user')['id'])
      if (!/^\d+$/.test(id)) throw new EnvironmentError(`glab api user: no numeric user id (host, token or remote is wrong)`)
      me = id
      return me
    },
    reviewQueue() {
      const path = `projects/:fullpath/merge_requests?state=opened&reviewer_id=${this.me()}&per_page=100`
      return objects(cli.json(['api', path, '--paginate'], `api ${path}`)).map((raw) => ({
        iid: Number(raw['iid']),
        sourceBranch: text(raw['source_branch']),
        draft: raw['draft'] === true || raw['work_in_progress'] === true,
        webUrl: text(raw['web_url']),
      }))
    },
    approved(iid) {
      const approvals = cli.one(['api', `${mr(iid)}/approvals`], `api ${mr(iid)}/approvals`)
      const by = approvals['approved_by']
      return Array.isArray(by) && by.length > 0
    },
    headSha(iid) {
      const sha = text(cli.one(['api', mr(iid)], `api ${mr(iid)}`)['sha'])
      if (sha === '') throw new EnvironmentError(`glab api ${mr(iid)}: no head sha`)
      return sha
    },
    commitDates(iid) {
      const path = `${mr(iid)}/commits?per_page=100`
      return objects(cli.json(['api', path, '--paginate'], `api ${path}`)).map((raw) => text(raw['created_at']))
    },
    discussions(iid) {
      const path = `${mr(iid)}/discussions?per_page=100`
      return objects(cli.json(['api', path, '--paginate'], `api ${path}`)).map(gitlabDiscussion)
    },
    discussion(iid, id) {
      const path = `${mr(iid)}/discussions/${id}`
      try {
        return gitlabDiscussion(cli.one(['api', path], `api ${path}`))
      } catch (error) {
        if (error instanceof EnvironmentError && /404/.test(error.message)) return undefined
        throw error
      }
    },
    deleteNote(iid, noteId) {
      const path = `${mr(iid)}/notes/${noteId}`
      cli.run(['api', '--method', 'DELETE', path], `api DELETE ${path}`)
    },
  }
}

const THREADS_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) { pullRequest(number: $number) { reviewThreads(first: 100) { nodes {
    id isResolved comments(first: 100) { nodes { databaseId author { login } createdAt body } }
  } } } }
}`

const githubComment = (raw: Json, resolvable: boolean, resolved: boolean): Note => ({
  id: text(raw['databaseId'] ?? raw['id']),
  author: isObject(raw['author']) ? text(raw['author']['login']) : isObject(raw['user']) ? text(raw['user']['login']) : '',
  system: false,
  resolvable,
  resolved,
  createdAt: text(raw['createdAt'] ?? raw['created_at']),
  body: text(raw['body']),
})

const path = (value: unknown, keys: readonly string[]): unknown =>
  keys.reduce<unknown>((current, key) => (isObject(current) ? current[key] : undefined), value)

const nodes = (value: unknown): Json[] => {
  const list = path(value, ['nodes'])
  return Array.isArray(list) ? objects(list) : []
}

export const githubThreads = (response: Json): Discussion[] =>
  nodes(path(response, ['data', 'repository', 'pullRequest', 'reviewThreads'])).map((thread) => {
    const resolved = thread['isResolved'] === true
    return { id: text(thread['id']), notes: nodes(thread['comments']).map((comment) => githubComment(comment, true, resolved)) }
  })

/** GitHub through `gh`: reads only. Withdrawing a thread is not supported yet. */
export const githubForge = (exec: Exec, cwd: string): Forge => {
  const cli = new Cli(exec, 'gh', cwd)
  const view = (iid: number, fields: string): Json => cli.one(['pr', 'view', String(iid), '--json', fields], `pr view ${iid}`)
  const unsupported = (operation: string): never => {
    throw new EnvironmentError(`${operation} is not supported on GitHub yet`)
  }
  let me: string | undefined
  return {
    name: 'github',
    me() {
      me ??= text(cli.one(['api', 'user'], 'api user')['login'])
      if (me === '') throw new EnvironmentError('gh api user: no login (run gh auth login)')
      return me
    },
    reviewQueue() {
      const seen = new Map<number, ReviewRequest>()
      for (const search of ['review-requested:@me', 'reviewed-by:@me']) {
        const args = ['pr', 'list', '--state', 'open', '--search', search, '--limit', '200', '--json', 'number,headRefName,isDraft,url']
        for (const raw of objects(cli.json(args, `pr list --search ${search}`))) {
          const iid = Number(raw['number'])
          seen.set(iid, { iid, sourceBranch: text(raw['headRefName']), draft: raw['isDraft'] === true, webUrl: text(raw['url']) })
        }
      }
      return [...seen.values()]
    },
    approved(iid) {
      const reviews = view(iid, 'latestReviews')['latestReviews']
      return Array.isArray(reviews) && objects(reviews).some((review) => review['state'] === 'APPROVED')
    },
    headSha(iid) {
      const sha = text(view(iid, 'headRefOid')['headRefOid'])
      if (sha === '') throw new EnvironmentError(`gh pr view ${iid}: no head sha`)
      return sha
    },
    commitDates(iid) {
      const commits = view(iid, 'commits')['commits']
      return Array.isArray(commits) ? objects(commits).map((commit) => text(commit['committedDate'])) : []
    },
    discussions(iid) {
      const args = ['api', 'graphql', '-F', 'owner={owner}', '-F', 'repo={repo}', '-F', `number=${iid}`, '-f', `query=${THREADS_QUERY}`]
      const threads = githubThreads(cli.one(args, `api graphql reviewThreads ${iid}`))
      const issuePath = `repos/{owner}/{repo}/issues/${iid}/comments`
      const general = objects(cli.json(['api', issuePath, '--paginate'], `api ${issuePath}`)).map((raw) => ({
        id: text(raw['id']),
        notes: [githubComment(raw, false, false)],
      }))
      return [...threads, ...general]
    },
    discussion: () => unsupported('withdraw'),
    deleteNote: () => unsupported('withdraw'),
  }
}

export const createForge = (name: ForgeName, exec: Exec, cwd: string): Forge =>
  name === 'github' ? githubForge(exec, cwd) : gitlabForge(exec, cwd)
