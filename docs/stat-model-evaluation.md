# Evaluating card model inputs

`npm run fit` fits the card formulas and compares additional support attributes against the
previous formulas. It writes the retained coefficients and evaluation results to
`data/stat-model.json`. It requires Python with NumPy and openpyxl. The evaluation tests run
with `python3 -m unittest discover -s analysis -p test_card_regression.py` and as part of `npm test`,
where they skip with a notice when Python or those packages are missing.

The formulas estimate contributions at the reference 28 races. Existing race-count and focus
scaling applies afterward. This change does not simulate turns or change the race-count scaling.

## Measurement extraction and eligibility

`analysis/measurement_sources.py` reads the original workbook and saved HTML. `npm run fit`
regenerates their CSV/JSON extracts before fitting. Running the extractor without `--write`
checks that the saved extracts still match those sources. `npm test` includes these source
checks, independent cell-value examples, malformed-input cases and fitted-input SHA-256 checks.

The workbook has 172 main-table measurements and six measurements in a second table,
including five Light Hello SSR limit breaks. Three formatted rows contain images and formulas
but no measurements; the audit records them as empty templates. A qualifying observation
must have a source card ID, a known limit break, numeric contributions, a well-tested run
marker of at least 10 runs, and `Updated Stats = Yes`. The header states that older values
were affected by conditions. Twenty-two well-tested rows still have `Updated Stats = No`,
including Light Hello SSR at LB0, so they are not eligible. Sparse rows and Light Hello R's
different reference-deck condition are excluded too. All 178 measurements remain in the CSV
with source coordinates and explicit eligibility reasons. The model contains only the 120
eligible rows. Light Hello SSR at LB2 comes from cells W9:AA9 and AC9, with stats
21/21/21/47/21 and 360 SP. LB0 uses an adjustment from the qualifying LB1 observation.

The saved Fujikiseki table has 136 aggregate cards. Numeric `data-v` fields are medians;
tooltip text provides decimal means, ranges and sample counts. For example, Light Hello's
aggregate SP median is 371 and its mean is 358.5. Marvelous Sunday's SP median is 141 and its
mean is 137.1. Level 50 as a median does not establish that every run used MLB; that row's
level range is 20 to 50. These aggregates also mix race counts and unspecified scenario
conditions. The HTML's 261 limit-break rows, one unknown-limit-break row and 136 detail rows
are empty in the saved file. None supply calibrated per-LB observations. Source card IDs,
all aggregate values and the empty-row scopes are preserved without guessing card identity.

`sourceAudit` records measured/eligible counts, empty templates, source hashes and hashes of
all fitting inputs. A changed card dataset, measurement source or fitting implementation
requires a refit. Unexpected populated rows, missing source IDs, changed headers and newly
populated HTML detail rows fail explicitly instead of disappearing during extraction.

## What the comparison measures

Only qualifying Loopacord observations fit the formulas. The current data has 120 rows for
97 cards, including 91 cards with primary or secondary stat contributions. The source
conditions are Grand Concert, approximately 28 races, and Light Hello SSR in the deck.
Fujikiseki's saved aggregate rows are preserved for inspection but are not eligible as
known-limit-break observations or fitting targets.

Five outer folds hold out complete cards. Every limit break and stat observation for a card
stays in the same fold. Each card is tested once. Inside each outer training fold, four more
card groups select between the existing inputs, each additional input on its own, and the
complete additional input set. Those inner groups also select ridge strength from
0, 0.1, 1, 10, and 100.

The floor, attribute scaling and coefficients use training rows only. The existing stat fit
selects the shared unique ramp share on training rows, from 0 to 1 in steps of 0.05. Each inner
fold repeats that fit; SP uses the same share as stats. Numerical attributes are centered
within card-type roles and scaled using training values. Ridge shrinks the attribute
coefficients, not role intercepts. An attribute constant within a role cannot obtain a
separate coefficient from that role.

Regression rows retain the existing treatment of each observed stat or SP contribution.
Validation averages squared error within each card before averaging across cards, so a card
with more logged limit breaks does not dominate the comparison. Stat validation covers
primary and secondary contributions; off-role observations supply the floor.

