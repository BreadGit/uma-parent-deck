# Uma parent deck

A browser-based tool for Umamusume: Pretty Derby (Global) that ranks support cards and builds a
6-card deck for independent-training parent farming, aimed at sparking specific white skills.

## Import using screenshots

The Card inventory panel's "Import using screenshots" button opens the scanner over the planner and applies the
readings to the inventory directly. [The standalone page](scanner.html) runs the same flow and ends in a download.
It reads support-card screenshots locally and exports the planner’s inventory format.
Review uncertain matches and overlapping readings before exporting; the page explains its coverage limits.

`npm run build:scanner` produces an independent static app in `dist-scanner/`.
Serve that directory with any static web server and open `scanner.html`.
The card catalog and artwork come from the existing vendored data; no recognition service is required.
`npm run test:scanner` checks the scanner against cropped examples from both supplied phone formats.

## What it does

- The page is two columns. The left column is the input flow: Inventory first, then the numbered steps
  Trainee, Parent goal, Legacy and Run, then Settings. It scrolls on its own, pinned to the viewport, and "Hide inputs"
  at its top gives the results the full width; the choice is remembered. While it is hidden, a summary line
  above the results names the trainee, the blue and pink goal and the target sparks, so a screenshot still
  says what it estimates. The right column is every result, most useful first: Warnings when there are any,
  Suggested deck, then Parent goal estimate and Predicted run beside Prioritized skills, G1 agenda,
  Prediction details, Card ranking. On a 1080p screen the deck, estimate, skills and run fit together
  without scrolling. Until a trainee is picked the results are dimmed behind a note that says where to
  start. While a better deck is being searched the deck panel says so; the estimates shown already match
  the deck on screen. Reset all in the header clears every choice, including the training focus and win
  threshold, and keeps the inventory and advanced settings. The estimate, run and skill list sit in two
  columns whenever the result column is at least 1000 px wide, from a wide window or from hiding the
  inputs, and stack otherwise; a result column under 1140 px shows one row per stat instead of five boxes.
  Below 1200 px the page is one column. On phones, all Card ranking
  columns scroll sideways so the card names cannot cover the inventory controls or spark chances.
- Warnings gathers everything that limits or changes the results: missing goal inputs, pink sparks worth
  entering, a zero estimate, a search that could not complete every requirement, and choice conflicts,
  where two wanted skills compete for one event option.
  Prediction details is for checking the tool's work: it opens on request, each section leads with its
  numbers (what limits the goal estimate and its per-spark breakdown, where the stats come from, Target
  coverage, how the deck was built), and the method behind each sits in a "How …" disclosure at the end
  of the section.
- Every chance is formatted the same way: one decimal above 1%, more below, so a card's own spark chance
  in Card ranking and the deck's spark chance in Target coverage (inside Prediction details) read alike. Race win chances come in 5%
  steps and stay whole numbers. Pills are neutral; colour is reserved for a real warning such as a
  streak-reduced win chance.
- Long explanations sit behind "How …" disclosures at the end of a panel (Legacy, G1 agenda, Card
  ranking) rather than in tooltips. Confirmations use the page's own dialog. Search boxes take arrow
  keys, Enter and Escape. Each search keeps its own selection, shows suggestions when focused, and scrolls
  the highlighted row into view. A click elsewhere closes searches. Help icons pin their explanation on
  tap without activating the surrounding field or disclosure. Advanced settings show each field's default,
  mark changed values, and explain the accepted range when a value is rejected.

- Parent goal groups the blue, pink, and white goals. Target white sparks lists the Required and Preferred
  targets as two collapsible groups, each with its own search box that adds to that group. Names sit
  inline with their star minimum or priority. Select a name to edit its goal and lineage under that line;
  select it again to close, or close the group. The lineage takes the copies of that spark already in the
  lineage and their star total, or with "Per parent" the stars on each parent and grandparent. Remove a
  target from its editor. Any number of targets,
  including zero, can be Required. Preferred targets are optional extras at any star level. Their
  ranking weights halve with each priority step, starting at priority 0 with weight 1. Required targets have
  individual minimum stars. Separate headers distinguish target goals from existing lineage.
