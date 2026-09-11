# Uma parent deck

A local web tool for Umamusume: Pretty Derby (Global) that ranks support cards and builds a
6-card deck for independent-training parent farming, aimed at sparking specific white skills.

## What it does

- Parent goal groups the blue, pink, and white goals. Target white sparks uses compact chips with one shared editor. Select a chip to edit its goal
  and lineage; select it again to close. Remove a target with the × on its chip. Any number of targets,
  including zero, can be Required. Preferred targets are optional 2★+ extras. Required targets have
  individual minimum stars. Separate headers distinguish target goals from existing lineage.
- Parent goal always evaluates your choices. Set acceptable blue stats and a pink aptitude, defaulting to Any
  at 2★ or better. The evaluator combines those with every required white spark and shows estimated attempts for 50%, 75%, and
  95% chance of success. With no required whites, success depends only on blue and pink. Changing
  a target's role or minimum stars changes the deck search. Required-goal chance comes first;
  preferred sparks on successful parents distinguish decks within a tight, adjustable relative
  window. Search runs in the background with a loading state. When a requirement is impossible,
  the result explains it and separately estimates the best remaining goal found.
  Copy starting aptitude grades from the game after selecting both parents. Open Pink sparks
  below the stat gains in Legacy to enter the ancestors you know and include mid-run B-to-A increases.
  Empty rows count as zero sparks for the estimate, with the same blank placeholders as By stars.
  Raising a grade above the trainee's base fills an estimated minimum-star set in that editor.
  Known lineage determines starting grades. Grades outside starting inheritance remain available as
  planning overrides, including below-base grades from older saves. Dimmed choices can reassign
  other sparks when slots are full. Manual edits update starting grades immediately. Partial
  lineage gives an estimate without a missing-entry warning; below-B increases give probability bounds. Buttons in Parent goal open
  the pink editor directly. Clear pink sparks restores base grades and clears pink lineage.

- You pick the white skills you want to spark. Cards that hint the skill or its gold upgrade count.
  If that skill's family has a released ◎ version, you can buy it after ○ without a separate hint. Predictions assume you buy
  the gold form when available (40% spark chance), otherwise ◎ (25%), otherwise white (20%). The run buys
  nothing. The predicted run shows the full worst-case SP cost, including every prerequisite purchase.
- You pick the trainee. Her own support cards are excluded, her innate and awakening skills
  count as already covered, and her growth rates and aptitudes feed the stat and race models. Her own
  events count as sources too: story and choice events at a set rate, outings at another, and secret
  events scored from the agenda (a "win the Derby and the Kikuka Sho" event is worth the product of
  those win chances, and nothing if a required race is not scheduled). Choice-gated ones take part in
  the one-option-per-event rule like card events.
- The G1 schedule uses independent training's own win odds (Shoppo_ura's data): 110% at A/A minus a
  penalty per surface and distance grade and per consecutive race, clamped to 100%, with stats and
  skills playing no part. A career goal the run would end on losing is always won. A win-chance
  threshold you set on the main page and per-race picks complete the agenda.
- Card ranking shows each card's own target spark chances at rank SS, using Required minimum stars
  and 2★+ for Preferred targets. It sorts by the sum of Required chances, then Preferred chances,
  then predicted stat contribution at your limit break. These individual chances are not the complete
  parent-goal probability. Each row shows four targets initially. Select "+N more" to expand the rest
  in the row, with a source tooltip for each target, or "Show fewer" to collapse them.
- The deck search compares complete required-goal probabilities, then preferred sparks on successful
  parents within a configurable 0.1% relative window. It shows an initial checked recommendation,
  then screens a broader set of decks in the background and fully evaluates promising alternatives.
  Cards whose stats help the goal can win even without target hints. Pins constrain the five owned
  slots and one borrowed slot, with one card per character. When the full goal has zero probability,
  search favors the largest achievable subset and explains the remaining goal separately.
  Search is exhaustive when the constrained deck pool is small; otherwise its bounded exploration
  and cheaper candidate screening can miss the best deck. Displayed probabilities use the full evaluator.
- The predicted run shows expected stats (clamped to the scenario caps plus the blue sparks' start
  uncaps), chance of ≥600 and ≥1100 per stat (blue spark star bands), chance of SS rank and the
  estimated SP against the worst-case cost of the targets, and a 10-skill priority list for independent
  training. Required targets come first, followed by other skills with event choices. Only those ten entries
  steer event choices. Custom ordering applies within those groups, and the list can be exported.
- Every card counts as owned at a default limit break (4 for every rarity, editable) until you
  change it in the card table: pick an LB or "not owned". Adjustments live in localStorage and
  export to `inventory.json` (every card listed, `null` = not owned). Drop that file in the
  repo root to make it the default.
  Invalid inventory imports leave the current inventory intact. If fewer than five usable owned cards and
  one borrowed card fit the deck, the page explains what is missing and hides the run predictions.
