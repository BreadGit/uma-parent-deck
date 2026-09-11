# Performance audit, 2026-09-11

Audited commit `3e10fe3`. This report records measurements and proposed changes. Application code
and test behavior are unchanged. Experiments ran from `/tmp/uma-perf-audit`.

## Findings and priority

1. Avoid rerendering the card ranking when opening a target editor or typing a search query.
   These view changes reuse the plan but still execute thousands of Lit bindings and model helpers.
2. Cache exact stat distributions inside the goal evaluator. An isolated bounded-cache experiment
   reduced search time by 13–16% without changing the compared results.
3. Compute event-settings fingerprints once per planning snapshot. Rebuilding existing cache keys
   consumed 8–10% of sampled search CPU time.
4. Separate ordinary form and model tests from full optimizer runs. Many tests repeatedly search
   approximately 1,700 decks to verify behavior unrelated to deck selection.
5. Use a production build when assessing device loading over Wi-Fi. Then reduce initial rendering
   and split data loading. Production loading still has a substantial main-thread task.
6. Retain an idle worker and consider a bounded result cache after establishing correct invalidation
   and cancellation. Worker reuse alone will not remove the dominant probability calculations.

## Measurement conditions

Measurements used this machine's Intel Core i7-10750H, Linux x64, Node 26.7.0, installed Playwright
Chromium, and the locked project dependencies. Browser requests used the machine's LAN address.
This is local Chromium accessing the host through its LAN address, not a physical phone over Wi-Fi.
Other desktop applications remained running. Audit benchmarks ran sequentially; unit test files
used the repository's normal concurrent runner. A separate smoke run in the main project checkout
was observed during this audit's browser-suite run. Suite timings therefore include possible CPU
contention. CPU profiles add some measurement overhead.

The development server runs on port 5174 because port 5173 was already occupied outside the sandbox.
An HTTP request to `http://192.168.0.17:5174/` returned 200. A temporary production preview used port
4174. Browser contexts had fresh storage and caches for cold visits. Warm visits reloaded the same
context. The initial browser measurements used a 1440 × 1000 viewport without CPU throttling.

## Deck search

Three runs per fixture used `defaultState(loadData())`, the repository's `inventory.json`, default
settings and pins, and the listed trainee and required targets. Each iteration measured the initial
`planRun(..., { search: false })`, full search without a previous-deck seed, and display reconstruction
with the returned selection and summary. Values below are medians from CPU-profiled Node runs.

| Fixture | Initial estimate | Complete search | Rebuild displayed result |
| --- | ---: | ---: | ---: |
| Empty trainee and targets | 60 ms | 57 ms, no full search | 18 ms |
| Special Week, 100101, no targets | 52 ms | 6.67 s | 17 ms |
| Special Week, required 200352, 201601, 200472 at 2 stars | 118 ms | 8.11 s | 27 ms |
| Fuji Kiseki, 100501, required 201601 at 2 stars | 74 ms | 7.14 s | 18 ms |

The Fuji fixture here keeps the repository inventory unchanged. It is not the exact Smart Falcon
ownership fixture in the existing search regression.

Browser searches after selecting Special Week and then adding Groundwork took 5.70 and 5.85 seconds
in development, and 5.92 and 6.17 seconds in production. These measure worker construction through
the final message. Add the 400 ms edit debounce and main-thread result publication to describe the
whole user wait. These are individual observations, not a distribution of device performance.

The search does useful work, but it repeats expensive calculations. In
[run.ts](../src/model/run.ts), every candidate builds preliminary deck diagnostics, resolves its
prioritized skills, builds deck diagnostics again with that priority, predicts stats, computes rank
bands, and scores the goal. The normal search fully evaluates up to 208 decks and screens another
1,536 with 32 rank samples instead of 2,048. Small constrained pools use exhaustive search instead.

CPU profiles attributed 76% of total sampled time with no targets, and 61% with three required
targets, to [goalRankBands](../src/model/goal.ts). Stat probability mass construction alone accounted
for 27% and 21%, respectively. Sampling stat outcomes and evaluating normal probabilities also cost
substantial time. The screening stage consumed about 54–57% of the whole profile. Lowering its sample
count does not avoid constructing the same detailed stat distributions and deck diagnostics.

### Caching experiment

