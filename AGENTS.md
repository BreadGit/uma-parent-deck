# Working rules for this repo

Choose verification proportional to the change. For documentation-only edits, review the text, links,
and diff. For isolated UI copy or styling edits, inspect the affected UI and run relevant layout or
browser checks. For changes to calculations, state, data loading, or shared application code, run
`npx tsc --noEmit`, `npm test`, and `npm run smoke`. Verify the requested behavior as well as test results.

The analysis tests inside `npm test` run Python unittest modules and need `python3` with numpy and openpyxl.
Without them those tests skip with a notice in the summary rather than failing; treat a skip as untested, not passing.
`npm run test:quick` skips them on purpose for the inner loop; run `npm test` before reporting work complete.
Changes to the inventory scanner also run `npm run test:scanner`.

The smoke test drives headless Chromium through the main flows and checks for horizontal overflow at
390, 768, 1280, 1440, 1680 and 1920 px in both themes. Reserve the browser regression suite for large
changes or code review of a branch about to merge. Large changes include work spanning several user
flows or substantial changes to shared planning, persistence, or worker behavior. Routine isolated
changes use the checks above and direct verification of the affected behavior; changing a browser
interaction alone does not require the regression suite.

`npm run test:e2e` runs smoke followed by browser regressions, scroll-anchor and scanner checks. When those
regressions are warranted, run it once instead of also running smoke separately. If smoke already
passed on the same code and server, run the rest of its steps from `package.json` to avoid repeating it.

Browser checks need a running dev or preview server. They default to port 5173; set `URL` for another
address. Set `SCREENSHOT_PATH=''` to skip the smoke screenshot or set a temporary path to inspect it.
Smoke and the regressions first compare the dev server's build hash with this checkout and stop when
they differ, because a server for another worktree answers on the same port with other code.

For a one-off browser check, run `node tests/scratch.mjs <script.mjs>`, `--eval '<expression>'` or
`--shot <path.png>`: it supplies `page` and the test helpers, so the script can live in `/tmp` and
needs no imports. A script elsewhere cannot import `playwright` itself; do not copy scratch files into
the tree to work around that. Take field ids and `data-*` attributes from `src/ui`, not from memory,
before waiting on a selector: a miss costs a 30-second timeout.

Edits: never rely on an anchor string matching. Assert that a replacement applied. Three fixes in this
project's history silently did nothing because the surrounding text had changed.

Code should be self documenting, with tests covering expected behaviors.

## Product principles

This tool prioritizes useful estimates and convenient data entry. Support partial input where the
model can produce a meaningful result, and make consequential assumptions or limitations clear.

Distinguish incomplete input, malformed data, and genuinely impossible outcomes. Apply validation
appropriate to each case.

Preserve valid user-entered data across unrelated edits and saved-state migrations. Do not require
additional input or discard saved choices merely to simplify implementation.

Follow these principles across the project. Keep implemented defaults and calculations in their
defining code. Keep external game evidence, provenance, and uncertainty in `docs/umamusume/`, and
link the implementation to the relevant evidence. Distinguish observations from modeling assumptions;
a dated source record remains evidence even when the implementation uses a different value.

## Development server

Keep a development server running for this project so the user can review it from a phone or another
device on the same local network. At the start of a work session, check for an existing project server
and reuse it. If none is running, start `npm run dev` from the project root and leave it running after
the task finishes, unless the user asks otherwise.

A server on port 5173 may belong to another checkout: find its directory with `readlink /proc/<pid>/cwd`
(the pid is in `ss -ltnp`) before reusing it. In a git worktree, run `npm ci` first (a fresh worktree has
no `node_modules`), start `npm run dev -- --port <n> --strictPort` on a free port, and pass
`URL=http://localhost:<n>/` to the browser checks. Start the server detached from the agent session, as in
`setsid nohup npm run dev > /tmp/uma-dev.log 2>&1 < /dev/null &`, and poll it with `curl`: agent harnesses
stop their own background tasks after a time limit, which took the server down mid-session. Do not `pkill`
vite, since the running server is the one the user reviews from.

The preview browser tools (`preview_open`, `preview_navigate`) cannot reach `localhost`. Navigate with
`{kind: 'environment-port', port: <n>}`, which resolves to the LAN address, and confirm the returned
title is `Uma parent deck` before evaluating anything: `preview_open` reports success while the tab sits
on a Chrome error page.

`npm run dev` already uses `vite --host` to listen on all interfaces. Preserve that default. Do not add
`--host 127.0.0.1` or `--host localhost` unless the user explicitly requests access only from this computer.
If an existing project server listens only on loopback, restart it with `npm run dev`. Verify an HTTP
response at the machine's LAN address and report the network URL printed by Vite, normally
`http://<this machine's LAN IP>:5173`, so the user can open it from another device.

## Layout

