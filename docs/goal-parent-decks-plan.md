# Goal-parent deck plan

Updated 2026-09-10. Both deliveries are implemented on `feature/goal-parent-decks`.
See [deck search notes](goal-parent-search.md) for phase 2's bounded search, comparison rules,
fallbacks, and responsiveness. The delivery sections below retain the agreed scope.
The reviewed UI uses compact target chips with a shared editor.
The required white list now supports zero or more families, superseding the initial two-slot design.
The sections below record the current scope and acceptance criteria.
See [phase 1 evaluator notes](goal-parent-evaluator.md) for the implemented calculation and limits.

## Objective and agreed scope

Estimate the probability that one finished parent carries an acceptable blue spark, a specified
pink spark, and every required white skill spark at its minimum stars. Maximize that complete
required-goal probability. Preferred white sparks distinguish decks whose required-goal chances
are effectively tied; they must not silently outweigh a required target.

Initial scope is Our Grand Concert independent training. Keep the trainee, both parent lineages,
scenario, agenda, and training focus fixed during deck search. Respect existing ownership, limit
break, borrow, pin, and same-character constraints.

Use community estimates where they provide useful comparisons. Prefer
[Hakuraku's measurements](refs/hakuraku-spark-generation.md) for generation rates and retain the
current measured support-chain estimates. Assume the user buys available target skills and their
relevant upgrades. Retain SP in the overall-rank estimate and keep the existing cost information
secondary. Do not implement a purchasing-budget optimizer or block ordinary goals on estimated SP.

## Delivery 1: goal editor and evaluation of the current suggested deck

During phase 1, the existing deck-selection objective remained in place. Phase 2 now uses this
evaluation to select decks. The unchanged-selection acceptance check below describes phase 1 only.

### Inputs and persistence

- Acceptable blue stats, including any stat, and minimum stars.
- Desired pink aptitude or Any, and minimum stars. Defaults to Any at 2★ or better.
- Zero or more required white skill families and their minimum stars. Required and Preferred roles
  share the Target white sparks chip list. The selected chip opens a shared editor with separate
  goal and lineage headers; clicking it again closes the editor. Removal lives on the chip.
- Four style grades in Legacy alongside its existing surface and distance grades. These describe
  the trainee after both parents are selected. Reuse the existing aptitude overrides.
- A collapsed Pink sparks editor below the stat gains and above the aptitude inputs in Legacy. It records pink aptitude and stars
  for the two parents and four grandparents when modeling inspiration
  eligibility changes. Reuse the existing individual-affinity assumption. Empty slots count as
  zero sparks. Partial lineage gives an estimate without a missing-entry warning; the assumptions
  explain this default. Raising a supported starting grade infers a minimum-star set, with
  Estimated labels and editable entries. Offer A through G. Grades outside the trainee's
  starting-inheritance range, including below-base grades, are explicit planning overrides that
  survive reloads and leave pink lineage unchanged. S is unavailable.
  Dim choices that need other sparks reassigned;
  selecting one reclaims the weakest other sparks, including manual entries if needed, and
  recalculates affected starting grades. Reallocation does not push derived grades below base;
  explicit planning overrides remain intact. Preserve unrelated manual sparks unless their slots
  are needed. Clear pink sparks restores base grades without clearing blue sparks or white goals.

Use the existing state migration path. Normalize skill-family identity and prevent a family from
being both required and preferred. Existing saved targets should migrate as preferred targets
with no required white families selected until the user chooses them.
Evaluate automatically, including saves with the retired goal toggle off.

### Probability evaluator

Extract evaluation of a supplied deck from `planRun()` without calling deck search recursively.
Keep this pure model logic separate from lit templates.

1. Resolve skill sources and all required families' joint availability. Preserve shared chain
   stages, event outcomes, and incompatible choices. Retain the existing pooled hint and event
   estimates rather than building a turn-by-turn training simulator.
2. Predict final stats with inheritance and scenario caps. Calculate overall rank from the same
   stat outcome and estimated skill spending. Preserve the dependence between blue thresholds
   and SS rather than multiplying their separately averaged probabilities.
3. Predict final pink eligibility using the
   [supported B-to-A inheritance model](refs/aptitude-inheritance.md). Include competing aptitude
   increases. Keep below-B multi-grade jumps outside the automatic model for now.
4. Apply the audited blue, pink, white-generation, and conditional star tables to each outcome.
   Average complete-goal probabilities across outcomes. Treat remaining unmodeled dependencies
   as documented approximations. Fixed samples or small finite distributions can keep evaluation
   deterministic and fast; choose after measuring cost.
5. Return the complete required-goal chance, marginal target chances, preferred-spark estimates,
   and specific limitations. Marginal chances need not multiply to the complete-goal estimate.

Use the middle-band 50% / 45% / 5% star tables, inclusive 600 and 1,100 blue boundaries,
and the existing exponential lineage multiplier. Do not apply the ordinary SS white-star table
outside its supported rank range without a sourced rule or an explicit approximation. A known
out-of-scope outcome must not silently be treated as a normal supported outcome.

### Output and attempts

Show the required-goal probability and a breakdown explaining the main limiting target or
threshold. Identify impossible combinations only when the modeled sources and eligibility inputs
establish impossibility. Distinguish missing inputs and unsupported aptitude jumps from zero chance.
Name unavailable required whites, explain pink eligibility under the entered lineage, and identify
the lowest individual spark chance for a supported positive estimate. This is an explanation of
the current deck, not proof that another deck cannot meet the requirement or advice based on
independent marginal probabilities. Sampled zeros do not prove impossibility.

Use a simple "attempts" display. With estimated per-attempt success `p`, show the attempt counts
for 50%, 75%, and 95% chance of at least one success:

`ceil(log(1 - confidence) / log(1 - p))`

Use stable `log1p` arithmetic and handle `p = 0` and `p = 1` explicitly. One attempt means a final
spark roll, including a reroll. Label the result "Chance per final spark roll". By user choice,
approximate attempts as independent with the same probability. Do not
add attempts-per-career settings, grouped reroll mathematics, or a selective-reroll policy. A short
explanation of the approximation is enough. Report sensible rounded estimates, not long decimals.

### Acceptance checks

- Test corrected rate tables and threshold boundaries.
- Test at-least-2-star versus exactly-2-star arithmetic inside the model, even if the initial UI
  offers only minimum stars.
- Test single and multiple blue targets, including any stat.
- Test B-to-A inheritance, competing pink eligibility, unknown ancestry, and unsupported jumps.
- Test shared event outcomes and alternatives that cannot supply both required targets.
- Test shared-rank dependence and the difference between expected spark count and joint success.
- Test zero and certain success, and the 50% / 75% / 95% attempt calculations.
- Test state migration and field synchronization. Extend smoke/regression interactions for new
  controls, calling `assertFieldsMatchState` after changes.
- Confirm that changing Required/Preferred roles or minimum stars does not change the suggested
  deck. Adding/removing target chips still changes the existing builder's target list.
- Test zero, one, and many required whites, plus large independent and linked source groups.

## Delivery 2: use the evaluator to select decks

This section records the implemented phase 2 scope. The comparison setting, fallback search,
and loading state were added after the phase 1 polish.

### Required goals and preferred extras

Rank complete legal decks by the same required-goal probability shown in delivery 1. Search from
several starting decks, retain promising alternatives, and improve them with swaps. Do not prune
every card without a direct target hint; stats and rank can make it valuable to the complete goal.

Use expected preferred sparks on successful parents as the secondary objective. For each preferred
family, calculate the probability of both it and the required goal succeeding, then divide by the
required-goal probability. Sum those conditional probabilities. Reuse shared events and rank when
calculating the intersections; the current unconditional preferred estimates cannot substitute.
Show what this comparison means in ordinary language, such as average preferred sparks on parents
meeting all requirements.

Default to a tight relative tie window of 0.1%. Let `pBest` be the highest required-goal probability
found. Only positive-probability candidates with `p >= pBest * (1 - tolerance)` can win on preferred
extras. Anchor the window to `pBest`, not successive pairwise ties, so repeated comparisons cannot
drift farther from the best required chance. If preferred scores tie, prefer the higher required
chance, then use a stable deck order. A positive required chance always beats zero.

Add `goalTieTolerance` to Advanced settings with label "Required-goal tie tolerance (relative)".
The default is `0.001`; accept finite fractions from zero through one through the existing setting
specification and migration path. Zero permits only exact ties. The help text must say that larger
values allow preferred extras to outweigh more required-goal chance. At the default, a best chance
of 10% admits candidates at 9.99% or above. A best chance of 0.01% admits 0.00999% or above.
This is a user preference, not a claim that the estimates are accurate to that precision. The
control is now active in phase 2.

### Uncertain and impossible requirements

Keep the original goal and its displayed probability intact. A zero in one candidate does not
justify dropping a requirement that another legal deck can satisfy. First search for complete
success and check source, eligibility, and legality constraints across the allowed pool.

When a required spark is impossible across legal decks under the fixed inputs, identify it and its
reason. Optimize the joint chance of all remaining required sparks, then preferred extras on
parents meeting those remaining requirements, with the same tight tie window. Do not let an
impossible pink goal or unavailable white family erase the value of improving the other goals.
Display the original complete goal as zero and label any remaining-goal probability separately.
Never remove the saved requirement or change its role without a user edit.

If the remaining requirements are individually possible but cannot all succeed together, seek the
largest jointly achievable subset of required sparks. Compare subset size first, its joint chance
second, and preferred extras within the tie window third. Keep the compared subset size common
across decks, so a deck cannot win simply by omitting a difficult requirement. Explain incompatible
requirements together rather than calling each one individually impossible. If no required spark
is achievable, report that and use expected preferred sparks, then existing stat strength and
stable deck order. This final fallback must be labeled as having no achievable required sparks.

Do not turn a zero sample estimate into a claim of impossibility. When the bounded search or source
sampling finds no complete success without proof, say "No complete success found under these
estimates" and label the remaining-goal recommendation as a fallback. Distinguish proved
constraints from the best subset found by a bounded search.

Pink uncertainty currently multiplies every candidate's blue/white result by the same interval
because trainee, grades, and lineage stay fixed. If its upper bound is positive, compare the
blue/white part with that common factor removed, including when the pink lower bound is zero.
Continue displaying the full probability range; do not substitute a midpoint or treat zero lower
bounds as impossible. With the current independence assumptions, the common pink factor also
cancels in preferred-on-success comparisons. If future modeling makes that factor depend on the
deck, revisit this comparison rule before extending the search.

### Skill choices and recommendation text

Keep the borrowed-card badge; omit the separate Borrow paragraph. Keep standalone card
statistics informative but avoid suggesting that card scores add up to a complete-deck success rate.
Apply required-target priority consistently to event choices and the exported prioritized-skill
list; a preferred skill must not displace a required target from a contested choice by accident.
Preserve user ordering within Required and within the other skills, while Required takes precedence
between those groups. Make that precedence visible and keep saved custom ordering intact. An
explicitly excluded required skill should produce a clear conflict notice; do not silently undo
the exclusion or pretend that its contested source is available. Resolve choices for each complete
candidate so search, evaluation, displayed advice, and export describe the same deck behavior.

### Verification and responsiveness

Verify the search on small pools where exhaustive enumeration is possible. Add cases where a
stronger stat card wins through blue or SS odds, and where balanced required-target coverage beats
a larger sum of marginal sparks. Check recommendation sensitivity to the existing uncertain hint
and rank settings. Use the same samples across candidate decks if sampling is needed.
Test both tie-window boundaries, zero tolerance, rare goals, order independence, and repeated
comparisons near the window edge. Test a preferred spark that mostly occurs on unsuccessful parents.
Test an impossible white or pink requirement with several remaining requirements, a requirement
unavailable only in the initial deck, incompatible choices, and uncertain pink ranges starting at
zero. Verify that saved goals survive every fallback and that the new setting persists and matches
its field after edits and reloads.

Describe the result as the best deck found under the estimates. A bounded heuristic search does
not guarantee a global optimum. The implemented search runs in a worker and fully evaluates up to
192 decks for an initial result. It then screens up to 1,536 decks across the full eligible card
pool with a cheaper rank estimate and fully evaluates sixteen finalists. Final comparison keeps
all fully checked candidates, including the initial recommendation. Small legal spaces use
exhaustive search instead. The [search notes](goal-parent-search.md) record limits and measurements;
physical-phone timing remains to be checked on the user's device.

Keep the deck and skill editor visible while a spinner beside Suggested deck identifies search.
Update the displayed deck's estimates immediately after input changes. Reuse its cards only after
checking current ownership, limit breaks, pins and trainee constraints. Build a legal replacement
when needed. Wait 400 ms after the last edit before searching, cancel obsolete workers, and apply
only the final result. Keep the displayed deck if search fails and offer retry below the result.
Remove the separate Borrow paragraph and prototype search panel. A fresh visit uses the normal
inventory-based starting deck with empty trainee and target inputs, without the prototype fixture.
Browser tests cover these states, input responsiveness, and a retained phone editor.

## Deferred work

Full trainee/parent/scenario/agenda/focus search, automatic below-B multi-grade aptitude jumps,
mid-career aptitude effects on race results, detailed skill-budget allocation, reroll selection,
race/scenario white-spark goals, and a complete turn-by-turn training simulator are outside these
two deliveries. More accurate hint and whole-run rank measurements can improve existing estimates
later without blocking the initial feature.

Run `npx tsc --noEmit`, `npm test`, and `npm run smoke` before completing either delivery.
Run `npm run test:e2e` for the new browser interactions. Review staged changes and commit each
completed delivery separately.
