---
"jig": minor
---

`partitions` in `.jig/review.jsonc` sets how a review splits the diff, as text (for example one finder per feature module whatever its size). With it `jig review-plan` computes no count by lines: it prints the text, the changed code files with their lines and the imports between them, the review runner groups the files by the text, and `jig review-plan --partition <name>=<paths>` writes the diff parts and finders for those groups, rejecting a code file in no group or in two. Every finder gets the text in its brief. Without the key the split by lines is unchanged.
