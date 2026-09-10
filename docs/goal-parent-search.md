# Parent goal deck search, phase 2

Implemented 2026-09-10. Search uses the [parent goal evaluator](goal-parent-evaluator.md) to compare
complete legal decks. The [plan](goal-parent-decks-plan.md) records the agreed scope.

## What changes for the user

Required/Preferred roles and star requirements now affect the recommended deck. Required targets
lead the prioritized skill list. User ordering stays saved and applies within each priority group.
Export list downloads the displayed order as `prioritized-skills.txt`, with one official skill name
per line. Excluded choices stay excluded and produce a notice if their skill is required. Ordinary
hints for an excluded skill remain possible; its excluded choice sources are not counted.

The advanced Required-goal tie tolerance defaults to `0.001`, a 0.1% relative window. If the best
required-goal probability found is 10%, only decks at 9.99% or above can win on preferred extras.
Zero permits exact ties only. The window is always anchored to the best probability in the candidate
set, so successive near-ties cannot move the recommendation farther away from it.

Preferred extras are compared by their average count on parents meeting the required goal. The
evaluator computes each preferred spark's intersection with the required goal, including shared
skill outcomes and rank, then divides by the required-goal probability. Individual preferred
probabilities remain available separately in the result panel.

## Search and ownership

`src/model/goal-deck.ts` searches complete decks through a supplied evaluator. It enforces deck size,
owned limit breaks, one borrowed slot, character uniqueness, and the trainee exclusion. It maximizes
the number of compatible pins; owned pins take priority for owned slots when pin counts tie.
Borrow from all controls whether leftover owned pins constrain the borrowed slot. Impossible pin
combinations receive an explanation in How the deck was built.

For pools of at most ten owned and ten borrow entries, search enumerates every legal deck if the
result fits the evaluation budget. Larger pools use a deterministic budget of 192 complete-deck
evaluations. The existing builder supplies a starting deck. Other seeds favor target coverage,
stats and SP, individual accepted blue stats, and each required white family. These are seed and
candidate-order heuristics only; complete goal scores decide the result.

Three rounds retain up to two unexpanded alternatives at a time and try legal single-card swaps.
Replacement candidates interleave the leading cards from each ordering and include pins. Cards
without direct target hints can enter through their stats. Search also tries changing which of the
six cards is borrowed when both ownership and limit breaks allow it. This is a bounded search,
not a guarantee of the global optimum. Borrow alternatives report complete-deck probabilities for
evaluated alternatives with the same owned cards. Their displayed percentages are not additive gains.

`src/model/run.ts` resolves each candidate's prioritized list, sources, stats, and rank. It passes
those outcomes to `goal-objective.ts`. `goal.ts` integrates shared rank-band weights once per deck;
every subset and preferred intersection reuses them. Skill marginals and the displayed complete
probability project the same shared skill distribution used by search, including any bounded sample.

## Zero and uncertain goals

A complete positive goal always beats a partial goal. When full success is zero, search compares
the number of jointly achievable required sparks first, then their joint probability, then preferred
extras within the same relative window. Thus a requirement unavailable in the initial deck can
still be recovered by another candidate. Blue and pink each count as one requirement; each required
white family counts as one.

Individually zero requirements are removed from the fallback calculation before checking incompatible
subsets. Breadth-first exploration checks at most 192 subsets with a frontier of at most 64. If
it finds no achievable subset, up to 64 additional checks build one by adding compatible requirements.
The result marks a bounded subset calculation. Each deck retains its highest-probability subset
among those of the largest size found, with preferred extras deciding exact subset ties. The relative
window applies once, across decks, so subset selection cannot spend that allowance a second time.
This can miss a better preferred result from another near-tied subset of the same deck.
The search does not modify saved targets or their roles. The original complete probability and
attempts remain visible; a separate label names the retained
requirements and their fallback probability. With no achievable requirement, the fallback uses
expected preferred sparks, then stat strength.

No released white form establishes impossibility for a white spark. An optimistic source union
over the full card pool, trainee, scenario and lineage can also prove that a required skill has no
modeled source under the current inputs. A zero in a sampled distribution or a bounded search is
not such proof. The UI says no complete success was found under the estimates and identifies the
remaining goal rather than claiming that each omitted requirement is impossible.

Uncertain pink eligibility currently supplies the same probability interval for every candidate.
The trainee, starting grades and lineage stay fixed. Search removes this common factor for deck
comparison when its upper bound is positive, even if its lower bound is zero. The full interval
stays visible in the result. A genuinely zero upper bound makes pink unavailable for the fallback.

## Responsiveness and measurements

`src/ui/plan-worker.ts` runs search in a worker. The main thread renders current inputs and a
Finding a deck loading state. A new input cancels an unfinished worker. Request IDs and input keys
prevent obsolete results from replacing newer ones. Completed workers send only the card selection
and search summary; the main thread reconstructs the displayed plan using that supplied deck.
The worker does not access localStorage. Search errors retain saved inputs and offer Retry search.

Initial desktop checks with Special Week and 192 evaluations took about 2.7 seconds with no required
whites and 2.9 seconds with two required whites. A separate sensitivity check with Corner Recovery
and Groundwork required at 2 stars and Pace Strategy preferred gave the following results. These
timings were collected alongside other verification work and are not a controlled benchmark.

| Setting | Complete-goal chance | Preferred count on success | Search time |
| --- | ---: | ---: | ---: |
| Defaults | 0.3974% | 0.1000 | 3.6 s |
| Half hint scale | 0.3855% | 0.1000 | 3.9 s |
| Skill rating per SP = 1 | 0.3973% | 0.1000 | 4.5 s |
| Skill rating per SP = 2 | 0.9267% | 0.1597 | 3.8 s |

The higher skill-rating assumption changed one selected card; the other cases kept the same six
cards. This illustrates why the advanced rates remain estimates. Layout checks include phone widths;
timing on a physical phone has not been measured.

`tests/goal-deck.test.ts` checks the comparison window, conditional preferred probabilities, shared
rank, fallback subsets, exhaustive small pools, blue thresholds, balanced required coverage, and
settings migration. Browser checks cover loading and replacement searches, export order, exclusions,
saved state, and layout in both themes. Existing evaluator and run tests remain in place.
