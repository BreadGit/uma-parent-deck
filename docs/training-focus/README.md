# Training focus study

This folder preserves the September 18, 2026 experiment comparing Balanced, Stamina and
Sprint in suggested deck search. The decision was to remove the application prototype
and keep focus as a manual choice. No automatic focus selection or search optimization
from this experiment is enabled in the app. Stamina remains the existing default.

## Why Sprint is the recommended default for this sample

Sprint is the best-supported single default for protecting the **Parent goal estimate**
across the tested inputs, particularly when using the parent goal templates. Here, a safe
default means avoiding large decreases in that estimate across varied users. It does not
mean maximizing Stamina, SS chance, preferred sparks or the number of focus-selection wins.
This conclusion replaces the earlier suggestion to keep Stamina for sparse inputs. The
application default has not been changed.

For this comparison, each focus uses its own searched deck. The reference is the highest
Parent goal estimate among the three full-budget search results for the same case. Relative
loss is `1 - focus estimate / best estimate`; percentage-point loss is
`100 * (best estimate - focus estimate)`. The calculation uses the recorded `probability`
field directly, without the preferred-goal tie-break or achievable-subset fallback score.
"Within 2%" means retaining at least 98% of the best estimate, not a two-percentage-point
window. These are comparisons of bounded search results, not proven optimal decks.

### Parent goal templates

There were 115 full-budget cases using unmodified parent goal templates. In 97, at least
one focus had a positive Parent goal estimate. The other 18 were zero under all three
focuses and are excluded from relative-loss comparisons.

| Result across the 97 positive template cases | Balanced | Stamina | Sprint |
| --- | ---: | ---: | ---: |
| Estimate within 2% of the best | 38/97 | 54/97 | 79/97 |
| Estimate more than 10% below the best | 19/97 | 18/97 | 0/97 |
| Largest relative loss | 43.5% | 47.1% | 8.6% |
| Largest percentage-point loss | 2.09 | 1.28 | 0.55 |
| Positive reference estimate reduced to zero | 0 | 0 | 0 |

Sprint's worst relative result was case 200, a Mixed inventory with empty legacy and the
Pace Chaser Decent template: approximately **0.279% with Stamina versus 0.255% with Sprint**.
Its largest percentage-point loss occurred in case 150, a Budget inventory with mixed
3-star legacy and the Pace Chaser Lite template: **10.90% versus 10.35%**. These are
different cases because relative and absolute losses answer different questions.

Sprint had the smallest worst-case relative loss in every template tier:

| Tier | Positive full-budget cases | Balanced maximum loss | Stamina maximum loss | Sprint maximum loss |
| --- | ---: | ---: | ---: | ---: |
| Lite | 39 | 16.4% | 11.5% | 7.2% |
| Decent | 33 | 10.0% | 13.8% | 8.6% |
| Godly | 25 | 43.5% | 47.1% | 4.3% |

Stamina was within 2% of best more often for Decent templates, in 27/33 cases versus
Sprint's 21/33. Sprint still had the smaller maximum loss there. The recommendation is
about limiting downside across templates, not winning every subgroup.

The broader budget-24 sweep gives supporting evidence. Of 480 template cases, 420 had a
positive estimate and 60 were zero for every focus. Sprint's largest relative loss was
14.4%, versus 74.4% for Stamina and 75.4% for Balanced. Stamina lost more than half the
best estimate in four cases, Balanced in six and Sprint in none. These shorter searches
are a separate comparison; their results should not be pooled with full-budget searches.

### All tested goals and the main exception

Including the single-blue and 3-star-white variations gives 139 full-budget cases, of
which 121 had a positive estimate. Sprint was within 2% of best in 97/121 cases, compared
with Stamina's 64/121 and Balanced's 43/121. It lost more than 10% in only two cases,
compared with 27 for Stamina and 30 for Balanced.

Both of Sprint's losses above 10% were **Stamina-only blue goals**. Its maximum relative
loss across all goals was 39.2%, compared with 47.1% for Stamina and 43.5% for Balanced.
No focus reduced a positive reference estimate to zero in the full-budget sample.
Stamina remains a useful manual choice for Stamina blue goals; Sprint's stronger safety
result for templates should not be generalized to every custom goal.

### Why this happens in the model, and what remains untested

