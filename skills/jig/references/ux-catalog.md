# UX catalog

Data for atom `ux`: the values that break UI and what the break looks like. The rules stay in the atom.

## Failure signatures

What the user sees, its usual cause and fix. Before you report one, find the box owner (atom `ux`, section A): a wrapper may already apply the fix.

| Seen | Cause | Fix |
| --- | --- | --- |
| Text overflows its box | flex or grid child with `min-width: auto` | `min-width: 0`, or `minmax(0, 1fr)` |
| Email, URL, id or file name runs past the edge | a string with no break points | `overflow-wrap: anywhere` |
| Avatar or icon squished into an oval | a fixed-size flex child shrinks | `flex-shrink: 0` |
| Trailing action pushed off the row or clipped | the middle took all the space | `min-width: 0` on the middle, `flex-shrink: 0` on the action |
| Badge wraps onto two lines | badge allowed to shrink | `white-space: nowrap; flex-shrink: 0`, decide what yields |
| Last line cut mid-glyph | fixed height with `overflow: hidden` | intrinsic height, or a visible scroll or fade |
| Tall scripts or diacritics clipped | tight `line-height` with `overflow: hidden` | looser `line-height`, no clipping on text |
| Translated label overflows its button | fixed `width` | width from content with a `min-width` |
| Ellipsis and no way to read the rest | `text-overflow: ellipsis` alone | `title` or a tooltip, and the full value somewhere |
| Wrong initials (`J` for Jo, `�` for an emoji-first name) | `.split(' ')[0][0]` | grapheme clusters (`Intl.Segmenter`), a fallback icon |
| "1 members", `1284`, `NaN`, `undefined` | hardcoded plural, raw number | `Intl.PluralRules`, `Intl.NumberFormat`, a null guard |
| A number jitters as it updates | proportional figures | `font-variant-numeric: tabular-nums` |
| Media stretched or distorted | no fit rule | `object-fit: cover`, fixed size or `aspect-ratio` |
| Broken-image icon | no error fallback | initials or a placeholder on error |
| Layout jumps while an image loads | no reserved size | width and height, or `aspect-ratio` |
| 1,000 rows stutter | every row rendered | virtualize or paginate, say which |

## Worst-case values

Use `example.com` and `.test` domains. Spread the values across the first rows, as real data is, instead of stacking them into one row.

| Kind | Values |
| --- | --- |
| Names | `Aleksandra Wiśniewska-Kowalczyk` (long, hyphen, diacritics); `Christopher Alexander Montgomery III`; `Jo`; `J`; `Đặng Thị Ngọc Hân` (stacked diacritics); `王秀英` (CJK, no spaces); `نور الهدى عبد الرحمن` (RTL); `Seán O'Brien-Ó Súilleabháin` (apostrophe); `🦊 Fox` (emoji first); `  Sam   Lee ` (extra spaces); missing |
| Unbreakable strings | `bartholomew.fitzgerald@northwind-industries-holdings.example.com`; `a@b.co`; `first.last+billing@example.com`; a 100-character URL with a query; a UUID; `Q3 Board Deck - FINAL (revised) v12.pdf`; `IMG_20250914_183022_HDR_portrait_edited.HEIC` |
| Labels from data | a 50-character job title; a long status badge; `Benachrichtigungseinstellungen` (30 characters, no spaces); a French or German translation (about 30% longer); twelve tags on one item; one tag wider than its box; empty or spaces only; a newline in a one-line field; a 2,000-character pasted text; `<script>alert(1)</script>` |
| Numbers | `0`; `1`; `1284`; `1000000`; `12345678.9` as money; `-42.5`; `142%`; `null`; `NaN`; a live change from `99` to `100` |
| Collections | 0 items; 1 item; exactly the page size, and one more; 1,000+ unpaginated; one item 10 times the size of the others; items with the same name |
| Time | now; 12 days, 11 months and 3 years ago; a future date; `1970-01-01`; a time near midnight in another zone; a 1,284-hour duration |
| Media | a 404 image URL; no image; a 4000×200 and a 200×4000 image; a dark logo on a dark theme; a slow image |
| States | loading; an API error; partial data; every enum status in one list; no permission; the current user in the list |
| Environment | the real container width, then 320px and the widest layout; zoom 200%; dark theme, RTL and touch when the project supports them |