A disposable copy of `src/` cached `statMasses(mean, sd, cap)` with exact numeric keys and a 512-entry
least-recently-used limit. No rounding, sample-count changes, search-budget changes, or altered
probability rules were involved. Baseline and cached implementations ran sequentially in one Node
process, without the CPU profiler, twice for each fixture.

| Fixture | Baseline | Cached | Reduction | Distribution cache hit rate |
| --- | ---: | ---: | ---: | ---: |
| Special Week, no targets, first run | 6.93 s | 5.84 s | 15.7% | 52.4% |
| Special Week, no targets, second run | 6.51 s | 5.53 s | 15.0% | 52.8% |
| Special Week, three required targets, first run | 7.90 s | 6.74 s | 14.6% | 58.5% |
| Special Week, three required targets, second run | 7.87 s | 6.82 s | 13.4% | 58.5% |

All four comparisons had identical serialized deck selections, complete goal estimates, and search
summaries. This is evidence for the optimization, not sufficient regression coverage to ship it.
The cache size was an experimental choice. Measure retained memory and choose an entry or byte
budget suitable for phones before production use. Prefer caching cumulative distributions and
blue-band partitions too if profiling confirms that their extra memory is worthwhile.

### Other search improvements

[eventSources](../src/model/sparks.ts) already caches decoded card events, but each lookup calls
`eventSettingsKey()`, which flattens and joins the rate settings again. That key construction alone
accounted for 8–10% of the sampled time. Compute it once for an immutable planning snapshot and
share it across candidate evaluation. Settings currently mutate in place, so caching solely by the
existing settings object's identity would return stale results after edits.

`describeDeck()` computes marginal scores and source breakdowns for individual cards. Search needs
the complete deck's goal score; not every intermediate candidate needs all display diagnostics.
Separate those needs and build the full diagnostics for the selected deck. Preserve the ordering
and event-conflict rules, which do affect the score. This is a larger refactor with no measured
speedup yet. Per-card source caches currently use context identity; a new priority context for each
candidate prevents some invariant source data from being shared.

There is also a specific fast path when no white targets are selected. In `scoreGoal()`, the empty
required list and empty preferred list reduce deck comparison to the blue chance with fixed pink
eligibility. Every candidate still computes sampled rank bands. Search can use the analytic blue
chance in that case and compute rank diagnostics fully for the selected deck. Keep the display's
partial estimates intact. The potential gain is unmeasured; the no-target profile identifies why
this case deserves a separate benchmark.

[context.ts](../src/ui/context.ts) terminates the worker after every completed search and whenever
an edit changes the planning key. A new worker reparses its bundle, rebuilds lookup maps, and
loses its event and sampling
caches. Keep a completed worker idle for reuse. Active cancellation still needs care because the
current synchronous search cannot process a cancellation message until it returns. Either terminate
an active worker as today, or make the search yield between batches and check request IDs.

Worker reuse also requires bounding `scenarioOptionCache`, whose per-data Map currently accumulates
entries by scenario and character set. A persistent worker would extend that Map's lifetime.

For repeated identical inputs, a small in-memory cache of completed selections can skip search.
Include the run, relevant settings, inventory, data/model version, and search algorithm version.
Bounded search also depends on the previous-deck seed. Include that seed for exact result reuse, or
use cached selections as candidates and rescore them. Revalidate ownership, pins, trainee exclusion,
and limit breaks. Persisting cached results across reloads needs the same versioning and validation.

Do not reduce the existing exploration budget as the first optimization. The Fuji regression exists
because a smaller search missed a better legal deck. Exact reuse offers improvements without
changing that search-quality tradeoff.

## Target white-spark clicks

[selectTarget](../src/ui/panels/targets.ts) updates `view.targetEditorId` and calls `refresh()`.
It does not mutate the saved run or start a new search. Twenty clicks after a settled search started
zero new workers. Therefore the reproduced work is rendering, not repeated optimization. Fan speed
was not measured, and these observations cannot attribute every fan change on a physical laptop.

The root [page template](../src/ui/app.ts) invokes every panel on each refresh. The ranking has 245
cards, and the settled page contained about 11,300 elements. Its row templates recompute tooltips,
format values, and update bindings even while the user only opens or closes a target editor.

