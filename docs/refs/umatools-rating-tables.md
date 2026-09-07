# UmaTools rating tables

Source: https://github.com/daftuyda/UmaTools/blob/389fad0e08a8b3f2041eb5ab6ec21382ef5e2cc1/public/js/rating-shared.js
(lines 167 to 218 for the stat table, 941 to 944 for the unique skill, 9 to 21 and 61 to 67 for the aptitude
buckets). Saved 2026-09-06. UmaTools credits the umakonga formula and GameWith data. The stat table matches the
game's evaluation screen exactly in the community's checks; the aptitude multipliers are UmaTools' fallback for
skills whose per-bucket scores are not listed, so treat them as an approximation.

Used by `src/model/rank.ts` (`statScore`, `skillScore`, `uniqueSkillScore`) with tests in `tests/model.test.ts`.

## Stat rating

Rating points for one stat value are the sum of a per-point rate over every point from 1 to the value, divided by
ten and rounded. The rate changes by block:

- 1 to 1200: 50-point blocks. Block 0 covers 1 to 49, block 1 covers 50 to 99, then each block starts at a
  multiple of 50 (100 to 149 is block 2, and so on); 1200 alone is block 24.
- 1201 to 2000: 10-point blocks. Block 0 covers 1201 to 1209, block 1 covers 1210 to 1219, then each block starts at
  a multiple of 10. The accumulated raw value is reset to 38,413 at 1200 before this range.
- 2001 to 2500: 25-point blocks at rate 183, rising by one each block. The accumulated raw value is reset to
  142,796 at 2000.

Per-point rates (raw, before the divide by ten):

```text
R1 (1..1200, 25 blocks of 50):
5, 8, 10, 13, 16, 18, 21, 24, 26, 28, 29, 30, 31, 33, 34, 35, 39, 41, 42, 43, 52, 55, 66, 68, 68

R2 (1201..2000, 81 blocks of 10):
79, 80, 81, 83, 84, 85, 86, 88, 89, 90, 92, 93, 94, 96, 97, 98, 100, 101, 102, 103, 105, 106, 107, 109, 110, 111,
113, 114, 115, 117, 118, 119, 121, 122, 123, 124, 126, 127, 128, 130, 131, 132, 134, 135, 136, 138, 139, 140, 141,
143, 144, 145, 147, 148, 149, 151, 152, 153, 155, 156, 157, 159, 160, 161, 162, 164, 165, 166, 168, 169, 170, 172,
173, 174, 176, 177, 178, 179, 181, 182, 182

R3 (2001..2500): 183 for 2001..2025, 184 for 2026..2050, ... (one more per 25 points)
```

Reference implementation, as in the source:

```js
const sc = [0]; let raw = 0, idx = 0;
for (let c = 1; c <= 1200; c++) { if (c <= 49) idx = 0; else if (c <= 99) idx = 1; else if (c % 50 === 0) idx++; raw += R1[idx]; sc[c] = Math.round(raw / 10); }
raw = 38413; idx = 0;
for (let c = 1201; c <= 2000; c++) { if (c <= 1209) idx = 0; else if (c <= 1219) idx = 1; else if (c % 10 === 0) idx++; raw += R2[idx]; sc[c] = Math.round(raw / 10); }
raw = 142796; idx = 0; let rate = 183;
for (let c = 2001; c <= 2500; c++) { if (idx >= 25) { rate++; idx = 0; } raw += rate; idx++; sc[c] = Math.round(raw / 10); }
```

Anchor values computed from that code (use these in tests, not rounded guesses):

| Stat | Points |
|---:|---:|
| 400 | 577 |
| 600 | 1,143 |
| 1,000 | 2,635 |
| 1,199 | 3,835 |
| 1,200 | 3,841 |
| 1,201 | 3,849 |
| 1,249 | 4,240 |
| 1,250 | 4,249 |
| 1,500 | 6,773 |
| 1,999 | 14,261 |
| 2,000 | 14,280 |
| 2,001 | 14,298 |

## Unique skill

`uniqueBonus = multiplier × uniqueLevel`, with multiplier 120 for a 1★ or 2★ trainee and 170 for 3★ and above.
The level starts at the trainee's star count and rises by one at each in-career level-up (see
`docs/refs/gametora-our-grand-concert.md`, "Unique Skill Level-ups"), capped at 6.

## Skill rating and aptitude buckets

UmaTools stores a score per skill and, for skills conditioned on an aptitude, a score per bucket of the trainee's
grade for that aptitude:

| Grades | Bucket | Multiplier used for compound conditions |
|---|---|---:|
| S, A | good | 1.1 |
| B, C | average | 0.9 |
| D, E, F | bad | 0.8 |
| G | terrible | 0.7 |

For a skill conditioned on several aptitudes (a `checkType` such as `sprint/turf`), UmaTools takes the best
multiplier within each group (surface, distance, style) and multiplies across groups. This project applies the same
multipliers to the base scores 217 (white), 262 (◎) and 508 (gold) from GameTora's skill tags (`sho`, `mil`, `med`,
`lng`, `dir`, `tur`, `run`, `ldr`, `btw`, `cha`). UmaTools' per-skill bucket scores were not copied.

Purple (negative) skills convert from their removal SP cost: 100 or more SP is −262, 70 or more is −174, anything
above 0 is −129, with a few named exceptions. Not used by this project.
