# Tiers

Every role template names a tier and an effort on its second line: `tier: <deep|standard|fast>, effort: <low|medium|high>`. They describe the job, not a model. `node <root>/bin/jig.mjs tiers` prints which models of the current agent serve each tier.

## Tier

- `deep`: the strongest reasoning available. Synthesis, judging, design, root cause: work where a wrong conclusion costs more than the run.
- `standard`: balanced reasoning and cost. Exploring, finding, fixing: work with a clear goal that still needs judgment.
- `fast`: the cheapest capable model. Mechanical work: reformatting, collecting, applying a decided change.

## Effort

- `low`, `medium`, `high`: how long the model should think before answering.
- Pass it as the agent's own effort or reasoning parameter. An agent without one ignores it.

## Mapping

- `jig tiers` prints, per tier, an ordered list of models: the built-in defaults for the agent, overridden by the `tiers` key in `~/.jig/config.jsonc`.
- Built-in defaults: Claude Code: `deep` → opus, sonnet; `standard` → sonnet; `fast` → haiku. Other agents have no built-in mapping.
- A single subagent takes the first model of its tier. Parallel candidates take the models in order (`references/coliseum.md`).
- No mapping for this agent: choose the model that fits the tier description above.
