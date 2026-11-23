import { describeSwitch, type Combo } from '../matrix'
import { auditErrors, failuresOf, type AuditFinding, type AuditOutcome, type ComboResult, type ProveResult, type StateResult } from './result'

const STYLE = `
:root { color-scheme: light dark; --bg: #fff; --fg: #1b1f24; --muted: #59636e; --line: #d1d9e0; --card: #f6f8fa; --err: #b3261e; --warn: #8a5a00; --ok: #1a7f37; }
@media (prefers-color-scheme: dark) { :root { --bg: #0d1117; --fg: #e6edf3; --muted: #9198a1; --line: #30363d; --card: #161b22; --err: #ff7b72; --warn: #e3b341; --ok: #56d364; } }
* { box-sizing: border-box; }
body { margin: 0 auto; max-width: 1400px; padding: 24px; background: var(--bg); color: var(--fg); font: 14px/1.5 system-ui, sans-serif; }
h1, h2, h3 { margin: 0 0 8px; }
h2 { margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--line); }
code, pre { font-family: ui-monospace, Consolas, monospace; font-size: 13px; }
.meta, figcaption, .muted { color: var(--muted); }
.status-fail { color: var(--err); font-weight: 600; }
.status-ok { color: var(--ok); font-weight: 600; }
.shots { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; align-items: start; }
figure { margin: 0; padding: 8px; background: var(--card); border: 1px solid var(--line); border-radius: 6px; }
figure img { display: block; max-width: 100%; height: auto; border: 1px solid var(--line); }
figcaption { margin-bottom: 6px; font-size: 12px; }
table { width: 100%; margin: 8px 0 16px; border-collapse: collapse; }
th, td { padding: 4px 8px; text-align: left; vertical-align: top; border-bottom: 1px solid var(--line); }
th { color: var(--muted); font-weight: 600; }
.sev-error { color: var(--err); font-weight: 600; }
.sev-warn { color: var(--warn); }
.manual, .notes, .deviations { padding: 8px 16px; background: var(--card); border: 1px solid var(--line); border-radius: 6px; }
pre { margin: 0; white-space: pre-wrap; }
`

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const comboTitle = (combo: Combo): string =>
  [
    combo.target,
    `${combo.width}${combo.height === undefined ? '' : ` x ${combo.height}`} px`,
    combo.input,
    `theme ${combo.theme}${combo.themeSwitch === undefined ? '' : ` (${describeSwitch(combo.themeSwitch)})`}`,
    ...(combo.locale === undefined ? [] : [`locale ${combo.locale}`]),
  ]
    .filter((part): part is string => part !== undefined)
    .join(' · ')

const targetLabel = (finding: AuditFinding): string => {
  const { target } = finding
  const label = target.testid !== undefined ? `testid=${target.testid}` : (target.name ?? target.text ?? target.selector)
  return `${target.role === undefined ? '' : `${target.role} `}${label}`
}

const figure = (caption: string, path: string | undefined): string =>
  path === undefined ? '' : `<figure><figcaption>${escapeHtml(caption)}</figcaption><a href="${escapeHtml(path)}"><img src="${escapeHtml(path)}" alt="${escapeHtml(caption)}" loading="lazy"></a></figure>`

const percent = (ratio: number): string => `${(ratio * 100).toFixed(2)} %`

const auditTable = (audit: AuditOutcome): string => {
  const head = `<h4>${audit.kind === 'scene' ? 'scene audit' : 'layout audit'}: ${audit.errors} errors, ${audit.warnings} warnings${audit.scanned === undefined ? '' : `, ${audit.scanned} elements`}</h4>`
  if (audit.note !== undefined) return `${head}<p class="muted">${escapeHtml(audit.note)}</p>`
  if (audit.findings.length === 0) return `${head}<p class="muted">no findings</p>`
  const shot = audit.shot === undefined ? '' : ` <a href="${escapeHtml(audit.shot)}">shot</a>`
  const rows = audit.findings
    .map(
      (finding) =>
        `<tr><td>${escapeHtml(finding.rule)}</td><td class="sev-${finding.severity}">${finding.severity}</td><td><code>${escapeHtml(targetLabel(finding))}</code></td><td>${escapeHtml(finding.detail)}</td><td>${shot}</td></tr>`,
    )
    .join('')
  return `${head}<table class="audit"><thead><tr><th>rule</th><th>severity</th><th>target</th><th>detail</th><th>evidence</th></tr></thead><tbody>${rows}</tbody></table>`
}