- Parent goal always evaluates your choices. Choose acceptable blue stats and pink aptitudes, with a
  minimum star count for each pink alternative. The evaluator combines those with every required
  white spark and shows estimated attempts for 50%, 75%, and 95% chance of success.
  With no required whites, success depends only on blue and pink. Changing
  a target's role or minimum stars changes the deck search. Required-goal chance comes first;
  preferred sparks on successful parents distinguish decks within a tight, adjustable relative
  window. Search runs in the background with a loading state. When a requirement is impossible,
  the result explains it and separately estimates the best remaining goal found.
  Copy starting aptitude grades from the game after selecting both parents. Open "Pink per parent"
  below the stat gains in Legacy to enter the ancestors you know and include mid-run B-to-A increases.
  Empty rows count as zero sparks for the estimate, with the same blank placeholders as "Blue per parent".
  Raising a grade above the trainee's base fills an estimated minimum-star set in that editor.
  Known lineage determines starting grades. Grades outside starting inheritance remain available as
  planning overrides, including below-base grades from older saves. Dimmed choices can reassign
  other sparks when slots are full. Manual edits update starting grades immediately. Partial
  lineage gives an estimate without a missing-entry warning; below-B increases give probability bounds. Buttons in Parent goal open
  the pink editor directly. Reset beside "Pink per parent" restores base grades and clears pink lineage.

- You pick the white skills you want to spark. Cards that hint the skill or its gold upgrade count.
  If that skill's family has a released ◎ version, you can buy it after ○ without a separate hint.
  Target coverage assumes you buy the best available form: gold, otherwise ◎, otherwise white.
  Spark rates are adjustable in advanced settings. It shows the full worst-case SP cost, including
  every prerequisite purchase.
  Parent goal and Predicted run instead estimate purchases within the predicted SP budget. Required
  base skills come first, then preferred bases and upgrades, then remaining skills by rating per SP.
  Independent training itself buys nothing; these estimates model purchases after the run.
- You pick the trainee. Her own support cards are excluded, her innate and awakening skills
  count as already covered, and her growth rates and aptitudes feed the stat and race models. Her own
  events count as sources too: story and choice events at a set rate, outings at another, and secret
  events scored from the agenda (a "win the Derby and the Kikuka Sho" event is worth the product of
  those win chances, and nothing if a required race is not scheduled). Choice-gated ones take part in
  the one-option-per-event rule like card events.
- The G1 schedule uses independent training's own win odds (Shoppo_ura's data): 110% at A/A minus a
  penalty per surface and distance grade and per consecutive race, clamped to 100%, with stats and
  skills playing no part. A career goal the run would end on losing is always won. A win-chance
  threshold you set in Run and per-race picks complete the agenda. The race grid mirrors the game's
  layout and is collapsed until you open it; the summary line and fan estimate stay visible.
- Card ranking shows each card's own target spark chances at rank SS, using Required minimum stars
  and any star level for Preferred targets. It sorts by the sum of Required chances, then priority-weighted Preferred chances,
  then predicted stat contribution at your limit break. These individual chances are not the complete
  parent-goal probability. Each row shows four targets initially. Select "+N more" to expand the rest
  in the row, with a source tooltip for each target, or "Show fewer" to collapse them.
- The deck search compares complete required-goal probabilities, then preferred sparks on successful
  parents within a configurable relative window. Saved tolerance settings are preserved.
  Preferred scores equal within floating-point roundoff favor the higher required-goal chance.
  It shows an initial checked recommendation, then screens a broader set of decks in the background
  and fully evaluates promising alternatives.
  A final pass screens every legal single-card replacement of the best deck found, plus exchanges
  of the borrowed slot with an owned card, and fully evaluates up to 16 further alternatives.
  Cards whose stats help the goal can win even without target hints. Pins constrain the five owned
  slots and one borrowed slot, with one card per character. When the full goal has zero probability,
  search favors the largest achievable subset and explains the remaining goal separately.
  Search is exhaustive when the constrained deck pool is small; otherwise its bounded exploration
  and cheaper candidate screening can miss the best deck. Displayed probabilities use the full evaluator.