- Legacy: a copy of the game's pre-run screen. Above each stat you pick the "+XX" each
  parent side adds at the start, as the game shows it; the 20 possible values each decode to one
  set of sparks (a 3★ gives +21, 2★ +12, 1★ +5 at the start). "By stars" opens a second way in:
  the blue spark (stat and stars) of each parent and her two grandparents, as a database such as
  uma.moe lists them. Both edit the same sparks, and a fresh side starts as 1★ Speed, Stamina and Power. Each spark then procs at the two
  inspiration events (70/80/90% by stars, times 1 + affinity/100 of the uma carrying it) for a
  random roll of 1 to 10, 1 to 16 or 1 to 28; the tool uses an assumed mean per star, set in the
  advanced settings, because the distribution is unmeasured. The affinity is one advanced setting,
  the individual score assumed for every uma in the lineage (150 by default, so every blue spark
  procs); the game only shows the six scores' sum as ◎/○/△, so per-uma entry is not offered. The
  aptitude overrides sit under the stats like the game's table; S is not offered because only an
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

```
npm install
npm run dev        # http://localhost:5173, also reachable on the LAN at http://<this machine's IP>:5173
npm test           # model tests (node --test)
npm run smoke      # headless Chromium walk-through against the dev server, writes docs/screenshot.png
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
Browser checks accept `URL` for another server, including `npm run preview`. Set `SCREENSHOT_PATH` to choose
where the smoke screenshot goes, or to an empty string to skip writing it.

## Data

`npm run fetch` runs `scripts/fetch-gametora.mjs` and `scripts/fetch-event-names.mjs` (`--offline` on the first re-normalizes without any request). The first reads GameTora's static JSON feed
(manifest at `/data/manifests/umamusume.json`), normalizes it into `data/*.json`, and
downloads card, character and skill thumbnails into `public/assets/`. It makes one request
at a time about a second apart, with a plain browser user agent and no identifying headers,
and only re-downloads files whose manifest hash changed. Run it when a new card lands.

- `data/cards.json`: Global support cards with effects at every level and per limit break,
  hint skills, event skills, chain events and random events with rewards decoded. Event names
  come from the per-card page JSON (the static feed scrambles them), fetched once per card. A
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
- `data/stat-model.json`: fitted independent-training stat model, produced by
  `npm run fit` (`analysis/fit_stat_model.py`, needs numpy, scipy, openpyxl).

## Stat model

Independent training card stats are close to deterministic per card and limit break. The
fit uses the Loopacord "Independent Training Research" sheet (`docs/umamusume/`), 169 card-LB rows at
28 G1 races in Our Grand Concert with Light Hello SSR in the deck:

- Outside its own facility a card adds a floor of about 23 to every stat plus its
  Initial Stat passive, one for one.
- On its facility (and the facility's secondary stat: Speed->Power, Stamina->Guts,
  Power->Stamina, Guts->Speed+Power, Wit->Speed) it adds a constant plus about 0.6 per
  point of Friendship Bonus, 0.7 per point of Training Effectiveness, 0.1 per point of
  Mood Effect and 11 per point of Stat Bonus. Specialty Priority does not show up.
  RMSE 3.2 stat points, R² 0.97.
- A conditional unique effect is evaluated at run time from its payload (`uniqueExtras()` in
  `src/model/stats.ts`), not baked into the data. Ramping conditions (bond, friendship count, total
  bond, facility level) count for a share of the run that the fit chooses on the same rows as the
  slopes and writes to the model (`uniqueRampShare`, 0.70). Narita Top Road's per-fan effect follows
  the agenda's expected fan curve. The two deck-dependent ones (Agnes Digital's card types, Symboli
  Rudolf's initial stats per card) are counted from the cards around them, in the deck builder as
  well as in the prediction. The fit writes what it added per card to
  `data/unique-extras-fixture.json` and the data test checks the app reproduces it. See
  `docs/umamusume/refs/gametora-unique-effects.md`.
- Every card stat scales by (T - races) / (T - 28) with T ≈ 72 turns, from the same decks
  run at 28 and 23 races.
- Event stats (which include race rewards) are deck independent: about 640/243/398/337/457
  at 28 races, with a small growth-rate effect (k ≈ 0.3 of the growth %).
- Where a card has 10+ observed runs at your LB the observed numbers are used directly;
  at another LB the observation is shifted by the model's delta.

Pal and Group cards (type "pal" and "group" in the data) get their outings (five dates, or member outings plus a finale) from the
per-card page data, since the static feed does not carry them. In independent training the
Pal date chain completes almost every run (97% default, matching Loopacord and observed
runs), Group member outings default to 90% and the Group finale to 85% (unverified), and the
unlock and New Year events never fire (0%).

Our Grand Concert's Senior November event offers one option per linked character (Smart
Falcon, Mihono Bourbon, Silence Suzuka, Agnes Tachyon) plus an unaffiliated one. Picking a linked
option while training that character or carrying one of her cards hints the gold skill (for
example Concentration instead of Focus). The tool treats every option as a choice-gated source
that fires at the scenario pick rate (100% by default, per Loopacord), so a card of the linked
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

Skill rating applies the [UmaTools aptitude multipliers](docs/umamusume/refs/umatools-rating-tables.md)
to base scores of 217 (white), 262 (◎), and 508 (gold), using GameTora's skill tags. It does not
copy UmaTools' per-skill bucket scores or include negative skills. The trainee's potential level
is assumed maxed, so all awakening skills are available.

### Conditional unique effects

The independent-training stat model (`data/stat-model.json`, `src/model/stats.ts`) is a fit on passives. The
normalizer keeps the compound payload in `unique` (with `fromLb`, the first limit break that unlocks the effect) and
folds nothing; `uniqueExtras()` in `src/model/stats.ts` adds the passives below at run time, and `unique_extras()` in
`analysis/fit_stat_model.py` does the same sums for the fit. The fit writes its result per card and limit break to
`data/unique-extras-fixture.json`, and `tests/data.test.ts` checks that the app reproduces it.

| Type | Added as | Assumption |
|---:|---|---|
| 101 | effect value_1 +value_2 × share, effect value_3 +value_4 × share | bond `value` reached for a share of the run |
| 104 | Training Effectiveness +value_1 × (run average of min(cap, fans / value) / cap) from the agenda's expected fans before each slot; +value_1 × share when there is no agenda (the fit) | fans from the agenda's wins only |
| 106 | Friendship Bonus +value × value_2 × share | the `value` friendship trainings done for a share of the run |
| 109 | Training Effectiveness +(600 / value_1) × share | 600 total bond reached for a share of the run |
| 111 | Training Effectiveness +value_1 × 5 × share | facility level 5 for a share of the run |
| 103 | Training Effectiveness +value_1 with `value` card types in the deck | exact, given the deck |
| 105 | initial stat per card of that type, value_1 per Pal or Group card | exact, given the deck |
| 102, 107, 108, 110, 112, 113, 114 | nothing | turn-by-turn state (facility, energy, crowding) |

The share is `uniqueRampShare` in `data/stat-model.json`, fitted: `npm run fit` refits the card model at every share
from 0 to 1 in steps of 0.05 and keeps the one with the lowest card RMSE (0.70; RMSE 4.64 at 0, 3.93 at 0.25, 3.35 at
0.5, 3.19 at 0.75, 3.52 at 1.0). It is fitted on the same 271 rows the slopes are, not measured from bond or facility
logs. The deck builder evaluates the extras against the cards already in the run state, so a card that needs the deck
is valued the same way in selection and in the prediction. Extras only reach model-based contributions: an observed
row already contains the effect at the deck it was logged with, and an LB shift cancels it.

## Known gaps

The [curated game reference index](docs/umamusume/refs/README.md) records source scope and conflicting evidence.

- Complete-goal estimates preserve shared skill outcomes and final-rank dependence. Blue bands use
  analytic probabilities; rank integration and large linked skill groups use fixed samples. Rare
  joint outcomes can be missed. Skill acquisition is independent of sampled stats and rank, and
  assumed skill purchases have no SP budget constraint.
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
  multipliers from two decks, fixed per-stat spreads, and event stats at the reference decks' Race
  Bonus (the deck's total is shown but not modelled). Seven of the fourteen conditional unique-effect types depend on
  turn-by-turn state and are left out; the ranking flags every conditional effect with GameTora's
  description and what the model does with it.
- The agenda uses start-of-run aptitudes for the whole run. The goal evaluator models B-to-A pink
  inspiration increases for final spark eligibility, without changing race odds or skill rating.
  Which option wins when several prioritized skills sit in one event is an assumption
  (list order), not a measured rule.
- Forfeited stat rewards from the event option not taken are not modelled.
- Slot tiebreaks use how many umas can run a race comfortably, not how common it is on parents.
- Career goals come per character, so an alternate outfit shows the base outfit's goals.
- The two Group cards' random events and Team Sirius's sixth chain event are incomplete in the data.
- Exclusivity is enforced per event only; two targets on different events are independent.

## Credits

Data from [GameTora](https://gametora.com). Independent training measurements from the
Loopacord research sheet and [fujikiseki.xyz](https://fujikiseki.xyz/training-data/insights).
Mechanics from the community Global reference documents and uma.guide. Game assets belong
to Cygames; this is a personal tool and the images are not for redistribution.
