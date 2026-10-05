# Data sources and validation

The app uses GameTora game data, community measurements, and documented model assumptions.
These need different checks. A valid JSON shape does not establish completeness or prove a
measurement applies to the selected limit break, race count, or game version.
The shapes of `data/*.json` are the types in `src/types.ts`; `tests/data.test.ts` checks them.

## Updating data

`npm run fetch` downloads the static GameTora sources, refreshes page data, normalizes the
complete set, refits the model, and runs `npm run check:data`. A failed stage stops the command.
Python with NumPy and openpyxl is required for fitting and the measurement checks.

For an offline rebuild of the saved snapshots:

```sh
node scripts/fetch-gametora.mjs --offline
npm run fit
npm run check:data
```

`npm test` includes the same data checks alongside the model and state tests. Application
changes still require the repository's browser verification. Data checks do not replace it.

## GameTora

The importer checks required source tables, IDs, cross-file references, event structures and
normalized values before writing application data. Reconciliation covers Global supports,
trainee outfits, skills, the G1 calendar, ranks, effects and scenario data. Source IDs identify
records; character names alone cannot distinguish alternate cards or outfits.

Global event overrides and historical reward versions take precedence over newer JP rewards.
The selected content period has explicit canaries. A new period or a changed canary requires
review, rather than silently continuing with the previous period.

Unknown support-effect IDs and unique payloads remain in the data so the UI can flag them.
Unexpected structures that cannot be interpreted safely stop normalization. Reward flags also
remain in the data. Unverified skill-reward flags appear in source explanations and support
coverage; the model does not invent a probability for their meaning.

Page caches track their source inputs and cached contents. Changed inputs or corrupted contents
invalidate a cache entry. Legacy caches remain usable offline after structural reconciliation;
their first online refresh establishes revision records. Once those records exist, incomplete
refreshes cannot be normalized as a complete snapshot. Cache validation does not prove an
unchanged upstream page is correct. Explicit forced page refreshes remain available with
`node scripts/fetch-event-names.mjs --force`.

Offline normalization must preserve the last actual fetch time. Regeneration is not evidence
that the source was fetched again.

## Community measurements

`analysis/measurement_sources.py` derives the extracts from the original saved sources. It
finds both workbook card tables by their headers and preserves source locations, card IDs,
run counts, quality flags and exclusion reasons. Populated rows outside recognized tables,
duplicate observations, changed headers and unrecognized formats fail extraction.

Loopacord rows qualify only when the source marks them updated and sufficiently tested.
The source's approximately 28-race schedule is a calibration reference, not proof of an exact
race count in every run. A `50+` count remains a lower bound in the UI. Unqualified rows remain
in the extract but do not become observed references or training examples.

Fujikiseki medians come from the displayed median values; means come from the explicit mean
metadata. The saved report contains mixed aggregates. Its hidden per-limit-break rows contain
no saved measurements. These aggregates remain available for inspection but cannot establish
an exact limit break and compatible run conditions, so the current fit excludes them.

The workbook's race and focus parsers check headers and match run IDs. Per-card contributions
must sum to the recorded deck totals. Trainee growth uses explicit outfit IDs. Total, event and
card summaries of the same runs are not independent samples.

The fitted model records hashes of its source data and fitting code. Tests reject a stale model
and direct the updater to refit. They also compare the generated extracts against the saved
sources. Hand-editing an extracted number cannot silently change the next fit.

## Limits of the evidence

Known gaps in the imported data: career goals come per character, so an alternate outfit shows the base
outfit's goals; the two Group cards' random events and Team Sirius's sixth chain event are incomplete.

Source reconciliation establishes what was imported and why. It cannot establish that every
community reading or upstream game description is correct. Model evaluation holds complete
cards out of training; it does not validate all game mechanics or full-deck outcomes.

Numerical rules and estimates live in `src/model/rules.ts` and `src/settings.ts`. Their source
notes distinguish measurements from assumptions. Unmeasured rates, unknown source flags,
missing deck context and effects absent from the formula remain limitations. Keep those
limitations visible when changing labels or adding new data.
