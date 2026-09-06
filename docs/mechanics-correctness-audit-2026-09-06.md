# Game mechanics correctness audit

Date: 2026-09-06
Audited commit: `4f9ac84`
Audit branch: `audit/game-mechanics-correctness`
Audience: implementation agents correcting game-mechanics behavior

## Scope and source policy

This audit covers the Independent Training schedule, inheritance, skill-source probabilities, white-spark generation, run-stat prediction, rank prediction, deck selection, normalized data, and the end-to-end UI.

Use Global names in code and UI. The newly added source uses JP-community names. Translate them with `docs/new-player-info.txt:166-216`. The important mappings are:

- Gene or factor means spark.
- Compatibility means affinity.
- Parent means Legacy.
- Grandparent means sub-Legacy.
- Mid-run inheritance means inspiration event.
- Intelligence or wisdom means Wit.
- Short and mid mean Sprint and Medium.
- Runner, leader, betweener, and chaser mean Front Runner, Pace Chaser, Late Surger, and End Closer.

The new local reference is `docs/refs/crazyfellow-parenting-gene-guide.txt`. It is a complete 2026-09-06 plain-text export of Crazyfellow's Parenting & Gene guide. The export preserves text and tables but not embedded images. Relevant source links remain in the text. Treat this guide as a high-quality synthesis, not as executable game code. Prefer official Cygames statements, direct GameTora tables, the cited research datasets, or repeatable project observations when they disagree.

The guide discusses two distinct features. It usually calls Independent Training "Background Auto" or "BG auto," and calls Auto-Train / おまかせ "Auto-kun." The author assumes they share much of their decision logic, but that is not proof that a mechanic observed in Auto-Train also exists in Independent Training. Keep every claim mode-specific. The vendored guide has the same warning at its top.

The new guide materially changes the original audit in four places:

1. The Independent Training race table is stale and must be replaced.
2. Its support-card `!` priority claim concerns Auto-Train and must not be applied to Independent Training without mode-specific data.
3. The blue-spark inspiration ranges have stronger corroboration, but the exact value distribution remains unknown.
4. Skill affordability is an edge-case UI guard for now. Do not build a full SP-constrained probability model in this pass.

## Priority 1: deterministic correctness fixes

### 1. Replace the Independent Training win calculation

Current implementation: `src/model/races.ts:8-27` and `src/model/races.ts:52-63`.

The implementation uses the older uma.guide matrix and subtracts 10% on the third consecutive race, 25% on the fourth, 35% on the fifth, and 50% on the sixth. It also clamps the aptitude-only value to 100% before applying the consecutive-race penalty.

The corrected July 2026 data linked from `docs/refs/crazyfellow-parenting-gene-guide.txt:353-568` uses this additive model:

```text
raw win score = 110%
              + surface aptitude penalty
              + distance aptitude penalty
              + consecutive-race penalty

surface: A 0, B -10, C -20, D -30, E -50, F -60, G -90
distance: A 0, B -10, C -20, D -30, E -40, F -60, G -90
streak: first 0, second 0, third -5, fourth -20, fifth -30, sixth+ -50
displayed/probability value = clamp(raw score, 0%, 100%)
```

The source spreadsheet is:

https://docs.google.com/spreadsheets/d/1e6KPdIXPM7-8e9So3Bd3Pl3arO0aTeFdjI0P_1-4iFo/edit?gid=1621158841#gid=1621158841

Consequences in the current implementation:

- A/A on the third consecutive race becomes 90%; it should remain 100% because `110 - 5 = 105`, capped to 100.
- A/A on the fourth becomes 75%; it should be 90%.
- A/G with no streak is modeled as 50%; corrected data gives 20%.
- E is not symmetric. Surface E is a 50-point penalty, while distance E is a 40-point penalty.

Implementation notes:

- Do not clamp the raw 110% base before applying the streak penalty.
- Replace `GRADE_INDEX` matrix lookup with the explicit surface and distance penalty tables.
- Keep S equivalent to A.
- Replace the existing streak regression test at `tests/model.test.ts:105-114`. It currently asserts the stale behavior.
- Add exact tests for A/A, A/B, A/E, E/A, A/G, G/A, and all six streak positions.

Objective races also need a separate rule. The new guide says objective races whose failure would end the run are automatically won, while participation-only objectives such as Haru Urara's Arima Kinen are not. The raw objective data contains `cond_value`, but `normalizeCharacters()` drops it and the normalized goal type has no required-placement field. Persist `cond_value`. Treat a positive required-placement condition as a guaranteed win and a zero participation condition with ordinary aptitude odds. Add fixtures for Haru Urara's Arima Kinen and a required-placement G1.

### 2. Replace the rating curve and trainee unique-skill score

Current implementation: `src/model/rank.ts:5-35`.

`R1` contains 25 fifty-point bands although its comment says it ends at 1200. The code then starts `R2` at 1200, double-counting 1200 to 1250. `R2` is a linear approximation instead of the game's nonlinear table.

Current versus reference values:

| Stat | Current | Reference |
|---:|---:|---:|
| 400 | 575 | 577 |
| 600 | 1,140 | 1,143 |
| 1,200 | 3,835 | 3,841 |
| 1,500 | 7,113 | 6,773 |
| 2,000 | 14,615 | 14,280 |

Use the exact tables and boundary behavior from:

https://github.com/daftuyda/UmaTools/blob/389fad0e08a8b3f2041eb5ab6ec21382ef5e2cc1/public/js/rating-shared.js#L167-L218

Also correct these deterministic rules:

- Skill rating depends on the applicable aptitude bucket. `skillScore()` currently ignores aptitude.
- The unique-skill multiplier is 120 for one-star and two-star trainees, and 170 for three-star or higher trainees.
- Multiply by the predicted final unique-skill level. Do not hardcode level 3. Our Grand Concert unique levels depend on fan thresholds and the April chairperson-bond check in `docs/refs/gametora-our-grand-concert.md:385-397`.

Keep `skillScorePerSp`, `skillScoreSd`, and `innateSkillBuyShare` labeled as estimates. They are not exact game rules.

Acceptance tests should cover exact stat-score anchors and 1199, 1200, 1201, 1249, 1250, 1999, 2000, and 2001.

### 3. Separate career-start blue gains from inspiration gains

Current implementation: `src/model/rules.ts:20-23` and `src/model/inherit.ts:41-51`.

The fixed `+5`, `+12`, and `+21` values apply at career start. The two inspiration events use random gains. The new guide corroborates the following bounds at `docs/refs/crazyfellow-parenting-gene-guide.txt:1636-1678`:

| Blue spark | Career-start gain | Inspiration-event gain |
|---:|---:|---:|
| 1 star | 5 | 1 to 10 |
| 2 stars | 12 | 1 to 16 |
| 3 stars | 21 | 1 to 28 |

It also says higher-star sparks are more likely to roll near the upper end. This rules out both the current fixed values and an undocumented uniform distribution.

The exact probability mass function is still unresolved. The guide cites a GameWith sample smaller than 30 and explicitly considers it too small for exact probabilities. Implement one of these transparent options:

1. Preferred: add configurable per-star expected inspiration gains backed by logged Global observations, and display the result as an estimate.
2. Interim: use a clearly named expected-value assumption inside the published bounds and retain the min/max range in the UI.

Do not present a midpoint or uniform model as a discovered game rule. Replace `tests/model.test.ts:163-167`, which currently requires fixed gains. Correct the same claim in `README.md:38` and `docs/GLOSSARY.md:50`.

### 4. Model individual affinity, not one overall value

Current implementation: `src/model/inherit.ts:41-51`, `src/model/sparks.ts:229-241`, and `src/settings.ts:167`.

Each Legacy and sub-Legacy has its own affinity relationship. The current scalar is applied to all six ancestors. An overall ◎ can be the sum of several weak individual relationships, so this can greatly overstate some spark proc rates.