const stateBlock = (state: StateResult): string => {
  const diff = state.diff
  const images = [
    figure('reference', diff?.reference),
    figure('result', state.shot),
    figure(diff === undefined ? 'diff map' : `diff map: ${percent(diff.ratio)} of pixels differ${diff.sizeMismatch ? ', sizes differ' : ''}`, diff?.map),
    ...state.audits.map((audit) => (audit.findings.length > 0 ? figure(`${audit.kind} audit shot`, audit.shot) : '')),
  ].join('')
  const failure = state.failure === undefined ? '' : `<p class="status-fail">${escapeHtml(state.failure)}</p>`
  const note = state.referenceNote === undefined ? '' : `<p class="muted">${escapeHtml(state.referenceNote)}</p>`
  return `<article><h3>${escapeHtml(state.state)}</h3>${failure}${note}<div class="shots">${images}</div>${state.audits.map(auditTable).join('')}</article>`
}

const comboBlock = (combo: ComboResult): string => {
  const failures = failuresOf(combo).map((text) => `<p class="status-fail">${escapeHtml(text)}</p>`).join('')
  return `<section class="combo" id="${escapeHtml(combo.id)}"><h2>${escapeHtml(comboTitle(combo.combo))}</h2>${failures}${combo.states.map(stateBlock).join('')}</section>`
}

export const renderPage = (result: ProveResult, deviations: string | undefined): string => {
  const errors = result.combos.reduce((sum, combo) => sum + auditErrors(combo), 0)
  const warnings = result.combos.reduce((sum, combo) => sum + combo.states.reduce((inner, state) => inner + state.audits.reduce((acc, audit) => acc + audit.warnings, 0), 0), 0)
  const failed = errors > 0 || result.combos.some((combo) => failuresOf(combo).length > 0)
  const status = failed ? `<p class="status-fail">${errors} audit errors, ${warnings} warnings</p>` : `<p class="status-ok">no audit errors, ${warnings} warnings</p>`
  const notes = [
    ...result.notes,
    ...result.skipped.map((skipped) => `skipped ${comboTitle(skipped.combo)}: ${skipped.why}`),
  ]
  const manual =
    result.manual.length === 0
      ? ''
      : `<section><h2>Check by hand</h2><div class="manual"><p class="muted">jig cannot drive these targets; the user proves them.</p><ul>${result.manual
          .map((target) => `<li><code>${escapeHtml(target.name)}</code> (${escapeHtml(target.runtime)}${target.widths.length > 0 ? `, ${target.widths.join(', ')} px` : ''})</li>`)
          .join('')}</ul></div></section>`
  const deviationBlock = deviations === undefined ? '' : `<section><h2>Accepted deviations</h2><div class="deviations"><pre>${escapeHtml(deviations.trim())}</pre></div></section>`
  const noteBlock = notes.length === 0 ? '' : `<section><h2>Notes</h2><div class="notes"><ul>${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul></div></section>`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>UI evidence: ${escapeHtml(result.branch)}</title>
<style>${STYLE}</style>
</head>
<body>
<header>
<h1>UI evidence <code>${escapeHtml(result.branch)}</code></h1>
<p class="meta">generated ${escapeHtml(result.generatedAt)}${result.reference === undefined ? ', no reference' : `, reference: ${escapeHtml(result.reference)}`}${result.root === undefined ? '' : `, audit root: ${escapeHtml(result.root)}`}</p>
<p>${result.combos.length} combinations proven.</p>
${status}
<nav>${result.combos.map((combo) => `<a href="#${escapeHtml(combo.id)}">${escapeHtml(combo.id)}</a>`).join(' · ')}</nav>
</header>
${noteBlock}
${result.combos.map(comboBlock).join('\n')}
${manual}
${deviationBlock}
</body>
</html>
`
}
