---
"jig": minor
---

`jig ui mockup` compares a Figma node (a `figma-developer-mcp` tree export, fetched once with `JIG_FIGMA_API_KEY` else `FIGMA_API_KEY` and cached in `.jig/ui/figma/`, or `--export <file>`) with the code that implements it: colors through the design tokens (`MISSING`, `EXTRA`), typography per text role (`--role`), labels the change adds (`NOT IN MOCKUP`, `DUPLICATE`), `WRONG NODE` for a node that is app UI, and a geometry table; it exits 1 on blocking findings.