The supported formula is:

```text
per-spark proc chance = base chance by type and stars × (1 + individual affinity / 100)
```

The guide documents the formula and zero-affinity bases at `docs/refs/crazyfellow-parenting-gene-guide.txt:3209-3274`. The Cygames patent gives the same multiplier structure:

https://patents.google.com/patent/JP2022018121A/en#p=328

The current blue 70/80/90%, skill-white 3/6/9%, green 5/10/15%, and pink 1/3/5% bases are supported. The lower observed sub-Legacy rate does not require an extra one-half multiplier. It follows from that sub-Legacy's lower individual affinity.

UI/data-model work:

- Store an affinity value per spark owner, or per each of the six lineage positions.
- Keep aggregate lineage inputs only if the UI labels them as an approximation.
- Correct the help text. Overall ◎ is greater than 150, not equal to 150.
- Retain a migration path for existing saved state with one scalar.

### 5. Apply scenario stat caps and inherited cap increases

Current implementation: `src/model/stats.ts:85-104` and `src/model/run.ts:141-144`.

Our Grand Concert caps are Speed 1600, Stamina 1300, Power 1300, Guts 1500, and Wit 1300. The code can produce impossible values and then feed them into rank and P(SS).

Blue sparks raise the corresponding cap. Green-spark inspiration procs can raise caps based on the source trainee's growth-bonus stats. The guide confirms this at `docs/refs/crazyfellow-parenting-gene-guide.txt:1685-1695`, but says the precise green cap amount is unknown and usually single digits.

Implement known blue cap increases before clamping. Keep unknown green increases out of the exact model or expose them as an explicit estimate. Do not merely clamp to the base scenario caps because that would ignore known blue cap increases.

### 6. Reject unsafe total-turn overrides

Current implementation: `src/settings.ts:119` and `src/model/stats.ts:20-23`.

`raceScale()` divides by `T - reference`. The settings UI permits `T = 28`, which divides by zero and locked the browser during the audit. Values below 28 can create negative or zero contribution scaling.

Either remove this internal fit parameter from the user-facing UI or validate `T > model.races.reference`. Add finite-number assertions at the prediction boundary and a regression test for 28 and values below it.

## Priority 2: skill acquisition and event correctness

### 7. Keep support-card hint behavior mode-specific

Current implementation: `src/model/sparks.ts:61-66`, `src/model/run.ts:132-150`.

The model applies the same per-card hint process regardless of which skills the user prioritizes. That is not established as a defect.

At `docs/refs/crazyfellow-parenting-gene-guide.txt:599-609`, the guide says Auto-kun uses prioritized skills to choose a training with an active support-card `!` hint and to choose event options. In the surrounding section, Auto-kun means Auto-Train. The guide separately calls Independent Training BG auto and says only that the two modes are *assumed* to use the same logic based on post-run observations.

The available Independent Training evidence supports prioritized skills influencing Career Event choices. It does not establish that they influence support-card `!` selection. Do not add a priority-dependent support-hint multiplier from this guide.

Implementation direction:

- Leave support-hint acquisition priority-independent until Independent Training observations show otherwise.
- Keep `hintBase`, `hintScale`, and `hintTurnsShare` labeled as unmeasured Independent Training estimates.
- If logs become available, compare acquisition rates for otherwise similar prioritized and unprioritized support-pool skills before changing the model.
- Do not use Auto-Train or normal-career behavior as a drop-in substitute.

For reference, the reverse-engineered normal-career formula differs from the current 7% formula, but it still does not prove Independent Training behavior:

https://github.com/mee1080/umasim/blob/47b790b26ca20e0072184ee7795366c5b160fee2/core/src/commonMain/kotlin/io/github/mee1080/umasim/data/SupportCard.kt#L136-L171

### 8. Stop skills 11 and later from steering event choices