The fitted Sprint multipliers increase Speed, Power, Guts and Wit contributions while
reducing Stamina. Those changes can improve accepted non-Stamina blue spark chances and
the rank-dependent chances of higher-star white sparks. The Godly template results are
consistent with that mechanism. Case 40 below illustrates a higher SS chance translating
into a higher Parent goal estimate. SS chance itself is not the decision metric.

Blue legacy gains can also reduce the value of training Stamina. However, only the four
legacy configurations listed below were tested. Speed-heavy, Power-heavy, Guts-heavy and
Wit-heavy lineages, mixed blue star levels and partially filled blue lineages were not
covered. The sample also uses synthetic inventories, only eight trainees and focus
multipliers calibrated from one measured deck. Its counts do not estimate how often an
actual user would benefit, and the full-budget sample includes exploratory additions.

**Sprint had the smallest observed downside in
Parent goal estimate across these fixtures, with especially strong evidence among the
parent goal templates.** It is a supported default recommendation for this tested scope,
not a guarantee against catastrophic outcomes for every user or a claim about actual
race survival. The model does not use focus or predicted stats to calculate race win odds.

These figures come from [results.jsonl](data/results.jsonl), with
[paired-completions.jsonl](data/paired-completions.jsonl) replacing records by case ID.
Filter to `spec.cohort === 'templates'` for the template comparisons, use `full` or `quick`
as specified, and retain cases whose maximum recorded `probability` is positive. The same
per-focus probabilities are available as `completeGoalPercent` in
[comparisons.csv](data/comparisons.csv). The older goal-ordering summaries below answer a
different question and should not be treated as default-safety metrics.

## Coverage and method

The sweep has 600 unique cases, each evaluated with all three focuses and a deck-search
budget of 24. It also records the initial greedy preview for each focus.

- 480 template cases use five inventories, four legacy configurations, all 12 parent goal
  templates and two trainees for each template.
- 100 cases replace the blue goal with each individual stat at 3 stars.
- 20 cases raise required white goals to 3 stars.
- 139 cases also have full-budget searches and cross-evaluation of each selected deck
  under the other two focuses. These include 120 stratified cases, 14 exploratory cases
  and five matched changes to blue legacy stats.
- Separate fixed-deck checks cover 100 single-blue configurations and 100 matched pink
  goal configurations, each under all three focuses.

The inventories contain 31, 135, 166, 166 and 248 owned cards. Starter uses 30 deterministic
R/SR choices plus Light Hello. Budget has every R/SR at LB4 plus Light Hello at LB0. Mixed
adds a deterministic SSR subset at LB0 to LB2. Upgraded has the same cards as Mixed at
LB4. Complete has all cards at LB4. Every case pins owned Light Hello and permits an MLB
friend borrow. These are synthetic inventories, not data from the user's browser.

The four legacy configurations were:

| Configuration | Six blue lineage slots | White and pink lineage |
| --- | --- | --- |
| Empty | All empty | None |
| Template | Speed twice; Stamina, Power, Guts and Wit once each; all 2-star | Template white defaults; no pink |
| Mixed | Same distribution, all 3-star | Every target white has three copies totaling seven stars per side; pink has two each of Medium, Mile and Long, all 3-star |
| Stamina | Six Stamina sparks, all 3-star | Identical to Mixed |

For both mixed blue distributions, one side is Speed / Stamina / Power and the other is
Speed / Guts / Wit. Each configuration appears in 120 template cases and 150 total cases
in the budget-24 sweep. Mixed versus Stamina isolates the blue distribution; other legacy
comparisons also change white or pink lineage. The eight trainees span front, pace, late
and end running styles. Exact inputs and inventory entries are in [design.json](data/design.json).

Each search uses default settings and the automatic race agenda. Searches start without a
previously displayed deck seed. The discarded UI prototype used the current deck as a
shared seed, so these measurements are not identical to every UI comparison. Full-budget
search remains bounded; its result is a reference, not a proven global optimum.

The existing goal ordering chooses the focus. It first considers achievable requirements,
then required-goal score, with preferred white goals allowed to decide within the default
2% relative tolerance. A selected focus need not have the highest raw complete-goal chance.
The harness independently recomputes the chosen deck's goal score and checks search-result
consistency and deck legality.

