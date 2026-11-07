# Severity

Every judge reads this file. Two parts with different owners:

- **taxonomy**: which defect classes are `Important` and which `Nit`. The project's severity sections (verbatim in your brief) exist → only they apply; the default below applies neither whole nor in parts. None → the [default](#default-taxonomy);
- **gates**: when severity is cut regardless of class. They always apply; a project cancels a gate only explicitly, by naming it.

`angles.<n>.severityCeiling` (or `angles.<name>.severityCeiling` of a project angle) from the project config (named in your brief when set) stands over both: it sets the ceiling of that angle's findings, up or down.

## Default taxonomy

`Important`: the merge waits for the fix, because the user meets the defect. The classes are closed; the class code in brackets:

- **Behavior:** broken behavior (`broken`), data loss (`data-loss`), crash (`crash`).
- **False guarantee** (`false-guarantee`, [angle 16](../angles/16.tests.md)): a test that cannot fail when the behavior it names breaks. Nothing breaks now; the next edit is made on a guarantee that does not exist. A redundant test stays `Nit`.

`Nit` (`nit`): worth fixing, does not block the merge. Everything outside the classes above.

The shape of code (layers, duplication, naming, smells) is not a class: the project's tooling owns it ([angles](../angles/00-index.md)). A project vocabulary has its own scale, and it wins.

## Gates

The gate code in brackets.

- `Pre-existing` (`pre-existing`): lives in untouched lines of touched code; kept only with an Important class.
- Efficiency: `Nit` (`efficiency`), except a `CONFIRMED` memory leak, CPU load with its rate proven, or a deep reactive container written by a high-frequency stream with its rate proven ([angle 8](../angles/8.efficiency.md)). They follow the general rules.
- A secret in the diff ([angle 14](../angles/14.security.md)): `Important` with no input.
- A latent defect (fires only on a future edit): `Important` only when THIS diff sets the trap and the failure will be silent: no test, validation or error will catch it. Latent and loud, latent and pre-existing → `Nit` (`latent`) / `Pre-existing`.
- The angle ceiling from the config (`ceiling`).
- The focus directs attention, not severity. Rarity of the input does not lower severity: a bug that passed the rare gate gets the severity of its class.

## Class code

Two fields go with the severity:

- **`severity_class`**: the class code from the taxonomy in force: `I2`, `N3` for a project, `data-loss`, `nit` by default;
- **`severity_gate`**: the gate code, only when a gate cut the severity below the class level.

A class outside the taxonomy in force, or a severity below the class level without `severity_gate`, is a mismatch the orchestrator sends back. A judge gave `Nit` to erased user input that the project rated `I2`: nobody asked for the class, and the error showed only in the thread.

## Category

`category` is the slug of the angle that raised the candidate, one of five: `correctness` (bug angles, a wrong test of angle 16 and project angles of kind `behavior`), `security`, `efficiency`, `spec`, `conventions` (a redundant test of angle 16 and project angles of kind `conventions`). `docs`, `design`, `style`, `test-coverage` are not categories. An angle that does not map means the candidate belongs to no angle: drop it.
