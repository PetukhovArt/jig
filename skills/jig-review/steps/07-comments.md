# Comment texts

Mode `review` with state on only: texts exist to be posted as threads. Mode `pre-mr` prints the judge's `summary` per finding in the [verdict](08-output.md#pre-mr-verdict); a review without a merge request prints it in the [output](08-output.md#output). Neither writes thread texts.

## Which form

Comes **after** the gate and the ranking. Only a finding that will really be printed gets `mrComment`. Nothing is written for a candidate verify refuted or a gate cut.

You write short comments yourself from the judge's evidence, without a subagent and without rereading. An expanded one needs the code to name the owner: one subagent per such finding, role `composer`, in parallel (it writes text over finished evidence; the verdict is already given). Its brief: the finding, its evidence, the file, the review document block.

- **Nit / Pre-existing** → short, always. Nothing promotes them.
- **Important, an ordinary bug** (null, race, off-by-one, missing `await`) → short.
- **Important architectural**: angles 6, 7, 9, 10, 13, or a named pattern from the project's review vocabulary → expanded.
- **Spec (angle 15)** → short; instead of the triggering input, the quote of the spec line.
- **A merged finding of angle 16 or 17** ([merge per file](06-rank.md#merge-per-file)) → `**[🟡 Nit]**` and one sentence with the number of instances, then a list: one line per instance (the test name or the first words of the comment in backticks) and the criterion item. The list is outside the limit, no suggestion. One defect, several instances, so "one defect per comment" holds.
- **Simplification** (`status: "optional"`) → one sentence: what to simplify and how. No severity badge, no suggestion: it becomes a checklist item of the FYI note, not a thread.

## Short form

`**[🔴 Important｜🟡 Nit｜🟣 Pre-existing]**` plus one sentence with the problem, an empty line, one sentence with the cause and the risk: a concrete failure scenario (input → wrong result).

The suggestion block is outside the limit.

**The chip opens the body**, every form, counter-replies aside: nothing before `**[`, not a path, not a heading. A review cycle tells an optional thread (Nit, Pre-existing) from a blocking one by the first line of its opening note, read off the forge: an open Nit never withholds the merge, and a Nit whose chip is not first counts as blocking.

- **Nit / Pre-existing: up to 4 lines / ~350 characters.** No fix in prose, only a ` ```suggestion ` block.
- **Important: up to 8 lines / ~800 characters**, and two things are required that the author gets nowhere else:
  1. **the triggering input written out**: archive records, click order, field values: what reproduces it. A list of files goes in a fenced block;
  2. when the fix is wider than one line and a suggestion cannot hold it: **one imperative sentence with the fix direction**.

One defect per comment. A second separable problem (a test renamed past the case, a doc line that now lies) is its own finding, never a trailing paragraph. Over the limit: the finding is unfocused; cut it or split it in two.

## Expanded form

Architectural Important only. **Up to 10 lines.** Three paragraphs, each owning one thought:

1. `**[🔴 Important]**` (a blocking one: `**[🔴 Important · rework]**`) plus the verdict by pattern: the name of the pattern or smell, what exactly is broken, a concrete failure scenario.
2. **Where the truth lives:** which module or port owns this decision and why; what in the code already expresses that ownership.
3. **Recommendation, imperative:** the fix direction as an instruction to the author: who takes the responsibility, whose argument or parameter it becomes. Naming a signature is fine, writing a body is not. A realistic alternative exists: name it and its cost in one sentence.

The fix direction goes through ownership, not a step-by-step plan. Speculative code (function bodies, multi-line snippets): never.

## Rules for both forms

- An optional tail after the main text: `<details><summary>Reasoning</summary>…</details>`, only the trace of the check: what was checked, which line proves it. Outside the line and character limits.
- Short sentences, active voice, one thought per sentence, no nested clauses.
- **The scenario names its entry point:** where it starts: screen, mode, element. "In the input field on the scene, at runtime, the user types…", not "the operator types…". A developer checked another panel than the one meant and answered that the finding was false.
- **A suggestion replaces exactly one line**: the line the comment is attached to (posting normalizes the block so "Apply" replaces only it; multi-line content breaks the code). A fix wider than one line: no block, diagnosis only.
- **No `file:line` or anchors in the body**: the comment is already attached to a line. Refer to other code by symbol (`Class.method`), not by path with a number.
- **Name a named rule.** A finding that matches a rule, pattern or smell with a name in the project's review document carries that name in `mrComment` and `summary` as is: `**[<severity>]** <rule name>: …`. Verify assigns the severity; the rule name does not change it. Holds for every angle, not only 10.
- **Language:** `language` from the [project config](../references/project-config.md); otherwise the language the merge request description and its threads are written in. Identifiers, paths, flags and technology names stay as they are; project terms follow its glossary. No transliterated jargon.
- **Never mention AI, agents, models, skills or config paths**: the authority comes from the code, not from tools.
