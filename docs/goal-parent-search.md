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

Search first tries to enumerate the legal decks after applying pins and character restrictions.
If there are at most 384 and enumeration finishes within 10,000 partial combinations, it evaluates
every legal deck. A large inventory can therefore receive exhaustive search when pins leave few
choices. Otherwise search uses two stages.

1. Fully evaluate up to 192 decks and publish an initial recommendation. The existing builder
   supplies a starting deck. Other seeds favor target coverage, stats and SP, individual accepted
   blue stats, and each required white family. Three rounds retain up to two unexpanded alternatives
   and try single-card swaps from the leading cards in each ordering. They also try changing which
   card is borrowed when ownership and limit breaks allow it.
2. Screen up to 1,536 complete legal decks with 32 rank samples instead of 2,048. Keep a population
   of twelve promising decks and propose one-card changes, or two-card changes 25% of the time.
   Rankings bias the proposals, but every eligible card remains available. Ten percent of card
   proposals sample uniformly from the full pool. Fully evaluate the sixteen best screened decks,
   then choose among all fully evaluated candidates from both stages.

The second stage starts with the initial recommendation, any previous legal recommendation, and
up to 24 seeds across six borrow choices and the owned-card orderings. It uses a fixed random
stream, so the same inputs and seeds produce the same result. Pins stay constrained, including
exchanges between competing pins when not all can fit. A previous recommendation is an additional
candidate, rescored with current limit breaks and inputs. It cannot bypass ownership or pin rules.
Completed recommendations are saved with their inputs and a source/data fingerprint. An unchanged
reload restores the same selected deck without another search. An input edit or changed build
invalidates that saved result; subsequent search still rescores and validates its in-session seed.

Normal searches perform at most 208 full evaluations plus 1,536 cheaper screenings. Screening
changes only the rank integration sample count. Blue-tail probabilities remain analytic, and
displayed estimates always use the full evaluator. A poor screening score cannot discard the
initial recommendation. Final selection still applies the required-goal tie tolerance across all
fully evaluated candidates. A slightly lower required chance can therefore win on preferred sparks
within that configured window.

This remains a bounded search. Screening can misorder decks and exploration can miss the global
optimum. Search summaries retain evaluated borrow alternatives for the same owned cards. The UI
shows the borrowed card's badge and the complete Parent goal estimate; it omits the separate Borrow
paragraph to keep the deck panel's height steadier.

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

`src/ui/plan-worker.ts` runs search in a worker after a 400 ms pause in input edits when there is no
matching saved recommendation. The restored deck is checked against the current ownership, limit
breaks, pins, borrowed slots and trainee exclusion before reuse. Only completed searches are saved.
Malformed cache entries and caches from older state schemas are discarded without changing run inputs.
The source/data fingerprint updates automatically in builds and during development.
See [performance implementation](performance-implementation.md) for cache boundaries and measurements.

The UI publishes only the completed recommendation. The deck and
prioritized-skill editor remain mounted throughout the search. A spinner beside Suggested deck is
the only normal search indicator. It rotates more slowly when reduced motion is enabled, and a
visually hidden status announces the search to screen readers. There is no search control panel.

The main thread immediately reevaluates the displayed cards for the latest inputs. It normalizes
owned limit breaks and checks ownership, pins, borrowed slots, character uniqueness, and trainee
exclusion through the same constraints used by search. If those cards are no longer legal, the
initial builder supplies a replacement. While the trainee or blue requirement is missing, that
fast builder continues to respond to partial inputs without starting a full search. An inventory
without enough eligible cards still shows what is available and explains the incomplete deck.

A new edit cancels the previous worker and restarts the delay. Request IDs and input keys reject
late results. The UI ignores intermediate recommendations and replaces the displayed cards only
when the full search finishes. A completed replacement can change content height; the page avoids
the repeated collapse and expansion caused by hiding the deck. Search errors keep the displayed
deck and its current estimates, with Retry search below the result. The worker never accesses
localStorage.

Page renders preserve the viewport position of a visible focused control, with nearby surviving
rows, controls and headings as fallbacks. This also applies when the final search result changes
the deck panel's height. The correction measures the remaining displacement after rendering, so
it cooperates with native browser scroll anchoring. It pauses during manual scrolling and for
180 ms after the last scroll event, and leaves readers at the page top there. Anchors are temporary
DOM references; no scroll position is saved to localStorage. Browser checks cover growth, shrinkage,
removed rows, offscreen focus, manual scrolling, and a final deck replacement on a phone viewport.
Rows inside the inventory's scroll area keep that area fixed on the page rather than shifting the
outer page when an internal row moves.

A fresh visit uses the normal empty trainee and target inputs, the default Light Hello pin, and
the available inventory. The initial builder chooses cards by modeled stat contribution until the
user supplies targets. The specialized Fuji Kiseki/Groundwork fixture and its Maruzensky/Smart
Falcon deck belonged only to the prototype and are not startup defaults. Saved inputs are preserved.

This adopts prototype A's automatic search and retained editor from prototype commit `0bb3bef`,
with the search panel and Borrow paragraph removed. The user selected this behavior on 2026-09-11
and requested removal of the prototype worktree, branch and server after integration.

For Fuji Kiseki with Groundwork required at two stars and SSR power Smart Falcon unowned, the
previous search found 4.5763%. Manually pinning SSR speed Maruzensky exposed a 4.8843% alternative.
The two-stage search finds 5.0391% without that extra pin. A desktop check measured about 2.9 seconds
to the initial result and 7.7 seconds total, with other verification running concurrently. In the
preceding disposable comparison across five goal fixtures, the proposed search improved four
results and matched one. Exhaustive enumeration of a restricted 336-deck fixture established a
5.0461% best result, which the broader search also found in that restricted pool.

The following measurements predate the second stage and describe only the original search.

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
settings migration. It also covers the Fuji regression, misleading screening scores, competing
pins, constrained exhaustive search, and reuse of previous decks under changed ownership and pins.
Browser checks cover retained results, debouncing, cancellation, retry after failure, export order,
exclusions, saved state, and layout in both themes. Existing evaluator and run tests remain in place.