`planRun()` derives priority from the full candidate list at `src/model/run.ts:136`. It only slices the visible result to ten at lines 149-150. Entries past ten therefore affect `pruneConflicts()` even though the game cannot prioritize them.

Slice to ten before `derivePriority()` and before every event calculation that depends on prioritization. Add a run-level test where candidate 11 conflicts with a target and prove that it cannot steer the result.

Relative drag order is still an unsupported assumption. The Independent Training sources confirm that chosen skills influence choices, but do not say that list order resolves conflicts. Current JP auto training is a different mode; it maximizes the count of still-relevant prioritized hints in an option and randomizes ties, while list order has no effect:

- https://umamusume.jp/steam-news/detail?id=3208
- https://umamusume.jp/news/detail?id=155

Do not copy that algorithm into Independent Training without an A/B test. Until measured, label contested-option resolution as an assumption.

### 9. Replace generic event reward probabilities with event-specific outcomes

Current implementation: `src/model/sparks.ts:68-123` and `src/model/sparks.ts:341-351`.

Confirmed defects:

- `sr` reward lists are split uniformly even when the game uses a stat-dependent or other conditional roll.
- One global `bigRewardRate` is assigned according to decoded array position. Outcome ordering does not consistently identify the large reward.
- Duplicate copies of the same skill in one realized outcome are added together as independent probability.
- Gold and white outcomes from one event are later combined as independent sources.
- Sources repeated across nested chain stages are treated as independent, although reaching a later stage implies earlier stages occurred.
- `pruneConflicts()` drops a second target even when the selected option awards both target skills.

Required regression fixtures:

- Fine Motion SSR 30010 chain 3. The Speed Star outcome depends on the relevant stat with documented probabilities of 30%, 60%, 65%, 75%, 80%, or 90%. See `docs/mechanics.txt:615-630`.
- El Condor Pasa SSR 30102 chain 3. Duplicate Speed Star rewards in one outcome must produce one 12% chain source, not 24%.
- Matikanetannhauser SSR 30103. Three copies of It's On! in one outcome must not triple the source probability.
- Ines Fujin SR 20030 chain 2. One selected option can award both Medium Straightaways and Sympathy; keep both.
- Twin Turbo's repeated family across chain stages. Model the nested dependency.

A robust representation should keep event occurrence, selected option, conditional outcome, and all rewards from that outcome together until ownership probabilities are evaluated. Flattening each reward into an independent `SkillSource` loses the required correlations.

### 10. Add the Our Grand Concert completion skill

The normalizer only extracts the linked Senior November event. It omits the scenario completion reward described at `docs/refs/gametora-our-grand-concert.md:359-373`:

- 18 to 21 songs: I Wanna Win with You at level 1.
- All 22 songs: I Wanna Win with You at level 3.
- 17 or fewer songs: On the Way to Our Dream.

The browser reproduced the omission. Selecting I Wanna Win with You resolved to the white family and displayed `0%`, `no source in deck`.

The model does not predict song count. Add an explicit scenario-completion assumption or measured probability rather than silently omitting both branches.

### 11. Split fixed, random, outing, and costume-specific trainee events

Current implementation: `scripts/fetch-gametora.mjs:298-313` and `src/model/sparks.ts:182-200`.

Every GameTora `nochoice` and `wchoice` event is normalized as `story` or `choice`, then both receive `charStoryEventRate = 1`. Those page groups include random character events. They are not all fixed career events.

The fetcher also loads one character-event page per character and applies it to every outfit. Skills listed for an alternate outfit but absent from the decoded base page are added as guaranteed plain sources. Special Week's summer and Ruler of Japan outfit skills are examples.

Normalize event timing/type separately. Fetch or preserve outfit-specific event data. Do not assign an undecoded costume event 100% probability.

### 12. Treat availability and purchase as separate concepts

Current implementation: `src/model/sparks.ts:143-156`, `src/model/sparks.ts:203-208`, and coverage labels in the UI.

