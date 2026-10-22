# Issues

An issue moves through four states: filed, triaged, fixed on `main`, released. Labels show the state; `.github/labels.yml` defines them and the `Labels` workflow syncs them to GitHub.

## Filing

- One defect or one request per issue. Search open and closed issues first.
- The web form asks for what happened, what was expected, how to reproduce, the jig version or commit, the OS and the AI agent. Blank issues are off.
- From the command line or an agent, the body uses the form's headings, so every issue reads the same:

  ```sh
  gh issue create --label bug,needs-triage --title "<area>: <what jig did>" --body-file body.md
  ```

  `body.md` has `### What happened`, `### Expected`, `### How to reproduce`, `### jig version or commit`, `### OS`, `### AI agent`.
- The title starts with the area, then the defect as observed: `check stop: eslint timeout on a 58-file diff ends in 'clean'`.
- Output is pasted as is, with private names, paths, merge request numbers and task keys replaced by placeholders. The repository is public.

## Triage

`needs-triage` comes off, and the issue gets one of:

| outcome | labels | action |
| --- | --- | --- |
| reproduced or accepted | `confirmed`, one `area: *`, `os: *` or `ai: *` when it shows only there | stays open |
| details missing | `needs-info` | a comment says what is missing |
| already reported | `duplicate` | `gh issue close <n> --duplicate-of <m>` |
| out of scope or not jig | `wontfix` or `invalid` | `gh issue close <n> --reason "not planned"` with a one-line reason |

## Fixing

- A bug fix starts with a test that fails on the reported case.
- The commit subject stays conventional (`fix(stop): ...`); the body ends with `Fixes #<n>`, or `Refs #<n>` when the commit fixes only part of it. One issue may take several commits: only the last one says `Fixes`.
- The commit carries its changeset and its `docs/` update; the changeset text ends with `(#<n>)`, so the changelog links the issue.
- After the commit, the issue gets `fixed-on-main` and a comment naming the commits. `main` is pushed only for a release, so the issue stays open until then.

## Release

- The push to `main` closes every issue named by `Fixes #<n>`. The changesets action opens the version pull request.
- When the version pull request is merged, the `Release` workflow tags the version, comments `Released in jig <version>` on every closed `fixed-on-main` issue and removes the label.
