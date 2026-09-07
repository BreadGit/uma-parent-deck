# Working rules for this repo

Before saying something works, run `npx tsc --noEmit`, `npm test`, and `npm run smoke` (needs the dev
server on port 5173; it drives headless Chromium through the main flows and checks for horizontal
overflow at 1280, 1440, 1680 and 1920 px in both themes). Layout bugs only ever surfaced there.

Edits: never rely on an anchor string matching. Assert that a replacement applied. Three fixes in this
project's history silently did nothing because the surrounding text had changed.

## Layout

- `src/model/`: pure game and tool logic, no DOM. `run.ts` has `planRun()`, the whole pipeline from the
  user's choices to the plan the page shows. Named game constants in `rules.ts`; tunable estimates with
  their provenance in `src/settings.ts` (`SETTING_HELP` there is the user-facing source note, and
  `SETTING_SPEC` is what each value accepts).
- `src/state.ts`: the one persisted object and the one migration path from every older shape. Nothing
  else touches localStorage.
- `src/ui/`: lit-html templates. `context.ts` holds the data, the store, view state and the memoized plan;
  panels change persisted state only through `update()`. One module per panel under `panels/`.
- `tests/`: `model.test.ts` has a test per rule, `run.test.ts` covers the pipeline and the family-aware
  ordering, `state.test.ts` covers migration and setting specs, `data.test.ts` checks `data/*.json` shape
  and references (run it after a fetch or a refit). Tests are type-checked with the app.

Facts about the game belong in code, not prose, with a test per rule. Terms are defined in
`docs/GLOSSARY.md`; keep it in sync when a term is added or renamed.

## lit-html

lit owns the children of everything it renders: never set `innerHTML` or `textContent` inside the app
root. An element a handler writes to directly (the threshold `<output>`) is bound by property
(`.value=`), not by a child expression. Boolean attributes use `?open=` and `?disabled=`. Every field
that mirrors state (inputs the user types into and every `<select>`) binds `.value=${live(...)}`: a `<select>`
the user has changed ignores later `?selected` changes on its options, so one that lit reuses for a different
card or stat keeps a stale value (the deck LB dropdowns did). Render a list whose rows carry fields with
`repeat()` keyed by identity, so a row that changes identity gets a new element. The smoke test's
`assertFieldsMatchState` compares every state-bound field with the saved state; call it after any new
interaction. Keep the
`data-*` attributes on interactive elements: the smoke test selects by them.

Styling: colours come from CSS variables in the two theme blocks at the top of `src/style.css`, nothing
else. A theme block may set variables; it may not restyle a base class such as `.tag` (that override
outranks every variant and has bitten us twice). No inline styles in templates; add a utility class.

Data: `npm run fetch` is the only thing that talks to GameTora (one request a second, generic user
agent, no identifying headers, manifest-hash cached; per-card and per-character page JSON cached in
`data/raw`). `node scripts/fetch-gametora.mjs --offline` re-normalizes `data/*.json` from `data/raw`
without a request. Refit the stat model with `npm run fit` after a data change. Skill names use the official Global name (`name`) with GameTora's translation as `altName`.

## Commits

Commit completed, authorized work on your own, without waiting for the user to ask or confirm. Respect
an explicit request to leave work uncommitted. Split work into focused, logical commits as you go;
include the tests and documentation for a change with that change. Use imperative commit messages.
Run the required checks before reporting the work complete.

Review the staged diff before each commit. Stage only changes that belong to the task, and preserve
unrelated work already in the workspace. Do not commit `docs/screenshot.png`.

Include a `Co-Authored-By` trailer identifying the agent that actually contributed. Do not reuse another
agent's name or model. For Codex, use `Co-Authored-By: Codex <noreply@openai.com>`.

## Shared instructions

This file is the shared project guidance for all AI agents. Keep project-wide instructions here.
`CLAUDE.md` imports this file so Claude reads the same guidance without a second copy to maintain.
