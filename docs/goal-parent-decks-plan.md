# Goal-parent deck plan

Updated 2026-09-08. Phase 1 is implemented on `feature/goal-parent-decks` for review.
Phase 2 remains deferred. The reviewed UI uses compact target chips with a shared editor.
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

The existing deck-selection objective remains in place for this delivery. Evaluate the deck it
already suggests so the probability breakdown is reviewable before it controls selection.

### Inputs and persistence

- Acceptable blue stats, including any stat, and minimum stars.
- Desired pink aptitude and minimum stars.
- Zero or more required white skill families and their minimum stars. Required and Preferred roles
  share the Target white sparks chip list. The selected chip opens a shared editor with separate
  goal and lineage headers; clicking it again closes the editor. Removal lives on the chip.
- Four style grades in Legacy alongside its existing surface and distance grades. These describe
  the trainee after both parents are selected. Reuse the existing aptitude overrides.
- A collapsed Pink sparks editor beside By stars in Legacy. It records pink aptitude and stars
  for the two parents and four grandparents when modeling inspiration
  eligibility changes. Reuse the existing individual-affinity assumption. Leave unknown ancestry
  explicit and do not silently assign six favorable sparks. Raising a starting grade infers a
  minimum-star set in the available slots, with Estimated labels. Preserve manually entered sparks
  and allow the user to refine inferred entries in the advanced editor. Disable aptitude choices
  that exceed the starting inheritance limit or six available lineage slots; reject them before saving.

Use the existing state migration path. Normalize skill-family identity and prevent a family from
being both required and preferred. Existing saved targets should migrate as preferred targets
with no required white families selected until the user chooses them.

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

Use a simple "attempts" display. With estimated per-attempt success `p`, show the attempt counts
for 50%, 75%, and 95% chance of at least one success:

`ceil(log(1 - confidence) / log(1 - p))`

Use stable `log1p` arithmetic and handle `p = 0` and `p = 1` explicitly. One attempt means a final
spark roll. By user choice, approximate attempts as independent with the same probability. Do not
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

Rank complete legal decks by the same required-goal probability shown in delivery 1. Search from
several starting decks, retain promising alternatives, and improve them with swaps. Do not prune
every card without a direct target hint; stats and rank can make it valuable to the complete goal.

Use expected preferred sparks on successful parents as the secondary objective when required-goal
probabilities are tied within a documented numerical tolerance. If every candidate has zero
required-goal probability, report that before applying a documented fallback ranking.

Adapt borrow alternatives and explanatory text to the new objective. Keep standalone card
statistics informative but avoid suggesting that card scores add up to a complete-deck success rate.
Apply required-target priority consistently to event choices and the exported prioritized-skill
list; a preferred skill must not displace a required target from a contested choice by accident.

Verify the search on small pools where exhaustive enumeration is possible. Add cases where a
stronger stat card wins through blue or SS odds, and where balanced required-target coverage beats
a larger sum of marginal sparks. Check recommendation sensitivity to the existing uncertain hint
and rank settings. Use the same samples across candidate decks if sampling is needed.

Describe the result as the best deck found under the estimates. A bounded heuristic search does
not guarantee a global optimum. Measure evaluation time before deciding whether to use a worker.

## Deferred work

Full trainee/parent/scenario/agenda/focus search, automatic below-B multi-grade aptitude jumps,
mid-career aptitude effects on race results, detailed skill-budget allocation, reroll selection,
race/scenario white-spark goals, and a complete turn-by-turn training simulator are outside these
two deliveries. More accurate hint and whole-run rank measurements can improve existing estimates
later without blocking the initial feature.

Run `npx tsc --noEmit`, `npm test`, and `npm run smoke` before completing either delivery.
Run `npm run test:e2e` for the new browser interactions. Review staged changes and commit each
completed delivery separately.
