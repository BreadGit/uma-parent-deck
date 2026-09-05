# Working rules for this repo

Before saying something works, run `npx tsc --noEmit`, `npm test`, and `npm run smoke` (needs the dev
server on port 5173; it drives headless Chromium through the main flows and checks for horizontal
overflow at 1280, 1440, 1680 and 1920 px in both themes). Layout bugs only ever surfaced there.

Edits: never rely on an anchor string matching. Assert that a replacement applied. Three fixes in this
project's history silently did nothing because the surrounding text had changed.

Facts about the game belong in code, not prose: named constants in `src/model/rules.ts`, tunable
estimates with their provenance in `src/settings.ts` (`SETTING_HELP` in `src/main.ts` is the user-facing
source note), and a test per rule in `tests/model.test.ts`. Terms are defined in `docs/GLOSSARY.md`;
keep it in sync when a term is added or renamed.

Styling: colours come from CSS variables only. A theme block may set variables; it may not restyle a
base class such as `.tag` (that override outranks every variant and has bitten us twice).

Data: `npm run fetch` is the only thing that talks to GameTora (one request a second, generic user
agent, no identifying headers, manifest-hash cached). Refit the stat model with `npm run fit` after a
data change. Skill names use the official Global name (`name`) with GameTora's translation as `altName`.

Git: one commit per change, message in the imperative, trailer
`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Don't commit `docs/screenshot.png`.
