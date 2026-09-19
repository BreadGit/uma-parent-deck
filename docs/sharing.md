# Sharing

A share is a snapshot of panels 1–4, the user's prioritized skill order and exclusions, and manual
G1 schedule overrides.
It contains the trainee, parent goal, targets and their lineage, blue and pink legacy sparks,
aptitude overrides, pinned and ignored cards, borrowing choice, training focus and win threshold.
It excludes inventory, advanced settings, theme, transient UI state and cached
recommendations. It preserves choices rather than a particular calculated result.

## Ownership and loading

`src/share.ts` selects the share scope and encodes and validates codes without game data or browser
state. `src/state.ts` applies a validated snapshot to the existing save. `src/ui/share.ts` owns URL
loading and synchronization through the existing context update hook. Sharing uses the browser
address bar. `src/ui/app.ts` shows a notice only when saved choices are unavailable in the game data.

An incoming `run` URL parameter loads before the first render. Invalid or unsupported codes do not
change saved choices. Browser history navigation also loads incoming codes and checks that no
user edit occurred during decoding. Every history navigation invalidates unfinished imports and URL
writes for the previous location, including navigation to a URL without a share code.
The address bar updates with `history.replaceState`, so edits do not add browser-history entries.
Only shared input changes trigger encoding. Compression is debounced by 300 ms and older asynchronous
results cannot replace newer snapshots. The app removes an outdated parameter immediately on an edit;
reloading during the debounce therefore reads the latest local save. Reset all cancels pending writes
and removes the parameter before reloading. Other URL parameters and the fragment are preserved.

## Format contract

The first character is the share-format version. The second is `j` for UTF-8 JSON or `d` for raw
DEFLATE of that JSON. The remaining characters are unpadded base64url. The encoder selects whichever
byte representation is smaller. Both incoming codes and decompressed JSON have size limits to bound
loading work.

Format 3 extends format 2 with slot 14, and format 4 extends format 3 with slots 15 and 16. Formats 2, 3 and 4
use these positional slots; a format's decoder rejects slots past its last.
A null or omitted top-level slot has the fixed format default;
trailing default slots are omitted. Nested tuples have fixed lengths. Empty lists differ from default
values wherever a default is nonempty.

| Slot | Meaning | Representation |
|---|---|---|
| 0 | Trainee | Game card ID or null |
| 1 | Trainee stars | Integer 1–5 |
| 2 | Parent goal | `[blue mask, blue stars, pink goals]`; pink goal is `[aptitude, stars]` |
| 3 | Target white sparks | `[game skill ID, role, stars, priority]` per target, in user order |
| 4 | White lineage | `[game skill ID, copies 1, copies 2, stars 1, stars 2]` per entry |
| 5 | Blue legacy sparks | Two sides of three numbers; 0 is unentered, otherwise `stat index * 3 + stars` |
| 6 | Pink legacy sparks | Six slots; 0 is unentered, otherwise `[aptitude index, stars, inferred flag]` |
| 7 | Aptitude overrides | `[aptitude index, grade index]` per override |
| 8 | Pinned support cards | Game card IDs in user order |
| 9 | Borrow from all | 0 or 1 |
| 10 | Prioritized order | Game skill IDs in user order |
| 11 | Prioritized exclusions | Game skill IDs in user order |
| 12 | Training focus | Fixed focus index |
| 13 | Win threshold | Number 0–1 |
| 14 | Schedule overrides, formats 3 and 4 | Signed calendar IDs; positive forces in, negative forces out |
| 15 | Ignored support cards, format 4 only | Game card IDs in user order; none may also be pinned |
| 16 | Borrow ignored cards, format 4 only | 0 or 1 |

The fixed stat order is speed, stamina, power, guts, wit. The fixed aptitude order is turf, dirt,
sprint, mile, medium, long, front, pace, late, end. Pink goals reserve index 0 for any aptitude;
their specific aptitudes start at 1. Pink legacy sparks and overrides use zero-based aptitude indexes.
Grades are A through G. Focuses are balanced, stamina, sprint. Target roles are required and preferred.
The flag values are 0 for false and 1 for true. These indexes must never come from a dataset's row order.

The literal defaults in `src/share.ts` are part of the format contract. They must not follow changes
to application defaults. Format 1 is the original prototype's named-object payload with a leading
saved-state version of 20. Its decoder retains that payload's defaults and does not check the current
saved-state version. New shares always use format 4.

Format 4 defaults ignored cards to an empty list and the borrow-ignored flag to 0, as every older format does
on decode: a share replaces the ignored cards like the pinned cards. Format 3 defaults schedule overrides to an empty list, which restores automatic scheduling.
Formats 1 and 2 omit that field on decode, so importing them preserves the receiving device's
overrides. Calendar IDs must be canonical positive safe integers, independent of dataset row order.
Each ID appears once; conflicting signs are invalid. Unknown IDs survive loading and data refreshes.
The sign stores the existing boolean override directly, which also supports future individual
race exclusions without changing the format. This does not add an exclusion control or change
mandatory career goals. An override identifies a particular calendar running, not every year of a race.

## Data and format changes

Weekly additions and renames require no share-format change. Game IDs remain the stored identity.
Current saved-state migration preserves target IDs and their inactive lineage even if the dataset
removes them or changes their family. Older save shapes still normalize their historical family aliases.
Unavailable or reclassified targets are excluded from calculations, with a notice listing the IDs.
If the same IDs become available again, they participate without reimporting the code. A replacement
ID requires a deliberate, tested migration; the decoder must not guess based on a name or row position.

Change the share-format version when changing field meanings, tuple positions, numeric mappings or
omitted defaults. Retain older decoders and literal compatibility fixtures. When adding a new shared
input, decide how older codes should populate it. Do not reuse the saved-state version for this decision.
The explicit shared-input selector makes a new RunInput field a compile-time decision.

`tests/share.test.ts` includes historical codes with literal expected inputs, round trips for all
curated templates, partial inputs, unknown and reclassified data, malformed payloads and size limits.
Browser regressions cover URL loading, inventory preservation, immediate reloads, Reset all,
manual schedule picks and skips, concurrent compression and mobile layouts. Run these checks after
format changes; run the historical fixtures and state tests with data refreshes as well. Expected calculated results may change with the data.