A candidate procedure must reduce outer-fold RMSE by at least 2% and improve a majority of
outer folds before replacing the existing formula. After that decision, the same inner
selection procedure fits all qualifying data. The fixed split seed is 2718 for outer folds and
3141 for inner folds. The JSON records card membership, selected inputs, ridge strength,
ramp share and error in every outer fold.

This is evidence about predicting other cards from these datasets. It does not prove each
coefficient is a game rule, validate every support type equally, or measure full-deck accuracy.
Future data offers the next independent check. Do not repeatedly change the candidate sets
to optimize these same outer folds and still call them unseen test data.

## Retained inputs

With the current data, the stat selector retains Initial Friendship Gauge alongside
Friendship Bonus, Mood Effect, Training Effectiveness and the matching stat bonus.
Held-out stat RMSE falls from 2.613 to 2.511 points, a 3.91% reduction. Four of five outer folds
improve. The starting-bond coefficient is about 0.09429 points per bond point for each primary
or secondary contribution. This is a small improvement.

For SP, the selector retains the broader model with Skill Point Bonus and these additional inputs:

- Initial Friendship Gauge and Specialty Priority.
- Event Recovery, Event Effectiveness, Failure Protection and Energy Cost Reduction.
- Wit Friendship Recovery, Hint Levels and Hint Frequency.
- Friendship Bonus, Mood Effect and Training Effectiveness.

Across all cards, exploratory held-out SP RMSE falls from 24.348 to 17.777 points, a 26.99%
reduction. Four of five outer folds improve. The final selection uses no ridge penalty. Deployment uses
that formula only for Speed, Stamina, Power, Guts and Wit supports. Both formulas retain the shared ramp share of
0.75. `effectSlopes` stores the extra stat coefficients; `sp.effectSlopes` stores extra SP
coefficients. The runtime sums each coefficient times its support-effect value and clamps
negative predicted gains to zero.

These attributes correlate with each other. A negative fitted coefficient, such as Event
Effectiveness in the SP equation, is not evidence that improving that attribute harms a run.
The model evaluates the card's combined attributes. Only six qualifying pal/group cards
supply most recovery and event attributes, so new combinations on those types have weak
support. The JSON includes errors by support type so aggregate improvements do not hide
that limitation. Pal-card SP error increases from 57.30 to 70.89 points across only five
held-out cards, despite the overall improvement. The single group card improves from 67.74 to
33.74 points of error; one card cannot establish reliability for that type.

The app therefore keeps the simpler SP formula for pal/group cards, refitted on eligible data. `sp.fittedTypes` lists
the support types that use the expanded formula; `sp.fallback` contains its
coefficients. Pal/group SP does not receive the new starting-bond or recovery terms. This is
a conservative deployment restriction, not a newly validated hybrid model. The published
all-card comparison remains the exploratory selector's result, not a claimed improvement for
this restricted deployment. Eligible exact observations take priority over either formula.

Specialty Priority, Wit Friendship Recovery and hint attributes did not survive the stat
selector, although they did survive the SP selector. The stat regression has no active
pal/group roles, no ordinary-role observations with Event Recovery or Event Effectiveness,
and just one card with Failure Protection or Energy Cost Reduction. Minigame Effectiveness
has no qualifying examples. Those cases are marked `insufficient-data`, not evidence of no
impact. Coverage is recorded separately for stats and SP.

## Deck effects and observed references

A team-wide starting-bond bonus can change each affected card's effective starting-bond input
where that input is used by the formula.
That applies the relationship learned from ordinary starting bond. It is an approximation;
these observations do not directly test Oguri's team-wide unique. The unique must be unlocked
at the selected limit break. Effects do not change directly observed contributions.

The app continues to prefer a qualifying observation at the selected limit break. Otherwise,
it shifts a nearby observation by the model's predicted limit-break difference, or uses the
formula alone. Stored observations lack complete deck context. They may already contain a
unique's benefit. The app keeps those values as references and does not add guessed bonuses
to reconstruct the original deck. More inputs do not change this priority.

