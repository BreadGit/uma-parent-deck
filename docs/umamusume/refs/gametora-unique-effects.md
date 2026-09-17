# GameTora compound unique effects

Support cards unlock a unique effect at level 30 (SSR), 35 or 40. GameTora's static feed (`support-cards.json`,
field `unique`) stores it as `{ level, effects: [{ type, value, value_1..value_4 }] }`. Types below 100 are plain
passives with the same ids as `support_effects.json` (1 Friendship Bonus, 2 Mood Effect, 3 to 7 stat bonuses,
8 Training Effectiveness, 9 to 13 Initial Stats, 14 Initial Bond, 15 Race Bonus, 16 Fan Bonus, 17 Hint Levels,
18 Hint Frequency, 19 Specialty Priority, 30 Skill Point Bonus, and so on). Types 100 and up are conditional
effects whose meaning the feed does not define; GameTora renders them on the card page from the payload.

Schemas decoded 2026-09-06 from one card per type; type 115 added from the Global feed and rendered card description on 2026-09-16:

| Type | Payload | Meaning (from the rendered text) | Example card |
|---:|---|---|---|
| 101 | value = bond threshold; value_1/value_2 = effect id and amount; value_3/value_4 = second effect id and amount | Gain effect A (+value_2) and effect B (+value_4) when the bond gauge is at least `value` | Taiki Shuttle 30053: 80, 3, 1, 30, 1 → Speed Bonus 1 and Skill Point Bonus 1 at bond 80 |
| 102 | value = bond threshold; value_1 = amount | When bond is at least `value` and the card is on a facility other than its type, Training Effectiveness +value_1 | Sakura Bakushin O 30083: 80, 20 |
| 103 | value = card types needed; value_1 = amount | With at least `value` different support card types in the deck, Training Effectiveness +value_1 | Agnes Digital 30085: 5, 15 |
| 104 | value = fans per step; value_1 = cap | Training Effectiveness +1 per `value` fans, up to value_1 | Narita Top Road 30086: 10000, 20 (cap at 200,000 fans) |
| 105 | value = per same-type card; value_1 = per Friend or Group card | Initial stat of the card's type +value per card in the deck; Friend and Group cards give value_1 to every stat | Symboli Rudolf 30090: 10, 2 |
| 106 | value = per friendship training; value_1 = times; value_2 = per step | Friendship Bonus +value_2 each time this card is in a friendship training, up to value_1 times | Sirius Symboli 30091: 5, 1, 3 → up to 15 |
| 107 | value, value_1..value_4 | Friendship Bonus rises as energy falls (the text gives no numbers) | Bamboo Memory 30094: 1, 10, 30, 15, 5 |
| 108 | value = base %, value_1 = energy base, value_2 = ?, value_3 = per step, value_4 = cap | Training Effectiveness +value%, plus value_3% per 4 maximum energy above value_1, up to value_4% | Seeking the Pearl 30095: 8?, 100, 75, 5, 20 (text says 5% base, 20% at 120) |
| 109 | value = effect id (8); value_1 = bond per step | Training Effectiveness +1% per value_1 combined support bond, up to 20% at 600 | Ikuno Dictus 30099: 8, 30 |
| 110 | value = effect id (8); value_1 = amount | Training Effectiveness +value_1 per support card on the same facility | El Condor Pasa 30102: 8, 5 |
| 111 | value = effect id (8); value_1 = amount | Training Effectiveness +value_1 per level of the current facility | Maruzensky 30107: 8, 5 |
| 112 | value = chance % | value% chance that the current training cannot fail | Nakayama Festa 30108: 20 |
| 113 | value = effect id (28 Energy Cost Reduction); value_1 = amount | Energy Cost Reduction value_1 during friendship (rainbow) training | Light Hello 30052: 28, 30 |
| 114 | value = effect id (8); value_1 = at 0 energy; value_2 = at 100+ energy | Training Effectiveness scales with current energy from value_1% to value_2% | Mejiro Palmer 30115: 8, 5, 20 |
| 115 | value = effect id (14 Initial Bond); value_1 = amount | All support cards gain Initial Friendship Gauge (+value_1) | Oguri Cap 30146: 14, 5 |
| 9991 | none | "Increases skill point gain when training together" (GameTora's own placeholder id) | Haru Urara 30098 |

Payload fields marked `?` did not match the rendered text one to one; check the text before using them.