Game information is curated and vendored in `docs/umamusume/`. This directory is for game information only, including mechanics, guides, and reference datasets. Use it to answer game knowledge questions before searching the internet. Keep project architecture, implementation notes, and plans outside this directory. Game terms are defined in `docs/umamusume/GLOSSARY.md`; tool terms are defined in `docs/GLOSSARY.md`.

- `src/model/`: pure game and tool logic, no DOM. `run.ts` has `planRun()`, the whole pipeline from the
  user's choices to the plan the page shows. Named game constants in `rules.ts`; tunable estimates with
  their provenance in `src/settings.ts` (`SETTING_HELP` there is the user-facing source note, and
  `SETTING_SPEC` is what each value accepts).
- `src/state.ts`: the one persisted object and the one migration path from every older shape. Nothing
  else touches localStorage.
- `src/ui/`: lit-html templates. `context.ts` holds the data, the store, view state and the memoized plan;
  panels change persisted state only through `update()`. One module per panel under `panels/`.
- `src/scanner/`: the screenshot inventory scanner, embedded in the planner from the Inventory panel and standalone in `scanner.html`; `session.ts` is the shared flow, which reads support-card screenshots in a worker
  and exports `inventory.json`. It shares styles, copy and form helpers with `src/ui/` but not the planner's data or state.
- `tests/`: `model.test.ts` has a test per rule, `run.test.ts` covers the pipeline and the family-aware
  ordering, `state.test.ts` covers migration and setting specs, `data.test.ts` checks `data/*.json` shape
  and references (run it after a fetch or a refit). Tests are type-checked with the app.

## lit-html

lit owns the children of everything it renders: never set `innerHTML` or `textContent` inside the app
root. An element a handler writes to directly (the threshold `<output>`) is bound by property
(`.value=`), not by a child expression. Boolean attributes use `?open=` and `?disabled=`. Every field
that mirrors state (inputs the user types into and every `<select>`) binds `.value=${live(...)}`: a `<select>`
the user has changed ignores later `?selected` changes on its options, so one that lit reuses for a different
card or stat keeps a stale value (the deck LB dropdowns did). Render a list whose rows carry fields with
`repeat()` keyed by identity, so a row that changes identity gets a new element. Build `<option>` lists with
`options()` from `src/ui/fields.ts`: it keys options by value, so a placeholder that disappears does not shift the
selected index onto a different entry. Read event values through `selectValue()`, `inputValue()` and `isChecked()`
rather than casting `e.target`. Panels in `src/ui/app.ts` use `trackedPanel()` from `src/ui/context.ts`, which records the `view`
fields a panel reads and re-renders it only when one of them, the plan or the persisted state changes; no
dependency list is kept by hand, but a view change made without `refresh()` leaves that panel's memo stale.
User-facing sentences live in `src/ui/copy.ts`; confirmations and notices use `src/ui/dialog.ts`, not
`window.confirm` or `alert`. Interactive elements may carry `data-tip` for hover and focus help, and only
non-interactive elements pin the tooltip on click. The smoke test's
`assertFieldsMatchState` compares every state-bound field with the saved state; call it after any new
interaction. Keep the
`data-*` attributes on interactive elements: the smoke test selects by them.

Styling: colours come from CSS variables in the two theme blocks at the top of `src/style.css`, nothing
else. A theme block may set variables; it may not restyle a base class such as `.tag` (that override
outranks every variant and has bitten us twice). No inline styles in templates; add a utility class.

Data: `npm run fetch` is the only thing that talks to GameTora (one request a second, generic user
agent, no identifying headers, manifest-hash cached; per-card and per-character page JSON cached in
`data/raw`). `node scripts/fetch-gametora.mjs --offline` re-normalizes `data/*.json` from `data/raw`
without a request. `npm run fetch` also refits the stat model and runs `npm run check:data`.
After an offline rebuild or another data change, run `npm run fit` and `npm run check:data`.
Skill names use the official Global name (`name`) with GameTora's translation as `altName`.

## Commits

Commit completed, authorized work on your own, without waiting for the user to ask or confirm. Respect
an explicit request to leave work uncommitted. Split work into focused, logical commits as you go;
include the tests and documentation for a change with that change. Use imperative commit messages.
Run the required checks before reporting the work complete.

Review the staged diff before each commit. Stage only changes that belong to the task, and preserve
unrelated work already in the workspace. Do not commit `docs/screenshot.png`.

Include a `Co-Authored-By` trailer identifying the agent that actually contributed and its model version.
Use the model version reported by the current session; do not guess or reuse another agent's name or model.
For example: `Co-Authored-By: Codex (GPT-6 Astra) <noreply@openai.com>`.

## Shared instructions

This file is the shared project guidance for all AI agents. Keep project-wide instructions here.
`CLAUDE.md` imports this file so Claude reads the same guidance without a second copy to maintain.
