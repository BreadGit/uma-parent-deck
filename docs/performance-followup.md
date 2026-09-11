# Rendering and test performance follow-up

This follows [the first implementation](performance-implementation.md), starting from `8cc349f`.

## Runtime changes

Every panel now uses the same conservative persisted-state revision and plan identity as the
ranking guard. Panels with transient controls also include their relevant view fields. Deck rendering
includes pending-search status. Every persisted update, including a rejected or unchanged field
edit, still refreshes the bindings. Worker publication supplies a new plan and refreshes the panels.

A target editor click now renders only the goal editor and its targets. Instrumentation counted zero
aptitude-change previews, down from 60 per click. The browser regression observes input bindings in
Legacy, settings, the agenda, trainee controls, run controls, the deck and ranking. Unrelated target
clicks and search text must not read those bindings. Existing editor tests exercise their own controls.

"Show not owned" now belongs to `ui`, alongside theme and ranking sort. The model retains the full
ranking; the ranking panel filters its rows. Visibility changes preserve the planning key and saved
recommendation, including across reload. State version 17 migrates the preference from older
settings without losing either true or false. Older standalone settings migrations keep their
historical defaults. No exception list was added to the planning key.

The existing event-settings fingerprint now keeps one snapshot per settings object in a WeakMap.
It compares scalar values and array contents on every lookup, and only flattens and serializes them
when something changed. Array snapshots are copied, so editing an array in place invalidates the key.
Tests cover scalar edits, nested edits, replacement arrays, and restoration of previous values.
The existing list of event-setting dependencies is unchanged. Workers still terminate as before.

## Test boundaries

`assertFieldsMatchState()` checks the rendered inputs without waiting for optimization. The old
wrapper that silently waited after page actions is removed. `waitForPlan()` is explicit and rejects
search errors; a failed search no longer counts as a successful completion merely because its
pending marker disappeared.

The 24 editor regression cases use `editor()`, which holds worker requests pending. They run the
actual app's input handlers, persistence, immediate estimates and rendering. They do not receive
fabricated recommendations or scores. Calling `waitForPlan()` while search is held fails explicitly.
Seven cases still use native workers for optimization, current estimates, failure/retry, cancellation,
goal edits, reset and recommendation persistence. The cancellation cases also inject controlled
messages to verify obsolete-result handling.

Smoke checks its editor sequence while search is held, then releases the latest active request to
the native worker. It checks field synchronization after publication and layout at all six widths
in both themes. It still fails on browser errors or unsuccessful search. No production test mode
or alternate calculation path was added.

Seven more unit tests skip optimization where they inspect fan thresholds, stat caps, agenda
overrides, skill purchase costs, circle upgrades, start gains, or a trainee secret event. The secret
event comparison uses the same deck on both sides to isolate the agenda change. Optimizer-quality,
Fuji, exhaustive-pool, search-budget and result-publication tests retain real search.

## Measurements

These are observations on the audit machine, not device-independent budgets. Standalone search
benchmarks ran sequentially after the suites. The development browser suite overlapped some unit
checks, as noted for contention when comparing timings.

| Check | Previous implementation | Follow-up |
| --- | ---: | ---: |
| Unit/model/data suite | 160 tests, 37.1 s | 162 tests, 15.8 s |
| Development smoke | 441.7 s | 27.9 s |
| Development browser regressions | 567.8 s | 143.0 s, all 31 passed |
| Target click handler, 4× CPU slowdown | 13.1 ms | 2.4 ms |

The click comparison used 20 clicks per variant in the same browser context. Response interception
disabled only the eight new panel guards for the baseline; the ranking guard stayed enabled.
The median reduction was about 82%. This measures handlers, not fan speed or physical-phone latency.

Two search trials per fixture alternated before/after order against `8cc349f`. Special Week with
no white targets averaged 5.89 s before and 5.37 s after, about 9% less time. With required targets
200352, 201601 and 200472, the averages were 6.93 s and 6.22 s, about 10% less time. All four comparisons
produced identical serialized selected decks, goal estimates and search summaries.

Type checking and the production build passed. All 31 browser regressions also passed against the
production preview in 134.9 seconds. Smoke passed in development and production with no browser
errors and no layout overflow at 390, 768, 1280, 1440, 1680 and 1920 px in either theme. The final
held-worker helper copies requests like native `postMessage()` and leaves unrelated workers alone.

Temporary comparison scripts and output are under `/tmp/uma-perf-followup`; suite logs use the
`/tmp/uma-perf-followup-` prefix. No profiling instrumentation or benchmark overrides enter the app.

## Fragility assessment

The panel guards and event-key snapshots are low risk under the current state ownership rules.
Future view-only controls must be included in their panel's guard dependencies. Persisted changes
remain covered by the common revision. Event-cache tests protect edits made in place.

The test split has moderate coverage risk. An optimizer-dependent assertion placed in `editor()`
would inspect the immediate deck instead of a completed recommendation. Explicit helpers, the
held-search assertion, seven native-worker cases and the final native-worker smoke check reduce
that risk. Future search-quality assertions belong in native-worker or model optimizer tests.

The visibility migration also has moderate implementation risk because it moves a persisted field.
Migration and browser tests cover preservation, UI precedence, reloads and zero searches on toggles.
After migration, keeping the preference outside model settings removes an unnecessary search
dependency and avoids special cache-invalidation rules.

## Deferred scope

First-load rendering changes are deferred. This branch keeps the existing initial panel rendering,
complete ranking, and synchronous data loading. Deferred ranking rendering, creating advanced
settings on first expansion, pagination, and data splitting remain proposals, not implemented work.