Support hints, awakening unlocks, and inherited hints make a skill available or cheaper. They do not mean the skill is already owned. The guide confirms that Independent Training does not buy skills during the run at `docs/refs/crazyfellow-parenting-gene-guide.txt:599-609`; the player chooses purchases at completion.

For this implementation pass, follow the product decision below instead of building an SP-constrained probability model:

- Continue assuming that the user buys every selected target skill.
- Display one value labeled `Worst-case target SP cost`.
- For each selected target, add exactly one undiscounted base `Skill.cost`. Use the gold version's base cost when the coverage assumption buys the gold form; otherwise use the ordinary target's base cost. If both forms are possible, use the higher base cost.
- Do not add prerequisite costs, hint discounts, probability weighting, or purchase optimization.
- Compare that simple sum with predicted SP and show a visible warning when it exceeds predicted SP.
- If any selected form lacks a cost, mark the total incomplete rather than treating the missing value as zero.
- Label coverage as conditional on the user buying the targets, not as automatic ownership.

This is primarily an edge-case guard. It is intentionally a worst-case undiscounted sum, not a model of the purchases the run will actually make. Keep it below the deterministic formula and event fixes.

Also handle the ordinary versus ◎ purchase choice. Owning ◎ uses the supported 25% spark-generation base, while ordinary uses 20%. `sparkChance()` currently collapses ◎ into ordinary.

## Priority 3: run prediction and recommendation quality

### 13. Include Race Bonus in run output

`EFFECT.raceBonus` exists at `src/model/stats.ts:4-7` but is never consumed. `docs/refs/umaguide-independent-training.md:87-90` says Independent Training event stat gains depend on Race Bonus and trainee growth. `docs/mechanics.txt:592-647` contains measured normal race-reward scaling and the important 34% breakpoint.

Do not add a guessed linear term. Fit Independent Training data grouped by total deck Race Bonus, especially around 34%, or expose the current run baseline as Race-Bonus-specific. Until then, cards with different Race Bonus can be misranked.

### 14. Preserve conditional support-card unique effects

Current implementation: `scripts/fetch-gametora.mjs:160-166` and `src/model/stats.ts:9-46`.

The normalizer stores compound unique types such as `u101` but discards their payload fields and conditions. The stat model does not interpret them. Forty released cards use a compound unique type of 100 or more. Twenty have no well-tested observed row, so the fallback model loses the effect entirely. Observed rows hide the issue only at the exact observed limit break. `observed+model` limit-break shifts still use the wrong delta.

Preserve the complete unique-effect record during normalization. Implement conditions that can be evaluated for this mode. Mark unevaluable conditions as explicit estimates instead of adding the type number as if it were a normal passive.

Basic unique Friendship Bonus is also multiplicative with normal Friendship Bonus. The fallback model currently folds both into one additive value.

### 15. Use exact trainee star tables

Current implementation: `scripts/fetch-gametora.mjs:334-345` and `src/model/trainee.ts:3-18`.

The raw GameTora data includes `three_star_stats`, but the normalizer drops it. All 17 released base one-star or two-star trainees with an exact three-star table differ from the interpolation, by as much as four points per stat.

Concrete browser case:

```text
Gold Ship [Red Strife], 3 stars
tool:   90 / 105 / 109 / 84 / 77
source: 87 / 101 / 105 / 81 / 76
```

Add explicit two-star and three-star fields where the feed provides them. Interpolate only when the source truly lacks a table. Add at least Gold Ship as a fixture.

### 16. Make deck selection honor focus and search beyond greedy choices

Current implementation: `src/model/deck.ts:83-113` and `src/model/deck.ts:143-257`.

Card `statPower` is an unweighted sum. The selected Balanced, Stamina, or Sprint focus is applied only after the deck is chosen. With no target skills, all three focus settings produced the same deck during the audit.

The greedy search is also not globally optimal under its own spark model. A five-target test found:

```text
greedy expected sparks: 0.961502
better valid combination: 0.975793
```