## Findings

Among the 121 full-budget cases with a positive complete-goal estimate:

| Focus | Selected by goal ordering | Required-goal score within 2% of best |
| --- | ---: | ---: |
| Balanced | 4 | 43 |
| Stamina | 41 | 64 |
| Sprint | 76 | 97 |

The other 18 full-budget cases had no complete success found. Their fallback scores are
retained in the data but excluded from this table. A zero estimate from bounded search
does not establish that every legal deck is incapable of the goal.

The less selectively expanded, 120-case stratified sample shows these legacy effects:

| Legacy configuration | Balanced selected | Stamina selected | Sprint selected |
| --- | ---: | ---: | ---: |
| Empty | 1 | 17 | 12 |
| Template | 1 | 9 | 20 |
| Mixed | 1 | 12 | 17 |
| Stamina blue lineage | 0 | 2 | 28 |

Each row has 30 cases, including fallback outcomes. Ten empty-legacy and two template-legacy
cases have zero complete-goal estimates. The apparent advantage for Stamina with empty
legacies therefore includes fallback ranking, not only successful complete goals.
Among the 20 empty-legacy cases with positive complete-goal estimates, Stamina won ten,
Sprint nine and Balanced one.

Useful tendencies, with limits:

- A Stamina-only blue goal favors Stamina. It won all four stratified full-search cases
  and 18 of 20 budget-24 cases. For a fixed deck with required white goals at only 1 star,
  Stamina's required-goal score weakly dominated the other focuses in all 20 matched cases.
- A blue goal excluding Stamina favors Sprint when required white quality does not add a
  competing rank target. The corresponding 80 fixed-deck, 1-star-white checks confirmed
  weak dominance. This statement concerns required-goal score; ties and preferred goals
  can still affect selection.
- Strong Stamina blue lineage usually favors Sprint. In the stratified sample Sprint won
  28 of 30 such cases. Five extra full-budget pairs isolated changing mixed blue lineage
  to Stamina blue lineage while holding the other inputs fixed.
- Weak inventory alone does not identify the winner. Starter split 13 Stamina to 12 Sprint
  in the stratified full-search cases. In case 40, a starter deck with template legacy
  favored Sprint even though its predicted Stamina was only 510. Sprint increased SS
  chance from 14.8% to 34.7% and complete-goal chance from about 1.86e-7 to 3.52e-7.
- Pink goal choice alone did not change focus scores for the same deck and lineage in the
  100 matched checks. Absolute goal probability did change. Changing pink lineage can
  change aptitudes and the race agenda, so this does not imply that lineage is irrelevant.
- Balanced occasionally wins, but "above 95% chance of enough Stamina, choose Balanced"
  was unreliable. Screening at 600 Stamina retained a score within 2% of best in 59/121
  positive cases; screening at 1100 retained 64/121. Neither is a useful universal rule.

## Search time

Three sequential full searches take roughly three times one search, but elapsed time is
not inherently fixed at 3x. A fresh-process comparison on case 201 took 23.23 seconds
sequentially and 9.83 seconds concurrently. One search averaged 7.74 seconds, so the
concurrent result was 1.27x that average. Decks, scores, stats and probabilities matched.
Total CPU time rose from 32.15 to 40.93 seconds with concurrency. This was one desktop
measurement, not a browser or phone benchmark.

A warmed purchase-cache experiment on case 240 reduced CPU time by about 6.2% across two
opposite execution orders, with identical decks and scores. The earlier unwarmed result
in `cache-check.json` is superseded by `cache-check-warm.json`. The cache was scoped to
one fixed input snapshot and keyed by ordered cards/LBs, SP budget, purchase priorities,
excluded targets and sample count. It is unsafe to assume those entries remain valid
across arbitrary input changes. The overlap measurement found 17.3% reuse among distinct
deck/sample evaluations across focuses, but stricter purchase keys limited cache hits.
These temporary cache and instrumentation changes were never added to application code.

Replays of search-saving strategies on the 121 positive full-search cases gave:

| Strategy | Total CPU relative to all three searches | Matches or improves reference objective | Within 2% of best required score |
| --- | ---: | ---: | ---: |
| Search Stamina and Sprint, evaluate both decks under every focus | 67.5% | 118/121 | 120/121 |
| Also search Balanced when its evaluated score is within 5% | 85.6% | 121/121 | 121/121 |