The event baseline comes from the workbook's `Race Schedule` sheet, which uses one sample
deck at 23 and 28 races. Those observations can measure a race-count relationship but cannot
separate deck Race Bonus from the deck's baseline. The workbook has no explicit Race Bonus
measurement column. No Race Bonus coefficient is added to stat or SP rewards. Multiplying
the entire event baseline would also multiply non-race rewards. Estimating that relationship
needs comparable event-stat and SP measurements across decks with known Race Bonus values.

## Workbook run calibration

Header-based parsers join 11 runs at each of 23 and 28 races by run number. Each schedule has
six per-card tables. Every run must have matching IDs, complete values, matching sums of the
six card contributions, and a total equal to event plus card gains after the workbook's
above-1200 adjustment. Missing blocks and unmatched run IDs stop fitting.

The 23 and 28 counts include the three finale races. The app adds the scenario finales to
the selected calendar count before calling the fitted stat, SP and hint models. Calendar
placement, fan timing and career goals still use the calendar alone.

Card and event measurements are raw gains. The final-stat calculation adds those gains,
base stats and inheritance before converting a raw total above 1200 to
`floor(1200 + (raw - 1200) / 2)`. Scenario caps apply to the displayed result. This reproduces
18 of the workbook's 22 final stat lines exactly. The remaining four differ by at most one
point per stat. The parser checks that tolerance. Applying this conversion to the gain
subtotal before adding base stats and inheritance would use the wrong threshold.

Run spread uses raw card plus event gains, grouped by schedule and trainee. There are 21
runs in six repeated groups. The variance denominator is 15, after estimating six means,
rather than 21. Blue inspiration adds independent proc variance and an estimated integer
roll variance. The default gain means use uniform rolls over the published ranges. A
user-edited mean scales the roll variance toward zero at either endpoint. That adjustment
is an assumption; the actual roll distribution has not been measured.

The prediction and goal evaluator use the same discrete stat distribution. They round raw
normal outcomes, convert above 1200, then fold tails into zero and the scenario cap. Displayed
means and spreads describe those transformed outcomes. Threshold probabilities integrate
them directly. Rank uses the exact stat-rating table for each outcome, with fixed sampling
for its joint distribution. The displayed SS probability comes from that same goal evaluator.
Estimated probabilities above 99.9% display as `>99.9%`, including floating-point tail values
that have rounded to one.

These spreads do not include an independently measured prediction bias or errors from
transferring the reference deck to different conditions. Stat correlations are still omitted.
Adding arbitrary error bars or scaling success rates to a handful of outcomes would not
establish calibration. The reference deck's race rewards also remain inside its event
baseline. Manual-training reward formulas in umasim do not establish how to split those
Independent Training measurements without counting rewards twice.

Growth uses explicit outfit IDs. Oguri maps to 100601, Biwa to 102301, XBiwa to 102302,
Ines Fujin to 103101, and NYOpera to 101502. This keeps ordinary and Christmas Biwa's growth
separate and includes all three NYOpera runs. Unknown labels stop fitting. All 22 runs enter
the growth fit; the current fitted growth factor is 0.31.

The `Race Mode` sheet has total, event and card summaries of the same runs. Only its total
summary determines the overall focus multiplier. For example, Stamina focus uses 1070/1083
for Speed and 543/501 for Stamina; Sprint focus uses 545/519 for Guts. Averaging the ratios
of totals and their component subtotals would count the same measurements more than once.
These remain small-sample calibration estimates, not exact game formulas.

## Skill purchases and rating

`data/skill-ratings.json` contains individually sourced evaluation values for released skills.
The import matches Japanese names and rarity against direct GameWith rows from UmaTools'
full export. It does not use UmaTools' cost-based fallback values. The JSON records the source,
extraction date and extractor revision. After generating a full export with that revision,
run `node scripts/import-skill-ratings.mjs /path/to/gamewith_skills_enriched.json` to rebuild it.
Unmatched purchased skills retain the older rarity estimate and the prediction discloses them.

Rank assumes the entire estimated SP budget is spent. It values optional purchases from obtainable
skills, including unlisted support hints, innate and awakening skills, and automatic rewards.
Each family contributes a spending curve over its available forms, including buying nothing.
Prices include prerequisites; ratings count only the final form and use the trainee's aptitudes.
The upper concave envelope allows inefficient upgrades to be skipped and includes prerequisite
costs when an upgrade is worth buying. Each availability outcome scales the curve's spending
capacity by its probability. The estimator spends on the highest marginal rating per SP first.