The better combination replaced Marvelous Sunday [A Marvelous Plan] with Yaeno Muteki [Fiery Discipline] while retaining the other five cards. This is a counterexample, not proof of the global optimum.

Pass focus-aware stat/rank value into deck comparison. Then use exhaustive search over valid six-card combinations, branch-and-bound, beam search with a documented error bound, or local improvement after the greedy seed. A one-swap improvement pass would catch the demonstrated case.

### 17. Keep the empirical stat model labeled as empirical

`data/stat-model.json` fits 271 Loopacord observations with RMSE 4.64 and R-squared 0.944. It is useful, but it is not the game formula.

Known limits:

- Race scaling comes from only a 23-race versus 28-race comparison and extrapolates elsewhere.
- Event stats and SP use the same two race counts.
- Focus multipliers came from two decks.
- Standard deviations are fixed by stat rather than deck, trainee, focus, inheritance, or race count.
- The normal-career hint rate, Independent Training hint scale, card facility share, random-event rate, group-event rates, unknown condition rate, and loss penalty contain explicit assumptions.

Keep these in Advanced settings or an audit panel. Do not describe P(SS) as an exact probability.

### 18. Either implement spark-star output or remove inert controls

`ssStarOdds` and `belowSsStarOdds` are editable but unused. The new guide supplies a four-band table at `docs/refs/crazyfellow-parenting-gene-guide.txt:2432-2460` and `:3589-3635`:

| Final rating | 1 star | 2 stars | 3 stars |
|---|---:|---:|---:|
| Below B, under 6500 | 90% | 10% | 0% |
| B through S+, 6500 to 17499 | 50% | 45% | 5% |
| SS through UF, 17500 to 28799 | 20% | 70% | 10% |
| UE or higher, 28800+ | 17.5% | 70% | 12.5% |

The current below-SS default reverses the 1-star and 2-star values and omits the below-B and UE bands. Either calculate and display expected star quality with all four bands, or remove the controls until an output consumes them.

The blue-spark thresholds of 600 and 1100 are supported. Roughly, a selected stat below 600 cannot generate a three-star blue spark; 600 to 1099 has about a 5% three-star rate; 1100 or higher has about a 10% rate. The stat itself is selected uniformly from the five stats first.

## Secondary limitations to retain or document

### Aptitude changes during the run

The Legacy panel says to copy the pre-run aptitude screen, but lets the user select S. The new guide says S can only be reached at an inspiration event. More importantly, later pink-spark procs can change aptitude for later races, while the schedule uses one fixed aptitude for the entire run.

The current project has no per-ancestor pink-spark input, so exact modeling is out of scope without a state-model change. For now:

- Do not imply that a pre-run S value is mechanically possible.
- Label the schedule as using fixed start-of-run aptitudes.
- Record later pink-spark modeling as a known omission.

### Scenario selection

`scenarioId` accepts 1 through 99, but the stat fit, focus multipliers, scenario event assumptions, and base caps are specific to Our Grand Concert. Do not allow an arbitrary scenario ID to create a hybrid model. Restrict the control to supported scenarios or require a full scenario model for each option.

### Legacy-screen input feasibility

Each side can independently enter `+63` for all five stats, although one Legacy side contains only three trainees and each has one blue spark. The UI is intended for copying a real game screen, so this is a low-priority validation issue. If validation is added, reconstruct a feasible allocation of at most three blue sparks per side.

## Mechanics that should remain

The following behavior is supported and should not be removed while addressing the defects:

