# Forge: `glab` and `gh`

## Which host

`git remote get-url origin`:
- contains `gitlab` → `glab`;
- contains `github.com` → `gh`;
- anything else: ask the user in your reply which forge CLI the repository uses, recommending `glab`.

Run every command from inside the repository: both CLIs take the host and project from its `origin`. Bodies go through a temp file (`mktemp`), never inline `-f body=`: quoting breaks the text. Remove the file once the call succeeds.

## By task

| Task | GitLab (`glab`) | GitHub (`gh`) |
| --- | --- | --- |
| Your open merge requests | `glab mr list --author=@me` | `gh pr list --author @me --state open` |
| Merge request of the current branch | `glab mr list --source-branch <branch>` | `gh pr view --json url,number,title,baseRefName,headRefName` |
| Read a merge request | `glab mr view <iid> --output json` | `gh pr view <n> --json title,body,baseRefName,headRefName,url` |
| Read its threads | `glab api "projects/:fullpath/merge_requests/<iid>/discussions?per_page=100"` (`--paginate` past 100) | `gh api repos/{owner}/{repo}/pulls/<n>/comments --paginate` and `gh pr view <n> --comments` |
| Diff against its target | `glab mr diff <iid>` | `gh pr diff <n>` |
| Diff locally | `git fetch origin <target>` then `git diff origin/<target>...HEAD` | same |
| Create | `glab mr create --source-branch <b> --target-branch <t> --title '<title>' --description "$(cat "$BODY")" --no-editor --yes` | `gh pr create --base <t> --head <b> --title '<title>' --body-file "$BODY"` |
| Update the description | `glab mr update <iid> --description "$(cat "$BODY")"` | `gh pr edit <n> --body-file "$BODY"` |
| Post a new thread | `glab api --method POST projects/:fullpath/merge_requests/<iid>/discussions -H "Content-Type: application/json" --input <payload.json>` | `gh api --method POST repos/{owner}/{repo}/pulls/<n>/comments --input <payload.json>` |
| Reply in a thread | `glab api --method POST projects/:fullpath/merge_requests/<iid>/discussions/<discussion-id>/notes -H "Content-Type: application/json" --input <payload.json>` | `gh api --method POST repos/{owner}/{repo}/pulls/<n>/comments/<comment-id>/replies --input <payload.json>` |
| Diff refs (positions) | `glab api projects/:fullpath/merge_requests/<iid>` → `.diff_refs` (`base_sha`, `start_sha`, `head_sha`); a thread payload carries `position: {position_type: "text", base_sha, start_sha, head_sha, new_path, new_line}` | `gh pr view <n> --json headRefOid`; a comment payload carries `commit_id`, `path`, `line`, `side: "RIGHT"` |
| Resolve a thread | `glab api --method PUT projects/:fullpath/merge_requests/<iid>/discussions/<discussion-id> -f resolved=true` | `gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "<thread-node-id>"}) { thread { isResolved } } }'` (thread ids: `reviewThreads` of the pull request) |
| Post or update a general note | POST or PUT `projects/:fullpath/merge_requests/<iid>/notes[/<note-id>]` with `--input <payload.json>` | `gh api --method POST repos/{owner}/{repo}/issues/<n>/comments --input <payload.json>`; update: `--method PATCH repos/{owner}/{repo}/issues/comments/<id>` |
| Update a note | `glab api --method PUT projects/:fullpath/merge_requests/<iid>/notes/<note-id> -H "Content-Type: application/json" --input <payload.json>` | `gh api --method PATCH repos/{owner}/{repo}/pulls/comments/<id> --input <payload.json>` |
| Change the target branch | `glab mr update <iid> --target-branch <t>` | `gh pr edit <n> --base <t>` |
| Merge (only on the user's command) | `glab mr merge <iid> --yes` | `gh pr merge <n> --squash` |
| Read back after a merge | `glab mr view <iid> --output json` (`state`, `target_branch`) | `gh pr view <n> --json state,mergedAt,baseRefName` |
| CI status | `glab ci status` (current branch), `glab ci view <pipeline-id>` (job tree) | `gh pr checks <n>` |
| Log of a failed job | `glab ci trace <job-id>` | `gh run view <run-id> --log-failed` |

## Notes

- A merge command can report success when a merge queue only queued the request, and an armed auto-merge is not a merge: read the request back.
- The create commands without `--no-editor --yes` (`glab`) wait in an editor.
- Before replacing a description, read the current one: a human may have edited it by hand.
- `glab api` with `--input` needs `-H "Content-Type: application/json"`: without it GitLab answers HTTP 415.
- `glab api` sporadically panics (`nil pointer` in `net/url`) before sending the request: the write did not land, rerun the same command.
- A thread belongs to whoever wrote its first note. Answering inside someone else's thread never makes it yours, and you never resolve a thread you did not open.
