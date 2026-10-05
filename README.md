# Uma parent deck

A browser tool for Umamusume: Pretty Derby (Global) that builds a 6-card support deck for
independent-training parent farming. You choose the trainee, the parent you want (blue stat, pink
aptitude and white skill sparks) and what you know about her lineage. The tool searches your card
inventory for the deck most likely to produce that parent and predicts the run: stats, rank, G1
schedule, skill points and the skills to prioritize.

Saved choices, inventory and settings stay in the browser. Nothing is sent to a server.

## Using the tool

The left column is the input flow, the right column the results.

1. **Inventory**: every card counts as owned at the default limit break until you change it. Import
   screenshots of your support-card list, or set limit breaks in the Card ranking table.
2. **Trainee**: her cards are excluded from the deck, her innate and awakening skills count as
   covered, and her growth rates, aptitudes and events feed the stat, race and skill models.
3. **Parent goal**: the blue stats, pink aptitudes and white skill sparks the finished parent must
   have (Required) or would be nice to have (Preferred), with minimum stars.
4. **Legacy**: the parents' and grandparents' sparks, entered as the game's pre-run screen shows them
   or per uma.
5. **Run**: the training focus and the win-chance threshold that completes the G1 agenda.

The results lead with the suggested deck and the estimated attempts to reach the parent goal, then
the predicted run, the skills to prioritize, the G1 agenda and the card ranking. Prediction details
shows the numbers behind each estimate and how they were made. Each panel explains itself on the
page; the [tool glossary](docs/GLOSSARY.md) and [game glossary](docs/umamusume/GLOSSARY.md) define
the terms. A separate [Mission races](missions.html) page finds the races for limited missions.

"Import using screenshots" in the Inventory panel reads support-card screenshots locally.
[scanner.html](scanner.html) runs the same flow standalone and downloads an `inventory.json`.

The address bar follows your choices, so copying the URL shares or bookmarks them. A link does not
carry inventory or settings, so it can recommend a different deck on another device.

## Running locally

Use the versions in [.node-version](.node-version) and [.python-version](.python-version). The
stat-model fit and its tests need Python with the packages in `analysis/requirements.txt`.

```sh
npm ci
npm run dev    # http://localhost:5173, also on the LAN at http://<this machine's IP>:5173
npm test
npm run build
```

`package.json` lists the other scripts. [AGENTS.md](AGENTS.md) describes the code layout, the checks
each kind of change needs and the conventions.

## Data and estimates

Game data comes from [GameTora](https://gametora.com) through `npm run fetch` and is vendored in
`data/`. The stat model is fitted from community independent-training measurements. See
[data sources and validation](docs/data-quality.md) and
[evaluating card model inputs](docs/stat-model-evaluation.md).

Game constants are in `src/model/rules.ts`. Estimates that rest on assumptions rather than
measurements are advanced settings; each one's help text in the app and in `src/settings.ts` gives
its basis. The card ranking marks every support effect the model omits or approximates.

[Sharing](docs/sharing.md) is the share-link format contract and [deployment](docs/deployment.md)
covers hosting and the data-update workflow.

## Credits

Data from [GameTora](https://gametora.com). Independent training measurements from the Loopacord
research sheet and [fujikiseki.xyz](https://fujikiseki.xyz/training-data/insights). Mechanics are
summarized in [Game basics and mechanics](docs/umamusume/GAMEPLAY.md) and the linked GameTora and
community references, including uma.guide. Game assets belong to Cygames. This is an unofficial fan
tool, not affiliated with Cygames.