- Independent Training ignores stats, skills, mood, and Style aptitude when determining optional-race win odds.
- S and A have the same race-win contribution.
- Distance categories end at 1400 for Sprint, 1800 for Mile, and 2400 for Medium.
- A named G1 contributes affinity only once even if won in two years.
- The current Global affinity system counts G1 overlap only. The new guide says Global received this update on 2026-06-24 at `docs/refs/crazyfellow-parenting-gene-guide.txt:187-219`.
- There are two normal inspiration events, Classic early April and Senior early April. Official source: https://umamusume.jp/steam-news/detail?id=3078
- Six-card decks, one friend slot, one card per character, two Legacies, two sub-Legacies per Legacy, and at most three stars per spark.
- The basic per-spark affinity multiplier and 70/80/90 blue proc bases.
- Skill-white generation bases of 20% for ordinary, 25% for ◎, and 40% for gold.
- The best-supported lineage generation model is `base × 1.1^N`, where N is the number of matching lineage sparks. The new guide supports this with a 26.5-million-trainee dataset and a later independent replication at `docs/refs/crazyfellow-parenting-gene-guide.txt:2366-2405`.
- The Our Grand Concert linked Senior November event requires at least 16 songs. Character or card presence upgrades the corresponding option to gold.
- Independent Training does not purchase skills during the run. The player chooses at completion.

## Unresolved mechanics

Do not convert these into undocumented constants:

- The exact probability distribution within the 1 to 10, 1 to 16, and 1 to 28 blue inspiration ranges.
- How Independent Training resolves an event when several options contain different prioritized skills.
- Whether prioritized skills influence support-card `!` selection in Independent Training at all, and any resulting acquisition-rate change.
- Exact Independent Training Race Bonus scaling.
- Most random character-event, outing, Pal, and Group event occurrence rates.
- Conditions and probabilities for many split event outcomes.
- Green-spark stat-cap increase amounts.
- Whether the empirical run-stat model generalizes outside the observed decks and 23 to 28 race range.

Gold-colored inspiration should not receive an extra proc multiplier. The new guide's best evidence says it is an indicator that a high-star spark proc occurred, not a separate bonus mechanic. The project does not currently add such a multiplier, which is correct.

## End-to-end evidence

Manual browser cases covered:

- Fresh state with no trainee
- Gold Ship selection and three-star base stats
- Scenario-only completion skill target
- Gold/white split outcome target
- Duplicate skill rewards inside one event
- Multiple targets and prioritized entries
- Unowned-card and friend-card behavior
- Same-character trainee/card exclusion
- Maximum Legacy blue gain in one stat
- Race agenda thresholds and forced goals
- Total-turn boundary at 28

Observed failures:

- I Wanna Win with You / On the Way to Our Dream showed no source.
- Gold Ship displayed interpolated rather than exact three-star stats.
- A Legacy `+63` Speed entry displayed a fixed `+126 later`.
- El Condor Pasa's one chain-three event displayed 24% for a configured 12% chain rate.
- Total turns 28 locked the page.
- A three-race A/A streak displayed 90%; corrected data keeps it at 100%.

Repository verification at the audited commit:

- `npx tsc --noEmit`: passed.
- `npm test`: all five test files passed.
- `npm run inspect`: passed.
- `npm run smoke`: passed with 245 card rows, light and dark desktop layouts, and no reported browser errors.

The green test suite does not establish mechanics correctness. Several tests assert the stale race penalties, fixed blue inspiration gains, and loose rating anchors.

## Recommended implementation order

1. Correct race odds, rating tables, total-turn validation, exact trainee star tables, and the missing scenario completion skill.
2. Replace the flattened event-source calculation with correlated event outcomes, then enforce the real top-ten boundary.
3. Separate start gains from inspiration distributions and move affinity to individual lineage positions.
4. Apply scenario caps and known cap increases.
5. Fit Race Bonus from Independent Training observations. Test support-hint prioritization separately and change it only if mode-specific data supports the behavior.
6. Preserve conditional support unique effects and make deck ranking focus-aware.
7. Add a local-improvement or exhaustive deck search.
8. Add the planned undiscounted worst-case target SP-cost display and warning.
9. Implement four-band spark-star output or remove the inert settings.

After each group, run `npx tsc --noEmit`, `npm test`, and `npm run smoke` against the development server on port 5173. Use exact mechanics fixtures rather than tests that merely preserve the old output.