`lbSelect()` and `uniqueTag()` in [ranking.ts](../src/ui/panels/ranking.ts) also call `plan()` again.
Instrumentation counted 291 plan calls per click, or 5,820 for twenty clicks. The cached plan avoids
recalculation, but each call serializes the complete run, settings, and inventory to check the key.
Pass the existing plan or the needed values into these helpers. Compute a planning key once per
relevant state update, while retaining reliable invalidation for the mutable store. Also separate
search dependencies from presentation settings. For example, `showUnowned` changes the ranking's
visible pool but leaves the legal owned search pool unchanged; its current settings-key change
still restarts search.

Unthrottled click-handler medians over twenty clicks were 14.9 ms in development and 7.8 ms in
production. Maximum observations were 23.4 and 20.5 ms. A 4× CPU slowdown experiment measures the
same interaction under reduced CPU throughput; it is not a physical-phone benchmark.

In a browser-only experiment, a Lit `guard()` around the ranking keyed by plan identity and sort
order reduced the median handler from 53.8 ms to 14.6 ms at 4× CPU slowdown, a 73% reduction.
Plan calls fell from 291 to 6 per click. Twenty clicks in each variant started no workers. The
median interval through two animation frames fell from 116.4 ms to 75.0 ms. That interval is a
rendering proxy, not a measured Interaction to Next Paint score. This experiment changed only
intercepted browser responses; it did not modify the repository or verify every ranking interaction.

Guard expensive panels on their actual dependencies, such as the plan and ranking sort order.
Keep state-bound fields live and retain keyed row identities. Test target selection, inventory/LB
edits, pins, sort changes, settings, invalid-field recovery, and completed worker results after adding
guards. Returning a cached TemplateResult alone does not prevent Lit from walking its nested
directives and bindings.

Pagination or rendering only visible ranking rows would also reduce the DOM and startup work, but
changes browsing, search, accessibility, and the existing field/layout tests. Start with dependency
guards and helper arguments before that larger UI change. Memoize aptitude-option previews and
closed-panel diagnostics only if they remain material in a new profile.

## Initial page loading

| Visit | First contentful paint | Resource requests | Resource transfer |
| --- | ---: | ---: | ---: |
| Development, cold | 600 ms | 97 | 5.81 MB |
| Development, warm reload | 512 ms | 97 | 0.028 MB |
| Production preview, cold | 452 ms | 45 | 0.742 MB |
| Production preview, warm reload | 444 ms | 45 | 0.014 MB |

These are one cold and one warm visit per build. Counts use Resource Timing entries, excluding the
HTML navigation. Cold development includes Vite's module graph, transformed JSON and development
runtime. The largest imported JSON modules were characters at 1.76 MB, cards at 1.33 MB, and skills
at 1.06 MB transferred. The production application bundle transferred about 323 KB compressed.
The production worker is fetched only once a valid trainee starts a search; it is absent from the
fresh, empty-run startup totals above. Restoring a saved trainee also starts a full search,
so first contentful paint and the final suggested deck are separate readiness milestones.

The production build emitted a 2.176 MB application bundle and a 2.077 MB worker bundle before
compression. Both include the static model/data dependencies. Vite reported a chunk-size warning.
This is not two uncompressed bundle downloads on a fresh empty visit. HTTP caching and compression
help transfer, while each separate main-thread or worker runtime still parses and initializes data.

Cold startup included a 408 ms main-thread long task in development and 329 ms in production.
Warm reloads still had long tasks of 316 and 293 ms. The fresh page already has approximately 10,800
elements and computes an initial deck/ranking before rendering. The blank `#app` has no loading
content before the main module executes. Improving network caching alone cannot remove this work.

For representative LAN review, build with `npm run build` and serve with `npm run preview -- --host`.
The required development server can stay available for editing. In a deployed static host, verify
compression and appropriate caching for hashed assets rather than assuming preview-server headers.

Render a small usable shell first, then load the planner and ranking. Split data by actual need,
such as trainee index versus selected trainee detail, while preserving synchronous availability of
all data needed by a search. Avoid merely replacing static imports with one dynamic import that
still blocks the whole first render. Support thumbnails already use native lazy loading, so adding
that attribute again is not a new optimization.

Build-time preparation is useful for immutable data. Skill-family lookups, event structure indexes,
card/limit-break base contributions, and compact runtime data can be generated when data is fetched
or refitted. Keep settings-dependent probabilities, agenda/fan effects, and deck-dependent unique
effects runtime-dependent. Precomputing every complete deck is combinatorial and impractical.

