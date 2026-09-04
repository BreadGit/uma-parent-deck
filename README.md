# Uma parent deck

A local web tool for Umamusume: Pretty Derby (Global) that ranks support cards and builds a
6-card deck for independent-training parent farming, aimed at sparking specific white skills.

## What it does

- You pick the white skills you want to spark. Cards that hint or give the skill, its gold
  upgrade, or its ◎ form all count; gold counts more because a gold skill has a 40% spark
  chance at run end vs 20% for a white.
- You pick the trainee. Her own support cards are excluded, her innate and awakening skills
  count as already covered, and her growth rates and aptitudes feed the stat and race models.
- The G1 schedule is built from the uma.guide independent-training win table
  (surface x distance aptitude, consecutive-race penalty) with a win-chance threshold you set
  on the main page, plus per-race checkboxes.
- Each card gets a spark score (expected sparks over the targets, given how likely the card
  is to actually hand over the skill) and a stat score (predicted contribution in independent
  training at your limit break). Ranking is by marginal spark gain, tie-broken by stats.
- A greedy builder pins Light Hello (mandatory in Our Grand Concert), then adds the card with
  the largest marginal spark gain per slot, one card per character.
- The predicted run shows expected stats, P(≥600) and P(≥1100) per stat (blue spark star
  bands), P(SS rank) (white spark star odds), estimated SP, and the 10-skill priority list
  with the skills that are gated behind an event choice first.
- Every card counts as owned at a default limit break (4 for every rarity, editable) until you
  change it in the card table: pick an LB or "not owned". Adjustments live in localStorage and
  export to `inventory.json` (every card listed, `null` = not owned). Drop that file in the
  repo root to make it the default.
- Parent blue sparks: one slider per stat, 0 to 18 stars, capped at 18 across all stats. A
  3★ spark gives +21 at the start (2★ +12, 1★ +5) and the same again at each of the two
  inspiration events when it procs (70/80/90% by stars, scaled by the affinity setting).

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

`npm run fetch` runs `scripts/fetch-gametora.mjs` and `scripts/fetch-event-names.mjs`. The first reads GameTora's static JSON feed
(manifest at `/data/manifests/umamusume.json`), normalizes it into `data/*.json`, and
downloads card, character and skill thumbnails into `public/assets/`. It makes one request
at a time about a second apart, with a plain browser user agent and no identifying headers,
and only re-downloads files whose manifest hash changed. Run it when a new card lands.

- `data/cards.json`: Global support cards with effects at every level and per limit break,
  hint skills, event skills, chain events and random events with rewards decoded. Event names
  come from the per-card page JSON (the static feed scrambles them), fetched once per card.
- `data/skills.json`: all skills with rarity (1 white, 2 gold), SP cost, family links.
- `data/characters.json`: Global character cards with aptitudes, growth, innate and
  awakening skills.
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

Numbers with no measurement behind them (chain completion rates in independent training,
random event rate, big/small reward split, Group outing rates, hint acquisition scaling,
loss penalty) are defaults in the advanced settings panel.

## Credits

Data from [GameTora](https://gametora.com). Independent training measurements from the
Loopacord research sheet and [fujikiseki.xyz](https://fujikiseki.xyz/training-data/insights).
Mechanics from the community Global reference documents and uma.guide. Game assets belong
to Cygames; this is a personal tool and the images are not for redistribution.
