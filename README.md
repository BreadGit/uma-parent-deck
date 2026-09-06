# Uma parent deck

A local web tool for Umamusume: Pretty Derby (Global) that ranks support cards and builds a
6-card deck for independent-training parent farming, aimed at sparking specific white skills.

## What it does

- You pick the white skills you want to spark. Cards that hint or give the skill, its gold
  upgrade, or its ◎ form all count; gold counts more because a gold skill has a base 40% spark
  chance at run end vs 20% for a white.
- You pick the trainee. Her own support cards are excluded, her innate and awakening skills
  count as already covered, and her growth rates and aptitudes feed the stat and race models. Her own
  events count as sources too: story and choice events at a set rate, outings at another, and secret
  events scored from the agenda (a "win the Derby and the Kikuka Sho" event is worth the product of
  those win chances, and nothing if a required race is not scheduled). Choice-gated ones take part in
  the one-option-per-event rule like card events.
- The G1 schedule is built from a win table (surface x distance aptitude, consecutive-race penalty) with a win-chance threshold you set
  on the main page, plus per-race checkboxes.
- Each card gets a spark score (expected sparks over the targets, given how likely the card
  is to actually hand over the skill) and a stat score (predicted contribution in independent
  training at your limit break). Ranking is by marginal spark gain, tie-broken by stats.
- A greedy builder first pins chosen cards (with Light Hello added as a default for Our Grand Concert), then adds the card with
  the largest marginal spark gain per slot, one card per character.
- The predicted run shows expected stats, chance of ≥600 and ≥1100 per stat (blue spark star
  bands), chance of SS rank (which increase white spark star odds), estimated SP, and a 10-skill priority list used by independent training
  with the skills that are gated behind an event choice listed first.
- Every card counts as owned at a default limit break (4 for every rarity, editable) until you
  change it in the card table: pick an LB or "not owned". Adjustments live in localStorage and
  export to `inventory.json` (every card listed, `null` = not owned). Drop that file in the
  repo root to make it the default.
- Parent blue sparks: per parent, one slider per stat, up to 9 stars a side. A 3★ blue spark
  gives +21 to its stat at the start (2★ +12, 1★ +5) and the same again at each of the two
  inspiration events when it procs (70/80/90% by stars, scaled by the affinity setting). White
  spark star odds depend on the run's SS rank instead.

Terms are defined in [docs/GLOSSARY.md](docs/GLOSSARY.md). Game constants live in
`src/model/rules.ts`, tunable estimates in `src/settings.ts`.

## Code layout

- `src/model/`: the game and tool logic, with no DOM. `run.ts` turns the user's choices into the plan
  the page shows (schedule, deck, prediction, rank estimate, prioritized skills); `sparks.ts` finds skill
  sources and resolves event conflicts; `deck.ts` scores cards and builds the deck; `stats.ts`,
  `races.ts`, `rank.ts`, `inherit.ts` and `trainee.ts` are the individual models.
- `src/state.ts`: the persisted state and its migration from older saves.
- `src/ui/`: lit-html templates, one module per panel.
- `tests/`: model rules, the run pipeline, state migration, and data-shape checks; `smoke.mjs` drives
  the page in a browser.

## Running

```
npm install
npm run dev        # http://localhost:5173, also reachable on the LAN at http://<this machine's IP>:5173
npm test           # model tests (node --test)
npm run smoke      # headless Chromium walk-through against the dev server, writes docs/screenshot.png
npm run build
```

`npm run dev` binds to all interfaces (`vite --host`). Vite prints the network URL on start.

## Data

`npm run fetch` runs `scripts/fetch-gametora.mjs` and `scripts/fetch-event-names.mjs` (`--offline` on the first re-normalizes without any request). The first reads GameTora's static JSON feed
(manifest at `/data/manifests/umamusume.json`), normalizes it into `data/*.json`, and
downloads card, character and skill thumbnails into `public/assets/`. It makes one request
at a time about a second apart, with a plain browser user agent and no identifying headers,
and only re-downloads files whose manifest hash changed. Run it when a new card lands.

- `data/cards.json`: Global support cards with effects at every level and per limit break,
  hint skills, event skills, chain events and random events with rewards decoded. Event names
  come from the per-card page JSON (the static feed scrambles them), fetched once per card.
- `data/skills.json`: all skills with rarity (1 white, 2 gold), SP cost, family links.
- `data/characters.json`: Global character cards with aptitudes, growth, innate and
  awakening skills, career goals, and her own events (story, choice, outing, secret with conditions)
  from the per-character page JSON, on the content version Global runs.
- `data/races.json`: the G1 career calendar.
- `data/ranks.json`: rank score thresholds.
- `data/stat-model.json`: fitted independent-training stat model, produced by
  `npm run fit` (`analysis/fit_stat_model.py`, needs numpy, scipy, openpyxl).

## Stat model

Independent training card stats are close to deterministic per card and limit break. The
fit uses the Loopacord "Independent Training Research" sheet (`docs/`), 169 card-LB rows at
28 G1 races in Our Grand Concert with Light Hello SSR in the deck:

- Outside its own facility a card adds a floor of about 23 to every stat plus its
  Initial Stat passive, one for one.
- On its facility (and the facility's secondary stat: Speed->Power, Stamina->Guts,
  Power->Stamina, Guts->Speed+Power, Wit->Speed) it adds a constant plus about 0.6 per
  point of Friendship Bonus, 0.7 per point of Training Effectiveness, 0.1 per point of
  Mood Effect and 11 per point of Stat Bonus. Specialty Priority does not show up.
  RMSE 4.6 stat points, R² 0.95.
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

Numbers with no measurement behind them (chain completion rates in independent training,
random event rate, big/small reward split, Group outing rates, hint acquisition scaling,
loss penalty) are defaults in the advanced settings panel.

## Known gaps

- Independent-training hint pickup, random event rates, the Group finale rate, the trainee's outing rate
  and the fallback for secret-event conditions the tool cannot score (rival results, streaks, strategy)
  are unmeasured; the defaults are guesses marked as such in the advanced settings.
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
