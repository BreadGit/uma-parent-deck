# Skill evaluation and purchase costs

Checked 2026-09-17 against the [GameWith evaluation simulator](https://gamewith.jp/uma-musume/article/show/279309)
and [UmaTools' extractor](https://github.com/daftuyda/UmaTools/blob/7d3a4e16a73bdccd6794e89546e3cd037f4b9ae5/scripts/data/gamewith-skills.js).

Skills of the same rarity can have different evaluation values. Examples before aptitude adjustments:

| Skill | Evaluation points |
| --- | ---: |
| Focus | 129 |
| Concentration | 394 |
| Right-Handed ○ | 129 |
| Right-Handed ◎ | 174 |
| Corner Recovery ○ | 217 |

Aptitude-conditioned skills can have individual scores for each aptitude bucket. UmaTools also
uses approximate multipliers for missing bucket values and compound conditions: S/A at 1.1,
B/C at 0.9, D/E/F at 0.8 and G at 0.7. These are fallback estimates, not verified multipliers
for every skill. An unconditioned skill receives its base value. See the
[rating-table source scope](umatools-rating-tables.md#skill-rating-and-aptitude-buckets).

Hint levels 0 through 5 discount SP costs by 0%, 10%, 20%, 30%, 35% and 40%.
Each discounted purchase cost is rounded down. Upgrades require lower forms to be bought;
the final rating counts the highest bought form rather than adding every prerequisite's rating.
The trainee's ordinary innate and awakening skills consume SP too. Her own unique skill has
a separate level-based evaluation value.

UmaTools' combined CSV can substitute an SP cost for a missing evaluation value. Such rows
are not evidence of a skill's actual rating. Its direct GameWith export distinguishes sourced
evaluation values from these fallbacks. Japanese names and rarity must agree when matching
skills across datasets; do not use a GameWith row ID as a GameTora skill ID.