- The predicted run shows expected stats (converted above 1,200 and clamped to the scenario caps plus the blue sparks' start
  uncaps), chance of ≥600 and ≥1100 per stat (blue spark star bands), chance of SS rank and the
  estimated SP and skill rating assuming all that SP is spent at the obtainable skill pool's estimated
  rating per SP. Target coverage compares SP with the worst-case target cost. Prioritized skills shows up to ten entries for independent training, derived
  from the parent goal: required targets first, then preferred targets by priority, then extras the deck's
  events offer. Only those ten entries steer event choices. Target rows follow the goal editor; the extras
  can be reordered, hidden and swapped, which re-evaluates the deck shown without a new search.
- Every card counts as owned at the configured default limit break until you
  change it in the card table: pick an LB or "not owned". Adjustments live in localStorage and
  export to `inventory.json` (every card listed, `null` = not owned). Drop that file in the
  repo root to make it the default.
  Invalid inventory imports leave the current inventory intact. If fewer than five usable owned cards and
  one borrowed card fit the deck, the page explains what is missing and hides the run predictions.
- Legacy: a copy of the game's pre-run screen. Above each stat you pick the "+XX" each
  parent side adds at the start, as the game shows it; the 20 possible values each decode to one
  set of sparks (a 3★ gives +21, 2★ +12, 1★ +5 at the start). "Blue per parent" opens a second way in:
  the blue spark (stat and stars) of each parent and her two grandparents, as a database such as
  uma.moe lists them. Both edit the same sparks, and a fresh side starts as 1★ Speed, Stamina and Power. Each spark then procs at the two
  inspiration events (70/80/90% by stars, times 1 + affinity/100 of the uma carrying it) for a
  random roll of 1 to 10, 1 to 16 or 1 to 28; the tool uses an assumed mean per star, set in the
  advanced settings, because the distribution is unmeasured. The affinity is one advanced setting,
  the individual score assumed for every uma in the lineage; the game only shows the six scores' sum
  as ◎/○/△, so per-uma entry is not offered. The aptitude overrides sit under the stats like the
  game's table; S is not offered because only an
  inspiration event reaches it.
  Each parent side has three blue sparks total across all stats, one per uma. A "+XX" that needs more umas
  than its stat already has takes them from the other stats, fewest stars first, so those drop. A saved side
  the screen could not show is replaced by the default side rather than warned about.

Game information lives in [docs/umamusume/](docs/umamusume/README.md). That directory is for game
information only, including guides, mechanics, and reference datasets. Project documentation stays
outside it. See the [game glossary](docs/umamusume/GLOSSARY.md) and [tool glossary](docs/GLOSSARY.md)
for terminology. Game constants live in
`src/model/rules.ts`, tunable estimates in `src/settings.ts`.

## Code layout

- `src/model/`: the game and tool logic, with no DOM. `run.ts` turns the user's choices into the plan
  the page shows (schedule, deck, prediction, rank estimate, prioritized skills); `sparks.ts` finds skill
  sources and resolves event conflicts; `deck.ts` scores cards and supplies the initial deck;
  `goal-deck.ts` searches complete decks using `goal-objective.ts`; `goal.ts` evaluates parent goals,
  with shared skill outcomes in `goal-skills.ts`; `stats.ts`,
  `races.ts`, `rank.ts`, `inherit.ts` and `trainee.ts` are the individual models.
- `src/state.ts`: the persisted state and its migration from older saves.
- `src/ui/`: lit-html templates, one module per panel. `plan-worker.ts` runs deck search off the main thread.
- `tests/`: model rules, the run pipeline, state migration, and data-shape checks; `smoke.mjs` drives
  the page in a browser.

## Running

Use the versions in [.node-version](.node-version) and [.python-version](.python-version).
Install the analysis dependencies with `python3 -m pip install -r analysis/requirements.txt`.

```
npm ci
npm run dev        # http://localhost:5173, also reachable on the LAN at http://<this machine's IP>:5173
npm test           # includes Python analysis checks; missing dependencies fail in CI and skip locally
npm run test:quick # the same without the Python analysis checks, for the inner loop
npm run smoke      # headless Chromium walk-through against the dev server, writes docs/screenshot.png
npm run scratch -- /tmp/probe.mjs   # one-off browser script with the test helpers; also --eval '<expr>' or --shot <png>
npm run test:e2e   # smoke, browser regressions, and scroll-anchor checks
npm run build
```