## Tests and regression suite

`npm run build` passed, including `tsc --noEmit`. All 154 unit/model/data tests passed in 59.5 seconds.
Individual tests run within concurrently scheduled files, so their durations are not additive and
are not isolated function benchmarks. The slowest examples were 23.0 seconds for trainee star
clamping, 21.5 seconds for the retired goal-toggle migration behavior, and 17.8 seconds for the
Special Week secret-event pipeline case.

The star-clamping test calls full `planRun()` three times. Its assertions inspect the unique skill
and rank, not optimizer quality. The migration test likewise launches full searches for each saved
shape. Use `search: false` or an explicit legal selection for tests of evaluation on a fixed deck.
Retain real full searches where selection, search quality, constraints, or previous-deck reuse is
the behavior under test. Do not mechanically turn off search throughout the suite.

Smoke passed in 520.1 seconds, or 8 minutes 40 seconds, including the six-width layout matrix in
both themes and no browser errors. The run disabled screenshot output.

All 30 browser regressions passed. The regression command took 705.8 seconds, or 11 minutes
46 seconds. Together, smoke and regressions took 20 minutes 26 seconds. They ran sequentially
against development, with no audit benchmarks running alongside them. Production startup and
clicks were measured separately; the full regression suite was not repeated against production.

The slowest regression cases were white-target migration and goal edits at 81.7 seconds, goal
explanations at 72.6 seconds, and partial pink-input persistence at 70.7 seconds. In contrast,
the chip-selection regression took 3.2 seconds. These durations identify concrete tests to split
by whether they need real optimizer results.

[browser-fields.mjs](../tests/browser-fields.mjs) wraps page clicks, select changes, reloads, uploads,
checks, and unchecks with `waitForPlan()`. `assertFieldsMatchState()` waits for search too, even when
the assertion only checks immediate persisted input values. Each meaningful edit can therefore
incur a 400 ms debounce and a multi-second full search. The helpers obscure this cost at call sites.
Locator actions do not use the same patched page methods, so completion semantics also depend on
which API a test uses.

Split immediate field/state assertions from assertions about completed recommendations. Use a
controlled worker in editor, persistence, and layout tests that do not need optimizer results.
The existing cancelled-result regression already provides a worker double pattern. Keep a small
set of real-worker integration cases for search completion, cancellation, retry, recommendation
quality, and publication of current estimates. For checks requiring a settled result, also reject
a search-error alert; absence of the pending marker alone can mean failure as well as success.

The smoke script contains about 4.1 seconds of explicit fixed sleeps, including its layout loop,
in addition to search waits. Replace those with observable readiness or layout checks where possible.
That is under 1% of the measured runtime, so removing sleeps alone will not solve the suite cost.
The six-width, two-theme layout matrix provides useful coverage; run it
against representative settled states, without forcing another optimizer run for each unrelated
editor assertion.

`npm run test:e2e` already runs smoke followed by regressions. Running `npm run smoke` immediately
before it repeats the whole smoke sequence. Run it once, or invoke the regression script directly
when smoke has already passed. Split independent regression cases into a modest number of workers
only after reducing redundant CPU work and measuring contention.

Add a separate reproducible performance check with fixed fixtures for empty startup, a restored
run, three-target search, and settled target clicks. Record initial estimate time, worker startup,
search stage durations, final publication, long tasks, and transferred bytes. Functional tests can
assert zero searches on view-only clicks and a bounded number of plan/key computations. Establish
performance budgets on a stable runner rather than asserting tight millisecond limits on every
laptop. Preserve the existing small-pool exhaustive and Fuji search-quality regressions.

## Verification and artifacts

Browser startup and click profiles, Node search profiles, exact-cache comparisons, and suite logs
are in `/tmp/uma-perf-audit`. Unit output is `/tmp/uma-perf-unit.log`. These are disposable audit
artifacts, not required application files. No application instrumentation was written to the repo.
Reproduction scripts are `browser.mjs`, `model.mjs`, `render-experiment.mjs`,
`cache-experiment.mjs`, and `suites.mjs` in that temporary directory. Their paths and ports are specific
to this checkout. The render experiment uses intercepted development-module responses, and the cache
experiment imports a disposable source copy. Neither is a production patch.