These replay results are possibilities for future work, not enabled features. They can
improve on the independent-search reference because a deck found under another focus can
be better than the bounded search's own result. Matching all sampled cases is not a
guarantee for unseen inputs. The second strategy's median cost was actually 100.9% of all
three searches; its aggregate savings came from cases that avoided the third search.

## Limits

Focus multipliers come from one measured deck and remain small-sample estimates. They
change predicted stat means, not the modeled SP budget. See the
[stat model evaluation](../stat-model-evaluation.md) for calibration details. Real runs
could differ from this model's ordering, particularly when race survival matters.

The sample deliberately covers templates, inventory strengths and legacy configurations.
Its counts are descriptive, not population probabilities. Timing depends on hardware,
warmup and competing processes. Bulk-search CPU measurements and the isolated wall-time
benchmark answer different questions.

Some initial greedy previews borrowed a card pinned as owned. They are marked `legal: false`
in the raw data. All searched decks and supplied-deck evaluations passed legality checks.
Policies that screen from those initial previews inherit that limitation. This experiment
did not fix the pre-existing preview behavior.

## Files and reproduction

All 11 original result files are retained unchanged in [data/](data/). The original
`design.json` records the source commit and hashes. Its historical script paths refer to
the original files under `analysis/`; those scripts are now `sweep.mjs` and `summarize.mjs`.
Their imports were adjusted for this location. The scripts use the checked-out model and
data, so later model changes can change regenerated results.
The separate CPU profile and its measured result are preserved in [data/profile/](data/profile/).

| File | Contents |
| --- | --- |
| [results.jsonl](data/results.jsonl) | 600 main cases, including 134 full-budget comparisons |
| [paired-completions.jsonl](data/paired-completions.jsonl) | Five replacement case records with the extra full searches and cross-evaluations |
| [summary.json](data/summary.json) | Merged 600-case analysis, 139 full cases, subgroup counts and strategy comparisons |
| [comparisons.csv](data/comparisons.csv) | 2,217 focus/search rows for spreadsheet inspection |
| [structural-checks.json](data/structural-checks.json) | Fixed-deck blue dominance and matched pink-goal checks |
| [legacy-pairs.jsonl](data/legacy-pairs.jsonl) | Original five additional blue-legacy search results |
| [latency.json](data/latency.json) | Sequential/concurrent fresh-process comparison with exact-output checks |
| [cache-check-warm.json](data/cache-check-warm.json) | Warmed cache experiment, both execution orders |
| [cache-check.json](data/cache-check.json) | Earlier cache experiment, retained for provenance |
| [overlap.json](data/overlap.json) | Deck/sample visit keys and cross-focus reuse counts |

Run commands from the repository root with the project's Node version and dependencies.
Use a fresh temporary directory to preserve the historical measurements:

```sh
# Regenerate the summary and CSV without rerunning searches.
mkdir -p /tmp/uma-focus-summary-check
cp docs/training-focus/data/results.jsonl docs/training-focus/data/paired-completions.jsonl /tmp/uma-focus-summary-check/
node docs/training-focus/summarize.mjs /tmp/uma-focus-summary-check

# Repeat the 600-case sweep. This is CPU-intensive and can take a long time.
node docs/training-focus/sweep.mjs /tmp/uma-focus-rerun 6 600
node docs/training-focus/summarize.mjs /tmp/uma-focus-rerun

# Repeat supplemental checks independently.
node docs/training-focus/structural-checks.mjs /tmp/uma-focus-structural-checks.json
node docs/training-focus/latency.mjs /tmp/uma-focus-latency.json

# Capture another single-focus CPU profile. Inspect it in a JavaScript profiler.
mkdir -p /tmp/uma-focus-profile-rerun
node --cpu-prof --cpu-prof-dir=/tmp/uma-focus-profile-rerun docs/training-focus/sweep.mjs --profile 240
```

The summarizer applies `paired-completions.jsonl` over main records by case ID. A fresh
sweep includes those five full cases directly and does not need that overlay. The archived
cache and overlap measurements require the temporary instrumentation described above;
the sweep itself does not recreate them. No script reads or changes browser state.