Browser regression cases use `editor()` for inputs, migration, and immediate estimates with search
held pending, or `fresh()` for real optimizer integration. `assertFieldsMatchState()` checks the
current fields immediately. Use `waitForPlan()` explicitly for assertions about completed search;
it rejects search failures and held workers. Smoke holds search during editor checks, then releases
the latest request to a real worker before checking the completed result at all six layout widths.
Keep search-quality and publication assertions in the real-worker cases.

`npm run dev` binds to all interfaces (`vite --host`). Vite prints the network URL on start.
Browser checks accept `URL` for another server, including `npm run preview`. Against a dev server they
also check that it serves this checkout and stop when it serves another worktree. Set `SCREENSHOT_PATH`
to choose where the smoke screenshot goes, or to an empty string to skip writing it.

### Sharing a run

The address bar follows panels 1–4, the arrangement of the extra prioritized skills, and manual G1 schedule
picks and skips after a short pause in editing. Copy the URL from the address bar to share or
bookmark those choices.
Opening a link with `?run=<code>` loads it before rendering the app. To load a raw code,
put it in the URL as the `run` parameter.

Loading keeps this device's inventory, advanced settings and theme. New links replace the schedule
overrides too; older format 1 and 2 links keep this device's agenda picks. The code contains
the choices themselves and needs no server-side storage. Different inventories, settings and game
data can produce different recommendations from the same code. Unavailable IDs remain saved and
appear in a notice; calculations use only the available choices. Reset all removes the URL parameter.

Share formats have fixed defaults and stable game IDs, independent of weekly data updates and
saved-state versions. The original prototype codes remain readable. See [Sharing](docs/sharing.md)
for the format contract and compatibility checks.

## Deployment

[CI](.github/workflows/ci.yml) validates pull requests and deploys the tested build from `main`
to Cloudflare Workers Static Assets. [wrangler.jsonc](wrangler.jsonc) owns the site configuration.
The site needs no application server; screenshots and saved choices stay in the browser.
GitHub Actions needs the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
Scope the token's **Edit Cloudflare Workers** permissions to the hosting account.

[Update game data](.github/workflows/update-data.yml) opens a reviewable pull request for changed
snapshots; merging it publishes through the same CI checks. Enable **Allow GitHub Actions to create
and approve pull requests** in the repository's Actions settings. A failed refresh leaves the
published snapshot intact. Its manual **Run workflow** button forces a check.

