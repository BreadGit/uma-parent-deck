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

Growth uses explicit outfit IDs. Oguri maps to 100601, Biwa to 102301, XBiwa to 102302,
Ines Fujin to 103101, and NYOpera to 101502. This keeps ordinary and Christmas Biwa's growth
separate and includes all three NYOpera runs. Unknown labels stop fitting. All 22 runs enter
the growth fit; the current fitted growth factor is 0.31.

The `Race Mode` sheet has total, event and card summaries of the same runs. Only its total
summary determines the overall focus multiplier. For example, Stamina focus uses 1070/1083
for Speed and 543/501 for Stamina; Sprint focus uses 545/519 for Guts. Averaging the ratios
of totals and their component subtotals would count the same measurements more than once.
These remain small-sample calibration estimates, not exact game formulas.
