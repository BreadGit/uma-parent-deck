# Performance changes

These changes follow the [performance audit](performance-audit-2026-09-11.md). They preserve search
budgets, probability rules, candidate ordering, and the worker's existing cancellation behavior.

## Calculation cache

`goal.ts` caches exact rounded stat distributions by mean, standard deviation and cap. It does not
round cache keys or cache settings-dependent goal scores. Cached arrays and entries are readonly
inside the module. The cache evicts the least recently used distributions above 512 entries or
250,000 retained outcomes, whichever limit is reached first. Sample counts, blue requirements,
rank thresholds, and white-star settings still apply afresh to each evaluation.

## Rendering

The ranking uses Lit's `guard()` with the full plan and a persisted-state revision. Every `update()`
increments the revision, even for a no-op. That preserves live field correction without a manually
maintained list of ranking dependencies. Worker publication creates a new plan. View-only changes,
such as target selection and search text, skip the unchanged ranking.

Ranking and deck LB helpers receive the existing plan instead of calling `plan()` for each card.
The complete planning key is calculated once per persisted update, rather than on each plan lookup.
Object keys are canonicalized so migration's object construction order does not invalidate a match.
Array ordering remains significant.

## Saved recommendations

The single persisted state object has an optional recommendation containing card IDs, limit breaks,
the borrowed slot, the search summary, the full input key, and a build fingerprint. Only a completed
current worker result can save it. A relevant input edit or reset discards it. Obsolete results
cannot repopulate the cache, including an A to B to A edit sequence.

Reload reuses a recommendation only when its shape, state schema, input key, build fingerprint,
and deck legality pass validation. Run estimates and displayed diagnostics are recalculated for the
selected deck; the optimizer is skipped. Missing or invalid cache data follows ordinary search.
The cache does not replace user inputs, and failure to store an optional result does not hide it.

The Vite fingerprint hashes all source files, normalized data JSON, the default inventory, package
metadata and lockfile, HTML, and build configuration/helper. It requires no manual version bump for
calculation changes. Development source/data updates invalidate the virtual version module and
reload the page. A new cache can be written after that build's search finishes.

Workers still terminate after completion or cancellation. There is no persistent worker or
cross-input result cache. Only the most recent completed recommendation is stored.

## Tests and measurements

Two existing unit tests now use `search: false` because they check star clamping and migration,
not deck optimization. Search-quality tests, including Fuji and exhaustive small pools, retain
real search. Browser tests still exercise the real optimizer; tests that inject a failed or cancelled
worker explicitly discard the saved recommendation first.

New tests cover exact distribution inputs, fingerprint completeness, migration ordering, malformed
caches, reset, legal restored decks, storage failure, source/data fingerprint changes, unchanged
reloads, view-only rendering, no-op field correction, runtime edits and late worker messages.

Measurements used the audit machine and dependencies, with benchmarks run sequentially against
commit `a70976d` and these changes. Search comparisons alternated before/after order over three
trials per fixture, without profiling. Both fixtures used Special Week and the repository inventory.

| Measurement | Before | After |
| --- | ---: | ---: |
| Search with no white targets, median | 5.98 s | 5.45 s, 8.9% less time |
| Search with required targets 200352, 201601, 200472, median | 7.36 s | 6.77 s, 8.1% less time |
| Target editor click handler at 4× CPU slowdown, median of 20 | 53.8 ms in the audit | 15.1 ms, 72% less time |

All six search comparisons produced identical serialized selections, goal estimates and search
summaries. The outcome limit is more conservative than the audit's entry-only cache experiment,
which reported a larger speedup. The before/after click measurements came from separate runs;
they are not a physical-phone benchmark or a measurement of fan speed.

In local Chromium against the development server's LAN address, Special Week with Groundwork
required took 6.36 seconds to publish its first completed recommendation. Three subsequent reloads
took 0.45–0.53 seconds to show the saved result and created no worker. First contentful paint on
those reloads was 0.40–0.48 seconds. This removes the repeated search wait; it does not eliminate
the initial data parsing, ranking construction, or first search when no matching result exists.

The 160 unit/model/data tests passed in 37.1 seconds, versus 59.5 seconds for the audit's 154 tests.
Suite timings are observations with possible desktop CPU contention, not isolated speedup claims.
Search-quality coverage still uses the real optimizer.

The production build and type check passed. Smoke passed in 441.7 seconds with no browser errors
and no horizontal overflow at 390, 768, 1280, 1440, 1680 and 1920 px in both themes. The new cache,
rendering and cancellation regression also passed against the production preview.

The full development regression run exercised 31 cases in 567.8 seconds. Thirty passed; the pink
reset case still expected the entire previous saved recommendation after changing its inputs.
Its assertion now validates that the replacement recommendation matches the reset inputs and
still checks every other saved field. That case passed a focused rerun, including unchanged
reload and repeated reset. Application code did not change after the full browser run began.

Production and focused reset checks overlapped parts of the full regression run, so its suite
timing includes possible contention. The standalone search and click benchmarks ran before the
browser suites. First-visit data loading, ranking size, and broader browser-test restructuring
remain separate work.