Remaining SP uses a reference rate: total rating divided by total cost across released, priced
white skills, excluding ◎ and × forms and adjusted for the trainee's aptitudes. This reference
is independent of the deck. Optional purchases below that rate are skipped, so adding an optional
skill or upgrade cannot lower Rank when other inputs and source probabilities stay the same.
Known skills have finite expected capacity and cannot be bought repeatedly to exhaust the budget.
The prediction explains how much SP uses the reference rate, including when all of it does.
Forms with unknown prices are omitted. The unique skill adds its level-based rating separately.
Hint discounts and Fast Learner are not assumed.

The curves use fractional expected capacities, not realized shopping lists. This approximation
can overestimate feasible spending, especially with rare or mutually exclusive sources and tight
budgets. The reference rate comes from the skill dataset, not measured player purchases; completed
runs with recorded SP and bought skills are needed to calibrate it. Adding reference-rate spending
preserves the full-SP assumption even when modeled skills cannot exhaust the budget.

The full-price cost message is a separate calculation. It takes the union of required targets,
preferred targets and the displayed prioritized list, deduplicated by family. Only forms with a
positive-probability source after resolving event choices contribute. Each family costs the full
price of its highest obtainable form plus prerequisites, without probability weighting or a budget
cap. This calculation reads resolved sources directly, so gold-only families and rare outcomes
omitted by joint sampling still count. Unknown prices make this a lower bound. Unlisted hints
outside those families affect Rank's spending efficiency but do not contribute to this cost.

Both calculations use the same modeled trainee, deck, scenario and lineage sources. Unlisted
choice rewards are not credited, including when every extra is hidden and the list is empty.
Rewards that require no choice survive. Shared event outcomes stay correlated. Contested
required-target orders use the same joint required-goal scorer as deck search, including required
star thresholds and fallback subsets, with no near-tie tolerance.

Small joint source distributions are enumerated exactly. Large ones use deterministic samples,
and the UI notes that rare joint outcomes can be missed. Parent-goal estimates assume the obtainable
target forms are bought, even if their full-price cost exceeds estimated SP. Rank treats that
ownership independently of stat outcomes and spending efficiency. The skill-score spread setting
represents uncertainty in spending efficiency; target-form rating variance is not added to it.

Skill-point variation, unknown sources and correlations between hint pickup and training
remain calibration limits. The old points-per-SP and innate-share settings no longer apply;
state migration preserves other choices and clears cached recommendations.

The deck suggester evaluates these corrections for each candidate, during both screening
and final comparison. Its objective is the chance of completing the selected parent goal.
It integrates blue outcomes jointly with rating-dependent white-star quality, then combines
that with purchased white forms and the selected pink requirement. SS raises the conditional
chance of a white spark having at least two stars from 50% to 80%, and three stars from 5%
to 10%. It does not raise the base chance that a bought skill generates a white spark.
Consequently, a goal accepting any white-star level gives no extra weight to SS.

Pink eligibility depends on the fixed trainee, aptitudes and lineage. That common positive
factor affects the displayed complete-goal probability but cancels when comparing candidate
decks for the same inputs. Preferred extras break near ties after required-goal success.
The card-ranking table remains a separate view of each card's own sources at assumed SS;
its standalone percentages are not the deck search objective.

### Repeatable deck selection

Completed searches depend on current run inputs, settings, inventory and game data. A previous
recommendation can stay visible while a worker runs, but does not seed that worker's search.
Default extra-skill ties use skill IDs; explicit user ordering is preserved. Candidate evaluation
uses a canonical card order so reversing identical deck entries cannot change event choices,
stat accumulation or sampling. Search evaluates its derived skill list; the displayed prediction
uses the user's extra-skill choices, which can change the displayed estimate after selection.

The default search explores up to 384 local candidates and screens a population of up to 3,072,
then checks promising neighbors. Only finalists receive the full evaluation. These limits improve
coverage without promising the global best. Required goals still come first; the configured
relative tolerance allows preferred skills to decide among near-ties.
