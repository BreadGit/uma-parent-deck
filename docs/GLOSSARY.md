# Tool glossary

Terms for this project. See the [game glossary](umamusume/GLOSSARY.md) for Umamusume terminology.
For current behavior, inspect the [model](../src/model/) and [UI](../src/ui/).

- **Deck target** (target white spark): a white skill family the deck search tries to spark.
  Each target is Required or Preferred.
- **Parent goal**: the blue, pink, and required white spark conditions that one finished parent must
  meet together. Pink alternatives mean that any one listed aptitude can satisfy the pink goal.
- **Parent goal template**: an editable starting point for a parent goal. Its suggested lineage is
  planning input, not a claim about the user's actual parents.
- **Required white spark**: a target family that must appear at its chosen minimum stars. Every
  required family must succeed on the same parent. Gold and normal forms of Corner Recovery are
  one family, not two requirements.
- **Preferred white spark**: an optional target family. Its absence does not make the parent goal fail.
- **Preferred score**: a priority-weighted measure of preferred sparks on parents meeting the required
  goal. It distinguishes decks within the required-goal tie tolerance. Several lower-weight sparks
  can outweigh one higher-weight spark.
- **Complete-goal chance**: the estimated probability that every required condition holds on the same
  parent. It is not the sum of target chances. Shared event rewards and the final rank affect it.
- **Attempt**: one final spark roll, including the initial result or a reroll. The displayed counts
  assume independent attempts with the same odds, even though a reroll keeps the trained parent.
- **Inferred pink spark**: an estimated pink spark chosen to explain a starting aptitude increase.
  A grade does not identify the actual lineage.
- **Pink lineage**: the aptitude and star count of the ancestors' pink sparks. Empty entries mean
  unknown input, treated as zero sparks in the estimate. Each ancestor has a pink spark in the game.
- **Source**: a way to obtain a target skill or its hint, such as a support event or inheritance.
  An obtain chance describes access to the skill, not its final spark chance.
- **Choice-gated**: a source that only happens if the run picks that option at an event. Only one
  option per event can be taken.
- **Prioritized skills**: the ordered list to enter in independent training, derived from the parent
  goal and deck. **Extras** are offered skills outside the target families. **Hints only** marks a
  target with access that does not require an event choice; **lost event** marks a target whose event
  options are taken by higher entries. The tool assumes list order resolves event-choice conflicts;
  that is not a confirmed game rule.
- **Choice conflict**: targets or extras competing for one event's single option.
- **Spark chance**: the estimated chance a target becomes a white spark at run end.
  **Target spark chances** in Card ranking describe a card's own contribution, not the suggested
  deck's complete-goal probability.
- **Coverage**: which target hints the run can obtain and through which sources.
- **Worst-case target SP cost**: the base cost of buying the best available target forms, including
  prerequisites, counting each family once and assuming no hint discounts. Independent training
  itself buys nothing; purchases are modeled after the run.
- **Lineage** (per target): that white spark's stars on the parents and grandparents, which affect
  hint inheritance and spark generation.
- **Pinned card**: a card requested for the deck, subject to compatibility and available slots.
- **Ignored card**: a card excluded from owned-slot suggestions. The user can separately allow ignored
  cards in the friend's slot.
- **Inventory**: ownership and limit breaks. Cards without an entry use the configured defaults.
- **Observed / adjusted / model** (basis): a card's stat contribution uses a qualifying observation at
  the selected limit break, an observation shifted by the model's limit-break difference, or the fitted
  formula alone.
- **Event stats**: the deck-independent part of a run's stat gain (training events, races, scenario),
  measured from logs; **card stats**: the per-card contributions from the in-game log.
- **Race scale**: the model's adjustment to card contributions for the number of races in the run.
- **Advanced settings**: adjustable model inputs and planning preferences, with their basis explained
  in the tooltips and current defaults displayed beside the fields.
