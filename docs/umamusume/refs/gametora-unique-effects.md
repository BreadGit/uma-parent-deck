# GameTora compound unique effects

Support cards unlock a unique effect at the level recorded in the feed, commonly 25 for SR or
30 for SSR, with exceptions. GameTora's static feed (`support-cards.json`,
field `unique`) stores it as `{ level, effects: [{ type, value, value_1..value_4 }] }`. Types below 100 are plain
passives with the same ids as `support_effects.json` (1 Friendship Bonus, 2 Mood Effect, 3 to 7 stat bonuses,
8 Training Effectiveness, 9 to 13 Initial Stats, 14 Initial Bond, 15 Race Bonus, 16 Fan Bonus, 17 Hint Levels,
18 Hint Frequency, 19 Specialty Priority, 30 Skill Point Bonus, and so on). Types 100 and up are conditional
effects whose meaning the feed does not define; GameTora renders them on the card page from the payload.

Schemas decoded 2026-09-06 from one card per type; type 115 added from the Global feed and rendered card description on 2026-09-16. Types 106 to 108 checked against GameTora's client code on 2026-09-18; see the decoding notes below.

| Type | Payload | Meaning (from the rendered text) | Example card |
|---:|---|---|---|
| 101 | value = bond threshold; value_1/value_2 = effect id and amount; value_3/value_4 = second effect id and amount | Gain effect A (+value_2) and effect B (+value_4) when the bond gauge is at least `value` | Taiki Shuttle 30053: 80, 3, 1, 30, 1 → Speed Bonus 1 and Skill Point Bonus 1 at bond 80 |
| 102 | value = bond threshold; value_1 = amount | When bond is at least `value` and the card is on a facility other than its type, Training Effectiveness +value_1 | Sakura Bakushin O 30083: 80, 20 |
| 103 | value = card types needed; value_1 = amount | With at least `value` different support card types in the deck, Training Effectiveness +value_1 | Agnes Digital 30085: 5, 15 |
| 104 | value = fans per step; value_1 = cap | Training Effectiveness +1 per `value` fans, up to value_1 | Narita Top Road 30086: 10000, 20 (cap at 200,000 fans) |
| 105 | value = per same-type card; value_1 = per Friend or Group card | Initial stat of the card's type +value per card in the deck; Friend and Group cards give value_1 to every stat | Symboli Rudolf 30090: 10, 2 |
| 106 | value = maximum counted trainings; value_1 = effect id; value_2 = amount per training | Gain effect value_1 (+value_2) per friendship training with this card, up to value times | Sirius Symboli 30091: 5, 1, 3 → Friendship Bonus +3 per training, up to 5 times for +15 |
| 107 | value = effect id; value_1/value_2 = unresolved; value_3 = maximum; value_4 = minimum | Effect value rises as current energy falls; GameTora's summary helper supplies the endpoints but its description omits the curve | Bamboo Memory 30094: 1, 10, 30, 15, 5 → Friendship Bonus between +5 and +15 |
| 108 | value = effect id; value_1 = baseline maximum energy; value_2 = slope in hundredths; value_3 = baseline bonus; value_4 = maximum bonus | Before rounding, start at +value_3%; add value_2 / 100 percentage points per maximum-energy point above value_1, capped at +value_4%. UmaSim truncates the resulting bonus; see evidence below | Seeking the Pearl 30095: 8, 100, 75, 5, 20 → Training Effectiveness +5% at maximum energy 100, +3 percentage points per 4 additional maximum energy, capped at +20% at 120 |
| 109 | value = effect id (8); value_1 = bond per step | Training Effectiveness +1% per value_1 combined support bond, up to 20% at 600 | Ikuno Dictus 30099: 8, 30 |
| 110 | value = effect id (8); value_1 = amount | Training Effectiveness +value_1 per support card on the same facility | El Condor Pasa 30102: 8, 5 |
| 111 | value = effect id (8); value_1 = amount | Training Effectiveness +value_1 per level of the current facility | Maruzensky 30107: 8, 5 |
| 112 | value = chance % | value% chance that the current training cannot fail | Nakayama Festa 30108: 20 |
| 113 | value = effect id (28 Energy Cost Reduction); value_1 = amount | Energy Cost Reduction value_1 during friendship (rainbow) training | Light Hello 30052: 28, 30 |
| 114 | value = effect id (8); value_1 = at 0 energy; value_2 = at 100+ energy | Training Effectiveness scales with current energy from value_1% to value_2% | Mejiro Palmer 30115: 8, 5, 20 |
| 115 | value = effect id (14 Initial Bond); value_1 = amount | All support cards gain Initial Friendship Gauge (+value_1) | Oguri Cap 30146: 14, 5 |
| 9991 | none | "Increases skill point gain when training together" (GameTora's own placeholder id) | Haru Urara 30098 |

## Decoding notes

Checked the locally cached `data/raw/support-cards.json` payloads against the live card pages and
[GameTora's effect decoder](https://gametora.com/_next/static/chunks/3391-6614f55ac6d3d50e.js)
on 2026-09-18. The decoder exports `ti` for descriptions and `lo` for effect summaries.
This asset URL is versioned and may disappear after a site deployment.

For [Sirius Symboli 30091](https://gametora.com/umamusume/supports/30091-sirius-symboli),
`ti` resolves `value_1` through the effect dictionary, uses `value` as the training count cap,
and multiplies `value * value_2` for the maximum. The middle `1` is the Friendship Bonus
id, and the resulting maximum is +15.

For [Seeking the Pearl 30095](https://gametora.com/umamusume/supports/30095-seeking-the-pearl),
`ti` resolves `value` as the effect id. It reduces `value_2 / 100` to the fraction `3 / 4` and
calculates the cap's maximum energy as `value_1 + (value_4 - value_3) * 100 / value_2`.

| Maximum energy | 100 | 104 | 108 | 112 | 116 | 120 |
|---|---:|---:|---:|---:|---:|---:|
| Type 108 Training Effectiveness | 5% | 8% | 11% | 14% | 17% | 20% |

These are the points described by GameTora. The four-energy wording expresses the reduced slope;
it does not establish four-energy activation steps. GameTora's renderer does not simulate training.

For type 107, `lo` identifies `value_3` as the maximum and `value_4` as the minimum.
Neither helper uses `value_1` or `value_2`, so GameTora does not decode those fields.

## Further evidence for types 107 and 108

Investigated 2026-09-18 using GameTora's decoder and UmaSim's executable community model.

### Type 108 rounding

[UmaSim's implementation](https://github.com/mee1080/umasim/blob/00a82f73428bb6eaa213d3ea6b420e50d6b2b202/core/src/commonMain/kotlin/io/github/mee1080/umasim/data/SupportCardSpecialUnique.kt#L242)
truncates the computed bonus to an integer before applying the cap. For Pearl at maximum
energy `M >= 100`, this is `min(20, floor(5 + 0.75 × (M - 100)))`.

| Maximum energy | 100 | 101 | 102 | 103 | 104 | 105 | 106 | 107 | 120 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| UmaSim bonus | 5% | 5% | 6% | 7% | 8% | 8% | 9% | 10% | 20% |

This supplies a documented community rounding rule, not a direct measurement of Global.

### Type 107 remains incompletely decoded

[UmaSim's implementation](https://github.com/mee1080/umasim/blob/00a82f73428bb6eaa213d3ea6b420e50d6b2b202/core/src/commonMain/kotlin/io/github/mee1080/umasim/data/SupportCardSpecialUnique.kt#L78)
hard-codes `15 - floor(0.15 × (max(30, energy) - 30))` and retains a data-interpretation TODO.
It does not derive the curve from all payload fields. At energy 110 it returns 3, below
GameTora's stated minimum of 5. This cannot establish the full game formula.

The fields and exact curve remain unverified from the inspected public evidence, not inherently
unknowable. Leave them unresolved until direct measurements or a complete decoder become available.
Neither manual-training formula establishes an average bonus in independent training.