Add confirmed Global releases to [release-calendar.json](docs/umamusume/release-calendar.json)
as `{"at":"2026-10-06T10:00:00Z","source":"https://example.com/official-announcement"}`
entries in `releases`, using the actual announced time and source URL. Prefer official monthly
announcements; [uma.moe](https://uma.moe/timeline) is an estimate, not a confirmed calendar.
Run `node scripts/refresh-data.mjs --help` for the scheduling and change-detection policy.
No automatic announcement parser is configured.
GitHub can [disable scheduled workflows after 60 days without repository activity](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/disabling-and-enabling-a-workflow);
re-enable the update workflow in Actions if the repository has been idle.

## Data

`npm run fetch` downloads GameTora's static JSON feed and page data, normalizes the complete
snapshot, refits the stat model, and runs the data checks. Requests are about a second apart,
with a plain browser user agent and no identifying headers. Static files use manifest hashes;
page caches track source changes. Thumbnails go in `public/assets/`. See
[data sources and validation](docs/data-quality.md) for update commands, offline rebuilding,
source checks, and remaining limits.

- `data/cards.json`: Global support cards with effects at every level and per limit break,
  hint skills, event skills, chain events and random events with rewards decoded. Event names
  come from the per-card page JSON (the static feed scrambles them), refreshed when its source inputs change. A
  conditional unique effect (GameTora type 100 and up) keeps its payload and the text GameTora
  renders for it, fetched from the card page (`data/raw/unique-effect-texts.json`); the decoded
  meaning of each type is in `docs/umamusume/refs/gametora-unique-effects.md`.
- `data/skills.json`: all skills with rarity (1 white, 2 gold), SP cost, family links.
- `data/characters.json`: Global character cards with aptitudes, growth, base stats at every listed
  star count, innate and awakening skills, career goals (with the placement each needs and the fans a
  win gives), and her own events (story, choice, outing, secret with conditions) from the per-character
  page JSON plus each outfit's own events from its page (`data/raw/char-events-by-card.json`), on the
  content version Global runs.
- `data/races.json`: the G1 career calendar.
- `data/ranks.json`: rank score thresholds.
- `data/skill-ratings.json`: individually sourced skill evaluation points, imported separately from
  an UmaTools export. See [skill purchases and rating](docs/stat-model-evaluation.md#skill-purchases-and-rating).
- `data/stat-model.json`: fitted independent-training stat model, produced by
  `npm run fit` (`analysis/fit_stat_model.py`, needs numpy and openpyxl).

## Stat model

Independent training card stats are close to deterministic per card and limit break. The
fit uses the Loopacord "Independent Training Research" sheet (`docs/umamusume/`). Its two card
tables contain 178 rows; 120 meet the source's updated and sufficiently tested criteria.
The calibration reference is approximately 28 G1 races in Our Grand Concert. Full deck context
is not recorded for every row. The saved Fujikiseki aggregates mix limit breaks and run
conditions, so they do not qualify as observed references or training examples.

- Outside its own facility a card adds a fitted floor plus its Initial Stat passive.
- On its facility (and the facility's secondary stat: Speed->Power, Stamina->Guts,
  Power->Stamina, Guts->Speed+Power, Wit->Speed) it adds a role constant and fitted
  contributions from Friendship Bonus, Mood Effect, Training Effectiveness, the matching
  stat bonus, and Initial Friendship Gauge.
- `npm run fit` compares additional numeric attributes on held-out cards. Every observation
  and limit break of a card stays together; only training data selects inputs and fit settings.
  Starting bond lowers held-out stat RMSE from 2.613 to 2.511. The broader SP fit applies to
  normal stat-type cards; sparse Pal/Group data keeps the previous SP formula. See
  [model evaluation](docs/stat-model-evaluation.md) for the method, coefficients and limits.
- A conditional unique effect is evaluated at run time from its payload (`uniqueExtras()` in
  `src/model/support-effects.ts`), not baked into the data. Ramping conditions (bond, friendship count, total
  bond, facility level) count for a share of the run that the fit chooses on the same rows as the
  slopes and writes to the model (`uniqueRampShare`, 0.75). Narita Top Road's per-fan effect follows
  the agenda's expected fan curve. The two deck-dependent ones (Agnes Digital's card types, Symboli
  Rudolf's initial stats per card) are counted from the cards around them, in the deck builder as
  well as in the prediction. The fit writes what it added per card to
  `data/unique-extras-fixture.json` and the data test checks the app reproduces it. See
  `docs/umamusume/refs/gametora-unique-effects.md`.
- Every card stat scales by (T - races) / (T - 28) with T ≈ 72 turns, from the same decks
  run at 28 and 23 total races, including the three finales.
- Event stats (which include race rewards) are deck independent: about 640/243/398/337/457
  at 28 races, with a small growth-rate effect (k ≈ 0.3 of the growth %).
- Qualifying observations at the selected LB take precedence. At another LB, the observation
  is shifted by the model's delta. Recorded contributions keep their original deck conditions;
  the app does not reconstruct missing deck context or add guessed bonuses on top.
- Oguri's team-wide starting-bond effect changes the starting-bond input of each formula-based
  recipient while its unique is unlocked. It uses the fitted ordinary-bond relationship, not
  direct measurements of the team effect. Recorded contributions remain the reference values.

The ranking's Basis column distinguishes observed, adjusted and model estimates. Each label's
tooltip gives the reference conditions and the effects the formula leaves out; rules shared by
every card are in the column header tip and the panel notes, so a row never grows. A card
with an effect the model has not evaluated carries a warning tag. The selected deck
summarizes omitted effects, unmeasured team effects and recorded deck conditions. Calculations
and coverage share effect definitions; warnings respect the selected LB. Unfamiliar effects
use their imported description and show as not evaluated.

The importer preserves unknown effect IDs and text-only uniques. It validates support-effect
structures before writing normalized data, including unexpected mechanic-bearing fields.
This catches structural changes that could otherwise drop an effect before the UI sees it.

Pal and Group cards get their outing events from per-card page data, since the static feed
does not carry them. See the advanced settings for current event rates and their source notes
in [src/settings.ts](src/settings.ts). Those notes distinguish Loopacord observations from
unmeasured Group, unlock, and New Year assumptions.

Our Grand Concert's Senior November event offers one option per linked character (Smart
Falcon, Mihono Bourbon, Silence Suzuka, Agnes Tachyon) plus an unaffiliated one. Picking a linked
option while training that character or carrying one of her cards hints the gold skill (for
example Concentration instead of Focus). The tool treats every option as a choice-gated source
that fires at the configured scenario pick rate, so a card of the linked
character is credited with the gold form. Data: `data/scenario-events.json`, decoded from
GameTora's scenario events for every scenario.

Event outcomes are correlated the way the game runs them: one option per event, the outcomes of
that option exclusive (a gold-or-white roll follows the documented stat table at an assumed stat),
a skill written into several conditional branches of one outcome counted once, and a card's chain
stages nested so a skill offered by two stages counts once per run. Outcomes of one option are
assumed equally likely; the game does not publish their odds.

Support chain completion defaults use the Loopacord measurements in
`docs/umamusume/loopacord-independent-training-research.xlsx`, sheet "Chain Finish Rate Data".

Numbers with no measurement behind them (random event rate, Group outing rates, hint acquisition
scaling, the stat assumed for the gold roll, the song count for the scenario's completion skill,
loss penalty) are defaults in the advanced settings panel.

Skill rating uses individually sourced evaluation points from `data/skill-ratings.json` and applies
the [UmaTools aptitude multipliers](docs/umamusume/refs/umatools-rating-tables.md) using GameTora's skill tags.
Skills without a verified rating use the rarity-based fallback in
[src/model/rules.ts](src/model/rules.ts); the prediction discloses those purchases.
Negative skills are excluded. The trainee's potential level is assumed
maxed, so all awakening skills are available, but buying them consumes the same SP budget.

### Conditional unique effects

The independent-training stat model (`data/stat-model.json`, `src/model/stats.ts`) is a fit on passives. The
normalizer keeps the compound payload in `unique` (with `fromLb`, the first limit break that unlocks the effect) and
folds nothing; `uniqueExtras()` in `src/model/support-effects.ts` adds the passives below at run time, and `unique_extras()` in
`analysis/card_effects.py` does the same sums for the fit. The fit writes its result per card and limit break to
`data/unique-extras-fixture.json`, and `tests/data.test.ts` checks that the app reproduces it.

| Type | Added as | Assumption |
|---:|---|---|
| 101 | effect value_1 +value_2 × share, effect value_3 +value_4 × share | bond `value` reached for a share of the run |
| 104 | Training Effectiveness +value_1 × (run average of min(cap, fans / value) / cap) from expected fans before each slot; +value_1 × share when there is no agenda (the fit) | calendar placing rewards with deck Fan Bonus, plus timed concert rewards |
| 106 | Friendship Bonus +value × value_2 × share | the `value` friendship trainings done for a share of the run |
| 109 | Training Effectiveness +(600 / value_1) × share | 600 total bond reached for a share of the run |
| 111 | Training Effectiveness +value_1 × 5 × share | facility level 5 for a share of the run |
| 103 | Training Effectiveness +value_1 with `value` card types in the deck | exact, given the deck |
| 105 | initial stat per card of that type, value_1 per Pal or Group card | exact, given the deck |
| 115 | Initial Friendship Gauge +value_1 on each formula-based recipient | ordinary starting-bond relationship; team effect not directly measured |
| 102, 107, 108, 110, 112, 113, 114 | nothing | not included in the formula |

The share is `uniqueRampShare` in `data/stat-model.json`, fitted: `npm run fit` refits the card model at every share
from 0 to 1 in steps of 0.05. The existing-input fit selects 0.75 for the current data, shared
by the stat and SP formulas. Each validation split repeats that selection using training rows
only. This is a fitted assumption, not a measurement of bond or facility progression. The deck builder evaluates the extras against the cards already in the run state, so a card that needs the deck
is valued the same way in selection and in the prediction. Extras only reach formula-based contributions.
Recorded contributions retain their original deck conditions. LB adjustments use ordinary card inputs
without adding guessed deck bonuses to the recorded reference.

## Known gaps

The [curated game reference index](docs/umamusume/refs/README.md) records source scope and conflicting evidence.

- Complete-goal estimates preserve shared skill outcomes and final-rank dependence. Blue bands use
  analytic probabilities; rank integration and large linked skill groups use fixed samples. Rare
  joint outcomes can be missed. Skill purchases share the predicted SP budget, with required
  skills first and an explicit hint-discount assumption. Purchases are approximated independently
  of sampled stats and rank. See [prediction methods](docs/stat-model-evaluation.md#skill-purchases-and-rating).
- Deck and fallback-subset searches are bounded. Failure to find a complete goal does not establish
  impossibility. Attempt counts assume independent final spark rolls with unchanged odds, including rerolls.
- White-star rates below rank B and at UE or above use approximate community tables outside the
  main Hakuraku sample. Possible separate low-rank generation effects are not quantified.
- Independent-training hint pickup, random event rates, the Group finale rate, the trainee's outing rate
  and the fallback for secret-event conditions the tool cannot score (rival results, streaks, strategy)
  are unmeasured; the defaults are guesses marked as such in the advanced settings. Whether
  prioritized skills change which support hints the run takes is documented for Auto-Train only, so
  hints stay priority-independent.
- GameTora groups a trainee's fixed career events and her random character events together; both get
  one rate. A skill GameTora lists for her events that no decoded event gives uses a placeholder rate.
- The distribution of a blue spark's inspiration roll, the stat at the moment a chain's gold roll
  happens, the odds between the outcomes of one option, and the cap increases from inspiration events
  and green sparks are unknown; each is an explicit assumption or left out.
- The stat model is an empirical fit: race scaling from one 23 versus 28 race comparison, focus
  multipliers from one measured deck, fixed per-stat spreads, and event stats at the reference deck's Race
  Bonus (the deck's total is shown but not modelled). Some support effects are omitted or use
  unverified assumptions; ranking coverage shows each active effect's imported description and
  treatment. Unknown effects are not evaluated. An observed contribution can already contain
  an effect that the formula omits, but cannot reliably adapt it to changed deck conditions.
- The agenda uses start-of-run aptitudes for the whole run. The goal evaluator models B-to-A pink
  inspiration increases for final spark eligibility, without changing race odds or skill rating.
  Which option wins when several prioritized skills sit in one event is an assumption
  (list order), not a measured rule.
- Forfeited stat rewards from the event option not taken are not modelled.
- Slot tiebreaks use how many umas can run a race comfortably, not how common it is on parents.

Fan estimates include calendar wins and estimated loss placings, the selected deck's Fan Bonus,
URA finale rewards, and timed concert rewards. Each candidate deck gets its own fan curve for
stat and unique-skill checks. Finales arrive after the unique-skill fan checks. The fitted stat model
uses the calendar count plus the three finales, matching the recorded runs. The agenda shows the
fan reward breakdown.

Concert rewards use [manual JP measurements](docs/umamusume/refs/fan-rewards.md). The advanced
Scenario settings assume great promotional concerts by default and reuse the 18-song probability
as an approximation for the special final concert. That final also requires two new songs in the last
period. Neither concert outcome rates nor a deck Fan Bonus on concerts is verified for independent
training. Concert rewards receive no deck multiplier. Random race reward increases remain omitted.
Fan thresholds use expected cumulative fans, not the probability distribution around each threshold.

The [two Fuji observations](docs/umamusume/fuji-independent-training-runs.json) are validation cases.
`tests/fans.test.ts` checks their schedule and deterministic payout subtotals separately from the
observed random totals. They are not inputs to the stat-model fit and do not calibrate its uncertainty.
- Career goals come per character, so an alternate outfit shows the base outfit's goals.
- The two Group cards' random events and Team Sirius's sixth chain event are incomplete in the data.
- Unlinked source events are assumed independent. Shared chain stages, event choices, the purchase
  budget and final rank can still couple targets' spark outcomes.

## Credits

Data from [GameTora](https://gametora.com). Independent training measurements from the
Loopacord research sheet and [fujikiseki.xyz](https://fujikiseki.xyz/training-data/insights).
Mechanics are summarized in [Game basics and mechanics](docs/umamusume/GAMEPLAY.md) and the
linked GameTora and community references, including uma.guide. Game assets belong
to Cygames. This is an unofficial fan tool, not affiliated with Cygames.
